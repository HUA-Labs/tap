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

const PLACEHOLDER_NAMES = new Set(["unknown", "unnamed", "<set-per-session>"]);

function canonicalizeAgentId(value: string): string {
  return value.trim().replace(/-/g, "_");
}

function resolveInitialId(): string {
  const envId = process.env.TAP_AGENT_ID;
  if (envId && !PLACEHOLDER_NAMES.has(envId)) return canonicalizeAgentId(envId);

  const envName = process.env.TAP_AGENT_NAME;
  if (envName && !PLACEHOLDER_NAMES.has(envName)) {
    return canonicalizeAgentId(envName);
  }

  return "unknown";
}

let _agentId = resolveInitialId();
let _agentName = process.env.TAP_AGENT_NAME || "unknown";

export function getAgentId(): string {
  if (_agentId !== "unknown") {
    return _agentId;
  }
  return canonicalizeAgentId(_agentName || "unknown");
}

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
  joinedAt?: string; // ISO — set on first tap_set_name, preserved on rename
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

function getAddressAliases(value: string): Set<string> {
  const normalized = value.trim();
  if (!normalized) return new Set();

  return new Set([
    normalized,
    normalized.replace(/-/g, "_"),
    normalized.replace(/_/g, "-"),
  ]);
}

export function encodeRouteSegment(value: string): string {
  return encodeURIComponent(value.trim()).replace(/-/g, "%2D");
}

export function decodeRouteSegment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function parseFilename(filename: string): ParsedFilename | null {
  const stem = filename.replace(/\.md$/i, "");
  const dated = stem.match(/^(\d{8})-(.+)$/);
  if (dated) {
    const parts = dated[2].split("-");
    if (parts.length >= 3) {
      return {
        from: decodeRouteSegment(parts[0] || "?"),
        to: decodeRouteSegment(parts[1] || "?"),
        subject: decodeRouteSegment(parts.slice(2).join("-") || "?"),
      };
    }
  }

  const parts = stem.split("-");
  if (parts.length >= 4) {
    return {
      from: decodeRouteSegment(parts[1] || "?"),
      to: decodeRouteSegment(parts[2] || "?"),
      subject: decodeRouteSegment(parts.slice(3).join("-") || "?"),
    };
  }

  return null;
}

export function parseInboxEnvelope(
  filename: string,
  content?: string,
): ParsedFilename | null {
  if (content) {
    const frontmatter = stripBom(content).match(
      /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/,
    );
    if (frontmatter) {
      let from = "";
      let to = "";
      let subject = "";

      for (const line of frontmatter[1].split(/\r?\n/)) {
        const separator = line.indexOf(":");
        if (separator <= 0) continue;

        const key = line.slice(0, separator).trim();
        const value = line.slice(separator + 1).trim();

        if (key === "from") from = value;
        if (key === "to") to = value;
        if (key === "subject") subject = value;
      }

      if (from && to && subject) {
        return { from, to, subject };
      }
    }
  }

  return parseFilename(filename);
}

export function isForMe(to: string): boolean {
  const normalized = to.trim();
  if (!normalized) return false;
  if (normalized === "전체" || normalized === "all") return true;

  return (
    getAddressAliases(getAgentId()).has(normalized) ||
    getAddressAliases(getAgentName()).has(normalized)
  );
}

export function isOwnSender(from: string): boolean {
  const normalized = from.trim();
  if (!normalized) return false;

  return (
    getAddressAliases(getAgentId()).has(normalized) ||
    getAddressAliases(getAgentName()).has(normalized)
  );
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
