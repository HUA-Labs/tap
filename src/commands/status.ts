import * as childProcess from "node:child_process";
import * as fs from "node:fs";
import { loadState, saveState, getInstalledInstances } from "../state.js";
import {
  deriveBridgeLifecycleState,
  resolveBridgeLifecycleSnapshot,
  deriveCodexSessionState,
  loadRuntimeBridgeHeartbeat,
} from "../engine/bridge.js";
import {
  loadLiveDispatchEvidence,
  resolveUniqueLiveDispatchAliases,
} from "../engine/health-monitor.js";
import { resolveConfig } from "../config/index.js";
import { findRepoRoot, log, logHeader, logWarn, parseArgs } from "../utils.js";
import { version } from "../version.js";
import type { InstanceState, CommandResult } from "../types.js";
import {
  formatRemotePanelUrlHost,
  isAllowedRemotePanelBindHost,
  isRemotePanelSendTokenReady,
} from "./remote-panel.js";
import {
  AGENT_PROFILES,
  type AgentProfileId,
  type CliProfileConfig,
  type FlowSupervisorConfig,
  type HeadlessRunnerStatusConfig,
  type ProfileConfig,
  type RemotePanelProfileConfig,
} from "./status-profiles.js";
import type {
  BridgeLifecycleSnapshot,
  CodexSessionSnapshot,
} from "../engine/bridge.js";

const STATUS_HELP = `
Usage:
  tap status
  tap status --profile <sumback-yoon|sumback-sol|mac-jun-ssh-tui|remote-panel-yoon> [--json]

Description:
  Show all installed instances, their bridge status, and configuration info.
  With --profile, show AX-oriented readiness diagnostics for a known agent
  surface, including stable checks and suggested next commands.

Examples:
  npx @hua-labs/tap status
  npx @hua-labs/tap status --profile sumback-yoon --json
  npx @hua-labs/tap status --profile sumback-sol --json
  npx @hua-labs/tap status --profile remote-panel-yoon --json
`.trim();

type ProfileCheckStatus = "pass" | "warn" | "fail";
type ProfileStatus = "ready" | "degraded" | "blocked";

interface ProfileCheck {
  name: string;
  status: ProfileCheckStatus;
  message: string;
  nextActions?: ProfileNextAction[];
}

interface ProfileNextAction {
  label: string;
  command: string;
}

interface SurfaceGuidance {
  id: string;
  label: string;
  summary: string;
  nextAction?: string;
}

interface FlowSupervisorReport {
  id: FlowSupervisorConfig["id"];
  label: string;
  host: FlowSupervisorConfig["host"];
  tmuxSession: string;
  status: "running" | "stopped" | "unknown";
  message: string;
  startCommand: string;
  statusCommand: string;
}

interface HeadlessRunnerStatusReport {
  profile: HeadlessRunnerStatusConfig["profile"];
  tmuxSession: string;
  status: "running" | "stopped" | "unknown";
  message: string;
  startCommand: string;
  stopCommand: string;
  statusCommand: string;
}

interface ProfileSnapshot {
  repoExists: string;
  gitExists: string;
  branch: string;
  head: string;
  originMain: string;
  dirtyCount: string;
  receiver: string;
  logExists: string;
  commsExists: string;
  inboxExists: string;
  inboxCount: string;
  tokenLength: string;
  remotePanelListening: string;
  remotePanelStatus: string;
  remotePanelReadOnly: string;
  remotePanelSendEnabled: string;
  remotePanelPendingCount: string;
  remotePanelRecentCount: string;
  codexPermissionStatus: string;
  codexPermissionConfigPath: string;
  codexPermissionExpectedMode: string;
  codexPermissionSandboxMode: string;
  codexPermissionNetworkAccess: string;
}

export interface AgentProfileReport extends Record<string, unknown> {
  profile: AgentProfileId;
  label: string;
  agent: string;
  runtimeSurface: "codex-cli" | "remote-panel";
  host: "local" | "ssh";
  status: ProfileStatus;
  summary: string;
  checks: ProfileCheck[];
  nextActions: ProfileNextAction[];
  paths: {
    repoRoot: string;
    commsDir: string;
    receiverLogPath?: string;
  };
  surfaceGuidance: SurfaceGuidance[];
  surfaces: {
    receiverSupervisor?: {
      tmuxSession: string;
      status: string;
    };
    flowSupervisors?: FlowSupervisorReport[];
    headlessRunner?: HeadlessRunnerStatusReport;
    remotePanel?: {
      host: string;
      port: number;
      url: string;
      readOnly: boolean;
      sendEnabled: boolean;
      tokenEnv: string | null;
      status: string;
      listening: boolean;
    };
  };
  snapshot: ProfileSnapshot;
}

type ProfileProbeResult = {
  ok: boolean;
  stdout: string;
  stderr: string;
  status: number | null;
};

type ProfileProbeRunner = (
  profile: ProfileConfig,
  script: string,
  host: "local" | "ssh",
) => ProfileProbeResult;

type FlowSupervisorStatusRunner = (
  supervisor: FlowSupervisorConfig,
) => ProfileProbeResult;

type HeadlessRunnerStatusRunner = (
  runner: HeadlessRunnerStatusConfig,
  profile: CliProfileConfig,
  host: "local" | "ssh",
) => ProfileProbeResult;

let profileProbeRunnerForTests: ProfileProbeRunner | null = null;
let profileLocalPathExistsForTests:
  | ((profile: ProfileConfig) => boolean)
  | null = null;
let flowSupervisorStatusRunnerForTests: FlowSupervisorStatusRunner | null =
  null;
let headlessRunnerStatusRunnerForTests: HeadlessRunnerStatusRunner | null =
  null;
let sumBackLocalHostCheckerForTests: (() => boolean) | null = null;

export function __setProfileProbeRunnerForTests(
  runner: ProfileProbeRunner | null,
): void {
  profileProbeRunnerForTests = runner;
}

export function __setProfileLocalPathExistsForTests(
  checker: ((profile: ProfileConfig) => boolean) | null,
): void {
  profileLocalPathExistsForTests = checker;
}

export function __setFlowSupervisorStatusRunnerForTests(
  runner: FlowSupervisorStatusRunner | null,
): void {
  flowSupervisorStatusRunnerForTests = runner;
}

export function __setHeadlessRunnerStatusRunnerForTests(
  runner: HeadlessRunnerStatusRunner | null,
): void {
  headlessRunnerStatusRunnerForTests = runner;
}

export function __setSumBackLocalHostCheckerForTests(
  checker: (() => boolean) | null,
): void {
  sumBackLocalHostCheckerForTests = checker;
}

interface ResolvedStatus {
  status: string;
  lifecycle: BridgeLifecycleSnapshot | null;
  session: CodexSessionSnapshot | null;
  warnings: string[];
}

function resolveStatus(
  inst: InstanceState,
  liveDispatchAliases: string[],
  stateDir: string,
  commsDir: string,
): ResolvedStatus {
  if (!inst.installed) {
    return {
      status: "not installed",
      lifecycle: null,
      session: null,
      warnings: [],
    };
  }

  switch (inst.bridgeMode) {
    case "native-push":
    case "polling":
      return {
        status: inst.lastVerifiedAt ? "active" : "configured",
        lifecycle: null,
        session: null,
        warnings: [],
      };

    case "app-server": {
      let staleLifecycle: BridgeLifecycleSnapshot | null = null;
      if (inst.bridge) {
        const lifecycle = resolveBridgeLifecycleSnapshot(
          stateDir,
          inst.instanceId,
          inst.bridge,
        );
        if (lifecycle.status === "bridge-stale") {
          staleLifecycle = lifecycle;
          inst.bridge = null;
        } else {
          const runtimeHeartbeat = loadRuntimeBridgeHeartbeat(inst.bridge);
          return {
            status: "active",
            lifecycle,
            session: deriveCodexSessionState({
              runtimeHeartbeat,
              runtimeStateDir: inst.bridge.runtimeStateDir ?? null,
            }),
            warnings: [],
          };
        }
      }
      const liveDispatch = loadLiveDispatchEvidence(
        commsDir,
        inst.instanceId,
        liveDispatchAliases,
      );
      if (liveDispatch) {
        return {
          status: "dispatch-live",
          lifecycle: deriveBridgeLifecycleState({
            bridgeStatus: "stopped",
          }),
          session: deriveCodexSessionState({ runtimeHeartbeat: null }),
          warnings: [
            `fresh bridge-dispatch heartbeat from PID ${liveDispatch.bridgePid} without bridge pid state`,
          ],
        };
      }
      if (staleLifecycle) {
        return {
          status: inst.lastVerifiedAt ? "configured" : "installed",
          lifecycle: staleLifecycle,
          session: null,
          warnings: [],
        };
      }
      return {
        status: inst.lastVerifiedAt ? "configured" : "installed",
        lifecycle: deriveBridgeLifecycleState({
          bridgeStatus: "stopped",
        }),
        session: deriveCodexSessionState({ runtimeHeartbeat: null }),
        warnings: [],
      };
    }

    default:
      return {
        status: "installed",
        lifecycle: null,
        session: null,
        warnings: [],
      };
  }
}

function surfaceGuidanceForProfile(profile: ProfileConfig): SurfaceGuidance[] {
  const base: SurfaceGuidance[] = [
    {
      id: "durable-live-boundary",
      label: "Durable evidence is separate from live delivery",
      summary:
        "Inbox/projection/uplink evidence is audit and fallback evidence; inspect the live runtime surface separately before claiming an App turn or model execution.",
      nextAction:
        "Use tap comms-doctor --json for live-vs-durable delivery diagnostics.",
    },
    {
      id: "consent-drive-boundary",
      label: "Consent-drive is strict-gated",
      summary:
        "Codex App IPC/consent-drive is an experimental live adapter and requires fresh route evidence plus explicit runtime health; tuple shape alone is not delivery authority.",
      nextAction:
        "Run tap setup --profile codex-app with a concrete --agent value, or use tap comms-doctor --surface app --json for App route checks.",
    },
  ];

  if (profile.kind === "codex-cli") {
    return [
      {
        id: "receiver-promoter-backbone",
        label: "Receiver/promoter is the portable CLI path",
        summary:
          "CLI/TUI/headless delivery uses durable inbox evidence followed by receiver/promoter gates; active turns must remain queued or blocked rather than defaulting to steer.",
        nextAction: `Use tap receiver check --agent ${profile.agent} --json for receiver queue evidence.`,
      },
      ...base,
    ];
  }

  return [
    {
      id: "remote-panel-boundary",
      label: "Remote panel is an operator surface",
      summary:
        "Remote panel status can expose durable state, but it is not proof of consent-drive delivery or receiver promotion.",
      nextAction: "Use tap comms-doctor --json to choose the delivery surface.",
    },
    ...base,
  ];
}

function instanceStatusLine(
  inst: InstanceState,
  status: string,
  lifecycle: BridgeLifecycleSnapshot | null,
  session: CodexSessionSnapshot | null,
  warnings: string[],
): string {
  const bridgeInfo = inst.bridge ? ` (pid: ${inst.bridge.pid})` : "";
  const lifecycleStr = lifecycle?.status ?? "-";
  const sessionStr = session?.status ?? "-";
  const mode = inst.bridgeMode;
  const portStr = inst.port ? ` port:${inst.port}` : "";
  const restart = inst.restartRequired ? " [restart required]" : "";
  const warns = warnings.length > 0 ? ` [${warnings.length} warning(s)]` : "";

  return `${inst.instanceId.padEnd(20)} ${inst.runtime.padEnd(8)} ${status.padEnd(14)} ${lifecycleStr.padEnd(20)} ${sessionStr.padEnd(18)} ${mode.padEnd(14)}${bridgeInfo}${portStr}${restart}${warns}`;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function profilePathExistsLocally(profile: ProfileConfig): boolean {
  if (profileLocalPathExistsForTests) {
    return profileLocalPathExistsForTests(profile);
  }
  return fs.existsSync(profile.repoRoot);
}

function resolveProfileHost(profile: ProfileConfig): "local" | "ssh" {
  if (!profile.sshTarget) {
    return "local";
  }
  return profilePathExistsLocally(profile) ? "local" : "ssh";
}

function wrapProfileCommand(
  profile: ProfileConfig,
  host: "local" | "ssh",
  command: string,
): string {
  const localCommand = `cd ${profile.repoRoot} && ${command}`;
  if (host === "local" || !profile.sshTarget) {
    return localCommand;
  }
  return `ssh ${profile.sshTarget} ${shellQuote(localCommand)}`;
}

function profileStartCommand(
  profile: CliProfileConfig,
  host: "local" | "ssh",
): string {
  return wrapProfileCommand(
    profile,
    host,
    `bash scripts/tap-receiver-supervisor.sh ${profile.id} --tmux --state-name ${profile.supervisorStateName} --app-server-url ${profile.appServerUrl} --interval-ms 1000 --max-promotions 1`,
  );
}

function profileSyncCommand(
  profile: ProfileConfig,
  host: "local" | "ssh",
): string {
  return wrapProfileCommand(
    profile,
    host,
    "git fetch origin main && git merge --ff-only origin/main && pnpm --filter @hua-labs/tap build",
  );
}

function isSumBackLocalHost(): boolean {
  if (sumBackLocalHostCheckerForTests) {
    return sumBackLocalHostCheckerForTests();
  }
  return fs.existsSync("/home/devin/hua-platform");
}

function wrapFlowSupervisorCommand(command: string): string {
  return isSumBackLocalHost() ? command : `ssh sum-back ${shellQuote(command)}`;
}

function runFlowSupervisorStatus(
  supervisor: FlowSupervisorConfig,
): ProfileProbeResult {
  if (flowSupervisorStatusRunnerForTests) {
    return flowSupervisorStatusRunnerForTests(supervisor);
  }
  const command =
    supervisor.host === "sum-back"
      ? wrapFlowSupervisorCommand(supervisor.statusCommand)
      : supervisor.statusCommand;
  const result = childProcess.spawnSync("bash", ["-lc", command], {
    encoding: "utf8",
    timeout: 8000,
  });
  return {
    ok: result.status === 0,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    status: result.status,
  };
}

function summarizeFlowSupervisor(
  supervisor: FlowSupervisorConfig,
): FlowSupervisorReport {
  const result = runFlowSupervisorStatus(supervisor);
  const output = `${result.stdout}\n${result.stderr}`.trim();
  const status: FlowSupervisorReport["status"] = new RegExp(
    `running:\\s*${supervisor.tmuxSession.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
  ).test(output)
    ? "running"
    : new RegExp(
          `(stopped|not running):\\s*${supervisor.tmuxSession.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
        ).test(output)
      ? "stopped"
      : "unknown";
  return {
    id: supervisor.id,
    label: supervisor.label,
    host: supervisor.host,
    tmuxSession: supervisor.tmuxSession,
    status,
    message:
      status === "running"
        ? `${supervisor.tmuxSession} is running`
        : status === "stopped"
          ? `${supervisor.tmuxSession} is not running`
          : output
            ? `could not classify ${supervisor.tmuxSession}: ${output}`
            : `could not inspect ${supervisor.tmuxSession}`,
    startCommand:
      supervisor.host === "sum-back"
        ? wrapFlowSupervisorCommand(supervisor.startCommand)
        : supervisor.startCommand,
    statusCommand:
      supervisor.host === "sum-back"
        ? wrapFlowSupervisorCommand(supervisor.statusCommand)
        : supervisor.statusCommand,
  };
}

function runHeadlessRunnerStatus(
  runner: HeadlessRunnerStatusConfig,
  profile: CliProfileConfig,
  host: "local" | "ssh",
): ProfileProbeResult {
  if (headlessRunnerStatusRunnerForTests) {
    return headlessRunnerStatusRunnerForTests(runner, profile, host);
  }
  const command = wrapProfileCommand(profile, host, runner.statusCommand);
  const result = childProcess.spawnSync("bash", ["-lc", command], {
    encoding: "utf8",
    timeout: 8000,
  });
  return {
    ok: result.status === 0,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    status: result.status,
  };
}

function summarizeHeadlessRunner(
  runner: HeadlessRunnerStatusConfig,
  profile: CliProfileConfig,
  host: "local" | "ssh",
): HeadlessRunnerStatusReport {
  const result = runHeadlessRunnerStatus(runner, profile, host);
  const output = `${result.stdout}\n${result.stderr}`.trim();
  const escapedSession = runner.tmuxSession.replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&",
  );
  const status: HeadlessRunnerStatusReport["status"] = new RegExp(
    `running:\\s*${escapedSession}`,
  ).test(output)
    ? "running"
    : new RegExp(`(stopped|not running):\\s*${escapedSession}`).test(output)
      ? "stopped"
      : "unknown";
  return {
    profile: runner.profile,
    tmuxSession: runner.tmuxSession,
    status,
    message:
      status === "running"
        ? `${runner.tmuxSession} is running`
        : status === "stopped"
          ? `${runner.tmuxSession} is not running`
          : output
            ? `could not classify ${runner.tmuxSession}: ${output}`
            : `could not inspect ${runner.tmuxSession}`,
    startCommand: wrapProfileCommand(profile, host, runner.startCommand),
    stopCommand: wrapProfileCommand(profile, host, runner.stopCommand),
    statusCommand: wrapProfileCommand(profile, host, runner.statusCommand),
  };
}

function buildProfileProbeScript(profile: CliProfileConfig): string {
  const repo = shellQuote(profile.repoRoot);
  const comms = shellQuote(profile.commsDir);
  const receiver = shellQuote(profile.receiverSession);
  const logPath = shellQuote(profile.receiverLogPath);
  const expectedPermissionMode = shellQuote(profile.expectedPermissionMode);

  return `
repo=${repo}
comms=${comms}
receiver=${receiver}
log_path=${logPath}
expected_permission_mode=${expectedPermissionMode}

if [ -d "$repo" ]; then echo repoExists=yes; else echo repoExists=no; fi
if [ -d "$repo/.git" ]; then echo gitExists=yes; else echo gitExists=no; fi
if [ -d "$comms" ]; then echo commsExists=yes; else echo commsExists=no; fi
if [ -d "$comms/inbox" ]; then echo inboxExists=yes; else echo inboxExists=no; fi

if [ -d "$repo/.git" ]; then
  cd "$repo" || exit 0
  echo branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"
  echo head="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
  echo originMain="$(git rev-parse --short origin/main 2>/dev/null || echo unknown)"
  echo dirtyCount="$(git status --short 2>/dev/null | wc -l | tr -d ' ')"
else
  echo branch=unknown
  echo head=unknown
  echo originMain=unknown
  echo dirtyCount=unknown
fi

if command -v tmux >/dev/null 2>&1 && tmux has-session -t "$receiver" >/dev/null 2>&1; then
  echo receiver=running
else
  echo receiver=stopped
fi

if [ -f "$log_path" ]; then echo logExists=yes; else echo logExists=no; fi
codex_config="\${CODEX_HOME:-$HOME/.codex}/config.toml"
echo codexPermissionConfigPath="$codex_config"
echo codexPermissionExpectedMode="$expected_permission_mode"
if [ ! -f "$codex_config" ]; then
  echo codexPermissionStatus=missing-config
  echo codexPermissionSandboxMode=missing
  echo codexPermissionNetworkAccess=missing
else
  sandbox_mode="$(awk '
    /^\\[sandbox\\]$/ { in_table=1; next }
    /^\\[/ { in_table=0 }
    in_table && $1 == "mode" {
      value=$0
      sub(/^[^=]*=/, "", value)
      sub(/#.*/, "", value)
      gsub(/[[:space:]"]/, "", value)
      print value
      exit
    }
  ' "$codex_config")"
  network_access="$(awk '
    /^\\[sandbox\\]$/ { in_table=1; next }
    /^\\[/ { in_table=0 }
    in_table && $1 == "network_access" {
      value=$0
      sub(/^[^=]*=/, "", value)
      sub(/#.*/, "", value)
      gsub(/[[:space:]"]/, "", value)
      print value
      exit
    }
  ' "$codex_config")"
  [ "$sandbox_mode" = "" ] && sandbox_mode=missing
  [ "$network_access" = "" ] && network_access=missing
  echo codexPermissionSandboxMode="$sandbox_mode"
  echo codexPermissionNetworkAccess="$network_access"
  if [ "$expected_permission_mode" = "full" ]; then
    if [ "$sandbox_mode" = "danger-full-access" ]; then
      echo codexPermissionStatus=ready
    else
      echo codexPermissionStatus=downgraded
    fi
  else
    if [ "$sandbox_mode" = "workspace-write" ] && [ "$network_access" = "full" ]; then
      echo codexPermissionStatus=ready
    else
      echo codexPermissionStatus=downgraded
    fi
  fi
fi
if [ -d "$comms/inbox" ]; then
  echo inboxCount="$(find "$comms/inbox" -maxdepth 1 -type f -name '*.md' 2>/dev/null | wc -l | tr -d ' ')"
else
  echo inboxCount=unknown
fi
`.trim();
}

function parseProfileSnapshot(stdout: string): ProfileSnapshot {
  const values: Record<string, string> = {};
  for (const line of stdout.split(/\r?\n/)) {
    const idx = line.indexOf("=");
    if (idx <= 0) continue;
    values[line.slice(0, idx)] = line.slice(idx + 1);
  }

  return {
    repoExists: values.repoExists ?? "unknown",
    gitExists: values.gitExists ?? "unknown",
    branch: values.branch ?? "unknown",
    head: values.head ?? "unknown",
    originMain: values.originMain ?? "unknown",
    dirtyCount: values.dirtyCount ?? "unknown",
    receiver: values.receiver ?? "unknown",
    logExists: values.logExists ?? "unknown",
    commsExists: values.commsExists ?? "unknown",
    inboxExists: values.inboxExists ?? "unknown",
    inboxCount: values.inboxCount ?? "unknown",
    tokenLength: values.tokenLength ?? "unknown",
    remotePanelListening: values.remotePanelListening ?? "unknown",
    remotePanelStatus: values.remotePanelStatus ?? "unknown",
    remotePanelReadOnly: values.remotePanelReadOnly ?? "unknown",
    remotePanelSendEnabled: values.remotePanelSendEnabled ?? "unknown",
    remotePanelPendingCount: values.remotePanelPendingCount ?? "unknown",
    remotePanelRecentCount: values.remotePanelRecentCount ?? "unknown",
    codexPermissionStatus: values.codexPermissionStatus ?? "unknown",
    codexPermissionConfigPath: values.codexPermissionConfigPath ?? "unknown",
    codexPermissionExpectedMode:
      values.codexPermissionExpectedMode ?? "unknown",
    codexPermissionSandboxMode: values.codexPermissionSandboxMode ?? "unknown",
    codexPermissionNetworkAccess:
      values.codexPermissionNetworkAccess ?? "unknown",
  };
}

function buildRemotePanelProbeScript(
  profile: RemotePanelProfileConfig,
): string {
  const repo = shellQuote(profile.repoRoot);
  const comms = shellQuote(profile.commsDir);
  const host = shellQuote(profile.host);
  const urlHost = shellQuote(formatRemotePanelUrlHost(profile.host));
  const port = shellQuote(profile.port.toString());
  const tokenEnv = shellQuote(profile.tokenEnv ?? "");

  return `
repo=${repo}
comms=${comms}
host=${host}
url_host=${urlHost}
port=${port}
token_env=${tokenEnv}

if [ -d "$repo" ]; then echo repoExists=yes; else echo repoExists=no; fi
if [ -d "$repo/.git" ]; then echo gitExists=yes; else echo gitExists=no; fi
if [ -d "$comms" ]; then echo commsExists=yes; else echo commsExists=no; fi
if [ -d "$comms/inbox" ]; then echo inboxExists=yes; else echo inboxExists=no; fi

if [ -d "$repo/.git" ]; then
  cd "$repo" || exit 0
  echo branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"
  echo head="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
  echo originMain="$(git rev-parse --short origin/main 2>/dev/null || echo unknown)"
  echo dirtyCount="$(git status --short 2>/dev/null | wc -l | tr -d ' ')"
else
  echo branch=unknown
  echo head=unknown
  echo originMain=unknown
  echo dirtyCount=unknown
fi

if [ -d "$comms/inbox" ]; then
  echo inboxCount="$(find "$comms/inbox" -maxdepth 1 -type f -name '*.md' 2>/dev/null | wc -l | tr -d ' ')"
else
  echo inboxCount=unknown
fi

if [ "$token_env" != "" ]; then
  token_value="$(printenv "$token_env" 2>/dev/null || true)"
  echo tokenLength="$(printf '%s' "$token_value" | wc -c | tr -d ' ')"
else
  echo tokenLength=unknown
fi

snapshot_url="http://$url_host:$port/api/snapshot"
if command -v curl >/dev/null 2>&1; then
  snapshot="$(curl -fsS --max-time 2 "$snapshot_url" 2>/dev/null || true)"
else
  snapshot=""
fi

if [ "$snapshot" != "" ]; then
  echo remotePanelListening=yes
  printf '%s' "$snapshot" | node -e '
let raw = "";
process.stdin.on("data", (chunk) => raw += chunk);
process.stdin.on("end", () => {
  try {
    const snapshot = JSON.parse(raw);
    console.log("remotePanelStatus=" + (snapshot.status ?? "unknown"));
    console.log("remotePanelReadOnly=" + (snapshot.readOnly === true ? "yes" : snapshot.readOnly === false ? "no" : "unknown"));
    console.log("remotePanelSendEnabled=" + (snapshot.sendEnabled === true ? "yes" : snapshot.sendEnabled === false ? "no" : "unknown"));
    console.log("remotePanelPendingCount=" + (snapshot.receiver?.pendingCount ?? "unknown"));
    console.log("remotePanelRecentCount=" + (Array.isArray(snapshot.messages) ? snapshot.messages.length : "unknown"));
  } catch {
    console.log("remotePanelStatus=invalid-json");
    console.log("remotePanelReadOnly=unknown");
    console.log("remotePanelSendEnabled=unknown");
    console.log("remotePanelPendingCount=unknown");
    console.log("remotePanelRecentCount=unknown");
  }
});
'
else
  echo remotePanelListening=no
  echo remotePanelStatus=not-listening
  echo remotePanelReadOnly=unknown
  echo remotePanelSendEnabled=unknown
  echo remotePanelPendingCount=unknown
  echo remotePanelRecentCount=unknown
fi
`.trim();
}

function runProfileProbe(profile: ProfileConfig): {
  ok: boolean;
  stdout: string;
  stderr: string;
  status: number | null;
} {
  const script =
    profile.kind === "remote-panel"
      ? buildRemotePanelProbeScript(profile)
      : buildProfileProbeScript(profile);
  const host = resolveProfileHost(profile);
  if (profileProbeRunnerForTests) {
    return profileProbeRunnerForTests(profile, script, host);
  }
  const result =
    host === "ssh" && profile.sshTarget
      ? childProcess.spawnSync(
          "ssh",
          [profile.sshTarget, `sh -lc ${shellQuote(script)}`],
          {
            encoding: "utf8",
            timeout: 8000,
          },
        )
      : childProcess.spawnSync("sh", ["-lc", script], {
          encoding: "utf8",
          timeout: 8000,
        });

  return {
    ok: result.status === 0,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    status: result.status,
  };
}

function deriveProfileStatus(checks: ProfileCheck[]): ProfileStatus {
  if (checks.some((check) => check.status === "fail")) {
    return "blocked";
  }
  if (checks.some((check) => check.status === "warn")) {
    return "degraded";
  }
  return "ready";
}

function addRepoChecks(
  profile: ProfileConfig,
  host: "local" | "ssh",
  snapshot: ProfileSnapshot,
  checks: ProfileCheck[],
): void {
  checks.push({
    name: "repo",
    status:
      snapshot.repoExists === "yes" && snapshot.gitExists === "yes"
        ? "pass"
        : "fail",
    message:
      snapshot.repoExists === "yes" && snapshot.gitExists === "yes"
        ? `repo found on ${snapshot.branch} at ${snapshot.head}`
        : `repo missing or not a git checkout at ${profile.repoRoot}`,
  });

  checks.push({
    name: "repo-sync",
    status:
      snapshot.head !== "unknown" && snapshot.head === snapshot.originMain
        ? "pass"
        : "warn",
    message:
      snapshot.originMain === "unknown"
        ? "origin/main could not be resolved"
        : snapshot.head === snapshot.originMain
          ? `HEAD matches origin/main (${snapshot.head})`
          : `HEAD ${snapshot.head} differs from origin/main ${snapshot.originMain}`,
    nextActions:
      snapshot.head !== "unknown" && snapshot.head === snapshot.originMain
        ? []
        : [
            {
              label: "Sync profile repo",
              command: profileSyncCommand(profile, host),
            },
          ],
  });

  checks.push({
    name: "repo-clean",
    status: snapshot.dirtyCount === "0" ? "pass" : "warn",
    message:
      snapshot.dirtyCount === "0"
        ? "worktree is clean"
        : snapshot.dirtyCount === "unknown"
          ? "worktree dirty state could not be read"
          : `worktree has ${snapshot.dirtyCount} changed path(s)`,
    nextActions:
      snapshot.dirtyCount === "0"
        ? []
        : [
            {
              label: "Inspect profile worktree",
              command: profile.sshTarget
                ? `ssh ${profile.sshTarget} 'cd ${profile.repoRoot} && git status --short --branch'`
                : `cd ${profile.repoRoot} && git status --short --branch`,
            },
          ],
  });
}

function addCommsInboxCheck(
  profile: ProfileConfig,
  snapshot: ProfileSnapshot,
  checks: ProfileCheck[],
): void {
  checks.push({
    name: "comms-inbox",
    status:
      snapshot.commsExists === "yes" && snapshot.inboxExists === "yes"
        ? "pass"
        : "fail",
    message:
      snapshot.commsExists === "yes" && snapshot.inboxExists === "yes"
        ? `inbox visible with ${snapshot.inboxCount} file(s)`
        : `comms inbox missing at ${profile.commsDir}/inbox`,
  });
}

function buildBlockedProfileReport(
  profile: ProfileConfig,
  host: "local" | "ssh",
  probe: ProfileProbeResult,
): AgentProfileReport {
  const snapshot = parseProfileSnapshot(probe.stdout);
  const checks: ProfileCheck[] = [
    {
      name: "host",
      status: "fail",
      message: `profile probe failed${probe.status === null ? "" : ` with exit ${probe.status}`}`,
      nextActions: [
        {
          label: "Retry profile probe",
          command: `tap status --profile ${profile.id} --json`,
        },
      ],
    },
  ];
  const status = deriveProfileStatus(checks);
  return {
    profile: profile.id,
    label: profile.label,
    agent: profile.agent,
    runtimeSurface: profile.runtimeSurface,
    host,
    status,
    summary: `Blocked: cannot inspect ${profile.label}.`,
    checks,
    nextActions: checks.flatMap((check) => check.nextActions ?? []),
    paths: {
      repoRoot: profile.repoRoot,
      commsDir: profile.commsDir,
      ...(profile.kind === "codex-cli"
        ? { receiverLogPath: profile.receiverLogPath }
        : {}),
    },
    surfaceGuidance: surfaceGuidanceForProfile(profile),
    surfaces:
      profile.kind === "codex-cli"
        ? {
            receiverSupervisor: {
              tmuxSession: profile.receiverSession,
              status: snapshot.receiver,
            },
          }
        : {
            remotePanel: {
              host: profile.host,
              port: profile.port,
              url: `http://${formatRemotePanelUrlHost(profile.host)}:${profile.port}`,
              readOnly: profile.readOnly,
              sendEnabled: profile.sendEnabled,
              tokenEnv: profile.tokenEnv ?? null,
              status: snapshot.remotePanelStatus,
              listening: snapshot.remotePanelListening === "yes",
            },
          },
    snapshot,
  };
}

function buildCliProfileReport(
  profile: CliProfileConfig,
  host: "local" | "ssh",
  snapshot: ProfileSnapshot,
): AgentProfileReport {
  const checks: ProfileCheck[] = [];
  const flowSupervisors = (profile.flowSupervisors ?? []).map(
    summarizeFlowSupervisor,
  );
  const headlessRunner = profile.headlessRunner
    ? summarizeHeadlessRunner(profile.headlessRunner, profile, host)
    : null;

  addRepoChecks(profile, host, snapshot, checks);

  checks.push({
    name: "receiver-supervisor",
    status: snapshot.receiver === "running" ? "pass" : "fail",
    message:
      snapshot.receiver === "running"
        ? `${profile.receiverSession} is running`
        : `${profile.receiverSession} is not running`,
    nextActions:
      snapshot.receiver === "running"
        ? []
        : [
            {
              label: "Start receiver supervisor",
              command: profileStartCommand(profile, host),
            },
          ],
  });

  for (const supervisor of flowSupervisors) {
    checks.push({
      name: `flow-supervisor-${supervisor.id}`,
      status: supervisor.status === "running" ? "pass" : "fail",
      message: supervisor.message,
      nextActions:
        supervisor.status === "running"
          ? []
          : [
              {
                label: `Start ${supervisor.label}`,
                command: supervisor.startCommand,
              },
            ],
    });
  }

  if (headlessRunner) {
    checks.push({
      name: "headless-runner-standing",
      status: headlessRunner.status === "unknown" ? "warn" : "pass",
      message: headlessRunner.message,
      nextActions:
        headlessRunner.status === "running"
          ? [
              {
                label: "Stop headless runner",
                command: headlessRunner.stopCommand,
              },
            ]
          : [
              {
                label: "Start headless runner",
                command: headlessRunner.startCommand,
              },
            ],
    });
  }

  addCommsInboxCheck(profile, snapshot, checks);

  const permissionReady = snapshot.codexPermissionStatus === "ready";
  checks.push({
    name: "codex-permission-profile",
    status: permissionReady ? "pass" : "fail",
    message: permissionReady
      ? `Codex permission profile is ${snapshot.codexPermissionExpectedMode}; sandbox.mode=${snapshot.codexPermissionSandboxMode}`
      : `Codex permission profile is not ready: status=${snapshot.codexPermissionStatus}, expected=${snapshot.codexPermissionExpectedMode}, sandbox.mode=${snapshot.codexPermissionSandboxMode}, network_access=${snapshot.codexPermissionNetworkAccess}, config=${snapshot.codexPermissionConfigPath}`,
    nextActions: permissionReady
      ? []
      : [
          {
            label: "Inspect Codex permission profile",
            command: wrapProfileCommand(
              profile,
              host,
              "rg -n 'approval_policy|\\[sandbox\\]|mode|network_access|sandbox_workspace_write' ~/.codex/config.toml",
            ),
          },
        ],
  });

  checks.push({
    name: "receiver-log",
    status: snapshot.logExists === "yes" ? "pass" : "warn",
    message:
      snapshot.logExists === "yes"
        ? `receiver log exists at ${profile.receiverLogPath}`
        : `receiver log not found at ${profile.receiverLogPath}`,
  });

  const status = deriveProfileStatus(checks);
  return {
    profile: profile.id,
    label: profile.label,
    agent: profile.agent,
    runtimeSurface: profile.runtimeSurface,
    host,
    status,
    summary:
      status === "ready"
        ? `${profile.label} is ready.`
        : status === "degraded"
          ? `${profile.label} is usable with warnings.`
          : `${profile.label} is blocked.`,
    checks,
    nextActions: checks.flatMap((check) => check.nextActions ?? []),
    paths: {
      repoRoot: profile.repoRoot,
      commsDir: profile.commsDir,
      receiverLogPath: profile.receiverLogPath,
    },
    surfaceGuidance: surfaceGuidanceForProfile(profile),
    surfaces: {
      receiverSupervisor: {
        tmuxSession: profile.receiverSession,
        status: snapshot.receiver,
      },
      ...(flowSupervisors.length > 0 ? { flowSupervisors } : {}),
      ...(headlessRunner ? { headlessRunner } : {}),
    },
    snapshot,
  };
}

function buildRemotePanelStartCommand(
  profile: RemotePanelProfileConfig,
  host: "local" | "ssh",
): string {
  const mode = profile.sendEnabled
    ? `--send-enabled --token-env ${profile.tokenEnv ?? "<token-env>"}`
    : "--read-only";
  return wrapProfileCommand(
    profile,
    host,
    `node packages/tap-comms/dist/cli.mjs remote-panel --agent ${profile.agent} --comms-dir ${profile.commsDir} --host ${profile.host} --port ${profile.port} ${mode}`,
  );
}

function isRemotePanelSnapshotModeMatchingProfile(
  profile: RemotePanelProfileConfig,
  snapshot: ProfileSnapshot,
): boolean {
  if (snapshot.remotePanelListening !== "yes") return false;
  return (
    (profile.readOnly ? snapshot.remotePanelReadOnly === "yes" : true) &&
    (profile.sendEnabled
      ? snapshot.remotePanelSendEnabled === "yes"
      : snapshot.remotePanelSendEnabled === "no")
  );
}

function buildRemotePanelProfileReport(
  profile: RemotePanelProfileConfig,
  host: "local" | "ssh",
  snapshot: ProfileSnapshot,
): AgentProfileReport {
  const checks: ProfileCheck[] = [];

  addRepoChecks(profile, host, snapshot, checks);
  addCommsInboxCheck(profile, snapshot, checks);

  const bindAllowed = isAllowedRemotePanelBindHost(profile.host);
  checks.push({
    name: "remote-panel-bind",
    status: bindAllowed ? "pass" : "fail",
    message: bindAllowed
      ? `remote panel bind host is private/loopback/Tailscale-safe: ${profile.host}`
      : `remote panel bind host is not allowed: ${profile.host}`,
  });

  if (profile.sendEnabled) {
    const tokenLength = Number(snapshot.tokenLength);
    const tokenReady =
      Number.isInteger(tokenLength) &&
      tokenLength >= 0 &&
      isRemotePanelSendTokenReady("x".repeat(tokenLength));
    checks.push({
      name: "remote-panel-token",
      status: tokenReady ? "pass" : "fail",
      message: tokenReady
        ? `send token env is populated: ${profile.tokenEnv}`
        : `send-enabled remote panel needs ${profile.tokenEnv ?? "<token-env>"} with a token/PIN of at least 4 characters`,
    });
  } else {
    checks.push({
      name: "remote-panel-mode",
      status: "pass",
      message: "read-only remote panel profile; append-only send is disabled.",
    });
  }

  const modeMatches = isRemotePanelSnapshotModeMatchingProfile(
    profile,
    snapshot,
  );
  checks.push({
    name: "remote-panel-http",
    status:
      snapshot.remotePanelListening === "yes"
        ? snapshot.remotePanelStatus === "read-only" ||
          snapshot.remotePanelStatus === "send-enabled"
          ? modeMatches
            ? "pass"
            : "fail"
          : "warn"
        : "fail",
    message:
      snapshot.remotePanelListening === "yes"
        ? modeMatches
          ? `remote panel snapshot reachable with status=${snapshot.remotePanelStatus}, pending=${snapshot.remotePanelPendingCount}, recent=${snapshot.remotePanelRecentCount}`
          : `remote panel mode mismatch: profile readOnly=${profile.readOnly} sendEnabled=${profile.sendEnabled}, snapshot readOnly=${snapshot.remotePanelReadOnly} sendEnabled=${snapshot.remotePanelSendEnabled}`
        : `remote panel is not listening at http://${formatRemotePanelUrlHost(profile.host)}:${profile.port}`,
    nextActions:
      snapshot.remotePanelListening === "yes" && modeMatches
        ? []
        : [
            {
              label:
                snapshot.remotePanelListening === "yes"
                  ? "Restart remote panel with profile mode"
                  : "Start remote panel",
              command: buildRemotePanelStartCommand(profile, host),
            },
          ],
  });
  checks.push({
    name: "remote-panel-snapshot",
    status:
      snapshot.remotePanelListening === "yes"
        ? snapshot.remotePanelStatus === "read-only" ||
          snapshot.remotePanelStatus === "send-enabled"
          ? "pass"
          : "warn"
        : "fail",
    message:
      snapshot.remotePanelListening === "yes"
        ? `remote panel snapshot reachable with status=${snapshot.remotePanelStatus}, pending=${snapshot.remotePanelPendingCount}, recent=${snapshot.remotePanelRecentCount}`
        : `remote panel is not listening at http://${formatRemotePanelUrlHost(profile.host)}:${profile.port}`,
  });

  const status = deriveProfileStatus(checks);
  return {
    profile: profile.id,
    label: profile.label,
    agent: profile.agent,
    runtimeSurface: profile.runtimeSurface,
    host,
    status,
    summary:
      status === "ready"
        ? `${profile.label} is ready.`
        : status === "degraded"
          ? `${profile.label} is usable with warnings.`
          : `${profile.label} is blocked.`,
    checks,
    nextActions: checks.flatMap((check) => check.nextActions ?? []),
    paths: {
      repoRoot: profile.repoRoot,
      commsDir: profile.commsDir,
    },
    surfaceGuidance: surfaceGuidanceForProfile(profile),
    surfaces: {
      remotePanel: {
        host: profile.host,
        port: profile.port,
        url: `http://${formatRemotePanelUrlHost(profile.host)}:${profile.port}`,
        readOnly: profile.readOnly,
        sendEnabled: profile.sendEnabled,
        tokenEnv: profile.tokenEnv ?? null,
        status: snapshot.remotePanelStatus,
        listening: snapshot.remotePanelListening === "yes",
      },
    },
    snapshot,
  };
}

export function buildProfileReport(profile: ProfileConfig): AgentProfileReport {
  const host = resolveProfileHost(profile);
  const probe = runProfileProbe(profile);

  if (!probe.ok) {
    return buildBlockedProfileReport(profile, host, probe);
  }

  const snapshot = parseProfileSnapshot(probe.stdout);
  return profile.kind === "remote-panel"
    ? buildRemotePanelProfileReport(profile, host, snapshot)
    : buildCliProfileReport(profile, host, snapshot);
}

function logProfileReport(report: AgentProfileReport): void {
  logHeader(`tap status --profile ${report.profile}`);
  log(`Status:  ${report.status}`);
  log(`Agent:   ${report.agent}`);
  log(`Surface: ${report.runtimeSurface}`);
  log(`Summary: ${report.summary}`);
  log("");
  for (const check of report.checks) {
    log(`${check.status.padEnd(5)} ${check.name}: ${check.message}`);
  }
  if (report.nextActions.length > 0) {
    log("");
    log("Next actions:");
    for (const action of report.nextActions) {
      log(`- ${action.label}: ${action.command}`);
    }
  }
  if (report.surfaceGuidance.length > 0) {
    log("");
    log("Surface guidance:");
    for (const guidance of report.surfaceGuidance) {
      log(`- ${guidance.label}: ${guidance.summary}`);
    }
  }
}

export async function statusCommand(args: string[]): Promise<CommandResult> {
  if (args.includes("--help") || args.includes("-h")) {
    log(STATUS_HELP);
    return {
      ok: true,
      command: "status",
      code: "TAP_NO_OP",
      message: STATUS_HELP,
      warnings: [],
      data: {},
    };
  }

  const parsed = parseArgs(args);
  const profileFlag = parsed.flags.profile;
  if (profileFlag === true) {
    return {
      ok: false,
      command: "status",
      code: "TAP_STATUS_PROFILE_REQUIRED",
      message: "Missing --profile value.",
      warnings: [`Known profiles: ${Object.keys(AGENT_PROFILES).join(", ")}`],
      data: {
        knownProfiles: Object.keys(AGENT_PROFILES),
      },
    };
  }
  if (typeof profileFlag === "string") {
    const profile = AGENT_PROFILES[profileFlag as AgentProfileId];
    if (!profile) {
      return {
        ok: false,
        command: "status",
        code: "TAP_STATUS_UNKNOWN_PROFILE",
        message: `Unknown status profile: ${profileFlag}`,
        warnings: [`Known profiles: ${Object.keys(AGENT_PROFILES).join(", ")}`],
        data: {
          knownProfiles: Object.keys(AGENT_PROFILES),
        },
      };
    }
    const report = buildProfileReport(profile);
    logProfileReport(report);
    return {
      ok: true,
      command: "status",
      code:
        report.status === "ready"
          ? "TAP_STATUS_PROFILE_READY"
          : report.status === "degraded"
            ? "TAP_STATUS_PROFILE_DEGRADED"
            : "TAP_STATUS_PROFILE_BLOCKED",
      message: report.summary,
      warnings: report.checks
        .filter((check) => check.status === "warn")
        .map((check) => check.message),
      data: report,
    };
  }

  const repoRoot = findRepoRoot();
  const state = loadState(repoRoot);

  if (!state) {
    return {
      ok: false,
      command: "status",
      code: "TAP_NOT_INITIALIZED",
      message: "Not initialized. Run: npx @hua-labs/tap init",
      warnings: [],
      data: {},
    };
  }

  logHeader("@hua-labs/tap status");

  log(`Version:    ${version}`);
  log(`Comms dir:  ${state.commsDir}`);
  log(`Repo root:  ${state.repoRoot}`);
  log(`Schema:     v${state.schemaVersion}`);
  log(`Updated:    ${state.updatedAt}`);

  const installed = getInstalledInstances(state);
  const { config: resolvedCfg } = resolveConfig({}, repoRoot);
  const stateDir = resolvedCfg.stateDir;

  const instances: Record<
    string,
    {
      status: string;
      lifecycle: BridgeLifecycleSnapshot | null;
      session: CodexSessionSnapshot | null;
      runtime: string;
      bridgeMode: string;
      bridge: unknown;
      port: number | null;
      warnings: string[];
    }
  > = {};

  // Track if any stale bridge metadata was cleaned
  const bridgesBefore = installed.map((id) => state.instances[id]?.bridge);

  if (installed.length === 0) {
    log("");
    log("No instances installed.");
    log("Run: npx @hua-labs/tap add <claude|codex|gemini>");
  } else {
    log("");
    log(
      `${"Instance".padEnd(20)} ${"Runtime".padEnd(8)} ${"Status".padEnd(14)} ${"Lifecycle".padEnd(20)} ${"Session".padEnd(18)} ${"Bridge Mode".padEnd(14)} Details`,
    );
    log(
      `${"─".repeat(20)} ${"─".repeat(8)} ${"─".repeat(14)} ${"─".repeat(20)} ${"─".repeat(18)} ${"─".repeat(14)} ${"─".repeat(20)}`,
    );

    for (const id of installed) {
      const inst = state.instances[id];
      if (inst) {
        // resolveStatus may clear inst.bridge if stale
        const { status, lifecycle, session, warnings } = resolveStatus(
          inst,
          resolveUniqueLiveDispatchAliases(state.instances, id),
          stateDir,
          state.commsDir,
        );
        const mergedWarnings = [...inst.warnings, ...warnings];
        log(
          instanceStatusLine(inst, status, lifecycle, session, mergedWarnings),
        );
        if (mergedWarnings.length > 0) {
          for (const w of mergedWarnings) {
            logWarn(`  ${w}`);
          }
        }
        instances[id] = {
          status,
          lifecycle,
          session,
          runtime: inst.runtime,
          bridgeMode: inst.bridgeMode,
          bridge: inst.bridge,
          port: inst.port,
          warnings: mergedWarnings,
        };
      }
    }
  }

  // Persist stale bridge cleanup if any were cleared
  const bridgesAfter = installed.map((id) => state.instances[id]?.bridge);
  const staleCleared = bridgesBefore.some((b, i) => b !== bridgesAfter[i]);
  if (staleCleared) {
    state.updatedAt = new Date().toISOString();
    saveState(repoRoot, state);
  }

  log("");

  return {
    ok: true,
    command: "status",
    code: "TAP_STATUS_OK",
    message: `${installed.length} instance(s) installed`,
    warnings: [],
    data: {
      version,
      commsDir: state.commsDir,
      repoRoot: state.repoRoot,
      instances,
    },
  };
}
