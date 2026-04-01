import type { InstanceId } from "../types.js";
import { isBridgeRunning, loadRuntimeBridgeHeartbeat } from "./bridge-state.js";
import { getHeartbeatAge } from "./bridge-observability.js";

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

  let threadActive = false;
  try {
    const runtimeHb = loadRuntimeBridgeHeartbeat(stateDir, instanceId);
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
