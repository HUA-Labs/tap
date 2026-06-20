export type CodexA2AAdapterKind =
  | "ipc-direct"
  | "ssh-ipc-relay"
  | "app-server-auth"
  | "official-remote";

export type CodexA2AFailureReason =
  | "missing-target"
  | "not-found"
  | "partial"
  | "stale"
  | "ambiguous"
  | "not-reachable"
  | "binding-mismatch"
  | "transport-unavailable"
  | "transport-error"
  | "recipient-active-turn"
  | "dry-run";

export interface CodexA2ATargetTuple {
  routingAddress: string;
  hostId: string | null;
  conversationId: string;
  ownerClientId: string;
}

export interface CodexA2AMessageEnvelope {
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

export interface CodexA2ADeliveryRequest {
  adapter: CodexA2AAdapterKind;
  target: CodexA2ATargetTuple;
  message: CodexA2AMessageEnvelope;
  dryRun?: boolean;
}

export type CodexA2ADeliveryResult =
  | {
      status: "delivered";
      adapter: CodexA2AAdapterKind;
      turnId: string | null;
      consentRef: string | null;
    }
  | {
      status: "blocked";
      adapter: CodexA2AAdapterKind | null;
      reason: CodexA2AFailureReason;
      message: string;
      fallbackToInbox: boolean;
    };

export type ConsentDriveReceipt = {
  receipt: {
    id: string;
  };
};

export type ConsentDriveResponse = {
  response?: {
    result?: unknown;
  };
};

export interface ConsentDriveTransport {
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

export type ConsentDriveTransportFactory = (options: {
  commsDir?: string;
  hostId?: string | null;
}) => ConsentDriveTransport;

export interface RemoteCodexRelayConfig {
  sshTarget: string;
  platformDir: string;
  commsDir?: string | null;
  nodeCommand?: string | null;
  helperPath?: string | null;
  hostAliases?: string[];
}

export interface RemoteCodexRelayInput {
  config: RemoteCodexRelayConfig;
  target: CodexA2ATargetTuple;
  sender: CodexA2AMessageEnvelope["sender"];
  subject: string;
  content: string;
  fileName: string;
  text: string;
}

export interface RemoteCodexRelayResult {
  turnId: string | null;
  consentRef: string | null;
}

export type RemoteCodexRelayExecutor = (
  input: RemoteCodexRelayInput,
) => Promise<RemoteCodexRelayResult>;
