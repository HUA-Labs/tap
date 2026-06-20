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
import type { RuntimeBridgeHeartbeat } from "./bridge-state.js";

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
  /** Continue restart after drain timeout instead of aborting. */
  force?: boolean;
  /** Optional observer for user-facing drain wait logs. */
  onDrainWait?: (state: BridgeDrainWaitState) => void;
}

export interface BridgeDrainWaitState {
  activeTurnId: string | null;
  turnState: RuntimeBridgeHeartbeat["turnState"] | null;
  waitedMs: number;
}

export interface RestartBridgeResult {
  bridge: BridgeState;
  drained: boolean;
  forced: boolean;
}

export class BridgeDrainTimeoutError extends Error {
  readonly instanceId: InstanceId;
  readonly activeTurnId: string | null;
  readonly turnState: RuntimeBridgeHeartbeat["turnState"] | null;
  readonly waitedMs: number;

  constructor(options: {
    instanceId: InstanceId;
    activeTurnId: string | null;
    turnState: RuntimeBridgeHeartbeat["turnState"] | null;
    waitedMs: number;
  }) {
    const waitedSeconds = Math.ceil(options.waitedMs / 1000);
    const turnSuffix = options.activeTurnId
      ? ` active turn ${options.activeTurnId}`
      : "";
    const stateSuffix = options.turnState ? ` (${options.turnState})` : "";
    super(
      `Bridge drain timed out for ${options.instanceId} after ${waitedSeconds}s while${turnSuffix || " bridge"} was still busy${stateSuffix}. Re-run with --force to continue.`,
    );
    this.name = "BridgeDrainTimeoutError";
    this.instanceId = options.instanceId;
    this.activeTurnId = options.activeTurnId;
    this.turnState = options.turnState;
    this.waitedMs = options.waitedMs;
  }
}

function canStopAfterDrain(heartbeat: RuntimeBridgeHeartbeat | null): boolean {
  if (!heartbeat) return true;
  return (
    !heartbeat.activeTurnId ||
    heartbeat.turnState === "idle" ||
    heartbeat.turnState === "disconnected"
  );
}

/**
 * Graceful bridge restart: wait for active turn -> cleanup -> stop -> start.
 * Prevents message loss during restart by draining active work first
 * and replaying unprocessed messages on the new instance.
 */
export async function restartBridge(
  options: RestartBridgeOptions,
): Promise<RestartBridgeResult> {
  const { instanceId, stateDir, platform } = options;
  const drainTimeout = (options.drainTimeoutSeconds ?? 30) * 1000;
  const repoRoot = options.repoRoot ?? stateDir.replace(/[\\/].tap-comms$/, "");

  const runtimeStateDir = getBridgeRuntimeStateDir(repoRoot, instanceId);
  const heartbeatPath = path.join(runtimeStateDir, "heartbeat.json");

  let drained = true;
  let forced = false;

  if (fs.existsSync(heartbeatPath)) {
    const startWait = Date.now();
    while (true) {
      let heartbeat: RuntimeBridgeHeartbeat;
      try {
        heartbeat = JSON.parse(
          fs.readFileSync(heartbeatPath, "utf-8"),
        ) as RuntimeBridgeHeartbeat;
      } catch {
        break;
      }

      if (canStopAfterDrain(heartbeat)) {
        break;
      }

      const waitedMs = Date.now() - startWait;
      options.onDrainWait?.({
        activeTurnId: heartbeat.activeTurnId ?? null,
        turnState: heartbeat.turnState ?? null,
        waitedMs,
      });

      if (waitedMs >= drainTimeout) {
        if (!options.force) {
          throw new BridgeDrainTimeoutError({
            instanceId,
            activeTurnId: heartbeat.activeTurnId ?? null,
            turnState: heartbeat.turnState ?? null,
            waitedMs,
          });
        }
        drained = false;
        forced = true;
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

  const bridge = await startBridge({
    ...options,
    processExistingMessages: true,
    previousLifecycle:
      stopResult.lifecycle ?? options.previousLifecycle ?? null,
  });

  return {
    bridge,
    drained,
    forced,
  };
}
