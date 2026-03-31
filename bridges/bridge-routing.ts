// bridge-routing.ts — Agent identity, message routing, frontmatter parsing

import { existsSync, readFileSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import {
  DEFAULT_AGENT,
  HeartbeatStore,
  InboxRoute,
  LoadedThreadCandidate,
  Options,
  PLACEHOLDER_AGENT_VALUES,
  STALE_TURN_MS,
} from "./bridge-types.js";
import {
  canonicalizeAgentId,
  matchesAgentRecipient as sharedMatchesAgentRecipient,
  isOwnMessageAddress as sharedIsOwnMessageAddress,
} from "../../packages/tap-plugin/channels/tap-identity.js";

/**
 * M206: Re-export canonicalizeAgentId as canonicalize for backward compat.
 */
export function canonicalize(id: string): string {
  return canonicalizeAgentId(id);
}

export function normalizeThreadCwd(cwd: string): string {
  return resolve(cwd).replace(/\\/g, "/").toLowerCase();
}

export function threadCwdMatches(
  expectedCwd: string,
  actualCwd: string | null | undefined,
): boolean {
  if (!actualCwd) {
    return false;
  }

  return normalizeThreadCwd(expectedCwd) === normalizeThreadCwd(actualCwd);
}

export function chooseLoadedThreadForCwd(
  cwd: string,
  threads: LoadedThreadCandidate[],
): LoadedThreadCandidate | null {
  const matching = threads.filter((thread) =>
    threadCwdMatches(cwd, thread.cwd),
  );
  if (matching.length === 0) {
    return null;
  }

  matching.sort((left, right) => {
    const leftActive = left.statusType === "active" ? 1 : 0;
    const rightActive = right.statusType === "active" ? 1 : 0;
    if (leftActive !== rightActive) {
      return rightActive - leftActive;
    }
    return right.updatedAt - left.updatedAt;
  });

  return matching[0] ?? null;
}

export function normalizeAgentToken(value?: string | null): string | null {
  const normalized = value?.trim();
  if (!normalized || PLACEHOLDER_AGENT_VALUES.has(normalized)) {
    return null;
  }

  return canonicalize(normalized);
}

export function resolveAgentId(preferredAgentName?: string | null): string {
  return (
    normalizeAgentToken(process.env.TAP_AGENT_ID) ??
    normalizeAgentToken(preferredAgentName) ??
    "unknown"
  );
}

export function resolveAgentName(
  preferredAgentName: string | null,
  stateDir: string,
): string {
  if (preferredAgentName?.trim()) {
    return preferredAgentName.trim();
  }

  const agentFile = join(stateDir, "agent-name.txt");
  if (existsSync(agentFile)) {
    const candidate = readFileSync(agentFile, "utf8").trim();
    if (candidate) {
      return candidate;
    }
  }

  return DEFAULT_AGENT;
}

export function resolveCurrentAgentName(
  agentId: string,
  fallbackAgentName: string,
  heartbeats: HeartbeatStore,
): string {
  const currentName = heartbeats[agentId]?.agent?.trim();
  if (currentName) {
    return currentName;
  }

  for (const heartbeat of Object.values(heartbeats)) {
    if (heartbeat.id?.trim() === agentId && heartbeat.agent?.trim()) {
      return heartbeat.agent.trim();
    }
  }

  return fallbackAgentName;
}

export function resolveAddressLabel(
  address: string,
  heartbeats: HeartbeatStore,
): string {
  const normalized = address.trim();
  if (!normalized || normalized === "전체" || normalized === "all") {
    return address;
  }

  const direct = heartbeats[normalized];
  if (direct?.agent?.trim()) {
    return formatAgentLabel(normalized, direct.agent);
  }

  for (const [agentId, heartbeat] of Object.entries(heartbeats)) {
    if (heartbeat.agent?.trim() === normalized) {
      return formatAgentLabel(agentId, heartbeat.agent);
    }
  }

  return normalized;
}

export function persistAgentName(stateDir: string, agentName: string): void {
  writeFileSync(join(stateDir, "agent-name.txt"), `${agentName}\n`, "utf8");
}

export function formatAgentLabel(
  agentIdOrName: string,
  displayName?: string | null,
): string {
  const normalizedId = agentIdOrName.trim();
  const normalizedName = displayName?.trim();

  if (!normalizedId) {
    return normalizedName ?? agentIdOrName;
  }

  if (!normalizedName || normalizedName === normalizedId) {
    return normalizedId;
  }

  return `${normalizedName} [${normalizedId}]`;
}

/**
 * Resolve the current display name from heartbeats and persist if changed.
 * Returns the resolved name WITHOUT mutating options.agentName — callers
 * should use the return value for the current scan cycle only.
 * This prevents recipient matching from losing the original configured name.
 */
export function refreshAgentIdentity(
  options: Options,
  heartbeats: HeartbeatStore,
): string {
  const nextAgentName = resolveCurrentAgentName(
    options.agentId,
    options.agentName,
    heartbeats,
  );

  if (nextAgentName !== options.agentName) {
    // Persist for next startup, but don't mutate options mid-cycle
    persistAgentName(options.stateDir, nextAgentName);
  }

  return nextAgentName;
}

/**
 * M206: Delegate to shared tap-identity helper.
 * Kept as named export for barrel backward compatibility.
 */
export function recipientMatchesAgent(
  recipient: string,
  agentId: string,
  agentName: string,
): boolean {
  return sharedMatchesAgentRecipient(recipient, agentId, agentName);
}

/**
 * M206: Delegate to shared tap-identity helper.
 * Kept as named export for barrel backward compatibility.
 */
export function isOwnMessageSender(
  sender: string,
  agentId: string,
  agentName: string,
): boolean {
  return sharedIsOwnMessageAddress(sender, agentId, agentName);
}

/**
 * M203: Check if a turn's activeFlags indicate it cannot accept steer.
 * Returns true if the turn should be treated as not active.
 */
export function isTurnStuckOnApproval(activeFlags: string[]): boolean {
  return activeFlags.includes("waitingOnApproval");
}

/**
 * M203: Check if a turn has been running longer than the stale threshold.
 */
export function isTurnStale(
  turnStartedAt: string | null,
  nowMs: number = Date.now(),
): boolean {
  if (!turnStartedAt) return false;
  return nowMs - new Date(turnStartedAt).getTime() > STALE_TURN_MS;
}

export function shouldRetrySteerAsStart(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return (
    message.includes("no active turn") ||
    message.includes("expectedturnid") ||
    (message.includes("turn/steer failed") &&
      (message.includes("active turn") || message.includes("not found")))
  );
}

/**
 * Parse YAML frontmatter from message content for routing.
 * Returns null if no valid frontmatter found.
 */
export function parseBridgeFrontmatter(
  content: string,
): { sender: string; recipient: string; subject: string } | null {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return null;

  const fields: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const kv = line.match(/^(\w+):\s*(.+)$/);
    if (kv) fields[kv[1]] = kv[2].trim();
  }

  if (!fields.from || !fields.to) return null;

  return {
    sender: fields.from,
    recipient: fields.to,
    subject: fields.subject ?? "",
  };
}

/**
 * Strip YAML frontmatter from message content, returning only the body.
 */
export function stripBridgeFrontmatter(content: string): string {
  return content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n*/, "");
}

export function getInboxRoute(fileName: string, body?: string): InboxRoute {
  if (body) {
    const fm = parseBridgeFrontmatter(body);
    if (fm) return fm;
  }
  return getInboxRouteFromFilename(fileName);
}

export function getInboxRouteFromFilename(fileName: string): InboxRoute {
  const stem = fileName.replace(/\.md$/i, "");
  const parts = stem.split("-");
  let offset = 0;
  if (parts[0] && /^\d{8}$/.test(parts[0])) {
    offset = 1;
  }

  return {
    sender: parts[offset] ?? "",
    recipient: parts[offset + 1] ?? "",
    subject: parts.slice(offset + 2).join("-"),
  };
}
