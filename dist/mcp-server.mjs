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
  return trimAddress(value).replace(/-/g, "_");
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
  RECEIPTS_DIR: () => RECEIPTS_DIR,
  RECEIPTS_LOCK: () => RECEIPTS_LOCK,
  RECEIPTS_PATH: () => RECEIPTS_PATH,
  REVIEWS_DIR: () => REVIEWS_DIR,
  SERVER_START: () => SERVER_START,
  buildHeartbeatConnectHash: () => buildHeartbeatConnectHash,
  canonicalizeAgentId: () => canonicalizeAgentId2,
  claimAgentName: () => claimAgentName,
  debug: () => debug,
  demoteAgentName: () => demoteAgentName,
  getAgentId: () => getAgentId,
  getAgentName: () => getAgentName,
  getLastActivityTime: () => getLastActivityTime,
  getLatestReviewDir: () => getLatestReviewDir,
  getRecentSenders: () => getRecentSenders,
  getSourceDir: () => getSourceDir,
  getSourceKey: () => getSourceKey,
  isForMe: () => isForMe,
  isIdLocked: () => isIdLocked,
  isNameConfirmed: () => isNameConfirmed,
  normalizeSources: () => normalizeSources,
  parseFilename: () => parseFilename,
  parseFrontmatter: () => parseFrontmatter,
  parseMessageRoute: () => parseMessageRoute,
  resolveCurrentInstanceId: () => resolveCurrentInstanceId,
  resolveKnownInstanceId: () => resolveKnownInstanceId,
  setAgentName: () => setAgentName,
  stripBom: () => stripBom,
  stripFrontmatter: () => stripFrontmatter,
  updateActivityTime: () => updateActivityTime
});
import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { join, resolve } from "path";
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
    const statePath = join(stateDir, "state.json");
    if (!existsSync(statePath)) return null;
    const state = JSON.parse(readFileSync(statePath, "utf-8"));
    return state.instances ?? null;
  } catch {
    return null;
  }
}
function resolveSingleCodexBootstrap() {
  const instances = loadStateInstances();
  if (!instances) return null;
  const installedCodexInstances = Object.entries(instances).filter(
    ([, instance2]) => instance2?.runtime === "codex" && instance2?.installed
  );
  if (installedCodexInstances.length !== 1) return null;
  const [instanceId, instance] = installedCodexInstances[0];
  return {
    agentId: normalizeAgentId(instanceId),
    agentName: typeof instance.agentName === "string" && !isPlaceholderAgentValue(instance.agentName) ? instance.agentName : null
  };
}
function resolveInitialId(stateBootstrap2) {
  const envId = process.env.TAP_AGENT_ID;
  if (isConcreteIdentity(envId)) return normalizeAgentId(envId);
  const envName = process.env.TAP_AGENT_NAME;
  if (isConcreteIdentity(envName)) return normalizeAgentId(envName);
  return stateBootstrap2?.agentId ?? "unknown";
}
function resolveNameFromState(agentId, stateBootstrap2) {
  if (agentId === "unknown") return null;
  if (stateBootstrap2?.agentId === agentId && stateBootstrap2.agentName) {
    return stateBootstrap2.agentName;
  }
  try {
    const instances = loadStateInstances();
    if (!instances) return null;
    const instance = instances[agentId] ?? instances[agentId.replace(/_/g, "-")];
    return typeof instance?.agentName === "string" && !isPlaceholderAgentValue(instance.agentName) ? instance.agentName : null;
  } catch {
    return null;
  }
}
function getAgentId() {
  return _agentId;
}
function getAgentName() {
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
    ([, instance]) => instance?.installed && instance.agentName === displayName
  );
  return matches.length === 1 ? matches[0][0] : null;
}
function resolveCurrentInstanceId() {
  return resolveKnownInstanceId(_agentId, _agentName);
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
  if (!_idLocked) {
    _agentId = canonicalizeAgentId(name);
    _idLocked = true;
  }
}
function claimAgentName(name) {
  const oldName = _agentName;
  const wasIdLocked = _idLocked;
  if (_nameConfirmed && name !== oldName) {
    return {
      ok: false,
      currentName: oldName,
      agentId: _agentId
    };
  }
  setAgentName(name);
  return {
    ok: true,
    oldName,
    agentId: _agentId,
    wasIdLocked
  };
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
function debug(message) {
  console.error(`[tap-comms] ${message}`);
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
    type: fields.type
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
  return matchesAgentRecipient(to, _agentId, _agentName);
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
  if (!existsSync(REVIEWS_DIR)) return null;
  const gens = readdirSync(REVIEWS_DIR).filter((entry) => entry.startsWith("gen")).sort();
  return gens.length ? join(REVIEWS_DIR, gens[gens.length - 1]) : null;
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
  if (!existsSync(INBOX_DIR)) return senders;
  const cutoff = Date.now() - 24 * 60 * 60 * 1e3;
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
var RAW_COMMS_DIR, COMMS_DIR, INBOX_DIR, REVIEWS_DIR, FINDINGS_DIR, RECEIPTS_DIR, RECEIPTS_PATH, RECEIPTS_LOCK, HEARTBEATS_PATH, HEARTBEATS_LOCK, ARCHIVE_DIR, DB_PATH, SERVER_START, stateBootstrap, _agentId, _agentName, _idLocked, _nameConfirmed, _lastActivityTime;
var init_tap_utils = __esm({
  "packages/tap-plugin/channels/tap-utils.ts"() {
    "use strict";
    init_tap_identity();
    RAW_COMMS_DIR = process.env.TAP_COMMS_DIR;
    if (!RAW_COMMS_DIR) {
      console.error(
        "[tap-comms] FATAL: TAP_COMMS_DIR not set. Set via env or .tap-config"
      );
      process.exit(1);
    }
    COMMS_DIR = resolve(RAW_COMMS_DIR);
    INBOX_DIR = join(COMMS_DIR, "inbox");
    REVIEWS_DIR = join(COMMS_DIR, "reviews");
    FINDINGS_DIR = join(COMMS_DIR, "findings");
    RECEIPTS_DIR = join(COMMS_DIR, "receipts");
    RECEIPTS_PATH = join(RECEIPTS_DIR, "receipts.json");
    RECEIPTS_LOCK = join(RECEIPTS_DIR, ".lock");
    HEARTBEATS_PATH = join(COMMS_DIR, "heartbeats.json");
    HEARTBEATS_LOCK = join(COMMS_DIR, ".heartbeats.lock");
    ARCHIVE_DIR = join(COMMS_DIR, "archive");
    DB_PATH = join(COMMS_DIR, "tap.db");
    SERVER_START = Date.now();
    stateBootstrap = resolveSingleCodexBootstrap();
    _agentId = resolveInitialId(stateBootstrap);
    _agentName = resolveNameFromState(_agentId, stateBootstrap) ?? (isConcreteIdentity(process.env.TAP_AGENT_NAME) ? process.env.TAP_AGENT_NAME : "unknown");
    _idLocked = _agentId !== "unknown";
    _nameConfirmed = !isPlaceholderAgentValue(_agentName);
    _lastActivityTime = (/* @__PURE__ */ new Date()).toISOString();
  }
});

// packages/tap-plugin/channels/tap-io.ts
var tap_io_exports = {};
__export(tap_io_exports, {
  acquireLock: () => acquireLock,
  ensureReceiptsDir: () => ensureReceiptsDir,
  formatAgentLabel: () => formatAgentLabel,
  getUnreadItems: () => getUnreadItems,
  loadHeartbeats: () => loadHeartbeats,
  loadReceipts: () => loadReceipts,
  readFiles: () => readFiles,
  releaseLock: () => releaseLock,
  resolveAgentLabel: () => resolveAgentLabel,
  saveHeartbeats: () => saveHeartbeats,
  saveReceipts: () => saveReceipts,
  seedStartupFiles: () => seedStartupFiles,
  startupFiles: () => startupFiles
});
import {
  existsSync as existsSync3,
  mkdirSync as mkdirSync2,
  readFileSync as readFileSync3,
  readdirSync as readdirSync3,
  renameSync as renameSync2,
  statSync as statSync3,
  unlinkSync as unlinkSync2,
  writeFileSync as writeFileSync2
} from "fs";
import { createHash } from "crypto";
import { join as join3 } from "path";
function getBridgeProcessedDirs() {
  const now = Date.now();
  if (now - _bridgeDirsCachedAt < BRIDGE_DIR_CACHE_TTL_MS) {
    return _bridgeProcessedDirs;
  }
  _bridgeDirsCachedAt = now;
  if (!REPO_ROOT) {
    _bridgeProcessedDirs = [];
    return _bridgeProcessedDirs;
  }
  const tmpDir = join3(REPO_ROOT, ".tmp");
  if (!existsSync3(tmpDir)) {
    _bridgeProcessedDirs = [];
    return _bridgeProcessedDirs;
  }
  try {
    _bridgeProcessedDirs = readdirSync3(tmpDir).filter((d) => d.startsWith("codex-app-server-bridge")).map((d) => join3(tmpDir, d, "processed")).filter((p) => existsSync3(p));
  } catch {
    _bridgeProcessedDirs = [];
  }
  return _bridgeProcessedDirs;
}
function isBridgeProcessed(filePath, mtimeMs) {
  const dirs = getBridgeProcessedDirs();
  if (dirs.length === 0) return false;
  const markerId = createHash("sha1").update(`${filePath}|${mtimeMs}`).digest("hex");
  const markerFile = `${markerId}.done`;
  return dirs.some((dir) => existsSync3(join3(dir, markerFile)));
}
function acquireLock(lockPath, retries = 3, delayMs = 100) {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      writeFileSync2(lockPath, String(process.pid), { flag: "wx" });
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
  if (!existsSync3(RECEIPTS_DIR)) mkdirSync2(RECEIPTS_DIR, { recursive: true });
}
function loadReceipts() {
  try {
    return JSON.parse(readFileSync3(RECEIPTS_PATH, "utf-8"));
  } catch {
    return {};
  }
}
function saveReceipts(store) {
  ensureReceiptsDir();
  const tmpPath = RECEIPTS_PATH + ".tmp";
  writeFileSync2(tmpPath, JSON.stringify(store, null, 2), "utf-8");
  renameSync2(tmpPath, RECEIPTS_PATH);
}
function loadHeartbeats() {
  try {
    return JSON.parse(readFileSync3(HEARTBEATS_PATH, "utf-8"));
  } catch {
    return {};
  }
}
function saveHeartbeats(store) {
  const tmpPath = HEARTBEATS_PATH + ".tmp";
  writeFileSync2(tmpPath, JSON.stringify(store, null, 2), "utf-8");
  renameSync2(tmpPath, HEARTBEATS_PATH);
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
    if (heartbeat.agent?.trim() === normalized) {
      return formatAgentLabel(agentId, heartbeat.agent);
    }
  }
  return normalized;
}
function seedStartupFiles(source) {
  const dir = getSourceDir(source);
  if (!dir || !existsSync3(dir)) return;
  for (const filename of readdirSync3(dir)) {
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
  let joinedAtMs = 0;
  if (agentId !== "unknown") {
    try {
      heartbeatStore = loadHeartbeats();
      const entry = heartbeatStore[agentId] ?? heartbeatStore[agentName];
      if (entry?.joinedAt) {
        joinedAtMs = new Date(entry.joinedAt).getTime();
      }
    } catch {
    }
  }
  const effectiveSinceMs = Math.max(sinceMs, joinedAtMs);
  const parsedLimit = typeof options?.limit === "number" ? options.limit : Number.parseInt(String(options?.limit ?? "20"), 10);
  const limit = Number.isFinite(parsedLimit) ? Math.max(1, Math.min(100, parsedLimit)) : 20;
  const items = [];
  for (const source of sources) {
    const dir = getSourceDir(source);
    if (!dir || !existsSync3(dir)) continue;
    const filenames = readdirSync3(dir).filter((filename) => filename.endsWith(".md")).sort();
    for (const filename of filenames) {
      const key = getSourceKey(source, filename);
      if (startupFiles.has(key) || readFiles.has(key)) continue;
      const fullPath = join3(dir, filename);
      let mtime;
      try {
        mtime = statSync3(fullPath).mtimeMs;
      } catch {
        continue;
      }
      if (effectiveSinceMs && mtime < effectiveSinceMs) continue;
      if (isBridgeProcessed(fullPath, mtime)) {
        readFiles.add(key);
        continue;
      }
      let content;
      try {
        content = stripBom(readFileSync3(fullPath, "utf-8"));
      } catch {
        continue;
      }
      let from = source;
      let to = "all";
      let subject = filename.replace(/\.md$/, "");
      if (source === "inbox") {
        const fm = parseFrontmatter(content);
        const parsed = fm ? { from: fm.from, to: fm.to, subject: fm.subject } : parseFilename(filename);
        if (!parsed || !isForMe(parsed.to)) continue;
        if (isOwnMessageAddress(parsed.from, getAgentId(), getAgentName()))
          continue;
        from = resolveAgentLabel(fm?.from_name ?? parsed.from, heartbeatStore);
        to = resolveAgentLabel(fm?.to_name ?? parsed.to, heartbeatStore);
        subject = parsed.subject;
        if (fm && includeContent) {
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
var startupFiles, readFiles, REPO_ROOT, BRIDGE_DIR_CACHE_TTL_MS, _bridgeProcessedDirs, _bridgeDirsCachedAt;
var init_tap_io = __esm({
  "packages/tap-plugin/channels/tap-io.ts"() {
    "use strict";
    init_tap_utils();
    init_tap_identity();
    startupFiles = /* @__PURE__ */ new Set();
    readFiles = /* @__PURE__ */ new Set();
    REPO_ROOT = process.env.TAP_REPO_ROOT ?? null;
    BRIDGE_DIR_CACHE_TTL_MS = 3e4;
    _bridgeProcessedDirs = [];
    _bridgeDirsCachedAt = 0;
  }
});

// packages/tap-plugin/channels/tap-comms.ts
init_tap_identity();
init_tap_utils();
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema
} from "@modelcontextprotocol/sdk/types.js";
import { existsSync as existsSync8, mkdirSync as mkdirSync3, readFileSync as readFileSync7, writeFileSync as writeFileSync3 } from "fs";
import { join as join7 } from "path";

// packages/tap-plugin/channels/tap-claims.ts
init_tap_utils();
import {
  existsSync as existsSync2,
  mkdirSync,
  readFileSync as readFileSync2,
  writeFileSync,
  unlinkSync,
  readdirSync as readdirSync2,
  openSync,
  closeSync,
  renameSync,
  statSync as statSync2,
  constants
} from "fs";
import { join as join2 } from "path";
import { randomUUID } from "crypto";
var CLAIMS_DIR = join2(COMMS_DIR, ".claims");
var CLAIM_TTL_MS = 5 * 60 * 1e3;
function ensureClaimsDir() {
  if (!existsSync2(CLAIMS_DIR)) {
    mkdirSync(CLAIMS_DIR, { recursive: true });
  }
}
function claimFilePath(name) {
  const safe = name.replace(/[/\\:*?"<>|]/g, "_");
  return join2(CLAIMS_DIR, `${safe}.json`);
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
  const envId = process.env.TAP_BRIDGE_INSTANCE_ID ?? process.env.TAP_AGENT_ID;
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
  if (!existsSync2(filePath)) return null;
  try {
    const raw = readFileSync2(filePath, "utf-8");
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
  if (existsSync2(lockPath)) {
    try {
      const { mtimeMs } = statSync2(lockPath);
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
  if (!existsSync2(filePath)) return false;
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

// packages/tap-plugin/channels/tap-comms.ts
init_tap_io();

// packages/tap-plugin/channels/tap-db.ts
init_tap_utils();
import { existsSync as existsSync4, readFileSync as readFileSync4, readdirSync as readdirSync4, statSync as statSync4 } from "fs";
import { join as join4 } from "path";
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
    if (existsSync4(INBOX_DIR)) {
      for (const filename of readdirSync4(INBOX_DIR)) {
        if (!filename.endsWith(".md")) continue;
        const match = filename.match(/^\d{8}-(.+?)-(.+?)-(.+)\.md$/);
        if (!match) continue;
        try {
          const mtime = statSync4(join4(INBOX_DIR, filename)).mtimeMs;
          db.run(
            "INSERT OR IGNORE INTO messages (filename, from_agent, to_agent, subject, source, mtime) VALUES (?, ?, ?, ?, ?, ?)",
            [filename, match[1], match[2], match[3], "inbox", mtime]
          );
        } catch {
        }
      }
    }
    debug("auto-sync: inbox files imported into DB");
    const rcptPath = join4(RECEIPTS_DIR, "receipts.json");
    if (existsSync4(rcptPath)) {
      try {
        const rcptStore = JSON.parse(readFileSync4(rcptPath, "utf-8"));
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
  if (existsSync4(INBOX_DIR)) {
    for (const filename of readdirSync4(INBOX_DIR)) {
      if (!filename.endsWith(".md")) continue;
      const parsed = parseFilename(filename);
      if (!parsed) continue;
      try {
        const mtime = statSync4(join4(INBOX_DIR, filename)).mtimeMs;
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
init_tap_utils();
import { existsSync as existsSync5, readFileSync as readFileSync5, statSync as statSync5, watch } from "fs";
import { join as join5 } from "path";
init_tap_io();
init_tap_identity();
var notifiedFiles = /* @__PURE__ */ new Set();
var recentEvents = /* @__PURE__ */ new Map();
var inFlightFiles = /* @__PURE__ */ new Set();
var DEBOUNCE_MS = 200;
var MAX_READY_ATTEMPTS = 6;
var READY_RETRY_MS = 40;
var WATCH_RESTART_MS = 1e3;
var RECENT_EVENT_TTL_MS = 5 * 60 * 1e3;
var RECENT_EVENT_CLEANUP_MS = 60 * 1e3;
function sleep(ms) {
  return new Promise((resolve2) => setTimeout(resolve2, ms));
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
      const content = stripBom(readFileSync5(filepath, "utf-8"));
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
  if (parsed && isOwnMessageAddress(parsed.from, agentId, agentName)) {
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
  if (notifiedFiles.has(key) || inFlightFiles.has(key) || readFiles.has(key))
    return false;
  inFlightFiles.add(key);
  try {
    const filepath = join5(dir, filename);
    const file = await waitForFileReady(filepath);
    if (file === "stale") {
      notifiedFiles.add(key);
      return false;
    }
    if (!file) return false;
    let parsed = null;
    if (source === "inbox") {
      const fm = parseFrontmatter(file.content);
      parsed = fm ? { from: fm.from, to: fm.to, subject: fm.subject } : parseFilename(filename);
    } else {
      parsed = parseFilename(filename);
    }
    if (source === "inbox" && (!parsed || !isForMe(parsed.to))) return false;
    if (isOwnMessageArtifact(source, filename, parsed)) return false;
    const rawFrom = parsed?.from || source;
    const rawTo = parsed?.to || "all";
    const from = parsed ? resolveAgentLabel(parsed.from) : source;
    const to = parsed ? resolveAgentLabel(parsed.to) : "all";
    const subject = parsed?.subject || filename.replace(/\.md$/, "");
    dbInsertMessage(filename, rawFrom, rawTo, subject, source, Date.now());
    debug(`sending notification [${source}]: from=${from} to=${to}`);
    await mcp2.notification({
      method: "notifications/claude/channel",
      params: {
        content: file.content,
        meta: { from, to, subject, filename, source }
      }
    });
    notifiedFiles.add(key);
    return true;
  } finally {
    inFlightFiles.delete(key);
  }
}
function watchDir(dir, source, mcp2) {
  if (!existsSync5(dir)) return;
  let watcher = null;
  let restartTimer = null;
  const scheduleRestart = (reason) => {
    if (restartTimer) return;
    debug(`fs.watch restart scheduled [${source}]: ${reason}`);
    restartTimer = setTimeout(() => {
      restartTimer = null;
      if (!existsSync5(dir)) {
        debug(`fs.watch restart skipped [${source}]: missing ${dir}`);
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
        debug(`fs.watch [${source}]: ${eventType} ${filename}`);
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
        debug(
          `fs.watch error [${source}]: ${error instanceof Error ? error.message : String(error)}`
        );
        scheduleRestart("error");
      });
      watcher.on("close", () => {
        debug(`fs.watch closed [${source}]`);
        scheduleRestart("close");
      });
      debug(`fs.watch active [${source}]: ${dir}`);
    } catch (error) {
      debug(
        `fs.watch start failed [${source}]: ${error instanceof Error ? error.message : String(error)}`
      );
      scheduleRestart("start-failed");
    }
  };
  startWatcher();
}

// packages/tap-plugin/channels/tap-presence.ts
init_tap_utils();
import { existsSync as existsSync6, readFileSync as readFileSync6 } from "fs";
import { join as join6 } from "path";
function parseJsonFile(filePath) {
  if (!existsSync6(filePath)) return null;
  try {
    return JSON.parse(readFileSync6(filePath, "utf-8"));
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
  return new Date(heartbeat.lastActivity ?? heartbeat.timestamp ?? 0).getTime();
}
function resolveHeartbeatSource(heartbeat) {
  return heartbeat.source === "bridge-dispatch" ? "bridge-dispatch" : "mcp-direct";
}
function resolveBridgeStatus(stateDir, instanceId) {
  if (!instanceId) {
    return {
      presence: "mcp-only",
      lifecycle: null,
      session: null,
      idleSince: null
    };
  }
  const bridgeState = parseJsonFile(
    join6(stateDir, "pids", `bridge-${instanceId}.json`)
  );
  if (!bridgeState) {
    return {
      presence: "mcp-only",
      lifecycle: null,
      session: null,
      idleSince: null
    };
  }
  if (!isProcessAlive2(bridgeState.pid)) {
    return {
      presence: "bridge-stale",
      lifecycle: "bridge-stale",
      session: null,
      idleSince: null
    };
  }
  const runtimeHeartbeat = bridgeState.runtimeStateDir ? parseJsonFile(
    join6(bridgeState.runtimeStateDir, "heartbeat.json")
  ) : null;
  const savedThread = bridgeState.runtimeStateDir ? parseJsonFile(
    join6(bridgeState.runtimeStateDir, "thread.json")
  ) : null;
  if (!runtimeHeartbeat || runtimeHeartbeat.initialized === false) {
    return {
      presence: "bridge-live",
      lifecycle: "initializing",
      session: "initializing",
      idleSince: null
    };
  }
  const lifecycle = runtimeHeartbeat.threadId && runtimeHeartbeat.connected !== false ? "ready" : "degraded-no-thread";
  const session = runtimeHeartbeat.activeTurnId || runtimeHeartbeat.turnState === "active" ? "active" : runtimeHeartbeat.turnState === "waiting-approval" ? "waiting-approval" : runtimeHeartbeat.turnState === "disconnected" || runtimeHeartbeat.connected === false ? "disconnected" : "idle";
  const idleSince = session === "idle" || session === "waiting-approval" ? runtimeHeartbeat.idleSince ?? null : null;
  return {
    presence: "bridge-live",
    lifecycle: lifecycle === "degraded-no-thread" && !savedThread?.threadId ? "degraded-no-thread" : lifecycle,
    session,
    idleSince
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
function dedupeByConnectHash(candidates) {
  const deduped = /* @__PURE__ */ new Map();
  for (const candidate of candidates) {
    const existing = deduped.get(candidate.connectHash);
    if (!existing || compareCandidates(candidate, existing) < 0) {
      deduped.set(candidate.connectHash, candidate);
    }
  }
  return [...deduped.values()].sort(compareCandidates);
}
function buildPresenceCandidates(store, minutes) {
  const cutoff = minutes == null ? null : Date.now() - minutes * 60 * 1e3;
  const stateDir = process.env.TAP_STATE_DIR;
  const agents = [];
  for (const [agentId, heartbeat] of Object.entries(store)) {
    if (!heartbeat.id) continue;
    const lastActivityMs = getActivityMs(heartbeat);
    if (!Number.isFinite(lastActivityMs)) continue;
    if (cutoff != null && lastActivityMs < cutoff) continue;
    const displayName = heartbeat.agent ?? null;
    const instanceId = heartbeat.instanceId ?? resolveKnownInstanceId(agentId, displayName);
    const source = resolveHeartbeatSource(heartbeat);
    const connectHash = heartbeat.connectHash ?? buildHeartbeatConnectHash(instanceId, agentId);
    const bridge = stateDir != null ? resolveBridgeStatus(stateDir, instanceId) : {
      presence: "mcp-only",
      lifecycle: null,
      session: null,
      idleSince: null
    };
    const idleBasis = bridge.idleSince ?? heartbeat.lastActivity ?? heartbeat.timestamp ?? null;
    agents.push({
      id: agentId,
      agent: formatAgentLabel2(agentId, displayName),
      status: heartbeat.status ?? "active",
      lastHeartbeat: heartbeat.timestamp ?? "",
      lastActivity: heartbeat.lastActivity ?? heartbeat.timestamp ?? "",
      alive: heartbeat.status !== "signing-off",
      source,
      instanceId,
      connectHash,
      presence: bridge.presence,
      lifecycle: bridge.lifecycle,
      session: bridge.session,
      idleSeconds: parseIsoAgeSeconds(idleBasis),
      displayName,
      lastActivityMs
    });
  }
  return agents.sort(compareCandidates);
}
function buildWhoAgents(store, minutes) {
  return dedupeByConnectHash(buildPresenceCandidates(store, minutes));
}
function resolvePreferredRecipient(store, recipient) {
  const allCandidates = buildPresenceCandidates(store, null);
  const exactId = allCandidates.find((candidate) => candidate.id === recipient);
  if (exactId) {
    return {
      target: exactId.id,
      found: true,
      ambiguous: false,
      candidates: [exactId.id],
      warning: null
    };
  }
  const deduped = dedupeByConnectHash(allCandidates);
  const nameMatches = deduped.filter(
    (candidate) => candidate.displayName === recipient
  );
  if (nameMatches.length === 1) {
    return {
      target: nameMatches[0].id,
      found: true,
      ambiguous: false,
      candidates: [nameMatches[0].id],
      warning: null
    };
  }
  if (nameMatches.length > 1) {
    const sorted = [...nameMatches].sort(compareCandidates);
    const winner = sorted[0];
    const candidateIds = sorted.map((candidate) => candidate.id);
    return {
      target: winner.id,
      found: true,
      ambiguous: true,
      candidates: candidateIds,
      warning: `\u26A0\uFE0F Routed "${recipient}" \u2192 "${winner.id}" (${winner.presence}/${winner.source}, preferred of ${candidateIds.join(", ")}).`
    };
  }
  return {
    target: recipient,
    found: false,
    ambiguous: false,
    candidates: [],
    warning: null
  };
}

// packages/tap-plugin/channels/tap-comms.ts
import { readdirSync as readdirSync6, renameSync as renameSync3, statSync as statSync7, unlinkSync as unlinkSync3 } from "fs";

// packages/tap-plugin/channels/tap-poll-fallback.ts
init_tap_utils();
import { existsSync as existsSync7, readdirSync as readdirSync5, statSync as statSync6 } from "fs";
var POLL_INTERVAL_MS = process.platform === "win32" ? 1e4 : 3e4;
var POLL_SOURCES = ["inbox", "reviews"];
var recoveredCount = 0;
var pollCycles = 0;
async function pollOnce(mcp2) {
  let recovered = 0;
  for (const source of POLL_SOURCES) {
    const dir = getSourceDir(source);
    if (!dir || !existsSync7(dir)) continue;
    let filenames;
    try {
      filenames = readdirSync5(dir).filter((f) => f.endsWith(".md"));
    } catch {
      continue;
    }
    for (const filename of filenames) {
      const filepath = `${dir}/${filename}`;
      try {
        const mtime = statSync6(filepath).mtimeMs;
        if (mtime < SERVER_START - 5e3) continue;
      } catch {
        continue;
      }
      try {
        const sent = await processWatchFile(dir, source, filename, mcp2);
        if (sent) {
          recovered++;
          debug(`poll-fallback recovered [${source}]: ${filename}`);
        }
      } catch {
      }
    }
  }
  return recovered;
}
function startPollFallback(mcp2) {
  debug(`poll-fallback: starting (interval=${POLL_INTERVAL_MS}ms)`);
  const timer = setInterval(async () => {
    pollCycles++;
    try {
      const count = await pollOnce(mcp2);
      if (count > 0) {
        recoveredCount += count;
        debug(
          `poll-fallback: recovered ${count} missed message(s) (total: ${recoveredCount})`
        );
      }
    } catch (error) {
      debug(
        `poll-fallback error: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }, POLL_INTERVAL_MS);
  timer.unref();
  setTimeout(async () => {
    pollCycles++;
    try {
      const count = await pollOnce(mcp2);
      if (count > 0) {
        recoveredCount += count;
        debug(`poll-fallback (initial): recovered ${count} missed message(s)`);
      }
    } catch {
    }
  }, 5e3).unref();
}

// packages/tap-plugin/channels/tap-comms.ts
initDb();
autoSyncOnStartup();
seedStartupFiles("inbox");
seedStartupFiles("reviews");
seedStartupFiles("findings");
var ONBOARDING_TEASER_LINES = 10;
function loadOnboardingTeaser() {
  const commsDir = process.env.TAP_COMMS_DIR;
  if (!commsDir) return "";
  const stateDir = process.env.TAP_STATE_DIR;
  const agentId = getAgentId();
  if (stateDir && agentId !== "unknown") {
    try {
      const markerPath = join7(stateDir, "onboarded.json");
      if (existsSync8(markerPath)) {
        const store = JSON.parse(readFileSync7(markerPath, "utf-8"));
        if (store[agentId]) return "";
      }
    } catch {
    }
  }
  try {
    const welcomePath = join7(commsDir, "onboarding", "welcome.md");
    if (!existsSync8(welcomePath)) return "";
    const content = readFileSync7(welcomePath, "utf-8");
    const lines = content.split("\n").slice(0, ONBOARDING_TEASER_LINES);
    if (stateDir && agentId !== "unknown") {
      try {
        const markerPath = join7(stateDir, "onboarded.json");
        let store = {};
        if (existsSync8(markerPath)) {
          store = JSON.parse(readFileSync7(markerPath, "utf-8"));
        }
        if (!store[agentId]) {
          store[agentId] = { onboardedAt: (/* @__PURE__ */ new Date()).toISOString() };
          mkdirSync3(stateDir, { recursive: true });
          writeFileSync3(markerPath, JSON.stringify(store, null, 2), "utf-8");
        }
      } catch {
      }
    }
    return "\n\n--- Onboarding ---\n" + lines.join("\n") + "\n(Use tap_onboard tool for full onboarding guide.)";
  } catch {
    return "";
  }
}
var baseInstructions = 'You are connected to the tap-comms channel. Messages from other agents may arrive as <channel source="tap-comms" from="X" to="Y" subject="Z"> notifications. If your client does not surface Claude channel notifications, call tap_list_unread to pull pending inbox and review messages. Reply using the tap_reply tool to send messages back to other agents or the control tower.';
var mcp = new Server(
  { name: "tap-comms", version: "0.2.2" },
  {
    capabilities: {
      experimental: { "claude/channel": {} },
      tools: {}
    },
    instructions: baseInstructions + loadOnboardingTeaser()
  }
);
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
          }
        },
        required: ["name"]
      }
    },
    {
      name: "tap_reply",
      description: "Send a message to another tap agent via comms inbox.",
      inputSchema: {
        type: "object",
        properties: {
          to: { type: "string", description: "Recipient agent name." },
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
          }
        },
        required: ["to", "subject", "content"]
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
            description: "Consider agents alive if heartbeat within this many minutes. Default 10."
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
    const resolvedInstanceId = resolveCurrentInstanceId() ?? existing?.instanceId ?? null;
    const connectHash = buildHeartbeatConnectHash(resolvedInstanceId, id);
    const preserveBridgeSource = existing?.source === "bridge-dispatch" && existing.connectHash === connectHash;
    store[id] = {
      id,
      agent: name,
      timestamp: existing?.timestamp ?? (/* @__PURE__ */ new Date()).toISOString(),
      lastActivity: getLastActivityTime(),
      joinedAt: existing?.joinedAt,
      status: existing?.status ?? "active",
      source: preserveBridgeSource ? "bridge-dispatch" : "mcp-direct",
      instanceId: resolvedInstanceId,
      bridgePid: preserveBridgeSource ? existing?.bridgePid ?? null : null,
      connectHash
    };
    saveHeartbeats(store);
  } catch {
  } finally {
    releaseLock(HEARTBEATS_LOCK);
  }
}
mcp.setRequestHandler(CallToolRequestSchema, async (req) => {
  updateActivityTime();
  const currentId = getAgentId();
  const currentName = getAgentName();
  if (currentId !== "unknown" && req.params.name !== "tap_set_name") {
    persistActivity(currentId, currentName);
  }
  if (req.params.name === "tap_set_name") {
    const { name } = req.params.arguments;
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
    if (isConfirmed() && currentName2() !== name) {
      return {
        content: [
          {
            type: "text",
            text: `Rejected: Name already confirmed as "${currentName2()}". tap_set_name can only be called once per session. Agent ID: ${getAgentId()} (immutable).`
          }
        ]
      };
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
        const resolvedInstanceId = resolveCurrentInstanceId() ?? oldEntry?.instanceId ?? null;
        const connectHash = buildHeartbeatConnectHash(
          resolvedInstanceId,
          agentId
        );
        const preserveBridgeSource = oldEntry?.source === "bridge-dispatch" && oldEntry.connectHash === connectHash;
        store[agentId] = {
          id: agentId,
          agent: name,
          timestamp: now,
          lastActivity: getLastActivityTime(),
          joinedAt: oldEntry?.joinedAt ?? now,
          status: "active",
          source: preserveBridgeSource ? "bridge-dispatch" : "mcp-direct",
          instanceId: resolvedInstanceId,
          bridgePid: preserveBridgeSource ? oldEntry?.bridgePid ?? null : null,
          connectHash
        };
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
        saveHeartbeats(store);
      } catch {
      } finally {
        releaseLock(HEARTBEATS_LOCK);
      }
    }
    const stateDir = process.env.TAP_STATE_DIR;
    if (stateDir) {
      try {
        const statePath = join7(stateDir, "state.json");
        if (existsSync8(statePath)) {
          const state = JSON.parse(readFileSync7(statePath, "utf-8"));
          const instanceKey = agentId.replace(/_/g, "-");
          const instance = state.instances?.[agentId] ?? state.instances?.[instanceKey];
          if (instance) {
            instance.agentName = name;
            const tmp = `${statePath}.tmp.${process.pid}`;
            writeFileSync3(tmp, JSON.stringify(state, null, 2), "utf-8");
            try {
              renameSync3(tmp, statePath);
            } catch {
              try {
                renameSync3(tmp, statePath);
              } catch {
                try {
                  unlinkSync3(tmp);
                } catch {
                }
              }
            }
            debug(`backwrite agentName="${name}" to state.json for ${agentId}`);
          }
        }
      } catch {
      }
    }
    if (oldName === "unknown" || oldName === "unnamed") {
      try {
        const repoRoot = process.env.TAP_REPO_ROOT ?? ".";
        let towerName = null;
        const cfgPath = join7(repoRoot, "tap-config.json");
        if (existsSync8(cfgPath)) {
          const cfg = JSON.parse(readFileSync7(cfgPath, "utf-8"));
          towerName = cfg.towerName ?? null;
        }
        let runtime = process.env.TAP_BRIDGE_RUNTIME ?? null;
        if (!runtime && stateDir) {
          try {
            const statePath = join7(stateDir, "state.json");
            if (existsSync8(statePath)) {
              const state = JSON.parse(readFileSync7(statePath, "utf-8"));
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
            const notifyPath = join7(INBOX_DIR, notifyFilename);
            writeFileSync3(
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
    let text = `Name set: ${name} (was: ${oldName}). Messages to "${name}", "${agentId}", "\uC804\uCCB4", or "all" will be received.`;
    if (!wasIdLocked)
      text += `
Agent ID locked: ${agentId} (immutable for this session)`;
    if (isDuplicate)
      text += `
\u26A0\uFE0F WARNING: "${name}" was already used in the last 24h. Pick a different name to avoid confusion.`;
    if (activeList) text += `
Recent active names: ${activeList}`;
    return { content: [{ type: "text", text }] };
  }
  if (req.params.name === "tap_reply") {
    let resolveRecipient2 = function(recipient) {
      const resolution = resolvePreferredRecipient(store, recipient);
      if (resolution.found) {
        return {
          target: resolution.target,
          found: true,
          warning: resolution.warning
        };
      }
      return {
        target: recipient,
        found: false,
        warning: `\u26A0\uFE0F WARNING: "${recipient}" is not a known agent. Check spelling. Known: ${knownList}`
      };
    };
    var resolveRecipient = resolveRecipient2;
    const {
      to: rawTo,
      subject: rawSubject,
      content,
      cc: rawCc
    } = req.params.arguments;
    const to = typeof rawTo === "string" ? rawTo.trim() : "";
    const subject = typeof rawSubject === "string" ? rawSubject.trim() : "";
    if (!to) {
      return {
        content: [
          {
            type: "text",
            text: 'Rejected: "to" is required and must be a non-empty string.'
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
    const cc = normalizeRecipientList(rawCc, [to]);
    const recipientWarnings = [];
    const store = loadHeartbeats();
    const knownAgents = /* @__PURE__ */ new Set();
    for (const [key, hb] of Object.entries(store)) {
      if (!isPlaceholderAgentValue(key)) knownAgents.add(key);
      if (!isPlaceholderAgentValue(hb.agent)) {
        knownAgents.add(hb.agent);
      }
    }
    const knownList = [...knownAgents].filter((n) => n !== "unknown").join(", ");
    let resolvedTo = to;
    if (!isBroadcastRecipient(to)) {
      const resolution = resolveRecipient2(to);
      if (!resolution.found) {
        if (resolution.warning) recipientWarnings.push(resolution.warning);
      } else {
        resolvedTo = resolution.target;
        if (resolution.warning) recipientWarnings.push(resolution.warning);
      }
    }
    if (cc?.length) {
      for (const recipient of cc) {
        if (isBroadcastRecipient(recipient)) continue;
        const resolution = resolveRecipient2(recipient);
        if (resolution.warning) {
          recipientWarnings.push(
            resolution.warning.replace(`"${recipient}"`, `CC "${recipient}"`)
          );
        }
      }
    }
    const now = /* @__PURE__ */ new Date();
    const date = now.toISOString().slice(0, 10).replace(/-/g, "");
    const fromId = getAgentId();
    const fromName = getAgentName();
    const filename = `${date}-${fromId}-${resolvedTo}-${subject}.md`;
    const filepath = join7(INBOX_DIR, filename);
    const ccHeader = cc?.length ? `> CC: ${cc.join(", ")}

` : "";
    const frontmatter = [
      "---",
      "type: inbox",
      `from: ${fromId}`,
      `from_name: ${fromName}`,
      `to: ${resolvedTo}`,
      `to_name: ${to}`,
      `subject: ${subject}`,
      `sent_at: ${now.toISOString()}`,
      "---",
      ""
    ].join("\n");
    writeFileSync3(filepath, frontmatter + ccHeader + content, "utf-8");
    dbInsertMessage(
      filename,
      fromName,
      resolvedTo,
      subject,
      "inbox",
      Date.now()
    );
    const sent = [`Sent to ${to}: ${filename}`];
    if (cc?.length) {
      const writtenFiles = /* @__PURE__ */ new Set([filename]);
      for (const recipient of cc) {
        try {
          const resolvedRecipient = isBroadcastRecipient(recipient) ? recipient : resolveRecipient2(recipient).target;
          const ccFilename = `${date}-${fromId}-${resolvedRecipient}-${subject}.md`;
          if (writtenFiles.has(ccFilename)) {
            sent.push(`CC to ${recipient}: skipped (resolves to same target)`);
            continue;
          }
          writtenFiles.add(ccFilename);
          const ccFrontmatter = [
            "---",
            "type: inbox",
            `from: ${fromId}`,
            `from_name: ${fromName}`,
            `to: ${resolvedRecipient}`,
            `to_name: ${recipient}`,
            `subject: ${subject}`,
            `sent_at: ${now.toISOString()}`,
            "---",
            ""
          ].join("\n");
          writeFileSync3(
            join7(INBOX_DIR, ccFilename),
            ccFrontmatter + `> CC from message to ${to}

${content}`,
            "utf-8"
          );
          dbInsertMessage(
            ccFilename,
            fromName,
            resolvedRecipient,
            subject,
            "inbox",
            Date.now()
          );
          sent.push(`CC to ${recipient}: ${ccFilename}`);
        } catch (err) {
          sent.push(
            `CC to ${recipient}: FAILED (${err instanceof Error ? err.message : String(err)})`
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
    const broadcastId = getAgentId();
    const broadcastName = getAgentName();
    const filename = `${date}-${broadcastId}-\uC804\uCCB4-${subject}.md`;
    const broadcastFrontmatter = [
      "---",
      "type: inbox",
      `from: ${broadcastId}`,
      `from_name: ${broadcastName}`,
      "to: \uC804\uCCB4",
      `subject: ${subject}`,
      `sent_at: ${now.toISOString()}`,
      "---",
      ""
    ].join("\n");
    writeFileSync3(
      join7(INBOX_DIR, filename),
      broadcastFrontmatter + content,
      "utf-8"
    );
    dbInsertMessage(
      filename,
      broadcastName,
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
      if (!store[filename]) store[filename] = [];
      const readerId = getAgentId();
      const already = store[filename].some((r) => r.reader === readerId);
      if (!already) {
        const ts = (/* @__PURE__ */ new Date()).toISOString();
        store[filename].push({ reader: readerId, timestamp: ts });
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
    if (existsSync8(INBOX_DIR)) {
      for (const filename of readdirSync6(INBOX_DIR)) {
        if (!filename.endsWith(".md")) continue;
        try {
          if (statSync7(join7(INBOX_DIR, filename)).mtimeMs < cutoff) continue;
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
      const resolvedInstanceId = resolveCurrentInstanceId() ?? existing?.instanceId ?? null;
      const connectHash = buildHeartbeatConnectHash(resolvedInstanceId, hbId);
      const preserveBridgeSource = existing?.source === "bridge-dispatch" && existing.connectHash === connectHash;
      store[hbId] = {
        id: hbId,
        agent: hbName,
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
        lastActivity: getLastActivityTime(),
        joinedAt: existing?.joinedAt,
        status,
        source: preserveBridgeSource ? "bridge-dispatch" : "mcp-direct",
        instanceId: resolvedInstanceId,
        bridgePid: preserveBridgeSource ? existing?.bridgePid ?? null : null,
        connectHash
      };
      saveHeartbeats(store);
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
    const minutes = typeof req.params.arguments?.minutes === "number" ? req.params.arguments.minutes : 10;
    const store = loadHeartbeats();
    const agents = buildWhoAgents(store, minutes);
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
    if (!existsSync8(ARCHIVE_DIR)) mkdirSync3(ARCHIVE_DIR, { recursive: true });
    if (existsSync8(INBOX_DIR)) {
      for (const filename of readdirSync6(INBOX_DIR)) {
        if (!filename.endsWith(".md")) continue;
        const dateMatch = filename.match(/^(\d{8})-/);
        if (!dateMatch) continue;
        if (dateMatch[1] >= cutoffStr) continue;
        const filepath = join7(INBOX_DIR, filename);
        if (!dryRun) renameSync3(filepath, join7(ARCHIVE_DIR, filename));
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
    const markerPath = stateDir ? join7(stateDir, "onboarded.json") : null;
    if (markerPath) {
      try {
        if (existsSync8(markerPath)) {
          markerStore = JSON.parse(readFileSync7(markerPath, "utf-8"));
          if (markerStore[agentId]) {
            alreadyOnboarded = true;
          }
        }
      } catch {
      }
    }
    const onboardingDir = join7(commsDir, "onboarding");
    if (!existsSync8(onboardingDir)) {
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
    const allFiles = readdirSync6(onboardingDir).filter(
      (f) => f.endsWith(".md")
    );
    const files = [
      ...allFiles.filter((f) => f === "welcome.md"),
      ...allFiles.filter((f) => f !== "welcome.md").sort()
    ];
    for (const file of files) {
      try {
        const content = readFileSync7(join7(onboardingDir, file), "utf-8");
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
        writeFileSync3(
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
  throw new Error(`unknown tool: ${req.params.name}`);
});
await mcp.connect(new StdioServerTransport());
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
  debug(`watching reviews: ${latestReviewDir}`);
  watchDir(latestReviewDir, "reviews", mcp);
}
startPollFallback(mcp);
process.on("SIGINT", () => process.exit(0));
//# sourceMappingURL=mcp-server.mjs.map