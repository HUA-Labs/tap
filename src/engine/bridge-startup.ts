import * as fs from "node:fs";
import * as path from "node:path";

import type {
  RuntimeName,
  InstanceId,
  BridgeState,
  AppServerState,
  HeadlessConfig,
  Platform,
} from "../types.js";
import { resolveNodeRuntime, buildRuntimeEnv } from "../runtime/index.js";

import { pidFilePath, logFilePath } from "./bridge-paths.js";
import { startWindowsDetachedProcess } from "./bridge-windows-spawn.js";
import { startUnixDetachedProcess } from "./bridge-unix-spawn.js";
import { stopManagedAppServer } from "./bridge-process-control.js";
import { resolveAgentName } from "./bridge-config.js";
import {
  loadBridgeState,
  saveBridgeState,
  clearBridgeState,
  isBridgeRunning,
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
}

export function getBridgeRuntimeStateDir(
  repoRoot: string,
  instanceId: InstanceId,
): string {
  return path.join(repoRoot, ".tmp", `codex-app-server-bridge-${instanceId}`);
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
  const previousAppServer = previousBridgeState?.appServer ?? null;

  clearBridgeState(stateDir, instanceId);

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
      lastHeartbeat: new Date().toISOString(),
      appServer,
      runtimeStateDir,
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
