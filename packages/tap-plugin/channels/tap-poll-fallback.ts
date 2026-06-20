/**
 * tap-comms polling fallback: catches messages missed by fs.watch push.
 *
 * Runs periodically alongside the watcher. Scans inbox/reviews for files
 * that arrived after server start but were never pushed via channel
 * notification (e.g. due to fs.watch missing events on Windows).
 *
 * M93: Auto-poll fallback for push reliability.
 */
import { existsSync, readdirSync, statSync } from "fs";
import { basename } from "path";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  SERVER_START,
  getSourceDir,
  logInfo,
  logWarn,
  type ChannelSource,
} from "./tap-utils.js";
import { processWatchFile } from "./tap-watcher.js";

// ── Config ──────────────────────────────────────────────────────────────

// Windows fs.watch is unreliable for cross-process file creation; poll faster.
const POLL_INTERVAL_MS = process.platform === "win32" ? 3_000 : 30_000;
const POLL_SOURCES: ChannelSource[] = ["inbox", "reviews"];

// ── Stats ───────────────────────────────────────────────────────────────

let recoveredCount = 0;
let pollCycles = 0;

export type PollSourceCycleStats = {
  source: ChannelSource;
  dir: string | null;
  reviewGeneration: string | null;
  discovered: number;
  eligible: number;
  recovered: number;
  skippedBeforeServerStart: number;
  processErrors: number;
  dirMissing: boolean;
};

export type PollRunStats = {
  recovered: number;
  sources: PollSourceCycleStats[];
};

export function getPollStats() {
  return { pollCycles, recoveredCount };
}

export function isWatcherVerboseEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const normalized = env.TAP_WATCHER_VERBOSE?.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  return ["1", "true", "yes", "on"].includes(normalized);
}

export function buildPollCycleSummary(
  cycle: number,
  stats: PollRunStats,
  intervalMs = POLL_INTERVAL_MS,
) {
  const discovered = stats.sources.reduce(
    (total, source) => total + source.discovered,
    0,
  );
  const eligible = stats.sources.reduce(
    (total, source) => total + source.eligible,
    0,
  );
  const skippedBeforeServerStart = stats.sources.reduce(
    (total, source) => total + source.skippedBeforeServerStart,
    0,
  );
  const processErrors = stats.sources.reduce(
    (total, source) => total + source.processErrors,
    0,
  );
  return {
    cycle,
    intervalMs,
    discovered,
    eligible,
    recovered: stats.recovered,
    skippedBeforeServerStart,
    processErrors,
    sources: stats.sources,
  };
}

// ── Poll ────────────────────────────────────────────────────────────────

async function pollOnce(mcp: Server): Promise<PollRunStats> {
  let recovered = 0;
  const sources: PollSourceCycleStats[] = [];

  for (const source of POLL_SOURCES) {
    const dir = getSourceDir(source);
    if (!dir || !existsSync(dir)) {
      sources.push({
        source,
        dir: dir ?? null,
        reviewGeneration: null,
        discovered: 0,
        eligible: 0,
        recovered: 0,
        skippedBeforeServerStart: 0,
        processErrors: 0,
        dirMissing: true,
      });
      continue;
    }

    const sourceStats: PollSourceCycleStats = {
      source,
      dir,
      reviewGeneration: source === "reviews" ? basename(dir) : null,
      discovered: 0,
      eligible: 0,
      recovered: 0,
      skippedBeforeServerStart: 0,
      processErrors: 0,
      dirMissing: false,
    };

    let filenames: string[];
    try {
      filenames = readdirSync(dir).filter((f) => f.endsWith(".md"));
    } catch {
      sourceStats.processErrors++;
      sources.push(sourceStats);
      continue;
    }
    sourceStats.discovered = filenames.length;

    for (const filename of filenames) {
      // Quick pre-filter: only check files newer than server start
      const filepath = `${dir}/${filename}`;
      try {
        const mtime = statSync(filepath).mtimeMs;
        if (mtime < SERVER_START - 5000) {
          sourceStats.skippedBeforeServerStart++;
          continue;
        }
      } catch {
        sourceStats.processErrors++;
        continue;
      }
      sourceStats.eligible++;

      // processWatchFile handles notifiedFiles/inFlightFiles dedup internally.
      // If already notified, it returns false immediately (cheap).
      try {
        const sent = await processWatchFile(dir, source, filename, mcp);
        if (sent) {
          recovered++;
          sourceStats.recovered++;
        }
      } catch {
        sourceStats.processErrors++;
        // Non-critical — skip this file
      }
    }

    sources.push(sourceStats);
  }

  return {
    recovered,
    sources,
  };
}

// ── Start ───────────────────────────────────────────────────────────────

export function startPollFallback(mcp: Server) {
  logInfo("poll fallback started", {
    intervalMs: POLL_INTERVAL_MS,
    sources: POLL_SOURCES.join(","),
    watcherVerbose: isWatcherVerboseEnabled(),
    reviewSourceTracksLatest: true,
  });

  const maybeLogCycleSummary = (
    phase: "initial" | "interval",
    stats: PollRunStats,
  ) => {
    if (!isWatcherVerboseEnabled()) {
      return;
    }
    logInfo("poll fallback cycle summary", {
      phase,
      ...buildPollCycleSummary(pollCycles, stats),
    });
  };

  const timer = setInterval(async () => {
    pollCycles++;
    try {
      const stats = await pollOnce(mcp);
      maybeLogCycleSummary("interval", stats);
      if (stats.recovered > 0) {
        recoveredCount += stats.recovered;
        logInfo("poll fallback recovered missed messages", {
          count: stats.recovered,
          totalRecovered: recoveredCount,
        });
      }
    } catch (error) {
      logWarn("poll fallback error", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }, POLL_INTERVAL_MS);
  timer.unref();

  // Run first poll after a short delay (let watcher settle first)
  setTimeout(async () => {
    pollCycles++;
    try {
      const stats = await pollOnce(mcp);
      maybeLogCycleSummary("initial", stats);
      if (stats.recovered > 0) {
        recoveredCount += stats.recovered;
        logInfo("poll fallback initial recovery", {
          count: stats.recovered,
          totalRecovered: recoveredCount,
        });
      }
    } catch {
      // Non-critical
    }
  }, 5_000).unref();
}
