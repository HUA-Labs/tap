import { logFilePath } from "../engine/bridge-paths.js";
import { loadState, saveState } from "../state.js";
import {
  getBridgeStatus,
  loadBridgeState,
  getHeartbeatAge,
  getBridgeHeartbeatTimestamp,
  loadRuntimeBridgeHeartbeat,
  loadRuntimeBridgeThreadState,
  getTurnInfo,
  deriveBridgeLifecycleState,
  deriveCodexSessionState,
  isProcessAlive,
  transitionBridgeLifecycle,
} from "../engine/bridge.js";
import {
  loadLiveDispatchEvidence,
  resolveUniqueLiveDispatchAliases,
} from "../engine/health-monitor.js";
import { resolveConfig } from "../config/index.js";
import { findRepoRoot, resolveInstanceId, log, logHeader } from "../utils.js";
import type { CommandResult, AppServerState } from "../types.js";
import type {
  BridgeLifecycleSnapshot,
  CodexSessionSnapshot,
} from "../engine/bridge.js";
import {
  formatAge,
  formatAppServerState,
  formatLifecycleTransition,
  redactProtectedUrl,
  formatThreadSummary,
  sameOptionalPath,
} from "./bridge-helpers.js";

// ─── Subcommand: status ────────────────────────────────────────

function probeRetainedAppServer(
  appServer: AppServerState | null | undefined,
): AppServerState | null {
  if (!appServer) {
    return null;
  }

  const pidAlive = appServer.pid != null && isProcessAlive(appServer.pid);
  const gatewayAlive =
    appServer.auth?.gatewayPid != null
      ? isProcessAlive(appServer.auth.gatewayPid)
      : true;
  const healthy = pidAlive && gatewayAlive;
  const checkedAt = new Date().toISOString();

  return {
    ...appServer,
    healthy,
    lastCheckedAt: checkedAt,
    lastHealthyAt: healthy
      ? (appServer.lastHealthyAt ?? checkedAt)
      : appServer.lastHealthyAt,
  };
}

export function bridgeStatusAll(): CommandResult {
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
  const instanceIds = Object.keys(state.instances) as Array<
    keyof typeof state.instances
  >;
  const bridges: Record<
    string,
    {
      status: string;
      lifecycle: BridgeLifecycleSnapshot | null;
      session: CodexSessionSnapshot | null;
      runtime: string;
      pid: number | null;
      port: number | null;
      lastHeartbeat: string | null;
      threadId: string | null;
      threadCwd: string | null;
      savedThreadId: string | null;
      savedThreadCwd: string | null;
      appServer: AppServerState | null;
      lastNotificationMethod: string | null;
      lastNotificationAt: string | null;
      lastError: string | null;
    }
  > = {};

  logHeader("@hua-labs/tap bridge status");
  log(
    `${"Instance".padEnd(20)} ${"Runtime".padEnd(8)} ${"Status".padEnd(10)} ${"Lifecycle".padEnd(20)} ${"Session".padEnd(18)} ${"PID".padEnd(8)} ${"Port".padEnd(6)} ${"Last Heartbeat"}`,
  );
  log(
    `${"─".repeat(20)} ${"─".repeat(8)} ${"─".repeat(10)} ${"─".repeat(20)} ${"─".repeat(18)} ${"─".repeat(8)} ${"─".repeat(6)} ${"─".repeat(20)}`,
  );

  let stateChanged = false;

  for (const instanceId of instanceIds) {
    const inst = state.instances[instanceId];
    if (!inst?.installed) continue;

    if (inst.bridgeMode !== "app-server") {
      log(
        `${instanceId.padEnd(20)} ${inst.runtime.padEnd(8)} ${"n/a".padEnd(10)} ${"-".padEnd(8)} ${"-".padEnd(6)} ${inst.bridgeMode} mode`,
      );
      bridges[instanceId] = {
        status: "n/a",
        lifecycle: null,
        session: null,
        runtime: inst.runtime,
        pid: null,
        port: inst.port,
        lastHeartbeat: null,
        threadId: null,
        threadCwd: null,
        savedThreadId: null,
        savedThreadCwd: null,
        appServer: null,
        lastNotificationMethod: null,
        lastNotificationAt: null,
        lastError: null,
      };
      continue;
    }

    const rawStatus = getBridgeStatus(stateDir, instanceId);
    const bridgeState = loadBridgeState(stateDir, instanceId) ?? inst.bridge;
    const liveDispatch =
      rawStatus === "running"
        ? null
        : loadLiveDispatchEvidence(
            state.commsDir,
            instanceId,
            resolveUniqueLiveDispatchAliases(state.instances, instanceId),
          );
    const surfaceBridgeState = liveDispatch ? null : bridgeState;
    const runtimeHeartbeat = loadRuntimeBridgeHeartbeat(surfaceBridgeState);
    const savedThread = loadRuntimeBridgeThreadState(surfaceBridgeState);
    const status = liveDispatch ? "dispatch-live" : rawStatus;
    const surfaceAppServer =
      surfaceBridgeState?.appServer ??
      (status === "stopped" || status === "stale"
        ? probeRetainedAppServer(inst.managedAppServer)
        : null);
    const lifecycle = liveDispatch
      ? deriveBridgeLifecycleState({ bridgeStatus: "stopped" })
      : deriveBridgeLifecycleState({
          bridgeStatus: rawStatus,
          bridgeState,
          runtimeHeartbeat,
          savedThread,
          persistedLifecycle:
            inst.bridgeLifecycle ?? bridgeState?.lifecycle ?? null,
        });
    const session =
      rawStatus === "running" || liveDispatch
        ? deriveCodexSessionState({
            runtimeHeartbeat,
            runtimeStateDir: surfaceBridgeState?.runtimeStateDir ?? null,
          })
        : null;
    const age = liveDispatch ? null : getHeartbeatAge(stateDir, instanceId);

    if (rawStatus === "stale" && inst.bridge) {
      state.instances[instanceId] = {
        ...inst,
        bridge: null,
        bridgeLifecycle: transitionBridgeLifecycle(
          inst.bridgeLifecycle ?? inst.bridge?.lifecycle ?? null,
          "crashed",
          "bridge pid not alive",
        ),
        managedAppServer: inst.bridge?.appServer?.managed
          ? probeRetainedAppServer(inst.bridge.appServer)
          : (inst.managedAppServer ?? null),
      };
      stateChanged = true;
    }

    const pid = surfaceBridgeState?.pid ?? null;
    const heartbeat = liveDispatch
      ? null
      : getBridgeHeartbeatTimestamp(stateDir, instanceId);
    const pidStr = pid ? String(pid) : "-";
    const portStr = inst.port ? String(inst.port) : "-";
    const ageStr = age !== null ? formatAge(age) : "-";

    log(
      `${instanceId.padEnd(20)} ${inst.runtime.padEnd(8)} ${status.padEnd(10)} ${lifecycle.status.padEnd(20)} ${(session?.status ?? "-").padEnd(18)} ${pidStr.padEnd(8)} ${portStr.padEnd(6)} ${ageStr}`,
    );
    if (surfaceAppServer) {
      log(`  App server: ${formatAppServerState(surfaceAppServer)}`);
      if (surfaceAppServer.logPath) {
        log(`  Server log: ${surfaceAppServer.logPath}`);
      }
      if (surfaceAppServer.auth) {
        log(
          `  Protected: ${redactProtectedUrl(surfaceAppServer.auth.protectedUrl)}`,
        );
      }
    }
    if (runtimeHeartbeat?.threadId) {
      log(
        `  Thread:     ${formatThreadSummary(runtimeHeartbeat.threadId, runtimeHeartbeat.threadCwd)}`,
      );
    }
    if (runtimeHeartbeat?.lastNotificationMethod) {
      log(
        `  Notify:     ${runtimeHeartbeat.lastNotificationMethod} @ ${runtimeHeartbeat.lastNotificationAt ?? "-"}`,
      );
    }
    if (runtimeHeartbeat?.lastError) {
      log(`  Last error: ${runtimeHeartbeat.lastError}`);
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
    const transition = formatLifecycleTransition(lifecycle);
    if (transition) {
      log(`  Transition: ${transition}`);
    }
    if (liveDispatch) {
      log(
        `  Drift:      fresh bridge-dispatch heartbeat from PID ${liveDispatch.bridgePid} without bridge pid state`,
      );
    }

    // Turn stuck detection (M160)
    const turnInfo = getTurnInfo(stateDir, instanceId);
    if (turnInfo?.activeTurnId) {
      const ageStr2 =
        turnInfo.ageSeconds != null ? formatAge(turnInfo.ageSeconds) : "?";
      if (turnInfo.stuck) {
        log(
          `  ⚠ STUCK:    turn ${turnInfo.activeTurnId.slice(0, 8)}... active ${ageStr2} (threshold: 5m)`,
        );
      } else {
        log(
          `  Turn:       ${turnInfo.activeTurnId.slice(0, 8)}... active ${ageStr2}`,
        );
      }
    }

    bridges[instanceId] = {
      status,
      lifecycle,
      session,
      runtime: inst.runtime,
      pid,
      port: inst.port,
      lastHeartbeat: heartbeat,
      threadId: runtimeHeartbeat?.threadId ?? null,
      threadCwd: runtimeHeartbeat?.threadCwd ?? null,
      savedThreadId: savedThread?.threadId ?? null,
      savedThreadCwd: savedThread?.cwd ?? null,
      appServer: surfaceAppServer,
      lastNotificationMethod: runtimeHeartbeat?.lastNotificationMethod ?? null,
      lastNotificationAt: runtimeHeartbeat?.lastNotificationAt ?? null,
      lastError: runtimeHeartbeat?.lastError ?? null,
    };
  }

  if (instanceIds.length === 0) {
    log("No instances installed.");
  }

  if (stateChanged) {
    saveState(repoRoot, state);
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

export function bridgeStatusOne(identifier: string): CommandResult {
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
        lifecycle: {
          presence: "stopped",
          status: "stopped",
          summary: "stopped",
          lastTransitionAt: null,
          lastTransitionReason: null,
          restartCount: 0,
        },
        session: null,
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
  const rawStatus = getBridgeStatus(stateDir, instanceId);
  const bridgeState = loadBridgeState(stateDir, instanceId) ?? inst.bridge;
  const liveDispatch =
    rawStatus === "running"
      ? null
      : loadLiveDispatchEvidence(
          state.commsDir,
          instanceId,
          resolveUniqueLiveDispatchAliases(state.instances, instanceId),
        );
  const surfaceBridgeState = liveDispatch ? null : bridgeState;
  const runtimeHeartbeat = loadRuntimeBridgeHeartbeat(surfaceBridgeState);
  const savedThread = loadRuntimeBridgeThreadState(surfaceBridgeState);
  const age = liveDispatch ? null : getHeartbeatAge(stateDir, instanceId);
  const heartbeat = liveDispatch
    ? null
    : getBridgeHeartbeatTimestamp(stateDir, instanceId);
  const status = liveDispatch ? "dispatch-live" : rawStatus;
  const surfaceAppServer =
    surfaceBridgeState?.appServer ??
    (status === "stopped" || status === "stale"
      ? probeRetainedAppServer(inst.managedAppServer)
      : null);
  const lifecycle = liveDispatch
    ? deriveBridgeLifecycleState({ bridgeStatus: "stopped" })
    : deriveBridgeLifecycleState({
        bridgeStatus: rawStatus,
        bridgeState,
        runtimeHeartbeat,
        savedThread,
        persistedLifecycle:
          inst.bridgeLifecycle ?? bridgeState?.lifecycle ?? null,
      });
  const session = deriveCodexSessionState({
    runtimeHeartbeat,
    runtimeStateDir: surfaceBridgeState?.runtimeStateDir ?? null,
  });

  log(`Status:      ${status}`);
  log(`Lifecycle:   ${lifecycle.summary}`);
  log(`Session:     ${session.summary}`);

  if (rawStatus === "stale" && inst.bridge) {
    state.instances[instanceId] = {
      ...inst,
      bridge: null,
      bridgeLifecycle: transitionBridgeLifecycle(
        inst.bridgeLifecycle ?? inst.bridge?.lifecycle ?? null,
        "crashed",
        "bridge pid not alive",
      ),
      managedAppServer: inst.bridge?.appServer?.managed
        ? probeRetainedAppServer(inst.bridge.appServer)
        : (inst.managedAppServer ?? null),
    };
    saveState(repoRoot, state);
  }

  if (surfaceBridgeState) {
    log(`PID:         ${surfaceBridgeState.pid}`);
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
    if (runtimeHeartbeat?.lastNotificationMethod) {
      log(
        `Notify:      ${runtimeHeartbeat.lastNotificationMethod} @ ${runtimeHeartbeat.lastNotificationAt ?? "-"}`,
      );
    }
    if (runtimeHeartbeat?.lastError) {
      log(`Last error:  ${runtimeHeartbeat.lastError}`);
    }
    log(`Log:         ${logFilePath(stateDir, instanceId)}`);
  }
  if (surfaceAppServer) {
    log(`App server:  ${surfaceAppServer.url}`);
    log(`Server PID:  ${surfaceAppServer.pid ?? "-"}`);
    log(`Server mode: ${surfaceAppServer.managed ? "managed" : "external"}`);
    log(`Health:      ${surfaceAppServer.healthy ? "healthy" : "unhealthy"}`);
    log(`Checked:     ${surfaceAppServer.lastCheckedAt}`);
    if (surfaceAppServer.logPath) {
      log(`Server log:  ${surfaceAppServer.logPath}`);
    }
    if (surfaceAppServer.auth) {
      log(`Auth:        ${surfaceAppServer.auth.mode}`);
      log(
        `Protected:   ${redactProtectedUrl(surfaceAppServer.auth.protectedUrl)}`,
      );
      log(`Upstream:    ${surfaceAppServer.auth.upstreamUrl}`);
      log(`TUI connect: ${surfaceAppServer.auth.upstreamUrl}`);
      log(`Gateway PID: ${surfaceAppServer.auth.gatewayPid ?? "-"}`);
      if (surfaceAppServer.auth.gatewayLogPath) {
        log(`Gateway log: ${surfaceAppServer.auth.gatewayLogPath}`);
      }
    } else if (surfaceAppServer.managed) {
      log(`Auth:        none (--no-auth)`);
      log(`TUI connect: ${surfaceAppServer.url}`);
    }
  }
  const transition = formatLifecycleTransition(lifecycle);
  if (transition) {
    log(`Transition:  ${transition}`);
  }
  if (liveDispatch) {
    log(
      `Drift:       fresh bridge-dispatch heartbeat from PID ${liveDispatch.bridgePid} without bridge pid state`,
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
      lifecycle: {
        presence: lifecycle.presence,
        status: lifecycle.status,
        summary: lifecycle.summary,
        lastTransitionAt: lifecycle.lastTransitionAt,
        lastTransitionReason: lifecycle.lastTransitionReason,
        restartCount: lifecycle.restartCount,
      },
      session: {
        status: session.status,
        turnState: session.turnState,
        summary: session.summary,
        activeTurnId: session.activeTurnId,
        idleSince: session.idleSince,
        lastTurnAt: session.lastTurnAt,
        lastDispatchAt: session.lastDispatchAt,
      },
      bridgeMode: inst.bridgeMode,
      pid: surfaceBridgeState?.pid ?? null,
      port: inst.port,
      lastHeartbeat: heartbeat,
      threadId: runtimeHeartbeat?.threadId ?? null,
      threadCwd: runtimeHeartbeat?.threadCwd ?? null,
      savedThreadId: savedThread?.threadId ?? null,
      savedThreadCwd: savedThread?.cwd ?? null,
      appServer: surfaceAppServer,
      lastNotificationMethod: runtimeHeartbeat?.lastNotificationMethod ?? null,
      lastNotificationAt: runtimeHeartbeat?.lastNotificationAt ?? null,
      lastError: runtimeHeartbeat?.lastError ?? null,
    },
  };
}
