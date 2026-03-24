import * as fs from "node:fs";
import * as path from "node:path";
import { spawn, execSync } from "node:child_process";
import type {
  RuntimeName,
  InstanceId,
  BridgeState,
  HeadlessConfig,
  Platform,
} from "../types.js";
import { resolveNodeRuntime, buildRuntimeEnv } from "../runtime/index.js";

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
}

export interface BridgeStopOptions {
  instanceId: InstanceId;
  stateDir: string;
  platform: Platform;
}

function pidFilePath(stateDir: string, instanceId: InstanceId): string {
  return path.join(stateDir, "pids", `bridge-${instanceId}.json`);
}

function logFilePath(stateDir: string, instanceId: InstanceId): string {
  return path.join(stateDir, "logs", `bridge-${instanceId}.log`);
}

export function loadBridgeState(
  stateDir: string,
  instanceId: InstanceId,
): BridgeState | null {
  const pidPath = pidFilePath(stateDir, instanceId);
  if (!fs.existsSync(pidPath)) return null;

  try {
    const raw = fs.readFileSync(pidPath, "utf-8");
    return JSON.parse(raw) as BridgeState;
  } catch {
    return null;
  }
}

export function saveBridgeState(
  stateDir: string,
  instanceId: InstanceId,
  state: BridgeState,
): void {
  const pidPath = pidFilePath(stateDir, instanceId);
  fs.mkdirSync(path.dirname(pidPath), { recursive: true });
  const tmp = `${pidPath}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), "utf-8");
  fs.renameSync(tmp, pidPath);
}

export function clearBridgeState(
  stateDir: string,
  instanceId: InstanceId,
): void {
  const pidPath = pidFilePath(stateDir, instanceId);
  if (fs.existsSync(pidPath)) {
    fs.unlinkSync(pidPath);
  }
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function isBridgeRunning(
  stateDir: string,
  instanceId: InstanceId,
): boolean {
  const state = loadBridgeState(stateDir, instanceId);
  if (!state) return false;
  return isProcessAlive(state.pid);
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

  // Resolve agent name: explicit > env > error
  const resolvedAgent =
    agentName || process.env.TAP_AGENT_NAME || process.env.CODEX_TAP_AGENT_NAME;

  if (!resolvedAgent) {
    throw new Error(
      `No agent name for ${instanceId} bridge. ` +
        `Set TAP_AGENT_NAME env var or pass --agent-name flag.`,
    );
  }

  // Check if already running
  if (isBridgeRunning(stateDir, instanceId)) {
    const existing = loadBridgeState(stateDir, instanceId)!;
    throw new Error(
      `Bridge for ${instanceId} is already running (PID: ${existing.pid})`,
    );
  }

  // Clear stale PID
  clearBridgeState(stateDir, instanceId);

  const logPath = logFilePath(stateDir, instanceId);
  fs.mkdirSync(path.dirname(logPath), { recursive: true });

  // Log rotation: rename existing log to .prev
  rotateLog(logPath);

  const logFd = fs.openSync(logPath, "a");

  // Use explicit repoRoot (not derived from stateDir — stateDir may be external)
  const repoRoot = options.repoRoot ?? path.resolve(stateDir, "..");
  const resolved = resolveNodeRuntime(
    options.runtimeCommand ?? "node",
    repoRoot,
  );
  const command = resolved.command;

  // Build env with fnm Node prepended to PATH so the bridge runner's
  // 2nd-stage spawn also finds the correct Node (결 finding: 2-stage spawn)
  const runtimeEnv = buildRuntimeEnv(repoRoot);

  // Spawn detached process — pass both command and strip-types metadata
  // so the runner doesn't re-guess (avoids bun + --experimental-strip-types)
  const child = spawn(command, [bridgeScript], {
    detached: true,
    stdio: ["ignore", logFd, logFd],
    env: {
      ...runtimeEnv,
      TAP_COMMS_DIR: commsDir,
      TAP_BRIDGE_RUNTIME: runtime,
      TAP_BRIDGE_INSTANCE_ID: instanceId,
      TAP_AGENT_NAME: resolvedAgent,
      CODEX_TAP_AGENT_NAME: resolvedAgent,
      TAP_RESOLVED_NODE: resolved.command,
      TAP_STRIP_TYPES: resolved.supportsStripTypes ? "1" : "0",
      ...(options.appServerUrl
        ? { CODEX_APP_SERVER_URL: options.appServerUrl }
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
      // Bridge script operational flags
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
      ...(options.threadId ? { TAP_THREAD_ID: options.threadId } : {}),
      ...(options.ephemeral ? { TAP_EPHEMERAL: "true" } : {}),
      ...(options.processExistingMessages
        ? { TAP_PROCESS_EXISTING: "true" }
        : {}),
    },
  });

  child.unref();
  fs.closeSync(logFd);

  if (!child.pid) {
    throw new Error(`Failed to spawn bridge process for ${instanceId}`);
  }

  const state: BridgeState = {
    pid: child.pid,
    statePath: pidFilePath(stateDir, instanceId),
    lastHeartbeat: new Date().toISOString(),
  };

  saveBridgeState(stateDir, instanceId, state);

  // NOTE: Heartbeat updates are the bridge process's responsibility.
  // The bridge script should periodically write to the PID file's lastHeartbeat field.
  // CLI only records the initial heartbeat at spawn time.

  return state;
}

export async function stopBridge(options: BridgeStopOptions): Promise<boolean> {
  const { instanceId, stateDir, platform } = options;
  const state = loadBridgeState(stateDir, instanceId);

  if (!state) {
    return false; // No PID file
  }

  if (!isProcessAlive(state.pid)) {
    clearBridgeState(stateDir, instanceId);
    return false; // Already dead
  }

  try {
    if (platform === "win32") {
      // Windows: use taskkill
      execSync(`taskkill /PID ${state.pid} /F /T`, { stdio: "pipe" });
    } else {
      // Unix: SIGTERM
      process.kill(state.pid, "SIGTERM");

      // Give it a moment, then SIGKILL if needed
      await new Promise((resolve) => setTimeout(resolve, 2000));
      if (isProcessAlive(state.pid)) {
        process.kill(state.pid, "SIGKILL");
      }
    }
  } catch {
    // Process may have already exited
  }

  clearBridgeState(stateDir, instanceId);
  return true;
}

// ─── Log rotation ──────────────────────────────────────────────

export function rotateLog(logPath: string): void {
  if (!fs.existsSync(logPath)) return;
  try {
    const stats = fs.statSync(logPath);
    if (stats.size === 0) return;
    const prevPath = `${logPath}.prev`;
    fs.renameSync(logPath, prevPath);
  } catch {
    // Best-effort: don't fail bridge start if rotation fails
  }
}

// ─── Heartbeat ─────────────────────────────────────────────────

/**
 * Update the heartbeat timestamp for a running bridge.
 * Bridge processes should call this periodically.
 *
 * Only the owning process (matching PID) can update the heartbeat.
 * This prevents state dir collision when multiple writers exist.
 * See: 묵 finding — bridge-heartbeat-state-dir-collision
 */
export function updateBridgeHeartbeat(
  stateDir: string,
  instanceId: InstanceId,
): void {
  const state = loadBridgeState(stateDir, instanceId);
  if (!state) return;

  // Guard: only the owning process may update heartbeat
  if (state.pid !== process.pid) return;

  state.lastHeartbeat = new Date().toISOString();
  saveBridgeState(stateDir, instanceId, state);
}

/**
 * Get heartbeat age in seconds. Returns null if no state or no heartbeat.
 */
export function getHeartbeatAge(
  stateDir: string,
  instanceId: InstanceId,
): number | null {
  const state = loadBridgeState(stateDir, instanceId);
  if (!state?.lastHeartbeat) return null;
  const heartbeatTime = new Date(state.lastHeartbeat).getTime();
  if (isNaN(heartbeatTime)) return null;
  return Math.floor((Date.now() - heartbeatTime) / 1000);
}

export function getBridgeStatus(
  stateDir: string,
  instanceId: InstanceId,
): "running" | "stopped" | "stale" {
  const state = loadBridgeState(stateDir, instanceId);
  if (!state) return "stopped";

  // Primary check: is the process actually alive?
  if (!isProcessAlive(state.pid)) {
    clearBridgeState(stateDir, instanceId);
    return "stale";
  }

  // Process is alive → running.
  // Heartbeat staleness is informational only — the bridge process
  // is responsible for updating lastHeartbeat. If it doesn't,
  // PID alive is still the authoritative signal.
  return "running";
}
