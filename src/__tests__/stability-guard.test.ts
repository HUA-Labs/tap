import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  __resetCodexIpcStabilityGuardForTests,
  ExperimentalCodexIpcControlTransport,
} from "../transport/experimental/codex-ipc-control.js";
import {
  decodeCodexIpcFrames,
  encodeCodexIpcFrame,
  type CodexIpcMessage,
  type CodexIpcSocket,
} from "../transport/experimental/codex-ipc-observe.js";

type SocketEvent = "connect" | "data" | "error" | "close";

interface FakeSocketOptions {
  emitConversationSnapshot?: boolean;
  snapshotLastTurnStatus?: string | null;
  failMethods?: string[];
  /**
   * If true, after a successful startTurn response the fake socket will
   * emit a `thread-stream-state-changed` broadcast with `status: "completed"`
   * to simulate a lifecycle completion event.
   */
  emitCompletedAfterStartTurn?: boolean;
}

class FakeSocket {
  readonly writes: Buffer[] = [];
  private readonly listeners = new Map<
    SocketEvent,
    Array<(...args: unknown[]) => void>
  >();

  constructor(private readonly options: FakeSocketOptions = {}) {
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
      listeners.filter((c) => c !== listener),
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
            const snapshotLastTurnStatus =
              this.options.snapshotLastTurnStatus ?? null;
            this.emit(
              "data",
              encodeCodexIpcFrame({
                type: "broadcast",
                method: "thread-stream-state-changed",
                sourceClientId: "owner-client",
                params: {
                  conversationId: "conv-1",
                  change: {
                    kind: "snapshot",
                    conversationState: {
                      title: "Test conversation",
                      turns: snapshotLastTurnStatus
                        ? [
                            {
                              id: "turn-existing",
                              status: snapshotLastTurnStatus,
                            },
                          ]
                        : [],
                    },
                  },
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

      const turnId = `turn-${Date.now()}`;
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
              result: {
                turn: {
                  id: turnId,
                  status: "inProgress",
                },
              },
            },
          }),
        );
      });

      // Emit completed broadcast after startTurn if requested
      if (
        message.method === "thread-follower-start-turn" &&
        this.options.emitCompletedAfterStartTurn
      ) {
        queueMicrotask(() => {
          this.emit(
            "data",
            encodeCodexIpcFrame({
              type: "broadcast",
              method: "thread-stream-state-changed",
              sourceClientId: "owner-client",
              params: {
                conversationId: "conv-1",
                change: {
                  kind: "turnUpdate",
                  turn: {
                    id: turnId,
                    status: "completed",
                  },
                },
              },
            }),
          );
        });
      }
    }
    return true;
  }

  /**
   * Manually inject a broadcast to simulate lifecycle events from outside.
   */
  injectBroadcast(message: CodexIpcMessage): void {
    queueMicrotask(() => {
      this.emit("data", encodeCodexIpcFrame(message));
    });
  }

  end(): void {
    this.emit("close");
  }
  destroy(error?: Error): void {
    if (error) this.emit("error", error);
    this.emit("close");
  }
  setNoDelay(): void {}

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

function createTransport(
  socket: FakeSocket,
  dirs: { receiptsDir: string; secretsDir: string; commsDir: string },
) {
  return new ExperimentalCodexIpcControlTransport({
    commsDir: dirs.commsDir,
    hostId: "ipc-host",
    receiptsDir: dirs.receiptsDir,
    secretsDir: dirs.secretsDir,
    socketFactory: () => socket as unknown as CodexIpcSocket,
  });
}

beforeEach(() => {
  __resetCodexIpcStabilityGuardForTests();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tap-stability-guard-test-"));
});

afterEach(() => {
  __resetCodexIpcStabilityGuardForTests();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("Stability Guard", () => {
  it("rejects startTurn when the recipient conversation snapshot is already inProgress", async () => {
    const socket = new FakeSocket({ snapshotLastTurnStatus: "inProgress" });
    const dirs = {
      receiptsDir: path.join(tmpDir, "receipts"),
      secretsDir: path.join(tmpDir, "secrets"),
      commsDir: path.join(tmpDir, "comms"),
    };
    const transport = createTransport(socket, dirs);

    await transport.connect();
    await flushMicrotasks();

    const consent = transport.createConsentReceipt({
      conversationId: "conv-1",
      allowedMethods: ["thread-follower-start-turn"],
    });

    await expect(
      transport.startTurn({
        conversationId: "conv-1",
        text: "should not enter active recipient",
        consentRef: consent.receipt.id,
      }),
    ).rejects.toThrow("active in-progress turn");

    const startTurnRequests = socket.writes
      .flatMap((buf) => decodeCodexIpcFrames(buf).messages)
      .filter(
        (m) =>
          m.type === "request" && m.method === "thread-follower-start-turn",
      );
    expect(startTurnRequests).toHaveLength(0);

    await transport.disconnect();
  });

  it("rejects a second startTurn while the first is in-flight (single-flight lock)", async () => {
    const socket = new FakeSocket();
    const dirs = {
      receiptsDir: path.join(tmpDir, "receipts"),
      secretsDir: path.join(tmpDir, "secrets"),
      commsDir: path.join(tmpDir, "comms"),
    };
    const transport = createTransport(socket, dirs);

    await transport.connect();
    await flushMicrotasks();

    // Issue two consent receipts
    const consent1 = transport.createConsentReceipt({
      conversationId: "conv-1",
      allowedMethods: ["thread-follower-start-turn"],
    });
    const consent2 = transport.createConsentReceipt({
      conversationId: "conv-1",
      allowedMethods: ["thread-follower-start-turn"],
    });

    // First startTurn should succeed
    const result1 = await transport.startTurn({
      conversationId: "conv-1",
      text: "first turn",
      consentRef: consent1.receipt.id,
    });
    expect(result1.response.resultType).toBe("success");

    // Second startTurn should be rejected by the guard (lock still held)
    await expect(
      transport.startTurn({
        conversationId: "conv-1",
        text: "second turn",
        consentRef: consent2.receipt.id,
      }),
    ).rejects.toThrow("Stability Guard");

    // Verify no socket write was made for the second startTurn
    const startTurnRequests = socket.writes
      .flatMap((buf) => decodeCodexIpcFrames(buf).messages)
      .filter(
        (m) =>
          m.type === "request" && m.method === "thread-follower-start-turn",
      );
    expect(startTurnRequests).toHaveLength(1);

    await transport.disconnect();
  });

  it("shares the active startTurn guard across fresh transport instances", async () => {
    const socket1 = new FakeSocket();
    const dirs = {
      receiptsDir: path.join(tmpDir, "receipts"),
      secretsDir: path.join(tmpDir, "secrets"),
      commsDir: path.join(tmpDir, "comms"),
    };
    const transport1 = createTransport(socket1, dirs);

    await transport1.connect();
    await flushMicrotasks();

    const socket2 = new FakeSocket();
    const transport2 = createTransport(socket2, dirs);
    await transport2.connect();
    await flushMicrotasks();

    const consent1 = transport1.createConsentReceipt({
      conversationId: "conv-1",
      allowedMethods: ["thread-follower-start-turn"],
    });
    const consent2 = transport2.createConsentReceipt({
      conversationId: "conv-1",
      allowedMethods: ["thread-follower-start-turn"],
    });

    const result1 = await transport1.startTurn({
      conversationId: "conv-1",
      text: "first turn",
      consentRef: consent1.receipt.id,
    });
    expect(result1.response.resultType).toBe("success");

    await expect(
      transport2.startTurn({
        conversationId: "conv-1",
        text: "second turn from fresh transport",
        consentRef: consent2.receipt.id,
      }),
    ).rejects.toThrow("Stability Guard");

    const secondTransportStartTurns = socket2.writes
      .flatMap((buf) => decodeCodexIpcFrames(buf).messages)
      .filter(
        (m) =>
          m.type === "request" && m.method === "thread-follower-start-turn",
      );
    expect(secondTransportStartTurns).toHaveLength(0);

    await transport1.disconnect();
    await transport2.disconnect();
  });

  it("releases lock when a completed broadcast is received", async () => {
    const socket = new FakeSocket({ emitCompletedAfterStartTurn: true });
    const dirs = {
      receiptsDir: path.join(tmpDir, "receipts"),
      secretsDir: path.join(tmpDir, "secrets"),
      commsDir: path.join(tmpDir, "comms"),
    };
    const transport = createTransport(socket, dirs);

    await transport.connect();
    await flushMicrotasks();

    const consent1 = transport.createConsentReceipt({
      conversationId: "conv-1",
      allowedMethods: ["thread-follower-start-turn"],
    });

    // First startTurn succeeds and fake socket emits completed broadcast
    const result1 = await transport.startTurn({
      conversationId: "conv-1",
      text: "first turn",
      consentRef: consent1.receipt.id,
    });
    expect(result1.response.resultType).toBe("success");

    // Let the completed broadcast propagate
    await flushMicrotasks();

    // Need to wait for cooldown to pass for second call
    // Override cooldown by waiting (use a transport with shorter cooldown for test)
    // Instead, manually set last drive time to the past
    // We access private field via any for testing purposes
    (transport as any).conversationLastDriveTime.set(
      "conv-1",
      Date.now() - 20_000,
    );

    const consent2 = transport.createConsentReceipt({
      conversationId: "conv-1",
      allowedMethods: ["thread-follower-start-turn"],
    });

    // Second startTurn should now succeed because lock was released by completed broadcast
    const result2 = await transport.startTurn({
      conversationId: "conv-1",
      text: "second turn after completion",
      consentRef: consent2.receipt.id,
    });
    expect(result2.response.resultType).toBe("success");

    await transport.disconnect();
  });

  it("rejects startTurn during cooldown period", async () => {
    const socket = new FakeSocket({ emitCompletedAfterStartTurn: true });
    const dirs = {
      receiptsDir: path.join(tmpDir, "receipts"),
      secretsDir: path.join(tmpDir, "secrets"),
      commsDir: path.join(tmpDir, "comms"),
    };
    const transport = createTransport(socket, dirs);

    await transport.connect();
    await flushMicrotasks();

    const consent1 = transport.createConsentReceipt({
      conversationId: "conv-1",
      allowedMethods: ["thread-follower-start-turn"],
    });

    // First startTurn succeeds
    await transport.startTurn({
      conversationId: "conv-1",
      text: "first turn",
      consentRef: consent1.receipt.id,
    });

    // Let completed broadcast release the lock
    await flushMicrotasks();

    // Attempt second startTurn immediately — should be rejected by cooldown
    const consent2 = transport.createConsentReceipt({
      conversationId: "conv-1",
      allowedMethods: ["thread-follower-start-turn"],
    });

    await expect(
      transport.startTurn({
        conversationId: "conv-1",
        text: "too soon",
        consentRef: consent2.receipt.id,
      }),
    ).rejects.toThrow("Cooldown active");

    await transport.disconnect();
  });

  it("does NOT block interrupt or approval-decision even when startTurn lock is held", async () => {
    const socket = new FakeSocket();
    const dirs = {
      receiptsDir: path.join(tmpDir, "receipts"),
      secretsDir: path.join(tmpDir, "secrets"),
      commsDir: path.join(tmpDir, "comms"),
    };
    const transport = createTransport(socket, dirs);

    await transport.connect();
    await flushMicrotasks();

    // First: startTurn to acquire the lock
    const consentStart = transport.createConsentReceipt({
      conversationId: "conv-1",
      allowedMethods: ["thread-follower-start-turn"],
    });
    await transport.startTurn({
      conversationId: "conv-1",
      text: "start turn",
      consentRef: consentStart.receipt.id,
    });

    // Lock is held. Now try interrupt — it should pass through
    const consentInterrupt = transport.createConsentReceipt({
      conversationId: "conv-1",
      allowedMethods: ["thread-follower-interrupt-turn"],
    });
    const interruptResult = await transport.driveAction({
      conversationId: "conv-1",
      method: "thread-follower-interrupt-turn",
      consentRef: consentInterrupt.receipt.id,
    });
    expect(interruptResult.response.resultType).toBe("success");
    expect(interruptResult.method).toBe("thread-follower-interrupt-turn");

    // Also try approval decision — should also pass through
    const consentApproval = transport.createConsentReceipt({
      conversationId: "conv-1",
      allowedMethods: ["thread-follower-command-approval-decision"],
    });
    const approvalResult = await transport.driveAction({
      conversationId: "conv-1",
      method: "thread-follower-command-approval-decision",
      consentRef: consentApproval.receipt.id,
    });
    expect(approvalResult.response.resultType).toBe("success");
    expect(approvalResult.method).toBe(
      "thread-follower-command-approval-decision",
    );

    await transport.disconnect();
  });
});
