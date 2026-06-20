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
import * as net from "net";
import { randomUUID } from "crypto";
var MAX_FRAME_BYTES = 256 * 1024 * 1024;
var DEFAULT_REQUEST_TIMEOUT_MS = 5e3;
var DEFAULT_TARGETED_REQUEST_VERSION = 1;
var DEFAULT_CODEX_IPC_PIPE_PATH = DEFAULT_CODEX_IPC_WINDOWS_PIPE_PATH;
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
    await new Promise((resolve3, reject) => {
      const cleanup = () => {
        clearTimeout(timeout);
        socket.removeListener("connect", onConnect);
        socket.removeListener("error", onError);
      };
      const onConnect = () => {
        cleanup();
        resolve3();
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
    const requestId = randomUUID();
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
    const promise = new Promise((resolve3, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(
          new Error(
            `Codex IPC request "${method}" timed out after ${this.requestTimeoutMs}ms`
          )
        );
      }, this.requestTimeoutMs);
      this.pendingRequests.set(requestId, { resolve: resolve3, reject, timeout });
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

// src/transport/experimental/codex-ipc-control.ts
import { randomUUID as randomUUID4 } from "crypto";

// src/transport/consent.ts
import { createHash, randomBytes, randomUUID as randomUUID2 } from "crypto";
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
  return createHash("sha256").update(
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
  const receiptId = randomUUID2();
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
import { randomUUID as randomUUID3 } from "crypto";
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
    grantId: `orphan-${Date.now().toString(36)}-${randomUUID3().slice(0, 8)}`,
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
    `${baseName}-${randomUUID3().replace(/-/g, "").slice(0, 6)}.md`
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
    return await new Promise((resolve3) => {
      let unsubscribe = null;
      const timeout = setTimeout(() => {
        unsubscribe?.();
        resolve3(this.getConversationSnapshot(conversationId));
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
        resolve3(
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
function createExperimentalCodexIpcControlTransport(options = {}) {
  return new ExperimentalCodexIpcControlTransport(options);
}
export {
  CODEX_IPC_DRIVE_METHODS,
  DEFAULT_CODEX_IPC_PIPE_PATH,
  DEFAULT_CODEX_IPC_WINDOWS_PIPE_PATH,
  ExperimentalCodexIpcControlTransport,
  ExperimentalCodexIpcObserveTransport,
  buildFollowerStartTurnParams,
  createExperimentalCodexIpcControlTransport,
  createExperimentalCodexIpcObserveTransport,
  decodeCodexIpcFrames,
  encodeCodexIpcFrame,
  isCodexIpcDefaultSupported,
  resolveCodexIpcPath
};
//# sourceMappingURL=index.mjs.map