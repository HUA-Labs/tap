// bridge-dispatch.ts — Dispatch orchestration + heartbeat

import {
  existsSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import { join } from "path";
import {
  BridgeHealthState,
  Candidate,
  COMMS_HEARTBEAT_LOCK_TIMEOUT_MS,
  COMMS_LOCK_STALE_AGE_MS,
  HeadlessWarmupClient,
  HeartbeatRecord,
  HeartbeatStore,
  HEADLESS_WARMUP_PROMPT,
  HEADLESS_WARMUP_TIMEOUT_MS,
  Options,
  ThreadStateRecord,
  TURN_COMPLETION_POLL_MS,
  TURN_COMPLETION_REFRESH_MS,
} from "./bridge-types.js";
import { createBridgeLogger } from "./bridge-logging.js";
import { shouldRetrySteerAsStart } from "./bridge-routing.js";
import { getPendingCandidates } from "./bridge-candidates.js";
import {
  buildUserInput,
  writeLastDispatch,
  writeProcessedMarker,
} from "./bridge-format.js";
import { AppServerClient } from "./bridge-ws-client.js";

const dispatchLogger = createBridgeLogger("dispatch");
const heartbeatLogger = createBridgeLogger("heartbeat");

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
      return parsed;
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
    cwd,
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

export function updateCommsHeartbeat(options: Options, status: string): void {
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

let heartbeatCount = 0;

export function writeHeartbeat(
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
  const status = client?.connected ? "active" : "idle";
  updateCommsHeartbeat(options, status);
}

export async function dispatchCandidate(
  client: AppServerClient,
  options: Options,
  candidate: Candidate,
  heartbeats: HeartbeatStore,
): Promise<boolean> {
  const input = buildUserInput(candidate, options.agentName, heartbeats);

  dispatchLogger.info("dispatching candidate", {
    sender: candidate.sender || "unknown",
    recipient: candidate.recipient || options.agentName,
    subject: candidate.subject || "(none)",
    fileName: candidate.fileName,
    threadId: client.threadId,
    activeTurnId: client.activeTurnId,
    busyMode: options.busyMode,
  });

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
      );
      dispatchLogger.info("steered active turn", {
        fileName: candidate.fileName,
        threadId: client.threadId,
        turnId,
      });
      return true;
    } catch (error) {
      await client.refreshCurrentThreadState().catch(() => undefined);

      if (!client.isBusy()) {
        return dispatchCandidate(client, options, candidate, heartbeats);
      }

      if (shouldRetrySteerAsStart(error)) {
        client.activeTurnId = null;
        client.turnStartedAt = null;
        dispatchLogger.warn("steer fallback to start", {
          fileName: candidate.fileName,
          threadId: client.threadId,
          error: sanitizeErrorForPersistence(String(error)),
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
    turnId,
  );
  writeLastDispatch(
    options.stateDir,
    candidate,
    "start",
    client.threadId,
    turnId,
  );
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
    if (!dispatched && options.busyMode === "wait") {
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
    );
  }
}
