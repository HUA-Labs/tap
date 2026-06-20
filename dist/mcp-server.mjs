var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
  get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
}) : x)(function(x) {
  if (typeof require !== "undefined") return require.apply(this, arguments);
  throw Error('Dynamic require of "' + x + '" is not supported');
});
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// packages/tap-plugin/channels/tap-identity.ts
function trimAddress(value) {
  return value?.trim() ?? "";
}
function canonicalizeAgentId(value) {
  return trimAddress(value).replace(/-/g, "_").toLowerCase();
}
function isBroadcastRecipient(value) {
  return BROADCAST_RECIPIENTS.has(trimAddress(value));
}
function isPlaceholderAgentValue(value) {
  const normalized = trimAddress(value);
  return !normalized || PLACEHOLDER_AGENT_VALUES.has(normalized);
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
function normalizeRecipientList(rawRecipients, exclude = []) {
  let recipients;
  if (rawRecipients == null) {
    recipients = void 0;
  } else if (typeof rawRecipients === "string") {
    const trimmed = trimAddress(rawRecipients);
    recipients = trimmed ? [trimmed] : void 0;
  } else if (Array.isArray(rawRecipients)) {
    const valid = rawRecipients.filter(
      (value) => typeof value === "string" && trimAddress(value).length > 0
    ).map((value) => trimAddress(value));
    recipients = valid.length > 0 ? valid : void 0;
  } else {
    recipients = void 0;
  }
  if (!recipients) {
    return void 0;
  }
  const filtered = [];
  for (const recipient of recipients) {
    if (exclude.some((value) => sameRoutingAddress(value, recipient))) {
      continue;
    }
    if (filtered.some((value) => sameRoutingAddress(value, recipient))) {
      continue;
    }
    filtered.push(recipient);
  }
  return filtered.length > 0 ? filtered : void 0;
}
var BROADCAST_RECIPIENTS, PLACEHOLDER_AGENT_VALUES;
var init_tap_identity = __esm({
  "packages/tap-plugin/channels/tap-identity.ts"() {
    "use strict";
    BROADCAST_RECIPIENTS = /* @__PURE__ */ new Set(["\uC804\uCCB4", "all"]);
    PLACEHOLDER_AGENT_VALUES = /* @__PURE__ */ new Set([
      "unknown",
      "unnamed",
      "<set-per-session>"
    ]);
  }
});

// src/routing/receive-transports.ts
import { basename } from "path";
function normalizeString(value) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}
function normalizeRuntimeToken(value) {
  const normalized = normalizeString(value)?.replace(/-/g, "_").toLowerCase();
  return normalized || null;
}
function isCodexLikeToken(value) {
  const normalized = normalizeRuntimeToken(value);
  return normalized === "codex" || Boolean(normalized?.startsWith("codex_"));
}
function isCodexRuntimeStateDir(value) {
  const normalized = normalizeString(value);
  if (!normalized) return false;
  return basename(normalized).startsWith(CODEX_BRIDGE_STATE_DIR_PREFIX);
}
function isCodexMcpClient(value) {
  const normalized = normalizeRuntimeToken(value);
  return normalized === "codex_mcp_client";
}
function normalizeReceiveTransports(values) {
  const transports = [];
  for (const value of values ?? []) {
    if (!VALID_RECEIVE_TRANSPORTS.includes(value)) {
      continue;
    }
    const transport = value;
    if (transports.includes(transport)) {
      continue;
    }
    transports.push(transport);
  }
  return transports;
}
function inferReceiveTransports(hints = {}) {
  if (normalizeRuntimeToken(hints.runtimeName) === "codex" || isCodexLikeToken(hints.instanceId) || isCodexLikeToken(hints.bridgeInstanceId) || isCodexLikeToken(hints.agentId) || isCodexRuntimeStateDir(hints.runtimeStateDir)) {
    return ["consent-drive"];
  }
  if (isCodexMcpClient(hints.mcpClientName)) {
    return ["polling"];
  }
  return ["mcp-channel"];
}
function prefersConsentDrive(values) {
  return normalizeReceiveTransports(values).includes("consent-drive");
}
function canUseConsentDriveForAddress(options) {
  const address = options.address;
  if (!address?.conversationId?.trim() || !address.ownerClientId?.trim()) {
    return false;
  }
  const localHostId = normalizeString(options.localHostId);
  const targetHostId = normalizeString(address.hostId);
  if (!localHostId || !targetHostId) {
    return true;
  }
  return localHostId.toLowerCase() === targetHostId.toLowerCase();
}
var CODEX_BRIDGE_STATE_DIR_PREFIX, VALID_RECEIVE_TRANSPORTS;
var init_receive_transports = __esm({
  "src/routing/receive-transports.ts"() {
    "use strict";
    CODEX_BRIDGE_STATE_DIR_PREFIX = "codex-app-server-bridge-";
    VALID_RECEIVE_TRANSPORTS = [
      "mcp-channel",
      "consent-drive",
      "polling"
    ];
  }
});

// packages/tap-plugin/channels/tap-claims.ts
var tap_claims_exports = {};
__export(tap_claims_exports, {
  checkClaim: () => checkClaim,
  claimName: () => claimName,
  expireStale: () => expireStale,
  getClaimedNames: () => getClaimedNames,
  isClaimAlive: () => isClaimAlive,
  releaseClaim: () => releaseClaim,
  renewClaimTTL: () => renewClaimTTL,
  resolveClaimInstanceId: () => resolveClaimInstanceId
});
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  readdirSync,
  openSync,
  closeSync,
  renameSync,
  statSync,
  constants
} from "fs";
import { join } from "path";
import { randomUUID } from "crypto";
function ensureClaimsDir() {
  if (!existsSync(CLAIMS_DIR)) {
    mkdirSync(CLAIMS_DIR, { recursive: true });
  }
}
function claimFilePath(name) {
  const safe = name.replace(/[/\\:*?"<>|]/g, "_");
  return join(CLAIMS_DIR, `${safe}.json`);
}
function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
function resolveClaimInstanceId() {
  const envId = process.env.TAP_INSTANCE_ID ?? process.env.TAP_BRIDGE_INSTANCE_ID ?? process.env.TAP_AGENT_ID;
  if (envId && envId !== "unknown") return envId;
  return `mcp-direct-${process.pid}`;
}
function atomicCreate(filePath, data) {
  try {
    const fd = openSync(
      filePath,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL
    );
    writeFileSync(fd, data, "utf-8");
    closeSync(fd);
    return true;
  } catch (err) {
    if (err.code === "EEXIST") return false;
    throw err;
  }
}
function atomicOverwrite(filePath, data) {
  const tmp = `${filePath}.tmp.${process.pid}.${Date.now()}`;
  writeFileSync(tmp, data, "utf-8");
  try {
    renameSync(tmp, filePath);
  } catch (err) {
    try {
      unlinkSync(tmp);
    } catch {
    }
    throw err;
  }
}
function checkClaim(name) {
  const filePath = claimFilePath(name);
  if (!existsSync(filePath)) return null;
  try {
    const raw = readFileSync(filePath, "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
function isClaimAlive(claim) {
  if (claim.status === "released") return false;
  if (claim.expiresAt) {
    if (Date.now() > new Date(claim.expiresAt).getTime()) return false;
  }
  return isProcessAlive(claim.claimedBy.sessionPid);
}
function acquireClaimLock(name) {
  ensureClaimsDir();
  const lockPath = claimFilePath(name) + ".lock";
  if (existsSync(lockPath)) {
    try {
      const { mtimeMs } = statSync(lockPath);
      if (Date.now() - mtimeMs > 3e4) {
        unlinkSync(lockPath);
      }
    } catch {
    }
  }
  return atomicCreate(lockPath, `${process.pid}
`);
}
function releaseClaimLock(name) {
  const lockPath = claimFilePath(name) + ".lock";
  try {
    unlinkSync(lockPath);
  } catch {
  }
}
function claimName(name, instanceId, pid, source) {
  ensureClaimsDir();
  if (!acquireClaimLock(name)) {
    return {
      success: false,
      claim: null,
      conflictWith: {
        instanceId: "lock-busy",
        alive: true,
        lastActivity: (/* @__PURE__ */ new Date()).toISOString()
      }
    };
  }
  try {
    return claimNameLocked(name, instanceId, pid, source);
  } finally {
    releaseClaimLock(name);
  }
}
function claimNameLocked(name, instanceId, pid, source) {
  const filePath = claimFilePath(name);
  const claim = createClaim(name, instanceId, pid, source);
  const data = JSON.stringify(claim, null, 2) + "\n";
  const existing = checkClaim(name);
  if (!existing) {
    atomicOverwrite(filePath, data);
    return { success: true, claim, conflictWith: null };
  }
  if (existing.claimedBy.instanceId === instanceId && existing.claimedBy.sessionPid === pid) {
    return { success: true, claim: existing, conflictWith: null };
  }
  if (existing.claimedBy.instanceId === instanceId) {
    if (isClaimAlive(existing)) {
      return {
        success: false,
        claim: null,
        conflictWith: {
          instanceId: existing.claimedBy.instanceId,
          alive: true,
          lastActivity: existing.claimedAt
        }
      };
    }
    atomicOverwrite(filePath, data);
    return { success: true, claim, conflictWith: null };
  }
  if (!isClaimAlive(existing)) {
    atomicOverwrite(filePath, data);
    return { success: true, claim, conflictWith: null };
  }
  return {
    success: false,
    claim: null,
    conflictWith: {
      instanceId: existing.claimedBy.instanceId,
      alive: true,
      lastActivity: existing.claimedAt
    }
  };
}
function releaseClaim(name, instanceId, pid) {
  if (!acquireClaimLock(name)) return false;
  try {
    return releaseClaimLocked(name, instanceId, pid);
  } finally {
    releaseClaimLock(name);
  }
}
function releaseClaimLocked(name, instanceId, pid) {
  const filePath = claimFilePath(name);
  if (!existsSync(filePath)) return false;
  if (instanceId || pid) {
    const claim = checkClaim(name);
    if (!claim) return false;
    if (instanceId && claim.claimedBy.instanceId !== instanceId) return false;
    if (pid && claim.claimedBy.sessionPid !== pid) return false;
  }
  try {
    unlinkSync(filePath);
    return true;
  } catch {
    return false;
  }
}
function renewClaimTTL(name, instanceId, pid) {
  if (!acquireClaimLock(name)) return false;
  try {
    return renewClaimTTLLocked(name, instanceId, pid);
  } finally {
    releaseClaimLock(name);
  }
}
function renewClaimTTLLocked(name, instanceId, pid) {
  const claim = checkClaim(name);
  if (!claim || claim.status === "released") return false;
  if (instanceId && claim.claimedBy.instanceId !== instanceId) return false;
  if (pid && claim.claimedBy.sessionPid !== pid) return false;
  claim.expiresAt = new Date(Date.now() + CLAIM_TTL_MS).toISOString();
  const filePath = claimFilePath(name);
  atomicOverwrite(filePath, JSON.stringify(claim, null, 2) + "\n");
  return true;
}
function getClaimedNames() {
  ensureClaimsDir();
  const names = /* @__PURE__ */ new Set();
  try {
    for (const file of readdirSync(CLAIMS_DIR)) {
      if (!file.endsWith(".json") || file.endsWith(".lock")) continue;
      const filePath = join(CLAIMS_DIR, file);
      try {
        const raw = readFileSync(filePath, "utf-8");
        const claim = JSON.parse(raw);
        if (claim.name) names.add(claim.name);
      } catch {
      }
    }
  } catch {
  }
  return names;
}
function expireStale() {
  ensureClaimsDir();
  const expired = [];
  for (const file of readdirSync(CLAIMS_DIR)) {
    if (!file.endsWith(".json")) continue;
    const filePath = join(CLAIMS_DIR, file);
    try {
      const raw = readFileSync(filePath, "utf-8");
      const claim = JSON.parse(raw);
      if (!isClaimAlive(claim)) {
        unlinkSync(filePath);
        expired.push(claim.name);
      }
    } catch {
    }
  }
  return expired;
}
function createClaim(name, instanceId, pid, source) {
  return {
    name,
    claimedBy: { instanceId, sessionPid: pid, source },
    claimedAt: (/* @__PURE__ */ new Date()).toISOString(),
    nonce: randomUUID(),
    status: "confirmed",
    expiresAt: new Date(Date.now() + CLAIM_TTL_MS).toISOString()
  };
}
var CLAIMS_DIR, CLAIM_TTL_MS;
var init_tap_claims = __esm({
  "packages/tap-plugin/channels/tap-claims.ts"() {
    "use strict";
    init_tap_utils();
    CLAIMS_DIR = join(COMMS_DIR, ".claims");
    CLAIM_TTL_MS = 5 * 60 * 1e3;
  }
});

// packages/tap-plugin/channels/tap-utils.ts
var tap_utils_exports = {};
__export(tap_utils_exports, {
  ARCHIVE_DIR: () => ARCHIVE_DIR,
  COMMS_DIR: () => COMMS_DIR,
  DB_PATH: () => DB_PATH,
  FINDINGS_DIR: () => FINDINGS_DIR,
  HEARTBEATS_LOCK: () => HEARTBEATS_LOCK,
  HEARTBEATS_PATH: () => HEARTBEATS_PATH,
  INBOX_DIR: () => INBOX_DIR,
  PRESENCE_DIR: () => PRESENCE_DIR,
  RECEIPTS_DIR: () => RECEIPTS_DIR,
  RECEIPTS_LOCK: () => RECEIPTS_LOCK,
  RECEIPTS_PATH: () => RECEIPTS_PATH,
  REVIEWS_DIR: () => REVIEWS_DIR,
  ROUTE_LEASES_DIR: () => ROUTE_LEASES_DIR,
  SERVER_START: () => SERVER_START,
  TAP_ROUTING_SLOTS: () => TAP_ROUTING_SLOTS,
  buildAddressMetadata: () => buildAddressMetadata,
  buildAgentIdentityProbeSnapshot: () => buildAgentIdentityProbeSnapshot,
  buildHeartbeatConnectHash: () => buildHeartbeatConnectHash,
  canonicalizeAgentId: () => canonicalizeAgentId2,
  claimAgentName: () => claimAgentName,
  debug: () => debug,
  demoteAgentName: () => demoteAgentName,
  deriveRoutingSlotFromInstanceId: () => deriveRoutingSlotFromInstanceId,
  getAgentId: () => getAgentId,
  getAgentIdentitySnapshot: () => getAgentIdentitySnapshot,
  getAgentName: () => getAgentName,
  getAgentReceiveTransports: () => getAgentReceiveTransports,
  getAgentRoutingAddress: () => getAgentRoutingAddress,
  getAgentRoutingAliases: () => getAgentRoutingAliases,
  getAgentRoutingSlot: () => getAgentRoutingSlot,
  getLastActivityTime: () => getLastActivityTime,
  getLatestReviewDir: () => getLatestReviewDir,
  getRecentReplyableRecipients: () => getRecentReplyableRecipients,
  getRecentReplyableSenders: () => getRecentReplyableSenders,
  getRecentSenders: () => getRecentSenders,
  getRoutingRuntimeConflicts: () => getRoutingRuntimeConflicts,
  getRoutingRuntimeKey: () => getRoutingRuntimeKey,
  getSourceDir: () => getSourceDir,
  getSourceKey: () => getSourceKey,
  isForMe: () => isForMe,
  isIdLocked: () => isIdLocked,
  isInGraceWindow: () => isInGraceWindow,
  isInboxFrontmatterForCurrentAgent: () => isInboxFrontmatterForCurrentAgent,
  isNameConfirmed: () => isNameConfirmed,
  isOwnMessageAddressForCurrentAgent: () => isOwnMessageAddressForCurrentAgent,
  loadStateInstances: () => loadStateInstances,
  logError: () => logError,
  logInfo: () => logInfo,
  logWarn: () => logWarn,
  normalizeRoutingSlot: () => normalizeRoutingSlot,
  normalizeSources: () => normalizeSources,
  parseFilename: () => parseFilename,
  parseFrontmatter: () => parseFrontmatter,
  parseMessageRoute: () => parseMessageRoute,
  resetIdentity: () => resetIdentity,
  resolveCurrentInstanceId: () => resolveCurrentInstanceId,
  resolveKnownInstanceId: () => resolveKnownInstanceId,
  sealGraceWindow: () => sealGraceWindow,
  setAgentName: () => setAgentName,
  setObservedMcpClientName: () => setObservedMcpClientName,
  stripBom: () => stripBom,
  stripFrontmatter: () => stripFrontmatter,
  updateActivityTime: () => updateActivityTime
});
import {
  appendFileSync,
  existsSync as existsSync2,
  mkdirSync as mkdirSync2,
  readFileSync as readFileSync2,
  readdirSync as readdirSync2,
  renameSync as renameSync2,
  rmSync,
  statSync as statSync2,
  writeFileSync as writeFileSync2
} from "fs";
import { createHash, randomUUID as randomUUID2 } from "crypto";
import { basename as basename2, dirname, join as join2, resolve } from "path";
function isConcreteIdentity(value) {
  return !isPlaceholderAgentValue(value);
}
function normalizeAgentId(value) {
  return canonicalizeAgentId(value);
}
function loadStateInstances() {
  const stateDir = process.env.TAP_STATE_DIR;
  if (!stateDir) return null;
  try {
    const statePath = join2(stateDir, "state.json");
    if (!existsSync2(statePath)) return null;
    const state = JSON.parse(readFileSync2(statePath, "utf-8"));
    return state.instances ?? null;
  } catch {
    return null;
  }
}
function normalizeRoutingSlot(value) {
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
function deriveRoutingSlotFromInstanceId(instanceId) {
  const normalized = normalizeAgentId(instanceId ?? "");
  if (!normalized) return null;
  if (normalized === "tower" || normalized === "claude_main" || normalized === "codex_main") {
    return "tower";
  }
  if (normalized === "reviewer" || normalized === "claude_reviewer" || normalized === "codex_reviewer") {
    return "reviewer";
  }
  const worktreeMatch = normalized.match(/^(?:(?:claude|codex)_)?wt_?(\d+)$/);
  if (worktreeMatch) {
    return `wt-${Number.parseInt(worktreeMatch[1], 10)}`;
  }
  return null;
}
function resolveRepoRootRoutingSlot(repoRoot = process.env.TAP_REPO_ROOT) {
  if (!repoRoot?.trim()) return null;
  return normalizeRoutingSlot(basename2(resolve(repoRoot)));
}
function resolveRoutingAliases(values) {
  const aliases = [];
  for (const value of values) {
    const normalized = value?.trim();
    if (!normalized) continue;
    if (aliases.some(
      (alias) => alias === normalized || sameRoutingAddress(alias, normalized)
    )) {
      continue;
    }
    aliases.push(normalized);
  }
  return aliases;
}
function matchesRoutingAliases(value, aliases, includeBroadcast = false) {
  const normalized = value.trim();
  if (!normalized) return false;
  if (includeBroadcast && isBroadcastRecipient(normalized)) {
    return true;
  }
  return aliases.some(
    (alias) => alias === normalized || sameRoutingAddress(alias, normalized)
  );
}
function isGenericRuntimeRecipient(value) {
  if (!value?.trim()) return false;
  return GENERIC_RUNTIME_RECIPIENTS.has(normalizeAgentId(value));
}
function parseAddressAliases(value) {
  if (!value?.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    const aliases = Array.isArray(parsed.aliases) ? parsed.aliases.filter(
      (alias) => typeof alias === "string"
    ) : [];
    if (typeof parsed.routingAddress === "string") {
      aliases.push(parsed.routingAddress);
    }
    return aliases.map((alias) => alias.trim()).filter(Boolean);
  } catch {
    return [];
  }
}
function structuredRecipientHints(frontmatter) {
  const hints = [
    frontmatter.to_name,
    ...parseAddressAliases(frontmatter.to_address)
  ].filter((value) => Boolean(value?.trim()));
  const concrete = [];
  for (const hint of hints) {
    if (isGenericRuntimeRecipient(hint)) continue;
    if (concrete.some(
      (value) => normalizeAgentId(value) === normalizeAgentId(hint)
    )) {
      continue;
    }
    concrete.push(hint);
  }
  return concrete;
}
function isInboxFrontmatterForCurrentAgent(frontmatter) {
  const concreteHints = structuredRecipientHints(frontmatter);
  if (concreteHints.length > 0) {
    const aliases = getAgentRoutingAliases();
    if (concreteHints.some((hint) => matchesRoutingAliases(hint, aliases))) {
      return true;
    }
    if (isGenericRuntimeRecipient(frontmatter.to)) {
      return false;
    }
  }
  return isForMe(frontmatter.to);
}
function resolveRuntimeKind(instanceId) {
  if (!instanceId) return null;
  const normalizedId = normalizeAgentId(instanceId);
  if (normalizedId === "claude" || normalizedId.startsWith("claude_")) {
    return "claude";
  }
  if (normalizedId === "codex" || normalizedId.startsWith("codex_")) {
    return "codex";
  }
  return null;
}
function hasCodexRuntimeStateDir() {
  const runtimeStateDir = resolveRuntimeStateDir();
  if (!runtimeStateDir) return false;
  return basename2(runtimeStateDir).startsWith(BRIDGE_RUNTIME_STATE_DIR_PREFIX);
}
function hasCodexRuntimeSignal() {
  return isConcreteIdentity(process.env.TAP_BRIDGE_INSTANCE_ID) || isConcreteIdentity(process.env.CODEX_TAP_AGENT_NAME) || hasCodexRuntimeStateDir();
}
function resolveSingleCodexBootstrap() {
  if (isConcreteIdentity(process.env.TAP_INSTANCE_ID)) return null;
  if (!hasCodexRuntimeSignal()) return null;
  const instances = loadStateInstances();
  if (!instances) return null;
  const installedCodexInstances = Object.entries(instances).filter(
    ([, instance2]) => instance2?.runtime === "codex" && instance2?.installed
  );
  if (installedCodexInstances.length !== 1) return null;
  const [instanceId, instance] = installedCodexInstances[0];
  const stateAgentName = instance.defaultAgentName ?? instance.agentName;
  return {
    agentId: normalizeAgentId(instanceId),
    agentName: typeof stateAgentName === "string" && !isPlaceholderAgentValue(stateAgentName) ? stateAgentName : null
  };
}
function resolveRuntimeInstanceId() {
  const instanceId = process.env.TAP_INSTANCE_ID;
  if (isConcreteIdentity(instanceId)) {
    return normalizeAgentId(instanceId);
  }
  const bridgeInstanceId = process.env.TAP_BRIDGE_INSTANCE_ID;
  if (isConcreteIdentity(bridgeInstanceId)) {
    return normalizeAgentId(bridgeInstanceId);
  }
  const envId = process.env.TAP_AGENT_ID;
  if (isConcreteIdentity(envId)) {
    return normalizeAgentId(envId);
  }
  return null;
}
function resolveRuntimeStateDir() {
  const runtimeStateDir = process.env.TAP_RUNTIME_STATE_DIR;
  if (!runtimeStateDir) return null;
  return resolve(runtimeStateDir);
}
function resolveRuntimeStateInstanceId() {
  const runtimeStateDir = resolveRuntimeStateDir();
  if (!runtimeStateDir) return null;
  const dirName = basename2(runtimeStateDir);
  if (!dirName.startsWith(BRIDGE_RUNTIME_STATE_DIR_PREFIX)) {
    return null;
  }
  const instanceId = dirName.slice(BRIDGE_RUNTIME_STATE_DIR_PREFIX.length).trim();
  if (!instanceId) return null;
  return normalizeAgentId(instanceId);
}
function resolveRuntimeStateDisplayName() {
  const runtimeStateDir = resolveRuntimeStateDir();
  if (!runtimeStateDir) return null;
  try {
    const heartbeatPath = join2(runtimeStateDir, "heartbeat.json");
    if (existsSync2(heartbeatPath)) {
      const heartbeat = JSON.parse(readFileSync2(heartbeatPath, "utf-8"));
      const heartbeatAgent = heartbeat.agent ?? void 0;
      if (isConcreteIdentity(heartbeatAgent)) {
        return heartbeatAgent;
      }
    }
  } catch {
  }
  try {
    const agentNamePath = join2(runtimeStateDir, "agent-name.txt");
    if (!existsSync2(agentNamePath)) return null;
    const agentName = readFileSync2(agentNamePath, "utf-8").trim();
    return isConcreteIdentity(agentName) ? agentName : null;
  } catch {
    return null;
  }
}
function resolveRuntimeDisplayName() {
  const envName = process.env.TAP_AGENT_NAME;
  if (isConcreteIdentity(envName)) return envName;
  const codexName = process.env.CODEX_TAP_AGENT_NAME;
  if (isConcreteIdentity(codexName)) return codexName;
  const runtimeName = resolveRuntimeStateDisplayName();
  if (runtimeName) return runtimeName;
  return null;
}
function resolveCurrentConversationId() {
  const envThreadId = process.env.TAP_THREAD_ID;
  if (isConcreteIdentity(envThreadId)) return envThreadId.trim();
  const runtimeStateDir = resolveRuntimeStateDir();
  if (runtimeStateDir) {
    try {
      const heartbeatPath = join2(runtimeStateDir, "heartbeat.json");
      if (existsSync2(heartbeatPath)) {
        const heartbeat = JSON.parse(
          readFileSync2(heartbeatPath, "utf-8")
        );
        const threadId = heartbeat.threadId ?? void 0;
        if (isConcreteIdentity(threadId)) {
          return threadId.trim();
        }
      }
    } catch {
    }
    try {
      const threadPath = join2(runtimeStateDir, "thread.json");
      if (existsSync2(threadPath)) {
        const thread = JSON.parse(
          readFileSync2(threadPath, "utf-8")
        );
        const threadId = thread.threadId ?? void 0;
        if (isConcreteIdentity(threadId)) {
          return threadId.trim();
        }
      }
    } catch {
    }
  }
  const codexThreadId = process.env.CODEX_THREAD_ID;
  if (isConcreteIdentity(codexThreadId)) return codexThreadId.trim();
  return null;
}
function resolveHostId() {
  const explicitHostId = process.env.TAP_HOST_ID;
  if (isConcreteIdentity(explicitHostId)) return explicitHostId.trim();
  const computerName = process.env.COMPUTERNAME;
  if (isConcreteIdentity(computerName)) return computerName.trim();
  const hostName = process.env.HOSTNAME;
  if (isConcreteIdentity(hostName)) return hostName.trim();
  return COMMS_DIR || null;
}
function buildAddressMetadata(options) {
  const hostId = options.hostId?.trim() || resolveHostId();
  const clientId = options.instanceId?.trim() || null;
  const conversationId = options.conversationId?.trim() || null;
  const ownerClientId = options.ownerClientId?.trim() || (options.deriveOwnerClientIdFromInstance !== false && conversationId && clientId ? clientId : null);
  return {
    hostId,
    clientId,
    conversationId,
    ownerClientId,
    routingAddress: options.routingAddress,
    slot: options.slot ?? null,
    aliases: resolveRoutingAliases(
      options.aliases ?? [
        options.routingAddress,
        options.slot,
        options.instanceId,
        options.agentId
      ]
    )
  };
}
function resolveInitialId(stateBootstrap2) {
  const runtimeInstanceId = resolveRuntimeInstanceId();
  if (runtimeInstanceId) return runtimeInstanceId;
  const runtimeStateInstanceId = resolveRuntimeStateInstanceId();
  if (runtimeStateInstanceId) return runtimeStateInstanceId;
  return stateBootstrap2?.agentId ?? "unknown";
}
function resolveStateInstanceForCurrentRuntime(agentId, stateBootstrap2) {
  const instances = loadStateInstances();
  if (!instances) return null;
  const runtimeKind = (stateBootstrap2?.agentId === agentId ? "codex" : resolveRuntimeKind(
    resolveRuntimeInstanceId() ?? resolveRuntimeStateInstanceId() ?? agentId
  )) ?? null;
  const candidates = [
    agentId,
    agentId.replace(/_/g, "-"),
    agentId.replace(/-/g, "_")
  ];
  for (const candidate of candidates) {
    const instance = instances[candidate];
    if (!instance) continue;
    if (runtimeKind && instance.runtime && instance.runtime !== runtimeKind) {
      continue;
    }
    return instance;
  }
  return null;
}
function resolveNameFromState(agentId, stateBootstrap2) {
  if (agentId === "unknown") return null;
  if (stateBootstrap2?.agentId === agentId && stateBootstrap2.agentName) {
    return stateBootstrap2.agentName;
  }
  try {
    const instance = resolveStateInstanceForCurrentRuntime(
      agentId,
      stateBootstrap2
    );
    if (!instance) return null;
    const stateAgentName = instance.defaultAgentName ?? instance.agentName;
    return typeof stateAgentName === "string" && !isPlaceholderAgentValue(stateAgentName) ? stateAgentName : null;
  } catch {
    return null;
  }
}
function resolveLocalCurrentInstanceId() {
  const envInstanceId = process.env.TAP_INSTANCE_ID;
  if (envInstanceId && envInstanceId !== "unknown") return envInstanceId;
  if (_agentId === "unknown") return null;
  return resolveKnownInstanceId(_agentId, _agentName);
}
function getLocalRoutingSlot() {
  return normalizeRoutingSlot(process.env.TAP_ROUTING_SLOT) ?? deriveRoutingSlotFromInstanceId(process.env.TAP_INSTANCE_ID) ?? deriveRoutingSlotFromInstanceId(process.env.TAP_BRIDGE_INSTANCE_ID) ?? deriveRoutingSlotFromInstanceId(resolveLocalCurrentInstanceId()) ?? deriveRoutingSlotFromInstanceId(resolveRuntimeStateInstanceId()) ?? deriveRoutingSlotFromInstanceId(_agentId) ?? resolveRepoRootRoutingSlot();
}
function getLocalRoutingAddress() {
  return getLocalRoutingSlot() ?? resolveLocalCurrentInstanceId() ?? (!isPlaceholderAgentValue(_agentId) ? _agentId : !isPlaceholderAgentValue(_agentName) ? _agentName : _agentId);
}
function resolveObservedMcpClientRoutingAlias() {
  if (!_nameConfirmed || isPlaceholderAgentValue(_agentName)) return null;
  const clientName = _observedMcpClientName?.trim().toLowerCase();
  if (!clientName) return null;
  return clientName.includes("codex") ? "codex" : null;
}
function getLocalRoutingAliases() {
  return resolveRoutingAliases([
    getLocalRoutingAddress(),
    getLocalRoutingSlot(),
    resolveLocalCurrentInstanceId(),
    resolveRuntimeStateInstanceId(),
    resolveObservedMcpClientRoutingAlias(),
    _agentId,
    _agentName
  ]);
}
function resolveRoutingRuntimeKey() {
  const runtimeStateDir = resolveRuntimeStateDir();
  if (runtimeStateDir) return `runtime:${runtimeStateDir}`;
  const instanceId = resolveRuntimeInstanceId() ?? resolveRuntimeStateInstanceId() ?? resolveLocalCurrentInstanceId();
  if (instanceId) return `instance:${normalizeAgentId(instanceId)}`;
  return _agentId !== "unknown" ? `agent:${_agentId}` : null;
}
function resolveRoutingRuntimeRegistryDir() {
  const stateDir = process.env.TAP_STATE_DIR;
  if (!stateDir?.trim()) return null;
  return join2(resolve(stateDir), ROUTING_RUNTIME_DIRNAME);
}
function buildRoutingRuntimeRegistryPath(runtimeKey, pid = process.pid) {
  const registryDir = resolveRoutingRuntimeRegistryDir();
  if (!registryDir) return null;
  const keyHash = createHash("sha1").update(runtimeKey).digest("hex");
  return join2(registryDir, `${keyHash}-${pid}.json`);
}
function resolveRoutingRuntimeRegistryMarkerPath() {
  const registryDir = resolveRoutingRuntimeRegistryDir();
  if (!registryDir) return null;
  return join2(registryDir, ROUTING_RUNTIME_MARKER_FILENAME);
}
function buildLocalRoutingRuntimeSnapshot(runtimeKey) {
  return {
    version: 1,
    pid: process.pid,
    runtimeKey,
    agentId: _agentId,
    agentName: _agentName,
    idLocked: _idLocked,
    nameConfirmed: _nameConfirmed,
    routingAddress: getLocalRoutingAddress(),
    routingSlot: getLocalRoutingSlot(),
    aliases: getLocalRoutingAliases(),
    instanceId: resolveLocalCurrentInstanceId(),
    stateDir: process.env.TAP_STATE_DIR ?? null,
    runtimeStateDir: process.env.TAP_RUNTIME_STATE_DIR ?? null,
    repoRoot: process.env.TAP_REPO_ROOT ?? null,
    updatedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
}
function isRoutingRuntimeSnapshot(value) {
  if (!value || typeof value !== "object") return false;
  const candidate = value;
  return candidate.version === 1 && typeof candidate.pid === "number" && typeof candidate.runtimeKey === "string" && typeof candidate.agentId === "string" && typeof candidate.agentName === "string" && Array.isArray(candidate.aliases) && typeof candidate.updatedAt === "string";
}
function isRoutingRuntimeSnapshotAlive(snapshot) {
  if (!Number.isFinite(snapshot.pid)) return false;
  try {
    process.kill(snapshot.pid, 0);
    return true;
  } catch {
    return false;
  }
}
function parseSnapshotUpdatedAt(snapshot) {
  const updatedAt = new Date(snapshot.updatedAt).getTime();
  return Number.isNaN(updatedAt) ? 0 : updatedAt;
}
function getRoutingRuntimeSnapshotIdentityPriority(snapshot) {
  let priority = 0;
  if (!isPlaceholderAgentValue(snapshot.agentName)) priority += 4;
  if (snapshot.nameConfirmed) priority += 2;
  if (snapshot.agentId !== "unknown") priority += 1;
  return priority;
}
function compareRoutingRuntimeSnapshots(a, b) {
  const identityDelta = getRoutingRuntimeSnapshotIdentityPriority(b) - getRoutingRuntimeSnapshotIdentityPriority(a);
  if (identityDelta !== 0) return identityDelta;
  const timeDelta = parseSnapshotUpdatedAt(b) - parseSnapshotUpdatedAt(a);
  if (timeDelta !== 0) return timeDelta;
  return b.pid - a.pid;
}
function readRoutingRuntimeRegistryMarkerVersion() {
  const markerPath = resolveRoutingRuntimeRegistryMarkerPath();
  if (!markerPath || !existsSync2(markerPath)) return "missing";
  try {
    const raw = readFileSync2(markerPath, "utf-8").trim();
    if (!raw) return "empty";
    try {
      const parsed = JSON.parse(raw);
      if (typeof parsed.version === "string" && parsed.version.trim()) {
        return parsed.version;
      }
      if (typeof parsed.updatedAt === "string" && parsed.updatedAt.trim()) {
        const legacyHash = createHash("sha1").update(raw).digest("hex");
        return `legacy:${parsed.updatedAt}:${legacyHash}`;
      }
    } catch {
      if (raw) return raw;
    }
    return `legacy-stat:${statSync2(markerPath).mtimeMs}`;
  } catch {
    return "unreadable";
  }
}
function bumpRoutingRuntimeRegistryMarker() {
  const markerPath = resolveRoutingRuntimeRegistryMarkerPath();
  if (!markerPath) return;
  try {
    mkdirSync2(dirname(markerPath), { recursive: true });
    const tmpPath = `${markerPath}.tmp.${process.pid}`;
    writeFileSync2(
      tmpPath,
      JSON.stringify(
        {
          version: randomUUID2(),
          updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
          pid: process.pid
        },
        null,
        2
      ),
      "utf-8"
    );
    renameSync2(tmpPath, markerPath);
  } catch {
  }
}
function loadRoutingRuntimeRegistryState(force = false) {
  const runtimeKey = resolveRoutingRuntimeKey();
  const registryDir = resolveRoutingRuntimeRegistryDir();
  const markerVersion = readRoutingRuntimeRegistryMarkerVersion();
  if (!force && _routingRuntimeRegistryCache && _routingRuntimeRegistryCache.runtimeKey === runtimeKey && _routingRuntimeRegistryCache.markerVersion === markerVersion) {
    return _routingRuntimeRegistryCache;
  }
  if (!runtimeKey || !registryDir || !existsSync2(registryDir)) {
    const emptyState = {
      runtimeKey,
      latestCurrentRuntime: null,
      conflictingRuntimes: []
    };
    _routingRuntimeRegistryCache = {
      ...emptyState,
      markerVersion
    };
    return emptyState;
  }
  const liveSnapshots = [];
  for (const entry of readdirSync2(registryDir)) {
    if (!entry.endsWith(".json")) continue;
    try {
      const filePath = join2(registryDir, entry);
      const raw = JSON.parse(readFileSync2(filePath, "utf-8"));
      if (!isRoutingRuntimeSnapshot(raw)) continue;
      if (!isRoutingRuntimeSnapshotAlive(raw)) continue;
      liveSnapshots.push(raw);
    } catch {
    }
  }
  const state = {
    runtimeKey,
    latestCurrentRuntime: [...liveSnapshots].filter((snapshot) => snapshot.runtimeKey === runtimeKey).sort(compareRoutingRuntimeSnapshots)[0] ?? null,
    conflictingRuntimes: [...liveSnapshots].filter((snapshot) => snapshot.runtimeKey !== runtimeKey).sort(compareRoutingRuntimeSnapshots)
  };
  _routingRuntimeRegistryCache = {
    ...state,
    markerVersion
  };
  return state;
}
function syncRuntimeIdentityFromRegistry() {
  const registryState = loadRoutingRuntimeRegistryState();
  const latestSnapshot = registryState.latestCurrentRuntime;
  if (!latestSnapshot) return;
  const snapshotTs = parseSnapshotUpdatedAt(latestSnapshot);
  if (snapshotTs <= _lastPublishedRoutingSnapshotAt) return;
  _agentId = latestSnapshot.agentId || _agentId;
  _agentName = latestSnapshot.agentName || _agentName;
  _idLocked = latestSnapshot.idLocked || _agentId !== "unknown";
  _nameConfirmed = latestSnapshot.nameConfirmed;
  _bootstrapSuppressed = false;
}
function persistRoutingRuntimeSnapshot() {
  const runtimeKey = resolveRoutingRuntimeKey();
  const targetPath = runtimeKey != null ? buildRoutingRuntimeRegistryPath(runtimeKey) : null;
  if (!runtimeKey || !targetPath) return;
  try {
    mkdirSync2(dirname(targetPath), { recursive: true });
    const snapshot = buildLocalRoutingRuntimeSnapshot(runtimeKey);
    const tmpPath = `${targetPath}.tmp.${process.pid}`;
    writeFileSync2(tmpPath, JSON.stringify(snapshot, null, 2), "utf-8");
    renameSync2(tmpPath, targetPath);
    bumpRoutingRuntimeRegistryMarker();
    _lastPublishedRoutingSnapshotAt = parseSnapshotUpdatedAt(snapshot) || Date.now();
    _routingRuntimeRegistryCache = null;
  } catch {
  }
}
function clearRoutingRuntimeSnapshot() {
  const runtimeKey = resolveRoutingRuntimeKey();
  const targetPath = runtimeKey != null ? buildRoutingRuntimeRegistryPath(runtimeKey) : null;
  if (!targetPath) return;
  try {
    rmSync(targetPath, { force: true });
    bumpRoutingRuntimeRegistryMarker();
    _routingRuntimeRegistryCache = null;
  } catch {
  }
}
function refreshUnknownIdentity() {
  if (_bootstrapSuppressed) return;
  if (_idLocked) return;
  const nextBootstrap = resolveSingleCodexBootstrap();
  const nextId = resolveInitialId(nextBootstrap);
  if (nextId === "unknown") return;
  _agentId = nextId;
  _idLocked = true;
  const nextName = resolveNameFromState(nextId, nextBootstrap) ?? resolveRuntimeDisplayName();
  if (nextName && !isPlaceholderAgentValue(nextName)) {
    _agentName = nextName;
    _nameConfirmed = true;
  }
}
function getAgentId() {
  refreshUnknownIdentity();
  syncRuntimeIdentityFromRegistry();
  return _agentId;
}
function getAgentName() {
  refreshUnknownIdentity();
  syncRuntimeIdentityFromRegistry();
  return _agentName;
}
function resolveKnownInstanceId(agentId, displayName) {
  const instances = loadStateInstances();
  if (!instances) return null;
  const candidates = [
    agentId,
    agentId.replace(/_/g, "-"),
    agentId.replace(/-/g, "_")
  ];
  for (const candidate of candidates) {
    if (instances[candidate]?.installed) return candidate;
  }
  if (!displayName || isPlaceholderAgentValue(displayName)) return null;
  const matches = Object.entries(instances).filter(
    ([, instance]) => instance?.installed && (instance.defaultAgentName ?? instance.agentName) === displayName
  );
  return matches.length === 1 ? matches[0][0] : null;
}
function resolveCurrentInstanceId() {
  const envInstanceId = process.env.TAP_INSTANCE_ID;
  if (envInstanceId && envInstanceId !== "unknown") return envInstanceId;
  refreshUnknownIdentity();
  syncRuntimeIdentityFromRegistry();
  if (_agentId === "unknown") return null;
  return resolveKnownInstanceId(_agentId, _agentName);
}
function getAgentRoutingSlot() {
  refreshUnknownIdentity();
  syncRuntimeIdentityFromRegistry();
  return normalizeRoutingSlot(process.env.TAP_ROUTING_SLOT) ?? deriveRoutingSlotFromInstanceId(process.env.TAP_INSTANCE_ID) ?? deriveRoutingSlotFromInstanceId(process.env.TAP_BRIDGE_INSTANCE_ID) ?? deriveRoutingSlotFromInstanceId(resolveCurrentInstanceId()) ?? deriveRoutingSlotFromInstanceId(resolveRuntimeStateInstanceId()) ?? deriveRoutingSlotFromInstanceId(_agentId) ?? resolveRepoRootRoutingSlot();
}
function getAgentRoutingAddress() {
  refreshUnknownIdentity();
  syncRuntimeIdentityFromRegistry();
  return getAgentRoutingSlot() ?? resolveCurrentInstanceId() ?? (!isPlaceholderAgentValue(_agentId) ? _agentId : !isPlaceholderAgentValue(_agentName) ? _agentName : _agentId);
}
function getAgentRoutingAliases() {
  refreshUnknownIdentity();
  syncRuntimeIdentityFromRegistry();
  const localAliases = getLocalRoutingAliases();
  const latestSnapshot = loadRoutingRuntimeRegistryState().latestCurrentRuntime;
  return resolveRoutingAliases([
    ...latestSnapshot?.aliases ?? [],
    ...localAliases
  ]);
}
function getAgentReceiveTransports() {
  refreshUnknownIdentity();
  syncRuntimeIdentityFromRegistry();
  const resolvedCurrentInstanceId = resolveCurrentInstanceId();
  return inferReceiveTransports({
    runtimeName: resolveRuntimeKind(
      resolvedCurrentInstanceId ?? resolveRuntimeStateInstanceId() ?? _agentId
    ) ?? null,
    instanceId: resolvedCurrentInstanceId,
    bridgeInstanceId: process.env.TAP_BRIDGE_INSTANCE_ID ?? resolveRuntimeStateInstanceId(),
    agentId: _agentId,
    runtimeStateDir: process.env.TAP_RUNTIME_STATE_DIR ?? null,
    mcpClientName: _observedMcpClientName
  });
}
function setObservedMcpClientName(name) {
  const normalized = name?.trim();
  _observedMcpClientName = normalized || null;
}
function isOwnMessageAddressForCurrentAgent(sender) {
  refreshUnknownIdentity();
  return matchesRoutingAliases(sender, getAgentRoutingAliases());
}
function getAgentIdentitySnapshot() {
  refreshUnknownIdentity();
  const bootstrap = resolveSingleCodexBootstrap();
  const resolvedCurrentInstanceId = resolveCurrentInstanceId();
  const resolvedRoutingSlot = getAgentRoutingSlot();
  const resolvedRoutingAddress = resolvedRoutingSlot ?? resolvedCurrentInstanceId ?? (!isPlaceholderAgentValue(_agentId) ? _agentId : !isPlaceholderAgentValue(_agentName) ? _agentName : _agentId);
  const resolvedRoutingAliases = getAgentRoutingAliases();
  const conversationId = resolveCurrentConversationId();
  return {
    agentId: _agentId,
    agentName: _agentName,
    idLocked: _idLocked,
    nameConfirmed: _nameConfirmed,
    address: buildAddressMetadata({
      agentId: _agentId,
      instanceId: resolvedCurrentInstanceId,
      routingAddress: resolvedRoutingAddress,
      slot: resolvedRoutingSlot,
      aliases: resolvedRoutingAliases,
      conversationId
    }),
    runtimeEnv: {
      routingSlot: normalizeRoutingSlot(process.env.TAP_ROUTING_SLOT),
      instanceId: process.env.TAP_INSTANCE_ID ?? null,
      bridgeInstanceId: process.env.TAP_BRIDGE_INSTANCE_ID ?? null,
      agentId: process.env.TAP_AGENT_ID ?? null,
      agentName: process.env.TAP_AGENT_NAME ?? null,
      codexTapAgentName: process.env.CODEX_TAP_AGENT_NAME ?? null,
      commsDir: process.env.TAP_COMMS_DIR ?? null,
      stateDir: process.env.TAP_STATE_DIR ?? null,
      runtimeStateDir: process.env.TAP_RUNTIME_STATE_DIR ?? null,
      repoRoot: process.env.TAP_REPO_ROOT ?? null
    },
    bootstrap,
    resolvedCurrentInstanceId,
    resolvedRoutingSlot,
    resolvedRoutingAddress,
    resolvedRoutingAliases
  };
}
function buildAgentIdentityProbeSnapshot(testName) {
  const snapshot = getAgentIdentitySnapshot();
  const registryState = loadRoutingRuntimeRegistryState();
  const envAgentName = snapshot.runtimeEnv.agentName;
  const probe = {
    ...snapshot,
    bootstrapDrift: {
      envAgentName,
      envAgentNameIsPlaceholder: isPlaceholderAgentValue(envAgentName),
      runtimeAgentName: snapshot.agentName,
      differsFromRuntime: Boolean(envAgentName?.trim()) && envAgentName !== snapshot.agentName
    },
    runtimeCoordination: {
      runtimeKey: registryState.runtimeKey,
      conflictingRuntimes: registryState.conflictingRuntimes.map(
        (runtime) => ({
          pid: runtime.pid,
          runtimeKey: runtime.runtimeKey,
          agentId: runtime.agentId,
          agentName: runtime.agentName,
          updatedAt: runtime.updatedAt,
          stateDir: runtime.stateDir,
          runtimeStateDir: runtime.runtimeStateDir,
          repoRoot: runtime.repoRoot,
          aliases: runtime.aliases
        })
      )
    }
  };
  const normalizedTestName = testName?.trim();
  if (normalizedTestName) {
    probe.dryRun = {
      testName: normalizedTestName,
      matches: isForMe(normalizedTestName)
    };
  }
  return probe;
}
function buildHeartbeatConnectHash(instanceId, agentId) {
  return instanceId ? `instance:${instanceId}` : `session:${agentId}`;
}
function isNameConfirmed() {
  return _nameConfirmed;
}
function demoteAgentName() {
  _agentName = "unknown";
  _nameConfirmed = false;
}
function setAgentName(name) {
  _agentName = name;
  _nameConfirmed = true;
  _bootstrapSuppressed = false;
  if (!_idLocked) {
    _agentId = canonicalizeAgentId(name);
    _idLocked = true;
  }
  persistRoutingRuntimeSnapshot();
}
function getRoutingRuntimeKey() {
  refreshUnknownIdentity();
  syncRuntimeIdentityFromRegistry();
  return resolveRoutingRuntimeKey();
}
function getRoutingRuntimeConflicts() {
  refreshUnknownIdentity();
  syncRuntimeIdentityFromRegistry();
  return loadRoutingRuntimeRegistryState().conflictingRuntimes.map(
    (runtime) => ({
      pid: runtime.pid,
      runtimeKey: runtime.runtimeKey,
      agentId: runtime.agentId,
      agentName: runtime.agentName,
      updatedAt: runtime.updatedAt,
      stateDir: runtime.stateDir,
      runtimeStateDir: runtime.runtimeStateDir,
      repoRoot: runtime.repoRoot,
      aliases: runtime.aliases
    })
  );
}
function resolveResetFallbackName(previousName) {
  if (_hasExplicitEnvName && _envAgentName !== previousName) {
    return _envAgentName;
  }
  return "unknown";
}
async function resetIdentity() {
  const previousName = _agentName;
  const previousId = _agentId;
  let releasedClaim = false;
  if (!isPlaceholderAgentValue(previousName)) {
    try {
      const { releaseClaim: releaseClaim2, resolveClaimInstanceId: resolveClaimInstanceId2 } = await Promise.resolve().then(() => (init_tap_claims(), tap_claims_exports));
      releasedClaim = releaseClaim2(
        previousName,
        resolveClaimInstanceId2(),
        process.pid
      );
    } catch {
      releasedClaim = false;
    }
  }
  _agentId = "unknown";
  _agentName = resolveResetFallbackName(previousName);
  _idLocked = false;
  _nameConfirmed = false;
  _nameSetAt = null;
  _graceSealedByToolCall = false;
  _bootstrapSuppressed = true;
  clearRoutingRuntimeSnapshot();
  return {
    previousName,
    previousId,
    nextName: _agentName,
    nextId: _agentId,
    releasedClaim
  };
}
function claimAgentName(name) {
  const oldName = _agentName;
  const wasIdLocked = _idLocked;
  if (_nameConfirmed && name !== oldName) {
    if (!isInGraceWindow()) {
      return {
        ok: false,
        currentName: oldName,
        agentId: _agentId
      };
    }
  }
  const isRename = name !== oldName;
  setAgentName(name);
  if (isRename) {
    _nameSetAt = Date.now();
    _graceSealedByToolCall = false;
  } else if (!_nameSetAt && !_graceSealedByToolCall) {
    _nameSetAt = Date.now();
  }
  return {
    ok: true,
    oldName,
    agentId: _agentId,
    wasIdLocked
  };
}
function isInGraceWindow() {
  if (!_nameSetAt || _graceSealedByToolCall) return false;
  return Date.now() - _nameSetAt < GRACE_WINDOW_MS;
}
function sealGraceWindow() {
  if (_nameConfirmed && !_graceSealedByToolCall) {
    _graceSealedByToolCall = true;
  }
}
function isIdLocked() {
  return _idLocked;
}
function getLastActivityTime() {
  return _lastActivityTime;
}
function updateActivityTime() {
  _lastActivityTime = (/* @__PURE__ */ new Date()).toISOString();
}
function formatTapLogValue(value) {
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
function formatTapLogContext(context) {
  if (!context) {
    return "";
  }
  const entries = Object.entries(context).filter(
    ([, value]) => value !== void 0
  );
  if (entries.length === 0) {
    return "";
  }
  return ` ${entries.map(([key, value]) => `${key}=${formatTapLogValue(value)}`).join(" ")}`;
}
function getTapLogPath() {
  const explicit = process.env.TAP_CHANNEL_LOG_PATH?.trim();
  if (explicit) {
    return resolve(explicit);
  }
  const stateDir = process.env.TAP_STATE_DIR?.trim();
  if (!stateDir) {
    return null;
  }
  return join2(resolve(stateDir), "logs", "tap-mcp.log");
}
function writeTapLog(line) {
  const logPath = getTapLogPath();
  if (!logPath) {
    return;
  }
  try {
    mkdirSync2(dirname(logPath), { recursive: true });
    appendFileSync(logPath, `${line}
`, "utf-8");
  } catch {
  }
}
function logTap(level, message, context) {
  const stamp = (/* @__PURE__ */ new Date()).toISOString().replace("T", " ").replace("Z", " UTC");
  const line = `[${stamp}] ${level.toUpperCase()} ${message}${formatTapLogContext(context)}`;
  if (level === "warn") {
    console.warn(`[tap-comms] ${line}`);
  } else if (level === "error") {
    console.error(`[tap-comms] ${line}`);
  } else {
    console.error(`[tap-comms] ${line}`);
  }
  writeTapLog(line);
}
function debug(message, context) {
  logTap("debug", message, context);
}
function logInfo(message, context) {
  logTap("info", message, context);
}
function logWarn(message, context) {
  logTap("warn", message, context);
}
function logError(message, context) {
  logTap("error", message, context);
}
function stripBom(text) {
  return text.charCodeAt(0) === 65279 ? text.slice(1) : text;
}
function parseFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return null;
  const fields = {};
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
    message_id: fields.message_id,
    from_address: fields.from_address,
    to_address: fields.to_address,
    scope: fields.scope,
    action: fields.action,
    consent_ref: fields.consent_ref
  };
}
function stripFrontmatter(content) {
  return content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n*/, "");
}
function parseMessageRoute(filename, content) {
  if (content) {
    const fm = parseFrontmatter(content);
    if (fm) return { from: fm.from, to: fm.to, subject: fm.subject };
  }
  return parseFilename(filename);
}
function parseFilename(filename) {
  const withoutExt = filename.replace(/\.md$/, "");
  const dateMatch = withoutExt.match(/^(\d{8})-(.+)$/);
  if (!dateMatch) return null;
  const rest = dateMatch[2];
  const cjkMatch = rest.match(
    /^([\u3131-\uD79DA-Za-z][\w]*?)-([\u3131-\uD79DA-Za-z][\w]*?)-(.+)$/
  );
  if (cjkMatch) {
    return { from: cjkMatch[1], to: cjkMatch[2], subject: cjkMatch[3] };
  }
  const parts = rest.split("-");
  if (parts.length >= 3) {
    return {
      from: parts[0] || "?",
      to: parts[1] || "?",
      subject: parts.slice(2).join("-") || "?"
    };
  }
  return null;
}
function canonicalizeAgentId2(id) {
  return canonicalizeAgentId(id);
}
function isForMe(to) {
  refreshUnknownIdentity();
  return matchesRoutingAliases(to, getAgentRoutingAliases(), true);
}
function normalizeSources(value) {
  if (!Array.isArray(value) || value.length === 0) {
    return ["inbox", "reviews"];
  }
  const allowed = /* @__PURE__ */ new Set(["inbox", "reviews", "findings"]);
  const normalized = value.filter(
    (entry) => typeof entry === "string" && allowed.has(entry)
  );
  return normalized.length ? normalized : ["inbox", "reviews"];
}
function getLatestReviewDir() {
  if (!existsSync2(REVIEWS_DIR)) return null;
  const gens = readdirSync2(REVIEWS_DIR).filter((entry) => entry.startsWith("gen")).sort();
  return gens.length ? join2(REVIEWS_DIR, gens[gens.length - 1]) : null;
}
function getSourceDir(source) {
  if (source === "inbox") return INBOX_DIR;
  if (source === "reviews") return getLatestReviewDir();
  return FINDINGS_DIR;
}
function getSourceKey(source, filename) {
  return `${source}/${filename}`;
}
function getRecentSenders() {
  const senders = /* @__PURE__ */ new Set();
  if (!existsSync2(INBOX_DIR)) return senders;
  const cutoff = Date.now() - 24 * 60 * 60 * 1e3;
  for (const filename of readdirSync2(INBOX_DIR)) {
    if (!filename.endsWith(".md")) continue;
    try {
      const mtime = statSync2(join2(INBOX_DIR, filename)).mtimeMs;
      if (mtime < cutoff) continue;
    } catch {
      continue;
    }
    const parsed = parseFilename(filename);
    if (parsed) senders.add(parsed.from);
  }
  return senders;
}
function getRecentReplyableSenders() {
  return new Set(getRecentReplyableRecipients().keys());
}
function getRecentReplyableRecipients() {
  if (!existsSync2(INBOX_DIR)) return /* @__PURE__ */ new Map();
  const cutoff = Date.now() - 24 * 60 * 60 * 1e3;
  const routingAliases = getAgentRoutingAliases();
  const recipients = /* @__PURE__ */ new Map();
  for (const filename of readdirSync2(INBOX_DIR)) {
    if (!filename.endsWith(".md")) continue;
    const filePath = join2(INBOX_DIR, filename);
    try {
      const mtime = statSync2(filePath).mtimeMs;
      if (mtime < cutoff) continue;
    } catch {
      continue;
    }
    try {
      const content = readFileSync2(filePath, "utf-8");
      const frontmatter = parseFrontmatter(content);
      const route = parseMessageRoute(filename, content);
      if (!route) continue;
      if (!isBroadcastRecipient(route.to) && !matchesRoutingAliases(route.to, routingAliases)) {
        continue;
      }
      const routingTarget = isPlaceholderAgentValue(route.from) ? null : route.from;
      if (routingTarget) {
        recipients.set(routingTarget, routingTarget);
      }
      const fromName = frontmatter?.from_name?.trim() || null;
      if (fromName && !isPlaceholderAgentValue(fromName)) {
        recipients.set(fromName, routingTarget ?? fromName);
      }
    } catch {
    }
  }
  return recipients;
}
var RAW_COMMS_DIR, COMMS_DIR, INBOX_DIR, REVIEWS_DIR, FINDINGS_DIR, RECEIPTS_DIR, RECEIPTS_PATH, RECEIPTS_LOCK, HEARTBEATS_PATH, HEARTBEATS_LOCK, PRESENCE_DIR, ROUTE_LEASES_DIR, ARCHIVE_DIR, DB_PATH, SERVER_START, BRIDGE_RUNTIME_STATE_DIR_PREFIX, TAP_ROUTING_SLOTS, GENERIC_RUNTIME_RECIPIENTS, ROUTING_RUNTIME_DIRNAME, ROUTING_RUNTIME_MARKER_FILENAME, _lastPublishedRoutingSnapshotAt, _routingRuntimeRegistryCache, stateBootstrap, _agentId, _envAgentName, _hasExplicitEnvName, _agentName, _idLocked, _nameConfirmed, GRACE_WINDOW_MS, _nameSetAt, _graceSealedByToolCall, _bootstrapSuppressed, _observedMcpClientName, _lastActivityTime;
var init_tap_utils = __esm({
  "packages/tap-plugin/channels/tap-utils.ts"() {
    "use strict";
    init_tap_identity();
    init_receive_transports();
    RAW_COMMS_DIR = process.env.TAP_COMMS_DIR;
    if (!RAW_COMMS_DIR) {
      console.error(
        "[tap-comms] FATAL: TAP_COMMS_DIR not set. Set via env or .tap-config"
      );
      process.exit(1);
    }
    COMMS_DIR = resolve(RAW_COMMS_DIR);
    INBOX_DIR = join2(COMMS_DIR, "inbox");
    REVIEWS_DIR = join2(COMMS_DIR, "reviews");
    FINDINGS_DIR = join2(COMMS_DIR, "findings");
    RECEIPTS_DIR = join2(COMMS_DIR, "receipts");
    RECEIPTS_PATH = join2(RECEIPTS_DIR, "receipts.json");
    RECEIPTS_LOCK = join2(RECEIPTS_DIR, ".lock");
    HEARTBEATS_PATH = join2(COMMS_DIR, "heartbeats.json");
    HEARTBEATS_LOCK = join2(COMMS_DIR, ".heartbeats.lock");
    PRESENCE_DIR = join2(COMMS_DIR, "presence");
    ROUTE_LEASES_DIR = join2(COMMS_DIR, "route-leases");
    ARCHIVE_DIR = join2(COMMS_DIR, "archive");
    DB_PATH = join2(COMMS_DIR, "tap.db");
    SERVER_START = Date.now();
    BRIDGE_RUNTIME_STATE_DIR_PREFIX = "codex-app-server-bridge-";
    TAP_ROUTING_SLOTS = [
      "tower",
      "wt-1",
      "wt-2",
      "reviewer"
    ];
    GENERIC_RUNTIME_RECIPIENTS = /* @__PURE__ */ new Set([
      "codex",
      "reviewer",
      "implementer",
      "implementation"
    ]);
    ROUTING_RUNTIME_DIRNAME = "routing-runtimes";
    ROUTING_RUNTIME_MARKER_FILENAME = ".registry-version";
    _lastPublishedRoutingSnapshotAt = 0;
    _routingRuntimeRegistryCache = null;
    stateBootstrap = resolveSingleCodexBootstrap();
    _agentId = resolveInitialId(stateBootstrap);
    _envAgentName = process.env.TAP_AGENT_NAME;
    _hasExplicitEnvName = isConcreteIdentity(_envAgentName) && !isPlaceholderAgentValue(_envAgentName);
    _agentName = _hasExplicitEnvName ? _envAgentName : resolveNameFromState(_agentId, stateBootstrap) ?? resolveRuntimeDisplayName() ?? "unknown";
    _idLocked = _agentId !== "unknown";
    _nameConfirmed = _hasExplicitEnvName;
    GRACE_WINDOW_MS = 6e4;
    _nameSetAt = null;
    _graceSealedByToolCall = _nameConfirmed;
    _bootstrapSuppressed = false;
    _observedMcpClientName = null;
    persistRoutingRuntimeSnapshot();
    _lastActivityTime = (/* @__PURE__ */ new Date()).toISOString();
  }
});

// src/reviews/stale-meta.ts
import * as fs from "fs";
import * as path from "path";
function classifyReviewMetaForOperator(options) {
  const subject = options.subject.trim();
  const body = options.body;
  const prNumber = extractPrNumber(subject) ?? extractPrNumber(options.filename) ?? extractPrNumber(body);
  const forceReviewMeta = isProvenanceOnlyReviewMetaSubject(subject);
  if (!forceReviewMeta && isFormalReviewOutcome(subject, body)) {
    return {
      status: "new-formal-outcome",
      prNumber,
      reason: "formal review outcome remains operator-visible",
      terminalEvidencePath: null
    };
  }
  if (!isReviewMetaSubject(subject)) {
    return {
      status: "not-review-meta",
      prNumber,
      reason: "not a review-meta subject",
      terminalEvidencePath: null
    };
  }
  if (prNumber === null) {
    return {
      status: "ambiguous",
      prNumber,
      reason: "review-meta message has no PR number",
      terminalEvidencePath: null
    };
  }
  const terminalEvidencePath = findTerminalEvidence({
    root: options.root,
    prNumber,
    sourceRelativePath: options.sourceRelativePath ?? path.posix.join("inbox", options.filename)
  });
  if (terminalEvidencePath) {
    return {
      status: "collapsed-stale-meta",
      prNumber,
      reason: "terminal review or merge evidence already exists",
      terminalEvidencePath
    };
  }
  return {
    status: "provenance-only",
    prNumber,
    reason: "review-meta message has no known terminal evidence yet",
    terminalEvidencePath: null
  };
}
function findTerminalEvidence(input) {
  const registered = findRegisteredReviewEvidence(input.root, input.prNumber);
  if (registered) return registered;
  const sourceRelativePath = normalizeRelativePath(input.sourceRelativePath);
  for (const filePath of listMarkdownFiles(input.root, [
    "inbox",
    "archive",
    "reviews"
  ])) {
    const relativePath = normalizeRelativePath(
      path.relative(input.root, filePath)
    );
    if (relativePath === sourceRelativePath) continue;
    if (relativePath.startsWith("reviews/registered/")) continue;
    const raw = readIfExists(filePath);
    if (raw === null) continue;
    const { frontmatter, body } = splitFrontmatter(raw);
    const filename = path.basename(filePath);
    const subject = frontmatter.subject ?? inferSubjectFromFilename(filename) ?? filename;
    const prNumber = extractPrNumber(subject) ?? extractPrNumber(filename) ?? extractPrNumber(body);
    if (prNumber !== input.prNumber) continue;
    if (isFormalReviewOutcome(subject, body) || isMergeTerminal(subject, body)) {
      return relativePath;
    }
  }
  return null;
}
function findRegisteredReviewEvidence(root, prNumber) {
  const directory = path.join(root, "reviews", "registered", `pr${prNumber}`);
  if (!fs.existsSync(directory)) return null;
  const candidates = listMarkdownFiles(directory, ["."]).map((filePath) => normalizeRelativePath(path.relative(root, filePath))).sort();
  return candidates[0] ?? null;
}
function isReviewMetaSubject(subject) {
  const normalized = subject.toLowerCase();
  return isProvenanceOnlyReviewMetaSubject(subject) || normalized.includes("head-still-clean") || normalized.includes("merge-ready") || normalized.includes("merge-confirm") || normalized.includes("merge-result") || normalized.includes("merged") || /\b(stale|correction|status)\b/.test(normalized);
}
function isProvenanceOnlyReviewMetaSubject(subject) {
  const normalized = subject.toLowerCase();
  return normalized.includes("status-correction") || normalized.includes("current-head") || normalized.includes("superseded") || /\balready(?:[-_\s]+(?:reviewed|merged|handled|resolved|complete|closed))\b/.test(
    normalized
  ) || /\b(?:review|rereview)?[-_\s]*request[-_\s]+already\b/.test(normalized);
}
function isFormalReviewOutcome(subject, body) {
  const normalized = subject.toLowerCase();
  if (normalized.includes("review-request") || normalized.includes("rereview-request")) {
    return false;
  }
  const severity = summarizeSeverity(body);
  const hasSeverity = severity.hasNone || severity.p1 > 0 || severity.p2 > 0 || severity.p3 > 0;
  if (!hasSeverity) return false;
  return /\breview\b|\brereview\b|head-still-clean|merge-ready|closeout/.test(
    normalized
  );
}
function isMergeTerminal(subject, body) {
  return /\b(?:merged|merge-result|merge result|merge-ack|merge-confirmed|merge-confirmation)\b|mergedat|merge commit|merge 완료/i.test(
    subject
  ) || /\b(?:merged|merge-result|merge result|merge-ack|merge-confirmed|merge-confirmation)\b|mergedAt|merge commit|merge 완료/i.test(
    body
  );
}
function summarizeSeverity(body) {
  const reviewText = stripFencedCodeBlocks(body);
  if (/P1\/P2\/P3\s*[:：]\s*none/i.test(reviewText)) {
    return { p1: 0, p2: 0, p3: 0, hasNone: true };
  }
  const labels = [...reviewText.matchAll(/^\s*P([123])\b(?!\/)/gm)].map(
    (match) => `P${match[1]}`
  );
  return {
    p1: labels.filter((label) => label === "P1").length,
    p2: labels.filter((label) => label === "P2").length,
    p3: labels.filter((label) => label === "P3").length,
    hasNone: false
  };
}
function stripFencedCodeBlocks(text) {
  return text.replace(/```[\s\S]*?```/g, "");
}
function listMarkdownFiles(root, areas) {
  return areas.flatMap((area) => listMarkdownFilesUnder(path.join(root, area)));
}
function listMarkdownFilesUnder(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) return listMarkdownFilesUnder(filePath);
    if (entry.isFile() && entry.name.endsWith(".md")) return [filePath];
    return [];
  });
}
function readIfExists(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}
function splitFrontmatter(raw) {
  if (!raw.startsWith("---\n")) return { frontmatter: {}, body: raw };
  const end = raw.indexOf("\n---", 4);
  if (end === -1) return { frontmatter: {}, body: raw };
  const frontmatter = {};
  for (const line of raw.slice(4, end).split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (match) {
      frontmatter[match[1]] = match[2].replace(/^["']|["']$/g, "").trim();
    }
  }
  return { frontmatter, body: raw.slice(end + 4) };
}
function inferSubjectFromFilename(filename) {
  return filename.match(/^\d{8}-[^-]+-[^-]+-(.+)\.md$/)?.[1] ?? null;
}
function extractPrNumber(text) {
  const match = text.match(/(?:PR\s*#|#|pr)(\d{3,5})/i);
  return match ? Number(match[1]) : null;
}
function normalizeRelativePath(relativePath) {
  return relativePath.split(path.sep).join("/");
}
var init_stale_meta = __esm({
  "src/reviews/stale-meta.ts"() {
    "use strict";
  }
});

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
var init_tap_message_prompt = __esm({
  "src/routing/tap-message-prompt.ts"() {
    "use strict";
  }
});

// packages/tap-plugin/channels/tap-display.ts
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function optionalString(value) {
  return typeof value === "string" && value.trim() ? value : null;
}
function optionalStringArray(value) {
  if (!Array.isArray(value)) return void 0;
  const aliases = value.filter((item) => typeof item === "string").map((item) => item.trim()).filter(Boolean);
  return aliases.length ? aliases : void 0;
}
function parseTapReturnAddress(serialized) {
  if (!serialized?.trim()) return null;
  try {
    const parsed = JSON.parse(serialized);
    if (!isRecord(parsed)) return null;
    return {
      routingAddress: optionalString(parsed.routingAddress),
      hostId: optionalString(parsed.hostId),
      clientId: optionalString(parsed.clientId),
      conversationId: optionalString(parsed.conversationId),
      ownerClientId: optionalString(parsed.ownerClientId),
      surfaceInstanceId: optionalString(parsed.surfaceInstanceId),
      aliases: optionalStringArray(parsed.aliases)
    };
  } catch {
    return null;
  }
}
function buildCompactInboxDisplay({
  agentName,
  sender,
  recipient,
  subject,
  filename,
  body,
  replyTo,
  fromAddress,
  runtimeSurface = "mcp-channel"
}) {
  return buildTapMessagePrompt({
    agentName,
    sender,
    recipient,
    subject,
    fileName: filename,
    body,
    replyTo,
    returnAddress: parseTapReturnAddress(fromAddress),
    runtimeSurface
  });
}
var init_tap_display = __esm({
  "packages/tap-plugin/channels/tap-display.ts"() {
    "use strict";
    init_tap_message_prompt();
  }
});

// packages/tap-plugin/channels/tap-io.ts
var tap_io_exports = {};
__export(tap_io_exports, {
  acquireLock: () => acquireLock,
  deletePresenceFile: () => deletePresenceFile,
  ensureReceiptsDir: () => ensureReceiptsDir,
  formatAgentLabel: () => formatAgentLabel,
  getDurableReceiptKeys: () => getDurableReceiptKeys,
  getJoinedAtMs: () => getJoinedAtMs,
  getUnreadItems: () => getUnreadItems,
  hasDisplayedNotification: () => hasDisplayedNotification,
  hasDurableReadReceipt: () => hasDurableReadReceipt,
  hasReadFileAtMtime: () => hasReadFileAtMtime,
  hasReadFileContent: () => hasReadFileContent,
  hashTapFileContent: () => hashTapFileContent,
  isBridgeProcessed: () => isBridgeProcessed,
  loadHeartbeats: () => loadHeartbeats,
  loadReceipts: () => loadReceipts,
  markDisplayedNotification: () => markDisplayedNotification,
  markFileRead: () => markFileRead,
  readFileContentHashes: () => readFileContentHashes,
  readFiles: () => readFiles,
  releaseLock: () => releaseLock,
  resolveAgentLabel: () => resolveAgentLabel,
  saveHeartbeats: () => saveHeartbeats,
  saveReceipts: () => saveReceipts,
  seedStartupFiles: () => seedStartupFiles,
  startupFiles: () => startupFiles,
  writePresenceFile: () => writePresenceFile
});
import {
  existsSync as existsSync4,
  mkdirSync as mkdirSync3,
  readFileSync as readFileSync4,
  readdirSync as readdirSync4,
  renameSync as renameSync3,
  statSync as statSync3,
  unlinkSync as unlinkSync2,
  writeFileSync as writeFileSync3
} from "fs";
import { createHash as createHash2 } from "crypto";
import { join as join4 } from "path";
function hashTapFileContent(content) {
  return createHash2("sha256").update(stripBom(content)).digest("hex");
}
function hasReadFileAtMtime(key, mtimeMs) {
  const lastReadMtime = readFiles.get(key);
  return lastReadMtime !== void 0 && lastReadMtime >= mtimeMs;
}
function hasReadFileContent(key, content) {
  return readFileContentHashes.get(key) === hashTapFileContent(content);
}
function markFileRead(key, mtimeMs, content) {
  readFiles.set(key, mtimeMs);
  if (content !== void 0) {
    readFileContentHashes.set(key, hashTapFileContent(content));
  }
}
function displayedNotificationKey(source, filename, content, receiver = getDisplayedNotificationReceiver()) {
  return `${receiver.key}#${getSourceKey(source, filename)}#sha256:${hashTapFileContent(content)}`;
}
function getDisplayedNotificationReceiver() {
  const routingAddress = getAgentRoutingAddress();
  const agentId = getAgentId();
  const agentName = getAgentName();
  const keyParts = [routingAddress, agentId, agentName].map((part) => part.trim()).filter(Boolean).map((part) => canonicalizeAgentId(part) || part);
  return {
    key: `receiver:${keyParts.join("|") || "unknown"}`,
    routingAddress,
    agentId,
    agentName
  };
}
function buildDisplayedNotificationIdentity(source, filename, content) {
  const receiver = getDisplayedNotificationReceiver();
  const contentHash = hashTapFileContent(content);
  return {
    key: displayedNotificationKey(source, filename, content, receiver),
    source,
    filename,
    contentHash,
    receiver
  };
}
function displayedNotificationMarkerPath(key) {
  const markerId = createHash2("sha256").update(key).digest("hex");
  return join4(DISPLAYED_NOTIFICATION_MARKERS_DIR, `${markerId}.json`);
}
function loadDisplayedNotifications() {
  return resilientReadJson(
    DISPLAYED_NOTIFICATIONS_PATH,
    {}
  );
}
function hasDisplayedNotification(source, filename, content) {
  const identity = buildDisplayedNotificationIdentity(
    source,
    filename,
    content
  );
  return existsSync4(displayedNotificationMarkerPath(identity.key)) || Boolean(loadDisplayedNotifications()[identity.key]);
}
function markDisplayedNotification(source, filename, content) {
  const identity = buildDisplayedNotificationIdentity(
    source,
    filename,
    content
  );
  const markerPath = displayedNotificationMarkerPath(identity.key);
  const marker = {
    displayedAt: (/* @__PURE__ */ new Date()).toISOString(),
    source: identity.source,
    filename: identity.filename,
    contentHash: identity.contentHash,
    receiver: {
      routingAddress: identity.receiver.routingAddress,
      agentId: identity.receiver.agentId,
      agentName: identity.receiver.agentName
    }
  };
  mkdirSync3(DISPLAYED_NOTIFICATION_MARKERS_DIR, { recursive: true });
  const tmpPath = `${markerPath}.tmp.${process.pid}`;
  writeFileSync3(tmpPath, JSON.stringify(marker, null, 2), "utf-8");
  resilientRename(tmpPath, markerPath);
}
function getBridgeProcessedDirs() {
  if (!REPO_ROOT) {
    _bridgeProcessedDirs = [];
    _bridgeTmpDirMtimeMs = 0;
    return _bridgeProcessedDirs;
  }
  const tmpDir = join4(REPO_ROOT, ".tmp");
  if (!existsSync4(tmpDir)) {
    _bridgeProcessedDirs = [];
    _bridgeTmpDirMtimeMs = 0;
    return _bridgeProcessedDirs;
  }
  const now = Date.now();
  let tmpDirMtimeMs = 0;
  try {
    tmpDirMtimeMs = statSync3(tmpDir).mtimeMs;
  } catch {
    _bridgeProcessedDirs = [];
    _bridgeTmpDirMtimeMs = 0;
    return _bridgeProcessedDirs;
  }
  if (now - _bridgeDirsCachedAt < BRIDGE_DIR_CACHE_TTL_MS && tmpDirMtimeMs === _bridgeTmpDirMtimeMs) {
    return _bridgeProcessedDirs;
  }
  _bridgeDirsCachedAt = now;
  _bridgeTmpDirMtimeMs = tmpDirMtimeMs;
  try {
    _bridgeProcessedDirs = readdirSync4(tmpDir).filter((d) => d.startsWith("codex-app-server-bridge")).map((d) => join4(tmpDir, d, "processed")).filter((p) => existsSync4(p));
  } catch {
    _bridgeProcessedDirs = [];
  }
  return _bridgeProcessedDirs;
}
function isBridgeProcessed(filePath, mtimeMs) {
  const dirs = getBridgeProcessedDirs();
  if (dirs.length === 0) return false;
  const markerId = createHash2("sha1").update(`${filePath}|${mtimeMs}`).digest("hex");
  const markerFile = `${markerId}.done`;
  return dirs.some((dir) => existsSync4(join4(dir, markerFile)));
}
function isEbusyError(error) {
  if (!error || typeof error !== "object" || !("code" in error)) return false;
  const code = error.code;
  return code === "EBUSY" || code === "EPERM" || code === "EACCES";
}
function busySpin(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
  }
}
function resilientRename(tmpPath, targetPath) {
  for (let attempt = 0; attempt < EBUSY_MAX_RETRIES; attempt++) {
    try {
      renameSync3(tmpPath, targetPath);
      return;
    } catch (error) {
      if (!isEbusyError(error) || attempt === EBUSY_MAX_RETRIES - 1)
        throw error;
      busySpin(EBUSY_BASE_DELAY_MS * (attempt + 1));
    }
  }
}
function resilientReadJson(filePath, fallback) {
  for (let attempt = 0; attempt < EBUSY_MAX_RETRIES; attempt++) {
    try {
      return JSON.parse(readFileSync4(filePath, "utf-8"));
    } catch (error) {
      if (!isEbusyError(error) || attempt === EBUSY_MAX_RETRIES - 1) {
        return fallback;
      }
      busySpin(EBUSY_BASE_DELAY_MS * (attempt + 1));
    }
  }
  return fallback;
}
function acquireLock(lockPath, retries = 3, delayMs = 100) {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      writeFileSync3(lockPath, String(process.pid), { flag: "wx" });
      return true;
    } catch {
      try {
        const age = Date.now() - statSync3(lockPath).mtimeMs;
        if (age > 1e4) {
          unlinkSync2(lockPath);
          continue;
        }
      } catch {
      }
      if (attempt < retries - 1) {
        const start = Date.now();
        while (Date.now() - start < delayMs) {
        }
      }
    }
  }
  return false;
}
function releaseLock(lockPath) {
  try {
    unlinkSync2(lockPath);
  } catch {
  }
}
function ensureReceiptsDir() {
  if (!existsSync4(RECEIPTS_DIR)) mkdirSync3(RECEIPTS_DIR, { recursive: true });
}
function loadReceipts() {
  return resilientReadJson(RECEIPTS_PATH, {});
}
function saveReceipts(store) {
  ensureReceiptsDir();
  const tmpPath = `${RECEIPTS_PATH}.tmp.${process.pid}`;
  writeFileSync3(tmpPath, JSON.stringify(store, null, 2), "utf-8");
  resilientRename(tmpPath, RECEIPTS_PATH);
}
function matchesReceiptReader(reader, agentId, agentName) {
  const normalizedReader = reader.trim();
  if (!normalizedReader) return false;
  return normalizedReader === agentId || sameRoutingAddress(normalizedReader, agentId) || normalizedReader === agentName || sameRoutingAddress(normalizedReader, agentName);
}
function getDurableReceiptKeys(filename, content) {
  const normalizedContent = stripBom(content);
  const frontmatter = parseFrontmatter(normalizedContent);
  const keys = [];
  if (frontmatter?.message_id?.trim()) {
    keys.push(`${filename}#mid:${frontmatter.message_id.trim()}`);
  }
  keys.push(`${filename}#sha256:${hashTapFileContent(normalizedContent)}`);
  return keys;
}
function getLatestReceiptTimestampMs(receipts) {
  let latest = 0;
  for (const receipt of receipts ?? []) {
    const timestampMs = new Date(receipt.timestamp).getTime();
    if (Number.isFinite(timestampMs) && timestampMs > latest) {
      latest = timestampMs;
    }
  }
  return latest;
}
function hasDurableReadReceipt(filename, options) {
  const agentId = options?.agentId ?? getAgentId();
  const agentName = options?.agentName ?? getAgentName();
  const receiptStore = options?.receiptStore ?? loadReceipts();
  const content = options?.content;
  const durableKeys = typeof content === "string" ? getDurableReceiptKeys(filename, content) : [];
  for (const key of durableKeys) {
    const receipts = receiptStore[key];
    if (!receipts?.length) continue;
    if (receipts.some(
      (receipt) => matchesReceiptReader(receipt.reader, agentId, agentName)
    )) {
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
  return legacyReceipts.some(
    (receipt) => matchesReceiptReader(receipt.reader, agentId, agentName)
  );
}
function entryTimestampMs(entry) {
  return entry?.timestamp ? new Date(entry.timestamp).getTime() : 0;
}
function mergeHeartbeatSlot(store, canonicalKey, entry) {
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
function loadHeartbeats() {
  const raw = resilientReadJson(HEARTBEATS_PATH, {});
  const local = {};
  for (const [rawKey, entry] of Object.entries(raw)) {
    if (!entry || !entry.id && !entry.agent) continue;
    const key = canonicalizeAgentId(rawKey);
    mergeHeartbeatSlot(local, key, entry);
  }
  try {
    if (existsSync4(PRESENCE_DIR)) {
      const now = Date.now();
      for (const file of readdirSync4(PRESENCE_DIR)) {
        if (!file.endsWith(".json")) continue;
        try {
          const filePath = join4(PRESENCE_DIR, file);
          const rawFile = readFileSync4(filePath, "utf-8");
          const entry = JSON.parse(rawFile);
          if (!entry?.id && !entry?.agent) continue;
          const ts = entry.timestamp ? new Date(entry.timestamp).getTime() : 0;
          if (now - ts > PRESENCE_MAX_AGE_MS) continue;
          const rawKey = entry.id ?? file.replace(/\.json$/, "");
          const key = canonicalizeAgentId(rawKey);
          mergeHeartbeatSlot(local, key, entry);
        } catch {
        }
      }
    }
  } catch {
  }
  return local;
}
function saveHeartbeats(store) {
  const tmpPath = `${HEARTBEATS_PATH}.tmp.${process.pid}`;
  writeFileSync3(tmpPath, JSON.stringify(store, null, 2), "utf-8");
  resilientRename(tmpPath, HEARTBEATS_PATH);
}
function getJoinedAtMs(options) {
  const agentId = options?.agentId ?? getAgentId();
  const agentName = options?.agentName ?? getAgentName();
  const heartbeatStore = options?.heartbeatStore ?? loadHeartbeats();
  if (agentId === "unknown") return 0;
  const canonicalAgentId = canonicalizeAgentId(agentId);
  const canonicalAgentName = canonicalizeAgentId(agentName);
  const entry = heartbeatStore[canonicalAgentId] ?? heartbeatStore[agentId] ?? heartbeatStore[canonicalAgentName] ?? heartbeatStore[agentName];
  if (!entry?.joinedAt) return 0;
  const joinedAtMs = new Date(entry.joinedAt).getTime();
  return Number.isFinite(joinedAtMs) ? joinedAtMs : 0;
}
function writePresenceFile(agentId, entry) {
  try {
    mkdirSync3(PRESENCE_DIR, { recursive: true });
    const canonicalId = canonicalizeAgentId(agentId);
    const filename = canonicalId || agentId.replace(/[/\\:]/g, "_");
    const sanitizedId = filename.replace(/[/\\:]/g, "_");
    const filePath = join4(PRESENCE_DIR, `${sanitizedId}.json`);
    const tmpPath = `${filePath}.tmp.${process.pid}`;
    writeFileSync3(tmpPath, JSON.stringify(entry, null, 2), "utf-8");
    resilientRename(tmpPath, filePath);
  } catch {
  }
}
function deletePresenceFile(agentId) {
  try {
    const canonicalId = canonicalizeAgentId(agentId);
    const filename = canonicalId || agentId.replace(/[/\\:]/g, "_");
    const sanitizedId = filename.replace(/[/\\:]/g, "_");
    const filePath = join4(PRESENCE_DIR, `${sanitizedId}.json`);
    if (existsSync4(filePath)) {
      unlinkSync2(filePath);
    }
  } catch {
  }
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
function resolveAgentLabel(agentIdOrName, store = loadHeartbeats()) {
  const normalized = agentIdOrName.trim();
  if (!normalized || normalized === "\uC804\uCCB4" || normalized === "all") {
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
function seedStartupFiles(source) {
  const dir = getSourceDir(source);
  if (!dir || !existsSync4(dir)) return;
  for (const filename of readdirSync4(dir)) {
    startupFiles.add(getSourceKey(source, filename));
  }
}
function getUnreadItems(options) {
  const sources = normalizeSources(options?.sources);
  const includeContent = options?.includeContent !== false;
  const markRead = options?.markRead !== false;
  const sinceMs = typeof options?.since === "string" ? new Date(options.since).getTime() : 0;
  const agentId = getAgentId();
  const agentName = getAgentName();
  let heartbeatStore = {};
  let receiptStore = {};
  if (agentId !== "unknown") {
    try {
      heartbeatStore = loadHeartbeats();
    } catch {
    }
  }
  try {
    receiptStore = loadReceipts();
  } catch {
  }
  const joinedAtMs = getJoinedAtMs({
    heartbeatStore,
    agentId,
    agentName
  });
  const effectiveSinceMs = Math.max(sinceMs, joinedAtMs);
  const parsedLimit = typeof options?.limit === "number" ? options.limit : Number.parseInt(String(options?.limit ?? "20"), 10);
  const limit = Number.isFinite(parsedLimit) ? Math.max(1, Math.min(100, parsedLimit)) : 20;
  const items = [];
  for (const source of sources) {
    const dir = getSourceDir(source);
    if (!dir || !existsSync4(dir)) continue;
    const filenames = readdirSync4(dir).filter((filename) => filename.endsWith(".md")).sort();
    for (const filename of filenames) {
      const key = getSourceKey(source, filename);
      const fullPath = join4(dir, filename);
      let mtime;
      try {
        mtime = statSync3(fullPath).mtimeMs;
      } catch {
        continue;
      }
      if (hasReadFileAtMtime(key, mtime)) continue;
      if (effectiveSinceMs && mtime < effectiveSinceMs) continue;
      if (isBridgeProcessed(fullPath, mtime)) {
        continue;
      }
      let content;
      try {
        content = stripBom(readFileSync4(fullPath, "utf-8"));
      } catch {
        continue;
      }
      const rawContent = content;
      if (hasReadFileContent(key, rawContent)) {
        markFileRead(key, mtime, rawContent);
        continue;
      }
      if (hasDurableReadReceipt(filename, {
        receiptStore,
        agentId,
        agentName,
        content,
        fileMtimeMs: mtime
      })) {
        continue;
      }
      let from = source;
      let to = "all";
      let subject = filename.replace(/\.md$/, "");
      let inboxFrontmatter = null;
      let rawFrom = source;
      if (source === "inbox") {
        inboxFrontmatter = parseFrontmatter(content);
        const parsed = inboxFrontmatter ? {
          from: inboxFrontmatter.from,
          to: inboxFrontmatter.to,
          subject: inboxFrontmatter.subject
        } : parseFilename(filename);
        if (!parsed || (inboxFrontmatter ? !isInboxFrontmatterForCurrentAgent(inboxFrontmatter) : !isForMe(parsed.to))) {
          continue;
        }
        if (isOwnMessageAddressForCurrentAgent(parsed.from)) continue;
        const reviewMeta = classifyReviewMetaForOperator({
          root: COMMS_DIR,
          filename,
          subject: parsed.subject,
          body: inboxFrontmatter ? stripFrontmatter(rawContent) : rawContent,
          sourceRelativePath: `inbox/${filename}`
        });
        if (reviewMeta.status === "collapsed-stale-meta") {
          markFileRead(key, mtime, rawContent);
          continue;
        }
        rawFrom = parsed.from;
        from = resolveAgentLabel(
          inboxFrontmatter?.from_name ?? parsed.from,
          heartbeatStore
        );
        to = resolveAgentLabel(
          inboxFrontmatter?.to_name ?? parsed.to,
          heartbeatStore
        );
        subject = parsed.subject;
        if (inboxFrontmatter && includeContent) {
          content = stripFrontmatter(content);
        }
      }
      const item = {
        source,
        filename,
        path: `${source}/${filename}`,
        from,
        to,
        subject,
        mtime: new Date(mtime).toISOString()
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
            fromAddress: inboxFrontmatter?.from_address
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
var startupFiles, readFiles, readFileContentHashes, DISPLAYED_NOTIFICATIONS_DIR, DISPLAYED_NOTIFICATIONS_PATH, DISPLAYED_NOTIFICATION_MARKERS_DIR, REPO_ROOT, BRIDGE_DIR_CACHE_TTL_MS, _bridgeProcessedDirs, _bridgeDirsCachedAt, _bridgeTmpDirMtimeMs, EBUSY_MAX_RETRIES, EBUSY_BASE_DELAY_MS, PRESENCE_MAX_AGE_MS;
var init_tap_io = __esm({
  "packages/tap-plugin/channels/tap-io.ts"() {
    "use strict";
    init_stale_meta();
    init_tap_utils();
    init_tap_identity();
    init_tap_display();
    startupFiles = /* @__PURE__ */ new Set();
    readFiles = /* @__PURE__ */ new Map();
    readFileContentHashes = /* @__PURE__ */ new Map();
    DISPLAYED_NOTIFICATIONS_DIR = join4(COMMS_DIR, "displayed-notifications");
    DISPLAYED_NOTIFICATIONS_PATH = join4(
      DISPLAYED_NOTIFICATIONS_DIR,
      "displayed.json"
    );
    DISPLAYED_NOTIFICATION_MARKERS_DIR = join4(
      DISPLAYED_NOTIFICATIONS_DIR,
      "markers"
    );
    REPO_ROOT = process.env.TAP_REPO_ROOT ?? null;
    BRIDGE_DIR_CACHE_TTL_MS = 3e4;
    _bridgeProcessedDirs = [];
    _bridgeDirsCachedAt = 0;
    _bridgeTmpDirMtimeMs = 0;
    EBUSY_MAX_RETRIES = 4;
    EBUSY_BASE_DELAY_MS = 25;
    PRESENCE_MAX_AGE_MS = 24 * 60 * 60 * 1e3;
  }
});

// packages/tap-plugin/channels/tap-comms.ts
init_tap_identity();
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema
} from "@modelcontextprotocol/sdk/types.js";
import { randomUUID as randomUUID8 } from "crypto";
import { existsSync as existsSync13, mkdirSync as mkdirSync10, readFileSync as readFileSync12, writeFileSync as writeFileSync10 } from "fs";
import { basename as basename6, join as join16 } from "path";

// packages/tap-plugin/channels/tap-capability-snapshot.ts
init_tap_utils();
init_receive_transports();
function hasValue(value) {
  return Boolean(value?.trim());
}
function parseCapabilityRegistrationArgs(rawArgs, options = {}) {
  let explicitReceiveTransports = null;
  if (typeof rawArgs.receiveTransports !== "undefined") {
    if (!Array.isArray(rawArgs.receiveTransports) || rawArgs.receiveTransports.some(
      (value) => value !== "mcp-channel" && value !== "consent-drive" && value !== "polling"
    )) {
      return {
        ok: false,
        errorText: 'Rejected: "receiveTransports" must be an array containing only "mcp-channel", "consent-drive", and/or "polling".'
      };
    }
    explicitReceiveTransports = normalizeReceiveTransports(
      rawArgs.receiveTransports
    );
    if (explicitReceiveTransports.length === 0) {
      return {
        ok: false,
        errorText: 'Rejected: "receiveTransports" override must include at least one supported transport.'
      };
    }
  }
  let explicitConversationId = void 0;
  if (typeof rawArgs.conversationId !== "undefined") {
    if (!options.allowConversationId) {
      return {
        ok: false,
        errorText: 'Rejected: "conversationId" is not accepted here. Use tap_register_capabilities instead.'
      };
    }
    if (typeof rawArgs.conversationId !== "string") {
      return {
        ok: false,
        errorText: 'Rejected: "conversationId" must be a string when provided.'
      };
    }
    explicitConversationId = rawArgs.conversationId.trim() || null;
  }
  let explicitOwnerClientId = void 0;
  if (typeof rawArgs.ownerClientId !== "undefined") {
    if (!options.allowConversationId) {
      return {
        ok: false,
        errorText: 'Rejected: "ownerClientId" is not accepted here. Use tap_register_capabilities instead.'
      };
    }
    if (typeof rawArgs.ownerClientId !== "string") {
      return {
        ok: false,
        errorText: 'Rejected: "ownerClientId" must be a string when provided.'
      };
    }
    explicitOwnerClientId = rawArgs.ownerClientId.trim() || null;
  }
  if (options.requireAtLeastOne && explicitReceiveTransports == null && typeof explicitConversationId === "undefined" && typeof explicitOwnerClientId === "undefined") {
    return {
      ok: false,
      errorText: 'Rejected: tap_register_capabilities requires at least one of "receiveTransports", "conversationId", or "ownerClientId".'
    };
  }
  return {
    ok: true,
    explicitReceiveTransports,
    explicitConversationId,
    explicitOwnerClientId
  };
}
function buildHeartbeatRecord(options) {
  const resolvedInstanceId = resolveCurrentInstanceId() ?? options.existing?.instanceId ?? null;
  const connectHash = buildHeartbeatConnectHash(
    resolvedInstanceId,
    options.agentId
  );
  const preserveBridgeSource = options.existing?.source === "bridge-dispatch" && options.existing.connectHash === connectHash;
  const identitySnapshot = getAgentIdentitySnapshot();
  const inferredReceiveTransports = getAgentReceiveTransports();
  const existingTransports = normalizeReceiveTransports(
    options.existing?.receiveTransports ?? options.existing?.capabilities?.receiveTransports
  );
  const existingConversationId = options.existing?.address?.conversationId ?? options.existing?.capabilities?.conversationId ?? null;
  const existingOwnerClientId = options.existing?.address?.ownerClientId ?? options.existing?.capabilities?.ownerClientId ?? null;
  const existingConsentDriveTupleIsComplete = !options.resetCapabilities && existingTransports.includes("consent-drive") && hasValue(existingConversationId) && hasValue(existingOwnerClientId);
  const shouldPreserveExistingTransports = !options.resetCapabilities && (options.existing?.capabilities?.receiveTransportsSource === "explicit" || existingConsentDriveTupleIsComplete);
  const existingReceiveTransports = shouldPreserveExistingTransports && existingTransports.length > 0 ? existingTransports : void 0;
  const receiveTransports = options.explicitReceiveTransports ?? existingReceiveTransports ?? inferredReceiveTransports;
  const receiveTransportsSource = options.explicitReceiveTransports != null ? "explicit" : existingReceiveTransports != null ? options.existing?.capabilities?.receiveTransportsSource ?? "heuristic" : "heuristic";
  const identityAddress = options.resetCapabilities ? {
    ...identitySnapshot.address,
    conversationId: null,
    ownerClientId: null
  } : identitySnapshot.address;
  const existingAddress = !options.resetCapabilities && options.existing ? {
    ...options.existing.address ?? identityAddress,
    conversationId: existingConsentDriveTupleIsComplete ? existingConversationId : options.existing.address?.conversationId ?? null,
    ownerClientId: existingConsentDriveTupleIsComplete ? existingOwnerClientId : options.existing.address?.ownerClientId ?? null
  } : void 0;
  const baseAddress = !options.resetCapabilities && existingAddress ? existingAddress : identityAddress;
  const hasExplicitConversationId = typeof options.explicitConversationId !== "undefined";
  const hasExplicitOwnerClientId = typeof options.explicitOwnerClientId !== "undefined";
  const address = !hasExplicitConversationId && !hasExplicitOwnerClientId ? baseAddress : {
    ...baseAddress,
    conversationId: hasExplicitConversationId ? options.explicitConversationId ?? null : baseAddress.conversationId ?? null,
    ownerClientId: hasExplicitOwnerClientId ? options.explicitOwnerClientId ?? null : baseAddress.ownerClientId ?? null
  };
  const capabilitySnapshot = {
    receiveTransports,
    receiveTransportsSource,
    conversationId: address.conversationId ?? null,
    ownerClientId: address.ownerClientId ?? null
  };
  return {
    heartbeat: {
      id: options.agentId,
      agent: options.agentName,
      timestamp: options.timestamp,
      lastActivity: options.lastActivity,
      joinedAt: options.joinedAt ?? options.existing?.joinedAt,
      status: options.status,
      source: preserveBridgeSource ? "bridge-dispatch" : "mcp-direct",
      instanceId: resolvedInstanceId,
      bridgePid: preserveBridgeSource ? options.existing?.bridgePid ?? null : null,
      connectHash,
      address,
      receiveTransports: capabilitySnapshot.receiveTransports,
      capabilities: capabilitySnapshot
    },
    capabilitySnapshot,
    preserveBridgeSource,
    resolvedInstanceId,
    connectHash
  };
}

// packages/tap-plugin/channels/handlers/capabilities.ts
init_tap_utils();
init_tap_io();

// packages/tap-plugin/channels/tap-route-lease.ts
init_tap_utils();
init_tap_identity();
import { mkdirSync as mkdirSync4, renameSync as renameSync4, writeFileSync as writeFileSync4 } from "fs";
import { join as join5 } from "path";
var DEFAULT_ROUTE_LEASE_TTL_HOURS = 24;
function routeLeasePath(agentId) {
  const canonicalId = canonicalizeAgentId(agentId);
  const filename = (canonicalId || agentId).replace(/[/\\:]/g, "_");
  return join5(ROUTE_LEASES_DIR, `${filename}.json`);
}
function shouldWriteRouteLease(entry) {
  if (entry.status === "signing-off") return false;
  const receiveTransports = entry.capabilities?.receiveTransports ?? entry.receiveTransports ?? [];
  const hasLiveTransport = receiveTransports.includes("consent-drive") || receiveTransports.includes("mcp-channel");
  const hasRouteTuple = Boolean(
    entry.address?.hostId && (entry.address?.conversationId || entry.capabilities?.conversationId || entry.address?.ownerClientId || entry.capabilities?.ownerClientId)
  );
  return hasLiveTransport || hasRouteTuple;
}
function buildRouteLease(agentId, entry, source, now = /* @__PURE__ */ new Date()) {
  if (!shouldWriteRouteLease(entry)) return null;
  const registeredAt = entry.joinedAt ?? entry.timestamp ?? now.toISOString();
  const updatedAt = now.toISOString();
  const receiveTransports = entry.capabilities?.receiveTransports ?? entry.receiveTransports ?? [];
  const route = {
    hostId: entry.address?.hostId ?? null,
    clientId: entry.address?.clientId ?? null,
    conversationId: entry.address?.conversationId ?? entry.capabilities?.conversationId ?? null,
    ownerClientId: entry.address?.ownerClientId ?? entry.capabilities?.ownerClientId ?? null,
    routingAddress: entry.address?.routingAddress ?? entry.agent,
    slot: entry.address?.slot ?? null,
    aliases: entry.address?.aliases ?? [entry.agent]
  };
  return {
    schemaVersion: 1,
    agentId,
    agent: entry.agent,
    source,
    registeredAt,
    updatedAt,
    expiresAt: new Date(
      now.getTime() + DEFAULT_ROUTE_LEASE_TTL_HOURS * 60 * 60 * 1e3
    ).toISOString(),
    status: entry.status,
    receiveTransports,
    route,
    capability: {
      conversationId: entry.capabilities?.conversationId ?? null,
      ownerClientId: entry.capabilities?.ownerClientId ?? null
    },
    liveAuthority: false,
    liveAuthorityNote: "Route lease preserves stable registration only; live delivery must still re-check current runtime health and presence freshness."
  };
}
function writeRouteLeaseFile(agentId, entry, source) {
  const lease = buildRouteLease(agentId, entry, source);
  if (!lease) return null;
  try {
    mkdirSync4(ROUTE_LEASES_DIR, { recursive: true });
    const filePath = routeLeasePath(lease.agent);
    const tmpPath = `${filePath}.tmp.${process.pid}`;
    writeFileSync4(tmpPath, JSON.stringify(lease, null, 2), "utf-8");
    renameSync4(tmpPath, filePath);
  } catch {
    return null;
  }
  return lease;
}

// src/transport/experimental/codex-ipc-observe.ts
import * as net from "net";
import { randomUUID as randomUUID3 } from "crypto";

// src/transport/experimental/codex-ipc-endpoint.ts
import { tmpdir } from "os";
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
      options.tmpDir?.trim() || env.TMPDIR?.trim() || tmpdir()
    );
    const uid = typeof options.uid === "number" && Number.isFinite(options.uid) ? options.uid : typeof process.getuid === "function" ? process.getuid() : null;
    if (uid == null) {
      throw new Error("Cannot resolve macOS Codex IPC socket without a uid.");
    }
    return `${baseTmp}/codex-ipc/ipc-${uid}.sock`;
  }
  return DEFAULT_CODEX_IPC_WINDOWS_PIPE_PATH;
}
function isCodexIpcDefaultSupported(platform = process.platform) {
  return platform === "win32" || platform === "darwin";
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
function resolveHostId2(explicitHostId) {
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
    this.hostId = resolveHostId2(options.hostId);
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
    await new Promise((resolve8, reject) => {
      const cleanup = () => {
        clearTimeout(timeout);
        socket.removeListener("connect", onConnect);
        socket.removeListener("error", onError);
      };
      const onConnect = () => {
        cleanup();
        resolve8();
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
    const promise = new Promise((resolve8, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(
          new Error(
            `Codex IPC request "${method}" timed out after ${this.requestTimeoutMs}ms`
          )
        );
      }, this.requestTimeoutMs);
      this.pendingRequests.set(requestId, { resolve: resolve8, reject, timeout });
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
function createExperimentalCodexIpcObserveTransport(options = {}) {
  return new ExperimentalCodexIpcObserveTransport(options);
}

// src/routing/codex-owner-discovery.ts
var DEFAULT_DISCOVERY_TIMEOUT_MS = 3e3;
function normalizeString2(value) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}
function resolveTimeoutMs(explicitTimeoutMs) {
  if (typeof explicitTimeoutMs === "number" && explicitTimeoutMs > 0) {
    return explicitTimeoutMs;
  }
  const envValue = Number(process.env.TAP_CODEX_OWNER_DISCOVERY_TIMEOUT_MS);
  if (Number.isFinite(envValue) && envValue > 0) {
    return envValue;
  }
  return DEFAULT_DISCOVERY_TIMEOUT_MS;
}
function isDiscoverySupported() {
  const override = process.env.TAP_CODEX_OWNER_DISCOVERY?.trim().toLowerCase();
  if (override === "1" || override === "true" || override === "yes") {
    return true;
  }
  if (override === "0" || override === "false" || override === "no") {
    return false;
  }
  return isCodexIpcDefaultSupported();
}
function findOwnerInSnapshot(snapshot, conversationId) {
  if (!snapshot.connected) return null;
  const conversation = snapshot.conversations.find(
    (candidate) => candidate.id === conversationId
  );
  const ownerClientId = normalizeString2(conversation?.address.ownerClientId);
  if (!ownerClientId) return null;
  return {
    ownerClientId,
    hostId: normalizeString2(conversation?.address.hostId)
  };
}
async function waitForOwner(options) {
  return await new Promise((resolve8) => {
    const unsubscribe = options.transport.subscribe((event) => {
      const found = findOwnerInSnapshot(event.snapshot, options.conversationId);
      if (!found) return;
      cleanup();
      resolve8({
        status: "found",
        conversationId: options.conversationId,
        ownerClientId: found.ownerClientId,
        hostId: found.hostId,
        source: "event"
      });
    });
    const timeout = setTimeout(() => {
      cleanup();
      resolve8(null);
    }, options.timeoutMs);
    function cleanup() {
      clearTimeout(timeout);
      unsubscribe();
    }
  });
}
async function discoverCodexOwnerClientId(options) {
  const conversationId = normalizeString2(options.conversationId);
  if (!conversationId) {
    return {
      status: "unavailable",
      conversationId: "",
      message: "conversationId is required for Codex owner discovery."
    };
  }
  if (!isDiscoverySupported() && !options.transport && !options.transportFactory) {
    return {
      status: "unavailable",
      conversationId,
      message: "Codex owner discovery is only enabled on Windows/macOS IPC hosts by default."
    };
  }
  const timeoutMs = resolveTimeoutMs(options.timeoutMs);
  const transport = options.transport ?? options.transportFactory?.({
    hostId: options.hostId,
    requestTimeoutMs: timeoutMs
  }) ?? createExperimentalCodexIpcObserveTransport({
    hostId: options.hostId,
    requestTimeoutMs: timeoutMs
  });
  const ownsTransport = !options.transport;
  try {
    const snapshot = await transport.connect();
    const found = findOwnerInSnapshot(snapshot, conversationId);
    if (found) {
      return {
        status: "found",
        conversationId,
        ownerClientId: found.ownerClientId,
        hostId: found.hostId,
        source: "snapshot"
      };
    }
    const eventFound = await waitForOwner({
      transport,
      conversationId,
      timeoutMs
    });
    if (eventFound) return eventFound;
    return {
      status: "not-found",
      conversationId,
      message: `No live Codex ownerClientId observed for conversationId ${conversationId}.`
    };
  } catch (error) {
    return {
      status: "unavailable",
      conversationId,
      message: error instanceof Error ? error.message : String(error ?? "Codex owner discovery failed.")
    };
  } finally {
    if (ownsTransport) {
      await transport.disconnect().catch(() => void 0);
    }
  }
}

// packages/tap-plugin/channels/handlers/capabilities.ts
function formatOwnerDiscoveryNote(result) {
  if (!result) return "";
  if (result.status === "found") {
    return ` ownerDiscovery=found(${result.ownerClientId}).`;
  }
  return ` ownerDiscovery=${result.status}(${result.message}).`;
}
async function handleRegisterCapabilities(rawArgs, heartbeatsLockPath, options = {}) {
  const agentId = getAgentId();
  const agentName = getAgentName();
  if (agentId === "unknown" || agentName === "unknown") {
    return {
      content: [
        {
          type: "text",
          text: "Rejected: tap_register_capabilities requires a confirmed agent identity. Call tap_set_name first."
        }
      ]
    };
  }
  const parsedCapabilities = parseCapabilityRegistrationArgs(rawArgs, {
    allowConversationId: true,
    requireAtLeastOne: true
  });
  if (!parsedCapabilities.ok) {
    return {
      content: [{ type: "text", text: parsedCapabilities.errorText }]
    };
  }
  const {
    explicitReceiveTransports,
    explicitConversationId,
    explicitOwnerClientId
  } = parsedCapabilities;
  let resolvedOwnerClientId = explicitOwnerClientId;
  let ownerDiscoveryResult = null;
  if (typeof explicitConversationId === "string" && explicitConversationId && typeof explicitOwnerClientId === "undefined") {
    ownerDiscoveryResult = await (options.discoverOwnerClientId ?? discoverCodexOwnerClientId)({
      conversationId: explicitConversationId,
      hostId: getAgentIdentitySnapshot().address.hostId
    });
    resolvedOwnerClientId = ownerDiscoveryResult.status === "found" ? ownerDiscoveryResult.ownerClientId : null;
  }
  if (!acquireLock(heartbeatsLockPath)) {
    return {
      content: [{ type: "text", text: "Heartbeat store busy, try again." }]
    };
  }
  try {
    const store2 = loadHeartbeats();
    const existing = store2[agentId];
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const heartbeatRecord = buildHeartbeatRecord({
      agentId,
      agentName,
      status: existing?.status ?? "active",
      existing,
      timestamp: now,
      lastActivity: getLastActivityTime(),
      joinedAt: existing?.joinedAt ?? now,
      explicitReceiveTransports,
      explicitConversationId,
      explicitOwnerClientId: resolvedOwnerClientId
    });
    store2[agentId] = {
      ...existing,
      ...heartbeatRecord.heartbeat
    };
    saveHeartbeats(store2);
    writePresenceFile(agentId, store2[agentId]);
    writeRouteLeaseFile(agentId, store2[agentId], "tap_register_capabilities");
  } finally {
    releaseLock(heartbeatsLockPath);
  }
  const store = loadHeartbeats();
  const updated = store[agentId];
  return {
    content: [
      {
        type: "text",
        text: `Capabilities registered for ${agentName}. receiveTransports=${(updated?.capabilities?.receiveTransports ?? updated?.receiveTransports ?? []).join(", ") || "unchanged"}; conversationId=${updated?.capabilities?.conversationId ?? updated?.address?.conversationId ?? "null"}; ownerClientId=${updated?.capabilities?.ownerClientId ?? updated?.address?.ownerClientId ?? "null"}.` + formatOwnerDiscoveryNote(ownerDiscoveryResult)
      }
    ]
  };
}

// packages/tap-plugin/channels/tap-peer-dm-rate-limit.ts
init_tap_identity();
var PEER_DM_WINDOW_MS = 5 * 60 * 1e3;
var PEER_DM_MAX_MESSAGES = 20;
function normalizeAddress(value) {
  return value?.trim() ?? "";
}
function matchesTowerAddress(value, towerName, towerId) {
  const normalizedValue = normalizeAddress(value);
  const normalizedTower = normalizeAddress(towerName);
  const normalizedTowerId = normalizeAddress(towerId);
  if (!normalizedValue) return false;
  return !!normalizedTower && (normalizedValue === normalizedTower || sameRoutingAddress(normalizedValue, normalizedTower)) || !!normalizedTowerId && (normalizedValue === normalizedTowerId || sameRoutingAddress(normalizedValue, normalizedTowerId));
}
function resolveTargetAddress(route) {
  const candidate = normalizeAddress(route.resolvedTo) || normalizeAddress(route.to);
  return isBroadcastRecipient(candidate) ? "broadcast" : canonicalizeAgentId(candidate);
}
function isPeerDmRateLimitExempt(route) {
  if (isBroadcastRecipient(normalizeAddress(route.to)) || isBroadcastRecipient(normalizeAddress(route.resolvedTo))) {
    return true;
  }
  const towerName = normalizeAddress(route.towerName);
  const towerId = normalizeAddress(route.towerId);
  if (!towerName && !towerId) return false;
  return matchesTowerAddress(route.fromId, towerName, towerId) || matchesTowerAddress(route.fromName, towerName, towerId) || matchesTowerAddress(route.to, towerName, towerId) || matchesTowerAddress(route.resolvedTo, towerName, towerId);
}
function pruneHistory(entries, nowMs, windowMs) {
  if (!entries?.length) return [];
  return entries.filter((timestamp) => nowMs - timestamp <= windowMs);
}
function getPeerDmRateLimitKey(route) {
  if (isPeerDmRateLimitExempt(route)) {
    return null;
  }
  const from = canonicalizeAgentId(normalizeAddress(route.fromId));
  const to = resolveTargetAddress(route);
  if (!from || !to || to === "broadcast") {
    return null;
  }
  return `${from}->${to}`;
}
function checkPeerDmRateLimit(store, route, nowMs = Date.now(), maxMessages = PEER_DM_MAX_MESSAGES, windowMs = PEER_DM_WINDOW_MS) {
  const key = getPeerDmRateLimitKey(route);
  const target = resolveTargetAddress(route);
  if (!key) {
    return {
      allowed: true,
      exempt: true,
      key: null,
      target,
      recentCount: 0
    };
  }
  const recent = pruneHistory(store.get(key), nowMs, windowMs);
  return {
    allowed: recent.length < maxMessages,
    exempt: false,
    key,
    target,
    recentCount: recent.length
  };
}
function recordPeerDm(store, route, nowMs = Date.now(), windowMs = PEER_DM_WINDOW_MS) {
  const key = getPeerDmRateLimitKey(route);
  if (!key) return;
  const recent = pruneHistory(store.get(key), nowMs, windowMs);
  recent.push(nowMs);
  store.set(key, recent);
}

// packages/tap-plugin/channels/tap-comms.ts
init_tap_utils();
init_tap_claims();
init_tap_io();

// packages/tap-plugin/channels/tap-db.ts
init_tap_utils();
import { existsSync as existsSync5, readFileSync as readFileSync5, readdirSync as readdirSync5, statSync as statSync4 } from "fs";
import { join as join6 } from "path";
var db = null;
function initDb() {
  try {
    const { Database } = __require("bun:sqlite");
    db = new Database(DB_PATH, { create: true });
    db.exec("PRAGMA journal_mode=WAL");
    db.exec("PRAGMA busy_timeout=5000");
    db.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        filename TEXT UNIQUE NOT NULL,
        from_agent TEXT NOT NULL,
        to_agent TEXT NOT NULL,
        subject TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'inbox',
        mtime REAL NOT NULL,
        created_at TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_messages_to ON messages(to_agent);
      CREATE INDEX IF NOT EXISTS idx_messages_mtime ON messages(mtime);
      CREATE INDEX IF NOT EXISTS idx_messages_from ON messages(from_agent);

      CREATE TABLE IF NOT EXISTS heartbeats (
        agent TEXT PRIMARY KEY,
        status TEXT NOT NULL DEFAULT 'active',
        last_activity TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS receipts (
        filename TEXT NOT NULL,
        reader TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        PRIMARY KEY (filename, reader)
      );
    `);
    debug("SQLite initialized: " + DB_PATH);
    return true;
  } catch (err) {
    debug("SQLite unavailable, using file-only mode: " + String(err));
    db = null;
    return false;
  }
}
function autoSyncOnStartup() {
  if (!db) return;
  try {
    if (existsSync5(INBOX_DIR)) {
      for (const filename of readdirSync5(INBOX_DIR)) {
        if (!filename.endsWith(".md")) continue;
        const match = filename.match(/^\d{8}-(.+?)-(.+?)-(.+)\.md$/);
        if (!match) continue;
        try {
          const mtime = statSync4(join6(INBOX_DIR, filename)).mtimeMs;
          db.run(
            "INSERT OR IGNORE INTO messages (filename, from_agent, to_agent, subject, source, mtime) VALUES (?, ?, ?, ?, ?, ?)",
            [filename, match[1], match[2], match[3], "inbox", mtime]
          );
        } catch {
        }
      }
    }
    debug("auto-sync: inbox files imported into DB");
    const rcptPath = join6(RECEIPTS_DIR, "receipts.json");
    if (existsSync5(rcptPath)) {
      try {
        const rcptStore = JSON.parse(readFileSync5(rcptPath, "utf-8"));
        for (const [fname, readers] of Object.entries(rcptStore)) {
          for (const r of readers) {
            db.run(
              "INSERT OR IGNORE INTO receipts (filename, reader, timestamp) VALUES (?, ?, ?)",
              [fname, r.reader, r.timestamp]
            );
          }
        }
        debug("auto-sync: receipts imported into DB");
      } catch {
      }
    }
  } catch {
  }
}
function dbInsertMessage(filename, from, to, subject, source, mtimeMs) {
  if (!db) return;
  try {
    db.run(
      "INSERT OR IGNORE INTO messages (filename, from_agent, to_agent, subject, source, mtime) VALUES (?, ?, ?, ?, ?, ?)",
      [filename, from, to, subject, source, mtimeMs]
    );
  } catch {
  }
}
function dbUpsertHeartbeat(agent, status, lastActivity) {
  if (!db) return;
  try {
    db.run(
      `INSERT INTO heartbeats (agent, status, last_activity, updated_at)
       VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(agent) DO UPDATE SET
         status=excluded.status,
         last_activity=excluded.last_activity,
         updated_at=datetime('now')`,
      [agent, status, lastActivity]
    );
  } catch {
  }
}
function dbInsertReceipt(filename, reader, timestamp) {
  if (!db) return;
  try {
    db.run(
      "INSERT OR IGNORE INTO receipts (filename, reader, timestamp) VALUES (?, ?, ?)",
      [filename, reader, timestamp]
    );
  } catch {
  }
}
function dbGetStats(cutoff) {
  if (!db) return null;
  try {
    const sentRows = db.prepare(
      "SELECT from_agent, COUNT(*) as cnt FROM messages WHERE mtime >= ? AND source = 'inbox' GROUP BY from_agent"
    ).all(cutoff);
    const receivedRows = db.prepare(
      "SELECT to_agent, COUNT(*) as cnt FROM messages WHERE mtime >= ? AND source = 'inbox' AND to_agent NOT IN ('\uC804\uCCB4','all') GROUP BY to_agent"
    ).all(cutoff);
    const broadcastRow = db.prepare(
      "SELECT COUNT(*) as cnt FROM messages WHERE mtime >= ? AND source = 'inbox' AND to_agent IN ('\uC804\uCCB4','all')"
    ).get(cutoff);
    const cutoffISO = new Date(cutoff).toISOString();
    const receiptRow = db.prepare("SELECT COUNT(*) as cnt FROM receipts WHERE timestamp >= ?").get(cutoffISO);
    const sent = {};
    for (const r of sentRows) sent[r.from_agent] = r.cnt;
    const received = {};
    for (const r of receivedRows) received[r.to_agent] = r.cnt;
    return {
      sent,
      received,
      broadcasts: broadcastRow?.cnt ?? 0,
      totalReceipts: receiptRow?.cnt ?? 0
    };
  } catch {
    return null;
  }
}
function dbSyncAll() {
  if (!db) return null;
  let msgCount = 0;
  let hbCount = 0;
  let rcptCount = 0;
  if (existsSync5(INBOX_DIR)) {
    for (const filename of readdirSync5(INBOX_DIR)) {
      if (!filename.endsWith(".md")) continue;
      const parsed = parseFilename(filename);
      if (!parsed) continue;
      try {
        const mtime = statSync4(join6(INBOX_DIR, filename)).mtimeMs;
        dbInsertMessage(
          filename,
          parsed.from,
          parsed.to,
          parsed.subject,
          "inbox",
          mtime
        );
        msgCount++;
      } catch {
      }
    }
  }
  try {
    const { loadHeartbeats: loadHeartbeats2 } = (init_tap_io(), __toCommonJS(tap_io_exports));
    const hbStore = loadHeartbeats2();
    for (const [agent, hb] of Object.entries(hbStore)) {
      dbUpsertHeartbeat(agent, hb.status, hb.lastActivity);
      hbCount++;
    }
  } catch {
  }
  try {
    const { loadReceipts: loadReceipts2 } = (init_tap_io(), __toCommonJS(tap_io_exports));
    const rcptStore = loadReceipts2();
    for (const [filename, readers] of Object.entries(rcptStore)) {
      for (const r of readers) {
        dbInsertReceipt(filename, r.reader, r.timestamp);
        rcptCount++;
      }
    }
  } catch {
  }
  return { messages: msgCount, heartbeats: hbCount, receipts: rcptCount };
}

// packages/tap-plugin/channels/tap-watcher.ts
init_stale_meta();
init_tap_utils();
import { existsSync as existsSync6, readFileSync as readFileSync6, statSync as statSync5, watch } from "fs";
import { join as join7 } from "path";
init_tap_io();
init_tap_display();
var PRE_JOIN_SKIP = -1;
var notifiedFiles = /* @__PURE__ */ new Map();
var notifiedFileContentHashes = /* @__PURE__ */ new Map();
var recentEvents = /* @__PURE__ */ new Map();
var inFlightFiles = /* @__PURE__ */ new Set();
var DEBOUNCE_MS = 200;
var MAX_READY_ATTEMPTS = 6;
var READY_RETRY_MS = 40;
var WATCH_RESTART_MS = 1e3;
var RECENT_EVENT_TTL_MS = 5 * 60 * 1e3;
var RECENT_EVENT_CLEANUP_MS = 60 * 1e3;
function buildGenericRealtimePayload(content, meta, display) {
  const visibleContent = display ?? content;
  return {
    level: "info",
    logger: "tap-comms",
    data: {
      kind: "tap-message",
      content: visibleContent,
      ...display ? { rawContent: content } : {},
      meta,
      ...display ? { display } : {}
    }
  };
}
function isTruthyEnv(value) {
  return /^(1|true|yes|on)$/i.test(value?.trim() ?? "");
}
function isFalsyEnv(value) {
  return /^(0|false|no|off)$/i.test(value?.trim() ?? "");
}
function shouldSendClaudeChannelNotification() {
  const override = process.env.TAP_CLAUDE_CHANNEL_PUSH;
  if (isTruthyEnv(override)) return true;
  if (isFalsyEnv(override)) return false;
  return Boolean(process.env.CLAUDE_PLUGIN_ROOT?.trim());
}
function sleep(ms) {
  return new Promise((resolve8) => setTimeout(resolve8, ms));
}
function isRetryableFsError(error) {
  const code = error && typeof error === "object" && "code" in error ? String(error.code ?? "") : "";
  return code === "ENOENT" || code === "EBUSY" || code === "EPERM" || code === "EACCES";
}
async function waitForFileReady(filepath) {
  for (let attempt = 0; attempt < MAX_READY_ATTEMPTS; attempt++) {
    try {
      const mtime = statSync5(filepath).mtimeMs;
      if (mtime < SERVER_START - 5e3) return "stale";
      const content = stripBom(readFileSync6(filepath, "utf-8"));
      return { content, mtime };
    } catch (error) {
      if (attempt === MAX_READY_ATTEMPTS - 1 || !isRetryableFsError(error)) {
        debug(
          `watch read failed [${filepath}]: ${error instanceof Error ? error.message : String(error)}`
        );
        return null;
      }
      await sleep(READY_RETRY_MS * (attempt + 1));
    }
  }
  return null;
}
function isOwnMessageArtifact(source, filename, parsed) {
  const agentId = getAgentId();
  const agentName = getAgentName();
  if (parsed && isOwnMessageAddressForCurrentAgent(parsed.from)) {
    return true;
  }
  if (source === "reviews") {
    return filename.endsWith(`-${agentId}.md`) || filename.endsWith(`-${agentName}.md`);
  }
  return false;
}
function cleanupRecentEvents(now = Date.now()) {
  const cutoff = now - RECENT_EVENT_TTL_MS;
  for (const [key, ts] of recentEvents) {
    if (ts < cutoff) recentEvents.delete(key);
  }
}
var recentEventsCleanupTimer = setInterval(() => {
  cleanupRecentEvents();
}, RECENT_EVENT_CLEANUP_MS);
recentEventsCleanupTimer.unref?.();
async function processWatchFile(dir, source, filename, mcp2) {
  const key = getSourceKey(source, filename);
  const permanentlySkipped = notifiedFiles.get(key) === PRE_JOIN_SKIP;
  if (permanentlySkipped || inFlightFiles.has(key)) {
    debug("channel relay skipped before read", {
      source,
      filename,
      permanentlySkipped,
      inFlight: inFlightFiles.has(key)
    });
    return false;
  }
  inFlightFiles.add(key);
  try {
    const filepath = join7(dir, filename);
    const file = await waitForFileReady(filepath);
    if (file === "stale") {
      debug("channel relay skipped for stale file", {
        source,
        filename
      });
      return false;
    }
    if (!file) {
      logWarn("channel relay aborted: file not ready", {
        source,
        filename
      });
      return false;
    }
    if (hasReadFileAtMtime(key, file.mtime)) {
      debug("channel relay skipped: file already read at same or newer mtime", {
        source,
        filename,
        mtime: file.mtime,
        lastReadMtime: readFiles.get(key) ?? null
      });
      return false;
    }
    if (hasReadFileContent(key, file.content)) {
      debug("channel relay skipped: file content already read", {
        source,
        filename,
        mtime: file.mtime
      });
      return false;
    }
    const joinedAtMs = getJoinedAtMs();
    if (joinedAtMs && file.mtime < joinedAtMs) {
      notifiedFiles.set(key, PRE_JOIN_SKIP);
      debug("channel relay skipped: pre-join artifact", {
        source,
        filename,
        joinedAtMs,
        mtime: file.mtime
      });
      return false;
    }
    if (hasDurableReadReceipt(filename, {
      content: file.content,
      fileMtimeMs: file.mtime
    })) {
      debug("channel relay skipped: durable read receipt exists", {
        source,
        filename
      });
      return false;
    }
    if (isBridgeProcessed(filepath, file.mtime)) {
      debug("channel relay skipped: bridge already processed file", {
        source,
        filename
      });
      return false;
    }
    const fileContentHash = hashTapFileContent(file.content);
    const lastEmittedContentHash = notifiedFileContentHashes.get(key);
    if (lastEmittedContentHash === fileContentHash) {
      debug("channel relay skipped: file content already emitted", {
        source,
        filename,
        mtime: file.mtime
      });
      return false;
    }
    if (hasDisplayedNotification(source, filename, file.content)) {
      debug("channel relay skipped: durable displayed notification exists", {
        source,
        filename,
        mtime: file.mtime
      });
      notifiedFiles.set(key, file.mtime);
      notifiedFileContentHashes.set(key, fileContentHash);
      return false;
    }
    const lastEmittedMtime = notifiedFiles.get(key);
    if (lastEmittedMtime !== void 0 && lastEmittedMtime !== PRE_JOIN_SKIP && file.mtime <= lastEmittedMtime) {
      debug("channel relay skipped: mtime not advanced since last emit", {
        source,
        filename,
        mtime: file.mtime,
        lastEmittedMtime
      });
      return false;
    }
    let parsed = null;
    let inboxFrontmatter = null;
    if (source === "inbox") {
      inboxFrontmatter = parseFrontmatter(file.content);
      parsed = inboxFrontmatter ? {
        from: inboxFrontmatter.from,
        to: inboxFrontmatter.to,
        subject: inboxFrontmatter.subject
      } : parseFilename(filename);
    } else {
      parsed = parseFilename(filename);
    }
    if (source === "inbox" && (!parsed || (inboxFrontmatter ? !isInboxFrontmatterForCurrentAgent(inboxFrontmatter) : !isForMe(parsed.to)))) {
      debug("channel relay skipped: inbox item not addressed to agent", {
        source,
        filename,
        parsedTo: parsed?.to ?? null
      });
      return false;
    }
    if (isOwnMessageArtifact(source, filename, parsed)) {
      debug("channel relay skipped: self-authored artifact", {
        source,
        filename
      });
      return false;
    }
    if (source === "inbox" && parsed) {
      const reviewMeta = classifyReviewMetaForOperator({
        root: COMMS_DIR,
        filename,
        subject: parsed.subject,
        body: inboxFrontmatter ? stripFrontmatter(file.content) : file.content,
        sourceRelativePath: `inbox/${filename}`
      });
      if (reviewMeta.status === "collapsed-stale-meta") {
        debug("channel relay skipped: collapsed stale review-meta", {
          source,
          filename,
          prNumber: reviewMeta.prNumber,
          terminalEvidencePath: reviewMeta.terminalEvidencePath
        });
        notifiedFiles.set(key, file.mtime);
        notifiedFileContentHashes.set(key, fileContentHash);
        return false;
      }
    }
    const rawFrom = parsed?.from || source;
    const rawTo = parsed?.to || "all";
    const from = parsed ? resolveAgentLabel(inboxFrontmatter?.from_name ?? parsed.from) : source;
    const to = parsed ? resolveAgentLabel(inboxFrontmatter?.to_name ?? parsed.to) : "all";
    const subject = parsed?.subject || filename.replace(/\.md$/, "");
    const content = source === "inbox" && inboxFrontmatter ? stripFrontmatter(file.content) : file.content;
    const display = source === "inbox" ? buildCompactInboxDisplay({
      agentName: to,
      sender: from,
      recipient: to,
      subject,
      filename,
      body: content,
      replyTo: rawFrom,
      fromAddress: inboxFrontmatter?.from_address
    }) : void 0;
    const meta = {
      from,
      to,
      subject,
      filename,
      source
    };
    dbInsertMessage(filename, rawFrom, rawTo, subject, source, Date.now());
    const genericPayload = buildGenericRealtimePayload(content, meta, display);
    const visibleContent = display ?? content;
    const sendClaudeChannel = shouldSendClaudeChannelNotification();
    const primaryMethod = sendClaudeChannel ? "notifications/claude/channel" : "notifications/message";
    logInfo("channel relay attempt", {
      source,
      filename,
      from,
      to,
      subject,
      method: primaryMethod,
      genericFallbackMethod: sendClaudeChannel ? "notifications/message" : null
    });
    try {
      if (sendClaudeChannel) {
        await mcp2.notification({
          method: primaryMethod,
          params: {
            content: visibleContent,
            meta,
            ...display ? { display } : {},
            ...display ? {
              rawContent: content,
              debugEnvelope: { meta }
            } : {}
          }
        });
      } else {
        await mcp2.sendLoggingMessage(genericPayload);
      }
    } catch (error) {
      logError("channel relay failed", {
        source,
        filename,
        from,
        to,
        subject,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
    if (sendClaudeChannel) {
      try {
        await mcp2.sendLoggingMessage(genericPayload);
        logInfo("generic realtime notification sent", {
          source,
          filename,
          from,
          to,
          subject,
          method: "notifications/message"
        });
      } catch (error) {
        logWarn("generic realtime notification failed", {
          source,
          filename,
          subject,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
    logInfo("channel relay sent", {
      source,
      filename,
      from,
      to,
      subject,
      primaryMethod,
      genericMethod: sendClaudeChannel ? "notifications/message" : null
    });
    notifiedFiles.set(key, file.mtime);
    notifiedFileContentHashes.set(key, fileContentHash);
    try {
      markDisplayedNotification(source, filename, file.content);
    } catch (error) {
      logWarn("channel relay displayed marker write failed", {
        source,
        filename,
        error: error instanceof Error ? error.message : String(error)
      });
    }
    return true;
  } finally {
    inFlightFiles.delete(key);
  }
}
function watchDir(dir, source, mcp2) {
  if (!existsSync6(dir)) return;
  let watcher = null;
  let restartTimer = null;
  const scheduleRestart = (reason) => {
    if (restartTimer) return;
    logWarn("fs.watch restart scheduled", {
      source,
      reason,
      dir
    });
    restartTimer = setTimeout(() => {
      restartTimer = null;
      if (!existsSync6(dir)) {
        logWarn("fs.watch restart skipped: directory missing", {
          source,
          dir
        });
        return;
      }
      startWatcher();
    }, WATCH_RESTART_MS);
    restartTimer.unref();
  };
  const disposeWatcher = () => {
    if (!watcher) return;
    watcher.removeAllListeners();
    try {
      watcher.close();
    } catch {
    }
    watcher = null;
  };
  const startWatcher = () => {
    disposeWatcher();
    try {
      watcher = watch(dir, (eventType, filename) => {
        debug("fs.watch event", {
          source,
          dir,
          eventType,
          filename: filename ?? null
        });
        if (!filename || !filename.endsWith(".md")) return;
        const key = getSourceKey(source, filename);
        const now = Date.now();
        cleanupRecentEvents(now);
        const lastSeen = recentEvents.get(key);
        if (lastSeen && now - lastSeen < DEBOUNCE_MS) return;
        recentEvents.set(key, now);
        void processWatchFile(dir, source, filename, mcp2).catch((error) => {
          debug(
            `watch processing failed [${source}/${filename}]: ${error instanceof Error ? error.message : String(error)}`
          );
        });
      });
      watcher.on("error", (error) => {
        logError("fs.watch error", {
          source,
          dir,
          error: error instanceof Error ? error.message : String(error)
        });
        scheduleRestart("error");
      });
      watcher.on("close", () => {
        logWarn("fs.watch closed", {
          source,
          dir
        });
        scheduleRestart("close");
      });
      logInfo("fs.watch active", {
        source,
        dir
      });
    } catch (error) {
      logError("fs.watch start failed", {
        source,
        dir,
        error: error instanceof Error ? error.message : String(error)
      });
      scheduleRestart("start-failed");
    }
  };
  startWatcher();
}

// packages/tap-plugin/channels/tap-presence.ts
init_tap_utils();
init_tap_identity();
init_receive_transports();
import { existsSync as existsSync7, readFileSync as readFileSync7 } from "fs";
import { join as join8 } from "path";
function validateStructuredEnvelopeMetadata(options) {
  const scope = options.scope ?? null;
  const action = options.action?.trim() || null;
  const consentRef = options.consentRef?.trim() || null;
  const conversationId = options.target?.conversationId?.trim() || null;
  if (!scope) {
    if (action) {
      return 'A2A envelope "action" metadata requires a scope.';
    }
    if (consentRef) {
      return 'A2A envelope "consentRef" metadata requires a scope.';
    }
    return null;
  }
  if (scope === "observe") {
    if (action) {
      return "Observe scope is passive-only and cannot include an action.";
    }
    if (consentRef) {
      return "Observe scope is passive-only and cannot include a consentRef.";
    }
    return null;
  }
  if (!conversationId) {
    return `${scope} scope requires target.conversationId for auditable routing.`;
  }
  if (!action) {
    return `${scope} scope requires a non-empty action.`;
  }
  if (scope === "drive" && !consentRef) {
    return "Drive scope requires a non-empty consentRef.";
  }
  return null;
}
function parseJsonFile(filePath) {
  if (!existsSync7(filePath)) return null;
  try {
    return JSON.parse(readFileSync7(filePath, "utf-8"));
  } catch {
    return null;
  }
}
function formatAgentLabel2(agentIdOrName, displayName) {
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
function isProcessAlive2(pid) {
  if (pid == null || !Number.isFinite(pid)) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
function parseIsoAgeSeconds(value) {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) return null;
  return Math.max(0, Math.floor((Date.now() - timestamp) / 1e3));
}
function getActivityMs(heartbeat) {
  const activityMs = new Date(
    heartbeat.lastActivity ?? heartbeat.timestamp ?? 0
  ).getTime();
  const timestampMs = new Date(heartbeat.timestamp ?? 0).getTime();
  return Math.max(activityMs, timestampMs);
}
function resolveHeartbeatSource(heartbeat) {
  return heartbeat.source === "bridge-dispatch" ? "bridge-dispatch" : "mcp-direct";
}
function resolveBridgeStatus(stateDir, instanceId, instance) {
  if (!instanceId) {
    return {
      presence: "mcp-only",
      lifecycle: null,
      session: null,
      idleSince: null,
      conversationId: null,
      ownerClientId: null
    };
  }
  const isInstalledAppServer = instance?.installed === true && instance.bridgeMode === "app-server";
  const bridgeState = parseJsonFile(
    join8(stateDir, "pids", `bridge-${instanceId}.json`)
  );
  if (!bridgeState) {
    return {
      presence: "mcp-only",
      lifecycle: isInstalledAppServer ? "stopped" : null,
      session: null,
      idleSince: null,
      conversationId: null,
      ownerClientId: null
    };
  }
  if (!isProcessAlive2(bridgeState.pid)) {
    return {
      presence: "bridge-stale",
      lifecycle: "bridge-stale",
      session: null,
      idleSince: null,
      conversationId: null,
      ownerClientId: null
    };
  }
  const runtimeHeartbeat = bridgeState.runtimeStateDir ? parseJsonFile(
    join8(bridgeState.runtimeStateDir, "heartbeat.json")
  ) : null;
  const savedThread = bridgeState.runtimeStateDir ? parseJsonFile(
    join8(bridgeState.runtimeStateDir, "thread.json")
  ) : null;
  if (!runtimeHeartbeat || runtimeHeartbeat.initialized === false) {
    return {
      presence: "bridge-live",
      lifecycle: "initializing",
      session: "initializing",
      idleSince: null,
      conversationId: runtimeHeartbeat?.threadId ?? savedThread?.threadId ?? null,
      ownerClientId: runtimeHeartbeat?.threadId || savedThread?.threadId ? instanceId : null
    };
  }
  const conversationId = runtimeHeartbeat.threadId ?? savedThread?.threadId ?? null;
  const lifecycle = runtimeHeartbeat.threadId && runtimeHeartbeat.connected !== false ? "ready" : "degraded-no-thread";
  const session = runtimeHeartbeat.activeTurnId || runtimeHeartbeat.turnState === "active" ? "active" : runtimeHeartbeat.turnState === "waiting-approval" ? "waiting-approval" : runtimeHeartbeat.turnState === "disconnected" || runtimeHeartbeat.connected === false ? "disconnected" : "idle";
  const idleSince = session === "idle" || session === "waiting-approval" ? runtimeHeartbeat.idleSince ?? null : null;
  return {
    presence: "bridge-live",
    lifecycle: lifecycle === "degraded-no-thread" && !savedThread?.threadId ? "degraded-no-thread" : lifecycle,
    session,
    idleSince,
    conversationId,
    ownerClientId: conversationId ? instanceId : null
  };
}
var PRESENCE_PRIORITY = {
  "bridge-live": 3,
  "mcp-only": 2,
  "bridge-stale": 1
};
var SOURCE_PRIORITY = {
  "bridge-dispatch": 2,
  "mcp-direct": 1
};
var HEALTH_SEVERITY = {
  "stuck-turn": 90,
  "stale-owner": 80,
  "stale-active-turn": 75,
  "active-turn": 70,
  partial: 60,
  "adapter-unavailable": 50,
  degraded: 40,
  "not-observed": 30,
  unknown: 20,
  ready: 10
};
var STRUCTURED_RECIPIENT_LIVENESS_MINUTES = 30;
var STRUCTURED_RECIPIENT_LIVENESS_MS = STRUCTURED_RECIPIENT_LIVENESS_MINUTES * 60 * 1e3;
var POLLING_RECIPIENT_VISIBILITY_MINUTES = 17 * 60;
var POLLING_RECIPIENT_VISIBILITY_MS = POLLING_RECIPIENT_VISIBILITY_MINUTES * 60 * 1e3;
var CODEX_RUNTIME_GUIDE = "AI_GUIDE.md";
function compareCandidates(a, b) {
  const presenceDelta = PRESENCE_PRIORITY[b.presence] - PRESENCE_PRIORITY[a.presence];
  if (presenceDelta !== 0) return presenceDelta;
  const sourceDelta = SOURCE_PRIORITY[b.source] - SOURCE_PRIORITY[a.source];
  if (sourceDelta !== 0) return sourceDelta;
  if (a.alive !== b.alive) return a.alive ? -1 : 1;
  if (a.lastActivityMs !== b.lastActivityMs) {
    return b.lastActivityMs - a.lastActivityMs;
  }
  return a.id.localeCompare(b.id);
}
function prefersInboxSurface(candidate) {
  return candidate.receiveTransports.includes("polling") || candidate.receiveTransports.includes("mcp-channel");
}
function isFreshConsentDriveCandidate(candidate) {
  return candidate.receiveTransports.includes("consent-drive") && candidate.presenceFreshness === "fresh-for-routing" && candidate.health.status === "ready";
}
function isStaleConsentDriveOnlyCandidate(candidate) {
  return candidate.receiveTransports.includes("consent-drive") && !prefersInboxSurface(candidate) && candidate.presenceFreshness === "stale-visible";
}
function presenceFreshnessWindowMs(receiveTransports) {
  if (receiveTransports.includes("consent-drive")) {
    return STRUCTURED_RECIPIENT_LIVENESS_MS;
  }
  if (receiveTransports.includes("polling")) {
    return POLLING_RECIPIENT_VISIBILITY_MS;
  }
  return STRUCTURED_RECIPIENT_LIVENESS_MS;
}
function chooseInboxSurfaceFallback(candidates) {
  if (!candidates.some(isStaleConsentDriveOnlyCandidate)) return null;
  if (candidates.some(isFreshConsentDriveCandidate)) return null;
  const inboxCandidates = candidates.filter(prefersInboxSurface).sort(compareCandidates);
  return inboxCandidates.length === 1 ? inboxCandidates[0] : null;
}
function uniqueRoutingAliases(values) {
  const aliases = [];
  for (const value of values) {
    const normalized = value?.trim();
    if (!normalized) continue;
    if (aliases.some((alias) => sameRoutingAddress(alias, normalized)))
      continue;
    aliases.push(normalized);
  }
  return aliases;
}
function resolveMergedDisplayName(candidates) {
  const named = candidates.filter(
    (candidate) => candidate.displayName != null && !isPlaceholderAgentValue(candidate.displayName)
  );
  if (named.length === 0) return null;
  const liveNamed = named.filter((candidate) => candidate.alive);
  const displayCandidates = liveNamed.length > 0 ? liveNamed : named;
  return [...displayCandidates].sort((a, b) => {
    if (a.source !== b.source) {
      if (a.source === "mcp-direct") return -1;
      if (b.source === "mcp-direct") return 1;
    }
    if (a.lastActivityMs !== b.lastActivityMs) {
      return b.lastActivityMs - a.lastActivityMs;
    }
    return compareCandidates(a, b);
  })[0]?.displayName ?? null;
}
function mergeRuntimeHealth(candidates) {
  const [selected] = [...candidates].sort((a, b) => {
    const severityDelta = HEALTH_SEVERITY[b.health.status] - HEALTH_SEVERITY[a.health.status];
    if (severityDelta !== 0) return severityDelta;
    if (a.health.checkedAt !== b.health.checkedAt) {
      const aTime = new Date(a.health.checkedAt ?? 0).getTime();
      const bTime = new Date(b.health.checkedAt ?? 0).getTime();
      if (Number.isFinite(aTime) && Number.isFinite(bTime) && aTime !== bTime) {
        return bTime - aTime;
      }
    }
    return compareCandidates(a, b);
  });
  return selected.health;
}
function applySlotDisambiguation(candidates) {
  const bySlot = /* @__PURE__ */ new Map();
  for (const candidate of candidates) {
    if (!candidate.slot) continue;
    if (!candidate.alive) continue;
    if (candidate.presence === "bridge-stale") continue;
    const group = bySlot.get(candidate.slot);
    if (group) {
      group.push(candidate);
    } else {
      bySlot.set(candidate.slot, [candidate]);
    }
  }
  const staleByNewer = /* @__PURE__ */ new Set();
  const active = /* @__PURE__ */ new Set();
  for (const group of bySlot.values()) {
    if (group.length < 2) continue;
    const sorted = [...group].sort(
      (a, b) => b.lastActivityMs - a.lastActivityMs
    );
    const [winner, ...losers] = sorted;
    active.add(winner);
    for (const loser of losers) {
      staleByNewer.add(loser);
    }
  }
  return candidates.map((candidate) => {
    if (active.has(candidate)) {
      return { ...candidate, slotStatus: "active" };
    }
    if (staleByNewer.has(candidate)) {
      return { ...candidate, slotStatus: "stale-by-newer" };
    }
    return { ...candidate, slotStatus: null };
  });
}
function mergePresenceGroup(candidates) {
  const groups = /* @__PURE__ */ new Map();
  for (const candidate of candidates) {
    const group = groups.get(candidate.connectHash);
    if (group) {
      group.push(candidate);
    } else {
      groups.set(candidate.connectHash, [candidate]);
    }
  }
  return [...groups.values()].map((group) => {
    const sortedGroup = [...group].sort(compareCandidates);
    const winner = sortedGroup[0];
    const mergedDisplayName = resolveMergedDisplayName(group) ?? winner.displayName;
    const mergedSlot = sortedGroup.find((candidate) => candidate.slot != null)?.slot ?? winner.slot ?? null;
    const mergedInstanceId = sortedGroup.find((candidate) => candidate.instanceId != null)?.instanceId ?? winner.instanceId ?? null;
    const mergedRoutingAddress = sortedGroup.find((candidate) => candidate.address.routingAddress.trim())?.address.routingAddress ?? mergedSlot ?? mergedInstanceId ?? winner.instanceId ?? winner.id;
    const routingAliases = uniqueRoutingAliases(
      group.flatMap((candidate) => [
        ...candidate.address.aliases ?? [],
        candidate.routingAddress,
        candidate.slot,
        candidate.instanceId,
        candidate.id,
        candidate.displayName
      ])
    );
    const mergedHostId = sortedGroup.find((candidate) => candidate.address.hostId != null)?.address.hostId ?? winner.address.hostId;
    const mergedConversationId = sortedGroup.find(
      (candidate) => candidate.address.conversationId != null
    )?.address.conversationId ?? winner.address.conversationId;
    const mergedOwnerClientId = sortedGroup.find((candidate) => candidate.address.ownerClientId != null)?.address.ownerClientId ?? winner.address.ownerClientId;
    const mergedReceiveTransports = normalizeReceiveTransports(
      sortedGroup.flatMap((candidate) => candidate.receiveTransports)
    );
    const mergedConsentDriveStatus = deriveConsentDriveStatus({
      receiveTransports: mergedReceiveTransports,
      conversationId: mergedConversationId,
      ownerClientId: mergedOwnerClientId,
      stale: sortedGroup.every(
        (candidate) => candidate.consentDriveStatus === "stale"
      )
    });
    const mergedPresenceFreshness = sortedGroup.some(
      (candidate) => candidate.presenceFreshness === "fresh-for-routing"
    ) ? "fresh-for-routing" : sortedGroup.some(
      (candidate) => candidate.presenceFreshness === "stale-visible"
    ) ? "stale-visible" : winner.presenceFreshness;
    return {
      ...winner,
      instanceId: mergedInstanceId,
      slot: mergedSlot,
      routingAddress: mergedRoutingAddress,
      displayName: mergedDisplayName,
      agent: formatAgentLabel2(winner.id, mergedDisplayName),
      receiveTransports: mergedReceiveTransports,
      consentDriveStatus: mergedConsentDriveStatus,
      presenceFreshness: mergedPresenceFreshness,
      health: mergeRuntimeHealth(sortedGroup),
      address: buildAddressMetadata({
        hostId: mergedHostId,
        agentId: winner.id,
        instanceId: mergedInstanceId,
        routingAddress: mergedRoutingAddress,
        slot: mergedSlot,
        aliases: routingAliases,
        conversationId: mergedConversationId,
        ownerClientId: mergedOwnerClientId,
        deriveOwnerClientIdFromInstance: false
      }),
      routingAliases
    };
  }).sort(compareCandidates);
}
function buildPresenceCandidates(store, minutes) {
  const cutoff = minutes == null ? null : Date.now() - minutes * 60 * 1e3;
  const stateDir = process.env.TAP_STATE_DIR;
  const stateInstances = loadStateInstances();
  const agents = [];
  for (const [agentId, heartbeat] of Object.entries(store)) {
    if (!heartbeat.id) continue;
    const lastActivityMs = getActivityMs(heartbeat);
    if (!Number.isFinite(lastActivityMs)) continue;
    if (cutoff != null && lastActivityMs < cutoff) continue;
    const displayName = heartbeat.agent ?? null;
    const storedAddress = heartbeat.address ?? null;
    const instanceId = heartbeat.instanceId ?? storedAddress?.clientId?.trim() ?? resolveKnownInstanceId(agentId, displayName);
    const slot = storedAddress?.slot ?? deriveRoutingSlotFromInstanceId(instanceId);
    const routingAddress = storedAddress?.routingAddress?.trim() || slot || instanceId || agentId;
    const source = resolveHeartbeatSource(heartbeat);
    const connectHash = heartbeat.connectHash ?? buildHeartbeatConnectHash(instanceId, agentId);
    const instance = (instanceId != null ? stateInstances?.[instanceId] ?? null : null) ?? null;
    const bridge = stateDir != null ? resolveBridgeStatus(stateDir, instanceId, instance) : {
      presence: "mcp-only",
      lifecycle: null,
      session: null,
      idleSince: null,
      conversationId: null,
      ownerClientId: null
    };
    const conversationId = heartbeat.capabilities?.conversationId ?? storedAddress?.conversationId ?? bridge.conversationId;
    const ownerClientId = heartbeat.capabilities?.ownerClientId ?? storedAddress?.ownerClientId ?? bridge.ownerClientId;
    const idleBasis = bridge.idleSince ?? heartbeat.lastActivity ?? heartbeat.timestamp ?? null;
    const routingAliases = uniqueRoutingAliases([
      ...storedAddress?.aliases ?? [],
      routingAddress,
      slot,
      instanceId,
      agentId,
      displayName
    ]);
    const receiveTransports = normalizeReceiveTransports(
      heartbeat.capabilities?.receiveTransports ?? heartbeat.receiveTransports
    );
    const presenceFreshness = derivePresenceFreshness({
      alive: heartbeat.status !== "signing-off",
      presence: bridge.presence,
      lastActivityMs,
      receiveTransports
    });
    const consentDriveStatus = deriveConsentDriveStatus({
      receiveTransports,
      conversationId,
      ownerClientId,
      stale: heartbeat.status === "signing-off" || bridge.presence === "bridge-stale" || presenceFreshness === "stale-visible"
    });
    const health = deriveRuntimeHealth({
      heartbeat,
      presence: bridge.presence,
      presenceFreshness,
      lifecycle: bridge.lifecycle,
      session: bridge.session,
      consentDriveStatus,
      receiveTransports,
      conversationId,
      ownerClientId
    });
    agents.push({
      id: agentId,
      agent: formatAgentLabel2(agentId, displayName),
      status: heartbeat.status ?? "active",
      lastHeartbeat: heartbeat.timestamp ?? "",
      lastActivity: heartbeat.lastActivity ?? heartbeat.timestamp ?? "",
      alive: heartbeat.status !== "signing-off",
      source,
      instanceId,
      slot,
      routingAddress,
      connectHash,
      presence: bridge.presence,
      lifecycle: bridge.lifecycle,
      session: bridge.session,
      idleSeconds: parseIsoAgeSeconds(idleBasis),
      address: buildAddressMetadata({
        hostId: storedAddress?.hostId ?? null,
        agentId,
        instanceId,
        routingAddress,
        slot,
        aliases: routingAliases,
        conversationId,
        ownerClientId,
        deriveOwnerClientIdFromInstance: false
      }),
      receiveTransports,
      consentDriveStatus,
      presenceFreshness,
      health,
      slotStatus: null,
      displayName,
      lastActivityMs,
      routingAliases
    });
  }
  return agents.sort(compareCandidates);
}
function derivePresenceFreshness(options) {
  if (!Number.isFinite(options.lastActivityMs)) return "unknown";
  if (!options.alive || options.presence === "bridge-stale") {
    return "stale-visible";
  }
  const ageMs = Date.now() - options.lastActivityMs;
  if (ageMs > presenceFreshnessWindowMs(options.receiveTransports)) {
    return "stale-visible";
  }
  if (options.receiveTransports.includes("consent-drive")) {
    return "fresh-for-routing";
  }
  return "visible";
}
function deriveConsentDriveStatus(options) {
  if (!options.receiveTransports.includes("consent-drive")) return null;
  if (options.stale) return "stale";
  if (options.conversationId?.trim() && options.ownerClientId?.trim()) {
    return "ready";
  }
  if (options.conversationId?.trim() || options.ownerClientId?.trim()) {
    return "partial";
  }
  return "unavailable";
}
function deriveRuntimeHealth(options) {
  const publishedHealth = isRuntimeHealth(options.heartbeat.health) ? options.heartbeat.health : null;
  const adapter = options.receiveTransports.includes("consent-drive") ? "codex-consent-drive" : options.presence === "bridge-live" || options.presence === "bridge-stale" ? "codex-bridge" : options.receiveTransports.includes("mcp-channel") ? "mcp-channel" : options.receiveTransports.includes("polling") ? "file-polling" : null;
  const checkedAt = options.heartbeat.lastActivity ?? options.heartbeat.timestamp ?? null;
  const preferPublishedHealth = (derivedHealth) => {
    if (!publishedHealth) return derivedHealth;
    const publishedSeverity = HEALTH_SEVERITY[publishedHealth.status];
    const derivedSeverity = HEALTH_SEVERITY[derivedHealth.status];
    return publishedSeverity > derivedSeverity ? publishedHealth : derivedHealth;
  };
  if (options.heartbeat.status === "signing-off") {
    return {
      status: "not-observed",
      reason: "heartbeat is signing-off",
      checkedAt,
      adapter,
      recovery: "call tap_set_name from the target runtime"
    };
  }
  if (options.presence === "bridge-stale") {
    return {
      status: "adapter-unavailable",
      reason: "bridge process is stale",
      checkedAt,
      adapter: "codex-bridge",
      recovery: `restart the bridge/app-server and rerun lifecycle check; see ${CODEX_RUNTIME_GUIDE}`
    };
  }
  if (options.lifecycle === "stopped") {
    return {
      status: "adapter-unavailable",
      reason: "bridge/app-server is stopped",
      checkedAt,
      adapter: "codex-bridge",
      recovery: `start the bridge/app-server; see ${CODEX_RUNTIME_GUIDE}`
    };
  }
  if (options.lifecycle === "initializing" || options.lifecycle === "degraded-no-thread") {
    return {
      status: "degraded",
      reason: options.lifecycle === "initializing" ? "bridge/app-server is initializing" : "bridge/app-server has no ready thread",
      checkedAt,
      adapter: "codex-bridge",
      recovery: `wait or restart bridge/app-server if it remains degraded; see ${CODEX_RUNTIME_GUIDE}`
    };
  }
  if (options.session === "active" || options.session === "waiting-approval") {
    return {
      status: "active-turn",
      reason: options.session === "waiting-approval" ? "target turn is waiting for approval" : "target conversation has an active turn",
      checkedAt,
      adapter,
      recovery: "wait for the active turn to finish"
    };
  }
  if (options.consentDriveStatus === "stale") {
    return preferPublishedHealth({
      status: "stale-owner",
      reason: options.presenceFreshness === "stale-visible" ? "cross-device presence is stale-visible, not fresh-for-routing" : "consent-drive route is stale",
      checkedAt,
      adapter: "codex-consent-drive",
      recovery: "run tap:presence-publish -- --check-only from the hub to confirm whether the target runtime needs warm-up or only central publication; then warm up the target runtime if needed and publish fresh presence to the central comms bus"
    });
  }
  if (options.consentDriveStatus === "partial") {
    return preferPublishedHealth({
      status: "partial",
      reason: options.conversationId?.trim() ? "ownerClientId is missing" : "conversationId is missing",
      checkedAt,
      adapter: "codex-consent-drive",
      recovery: "run tap_register_capabilities from the target runtime with conversationId"
    });
  }
  if (options.consentDriveStatus === "unavailable") {
    return preferPublishedHealth({
      status: "adapter-unavailable",
      reason: "consent-drive is advertised but no route tuple is registered",
      checkedAt,
      adapter: "codex-consent-drive",
      recovery: "run tap_register_capabilities from the target runtime with conversationId"
    });
  }
  if (publishedHealth) {
    return publishedHealth;
  }
  if (options.presence === "bridge-live" || options.consentDriveStatus === "ready" || options.receiveTransports.includes("mcp-channel") || options.receiveTransports.includes("polling")) {
    return {
      status: "ready",
      reason: options.receiveTransports.includes("polling") ? "inbox polling via tap_list_unread; no realtime push channel advertised" : null,
      checkedAt,
      adapter,
      recovery: null
    };
  }
  return {
    status: "unknown",
    reason: "runtime did not publish enough health information",
    checkedAt,
    adapter,
    recovery: null
  };
}
function isRuntimeHealth(value) {
  if (!value || typeof value !== "object") return false;
  const candidate = value;
  return isRuntimeHealthStatus(candidate.status);
}
function isRuntimeHealthStatus(value) {
  return value === "ready" || value === "partial" || value === "stale-owner" || value === "active-turn" || value === "stale-active-turn" || value === "stuck-turn" || value === "not-observed" || value === "adapter-unavailable" || value === "degraded" || value === "unknown";
}
function buildWhoAgents(store, minutes) {
  return applySlotDisambiguation(
    mergePresenceGroup(buildPresenceCandidates(store, minutes))
  );
}
var SLOT_FORM_REGEX = /^(tower|reviewer|wt-\d+)$/;
var RESERVED_BROAD_ROLE_ALIASES = /* @__PURE__ */ new Set([
  "codex",
  "implementer",
  "implementation",
  "reviewer",
  "tower"
]);
function isSlotFormAddress(address) {
  return SLOT_FORM_REGEX.test(address.trim());
}
function isReservedBroadRoleAlias(address) {
  return RESERVED_BROAD_ROLE_ALIASES.has(address.trim().toLowerCase());
}
function buildAmbiguousBroadRoleAliasResolution(recipient, candidates) {
  const sorted = [...candidates].sort(compareCandidates);
  const candidateIds = sorted.map((candidate) => candidate.id);
  const candidateDetails = sorted.map((candidate) => {
    const routingAddress = candidate.routingAddress.trim();
    if (routingAddress && routingAddress !== candidate.id) {
      return `${candidate.id} (${routingAddress})`;
    }
    return candidate.id;
  });
  return {
    target: recipient,
    routingTarget: recipient,
    found: false,
    ambiguous: true,
    candidates: candidateIds,
    warning: `\u26A0\uFE0F Blocked ambiguous role alias "${recipient}": matched candidates ${candidateDetails.join(", ")}. Use a concrete agent name, a structured target with routing metadata, or an explicitly configured role mapping.`,
    displayName: null,
    instanceId: null,
    slot: null,
    address: null,
    receiveTransports: []
  };
}
function resolvePreferredRecipient(store, recipient) {
  const allCandidates = buildPresenceCandidates(store, null);
  const reservedBroadRole = isReservedBroadRoleAlias(recipient);
  const exactId = allCandidates.find((candidate) => candidate.id === recipient);
  if (exactId && !reservedBroadRole) {
    const inboxFallback = isStaleConsentDriveOnlyCandidate(exactId) ? chooseInboxSurfaceFallback(
      allCandidates.filter(
        (candidate) => candidate.routingAliases.some(
          (alias) => sameRoutingAddress(alias, recipient) || alias === recipient
        )
      )
    ) : null;
    if (inboxFallback) {
      return buildResolvedRecipient(inboxFallback);
    }
    return {
      target: exactId.id,
      routingTarget: exactId.routingAddress,
      found: true,
      ambiguous: false,
      candidates: [exactId.id],
      warning: null,
      displayName: exactId.displayName,
      instanceId: exactId.instanceId,
      slot: exactId.slot,
      address: exactId.address,
      receiveTransports: exactId.receiveTransports
    };
  }
  const deduped = applySlotDisambiguation(mergePresenceGroup(allCandidates));
  const slotForm = isSlotFormAddress(recipient);
  const aliasMatches = deduped.filter((candidate) => {
    if (!candidate.routingAliases.some(
      (alias) => sameRoutingAddress(alias, recipient) || alias === recipient
    )) {
      return false;
    }
    if (slotForm && candidate.slotStatus === "stale-by-newer") return false;
    return true;
  });
  if (aliasMatches.length === 1) {
    return {
      target: aliasMatches[0].id,
      routingTarget: aliasMatches[0].routingAddress,
      found: true,
      ambiguous: false,
      candidates: [aliasMatches[0].id],
      warning: null,
      displayName: aliasMatches[0].displayName,
      instanceId: aliasMatches[0].instanceId,
      slot: aliasMatches[0].slot,
      address: aliasMatches[0].address,
      receiveTransports: aliasMatches[0].receiveTransports
    };
  }
  if (aliasMatches.length > 1) {
    if (reservedBroadRole) {
      return buildAmbiguousBroadRoleAliasResolution(recipient, aliasMatches);
    }
    const inboxFallback = chooseInboxSurfaceFallback(aliasMatches);
    if (inboxFallback) {
      return buildResolvedRecipient(inboxFallback);
    }
    const sorted = [...aliasMatches].sort(compareCandidates);
    const winner = sorted[0];
    const candidateIds = sorted.map((candidate) => candidate.id);
    return {
      target: winner.id,
      routingTarget: winner.routingAddress,
      found: true,
      ambiguous: true,
      candidates: candidateIds,
      warning: `\u26A0\uFE0F Routed "${recipient}" \u2192 "${winner.routingAddress}" (${winner.presence}/${winner.source}, preferred of ${candidateIds.join(", ")}).`,
      displayName: winner.displayName,
      instanceId: winner.instanceId,
      slot: winner.slot,
      address: winner.address,
      receiveTransports: winner.receiveTransports
    };
  }
  if (exactId && reservedBroadRole) {
    return buildResolvedRecipient(exactId);
  }
  return {
    target: recipient,
    routingTarget: recipient,
    found: false,
    ambiguous: false,
    candidates: [],
    warning: null,
    displayName: null,
    instanceId: null,
    slot: null,
    address: null,
    receiveTransports: []
  };
}
function buildResolvedRecipient(candidate, options) {
  return {
    target: candidate.id,
    routingTarget: candidate.routingAddress,
    found: true,
    ambiguous: options?.ambiguous ?? false,
    candidates: options?.candidates ?? [candidate.id],
    warning: options?.warning ?? null,
    displayName: candidate.displayName,
    instanceId: candidate.instanceId,
    slot: candidate.slot,
    address: candidate.address,
    receiveTransports: candidate.receiveTransports
  };
}
function isStructuredRecipientLive(candidate) {
  if (!candidate.alive) return false;
  return candidate.presence !== "bridge-stale";
}
function isStructuredRecipientFreshForRouting(candidate) {
  return isStructuredRecipientLive(candidate) && candidate.presenceFreshness !== "stale-visible" && candidate.presenceFreshness !== "unknown";
}
function normalizeStructuredTarget(target) {
  const routingAddress = target.routingAddress?.trim();
  if (!routingAddress) return null;
  return {
    routingAddress,
    hostId: target.hostId?.trim() || null,
    clientId: target.clientId?.trim() || null,
    conversationId: target.conversationId?.trim() || null,
    ownerClientId: target.ownerClientId?.trim() || null
  };
}
function matchesStructuredTarget(candidate, target) {
  if (!candidate.routingAliases.some(
    (alias) => sameRoutingAddress(alias, target.routingAddress) || alias === target.routingAddress
  )) {
    return false;
  }
  if (target.hostId && candidate.address.hostId?.trim() !== target.hostId) {
    return false;
  }
  if (target.clientId && candidate.address.clientId?.trim() !== target.clientId && candidate.instanceId?.trim() !== target.clientId) {
    return false;
  }
  if (target.conversationId && candidate.address.conversationId?.trim() !== target.conversationId) {
    return false;
  }
  if (target.ownerClientId && candidate.address.ownerClientId?.trim() !== target.ownerClientId) {
    return false;
  }
  return true;
}
function resolveStructuredRecipient(store, target) {
  const normalizedTarget = normalizeStructuredTarget(target);
  if (!normalizedTarget) {
    return {
      target: "",
      routingTarget: "",
      found: false,
      ambiguous: false,
      candidates: [],
      warning: null,
      displayName: null,
      instanceId: null,
      slot: null,
      address: null,
      receiveTransports: []
    };
  }
  const recentCandidates = buildPresenceCandidates(
    store,
    POLLING_RECIPIENT_VISIBILITY_MINUTES
  );
  const exactId = recentCandidates.find(
    (candidate) => candidate.id === normalizedTarget.routingAddress && isStructuredRecipientFreshForRouting(candidate) && matchesStructuredTarget(candidate, normalizedTarget)
  );
  if (exactId) {
    return buildResolvedRecipient(exactId);
  }
  const liveCandidates = applySlotDisambiguation(
    mergePresenceGroup(recentCandidates)
  ).filter(isStructuredRecipientFreshForRouting);
  const slotForm = isSlotFormAddress(normalizedTarget.routingAddress);
  const matches = liveCandidates.filter((candidate) => {
    if (!matchesStructuredTarget(candidate, normalizedTarget)) return false;
    if (slotForm && candidate.slotStatus === "stale-by-newer") return false;
    return true;
  });
  if (matches.length === 1) {
    return buildResolvedRecipient(matches[0]);
  }
  if (matches.length > 1) {
    const sorted = [...matches].sort(compareCandidates);
    const winner = sorted[0];
    const candidateIds = sorted.map((candidate) => candidate.id);
    return buildResolvedRecipient(winner, {
      ambiguous: true,
      candidates: candidateIds,
      warning: `\u26A0\uFE0F Routed structured target "${normalizedTarget.routingAddress}" \u2192 "${winner.routingAddress}" (${winner.presence}/${winner.source}, preferred of ${candidateIds.join(", ")}).`
    });
  }
  const staleMatches = applySlotDisambiguation(
    mergePresenceGroup(buildPresenceCandidates(store, null))
  ).filter(
    (candidate) => candidate.alive && candidate.presence !== "bridge-stale" && matchesStructuredTarget(candidate, normalizedTarget) && candidate.presenceFreshness === "stale-visible"
  );
  if (staleMatches.length > 0) {
    const sorted = [...staleMatches].sort(compareCandidates);
    const candidateIds = sorted.map((candidate) => candidate.id);
    return {
      target: normalizedTarget.routingAddress,
      routingTarget: normalizedTarget.routingAddress,
      found: false,
      ambiguous: candidateIds.length > 1,
      candidates: candidateIds,
      warning: `Structured target "${normalizedTarget.routingAddress}" matched stale-visible presence (${candidateIds.join(", ")}), but no fresh-for-routing recipient matched the requested address constraints. Recovery: run tap:presence-publish -- --check-only from the hub to confirm whether the target runtime needs warm-up or only central publication; then warm up the target runtime if needed, publish fresh presence, and retry.`,
      displayName: sorted[0].displayName,
      instanceId: sorted[0].instanceId,
      slot: sorted[0].slot,
      address: sorted[0].address,
      receiveTransports: sorted[0].receiveTransports
    };
  }
  return {
    target: normalizedTarget.routingAddress,
    routingTarget: normalizedTarget.routingAddress,
    found: false,
    ambiguous: false,
    candidates: [],
    warning: null,
    displayName: null,
    instanceId: null,
    slot: null,
    address: null,
    receiveTransports: []
  };
}

// packages/tap-plugin/channels/tap-consent.ts
import { createHash as createHash3, randomBytes, randomUUID as randomUUID5 } from "crypto";
import { execFileSync } from "child_process";
import {
  chmodSync,
  existsSync as existsSync9,
  mkdirSync as mkdirSync6,
  readFileSync as readFileSync8,
  readdirSync as readdirSync6,
  rmSync as rmSync2,
  statSync as statSync6,
  utimesSync,
  writeFileSync as writeFileSync6
} from "fs";
import { tmpdir as tmpdir2 } from "os";
import { join as join10, resolve as resolve3 } from "path";

// src/transport/consent-ledger.ts
import { randomUUID as randomUUID4 } from "crypto";
import * as fs2 from "fs";
import * as path2 from "path";
function normalizeString3(value) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}
function normalizeAddress2(value) {
  if (!value) {
    return null;
  }
  const address = {
    hostId: normalizeString3(value.hostId),
    clientId: normalizeString3(value.clientId),
    conversationId: normalizeString3(value.conversationId),
    ownerClientId: normalizeString3(value.ownerClientId)
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
  const resolvedCommsDir = normalizeString3(commsDir) ?? normalizeString3(process.env.TAP_COMMS_DIR);
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
    grantId: `orphan-${Date.now().toString(36)}-${randomUUID4().slice(0, 8)}`,
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
    `${baseName}-${randomUUID4().replace(/-/g, "").slice(0, 6)}.md`
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
    normalizeString3(options.grantId)
  );
  const result = normalizeString3(options.result);
  const ledgerDir = resolveConsentLedgerDir(options.commsDir);
  if (!grantId || !result || !ledgerDir) {
    return null;
  }
  const record = {
    event: options.event,
    grantId,
    orphanReason,
    scope: options.scope,
    method: normalizeString3(options.method),
    hostId: normalizeString3(options.hostId),
    conversationId: normalizeString3(options.conversationId),
    issuedAt: normalizeString3(options.issuedAt),
    expiresAt: normalizeString3(options.expiresAt),
    consumedAt: normalizeString3(options.consumedAt),
    recordedAt: normalizeString3(options.recordedAt) ?? (/* @__PURE__ */ new Date()).toISOString(),
    result,
    requester: normalizeAddress2(options.requester),
    owner: normalizeAddress2(options.owner),
    issuedByClientId: normalizeString3(options.issuedByClientId)
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

// packages/tap-plugin/channels/tap-consent.ts
var TAP_CONSENT_RECEIPTS_DIRNAME = "tap-codex-a2a-consent";
var TAP_CONSENT_SECRETS_DIRNAME = "tap-codex-a2a-consent-secrets";
var DEFAULT_TAP_CONSENT_TTL_SECONDS = 10 * 60;
var TapConsentReceiptError = class extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = "TapConsentReceiptError";
  }
  code;
};
function normalizeString4(value) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
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
  return resolve3(value).replace(/\\/g, "/").toLowerCase();
}
function resolveIdentityOwnerTuple(identity) {
  return {
    hostId: normalizeString4(identity.address.hostId),
    conversationId: normalizeString4(identity.address.conversationId),
    ownerClientId: normalizeString4(identity.address.ownerClientId) ?? normalizeString4(identity.address.clientId),
    issuedByClientId: normalizeString4(identity.address.clientId)
  };
}
function assertOwnerBoundOverride(field, requested, actual) {
  if (!requested) return;
  if (requested === actual) return;
  const actualLabel = actual ?? "(unbound)";
  throw new TapConsentReceiptError(
    "binding-mismatch",
    `tap_create_consent_receipt can only mint for the current owner tuple; requested ${field} "${requested}" did not match active ${field} "${actualLabel}".`
  );
}
function resolveReceiptsDir(explicitDir) {
  const configuredDir = normalizeString4(explicitDir) ?? normalizeString4(process.env.TAP_CONSENT_RECEIPTS_DIR);
  return configuredDir ? resolve3(configuredDir) : join10(tmpdir2(), TAP_CONSENT_RECEIPTS_DIRNAME);
}
function resolveSecretsDir(explicitDir) {
  const configuredDir = normalizeString4(explicitDir) ?? normalizeString4(process.env.TAP_CONSENT_SECRETS_DIR);
  return configuredDir ? resolve3(configuredDir) : join10(tmpdir2(), TAP_CONSENT_SECRETS_DIRNAME);
}
function resolveConsentDirs(options) {
  const receiptsDir = resolveReceiptsDir(options.receiptsDir);
  const secretsDir = resolveSecretsDir(options.secretsDir);
  if (normalizePathForComparison(receiptsDir) === normalizePathForComparison(secretsDir)) {
    throw new TapConsentReceiptError(
      "invalid",
      "Consent receipts dir and secrets dir must be different paths."
    );
  }
  return { receiptsDir, secretsDir };
}
function hashPairTokenBinding(options) {
  return createHash3("sha256").update(
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
  const originalStats = statSync6(filePath);
  const contents = readFileSync8(filePath, "utf-8");
  try {
    utimesSync(filePath, originalStats.atime, originalStats.mtime);
  } catch {
  }
  return contents;
}
function loadReceipt(filePath) {
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
      hostId: normalizeString4(parsed.hostId),
      conversationId: parsed.conversationId,
      ownerClientId: normalizeString4(parsed.ownerClientId),
      issuedByClientId: normalizeString4(parsed.issuedByClientId),
      allowedMethods: normalizeMethods(parsed.allowedMethods),
      pairTokenHash: parsed.pairTokenHash,
      createdAt: parsed.createdAt,
      expiresAt: parsed.expiresAt
    };
  } catch {
    return null;
  }
}
function isExpired(receipt, now) {
  const expiresAtMs = new Date(receipt.expiresAt).getTime();
  return Number.isNaN(expiresAtMs) || expiresAtMs <= now.getTime();
}
function resolveSecretPath(secretsDir, receiptId) {
  return join10(secretsDir, `${receiptId}.token`);
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
    throw new TapConsentReceiptError(
      "invalid",
      `Unable to resolve a Windows principal for "${targetPath}".`
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
  throw new TapConsentReceiptError(
    "invalid",
    `Failed to apply Windows ACL hardening to "${targetPath}": ${lastError instanceof Error ? lastError.message : String(lastError)}`
  );
}
function hardenSecretStorePath(targetPath, mode) {
  try {
    chmodSync(targetPath, mode);
  } catch {
  }
  applyWindowsPrivateAcl(targetPath);
}
function stampMintedAt(targetPath, mintedAt) {
  utimesSync(targetPath, mintedAt, mintedAt);
}
function cleanupExpiredReceipts(receiptsDir, secretsDir, now) {
  if (!existsSync9(receiptsDir)) return;
  for (const entry of readdirSync6(receiptsDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const filePath = join10(receiptsDir, entry.name);
    const receipt = loadReceipt(filePath);
    const receiptId = receipt?.id ?? entry.name.replace(/\.json$/i, "");
    if (!receipt || isExpired(receipt, now)) {
      rmSync2(filePath, { force: true });
      rmSync2(resolveSecretPath(secretsDir, receiptId), { force: true });
    }
  }
}
function mintPairToken() {
  return randomBytes(32).toString("base64url");
}
function assertNoLegacyPairTokenInput(options, context) {
  const legacyPairToken = options.pairToken;
  if (typeof legacyPairToken !== "undefined") {
    throw new TapConsentReceiptError(
      "invalid",
      `${context} no longer accepts a caller-provided pairToken.`
    );
  }
}
function createTapConsentReceipt(options) {
  assertNoLegacyPairTokenInput(options, "tap_create_consent_receipt");
  const now = options.now ?? /* @__PURE__ */ new Date();
  const { receiptsDir, secretsDir } = resolveConsentDirs(options);
  const scope = options.scope ?? "drive";
  const conversationId = options.conversationId.trim();
  const ownerClientId = normalizeString4(options.ownerClientId);
  if (!conversationId) {
    throw new TapConsentReceiptError(
      "invalid",
      "Consent receipt requires a non-empty conversationId."
    );
  }
  if (!ownerClientId) {
    throw new TapConsentReceiptError(
      "invalid",
      "Consent receipt requires a non-empty ownerClientId."
    );
  }
  mkdirSync6(receiptsDir, { recursive: true });
  mkdirSync6(secretsDir, { recursive: true, mode: 448 });
  hardenSecretStorePath(secretsDir, 448);
  cleanupExpiredReceipts(receiptsDir, secretsDir, now);
  const ttlSeconds = Math.max(
    1,
    options.ttlSeconds ?? DEFAULT_TAP_CONSENT_TTL_SECONDS
  );
  const hostId = normalizeString4(options.hostId);
  const pairToken = mintPairToken();
  const receipt = {
    id: randomUUID5(),
    scope,
    hostId,
    conversationId,
    ownerClientId,
    issuedByClientId: normalizeString4(options.issuedByClientId),
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
  const filePath = join10(receiptsDir, `${receipt.id}.json`);
  const secretPath = resolveSecretPath(secretsDir, receipt.id);
  const createdAt = new Date(receipt.createdAt);
  try {
    writeFileSync6(secretPath, pairToken, {
      encoding: "utf-8",
      mode: 384
    });
    stampMintedAt(secretPath, createdAt);
    hardenSecretStorePath(secretPath, 384);
    writeFileSync6(filePath, JSON.stringify(receipt, null, 2), "utf-8");
    stampMintedAt(filePath, createdAt);
  } catch (error) {
    rmSync2(secretPath, { force: true });
    rmSync2(filePath, { force: true });
    throw error;
  }
  return { receipt, filePath };
}
function createTapConsentReceiptFromIdentity(identity, options) {
  assertNoLegacyPairTokenInput(options, "tap_create_consent_receipt");
  const ownerTuple = resolveIdentityOwnerTuple(identity);
  const requestedHostId = normalizeString4(options.hostId);
  const requestedConversationId = normalizeString4(options.conversationId);
  const requestedOwnerClientId = normalizeString4(options.ownerClientId);
  assertOwnerBoundOverride("hostId", requestedHostId, ownerTuple.hostId);
  assertOwnerBoundOverride(
    "conversationId",
    requestedConversationId,
    ownerTuple.conversationId
  );
  assertOwnerBoundOverride(
    "ownerClientId",
    requestedOwnerClientId,
    ownerTuple.ownerClientId
  );
  const conversationId = ownerTuple.conversationId;
  if (!conversationId) {
    throw new TapConsentReceiptError(
      "invalid",
      "tap_create_consent_receipt requires an active conversationId. Pass conversationId explicitly or run under a bridge-backed session."
    );
  }
  const ownerClientId = ownerTuple.ownerClientId;
  if (!ownerClientId) {
    throw new TapConsentReceiptError(
      "invalid",
      "tap_create_consent_receipt requires ownerClientId. Pass ownerClientId explicitly or run under a bridge-backed session."
    );
  }
  const created = createTapConsentReceipt({
    receiptsDir: options.receiptsDir,
    secretsDir: options.secretsDir,
    scope: options.scope ?? "drive",
    hostId: ownerTuple.hostId,
    conversationId,
    ownerClientId,
    issuedByClientId: ownerTuple.issuedByClientId,
    ttlSeconds: options.ttlSeconds,
    allowedMethods: options.allowedMethods,
    now: options.now
  });
  writeConsentLedgerEvent({
    commsDir: identity.runtimeEnv.commsDir,
    event: "issued",
    grantId: created.receipt.id,
    scope: created.receipt.scope,
    method: created.receipt.allowedMethods.length === 1 ? created.receipt.allowedMethods[0] : null,
    hostId: created.receipt.hostId,
    conversationId: created.receipt.conversationId,
    issuedAt: created.receipt.createdAt,
    expiresAt: created.receipt.expiresAt,
    result: "granted",
    requester: null,
    owner: {
      hostId: created.receipt.hostId,
      clientId: created.receipt.ownerClientId,
      conversationId: created.receipt.conversationId,
      ownerClientId: created.receipt.ownerClientId
    },
    issuedByClientId: created.receipt.issuedByClientId
  });
  return created;
}

// src/transport/experimental/codex-ipc-control.ts
import { randomUUID as randomUUID7 } from "crypto";

// src/transport/consent.ts
import { createHash as createHash4, randomBytes as randomBytes2, randomUUID as randomUUID6 } from "crypto";
import { execFileSync as execFileSync2 } from "child_process";
import * as fs3 from "fs";
import * as os from "os";
import * as path3 from "path";
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
function normalizeString5(value) {
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
function normalizeMethods2(values) {
  const methods = /* @__PURE__ */ new Set();
  for (const value of values ?? []) {
    const normalized = value.trim();
    if (!normalized) continue;
    methods.add(normalized);
  }
  return [...methods].sort();
}
function normalizePathForComparison2(value) {
  return path3.resolve(value).replace(/\\/g, "/").toLowerCase();
}
function resolveReceiptsDir2(explicitDir) {
  const configuredDir = explicitDir?.trim() || process.env.TAP_CONSENT_RECEIPTS_DIR?.trim();
  return configuredDir ? path3.resolve(configuredDir) : path3.join(os.tmpdir(), CONSENT_RECEIPTS_DIRNAME);
}
function resolveSecretsDir2(explicitDir) {
  const configuredDir = explicitDir?.trim() || process.env.TAP_CONSENT_SECRETS_DIR?.trim();
  return configuredDir ? path3.resolve(configuredDir) : path3.join(os.tmpdir(), CONSENT_SECRETS_DIRNAME);
}
function resolveConsentDirs2(options) {
  const receiptsDir = resolveReceiptsDir2(options.receiptsDir);
  const secretsDir = resolveSecretsDir2(options.secretsDir);
  if (normalizePathForComparison2(receiptsDir) === normalizePathForComparison2(secretsDir)) {
    throw new ConsentReceiptError(
      "invalid",
      "Consent receipts dir and secrets dir must be different paths."
    );
  }
  return { receiptsDir, secretsDir };
}
function hashPairTokenBinding2(options) {
  return createHash4("sha256").update(
    [
      options.pairToken,
      options.hostId ?? "",
      options.conversationId,
      options.ownerClientId ?? ""
    ].join("\0"),
    "utf-8"
  ).digest("hex");
}
function readUtf8PreservingTimes2(filePath) {
  const originalStats = fs3.statSync(filePath);
  const contents = fs3.readFileSync(filePath, "utf-8");
  try {
    fs3.utimesSync(filePath, originalStats.atime, originalStats.mtime);
  } catch {
  }
  return contents;
}
function loadConsentReceipt(filePath) {
  try {
    const parsed = JSON.parse(
      readUtf8PreservingTimes2(filePath)
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
      hostId: normalizeString5(parsed.hostId),
      conversationId: parsed.conversationId,
      ownerClientId: normalizeString5(parsed.ownerClientId),
      issuedByClientId: normalizeString5(parsed.issuedByClientId),
      allowedMethods: normalizeMethods2(parsed.allowedMethods),
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
    const parsed = JSON.parse(readUtf8PreservingTimes2(filePath));
    return {
      receipt: loadConsentReceipt(filePath),
      reservationOwnerId: normalizeString5(parsed.reservationOwnerId)
    };
  } catch {
    return {
      receipt: null,
      reservationOwnerId: null
    };
  }
}
function isExpired2(receipt, now) {
  const expiresAtMs = new Date(receipt.expiresAt).getTime();
  return Number.isNaN(expiresAtMs) || expiresAtMs <= now.getTime();
}
function resolveSecretPath2(secretsDir, receiptId) {
  return path3.join(secretsDir, `${receiptId}.token`);
}
function resolveReservedReceiptPath(receiptsDir, receiptId) {
  return path3.join(receiptsDir, `${receiptId}.reserved.json`);
}
function extractReceiptIdFromPath(filePath) {
  return path3.basename(filePath).replace(/(?:\.reserved)?\.json$/i, "");
}
function isReceiptPath(fileName) {
  return /\.json$/i.test(fileName);
}
function resolveWindowsAclPrincipals2() {
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
function applyWindowsPrivateAcl2(targetPath) {
  if (process.platform !== "win32") return;
  const principals = resolveWindowsAclPrincipals2();
  if (principals.length === 0) {
    throw new ConsentReceiptError(
      "invalid",
      `Unable to resolve a Windows principal for "${path3.basename(targetPath)}".`
    );
  }
  let lastError = null;
  for (const principal of principals) {
    try {
      execFileSync2(
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
    `Failed to apply Windows ACL hardening to "${path3.basename(targetPath)}": ${lastError instanceof Error ? lastError.message : String(lastError)}`
  );
}
function hardenSecretStorePath2(targetPath, mode) {
  try {
    fs3.chmodSync(targetPath, mode);
  } catch {
  }
  applyWindowsPrivateAcl2(targetPath);
}
function hasTimestampDrift(stats, mintedAtMs) {
  if (!Number.isFinite(mintedAtMs)) {
    return false;
  }
  return Math.abs(stats.mtimeMs - mintedAtMs) > CONSENT_METADATA_DRIFT_TOLERANCE_MS || Math.abs(stats.atimeMs - mintedAtMs) > CONSENT_METADATA_DRIFT_TOLERANCE_MS;
}
function stampMintedAt2(targetPath, mintedAt) {
  fs3.utimesSync(targetPath, mintedAt, mintedAt);
}
function stampReservationAt(targetPath, reservedAt) {
  fs3.utimesSync(targetPath, reservedAt, reservedAt);
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
    fs3.rmSync(secretPath, { force: true });
  } catch {
  }
}
function removeReceiptPath(receiptPath) {
  try {
    fs3.rmSync(receiptPath, { force: true });
  } catch {
  }
}
function writeActiveReceiptFile(filePath, receipt) {
  fs3.writeFileSync(filePath, JSON.stringify(receipt, null, 2), "utf-8");
  stampMintedAt2(filePath, resolveReceiptCreatedAt(receipt));
}
function writeReservedReceiptFile(filePath, receipt, reservationOwnerId, reservedAt) {
  fs3.writeFileSync(
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
function cleanupExpiredReceipts2(receiptsDir, secretsDir, now) {
  if (!fs3.existsSync(receiptsDir)) return;
  for (const entry of fs3.readdirSync(receiptsDir, { withFileTypes: true })) {
    if (!entry.isFile() || !isReceiptPath(entry.name)) continue;
    const filePath = path3.join(receiptsDir, entry.name);
    const receipt = loadConsentReceipt(filePath);
    const receiptId = receipt?.id ?? extractReceiptIdFromPath(filePath);
    if (!receipt || isExpired2(receipt, now)) {
      removeReceiptPath(filePath);
      removeSecretPath(resolveSecretPath2(secretsDir, receiptId));
    }
  }
}
function listReceiptPaths(receiptsDir) {
  if (!fs3.existsSync(receiptsDir)) return [];
  return fs3.readdirSync(receiptsDir, { withFileTypes: true }).filter(
    (entry) => entry.isFile() && entry.name.endsWith(".json") && !entry.name.endsWith(".reserved.json")
  ).map((entry) => path3.join(receiptsDir, entry.name)).sort();
}
function scopeSatisfies(actual, required) {
  return SCOPE_PRIORITY[actual] >= SCOPE_PRIORITY[required];
}
function resolveReceiptPath(receiptsDir, consentRef) {
  const normalizedConsentRef = normalizeString5(consentRef);
  if (!normalizedConsentRef) return null;
  return path3.join(receiptsDir, `${normalizedConsentRef}.json`);
}
function reserveReceiptPath(filePath, receipt, reservationOwnerId, now) {
  const reservedPath = resolveReservedReceiptPath(
    path3.dirname(filePath),
    receipt.id
  );
  try {
    fs3.renameSync(filePath, reservedPath);
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
function mintPairToken2() {
  return randomBytes2(32).toString("base64url");
}
function writeSecretFile(secretPath, pairToken, mintedAt) {
  fs3.writeFileSync(secretPath, pairToken, {
    encoding: "utf-8",
    mode: 384
  });
  stampMintedAt2(secretPath, mintedAt);
  hardenSecretStorePath2(secretPath, 384);
}
function assertNoLegacyPairTokenInput2(options, context) {
  const legacyPairToken = options.pairToken;
  if (typeof legacyPairToken !== "undefined") {
    throw new ConsentReceiptError(
      "invalid",
      `${context} no longer accepts a caller-provided pairToken.`
    );
  }
}
function createConsentReceipt(options) {
  assertNoLegacyPairTokenInput2(options, "createConsentReceipt");
  const now = options.now ?? /* @__PURE__ */ new Date();
  const { receiptsDir, secretsDir } = resolveConsentDirs2(options);
  const scope = options.scope ?? "drive";
  const conversationId = options.conversationId.trim();
  if (!conversationId) {
    throw new ConsentReceiptError(
      "invalid",
      "Consent receipt requires a non-empty conversationId."
    );
  }
  fs3.mkdirSync(receiptsDir, { recursive: true });
  fs3.mkdirSync(secretsDir, { recursive: true, mode: 448 });
  hardenSecretStorePath2(secretsDir, 448);
  cleanupExpiredReceipts2(receiptsDir, secretsDir, now);
  const ttlSeconds = Math.max(
    1,
    options.ttlSeconds ?? DEFAULT_CONSENT_TTL_SECONDS
  );
  const receiptId = randomUUID6();
  const hostId = normalizeString5(options.hostId);
  const ownerClientId = normalizeString5(options.ownerClientId);
  const pairToken = mintPairToken2();
  const receipt = {
    id: receiptId,
    scope,
    hostId,
    conversationId,
    ownerClientId,
    issuedByClientId: normalizeString5(options.issuedByClientId),
    allowedMethods: normalizeMethods2(options.allowedMethods),
    pairTokenHash: hashPairTokenBinding2({
      pairToken,
      hostId,
      conversationId,
      ownerClientId
    }),
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + ttlSeconds * 1e3).toISOString()
  };
  const filePath = path3.join(receiptsDir, `${receipt.id}.json`);
  const secretPath = resolveSecretPath2(secretsDir, receipt.id);
  const createdAt = new Date(receipt.createdAt);
  try {
    writeSecretFile(secretPath, pairToken, createdAt);
    fs3.writeFileSync(filePath, JSON.stringify(receipt, null, 2), "utf-8");
    stampMintedAt2(filePath, createdAt);
  } catch (error) {
    removeSecretPath(secretPath);
    removeReceiptPath(filePath);
    throw error;
  }
  return { receipt, filePath };
}
function prepareConsentReceipt(options) {
  assertNoLegacyPairTokenInput2(options, "consumeConsentReceipt");
  const now = options.now ?? /* @__PURE__ */ new Date();
  const { receiptsDir, secretsDir } = resolveConsentDirs2(options);
  cleanupExpiredReceipts2(receiptsDir, secretsDir, now);
  const requiredScope = options.requiredScope ?? "drive";
  const method = normalizeString5(options.method);
  const conversationId = options.conversationId.trim();
  const ownerClientId = normalizeString5(options.ownerClientId);
  const hostId = normalizeString5(options.hostId);
  const reservationOwnerId = normalizeString5(options.reservationOwnerId);
  const explicitConsentRef = normalizeString5(options.consentRef);
  if (!conversationId) {
    throw new ConsentReceiptError(
      "invalid",
      "Consent receipt consumption requires a conversationId."
    );
  }
  const explicitPath = resolveReceiptPath(receiptsDir, explicitConsentRef);
  const explicitReservedPath = explicitConsentRef ? resolveReservedReceiptPath(receiptsDir, explicitConsentRef) : null;
  const reservedConsentRef = explicitConsentRef;
  if (reservedConsentRef && explicitPath && explicitReservedPath && !fs3.existsSync(explicitPath) && fs3.existsSync(explicitReservedPath)) {
    assertPendingReservationAvailable(reservedConsentRef);
    const reservedRecord = loadReservedReceiptRecord(explicitReservedPath);
    const reservedReceipt = reservedRecord.receipt;
    const reservedReceiptId = reservedReceipt?.id ?? extractReceiptIdFromPath(explicitReservedPath);
    if (!reservedReceipt || isExpired2(reservedReceipt, now)) {
      removeReceiptPath(explicitReservedPath);
      removeSecretPath(resolveSecretPath2(secretsDir, reservedReceiptId));
    } else if (reservationOwnerId && reservedRecord.reservationOwnerId === reservationOwnerId && isReservationExpired(fs3.statSync(explicitReservedPath), now)) {
      fs3.renameSync(explicitReservedPath, explicitPath);
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
    if (!fs3.existsSync(filePath)) {
      if (explicitPath && explicitReservedPath && fs3.existsSync(explicitReservedPath)) {
        throw new ConsentReceiptError(
          "missing",
          `Consent receipt "${explicitConsentRef}" is already reserved or consumed.`
        );
      }
      continue;
    }
    const receiptStats = fs3.statSync(filePath);
    const receipt = loadConsentReceipt(filePath);
    if (!receipt) {
      removeReceiptPath(filePath);
      removeSecretPath(
        resolveSecretPath2(secretsDir, extractReceiptIdFromPath(filePath))
      );
      continue;
    }
    if (isExpired2(receipt, now)) {
      removeReceiptPath(filePath);
      removeSecretPath(resolveSecretPath2(secretsDir, receipt.id));
      if (explicitPath) {
        throw new ConsentReceiptError(
          "expired",
          `Consent receipt "${receipt.id}" expired at ${receipt.expiresAt}.`
        );
      }
      continue;
    }
    const secretPath = resolveSecretPath2(secretsDir, receipt.id);
    if (!fs3.existsSync(secretPath)) {
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
      const secretStats = fs3.statSync(secretPath);
      assertUntamperedConsentPath(secretStats, receipt, "secret");
      const pairToken = readUtf8PreservingTimes2(secretPath).trim();
      if (!pairToken) {
        throw new ConsentReceiptError(
          "invalid",
          `Consent secret "${receipt.id}" was empty.`
        );
      }
      const expectedHash = hashPairTokenBinding2({
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
            fs3.rmSync(reservedReceiptPath, { force: false });
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
            fs3.renameSync(reservedReceiptPath, filePath);
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
function normalizeAddress3(value) {
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
    this.reservationOwnerId = options.reservationOwnerId?.trim() || randomUUID7();
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
    return await new Promise((resolve8) => {
      let unsubscribe = null;
      const timeout = setTimeout(() => {
        unsubscribe?.();
        resolve8(this.getConversationSnapshot(conversationId));
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
        resolve8(
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
      id: randomUUID7(),
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
      return normalizeAddress3(conversation.address);
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

// packages/tap-plugin/channels/tap-drive-routing.ts
init_tap_message_prompt();

// src/codex-a2a/binding-registry.ts
init_receive_transports();
var DEFAULT_STALE_AFTER_MS = 30 * 60 * 1e3;
var HEALTH_SEVERITY2 = {
  "stuck-turn": 90,
  "stale-owner": 80,
  "stale-active-turn": 75,
  "active-turn": 70,
  partial: 60,
  "adapter-unavailable": 50,
  degraded: 40,
  "not-observed": 30,
  unknown: 20,
  ready: 10
};
var HEALTH_STATUSES = new Set(
  Object.keys(HEALTH_SEVERITY2)
);
function normalizeString6(value) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}
function normalizeToken(value) {
  return normalizeString6(value)?.replace(/-/g, "_").toLowerCase() ?? null;
}
function isCodexLike(value) {
  const token = normalizeToken(value);
  return token === "codex" || Boolean(token?.startsWith("codex_"));
}
function toTime(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : Date.now();
  }
  return Date.now();
}
function normalizeAliases(values) {
  const aliases = [];
  for (const value of values) {
    const normalized = normalizeString6(value);
    if (!normalized || aliases.includes(normalized)) continue;
    aliases.push(normalized);
  }
  return aliases;
}
function metadataString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
function normalizeRuntimeHealth(value) {
  if (!value || typeof value !== "object") return null;
  const status = typeof value.status === "string" && HEALTH_STATUSES.has(value.status) ? value.status : null;
  if (!status) return null;
  return {
    status,
    reason: normalizeString6(value.reason),
    checkedAt: normalizeString6(value.checkedAt),
    adapter: normalizeString6(value.adapter),
    recovery: normalizeString6(value.recovery)
  };
}
function runtimeHealthTime(value) {
  const parsed = Date.parse(value.checkedAt ?? "");
  return Number.isFinite(parsed) ? parsed : 0;
}
function mergeRuntimeHealth2(existing, next) {
  if (!existing) return next;
  if (!next) return existing;
  const severityDelta = HEALTH_SEVERITY2[next.status] - HEALTH_SEVERITY2[existing.status];
  if (severityDelta > 0) return next;
  if (severityDelta < 0) return existing;
  const existingTime = runtimeHealthTime(existing);
  const nextTime = runtimeHealthTime(next);
  if (nextTime > existingTime) return next;
  return existing;
}
function deriveStaleReason(options) {
  const status = normalizeString6(options.status);
  if (status && status !== "active") {
    return `status:${status}`;
  }
  if (!options.lastSeenAt) {
    return "missing-last-seen";
  }
  const lastSeenMs = Date.parse(options.lastSeenAt);
  if (!Number.isFinite(lastSeenMs)) {
    return "invalid-last-seen";
  }
  const ageMs = options.nowMs - lastSeenMs;
  if (ageMs > options.staleAfterMs) {
    return `stale:${ageMs}ms`;
  }
  return null;
}
function bindingKey(binding) {
  return [
    binding.routingAddress,
    binding.hostId ?? "",
    binding.clientId ?? "",
    binding.conversationId ?? "",
    binding.ownerClientId ?? ""
  ].join("\0");
}
function mergeBinding(existing, next) {
  const nextIsLiveObserve = next.sources.includes("observe") && next.staleReason === null;
  return {
    ...existing,
    agentName: existing.agentName ?? next.agentName,
    hostId: existing.hostId ?? next.hostId,
    clientId: existing.clientId ?? next.clientId,
    conversationId: existing.conversationId ?? next.conversationId,
    ownerClientId: existing.ownerClientId ?? next.ownerClientId,
    instanceId: existing.instanceId ?? next.instanceId,
    receiveTransports: normalizeReceiveTransports([
      ...existing.receiveTransports,
      ...next.receiveTransports
    ]),
    bindingStatus: existing.bindingStatus === "ready" || next.bindingStatus === "ready" ? "ready" : existing.bindingStatus === "partial" || next.bindingStatus === "partial" ? "partial" : "stale",
    lastSeenAt: nextIsLiveObserve ? next.lastSeenAt ?? existing.lastSeenAt : existing.lastSeenAt ?? next.lastSeenAt,
    staleReason: nextIsLiveObserve ? null : existing.staleReason ?? next.staleReason,
    health: mergeRuntimeHealth2(existing.health, next.health),
    sources: [.../* @__PURE__ */ new Set([...existing.sources, ...next.sources])],
    aliases: normalizeAliases([...existing.aliases, ...next.aliases])
  };
}
function shouldIncludeHeartbeatBinding(heartbeat, receiveTransports) {
  return receiveTransports.includes("consent-drive") || isCodexLike(heartbeat.instanceId) || isCodexLike(heartbeat.address?.clientId) || isCodexLike(heartbeat.address?.routingAddress) || isCodexLike(heartbeat.source);
}
function buildHeartbeatBinding(key, heartbeat, nowMs, staleAfterMs) {
  const receiveTransports = normalizeReceiveTransports([
    ...heartbeat.receiveTransports ?? [],
    ...heartbeat.capabilities?.receiveTransports ?? []
  ]);
  if (!shouldIncludeHeartbeatBinding(heartbeat, receiveTransports)) {
    return null;
  }
  const id = normalizeString6(heartbeat.id) ?? key;
  const routingAddress = normalizeString6(heartbeat.address?.routingAddress) ?? normalizeString6(heartbeat.instanceId) ?? id;
  const lastSeenAt = normalizeString6(heartbeat.lastActivity) ?? normalizeString6(heartbeat.timestamp);
  const conversationId = normalizeString6(heartbeat.capabilities?.conversationId) ?? normalizeString6(heartbeat.address?.conversationId);
  const ownerClientId = normalizeString6(heartbeat.capabilities?.ownerClientId) ?? normalizeString6(heartbeat.address?.ownerClientId);
  const bindingStatus = deriveBindingStatus({
    conversationId,
    ownerClientId,
    staleReason: deriveStaleReason({
      status: heartbeat.status,
      lastSeenAt,
      nowMs,
      staleAfterMs
    })
  });
  return {
    agentName: normalizeString6(heartbeat.agent),
    routingAddress,
    runtime: "codex",
    hostId: normalizeString6(heartbeat.address?.hostId),
    clientId: normalizeString6(heartbeat.address?.clientId) ?? normalizeString6(heartbeat.instanceId),
    conversationId,
    ownerClientId,
    instanceId: normalizeString6(heartbeat.instanceId),
    receiveTransports,
    lastSeenAt,
    staleReason: bindingStatus === "stale" ? deriveStaleReason({
      status: heartbeat.status,
      lastSeenAt,
      nowMs,
      staleAfterMs
    }) : null,
    health: normalizeRuntimeHealth(heartbeat.health),
    bindingStatus,
    sources: ["heartbeat"],
    aliases: normalizeAliases([
      id,
      heartbeat.agent,
      routingAddress,
      heartbeat.instanceId,
      ...heartbeat.address?.aliases ?? []
    ])
  };
}
function findAgentNameForClient(snapshot, clientId) {
  if (!clientId) return null;
  const agent = snapshot.agents.find((candidate) => candidate.id === clientId);
  return agent?.name ?? null;
}
function buildObserveBindings(snapshot, nowIso) {
  if (!snapshot.connected) {
    return [];
  }
  const bindings = [];
  for (const conversation of snapshot.conversations) {
    const ownerClientId = normalizeString6(conversation.address.ownerClientId);
    const conversationId = normalizeString6(conversation.id);
    if (!ownerClientId || !conversationId) continue;
    const metadata = conversation.metadata;
    const lastSeenAt = metadataString(metadata.lastActivity) ?? nowIso;
    const routingAddress = normalizeString6(conversation.address.clientId) ?? ownerClientId;
    bindings.push({
      agentName: findAgentNameForClient(snapshot, ownerClientId),
      routingAddress,
      runtime: "codex",
      hostId: normalizeString6(conversation.address.hostId),
      clientId: normalizeString6(conversation.address.clientId) ?? ownerClientId,
      conversationId,
      ownerClientId,
      instanceId: null,
      receiveTransports: ["consent-drive"],
      bindingStatus: "ready",
      lastSeenAt,
      staleReason: null,
      health: null,
      sources: ["observe"],
      aliases: normalizeAliases([routingAddress, ownerClientId])
    });
  }
  return bindings;
}
function buildCodexBindingRegistry(options = {}) {
  const nowMs = toTime(options.now);
  const nowIso = new Date(nowMs).toISOString();
  const staleAfterMs = options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
  const byKey = /* @__PURE__ */ new Map();
  for (const [key, heartbeat] of Object.entries(options.heartbeats ?? {})) {
    const binding = buildHeartbeatBinding(key, heartbeat, nowMs, staleAfterMs);
    if (!binding) continue;
    const existing = byKey.get(bindingKey(binding));
    byKey.set(
      bindingKey(binding),
      existing ? mergeBinding(existing, binding) : binding
    );
  }
  if (options.observeSnapshot) {
    for (const binding of buildObserveBindings(
      options.observeSnapshot,
      nowIso
    )) {
      const existing = byKey.get(bindingKey(binding));
      byKey.set(
        bindingKey(binding),
        existing ? mergeBinding(existing, binding) : binding
      );
    }
  }
  return {
    bindings: [...byKey.values()].sort(
      (a, b) => a.routingAddress.localeCompare(b.routingAddress)
    ),
    builtAt: nowIso,
    staleAfterMs
  };
}
function deriveBindingStatus(options) {
  if (options.staleReason) return "stale";
  if (options.conversationId && options.ownerClientId) return "ready";
  if (options.conversationId || options.ownerClientId) return "partial";
  return "partial";
}
function matchesTarget(binding, target) {
  const requestedAddress = normalizeString6(target.routingAddress);
  const requestedAgent = normalizeString6(target.agentName);
  if (requestedAddress && binding.routingAddress !== requestedAddress && !binding.aliases.includes(requestedAddress)) {
    return false;
  }
  if (requestedAgent && binding.agentName !== requestedAgent && !binding.aliases.includes(requestedAgent)) {
    return false;
  }
  const constraints = [
    [target.hostId, binding.hostId],
    [target.clientId, binding.clientId],
    [target.conversationId, binding.conversationId],
    [target.ownerClientId, binding.ownerClientId]
  ];
  return constraints.every(([requested, actual]) => {
    const normalizedRequested = normalizeString6(requested);
    return !normalizedRequested || normalizedRequested === actual;
  });
}
function hasExplicitTargetSelector(target) {
  return Boolean(
    normalizeString6(target.routingAddress) || normalizeString6(target.agentName) || normalizeString6(target.clientId) || normalizeString6(target.conversationId) || normalizeString6(target.ownerClientId)
  );
}
function liveSnapshotMatches(binding, snapshot) {
  if (!snapshot || !binding.conversationId || !binding.ownerClientId) {
    return true;
  }
  if (!snapshot.connected) {
    return false;
  }
  return snapshot.conversations.some((conversation) => {
    const address = conversation.address;
    return conversation.id === binding.conversationId && address.ownerClientId === binding.ownerClientId && (!binding.hostId || !address.hostId || address.hostId === binding.hostId);
  });
}
function toAddress(binding) {
  return {
    hostId: binding.hostId,
    clientId: binding.clientId,
    conversationId: binding.conversationId,
    ownerClientId: binding.ownerClientId
  };
}
function blocked(reason, candidates, message) {
  return {
    status: "blocked",
    reason,
    candidates,
    message
  };
}
function resolveCodexBinding(options) {
  if (!hasExplicitTargetSelector(options.target)) {
    return blocked(
      "missing-target",
      [],
      "Codex binding resolution requires an explicit target selector."
    );
  }
  const candidates = options.registry.bindings.filter(
    (binding) => matchesTarget(binding, options.target)
  );
  if (candidates.length === 0) {
    return blocked("not-found", [], "No Codex binding matched the target.");
  }
  const freshCandidates = candidates.filter((binding) => !binding.staleReason);
  if (freshCandidates.length === 0) {
    return blocked("stale", candidates, "Only stale Codex bindings matched.");
  }
  const readyCandidates = freshCandidates.filter(
    (binding) => binding.bindingStatus === "ready"
  );
  if (readyCandidates.length === 0) {
    return blocked(
      "partial",
      freshCandidates,
      "Only partial Codex bindings matched; conversationId and ownerClientId are both required."
    );
  }
  const liveCandidates = readyCandidates.filter(
    (binding) => liveSnapshotMatches(binding, options.liveSnapshot)
  );
  if (liveCandidates.length === 0) {
    return blocked(
      "binding-mismatch",
      freshCandidates,
      "Matched Codex bindings were not present in the live observe snapshot."
    );
  }
  const reachableCandidates = liveCandidates.filter(
    (binding) => canUseConsentDriveForAddress({
      localHostId: options.localHostId,
      address: toAddress(binding)
    })
  );
  if (reachableCandidates.length === 0) {
    return blocked(
      "not-reachable",
      liveCandidates,
      "Matched Codex bindings are not reachable from the local host."
    );
  }
  if (reachableCandidates.length > 1) {
    return blocked(
      "ambiguous",
      reachableCandidates,
      "Multiple fresh Codex bindings matched the target."
    );
  }
  return {
    status: "resolved",
    binding: reachableCandidates[0]
  };
}

// src/transport/trusted-device-lease.ts
import * as fs4 from "fs";
import * as path4 from "path";
var TRUSTED_DEVICE_LEASES_DIRNAME = "devices";
function normalizeString7(value) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}
function normalizeArray(value) {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value.filter((item) => typeof item === "string").map((item) => item.trim()).filter(Boolean)
    )
  ].sort();
}
function normalizeScopeArray(value) {
  return normalizeArray(value).filter(
    (item) => item === "observe" || item === "suggest" || item === "drive"
  );
}
function normalizeComparable(value) {
  const normalized = normalizeString7(value);
  return normalized ? normalized.replace(/\\/g, "/").toLowerCase() : null;
}
function normalizeDate(value) {
  if (value instanceof Date) return value;
  if (typeof value === "string" || typeof value === "number") {
    return new Date(value);
  }
  return /* @__PURE__ */ new Date();
}
function parseTimestamp(value) {
  const timestamp = new Date(value).getTime();
  return Number.isNaN(timestamp) ? null : timestamp;
}
function fail(reason, message, lease = null, filePath = null) {
  return { ok: false, reason, message, lease, filePath };
}
function pass(lease, filePath) {
  return { ok: true, reason: null, message: null, lease, filePath };
}
function resolveTrustedDeviceLeasesDir(options) {
  const explicit = normalizeString7(options.devicesDir);
  if (explicit) return path4.resolve(explicit);
  const commsDir = normalizeString7(options.commsDir) ?? normalizeString7(process.env.TAP_COMMS_DIR);
  return commsDir ? path4.join(path4.resolve(commsDir), TRUSTED_DEVICE_LEASES_DIRNAME) : null;
}
function parseTrustedDeviceLease(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value;
  const deviceId = typeof record.deviceId === "string" ? normalizeString7(record.deviceId) : null;
  const hostId = typeof record.hostId === "string" ? normalizeString7(record.hostId) : null;
  const issuedAt = typeof record.issuedAt === "string" ? normalizeString7(record.issuedAt) : null;
  const expiresAt = typeof record.expiresAt === "string" ? normalizeString7(record.expiresAt) : null;
  const publicKeyHash = typeof record.publicKeyHash === "string" ? normalizeString7(record.publicKeyHash) : null;
  const tokenHash = typeof record.tokenHash === "string" ? normalizeString7(record.tokenHash) : null;
  if (!deviceId || !hostId || !issuedAt || !expiresAt) {
    return null;
  }
  if (!publicKeyHash && !tokenHash) {
    return null;
  }
  return {
    deviceId,
    hostId,
    label: typeof record.label === "string" ? normalizeString7(record.label) : null,
    publicKeyHash,
    tokenHash,
    operator: typeof record.operator === "string" ? normalizeString7(record.operator) : null,
    allowedScopes: normalizeScopeArray(record.allowedScopes),
    allowedTargets: normalizeArray(record.allowedTargets),
    issuedAt,
    expiresAt,
    lastSeenAt: typeof record.lastSeenAt === "string" ? normalizeString7(record.lastSeenAt) : null,
    revokedAt: typeof record.revokedAt === "string" ? normalizeString7(record.revokedAt) : null
  };
}
function loadTrustedDeviceLease(filePath) {
  try {
    return parseTrustedDeviceLease(
      JSON.parse(fs4.readFileSync(filePath, "utf-8"))
    );
  } catch {
    return null;
  }
}
function listLeaseFiles(devicesDir) {
  try {
    return fs4.readdirSync(devicesDir, { withFileTypes: true }).filter((entry) => entry.isFile() && entry.name.endsWith(".json")).map((entry) => path4.join(devicesDir, entry.name)).sort();
  } catch {
    return [];
  }
}
function matchesLease(lease, options) {
  const expectedDeviceId = normalizeComparable(options.deviceId);
  const expectedHostId = normalizeComparable(options.hostId);
  const deviceMatches = expectedDeviceId ? normalizeComparable(lease.deviceId) === expectedDeviceId : true;
  const hostMatches = expectedHostId ? normalizeComparable(lease.hostId) === expectedHostId : true;
  return Boolean(
    (expectedDeviceId || expectedHostId) && deviceMatches && hostMatches
  );
}
function validateLease(lease, filePath, options) {
  const nowMs = options.now.getTime();
  const issuedAtMs = parseTimestamp(lease.issuedAt);
  const expiresAtMs = parseTimestamp(lease.expiresAt);
  if (Number.isNaN(nowMs) || issuedAtMs === null || expiresAtMs === null || lease.revokedAt && parseTimestamp(lease.revokedAt) === null) {
    return fail(
      "invalid",
      "Trusted device lease has invalid timestamps.",
      lease,
      filePath
    );
  }
  if (issuedAtMs > nowMs) {
    return fail(
      "not-yet-valid",
      "Trusted device lease is not valid yet.",
      lease,
      filePath
    );
  }
  if (expiresAtMs <= nowMs) {
    return fail("expired", "Trusted device lease is expired.", lease, filePath);
  }
  if (lease.revokedAt) {
    return fail("revoked", "Trusted device lease is revoked.", lease, filePath);
  }
  if (!lease.allowedScopes.includes(options.scope)) {
    return fail(
      "scope-not-allowed",
      `Trusted device lease does not allow ${options.scope}.`,
      lease,
      filePath
    );
  }
  if (!lease.allowedTargets.includes(options.target)) {
    return fail(
      "target-not-allowed",
      `Trusted device lease does not allow target ${options.target}.`,
      lease,
      filePath
    );
  }
  return pass(lease, filePath);
}
function checkTrustedDeviceLease(options) {
  const devicesDir = resolveTrustedDeviceLeasesDir(options);
  if (!devicesDir) {
    return fail(
      "registry-unavailable",
      "Trusted device lease registry is unavailable."
    );
  }
  const deviceId = normalizeString7(options.deviceId);
  const hostId = normalizeString7(options.hostId);
  if (!deviceId && !hostId) {
    return fail(
      "missing",
      "Trusted device lease check requires deviceId or hostId."
    );
  }
  let invalidMatch = null;
  for (const filePath of listLeaseFiles(devicesDir)) {
    const lease = loadTrustedDeviceLease(filePath);
    if (!lease) continue;
    if (!matchesLease(lease, { deviceId, hostId })) continue;
    const checked = validateLease(lease, filePath, {
      scope: options.scope ?? "drive",
      target: normalizeString7(options.target) ?? "self-owned",
      now: normalizeDate(options.now)
    });
    if (checked.ok) return checked;
    invalidMatch ??= checked;
  }
  return invalidMatch ?? fail("missing", "No matching trusted device lease was found.");
}
function checkTrustedDeviceLeaseGate(options) {
  const scope = options.scope ?? "drive";
  const target = normalizeString7(options.target) ?? "self-owned";
  const requester = checkTrustedDeviceLease({
    commsDir: options.commsDir,
    devicesDir: options.devicesDir,
    deviceId: options.requesterDeviceId,
    hostId: options.requesterHostId,
    scope,
    target,
    now: options.now
  });
  if (!requester.ok) {
    return {
      ok: false,
      reason: requester.reason,
      message: `Requester ${requester.message ?? "trusted device lease check failed"}`,
      requester,
      target: null
    };
  }
  const requesterHostId = normalizeComparable(requester.lease?.hostId);
  const targetHostId = normalizeComparable(options.targetHostId);
  if (!targetHostId || targetHostId === requesterHostId) {
    return {
      ok: true,
      reason: null,
      message: null,
      requester,
      target: null
    };
  }
  const targetCheck = checkTrustedDeviceLease({
    commsDir: options.commsDir,
    devicesDir: options.devicesDir,
    deviceId: options.targetDeviceId,
    hostId: options.targetHostId,
    scope,
    target,
    now: options.now
  });
  if (!targetCheck.ok) {
    return {
      ok: false,
      reason: targetCheck.reason,
      message: `Target ${targetCheck.message ?? "trusted device lease check failed"}`,
      requester,
      target: targetCheck
    };
  }
  return {
    ok: true,
    reason: null,
    message: null,
    requester,
    target: targetCheck
  };
}

// packages/tap-plugin/channels/tap-drive-routing.ts
init_receive_transports();
import { spawn } from "child_process";
function defaultTransportFactory(options) {
  return new ExperimentalCodexIpcControlTransport({
    commsDir: options.commsDir,
    hostId: options.hostId ?? null
  });
}
function normalizeString8(value) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}
function normalizeHostKey(value) {
  return normalizeString8(value)?.toLowerCase() ?? null;
}
function normalizeStringArray(value) {
  if (typeof value === "string") {
    const normalized2 = normalizeString8(value);
    return normalized2 ? [normalized2] : [];
  }
  if (!Array.isArray(value)) return [];
  const normalized = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const entry = normalizeString8(item);
    if (entry) normalized.push(entry);
  }
  return normalized;
}
function normalizeRemoteConfig(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value;
  const sshTarget = typeof record.sshTarget === "string" ? normalizeString8(record.sshTarget) : typeof record.ssh === "string" ? normalizeString8(record.ssh) : null;
  const platformDir = typeof record.platformDir === "string" ? normalizeString8(record.platformDir) : typeof record.repo === "string" ? normalizeString8(record.repo) : null;
  if (!sshTarget || !platformDir) return null;
  return {
    sshTarget,
    platformDir,
    commsDir: typeof record.commsDir === "string" ? normalizeString8(record.commsDir) : null,
    nodeCommand: typeof record.nodeCommand === "string" ? normalizeString8(record.nodeCommand) : null,
    helperPath: typeof record.helperPath === "string" ? normalizeString8(record.helperPath) : null,
    hostAliases: [
      ...normalizeStringArray(record.hostAliases),
      ...normalizeStringArray(record.aliases),
      ...typeof record.hostId === "string" ? normalizeStringArray(record.hostId) : []
    ]
  };
}
function parseRemoteCodexHosts(raw) {
  const normalized = normalizeString8(raw);
  if (!normalized) return {};
  try {
    const parsed = JSON.parse(normalized);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const configs = {};
    const entries = [];
    for (const [hostId, value] of Object.entries(
      parsed
    )) {
      const key = normalizeHostKey(hostId);
      const config = normalizeRemoteConfig(value);
      if (!key || !config) continue;
      configs[key] = config;
      entries.push({ key, config });
    }
    for (const { key, config } of entries) {
      for (const alias of config.hostAliases ?? []) {
        const aliasKey = normalizeHostKey(alias);
        if (!aliasKey || aliasKey === key || configs[aliasKey]) continue;
        configs[aliasKey] = config;
      }
    }
    return configs;
  } catch {
    return {};
  }
}
function resolveRemoteHostConfig(hostId, explicit) {
  const key = normalizeHostKey(hostId);
  if (!key) return null;
  return explicit?.[key] ?? parseRemoteCodexHosts(process.env.TAP_CODEX_REMOTE_HOSTS)[key] ?? null;
}
function defaultRemoteHelperPath(config) {
  const base = config.platformDir.replace(/[\\/]+$/, "");
  return `${base}/packages/tap-comms/dist/bridges/codex-remote-ipc-relay.mjs`;
}
function parseRemoteRelayProcessResult(result) {
  const stdout = result.stdout.trim();
  const stderr = result.stderr?.trim() ?? "";
  const exitCode = result.exitCode ?? 0;
  if (stdout) {
    try {
      const parsed = JSON.parse(stdout);
      if (parsed.ok) {
        return {
          turnId: normalizeString8(parsed.turnId),
          consentRef: normalizeString8(parsed.consentRef)
        };
      }
      throw new Error(parsed.error || "remote relay returned failure");
    } catch (error) {
      if (error instanceof SyntaxError) {
        if (exitCode === 0) {
          throw new Error(
            `remote relay returned invalid JSON: ${error.message}`
          );
        }
      } else {
        throw error;
      }
    }
  }
  if (exitCode !== 0) {
    throw new Error(
      `ssh relay exited ${exitCode ?? "unknown"}${stderr ? `: ${stderr}` : ""}`
    );
  }
  throw new Error("remote relay returned empty output");
}
async function defaultRemoteRelayExecutor(input) {
  const nodeCommand = input.config.nodeCommand?.trim() || "node";
  const helperPath = input.config.helperPath?.trim() || defaultRemoteHelperPath(input.config);
  const payload = JSON.stringify({
    commsDir: input.config.commsDir ?? null,
    hostId: input.target.hostId,
    conversationId: input.target.conversationId,
    ownerClientId: input.target.ownerClientId,
    text: input.text
  });
  const output = await new Promise((resolve8, reject) => {
    const child = spawn(
      "ssh",
      [input.config.sshTarget, nodeCommand, helperPath],
      {
        stdio: ["pipe", "pipe", "pipe"]
      }
    );
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve8({ stdout, stderr, exitCode: code });
    });
    child.stdin.end(payload);
  });
  return parseRemoteRelayProcessResult(output);
}
function extractTurnId(result) {
  const payload = result.response?.result && typeof result.response.result === "object" && !Array.isArray(result.response.result) ? result.response.result : null;
  const direct = payload?.turn && typeof payload.turn === "object" && !Array.isArray(payload.turn) ? payload.turn.id : null;
  if (typeof direct === "string" && direct.trim()) {
    return direct.trim();
  }
  const nestedResult = payload?.result && typeof payload.result === "object" && !Array.isArray(payload.result) ? payload.result : null;
  const nested = nestedResult?.turn && typeof nestedResult.turn === "object" && !Array.isArray(nestedResult.turn) ? nestedResult.turn.id : null;
  if (typeof nested === "string" && nested.trim()) {
    return nested.trim();
  }
  return null;
}
function buildDriveFallbackResult(warning) {
  return {
    transport: "mcp-channel",
    delivered: false,
    fallbackToInbox: true,
    turnId: null,
    consentRef: null,
    warning
  };
}
function buildRuntimeHealthFallbackWarning(routingAddress, health) {
  if (health.status === "ready") return null;
  const reason = health.reason ? ` (${health.reason})` : "";
  const recovery = health.recovery ? ` Recovery: ${health.recovery}.` : health.status === "stale-owner" ? " Recovery: Run tap_register_capabilities from the target runtime with the conversationId and omit ownerClientId." : health.status === "partial" ? " Recovery: Register a complete conversationId + ownerClientId tuple before retrying." : "";
  return `\u26A0\uFE0F ${routingAddress} prefers consent-drive but runtime health is ${health.status}${reason}.${recovery} Falling back to inbox delivery.`;
}
function buildRuntimeHealthFallbackResult(routingAddress, health) {
  if (!health) return null;
  const warning = buildRuntimeHealthFallbackWarning(routingAddress, health);
  return warning ? buildDriveFallbackResult(warning) : null;
}
function formatStaleBindingRecovery(routingAddress, candidates) {
  const [candidate] = candidates;
  const detail = candidate ? ` lastSeenAt=${candidate.lastSeenAt ?? "unknown"}; staleReason=${candidate.staleReason ?? "unknown"}; hostId=${candidate.hostId ?? "unknown"}.` : "";
  return `\u26A0\uFE0F ${routingAddress} prefers consent-drive and is visible, but only stale-visible Codex presence matched; it is not fresh-for-routing.` + detail + " Recovery: run tap:presence-publish -- --check-only from the hub to confirm whether the target runtime needs warm-up or only central publication; then warm up the target runtime if needed, publish fresh presence, and retry. Falling back to inbox delivery.";
}
function isNoClientFoundError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("no-client-found");
}
function isRecipientActiveTurnError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("active in-progress turn") || message.includes("recipient-active-turn");
}
function trustedDeviceLeaseGateEnabled(options) {
  if (options.trustedDeviceLeases?.enabled !== void 0) {
    return options.trustedDeviceLeases.enabled;
  }
  const normalized = process.env.TAP_CONSENT_TRUSTED_DEVICE_LEASES?.trim().toLowerCase();
  return Boolean(
    normalized && !["0", "false", "no", "off"].includes(normalized)
  );
}
function formatTrustedDeviceLeaseWarning(routingAddress, gate) {
  const reason = gate.reason ? ` (${gate.reason})` : "";
  const message = gate.message ? ` ${gate.message}` : "";
  return `\u26A0\uFE0F ${routingAddress} prefers consent-drive but trusted-device lease verification failed${reason}.${message} Falling back to inbox delivery.`;
}
function writeTrustedDeviceLeaseRejection(options) {
  writeConsentLedgerEvent({
    commsDir: options.route.commsDir,
    event: "rejected",
    grantId: null,
    scope: "drive",
    method: "thread-follower-start-turn",
    hostId: options.hostId,
    conversationId: options.conversationId,
    recordedAt: (/* @__PURE__ */ new Date()).toISOString(),
    result: `trusted-device-lease-${options.reason ?? "rejected"}`,
    requester: {
      hostId: options.route.trustedDeviceLeases?.requesterHostId ?? options.route.localHostId ?? null,
      clientId: options.route.sender.routingAddress
    },
    owner: {
      hostId: options.hostId,
      conversationId: options.conversationId,
      ownerClientId: options.ownerClientId
    }
  });
}
function checkTrustedDeviceLeaseForRoute(options) {
  if (!trustedDeviceLeaseGateEnabled(options.route)) {
    return null;
  }
  const gate = checkTrustedDeviceLeaseGate({
    commsDir: options.route.commsDir,
    devicesDir: options.route.trustedDeviceLeases?.devicesDir,
    requesterDeviceId: options.route.trustedDeviceLeases?.requesterDeviceId,
    requesterHostId: options.route.trustedDeviceLeases?.requesterHostId ?? options.route.localHostId,
    targetDeviceId: options.route.trustedDeviceLeases?.targetDeviceId,
    targetHostId: options.targetHostId,
    scope: "drive",
    target: "self-owned",
    now: options.route.now
  });
  if (gate.ok) {
    return null;
  }
  if (!options.route.dryRun) {
    writeTrustedDeviceLeaseRejection({
      route: options.route,
      hostId: options.targetHostId,
      conversationId: options.conversationId,
      ownerClientId: options.ownerClientId,
      reason: gate.reason
    });
  }
  return buildDriveFallbackResult(
    formatTrustedDeviceLeaseWarning(options.route.target.routingAddress, gate)
  );
}
function sameHost(bindingHostId, localHostId) {
  const bindingHost = normalizeHostKey(bindingHostId);
  const localHost = normalizeHostKey(localHostId);
  return !bindingHost || !localHost || bindingHost === localHost;
}
async function refreshLocalOwnerBinding(binding, options) {
  const conversationId = binding.conversationId?.trim();
  if (!conversationId || !sameHost(binding.hostId, options.localHostId)) {
    return null;
  }
  const hostId = binding.hostId?.trim() || options.localHostId?.trim() || null;
  const discovery = await (options.ownerDiscovery ?? discoverCodexOwnerClientId)({
    conversationId,
    hostId
  });
  if (discovery.status !== "found") {
    return null;
  }
  return {
    ...binding,
    hostId: discovery.hostId ?? hostId,
    clientId: discovery.ownerClientId,
    ownerClientId: discovery.ownerClientId,
    bindingStatus: "ready",
    staleReason: null,
    health: {
      status: "ready",
      reason: "owner-discovery-refresh",
      checkedAt: (/* @__PURE__ */ new Date()).toISOString(),
      adapter: "codex-owner-discovery",
      recovery: null
    },
    sources: [.../* @__PURE__ */ new Set([...binding.sources, "observe"])],
    aliases: [.../* @__PURE__ */ new Set([...binding.aliases, discovery.ownerClientId])]
  };
}
async function routeTapReplyDelivery(options) {
  if (options.explicitEnvelope) {
    return buildDriveFallbackResult(
      `\u26A0\uFE0F ${options.target.routingAddress} includes explicit A2A envelope metadata. Current tap_reply treats explicit envelopes as inbox/audit evidence only and does not use them to bypass consent-drive routing. Falling back to inbox delivery.`
    );
  }
  const receiveTransports = normalizeReceiveTransports(
    options.target.receiveTransports
  );
  if (!prefersConsentDrive(receiveTransports)) {
    return buildDriveFallbackResult(null);
  }
  if (options.target.ambiguous) {
    return buildDriveFallbackResult(
      `\u26A0\uFE0F ${options.target.routingAddress} prefers consent-drive but recipient resolution was ambiguous. Falling back to inbox delivery.`
    );
  }
  if (!options.commsDir) {
    return buildDriveFallbackResult(
      `\u26A0\uFE0F ${options.target.routingAddress} prefers consent-drive but TAP_COMMS_DIR is unavailable. Falling back to inbox delivery.`
    );
  }
  const registry = buildCodexBindingRegistry({
    heartbeats: options.heartbeats ?? {},
    now: options.now,
    staleAfterMs: options.staleAfterMs
  });
  const bindingResolution = resolveCodexBinding({
    registry,
    target: {
      routingAddress: options.target.routingAddress
    },
    localHostId: options.localHostId
  });
  const deliverLocalBinding = async (binding, allowRefreshRetry = true) => {
    const healthFallback = buildRuntimeHealthFallbackResult(
      options.target.routingAddress,
      binding.health
    );
    if (healthFallback) return healthFallback;
    const conversationId = binding.conversationId?.trim();
    const ownerClientId = binding.ownerClientId?.trim();
    const hostId = binding.hostId?.trim() || options.localHostId?.trim() || null;
    if (!conversationId || !ownerClientId) {
      return buildDriveFallbackResult(
        `\u26A0\uFE0F ${options.target.routingAddress} prefers consent-drive but its live routing metadata is incomplete. Falling back to inbox delivery.`
      );
    }
    if (options.dryRun) {
      const leaseFallback2 = checkTrustedDeviceLeaseForRoute({
        route: options,
        targetHostId: hostId,
        conversationId,
        ownerClientId
      });
      if (leaseFallback2) return leaseFallback2;
      return {
        transport: "consent-drive",
        delivered: false,
        fallbackToInbox: false,
        turnId: null,
        consentRef: null,
        warning: null,
        dryRun: true
      };
    }
    const leaseFallback = checkTrustedDeviceLeaseForRoute({
      route: options,
      targetHostId: hostId,
      conversationId,
      ownerClientId
    });
    if (leaseFallback) return leaseFallback;
    const transportFactory = options.transportFactory ?? defaultTransportFactory;
    const transport = transportFactory({
      commsDir: options.commsDir,
      hostId
    });
    try {
      await transport.connect();
      const created = transport.createConsentReceipt({
        conversationId,
        hostId,
        ownerClientId,
        allowedMethods: ["thread-follower-start-turn"]
      });
      const result = await transport.startTurn({
        conversationId,
        text: buildTapMessagePrompt({
          agentName: options.target.displayName?.trim() || options.target.routingAddress,
          sender: options.sender.displayName,
          recipient: options.target.displayName?.trim() || options.target.routingAddress,
          subject: options.subject,
          fileName: options.fileName,
          body: options.content,
          replyTo: options.sender.routingAddress
        }),
        consentRef: created.receipt.id,
        hostId,
        ownerClientId,
        action: "start-turn"
      });
      return {
        transport: "consent-drive",
        delivered: true,
        fallbackToInbox: false,
        turnId: extractTurnId(result),
        consentRef: created.receipt.id,
        warning: null
      };
    } catch (error) {
      if (isNoClientFoundError(error)) {
        if (allowRefreshRetry) {
          const refreshed = await refreshLocalOwnerBinding(binding, options);
          if (refreshed?.ownerClientId && refreshed.ownerClientId !== ownerClientId) {
            await transport.disconnect().catch(() => void 0);
            return await deliverLocalBinding(refreshed, false);
          }
        }
        return buildDriveFallbackResult(
          `\u26A0\uFE0F consent-drive delivery to ${options.target.routingAddress} failed because the Codex ownerClientId appears stale (no-client-found). Run tap_register_capabilities from the target runtime with the conversationId and omit ownerClientId. Falling back to inbox delivery.`
        );
      }
      return buildDriveFallbackResult(
        `\u26A0\uFE0F consent-drive delivery to ${options.target.routingAddress} failed (${error instanceof Error ? error.message : String(error)}). Falling back to inbox delivery.`
      );
    } finally {
      await transport.disconnect().catch(() => void 0);
    }
  };
  if (bindingResolution.status === "blocked") {
    if (bindingResolution.candidates.length === 1) {
      const healthFallback = buildRuntimeHealthFallbackResult(
        options.target.routingAddress,
        bindingResolution.candidates[0].health
      );
      if (healthFallback) return healthFallback;
    }
    if ((bindingResolution.reason === "partial" || bindingResolution.reason === "binding-mismatch" || bindingResolution.reason === "stale") && bindingResolution.candidates.length === 1) {
      const refreshed = await refreshLocalOwnerBinding(
        bindingResolution.candidates[0],
        options
      );
      if (refreshed) {
        return await deliverLocalBinding(refreshed, false);
      }
    }
    if (bindingResolution.reason === "stale") {
      return buildDriveFallbackResult(
        formatStaleBindingRecovery(
          options.target.routingAddress,
          bindingResolution.candidates
        )
      );
    }
    if (bindingResolution.reason === "not-reachable") {
      const remoteCandidate = bindingResolution.candidates.length === 1 ? bindingResolution.candidates[0] : null;
      const remoteHostId = remoteCandidate?.hostId?.trim() || null;
      const remoteConversationId = remoteCandidate?.conversationId?.trim() || null;
      const remoteOwnerClientId = remoteCandidate?.ownerClientId?.trim() || null;
      if (remoteCandidate) {
        const healthFallback = buildRuntimeHealthFallbackResult(
          options.target.routingAddress,
          remoteCandidate.health
        );
        if (healthFallback) return healthFallback;
      }
      const remoteConfig = resolveRemoteHostConfig(
        remoteHostId,
        options.remoteHosts
      );
      if (!remoteConfig) {
        return buildDriveFallbackResult(
          `\u26A0\uFE0F ${options.target.routingAddress} prefers consent-drive but target host is remote/unmapped (${remoteHostId ?? "unknown"}). Falling back to inbox delivery.`
        );
      }
      if (!remoteCandidate || !remoteConversationId || !remoteOwnerClientId) {
        return buildDriveFallbackResult(
          `\u26A0\uFE0F ${options.target.routingAddress} prefers consent-drive but its remote routing metadata is incomplete. Falling back to inbox delivery.`
        );
      }
      if (options.dryRun) {
        const leaseFallback2 = checkTrustedDeviceLeaseForRoute({
          route: options,
          targetHostId: remoteHostId,
          conversationId: remoteConversationId,
          ownerClientId: remoteOwnerClientId
        });
        if (leaseFallback2) return leaseFallback2;
        return {
          transport: "consent-drive",
          delivered: false,
          fallbackToInbox: false,
          turnId: null,
          consentRef: null,
          warning: null,
          dryRun: true
        };
      }
      const leaseFallback = checkTrustedDeviceLeaseForRoute({
        route: options,
        targetHostId: remoteHostId,
        conversationId: remoteConversationId,
        ownerClientId: remoteOwnerClientId
      });
      if (leaseFallback) return leaseFallback;
      try {
        const text = buildTapMessagePrompt({
          agentName: options.target.displayName?.trim() || options.target.routingAddress,
          sender: options.sender.displayName,
          recipient: options.target.displayName?.trim() || options.target.routingAddress,
          subject: options.subject,
          fileName: options.fileName,
          body: options.content,
          replyTo: options.sender.routingAddress
        });
        const result = await (options.remoteRelayExecutor ?? defaultRemoteRelayExecutor)({
          config: remoteConfig,
          target: {
            routingAddress: remoteCandidate.routingAddress,
            hostId: remoteHostId,
            conversationId: remoteConversationId,
            ownerClientId: remoteOwnerClientId
          },
          sender: options.sender,
          subject: options.subject,
          content: options.content,
          fileName: options.fileName,
          text
        });
        return {
          transport: "consent-drive",
          delivered: true,
          fallbackToInbox: false,
          turnId: result.turnId,
          consentRef: result.consentRef,
          warning: null
        };
      } catch (error) {
        if (isNoClientFoundError(error)) {
          return buildDriveFallbackResult(
            `\u26A0\uFE0F remote consent-drive relay to ${options.target.routingAddress} failed because the Codex ownerClientId appears stale (no-client-found). Run tap_register_capabilities from the target runtime with the conversationId and omit ownerClientId. Falling back to inbox delivery.`
          );
        }
        if (isRecipientActiveTurnError(error)) {
          return buildDriveFallbackResult(
            `\u26A0\uFE0F remote consent-drive relay to ${options.target.routingAddress} was blocked because the recipient conversation has an active in-progress turn. Wait for the target turn to finish, interrupt the stuck turn if needed, or use a future steer path. Falling back to inbox delivery. Detail: ${error instanceof Error ? error.message : String(error)}`
          );
        }
        return buildDriveFallbackResult(
          `\u26A0\uFE0F remote consent-drive relay to ${options.target.routingAddress} failed (${error instanceof Error ? error.message : String(error)}). Falling back to inbox delivery.`
        );
      }
    }
    return buildDriveFallbackResult(
      `\u26A0\uFE0F ${options.target.routingAddress} prefers consent-drive but Codex binding resolution was blocked (${bindingResolution.reason}: ${bindingResolution.message}). Falling back to inbox delivery.`
    );
  }
  return await deliverLocalBinding(bindingResolution.binding);
}

// src/transport/slot-collision-audit.ts
import * as fs5 from "fs";
import * as path5 from "path";
function normalizeString9(value) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}
function isAuditEnabled() {
  const normalized = process.env.TAP_SLOT_COLLISION_AUDIT?.trim().toLowerCase();
  if (!normalized) return true;
  return !["0", "false", "no", "off"].includes(normalized);
}
function resolveAuditDir(commsDir) {
  const resolved = normalizeString9(commsDir) ?? normalizeString9(process.env.TAP_COMMS_DIR);
  if (!resolved) return null;
  return path5.join(path5.resolve(resolved), "audit", "slot-collisions");
}
function shortId(value) {
  const s = (value ?? "").replace(/[^a-zA-Z0-9가-힣]/g, "");
  return s.slice(0, 12) || "unknown";
}
function dayStamp(iso) {
  return iso.slice(0, 10).replace(/-/g, "");
}
function buildAuditFilePath(dir, record) {
  const day = dayStamp(record.recordedAt);
  const slot = record.slot.replace(/[^a-zA-Z0-9-]/g, "");
  const loser = shortId(record.loser.instanceId ?? record.loser.agentId);
  const winner = shortId(record.winner.instanceId ?? record.winner.agentId);
  return path5.join(dir, `${day}-${slot}-loser-${loser}-winner-${winner}.md`);
}
function buildFrontmatter2(record) {
  const fields = [
    ["type", "slot-collision-audit"],
    ["slot", record.slot],
    ["recorded_at", record.recordedAt],
    ["winner", record.winner],
    ["loser", record.loser]
  ];
  const lines = fields.map(
    ([key, value]) => `${key}: ${JSON.stringify(value ?? null)}`
  );
  return `---
${lines.join("\n")}
---

`;
}
function buildBody2(record) {
  return [
    "# Slot Collision Audit",
    "",
    `Two heartbeats claimed slot \`${record.slot}\`; newer-wins disambiguation`,
    `demoted the older holder from slot-form routing.`,
    "",
    "## Winner (active)",
    "",
    "```json",
    JSON.stringify(record.winner, null, 2),
    "```",
    "",
    "## Loser (stale-by-newer)",
    "",
    "```json",
    JSON.stringify(record.loser, null, 2),
    "```",
    ""
  ].join("\n");
}
function writeSlotCollisionAudit(options) {
  if (!isAuditEnabled()) return null;
  const slot = normalizeString9(options.slot);
  if (!slot) return null;
  const auditDir = resolveAuditDir(options.commsDir);
  if (!auditDir) return null;
  const record = {
    slot,
    recordedAt: normalizeString9(options.recordedAt) ?? (/* @__PURE__ */ new Date()).toISOString(),
    winner: options.winner,
    loser: options.loser
  };
  try {
    fs5.mkdirSync(auditDir, { recursive: true });
    const filePath = buildAuditFilePath(auditDir, record);
    fs5.writeFileSync(
      filePath,
      buildFrontmatter2(record) + buildBody2(record),
      "utf-8"
    );
    return filePath;
  } catch {
    return null;
  }
}

// src/transport/instance-ownership-audit.ts
import * as fs6 from "fs";
import * as path6 from "path";
function normalizeString10(value) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}
function isAuditEnabled2() {
  const normalized = process.env.TAP_INSTANCE_OWNERSHIP_AUDIT?.trim().toLowerCase();
  if (!normalized) return true;
  return !["0", "false", "no", "off"].includes(normalized);
}
function resolveAuditDir2(commsDir) {
  const resolved = normalizeString10(commsDir) ?? normalizeString10(process.env.TAP_COMMS_DIR);
  if (!resolved) return null;
  return path6.join(path6.resolve(resolved), "audit", "instance-ownership-changes");
}
function shortId2(value) {
  const s = (value ?? "").replace(/[^a-zA-Z0-9가-힣]/g, "");
  return s.slice(0, 12) || "unknown";
}
function dayStamp2(iso) {
  return iso.slice(0, 10).replace(/-/g, "");
}
function buildAuditFilePath2(dir, record) {
  const day = dayStamp2(record.recordedAt);
  const instance = shortId2(record.instanceId);
  const prev = shortId2(record.previous.agentId);
  const next = shortId2(record.next.agentId);
  return path6.join(
    dir,
    `${day}-${instance}-prev-${prev}-next-${next}.md`
  );
}
function buildFrontmatter3(record) {
  const fields = [
    ["type", "instance-ownership-change-audit"],
    ["instance_id", record.instanceId],
    ["recorded_at", record.recordedAt],
    ["previous", record.previous],
    ["next", record.next],
    ["pruned_keys", record.prunedKeys],
    ["pruned_presence_files", record.prunedPresenceFiles]
  ];
  const lines = fields.map(
    ([key, value]) => `${key}: ${JSON.stringify(value ?? null)}`
  );
  return `---
${lines.join("\n")}
---

`;
}
function buildBody3(record) {
  return [
    "# Instance Ownership Change Audit",
    "",
    `Instance \`${record.instanceId}\` was claimed by a new agent via \`tap_set_name\`.`,
    `Prior-owner aliases and presence records were pruned so Layer 2 routing stays clean.`,
    `Pruning only touches entries on the **same host** as the current session \u2014 cross-device presence is preserved.`,
    "",
    "## Previous owner",
    "",
    "```json",
    JSON.stringify(record.previous, null, 2),
    "```",
    "",
    "## New owner",
    "",
    "```json",
    JSON.stringify(record.next, null, 2),
    "```",
    "",
    "## Pruned",
    "",
    `- Heartbeat store keys: ${record.prunedKeys.length > 0 ? record.prunedKeys.map((k) => `\`${k}\``).join(", ") : "_(none)_"}`,
    `- Presence files: ${record.prunedPresenceFiles.length > 0 ? record.prunedPresenceFiles.map((k) => `\`${k}\``).join(", ") : "_(none)_"}`,
    ""
  ].join("\n");
}
function writeInstanceOwnershipChangeAudit(options) {
  if (!isAuditEnabled2()) return null;
  const instanceId = normalizeString10(options.instanceId);
  if (!instanceId) return null;
  const auditDir = resolveAuditDir2(options.commsDir);
  if (!auditDir) return null;
  const record = {
    instanceId,
    recordedAt: normalizeString10(options.recordedAt) ?? (/* @__PURE__ */ new Date()).toISOString(),
    previous: options.previous,
    next: options.next,
    prunedKeys: options.prunedKeys,
    prunedPresenceFiles: options.prunedPresenceFiles
  };
  try {
    fs6.mkdirSync(auditDir, { recursive: true });
    const filePath = buildAuditFilePath2(auditDir, record);
    fs6.writeFileSync(
      filePath,
      buildFrontmatter3(record) + buildBody3(record),
      "utf-8"
    );
    return filePath;
  } catch {
    return null;
  }
}

// packages/tap-plugin/channels/tap-instance-ownership.ts
init_tap_utils();
import { existsSync as existsSync11, readFileSync as readFileSync11, readdirSync as readdirSync9, unlinkSync as unlinkSync3 } from "fs";
import { join as join15 } from "path";
function isSameInstance(entry, currentInstanceId) {
  const entryInstanceId = entry.instanceId?.trim();
  if (entryInstanceId && entryInstanceId === currentInstanceId) return true;
  const addressClientId = entry.address?.clientId?.trim();
  if (addressClientId && addressClientId === currentInstanceId) return true;
  return false;
}
function shouldPrune(entry, currentInstanceId, currentHostId) {
  if (!isSameInstance(entry, currentInstanceId)) return false;
  const entryHostId = entry.address?.hostId?.trim() || null;
  if (entryHostId && currentHostId && entryHostId !== currentHostId) {
    return false;
  }
  return true;
}
function sanitizePresenceId(agentId) {
  return agentId.replace(/[/\\:]/g, "_");
}
function tryRemovePresenceFile(sanitizedId) {
  if (!existsSync11(PRESENCE_DIR)) return null;
  const candidate = join15(PRESENCE_DIR, `${sanitizedId}.json`);
  if (!existsSync11(candidate)) return null;
  try {
    unlinkSync3(candidate);
    return `${sanitizedId}.json`;
  } catch {
    return null;
  }
}
function pruneInstanceOwnershipChange(params) {
  const { store, currentAgentId, currentInstanceId, currentHostId } = params;
  const prunedKeys = [];
  const prunedPresenceFiles = [];
  let previous = null;
  for (const [key, entry] of Object.entries(store)) {
    if (key === currentAgentId) continue;
    if (!shouldPrune(entry, currentInstanceId, currentHostId)) continue;
    prunedKeys.push(key);
    if (!previous) {
      previous = {
        agentId: key,
        displayName: entry.agent?.trim() || null,
        instanceId: currentInstanceId,
        hostId: entry.address?.hostId?.trim() || null,
        lastActivity: entry.lastActivity?.trim() || entry.timestamp?.trim() || null
      };
    }
    delete store[key];
    const sanitized = sanitizePresenceId(key);
    const removed = tryRemovePresenceFile(sanitized);
    if (removed) prunedPresenceFiles.push(removed);
  }
  if (existsSync11(PRESENCE_DIR)) {
    for (const filename of readdirSync9(PRESENCE_DIR)) {
      if (!filename.endsWith(".json")) continue;
      const basename7 = filename.replace(/\.json$/, "");
      if (basename7 === sanitizePresenceId(currentAgentId)) continue;
      if (prunedPresenceFiles.includes(filename)) continue;
      const filePath = join15(PRESENCE_DIR, filename);
      let parsed = null;
      try {
        parsed = JSON.parse(readFileSync11(filePath, "utf-8"));
      } catch {
        continue;
      }
      if (!parsed) continue;
      if (!shouldPrune(parsed, currentInstanceId, currentHostId)) continue;
      try {
        unlinkSync3(filePath);
        prunedPresenceFiles.push(filename);
        if (!previous) {
          previous = {
            agentId: basename7,
            displayName: parsed.agent?.trim() || null,
            instanceId: currentInstanceId,
            hostId: parsed.address?.hostId?.trim() || null,
            lastActivity: parsed.lastActivity?.trim() || parsed.timestamp?.trim() || null
          };
        }
      } catch {
      }
    }
  }
  return {
    prunedKeys,
    prunedPresenceFiles,
    previous
  };
}

// packages/tap-plugin/channels/tap-comms.ts
import { readdirSync as readdirSync11, renameSync as renameSync6, statSync as statSync9 } from "fs";

// packages/tap-plugin/channels/tap-poll-fallback.ts
init_tap_utils();
import { existsSync as existsSync12, readdirSync as readdirSync10, statSync as statSync8 } from "fs";
import { basename as basename5 } from "path";
var POLL_INTERVAL_MS = process.platform === "win32" ? 3e3 : 3e4;
var POLL_SOURCES = ["inbox", "reviews"];
var recoveredCount = 0;
var pollCycles = 0;
function isWatcherVerboseEnabled(env = process.env) {
  const normalized = env.TAP_WATCHER_VERBOSE?.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  return ["1", "true", "yes", "on"].includes(normalized);
}
function buildPollCycleSummary(cycle, stats, intervalMs = POLL_INTERVAL_MS) {
  const discovered = stats.sources.reduce(
    (total, source) => total + source.discovered,
    0
  );
  const eligible = stats.sources.reduce(
    (total, source) => total + source.eligible,
    0
  );
  const skippedBeforeServerStart = stats.sources.reduce(
    (total, source) => total + source.skippedBeforeServerStart,
    0
  );
  const processErrors = stats.sources.reduce(
    (total, source) => total + source.processErrors,
    0
  );
  return {
    cycle,
    intervalMs,
    discovered,
    eligible,
    recovered: stats.recovered,
    skippedBeforeServerStart,
    processErrors,
    sources: stats.sources
  };
}
async function pollOnce(mcp2) {
  let recovered = 0;
  const sources = [];
  for (const source of POLL_SOURCES) {
    const dir = getSourceDir(source);
    if (!dir || !existsSync12(dir)) {
      sources.push({
        source,
        dir: dir ?? null,
        reviewGeneration: null,
        discovered: 0,
        eligible: 0,
        recovered: 0,
        skippedBeforeServerStart: 0,
        processErrors: 0,
        dirMissing: true
      });
      continue;
    }
    const sourceStats = {
      source,
      dir,
      reviewGeneration: source === "reviews" ? basename5(dir) : null,
      discovered: 0,
      eligible: 0,
      recovered: 0,
      skippedBeforeServerStart: 0,
      processErrors: 0,
      dirMissing: false
    };
    let filenames;
    try {
      filenames = readdirSync10(dir).filter((f) => f.endsWith(".md"));
    } catch {
      sourceStats.processErrors++;
      sources.push(sourceStats);
      continue;
    }
    sourceStats.discovered = filenames.length;
    for (const filename of filenames) {
      const filepath = `${dir}/${filename}`;
      try {
        const mtime = statSync8(filepath).mtimeMs;
        if (mtime < SERVER_START - 5e3) {
          sourceStats.skippedBeforeServerStart++;
          continue;
        }
      } catch {
        sourceStats.processErrors++;
        continue;
      }
      sourceStats.eligible++;
      try {
        const sent = await processWatchFile(dir, source, filename, mcp2);
        if (sent) {
          recovered++;
          sourceStats.recovered++;
        }
      } catch {
        sourceStats.processErrors++;
      }
    }
    sources.push(sourceStats);
  }
  return {
    recovered,
    sources
  };
}
function startPollFallback(mcp2) {
  logInfo("poll fallback started", {
    intervalMs: POLL_INTERVAL_MS,
    sources: POLL_SOURCES.join(","),
    watcherVerbose: isWatcherVerboseEnabled(),
    reviewSourceTracksLatest: true
  });
  const maybeLogCycleSummary = (phase, stats) => {
    if (!isWatcherVerboseEnabled()) {
      return;
    }
    logInfo("poll fallback cycle summary", {
      phase,
      ...buildPollCycleSummary(pollCycles, stats)
    });
  };
  const timer = setInterval(async () => {
    pollCycles++;
    try {
      const stats = await pollOnce(mcp2);
      maybeLogCycleSummary("interval", stats);
      if (stats.recovered > 0) {
        recoveredCount += stats.recovered;
        logInfo("poll fallback recovered missed messages", {
          count: stats.recovered,
          totalRecovered: recoveredCount
        });
      }
    } catch (error) {
      logWarn("poll fallback error", {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }, POLL_INTERVAL_MS);
  timer.unref();
  setTimeout(async () => {
    pollCycles++;
    try {
      const stats = await pollOnce(mcp2);
      maybeLogCycleSummary("initial", stats);
      if (stats.recovered > 0) {
        recoveredCount += stats.recovered;
        logInfo("poll fallback initial recovery", {
          count: stats.recovered,
          totalRecovered: recoveredCount
        });
      }
    } catch {
    }
  }, 5e3).unref();
}

// packages/tap-plugin/channels/tap-comms.ts
initDb();
autoSyncOnStartup();
var ONBOARDING_TEASER_LINES = 10;
var peerDmHistory = /* @__PURE__ */ new Map();
var HEADLESS_REPLY_RECEIPT_ENV = "TAP_HEADLESS_REPLY_RECEIPT_DIR";
function shouldSurfaceTapReplyRoutingWarning(options) {
  if (!options.warning) return false;
  if (options.structured) return true;
  if (!options.fallbackToInbox) return true;
  return !options.warning.includes("only stale-visible Codex presence matched");
}
function formatTapReplyRouteDiagnostic(options) {
  const liveAttemptStatus = options.transport === "consent-drive" && !options.fallbackToInbox ? options.dryRun ? "would-attempt" : options.delivered ? "delivered" : "not-delivered" : "not-attempted";
  return `tap_reply route: transport=${options.transport} liveAttemptStatus=${liveAttemptStatus} fallbackToInbox=${String(options.fallbackToInbox)}` + (options.inboxPath ? ` inboxEvidence=${options.dryRun ? "would-write:" : ""}${options.inboxPath}` : "") + (options.turnId ? ` turnId=${options.turnId}` : "");
}
function loadTowerNameFromConfig() {
  const repoRoot = process.env.TAP_REPO_ROOT ?? ".";
  try {
    const cfgPath = join16(repoRoot, "tap-config.json");
    if (!existsSync13(cfgPath)) return null;
    const cfg = JSON.parse(readFileSync12(cfgPath, "utf-8"));
    return cfg.towerName?.trim() || null;
  } catch {
    return null;
  }
}
function writeMcpJsonAgentName(name) {
  if (process.env.TAP_AUTOWRITE_MCP_JSON === "0") return;
  try {
    const repoRoot = process.env.TAP_REPO_ROOT || process.cwd();
    const mcpPath = join16(repoRoot, ".mcp.json");
    if (!existsSync13(mcpPath)) return;
    const raw = readFileSync12(mcpPath, "utf-8");
    const cfg = JSON.parse(raw);
    const tapEnv = cfg?.mcpServers?.tap?.env;
    if (!tapEnv || typeof tapEnv !== "object") {
      debug(
        `.mcp.json mcpServers.tap.env not found \u2014 write-through skipped (target: "${name}")`
      );
      return;
    }
    if (tapEnv.TAP_AGENT_NAME === name) return;
    tapEnv.TAP_AGENT_NAME = name;
    writeFileSync10(mcpPath, JSON.stringify(cfg, null, 2) + "\n");
    debug(`.mcp.json TAP_AGENT_NAME set to "${name}"`);
  } catch {
  }
}
function loadRemoteAgents() {
  const repoRoot = process.env.TAP_REPO_ROOT ?? ".";
  const agents = /* @__PURE__ */ new Set();
  for (const filename of ["tap-config.json", "tap-config.local.json"]) {
    try {
      const cfgPath = join16(repoRoot, filename);
      if (!existsSync13(cfgPath)) continue;
      const cfg = JSON.parse(readFileSync12(cfgPath, "utf-8"));
      if (cfg.towerName?.trim()) agents.add(cfg.towerName.trim());
      if (Array.isArray(cfg.remoteAgents)) {
        for (const a of cfg.remoteAgents) {
          if (typeof a === "string" && a.trim()) agents.add(a.trim());
        }
      }
    } catch {
    }
  }
  return agents;
}
function resolveMatchingStableTarget(recipient, candidates) {
  const normalized = recipient.trim();
  if (!normalized) return null;
  for (const candidate of candidates) {
    const stable = candidate.trim();
    if (stable && (stable === normalized || sameRoutingAddress(stable, normalized))) {
      return stable;
    }
  }
  return null;
}
function resolveFileLabel(preferred, fallback) {
  const normalizedPreferred = preferred?.trim();
  if (normalizedPreferred && !isPlaceholderAgentValue(normalizedPreferred) && normalizedPreferred !== "<set-per-session>") {
    return normalizedPreferred;
  }
  const normalizedFallback = fallback.trim();
  return normalizedFallback || "unknown";
}
function normalizeUniqueStrings(values) {
  const normalized = /* @__PURE__ */ new Set();
  for (const value of values) {
    const trimmed = value?.trim();
    if (!trimmed) continue;
    normalized.add(trimmed);
  }
  return [...normalized];
}
function normalizeStructuredTarget2(target) {
  const routingAddress = target.routingAddress?.trim();
  if (!routingAddress) return null;
  return {
    routingAddress,
    hostId: target.hostId?.trim() || null,
    clientId: target.clientId?.trim() || null,
    conversationId: target.conversationId?.trim() || null,
    ownerClientId: target.ownerClientId?.trim() || null
  };
}
function buildEnvelopeAddress(options) {
  const routingAddress = options.explicit?.routingAddress?.trim() || options.resolved?.routingAddress?.trim() || options.fallbackRoutingAddress.trim();
  if (!routingAddress) return null;
  return {
    hostId: options.explicit?.hostId ?? options.resolved?.hostId ?? null,
    clientId: options.explicit?.clientId ?? options.resolved?.clientId ?? null,
    conversationId: options.explicit?.conversationId ?? options.resolved?.conversationId ?? null,
    ownerClientId: options.explicit?.ownerClientId ?? options.resolved?.ownerClientId ?? null,
    routingAddress,
    slot: options.resolved?.slot ?? null,
    aliases: normalizeUniqueStrings([
      ...options.resolved?.aliases ?? [],
      options.explicit?.routingAddress,
      options.displayName,
      routingAddress
    ])
  };
}
function buildInboxFrontmatter(options) {
  const lines = [
    "---",
    "type: inbox",
    `message_id: ${options.messageId}`,
    `from: ${options.from}`
  ];
  const fromName = options.fromName?.trim() || null;
  const toName = options.toName?.trim() || null;
  if (fromName && !sameRoutingAddress(fromName, options.from)) {
    lines.push(`from_name: ${fromName}`);
  }
  lines.push(`to: ${options.to}`);
  if (toName && !sameRoutingAddress(toName, options.to)) {
    lines.push(`to_name: ${toName}`);
  }
  if (options.fromAddress) {
    lines.push(`from_address: ${JSON.stringify(options.fromAddress)}`);
  }
  if (options.toAddress) {
    lines.push(`to_address: ${JSON.stringify(options.toAddress)}`);
  }
  if (options.scope) {
    lines.push(`scope: ${options.scope}`);
  }
  if (options.action?.trim()) {
    lines.push(`action: ${options.action.trim()}`);
  }
  if (options.consentRef?.trim()) {
    lines.push(`consent_ref: ${options.consentRef.trim()}`);
  }
  lines.push(
    `subject: ${options.subject}`,
    `sent_at: ${options.sentAt}`,
    "---",
    ""
  );
  return lines.join("\n");
}
function formatTapReplyError(error) {
  return error instanceof Error ? error.message : String(error);
}
function isFileExistsError(error) {
  if (!error || typeof error !== "object") return false;
  return "code" in error && error.code === "EEXIST";
}
function addInboxFilenameSuffix(filename, suffix) {
  const extension = filename.toLowerCase().endsWith(".md") ? ".md" : "";
  const stem = extension ? filename.slice(0, -extension.length) : filename;
  return `${stem}-${suffix}${extension}`;
}
function resolveInboxEvidenceCandidate(filename) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const candidate = attempt === 0 ? filename : addInboxFilenameSuffix(filename, attempt + 1);
    if (!existsSync13(join16(INBOX_DIR, candidate))) {
      return { filename: candidate, inboxPath: `inbox/${candidate}` };
    }
  }
  const fallback = addInboxFilenameSuffix(filename, Date.now());
  return { filename: fallback, inboxPath: `inbox/${fallback}` };
}
function writePrimaryInboxEvidence(options) {
  try {
    mkdirSync10(INBOX_DIR, { recursive: true });
  } catch (error) {
    return { ok: false, error: formatTapReplyError(error) };
  }
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const filename = attempt === 0 ? options.filename : addInboxFilenameSuffix(options.filename, attempt + 1);
    try {
      writeFileSync10(join16(INBOX_DIR, filename), options.body, {
        encoding: "utf-8",
        flag: "wx"
      });
      dbInsertMessage(
        filename,
        options.fromId,
        options.to,
        options.subject,
        "inbox",
        Date.now()
      );
      return { ok: true, filename, inboxPath: `inbox/${filename}` };
    } catch (error) {
      if (isFileExistsError(error)) continue;
      return { ok: false, error: formatTapReplyError(error) };
    }
  }
  return {
    ok: false,
    error: `could not reserve a unique inbox evidence filename for ${options.filename}`
  };
}
function writeHeadlessReplyReceipt(options) {
  const receiptDir = process.env[HEADLESS_REPLY_RECEIPT_ENV]?.trim();
  if (!receiptDir) return null;
  try {
    mkdirSync10(receiptDir, { recursive: true });
    const receiptFile = `${Date.now()}-${options.messageId}.json`;
    const receiptPath = join16(receiptDir, receiptFile);
    writeFileSync10(
      receiptPath,
      JSON.stringify(
        {
          version: 1,
          type: "tap_reply.sent",
          createdAt: (/* @__PURE__ */ new Date()).toISOString(),
          messageId: options.messageId,
          from: options.from,
          fromName: options.fromName,
          to: options.to,
          toName: options.toName,
          subject: options.subject,
          fileName: options.fileName,
          inboxPath: options.inboxPath ?? null,
          transport: options.transport,
          fallbackToInbox: options.fallbackToInbox,
          turnId: options.turnId ?? null,
          consentRef: options.consentRef ?? null
        },
        null,
        2
      ) + "\n",
      { encoding: "utf-8", flag: "wx" }
    );
    return receiptPath;
  } catch (error) {
    debug(
      `failed to write headless reply receipt: ${error instanceof Error ? error.message : String(error)}`
    );
    return null;
  }
}
function isValidAgentName(name) {
  return Boolean(name) && /^[A-Za-z0-9가-힣_]+$/.test(name);
}
function hasCapabilityRegistrationArgs(rawArgs) {
  return typeof rawArgs.receiveTransports !== "undefined" || typeof rawArgs.conversationId !== "undefined" || typeof rawArgs.ownerClientId !== "undefined";
}
function loadOnboardingTeaser() {
  const commsDir = process.env.TAP_COMMS_DIR;
  if (!commsDir) return "";
  const stateDir = process.env.TAP_STATE_DIR;
  const agentId = getAgentId();
  if (stateDir && agentId !== "unknown") {
    try {
      const markerPath = join16(stateDir, "onboarded.json");
      if (existsSync13(markerPath)) {
        const store = JSON.parse(readFileSync12(markerPath, "utf-8"));
        if (store[agentId]) return "";
      }
    } catch {
    }
  }
  try {
    const welcomePath = join16(commsDir, "onboarding", "welcome.md");
    if (!existsSync13(welcomePath)) return "";
    const content = readFileSync12(welcomePath, "utf-8");
    const lines = content.split("\n").slice(0, ONBOARDING_TEASER_LINES);
    if (stateDir && agentId !== "unknown") {
      try {
        const markerPath = join16(stateDir, "onboarded.json");
        let store = {};
        if (existsSync13(markerPath)) {
          store = JSON.parse(readFileSync12(markerPath, "utf-8"));
        }
        if (!store[agentId]) {
          store[agentId] = { onboardedAt: (/* @__PURE__ */ new Date()).toISOString() };
          mkdirSync10(stateDir, { recursive: true });
          writeFileSync10(markerPath, JSON.stringify(store, null, 2), "utf-8");
        }
      } catch {
      }
    }
    return "\n\n--- Onboarding ---\n" + lines.join("\n") + "\n(Use tap_onboard tool for full onboarding guide.)";
  } catch {
    return "";
  }
}
var baseInstructions = 'You are connected to the tap-comms channel. Messages from other agents may arrive as <channel source="tap-comms" from="X" to="Y" subject="Z"> notifications or standard MCP notification messages. If your client does not surface realtime notifications, call tap_list_unread to pull pending inbox and review messages. Reply using the tap_reply tool to send messages back to other agents or the control tower.';
var serverCapabilities = {
  experimental: { "claude/channel": {} },
  logging: {},
  tools: {}
};
var mcp = new Server(
  { name: "tap-comms", version: "0.2.2" },
  {
    capabilities: serverCapabilities,
    instructions: baseInstructions + loadOnboardingTeaser()
  }
);
function getMcpSessionSnapshot() {
  const clientVersion = mcp.getClientVersion() ?? null;
  setObservedMcpClientName(
    typeof clientVersion === "object" && clientVersion ? clientVersion.name : typeof clientVersion === "string" ? clientVersion : null
  );
  return {
    clientVersion,
    clientCapabilities: mcp.getClientCapabilities() ?? null,
    serverCapabilities
  };
}
function observeCurrentMcpClient() {
  void getMcpSessionSnapshot();
}
function logRoutingRuntimeConflictWarning(context) {
  const conflicts = getRoutingRuntimeConflicts();
  if (conflicts.length === 0) return;
  logWarn("mcp multi-runtime stateDir conflict detected", {
    context,
    runtimeKey: getRoutingRuntimeKey(),
    conflictCount: conflicts.length,
    conflicts: conflicts.map((conflict) => ({
      pid: conflict.pid,
      runtimeKey: conflict.runtimeKey,
      agentId: conflict.agentId,
      agentName: conflict.agentName,
      updatedAt: conflict.updatedAt
    }))
  });
}
mcp.oninitialized = () => {
  logInfo("mcp initialize handshake completed", getMcpSessionSnapshot());
  logRoutingRuntimeConflictWarning("initialized");
};
mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "tap_set_name",
      description: "Set your agent name. Call this when you pick your name at session start.",
      inputSchema: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "Your chosen agent name."
          },
          tower: {
            type: "boolean",
            description: "Set to true if this agent is the control tower. Registers towerName in tap-config.json for rate-limit exemption."
          },
          receiveTransports: {
            type: "array",
            description: "Optional explicit receive transport declaration. Overrides runtime heuristic when provided.",
            items: {
              type: "string",
              enum: ["mcp-channel", "consent-drive", "polling"]
            }
          }
        },
        required: ["name"]
      }
    },
    {
      name: "tap_reply",
      description: "Send a message to another tap agent. Use concrete agent names for assignments; broad role words such as codex/reviewer/implementer may be rejected when ambiguous. Accepts either a simple `to` string or a structured `target` route.",
      inputSchema: {
        type: "object",
        properties: {
          to: {
            type: "string",
            description: "Concrete recipient agent name. Avoid broad role aliases unless a role mapping is explicitly configured."
          },
          target: {
            type: "object",
            properties: {
              routingAddress: {
                type: "string",
                description: "Primary routing address or alias (slot, instance, or known stable route)."
              },
              hostId: {
                type: "string",
                description: "Optional host constraint for disambiguation."
              },
              clientId: {
                type: "string",
                description: "Optional client/instance constraint for disambiguation."
              },
              conversationId: {
                type: "string",
                description: "Optional conversation/thread constraint for disambiguation."
              },
              ownerClientId: {
                type: "string",
                description: "Optional owner constraint for disambiguation."
              }
            },
            required: ["routingAddress"]
          },
          subject: {
            type: "string",
            description: "Message subject in kebab-case."
          },
          content: {
            type: "string",
            description: "Markdown message content."
          },
          cc: {
            description: "Optional CC recipients. Each receives a copy of the message. Pass a single string or an array of strings.",
            oneOf: [
              { type: "string" },
              {
                type: "array",
                items: { type: "string" }
              }
            ]
          },
          dryRun: {
            type: "boolean",
            description: "When true, resolve the delivery path without writing inbox files or starting a consent-drive turn."
          },
          scope: {
            type: "string",
            enum: ["observe", "suggest", "drive"],
            description: "Optional capability scope metadata for future A2A envelope readers."
          },
          action: {
            type: "string",
            description: "Optional action metadata for future A2A envelope readers."
          },
          consentRef: {
            type: "string",
            description: "Optional consent/grant reference metadata."
          }
        },
        required: ["subject", "content"]
      }
    },
    {
      name: "tap_reply_v2",
      description: "Compatibility alias for structured tap sends. Prefer tap_reply with `target` for new callers; use concrete routing metadata rather than broad role aliases.",
      inputSchema: {
        type: "object",
        properties: {
          target: {
            type: "object",
            properties: {
              routingAddress: {
                type: "string",
                description: "Primary routing address or alias (slot, instance, or known stable route)."
              },
              hostId: {
                type: "string",
                description: "Optional host constraint for disambiguation."
              },
              clientId: {
                type: "string",
                description: "Optional client/instance constraint for disambiguation."
              },
              conversationId: {
                type: "string",
                description: "Optional conversation/thread constraint for disambiguation."
              },
              ownerClientId: {
                type: "string",
                description: "Optional owner constraint for disambiguation."
              }
            },
            required: ["routingAddress"]
          },
          subject: {
            type: "string",
            description: "Message subject in kebab-case."
          },
          content: {
            type: "string",
            description: "Markdown message content."
          },
          scope: {
            type: "string",
            enum: ["observe", "suggest", "drive"],
            description: "Optional capability scope metadata for future A2A envelope readers."
          },
          action: {
            type: "string",
            description: "Optional action metadata for future A2A envelope readers."
          },
          consentRef: {
            type: "string",
            description: "Optional consent/grant reference metadata."
          },
          dryRun: {
            type: "boolean",
            description: "When true, resolve the delivery path without writing inbox files or starting a consent-drive turn."
          }
        },
        required: ["target", "subject", "content"]
      }
    },
    {
      name: "tap_reset_identity",
      description: "Clear the current session's tap identity lock so a new session can call tap_set_name again.",
      inputSchema: { type: "object", properties: {} }
    },
    {
      name: "tap_session_warmup",
      description: "Perform common session warm-up: set or confirm identity, register receive capabilities, send heartbeat, and return the current tap_who summary.",
      inputSchema: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "Agent name to set or confirm. Required when the current session has no confirmed identity."
          },
          receiveTransports: {
            type: "array",
            description: "Optional explicit receive transport declaration for this session.",
            items: {
              type: "string",
              enum: ["mcp-channel", "consent-drive", "polling"]
            }
          },
          conversationId: {
            type: "string",
            description: "Optional explicit conversation binding for this session. Pass an empty string to clear it."
          },
          ownerClientId: {
            type: "string",
            description: "Optional explicit Codex IPC owner client binding for this session. Pass an empty string to clear it. Omit it with conversationId to trigger owner discovery where supported."
          },
          status: {
            type: "string",
            enum: ["active", "idle", "signing-off"],
            description: "Heartbeat status to publish. Default active."
          },
          minutes: {
            type: "number",
            description: `tap_who window in minutes for the returned summary. Default ${POLLING_RECIPIENT_VISIBILITY_MINUTES}.`
          }
        }
      }
    },
    {
      name: "tap_register_capabilities",
      description: "Register capability metadata for the current agent session without changing its display name.",
      inputSchema: {
        type: "object",
        properties: {
          receiveTransports: {
            type: "array",
            description: "Optional explicit receive transport declaration for this session.",
            items: {
              type: "string",
              enum: ["mcp-channel", "consent-drive", "polling"]
            }
          },
          conversationId: {
            type: "string",
            description: "Optional explicit conversation binding for this session. Pass an empty string to clear it."
          },
          ownerClientId: {
            type: "string",
            description: "Optional explicit Codex IPC owner client binding for this session. Pass an empty string to clear it."
          }
        }
      }
    },
    {
      name: "tap_broadcast",
      description: "Broadcast a message to all agents. Shorthand for tap_reply with to='\uC804\uCCB4'.",
      inputSchema: {
        type: "object",
        properties: {
          subject: {
            type: "string",
            description: "Message subject in kebab-case."
          },
          content: {
            type: "string",
            description: "Markdown message content."
          }
        },
        required: ["subject", "content"]
      }
    },
    {
      name: "tap_list_unread",
      description: "Poll unread tap-comms items for clients that do not receive channel notifications.",
      inputSchema: {
        type: "object",
        properties: {
          sources: {
            type: "array",
            description: 'Optional source filter. Defaults to inbox, reviews. Add "findings" explicitly if needed.',
            items: {
              type: "string",
              enum: ["inbox", "reviews", "findings"]
            }
          },
          limit: {
            type: "number",
            description: "Maximum number of unread items to return. Default 20."
          },
          includeContent: {
            type: "boolean",
            description: "Include full markdown content. Default true."
          },
          markRead: {
            type: "boolean",
            description: "Mark returned items as read. Default true."
          },
          since: {
            type: "string",
            description: "ISO timestamp. Only return files modified after this time."
          }
        }
      }
    },
    {
      name: "tap_read_receipt",
      description: "Acknowledge that you read a message. Stores a read receipt so the sender can verify delivery.",
      inputSchema: {
        type: "object",
        properties: {
          filename: {
            type: "string",
            description: "The inbox filename of the message you read."
          }
        },
        required: ["filename"]
      }
    },
    {
      name: "tap_stats",
      description: "Show communication statistics: messages sent/received per agent, read receipts.",
      inputSchema: {
        type: "object",
        properties: {
          hours: {
            type: "number",
            description: "Time window in hours. Default 24."
          }
        }
      }
    },
    {
      name: "tap_heartbeat",
      description: "Send a heartbeat to signal this agent is alive. Call periodically or before/after major work.",
      inputSchema: {
        type: "object",
        properties: {
          status: {
            type: "string",
            enum: ["active", "idle", "signing-off"],
            description: "Agent status. Default 'active'. Use 'signing-off' before session end."
          }
        }
      }
    },
    {
      name: "tap_who",
      description: "List online agents based on recent heartbeats. Shows status, last heartbeat, and zombie detection.",
      inputSchema: {
        type: "object",
        properties: {
          minutes: {
            type: "number",
            description: `Consider agents alive if heartbeat within this many minutes. Default ${POLLING_RECIPIENT_VISIBILITY_MINUTES}.`
          }
        }
      }
    },
    {
      name: "tap_cleanup",
      description: "Archive inbox files older than N days. Moves them to archive/ directory.",
      inputSchema: {
        type: "object",
        properties: {
          days: {
            type: "number",
            description: "Archive files older than this many days. Default 7."
          },
          dryRun: {
            type: "boolean",
            description: "Preview only, don't move files. Default false."
          }
        }
      }
    },
    {
      name: "tap_db_sync",
      description: "Sync existing inbox/receipts/heartbeats files into the SQLite database.",
      inputSchema: { type: "object", properties: {} }
    },
    {
      name: "tap_onboard",
      description: "Get the full onboarding guide for this project. Returns welcome.md + any additional onboarding docs from commsDir/onboarding/.",
      inputSchema: { type: "object", properties: {} }
    },
    {
      name: "tap_identity_probe",
      description: "Dump the current MCP-side identity/runtime env snapshot seen by tap tools.",
      inputSchema: {
        type: "object",
        properties: {
          testName: {
            type: "string",
            description: "Optional routing-address dry-run. Returns whether the current runtime would accept this recipient."
          }
        }
      }
    },
    {
      name: "tap_create_consent_receipt",
      description: "Create a target-initiated one-shot consent receipt bound to the current conversation address tuple.",
      inputSchema: {
        type: "object",
        properties: {
          scope: {
            type: "string",
            enum: ["observe", "suggest", "drive"],
            description: "Capability scope granted by this receipt. Default drive."
          },
          conversationId: {
            type: "string",
            description: "Optional explicit conversationId override. Defaults to the current bridge-backed identity snapshot."
          },
          ownerClientId: {
            type: "string",
            description: "Optional explicit ownerClientId override. Defaults to the current bridge-backed identity snapshot."
          },
          hostId: {
            type: "string",
            description: "Optional explicit hostId override. Defaults to the current bridge-backed identity snapshot."
          },
          ttlSeconds: {
            type: "number",
            description: "Receipt TTL in seconds. Default 600."
          },
          allowedMethods: {
            type: "array",
            items: { type: "string" },
            description: "Optional follower-control method allowlist for narrower grants."
          }
        }
      }
    }
  ]
}));
function prunePhantomHeartbeats(store) {
  let removed = 0;
  for (const key of Object.keys(store)) {
    if (!store[key].id) {
      delete store[key];
      removed++;
    }
  }
  return removed;
}
function persistActivity(id, name) {
  const locked = acquireLock(HEARTBEATS_LOCK);
  if (!locked) return;
  try {
    const store = loadHeartbeats();
    prunePhantomHeartbeats(store);
    const existing = store[id];
    const heartbeatRecord = buildHeartbeatRecord({
      agentId: id,
      agentName: name,
      status: existing?.status ?? "active",
      existing,
      timestamp: existing?.timestamp ?? (/* @__PURE__ */ new Date()).toISOString(),
      lastActivity: getLastActivityTime(),
      joinedAt: existing?.joinedAt
    });
    store[id] = {
      ...existing,
      ...heartbeatRecord.heartbeat
    };
    saveHeartbeats(store);
  } catch {
  } finally {
    releaseLock(HEARTBEATS_LOCK);
  }
}
mcp.setRequestHandler(CallToolRequestSchema, async (req) => {
  observeCurrentMcpClient();
  updateActivityTime();
  const currentId = getAgentId();
  const currentName = getAgentName();
  if (currentId !== "unknown" && req.params.name !== "tap_set_name" && req.params.name !== "tap_reset_identity") {
    persistActivity(currentId, currentName);
    sealGraceWindow();
  }
  if (req.params.name === "tap_set_name") {
    const rawArgs = req.params.arguments ?? {};
    const name = typeof rawArgs.name === "string" ? rawArgs.name : "";
    const tower = rawArgs.tower === true;
    const parsedCapabilities = parseCapabilityRegistrationArgs(rawArgs);
    if (!parsedCapabilities.ok) {
      return {
        content: [{ type: "text", text: parsedCapabilities.errorText }]
      };
    }
    const { explicitReceiveTransports } = parsedCapabilities;
    if (!name || !/^[A-Za-z0-9가-힣_]+$/.test(name)) {
      return {
        content: [
          {
            type: "text",
            text: `Rejected: "${name}" contains invalid characters. Agent names must match [A-Za-z0-9\uAC00-\uD7A3_] \u2014 no hyphens, spaces, or special characters.`
          }
        ]
      };
    }
    const { isNameConfirmed: isConfirmed, getAgentName: currentName2 } = await Promise.resolve().then(() => (init_tap_utils(), tap_utils_exports));
    if (isConfirmed() && currentName2() !== name && !isInGraceWindow()) {
      return {
        content: [
          {
            type: "text",
            text: `Rejected: Name already confirmed as "${currentName2()}". tap_set_name can only be called once per session. Agent ID: ${getAgentId()} (immutable).`
          }
        ]
      };
    }
    let heartbeatDuplicateWarning = null;
    const locked1b = acquireLock(HEARTBEATS_LOCK);
    if (locked1b) {
      try {
        const store = loadHeartbeats();
        const ACTIVE_THRESHOLD_MS = 60 * 60 * 1e3;
        for (const [otherId, otherHb] of Object.entries(store)) {
          if (otherId === getAgentId()) continue;
          if (otherHb.agent !== name) continue;
          if (otherHb.status === "signing-off") continue;
          const freshestTs = Math.max(
            otherHb.lastActivity ? new Date(otherHb.lastActivity).getTime() : 0,
            otherHb.timestamp ? new Date(otherHb.timestamp).getTime() : 0
          );
          if (Date.now() - freshestTs < ACTIVE_THRESHOLD_MS) {
            heartbeatDuplicateWarning = `\u26A0\uFE0F Name "${name}" was recently used by agent "${otherId}" (last active ${Math.round((Date.now() - freshestTs) / 6e4)}m ago). Proceeding with claim check.`;
            break;
          }
        }
      } catch {
      } finally {
        releaseLock(HEARTBEATS_LOCK);
      }
    }
    const claimInstanceId = resolveClaimInstanceId();
    const fileClaim = claimName(
      name,
      claimInstanceId,
      process.pid,
      "mcp-direct"
    );
    if (!fileClaim.success) {
      const conflict = fileClaim.conflictWith;
      return {
        content: [
          {
            type: "text",
            text: `Rejected: Name "${name}" is claimed by instance "${conflict?.instanceId}" (alive: ${conflict?.alive}). Agent ID: ${getAgentId()} (immutable).`
          }
        ]
      };
    }
    const claim = claimAgentName(name);
    if (!claim.ok) {
      releaseClaim(name, claimInstanceId, process.pid);
      return {
        content: [
          {
            type: "text",
            text: `Rejected: Name already confirmed as "${claim.currentName}". Agent ID: ${claim.agentId} (immutable).`
          }
        ]
      };
    }
    const { oldName, agentId, wasIdLocked } = claim;
    const activeSenders = getRecentSenders();
    activeSenders.delete(oldName);
    const isDuplicate = activeSenders.has(name);
    debug(
      `name changed: ${oldName} -> ${name} (id: ${agentId}, locked: ${wasIdLocked})${isDuplicate ? " (DUPLICATE WARNING)" : ""}`
    );
    const activeList = [...activeSenders].filter((n) => n !== "unnamed" && n !== "unknown").join(", ");
    const now = (/* @__PURE__ */ new Date()).toISOString();
    let priorJoinedAt = null;
    let priorLastActivity = null;
    let ownershipPrune = null;
    let ownershipInstanceId = null;
    let ownershipHostId = null;
    const locked = acquireLock(HEARTBEATS_LOCK);
    if (locked) {
      try {
        const store = loadHeartbeats();
        const oldEntry = store[agentId] ?? (oldName !== "unknown" ? store[oldName] : void 0);
        priorJoinedAt = oldEntry?.joinedAt ?? null;
        priorLastActivity = oldEntry?.lastActivity ?? null;
        if (oldName !== "unknown" && oldName !== agentId) {
          delete store[oldName];
        }
        const heartbeatRecord = buildHeartbeatRecord({
          agentId,
          agentName: name,
          status: "active",
          existing: oldEntry,
          timestamp: now,
          lastActivity: getLastActivityTime(),
          joinedAt: oldEntry?.joinedAt ?? now,
          resetCapabilities: Boolean(oldEntry) && oldEntry?.agent !== name,
          explicitReceiveTransports
        });
        const { heartbeat, connectHash } = heartbeatRecord;
        store[agentId] = heartbeat;
        const STALE_THRESHOLD_MS = 5 * 60 * 1e3;
        for (const [otherId, otherHb] of Object.entries(store)) {
          if (otherId === agentId) continue;
          if (otherHb.agent !== name) continue;
          const otherConnectHash = otherHb.connectHash ?? buildHeartbeatConnectHash(otherHb.instanceId ?? null, otherId);
          if (otherConnectHash !== connectHash) continue;
          const freshestTs = Math.max(
            otherHb.lastActivity ? new Date(otherHb.lastActivity).getTime() : 0,
            otherHb.timestamp ? new Date(otherHb.timestamp).getTime() : 0
          );
          if (Date.now() - freshestTs > STALE_THRESHOLD_MS) {
            delete store[otherId];
          }
        }
        const currentInstanceId = heartbeat.instanceId?.trim() ?? null;
        const currentHostId = heartbeat.address?.hostId?.trim() ?? null;
        if (currentInstanceId) {
          const pruneResult = pruneInstanceOwnershipChange({
            store,
            currentAgentId: agentId,
            currentInstanceId,
            currentHostId
          });
          if (pruneResult.prunedKeys.length > 0 || pruneResult.prunedPresenceFiles.length > 0) {
            ownershipPrune = pruneResult;
            ownershipInstanceId = currentInstanceId;
            ownershipHostId = currentHostId;
          }
        }
        saveHeartbeats(store);
        writePresenceFile(agentId, store[agentId]);
        writeRouteLeaseFile(agentId, store[agentId], "tap_set_name");
      } catch {
      } finally {
        releaseLock(HEARTBEATS_LOCK);
      }
    }
    if (ownershipPrune && ownershipPrune.previous && ownershipInstanceId) {
      writeInstanceOwnershipChangeAudit({
        instanceId: ownershipInstanceId,
        previous: {
          agentId: ownershipPrune.previous.agentId,
          displayName: ownershipPrune.previous.displayName,
          instanceId: ownershipPrune.previous.instanceId,
          hostId: ownershipPrune.previous.hostId,
          lastActivity: ownershipPrune.previous.lastActivity
        },
        next: {
          agentId,
          displayName: name,
          instanceId: ownershipInstanceId,
          hostId: ownershipHostId,
          lastActivity: now
        },
        prunedKeys: ownershipPrune.prunedKeys,
        prunedPresenceFiles: ownershipPrune.prunedPresenceFiles
      });
    }
    try {
      const runtimeStateDir = process.env.TAP_RUNTIME_STATE_DIR;
      if (runtimeStateDir && existsSync13(runtimeStateDir)) {
        const targetPath = join16(runtimeStateDir, "agent-name.txt");
        const tmpPath = `${targetPath}.tmp.${process.pid}`;
        writeFileSync10(tmpPath, name, "utf-8");
        renameSync6(tmpPath, targetPath);
      }
    } catch {
    }
    if (oldName === "unknown" || oldName === "unnamed") {
      try {
        const towerName = loadTowerNameFromConfig();
        let runtime = process.env.TAP_BRIDGE_RUNTIME ?? null;
        const stateDir = process.env.TAP_STATE_DIR;
        if (!runtime && stateDir) {
          try {
            const statePath = join16(stateDir, "state.json");
            if (existsSync13(statePath)) {
              const state = JSON.parse(readFileSync12(statePath, "utf-8"));
              const instanceKey = agentId.replace(/_/g, "-");
              const inst = state.instances?.[agentId] ?? state.instances?.[instanceKey];
              runtime = inst?.runtime ?? null;
            }
          } catch {
          }
        }
        if (towerName && towerName !== name && towerName !== agentId) {
          const SKIP_WINDOW_MS = 10 * 60 * 1e3;
          const STALE_WINDOW_MS = 30 * 60 * 1e3;
          let shouldNotify = true;
          if (priorJoinedAt) {
            const activityTs = priorLastActivity ?? priorJoinedAt;
            const activityAge = Date.now() - new Date(activityTs).getTime();
            if (activityAge < SKIP_WINDOW_MS) {
              shouldNotify = false;
            } else if (activityAge < STALE_WINDOW_MS) {
              shouldNotify = false;
            }
          }
          if (shouldNotify) {
            const ts = (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-");
            const notifyFilename = `${ts.slice(0, 10).replace(/-/g, "")}-tap-${towerName}-new-agent-${agentId}.md`;
            const notifyPath = join16(INBOX_DIR, notifyFilename);
            writeFileSync10(
              notifyPath,
              `[NEW] ${name} (${agentId}) joined. Runtime: ${runtime ?? "unknown"}.`,
              "utf-8"
            );
            debug(
              `tower notify: ${towerName} \u2190 new agent ${name} (${runtime})`
            );
          }
        }
      } catch {
      }
    }
    if (tower) {
      try {
        const repoRoot = process.env.TAP_REPO_ROOT || process.cwd();
        const cfgPath = join16(repoRoot, "tap-config.json");
        let cfg = {};
        if (existsSync13(cfgPath)) {
          cfg = JSON.parse(readFileSync12(cfgPath, "utf-8"));
        }
        cfg.towerName = name;
        writeFileSync10(cfgPath, JSON.stringify(cfg, null, 2) + "\n");
        debug(`tap-config.json towerName set to "${name}"`);
      } catch {
      }
    }
    writeMcpJsonAgentName(name);
    const identityProbe = buildAgentIdentityProbeSnapshot();
    const routingConflicts = identityProbe.runtimeCoordination.conflictingRuntimes;
    const runtimeKey = identityProbe.runtimeCoordination.runtimeKey ?? "unknown";
    let text = `Name set: ${name} (was: ${oldName}). Messages to "${name}", "${agentId}", "\uC804\uCCB4", or "all" will be received.`;
    if (tower)
      text += `
Tower registered: ${name} (rate-limit exempt for tower\u2194agent messages)`;
    if (!wasIdLocked)
      text += `
Agent ID locked: ${agentId} (immutable for this session)`;
    if (explicitReceiveTransports) {
      text += `
Receive transports override: ${explicitReceiveTransports.join(", ")}`;
    }
    text += `
\u26A0\uFE0F tap_set_name is process-local first. It updates this live runtime immediately and syncs same-runtime siblings via runtime key "${runtimeKey}", but other already-running MCP runtimes keep their current bootstrap until restart/reload.`;
    if (identityProbe.bootstrapDrift.envAgentNameIsPlaceholder || identityProbe.bootstrapDrift.differsFromRuntime) {
      const bootstrapName = identityProbe.bootstrapDrift.envAgentName?.trim() || "unset";
      text += `
\u26A0\uFE0F Bootstrap config still resolves to "${bootstrapName}". Update .mcp.json or ~/.codex/config.toml if future runtimes should start as "${name}", then restart/reload the affected session.`;
    }
    if (heartbeatDuplicateWarning) text += `
${heartbeatDuplicateWarning}`;
    else if (isDuplicate)
      text += `
\u26A0\uFE0F WARNING: "${name}" was already used in the last 24h. Pick a different name to avoid confusion.`;
    if (routingConflicts.length > 0) {
      text += `
\u26A0\uFE0F ${routingConflicts.length} other live MCP runtime(s) share this TAP_STATE_DIR. Routing aliases now sync within runtime key "${runtimeKey}", but not across those other runtimes. tap_set_name alone is not sufficient for cross-runtime realtime receive; update bootstrap config and restart/reload those sessions if realtime delivery still matters.`;
    }
    if (activeList) text += `
Recent active names: ${activeList}`;
    return { content: [{ type: "text", text }] };
  }
  if (req.params.name === "tap_reset_identity") {
    const reset = await resetIdentity();
    const locked = acquireLock(HEARTBEATS_LOCK);
    if (locked) {
      try {
        const store = loadHeartbeats();
        if (reset.previousId !== "unknown") {
          delete store[reset.previousId];
          deletePresenceFile(reset.previousId);
        }
        if (reset.previousName !== "unknown" && reset.previousName !== reset.previousId) {
          delete store[reset.previousName];
          deletePresenceFile(reset.previousName);
        }
        saveHeartbeats(store);
      } finally {
        releaseLock(HEARTBEATS_LOCK);
      }
    }
    debug(
      `identity reset: ${reset.previousName} (${reset.previousId}) -> ${reset.nextName} (${reset.nextId}), releasedClaim=${reset.releasedClaim}`
    );
    writeMcpJsonAgentName("unnamed");
    if (process.env.TAP_AUTOWRITE_MCP_JSON !== "0") {
      try {
        const repoRoot = process.env.TAP_REPO_ROOT || process.cwd();
        const cfgPath = join16(repoRoot, "tap-config.json");
        if (existsSync13(cfgPath)) {
          const tcfg = JSON.parse(readFileSync12(cfgPath, "utf-8"));
          if (tcfg.towerName === reset.previousName) {
            delete tcfg.towerName;
            writeFileSync10(cfgPath, JSON.stringify(tcfg, null, 2) + "\n");
            debug(
              `tap-config.json towerName cleared (was "${reset.previousName}")`
            );
          }
        }
      } catch {
      }
    }
    return {
      content: [
        {
          type: "text",
          text: `Identity reset. Previous: "${reset.previousName}" (id: ${reset.previousId}). Current display name: "${reset.nextName}". Name lock cleared; call tap_set_name to choose a new name. Claim released: ${reset.releasedClaim}.`
        }
      ]
    };
  }
  if (req.params.name === "tap_register_capabilities") {
    const rawArgs = req.params.arguments ?? {};
    return await handleRegisterCapabilities(rawArgs, HEARTBEATS_LOCK);
  }
  if (req.params.name === "tap_session_warmup") {
    const rawArgs = req.params.arguments ?? {};
    const requestedName = typeof rawArgs.name === "string" ? rawArgs.name.trim() : "";
    const existingName = getAgentName();
    const existingId = getAgentId();
    const status = rawArgs.status === "idle" || rawArgs.status === "signing-off" ? rawArgs.status : "active";
    const minutes = typeof rawArgs.minutes === "number" && rawArgs.minutes > 0 ? rawArgs.minutes : POLLING_RECIPIENT_VISIBILITY_MINUTES;
    const parsedCapabilities = parseCapabilityRegistrationArgs(rawArgs, {
      allowConversationId: true,
      requireAtLeastOne: false
    });
    if (!parsedCapabilities.ok) {
      return {
        content: [{ type: "text", text: parsedCapabilities.errorText }]
      };
    }
    const effectiveName = requestedName || (existingName !== "unknown" && existingName !== "unnamed" ? existingName : "");
    if (!isValidAgentName(effectiveName)) {
      return {
        content: [
          {
            type: "text",
            text: `Rejected: tap_session_warmup requires a valid agent name when identity is not already confirmed. Agent names must match [A-Za-z0-9\uAC00-\uD7A3_] \u2014 no hyphens, spaces, or special characters.`
          }
        ]
      };
    }
    if (existingName !== "unknown" && existingName !== "unnamed" && existingName !== effectiveName) {
      return {
        content: [
          {
            type: "text",
            text: `Rejected: session is already named "${existingName}". tap_session_warmup does not rename live sessions; use tap_reset_identity only when you intentionally want a new identity.`
          }
        ]
      };
    }
    const warmupNotes = [];
    let agentId = existingId;
    if (existingName === "unknown" || existingName === "unnamed") {
      const claimInstanceId = resolveClaimInstanceId();
      const fileClaim = claimName(
        effectiveName,
        claimInstanceId,
        process.pid,
        "mcp-direct"
      );
      if (!fileClaim.success) {
        const conflict = fileClaim.conflictWith;
        return {
          content: [
            {
              type: "text",
              text: `Rejected: Name "${effectiveName}" is claimed by instance "${conflict?.instanceId}" (alive: ${conflict?.alive}).`
            }
          ]
        };
      }
      const claim = claimAgentName(effectiveName);
      if (!claim.ok) {
        releaseClaim(effectiveName, claimInstanceId, process.pid);
        return {
          content: [
            {
              type: "text",
              text: `Rejected: Name already confirmed as "${claim.currentName}". Agent ID: ${claim.agentId} (immutable).`
            }
          ]
        };
      }
      agentId = claim.agentId;
      if (!acquireLock(HEARTBEATS_LOCK)) {
        return {
          content: [{ type: "text", text: "Heartbeat store busy, try again." }]
        };
      }
      try {
        const store = loadHeartbeats();
        const existing = store[agentId];
        const now = (/* @__PURE__ */ new Date()).toISOString();
        const heartbeatRecord = buildHeartbeatRecord({
          agentId,
          agentName: effectiveName,
          status,
          existing,
          timestamp: now,
          lastActivity: getLastActivityTime(),
          joinedAt: existing?.joinedAt ?? now,
          resetCapabilities: Boolean(existing) && existing?.agent !== effectiveName,
          explicitReceiveTransports: parsedCapabilities.explicitReceiveTransports
        });
        store[agentId] = heartbeatRecord.heartbeat;
        saveHeartbeats(store);
        writePresenceFile(agentId, store[agentId]);
        writeRouteLeaseFile(agentId, store[agentId], "tap_session_warmup");
      } finally {
        releaseLock(HEARTBEATS_LOCK);
      }
      writeMcpJsonAgentName(effectiveName);
      warmupNotes.push(`identity=set(${effectiveName})`);
    } else {
      warmupNotes.push(`identity=confirmed(${effectiveName})`);
    }
    let capabilityText = null;
    if (hasCapabilityRegistrationArgs(rawArgs)) {
      const capabilityResult = await handleRegisterCapabilities(
        {
          receiveTransports: rawArgs.receiveTransports,
          conversationId: rawArgs.conversationId,
          ownerClientId: rawArgs.ownerClientId
        },
        HEARTBEATS_LOCK
      );
      capabilityText = capabilityResult.content[0]?.text ?? null;
    }
    if (!acquireLock(HEARTBEATS_LOCK)) {
      return {
        content: [{ type: "text", text: "Heartbeat store busy, try again." }]
      };
    }
    try {
      const store = loadHeartbeats();
      const existing = store[agentId];
      const heartbeatRecord = buildHeartbeatRecord({
        agentId,
        agentName: effectiveName,
        status,
        existing,
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
        lastActivity: getLastActivityTime(),
        joinedAt: existing?.joinedAt
      });
      store[agentId] = heartbeatRecord.heartbeat;
      saveHeartbeats(store);
      writePresenceFile(agentId, store[agentId]);
      writeRouteLeaseFile(agentId, store[agentId], "tap_session_warmup");
      dbUpsertHeartbeat(agentId, status, getLastActivityTime());
    } finally {
      releaseLock(HEARTBEATS_LOCK);
    }
    if (effectiveName && effectiveName !== "unknown") {
      if (status === "signing-off") {
        releaseClaim(effectiveName, resolveClaimInstanceId(), process.pid);
      } else {
        renewClaimTTL(effectiveName, resolveClaimInstanceId(), process.pid);
      }
    }
    const agents = buildWhoAgents(loadHeartbeats(), minutes);
    const self = agents.find((agent) => agent.id === agentId) ?? agents.find((agent) => agent.agent === effectiveName) ?? null;
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              ok: true,
              agent: effectiveName,
              agentId,
              status,
              notes: warmupNotes,
              capabilities: capabilityText,
              who: {
                minutes,
                onlineCount: agents.length,
                self
              }
            },
            null,
            2
          )
        }
      ]
    };
  }
  if (req.params.name === "tap_reply" || req.params.name === "tap_reply_v2") {
    let resolveRecipient2 = function(recipient) {
      const resolution = resolvePreferredRecipient(store, recipient);
      if (resolution.found) {
        return {
          original: recipient,
          target: resolution.target,
          routingTarget: resolution.routingTarget,
          displayName: resolution.displayName,
          found: true,
          warning: resolution.warning,
          address: resolution.address,
          receiveTransports: resolution.receiveTransports,
          ambiguous: resolution.ambiguous
        };
      }
      if (resolution.ambiguous) {
        return {
          original: recipient,
          target: recipient,
          routingTarget: recipient,
          displayName: null,
          found: false,
          warning: resolution.warning,
          address: null,
          receiveTransports: [],
          ambiguous: true
        };
      }
      if (claimedNames.has(recipient)) {
        return {
          original: recipient,
          target: recipient,
          routingTarget: recipient,
          displayName: recipient,
          found: true,
          warning: `\u26A0\uFE0F "${recipient}" found in claims registry but not in active heartbeats. Message will be delivered when agent starts.`,
          address: null,
          receiveTransports: [],
          ambiguous: false
        };
      }
      const replyableRecipient = resolveMatchingStableTarget(
        recipient,
        replyableRecipients.keys()
      );
      if (replyableRecipient) {
        const routingTarget = replyableRecipients.get(replyableRecipient) ?? replyableRecipient;
        return {
          original: recipient,
          target: routingTarget,
          routingTarget,
          displayName: sameRoutingAddress(replyableRecipient, routingTarget) ? null : replyableRecipient,
          found: true,
          warning: `\u26A0\uFE0F "${recipient}" matched a recent inbound sender (stored as "${routingTarget}", not in local heartbeats). Message will be delivered via inbox sync.`,
          address: null,
          receiveTransports: [],
          ambiguous: false
        };
      }
      const stableSlot = normalizeRoutingSlot(recipient);
      if (stableSlot) {
        return {
          original: recipient,
          target: stableSlot,
          routingTarget: stableSlot,
          displayName: null,
          found: true,
          warning: null,
          address: null,
          receiveTransports: [],
          ambiguous: false
        };
      }
      const stableInstance = resolveMatchingStableTarget(
        recipient,
        knownInstanceIds
      );
      if (stableInstance) {
        return {
          original: recipient,
          target: stableInstance,
          routingTarget: stableInstance,
          displayName: null,
          found: true,
          warning: `\u26A0\uFE0F "${recipient}" matched instance "${stableInstance}" but is not in active heartbeats. Message will be delivered when that instance resumes.`,
          address: null,
          receiveTransports: [],
          ambiguous: false
        };
      }
      const remoteTarget = resolveMatchingStableTarget(recipient, remoteAgents);
      if (remoteTarget) {
        return {
          original: recipient,
          target: remoteTarget,
          routingTarget: remoteTarget,
          displayName: null,
          found: true,
          warning: `\u26A0\uFE0F Routed "${recipient}" as remote agent (stored as "${remoteTarget}", not in local heartbeats). Message will be delivered via comms sync.`,
          address: null,
          receiveTransports: [],
          ambiguous: false
        };
      }
      return {
        original: recipient,
        target: recipient,
        routingTarget: recipient,
        displayName: null,
        found: false,
        warning: `\u26A0\uFE0F WARNING: "${recipient}" is not a known agent. Check spelling. Known: ${knownList}`,
        address: null,
        receiveTransports: [],
        ambiguous: false
      };
    };
    var resolveRecipient = resolveRecipient2;
    const isV2 = req.params.name === "tap_reply_v2";
    const {
      to: rawTo,
      target: rawTarget,
      subject: rawSubject,
      content,
      cc: rawCc,
      scope: rawScope,
      action: rawAction,
      consentRef: rawConsentRef,
      dryRun: rawDryRun
    } = req.params.arguments;
    const routeTarget = rawTarget ? normalizeStructuredTarget2(rawTarget) : null;
    const scope = rawScope ?? null;
    const action = rawAction?.trim() || null;
    const consentRef = rawConsentRef?.trim() || null;
    const dryRun = rawDryRun === true;
    const explicitTo = typeof rawTo === "string" ? rawTo.trim() : "";
    const rawRecipientAddress = routeTarget?.routingAddress ?? rawTo ?? "";
    const to = typeof rawRecipientAddress === "string" ? rawRecipientAddress.trim() : "";
    const subject = typeof rawSubject === "string" ? rawSubject.trim() : "";
    if (!to) {
      return {
        content: [
          {
            type: "text",
            text: isV2 ? 'Rejected: "target.routingAddress" is required and must be a non-empty string.' : 'Rejected: "to" is required and must be a non-empty string.'
          }
        ]
      };
    }
    if (rawTarget != null && !routeTarget) {
      return {
        content: [
          {
            type: "text",
            text: 'Rejected: "target.routingAddress" is required and must be a non-empty string.'
          }
        ]
      };
    }
    if (explicitTo && routeTarget && !sameRoutingAddress(explicitTo, routeTarget.routingAddress)) {
      return {
        content: [
          {
            type: "text",
            text: 'Rejected: "to" and "target.routingAddress" disagree; pass only one target form or make them match.'
          }
        ]
      };
    }
    if (!subject) {
      return {
        content: [
          {
            type: "text",
            text: 'Rejected: "subject" is required and must be a non-empty string.'
          }
        ]
      };
    }
    if (isV2 || routeTarget || scope != null || action != null || consentRef != null) {
      const metadataError = validateStructuredEnvelopeMetadata({
        target: routeTarget,
        scope,
        action,
        consentRef
      });
      if (metadataError) {
        return {
          content: [
            {
              type: "text",
              text: `Rejected: ${metadataError}`
            }
          ]
        };
      }
    }
    const cc = normalizeRecipientList(rawCc, [to]);
    const recipientWarnings = [];
    const towerName = loadTowerNameFromConfig();
    const remoteAgents = loadRemoteAgents();
    const store = loadHeartbeats();
    const knownAgents = /* @__PURE__ */ new Set();
    const claimedNames = new Set(getClaimedNames());
    const replyableRecipients = getRecentReplyableRecipients();
    const replyableSenders = new Set(replyableRecipients.keys());
    const knownInstanceIds = /* @__PURE__ */ new Set();
    for (const [key, hb] of Object.entries(store)) {
      if (!isPlaceholderAgentValue(key)) knownAgents.add(key);
      if (!isPlaceholderAgentValue(hb.agent)) {
        knownAgents.add(hb.agent);
      }
      const instanceId = hb.instanceId?.trim() || null;
      if (instanceId && !isPlaceholderAgentValue(instanceId)) {
        knownAgents.add(instanceId);
        knownInstanceIds.add(instanceId);
      }
    }
    for (const name of claimedNames) {
      knownAgents.add(name);
    }
    for (const sender of replyableSenders) {
      knownAgents.add(sender);
    }
    for (const slot of TAP_ROUTING_SLOTS) {
      knownAgents.add(slot);
    }
    const stateInstances = loadStateInstances();
    for (const instanceId of Object.keys(stateInstances ?? {})) {
      if (isPlaceholderAgentValue(instanceId)) continue;
      knownAgents.add(instanceId);
      knownInstanceIds.add(instanceId);
    }
    const knownList = [...knownAgents].filter((n) => n !== "unknown").join(", ");
    const resolvedTower = towerName ? resolveRecipient2(towerName) : null;
    const resolvedTowerId = resolvedTower?.routingTarget ?? "tower";
    let primaryRecipient = {
      original: to,
      target: to,
      routingTarget: to,
      displayName: null,
      found: true,
      warning: null,
      address: null,
      receiveTransports: [],
      ambiguous: false
    };
    if (!isBroadcastRecipient(to)) {
      const resolution = routeTarget ? (() => {
        const structured = resolveStructuredRecipient(store, routeTarget);
        return {
          original: to,
          target: structured.target,
          routingTarget: structured.routingTarget,
          displayName: structured.displayName,
          found: structured.found,
          warning: structured.warning,
          address: structured.address,
          receiveTransports: structured.receiveTransports,
          ambiguous: structured.ambiguous
        };
      })() : resolveRecipient2(to);
      if (!resolution.found) {
        const structuredDetail = routeTarget && resolution.warning ? ` ${resolution.warning}` : "";
        const simpleDetail = resolution.warning ? ` ${resolution.warning}` : ` Known agents: ${knownList || "(none)"}`;
        return {
          content: [
            {
              type: "text",
              text: routeTarget ? `Rejected: structured target "${to}" did not match a live recipient with the requested address constraints. Message NOT sent to prevent misrouting.${structuredDetail}` : `Rejected: "${to}" is not a known or unambiguous agent. Message NOT sent to prevent DM routing leak.${simpleDetail}`
            }
          ]
        };
      }
      primaryRecipient = resolution;
      if (resolution.warning) recipientWarnings.push(resolution.warning);
    }
    const validCc = [];
    if (cc?.length) {
      for (const recipient of cc) {
        if (isBroadcastRecipient(recipient)) {
          validCc.push({
            original: recipient,
            target: recipient,
            routingTarget: recipient,
            displayName: null,
            found: true,
            warning: null,
            address: null,
            receiveTransports: [],
            ambiguous: false
          });
          continue;
        }
        const resolution = resolveRecipient2(recipient);
        if (!resolution.found) {
          recipientWarnings.push(
            resolution.warning ? resolution.warning.replace(
              `alias "${recipient}"`,
              `CC alias "${recipient}"`
            ) : `\u26A0\uFE0F CC "${recipient}" is not a known agent \u2014 skipped. Known: ${knownList}`
          );
        } else {
          validCc.push(resolution);
          if (resolution.warning) {
            recipientWarnings.push(
              resolution.warning.replace(`"${recipient}"`, `CC "${recipient}"`)
            );
          }
        }
      }
    }
    const now = /* @__PURE__ */ new Date();
    const nowMs = now.getTime();
    const date = now.toISOString().slice(0, 10).replace(/-/g, "");
    const fromId = getAgentRoutingAddress();
    const fromName = getAgentName();
    const fromFileLabel = resolveFileLabel(fromName, fromId);
    const rateLimitRoutes = /* @__PURE__ */ new Map();
    const primaryRoute = {
      fromId,
      fromName,
      to,
      resolvedTo: primaryRecipient.routingTarget,
      towerName,
      towerId: resolvedTowerId
    };
    const primaryCheck = checkPeerDmRateLimit(
      peerDmHistory,
      primaryRoute,
      nowMs
    );
    if (!primaryCheck.exempt && primaryCheck.key) {
      rateLimitRoutes.set(primaryCheck.key, primaryRoute);
    }
    for (const recipient of validCc ?? []) {
      const route = {
        fromId,
        fromName,
        to: recipient.original,
        resolvedTo: recipient.routingTarget,
        towerName,
        towerId: resolvedTowerId
      };
      const check = checkPeerDmRateLimit(peerDmHistory, route, nowMs);
      if (check.exempt || !check.key) continue;
      rateLimitRoutes.set(check.key, route);
    }
    for (const route of rateLimitRoutes.values()) {
      const check = checkPeerDmRateLimit(peerDmHistory, route, nowMs);
      if (!check.allowed) {
        return {
          content: [
            {
              type: "text",
              text: `Rate limited: too many messages between ${fromId}\u2192${check.target}. Route through tower instead.`
            }
          ]
        };
      }
    }
    const messageId = randomUUID8();
    const identitySnapshot = getAgentIdentitySnapshot();
    const primaryToName = primaryRecipient.displayName ?? (!sameRoutingAddress(to, primaryRecipient.routingTarget) ? to : null);
    const primaryFileLabel = resolveFileLabel(
      primaryToName,
      primaryRecipient.routingTarget
    );
    const baseFilename = `${date}-${fromFileLabel}-${primaryFileLabel}-${subject}.md`;
    const ccHeader = cc?.length ? `> CC: ${cc.join(", ")}

` : "";
    const frontmatter = buildInboxFrontmatter({
      from: fromId,
      fromName,
      to: primaryRecipient.routingTarget,
      toName: primaryToName,
      subject,
      sentAt: now.toISOString(),
      messageId,
      fromAddress: identitySnapshot.address,
      toAddress: buildEnvelopeAddress({
        explicit: routeTarget,
        resolved: primaryRecipient.address,
        fallbackRoutingAddress: primaryRecipient.routingTarget,
        displayName: primaryToName
      }),
      scope,
      action,
      consentRef
    });
    const sent = [];
    const dryRunEvidence = resolveInboxEvidenceCandidate(baseFilename);
    let filename = dryRunEvidence.filename;
    let primaryInboxPath = dryRunEvidence.inboxPath;
    if (!dryRun) {
      const evidence = writePrimaryInboxEvidence({
        filename: baseFilename,
        body: frontmatter + ccHeader + content,
        fromId,
        to: primaryRecipient.routingTarget,
        subject
      });
      if (!evidence.ok) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to send to ${to}: durable inbox evidence write failed (${evidence.error}). Live delivery was not attempted.`
            }
          ]
        };
      }
      filename = evidence.filename;
      primaryInboxPath = evidence.inboxPath;
      for (const route of rateLimitRoutes.values()) {
        recordPeerDm(peerDmHistory, route, nowMs);
      }
    }
    const autoRouteResult = !isBroadcastRecipient(to) && primaryRecipient.found ? await routeTapReplyDelivery({
      commsDir: process.env.TAP_COMMS_DIR,
      localHostId: identitySnapshot.address.hostId,
      explicitEnvelope: scope != null || action != null || consentRef != null,
      sender: {
        routingAddress: fromId,
        displayName: fromName
      },
      target: {
        routingAddress: primaryRecipient.routingTarget,
        displayName: primaryToName,
        address: primaryRecipient.address,
        receiveTransports: primaryRecipient.receiveTransports,
        ambiguous: primaryRecipient.ambiguous
      },
      subject,
      content,
      fileName: filename,
      heartbeats: store,
      dryRun
    }) : null;
    const autoRouteWarning = autoRouteResult?.warning ?? null;
    const isStructuredRoute = routeTarget != null || scope != null || action != null || consentRef != null;
    if (autoRouteWarning && shouldSurfaceTapReplyRoutingWarning({
      warning: autoRouteWarning,
      fallbackToInbox: autoRouteResult?.fallbackToInbox ?? false,
      structured: isStructuredRoute
    })) {
      recipientWarnings.push(autoRouteWarning);
    }
    if (dryRun) {
      const primaryTransport = autoRouteResult?.transport === "consent-drive" && !autoRouteResult.fallbackToInbox ? "consent-drive" : primaryRecipient.receiveTransports.includes("polling") ? "polling" : primaryRecipient.receiveTransports.includes("mcp-channel") ? "mcp-channel" : "inbox";
      sent.push(
        `Dry run to ${to}: would use ${primaryTransport} with inbox evidence ${primaryInboxPath}`
      );
      if (isStructuredRoute && autoRouteResult) {
        sent.push(
          formatTapReplyRouteDiagnostic({
            ...autoRouteResult,
            dryRun,
            inboxPath: primaryInboxPath
          })
        );
      }
      if (cc?.length) {
        for (const recipient of validCc ?? []) {
          sent.push(`Dry run CC to ${recipient.original}: would write inbox`);
        }
      }
      sent.push("Dry run: no inbox files written and no Codex turn started.");
      sent.push(...recipientWarnings);
      return { content: [{ type: "text", text: sent.join("\n") }] };
    }
    const primaryDeliveredLive = autoRouteResult?.transport === "consent-drive" && !autoRouteResult.fallbackToInbox;
    if (primaryDeliveredLive) {
      sent.push(
        `Sent to ${to} via consent-drive` + (autoRouteResult.turnId ? ` (turn ${autoRouteResult.turnId})` : "") + `; inbox evidence ${primaryInboxPath}`
      );
    } else {
      sent.push(`Sent to ${to}: ${filename}`);
    }
    if (isStructuredRoute && autoRouteResult) {
      sent.push(
        formatTapReplyRouteDiagnostic({
          ...autoRouteResult,
          inboxPath: primaryInboxPath
        })
      );
    }
    writeHeadlessReplyReceipt({
      messageId,
      from: fromId,
      fromName,
      to: primaryRecipient.routingTarget,
      toName: primaryToName,
      subject,
      fileName: filename,
      inboxPath: primaryInboxPath,
      transport: primaryDeliveredLive ? autoRouteResult?.transport ?? "consent-drive" : "inbox",
      fallbackToInbox: autoRouteResult?.fallbackToInbox ?? true,
      turnId: autoRouteResult?.turnId ?? null,
      consentRef: autoRouteResult?.consentRef ?? null
    });
    if (cc?.length) {
      const writtenFiles = /* @__PURE__ */ new Set([filename]);
      for (const recipient of validCc ?? []) {
        try {
          const ccToName = recipient.displayName ?? (!sameRoutingAddress(recipient.original, recipient.routingTarget) ? recipient.original : null);
          const ccFileLabel = resolveFileLabel(
            ccToName,
            recipient.routingTarget
          );
          const ccFilename = `${date}-${fromFileLabel}-${ccFileLabel}-${subject}.md`;
          if (writtenFiles.has(ccFilename)) {
            sent.push(
              `CC to ${recipient.original}: skipped (resolves to same target)`
            );
            continue;
          }
          writtenFiles.add(ccFilename);
          const ccFrontmatter = buildInboxFrontmatter({
            from: fromId,
            fromName,
            to: recipient.routingTarget,
            toName: ccToName,
            subject,
            sentAt: now.toISOString(),
            messageId,
            fromAddress: identitySnapshot.address,
            toAddress: buildEnvelopeAddress({
              resolved: recipient.address,
              fallbackRoutingAddress: recipient.routingTarget,
              displayName: ccToName
            }),
            scope,
            action,
            consentRef
          });
          writeFileSync10(
            join16(INBOX_DIR, ccFilename),
            ccFrontmatter + `> CC from message to ${to}

${content}`,
            "utf-8"
          );
          dbInsertMessage(
            ccFilename,
            fromId,
            recipient.routingTarget,
            subject,
            "inbox",
            Date.now()
          );
          sent.push(`CC to ${recipient.original}: ${ccFilename}`);
        } catch (err) {
          sent.push(
            `CC to ${recipient.original}: FAILED (${err instanceof Error ? err.message : String(err)})`
          );
        }
      }
    }
    sent.push(...recipientWarnings);
    return { content: [{ type: "text", text: sent.join("\n") }] };
  }
  if (req.params.name === "tap_broadcast") {
    const { subject, content } = req.params.arguments;
    const now = /* @__PURE__ */ new Date();
    const date = now.toISOString().slice(0, 10).replace(/-/g, "");
    const broadcastId = getAgentRoutingAddress();
    const broadcastName = getAgentName();
    const filename = `${date}-${resolveFileLabel(broadcastName, broadcastId)}-\uC804\uCCB4-${subject}.md`;
    const broadcastMessageId = randomUUID8();
    const broadcastFrontmatter = buildInboxFrontmatter({
      from: broadcastId,
      fromName: broadcastName,
      to: "\uC804\uCCB4",
      subject,
      sentAt: now.toISOString(),
      messageId: broadcastMessageId
    });
    writeFileSync10(
      join16(INBOX_DIR, filename),
      broadcastFrontmatter + content,
      "utf-8"
    );
    dbInsertMessage(
      filename,
      broadcastId,
      "\uC804\uCCB4",
      subject,
      "inbox",
      Date.now()
    );
    return { content: [{ type: "text", text: `Broadcast sent: ${filename}` }] };
  }
  if (req.params.name === "tap_list_unread") {
    const unread = getUnreadItems(req.params.arguments || {});
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            { agent: getAgentName(), count: unread.length, items: unread },
            null,
            2
          )
        }
      ]
    };
  }
  if (req.params.name === "tap_read_receipt") {
    const { filename } = req.params.arguments;
    ensureReceiptsDir();
    if (!acquireLock(RECEIPTS_LOCK)) {
      return {
        content: [{ type: "text", text: "Receipt store busy, try again." }]
      };
    }
    try {
      const store = loadReceipts();
      const inboxPath = join16(INBOX_DIR, filename);
      if (!existsSync13(inboxPath)) {
        return {
          content: [
            {
              type: "text",
              text: `Inbox file not found: ${filename}`
            }
          ]
        };
      }
      const content = stripBom(readFileSync12(inboxPath, "utf-8"));
      const receiptKey = getDurableReceiptKeys(filename, content)[0] ?? filename;
      if (!store[receiptKey]) store[receiptKey] = [];
      const readerId = getAgentId();
      const already = store[receiptKey].some((r) => r.reader === readerId);
      if (!already) {
        const ts = (/* @__PURE__ */ new Date()).toISOString();
        store[receiptKey].push({ reader: readerId, timestamp: ts });
        saveReceipts(store);
        dbInsertReceipt(filename, readerId, ts);
      }
      return {
        content: [
          {
            type: "text",
            text: already ? `Already acknowledged: ${filename}` : `Read receipt saved for: ${filename}`
          }
        ]
      };
    } finally {
      releaseLock(RECEIPTS_LOCK);
    }
  }
  function buildHudLine() {
    const hbStore = loadHeartbeats();
    const agentCount = buildWhoAgents(hbStore, 10).filter(
      (agent) => agent.alive
    ).length;
    const unreadItems = getUnreadItems({
      sources: ["inbox"],
      limit: 100,
      includeContent: false,
      markRead: false
    });
    const unreadCount = unreadItems.length;
    const unreadDisplay = unreadCount >= 100 ? "99+" : String(unreadCount);
    const status = agentCount > 0 ? "\u{1F7E2}" : "\u26AA";
    return `[tap] ${status} ${agentCount} agents | \u{1F4E8} ${unreadDisplay} unread`;
  }
  if (req.params.name === "tap_stats") {
    const hours = typeof req.params.arguments?.hours === "number" ? req.params.arguments.hours : 24;
    const cutoff = Date.now() - hours * 60 * 60 * 1e3;
    const hud = buildHudLine();
    const dbResult = dbGetStats(cutoff);
    if (dbResult) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              { hours, ...dbResult, source: "sqlite", hud },
              null,
              2
            )
          }
        ]
      };
    }
    const sent = {};
    const received = {};
    let broadcasts = 0;
    if (existsSync13(INBOX_DIR)) {
      for (const filename of readdirSync11(INBOX_DIR)) {
        if (!filename.endsWith(".md")) continue;
        try {
          if (statSync9(join16(INBOX_DIR, filename)).mtimeMs < cutoff) continue;
        } catch {
          continue;
        }
        const parsed = parseFilename(filename);
        if (!parsed) continue;
        sent[parsed.from] = (sent[parsed.from] || 0) + 1;
        if (isBroadcastRecipient(parsed.to)) broadcasts++;
        else received[parsed.to] = (received[parsed.to] || 0) + 1;
      }
    }
    const receipts = loadReceipts();
    const cutoffISO = new Date(cutoff).toISOString();
    const receiptCount = Object.values(receipts).reduce(
      (sum, arr) => sum + arr.filter((r) => r.timestamp >= cutoffISO).length,
      0
    );
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              hours,
              sent,
              received,
              broadcasts,
              totalReceipts: receiptCount,
              hud
            },
            null,
            2
          )
        }
      ]
    };
  }
  if (req.params.name === "tap_heartbeat") {
    const status = req.params.arguments?.status || "active";
    const hbId = getAgentId();
    const hbName = getAgentName();
    if (!acquireLock(HEARTBEATS_LOCK)) {
      return {
        content: [{ type: "text", text: "Heartbeat store busy, try again." }]
      };
    }
    try {
      const store = loadHeartbeats();
      const existing = store[hbId];
      const heartbeatRecord = buildHeartbeatRecord({
        agentId: hbId,
        agentName: hbName,
        status,
        existing,
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
        lastActivity: getLastActivityTime(),
        joinedAt: existing?.joinedAt
      });
      store[hbId] = heartbeatRecord.heartbeat;
      saveHeartbeats(store);
      writePresenceFile(hbId, store[hbId]);
      dbUpsertHeartbeat(hbId, status, getLastActivityTime());
    } finally {
      releaseLock(HEARTBEATS_LOCK);
    }
    if (hbName && hbName !== "unknown") {
      const hbInstanceId = resolveClaimInstanceId();
      if (status === "signing-off") {
        releaseClaim(hbName, hbInstanceId, process.pid);
      } else {
        renewClaimTTL(hbName, hbInstanceId, process.pid);
      }
    }
    return {
      content: [
        {
          type: "text",
          text: `Heartbeat sent: ${hbName} [${hbId}] (${status})`
        }
      ]
    };
  }
  if (req.params.name === "tap_who") {
    const minutes = typeof req.params.arguments?.minutes === "number" ? req.params.arguments.minutes : POLLING_RECIPIENT_VISIBILITY_MINUTES;
    const store = loadHeartbeats();
    const agents = buildWhoAgents(store, minutes);
    const bySlot = /* @__PURE__ */ new Map();
    for (const agent of agents) {
      if (!agent.slot) continue;
      const group = bySlot.get(agent.slot);
      if (group) group.push(agent);
      else bySlot.set(agent.slot, [agent]);
    }
    for (const [slot, group] of bySlot) {
      const winner = group.find((a) => a.slotStatus === "active");
      if (!winner) continue;
      for (const loser of group) {
        if (loser.slotStatus !== "stale-by-newer") continue;
        writeSlotCollisionAudit({
          slot,
          winner: {
            agentId: winner.id,
            displayName: winner.agent,
            instanceId: winner.instanceId,
            lastActivity: winner.lastActivity,
            source: winner.source,
            presence: winner.presence,
            hostId: winner.address.hostId ?? null
          },
          loser: {
            agentId: loser.id,
            displayName: loser.agent,
            instanceId: loser.instanceId,
            lastActivity: loser.lastActivity,
            source: loser.source,
            presence: loser.presence,
            hostId: loser.address.hostId ?? null
          }
        });
      }
    }
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ onlineCount: agents.length, agents }, null, 2)
        }
      ]
    };
  }
  if (req.params.name === "tap_db_sync") {
    const result = dbSyncAll();
    if (!result)
      return {
        content: [{ type: "text", text: "SQLite not available. Cannot sync." }]
      };
    return {
      content: [
        {
          type: "text",
          text: `DB sync complete: ${result.messages} messages, ${result.heartbeats} heartbeats, ${result.receipts} receipts`
        }
      ]
    };
  }
  if (req.params.name === "tap_cleanup") {
    const days = typeof req.params.arguments?.days === "number" ? req.params.arguments.days : 7;
    const dryRun = req.params.arguments?.dryRun === true;
    const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1e3);
    const cutoffStr = cutoffDate.getFullYear().toString() + (cutoffDate.getMonth() + 1).toString().padStart(2, "0") + cutoffDate.getDate().toString().padStart(2, "0");
    const moved = [];
    if (!existsSync13(ARCHIVE_DIR)) mkdirSync10(ARCHIVE_DIR, { recursive: true });
    if (existsSync13(INBOX_DIR)) {
      for (const filename of readdirSync11(INBOX_DIR)) {
        if (!filename.endsWith(".md")) continue;
        const dateMatch = filename.match(/^(\d{8})-/);
        if (!dateMatch) continue;
        if (dateMatch[1] >= cutoffStr) continue;
        const filepath = join16(INBOX_DIR, filename);
        if (!dryRun) renameSync6(filepath, join16(ARCHIVE_DIR, filename));
        moved.push(filename);
      }
    }
    return {
      content: [
        {
          type: "text",
          text: dryRun ? `[DRY RUN] Would archive ${moved.length} files older than ${days} days (filename date).` : `Archived ${moved.length} files older than ${days} days to archive/ (filename date).`
        }
      ]
    };
  }
  if (req.params.name === "tap_onboard") {
    const commsDir = process.env.TAP_COMMS_DIR;
    if (!commsDir) {
      return {
        content: [
          {
            type: "text",
            text: "TAP_COMMS_DIR not set. Cannot load onboarding docs."
          }
        ]
      };
    }
    const stateDir = process.env.TAP_STATE_DIR;
    const agentId = getAgentId();
    let alreadyOnboarded = false;
    let markerStore = {};
    const markerPath = stateDir ? join16(stateDir, "onboarded.json") : null;
    if (markerPath) {
      try {
        if (existsSync13(markerPath)) {
          markerStore = JSON.parse(readFileSync12(markerPath, "utf-8"));
          if (markerStore[agentId]) {
            alreadyOnboarded = true;
          }
        }
      } catch {
      }
    }
    const onboardingDir = join16(commsDir, "onboarding");
    if (!existsSync13(onboardingDir)) {
      return {
        content: [
          {
            type: "text",
            text: "No onboarding directory found at " + onboardingDir
          }
        ]
      };
    }
    const docs = [];
    const allFiles = readdirSync11(onboardingDir).filter(
      (f) => f.endsWith(".md")
    );
    const files = [
      ...allFiles.filter((f) => f === "welcome.md"),
      ...allFiles.filter((f) => f !== "welcome.md").sort()
    ];
    for (const file of files) {
      try {
        const content = readFileSync12(join16(onboardingDir, file), "utf-8");
        docs.push(`# ${file}

${content}`);
      } catch {
        docs.push(`# ${file}

(failed to read)`);
      }
    }
    if (docs.length === 0) {
      return {
        content: [{ type: "text", text: "Onboarding directory is empty." }]
      };
    }
    if (markerPath && !alreadyOnboarded) {
      try {
        markerStore[agentId] = { onboardedAt: (/* @__PURE__ */ new Date()).toISOString() };
        writeFileSync10(
          markerPath,
          JSON.stringify(markerStore, null, 2),
          "utf-8"
        );
      } catch {
      }
    }
    const prefix = alreadyOnboarded ? "(You have already been onboarded. Showing docs again for reference.)\n\n" : "";
    return {
      content: [{ type: "text", text: prefix + docs.join("\n\n---\n\n") }]
    };
  }
  if (req.params.name === "tap_identity_probe") {
    const rawArgs = req.params.arguments ?? {};
    const testName = typeof rawArgs.testName === "string" ? rawArgs.testName : null;
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              ...buildAgentIdentityProbeSnapshot(testName),
              mcpSession: getMcpSessionSnapshot()
            },
            null,
            2
          )
        }
      ]
    };
  }
  if (req.params.name === "tap_create_consent_receipt") {
    const rawArgs = req.params.arguments ?? {};
    if (typeof rawArgs.pairToken !== "undefined") {
      return {
        content: [
          {
            type: "text",
            text: "Rejected: tap_create_consent_receipt no longer accepts a caller-provided pairToken."
          }
        ]
      };
    }
    const {
      scope,
      conversationId,
      ownerClientId,
      hostId,
      ttlSeconds,
      allowedMethods
    } = rawArgs;
    try {
      const identitySnapshot = getAgentIdentitySnapshot();
      const created = createTapConsentReceiptFromIdentity(identitySnapshot, {
        scope,
        conversationId,
        ownerClientId,
        hostId,
        ttlSeconds,
        allowedMethods
      });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                consentRef: created.receipt.id,
                receipt: created.receipt,
                filePath: created.filePath
              },
              null,
              2
            )
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Rejected: ${error instanceof Error ? error.message : String(error)}`
          }
        ]
      };
    }
  }
  throw new Error(`unknown tool: ${req.params.name}`);
});
await mcp.connect(new StdioServerTransport());
logRoutingRuntimeConflictWarning("startup");
{
  const { isNameConfirmed: isNameConfirmed2, getAgentName: bootName } = await Promise.resolve().then(() => (init_tap_utils(), tap_utils_exports));
  if (isNameConfirmed2()) {
    const name = bootName();
    if (name && name !== "unknown") {
      const bootInstanceId = resolveClaimInstanceId();
      const bootClaim = claimName(
        name,
        bootInstanceId,
        process.pid,
        "mcp-direct"
      );
      if (bootClaim.success) {
        debug(
          `auto-claimed bootstrapped name: ${name} (instance: ${bootInstanceId})`
        );
      } else {
        const { demoteAgentName: demoteAgentName2 } = await Promise.resolve().then(() => (init_tap_utils(), tap_utils_exports));
        demoteAgentName2();
        debug(
          `WARNING: bootstrapped name "${name}" claimed by ${bootClaim.conflictWith?.instanceId ?? "unknown"} \u2014 demoted to unknown, use tap_set_name to pick a new name`
        );
      }
    }
  }
}
debug(`agent id: ${getAgentId()}, name: ${getAgentName()}`);
debug(`watching inbox: ${INBOX_DIR}`);
watchDir(INBOX_DIR, "inbox", mcp);
var latestReviewDir = getLatestReviewDir();
if (latestReviewDir) {
  debug("watching reviews watcher snapshot", {
    dir: latestReviewDir,
    generation: basename6(latestReviewDir),
    mode: "startup-snapshot",
    pollFallbackTracksLatest: true
  });
  watchDir(latestReviewDir, "reviews", mcp);
} else {
  debug("watching reviews watcher snapshot", {
    dir: null,
    generation: null,
    mode: "startup-snapshot",
    pollFallbackTracksLatest: true
  });
}
startPollFallback(mcp);
process.on("SIGINT", () => process.exit(0));
//# sourceMappingURL=mcp-server.mjs.map