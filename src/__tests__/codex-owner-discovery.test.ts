import { describe, expect, it, vi } from "vitest";
import { discoverCodexOwnerClientId } from "../routing/codex-owner-discovery.js";
import type {
  ObserveTransport,
  ObserveTransportEvent,
  ObserveTransportListener,
  ObserveTransportSnapshot,
} from "../transport/types.js";

const emptySnapshot: ObserveTransportSnapshot = {
  transport: "test",
  connected: true,
  connectedAt: "2026-05-22T00:00:00.000Z",
  agents: [],
  conversations: [],
};

function snapshot(
  conversationId: string,
  ownerClientId: string,
): ObserveTransportSnapshot {
  return {
    ...emptySnapshot,
    agents: [
      {
        id: ownerClientId,
        name: null,
        address: {
          hostId: "DEVIN",
          clientId: ownerClientId,
          conversationId: null,
          ownerClientId: null,
        },
        metadata: {},
      },
    ],
    conversations: [
      {
        id: conversationId,
        address: {
          hostId: "DEVIN",
          clientId: ownerClientId,
          conversationId,
          ownerClientId,
        },
        metadata: {},
      },
    ],
  };
}

function makeTransport(options: {
  connectSnapshot?: ObserveTransportSnapshot;
  eventSnapshot?: ObserveTransportSnapshot;
}): ObserveTransport {
  const listeners = new Set<ObserveTransportListener>();
  return {
    kind: "test-observe",
    async connect() {
      if (options.eventSnapshot) {
        setTimeout(() => {
          const event: ObserveTransportEvent = {
            kind: "conversation-state",
            receivedAt: "2026-05-22T00:00:01.000Z",
            method: "thread-stream-state-changed",
            sourceAddress: {
              hostId: "DEVIN",
              clientId: "owner-event",
              conversationId: "thread-1",
              ownerClientId: "owner-event",
            },
            payload: null,
            snapshot: options.eventSnapshot!,
          };
          for (const listener of listeners) void listener(event);
        });
      }
      return options.connectSnapshot ?? emptySnapshot;
    },
    async disconnect() {
      listeners.clear();
    },
    getSnapshot() {
      return options.connectSnapshot ?? emptySnapshot;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

describe("Codex owner discovery", () => {
  it("returns an owner already present in the initial observe snapshot", async () => {
    const result = await discoverCodexOwnerClientId({
      conversationId: "thread-1",
      transport: makeTransport({
        connectSnapshot: snapshot("thread-1", "owner-snapshot"),
      }),
    });

    expect(result).toMatchObject({
      status: "found",
      conversationId: "thread-1",
      ownerClientId: "owner-snapshot",
      source: "snapshot",
    });
  });

  it("waits for a conversation-state event when the initial snapshot is empty", async () => {
    const result = await discoverCodexOwnerClientId({
      conversationId: "thread-1",
      timeoutMs: 100,
      transport: makeTransport({
        eventSnapshot: snapshot("thread-1", "owner-event"),
      }),
    });

    expect(result).toMatchObject({
      status: "found",
      ownerClientId: "owner-event",
      source: "event",
    });
  });

  it("returns not-found when no matching owner is observed before timeout", async () => {
    vi.useFakeTimers();
    const promise = discoverCodexOwnerClientId({
      conversationId: "thread-1",
      timeoutMs: 10,
      transport: makeTransport({}),
    });
    await vi.advanceTimersByTimeAsync(10);
    await expect(promise).resolves.toMatchObject({
      status: "not-found",
      conversationId: "thread-1",
    });
    vi.useRealTimers();
  });
});
