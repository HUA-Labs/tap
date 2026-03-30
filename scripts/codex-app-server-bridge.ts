#!/usr/bin/env node --experimental-strip-types

import { createHash } from "crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import { isAbsolute, join, resolve } from "path";
import { pathToFileURL } from "url";

type BusyMode = "wait" | "steer";

interface Options {
  repoRoot: string;
  commsDir: string;
  agentId: string;
  agentName: string;
  stateDir: string;
  pollSeconds: number;
  reconnectSeconds: number;
  messageLookbackMinutes: number;
  processExistingMessages: boolean;
  dryRun: boolean;
  runOnce: boolean;
  waitAfterDispatchSeconds: number;
  appServerUrl: string;
  connectAppServerUrl: string;
  gatewayToken: string | null;
  gatewayTokenFile: string | null;
  busyMode: BusyMode;
  threadId: string | null;
  ephemeral: boolean;
}

interface InboxRoute {
  sender: string;
  recipient: string;
  subject: string;
}

interface Candidate {
  markerId: string;
  filePath: string;
  fileName: string;
  sender: string;
  recipient: string;
  subject: string;
  body: string;
  mtimeMs: number;
}

interface ThreadStateRecord {
  threadId: string;
  updatedAt: string;
  appServerUrl: string;
  ephemeral: boolean;
  cwd?: string | null;
}

interface HeartbeatRecord {
  pid: number;
  agent: string;
  updatedAt: string;
  pollSeconds: number;
  appServerUrl: string;
  connected: boolean;
  initialized: boolean;
  threadId: string | null;
  threadCwd?: string | null;
  activeTurnId: string | null;
  turnStartedAt: string | null;
  lastTurnStatus: string | null;
  lastNotificationMethod: string | null;
  lastNotificationAt: string | null;
  lastError: string | null;
  lastSuccessfulAppServerAt: string | null;
  lastSuccessfulAppServerMethod: string | null;
  consecutiveFailureCount: number;
  busyMode: BusyMode;
}

interface BridgeHealthState {
  consecutiveFailureCount: number;
}

export interface HeadlessWarmupClient {
  activeTurnId: string | null;
  lastTurnStatus: string | null;
  startTurn(inputText: string): Promise<string | null>;
  refreshCurrentThreadState(): Promise<void>;
}

export interface LoadedThreadCandidate {
  id: string;
  cwd: string;
  updatedAt: number;
  statusType: string | null;
  thread: any;
}

interface RequestRecord {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params: unknown;
}

interface HeartbeatStoreRecord {
  id?: string;
  agent?: string;
}

type HeartbeatStore = Record<string, HeartbeatStoreRecord>;

interface JsonRpcResponse {
  id?: number;
  result?: any;
  error?: {
    code?: number;
    message?: string;
    data?: unknown;
  };
  method?: string;
  params?: any;
}

const DEFAULT_AGENT = String.fromCharCode(0xc628);
const DEFAULT_APP_SERVER_URL = "ws://127.0.0.1:4501";
const AUTH_SUBPROTOCOL_PREFIX = "tap-auth-";
const PLACEHOLDER_AGENT_VALUES = new Set([
  "unknown",
  "unnamed",
  "<set-per-session>",
]);
export const HEADLESS_WARMUP_PROMPT = [
  "You are a tap worker agent connected via the tap-comms inbox.",
  "This is a one-time warmup turn for headless bridge startup.",
  "Do not take any external actions.",
  "Reply briefly, then wait for future inbox instructions.",
].join(" ");
const HEADLESS_WARMUP_TIMEOUT_MS = 30_000;
const TURN_COMPLETION_POLL_MS = 250;
const TURN_COMPLETION_REFRESH_MS = 1_000;

function normalizeThreadCwd(cwd: string): string {
  return resolve(cwd).replace(/\\/g, "/").toLowerCase();
}

export function threadCwdMatches(
  expectedCwd: string,
  actualCwd: string | null | undefined,
): boolean {
  if (!actualCwd) {
    return false;
  }

  return normalizeThreadCwd(expectedCwd) === normalizeThreadCwd(actualCwd);
}

export function chooseLoadedThreadForCwd(
  cwd: string,
  threads: LoadedThreadCandidate[],
): LoadedThreadCandidate | null {
  const matching = threads.filter((thread) =>
    threadCwdMatches(cwd, thread.cwd),
  );
  if (matching.length === 0) {
    return null;
  }

  matching.sort((left, right) => {
    const leftActive = left.statusType === "active" ? 1 : 0;
    const rightActive = right.statusType === "active" ? 1 : 0;
    if (leftActive !== rightActive) {
      return rightActive - leftActive;
    }
    return right.updatedAt - left.updatedAt;
  });

  return matching[0] ?? null;
}

function printHelp(): void {
  console.log(`Codex App Server bridge

Usage:
  node --experimental-strip-types scripts/codex-app-server-bridge.ts [options]

Options:
  --repo-root=<path>
  --comms-dir=<path>
  --agent-name=<name>
  --state-dir=<path>
  --poll-seconds=<n>
  --reconnect-seconds=<n>
  --message-lookback-minutes=<n>
  --process-existing-messages
  --dry-run
  --run-once
  --wait-after-dispatch-seconds=<n>
  --app-server-url=<ws-url>
  --gateway-token-file=<path>
  --busy-mode=wait|steer
  --thread-id=<id>
  --ephemeral
  --help
`);
}

function parseNumber(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Invalid ${flag}: ${value}`);
  }
  return parsed;
}

function readFlagValue(argv: string[], index: number, flag: string): string {
  const current = argv[index];
  const eqIndex = current.indexOf("=");
  if (eqIndex >= 0) {
    return current.slice(eqIndex + 1);
  }

  const next = argv[index + 1];
  if (!next || next.startsWith("--")) {
    throw new Error(`Missing value for ${flag}`);
  }
  return next;
}

function parseArgs(argv: string[]): {
  repoRoot?: string;
  commsDir?: string;
  agentName?: string;
  stateDir?: string;
  pollSeconds?: number;
  reconnectSeconds?: number;
  messageLookbackMinutes?: number;
  processExistingMessages: boolean;
  dryRun: boolean;
  runOnce: boolean;
  waitAfterDispatchSeconds?: number;
  appServerUrl?: string;
  gatewayTokenFile?: string;
  busyMode?: BusyMode;
  threadId?: string;
  ephemeral: boolean;
} {
  const parsed = {
    processExistingMessages: false,
    dryRun: false,
    runOnce: false,
    ephemeral: false,
  } as {
    repoRoot?: string;
    commsDir?: string;
    agentName?: string;
    stateDir?: string;
    pollSeconds?: number;
    reconnectSeconds?: number;
    messageLookbackMinutes?: number;
    processExistingMessages: boolean;
    dryRun: boolean;
    runOnce: boolean;
    waitAfterDispatchSeconds?: number;
    appServerUrl?: string;
    gatewayTokenFile?: string;
    busyMode?: BusyMode;
    threadId?: string;
    ephemeral: boolean;
  };

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const consumesNext = !flag.includes("=");

    if (flag === "--help") {
      printHelp();
      process.exit(0);
    }

    if (flag === "--process-existing-messages") {
      parsed.processExistingMessages = true;
      continue;
    }

    if (flag === "--dry-run") {
      parsed.dryRun = true;
      continue;
    }

    if (flag === "--run-once") {
      parsed.runOnce = true;
      continue;
    }

    if (flag === "--ephemeral") {
      parsed.ephemeral = true;
      continue;
    }

    if (flag.startsWith("--repo-root")) {
      parsed.repoRoot = readFlagValue(argv, index, "--repo-root");
      if (consumesNext) {
        index += 1;
      }
      continue;
    }

    if (flag.startsWith("--comms-dir")) {
      parsed.commsDir = readFlagValue(argv, index, "--comms-dir");
      if (consumesNext) {
        index += 1;
      }
      continue;
    }

    if (flag.startsWith("--agent-name")) {
      parsed.agentName = readFlagValue(argv, index, "--agent-name");
      if (consumesNext) {
        index += 1;
      }
      continue;
    }

    if (flag.startsWith("--state-dir")) {
      parsed.stateDir = readFlagValue(argv, index, "--state-dir");
      if (consumesNext) {
        index += 1;
      }
      continue;
    }

    if (flag.startsWith("--poll-seconds")) {
      parsed.pollSeconds = parseNumber(
        readFlagValue(argv, index, "--poll-seconds"),
        "--poll-seconds",
      );
      if (consumesNext) {
        index += 1;
      }
      continue;
    }

    if (flag.startsWith("--reconnect-seconds")) {
      parsed.reconnectSeconds = parseNumber(
        readFlagValue(argv, index, "--reconnect-seconds"),
        "--reconnect-seconds",
      );
      if (consumesNext) {
        index += 1;
      }
      continue;
    }

    if (flag.startsWith("--message-lookback-minutes")) {
      parsed.messageLookbackMinutes = parseNumber(
        readFlagValue(argv, index, "--message-lookback-minutes"),
        "--message-lookback-minutes",
      );
      if (consumesNext) {
        index += 1;
      }
      continue;
    }

    if (flag.startsWith("--app-server-url")) {
      parsed.appServerUrl = readFlagValue(argv, index, "--app-server-url");
      if (consumesNext) {
        index += 1;
      }
      continue;
    }

    if (flag.startsWith("--gateway-token-file")) {
      parsed.gatewayTokenFile = readFlagValue(
        argv,
        index,
        "--gateway-token-file",
      );
      if (consumesNext) {
        index += 1;
      }
      continue;
    }

    if (flag.startsWith("--wait-after-dispatch-seconds")) {
      parsed.waitAfterDispatchSeconds = parseNumber(
        readFlagValue(argv, index, "--wait-after-dispatch-seconds"),
        "--wait-after-dispatch-seconds",
      );
      if (consumesNext) {
        index += 1;
      }
      continue;
    }

    if (flag.startsWith("--busy-mode")) {
      const value = readFlagValue(argv, index, "--busy-mode");
      if (value !== "wait" && value !== "steer") {
        throw new Error(`Invalid --busy-mode: ${value}`);
      }
      parsed.busyMode = value;
      if (consumesNext) {
        index += 1;
      }
      continue;
    }

    if (flag.startsWith("--thread-id")) {
      parsed.threadId = readFlagValue(argv, index, "--thread-id");
      if (consumesNext) {
        index += 1;
      }
      continue;
    }

    throw new Error(`Unknown argument: ${flag}`);
  }

  return parsed;
}

function timestamp(): string {
  return new Date().toISOString().replace("T", " ").replace("Z", " UTC");
}

function logStatus(message: string): void {
  console.log(`[${timestamp()}] ${message}`);
}

function ensureDir(target: string): string {
  if (!existsSync(target)) {
    mkdirSync(target, { recursive: true });
  }
  return resolve(target);
}

function convertTapPath(input: string): string {
  const trimmed = input.trim().replace(/^["'`]+|["'`]+$/g, "");
  if (/^[A-Za-z]:\\/.test(trimmed)) {
    return trimmed;
  }

  const match = trimmed.match(/^\/([A-Za-z])\/(.*)$/);
  if (match) {
    return `${match[1].toUpperCase()}:\\${match[2].replace(/\//g, "\\")}`;
  }

  return trimmed;
}

function resolveRepoRoot(explicit?: string): string {
  if (explicit) {
    return resolve(explicit);
  }

  return process.cwd();
}

function resolveCommsDir(repoRoot: string, explicit?: string): string {
  if (explicit) {
    return resolve(convertTapPath(explicit));
  }

  const tapConfigPath = join(repoRoot, ".tap-config");
  if (!existsSync(tapConfigPath)) {
    throw new Error(
      "Unable to resolve comms directory. Pass --comms-dir explicitly.",
    );
  }

  const configText = readFileSync(tapConfigPath, "utf8");
  const match = configText.match(/^TAP_COMMS_DIR="?(.*?)"?$/m);
  if (!match?.[1]) {
    throw new Error(
      "Unable to resolve comms directory. Pass --comms-dir explicitly.",
    );
  }

  return resolveTapConfigPath(repoRoot, match[1]);
}

function resolvePreferredAgentName(requested?: string): string | null {
  if (requested?.trim()) {
    return requested.trim();
  }

  for (const envName of ["TAP_AGENT_NAME", "CODEX_TAP_AGENT_NAME"]) {
    const candidate = process.env[envName];
    if (candidate?.trim()) {
      return candidate.trim();
    }
  }

  return null;
}

function normalizeAgentToken(value?: string | null): string | null {
  const normalized = value?.trim();
  if (!normalized || PLACEHOLDER_AGENT_VALUES.has(normalized)) {
    return null;
  }

  return normalized.replace(/-/g, "_");
}

export function resolveAgentId(preferredAgentName?: string | null): string {
  return (
    normalizeAgentToken(process.env.TAP_AGENT_ID) ??
    normalizeAgentToken(preferredAgentName) ??
    "unknown"
  );
}

function sanitizeStateSegment(agentName: string): string {
  const normalized = agentName
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "-")
    .replace(/[. ]+$/g, "");

  return normalized || "agent";
}

function buildDefaultStateDir(
  repoRoot: string,
  preferredAgentName?: string | null,
): string {
  const suffix = preferredAgentName?.trim()
    ? `-${sanitizeStateSegment(preferredAgentName)}`
    : "";
  return resolve(join(repoRoot, ".tmp", `codex-app-server-bridge${suffix}`));
}

function resolveStateDir(
  repoRoot: string,
  explicit?: string,
  preferredAgentName?: string | null,
): string {
  const root = explicit
    ? resolve(explicit)
    : buildDefaultStateDir(repoRoot, preferredAgentName);

  ensureDir(root);
  ensureDir(join(root, "processed"));
  ensureDir(join(root, "logs"));
  return root;
}

function resolveAgentName(
  preferredAgentName: string | null,
  stateDir: string,
): string {
  if (preferredAgentName?.trim()) {
    return preferredAgentName.trim();
  }

  const agentFile = join(stateDir, "agent-name.txt");
  if (existsSync(agentFile)) {
    const candidate = readFileSync(agentFile, "utf8").trim();
    if (candidate) {
      return candidate;
    }
  }

  return DEFAULT_AGENT;
}

function persistAgentName(stateDir: string, agentName: string): void {
  writeFileSync(join(stateDir, "agent-name.txt"), `${agentName}\n`, "utf8");
}

// buildProtectedAppServerUrl removed — subprotocol auth replaces query-param tokens.

/**
 * Strip sensitive tokens from error messages before persisting to disk.
 * Catches: query-string tokens (?tap_token=...), subprotocol tokens (tap-auth-...),
 * and any base64url-like strings that look like auth tokens.
 */
function sanitizeErrorForPersistence(error: string | null): string | null {
  if (!error) return null;
  return error
    .replace(/([?&])tap_token=[^\s&)"'}]+/gi, "$1tap_token=***")
    .replace(/"tap_token"\s*:\s*"[^"]*"/g, '"tap_token":"***"')
    .replace(/tap-auth-[A-Za-z0-9_-]+/g, "tap-auth-***")
    .replace(/Bearer\s+[A-Za-z0-9_.-]+/gi, "Bearer ***");
}

function readGatewayTokenFile(tokenFile: string): string {
  const token = readFileSync(tokenFile, "utf8").trim();
  if (!token) {
    throw new Error(`Gateway token file is empty: ${tokenFile}`);
  }
  return token;
}

function resolveTapConfigPath(repoRoot: string, input: string): string {
  const converted = convertTapPath(input);
  return isAbsolute(converted)
    ? resolve(converted)
    : resolve(repoRoot, converted);
}

function readThreadState(stateDir: string): ThreadStateRecord | null {
  const threadPath = join(stateDir, "thread.json");
  if (!existsSync(threadPath)) {
    return null;
  }

  try {
    const parsed = JSON.parse(
      readFileSync(threadPath, "utf8"),
    ) as ThreadStateRecord;
    if (parsed.threadId) {
      return parsed;
    }
  } catch {
    return null;
  }

  return null;
}

function readHeartbeatState(stateDir: string): HeartbeatRecord | null {
  const heartbeatPath = join(stateDir, "heartbeat.json");
  if (!existsSync(heartbeatPath)) {
    return null;
  }

  try {
    return JSON.parse(readFileSync(heartbeatPath, "utf8")) as HeartbeatRecord;
  } catch {
    return null;
  }
}

function parseUpdatedAt(value?: string | null): number {
  if (!value) {
    return 0;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function appServerUrlMatches(
  expectedAppServerUrl: string,
  actualAppServerUrl?: string | null,
): boolean {
  return actualAppServerUrl?.trim() === expectedAppServerUrl;
}

function hasValidHeartbeatThreadCwd(
  threadCwd?: string | null,
): threadCwd is string {
  const normalized = threadCwd?.trim();
  if (!normalized) {
    return false;
  }

  return (
    isAbsolute(normalized) ||
    /^[A-Za-z]:[\\/]/.test(normalized) ||
    normalized.startsWith("\\\\")
  );
}

export function loadResumableThreadState(
  stateDir: string,
  fallbackAppServerUrl: string,
): ThreadStateRecord | null {
  const savedThread = readThreadState(stateDir);
  const heartbeat = readHeartbeatState(stateDir);
  const heartbeatThreadId = heartbeat?.threadId?.trim();

  if (!heartbeatThreadId) {
    return savedThread;
  }

  if (!appServerUrlMatches(fallbackAppServerUrl, heartbeat?.appServerUrl)) {
    return savedThread;
  }

  if (!hasValidHeartbeatThreadCwd(heartbeat?.threadCwd)) {
    return savedThread;
  }

  const heartbeatBackedThread: ThreadStateRecord = {
    threadId: heartbeatThreadId,
    updatedAt:
      heartbeat?.updatedAt ??
      savedThread?.updatedAt ??
      new Date().toISOString(),
    appServerUrl:
      heartbeat?.appServerUrl ||
      savedThread?.appServerUrl ||
      fallbackAppServerUrl,
    ephemeral: savedThread?.ephemeral ?? false,
    cwd:
      heartbeat?.threadCwd ??
      (savedThread?.threadId === heartbeatThreadId
        ? (savedThread.cwd ?? null)
        : null),
  };

  let preferred = savedThread;
  if (!savedThread?.threadId) {
    preferred = heartbeatBackedThread;
  } else if (savedThread.threadId === heartbeatThreadId) {
    preferred = {
      ...savedThread,
      updatedAt: heartbeatBackedThread.updatedAt ?? savedThread.updatedAt,
      appServerUrl: heartbeatBackedThread.appServerUrl,
      cwd: heartbeatBackedThread.cwd ?? savedThread.cwd ?? null,
    };
  } else if (
    parseUpdatedAt(heartbeat?.updatedAt) > parseUpdatedAt(savedThread.updatedAt)
  ) {
    preferred = heartbeatBackedThread;
  }

  return preferred;
}

function persistThreadState(
  stateDir: string,
  threadId: string,
  appServerUrl: string,
  ephemeral: boolean,
  cwd: string | null,
): void {
  const payload: ThreadStateRecord = {
    threadId,
    updatedAt: new Date().toISOString(),
    appServerUrl,
    ephemeral,
    cwd,
  };
  writeFileSync(
    join(stateDir, "thread.json"),
    `${JSON.stringify(payload, null, 2)}\n`,
    "utf8",
  );
}

function getGeneralInboxCutoff(
  stateDir: string,
  lookbackMinutes: number,
  processExistingMessages: boolean,
): Date {
  if (processExistingMessages) {
    return new Date(0);
  }

  if (lookbackMinutes > 0) {
    return new Date(Date.now() - lookbackMinutes * 60_000);
  }

  const cutoffPath = join(stateDir, "general-inbox-cutoff.txt");
  if (existsSync(cutoffPath)) {
    try {
      return new Date(readFileSync(cutoffPath, "utf8").trim());
    } catch {
      return new Date();
    }
  }

  const cutoff = new Date();
  writeFileSync(cutoffPath, `${cutoff.toISOString()}\n`, "utf8");
  return cutoff;
}

export function recipientMatchesAgent(
  recipient: string,
  agentId: string,
  agentName: string,
): boolean {
  const normalizedRecipient = recipient.trim();
  if (!normalizedRecipient) {
    return false;
  }
  const aliases = new Set([
    agentId.trim(),
    agentId.trim().replace(/-/g, "_"),
    agentId.trim().replace(/_/g, "-"),
    agentName.trim(),
    agentName.trim().replace(/-/g, "_"),
    agentName.trim().replace(/_/g, "-"),
  ]);

  return (
    normalizedRecipient === "전체" ||
    normalizedRecipient === "all" ||
    aliases.has(normalizedRecipient)
  );
}

export function isOwnMessageSender(
  sender: string,
  agentId: string,
  agentName: string,
): boolean {
  const normalizedSender = sender.trim();
  if (!normalizedSender) {
    return false;
  }
  const aliases = new Set([
    agentId.trim(),
    agentId.trim().replace(/-/g, "_"),
    agentId.trim().replace(/_/g, "-"),
    agentName.trim(),
    agentName.trim().replace(/-/g, "_"),
    agentName.trim().replace(/_/g, "-"),
  ]);

  return aliases.has(normalizedSender);
}

function decodeRouteSegment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function parseInboxFrontmatter(body?: string): InboxRoute | null {
  if (!body) {
    return null;
  }

  const frontmatter = body.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!frontmatter) {
    return null;
  }

  let sender = "";
  let recipient = "";
  let subject = "";

  for (const line of frontmatter[1].split(/\r?\n/)) {
    const separator = line.indexOf(":");
    if (separator <= 0) continue;

    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();

    if (key === "from") sender = value;
    if (key === "to") recipient = value;
    if (key === "subject") subject = value;
  }

  if (!sender || !recipient || !subject) {
    return null;
  }

  return { sender, recipient, subject };
}

function getInboxRoute(fileName: string, body?: string): InboxRoute {
  const frontmatterRoute = parseInboxFrontmatter(body);
  if (frontmatterRoute) {
    return frontmatterRoute;
  }

  const stem = fileName.replace(/\.md$/i, "");
  const parts = stem.split("-");
  let offset = 0;
  if (parts[0] && /^\d{8}$/.test(parts[0])) {
    offset = 1;
  }

  return {
    sender: decodeRouteSegment(parts[offset] ?? ""),
    recipient: decodeRouteSegment(parts[offset + 1] ?? ""),
    subject: decodeRouteSegment(parts.slice(offset + 2).join("-")),
  };
}

function buildMarkerId(filePath: string, mtimeMs: number): string {
  return createHash("sha1").update(`${filePath}|${mtimeMs}`).digest("hex");
}

function getProcessedMarkerPath(stateDir: string, markerId: string): string {
  return join(stateDir, "processed", `${markerId}.done`);
}

function loadHeartbeats(commsDir: string): HeartbeatStore {
  try {
    return JSON.parse(readFileSync(join(commsDir, "heartbeats.json"), "utf8"));
  } catch {
    return {};
  }
}

function formatAgentLabel(
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

export function resolveAddressLabel(
  address: string,
  heartbeats: HeartbeatStore,
): string {
  const normalized = address.trim();
  if (!normalized || normalized === "전체" || normalized === "all") {
    return address;
  }

  const direct = heartbeats[normalized];
  if (direct?.agent?.trim()) {
    return formatAgentLabel(normalized, direct.agent);
  }

  for (const [agentId, heartbeat] of Object.entries(heartbeats)) {
    if (heartbeat.agent?.trim() === normalized) {
      return formatAgentLabel(agentId, heartbeat.agent);
    }
  }

  return normalized;
}

export function resolveCurrentAgentName(
  agentId: string,
  fallbackAgentName: string,
  heartbeats: HeartbeatStore,
): string {
  const currentName = heartbeats[agentId]?.agent?.trim();
  if (currentName) {
    return currentName;
  }

  for (const heartbeat of Object.values(heartbeats)) {
    if (heartbeat.id?.trim() === agentId && heartbeat.agent?.trim()) {
      return heartbeat.agent.trim();
    }
  }

  return fallbackAgentName;
}

function refreshAgentIdentity(
  options: Options,
  heartbeats: HeartbeatStore,
): string {
  const nextAgentName = resolveCurrentAgentName(
    options.agentId,
    options.agentName,
    heartbeats,
  );

  if (nextAgentName !== options.agentName) {
    options.agentName = nextAgentName;
    persistAgentName(options.stateDir, nextAgentName);
  }

  return nextAgentName;
}

// When running in headless reviewer mode, review-request files are handled
// by the headless loop (engine/headless-loop.ts), not the generic bridge.
// Skip them here to prevent race conditions.
const HEADLESS_SKIP_PATTERNS = [
  /리뷰\s*요청/,
  /review[- ]?request/i,
  /재리뷰/,
  /re-?review/i,
];

function shouldSkipInHeadlessMode(fileName: string, body: string): boolean {
  if (process.env.TAP_HEADLESS !== "true") return false;
  const combined = `${fileName}\n${body}`;
  return HEADLESS_SKIP_PATTERNS.some((p) => p.test(combined));
}

function collectCandidates(
  inboxDir: string,
  agentId: string,
  agentName: string,
): Candidate[] {
  const entries = readdirSync(inboxDir, { withFileTypes: true })
    .filter(
      (entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".md"),
    )
    .map((entry) => {
      const filePath = join(inboxDir, entry.name);
      const stats = statSync(filePath);
      return { entry, filePath, stats };
    })
    .sort((left, right) => left.stats.mtimeMs - right.stats.mtimeMs);

  const candidates: Candidate[] = [];
  for (const item of entries) {
    const body = readFileSync(item.filePath, "utf8");
    const route = getInboxRoute(item.entry.name, body);
    if (!recipientMatchesAgent(route.recipient, agentId, agentName)) {
      continue;
    }

    if (isOwnMessageSender(route.sender, agentId, agentName)) {
      continue;
    }

    // In headless mode, skip review-request files — handled by headless loop
    if (shouldSkipInHeadlessMode(item.entry.name, body)) {
      continue;
    }

    candidates.push({
      markerId: buildMarkerId(item.filePath, item.stats.mtimeMs),
      filePath: item.filePath,
      fileName: item.entry.name,
      sender: route.sender,
      recipient: route.recipient,
      subject: route.subject,
      body,
      mtimeMs: item.stats.mtimeMs,
    });
  }

  return candidates;
}

function getPendingCandidates(
  options: Options,
  cutoff: Date,
): {
  heartbeats: HeartbeatStore;
  candidates: Candidate[];
} {
  const inboxDir = join(options.commsDir, "inbox");
  if (!existsSync(inboxDir)) {
    throw new Error(`Inbox directory not found: ${inboxDir}`);
  }

  const heartbeats = loadHeartbeats(options.commsDir);
  const agentName = refreshAgentIdentity(options, heartbeats);
  const cutoffMs = cutoff.getTime();
  const candidates = collectCandidates(
    inboxDir,
    options.agentId,
    agentName,
  ).filter((candidate) => {
    if (candidate.mtimeMs < cutoffMs) {
      return false;
    }

    return !existsSync(
      getProcessedMarkerPath(options.stateDir, candidate.markerId),
    );
  });

  return { heartbeats, candidates };
}

export function buildUserInput(
  candidate: Candidate,
  agentName: string,
  heartbeats: HeartbeatStore,
): string {
  const sender = resolveAddressLabel(candidate.sender || "unknown", heartbeats);
  const recipient = resolveAddressLabel(
    candidate.recipient || agentName,
    heartbeats,
  );
  const subject = candidate.subject || "(none)";
  const body = candidate.body.trim();

  return [
    `Tap-comms inbox message for ${agentName}.`,
    `Sender: ${sender}`,
    `Recipient: ${recipient}`,
    `Subject: ${subject}`,
    `File: ${candidate.fileName}`,
    "",
    "Message body:",
    body || "(empty)",
    "",
    "---",
    "Instructions: Read the message above and respond using the tap_reply tool.",
    `Use tap_reply(to: "${candidate.sender || "unknown"}", subject: "<your-subject>", content: "<your-response>") to send your response.`,
    "If the message is a review request, perform the review and reply with your findings.",
    "If the message is informational, acknowledge briefly via tap_reply.",
    "Do NOT respond with plain text only — you MUST use the tap_reply tool.",
  ].join("\n");
}

function writeProcessedMarker(
  stateDir: string,
  candidate: Candidate,
  dispatchMode: "start" | "steer",
  threadId: string | null,
  turnId: string | null,
): void {
  const payload = {
    requestFile: candidate.filePath,
    requestName: candidate.fileName,
    sender: candidate.sender,
    recipient: candidate.recipient,
    subject: candidate.subject,
    dispatchMode,
    threadId,
    turnId,
    markedAt: new Date().toISOString(),
  };
  writeFileSync(
    getProcessedMarkerPath(stateDir, candidate.markerId),
    `${JSON.stringify(payload, null, 2)}\n`,
    "utf8",
  );
}

function writeLastDispatch(
  stateDir: string,
  candidate: Candidate,
  dispatchMode: "start" | "steer",
  threadId: string | null,
  turnId: string | null,
): void {
  const payload = {
    requestFile: candidate.filePath,
    requestName: candidate.fileName,
    markerId: candidate.markerId,
    sender: candidate.sender,
    recipient: candidate.recipient,
    subject: candidate.subject,
    dispatchMode,
    threadId,
    turnId,
    dispatchedAt: new Date().toISOString(),
  };
  writeFileSync(
    join(stateDir, "last-dispatch.json"),
    `${JSON.stringify(payload, null, 2)}\n`,
    "utf8",
  );
}

function formatJsonRpcError(error: JsonRpcResponse["error"]): string {
  if (!error) {
    return "Unknown App Server error";
  }

  return JSON.stringify(
    {
      code: error.code,
      message: error.message,
      data: error.data,
    },
    null,
    2,
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, ms);
  });
}

export async function waitForTurnCompletion(
  client: Pick<
    HeadlessWarmupClient,
    "activeTurnId" | "lastTurnStatus" | "refreshCurrentThreadState"
  >,
  turnId: string,
  timeoutMs: number,
): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;
  let nextRefreshAt = Date.now();

  while (Date.now() < deadline) {
    if (!client.activeTurnId || client.activeTurnId !== turnId) {
      return client.lastTurnStatus;
    }

    if (Date.now() >= nextRefreshAt) {
      await client.refreshCurrentThreadState().catch(() => undefined);
      if (!client.activeTurnId || client.activeTurnId !== turnId) {
        return client.lastTurnStatus;
      }
      nextRefreshAt = Date.now() + TURN_COMPLETION_REFRESH_MS;
    }

    await delay(
      Math.min(TURN_COMPLETION_POLL_MS, Math.max(deadline - Date.now(), 0)),
    );
  }

  await client.refreshCurrentThreadState().catch(() => undefined);
  if (!client.activeTurnId || client.activeTurnId !== turnId) {
    return client.lastTurnStatus;
  }

  throw new Error(`Timed out waiting for turn ${turnId} to complete`);
}

export async function maybeBootstrapHeadlessTurn(
  options: Options,
  cutoff: Date,
  client: HeadlessWarmupClient,
): Promise<boolean> {
  if (
    process.env.TAP_HEADLESS !== "true" &&
    process.env.TAP_COLD_START_WARMUP !== "true"
  ) {
    return false;
  }

  const { candidates } = getPendingCandidates(options, cutoff);
  if (
    candidates.length > 0 ||
    client.activeTurnId ||
    client.lastTurnStatus !== null
  ) {
    return false;
  }

  logStatus("headless cold-start: sending warmup turn");
  const turnId = await client.startTurn(HEADLESS_WARMUP_PROMPT);
  if (!turnId) {
    throw new Error(
      "Headless cold-start warmup failed: turn/start did not return a turn id. " +
        "Run: npx @hua-labs/tap doctor",
    );
  }

  try {
    const status = await waitForTurnCompletion(
      client,
      turnId,
      HEADLESS_WARMUP_TIMEOUT_MS,
    );
    if (status !== "completed") {
      throw new Error(
        `turn ${turnId} finished with status ${status ?? "unknown"}`,
      );
    }

    logStatus(`headless cold-start warmup completed (${status})`);
    return true;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Headless cold-start warmup failed: ${reason}. ` +
        "Run: npx @hua-labs/tap doctor",
    );
  }
}

function shouldRetrySteerAsStart(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return (
    message.includes("no active turn") ||
    message.includes("expectedturnid") ||
    (message.includes("turn/steer failed") &&
      (message.includes("active turn") || message.includes("not found")))
  );
}

async function readSocketData(data: unknown): Promise<string> {
  if (typeof data === "string") {
    return data;
  }

  if (data instanceof ArrayBuffer) {
    return Buffer.from(data).toString("utf8");
  }

  if (ArrayBuffer.isView(data)) {
    return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString(
      "utf8",
    );
  }

  if (typeof Blob !== "undefined" && data instanceof Blob) {
    return await data.text();
  }

  return String(data);
}

class AppServerClient {
  private socket: WebSocket | null = null;
  private readonly url: string;
  private readonly gatewayToken: string | null;
  private readonly logger: (message: string) => void;
  private nextId = 1;
  private pending = new Map<
    number,
    {
      resolve: (value: any) => void;
      reject: (reason?: unknown) => void;
      method: string;
    }
  >();

  connected = false;
  initialized = false;
  threadId: string | null = null;
  currentThreadCwd: string | null = null;
  activeTurnId: string | null = null;
  turnStartedAt: string | null = null;
  lastTurnStatus: string | null = null;
  lastNotificationMethod: string | null = null;
  lastNotificationAt: string | null = null;
  lastError: string | null = null;
  lastSuccessfulAppServerAt: string | null = null;
  lastSuccessfulAppServerMethod: string | null = null;

  constructor(
    url: string,
    logger: (message: string) => void,
    gatewayToken?: string | null,
  ) {
    this.url = url;
    this.logger = logger;
    this.gatewayToken = gatewayToken ?? null;
  }

  async connect(): Promise<void> {
    if (this.connected && this.socket?.readyState === WebSocket.OPEN) {
      return;
    }

    // Authenticate via WebSocket subprotocol instead of URL query param.
    // Token stays out of URLs (no log/referer/history leakage).
    const wsOptions: { protocols?: string[] } = {};
    if (this.gatewayToken) {
      wsOptions.protocols = [`${AUTH_SUBPROTOCOL_PREFIX}${this.gatewayToken}`];
    }
    this.socket = new WebSocket(this.url, wsOptions);

    await new Promise<void>((resolvePromise, rejectPromise) => {
      let settled = false;

      const resolveOnce = () => {
        if (settled) {
          return;
        }
        settled = true;
        resolvePromise();
      };

      const rejectOnce = (error: Error) => {
        if (settled) {
          return;
        }
        settled = true;
        rejectPromise(error);
      };

      this.socket?.addEventListener(
        "open",
        () => {
          this.connected = true;
          this.logger(`connected to app-server at ${this.url}`);
          resolveOnce();
        },
        { once: true },
      );

      this.socket?.addEventListener("error", () => {
        const error = new Error(
          `Failed to connect to App Server at ${this.url}`,
        );
        this.lastError = error.message;
        rejectOnce(error);
      });

      this.socket?.addEventListener("close", () => {
        this.connected = false;
        this.initialized = false;
        this.activeTurnId = null;
        this.turnStartedAt = null;
        this.logger("disconnected from app-server");
        this.rejectPending(new Error("App Server connection closed"));
      });

      this.socket?.addEventListener("message", (event) => {
        void this.handleMessage(event.data);
      });
    });

    await this.request("initialize", {
      clientInfo: {
        name: "tap-app-server-bridge",
        title: "tap app-server bridge",
        version: "0.1.0",
      },
      capabilities: {
        experimentalApi: false,
      },
    });
    this.initialized = true;
  }

  async disconnect(): Promise<void> {
    if (!this.socket) {
      return;
    }

    this.socket.close();
    this.connected = false;
    this.initialized = false;
    this.socket = null;
  }

  async ensureThread(
    explicitThreadId: string | null,
    savedThread: ThreadStateRecord | null,
    cwd: string,
    ephemeral: boolean,
  ): Promise<string> {
    if (explicitThreadId) {
      try {
        const resumeResponse = await this.request("thread/resume", {
          threadId: explicitThreadId,
          persistExtendedHistory: false,
        });
        const resumedThreadId = resumeResponse?.thread?.id ?? explicitThreadId;
        await this.refreshThreadState(resumedThreadId);
        this.logger(
          `resumed thread ${resumedThreadId}${
            this.activeTurnId ? ` (active turn ${this.activeTurnId})` : ""
          }`,
        );
        return resumedThreadId;
      } catch (error) {
        this.logger(
          `thread resume failed for ${explicitThreadId}; starting a fresh thread (${String(error)})`,
        );
      }
    }

    const loadedThreadId = await this.findLoadedThread(cwd);
    if (loadedThreadId) {
      return loadedThreadId;
    }

    if (savedThread?.threadId) {
      if (savedThread.cwd && !threadCwdMatches(cwd, savedThread.cwd)) {
        this.logger(
          `saved thread ${savedThread.threadId} cwd ${savedThread.cwd} does not match ${cwd}; skipping saved thread`,
        );
      } else {
        try {
          const resumeResponse = await this.request("thread/resume", {
            threadId: savedThread.threadId,
            persistExtendedHistory: false,
          });
          const resumedThreadId =
            resumeResponse?.thread?.id ?? savedThread.threadId;
          await this.refreshThreadState(resumedThreadId);
          if (!threadCwdMatches(cwd, this.currentThreadCwd)) {
            this.logger(
              `saved thread ${resumedThreadId} cwd ${
                this.currentThreadCwd ?? "unknown"
              } does not match ${cwd}; starting a fresh thread`,
            );
            this.threadId = null;
            this.currentThreadCwd = null;
            this.activeTurnId = null;
            this.turnStartedAt = null;
            this.lastTurnStatus = null;
          } else {
            this.logger(
              `resumed saved thread ${resumedThreadId}${
                this.activeTurnId ? ` (active turn ${this.activeTurnId})` : ""
              }`,
            );
            return resumedThreadId;
          }
        } catch (error) {
          this.logger(
            `saved thread resume failed for ${savedThread.threadId}; starting a fresh thread (${String(error)})`,
          );
        }
      }
    }

    const startResponse = await this.request("thread/start", {
      cwd,
      ephemeral,
      experimentalRawEvents: false,
      persistExtendedHistory: false,
    });

    const startedThreadId = startResponse?.thread?.id;
    if (!startedThreadId) {
      throw new Error("thread/start did not return a thread id");
    }

    this.syncThreadStateFromThread(startResponse?.thread);
    this.threadId = startedThreadId;
    this.currentThreadCwd = this.currentThreadCwd ?? cwd;
    this.activeTurnId = null;
    this.lastTurnStatus = null;
    this.logger(`started thread ${startedThreadId}`);
    return startedThreadId;
  }

  async findLoadedThread(cwd: string): Promise<string | null> {
    const response = await this.request("thread/loaded/list", {
      limit: 20,
    });
    const threadIds = Array.isArray(response?.data)
      ? response.data.filter(
          (value: unknown): value is string => typeof value === "string",
        )
      : [];

    if (threadIds.length === 0) {
      return null;
    }

    const threads: LoadedThreadCandidate[] = [];

    for (const threadId of threadIds) {
      try {
        const threadResponse = await this.request("thread/read", {
          threadId,
          includeTurns: true,
        });
        const thread = threadResponse?.thread;
        if (!thread?.id) {
          continue;
        }
        threads.push({
          id: thread.id,
          cwd: typeof thread.cwd === "string" ? thread.cwd : "",
          updatedAt:
            typeof thread.updatedAt === "number" ? thread.updatedAt : 0,
          statusType: thread.status?.type ?? null,
          thread,
        });
      } catch {
        continue;
      }
    }

    const chosen = chooseLoadedThreadForCwd(cwd, threads);
    if (!chosen) {
      if (threads.length > 0) {
        this.logger(`loaded threads exist but none match cwd ${cwd}`);
      }
      return null;
    }
    this.syncThreadStateFromThread(chosen.thread);
    this.logger(
      `attached to loaded thread ${chosen.id}${
        this.activeTurnId ? ` (active turn ${this.activeTurnId})` : ""
      }`,
    );
    return chosen.id;
  }

  async startTurn(inputText: string): Promise<string | null> {
    const threadId = this.requireThreadId();
    const response = await this.request("turn/start", {
      threadId,
      input: [
        {
          type: "text",
          text: inputText,
          text_elements: [],
        },
      ],
    });

    const turnId = response?.turn?.id ?? null;
    if (turnId) {
      this.activeTurnId = turnId;
      this.turnStartedAt = new Date().toISOString();
    }
    return turnId;
  }

  async steerTurn(inputText: string): Promise<string> {
    const threadId = this.requireThreadId();
    const turnId = this.requireActiveTurnId();

    await this.request("turn/steer", {
      threadId,
      expectedTurnId: turnId,
      input: [
        {
          type: "text",
          text: inputText,
          text_elements: [],
        },
      ],
    });

    return turnId;
  }

  isBusy(): boolean {
    return Boolean(this.activeTurnId);
  }

  async refreshCurrentThreadState(): Promise<void> {
    if (!this.threadId) {
      return;
    }

    await this.refreshThreadState(this.threadId);
  }

  private requireThreadId(): string {
    if (!this.threadId) {
      throw new Error("No active App Server thread is available");
    }
    return this.threadId;
  }

  private requireActiveTurnId(): string {
    if (!this.activeTurnId) {
      throw new Error("No active turn is available for turn/steer");
    }
    return this.activeTurnId;
  }

  private async refreshThreadState(threadId: string): Promise<void> {
    const threadResponse = await this.request("thread/read", {
      threadId,
      includeTurns: true,
    });
    this.syncThreadStateFromThread(threadResponse?.thread);
  }

  private syncThreadStateFromThread(thread: any): void {
    if (typeof thread?.id === "string") {
      this.threadId = thread.id;
    }
    this.currentThreadCwd = typeof thread?.cwd === "string" ? thread.cwd : null;

    let activeTurnId: string | null = null;
    let lastTurnStatus: string | null = null;
    const turns = Array.isArray(thread?.turns) ? thread.turns : [];
    for (const turn of turns) {
      if (typeof turn?.status === "string") {
        lastTurnStatus = turn.status;
      }
      if (turn?.status === "inProgress" && typeof turn.id === "string") {
        activeTurnId = turn.id;
      }
    }

    if (activeTurnId && activeTurnId !== this.activeTurnId) {
      this.turnStartedAt = new Date().toISOString();
    } else if (!activeTurnId) {
      this.turnStartedAt = null;
    }
    this.activeTurnId = activeTurnId;
    this.lastTurnStatus = lastTurnStatus;
  }

  private async handleMessage(data: unknown): Promise<void> {
    const text = await readSocketData(data);
    const message = JSON.parse(text) as JsonRpcResponse;

    if (
      typeof message.id === "number" &&
      (Object.hasOwn(message, "result") || Object.hasOwn(message, "error"))
    ) {
      const pending = this.pending.get(message.id);
      if (!pending) {
        return;
      }

      this.pending.delete(message.id);
      if (message.error) {
        const errorText = formatJsonRpcError(message.error);
        this.lastError = errorText;
        pending.reject(new Error(`${pending.method} failed: ${errorText}`));
        return;
      }

      pending.resolve(message.result);
      this.lastSuccessfulAppServerAt = new Date().toISOString();
      this.lastSuccessfulAppServerMethod = pending.method;
      this.lastError = null;
      return;
    }

    if (!message.method) {
      return;
    }

    this.lastNotificationMethod = message.method;
    this.lastNotificationAt = new Date().toISOString();
    this.handleNotification(message.method, message.params);
  }

  private handleNotification(method: string, params: any): void {
    switch (method) {
      case "thread/started":
        if (params?.thread?.id) {
          this.threadId = params.thread.id;
        }
        if (typeof params?.thread?.cwd === "string") {
          this.currentThreadCwd = params.thread.cwd;
        }
        this.logger(`thread started ${params?.thread?.id ?? ""}`.trim());
        break;
      case "thread/status/changed":
        this.logger(
          `thread status changed (${params?.thread?.status?.type ?? params?.status?.type ?? "unknown"})`,
        );
        break;
      case "turn/started":
        if (params?.turn?.id) {
          this.activeTurnId = params.turn.id;
          this.turnStartedAt = new Date().toISOString();
          this.logger(`turn started ${params.turn.id}`);
        }
        break;
      case "turn/completed": {
        this.lastTurnStatus = params?.turn?.status ?? null;
        const prevTurnStartedAt = this.turnStartedAt;
        this.activeTurnId = null;
        this.turnStartedAt = null;
        const elapsedMs = prevTurnStartedAt
          ? Date.now() - new Date(prevTurnStartedAt).getTime()
          : null;
        const elapsedSuffix =
          elapsedMs !== null
            ? ` — ${Math.round(elapsedMs / 1000)}s elapsed`
            : "";
        this.logger(
          `turn completed (${this.lastTurnStatus ?? "unknown"})${elapsedSuffix}`,
        );
        break;
      }
      case "error":
        this.lastError = JSON.stringify(params ?? {}, null, 2);
        this.logger(`app-server error notification: ${this.lastError}`);
        break;
      default:
        break;
    }
  }

  private request(method: string, params: unknown): Promise<any> {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error(`Cannot call ${method}; App Server socket is not open`);
    }

    const id = this.nextId;
    this.nextId += 1;

    const request: RequestRecord = {
      jsonrpc: "2.0",
      id,
      method,
      params,
    };

    return new Promise((resolvePromise, rejectPromise) => {
      this.pending.set(id, {
        resolve: resolvePromise,
        reject: rejectPromise,
        method,
      });
      this.socket?.send(JSON.stringify(request));
    });
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();
  }
}

let heartbeatCount = 0;

function writeHeartbeat(
  options: Options,
  client: AppServerClient | null,
  health: BridgeHealthState,
): void {
  if (client?.threadId) {
    const savedThread = readThreadState(options.stateDir);
    persistThreadState(
      options.stateDir,
      client.threadId,
      options.appServerUrl,
      options.ephemeral,
      client.currentThreadCwd ?? savedThread?.cwd ?? null,
    );
  }

  const payload: HeartbeatRecord = {
    pid: process.pid,
    agent: options.agentName,
    updatedAt: new Date().toISOString(),
    pollSeconds: options.pollSeconds,
    appServerUrl: options.appServerUrl,
    connected: client?.connected ?? false,
    initialized: client?.initialized ?? false,
    threadId: client?.threadId ?? null,
    threadCwd: client?.currentThreadCwd ?? null,
    activeTurnId: client?.activeTurnId ?? null,
    turnStartedAt: client?.turnStartedAt ?? null,
    lastTurnStatus: client?.lastTurnStatus ?? null,
    lastNotificationMethod: client?.lastNotificationMethod ?? null,
    lastNotificationAt: client?.lastNotificationAt ?? null,
    lastError: sanitizeErrorForPersistence(client?.lastError ?? null),
    lastSuccessfulAppServerAt: client?.lastSuccessfulAppServerAt ?? null,
    lastSuccessfulAppServerMethod:
      client?.lastSuccessfulAppServerMethod ?? null,
    consecutiveFailureCount: health.consecutiveFailureCount,
    busyMode: options.busyMode,
  };

  writeFileSync(
    join(options.stateDir, "heartbeat.json"),
    `${JSON.stringify(payload, null, 2)}\n`,
    "utf8",
  );

  heartbeatCount += 1;
  if (heartbeatCount % 5 === 0) {
    logStatus(
      `heartbeat: connected=${payload.connected}, thread=${payload.threadId ?? "null"}, turns=${payload.activeTurnId ? "active" : "0"}`,
    );
  }

  // Also update comms heartbeats.json so tap_who sees this agent
  const status = client?.connected ? "active" : "idle";
  updateCommsHeartbeat(options, status);
}

// ── Comms heartbeat (shared agent registry) ───────────────────────────
// The MCP channel maintains comms/heartbeats.json for tap_who / tap doctor.
// When Codex can't call MCP tools (hyphen bug, tool-hidden sessions), the
// bridge updates this file directly so the agent stays visible.

const COMMS_HEARTBEAT_LOCK_TIMEOUT_MS = 2_000;
const COMMS_LOCK_STALE_AGE_MS = 10_000;

function acquireCommsLock(lockPath: string): boolean {
  const deadline = Date.now() + COMMS_HEARTBEAT_LOCK_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      writeFileSync(lockPath, String(process.pid), { flag: "wx" });
      return true;
    } catch {
      // Lock exists — check if stale
      try {
        const lockAge = Date.now() - statSync(lockPath).mtimeMs;
        if (lockAge > COMMS_LOCK_STALE_AGE_MS) {
          unlinkSync(lockPath);
          // Retry with exclusive create
          try {
            writeFileSync(lockPath, String(process.pid), { flag: "wx" });
            return true;
          } catch {
            // Another process grabbed it between unlink and our wx
          }
        }
      } catch {
        // Lock disappeared between check and stat — retry
      }
      const start = Date.now();
      while (Date.now() - start < 50) {
        /* spin */
      }
    }
  }
  return false;
}

function releaseCommsLock(lockPath: string): void {
  try {
    unlinkSync(lockPath);
  } catch {
    // Already removed
  }
}

function updateCommsHeartbeat(options: Options, status: string): void {
  const heartbeatsPath = join(options.commsDir, "heartbeats.json");
  const lockPath = join(options.commsDir, ".heartbeats.lock");

  if (!acquireCommsLock(lockPath)) {
    return; // Non-critical — skip this cycle
  }

  try {
    let store: Record<string, unknown> = {};
    try {
      store = JSON.parse(readFileSync(heartbeatsPath, "utf-8"));
    } catch {
      // Empty or corrupt — start fresh
    }

    // Use agentId as key (SSOT for heartbeat store), not agentName.
    // This matches tap-comms.ts which keys by routing id.
    const key = options.agentId;
    const existing = store[key] as Record<string, unknown> | undefined;
    store[key] = {
      id: options.agentId,
      agent: options.agentName,
      timestamp: new Date().toISOString(),
      lastActivity: new Date().toISOString(),
      joinedAt: (existing?.joinedAt as string) ?? new Date().toISOString(),
      status,
    };

    const tmpPath = heartbeatsPath + ".tmp." + process.pid;
    writeFileSync(tmpPath, JSON.stringify(store, null, 2), "utf-8");
    renameSync(tmpPath, heartbeatsPath);
  } catch {
    // Non-critical — comms heartbeat update failure should never crash bridge
  } finally {
    releaseCommsLock(lockPath);
  }
}

async function dispatchCandidate(
  client: AppServerClient,
  options: Options,
  candidate: Candidate,
  heartbeats: HeartbeatStore,
): Promise<boolean> {
  const input = buildUserInput(candidate, options.agentName, heartbeats);

  logStatus(
    `dispatching from ${candidate.sender || "unknown"}: ${candidate.subject || "(none)"}`,
  );

  if (client.isBusy()) {
    if (options.busyMode !== "steer") {
      return false;
    }

    try {
      const turnId = await client.steerTurn(input);
      writeProcessedMarker(
        options.stateDir,
        candidate,
        "steer",
        client.threadId,
        turnId,
      );
      writeLastDispatch(
        options.stateDir,
        candidate,
        "steer",
        client.threadId,
        turnId,
      );
      logStatus(`steered active turn with ${candidate.fileName}`);
      return true;
    } catch (error) {
      await client.refreshCurrentThreadState().catch(() => undefined);

      if (!client.isBusy()) {
        return dispatchCandidate(client, options, candidate, heartbeats);
      }

      if (shouldRetrySteerAsStart(error)) {
        client.activeTurnId = null;
        client.turnStartedAt = null;
        logStatus(
          `steer fallback -> start for ${candidate.fileName} (${String(error)})`,
        );
        return dispatchCandidate(client, options, candidate, heartbeats);
      }

      throw error;
    }
  }

  const turnId = await client.startTurn(input);
  writeProcessedMarker(
    options.stateDir,
    candidate,
    "start",
    client.threadId,
    turnId,
  );
  writeLastDispatch(
    options.stateDir,
    candidate,
    "start",
    client.threadId,
    turnId,
  );
  logStatus(`dispatched ${candidate.fileName} to thread ${client.threadId}`);
  return true;
}

async function runScan(
  options: Options,
  cutoff: Date,
  client: AppServerClient | null,
): Promise<boolean> {
  const { heartbeats, candidates } = getPendingCandidates(options, cutoff);
  for (const candidate of candidates) {
    if (options.dryRun) {
      logStatus(`dry-run candidate ${candidate.fileName}`);
      continue;
    }

    if (!client) {
      throw new Error("App Server client is not available");
    }

    const dispatched = await dispatchCandidate(
      client,
      options,
      candidate,
      heartbeats,
    );
    if (!dispatched && options.busyMode === "wait") {
      return false;
    }
    return true;
  }

  return false;
}

async function waitForTurnDrain(
  options: Options,
  client: AppServerClient,
  health: BridgeHealthState,
): Promise<void> {
  const deadline = Date.now() + options.waitAfterDispatchSeconds * 1_000;
  while (Date.now() < deadline) {
    writeHeartbeat(options, client, health);
    if (!client.activeTurnId) {
      return;
    }
    await delay(1_000);
  }
}

export function buildOptions(argv: string[]): Options {
  const parsed = parseArgs(argv);
  const repoRoot = resolveRepoRoot(parsed.repoRoot);
  const commsDir = resolveCommsDir(repoRoot, parsed.commsDir);
  const preferredAgentName = resolvePreferredAgentName(parsed.agentName);
  const stateDir = resolveStateDir(
    repoRoot,
    parsed.stateDir,
    preferredAgentName,
  );
  const agentName = resolveAgentName(preferredAgentName, stateDir);
  const agentId = resolveAgentId(agentName);
  persistAgentName(stateDir, agentName);
  const gatewayTokenFile =
    parsed.gatewayTokenFile?.trim() ||
    process.env.TAP_GATEWAY_TOKEN_FILE?.trim() ||
    null;
  const appServerUrl =
    parsed.appServerUrl?.trim() ||
    process.env.CODEX_APP_SERVER_URL ||
    DEFAULT_APP_SERVER_URL;

  return {
    repoRoot,
    commsDir,
    agentId,
    stateDir,
    agentName,
    pollSeconds: parsed.pollSeconds ?? 5,
    reconnectSeconds: parsed.reconnectSeconds ?? 5,
    messageLookbackMinutes: parsed.messageLookbackMinutes ?? 10,
    processExistingMessages: parsed.processExistingMessages,
    dryRun: parsed.dryRun,
    runOnce: parsed.runOnce,
    waitAfterDispatchSeconds: parsed.waitAfterDispatchSeconds ?? 0,
    appServerUrl,
    connectAppServerUrl: appServerUrl,
    gatewayToken: gatewayTokenFile
      ? readGatewayTokenFile(gatewayTokenFile)
      : null,
    gatewayTokenFile,
    busyMode: parsed.busyMode ?? "steer",
    threadId: parsed.threadId?.trim() || null,
    ephemeral: parsed.ephemeral,
  };
}

export async function main(): Promise<void> {
  const options = buildOptions(process.argv.slice(2));
  const cutoff = getGeneralInboxCutoff(
    options.stateDir,
    options.messageLookbackMinutes,
    options.processExistingMessages,
  );
  const initialSavedThread = loadResumableThreadState(
    options.stateDir,
    options.appServerUrl,
  );

  logStatus("codex app-server bridge ready");
  console.log(`  repo:       ${options.repoRoot}`);
  console.log(`  comms:      ${options.commsDir}`);
  console.log(`  agent:      ${options.agentName}`);
  console.log(`  state:      ${options.stateDir}`);
  console.log(`  app-server: ${options.appServerUrl}`);
  console.log(`  busy-mode:  ${options.busyMode}`);
  if (options.waitAfterDispatchSeconds > 0) {
    console.log(
      `  wait:       ${options.waitAfterDispatchSeconds}s after dispatch`,
    );
  }
  console.log(
    `  lookback:   ${
      options.processExistingMessages
        ? "existing messages"
        : `${options.messageLookbackMinutes} minute(s)`
    }`,
  );
  if (options.threadId || initialSavedThread?.threadId) {
    console.log(
      `  thread:     ${options.threadId ?? initialSavedThread?.threadId}`,
    );
  }
  if (options.dryRun) {
    logStatus("dry-run mode enabled");
  }

  let client: AppServerClient | null = null;
  const health: BridgeHealthState = {
    consecutiveFailureCount: 0,
  };

  while (true) {
    try {
      if (!options.dryRun) {
        if (!client || !client.connected) {
          client = new AppServerClient(
            options.connectAppServerUrl,
            logStatus,
            options.gatewayToken,
          );
          await client.connect();
          const savedThread = loadResumableThreadState(
            options.stateDir,
            options.appServerUrl,
          );

          const threadId = await client.ensureThread(
            options.threadId,
            savedThread,
            options.repoRoot,
            options.ephemeral,
          );
          persistThreadState(
            options.stateDir,
            threadId,
            options.appServerUrl,
            options.ephemeral,
            client.currentThreadCwd ?? options.repoRoot,
          );
          writeHeartbeat(options, client, health);
          const bootstrapped = await maybeBootstrapHeadlessTurn(
            options,
            cutoff,
            client,
          );
          if (bootstrapped) {
            writeHeartbeat(options, client, health);
          }
        }
      }

      const dispatched = await runScan(options, cutoff, client);
      if (dispatched && client && options.waitAfterDispatchSeconds > 0) {
        await waitForTurnDrain(options, client, health);
      }
      health.consecutiveFailureCount = 0;
      writeHeartbeat(options, client, health);

      if (options.runOnce) {
        break;
      }

      await delay(options.pollSeconds * 1_000);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logStatus(`bridge error: ${message}`);
      if (client) {
        client.lastError = message;
      }
      health.consecutiveFailureCount += 1;
      writeHeartbeat(options, client, health);

      if (options.runOnce) {
        throw error;
      }

      client?.disconnect().catch(() => undefined);
      client = null;
      logStatus(`reconnecting in ${options.reconnectSeconds}s...`);
      await delay(options.reconnectSeconds * 1_000);
    }
  }

  await client?.disconnect();
}

function isDirectExecution(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(resolve(entry)).href;
}

if (isDirectExecution()) {
  main().catch((error) => {
    console.error(
      error instanceof Error ? (error.stack ?? error.message) : String(error),
    );
    process.exitCode = 1;
  });
}
