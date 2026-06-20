import { existsSync, readFileSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { PRESENCE_DIR } from "./tap-utils.js";
import type { Heartbeat, HeartbeatStore } from "./tap-utils.js";

/**
 * M354: instance-id ownership change pruning.
 *
 * When a new agent claims an `instance_id` that currently holds metadata for
 * a different agent on the **same host**, drop the stale heartbeat store
 * entries and per-agent presence files so Layer 2 routing (`agent_id` /
 * `instance_id`) starts clean.
 *
 * Cross-device guard: entries whose `address.hostId` is set and differs from
 * the current session's host are left alone. The contract (M342 Layer 5)
 * requires that a local `tap_set_name` not invalidate presence records that
 * belong to other devices.
 */

export interface OwnershipPruneResult {
  /** Heartbeat store keys that were deleted from `store`. */
  prunedKeys: string[];
  /** Presence file basenames that were removed. */
  prunedPresenceFiles: string[];
  /** The prior owner whose metadata triggered the prune, if any. */
  previous: {
    agentId: string;
    displayName: string | null;
    instanceId: string;
    hostId: string | null;
    lastActivity: string | null;
  } | null;
}

function isSameInstance(
  entry: Heartbeat,
  currentInstanceId: string,
): boolean {
  const entryInstanceId = entry.instanceId?.trim();
  if (entryInstanceId && entryInstanceId === currentInstanceId) return true;
  const addressClientId = entry.address?.clientId?.trim();
  if (addressClientId && addressClientId === currentInstanceId) return true;
  return false;
}

function shouldPrune(
  entry: Heartbeat,
  currentInstanceId: string,
  currentHostId: string | null,
): boolean {
  if (!isSameInstance(entry, currentInstanceId)) return false;
  const entryHostId = entry.address?.hostId?.trim() || null;
  // Cross-device protection — if the entry explicitly advertises a host that
  // is not ours, preserve it. Entries without a host annotation are assumed
  // local to this session.
  if (entryHostId && currentHostId && entryHostId !== currentHostId) {
    return false;
  }
  return true;
}

function sanitizePresenceId(agentId: string): string {
  return agentId.replace(/[/\\:]/g, "_");
}

function tryRemovePresenceFile(sanitizedId: string): string | null {
  if (!existsSync(PRESENCE_DIR)) return null;
  const candidate = join(PRESENCE_DIR, `${sanitizedId}.json`);
  if (!existsSync(candidate)) return null;
  try {
    unlinkSync(candidate);
    return `${sanitizedId}.json`;
  } catch {
    return null;
  }
}

export function pruneInstanceOwnershipChange(params: {
  store: HeartbeatStore;
  currentAgentId: string;
  currentInstanceId: string;
  currentHostId: string | null;
}): OwnershipPruneResult {
  const { store, currentAgentId, currentInstanceId, currentHostId } = params;
  const prunedKeys: string[] = [];
  const prunedPresenceFiles: string[] = [];
  let previous: OwnershipPruneResult["previous"] = null;

  // Prune heartbeat store entries keyed under the same instance_id but a
  // different agent_id.
  for (const [key, entry] of Object.entries(store)) {
    if (key === currentAgentId) continue;
    if (!shouldPrune(entry, currentInstanceId, currentHostId)) continue;

    prunedKeys.push(key);
    if (!previous) {
      previous = {
        agentId: key,
        displayName: entry.agent?.trim() || null,
        instanceId: currentInstanceId,
        hostId: entry.address?.hostId?.trim() || null,
        lastActivity:
          entry.lastActivity?.trim() || entry.timestamp?.trim() || null,
      };
    }
    delete store[key];

    const sanitized = sanitizePresenceId(key);
    const removed = tryRemovePresenceFile(sanitized);
    if (removed) prunedPresenceFiles.push(removed);
  }

  // Scan presence/ for orphan files whose content is bound to the same
  // instance_id but a different agent_id on our host. Heartbeat store may
  // have already been pruned locally, but presence files can linger if the
  // previous session did not call tap_cleanup.
  if (existsSync(PRESENCE_DIR)) {
    for (const filename of readdirSync(PRESENCE_DIR)) {
      if (!filename.endsWith(".json")) continue;
      const basename = filename.replace(/\.json$/, "");
      if (basename === sanitizePresenceId(currentAgentId)) continue;
      if (prunedPresenceFiles.includes(filename)) continue;
      const filePath = join(PRESENCE_DIR, filename);
      let parsed: Heartbeat | null = null;
      try {
        parsed = JSON.parse(readFileSync(filePath, "utf-8")) as Heartbeat;
      } catch {
        continue;
      }
      if (!parsed) continue;
      if (!shouldPrune(parsed, currentInstanceId, currentHostId)) continue;
      try {
        unlinkSync(filePath);
        prunedPresenceFiles.push(filename);
        if (!previous) {
          previous = {
            agentId: basename,
            displayName: parsed.agent?.trim() || null,
            instanceId: currentInstanceId,
            hostId: parsed.address?.hostId?.trim() || null,
            lastActivity:
              parsed.lastActivity?.trim() ||
              parsed.timestamp?.trim() ||
              null,
          };
        }
      } catch {
        // Non-fatal — orphan presence file stays put.
      }
    }
  }

  return {
    prunedKeys,
    prunedPresenceFiles,
    previous,
  };
}
