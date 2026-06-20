// src/bridges/codex-app-server-bridge.ts
import { pathToFileURL as pathToFileURL2 } from "url";
import { basename as basename2, resolve as resolve6 } from "path";

// scripts/bridge/bridge-types.ts
var DEFAULT_AGENT = String.fromCharCode(50728);
var DEFAULT_APP_SERVER_URL = "ws://127.0.0.1:4501";
var AUTH_SUBPROTOCOL_PREFIX = "tap-auth-";
var PLACEHOLDER_AGENT_VALUES = /* @__PURE__ */ new Set([
  "unknown",
  "unnamed",
  "<set-per-session>"
]);
var HEADLESS_WARMUP_PROMPT = [
  "You are a tap worker agent connected via the tap-comms inbox.",
  "This is a one-time warmup turn for headless bridge startup.",
  "Do not take any external actions.",
  "Reply briefly, then wait for future inbox instructions."
].join(" ");
var HEADLESS_WARMUP_TIMEOUT_MS = 3e4;
var TURN_COMPLETION_POLL_MS = 250;
var TURN_COMPLETION_REFRESH_MS = 1e3;
var HEADLESS_SKIP_PATTERNS = [
  /리뷰\s*요청/,
  /review[- ]?request/i,
  /재리뷰/,
  /re-?review/i
];
var COMMS_HEARTBEAT_LOCK_TIMEOUT_MS = 2e3;
var COMMS_LOCK_STALE_AGE_MS = 1e4;
var STALE_TURN_MS = 5 * 60 * 1e3;

// scripts/bridge/bridge-routing.ts
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join, resolve, win32 } from "path";

// packages/tap-plugin/channels/tap-identity.ts
var BROADCAST_RECIPIENTS = /* @__PURE__ */ new Set(["\uC804\uCCB4", "all"]);
function trimAddress(value) {
  return value?.trim() ?? "";
}
function canonicalizeAgentId(value) {
  return trimAddress(value).replace(/-/g, "_").toLowerCase();
}
function isBroadcastRecipient(value) {
  return BROADCAST_RECIPIENTS.has(trimAddress(value));
}
function sameRoutingAddress(left, right) {
  const normalizedLeft = trimAddress(left);
  const normalizedRight = trimAddress(right);
  if (!normalizedLeft || !normalizedRight) {
    return false;
  }
  if (isBroadcastRecipient(normalizedLeft) && isBroadcastRecipient(normalizedRight)) {
    return true;
  }
  return normalizedLeft === normalizedRight || canonicalizeAgentId(normalizedLeft) === canonicalizeAgentId(normalizedRight);
}
function matchesAgentRecipient(recipient, agentId, agentName) {
  const normalizedRecipient = trimAddress(recipient);
  if (!normalizedRecipient) {
    return false;
  }
  return isBroadcastRecipient(normalizedRecipient) || sameRoutingAddress(normalizedRecipient, agentId) || normalizedRecipient === trimAddress(agentName);
}
function isOwnMessageAddress(sender, agentId, agentName) {
  const normalizedSender = trimAddress(sender);
  if (!normalizedSender) {
    return false;
  }
  return sameRoutingAddress(normalizedSender, agentId) || normalizedSender === trimAddress(agentName);
}

// scripts/bridge/bridge-routing.ts
function canonicalize(id) {
  return canonicalizeAgentId(id);
}
var WINDOWS_NAMESPACE_PREFIX = "\\\\?\\";
var WINDOWS_NAMESPACE_UNC_PREFIX = "\\\\?\\UNC\\";
function looksLikeWindowsAbsolutePath(value) {
  return /^[A-Za-z]:[\\/]/.test(value) || value.startsWith("\\\\");
}
function stripWindowsNamespacePrefix(cwd) {
  const trimmed = cwd.trim();
  if (trimmed.startsWith(WINDOWS_NAMESPACE_UNC_PREFIX)) {
    return `\\\\${trimmed.slice(WINDOWS_NAMESPACE_UNC_PREFIX.length)}`;
  }
  if (trimmed.startsWith(WINDOWS_NAMESPACE_PREFIX)) {
    return trimmed.slice(WINDOWS_NAMESPACE_PREFIX.length);
  }
  return trimmed;
}
function resolveThreadCwd(cwd) {
  const normalized = stripWindowsNamespacePrefix(cwd);
  return looksLikeWindowsAbsolutePath(normalized) ? win32.resolve(normalized) : resolve(normalized);
}
function normalizeThreadCwd(cwd) {
  return resolveThreadCwd(cwd).replace(/\\/g, "/").toLowerCase();
}
function normalizePersistedThreadCwd(cwd) {
  if (!cwd?.trim()) {
    return null;
  }
  return resolveThreadCwd(cwd);
}
function threadCwdMatches(expectedCwd, actualCwd) {
  if (!actualCwd) {
    return false;
  }
  return normalizeThreadCwd(expectedCwd) === normalizeThreadCwd(actualCwd);
}
function chooseLoadedThreadForCwd(cwd, threads) {
  const reusable = threads.filter((thread) => {
    if (!threadCwdMatches(cwd, thread.cwd)) {
      return false;
    }
    if (thread.statusType === "notLoaded") {
      return false;
    }
    if (thread.statusType === "active") {
      return false;
    }
    const threadActiveFlags = Array.isArray(
      thread.thread?.status?.activeFlags
    ) ? thread.thread.status.activeFlags : [];
    if (isTurnStuckOnApproval(threadActiveFlags)) {
      return false;
    }
    const turns = Array.isArray(thread.thread?.turns) ? thread.thread.turns : [];
    return !turns.some((turn) => {
      const activeFlags = Array.isArray(turn?.activeFlags) ? turn.activeFlags : [];
      return turn?.status === "inProgress" && isTurnStuckOnApproval(activeFlags);
    });
  });
  if (reusable.length === 0) {
    return null;
  }
  reusable.sort((left, right) => right.updatedAt - left.updatedAt);
  return reusable[0] ?? null;
}
function normalizeAgentToken(value) {
  const normalized = value?.trim();
  if (!normalized || PLACEHOLDER_AGENT_VALUES.has(normalized)) {
    return null;
  }
  return canonicalize(normalized);
}
function resolveAgentId(preferredAgentName) {
  return normalizeAgentToken(process.env.TAP_AGENT_ID) ?? normalizeAgentToken(preferredAgentName) ?? "unknown";
}
function resolveAgentName(preferredAgentName, stateDir) {
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
function resolveCurrentAgentName(agentId, fallbackAgentName, heartbeats) {
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
function resolveAddressLabel(address, heartbeats) {
  const normalized = address.trim();
  if (!normalized || normalized === "\uC804\uCCB4" || normalized === "all") {
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
function persistAgentName(stateDir, agentName) {
  writeFileSync(join(stateDir, "agent-name.txt"), `${agentName}
`, "utf8");
}
function formatAgentLabel(agentIdOrName, displayName) {
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
function refreshAgentIdentity(options, heartbeats) {
  const nextAgentName = resolveCurrentAgentName(
    options.agentId,
    options.agentName,
    heartbeats
  );
  if (nextAgentName !== options.agentName) {
    persistAgentName(options.stateDir, nextAgentName);
  }
  return nextAgentName;
}
function recipientMatchesAgent(recipient, agentId, agentName) {
  return matchesAgentRecipient(recipient, agentId, agentName);
}
function isOwnMessageSender(sender, agentId, agentName) {
  return isOwnMessageAddress(sender, agentId, agentName);
}
function isTurnStuckOnApproval(activeFlags) {
  return activeFlags.includes("waitingOnApproval");
}
function isWaitingApprovalStatus(status) {
  if (!status) {
    return false;
  }
  return /approval|input-required|confirm|consent/i.test(status);
}
function isTurnStale(turnStartedAt, nowMs = Date.now()) {
  if (!turnStartedAt) return false;
  return nowMs - new Date(turnStartedAt).getTime() > STALE_TURN_MS;
}
function shouldRetrySteerAsStart(error) {
  if (!(error instanceof Error)) {
    return false;
  }
  const message = error.message.toLowerCase();
  return message.includes("no active turn") || message.includes("expectedturnid") || message.includes("turn/steer failed") && (message.includes("active turn") || message.includes("not found"));
}
var FORBIDDEN_RAW_PAIR_TOKEN_REASON = "envelope rejected: forbidden raw pairToken field present (M355 defensive drop)";
function normalizeFrontmatterValue(value) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}
function parseJsonObject(value) {
  const normalized = normalizeFrontmatterValue(value);
  if (!normalized) {
    return null;
  }
  try {
    const parsed = JSON.parse(normalized);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}
function parseFrontmatterScope(value) {
  const normalized = normalizeFrontmatterValue(value);
  if (normalized === "observe" || normalized === "suggest" || normalized === "drive") {
    return normalized;
  }
  return null;
}
function parseFrontmatterAliases(value) {
  if (!Array.isArray(value)) {
    return void 0;
  }
  const aliases = [];
  for (const candidate of value) {
    if (typeof candidate !== "string") continue;
    const normalized = candidate.trim();
    if (!normalized || aliases.includes(normalized)) continue;
    aliases.push(normalized);
  }
  return aliases.length > 0 ? aliases : void 0;
}
function parseFrontmatterSlot(value) {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  if (normalized === "tower" || normalized === "reviewer" || /^wt-\d+$/.test(normalized)) {
    return normalized;
  }
  return null;
}
function parseFrontmatterAddress(value) {
  const record = parseJsonObject(value);
  if (!record) {
    return null;
  }
  return {
    hostId: normalizeFrontmatterValue(
      typeof record.hostId === "string" ? record.hostId : void 0
    ),
    clientId: normalizeFrontmatterValue(
      typeof record.clientId === "string" ? record.clientId : void 0
    ),
    conversationId: normalizeFrontmatterValue(
      typeof record.conversationId === "string" ? record.conversationId : void 0
    ),
    ownerClientId: normalizeFrontmatterValue(
      typeof record.ownerClientId === "string" ? record.ownerClientId : void 0
    ),
    routingAddress: normalizeFrontmatterValue(
      typeof record.routingAddress === "string" ? record.routingAddress : void 0
    ) ?? void 0,
    slot: parseFrontmatterSlot(record.slot),
    aliases: parseFrontmatterAliases(record.aliases)
  };
}
function parseBridgeFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return null;
  const fields = {};
  for (const line of match[1].split("\n")) {
    const kv = line.match(/^(\w+):\s*(.+)$/);
    if (kv) fields[kv[1]] = kv[2].trim();
  }
  if (!fields.from || !fields.to) return null;
  return {
    sender: fields.from,
    recipient: fields.to,
    subject: fields.subject ?? "",
    messageId: normalizeFrontmatterValue(fields.message_id) ?? normalizeFrontmatterValue(fields.messageId),
    fromAddress: parseFrontmatterAddress(fields.from_address),
    toAddress: parseFrontmatterAddress(fields.to_address),
    scope: parseFrontmatterScope(fields.scope),
    action: normalizeFrontmatterValue(fields.action),
    consentRef: normalizeFrontmatterValue(fields.consent_ref) ?? normalizeFrontmatterValue(fields.consentRef),
    validationError: normalizeFrontmatterValue(fields.pairToken) ?? normalizeFrontmatterValue(fields.pair_token) ? FORBIDDEN_RAW_PAIR_TOKEN_REASON : null
  };
}
function stripBridgeFrontmatter(content) {
  return content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n*/, "");
}
function getInboxRoute(fileName, body) {
  if (body) {
    const fm = parseBridgeFrontmatter(body);
    if (fm) return fm;
  }
  return getInboxRouteFromFilename(fileName);
}
function getInboxRouteFromFilename(fileName) {
  const stem = fileName.replace(/\.md$/i, "");
  const parts = stem.split("-");
  let offset = 0;
  if (parts[0] && /^\d{8}$/.test(parts[0])) {
    offset = 1;
  }
  return {
    sender: parts[offset] ?? "",
    recipient: parts[offset + 1] ?? "",
    subject: parts.slice(offset + 2).join("-"),
    validationError: null
  };
}

// scripts/bridge/bridge-config.ts
import { existsSync as existsSync2, mkdirSync, readFileSync as readFileSync2 } from "fs";
import { isAbsolute, join as join2, resolve as resolve2 } from "path";
function normalizeTapPath(input, platform = process.platform) {
  const trimmed = input.trim().replace(/^["'`]+|["'`]+$/g, "");
  if (/^[A-Za-z]:[\\/]/.test(trimmed)) {
    return trimmed;
  }
  if (platform === "win32") {
    const match = trimmed.match(/^\/([A-Za-z])\/(.*)$/);
    if (match) {
      return `${match[1].toUpperCase()}:\\${match[2].replace(/\//g, "\\")}`;
    }
  }
  return trimmed;
}
function ensureDir(target) {
  if (!existsSync2(target)) {
    mkdirSync(target, { recursive: true });
  }
  return resolve2(target);
}
function printHelp() {
  console.log(`Codex App Server bridge

Usage:
  node --experimental-strip-types scripts/codex/codex-app-server-bridge.ts [options]

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
  --log-level=debug|info|warn|error
  --thread-id=<id>
  --ephemeral
  --help
`);
}
function parseNumber(value, flag) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Invalid ${flag}: ${value}`);
  }
  return parsed;
}
function readFlagValue(argv, index, flag) {
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
function parseArgs(argv) {
  const parsed = {
    processExistingMessages: false,
    dryRun: false,
    runOnce: false,
    ephemeral: false
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
        "--poll-seconds"
      );
      if (consumesNext) {
        index += 1;
      }
      continue;
    }
    if (flag.startsWith("--reconnect-seconds")) {
      parsed.reconnectSeconds = parseNumber(
        readFlagValue(argv, index, "--reconnect-seconds"),
        "--reconnect-seconds"
      );
      if (consumesNext) {
        index += 1;
      }
      continue;
    }
    if (flag.startsWith("--message-lookback-minutes")) {
      parsed.messageLookbackMinutes = parseNumber(
        readFlagValue(argv, index, "--message-lookback-minutes"),
        "--message-lookback-minutes"
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
        "--gateway-token-file"
      );
      if (consumesNext) {
        index += 1;
      }
      continue;
    }
    if (flag.startsWith("--wait-after-dispatch-seconds")) {
      parsed.waitAfterDispatchSeconds = parseNumber(
        readFlagValue(argv, index, "--wait-after-dispatch-seconds"),
        "--wait-after-dispatch-seconds"
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
    if (flag.startsWith("--log-level")) {
      const value = readFlagValue(argv, index, "--log-level");
      if (value !== "debug" && value !== "info" && value !== "warn" && value !== "error") {
        throw new Error(`Invalid --log-level: ${value}`);
      }
      parsed.logLevel = value;
      if (consumesNext) {
        index += 1;
      }
      continue;
    }
    throw new Error(`Unknown argument: ${flag}`);
  }
  return parsed;
}
function resolveRepoRoot(explicit) {
  if (explicit) {
    return resolve2(explicit);
  }
  return process.cwd();
}
function resolveTapConfigPath(repoRoot, input) {
  const converted = normalizeTapPath(input);
  return isAbsolute(converted) ? resolve2(converted) : resolve2(repoRoot, converted);
}
function resolveCommsDir(repoRoot, explicit) {
  if (explicit) {
    return resolve2(normalizeTapPath(explicit));
  }
  const envCommsDir = process.env.TAP_COMMS_DIR?.trim();
  if (envCommsDir) {
    return resolveTapConfigPath(repoRoot, envCommsDir);
  }
  const tapConfigPath = join2(repoRoot, ".tap-config");
  if (!existsSync2(tapConfigPath)) {
    throw new Error(
      "Unable to resolve comms directory. Pass --comms-dir or set TAP_COMMS_DIR."
    );
  }
  const configText = readFileSync2(tapConfigPath, "utf8");
  const match = configText.match(/^TAP_COMMS_DIR="?(.*?)"?$/m);
  if (!match?.[1]) {
    throw new Error(
      "Unable to resolve comms directory. Pass --comms-dir or set TAP_COMMS_DIR."
    );
  }
  return resolveTapConfigPath(repoRoot, match[1]);
}
function resolvePreferredAgentName(requested) {
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
function sanitizeStateSegment(agentName) {
  const normalized = agentName.trim().replace(/[<>:"/\\|?*\x00-\x1f]/g, "-").replace(/[. ]+$/g, "");
  return normalized || "agent";
}
function buildDefaultStateDir(repoRoot, preferredAgentName) {
  const suffix = preferredAgentName?.trim() ? `-${sanitizeStateSegment(preferredAgentName)}` : "";
  return resolve2(join2(repoRoot, ".tmp", `codex-app-server-bridge${suffix}`));
}
function resolveStateDir(repoRoot, explicit, preferredAgentName) {
  const root = explicit ? resolve2(explicit) : buildDefaultStateDir(repoRoot, preferredAgentName);
  ensureDir(root);
  ensureDir(join2(root, "processed"));
  ensureDir(join2(root, "logs"));
  return root;
}
function readGatewayTokenFile(tokenFile) {
  const token = readFileSync2(tokenFile, "utf8").trim();
  if (!token) {
    throw new Error(`Gateway token file is empty: ${tokenFile}`);
  }
  return token;
}
function normalizeRoutingSlotEnv(value) {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === "tower") return "tower";
  if (normalized === "reviewer") return "reviewer";
  const worktreeMatch = normalized.match(/^wt[-_]?(\d+)$/);
  if (worktreeMatch) {
    return `wt-${Number.parseInt(worktreeMatch[1], 10)}`;
  }
  return null;
}
function buildOptions(argv) {
  const parsed = parseArgs(argv);
  const repoRoot = resolveRepoRoot(parsed.repoRoot);
  const commsDir = resolveCommsDir(repoRoot, parsed.commsDir);
  const preferredAgentName = resolvePreferredAgentName(parsed.agentName);
  const stateDir = resolveStateDir(
    repoRoot,
    parsed.stateDir,
    preferredAgentName
  );
  const agentName = resolveAgentName(preferredAgentName, stateDir);
  const agentId = resolveAgentId(agentName);
  persistAgentName(stateDir, agentName);
  const gatewayTokenFile = parsed.gatewayTokenFile?.trim() || process.env.TAP_GATEWAY_TOKEN_FILE?.trim() || null;
  const appServerUrl = parsed.appServerUrl?.trim() || process.env.CODEX_APP_SERVER_URL || DEFAULT_APP_SERVER_URL;
  const routingSlot = normalizeRoutingSlotEnv(process.env.TAP_ROUTING_SLOT);
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
    gatewayToken: gatewayTokenFile ? readGatewayTokenFile(gatewayTokenFile) : null,
    gatewayTokenFile,
    busyMode: parsed.busyMode ?? "steer",
    logLevel: parsed.logLevel ?? "info",
    threadId: parsed.threadId?.trim() || null,
    ephemeral: parsed.ephemeral,
    routingSlot
  };
}

// scripts/bridge/bridge-candidates.ts
import { createHash } from "crypto";
import {
  existsSync as existsSync3,
  readFileSync as readFileSync3,
  readdirSync,
  statSync,
  unlinkSync
} from "fs";
import { join as join4 } from "path";

// scripts/bridge/bridge-logging.ts
var LOG_LEVEL_PRIORITY = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
};
var currentLogLevel = "info";
function configureBridgeLogging(level) {
  currentLogLevel = level;
}
function shouldLog(level) {
  return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[currentLogLevel];
}
function formatValue(value) {
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  if (value === null) {
    return "null";
  }
  return JSON.stringify(value);
}
function formatContext(context) {
  if (!context) {
    return "";
  }
  const entries = Object.entries(context).filter(
    ([, value]) => value !== void 0
  );
  if (entries.length === 0) {
    return "";
  }
  return ` ${entries.map(([key, value]) => `${key}=${formatValue(value)}`).join(" ")}`;
}
function logBridge(level, message, context) {
  if (!shouldLog(level)) {
    return;
  }
  const ts = (/* @__PURE__ */ new Date()).toISOString().replace("T", " ").replace("Z", " UTC");
  const line = `[${ts}] ${level.toUpperCase()} ${message}${formatContext(context)}`;
  if (level === "error") {
    console.error(line);
    return;
  }
  if (level === "warn") {
    console.warn(line);
    return;
  }
  console.log(line);
}
function createBridgeLogger(scope) {
  const scopedMessage = (message) => `[${scope}] ${message}`;
  return {
    debug(message, context) {
      logBridge("debug", scopedMessage(message), context);
    },
    info(message, context) {
      logBridge("info", scopedMessage(message), context);
    },
    warn(message, context) {
      logBridge("warn", scopedMessage(message), context);
    },
    error(message, context) {
      logBridge("error", scopedMessage(message), context);
    }
  };
}

// scripts/bridge/bridge-format.ts
import { writeFileSync as writeFileSync2 } from "fs";
import { join as join3 } from "path";

// src/routing/tap-message-prompt.ts
function isValidReplyTarget(value) {
  const normalized = value?.trim().toLowerCase();
  return Boolean(
    normalized && normalized !== "unknown" && normalized !== "unnamed" && normalized !== "null" && normalized !== "undefined" && normalized !== "?"
  );
}
function resolveReplyTarget(options) {
  if (isValidReplyTarget(options.returnAddress?.routingAddress)) {
    return options.returnAddress.routingAddress.trim();
  }
  if (isValidReplyTarget(options.replyTo)) {
    return options.replyTo.trim();
  }
  return null;
}
function formatReturnRoute(options) {
  const address = options.returnAddress;
  const parts = [];
  if (isValidReplyTarget(address?.routingAddress)) {
    parts.push(`routingAddress=${address.routingAddress.trim()}`);
  }
  if (address?.hostId?.trim()) parts.push(`hostId=${address.hostId.trim()}`);
  if (options.runtimeSurface?.trim()) {
    parts.push(`runtimeSurface=${options.runtimeSurface.trim()}`);
  }
  if (address?.clientId?.trim()) {
    parts.push(`clientId=${address.clientId.trim()}`);
  }
  if (address?.conversationId?.trim()) {
    parts.push(`conversationId=${address.conversationId.trim()}`);
  }
  if (address?.ownerClientId?.trim()) {
    parts.push(`ownerClientId=${address.ownerClientId.trim()}`);
  }
  if (address?.surfaceInstanceId?.trim()) {
    parts.push(`surfaceInstanceId=${address.surfaceInstanceId.trim()}`);
  }
  return parts.length ? parts.join("; ") : null;
}
function createTapMessageViewModel(options) {
  const body = options.body.trim();
  const replyTo = resolveReplyTarget(options);
  const returnRoute = formatReturnRoute(options);
  return {
    agentName: options.agentName,
    sender: options.sender,
    recipient: options.recipient,
    subject: options.subject,
    body: body || "(empty)",
    replyTarget: replyTo,
    returnRoute,
    missingRoute: !replyTo,
    debugEnvelope: {
      fileName: options.fileName,
      returnAddress: options.returnAddress ?? null,
      runtimeSurface: options.runtimeSurface ?? null
    }
  };
}
function renderDebugEnvelope(viewModel) {
  const address = viewModel.debugEnvelope.returnAddress;
  const lines = [
    "",
    "Debug envelope:",
    `- file: ${viewModel.debugEnvelope.fileName}`
  ];
  if (viewModel.replyTarget) {
    lines.push(
      `- replyInstruction: Use tap_reply(to: "${viewModel.replyTarget}", subject: "<your-subject>", content: "<your-response>").`
    );
  } else {
    lines.push("- replyInstruction: unavailable; do not reply to unknown");
  }
  if (viewModel.returnRoute) {
    lines.push(`- returnRoute: ${viewModel.returnRoute}`);
  }
  if (viewModel.debugEnvelope.runtimeSurface?.trim()) {
    lines.push(
      `- runtimeSurface: ${viewModel.debugEnvelope.runtimeSurface.trim()}`
    );
  }
  if (address?.aliases?.length) {
    lines.push(`- aliases: ${address.aliases.join(", ")}`);
  }
  return lines;
}
function renderAgentMessagePrompt(viewModel, options = {}) {
  const replyInstructions = viewModel.replyTarget ? ["Reply:", `Reply available: ${viewModel.replyTarget}`] : [
    "Reply:",
    "Reply unavailable: no verified return route.",
    "No valid structured return route was provided; `unknown` is not a valid reply target.",
    "Preserve durable inbox evidence or ask tower/operator for a valid return route before replying.",
    "If the message is a review request, perform the review locally and report that the return route is missing.",
    'Do not reply to "unknown".'
  ];
  const lines = [
    `Tap message for ${viewModel.agentName}`,
    `From: ${viewModel.sender}`,
    `To: ${viewModel.recipient}`,
    `Subject: ${viewModel.subject}`,
    "",
    "Message:",
    viewModel.body,
    "",
    ...replyInstructions
  ];
  if (options.debugEnvelope) {
    lines.push(...renderDebugEnvelope(viewModel));
  }
  return lines.join("\n");
}
function buildTapMessagePrompt(options) {
  return renderAgentMessagePrompt(createTapMessageViewModel(options), {
    debugEnvelope: options.debugEnvelope
  });
}

// scripts/bridge/bridge-format.ts
function buildUserInput(candidate, agentName, heartbeats) {
  const sender = resolveAddressLabel(candidate.sender || "unknown", heartbeats);
  const recipient = resolveAddressLabel(
    candidate.recipient || agentName,
    heartbeats
  );
  const subject = candidate.subject || "(none)";
  return buildTapMessagePrompt({
    agentName,
    sender,
    recipient,
    subject,
    fileName: candidate.fileName,
    body: candidate.body,
    replyTo: candidate.sender || "unknown",
    returnAddress: candidate.fromAddress
  });
}
function writeProcessedMarker(stateDir, candidate, dispatchMode, threadId, turnId, blockedReason) {
  const payload = {
    requestFile: candidate.filePath,
    requestName: candidate.fileName,
    sender: candidate.sender,
    recipient: candidate.recipient,
    subject: candidate.subject,
    dispatchMode,
    threadId,
    turnId,
    blockedReason: blockedReason?.trim() || null,
    markedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
  writeFileSync2(
    getProcessedMarkerPath(stateDir, candidate.markerId),
    `${JSON.stringify(payload, null, 2)}
`,
    "utf8"
  );
}
function writeLastDispatch(stateDir, candidate, dispatchMode, threadId, turnId, blockedReason) {
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
    blockedReason: blockedReason?.trim() || null,
    dispatchedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
  writeFileSync2(
    join3(stateDir, "last-dispatch.json"),
    `${JSON.stringify(payload, null, 2)}
`,
    "utf8"
  );
}

// scripts/bridge/bridge-candidates.ts
var routingLogger = createBridgeLogger("routing");
function scanCandidates(inboxDir, agentId, agentName, aliasName) {
  const entries = readdirSync(inboxDir, { withFileTypes: true }).filter(
    (entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".md")
  ).map((entry) => {
    const filePath = join4(inboxDir, entry.name);
    const stats = statSync(filePath);
    return { entry, filePath, stats };
  }).sort((left, right) => left.stats.mtimeMs - right.stats.mtimeMs);
  const candidates = [];
  const rejected = [];
  let filteredByRecipient = 0;
  let filteredBySelf = 0;
  let filteredByHeadless = 0;
  for (const item of entries) {
    let body;
    try {
      body = readFileSync3(item.filePath, "utf8");
    } catch {
      continue;
    }
    const route = getInboxRoute(item.entry.name, body);
    if (!recipientMatchesAgent(route.recipient, agentId, agentName) && !(aliasName && recipientMatchesAgent(route.recipient, agentId, aliasName))) {
      filteredByRecipient += 1;
      continue;
    }
    if (isOwnMessageSender(route.sender, agentId, agentName) || aliasName && isOwnMessageSender(route.sender, agentId, aliasName)) {
      filteredBySelf += 1;
      continue;
    }
    if (shouldSkipInHeadlessMode(item.entry.name, body)) {
      filteredByHeadless += 1;
      continue;
    }
    const markerId = buildMarkerId(item.filePath, item.stats.mtimeMs);
    if (route.validationError) {
      rejected.push({
        markerId,
        filePath: item.filePath,
        fileName: item.entry.name,
        sender: route.sender,
        recipient: route.recipient,
        subject: route.subject,
        mtimeMs: item.stats.mtimeMs,
        rejectionReason: route.validationError
      });
      continue;
    }
    candidates.push({
      markerId,
      filePath: item.filePath,
      fileName: item.entry.name,
      sender: route.sender,
      recipient: route.recipient,
      subject: route.subject,
      body: stripBridgeFrontmatter(body),
      mtimeMs: item.stats.mtimeMs,
      messageId: route.messageId ?? null,
      fromAddress: route.fromAddress ?? null,
      toAddress: route.toAddress ?? null,
      scope: route.scope ?? null,
      action: route.action ?? null,
      consentRef: route.consentRef ?? null
    });
  }
  routingLogger.debug("candidate scan completed", {
    inboxDir,
    scanned: entries.length,
    matched: candidates.length,
    rejected: rejected.length,
    filteredByRecipient,
    filteredBySelf,
    filteredByHeadless,
    agentId,
    agentName,
    aliasName
  });
  return { candidates, rejected };
}
function buildMarkerId(filePath, mtimeMs) {
  return createHash("sha1").update(`${filePath}|${mtimeMs}`).digest("hex");
}
function getProcessedMarkerPath(stateDir, markerId) {
  return join4(stateDir, "processed", `${markerId}.done`);
}
var PROCESSED_MARKER_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1e3;
var PROCESSED_MARKER_GRACE_MS = 1e4;
function sweepOrphanProcessedMarkers(stateDir, options) {
  const result = {
    scanned: 0,
    removed: 0,
    kept: 0,
    errors: 0,
    removedMarkerIds: []
  };
  const dir = join4(stateDir, "processed");
  if (!existsSync3(dir)) {
    return result;
  }
  const now = options?.nowMs ?? Date.now();
  const maxAge = options?.maxAgeMs ?? PROCESSED_MARKER_MAX_AGE_MS;
  const grace = options?.graceMs ?? PROCESSED_MARKER_GRACE_MS;
  const log = options?.logger ?? (() => void 0);
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return result;
  }
  for (const file of entries) {
    if (!file.endsWith(".done")) {
      continue;
    }
    result.scanned += 1;
    const markerPath = join4(dir, file);
    let markerMtimeMs = 0;
    let sourcePath = null;
    try {
      markerMtimeMs = statSync(markerPath).mtimeMs;
      const payload = JSON.parse(readFileSync3(markerPath, "utf8"));
      sourcePath = typeof payload.requestFile === "string" && payload.requestFile.trim() ? payload.requestFile : null;
    } catch {
      result.errors += 1;
      continue;
    }
    const ageMs = now - markerMtimeMs;
    if (ageMs < grace) {
      result.kept += 1;
      continue;
    }
    const sourceExists = sourcePath ? existsSync3(sourcePath) : false;
    const agedOut = ageMs > maxAge;
    if (sourceExists && !agedOut) {
      result.kept += 1;
      continue;
    }
    try {
      unlinkSync(markerPath);
      result.removed += 1;
      const markerId = file.slice(0, -".done".length);
      result.removedMarkerIds.push(markerId);
      log("processed marker retired", {
        markerId,
        reason: !sourceExists ? "source_missing" : "aged_out",
        sourcePath,
        ageMs
      });
    } catch {
      result.errors += 1;
    }
  }
  return result;
}
function loadHeartbeats(commsDir) {
  try {
    return JSON.parse(readFileSync3(join4(commsDir, "heartbeats.json"), "utf8"));
  } catch {
    return {};
  }
}
function shouldSkipInHeadlessMode(fileName, body) {
  if (process.env.TAP_HEADLESS !== "true") return false;
  const combined = `${fileName}
${body}`;
  return HEADLESS_SKIP_PATTERNS.some((p) => p.test(combined));
}
function collectCandidates(inboxDir, agentId, agentName, aliasName) {
  return scanCandidates(inboxDir, agentId, agentName, aliasName).candidates;
}
function getPendingCandidates(options, cutoff) {
  const inboxDir = join4(options.commsDir, "inbox");
  if (!existsSync3(inboxDir)) {
    throw new Error(`Inbox directory not found: ${inboxDir}`);
  }
  const heartbeats = loadHeartbeats(options.commsDir);
  const refreshedName = refreshAgentIdentity(options, heartbeats);
  const cutoffMs = cutoff.getTime();
  const scan = scanCandidates(
    inboxDir,
    options.agentId,
    options.agentName,
    // M205: Also accept messages addressed to the heartbeat-refreshed name
    refreshedName !== options.agentName ? refreshedName : void 0
  );
  for (const rejection of scan.rejected) {
    if (rejection.mtimeMs < cutoffMs) {
      continue;
    }
    const markerPath = getProcessedMarkerPath(
      options.stateDir,
      rejection.markerId
    );
    if (existsSync3(markerPath)) {
      continue;
    }
    writeProcessedMarker(
      options.stateDir,
      {
        ...rejection,
        body: ""
      },
      "rejected",
      null,
      null,
      rejection.rejectionReason
    );
    routingLogger.warn("envelope rejected during candidate scan", {
      fileName: rejection.fileName,
      sender: rejection.sender || "unknown",
      recipient: rejection.recipient || options.agentName,
      subject: rejection.subject || "(none)",
      reason: rejection.rejectionReason
    });
  }
  const candidates = scan.candidates.filter((candidate) => {
    if (candidate.mtimeMs < cutoffMs) {
      return false;
    }
    return !existsSync3(
      getProcessedMarkerPath(options.stateDir, candidate.markerId)
    );
  });
  routingLogger.debug("pending candidates resolved", {
    agentId: options.agentId,
    configuredName: options.agentName,
    refreshedName: refreshedName !== options.agentName ? refreshedName : void 0,
    candidateCount: candidates.length,
    rejectedCount: scan.rejected.length,
    cutoff: cutoff.toISOString()
  });
  return { heartbeats, candidates };
}

// scripts/bridge/bridge-elicitation.ts
function hasObjectShape(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function isElicitationParams(value) {
  if (!hasObjectShape(value)) {
    return false;
  }
  return "requestedSchema" in value || "mode" in value || "url" in value;
}
function resolveElicitationParams(raw) {
  if (!hasObjectShape(raw)) {
    return null;
  }
  const queue = [raw];
  const visited = /* @__PURE__ */ new Set();
  while (queue.length > 0) {
    const candidate = queue.shift();
    if (candidate == null || visited.has(candidate)) {
      continue;
    }
    visited.add(candidate);
    if (isElicitationParams(candidate)) {
      return candidate;
    }
    if (!hasObjectShape(candidate)) {
      continue;
    }
    for (const key of ["params", "request", "payload", "elicitation"]) {
      const nested = candidate[key];
      if (nested != null) {
        queue.push(nested);
      }
    }
  }
  return null;
}
function firstEnumValue(values) {
  if (!Array.isArray(values)) {
    return void 0;
  }
  for (const entry of values) {
    if (typeof entry === "string") {
      return entry;
    }
    if (hasObjectShape(entry) && typeof entry.const === "string") {
      return entry.const;
    }
  }
  return void 0;
}
function buildRequiredStringValue(schema) {
  return typeof schema.title === "string" && schema.title.trim() ? schema.title.trim() : "approved";
}
function buildElicitationFieldValue(schema, required) {
  const defaultValue = schema.default;
  if (typeof defaultValue === "string" || typeof defaultValue === "number" || typeof defaultValue === "boolean") {
    return defaultValue;
  }
  if (Array.isArray(defaultValue) && defaultValue.every((entry) => typeof entry === "string")) {
    return defaultValue;
  }
  const type = typeof schema.type === "string" ? schema.type : null;
  if (type === "boolean") {
    return true;
  }
  if (type === "number" || type === "integer") {
    return typeof schema.minimum === "number" ? schema.minimum : 0;
  }
  if (type === "string") {
    return firstEnumValue(schema.enum) ?? firstEnumValue(schema.anyOf) ?? (required ? buildRequiredStringValue(schema) : "");
  }
  if (type === "array") {
    const minItems = typeof schema.minItems === "number" ? schema.minItems : void 0;
    const itemSchema = hasObjectShape(schema.items) ? schema.items : {};
    const itemValue = firstEnumValue(itemSchema.enum) ?? firstEnumValue(itemSchema.anyOf);
    if (itemValue) {
      return required || (minItems ?? 0) > 0 ? [itemValue] : [];
    }
    return [];
  }
  return firstEnumValue(schema.enum) ?? firstEnumValue(schema.anyOf) ?? void 0;
}
function isAutoElicitationRequestMethod(method) {
  return method === "elicitation/create" || method === "mcpServer/elicitation/request";
}
function buildAutoElicitationResult(rawParams) {
  const params = resolveElicitationParams(rawParams);
  if (!params) {
    return null;
  }
  if (params.mode === "url" || typeof params.url === "string") {
    return { action: "cancel" };
  }
  const requestedSchema = hasObjectShape(params.requestedSchema) ? params.requestedSchema : null;
  if (!requestedSchema) {
    return { action: "accept" };
  }
  const properties = hasObjectShape(requestedSchema.properties) ? requestedSchema.properties : {};
  const required = new Set(
    Array.isArray(requestedSchema.required) ? requestedSchema.required.filter(
      (entry) => typeof entry === "string"
    ) : []
  );
  const content = {};
  for (const [field, schema] of Object.entries(properties)) {
    if (!hasObjectShape(schema)) {
      continue;
    }
    const value = buildElicitationFieldValue(
      schema,
      required.has(field)
    );
    if (value !== void 0) {
      content[field] = value;
    }
  }
  return Object.keys(content).length > 0 ? { action: "accept", content } : { action: "accept" };
}

// scripts/bridge/bridge-dispatch.ts
import { randomUUID as randomUUID5 } from "crypto";
import {
  existsSync as existsSync6,
  mkdirSync as mkdirSync4,
  readFileSync as readFileSync5,
  renameSync as renameSync2,
  statSync as statSync3,
  unlinkSync as unlinkSync2,
  writeFileSync as writeFileSync5
} from "fs";
import { join as join7 } from "path";

// src/transport/experimental/codex-ipc-control.ts
import { randomUUID as randomUUID4 } from "crypto";

// src/transport/consent.ts
import { createHash as createHash2, randomBytes, randomUUID } from "crypto";
import { execFileSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
var CONSENT_RECEIPTS_DIRNAME = "tap-codex-a2a-consent";
var CONSENT_SECRETS_DIRNAME = "tap-codex-a2a-consent-secrets";
var DEFAULT_CONSENT_TTL_SECONDS = 10 * 60;
var CONSENT_METADATA_DRIFT_TOLERANCE_MS = 5e3;
var CONSENT_RESERVATION_TTL_MS = 3e4;
var pendingConsentReservations = /* @__PURE__ */ new Set();
var SCOPE_PRIORITY = {
  observe: 1,
  suggest: 2,
  drive: 3
};
var ConsentReceiptError = class extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = "ConsentReceiptError";
  }
  code;
};
function normalizeString(value) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}
function assertPendingReservationAvailable(consentRef) {
  if (!pendingConsentReservations.has(consentRef)) {
    return;
  }
  throw new ConsentReceiptError(
    "missing",
    `Consent receipt "${consentRef}" is already reserved or consumed.`
  );
}
function markPendingReservation(consentRef) {
  pendingConsentReservations.add(consentRef);
}
function clearPendingReservation(consentRef) {
  pendingConsentReservations.delete(consentRef);
}
function normalizeMethods(values) {
  const methods = /* @__PURE__ */ new Set();
  for (const value of values ?? []) {
    const normalized = value.trim();
    if (!normalized) continue;
    methods.add(normalized);
  }
  return [...methods].sort();
}
function normalizePathForComparison(value) {
  return path.resolve(value).replace(/\\/g, "/").toLowerCase();
}
function resolveReceiptsDir(explicitDir) {
  const configuredDir = explicitDir?.trim() || process.env.TAP_CONSENT_RECEIPTS_DIR?.trim();
  return configuredDir ? path.resolve(configuredDir) : path.join(os.tmpdir(), CONSENT_RECEIPTS_DIRNAME);
}
function resolveSecretsDir(explicitDir) {
  const configuredDir = explicitDir?.trim() || process.env.TAP_CONSENT_SECRETS_DIR?.trim();
  return configuredDir ? path.resolve(configuredDir) : path.join(os.tmpdir(), CONSENT_SECRETS_DIRNAME);
}
function resolveConsentDirs(options) {
  const receiptsDir = resolveReceiptsDir(options.receiptsDir);
  const secretsDir = resolveSecretsDir(options.secretsDir);
  if (normalizePathForComparison(receiptsDir) === normalizePathForComparison(secretsDir)) {
    throw new ConsentReceiptError(
      "invalid",
      "Consent receipts dir and secrets dir must be different paths."
    );
  }
  return { receiptsDir, secretsDir };
}
function hashPairTokenBinding(options) {
  return createHash2("sha256").update(
    [
      options.pairToken,
      options.hostId ?? "",
      options.conversationId,
      options.ownerClientId ?? ""
    ].join("\0"),
    "utf-8"
  ).digest("hex");
}
function readUtf8PreservingTimes(filePath) {
  const originalStats = fs.statSync(filePath);
  const contents = fs.readFileSync(filePath, "utf-8");
  try {
    fs.utimesSync(filePath, originalStats.atime, originalStats.mtime);
  } catch {
  }
  return contents;
}
function loadConsentReceipt(filePath) {
  try {
    const parsed = JSON.parse(
      readUtf8PreservingTimes(filePath)
    );
    if (typeof parsed.id !== "string" || typeof parsed.scope !== "string" || typeof parsed.conversationId !== "string" || typeof parsed.pairTokenHash !== "string" || typeof parsed.createdAt !== "string" || typeof parsed.expiresAt !== "string") {
      return null;
    }
    if (parsed.scope !== "observe" && parsed.scope !== "suggest" && parsed.scope !== "drive") {
      return null;
    }
    return {
      id: parsed.id,
      scope: parsed.scope,
      hostId: normalizeString(parsed.hostId),
      conversationId: parsed.conversationId,
      ownerClientId: normalizeString(parsed.ownerClientId),
      issuedByClientId: normalizeString(parsed.issuedByClientId),
      allowedMethods: normalizeMethods(parsed.allowedMethods),
      pairTokenHash: parsed.pairTokenHash,
      createdAt: parsed.createdAt,
      expiresAt: parsed.expiresAt
    };
  } catch {
    return null;
  }
}
function loadReservedReceiptRecord(filePath) {
  try {
    const parsed = JSON.parse(readUtf8PreservingTimes(filePath));
    return {
      receipt: loadConsentReceipt(filePath),
      reservationOwnerId: normalizeString(parsed.reservationOwnerId)
    };
  } catch {
    return {
      receipt: null,
      reservationOwnerId: null
    };
  }
}
function isExpired(receipt, now) {
  const expiresAtMs = new Date(receipt.expiresAt).getTime();
  return Number.isNaN(expiresAtMs) || expiresAtMs <= now.getTime();
}
function resolveSecretPath(secretsDir, receiptId) {
  return path.join(secretsDir, `${receiptId}.token`);
}
function resolveReservedReceiptPath(receiptsDir, receiptId) {
  return path.join(receiptsDir, `${receiptId}.reserved.json`);
}
function extractReceiptIdFromPath(filePath) {
  return path.basename(filePath).replace(/(?:\.reserved)?\.json$/i, "");
}
function isReceiptPath(fileName) {
  return /\.json$/i.test(fileName);
}
function resolveWindowsAclPrincipals() {
  const username = process.env.USERNAME?.trim();
  if (!username) return [];
  const principals = /* @__PURE__ */ new Set();
  const userDomain = process.env.USERDOMAIN?.trim();
  if (userDomain) {
    principals.add(`${userDomain}\\${username}`);
  }
  principals.add(username);
  return [...principals];
}
function applyWindowsPrivateAcl(targetPath) {
  if (process.platform !== "win32") return;
  const principals = resolveWindowsAclPrincipals();
  if (principals.length === 0) {
    throw new ConsentReceiptError(
      "invalid",
      `Unable to resolve a Windows principal for "${path.basename(targetPath)}".`
    );
  }
  let lastError = null;
  for (const principal of principals) {
    try {
      execFileSync(
        "icacls",
        [targetPath, "/inheritance:r", "/grant:r", `${principal}:F`],
        {
          stdio: "pipe",
          windowsHide: true
        }
      );
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw new ConsentReceiptError(
    "invalid",
    `Failed to apply Windows ACL hardening to "${path.basename(targetPath)}": ${lastError instanceof Error ? lastError.message : String(lastError)}`
  );
}
function hardenSecretStorePath(targetPath, mode) {
  try {
    fs.chmodSync(targetPath, mode);
  } catch {
  }
  applyWindowsPrivateAcl(targetPath);
}
function hasTimestampDrift(stats, mintedAtMs) {
  if (!Number.isFinite(mintedAtMs)) {
    return false;
  }
  return Math.abs(stats.mtimeMs - mintedAtMs) > CONSENT_METADATA_DRIFT_TOLERANCE_MS || Math.abs(stats.atimeMs - mintedAtMs) > CONSENT_METADATA_DRIFT_TOLERANCE_MS;
}
function stampMintedAt(targetPath, mintedAt) {
  fs.utimesSync(targetPath, mintedAt, mintedAt);
}
function stampReservationAt(targetPath, reservedAt) {
  fs.utimesSync(targetPath, reservedAt, reservedAt);
}
function resolveReceiptCreatedAtMs(receipt) {
  const createdAtMs = new Date(receipt.createdAt).getTime();
  if (Number.isNaN(createdAtMs)) {
    throw new ConsentReceiptError(
      "invalid",
      `Consent receipt "${receipt.id}" has an invalid createdAt timestamp.`
    );
  }
  return createdAtMs;
}
function resolveReceiptCreatedAt(receipt) {
  return new Date(resolveReceiptCreatedAtMs(receipt));
}
function isReservationExpired(stats, now) {
  return now.getTime() - stats.mtimeMs > CONSENT_RESERVATION_TTL_MS;
}
function assertUntamperedConsentPath(stats, receipt, label) {
  if (!hasTimestampDrift(stats, resolveReceiptCreatedAtMs(receipt))) {
    return;
  }
  throw new ConsentReceiptError(
    "invalid",
    `Consent ${label} "${receipt.id}" showed timestamp drift after mint.`
  );
}
function removeSecretPath(secretPath) {
  try {
    fs.rmSync(secretPath, { force: true });
  } catch {
  }
}
function removeReceiptPath(receiptPath) {
  try {
    fs.rmSync(receiptPath, { force: true });
  } catch {
  }
}
function writeActiveReceiptFile(filePath, receipt) {
  fs.writeFileSync(filePath, JSON.stringify(receipt, null, 2), "utf-8");
  stampMintedAt(filePath, resolveReceiptCreatedAt(receipt));
}
function writeReservedReceiptFile(filePath, receipt, reservationOwnerId, reservedAt) {
  fs.writeFileSync(
    filePath,
    JSON.stringify(
      {
        ...receipt,
        reservationOwnerId
      },
      null,
      2
    ),
    "utf-8"
  );
  stampReservationAt(filePath, reservedAt);
}
function cleanupExpiredReceipts(receiptsDir, secretsDir, now) {
  if (!fs.existsSync(receiptsDir)) return;
  for (const entry of fs.readdirSync(receiptsDir, { withFileTypes: true })) {
    if (!entry.isFile() || !isReceiptPath(entry.name)) continue;
    const filePath = path.join(receiptsDir, entry.name);
    const receipt = loadConsentReceipt(filePath);
    const receiptId = receipt?.id ?? extractReceiptIdFromPath(filePath);
    if (!receipt || isExpired(receipt, now)) {
      removeReceiptPath(filePath);
      removeSecretPath(resolveSecretPath(secretsDir, receiptId));
    }
  }
}
function listReceiptPaths(receiptsDir) {
  if (!fs.existsSync(receiptsDir)) return [];
  return fs.readdirSync(receiptsDir, { withFileTypes: true }).filter(
    (entry) => entry.isFile() && entry.name.endsWith(".json") && !entry.name.endsWith(".reserved.json")
  ).map((entry) => path.join(receiptsDir, entry.name)).sort();
}
function scopeSatisfies(actual, required) {
  return SCOPE_PRIORITY[actual] >= SCOPE_PRIORITY[required];
}
function resolveReceiptPath(receiptsDir, consentRef) {
  const normalizedConsentRef = normalizeString(consentRef);
  if (!normalizedConsentRef) return null;
  return path.join(receiptsDir, `${normalizedConsentRef}.json`);
}
function reserveReceiptPath(filePath, receipt, reservationOwnerId, now) {
  const reservedPath = resolveReservedReceiptPath(
    path.dirname(filePath),
    receipt.id
  );
  try {
    fs.renameSync(filePath, reservedPath);
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new ConsentReceiptError(
        "missing",
        `Consent receipt "${receipt.id}" is already reserved or consumed.`
      );
    }
    throw error;
  }
  writeReservedReceiptFile(reservedPath, receipt, reservationOwnerId, now);
  return reservedPath;
}
function mintPairToken() {
  return randomBytes(32).toString("base64url");
}
function writeSecretFile(secretPath, pairToken, mintedAt) {
  fs.writeFileSync(secretPath, pairToken, {
    encoding: "utf-8",
    mode: 384
  });
  stampMintedAt(secretPath, mintedAt);
  hardenSecretStorePath(secretPath, 384);
}
function assertNoLegacyPairTokenInput(options, context) {
  const legacyPairToken = options.pairToken;
  if (typeof legacyPairToken !== "undefined") {
    throw new ConsentReceiptError(
      "invalid",
      `${context} no longer accepts a caller-provided pairToken.`
    );
  }
}
function createConsentReceipt(options) {
  assertNoLegacyPairTokenInput(options, "createConsentReceipt");
  const now = options.now ?? /* @__PURE__ */ new Date();
  const { receiptsDir, secretsDir } = resolveConsentDirs(options);
  const scope = options.scope ?? "drive";
  const conversationId = options.conversationId.trim();
  if (!conversationId) {
    throw new ConsentReceiptError(
      "invalid",
      "Consent receipt requires a non-empty conversationId."
    );
  }
  fs.mkdirSync(receiptsDir, { recursive: true });
  fs.mkdirSync(secretsDir, { recursive: true, mode: 448 });
  hardenSecretStorePath(secretsDir, 448);
  cleanupExpiredReceipts(receiptsDir, secretsDir, now);
  const ttlSeconds = Math.max(
    1,
    options.ttlSeconds ?? DEFAULT_CONSENT_TTL_SECONDS
  );
  const receiptId = randomUUID();
  const hostId = normalizeString(options.hostId);
  const ownerClientId = normalizeString(options.ownerClientId);
  const pairToken = mintPairToken();
  const receipt = {
    id: receiptId,
    scope,
    hostId,
    conversationId,
    ownerClientId,
    issuedByClientId: normalizeString(options.issuedByClientId),
    allowedMethods: normalizeMethods(options.allowedMethods),
    pairTokenHash: hashPairTokenBinding({
      pairToken,
      hostId,
      conversationId,
      ownerClientId
    }),
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + ttlSeconds * 1e3).toISOString()
  };
  const filePath = path.join(receiptsDir, `${receipt.id}.json`);
  const secretPath = resolveSecretPath(secretsDir, receipt.id);
  const createdAt = new Date(receipt.createdAt);
  try {
    writeSecretFile(secretPath, pairToken, createdAt);
    fs.writeFileSync(filePath, JSON.stringify(receipt, null, 2), "utf-8");
    stampMintedAt(filePath, createdAt);
  } catch (error) {
    removeSecretPath(secretPath);
    removeReceiptPath(filePath);
    throw error;
  }
  return { receipt, filePath };
}
function prepareConsentReceipt(options) {
  assertNoLegacyPairTokenInput(options, "consumeConsentReceipt");
  const now = options.now ?? /* @__PURE__ */ new Date();
  const { receiptsDir, secretsDir } = resolveConsentDirs(options);
  cleanupExpiredReceipts(receiptsDir, secretsDir, now);
  const requiredScope = options.requiredScope ?? "drive";
  const method = normalizeString(options.method);
  const conversationId = options.conversationId.trim();
  const ownerClientId = normalizeString(options.ownerClientId);
  const hostId = normalizeString(options.hostId);
  const reservationOwnerId = normalizeString(options.reservationOwnerId);
  const explicitConsentRef = normalizeString(options.consentRef);
  if (!conversationId) {
    throw new ConsentReceiptError(
      "invalid",
      "Consent receipt consumption requires a conversationId."
    );
  }
  const explicitPath = resolveReceiptPath(receiptsDir, explicitConsentRef);
  const explicitReservedPath = explicitConsentRef ? resolveReservedReceiptPath(receiptsDir, explicitConsentRef) : null;
  const reservedConsentRef = explicitConsentRef;
  if (reservedConsentRef && explicitPath && explicitReservedPath && !fs.existsSync(explicitPath) && fs.existsSync(explicitReservedPath)) {
    assertPendingReservationAvailable(reservedConsentRef);
    const reservedRecord = loadReservedReceiptRecord(explicitReservedPath);
    const reservedReceipt = reservedRecord.receipt;
    const reservedReceiptId = reservedReceipt?.id ?? extractReceiptIdFromPath(explicitReservedPath);
    if (!reservedReceipt || isExpired(reservedReceipt, now)) {
      removeReceiptPath(explicitReservedPath);
      removeSecretPath(resolveSecretPath(secretsDir, reservedReceiptId));
    } else if (reservationOwnerId && reservedRecord.reservationOwnerId === reservationOwnerId && isReservationExpired(fs.statSync(explicitReservedPath), now)) {
      fs.renameSync(explicitReservedPath, explicitPath);
      writeActiveReceiptFile(explicitPath, reservedReceipt);
    } else {
      throw new ConsentReceiptError(
        "missing",
        `Consent receipt "${explicitConsentRef}" is already reserved or consumed.`
      );
    }
  }
  const candidatePaths = explicitPath ? [explicitPath] : listReceiptPaths(receiptsDir);
  let deferredError = null;
  for (const filePath of candidatePaths) {
    if (!fs.existsSync(filePath)) {
      if (explicitPath && explicitReservedPath && fs.existsSync(explicitReservedPath)) {
        throw new ConsentReceiptError(
          "missing",
          `Consent receipt "${explicitConsentRef}" is already reserved or consumed.`
        );
      }
      continue;
    }
    const receiptStats = fs.statSync(filePath);
    const receipt = loadConsentReceipt(filePath);
    if (!receipt) {
      removeReceiptPath(filePath);
      removeSecretPath(
        resolveSecretPath(secretsDir, extractReceiptIdFromPath(filePath))
      );
      continue;
    }
    if (isExpired(receipt, now)) {
      removeReceiptPath(filePath);
      removeSecretPath(resolveSecretPath(secretsDir, receipt.id));
      if (explicitPath) {
        throw new ConsentReceiptError(
          "expired",
          `Consent receipt "${receipt.id}" expired at ${receipt.expiresAt}.`
        );
      }
      continue;
    }
    const secretPath = resolveSecretPath(secretsDir, receipt.id);
    if (!fs.existsSync(secretPath)) {
      if (explicitPath) {
        throw new ConsentReceiptError(
          "missing",
          `Consent secret "${receipt.id}" was not found.`
        );
      }
      continue;
    }
    let receiptPrepared = false;
    let cleanupSecretOnFailure = true;
    try {
      assertUntamperedConsentPath(receiptStats, receipt, "receipt");
      const secretStats = fs.statSync(secretPath);
      assertUntamperedConsentPath(secretStats, receipt, "secret");
      const pairToken = readUtf8PreservingTimes(secretPath).trim();
      if (!pairToken) {
        throw new ConsentReceiptError(
          "invalid",
          `Consent secret "${receipt.id}" was empty.`
        );
      }
      const expectedHash = hashPairTokenBinding({
        pairToken,
        hostId,
        conversationId,
        ownerClientId
      });
      if (receipt.conversationId !== conversationId || receipt.ownerClientId !== ownerClientId || receipt.hostId !== hostId || receipt.pairTokenHash !== expectedHash) {
        if (explicitPath) {
          throw new ConsentReceiptError(
            "binding-mismatch",
            `Consent receipt "${receipt.id}" did not match the requested conversation binding.`
          );
        }
        continue;
      }
      if (!scopeSatisfies(receipt.scope, requiredScope)) {
        deferredError = new ConsentReceiptError(
          "scope-mismatch",
          `Consent receipt "${receipt.id}" grants ${receipt.scope}, not ${requiredScope}.`
        );
        if (explicitPath) throw deferredError;
        continue;
      }
      if (method && receipt.allowedMethods.length > 0 && !receipt.allowedMethods.includes(method)) {
        deferredError = new ConsentReceiptError(
          "method-mismatch",
          `Consent receipt "${receipt.id}" does not allow method "${method}".`
        );
        if (explicitPath) throw deferredError;
        continue;
      }
      let reservedReceiptPath;
      try {
        assertPendingReservationAvailable(receipt.id);
        reservedReceiptPath = reserveReceiptPath(
          filePath,
          receipt,
          reservationOwnerId,
          now
        );
      } catch (error) {
        cleanupSecretOnFailure = false;
        throw error;
      }
      markPendingReservation(receipt.id);
      receiptPrepared = true;
      return {
        receipt,
        commit() {
          if (!receiptPrepared) {
            return;
          }
          receiptPrepared = false;
          try {
            fs.rmSync(reservedReceiptPath, { force: false });
          } finally {
            clearPendingReservation(receipt.id);
            removeSecretPath(secretPath);
          }
        },
        abort() {
          if (!receiptPrepared) {
            return;
          }
          receiptPrepared = false;
          try {
            fs.renameSync(reservedReceiptPath, filePath);
            writeActiveReceiptFile(filePath, receipt);
          } finally {
            clearPendingReservation(receipt.id);
          }
        }
      };
    } finally {
      if (!receiptPrepared && cleanupSecretOnFailure) {
        removeSecretPath(secretPath);
      }
    }
  }
  if (deferredError) {
    throw deferredError;
  }
  throw new ConsentReceiptError(
    "missing",
    explicitPath ? `Consent receipt "${options.consentRef}" was not found.` : "No matching consent receipt was found for the requested drive action."
  );
}

// src/transport/consent-ledger.ts
import { randomUUID as randomUUID2 } from "crypto";
import * as fs2 from "fs";
import * as path2 from "path";
function normalizeString2(value) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}
function normalizeAddress(value) {
  if (!value) {
    return null;
  }
  const address = {
    hostId: normalizeString2(value.hostId),
    clientId: normalizeString2(value.clientId),
    conversationId: normalizeString2(value.conversationId),
    ownerClientId: normalizeString2(value.ownerClientId)
  };
  return Object.values(address).some((field) => field) ? address : null;
}
function isConsentLedgerEnabled() {
  const normalized = process.env.TAP_CONSENT_LEDGER?.trim().toLowerCase();
  if (!normalized) {
    return true;
  }
  return !["0", "false", "no", "off"].includes(normalized);
}
function resolveConsentLedgerDir(commsDir) {
  const resolvedCommsDir = normalizeString2(commsDir) ?? normalizeString2(process.env.TAP_COMMS_DIR);
  if (!resolvedCommsDir) {
    return null;
  }
  return path2.join(
    path2.resolve(resolvedCommsDir),
    "receipts",
    "consent-ledger"
  );
}
var MISSING_CONSENT_REF_ORPHAN_REASON = "missing_consent_ref";
function resolveGrantId(event, grantId) {
  if (grantId) {
    return {
      grantId,
      orphanReason: null
    };
  }
  if (event !== "rejected") {
    return {
      grantId: null,
      orphanReason: null
    };
  }
  return {
    grantId: `orphan-${Date.now().toString(36)}-${randomUUID2().slice(0, 8)}`,
    orphanReason: MISSING_CONSENT_REF_ORPHAN_REASON
  };
}
function formatLedgerTimestamp(value) {
  return value.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}
function buildLedgerFilePath(ledgerDir, record) {
  const timestamp = formatLedgerTimestamp(record.recordedAt);
  const shortGrantId = record.grantId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 8) || "unknown";
  const baseName = `${timestamp}-${record.event}-${shortGrantId}`;
  const preferredPath = path2.join(ledgerDir, `${baseName}.md`);
  if (!fs2.existsSync(preferredPath)) {
    return preferredPath;
  }
  return path2.join(
    ledgerDir,
    `${baseName}-${randomUUID2().replace(/-/g, "").slice(0, 6)}.md`
  );
}
function buildFrontmatter(record) {
  const fields = [
    ["type", "consent-ledger"],
    ["event", record.event],
    ["grant_id", record.grantId],
    ["orphan_reason", record.orphanReason],
    ["scope", record.scope],
    ["method", record.method],
    ["host_id", record.hostId],
    ["conversation_id", record.conversationId],
    ["issued_at", record.issuedAt],
    ["expires_at", record.expiresAt],
    ["consumed_at", record.consumedAt],
    ["recorded_at", record.recordedAt],
    ["result", record.result],
    ["issued_by_client_id", record.issuedByClientId],
    ["requester", record.requester],
    ["owner", record.owner]
  ];
  const lines = fields.map(
    ([key, value]) => `${key}: ${JSON.stringify(value ?? null)}`
  );
  return `---
${lines.join("\n")}
---

`;
}
function buildBody(record) {
  return [
    "# Consent Ledger Event",
    "",
    `- Event: \`${record.event}\``,
    `- Grant: \`${record.grantId}\``,
    ...record.orphanReason ? [`- Orphan Reason: \`${record.orphanReason}\``] : [],
    `- Scope: \`${record.scope}\``,
    `- Result: \`${record.result}\``,
    "",
    "## Owner",
    "",
    "```json",
    JSON.stringify(record.owner, null, 2),
    "```",
    "",
    "## Requester",
    "",
    "```json",
    JSON.stringify(record.requester, null, 2),
    "```",
    ""
  ].join("\n");
}
function writeConsentLedgerEvent(options) {
  if (!isConsentLedgerEnabled()) {
    return null;
  }
  const { grantId, orphanReason } = resolveGrantId(
    options.event,
    normalizeString2(options.grantId)
  );
  const result = normalizeString2(options.result);
  const ledgerDir = resolveConsentLedgerDir(options.commsDir);
  if (!grantId || !result || !ledgerDir) {
    return null;
  }
  const record = {
    event: options.event,
    grantId,
    orphanReason,
    scope: options.scope,
    method: normalizeString2(options.method),
    hostId: normalizeString2(options.hostId),
    conversationId: normalizeString2(options.conversationId),
    issuedAt: normalizeString2(options.issuedAt),
    expiresAt: normalizeString2(options.expiresAt),
    consumedAt: normalizeString2(options.consumedAt),
    recordedAt: normalizeString2(options.recordedAt) ?? (/* @__PURE__ */ new Date()).toISOString(),
    result,
    requester: normalizeAddress(options.requester),
    owner: normalizeAddress(options.owner),
    issuedByClientId: normalizeString2(options.issuedByClientId)
  };
  try {
    fs2.mkdirSync(ledgerDir, { recursive: true });
    const filePath = buildLedgerFilePath(ledgerDir, record);
    fs2.writeFileSync(
      filePath,
      buildFrontmatter(record) + buildBody(record),
      "utf-8"
    );
    return filePath;
  } catch {
    return null;
  }
}

// src/transport/experimental/codex-ipc-observe.ts
import * as net from "net";
import { randomUUID as randomUUID3 } from "crypto";

// src/transport/experimental/codex-ipc-endpoint.ts
import { tmpdir as tmpdir2 } from "os";
var DEFAULT_CODEX_IPC_WINDOWS_PIPE_PATH = String.raw`\\.\pipe\codex-ipc`;
function normalizeDirectory(value) {
  return value.replace(/[\\/]+$/, "");
}
function resolveCodexIpcPath(options = {}) {
  const env = options.env ?? process.env;
  const explicit = env.TAP_CODEX_IPC_PATH?.trim();
  if (explicit) return explicit;
  const platform = options.platform ?? process.platform;
  if (platform === "win32") return DEFAULT_CODEX_IPC_WINDOWS_PIPE_PATH;
  if (platform === "darwin") {
    const baseTmp = normalizeDirectory(
      options.tmpDir?.trim() || env.TMPDIR?.trim() || tmpdir2()
    );
    const uid = typeof options.uid === "number" && Number.isFinite(options.uid) ? options.uid : typeof process.getuid === "function" ? process.getuid() : null;
    if (uid == null) {
      throw new Error("Cannot resolve macOS Codex IPC socket without a uid.");
    }
    return `${baseTmp}/codex-ipc/ipc-${uid}.sock`;
  }
  return DEFAULT_CODEX_IPC_WINDOWS_PIPE_PATH;
}

// src/transport/experimental/codex-ipc-observe.ts
var MAX_FRAME_BYTES = 256 * 1024 * 1024;
var DEFAULT_REQUEST_TIMEOUT_MS = 5e3;
var DEFAULT_TARGETED_REQUEST_VERSION = 1;
function isTapIpcTraceEnabled() {
  const value = process.env.TAP_IPC_TRACE?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes" || value === "on";
}
function formatTraceValue(value) {
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  if (value === null) {
    return "null";
  }
  return JSON.stringify(value);
}
function formatTraceContext(context) {
  if (!context) return "";
  const entries = Object.entries(context).filter(
    ([, value]) => typeof value !== "undefined"
  );
  if (entries.length === 0) return "";
  return ` ${entries.map(([key, value]) => `${key}=${formatTraceValue(value)}`).join(" ")}`;
}
function resolveHostId(explicitHostId) {
  const normalizedExplicit = explicitHostId?.trim();
  if (normalizedExplicit) return normalizedExplicit;
  const computerName = process.env.COMPUTERNAME?.trim();
  if (computerName) return computerName;
  const hostName = process.env.HOSTNAME?.trim();
  if (hostName) return hostName;
  return null;
}
function asRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value;
}
function asString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
function getStringField(record, ...keys) {
  if (!record) return null;
  for (const key of keys) {
    const value = asString(record[key]);
    if (value) return value;
  }
  return null;
}
function normalizeTransportAddress(hostId, clientId, conversationId, ownerClientId) {
  return {
    hostId,
    clientId,
    conversationId,
    ownerClientId
  };
}
function extractConversationId(params) {
  return getStringField(params, "conversationId", "threadId") ?? getStringField(asRecord(params?.change), "conversationId", "threadId") ?? getStringField(asRecord(params?.thread), "id");
}
function listRecordKeys(value) {
  if (!value) return null;
  return Object.keys(value);
}
function encodeCodexIpcFrame(message) {
  const json = JSON.stringify(message);
  const payload = Buffer.from(json, "utf-8");
  const frame = Buffer.allocUnsafe(4 + payload.length);
  frame.writeUInt32LE(payload.length, 0);
  payload.copy(frame, 4);
  return frame;
}
function decodeCodexIpcFrames(buffer) {
  const messages = [];
  let offset = 0;
  while (offset + 4 <= buffer.length) {
    const frameLength = buffer.readUInt32LE(offset);
    if (frameLength > MAX_FRAME_BYTES) {
      throw new Error(
        `Codex IPC frame exceeds max size (${frameLength} bytes > ${MAX_FRAME_BYTES})`
      );
    }
    if (offset + 4 + frameLength > buffer.length) break;
    const json = buffer.toString("utf-8", offset + 4, offset + 4 + frameLength);
    messages.push(JSON.parse(json));
    offset += 4 + frameLength;
  }
  return {
    messages,
    remainder: buffer.subarray(offset)
  };
}
var ExperimentalCodexIpcObserveTransport = class {
  constructor(options = {}) {
    this.options = options;
    this.pipePath = options.pipePath ?? resolveCodexIpcPath();
    this.hostId = resolveHostId(options.hostId);
    this.clientType = options.clientType ?? "tap-observe";
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  }
  options;
  kind = "experimental-codex-ipc-observe";
  pipePath;
  hostId;
  clientType;
  requestTimeoutMs;
  listeners = /* @__PURE__ */ new Set();
  agents = /* @__PURE__ */ new Map();
  conversations = /* @__PURE__ */ new Map();
  pendingRequests = /* @__PURE__ */ new Map();
  socket = null;
  remainder = Buffer.alloc(0);
  connectedAt = null;
  ownClientId = null;
  snapshot = {
    transport: this.kind,
    connected: false,
    connectedAt: null,
    agents: [],
    conversations: []
  };
  handleData = (...args) => {
    const [chunk] = args;
    if (!Buffer.isBuffer(chunk)) {
      return;
    }
    this.remainder = Buffer.concat([this.remainder, chunk]);
    const decoded = decodeCodexIpcFrames(this.remainder);
    this.remainder = decoded.remainder;
    for (const message of decoded.messages) {
      this.handleMessage(message);
    }
  };
  handleError = (...args) => {
    const [error] = args;
    this.rejectPendingRequests(
      error instanceof Error ? error : new Error(String(error ?? "Codex IPC transport error"))
    );
  };
  handleClose = () => {
    this.rejectPendingRequests(new Error("Codex IPC transport closed"));
    this.remainder = Buffer.alloc(0);
    this.emitDisconnected(null);
    this.detachSocket();
  };
  async connect() {
    if (this.socket) {
      await this.disconnect();
    }
    this.trace("connect:start", {
      pipePath: this.pipePath,
      clientType: this.clientType,
      hostId: this.hostId
    });
    const socket = this.options.socketFactory?.(this.pipePath) ?? net.createConnection({
      path: this.pipePath
    });
    this.socket = socket;
    this.attachSocket(socket);
    await this.waitForConnect(socket);
    socket.setNoDelay?.(true);
    this.trace("connect:open", {
      pipePath: this.pipePath
    });
    const response = await this.sendRequest("initialize", {
      clientType: this.clientType
    });
    const result = asRecord(response.result);
    const clientId = getStringField(result, "clientId");
    if (!clientId) {
      throw new Error("Codex IPC initialize response did not include clientId");
    }
    this.ownClientId = clientId;
    this.connectedAt = (/* @__PURE__ */ new Date()).toISOString();
    this.snapshot = this.buildSnapshot(true);
    this.trace("connect:initialized", {
      clientId,
      connectedAt: this.connectedAt,
      handledByClientId: response.handledByClientId ?? null,
      resultType: response.resultType ?? null,
      resultKeys: listRecordKeys(result)
    });
    this.emit({
      kind: "transport-connected",
      receivedAt: this.connectedAt,
      method: "initialize",
      sourceAddress: normalizeTransportAddress(
        this.hostId,
        this.ownClientId,
        null,
        null
      ),
      payload: response,
      snapshot: this.snapshot
    });
    return this.snapshot;
  }
  async disconnect() {
    if (!this.socket) return;
    const socket = this.socket;
    this.detachSocket();
    this.rejectPendingRequests(new Error("Codex IPC transport disconnected"));
    this.remainder = Buffer.alloc(0);
    this.emitDisconnected({ reason: "disconnect" });
    socket.end();
    socket.destroy();
  }
  getSnapshot() {
    return this.snapshot;
  }
  subscribe(listener) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  attachSocket(socket) {
    socket.on("data", this.handleData);
    socket.on("error", this.handleError);
    socket.on("close", this.handleClose);
  }
  emitDisconnected(payload) {
    const receivedAt = (/* @__PURE__ */ new Date()).toISOString();
    this.connectedAt = null;
    this.snapshot = this.buildSnapshot(false);
    this.emit({
      kind: "transport-disconnected",
      receivedAt,
      method: null,
      sourceAddress: normalizeTransportAddress(
        this.hostId,
        this.ownClientId,
        null,
        null
      ),
      payload,
      snapshot: this.snapshot
    });
  }
  detachSocket() {
    if (!this.socket) return;
    this.socket.removeListener("data", this.handleData);
    this.socket.removeListener("error", this.handleError);
    this.socket.removeListener("close", this.handleClose);
    this.socket = null;
  }
  async waitForConnect(socket) {
    await new Promise((resolve7, reject) => {
      const cleanup = () => {
        clearTimeout(timeout);
        socket.removeListener("connect", onConnect);
        socket.removeListener("error", onError);
      };
      const onConnect = () => {
        cleanup();
        resolve7();
      };
      const onError = (...args) => {
        const [error] = args;
        cleanup();
        reject(
          error instanceof Error ? error : new Error(String(error ?? "Codex IPC connection failed"))
        );
      };
      const timeout = setTimeout(() => {
        cleanup();
        reject(
          new Error(
            `Timed out connecting to Codex IPC transport at ${this.pipePath}`
          )
        );
      }, this.requestTimeoutMs);
      socket.on("connect", onConnect);
      socket.on("error", onError);
    });
  }
  getHostId() {
    return this.hostId;
  }
  getOwnClientId() {
    return this.ownClientId;
  }
  trace(message, context) {
    if (!isTapIpcTraceEnabled()) {
      return;
    }
    const timestamp = (/* @__PURE__ */ new Date()).toISOString().replace("T", " ").replace("Z", " UTC");
    console.log(
      `[${timestamp}] TAP_IPC_TRACE [${this.kind}] ${message}${formatTraceContext(context)}`
    );
  }
  resolveRequestVersion(_method, targetClientId) {
    if (this.options.protocolVersion !== null) {
      const configuredVersion = this.options.protocolVersion;
      if (typeof configuredVersion !== "undefined") {
        return configuredVersion;
      }
    }
    if (targetClientId?.trim()) {
      return DEFAULT_TARGETED_REQUEST_VERSION;
    }
    return null;
  }
  async sendRequest(method, params, targetClientId) {
    if (!this.socket) {
      throw new Error("Codex IPC observe transport is not connected");
    }
    const requestId = randomUUID3();
    const message = {
      type: "request",
      requestId,
      method,
      params
    };
    if (this.ownClientId) {
      message.sourceClientId = this.ownClientId;
    }
    const requestVersion = this.resolveRequestVersion(method, targetClientId);
    if (requestVersion !== null) {
      message.version = requestVersion;
    }
    if (targetClientId) {
      message.targetClientId = targetClientId;
    }
    this.trace("request:send", {
      requestId,
      method,
      targetClientId: targetClientId ?? null,
      version: message.version ?? null,
      conversationId: extractConversationId(params ?? null),
      paramKeys: listRecordKeys(params ?? null)
    });
    const promise = new Promise((resolve7, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(
          new Error(
            `Codex IPC request "${method}" timed out after ${this.requestTimeoutMs}ms`
          )
        );
      }, this.requestTimeoutMs);
      this.pendingRequests.set(requestId, { resolve: resolve7, reject, timeout });
    });
    this.socket.write(encodeCodexIpcFrame(message));
    return promise;
  }
  handleMessage(message) {
    if (message.type === "response") {
      this.handleResponse(message);
      return;
    }
    if (message.type === "broadcast") {
      this.handleBroadcast(message);
    }
  }
  handleResponse(message) {
    const requestId = asString(message.requestId);
    if (!requestId) return;
    const pending = this.pendingRequests.get(requestId);
    if (!pending) return;
    clearTimeout(pending.timeout);
    this.pendingRequests.delete(requestId);
    this.trace("response:recv", {
      requestId,
      method: message.method ?? null,
      resultType: message.resultType ?? null,
      handledByClientId: message.handledByClientId ?? null,
      hasError: message.error != null,
      hasResult: typeof message.result !== "undefined"
    });
    if (message.resultType === "error") {
      pending.reject(
        new Error(
          `Codex IPC request failed: ${JSON.stringify(message.error ?? {})}`
        )
      );
      return;
    }
    pending.resolve(message);
  }
  handleBroadcast(message) {
    const method = message.method ?? null;
    const params = asRecord(message.params);
    const sourceClientId = asString(message.sourceClientId);
    const receivedAt = (/* @__PURE__ */ new Date()).toISOString();
    this.trace("broadcast:recv", {
      method,
      sourceClientId,
      conversationId: extractConversationId(params),
      version: message.version ?? null
    });
    if (method === "client-status-changed") {
      const clientId = getStringField(params, "clientId");
      if (clientId) {
        this.upsertAgent(clientId, {
          name: getStringField(params, "clientType"),
          metadata: {
            status: getStringField(params, "status"),
            clientType: getStringField(params, "clientType")
          }
        });
        this.snapshot = this.buildSnapshot(true);
        this.emit({
          kind: "agent-status",
          receivedAt,
          method,
          sourceAddress: normalizeTransportAddress(
            this.hostId,
            clientId,
            null,
            null
          ),
          payload: message,
          snapshot: this.snapshot
        });
      }
      return;
    }
    if (method === "thread-stream-state-changed") {
      const conversationId = extractConversationId(params);
      if (conversationId) {
        const ownerClientId = sourceClientId;
        if (ownerClientId) {
          this.upsertAgent(ownerClientId, {
            name: null,
            metadata: {}
          });
        }
        this.conversations.set(conversationId, {
          id: conversationId,
          address: normalizeTransportAddress(
            this.hostId,
            ownerClientId,
            conversationId,
            ownerClientId
          ),
          metadata: {
            change: params?.change ?? null,
            lastMethod: method,
            sourceClientId: ownerClientId
          }
        });
        this.snapshot = this.buildSnapshot(true);
        this.emit({
          kind: "conversation-state",
          receivedAt,
          method,
          sourceAddress: normalizeTransportAddress(
            this.hostId,
            ownerClientId,
            conversationId,
            ownerClientId
          ),
          payload: message,
          snapshot: this.snapshot
        });
        return;
      }
    }
    this.snapshot = this.buildSnapshot(true);
    this.emit({
      kind: "raw",
      receivedAt,
      method,
      sourceAddress: normalizeTransportAddress(
        this.hostId,
        sourceClientId,
        extractConversationId(params),
        sourceClientId
      ),
      payload: message,
      snapshot: this.snapshot
    });
  }
  upsertAgent(clientId, update) {
    const existing = this.agents.get(clientId);
    this.agents.set(clientId, {
      id: clientId,
      name: update.name ?? existing?.name ?? null,
      address: normalizeTransportAddress(this.hostId, clientId, null, null),
      metadata: {
        ...existing?.metadata ?? {},
        ...update.metadata
      }
    });
  }
  buildSnapshot(connected) {
    return {
      transport: this.kind,
      connected,
      connectedAt: connected ? this.connectedAt : null,
      agents: [...this.agents.values()].sort(
        (a, b) => a.id.localeCompare(b.id)
      ),
      conversations: [...this.conversations.values()].sort(
        (a, b) => a.id.localeCompare(b.id)
      )
    };
  }
  rejectPendingRequests(error) {
    for (const [requestId, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(error);
      this.pendingRequests.delete(requestId);
    }
  }
  emit(event) {
    for (const listener of this.listeners) {
      void listener(event);
    }
  }
};

// src/transport/experimental/codex-ipc-control.ts
function asJsonRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value;
}
var CODEX_IPC_DRIVE_METHODS = [
  "thread-follower-start-turn",
  "thread-follower-steer-turn",
  "thread-follower-interrupt-turn",
  "thread-follower-edit-last-user-turn",
  "thread-follower-submit-user-input",
  "thread-follower-submit-mcp-server-elicitation-response",
  "thread-follower-command-approval-decision",
  "thread-follower-file-approval-decision",
  "thread-follower-permissions-request-approval-response",
  "thread-follower-compact-thread",
  "thread-follower-set-model-and-reasoning",
  "thread-follower-set-collaboration-mode",
  "thread-follower-set-queued-follow-ups-state"
];
var STABILITY_GUARDED_METHODS = /* @__PURE__ */ new Set([
  "thread-follower-start-turn"
]);
var globalLocksKey = /* @__PURE__ */ Symbol.for("tap-comms:conversationLocks");
var globalDriveTimeKey = /* @__PURE__ */ Symbol.for("tap-comms:conversationLastDriveTime");
var globalStabilityGuardStore = globalThis;
var sharedConversationLocks = globalStabilityGuardStore[globalLocksKey] ?? /* @__PURE__ */ new Map();
if (!globalStabilityGuardStore[globalLocksKey]) {
  globalStabilityGuardStore[globalLocksKey] = sharedConversationLocks;
}
var sharedConversationLastDriveTime = globalStabilityGuardStore[globalDriveTimeKey] ?? /* @__PURE__ */ new Map();
if (!globalStabilityGuardStore[globalDriveTimeKey]) {
  globalStabilityGuardStore[globalDriveTimeKey] = sharedConversationLastDriveTime;
}
function normalizeAddress2(value) {
  return {
    hostId: value.hostId?.trim() || null,
    clientId: value.clientId?.trim() || null,
    conversationId: value.conversationId?.trim() || null,
    ownerClientId: value.ownerClientId?.trim() || null
  };
}
function isDriveMethod(method) {
  return CODEX_IPC_DRIVE_METHODS.includes(method);
}
function normalizeMethod(method) {
  const normalized = method.trim();
  if (!isDriveMethod(normalized)) {
    throw new Error(`Unsupported Codex IPC drive method "${method}".`);
  }
  return normalized;
}
function normalizeActionLabel(action, method) {
  const normalized = action?.trim();
  return normalized || method;
}
function asRecord2(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value;
}
function listRecordKeys2(value) {
  if (!value) {
    return null;
  }
  return Object.keys(value);
}
function summarizeDriveParams(params) {
  const turnStartParams = asRecord2(params?.turnStartParams);
  const input = Array.isArray(turnStartParams?.input) ? turnStartParams.input : null;
  const textLength = input?.reduce((total, item) => {
    const record = asRecord2(item);
    return total + (typeof record?.text === "string" ? record.text.length : 0);
  }, 0);
  return {
    paramKeys: listRecordKeys2(params),
    turnStartParamKeys: listRecordKeys2(turnStartParams),
    inputItemCount: input?.length ?? null,
    textLength: textLength ?? null
  };
}
function extractDriveTurnId(response) {
  const result = asRecord2(response.result);
  const nested = asRecord2(result?.result);
  const turn = asRecord2(result?.turn) ?? asRecord2(nested?.turn);
  const turnId = turn?.id;
  return typeof turnId === "string" && turnId.trim() ? turnId.trim() : null;
}
function extractConversationLastTurnStatus(conversation) {
  const change = asRecord2(conversation?.metadata.change);
  const turn = asRecord2(change?.turn);
  const turnStatus = turn?.status;
  if (typeof turnStatus === "string" && turnStatus.trim()) {
    return turnStatus.trim();
  }
  const conversationState = asRecord2(change?.conversationState);
  const turns = Array.isArray(conversationState?.turns) ? conversationState.turns : null;
  const lastTurn = turns?.length ? asRecord2(turns[turns.length - 1]) : null;
  const lastStatus = lastTurn?.status;
  return typeof lastStatus === "string" && lastStatus.trim() ? lastStatus.trim() : null;
}
function extractRejectionResult(error) {
  if (error && typeof error === "object" && "code" in error && typeof error.code === "string") {
    return error.code;
  }
  return "execution-rejected";
}
function buildFollowerStartTurnParams(options) {
  const turnStartParams = { ...options.turnStartParams ?? {} };
  const text = options.text.trim();
  if (!text) {
    throw new Error(
      "thread-follower-start-turn requires a non-empty text input."
    );
  }
  const existingInput = Array.isArray(turnStartParams.input) ? turnStartParams.input : null;
  if (!existingInput) {
    turnStartParams.input = [
      {
        type: "text",
        text,
        text_elements: []
      }
    ];
  }
  if (!Array.isArray(turnStartParams.attachments)) {
    turnStartParams.attachments = [];
  }
  if (!Array.isArray(turnStartParams.commentAttachments)) {
    turnStartParams.commentAttachments = [];
  }
  if (typeof turnStartParams.inheritThreadSettings !== "boolean") {
    turnStartParams.inheritThreadSettings = true;
  }
  return {
    conversationId: options.conversationId,
    turnStartParams
  };
}
var ExperimentalCodexIpcControlTransport = class extends ExperimentalCodexIpcObserveTransport {
  kind = "experimental-codex-ipc-control";
  commsDir;
  receiptsDir;
  secretsDir;
  defaultConsentTtlSeconds;
  reservationOwnerId;
  conversationLocks = sharedConversationLocks;
  conversationLastDriveTime = sharedConversationLastDriveTime;
  COOLDOWN_MS = 1e4;
  LOCK_TIMEOUT_MS = 6e4;
  RECIPIENT_STATE_WAIT_MS = 750;
  constructor(options = {}) {
    super({
      ...options,
      clientType: options.clientType ?? "tap-control"
    });
    this.commsDir = options.commsDir;
    this.receiptsDir = options.receiptsDir;
    this.secretsDir = options.secretsDir;
    this.defaultConsentTtlSeconds = options.defaultConsentTtlSeconds ?? DEFAULT_CONSENT_TTL_SECONDS;
    this.reservationOwnerId = options.reservationOwnerId?.trim() || randomUUID4();
    this.subscribe((event) => {
      if (event.kind === "conversation-state") {
        const conversationId = event.sourceAddress.conversationId;
        if (!conversationId) return;
        const payload = asJsonRecord(event.payload);
        const params = asJsonRecord(payload?.params);
        const change = asJsonRecord(params?.change);
        const turn = asJsonRecord(change?.turn);
        if (turn) {
          const status = turn.status;
          this.trace("guard:observe-turn-status", {
            conversationId,
            turnId: turn.id,
            status
          });
          if (status === "completed" || status === "failed" || status === "cancelled") {
            this.trace("guard:release-lock", {
              conversationId,
              turnId: turn.id,
              status
            });
            this.releaseLock(conversationId);
          }
        }
      }
    });
  }
  acquireLock(conversationId) {
    const existing = this.conversationLocks.get(conversationId);
    if (existing?.timer) {
      clearTimeout(existing.timer);
    }
    const timer = setTimeout(() => {
      this.trace("guard:lock-timeout", { conversationId });
      this.conversationLocks.delete(conversationId);
    }, this.LOCK_TIMEOUT_MS);
    if (timer && typeof timer.unref === "function") {
      timer.unref();
    }
    this.conversationLocks.set(conversationId, { timer });
  }
  releaseLock(conversationId) {
    const existing = this.conversationLocks.get(conversationId);
    if (existing) {
      if (existing.timer) {
        clearTimeout(existing.timer);
      }
      this.conversationLocks.delete(conversationId);
    }
  }
  getConversationSnapshot(conversationId) {
    return this.getSnapshot().conversations.find(
      (conversation) => conversation.id === conversationId
    ) ?? null;
  }
  async waitForConversationSnapshot(conversationId) {
    const existing = this.getConversationSnapshot(conversationId);
    if (existing) return existing;
    return await new Promise((resolve7) => {
      let unsubscribe = null;
      const timeout = setTimeout(() => {
        unsubscribe?.();
        resolve7(this.getConversationSnapshot(conversationId));
      }, this.RECIPIENT_STATE_WAIT_MS);
      if (typeof timeout.unref === "function") {
        timeout.unref();
      }
      unsubscribe = this.subscribe((event) => {
        if (event.kind !== "conversation-state" || event.sourceAddress.conversationId !== conversationId) {
          return;
        }
        clearTimeout(timeout);
        unsubscribe?.();
        resolve7(
          event.snapshot.conversations.find(
            (conversation) => conversation.id === conversationId
          ) ?? this.getConversationSnapshot(conversationId)
        );
      });
    });
  }
  async assertRecipientCanStartTurn(conversationId, method) {
    const conversation = await this.waitForConversationSnapshot(conversationId);
    const lastStatus = extractConversationLastTurnStatus(conversation);
    if (lastStatus === "inProgress") {
      this.trace("guard:recipient-active-turn", {
        conversationId,
        method,
        lastStatus
      });
      throw new Error(
        `[Stability Guard] Recipient conversation "${conversationId}" has an active in-progress turn; refusing "${method}" to avoid a stuck nested turn.`
      );
    }
  }
  createConsentReceipt(options) {
    const targetAddress = this.resolveConversationTargetAddress(
      options.conversationId,
      {
        hostId: options.hostId ?? null,
        ownerClientId: options.ownerClientId ?? null
      }
    );
    const createOptions = {
      receiptsDir: this.receiptsDir,
      secretsDir: this.secretsDir,
      scope: options.scope ?? "drive",
      hostId: targetAddress.hostId,
      conversationId: options.conversationId,
      ownerClientId: targetAddress.ownerClientId,
      issuedByClientId: this.getOwnClientId(),
      ttlSeconds: options.ttlSeconds ?? this.defaultConsentTtlSeconds,
      allowedMethods: [...options.allowedMethods ?? []]
    };
    const created = createConsentReceipt(createOptions);
    writeConsentLedgerEvent({
      commsDir: this.commsDir,
      event: "issued",
      grantId: created.receipt.id,
      scope: created.receipt.scope,
      method: created.receipt.allowedMethods.length === 1 ? created.receipt.allowedMethods[0] : null,
      hostId: created.receipt.hostId,
      conversationId: created.receipt.conversationId,
      issuedAt: created.receipt.createdAt,
      expiresAt: created.receipt.expiresAt,
      result: "granted",
      requester: this.buildSourceAddress(options.conversationId, targetAddress),
      owner: targetAddress,
      issuedByClientId: created.receipt.issuedByClientId
    });
    return created;
  }
  createStartTurnSuggestion(options) {
    return this.createSuggestion({
      conversationId: options.conversationId,
      method: "thread-follower-start-turn",
      params: buildFollowerStartTurnParams(options),
      action: options.action ?? "start-turn",
      consentRef: options.consentRef ?? null
    });
  }
  createSuggestion(options) {
    const method = normalizeMethod(options.method);
    const targetAddress = this.resolveConversationTargetAddress(
      options.conversationId
    );
    const sourceAddress = this.buildSourceAddress(
      options.conversationId,
      targetAddress
    );
    return {
      id: randomUUID4(),
      createdAt: (/* @__PURE__ */ new Date()).toISOString(),
      status: "pending-owner-approval",
      scope: "suggest",
      method,
      action: normalizeActionLabel(options.action, method),
      conversationId: options.conversationId,
      payload: options.params ?? null,
      sourceAddress,
      targetAddress,
      consentRef: options.consentRef?.trim() || null
    };
  }
  async startTurn(options) {
    return this.driveAction({
      conversationId: options.conversationId,
      method: "thread-follower-start-turn",
      params: buildFollowerStartTurnParams(options),
      action: options.action ?? "start-turn",
      consentRef: options.consentRef ?? null,
      hostId: options.hostId ?? null,
      ownerClientId: options.ownerClientId ?? null
    });
  }
  async driveAction(options) {
    const method = normalizeMethod(options.method);
    const conversationId = options.conversationId.trim();
    const isGuarded = STABILITY_GUARDED_METHODS.has(method);
    const targetAddress = this.resolveConversationTargetAddress(
      conversationId,
      {
        hostId: options.hostId ?? null,
        ownerClientId: options.ownerClientId ?? null
      }
    );
    const ownerClientId = targetAddress.ownerClientId?.trim();
    if (!ownerClientId) {
      throw new Error(
        `Conversation "${conversationId}" does not have a live ownerClientId.`
      );
    }
    const sourceAddress = this.buildSourceAddress(
      conversationId,
      targetAddress
    );
    this.trace("drive:prepare", {
      conversationId,
      method,
      action: normalizeActionLabel(options.action, method),
      consentRef: options.consentRef ?? null,
      hostId: targetAddress.hostId,
      ownerClientId,
      ...summarizeDriveParams(options.params)
    });
    let preparedReceipt = null;
    let guardLockAcquired = false;
    try {
      preparedReceipt = prepareConsentReceipt({
        receiptsDir: this.receiptsDir,
        secretsDir: this.secretsDir,
        consentRef: options.consentRef ?? null,
        requiredScope: "drive",
        method,
        hostId: targetAddress.hostId,
        conversationId,
        ownerClientId,
        reservationOwnerId: this.reservationOwnerId
      });
      if (isGuarded) {
        await this.assertRecipientCanStartTurn(conversationId, method);
        if (this.conversationLocks.has(conversationId)) {
          this.trace("guard:locked", { conversationId, method });
          throw new Error(
            `[Stability Guard] Rejecting "${method}". Conversation "${conversationId}" has an active in-progress turn.`
          );
        }
        const now = Date.now();
        const lastDrive = this.conversationLastDriveTime.get(conversationId) ?? 0;
        const elapsed = now - lastDrive;
        if (elapsed < this.COOLDOWN_MS) {
          const waitTime = this.COOLDOWN_MS - elapsed;
          this.trace("guard:cooldown", {
            conversationId,
            method,
            remainingMs: waitTime
          });
          throw new Error(
            `[Stability Guard] Cooldown active for "${method}" on conversation "${conversationId}". Wait ${Math.ceil(waitTime / 1e3)}s.`
          );
        }
        this.acquireLock(conversationId);
        guardLockAcquired = true;
      }
      this.trace("drive:request", {
        conversationId,
        method,
        ownerClientId
      });
      const response = await this.sendRequest(
        method,
        options.params,
        ownerClientId
      );
      this.trace("drive:response", {
        conversationId,
        method,
        ownerClientId,
        turnId: extractDriveTurnId(response),
        resultType: response.resultType ?? null
      });
      preparedReceipt.commit();
      if (isGuarded) {
        this.conversationLastDriveTime.set(conversationId, Date.now());
      }
      const executedAt = (/* @__PURE__ */ new Date()).toISOString();
      writeConsentLedgerEvent({
        commsDir: this.commsDir,
        event: "consumed",
        grantId: preparedReceipt.receipt.id,
        scope: preparedReceipt.receipt.scope,
        method,
        hostId: targetAddress.hostId,
        conversationId,
        issuedAt: preparedReceipt.receipt.createdAt,
        expiresAt: preparedReceipt.receipt.expiresAt,
        consumedAt: executedAt,
        recordedAt: executedAt,
        result: "executed",
        requester: sourceAddress,
        owner: targetAddress,
        issuedByClientId: preparedReceipt.receipt.issuedByClientId
      });
      return {
        executedAt,
        scope: "drive",
        method,
        action: normalizeActionLabel(options.action, method),
        conversationId,
        sourceAddress,
        targetAddress,
        consentRef: preparedReceipt.receipt.id,
        receipt: preparedReceipt.receipt,
        response
      };
    } catch (error) {
      if (guardLockAcquired) this.releaseLock(conversationId);
      this.trace("drive:error", {
        conversationId,
        method,
        ownerClientId,
        error: error instanceof Error ? error.stack ?? error.message : String(error)
      });
      preparedReceipt?.abort();
      writeConsentLedgerEvent({
        commsDir: this.commsDir,
        event: "rejected",
        grantId: preparedReceipt?.receipt.id ?? options.consentRef ?? null,
        scope: preparedReceipt?.receipt.scope ?? "drive",
        method,
        hostId: targetAddress.hostId,
        conversationId,
        issuedAt: preparedReceipt?.receipt.createdAt ?? null,
        expiresAt: preparedReceipt?.receipt.expiresAt ?? null,
        recordedAt: (/* @__PURE__ */ new Date()).toISOString(),
        result: extractRejectionResult(error),
        requester: sourceAddress,
        owner: targetAddress,
        issuedByClientId: preparedReceipt?.receipt.issuedByClientId ?? this.getOwnClientId()
      });
      throw error;
    }
  }
  resolveConversationTargetAddress(conversationId, fallback) {
    const normalizedConversationId = conversationId.trim();
    if (!normalizedConversationId) {
      throw new Error(
        "Codex IPC control actions require a non-empty conversationId."
      );
    }
    const conversation = this.getSnapshot().conversations.find(
      (candidate) => candidate.id === normalizedConversationId
    );
    if (conversation) {
      return normalizeAddress2(conversation.address);
    }
    const ownerClientId = fallback?.ownerClientId?.trim() || null;
    const hostId = fallback?.hostId?.trim() || this.getHostId();
    if (!ownerClientId) {
      throw new Error(
        `Conversation "${normalizedConversationId}" is not present in the current observe snapshot.`
      );
    }
    return {
      hostId,
      clientId: ownerClientId,
      conversationId: normalizedConversationId,
      ownerClientId
    };
  }
  buildSourceAddress(conversationId, targetAddress) {
    return {
      hostId: this.getHostId(),
      clientId: this.getOwnClientId(),
      conversationId,
      ownerClientId: targetAddress.ownerClientId
    };
  }
};

// scripts/bridge/bridge-dispatch.ts
var dispatchLogger = createBridgeLogger("dispatch");
var heartbeatLogger = createBridgeLogger("heartbeat");
var DRIVE_DISPATCH_RESERVATION_OWNER_ID = randomUUID5();
var DRIVE_NOT_YET_WIRED_REASON = "missing pairToken / drive not yet wired (M345 Phase 2 / M355 pending)";
var DRIVE_ACTION_NOT_YET_SUPPORTED_REASON = "drive action is not yet wired through bridge dispatch";
var DRIVE_START_TURN_ACTIONS = /* @__PURE__ */ new Set([
  "start-turn",
  "thread-follower-start-turn"
]);
function asRecord3(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value;
}
function extractDriveTurnId2(result) {
  const response = asRecord3(result);
  const payload = asRecord3(response?.response);
  const body = asRecord3(payload?.result);
  const nestedResult = asRecord3(body?.result);
  const turn = asRecord3(body?.turn) ?? asRecord3(nestedResult?.turn);
  const turnId = turn?.id;
  return typeof turnId === "string" && turnId.trim() ? turnId.trim() : null;
}
function shouldTraceIpc() {
  const value = process.env.TAP_IPC_TRACE?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes" || value === "on";
}
function logIpcTrace(message, context) {
  if (!shouldTraceIpc()) {
    return;
  }
  dispatchLogger.info(`[ipc-trace] ${message}`, context);
}
function createDriveDispatchTransport(options) {
  return new ExperimentalCodexIpcControlTransport({
    commsDir: options.commsDir,
    hostId: resolveBridgeHostId(options),
    clientType: "tap-bridge-dispatch",
    reservationOwnerId: DRIVE_DISPATCH_RESERVATION_OWNER_ID
  });
}
function buildInvalidDriveEnvelopeReason(reason) {
  return `invalid drive envelope: ${reason}`;
}
function normalizeDriveStartTurnAction(action) {
  const normalized = action?.trim() || null;
  if (!normalized) return null;
  return DRIVE_START_TURN_ACTIONS.has(normalized) ? "thread-follower-start-turn" : null;
}
function rejectDriveEnvelope(options, candidate, threadId, reason) {
  writeProcessedMarker(
    options.stateDir,
    candidate,
    "rejected",
    threadId,
    null,
    reason
  );
  writeLastDispatch(
    options.stateDir,
    candidate,
    "rejected",
    threadId,
    null,
    reason
  );
  writeConsentLedgerEvent({
    commsDir: options.commsDir,
    event: "rejected",
    grantId: candidate.consentRef?.trim() || null,
    scope: "drive",
    method: candidate.action ?? null,
    hostId: candidate.toAddress?.hostId ?? null,
    conversationId: candidate.toAddress?.conversationId ?? threadId,
    recordedAt: (/* @__PURE__ */ new Date()).toISOString(),
    result: reason,
    requester: candidate.fromAddress ?? null,
    owner: candidate.toAddress ?? null
  });
  dispatchLogger.warn("rejected malformed drive envelope", {
    fileName: candidate.fileName,
    messageId: candidate.messageId ?? null,
    conversationId: candidate.toAddress?.conversationId ?? null,
    action: candidate.action ?? null,
    consentRef: candidate.consentRef ?? null,
    reason
  });
  return true;
}
function blockDriveEnvelope(options, candidate, threadId, reason) {
  writeLastDispatch(
    options.stateDir,
    candidate,
    "blocked",
    threadId,
    null,
    reason
  );
  writeConsentLedgerEvent({
    commsDir: options.commsDir,
    event: "rejected",
    grantId: candidate.consentRef?.trim() || null,
    scope: "drive",
    method: candidate.action ?? null,
    hostId: candidate.toAddress?.hostId ?? null,
    conversationId: candidate.toAddress?.conversationId ?? threadId,
    recordedAt: (/* @__PURE__ */ new Date()).toISOString(),
    result: reason,
    requester: candidate.fromAddress ?? null,
    owner: candidate.toAddress ?? null
  });
  dispatchLogger.warn("blocked drive envelope", {
    fileName: candidate.fileName,
    messageId: candidate.messageId ?? null,
    subject: candidate.subject || "(none)",
    conversationId: candidate.toAddress?.conversationId ?? null,
    action: candidate.action ?? null,
    consentRef: candidate.consentRef ?? null,
    reason
  });
  return false;
}
async function dispatchDriveEnvelope(options, candidate, driveTransportFactory) {
  const conversationId = candidate.toAddress?.conversationId?.trim() || null;
  if (!conversationId) {
    return rejectDriveEnvelope(
      options,
      candidate,
      null,
      buildInvalidDriveEnvelopeReason(
        "drive scope requires target conversationId metadata."
      )
    );
  }
  const consentRef = candidate.consentRef?.trim() || null;
  if (!consentRef) {
    return rejectDriveEnvelope(
      options,
      candidate,
      conversationId,
      buildInvalidDriveEnvelopeReason(
        "drive scope requires a non-empty consentRef."
      )
    );
  }
  const method = normalizeDriveStartTurnAction(candidate.action);
  if (!method) {
    const action = candidate.action?.trim() || "(missing)";
    return blockDriveEnvelope(
      options,
      candidate,
      conversationId,
      `${DRIVE_ACTION_NOT_YET_SUPPORTED_REASON}: ${action}`
    );
  }
  const text = candidate.body.trim();
  if (!text) {
    return rejectDriveEnvelope(
      options,
      candidate,
      conversationId,
      buildInvalidDriveEnvelopeReason(
        `${method} requires a non-empty message body.`
      )
    );
  }
  const transport = driveTransportFactory(options);
  const targetHostId = candidate.toAddress?.hostId?.trim() || null;
  const targetOwnerClientId = candidate.toAddress?.ownerClientId?.trim() || candidate.toAddress?.clientId?.trim() || null;
  logIpcTrace("drive envelope prepared", {
    fileName: candidate.fileName,
    conversationId,
    action: candidate.action ?? null,
    consentRef,
    targetHostId,
    targetOwnerClientId
  });
  try {
    logIpcTrace("transport connect start", {
      fileName: candidate.fileName,
      conversationId
    });
    await transport.connect();
    logIpcTrace("transport connect success", {
      fileName: candidate.fileName,
      conversationId
    });
    logIpcTrace("transport startTurn start", {
      fileName: candidate.fileName,
      conversationId,
      textLength: text.length
    });
    const result = await transport.startTurn({
      conversationId,
      text,
      action: candidate.action?.trim() || null,
      consentRef,
      hostId: targetHostId,
      ownerClientId: targetOwnerClientId
    });
    const turnId = extractDriveTurnId2(result);
    logIpcTrace("transport startTurn success", {
      fileName: candidate.fileName,
      conversationId,
      turnId,
      result
    });
    writeProcessedMarker(
      options.stateDir,
      candidate,
      "drive",
      conversationId,
      turnId
    );
    writeLastDispatch(
      options.stateDir,
      candidate,
      "drive",
      conversationId,
      turnId,
      null
    );
    markBridgeActivity();
    dispatchLogger.info("handed drive envelope to control transport", {
      fileName: candidate.fileName,
      messageId: candidate.messageId ?? null,
      conversationId,
      action: candidate.action ?? null,
      consentRef,
      turnId
    });
    return true;
  } catch (error) {
    logIpcTrace("transport startTurn error", {
      fileName: candidate.fileName,
      conversationId,
      error: error instanceof Error ? error.stack ?? error.message : String(error)
    });
    return blockDriveEnvelope(
      options,
      candidate,
      conversationId,
      sanitizeErrorForPersistence(
        error instanceof Error ? error.stack ?? error.message : String(error)
      ) ?? "drive handoff failed"
    );
  } finally {
    await transport.disconnect().catch(() => void 0);
  }
}
function sanitizeErrorForPersistence(error) {
  if (!error) return null;
  return error.replace(/([?&])tap_token=[^\s&)"'}]+/gi, "$1tap_token=***").replace(/([?&])token=[^\s&)"'}]+/gi, "$1token=***").replace(/([?&])secret=[^\s&)"'}]+/gi, "$1secret=***").replace(/([?&])key=[^\s&)"'}]+/gi, "$1key=***").replace(/"tap_token"\s*:\s*"[^"]*"/g, '"tap_token":"***"').replace(/"token"\s*:\s*"[^"]*"/g, '"token":"***"').replace(/"secret"\s*:\s*"[^"]*"/g, '"secret":"***"').replace(/"password"\s*:\s*"[^"]*"/g, '"password":"***"').replace(/"authorization"\s*:\s*"[^"]*"/gi, '"authorization":"***"').replace(/tap-auth-[A-Za-z0-9_.\-/+=]+/g, "tap-auth-***").replace(/Bearer\s+[A-Za-z0-9_.\-/+=]+/gi, "Bearer ***").replace(/(?<=[=:"\s])[A-Za-z0-9_\-/+=]{40,}(?=["\s&)}'}\],]|$)/g, "***");
}
function delay(ms) {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, ms);
  });
}
function resolveBridgeRoutingSlot(agentId) {
  const normalized = agentId.trim().replace(/-/g, "_").toLowerCase();
  if (!normalized) return null;
  if (normalized === "tower" || normalized === "claude_main" || normalized === "codex_main") {
    return "tower";
  }
  if (normalized === "reviewer" || normalized === "claude_reviewer" || normalized === "codex_reviewer") {
    return "reviewer";
  }
  const worktreeMatch = normalized.match(/^(?:(?:claude|codex)_)?wt_?(\d+)$/);
  if (!worktreeMatch) return null;
  return `wt-${Number.parseInt(worktreeMatch[1], 10)}`;
}
function resolveBridgeHostId(options) {
  const explicitHostId = process.env.TAP_HOST_ID?.trim();
  if (explicitHostId) return explicitHostId;
  const computerName = process.env.COMPUTERNAME?.trim();
  if (computerName) return computerName;
  const hostName = process.env.HOSTNAME?.trim();
  if (hostName) return hostName;
  return options.commsDir;
}
function resolveBridgeAliases(values) {
  const aliases = [];
  for (const value of values) {
    const normalized = value?.trim();
    if (!normalized || aliases.includes(normalized)) continue;
    aliases.push(normalized);
  }
  return aliases;
}
function buildBridgeAddress(options, conversationId) {
  const slot = options.routingSlot ?? resolveBridgeRoutingSlot(options.agentId);
  const routingAddress = slot ?? options.agentId;
  return {
    hostId: resolveBridgeHostId(options),
    clientId: options.agentId,
    conversationId,
    ownerClientId: conversationId ? options.agentId : null,
    routingAddress,
    slot,
    aliases: resolveBridgeAliases([
      routingAddress,
      slot,
      options.agentId,
      options.agentName
    ])
  };
}
function readThreadState(stateDir) {
  const threadPath = join7(stateDir, "thread.json");
  if (!existsSync6(threadPath)) {
    return null;
  }
  try {
    const parsed = JSON.parse(
      readFileSync5(threadPath, "utf8")
    );
    if (parsed.threadId) {
      return {
        ...parsed,
        cwd: normalizePersistedThreadCwd(parsed.cwd)
      };
    }
  } catch {
    return null;
  }
  return null;
}
function persistThreadState(stateDir, threadId, appServerUrl, ephemeral, cwd) {
  const payload = {
    threadId,
    updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
    appServerUrl,
    ephemeral,
    cwd: normalizePersistedThreadCwd(cwd)
  };
  writeFileSync5(
    join7(stateDir, "thread.json"),
    `${JSON.stringify(payload, null, 2)}
`,
    "utf8"
  );
}
function acquireCommsLock(lockPath) {
  const deadline = Date.now() + COMMS_HEARTBEAT_LOCK_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      writeFileSync5(lockPath, String(process.pid), { flag: "wx" });
      return true;
    } catch {
      try {
        const lockAge = Date.now() - statSync3(lockPath).mtimeMs;
        if (lockAge > COMMS_LOCK_STALE_AGE_MS) {
          unlinkSync2(lockPath);
          try {
            writeFileSync5(lockPath, String(process.pid), { flag: "wx" });
            return true;
          } catch {
          }
        }
      } catch {
      }
      const start = Date.now();
      while (Date.now() - start < 50) {
      }
    }
  }
  return false;
}
function releaseCommsLock(lockPath) {
  try {
    unlinkSync2(lockPath);
  } catch {
  }
}
function heartbeatStoreKey(record) {
  for (const field of ["id", "instanceId", "agent"]) {
    const value = record[field];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return null;
}
function normalizeHeartbeatStore(raw) {
  if (Array.isArray(raw)) {
    const normalized = {};
    for (const entry of raw) {
      const record = asRecord3(entry);
      if (!record) continue;
      const key = heartbeatStoreKey(record);
      if (key) normalized[key] = record;
    }
    return normalized;
  }
  return asRecord3(raw) ?? {};
}
function updateCommsHeartbeat(options, status, conversationId) {
  const heartbeatsPath = join7(options.commsDir, "heartbeats.json");
  const lockPath = join7(options.commsDir, ".heartbeats.lock");
  if (!acquireCommsLock(lockPath)) {
    return;
  }
  try {
    let store = {};
    try {
      store = normalizeHeartbeatStore(
        JSON.parse(readFileSync5(heartbeatsPath, "utf-8"))
      );
    } catch {
    }
    const key = options.agentId;
    const existing = store[key];
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const lastActivity = _lastBridgeActivityAt ?? existing?.lastActivity ?? now;
    const resolvedConversationId = conversationId ?? readThreadState(options.stateDir)?.threadId ?? null;
    store[key] = {
      id: options.agentId,
      agent: options.agentName,
      timestamp: now,
      lastActivity,
      joinedAt: existing?.joinedAt ?? now,
      status,
      source: "bridge-dispatch",
      instanceId: options.agentId,
      bridgePid: process.pid,
      connectHash: `instance:${options.agentId}`,
      receiveTransports: ["consent-drive"],
      address: buildBridgeAddress(options, resolvedConversationId)
    };
    const tmpPath = heartbeatsPath + ".tmp." + process.pid;
    writeFileSync5(tmpPath, JSON.stringify(store, null, 2), "utf-8");
    renameSync2(tmpPath, heartbeatsPath);
    try {
      const presenceDir = join7(options.commsDir, "presence");
      mkdirSync4(presenceDir, { recursive: true });
      const sanitizedId = key.replace(/[/\\:]/g, "_");
      const presPath = join7(presenceDir, `${sanitizedId}.json`);
      const presTmp = presPath + ".tmp." + process.pid;
      writeFileSync5(presTmp, JSON.stringify(store[key], null, 2), "utf-8");
      renameSync2(presTmp, presPath);
    } catch {
    }
  } catch {
  } finally {
    releaseCommsLock(lockPath);
  }
}
var heartbeatCount = 0;
var _lastBridgeActivityAt = null;
function markBridgeActivity() {
  _lastBridgeActivityAt = (/* @__PURE__ */ new Date()).toISOString();
}
function getLastBridgeActivityAt() {
  return _lastBridgeActivityAt;
}
function readPreviousHeartbeat(stateDir) {
  const heartbeatPath = join7(stateDir, "heartbeat.json");
  if (!existsSync6(heartbeatPath)) {
    return null;
  }
  try {
    return JSON.parse(
      readFileSync5(heartbeatPath, "utf8")
    );
  } catch {
    return null;
  }
}
function readLastDispatchAt(stateDir) {
  const dispatchPath = join7(stateDir, "last-dispatch.json");
  if (!existsSync6(dispatchPath)) {
    return null;
  }
  try {
    const parsed = JSON.parse(
      readFileSync5(dispatchPath, "utf8")
    );
    return typeof parsed.dispatchedAt === "string" ? parsed.dispatchedAt : null;
  } catch {
    return null;
  }
}
function resolveTurnState(client) {
  if (!client) return null;
  if (client.activeTurnId) return "active";
  if (client.connected === false) return "disconnected";
  if (isWaitingApprovalStatus(client.lastTurnStatus)) {
    return "waiting-approval";
  }
  if (client.connected) return "idle";
  return null;
}
function writeHeartbeat(options, client, health) {
  const nowIso = (/* @__PURE__ */ new Date()).toISOString();
  const previousHeartbeat = readPreviousHeartbeat(options.stateDir);
  const lastDispatchAt = readLastDispatchAt(options.stateDir);
  const turnState = resolveTurnState(client);
  const turnJustCompleted = previousHeartbeat?.activeTurnId && !client?.activeTurnId;
  if (turnJustCompleted) {
    markBridgeActivity();
  }
  const lastTurnAt = turnJustCompleted ? nowIso : previousHeartbeat?.lastTurnAt ?? null;
  const idleSince = turnState === "idle" || turnState === "waiting-approval" ? previousHeartbeat?.turnState === turnState && previousHeartbeat.idleSince ? previousHeartbeat.idleSince : lastTurnAt ?? lastDispatchAt ?? nowIso : null;
  if (client?.threadId) {
    const savedThread = readThreadState(options.stateDir);
    persistThreadState(
      options.stateDir,
      client.threadId,
      options.appServerUrl,
      options.ephemeral,
      client.currentThreadCwd ?? savedThread?.cwd ?? null
    );
  }
  const payload = {
    pid: process.pid,
    agent: options.agentName,
    updatedAt: nowIso,
    pollSeconds: options.pollSeconds,
    appServerUrl: options.appServerUrl,
    authenticated: Boolean(options.gatewayToken),
    connected: client?.connected ?? false,
    initialized: client?.initialized ?? false,
    threadId: client?.threadId ?? null,
    threadCwd: client?.currentThreadCwd ?? null,
    activeTurnId: client?.activeTurnId ?? null,
    turnStartedAt: client?.turnStartedAt ?? null,
    lastTurnStatus: client?.lastTurnStatus ?? null,
    lastTurnAt,
    lastDispatchAt,
    idleSince,
    turnState: turnState ?? void 0,
    lastNotificationMethod: client?.lastNotificationMethod ?? null,
    lastNotificationAt: client?.lastNotificationAt ?? null,
    lastError: sanitizeErrorForPersistence(client?.lastError ?? null),
    lastSuccessfulAppServerAt: client?.lastSuccessfulAppServerAt ?? null,
    lastSuccessfulAppServerMethod: client?.lastSuccessfulAppServerMethod ?? null,
    consecutiveFailureCount: health.consecutiveFailureCount,
    busyMode: options.busyMode
  };
  writeFileSync5(
    join7(options.stateDir, "heartbeat.json"),
    `${JSON.stringify(payload, null, 2)}
`,
    "utf8"
  );
  heartbeatCount += 1;
  if (heartbeatCount % 5 === 0) {
    heartbeatLogger.debug("heartbeat written", {
      connected: payload.connected,
      threadId: payload.threadId ?? "null",
      activeTurnId: payload.activeTurnId ?? null,
      consecutiveFailureCount: payload.consecutiveFailureCount
    });
  }
  const status = turnState === "active" ? "active" : "idle";
  updateCommsHeartbeat(
    options,
    status,
    payload.threadId ?? readThreadState(options.stateDir)?.threadId ?? null
  );
}
async function dispatchCandidate(client, options, candidate, heartbeats, driveTransportFactory = createDriveDispatchTransport) {
  dispatchLogger.info("dispatching candidate", {
    sender: candidate.sender || "unknown",
    recipient: candidate.recipient || options.agentName,
    subject: candidate.subject || "(none)",
    fileName: candidate.fileName,
    messageId: candidate.messageId ?? null,
    scope: candidate.scope ?? null,
    action: candidate.action ?? null,
    hasConsentRef: Boolean(candidate.consentRef),
    threadId: client.threadId,
    activeTurnId: client.activeTurnId,
    busyMode: options.busyMode
  });
  if (candidate.scope === "drive") {
    return dispatchDriveEnvelope(options, candidate, driveTransportFactory);
  }
  const input = buildUserInput(candidate, options.agentName, heartbeats);
  if (client.isWaitingOnApproval()) {
    dispatchLogger.warn("thread waiting on approval; skipping dispatch", {
      fileName: candidate.fileName,
      threadId: client.threadId,
      lastTurnStatus: client.lastTurnStatus
    });
    return false;
  }
  if (client.isBusy()) {
    if (options.busyMode !== "steer") {
      dispatchLogger.debug("bridge busy and steer disabled", {
        fileName: candidate.fileName,
        activeTurnId: client.activeTurnId
      });
      return false;
    }
    try {
      const turnId2 = await client.steerTurn(input);
      writeProcessedMarker(
        options.stateDir,
        candidate,
        "steer",
        client.threadId,
        turnId2
      );
      writeLastDispatch(
        options.stateDir,
        candidate,
        "steer",
        client.threadId,
        turnId2,
        null
      );
      markBridgeActivity();
      dispatchLogger.info("steered active turn", {
        fileName: candidate.fileName,
        threadId: client.threadId,
        turnId: turnId2
      });
      return true;
    } catch (error) {
      await client.refreshCurrentThreadState().catch(() => void 0);
      if (!client.isBusy()) {
        return dispatchCandidate(
          client,
          options,
          candidate,
          heartbeats,
          driveTransportFactory
        );
      }
      if (shouldRetrySteerAsStart(error)) {
        client.activeTurnId = null;
        client.turnStartedAt = null;
        dispatchLogger.warn("steer fallback to start", {
          fileName: candidate.fileName,
          threadId: client.threadId,
          error: sanitizeErrorForPersistence(String(error))
        });
        return dispatchCandidate(
          client,
          options,
          candidate,
          heartbeats,
          driveTransportFactory
        );
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
    turnId
  );
  writeLastDispatch(
    options.stateDir,
    candidate,
    "start",
    client.threadId,
    turnId,
    null
  );
  markBridgeActivity();
  dispatchLogger.info("started turn for candidate", {
    fileName: candidate.fileName,
    threadId: client.threadId,
    turnId
  });
  return true;
}
async function runScan(options, cutoff, client) {
  const { heartbeats, candidates } = getPendingCandidates(options, cutoff);
  if (candidates.length === 0) {
    dispatchLogger.debug("no pending candidates", {
      cutoff: cutoff.toISOString(),
      agentName: options.agentName
    });
  }
  let maxMtimeMs = 0;
  for (const candidate of candidates) {
    if (options.dryRun) {
      dispatchLogger.info("dry-run candidate", {
        fileName: candidate.fileName,
        sender: candidate.sender,
        recipient: candidate.recipient
      });
      maxMtimeMs = Math.max(maxMtimeMs, candidate.mtimeMs);
      continue;
    }
    if (!client) {
      throw new Error("App Server client is not available");
    }
    const dispatched = await dispatchCandidate(
      client,
      options,
      candidate,
      heartbeats
    );
    if (!dispatched) {
      return { dispatched: false, maxMtimeMs };
    }
    maxMtimeMs = Math.max(maxMtimeMs, candidate.mtimeMs);
    return { dispatched: true, maxMtimeMs };
  }
  return { dispatched: false, maxMtimeMs: 0 };
}
async function waitForTurnDrain(options, client, health) {
  const deadline = Date.now() + options.waitAfterDispatchSeconds * 1e3;
  while (Date.now() < deadline) {
    writeHeartbeat(options, client, health);
    if (!client.activeTurnId) {
      markBridgeActivity();
      return;
    }
    await delay(1e3);
  }
  dispatchLogger.warn("wait-after-dispatch deadline reached", {
    threadId: client.threadId,
    activeTurnId: client.activeTurnId,
    waitAfterDispatchSeconds: options.waitAfterDispatchSeconds
  });
}
async function waitForTurnCompletion(client, turnId, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let nextRefreshAt = Date.now();
  while (Date.now() < deadline) {
    if (!client.activeTurnId || client.activeTurnId !== turnId) {
      return client.lastTurnStatus;
    }
    if (Date.now() >= nextRefreshAt) {
      await client.refreshCurrentThreadState().catch(() => void 0);
      if (!client.activeTurnId || client.activeTurnId !== turnId) {
        return client.lastTurnStatus;
      }
      nextRefreshAt = Date.now() + TURN_COMPLETION_REFRESH_MS;
    }
    await delay(
      Math.min(TURN_COMPLETION_POLL_MS, Math.max(deadline - Date.now(), 0))
    );
  }
  await client.refreshCurrentThreadState().catch(() => void 0);
  if (!client.activeTurnId || client.activeTurnId !== turnId) {
    return client.lastTurnStatus;
  }
  throw new Error(`Timed out waiting for turn ${turnId} to complete`);
}
async function maybeBootstrapHeadlessTurn(options, cutoff, client) {
  if (process.env.TAP_HEADLESS !== "true" && process.env.TAP_COLD_START_WARMUP !== "true") {
    return false;
  }
  const { candidates } = getPendingCandidates(options, cutoff);
  if (candidates.length > 0 || client.activeTurnId || client.lastTurnStatus !== null) {
    return false;
  }
  dispatchLogger.info("headless cold-start warmup starting", {
    threadId: client.activeTurnId
  });
  const turnId = await client.startTurn(HEADLESS_WARMUP_PROMPT);
  if (!turnId) {
    throw new Error(
      "Headless cold-start warmup failed: turn/start did not return a turn id. Run: npx @hua-labs/tap doctor"
    );
  }
  try {
    const status = await waitForTurnCompletion(
      client,
      turnId,
      HEADLESS_WARMUP_TIMEOUT_MS
    );
    if (status !== "completed") {
      throw new Error(
        `turn ${turnId} finished with status ${status ?? "unknown"}`
      );
    }
    dispatchLogger.info("headless cold-start warmup completed", {
      turnId,
      status
    });
    return true;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Headless cold-start warmup failed: ${reason}. Run: npx @hua-labs/tap doctor`,
      { cause: error }
    );
  }
}

// scripts/bridge/bridge-ws-client.ts
async function readSocketData(data) {
  if (typeof data === "string") {
    return data;
  }
  if (data instanceof ArrayBuffer) {
    return Buffer.from(data).toString("utf8");
  }
  if (ArrayBuffer.isView(data)) {
    return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString(
      "utf8"
    );
  }
  if (typeof Blob !== "undefined" && data instanceof Blob) {
    return await data.text();
  }
  return String(data);
}
function formatJsonRpcError(error) {
  if (!error) {
    return "Unknown App Server error";
  }
  return JSON.stringify(
    {
      code: error.code,
      message: error.message,
      data: error.data
    },
    null,
    2
  );
}
var DEFAULT_APP_SERVER_REQUEST_TIMEOUT_MS = 3e4;
var nextAppServerClientId = 1;
function getProcessRssMb() {
  return Math.round(process.memoryUsage().rss / (1024 * 1024));
}
var AppServerClient = class {
  socket = null;
  url;
  gatewayToken;
  logger;
  clientId = nextAppServerClientId++;
  nextId = 1;
  requestTimeoutMs;
  pending = /* @__PURE__ */ new Map();
  socketListeners = /* @__PURE__ */ new Map();
  connected = false;
  initialized = false;
  threadId = null;
  currentThreadCwd = null;
  activeTurnId = null;
  turnStartedAt = null;
  lastTurnStatus = null;
  lastNotificationMethod = null;
  lastNotificationAt = null;
  lastError = null;
  lastSuccessfulAppServerAt = null;
  lastSuccessfulAppServerMethod = null;
  constructor(url, logger, gatewayToken, requestTimeoutMs = DEFAULT_APP_SERVER_REQUEST_TIMEOUT_MS) {
    this.url = url;
    this.logger = logger;
    this.gatewayToken = gatewayToken ?? null;
    this.requestTimeoutMs = requestTimeoutMs;
  }
  getPendingRequestCount() {
    return this.pending.size;
  }
  async connect() {
    if (this.connected && this.socket?.readyState === WebSocket.OPEN) {
      return;
    }
    if (!this.gatewayToken) {
      this.logger.warn(
        "connecting without auth token \u2014 app-server session is unprotected. Use --gateway-token-file or TAP_GATEWAY_TOKEN_FILE to enable auth.",
        { url: this.url }
      );
    }
    const wsOptions = {};
    if (this.gatewayToken) {
      wsOptions.protocols = [`${AUTH_SUBPROTOCOL_PREFIX}${this.gatewayToken}`];
    }
    this.socket = new WebSocket(this.url, wsOptions);
    const socket = this.socket;
    if (!socket) {
      throw new Error(`Failed to create App Server socket for ${this.url}`);
    }
    await new Promise((resolvePromise, rejectPromise) => {
      let settled = false;
      const resolveOnce = () => {
        if (settled) {
          return;
        }
        settled = true;
        resolvePromise();
      };
      const rejectOnce = (error) => {
        if (settled) {
          return;
        }
        settled = true;
        rejectPromise(error);
      };
      const listeners = {
        open: () => {
          this.connected = true;
          this.logger.info(
            "connected to app-server",
            this.buildMetricsContext({
              url: this.url,
              authenticated: Boolean(this.gatewayToken)
            })
          );
          resolveOnce();
        },
        error: () => {
          const error = new Error(
            `Failed to connect to App Server at ${this.url}`
          );
          this.lastError = sanitizeErrorForPersistence(error.message);
          this.logger.error(
            "failed to connect to app-server",
            this.buildMetricsContext({
              url: this.url,
              error: this.lastError
            })
          );
          rejectOnce(error);
        },
        close: () => {
          this.connected = false;
          this.initialized = false;
          this.activeTurnId = null;
          this.turnStartedAt = null;
          this.detachSocketListeners(socket);
          if (this.socket === socket) {
            this.socket = null;
          }
          this.logger.warn(
            "disconnected from app-server",
            this.buildMetricsContext({
              url: this.url
            })
          );
          this.rejectPending(new Error("App Server connection closed"));
        },
        message: (event) => {
          const socketEvent = event;
          void this.handleMessage(socketEvent.data);
        }
      };
      this.socketListeners.set(socket, listeners);
      socket.addEventListener("open", listeners.open, { once: true });
      socket.addEventListener("error", listeners.error);
      socket.addEventListener("close", listeners.close);
      socket.addEventListener("message", listeners.message);
    });
    await this.request("initialize", {
      clientInfo: {
        name: "tap-app-server-bridge",
        title: "tap app-server bridge",
        version: "0.1.0"
      },
      capabilities: {
        experimentalApi: false
      }
    });
    this.initialized = true;
  }
  async disconnect() {
    const socket = this.socket;
    if (!socket) {
      return;
    }
    this.detachSocketListeners(socket);
    this.socket = null;
    this.connected = false;
    this.initialized = false;
    this.activeTurnId = null;
    this.turnStartedAt = null;
    this.rejectPending(new Error("App Server connection disconnected"));
    socket.close();
  }
  async ensureThread(explicitThreadId, savedThread, cwd, ephemeral) {
    if (explicitThreadId) {
      try {
        const resumeResponse = await this.request("thread/resume", {
          threadId: explicitThreadId,
          persistExtendedHistory: false
        });
        const resumedThreadId = resumeResponse?.thread?.id ?? explicitThreadId;
        await this.refreshThreadState(resumedThreadId);
        this.logger.info("resumed explicit thread", {
          clientId: this.clientId,
          threadId: resumedThreadId,
          activeTurnId: this.activeTurnId
        });
        return resumedThreadId;
      } catch (error) {
        this.logger.warn(
          "explicit thread resume failed; starting fresh thread",
          {
            clientId: this.clientId,
            threadId: explicitThreadId,
            error: sanitizeErrorForPersistence(String(error))
          }
        );
      }
    }
    if (savedThread?.threadId) {
      if (savedThread.cwd && !threadCwdMatches(cwd, savedThread.cwd)) {
        this.logger.warn("saved thread cwd mismatch; skipping saved thread", {
          clientId: this.clientId,
          threadId: savedThread.threadId,
          savedCwd: savedThread.cwd,
          expectedCwd: cwd
        });
      } else {
        try {
          const resumeResponse = await this.request("thread/resume", {
            threadId: savedThread.threadId,
            persistExtendedHistory: false
          });
          const resumedThreadId = resumeResponse?.thread?.id ?? savedThread.threadId;
          await this.refreshThreadState(resumedThreadId);
          if (this.isWaitingOnApproval()) {
            this.logger.warn(
              "saved thread is waiting on approval; starting fresh thread",
              {
                clientId: this.clientId,
                threadId: resumedThreadId
              }
            );
            this.threadId = null;
            this.currentThreadCwd = null;
            this.activeTurnId = null;
            this.turnStartedAt = null;
            this.lastTurnStatus = null;
          } else if (!threadCwdMatches(cwd, this.currentThreadCwd)) {
            this.logger.warn("saved thread resumed with mismatched cwd", {
              clientId: this.clientId,
              threadId: resumedThreadId,
              expectedCwd: cwd,
              actualCwd: this.currentThreadCwd ?? "unknown"
            });
            this.threadId = null;
            this.currentThreadCwd = null;
            this.activeTurnId = null;
            this.turnStartedAt = null;
            this.lastTurnStatus = null;
          } else {
            this.logger.info("resumed saved thread", {
              clientId: this.clientId,
              threadId: resumedThreadId,
              activeTurnId: this.activeTurnId
            });
            return resumedThreadId;
          }
        } catch (error) {
          this.logger.warn(
            "saved thread resume failed; starting fresh thread",
            {
              clientId: this.clientId,
              threadId: savedThread.threadId,
              error: sanitizeErrorForPersistence(String(error))
            }
          );
        }
      }
    }
    const loadedThreadId = await this.findLoadedThread(cwd);
    if (loadedThreadId) {
      return loadedThreadId;
    }
    const startResponse = await this.request("thread/start", {
      cwd,
      ephemeral,
      experimentalRawEvents: false,
      persistExtendedHistory: false
    });
    const startedThreadId = startResponse?.thread?.id;
    if (!startedThreadId) {
      throw new Error("thread/start did not return a thread id");
    }
    this.syncThreadStateFromThread(startResponse?.thread);
    this.threadId = startedThreadId;
    this.currentThreadCwd = this.currentThreadCwd ?? normalizePersistedThreadCwd(cwd);
    this.activeTurnId = null;
    this.lastTurnStatus = null;
    this.logger.info("started thread", {
      clientId: this.clientId,
      threadId: startedThreadId,
      cwd: this.currentThreadCwd,
      ephemeral
    });
    return startedThreadId;
  }
  async findLoadedThread(cwd) {
    const response = await this.request("thread/loaded/list", {
      limit: 20
    });
    const threadIds = Array.isArray(response?.data) ? response.data.filter(
      (value) => typeof value === "string"
    ) : [];
    if (threadIds.length === 0) {
      return null;
    }
    const threads = [];
    for (const threadId of threadIds) {
      try {
        const threadResponse = await this.request("thread/read", {
          threadId,
          includeTurns: true
        });
        const thread = threadResponse?.thread;
        if (!thread?.id) {
          continue;
        }
        threads.push({
          id: thread.id,
          cwd: typeof thread.cwd === "string" ? thread.cwd : "",
          updatedAt: typeof thread.updatedAt === "number" ? thread.updatedAt : 0,
          statusType: thread.status?.type ?? null,
          thread
        });
      } catch {
        continue;
      }
    }
    const chosen = chooseLoadedThreadForCwd(cwd, threads);
    if (!chosen) {
      if (threads.length > 0) {
        this.logger.debug("loaded threads exist but none match cwd", {
          clientId: this.clientId,
          cwd,
          loadedThreadCount: threads.length
        });
      }
      return null;
    }
    this.syncThreadStateFromThread(chosen.thread);
    this.logger.info("attached to loaded thread", {
      clientId: this.clientId,
      threadId: chosen.id,
      activeTurnId: this.activeTurnId,
      cwd: chosen.cwd
    });
    return chosen.id;
  }
  async startTurn(inputText) {
    const threadId = this.requireThreadId();
    const response = await this.request("turn/start", {
      threadId,
      input: [
        {
          type: "text",
          text: inputText,
          text_elements: []
        }
      ]
    });
    const turnId = response?.turn?.id ?? null;
    if (turnId) {
      this.activeTurnId = turnId;
      this.turnStartedAt = (/* @__PURE__ */ new Date()).toISOString();
    }
    return turnId;
  }
  async steerTurn(inputText) {
    const threadId = this.requireThreadId();
    const turnId = this.requireActiveTurnId();
    await this.request("turn/steer", {
      threadId,
      expectedTurnId: turnId,
      input: [
        {
          type: "text",
          text: inputText,
          text_elements: []
        }
      ]
    });
    return turnId;
  }
  isBusy() {
    if (!this.activeTurnId) return false;
    if (isTurnStale(this.turnStartedAt)) {
      this.logger.warn("active turn is stale; treating bridge as idle", {
        clientId: this.clientId,
        turnId: this.activeTurnId,
        turnStartedAt: this.turnStartedAt
      });
      this.activeTurnId = null;
      this.turnStartedAt = null;
      return false;
    }
    return true;
  }
  isWaitingOnApproval() {
    return isWaitingApprovalStatus(this.lastTurnStatus);
  }
  async refreshCurrentThreadState() {
    if (!this.threadId) {
      return;
    }
    await this.refreshThreadState(this.threadId);
  }
  requireThreadId() {
    if (!this.threadId) {
      throw new Error("No active App Server thread is available");
    }
    return this.threadId;
  }
  requireActiveTurnId() {
    if (!this.activeTurnId) {
      throw new Error("No active turn is available for turn/steer");
    }
    return this.activeTurnId;
  }
  async refreshThreadState(threadId) {
    const threadResponse = await this.request("thread/read", {
      threadId,
      includeTurns: true
    });
    this.syncThreadStateFromThread(threadResponse?.thread);
  }
  syncThreadStateFromThread(thread) {
    if (typeof thread?.id === "string") {
      this.threadId = thread.id;
    }
    this.currentThreadCwd = typeof thread?.cwd === "string" ? normalizePersistedThreadCwd(thread.cwd) : null;
    let activeTurnId = null;
    let lastTurnStatus = null;
    const threadActiveFlags = Array.isArray(
      thread?.status?.activeFlags
    ) ? thread.status.activeFlags : [];
    const threadStuckOnApproval = isTurnStuckOnApproval(threadActiveFlags);
    if (threadStuckOnApproval) {
      lastTurnStatus = "waitingOnApproval";
      this.logger.warn("thread waitingOnApproval; ignoring in-progress turns", {
        clientId: this.clientId,
        threadId: this.threadId
      });
    }
    const turns = Array.isArray(thread?.turns) ? thread.turns : [];
    for (const turn of turns) {
      if (typeof turn?.status === "string") {
        lastTurnStatus = turn.status;
      }
      if (turn?.status === "inProgress" && typeof turn.id === "string") {
        if (threadStuckOnApproval) {
          continue;
        }
        const turnActiveFlags = Array.isArray(turn.activeFlags) ? turn.activeFlags : [];
        if (isTurnStuckOnApproval(turnActiveFlags)) {
          lastTurnStatus = "waitingOnApproval";
          this.logger.warn("turn waitingOnApproval; ignoring turn as active", {
            clientId: this.clientId,
            turnId: turn.id
          });
          continue;
        }
        activeTurnId = turn.id;
      }
    }
    if (activeTurnId && activeTurnId !== this.activeTurnId) {
      this.turnStartedAt = (/* @__PURE__ */ new Date()).toISOString();
    } else if (!activeTurnId) {
      this.turnStartedAt = null;
    }
    this.activeTurnId = activeTurnId;
    this.lastTurnStatus = lastTurnStatus;
  }
  async handleMessage(data) {
    const text = await readSocketData(data);
    const message = JSON.parse(text);
    if (typeof message.id === "number" && (Object.hasOwn(message, "result") || Object.hasOwn(message, "error"))) {
      const pending = this.pending.get(message.id);
      if (!pending) {
        return;
      }
      this.pending.delete(message.id);
      this.clearPendingTimeout(pending);
      if (message.error) {
        const errorText = formatJsonRpcError(message.error);
        this.lastError = sanitizeErrorForPersistence(errorText);
        this.logger.error("app-server request failed", {
          clientId: this.clientId,
          method: pending.method,
          error: this.lastError
        });
        pending.reject(new Error(`${pending.method} failed: ${errorText}`));
        return;
      }
      pending.resolve(message.result);
      this.lastSuccessfulAppServerAt = (/* @__PURE__ */ new Date()).toISOString();
      this.lastSuccessfulAppServerMethod = pending.method;
      this.lastError = null;
      return;
    }
    if ((typeof message.id === "number" || typeof message.id === "string") && typeof message.method === "string") {
      this.lastNotificationMethod = message.method;
      this.lastNotificationAt = (/* @__PURE__ */ new Date()).toISOString();
      if (isAutoElicitationRequestMethod(message.method)) {
        const result = buildAutoElicitationResult(message.params);
        if (result) {
          this.sendJsonRpcResult(message.id, result);
          this.logger.info("auto-responded to elicitation request", {
            clientId: this.clientId,
            method: message.method,
            action: result.action
          });
        } else {
          this.sendJsonRpcResult(message.id, { action: "cancel" });
          this.logger.warn(
            "elicitation request missing usable params; cancelled",
            {
              clientId: this.clientId,
              method: message.method
            }
          );
        }
        return;
      }
    }
    if (!message.method) {
      return;
    }
    this.lastNotificationMethod = message.method;
    this.lastNotificationAt = (/* @__PURE__ */ new Date()).toISOString();
    this.logger.debug("received app-server notification", {
      clientId: this.clientId,
      method: message.method
    });
    this.handleNotification(message.method, message.params);
  }
  handleNotification(method, params) {
    switch (method) {
      case "notifications/claude/channel":
        this.logger.info("tap channel notification received", {
          clientId: this.clientId,
          source: params?.meta?.source ?? null,
          from: params?.meta?.from ?? null,
          to: params?.meta?.to ?? null,
          subject: params?.meta?.subject ?? null,
          filename: params?.meta?.filename ?? null
        });
        break;
      case "thread/started":
        if (params?.thread?.id) {
          this.threadId = params.thread.id;
        }
        if (typeof params?.thread?.cwd === "string") {
          this.currentThreadCwd = normalizePersistedThreadCwd(
            params.thread.cwd
          );
        }
        this.logger.info("thread started notification", {
          clientId: this.clientId,
          threadId: params?.thread?.id ?? null,
          cwd: params?.thread?.cwd ?? null
        });
        break;
      case "thread/status/changed":
        this.logger.debug("thread status changed", {
          clientId: this.clientId,
          threadId: params?.thread?.id ?? this.threadId,
          status: params?.thread?.status?.type ?? params?.status?.type ?? "unknown"
        });
        break;
      case "turn/started":
        if (params?.turn?.id) {
          this.activeTurnId = params.turn.id;
          this.turnStartedAt = (/* @__PURE__ */ new Date()).toISOString();
          this.logger.info("turn started", {
            clientId: this.clientId,
            threadId: this.threadId,
            turnId: params.turn.id
          });
        }
        break;
      case "turn/completed": {
        this.lastTurnStatus = params?.turn?.status ?? null;
        const prevTurnStartedAt = this.turnStartedAt;
        this.activeTurnId = null;
        this.turnStartedAt = null;
        const elapsedMs = prevTurnStartedAt ? Date.now() - new Date(prevTurnStartedAt).getTime() : null;
        this.logger.info("turn completed", {
          clientId: this.clientId,
          threadId: this.threadId,
          status: this.lastTurnStatus ?? "unknown",
          elapsedSeconds: elapsedMs !== null ? Math.round(elapsedMs / 1e3) : void 0
        });
        break;
      }
      case "error":
        this.lastError = sanitizeErrorForPersistence(
          JSON.stringify(params ?? {}, null, 2)
        );
        this.logger.error("app-server error notification", {
          clientId: this.clientId,
          error: this.lastError
        });
        break;
      default:
        this.logger.info("unhandled app-server notification", {
          clientId: this.clientId,
          method
        });
        break;
    }
  }
  request(method, params) {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      throw new Error(`Cannot call ${method}; App Server socket is not open`);
    }
    const id = this.nextId;
    this.nextId += 1;
    const request = {
      jsonrpc: "2.0",
      id,
      method,
      params
    };
    return new Promise((resolvePromise, rejectPromise) => {
      const timeout = setTimeout(() => {
        const pending = this.pending.get(id);
        if (!pending) {
          return;
        }
        this.pending.delete(id);
        const errorText = `${method} timed out after ${this.requestTimeoutMs}ms`;
        this.lastError = sanitizeErrorForPersistence(errorText);
        this.logger.warn(
          "app-server request timed out",
          this.buildMetricsContext({
            method,
            requestId: id,
            timeoutMs: this.requestTimeoutMs
          })
        );
        pending.reject(new Error(errorText));
      }, this.requestTimeoutMs);
      this.pending.set(id, {
        resolve: resolvePromise,
        reject: rejectPromise,
        method,
        timeout
      });
      try {
        socket.send(JSON.stringify(request));
      } catch (error) {
        const pending = this.pending.get(id);
        if (pending) {
          this.clearPendingTimeout(pending);
          this.pending.delete(id);
        }
        rejectPromise(error);
      }
    });
  }
  sendJsonRpcResult(id, result) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return;
    }
    this.socket.send(JSON.stringify({ jsonrpc: "2.0", id, result }));
  }
  rejectPending(error) {
    if (this.pending.size > 0) {
      this.logger.warn(
        "rejecting pending app-server requests",
        this.buildMetricsContext({
          error: sanitizeErrorForPersistence(error.message)
        })
      );
    }
    for (const pending of this.pending.values()) {
      this.clearPendingTimeout(pending);
      pending.reject(error);
    }
    this.pending.clear();
  }
  clearPendingTimeout(pending) {
    if (pending.timeout !== null) {
      clearTimeout(pending.timeout);
      pending.timeout = null;
    }
  }
  detachSocketListeners(socket) {
    const listeners = this.socketListeners.get(socket);
    if (!listeners) {
      return;
    }
    socket.removeEventListener("open", listeners.open);
    socket.removeEventListener("error", listeners.error);
    socket.removeEventListener("close", listeners.close);
    socket.removeEventListener("message", listeners.message);
    this.socketListeners.delete(socket);
  }
  buildMetricsContext(context) {
    return {
      clientId: this.clientId,
      reconnectCount: Math.max(this.clientId - 1, 0),
      pendingCount: this.pending.size,
      rssMb: getProcessRssMb(),
      ...context
    };
  }
};

// scripts/bridge/bridge-main.ts
import { existsSync as existsSync7, readFileSync as readFileSync6, writeFileSync as writeFileSync6 } from "fs";
import { isAbsolute as isAbsolute2, join as join8, resolve as resolve5 } from "path";
import { pathToFileURL } from "url";
function delay2(ms) {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, ms);
  });
}
function getProcessRssMb2() {
  return Math.round(process.memoryUsage().rss / (1024 * 1024));
}
function readHeartbeatState(stateDir) {
  const heartbeatPath = join8(stateDir, "heartbeat.json");
  if (!existsSync7(heartbeatPath)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync6(heartbeatPath, "utf8"));
  } catch {
    return null;
  }
}
function parseUpdatedAt(value) {
  if (!value) {
    return 0;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
function appServerUrlMatches(expectedAppServerUrl, actualAppServerUrl) {
  return actualAppServerUrl?.trim() === expectedAppServerUrl;
}
function hasValidHeartbeatThreadCwd(threadCwd) {
  const normalized = threadCwd?.trim();
  if (!normalized) {
    return false;
  }
  return isAbsolute2(normalized) || /^[A-Za-z]:[\\/]/.test(normalized) || normalized.startsWith("\\\\");
}
function loadResumableThreadState(stateDir, fallbackAppServerUrl) {
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
  const heartbeatBackedThread = {
    threadId: heartbeatThreadId,
    updatedAt: heartbeat?.updatedAt ?? savedThread?.updatedAt ?? (/* @__PURE__ */ new Date()).toISOString(),
    appServerUrl: heartbeat?.appServerUrl || savedThread?.appServerUrl || fallbackAppServerUrl,
    ephemeral: savedThread?.ephemeral ?? false,
    cwd: normalizePersistedThreadCwd(
      heartbeat?.threadCwd ?? (savedThread?.threadId === heartbeatThreadId ? savedThread.cwd ?? null : null)
    )
  };
  let preferred = savedThread;
  if (!savedThread?.threadId) {
    preferred = heartbeatBackedThread;
  } else if (savedThread.threadId === heartbeatThreadId) {
    preferred = {
      ...savedThread,
      updatedAt: heartbeatBackedThread.updatedAt ?? savedThread.updatedAt,
      appServerUrl: heartbeatBackedThread.appServerUrl,
      cwd: normalizePersistedThreadCwd(
        heartbeatBackedThread.cwd ?? savedThread.cwd ?? null
      )
    };
  } else if (parseUpdatedAt(heartbeat?.updatedAt) > parseUpdatedAt(savedThread.updatedAt)) {
    preferred = heartbeatBackedThread;
  }
  return preferred;
}
function getGeneralInboxCutoff(stateDir, lookbackMinutes, processExistingMessages) {
  if (processExistingMessages) {
    return /* @__PURE__ */ new Date(0);
  }
  const lookbackCutoff = lookbackMinutes > 0 ? new Date(Date.now() - lookbackMinutes * 6e4) : null;
  const cutoffPath = join8(stateDir, "general-inbox-cutoff.txt");
  if (existsSync7(cutoffPath)) {
    try {
      const saved = new Date(readFileSync6(cutoffPath, "utf8").trim());
      if (!isNaN(saved.getTime())) {
        if (lookbackCutoff && lookbackCutoff > saved) {
          return lookbackCutoff;
        }
        return saved;
      }
    } catch {
    }
  }
  if (lookbackCutoff) {
    return lookbackCutoff;
  }
  const cutoff = /* @__PURE__ */ new Date();
  writeFileSync6(cutoffPath, `${cutoff.toISOString()}
`, "utf8");
  return cutoff;
}
async function main() {
  const options = buildOptions(process.argv.slice(2));
  configureBridgeLogging(options.logLevel);
  const logger = createBridgeLogger("bridge");
  const sweepLogger = createBridgeLogger("sweep");
  const sweepResult = sweepOrphanProcessedMarkers(options.stateDir, {
    logger: (msg, ctx) => sweepLogger.debug(msg, ctx)
  });
  if (sweepResult.scanned > 0) {
    logger.info("processed marker sweep", {
      scanned: sweepResult.scanned,
      removed: sweepResult.removed,
      kept: sweepResult.kept,
      errors: sweepResult.errors
    });
  }
  const cutoff = getGeneralInboxCutoff(
    options.stateDir,
    options.messageLookbackMinutes,
    options.processExistingMessages
  );
  const initialSavedThread = loadResumableThreadState(
    options.stateDir,
    options.appServerUrl
  );
  logger.info("codex app-server bridge ready", {
    repoRoot: options.repoRoot,
    commsDir: options.commsDir,
    agentName: options.agentName,
    stateDir: options.stateDir,
    appServerUrl: options.appServerUrl,
    busyMode: options.busyMode,
    logLevel: options.logLevel,
    waitAfterDispatchSeconds: options.waitAfterDispatchSeconds > 0 ? options.waitAfterDispatchSeconds : void 0,
    lookback: options.processExistingMessages ? "existing messages" : `${options.messageLookbackMinutes} minute(s)`,
    threadId: options.threadId ?? initialSavedThread?.threadId
  });
  if (options.dryRun) {
    logger.info("dry-run mode enabled");
  }
  let client = null;
  const health = {
    consecutiveFailureCount: 0
  };
  while (true) {
    try {
      if (!options.dryRun) {
        if (!client || !client.connected) {
          client = new AppServerClient(
            options.connectAppServerUrl,
            createBridgeLogger("app-server"),
            options.gatewayToken
          );
          await client.connect();
          const savedThread = loadResumableThreadState(
            options.stateDir,
            options.appServerUrl
          );
          logger.debug("resolved resumable thread state", {
            savedThreadId: savedThread?.threadId,
            savedThreadCwd: savedThread?.cwd ?? null
          });
          const threadId = await client.ensureThread(
            options.threadId,
            savedThread,
            options.repoRoot,
            options.ephemeral
          );
          persistThreadState(
            options.stateDir,
            threadId,
            options.appServerUrl,
            options.ephemeral,
            client.currentThreadCwd ?? options.repoRoot
          );
          writeHeartbeat(options, client, health);
          const bootstrapped = await maybeBootstrapHeadlessTurn(
            options,
            cutoff,
            client
          );
          if (bootstrapped) {
            writeHeartbeat(options, client, health);
          }
        }
      }
      const scanResult = await runScan(options, cutoff, client);
      if (scanResult.dispatched && scanResult.maxMtimeMs > 0) {
        const cutoffPath = join8(options.stateDir, "general-inbox-cutoff.txt");
        const advancedCutoff = new Date(scanResult.maxMtimeMs);
        writeFileSync6(cutoffPath, `${advancedCutoff.toISOString()}
`, "utf8");
      }
      if (scanResult.dispatched && client && options.waitAfterDispatchSeconds > 0) {
        await waitForTurnDrain(options, client, health);
      }
      health.consecutiveFailureCount = 0;
      writeHeartbeat(options, client, health);
      if (options.runOnce) {
        break;
      }
      await delay2(options.pollSeconds * 1e3);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error("bridge error", {
        error: sanitizeErrorForPersistence(message)
      });
      if (client) {
        client.lastError = sanitizeErrorForPersistence(message);
      }
      health.consecutiveFailureCount += 1;
      writeHeartbeat(options, client, health);
      if (options.runOnce) {
        const sanitized = sanitizeErrorForPersistence(message);
        throw new Error(sanitized ?? message);
      }
      const pendingCount = client?.getPendingRequestCount() ?? 0;
      client?.disconnect().catch(() => void 0);
      client = null;
      logger.warn("reconnecting after bridge error", {
        reconnectSeconds: options.reconnectSeconds,
        reconnectCount: health.consecutiveFailureCount,
        consecutiveFailureCount: health.consecutiveFailureCount,
        pendingCount,
        rssMb: getProcessRssMb2()
      });
      await delay2(options.reconnectSeconds * 1e3);
    }
  }
  await client?.disconnect();
}
function isDirectExecution() {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(resolve5(entry)).href;
}

// src/bridges/codex-app-server-bridge.ts
function isDirectExecution2() {
  const entry = process.argv[1];
  if (!entry) return false;
  if (!basename2(entry).startsWith("codex-app-server-bridge")) return false;
  return import.meta.url === pathToFileURL2(resolve6(entry)).href;
}
if (isDirectExecution2()) {
  main().catch((error) => {
    console.error(
      error instanceof Error ? error.stack ?? error.message : String(error)
    );
    process.exitCode = 1;
  });
}
export {
  AUTH_SUBPROTOCOL_PREFIX,
  AppServerClient,
  COMMS_HEARTBEAT_LOCK_TIMEOUT_MS,
  COMMS_LOCK_STALE_AGE_MS,
  DEFAULT_AGENT,
  DEFAULT_APP_SERVER_REQUEST_TIMEOUT_MS,
  DEFAULT_APP_SERVER_URL,
  DRIVE_ACTION_NOT_YET_SUPPORTED_REASON,
  DRIVE_NOT_YET_WIRED_REASON,
  FORBIDDEN_RAW_PAIR_TOKEN_REASON,
  HEADLESS_SKIP_PATTERNS,
  HEADLESS_WARMUP_PROMPT,
  HEADLESS_WARMUP_TIMEOUT_MS,
  PLACEHOLDER_AGENT_VALUES,
  STALE_TURN_MS,
  TURN_COMPLETION_POLL_MS,
  TURN_COMPLETION_REFRESH_MS,
  acquireCommsLock,
  buildAutoElicitationResult,
  buildDefaultStateDir,
  buildMarkerId,
  buildOptions,
  buildUserInput,
  canonicalize,
  chooseLoadedThreadForCwd,
  collectCandidates,
  dispatchCandidate,
  formatAgentLabel,
  formatJsonRpcError,
  getGeneralInboxCutoff,
  getInboxRoute,
  getInboxRouteFromFilename,
  getLastBridgeActivityAt,
  getPendingCandidates,
  getProcessedMarkerPath,
  isAutoElicitationRequestMethod,
  isDirectExecution,
  isOwnMessageSender,
  isTurnStale,
  isTurnStuckOnApproval,
  isWaitingApprovalStatus,
  loadHeartbeats,
  loadResumableThreadState,
  main,
  markBridgeActivity,
  maybeBootstrapHeadlessTurn,
  normalizeAgentToken,
  normalizePersistedThreadCwd,
  normalizeRoutingSlotEnv,
  normalizeThreadCwd,
  parseArgs,
  parseBridgeFrontmatter,
  persistAgentName,
  persistThreadState,
  readGatewayTokenFile,
  readHeartbeatState,
  readSocketData,
  readThreadState,
  recipientMatchesAgent,
  refreshAgentIdentity,
  releaseCommsLock,
  resolveAddressLabel,
  resolveAgentId,
  resolveAgentName,
  resolveCommsDir,
  resolveCurrentAgentName,
  resolvePreferredAgentName,
  resolveRepoRoot,
  resolveStateDir,
  resolveTapConfigPath,
  runScan,
  sanitizeErrorForPersistence,
  sanitizeStateSegment,
  shouldRetrySteerAsStart,
  shouldSkipInHeadlessMode,
  stripBridgeFrontmatter,
  stripWindowsNamespacePrefix,
  sweepOrphanProcessedMarkers,
  threadCwdMatches,
  updateCommsHeartbeat,
  waitForTurnCompletion,
  waitForTurnDrain,
  writeHeartbeat,
  writeLastDispatch,
  writeProcessedMarker
};
//# sourceMappingURL=codex-app-server-bridge.mjs.map