import * as path from "node:path";
import { loadState, saveState, updateInstanceState, fileHash } from "../state.js";
import { loadInstanceConfig, saveInstanceConfig } from "../config/instance-config.js";
import {
  startBridge,
  inferRestartMode,
  loadBridgeState,
  checkAppServerHealth,
  findNextAvailableAppServerPort,
  resolveAppServerUrl,
} from "../engine/bridge.js";
import { resolveConfig } from "../config/index.js";
import { getAdapter } from "../adapters/index.js";
import {
  findRepoRoot,
  createAdapterContext,
  resolveInstanceId,
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
  BridgeState,
} from "../types.js";
import {
  formatAppServerState,
  redactProtectedUrl,
  resolveRecoveredAgentName,
} from "./bridge-helpers.js";
import { pruneStaleHeartbeatsForBridgeUp } from "./bridge-heartbeat.js";
import { patchCodexApprovalMode } from "../adapters/codex.js";

// ─── Subcommand: start ─────────────────────────────────────────

export async function bridgeStart(
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
  const ctx = createAdapterContext(state.commsDir, repoRoot);

  // M224: patch approval_mode before Codex bridge startup
  if (instance.runtime === "codex") {
    const patched = patchCodexApprovalMode();
    if (patched) {
      log(`patched approval_mode → auto in ${patched}`);
      // Resync runtimeConfigHash to prevent drift false-positive
      const instConfig = loadInstanceConfig(ctx.stateDir, instanceId);
      if (instConfig) {
        instConfig.runtimeConfigHash = fileHash(patched);
        instConfig.updatedAt = new Date().toISOString();
        saveInstanceConfig(ctx.stateDir, instConfig);
      }
    }
  }

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

  const resolvedAgentName = resolveRecoveredAgentName(
    instanceId,
    agentName,
    repoRoot,
    ctx.stateDir,
  );

  if ((resolvedAgentName ?? null) !== instance.agentName) {
    instance = { ...instance, agentName: resolvedAgentName ?? null };
    const updatedState = updateInstanceState(state, instanceId, instance);
    saveState(repoRoot, updatedState);
    state = updatedState;
  }
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
        previousLifecycle:
          instance.bridgeLifecycle ?? instance.bridge?.lifecycle ?? null,
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
    const updated = {
      ...instance,
      bridge,
      bridgeLifecycle: bridge.lifecycle ?? instance.bridgeLifecycle ?? null,
      manageAppServer,
      noAuth,
    };
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

export async function bridgeStartAll(
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

  const ctx = createAdapterContext(state.commsDir, repoRoot);
  const warnings: string[] = [];
  let prunedHeartbeats = 0;
  if (flags["auto-prune-heartbeats"] === true) {
    const cleanup = pruneStaleHeartbeatsForBridgeUp(
      state,
      ctx.stateDir,
      ctx.commsDir,
    );
    prunedHeartbeats = cleanup.removed;
    if (cleanup.warning) {
      warnings.push(cleanup.warning);
      log(cleanup.warning);
    }
    if (prunedHeartbeats > 0) {
      log(
        `Auto-clean: pruned ${prunedHeartbeats} stale heartbeat entr${prunedHeartbeats === 1 ? "y" : "ies"}`,
      );
    }
  }

  const instanceIds = Object.keys(state.instances) as InstanceId[];
  const appServerInstances = instanceIds.filter((id) => {
    const inst = state.instances[id];
    if (!inst?.installed) return false;
    const adapter = getAdapter(inst.runtime);
    return adapter.bridgeMode() === "app-server";
  });

  if (appServerInstances.length === 0) {
    const cleanupSuffix =
      prunedHeartbeats > 0
        ? ` Auto-clean pruned ${prunedHeartbeats} stale heartbeat entr${prunedHeartbeats === 1 ? "y" : "ies"}.`
        : "";
    return {
      ok: true,
      command: "bridge",
      code: "TAP_NO_OP",
      message: `No app-server instances found to start.${cleanupSuffix}`,
      warnings,
      data: { prunedHeartbeats },
    };
  }

  logHeader("@hua-labs/tap bridge start --all");
  log(
    `Found ${appServerInstances.length} app-server instance(s): ${appServerInstances.join(", ")}`,
  );
  log("");

  const started: string[] = [];
  const failed: string[] = [];

  for (const instanceId of appServerInstances) {
    const inst = state.instances[instanceId];
    const storedName = resolveRecoveredAgentName(
      instanceId,
      inst?.agentName ?? undefined,
      repoRoot,
      ctx.stateDir,
    );

    if (!storedName) {
      const msg = `${instanceId}: skipped — no stored agent-name. Set it first: tap bridge start ${instanceId} --agent-name <name>`;
      log(msg);
      warnings.push(msg);
      continue;
    }

    // Restore saved --no-server / --no-auth mode (M197: inferRestartMode for start --all)
    const stateDir = path.join(repoRoot, ".tap-comms");
    const currentBridgeState = loadBridgeState(stateDir, instanceId);
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
    const mergedFlags = {
      ...flags,
      ...(manageAppServer === false ? { "no-server": true } : {}),
      ...(noAuth === true ? { "no-auth": true } : {}),
    };

    log(`Starting ${instanceId} (agent: ${storedName})...`);
    const result = await bridgeStart(instanceId, storedName, mergedFlags);

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
  const cleanupSuffix =
    prunedHeartbeats > 0
      ? ` Auto-clean pruned ${prunedHeartbeats} stale heartbeat entr${prunedHeartbeats === 1 ? "y" : "ies"}.`
      : "";

  return {
    ok: failed.length === 0 && started.length > 0,
    command: "bridge",
    code:
      started.length > 0 ? "TAP_BRIDGE_START_OK" : "TAP_BRIDGE_START_FAILED",
    message: `${message}${cleanupSuffix}`,
    warnings,
    data: { started, failed, prunedHeartbeats },
  };
}
