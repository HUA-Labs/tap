/**
 * Agent presence resolution — merges agent heartbeats with bridge liveness.
 *
 * ## SSOT Hierarchy (M321)
 *
 * This module combines two separate data sources:
 * 1. **Agent presence** (heartbeats.json) — who is registered and active
 * 2. **Bridge process liveness** (PID files + runtime heartbeat.json) —
 *    whether a bridge process is actually running
 *
 * The merge produces rich presence info (bridge-live / bridge-stale / mcp-only)
 * used by tap_who and recipient routing.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildAddressMetadata,
  buildHeartbeatConnectHash,
  deriveRoutingSlotFromInstanceId,
  loadStateInstances,
  resolveKnownInstanceId,
  type TapBootstrapInstance,
  type TapAddressMetadata,
  type Heartbeat,
  type HeartbeatSource,
  type TapRuntimeHealth,
  type TapRuntimeHealthStatus,
  type TapRoutingSlot,
} from "./tap-utils.js";
import { isPlaceholderAgentValue, sameRoutingAddress } from "./tap-identity.js";
import {
  normalizeReceiveTransports,
  type TapReceiveTransport,
} from "../../../src/routing/receive-transports.js";

type BridgeStateFile = {
  pid?: number;
  runtimeStateDir?: string | null;
};

type RuntimeHeartbeat = {
  connected?: boolean;
  initialized?: boolean;
  threadId?: string | null;
  activeTurnId?: string | null;
  idleSince?: string | null;
  turnState?: "active" | "idle" | "waiting-approval" | "disconnected" | null;
};

type RuntimeThreadState = {
  threadId?: string | null;
};

export interface TapWhoAgent {
  id: string;
  agent: string;
  status: string;
  lastHeartbeat: string;
  lastActivity: string;
  alive: boolean;
  source: HeartbeatSource;
  instanceId: string | null;
  slot: TapRoutingSlot | null;
  routingAddress: string;
  connectHash: string;
  presence: "bridge-live" | "bridge-stale" | "mcp-only";
  lifecycle:
    | "ready"
    | "initializing"
    | "degraded-no-thread"
    | "bridge-stale"
    | "stopped"
    | null;
  session:
    | "initializing"
    | "active"
    | "idle"
    | "waiting-approval"
    | "disconnected"
    | null;
  idleSeconds: number | null;
  address: TapAddressMetadata;
  receiveTransports: TapReceiveTransport[];
  consentDriveStatus: "ready" | "partial" | "stale" | "unavailable" | null;
  presenceFreshness:
    | "fresh-for-routing"
    | "stale-visible"
    | "visible"
    | "unknown";
  health: TapRuntimeHealth;
  /**
   * M353: slot ownership after same-slot collision resolution.
   * - "active": owns the slot (sole holder, or newest among contenders).
   * - "stale-by-newer": a newer heartbeat holds the slot; this entry is
   *   excluded from slot-form routing but still addressable by its agent_id.
   * - null: no slot, or entry did not contend (bridge-stale / signing-off).
   */
  slotStatus: "active" | "stale-by-newer" | null;
}

type TapPresenceCandidate = TapWhoAgent & {
  displayName: string | null;
  lastActivityMs: number;
  routingAliases: string[];
};

export interface TapRecipientResolution {
  target: string;
  routingTarget: string;
  found: boolean;
  ambiguous: boolean;
  candidates: string[];
  warning: string | null;
  displayName: string | null;
  instanceId: string | null;
  slot: TapRoutingSlot | null;
  address: TapAddressMetadata | null;
  receiveTransports: TapReceiveTransport[];
}

export interface TapStructuredRecipientTarget {
  routingAddress: string;
  hostId?: string | null;
  clientId?: string | null;
  conversationId?: string | null;
  ownerClientId?: string | null;
}

export type TapEnvelopeScope = "observe" | "suggest" | "drive";

export function validateStructuredEnvelopeMetadata(options: {
  target: TapStructuredRecipientTarget | null;
  scope: TapEnvelopeScope | null;
  action: string | null;
  consentRef: string | null;
}): string | null {
  const scope = options.scope ?? null;
  const action = options.action?.trim() || null;
  const consentRef = options.consentRef?.trim() || null;
  const conversationId = options.target?.conversationId?.trim() || null;

  if (!scope) {
    if (action) {
      return 'A2A envelope "action" metadata requires a scope.';
    }
    if (consentRef) {
      return 'A2A envelope "consentRef" metadata requires a scope.';
    }
    return null;
  }

  if (scope === "observe") {
    if (action) {
      return "Observe scope is passive-only and cannot include an action.";
    }
    if (consentRef) {
      return "Observe scope is passive-only and cannot include a consentRef.";
    }
    return null;
  }

  if (!conversationId) {
    return `${scope} scope requires target.conversationId for auditable routing.`;
  }

  if (!action) {
    return `${scope} scope requires a non-empty action.`;
  }

  if (scope === "drive" && !consentRef) {
    return "Drive scope requires a non-empty consentRef.";
  }

  return null;
}

function parseJsonFile<T>(filePath: string): T | null {
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, "utf-8")) as T;
  } catch {
    return null;
  }
}

function formatAgentLabel(
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

function isProcessAlive(pid: number | null | undefined): boolean {
  if (pid == null || !Number.isFinite(pid)) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function parseIsoAgeSeconds(value: string | null | undefined): number | null {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) return null;
  return Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
}

function getActivityMs(heartbeat: Heartbeat): number {
  // M144: Use the more recent of lastActivity and timestamp.
  // timestamp = bridge poll freshness, lastActivity = real work.
  // A bridge with fresh timestamp is alive even if lastActivity is old.
  const activityMs = new Date(
    heartbeat.lastActivity ?? heartbeat.timestamp ?? 0,
  ).getTime();
  const timestampMs = new Date(heartbeat.timestamp ?? 0).getTime();
  return Math.max(activityMs, timestampMs);
}

function resolveHeartbeatSource(heartbeat: Heartbeat): HeartbeatSource {
  return heartbeat.source === "bridge-dispatch"
    ? "bridge-dispatch"
    : "mcp-direct";
}

function resolveBridgeStatus(
  stateDir: string,
  instanceId: string | null,
  instance: TapBootstrapInstance | null,
): {
  presence: "bridge-live" | "bridge-stale" | "mcp-only";
  lifecycle:
    | "ready"
    | "initializing"
    | "degraded-no-thread"
    | "bridge-stale"
    | "stopped"
    | null;
  session:
    | "initializing"
    | "active"
    | "idle"
    | "waiting-approval"
    | "disconnected"
    | null;
  idleSince: string | null;
  conversationId: string | null;
  ownerClientId: string | null;
} {
  if (!instanceId) {
    return {
      presence: "mcp-only",
      lifecycle: null,
      session: null,
      idleSince: null,
      conversationId: null,
      ownerClientId: null,
    };
  }

  const isInstalledAppServer =
    instance?.installed === true && instance.bridgeMode === "app-server";

  const bridgeState = parseJsonFile<BridgeStateFile>(
    join(stateDir, "pids", `bridge-${instanceId}.json`),
  );
  if (!bridgeState) {
    return {
      presence: "mcp-only",
      lifecycle: isInstalledAppServer ? "stopped" : null,
      session: null,
      idleSince: null,
      conversationId: null,
      ownerClientId: null,
    };
  }

  if (!isProcessAlive(bridgeState.pid)) {
    return {
      presence: "bridge-stale",
      lifecycle: "bridge-stale",
      session: null,
      idleSince: null,
      conversationId: null,
      ownerClientId: null,
    };
  }

  const runtimeHeartbeat = bridgeState.runtimeStateDir
    ? parseJsonFile<RuntimeHeartbeat>(
        join(bridgeState.runtimeStateDir, "heartbeat.json"),
      )
    : null;
  const savedThread = bridgeState.runtimeStateDir
    ? parseJsonFile<RuntimeThreadState>(
        join(bridgeState.runtimeStateDir, "thread.json"),
      )
    : null;

  if (!runtimeHeartbeat || runtimeHeartbeat.initialized === false) {
    return {
      presence: "bridge-live",
      lifecycle: "initializing",
      session: "initializing",
      idleSince: null,
      conversationId:
        runtimeHeartbeat?.threadId ?? savedThread?.threadId ?? null,
      ownerClientId:
        runtimeHeartbeat?.threadId || savedThread?.threadId ? instanceId : null,
    };
  }

  const conversationId =
    runtimeHeartbeat.threadId ?? savedThread?.threadId ?? null;
  const lifecycle =
    runtimeHeartbeat.threadId && runtimeHeartbeat.connected !== false
      ? "ready"
      : "degraded-no-thread";

  const session =
    runtimeHeartbeat.activeTurnId || runtimeHeartbeat.turnState === "active"
      ? "active"
      : runtimeHeartbeat.turnState === "waiting-approval"
        ? "waiting-approval"
        : runtimeHeartbeat.turnState === "disconnected" ||
            runtimeHeartbeat.connected === false
          ? "disconnected"
          : "idle";

  const idleSince =
    session === "idle" || session === "waiting-approval"
      ? (runtimeHeartbeat.idleSince ?? null)
      : null;

  return {
    presence: "bridge-live",
    lifecycle:
      lifecycle === "degraded-no-thread" && !savedThread?.threadId
        ? "degraded-no-thread"
        : lifecycle,
    session,
    idleSince,
    conversationId,
    ownerClientId: conversationId ? instanceId : null,
  };
}

const PRESENCE_PRIORITY: Record<TapWhoAgent["presence"], number> = {
  "bridge-live": 3,
  "mcp-only": 2,
  "bridge-stale": 1,
};

const SOURCE_PRIORITY: Record<HeartbeatSource, number> = {
  "bridge-dispatch": 2,
  "mcp-direct": 1,
};

const HEALTH_SEVERITY: Record<TapRuntimeHealthStatus, number> = {
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

export const STRUCTURED_RECIPIENT_LIVENESS_MINUTES = 30;
const STRUCTURED_RECIPIENT_LIVENESS_MS =
  STRUCTURED_RECIPIENT_LIVENESS_MINUTES * 60 * 1000;
export const POLLING_RECIPIENT_VISIBILITY_MINUTES = 17 * 60;
const POLLING_RECIPIENT_VISIBILITY_MS =
  POLLING_RECIPIENT_VISIBILITY_MINUTES * 60 * 1000;
const CODEX_RUNTIME_GUIDE = "AI_GUIDE.md";

function compareCandidates(
  a: TapPresenceCandidate,
  b: TapPresenceCandidate,
): number {
  const presenceDelta =
    PRESENCE_PRIORITY[b.presence] - PRESENCE_PRIORITY[a.presence];
  if (presenceDelta !== 0) return presenceDelta;

  const sourceDelta = SOURCE_PRIORITY[b.source] - SOURCE_PRIORITY[a.source];
  if (sourceDelta !== 0) return sourceDelta;

  if (a.alive !== b.alive) return a.alive ? -1 : 1;
  if (a.lastActivityMs !== b.lastActivityMs) {
    return b.lastActivityMs - a.lastActivityMs;
  }
  return a.id.localeCompare(b.id);
}

function prefersInboxSurface(candidate: TapPresenceCandidate): boolean {
  return (
    candidate.receiveTransports.includes("polling") ||
    candidate.receiveTransports.includes("mcp-channel")
  );
}

function isFreshConsentDriveCandidate(
  candidate: TapPresenceCandidate,
): boolean {
  return (
    candidate.receiveTransports.includes("consent-drive") &&
    candidate.presenceFreshness === "fresh-for-routing" &&
    candidate.health.status === "ready"
  );
}

function isStaleConsentDriveOnlyCandidate(
  candidate: TapPresenceCandidate,
): boolean {
  return (
    candidate.receiveTransports.includes("consent-drive") &&
    !prefersInboxSurface(candidate) &&
    candidate.presenceFreshness === "stale-visible"
  );
}

function presenceFreshnessWindowMs(
  receiveTransports: TapReceiveTransport[],
): number {
  if (receiveTransports.includes("consent-drive")) {
    return STRUCTURED_RECIPIENT_LIVENESS_MS;
  }
  if (receiveTransports.includes("polling")) {
    return POLLING_RECIPIENT_VISIBILITY_MS;
  }
  return STRUCTURED_RECIPIENT_LIVENESS_MS;
}

function chooseInboxSurfaceFallback(
  candidates: TapPresenceCandidate[],
): TapPresenceCandidate | null {
  if (!candidates.some(isStaleConsentDriveOnlyCandidate)) return null;
  if (candidates.some(isFreshConsentDriveCandidate)) return null;
  const inboxCandidates = candidates
    .filter(prefersInboxSurface)
    .sort(compareCandidates);
  return inboxCandidates.length === 1 ? inboxCandidates[0] : null;
}

function uniqueRoutingAliases(
  values: Array<string | null | undefined>,
): string[] {
  const aliases: string[] = [];
  for (const value of values) {
    const normalized = value?.trim();
    if (!normalized) continue;
    if (aliases.some((alias) => sameRoutingAddress(alias, normalized)))
      continue;
    aliases.push(normalized);
  }
  return aliases;
}

function resolveMergedDisplayName(
  candidates: TapPresenceCandidate[],
): string | null {
  const named = candidates.filter(
    (candidate) =>
      candidate.displayName != null &&
      !isPlaceholderAgentValue(candidate.displayName),
  );
  if (named.length === 0) return null;

  const liveNamed = named.filter((candidate) => candidate.alive);
  const displayCandidates = liveNamed.length > 0 ? liveNamed : named;

  return (
    [...displayCandidates].sort((a, b) => {
      if (a.source !== b.source) {
        if (a.source === "mcp-direct") return -1;
        if (b.source === "mcp-direct") return 1;
      }

      if (a.lastActivityMs !== b.lastActivityMs) {
        return b.lastActivityMs - a.lastActivityMs;
      }

      return compareCandidates(a, b);
    })[0]?.displayName ?? null
  );
}

function mergeRuntimeHealth(
  candidates: TapPresenceCandidate[],
): TapRuntimeHealth {
  const [selected] = [...candidates].sort((a, b) => {
    const severityDelta =
      HEALTH_SEVERITY[b.health.status] - HEALTH_SEVERITY[a.health.status];
    if (severityDelta !== 0) return severityDelta;
    if (a.health.checkedAt !== b.health.checkedAt) {
      const aTime = new Date(a.health.checkedAt ?? 0).getTime();
      const bTime = new Date(b.health.checkedAt ?? 0).getTime();
      if (Number.isFinite(aTime) && Number.isFinite(bTime) && aTime !== bTime) {
        return bTime - aTime;
      }
    }
    return compareCandidates(a, b);
  });

  return selected.health;
}

/**
 * M353: mark slot-collision losers as `stale-by-newer`.
 *
 * Contract (M342 drift #5, invariant #3):
 *   at most one live instance per slot; newer heartbeat wins and older is
 *   marked stale so it is visible in `tap_who` and excluded from slot-form
 *   routing.
 *
 * Only `alive && presence !== "bridge-stale"` entries contend — a signing-off
 * or stale-bridge entry is already out of routing and cannot lose a collision.
 */
function applySlotDisambiguation(
  candidates: TapPresenceCandidate[],
): TapPresenceCandidate[] {
  const bySlot = new Map<TapRoutingSlot, TapPresenceCandidate[]>();
  for (const candidate of candidates) {
    if (!candidate.slot) continue;
    if (!candidate.alive) continue;
    if (candidate.presence === "bridge-stale") continue;
    const group = bySlot.get(candidate.slot);
    if (group) {
      group.push(candidate);
    } else {
      bySlot.set(candidate.slot, [candidate]);
    }
  }

  const staleByNewer = new Set<TapPresenceCandidate>();
  const active = new Set<TapPresenceCandidate>();
  for (const group of bySlot.values()) {
    // No disambiguation needed when the slot has a single contender — leave
    // its slotStatus null so consumers can distinguish "uncontested" from
    // "contended winner".
    if (group.length < 2) continue;
    const sorted = [...group].sort(
      (a, b) => b.lastActivityMs - a.lastActivityMs,
    );
    const [winner, ...losers] = sorted;
    active.add(winner);
    for (const loser of losers) {
      staleByNewer.add(loser);
    }
  }

  return candidates.map((candidate) => {
    if (active.has(candidate)) {
      return { ...candidate, slotStatus: "active" as const };
    }
    if (staleByNewer.has(candidate)) {
      return { ...candidate, slotStatus: "stale-by-newer" as const };
    }
    return { ...candidate, slotStatus: null };
  });
}

function mergePresenceGroup(
  candidates: TapPresenceCandidate[],
): TapPresenceCandidate[] {
  const groups = new Map<string, TapPresenceCandidate[]>();
  for (const candidate of candidates) {
    const group = groups.get(candidate.connectHash);
    if (group) {
      group.push(candidate);
    } else {
      groups.set(candidate.connectHash, [candidate]);
    }
  }

  return [...groups.values()]
    .map((group) => {
      const sortedGroup = [...group].sort(compareCandidates);
      const winner = sortedGroup[0];
      const mergedDisplayName =
        resolveMergedDisplayName(group) ?? winner.displayName;
      const mergedSlot =
        sortedGroup.find((candidate) => candidate.slot != null)?.slot ??
        winner.slot ??
        null;
      const mergedInstanceId =
        sortedGroup.find((candidate) => candidate.instanceId != null)
          ?.instanceId ??
        winner.instanceId ??
        null;
      const mergedRoutingAddress =
        sortedGroup.find((candidate) => candidate.address.routingAddress.trim())
          ?.address.routingAddress ??
        mergedSlot ??
        mergedInstanceId ??
        winner.instanceId ??
        winner.id;
      const routingAliases = uniqueRoutingAliases(
        group.flatMap((candidate) => [
          ...(candidate.address.aliases ?? []),
          candidate.routingAddress,
          candidate.slot,
          candidate.instanceId,
          candidate.id,
          candidate.displayName,
        ]),
      );
      const mergedHostId =
        sortedGroup.find((candidate) => candidate.address.hostId != null)
          ?.address.hostId ?? winner.address.hostId;
      const mergedConversationId =
        sortedGroup.find(
          (candidate) => candidate.address.conversationId != null,
        )?.address.conversationId ?? winner.address.conversationId;
      const mergedOwnerClientId =
        sortedGroup.find((candidate) => candidate.address.ownerClientId != null)
          ?.address.ownerClientId ?? winner.address.ownerClientId;
      const mergedReceiveTransports = normalizeReceiveTransports(
        sortedGroup.flatMap((candidate) => candidate.receiveTransports),
      );
      const mergedConsentDriveStatus = deriveConsentDriveStatus({
        receiveTransports: mergedReceiveTransports,
        conversationId: mergedConversationId,
        ownerClientId: mergedOwnerClientId,
        stale: sortedGroup.every(
          (candidate) => candidate.consentDriveStatus === "stale",
        ),
      });
      const mergedPresenceFreshness = sortedGroup.some(
        (candidate) => candidate.presenceFreshness === "fresh-for-routing",
      )
        ? "fresh-for-routing"
        : sortedGroup.some(
              (candidate) => candidate.presenceFreshness === "stale-visible",
            )
          ? "stale-visible"
          : winner.presenceFreshness;

      return {
        ...winner,
        instanceId: mergedInstanceId,
        slot: mergedSlot,
        routingAddress: mergedRoutingAddress,
        displayName: mergedDisplayName,
        agent: formatAgentLabel(winner.id, mergedDisplayName),
        receiveTransports: mergedReceiveTransports,
        consentDriveStatus: mergedConsentDriveStatus,
        presenceFreshness: mergedPresenceFreshness,
        health: mergeRuntimeHealth(sortedGroup),
        address: buildAddressMetadata({
          hostId: mergedHostId,
          agentId: winner.id,
          instanceId: mergedInstanceId,
          routingAddress: mergedRoutingAddress,
          slot: mergedSlot,
          aliases: routingAliases,
          conversationId: mergedConversationId,
          ownerClientId: mergedOwnerClientId,
          deriveOwnerClientIdFromInstance: false,
        }),
        routingAliases,
      };
    })
    .sort(compareCandidates);
}

export function buildPresenceCandidates(
  store: Record<string, Heartbeat>,
  minutes?: number | null,
): TapPresenceCandidate[] {
  const cutoff = minutes == null ? null : Date.now() - minutes * 60 * 1000;
  const stateDir = process.env.TAP_STATE_DIR;
  const stateInstances = loadStateInstances();
  const agents: TapPresenceCandidate[] = [];

  for (const [agentId, heartbeat] of Object.entries(store)) {
    if (!heartbeat.id) continue;

    const lastActivityMs = getActivityMs(heartbeat);
    if (!Number.isFinite(lastActivityMs)) continue;
    if (cutoff != null && lastActivityMs < cutoff) continue;

    const displayName = heartbeat.agent ?? null;
    const storedAddress = heartbeat.address ?? null;
    const instanceId =
      heartbeat.instanceId ??
      storedAddress?.clientId?.trim() ??
      resolveKnownInstanceId(agentId, displayName);
    const slot =
      storedAddress?.slot ?? deriveRoutingSlotFromInstanceId(instanceId);
    const routingAddress =
      storedAddress?.routingAddress?.trim() || slot || instanceId || agentId;
    const source = resolveHeartbeatSource(heartbeat);
    const connectHash =
      heartbeat.connectHash ?? buildHeartbeatConnectHash(instanceId, agentId);
    const instance =
      (instanceId != null ? (stateInstances?.[instanceId] ?? null) : null) ??
      null;
    const bridge =
      stateDir != null
        ? resolveBridgeStatus(stateDir, instanceId, instance)
        : {
            presence: "mcp-only" as const,
            lifecycle: null,
            session: null,
            idleSince: null,
            conversationId: null,
            ownerClientId: null,
          };
    const conversationId =
      heartbeat.capabilities?.conversationId ??
      storedAddress?.conversationId ??
      bridge.conversationId;
    const ownerClientId =
      heartbeat.capabilities?.ownerClientId ??
      storedAddress?.ownerClientId ??
      bridge.ownerClientId;
    const idleBasis =
      bridge.idleSince ?? heartbeat.lastActivity ?? heartbeat.timestamp ?? null;
    const routingAliases = uniqueRoutingAliases([
      ...(storedAddress?.aliases ?? []),
      routingAddress,
      slot,
      instanceId,
      agentId,
      displayName,
    ]);
    const receiveTransports = normalizeReceiveTransports(
      heartbeat.capabilities?.receiveTransports ?? heartbeat.receiveTransports,
    );
    const presenceFreshness = derivePresenceFreshness({
      alive: heartbeat.status !== "signing-off",
      presence: bridge.presence,
      lastActivityMs,
      receiveTransports,
    });
    const consentDriveStatus = deriveConsentDriveStatus({
      receiveTransports,
      conversationId,
      ownerClientId,
      stale:
        heartbeat.status === "signing-off" ||
        bridge.presence === "bridge-stale" ||
        presenceFreshness === "stale-visible",
    });
    const health = deriveRuntimeHealth({
      heartbeat,
      presence: bridge.presence,
      presenceFreshness,
      lifecycle: bridge.lifecycle,
      session: bridge.session,
      consentDriveStatus,
      receiveTransports,
      conversationId,
      ownerClientId,
    });

    agents.push({
      id: agentId,
      agent: formatAgentLabel(agentId, displayName),
      status: heartbeat.status ?? "active",
      lastHeartbeat: heartbeat.timestamp ?? "",
      lastActivity: heartbeat.lastActivity ?? heartbeat.timestamp ?? "",
      alive: heartbeat.status !== "signing-off",
      source,
      instanceId,
      slot,
      routingAddress,
      connectHash,
      presence: bridge.presence,
      lifecycle: bridge.lifecycle,
      session: bridge.session,
      idleSeconds: parseIsoAgeSeconds(idleBasis),
      address: buildAddressMetadata({
        hostId: storedAddress?.hostId ?? null,
        agentId,
        instanceId,
        routingAddress,
        slot,
        aliases: routingAliases,
        conversationId,
        ownerClientId,
        deriveOwnerClientIdFromInstance: false,
      }),
      receiveTransports,
      consentDriveStatus,
      presenceFreshness,
      health,
      slotStatus: null,
      displayName,
      lastActivityMs,
      routingAliases,
    });
  }

  return agents.sort(compareCandidates);
}

function derivePresenceFreshness(options: {
  alive: boolean;
  presence: TapWhoAgent["presence"];
  lastActivityMs: number;
  receiveTransports: TapReceiveTransport[];
}): TapWhoAgent["presenceFreshness"] {
  if (!Number.isFinite(options.lastActivityMs)) return "unknown";
  if (!options.alive || options.presence === "bridge-stale") {
    return "stale-visible";
  }
  const ageMs = Date.now() - options.lastActivityMs;
  if (ageMs > presenceFreshnessWindowMs(options.receiveTransports)) {
    return "stale-visible";
  }
  if (options.receiveTransports.includes("consent-drive")) {
    return "fresh-for-routing";
  }
  return "visible";
}

function deriveConsentDriveStatus(options: {
  receiveTransports: TapReceiveTransport[];
  conversationId: string | null | undefined;
  ownerClientId: string | null | undefined;
  stale: boolean;
}): TapWhoAgent["consentDriveStatus"] {
  if (!options.receiveTransports.includes("consent-drive")) return null;
  if (options.stale) return "stale";
  if (options.conversationId?.trim() && options.ownerClientId?.trim()) {
    return "ready";
  }
  if (options.conversationId?.trim() || options.ownerClientId?.trim()) {
    return "partial";
  }
  return "unavailable";
}

function deriveRuntimeHealth(options: {
  heartbeat: Heartbeat;
  presence: TapWhoAgent["presence"];
  presenceFreshness: TapWhoAgent["presenceFreshness"];
  lifecycle: TapWhoAgent["lifecycle"];
  session: TapWhoAgent["session"];
  consentDriveStatus: TapWhoAgent["consentDriveStatus"];
  receiveTransports: TapReceiveTransport[];
  conversationId: string | null | undefined;
  ownerClientId: string | null | undefined;
}): TapRuntimeHealth {
  const publishedHealth = isRuntimeHealth(options.heartbeat.health)
    ? options.heartbeat.health
    : null;

  const adapter = options.receiveTransports.includes("consent-drive")
    ? "codex-consent-drive"
    : options.presence === "bridge-live" || options.presence === "bridge-stale"
      ? "codex-bridge"
      : options.receiveTransports.includes("mcp-channel")
        ? "mcp-channel"
        : options.receiveTransports.includes("polling")
          ? "file-polling"
          : null;
  const checkedAt =
    options.heartbeat.lastActivity ?? options.heartbeat.timestamp ?? null;

  const preferPublishedHealth = (
    derivedHealth: TapRuntimeHealth,
  ): TapRuntimeHealth => {
    if (!publishedHealth) return derivedHealth;
    const publishedSeverity = HEALTH_SEVERITY[publishedHealth.status];
    const derivedSeverity = HEALTH_SEVERITY[derivedHealth.status];
    return publishedSeverity > derivedSeverity
      ? publishedHealth
      : derivedHealth;
  };

  if (options.heartbeat.status === "signing-off") {
    return {
      status: "not-observed",
      reason: "heartbeat is signing-off",
      checkedAt,
      adapter,
      recovery: "call tap_set_name from the target runtime",
    };
  }

  if (options.presence === "bridge-stale") {
    return {
      status: "adapter-unavailable",
      reason: "bridge process is stale",
      checkedAt,
      adapter: "codex-bridge",
      recovery: `restart the bridge/app-server and rerun lifecycle check; see ${CODEX_RUNTIME_GUIDE}`,
    };
  }

  if (options.lifecycle === "stopped") {
    return {
      status: "adapter-unavailable",
      reason: "bridge/app-server is stopped",
      checkedAt,
      adapter: "codex-bridge",
      recovery: `start the bridge/app-server; see ${CODEX_RUNTIME_GUIDE}`,
    };
  }

  if (
    options.lifecycle === "initializing" ||
    options.lifecycle === "degraded-no-thread"
  ) {
    return {
      status: "degraded",
      reason:
        options.lifecycle === "initializing"
          ? "bridge/app-server is initializing"
          : "bridge/app-server has no ready thread",
      checkedAt,
      adapter: "codex-bridge",
      recovery: `wait or restart bridge/app-server if it remains degraded; see ${CODEX_RUNTIME_GUIDE}`,
    };
  }

  if (options.session === "active" || options.session === "waiting-approval") {
    return {
      status: "active-turn",
      reason:
        options.session === "waiting-approval"
          ? "target turn is waiting for approval"
          : "target conversation has an active turn",
      checkedAt,
      adapter,
      recovery: "wait for the active turn to finish",
    };
  }

  if (options.consentDriveStatus === "stale") {
    return preferPublishedHealth({
      status: "stale-owner",
      reason:
        options.presenceFreshness === "stale-visible"
          ? "cross-device presence is stale-visible, not fresh-for-routing"
          : "consent-drive route is stale",
      checkedAt,
      adapter: "codex-consent-drive",
      recovery:
        "run tap:presence-publish -- --check-only from the hub to confirm whether the target runtime needs warm-up or only central publication; then warm up the target runtime if needed and publish fresh presence to the central comms bus",
    });
  }

  if (options.consentDriveStatus === "partial") {
    return preferPublishedHealth({
      status: "partial",
      reason: options.conversationId?.trim()
        ? "ownerClientId is missing"
        : "conversationId is missing",
      checkedAt,
      adapter: "codex-consent-drive",
      recovery:
        "run tap_register_capabilities from the target runtime with conversationId",
    });
  }

  if (options.consentDriveStatus === "unavailable") {
    return preferPublishedHealth({
      status: "adapter-unavailable",
      reason: "consent-drive is advertised but no route tuple is registered",
      checkedAt,
      adapter: "codex-consent-drive",
      recovery:
        "run tap_register_capabilities from the target runtime with conversationId",
    });
  }

  if (publishedHealth) {
    return publishedHealth;
  }

  if (
    options.presence === "bridge-live" ||
    options.consentDriveStatus === "ready" ||
    options.receiveTransports.includes("mcp-channel") ||
    options.receiveTransports.includes("polling")
  ) {
    return {
      status: "ready",
      reason: options.receiveTransports.includes("polling")
        ? "inbox polling via tap_list_unread; no realtime push channel advertised"
        : null,
      checkedAt,
      adapter,
      recovery: null,
    };
  }

  return {
    status: "unknown",
    reason: "runtime did not publish enough health information",
    checkedAt,
    adapter,
    recovery: null,
  };
}

function isRuntimeHealth(value: unknown): value is TapRuntimeHealth {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<TapRuntimeHealth>;
  return isRuntimeHealthStatus(candidate.status);
}

function isRuntimeHealthStatus(
  value: unknown,
): value is TapRuntimeHealthStatus {
  return (
    value === "ready" ||
    value === "partial" ||
    value === "stale-owner" ||
    value === "active-turn" ||
    value === "stale-active-turn" ||
    value === "stuck-turn" ||
    value === "not-observed" ||
    value === "adapter-unavailable" ||
    value === "degraded" ||
    value === "unknown"
  );
}

export function buildWhoAgents(
  store: Record<string, Heartbeat>,
  minutes: number,
): TapWhoAgent[] {
  return applySlotDisambiguation(
    mergePresenceGroup(buildPresenceCandidates(store, minutes)),
  );
}

const SLOT_FORM_REGEX = /^(tower|reviewer|wt-\d+)$/;
const RESERVED_BROAD_ROLE_ALIASES = new Set([
  "codex",
  "implementer",
  "implementation",
  "reviewer",
  "tower",
]);

function isSlotFormAddress(address: string): boolean {
  return SLOT_FORM_REGEX.test(address.trim());
}

function isReservedBroadRoleAlias(address: string): boolean {
  return RESERVED_BROAD_ROLE_ALIASES.has(address.trim().toLowerCase());
}

function buildAmbiguousBroadRoleAliasResolution(
  recipient: string,
  candidates: TapPresenceCandidate[],
): TapRecipientResolution {
  const sorted = [...candidates].sort(compareCandidates);
  const candidateIds = sorted.map((candidate) => candidate.id);
  const candidateDetails = sorted.map((candidate) => {
    const routingAddress = candidate.routingAddress.trim();
    if (routingAddress && routingAddress !== candidate.id) {
      return `${candidate.id} (${routingAddress})`;
    }
    return candidate.id;
  });

  return {
    target: recipient,
    routingTarget: recipient,
    found: false,
    ambiguous: true,
    candidates: candidateIds,
    warning:
      `⚠️ Blocked ambiguous role alias "${recipient}": matched candidates ` +
      `${candidateDetails.join(", ")}. Use a concrete agent name, ` +
      "a structured target with routing metadata, or an explicitly configured role mapping.",
    displayName: null,
    instanceId: null,
    slot: null,
    address: null,
    receiveTransports: [],
  };
}

export function resolvePreferredRecipient(
  store: Record<string, Heartbeat>,
  recipient: string,
): TapRecipientResolution {
  const allCandidates = buildPresenceCandidates(store, null);
  const reservedBroadRole = isReservedBroadRoleAlias(recipient);
  const exactId = allCandidates.find((candidate) => candidate.id === recipient);
  if (exactId && !reservedBroadRole) {
    const inboxFallback = isStaleConsentDriveOnlyCandidate(exactId)
      ? chooseInboxSurfaceFallback(
          allCandidates.filter((candidate) =>
            candidate.routingAliases.some(
              (alias) =>
                sameRoutingAddress(alias, recipient) || alias === recipient,
            ),
          ),
        )
      : null;
    if (inboxFallback) {
      return buildResolvedRecipient(inboxFallback);
    }
    return {
      target: exactId.id,
      routingTarget: exactId.routingAddress,
      found: true,
      ambiguous: false,
      candidates: [exactId.id],
      warning: null,
      displayName: exactId.displayName,
      instanceId: exactId.instanceId,
      slot: exactId.slot,
      address: exactId.address,
      receiveTransports: exactId.receiveTransports,
    };
  }

  const deduped = applySlotDisambiguation(mergePresenceGroup(allCandidates));
  const slotForm = isSlotFormAddress(recipient);
  const aliasMatches = deduped.filter((candidate) => {
    if (
      !candidate.routingAliases.some(
        (alias) => sameRoutingAddress(alias, recipient) || alias === recipient,
      )
    ) {
      return false;
    }
    // M353: slot-form requests must not resolve to a stale-by-newer holder.
    // Direct agent_id matches are still allowed via the exactId fast-path above.
    if (slotForm && candidate.slotStatus === "stale-by-newer") return false;
    return true;
  });

  if (aliasMatches.length === 1) {
    return {
      target: aliasMatches[0].id,
      routingTarget: aliasMatches[0].routingAddress,
      found: true,
      ambiguous: false,
      candidates: [aliasMatches[0].id],
      warning: null,
      displayName: aliasMatches[0].displayName,
      instanceId: aliasMatches[0].instanceId,
      slot: aliasMatches[0].slot,
      address: aliasMatches[0].address,
      receiveTransports: aliasMatches[0].receiveTransports,
    };
  }

  if (aliasMatches.length > 1) {
    if (reservedBroadRole) {
      return buildAmbiguousBroadRoleAliasResolution(recipient, aliasMatches);
    }
    const inboxFallback = chooseInboxSurfaceFallback(aliasMatches);
    if (inboxFallback) {
      return buildResolvedRecipient(inboxFallback);
    }
    const sorted = [...aliasMatches].sort(compareCandidates);
    const winner = sorted[0];
    const candidateIds = sorted.map((candidate) => candidate.id);
    return {
      target: winner.id,
      routingTarget: winner.routingAddress,
      found: true,
      ambiguous: true,
      candidates: candidateIds,
      warning:
        `⚠️ Routed "${recipient}" → "${winner.routingAddress}" ` +
        `(${winner.presence}/${winner.source}, preferred of ${candidateIds.join(", ")}).`,
      displayName: winner.displayName,
      instanceId: winner.instanceId,
      slot: winner.slot,
      address: winner.address,
      receiveTransports: winner.receiveTransports,
    };
  }

  if (exactId && reservedBroadRole) {
    return buildResolvedRecipient(exactId);
  }

  return {
    target: recipient,
    routingTarget: recipient,
    found: false,
    ambiguous: false,
    candidates: [],
    warning: null,
    displayName: null,
    instanceId: null,
    slot: null,
    address: null,
    receiveTransports: [],
  };
}

function buildResolvedRecipient(
  candidate: TapPresenceCandidate,
  options?: {
    ambiguous?: boolean;
    candidates?: string[];
    warning?: string | null;
  },
): TapRecipientResolution {
  return {
    target: candidate.id,
    routingTarget: candidate.routingAddress,
    found: true,
    ambiguous: options?.ambiguous ?? false,
    candidates: options?.candidates ?? [candidate.id],
    warning: options?.warning ?? null,
    displayName: candidate.displayName,
    instanceId: candidate.instanceId,
    slot: candidate.slot,
    address: candidate.address,
    receiveTransports: candidate.receiveTransports,
  };
}

function isStructuredRecipientLive(candidate: TapPresenceCandidate): boolean {
  if (!candidate.alive) return false;
  return candidate.presence !== "bridge-stale";
}

function isStructuredRecipientFreshForRouting(
  candidate: TapPresenceCandidate,
): boolean {
  return (
    isStructuredRecipientLive(candidate) &&
    candidate.presenceFreshness !== "stale-visible" &&
    candidate.presenceFreshness !== "unknown"
  );
}

function normalizeStructuredTarget(
  target: TapStructuredRecipientTarget,
): TapStructuredRecipientTarget | null {
  const routingAddress = target.routingAddress?.trim();
  if (!routingAddress) return null;
  return {
    routingAddress,
    hostId: target.hostId?.trim() || null,
    clientId: target.clientId?.trim() || null,
    conversationId: target.conversationId?.trim() || null,
    ownerClientId: target.ownerClientId?.trim() || null,
  };
}

function matchesStructuredTarget(
  candidate: TapPresenceCandidate,
  target: TapStructuredRecipientTarget,
): boolean {
  if (
    !candidate.routingAliases.some(
      (alias) =>
        sameRoutingAddress(alias, target.routingAddress) ||
        alias === target.routingAddress,
    )
  ) {
    return false;
  }

  if (target.hostId && candidate.address.hostId?.trim() !== target.hostId) {
    return false;
  }

  if (
    target.clientId &&
    candidate.address.clientId?.trim() !== target.clientId &&
    candidate.instanceId?.trim() !== target.clientId
  ) {
    return false;
  }

  if (
    target.conversationId &&
    candidate.address.conversationId?.trim() !== target.conversationId
  ) {
    return false;
  }

  if (
    target.ownerClientId &&
    candidate.address.ownerClientId?.trim() !== target.ownerClientId
  ) {
    return false;
  }

  return true;
}

export function resolveStructuredRecipient(
  store: Record<string, Heartbeat>,
  target: TapStructuredRecipientTarget,
): TapRecipientResolution {
  const normalizedTarget = normalizeStructuredTarget(target);
  if (!normalizedTarget) {
    return {
      target: "",
      routingTarget: "",
      found: false,
      ambiguous: false,
      candidates: [],
      warning: null,
      displayName: null,
      instanceId: null,
      slot: null,
      address: null,
      receiveTransports: [],
    };
  }

  const recentCandidates = buildPresenceCandidates(
    store,
    POLLING_RECIPIENT_VISIBILITY_MINUTES,
  );
  const exactId = recentCandidates.find(
    (candidate) =>
      candidate.id === normalizedTarget.routingAddress &&
      isStructuredRecipientFreshForRouting(candidate) &&
      matchesStructuredTarget(candidate, normalizedTarget),
  );
  if (exactId) {
    return buildResolvedRecipient(exactId);
  }

  const liveCandidates = applySlotDisambiguation(
    mergePresenceGroup(recentCandidates),
  ).filter(isStructuredRecipientFreshForRouting);
  const slotForm = isSlotFormAddress(normalizedTarget.routingAddress);
  const matches = liveCandidates.filter((candidate) => {
    if (!matchesStructuredTarget(candidate, normalizedTarget)) return false;
    // M353: slot-form structured targets must not resolve to a stale-by-newer
    // holder. Direct client/id-pinned targets are still allowed.
    if (slotForm && candidate.slotStatus === "stale-by-newer") return false;
    return true;
  });

  if (matches.length === 1) {
    return buildResolvedRecipient(matches[0]);
  }

  if (matches.length > 1) {
    const sorted = [...matches].sort(compareCandidates);
    const winner = sorted[0];
    const candidateIds = sorted.map((candidate) => candidate.id);
    return buildResolvedRecipient(winner, {
      ambiguous: true,
      candidates: candidateIds,
      warning:
        `⚠️ Routed structured target "${normalizedTarget.routingAddress}" → ` +
        `"${winner.routingAddress}" (${winner.presence}/${winner.source}, preferred of ${candidateIds.join(", ")}).`,
    });
  }

  const staleMatches = applySlotDisambiguation(
    mergePresenceGroup(buildPresenceCandidates(store, null)),
  ).filter(
    (candidate) =>
      candidate.alive &&
      candidate.presence !== "bridge-stale" &&
      matchesStructuredTarget(candidate, normalizedTarget) &&
      candidate.presenceFreshness === "stale-visible",
  );
  if (staleMatches.length > 0) {
    const sorted = [...staleMatches].sort(compareCandidates);
    const candidateIds = sorted.map((candidate) => candidate.id);
    return {
      target: normalizedTarget.routingAddress,
      routingTarget: normalizedTarget.routingAddress,
      found: false,
      ambiguous: candidateIds.length > 1,
      candidates: candidateIds,
      warning:
        `Structured target "${normalizedTarget.routingAddress}" matched stale-visible presence (${candidateIds.join(", ")}), ` +
        "but no fresh-for-routing recipient matched the requested address constraints. " +
        "Recovery: run tap:presence-publish -- --check-only from the hub to confirm whether the target runtime needs warm-up or only central publication; then warm up the target runtime if needed, publish fresh presence, and retry.",
      displayName: sorted[0].displayName,
      instanceId: sorted[0].instanceId,
      slot: sorted[0].slot,
      address: sorted[0].address,
      receiveTransports: sorted[0].receiveTransports,
    };
  }

  return {
    target: normalizedTarget.routingAddress,
    routingTarget: normalizedTarget.routingAddress,
    found: false,
    ambiguous: false,
    candidates: [],
    warning: null,
    displayName: null,
    instanceId: null,
    slot: null,
    address: null,
    receiveTransports: [],
  };
}

/**
 * Build a Map<heartbeatKey, PresenceLevel> for routing disambiguation.
 * Unlike buildWhoAgents, returns raw key→presence without label formatting.
 */
export function resolvePresenceMap(
  store: Record<string, Heartbeat>,
): Map<string, "bridge-live" | "bridge-stale" | "mcp-only"> {
  const result = new Map<string, "bridge-live" | "bridge-stale" | "mcp-only">();

  for (const candidate of buildPresenceCandidates(store, null)) {
    result.set(candidate.id, candidate.presence);
  }

  return result;
}
