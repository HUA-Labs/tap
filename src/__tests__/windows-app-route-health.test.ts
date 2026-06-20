import { describe, expect, it } from "vitest";
import { probeWindowsAppRouteHealth } from "../routing/windows-app-route-health.js";
import type {
  ObserveTransport,
  ObserveTransportSnapshot,
} from "../transport/types.js";

const baseSnapshot: ObserveTransportSnapshot = {
  transport: "test",
  connected: true,
  connectedAt: "2026-06-05T00:00:00.000Z",
  agents: [],
  conversations: [],
};

function snapshot(
  conversations: ObserveTransportSnapshot["conversations"],
): ObserveTransportSnapshot {
  return {
    ...baseSnapshot,
    conversations,
  };
}

function conversation(options: {
  id: string;
  ownerClientId?: string | null;
  hostId?: string | null;
  changeType?: string | null;
  turnStatus?: string | null;
}): ObserveTransportSnapshot["conversations"][number] {
  return {
    id: options.id,
    address: {
      hostId: options.hostId ?? "local",
      clientId: options.ownerClientId ?? null,
      conversationId: options.id,
      ownerClientId: options.ownerClientId ?? null,
    },
    metadata: {
      change: {
        type: options.changeType ?? "snapshot",
        turn: options.turnStatus
          ? {
              id: `turn-${options.id}`,
              status: options.turnStatus,
            }
          : null,
      },
    },
  };
}

function makeTransport(
  snapshotValue: ObserveTransportSnapshot,
): ObserveTransport {
  return {
    kind: "test-observe",
    async connect() {
      return snapshotValue;
    },
    async disconnect() {},
    getSnapshot() {
      return snapshotValue;
    },
    subscribe() {
      return () => {};
    },
  };
}

describe("Windows App route health", () => {
  it("reports fresh-route-ready when durable presence matches a live candidate", async () => {
    const result = await probeWindowsAppRouteHealth({
      conversationId: "thread-live",
      presenceConversationId: "thread-live",
      presenceOwnerClientId: "owner-live",
      presenceFreshness: "fresh-for-routing",
      transport: makeTransport(
        snapshot([
          conversation({ id: "thread-live", ownerClientId: "owner-live" }),
        ]),
      ),
      timeoutMs: 0,
    });

    expect(result).toMatchObject({
      status: "fresh-route-ready",
      candidates: [
        expect.objectContaining({
          conversationId: "thread-live",
          matchesPresenceConversation: true,
          matchesPresenceOwner: true,
        }),
      ],
    });
  });

  it("reports stale-presence when the requested live candidate differs from durable presence", async () => {
    const result = await probeWindowsAppRouteHealth({
      conversationId: "thread-live",
      presenceConversationId: "thread-old",
      presenceOwnerClientId: "owner-old",
      presenceFreshness: "stale-visible",
      presenceAgeMinutes: 5841.5,
      transport: makeTransport(
        snapshot([
          conversation({ id: "thread-live", ownerClientId: "owner-live" }),
        ]),
      ),
      timeoutMs: 0,
    });

    expect(result).toMatchObject({
      status: "stale-presence",
      requestedConversationId: "thread-live",
      presenceConversationId: "thread-old",
      presenceAgeMinutes: 5841.5,
      candidates: [
        expect.objectContaining({
          conversationId: "thread-live",
          ownerClientId: "owner-live",
          matchesRequestedConversation: true,
          matchesPresenceConversation: false,
        }),
      ],
    });
  });

  it("requires explicit selection when multiple live candidates are visible", async () => {
    const result = await probeWindowsAppRouteHealth({
      presenceFreshness: "missing",
      transport: makeTransport(
        snapshot([
          conversation({ id: "thread-a", ownerClientId: "owner-a" }),
          conversation({ id: "thread-b", ownerClientId: "owner-b" }),
        ]),
      ),
      timeoutMs: 0,
    });

    expect(result).toMatchObject({
      status: "live-candidate-needs-selection",
      candidates: [
        expect.objectContaining({ conversationId: "thread-a" }),
        expect.objectContaining({ conversationId: "thread-b" }),
      ],
    });
  });

  it("blocks route refresh when the selected live candidate reports inProgress", async () => {
    const result = await probeWindowsAppRouteHealth({
      conversationId: "thread-live",
      presenceFreshness: "missing",
      transport: makeTransport(
        snapshot([
          conversation({
            id: "thread-live",
            ownerClientId: "owner-live",
            turnStatus: "inProgress",
          }),
        ]),
      ),
      timeoutMs: 0,
    });

    expect(result).toMatchObject({
      status: "active-turn-blocked",
      candidates: [
        expect.objectContaining({
          conversationId: "thread-live",
          lastTurnStatus: "inProgress",
        }),
      ],
    });
  });

  it("blocks route refresh when the selected live candidate has an active turn", async () => {
    const result = await probeWindowsAppRouteHealth({
      conversationId: "thread-live",
      presenceFreshness: "missing",
      transport: makeTransport(
        snapshot([
          conversation({
            id: "thread-live",
            ownerClientId: "owner-live",
            turnStatus: "active",
          }),
        ]),
      ),
      timeoutMs: 0,
    });

    expect(result).toMatchObject({
      status: "active-turn-blocked",
      candidates: [
        expect.objectContaining({
          conversationId: "thread-live",
          lastTurnStatus: "active",
        }),
      ],
    });
  });

  it("does not mark an ownerless live candidate as refreshable stale-presence", async () => {
    const result = await probeWindowsAppRouteHealth({
      conversationId: "thread-live",
      presenceConversationId: "thread-old",
      presenceOwnerClientId: "owner-old",
      presenceFreshness: "stale-visible",
      transport: makeTransport(
        snapshot([conversation({ id: "thread-live", ownerClientId: null })]),
      ),
      timeoutMs: 0,
    });

    expect(result).toMatchObject({
      status: "missing-owner-client",
      candidates: [
        expect.objectContaining({
          conversationId: "thread-live",
          ownerClientId: null,
          matchesRequestedConversation: true,
        }),
      ],
    });
  });

  it("reports candidate-not-observed for an explicit missing conversation", async () => {
    const result = await probeWindowsAppRouteHealth({
      conversationId: "thread-missing",
      presenceFreshness: "missing",
      transport: makeTransport(
        snapshot([
          conversation({ id: "thread-other", ownerClientId: "owner-other" }),
        ]),
      ),
      timeoutMs: 0,
    });

    expect(result.status).toBe("candidate-not-observed");
  });
});
