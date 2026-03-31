// src/bridges/codex-app-server-bridge.ts
import { pathToFileURL as pathToFileURL3 } from "url";
import { resolve as resolve6 } from "path";

// ../../scripts/bridge/bridge-types.ts
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

// ../../scripts/bridge/bridge-routing.ts
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join, resolve } from "path";

// ../tap-plugin/channels/tap-identity.ts
var BROADCAST_RECIPIENTS = /* @__PURE__ */ new Set(["\uC804\uCCB4", "all"]);
function trimAddress(value) {
  return value?.trim() ?? "";
}
function canonicalizeAgentId(value) {
  return trimAddress(value).replace(/-/g, "_");
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

// ../../scripts/bridge/bridge-routing.ts
function canonicalize(id) {
  return canonicalizeAgentId(id);
}
function normalizeThreadCwd(cwd) {
  return resolve(cwd).replace(/\\/g, "/").toLowerCase();
}
function threadCwdMatches(expectedCwd, actualCwd) {
  if (!actualCwd) {
    return false;
  }
  return normalizeThreadCwd(expectedCwd) === normalizeThreadCwd(actualCwd);
}
function chooseLoadedThreadForCwd(cwd, threads) {
  const matching = threads.filter(
    (thread) => threadCwdMatches(cwd, thread.cwd)
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
    subject: fields.subject ?? ""
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
    subject: parts.slice(offset + 2).join("-")
  };
}

// ../../scripts/bridge/bridge-config.ts
import { existsSync as existsSync3, mkdirSync, readFileSync as readFileSync3 } from "fs";
import { isAbsolute as isAbsolute2, join as join3, resolve as resolve3 } from "path";

// src/config/resolve.ts
import * as fs from "fs";
import * as path from "path";
function normalizeTapPath(input) {
  const trimmed = input.trim().replace(/^["'`]+|["'`]+$/g, "");
  if (/^[A-Za-z]:[\\/]/.test(trimmed)) {
    return trimmed;
  }
  if (process.platform === "win32") {
    const match = trimmed.match(/^\/([A-Za-z])\/(.*)$/);
    if (match) {
      return `${match[1].toUpperCase()}:\\${match[2].replace(/\//g, "\\")}`;
    }
  }
  return trimmed;
}

// ../../scripts/bridge/bridge-config.ts
function ensureDir(target) {
  if (!existsSync3(target)) {
    mkdirSync(target, { recursive: true });
  }
  return resolve3(target);
}
function printHelp() {
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
    return resolve3(explicit);
  }
  return process.cwd();
}
function resolveTapConfigPath(repoRoot, input) {
  const converted = normalizeTapPath(input);
  return isAbsolute2(converted) ? resolve3(converted) : resolve3(repoRoot, converted);
}
function resolveCommsDir(repoRoot, explicit) {
  if (explicit) {
    return resolve3(normalizeTapPath(explicit));
  }
  const tapConfigPath = join3(repoRoot, ".tap-config");
  if (!existsSync3(tapConfigPath)) {
    throw new Error(
      "Unable to resolve comms directory. Pass --comms-dir explicitly."
    );
  }
  const configText = readFileSync3(tapConfigPath, "utf8");
  const match = configText.match(/^TAP_COMMS_DIR="?(.*?)"?$/m);
  if (!match?.[1]) {
    throw new Error(
      "Unable to resolve comms directory. Pass --comms-dir explicitly."
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
  return resolve3(join3(repoRoot, ".tmp", `codex-app-server-bridge${suffix}`));
}
function resolveStateDir(repoRoot, explicit, preferredAgentName) {
  const root = explicit ? resolve3(explicit) : buildDefaultStateDir(repoRoot, preferredAgentName);
  ensureDir(root);
  ensureDir(join3(root, "processed"));
  ensureDir(join3(root, "logs"));
  return root;
}
function readGatewayTokenFile(tokenFile) {
  const token = readFileSync3(tokenFile, "utf8").trim();
  if (!token) {
    throw new Error(`Gateway token file is empty: ${tokenFile}`);
  }
  return token;
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
    ephemeral: parsed.ephemeral
  };
}

// ../../scripts/bridge/bridge-candidates.ts
import { createHash } from "crypto";
import { existsSync as existsSync4, readFileSync as readFileSync4, readdirSync, statSync } from "fs";
import { join as join4 } from "path";

// ../../scripts/bridge/bridge-logging.ts
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

// ../../scripts/bridge/bridge-candidates.ts
var routingLogger = createBridgeLogger("routing");
function buildMarkerId(filePath, mtimeMs) {
  return createHash("sha1").update(`${filePath}|${mtimeMs}`).digest("hex");
}
function getProcessedMarkerPath(stateDir, markerId) {
  return join4(stateDir, "processed", `${markerId}.done`);
}
function loadHeartbeats(commsDir) {
  try {
    return JSON.parse(readFileSync4(join4(commsDir, "heartbeats.json"), "utf8"));
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
  const entries = readdirSync(inboxDir, { withFileTypes: true }).filter(
    (entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".md")
  ).map((entry) => {
    const filePath = join4(inboxDir, entry.name);
    const stats = statSync(filePath);
    return { entry, filePath, stats };
  }).sort((left, right) => left.stats.mtimeMs - right.stats.mtimeMs);
  const candidates = [];
  let filteredByRecipient = 0;
  let filteredBySelf = 0;
  let filteredByHeadless = 0;
  for (const item of entries) {
    let body;
    try {
      body = readFileSync4(item.filePath, "utf8");
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
    candidates.push({
      markerId: buildMarkerId(item.filePath, item.stats.mtimeMs),
      filePath: item.filePath,
      fileName: item.entry.name,
      sender: route.sender,
      recipient: route.recipient,
      subject: route.subject,
      body: stripBridgeFrontmatter(body),
      mtimeMs: item.stats.mtimeMs
    });
  }
  routingLogger.debug("candidate scan completed", {
    inboxDir,
    scanned: entries.length,
    matched: candidates.length,
    filteredByRecipient,
    filteredBySelf,
    filteredByHeadless,
    agentId,
    agentName,
    aliasName
  });
  return candidates;
}
function getPendingCandidates(options, cutoff) {
  const inboxDir = join4(options.commsDir, "inbox");
  if (!existsSync4(inboxDir)) {
    throw new Error(`Inbox directory not found: ${inboxDir}`);
  }
  const heartbeats = loadHeartbeats(options.commsDir);
  const refreshedName = refreshAgentIdentity(options, heartbeats);
  const cutoffMs = cutoff.getTime();
  const candidates = collectCandidates(
    inboxDir,
    options.agentId,
    options.agentName,
    // M205: Also accept messages addressed to the heartbeat-refreshed name
    refreshedName !== options.agentName ? refreshedName : void 0
  ).filter((candidate) => {
    if (candidate.mtimeMs < cutoffMs) {
      return false;
    }
    return !existsSync4(
      getProcessedMarkerPath(options.stateDir, candidate.markerId)
    );
  });
  routingLogger.debug("pending candidates resolved", {
    agentId: options.agentId,
    configuredName: options.agentName,
    refreshedName: refreshedName !== options.agentName ? refreshedName : void 0,
    candidateCount: candidates.length,
    cutoff: cutoff.toISOString()
  });
  return { heartbeats, candidates };
}

// ../../scripts/bridge/bridge-format.ts
import { writeFileSync as writeFileSync3 } from "fs";
import { join as join5 } from "path";
function buildUserInput(candidate, agentName, heartbeats) {
  const sender = resolveAddressLabel(candidate.sender || "unknown", heartbeats);
  const recipient = resolveAddressLabel(
    candidate.recipient || agentName,
    heartbeats
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
    "Do NOT respond with plain text only \u2014 you MUST use the tap_reply tool."
  ].join("\n");
}
function writeProcessedMarker(stateDir, candidate, dispatchMode, threadId, turnId) {
  const payload = {
    requestFile: candidate.filePath,
    requestName: candidate.fileName,
    sender: candidate.sender,
    recipient: candidate.recipient,
    subject: candidate.subject,
    dispatchMode,
    threadId,
    turnId,
    markedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
  writeFileSync3(
    getProcessedMarkerPath(stateDir, candidate.markerId),
    `${JSON.stringify(payload, null, 2)}
`,
    "utf8"
  );
}
function writeLastDispatch(stateDir, candidate, dispatchMode, threadId, turnId) {
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
    dispatchedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
  writeFileSync3(
    join5(stateDir, "last-dispatch.json"),
    `${JSON.stringify(payload, null, 2)}
`,
    "utf8"
  );
}

// ../../scripts/bridge/bridge-dispatch.ts
import {
  existsSync as existsSync5,
  readFileSync as readFileSync5,
  renameSync as renameSync2,
  statSync as statSync2,
  unlinkSync,
  writeFileSync as writeFileSync4
} from "fs";
import { join as join6 } from "path";
var dispatchLogger = createBridgeLogger("dispatch");
var heartbeatLogger = createBridgeLogger("heartbeat");
function sanitizeErrorForPersistence(error) {
  if (!error) return null;
  return error.replace(/([?&])tap_token=[^\s&)"'}]+/gi, "$1tap_token=***").replace(/([?&])token=[^\s&)"'}]+/gi, "$1token=***").replace(/([?&])secret=[^\s&)"'}]+/gi, "$1secret=***").replace(/([?&])key=[^\s&)"'}]+/gi, "$1key=***").replace(/"tap_token"\s*:\s*"[^"]*"/g, '"tap_token":"***"').replace(/"token"\s*:\s*"[^"]*"/g, '"token":"***"').replace(/"secret"\s*:\s*"[^"]*"/g, '"secret":"***"').replace(/"password"\s*:\s*"[^"]*"/g, '"password":"***"').replace(/"authorization"\s*:\s*"[^"]*"/gi, '"authorization":"***"').replace(/tap-auth-[A-Za-z0-9_.\-/+=]+/g, "tap-auth-***").replace(/Bearer\s+[A-Za-z0-9_.\-/+=]+/gi, "Bearer ***").replace(/(?<=[=:"\s])[A-Za-z0-9_\-/+=]{40,}(?=["\s&)}'}\],]|$)/g, "***");
}
function delay(ms) {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, ms);
  });
}
function readThreadState(stateDir) {
  const threadPath = join6(stateDir, "thread.json");
  if (!existsSync5(threadPath)) {
    return null;
  }
  try {
    const parsed = JSON.parse(
      readFileSync5(threadPath, "utf8")
    );
    if (parsed.threadId) {
      return parsed;
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
    cwd
  };
  writeFileSync4(
    join6(stateDir, "thread.json"),
    `${JSON.stringify(payload, null, 2)}
`,
    "utf8"
  );
}
function acquireCommsLock(lockPath) {
  const deadline = Date.now() + COMMS_HEARTBEAT_LOCK_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      writeFileSync4(lockPath, String(process.pid), { flag: "wx" });
      return true;
    } catch {
      try {
        const lockAge = Date.now() - statSync2(lockPath).mtimeMs;
        if (lockAge > COMMS_LOCK_STALE_AGE_MS) {
          unlinkSync(lockPath);
          try {
            writeFileSync4(lockPath, String(process.pid), { flag: "wx" });
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
    unlinkSync(lockPath);
  } catch {
  }
}
function updateCommsHeartbeat(options, status) {
  const heartbeatsPath = join6(options.commsDir, "heartbeats.json");
  const lockPath = join6(options.commsDir, ".heartbeats.lock");
  if (!acquireCommsLock(lockPath)) {
    return;
  }
  try {
    let store = {};
    try {
      store = JSON.parse(readFileSync5(heartbeatsPath, "utf-8"));
    } catch {
    }
    const key = options.agentId;
    const existing = store[key];
    store[key] = {
      id: options.agentId,
      agent: options.agentName,
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      lastActivity: (/* @__PURE__ */ new Date()).toISOString(),
      joinedAt: existing?.joinedAt ?? (/* @__PURE__ */ new Date()).toISOString(),
      status
    };
    const tmpPath = heartbeatsPath + ".tmp." + process.pid;
    writeFileSync4(tmpPath, JSON.stringify(store, null, 2), "utf-8");
    renameSync2(tmpPath, heartbeatsPath);
  } catch {
  } finally {
    releaseCommsLock(lockPath);
  }
}
var heartbeatCount = 0;
function writeHeartbeat(options, client, health) {
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
    updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
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
    lastNotificationMethod: client?.lastNotificationMethod ?? null,
    lastNotificationAt: client?.lastNotificationAt ?? null,
    lastError: sanitizeErrorForPersistence(client?.lastError ?? null),
    lastSuccessfulAppServerAt: client?.lastSuccessfulAppServerAt ?? null,
    lastSuccessfulAppServerMethod: client?.lastSuccessfulAppServerMethod ?? null,
    consecutiveFailureCount: health.consecutiveFailureCount,
    busyMode: options.busyMode
  };
  writeFileSync4(
    join6(options.stateDir, "heartbeat.json"),
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
  const status = client?.connected ? "active" : "idle";
  updateCommsHeartbeat(options, status);
}
async function dispatchCandidate(client, options, candidate, heartbeats) {
  const input = buildUserInput(candidate, options.agentName, heartbeats);
  dispatchLogger.info("dispatching candidate", {
    sender: candidate.sender || "unknown",
    recipient: candidate.recipient || options.agentName,
    subject: candidate.subject || "(none)",
    fileName: candidate.fileName,
    threadId: client.threadId,
    activeTurnId: client.activeTurnId,
    busyMode: options.busyMode
  });
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
        turnId2
      );
      dispatchLogger.info("steered active turn", {
        fileName: candidate.fileName,
        threadId: client.threadId,
        turnId: turnId2
      });
      return true;
    } catch (error) {
      await client.refreshCurrentThreadState().catch(() => void 0);
      if (!client.isBusy()) {
        return dispatchCandidate(client, options, candidate, heartbeats);
      }
      if (shouldRetrySteerAsStart(error)) {
        client.activeTurnId = null;
        client.turnStartedAt = null;
        dispatchLogger.warn("steer fallback to start", {
          fileName: candidate.fileName,
          threadId: client.threadId,
          error: sanitizeErrorForPersistence(String(error))
        });
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
    turnId
  );
  writeLastDispatch(
    options.stateDir,
    candidate,
    "start",
    client.threadId,
    turnId
  );
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
    if (!dispatched && options.busyMode === "wait") {
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
      `Headless cold-start warmup failed: ${reason}. Run: npx @hua-labs/tap doctor`
    );
  }
}

// ../../scripts/bridge/bridge-ws-client.ts
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
var nextAppServerClientId = 1;
var AppServerClient = class {
  socket = null;
  url;
  gatewayToken;
  logger;
  clientId = nextAppServerClientId++;
  nextId = 1;
  pending = /* @__PURE__ */ new Map();
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
  constructor(url, logger, gatewayToken) {
    this.url = url;
    this.logger = logger;
    this.gatewayToken = gatewayToken ?? null;
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
      this.socket?.addEventListener(
        "open",
        () => {
          this.connected = true;
          this.logger.info("connected to app-server", {
            clientId: this.clientId,
            url: this.url,
            authenticated: Boolean(this.gatewayToken)
          });
          resolveOnce();
        },
        { once: true }
      );
      this.socket?.addEventListener("error", () => {
        const error = new Error(
          `Failed to connect to App Server at ${this.url}`
        );
        this.lastError = sanitizeErrorForPersistence(error.message);
        this.logger.error("failed to connect to app-server", {
          clientId: this.clientId,
          url: this.url,
          error: this.lastError
        });
        rejectOnce(error);
      });
      this.socket?.addEventListener("close", () => {
        this.connected = false;
        this.initialized = false;
        this.activeTurnId = null;
        this.turnStartedAt = null;
        this.logger.warn("disconnected from app-server", {
          clientId: this.clientId,
          url: this.url
        });
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
        version: "0.1.0"
      },
      capabilities: {
        experimentalApi: false
      }
    });
    this.initialized = true;
  }
  async disconnect() {
    if (!this.socket) {
      return;
    }
    this.socket.close();
    this.connected = false;
    this.initialized = false;
    this.socket = null;
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
    const loadedThreadId = await this.findLoadedThread(cwd);
    if (loadedThreadId) {
      return loadedThreadId;
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
          if (!threadCwdMatches(cwd, this.currentThreadCwd)) {
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
    this.currentThreadCwd = this.currentThreadCwd ?? cwd;
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
    this.currentThreadCwd = typeof thread?.cwd === "string" ? thread.cwd : null;
    let activeTurnId = null;
    let lastTurnStatus = null;
    const threadActiveFlags = Array.isArray(
      thread?.status?.activeFlags
    ) ? thread.status.activeFlags : [];
    const threadStuckOnApproval = isTurnStuckOnApproval(threadActiveFlags);
    if (threadStuckOnApproval) {
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
      case "thread/started":
        if (params?.thread?.id) {
          this.threadId = params.thread.id;
        }
        if (typeof params?.thread?.cwd === "string") {
          this.currentThreadCwd = params.thread.cwd;
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
        break;
    }
  }
  request(method, params) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
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
      this.pending.set(id, {
        resolve: resolvePromise,
        reject: rejectPromise,
        method
      });
      this.socket?.send(JSON.stringify(request));
    });
  }
  rejectPending(error) {
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();
  }
};

// ../../scripts/bridge/bridge-main.ts
import { existsSync as existsSync6, readFileSync as readFileSync6, writeFileSync as writeFileSync5 } from "fs";
import { isAbsolute as isAbsolute3, join as join7, resolve as resolve4 } from "path";
import { pathToFileURL } from "url";
function delay2(ms) {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, ms);
  });
}
function readHeartbeatState(stateDir) {
  const heartbeatPath = join7(stateDir, "heartbeat.json");
  if (!existsSync6(heartbeatPath)) {
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
  return isAbsolute3(normalized) || /^[A-Za-z]:[\\/]/.test(normalized) || normalized.startsWith("\\\\");
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
    cwd: heartbeat?.threadCwd ?? (savedThread?.threadId === heartbeatThreadId ? savedThread.cwd ?? null : null)
  };
  let preferred = savedThread;
  if (!savedThread?.threadId) {
    preferred = heartbeatBackedThread;
  } else if (savedThread.threadId === heartbeatThreadId) {
    preferred = {
      ...savedThread,
      updatedAt: heartbeatBackedThread.updatedAt ?? savedThread.updatedAt,
      appServerUrl: heartbeatBackedThread.appServerUrl,
      cwd: heartbeatBackedThread.cwd ?? savedThread.cwd ?? null
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
  const cutoffPath = join7(stateDir, "general-inbox-cutoff.txt");
  if (existsSync6(cutoffPath)) {
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
  writeFileSync5(cutoffPath, `${cutoff.toISOString()}
`, "utf8");
  return cutoff;
}
async function main() {
  const options = buildOptions(process.argv.slice(2));
  configureBridgeLogging(options.logLevel);
  const logger = createBridgeLogger("bridge");
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
        const cutoffPath = join7(options.stateDir, "general-inbox-cutoff.txt");
        const advancedCutoff = new Date(scanResult.maxMtimeMs);
        writeFileSync5(cutoffPath, `${advancedCutoff.toISOString()}
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
      client?.disconnect().catch(() => void 0);
      client = null;
      logger.warn("reconnecting after bridge error", {
        reconnectSeconds: options.reconnectSeconds,
        consecutiveFailureCount: health.consecutiveFailureCount
      });
      await delay2(options.reconnectSeconds * 1e3);
    }
  }
  await client?.disconnect();
}
function isDirectExecution() {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(resolve4(entry)).href;
}

// ../../scripts/codex-app-server-bridge.ts
import { resolve as resolve5 } from "path";
import { pathToFileURL as pathToFileURL2 } from "url";
function isDirectExecution2() {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL2(resolve5(entry)).href;
}
if (isDirectExecution2()) {
  main().catch((error) => {
    const raw = error instanceof Error ? error.stack ?? error.message : String(error);
    console.error(sanitizeErrorForPersistence(raw));
    process.exitCode = 1;
  });
}

// src/bridges/codex-app-server-bridge.ts
function isDirectExecution3() {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL3(resolve6(entry)).href;
}
if (isDirectExecution3()) {
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
  DEFAULT_APP_SERVER_URL,
  HEADLESS_SKIP_PATTERNS,
  HEADLESS_WARMUP_PROMPT,
  HEADLESS_WARMUP_TIMEOUT_MS,
  PLACEHOLDER_AGENT_VALUES,
  STALE_TURN_MS,
  TURN_COMPLETION_POLL_MS,
  TURN_COMPLETION_REFRESH_MS,
  acquireCommsLock,
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
  getPendingCandidates,
  getProcessedMarkerPath,
  isDirectExecution,
  isOwnMessageSender,
  isTurnStale,
  isTurnStuckOnApproval,
  loadHeartbeats,
  loadResumableThreadState,
  main,
  maybeBootstrapHeadlessTurn,
  normalizeAgentToken,
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
  threadCwdMatches,
  updateCommsHeartbeat,
  waitForTurnCompletion,
  waitForTurnDrain,
  writeHeartbeat,
  writeLastDispatch,
  writeProcessedMarker
};
//# sourceMappingURL=codex-app-server-bridge.mjs.map