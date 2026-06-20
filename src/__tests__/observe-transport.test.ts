import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createFileObserveTransport } from "../transport/file-observe-transport.js";
import {
  decodeCodexIpcFrames,
  encodeCodexIpcFrame,
  ExperimentalCodexIpcObserveTransport,
  type CodexIpcMessage,
  type CodexIpcSocket,
} from "../transport/experimental/codex-ipc-observe.js";
import {
  isCodexIpcDefaultSupported,
  resolveCodexIpcPath,
} from "../transport/experimental/codex-ipc-endpoint.js";

type SocketEvent = "connect" | "data" | "error" | "close";

class FakeCodexIpcSocket {
  readonly writes: Buffer[] = [];
  private readonly listeners = new Map<
    SocketEvent,
    Array<(...args: unknown[]) => void>
  >();

  constructor() {
    queueMicrotask(() => {
      this.emit("connect");
    });
  }

  on(event: SocketEvent, listener: (...args: unknown[]) => void): this {
    const listeners = this.listeners.get(event) ?? [];
    listeners.push(listener);
    this.listeners.set(event, listeners);
    return this;
  }

  removeListener(
    event: SocketEvent,
    listener: (...args: unknown[]) => void,
  ): this {
    const listeners = this.listeners.get(event) ?? [];
    this.listeners.set(
      event,
      listeners.filter((candidate) => candidate !== listener),
    );
    return this;
  }

  write(chunk: Uint8Array | string): boolean {
    const buffer =
      typeof chunk === "string"
        ? Buffer.from(chunk, "utf-8")
        : Buffer.from(chunk);
    this.writes.push(buffer);

    const { messages } = decodeCodexIpcFrames(buffer);
    for (const message of messages) {
      if (message.type !== "request" || message.method !== "initialize") {
        continue;
      }

      queueMicrotask(() => {
        this.emit(
          "data",
          encodeCodexIpcFrame({
            type: "response",
            requestId: message.requestId,
            resultType: "success",
            method: "initialize",
            handledByClientId: "router-client",
            result: { clientId: "observer-client" },
          }),
        );
      });
      queueMicrotask(() => {
        this.emit(
          "data",
          encodeCodexIpcFrame({
            type: "broadcast",
            method: "client-status-changed",
            sourceClientId: "owner-client",
            params: {
              clientId: "owner-client",
              clientType: "owner-ui",
              status: "connected",
            },
          }),
        );
      });
      queueMicrotask(() => {
        this.emit(
          "data",
          encodeCodexIpcFrame({
            type: "broadcast",
            method: "thread-stream-state-changed",
            sourceClientId: "owner-client",
            params: {
              conversationId: "conv-1",
              change: { kind: "snapshot" },
            },
          }),
        );
      });
    }

    return true;
  }

  end(): void {
    this.emit("close");
  }

  destroy(error?: Error): void {
    if (error) {
      this.emit("error", error);
    }
    this.emit("close");
  }

  setNoDelay(): void {
    // No-op for the fake socket.
  }

  private emit(event: SocketEvent, ...args: unknown[]): void {
    for (const listener of [...(this.listeners.get(event) ?? [])]) {
      listener(...args);
    }
  }
}

let tmpDir: string;

async function flushMicrotasks(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 2_000,
  intervalMs = 25,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Timed out waiting after ${timeoutMs}ms`);
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "tap-observe-transport-test-"),
  );
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("observe transports", () => {
  it("resolves Codex IPC defaults for Windows and macOS", () => {
    expect(resolveCodexIpcPath({ platform: "win32", env: {} })).toBe(
      String.raw`\\.\pipe\codex-ipc`,
    );
    expect(
      resolveCodexIpcPath({
        platform: "darwin",
        tmpDir: "/var/folders/abc/T/",
        uid: 501,
        env: {},
      }),
    ).toBe("/var/folders/abc/T/codex-ipc/ipc-501.sock");
    expect(
      resolveCodexIpcPath({
        platform: "darwin",
        tmpDir: "/tmp",
        uid: 501,
        env: { TAP_CODEX_IPC_PATH: "/custom/codex.sock" },
      }),
    ).toBe("/custom/codex.sock");
    expect(isCodexIpcDefaultSupported("win32")).toBe(true);
    expect(isCodexIpcDefaultSupported("darwin")).toBe(true);
    expect(isCodexIpcDefaultSupported("linux")).toBe(false);
  });

  it("builds a file-backed observe snapshot from heartbeat address metadata", async () => {
    const commsDir = path.join(tmpDir, "comms");
    fs.mkdirSync(commsDir, { recursive: true });
    fs.writeFileSync(
      path.join(commsDir, "heartbeats.json"),
      JSON.stringify(
        {
          "codex-wt-3": {
            id: "codex-wt-3",
            agent: "해",
            timestamp: "2026-04-17T00:00:00.000Z",
            lastActivity: "2026-04-17T00:00:00.000Z",
            status: "active",
            source: "bridge-dispatch",
            instanceId: "codex-wt-3",
            receiveTransports: ["consent-drive", "bogus"],
            address: {
              hostId: "file-host",
              clientId: "codex-wt-3",
              conversationId: "thread-1",
              ownerClientId: "codex-wt-3",
            },
          },
          "codex-wt-4": {
            id: "codex-wt-4",
            agent: "온",
            timestamp: "2026-04-17T00:01:00.000Z",
            lastActivity: "2026-04-17T00:01:00.000Z",
            status: "idle",
            source: "bridge-dispatch",
            instanceId: "codex-wt-4",
            address: {
              hostId: "file-host",
              clientId: "codex-wt-4",
              conversationId: "thread-1",
              ownerClientId: "codex-wt-3",
            },
          },
        },
        null,
        2,
      ),
      "utf-8",
    );

    const transport = createFileObserveTransport({
      commsDir,
      hostId: "fallback-host",
    });
    const events: string[] = [];
    transport.subscribe((event) => {
      events.push(event.kind);
    });

    const snapshot = await transport.connect();

    expect(snapshot).toMatchObject({
      transport: "file-observe",
      connected: true,
      agents: [
        expect.objectContaining({
          id: "codex-wt-3",
          name: "해",
          address: {
            hostId: "file-host",
            clientId: "codex-wt-3",
            conversationId: "thread-1",
            ownerClientId: "codex-wt-3",
          },
          metadata: expect.objectContaining({
            receiveTransports: ["consent-drive"],
          }),
        }),
        expect.objectContaining({
          id: "codex-wt-4",
          name: "온",
          address: {
            hostId: "file-host",
            clientId: "codex-wt-4",
            conversationId: "thread-1",
            ownerClientId: "codex-wt-3",
          },
        }),
      ],
    });
    expect(snapshot.conversations).toEqual([
      expect.objectContaining({
        id: "thread-1",
        address: {
          hostId: "file-host",
          clientId: "codex-wt-4",
          conversationId: "thread-1",
          ownerClientId: "codex-wt-3",
        },
        metadata: expect.objectContaining({
          participantClientIds: ["codex-wt-3", "codex-wt-4"],
        }),
      }),
    ]);
    expect(events).toContain("transport-connected");
    await transport.disconnect();
  });

  it("refreshes the file-backed observe snapshot when heartbeats change", async () => {
    const commsDir = path.join(tmpDir, "comms-watch");
    const heartbeatsPath = path.join(commsDir, "heartbeats.json");
    fs.mkdirSync(commsDir, { recursive: true });
    fs.writeFileSync(
      heartbeatsPath,
      JSON.stringify(
        {
          "codex-wt-3": {
            id: "codex-wt-3",
            agent: "해",
            timestamp: "2026-04-17T00:00:00.000Z",
            lastActivity: "2026-04-17T00:00:00.000Z",
            status: "active",
            source: "bridge-dispatch",
            instanceId: "codex-wt-3",
            address: {
              hostId: "file-host",
              clientId: "codex-wt-3",
              conversationId: "thread-1",
              ownerClientId: "codex-wt-3",
            },
          },
        },
        null,
        2,
      ),
      "utf-8",
    );

    const transport = createFileObserveTransport({
      commsDir,
      hostId: "fallback-host",
      watchIntervalMs: 20,
    });
    const events: string[] = [];
    transport.subscribe((event) => {
      events.push(event.kind);
    });

    await transport.connect();

    fs.writeFileSync(
      heartbeatsPath,
      JSON.stringify(
        {
          "codex-wt-3": {
            id: "codex-wt-3",
            agent: "해",
            timestamp: "2026-04-17T00:00:00.000Z",
            lastActivity: "2026-04-17T00:00:00.000Z",
            status: "active",
            source: "bridge-dispatch",
            instanceId: "codex-wt-3",
            address: {
              hostId: "file-host",
              clientId: "codex-wt-3",
              conversationId: "thread-1",
              ownerClientId: "codex-wt-3",
            },
          },
          "codex-wt-4": {
            id: "codex-wt-4",
            agent: "온",
            timestamp: "2026-04-17T00:01:00.000Z",
            lastActivity: "2026-04-17T00:01:00.000Z",
            status: "active",
            source: "bridge-dispatch",
            instanceId: "codex-wt-4",
            address: {
              hostId: "file-host",
              clientId: "codex-wt-4",
              conversationId: "thread-2",
              ownerClientId: "codex-wt-4",
            },
          },
        },
        null,
        2,
      ),
      "utf-8",
    );

    // M397: under vitest worker pool contention (full-suite parallel run),
    // libuv polling for fs.watchFile latency can stretch 50x+ vs the
    // single-suite case (~50ms). Bump the wait budget without lowering the
    // requested polling cadence (`watchIntervalMs: 20`).
    await waitFor(() => transport.getSnapshot().agents.length === 2, 8_000);

    expect(transport.getSnapshot()).toMatchObject({
      connected: true,
      agents: [
        expect.objectContaining({ id: "codex-wt-3" }),
        expect.objectContaining({
          id: "codex-wt-4",
          address: expect.objectContaining({
            conversationId: "thread-2",
          }),
        }),
      ],
      conversations: [
        expect.objectContaining({ id: "thread-1" }),
        expect.objectContaining({ id: "thread-2" }),
      ],
    });
    expect(events).toContain("raw");
    await transport.disconnect();
  });

  it("decodes length-prefixed Codex IPC frames with partial remainders", () => {
    const firstMessage: CodexIpcMessage = {
      type: "broadcast",
      method: "client-status-changed",
      sourceClientId: "client-1",
      params: { status: "connected" },
    };
    const secondMessage: CodexIpcMessage = {
      type: "response",
      requestId: "req-2",
      resultType: "success",
      result: { clientId: "client-2" },
    };
    const firstFrame = encodeCodexIpcFrame(firstMessage);
    const secondFrame = encodeCodexIpcFrame(secondMessage);

    const initial = decodeCodexIpcFrames(
      Buffer.concat([firstFrame, secondFrame.subarray(0, 5)]),
    );
    expect(initial.messages).toEqual([firstMessage]);

    const completed = decodeCodexIpcFrames(
      Buffer.concat([initial.remainder, secondFrame.subarray(5)]),
    );
    expect(completed.messages).toEqual([secondMessage]);
    expect(completed.remainder).toHaveLength(0);
  });

  it("observes client and conversation broadcasts from the experimental Codex IPC transport", async () => {
    const socket = new FakeCodexIpcSocket();
    const transport = new ExperimentalCodexIpcObserveTransport({
      hostId: "ipc-host",
      socketFactory: () => socket as unknown as CodexIpcSocket,
    });
    const events: string[] = [];
    transport.subscribe((event) => {
      events.push(event.kind);
    });

    const connectedSnapshot = await transport.connect();
    expect(connectedSnapshot).toMatchObject({
      transport: "experimental-codex-ipc-observe",
      connected: true,
    });

    await flushMicrotasks();
    const snapshot = transport.getSnapshot();
    expect(snapshot.agents).toEqual([
      expect.objectContaining({
        id: "owner-client",
        name: "owner-ui",
        address: {
          hostId: "ipc-host",
          clientId: "owner-client",
          conversationId: null,
          ownerClientId: null,
        },
      }),
    ]);
    expect(snapshot.conversations).toEqual([
      expect.objectContaining({
        id: "conv-1",
        address: {
          hostId: "ipc-host",
          clientId: "owner-client",
          conversationId: "conv-1",
          ownerClientId: "owner-client",
        },
      }),
    ]);
    expect(events).toEqual(
      expect.arrayContaining([
        "transport-connected",
        "agent-status",
        "conversation-state",
      ]),
    );

    const written = decodeCodexIpcFrames(Buffer.concat(socket.writes));
    expect(written.messages).toEqual([
      expect.objectContaining({
        type: "request",
        method: "initialize",
        params: { clientType: "tap-observe" },
      }),
    ]);

    await transport.disconnect();
    expect(transport.getSnapshot().connected).toBe(false);
    expect(
      events.filter((event) => event === "transport-disconnected"),
    ).toHaveLength(1);
  });
});
