/**
 * tap-comms fs.watch watcher: real-time channel push notifications.
 */
import { existsSync, readFileSync, statSync, watch, type FSWatcher } from "fs";
import { join } from "path";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  SERVER_START,
  stripBom,
  parseFilename,
  parseFrontmatter,
  isForMe,
  getAgentId,
  getAgentName,
  getSourceKey,
  debug,
  type ChannelSource,
} from "./tap-utils.js";
import { dbInsertMessage } from "./tap-db.js";
import { readFiles, resolveAgentLabel } from "./tap-io.js";
import { isOwnMessageAddress } from "./tap-identity.js";

// ── State ───────────────────────────────────────────────────────────────

const notifiedFiles = new Set<string>();
const recentEvents = new Map<string, number>();
const inFlightFiles = new Set<string>();
const DEBOUNCE_MS = 200;
const MAX_READY_ATTEMPTS = 6;
const READY_RETRY_MS = 40;
const WATCH_RESTART_MS = 1_000;
const RECENT_EVENT_TTL_MS = 5 * 60 * 1000;
const RECENT_EVENT_CLEANUP_MS = 60 * 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableFsError(error: unknown): boolean {
  const code =
    error && typeof error === "object" && "code" in error
      ? String((error as NodeJS.ErrnoException).code ?? "")
      : "";
  return (
    code === "ENOENT" ||
    code === "EBUSY" ||
    code === "EPERM" ||
    code === "EACCES"
  );
}

async function waitForFileReady(
  filepath: string,
): Promise<{ content: string; mtime: number } | "stale" | null> {
  for (let attempt = 0; attempt < MAX_READY_ATTEMPTS; attempt++) {
    try {
      const mtime = statSync(filepath).mtimeMs;
      if (mtime < SERVER_START - 5000) return "stale";
      const content = stripBom(readFileSync(filepath, "utf-8"));
      return { content, mtime };
    } catch (error) {
      if (attempt === MAX_READY_ATTEMPTS - 1 || !isRetryableFsError(error)) {
        debug(
          `watch read failed [${filepath}]: ${error instanceof Error ? error.message : String(error)}`,
        );
        return null;
      }
      await sleep(READY_RETRY_MS * (attempt + 1));
    }
  }

  return null;
}

function isOwnMessageArtifact(
  source: ChannelSource,
  filename: string,
  parsed: ReturnType<typeof parseFilename>,
): boolean {
  const agentId = getAgentId();
  const agentName = getAgentName();

  if (parsed && isOwnMessageAddress(parsed.from, agentId, agentName)) {
    return true;
  }

  if (source === "reviews") {
    return (
      filename.endsWith(`-${agentId}.md`) ||
      filename.endsWith(`-${agentName}.md`)
    );
  }

  return false;
}

function cleanupRecentEvents(now: number = Date.now()) {
  const cutoff = now - RECENT_EVENT_TTL_MS;
  for (const [key, ts] of recentEvents) {
    if (ts < cutoff) recentEvents.delete(key);
  }
}

const recentEventsCleanupTimer = setInterval(() => {
  cleanupRecentEvents();
}, RECENT_EVENT_CLEANUP_MS);
recentEventsCleanupTimer.unref?.();

// @internal test helper
export function resetWatcherStateForTests() {
  notifiedFiles.clear();
  recentEvents.clear();
  inFlightFiles.clear();
}

// @internal test helper
export async function processWatchFile(
  dir: string,
  source: ChannelSource,
  filename: string,
  mcp: Pick<Server, "notification">,
): Promise<boolean> {
  const key = getSourceKey(source, filename);
  // Skip if already notified (watcher), in-flight, or read via tap_list_unread
  if (notifiedFiles.has(key) || inFlightFiles.has(key) || readFiles.has(key))
    return false;

  inFlightFiles.add(key);

  try {
    const filepath = join(dir, filename);
    const file = await waitForFileReady(filepath);
    if (file === "stale") {
      notifiedFiles.add(key);
      return false;
    }
    if (!file) return false;

    // M204: Frontmatter-first routing (matches tap-io getUnreadItems)
    let parsed: ReturnType<typeof parseFilename> = null;
    if (source === "inbox") {
      const fm = parseFrontmatter(file.content);
      parsed = fm
        ? { from: fm.from, to: fm.to, subject: fm.subject }
        : parseFilename(filename);
    } else {
      parsed = parseFilename(filename);
    }

    if (source === "inbox" && (!parsed || !isForMe(parsed.to))) return false;
    if (isOwnMessageArtifact(source, filename, parsed)) return false;

    const rawFrom = parsed?.from || source;
    const rawTo = parsed?.to || "all";
    const from = parsed ? resolveAgentLabel(parsed.from) : source;
    const to = parsed ? resolveAgentLabel(parsed.to) : "all";
    const subject = parsed?.subject || filename.replace(/\.md$/, "");

    dbInsertMessage(filename, rawFrom, rawTo, subject, source, Date.now());
    debug(`sending notification [${source}]: from=${from} to=${to}`);
    await mcp.notification({
      method: "notifications/claude/channel",
      params: {
        content: file.content,
        meta: { from, to, subject, filename, source },
      },
    });
    notifiedFiles.add(key);
    return true;
  } finally {
    inFlightFiles.delete(key);
  }
}

// ── Watch ───────────────────────────────────────────────────────────────

export function watchDir(dir: string, source: ChannelSource, mcp: Server) {
  if (!existsSync(dir)) return;

  let watcher: FSWatcher | null = null;
  let restartTimer: NodeJS.Timeout | null = null;

  const scheduleRestart = (reason: string) => {
    if (restartTimer) return;
    debug(`fs.watch restart scheduled [${source}]: ${reason}`);
    restartTimer = setTimeout(() => {
      restartTimer = null;
      if (!existsSync(dir)) {
        debug(`fs.watch restart skipped [${source}]: missing ${dir}`);
        return;
      }
      startWatcher();
    }, WATCH_RESTART_MS);
    restartTimer.unref();
  };

  const disposeWatcher = () => {
    if (!watcher) return;
    watcher.removeAllListeners();
    try {
      watcher.close();
    } catch {
      // Best-effort cleanup only.
    }
    watcher = null;
  };

  const startWatcher = () => {
    disposeWatcher();

    try {
      watcher = watch(dir, (eventType, filename) => {
        debug(`fs.watch [${source}]: ${eventType} ${filename}`);
        if (!filename || !filename.endsWith(".md")) return;

        const key = getSourceKey(source, filename);
        const now = Date.now();
        cleanupRecentEvents(now);
        const lastSeen = recentEvents.get(key);
        if (lastSeen && now - lastSeen < DEBOUNCE_MS) return;
        recentEvents.set(key, now);

        void processWatchFile(dir, source, filename, mcp).catch((error) => {
          debug(
            `watch processing failed [${source}/${filename}]: ${error instanceof Error ? error.message : String(error)}`,
          );
        });
      });

      watcher.on("error", (error) => {
        debug(
          `fs.watch error [${source}]: ${error instanceof Error ? error.message : String(error)}`,
        );
        scheduleRestart("error");
      });

      watcher.on("close", () => {
        debug(`fs.watch closed [${source}]`);
        scheduleRestart("close");
      });

      debug(`fs.watch active [${source}]: ${dir}`);
    } catch (error) {
      debug(
        `fs.watch start failed [${source}]: ${error instanceof Error ? error.message : String(error)}`,
      );
      scheduleRestart("start-failed");
    }
  };

  startWatcher();
}
