import { O as ObserveTransport, a as ObserveTransportSnapshot, b as ObserveTransportListener, T as TransportAddress } from './types-FWvKrFUt.mjs';

declare const DEFAULT_CODEX_IPC_WINDOWS_PIPE_PATH: string;
interface ResolveCodexIpcPathOptions {
    platform?: NodeJS.Platform;
    tmpDir?: string | null;
    uid?: number | null;
    env?: NodeJS.ProcessEnv;
}
declare function resolveCodexIpcPath(options?: ResolveCodexIpcPathOptions): string;
declare function isCodexIpcDefaultSupported(platform?: NodeJS.Platform): boolean;

type JsonRecord$1 = Record<string, unknown>;
type CodexIpcBroadcastMessage = {
    type: "broadcast";
    method?: string;
    sourceClientId?: string;
    version?: string | number;
    params?: JsonRecord$1;
};
type CodexIpcRequestMessage = {
    type: "request";
    requestId: string;
    sourceClientId?: string;
    version?: string | number;
    method: string;
    params?: JsonRecord$1;
    targetClientId?: string;
};
type CodexIpcResponseMessage = {
    type: "response";
    requestId?: string;
    resultType?: "success" | "error";
    method?: string;
    handledByClientId?: string;
    result?: unknown;
    error?: unknown;
};
type CodexIpcMessage = CodexIpcBroadcastMessage | CodexIpcRequestMessage | CodexIpcResponseMessage;
interface CodexIpcSocket {
    on(event: "connect", listener: () => void): this;
    on(event: "data", listener: (chunk: Buffer) => void): this;
    on(event: "error", listener: (error: Error) => void): this;
    on(event: "close", listener: (hadError?: boolean) => void): this;
    removeListener(event: "connect" | "data" | "error" | "close", listener: (...args: unknown[]) => void): this;
    write(chunk: Uint8Array | string): boolean;
    end(): void;
    destroy(error?: Error): void;
    setNoDelay?(noDelay?: boolean): void;
}
interface CodexIpcObserveTransportOptions {
    pipePath?: string;
    clientType?: string;
    protocolVersion?: string | number | null;
    hostId?: string | null;
    requestTimeoutMs?: number;
    socketFactory?: (pipePath: string) => CodexIpcSocket;
}
declare const DEFAULT_CODEX_IPC_PIPE_PATH: string;
declare function encodeCodexIpcFrame(message: CodexIpcMessage): Buffer;
declare function decodeCodexIpcFrames(buffer: Buffer): {
    messages: CodexIpcMessage[];
    remainder: Buffer;
};
declare class ExperimentalCodexIpcObserveTransport implements ObserveTransport {
    private readonly options;
    readonly kind: string;
    private readonly pipePath;
    private readonly hostId;
    private readonly clientType;
    private readonly requestTimeoutMs;
    private readonly listeners;
    private readonly agents;
    private readonly conversations;
    private readonly pendingRequests;
    private socket;
    private remainder;
    private connectedAt;
    private ownClientId;
    private snapshot;
    private readonly handleData;
    private readonly handleError;
    private readonly handleClose;
    constructor(options?: CodexIpcObserveTransportOptions);
    connect(): Promise<ObserveTransportSnapshot>;
    disconnect(): Promise<void>;
    getSnapshot(): ObserveTransportSnapshot;
    subscribe(listener: ObserveTransportListener): () => void;
    private attachSocket;
    private emitDisconnected;
    private detachSocket;
    private waitForConnect;
    protected getHostId(): string | null;
    protected getOwnClientId(): string | null;
    protected trace(message: string, context?: JsonRecord$1): void;
    private resolveRequestVersion;
    protected sendRequest(method: string, params?: JsonRecord$1, targetClientId?: string): Promise<CodexIpcResponseMessage>;
    private handleMessage;
    private handleResponse;
    private handleBroadcast;
    private upsertAgent;
    private buildSnapshot;
    private rejectPendingRequests;
    private emit;
}
declare function createExperimentalCodexIpcObserveTransport(options?: CodexIpcObserveTransportOptions): ObserveTransport;

type CapabilityScope = "observe" | "suggest" | "drive";
declare const CONSENT_RECEIPTS_DIRNAME = "tap-codex-a2a-consent";
declare const DEFAULT_CONSENT_TTL_SECONDS: number;
type ConsentReceiptErrorCode = "missing" | "expired" | "invalid" | "binding-mismatch" | "scope-mismatch" | "method-mismatch";
declare class ConsentReceiptError extends Error {
    readonly code: ConsentReceiptErrorCode;
    constructor(code: ConsentReceiptErrorCode, message: string);
}
interface ConsentReceipt {
    id: string;
    scope: CapabilityScope;
    hostId: string | null;
    conversationId: string;
    ownerClientId: string | null;
    issuedByClientId: string | null;
    allowedMethods: string[];
    pairTokenHash: string;
    createdAt: string;
    expiresAt: string;
}
interface CreateConsentReceiptOptions {
    receiptsDir?: string;
    secretsDir?: string;
    scope?: CapabilityScope;
    hostId?: string | null;
    conversationId: string;
    ownerClientId?: string | null;
    issuedByClientId?: string | null;
    ttlSeconds?: number;
    allowedMethods?: string[];
    now?: Date;
}
interface CreatedConsentReceipt {
    receipt: ConsentReceipt;
    filePath: string;
}
interface ConsumeConsentReceiptOptions {
    receiptsDir?: string;
    secretsDir?: string;
    consentRef?: string | null;
    requiredScope?: CapabilityScope;
    method?: string | null;
    hostId?: string | null;
    conversationId: string;
    ownerClientId?: string | null;
    reservationOwnerId?: string | null;
    now?: Date;
}
declare function createConsentReceipt(options: CreateConsentReceiptOptions): CreatedConsentReceipt;
declare function consumeConsentReceipt(options: ConsumeConsentReceiptOptions): ConsentReceipt;

type JsonRecord = Record<string, unknown>;
declare const CODEX_IPC_DRIVE_METHODS: readonly ["thread-follower-start-turn", "thread-follower-steer-turn", "thread-follower-interrupt-turn", "thread-follower-edit-last-user-turn", "thread-follower-submit-user-input", "thread-follower-submit-mcp-server-elicitation-response", "thread-follower-command-approval-decision", "thread-follower-file-approval-decision", "thread-follower-permissions-request-approval-response", "thread-follower-compact-thread", "thread-follower-set-model-and-reasoning", "thread-follower-set-collaboration-mode", "thread-follower-set-queued-follow-ups-state"];
type CodexIpcDriveMethod = (typeof CODEX_IPC_DRIVE_METHODS)[number];
interface CodexIpcSuggestionDraft {
    id: string;
    createdAt: string;
    status: "pending-owner-approval";
    scope: "suggest";
    method: CodexIpcDriveMethod;
    action: string;
    conversationId: string;
    payload: JsonRecord | null;
    sourceAddress: TransportAddress;
    targetAddress: TransportAddress;
    consentRef: string | null;
}
interface CodexIpcDriveActionResult {
    executedAt: string;
    scope: "drive";
    method: CodexIpcDriveMethod;
    action: string;
    conversationId: string;
    sourceAddress: TransportAddress;
    targetAddress: TransportAddress;
    consentRef: string;
    receipt: ConsentReceipt;
    response: CodexIpcResponseMessage;
}
interface CodexIpcDraftActionOptions {
    conversationId: string;
    method: CodexIpcDriveMethod;
    params?: JsonRecord;
    action?: string;
    consentRef?: string | null;
}
interface CodexIpcDriveActionOptions extends CodexIpcDraftActionOptions {
    hostId?: string | null;
    ownerClientId?: string | null;
}
interface CodexIpcStartTurnOptions {
    conversationId: string;
    text: string;
    turnStartParams?: JsonRecord;
    hostId?: string | null;
    ownerClientId?: string | null;
}
interface CodexIpcDriveStartTurnOptions extends CodexIpcStartTurnOptions {
    action?: string;
    consentRef?: string | null;
}
interface CodexIpcCreateConsentReceiptOptions {
    conversationId: string;
    scope?: CapabilityScope;
    ttlSeconds?: number;
    allowedMethods?: readonly string[];
    ownerClientId?: string | null;
    hostId?: string | null;
}
interface CodexIpcControlTransportOptions extends CodexIpcObserveTransportOptions {
    commsDir?: string;
    receiptsDir?: string;
    secretsDir?: string;
    defaultConsentTtlSeconds?: number;
    reservationOwnerId?: string | null;
}
declare function buildFollowerStartTurnParams(options: CodexIpcStartTurnOptions): JsonRecord;
declare class ExperimentalCodexIpcControlTransport extends ExperimentalCodexIpcObserveTransport {
    readonly kind = "experimental-codex-ipc-control";
    private readonly commsDir;
    private readonly receiptsDir;
    private readonly secretsDir;
    private readonly defaultConsentTtlSeconds;
    private readonly reservationOwnerId;
    private readonly conversationLocks;
    private readonly conversationLastDriveTime;
    private readonly COOLDOWN_MS;
    private readonly LOCK_TIMEOUT_MS;
    private readonly RECIPIENT_STATE_WAIT_MS;
    constructor(options?: CodexIpcControlTransportOptions);
    private acquireLock;
    private releaseLock;
    private getConversationSnapshot;
    private waitForConversationSnapshot;
    private assertRecipientCanStartTurn;
    createConsentReceipt(options: CodexIpcCreateConsentReceiptOptions): CreatedConsentReceipt;
    createStartTurnSuggestion(options: CodexIpcStartTurnOptions & {
        action?: string;
        consentRef?: string | null;
    }): CodexIpcSuggestionDraft;
    createSuggestion(options: CodexIpcDraftActionOptions): CodexIpcSuggestionDraft;
    startTurn(options: CodexIpcDriveStartTurnOptions): Promise<CodexIpcDriveActionResult>;
    driveAction(options: CodexIpcDriveActionOptions): Promise<CodexIpcDriveActionResult>;
    private resolveConversationTargetAddress;
    private buildSourceAddress;
}
declare function createExperimentalCodexIpcControlTransport(options?: CodexIpcControlTransportOptions): ExperimentalCodexIpcControlTransport;

export { consumeConsentReceipt as A, createConsentReceipt as B, type CapabilityScope as C, DEFAULT_CODEX_IPC_PIPE_PATH as D, ExperimentalCodexIpcControlTransport as E, createExperimentalCodexIpcControlTransport as F, createExperimentalCodexIpcObserveTransport as G, decodeCodexIpcFrames as H, encodeCodexIpcFrame as I, isCodexIpcDefaultSupported as J, resolveCodexIpcPath as K, type ResolveCodexIpcPathOptions as R, type CodexIpcObserveTransportOptions as a, CODEX_IPC_DRIVE_METHODS as b, CONSENT_RECEIPTS_DIRNAME as c, type CodexIpcBroadcastMessage as d, type CodexIpcControlTransportOptions as e, type CodexIpcCreateConsentReceiptOptions as f, type CodexIpcDraftActionOptions as g, type CodexIpcDriveActionOptions as h, type CodexIpcDriveActionResult as i, type CodexIpcDriveMethod as j, type CodexIpcDriveStartTurnOptions as k, type CodexIpcMessage as l, type CodexIpcRequestMessage as m, type CodexIpcResponseMessage as n, type CodexIpcSocket as o, type CodexIpcStartTurnOptions as p, type CodexIpcSuggestionDraft as q, type ConsentReceipt as r, ConsentReceiptError as s, type ConsumeConsentReceiptOptions as t, type CreateConsentReceiptOptions as u, type CreatedConsentReceipt as v, DEFAULT_CODEX_IPC_WINDOWS_PIPE_PATH as w, DEFAULT_CONSENT_TTL_SECONDS as x, ExperimentalCodexIpcObserveTransport as y, buildFollowerStartTurnParams as z };
