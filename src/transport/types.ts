export interface TransportAddress {
  hostId: string | null;
  clientId: string | null;
  conversationId: string | null;
  ownerClientId: string | null;
}

export interface ObserveTransportAgent {
  id: string;
  name: string | null;
  address: TransportAddress;
  metadata: Record<string, unknown>;
}

export interface ObserveTransportConversation {
  id: string;
  address: TransportAddress;
  metadata: Record<string, unknown>;
}

export interface ObserveTransportSnapshot {
  transport: string;
  connected: boolean;
  connectedAt: string | null;
  agents: ObserveTransportAgent[];
  conversations: ObserveTransportConversation[];
}

export type ObserveTransportEventKind =
  | "transport-connected"
  | "transport-disconnected"
  | "agent-status"
  | "conversation-state"
  | "raw";

export interface ObserveTransportEvent {
  kind: ObserveTransportEventKind;
  receivedAt: string;
  method: string | null;
  sourceAddress: TransportAddress;
  payload: unknown;
  snapshot: ObserveTransportSnapshot;
}

export type ObserveTransportListener = (
  event: ObserveTransportEvent,
) => void | Promise<void>;

export interface ObserveTransport {
  readonly kind: string;
  connect(): Promise<ObserveTransportSnapshot>;
  disconnect(): Promise<void>;
  getSnapshot(): ObserveTransportSnapshot;
  subscribe(listener: ObserveTransportListener): () => void;
}
