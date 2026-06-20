interface TransportAddress {
    hostId: string | null;
    clientId: string | null;
    conversationId: string | null;
    ownerClientId: string | null;
}
interface ObserveTransportAgent {
    id: string;
    name: string | null;
    address: TransportAddress;
    metadata: Record<string, unknown>;
}
interface ObserveTransportConversation {
    id: string;
    address: TransportAddress;
    metadata: Record<string, unknown>;
}
interface ObserveTransportSnapshot {
    transport: string;
    connected: boolean;
    connectedAt: string | null;
    agents: ObserveTransportAgent[];
    conversations: ObserveTransportConversation[];
}
type ObserveTransportEventKind = "transport-connected" | "transport-disconnected" | "agent-status" | "conversation-state" | "raw";
interface ObserveTransportEvent {
    kind: ObserveTransportEventKind;
    receivedAt: string;
    method: string | null;
    sourceAddress: TransportAddress;
    payload: unknown;
    snapshot: ObserveTransportSnapshot;
}
type ObserveTransportListener = (event: ObserveTransportEvent) => void | Promise<void>;
interface ObserveTransport {
    readonly kind: string;
    connect(): Promise<ObserveTransportSnapshot>;
    disconnect(): Promise<void>;
    getSnapshot(): ObserveTransportSnapshot;
    subscribe(listener: ObserveTransportListener): () => void;
}

export type { ObserveTransport as O, TransportAddress as T, ObserveTransportSnapshot as a, ObserveTransportListener as b, ObserveTransportAgent as c, ObserveTransportConversation as d, ObserveTransportEvent as e, ObserveTransportEventKind as f };
