import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import {
  findRepoRoot,
  log,
  logHeader,
  parseArgs,
  resolveCommsDir,
} from "../utils.js";
import type { CommandResult } from "../types.js";
import type { WindowsAppRouteHealth } from "../routing/windows-app-route-health.js";

const HELP = `
Usage:
  tap windows-route-recover --agent <name> [options]

Options:
  --agent <name>              Target Windows App agent. Default: 솔.
  --apply                     Apply guarded refresh/publish steps.
  --dry-run                   With --apply, preview recovery without mutation.
  --source-host <host>        Source host key or alias. Default: devin.
  --source-comms-dir <path>   Override Windows source comms directory.
  --source-platform-dir <path>
                              Override Windows source repo/platform directory.
  --conversation-id <id>      Explicit Windows App conversation id.
  --central <path>            Central/SSOT comms directory. Defaults to tap config.
  --fresh-minutes <n>         Presence freshness window. Default: 30.
  --remote-hosts <json>       Remote host mapping. Default: TAP_CODEX_REMOTE_HOSTS.
  --codex-config <path>       Codex config.toml for drift diagnostics.
  --smoke                     After recovery, run an explicit Windows live smoke.
  --smoke-subject <text>      Subject for --smoke.
  --smoke-content <text>      Content for --smoke.
  --json                      Machine-readable JSON output.
`.trim();

type RecoverStatus = "ready" | "needs-recovery" | "recovered" | "blocked";
type RecoverClass =
  | "fresh-ready"
  | "ttl-expired-target-ready"
  | "central-publish-needed"
  | "source-presence-missing-target-ready"
  | "target-missing-or-dead"
  | "active-turn-blocked"
  | "host-unresolved"
  | "remote-host-config-drift"
  | "structured-route-not-ready";
type CheckStatus = "pass" | "warn" | "fail" | "block" | "skip";
type ActionStatus =
  | "observed"
  | "applied"
  | "would-apply"
  | "skipped"
  | "failed";
type RunKind =
  | "presence-check"
  | "remote-ready-dry-run"
  | "remote-ready-refresh"
  | "presence-publish"
  | "remote-ready-smoke";

interface RunResult {
  ok: boolean;
  status: number | null;
  stdout: string;
  stderr: string;
}
interface RunRequest {
  kind: RunKind;
  command: string;
  args: string[];
  cwd?: string;
}
type Runner = (request: RunRequest) => RunResult;

interface RemoteHost {
  hostId: string;
  sshTarget: string;
  platformDir: string;
  commsDir: string | null;
  nodeCommand: string | null;
  hostAliases: string[];
  aliasFor?: string;
}
interface HostMap {
  ok: boolean;
  hosts: Record<string, RemoteHost>;
  error: string | null;
}
interface HostResolution {
  status: "resolved" | "config-drift" | "unresolved";
  requestedHost: string;
  matchedHostKey: string | null;
  matchedHostId: string | null;
  configSource: "active-env" | "configured-env" | "profile-default" | "none";
  config: RemoteHost | null;
  message: string;
}
interface PresenceCheck {
  role: string;
  agent: string;
  endpoint: string;
  exists: boolean;
  freshness: string;
  consentDriveStatus: string | null;
  freshForRouting: boolean;
  ageSeconds?: number | null;
  conversationId?: string | null;
  ownerClientId?: string | null;
  receiveTransports?: string[];
  recommendation?: string;
  error?: string | null;
}
interface PresencePair {
  source: PresenceCheck | null;
  central: PresenceCheck | null;
  raw: Record<string, unknown> | null;
  error: string | null;
}
interface RouteMeta {
  hostId: string | null;
  conversationId: string | null;
  ownerClientId: string | null;
  complete: boolean;
}
interface Check {
  name: string;
  status: CheckStatus;
  message: string;
}
interface Action {
  name: string;
  status: ActionStatus;
  message: string;
  command?: string;
  stdout?: string;
  stderr?: string;
}
interface Proof {
  transport: "consent-drive" | "not-ready";
  liveAttemptStatus: "would-attempt" | "not-attempted";
  fallbackToInbox: boolean;
  reason: string;
}
interface RecoverReport extends Record<string, unknown> {
  generatedAt: string;
  profile: "windows-app-sol";
  agent: string;
  status: RecoverStatus;
  classification: RecoverClass;
  apply: { enabled: boolean; dryRun: boolean };
  host: {
    requestedHost: string;
    matchedHostKey: string | null;
    matchedHostId: string | null;
    sshTarget: string | null;
    platformDir: string | null;
    commsDir: string | null;
    sourceEndpoint: string | null;
    configSource: HostResolution["configSource"];
    status: HostResolution["status"];
    message: string;
  };
  central: { commsDir: string; presencePath: string; route: RouteMeta };
  presence: PresencePair;
  targetLocal: {
    attempted: boolean;
    ok: boolean;
    command: string | null;
    routeHealth: WindowsAppRouteHealth | null;
    message: string;
  };
  routeDryRunProof: Proof;
  checks: Check[];
  actions: Action[];
  next: string[];
}

let runnerForTests: Runner | null = null;
export function __setWindowsRouteRecoverCommandRunnerForTests(
  runner: Runner | null,
): void {
  runnerForTests = runner;
}

const DEFAULT_HOSTS: Record<string, unknown> = {
  "D:\\HUA\\hua-comms": {
    ssh: "devin-win-ts",
    repo: "D:\\HUA\\hua-platform",
    commsDir: "D:\\HUA\\hua-comms",
    hostAliases: [
      "DEVIN",
      "devin",
      "devin-win-ts",
      "windows-app",
      "windows-app-sol",
    ],
  },
};

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
function rec(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}
function stringArray(value: unknown): string[] {
  if (typeof value === "string") return value.trim() ? [value.trim()] : [];
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}
function hostKey(value: unknown): string | null {
  return str(value)?.toLowerCase() ?? null;
}
function normalizeRemoteConfig(
  hostId: string,
  value: unknown,
): RemoteHost | null {
  const record = rec(value);
  if (!record) return null;
  const sshTarget = str(record.sshTarget) ?? str(record.ssh);
  const platformDir = str(record.platformDir) ?? str(record.repo);
  if (!sshTarget || !platformDir) return null;
  return {
    hostId,
    sshTarget,
    platformDir,
    commsDir: str(record.commsDir),
    nodeCommand: str(record.nodeCommand),
    hostAliases: [
      ...stringArray(record.hostAliases),
      ...stringArray(record.aliases),
      ...stringArray(record.hostId),
    ],
  };
}
function parseRemoteHosts(raw: string | null | undefined): HostMap {
  const normalized = str(raw);
  if (!normalized) return { ok: true, hosts: {}, error: null };
  try {
    const parsed = rec(JSON.parse(normalized));
    if (!parsed)
      return {
        ok: false,
        hosts: {},
        error: "TAP_CODEX_REMOTE_HOSTS is not an object",
      };
    const hosts: Record<string, RemoteHost> = {};
    const entries: Array<{ key: string; config: RemoteHost }> = [];
    for (const [id, value] of Object.entries(parsed)) {
      const key = hostKey(id);
      const config = normalizeRemoteConfig(id, value);
      if (!key || !config) continue;
      hosts[key] = config;
      entries.push({ key, config });
    }
    for (const { key, config } of entries) {
      for (const alias of config.hostAliases) {
        const aliasKey = hostKey(alias);
        if (!aliasKey || aliasKey === key || hosts[aliasKey]) continue;
        hosts[aliasKey] = { ...config, aliasFor: config.hostId };
      }
    }
    return { ok: true, hosts, error: null };
  } catch (error) {
    return {
      ok: false,
      hosts: {},
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function defaultCodexConfigPath(): string {
  return process.env.CODEX_HOME?.trim()
    ? path.join(process.env.CODEX_HOME.trim(), "config.toml")
    : path.join(os.homedir(), ".codex", "config.toml");
}
function configuredRemoteHosts(configPath: string): {
  raw: string;
  error: string | null;
} {
  if (!fs.existsSync(configPath)) return { raw: "", error: null };
  try {
    const text = fs.readFileSync(configPath, "utf8");
    let inTapEnv = false;
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const table = line.match(/^\[([^\]]+)\]$/);
      if (table) {
        inTapEnv = table[1] === "mcp_servers.tap.env";
        continue;
      }
      if (!inTapEnv) continue;
      const assignment = line.match(/^TAP_CODEX_REMOTE_HOSTS\s*=\s*(.+)$/);
      if (!assignment) continue;
      const parsed = JSON.parse(assignment[1]) as unknown;
      return { raw: typeof parsed === "string" ? parsed : "", error: null };
    }
    return { raw: "", error: null };
  } catch (error) {
    return {
      raw: "",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
function resolveHost(
  requestedHost: string,
  active: HostMap,
  configured: HostMap,
  defaults: HostMap,
): HostResolution {
  const key = hostKey(requestedHost);
  if (!key) {
    return {
      status: "unresolved",
      requestedHost,
      matchedHostKey: null,
      matchedHostId: null,
      configSource: "none",
      config: null,
      message: "source host is empty",
    };
  }
  const activeConfig = active.ok ? active.hosts[key] : null;
  if (activeConfig) {
    return {
      status: "resolved",
      requestedHost,
      matchedHostKey: key,
      matchedHostId: activeConfig.aliasFor ?? activeConfig.hostId,
      configSource: "active-env",
      config: activeConfig,
      message: "source host resolved from active TAP_CODEX_REMOTE_HOSTS",
    };
  }
  const configuredConfig = configured.ok ? configured.hosts[key] : null;
  if (configuredConfig) {
    return {
      status: "config-drift",
      requestedHost,
      matchedHostKey: key,
      matchedHostId: configuredConfig.aliasFor ?? configuredConfig.hostId,
      configSource: "configured-env",
      config: configuredConfig,
      message:
        "source host exists in Codex config.toml but not in active TAP_CODEX_REMOTE_HOSTS; reload tap MCP runtime before structured delivery",
    };
  }
  const defaultConfig = defaults.hosts[key];
  if (defaultConfig) {
    return {
      status: "resolved",
      requestedHost,
      matchedHostKey: key,
      matchedHostId: defaultConfig.aliasFor ?? defaultConfig.hostId,
      configSource: "profile-default",
      config: defaultConfig,
      message:
        "source host resolved from windows-app-sol profile defaults; active MCP env still controls structured delivery proof",
    };
  }
  return {
    status: "unresolved",
    requestedHost,
    matchedHostKey: key,
    matchedHostId: null,
    configSource: "none",
    config: null,
    message: `source host ${requestedHost} is not mapped`,
  };
}
function isWinPath(value: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(value);
}
function joinRemote(base: string, ...parts: string[]): string {
  return isWinPath(base)
    ? path.win32.join(base, ...parts)
    : [base.replace(/[\\/]+$/, ""), ...parts].join("/");
}
function psQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}
function shQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
function encodePs(script: string): string {
  return Buffer.from(script, "utf16le").toString("base64");
}
function displayReady(options: {
  host: RemoteHost;
  agent: string;
  sourceCommsDir: string;
  conversationId: string;
  freshMinutes: number;
  mode: "dry-run" | "refresh" | "smoke";
  smokeSubject?: string;
  smokeContent?: string;
}): string {
  const args = [
    "ready",
    "--surface",
    "windows-app",
    "--agent",
    options.agent,
    "--conversation-id",
    options.conversationId,
    "--comms-dir",
    options.sourceCommsDir,
    "--fresh-minutes",
    String(options.freshMinutes),
    "--apply",
  ];
  if (options.mode === "dry-run") args.push("--dry-run");
  if (options.mode === "refresh") args.push("--apply-windows-route-refresh");
  if (options.mode === "smoke")
    args.push(
      "--apply-windows-route-smoke",
      "--smoke-subject",
      options.smokeSubject ?? "",
      "--smoke-content",
      options.smokeContent ?? "",
    );
  args.push("--json");
  return `ssh ${options.host.sshTarget} ${shQuote(`cd ${options.host.platformDir}; node packages/tap-comms/dist/cli.mjs ${args.join(" ")}`)}`;
}
function readyCommand(options: {
  host: RemoteHost;
  agent: string;
  sourceCommsDir: string;
  conversationId: string;
  freshMinutes: number;
  mode: "dry-run" | "refresh" | "smoke";
  smokeSubject?: string;
  smokeContent?: string;
}): { command: string; args: string[]; display: string } {
  const cliPath = joinRemote(
    options.host.platformDir,
    "packages",
    "tap-comms",
    "dist",
    "cli.mjs",
  );
  const cliArgs = [
    "ready",
    "--surface",
    "windows-app",
    "--agent",
    options.agent,
    "--conversation-id",
    options.conversationId,
    "--comms-dir",
    options.sourceCommsDir,
    "--fresh-minutes",
    String(options.freshMinutes),
    "--apply",
  ];
  if (options.mode === "dry-run") cliArgs.push("--dry-run");
  if (options.mode === "refresh") cliArgs.push("--apply-windows-route-refresh");
  if (options.mode === "smoke")
    cliArgs.push(
      "--apply-windows-route-smoke",
      "--smoke-subject",
      options.smokeSubject ?? "",
      "--smoke-content",
      options.smokeContent ?? "",
    );
  cliArgs.push("--json");
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()",
    `Set-Location -LiteralPath ${psQuote(options.host.platformDir)}`,
    [
      "&",
      psQuote(options.host.nodeCommand ?? "node"),
      psQuote(cliPath),
      ...cliArgs.map(psQuote),
    ].join(" "),
    "exit $LASTEXITCODE",
  ].join("\n");
  return {
    command: "ssh",
    args: [
      "-o",
      "BatchMode=yes",
      "-o",
      "ConnectTimeout=5",
      options.host.sshTarget,
      "powershell",
      "-NoProfile",
      "-EncodedCommand",
      encodePs(script),
    ],
    display: displayReady(options),
  };
}
function presenceCommand(options: {
  repoRoot: string;
  sourceEndpoint: string;
  central: string;
  agent: string;
  mode: "check" | "publish";
  dryRun?: boolean;
}): { command: string; args: string[]; cwd: string; display: string } {
  const args = [
    "scripts/tap-presence-publish.mjs",
    "--source",
    options.sourceEndpoint,
    "--target",
    options.central,
    "--agent",
    options.agent,
  ];
  if (options.mode === "check") args.push("--check-only");
  else {
    args.push("--require-source-fresh", "--verify");
    if (options.dryRun) args.push("--dry-run");
  }
  args.push("--json");
  return {
    command: "node",
    args,
    cwd: options.repoRoot,
    display: ["node", ...args.map(shQuote)].join(" "),
  };
}
function run(request: RunRequest): RunResult {
  if (runnerForTests) return runnerForTests(request);
  const result = spawnSync(request.command, request.args, {
    cwd: request.cwd,
    encoding: "utf8",
    stdio: "pipe",
  });
  return {
    ok: result.status === 0,
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}
function parseJson(result: RunResult): {
  value: Record<string, unknown> | null;
  error: string | null;
} {
  const text = result.stdout.trim();
  if (!text) return { value: null, error: result.stderr.trim() || null };
  const start = text.indexOf("{");
  if (start < 0) return { value: null, error: "command did not emit JSON" };
  try {
    return {
      value: JSON.parse(text.slice(start)) as Record<string, unknown>,
      error: null,
    };
  } catch (error) {
    return {
      value: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
function parsePresence(result: RunResult): PresencePair {
  const parsed = parseJson(result);
  if (!parsed.value)
    return {
      source: null,
      central: null,
      raw: null,
      error: parsed.error ?? "presence command did not emit JSON",
    };
  const checks = Array.isArray(parsed.value.checks) ? parsed.value.checks : [];
  const records = checks
    .map(rec)
    .filter((item): item is Record<string, unknown> => Boolean(item));
  return {
    source:
      (records.find((item) => item.role === "source") as
        | PresenceCheck
        | undefined) ?? null,
    central:
      (records.find((item) => item.role === "target") as
        | PresenceCheck
        | undefined) ?? null,
    raw: parsed.value,
    error: null,
  };
}
function parseRouteHealth(result: RunResult): {
  routeHealth: WindowsAppRouteHealth | null;
  error: string | null;
} {
  const parsed = parseJson(result);
  if (!parsed.value)
    return {
      routeHealth: null,
      error: parsed.error ?? "ready command did not emit JSON",
    };
  const data = rec(parsed.value.data);
  const routeHealth = rec(data?.windowsRouteHealth);
  return {
    routeHealth: routeHealth as WindowsAppRouteHealth | null,
    error: routeHealth
      ? null
      : "ready command did not report windowsRouteHealth",
  };
}

function readJsonFile(filePath: string): Record<string, unknown> | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as Record<
      string,
      unknown
    >;
  } catch {
    return null;
  }
}
function routeMeta(record: Record<string, unknown> | null): RouteMeta {
  const address = rec(record?.address);
  const capabilities = rec(record?.capabilities);
  const hostId = str(address?.hostId);
  const conversationId =
    str(capabilities?.conversationId) ??
    str(address?.conversationId) ??
    str(record?.conversationId);
  const ownerClientId =
    str(capabilities?.ownerClientId) ??
    str(address?.ownerClientId) ??
    str(record?.ownerClientId);
  return {
    hostId,
    conversationId,
    ownerClientId,
    complete: Boolean(hostId && conversationId && ownerClientId),
  };
}
function targetReady(routeHealth: WindowsAppRouteHealth | null): boolean {
  return (
    routeHealth?.status === "fresh-route-ready" ||
    routeHealth?.status === "stale-presence"
  );
}
function deadRoute(routeHealth: WindowsAppRouteHealth | null): boolean {
  return (
    !routeHealth ||
    routeHealth.status === "adapter-unavailable" ||
    routeHealth.status === "candidate-not-observed" ||
    routeHealth.status === "missing-owner-client" ||
    routeHealth.status === "live-candidate-needs-selection"
  );
}
function proof(options: {
  central: PresenceCheck | null;
  route: RouteMeta;
  routeHealth: WindowsAppRouteHealth | null;
  activeHosts: HostMap;
}): Proof {
  const key = hostKey(options.route.hostId);
  const mapped =
    key && options.activeHosts.ok ? options.activeHosts.hosts[key] : null;
  if (
    options.central?.freshForRouting &&
    options.route.complete &&
    mapped &&
    targetReady(options.routeHealth)
  ) {
    return {
      transport: "consent-drive",
      liveAttemptStatus: "would-attempt",
      fallbackToInbox: false,
      reason:
        "central presence is fresh, route tuple is complete, target-local IPC is ready, and active remote host mapping is present",
    };
  }
  const reasons: string[] = [];
  if (!options.central?.freshForRouting)
    reasons.push("central presence is not fresh-for-routing");
  if (!options.route.complete)
    reasons.push("central route tuple is incomplete");
  if (!mapped)
    reasons.push("active TAP_CODEX_REMOTE_HOSTS does not map the route hostId");
  if (!targetReady(options.routeHealth))
    reasons.push("target-local IPC is not ready");
  return {
    transport: "not-ready",
    liveAttemptStatus: "not-attempted",
    fallbackToInbox: true,
    reason: reasons.join("; ") || "structured route proof is not ready",
  };
}
function classify(options: {
  host: HostResolution;
  source: PresenceCheck | null;
  central: PresenceCheck | null;
  routeHealth: WindowsAppRouteHealth | null;
  proof: Proof;
}): RecoverClass {
  if (options.host.status === "unresolved") return "host-unresolved";
  if (options.host.status === "config-drift") return "remote-host-config-drift";
  if (options.routeHealth?.status === "active-turn-blocked")
    return "active-turn-blocked";
  if (deadRoute(options.routeHealth)) return "target-missing-or-dead";
  if (options.proof.liveAttemptStatus === "would-attempt") return "fresh-ready";
  if (targetReady(options.routeHealth)) {
    if (!options.source?.exists) return "source-presence-missing-target-ready";
    if (!options.source.freshForRouting) return "ttl-expired-target-ready";
    if (!options.central?.freshForRouting) return "central-publish-needed";
  }
  return "structured-route-not-ready";
}
function statusFor(
  classification: RecoverClass,
  apply: boolean,
  dryRun: boolean,
  routeProof: Proof,
  actions: Action[],
): RecoverStatus {
  if (routeProof.liveAttemptStatus === "would-attempt") {
    return apply &&
      !dryRun &&
      actions.some((action) => action.status === "applied")
      ? "recovered"
      : "ready";
  }
  if (
    classification === "host-unresolved" ||
    classification === "remote-host-config-drift" ||
    classification === "target-missing-or-dead" ||
    classification === "active-turn-blocked"
  )
    return "blocked";
  return "needs-recovery";
}
function failure(result: RunResult): string {
  const output = result.stderr.trim() || result.stdout.trim();
  if (!output)
    return `command exited with ${result.status ?? "unknown status"}`;
  return output.length > 240 ? `${output.slice(0, 237)}...` : output;
}
function addCheck(
  checks: Check[],
  status: CheckStatus,
  name: string,
  message: string,
): void {
  checks.push({ name, status, message });
}
function warnings(checks: Check[]): string[] {
  return checks
    .filter(
      (check) =>
        check.status === "warn" ||
        check.status === "fail" ||
        check.status === "block",
    )
    .map((check) => `${check.name}: ${check.message}`);
}
function getStringFlag(
  value: string | boolean | undefined,
  fallback: string | null,
  name: string,
): { ok: true; value: string } | { ok: false; message: string } {
  if (value === undefined) {
    if (fallback != null) return { ok: true, value: fallback };
    return { ok: false, message: `Missing ${name}` };
  }
  if (typeof value !== "string" || !value.trim())
    return { ok: false, message: `Invalid ${name}: expected a value.` };
  return { ok: true, value: value.trim() };
}
function positiveInt(
  value: string | boolean | undefined,
  fallback: number,
  name: string,
): { ok: true; value: number } | { ok: false; message: string } {
  if (value === undefined) return { ok: true, value: fallback };
  if (typeof value !== "string")
    return { ok: false, message: `Invalid ${name}: expected a value.` };
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0)
    return {
      ok: false,
      message: `Invalid ${name}: must be a positive integer.`,
    };
  return { ok: true, value: parsed };
}
function invalid(message: string): CommandResult<RecoverReport> {
  return {
    ok: false,
    command: "windows-route-recover",
    code: "TAP_INVALID_ARGUMENT",
    message,
    warnings: [message],
    data: {} as RecoverReport,
  };
}
function logReport(report: RecoverReport): void {
  logHeader("tap windows-route-recover");
  log(`Status: ${report.status}`);
  log(`Classification: ${report.classification}`);
  log(
    `Host: requested=${report.host.requestedHost} ssh=${report.host.sshTarget ?? "-"} source=${report.host.configSource}`,
  );
  log(
    `Proof: transport=${report.routeDryRunProof.transport} liveAttemptStatus=${report.routeDryRunProof.liveAttemptStatus} fallbackToInbox=${report.routeDryRunProof.fallbackToInbox}`,
  );
  const firstProblem = report.checks.find(
    (check) =>
      check.status === "block" ||
      check.status === "fail" ||
      check.status === "warn",
  );
  if (firstProblem)
    log(`${firstProblem.status} ${firstProblem.name}: ${firstProblem.message}`);
  for (const item of report.next.slice(0, 6)) log(`next: ${item}`);
}

export async function windowsRouteRecoverCommand(
  args: string[],
): Promise<CommandResult<RecoverReport>> {
  if (args.includes("--help") || args.includes("-h")) {
    log(HELP);
    return {
      ok: true,
      command: "windows-route-recover",
      code: "TAP_NO_OP",
      message: HELP,
      warnings: [],
      data: {} as RecoverReport,
    };
  }

  const parsed = parseArgs(args);
  const agent = getStringFlag(parsed.flags.agent, "솔", "--agent");
  if (!agent.ok) return invalid(agent.message);
  const sourceHost = getStringFlag(
    parsed.flags["source-host"],
    "devin",
    "--source-host",
  );
  if (!sourceHost.ok) return invalid(sourceHost.message);
  const freshMinutes = positiveInt(
    parsed.flags["fresh-minutes"],
    30,
    "--fresh-minutes",
  );
  if (!freshMinutes.ok) return invalid(freshMinutes.message);
  const smoke = parsed.flags.smoke === true;
  const smokeSubject = str(parsed.flags["smoke-subject"]);
  const smokeContent = str(parsed.flags["smoke-content"]);
  if (smoke && (!smokeSubject || !smokeContent))
    return invalid("--smoke requires --smoke-subject and --smoke-content.");

  const repoRoot = findRepoRoot();
  const central = path.resolve(
    str(parsed.flags.central) ?? resolveCommsDir(args, repoRoot),
  );
  const apply = parsed.flags.apply === true;
  const dryRun = !apply || parsed.flags["dry-run"] === true;
  const forceFreshRouteRefresh =
    parsed.flags["force-fresh-route-refresh"] === true;
  const codexConfig = path.resolve(
    str(parsed.flags["codex-config"]) ?? defaultCodexConfigPath(),
  );
  const configuredRaw = configuredRemoteHosts(codexConfig);
  const activeHosts = parseRemoteHosts(
    str(parsed.flags["remote-hosts"]) ??
      process.env.TAP_CODEX_REMOTE_HOSTS ??
      "",
  );
  const configuredHosts = parseRemoteHosts(configuredRaw.raw);
  const defaultHosts = parseRemoteHosts(JSON.stringify(DEFAULT_HOSTS));
  const resolved = resolveHost(
    sourceHost.value,
    activeHosts,
    configuredHosts,
    defaultHosts,
  );

  const checks: Check[] = [];
  const actions: Action[] = [];
  const next: string[] = [];
  addCheck(
    checks,
    resolved.status === "unresolved"
      ? "fail"
      : resolved.status === "config-drift"
        ? "warn"
        : "pass",
    "source-host",
    resolved.message,
  );
  if (!activeHosts.ok)
    addCheck(
      checks,
      "fail",
      "active-remote-hosts",
      activeHosts.error ?? "active TAP_CODEX_REMOTE_HOSTS did not parse",
    );
  if (configuredRaw.error)
    addCheck(checks, "warn", "codex-config", configuredRaw.error);

  const sourceCommsDir =
    str(parsed.flags["source-comms-dir"]) ??
    resolved.config?.commsDir ??
    (resolved.matchedHostId && isWinPath(resolved.matchedHostId)
      ? resolved.matchedHostId
      : "D:\\HUA\\hua-comms");
  const sourcePlatformDir =
    str(parsed.flags["source-platform-dir"]) ??
    resolved.config?.platformDir ??
    "D:\\HUA\\hua-platform";
  const hostConfig = resolved.config
    ? {
        ...resolved.config,
        platformDir: sourcePlatformDir,
        commsDir: sourceCommsDir,
      }
    : null;
  const sourceEndpoint = hostConfig
    ? `${hostConfig.sshTarget}:${sourceCommsDir}`
    : null;

  let presence: PresencePair = {
    source: null,
    central: null,
    raw: null,
    error: "source host unresolved",
  };
  if (hostConfig && sourceEndpoint) {
    const command = presenceCommand({
      repoRoot,
      sourceEndpoint,
      central,
      agent: agent.value,
      mode: "check",
    });
    const result = run({
      kind: "presence-check",
      command: command.command,
      args: command.args,
      cwd: command.cwd,
    });
    presence = parsePresence(result);
    actions.push({
      name: "presence-check",
      status: result.ok && !presence.error ? "observed" : "failed",
      message:
        result.ok && !presence.error
          ? "checked source-local and central presence freshness"
          : (presence.error ?? failure(result)),
      command: command.display,
      stderr: result.stderr.trim() || undefined,
    });
    addCheck(
      checks,
      result.ok && !presence.error ? "pass" : "fail",
      "presence-check",
      result.ok && !presence.error
        ? "source-local and central presence checks completed"
        : (presence.error ?? failure(result)),
    );
  }

  const conversationId =
    str(parsed.flags["conversation-id"]) ??
    presence.source?.conversationId ??
    presence.central?.conversationId ??
    null;
  if (!conversationId) {
    addCheck(
      checks,
      "fail",
      "conversation-id",
      "conversationId was not supplied and could not be inferred from source/central presence",
    );
    next.push(
      "rerun with --conversation-id <thread-id> after opening the target Windows App thread",
    );
  } else {
    addCheck(
      checks,
      "pass",
      "conversation-id",
      `conversationId=${conversationId}`,
    );
  }

  let routeHealth: WindowsAppRouteHealth | null = null;
  let readyDisplay: string | null = null;
  if (hostConfig && conversationId) {
    const command = readyCommand({
      host: hostConfig,
      agent: agent.value,
      sourceCommsDir,
      conversationId,
      freshMinutes: freshMinutes.value,
      mode: "dry-run",
    });
    readyDisplay = command.display;
    const result = run({
      kind: "remote-ready-dry-run",
      command: command.command,
      args: command.args,
    });
    const parsedHealth = parseRouteHealth(result);
    routeHealth = parsedHealth.routeHealth;
    actions.push({
      name: "target-local-ready-dry-run",
      status: result.ok && routeHealth ? "observed" : "failed",
      message:
        result.ok && routeHealth
          ? routeHealth.message
          : (parsedHealth.error ?? failure(result)),
      command: command.display,
      stderr: result.stderr.trim() || undefined,
    });
    addCheck(
      checks,
      result.ok && routeHealth
        ? routeHealth.status === "active-turn-blocked"
          ? "block"
          : targetReady(routeHealth)
            ? "pass"
            : "warn"
        : "fail",
      "target-local-ipc",
      result.ok && routeHealth
        ? `${routeHealth.status}: ${routeHealth.message}`
        : (parsedHealth.error ?? failure(result)),
    );
  }

  const shouldRefreshRoute =
    routeHealth?.status === "stale-presence" ||
    (forceFreshRouteRefresh && routeHealth?.status === "fresh-route-ready");
  let routeRefreshApplied = false;

  if (apply && !dryRun && hostConfig && conversationId && shouldRefreshRoute) {
    const command = readyCommand({
      host: hostConfig,
      agent: agent.value,
      sourceCommsDir,
      conversationId,
      freshMinutes: freshMinutes.value,
      mode: "refresh",
    });
    const result = run({
      kind: "remote-ready-refresh",
      command: command.command,
      args: command.args,
    });
    routeRefreshApplied = result.ok;
    actions.push({
      name: "windows-route-refresh",
      status: result.ok ? "applied" : "failed",
      message: result.ok
        ? routeHealth?.status === "fresh-route-ready"
          ? "refreshed target-local Windows presence from already fresh live IPC tuple"
          : "refreshed target-local Windows presence from live IPC tuple"
        : failure(result),
      command: command.display,
      stderr: result.stderr.trim() || undefined,
    });
    addCheck(
      checks,
      result.ok ? "pass" : "fail",
      "windows-route-refresh",
      result.ok
        ? "target-local Windows presence refresh completed"
        : failure(result),
    );
    if (sourceEndpoint) {
      const checkCommand = presenceCommand({
        repoRoot,
        sourceEndpoint,
        central,
        agent: agent.value,
        mode: "check",
      });
      presence = parsePresence(
        run({
          kind: "presence-check",
          command: checkCommand.command,
          args: checkCommand.args,
          cwd: checkCommand.cwd,
        }),
      );
    }
  } else if (apply && dryRun && shouldRefreshRoute) {
    actions.push({
      name: "windows-route-refresh",
      status: "would-apply",
      message:
        routeHealth?.status === "fresh-route-ready"
          ? "would refresh target-local Windows presence because scheduler requested a proactive fresh tuple refresh"
          : "would refresh target-local Windows presence because IPC observes a live selected tuple and durable presence is stale",
    });
  } else if (routeHealth?.status) {
    actions.push({
      name: "windows-route-refresh",
      status: "skipped",
      message: `route refresh requires stale-presence${forceFreshRouteRefresh ? " or fresh-route-ready" : ""}; observed ${routeHealth.status}`,
    });
  }

  const shouldPublish = Boolean(
    hostConfig &&
    sourceEndpoint &&
    targetReady(routeHealth) &&
    presence.source?.freshForRouting &&
    (!presence.central?.freshForRouting || routeRefreshApplied),
  );
  if (apply && shouldPublish && sourceEndpoint) {
    const command = presenceCommand({
      repoRoot,
      sourceEndpoint,
      central,
      agent: agent.value,
      mode: "publish",
      dryRun,
    });
    const result = run({
      kind: "presence-publish",
      command: command.command,
      args: command.args,
      cwd: command.cwd,
    });
    const afterPublish = parsePresence(result);
    if (!afterPublish.error && afterPublish.source) presence = afterPublish;
    actions.push({
      name: "presence-publish",
      status: result.ok ? (dryRun ? "would-apply" : "applied") : "failed",
      message: result.ok
        ? dryRun
          ? "would publish only presence/<agent>.json after source freshness verification"
          : "published only presence/<agent>.json after source freshness verification"
        : failure(result),
      command: command.display,
      stdout: result.stdout.trim() || undefined,
      stderr: result.stderr.trim() || undefined,
    });
    addCheck(
      checks,
      result.ok ? (dryRun ? "warn" : "pass") : "fail",
      "presence-publish",
      result.ok
        ? dryRun
          ? "guarded central presence publish was previewed"
          : "guarded central presence publish completed"
        : failure(result),
    );
  } else if (targetReady(routeHealth) && !presence.source?.freshForRouting) {
    actions.push({
      name: "presence-publish",
      status: "skipped",
      message:
        "guarded publish requires source presence to be fresh-for-routing after target-local refresh",
    });
  } else if (targetReady(routeHealth) && presence.central?.freshForRouting) {
    actions.push({
      name: "presence-publish",
      status: "skipped",
      message: "central presence is already fresh-for-routing",
    });
  }

  const centralPresencePath = path.join(
    central,
    "presence",
    `${agent.value}.json`,
  );
  const centralRoute = routeMeta(readJsonFile(centralPresencePath));
  const routeProof = proof({
    central: presence.central,
    route: centralRoute,
    routeHealth,
    activeHosts,
  });
  addCheck(
    checks,
    routeProof.liveAttemptStatus === "would-attempt" ? "pass" : "warn",
    "structured-route-dry-run",
    `transport=${routeProof.transport}, liveAttemptStatus=${routeProof.liveAttemptStatus}, fallbackToInbox=${routeProof.fallbackToInbox}: ${routeProof.reason}`,
  );

  if (resolved.status === "config-drift")
    next.push(
      "reload/restart the tap MCP runtime so active TAP_CODEX_REMOTE_HOSTS matches config.toml",
    );
  if (routeHealth?.status === "active-turn-blocked") {
    next.push(
      "wait for the Windows App active turn to finish before recovery or live delivery",
    );
  } else if (deadRoute(routeHealth)) {
    next.push(
      "open/focus the target Windows App thread and rerun route recovery with the selected conversation id",
    );
  } else if (targetReady(routeHealth) && !presence.source?.freshForRouting) {
    next.push(
      "run with --apply to refresh target-local presence from the observed IPC tuple",
    );
  } else if (
    presence.source?.freshForRouting &&
    !presence.central?.freshForRouting
  ) {
    next.push(
      "run with --apply to guarded-publish only presence/<agent>.json into the central comms directory",
    );
  }
  if (routeProof.liveAttemptStatus === "would-attempt") {
    next.push(
      "structured tap_reply live route should use consent-drive without inbox fallback; still leave durable inbox evidence per Windows App contract",
    );
  }

  if (
    smoke &&
    apply &&
    !dryRun &&
    hostConfig &&
    conversationId &&
    routeProof.liveAttemptStatus === "would-attempt"
  ) {
    const command = readyCommand({
      host: hostConfig,
      agent: agent.value,
      sourceCommsDir,
      conversationId,
      freshMinutes: freshMinutes.value,
      mode: "smoke",
      smokeSubject: smokeSubject ?? "",
      smokeContent: smokeContent ?? "",
    });
    const result = run({
      kind: "remote-ready-smoke",
      command: command.command,
      args: command.args,
    });
    actions.push({
      name: "windows-route-smoke",
      status: result.ok ? "applied" : "failed",
      message: result.ok
        ? "attempted explicit tuple-scoped Windows live smoke through target-local ready command"
        : failure(result),
      command: command.display,
      stdout: result.stdout.trim() || undefined,
      stderr: result.stderr.trim() || undefined,
    });
  } else if (smoke) {
    actions.push({
      name: "windows-route-smoke",
      status: "skipped",
      message:
        "smoke requires --apply without --dry-run and a structured route proof of would-attempt",
    });
  }

  const classification = classify({
    host: resolved,
    source: presence.source,
    central: presence.central,
    routeHealth,
    proof: routeProof,
  });
  const status = statusFor(classification, apply, dryRun, routeProof, actions);
  const report: RecoverReport = {
    generatedAt: new Date().toISOString(),
    profile: "windows-app-sol",
    agent: agent.value,
    status,
    classification,
    apply: { enabled: apply, dryRun },
    host: {
      requestedHost: resolved.requestedHost,
      matchedHostKey: resolved.matchedHostKey,
      matchedHostId: resolved.matchedHostId,
      sshTarget: hostConfig?.sshTarget ?? null,
      platformDir: hostConfig?.platformDir ?? null,
      commsDir: hostConfig?.commsDir ?? null,
      sourceEndpoint,
      configSource: resolved.configSource,
      status: resolved.status,
      message: resolved.message,
    },
    central: {
      commsDir: central,
      presencePath: centralPresencePath,
      route: centralRoute,
    },
    presence,
    targetLocal: {
      attempted: Boolean(hostConfig && conversationId),
      ok: targetReady(routeHealth),
      command: readyDisplay,
      routeHealth,
      message:
        routeHealth?.message ??
        "target-local ready command did not produce route health",
    },
    routeDryRunProof: routeProof,
    checks,
    actions,
    next,
  };

  logReport(report);
  return {
    ok: status === "ready" || status === "recovered",
    command: "windows-route-recover",
    code:
      status === "ready" || status === "recovered"
        ? "TAP_WINDOWS_ROUTE_RECOVER_OK"
        : "TAP_WINDOWS_ROUTE_RECOVER_BLOCKED",
    message: `windows route recovery: ${status} (${classification})`,
    warnings: warnings(checks),
    data: report,
  };
}
