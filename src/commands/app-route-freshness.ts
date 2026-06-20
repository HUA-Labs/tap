import * as fs from "node:fs";
import * as path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { resolveConfig } from "../config/index.js";
import type { CommandResult } from "../types.js";
import {
  findRepoRoot,
  log,
  logHeader,
  parseArgs,
  resolveCommsDir,
} from "../utils.js";
import { windowsRouteRecoverCommand } from "./windows-route-recover.js";

const HELP = `
Usage:
  tap app-route-freshness [--agent agent-a] [--apply] [--watch] [--json]

Description:
  Keep a Codex App consent-drive route fresh before durable presence TTL expiry.
  This uses the guarded Windows route recovery primitive for target-local IPC
  observation, selected
  presence refresh, and configured-SSOT publish.

Options:
  --agent <name>              App route agent. Default: agent-a.
  --fresh-minutes <n>         Durable presence freshness window. Default: 30.
  --threshold-ratio <n>       Refresh when route age reaches this share of TTL. Default: 0.75.
  --apply                    Refresh/publish when the guarded plan is due.
  --dry-run                  Preview an apply without mutating target or central presence.
  --watch                    Run as a standing worker with a lock.
  --interval-seconds <n>      Watch interval. Default: 600.
  --max-iterations <n>        Stop watch after n iterations; useful for supervisors/tests.
  --state-dir <path>          Override tap state directory for scheduler state.
  --central <path>            Override configured central/SSOT comms directory.
  --comms-dir <path>          Alias used by shared tap comms resolution.
  --source-host <host>        Source host alias passed to windows-route-recover.
  --source-comms-dir <path>   Source-local Windows comms dir passed through.
  --source-platform-dir <p>   Source-local Windows repo dir passed through.
  --conversation-id <id>      Selected Codex App conversation id.
  --remote-hosts <json>       Active remote host map.
  --codex-config <path>       Codex config path for configured remote host map.
  --help                     Show help.
`.trim();

type FreshnessClass =
  | "fresh-ready"
  | "refresh-soon"
  | "ttl-expired-target-ready"
  | "active-turn-blocked"
  | "target-missing-or-dead"
  | "host-unresolved"
  | "remote-host-config-drift"
  | "worker-conflict"
  | "structured-route-not-ready";

type FreshnessStatus = "ready" | "needs-refresh" | "refreshed" | "blocked";
type WorkerStatus = "not-requested" | "acquired" | "conflict" | "released";

type RecoveryRunner = (
  args: string[],
) => Promise<CommandResult<Record<string, unknown>>>;

interface FreshnessPolicy {
  freshMinutes: number;
  thresholdRatio: number;
  thresholdSeconds: number;
  routeAgeSeconds: number | null;
  routeAgeRatio: number | null;
  refreshDue: boolean;
  nextRefreshAt: string | null;
}

interface FreshnessReport extends Record<string, unknown> {
  generatedAt: string;
  profile: string;
  agent: string;
  status: FreshnessStatus;
  classification: FreshnessClass;
  apply: { enabled: boolean; dryRun: boolean };
  watch: {
    enabled: boolean;
    intervalSeconds: number | null;
    iteration: number | null;
    maxIterations: number | null;
  };
  policy: FreshnessPolicy;
  source: {
    host: string | null;
    status: string | null;
    endpoint: string | null;
    configuredHostDrift: boolean;
  };
  recovery: {
    status: string | null;
    classification: string | null;
    routeHealthStatus: string | null;
    proof: Record<string, unknown> | null;
    applied: boolean;
    ok: boolean;
  };
  worker: {
    enabled: boolean;
    lockPath: string | null;
    status: WorkerStatus;
    owner: Record<string, unknown> | null;
    message: string;
  };
  state: {
    path: string;
    lastRefreshAt: string | null;
    lastBlockedReason: string | null;
  };
  checks: Array<{
    name: string;
    status: "pass" | "warn" | "fail" | "block";
    message: string;
  }>;
  actions: Array<{ name: string; status: string; message: string }>;
  next: string[];
}

interface ParsedOptions {
  agent: string;
  freshMinutes: number;
  thresholdRatio: number;
  intervalSeconds: number;
  maxIterations: number | null;
  staleWorkerSeconds: number;
  apply: boolean;
  dryRun: boolean;
  watch: boolean;
  central: string;
  stateDir: string;
  passthroughFlags: Record<string, string>;
}

interface RecoverySnapshot {
  result: CommandResult<Record<string, unknown>>;
  data: Record<string, unknown>;
  classification: string | null;
  status: string | null;
  hostStatus: string | null;
  sourceHost: string | null;
  sourceEndpoint: string | null;
  routeHealthStatus: string | null;
  routeHealthMessage: string | null;
  routeAgeSeconds: number | null;
  proof: Record<string, unknown> | null;
  proofLiveAttemptStatus: string | null;
  proofTransport: string | null;
  proofFallbackToInbox: boolean | null;
}

let recoveryRunnerForTests: RecoveryRunner | null = null;

export function __setAppRouteFreshnessRecoveryRunnerForTests(
  runner: RecoveryRunner | null,
): void {
  recoveryRunnerForTests = runner;
}

function rec(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function bool(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function stringFlag(
  value: string | boolean | undefined,
  fallback: string | null,
  name: string,
): { ok: true; value: string } | { ok: false; message: string } {
  if (value === undefined) {
    if (fallback != null) return { ok: true, value: fallback };
    return { ok: false, message: `Missing ${name}.` };
  }
  if (typeof value !== "string" || !value.trim()) {
    return { ok: false, message: `Invalid ${name}: expected a value.` };
  }
  return { ok: true, value: value.trim() };
}

function positiveIntegerFlag(
  value: string | boolean | undefined,
  fallback: number | null,
  name: string,
): { ok: true; value: number } | { ok: false; message: string } {
  if (value === undefined) {
    if (fallback != null) return { ok: true, value: fallback };
    return { ok: false, message: `Missing ${name}.` };
  }
  if (typeof value !== "string") {
    return { ok: false, message: `Invalid ${name}: expected a value.` };
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return {
      ok: false,
      message: `Invalid ${name}: must be a positive integer.`,
    };
  }
  return { ok: true, value: parsed };
}

function optionalPositiveIntegerFlag(
  value: string | boolean | undefined,
  name: string,
): { ok: true; value: number | null } | { ok: false; message: string } {
  if (value === undefined) return { ok: true, value: null };
  const parsed = positiveIntegerFlag(value, null, name);
  if (!parsed.ok) return parsed;
  return { ok: true, value: parsed.value };
}

function ratioFlag(
  value: string | boolean | undefined,
  fallback: number,
  name: string,
): { ok: true; value: number } | { ok: false; message: string } {
  if (value === undefined) return { ok: true, value: fallback };
  if (typeof value !== "string") {
    return { ok: false, message: `Invalid ${name}: expected a value.` };
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed >= 1) {
    return {
      ok: false,
      message: `Invalid ${name}: must be greater than 0 and less than 1.`,
    };
  }
  return { ok: true, value: parsed };
}

function invalid(message: string): CommandResult<FreshnessReport> {
  return {
    ok: false,
    command: "app-route-freshness",
    code: "TAP_INVALID_ARGUMENT",
    message,
    warnings: [message],
    data: {} as FreshnessReport,
  };
}

function profileId(agent: string): string {
  return `windows-app-${safeAgentLabel(agent)}`;
}

function safeAgentLabel(agent: string): string {
  const safe = agent
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}_-]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return safe || "agent";
}

function statePathFor(options: ParsedOptions): string {
  return path.join(
    options.stateDir,
    "app-route-freshness",
    `windows-app-${safeAgentLabel(options.agent)}.json`,
  );
}

function lockPathFor(options: ParsedOptions): string {
  return path.join(
    options.stateDir,
    "app-route-freshness",
    `windows-app-${safeAgentLabel(options.agent)}.lock.json`,
  );
}

function resolveStateDir(
  value: string | boolean | undefined,
  repoRoot: string,
): { ok: true; value: string } | { ok: false; message: string } {
  if (value !== undefined) {
    if (typeof value !== "string" || !value.trim()) {
      return { ok: false, message: "Invalid --state-dir: expected a value." };
    }
    return { ok: true, value: path.resolve(value.trim()) };
  }
  const envStateDir = process.env.TAP_APP_ROUTE_FRESHNESS_STATE_DIR;
  if (envStateDir?.trim())
    return { ok: true, value: path.resolve(envStateDir) };
  return { ok: true, value: resolveConfig({}, repoRoot).config.stateDir };
}

function collectPassthroughFlags(
  flags: Record<string, string | boolean>,
): Record<string, string> {
  const names = [
    "source-host",
    "source-comms-dir",
    "source-platform-dir",
    "conversation-id",
    "remote-hosts",
    "codex-config",
  ];
  const values: Record<string, string> = {};
  for (const name of names) {
    const value = flags[name];
    if (typeof value === "string" && value.trim()) values[name] = value.trim();
  }
  return values;
}

function parseOptions(
  args: string[],
): ParsedOptions | CommandResult<FreshnessReport> {
  const parsed = parseArgs(args);
  const agent = stringFlag(parsed.flags.agent, "agent-a", "--agent");
  if (!agent.ok) return invalid(agent.message);
  const freshMinutes = positiveIntegerFlag(
    parsed.flags["fresh-minutes"],
    30,
    "--fresh-minutes",
  );
  if (!freshMinutes.ok) return invalid(freshMinutes.message);
  const thresholdRatio = ratioFlag(
    parsed.flags["threshold-ratio"],
    0.75,
    "--threshold-ratio",
  );
  if (!thresholdRatio.ok) return invalid(thresholdRatio.message);
  const intervalSeconds = positiveIntegerFlag(
    parsed.flags["interval-seconds"],
    600,
    "--interval-seconds",
  );
  if (!intervalSeconds.ok) return invalid(intervalSeconds.message);
  const maxIterations = optionalPositiveIntegerFlag(
    parsed.flags["max-iterations"],
    "--max-iterations",
  );
  if (!maxIterations.ok) return invalid(maxIterations.message);
  const staleWorkerSeconds = positiveIntegerFlag(
    parsed.flags["worker-stale-seconds"],
    Math.max(60, intervalSeconds.value * 3),
    "--worker-stale-seconds",
  );
  if (!staleWorkerSeconds.ok) return invalid(staleWorkerSeconds.message);

  const repoRoot = findRepoRoot();
  const stateDir = resolveStateDir(parsed.flags["state-dir"], repoRoot);
  if (!stateDir.ok) return invalid(stateDir.message);
  const central = path.resolve(
    str(parsed.flags.central) ?? resolveCommsDir(args, repoRoot),
  );
  const apply = parsed.flags.apply === true;

  return {
    agent: agent.value,
    freshMinutes: freshMinutes.value,
    thresholdRatio: thresholdRatio.value,
    intervalSeconds: intervalSeconds.value,
    maxIterations: maxIterations.value,
    staleWorkerSeconds: staleWorkerSeconds.value,
    apply,
    dryRun: !apply || parsed.flags["dry-run"] === true,
    watch: parsed.flags.watch === true,
    central,
    stateDir: stateDir.value,
    passthroughFlags: collectPassthroughFlags(parsed.flags),
  };
}

function buildRecoveryArgs(
  options: ParsedOptions,
  applyOptions: {
    apply: boolean;
    dryRun: boolean;
    forceFreshRouteRefresh?: boolean;
  },
): string[] {
  const args = [
    "--agent",
    options.agent,
    "--fresh-minutes",
    String(options.freshMinutes),
    "--central",
    options.central,
  ];
  for (const [name, value] of Object.entries(options.passthroughFlags)) {
    args.push(`--${name}`, value);
  }
  if (applyOptions.apply) args.push("--apply");
  if (applyOptions.dryRun) args.push("--dry-run");
  if (applyOptions.forceFreshRouteRefresh) {
    args.push("--force-fresh-route-refresh");
  }
  return args;
}

async function runRecovery(
  args: string[],
): Promise<CommandResult<Record<string, unknown>>> {
  if (recoveryRunnerForTests) return recoveryRunnerForTests(args);
  return windowsRouteRecoverCommand(args) as Promise<
    CommandResult<Record<string, unknown>>
  >;
}

function ageFromPresence(
  presence: Record<string, unknown> | null,
): number | null {
  return finiteNumber(presence?.ageSeconds);
}

function snapshotFromRecovery(
  result: CommandResult<Record<string, unknown>>,
): RecoverySnapshot {
  const data = rec(result.data) ?? {};
  const host = rec(data.host);
  const presence = rec(data.presence);
  const sourcePresence = rec(presence?.source);
  const centralPresence = rec(presence?.central);
  const targetLocal = rec(data.targetLocal);
  const routeHealth = rec(targetLocal?.routeHealth);
  const proof = rec(data.routeDryRunProof);
  const centralAgeSeconds = ageFromPresence(centralPresence);
  const sourceAgeSeconds = ageFromPresence(sourcePresence);
  const routeHealthAge = finiteNumber(routeHealth?.presenceAgeMinutes);
  const routeAgeSeconds =
    centralAgeSeconds ??
    sourceAgeSeconds ??
    (routeHealthAge === null ? null : routeHealthAge * 60);

  return {
    result,
    data,
    classification: str(data.classification),
    status: str(data.status),
    hostStatus: str(host?.status),
    sourceHost: str(host?.sshTarget) ?? str(host?.requestedHost),
    sourceEndpoint: str(host?.sourceEndpoint),
    routeHealthStatus: str(routeHealth?.status),
    routeHealthMessage: str(routeHealth?.message),
    routeAgeSeconds,
    proof,
    proofLiveAttemptStatus: str(proof?.liveAttemptStatus),
    proofTransport: str(proof?.transport),
    proofFallbackToInbox: bool(proof?.fallbackToInbox),
  };
}

function buildPolicy(
  snapshot: RecoverySnapshot,
  options: ParsedOptions,
  now: Date,
): FreshnessPolicy {
  const freshSeconds = options.freshMinutes * 60;
  const thresholdSeconds = Math.floor(freshSeconds * options.thresholdRatio);
  const routeAgeSeconds = snapshot.routeAgeSeconds;
  const routeAgeRatio =
    routeAgeSeconds === null
      ? null
      : Math.min(routeAgeSeconds / freshSeconds, 99);
  const refreshDue =
    routeAgeSeconds !== null && routeAgeSeconds >= thresholdSeconds;
  const nextRefreshAt =
    routeAgeSeconds === null
      ? null
      : new Date(
          now.getTime() +
            Math.max(0, thresholdSeconds - routeAgeSeconds) * 1000,
        ).toISOString();

  return {
    freshMinutes: options.freshMinutes,
    thresholdRatio: options.thresholdRatio,
    thresholdSeconds,
    routeAgeSeconds,
    routeAgeRatio,
    refreshDue,
    nextRefreshAt,
  };
}

function targetMissingClassification(value: string | null): boolean {
  return (
    value === "target-missing-or-dead" ||
    value === "target-unavailable" ||
    value === "target-local-unavailable"
  );
}

function targetReadyNeedsRefreshClassification(value: string | null): boolean {
  return (
    value === "ttl-expired-target-ready" ||
    value === "source-presence-missing-target-ready" ||
    value === "central-publish-needed"
  );
}

function classifySnapshot(
  snapshot: RecoverySnapshot,
  policy: FreshnessPolicy,
): FreshnessClass {
  if (snapshot.hostStatus === "unresolved") return "host-unresolved";
  if (
    snapshot.hostStatus === "config-drift" ||
    snapshot.classification === "remote-host-config-drift"
  ) {
    return "remote-host-config-drift";
  }
  if (
    snapshot.routeHealthStatus === "active-turn-blocked" ||
    snapshot.classification === "active-turn-blocked"
  ) {
    return "active-turn-blocked";
  }
  if (targetMissingClassification(snapshot.classification)) {
    return "target-missing-or-dead";
  }
  if (targetReadyNeedsRefreshClassification(snapshot.classification)) {
    return "ttl-expired-target-ready";
  }
  if (
    snapshot.routeHealthStatus === "stale-presence" &&
    snapshot.proofLiveAttemptStatus === "not-attempted"
  ) {
    return "ttl-expired-target-ready";
  }
  if (
    snapshot.proofTransport === "consent-drive" &&
    snapshot.proofLiveAttemptStatus === "would-attempt" &&
    snapshot.proofFallbackToInbox === false
  ) {
    return policy.refreshDue ? "refresh-soon" : "fresh-ready";
  }
  return "structured-route-not-ready";
}

function statusForClass(classification: FreshnessClass): FreshnessStatus {
  if (classification === "fresh-ready") return "ready";
  if (
    classification === "refresh-soon" ||
    classification === "ttl-expired-target-ready"
  ) {
    return "needs-refresh";
  }
  return "blocked";
}

function buildChecks(
  classification: FreshnessClass,
  policy: FreshnessPolicy,
  snapshot: RecoverySnapshot,
): FreshnessReport["checks"] {
  return [
    {
      name: "source-host",
      status:
        classification === "host-unresolved" ||
        classification === "remote-host-config-drift"
          ? "block"
          : "pass",
      message: snapshot.sourceHost
        ? `source host ${snapshot.sourceHost} status=${snapshot.hostStatus ?? "unknown"}`
        : `source host status=${snapshot.hostStatus ?? "unknown"}`,
    },
    {
      name: "target-local-ipc",
      status:
        classification === "active-turn-blocked"
          ? "block"
          : snapshot.routeHealthStatus === "fresh-route-ready" ||
              snapshot.routeHealthStatus === "stale-presence"
            ? "pass"
            : "fail",
      message:
        snapshot.routeHealthMessage ??
        `routeHealth=${snapshot.routeHealthStatus ?? "unknown"}`,
    },
    {
      name: "route-age-threshold",
      status: policy.refreshDue ? "warn" : "pass",
      message:
        policy.routeAgeSeconds === null
          ? "route age not observed"
          : `route age is ${policy.routeAgeSeconds.toFixed(1)}s; refresh threshold=${policy.thresholdSeconds}s`,
    },
    {
      name: "structured-proof",
      status:
        snapshot.proofTransport === "consent-drive" &&
        snapshot.proofLiveAttemptStatus === "would-attempt" &&
        snapshot.proofFallbackToInbox === false
          ? "pass"
          : "fail",
      message: `transport=${snapshot.proofTransport ?? "unknown"} liveAttemptStatus=${snapshot.proofLiveAttemptStatus ?? "unknown"} fallbackToInbox=${snapshot.proofFallbackToInbox ?? "unknown"}`,
    },
  ];
}

function nextActionsFor(
  classification: FreshnessClass,
  options: ParsedOptions,
): string[] {
  if (classification === "fresh-ready") {
    return [
      "no action: App route is fresh and structured consent-drive proof is ready",
    ];
  }
  if (classification === "refresh-soon") {
    return [
      `run tap app-route-freshness --agent ${options.agent} --apply --json before TTL expiry`,
    ];
  }
  if (classification === "ttl-expired-target-ready") {
    return [
      `run tap app-route-freshness --agent ${options.agent} --apply --json to refresh target-local presence and publish selected central presence`,
    ];
  }
  if (classification === "active-turn-blocked") {
    return [
      "wait for the active Windows App turn to finish before refreshing durable route evidence",
    ];
  }
  if (classification === "host-unresolved") {
    return [
      "repair source host aliases/config so Windows App host resolves before freshness apply",
    ];
  }
  if (classification === "remote-host-config-drift") {
    return [
      "reload/restart tap runtime so active remote host config matches configured aliases",
    ];
  }
  if (classification === "worker-conflict") {
    return [
      "stop the duplicate app-route-freshness worker or wait for the stale worker lock to expire",
    ];
  }
  return [
    `inspect tap windows-route-recover --agent ${options.agent} --json for target-local route details`,
  ];
}

function readPreviousState(statePath: string): Record<string, unknown> | null {
  try {
    if (!fs.existsSync(statePath)) return null;
    return JSON.parse(fs.readFileSync(statePath, "utf8")) as Record<
      string,
      unknown
    >;
  } catch {
    return null;
  }
}

function writeJsonAtomic(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp.${process.pid}.${Date.now()}`;
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(value, null, 2), "utf8");
    fs.renameSync(tmpPath, filePath);
  } catch (error) {
    try {
      fs.rmSync(tmpPath, { force: true });
    } catch {
      // Best-effort cleanup; the previous scheduler state is untouched.
    }
    throw error;
  }
}

function writeState(report: FreshnessReport): void {
  const previous = readPreviousState(report.state.path);
  const lastRefreshAt =
    report.status === "refreshed"
      ? report.generatedAt
      : (str(previous?.lastRefreshAt) ?? report.state.lastRefreshAt);
  const lastBlockedReason =
    report.status === "blocked"
      ? (report.checks.find(
          (check) => check.status === "block" || check.status === "fail",
        )?.message ?? report.classification)
      : null;

  writeJsonAtomic(report.state.path, {
    schemaVersion: 1,
    profile: report.profile,
    agent: report.agent,
    updatedAt: report.generatedAt,
    lastRunAt: report.generatedAt,
    lastStatus: report.status,
    lastClassification: report.classification,
    lastRefreshAt,
    lastBlockedReason,
    routeAgeSeconds: report.policy.routeAgeSeconds,
    routeAgeRatio: report.policy.routeAgeRatio,
    thresholdRatio: report.policy.thresholdRatio,
    nextRefreshAt: report.policy.nextRefreshAt,
    sourceHost: report.source.host,
    sourceHostStatus: report.source.status,
    configuredHostDrift: report.source.configuredHostDrift,
    nextAction: report.next[0] ?? null,
    worker: report.worker,
    recovery: report.recovery,
  });
  report.state.lastRefreshAt = lastRefreshAt;
  report.state.lastBlockedReason = lastBlockedReason;
}

function buildReport(options: {
  options: ParsedOptions;
  snapshot: RecoverySnapshot;
  policy: FreshnessPolicy;
  classification: FreshnessClass;
  status: FreshnessStatus;
  workerStatus: WorkerStatus;
  workerLockPath: string | null;
  workerOwner: Record<string, unknown> | null;
  workerMessage: string;
  iteration: number | null;
  applied: boolean;
  now: Date;
  actions: FreshnessReport["actions"];
}): FreshnessReport {
  const statePath = statePathFor(options.options);
  const previous = readPreviousState(statePath);
  const checks = buildChecks(
    options.classification,
    options.policy,
    options.snapshot,
  );
  const next = nextActionsFor(options.classification, options.options);
  return {
    generatedAt: options.now.toISOString(),
    profile: profileId(options.options.agent),
    agent: options.options.agent,
    status: options.status,
    classification: options.classification,
    apply: { enabled: options.options.apply, dryRun: options.options.dryRun },
    watch: {
      enabled: options.options.watch,
      intervalSeconds: options.options.watch
        ? options.options.intervalSeconds
        : null,
      iteration: options.iteration,
      maxIterations: options.options.maxIterations,
    },
    policy: options.policy,
    source: {
      host: options.snapshot.sourceHost,
      status: options.snapshot.hostStatus,
      endpoint: options.snapshot.sourceEndpoint,
      configuredHostDrift:
        options.classification === "remote-host-config-drift" ||
        options.snapshot.hostStatus === "config-drift",
    },
    recovery: {
      status: options.snapshot.status,
      classification: options.snapshot.classification,
      routeHealthStatus: options.snapshot.routeHealthStatus,
      proof: options.snapshot.proof,
      applied: options.applied,
      ok: options.snapshot.result.ok,
    },
    worker: {
      enabled: options.options.watch,
      lockPath: options.workerLockPath,
      status: options.workerStatus,
      owner: options.workerOwner,
      message: options.workerMessage,
    },
    state: {
      path: statePath,
      lastRefreshAt: str(previous?.lastRefreshAt),
      lastBlockedReason: str(previous?.lastBlockedReason),
    },
    checks,
    actions: options.actions,
    next,
  };
}

function logReport(report: FreshnessReport): void {
  logHeader("tap app-route-freshness");
  log(`Status: ${report.status}`);
  log(`Classification: ${report.classification}`);
  log(
    `Route age: ${
      report.policy.routeAgeSeconds === null
        ? "unknown"
        : `${report.policy.routeAgeSeconds.toFixed(1)}s`
    } threshold=${report.policy.thresholdSeconds}s`,
  );
  log(
    `Proof: transport=${String(
      report.recovery.proof?.transport ?? "unknown",
    )} liveAttemptStatus=${String(
      report.recovery.proof?.liveAttemptStatus ?? "unknown",
    )} fallbackToInbox=${String(
      report.recovery.proof?.fallbackToInbox ?? "unknown",
    )}`,
  );
  const firstProblem = report.checks.find(
    (check) =>
      check.status === "block" ||
      check.status === "fail" ||
      check.status === "warn",
  );
  if (firstProblem)
    log(`${firstProblem.status} ${firstProblem.name}: ${firstProblem.message}`);
  for (const item of report.next.slice(0, 4)) log(`next: ${item}`);
}

async function runFreshnessOnce(
  options: ParsedOptions,
  worker: {
    status: WorkerStatus;
    lockPath: string | null;
    owner: Record<string, unknown> | null;
    message: string;
  },
  iteration: number | null,
): Promise<CommandResult<FreshnessReport>> {
  const observed = snapshotFromRecovery(
    await runRecovery(
      buildRecoveryArgs(options, {
        apply: false,
        dryRun: true,
      }),
    ),
  );
  const observedPolicy = buildPolicy(observed, options, new Date());
  const observedClass = classifySnapshot(observed, observedPolicy);
  const actions: FreshnessReport["actions"] = [
    {
      name: "route-freshness-status",
      status: "observed",
      message: `observed ${observed.classification ?? "unknown"} via windows-route-recover`,
    },
  ];

  let snapshot = observed;
  let policy = observedPolicy;
  let classification = observedClass;
  let applied = false;

  if (
    options.apply &&
    (observedClass === "refresh-soon" ||
      observedClass === "ttl-expired-target-ready")
  ) {
    actions.push({
      name: "route-freshness-apply",
      status: options.dryRun ? "would-apply" : "requested",
      message:
        observedClass === "refresh-soon"
          ? "proactive refresh requested before TTL expiry"
          : "TTL-expired but target-ready route recovery requested",
    });
    snapshot = snapshotFromRecovery(
      await runRecovery(
        buildRecoveryArgs(options, {
          apply: true,
          dryRun: options.dryRun,
          forceFreshRouteRefresh: observedClass === "refresh-soon",
        }),
      ),
    );
    policy = buildPolicy(snapshot, options, new Date());
    classification = classifySnapshot(snapshot, policy);
    applied =
      !options.dryRun && snapshot.result.ok && classification === "fresh-ready";
    actions.push({
      name: "route-freshness-apply-result",
      status: snapshot.result.ok
        ? options.dryRun
          ? "previewed"
          : "applied"
        : "failed",
      message: snapshot.result.message,
    });
  } else if (options.apply) {
    actions.push({
      name: "route-freshness-apply",
      status: "skipped",
      message: `apply requires refresh-soon or ttl-expired-target-ready; observed ${observedClass}`,
    });
  }

  const status = applied ? "refreshed" : statusForClass(classification);
  const report = buildReport({
    options,
    snapshot,
    policy,
    classification,
    status,
    workerStatus: worker.status,
    workerLockPath: worker.lockPath,
    workerOwner: worker.owner,
    workerMessage: worker.message,
    iteration,
    applied,
    now: new Date(),
    actions,
  });
  writeState(report);
  logReport(report);

  const blocked = status === "blocked";
  return {
    ok: !blocked,
    command: "app-route-freshness",
    code: blocked
      ? "TAP_APP_ROUTE_FRESHNESS_BLOCKED"
      : "TAP_APP_ROUTE_FRESHNESS_OK",
    message: `tap app-route-freshness: ${status} (${classification})`,
    warnings: report.checks
      .filter(
        (check) =>
          check.status === "warn" ||
          check.status === "fail" ||
          check.status === "block",
      )
      .map((check) => `${check.name}: ${check.message}`),
    data: report,
  };
}

function lockAgeSeconds(owner: Record<string, unknown> | null): number | null {
  const startedAt = str(owner?.startedAt);
  if (!startedAt) return null;
  const parsed = Date.parse(startedAt);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, (Date.now() - parsed) / 1000);
}

function readLockOwner(lockPath: string): Record<string, unknown> | null {
  try {
    return JSON.parse(fs.readFileSync(lockPath, "utf8")) as Record<
      string,
      unknown
    >;
  } catch {
    return null;
  }
}

function acquireWorkerLock(options: ParsedOptions):
  | { acquired: true; lockPath: string; owner: Record<string, unknown> }
  | {
      acquired: false;
      lockPath: string;
      owner: Record<string, unknown> | null;
      message: string;
    } {
  const lockPath = lockPathFor(options);
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  const owner = {
    pid: process.pid,
    agent: options.agent,
    profile: profileId(options.agent),
    startedAt: new Date().toISOString(),
  };

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const fd = fs.openSync(lockPath, "wx");
      try {
        fs.writeFileSync(fd, JSON.stringify(owner, null, 2), "utf8");
      } finally {
        fs.closeSync(fd);
      }
      return { acquired: true, lockPath, owner };
    } catch (error) {
      const existing = readLockOwner(lockPath);
      const age = lockAgeSeconds(existing);
      if (attempt === 0 && age !== null && age > options.staleWorkerSeconds) {
        fs.rmSync(lockPath, { force: true });
        continue;
      }
      return {
        acquired: false,
        lockPath,
        owner: existing,
        message:
          error instanceof Error
            ? error.message
            : "another app-route-freshness worker already owns the route",
      };
    }
  }

  return {
    acquired: false,
    lockPath,
    owner: readLockOwner(lockPath),
    message: "another app-route-freshness worker already owns the route",
  };
}

function workerConflictResult(
  options: ParsedOptions,
  lock: {
    lockPath: string;
    owner: Record<string, unknown> | null;
    message: string;
  },
): CommandResult<FreshnessReport> {
  const now = new Date();
  const emptyResult: CommandResult<Record<string, unknown>> = {
    ok: false,
    command: "windows-route-recover",
    code: "TAP_WINDOWS_ROUTE_RECOVER_BLOCKED",
    message: lock.message,
    warnings: [lock.message],
    data: {},
  };
  const snapshot = snapshotFromRecovery(emptyResult);
  const policy = buildPolicy(snapshot, options, now);
  const report = buildReport({
    options,
    snapshot,
    policy,
    classification: "worker-conflict",
    status: "blocked",
    workerStatus: "conflict",
    workerLockPath: lock.lockPath,
    workerOwner: lock.owner,
    workerMessage: lock.message,
    iteration: null,
    applied: false,
    now,
    actions: [
      {
        name: "worker-of-record",
        status: "blocked",
        message: "another app-route-freshness worker lock is present",
      },
    ],
  });
  logReport(report);
  return {
    ok: false,
    command: "app-route-freshness",
    code: "TAP_APP_ROUTE_FRESHNESS_BLOCKED",
    message: "tap app-route-freshness: blocked (worker-conflict)",
    warnings: [lock.message],
    data: report,
  };
}

async function runWatch(
  options: ParsedOptions,
): Promise<CommandResult<FreshnessReport>> {
  const lock = acquireWorkerLock(options);
  if (!lock.acquired) return workerConflictResult(options, lock);

  let last: CommandResult<FreshnessReport> | null = null;
  try {
    let iteration = 0;
    while (true) {
      iteration += 1;
      last = await runFreshnessOnce(
        options,
        {
          status: "acquired",
          lockPath: lock.lockPath,
          owner: lock.owner,
          message: "worker-of-record lock acquired",
        },
        iteration,
      );
      if (options.maxIterations !== null && iteration >= options.maxIterations)
        break;
      await sleep(options.intervalSeconds * 1000);
    }
  } finally {
    try {
      fs.rmSync(lock.lockPath, { force: true });
    } catch {
      // Best-effort lock cleanup; stale-lock protection handles abnormal exits.
    }
  }

  if (last) {
    last.data.worker.status = "released";
    last.data.worker.message = "worker-of-record lock released";
    writeState(last.data);
    return last;
  }
  return workerConflictResult(options, {
    lockPath: lock.lockPath,
    owner: lock.owner,
    message: "watch exited before any freshness iteration ran",
  });
}

export async function appRouteFreshnessCommand(
  args: string[],
): Promise<CommandResult<FreshnessReport>> {
  if (args.includes("--help") || args.includes("-h")) {
    log(HELP);
    return {
      ok: true,
      command: "app-route-freshness",
      code: "TAP_NO_OP",
      message: HELP,
      warnings: [],
      data: {} as FreshnessReport,
    };
  }

  const options = parseOptions(args);
  if ("ok" in options) return options;

  if (options.watch) return runWatch(options);
  return runFreshnessOnce(
    options,
    {
      status: "not-requested",
      lockPath: null,
      owner: null,
      message: "watch worker lock not requested",
    },
    null,
  );
}
