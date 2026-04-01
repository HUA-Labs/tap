import * as path from "node:path";
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
  transitionBridgeLifecycle,
} from "../engine/bridge.js";
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
      };
      continue;
    }

    const status = getBridgeStatus(stateDir, instanceId);
    const bridgeState = loadBridgeState(stateDir, instanceId) ?? inst.bridge;
    const runtimeHeartbeat = loadRuntimeBridgeHeartbeat(bridgeState);
    const savedThread = loadRuntimeBridgeThreadState(bridgeState);
    const lifecycle = deriveBridgeLifecycleState({
      bridgeStatus: status,
      bridgeState,
      runtimeHeartbeat,
      savedThread,
      persistedLifecycle:
        inst.bridgeLifecycle ?? bridgeState?.lifecycle ?? null,
    });
    const session =
      status === "running"
        ? deriveCodexSessionState({
            runtimeHeartbeat,
            runtimeStateDir: bridgeState?.runtimeStateDir ?? null,
          })
        : null;
    const age = getHeartbeatAge(stateDir, instanceId);

    if (lifecycle.status === "bridge-stale" && inst.bridge) {
      state.instances[instanceId] = {
        ...inst,
        bridge: null,
        bridgeLifecycle: transitionBridgeLifecycle(
          inst.bridgeLifecycle ?? inst.bridge?.lifecycle ?? null,
          "crashed",
          "bridge pid not alive",
        ),
      };
      stateChanged = true;
    }

    const pid = bridgeState?.pid ?? null;
    const heartbeat = getBridgeHeartbeatTimestamp(stateDir, instanceId);
    const pidStr = pid ? String(pid) : "-";
    const portStr = inst.port ? String(inst.port) : "-";
    const ageStr = age !== null ? formatAge(age) : "-";

    log(
      `${instanceId.padEnd(20)} ${inst.runtime.padEnd(8)} ${status.padEnd(10)} ${lifecycle.status.padEnd(20)} ${(session?.status ?? "-").padEnd(18)} ${pidStr.padEnd(8)} ${portStr.padEnd(6)} ${ageStr}`,
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
    const transition = formatLifecycleTransition(lifecycle);
    if (transition) {
      log(`  Transition: ${transition}`);
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
      appServer: bridgeState?.appServer ?? null,
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
  const status = getBridgeStatus(stateDir, instanceId);
  const bridgeState = loadBridgeState(stateDir, instanceId) ?? inst.bridge;
  const runtimeHeartbeat = loadRuntimeBridgeHeartbeat(bridgeState);
  const savedThread = loadRuntimeBridgeThreadState(bridgeState);
  const age = getHeartbeatAge(stateDir, instanceId);
  const heartbeat = getBridgeHeartbeatTimestamp(stateDir, instanceId);
  const lifecycle = deriveBridgeLifecycleState({
    bridgeStatus: status,
    bridgeState,
    runtimeHeartbeat,
    savedThread,
    persistedLifecycle: inst.bridgeLifecycle ?? bridgeState?.lifecycle ?? null,
  });
  const session = deriveCodexSessionState({
    runtimeHeartbeat,
    runtimeStateDir: bridgeState?.runtimeStateDir ?? null,
  });

  log(`Status:      ${status}`);
  log(`Lifecycle:   ${lifecycle.summary}`);
  log(`Session:     ${session.summary}`);

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
  const transition = formatLifecycleTransition(lifecycle);
  if (transition) {
    log(`Transition:  ${transition}`);
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
