/**
 * tap-comms shared utilities: types, config, parsing, helpers.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { join, resolve } from "path";
import {
  canonicalizeAgentId as canonicalizeIdentityId,
  isPlaceholderAgentValue,
  matchesAgentRecipient,
} from "./tap-identity.js";

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

// ── Agent Identity ──────────────────────────────────────────────────────
// id = immutable routing key (set once at startup or first tap_set_name)
// name = session display label. Once a real name is confirmed, only
// idempotent tap_set_name calls are allowed until an explicit rename flow exists.

type TapBootstrapInstance = {
  runtime?: string;
  installed?: boolean;
  agentName?: string | null;
};

function isConcreteIdentity(value: string | undefined): value is string {
  return !isPlaceholderAgentValue(value);
}

function normalizeAgentId(value: string): string {
  return canonicalizeIdentityId(value);
}

function loadStateInstances(): Record<string, TapBootstrapInstance> | null {
  const stateDir = process.env.TAP_STATE_DIR;
  if (!stateDir) return null;
  try {
    const statePath = join(stateDir, "state.json");
    if (!existsSync(statePath)) return null;
    const state = JSON.parse(readFileSync(statePath, "utf-8")) as {
      instances?: Record<string, TapBootstrapInstance>;
    };
    return state.instances ?? null;
  } catch {
    return null;
  }
}

type StateBootstrapIdentity = {
  agentId: string;
  agentName: string | null;
};

function resolveSingleCodexBootstrap(): StateBootstrapIdentity | null {
  const instances = loadStateInstances();
  if (!instances) return null;

  const installedCodexInstances = Object.entries(instances).filter(
    ([, instance]) => instance?.runtime === "codex" && instance?.installed,
  );
  if (installedCodexInstances.length !== 1) return null;

  const [instanceId, instance] = installedCodexInstances[0];
  return {
    agentId: normalizeAgentId(instanceId),
    agentName:
      typeof instance.agentName === "string" &&
      !isPlaceholderAgentValue(instance.agentName)
        ? instance.agentName
        : null,
  };
}

function resolveInitialId(
  stateBootstrap: StateBootstrapIdentity | null,
): string {
  const envId = process.env.TAP_AGENT_ID;
  if (isConcreteIdentity(envId)) return normalizeAgentId(envId);
  const envName = process.env.TAP_AGENT_NAME;
  if (isConcreteIdentity(envName)) return normalizeAgentId(envName);
  return stateBootstrap?.agentId ?? "unknown";
}

/** Try to read agentName from state.json for the current instance. */
function resolveNameFromState(
  agentId: string,
  stateBootstrap: StateBootstrapIdentity | null,
): string | null {
  if (agentId === "unknown") return null;
  if (stateBootstrap?.agentId === agentId && stateBootstrap.agentName) {
    return stateBootstrap.agentName;
  }
  try {
    const instances = loadStateInstances();
    if (!instances) return null;
    const instance =
      instances[agentId] ?? instances[agentId.replace(/_/g, "-")];
    return typeof instance?.agentName === "string" &&
      !isPlaceholderAgentValue(instance.agentName)
      ? instance.agentName
      : null;
  } catch {
    return null;
  }
}

const stateBootstrap = resolveSingleCodexBootstrap();
let _agentId = resolveInitialId(stateBootstrap);
// State takes priority over env — tap_set_name backwrites to state,
// but managed MCP config env may still hold a stale name from tap add time.
let _agentName =
  resolveNameFromState(_agentId, stateBootstrap) ??
  (isConcreteIdentity(process.env.TAP_AGENT_NAME)
    ? process.env.TAP_AGENT_NAME
    : "unknown");
let _idLocked = _agentId !== "unknown";
// M185: Name confirmation — once confirmed, only idempotent calls allowed.
// Prevents subagents from overwriting parent's display name.
// If booted with a real name (from state or env), consider it pre-confirmed.
let _nameConfirmed = !isPlaceholderAgentValue(_agentName);

export function getAgentId(): string {
  return _agentId;
}

export function getAgentName(): string {
  return _agentName;
}

export function resolveKnownInstanceId(
  agentId: string,
  displayName?: string | null,
): string | null {
  const instances = loadStateInstances();
  if (!instances) return null;

  const candidates = [
    agentId,
    agentId.replace(/_/g, "-"),
    agentId.replace(/-/g, "_"),
  ];
  for (const candidate of candidates) {
    if (instances[candidate]?.installed) return candidate;
  }

  if (!displayName || isPlaceholderAgentValue(displayName)) return null;
  const matches = Object.entries(instances).filter(
    ([, instance]) => instance?.installed && instance.agentName === displayName,
  );
  return matches.length === 1 ? matches[0][0] : null;
}

export function resolveCurrentInstanceId(): string | null {
  return resolveKnownInstanceId(_agentId, _agentName);
}

export function buildHeartbeatConnectHash(
  instanceId: string | null | undefined,
  agentId: string,
): string {
  return instanceId ? `instance:${instanceId}` : `session:${agentId}`;
}

export function isNameConfirmed(): boolean {
  return _nameConfirmed;
}

/**
 * Demote agent name to "unknown" and reset confirmed state.
 * Used when bootstrap claim fails — allows tap_set_name recovery.
 */
export function demoteAgentName(): void {
  _agentName = "unknown";
  _nameConfirmed = false;
}

export function setAgentName(name: string) {
  _agentName = name;
  _nameConfirmed = true;
  // First set_name also locks the id (backward compat: id = first name chosen)
  if (!_idLocked) {
    // Hyphens are reserved as filename delimiters — use underscores instead
    _agentId = canonicalizeIdentityId(name);
    _idLocked = true;
  }
}

export type AgentNameClaimResult =
  | {
      ok: true;
      oldName: string;
      agentId: string;
      wasIdLocked: boolean;
    }
  | {
      ok: false;
      currentName: string;
      agentId: string;
    };

// M185 scope: once a session already holds a real name, later same-process
// callers can only repeat that same name. Placeholder boot first-claim remains
// first-caller-wins until caller context exists (M193).
export function claimAgentName(name: string): AgentNameClaimResult {
  const oldName = _agentName;
  const wasIdLocked = _idLocked;
  if (_nameConfirmed && name !== oldName) {
    return {
      ok: false,
      currentName: oldName,
      agentId: _agentId,
    };
  }

  setAgentName(name);
  return {
    ok: true,
    oldName,
    agentId: _agentId,
    wasIdLocked,
  };
}

export function isIdLocked(): boolean {
  return _idLocked;
}

// ── Types ───────────────────────────────────────────────────────────────

export type ChannelSource = "inbox" | "reviews" | "findings";

export type ParsedFilename = { from: string; to: string; subject: string };

export type ParsedFrontmatter = {
  from: string;
  from_name?: string;
  to: string;
  to_name?: string;
  subject: string;
  sent_at?: string;
  type?: string;
};

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

export type HeartbeatSource = "bridge-dispatch" | "mcp-direct";

export type Heartbeat = {
  id?: string; // routing id (immutable) — absent in legacy entries
  agent: string; // display name (mutable)
  timestamp: string;
  lastActivity: string;
  joinedAt?: string; // ISO — set on first tap_set_name, preserved on rename
  status: "active" | "idle" | "signing-off";
  source?: HeartbeatSource;
  instanceId?: string | null;
  bridgePid?: number | null;
  connectHash?: string;
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

/**
 * Parse YAML frontmatter from message content.
 * Returns parsed fields or null if no valid frontmatter found.
 */
export function parseFrontmatter(content: string): ParsedFrontmatter | null {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return null;

  const fields: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const kv = line.match(/^(\w+):\s*(.+)$/);
    if (kv) fields[kv[1]] = kv[2].trim();
  }

  if (!fields.from || !fields.to) return null;

  return {
    from: fields.from,
    from_name: fields.from_name,
    to: fields.to,
    to_name: fields.to_name,
    subject: fields.subject ?? "",
    sent_at: fields.sent_at,
    type: fields.type,
  };
}

/**
 * Strip frontmatter from content, returning only the body.
 */
export function stripFrontmatter(content: string): string {
  return content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n*/, "");
}

/**
 * Parse message routing info: try frontmatter first, fall back to filename.
 */
export function parseMessageRoute(
  filename: string,
  content?: string,
): ParsedFilename | null {
  if (content) {
    const fm = parseFrontmatter(content);
    if (fm) return { from: fm.from, to: fm.to, subject: fm.subject };
  }
  return parseFilename(filename);
}

export function parseFilename(filename: string): ParsedFilename | null {
  // Format: YYYYMMDD-{from}-{to}-{subject}.md
  // from/to may contain hyphens (e.g. "codex-1"), so we split by "-" and
  // use a known-agent or structural heuristic: date(1) + from + to + subject(rest).
  // Strategy: strip date prefix, then split remainder into exactly 3+ segments
  // where from/to are single CJK chars or known multi-segment ids.
  const withoutExt = filename.replace(/\.md$/, "");
  const dateMatch = withoutExt.match(/^(\d{8})-(.+)$/);
  if (!dateMatch) return null;

  const rest = dateMatch[2];

  // Try CJK-aware split: CJK characters are single-char agent names
  // Match: {from}-{to}-{subject} where from/to can be CJK single chars
  const cjkMatch = rest.match(
    /^([\u3131-\uD79DA-Za-z][\w]*?)-([\u3131-\uD79DA-Za-z][\w]*?)-(.+)$/,
  );
  if (cjkMatch) {
    return { from: cjkMatch[1], to: cjkMatch[2], subject: cjkMatch[3] };
  }

  // Fallback: simple 3-part split (first two segments = from/to)
  const parts = rest.split("-");
  if (parts.length >= 3) {
    return {
      from: parts[0] || "?",
      to: parts[1] || "?",
      subject: parts.slice(2).join("-") || "?",
    };
  }

  return null;
}

/**
 * M204: Canonicalize agent ID — normalize hyphens to underscores.
 * Both `codex-1` and `codex_1` map to `codex_1`.
 */
export function canonicalizeAgentId(id: string): string {
  return canonicalizeIdentityId(id);
}

export function isForMe(to: string): boolean {
  return matchesAgentRecipient(to, _agentId, _agentName);
}

export function normalizeSources(value: unknown): ChannelSource[] {
  // Default: inbox + reviews only. Findings are record-keeping, not real-time
  // comms — request explicitly via sources: ["findings"] if needed.
  if (!Array.isArray(value) || value.length === 0) {
    return ["inbox", "reviews"];
  }

  const allowed = new Set<ChannelSource>(["inbox", "reviews", "findings"]);
  const normalized = value.filter(
    (entry): entry is ChannelSource =>
      typeof entry === "string" && allowed.has(entry as ChannelSource),
  );

  return normalized.length ? normalized : ["inbox", "reviews"];
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
