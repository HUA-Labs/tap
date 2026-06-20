import {
  createExperimentalCodexIpcObserveTransport,
  type CodexIpcObserveTransportOptions,
} from "../transport/experimental/codex-ipc-observe.js";
import { isCodexIpcDefaultSupported } from "../transport/experimental/codex-ipc-endpoint.js";
import type {
  ObserveTransport,
  ObserveTransportConversation,
  ObserveTransportSnapshot,
} from "../transport/types.js";

export type WindowsAppRouteHealthStatus =
  | "fresh-route-ready"
  | "stale-presence"
  | "live-candidate-needs-selection"
  | "missing-owner-client"
  | "candidate-not-observed"
  | "active-turn-blocked"
  | "adapter-unavailable";

export interface WindowsAppRouteCandidate {
  conversationId: string;
  ownerClientId: string | null;
  hostId: string | null;
  lastChangeType: string | null;
  lastTurnId: string | null;
  lastTurnStatus: string | null;
  hasError: boolean | null;
  matchesRequestedConversation: boolean;
  matchesPresenceConversation: boolean;
  matchesPresenceOwner: boolean;
}

export interface WindowsAppRouteHealth {
  status: WindowsAppRouteHealthStatus;
  message: string;
  requestedConversationId: string | null;
  presenceConversationId: string | null;
  presenceOwnerClientId: string | null;
  presenceFreshness: string;
  presenceAgeMinutes: number | null;
  candidates: WindowsAppRouteCandidate[];
}

export interface ProbeWindowsAppRouteHealthOptions {
  conversationId?: string | null;
  presenceConversationId?: string | null;
  presenceOwnerClientId?: string | null;
  presenceFreshness: string;
  presenceAgeMinutes?: number | null;
  hostId?: string | null;
  timeoutMs?: number;
  transport?: ObserveTransport;
  transportFactory?: (
    options: CodexIpcObserveTransportOptions,
  ) => ObserveTransport;
}

const DEFAULT_ROUTE_HEALTH_TIMEOUT_MS = 1_500;

function normalizeString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function numericValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function extractLastTurn(change: unknown): Record<string, unknown> | null {
  const record = asRecord(change);
  const direct = asRecord(record?.turn);
  if (direct) return direct;
  const conversationState = asRecord(record?.conversationState);
  const turns = Array.isArray(conversationState?.turns)
    ? conversationState.turns
    : [];
  return turns.length > 0 ? asRecord(turns[turns.length - 1]) : null;
}

function hasTurnError(turn: Record<string, unknown> | null): boolean | null {
  if (!turn) return null;
  return turn.error != null;
}

function candidateFromConversation(options: {
  conversation: ObserveTransportConversation;
  requestedConversationId: string | null;
  presenceConversationId: string | null;
  presenceOwnerClientId: string | null;
}): WindowsAppRouteCandidate {
  const change = asRecord(options.conversation.metadata.change);
  const turn = extractLastTurn(change);
  const conversationId =
    normalizeString(options.conversation.address.conversationId) ??
    options.conversation.id;
  const ownerClientId = normalizeString(
    options.conversation.address.ownerClientId,
  );
  return {
    conversationId,
    ownerClientId,
    hostId: normalizeString(options.conversation.address.hostId),
    lastChangeType: normalizeString(change?.type),
    lastTurnId:
      normalizeString(turn?.id) ?? normalizeString(turn?.turnId) ?? null,
    lastTurnStatus: normalizeString(turn?.status),
    hasError: hasTurnError(turn),
    matchesRequestedConversation:
      Boolean(options.requestedConversationId) &&
      conversationId === options.requestedConversationId,
    matchesPresenceConversation:
      Boolean(options.presenceConversationId) &&
      conversationId === options.presenceConversationId,
    matchesPresenceOwner:
      Boolean(options.presenceOwnerClientId) &&
      ownerClientId === options.presenceOwnerClientId,
  };
}

function candidateIsActive(candidate: WindowsAppRouteCandidate): boolean {
  return (
    candidate.lastTurnStatus === "active" ||
    candidate.lastTurnStatus === "inProgress"
  );
}

function classifyRouteHealth(options: {
  requestedConversationId: string | null;
  presenceConversationId: string | null;
  presenceOwnerClientId: string | null;
  presenceFreshness: string;
  presenceAgeMinutes: number | null;
  candidates: WindowsAppRouteCandidate[];
}): WindowsAppRouteHealth {
  const requestedCandidates = options.requestedConversationId
    ? options.candidates.filter(
        (candidate) => candidate.matchesRequestedConversation,
      )
    : options.candidates;
  const selected =
    requestedCandidates.length === 1 ? requestedCandidates[0] : null;

  if (options.requestedConversationId && requestedCandidates.length === 0) {
    return {
      ...options,
      status: "candidate-not-observed",
      message: `no live Windows App conversation observed for ${options.requestedConversationId}`,
    };
  }

  if (!options.requestedConversationId && options.candidates.length !== 1) {
    return {
      ...options,
      status: "live-candidate-needs-selection",
      message:
        options.candidates.length === 0
          ? "no live Windows App conversation candidates observed"
          : `multiple live Windows App candidates observed: ${options.candidates.length}`,
    };
  }

  if (!selected) {
    return {
      ...options,
      status: "live-candidate-needs-selection",
      message: `multiple live Windows App candidates matched: ${requestedCandidates.length}`,
    };
  }

  if (candidateIsActive(selected)) {
    return {
      ...options,
      status: "active-turn-blocked",
      message: `live Windows App conversation ${selected.conversationId} has an active turn`,
    };
  }

  if (!selected.ownerClientId) {
    return {
      ...options,
      status: "missing-owner-client",
      message: `live Windows App conversation ${selected.conversationId} is missing ownerClientId; durable presence refresh requires conversationId + ownerClientId`,
    };
  }

  const presenceMatches =
    options.presenceFreshness === "fresh-for-routing" &&
    selected.matchesPresenceConversation &&
    selected.matchesPresenceOwner;
  if (presenceMatches) {
    return {
      ...options,
      status: "fresh-route-ready",
      message: `durable presence matches live Windows App conversation ${selected.conversationId}`,
    };
  }

  return {
    ...options,
    status: "stale-presence",
    message: options.presenceConversationId
      ? `live Windows App conversation ${selected.conversationId} does not match fresh durable presence ${options.presenceConversationId}`
      : `live Windows App conversation ${selected.conversationId} has no matching durable presence`,
  };
}

async function collectSnapshot(options: {
  transport: ObserveTransport;
  timeoutMs: number;
}): Promise<ObserveTransportSnapshot> {
  const connectedSnapshot = await options.transport.connect();
  if (options.timeoutMs <= 0) return connectedSnapshot;
  await new Promise((resolve) => setTimeout(resolve, options.timeoutMs));
  return options.transport.getSnapshot();
}

export async function probeWindowsAppRouteHealth(
  options: ProbeWindowsAppRouteHealthOptions,
): Promise<WindowsAppRouteHealth> {
  const requestedConversationId = normalizeString(options.conversationId);
  const presenceConversationId = normalizeString(
    options.presenceConversationId,
  );
  const presenceOwnerClientId = normalizeString(options.presenceOwnerClientId);
  const presenceAgeMinutes = numericValue(options.presenceAgeMinutes);
  const presenceFreshness = options.presenceFreshness || "unknown";

  if (
    !isCodexIpcDefaultSupported() &&
    !options.transport &&
    !options.transportFactory
  ) {
    return {
      status: "adapter-unavailable",
      message:
        "Windows App route health requires a local Windows/macOS Codex IPC observe adapter.",
      requestedConversationId,
      presenceConversationId,
      presenceOwnerClientId,
      presenceFreshness,
      presenceAgeMinutes,
      candidates: [],
    };
  }

  const timeoutMs =
    typeof options.timeoutMs === "number" && options.timeoutMs >= 0
      ? options.timeoutMs
      : DEFAULT_ROUTE_HEALTH_TIMEOUT_MS;
  const transport =
    options.transport ??
    options.transportFactory?.({
      hostId: options.hostId,
      requestTimeoutMs: timeoutMs,
    }) ??
    createExperimentalCodexIpcObserveTransport({
      hostId: options.hostId,
      requestTimeoutMs: timeoutMs,
    });
  const ownsTransport = !options.transport;

  try {
    const snapshot = await collectSnapshot({ transport, timeoutMs });
    if (!snapshot.connected) {
      return {
        status: "adapter-unavailable",
        message: "Windows App IPC observe adapter is not connected.",
        requestedConversationId,
        presenceConversationId,
        presenceOwnerClientId,
        presenceFreshness,
        presenceAgeMinutes,
        candidates: [],
      };
    }
    const candidates = snapshot.conversations.map((conversation) =>
      candidateFromConversation({
        conversation,
        requestedConversationId,
        presenceConversationId,
        presenceOwnerClientId,
      }),
    );
    return classifyRouteHealth({
      requestedConversationId,
      presenceConversationId,
      presenceOwnerClientId,
      presenceFreshness,
      presenceAgeMinutes,
      candidates,
    });
  } catch (error) {
    return {
      status: "adapter-unavailable",
      message: error instanceof Error ? error.message : String(error),
      requestedConversationId,
      presenceConversationId,
      presenceOwnerClientId,
      presenceFreshness,
      presenceAgeMinutes,
      candidates: [],
    };
  } finally {
    if (ownsTransport) {
      await transport.disconnect().catch(() => undefined);
    }
  }
}
