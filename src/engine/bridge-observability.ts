/**
 * Bridge observability — heartbeat monitoring, turn stuck detection, log rotation.
 *
 * ## SSOT Hierarchy (M321)
 *
 * - **Process liveness** → `{runtimeStateDir}/heartbeat.json` (SSOT).
 *   Written by bridge-dispatch on each poll cycle. Contains detailed
 *   runtime state: threadId, turnState, connected, etc.
 *
 * - **`state.json` lastHeartbeat** → Legacy fallback only. No longer
 *   actively written. `resolveHeartbeatTimestamp()` prefers runtime
 *   heartbeat and falls back to this for pre-M321 state files.
 *
 * - **Agent presence** → `heartbeats.json` (commsDir). Separate concern,
 *   managed by MCP layer (`tap-plugin`). Not accessed here.
 *
 * Consolidated from bridge-state.ts (heartbeat/turn functions) and
 * bridge-log-rotate.ts into a single observability module.
 *
 * @module engine/bridge-observability
 */

import * as fs from "node:fs";
import type { InstanceId, BridgeState } from "../types.js";
import {
  loadBridgeState,
  clearBridgeState,
  loadRuntimeBridgeHeartbeat,
} from "./bridge-state.js";
import { isProcessAlive } from "./bridge-process-control.js";

// ─── Re-export for convenience (moved from bridge-state.ts) ──

// ─── Heartbeat ────────────────────────────────────────────────

/**
 * Resolve the most recent heartbeat timestamp from runtime or persisted state.
 */
function loadRuntimeHeartbeatTimestamp(
  runtimeStateDir: string | null | undefined,
): string | null {
  const heartbeat = loadRuntimeBridgeHeartbeat({ runtimeStateDir });
  return typeof heartbeat?.updatedAt === "string" ? heartbeat.updatedAt : null;
}

/**
 * Resolve the most authoritative heartbeat timestamp.
 *
 * Priority: runtime heartbeat.json (SSOT) → state.json lastHeartbeat (legacy fallback).
 * The legacy fallback covers pre-M321 state files that still have lastHeartbeat
 * but no runtime heartbeat.json. New bridges write runtime heartbeat only.
 */
function resolveHeartbeatTimestamp(
  state: BridgeState | null | undefined,
): string | null {
  return (
    loadRuntimeHeartbeatTimestamp(state?.runtimeStateDir) ??
    state?.lastHeartbeat ??
    null
  );
}

/**
 * Update the heartbeat timestamp for a running bridge.
 * Only the owning process (matching PID) can update the heartbeat.
 *
 * @deprecated M321 — Runtime heartbeat (`{runtimeStateDir}/heartbeat.json`)
 * is the SSOT for process liveness. `state.json lastHeartbeat` is no longer
 * actively updated. This function is kept for backward compatibility but
 * is a no-op. Use runtime heartbeat written by bridge-dispatch instead.
 */
export function updateBridgeHeartbeat(
  _stateDir: string,
  _instanceId: InstanceId,
): void {
  // M321: No-op. Runtime heartbeat.json (written by bridge-dispatch) is now
  // the sole source of truth for bridge process liveness. state.json
  // lastHeartbeat is retained as a read-only legacy fallback in
  // resolveHeartbeatTimestamp() but no longer actively written.
}

/**
 * Get heartbeat age in seconds. Returns null if no state or no heartbeat.
 */
export function getHeartbeatAge(
  stateDir: string,
  instanceId: InstanceId,
): number | null {
  const state = loadBridgeState(stateDir, instanceId);
  const heartbeat = resolveHeartbeatTimestamp(state);
  if (!heartbeat) return null;
  const heartbeatTime = new Date(heartbeat).getTime();
  if (isNaN(heartbeatTime)) return null;
  return Math.floor((Date.now() - heartbeatTime) / 1000);
}

export function getBridgeHeartbeatTimestamp(
  stateDir: string,
  instanceId: InstanceId,
): string | null {
  return resolveHeartbeatTimestamp(loadBridgeState(stateDir, instanceId));
}

// ─── Bridge status ────────────────────────────────────────────

export function getBridgeStatus(
  stateDir: string,
  instanceId: InstanceId,
): "running" | "stopped" | "stale" {
  const state = loadBridgeState(stateDir, instanceId);
  if (!state) return "stopped";

  if (!isProcessAlive(state.pid)) {
    clearBridgeState(stateDir, instanceId);
    return "stale";
  }

  return "running";
}

// ─── Turn stuck detection ─────────────────────────────────────

export interface TurnInfo {
  activeTurnId: string | null;
  lastTurnStatus: string | null;
  updatedAt: string | null;
  ageSeconds: number | null;
  stuck: boolean;
}

/**
 * Get current turn info from runtime heartbeat.
 * A turn is considered stuck if activeTurnId is set and turnStartedAt
 * exceeds the threshold.
 */
export function getTurnInfo(
  stateDir: string,
  instanceId: InstanceId,
  stuckThresholdSeconds: number = 300,
): TurnInfo | null {
  const state = loadBridgeState(stateDir, instanceId);
  if (!state) return null;

  const heartbeat = loadRuntimeBridgeHeartbeat(state);
  if (!heartbeat) return null;

  const activeTurnId = heartbeat.activeTurnId ?? null;
  const lastTurnStatus = heartbeat.lastTurnStatus ?? null;
  const turnTimestamp = heartbeat.turnStartedAt ?? null;
  const updatedAt = turnTimestamp ?? heartbeat.updatedAt ?? null;

  let ageSeconds: number | null = null;
  if (turnTimestamp) {
    const ts = new Date(turnTimestamp).getTime();
    if (!isNaN(ts)) {
      ageSeconds = Math.floor((Date.now() - ts) / 1000);
    }
  }

  const stuck =
    activeTurnId !== null &&
    ageSeconds !== null &&
    ageSeconds > stuckThresholdSeconds;

  return { activeTurnId, lastTurnStatus, updatedAt, ageSeconds, stuck };
}

/**
 * Check if a bridge's current turn is stuck.
 */
export function isTurnStuck(
  stateDir: string,
  instanceId: InstanceId,
  thresholdSeconds: number = 300,
): boolean {
  const info = getTurnInfo(stateDir, instanceId, thresholdSeconds);
  return info?.stuck ?? false;
}

// ─── Log rotation ─────────────────────────────────────────────

export function rotateLog(logPath: string): void {
  if (!fs.existsSync(logPath)) return;
  try {
    const stats = fs.statSync(logPath);
    if (stats.size === 0) return;
    const prevPath = `${logPath}.prev`;
    fs.renameSync(logPath, prevPath);
  } catch {
    // Best-effort: don't fail bridge start if rotation fails
  }
}
