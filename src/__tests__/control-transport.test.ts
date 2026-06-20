import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  __resetCodexIpcStabilityGuardForTests,
  ExperimentalCodexIpcControlTransport,
  type CodexIpcDriveMethod,
} from "../transport/experimental/codex-ipc-control.js";
import {
  decodeCodexIpcFrames,
  encodeCodexIpcFrame,
  type CodexIpcMessage,
  type CodexIpcSocket,
} from "../transport/experimental/codex-ipc-observe.js";

type SocketEvent = "connect" | "data" | "error" | "close";

interface FakeCodexIpcControlSocketOptions {
  emitConversationSnapshot?: boolean;
  failMethods?: string[];
}

class FakeCodexIpcControlSocket {
  readonly writes: Buffer[] = [];
  private readonly listeners = new Map<
    SocketEvent,
    Array<(...args: unknown[]) => void>
  >();

  constructor(private readonly options: FakeCodexIpcControlSocketOptions = {}) {
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
      if (message.type !== "request") continue;

      if (message.method === "initialize") {
        queueMicrotask(() => {
          this.emit(
            "data",
            encodeCodexIpcFrame({
              type: "response",
              requestId: message.requestId,
              resultType: "success",
              method: "initialize",
              handledByClientId: "router-client",
              result: { clientId: "control-client" },
            }),
          );
        });
        if (this.options.emitConversationSnapshot !== false) {
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
        continue;
      }

      if (this.options.failMethods?.includes(message.method)) {
        queueMicrotask(() => {
          this.emit(
            "error",
            new Error(`forced ${message.method} transport failure`),
          );
        });
        continue;
      }

      queueMicrotask(() => {
        this.emit(
          "data",
          encodeCodexIpcFrame({
            type: "response",
            requestId: message.requestId,
            resultType: "success",
            method: message.method,
            handledByClientId: message.targetClientId ?? "owner-client",
            result: {
              ok: true,
              turn: {
                id: "turn-1",
                status: "running",
              },
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

function readLedgerEntries(
  commsDir: string,
): Array<{ name: string; content: string }> {
  const ledgerDir = path.join(commsDir, "receipts", "consent-ledger");
  if (!fs.existsSync(ledgerDir)) {
    return [];
  }
  return fs
    .readdirSync(ledgerDir)
    .sort()
    .map((name) => ({
      name,
      content: fs.readFileSync(path.join(ledgerDir, name), "utf-8"),
    }));
}

async function flushMicrotasks(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

function decodeWrittenRequests(
  socket: FakeCodexIpcControlSocket,
): CodexIpcMessage[] {
  if (socket.writes.length === 0) return [];
  return decodeCodexIpcFrames(Buffer.concat(socket.writes)).messages;
}

beforeEach(() => {
  __resetCodexIpcStabilityGuardForTests();
  tmpDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "tap-control-transport-test-"),
  );
});

afterEach(() => {
  __resetCodexIpcStabilityGuardForTests();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("experimental Codex IPC control transport", () => {
  it("creates suggest drafts without mutating the owner conversation", async () => {
    const socket = new FakeCodexIpcControlSocket();
    const transport = new ExperimentalCodexIpcControlTransport({
      hostId: "ipc-host",
      receiptsDir: path.join(tmpDir, "receipts"),
      socketFactory: () => socket as unknown as CodexIpcSocket,
    });

    await transport.connect();
    await flushMicrotasks();

    const draft = transport.createStartTurnSuggestion({
      conversationId: "conv-1",
      text: "hello from suggest",
    });

    expect(draft).toMatchObject({
      status: "pending-owner-approval",
      scope: "suggest",
      method: "thread-follower-start-turn",
      conversationId: "conv-1",
      sourceAddress: {
        hostId: "ipc-host",
        clientId: "control-client",
        conversationId: "conv-1",
        ownerClientId: "owner-client",
      },
      targetAddress: {
        hostId: "ipc-host",
        clientId: "owner-client",
        conversationId: "conv-1",
        ownerClientId: "owner-client",
      },
    });

    const requests = decodeWrittenRequests(socket).filter(
      (message) =>
        message.type === "request" &&
        (message.method as CodexIpcDriveMethod | "initialize") !== "initialize",
    );
    expect(requests).toHaveLength(0);

    await transport.disconnect();
  });

  it("blocks drive actions without a matching consent receipt", async () => {
    const socket = new FakeCodexIpcControlSocket();
    const transport = new ExperimentalCodexIpcControlTransport({
      hostId: "ipc-host",
      receiptsDir: path.join(tmpDir, "receipts"),
      socketFactory: () => socket as unknown as CodexIpcSocket,
    });

    await transport.connect();
    await flushMicrotasks();

    await expect(
      transport.startTurn({
        conversationId: "conv-1",
        text: "hello from drive",
      }),
    ).rejects.toThrow("No matching consent receipt");

    const requests = decodeWrittenRequests(socket).filter(
      (message) =>
        message.type === "request" &&
        (message.method as CodexIpcDriveMethod | "initialize") ===
          "thread-follower-start-turn",
    );
    expect(requests).toHaveLength(0);

    await transport.disconnect();
  });

  it("consumes consent receipts after successful drive actions", async () => {
    const socket = new FakeCodexIpcControlSocket();
    const receiptsDir = path.join(tmpDir, "receipts");
    const secretsDir = path.join(tmpDir, "secrets");
    const commsDir = path.join(tmpDir, "comms");
    const transport = new ExperimentalCodexIpcControlTransport({
      commsDir,
      hostId: "ipc-host",
      receiptsDir,
      secretsDir,
      socketFactory: () => socket as unknown as CodexIpcSocket,
    });

    await transport.connect();
    await flushMicrotasks();

    const created = transport.createConsentReceipt({
      conversationId: "conv-1",
      allowedMethods: ["thread-follower-start-turn"],
    });

    const result = await transport.startTurn({
      conversationId: "conv-1",
      text: "hello from drive",
      consentRef: created.receipt.id,
    });

    expect(result).toMatchObject({
      scope: "drive",
      method: "thread-follower-start-turn",
      conversationId: "conv-1",
      consentRef: created.receipt.id,
      response: {
        resultType: "success",
        method: "thread-follower-start-turn",
      },
    });
    expect(fs.existsSync(created.filePath)).toBe(false);
    expect(
      fs.existsSync(path.join(secretsDir, `${created.receipt.id}.token`)),
    ).toBe(false);

    const requests = decodeWrittenRequests(socket).filter(
      (message) =>
        message.type === "request" &&
        (message.method as CodexIpcDriveMethod | "initialize") ===
          "thread-follower-start-turn",
    );
    expect(requests).toEqual([
      expect.objectContaining({
        method: "thread-follower-start-turn",
        targetClientId: "owner-client",
        version: 1,
        params: {
          conversationId: "conv-1",
          turnStartParams: expect.objectContaining({
            inheritThreadSettings: true,
            input: [
              {
                type: "text",
                text: "hello from drive",
                text_elements: [],
              },
            ],
          }),
        },
      }),
    ]);

    await expect(
      transport.startTurn({
        conversationId: "conv-1",
        text: "second try",
        consentRef: created.receipt.id,
      }),
    ).rejects.toThrow("Consent receipt");

    const ledgerEntries = readLedgerEntries(commsDir);
    expect(ledgerEntries.map((entry) => entry.name)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("-issued-"),
        expect.stringContaining("-consumed-"),
      ]),
    );
    expect(
      ledgerEntries.find((entry) => entry.name.includes("-consumed-"))?.content,
    ).toContain('result: "executed"');

    await transport.disconnect();
  });

  it("keeps consent receipts available when the drive request fails before response", async () => {
    const socket = new FakeCodexIpcControlSocket({
      failMethods: ["thread-follower-start-turn"],
    });
    const receiptsDir = path.join(tmpDir, "receipts");
    const secretsDir = path.join(tmpDir, "secrets");
    const commsDir = path.join(tmpDir, "comms");
    const transport = new ExperimentalCodexIpcControlTransport({
      commsDir,
      hostId: "ipc-host",
      receiptsDir,
      secretsDir,
      socketFactory: () => socket as unknown as CodexIpcSocket,
    });

    await transport.connect();
    await flushMicrotasks();

    const created = transport.createConsentReceipt({
      conversationId: "conv-1",
      allowedMethods: ["thread-follower-start-turn"],
    });

    await expect(
      transport.startTurn({
        conversationId: "conv-1",
        text: "hello from drive",
        consentRef: created.receipt.id,
      }),
    ).rejects.toThrow("forced thread-follower-start-turn transport failure");

    expect(fs.existsSync(created.filePath)).toBe(true);
    expect(
      fs.existsSync(path.join(secretsDir, `${created.receipt.id}.token`)),
    ).toBe(true);

    const ledgerEntries = readLedgerEntries(commsDir);
    expect(ledgerEntries.map((entry) => entry.name)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("-issued-"),
        expect.stringContaining("-rejected-"),
      ]),
    );
    expect(
      ledgerEntries.find((entry) => entry.name.includes("-rejected-"))?.content,
    ).toContain('result: "execution-rejected"');
  });

  it("uses owner tuple fallbacks when the observe snapshot is missing", async () => {
    const socket = new FakeCodexIpcControlSocket({
      emitConversationSnapshot: false,
    });
    const receiptsDir = path.join(tmpDir, "receipts");
    const secretsDir = path.join(tmpDir, "secrets");
    const transport = new ExperimentalCodexIpcControlTransport({
      hostId: "ipc-host",
      receiptsDir,
      secretsDir,
      socketFactory: () => socket as unknown as CodexIpcSocket,
    });

    await transport.connect();
    await flushMicrotasks();

    const created = transport.createConsentReceipt({
      conversationId: "conv-cold",
      hostId: "ipc-cold-host",
      ownerClientId: "owner-cold",
      allowedMethods: ["thread-follower-start-turn"],
    });

    const result = await transport.startTurn({
      conversationId: "conv-cold",
      text: "hello from cold start",
      consentRef: created.receipt.id,
      hostId: "ipc-cold-host",
      ownerClientId: "owner-cold",
    });

    expect(result).toMatchObject({
      conversationId: "conv-cold",
      targetAddress: {
        hostId: "ipc-cold-host",
        clientId: "owner-cold",
        conversationId: "conv-cold",
        ownerClientId: "owner-cold",
      },
    });

    const requests = decodeWrittenRequests(socket).filter(
      (message) =>
        message.type === "request" &&
        (message.method as CodexIpcDriveMethod | "initialize") ===
          "thread-follower-start-turn",
    );
    expect(requests).toEqual([
      expect.objectContaining({
        targetClientId: "owner-cold",
        params: expect.objectContaining({
          conversationId: "conv-cold",
        }),
      }),
    ]);

    await transport.disconnect();
  });
});
