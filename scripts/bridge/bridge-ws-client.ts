// bridge-ws-client.ts — AppServerClient class (WebSocket + JSON-RPC + thread/turn state)

import {
  AUTH_SUBPROTOCOL_PREFIX,
  type JsonRpcResponse,
  type LoadedThreadCandidate,
  type RequestRecord,
  type ThreadStateRecord,
} from "./bridge-types.ts";
import type { BridgeLogger } from "./bridge-logging.ts";
import { sanitizeErrorForPersistence } from "./bridge-dispatch.ts";
import {
  chooseLoadedThreadForCwd,
  isTurnStale,
  isTurnStuckOnApproval,
  isWaitingApprovalStatus,
  normalizePersistedThreadCwd,
  threadCwdMatches,
} from "./bridge-routing.ts";
import {
  buildAutoElicitationResult,
  isAutoElicitationRequestMethod,
} from "./bridge-elicitation.ts";

export async function readSocketData(data: unknown): Promise<string> {
  if (typeof data === "string") {
    return data;
  }

  if (data instanceof ArrayBuffer) {
    return Buffer.from(data).toString("utf8");
  }

  if (ArrayBuffer.isView(data)) {
    return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString(
      "utf8",
    );
  }

  if (typeof Blob !== "undefined" && data instanceof Blob) {
    return await data.text();
  }

  return String(data);
}

export function formatJsonRpcError(error: JsonRpcResponse["error"]): string {
  if (!error) {
    return "Unknown App Server error";
  }

  return JSON.stringify(
    {
      code: error.code,
      message: error.message,
      data: error.data,
    },
    null,
    2,
  );
}

export const DEFAULT_APP_SERVER_REQUEST_TIMEOUT_MS = 30_000;

let nextAppServerClientId = 1;

type PendingRequest = {
  resolve: (value: any) => void;
  reject: (reason?: unknown) => void;
  method: string;
  timeout: ReturnType<typeof setTimeout> | null;
};

type SocketListeners = {
  open: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  close: (...args: unknown[]) => void;
  message: (...args: unknown[]) => void;
};

function getProcessRssMb(): number {
  return Math.round(process.memoryUsage().rss / (1024 * 1024));
}

export class AppServerClient {
  private socket: WebSocket | null = null;
  private readonly url: string;
  private readonly gatewayToken: string | null;
  private readonly logger: BridgeLogger;
  private readonly clientId = nextAppServerClientId++;
  private nextId = 1;
  private readonly requestTimeoutMs: number;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly socketListeners = new Map<WebSocket, SocketListeners>();

  connected = false;
  initialized = false;
  threadId: string | null = null;
  currentThreadCwd: string | null = null;
  activeTurnId: string | null = null;
  turnStartedAt: string | null = null;
  lastTurnStatus: string | null = null;
  lastNotificationMethod: string | null = null;
  lastNotificationAt: string | null = null;
  lastError: string | null = null;
  lastSuccessfulAppServerAt: string | null = null;
  lastSuccessfulAppServerMethod: string | null = null;

  constructor(
    url: string,
    logger: BridgeLogger,
    gatewayToken?: string | null,
    requestTimeoutMs = DEFAULT_APP_SERVER_REQUEST_TIMEOUT_MS,
  ) {
    this.url = url;
    this.logger = logger;
    this.gatewayToken = gatewayToken ?? null;
    this.requestTimeoutMs = requestTimeoutMs;
  }

  getPendingRequestCount(): number {
    return this.pending.size;
  }

  async connect(): Promise<void> {
    if (this.connected && this.socket?.readyState === WebSocket.OPEN) {
      return;
    }

    // M175: Warn when connecting without auth — unauthenticated connections
    // allow any local process to control the app-server session.
    if (!this.gatewayToken) {
      this.logger.warn(
        "connecting without auth token — app-server session is unprotected. " +
          "Use --gateway-token-file or TAP_GATEWAY_TOKEN_FILE to enable auth.",
        { url: this.url },
      );
    }

    // Authenticate via WebSocket subprotocol instead of URL query param.
    // Token stays out of URLs (no log/referer/history leakage).
    const wsOptions: { protocols?: string[] } = {};
    if (this.gatewayToken) {
      wsOptions.protocols = [`${AUTH_SUBPROTOCOL_PREFIX}${this.gatewayToken}`];
    }
    this.socket = new WebSocket(this.url, wsOptions);
    const socket = this.socket;
    if (!socket) {
      throw new Error(`Failed to create App Server socket for ${this.url}`);
    }

    await new Promise<void>((resolvePromise, rejectPromise) => {
      let settled = false;

      const resolveOnce = () => {
        if (settled) {
          return;
        }
        settled = true;
        resolvePromise();
      };

      const rejectOnce = (error: Error) => {
        if (settled) {
          return;
        }
        settled = true;
        rejectPromise(error);
      };

      const listeners: SocketListeners = {
        open: () => {
          this.connected = true;
          this.logger.info(
            "connected to app-server",
            this.buildMetricsContext({
              url: this.url,
              authenticated: Boolean(this.gatewayToken),
            }),
          );
          resolveOnce();
        },
        error: () => {
          const error = new Error(
            `Failed to connect to App Server at ${this.url}`,
          );
          this.lastError = sanitizeErrorForPersistence(error.message);
          this.logger.error(
            "failed to connect to app-server",
            this.buildMetricsContext({
              url: this.url,
              error: this.lastError,
            }),
          );
          rejectOnce(error);
        },
        close: () => {
          this.connected = false;
          this.initialized = false;
          this.activeTurnId = null;
          this.turnStartedAt = null;
          this.detachSocketListeners(socket);
          if (this.socket === socket) {
            this.socket = null;
          }
          this.logger.warn(
            "disconnected from app-server",
            this.buildMetricsContext({
              url: this.url,
            }),
          );
          this.rejectPending(new Error("App Server connection closed"));
        },
        message: (event: unknown) => {
          const socketEvent = event as { data: unknown };
          void this.handleMessage(socketEvent.data);
        },
      };

      this.socketListeners.set(socket, listeners);
      socket.addEventListener("open", listeners.open, { once: true });
      socket.addEventListener("error", listeners.error);
      socket.addEventListener("close", listeners.close);
      socket.addEventListener("message", listeners.message);
    });

    await this.request("initialize", {
      clientInfo: {
        name: "tap-app-server-bridge",
        title: "tap app-server bridge",
        version: "0.1.0",
      },
      capabilities: {
        experimentalApi: false,
      },
    });
    this.initialized = true;
  }

  async disconnect(): Promise<void> {
    const socket = this.socket;
    if (!socket) {
      return;
    }

    this.detachSocketListeners(socket);
    this.socket = null;
    this.connected = false;
    this.initialized = false;
    this.activeTurnId = null;
    this.turnStartedAt = null;
    this.rejectPending(new Error("App Server connection disconnected"));
    socket.close();
  }

  async ensureThread(
    explicitThreadId: string | null,
    savedThread: ThreadStateRecord | null,
    cwd: string,
    ephemeral: boolean,
  ): Promise<string> {
    if (explicitThreadId) {
      try {
        const resumeResponse = await this.request("thread/resume", {
          threadId: explicitThreadId,
          persistExtendedHistory: false,
        });
        const resumedThreadId = resumeResponse?.thread?.id ?? explicitThreadId;
        await this.refreshThreadState(resumedThreadId);
        this.logger.info("resumed explicit thread", {
          clientId: this.clientId,
          threadId: resumedThreadId,
          activeTurnId: this.activeTurnId,
        });
        return resumedThreadId;
      } catch (error) {
        this.logger.warn(
          "explicit thread resume failed; starting fresh thread",
          {
            clientId: this.clientId,
            threadId: explicitThreadId,
            error: sanitizeErrorForPersistence(String(error)),
          },
        );
      }
    }

    if (savedThread?.threadId) {
      if (savedThread.cwd && !threadCwdMatches(cwd, savedThread.cwd)) {
        this.logger.warn("saved thread cwd mismatch; skipping saved thread", {
          clientId: this.clientId,
          threadId: savedThread.threadId,
          savedCwd: savedThread.cwd,
          expectedCwd: cwd,
        });
      } else {
        try {
          const resumeResponse = await this.request("thread/resume", {
            threadId: savedThread.threadId,
            persistExtendedHistory: false,
          });
          const resumedThreadId =
            resumeResponse?.thread?.id ?? savedThread.threadId;
          await this.refreshThreadState(resumedThreadId);
          if (this.isWaitingOnApproval()) {
            this.logger.warn(
              "saved thread is waiting on approval; starting fresh thread",
              {
                clientId: this.clientId,
                threadId: resumedThreadId,
              },
            );
            this.threadId = null;
            this.currentThreadCwd = null;
            this.activeTurnId = null;
            this.turnStartedAt = null;
            this.lastTurnStatus = null;
          } else if (!threadCwdMatches(cwd, this.currentThreadCwd)) {
            this.logger.warn("saved thread resumed with mismatched cwd", {
              clientId: this.clientId,
              threadId: resumedThreadId,
              expectedCwd: cwd,
              actualCwd: this.currentThreadCwd ?? "unknown",
            });
            this.threadId = null;
            this.currentThreadCwd = null;
            this.activeTurnId = null;
            this.turnStartedAt = null;
            this.lastTurnStatus = null;
          } else {
            this.logger.info("resumed saved thread", {
              clientId: this.clientId,
              threadId: resumedThreadId,
              activeTurnId: this.activeTurnId,
            });
            return resumedThreadId;
          }
        } catch (error) {
          this.logger.warn(
            "saved thread resume failed; starting fresh thread",
            {
              clientId: this.clientId,
              threadId: savedThread.threadId,
              error: sanitizeErrorForPersistence(String(error)),
            },
          );
        }
      }
    }

    const loadedThreadId = await this.findLoadedThread(cwd);
    if (loadedThreadId) {
      return loadedThreadId;
    }

    const startResponse = await this.request("thread/start", {
      cwd,
      ephemeral,
      experimentalRawEvents: false,
      persistExtendedHistory: false,
    });

    const startedThreadId = startResponse?.thread?.id;
    if (!startedThreadId) {
      throw new Error("thread/start did not return a thread id");
    }

    this.syncThreadStateFromThread(startResponse?.thread);
    this.threadId = startedThreadId;
    this.currentThreadCwd =
      this.currentThreadCwd ?? normalizePersistedThreadCwd(cwd);
    this.activeTurnId = null;
    this.lastTurnStatus = null;
    this.logger.info("started thread", {
      clientId: this.clientId,
      threadId: startedThreadId,
      cwd: this.currentThreadCwd,
      ephemeral,
    });
    return startedThreadId;
  }

  async findLoadedThread(cwd: string): Promise<string | null> {
    const response = await this.request("thread/loaded/list", {
      limit: 20,
    });
    const threadIds = Array.isArray(response?.data)
      ? response.data.filter(
          (value: unknown): value is string => typeof value === "string",
        )
      : [];

    if (threadIds.length === 0) {
      return null;
    }

    const threads: LoadedThreadCandidate[] = [];

    for (const threadId of threadIds) {
      try {
        const threadResponse = await this.request("thread/read", {
          threadId,
          includeTurns: true,
        });
        const thread = threadResponse?.thread;
        if (!thread?.id) {
          continue;
        }
        threads.push({
          id: thread.id,
          cwd: typeof thread.cwd === "string" ? thread.cwd : "",
          updatedAt:
            typeof thread.updatedAt === "number" ? thread.updatedAt : 0,
          statusType: thread.status?.type ?? null,
          thread,
        });
      } catch {
        continue;
      }
    }

    const chosen = chooseLoadedThreadForCwd(cwd, threads);
    if (!chosen) {
      if (threads.length > 0) {
        this.logger.debug("loaded threads exist but none match cwd", {
          clientId: this.clientId,
          cwd,
          loadedThreadCount: threads.length,
        });
      }
      return null;
    }
    this.syncThreadStateFromThread(chosen.thread);
    this.logger.info("attached to loaded thread", {
      clientId: this.clientId,
      threadId: chosen.id,
      activeTurnId: this.activeTurnId,
      cwd: chosen.cwd,
    });
    return chosen.id;
  }

  async startTurn(inputText: string): Promise<string | null> {
    const threadId = this.requireThreadId();
    const response = await this.request("turn/start", {
      threadId,
      input: [
        {
          type: "text",
          text: inputText,
          text_elements: [],
        },
      ],
    });

    const turnId = response?.turn?.id ?? null;
    if (turnId) {
      this.activeTurnId = turnId;
      this.turnStartedAt = new Date().toISOString();
    }
    return turnId;
  }

  async steerTurn(inputText: string): Promise<string> {
    const threadId = this.requireThreadId();
    const turnId = this.requireActiveTurnId();

    await this.request("turn/steer", {
      threadId,
      expectedTurnId: turnId,
      input: [
        {
          type: "text",
          text: inputText,
          text_elements: [],
        },
      ],
    });

    return turnId;
  }

  isBusy(): boolean {
    if (!this.activeTurnId) return false;
    if (isTurnStale(this.turnStartedAt)) {
      this.logger.warn("active turn is stale; treating bridge as idle", {
        clientId: this.clientId,
        turnId: this.activeTurnId,
        turnStartedAt: this.turnStartedAt,
      });
      this.activeTurnId = null;
      this.turnStartedAt = null;
      return false;
    }
    return true;
  }

  isWaitingOnApproval(): boolean {
    return isWaitingApprovalStatus(this.lastTurnStatus);
  }

  async refreshCurrentThreadState(): Promise<void> {
    if (!this.threadId) {
      return;
    }

    await this.refreshThreadState(this.threadId);
  }

  private requireThreadId(): string {
    if (!this.threadId) {
      throw new Error("No active App Server thread is available");
    }
    return this.threadId;
  }

  private requireActiveTurnId(): string {
    if (!this.activeTurnId) {
      throw new Error("No active turn is available for turn/steer");
    }
    return this.activeTurnId;
  }

  private async refreshThreadState(threadId: string): Promise<void> {
    const threadResponse = await this.request("thread/read", {
      threadId,
      includeTurns: true,
    });
    this.syncThreadStateFromThread(threadResponse?.thread);
  }

  private syncThreadStateFromThread(thread: any): void {
    if (typeof thread?.id === "string") {
      this.threadId = thread.id;
    }
    this.currentThreadCwd =
      typeof thread?.cwd === "string"
        ? normalizePersistedThreadCwd(thread.cwd)
        : null;

    let activeTurnId: string | null = null;
    let lastTurnStatus: string | null = null;

    // M203: Check thread-level status.activeFlags (live production shape)
    const threadActiveFlags: string[] = Array.isArray(
      thread?.status?.activeFlags,
    )
      ? thread.status.activeFlags
      : [];
    const threadStuckOnApproval = isTurnStuckOnApproval(threadActiveFlags);
    if (threadStuckOnApproval) {
      lastTurnStatus = "waitingOnApproval";
      this.logger.warn("thread waitingOnApproval; ignoring in-progress turns", {
        clientId: this.clientId,
        threadId: this.threadId,
      });
    }

    const turns = Array.isArray(thread?.turns) ? thread.turns : [];
    for (const turn of turns) {
      if (typeof turn?.status === "string") {
        lastTurnStatus = turn.status;
      }
      if (turn?.status === "inProgress" && typeof turn.id === "string") {
        // M203: Skip if thread-level or turn-level waitingOnApproval
        if (threadStuckOnApproval) {
          continue;
        }
        const turnActiveFlags: string[] = Array.isArray(turn.activeFlags)
          ? turn.activeFlags
          : [];
        if (isTurnStuckOnApproval(turnActiveFlags)) {
          lastTurnStatus = "waitingOnApproval";
          this.logger.warn("turn waitingOnApproval; ignoring turn as active", {
            clientId: this.clientId,
            turnId: turn.id,
          });
          continue;
        }
        activeTurnId = turn.id;
      }
    }

    if (activeTurnId && activeTurnId !== this.activeTurnId) {
      this.turnStartedAt = new Date().toISOString();
    } else if (!activeTurnId) {
      this.turnStartedAt = null;
    }
    this.activeTurnId = activeTurnId;
    this.lastTurnStatus = lastTurnStatus;
  }

  private async handleMessage(data: unknown): Promise<void> {
    const text = await readSocketData(data);
    const message = JSON.parse(text) as JsonRpcResponse;

    if (
      typeof message.id === "number" &&
      (Object.hasOwn(message, "result") || Object.hasOwn(message, "error"))
    ) {
      const pending = this.pending.get(message.id);
      if (!pending) {
        return;
      }

      this.pending.delete(message.id);
      this.clearPendingTimeout(pending);
      if (message.error) {
        const errorText = formatJsonRpcError(message.error);
        this.lastError = sanitizeErrorForPersistence(errorText);
        this.logger.error("app-server request failed", {
          clientId: this.clientId,
          method: pending.method,
          error: this.lastError,
        });
        pending.reject(new Error(`${pending.method} failed: ${errorText}`));
        return;
      }

      pending.resolve(message.result);
      this.lastSuccessfulAppServerAt = new Date().toISOString();
      this.lastSuccessfulAppServerMethod = pending.method;
      this.lastError = null;
      return;
    }

    // Server-initiated JSON-RPC request (has both id and method).
    // Elicitation requests arrive this way and need a response.
    if (
      (typeof message.id === "number" || typeof message.id === "string") &&
      typeof message.method === "string"
    ) {
      this.lastNotificationMethod = message.method;
      this.lastNotificationAt = new Date().toISOString();

      if (isAutoElicitationRequestMethod(message.method)) {
        const result = buildAutoElicitationResult(message.params);
        if (result) {
          this.sendJsonRpcResult(message.id, result);
          this.logger.info("auto-responded to elicitation request", {
            clientId: this.clientId,
            method: message.method,
            action: result.action,
          });
        } else {
          this.sendJsonRpcResult(message.id, { action: "cancel" });
          this.logger.warn(
            "elicitation request missing usable params; cancelled",
            {
              clientId: this.clientId,
              method: message.method,
            },
          );
        }
        return;
      }
    }

    if (!message.method) {
      return;
    }

    this.lastNotificationMethod = message.method;
    this.lastNotificationAt = new Date().toISOString();
    this.logger.debug("received app-server notification", {
      clientId: this.clientId,
      method: message.method,
    });
    this.handleNotification(message.method, message.params);
  }

  private handleNotification(method: string, params: any): void {
    switch (method) {
      case "notifications/claude/channel":
        this.logger.info("tap channel notification received", {
          clientId: this.clientId,
          source: params?.meta?.source ?? null,
          from: params?.meta?.from ?? null,
          to: params?.meta?.to ?? null,
          subject: params?.meta?.subject ?? null,
          filename: params?.meta?.filename ?? null,
        });
        break;
      case "thread/started":
        if (params?.thread?.id) {
          this.threadId = params.thread.id;
        }
        if (typeof params?.thread?.cwd === "string") {
          this.currentThreadCwd = normalizePersistedThreadCwd(
            params.thread.cwd,
          );
        }
        this.logger.info("thread started notification", {
          clientId: this.clientId,
          threadId: params?.thread?.id ?? null,
          cwd: params?.thread?.cwd ?? null,
        });
        break;
      case "thread/status/changed":
        this.logger.debug("thread status changed", {
          clientId: this.clientId,
          threadId: params?.thread?.id ?? this.threadId,
          status:
            params?.thread?.status?.type ?? params?.status?.type ?? "unknown",
        });
        break;
      case "turn/started":
        if (params?.turn?.id) {
          this.activeTurnId = params.turn.id;
          this.turnStartedAt = new Date().toISOString();
          this.logger.info("turn started", {
            clientId: this.clientId,
            threadId: this.threadId,
            turnId: params.turn.id,
          });
        }
        break;
      case "turn/completed": {
        this.lastTurnStatus = params?.turn?.status ?? null;
        const prevTurnStartedAt = this.turnStartedAt;
        this.activeTurnId = null;
        this.turnStartedAt = null;
        const elapsedMs = prevTurnStartedAt
          ? Date.now() - new Date(prevTurnStartedAt).getTime()
          : null;
        this.logger.info("turn completed", {
          clientId: this.clientId,
          threadId: this.threadId,
          status: this.lastTurnStatus ?? "unknown",
          elapsedSeconds:
            elapsedMs !== null ? Math.round(elapsedMs / 1000) : undefined,
        });
        break;
      }
      case "error":
        this.lastError = sanitizeErrorForPersistence(
          JSON.stringify(params ?? {}, null, 2),
        );
        this.logger.error("app-server error notification", {
          clientId: this.clientId,
          error: this.lastError,
        });
        break;
      default:
        this.logger.info("unhandled app-server notification", {
          clientId: this.clientId,
          method,
        });
        break;
    }
  }

  private request(method: string, params: unknown): Promise<any> {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      throw new Error(`Cannot call ${method}; App Server socket is not open`);
    }

    const id = this.nextId;
    this.nextId += 1;

    const request: RequestRecord = {
      jsonrpc: "2.0",
      id,
      method,
      params,
    };

    return new Promise((resolvePromise, rejectPromise) => {
      const timeout = setTimeout(() => {
        const pending = this.pending.get(id);
        if (!pending) {
          return;
        }

        this.pending.delete(id);
        const errorText = `${method} timed out after ${this.requestTimeoutMs}ms`;
        this.lastError = sanitizeErrorForPersistence(errorText);
        this.logger.warn(
          "app-server request timed out",
          this.buildMetricsContext({
            method,
            requestId: id,
            timeoutMs: this.requestTimeoutMs,
          }),
        );
        pending.reject(new Error(errorText));
      }, this.requestTimeoutMs);

      this.pending.set(id, {
        resolve: resolvePromise,
        reject: rejectPromise,
        method,
        timeout,
      });

      try {
        socket.send(JSON.stringify(request));
      } catch (error) {
        const pending = this.pending.get(id);
        if (pending) {
          this.clearPendingTimeout(pending);
          this.pending.delete(id);
        }
        rejectPromise(error);
      }
    });
  }

  private sendJsonRpcResult(id: number | string, result: unknown): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return;
    }
    this.socket.send(JSON.stringify({ jsonrpc: "2.0", id, result }));
  }

  private rejectPending(error: Error): void {
    if (this.pending.size > 0) {
      this.logger.warn(
        "rejecting pending app-server requests",
        this.buildMetricsContext({
          error: sanitizeErrorForPersistence(error.message),
        }),
      );
    }

    for (const pending of this.pending.values()) {
      this.clearPendingTimeout(pending);
      pending.reject(error);
    }
    this.pending.clear();
  }

  private clearPendingTimeout(pending: PendingRequest): void {
    if (pending.timeout !== null) {
      clearTimeout(pending.timeout);
      pending.timeout = null;
    }
  }

  private detachSocketListeners(socket: WebSocket): void {
    const listeners = this.socketListeners.get(socket);
    if (!listeners) {
      return;
    }

    socket.removeEventListener("open", listeners.open);
    socket.removeEventListener("error", listeners.error);
    socket.removeEventListener("close", listeners.close);
    socket.removeEventListener("message", listeners.message);
    this.socketListeners.delete(socket);
  }

  private buildMetricsContext(
    context: Record<string, unknown>,
  ): Record<string, unknown> {
    return {
      clientId: this.clientId,
      reconnectCount: Math.max(this.clientId - 1, 0),
      pendingCount: this.pending.size,
      rssMb: getProcessRssMb(),
      ...context,
    };
  }
}
