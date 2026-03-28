import * as path from "node:path";
import { loadState, saveState, updateInstanceState } from "../state.js";
import {
  startBridge,
  stopBridge,
  restartBridge,
  inferRestartMode,
  getBridgeStatus,
  loadBridgeState,
  getHeartbeatAge,
  getBridgeHeartbeatTimestamp,
  loadRuntimeBridgeHeartbeat,
  loadRuntimeBridgeThreadState,
  saveBridgeState,
  stopManagedAppServer,
  resolveAppServerUrl,
  checkAppServerHealth,
  findNextAvailableAppServerPort,
  waitForPortRelease,
  getTurnInfo,
  isTurnStuck,
} from "../engine/bridge.js";
import { resolveConfig } from "../config/index.js";
import { getAdapter } from "../adapters/index.js";
import {
  findRepoRoot,
  createAdapterContext,
  resolveInstanceId,
  parseArgs,
  parseIntFlag,
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
  AppServerState,
  BridgeState,
  TapState,
} from "../types.js";

function formatAge(seconds: number): string {
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m ago`;
}

const BRIDGE_HELP = `
Usage:
  tap bridge <subcommand> [instance] [options]

Subcommands:
  start <instance>  Start bridge for an instance (e.g. codex, codex-reviewer)
  start --all       Start all registered app-server instances
  stop  <instance>  Stop bridge for an instance
  stop              Stop all running bridges
  status            Show bridge status for all instances
  status <instance> Show bridge status for a specific instance
  watch             Monitor bridges and auto-restart stuck/stale ones

Options:
  --agent-name <name>              Agent identity for bridge (or set TAP_AGENT_NAME env)
                                   Overrides the stored name from 'tap add' when needed
  --all                            Start all registered app-server instances
  --busy-mode <steer|wait>         How to handle active turns (default: steer)
  --poll-seconds <n>               Inbox poll interval (default: 5)
  --reconnect-seconds <n>          Reconnect delay after disconnect (default: 5)
  --message-lookback-minutes <n>   Process messages from last N minutes (default: 10)
  --thread-id <id>                 Resume specific thread
  --ephemeral                      Use ephemeral thread (no persistence)
  --process-existing-messages      Process all existing inbox messages
  --no-server                      Skip app-server auto-start and connect only
  --no-auth                        Skip auth gateway (app-server listens directly, localhost only)

Port Assignment:
  Ports are auto-assigned from 4501 on first bridge start if not set via --port
  during 'tap add'. Auto-assigned ports are saved to state for future starts.

Examples:
  npx @hua-labs/tap bridge start codex --agent-name myAgent
  npx @hua-labs/tap bridge start --all
  npx @hua-labs/tap bridge start codex --agent-name myAgent --no-server
  npx @hua-labs/tap bridge start codex-reviewer --agent-name reviewer --busy-mode steer
  npx @hua-labs/tap bridge stop codex
  npx @hua-labs/tap bridge stop
  npx @hua-labs/tap bridge status
`.trim();

function formatAppServerState(appServer: AppServerState): string {
  const ownership = appServer.managed ? "managed" : "external";
  const pid = appServer.pid != null ? ` pid:${appServer.pid}` : "";
  const health = appServer.healthy ? "healthy" : "unhealthy";
  const auth =
    appServer.auth != null
      ? `, auth gateway:${appServer.auth.gatewayPid ?? "-"} -> ${appServer.auth.upstreamUrl}`
      : "";
  return `${health}, ${ownership}${pid}, ${appServer.url}${auth}`;
}

function redactProtectedUrl(url: string): string {
  // Subprotocol auth: token is no longer in the URL.
  // Keep function for backward compat with old state files that may contain query tokens.
  try {
    const parsed = new URL(url);
    if (parsed.searchParams.has("tap_token")) {
      parsed.searchParams.delete("tap_token");
    }
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return url.replace(/[?&]tap_token=[^&]+/g, "");
  }
}

function loadCurrentBridgeState(
  stateDir: string,
  instanceId: InstanceId,
  fallback: BridgeState | null | undefined,
): BridgeState | null {
  return loadBridgeState(stateDir, instanceId) ?? fallback ?? null;
}

function formatThreadSummary(
  threadId: string | null | undefined,
  cwd: string | null | undefined,
): string {
  if (!threadId) {
    return "-";
  }

  return cwd ? `${threadId} (${cwd})` : threadId;
}

function normalizeComparablePath(value: string): string {
  return path.resolve(value).replace(/\\/g, "/").toLowerCase();
}

function sameOptionalPath(
  left: string | null | undefined,
  right: string | null | undefined,
): boolean {
  if (!left || !right) {
    return left === right;
  }

  return normalizeComparablePath(left) === normalizeComparablePath(right);
}

function getSharedAppServerUsers(
  state: TapState,
  stateDir: string,
  currentInstanceId: InstanceId,
  appServerUrl: string,
): InstanceId[] {
  const shared: InstanceId[] = [];

  for (const [id, inst] of Object.entries(state.instances)) {
    if (id === currentInstanceId || !inst?.installed) {
      continue;
    }

    const instanceId = id as InstanceId;
    if (getBridgeStatus(stateDir, instanceId) !== "running") {
      continue;
    }

    const bridgeState = loadCurrentBridgeState(
      stateDir,
      instanceId,
      inst.bridge,
    );
    if (bridgeState?.appServer?.url === appServerUrl) {
      shared.push(instanceId);
    }
  }

  return shared;
}

function transferManagedAppServerOwnership(
  state: TapState,
  stateDir: string,
  recipientId: InstanceId,
  appServer: AppServerState,
): boolean {
  const recipient = state.instances[recipientId];
  if (!recipient) {
    return false;
  }

  const bridgeState = loadCurrentBridgeState(
    stateDir,
    recipientId,
    recipient.bridge,
  );
  if (!bridgeState) {
    return false;
  }

  const transferredAppServer: AppServerState = {
    ...appServer,
    managed: true,
    healthy: true,
    lastCheckedAt: new Date().toISOString(),
    lastHealthyAt: appServer.lastHealthyAt ?? new Date().toISOString(),
  };

  const updatedBridge: BridgeState = {
    ...bridgeState,
    appServer: transferredAppServer,
  };

  saveBridgeState(stateDir, recipientId, updatedBridge);
  state.instances[recipientId] = {
    ...recipient,
    bridge: updatedBridge,
  };
  return true;
}

// ─── Subcommand: start ─────────────────────────────────────────

async function bridgeStart(
  identifier: string,
  agentName?: string,
  flags: Record<string, string | boolean | undefined> = {},
): Promise<CommandResult> {
  const repoRoot = findRepoRoot();
  let state = loadState(repoRoot);

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
  let instance = state.instances[instanceId];

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

  // Resolve agent name: explicit flag > stored in state > env
  const resolvedAgentName = agentName ?? instance.agentName ?? undefined;

  // Persist agent-name to state if explicitly provided
  if (agentName && agentName !== instance.agentName) {
    instance = { ...instance, agentName };
    const updatedState = updateInstanceState(state, instanceId, instance);
    saveState(repoRoot, updatedState);
    state = updatedState;
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
  const manageAppServer =
    instance.runtime === "codex" && flags["no-server"] !== true;

  // Auto-assign port only for managed app-server mode (local instances).
  // External servers (--no-server) keep the configured appServerUrl as-is.
  let effectivePort = instance.port;
  if (effectivePort == null && manageAppServer) {
    effectivePort = await findNextAvailableAppServerPort(
      state,
      resolvedConfig.appServerUrl,
      4501,
      instanceId,
    );
    instance = { ...instance, port: effectivePort };
    const updatedState = updateInstanceState(state, instanceId, instance);
    saveState(repoRoot, updatedState);
    state = updatedState;
  }

  const appServerUrl = resolveAppServerUrl(
    resolvedConfig.appServerUrl,
    effectivePort ?? undefined,
  );

  logHeader(`@hua-labs/tap bridge start ${instanceId}`);
  log(`Bridge script: ${bridgeScript}`);
  log(`Bridge mode:   ${mode}`);
  log(`Runtime cmd:   ${runtimeCommand}`);
  log(`App server:    ${appServerUrl}`);
  if (effectivePort != null) log(`Port:          ${effectivePort}`);
  if (resolvedAgentName) log(`Agent name:    ${resolvedAgentName}`);
  const noAuth = flags["no-auth"] === true;
  if (!manageAppServer && instance.runtime === "codex") {
    log("Auto server:   disabled (--no-server)");
  }
  if (noAuth && manageAppServer) {
    log("Auth gateway:  disabled (--no-auth)");
  }
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
    // Startup validation: health check before bridge start
    if (!manageAppServer && instance.runtime === "codex") {
      log("Checking app-server health...");
      const healthy = await checkAppServerHealth(appServerUrl);
      if (healthy) {
        logSuccess("App server reachable");
      } else {
        logError(`App server not reachable at ${appServerUrl}`);
        return {
          ok: false,
          command: "bridge",
          instanceId,
          runtime: instance.runtime,
          code: "TAP_BRIDGE_START_FAILED",
          message: `App server not reachable at ${appServerUrl}. Start it first: codex app-server --listen ${appServerUrl}`,
          warnings: [],
          data: {},
        };
      }
    }

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
    const pollSecondsRaw =
      typeof flags["poll-seconds"] === "string"
        ? flags["poll-seconds"]
        : undefined;
    const reconnectSecondsRaw =
      typeof flags["reconnect-seconds"] === "string"
        ? flags["reconnect-seconds"]
        : undefined;
    const lookbackRaw =
      typeof flags["message-lookback-minutes"] === "string"
        ? flags["message-lookback-minutes"]
        : undefined;

    let pollSeconds: number | undefined;
    let reconnectSeconds: number | undefined;
    let messageLookbackMinutes: number | undefined;
    try {
      pollSeconds = parseIntFlag(pollSecondsRaw, "--poll-seconds", 1, 3600);
      reconnectSeconds = parseIntFlag(
        reconnectSecondsRaw,
        "--reconnect-seconds",
        1,
        3600,
      );
      messageLookbackMinutes = parseIntFlag(
        lookbackRaw,
        "--message-lookback-minutes",
        1,
        10080,
      );
    } catch (err) {
      return {
        ok: false,
        command: "bridge",
        instanceId,
        runtime: instance.runtime,
        code: "TAP_INVALID_ARGUMENT",
        message: err instanceof Error ? err.message : String(err),
        warnings: [],
        data: {},
      };
    }
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

    // Scope TAP_COLD_START_WARMUP so the bridge can bootstrap its first turn
    const previousWarmup = process.env.TAP_COLD_START_WARMUP;
    process.env.TAP_COLD_START_WARMUP = "true";
    let bridge: BridgeState;
    try {
      bridge = await startBridge({
        instanceId,
        runtime: instance.runtime,
        stateDir: ctx.stateDir,
        commsDir: ctx.commsDir,
        bridgeScript,
        platform: ctx.platform,
        agentName: resolvedAgentName,
        runtimeCommand,
        appServerUrl,
        repoRoot,
        port: effectivePort ?? undefined,
        manageAppServer,
        noAuth,
        headless,
        busyMode,
        pollSeconds,
        reconnectSeconds,
        messageLookbackMinutes,
        threadId,
        ephemeral,
        processExistingMessages,
      });
    } finally {
      if (previousWarmup === undefined) {
        delete process.env.TAP_COLD_START_WARMUP;
      } else {
        process.env.TAP_COLD_START_WARMUP = previousWarmup;
      }
    }

    logSuccess(`Bridge started (PID: ${bridge.pid})`);
    log(`Log: ${path.join(ctx.stateDir, "logs", `bridge-${instanceId}.log`)}`);
    if (bridge.appServer) {
      log(`App server:   ${formatAppServerState(bridge.appServer)}`);
      if (bridge.appServer.logPath) {
        log(`Server log:   ${bridge.appServer.logPath}`);
      }
      if (bridge.appServer.auth) {
        log(
          `Protected:    ${redactProtectedUrl(bridge.appServer.auth.protectedUrl)}`,
        );
        if (bridge.appServer.auth.gatewayLogPath) {
          log(`Gateway log:  ${bridge.appServer.auth.gatewayLogPath}`);
        }
        // TUI must connect to upstream (no token needed) — gateway blocks unauthenticated clients
        log(`TUI connect:  ${bridge.appServer.auth.upstreamUrl}`);
      }
      if (bridge.appServer.managed && !bridge.appServer.auth) {
        // --no-auth mode: TUI connects to the same URL as the bridge
        log(`TUI connect:  ${bridge.appServer.url}`);
      }
    }

    // Update state with bridge info + mode for restart preservation
    const updated = { ...instance, bridge, manageAppServer, noAuth };
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
      data: { pid: bridge.pid, appServer: bridge.appServer ?? null },
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

// ─── Subcommand: start --all ───────────────────────────────────

async function bridgeStartAll(
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

  const instanceIds = Object.keys(state.instances) as InstanceId[];
  const appServerInstances = instanceIds.filter((id) => {
    const inst = state.instances[id];
    if (!inst?.installed) return false;
    const adapter = getAdapter(inst.runtime);
    return adapter.bridgeMode() === "app-server";
  });

  if (appServerInstances.length === 0) {
    return {
      ok: true,
      command: "bridge",
      code: "TAP_NO_OP",
      message: "No app-server instances found to start.",
      warnings: [],
      data: {},
    };
  }

  logHeader("@hua-labs/tap bridge start --all");
  log(
    `Found ${appServerInstances.length} app-server instance(s): ${appServerInstances.join(", ")}`,
  );
  log("");

  const started: string[] = [];
  const failed: string[] = [];
  const warnings: string[] = [];

  for (const instanceId of appServerInstances) {
    const inst = state.instances[instanceId];
    const storedName = inst?.agentName ?? undefined;

    if (!storedName) {
      const msg = `${instanceId}: skipped — no stored agent-name. Set it first: tap bridge start ${instanceId} --agent-name <name>`;
      log(msg);
      warnings.push(msg);
      continue;
    }

    log(`Starting ${instanceId} (agent: ${storedName})...`);
    const result = await bridgeStart(instanceId, storedName, flags);

    if (result.ok) {
      started.push(instanceId);
      logSuccess(`${instanceId} started`);
    } else {
      failed.push(instanceId);
      logError(`${instanceId}: ${result.message}`);
    }
    log("");
  }

  const message =
    started.length > 0
      ? `Started ${started.length}/${appServerInstances.length} bridge(s): ${started.join(", ")}` +
        (failed.length > 0 ? `. Failed: ${failed.join(", ")}` : "")
      : `No bridges started. Failed: ${failed.join(", ")}`;

  return {
    ok: failed.length === 0 && started.length > 0,
    command: "bridge",
    code:
      started.length > 0 ? "TAP_BRIDGE_START_OK" : "TAP_BRIDGE_START_FAILED",
    message,
    warnings,
    data: { started, failed },
  };
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
  const instance = state.instances[instanceId];
  const bridgeState = loadCurrentBridgeState(
    ctx.stateDir,
    instanceId,
    instance?.bridge,
  );
  const appServer = bridgeState?.appServer ?? null;

  logHeader(`@hua-labs/tap bridge stop ${instanceId}`);

  const stopped = await stopBridge({
    instanceId,
    stateDir: ctx.stateDir,
    platform: ctx.platform,
  });

  let appServerStopped = false;
  let appServerTransferredTo: InstanceId | null = null;

  if (stopped) {
    logSuccess(`Bridge for ${instanceId} stopped`);
  } else {
    log(`No running bridge for ${instanceId}`);
  }

  if (appServer?.managed) {
    const sharedUsers = getSharedAppServerUsers(
      state,
      ctx.stateDir,
      instanceId,
      appServer.url,
    );

    if (sharedUsers.length > 0) {
      const recipient = sharedUsers[0];
      if (
        transferManagedAppServerOwnership(
          state,
          ctx.stateDir,
          recipient,
          appServer,
        )
      ) {
        appServerTransferredTo = recipient;
        log(`Managed app-server ownership moved to ${recipient}`);
      } else {
        log(
          `Managed app-server left running at ${appServer.url} because ownership transfer failed`,
        );
      }
    } else {
      appServerStopped = await stopManagedAppServer(appServer, ctx.platform);
      if (appServerStopped) {
        const gatewayNote =
          appServer.auth?.gatewayPid != null
            ? `, gateway PID: ${appServer.auth.gatewayPid}`
            : "";
        logSuccess(
          `Managed app-server stopped (PID: ${appServer.pid ?? "-"}${gatewayNote})`,
        );
        // Wait for port to be released so the next bridge start won't
        // hit TIME_WAIT conflicts (port zombie prevention)
        const released = await waitForPortRelease(appServer.url, 5_000);
        if (!released) {
          log(
            `Warning: port for ${appServer.url} still in use after stop — next start may need a different port`,
          );
        }
      }
    }
  }

  // Clear bridge from state
  if (instance) {
    const updated = { ...instance, bridge: null };
    const newState = updateInstanceState(state, instanceId, updated);
    saveState(repoRoot, newState);
  }

  if (stopped) {
    return {
      ok: true,
      command: "bridge",
      instanceId,
      code: "TAP_BRIDGE_STOP_OK",
      message: `Bridge for ${instanceId} stopped`,
      warnings: [],
      data: {
        appServerStopped,
        appServerTransferredTo,
      },
    };
  }

  return {
    ok: true,
    command: "bridge",
    instanceId,
    code: "TAP_BRIDGE_NOT_RUNNING",
    message: `No running bridge for ${instanceId}`,
    warnings: [],
    data: {
      appServerStopped,
      appServerTransferredTo,
    },
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
  const managedAppServers = new Map<string, AppServerState>();

  logHeader("@hua-labs/tap bridge stop (all)");

  let stateChanged = false;

  for (const instanceId of instanceIds) {
    const bridgeState = loadCurrentBridgeState(
      ctx.stateDir,
      instanceId,
      state.instances[instanceId]?.bridge,
    );
    const appServer = bridgeState?.appServer;
    if (appServer?.managed && appServer.pid != null) {
      managedAppServers.set(
        `${appServer.url}:${appServer.pid}:${appServer.auth?.gatewayPid ?? "-"}`,
        appServer,
      );
    }

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

  const stoppedAppServers: number[] = [];
  const releasePorts: string[] = [];
  for (const appServer of managedAppServers.values()) {
    if (await stopManagedAppServer(appServer, ctx.platform)) {
      stoppedAppServers.push(appServer.pid!);
      releasePorts.push(appServer.url);
      const gatewayNote =
        appServer.auth?.gatewayPid != null
          ? `, gateway PID ${appServer.auth.gatewayPid}`
          : "";
      logSuccess(
        `Stopped app-server PID ${appServer.pid} (${appServer.url}${gatewayNote})`,
      );
    }
  }

  // Wait for all stopped app-server ports to release (parallel)
  if (releasePorts.length > 0) {
    await Promise.all(
      releasePorts.map((url) => waitForPortRelease(url, 5_000)),
    );
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
    data: { stopped, stoppedAppServers },
  };
}

// ─── Subcommand: watch ───────────────────────────────────────

/**
 * Monitor all bridges and auto-restart stuck or stale ones.
 * Runs a single check cycle and returns results.
 * For continuous monitoring, call periodically (e.g., from a cron or loop).
 */
async function bridgeWatch(
  _intervalSeconds: number,
  stuckThresholdSeconds: number,
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

  const { config: resolvedCfg } = resolveConfig({}, repoRoot);
  const stateDir = resolvedCfg.stateDir;
  const instanceIds = Object.keys(state.instances) as InstanceId[];

  logHeader("@hua-labs/tap bridge watch");
  log(
    `Checking ${instanceIds.length} instance(s), stuck threshold: ${stuckThresholdSeconds}s`,
  );

  const restarted: string[] = [];
  const cleaned: string[] = [];
  const healthy: string[] = [];
  const warnings: string[] = [];

  for (const instanceId of instanceIds) {
    const inst = state.instances[instanceId];
    if (!inst?.installed || inst.bridgeMode !== "app-server") continue;

    const status = getBridgeStatus(stateDir, instanceId);

    if (status === "stale") {
      log(`${instanceId}: stale (process dead) — cleaning up`);
      cleaned.push(instanceId);
      continue;
    }

    if (status === "stopped") {
      log(`${instanceId}: stopped`);
      continue;
    }

    // Running — check for stuck turns
    if (isTurnStuck(stateDir, instanceId, stuckThresholdSeconds)) {
      const turnInfo = getTurnInfo(stateDir, instanceId, stuckThresholdSeconds);
      const ageStr =
        turnInfo?.ageSeconds != null ? formatAge(turnInfo.ageSeconds) : "?";
      log(
        `${instanceId}: ⚠ STUCK turn ${turnInfo?.activeTurnId?.slice(0, 8)}... (${ageStr}) — restarting`,
      );

      const adapter = getAdapter(inst.runtime);
      const ctx = {
        ...createAdapterContext(state.commsDir, repoRoot),
        instanceId,
      };
      const bridgeScript = adapter.resolveBridgeScript?.(ctx);

      if (!bridgeScript) {
        warnings.push(
          `${instanceId}: cannot restart — bridge script not found`,
        );
        continue;
      }

      const bridgeState = loadBridgeState(stateDir, instanceId);
      const { manageAppServer, noAuth } = inferRestartMode(bridgeState, {});

      // Scope TAP_COLD_START_WARMUP around restart (mirrors bridgeRestart, PR #847)
      const previousWarmup = process.env.TAP_COLD_START_WARMUP;
      process.env.TAP_COLD_START_WARMUP = "true";
      try {
        const newBridgeState = await restartBridge({
          instanceId,
          runtime: inst.runtime,
          stateDir: ctx.stateDir,
          commsDir: ctx.commsDir,
          bridgeScript,
          platform: ctx.platform,
          agentName: inst.agentName ?? undefined,
          runtimeCommand: resolvedCfg.runtimeCommand,
          appServerUrl: resolvedCfg.appServerUrl,
          repoRoot,
          port: inst.port ?? undefined,
          headless: inst.headless,
          drainTimeoutSeconds: 30,
          manageAppServer,
          noAuth,
        });
        // Backwrite new bridge state to state.json (mirrors bridgeRestart)
        const updatedInst = { ...inst, bridge: newBridgeState };
        const updatedState = updateInstanceState(
          state,
          instanceId,
          updatedInst,
        );
        saveState(repoRoot, updatedState);
        restarted.push(instanceId);
        logSuccess(`${instanceId}: restarted`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        warnings.push(`${instanceId}: restart failed — ${msg}`);
        logError(`${instanceId}: restart failed — ${msg}`);
      } finally {
        if (previousWarmup === undefined) {
          delete process.env.TAP_COLD_START_WARMUP;
        } else {
          process.env.TAP_COLD_START_WARMUP = previousWarmup;
        }
      }
    } else {
      healthy.push(instanceId);
      log(`${instanceId}: healthy`);
    }
  }

  const message =
    [
      restarted.length > 0 ? `Restarted: ${restarted.join(", ")}` : null,
      cleaned.length > 0 ? `Cleaned stale: ${cleaned.join(", ")}` : null,
      healthy.length > 0 ? `Healthy: ${healthy.join(", ")}` : null,
    ]
      .filter(Boolean)
      .join(". ") || "No app-server bridges found";

  log("");
  log(message);

  return {
    ok: true,
    command: "bridge",
    code:
      restarted.length > 0
        ? "TAP_BRIDGE_WATCH_RESTARTED"
        : "TAP_BRIDGE_WATCH_OK",
    message,
    warnings,
    data: { restarted, cleaned, healthy },
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
      threadId: string | null;
      threadCwd: string | null;
      savedThreadId: string | null;
      savedThreadCwd: string | null;
      appServer: AppServerState | null;
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
        threadId: null,
        threadCwd: null,
        savedThreadId: null,
        savedThreadCwd: null,
        appServer: null,
      };
      continue;
    }

    const status = getBridgeStatus(stateDir, instanceId);
    const bridgeState = loadBridgeState(stateDir, instanceId);
    const runtimeHeartbeat = loadRuntimeBridgeHeartbeat(bridgeState);
    const savedThread = loadRuntimeBridgeThreadState(bridgeState);
    const age = getHeartbeatAge(stateDir, instanceId);

    const pid = bridgeState?.pid ?? null;
    const heartbeat = getBridgeHeartbeatTimestamp(stateDir, instanceId);
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
    if (bridgeState?.appServer) {
      log(`  App server: ${formatAppServerState(bridgeState.appServer)}`);
      if (bridgeState.appServer.logPath) {
        log(`  Server log: ${bridgeState.appServer.logPath}`);
      }
      if (bridgeState.appServer.auth) {
        log(
          `  Protected: ${redactProtectedUrl(bridgeState.appServer.auth.protectedUrl)}`,
        );
      }
    }
    if (runtimeHeartbeat?.threadId) {
      log(
        `  Thread:     ${formatThreadSummary(runtimeHeartbeat.threadId, runtimeHeartbeat.threadCwd)}`,
      );
    }
    if (
      savedThread?.threadId &&
      (savedThread.threadId !== runtimeHeartbeat?.threadId ||
        !sameOptionalPath(savedThread.cwd, runtimeHeartbeat?.threadCwd))
    ) {
      log(
        `  Saved:      ${formatThreadSummary(savedThread.threadId, savedThread.cwd)}`,
      );
    }

    // Turn stuck detection (M160)
    const turnInfo = getTurnInfo(stateDir, instanceId);
    if (turnInfo?.activeTurnId) {
      const ageStr =
        turnInfo.ageSeconds != null ? formatAge(turnInfo.ageSeconds) : "?";
      if (turnInfo.stuck) {
        log(
          `  ⚠ STUCK:    turn ${turnInfo.activeTurnId.slice(0, 8)}... active ${ageStr} (threshold: 5m)`,
        );
      } else {
        log(
          `  Turn:       ${turnInfo.activeTurnId.slice(0, 8)}... active ${ageStr}`,
        );
      }
    }

    bridges[instanceId] = {
      status,
      runtime: inst.runtime,
      pid,
      port: inst.port,
      lastHeartbeat: heartbeat,
      threadId: runtimeHeartbeat?.threadId ?? null,
      threadCwd: runtimeHeartbeat?.threadCwd ?? null,
      savedThreadId: savedThread?.threadId ?? null,
      savedThreadCwd: savedThread?.cwd ?? null,
      appServer: bridgeState?.appServer ?? null,
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
        threadId: null,
        threadCwd: null,
        savedThreadId: null,
        savedThreadCwd: null,
        appServer: null,
      },
    };
  }

  const { config: resolvedCfg2 } = resolveConfig({}, repoRoot);
  const stateDir = resolvedCfg2.stateDir;
  const status = getBridgeStatus(stateDir, instanceId);
  const bridgeState = loadBridgeState(stateDir, instanceId);
  const runtimeHeartbeat = loadRuntimeBridgeHeartbeat(bridgeState);
  const savedThread = loadRuntimeBridgeThreadState(bridgeState);
  const age = getHeartbeatAge(stateDir, instanceId);
  const heartbeat = getBridgeHeartbeatTimestamp(stateDir, instanceId);

  log(`Status:      ${status}`);

  if (bridgeState) {
    log(`PID:         ${bridgeState.pid}`);
    log(
      `Heartbeat:   ${heartbeat ?? "-"}${age !== null ? ` (${formatAge(age)})` : ""}`,
    );
    if (runtimeHeartbeat?.threadId) {
      log(
        `Thread:      ${formatThreadSummary(runtimeHeartbeat.threadId, runtimeHeartbeat.threadCwd)}`,
      );
    }
    if (
      savedThread?.threadId &&
      (savedThread.threadId !== runtimeHeartbeat?.threadId ||
        !sameOptionalPath(savedThread.cwd, runtimeHeartbeat?.threadCwd))
    ) {
      log(
        `Saved:       ${formatThreadSummary(savedThread.threadId, savedThread.cwd)}`,
      );
    }
    log(
      `Log:         ${path.join(stateDir, "logs", `bridge-${instanceId}.log`)}`,
    );
    if (bridgeState.appServer) {
      log(`App server:  ${bridgeState.appServer.url}`);
      log(`Server PID:  ${bridgeState.appServer.pid ?? "-"}`);
      log(
        `Server mode: ${bridgeState.appServer.managed ? "managed" : "external"}`,
      );
      log(
        `Health:      ${bridgeState.appServer.healthy ? "healthy" : "unhealthy"}`,
      );
      log(`Checked:     ${bridgeState.appServer.lastCheckedAt}`);
      if (bridgeState.appServer.logPath) {
        log(`Server log:  ${bridgeState.appServer.logPath}`);
      }
      if (bridgeState.appServer.auth) {
        log(`Auth:        ${bridgeState.appServer.auth.mode}`);
        log(
          `Protected:   ${redactProtectedUrl(bridgeState.appServer.auth.protectedUrl)}`,
        );
        log(`Upstream:    ${bridgeState.appServer.auth.upstreamUrl}`);
        log(`TUI connect: ${bridgeState.appServer.auth.upstreamUrl}`);
        log(`Gateway PID: ${bridgeState.appServer.auth.gatewayPid ?? "-"}`);
        if (bridgeState.appServer.auth.gatewayLogPath) {
          log(`Gateway log: ${bridgeState.appServer.auth.gatewayLogPath}`);
        }
      } else if (bridgeState.appServer.managed) {
        log(`Auth:        none (--no-auth)`);
        log(`TUI connect: ${bridgeState.appServer.url}`);
      }
    }
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
      lastHeartbeat: heartbeat,
      threadId: runtimeHeartbeat?.threadId ?? null,
      threadCwd: runtimeHeartbeat?.threadCwd ?? null,
      savedThreadId: savedThread?.threadId ?? null,
      savedThreadCwd: savedThread?.cwd ?? null,
      appServer: bridgeState?.appServer ?? null,
    },
  };
}

// ─── Command Router ────────────────────────────────────────────

async function bridgeRestart(
  identifier: string,
  flags: Record<string, string | boolean>,
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
  const inst = state.instances[instanceId];
  if (!inst) {
    return {
      ok: false,
      command: "bridge",
      code: "TAP_INSTANCE_NOT_FOUND",
      message: `Instance not found: ${instanceId}`,
      warnings: [],
      data: {},
    };
  }

  const adapter = getAdapter(inst.runtime);
  const ctx = {
    ...createAdapterContext(state.commsDir, repoRoot),
    instanceId,
  };
  const bridgeScript = adapter.resolveBridgeScript?.(ctx);

  if (!bridgeScript) {
    return {
      ok: false,
      command: "bridge",
      instanceId,
      code: "TAP_BRIDGE_SCRIPT_MISSING",
      message: `Bridge script not found for ${instanceId}`,
      warnings: [],
      data: {},
    };
  }

  const { config: resolvedConfig } = resolveConfig({}, repoRoot);
  const drainStr =
    typeof flags["drain-timeout"] === "string"
      ? flags["drain-timeout"]
      : undefined;
  let drainTimeout: number;
  try {
    drainTimeout = parseIntFlag(drainStr, "--drain-timeout", 1, 300) ?? 30;
  } catch (err) {
    return {
      ok: false,
      command: "bridge",
      instanceId,
      runtime: inst.runtime,
      code: "TAP_INVALID_ARGUMENT",
      message: err instanceof Error ? err.message : String(err),
      warnings: [],
      data: {},
    };
  }

  logHeader(`@hua-labs/tap bridge restart ${instanceId}`);
  log(`Drain timeout: ${drainTimeout}s`);

  try {
    // Use production helper for mode inference (tested in identity-restart.test.ts)
    // Priority: flags > saved instance mode > bridge state inference
    const currentBridgeState = loadBridgeState(ctx.stateDir, instanceId);
    const { manageAppServer, noAuth } = inferRestartMode(
      currentBridgeState,
      {
        noServer: flags["no-server"] === true ? true : undefined,
        noAuth: flags["no-auth"] === true ? true : undefined,
      },
      {
        manageAppServer: inst.manageAppServer,
        noAuth: inst.noAuth,
      },
    );

    const previousColdStartWarmup = process.env.TAP_COLD_START_WARMUP;
    process.env.TAP_COLD_START_WARMUP = "true";
    let bridge: BridgeState;
    try {
      bridge = await restartBridge({
        instanceId,
        runtime: inst.runtime,
        stateDir: ctx.stateDir,
        commsDir: ctx.commsDir,
        bridgeScript,
        platform: ctx.platform,
        agentName: inst.agentName ?? undefined,
        runtimeCommand: resolvedConfig.runtimeCommand,
        appServerUrl: resolvedConfig.appServerUrl,
        repoRoot,
        port: inst.port ?? undefined,
        headless: inst.headless,
        drainTimeoutSeconds: drainTimeout,
        manageAppServer,
        noAuth,
      });
    } finally {
      if (previousColdStartWarmup === undefined) {
        delete process.env.TAP_COLD_START_WARMUP;
      } else {
        process.env.TAP_COLD_START_WARMUP = previousColdStartWarmup;
      }
    }

    logSuccess(`Bridge restarted (PID: ${bridge.pid})`);

    // Save bridge mode for next restart (#799 follow-up)
    const updated = { ...inst, bridge, manageAppServer, noAuth };
    const newState = updateInstanceState(state, instanceId, updated);
    saveState(repoRoot, newState);

    return {
      ok: true,
      command: "bridge",
      instanceId,
      code: "TAP_BRIDGE_START_OK",
      message: `Bridge for ${instanceId} restarted (PID: ${bridge.pid})`,
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
      code: "TAP_BRIDGE_START_FAILED",
      message: msg,
      warnings: [],
      data: {},
    };
  }
}

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
      const wantsAll = flags["all"] === true || identifierArg === "--all";
      const hasInstance = identifierArg && identifierArg !== "--all";

      if (wantsAll && hasInstance) {
        return {
          ok: false,
          command: "bridge",
          code: "TAP_INVALID_ARGUMENT",
          message: `Cannot combine <instance> with --all. Use either:\n  tap bridge start ${identifierArg}\n  tap bridge start --all`,
          warnings: [],
          data: {},
        };
      }
      if (wantsAll) {
        return bridgeStartAll(flags);
      }
      if (!identifierArg) {
        return {
          ok: false,
          command: "bridge",
          code: "TAP_INVALID_ARGUMENT",
          message:
            "Missing instance. Usage: npx @hua-labs/tap bridge start <instance> or --all",
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

    case "watch": {
      const intervalStr =
        typeof flags["interval"] === "string" ? flags["interval"] : undefined;
      const interval = intervalStr ? parseInt(intervalStr, 10) : 30;
      const stuckThresholdStr =
        typeof flags["stuck-threshold"] === "string"
          ? flags["stuck-threshold"]
          : undefined;
      const stuckThreshold = stuckThresholdStr
        ? parseInt(stuckThresholdStr, 10)
        : 300;
      return bridgeWatch(interval, stuckThreshold);
    }

    case "restart": {
      if (!identifierArg) {
        return {
          ok: false,
          command: "bridge",
          code: "TAP_INVALID_ARGUMENT",
          message:
            "Missing instance. Usage: npx @hua-labs/tap bridge restart <instance>",
          warnings: [],
          data: {},
        };
      }
      return bridgeRestart(identifierArg, flags);
    }

    default:
      return {
        ok: false,
        command: "bridge",
        code: "TAP_INVALID_ARGUMENT",
        message: `Unknown bridge subcommand: ${subcommand}. Use: start, stop, restart, status`,
        warnings: [],
        data: {},
      };
  }
}
