import * as fs from "node:fs";
import * as path from "node:path";
import type { InstanceId, BridgeState } from "../types.js";
import { loadState } from "../state.js";
import { loadInstanceConfig } from "../config/instance-config.js";
import { resolveConfig } from "../config/resolve.js";

/** M310: Heartbeat recency threshold for restart recovery (24 hours). */
const HEARTBEAT_RECOVERY_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Resolve agent name for bridge startup.
 * M310: Priority: explicit > heartbeats (recent session) > instance config > state.json > env.
 * Heartbeats are the session-mutable SSOT; instance config and state.json are
 * bootstrap-only defaults that should not override a recent session name.
 */
export function resolveAgentName(
  instanceId: InstanceId,
  explicit?: string,
  context?: { repoRoot?: string; stateDir?: string },
): string | null {
  if (explicit) return explicit;

  // M310: Recover name from heartbeats — session-mutable SSOT.
  // If this instance had a recent active name (< 24h), use it.
  try {
    // Use canonical resolveConfig() to get commsDir — same priority as the
    // rest of the system (shared config > local config > env > legacy > default).
    const repoRoot =
      context?.repoRoot ??
      context?.stateDir?.replace(/[\\/].tap-comms$/, "") ??
      process.cwd();
    const { config: resolved } = resolveConfig({}, repoRoot);
    const commsDir = resolved.commsDir;
    const heartbeatsPath = path.join(commsDir, "heartbeats.json");
    if (fs.existsSync(heartbeatsPath)) {
      const store = JSON.parse(
        fs.readFileSync(heartbeatsPath, "utf-8"),
      ) as Record<
        string,
        {
          agent?: string;
          timestamp?: string;
          lastActivity?: string;
          instanceId?: string | null;
        }
      >;

      // Match by instance ID or normalized ID
      const normalizedId = instanceId.replace(/-/g, "_");
      for (const [key, hb] of Object.entries(store)) {
        const keyNormalized = key.replace(/-/g, "_");
        const matchesId =
          keyNormalized === normalizedId ||
          hb.instanceId === instanceId ||
          hb.instanceId === normalizedId;
        if (!matchesId) continue;
        if (!hb.agent || hb.agent === "unknown" || hb.agent === "unnamed")
          continue;

        // Check recency using max of lastActivity and timestamp (M144 pattern).
        // Idle bridges have fresh timestamp but stale lastActivity.
        const activityMs = hb.lastActivity
          ? new Date(hb.lastActivity).getTime()
          : 0;
        const timestampMs = hb.timestamp ? new Date(hb.timestamp).getTime() : 0;
        const freshestMs = Math.max(activityMs, timestampMs);
        if (Date.now() - freshestMs < HEARTBEAT_RECOVERY_MAX_AGE_MS) {
          return hb.agent;
        }
      }
    }
  } catch {
    // heartbeat recovery failed — fall through to bootstrap defaults
  }

  // M310: state.json is the primary bootstrap source — it's always updated
  // on add/start/restart. Instance config is deprecated and may lag behind.
  try {
    const repoRoot =
      context?.repoRoot ??
      context?.stateDir?.replace(/[\\/].tap-comms$/, "") ??
      process.cwd();
    const state = loadState(repoRoot);
    const inst = state?.instances[instanceId];
    const stateAgent = inst?.defaultAgentName;
    if (stateAgent) return stateAgent;
  } catch {
    // state read failed — fall through
  }

  // Instance config (deprecated — fallback only when state.json unavailable)
  if (context?.stateDir) {
    try {
      const instConfig = loadInstanceConfig(context.stateDir, instanceId);
      const instName = instConfig?.defaultAgentName;
      if (instName) return instName;
    } catch {
      // instance config read failed — fall through
    }
  }

  return process.env.TAP_AGENT_NAME || process.env.CODEX_TAP_AGENT_NAME || null;
}

/**
 * Infer restart mode from current bridge/instance state.
 * Priority: explicit flags > saved instance mode > bridge state inference > defaults.
 */
export function inferRestartMode(
  bridgeState: BridgeState | null,
  flags?: { noServer?: boolean; noAuth?: boolean; unsandboxed?: boolean },
  savedMode?: {
    manageAppServer?: boolean;
    noAuth?: boolean;
    appServerUnsandboxed?: boolean;
  },
): {
  manageAppServer: boolean;
  noAuth: boolean;
  appServerUnsandboxed: boolean;
} {
  const wasManaged = bridgeState?.appServer != null;
  const hadAuth = bridgeState?.appServer?.auth != null;
  const wasUnsandboxed =
    bridgeState?.appServer?.manualCommand.includes(
      "--dangerously-bypass-approvals-and-sandbox",
    ) ?? false;

  const manageAppServer =
    flags?.noServer === true
      ? false
      : flags?.noServer === undefined
        ? (savedMode?.manageAppServer ?? wasManaged)
        : true;
  const noAuth =
    flags?.noAuth === true
      ? true
      : flags?.noAuth === undefined
        ? (savedMode?.noAuth ?? !hadAuth)
        : false;
  const appServerUnsandboxed =
    flags?.unsandboxed === true
      ? true
      : flags?.unsandboxed === undefined
        ? (savedMode?.appServerUnsandboxed ?? wasUnsandboxed)
        : false;

  return { manageAppServer, noAuth, appServerUnsandboxed };
}

/**
 * Clean up headless dispatch files from inbox.
 * Matches YYYYMMDD-headless-{agent}-review-PR{n}.md pattern.
 */
export function cleanupHeadlessDispatch(
  inboxDir: string,
  agentName: string,
): string[] {
  const removed: string[] = [];
  if (!fs.existsSync(inboxDir)) return removed;

  const normalizedAgent = agentName.replace(/-/g, "_");
  const marker = `-headless-${normalizedAgent}-review-`;

  try {
    for (const file of fs.readdirSync(inboxDir)) {
      if (file.includes(marker)) {
        fs.unlinkSync(path.join(inboxDir, file));
        removed.push(file);
      }
    }
  } catch {
    // best-effort
  }

  return removed;
}
