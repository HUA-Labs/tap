/**
 * Bridge state management — persistence, process liveness, runtime state readers.
 *
 * Extracted from engine/bridge.ts (Phase 2) to isolate state CRUD and
 * runtime heartbeat/thread readers.
 * Observability helpers (heartbeat age, turn stuck, log rotation) live in
 * bridge-observability.ts.
 *
 * @module engine/bridge-state
 */

import * as fs from "node:fs";
import type {
  InstanceId,
  BridgeLifecycleRecord,
  BridgeState,
  PersistedBridgeLifecycleState,
} from "../types.js";
import {
  pidFilePath,
  runtimeHeartbeatFilePath,
  runtimeThreadStateFilePath,
} from "./bridge-paths.js";
import { writeProtectedTextFile } from "./bridge-file-io.js";
import { isProcessAlive } from "./bridge-process-control.js";

// ─── Types ────────────────────────────────────────────────────

export interface RuntimeBridgeHeartbeat {
  updatedAt?: string;
  threadId?: string | null;
  threadCwd?: string | null;
  activeTurnId?: string | null;
  turnStartedAt?: string | null;
  lastTurnStatus?: string | null;
  lastTurnAt?: string | null;
  lastDispatchAt?: string | null;
  idleSince?: string | null;
  turnState?: "active" | "idle" | "waiting-approval" | "disconnected" | null;
  lastError?: string | null;
  connected?: boolean;
  initialized?: boolean;
}

export interface RuntimeBridgeThreadState {
  threadId: string;
  updatedAt?: string;
  appServerUrl?: string;
  ephemeral?: boolean;
  cwd?: string | null;
}

// ─── Persisted lifecycle helpers ──────────────────────────────

export function transitionBridgeLifecycle(
  previous: BridgeLifecycleRecord | null | undefined,
  nextState: PersistedBridgeLifecycleState,
  reason: string | null,
  options?: {
    at?: string;
    incrementRestart?: boolean;
  },
): BridgeLifecycleRecord {
  const at = options?.at ?? new Date().toISOString();
  const changed = previous?.state !== nextState;

  return {
    state: nextState,
    since: changed || !previous?.since ? at : previous.since,
    updatedAt: at,
    lastTransitionAt:
      changed || !previous?.lastTransitionAt ? at : previous.lastTransitionAt,
    lastTransitionReason:
      changed || previous?.lastTransitionReason == null
        ? reason
        : previous.lastTransitionReason,
    restartCount:
      (previous?.restartCount ?? 0) + (options?.incrementRestart ? 1 : 0),
  };
}

// ─── Runtime state readers ────────────────────────────────────

export function loadRuntimeBridgeHeartbeat(
  bridgeState:
    | {
        runtimeStateDir?: string | null;
      }
    | null
    | undefined,
): RuntimeBridgeHeartbeat | null {
  const runtimeStateDir = bridgeState?.runtimeStateDir;
  if (!runtimeStateDir) {
    return null;
  }

  const heartbeatPath = runtimeHeartbeatFilePath(runtimeStateDir);
  if (!fs.existsSync(heartbeatPath)) {
    return null;
  }

  try {
    return JSON.parse(
      fs.readFileSync(heartbeatPath, "utf-8"),
    ) as RuntimeBridgeHeartbeat;
  } catch {
    return null;
  }
}

export function loadRuntimeBridgeThreadState(
  bridgeState:
    | {
        runtimeStateDir?: string | null;
      }
    | null
    | undefined,
): RuntimeBridgeThreadState | null {
  const runtimeStateDir = bridgeState?.runtimeStateDir;
  if (!runtimeStateDir) {
    return null;
  }

  const threadPath = runtimeThreadStateFilePath(runtimeStateDir);
  if (!fs.existsSync(threadPath)) {
    return null;
  }

  try {
    const parsed = JSON.parse(
      fs.readFileSync(threadPath, "utf-8"),
    ) as RuntimeBridgeThreadState;
    return parsed.threadId ? parsed : null;
  } catch {
    return null;
  }
}

// ─── Bridge state CRUD ────────────────────────────────────────

export function loadBridgeState(
  stateDir: string,
  instanceId: InstanceId,
): BridgeState | null {
  const pidPath = pidFilePath(stateDir, instanceId);
  if (!fs.existsSync(pidPath)) return null;

  try {
    const raw = fs.readFileSync(pidPath, "utf-8");
    return JSON.parse(raw) as BridgeState;
  } catch {
    return null;
  }
}

export function saveBridgeState(
  stateDir: string,
  instanceId: InstanceId,
  state: BridgeState,
): void {
  const pidPath = pidFilePath(stateDir, instanceId);
  const serializable = JSON.parse(JSON.stringify(state)) as BridgeState & {
    appServer?: { auth?: { token?: string } | null } | null;
  };
  if (serializable.appServer?.auth) {
    delete serializable.appServer.auth.token;
  }
  writeProtectedTextFile(pidPath, JSON.stringify(serializable, null, 2));
}

export function clearBridgeState(
  stateDir: string,
  instanceId: InstanceId,
): void {
  const pidPath = pidFilePath(stateDir, instanceId);
  if (fs.existsSync(pidPath)) {
    fs.unlinkSync(pidPath);
  }
}

// ─── Process liveness ─────────────────────────────────────────

export function isBridgeRunning(
  stateDir: string,
  instanceId: InstanceId,
): boolean {
  const state = loadBridgeState(stateDir, instanceId);
  if (!state) return false;
  return isProcessAlive(state.pid);
}
