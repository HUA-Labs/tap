/**
 * tap-comms fs.watch watcher: real-time channel push notifications.
 */
import { existsSync, readFileSync, statSync, watch, type FSWatcher } from "fs";
import { join } from "path";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { classifyReviewMetaForOperator } from "../../../src/reviews/stale-meta.js";
import {
  COMMS_DIR,
  SERVER_START,
  stripBom,
  parseFilename,
  parseFrontmatter,
  stripFrontmatter,
  isForMe,
  isInboxFrontmatterForCurrentAgent,
  getAgentId,
  getAgentName,
  isOwnMessageAddressForCurrentAgent,
  getSourceKey,
  debug,
  logError,
  logInfo,
  logWarn,
  type ChannelSource,
} from "./tap-utils.js";
import { dbInsertMessage } from "./tap-db.js";
import {
  getJoinedAtMs,
  hasDurableReadReceipt,
  hasReadFileContent,
  hasReadFileAtMtime,
  hashTapFileContent,
  hasDisplayedNotification,
  isBridgeProcessed,
  markDisplayedNotification,
  readFiles,
  resolveAgentLabel,
} from "./tap-io.js";
import { buildCompactInboxDisplay } from "./tap-display.js";

// ── State ───────────────────────────────────────────────────────────────

// Values:
//   - PRE_JOIN_SKIP: permanent backlog suppression for artifacts older than joinedAt
//   - number > 0: last emitted mtime (re-emit if file.mtime > recorded)
// Bridge-processed and durable-receipt skips must be re-evaluated on each
// mtime change, so they are not cached here.
const PRE_JOIN_SKIP = -1;
const notifiedFiles = new Map<string, number>();
const notifiedFileContentHashes = new Map<string, string>();
const recentEvents = new Map<string, number>();
const inFlightFiles = new Set<string>();
const DEBOUNCE_MS = 200;
const MAX_READY_ATTEMPTS = 6;
const READY_RETRY_MS = 40;
const WATCH_RESTART_MS = 1_000;
const RECENT_EVENT_TTL_MS = 5 * 60 * 1000;
const RECENT_EVENT_CLEANUP_MS = 60 * 1000;

type RealtimeNotificationMeta = {
  from: string;
  to: string;
  subject: string;
  filename: string;
  source: ChannelSource;
};

function buildGenericRealtimePayload(
  content: string,
  meta: RealtimeNotificationMeta,
  display?: string,
) {
  const visibleContent = display ?? content;
  return {
    level: "info",
    logger: "tap-comms",
    data: {
      kind: "tap-message",
      content: visibleContent,
      ...(display ? { rawContent: content } : {}),
      meta,
      ...(display ? { display } : {}),
    },
  } as const;
}

function isTruthyEnv(value: string | undefined): boolean {
  return /^(1|true|yes|on)$/i.test(value?.trim() ?? "");
}

function isFalsyEnv(value: string | undefined): boolean {
  return /^(0|false|no|off)$/i.test(value?.trim() ?? "");
}

function shouldSendClaudeChannelNotification(): boolean {
  const override = process.env.TAP_CLAUDE_CHANNEL_PUSH;
  if (isTruthyEnv(override)) return true;
  if (isFalsyEnv(override)) return false;

  return Boolean(process.env.CLAUDE_PLUGIN_ROOT?.trim());
}

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

  if (parsed && isOwnMessageAddressForCurrentAgent(parsed.from)) {
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
  notifiedFileContentHashes.clear();
  recentEvents.clear();
  inFlightFiles.clear();
}

// @internal test helper
export async function processWatchFile(
  dir: string,
  source: ChannelSource,
  filename: string,
  mcp: Pick<Server, "notification" | "sendLoggingMessage">,
): Promise<boolean> {
  const key = getSourceKey(source, filename);
  const permanentlySkipped = notifiedFiles.get(key) === PRE_JOIN_SKIP;
  if (permanentlySkipped || inFlightFiles.has(key)) {
    debug("channel relay skipped before read", {
      source,
      filename,
      permanentlySkipped,
      inFlight: inFlightFiles.has(key),
    });
    return false;
  }

  inFlightFiles.add(key);

  try {
    const filepath = join(dir, filename);
    const file = await waitForFileReady(filepath);
    if (file === "stale") {
      debug("channel relay skipped for stale file", {
        source,
        filename,
      });
      return false;
    }
    if (!file) {
      logWarn("channel relay aborted: file not ready", {
        source,
        filename,
      });
      return false;
    }
    if (hasReadFileAtMtime(key, file.mtime)) {
      debug("channel relay skipped: file already read at same or newer mtime", {
        source,
        filename,
        mtime: file.mtime,
        lastReadMtime: readFiles.get(key) ?? null,
      });
      return false;
    }
    if (hasReadFileContent(key, file.content)) {
      debug("channel relay skipped: file content already read", {
        source,
        filename,
        mtime: file.mtime,
      });
      return false;
    }
    const joinedAtMs = getJoinedAtMs();
    if (joinedAtMs && file.mtime < joinedAtMs) {
      notifiedFiles.set(key, PRE_JOIN_SKIP);
      debug("channel relay skipped: pre-join artifact", {
        source,
        filename,
        joinedAtMs,
        mtime: file.mtime,
      });
      return false;
    }
    if (
      hasDurableReadReceipt(filename, {
        content: file.content,
        fileMtimeMs: file.mtime,
      })
    ) {
      debug("channel relay skipped: durable read receipt exists", {
        source,
        filename,
      });
      return false;
    }
    if (isBridgeProcessed(filepath, file.mtime)) {
      debug("channel relay skipped: bridge already processed file", {
        source,
        filename,
      });
      return false;
    }

    const fileContentHash = hashTapFileContent(file.content);
    const lastEmittedContentHash = notifiedFileContentHashes.get(key);
    if (lastEmittedContentHash === fileContentHash) {
      debug("channel relay skipped: file content already emitted", {
        source,
        filename,
        mtime: file.mtime,
      });
      return false;
    }
    if (hasDisplayedNotification(source, filename, file.content)) {
      debug("channel relay skipped: durable displayed notification exists", {
        source,
        filename,
        mtime: file.mtime,
      });
      notifiedFiles.set(key, file.mtime);
      notifiedFileContentHashes.set(key, fileContentHash);
      return false;
    }

    // Re-emit dedup: skip when the last emitted mtime is not strictly older
    // than the current file.mtime. If mtime advances but content is unchanged,
    // the content-hash guard above suppresses duplicate live projection.
    const lastEmittedMtime = notifiedFiles.get(key);
    if (
      lastEmittedMtime !== undefined &&
      lastEmittedMtime !== PRE_JOIN_SKIP &&
      file.mtime <= lastEmittedMtime
    ) {
      debug("channel relay skipped: mtime not advanced since last emit", {
        source,
        filename,
        mtime: file.mtime,
        lastEmittedMtime,
      });
      return false;
    }

    // M204: Frontmatter-first routing (matches tap-io getUnreadItems)
    let parsed: ReturnType<typeof parseFilename> = null;
    let inboxFrontmatter: ReturnType<typeof parseFrontmatter> = null;
    if (source === "inbox") {
      inboxFrontmatter = parseFrontmatter(file.content);
      parsed = inboxFrontmatter
        ? {
            from: inboxFrontmatter.from,
            to: inboxFrontmatter.to,
            subject: inboxFrontmatter.subject,
          }
        : parseFilename(filename);
    } else {
      parsed = parseFilename(filename);
    }

    if (
      source === "inbox" &&
      (!parsed ||
        (inboxFrontmatter
          ? !isInboxFrontmatterForCurrentAgent(inboxFrontmatter)
          : !isForMe(parsed.to)))
    ) {
      debug("channel relay skipped: inbox item not addressed to agent", {
        source,
        filename,
        parsedTo: parsed?.to ?? null,
      });
      return false;
    }
    if (isOwnMessageArtifact(source, filename, parsed)) {
      debug("channel relay skipped: self-authored artifact", {
        source,
        filename,
      });
      return false;
    }

    if (source === "inbox" && parsed) {
      const reviewMeta = classifyReviewMetaForOperator({
        root: COMMS_DIR,
        filename,
        subject: parsed.subject,
        body: inboxFrontmatter ? stripFrontmatter(file.content) : file.content,
        sourceRelativePath: `inbox/${filename}`,
      });
      if (reviewMeta.status === "collapsed-stale-meta") {
        debug("channel relay skipped: collapsed stale review-meta", {
          source,
          filename,
          prNumber: reviewMeta.prNumber,
          terminalEvidencePath: reviewMeta.terminalEvidencePath,
        });
        notifiedFiles.set(key, file.mtime);
        notifiedFileContentHashes.set(key, fileContentHash);
        return false;
      }
    }

    const rawFrom = parsed?.from || source;
    const rawTo = parsed?.to || "all";
    const from = parsed
      ? resolveAgentLabel(inboxFrontmatter?.from_name ?? parsed.from)
      : source;
    const to = parsed
      ? resolveAgentLabel(inboxFrontmatter?.to_name ?? parsed.to)
      : "all";
    const subject = parsed?.subject || filename.replace(/\.md$/, "");
    const content =
      source === "inbox" && inboxFrontmatter
        ? stripFrontmatter(file.content)
        : file.content;
    const display =
      source === "inbox"
        ? buildCompactInboxDisplay({
            agentName: to,
            sender: from,
            recipient: to,
            subject,
            filename,
            body: content,
            replyTo: rawFrom,
            fromAddress: inboxFrontmatter?.from_address,
          })
        : undefined;
    const meta: RealtimeNotificationMeta = {
      from,
      to,
      subject,
      filename,
      source,
    };

    dbInsertMessage(filename, rawFrom, rawTo, subject, source, Date.now());
    const genericPayload = buildGenericRealtimePayload(content, meta, display);
    const visibleContent = display ?? content;
    const sendClaudeChannel = shouldSendClaudeChannelNotification();
    const primaryMethod = sendClaudeChannel
      ? "notifications/claude/channel"
      : "notifications/message";

    logInfo("channel relay attempt", {
      source,
      filename,
      from,
      to,
      subject,
      method: primaryMethod,
      genericFallbackMethod: sendClaudeChannel ? "notifications/message" : null,
    });

    try {
      if (sendClaudeChannel) {
        await mcp.notification({
          method: primaryMethod,
          params: {
            content: visibleContent,
            meta,
            ...(display ? { display } : {}),
            ...(display
              ? {
                  rawContent: content,
                  debugEnvelope: { meta },
                }
              : {}),
          },
        });
      } else {
        await mcp.sendLoggingMessage(genericPayload);
      }
    } catch (error) {
      logError("channel relay failed", {
        source,
        filename,
        from,
        to,
        subject,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }

    if (sendClaudeChannel) {
      try {
        await mcp.sendLoggingMessage(genericPayload);
        logInfo("generic realtime notification sent", {
          source,
          filename,
          from,
          to,
          subject,
          method: "notifications/message",
        });
      } catch (error) {
        logWarn("generic realtime notification failed", {
          source,
          filename,
          subject,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    logInfo("channel relay sent", {
      source,
      filename,
      from,
      to,
      subject,
      primaryMethod,
      genericMethod: sendClaudeChannel ? "notifications/message" : null,
    });
    // Record the emitted mtime so that a later mtime bump (git pull + touch,
    // rsync over, edited-in-place file) is re-evaluated without duplicating
    // unchanged append-only inbox content.
    notifiedFiles.set(key, file.mtime);
    notifiedFileContentHashes.set(key, fileContentHash);
    try {
      markDisplayedNotification(source, filename, file.content);
    } catch (error) {
      logWarn("channel relay displayed marker write failed", {
        source,
        filename,
        error: error instanceof Error ? error.message : String(error),
      });
    }
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
    logWarn("fs.watch restart scheduled", {
      source,
      reason,
      dir,
    });
    restartTimer = setTimeout(() => {
      restartTimer = null;
      if (!existsSync(dir)) {
        logWarn("fs.watch restart skipped: directory missing", {
          source,
          dir,
        });
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
        debug("fs.watch event", {
          source,
          dir,
          eventType,
          filename: filename ?? null,
        });
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
        logError("fs.watch error", {
          source,
          dir,
          error: error instanceof Error ? error.message : String(error),
        });
        scheduleRestart("error");
      });

      watcher.on("close", () => {
        logWarn("fs.watch closed", {
          source,
          dir,
        });
        scheduleRestart("close");
      });

      logInfo("fs.watch active", {
        source,
        dir,
      });
    } catch (error) {
      logError("fs.watch start failed", {
        source,
        dir,
        error: error instanceof Error ? error.message : String(error),
      });
      scheduleRestart("start-failed");
    }
  };

  startWatcher();
}
