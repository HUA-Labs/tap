export const DEFAULT_STUCK_TURN_SECONDS = 120;
export const DEFAULT_STALE_ACTIVE_TURN_SECONDS = 10 * 60;

export type CodexRuntimeHealthStatus =
  | "ready"
  | "partial"
  | "stale-owner"
  | "active-turn"
  | "stale-active-turn"
  | "stuck-turn"
  | "degraded"
  | "not-observed"
  | "adapter-unavailable"
  | "unknown";

export interface CodexRuntimeHealth {
  status: CodexRuntimeHealthStatus;
  reason: string | null;
  checkedAt: string;
  adapter: string;
  recovery: string | null;
}

export interface CodexRuntimeTurnEvidence {
  turnId?: string | null;
  status?: string | null;
  turnStartedAgeSeconds?: number | null;
  durationMs?: number | null;
  finalAssistantStartedAtMs?: number | null;
  hasError?: boolean | null;
  itemCount?: number | null;
}

export interface CodexRuntimeConversationEvidence {
  conversationId?: string | null;
  hostId?: string | null;
  ownerClientId?: string | null;
  lastChangeType?: string | null;
  lastTurn?: CodexRuntimeTurnEvidence | null;
  lastSeenAt?: string | null;
}

export interface CodexRuntimeBindingEvidence {
  source?: string | null;
  filePath?: string | null;
  id?: string | null;
  agent?: string | null;
  routingAddress?: string | null;
  aliases?: string[];
  timestamp?: string | null;
  ageSeconds?: number | null;
  receiveTransports?: string[];
  hostId?: string | null;
  clientId?: string | null;
  conversationId?: string | null;
  ownerClientId?: string | null;
  consentDriveStatus?: string | null;
  lifecycleStatus?: string | null;
  runtimeHealthStatus?: string | null;
  message?: string | null;
}

export interface CodexRuntimeIpcEvidence {
  supported?: boolean | null;
  connected?: boolean | null;
  initializedClientId?: string | null;
  conversations?: CodexRuntimeConversationEvidence[];
  agents?: unknown[];
  error?: string | null;
}

export interface CodexRuntimeHealthOptions {
  checkedAt?: string | null;
  adapter?: string | null;
  stuckTurnSeconds?: number;
  staleActiveTurnSeconds?: number;
}

export type ClassifiedCodexRuntimeBinding = CodexRuntimeBindingEvidence & {
  lifecycleStatus: string;
  runtimeHealthStatus: CodexRuntimeHealthStatus;
  message: string;
  liveOwnerClientId: string | null;
  liveHostId: string | null;
  liveLastChangeType: string | null;
  liveLastSeenAt: string | null;
  health: CodexRuntimeHealth;
};

function normalizeString(value: string | null | undefined): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function normalizeStatus(value: string | null | undefined): string {
  return normalizeString(value) ?? "unknown";
}

function recoveryForStatus(status: string): string | null {
  switch (status) {
    case "partial":
      return "Run tap_register_capabilities with the conversationId on the target Codex session.";
    case "stale-owner":
      return "Run tap_register_capabilities from the target runtime with the conversationId and omit ownerClientId.";
    case "active-turn":
      return "Wait for the active turn to finish before retrying realtime delivery.";
    case "stale-active-turn":
      return "Re-observe or restart the target Codex runtime, or rerun lifecycle recovery with --interrupt-stale-active if the UI is idle.";
    case "stuck-turn":
      return "Run codex:windows with --conversation-id and --interrupt-stuck if the UI/model is frozen.";
    case "not-observed":
      return "Focus or reopen the target Codex session and rerun the lifecycle check.";
    case "adapter-unavailable":
      return "Run this check on a host with Codex IPC visibility, or use the matching runtime adapter.";
    case "degraded":
      return "Check adapter-specific diagnostics and the matching runtime runbook.";
    case "unknown":
      return "Runtime health evidence is incomplete; refresh the target runtime capabilities.";
    default:
      return null;
  }
}

function toRuntimeHealthStatus(status: string): CodexRuntimeHealthStatus {
  if (status === "unavailable") return "adapter-unavailable";
  if (
    status === "ready" ||
    status === "partial" ||
    status === "stale-owner" ||
    status === "active-turn" ||
    status === "stale-active-turn" ||
    status === "stuck-turn" ||
    status === "degraded" ||
    status === "not-observed" ||
    status === "adapter-unavailable" ||
    status === "unknown"
  ) {
    return status;
  }
  return "unknown";
}

export function isStuckInProgressConversation(
  conversation: CodexRuntimeConversationEvidence | null | undefined,
  options: Pick<CodexRuntimeHealthOptions, "stuckTurnSeconds"> = {},
): boolean {
  const turn = asRecord(conversation?.lastTurn);
  const stuckTurnSeconds =
    typeof options.stuckTurnSeconds === "number"
      ? options.stuckTurnSeconds
      : DEFAULT_STUCK_TURN_SECONDS;
  return (
    turn?.status === "inProgress" &&
    turn.itemCount === 0 &&
    turn.durationMs === null &&
    turn.finalAssistantStartedAtMs === null &&
    typeof turn.turnStartedAgeSeconds === "number" &&
    turn.turnStartedAgeSeconds >= stuckTurnSeconds
  );
}

export function isStaleActiveInProgressConversation(
  conversation: CodexRuntimeConversationEvidence | null | undefined,
  options: Pick<CodexRuntimeHealthOptions, "staleActiveTurnSeconds"> = {},
): boolean {
  const turn = asRecord(conversation?.lastTurn);
  const staleActiveTurnSeconds =
    typeof options.staleActiveTurnSeconds === "number"
      ? options.staleActiveTurnSeconds
      : DEFAULT_STALE_ACTIVE_TURN_SECONDS;
  return (
    turn?.status === "inProgress" &&
    typeof turn.turnStartedAgeSeconds === "number" &&
    turn.turnStartedAgeSeconds >= staleActiveTurnSeconds
  );
}

export function deriveRuntimeHealthForBinding(
  binding: Pick<
    CodexRuntimeBindingEvidence,
    "runtimeHealthStatus" | "lifecycleStatus" | "message"
  >,
  options: Pick<CodexRuntimeHealthOptions, "checkedAt" | "adapter"> = {},
): CodexRuntimeHealth {
  const checkedAt =
    normalizeString(options.checkedAt) ?? new Date().toISOString();
  const adapter = normalizeString(options.adapter) ?? "codex-desktop-ipc";
  const status = toRuntimeHealthStatus(
    normalizeStatus(binding.runtimeHealthStatus ?? binding.lifecycleStatus),
  );
  return {
    status,
    reason: normalizeString(binding.message),
    checkedAt,
    adapter,
    recovery: recoveryForStatus(status),
  };
}

export function classifyCodexBindings(
  bindings: CodexRuntimeBindingEvidence[],
  ipc: CodexRuntimeIpcEvidence,
  options: CodexRuntimeHealthOptions = {},
): ClassifiedCodexRuntimeBinding[] {
  const checkedAt =
    normalizeString(options.checkedAt) ?? new Date().toISOString();
  const adapter = normalizeString(options.adapter) ?? "codex-desktop-ipc";

  if (!ipc?.supported || !ipc?.connected) {
    return bindings.map((binding) => {
      const extensionUnknown = adapter === "codex-extension-mcp";
      const classified = {
        ...binding,
        lifecycleStatus: "unavailable",
        runtimeHealthStatus: extensionUnknown
          ? "unknown"
          : "adapter-unavailable",
        message: extensionUnknown
          ? "Codex extension MCP presence is visible, but no IPC observe surface is available."
          : ipc?.supported
            ? (normalizeString(ipc.error) ??
              "Codex IPC observe is unavailable.")
            : "Codex IPC observe is not supported on this host.",
        liveOwnerClientId: null,
        liveHostId: null,
        liveLastChangeType: null,
        liveLastSeenAt: null,
      } satisfies Omit<ClassifiedCodexRuntimeBinding, "health">;
      return {
        ...classified,
        health: deriveRuntimeHealthForBinding(classified, {
          checkedAt,
          adapter,
        }),
      };
    });
  }

  const conversations = Array.isArray(ipc.conversations)
    ? ipc.conversations
    : [];
  const byConversation = new Map(
    conversations.map((entry) => [entry.conversationId, entry]),
  );

  return bindings.map((binding) => {
    const live = binding.conversationId
      ? byConversation.get(binding.conversationId)
      : null;
    let lifecycleStatus = "unavailable";
    let runtimeHealthStatus: CodexRuntimeHealthStatus = "adapter-unavailable";
    let message = "Binding does not include a conversationId.";

    if (binding.conversationId && !binding.ownerClientId) {
      lifecycleStatus = "partial";
      runtimeHealthStatus = "partial";
      message = "Binding has conversationId but no ownerClientId.";
    } else if (binding.conversationId && binding.ownerClientId && !live) {
      lifecycleStatus = "not-observed";
      runtimeHealthStatus = "not-observed";
      message =
        "No live IPC conversation was observed for this conversationId.";
    } else if (
      binding.conversationId &&
      binding.ownerClientId &&
      live?.ownerClientId === binding.ownerClientId
    ) {
      lifecycleStatus = "ready";
      runtimeHealthStatus = "ready";
      message = "Stored ownerClientId matches live IPC owner.";
      if (isStuckInProgressConversation(live, options)) {
        runtimeHealthStatus = "stuck-turn";
        message =
          "Live Codex conversation has an in-progress turn with no emitted items.";
      } else if (isStaleActiveInProgressConversation(live, options)) {
        runtimeHealthStatus = "stale-active-turn";
        message =
          "Live Codex conversation has an old in-progress turn; the UI may be idle but IPC still reports it active.";
      } else if (live?.lastTurn?.status === "inProgress") {
        runtimeHealthStatus = "active-turn";
        message = "Live Codex conversation has an active in-progress turn.";
      }
    } else if (binding.conversationId && binding.ownerClientId && live) {
      lifecycleStatus = "stale-owner";
      runtimeHealthStatus = "stale-owner";
      message = "Stored ownerClientId differs from live IPC owner.";
    }

    const classified = {
      ...binding,
      lifecycleStatus,
      runtimeHealthStatus,
      message,
      liveOwnerClientId: live?.ownerClientId ?? null,
      liveHostId: live?.hostId ?? null,
      liveLastChangeType: live?.lastChangeType ?? null,
      liveLastSeenAt: live?.lastSeenAt ?? null,
    } satisfies Omit<ClassifiedCodexRuntimeBinding, "health">;
    return {
      ...classified,
      health: deriveRuntimeHealthForBinding(classified, { checkedAt, adapter }),
    };
  });
}
