/**
 * tap-comms shared utilities: types, config, parsing, helpers.
 */
import { existsSync, readdirSync, statSync } from "fs";
import { join, resolve } from "path";

// ── Config ──────────────────────────────────────────────────────────────

const RAW_COMMS_DIR = process.env.TAP_COMMS_DIR;
if (!RAW_COMMS_DIR) {
  console.error(
    "[tap-comms] FATAL: TAP_COMMS_DIR not set. Set via env or .tap-config",
  );
  process.exit(1);
}

export const COMMS_DIR = resolve(RAW_COMMS_DIR);
export const INBOX_DIR = join(COMMS_DIR, "inbox");
export const REVIEWS_DIR = join(COMMS_DIR, "reviews");
export const FINDINGS_DIR = join(COMMS_DIR, "findings");
export const RECEIPTS_DIR = join(COMMS_DIR, "receipts");
export const RECEIPTS_PATH = join(RECEIPTS_DIR, "receipts.json");
export const RECEIPTS_LOCK = join(RECEIPTS_DIR, ".lock");
export const HEARTBEATS_PATH = join(COMMS_DIR, "heartbeats.json");
export const HEARTBEATS_LOCK = join(COMMS_DIR, ".heartbeats.lock");
export const ARCHIVE_DIR = join(COMMS_DIR, "archive");
export const DB_PATH = join(COMMS_DIR, "tap.db");
export const SERVER_START = Date.now();

// ── Agent Name ──────────────────────────────────────────────────────────

let _agentName = process.env.TAP_AGENT_NAME || "unknown";

export function getAgentName(): string {
  return _agentName;
}

export function setAgentName(name: string) {
  _agentName = name;
}

// ── Types ───────────────────────────────────────────────────────────────

export type ChannelSource = "inbox" | "reviews" | "findings";

export type ParsedFilename = { from: string; to: string; subject: string };

export type TapUnreadItem = {
  source: ChannelSource;
  filename: string;
  path: string;
  from: string;
  to: string;
  subject: string;
  mtime: string;
  content?: string;
};

export type Heartbeat = {
  agent: string;
  timestamp: string;
  lastActivity: string;
  status: "active" | "idle" | "signing-off";
};

export type HeartbeatStore = Record<string, Heartbeat>;

export type Receipt = { reader: string; timestamp: string };
export type ReceiptStore = Record<string, Receipt[]>;

// ── Activity Tracking ───────────────────────────────────────────────────

let _lastActivityTime = new Date().toISOString();

export function getLastActivityTime(): string {
  return _lastActivityTime;
}

export function updateActivityTime() {
  _lastActivityTime = new Date().toISOString();
}

// ── Utilities ───────────────────────────────────────────────────────────

export function debug(message: string) {
  console.error(`[tap-comms] ${message}`);
}

export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

export function parseFilename(filename: string): ParsedFilename | null {
  const match = filename.match(/^\d{8}-(.+?)-(.+?)-(.+)\.md$/);
  if (match) {
    return { from: match[1], to: match[2], subject: match[3] };
  }

  const parts = filename.replace(/\.md$/, "").split("-");
  if (parts.length >= 4) {
    return {
      from: parts[1] || "?",
      to: parts[2] || "?",
      subject: parts.slice(3).join("-") || "?",
    };
  }

  return null;
}

export function isForMe(to: string): boolean {
  return to === _agentName || to === "전체" || to === "all";
}

export function normalizeSources(value: unknown): ChannelSource[] {
  if (!Array.isArray(value) || value.length === 0) {
    return ["inbox", "reviews", "findings"];
  }

  const allowed = new Set<ChannelSource>(["inbox", "reviews", "findings"]);
  const normalized = value.filter(
    (entry): entry is ChannelSource =>
      typeof entry === "string" && allowed.has(entry as ChannelSource),
  );

  return normalized.length ? normalized : ["inbox", "reviews", "findings"];
}

export function getLatestReviewDir(): string | null {
  if (!existsSync(REVIEWS_DIR)) return null;
  const gens = readdirSync(REVIEWS_DIR)
    .filter((entry) => entry.startsWith("gen"))
    .sort();
  return gens.length ? join(REVIEWS_DIR, gens[gens.length - 1]) : null;
}

export function getSourceDir(source: ChannelSource): string | null {
  if (source === "inbox") return INBOX_DIR;
  if (source === "reviews") return getLatestReviewDir();
  return FINDINGS_DIR;
}

export function getSourceKey(source: ChannelSource, filename: string): string {
  return `${source}/${filename}`;
}

export function getRecentSenders(): Set<string> {
  const senders = new Set<string>();
  if (!existsSync(INBOX_DIR)) return senders;

  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  for (const filename of readdirSync(INBOX_DIR)) {
    if (!filename.endsWith(".md")) continue;
    try {
      const mtime = statSync(join(INBOX_DIR, filename)).mtimeMs;
      if (mtime < cutoff) continue;
    } catch {
      continue;
    }
    const parsed = parseFilename(filename);
    if (parsed) senders.add(parsed.from);
  }
  return senders;
}
