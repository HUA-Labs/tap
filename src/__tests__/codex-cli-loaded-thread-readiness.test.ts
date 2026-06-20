import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { probeCodexCliLoadedThreadReadiness } from "../receiver/codex-cli-loaded-thread-readiness.js";

type SocketEvent = "open" | "error" | "close" | "message";
type ListenerRecord = {
  listener: (event?: unknown) => void;
  once: boolean;
};

interface FakeThread {
  id: string;
  cwd: string;
  updatedAt?: number;
  status?: { type?: string };
  turns?: Array<Record<string, unknown>>;
}

class FakeWebSocket {
  static readonly OPEN = 1;
  static readonly CLOSED = 3;
  static threads: Record<string, FakeThread> = {};
  static loadedIds: string[] = [];
  static instances: FakeWebSocket[] = [];
  static noResponseMethods = new Set<string>();
  static noResponseWhenIncludeTurns = false;

  readyState = FakeWebSocket.OPEN;
  readonly sent: Array<Record<string, unknown>> = [];
  private readonly listeners = new Map<SocketEvent, ListenerRecord[]>();

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
    queueMicrotask(() => {
      this.emit("open");
    });
  }

  addEventListener(
    type: SocketEvent,
    listener: (event?: unknown) => void,
    options?: { once?: boolean },
  ): void {
    const records = this.listeners.get(type) ?? [];
    records.push({ listener, once: options?.once === true });
    this.listeners.set(type, records);
  }

  removeEventListener(
    type: SocketEvent,
    listener: (event?: unknown) => void,
  ): void {
    const records = this.listeners.get(type) ?? [];
    this.listeners.set(
      type,
      records.filter((record) => record.listener !== listener),
    );
  }

  send(payload: string): void {
    const message = JSON.parse(payload) as {
      id?: number;
      method?: string;
      params?: Record<string, unknown>;
    };
    this.sent.push(message);
    if (typeof message.id !== "number") return;

    if (message.method === "initialize") {
      this.respond(message.id, { ok: true });
      return;
    }

    if (message.method === "thread/loaded/list") {
      this.respond(message.id, { data: FakeWebSocket.loadedIds });
      return;
    }

    if (message.method === "thread/read") {
      if (FakeWebSocket.noResponseMethods.has("thread/read")) return;
      if (
        FakeWebSocket.noResponseWhenIncludeTurns &&
        message.params?.includeTurns === true
      ) {
        return;
      }
      const threadId =
        typeof message.params?.threadId === "string"
          ? message.params.threadId
          : "";
      const thread = FakeWebSocket.threads[threadId] ?? null;
      const includeTurns = message.params?.includeTurns === true;
      this.respond(message.id, {
        thread: includeTurns || !thread ? thread : { ...thread, turns: [] },
      });
    }
  }

  close(): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.emit("close");
  }

  private respond(id: number, result: unknown): void {
    queueMicrotask(() => {
      this.emit("message", {
        data: JSON.stringify({ jsonrpc: "2.0", id, result }),
      });
    });
  }

  private emit(type: SocketEvent, event?: unknown): void {
    const records = [...(this.listeners.get(type) ?? [])];
    for (const record of records) {
      record.listener(event);
      if (record.once) {
        this.removeEventListener(type, record.listener);
      }
    }
  }
}

const originalWebSocket = (
  globalThis as { WebSocket?: typeof globalThis.WebSocket }
).WebSocket;

describe("probeCodexCliLoadedThreadReadiness", () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    FakeWebSocket.loadedIds = [];
    FakeWebSocket.threads = {};
    FakeWebSocket.noResponseMethods = new Set();
    FakeWebSocket.noResponseWhenIncludeTurns = false;
    (globalThis as { WebSocket?: unknown }).WebSocket =
      FakeWebSocket as unknown as typeof globalThis.WebSocket;
  });

  afterEach(() => {
    (globalThis as { WebSocket?: typeof globalThis.WebSocket }).WebSocket =
      originalWebSocket;
  });

  it("does not mark an unrelated cwd loaded thread as ready", async () => {
    FakeWebSocket.loadedIds = ["other"];
    FakeWebSocket.threads = {
      other: {
        id: "other",
        cwd: "/tmp/other",
        updatedAt: 1,
        status: { type: "loaded" },
        turns: [],
      },
    };

    const result = await probeCodexCliLoadedThreadReadiness({
      appServerUrl: "ws://127.0.0.1:35089",
      cwd: "/home/devin/hua-platform",
    });

    expect(result).toMatchObject({
      status: "thread-not-loaded",
      loadedThreadId: null,
      loadedThreadCount: 1,
      matchingThreadCount: 0,
      message:
        "app-server reachable, but no loaded thread matched cwd /home/devin/hua-platform",
    });
  });

  it("matches Mac loaded thread cwd across logical path casing", async () => {
    FakeWebSocket.loadedIds = ["mac-thread"];
    FakeWebSocket.threads = {
      "mac-thread": {
        id: "mac-thread",
        cwd: "/Users/devin/HUA/hua-platform",
        updatedAt: 1,
        status: { type: "loaded" },
        turns: [],
      },
    };

    const result = await probeCodexCliLoadedThreadReadiness({
      appServerUrl: "ws://127.0.0.1:35089",
      cwd: "/Users/devin/hua/hua-platform",
    });

    expect(result).toMatchObject({
      status: "loaded-idle",
      loadedThreadId: "mac-thread",
      loadedThreadCount: 1,
      matchingThreadCount: 1,
      message: "loaded idle thread mac-thread is ready",
    });
  });

  it("honors explicit thread id as an operator override for cwd mismatch", async () => {
    FakeWebSocket.threads = {
      "override-thread": {
        id: "override-thread",
        cwd: "/tmp/other-project",
        updatedAt: 1,
        status: { type: "loaded" },
        turns: [],
      },
    };

    const result = await probeCodexCliLoadedThreadReadiness({
      appServerUrl: "ws://127.0.0.1:35089",
      cwd: "/Users/devin/HUA/hua-platform",
      threadId: "override-thread",
    });

    expect(result).toMatchObject({
      status: "loaded-idle",
      threadId: "override-thread",
      loadedThreadId: "override-thread",
      loadedThreadCount: 1,
      matchingThreadCount: 1,
      message: "loaded idle thread override-thread is ready",
    });
    const reads = FakeWebSocket.instances[0]!.sent.filter(
      (message) => message.method === "thread/read",
    );
    expect(reads).toHaveLength(1);
    expect(reads[0]).toMatchObject({
      params: {
        threadId: "override-thread",
        includeTurns: false,
      },
    });
  });

  it("treats an explicit notLoaded thread as thread-not-loaded", async () => {
    FakeWebSocket.threads = {
      "thread-x": {
        id: "thread-x",
        cwd: "/home/devin/hua-platform",
        updatedAt: 1,
        status: { type: "notLoaded" },
        turns: [],
      },
    };

    const result = await probeCodexCliLoadedThreadReadiness({
      appServerUrl: "ws://127.0.0.1:35089",
      cwd: "/home/devin/hua-platform",
      threadId: "thread-x",
    });

    expect(result).toMatchObject({
      status: "thread-not-loaded",
      threadId: "thread-x",
      loadedThreadId: null,
      loadedThreadCount: 0,
      matchingThreadCount: 0,
      message: "app-server reachable, but no loaded thread was found",
    });
  });

  it("classifies thread/read timeout separately from app-server unreachable", async () => {
    FakeWebSocket.loadedIds = ["slow"];
    FakeWebSocket.threads = {
      slow: {
        id: "slow",
        cwd: "/home/devin/hua-platform",
        updatedAt: 1,
        status: { type: "loaded" },
        turns: [],
      },
    };
    FakeWebSocket.noResponseMethods = new Set(["thread/read"]);

    const result = await probeCodexCliLoadedThreadReadiness({
      appServerUrl: "ws://127.0.0.1:35089",
      cwd: "/home/devin/hua-platform",
      requestTimeoutMs: 20,
    });

    expect(result).toMatchObject({
      status: "loaded-thread-read-timeout",
      loadedThreadId: null,
      loadedThreadCount: 0,
      matchingThreadCount: 0,
      message: "app-server request timed out for thread/read after 20ms",
    });
  });

  it("uses metadata-only thread/read for loaded-thread readiness", async () => {
    FakeWebSocket.loadedIds = ["active-thread"];
    FakeWebSocket.noResponseWhenIncludeTurns = true;
    FakeWebSocket.threads = {
      "active-thread": {
        id: "active-thread",
        cwd: "/home/devin/hua-platform",
        updatedAt: 1,
        status: { type: "active" },
        turns: [{ id: "turn-1", status: "inProgress" }],
      },
    };

    const result = await probeCodexCliLoadedThreadReadiness({
      appServerUrl: "ws://127.0.0.1:35089",
      cwd: "/home/devin/hua-platform",
      requestTimeoutMs: 20,
    });

    expect(result).toMatchObject({
      status: "loaded-active",
      loadedThreadId: "active-thread",
      activeTurnId: null,
      loadedThreadCount: 1,
      matchingThreadCount: 1,
      message: "loaded thread active-thread is active/busy",
    });
    const reads = FakeWebSocket.instances[0]!.sent.filter(
      (message) => message.method === "thread/read",
    );
    expect(reads).toHaveLength(1);
    expect(reads[0]).toMatchObject({
      params: {
        threadId: "active-thread",
        includeTurns: false,
      },
    });
  });
});
