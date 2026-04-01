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
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  SERVER_START,
  getSourceDir,
  debug,
  type ChannelSource,
} from "./tap-utils.js";
import { processWatchFile } from "./tap-watcher.js";

// ── Config ──────────────────────────────────────────────────────────────

// Windows fs.watch is unreliable for cross-process file creation; poll faster.
const POLL_INTERVAL_MS = process.platform === "win32" ? 10_000 : 30_000;
const POLL_SOURCES: ChannelSource[] = ["inbox", "reviews"];

// ── Stats ───────────────────────────────────────────────────────────────

let recoveredCount = 0;
let pollCycles = 0;

export function getPollStats() {
  return { pollCycles, recoveredCount };
}

// ── Poll ────────────────────────────────────────────────────────────────

async function pollOnce(mcp: Server): Promise<number> {
  let recovered = 0;

  for (const source of POLL_SOURCES) {
    const dir = getSourceDir(source);
    if (!dir || !existsSync(dir)) continue;

    let filenames: string[];
    try {
      filenames = readdirSync(dir).filter((f) => f.endsWith(".md"));
    } catch {
      continue;
    }

    for (const filename of filenames) {
      // Quick pre-filter: only check files newer than server start
      const filepath = `${dir}/${filename}`;
      try {
        const mtime = statSync(filepath).mtimeMs;
        if (mtime < SERVER_START - 5000) continue;
      } catch {
        continue;
      }

      // processWatchFile handles notifiedFiles/inFlightFiles dedup internally.
      // If already notified, it returns false immediately (cheap).
      try {
        const sent = await processWatchFile(dir, source, filename, mcp);
        if (sent) {
          recovered++;
          debug(`poll-fallback recovered [${source}]: ${filename}`);
        }
      } catch {
        // Non-critical — skip this file
      }
    }
  }

  return recovered;
}

// ── Start ───────────────────────────────────────────────────────────────

export function startPollFallback(mcp: Server) {
  debug(`poll-fallback: starting (interval=${POLL_INTERVAL_MS}ms)`);

  const timer = setInterval(async () => {
    pollCycles++;
    try {
      const count = await pollOnce(mcp);
      if (count > 0) {
        recoveredCount += count;
        debug(
          `poll-fallback: recovered ${count} missed message(s) (total: ${recoveredCount})`,
        );
      }
    } catch (error) {
      debug(
        `poll-fallback error: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }, POLL_INTERVAL_MS);
  timer.unref();

  // Run first poll after a short delay (let watcher settle first)
  setTimeout(async () => {
    pollCycles++;
    try {
      const count = await pollOnce(mcp);
      if (count > 0) {
        recoveredCount += count;
        debug(`poll-fallback (initial): recovered ${count} missed message(s)`);
      }
    } catch {
      // Non-critical
    }
  }, 5_000).unref();
}
