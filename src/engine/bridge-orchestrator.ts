import * as fs from "node:fs";
import * as path from "node:path";

import type {
  BridgeLifecycleRecord,
  BridgeState,
  InstanceId,
  Platform,
} from "../types.js";

import { isProcessAlive, terminateProcess } from "./bridge-process-control.js";
import { cleanupHeadlessDispatch } from "./bridge-config.js";
import {
  loadBridgeState,
  saveBridgeState,
  clearBridgeState,
  transitionBridgeLifecycle,
} from "./bridge-state.js";
import {
  getBridgeRuntimeStateDir,
  startBridge,
  type BridgeStartOptions,
} from "./bridge-startup.js";

export interface BridgeStopOptions {
  instanceId: InstanceId;
  stateDir: string;
  platform: Platform;
}

export interface BridgeStopResult {
  stopped: boolean;
  lifecycle: BridgeLifecycleRecord | null;
}

export async function stopBridge(
  options: BridgeStopOptions,
): Promise<BridgeStopResult> {
  const { instanceId, stateDir, platform } = options;
  const state = loadBridgeState(stateDir, instanceId);

  if (!state) {
    return {
      stopped: false,
      lifecycle: null,
    };
  }

  const currentLifecycle = state.lifecycle ?? null;

  if (!isProcessAlive(state.pid)) {
    clearBridgeState(stateDir, instanceId);
    return {
      stopped: false,
      lifecycle: transitionBridgeLifecycle(
        currentLifecycle,
        "crashed",
        "bridge pid not alive",
      ),
    };
  }

  state.lifecycle = transitionBridgeLifecycle(
    currentLifecycle,
    "stopping",
    "bridge stop requested",
  );
  saveBridgeState(stateDir, instanceId, state);

  try {
    await terminateProcess(state.pid, platform);
  } catch {
    // Process may have already exited.
  }

  clearBridgeState(stateDir, instanceId);
  return {
    stopped: true,
    lifecycle: transitionBridgeLifecycle(
      state.lifecycle ?? currentLifecycle,
      "stopped",
      "bridge stopped",
    ),
  };
}

export interface RestartBridgeOptions extends BridgeStartOptions {
  /** Max seconds to wait for active turn to complete before killing. Default: 30 */
  drainTimeoutSeconds?: number;
}

/**
 * Graceful bridge restart: wait for active turn -> cleanup -> stop -> start.
 * Prevents message loss during restart by draining active work first
 * and replaying unprocessed messages on the new instance.
 */
export async function restartBridge(
  options: RestartBridgeOptions,
): Promise<BridgeState> {
  const { instanceId, stateDir, platform } = options;
  const drainTimeout = (options.drainTimeoutSeconds ?? 30) * 1000;
  const repoRoot = options.repoRoot ?? stateDir.replace(/[\\/].tap-comms$/, "");

  const runtimeStateDir = getBridgeRuntimeStateDir(repoRoot, instanceId);
  const heartbeatPath = path.join(runtimeStateDir, "heartbeat.json");

  if (fs.existsSync(heartbeatPath)) {
    const startWait = Date.now();
    while (Date.now() - startWait < drainTimeout) {
      try {
        const hb = JSON.parse(fs.readFileSync(heartbeatPath, "utf-8"));
        if (!hb.activeTurnId) break;
      } catch {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  if (options.headless?.enabled && options.commsDir) {
    const agentName = options.agentName ?? instanceId;
    cleanupHeadlessDispatch(path.join(options.commsDir, "inbox"), agentName);
  }

  const stopResult = await stopBridge({ instanceId, stateDir, platform });

  return startBridge({
    ...options,
    processExistingMessages: true,
    previousLifecycle: stopResult.lifecycle ?? options.previousLifecycle ?? null,
  });
}
