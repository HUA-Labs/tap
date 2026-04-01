import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import { getBridgeStatus } from "../engine/bridge.js";
import type { InstanceId, TapState } from "../types.js";

export interface BridgeHeartbeatRecord {
  agent?: string;
  timestamp?: string;
  lastActivity?: string;
  status?: "active" | "idle" | "signing-off" | string;
}

export const BRIDGE_UP_ACTIVE_HEARTBEAT_WINDOW_MS = 10 * 60 * 1000;
export const BRIDGE_UP_ORPHAN_HEARTBEAT_WINDOW_MS = 24 * 60 * 60 * 1000;
export const BRIDGE_UP_SIGNING_OFF_HEARTBEAT_WINDOW_MS = 5 * 60 * 1000;

export function loadBridgeHeartbeatStore(
  commsDir: string,
): Record<string, BridgeHeartbeatRecord> | null {
  const heartbeatsPath = path.join(commsDir, "heartbeats.json");
  if (!existsSync(heartbeatsPath)) return {};
  try {
    return JSON.parse(readFileSync(heartbeatsPath, "utf-8")) as Record<
      string,
      BridgeHeartbeatRecord
    >;
  } catch {
    return null;
  }
}

export function saveBridgeHeartbeatStore(
  commsDir: string,
  store: Record<string, BridgeHeartbeatRecord>,
): void {
  const heartbeatsPath = path.join(commsDir, "heartbeats.json");
  const tmp = `${heartbeatsPath}.tmp.${process.pid}`;
  writeFileSync(tmp, JSON.stringify(store, null, 2), "utf-8");
  renameSync(tmp, heartbeatsPath);
}

export function parseBridgeHeartbeatAgeMs(
  record: BridgeHeartbeatRecord,
  now: number,
): number {
  const raw = record.lastActivity ?? record.timestamp;
  if (!raw) return Number.POSITIVE_INFINITY;
  const parsed = new Date(raw).getTime();
  if (!Number.isFinite(parsed)) return Number.POSITIVE_INFINITY;
  return Math.max(0, now - parsed);
}

export function resolveBridgeHeartbeatInstanceId(
  state: TapState,
  heartbeatId: string,
): InstanceId | null {
  if (state.instances[heartbeatId]) return heartbeatId as InstanceId;
  const hyphenated = heartbeatId.replace(/_/g, "-");
  if (state.instances[hyphenated]) return hyphenated as InstanceId;
  const underscored = heartbeatId.replace(/-/g, "_");
  if (state.instances[underscored]) return underscored as InstanceId;
  return null;
}

export function pruneStaleHeartbeatsForBridgeUp(
  state: TapState,
  stateDir: string,
  commsDir: string,
): { removed: number; warning?: string } {
  const store = loadBridgeHeartbeatStore(commsDir);
  if (store === null) {
    return {
      removed: 0,
      warning: "Auto-clean skipped — heartbeats.json unreadable",
    };
  }

  const now = Date.now();
  let removed = 0;

  for (const [heartbeatId, heartbeat] of Object.entries(store)) {
    const ageMs = parseBridgeHeartbeatAgeMs(heartbeat, now);
    const instanceId = resolveBridgeHeartbeatInstanceId(state, heartbeatId);
    const instance = instanceId ? state.instances[instanceId] : null;
    const bridgeBacked = instance?.bridgeMode === "app-server";
    const bridgeRunning =
      bridgeBacked && instanceId
        ? getBridgeStatus(stateDir, instanceId) === "running"
        : false;
    const status = heartbeat.status ?? "active";

    const staleByStatus =
      status === "signing-off" &&
      ageMs >= BRIDGE_UP_SIGNING_OFF_HEARTBEAT_WINDOW_MS;
    const staleByDeadBridge =
      bridgeBacked &&
      !bridgeRunning &&
      ageMs >= BRIDGE_UP_ACTIVE_HEARTBEAT_WINDOW_MS;
    const staleByAge =
      !bridgeRunning && ageMs >= BRIDGE_UP_ORPHAN_HEARTBEAT_WINDOW_MS;

    if (staleByStatus || staleByDeadBridge || staleByAge) {
      delete store[heartbeatId];
      removed += 1;
    }
  }

  if (removed > 0) {
    saveBridgeHeartbeatStore(commsDir, store);
  }

  return { removed };
}
