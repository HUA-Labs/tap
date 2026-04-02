import * as path from "node:path";
import {
  getBridgeStatus,
  loadBridgeState,
  resolveAgentName,
  saveBridgeState,
} from "../engine/bridge.js";
import type {
  InstanceId,
  AppServerState,
  BridgeState,
  TapState,
} from "../types.js";
import type { BridgeLifecycleSnapshot } from "../engine/bridge.js";

export function formatAge(seconds: number): string {
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m ago`;
}

export function formatAppServerState(appServer: AppServerState): string {
  const ownership = appServer.managed ? "managed" : "external";
  const pid = appServer.pid != null ? ` pid:${appServer.pid}` : "";
  const health = appServer.healthy ? "healthy" : "unhealthy";
  const auth =
    appServer.auth != null
      ? `, auth gateway:${appServer.auth.gatewayPid ?? "-"} -> ${appServer.auth.upstreamUrl}`
      : "";
  return `${health}, ${ownership}${pid}, ${appServer.url}${auth}`;
}

export function redactProtectedUrl(url: string): string {
  // Subprotocol auth: token is no longer in the URL.
  // Keep function for backward compat with old state files that may contain query tokens.
  try {
    const parsed = new URL(url);
    if (parsed.searchParams.has("tap_token")) {
      parsed.searchParams.delete("tap_token");
    }
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return url.replace(/[?&]tap_token=[^&]+/g, "");
  }
}

export function resolveTuiConnectUrl(appServer: AppServerState): string {
  return appServer.auth?.upstreamUrl ?? appServer.url;
}

export function quoteCliArg(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`;
}

function quoteShellEnvValue(value: string): string {
  if (process.platform === "win32") {
    return `'${value.replace(/'/g, "''")}'`;
  }
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function formatCodexTuiAttachCommand(
  tuiConnectUrl: string,
  cwd: string,
  env: Record<string, string> = {},
): string {
  const base = `codex --enable tui_app_server --remote ${quoteCliArg(tuiConnectUrl)} --cd ${quoteCliArg(cwd)}`;
  const entries = Object.entries(env).filter(([, value]) => value.length > 0);
  if (entries.length === 0) {
    return base;
  }

  if (process.platform === "win32") {
    const envPrefix = entries
      .map(([key, value]) => `$env:${key} = ${quoteShellEnvValue(value)}`)
      .join("; ");
    return `${envPrefix}; ${base}`;
  }

  const envPrefix = entries
    .map(([key, value]) => `${key}=${quoteShellEnvValue(value)}`)
    .join(" ");
  return `${envPrefix} ${base}`;
}

export function resolveTuiAttachCwd(
  repoRoot: string,
  stateRepoRoot: string | null | undefined,
  runtimeThreadCwd: string | null | undefined,
  savedThreadCwd: string | null | undefined,
): string {
  return runtimeThreadCwd ?? savedThreadCwd ?? stateRepoRoot ?? repoRoot;
}

export function loadCurrentBridgeState(
  stateDir: string,
  instanceId: InstanceId,
  fallback: BridgeState | null | undefined,
): BridgeState | null {
  return loadBridgeState(stateDir, instanceId) ?? fallback ?? null;
}

export function formatThreadSummary(
  threadId: string | null | undefined,
  cwd: string | null | undefined,
): string {
  if (!threadId) {
    return "-";
  }

  return cwd ? `${threadId} (${cwd})` : threadId;
}

export function normalizeComparablePath(value: string): string {
  return path.resolve(value).replace(/\\/g, "/").toLowerCase();
}

export function sameOptionalPath(
  left: string | null | undefined,
  right: string | null | undefined,
): boolean {
  if (!left || !right) {
    return left === right;
  }

  return normalizeComparablePath(left) === normalizeComparablePath(right);
}

export function resolveRecoveredAgentName(
  instanceId: InstanceId,
  explicitAgentName: string | undefined,
  repoRoot: string,
  stateDir: string,
): string | undefined {
  return (
    resolveAgentName(instanceId, explicitAgentName, { repoRoot, stateDir }) ??
    undefined
  );
}

export function formatLifecycleTransition(
  lifecycle: Pick<
    BridgeLifecycleSnapshot,
    "lastTransitionAt" | "lastTransitionReason" | "restartCount"
  > | null,
): string | null {
  if (!lifecycle?.lastTransitionAt) {
    return null;
  }

  const reason = lifecycle.lastTransitionReason
    ? ` (${lifecycle.lastTransitionReason})`
    : "";
  return `${lifecycle.lastTransitionAt}${reason}, restarts=${lifecycle.restartCount}`;
}

export function getSharedAppServerUsers(
  state: TapState,
  stateDir: string,
  currentInstanceId: InstanceId,
  appServerUrl: string,
): InstanceId[] {
  const shared: InstanceId[] = [];

  for (const [id, inst] of Object.entries(state.instances)) {
    if (id === currentInstanceId || !inst?.installed) {
      continue;
    }

    const instanceId = id as InstanceId;
    if (getBridgeStatus(stateDir, instanceId) !== "running") {
      continue;
    }

    const bridgeState = loadCurrentBridgeState(
      stateDir,
      instanceId,
      inst.bridge,
    );
    if (bridgeState?.appServer?.url === appServerUrl) {
      shared.push(instanceId);
    }
  }

  return shared;
}

export function transferManagedAppServerOwnership(
  state: TapState,
  stateDir: string,
  recipientId: InstanceId,
  appServer: AppServerState,
): boolean {
  const recipient = state.instances[recipientId];
  if (!recipient) {
    return false;
  }

  const bridgeState = loadCurrentBridgeState(
    stateDir,
    recipientId,
    recipient.bridge,
  );
  if (!bridgeState) {
    return false;
  }

  const transferredAppServer: AppServerState = {
    ...appServer,
    managed: true,
    healthy: true,
    lastCheckedAt: new Date().toISOString(),
    lastHealthyAt: appServer.lastHealthyAt ?? new Date().toISOString(),
  };

  const updatedBridge: BridgeState = {
    ...bridgeState,
    appServer: transferredAppServer,
  };

  saveBridgeState(stateDir, recipientId, updatedBridge);
  state.instances[recipientId] = {
    ...recipient,
    bridge: updatedBridge,
  };
  return true;
}
