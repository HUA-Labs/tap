// bridge-main.ts — Entry point, main loop, signal handling

import { existsSync, readFileSync, writeFileSync } from "fs";
import { isAbsolute, join, resolve } from "path";
import { pathToFileURL } from "url";
import {
  BridgeHealthState,
  HeartbeatRecord,
  ThreadStateRecord,
} from "./bridge-types.js";
import {
  configureBridgeLogging,
  createBridgeLogger,
} from "./bridge-logging.js";
import { buildOptions } from "./bridge-config.js";
import {
  maybeBootstrapHeadlessTurn,
  persistThreadState,
  readThreadState,
  runScan,
  waitForTurnDrain,
  writeHeartbeat,
} from "./bridge-dispatch.js";
import { AppServerClient } from "./bridge-ws-client.js";
import { sanitizeErrorForPersistence } from "./bridge-dispatch.js";

function delay(ms: number): Promise<void> {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, ms);
  });
}

export function readHeartbeatState(stateDir: string): HeartbeatRecord | null {
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

export function getGeneralInboxCutoff(
  stateDir: string,
  lookbackMinutes: number,
  processExistingMessages: boolean,
): Date {
  if (processExistingMessages) {
    return new Date(0);
  }

  const lookbackCutoff =
    lookbackMinutes > 0
      ? new Date(Date.now() - lookbackMinutes * 60_000)
      : null;

  // Prefer saved cutoff (last processed timestamp) over lookback window
  // to avoid re-dispatching already-processed messages on restart.
  const cutoffPath = join(stateDir, "general-inbox-cutoff.txt");
  if (existsSync(cutoffPath)) {
    try {
      const saved = new Date(readFileSync(cutoffPath, "utf8").trim());
      if (!isNaN(saved.getTime())) {
        // Use the more recent of saved cutoff vs lookback window
        if (lookbackCutoff && lookbackCutoff > saved) {
          return lookbackCutoff;
        }
        return saved;
      }
    } catch {
      // fall through to lookback/now
    }
  }

  if (lookbackCutoff) {
    return lookbackCutoff;
  }

  const cutoff = new Date();
  writeFileSync(cutoffPath, `${cutoff.toISOString()}\n`, "utf8");
  return cutoff;
}

export async function main(): Promise<void> {
  const options = buildOptions(process.argv.slice(2));
  configureBridgeLogging(options.logLevel);
  const logger = createBridgeLogger("bridge");
  const cutoff = getGeneralInboxCutoff(
    options.stateDir,
    options.messageLookbackMinutes,
    options.processExistingMessages,
  );
  const initialSavedThread = loadResumableThreadState(
    options.stateDir,
    options.appServerUrl,
  );

  logger.info("codex app-server bridge ready", {
    repoRoot: options.repoRoot,
    commsDir: options.commsDir,
    agentName: options.agentName,
    stateDir: options.stateDir,
    appServerUrl: options.appServerUrl,
    busyMode: options.busyMode,
    logLevel: options.logLevel,
    waitAfterDispatchSeconds:
      options.waitAfterDispatchSeconds > 0
        ? options.waitAfterDispatchSeconds
        : undefined,
    lookback: options.processExistingMessages
      ? "existing messages"
      : `${options.messageLookbackMinutes} minute(s)`,
    threadId: options.threadId ?? initialSavedThread?.threadId,
  });
  if (options.dryRun) {
    logger.info("dry-run mode enabled");
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
            createBridgeLogger("app-server"),
            options.gatewayToken,
          );
          await client.connect();
          const savedThread = loadResumableThreadState(
            options.stateDir,
            options.appServerUrl,
          );
          logger.debug("resolved resumable thread state", {
            savedThreadId: savedThread?.threadId,
            savedThreadCwd: savedThread?.cwd ?? null,
          });

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

      const scanResult = await runScan(options, cutoff, client);
      if (scanResult.dispatched && scanResult.maxMtimeMs > 0) {
        // Advance the persisted cutoff to the latest dispatched message mtime
        // (not wall-clock now) to avoid skipping messages that arrived mid-scan
        const cutoffPath = join(options.stateDir, "general-inbox-cutoff.txt");
        const advancedCutoff = new Date(scanResult.maxMtimeMs);
        writeFileSync(cutoffPath, `${advancedCutoff.toISOString()}\n`, "utf8");
      }
      if (
        scanResult.dispatched &&
        client &&
        options.waitAfterDispatchSeconds > 0
      ) {
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
      logger.error("bridge error", {
        error: sanitizeErrorForPersistence(message),
      });
      if (client) {
        client.lastError = sanitizeErrorForPersistence(message);
      }
      health.consecutiveFailureCount += 1;
      writeHeartbeat(options, client, health);

      if (options.runOnce) {
        // Sanitize before re-throwing — top-level catch may log raw message
        const sanitized = sanitizeErrorForPersistence(message);
        throw new Error(sanitized ?? message);
      }

      client?.disconnect().catch(() => undefined);
      client = null;
      logger.warn("reconnecting after bridge error", {
        reconnectSeconds: options.reconnectSeconds,
        consecutiveFailureCount: health.consecutiveFailureCount,
      });
      await delay(options.reconnectSeconds * 1_000);
    }
  }

  await client?.disconnect();
}

export function isDirectExecution(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(resolve(entry)).href;
}
