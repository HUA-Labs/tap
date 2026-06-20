declare const DEFAULT_STUCK_TURN_SECONDS = 120;
declare const DEFAULT_STALE_ACTIVE_TURN_SECONDS: number;
type CodexRuntimeHealthStatus = "ready" | "partial" | "stale-owner" | "active-turn" | "stale-active-turn" | "stuck-turn" | "degraded" | "not-observed" | "adapter-unavailable" | "unknown";
interface CodexRuntimeHealth {
    status: CodexRuntimeHealthStatus;
    reason: string | null;
    checkedAt: string;
    adapter: string;
    recovery: string | null;
}
interface CodexRuntimeTurnEvidence {
    turnId?: string | null;
    status?: string | null;
    turnStartedAgeSeconds?: number | null;
    durationMs?: number | null;
    finalAssistantStartedAtMs?: number | null;
    hasError?: boolean | null;
    itemCount?: number | null;
}
interface CodexRuntimeConversationEvidence {
    conversationId?: string | null;
    hostId?: string | null;
    ownerClientId?: string | null;
    lastChangeType?: string | null;
    lastTurn?: CodexRuntimeTurnEvidence | null;
    lastSeenAt?: string | null;
}
interface CodexRuntimeBindingEvidence {
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
interface CodexRuntimeIpcEvidence {
    supported?: boolean | null;
    connected?: boolean | null;
    initializedClientId?: string | null;
    conversations?: CodexRuntimeConversationEvidence[];
    agents?: unknown[];
    error?: string | null;
}
interface CodexRuntimeHealthOptions {
    checkedAt?: string | null;
    adapter?: string | null;
    stuckTurnSeconds?: number;
    staleActiveTurnSeconds?: number;
}
type ClassifiedCodexRuntimeBinding = CodexRuntimeBindingEvidence & {
    lifecycleStatus: string;
    runtimeHealthStatus: CodexRuntimeHealthStatus;
    message: string;
    liveOwnerClientId: string | null;
    liveHostId: string | null;
    liveLastChangeType: string | null;
    liveLastSeenAt: string | null;
    health: CodexRuntimeHealth;
};
declare function isStuckInProgressConversation(conversation: CodexRuntimeConversationEvidence | null | undefined, options?: Pick<CodexRuntimeHealthOptions, "stuckTurnSeconds">): boolean;
declare function isStaleActiveInProgressConversation(conversation: CodexRuntimeConversationEvidence | null | undefined, options?: Pick<CodexRuntimeHealthOptions, "staleActiveTurnSeconds">): boolean;
declare function deriveRuntimeHealthForBinding(binding: Pick<CodexRuntimeBindingEvidence, "runtimeHealthStatus" | "lifecycleStatus" | "message">, options?: Pick<CodexRuntimeHealthOptions, "checkedAt" | "adapter">): CodexRuntimeHealth;
declare function classifyCodexBindings(bindings: CodexRuntimeBindingEvidence[], ipc: CodexRuntimeIpcEvidence, options?: CodexRuntimeHealthOptions): ClassifiedCodexRuntimeBinding[];

export { type ClassifiedCodexRuntimeBinding, type CodexRuntimeBindingEvidence, type CodexRuntimeConversationEvidence, type CodexRuntimeHealth, type CodexRuntimeHealthOptions, type CodexRuntimeHealthStatus, type CodexRuntimeIpcEvidence, type CodexRuntimeTurnEvidence, DEFAULT_STALE_ACTIVE_TURN_SECONDS, DEFAULT_STUCK_TURN_SECONDS, classifyCodexBindings, deriveRuntimeHealthForBinding, isStaleActiveInProgressConversation, isStuckInProgressConversation };
