/**
 * tap-comms file I/O: locks, receipts, heartbeats, unread scanning.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import { join } from "path";
import {
  RECEIPTS_DIR,
  RECEIPTS_PATH,
  RECEIPTS_LOCK,
  HEARTBEATS_PATH,
  INBOX_DIR,
  stripBom,
  parseFilename,
  isForMe,
  getAgentName,
  getSourceDir,
  getSourceKey,
  normalizeSources,
  debug,
  type ChannelSource,
  type TapUnreadItem,
  type Receipt,
  type ReceiptStore,
  type Heartbeat,
  type HeartbeatStore,
} from "./tap-utils.js";

// ── State ───────────────────────────────────────────────────────────────

export const startupFiles = new Set<string>();
export const readFiles = new Set<string>();

// ── Lock ────────────────────────────────────────────────────────────────

export function acquireLock(
  lockPath: string,
  retries = 3,
  delayMs = 100,
): boolean {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      writeFileSync(lockPath, String(process.pid), { flag: "wx" });
      return true;
    } catch {
      try {
        const age = Date.now() - statSync(lockPath).mtimeMs;
        if (age > 10_000) {
          unlinkSync(lockPath);
          continue;
        }
      } catch {}
      if (attempt < retries - 1) {
        const start = Date.now();
        while (Date.now() - start < delayMs) {}
      }
    }
  }
  return false;
}

export function releaseLock(lockPath: string) {
  try {
    unlinkSync(lockPath);
  } catch {}
}

// ── Receipts ────────────────────────────────────────────────────────────

export function ensureReceiptsDir() {
  if (!existsSync(RECEIPTS_DIR)) mkdirSync(RECEIPTS_DIR, { recursive: true });
}

export function loadReceipts(): ReceiptStore {
  try {
    return JSON.parse(readFileSync(RECEIPTS_PATH, "utf-8"));
  } catch {
    return {};
  }
}

export function saveReceipts(store: ReceiptStore) {
  ensureReceiptsDir();
  const tmpPath = RECEIPTS_PATH + ".tmp";
  writeFileSync(tmpPath, JSON.stringify(store, null, 2), "utf-8");
  renameSync(tmpPath, RECEIPTS_PATH);
}

// ── Heartbeats ──────────────────────────────────────────────────────────

export function loadHeartbeats(): HeartbeatStore {
  try {
    return JSON.parse(readFileSync(HEARTBEATS_PATH, "utf-8"));
  } catch {
    return {};
  }
}

export function saveHeartbeats(store: HeartbeatStore) {
  const tmpPath = HEARTBEATS_PATH + ".tmp";
  writeFileSync(tmpPath, JSON.stringify(store, null, 2), "utf-8");
  renameSync(tmpPath, HEARTBEATS_PATH);
}

// ── Startup ─────────────────────────────────────────────────────────────

export function seedStartupFiles(source: ChannelSource) {
  const dir = getSourceDir(source);
  if (!dir || !existsSync(dir)) return;

  for (const filename of readdirSync(dir)) {
    startupFiles.add(getSourceKey(source, filename));
  }
}

// ── Unread Items ────────────────────────────────────────────────────────

export function getUnreadItems(options?: {
  sources?: unknown;
  limit?: unknown;
  includeContent?: unknown;
  markRead?: unknown;
  since?: unknown;
}): TapUnreadItem[] {
  const sources = normalizeSources(options?.sources);
  const includeContent = options?.includeContent !== false;
  const markRead = options?.markRead !== false;
  const sinceMs =
    typeof options?.since === "string" ? new Date(options.since).getTime() : 0;

  // Apply joinedAt filter: don't show messages from before agent joined
  const agentName = getAgentName();
  let joinedAtMs = 0;
  if (agentName !== "unknown") {
    try {
      const store = loadHeartbeats();
      const entry = store[agentName];
      if (entry?.joinedAt) {
        joinedAtMs = new Date(entry.joinedAt).getTime();
      }
    } catch {
      // Non-critical: if we can't read, show all
    }
  }
  // Use the later of since and joinedAt
  const effectiveSinceMs = Math.max(sinceMs, joinedAtMs);

  const parsedLimit =
    typeof options?.limit === "number"
      ? options.limit
      : Number.parseInt(String(options?.limit ?? "20"), 10);
  const limit = Number.isFinite(parsedLimit)
    ? Math.max(1, Math.min(100, parsedLimit))
    : 20;

  const items: TapUnreadItem[] = [];

  for (const source of sources) {
    const dir = getSourceDir(source);
    if (!dir || !existsSync(dir)) continue;

    const filenames = readdirSync(dir)
      .filter((filename) => filename.endsWith(".md"))
      .sort();

    for (const filename of filenames) {
      const key = getSourceKey(source, filename);
      if (startupFiles.has(key) || readFiles.has(key)) continue;

      const fullPath = join(dir, filename);
      let mtime: number;
      try {
        mtime = statSync(fullPath).mtimeMs;
      } catch {
        continue;
      }
      if (effectiveSinceMs && mtime < effectiveSinceMs) continue;

      let content: string;
      try {
        content = stripBom(readFileSync(fullPath, "utf-8"));
      } catch {
        continue;
      }

      let from: string = source;
      let to = "all";
      let subject = filename.replace(/\.md$/, "");

      if (source === "inbox") {
        const parsed = parseFilename(filename);
        if (!parsed || !isForMe(parsed.to)) continue;
        if (parsed.from === getAgentName()) continue;
        from = parsed.from;
        to = parsed.to;
        subject = parsed.subject;
      }

      const item: TapUnreadItem = {
        source,
        filename,
        path: `${source}/${filename}`,
        from,
        to,
        subject,
        mtime: new Date(mtime).toISOString(),
      };

      if (includeContent) {
        item.content = content;
      }

      items.push(item);
      if (markRead) {
        readFiles.add(key);
      }

      if (items.length >= limit) {
        return items;
      }
    }
  }

  return items;
}
