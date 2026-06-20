import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocketCodexAppServerPromoter } from "../receiver/codex-cli-app-server-promotion.js";

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
      const threadId =
        typeof message.params?.threadId === "string"
          ? message.params.threadId
          : "";
      this.respond(message.id, {
        thread: FakeWebSocket.threads[threadId] ?? null,
      });
      return;
    }

    if (message.method === "turn/start") {
      this.respond(message.id, {
        turn: {
          id: "turn-promoted",
        },
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

describe("WebSocketCodexAppServerPromoter", () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    FakeWebSocket.loadedIds = [];
    FakeWebSocket.threads = {};
    (globalThis as { WebSocket?: unknown }).WebSocket =
      FakeWebSocket as unknown as typeof globalThis.WebSocket;
  });

  afterEach(() => {
    (globalThis as { WebSocket?: typeof globalThis.WebSocket }).WebSocket =
      originalWebSocket;
  });

  it("does not fall back to an unrelated loaded thread when cwd mismatches", async () => {
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

    const result = await new WebSocketCodexAppServerPromoter().promote({
      appServerUrl: "ws://127.0.0.1:35089",
      cwd: "/home/devin/hua-platform",
      text: "Tap message for 준",
    });

    expect(result).toMatchObject({
      delivered: false,
      turnId: null,
      threadId: null,
      runtimeHealth: "unhealthy",
      blockedReason: "No loaded threads matched cwd /home/devin/hua-platform",
    });
    expect(
      FakeWebSocket.instances[0]!.sent.some(
        (message) => message.method === "turn/start",
      ),
    ).toBe(false);
  });

  it("promotes to a Mac loaded thread when only logical path casing differs", async () => {
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

    const result = await new WebSocketCodexAppServerPromoter().promote({
      appServerUrl: "ws://127.0.0.1:35089",
      cwd: "/Users/devin/hua/hua-platform",
      text: "Tap message for 준",
    });

    expect(result).toMatchObject({
      delivered: true,
      turnId: "turn-promoted",
      threadId: "mac-thread",
      runtimeHealth: "idle",
      blockedReason: null,
    });
    expect(
      FakeWebSocket.instances[0]!.sent.some(
        (message) => message.method === "turn/start",
      ),
    ).toBe(true);
  });

  it("fails closed on active loaded threads without attempting turn/steer", async () => {
    FakeWebSocket.loadedIds = ["active-thread"];
    FakeWebSocket.threads = {
      "active-thread": {
        id: "active-thread",
        cwd: "/home/devin/hua-platform",
        updatedAt: 1,
        status: { type: "active" },
        turns: [
          {
            id: "turn-busy",
            status: "inProgress",
          },
        ],
      },
    };

    const result = await new WebSocketCodexAppServerPromoter().promote({
      appServerUrl: "ws://127.0.0.1:35089",
      cwd: "/home/devin/hua-platform",
      text: "Tap message for 준",
    });

    expect(result).toMatchObject({
      delivered: false,
      turnId: null,
      threadId: "active-thread",
      runtimeHealth: "active-turn",
    });
    expect(result.blockedReason).toContain("active-turn");
    expect(
      FakeWebSocket.instances[0]!.sent.some(
        (message) => message.method === "turn/start",
      ),
    ).toBe(false);
    expect(
      FakeWebSocket.instances[0]!.sent.some(
        (message) => message.method === "turn/steer",
      ),
    ).toBe(false);
  });
});
