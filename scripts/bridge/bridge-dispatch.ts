// bridge-dispatch.ts — Dispatch orchestration + heartbeat

import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import { join } from "path";
import {
  type BridgeRoutingSlot,
  type BridgeHealthState,
  type Candidate,
  COMMS_HEARTBEAT_LOCK_TIMEOUT_MS,
  COMMS_LOCK_STALE_AGE_MS,
  type HeadlessWarmupClient,
  type HeartbeatAddressRecord,
  type HeartbeatRecord,
  type HeartbeatStoreRecord,
  type HeartbeatStore,
  HEADLESS_WARMUP_PROMPT,
  HEADLESS_WARMUP_TIMEOUT_MS,
  type Options,
  type ThreadStateRecord,
  TURN_COMPLETION_POLL_MS,
  TURN_COMPLETION_REFRESH_MS,
} from "./bridge-types.ts";
import { createBridgeLogger } from "./bridge-logging.ts";
import {
  isWaitingApprovalStatus,
  normalizePersistedThreadCwd,
  shouldRetrySteerAsStart,
} from "./bridge-routing.ts";
import { getPendingCandidates } from "./bridge-candidates.ts";
import {
  buildUserInput,
  writeLastDispatch,
  writeProcessedMarker,
} from "./bridge-format.ts";
import { AppServerClient } from "./bridge-ws-client.ts";
import { ExperimentalCodexIpcControlTransport } from "../../src/transport/experimental/codex-ipc-control.ts";
import { writeConsentLedgerEvent } from "../../src/transport/consent-ledger.ts";

const dispatchLogger = createBridgeLogger("dispatch");
const heartbeatLogger = createBridgeLogger("heartbeat");
// Keep reservation ownership scoped to the current bridge process lifetime.
const DRIVE_DISPATCH_RESERVATION_OWNER_ID = randomUUID();
export const DRIVE_NOT_YET_WIRED_REASON =
  "missing pairToken / drive not yet wired (M345 Phase 2 / M355 pending)";
export const DRIVE_ACTION_NOT_YET_SUPPORTED_REASON =
  "drive action is not yet wired through bridge dispatch";

interface DriveDispatchTransport {
  connect(): Promise<unknown>;
  disconnect(): Promise<void>;
  startTurn(options: {
    conversationId: string;
    text: string;
    action?: string | null;
    consentRef?: string | null;
    hostId?: string | null;
    ownerClientId?: string | null;
  }): Promise<unknown>;
}

type DriveDispatchTransportFactory = (
  options: Options,
) => DriveDispatchTransport;

const DRIVE_START_TURN_ACTIONS = new Set([
  "start-turn",
  "thread-follower-start-turn",
]);

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function extractDriveTurnId(result: unknown): string | null {
  const response = asRecord(result);
  const payload = asRecord(response?.response);
  const body = asRecord(payload?.result);
  const nestedResult = asRecord(body?.result);
  const turn = asRecord(body?.turn) ?? asRecord(nestedResult?.turn);
  const turnId = turn?.id;
  return typeof turnId === "string" && turnId.trim() ? turnId.trim() : null;
}

function shouldTraceIpc(): boolean {
  const value = process.env.TAP_IPC_TRACE?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

function logIpcTrace(message: string, context?: Record<string, unknown>): void {
  if (!shouldTraceIpc()) {
    return;
  }
  dispatchLogger.info(`[ipc-trace] ${message}`, context);
}

function createDriveDispatchTransport(
  options: Options,
): DriveDispatchTransport {
  return new ExperimentalCodexIpcControlTransport({
    commsDir: options.commsDir,
    hostId: resolveBridgeHostId(options),
    clientType: "tap-bridge-dispatch",
    reservationOwnerId: DRIVE_DISPATCH_RESERVATION_OWNER_ID,
  });
}

function buildInvalidDriveEnvelopeReason(reason: string): string {
  return `invalid drive envelope: ${reason}`;
}

function normalizeDriveStartTurnAction(
  action: string | null | undefined,
): string | null {
  const normalized = action?.trim() || null;
  if (!normalized) return null;
  return DRIVE_START_TURN_ACTIONS.has(normalized)
    ? "thread-follower-start-turn"
    : null;
}

function rejectDriveEnvelope(
  options: Options,
  candidate: Candidate,
  threadId: string | null,
  reason: string,
): boolean {
  writeProcessedMarker(
    options.stateDir,
    candidate,
    "rejected",
    threadId,
    null,
    reason,
  );
  writeLastDispatch(
    options.stateDir,
    candidate,
    "rejected",
    threadId,
    null,
    reason,
  );
  writeConsentLedgerEvent({
    commsDir: options.commsDir,
    event: "rejected",
    grantId: candidate.consentRef?.trim() || null,
    scope: "drive",
    method: candidate.action ?? null,
    hostId: candidate.toAddress?.hostId ?? null,
    conversationId: candidate.toAddress?.conversationId ?? threadId,
    recordedAt: new Date().toISOString(),
    result: reason,
    requester: candidate.fromAddress ?? null,
    owner: candidate.toAddress ?? null,
  });
  dispatchLogger.warn("rejected malformed drive envelope", {
    fileName: candidate.fileName,
    messageId: candidate.messageId ?? null,
    conversationId: candidate.toAddress?.conversationId ?? null,
    action: candidate.action ?? null,
    consentRef: candidate.consentRef ?? null,
    reason,
  });
  return true;
}

function blockDriveEnvelope(
  options: Options,
  candidate: Candidate,
  threadId: string | null,
  reason: string,
): boolean {
  writeLastDispatch(
    options.stateDir,
    candidate,
    "blocked",
    threadId,
    null,
    reason,
  );
  writeConsentLedgerEvent({
    commsDir: options.commsDir,
    event: "rejected",
    grantId: candidate.consentRef?.trim() || null,
    scope: "drive",
    method: candidate.action ?? null,
    hostId: candidate.toAddress?.hostId ?? null,
    conversationId: candidate.toAddress?.conversationId ?? threadId,
    recordedAt: new Date().toISOString(),
    result: reason,
    requester: candidate.fromAddress ?? null,
    owner: candidate.toAddress ?? null,
  });
  dispatchLogger.warn("blocked drive envelope", {
    fileName: candidate.fileName,
    messageId: candidate.messageId ?? null,
    subject: candidate.subject || "(none)",
    conversationId: candidate.toAddress?.conversationId ?? null,
    action: candidate.action ?? null,
    consentRef: candidate.consentRef ?? null,
    reason,
  });
  return false;
}

async function dispatchDriveEnvelope(
  options: Options,
  candidate: Candidate,
  driveTransportFactory: DriveDispatchTransportFactory,
): Promise<boolean> {
  const conversationId = candidate.toAddress?.conversationId?.trim() || null;
  if (!conversationId) {
    return rejectDriveEnvelope(
      options,
      candidate,
      null,
      buildInvalidDriveEnvelopeReason(
        "drive scope requires target conversationId metadata.",
      ),
    );
  }

  const consentRef = candidate.consentRef?.trim() || null;
  if (!consentRef) {
    return rejectDriveEnvelope(
      options,
      candidate,
      conversationId,
      buildInvalidDriveEnvelopeReason(
        "drive scope requires a non-empty consentRef.",
      ),
    );
  }

  const method = normalizeDriveStartTurnAction(candidate.action);
  if (!method) {
    const action = candidate.action?.trim() || "(missing)";
    return blockDriveEnvelope(
      options,
      candidate,
      conversationId,
      `${DRIVE_ACTION_NOT_YET_SUPPORTED_REASON}: ${action}`,
    );
  }

  const text = candidate.body.trim();
  if (!text) {
    return rejectDriveEnvelope(
      options,
      candidate,
      conversationId,
      buildInvalidDriveEnvelopeReason(
        `${method} requires a non-empty message body.`,
      ),
    );
  }

  const transport = driveTransportFactory(options);
  const targetHostId = candidate.toAddress?.hostId?.trim() || null;
  const targetOwnerClientId =
    candidate.toAddress?.ownerClientId?.trim() ||
    candidate.toAddress?.clientId?.trim() ||
    null;
  logIpcTrace("drive envelope prepared", {
    fileName: candidate.fileName,
    conversationId,
    action: candidate.action ?? null,
    consentRef,
    targetHostId,
    targetOwnerClientId,
  });
  try {
    logIpcTrace("transport connect start", {
      fileName: candidate.fileName,
      conversationId,
    });
    await transport.connect();
    logIpcTrace("transport connect success", {
      fileName: candidate.fileName,
      conversationId,
    });
    logIpcTrace("transport startTurn start", {
      fileName: candidate.fileName,
      conversationId,
      textLength: text.length,
    });
    const result = await transport.startTurn({
      conversationId,
      text,
      action: candidate.action?.trim() || null,
      consentRef,
      hostId: targetHostId,
      ownerClientId: targetOwnerClientId,
    });
    const turnId = extractDriveTurnId(result);
    logIpcTrace("transport startTurn success", {
      fileName: candidate.fileName,
      conversationId,
      turnId,
      result,
    });
    writeProcessedMarker(
      options.stateDir,
      candidate,
      "drive",
      conversationId,
      turnId,
    );
    writeLastDispatch(
      options.stateDir,
      candidate,
      "drive",
      conversationId,
      turnId,
      null,
    );
    markBridgeActivity();
    dispatchLogger.info("handed drive envelope to control transport", {
      fileName: candidate.fileName,
      messageId: candidate.messageId ?? null,
      conversationId,
      action: candidate.action ?? null,
      consentRef,
      turnId,
    });
    return true;
  } catch (error) {
    logIpcTrace("transport startTurn error", {
      fileName: candidate.fileName,
      conversationId,
      error:
        error instanceof Error ? (error.stack ?? error.message) : String(error),
    });
    return blockDriveEnvelope(
      options,
      candidate,
      conversationId,
      sanitizeErrorForPersistence(
        error instanceof Error ? (error.stack ?? error.message) : String(error),
      ) ?? "drive handoff failed",
    );
  } finally {
    await transport.disconnect().catch(() => undefined);
  }
}

export function sanitizeErrorForPersistence(
  error: string | null,
): string | null {
  if (!error) return null;
  return (
    error
      // URL query token params
      .replace(/([?&])tap_token=[^\s&)"'}]+/gi, "$1tap_token=***")
      .replace(/([?&])token=[^\s&)"'}]+/gi, "$1token=***")
      .replace(/([?&])secret=[^\s&)"'}]+/gi, "$1secret=***")
      .replace(/([?&])key=[^\s&)"'}]+/gi, "$1key=***")
      // JSON string values for sensitive keys
      .replace(/"tap_token"\s*:\s*"[^"]*"/g, '"tap_token":"***"')
      .replace(/"token"\s*:\s*"[^"]*"/g, '"token":"***"')
      .replace(/"secret"\s*:\s*"[^"]*"/g, '"secret":"***"')
      .replace(/"password"\s*:\s*"[^"]*"/g, '"password":"***"')
      .replace(/"authorization"\s*:\s*"[^"]*"/gi, '"authorization":"***"')
      // WebSocket subprotocol auth prefix
      .replace(/tap-auth-[A-Za-z0-9_.\-/+=]+/g, "tap-auth-***")
      // Bearer tokens in any context
      .replace(/Bearer\s+[A-Za-z0-9_.\-/+=]+/gi, "Bearer ***")
      // Generic long hex/base64 secrets (32+ chars — likely tokens)
      .replace(/(?<=[=:"\s])[A-Za-z0-9_\-/+=]{40,}(?=["\s&)}'}\],]|$)/g, "***")
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, ms);
  });
}

function resolveBridgeRoutingSlot(agentId: string): BridgeRoutingSlot | null {
  const normalized = agentId.trim().replace(/-/g, "_").toLowerCase();
  if (!normalized) return null;
  if (
    normalized === "tower" ||
    normalized === "claude_main" ||
    normalized === "codex_main"
  ) {
    return "tower";
  }
  if (
    normalized === "reviewer" ||
    normalized === "claude_reviewer" ||
    normalized === "codex_reviewer"
  ) {
    return "reviewer";
  }
  const worktreeMatch = normalized.match(/^(?:(?:claude|codex)_)?wt_?(\d+)$/);
  if (!worktreeMatch) return null;
  return `wt-${Number.parseInt(worktreeMatch[1], 10)}` as BridgeRoutingSlot;
}

function resolveBridgeHostId(options: Options): string | null {
  const explicitHostId = process.env.TAP_HOST_ID?.trim();
  if (explicitHostId) return explicitHostId;

  const computerName = process.env.COMPUTERNAME?.trim();
  if (computerName) return computerName;

  const hostName = process.env.HOSTNAME?.trim();
  if (hostName) return hostName;

  return options.commsDir;
}

function resolveBridgeAliases(
  values: Array<string | null | undefined>,
): string[] {
  const aliases: string[] = [];
  for (const value of values) {
    const normalized = value?.trim();
    if (!normalized || aliases.includes(normalized)) continue;
    aliases.push(normalized);
  }
  return aliases;
}

function buildBridgeAddress(
  options: Options,
  conversationId: string | null,
): HeartbeatAddressRecord {
  // M392: prefer launcher-supplied routing slot so suffixed agent ids
  // (`codex-wt1-abc123` etc.) still advertise the correct slot. Fall back
  // to the legacy id-derived slot when the launcher did not pin one.
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
      options.agentName,
    ]),
  };
}

export function readThreadState(stateDir: string): ThreadStateRecord | null {
  const threadPath = join(stateDir, "thread.json");
  if (!existsSync(threadPath)) {
    return null;
  }

  try {
    const parsed = JSON.parse(
      readFileSync(threadPath, "utf8"),
    ) as ThreadStateRecord;
    if (parsed.threadId) {
      return {
        ...parsed,
        cwd: normalizePersistedThreadCwd(parsed.cwd),
      };
    }
  } catch {
    return null;
  }

  return null;
}

export function persistThreadState(
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
    cwd: normalizePersistedThreadCwd(cwd),
  };
  writeFileSync(
    join(stateDir, "thread.json"),
    `${JSON.stringify(payload, null, 2)}\n`,
    "utf8",
  );
}

export function acquireCommsLock(lockPath: string): boolean {
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

export function releaseCommsLock(lockPath: string): void {
  try {
    unlinkSync(lockPath);
  } catch {
    // Already removed
  }
}

function heartbeatStoreKey(record: Record<string, unknown>): string | null {
  for (const field of ["id", "instanceId", "agent"]) {
    const value = record[field];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function normalizeHeartbeatStore(raw: unknown): Record<string, unknown> {
  if (Array.isArray(raw)) {
    const normalized: Record<string, unknown> = {};
    for (const entry of raw) {
      const record = asRecord(entry);
      if (!record) continue;
      const key = heartbeatStoreKey(record);
      if (key) normalized[key] = record;
    }
    return normalized;
  }

  return asRecord(raw) ?? {};
}

export function updateCommsHeartbeat(
  options: Options,
  status: string,
  conversationId?: string | null,
): void {
  const heartbeatsPath = join(options.commsDir, "heartbeats.json");
  const lockPath = join(options.commsDir, ".heartbeats.lock");

  if (!acquireCommsLock(lockPath)) {
    return; // Non-critical — skip this cycle
  }

  try {
    let store: Record<string, unknown> = {};
    try {
      store = normalizeHeartbeatStore(
        JSON.parse(readFileSync(heartbeatsPath, "utf-8")),
      );
    } catch {
      // Empty or corrupt — start fresh
    }

    // Use agentId as key (SSOT for heartbeat store), not agentName.
    // This matches tap-comms.ts which keys by routing id.
    const key = options.agentId;
    const existing = store[key] as HeartbeatStoreRecord | undefined;
    const now = new Date().toISOString();
    // M144: timestamp = bridge poll freshness (always now)
    // lastActivity = actual agent work (dispatch/turn), falls back to existing or now
    const lastActivity = _lastBridgeActivityAt ?? existing?.lastActivity ?? now;
    const resolvedConversationId =
      conversationId ?? readThreadState(options.stateDir)?.threadId ?? null;
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
      address: buildBridgeAddress(options, resolvedConversationId),
    };

    const tmpPath = heartbeatsPath + ".tmp." + process.pid;
    writeFileSync(tmpPath, JSON.stringify(store, null, 2), "utf-8");
    renameSync(tmpPath, heartbeatsPath);

    // M334: Write per-agent presence file for cross-device visibility
    try {
      const presenceDir = join(options.commsDir, "presence");
      mkdirSync(presenceDir, { recursive: true });
      const sanitizedId = key.replace(/[/\\:]/g, "_");
      const presPath = join(presenceDir, `${sanitizedId}.json`);
      const presTmp = presPath + ".tmp." + process.pid;
      writeFileSync(presTmp, JSON.stringify(store[key], null, 2), "utf-8");
      renameSync(presTmp, presPath);
    } catch {
      // Non-fatal — local heartbeats.json is still primary
    }
  } catch {
    // Non-critical — comms heartbeat update failure should never crash bridge
  } finally {
    releaseCommsLock(lockPath);
  }
}

let heartbeatCount = 0;
// M144: Track actual agent activity (dispatch success, turn completion)
// separately from poll freshness. `timestamp` = bridge alive (every poll),
// `lastActivity` = real work happened.
let _lastBridgeActivityAt: string | null = null;

export function markBridgeActivity(): void {
  _lastBridgeActivityAt = new Date().toISOString();
}

export function getLastBridgeActivityAt(): string | null {
  return _lastBridgeActivityAt;
}

interface PreviousHeartbeatRecord {
  activeTurnId?: string | null;
  lastTurnAt?: string | null;
  lastDispatchAt?: string | null;
  idleSince?: string | null;
  turnState?: "active" | "idle" | "waiting-approval" | "disconnected" | null;
}

interface LastDispatchRecord {
  dispatchedAt?: string;
}

function readPreviousHeartbeat(
  stateDir: string,
): PreviousHeartbeatRecord | null {
  const heartbeatPath = join(stateDir, "heartbeat.json");
  if (!existsSync(heartbeatPath)) {
    return null;
  }

  try {
    return JSON.parse(
      readFileSync(heartbeatPath, "utf8"),
    ) as PreviousHeartbeatRecord;
  } catch {
    return null;
  }
}

function readLastDispatchAt(stateDir: string): string | null {
  const dispatchPath = join(stateDir, "last-dispatch.json");
  if (!existsSync(dispatchPath)) {
    return null;
  }

  try {
    const parsed = JSON.parse(
      readFileSync(dispatchPath, "utf8"),
    ) as LastDispatchRecord;
    return typeof parsed.dispatchedAt === "string" ? parsed.dispatchedAt : null;
  } catch {
    return null;
  }
}

function resolveTurnState(
  client: AppServerClient | null,
): "active" | "idle" | "waiting-approval" | "disconnected" | null {
  if (!client) return null;
  if (client.activeTurnId) return "active";
  if (client.connected === false) return "disconnected";
  if (isWaitingApprovalStatus(client.lastTurnStatus)) {
    return "waiting-approval";
  }
  if (client.connected) return "idle";
  return null;
}

export function writeHeartbeat(
  options: Options,
  client: AppServerClient | null,
  health: BridgeHealthState,
): void {
  const nowIso = new Date().toISOString();
  const previousHeartbeat = readPreviousHeartbeat(options.stateDir);
  const lastDispatchAt = readLastDispatchAt(options.stateDir);
  const turnState = resolveTurnState(client);
  // M144: Detect turn completion (was active, now idle) and mark activity
  const turnJustCompleted =
    previousHeartbeat?.activeTurnId && !client?.activeTurnId;
  if (turnJustCompleted) {
    markBridgeActivity();
  }
  const lastTurnAt = turnJustCompleted
    ? nowIso
    : (previousHeartbeat?.lastTurnAt ?? null);
  const idleSince =
    turnState === "idle" || turnState === "waiting-approval"
      ? previousHeartbeat?.turnState === turnState &&
        previousHeartbeat.idleSince
        ? previousHeartbeat.idleSince
        : (lastTurnAt ?? lastDispatchAt ?? nowIso)
      : null;

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
    turnState: turnState ?? undefined,
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
    heartbeatLogger.debug("heartbeat written", {
      connected: payload.connected,
      threadId: payload.threadId ?? "null",
      activeTurnId: payload.activeTurnId ?? null,
      consecutiveFailureCount: payload.consecutiveFailureCount,
    });
  }

  // Also update comms heartbeats.json so tap_who sees this agent
  const status = turnState === "active" ? "active" : "idle";
  updateCommsHeartbeat(
    options,
    status,
    payload.threadId ?? readThreadState(options.stateDir)?.threadId ?? null,
  );
}

export async function dispatchCandidate(
  client: AppServerClient,
  options: Options,
  candidate: Candidate,
  heartbeats: HeartbeatStore,
  driveTransportFactory: DriveDispatchTransportFactory = createDriveDispatchTransport,
): Promise<boolean> {
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
    busyMode: options.busyMode,
  });

  if (candidate.scope === "drive") {
    return dispatchDriveEnvelope(options, candidate, driveTransportFactory);
  }

  const input = buildUserInput(candidate, options.agentName, heartbeats);

  if (client.isWaitingOnApproval()) {
    dispatchLogger.warn("thread waiting on approval; skipping dispatch", {
      fileName: candidate.fileName,
      threadId: client.threadId,
      lastTurnStatus: client.lastTurnStatus,
    });
    return false;
  }

  if (client.isBusy()) {
    if (options.busyMode !== "steer") {
      dispatchLogger.debug("bridge busy and steer disabled", {
        fileName: candidate.fileName,
        activeTurnId: client.activeTurnId,
      });
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
        null,
      );
      markBridgeActivity(); // M144: steer dispatch = real activity
      dispatchLogger.info("steered active turn", {
        fileName: candidate.fileName,
        threadId: client.threadId,
        turnId,
      });
      return true;
    } catch (error) {
      await client.refreshCurrentThreadState().catch(() => undefined);

      if (!client.isBusy()) {
        return dispatchCandidate(
          client,
          options,
          candidate,
          heartbeats,
          driveTransportFactory,
        );
      }

      if (shouldRetrySteerAsStart(error)) {
        client.activeTurnId = null;
        client.turnStartedAt = null;
        dispatchLogger.warn("steer fallback to start", {
          fileName: candidate.fileName,
          threadId: client.threadId,
          error: sanitizeErrorForPersistence(String(error)),
        });
        return dispatchCandidate(
          client,
          options,
          candidate,
          heartbeats,
          driveTransportFactory,
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
    turnId,
  );
  writeLastDispatch(
    options.stateDir,
    candidate,
    "start",
    client.threadId,
    turnId,
    null,
  );
  markBridgeActivity(); // M144: start dispatch = real activity
  dispatchLogger.info("started turn for candidate", {
    fileName: candidate.fileName,
    threadId: client.threadId,
    turnId,
  });
  return true;
}

export async function runScan(
  options: Options,
  cutoff: Date,
  client: AppServerClient | null,
): Promise<{ dispatched: boolean; maxMtimeMs: number }> {
  const { heartbeats, candidates } = getPendingCandidates(options, cutoff);
  if (candidates.length === 0) {
    dispatchLogger.debug("no pending candidates", {
      cutoff: cutoff.toISOString(),
      agentName: options.agentName,
    });
  }
  let maxMtimeMs = 0;
  for (const candidate of candidates) {
    if (options.dryRun) {
      dispatchLogger.info("dry-run candidate", {
        fileName: candidate.fileName,
        sender: candidate.sender,
        recipient: candidate.recipient,
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
      heartbeats,
    );
    if (!dispatched) {
      return { dispatched: false, maxMtimeMs };
    }
    maxMtimeMs = Math.max(maxMtimeMs, candidate.mtimeMs);
    return { dispatched: true, maxMtimeMs };
  }

  return { dispatched: false, maxMtimeMs: 0 };
}

export async function waitForTurnDrain(
  options: Options,
  client: AppServerClient,
  health: BridgeHealthState,
): Promise<void> {
  const deadline = Date.now() + options.waitAfterDispatchSeconds * 1_000;
  while (Date.now() < deadline) {
    writeHeartbeat(options, client, health);
    if (!client.activeTurnId) {
      markBridgeActivity(); // M144: turn completed = real activity
      return;
    }
    await delay(1_000);
  }

  dispatchLogger.warn("wait-after-dispatch deadline reached", {
    threadId: client.threadId,
    activeTurnId: client.activeTurnId,
    waitAfterDispatchSeconds: options.waitAfterDispatchSeconds,
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

  dispatchLogger.info("headless cold-start warmup starting", {
    threadId: client.activeTurnId,
  });
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

    dispatchLogger.info("headless cold-start warmup completed", {
      turnId,
      status,
    });
    return true;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Headless cold-start warmup failed: ${reason}. ` +
        "Run: npx @hua-labs/tap doctor",
      { cause: error },
    );
  }
}
