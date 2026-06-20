/**
 * Bridge-layer heartbeat pruning for agent presence store.
 *
 * ## SSOT Hierarchy (M321)
 *
 * - **Agent presence** → `heartbeats.json` (commsDir), managed by MCP layer
 *   (`tap-plugin/channels/tap-io.ts`). This file uses the same load/save
 *   helpers below because tap-comms cannot import from tap-plugin directly.
 *
 * - **Process liveness** → `{runtimeStateDir}/heartbeat.json`, per-bridge
 *   runtime heartbeat written by bridge-dispatch. Separate concern.
 *
 * This module only prunes stale entries from the agent presence store
 * during `bridge up`. It does NOT own the store — MCP layer does.
 */
import {
  existsSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import * as path from "node:path";
import { getBridgeStatus } from "../engine/bridge.js";
import type { InstanceId, TapState } from "../types.js";

// ── M187: Lock + EBUSY-resilient I/O helpers (mirrored from tap-io.ts) ──
// tap-comms cannot import from tap-plugin — duplicated here.

function acquireHeartbeatLock(commsDir: string, retries = 3, delayMs = 100): boolean {
  const lockPath = path.join(commsDir, ".heartbeats.lock");
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      writeFileSync(lockPath, String(process.pid), { flag: "wx" });
      return true;
    } catch {
      try {
        const age = Date.now() - statSync(lockPath).mtimeMs;
        if (age > 10_000) {
          unlinkSync(lockPath);
          continue;
        }
      } catch {}
      if (attempt < retries - 1) {
        busySpin(delayMs);
      }
    }
  }
  return false;
}

function releaseHeartbeatLock(commsDir: string): void {
  try {
    unlinkSync(path.join(commsDir, ".heartbeats.lock"));
  } catch {}
}
const EBUSY_MAX_RETRIES = 4;
const EBUSY_BASE_DELAY_MS = 25;

function isEbusyError(error: unknown): boolean {
  if (!error || typeof error !== "object" || !("code" in error)) return false;
  const code = (error as NodeJS.ErrnoException).code;
  return code === "EBUSY" || code === "EPERM" || code === "EACCES";
}

function busySpin(ms: number): void {
  const end = Date.now() + ms;
  while (Date.now() < end) {}
}

function resilientRename(tmpPath: string, targetPath: string): void {
  for (let attempt = 0; attempt < EBUSY_MAX_RETRIES; attempt++) {
    try {
      renameSync(tmpPath, targetPath);
      return;
    } catch (error) {
      if (!isEbusyError(error) || attempt === EBUSY_MAX_RETRIES - 1) throw error;
      busySpin(EBUSY_BASE_DELAY_MS * (attempt + 1));
    }
  }
}

function resilientReadJson<T>(filePath: string, fallback: T): T {
  for (let attempt = 0; attempt < EBUSY_MAX_RETRIES; attempt++) {
    try {
      return JSON.parse(readFileSync(filePath, "utf-8")) as T;
    } catch (error) {
      if (!isEbusyError(error) || attempt === EBUSY_MAX_RETRIES - 1) {
        return fallback;
      }
      busySpin(EBUSY_BASE_DELAY_MS * (attempt + 1));
    }
  }
  return fallback;
}

/**
 * Minimal heartbeat record shape — compatible with tap-plugin's `Heartbeat`
 * type but only declares fields needed for pruning decisions.
 */
export interface BridgeHeartbeatRecord {
  agent?: string;
  timestamp?: string;
  lastActivity?: string;
  status?: "active" | "idle" | "signing-off" | string;
}

export const BRIDGE_UP_ACTIVE_HEARTBEAT_WINDOW_MS = 10 * 60 * 1000;
export const BRIDGE_UP_ORPHAN_HEARTBEAT_WINDOW_MS = 24 * 60 * 60 * 1000;
export const BRIDGE_UP_SIGNING_OFF_HEARTBEAT_WINDOW_MS = 5 * 60 * 1000;

/**
 * Load agent presence store from `{commsDir}/heartbeats.json`.
 *
 * Note: This is the same file managed by `tap-plugin/channels/tap-io.ts`.
 * Duplicated here because tap-comms cannot depend on tap-plugin.
 */
export function loadBridgeHeartbeatStore(
  commsDir: string,
): Record<string, BridgeHeartbeatRecord> | null {
  const heartbeatsPath = path.join(commsDir, "heartbeats.json");
  if (!existsSync(heartbeatsPath)) return {};
  const result = resilientReadJson<Record<string, BridgeHeartbeatRecord> | null>(
    heartbeatsPath,
    null,
  );
  return result;
}

/**
 * Save agent presence store to `{commsDir}/heartbeats.json` (atomic rename).
 *
 * Note: Same file as tap-plugin's `saveHeartbeats()`. See module doc for why
 * this duplication exists.
 */
export function saveBridgeHeartbeatStore(
  commsDir: string,
  store: Record<string, BridgeHeartbeatRecord>,
): void {
  const heartbeatsPath = path.join(commsDir, "heartbeats.json");
  const tmp = `${heartbeatsPath}.tmp.${process.pid}`;
  writeFileSync(tmp, JSON.stringify(store, null, 2), "utf-8");
  resilientRename(tmp, heartbeatsPath);
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
  // M187: Acquire same lock as tap-plugin to prevent stale-data overwrite.
  // Without this, concurrent MCP writes can be lost when prune saves.
  if (!acquireHeartbeatLock(commsDir)) {
    return {
      removed: 0,
      warning: "Auto-clean skipped — heartbeat lock busy",
    };
  }

  try {
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
        // M334: Also remove per-agent presence file to prevent zombie merge
        try {
          const sanitizedId = heartbeatId.replace(/[/\\:]/g, "_");
          const presencePath = path.join(commsDir, "presence", `${sanitizedId}.json`);
          if (existsSync(presencePath)) unlinkSync(presencePath);
        } catch {
          // Non-fatal — presence file cleanup is best-effort
        }
        removed += 1;
      }
    }

    if (removed > 0) {
      saveBridgeHeartbeatStore(commsDir, store);
    }

    return { removed };
  } finally {
    releaseHeartbeatLock(commsDir);
  }
}
