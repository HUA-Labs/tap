import * as fs from "node:fs";
import * as path from "node:path";
import type {
  BridgeLifecycleRecord,
  BridgeState,
  InstanceId,
  Platform,
} from "../types.js";
import type { BridgeLifecycleSnapshot } from "./server-lifecycle.js";
import { getBridgeStatus } from "./bridge-observability.js";
import { loadBridgeState } from "./bridge-state.js";
import { resolveBridgeLifecycleSnapshot } from "./server-lifecycle.js";
import {
  loadLiveDispatchEvidence,
  type LiveDispatchEvidence,
} from "./health-monitor.js";

const BRIDGE_STARTUP_LOCK_STALE_MS = 60 * 1000;

export type BridgeRestartPlanKind =
  | "managed-restart"
  | "external-managed"
  | "not-running"
  | "blocked";

export interface BridgeRestartPlan {
  kind: BridgeRestartPlanKind;
  reason: string;
  manualHint?: string;
  evidence?: string;
  bridgeState: BridgeState | null;
  lifecycle: BridgeLifecycleSnapshot;
  liveDispatch: LiveDispatchEvidence | null;
}

export interface ResolveBridgeRestartPlanOptions {
  instanceId: InstanceId;
  stateDir: string;
  commsDir: string;
  liveDispatchAliases?: Array<string | null | undefined>;
  platform: Platform;
  persistedLifecycle?: BridgeLifecycleRecord | null;
  fallbackBridgeState?: BridgeState | null;
}

function startupLockPath(stateDir: string, instanceId: InstanceId): string {
  return path.join(stateDir, "pids", `bridge-${instanceId}.startup.lock`);
}

function hasFreshStartupLock(
  stateDir: string,
  instanceId: InstanceId,
): boolean {
  const lockPath = startupLockPath(stateDir, instanceId);
  if (!fs.existsSync(lockPath)) {
    return false;
  }

  try {
    const stats = fs.statSync(lockPath);
    return Date.now() - stats.mtimeMs < BRIDGE_STARTUP_LOCK_STALE_MS;
  } catch {
    return false;
  }
}

function formatExternalManagedHint(
  platform: Platform,
  instanceId: InstanceId,
  bridgePid: number | null,
): string {
  if (bridgePid != null) {
    if (platform === "win32") {
      return `Use the owning PowerShell/script manager to restart ${instanceId}. Hint: Get-Process -Id ${bridgePid}; Stop-Process -Id ${bridgePid}`;
    }
    return `Use the owning shell/service manager to restart ${instanceId}. Hint: ps -fp ${bridgePid}; kill ${bridgePid}`;
  }

  if (platform === "win32") {
    return `Use the owning PowerShell/script manager to restart ${instanceId}.`;
  }
  return `Use the owning shell/service manager to restart ${instanceId}.`;
}

export function resolveBridgeRestartPlan(
  options: ResolveBridgeRestartPlanOptions,
): BridgeRestartPlan {
  const persistedBridgeState =
    loadBridgeState(options.stateDir, options.instanceId) ??
    options.fallbackBridgeState ??
    null;
  const rawStatus = getBridgeStatus(options.stateDir, options.instanceId);
  const bridgeState =
    rawStatus === "running"
      ? (loadBridgeState(options.stateDir, options.instanceId) ??
        persistedBridgeState)
      : null;
  const lifecycle = resolveBridgeLifecycleSnapshot(
    options.stateDir,
    options.instanceId,
    bridgeState ?? persistedBridgeState,
    options.persistedLifecycle ?? persistedBridgeState?.lifecycle ?? null,
  );
  const liveDispatch =
    rawStatus === "running"
      ? null
      : loadLiveDispatchEvidence(
          options.commsDir,
          options.instanceId,
          options.liveDispatchAliases,
        );

  if (hasFreshStartupLock(options.stateDir, options.instanceId)) {
    return {
      kind: "blocked",
      reason: "bridge startup already in progress",
      manualHint: `Wait for startup to finish, then rerun: npx @hua-labs/tap bridge restart ${options.instanceId}`,
      bridgeState,
      lifecycle,
      liveDispatch,
    };
  }

  if (
    lifecycle.status === "initializing" ||
    (options.persistedLifecycle?.state ?? bridgeState?.lifecycle?.state) ===
      "stopping"
  ) {
    return {
      kind: "blocked",
      reason: `bridge is ${lifecycle.status === "initializing" ? "initializing" : "stopping"}`,
      manualHint: `Wait for bridge state to settle, then rerun: npx @hua-labs/tap bridge restart ${options.instanceId}`,
      bridgeState,
      lifecycle,
      liveDispatch,
    };
  }

  if (liveDispatch) {
    return {
      kind: "external-managed",
      reason:
        "fresh bridge-dispatch heartbeat exists without a tracked bridge pid",
      evidence: `fresh bridge-dispatch heartbeat from PID ${liveDispatch.bridgePid}`,
      manualHint: formatExternalManagedHint(
        options.platform,
        options.instanceId,
        liveDispatch.bridgePid,
      ),
      bridgeState,
      lifecycle,
      liveDispatch,
    };
  }

  if (rawStatus === "stopped" || rawStatus === "stale") {
    return {
      kind: "not-running",
      reason: "no tracked running bridge found",
      bridgeState,
      lifecycle,
      liveDispatch,
    };
  }

  return {
    kind: "managed-restart",
    reason: "tracked bridge pid is alive",
    bridgeState,
    lifecycle,
    liveDispatch,
  };
}
