/**
 * tap-comms fs.watch watcher: real-time channel push notifications.
 */
import { existsSync, readFileSync, statSync, watch } from "fs";
import { join } from "path";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  SERVER_START,
  stripBom,
  parseInboxEnvelope,
  isForMe,
  isOwnSender,
  getSourceKey,
  debug,
  type ChannelSource,
} from "./tap-utils.js";
import { dbInsertMessage } from "./tap-db.js";

// ── State ───────────────────────────────────────────────────────────────

const notifiedFiles = new Set<string>();

// ── Watch ───────────────────────────────────────────────────────────────

export function watchDir(dir: string, source: ChannelSource, mcp: Server) {
  if (!existsSync(dir)) return;

  watch(dir, async (eventType, filename) => {
    debug(`fs.watch [${source}]: ${eventType} ${filename}`);
    if (!filename || !filename.endsWith(".md")) return;

    const key = getSourceKey(source, filename);
    if (notifiedFiles.has(key)) return;
    notifiedFiles.add(key);

    const filepath = join(dir, filename);
    try {
      const mtime = statSync(filepath).mtimeMs;
      if (mtime < SERVER_START - 5000) return; // skip stale files
    } catch {
      return;
    }

    let content: string;
    try {
      content = stripBom(readFileSync(filepath, "utf-8"));
    } catch {
      return;
    }

    const parsed = parseInboxEnvelope(filename, content);

    if (source === "inbox") {
      if (!parsed || !isForMe(parsed.to)) return;
      if (isOwnSender(parsed.from)) return; // skip echo-back
    }

    const from = parsed?.from || source;
    const to = parsed?.to || "all";
    const subject = parsed?.subject || filename.replace(/\.md$/, "");

    dbInsertMessage(filename, from, to, subject, source, Date.now());
    debug(`sending notification [${source}]: from=${from} to=${to}`);
    await mcp.notification({
      method: "notifications/claude/channel",
      params: {
        content,
        meta: { from, to, subject, filename, source },
      },
    });
  });
}
