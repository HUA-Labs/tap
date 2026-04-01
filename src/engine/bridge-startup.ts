import * as fs from "node:fs";
import * as path from "node:path";

import type {
  RuntimeName,
  InstanceId,
  BridgeLifecycleRecord,
  BridgeState,
  AppServerState,
  HeadlessConfig,
  Platform,
} from "../types.js";
import { resolveNodeRuntime, buildRuntimeEnv } from "../runtime/index.js";

import { pidFilePath, logFilePath } from "./bridge-paths.js";
import { startWindowsDetachedProcess } from "./bridge-windows-spawn.js";
import { startUnixDetachedProcess } from "./bridge-unix-spawn.js";
import { isProcessAlive, stopManagedAppServer } from "./bridge-process-control.js";
import { resolveAgentName } from "./bridge-config.js";
import {
  loadBridgeState,
  saveBridgeState,
  clearBridgeState,
  isBridgeRunning,
  transitionBridgeLifecycle,
} from "./bridge-state.js";
import { materializeGatewayTokenFile } from "./bridge-app-server-auth.js";
import { rotateLog } from "./bridge-observability.js";
import {
  isAppServerUsedByOtherBridge,
  resolveAppServerUrl,
  ensureCodexAppServer,
} from "./bridge-app-server-lifecycle.js";

export interface BridgeStartOptions {
  instanceId: InstanceId;
  runtime: RuntimeName;
  stateDir: string;
  commsDir: string;
  bridgeScript: string;
  platform: Platform;
  agentName?: string;
  runtimeCommand?: string;
  appServerUrl?: string;
  repoRoot?: string;
  port?: number;
  /** Headless configuration. Passed as env vars to the bridge process. */
  headless?: HeadlessConfig | null;
  /** Bridge script operational flags (forwarded to codex-app-server-bridge.ts) */
  busyMode?: "steer" | "wait";
  pollSeconds?: number;
  reconnectSeconds?: number;
  messageLookbackMinutes?: number;
  threadId?: string;
  ephemeral?: boolean;
  processExistingMessages?: boolean;
  manageAppServer?: boolean;
  /** Skip auth gateway — app-server listens directly on the public port (localhost only). */
  noAuth?: boolean;
  /** Persisted lifecycle from the previous session, used to track restarts. */
  previousLifecycle?: BridgeLifecycleRecord | null;
}

export function getBridgeRuntimeStateDir(
  repoRoot: string,
  instanceId: InstanceId,
): string {
  const resolved = path.resolve(
    path.join(repoRoot, ".tmp", `codex-app-server-bridge-${instanceId}`),
  );
  const expectedBase = path.resolve(repoRoot, ".tmp") + path.sep;
  if (!resolved.startsWith(expectedBase)) {
    throw new Error(
      `Path traversal blocked: runtime state dir escapes .tmp/ directory`,
    );
  }
  return resolved;
}

type CommsHeartbeatRecord = {
  id?: string;
  agent?: string;
  timestamp?: string;
  lastActivity?: string;
  joinedAt?: string;
  status?: string;
  source?: "bridge-dispatch" | "mcp-direct";
  instanceId?: string | null;
  bridgePid?: number | null;
  connectHash?: string;
};

const STALE_DIRECT_HEARTBEAT_MS = 5 * 60 * 1000;

function warnHeartbeatCleanup(instanceId: InstanceId, message: string): void {
  console.warn(
    `[tap] heartbeat cleanup skipped for ${instanceId}: ${message}`,
  );
}

function getHeartbeatActivityMs(record: CommsHeartbeatRecord): number | null {
  const timestamp = new Date(record.lastActivity ?? record.timestamp ?? 0).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function isSameInstanceHeartbeat(
  key: string,
  heartbeat: CommsHeartbeatRecord,
  instanceId: InstanceId,
): boolean {
  if (heartbeat.instanceId === instanceId) return true;
  if (heartbeat.connectHash === `instance:${instanceId}`) return true;
  return (
    key === instanceId ||
    key.replace(/_/g, "-") === instanceId ||
    key.replace(/-/g, "_") === instanceId
  );
}

function cleanupStaleSameInstanceHeartbeats(
  commsDir: string,
  instanceId: InstanceId,
): void {
  const heartbeatsPath = path.join(commsDir, "heartbeats.json");
  if (!fs.existsSync(heartbeatsPath)) return;

  const lockPath = path.join(commsDir, ".heartbeats.lock");
  try {
    fs.writeFileSync(lockPath, String(process.pid), { flag: "wx" });
  } catch {
    warnHeartbeatCleanup(instanceId, "heartbeat store busy");
    return;
  }

  try {
    let store: Record<string, CommsHeartbeatRecord> = {};
    try {
      store = JSON.parse(
        fs.readFileSync(heartbeatsPath, "utf-8"),
      ) as Record<string, CommsHeartbeatRecord>;
    } catch {
      warnHeartbeatCleanup(instanceId, "heartbeat store unreadable");
      return;
    }

    let changed = false;
    for (const [key, heartbeat] of Object.entries(store)) {
      if (!isSameInstanceHeartbeat(key, heartbeat, instanceId)) continue;

      const status = heartbeat.status ?? "active";
      const isDeadBridge =
        heartbeat.source === "bridge-dispatch" &&
        heartbeat.bridgePid != null &&
        !isProcessAlive(heartbeat.bridgePid);
      const activityMs = getHeartbeatActivityMs(heartbeat);
      const isStaleDirect =
        heartbeat.source !== "bridge-dispatch" &&
        activityMs != null &&
        Date.now() - activityMs > STALE_DIRECT_HEARTBEAT_MS;

      if (status === "signing-off" || isDeadBridge || isStaleDirect) {
        delete store[key];
        changed = true;
      }
    }

    if (!changed) return;
    const tmpPath = `${heartbeatsPath}.tmp.${process.pid}`;
    fs.writeFileSync(tmpPath, JSON.stringify(store, null, 2), "utf-8");
    fs.renameSync(tmpPath, heartbeatsPath);
  } catch (error) {
    warnHeartbeatCleanup(
      instanceId,
      error instanceof Error ? error.message : String(error),
    );
  } finally {
    try {
      fs.unlinkSync(lockPath);
    } catch {
      // lock already removed
    }
  }
}

export async function startBridge(
  options: BridgeStartOptions,
): Promise<BridgeState> {
  const {
    instanceId,
    runtime,
    stateDir,
    commsDir,
    bridgeScript,
    agentName,
    port,
  } = options;

  const resolvedAgent = resolveAgentName(instanceId, agentName, {
    repoRoot: options.repoRoot,
    stateDir,
  });

  if (!resolvedAgent) {
    throw new Error(
      `No agent name for ${instanceId} bridge. ` +
        `Set TAP_AGENT_NAME env var or pass --agent-name flag.`,
    );
  }

  if (isBridgeRunning(stateDir, instanceId)) {
    const existing = loadBridgeState(stateDir, instanceId)!;
    throw new Error(
      `Bridge for ${instanceId} is already running (PID: ${existing.pid})`,
    );
  }

  const previousBridgeState = loadBridgeState(stateDir, instanceId);
  const previousLifecycle =
    options.previousLifecycle ?? previousBridgeState?.lifecycle ?? null;
  const previousAppServer = previousBridgeState?.appServer ?? null;

  clearBridgeState(stateDir, instanceId);
  cleanupStaleSameInstanceHeartbeats(commsDir, instanceId);

  const logPath = logFilePath(stateDir, instanceId);
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  rotateLog(logPath);

  const repoRoot = options.repoRoot ?? path.resolve(stateDir, "..");
  const runtimeStateDir = getBridgeRuntimeStateDir(repoRoot, instanceId);
  const resolved = resolveNodeRuntime(
    options.runtimeCommand ?? "node",
    repoRoot,
  );
  const command = resolved.command;

  const runtimeEnv = buildRuntimeEnv(repoRoot);
  const effectiveAppServerUrl = resolveAppServerUrl(options.appServerUrl, port);
  let appServer: AppServerState | null = null;
  let bridgeAppServerUrl = effectiveAppServerUrl;
  const startedAt = new Date().toISOString();

  if (runtime === "codex" && options.manageAppServer) {
    appServer = await ensureCodexAppServer({
      instanceId,
      stateDir,
      repoRoot,
      platform: options.platform,
      appServerUrl: effectiveAppServerUrl,
      existingAppServer: previousAppServer,
      noAuth: options.noAuth,
    });
    if (appServer.auth) {
      appServer = {
        ...appServer,
        auth: materializeGatewayTokenFile(
          stateDir,
          instanceId,
          effectiveAppServerUrl,
          appServer.auth,
        ),
      };
    }
    bridgeAppServerUrl = effectiveAppServerUrl;
  }

  try {
    const bridgeEnv = {
      ...runtimeEnv,
      TAP_COMMS_DIR: commsDir,
      TAP_STATE_DIR: runtimeStateDir,
      TAP_BRIDGE_RUNTIME: runtime,
      TAP_BRIDGE_INSTANCE_ID: instanceId,
      TAP_AGENT_ID: instanceId,
      TAP_AGENT_NAME: resolvedAgent,
      CODEX_TAP_AGENT_NAME: resolvedAgent,
      TAP_RESOLVED_NODE: resolved.command,
      TAP_STRIP_TYPES: resolved.supportsStripTypes ? "1" : "0",
      ...(bridgeAppServerUrl
        ? { CODEX_APP_SERVER_URL: bridgeAppServerUrl }
        : {}),
      ...(appServer?.auth?.tokenPath
        ? { TAP_GATEWAY_TOKEN_FILE: appServer.auth.tokenPath }
        : {}),
      ...(port != null ? { TAP_BRIDGE_PORT: String(port) } : {}),
      ...(options.headless?.enabled
        ? {
            TAP_HEADLESS: "true",
            TAP_AGENT_ROLE: options.headless.role,
            TAP_MAX_REVIEW_ROUNDS: String(options.headless.maxRounds),
            TAP_QUALITY_FLOOR: options.headless.qualitySeverityFloor,
          }
        : {}),
      ...(options.busyMode ? { TAP_BUSY_MODE: options.busyMode } : {}),
      ...(options.pollSeconds != null
        ? { TAP_POLL_SECONDS: String(options.pollSeconds) }
        : {}),
      ...(options.reconnectSeconds != null
        ? { TAP_RECONNECT_SECONDS: String(options.reconnectSeconds) }
        : {}),
      ...(options.messageLookbackMinutes != null
        ? {
            TAP_MESSAGE_LOOKBACK_MINUTES: String(
              options.messageLookbackMinutes,
            ),
          }
        : {}),
      ...(process.env.TAP_COLD_START_WARMUP === "true"
        ? { TAP_COLD_START_WARMUP: "true" }
        : {}),
      ...(options.threadId ? { TAP_THREAD_ID: options.threadId } : {}),
      ...(options.ephemeral ? { TAP_EPHEMERAL: "true" } : {}),
      ...(options.processExistingMessages
        ? { TAP_PROCESS_EXISTING: "true" }
        : {}),
    };

    const bridgePid =
      options.platform === "win32"
        ? startWindowsDetachedProcess(
            command,
            [bridgeScript],
            repoRoot,
            logPath,
            bridgeEnv,
          )
        : startUnixDetachedProcess(
            command,
            [bridgeScript],
            repoRoot,
            logPath,
            bridgeEnv,
            options.platform,
          );

    if (!bridgePid) {
      throw new Error(`Failed to spawn bridge process for ${instanceId}`);
    }

    const state: BridgeState = {
      pid: bridgePid,
      statePath: pidFilePath(stateDir, instanceId),
      lastHeartbeat: startedAt,
      appServer,
      runtimeStateDir,
      lifecycle: transitionBridgeLifecycle(
        previousLifecycle,
        "initializing",
        previousLifecycle ? "bridge restart" : "bridge start",
        {
          at: startedAt,
          incrementRestart: previousLifecycle != null,
        },
      ),
    };

    saveBridgeState(stateDir, instanceId, state);

    return state;
  } catch (err) {
    if (appServer?.managed) {
      const shared = isAppServerUsedByOtherBridge(
        stateDir,
        instanceId,
        appServer,
      );
      if (!shared) {
        await stopManagedAppServer(appServer, options.platform);
      }
    }
    throw err;
  }
}
