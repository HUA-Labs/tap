/**
 * State/Control API — programmatic access to tap state.
 * GUI and autopilot consume these functions instead of shelling out to CLI.
 *
 * M105 P1: getDashboardSnapshot, streamEvents (read-only)
 * M105 P2: startAgents, stopAgents (write — wraps tap up/down)
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { collectDashboardSnapshot } from "../engine/dashboard.js";
import type { DashboardSnapshot } from "../engine/dashboard.js";
import { findRepoRoot } from "../utils.js";
import { resolveConfig } from "../config/index.js";
import { loadState } from "../state.js";
import type { CommandResult } from "../types.js";

export interface StateApiOptions {
  repoRoot?: string;
  commsDir?: string;
}

/**
 * Get a point-in-time snapshot of all tap state:
 * agents, bridges, PRs, and warnings.
 *
 * This is the read-only entry point for GUI dashboards and autopilot.
 */
export function getDashboardSnapshot(
  options?: StateApiOptions,
): DashboardSnapshot {
  const repoRoot = options?.repoRoot ?? findRepoRoot();
  return collectDashboardSnapshot(repoRoot, options?.commsDir);
}

export interface EventStreamOptions extends StateApiOptions {
  /** Poll interval in milliseconds (default: 2000) */
  intervalMs?: number;
  /** AbortSignal to stop the stream */
  signal?: AbortSignal;
}

/**
 * Async generator that yields dashboard snapshots at regular intervals.
 * Useful for SSE or WebSocket push to GUI clients.
 *
 * Stops when the AbortSignal fires or the consumer breaks out.
 */
export async function* streamEvents(
  options?: EventStreamOptions,
): AsyncGenerator<DashboardSnapshot> {
  const intervalMs = options?.intervalMs ?? 2000;
  const repoRoot = options?.repoRoot ?? findRepoRoot();

  while (!options?.signal?.aborted) {
    yield collectDashboardSnapshot(repoRoot, options?.commsDir);
    await new Promise<void>((resolve) => {
      const onAbort = () => {
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        options?.signal?.removeEventListener("abort", onAbort);
        resolve();
      }, intervalMs);
      options?.signal?.addEventListener("abort", onAbort, { once: true });
    });
  }
}

// ── Write API ───────────────────────────────────────────────────

export interface AgentControlOptions {
  /** Extra CLI args forwarded to `tap up` (e.g. `["--no-auth"]`) */
  args?: string[];
}

export interface AgentControlResult {
  ok: boolean;
  message: string;
  snapshot: DashboardSnapshot;
  commandResult: CommandResult;
}

/**
 * Start all registered bridge daemons.
 * Equivalent to `tap up [...args]`.
 *
 * Always operates on the cwd-based repo (same as CLI commands).
 * Use read-only APIs (getDashboardSnapshot) for cross-repo queries.
 */
export async function startAgents(
  options?: AgentControlOptions,
): Promise<AgentControlResult> {
  const { upCommand } = await import("../commands/up.js");
  const result = await upCommand(options?.args ?? []);
  const repoRoot = findRepoRoot();
  const snapshot = collectDashboardSnapshot(repoRoot);
  return {
    ok: result.ok,
    message: result.message,
    snapshot,
    commandResult: result,
  };
}

/**
 * Stop all running bridge daemons.
 * Equivalent to `tap down`.
 *
 * Always operates on the cwd-based repo (same as CLI commands).
 */
export async function stopAgents(): Promise<AgentControlResult> {
  const { downCommand } = await import("../commands/down.js");
  const result = await downCommand([]);
  const repoRoot = findRepoRoot();
  const snapshot = collectDashboardSnapshot(repoRoot);
  return {
    ok: result.ok,
    message: result.message,
    snapshot,
    commandResult: result,
  };
}

// ── Health ──────────────────────────────────────────────────────

export interface HealthReport {
  ok: boolean;
  timestamp: string;
  bridges: DashboardSnapshot["bridges"];
  agents: DashboardSnapshot["agents"];
  warnings: DashboardSnapshot["warnings"];
  headless: Record<string, unknown>[];
}

/**
 * Health check that combines dashboard snapshot with headless state.
 * Consumed by monitoring tools (Uptime Kuma, cron, autopilot).
 */
export function getHealthReport(options?: StateApiOptions): HealthReport {
  const repoRoot = options?.repoRoot ?? findRepoRoot();
  const snapshot = collectDashboardSnapshot(repoRoot, options?.commsDir);

  // Collect headless state from .tmp/ dirs — active instances only
  // (same filter as doctor checkBridgeTurnHealth to avoid stale session debris)
  const headlessStates: Record<string, unknown>[] = [];
  try {
    const state = loadState(repoRoot);
    const activeMatchers = new Set<string>();
    if (state) {
      for (const [id, inst] of Object.entries(state.instances)) {
        if (inst?.installed && inst.bridgeMode === "app-server") {
          activeMatchers.add(id);
          if (inst.agentName) activeMatchers.add(inst.agentName);
        }
      }
    }

    const tmpDir = path.join(repoRoot, ".tmp");
    if (fs.existsSync(tmpDir)) {
      for (const dir of fs.readdirSync(tmpDir)) {
        if (!dir.startsWith("codex-app-server-bridge")) continue;
        const suffix = dir.replace("codex-app-server-bridge-", "");
        // Filter to active instances (skip past session debris)
        if (activeMatchers.size > 0) {
          let matched = false;
          for (const matcher of activeMatchers) {
            if (suffix === matcher || suffix.startsWith(matcher)) {
              matched = true;
              break;
            }
          }
          if (!matched) continue;
        }
        const hsPath = path.join(tmpDir, dir, "headless-state.json");
        if (!fs.existsSync(hsPath)) continue;
        try {
          const hs = JSON.parse(fs.readFileSync(hsPath, "utf-8"));
          headlessStates.push({ instanceDir: dir, ...hs });
        } catch {
          // skip corrupted
        }
      }
    }
  } catch {
    // .tmp doesn't exist or state load failed
  }

  const hasFailures = snapshot.warnings.some((w) => w.level === "error");
  const hasBridgeDown = snapshot.bridges.some(
    (b) =>
      b.status === "stale" ||
      b.status === "stopped" ||
      b.lifecycle?.status === "degraded-no-thread",
  );
  const hasBridgeDegraded = snapshot.bridges.some(
    (b) => b.lifecycle?.status === "degraded-no-thread",
  );

  return {
    ok: !hasFailures && !hasBridgeDown && !hasBridgeDegraded,
    timestamp: snapshot.generatedAt,
    bridges: snapshot.bridges,
    agents: snapshot.agents,
    warnings: snapshot.warnings,
    headless: headlessStates,
  };
}

// ── Config ──────────────────────────────────────────────────────

/**
 * Resolve tap configuration for API consumers.
 * Returns paths and settings without requiring CLI args.
 */
export function getConfig(options?: StateApiOptions) {
  const repoRoot = options?.repoRoot ?? findRepoRoot();
  const { config } = resolveConfig({}, repoRoot);
  return {
    repoRoot,
    commsDir: options?.commsDir ?? config.commsDir,
    stateDir: config.stateDir,
    appServerUrl: config.appServerUrl,
  };
}
