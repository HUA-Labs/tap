import type {
  BridgeLifecycleRecord,
  BridgeState,
  InstanceId,
} from "../types.js";
import type {
  RuntimeBridgeHeartbeat,
  RuntimeBridgeThreadState,
} from "./bridge-state.js";
import {
  loadBridgeState,
  loadRuntimeBridgeHeartbeat,
  loadRuntimeBridgeThreadState,
} from "./bridge-state.js";
import { getBridgeStatus } from "./bridge-observability.js";

export type BridgePresence =
  | "bridge-live"
  | "bridge-stale"
  | "stopped";

export type BridgeLifecycleStatus =
  | "ready"
  | "initializing"
  | "degraded-no-thread"
  | "bridge-stale"
  | "stopped";

export interface BridgeLifecycleSnapshot {
  presence: BridgePresence;
  status: BridgeLifecycleStatus;
  summary: string;
  lastTransitionAt: string | null;
  lastTransitionReason: string | null;
  restartCount: number;
  threadId: string | null;
  threadCwd: string | null;
  savedThreadId: string | null;
  savedThreadCwd: string | null;
  activeTurnId: string | null;
  connected: boolean | null;
  initialized: boolean | null;
  appServerHealthy: boolean | null;
}

export interface DeriveBridgeLifecycleOptions {
  bridgeStatus: "running" | "stopped" | "stale";
  bridgeState?: BridgeState | null;
  runtimeHeartbeat?: RuntimeBridgeHeartbeat | null;
  savedThread?: RuntimeBridgeThreadState | null;
  persistedLifecycle?: BridgeLifecycleRecord | null;
}

function lifecycleMeta(
  persistedLifecycle: BridgeLifecycleRecord | null | undefined,
): Pick<
  BridgeLifecycleSnapshot,
  "lastTransitionAt" | "lastTransitionReason" | "restartCount"
> {
  return {
    lastTransitionAt: persistedLifecycle?.lastTransitionAt ?? null,
    lastTransitionReason: persistedLifecycle?.lastTransitionReason ?? null,
    restartCount: persistedLifecycle?.restartCount ?? 0,
  };
}

export function resolveBridgeLifecycleSnapshot(
  stateDir: string,
  instanceId: InstanceId,
  fallbackBridgeState?: BridgeState | null,
  persistedLifecycle?: BridgeLifecycleRecord | null,
): BridgeLifecycleSnapshot {
  const persistedBridgeState =
    loadBridgeState(stateDir, instanceId) ?? fallbackBridgeState ?? null;
  const bridgeStatus = getBridgeStatus(stateDir, instanceId);
  const bridgeState =
    bridgeStatus === "running"
      ? loadBridgeState(stateDir, instanceId) ?? persistedBridgeState
      : persistedBridgeState;

  return deriveBridgeLifecycleState({
    bridgeStatus,
    bridgeState,
    runtimeHeartbeat: loadRuntimeBridgeHeartbeat(bridgeState),
    savedThread: loadRuntimeBridgeThreadState(bridgeState),
    persistedLifecycle,
  });
}

export function deriveBridgeLifecycleState(
  options: DeriveBridgeLifecycleOptions,
): BridgeLifecycleSnapshot {
  const runtimeHeartbeat = options.runtimeHeartbeat ?? null;
  const savedThread = options.savedThread ?? null;
  const meta = lifecycleMeta(
    options.persistedLifecycle ?? options.bridgeState?.lifecycle ?? null,
  );

  if (options.bridgeStatus === "stopped") {
    return {
      presence: "stopped",
      status: "stopped",
      summary: "stopped",
      ...meta,
      threadId: null,
      threadCwd: null,
      savedThreadId: savedThread?.threadId ?? null,
      savedThreadCwd: savedThread?.cwd ?? null,
      activeTurnId: null,
      connected: null,
      initialized: null,
      appServerHealthy: options.bridgeState?.appServer?.healthy ?? null,
    };
  }

  if (options.bridgeStatus === "stale") {
    return {
      presence: "bridge-stale",
      status: "bridge-stale",
      summary: "bridge-stale",
      ...meta,
      threadId: runtimeHeartbeat?.threadId ?? null,
      threadCwd: runtimeHeartbeat?.threadCwd ?? null,
      savedThreadId: savedThread?.threadId ?? null,
      savedThreadCwd: savedThread?.cwd ?? null,
      activeTurnId: runtimeHeartbeat?.activeTurnId ?? null,
      connected: runtimeHeartbeat?.connected ?? null,
      initialized: runtimeHeartbeat?.initialized ?? null,
      appServerHealthy: options.bridgeState?.appServer?.healthy ?? null,
    };
  }

  const appServerHealthy = options.bridgeState?.appServer?.healthy ?? null;
  const threadId = runtimeHeartbeat?.threadId ?? null;
  const threadCwd = runtimeHeartbeat?.threadCwd ?? null;
  const connected = runtimeHeartbeat?.connected ?? null;
  const initialized = runtimeHeartbeat?.initialized ?? null;

  if (!runtimeHeartbeat) {
    return {
      presence: "bridge-live",
      status: "initializing",
      summary: "bridge-live, initializing",
      ...meta,
      threadId: null,
      threadCwd: null,
      savedThreadId: savedThread?.threadId ?? null,
      savedThreadCwd: savedThread?.cwd ?? null,
      activeTurnId: null,
      connected: null,
      initialized: null,
      appServerHealthy,
    };
  }

  if (initialized === false) {
    return {
      presence: "bridge-live",
      status: "initializing",
      summary: "bridge-live, initializing",
      ...meta,
      threadId,
      threadCwd,
      savedThreadId: savedThread?.threadId ?? null,
      savedThreadCwd: savedThread?.cwd ?? null,
      activeTurnId: runtimeHeartbeat.activeTurnId ?? null,
      connected,
      initialized,
      appServerHealthy,
    };
  }

  if (threadId && connected !== false) {
    return {
      presence: "bridge-live",
      status: "ready",
      summary: "bridge-live, ready",
      ...meta,
      threadId,
      threadCwd,
      savedThreadId: savedThread?.threadId ?? null,
      savedThreadCwd: savedThread?.cwd ?? null,
      activeTurnId: runtimeHeartbeat.activeTurnId ?? null,
      connected,
      initialized,
      appServerHealthy,
    };
  }

  const degradedReason = savedThread?.threadId
    ? "saved thread only"
    : connected === false
      ? "disconnected"
      : "no active thread";

  return {
    presence: "bridge-live",
    status: "degraded-no-thread",
    summary: `bridge-live, degraded-no-thread (${degradedReason})`,
    ...meta,
    threadId,
    threadCwd,
    savedThreadId: savedThread?.threadId ?? null,
    savedThreadCwd: savedThread?.cwd ?? null,
    activeTurnId: runtimeHeartbeat.activeTurnId ?? null,
    connected,
    initialized,
    appServerHealthy,
  };
}
