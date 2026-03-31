// bridge-ws-client.ts — AppServerClient class (WebSocket + JSON-RPC + thread/turn state)

import {
  AUTH_SUBPROTOCOL_PREFIX,
  JsonRpcResponse,
  LoadedThreadCandidate,
  RequestRecord,
  ThreadStateRecord,
} from "./bridge-types.js";
import { BridgeLogger } from "./bridge-logging.js";
import { sanitizeErrorForPersistence } from "./bridge-dispatch.js";
import {
  chooseLoadedThreadForCwd,
  isTurnStale,
  isTurnStuckOnApproval,
  threadCwdMatches,
} from "./bridge-routing.js";

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

let nextAppServerClientId = 1;

export class AppServerClient {
  private socket: WebSocket | null = null;
  private readonly url: string;
  private readonly gatewayToken: string | null;
  private readonly logger: BridgeLogger;
  private readonly clientId = nextAppServerClientId++;
  private nextId = 1;
  private pending = new Map<
    number,
    {
      resolve: (value: any) => void;
      reject: (reason?: unknown) => void;
      method: string;
    }
  >();

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

  constructor(url: string, logger: BridgeLogger, gatewayToken?: string | null) {
    this.url = url;
    this.logger = logger;
    this.gatewayToken = gatewayToken ?? null;
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

      this.socket?.addEventListener(
        "open",
        () => {
          this.connected = true;
          this.logger.info("connected to app-server", {
            clientId: this.clientId,
            url: this.url,
            authenticated: Boolean(this.gatewayToken),
          });
          resolveOnce();
        },
        { once: true },
      );

      this.socket?.addEventListener("error", () => {
        const error = new Error(
          `Failed to connect to App Server at ${this.url}`,
        );
        this.lastError = sanitizeErrorForPersistence(error.message);
        this.logger.error("failed to connect to app-server", {
          clientId: this.clientId,
          url: this.url,
          error: this.lastError,
        });
        rejectOnce(error);
      });

      this.socket?.addEventListener("close", () => {
        this.connected = false;
        this.initialized = false;
        this.activeTurnId = null;
        this.turnStartedAt = null;
        this.logger.warn("disconnected from app-server", {
          clientId: this.clientId,
          url: this.url,
        });
        this.rejectPending(new Error("App Server connection closed"));
      });

      this.socket?.addEventListener("message", (event) => {
        void this.handleMessage(event.data);
      });
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
    if (!this.socket) {
      return;
    }

    this.socket.close();
    this.connected = false;
    this.initialized = false;
    this.socket = null;
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

    const loadedThreadId = await this.findLoadedThread(cwd);
    if (loadedThreadId) {
      return loadedThreadId;
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
          if (!threadCwdMatches(cwd, this.currentThreadCwd)) {
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
    this.currentThreadCwd = this.currentThreadCwd ?? cwd;
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
    this.currentThreadCwd = typeof thread?.cwd === "string" ? thread.cwd : null;

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
      case "thread/started":
        if (params?.thread?.id) {
          this.threadId = params.thread.id;
        }
        if (typeof params?.thread?.cwd === "string") {
          this.currentThreadCwd = params.thread.cwd;
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
        break;
    }
  }

  private request(method: string, params: unknown): Promise<any> {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
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
      this.pending.set(id, {
        resolve: resolvePromise,
        reject: rejectPromise,
        method,
      });
      this.socket?.send(JSON.stringify(request));
    });
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();
  }
}
