// src/routing/receive-transports.ts
import { basename } from "path";
var VALID_RECEIVE_TRANSPORTS = [
  "mcp-channel",
  "consent-drive",
  "polling"
];
function normalizeString(value) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}
function normalizeReceiveTransports(values) {
  const transports = [];
  for (const value of values ?? []) {
    if (!VALID_RECEIVE_TRANSPORTS.includes(value)) {
      continue;
    }
    const transport = value;
    if (transports.includes(transport)) {
      continue;
    }
    transports.push(transport);
  }
  return transports;
}
function canUseConsentDriveForAddress(options) {
  const address = options.address;
  if (!address?.conversationId?.trim() || !address.ownerClientId?.trim()) {
    return false;
  }
  const localHostId = normalizeString(options.localHostId);
  const targetHostId = normalizeString(address.hostId);
  if (!localHostId || !targetHostId) {
    return true;
  }
  return localHostId.toLowerCase() === targetHostId.toLowerCase();
}

// src/codex-a2a/binding-registry.ts
var DEFAULT_STALE_AFTER_MS = 30 * 60 * 1e3;
var HEALTH_SEVERITY = {
  "stuck-turn": 90,
  "stale-owner": 80,
  "stale-active-turn": 75,
  "active-turn": 70,
  partial: 60,
  "adapter-unavailable": 50,
  degraded: 40,
  "not-observed": 30,
  unknown: 20,
  ready: 10
};
var HEALTH_STATUSES = new Set(
  Object.keys(HEALTH_SEVERITY)
);
function normalizeString2(value) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}
function normalizeToken(value) {
  return normalizeString2(value)?.replace(/-/g, "_").toLowerCase() ?? null;
}
function isCodexLike(value) {
  const token = normalizeToken(value);
  return token === "codex" || Boolean(token?.startsWith("codex_"));
}
function toTime(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : Date.now();
  }
  return Date.now();
}
function normalizeAliases(values) {
  const aliases = [];
  for (const value of values) {
    const normalized = normalizeString2(value);
    if (!normalized || aliases.includes(normalized)) continue;
    aliases.push(normalized);
  }
  return aliases;
}
function metadataString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
function normalizeRuntimeHealth(value) {
  if (!value || typeof value !== "object") return null;
  const status = typeof value.status === "string" && HEALTH_STATUSES.has(value.status) ? value.status : null;
  if (!status) return null;
  return {
    status,
    reason: normalizeString2(value.reason),
    checkedAt: normalizeString2(value.checkedAt),
    adapter: normalizeString2(value.adapter),
    recovery: normalizeString2(value.recovery)
  };
}
function runtimeHealthTime(value) {
  const parsed = Date.parse(value.checkedAt ?? "");
  return Number.isFinite(parsed) ? parsed : 0;
}
function mergeRuntimeHealth(existing, next) {
  if (!existing) return next;
  if (!next) return existing;
  const severityDelta = HEALTH_SEVERITY[next.status] - HEALTH_SEVERITY[existing.status];
  if (severityDelta > 0) return next;
  if (severityDelta < 0) return existing;
  const existingTime = runtimeHealthTime(existing);
  const nextTime = runtimeHealthTime(next);
  if (nextTime > existingTime) return next;
  return existing;
}
function deriveStaleReason(options) {
  const status = normalizeString2(options.status);
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
function bindingKey(binding) {
  return [
    binding.routingAddress,
    binding.hostId ?? "",
    binding.clientId ?? "",
    binding.conversationId ?? "",
    binding.ownerClientId ?? ""
  ].join("\0");
}
function mergeBinding(existing, next) {
  const nextIsLiveObserve = next.sources.includes("observe") && next.staleReason === null;
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
      ...next.receiveTransports
    ]),
    bindingStatus: existing.bindingStatus === "ready" || next.bindingStatus === "ready" ? "ready" : existing.bindingStatus === "partial" || next.bindingStatus === "partial" ? "partial" : "stale",
    lastSeenAt: nextIsLiveObserve ? next.lastSeenAt ?? existing.lastSeenAt : existing.lastSeenAt ?? next.lastSeenAt,
    staleReason: nextIsLiveObserve ? null : existing.staleReason ?? next.staleReason,
    health: mergeRuntimeHealth(existing.health, next.health),
    sources: [.../* @__PURE__ */ new Set([...existing.sources, ...next.sources])],
    aliases: normalizeAliases([...existing.aliases, ...next.aliases])
  };
}
function shouldIncludeHeartbeatBinding(heartbeat, receiveTransports) {
  return receiveTransports.includes("consent-drive") || isCodexLike(heartbeat.instanceId) || isCodexLike(heartbeat.address?.clientId) || isCodexLike(heartbeat.address?.routingAddress) || isCodexLike(heartbeat.source);
}
function buildHeartbeatBinding(key, heartbeat, nowMs, staleAfterMs) {
  const receiveTransports = normalizeReceiveTransports([
    ...heartbeat.receiveTransports ?? [],
    ...heartbeat.capabilities?.receiveTransports ?? []
  ]);
  if (!shouldIncludeHeartbeatBinding(heartbeat, receiveTransports)) {
    return null;
  }
  const id = normalizeString2(heartbeat.id) ?? key;
  const routingAddress = normalizeString2(heartbeat.address?.routingAddress) ?? normalizeString2(heartbeat.instanceId) ?? id;
  const lastSeenAt = normalizeString2(heartbeat.lastActivity) ?? normalizeString2(heartbeat.timestamp);
  const conversationId = normalizeString2(heartbeat.capabilities?.conversationId) ?? normalizeString2(heartbeat.address?.conversationId);
  const ownerClientId = normalizeString2(heartbeat.capabilities?.ownerClientId) ?? normalizeString2(heartbeat.address?.ownerClientId);
  const bindingStatus = deriveBindingStatus({
    conversationId,
    ownerClientId,
    staleReason: deriveStaleReason({
      status: heartbeat.status,
      lastSeenAt,
      nowMs,
      staleAfterMs
    })
  });
  return {
    agentName: normalizeString2(heartbeat.agent),
    routingAddress,
    runtime: "codex",
    hostId: normalizeString2(heartbeat.address?.hostId),
    clientId: normalizeString2(heartbeat.address?.clientId) ?? normalizeString2(heartbeat.instanceId),
    conversationId,
    ownerClientId,
    instanceId: normalizeString2(heartbeat.instanceId),
    receiveTransports,
    lastSeenAt,
    staleReason: bindingStatus === "stale" ? deriveStaleReason({
      status: heartbeat.status,
      lastSeenAt,
      nowMs,
      staleAfterMs
    }) : null,
    health: normalizeRuntimeHealth(heartbeat.health),
    bindingStatus,
    sources: ["heartbeat"],
    aliases: normalizeAliases([
      id,
      heartbeat.agent,
      routingAddress,
      heartbeat.instanceId,
      ...heartbeat.address?.aliases ?? []
    ])
  };
}
function findAgentNameForClient(snapshot, clientId) {
  if (!clientId) return null;
  const agent = snapshot.agents.find((candidate) => candidate.id === clientId);
  return agent?.name ?? null;
}
function buildObserveBindings(snapshot, nowIso) {
  if (!snapshot.connected) {
    return [];
  }
  const bindings = [];
  for (const conversation of snapshot.conversations) {
    const ownerClientId = normalizeString2(conversation.address.ownerClientId);
    const conversationId = normalizeString2(conversation.id);
    if (!ownerClientId || !conversationId) continue;
    const metadata = conversation.metadata;
    const lastSeenAt = metadataString(metadata.lastActivity) ?? nowIso;
    const routingAddress = normalizeString2(conversation.address.clientId) ?? ownerClientId;
    bindings.push({
      agentName: findAgentNameForClient(snapshot, ownerClientId),
      routingAddress,
      runtime: "codex",
      hostId: normalizeString2(conversation.address.hostId),
      clientId: normalizeString2(conversation.address.clientId) ?? ownerClientId,
      conversationId,
      ownerClientId,
      instanceId: null,
      receiveTransports: ["consent-drive"],
      bindingStatus: "ready",
      lastSeenAt,
      staleReason: null,
      health: null,
      sources: ["observe"],
      aliases: normalizeAliases([routingAddress, ownerClientId])
    });
  }
  return bindings;
}
function buildCodexBindingRegistry(options = {}) {
  const nowMs = toTime(options.now);
  const nowIso = new Date(nowMs).toISOString();
  const staleAfterMs = options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
  const byKey = /* @__PURE__ */ new Map();
  for (const [key, heartbeat] of Object.entries(options.heartbeats ?? {})) {
    const binding = buildHeartbeatBinding(key, heartbeat, nowMs, staleAfterMs);
    if (!binding) continue;
    const existing = byKey.get(bindingKey(binding));
    byKey.set(
      bindingKey(binding),
      existing ? mergeBinding(existing, binding) : binding
    );
  }
  if (options.observeSnapshot) {
    for (const binding of buildObserveBindings(
      options.observeSnapshot,
      nowIso
    )) {
      const existing = byKey.get(bindingKey(binding));
      byKey.set(
        bindingKey(binding),
        existing ? mergeBinding(existing, binding) : binding
      );
    }
  }
  return {
    bindings: [...byKey.values()].sort(
      (a, b) => a.routingAddress.localeCompare(b.routingAddress)
    ),
    builtAt: nowIso,
    staleAfterMs
  };
}
function deriveBindingStatus(options) {
  if (options.staleReason) return "stale";
  if (options.conversationId && options.ownerClientId) return "ready";
  if (options.conversationId || options.ownerClientId) return "partial";
  return "partial";
}
function matchesTarget(binding, target) {
  const requestedAddress = normalizeString2(target.routingAddress);
  const requestedAgent = normalizeString2(target.agentName);
  if (requestedAddress && binding.routingAddress !== requestedAddress && !binding.aliases.includes(requestedAddress)) {
    return false;
  }
  if (requestedAgent && binding.agentName !== requestedAgent && !binding.aliases.includes(requestedAgent)) {
    return false;
  }
  const constraints = [
    [target.hostId, binding.hostId],
    [target.clientId, binding.clientId],
    [target.conversationId, binding.conversationId],
    [target.ownerClientId, binding.ownerClientId]
  ];
  return constraints.every(([requested, actual]) => {
    const normalizedRequested = normalizeString2(requested);
    return !normalizedRequested || normalizedRequested === actual;
  });
}
function hasExplicitTargetSelector(target) {
  return Boolean(
    normalizeString2(target.routingAddress) || normalizeString2(target.agentName) || normalizeString2(target.clientId) || normalizeString2(target.conversationId) || normalizeString2(target.ownerClientId)
  );
}
function liveSnapshotMatches(binding, snapshot) {
  if (!snapshot || !binding.conversationId || !binding.ownerClientId) {
    return true;
  }
  if (!snapshot.connected) {
    return false;
  }
  return snapshot.conversations.some((conversation) => {
    const address = conversation.address;
    return conversation.id === binding.conversationId && address.ownerClientId === binding.ownerClientId && (!binding.hostId || !address.hostId || address.hostId === binding.hostId);
  });
}
function toAddress(binding) {
  return {
    hostId: binding.hostId,
    clientId: binding.clientId,
    conversationId: binding.conversationId,
    ownerClientId: binding.ownerClientId
  };
}
function blocked(reason, candidates, message) {
  return {
    status: "blocked",
    reason,
    candidates,
    message
  };
}
function resolveCodexBinding(options) {
  if (!hasExplicitTargetSelector(options.target)) {
    return blocked(
      "missing-target",
      [],
      "Codex binding resolution requires an explicit target selector."
    );
  }
  const candidates = options.registry.bindings.filter(
    (binding) => matchesTarget(binding, options.target)
  );
  if (candidates.length === 0) {
    return blocked("not-found", [], "No Codex binding matched the target.");
  }
  const freshCandidates = candidates.filter((binding) => !binding.staleReason);
  if (freshCandidates.length === 0) {
    return blocked("stale", candidates, "Only stale Codex bindings matched.");
  }
  const readyCandidates = freshCandidates.filter(
    (binding) => binding.bindingStatus === "ready"
  );
  if (readyCandidates.length === 0) {
    return blocked(
      "partial",
      freshCandidates,
      "Only partial Codex bindings matched; conversationId and ownerClientId are both required."
    );
  }
  const liveCandidates = readyCandidates.filter(
    (binding) => liveSnapshotMatches(binding, options.liveSnapshot)
  );
  if (liveCandidates.length === 0) {
    return blocked(
      "binding-mismatch",
      freshCandidates,
      "Matched Codex bindings were not present in the live observe snapshot."
    );
  }
  const reachableCandidates = liveCandidates.filter(
    (binding) => canUseConsentDriveForAddress({
      localHostId: options.localHostId,
      address: toAddress(binding)
    })
  );
  if (reachableCandidates.length === 0) {
    return blocked(
      "not-reachable",
      liveCandidates,
      "Matched Codex bindings are not reachable from the local host."
    );
  }
  if (reachableCandidates.length > 1) {
    return blocked(
      "ambiguous",
      reachableCandidates,
      "Multiple fresh Codex bindings matched the target."
    );
  }
  return {
    status: "resolved",
    binding: reachableCandidates[0]
  };
}
export {
  buildCodexBindingRegistry,
  resolveCodexBinding
};
//# sourceMappingURL=index.mjs.map