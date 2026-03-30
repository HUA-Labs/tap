#!/usr/bin/env node --experimental-strip-types

import { resolve } from "path";

interface Options {
  appServerUrl: string;
  cwd: string;
  threadId: string | null;
  startText: string;
  steerText: string | null;
  steerDelayMs: number;
  waitMs: number;
}

interface JsonRpcResponse {
  id?: number;
  result?: any;
  error?: {
    code?: number;
    message?: string;
    data?: unknown;
  };
  method?: string;
  params?: any;
}

function printHelp(): void {
  console.log(`Codex App Server probe

Usage:
  node --experimental-strip-types scripts/codex-app-server-probe.ts [options]

Options:
  --app-server-url=<ws-url>
  --cwd=<path>
  --thread-id=<id>
  --start-text=<text>
  --steer-text=<text>
  --steer-delay-ms=<n>
  --wait-ms=<n>
  --help
`);
}

function parseNumber(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Invalid ${flag}: ${value}`);
  }
  return parsed;
}

function readFlagValue(argv: string[], index: number, flag: string): string {
  const current = argv[index];
  const eqIndex = current.indexOf("=");
  if (eqIndex >= 0) {
    return current.slice(eqIndex + 1);
  }

  const next = argv[index + 1];
  if (!next || next.startsWith("--")) {
    throw new Error(`Missing value for ${flag}`);
  }
  return next;
}

function parseArgs(argv: string[]): Options {
  let appServerUrl = "ws://127.0.0.1:4501";
  let cwd = process.cwd();
  let threadId: string | null = null;
  let startText =
    "Start probe. Write 60 short numbered lines in Korean, one per line, beginning with START-PROBE.";
  let steerText: string | null =
    "Steer probe. Add one extra line that says STEER-PROBE-OK and then finish.";
  let steerDelayMs = 500;
  let waitMs = 15_000;

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const consumesNext = !flag.includes("=");

    if (flag === "--help") {
      printHelp();
      process.exit(0);
    }

    if (flag.startsWith("--app-server-url")) {
      appServerUrl = readFlagValue(argv, index, "--app-server-url");
      if (consumesNext) {
        index += 1;
      }
      continue;
    }

    if (flag.startsWith("--cwd")) {
      cwd = readFlagValue(argv, index, "--cwd");
      if (consumesNext) {
        index += 1;
      }
      continue;
    }

    if (flag.startsWith("--thread-id")) {
      threadId = readFlagValue(argv, index, "--thread-id");
      if (consumesNext) {
        index += 1;
      }
      continue;
    }

    if (flag.startsWith("--start-text")) {
      startText = readFlagValue(argv, index, "--start-text");
      if (consumesNext) {
        index += 1;
      }
      continue;
    }

    if (flag.startsWith("--steer-text")) {
      steerText = readFlagValue(argv, index, "--steer-text");
      if (consumesNext) {
        index += 1;
      }
      continue;
    }

    if (flag.startsWith("--steer-delay-ms")) {
      steerDelayMs = parseNumber(
        readFlagValue(argv, index, "--steer-delay-ms"),
        "--steer-delay-ms",
      );
      if (consumesNext) {
        index += 1;
      }
      continue;
    }

    if (flag.startsWith("--wait-ms")) {
      waitMs = parseNumber(
        readFlagValue(argv, index, "--wait-ms"),
        "--wait-ms",
      );
      if (consumesNext) {
        index += 1;
      }
      continue;
    }

    throw new Error(`Unknown argument: ${flag}`);
  }

  return {
    appServerUrl,
    cwd: resolve(cwd),
    threadId,
    startText,
    steerText,
    steerDelayMs,
    waitMs,
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, ms);
  });
}

async function readSocketData(data: unknown): Promise<string> {
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

function logLine(message: string): void {
  const stamp = new Date().toISOString().replace("T", " ").replace("Z", " UTC");
  console.log(`[${stamp}] ${message}`);
}

class ProbeClient {
  private socket: WebSocket | null = null;
  private readonly url: string;
  private nextId = 1;
  private pending = new Map<
    number,
    {
      method: string;
      resolve: (value: any) => void;
      reject: (reason?: unknown) => void;
    }
  >();

  threadId: string | null = null;
  activeTurnId: string | null = null;
  lastTurnStatus: string | null = null;
  deltas: string[] = [];

  constructor(url: string) {
    this.url = url;
  }

  async connect(): Promise<void> {
    this.socket = new WebSocket(this.url);

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

      this.socket?.addEventListener("open", resolveOnce, { once: true });
      this.socket?.addEventListener("error", () => {
        rejectOnce(new Error(`Failed to connect to ${this.url}`));
      });
      this.socket?.addEventListener("close", () => {
        this.rejectPending(new Error("App Server connection closed"));
      });
      this.socket?.addEventListener("message", (event) => {
        void this.handleMessage(event.data);
      });
    });

    await this.request("initialize", {
      clientInfo: {
        name: "tap-probe",
        title: "tap probe",
        version: "0.1.0",
      },
      capabilities: {
        experimentalApi: false,
      },
    });
  }

  async disconnect(): Promise<void> {
    if (!this.socket) {
      return;
    }
    this.socket.close();
    this.socket = null;
  }

  async attachThread(
    requestedThreadId: string | null,
    cwd: string,
  ): Promise<string> {
    if (requestedThreadId) {
      const response = await this.request("thread/read", {
        threadId: requestedThreadId,
        includeTurns: true,
      });
      this.syncThreadState(response?.thread);
      logLine(`using explicit thread ${this.threadId}`);
      return this.requireThreadId();
    }

    const loaded = await this.request("thread/loaded/list", {
      limit: 20,
    });
    const ids = Array.isArray(loaded?.data)
      ? loaded.data.filter(
          (value: unknown): value is string => typeof value === "string",
        )
      : [];

    const threads: Array<{
      id: string;
      cwd: string;
      updatedAt: number;
      statusType: string | null;
      thread: any;
    }> = [];

    for (const id of ids) {
      const response = await this.request("thread/read", {
        threadId: id,
        includeTurns: true,
      });
      const thread = response?.thread;
      if (!thread?.id) {
        continue;
      }
      threads.push({
        id: thread.id,
        cwd: typeof thread.cwd === "string" ? thread.cwd : "",
        updatedAt: typeof thread.updatedAt === "number" ? thread.updatedAt : 0,
        statusType: thread.status?.type ?? null,
        thread,
      });
    }

    const matching = threads.filter((thread) => thread.cwd === cwd);
    const candidates = matching.length > 0 ? matching : threads;
    if (candidates.length === 0) {
      throw new Error("No loaded threads found on the App Server");
    }

    candidates.sort((left, right) => {
      const leftActive = left.statusType === "active" ? 1 : 0;
      const rightActive = right.statusType === "active" ? 1 : 0;
      if (leftActive !== rightActive) {
        return rightActive - leftActive;
      }
      return right.updatedAt - left.updatedAt;
    });

    this.syncThreadState(candidates[0].thread);
    logLine(
      `attached to loaded thread ${this.threadId} (status=${candidates[0].statusType ?? "unknown"})`,
    );
    return this.requireThreadId();
  }

  async startTurn(text: string): Promise<string | null> {
    const response = await this.request("turn/start", {
      threadId: this.requireThreadId(),
      input: [
        {
          type: "text",
          text,
          text_elements: [],
        },
      ],
    });
    const turnId = response?.turn?.id ?? null;
    if (turnId) {
      this.activeTurnId = turnId;
    }
    return turnId;
  }

  async steerTurn(text: string): Promise<void> {
    await this.request("turn/steer", {
      threadId: this.requireThreadId(),
      expectedTurnId: this.requireActiveTurnId(),
      input: [
        {
          type: "text",
          text,
          text_elements: [],
        },
      ],
    });
  }

  async readThread(): Promise<any> {
    const response = await this.request("thread/read", {
      threadId: this.requireThreadId(),
      includeTurns: true,
    });
    return response?.thread ?? null;
  }

  private requireThreadId(): string {
    if (!this.threadId) {
      throw new Error("No thread is attached");
    }
    return this.threadId;
  }

  private requireActiveTurnId(): string {
    if (!this.activeTurnId) {
      throw new Error("No active turn is available");
    }
    return this.activeTurnId;
  }

  private syncThreadState(thread: any): void {
    if (typeof thread?.id === "string") {
      this.threadId = thread.id;
    }
    const turns = Array.isArray(thread?.turns) ? thread.turns : [];
    this.activeTurnId = null;
    this.lastTurnStatus = null;
    for (const turn of turns) {
      if (typeof turn?.status === "string") {
        this.lastTurnStatus = turn.status;
      }
      if (turn?.status === "inProgress" && typeof turn.id === "string") {
        this.activeTurnId = turn.id;
      }
    }
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
        pending.reject(
          new Error(
            `${pending.method} failed: ${JSON.stringify(message.error, null, 2)}`,
          ),
        );
        return;
      }
      pending.resolve(message.result);
      return;
    }

    if (!message.method) {
      return;
    }

    switch (message.method) {
      case "thread/started":
        logLine(
          `notify thread/started ${message.params?.thread?.id ?? ""}`.trim(),
        );
        break;
      case "thread/status/changed":
        logLine(
          `notify thread/status/changed (${message.params?.thread?.status?.type ?? message.params?.status?.type ?? "unknown"})`,
        );
        break;
      case "turn/started":
        this.activeTurnId = message.params?.turn?.id ?? this.activeTurnId;
        logLine(`notify turn/started ${this.activeTurnId ?? ""}`.trim());
        break;
      case "item/agentMessage/delta":
        if (typeof message.params?.delta === "string") {
          this.deltas.push(message.params.delta);
        }
        logLine("notify item/agentMessage/delta");
        break;
      case "turn/completed":
        this.lastTurnStatus = message.params?.turn?.status ?? null;
        this.activeTurnId = null;
        logLine(`notify turn/completed (${this.lastTurnStatus ?? "unknown"})`);
        break;
      case "error":
        logLine(
          `notify error ${JSON.stringify(message.params ?? {}, null, 2)}`,
        );
        break;
      default:
        logLine(`notify ${message.method}`);
        break;
    }
  }

  private request(method: string, params: unknown): Promise<any> {
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
      this.pending.set(id, {
        method,
        resolve: resolvePromise,
        reject: rejectPromise,
      });
      this.socket?.send(JSON.stringify(payload));
    });
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const client = new ProbeClient(options.appServerUrl);

  logLine(`connecting to ${options.appServerUrl}`);
  await client.connect();
  await client.attachThread(options.threadId, options.cwd);

  const startTurnId = await client.startTurn(options.startText);
  logLine(`turn/start accepted (${startTurnId ?? "no-id"})`);

  if (options.steerText) {
    await delay(options.steerDelayMs);
    await client.steerTurn(options.steerText);
    logLine(
      `turn/steer sent for ${client.activeTurnId ?? startTurnId ?? "unknown-turn"}`,
    );
  }

  await delay(options.waitMs);
  const finalThread = await client.readThread();
  const turns = Array.isArray(finalThread?.turns) ? finalThread.turns : [];
  const lastTurn = turns.length > 0 ? turns[turns.length - 1] : null;
  const combinedText = client.deltas.join("");
  if (combinedText.trim()) {
    logLine(`delta preview: ${combinedText.slice(0, 200)}`);
  } else {
    logLine("delta preview: <none>");
  }

  logLine(
    `thread/read summary turns=${turns.length} lastTurnId=${lastTurn?.id ?? "none"} lastTurnStatus=${lastTurn?.status ?? "none"} items=${Array.isArray(lastTurn?.items) ? lastTurn.items.length : 0}`,
  );

  logLine(
    `final state thread=${client.threadId ?? "none"} activeTurn=${client.activeTurnId ?? "none"} status=${client.lastTurnStatus ?? "none"}`,
  );
  await client.disconnect();
}

main().catch((error) => {
  console.error(
    error instanceof Error ? (error.stack ?? error.message) : String(error),
  );
  process.exitCode = 1;
});
