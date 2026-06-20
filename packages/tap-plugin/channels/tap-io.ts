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
import { classifyReviewMetaForOperator } from "../../../src/reviews/stale-meta.js";
import {
  RECEIPTS_DIR,
  RECEIPTS_PATH,
  HEARTBEATS_PATH,
  COMMS_DIR,
  PRESENCE_DIR,
  deriveRoutingSlotFromInstanceId,
  stripBom,
  parseFilename,
  parseFrontmatter,
  stripFrontmatter,
  isForMe,
  isInboxFrontmatterForCurrentAgent,
  getAgentId,
  getAgentName,
  getAgentRoutingAddress,
  getSourceDir,
  getSourceKey,
  normalizeSources,
  isOwnMessageAddressForCurrentAgent,
  type ChannelSource,
  type TapUnreadItem,
  type ReceiptStore,
  type HeartbeatStore,
} from "./tap-utils.js";
import { canonicalizeAgentId, sameRoutingAddress } from "./tap-identity.js";
import { buildCompactInboxDisplay } from "./tap-display.js";

// ── State ───────────────────────────────────────────────────────────────

export const startupFiles = new Set<string>();
export const readFiles = new Map<string, number>();
export const readFileContentHashes = new Map<string, string>();

type DisplayedNotificationStore = Record<string, DisplayedNotificationRecord>;

type DisplayedNotificationRecord = {
  displayedAt: string;
  source: ChannelSource;
  filename: string;
  contentHash: string;
  receiver: {
    routingAddress: string;
    agentId: string;
    agentName: string;
  };
};

type DisplayedNotificationReceiver = {
  key: string;
  routingAddress: string;
  agentId: string;
  agentName: string;
};

type DisplayedNotificationIdentity = {
  key: string;
  source: ChannelSource;
  filename: string;
  contentHash: string;
  receiver: DisplayedNotificationReceiver;
};

const DISPLAYED_NOTIFICATIONS_DIR = join(COMMS_DIR, "displayed-notifications");
const DISPLAYED_NOTIFICATIONS_PATH = join(
  DISPLAYED_NOTIFICATIONS_DIR,
  "displayed.json",
);
const DISPLAYED_NOTIFICATION_MARKERS_DIR = join(
  DISPLAYED_NOTIFICATIONS_DIR,
  "markers",
);

export function hashTapFileContent(content: string): string {
  return createHash("sha256").update(stripBom(content)).digest("hex");
}

export function hasReadFileAtMtime(key: string, mtimeMs: number): boolean {
  const lastReadMtime = readFiles.get(key);
  return lastReadMtime !== undefined && lastReadMtime >= mtimeMs;
}

export function hasReadFileContent(key: string, content: string): boolean {
  return readFileContentHashes.get(key) === hashTapFileContent(content);
}

export function markFileRead(
  key: string,
  mtimeMs: number,
  content?: string,
): void {
  readFiles.set(key, mtimeMs);
  if (content !== undefined) {
    readFileContentHashes.set(key, hashTapFileContent(content));
  }
}

function displayedNotificationKey(
  source: ChannelSource,
  filename: string,
  content: string,
  receiver = getDisplayedNotificationReceiver(),
): string {
  return `${receiver.key}#${getSourceKey(source, filename)}#sha256:${hashTapFileContent(content)}`;
}

function getDisplayedNotificationReceiver(): DisplayedNotificationReceiver {
  const routingAddress = getAgentRoutingAddress();
  const agentId = getAgentId();
  const agentName = getAgentName();
  const keyParts = [routingAddress, agentId, agentName]
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => canonicalizeAgentId(part) || part);
  return {
    key: `receiver:${keyParts.join("|") || "unknown"}`,
    routingAddress,
    agentId,
    agentName,
  };
}

function buildDisplayedNotificationIdentity(
  source: ChannelSource,
  filename: string,
  content: string,
): DisplayedNotificationIdentity {
  const receiver = getDisplayedNotificationReceiver();
  const contentHash = hashTapFileContent(content);
  return {
    key: displayedNotificationKey(source, filename, content, receiver),
    source,
    filename,
    contentHash,
    receiver,
  };
}

function displayedNotificationMarkerPath(key: string): string {
  const markerId = createHash("sha256").update(key).digest("hex");
  return join(DISPLAYED_NOTIFICATION_MARKERS_DIR, `${markerId}.json`);
}

function loadDisplayedNotifications(): DisplayedNotificationStore {
  return resilientReadJson<DisplayedNotificationStore>(
    DISPLAYED_NOTIFICATIONS_PATH,
    {},
  );
}

export function hasDisplayedNotification(
  source: ChannelSource,
  filename: string,
  content: string,
): boolean {
  const identity = buildDisplayedNotificationIdentity(
    source,
    filename,
    content,
  );
  return (
    existsSync(displayedNotificationMarkerPath(identity.key)) ||
    Boolean(loadDisplayedNotifications()[identity.key])
  );
}

export function markDisplayedNotification(
  source: ChannelSource,
  filename: string,
  content: string,
): void {
  const identity = buildDisplayedNotificationIdentity(
    source,
    filename,
    content,
  );
  const markerPath = displayedNotificationMarkerPath(identity.key);
  const marker: DisplayedNotificationRecord = {
    displayedAt: new Date().toISOString(),
    source: identity.source,
    filename: identity.filename,
    contentHash: identity.contentHash,
    receiver: {
      routingAddress: identity.receiver.routingAddress,
      agentId: identity.receiver.agentId,
      agentName: identity.receiver.agentName,
    },
  };
  mkdirSync(DISPLAYED_NOTIFICATION_MARKERS_DIR, { recursive: true });
  const tmpPath = `${markerPath}.tmp.${process.pid}`;
  writeFileSync(tmpPath, JSON.stringify(marker, null, 2), "utf-8");
  resilientRename(tmpPath, markerPath);
}

// ── Bridge Dedup ───────────────────────────────────────────────────────
// Bridge writes processed markers at {bridgeStateDir}/processed/{sha1}.done.
// bridgeStateDir = {repoRoot}/.tmp/codex-app-server-bridge-{name}/
// Scan all bridge state dirs to find markers.

const REPO_ROOT = process.env.TAP_REPO_ROOT ?? null;

const BRIDGE_DIR_CACHE_TTL_MS = 30_000; // re-scan every 30s to pick up late-start bridges
let _bridgeProcessedDirs: string[] = [];
let _bridgeDirsCachedAt = 0;
let _bridgeTmpDirMtimeMs = 0;

function getBridgeProcessedDirs(): string[] {
  if (!REPO_ROOT) {
    _bridgeProcessedDirs = [];
    _bridgeTmpDirMtimeMs = 0;
    return _bridgeProcessedDirs;
  }

  const tmpDir = join(REPO_ROOT, ".tmp");
  if (!existsSync(tmpDir)) {
    _bridgeProcessedDirs = [];
    _bridgeTmpDirMtimeMs = 0;
    return _bridgeProcessedDirs;
  }

  const now = Date.now();
  // eslint-disable-next-line no-useless-assignment -- used on L80 after try/catch
  let tmpDirMtimeMs = 0;
  try {
    tmpDirMtimeMs = statSync(tmpDir).mtimeMs;
  } catch {
    _bridgeProcessedDirs = [];
    _bridgeTmpDirMtimeMs = 0;
    return _bridgeProcessedDirs;
  }

  if (
    now - _bridgeDirsCachedAt < BRIDGE_DIR_CACHE_TTL_MS &&
    tmpDirMtimeMs === _bridgeTmpDirMtimeMs
  ) {
    return _bridgeProcessedDirs;
  }
  _bridgeDirsCachedAt = now;
  _bridgeTmpDirMtimeMs = tmpDirMtimeMs;

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

export function isBridgeProcessed(filePath: string, mtimeMs: number): boolean {
  const dirs = getBridgeProcessedDirs();
  if (dirs.length === 0) return false;
  const markerId = createHash("sha1")
    .update(`${filePath}|${mtimeMs}`)
    .digest("hex");
  const markerFile = `${markerId}.done`;
  return dirs.some((dir) => existsSync(join(dir, markerFile)));
}

// ── M187: EBUSY-resilient I/O helpers ──────────────────────────────────
// Windows holds file handles strictly — renameSync/readFileSync can fail
// with EBUSY when another process has the file open. Retry with backoff.

const EBUSY_MAX_RETRIES = 4;
const EBUSY_BASE_DELAY_MS = 25;

function isEbusyError(error: unknown): boolean {
  if (!error || typeof error !== "object" || !("code" in error)) return false;
  const code = (error as NodeJS.ErrnoException).code;
  return code === "EBUSY" || code === "EPERM" || code === "EACCES";
}

function busySpin(ms: number): void {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    // busy-wait (no async available in these sync call sites)
  }
}

function resilientRename(tmpPath: string, targetPath: string): void {
  for (let attempt = 0; attempt < EBUSY_MAX_RETRIES; attempt++) {
    try {
      renameSync(tmpPath, targetPath);
      return;
    } catch (error) {
      if (!isEbusyError(error) || attempt === EBUSY_MAX_RETRIES - 1)
        throw error;
      busySpin(EBUSY_BASE_DELAY_MS * (attempt + 1));
    }
  }
}

function resilientReadJson<T>(filePath: string, fallback: T): T {
  for (let attempt = 0; attempt < EBUSY_MAX_RETRIES; attempt++) {
    try {
      return JSON.parse(readFileSync(filePath, "utf-8")) as T;
    } catch (error) {
      if (!isEbusyError(error) || attempt === EBUSY_MAX_RETRIES - 1) {
        return fallback;
      }
      busySpin(EBUSY_BASE_DELAY_MS * (attempt + 1));
    }
  }
  return fallback;
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
  return resilientReadJson<ReceiptStore>(RECEIPTS_PATH, {});
}

export function saveReceipts(store: ReceiptStore) {
  ensureReceiptsDir();
  const tmpPath = `${RECEIPTS_PATH}.tmp.${process.pid}`;
  writeFileSync(tmpPath, JSON.stringify(store, null, 2), "utf-8");
  resilientRename(tmpPath, RECEIPTS_PATH);
}

function matchesReceiptReader(
  reader: string,
  agentId: string,
  agentName: string,
): boolean {
  const normalizedReader = reader.trim();
  if (!normalizedReader) return false;

  return (
    normalizedReader === agentId ||
    sameRoutingAddress(normalizedReader, agentId) ||
    normalizedReader === agentName ||
    sameRoutingAddress(normalizedReader, agentName)
  );
}

export function getDurableReceiptKeys(
  filename: string,
  content: string,
): string[] {
  const normalizedContent = stripBom(content);
  const frontmatter = parseFrontmatter(normalizedContent);
  const keys: string[] = [];

  if (frontmatter?.message_id?.trim()) {
    keys.push(`${filename}#mid:${frontmatter.message_id.trim()}`);
  }

  keys.push(`${filename}#sha256:${hashTapFileContent(normalizedContent)}`);
  return keys;
}

function getLatestReceiptTimestampMs(receipts: ReceiptStore[string]): number {
  let latest = 0;
  for (const receipt of receipts ?? []) {
    const timestampMs = new Date(receipt.timestamp).getTime();
    if (Number.isFinite(timestampMs) && timestampMs > latest) {
      latest = timestampMs;
    }
  }
  return latest;
}

export function hasDurableReadReceipt(
  filename: string,
  options?: {
    receiptStore?: ReceiptStore;
    agentId?: string;
    agentName?: string;
    content?: string;
    fileMtimeMs?: number;
  },
): boolean {
  const agentId = options?.agentId ?? getAgentId();
  const agentName = options?.agentName ?? getAgentName();
  const receiptStore = options?.receiptStore ?? loadReceipts();
  const content = options?.content;
  const durableKeys =
    typeof content === "string" ? getDurableReceiptKeys(filename, content) : [];

  for (const key of durableKeys) {
    const receipts = receiptStore[key];
    if (!receipts?.length) continue;
    if (
      receipts.some((receipt) =>
        matchesReceiptReader(receipt.reader, agentId, agentName),
      )
    ) {
      return true;
    }
  }

  const legacyReceipts = receiptStore[filename];
  if (!legacyReceipts?.length) return false;

  const fileMtimeMs = options?.fileMtimeMs ?? 0;
  const latestReceiptTs = getLatestReceiptTimestampMs(legacyReceipts);
  if (fileMtimeMs && latestReceiptTs && fileMtimeMs > latestReceiptTs) {
    return false;
  }

  return legacyReceipts.some((receipt) =>
    matchesReceiptReader(receipt.reader, agentId, agentName),
  );
}

// ── Heartbeats ──────────────────────────────────────────────────────────
//
// heartbeats.json = SSOT for agent presence (M321).
// Written by: tap_heartbeat (MCP), tap_set_name, bridge-dispatch.
// Read by: tap_who, identity resolution, bridge-heartbeat pruning.
//
// M334: Per-agent presence files in presence/ dir enable cross-device
// visibility. loadHeartbeats() merges both sources.
//
// Note: tap-comms/bridge-heartbeat.ts has its own load/save for the same
// file because it cannot import from tap-plugin. Keep formats in sync.

/** M334: Max age for presence files before they are considered stale (24h). */
const PRESENCE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function entryTimestampMs(entry: HeartbeatStore[string]): number {
  return entry?.timestamp ? new Date(entry.timestamp).getTime() : 0;
}

/**
 * M352: canonical, latest-wins merge into a heartbeat slot. Used for both
 * the legacy `heartbeats.json` pass and the presence-file pass so that
 * case/dash drift across devices collapses onto a single slot regardless of
 * which source saw the entry first.
 */
function mergeHeartbeatSlot(
  store: HeartbeatStore,
  canonicalKey: string,
  entry: HeartbeatStore[string],
): void {
  if (!canonicalKey) return;
  const existing = store[canonicalKey];
  if (!existing) {
    store[canonicalKey] = entry;
    return;
  }
  if (entryTimestampMs(entry) > entryTimestampMs(existing)) {
    store[canonicalKey] = entry;
  }
}

export function loadHeartbeats(): HeartbeatStore {
  const raw = resilientReadJson<HeartbeatStore>(HEARTBEATS_PATH, {});

  // M352: canonicalize the legacy `heartbeats.json` pass as well. Prior
  // versions wrote keys with whatever case/dash form the session had at
  // the time; without collapsing them here the presence merge below would
  // still leave two parallel slots for the same logical agent.
  const local: HeartbeatStore = {};
  for (const [rawKey, entry] of Object.entries(raw)) {
    if (!entry || (!entry.id && !entry.agent)) continue;
    const key = canonicalizeAgentId(rawKey);
    mergeHeartbeatSlot(local, key, entry);
  }

  // M334: Merge per-agent presence files for cross-device visibility.
  // M352: canonicalize the merge key so presence files written with
  // different case/dash conventions on different devices collapse onto
  // the same heartbeat slot instead of creating parallel phantom entries.
  try {
    if (existsSync(PRESENCE_DIR)) {
      const now = Date.now();
      for (const file of readdirSync(PRESENCE_DIR)) {
        if (!file.endsWith(".json")) continue;
        try {
          const filePath = join(PRESENCE_DIR, file);
          const rawFile = readFileSync(filePath, "utf-8");
          const entry = JSON.parse(rawFile) as HeartbeatStore[string];
          if (!entry?.id && !entry?.agent) continue;

          // Skip stale presence files (> 24h)
          const ts = entry.timestamp ? new Date(entry.timestamp).getTime() : 0;
          if (now - ts > PRESENCE_MAX_AGE_MS) continue;

          const rawKey = entry.id ?? file.replace(/\.json$/, "");
          const key = canonicalizeAgentId(rawKey);
          mergeHeartbeatSlot(local, key, entry);
        } catch {
          // Skip corrupt presence files
        }
      }
    }
  } catch {
    // presence dir unreadable — fall back to local only
  }

  return local;
}

export function saveHeartbeats(store: HeartbeatStore) {
  const tmpPath = `${HEARTBEATS_PATH}.tmp.${process.pid}`;
  writeFileSync(tmpPath, JSON.stringify(store, null, 2), "utf-8");
  resilientRename(tmpPath, HEARTBEATS_PATH);
}

export function getJoinedAtMs(options?: {
  heartbeatStore?: HeartbeatStore;
  agentId?: string;
  agentName?: string;
}): number {
  const agentId = options?.agentId ?? getAgentId();
  const agentName = options?.agentName ?? getAgentName();
  const heartbeatStore = options?.heartbeatStore ?? loadHeartbeats();

  if (agentId === "unknown") return 0;

  // M352: canonical lookup so stored-dash vs queried-underscore (and case
  // variants) resolve to the same entry.
  const canonicalAgentId = canonicalizeAgentId(agentId);
  const canonicalAgentName = canonicalizeAgentId(agentName);
  const entry =
    heartbeatStore[canonicalAgentId] ??
    heartbeatStore[agentId] ??
    heartbeatStore[canonicalAgentName] ??
    heartbeatStore[agentName];
  if (!entry?.joinedAt) return 0;

  const joinedAtMs = new Date(entry.joinedAt).getTime();
  return Number.isFinite(joinedAtMs) ? joinedAtMs : 0;
}

/**
 * M334: Write a per-agent presence file for cross-device heartbeat visibility.
 * Each agent gets its own file in presence/{agentId}.json, which is
 * git-syncable without merge conflicts.
 */
export function writePresenceFile(
  agentId: string,
  entry: HeartbeatStore[string],
) {
  try {
    mkdirSync(PRESENCE_DIR, { recursive: true });
    // M352: canonicalize the filename so two devices writing the same
    // logical agent with different case/dash forms share one presence
    // file instead of producing mirror entries.
    const canonicalId = canonicalizeAgentId(agentId);
    const filename = canonicalId || agentId.replace(/[/\\:]/g, "_");
    const sanitizedId = filename.replace(/[/\\:]/g, "_");
    const filePath = join(PRESENCE_DIR, `${sanitizedId}.json`);
    const tmpPath = `${filePath}.tmp.${process.pid}`;
    writeFileSync(tmpPath, JSON.stringify(entry, null, 2), "utf-8");
    resilientRename(tmpPath, filePath);
  } catch {
    // Non-fatal — local heartbeats.json is still the primary store
  }
}

export function deletePresenceFile(agentId: string): void {
  try {
    const canonicalId = canonicalizeAgentId(agentId);
    const filename = canonicalId || agentId.replace(/[/\\:]/g, "_");
    const sanitizedId = filename.replace(/[/\\:]/g, "_");
    const filePath = join(PRESENCE_DIR, `${sanitizedId}.json`);
    if (existsSync(filePath)) {
      unlinkSync(filePath);
    }
  } catch {
    // Non-fatal — stale presence also ages out, but reset should try to
    // remove it immediately so tap_who does not show the old identity ready.
  }
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
    const displayName = heartbeat.agent?.trim() || null;
    const instanceId = heartbeat.instanceId?.trim() || null;
    const slot = deriveRoutingSlotFromInstanceId(instanceId);
    if (displayName === normalized) {
      return formatAgentLabel(agentId, heartbeat.agent);
    }
    if (instanceId && sameRoutingAddress(normalized, instanceId)) {
      return formatAgentLabel(instanceId, displayName);
    }
    if (slot && sameRoutingAddress(normalized, slot)) {
      return formatAgentLabel(slot, displayName);
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

  const agentId = getAgentId();
  const agentName = getAgentName();
  let heartbeatStore: HeartbeatStore = {};
  let receiptStore: ReceiptStore = {};
  if (agentId !== "unknown") {
    try {
      heartbeatStore = loadHeartbeats();
    } catch {
      // Non-critical: if we can't read, show all
    }
  }
  try {
    receiptStore = loadReceipts();
  } catch {
    // Non-critical: if we can't read, fall back to volatile readFiles only
  }

  // Use the later of since and joinedAt
  const joinedAtMs = getJoinedAtMs({
    heartbeatStore,
    agentId,
    agentName,
  });
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
      const fullPath = join(dir, filename);
      let mtime: number;
      try {
        mtime = statSync(fullPath).mtimeMs;
      } catch {
        continue;
      }
      if (hasReadFileAtMtime(key, mtime)) continue;
      if (effectiveSinceMs && mtime < effectiveSinceMs) continue;

      // Skip messages already delivered via bridge (dedup)
      if (isBridgeProcessed(fullPath, mtime)) {
        continue;
      }

      let content: string;
      try {
        content = stripBom(readFileSync(fullPath, "utf-8"));
      } catch {
        continue;
      }
      const rawContent = content;
      if (hasReadFileContent(key, rawContent)) {
        markFileRead(key, mtime, rawContent);
        continue;
      }

      if (
        hasDurableReadReceipt(filename, {
          receiptStore,
          agentId,
          agentName,
          content,
          fileMtimeMs: mtime,
        })
      ) {
        continue;
      }

      let from: string = source;
      let to = "all";
      let subject = filename.replace(/\.md$/, "");
      let inboxFrontmatter: ReturnType<typeof parseFrontmatter> = null;
      let rawFrom: string = source;

      if (source === "inbox") {
        // Frontmatter-first routing (M202): try frontmatter, fall back to filename
        inboxFrontmatter = parseFrontmatter(content);
        const parsed = inboxFrontmatter
          ? {
              from: inboxFrontmatter.from,
              to: inboxFrontmatter.to,
              subject: inboxFrontmatter.subject,
            }
          : parseFilename(filename);
        if (
          !parsed ||
          (inboxFrontmatter
            ? !isInboxFrontmatterForCurrentAgent(inboxFrontmatter)
            : !isForMe(parsed.to))
        ) {
          continue;
        }
        if (isOwnMessageAddressForCurrentAgent(parsed.from)) continue;
        const reviewMeta = classifyReviewMetaForOperator({
          root: COMMS_DIR,
          filename,
          subject: parsed.subject,
          body: inboxFrontmatter ? stripFrontmatter(rawContent) : rawContent,
          sourceRelativePath: `inbox/${filename}`,
        });
        if (reviewMeta.status === "collapsed-stale-meta") {
          markFileRead(key, mtime, rawContent);
          continue;
        }
        rawFrom = parsed.from;
        from = resolveAgentLabel(
          inboxFrontmatter?.from_name ?? parsed.from,
          heartbeatStore,
        );
        to = resolveAgentLabel(
          inboxFrontmatter?.to_name ?? parsed.to,
          heartbeatStore,
        );
        subject = parsed.subject;
        // Strip frontmatter from displayed content
        if (inboxFrontmatter && includeContent) {
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
        if (source === "inbox") {
          item.display = buildCompactInboxDisplay({
            agentName: to,
            sender: from,
            recipient: to,
            subject,
            filename,
            body: content,
            replyTo: rawFrom,
            fromAddress: inboxFrontmatter?.from_address,
          });
        }
      }

      items.push(item);
      if (markRead) {
        markFileRead(key, mtime, rawContent);
      }

      if (items.length >= limit) {
        return items;
      }
    }
  }

  return items;
}
