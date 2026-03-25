/**
 * State/Control API — programmatic access to tap state.
 * GUI and autopilot consume these functions instead of shelling out to CLI.
 *
 * M105 P1: getDashboardSnapshot, streamEvents (read-only)
 * M105 P2: startAgents, stopAgents (write — wraps tap up/down)
 */

import { collectDashboardSnapshot } from "../engine/dashboard.js";
import type { DashboardSnapshot } from "../engine/dashboard.js";
import { findRepoRoot } from "../utils.js";
import { resolveConfig } from "../config/index.js";
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
