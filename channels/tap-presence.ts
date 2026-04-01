import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildHeartbeatConnectHash,
  resolveKnownInstanceId,
  type Heartbeat,
  type HeartbeatSource,
} from "./tap-utils.js";

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
  connectHash: string;
  presence: "bridge-live" | "bridge-stale" | "mcp-only";
  lifecycle:
    | "ready"
    | "initializing"
    | "degraded-no-thread"
    | "bridge-stale"
    | null;
  session:
    | "initializing"
    | "active"
    | "idle"
    | "waiting-approval"
    | "disconnected"
    | null;
  idleSeconds: number | null;
}

type TapPresenceCandidate = TapWhoAgent & {
  displayName: string | null;
  lastActivityMs: number;
};

export interface TapRecipientResolution {
  target: string;
  found: boolean;
  ambiguous: boolean;
  candidates: string[];
  warning: string | null;
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
  return new Date(heartbeat.lastActivity ?? heartbeat.timestamp ?? 0).getTime();
}

function resolveHeartbeatSource(heartbeat: Heartbeat): HeartbeatSource {
  return heartbeat.source === "bridge-dispatch" ? "bridge-dispatch" : "mcp-direct";
}

function resolveBridgeStatus(
  stateDir: string,
  instanceId: string | null,
): {
  presence: "bridge-live" | "bridge-stale" | "mcp-only";
  lifecycle:
    | "ready"
    | "initializing"
    | "degraded-no-thread"
    | "bridge-stale"
    | null;
  session:
    | "initializing"
    | "active"
    | "idle"
    | "waiting-approval"
    | "disconnected"
    | null;
  idleSince: string | null;
} {
  if (!instanceId) {
    return {
      presence: "mcp-only",
      lifecycle: null,
      session: null,
      idleSince: null,
    };
  }

  const bridgeState = parseJsonFile<BridgeStateFile>(
    join(stateDir, "pids", `bridge-${instanceId}.json`),
  );
  if (!bridgeState) {
    return {
      presence: "mcp-only",
      lifecycle: null,
      session: null,
      idleSince: null,
    };
  }

  if (!isProcessAlive(bridgeState.pid)) {
    return {
      presence: "bridge-stale",
      lifecycle: "bridge-stale",
      session: null,
      idleSince: null,
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
    };
  }

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

function compareCandidates(a: TapPresenceCandidate, b: TapPresenceCandidate): number {
  const presenceDelta = PRESENCE_PRIORITY[b.presence] - PRESENCE_PRIORITY[a.presence];
  if (presenceDelta !== 0) return presenceDelta;

  const sourceDelta = SOURCE_PRIORITY[b.source] - SOURCE_PRIORITY[a.source];
  if (sourceDelta !== 0) return sourceDelta;

  if (a.alive !== b.alive) return a.alive ? -1 : 1;
  if (a.lastActivityMs !== b.lastActivityMs) {
    return b.lastActivityMs - a.lastActivityMs;
  }
  return a.id.localeCompare(b.id);
}

function dedupeByConnectHash(
  candidates: TapPresenceCandidate[],
): TapPresenceCandidate[] {
  const deduped = new Map<string, TapPresenceCandidate>();
  for (const candidate of candidates) {
    const existing = deduped.get(candidate.connectHash);
    if (!existing || compareCandidates(candidate, existing) < 0) {
      deduped.set(candidate.connectHash, candidate);
    }
  }
  return [...deduped.values()].sort(compareCandidates);
}

export function buildPresenceCandidates(
  store: Record<string, Heartbeat>,
  minutes?: number | null,
): TapPresenceCandidate[] {
  const cutoff = minutes == null ? null : Date.now() - minutes * 60 * 1000;
  const stateDir = process.env.TAP_STATE_DIR;
  const agents: TapPresenceCandidate[] = [];

  for (const [agentId, heartbeat] of Object.entries(store)) {
    if (!heartbeat.id) continue;

    const lastActivityMs = getActivityMs(heartbeat);
    if (!Number.isFinite(lastActivityMs)) continue;
    if (cutoff != null && lastActivityMs < cutoff) continue;

    const displayName = heartbeat.agent ?? null;
    const instanceId =
      heartbeat.instanceId ?? resolveKnownInstanceId(agentId, displayName);
    const source = resolveHeartbeatSource(heartbeat);
    const connectHash =
      heartbeat.connectHash ?? buildHeartbeatConnectHash(instanceId, agentId);
    const bridge =
      stateDir != null
        ? resolveBridgeStatus(stateDir, instanceId)
        : {
            presence: "mcp-only" as const,
            lifecycle: null,
            session: null,
            idleSince: null,
          };
    const idleBasis =
      bridge.idleSince ??
      heartbeat.lastActivity ??
      heartbeat.timestamp ??
      null;

    agents.push({
      id: agentId,
      agent: formatAgentLabel(agentId, displayName),
      status: heartbeat.status ?? "active",
      lastHeartbeat: heartbeat.timestamp ?? "",
      lastActivity: heartbeat.lastActivity ?? heartbeat.timestamp ?? "",
      alive: heartbeat.status !== "signing-off",
      source,
      instanceId,
      connectHash,
      presence: bridge.presence,
      lifecycle: bridge.lifecycle,
      session: bridge.session,
      idleSeconds: parseIsoAgeSeconds(idleBasis),
      displayName,
      lastActivityMs,
    });
  }

  return agents.sort(compareCandidates);
}

export function buildWhoAgents(
  store: Record<string, Heartbeat>,
  minutes: number,
): TapWhoAgent[] {
  return dedupeByConnectHash(buildPresenceCandidates(store, minutes));
}

export function resolvePreferredRecipient(
  store: Record<string, Heartbeat>,
  recipient: string,
): TapRecipientResolution {
  const allCandidates = buildPresenceCandidates(store, null);
  const exactId = allCandidates.find((candidate) => candidate.id === recipient);
  if (exactId) {
    return {
      target: exactId.id,
      found: true,
      ambiguous: false,
      candidates: [exactId.id],
      warning: null,
    };
  }

  const deduped = dedupeByConnectHash(allCandidates);
  const nameMatches = deduped.filter(
    (candidate) => candidate.displayName === recipient,
  );
  if (nameMatches.length === 1) {
    return {
      target: nameMatches[0].id,
      found: true,
      ambiguous: false,
      candidates: [nameMatches[0].id],
      warning: null,
    };
  }

  if (nameMatches.length > 1) {
    const sorted = [...nameMatches].sort(compareCandidates);
    const winner = sorted[0];
    const candidateIds = sorted.map((candidate) => candidate.id);
    return {
      target: winner.id,
      found: true,
      ambiguous: true,
      candidates: candidateIds,
      warning:
        `⚠️ Routed "${recipient}" → "${winner.id}" ` +
        `(${winner.presence}/${winner.source}, preferred of ${candidateIds.join(", ")}).`,
    };
  }

  return {
    target: recipient,
    found: false,
    ambiguous: false,
    candidates: [],
    warning: null,
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
