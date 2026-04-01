import * as fs from "node:fs";
import * as path from "node:path";
import type { InstanceId, BridgeState } from "../types.js";
import { loadState } from "../state.js";
import { loadInstanceConfig } from "../config/instance-config.js";

/**
 * Resolve agent name: explicit > instance config > state.json > env.
 * Exported for direct testing without spawning a process.
 */
export function resolveAgentName(
  instanceId: InstanceId,
  explicit?: string,
  context?: { repoRoot?: string; stateDir?: string },
): string | null {
  if (explicit) return explicit;

  // Instance config (Phase 1-2 source-of-truth)
  if (context?.stateDir) {
    try {
      const instConfig = loadInstanceConfig(context.stateDir, instanceId);
      if (instConfig?.agentName) return instConfig.agentName;
    } catch {
      // instance config read failed — fall through
    }
  }

  // state.json SSOT (#784 backwrite)
  try {
    const repoRoot =
      context?.repoRoot ??
      context?.stateDir?.replace(/[\\/].tap-comms$/, "") ??
      process.cwd();
    const state = loadState(repoRoot);
    const stateAgent = state?.instances[instanceId]?.agentName;
    if (stateAgent) return stateAgent;
  } catch {
    // state read failed — fall through
  }

  return process.env.TAP_AGENT_NAME || process.env.CODEX_TAP_AGENT_NAME || null;
}

/**
 * Infer restart mode from current bridge/instance state.
 * Priority: explicit flags > saved instance mode > bridge state inference > defaults.
 */
export function inferRestartMode(
  bridgeState: BridgeState | null,
  flags?: { noServer?: boolean; noAuth?: boolean },
  savedMode?: { manageAppServer?: boolean; noAuth?: boolean },
): { manageAppServer: boolean; noAuth: boolean } {
  const wasManaged = bridgeState?.appServer != null;
  const hadAuth = bridgeState?.appServer?.auth != null;

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

  return { manageAppServer, noAuth };
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
