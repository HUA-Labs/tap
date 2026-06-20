// bridge-routing.ts — Agent identity, message routing, frontmatter parsing

import { existsSync, readFileSync, writeFileSync } from "fs";
import { join, resolve, win32 } from "path";
import {
  type BridgeRoutingSlot,
  type CandidateScope,
  DEFAULT_AGENT,
  type HeartbeatAddressRecord,
  type HeartbeatStore,
  type InboxRoute,
  type LoadedThreadCandidate,
  type Options,
  PLACEHOLDER_AGENT_VALUES,
  STALE_TURN_MS,
} from "./bridge-types.ts";
import {
  canonicalizeAgentId,
  matchesAgentRecipient as sharedMatchesAgentRecipient,
  isOwnMessageAddress as sharedIsOwnMessageAddress,
} from "../../packages/tap-plugin/channels/tap-identity.ts";

/**
 * M206: Re-export canonicalizeAgentId as canonicalize for backward compat.
 */
export function canonicalize(id: string): string {
  return canonicalizeAgentId(id);
}

const WINDOWS_NAMESPACE_PREFIX = "\\\\?\\";
const WINDOWS_NAMESPACE_UNC_PREFIX = "\\\\?\\UNC\\";

function looksLikeWindowsAbsolutePath(value: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(value) || value.startsWith("\\\\");
}

export function stripWindowsNamespacePrefix(cwd: string): string {
  const trimmed = cwd.trim();
  if (trimmed.startsWith(WINDOWS_NAMESPACE_UNC_PREFIX)) {
    return `\\\\${trimmed.slice(WINDOWS_NAMESPACE_UNC_PREFIX.length)}`;
  }
  if (trimmed.startsWith(WINDOWS_NAMESPACE_PREFIX)) {
    return trimmed.slice(WINDOWS_NAMESPACE_PREFIX.length);
  }
  return trimmed;
}

function resolveThreadCwd(cwd: string): string {
  const normalized = stripWindowsNamespacePrefix(cwd);
  return looksLikeWindowsAbsolutePath(normalized)
    ? win32.resolve(normalized)
    : resolve(normalized);
}

export function normalizeThreadCwd(cwd: string): string {
  return resolveThreadCwd(cwd).replace(/\\/g, "/").toLowerCase();
}

export function normalizePersistedThreadCwd(
  cwd: string | null | undefined,
): string | null {
  if (!cwd?.trim()) {
    return null;
  }

  return resolveThreadCwd(cwd);
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
  const reusable = threads.filter((thread) => {
    if (!threadCwdMatches(cwd, thread.cwd)) {
      return false;
    }

    // `notLoaded` means the app-server knows about the thread id but the
    // thread is not attached in memory, so treating it as a ready loaded
    // thread can strand headless dispatch after restart/TUI detach.
    if (thread.statusType === "notLoaded") {
      return false;
    }

    // Do not auto-attach to someone else's active loaded thread just because
    // it shares the repo cwd. That can create turn-id mismatches across
    // multiple bridge/TUI clients on the same thread.
    if (thread.statusType === "active") {
      return false;
    }

    const threadActiveFlags: string[] = Array.isArray(
      thread.thread?.status?.activeFlags,
    )
      ? thread.thread.status.activeFlags
      : [];
    if (isTurnStuckOnApproval(threadActiveFlags)) {
      return false;
    }

    const turns = Array.isArray(thread.thread?.turns)
      ? thread.thread.turns
      : [];
    return !turns.some((turn: Record<string, unknown>) => {
      const activeFlags: string[] = Array.isArray(turn?.activeFlags)
        ? turn.activeFlags
        : [];
      return (
        turn?.status === "inProgress" && isTurnStuckOnApproval(activeFlags)
      );
    });
  });
  if (reusable.length === 0) {
    return null;
  }

  reusable.sort((left, right) => right.updatedAt - left.updatedAt);

  return reusable[0] ?? null;
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

export function isWaitingApprovalStatus(
  status: string | null | undefined,
): boolean {
  if (!status) {
    return false;
  }

  return /approval|input-required|confirm|consent/i.test(status);
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

export const FORBIDDEN_RAW_PAIR_TOKEN_REASON =
  "envelope rejected: forbidden raw pairToken field present (M355 defensive drop)";

function normalizeFrontmatterValue(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function parseJsonObject(
  value: string | undefined,
): Record<string, unknown> | null {
  const normalized = normalizeFrontmatterValue(value);
  if (!normalized) {
    return null;
  }

  try {
    const parsed = JSON.parse(normalized) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function parseFrontmatterScope(
  value: string | undefined,
): CandidateScope | null {
  const normalized = normalizeFrontmatterValue(value);
  if (
    normalized === "observe" ||
    normalized === "suggest" ||
    normalized === "drive"
  ) {
    return normalized;
  }
  return null;
}

function parseFrontmatterAliases(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const aliases: string[] = [];
  for (const candidate of value) {
    if (typeof candidate !== "string") continue;
    const normalized = candidate.trim();
    if (!normalized || aliases.includes(normalized)) continue;
    aliases.push(normalized);
  }

  return aliases.length > 0 ? aliases : undefined;
}

function parseFrontmatterSlot(value: unknown): BridgeRoutingSlot | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  if (
    normalized === "tower" ||
    normalized === "reviewer" ||
    /^wt-\d+$/.test(normalized)
  ) {
    return normalized as BridgeRoutingSlot;
  }

  return null;
}

function parseFrontmatterAddress(
  value: string | undefined,
): HeartbeatAddressRecord | null {
  const record = parseJsonObject(value);
  if (!record) {
    return null;
  }

  return {
    hostId: normalizeFrontmatterValue(
      typeof record.hostId === "string" ? record.hostId : undefined,
    ),
    clientId: normalizeFrontmatterValue(
      typeof record.clientId === "string" ? record.clientId : undefined,
    ),
    conversationId: normalizeFrontmatterValue(
      typeof record.conversationId === "string"
        ? record.conversationId
        : undefined,
    ),
    ownerClientId: normalizeFrontmatterValue(
      typeof record.ownerClientId === "string"
        ? record.ownerClientId
        : undefined,
    ),
    routingAddress: normalizeFrontmatterValue(
      typeof record.routingAddress === "string"
        ? record.routingAddress
        : undefined,
    ) ?? undefined,
    slot: parseFrontmatterSlot(record.slot),
    aliases: parseFrontmatterAliases(record.aliases),
  };
}

/**
 * Parse YAML frontmatter from message content for routing.
 * Returns null if no valid frontmatter found.
 */
export function parseBridgeFrontmatter(
  content: string,
): InboxRoute | null {
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
    messageId:
      normalizeFrontmatterValue(fields.message_id) ??
      normalizeFrontmatterValue(fields.messageId),
    fromAddress: parseFrontmatterAddress(fields.from_address),
    toAddress: parseFrontmatterAddress(fields.to_address),
    scope: parseFrontmatterScope(fields.scope),
    action: normalizeFrontmatterValue(fields.action),
    consentRef:
      normalizeFrontmatterValue(fields.consent_ref) ??
      normalizeFrontmatterValue(fields.consentRef),
    validationError:
      normalizeFrontmatterValue(fields.pairToken) ??
      normalizeFrontmatterValue(fields.pair_token)
        ? FORBIDDEN_RAW_PAIR_TOKEN_REASON
        : null,
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
    validationError: null,
  };
}
