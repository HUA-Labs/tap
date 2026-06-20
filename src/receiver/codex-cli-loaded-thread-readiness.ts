import { threadCwdMatches } from "./thread-cwd-match.js";

export type CodexCliLoadedThreadReadinessStatus =
  | "app-server-unreachable"
  | "loaded-thread-read-timeout"
  | "thread-not-loaded"
  | "loaded-idle"
  | "loaded-active"
  | "unhealthy";

export interface CodexCliLoadedThreadReadiness {
  status: CodexCliLoadedThreadReadinessStatus;
  appServerUrl: string;
  cwd: string;
  threadId: string | null;
  loadedThreadId: string | null;
  activeTurnId: string | null;
  loadedThreadCount: number;
  matchingThreadCount: number;
  message: string;
}

export interface ProbeCodexCliLoadedThreadReadinessOptions {
  appServerUrl: string;
  cwd: string;
  threadId?: string | null;
  requestTimeoutMs?: number;
}

interface JsonRpcResponse {
  id?: number;
  result?: unknown;
  error?: {
    code?: number;
    message?: string;
    data?: unknown;
  };
  method?: string;
  params?: unknown;
}

interface LoadedThreadSummary {
  id: string;
  cwd: string;
  updatedAt: number;
  statusType: string | null;
  activeTurnId: string | null;
}

const DEFAULT_APP_SERVER_REQUEST_TIMEOUT_MS = 5_000;

async function readSocketData(data: unknown): Promise<string> {
  if (typeof data === "string") return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8");
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

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function getString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function extractActiveTurnId(thread: unknown): string | null {
  const record = objectValue(thread);
  const turns = Array.isArray(record?.turns) ? record.turns : [];
  for (const turn of turns) {
    const turnRecord = objectValue(turn);
    if (
      turnRecord?.status === "inProgress" &&
      typeof turnRecord.id === "string"
    ) {
      return turnRecord.id;
    }
  }
  return null;
}

const METADATA_ONLY_THREAD_READ_PARAMS = {
  includeTurns: false,
};

function summarizeThread(thread: unknown): LoadedThreadSummary | null {
  const record = objectValue(thread);
  const id = getString(record?.id);
  if (!id) return null;
  const status = objectValue(record?.status);
  return {
    id,
    cwd: typeof record?.cwd === "string" ? record.cwd : "",
    updatedAt: typeof record?.updatedAt === "number" ? record.updatedAt : 0,
    statusType: typeof status?.type === "string" ? status.type : null,
    activeTurnId: extractActiveTurnId(thread),
  };
}

function isThreadActive(thread: LoadedThreadSummary): boolean {
  return thread.statusType === "active" || Boolean(thread.activeTurnId);
}

function isThreadLoaded(thread: LoadedThreadSummary): boolean {
  return thread.statusType !== "notLoaded";
}

class CodexAppServerReadinessClient {
  private socket: WebSocket | null = null;
  private nextId = 1;
  private requestTimeoutMs = DEFAULT_APP_SERVER_REQUEST_TIMEOUT_MS;
  private readonly pending = new Map<
    number,
    {
      method: string;
      resolve: (value: unknown) => void;
      reject: (reason?: unknown) => void;
    }
  >();

  async probe(
    options: ProbeCodexCliLoadedThreadReadinessOptions,
  ): Promise<CodexCliLoadedThreadReadiness> {
    try {
      this.requestTimeoutMs =
        options.requestTimeoutMs ?? DEFAULT_APP_SERVER_REQUEST_TIMEOUT_MS;
      await this.connect(options.appServerUrl);
      const threads = await this.readLoadedThreads(options.threadId ?? null);
      const loadedThreads = threads.filter(isThreadLoaded);
      const matching = loadedThreads.filter((thread) =>
        threadCwdMatches(options.cwd, thread.cwd),
      );
      const candidates = options.threadId ? loadedThreads : matching;
      if (candidates.length === 0) {
        const message =
          loadedThreads.length > 0
            ? `app-server reachable, but no loaded thread matched cwd ${options.cwd}`
            : "app-server reachable, but no loaded thread was found";
        return {
          status: "thread-not-loaded",
          appServerUrl: options.appServerUrl,
          cwd: options.cwd,
          threadId: options.threadId ?? null,
          loadedThreadId: null,
          activeTurnId: null,
          loadedThreadCount: loadedThreads.length,
          matchingThreadCount: options.threadId
            ? loadedThreads.length
            : matching.length,
          message,
        };
      }

      candidates.sort((left, right) => {
        const leftActive = isThreadActive(left) ? 1 : 0;
        const rightActive = isThreadActive(right) ? 1 : 0;
        if (leftActive !== rightActive) return leftActive - rightActive;
        return right.updatedAt - left.updatedAt;
      });
      const selected = candidates[0]!;
      const active = isThreadActive(selected);
      return {
        status: active ? "loaded-active" : "loaded-idle",
        appServerUrl: options.appServerUrl,
        cwd: options.cwd,
        threadId: options.threadId ?? null,
        loadedThreadId: selected.id,
        activeTurnId: selected.activeTurnId,
        loadedThreadCount: loadedThreads.length,
        matchingThreadCount: options.threadId
          ? loadedThreads.length
          : matching.length,
        message: active
          ? `loaded thread ${selected.id} is active/busy`
          : `loaded idle thread ${selected.id} is ready`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status: CodexCliLoadedThreadReadinessStatus =
        /timed out for thread\/read/i.test(message)
          ? "loaded-thread-read-timeout"
          : /connect|ECONNREFUSED|closed/i.test(message)
            ? "app-server-unreachable"
            : "unhealthy";
      return {
        status,
        appServerUrl: options.appServerUrl,
        cwd: options.cwd,
        threadId: options.threadId ?? null,
        loadedThreadId: null,
        activeTurnId: null,
        loadedThreadCount: 0,
        matchingThreadCount: 0,
        message,
      };
    } finally {
      this.disconnect();
    }
  }

  private connect(url: string): Promise<void> {
    this.socket = new WebSocket(url);
    return new Promise<void>((resolvePromise, rejectPromise) => {
      let settled = false;
      const resolveOnce = () => {
        if (settled) return;
        settled = true;
        resolvePromise();
      };
      const rejectOnce = (error: Error) => {
        if (settled) return;
        settled = true;
        rejectPromise(error);
      };

      this.socket?.addEventListener("open", resolveOnce, { once: true });
      this.socket?.addEventListener("error", () => {
        rejectOnce(new Error(`Failed to connect to App Server at ${url}`));
      });
      this.socket?.addEventListener("close", () => {
        this.rejectPending(new Error("App Server connection closed"));
      });
      this.socket?.addEventListener("message", (event) => {
        void this.handleMessage(event.data);
      });
    }).then(async () => {
      await this.request("initialize", {
        clientInfo: {
          name: "tap-ready-loaded-thread",
          title: "tap ready loaded-thread diagnostics",
          version: "0.1.0",
        },
        capabilities: {
          experimentalApi: false,
        },
      });
    });
  }

  private disconnect(): void {
    if (!this.socket) return;
    this.socket.close();
    this.socket = null;
  }

  private async readLoadedThreads(
    requestedThreadId: string | null,
  ): Promise<LoadedThreadSummary[]> {
    if (requestedThreadId) {
      const response = objectValue(
        await this.request("thread/read", {
          threadId: requestedThreadId,
          ...METADATA_ONLY_THREAD_READ_PARAMS,
        }),
      );
      const thread = summarizeThread(response?.thread);
      return thread ? [thread] : [];
    }

    const loaded = objectValue(
      await this.request("thread/loaded/list", {
        limit: 20,
      }),
    );
    const ids = Array.isArray(loaded?.data)
      ? loaded.data.filter(
          (value: unknown): value is string => typeof value === "string",
        )
      : [];

    const threads: LoadedThreadSummary[] = [];
    for (const id of ids) {
      const response = objectValue(
        await this.request("thread/read", {
          threadId: id,
          ...METADATA_ONLY_THREAD_READ_PARAMS,
        }),
      );
      const thread = summarizeThread(response?.thread);
      if (thread) threads.push(thread);
    }
    return threads;
  }

  private request(method: string, params: unknown): Promise<unknown> {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error(`Socket is not open for ${method}`);
    }

    const id = this.nextId;
    this.nextId += 1;
    const payload = {
      jsonrpc: "2.0",
      id,
      method,
      params,
    };

    return new Promise((resolvePromise, rejectPromise) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        rejectPromise(
          new Error(
            `app-server request timed out for ${method} after ${this.requestTimeoutMs}ms`,
          ),
        );
      }, this.requestTimeoutMs);
      this.pending.set(id, {
        method,
        resolve: (value) => {
          clearTimeout(timeout);
          resolvePromise(value);
        },
        reject: (reason) => {
          clearTimeout(timeout);
          rejectPromise(reason);
        },
      });
      this.socket?.send(JSON.stringify(payload));
    });
  }

  private async handleMessage(data: unknown): Promise<void> {
    const message = JSON.parse(await readSocketData(data)) as JsonRpcResponse;
    if (
      typeof message.id !== "number" ||
      (!Object.hasOwn(message, "result") && !Object.hasOwn(message, "error"))
    ) {
      return;
    }

    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    if (message.error) {
      pending.reject(
        new Error(
          `${pending.method} failed: ${message.error.message ?? JSON.stringify(message.error)}`,
        ),
      );
      return;
    }
    pending.resolve(message.result);
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();
  }
}

export async function probeCodexCliLoadedThreadReadiness(
  options: ProbeCodexCliLoadedThreadReadinessOptions,
): Promise<CodexCliLoadedThreadReadiness> {
  return new CodexAppServerReadinessClient().probe(options);
}
