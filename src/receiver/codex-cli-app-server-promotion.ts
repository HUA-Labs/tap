import { resolve } from "node:path";
import { buildTapMessagePrompt } from "../routing/tap-message-prompt.js";
import {
  resolveCodexEndpointProfile,
  type ResolvedCodexEndpointProfile,
} from "../routing/codex-endpoint-profiles.js";
import {
  markPollingReceiverItemsProcessed,
  runPollingReceiver,
  type PollingReceiverItem,
  type RunPollingReceiverOptions,
} from "./codex-cli-polling-receiver.js";
import { threadCwdMatches } from "./thread-cwd-match.js";

export interface CodexAppServerPromotionRequest {
  appServerUrl: string;
  cwd: string;
  threadId?: string | null;
  text: string;
}

export interface CodexAppServerPromotionDelivery {
  delivered: boolean;
  turnId: string | null;
  threadId: string | null;
  runtimeHealth:
    | "idle"
    | "active-turn"
    | "stuck-turn"
    | "unhealthy"
    | "adapter-unavailable";
  blockedReason: string | null;
}

export interface CodexAppServerPromoter {
  promote(
    request: CodexAppServerPromotionRequest,
  ): Promise<CodexAppServerPromotionDelivery>;
}

export interface RunCodexCliAppServerPromotionOptions extends Omit<
  RunPollingReceiverOptions,
  "mode" | "limit"
> {
  limit?: number;
  appServerUrl?: string | null;
  endpointProfile?: string;
  endpointConfig?: Record<string, unknown>;
  cwd?: string;
  threadId?: string | null;
  dryRun?: boolean;
  promoter?: CodexAppServerPromoter;
}

export interface CodexCliAppServerPromotionResult {
  mode: "promote";
  agent: string;
  aliases: string[];
  commsDir: string;
  statePath: string;
  receiveTransport: "polling";
  adapter: "app-server-promotion";
  runtimeSurface: "codex-cli-app-server";
  endpointProfile: ResolvedCodexEndpointProfile;
  appServerUrl: string | null;
  cwd: string;
  threadId: string | null;
  status: "idle" | "dry-run" | "delivered" | "blocked";
  delivered: boolean;
  queued: boolean;
  queueReason: string | null;
  steerAttempted: boolean;
  turnId: string | null;
  blockedReason: string | null;
  runtimeHealth: CodexAppServerPromotionDelivery["runtimeHealth"] | null;
  item: PollingReceiverItem | null;
  promptText: string | null;
  scanned: number;
  skipped: {
    old: number;
    duplicate: number;
    notForAgent: number;
    own: number;
  };
  stateWritten: boolean;
  effectiveSince: string | null;
  warnings: string[];
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
  thread: unknown;
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
    thread,
  };
}

export class WebSocketCodexAppServerPromoter implements CodexAppServerPromoter {
  private socket: WebSocket | null = null;
  private nextId = 1;
  private readonly pending = new Map<
    number,
    {
      method: string;
      resolve: (value: unknown) => void;
      reject: (reason?: unknown) => void;
    }
  >();

  async promote(
    request: CodexAppServerPromotionRequest,
  ): Promise<CodexAppServerPromotionDelivery> {
    try {
      await this.connect(request.appServerUrl);
      const thread = await this.attachThread(
        request.threadId ?? null,
        request.cwd,
      );
      if (thread.statusType === "active" || thread.activeTurnId) {
        return {
          delivered: false,
          turnId: null,
          threadId: thread.id,
          runtimeHealth: "active-turn",
          blockedReason: `active-turn: thread ${thread.id} already has active turn ${thread.activeTurnId ?? "(status active)"}`,
        };
      }

      const turnId = await this.startTurn(thread.id, request.text);
      return {
        delivered: Boolean(turnId),
        turnId,
        threadId: thread.id,
        runtimeHealth: "idle",
        blockedReason: turnId ? null : "turn/start did not return a turn id",
      };
    } catch (error) {
      return {
        delivered: false,
        turnId: null,
        threadId: null,
        runtimeHealth: "unhealthy",
        blockedReason:
          error instanceof Error ? error.message : `app-server error: ${error}`,
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
          name: "tap-receiver-promotion",
          title: "tap receiver promotion",
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

  private async attachThread(
    requestedThreadId: string | null,
    cwd: string,
  ): Promise<LoadedThreadSummary> {
    if (requestedThreadId) {
      const response = objectValue(
        await this.request("thread/read", {
          threadId: requestedThreadId,
          includeTurns: true,
        }),
      );
      const thread = summarizeThread(response?.thread);
      if (!thread) {
        throw new Error(
          `thread/read did not return thread ${requestedThreadId}`,
        );
      }
      return thread;
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
          includeTurns: true,
        }),
      );
      const thread = summarizeThread(response?.thread);
      if (thread) threads.push(thread);
    }

    const candidates = threads.filter((thread) =>
      threadCwdMatches(cwd, thread.cwd),
    );
    if (candidates.length === 0) {
      throw new Error(`No loaded threads matched cwd ${cwd}`);
    }

    candidates.sort((left, right) => {
      const leftActive =
        left.statusType === "active" || left.activeTurnId ? 1 : 0;
      const rightActive =
        right.statusType === "active" || right.activeTurnId ? 1 : 0;
      if (leftActive !== rightActive) return rightActive - leftActive;
      return right.updatedAt - left.updatedAt;
    });
    return candidates[0];
  }

  private async startTurn(
    threadId: string,
    text: string,
  ): Promise<string | null> {
    const response = objectValue(
      await this.request("turn/start", {
        threadId,
        input: [
          {
            type: "text",
            text,
            text_elements: [],
          },
        ],
      }),
    );
    const turn = objectValue(response?.turn);
    return getString(turn?.id);
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
            `app-server request timed out for ${method} after ${DEFAULT_APP_SERVER_REQUEST_TIMEOUT_MS}ms`,
          ),
        );
      }, DEFAULT_APP_SERVER_REQUEST_TIMEOUT_MS);
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

function buildPromotionPrompt(
  agent: string,
  item: PollingReceiverItem,
  options: { debugEnvelope?: boolean } = {},
): string {
  return buildTapMessagePrompt({
    agentName: agent,
    sender: item.fromName ?? item.from,
    recipient: item.to,
    subject: item.subject,
    fileName: item.filename,
    body: item.content ?? "",
    replyTo: item.from,
    returnAddress: item.fromAddress,
    debugEnvelope: options.debugEnvelope,
  });
}

export async function runCodexCliAppServerPromotion(
  options: RunCodexCliAppServerPromotionOptions,
): Promise<CodexCliAppServerPromotionResult> {
  const scan = await runPollingReceiver({
    ...options,
    mode: "check",
    limit: Math.max(1, Math.min(1, options.limit ?? 1)),
    includeContent: true,
  });
  const endpointProfile = resolveCodexEndpointProfile({
    profileId: options.endpointProfile ?? "public-auth-gateway",
    requestedUrl: options.appServerUrl,
    config: options.endpointConfig ?? {},
  });
  const appServerUrl = endpointProfile.resolvedUrl;
  const item = scan.items[0] ?? null;
  const cwd = resolve(options.cwd ?? process.cwd());
  const baseResult = {
    mode: "promote" as const,
    agent: scan.agent,
    aliases: scan.aliases,
    commsDir: scan.commsDir,
    statePath: scan.statePath,
    receiveTransport: "polling" as const,
    adapter: "app-server-promotion" as const,
    runtimeSurface: "codex-cli-app-server" as const,
    endpointProfile,
    appServerUrl,
    cwd,
    scanned: scan.scanned,
    skipped: scan.skipped,
    effectiveSince: scan.effectiveSince,
    warnings: scan.warnings,
  };

  if (!item) {
    return {
      ...baseResult,
      status: "idle",
      delivered: false,
      queued: false,
      queueReason: null,
      steerAttempted: false,
      turnId: null,
      threadId: null,
      blockedReason: null,
      runtimeHealth: null,
      item: null,
      promptText: null,
      stateWritten: false,
    };
  }

  const promptText = buildPromotionPrompt(scan.agent, item, {
    debugEnvelope: options.debugEnvelope,
  });
  if (options.dryRun) {
    return {
      ...baseResult,
      status: "dry-run",
      delivered: false,
      queued: false,
      queueReason: null,
      steerAttempted: false,
      turnId: null,
      threadId: null,
      blockedReason: "dry-run: app-server turn/start was not attempted",
      runtimeHealth: null,
      item,
      promptText,
      stateWritten: false,
    };
  }

  if (!endpointProfile.valid || !appServerUrl) {
    return {
      ...baseResult,
      status: "blocked",
      delivered: false,
      queued: false,
      queueReason: null,
      steerAttempted: false,
      turnId: null,
      threadId: null,
      blockedReason: `invalid endpoint profile ${endpointProfile.requestedProfileId}: ${endpointProfile.classification}`,
      runtimeHealth: "adapter-unavailable",
      item,
      promptText,
      stateWritten: false,
    };
  }

  const promoter = options.promoter ?? new WebSocketCodexAppServerPromoter();
  const delivery = await promoter.promote({
    appServerUrl,
    cwd,
    threadId: options.threadId,
    text: promptText,
  });
  let stateWritten = false;
  if (delivery.delivered) {
    const marked = markPollingReceiverItemsProcessed({
      stateDir: options.stateDir,
      agent: options.agent,
      aliases: options.aliases,
      stateName: options.stateName,
      items: [item],
      now: options.now,
    });
    stateWritten = marked.stateWritten;
  }

  const queued = delivery.runtimeHealth === "active-turn";
  return {
    ...baseResult,
    status: delivery.delivered ? "delivered" : "blocked",
    delivered: delivery.delivered,
    queued,
    queueReason: queued ? delivery.blockedReason : null,
    steerAttempted: false,
    turnId: delivery.turnId,
    threadId: delivery.threadId,
    blockedReason: delivery.blockedReason,
    runtimeHealth: delivery.runtimeHealth,
    item,
    promptText,
    stateWritten,
  };
}
