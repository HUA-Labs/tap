import * as path from "node:path";
import { loadState, saveState, updateInstanceState } from "../state.js";
import {
  startBridge,
  stopBridge,
  getBridgeStatus,
  loadBridgeState,
  getHeartbeatAge,
} from "../engine/bridge.js";
import { resolveConfig } from "../config/index.js";
import { getAdapter } from "../adapters/index.js";
import {
  findRepoRoot,
  createAdapterContext,
  resolveInstanceId,
  parseArgs,
  log,
  logSuccess,
  logError,
  logHeader,
} from "../utils.js";
import type {
  InstanceId,
  HeadlessConfig,
  AgentRole,
  CommandResult,
} from "../types.js";

function formatAge(seconds: number): string {
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m ago`;
}

const BRIDGE_HELP = `
Usage:
  tap-comms bridge <subcommand> [instance] [options]

Subcommands:
  start <instance>  Start bridge for an instance (e.g. codex, codex-reviewer)
  stop  <instance>  Stop bridge for an instance
  stop              Stop all running bridges
  status            Show bridge status for all instances
  status <instance> Show bridge status for a specific instance

Options:
  --agent-name <name>              Agent identity for bridge (or set TAP_AGENT_NAME env)
  --busy-mode <steer|wait>         How to handle active turns (default: steer)
  --poll-seconds <n>               Inbox poll interval (default: 5)
  --reconnect-seconds <n>          Reconnect delay after disconnect (default: 5)
  --message-lookback-minutes <n>   Process messages from last N minutes (default: 10)
  --thread-id <id>                 Resume specific thread
  --ephemeral                      Use ephemeral thread (no persistence)
  --process-existing-messages      Process all existing inbox messages

Examples:
  npx @hua-labs/tap bridge start codex --agent-name myAgent
  npx @hua-labs/tap bridge start codex-reviewer --agent-name reviewer --busy-mode steer
  npx @hua-labs/tap bridge stop codex
  npx @hua-labs/tap bridge stop
  npx @hua-labs/tap bridge status
`.trim();

// ─── Subcommand: start ─────────────────────────────────────────

async function bridgeStart(
  identifier: string,
  agentName?: string,
  flags: Record<string, string | boolean | undefined> = {},
): Promise<CommandResult> {
  const repoRoot = findRepoRoot();
  const state = loadState(repoRoot);

  if (!state) {
    return {
      ok: false,
      command: "bridge",
      code: "TAP_NOT_INITIALIZED",
      message: "Not initialized. Run: npx @hua-labs/tap init",
      warnings: [],
      data: {},
    };
  }

  const resolved = resolveInstanceId(identifier, state);
  if (!resolved.ok) {
    return {
      ok: false,
      command: "bridge",
      code: resolved.code,
      message: resolved.message,
      warnings: [],
      data: {},
    };
  }

  const instanceId = resolved.instanceId;
  const instance = state.instances[instanceId];

  if (!instance?.installed) {
    return {
      ok: false,
      command: "bridge",
      instanceId,
      runtime: instance?.runtime,
      code: "TAP_INSTANCE_NOT_FOUND",
      message: `${instanceId} is not installed. Run: npx @hua-labs/tap add ${instance?.runtime ?? identifier}`,
      warnings: [],
      data: {},
    };
  }

  const adapter = getAdapter(instance.runtime);
  const mode = adapter.bridgeMode();

  if (mode !== "app-server") {
    return {
      ok: true,
      command: "bridge",
      instanceId,
      runtime: instance.runtime,
      code: "TAP_NO_OP",
      message: `${instanceId} uses ${mode} mode — no bridge needed.`,
      warnings: [],
      data: { bridgeMode: mode },
    };
  }

  const ctx = createAdapterContext(state.commsDir, repoRoot);
  const bridgeScript = adapter.resolveBridgeScript?.(ctx);

  if (!bridgeScript) {
    return {
      ok: false,
      command: "bridge",
      instanceId,
      runtime: instance.runtime,
      code: "TAP_BRIDGE_SCRIPT_MISSING",
      message: `Bridge script not found for ${instanceId}. Ensure the runtime is properly configured.`,
      warnings: [],
      data: {},
    };
  }

  // Resolve runtime command + appServerUrl from config
  const { config: resolvedConfig } = resolveConfig({}, repoRoot);
  const runtimeCommand = resolvedConfig.runtimeCommand;
  const appServerUrl = resolvedConfig.appServerUrl;

  logHeader(`@hua-labs/tap bridge start ${instanceId}`);
  log(`Bridge script: ${bridgeScript}`);
  log(`Bridge mode:   ${mode}`);
  log(`Runtime cmd:   ${runtimeCommand}`);
  log(`App server:    ${appServerUrl}`);
  if (instance.port) log(`Port:          ${instance.port}`);
  // Show headless status from instance config or --headless flag (resolved below)
  const willBeHeadless =
    flags["headless"] === true || instance.headless?.enabled;
  if (willBeHeadless) {
    const role =
      (typeof flags["role"] === "string" ? flags["role"] : null) ??
      instance.headless?.role ??
      "reviewer";
    log(`Headless:      ${role}`);
  }

  try {
    // Parse bridge operational flags from CLI

    // --busy-mode validation (PS1 parity: ValidateSet("wait", "steer"))
    const busyModeRaw = flags["busy-mode"];
    if (
      busyModeRaw !== undefined &&
      busyModeRaw !== "steer" &&
      busyModeRaw !== "wait"
    ) {
      return {
        ok: false,
        command: "bridge",
        instanceId,
        runtime: instance.runtime,
        code: "TAP_INVALID_ARGUMENT",
        message: `Invalid --busy-mode: ${String(busyModeRaw)}. Must be "steer" or "wait".`,
        warnings: [],
        data: {},
      };
    }
    const busyMode = busyModeRaw as "steer" | "wait" | undefined;
    const pollSeconds =
      typeof flags["poll-seconds"] === "string"
        ? parseInt(flags["poll-seconds"], 10)
        : undefined;
    const reconnectSeconds =
      typeof flags["reconnect-seconds"] === "string"
        ? parseInt(flags["reconnect-seconds"], 10)
        : undefined;
    const messageLookbackMinutes =
      typeof flags["message-lookback-minutes"] === "string"
        ? parseInt(flags["message-lookback-minutes"], 10)
        : undefined;
    const threadId =
      typeof flags["thread-id"] === "string" ? flags["thread-id"] : undefined;
    const ephemeral = flags["ephemeral"] === true;
    const processExistingMessages = flags["process-existing-messages"] === true;

    // --headless flag on bridge start: create ad-hoc headless config
    // even if instance wasn't created with `tap add --headless`
    const headlessFlag = flags["headless"] === true;
    const roleArg =
      typeof flags["role"] === "string" ? flags["role"] : undefined;
    const validRoles: AgentRole[] = ["reviewer", "validator", "long-running"];
    if (roleArg && !validRoles.includes(roleArg as AgentRole)) {
      return {
        ok: false,
        command: "bridge",
        instanceId,
        runtime: instance.runtime,
        code: "TAP_INVALID_ARGUMENT",
        message: `Invalid --role: ${roleArg}. Must be: ${validRoles.join(", ")}`,
        warnings: [],
        data: {},
      };
    }

    const headless: HeadlessConfig | null = headlessFlag
      ? {
          enabled: true,
          role: (roleArg as AgentRole) ?? "reviewer",
          maxRounds: 5,
          qualitySeverityFloor: "high",
        }
      : instance.headless;

    const bridge = await startBridge({
      instanceId,
      runtime: instance.runtime,
      stateDir: ctx.stateDir,
      commsDir: ctx.commsDir,
      bridgeScript,
      platform: ctx.platform,
      agentName,
      runtimeCommand,
      appServerUrl,
      repoRoot,
      port: instance.port ?? undefined,
      headless,
      busyMode,
      pollSeconds,
      reconnectSeconds,
      messageLookbackMinutes,
      threadId,
      ephemeral,
      processExistingMessages,
    });

    logSuccess(`Bridge started (PID: ${bridge.pid})`);
    log(`Log: ${path.join(ctx.stateDir, "logs", `bridge-${instanceId}.log`)}`);

    // Update state with bridge info
    const updated = { ...instance, bridge };
    const newState = updateInstanceState(state, instanceId, updated);
    saveState(repoRoot, newState);

    return {
      ok: true,
      command: "bridge",
      instanceId,
      runtime: instance.runtime,
      code: "TAP_BRIDGE_START_OK",
      message: `Bridge for ${instanceId} started (PID: ${bridge.pid})`,
      warnings: [],
      data: { pid: bridge.pid },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logError(msg);
    return {
      ok: false,
      command: "bridge",
      instanceId,
      runtime: instance.runtime,
      code: "TAP_BRIDGE_START_FAILED",
      message: msg,
      warnings: [],
      data: {},
    };
  }
}

// ─── Subcommand: stop ──────────────────────────────────────────

async function bridgeStopOne(identifier: string): Promise<CommandResult> {
  const repoRoot = findRepoRoot();
  const state = loadState(repoRoot);

  if (!state) {
    return {
      ok: false,
      command: "bridge",
      code: "TAP_NOT_INITIALIZED",
      message: "Not initialized. Run: npx @hua-labs/tap init",
      warnings: [],
      data: {},
    };
  }

  const resolved = resolveInstanceId(identifier, state);
  if (!resolved.ok) {
    return {
      ok: false,
      command: "bridge",
      code: resolved.code,
      message: resolved.message,
      warnings: [],
      data: {},
    };
  }

  const instanceId = resolved.instanceId;
  const ctx = createAdapterContext(state.commsDir, repoRoot);

  logHeader(`@hua-labs/tap bridge stop ${instanceId}`);

  const stopped = await stopBridge({
    instanceId,
    stateDir: ctx.stateDir,
    platform: ctx.platform,
  });

  if (stopped) {
    logSuccess(`Bridge for ${instanceId} stopped`);

    // Clear bridge from state
    const instance = state.instances[instanceId];
    if (instance) {
      const updated = { ...instance, bridge: null };
      const newState = updateInstanceState(state, instanceId, updated);
      saveState(repoRoot, newState);
    }

    return {
      ok: true,
      command: "bridge",
      instanceId,
      code: "TAP_BRIDGE_STOP_OK",
      message: `Bridge for ${instanceId} stopped`,
      warnings: [],
      data: {},
    };
  }

  log(`No running bridge for ${instanceId}`);

  // Clear stale bridge metadata from state even if process was already dead
  const instance = state.instances[instanceId];
  if (instance?.bridge) {
    const updated = { ...instance, bridge: null };
    const newState = updateInstanceState(state, instanceId, updated);
    saveState(repoRoot, newState);
  }

  return {
    ok: true,
    command: "bridge",
    instanceId,
    code: "TAP_BRIDGE_NOT_RUNNING",
    message: `No running bridge for ${instanceId}`,
    warnings: [],
    data: {},
  };
}

async function bridgeStopAll(): Promise<CommandResult> {
  const repoRoot = findRepoRoot();
  const state = loadState(repoRoot);

  if (!state) {
    return {
      ok: false,
      command: "bridge",
      code: "TAP_NOT_INITIALIZED",
      message: "Not initialized. Run: npx @hua-labs/tap init",
      warnings: [],
      data: {},
    };
  }

  const ctx = createAdapterContext(state.commsDir, repoRoot);
  const instanceIds = Object.keys(state.instances) as InstanceId[];
  const stopped: string[] = [];

  logHeader("@hua-labs/tap bridge stop (all)");

  let stateChanged = false;

  for (const instanceId of instanceIds) {
    const didStop = await stopBridge({
      instanceId,
      stateDir: ctx.stateDir,
      platform: ctx.platform,
    });

    if (didStop) {
      logSuccess(`Stopped bridge for ${instanceId}`);
      stopped.push(instanceId);
    }

    // Clear stale bridge metadata regardless of whether process was alive
    const instance = state.instances[instanceId];
    if (instance?.bridge) {
      state.instances[instanceId] = { ...instance, bridge: null };
      stateChanged = true;
    }
  }

  if (stateChanged) {
    state.updatedAt = new Date().toISOString();
    saveState(repoRoot, state);
  }

  const message =
    stopped.length > 0
      ? `Stopped ${stopped.length} bridge(s): ${stopped.join(", ")}`
      : "No running bridges found";

  log(message);

  return {
    ok: true,
    command: "bridge",
    code: stopped.length > 0 ? "TAP_BRIDGE_STOP_OK" : "TAP_BRIDGE_NOT_RUNNING",
    message,
    warnings: [],
    data: { stopped },
  };
}

// ─── Subcommand: status ────────────────────────────────────────

function bridgeStatusAll(): CommandResult {
  const repoRoot = findRepoRoot();
  const state = loadState(repoRoot);

  if (!state) {
    return {
      ok: false,
      command: "bridge",
      code: "TAP_NOT_INITIALIZED",
      message: "Not initialized. Run: npx @hua-labs/tap init",
      warnings: [],
      data: {},
    };
  }

  const { config: resolvedCfg } = resolveConfig({}, repoRoot);
  const stateDir = resolvedCfg.stateDir;
  const instanceIds = Object.keys(state.instances) as InstanceId[];
  const bridges: Record<
    string,
    {
      status: string;
      runtime: string;
      pid: number | null;
      port: number | null;
      lastHeartbeat: string | null;
    }
  > = {};

  logHeader("@hua-labs/tap bridge status");
  log(
    `${"Instance".padEnd(20)} ${"Runtime".padEnd(8)} ${"Status".padEnd(10)} ${"PID".padEnd(8)} ${"Port".padEnd(6)} ${"Last Heartbeat"}`,
  );
  log(
    `${"─".repeat(20)} ${"─".repeat(8)} ${"─".repeat(10)} ${"─".repeat(8)} ${"─".repeat(6)} ${"─".repeat(20)}`,
  );

  for (const instanceId of instanceIds) {
    const inst = state.instances[instanceId];
    if (!inst?.installed) continue;

    if (inst.bridgeMode !== "app-server") {
      log(
        `${instanceId.padEnd(20)} ${inst.runtime.padEnd(8)} ${"n/a".padEnd(10)} ${"-".padEnd(8)} ${"-".padEnd(6)} ${inst.bridgeMode} mode`,
      );
      bridges[instanceId] = {
        status: "n/a",
        runtime: inst.runtime,
        pid: null,
        port: inst.port,
        lastHeartbeat: null,
      };
      continue;
    }

    const status = getBridgeStatus(stateDir, instanceId);
    const bridgeState = loadBridgeState(stateDir, instanceId);
    const age = getHeartbeatAge(stateDir, instanceId);

    const pid = bridgeState?.pid ?? null;
    const heartbeat = bridgeState?.lastHeartbeat ?? null;
    const pidStr = pid ? String(pid) : "-";
    const portStr = inst.port ? String(inst.port) : "-";
    const ageStr = age !== null ? formatAge(age) : "-";

    const statusColor =
      status === "running"
        ? "running"
        : status === "stale"
          ? "stale!"
          : "stopped";

    log(
      `${instanceId.padEnd(20)} ${inst.runtime.padEnd(8)} ${statusColor.padEnd(10)} ${pidStr.padEnd(8)} ${portStr.padEnd(6)} ${ageStr}`,
    );

    bridges[instanceId] = {
      status,
      runtime: inst.runtime,
      pid,
      port: inst.port,
      lastHeartbeat: heartbeat,
    };
  }

  if (instanceIds.length === 0) {
    log("No instances installed.");
  }

  log("");

  return {
    ok: true,
    command: "bridge",
    code: "TAP_BRIDGE_STATUS_OK",
    message: `${instanceIds.length} instance(s) checked`,
    warnings: [],
    data: { bridges },
  };
}

function bridgeStatusOne(identifier: string): CommandResult {
  const repoRoot = findRepoRoot();
  const state = loadState(repoRoot);

  if (!state) {
    return {
      ok: false,
      command: "bridge",
      code: "TAP_NOT_INITIALIZED",
      message: "Not initialized. Run: npx @hua-labs/tap init",
      warnings: [],
      data: {},
    };
  }

  const resolved = resolveInstanceId(identifier, state);
  if (!resolved.ok) {
    return {
      ok: false,
      command: "bridge",
      code: resolved.code,
      message: resolved.message,
      warnings: [],
      data: {},
    };
  }

  const instanceId = resolved.instanceId;
  const inst = state.instances[instanceId];

  if (!inst?.installed) {
    return {
      ok: false,
      command: "bridge",
      instanceId,
      code: "TAP_INSTANCE_NOT_FOUND",
      message: `${instanceId} is not installed.`,
      warnings: [],
      data: {},
    };
  }

  logHeader(`@hua-labs/tap bridge status ${instanceId}`);
  log(`Instance:    ${instanceId}`);
  log(`Runtime:     ${inst.runtime}`);
  log(`Bridge mode: ${inst.bridgeMode}`);
  if (inst.port) log(`Port:        ${inst.port}`);

  // Non-app-server instances don't use bridges
  if (inst.bridgeMode !== "app-server") {
    log(`Status:      n/a (${inst.bridgeMode} mode)`);
    log("");

    return {
      ok: true,
      command: "bridge",
      instanceId,
      runtime: inst.runtime,
      code: "TAP_BRIDGE_STATUS_OK",
      message: `${instanceId} bridge: n/a (${inst.bridgeMode} mode)`,
      warnings: [],
      data: {
        status: "n/a",
        bridgeMode: inst.bridgeMode,
        pid: null,
        port: inst.port,
        lastHeartbeat: null,
      },
    };
  }

  const { config: resolvedCfg2 } = resolveConfig({}, repoRoot);
  const stateDir = resolvedCfg2.stateDir;
  const status = getBridgeStatus(stateDir, instanceId);
  const bridgeState = loadBridgeState(stateDir, instanceId);
  const age = getHeartbeatAge(stateDir, instanceId);

  log(`Status:      ${status}`);

  if (bridgeState) {
    log(`PID:         ${bridgeState.pid}`);
    log(
      `Heartbeat:   ${bridgeState.lastHeartbeat}${age !== null ? ` (${formatAge(age)})` : ""}`,
    );
    log(
      `Log:         ${path.join(stateDir, "logs", `bridge-${instanceId}.log`)}`,
    );
  }

  log("");

  return {
    ok: true,
    command: "bridge",
    instanceId,
    runtime: inst.runtime,
    code: "TAP_BRIDGE_STATUS_OK",
    message: `${instanceId} bridge: ${status}`,
    warnings: [],
    data: {
      status,
      bridgeMode: inst.bridgeMode,
      pid: bridgeState?.pid ?? null,
      port: inst.port,
      lastHeartbeat: bridgeState?.lastHeartbeat ?? null,
    },
  };
}

// ─── Command Router ────────────────────────────────────────────

export async function bridgeCommand(args: string[]): Promise<CommandResult> {
  const { positional, flags } = parseArgs(args);
  const subcommand = positional[0];
  const identifierArg = positional[1];
  const agentName =
    typeof flags["agent-name"] === "string" ? flags["agent-name"] : undefined;

  if (!subcommand || subcommand === "--help" || subcommand === "-h") {
    log(BRIDGE_HELP);
    return {
      ok: true,
      command: "bridge",
      code: "TAP_NO_OP",
      message: BRIDGE_HELP,
      warnings: [],
      data: {},
    };
  }

  switch (subcommand) {
    case "start": {
      if (!identifierArg) {
        return {
          ok: false,
          command: "bridge",
          code: "TAP_INVALID_ARGUMENT",
          message:
            "Missing instance. Usage: npx @hua-labs/tap bridge start <instance>",
          warnings: [],
          data: {},
        };
      }
      return bridgeStart(identifierArg, agentName, flags);
    }

    case "stop": {
      if (!identifierArg) {
        return bridgeStopAll();
      }
      return bridgeStopOne(identifierArg);
    }

    case "status": {
      if (identifierArg) {
        return bridgeStatusOne(identifierArg);
      }
      return bridgeStatusAll();
    }

    default:
      return {
        ok: false,
        command: "bridge",
        code: "TAP_INVALID_ARGUMENT",
        message: `Unknown bridge subcommand: ${subcommand}. Use: start, stop, status`,
        warnings: [],
        data: {},
      };
  }
}
