import * as fs from "node:fs";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { resolveConfig } from "../config/index.js";
import {
  findRepoRoot,
  log,
  logHeader,
  parseArgs,
  resolveCommsDir as resolveCommsDirFromArgs,
} from "../utils.js";
import { resolvePresenceRecord } from "../presence-lookup.js";
import type { CommandResult } from "../types.js";
import {
  formatRemotePanelUrlHost,
  isAllowedRemotePanelBindHost,
  isRemotePanelSendTokenReady,
} from "./remote-panel.js";
import {
  applyCodexPermissions,
  probeCodexPermissionProfile,
  type CodexPermissionProfileProbe,
} from "../permissions.js";
import {
  probeCodexCliLoadedThreadReadiness,
  type CodexCliLoadedThreadReadiness,
  type ProbeCodexCliLoadedThreadReadinessOptions,
} from "../receiver/codex-cli-loaded-thread-readiness.js";
import {
  probeWindowsAppRouteHealth,
  type ProbeWindowsAppRouteHealthOptions,
  type WindowsAppRouteHealth,
} from "../routing/windows-app-route-health.js";
import {
  applyWindowsRoutePresenceRefresh,
  runWindowsRouteSmokeApply,
  type PresenceRecord,
} from "./ready-windows-route.js";
import {
  buildHeadlessRunnerStartCommand,
  buildHeadlessRunnerStopCommand,
  buildLoadedThreadAttachSessionName,
  parseReadyProfile,
  supportsHeadlessRunnerProfile,
  supportsLoadedThreadProfile,
  type ReadyProfileConfig,
  type ReadyProfileId,
} from "./ready-profiles.js";
import { findReadyProfileInProfilePack } from "./profile-pack-loader.js";

export { __setWindowsAppRouteSmokeTransportFactoryForTests } from "./ready-windows-route.js";

const READY_HELP = `
Usage:
  tap ready --surface <codex-cli|codex-app|windows-app|claude|remote-panel> --agent <name> [options]
  tap ready --profile <profile-id> [--apply] [--dry-run]

Description:
  Report post-tap_set_name readiness for a runtime surface. This command does
  not choose or rename the agent identity; call tap_set_name from the target
  runtime first.

Options:
  --surface <name>            Runtime surface to prepare/diagnose.
  --agent <name>              Active agent display/routing name.
  --profile <name>            Reviewed local ready profile id.
  --profile-pack <path>       Load reviewed local ready profile data from a profile pack.
  --conversation-id <id>      Codex App conversation/thread id for owner discovery.
  --apply                     Apply safe local setup steps for this surface.
  --dry-run                   With --apply, report setup steps without writing.
  --require-supervisor        Require a receiver supervisor tmux session for CLI readiness.
  --receiver-session <name>   tmux session name to check when --require-supervisor is set.
  --panel-host <host>         Remote panel bind host. Default: 127.0.0.1.
  --panel-port <n>            Remote panel port. Default: 8765.
  --send-enabled              Diagnose token-gated append-only remote panel send mode.
  --token-env <name>          Token env var required with --send-enabled.
  --require-headless-runner   Require a standing headless runner for Codex CLI profiles.
  --headless-session <name>   tmux session name to check for --require-headless-runner.
  --apply-headless-runner     With --apply, start/recover a supported standing headless runner profile.
  --check-loaded-thread       For known CLI/TUI profiles, probe app-server loaded-thread readiness.
  --app-server-url <url>      App-server URL for --check-loaded-thread. Default: ws://127.0.0.1:35089.
  --thread-id <id>            Optional exact thread id for --check-loaded-thread.
  --apply-loaded-thread-attach
                              With --apply, start/recover a bounded visible TUI attach session when no loaded thread is present. Use --dry-run to preview.
  --apply-windows-route-refresh
                              With --apply, refresh Windows App durable presence from a selected live conversation tuple. Use --dry-run to preview.
  --apply-windows-route-smoke
                              With --apply, send a tuple-scoped Windows App live smoke after writing durable inbox evidence.
  --smoke-subject <text>      Subject for --apply-windows-route-smoke.
  --smoke-content <text>      Content for --apply-windows-route-smoke.
  --repair-permissions        With --apply, repair known Codex CLI profile permission posture before starting.
  --fresh-minutes <n>         Presence freshness window. Default: 30.
  --comms-dir <path>          Override local comms directory.
  --help                      Show help.

Contract:
  tap ready is a surface-aware readiness report. It keeps tap_set_name explicit,
  does not mint consent receipts, does not sync mutable heartbeats/claims, and
  does not make CLI polling look like realtime push. Windows App route refresh
  is opt-in and writes only guarded per-agent presence evidence.

  Local operator profiles are compatibility surfaces, not public package
  defaults. Public first-run flows should prefer --surface with a concrete
  neutral --agent such as agent-a unless a reviewed local profile pack/runbook
  says otherwise.
`.trim();

type ReadySurface =
  | "codex-cli"
  | "codex-app"
  | "windows-app"
  | "claude"
  | "remote-panel";
type ReadyStatus = "ready" | "partial" | "not-ready" | "blocked";
type ReadyCheckStatus = "pass" | "warn" | "fail" | "block" | "skip";
interface ReadyCheck {
  name: string;
  status: ReadyCheckStatus;
  message: string;
}

interface ReadyAction {
  label: string;
  command?: string;
}

interface ReadyAppliedAction {
  name: string;
  status: "applied" | "would-apply" | "skipped" | "failed";
  path?: string;
  backupPath?: string;
  message: string;
  command?: string;
  evidencePath?: string;
  turnId?: string | null;
  consentRef?: string | null;
}

interface ReadyReport extends Record<string, unknown> {
  agent: string;
  surface: ReadySurface;
  profile: ReadyProfileId | null;
  status: ReadyStatus;
  receiveTransports: string[];
  runtimeHealth: string;
  presenceFreshness: string;
  returnRoute: {
    routingAddress: string | null;
    status: "ready" | "blocked";
  };
  commsDir: string;
  stateDir: string;
  apply: {
    enabled: boolean;
    dryRun: boolean;
    actions: ReadyAppliedAction[];
  };
  checks: ReadyCheck[];
  actions: ReadyAction[];
  next: string[];
  presence: {
    path: string;
    requestedPath?: string;
    matchedBy?: string;
    exists: boolean;
    consentDriveStatus: string | null;
    conversationId: string | null;
    ownerClientId: string | null;
    ageMinutes: number | null;
  };
  windowsDualLayer?: {
    liveAttemptRequired: boolean;
    inboxEvidenceRequired: boolean;
    liveAttemptStatus: "not-attempted" | "delivered" | "blocked";
    inboxEvidenceStatus: "required" | "written" | "failed";
    evidencePath?: string;
    turnId?: string | null;
  };
  windowsRouteHealth?: WindowsAppRouteHealth;
  remotePanel?: {
    host: string;
    port: number;
    url: string;
    readOnly: boolean;
    sendEnabled: boolean;
    tokenEnv: string | null;
    liveAttempted: false;
  };
  headlessRunner?: {
    installed: boolean;
    running: boolean;
    required: boolean;
    sessionName: string;
    stateName: string;
    dryRunCommand: string;
    startCommand?: string;
  };
  loadedThread?: CodexCliLoadedThreadReadiness & {
    required: boolean;
    attachCommand: string;
  };
  codexPermissionProfile?: CodexPermissionProfileProbe;
}

interface ReadyProfileRunResult {
  ok: boolean;
  status: number | null;
  stdout: string;
  stderr: string;
}

type ReadyProfileCommandRunner = (
  profile: ReadyProfileConfig,
  cwd: string,
) => ReadyProfileRunResult;

let readyProfileCommandRunnerForTests: ReadyProfileCommandRunner | null = null;
let loadedThreadReadinessProbeForTests:
  | ((
      options: ProbeCodexCliLoadedThreadReadinessOptions,
    ) => Promise<CodexCliLoadedThreadReadiness>)
  | null = null;
let windowsAppRouteHealthProbeForTests:
  | ((
      options: ProbeWindowsAppRouteHealthOptions,
    ) => Promise<WindowsAppRouteHealth>)
  | null = null;
export function __setReadyProfileCommandRunnerForTests(
  runner: ReadyProfileCommandRunner | null,
): void {
  readyProfileCommandRunnerForTests = runner;
}

export function __setLoadedThreadReadinessProbeForTests(
  probe:
    | ((
        options: ProbeCodexCliLoadedThreadReadinessOptions,
      ) => Promise<CodexCliLoadedThreadReadiness>)
    | null,
): void {
  loadedThreadReadinessProbeForTests = probe;
}

export function __setWindowsAppRouteHealthProbeForTests(
  probe:
    | ((
        options: ProbeWindowsAppRouteHealthOptions,
      ) => Promise<WindowsAppRouteHealth>)
    | null,
): void {
  windowsAppRouteHealthProbeForTests = probe;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function parseSurface(
  value: string | boolean | undefined,
): ReadySurface | null {
  if (
    value === "codex-cli" ||
    value === "codex-app" ||
    value === "windows-app" ||
    value === "claude" ||
    value === "remote-panel"
  ) {
    return value;
  }
  return null;
}

function parsePositiveInteger(
  value: string | boolean | undefined,
  fallback: number,
  name: string,
): number {
  if (value === undefined) return fallback;
  if (typeof value !== "string") {
    throw new RangeError(`Invalid ${name}: expected a value.`);
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new RangeError(`Invalid ${name}: must be a positive integer.`);
  }
  return parsed;
}

function parsePanelPort(
  value: string | boolean | undefined,
): { ok: true; port: number } | { ok: false; message: string } {
  if (value === undefined) return { ok: true, port: 8765 };
  if (typeof value !== "string") {
    return { ok: false, message: "Invalid --panel-port: expected a value." };
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return {
      ok: false,
      message: "Invalid --panel-port: must be a positive integer.",
    };
  }
  if (parsed > 65535) {
    return { ok: false, message: "Invalid --panel-port: must be <= 65535." };
  }
  return { ok: true, port: parsed };
}

function parseOptionalStringFlag(
  value: string | boolean | undefined,
  name: string,
): { ok: true; value: string | null } | { ok: false; message: string } {
  if (value === undefined) return { ok: true, value: null };
  if (typeof value !== "string" || !value.trim()) {
    return { ok: false, message: `Invalid ${name}: expected a value.` };
  }
  return { ok: true, value: value.trim() };
}

function isPlaceholder(value: string | null | undefined): boolean {
  const trimmed = value?.trim();
  return !trimmed || trimmed === "unknown" || trimmed === "unnamed";
}

function checkTmuxSession(sessionName: string): boolean {
  try {
    const result = spawnSync("tmux", ["has-session", "-t", sessionName], {
      stdio: "ignore",
    });
    return result.status === 0;
  } catch {
    return false;
  }
}

function runReadyProfileCommand(
  profile: ReadyProfileConfig,
  cwd: string,
): ReadyProfileRunResult {
  if (readyProfileCommandRunnerForTests) {
    return readyProfileCommandRunnerForTests(profile, cwd);
  }
  const result = spawnSync("bash", ["-lc", profile.command], {
    encoding: "utf8",
    cwd,
  });
  return {
    ok: result.status === 0,
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function resolveReadyProfileAgent(
  profile: ReadyProfileConfig,
  explicitAgent: string | null,
): string {
  if (explicitAgent) return explicitAgent;
  if (profile.agentEnv) return (process.env[profile.agentEnv] ?? "").trim();
  return profile.agent.trim();
}

function resolveReadyProfileCommand(
  profile: ReadyProfileConfig,
  agent: string,
  command = profile.command,
): string {
  if (!profile.agentEnv) return command;
  return `${profile.agentEnv}=${shellQuote(agent)}; export ${profile.agentEnv}; ${command}`;
}

function summarizeReadyProfileOutput(result: ReadyProfileRunResult): string {
  const output = result.ok
    ? `${result.stdout}\n${result.stderr}`
    : `${result.stderr}\n${result.stdout}`;
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!result.ok) {
    const blocked = lines.find(
      (line) =>
        line.startsWith("blocked:") ||
        line.startsWith("ERROR:") ||
        line.startsWith("[recover] ERROR:"),
    );
    if (blocked) return blocked;
  }
  const alreadyRunning = lines.find((line) =>
    line.startsWith("already running:"),
  );
  if (alreadyRunning) return alreadyRunning;
  const started = lines.find((line) => line.startsWith("started:"));
  if (started) return started;
  const fallback = lines.at(-1) ?? `exit ${result.status ?? "unknown"}`;
  return fallback.length > 240 ? `${fallback.slice(0, 237)}...` : fallback;
}

function findReadyProfileCommandCwd(startDir: string = process.cwd()): string {
  let dir = path.resolve(startDir);
  while (true) {
    if (
      fs.existsSync(path.join(dir, "scripts", "tap-receiver-supervisor.sh"))
    ) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return findRepoRoot(startDir);
}

function addCheck(
  checks: ReadyCheck[],
  status: ReadyCheckStatus,
  name: string,
  message: string,
): void {
  checks.push({ name, status, message });
}

function ensureDirectoryForReady(
  dirPath: string,
  name: string,
  enabled: boolean,
  dryRun: boolean,
  actions: ReadyAppliedAction[],
): void {
  if (fs.existsSync(dirPath)) {
    actions.push({
      name,
      status: "skipped",
      path: dirPath,
      message: `${name} already exists`,
    });
    return;
  }
  if (!enabled || dryRun) {
    actions.push({
      name,
      status: enabled ? "would-apply" : "skipped",
      path: dirPath,
      message: enabled
        ? `would create ${name}: ${dirPath}`
        : `${name} missing; run tap ready --apply to create it`,
    });
    return;
  }
  fs.mkdirSync(dirPath, { recursive: true });
  actions.push({
    name,
    status: "applied",
    path: dirPath,
    message: `created ${name}: ${dirPath}`,
  });
}

function deriveStatus(checks: ReadyCheck[]): ReadyStatus {
  if (checks.some((check) => check.status === "block")) return "blocked";
  if (checks.some((check) => check.status === "fail")) return "not-ready";
  if (checks.some((check) => check.status === "warn")) return "partial";
  return "ready";
}

function classifyPublishedRuntimeHealth(
  status: string | null,
): ReadyCheckStatus {
  if (!status || status === "ready") return "pass";
  if (
    status === "active-turn" ||
    status === "stuck-turn" ||
    status === "stale-active-turn"
  ) {
    return "block";
  }
  return "warn";
}

function readPresence(
  commsDir: string,
  agent: string,
): {
  path: string;
  requestedPath: string;
  record: PresenceRecord | null;
  ageMinutes: number | null;
  matchedBy: string;
} {
  const presence = resolvePresenceRecord<Record<string, unknown>>(
    commsDir,
    agent,
  );
  const record = presence.record as PresenceRecord | null;
  const timestamp = record?.timestamp;
  const ageMinutes = timestamp
    ? Math.max(0, (Date.now() - Date.parse(timestamp)) / 60_000)
    : null;
  return {
    path: presence.path,
    requestedPath: presence.requestedPath,
    record,
    ageMinutes,
    matchedBy: presence.matchedBy,
  };
}

function buildReceiverCommand(agent: string): string {
  return `tap receiver supervise --agent ${agent} --watch`;
}

function buildRemotePanelCommand(options: {
  agent: string;
  commsDir: string;
  host: string;
  port: number;
  sendEnabled: boolean;
  tokenEnv: string | null;
}): string {
  const mode = options.sendEnabled
    ? `--send-enabled --token-env ${options.tokenEnv ?? "<token-env>"}`
    : "--read-only";
  return [
    "tap remote-panel",
    `--agent ${options.agent}`,
    `--comms-dir ${options.commsDir}`,
    `--host ${options.host}`,
    `--port ${options.port}`,
    mode,
  ].join(" ");
}

function buildCodexAppWarmupCommand(
  agent: string,
  conversationId: string,
): string {
  return `tap_session_warmup({ name: "${agent}", receiveTransports: ["consent-drive"], conversationId: "${conversationId}", status: "active" })`;
}

function buildCodexAppObserveCommand(
  surface: ReadySurface,
  agent: string,
  conversationId: string,
): string {
  const script = surface === "windows-app" ? "codex:windows" : "codex:desktop";
  return `pnpm --silent ${script} -- --agent ${agent} --conversation-id ${conversationId} --watch-seconds 5 --json`;
}

function buildHeadlessDryRunCommand(options: {
  agent: string;
  commsDir: string;
  repoRoot: string;
  stateDir: string;
  stateName: string;
}): string {
  return [
    "cd",
    shellQuote(options.repoRoot),
    "&&",
    "node packages/tap-comms/dist/cli.mjs headless dry-run",
    "--agent",
    shellQuote(options.agent),
    "--comms-dir",
    shellQuote(options.commsDir),
    "--state-dir",
    shellQuote(options.stateDir),
    "--state-name",
    shellQuote(options.stateName),
    "--since-minutes 60",
  ].join(" ");
}

function buildLoadedThreadAttachCommand(options: {
  appServerUrl: string;
  repoRoot: string;
}): string {
  return [
    "codex resume --last",
    "--enable tui_app_server",
    "--remote",
    shellQuote(options.appServerUrl),
    "-C",
    shellQuote(options.repoRoot),
    "-s danger-full-access",
    "-a never",
    "--no-alt-screen",
  ].join(" ");
}

function buildLoadedThreadAttachApplyCommand(options: {
  appServerUrl: string;
  profileId: ReadyProfileId;
  repoRoot: string;
}): string {
  const sessionName = buildLoadedThreadAttachSessionName(options.profileId);
  const attachCommand = buildLoadedThreadAttachCommand({
    appServerUrl: options.appServerUrl,
    repoRoot: options.repoRoot,
  });
  const tmuxCommand = [
    "cd",
    shellQuote(options.repoRoot),
    "&& exec",
    attachCommand,
  ].join(" ");
  return [
    "set -euo pipefail",
    `session=${shellQuote(sessionName)}`,
    'if tmux has-session -t "$session" 2>/dev/null; then',
    '  printf "already running: %s\\n" "$session"',
    "  exit 0",
    "fi",
    'tmux new-session -d -s "$session"',
    shellQuote(tmuxCommand),
    "sleep 1",
    'if tmux has-session -t "$session" 2>/dev/null; then',
    '  printf "started: %s\\n" "$session"',
    "else",
    '  printf "failed: %s exited before readiness confirmation\\n" "$session" >&2',
    "  exit 2",
    "fi",
  ].join("\n");
}

async function probeLoadedThreadReadiness(
  options: ProbeCodexCliLoadedThreadReadinessOptions,
): Promise<CodexCliLoadedThreadReadiness> {
  if (loadedThreadReadinessProbeForTests) {
    return loadedThreadReadinessProbeForTests(options);
  }
  return probeCodexCliLoadedThreadReadiness(options);
}

async function probeWindowsRouteHealth(
  options: ProbeWindowsAppRouteHealthOptions,
): Promise<WindowsAppRouteHealth> {
  if (windowsAppRouteHealthProbeForTests) {
    return windowsAppRouteHealthProbeForTests(options);
  }
  return probeWindowsAppRouteHealth(options);
}

export async function readyCommand(
  args: string[],
): Promise<CommandResult<ReadyReport>> {
  if (args.includes("--help") || args.includes("-h")) {
    log(READY_HELP);
    return {
      ok: true,
      command: "ready",
      code: "TAP_NO_OP",
      message: READY_HELP,
      warnings: [],
      data: {} as ReadyReport,
    };
  }

  const { flags } = parseArgs(args);
  const profilePackPath =
    typeof flags["profile-pack"] === "string"
      ? flags["profile-pack"].trim()
      : null;
  if (flags["profile-pack"] === true || profilePackPath === "") {
    return {
      ok: false,
      command: "ready",
      code: "TAP_INVALID_ARGUMENT",
      message: "Missing --profile-pack <path> value.",
      warnings: [],
      data: {} as ReadyReport,
    };
  }
  let readyProfile = parseReadyProfile(flags.profile);
  if (!readyProfile && typeof flags.profile === "string" && profilePackPath) {
    try {
      readyProfile = findReadyProfileInProfilePack(
        profilePackPath,
        flags.profile,
      );
    } catch (error) {
      return {
        ok: false,
        command: "ready",
        code: "TAP_INVALID_ARGUMENT",
        message: error instanceof Error ? error.message : String(error),
        warnings: [],
        data: {} as ReadyReport,
      };
    }
  }
  if (flags.profile !== undefined && !readyProfile) {
    return {
      ok: false,
      command: "ready",
      code: "TAP_INVALID_ARGUMENT",
      message:
        "Invalid --profile. Use a reviewed local ready profile id or run without --profile and pass --surface/--agent.",
      warnings: [],
      data: {} as ReadyReport,
    };
  }

  const surface = parseSurface(flags.surface) ?? readyProfile?.surface ?? null;
  if (!surface) {
    return {
      ok: false,
      command: "ready",
      code: "TAP_INVALID_ARGUMENT",
      message:
        "Missing or invalid --surface. Use codex-cli, codex-app, windows-app, claude, or remote-panel.",
      warnings: [],
      data: {} as ReadyReport,
    };
  }

  if (readyProfile && readyProfile.surface !== surface) {
    return {
      ok: false,
      command: "ready",
      code: "TAP_INVALID_ARGUMENT",
      message: `Profile ${readyProfile.id} is for surface ${readyProfile.surface}, not ${surface}.`,
      warnings: [],
      data: {} as ReadyReport,
    };
  }

  const explicitAgent =
    typeof flags.agent === "string" ? flags.agent.trim() : null;
  const profileAgent = readyProfile
    ? resolveReadyProfileAgent(readyProfile, explicitAgent)
    : "";
  const agent =
    explicitAgent ??
    (
      profileAgent ||
      process.env.TAP_AGENT_NAME ||
      process.env.TAP_AGENT_ID ||
      ""
    ).trim();
  if (
    readyProfile &&
    !readyProfile.agentEnv &&
    !isPlaceholder(agent) &&
    agent !== readyProfile.agent
  ) {
    return {
      ok: false,
      command: "ready",
      code: "TAP_INVALID_ARGUMENT",
      message: `Profile ${readyProfile.id} is for agent ${readyProfile.agent}, not ${agent}.`,
      warnings: [],
      data: {} as ReadyReport,
    };
  }
  if (
    readyProfile?.agentEnv &&
    !explicitAgent &&
    !process.env[readyProfile.agentEnv]
  ) {
    return {
      ok: false,
      command: "ready",
      code: "TAP_INVALID_ARGUMENT",
      message: `Profile ${readyProfile.id} requires --agent <name> or ${readyProfile.agentEnv}.`,
      warnings: [],
      data: {} as ReadyReport,
    };
  }
  if (isPlaceholder(agent)) {
    return {
      ok: false,
      command: "ready",
      code: "TAP_INVALID_ARGUMENT",
      message:
        "Missing ready agent. Call tap_set_name first, then pass --agent <name> or set TAP_AGENT_NAME.",
      warnings: [],
      data: {} as ReadyReport,
    };
  }

  const repoRoot = readyProfile ? findReadyProfileCommandCwd() : findRepoRoot();
  const commsDir = resolveCommsDirFromArgs(args, repoRoot);
  const { config } = resolveConfig({}, repoRoot);
  const stateDir = path.resolve(config.stateDir);
  const freshMinutes = parsePositiveInteger(
    flags["fresh-minutes"],
    30,
    "--fresh-minutes",
  );
  const conversationId =
    typeof flags["conversation-id"] === "string"
      ? flags["conversation-id"].trim()
      : "";
  const receiverSession =
    typeof flags["receiver-session"] === "string"
      ? flags["receiver-session"].trim()
      : "";
  const requireHeadlessRunner = flags["require-headless-runner"] === true;
  const applyHeadlessRunner = flags["apply-headless-runner"] === true;
  const checkLoadedThread = flags["check-loaded-thread"] === true;
  const applyLoadedThreadAttach = flags["apply-loaded-thread-attach"] === true;
  const applyWindowsRouteRefresh =
    flags["apply-windows-route-refresh"] === true;
  const applyWindowsRouteSmoke = flags["apply-windows-route-smoke"] === true;
  const headlessSession =
    typeof flags["headless-session"] === "string"
      ? flags["headless-session"].trim()
      : "";
  const appServerUrlResult = parseOptionalStringFlag(
    flags["app-server-url"],
    "--app-server-url",
  );
  if (!appServerUrlResult.ok) {
    return {
      ok: false,
      command: "ready",
      code: "TAP_INVALID_ARGUMENT",
      message: appServerUrlResult.message,
      warnings: [appServerUrlResult.message],
      data: {} as ReadyReport,
    };
  }
  if (
    appServerUrlResult.value &&
    !/^wss?:\/\//i.test(appServerUrlResult.value)
  ) {
    return {
      ok: false,
      command: "ready",
      code: "TAP_INVALID_ARGUMENT",
      message: "Invalid --app-server-url: expected a ws:// or wss:// URL.",
      warnings: ["Invalid --app-server-url: expected a ws:// or wss:// URL."],
      data: {} as ReadyReport,
    };
  }
  const threadIdResult = parseOptionalStringFlag(
    flags["thread-id"],
    "--thread-id",
  );
  if (!threadIdResult.ok) {
    return {
      ok: false,
      command: "ready",
      code: "TAP_INVALID_ARGUMENT",
      message: threadIdResult.message,
      warnings: [threadIdResult.message],
      data: {} as ReadyReport,
    };
  }
  const appServerUrl =
    appServerUrlResult.value ??
    readyProfile?.appServerUrl ??
    "ws://127.0.0.1:35089";
  const threadId = threadIdResult.value;
  const smokeSubjectResult = parseOptionalStringFlag(
    flags["smoke-subject"],
    "--smoke-subject",
  );
  if (!smokeSubjectResult.ok) {
    return {
      ok: false,
      command: "ready",
      code: "TAP_INVALID_ARGUMENT",
      message: smokeSubjectResult.message,
      warnings: [smokeSubjectResult.message],
      data: {} as ReadyReport,
    };
  }
  const smokeContentResult = parseOptionalStringFlag(
    flags["smoke-content"],
    "--smoke-content",
  );
  if (!smokeContentResult.ok) {
    return {
      ok: false,
      command: "ready",
      code: "TAP_INVALID_ARGUMENT",
      message: smokeContentResult.message,
      warnings: [smokeContentResult.message],
      data: {} as ReadyReport,
    };
  }
  const smokeSubject = smokeSubjectResult.value;
  const smokeContent = smokeContentResult.value;
  const panelHost =
    typeof flags["panel-host"] === "string"
      ? flags["panel-host"].trim()
      : (readyProfile?.host ?? "127.0.0.1");
  const panelPortResult = parsePanelPort(flags["panel-port"]);
  if (!panelPortResult.ok) {
    return {
      ok: false,
      command: "ready",
      code: "TAP_INVALID_ARGUMENT",
      message: panelPortResult.message,
      warnings: [panelPortResult.message],
      data: {} as ReadyReport,
    };
  }
  const panelPort =
    flags["panel-port"] === undefined && readyProfile?.port
      ? readyProfile.port
      : panelPortResult.port;
  const panelSendEnabled =
    flags["send-enabled"] === true || readyProfile?.sendEnabled === true;
  const panelTokenEnv =
    typeof flags["token-env"] === "string"
      ? flags["token-env"].trim()
      : (readyProfile?.tokenEnv ?? "");
  const applyEnabled = flags.apply === true;
  const dryRun = flags["dry-run"] === true;
  const repairPermissions = flags["repair-permissions"] === true;
  if (
    repairPermissions &&
    (!readyProfile ||
      surface !== "codex-cli" ||
      readyProfile.source === "profile-pack")
  ) {
    return {
      ok: false,
      command: "ready",
      code: "TAP_INVALID_ARGUMENT",
      message:
        "--repair-permissions is only available for built-in Codex CLI ready profiles.",
      warnings: [],
      data: {} as ReadyReport,
    };
  }
  if (repairPermissions && !applyEnabled) {
    return {
      ok: false,
      command: "ready",
      code: "TAP_INVALID_ARGUMENT",
      message: "--repair-permissions requires --apply.",
      warnings: [],
      data: {} as ReadyReport,
    };
  }
  if (applyHeadlessRunner && !applyEnabled) {
    return {
      ok: false,
      command: "ready",
      code: "TAP_INVALID_ARGUMENT",
      message: "--apply-headless-runner requires --apply.",
      warnings: [],
      data: {} as ReadyReport,
    };
  }
  if (
    applyHeadlessRunner &&
    (!readyProfile ||
      surface !== "codex-cli" ||
      !supportsHeadlessRunnerProfile(readyProfile.id))
  ) {
    return {
      ok: false,
      command: "ready",
      code: "TAP_INVALID_ARGUMENT",
      message:
        "--apply-headless-runner is only available for reviewed Codex CLI worker profiles.",
      warnings: [],
      data: {} as ReadyReport,
    };
  }
  if (
    checkLoadedThread &&
    (!readyProfile ||
      surface !== "codex-cli" ||
      !supportsLoadedThreadProfile(readyProfile.id))
  ) {
    return {
      ok: false,
      command: "ready",
      code: "TAP_INVALID_ARGUMENT",
      message:
        "--check-loaded-thread is only available for reviewed Codex CLI/TUI profiles.",
      warnings: [],
      data: {} as ReadyReport,
    };
  }
  if (applyLoadedThreadAttach && !applyEnabled) {
    return {
      ok: false,
      command: "ready",
      code: "TAP_INVALID_ARGUMENT",
      message: "--apply-loaded-thread-attach requires --apply.",
      warnings: [],
      data: {} as ReadyReport,
    };
  }
  if (applyLoadedThreadAttach && !checkLoadedThread) {
    return {
      ok: false,
      command: "ready",
      code: "TAP_INVALID_ARGUMENT",
      message: "--apply-loaded-thread-attach requires --check-loaded-thread.",
      warnings: [],
      data: {} as ReadyReport,
    };
  }
  if (applyWindowsRouteRefresh && !applyEnabled) {
    return {
      ok: false,
      command: "ready",
      code: "TAP_INVALID_ARGUMENT",
      message: "--apply-windows-route-refresh requires --apply.",
      warnings: [],
      data: {} as ReadyReport,
    };
  }
  if (applyWindowsRouteRefresh && surface !== "windows-app") {
    return {
      ok: false,
      command: "ready",
      code: "TAP_INVALID_ARGUMENT",
      message:
        "--apply-windows-route-refresh is only available for --surface windows-app.",
      warnings: [],
      data: {} as ReadyReport,
    };
  }
  if (applyWindowsRouteRefresh && !conversationId) {
    return {
      ok: false,
      command: "ready",
      code: "TAP_INVALID_ARGUMENT",
      message:
        "--apply-windows-route-refresh requires --conversation-id for explicit live tuple selection.",
      warnings: [],
      data: {} as ReadyReport,
    };
  }
  if (applyWindowsRouteSmoke && !applyEnabled) {
    return {
      ok: false,
      command: "ready",
      code: "TAP_INVALID_ARGUMENT",
      message: "--apply-windows-route-smoke requires --apply.",
      warnings: [],
      data: {} as ReadyReport,
    };
  }
  if (applyWindowsRouteSmoke && surface !== "windows-app") {
    return {
      ok: false,
      command: "ready",
      code: "TAP_INVALID_ARGUMENT",
      message:
        "--apply-windows-route-smoke is only available for --surface windows-app.",
      warnings: [],
      data: {} as ReadyReport,
    };
  }
  if (applyWindowsRouteSmoke && !conversationId) {
    return {
      ok: false,
      command: "ready",
      code: "TAP_INVALID_ARGUMENT",
      message:
        "--apply-windows-route-smoke requires --conversation-id for explicit live tuple selection.",
      warnings: [],
      data: {} as ReadyReport,
    };
  }
  if (applyWindowsRouteSmoke && (!smokeSubject || !smokeContent)) {
    return {
      ok: false,
      command: "ready",
      code: "TAP_INVALID_ARGUMENT",
      message:
        "--apply-windows-route-smoke requires --smoke-subject and --smoke-content.",
      warnings: [],
      data: {} as ReadyReport,
    };
  }
  if (applyWindowsRouteSmoke && smokeSubject && smokeSubject.length > 120) {
    return {
      ok: false,
      command: "ready",
      code: "TAP_INVALID_ARGUMENT",
      message: "--smoke-subject must be 120 characters or fewer.",
      warnings: [],
      data: {} as ReadyReport,
    };
  }
  if (applyWindowsRouteSmoke && smokeContent && smokeContent.length > 4_000) {
    return {
      ok: false,
      command: "ready",
      code: "TAP_INVALID_ARGUMENT",
      message: "--smoke-content must be 4000 characters or fewer.",
      warnings: [],
      data: {} as ReadyReport,
    };
  }
  if (applyWindowsRouteRefresh && applyWindowsRouteSmoke) {
    return {
      ok: false,
      command: "ready",
      code: "TAP_INVALID_ARGUMENT",
      message:
        "--apply-windows-route-refresh and --apply-windows-route-smoke must run as separate steps.",
      warnings: [],
      data: {} as ReadyReport,
    };
  }
  const localApplySurface =
    surface === "codex-cli" ||
    surface === "claude" ||
    surface === "remote-panel";

  const checks: ReadyCheck[] = [];
  const actions: ReadyAction[] = [];
  const appliedActions: ReadyAppliedAction[] = [];
  const next: string[] = [];
  let codexPermissionProfile: CodexPermissionProfileProbe | null = null;
  let headlessRunner: ReadyReport["headlessRunner"] | undefined;
  let loadedThread: ReadyReport["loadedThread"] | undefined;
  let windowsRouteHealth: WindowsAppRouteHealth | undefined;
  let readyProfileApplyFailed = false;
  let windowsRouteRefreshApplyFailed = false;
  let windowsRouteSmokeApplyFailed = false;
  let windowsRouteRefreshApplyStatus: ReadyAppliedAction["status"] | null =
    null;
  let windowsRouteSmokeAction: ReadyAppliedAction | null = null;
  let consentDriveStatusForReport: string | null = null;
  const effectiveReadyProfile = readyProfile
    ? {
        ...readyProfile,
        agent,
        command: resolveReadyProfileCommand(readyProfile, agent),
      }
    : null;
  let runtimeHealth =
    surface === "codex-app" || surface === "windows-app"
      ? "not-observed"
      : "ready";
  const receiveTransports =
    surface === "codex-app" || surface === "windows-app"
      ? ["consent-drive"]
      : ["polling"];

  ensureDirectoryForReady(
    commsDir,
    "comms-dir",
    applyEnabled && localApplySurface,
    dryRun,
    appliedActions,
  );

  const inboxDir = path.join(commsDir, "inbox");
  ensureDirectoryForReady(
    inboxDir,
    "inbox",
    applyEnabled && localApplySurface,
    dryRun,
    appliedActions,
  );

  if (surface === "codex-cli" || surface === "claude") {
    ensureDirectoryForReady(
      path.join(stateDir, "receiver"),
      "receiver-state",
      applyEnabled,
      dryRun,
      appliedActions,
    );
  } else if (surface === "remote-panel") {
    ensureDirectoryForReady(
      path.join(stateDir, "remote-panel"),
      "remote-panel-state",
      applyEnabled,
      dryRun,
      appliedActions,
    );
  } else if (
    applyEnabled &&
    !(
      surface === "windows-app" &&
      (applyWindowsRouteRefresh || applyWindowsRouteSmoke)
    )
  ) {
    appliedActions.push({
      name: "app-surface-apply",
      status: "skipped",
      message:
        "App/Windows surfaces remain diagnostic-only; run warmup from the target runtime instead.",
    });
  }

  if (surface === "codex-cli" && effectiveReadyProfile) {
    codexPermissionProfile = probeCodexPermissionProfile({
      repoRoot,
      commsDir,
      expectedMode: "full",
    });
    if (codexPermissionProfile.status !== "ready" && repairPermissions) {
      const repairAllowed = codexPermissionProfile.status !== "unreadable";
      if (dryRun) {
        appliedActions.push({
          name: "codex-permission-profile",
          status: repairAllowed ? "would-apply" : "skipped",
          message: repairAllowed
            ? `would repair Codex permission profile at ${codexPermissionProfile.configPath}`
            : `skipped Codex permission repair: ${codexPermissionProfile.message}`,
        });
      } else if (repairAllowed) {
        try {
          const repairResult = applyCodexPermissions(
            repoRoot,
            commsDir,
            "full",
            [],
            {
              preserveExistingWritableRoots: true,
            },
          );
          appliedActions.push({
            name: "codex-permission-profile",
            status: "applied",
            path: codexPermissionProfile.configPath,
            backupPath: repairResult.backupPath,
            message: `repaired Codex permission profile at ${codexPermissionProfile.configPath}`,
          });
          for (const warning of repairResult.warnings) {
            next.push(`permission repair warning: ${warning}`);
          }
          codexPermissionProfile = probeCodexPermissionProfile({
            repoRoot,
            commsDir,
            expectedMode: "full",
          });
        } catch (error) {
          appliedActions.push({
            name: "codex-permission-profile",
            status: "failed",
            path: codexPermissionProfile.configPath,
            message: `failed to repair Codex permission profile: ${error instanceof Error ? error.message : String(error)}`,
          });
        }
      } else {
        appliedActions.push({
          name: "codex-permission-profile",
          status: "skipped",
          path: codexPermissionProfile.configPath,
          message: `skipped Codex permission repair: ${codexPermissionProfile.message}`,
        });
      }
    }
  }

  const readyProfileBlockedByPermission =
    surface === "codex-cli" && codexPermissionProfile?.status !== "ready";

  if (effectiveReadyProfile) {
    if (!readyProfileBlockedByPermission) {
      actions.push({
        label: "Start ready profile",
        command: effectiveReadyProfile.command,
      });
    }
    if (applyEnabled) {
      if (readyProfileBlockedByPermission) {
        appliedActions.push({
          name: "ready-profile",
          status: "skipped",
          command: effectiveReadyProfile.command,
          message: `skipped ready profile ${effectiveReadyProfile.id}: ${codexPermissionProfile?.message ?? "Codex permission profile is not ready"}`,
        });
      } else if (
        effectiveReadyProfile.source === "profile-pack" &&
        !effectiveReadyProfile.allowApply
      ) {
        appliedActions.push({
          name: "ready-profile",
          status: "skipped",
          command: effectiveReadyProfile.command,
          message:
            "profile-pack commands are loaded as data-only guidance; reviewed command execution is not enabled in this package slice",
        });
        readyProfileApplyFailed = true;
        addCheck(
          checks,
          "block",
          "profile-pack-command-guard",
          "profile-pack command execution is blocked; run the reviewed local command manually or wait for a dedicated loader/apply contract",
        );
      } else if (dryRun) {
        appliedActions.push({
          name: "ready-profile",
          status: "would-apply",
          command: effectiveReadyProfile.command,
          message: `would start ready profile ${effectiveReadyProfile.id}`,
        });
      } else {
        const profileRun = runReadyProfileCommand(
          effectiveReadyProfile,
          findReadyProfileCommandCwd(),
        );
        const profileRunOutput = summarizeReadyProfileOutput(profileRun);
        appliedActions.push({
          name: "ready-profile",
          status: profileRun.ok ? "applied" : "failed",
          command: effectiveReadyProfile.command,
          message: profileRun.ok
            ? `applied ready profile ${effectiveReadyProfile.id}: ${profileRunOutput}`
            : `failed to start ready profile ${effectiveReadyProfile.id}: ${profileRunOutput}`,
        });
        if (!profileRun.ok) {
          readyProfileApplyFailed = true;
          addCheck(
            checks,
            "fail",
            "ready-profile",
            `ready profile ${effectiveReadyProfile.id} failed to start`,
          );
        }
      }
    }
  }

  addCheck(
    checks,
    fs.existsSync(commsDir) ? "pass" : "fail",
    "comms-dir",
    fs.existsSync(commsDir)
      ? `comms dir exists: ${commsDir}`
      : `comms dir is missing: ${commsDir}`,
  );

  addCheck(
    checks,
    fs.existsSync(inboxDir) ? "pass" : "warn",
    "inbox",
    fs.existsSync(inboxDir)
      ? `local inbox exists: ${inboxDir}`
      : `local inbox is missing: ${inboxDir}`,
  );
  if (!fs.existsSync(inboxDir)) {
    if (localApplySurface) {
      next.push(`create local inbox directory: ${inboxDir}`);
      actions.push({
        label: "Prepare local inbox",
        command: `tap ready --surface ${surface} --agent ${agent} --apply`,
      });
    } else if (surface === "windows-app") {
      next.push(
        "ensure durable inbox evidence through the Windows dual-layer send path; App ready apply does not create local directories",
      );
    }
  }

  addCheck(
    checks,
    "pass",
    "return-route",
    `return route is concrete: ${agent}`,
  );

  const presence = readPresence(commsDir, agent);
  const presenceRecord = presence.record;
  const presenceFresh =
    presence.ageMinutes != null && presence.ageMinutes <= freshMinutes;
  const presenceFreshness =
    presence.record == null
      ? "missing"
      : presenceFresh
        ? "fresh-for-routing"
        : "stale-visible";

  if (surface === "codex-cli") {
    addCheck(
      checks,
      "pass",
      "receive-transport",
      "Codex CLI uses polling/file-polling, not mcp-channel push or consent-drive.",
    );
    if (readyProfile) {
      const permissionProfile =
        codexPermissionProfile ??
        probeCodexPermissionProfile({
          repoRoot,
          commsDir,
          expectedMode: "full",
        });
      codexPermissionProfile = permissionProfile;
      addCheck(
        checks,
        permissionProfile.status === "ready" ? "pass" : "fail",
        "codex-permission-profile",
        permissionProfile.message,
      );
      if (permissionProfile.status !== "ready") {
        next.push(
          "restore the Codex permission profile before treating the CLI/TUI surface as ready",
        );
        actions.push({
          label: "Inspect Codex permission profile",
          command:
            "rg -n 'approval_policy|\\[sandbox\\]|mode|network_access|sandbox_workspace_write' ~/.codex/config.toml",
        });
      }
    }
    if (flags["require-supervisor"] === true) {
      const sessionName = receiverSession || `tap-receiver-${agent}`;
      const running = checkTmuxSession(sessionName);
      addCheck(
        checks,
        running ? "pass" : "warn",
        "receiver-supervisor",
        running
          ? `receiver supervisor tmux session is running: ${sessionName}`
          : `receiver supervisor tmux session not observed: ${sessionName}`,
      );
      if (!running) {
        next.push(`start receiver supervisor for ${agent}`);
        actions.push({
          label: "Start receiver supervisor",
          command: buildReceiverCommand(agent),
        });
      }
    } else {
      addCheck(
        checks,
        "skip",
        "receiver-supervisor",
        "not required; pass --require-supervisor to enforce a standing receiver loop.",
      );
      actions.push({
        label: "Optional receiver supervisor",
        command: buildReceiverCommand(agent),
      });
    }
    if (readyProfile && supportsLoadedThreadProfile(readyProfile.id)) {
      const attachCommand = buildLoadedThreadAttachCommand({
        appServerUrl,
        repoRoot,
      });
      actions.push({
        label: "Attach visible TUI to loaded-thread profile",
        command: attachCommand,
      });
      if (checkLoadedThread) {
        const readiness = await probeLoadedThreadReadiness({
          appServerUrl,
          cwd: repoRoot,
          threadId,
        });
        loadedThread = {
          ...readiness,
          required: true,
          attachCommand,
        };
        const loadedThreadCheckStatus: ReadyCheckStatus =
          readiness.status === "loaded-idle"
            ? "pass"
            : readiness.status === "loaded-active"
              ? "block"
              : "fail";
        addCheck(
          checks,
          loadedThreadCheckStatus,
          "loaded-thread",
          readiness.message,
        );
        if (readiness.status === "app-server-unreachable") {
          next.push(
            "recover the app-server profile before attempting visible TUI promotion",
          );
        } else if (readiness.status === "thread-not-loaded") {
          next.push(
            "attach a bounded visible TUI session before relying on app-server promotion",
          );
        } else if (readiness.status === "loaded-active") {
          next.push(
            "wait for the loaded thread to become idle before promoting a new turn",
          );
        }
        if (applyLoadedThreadAttach) {
          if (readiness.status === "thread-not-loaded") {
            const applyAttachCommand = buildLoadedThreadAttachApplyCommand({
              appServerUrl,
              profileId: readyProfile.id,
              repoRoot,
            });
            if (dryRun) {
              appliedActions.push({
                name: "loaded-thread-attach",
                status: "would-apply",
                command: applyAttachCommand,
                message: `would attach visible TUI for ${readyProfile.id}: ${attachCommand}`,
              });
            } else {
              const attachRun = runReadyProfileCommand(
                {
                  ...readyProfile,
                  command: applyAttachCommand,
                },
                findReadyProfileCommandCwd(),
              );
              const attachRunOutput = summarizeReadyProfileOutput(attachRun);
              appliedActions.push({
                name: "loaded-thread-attach",
                status: attachRun.ok ? "applied" : "failed",
                command: applyAttachCommand,
                message: attachRun.ok
                  ? `attached visible TUI for ${readyProfile.id}: ${attachRunOutput}`
                  : `failed to attach visible TUI for ${readyProfile.id}: ${attachRunOutput}`,
              });
              if (!attachRun.ok) {
                addCheck(
                  checks,
                  "fail",
                  "loaded-thread-attach",
                  `visible TUI attach for ${readyProfile.id} failed`,
                );
              }
            }
          } else {
            appliedActions.push({
              name: "loaded-thread-attach",
              status: "skipped",
              command: attachCommand,
              message: `skipped visible TUI attach for ${readyProfile.id}: loaded-thread status is ${readiness.status}`,
            });
          }
        }
      } else {
        addCheck(
          checks,
          "skip",
          "loaded-thread",
          "not checked; pass --check-loaded-thread to classify app-server loaded-thread readiness.",
        );
      }
    }
    if (readyProfile && supportsHeadlessRunnerProfile(readyProfile.id)) {
      const stateName = `m472-headless-${readyProfile.id}`;
      const sessionName = headlessSession || `tap-headless-${readyProfile.id}`;
      const dryRunCommand = buildHeadlessDryRunCommand({
        agent,
        commsDir,
        repoRoot,
        stateDir,
        stateName,
      });
      const installed = fs.existsSync(
        path.join(repoRoot, "packages", "tap-comms", "dist", "cli.mjs"),
      );
      const headlessRunnerSupported = supportsHeadlessRunnerProfile(
        readyProfile.id,
      );
      const startCommand = headlessRunnerSupported
        ? resolveReadyProfileCommand(
            readyProfile,
            agent,
            buildHeadlessRunnerStartCommand(readyProfile.id),
          )
        : undefined;
      const stopCommand = headlessRunnerSupported
        ? buildHeadlessRunnerStopCommand(readyProfile.id)
        : undefined;
      let running = checkTmuxSession(sessionName);
      if (startCommand) {
        actions.push({
          label: "Start headless runner",
          command: startCommand,
        });
      }
      if (stopCommand) {
        actions.push({
          label: "Stop headless runner",
          command: stopCommand,
        });
      }
      if (applyHeadlessRunner) {
        const applyStartCommand = resolveReadyProfileCommand(
          readyProfile,
          agent,
          buildHeadlessRunnerStartCommand(readyProfile.id),
        );
        if (readyProfileBlockedByPermission) {
          appliedActions.push({
            name: "headless-runner",
            status: "skipped",
            command: applyStartCommand,
            message: `skipped headless runner ${sessionName}: ${codexPermissionProfile?.message ?? "Codex permission profile is not ready"}`,
          });
        } else if (readyProfileApplyFailed) {
          appliedActions.push({
            name: "headless-runner",
            status: "skipped",
            command: applyStartCommand,
            message: `skipped headless runner ${sessionName}: ready profile ${readyProfile.id} failed`,
          });
        } else if (!installed) {
          appliedActions.push({
            name: "headless-runner",
            status: "skipped",
            command: applyStartCommand,
            message: "skipped headless runner: tap headless dist is not built",
          });
        } else if (dryRun) {
          appliedActions.push({
            name: "headless-runner",
            status: "would-apply",
            command: applyStartCommand,
            message: `would start standing headless runner ${sessionName}`,
          });
        } else {
          const headlessRun = runReadyProfileCommand(
            { ...readyProfile, command: applyStartCommand },
            findReadyProfileCommandCwd(),
          );
          const headlessRunOutput = summarizeReadyProfileOutput(headlessRun);
          appliedActions.push({
            name: "headless-runner",
            status: headlessRun.ok ? "applied" : "failed",
            command: applyStartCommand,
            message: headlessRun.ok
              ? `applied headless runner ${sessionName}: ${headlessRunOutput}`
              : `failed to start headless runner ${sessionName}: ${headlessRunOutput}`,
          });
          if (!headlessRun.ok) {
            addCheck(
              checks,
              "fail",
              "headless-runner-apply",
              `headless runner ${sessionName} failed to start`,
            );
          }
          running = checkTmuxSession(sessionName);
        }
      }
      headlessRunner = {
        installed,
        running,
        required: requireHeadlessRunner,
        sessionName,
        stateName,
        dryRunCommand,
        startCommand,
      };
      addCheck(
        checks,
        installed ? "pass" : requireHeadlessRunner ? "fail" : "skip",
        "headless-runner-command",
        installed
          ? "tap headless once-mode command is installed."
          : "tap headless command dist is not built; run pnpm --filter @hua-labs/tap build before headless profile use.",
      );
      addCheck(
        checks,
        running ? "pass" : requireHeadlessRunner ? "fail" : "skip",
        "headless-runner-standing",
        running
          ? `standing headless runner tmux session is running: ${sessionName}`
          : `standing headless runner tmux session not observed: ${sessionName}`,
      );
      actions.push({
        label: "Headless runner dry-run",
        command: dryRunCommand,
      });
      if (!installed) {
        next.push("build tap before using the headless runner profile");
        actions.push({
          label: "Build tap CLI",
          command: "pnpm --filter @hua-labs/tap build",
        });
      }
      if (requireHeadlessRunner && !running) {
        next.push(`start or recover standing headless runner: ${sessionName}`);
      }
    }
  }

  if (surface === "claude") {
    addCheck(
      checks,
      "pass",
      "receive-transport",
      "Claude/channel surface is modeled as inbox/channel-capable; no consent-drive claim.",
    );
    actions.push({
      label: "Use inbox/channel fallback",
      command: `tap receiver check --agent ${agent}`,
    });
  }

  if (surface === "remote-panel") {
    addCheck(
      checks,
      "pass",
      "receive-transport",
      "Remote panel uses private HTTP plus file-backed inbox evidence; it does not claim mcp-channel push or consent-drive live delivery.",
    );

    const bindAllowed = isAllowedRemotePanelBindHost(panelHost);
    addCheck(
      checks,
      bindAllowed ? "pass" : "fail",
      "remote-panel-bind",
      bindAllowed
        ? `remote panel bind host is private/loopback/Tailscale-safe: ${panelHost}`
        : `remote panel bind host is not allowed for unauthenticated private panel: ${panelHost}`,
    );
    if (!bindAllowed) {
      next.push(
        "choose a loopback, private LAN, or Tailscale 100.64.0.0/10 bind host for the remote panel",
      );
    }

    if (panelSendEnabled) {
      const tokenValue = panelTokenEnv ? process.env[panelTokenEnv] : "";
      const tokenReady = Boolean(
        panelTokenEnv && isRemotePanelSendTokenReady(tokenValue),
      );
      addCheck(
        checks,
        tokenReady ? "pass" : "fail",
        "remote-panel-token",
        tokenReady
          ? `send-enabled panel token env is configured: ${panelTokenEnv}`
          : "send-enabled remote panel requires --token-env with a token/PIN of at least 4 characters; tap ready will not create secrets.",
      );
      if (!tokenReady) {
        next.push(
          "set a remote panel token/PIN env var with at least 4 characters, then rerun tap ready --surface remote-panel --send-enabled --token-env <env>",
        );
      }
    } else {
      addCheck(
        checks,
        "pass",
        "remote-panel-mode",
        "read-only remote panel mode is ready; append-only send remains disabled unless --send-enabled and --token-env are provided.",
      );
    }

    actions.push({
      label: panelSendEnabled
        ? "Start token-gated append-only remote panel"
        : "Start read-only remote panel",
      command: buildRemotePanelCommand({
        agent,
        commsDir,
        host: panelHost,
        port: panelPort,
        sendEnabled: panelSendEnabled,
        tokenEnv: panelTokenEnv || null,
      }),
    });
  }

  if (surface === "codex-app" || surface === "windows-app") {
    if (!conversationId) {
      addCheck(
        checks,
        "fail",
        "conversation-id",
        "Codex App readiness requires --conversation-id for owner discovery.",
      );
      next.push("rerun with --conversation-id <thread-id>");
    } else {
      addCheck(
        checks,
        "pass",
        "conversation-id",
        `conversation id supplied: ${conversationId}`,
      );
      actions.push({
        label: "Run target runtime warmup",
        command: buildCodexAppWarmupCommand(agent, conversationId),
      });
    }

    const presenceConversationId =
      presenceRecord?.address?.conversationId ??
      presenceRecord?.capabilities?.conversationId ??
      null;
    const ownerClientId =
      presenceRecord?.address?.ownerClientId ??
      presenceRecord?.capabilities?.ownerClientId ??
      null;
    const storedConsentDriveStatus =
      presenceRecord?.consentDriveStatus ??
      (presenceRecord?.receiveTransports?.includes("consent-drive") &&
      presenceConversationId &&
      ownerClientId
        ? "ready"
        : presenceRecord?.receiveTransports?.includes("consent-drive")
          ? "partial"
          : null);
    const consentDriveStatus =
      presenceRecord && !presenceFresh && storedConsentDriveStatus === "ready"
        ? "stale"
        : storedConsentDriveStatus;
    consentDriveStatusForReport = consentDriveStatus;

    addCheck(
      checks,
      presenceRecord ? (presenceFresh ? "pass" : "warn") : "warn",
      "presence",
      presenceRecord
        ? presenceFresh
          ? `presence snapshot is fresh within ${freshMinutes} minutes`
          : `presence snapshot is older than ${freshMinutes} minutes`
        : "presence snapshot is missing",
    );

    addCheck(
      checks,
      consentDriveStatus === "ready" ? "pass" : "warn",
      "consent-drive",
      consentDriveStatus === "ready"
        ? "consent-drive tuple is ready"
        : "consent-drive tuple is not ready or not observed",
    );
    if (consentDriveStatus !== "ready") {
      if (presenceConversationId && !ownerClientId) {
        next.push(
          "focus/open the target Codex App thread, then run warmup from that runtime with owner omitted",
        );
        next.push(
          `observe target IPC owner discovery: ${buildCodexAppObserveCommand(
            surface,
            agent,
            conversationId,
          )}`,
        );
      } else {
        next.push(
          "run warmup from the target Codex App runtime with owner omitted",
        );
      }
    }

    if (presenceConversationId && conversationId) {
      addCheck(
        checks,
        presenceConversationId === conversationId ? "pass" : "warn",
        "presence-conversation-id",
        presenceConversationId === conversationId
          ? "presence conversationId matches the supplied conversation id"
          : `presence conversationId ${presenceConversationId} does not match supplied conversation id ${conversationId}`,
      );
    }

    if (presenceConversationId && !ownerClientId) {
      addCheck(
        checks,
        "warn",
        "owner-client-id",
        "presence has conversationId but ownerClientId is missing; owner discovery needs a live Codex IPC conversation event from the target runtime",
      );
    }
    if (presenceConversationId && ownerClientId) {
      addCheck(
        checks,
        "pass",
        "owner-client-id",
        "presence includes ownerClientId for consent-drive delivery",
      );
    }

    if (conversationId) {
      actions.push({
        label: "Observe target IPC owner discovery",
        command: buildCodexAppObserveCommand(surface, agent, conversationId),
      });
    }

    const publishedRuntimeHealth =
      presenceRecord?.health?.status?.trim() || null;
    runtimeHealth =
      publishedRuntimeHealth ??
      (consentDriveStatus === "ready"
        ? "ready"
        : presenceConversationId && !ownerClientId
          ? "partial"
          : "not-observed");
    const runtimeHealthCheck = classifyPublishedRuntimeHealth(
      publishedRuntimeHealth,
    );
    if (publishedRuntimeHealth) {
      addCheck(
        checks,
        runtimeHealthCheck,
        "runtime-health",
        publishedRuntimeHealth === "ready"
          ? "runtime health is ready"
          : `runtime health is ${publishedRuntimeHealth}`,
      );
      if (runtimeHealthCheck !== "pass") {
        next.push(
          publishedRuntimeHealth === "active-turn"
            ? "wait for the target turn to finish before live delivery"
            : "recover target runtime health before live delivery",
        );
      }
    }

    if (surface === "windows-app") {
      addCheck(
        checks,
        "pass",
        "windows-dual-layer",
        "Windows App delivery requires live consent/IPC attempt plus durable inbox evidence.",
      );
      actions.push({
        label: "Leave durable inbox evidence",
        command: `tap_reply(to: "${agent}", subject: "<subject>", content: "<content>")`,
      });
      if (
        applyEnabled &&
        (dryRun || applyWindowsRouteRefresh || applyWindowsRouteSmoke)
      ) {
        windowsRouteHealth = await probeWindowsRouteHealth({
          conversationId,
          presenceConversationId,
          presenceOwnerClientId: ownerClientId,
          presenceFreshness,
          presenceAgeMinutes: presence.ageMinutes,
        });
        const routeHealthCheckStatus: ReadyCheckStatus =
          windowsRouteHealth.status === "fresh-route-ready"
            ? "pass"
            : windowsRouteHealth.status === "active-turn-blocked"
              ? "block"
              : windowsRouteHealth.status === "adapter-unavailable"
                ? "warn"
                : "warn";
        addCheck(
          checks,
          routeHealthCheckStatus,
          "windows-route-health",
          windowsRouteHealth.message,
        );
        if (dryRun) {
          if (!applyWindowsRouteSmoke || applyWindowsRouteRefresh) {
            appliedActions.push({
              name: "windows-route-health",
              status:
                windowsRouteHealth.status === "stale-presence"
                  ? "would-apply"
                  : "skipped",
              message:
                windowsRouteHealth.status === "stale-presence"
                  ? "would refresh durable presence from the selected live Windows App tuple; no presence was mutated in dry-run"
                  : `route-health dry-run did not find a refreshable stale-presence candidate: ${windowsRouteHealth.status}`,
              command: buildCodexAppObserveCommand(
                surface,
                agent,
                conversationId,
              ),
            });
          }
          if (applyWindowsRouteSmoke) {
            appliedActions.push({
              name: "windows-route-smoke",
              status:
                windowsRouteHealth.status === "fresh-route-ready"
                  ? "would-apply"
                  : "skipped",
              message:
                windowsRouteHealth.status === "fresh-route-ready"
                  ? "would write durable inbox evidence and attempt tuple-scoped Windows App live smoke; no inbox or IPC mutation was attempted in dry-run"
                  : `Windows route smoke dry-run requires fresh-route-ready; observed ${windowsRouteHealth.status}`,
            });
          }
        } else if (applyWindowsRouteRefresh) {
          const routeHealthApplyAction = applyWindowsRoutePresenceRefresh({
            agent,
            presencePath: presence.path,
            existing: presenceRecord,
            routeHealth: windowsRouteHealth,
          });
          windowsRouteRefreshApplyStatus = routeHealthApplyAction.status;
          appliedActions.push(routeHealthApplyAction);
          if (routeHealthApplyAction.status === "failed") {
            windowsRouteRefreshApplyFailed = true;
            addCheck(
              checks,
              "fail",
              "windows-route-health-apply",
              routeHealthApplyAction.message,
            );
          }
        } else if (applyWindowsRouteSmoke) {
          windowsRouteSmokeAction = await runWindowsRouteSmokeApply({
            commsDir,
            agent,
            subject: smokeSubject ?? "",
            content: smokeContent ?? "",
            routeHealth: windowsRouteHealth,
          });
          appliedActions.push(windowsRouteSmokeAction);
          if (windowsRouteSmokeAction.status === "failed") {
            windowsRouteSmokeApplyFailed = true;
            addCheck(
              checks,
              "fail",
              "windows-route-smoke-apply",
              windowsRouteSmokeAction.message,
            );
          }
          if (windowsRouteSmokeAction.status === "skipped") {
            addCheck(
              checks,
              "warn",
              "windows-route-smoke-apply",
              windowsRouteSmokeAction.message,
            );
          }
        }
        if (windowsRouteHealth.status === "live-candidate-needs-selection") {
          next.push(
            "select one live Windows App conversation before refreshing durable presence or running live smoke",
          );
        } else if (windowsRouteHealth.status === "missing-owner-client") {
          next.push(
            "wait for a live Windows App ownerClientId before refreshing durable presence",
          );
        } else if (windowsRouteHealth.status === "stale-presence") {
          if (dryRun) {
            next.push(
              "run tap ready --surface windows-app --apply --apply-windows-route-refresh with the selected conversation id to refresh durable presence",
            );
          } else if (windowsRouteRefreshApplyStatus === "applied") {
            next.push(
              "rerun tap ready --surface windows-app with the selected conversation id to verify the refreshed durable presence",
            );
          } else if (windowsRouteRefreshApplyStatus === "failed") {
            next.push(
              "fix the durable presence write failure before rerunning Windows route readiness",
            );
          } else {
            next.push(
              "inspect why the selected Windows App route candidate was not refreshable before rerunning readiness",
            );
          }
        } else if (windowsRouteHealth.status === "active-turn-blocked") {
          next.push(
            "wait for the Windows App turn to finish before attempting route refresh or live smoke",
          );
        } else if (windowsRouteHealth.status === "fresh-route-ready") {
          if (applyWindowsRouteSmoke && dryRun) {
            next.push(
              "rerun without --dry-run to write durable inbox evidence and attempt tuple-scoped Windows App live smoke",
            );
          } else if (windowsRouteSmokeAction?.status === "applied") {
            next.push(
              "verify the target Windows App observed the smoke turn and keep the inbox evidence path with the live turn id",
            );
          } else if (windowsRouteSmokeAction?.status === "failed") {
            next.push(
              "inspect the Windows App live smoke failure; durable inbox evidence is preserved when evidencePath is present",
            );
          }
        }
      }
    }
  }

  const status = deriveStatus(checks);
  if (
    surface === "codex-cli" ||
    surface === "claude" ||
    surface === "remote-panel"
  ) {
    runtimeHealth =
      surface === "codex-cli" && loadedThread
        ? loadedThread.status
        : status === "ready"
          ? "ready"
          : "not-observed";
  }

  const report: ReadyReport = {
    agent,
    surface,
    profile: readyProfile?.id ?? null,
    status,
    receiveTransports,
    runtimeHealth,
    presenceFreshness,
    returnRoute: {
      routingAddress: agent,
      status: "ready",
    },
    commsDir,
    stateDir,
    apply: {
      enabled: applyEnabled,
      dryRun,
      actions: appliedActions,
    },
    checks,
    actions,
    next,
    presence: {
      path: presence.path,
      requestedPath: presence.requestedPath,
      matchedBy: presence.matchedBy,
      exists: Boolean(presenceRecord),
      consentDriveStatus: consentDriveStatusForReport,
      conversationId:
        presenceRecord?.address?.conversationId ??
        presenceRecord?.capabilities?.conversationId ??
        null,
      ownerClientId:
        presenceRecord?.address?.ownerClientId ??
        presenceRecord?.capabilities?.ownerClientId ??
        null,
      ageMinutes:
        presence.ageMinutes == null
          ? null
          : Math.round(presence.ageMinutes * 10) / 10,
    },
    ...(surface === "windows-app"
      ? {
          windowsDualLayer: {
            liveAttemptRequired: true,
            inboxEvidenceRequired: true,
            liveAttemptStatus:
              windowsRouteSmokeAction?.status === "applied"
                ? ("delivered" as const)
                : windowsRouteSmokeAction?.status === "failed"
                  ? ("blocked" as const)
                  : ("not-attempted" as const),
            inboxEvidenceStatus: windowsRouteSmokeAction?.evidencePath
              ? ("written" as const)
              : windowsRouteSmokeAction?.status === "failed"
                ? ("failed" as const)
                : ("required" as const),
            ...(windowsRouteSmokeAction?.evidencePath
              ? { evidencePath: windowsRouteSmokeAction.evidencePath }
              : {}),
            ...(windowsRouteSmokeAction?.turnId !== undefined
              ? { turnId: windowsRouteSmokeAction.turnId }
              : {}),
          },
        }
      : {}),
    ...(windowsRouteHealth
      ? {
          windowsRouteHealth,
        }
      : {}),
    ...(surface === "remote-panel"
      ? {
          remotePanel: {
            host: panelHost,
            port: panelPort,
            url: `http://${formatRemotePanelUrlHost(panelHost)}:${panelPort}`,
            readOnly: !panelSendEnabled,
            sendEnabled: panelSendEnabled,
            tokenEnv: panelTokenEnv || null,
            liveAttempted: false as const,
          },
        }
      : {}),
    ...(headlessRunner
      ? {
          headlessRunner,
        }
      : {}),
    ...(loadedThread
      ? {
          loadedThread,
        }
      : {}),
    ...(codexPermissionProfile
      ? {
          codexPermissionProfile,
        }
      : {}),
  };

  logHeader("tap ready");
  log(`agent=${agent}`);
  log(`surface=${surface}`);
  log(`status=${status}`);
  log(`receiveTransports=${receiveTransports.join(",")}`);
  log(`runtimeHealth=${runtimeHealth}`);
  log(`presenceFreshness=${presenceFreshness}`);
  if (next.length > 0) {
    log(`next=${next.join(" | ")}`);
  }

  const commandFailed =
    windowsRouteRefreshApplyFailed ||
    windowsRouteSmokeApplyFailed ||
    readyProfileApplyFailed;
  return {
    ok: !commandFailed,
    command: "ready",
    code: commandFailed ? "TAP_READY_APPLY_FAILED" : "TAP_READY_OK",
    message: commandFailed
      ? `tap ready ${surface}: ${status}; apply failed`
      : `tap ready ${surface}: ${status}`,
    warnings: checks
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
