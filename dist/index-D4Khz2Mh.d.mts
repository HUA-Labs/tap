import { T as TransportAddress, a as ObserveTransportSnapshot } from './types-FWvKrFUt.mjs';

type TapReceiveTransport = "mcp-channel" | "consent-drive" | "polling";
interface ReceiveTransportRuntimeHints {
    runtimeName?: string | null;
    instanceId?: string | null;
    bridgeInstanceId?: string | null;
    agentId?: string | null;
    runtimeStateDir?: string | null;
    mcpClientName?: string | null;
}
declare function normalizeReceiveTransports(values: readonly string[] | null | undefined): TapReceiveTransport[];
declare function inferReceiveTransports(hints?: ReceiveTransportRuntimeHints): TapReceiveTransport[];
declare function prefersConsentDrive(values: readonly string[] | null | undefined): boolean;
declare function canUseConsentDriveForAddress(options: {
    localHostId?: string | null;
    address?: TransportAddress | null;
}): boolean;

type CodexBindingSource = "heartbeat" | "observe";
type CodexBindingBlockReason = "missing-target" | "not-found" | "partial" | "stale" | "ambiguous" | "not-reachable" | "binding-mismatch";
type CodexBindingStatus = "ready" | "partial" | "stale";
type CodexBindingRuntimeHealthStatus = "ready" | "partial" | "stale-owner" | "active-turn" | "stale-active-turn" | "stuck-turn" | "not-observed" | "adapter-unavailable" | "degraded" | "unknown";
interface CodexBindingRuntimeHealth {
    status: CodexBindingRuntimeHealthStatus;
    reason: string | null;
    checkedAt: string | null;
    adapter: string | null;
    recovery: string | null;
}
interface CodexBindingAddress extends TransportAddress {
    routingAddress: string;
}
interface CodexBinding {
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
interface CodexBindingRegistry {
    bindings: CodexBinding[];
    builtAt: string;
    staleAfterMs: number;
}
interface CodexBindingHeartbeat {
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
interface BuildCodexBindingRegistryOptions {
    heartbeats?: Record<string, CodexBindingHeartbeat> | null;
    observeSnapshot?: ObserveTransportSnapshot | null;
    now?: Date | string | number;
    staleAfterMs?: number;
}
interface ResolveCodexBindingTarget {
    agentName?: string | null;
    routingAddress?: string | null;
    hostId?: string | null;
    clientId?: string | null;
    conversationId?: string | null;
    ownerClientId?: string | null;
}
type ResolveCodexBindingResult = {
    status: "resolved";
    binding: CodexBinding;
} | {
    status: "blocked";
    reason: CodexBindingBlockReason;
    candidates: CodexBinding[];
    message: string;
};
interface ResolveCodexBindingOptions {
    registry: CodexBindingRegistry;
    target: ResolveCodexBindingTarget;
    localHostId?: string | null;
    liveSnapshot?: ObserveTransportSnapshot | null;
}
declare function buildCodexBindingRegistry(options?: BuildCodexBindingRegistryOptions): CodexBindingRegistry;
declare function resolveCodexBinding(options: ResolveCodexBindingOptions): ResolveCodexBindingResult;

type CodexA2AAdapterKind = "ipc-direct" | "ssh-ipc-relay" | "app-server-auth" | "official-remote";
type CodexA2AFailureReason = "missing-target" | "not-found" | "partial" | "stale" | "ambiguous" | "not-reachable" | "binding-mismatch" | "transport-unavailable" | "transport-error" | "recipient-active-turn" | "dry-run";
interface CodexA2ATargetTuple {
    routingAddress: string;
    hostId: string | null;
    conversationId: string;
    ownerClientId: string;
}
interface CodexA2AMessageEnvelope {
    sender: {
        routingAddress: string;
        displayName: string;
    };
    recipient: {
        routingAddress: string;
        displayName: string | null;
    };
    subject: string;
    content: string;
    fileName: string;
}
interface CodexA2ADeliveryRequest {
    adapter: CodexA2AAdapterKind;
    target: CodexA2ATargetTuple;
    message: CodexA2AMessageEnvelope;
    dryRun?: boolean;
}
type CodexA2ADeliveryResult = {
    status: "delivered";
    adapter: CodexA2AAdapterKind;
    turnId: string | null;
    consentRef: string | null;
} | {
    status: "blocked";
    adapter: CodexA2AAdapterKind | null;
    reason: CodexA2AFailureReason;
    message: string;
    fallbackToInbox: boolean;
};
type ConsentDriveReceipt = {
    receipt: {
        id: string;
    };
};
type ConsentDriveResponse = {
    response?: {
        result?: unknown;
    };
};
interface ConsentDriveTransport {
    connect(): Promise<unknown>;
    disconnect(): Promise<void>;
    createConsentReceipt(options: {
        conversationId: string;
        hostId?: string | null;
        ownerClientId?: string | null;
        allowedMethods?: readonly string[];
    }): ConsentDriveReceipt;
    startTurn(options: {
        conversationId: string;
        text: string;
        consentRef: string;
        hostId?: string | null;
        ownerClientId?: string | null;
        action?: string;
    }): Promise<ConsentDriveResponse>;
}
type ConsentDriveTransportFactory = (options: {
    commsDir?: string;
    hostId?: string | null;
}) => ConsentDriveTransport;
interface RemoteCodexRelayConfig {
    sshTarget: string;
    platformDir: string;
    commsDir?: string | null;
    nodeCommand?: string | null;
    helperPath?: string | null;
    hostAliases?: string[];
}
interface RemoteCodexRelayInput {
    config: RemoteCodexRelayConfig;
    target: CodexA2ATargetTuple;
    sender: CodexA2AMessageEnvelope["sender"];
    subject: string;
    content: string;
    fileName: string;
    text: string;
}
interface RemoteCodexRelayResult {
    turnId: string | null;
    consentRef: string | null;
}
type RemoteCodexRelayExecutor = (input: RemoteCodexRelayInput) => Promise<RemoteCodexRelayResult>;

export { prefersConsentDrive as A, type BuildCodexBindingRegistryOptions as B, type CodexA2AAdapterKind as C, resolveCodexBinding as D, type CodexBindingRuntimeHealth as E, type CodexBindingRuntimeHealthStatus as F, type RemoteCodexRelayConfig as R, type TapReceiveTransport as T, type CodexA2ADeliveryRequest as a, type CodexA2ADeliveryResult as b, type CodexA2AFailureReason as c, type CodexA2AMessageEnvelope as d, type CodexA2ATargetTuple as e, type CodexBinding as f, type CodexBindingAddress as g, type CodexBindingBlockReason as h, type CodexBindingHeartbeat as i, type CodexBindingRegistry as j, type CodexBindingSource as k, type CodexBindingStatus as l, type ConsentDriveReceipt as m, type ConsentDriveResponse as n, type ConsentDriveTransport as o, type ConsentDriveTransportFactory as p, type RemoteCodexRelayExecutor as q, type RemoteCodexRelayInput as r, type RemoteCodexRelayResult as s, type ResolveCodexBindingOptions as t, type ResolveCodexBindingResult as u, type ResolveCodexBindingTarget as v, buildCodexBindingRegistry as w, canUseConsentDriveForAddress as x, inferReceiveTransports as y, normalizeReceiveTransports as z };
