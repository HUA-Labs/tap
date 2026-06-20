import * as net from "node:net";
import { randomUUID } from "node:crypto";
import type {
  ObserveTransport,
  ObserveTransportAgent,
  ObserveTransportConversation,
  ObserveTransportEvent,
  ObserveTransportListener,
  ObserveTransportSnapshot,
  TransportAddress,
} from "../types.js";
import {
  DEFAULT_CODEX_IPC_WINDOWS_PIPE_PATH,
  resolveCodexIpcPath,
} from "./codex-ipc-endpoint.js";

type JsonRecord = Record<string, unknown>;

export type CodexIpcBroadcastMessage = {
  type: "broadcast";
  method?: string;
  sourceClientId?: string;
  version?: string | number;
  params?: JsonRecord;
};

export type CodexIpcRequestMessage = {
  type: "request";
  requestId: string;
  sourceClientId?: string;
  version?: string | number;
  method: string;
  params?: JsonRecord;
  targetClientId?: string;
};

export type CodexIpcResponseMessage = {
  type: "response";
  requestId?: string;
  resultType?: "success" | "error";
  method?: string;
  handledByClientId?: string;
  result?: unknown;
  error?: unknown;
};

export type CodexIpcMessage =
  | CodexIpcBroadcastMessage
  | CodexIpcRequestMessage
  | CodexIpcResponseMessage;

export interface CodexIpcSocket {
  on(event: "connect", listener: () => void): this;
  on(event: "data", listener: (chunk: Buffer) => void): this;
  on(event: "error", listener: (error: Error) => void): this;
  on(event: "close", listener: (hadError?: boolean) => void): this;
  removeListener(
    event: "connect" | "data" | "error" | "close",
    listener: (...args: unknown[]) => void,
  ): this;
  write(chunk: Uint8Array | string): boolean;
  end(): void;
  destroy(error?: Error): void;
  setNoDelay?(noDelay?: boolean): void;
}

export interface CodexIpcObserveTransportOptions {
  pipePath?: string;
  clientType?: string;
  protocolVersion?: string | number | null;
  hostId?: string | null;
  requestTimeoutMs?: number;
  socketFactory?: (pipePath: string) => CodexIpcSocket;
}

type PendingRequest = {
  resolve: (message: CodexIpcResponseMessage) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
};

const MAX_FRAME_BYTES = 256 * 1024 * 1024;
const DEFAULT_REQUEST_TIMEOUT_MS = 5_000;
const DEFAULT_TARGETED_REQUEST_VERSION = 1;

export const DEFAULT_CODEX_IPC_PIPE_PATH = DEFAULT_CODEX_IPC_WINDOWS_PIPE_PATH;

function isTapIpcTraceEnabled(): boolean {
  const value = process.env.TAP_IPC_TRACE?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

function formatTraceValue(value: unknown): string {
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return String(value);
  }
  if (value === null) {
    return "null";
  }
  return JSON.stringify(value);
}

function formatTraceContext(context?: JsonRecord): string {
  if (!context) return "";
  const entries = Object.entries(context).filter(
    ([, value]) => typeof value !== "undefined",
  );
  if (entries.length === 0) return "";
  return ` ${entries
    .map(([key, value]) => `${key}=${formatTraceValue(value)}`)
    .join(" ")}`;
}

function resolveHostId(explicitHostId?: string | null): string | null {
  const normalizedExplicit = explicitHostId?.trim();
  if (normalizedExplicit) return normalizedExplicit;

  const computerName = process.env.COMPUTERNAME?.trim();
  if (computerName) return computerName;

  const hostName = process.env.HOSTNAME?.trim();
  if (hostName) return hostName;

  return null;
}

function asRecord(value: unknown): JsonRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as JsonRecord;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function getStringField(
  record: JsonRecord | null,
  ...keys: string[]
): string | null {
  if (!record) return null;
  for (const key of keys) {
    const value = asString(record[key]);
    if (value) return value;
  }
  return null;
}

function normalizeTransportAddress(
  hostId: string | null,
  clientId: string | null,
  conversationId: string | null,
  ownerClientId: string | null,
): TransportAddress {
  return {
    hostId,
    clientId,
    conversationId,
    ownerClientId,
  };
}

function extractConversationId(params: JsonRecord | null): string | null {
  return (
    getStringField(params, "conversationId", "threadId") ??
    getStringField(asRecord(params?.change), "conversationId", "threadId") ??
    getStringField(asRecord(params?.thread), "id")
  );
}

function listRecordKeys(value: JsonRecord | null | undefined): string[] | null {
  if (!value) return null;
  return Object.keys(value);
}

export function encodeCodexIpcFrame(message: CodexIpcMessage): Buffer {
  const json = JSON.stringify(message);
  const payload = Buffer.from(json, "utf-8");
  const frame = Buffer.allocUnsafe(4 + payload.length);
  frame.writeUInt32LE(payload.length, 0);
  payload.copy(frame, 4);
  return frame;
}

export function decodeCodexIpcFrames(buffer: Buffer): {
  messages: CodexIpcMessage[];
  remainder: Buffer;
} {
  const messages: CodexIpcMessage[] = [];
  let offset = 0;

  while (offset + 4 <= buffer.length) {
    const frameLength = buffer.readUInt32LE(offset);
    if (frameLength > MAX_FRAME_BYTES) {
      throw new Error(
        `Codex IPC frame exceeds max size (${frameLength} bytes > ${MAX_FRAME_BYTES})`,
      );
    }
    if (offset + 4 + frameLength > buffer.length) break;

    const json = buffer.toString("utf-8", offset + 4, offset + 4 + frameLength);
    messages.push(JSON.parse(json) as CodexIpcMessage);
    offset += 4 + frameLength;
  }

  return {
    messages,
    remainder: buffer.subarray(offset),
  };
}

export class ExperimentalCodexIpcObserveTransport implements ObserveTransport {
  readonly kind: string = "experimental-codex-ipc-observe";

  private readonly pipePath: string;
  private readonly hostId: string | null;
  private readonly clientType: string;
  private readonly requestTimeoutMs: number;
  private readonly listeners = new Set<ObserveTransportListener>();
  private readonly agents = new Map<string, ObserveTransportAgent>();
  private readonly conversations = new Map<
    string,
    ObserveTransportConversation
  >();
  private readonly pendingRequests = new Map<string, PendingRequest>();
  private socket: CodexIpcSocket | null = null;
  private remainder: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  private connectedAt: string | null = null;
  private ownClientId: string | null = null;
  private snapshot: ObserveTransportSnapshot = {
    transport: this.kind,
    connected: false,
    connectedAt: null,
    agents: [],
    conversations: [],
  };

  private readonly handleData = (...args: unknown[]) => {
    const [chunk] = args;
    if (!Buffer.isBuffer(chunk)) {
      return;
    }
    this.remainder = Buffer.concat([this.remainder, chunk]);
    const decoded = decodeCodexIpcFrames(this.remainder);
    this.remainder = decoded.remainder;
    for (const message of decoded.messages) {
      this.handleMessage(message);
    }
  };

  private readonly handleError = (...args: unknown[]) => {
    const [error] = args;
    this.rejectPendingRequests(
      error instanceof Error
        ? error
        : new Error(String(error ?? "Codex IPC transport error")),
    );
  };

  private readonly handleClose = () => {
    this.rejectPendingRequests(new Error("Codex IPC transport closed"));
    this.remainder = Buffer.alloc(0);
    this.emitDisconnected(null);
    this.detachSocket();
  };

  constructor(private readonly options: CodexIpcObserveTransportOptions = {}) {
    this.pipePath = options.pipePath ?? resolveCodexIpcPath();
    this.hostId = resolveHostId(options.hostId);
    this.clientType = options.clientType ?? "tap-observe";
    this.requestTimeoutMs =
      options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  }

  async connect(): Promise<ObserveTransportSnapshot> {
    if (this.socket) {
      await this.disconnect();
    }

    this.trace("connect:start", {
      pipePath: this.pipePath,
      clientType: this.clientType,
      hostId: this.hostId,
    });
    const socket =
      this.options.socketFactory?.(this.pipePath) ??
      (net.createConnection({
        path: this.pipePath,
      }) as unknown as CodexIpcSocket);
    this.socket = socket;
    this.attachSocket(socket);
    await this.waitForConnect(socket);
    socket.setNoDelay?.(true);
    this.trace("connect:open", {
      pipePath: this.pipePath,
    });

    const response = await this.sendRequest("initialize", {
      clientType: this.clientType,
    });
    const result = asRecord(response.result);
    const clientId = getStringField(result, "clientId");
    if (!clientId) {
      throw new Error("Codex IPC initialize response did not include clientId");
    }

    this.ownClientId = clientId;
    this.connectedAt = new Date().toISOString();
    this.snapshot = this.buildSnapshot(true);
    this.trace("connect:initialized", {
      clientId,
      connectedAt: this.connectedAt,
      handledByClientId: response.handledByClientId ?? null,
      resultType: response.resultType ?? null,
      resultKeys: listRecordKeys(result),
    });
    this.emit({
      kind: "transport-connected",
      receivedAt: this.connectedAt,
      method: "initialize",
      sourceAddress: normalizeTransportAddress(
        this.hostId,
        this.ownClientId,
        null,
        null,
      ),
      payload: response,
      snapshot: this.snapshot,
    });

    return this.snapshot;
  }

  async disconnect(): Promise<void> {
    if (!this.socket) return;
    const socket = this.socket;
    this.detachSocket();
    this.rejectPendingRequests(new Error("Codex IPC transport disconnected"));
    this.remainder = Buffer.alloc(0);
    this.emitDisconnected({ reason: "disconnect" });
    socket.end();
    socket.destroy();
  }

  getSnapshot(): ObserveTransportSnapshot {
    return this.snapshot;
  }

  subscribe(listener: ObserveTransportListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private attachSocket(socket: CodexIpcSocket): void {
    socket.on("data", this.handleData);
    socket.on("error", this.handleError);
    socket.on("close", this.handleClose);
  }

  private emitDisconnected(payload: unknown): void {
    const receivedAt = new Date().toISOString();
    this.connectedAt = null;
    this.snapshot = this.buildSnapshot(false);
    this.emit({
      kind: "transport-disconnected",
      receivedAt,
      method: null,
      sourceAddress: normalizeTransportAddress(
        this.hostId,
        this.ownClientId,
        null,
        null,
      ),
      payload,
      snapshot: this.snapshot,
    });
  }

  private detachSocket(): void {
    if (!this.socket) return;
    this.socket.removeListener("data", this.handleData);
    this.socket.removeListener("error", this.handleError);
    this.socket.removeListener("close", this.handleClose);
    this.socket = null;
  }

  private async waitForConnect(socket: CodexIpcSocket): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timeout);
        socket.removeListener("connect", onConnect);
        socket.removeListener("error", onError);
      };

      const onConnect = () => {
        cleanup();
        resolve();
      };
      const onError = (...args: unknown[]) => {
        const [error] = args;
        cleanup();
        reject(
          error instanceof Error
            ? error
            : new Error(String(error ?? "Codex IPC connection failed")),
        );
      };

      const timeout = setTimeout(() => {
        cleanup();
        reject(
          new Error(
            `Timed out connecting to Codex IPC transport at ${this.pipePath}`,
          ),
        );
      }, this.requestTimeoutMs);

      socket.on("connect", onConnect);
      socket.on("error", onError);
    });
  }

  protected getHostId(): string | null {
    return this.hostId;
  }

  protected getOwnClientId(): string | null {
    return this.ownClientId;
  }

  protected trace(message: string, context?: JsonRecord): void {
    if (!isTapIpcTraceEnabled()) {
      return;
    }
    const timestamp = new Date()
      .toISOString()
      .replace("T", " ")
      .replace("Z", " UTC");
    console.log(
      `[${timestamp}] TAP_IPC_TRACE [${this.kind}] ${message}${formatTraceContext(context)}`,
    );
  }

  private resolveRequestVersion(
    _method: string,
    targetClientId?: string,
  ): string | number | null {
    if (this.options.protocolVersion !== null) {
      const configuredVersion = this.options.protocolVersion;
      if (typeof configuredVersion !== "undefined") {
        return configuredVersion;
      }
    }
    // Live Codex Desktop requires v1 envelopes for targeted follower-control
    // requests. Raw Gen 41 PoC succeeds with version=1 and fails with
    // "no-client-found" when omitted.
    if (targetClientId?.trim()) {
      return DEFAULT_TARGETED_REQUEST_VERSION;
    }
    return null;
  }

  protected async sendRequest(
    method: string,
    params?: JsonRecord,
    targetClientId?: string,
  ): Promise<CodexIpcResponseMessage> {
    if (!this.socket) {
      throw new Error("Codex IPC observe transport is not connected");
    }

    const requestId = randomUUID();
    const message: CodexIpcRequestMessage = {
      type: "request",
      requestId,
      method,
      params,
    };
    if (this.ownClientId) {
      message.sourceClientId = this.ownClientId;
    }
    const requestVersion = this.resolveRequestVersion(method, targetClientId);
    if (requestVersion !== null) {
      message.version = requestVersion;
    }
    if (targetClientId) {
      message.targetClientId = targetClientId;
    }
    this.trace("request:send", {
      requestId,
      method,
      targetClientId: targetClientId ?? null,
      version: message.version ?? null,
      conversationId: extractConversationId(params ?? null),
      paramKeys: listRecordKeys(params ?? null),
    });

    const promise = new Promise<CodexIpcResponseMessage>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(
          new Error(
            `Codex IPC request "${method}" timed out after ${this.requestTimeoutMs}ms`,
          ),
        );
      }, this.requestTimeoutMs);

      this.pendingRequests.set(requestId, { resolve, reject, timeout });
    });

    this.socket.write(encodeCodexIpcFrame(message));
    return promise;
  }

  private handleMessage(message: CodexIpcMessage): void {
    if (message.type === "response") {
      this.handleResponse(message);
      return;
    }

    if (message.type === "broadcast") {
      this.handleBroadcast(message);
    }
  }

  private handleResponse(message: CodexIpcResponseMessage): void {
    const requestId = asString(message.requestId);
    if (!requestId) return;

    const pending = this.pendingRequests.get(requestId);
    if (!pending) return;

    clearTimeout(pending.timeout);
    this.pendingRequests.delete(requestId);
    this.trace("response:recv", {
      requestId,
      method: message.method ?? null,
      resultType: message.resultType ?? null,
      handledByClientId: message.handledByClientId ?? null,
      hasError: message.error != null,
      hasResult: typeof message.result !== "undefined",
    });

    if (message.resultType === "error") {
      pending.reject(
        new Error(
          `Codex IPC request failed: ${JSON.stringify(message.error ?? {})}`,
        ),
      );
      return;
    }

    pending.resolve(message);
  }

  private handleBroadcast(message: CodexIpcBroadcastMessage): void {
    const method = message.method ?? null;
    const params = asRecord(message.params);
    const sourceClientId = asString(message.sourceClientId);
    const receivedAt = new Date().toISOString();
    this.trace("broadcast:recv", {
      method,
      sourceClientId,
      conversationId: extractConversationId(params),
      version: message.version ?? null,
    });

    if (method === "client-status-changed") {
      const clientId = getStringField(params, "clientId");
      if (clientId) {
        this.upsertAgent(clientId, {
          name: getStringField(params, "clientType"),
          metadata: {
            status: getStringField(params, "status"),
            clientType: getStringField(params, "clientType"),
          },
        });
        this.snapshot = this.buildSnapshot(true);
        this.emit({
          kind: "agent-status",
          receivedAt,
          method,
          sourceAddress: normalizeTransportAddress(
            this.hostId,
            clientId,
            null,
            null,
          ),
          payload: message,
          snapshot: this.snapshot,
        });
      }
      return;
    }

    if (method === "thread-stream-state-changed") {
      const conversationId = extractConversationId(params);
      if (conversationId) {
        const ownerClientId = sourceClientId;
        if (ownerClientId) {
          this.upsertAgent(ownerClientId, {
            name: null,
            metadata: {},
          });
        }
        this.conversations.set(conversationId, {
          id: conversationId,
          address: normalizeTransportAddress(
            this.hostId,
            ownerClientId,
            conversationId,
            ownerClientId,
          ),
          metadata: {
            change: params?.change ?? null,
            lastMethod: method,
            sourceClientId: ownerClientId,
          },
        });
        this.snapshot = this.buildSnapshot(true);
        this.emit({
          kind: "conversation-state",
          receivedAt,
          method,
          sourceAddress: normalizeTransportAddress(
            this.hostId,
            ownerClientId,
            conversationId,
            ownerClientId,
          ),
          payload: message,
          snapshot: this.snapshot,
        });
        return;
      }
    }

    this.snapshot = this.buildSnapshot(true);
    this.emit({
      kind: "raw",
      receivedAt,
      method,
      sourceAddress: normalizeTransportAddress(
        this.hostId,
        sourceClientId,
        extractConversationId(params),
        sourceClientId,
      ),
      payload: message,
      snapshot: this.snapshot,
    });
  }

  private upsertAgent(
    clientId: string,
    update: {
      name: string | null;
      metadata: Record<string, unknown>;
    },
  ): void {
    const existing = this.agents.get(clientId);
    this.agents.set(clientId, {
      id: clientId,
      name: update.name ?? existing?.name ?? null,
      address: normalizeTransportAddress(this.hostId, clientId, null, null),
      metadata: {
        ...(existing?.metadata ?? {}),
        ...update.metadata,
      },
    });
  }

  private buildSnapshot(connected: boolean): ObserveTransportSnapshot {
    return {
      transport: this.kind,
      connected,
      connectedAt: connected ? this.connectedAt : null,
      agents: [...this.agents.values()].sort((a, b) =>
        a.id.localeCompare(b.id),
      ),
      conversations: [...this.conversations.values()].sort((a, b) =>
        a.id.localeCompare(b.id),
      ),
    };
  }

  private rejectPendingRequests(error: Error): void {
    for (const [requestId, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(error);
      this.pendingRequests.delete(requestId);
    }
  }

  private emit(event: ObserveTransportEvent): void {
    for (const listener of this.listeners) {
      void listener(event);
    }
  }
}

export function createExperimentalCodexIpcObserveTransport(
  options: CodexIpcObserveTransportOptions = {},
): ObserveTransport {
  return new ExperimentalCodexIpcObserveTransport(options);
}
