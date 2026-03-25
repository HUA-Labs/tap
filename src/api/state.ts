/**
 * State/Control API — programmatic access to tap state.
 * GUI and autopilot consume these functions instead of shelling out to CLI.
 *
 * M105: JSON contract for getDashboardSnapshot, streamEvents.
 */

import { collectDashboardSnapshot } from "../engine/dashboard.js";
import type { DashboardSnapshot } from "../engine/dashboard.js";
import { findRepoRoot } from "../utils.js";
import { resolveConfig } from "../config/index.js";

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
