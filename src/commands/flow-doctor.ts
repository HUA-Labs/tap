import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { resolveConfig } from "../config/index.js";
import {
  AGENT_PROFILES,
  type CliProfileConfig,
  type FlowSupervisorConfig,
  type ProfileConfig,
} from "./status-profiles.js";
import { findStatusProfileInProfilePack } from "./profile-pack-loader.js";
import {
  runPollingReceiver,
  type RunPollingReceiverResult,
} from "../receiver/codex-cli-polling-receiver.js";
import {
  runLocalUplink,
  type UplinkDir,
  type UplinkItem,
  type RunLocalUplinkResult,
} from "../uplink/local-append-only-uplink.js";
import type { CommandResult } from "../types.js";
import { findRepoRoot, log, logHeader, parseArgs } from "../utils.js";

const DEFAULT_LIVE_PRESENCE_FRESH_MINUTES = 30;
const DEFAULT_POLLING_PRESENCE_FRESH_MINUTES = 17 * 60;

const FLOW_DOCTOR_HELP = `
Usage:
  tap flow-doctor --agent <name> --target-comms-dir <path> [options]
  tap flow-doctor --lane-profile <profile> [options]

Description:
  Read-only diagnostic for receiver/promoter plus return-uplink evidence flow.
  It explains cases where local receiver evidence is healthy but return evidence
  is skipped by identity drift, own-source filters, collisions, missing remote
  registration, stale presence, or wrong-host flow supervision. It never
  restarts processes, publishes stale presence, or rewrites route tuples; the
  explicit apply paths are limited to guarded polling presence publish and
  stale non-lane presence archival with a manifest.

Options:
  --agent <name>              Expected lane/author identity.
  --lane-profile <id>         Runtime lane profile id from --profile-pack.
  --profile-pack <path>       Load reviewed local lane profile data.
  --runtime-agent <name>      Observed runtime identity. Defaults to TAP_AGENT_NAME/CODEX_TAP_AGENT_NAME.
  --source-comms-dir <path>   Local/source comms dir. Defaults to resolved tap comms dir.
  --target-comms-dir <path>   Return-uplink target comms dir to compare/register against.
  --presence-source-comms-dir <path>
                              Source runtime comms dir for presence freshness checks.
  --presence-target-comms-dir <path>
                              Central/target comms dir for presence freshness and cleanup checks.
  --fresh-minutes <n>         Consent-drive live-route freshness window. Default: ${DEFAULT_LIVE_PRESENCE_FRESH_MINUTES}.
  --polling-fresh-minutes <n> Polling/CLI visibility freshness window. Default: ${DEFAULT_POLLING_PRESENCE_FRESH_MINUTES}.
  --apply-polling-presence-publish
                              Copy a fresh polling/mcp source presence record to the central target presence file.
  --apply-stale-presence-cleanup
                              Archive stale non-lane presence records and prune matching stale heartbeats.
  --cleanup-archive-dir <path>
                              Override archive dir for stale presence cleanup.
  --state-dir <path>          State dir for dry-run cursor resolution. Defaults to resolved tap state dir.
  --dir <list>                Comma-separated append-only dirs. Default: inbox,reviews.
  --alias <name>              Additional expected identity alias. Repeat or comma-separate.
  --keep-presence-agent <name>
                              Presence record to keep during stale cleanup. Repeat or comma-separate.
  --since <iso>               Only inspect records modified since this timestamp.
  --all                       Inspect all matching records.
  --limit <n>                 Max records per diagnostic scan. Default: 100.
  --json                      Machine-readable JSON output.
  --help, -h                  Show help.
`.trim();

type FlowDoctorStatus = "ready" | "warn" | "blocked";
type IdentityStatus = "ready" | "drift" | "unknown";
type EvidencePresence = "source-only" | "target-only" | "both" | "collision";
type LaneStatus = "ready" | "warn" | "blocked" | "not-configured";
type PresenceFreshness =
  | "fresh-for-routing"
  | "visible"
  | "stale-visible"
  | "missing"
  | "unknown";
type FlowSupervisorStatus =
  | "running"
  | "stopped"
  | "wrong-host"
  | "not-observed";
type ActiveTurnStatus =
  | "not-observed"
  | "idle"
  | "active"
  | "stale-active-turn";
type ReturnEligibility =
  | "eligible"
  | "inbound"
  | "notFromAgent"
  | "collision"
  | "target-exists"
  | "target-only";

interface ParsedMessageMetadata {
  from: string | null;
  fromName: string | null;
  to: string | null;
  subject: string | null;
  messageId: string | null;
}

interface EvidenceRecord {
  dir: UplinkDir;
  filename: string;
  relativePath: string;
  sourcePath: string | null;
  targetPath: string | null;
  from: string | null;
  fromName: string | null;
  to: string | null;
  subject: string | null;
  messageId: string | null;
  presence: EvidencePresence;
  returnEligibility: ReturnEligibility;
  reason: string;
}

interface FlowDoctorAction {
  id: string;
  label: string;
  command?: string;
  reason: string;
  risk:
    | "read-only"
    | "manual"
    | "identity-repair"
    | "safe-publish"
    | "safe-archive";
}

interface PresenceCheck {
  role: "source" | "target";
  agent: string;
  path: string;
  exists: boolean;
  freshness: PresenceFreshness;
  consentDriveStatus: "ready" | "partial" | "stale" | "unavailable" | null;
  freshForRouting: boolean;
  ageSeconds: number | null;
  receiveTransports: string[];
  conversationId: string | null;
  ownerClientId: string | null;
  recommendation: string;
  error: string | null;
}

interface StalePresenceCandidate {
  agent: string;
  path: string;
  freshness: PresenceFreshness;
  ageSeconds: number | null;
  reason: string;
}

interface StalePresenceCleanup {
  status: "ready" | "needs-cleanup" | "applied" | "not-configured";
  targetCommsDir: string | null;
  archiveDir: string | null;
  manifestPath: string | null;
  candidates: StalePresenceCandidate[];
  archived: string[];
  prunedHeartbeats: string[];
  keptFresh: string[];
  applied: boolean;
  message: string;
}

interface PollingPresencePublish {
  status: "ready" | "needs-publish" | "applied" | "blocked" | "not-configured";
  sourcePath: string | null;
  targetPath: string | null;
  applied: boolean;
  message: string;
  error: string | null;
}

interface FlowSupervisorCheck {
  id: string;
  label: string;
  host: string;
  tmuxSession: string;
  status: FlowSupervisorStatus;
  statusCommand: string;
  startCommand: string;
  nextAction: string;
  message: string;
}

interface ActiveTurnSummary {
  status: ActiveTurnStatus;
  queued: boolean | null;
  blocked: boolean | null;
  activeTurnId: string | null;
  ageSeconds: number | null;
  message: string;
}

interface LaneDiagnostics {
  status: LaneStatus;
  profile: string | null;
  currentHost: string;
  presence: {
    source: PresenceCheck;
    target: PresenceCheck;
  };
  pollingPresencePublish: PollingPresencePublish;
  stalePresence: StalePresenceCleanup;
  flowSupervisors: FlowSupervisorCheck[];
  activeTurn: ActiveTurnSummary;
}

interface FlowDoctorReport extends Record<string, unknown> {
  command: "flow-doctor";
  status: FlowDoctorStatus;
  generatedAt: string;
  summary: string;
  environment: {
    cwd: string;
    repoRoot: string;
    sourceCommsDir: string;
    targetCommsDir: string | null;
    stateDir: string;
    agent: string;
    aliases: string[];
    dirs: UplinkDir[];
    since: string | null;
    all: boolean;
    laneProfile: string | null;
    freshMinutes: number;
    pollingFreshMinutes: number;
    presenceSourceCommsDir: string;
    presenceTargetCommsDir: string | null;
    applyStalePresenceCleanup: boolean;
    applyPollingPresencePublish: boolean;
  };
  identity: {
    expectedAgent: string;
    runtimeAgent: string | null;
    status: IdentityStatus;
    message: string;
  };
  receiver: {
    status: RunPollingReceiverResult["status"];
    scanned: number;
    skipped: RunPollingReceiverResult["skipped"];
    activeTurn: {
      status: ActiveTurnStatus;
      queued: boolean | null;
      blocked: boolean | null;
      activeTurnId: string | null;
      ageSeconds: number | null;
      message: string;
    };
    items: Array<{
      filename: string;
      from: string;
      to: string;
      subject: string;
      messageId: string | null;
    }>;
    evidence: string;
  };
  returnUplink: {
    status: RunLocalUplinkResult["status"] | "not-configured";
    scanned: number;
    skipped: RunLocalUplinkResult["skipped"];
    items: Array<
      Pick<
        UplinkItem,
        "relativePath" | "from" | "to" | "subject" | "skipReason"
      >
    >;
    evidence: EvidenceRecord[];
  };
  lane: LaneDiagnostics;
  nextActions: FlowDoctorAction[];
}

function stringFlag(
  flags: Record<string, string | boolean>,
  key: string,
): string | undefined {
  const value = flags[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function booleanFlag(
  flags: Record<string, string | boolean>,
  key: string,
): boolean {
  return flags[key] === true || flags[key] === "true";
}

function splitValues(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function repeatedStringFlags(args: string[], keys: string[]): string[] {
  const wanted = new Set(keys);
  const values: string[] = [];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (!arg.startsWith("--")) continue;
    const eqIdx = arg.indexOf("=");
    if (eqIdx > 2) {
      const key = arg.slice(2, eqIdx);
      const value = arg.slice(eqIdx + 1).trim();
      if (wanted.has(key) && value) values.push(value);
      continue;
    }
    const key = arg.slice(2);
    const next = args[index + 1];
    if (!wanted.has(key) || !next || next.startsWith("--")) continue;
    values.push(next.trim());
    index++;
  }
  return values;
}

function splitRepeatedValues(values: string[]): string[] {
  return values.flatMap((value) => splitValues(value));
}

function toPositiveInteger(
  value: string | undefined,
  fallback: number,
): number {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new RangeError(`Invalid numeric value: ${value}`);
  }
  return parsed;
}

function normalizeAddress(value: string): string {
  return value.trim().toLowerCase();
}

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) continue;
    const key = normalizeAddress(trimmed);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }
  return result;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function recordValue(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function stringArray(value: unknown): string[] {
  if (typeof value === "string") return value.trim() ? [value.trim()] : [];
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function readJsonFile(filePath: string): Record<string, unknown> | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as Record<
      string,
      unknown
    >;
  } catch {
    return null;
  }
}

function parseTimeMs(value: unknown): number | null {
  const raw = stringValue(value);
  if (!raw) return null;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function ageSecondsFromMs(timeMs: number | null, nowMs: number): number | null {
  return timeMs === null
    ? null
    : Math.max(0, Math.floor((nowMs - timeMs) / 1000));
}

function heartbeatActivityMs(
  record: Record<string, unknown> | null,
): number | null {
  const lastActivityMs = parseTimeMs(record?.lastActivity);
  const timestampMs = parseTimeMs(record?.timestamp);
  if (lastActivityMs === null) return timestampMs;
  if (timestampMs === null) return lastActivityMs;
  return Math.max(lastActivityMs, timestampMs);
}

function splitAddressList(value: string): string[] {
  return value
    .split(/[,\s]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function matchesAlias(value: string | null, aliases: string[]): boolean {
  if (!value) return false;
  const normalizedAliases = new Set(aliases.map(normalizeAddress));
  return splitAddressList(value).some((part) =>
    normalizedAliases.has(normalizeAddress(part)),
  );
}

function isUnknownSender(value: string | null): boolean {
  return !value || normalizeAddress(value) === "unknown";
}

function isOwnSource(
  metadata: ParsedMessageMetadata,
  aliases: string[],
): boolean {
  if (!isUnknownSender(metadata.from))
    return matchesAlias(metadata.from, aliases);
  return matchesAlias(metadata.fromName, aliases);
}

function requiresOwnSource(dir: UplinkDir): boolean {
  return dir === "inbox" || dir === "reviews";
}

function parseFrontmatter(content: string): Record<string, string> {
  if (!content.startsWith("---")) return {};
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const fields: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const field = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!field) continue;
    fields[field[1].toLowerCase()] = field[2]
      .trim()
      .replace(/^["']|["']$/g, "");
  }
  return fields;
}

function parseHeaderFields(content: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const line of content.split(/\r?\n/).slice(0, 12)) {
    if (!line.trim()) break;
    const field = line.match(/^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/);
    if (!field) continue;
    fields[field[1].toLowerCase()] = field[2].trim();
  }
  return fields;
}

function parseFilename(filename: string): {
  from: string | null;
  to: string | null;
  subject: string | null;
} {
  const stem = filename.replace(/\.(md|json)$/i, "");
  const parts = stem.split("-");
  if (parts.length < 4) return { from: null, to: null, subject: stem || null };
  return {
    from: parts[1] || null,
    to: parts[2] || null,
    subject: parts.slice(3).join("-") || stem,
  };
}

function parseMetadata(
  filename: string,
  content: string,
): ParsedMessageMetadata {
  const frontmatter = parseFrontmatter(content);
  const headers = parseHeaderFields(content);
  const parsedFilename = parseFilename(filename);
  return {
    from: frontmatter.from ?? headers.from ?? parsedFilename.from,
    fromName:
      frontmatter.from_name ??
      frontmatter.fromname ??
      headers.from_name ??
      headers.fromname ??
      null,
    to: frontmatter.to ?? headers.to ?? parsedFilename.to,
    subject:
      frontmatter.subject ?? headers.subject ?? parsedFilename.subject ?? null,
    messageId:
      frontmatter.message_id ??
      frontmatter.messageid ??
      headers["message-id"] ??
      headers.message_id ??
      null,
  };
}

function sameFileContent(leftPath: string, rightPath: string): boolean {
  try {
    return fs.readFileSync(leftPath).equals(fs.readFileSync(rightPath));
  } catch {
    return false;
  }
}

function listFiles(
  commsDir: string,
  dirs: UplinkDir[],
  sinceMs: number | null,
): Map<
  string,
  { dir: UplinkDir; filename: string; fullPath: string; content: string }
> {
  const result = new Map<
    string,
    { dir: UplinkDir; filename: string; fullPath: string; content: string }
  >();
  for (const dir of dirs) {
    const fullDir = path.join(commsDir, dir);
    if (!fs.existsSync(fullDir)) continue;
    for (const filename of fs.readdirSync(fullDir).sort()) {
      if (!filename.endsWith(".md") && !filename.endsWith(".json")) continue;
      const fullPath = path.join(fullDir, filename);
      let stat: fs.Stats;
      try {
        stat = fs.statSync(fullPath);
      } catch {
        continue;
      }
      if (!stat.isFile()) continue;
      if (sinceMs !== null && stat.mtimeMs < sinceMs) continue;
      let content = "";
      try {
        content = fs.readFileSync(fullPath, "utf8").replace(/^\uFEFF/, "");
      } catch {
        continue;
      }
      result.set(`${dir}/${filename}`, { dir, filename, fullPath, content });
    }
  }
  return result;
}

function parseSinceMs(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    throw new RangeError(`Invalid --since timestamp: ${value}`);
  }
  return parsed;
}

function normalizeDirs(value: string | undefined): UplinkDir[] {
  const requested = splitValues(value);
  const values = requested.length ? requested : ["inbox", "reviews"];
  const allowed = new Set<UplinkDir>([
    "inbox",
    "reviews",
    "findings",
    "receipts",
    "decisions",
  ]);
  const dirs: UplinkDir[] = [];
  for (const candidate of values) {
    if (!allowed.has(candidate as UplinkDir)) {
      throw new RangeError(
        `Invalid --dir value: ${candidate}. Supported: inbox,reviews,findings,receipts,decisions.`,
      );
    }
    if (!dirs.includes(candidate as UplinkDir))
      dirs.push(candidate as UplinkDir);
  }
  return dirs;
}

function lookupLaneProfile(
  id: string | undefined,
  profilePackPath: string | null,
): ProfileConfig | null {
  if (!id) return null;
  return (
    (AGENT_PROFILES as Record<string, ProfileConfig | undefined>)[id] ??
    findStatusProfileInProfilePack(profilePackPath, id) ??
    null
  );
}

function presenceFreshnessWindowMinutes(
  receiveTransports: string[],
  freshMinutes: number,
  pollingFreshMinutes: number,
): number {
  if (receiveTransports.includes("consent-drive")) return freshMinutes;
  if (
    receiveTransports.includes("polling") ||
    receiveTransports.includes("mcp-channel")
  ) {
    return pollingFreshMinutes;
  }
  return freshMinutes;
}

function classifyPresenceRecord(
  record: Record<string, unknown> | null,
  nowMs: number,
  freshMinutes: number,
  pollingFreshMinutes: number,
): Omit<
  PresenceCheck,
  "role" | "agent" | "path" | "exists" | "recommendation" | "error"
> {
  const capabilities = recordValue(record?.capabilities);
  const address = recordValue(record?.address);
  const receiveTransports = unique([
    ...stringArray(record?.receiveTransports),
    ...stringArray(capabilities?.receiveTransports),
  ]);
  const conversationId =
    stringValue(capabilities?.conversationId) ??
    stringValue(address?.conversationId) ??
    stringValue(record?.conversationId);
  const ownerClientId =
    stringValue(capabilities?.ownerClientId) ??
    stringValue(address?.ownerClientId) ??
    stringValue(record?.ownerClientId);
  const activityMs = heartbeatActivityMs(record);
  const ageSeconds = ageSecondsFromMs(activityMs, nowMs);
  const usesConsentDrive = receiveTransports.includes("consent-drive");
  const effectiveFreshMinutes = presenceFreshnessWindowMinutes(
    receiveTransports,
    freshMinutes,
    pollingFreshMinutes,
  );
  const stale =
    record?.status === "signing-off" ||
    activityMs === null ||
    nowMs - activityMs > effectiveFreshMinutes * 60_000;
  const freshness: PresenceFreshness = stale
    ? "stale-visible"
    : usesConsentDrive
      ? "fresh-for-routing"
      : "visible";
  let consentDriveStatus: PresenceCheck["consentDriveStatus"] = null;
  if (usesConsentDrive) {
    if (stale) {
      consentDriveStatus = "stale";
    } else if (conversationId && ownerClientId) {
      consentDriveStatus = "ready";
    } else if (conversationId || ownerClientId) {
      consentDriveStatus = "partial";
    } else {
      consentDriveStatus = "unavailable";
    }
  }

  return {
    freshness,
    consentDriveStatus,
    freshForRouting:
      freshness === "fresh-for-routing" && consentDriveStatus === "ready",
    ageSeconds,
    receiveTransports,
    conversationId,
    ownerClientId,
  };
}

function presenceFilePath(commsDir: string, agent: string): string {
  return path.join(commsDir, "presence", `${agent}.json`);
}

function buildPresenceCheck(options: {
  role: "source" | "target";
  commsDir: string | null;
  agent: string;
  nowMs: number;
  freshMinutes: number;
  pollingFreshMinutes: number;
}): PresenceCheck {
  const filePath = options.commsDir
    ? presenceFilePath(options.commsDir, options.agent)
    : "";
  if (!options.commsDir) {
    return {
      role: options.role,
      agent: options.agent,
      path: "",
      exists: false,
      freshness: "missing",
      consentDriveStatus: null,
      freshForRouting: false,
      ageSeconds: null,
      receiveTransports: [],
      conversationId: null,
      ownerClientId: null,
      recommendation: "configure a comms dir before checking lane presence",
      error: "presence comms dir not configured",
    };
  }

  if (!fs.existsSync(filePath)) {
    return {
      role: options.role,
      agent: options.agent,
      path: filePath,
      exists: false,
      freshness: "missing",
      consentDriveStatus: null,
      freshForRouting: false,
      ageSeconds: null,
      receiveTransports: [],
      conversationId: null,
      ownerClientId: null,
      recommendation:
        options.role === "source"
          ? "run tap_session_warmup on the target runtime before publishing presence"
          : "publish guarded fresh presence after the source runtime is fresh-for-routing",
      error: null,
    };
  }

  const record = readJsonFile(filePath);
  if (!record) {
    return {
      role: options.role,
      agent: options.agent,
      path: filePath,
      exists: true,
      freshness: "unknown",
      consentDriveStatus: null,
      freshForRouting: false,
      ageSeconds: null,
      receiveTransports: [],
      conversationId: null,
      ownerClientId: null,
      recommendation: "repair invalid presence JSON before routing",
      error: "invalid presence JSON",
    };
  }

  const classified = classifyPresenceRecord(
    record,
    options.nowMs,
    options.freshMinutes,
    options.pollingFreshMinutes,
  );
  const sourceNeedsWarmup =
    options.role === "source" && !classified.freshForRouting;
  const targetNeedsPublish =
    options.role === "target" && !classified.freshForRouting;
  const pollingVisible =
    classified.freshness === "visible" &&
    (classified.receiveTransports.includes("polling") ||
      classified.receiveTransports.includes("mcp-channel"));
  return {
    role: options.role,
    agent: options.agent,
    path: filePath,
    exists: true,
    ...classified,
    recommendation: classified.freshForRouting
      ? "ready"
      : pollingVisible
        ? "polling/inbox visibility is current; not consent-drive live authority"
        : sourceNeedsWarmup
          ? "run tap_session_warmup on the target runtime, then publish presence"
          : targetNeedsPublish
            ? "publish guarded fresh presence after source freshness is confirmed"
            : "inspect presence state",
    error: null,
  };
}

function notConfiguredPresenceCheck(
  role: "source" | "target",
  agent: string,
): PresenceCheck {
  return {
    role,
    agent,
    path: "",
    exists: false,
    freshness: "missing",
    consentDriveStatus: null,
    freshForRouting: false,
    ageSeconds: null,
    receiveTransports: [],
    conversationId: null,
    ownerClientId: null,
    recommendation:
      "pass --lane-profile or presence comms dirs to enable lane presence diagnostics",
    error: "lane presence diagnostics not configured",
  };
}

function heartbeatRecordMatchesAgent(
  key: string,
  record: Record<string, unknown>,
  aliases: string[],
): boolean {
  const candidates = [
    key,
    stringValue(record.agent),
    stringValue(record.name),
    stringValue(record.agentName),
    stringValue(record.routingAddress),
    stringValue(record.id),
  ].filter((value): value is string => Boolean(value));
  return candidates.some((candidate) => matchesAlias(candidate, aliases));
}

function buildActiveTurnSummary(options: {
  commsDir: string;
  aliases: string[];
  nowMs: number;
  freshMinutes: number;
}): ActiveTurnSummary {
  const heartbeatsPath = path.join(options.commsDir, "heartbeats.json");
  const heartbeats = readJsonFile(heartbeatsPath);
  if (!heartbeats) {
    return {
      status: "not-observed",
      queued: null,
      blocked: null,
      activeTurnId: null,
      ageSeconds: null,
      message:
        "No readable heartbeats.json was observed; active-turn state is not inferred.",
    };
  }

  for (const [key, raw] of Object.entries(heartbeats)) {
    const record = recordValue(raw);
    if (!record || !heartbeatRecordMatchesAgent(key, record, options.aliases)) {
      continue;
    }
    const activeTurnId = stringValue(record.activeTurnId);
    const ageSeconds = ageSecondsFromMs(
      parseTimeMs(record.turnStartedAt) ??
        parseTimeMs(record.lastActivity) ??
        parseTimeMs(record.timestamp),
      options.nowMs,
    );
    if (!activeTurnId) {
      return {
        status: "idle",
        queued: false,
        blocked: false,
        activeTurnId: null,
        ageSeconds,
        message:
          "Heartbeat is visible and no active turn is currently reported.",
      };
    }
    const stale = ageSeconds !== null && ageSeconds > options.freshMinutes * 60;
    return {
      status: stale ? "stale-active-turn" : "active",
      queued: true,
      blocked: true,
      activeTurnId,
      ageSeconds,
      message: stale
        ? `Heartbeat reports stale active turn ${activeTurnId}; do not start or steer automatically.`
        : `Heartbeat reports active turn ${activeTurnId}; receiver/promoter should leave queued/blocked evidence.`,
    };
  }

  return {
    status: "not-observed",
    queued: null,
    blocked: null,
    activeTurnId: null,
    ageSeconds: null,
    message:
      "No heartbeat entry matched the expected lane identity; active-turn state is not inferred.",
  };
}

function presenceRecordAgent(
  filename: string,
  record: Record<string, unknown> | null,
): string {
  return (
    stringValue(record?.agent) ??
    stringValue(record?.name) ??
    stringValue(record?.routingAddress) ??
    filename.replace(/\.json$/i, "")
  );
}

function presenceRecordKeys(
  filename: string,
  record: Record<string, unknown> | null,
  agent: string,
): string[] {
  const identityKey = filename.replace(/\.json$/i, "");
  const address = recordValue(record?.address);
  return unique(
    [
      identityKey,
      stringValue(record?.id),
      stringValue(record?.agent),
      stringValue(record?.name),
      stringValue(record?.routingAddress),
      stringValue(address?.routingAddress),
      ...stringArray(address?.aliases),
      agent,
    ]
      .filter((value): value is string => Boolean(value))
      .map(normalizeAddress)
      .filter(Boolean),
  );
}

function defaultCleanupArchiveDir(targetCommsDir: string, now: Date): string {
  const stamp = now.toISOString().slice(0, 10).replace(/-/g, "");
  return path.join(
    targetCommsDir,
    "archive",
    `presence-cleanup-${stamp}-runtime-lane`,
  );
}

function buildStalePresenceCleanup(options: {
  targetCommsDir: string | null;
  keepAgents: string[];
  now: Date;
  freshMinutes: number;
  pollingFreshMinutes: number;
  apply: boolean;
  archiveDir: string | null;
}): StalePresenceCleanup {
  if (!options.targetCommsDir) {
    return {
      status: "not-configured",
      targetCommsDir: null,
      archiveDir: null,
      manifestPath: null,
      candidates: [],
      archived: [],
      prunedHeartbeats: [],
      keptFresh: [],
      applied: false,
      message:
        "No presence target comms dir configured; stale central presence cleanup was not checked.",
    };
  }

  const presenceDir = path.join(options.targetCommsDir, "presence");
  const archiveDir =
    options.archiveDir ??
    defaultCleanupArchiveDir(options.targetCommsDir, options.now);
  const keep = new Set(options.keepAgents.map(normalizeAddress));
  const nowMs = options.now.getTime();
  const candidates: StalePresenceCandidate[] = [];
  const keptFresh: string[] = [];
  const entries: Array<{
    identityKey: string;
    fullPath: string;
    record: Record<string, unknown> | null;
    invalid: boolean;
    agent: string;
    keys: string[];
    classified: ReturnType<typeof classifyPresenceRecord> | null;
  }> = [];
  if (fs.existsSync(presenceDir)) {
    for (const filename of fs.readdirSync(presenceDir).sort()) {
      if (!filename.endsWith(".json")) continue;
      const fullPath = path.join(presenceDir, filename);
      const identityKey = filename.replace(/\.json$/i, "");
      let record: Record<string, unknown> | null = null;
      let invalid = false;
      try {
        record = JSON.parse(fs.readFileSync(fullPath, "utf8")) as Record<
          string,
          unknown
        >;
      } catch {
        invalid = true;
      }
      const agent = presenceRecordAgent(filename, record);
      entries.push({
        identityKey,
        fullPath,
        record,
        invalid,
        agent,
        keys: presenceRecordKeys(filename, record, agent),
        classified:
          !invalid && record
            ? classifyPresenceRecord(
                record,
                nowMs,
                options.freshMinutes,
                options.pollingFreshMinutes,
              )
            : null,
      });
    }
  }

  const freshKeptKeys = new Set<string>();
  for (const entry of entries) {
    if (!entry.classified || entry.classified.freshness === "stale-visible") {
      continue;
    }
    for (const key of entry.keys) {
      if (keep.has(key)) freshKeptKeys.add(key);
    }
  }

  for (const entry of entries) {
    const matchesKeptLane = entry.keys.some((key) => keep.has(key));
    if (matchesKeptLane && !entry.classified) continue;
    const hasFreshKeptReplacement = entry.keys.some((key) =>
      freshKeptKeys.has(key),
    );
    const identityIsKeptLane = keep.has(normalizeAddress(entry.identityKey));
    if (
      matchesKeptLane &&
      !identityIsKeptLane &&
      hasFreshKeptReplacement &&
      entry.classified
    ) {
      if (entry.classified.freshness !== "stale-visible") {
        keptFresh.push(entry.agent);
        continue;
      }
      candidates.push({
        agent: entry.identityKey,
        path: entry.fullPath,
        freshness: entry.classified.freshness,
        ageSeconds: entry.classified.ageSeconds,
        reason: `presence is a stale duplicate for kept lane agent ${entry.agent}; fresh kept presence exists`,
      });
      continue;
    }
    if (matchesKeptLane) continue;
    if (entry.invalid) {
      candidates.push({
        agent: entry.agent,
        path: entry.fullPath,
        freshness: "unknown",
        ageSeconds: null,
        reason: "presence JSON is invalid and the agent is not a kept lane",
      });
      continue;
    }
    if (!entry.classified) continue;
    if (entry.classified.freshness !== "stale-visible") {
      keptFresh.push(entry.agent);
      continue;
    }
    candidates.push({
      agent: entry.identityKey,
      path: entry.fullPath,
      freshness: entry.classified.freshness,
      ageSeconds: entry.classified.ageSeconds,
      reason: "presence is stale/signing-off and the agent is not a kept lane",
    });
  }

  const result: StalePresenceCleanup = {
    status: candidates.length ? "needs-cleanup" : "ready",
    targetCommsDir: options.targetCommsDir,
    archiveDir,
    manifestPath: candidates.length
      ? path.join(archiveDir, "manifest.json")
      : null,
    candidates,
    archived: [],
    prunedHeartbeats: [],
    keptFresh,
    applied: false,
    message: candidates.length
      ? `${candidates.length} stale central presence record(s) can be archived safely with a manifest.`
      : "No stale non-lane or duplicate central presence cleanup candidates were found.",
  };

  if (!options.apply || candidates.length === 0) return result;

  fs.mkdirSync(archiveDir, { recursive: true });
  const archived: string[] = [];
  for (const candidate of candidates) {
    const target = path.join(archiveDir, path.basename(candidate.path));
    fs.copyFileSync(candidate.path, target);
    fs.unlinkSync(candidate.path);
    archived.push(target);
  }

  const heartbeatsPath = path.join(options.targetCommsDir, "heartbeats.json");
  const prunedHeartbeats: string[] = [];
  const heartbeats = readJsonFile(heartbeatsPath);
  if (heartbeats) {
    const candidateAgents = new Set(
      candidates.map((candidate) => normalizeAddress(candidate.agent)),
    );
    let changed = false;
    for (const [key, raw] of Object.entries(heartbeats)) {
      if (!candidateAgents.has(normalizeAddress(key))) continue;
      const record = recordValue(raw);
      const recordTime = heartbeatActivityMs(record);
      const stale =
        recordTime === null ||
        nowMs - recordTime >
          presenceFreshnessWindowMinutes(
            unique([
              ...stringArray(record?.receiveTransports),
              ...stringArray(
                recordValue(record?.capabilities)?.receiveTransports,
              ),
            ]),
            options.freshMinutes,
            options.pollingFreshMinutes,
          ) *
            60_000;
      if (!stale) continue;
      delete heartbeats[key];
      prunedHeartbeats.push(key);
      changed = true;
    }
    if (changed) {
      fs.writeFileSync(
        heartbeatsPath,
        `${JSON.stringify(heartbeats, null, 2)}\n`,
        "utf8",
      );
    }
  }

  const manifest = {
    schemaVersion: 1,
    generatedAt: options.now.toISOString(),
    targetCommsDir: options.targetCommsDir,
    archiveDir,
    candidates,
    archived,
    prunedHeartbeats,
    keptFresh,
    safety:
      "Archived only stale non-lane or duplicate presence records; inbox/archive evidence and fresh/live presence records were not removed.",
  };
  fs.writeFileSync(
    path.join(archiveDir, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );

  return {
    ...result,
    status: "applied",
    manifestPath: path.join(archiveDir, "manifest.json"),
    archived,
    prunedHeartbeats,
    applied: true,
    message: `Archived ${archived.length} stale presence record(s) and pruned ${prunedHeartbeats.length} stale heartbeat entr${prunedHeartbeats.length === 1 ? "y" : "ies"}.`,
  };
}

function inferCurrentHost(cwd: string): LaneDiagnostics["currentHost"] {
  void cwd;
  return process.env.TAP_PROFILE_HOST?.trim() || "unknown";
}

function supervisorHostMatches(
  supervisor: FlowSupervisorConfig,
  currentHost: LaneDiagnostics["currentHost"],
): boolean {
  if (supervisor.host === "local") return true;
  return supervisor.host === currentHost;
}

function tmuxSessionStatus(tmuxSession: string): FlowSupervisorStatus {
  try {
    execFileSync("tmux", ["has-session", "-t", tmuxSession], {
      stdio: "ignore",
    });
    return "running";
  } catch (error) {
    const status = (error as { status?: number }).status;
    return status === 1 ? "stopped" : "not-observed";
  }
}

function buildFlowSupervisorChecks(options: {
  profile: ProfileConfig | null;
  currentHost: LaneDiagnostics["currentHost"];
}): FlowSupervisorCheck[] {
  if (!options.profile || options.profile.kind !== "codex-cli") return [];
  const profile = options.profile as CliProfileConfig;
  return (profile.flowSupervisors ?? []).map((supervisor) => {
    if (!supervisorHostMatches(supervisor, options.currentHost)) {
      return {
        id: supervisor.id,
        label: supervisor.label,
        host: supervisor.host,
        tmuxSession: supervisor.tmuxSession,
        status: "wrong-host",
        statusCommand: supervisor.statusCommand,
        startCommand: supervisor.startCommand,
        nextAction: supervisor.statusCommand,
        message: `Inspect this supervisor on ${supervisor.host}; current host is ${options.currentHost}.`,
      };
    }
    const status = tmuxSessionStatus(supervisor.tmuxSession);
    return {
      id: supervisor.id,
      label: supervisor.label,
      host: supervisor.host,
      tmuxSession: supervisor.tmuxSession,
      status,
      statusCommand: supervisor.statusCommand,
      startCommand: supervisor.startCommand,
      nextAction:
        status === "running"
          ? supervisor.statusCommand
          : supervisor.statusCommand,
      message:
        status === "running"
          ? "Supervisor tmux session is running on the expected host."
          : status === "stopped"
            ? "Supervisor tmux session is stopped; inspect before any explicit start."
            : "Supervisor status could not be observed; inspect the configured status command.",
    };
  });
}

function laneStatus(options: {
  sourcePresence: PresenceCheck;
  targetPresence: PresenceCheck;
  cleanup: StalePresenceCleanup;
  flowSupervisors: FlowSupervisorCheck[];
  activeTurn: ActiveTurnSummary;
}): LaneStatus {
  if (
    options.sourcePresence.freshness === "unknown" ||
    options.targetPresence.freshness === "unknown"
  ) {
    return "blocked";
  }
  if (
    !options.sourcePresence.exists ||
    !options.targetPresence.exists ||
    !options.sourcePresence.freshForRouting ||
    !options.targetPresence.freshForRouting ||
    options.cleanup.status === "needs-cleanup" ||
    options.flowSupervisors.some(
      (supervisor) => supervisor.status !== "running",
    ) ||
    options.activeTurn.status === "active" ||
    options.activeTurn.status === "stale-active-turn"
  ) {
    return "warn";
  }
  return "ready";
}

function isPollingVisible(presence: PresenceCheck): boolean {
  return (
    presence.exists &&
    presence.freshness === "visible" &&
    (presence.receiveTransports.includes("polling") ||
      presence.receiveTransports.includes("mcp-channel"))
  );
}

function presenceIdentityValues(record: Record<string, unknown>): string[] {
  const address = recordValue(record.address);
  return unique(
    [
      stringValue(record.agent),
      stringValue(record.name),
      stringValue(record.agentName),
      stringValue(record.routingAddress),
      stringValue(record.id),
      stringValue(address?.routingAddress),
    ].filter((value): value is string => Boolean(value)),
  );
}

function presenceIdentityMatchesAliases(
  record: Record<string, unknown>,
  aliases: string[],
): boolean {
  const expected = new Set(aliases.map(normalizeAddress));
  const identityValues = presenceIdentityValues(record);
  return (
    identityValues.length > 0 &&
    identityValues.every((value) => expected.has(normalizeAddress(value)))
  );
}

function buildPollingPresencePublish(options: {
  sourcePresence: PresenceCheck;
  targetPresence: PresenceCheck;
  aliases: string[];
  apply: boolean;
}): PollingPresencePublish {
  const sourcePath = options.sourcePresence.path || null;
  const targetPath = options.targetPresence.path || null;
  if (!targetPath) {
    return {
      status: "not-configured",
      sourcePath,
      targetPath: null,
      applied: false,
      message:
        "No presence target comms dir configured; guarded polling presence publish is not available.",
      error: "presence target comms dir not configured",
    };
  }
  if (
    options.targetPresence.freshForRouting ||
    isPollingVisible(options.targetPresence)
  ) {
    return {
      status: "ready",
      sourcePath,
      targetPath,
      applied: false,
      message:
        "Central target presence is already current for live routing or polling visibility.",
      error: null,
    };
  }
  if (!isPollingVisible(options.sourcePresence)) {
    return {
      status: "blocked",
      sourcePath,
      targetPath,
      applied: false,
      message:
        "Source presence is not a fresh polling/mcp visibility record; warm the target runtime before publishing.",
      error: "source presence is not fresh polling visibility",
    };
  }
  if (!sourcePath || !fs.existsSync(sourcePath)) {
    return {
      status: "blocked",
      sourcePath,
      targetPath,
      applied: false,
      message:
        "Source presence file is missing; guarded polling presence publish stayed fail-closed.",
      error: "source presence file missing",
    };
  }

  const sourceRecord = readJsonFile(sourcePath);
  if (!sourceRecord) {
    return {
      status: "blocked",
      sourcePath,
      targetPath,
      applied: false,
      message:
        "Source presence JSON is invalid; guarded polling presence publish stayed fail-closed.",
      error: "invalid source presence JSON",
    };
  }
  if (!presenceIdentityMatchesAliases(sourceRecord, options.aliases)) {
    return {
      status: "blocked",
      sourcePath,
      targetPath,
      applied: false,
      message:
        "Source presence identity does not match the requested lane; guarded polling presence publish stayed fail-closed.",
      error: "source presence identity mismatch",
    };
  }

  if (!options.apply) {
    return {
      status: "needs-publish",
      sourcePath,
      targetPath,
      applied: false,
      message:
        "Source polling visibility can be published to the central presence file with guarded apply; heartbeats.json will not be synced.",
      error: null,
    };
  }

  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.copyFileSync(sourcePath, targetPath);
  return {
    status: "applied",
    sourcePath,
    targetPath,
    applied: true,
    message:
      "Copied the fresh polling source presence record to central presence only; heartbeats.json was not synced.",
    error: null,
  };
}

function evidenceReason(
  presence: EvidencePresence,
  eligibility: ReturnEligibility,
): string {
  if (eligibility === "notFromAgent") {
    return "Return uplink own-source filter would skip this record for the expected agent.";
  }
  if (eligibility === "inbound") {
    return "Projected inbound receiver evidence is not eligible for return-uplink registration and is not a return blocker.";
  }
  if (eligibility === "collision") {
    return "Source and target evidence paths both exist with different content.";
  }
  if (presence === "both") {
    return "Source and target evidence are already registered with matching content.";
  }
  if (presence === "target-only") {
    return "Target evidence exists without a matching source record in this scan window.";
  }
  return "Source evidence is eligible for explicit return-uplink registration.";
}

function buildEvidenceRecords(options: {
  sourceCommsDir: string;
  targetCommsDir: string;
  dirs: UplinkDir[];
  aliases: string[];
  sinceMs: number | null;
  limit: number;
}): EvidenceRecord[] {
  const sourceFiles = listFiles(
    options.sourceCommsDir,
    options.dirs,
    options.sinceMs,
  );
  const targetFiles = listFiles(
    options.targetCommsDir,
    options.dirs,
    options.sinceMs,
  );
  const keys = new Set([...sourceFiles.keys(), ...targetFiles.keys()]);
  const records: EvidenceRecord[] = [];

  for (const relativePath of [...keys].sort()) {
    if (records.length >= options.limit) break;
    const source = sourceFiles.get(relativePath);
    const target = targetFiles.get(relativePath);
    const base = source ?? target;
    if (!base) continue;

    const metadata = parseMetadata(base.filename, base.content);
    let presence: EvidencePresence;
    if (source && target) {
      presence = sameFileContent(source.fullPath, target.fullPath)
        ? "both"
        : "collision";
    } else if (source) {
      presence = "source-only";
    } else {
      presence = "target-only";
    }

    let returnEligibility: ReturnEligibility;
    if (presence === "target-only") {
      returnEligibility = "target-only";
    } else if (presence === "collision") {
      returnEligibility = "collision";
    } else if (presence === "both") {
      returnEligibility = "target-exists";
    } else if (
      requiresOwnSource(base.dir) &&
      !isOwnSource(metadata, options.aliases)
    ) {
      returnEligibility = matchesAlias(metadata.to, options.aliases)
        ? "inbound"
        : "notFromAgent";
    } else {
      returnEligibility = "eligible";
    }

    records.push({
      dir: base.dir,
      filename: base.filename,
      relativePath,
      sourcePath: source?.fullPath ?? null,
      targetPath: target?.fullPath ?? null,
      from: metadata.from,
      fromName: metadata.fromName,
      to: metadata.to,
      subject: metadata.subject,
      messageId: metadata.messageId,
      presence,
      returnEligibility,
      reason: evidenceReason(presence, returnEligibility),
    });
  }

  return records;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function buildNextActions(options: {
  identityStatus: IdentityStatus;
  agent: string;
  sourceCommsDir: string;
  targetCommsDir: string | null;
  dirs: UplinkDir[];
  records: EvidenceRecord[];
  aliases: string[];
  lane: LaneDiagnostics;
  presenceSourceCommsDir: string;
  presenceTargetCommsDir: string | null;
  keepPresenceAgents: string[];
  freshMinutes: number;
  pollingFreshMinutes: number;
  cleanupArchiveDir: string | null;
}): FlowDoctorAction[] {
  const actions: FlowDoctorAction[] = [];
  if (options.identityStatus !== "ready") {
    actions.push({
      id: "repair-runtime-identity",
      label:
        "Repair runtime identity before sending or registering review evidence",
      reason:
        "Return-uplink review evidence should be authored by the lane identity; broad unknown sender uplink remains blocked.",
      risk: "identity-repair",
    });
  }

  if (
    options.records.some(
      (record) => record.returnEligibility === "notFromAgent",
    )
  ) {
    actions.push({
      id: "review-not-from-agent",
      label:
        "Review skipped return evidence and reissue from the expected identity or use a reviewed registration path",
      reason:
        "The own-source filter is protecting inbox/reviews from projected inbound or unknown-authored records.",
      risk: "manual",
    });
  }

  if (
    options.records.some((record) => record.returnEligibility === "collision")
  ) {
    actions.push({
      id: "review-uplink-collision",
      label: "Inspect source and target collision before any registration",
      reason:
        "Collision handling must stay fail-closed; do not overwrite target evidence automatically.",
      risk: "manual",
    });
  }

  if (
    options.targetCommsDir &&
    options.records.some((record) => record.returnEligibility === "eligible")
  ) {
    actions.push({
      id: "run-return-uplink-check",
      label: "Run an explicit dry-run return-uplink check for eligible records",
      command: [
        "tap uplink check",
        `--agent ${shellQuote(options.agent)}`,
        `--source-comms-dir ${shellQuote(options.sourceCommsDir)}`,
        `--target-comms-dir ${shellQuote(options.targetCommsDir)}`,
        `--dir ${options.dirs.join(",")}`,
        "--json",
      ].join(" "),
      reason:
        "Use the existing uplink dry-run before applying any append-only return evidence registration.",
      risk: "read-only",
    });
  }

  if (options.lane.status !== "not-configured") {
    const sourcePollingVisible = isPollingVisible(options.lane.presence.source);
    const targetPollingVisible = isPollingVisible(options.lane.presence.target);
    const sourceAbsentOrStale =
      !options.lane.presence.source.exists ||
      options.lane.presence.source.freshness === "stale-visible";
    const targetAbsentOrStale =
      !options.lane.presence.target.exists ||
      options.lane.presence.target.freshness === "stale-visible";
    if (
      !options.lane.presence.source.freshForRouting &&
      !sourcePollingVisible
    ) {
      actions.push({
        id: "warm-target-runtime",
        label: "Warm the target runtime before publishing presence",
        reason:
          "Guarded presence publish must stay fail-closed until source presence is fresh-for-routing.",
        risk: "manual",
      });
      if (sourceAbsentOrStale && targetAbsentOrStale) {
        actions.push({
          id: "retire-absent-runtime",
          label:
            "Record runtime retirement or absence instead of publishing stale presence",
          reason:
            "Both source and central presence are missing or stale; choose an explicit retirement note if this lane is no longer expected.",
          risk: "manual",
        });
      }
    } else if (
      options.presenceTargetCommsDir &&
      !options.lane.presence.target.freshForRouting &&
      !targetPollingVisible
    ) {
      if (options.lane.presence.source.freshForRouting) {
        actions.push({
          id: "publish-fresh-presence",
          label: "Publish fresh source presence into the central comms bus",
          reason:
            "The source presence is fresh-for-routing, but the central target is missing or stale. Use the reviewed presence publish runbook or repo-local helper for this host; no packaged tap subcommand is emitted here.",
          risk: "manual",
        });
      } else if (
        sourcePollingVisible &&
        options.lane.pollingPresencePublish.status !== "blocked"
      ) {
        const publishArgs = [
          "tap flow-doctor",
          `--agent ${shellQuote(options.agent)}`,
          ...options.aliases
            .filter(
              (alias) =>
                normalizeAddress(alias) !== normalizeAddress(options.agent),
            )
            .map((alias) => `--alias ${shellQuote(alias)}`),
          `--source-comms-dir ${shellQuote(options.sourceCommsDir)}`,
          options.targetCommsDir
            ? `--target-comms-dir ${shellQuote(options.targetCommsDir)}`
            : null,
          `--presence-source-comms-dir ${shellQuote(options.presenceSourceCommsDir)}`,
          `--presence-target-comms-dir ${shellQuote(options.presenceTargetCommsDir)}`,
          options.freshMinutes === DEFAULT_LIVE_PRESENCE_FRESH_MINUTES
            ? null
            : `--fresh-minutes ${options.freshMinutes}`,
          options.pollingFreshMinutes === DEFAULT_POLLING_PRESENCE_FRESH_MINUTES
            ? null
            : `--polling-fresh-minutes ${options.pollingFreshMinutes}`,
          "--apply-polling-presence-publish",
          "--json",
        ].filter((part): part is string => Boolean(part));
        actions.push({
          id: "publish-guarded-polling-presence",
          label:
            "Publish guarded polling visibility into the central comms bus",
          command: publishArgs.join(" "),
          reason:
            "The source polling lane is visible within the polling window, but central visibility is missing or stale. This apply path copies only the guarded presence record; it does not sync heartbeats wholesale or claim consent-drive live delivery.",
          risk: "safe-publish",
        });
      }
    } else if (sourcePollingVisible && targetPollingVisible) {
      actions.push({
        id: "accept-durable-inbox-only-fallback",
        label:
          "Treat the polling lane as durable inbox/projection visible, not live consent-drive ready",
        reason:
          "Both source and central presence are current for polling visibility. This supports inbox/projection delivery but is not consent-drive live authority.",
        risk: "read-only",
      });
    }

    if (options.lane.stalePresence.status === "needs-cleanup") {
      const extraKeepAgents = options.keepPresenceAgents.filter(
        (keepAgent) =>
          normalizeAddress(keepAgent) !== normalizeAddress(options.agent),
      );
      const cleanupArgs = [
        "tap flow-doctor",
        `--agent ${shellQuote(options.agent)}`,
        ...options.aliases
          .filter(
            (alias) =>
              normalizeAddress(alias) !== normalizeAddress(options.agent),
          )
          .map((alias) => `--alias ${shellQuote(alias)}`),
        `--source-comms-dir ${shellQuote(options.sourceCommsDir)}`,
        options.targetCommsDir
          ? `--target-comms-dir ${shellQuote(options.targetCommsDir)}`
          : null,
        `--presence-source-comms-dir ${shellQuote(options.presenceSourceCommsDir)}`,
        options.presenceTargetCommsDir
          ? `--presence-target-comms-dir ${shellQuote(options.presenceTargetCommsDir)}`
          : null,
        ...extraKeepAgents.map(
          (keepAgent) => `--keep-presence-agent ${shellQuote(keepAgent)}`,
        ),
        options.freshMinutes === DEFAULT_LIVE_PRESENCE_FRESH_MINUTES
          ? null
          : `--fresh-minutes ${options.freshMinutes}`,
        options.pollingFreshMinutes === DEFAULT_POLLING_PRESENCE_FRESH_MINUTES
          ? null
          : `--polling-fresh-minutes ${options.pollingFreshMinutes}`,
        options.cleanupArchiveDir
          ? `--cleanup-archive-dir ${shellQuote(options.cleanupArchiveDir)}`
          : null,
        "--apply-stale-presence-cleanup",
        "--json",
      ].filter((part): part is string => Boolean(part));
      actions.push({
        id: "archive-stale-presence",
        label:
          "Archive stale non-lane central presence records with a manifest",
        command: cleanupArgs.join(" "),
        reason:
          "Only stale non-lane presence records are eligible; inbox/archive evidence and fresh records remain untouched.",
        risk: "safe-archive",
      });
    }

    for (const supervisor of options.lane.flowSupervisors) {
      if (supervisor.status === "wrong-host") {
        actions.push({
          id: `inspect-${supervisor.id}-on-${supervisor.host}`,
          label: `Inspect ${supervisor.label} on ${supervisor.host}`,
          command: supervisor.statusCommand,
          reason:
            "Flow-supervisor status must be checked on the host that owns the tmux session and path layout.",
          risk: "read-only",
        });
      } else if (supervisor.status !== "running") {
        actions.push({
          id: `inspect-${supervisor.id}`,
          label: `Inspect ${supervisor.label} before any manual start`,
          command: supervisor.statusCommand,
          reason:
            "The one-touch doctor does not start or restart processes; it only points at the reviewed status command.",
          risk: "read-only",
        });
      }
    }

    if (
      options.lane.activeTurn.status === "active" ||
      options.lane.activeTurn.status === "stale-active-turn"
    ) {
      actions.push({
        id: "wait-for-active-turn-idle",
        label:
          "Wait for the active turn to finish; keep receiver/promoter evidence queued",
        reason:
          "Active-turn state is a delivery safety gate, not permission to start a nested turn or default to steer.",
        risk: "manual",
      });
    }
  }

  if (!actions.length) {
    actions.push({
      id: "no-action-required",
      label: "No blocked return-uplink evidence found in this scan",
      reason:
        "Receiver and return-uplink evidence are either idle or already represented in both source and target.",
      risk: "read-only",
    });
  }

  return actions;
}

function identityStatus(
  agent: string,
  runtimeAgent: string | null,
): {
  status: IdentityStatus;
  message: string;
} {
  if (!runtimeAgent || normalizeAddress(runtimeAgent) === "unknown") {
    return {
      status: "unknown",
      message:
        "Runtime identity is unknown; review/tap reply writes may produce from: unknown and be skipped by return uplink.",
    };
  }
  if (normalizeAddress(runtimeAgent) !== normalizeAddress(agent)) {
    return {
      status: "drift",
      message: `Runtime identity is ${runtimeAgent}, but this lane expects ${agent}.`,
    };
  }
  return {
    status: "ready",
    message:
      "Runtime identity matches the expected return-uplink lane identity.",
  };
}

function reportStatus(options: {
  identity: IdentityStatus;
  returnUplinkStatus: RunLocalUplinkResult["status"] | "not-configured";
  records: EvidenceRecord[];
  laneStatus: LaneStatus;
}): FlowDoctorStatus {
  if (
    options.records.some((record) =>
      ["notFromAgent", "collision"].includes(record.returnEligibility),
    )
  ) {
    return "blocked";
  }
  if (options.identity !== "ready") return "warn";
  if (options.returnUplinkStatus === "blocked") return "blocked";
  if (options.laneStatus === "not-configured") {
    if (options.records.some((record) => record.presence === "source-only")) {
      return "warn";
    }
    return "ready";
  }
  if (options.laneStatus === "blocked") return "blocked";
  if (options.laneStatus === "warn") return "warn";
  if (options.records.some((record) => record.presence === "source-only")) {
    return "warn";
  }
  return "ready";
}

function renderHumanReport(report: FlowDoctorReport): void {
  logHeader("tap flow-doctor");
  log(`status=${report.status}; agent=${report.environment.agent}`);
  log(
    `identity=${report.identity.status}; runtimeAgent=${report.identity.runtimeAgent ?? "not-observed"}`,
  );
  log(
    `receiver=${report.receiver.status}; scanned=${report.receiver.scanned}; pending=${report.receiver.items.length}`,
  );
  log(
    `returnUplink=${report.returnUplink.status}; scanned=${report.returnUplink.scanned}; evidence=${report.returnUplink.evidence.length}`,
  );
  log(
    `lane=${report.lane.status}; profile=${report.lane.profile ?? "none"}; sourcePresence=${report.lane.presence.source.freshness}; targetPresence=${report.lane.presence.target.freshness}`,
  );
  if (report.lane.activeTurn.status !== "not-observed") {
    log(
      `activeTurn=${report.lane.activeTurn.status}; queued=${String(report.lane.activeTurn.queued)}; id=${report.lane.activeTurn.activeTurnId ?? "none"}`,
    );
  }
  for (const supervisor of report.lane.flowSupervisors) {
    log(
      `- supervisor ${supervisor.id}: ${supervisor.status}; host=${supervisor.host}; ${supervisor.message}`,
    );
  }
  if (report.lane.stalePresence.candidates.length > 0) {
    log(
      `stalePresence=${report.lane.stalePresence.candidates.length}; archiveDir=${report.lane.stalePresence.archiveDir ?? "not-configured"}`,
    );
  }
  for (const record of report.returnUplink.evidence.slice(0, 10)) {
    log(
      `- ${record.relativePath}; presence=${record.presence}; eligibility=${record.returnEligibility}; from=${record.from ?? "unknown"}; to=${record.to ?? "unknown"}`,
    );
  }
  if (report.returnUplink.evidence.length > 10) {
    log(
      `... ${report.returnUplink.evidence.length - 10} more evidence record(s)`,
    );
  }
  log("nextActions:");
  for (const action of report.nextActions) {
    log(`- ${action.id}: ${action.label}`);
    if (action.command) log(`  ${action.command}`);
  }
}

export async function flowDoctorCommand(
  args: string[],
): Promise<CommandResult<FlowDoctorReport>> {
  const { flags } = parseArgs(args);
  if (flags.help || flags.h) {
    log(FLOW_DOCTOR_HELP);
    return {
      ok: true,
      command: "flow-doctor",
      code: "TAP_NO_OP",
      message: FLOW_DOCTOR_HELP,
      warnings: [],
      data: { help: FLOW_DOCTOR_HELP } as unknown as FlowDoctorReport,
    };
  }

  const repoRoot = findRepoRoot();
  const { config } = resolveConfig({}, repoRoot);
  const profilePackPath =
    typeof flags["profile-pack"] === "string"
      ? flags["profile-pack"].trim()
      : null;
  if (flags["profile-pack"] === true || profilePackPath === "") {
    return {
      ok: false,
      command: "flow-doctor",
      code: "TAP_INVALID_ARGUMENT",
      message: "Missing --profile-pack <path> value.",
      warnings: [],
      data: {} as FlowDoctorReport,
    };
  }
  const laneProfileId =
    stringFlag(flags, "lane-profile") ?? stringFlag(flags, "profile");
  let laneProfile: ProfileConfig | null = null;
  try {
    laneProfile = lookupLaneProfile(laneProfileId, profilePackPath);
  } catch (error) {
    return {
      ok: false,
      command: "flow-doctor",
      code: "TAP_INVALID_ARGUMENT",
      message: error instanceof Error ? error.message : String(error),
      warnings: [],
      data: {} as FlowDoctorReport,
    };
  }
  if (laneProfileId && !laneProfile) {
    return {
      ok: false,
      command: "flow-doctor",
      code: "TAP_INVALID_ARGUMENT",
      message: `Unknown --lane-profile: ${laneProfileId}.`,
      warnings: [],
      data: {} as FlowDoctorReport,
    };
  }
  const agent = stringFlag(flags, "agent") ?? laneProfile?.agent;
  if (!agent) {
    return {
      ok: false,
      command: "flow-doctor",
      code: "TAP_INVALID_ARGUMENT",
      message: "Missing --agent <name> or --lane-profile <id>.",
      warnings: [],
      data: {} as FlowDoctorReport,
    };
  }

  const sourceCommsDir = path.resolve(
    stringFlag(flags, "source-comms-dir") ??
      stringFlag(flags, "comms-dir") ??
      (laneProfile?.kind === "codex-cli" ? laneProfile.commsDir : null) ??
      config.commsDir,
  );
  const targetCommsDir = stringFlag(flags, "target-comms-dir");
  const resolvedTargetCommsDir = targetCommsDir
    ? path.resolve(targetCommsDir)
    : laneProfile?.kind === "codex-cli" && laneProfile.sshTarget
      ? path.resolve(config.commsDir)
      : null;
  const presenceSourceCommsDir = path.resolve(
    stringFlag(flags, "presence-source-comms-dir") ?? sourceCommsDir,
  );
  const presenceTargetCommsDir = stringFlag(flags, "presence-target-comms-dir");
  const resolvedPresenceTargetCommsDir = presenceTargetCommsDir
    ? path.resolve(presenceTargetCommsDir)
    : (resolvedTargetCommsDir ?? sourceCommsDir);
  const stateDir = path.resolve(
    stringFlag(flags, "state-dir") ?? config.stateDir,
  );
  const freshMinutes = toPositiveInteger(
    stringFlag(flags, "fresh-minutes"),
    DEFAULT_LIVE_PRESENCE_FRESH_MINUTES,
  );
  const pollingFreshMinutes = toPositiveInteger(
    stringFlag(flags, "polling-fresh-minutes"),
    DEFAULT_POLLING_PRESENCE_FRESH_MINUTES,
  );
  const dirs = normalizeDirs(stringFlag(flags, "dir"));
  const since = stringFlag(flags, "since");
  const all = booleanFlag(flags, "all");
  const applyStalePresenceCleanup = booleanFlag(
    flags,
    "apply-stale-presence-cleanup",
  );
  const applyPollingPresencePublish = booleanFlag(
    flags,
    "apply-polling-presence-publish",
  );
  const laneDiagnosticsEnabled = Boolean(
    laneProfile ||
      stringFlag(flags, "presence-source-comms-dir") ||
      stringFlag(flags, "presence-target-comms-dir") ||
      stringFlag(flags, "keep-presence-agent") ||
      stringFlag(flags, "keep-presence-agents") ||
      applyPollingPresencePublish ||
      applyStalePresenceCleanup,
  );
  const cleanupArchiveDir = stringFlag(flags, "cleanup-archive-dir")
    ? path.resolve(stringFlag(flags, "cleanup-archive-dir") as string)
    : null;
  const limit = Math.max(
    1,
    Math.min(500, Number(stringFlag(flags, "limit") ?? 100)),
  );
  const aliasValues = splitRepeatedValues(
    repeatedStringFlags(args, ["alias", "aliases"]),
  );
  const aliases = unique([agent, ...aliasValues]);
  const keepPresenceAgents = unique([
    agent,
    ...aliasValues,
    ...splitRepeatedValues(
      repeatedStringFlags(args, [
        "keep-presence-agent",
        "keep-presence-agents",
      ]),
    ),
  ]);
  const runtimeAgent =
    stringFlag(flags, "runtime-agent") ??
    process.env.CODEX_TAP_AGENT_NAME ??
    process.env.TAP_AGENT_NAME ??
    null;
  const identity = identityStatus(agent, runtimeAgent);

  const receiver = await runPollingReceiver({
    mode: "check",
    commsDir: sourceCommsDir,
    stateDir,
    agent,
    aliases,
    all,
    since,
    limit,
    now: new Date(),
  });

  let uplink: RunLocalUplinkResult | null = null;
  const warnings: string[] = [...receiver.warnings];
  if (resolvedTargetCommsDir) {
    if (path.resolve(resolvedTargetCommsDir) === path.resolve(sourceCommsDir)) {
      warnings.push(
        "Skipped return-uplink dry-run because source and target comms dirs are identical.",
      );
    } else {
      uplink = await runLocalUplink({
        mode: "check",
        sourceCommsDir,
        targetCommsDir: resolvedTargetCommsDir,
        stateDir,
        agent,
        aliases,
        dirs,
        all,
        since,
        limit,
        now: new Date(),
      });
      warnings.push(...uplink.warnings);
    }
  } else {
    warnings.push(
      "No --target-comms-dir provided; return-uplink registration presence is not fully comparable.",
    );
  }

  const returnUplinkStatus = uplink?.status ?? "not-configured";
  const evidenceSinceMs = all
    ? null
    : since
      ? parseSinceMs(since)
      : uplink?.effectiveSince
        ? Date.parse(uplink.effectiveSince)
        : null;
  const records = resolvedTargetCommsDir
    ? buildEvidenceRecords({
        sourceCommsDir,
        targetCommsDir: resolvedTargetCommsDir,
        dirs,
        aliases,
        sinceMs: Number.isFinite(evidenceSinceMs) ? evidenceSinceMs : null,
        limit,
      })
    : [];
  const now = new Date();
  const nowMs = now.getTime();
  const sourcePresence = laneDiagnosticsEnabled
    ? buildPresenceCheck({
        role: "source",
        commsDir: presenceSourceCommsDir,
        agent,
        nowMs,
        freshMinutes,
        pollingFreshMinutes,
      })
    : notConfiguredPresenceCheck("source", agent);
  let targetPresence = laneDiagnosticsEnabled
    ? buildPresenceCheck({
        role: "target",
        commsDir: resolvedPresenceTargetCommsDir,
        agent,
        nowMs,
        freshMinutes,
        pollingFreshMinutes,
      })
    : notConfiguredPresenceCheck("target", agent);
  const pollingPresencePublish: PollingPresencePublish = laneDiagnosticsEnabled
    ? buildPollingPresencePublish({
        sourcePresence,
        targetPresence,
        aliases,
        apply: applyPollingPresencePublish,
      })
    : {
        status: "not-configured",
        sourcePath: null,
        targetPath: null,
        applied: false,
        message:
          "Pass --lane-profile or presence flags to enable guarded polling presence publish diagnostics.",
        error: "lane presence diagnostics not configured",
      };
  if (pollingPresencePublish.applied) {
    targetPresence = buildPresenceCheck({
      role: "target",
      commsDir: resolvedPresenceTargetCommsDir,
      agent,
      nowMs,
      freshMinutes,
      pollingFreshMinutes,
    });
  }
  const stalePresence: StalePresenceCleanup = laneDiagnosticsEnabled
    ? buildStalePresenceCleanup({
        targetCommsDir: resolvedPresenceTargetCommsDir,
        keepAgents: keepPresenceAgents,
        now,
        freshMinutes,
        pollingFreshMinutes,
        apply: applyStalePresenceCleanup,
        archiveDir: cleanupArchiveDir,
      })
    : {
        status: "not-configured",
        targetCommsDir: null,
        archiveDir: null,
        manifestPath: null,
        candidates: [],
        archived: [],
        prunedHeartbeats: [],
        keptFresh: [],
        applied: false,
        message:
          "Pass --lane-profile or presence flags to enable stale presence cleanup diagnostics.",
      };
  const currentHost = inferCurrentHost(process.cwd());
  const flowSupervisors = laneDiagnosticsEnabled
    ? buildFlowSupervisorChecks({
        profile: laneProfile,
        currentHost,
      })
    : [];
  const activeTurn: ActiveTurnSummary = laneDiagnosticsEnabled
    ? buildActiveTurnSummary({
        commsDir: sourceCommsDir,
        aliases,
        nowMs,
        freshMinutes,
      })
    : {
        status: "not-observed",
        queued: null,
        blocked: null,
        activeTurnId: null,
        ageSeconds: null,
        message:
          "Pass --lane-profile or presence flags to enable active-turn lane diagnostics.",
      };
  const lane: LaneDiagnostics = {
    status: laneDiagnosticsEnabled
      ? laneStatus({
          sourcePresence,
          targetPresence,
          cleanup: stalePresence,
          flowSupervisors,
          activeTurn,
        })
      : "not-configured",
    profile: laneProfile?.id ?? null,
    currentHost,
    presence: {
      source: sourcePresence,
      target: targetPresence,
    },
    pollingPresencePublish,
    stalePresence,
    flowSupervisors,
    activeTurn,
  };
  const status = reportStatus({
    identity: identity.status,
    returnUplinkStatus,
    records,
    laneStatus: lane.status,
  });
  const nextActions = buildNextActions({
    identityStatus: identity.status,
    agent,
    sourceCommsDir,
    targetCommsDir: resolvedTargetCommsDir,
    dirs,
    records,
    aliases,
    lane,
    presenceSourceCommsDir,
    presenceTargetCommsDir: resolvedPresenceTargetCommsDir,
    keepPresenceAgents,
    freshMinutes,
    pollingFreshMinutes,
    cleanupArchiveDir,
  });
  const blockedCount = records.filter((record) =>
    ["notFromAgent", "collision"].includes(record.returnEligibility),
  ).length;

  const report: FlowDoctorReport = {
    command: "flow-doctor",
    status,
    generatedAt: new Date().toISOString(),
    summary:
      blockedCount > 0
        ? `Return-uplink has ${blockedCount} blocked evidence record(s) while receiver status is ${receiver.status}.`
        : `Receiver status is ${receiver.status}; return-uplink status is ${returnUplinkStatus}.`,
    environment: {
      cwd: process.cwd(),
      repoRoot,
      sourceCommsDir,
      targetCommsDir: resolvedTargetCommsDir,
      stateDir,
      agent,
      aliases,
      dirs,
      since: since ?? null,
      all,
      laneProfile: laneProfile?.id ?? laneProfileId ?? null,
      freshMinutes,
      pollingFreshMinutes,
      presenceSourceCommsDir,
      presenceTargetCommsDir: resolvedPresenceTargetCommsDir,
      applyStalePresenceCleanup,
      applyPollingPresencePublish,
    },
    identity: {
      expectedAgent: agent,
      runtimeAgent,
      status: identity.status,
      message: identity.message,
    },
    receiver: {
      status: receiver.status,
      scanned: receiver.scanned,
      skipped: receiver.skipped,
      activeTurn: {
        status: activeTurn.status,
        queued: activeTurn.queued,
        blocked: activeTurn.blocked,
        activeTurnId: activeTurn.activeTurnId,
        ageSeconds: activeTurn.ageSeconds,
        message: activeTurn.message,
      },
      items: receiver.items.map((item) => ({
        filename: item.filename,
        from: item.from,
        to: item.to,
        subject: item.subject,
        messageId: item.messageId,
      })),
      evidence:
        receiver.status === "pending"
          ? "Receiver/promoter source evidence is visible in the local inbox dry-run."
          : "No receiver/promoter inbox item is pending in this scan window.",
    },
    returnUplink: {
      status: returnUplinkStatus,
      scanned: uplink?.scanned ?? records.length,
      skipped: uplink?.skipped ?? {
        old: 0,
        duplicate: 0,
        notFromAgent: 0,
        disallowed: 0,
      },
      items:
        uplink?.items.map((item) => ({
          relativePath: item.relativePath,
          from: item.from,
          to: item.to,
          subject: item.subject,
          skipReason: item.skipReason,
        })) ?? [],
      evidence: records,
    },
    lane,
    nextActions,
  };

  renderHumanReport(report);

  return {
    ok: status !== "blocked",
    command: "flow-doctor",
    code: "TAP_FLOW_DOCTOR_OK",
    message:
      status === "blocked"
        ? "Return-uplink evidence flow has blocked records; review nextActions before mutation."
        : "Return-uplink evidence flow diagnostic completed.",
    warnings,
    data: report,
  };
}
