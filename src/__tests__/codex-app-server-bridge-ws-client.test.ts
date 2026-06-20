import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppServerClient } from "../../scripts/codex/codex-app-server-bridge.js";

type SocketEvent = "open" | "error" | "close" | "message";
type ListenerRecord = {
  listener: (event?: unknown) => void;
  once: boolean;
};

class FakeWebSocket {
  static readonly OPEN = 1;
  static readonly CLOSED = 3;
  static instances: FakeWebSocket[] = [];

  readyState = FakeWebSocket.OPEN;
  readonly sent: Array<Record<string, unknown>> = [];
  private readonly listeners = new Map<SocketEvent, ListenerRecord[]>();

  constructor(
    readonly url: string,
    _options?: { protocols?: string[] },
  ) {
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
    const message = JSON.parse(payload) as Record<string, unknown>;
    this.sent.push(message);

    if (message.method === "initialize" && typeof message.id === "number") {
      queueMicrotask(() => {
        this.emit("message", {
          data: JSON.stringify({
            jsonrpc: "2.0",
            id: message.id,
            result: { ok: true },
          }),
        });
      });
    }
  }

  close(): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.emit("close");
  }

  respond(id: number, result: unknown): void {
    this.emit("message", {
      data: JSON.stringify({ jsonrpc: "2.0", id, result }),
    });
  }

  listenerCount(type: SocketEvent): number {
    return this.listeners.get(type)?.length ?? 0;
  }

  totalListenerCount(): number {
    return ["open", "error", "close", "message"].reduce(
      (sum, type) => sum + this.listenerCount(type as SocketEvent),
      0,
    );
  }

  lastRequestId(): number {
    const last = this.sent.at(-1);
    if (!last || typeof last.id !== "number") {
      throw new Error("No request id recorded");
    }
    return last.id;
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

function createLogger() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

const originalWebSocket = (
  globalThis as { WebSocket?: typeof globalThis.WebSocket }
).WebSocket;

describe("AppServerClient", () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    vi.useFakeTimers();
    (globalThis as { WebSocket?: unknown }).WebSocket =
      FakeWebSocket as unknown as typeof globalThis.WebSocket;
  });

  afterEach(() => {
    vi.useRealTimers();
    (globalThis as { WebSocket?: typeof globalThis.WebSocket }).WebSocket =
      originalWebSocket;
  });

  it("cleans pending requests after a timeout", async () => {
    const logger = createLogger();
    const client = new AppServerClient(
      "ws://127.0.0.1:4501",
      logger as never,
      null,
      50,
    );

    await client.connect();
    const socket = FakeWebSocket.instances[0];

    const requestPromise = (client as any).request("thread/read", {
      threadId: "thread-1",
    });
    const timeoutErrorPromise = requestPromise.catch((error: unknown) => error);

    expect(client.getPendingRequestCount()).toBe(1);

    await vi.advanceTimersByTimeAsync(51);

    const timeoutError = await timeoutErrorPromise;
    expect(timeoutError).toBeInstanceOf(Error);
    expect((timeoutError as Error).message).toBe(
      "thread/read timed out after 50ms",
    );
    expect(client.getPendingRequestCount()).toBe(0);

    socket.respond(socket.lastRequestId(), {
      thread: { id: "thread-late" },
    });
    await Promise.resolve();

    expect(client.getPendingRequestCount()).toBe(0);
  });

  it("cleans up socket listeners before reconnecting", async () => {
    const logger = createLogger();
    const client = new AppServerClient("ws://127.0.0.1:4501", logger as never);

    await client.connect();
    const firstSocket = FakeWebSocket.instances[0];
    expect(firstSocket.listenerCount("message")).toBe(1);
    expect(firstSocket.listenerCount("close")).toBe(1);
    expect(firstSocket.listenerCount("error")).toBe(1);

    await client.disconnect();

    expect(firstSocket.totalListenerCount()).toBe(0);

    await client.connect();
    const secondSocket = FakeWebSocket.instances[1];

    expect(secondSocket.listenerCount("message")).toBe(1);
    expect(secondSocket.listenerCount("close")).toBe(1);
    expect(secondSocket.listenerCount("error")).toBe(1);
    expect(firstSocket.totalListenerCount()).toBe(0);
  });
});
