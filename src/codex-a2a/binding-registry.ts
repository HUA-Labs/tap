import type {
  ObserveTransportSnapshot,
  TransportAddress,
} from "../transport/types.js";
import {
  canUseConsentDriveForAddress,
  normalizeReceiveTransports,
  type TapReceiveTransport,
} from "../routing/receive-transports.js";

type JsonRecord = Record<string, unknown>;

export type CodexBindingSource = "heartbeat" | "observe";

export type CodexBindingBlockReason =
  | "missing-target"
  | "not-found"
  | "partial"
  | "stale"
  | "ambiguous"
  | "not-reachable"
  | "binding-mismatch";

export type CodexBindingStatus = "ready" | "partial" | "stale";

export type CodexBindingRuntimeHealthStatus =
  | "ready"
  | "partial"
  | "stale-owner"
  | "active-turn"
  | "stale-active-turn"
  | "stuck-turn"
  | "not-observed"
  | "adapter-unavailable"
  | "degraded"
  | "unknown";

export interface CodexBindingRuntimeHealth {
  status: CodexBindingRuntimeHealthStatus;
  reason: string | null;
  checkedAt: string | null;
  adapter: string | null;
  recovery: string | null;
}

export interface CodexBindingAddress extends TransportAddress {
  routingAddress: string;
}

export interface CodexBinding {
  agentName: string | null;
  routingAddress: string;
  runtime: "codex";
  hostId: string | null;
  clientId: string | null;
  conversationId: string | null;
  ownerClientId: string | null;
  instanceId: string | null;
  receiveTransports: TapReceiveTransport[];
  bindingStatus: CodexBindingStatus;
  lastSeenAt: string | null;
  staleReason: string | null;
  health: CodexBindingRuntimeHealth | null;
  sources: CodexBindingSource[];
  aliases: string[];
}

export interface CodexBindingRegistry {
  bindings: CodexBinding[];
  builtAt: string;
  staleAfterMs: number;
}

export interface CodexBindingHeartbeat {
  id?: string;
  agent?: string;
  status?: string;
  source?: string;
  timestamp?: string;
  lastActivity?: string;
  instanceId?: string | null;
  receiveTransports?: string[];
  address?: {
    hostId?: string | null;
    clientId?: string | null;
    conversationId?: string | null;
    ownerClientId?: string | null;
    routingAddress?: string | null;
    aliases?: string[];
  };
  capabilities?: {
    receiveTransports?: string[];
    conversationId?: string | null;
    ownerClientId?: string | null;
  };
  health?: Partial<CodexBindingRuntimeHealth> | null;
}

export interface BuildCodexBindingRegistryOptions {
  heartbeats?: Record<string, CodexBindingHeartbeat> | null;
  observeSnapshot?: ObserveTransportSnapshot | null;
  now?: Date | string | number;
  staleAfterMs?: number;
}

export interface ResolveCodexBindingTarget {
  agentName?: string | null;
  routingAddress?: string | null;
  hostId?: string | null;
  clientId?: string | null;
  conversationId?: string | null;
  ownerClientId?: string | null;
}

export type ResolveCodexBindingResult =
  | {
      status: "resolved";
      binding: CodexBinding;
    }
  | {
      status: "blocked";
      reason: CodexBindingBlockReason;
      candidates: CodexBinding[];
      message: string;
    };

export interface ResolveCodexBindingOptions {
  registry: CodexBindingRegistry;
  target: ResolveCodexBindingTarget;
  localHostId?: string | null;
  liveSnapshot?: ObserveTransportSnapshot | null;
}

const DEFAULT_STALE_AFTER_MS = 30 * 60 * 1000;

const HEALTH_SEVERITY: Record<CodexBindingRuntimeHealthStatus, number> = {
  "stuck-turn": 90,
  "stale-owner": 80,
  "stale-active-turn": 75,
  "active-turn": 70,
  partial: 60,
  "adapter-unavailable": 50,
  degraded: 40,
  "not-observed": 30,
  unknown: 20,
  ready: 10,
};

const HEALTH_STATUSES = new Set<CodexBindingRuntimeHealthStatus>(
  Object.keys(HEALTH_SEVERITY) as CodexBindingRuntimeHealthStatus[],
);

function normalizeString(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function normalizeToken(value: string | null | undefined): string | null {
  return normalizeString(value)?.replace(/-/g, "_").toLowerCase() ?? null;
}

function isCodexLike(value: string | null | undefined): boolean {
  const token = normalizeToken(value);
  return token === "codex" || Boolean(token?.startsWith("codex_"));
}

function toTime(value: Date | string | number | undefined): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : Date.now();
  }
  return Date.now();
}

function normalizeAliases(
  values: readonly (string | null | undefined)[],
): string[] {
  const aliases: string[] = [];
  for (const value of values) {
    const normalized = normalizeString(value);
    if (!normalized || aliases.includes(normalized)) continue;
    aliases.push(normalized);
  }
  return aliases;
}

function metadataString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeRuntimeHealth(
  value: Partial<CodexBindingRuntimeHealth> | null | undefined,
): CodexBindingRuntimeHealth | null {
  if (!value || typeof value !== "object") return null;
  const status =
    typeof value.status === "string" && HEALTH_STATUSES.has(value.status)
      ? value.status
      : null;
  if (!status) return null;
  return {
    status,
    reason: normalizeString(value.reason),
    checkedAt: normalizeString(value.checkedAt),
    adapter: normalizeString(value.adapter),
    recovery: normalizeString(value.recovery),
  };
}

function runtimeHealthTime(value: CodexBindingRuntimeHealth): number {
  const parsed = Date.parse(value.checkedAt ?? "");
  return Number.isFinite(parsed) ? parsed : 0;
}

function mergeRuntimeHealth(
  existing: CodexBindingRuntimeHealth | null,
  next: CodexBindingRuntimeHealth | null,
): CodexBindingRuntimeHealth | null {
  if (!existing) return next;
  if (!next) return existing;

  const severityDelta =
    HEALTH_SEVERITY[next.status] - HEALTH_SEVERITY[existing.status];
  if (severityDelta > 0) return next;
  if (severityDelta < 0) return existing;

  const existingTime = runtimeHealthTime(existing);
  const nextTime = runtimeHealthTime(next);
  if (nextTime > existingTime) return next;
  return existing;
}

function deriveStaleReason(options: {
  status?: string | null;
  lastSeenAt?: string | null;
  nowMs: number;
  staleAfterMs: number;
}): string | null {
  const status = normalizeString(options.status);
  if (status && status !== "active") {
    return `status:${status}`;
  }

  if (!options.lastSeenAt) {
    return "missing-last-seen";
  }

  const lastSeenMs = Date.parse(options.lastSeenAt);
  if (!Number.isFinite(lastSeenMs)) {
    return "invalid-last-seen";
  }

  const ageMs = options.nowMs - lastSeenMs;
  if (ageMs > options.staleAfterMs) {
    return `stale:${ageMs}ms`;
  }

  return null;
}

function bindingKey(binding: CodexBinding): string {
  return [
    binding.routingAddress,
    binding.hostId ?? "",
    binding.clientId ?? "",
    binding.conversationId ?? "",
    binding.ownerClientId ?? "",
  ].join("\u0000");
}

function mergeBinding(
  existing: CodexBinding,
  next: CodexBinding,
): CodexBinding {
  const nextIsLiveObserve =
    next.sources.includes("observe") && next.staleReason === null;

  return {
    ...existing,
    agentName: existing.agentName ?? next.agentName,
    hostId: existing.hostId ?? next.hostId,
    clientId: existing.clientId ?? next.clientId,
    conversationId: existing.conversationId ?? next.conversationId,
    ownerClientId: existing.ownerClientId ?? next.ownerClientId,
    instanceId: existing.instanceId ?? next.instanceId,
    receiveTransports: normalizeReceiveTransports([
      ...existing.receiveTransports,
      ...next.receiveTransports,
    ]),
    bindingStatus:
      existing.bindingStatus === "ready" || next.bindingStatus === "ready"
        ? "ready"
        : existing.bindingStatus === "partial" ||
            next.bindingStatus === "partial"
          ? "partial"
          : "stale",
    lastSeenAt: nextIsLiveObserve
      ? (next.lastSeenAt ?? existing.lastSeenAt)
      : (existing.lastSeenAt ?? next.lastSeenAt),
    staleReason: nextIsLiveObserve
      ? null
      : (existing.staleReason ?? next.staleReason),
    health: mergeRuntimeHealth(existing.health, next.health),
    sources: [...new Set([...existing.sources, ...next.sources])],
    aliases: normalizeAliases([...existing.aliases, ...next.aliases]),
  };
}

function shouldIncludeHeartbeatBinding(
  heartbeat: CodexBindingHeartbeat,
  receiveTransports: TapReceiveTransport[],
): boolean {
  return (
    receiveTransports.includes("consent-drive") ||
    isCodexLike(heartbeat.instanceId) ||
    isCodexLike(heartbeat.address?.clientId) ||
    isCodexLike(heartbeat.address?.routingAddress) ||
    isCodexLike(heartbeat.source)
  );
}

function buildHeartbeatBinding(
  key: string,
  heartbeat: CodexBindingHeartbeat,
  nowMs: number,
  staleAfterMs: number,
): CodexBinding | null {
  const receiveTransports = normalizeReceiveTransports([
    ...(heartbeat.receiveTransports ?? []),
    ...(heartbeat.capabilities?.receiveTransports ?? []),
  ]);
  if (!shouldIncludeHeartbeatBinding(heartbeat, receiveTransports)) {
    return null;
  }

  const id = normalizeString(heartbeat.id) ?? key;
  const routingAddress =
    normalizeString(heartbeat.address?.routingAddress) ??
    normalizeString(heartbeat.instanceId) ??
    id;
  const lastSeenAt =
    normalizeString(heartbeat.lastActivity) ??
    normalizeString(heartbeat.timestamp);
  const conversationId =
    normalizeString(heartbeat.capabilities?.conversationId) ??
    normalizeString(heartbeat.address?.conversationId);
  const ownerClientId =
    normalizeString(heartbeat.capabilities?.ownerClientId) ??
    normalizeString(heartbeat.address?.ownerClientId);
  const bindingStatus = deriveBindingStatus({
    conversationId,
    ownerClientId,
    staleReason: deriveStaleReason({
      status: heartbeat.status,
      lastSeenAt,
      nowMs,
      staleAfterMs,
    }),
  });

  return {
    agentName: normalizeString(heartbeat.agent),
    routingAddress,
    runtime: "codex",
    hostId: normalizeString(heartbeat.address?.hostId),
    clientId:
      normalizeString(heartbeat.address?.clientId) ??
      normalizeString(heartbeat.instanceId),
    conversationId,
    ownerClientId,
    instanceId: normalizeString(heartbeat.instanceId),
    receiveTransports,
    lastSeenAt,
    staleReason:
      bindingStatus === "stale"
        ? deriveStaleReason({
            status: heartbeat.status,
            lastSeenAt,
            nowMs,
            staleAfterMs,
          })
        : null,
    health: normalizeRuntimeHealth(heartbeat.health),
    bindingStatus,
    sources: ["heartbeat"],
    aliases: normalizeAliases([
      id,
      heartbeat.agent,
      routingAddress,
      heartbeat.instanceId,
      ...(heartbeat.address?.aliases ?? []),
    ]),
  };
}

function findAgentNameForClient(
  snapshot: ObserveTransportSnapshot,
  clientId: string | null,
): string | null {
  if (!clientId) return null;
  const agent = snapshot.agents.find((candidate) => candidate.id === clientId);
  return agent?.name ?? null;
}

function buildObserveBindings(
  snapshot: ObserveTransportSnapshot,
  nowIso: string,
): CodexBinding[] {
  if (!snapshot.connected) {
    return [];
  }

  const bindings: CodexBinding[] = [];
  for (const conversation of snapshot.conversations) {
    const ownerClientId = normalizeString(conversation.address.ownerClientId);
    const conversationId = normalizeString(conversation.id);
    if (!ownerClientId || !conversationId) continue;

    const metadata = conversation.metadata as JsonRecord;
    const lastSeenAt = metadataString(metadata.lastActivity) ?? nowIso;
    const routingAddress =
      normalizeString(conversation.address.clientId) ?? ownerClientId;

    bindings.push({
      agentName: findAgentNameForClient(snapshot, ownerClientId),
      routingAddress,
      runtime: "codex",
      hostId: normalizeString(conversation.address.hostId),
      clientId: normalizeString(conversation.address.clientId) ?? ownerClientId,
      conversationId,
      ownerClientId,
      instanceId: null,
      receiveTransports: ["consent-drive"],
      bindingStatus: "ready",
      lastSeenAt,
      staleReason: null,
      health: null,
      sources: ["observe"],
      aliases: normalizeAliases([routingAddress, ownerClientId]),
    });
  }
  return bindings;
}

export function buildCodexBindingRegistry(
  options: BuildCodexBindingRegistryOptions = {},
): CodexBindingRegistry {
  const nowMs = toTime(options.now);
  const nowIso = new Date(nowMs).toISOString();
  const staleAfterMs = options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
  const byKey = new Map<string, CodexBinding>();

  for (const [key, heartbeat] of Object.entries(options.heartbeats ?? {})) {
    const binding = buildHeartbeatBinding(key, heartbeat, nowMs, staleAfterMs);
    if (!binding) continue;
    const existing = byKey.get(bindingKey(binding));
    byKey.set(
      bindingKey(binding),
      existing ? mergeBinding(existing, binding) : binding,
    );
  }

  if (options.observeSnapshot) {
    for (const binding of buildObserveBindings(
      options.observeSnapshot,
      nowIso,
    )) {
      const existing = byKey.get(bindingKey(binding));
      byKey.set(
        bindingKey(binding),
        existing ? mergeBinding(existing, binding) : binding,
      );
    }
  }

  return {
    bindings: [...byKey.values()].sort((a, b) =>
      a.routingAddress.localeCompare(b.routingAddress),
    ),
    builtAt: nowIso,
    staleAfterMs,
  };
}

function deriveBindingStatus(options: {
  conversationId: string | null;
  ownerClientId: string | null;
  staleReason: string | null;
}): CodexBindingStatus {
  if (options.staleReason) return "stale";
  if (options.conversationId && options.ownerClientId) return "ready";
  if (options.conversationId || options.ownerClientId) return "partial";
  return "partial";
}

function matchesTarget(
  binding: CodexBinding,
  target: ResolveCodexBindingTarget,
): boolean {
  const requestedAddress = normalizeString(target.routingAddress);
  const requestedAgent = normalizeString(target.agentName);
  if (
    requestedAddress &&
    binding.routingAddress !== requestedAddress &&
    !binding.aliases.includes(requestedAddress)
  ) {
    return false;
  }
  if (
    requestedAgent &&
    binding.agentName !== requestedAgent &&
    !binding.aliases.includes(requestedAgent)
  ) {
    return false;
  }

  const constraints: Array<[string | null | undefined, string | null]> = [
    [target.hostId, binding.hostId],
    [target.clientId, binding.clientId],
    [target.conversationId, binding.conversationId],
    [target.ownerClientId, binding.ownerClientId],
  ];
  return constraints.every(([requested, actual]) => {
    const normalizedRequested = normalizeString(requested);
    return !normalizedRequested || normalizedRequested === actual;
  });
}

function hasExplicitTargetSelector(target: ResolveCodexBindingTarget): boolean {
  return Boolean(
    normalizeString(target.routingAddress) ||
    normalizeString(target.agentName) ||
    normalizeString(target.clientId) ||
    normalizeString(target.conversationId) ||
    normalizeString(target.ownerClientId),
  );
}

function liveSnapshotMatches(
  binding: CodexBinding,
  snapshot: ObserveTransportSnapshot | null | undefined,
): boolean {
  if (!snapshot || !binding.conversationId || !binding.ownerClientId) {
    return true;
  }
  if (!snapshot.connected) {
    return false;
  }

  return snapshot.conversations.some((conversation) => {
    const address = conversation.address;
    return (
      conversation.id === binding.conversationId &&
      address.ownerClientId === binding.ownerClientId &&
      (!binding.hostId || !address.hostId || address.hostId === binding.hostId)
    );
  });
}

function toAddress(binding: CodexBinding): TransportAddress {
  return {
    hostId: binding.hostId,
    clientId: binding.clientId,
    conversationId: binding.conversationId,
    ownerClientId: binding.ownerClientId,
  };
}

function blocked(
  reason: CodexBindingBlockReason,
  candidates: CodexBinding[],
  message: string,
): ResolveCodexBindingResult {
  return {
    status: "blocked",
    reason,
    candidates,
    message,
  };
}

export function resolveCodexBinding(
  options: ResolveCodexBindingOptions,
): ResolveCodexBindingResult {
  if (!hasExplicitTargetSelector(options.target)) {
    return blocked(
      "missing-target",
      [],
      "Codex binding resolution requires an explicit target selector.",
    );
  }

  const candidates = options.registry.bindings.filter((binding) =>
    matchesTarget(binding, options.target),
  );

  if (candidates.length === 0) {
    return blocked("not-found", [], "No Codex binding matched the target.");
  }

  const freshCandidates = candidates.filter((binding) => !binding.staleReason);
  if (freshCandidates.length === 0) {
    return blocked("stale", candidates, "Only stale Codex bindings matched.");
  }

  const readyCandidates = freshCandidates.filter(
    (binding) => binding.bindingStatus === "ready",
  );
  if (readyCandidates.length === 0) {
    return blocked(
      "partial",
      freshCandidates,
      "Only partial Codex bindings matched; conversationId and ownerClientId are both required.",
    );
  }

  const liveCandidates = readyCandidates.filter((binding) =>
    liveSnapshotMatches(binding, options.liveSnapshot),
  );
  if (liveCandidates.length === 0) {
    return blocked(
      "binding-mismatch",
      freshCandidates,
      "Matched Codex bindings were not present in the live observe snapshot.",
    );
  }

  const reachableCandidates = liveCandidates.filter((binding) =>
    canUseConsentDriveForAddress({
      localHostId: options.localHostId,
      address: toAddress(binding),
    }),
  );
  if (reachableCandidates.length === 0) {
    return blocked(
      "not-reachable",
      liveCandidates,
      "Matched Codex bindings are not reachable from the local host.",
    );
  }

  if (reachableCandidates.length > 1) {
    return blocked(
      "ambiguous",
      reachableCandidates,
      "Multiple fresh Codex bindings matched the target.",
    );
  }

  return {
    status: "resolved",
    binding: reachableCandidates[0],
  };
}
