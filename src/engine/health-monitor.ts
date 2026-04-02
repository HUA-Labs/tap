import * as fs from "node:fs";
import * as path from "node:path";
import type { InstanceId } from "../types.js";
import {
  isBridgeRunning,
  loadBridgeState,
  loadRuntimeBridgeHeartbeat,
} from "./bridge-state.js";
import { getHeartbeatAge } from "./bridge-observability.js";
import { isProcessAlive } from "./bridge-process-control.js";

// ─── Types ─────────────────────────────────────────────────────

/**
 * Operational status — reflects what the agent can actually do right now.
 * More useful for operators than raw pass/fail.
 */
export type OperationalStatus =
  | "routing-healthy" // bridge-live + dispatch active + thread active
  | "routing-degraded" // bridge-live + dispatch ok + thread idle/missing
  | "bridge-stale" // PID alive but no recent activity
  | "mcp-only" // MCP direct session, no bridge
  | "backlog-blind" // post-startup session, missed past messages
  | "unreachable"; // all checks failed

export interface HealthCheckResult {
  instanceId: string;
  timestamp: string;
  operational: OperationalStatus;
  checks: {
    bridgePidAlive: boolean;
    heartbeatFresh: boolean;
    threadActive: boolean;
  };
}

type CommsHeartbeatRecord = {
  timestamp?: string;
  lastActivity?: string;
  source?: "bridge-dispatch" | "mcp-direct";
  instanceId?: string | null;
  bridgePid?: number | null;
  connectHash?: string;
};

export interface LiveDispatchEvidence {
  bridgePid: number;
  lastActivity: string;
}

export interface HealthPolicy {
  checkIntervalMs: number; // default 30000
  unhealthyThreshold: number; // consecutive failures → degraded (default 3)
  deadThreshold: number; // consecutive failures → restart (default 5)
  maxRestarts: number; // auto-restart cap (default 3)
  restartBackoffMs: number; // base backoff (default 5000, exponential)
  alertOnMaxRestarts: boolean; // broadcast alert when cap exceeded
}

export interface HealthHistory {
  instanceId: string;
  entries: HealthCheckResult[]; // ring buffer, max 100
  currentStreak: number; // positive = consecutive pass, negative = consecutive fail
  lastRestart: string | null;
  totalRestarts: number;
}

// ─── Defaults ──────────────────────────────────────────────────

export const DEFAULT_HEALTH_POLICY: HealthPolicy = {
  checkIntervalMs: 30_000,
  unhealthyThreshold: 3,
  deadThreshold: 5,
  maxRestarts: 3,
  restartBackoffMs: 5_000,
  alertOnMaxRestarts: true,
};

const MAX_HISTORY_ENTRIES = 100;
const DISPATCH_EVIDENCE_FRESH_THRESHOLD_MS = 2 * 60 * 1000;

function getHeartbeatActivityMs(record: CommsHeartbeatRecord): number | null {
  const timestamp = new Date(record.lastActivity ?? record.timestamp ?? 0).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function isSameInstanceHeartbeat(
  key: string,
  heartbeat: CommsHeartbeatRecord,
  instanceId: InstanceId,
): boolean {
  if (heartbeat.instanceId === instanceId) return true;
  if (heartbeat.connectHash === `instance:${instanceId}`) return true;
  return (
    key === instanceId ||
    key.replace(/_/g, "-") === instanceId ||
    key.replace(/-/g, "_") === instanceId
  );
}

export function loadLiveDispatchEvidence(
  commsDir: string,
  instanceId: InstanceId,
): LiveDispatchEvidence | null {
  const heartbeatsPath = path.join(commsDir, "heartbeats.json");
  if (!fs.existsSync(heartbeatsPath)) return null;

  try {
    const store = JSON.parse(
      fs.readFileSync(heartbeatsPath, "utf-8"),
    ) as Record<string, CommsHeartbeatRecord>;

    let best: LiveDispatchEvidence | null = null;
    let bestActivityMs = -1;

    for (const [key, heartbeat] of Object.entries(store)) {
      if (!isSameInstanceHeartbeat(key, heartbeat, instanceId)) continue;
      if (heartbeat.source !== "bridge-dispatch") continue;
      if (heartbeat.bridgePid == null || !isProcessAlive(heartbeat.bridgePid)) {
        continue;
      }

      const activityMs = getHeartbeatActivityMs(heartbeat);
      if (
        activityMs == null ||
        Date.now() - activityMs > DISPATCH_EVIDENCE_FRESH_THRESHOLD_MS
      ) {
        continue;
      }

      if (activityMs > bestActivityMs) {
        bestActivityMs = activityMs;
        best = {
          bridgePid: heartbeat.bridgePid,
          lastActivity:
            heartbeat.lastActivity ?? heartbeat.timestamp ?? new Date(activityMs).toISOString(),
        };
      }
    }

    return best;
  } catch {
    return null;
  }
}

// ─── Health History Management ─────────────────────────────────

export function createHealthHistory(instanceId: string): HealthHistory {
  return {
    instanceId,
    entries: [],
    currentStreak: 0,
    lastRestart: null,
    totalRestarts: 0,
  };
}

export function recordHealthCheck(
  history: HealthHistory,
  result: HealthCheckResult,
): HealthHistory {
  const entries = [...history.entries, result];
  if (entries.length > MAX_HISTORY_ENTRIES) {
    entries.shift();
  }

  // Only routing-healthy resets failure streak.
  // routing-degraded (thread missing) should still accumulate toward restart.
  const isHealthy = result.operational === "routing-healthy";

  const currentStreak = isHealthy
    ? history.currentStreak > 0
      ? history.currentStreak + 1
      : 1
    : history.currentStreak < 0
      ? history.currentStreak - 1
      : -1;

  return {
    ...history,
    entries,
    currentStreak,
  };
}

export function recordRestart(history: HealthHistory): HealthHistory {
  return {
    ...history,
    lastRestart: new Date().toISOString(),
    totalRestarts: history.totalRestarts + 1,
    currentStreak: 0,
  };
}

// ─── Operational Status Derivation ─────────────────────────────

export function computeOperationalStatus(checks: {
  bridgePidAlive: boolean;
  heartbeatFresh: boolean;
  threadActive: boolean;
}): OperationalStatus {
  if (!checks.bridgePidAlive) {
    if (!checks.heartbeatFresh) return "unreachable";
    return "mcp-only";
  }

  if (!checks.heartbeatFresh) return "bridge-stale";

  if (checks.threadActive) return "routing-healthy";
  return "routing-degraded";
}

// ─── Policy Evaluation ─────────────────────────────────────────

export type HealthAction = "none" | "warn" | "restart" | "alert-max-restarts";

/**
 * Determine what action to take based on health history and policy.
 */
export function evaluateHealthAction(
  history: HealthHistory,
  policy: HealthPolicy,
): HealthAction {
  // Positive streak = healthy, no action needed
  if (history.currentStreak >= 0) return "none";

  const failCount = Math.abs(history.currentStreak);

  // Check if we've exhausted restart budget
  if (history.totalRestarts >= policy.maxRestarts) {
    return policy.alertOnMaxRestarts ? "alert-max-restarts" : "none";
  }

  // Dead threshold → restart
  if (failCount >= policy.deadThreshold) return "restart";

  // Unhealthy threshold → warn
  if (failCount >= policy.unhealthyThreshold) return "warn";

  return "none";
}

// ─── Runtime Health Check ──────────────────────────────────────

const HEARTBEAT_FRESH_THRESHOLD_MS = 2 * 60 * 1000; // 2 minutes

/**
 * Check instance health from bridge state files.
 * Returns a HealthCheckResult with operational status derived from live state.
 */
export function checkInstanceHealth(
  stateDir: string,
  instanceId: InstanceId,
): HealthCheckResult {
  const bridgePidAlive = isBridgeRunning(stateDir, instanceId);
  const heartbeatAgeMs = getHeartbeatAge(stateDir, instanceId);
  const heartbeatFresh =
    heartbeatAgeMs !== null && heartbeatAgeMs < HEARTBEAT_FRESH_THRESHOLD_MS;
  const bridgeState = loadBridgeState(stateDir, instanceId);

  let threadActive = false;
  try {
    const runtimeHb = loadRuntimeBridgeHeartbeat(bridgeState);
    threadActive = runtimeHb?.threadId != null;
  } catch {
    // runtime heartbeat not available
  }

  const checks = { bridgePidAlive, heartbeatFresh, threadActive };
  return {
    instanceId,
    timestamp: new Date().toISOString(),
    operational: computeOperationalStatus(checks),
    checks,
  };
}

// ─── Backoff ───────────────────────────────────────────────────

/**
 * Calculate backoff delay for restart attempt.
 * Exponential: base * 2^(restartCount - 1), capped at 5 minutes.
 */
export function computeBackoffMs(restartCount: number, baseMs: number): number {
  const delay = baseMs * Math.pow(2, Math.max(0, restartCount - 1));
  return Math.min(delay, 5 * 60 * 1000); // cap at 5 minutes
}
