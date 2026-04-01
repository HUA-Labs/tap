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
import { createHash } from "crypto";
import { join } from "path";
import {
  RECEIPTS_DIR,
  RECEIPTS_PATH,
  HEARTBEATS_PATH,
  stripBom,
  parseFilename,
  parseFrontmatter,
  stripFrontmatter,
  isForMe,
  getAgentId,
  getAgentName,
  getSourceDir,
  getSourceKey,
  normalizeSources,
  type ChannelSource,
  type TapUnreadItem,
  type ReceiptStore,
  type HeartbeatStore,
} from "./tap-utils.js";
import { isOwnMessageAddress } from "./tap-identity.js";

// ── State ───────────────────────────────────────────────────────────────

export const startupFiles = new Set<string>();
export const readFiles = new Set<string>();

// ── Bridge Dedup ───────────────────────────────────────────────────────
// Bridge writes processed markers at {bridgeStateDir}/processed/{sha1}.done.
// bridgeStateDir = {repoRoot}/.tmp/codex-app-server-bridge-{name}/
// Scan all bridge state dirs to find markers.

const REPO_ROOT = process.env.TAP_REPO_ROOT ?? null;

const BRIDGE_DIR_CACHE_TTL_MS = 30_000; // re-scan every 30s to pick up late-start bridges
let _bridgeProcessedDirs: string[] = [];
let _bridgeDirsCachedAt = 0;

function getBridgeProcessedDirs(): string[] {
  const now = Date.now();
  if (now - _bridgeDirsCachedAt < BRIDGE_DIR_CACHE_TTL_MS) {
    return _bridgeProcessedDirs;
  }
  _bridgeDirsCachedAt = now;

  if (!REPO_ROOT) {
    _bridgeProcessedDirs = [];
    return _bridgeProcessedDirs;
  }
  const tmpDir = join(REPO_ROOT, ".tmp");
  if (!existsSync(tmpDir)) {
    _bridgeProcessedDirs = [];
    return _bridgeProcessedDirs;
  }
  try {
    _bridgeProcessedDirs = readdirSync(tmpDir)
      .filter((d) => d.startsWith("codex-app-server-bridge"))
      .map((d) => join(tmpDir, d, "processed"))
      .filter((p) => existsSync(p));
  } catch {
    _bridgeProcessedDirs = [];
  }
  return _bridgeProcessedDirs;
}

function isBridgeProcessed(filePath: string, mtimeMs: number): boolean {
  const dirs = getBridgeProcessedDirs();
  if (dirs.length === 0) return false;
  const markerId = createHash("sha1")
    .update(`${filePath}|${mtimeMs}`)
    .digest("hex");
  const markerFile = `${markerId}.done`;
  return dirs.some((dir) => existsSync(join(dir, markerFile)));
}

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

export function formatAgentLabel(
  agentIdOrName: string,
  displayName?: string | null,
): string {
  const normalizedId = agentIdOrName.trim();
  const normalizedName = displayName?.trim();

  if (!normalizedId) {
    return normalizedName ?? agentIdOrName;
  }

  if (!normalizedName || normalizedName === normalizedId) {
    return normalizedId;
  }

  return `${normalizedName} [${normalizedId}]`;
}

export function resolveAgentLabel(
  agentIdOrName: string,
  store: HeartbeatStore = loadHeartbeats(),
): string {
  const normalized = agentIdOrName.trim();
  if (!normalized || normalized === "전체" || normalized === "all") {
    return agentIdOrName;
  }

  const byId = store[normalized];
  if (byId?.agent?.trim()) {
    return formatAgentLabel(normalized, byId.agent);
  }

  for (const [agentId, heartbeat] of Object.entries(store)) {
    if (heartbeat.agent?.trim() === normalized) {
      return formatAgentLabel(agentId, heartbeat.agent);
    }
  }

  return normalized;
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
  // Look up by id first, fallback to name for backward compat
  const agentId = getAgentId();
  const agentName = getAgentName();
  let heartbeatStore: HeartbeatStore = {};
  let joinedAtMs = 0;
  if (agentId !== "unknown") {
    try {
      heartbeatStore = loadHeartbeats();
      const entry = heartbeatStore[agentId] ?? heartbeatStore[agentName];
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

      // Skip messages already delivered via bridge (dedup)
      if (isBridgeProcessed(fullPath, mtime)) {
        readFiles.add(key);
        continue;
      }

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
        // Frontmatter-first routing (M202): try frontmatter, fall back to filename
        const fm = parseFrontmatter(content);
        const parsed = fm
          ? { from: fm.from, to: fm.to, subject: fm.subject }
          : parseFilename(filename);
        if (!parsed || !isForMe(parsed.to)) continue;
        if (isOwnMessageAddress(parsed.from, getAgentId(), getAgentName()))
          continue;
        from = resolveAgentLabel(fm?.from_name ?? parsed.from, heartbeatStore);
        to = resolveAgentLabel(fm?.to_name ?? parsed.to, heartbeatStore);
        subject = parsed.subject;
        // Strip frontmatter from displayed content
        if (fm && includeContent) {
          content = stripFrontmatter(content);
        }
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
