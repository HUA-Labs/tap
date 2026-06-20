import { describe, expect, it } from "vitest";
import {
  buildCodexBindingRegistry,
  resolveCodexBinding,
  type CodexA2ADeliveryRequest,
  type CodexA2ADeliveryResult,
  type CodexBindingHeartbeat,
} from "../codex-a2a/index.js";

const NOW = "2026-05-22T12:00:00.000Z";

function heartbeat(
  id: string,
  overrides: Partial<CodexBindingHeartbeat> = {},
): CodexBindingHeartbeat {
  return {
    id,
    agent: id,
    status: "active",
    lastActivity: NOW,
    receiveTransports: ["consent-drive"],
    address: {
      hostId: "HOST",
      routingAddress: id,
      conversationId: `${id}-conversation`,
      ownerClientId: `${id}-owner`,
      aliases: [id],
    },
    ...overrides,
  };
}

describe("codex-a2a boundary contract", () => {
  it("owns the ready binding resolution contract", () => {
    const registry = buildCodexBindingRegistry({
      heartbeats: {
        ko: heartbeat("ko"),
      },
      now: NOW,
    });

    const result = resolveCodexBinding({
      registry,
      target: { routingAddress: "ko" },
      localHostId: "HOST",
    });

    expect(result.status).toBe("resolved");
    if (result.status !== "resolved") return;
    expect(result.binding).toMatchObject({
      routingAddress: "ko",
      conversationId: "ko-conversation",
      ownerClientId: "ko-owner",
      bindingStatus: "ready",
    });
  });

  it("classifies missing owner metadata as a partial binding", () => {
    const registry = buildCodexBindingRegistry({
      heartbeats: {
        ko: heartbeat("ko", {
          address: {
            hostId: "HOST",
            routingAddress: "ko",
            conversationId: "ko-conversation",
            ownerClientId: null,
            aliases: ["ko"],
          },
          capabilities: {
            receiveTransports: ["consent-drive"],
            conversationId: "ko-conversation",
            ownerClientId: null,
          },
        }),
      },
      now: NOW,
    });

    const result = resolveCodexBinding({
      registry,
      target: { routingAddress: "ko" },
      localHostId: "HOST",
    });

    expect(result.status).toBe("blocked");
    if (result.status !== "blocked") return;
    expect(result.reason).toBe("partial");
    expect(result.candidates[0]?.bindingStatus).toBe("partial");
  });

  it("classifies stale, ambiguous, unreachable, and binding mismatch outcomes", () => {
    const registry = buildCodexBindingRegistry({
      heartbeats: {
        stale: heartbeat("stale", {
          lastActivity: "2026-05-22T11:50:00.000Z",
        }),
        a: heartbeat("same", {
          address: {
            hostId: "HOST",
            routingAddress: "same",
            conversationId: "same-a",
            ownerClientId: "same-owner-a",
            aliases: ["same"],
          },
        }),
        b: heartbeat("same", {
          address: {
            hostId: "HOST",
            routingAddress: "same",
            conversationId: "same-b",
            ownerClientId: "same-owner-b",
            aliases: ["same"],
          },
        }),
        remote: heartbeat("remote", {
          address: {
            hostId: "REMOTE",
            routingAddress: "remote",
            conversationId: "remote-conversation",
            ownerClientId: "remote-owner",
            aliases: ["remote"],
          },
        }),
        mismatch: heartbeat("mismatch"),
      },
      now: NOW,
      staleAfterMs: 60_000,
    });

    expect(
      resolveCodexBinding({
        registry,
        target: { routingAddress: "stale" },
        localHostId: "HOST",
      }),
    ).toMatchObject({ status: "blocked", reason: "stale" });

    expect(
      resolveCodexBinding({
        registry,
        target: { routingAddress: "same" },
        localHostId: "HOST",
      }),
    ).toMatchObject({ status: "blocked", reason: "ambiguous" });

    expect(
      resolveCodexBinding({
        registry,
        target: { routingAddress: "remote" },
        localHostId: "HOST",
      }),
    ).toMatchObject({ status: "blocked", reason: "not-reachable" });

    expect(
      resolveCodexBinding({
        registry,
        target: { routingAddress: "mismatch" },
        localHostId: "HOST",
        liveSnapshot: {
          transport: "codex-ipc",
          connected: true,
          connectedAt: NOW,
          agents: [],
          conversations: [],
        },
      }),
    ).toMatchObject({ status: "blocked", reason: "binding-mismatch" });
  });

  it("exports delivery request and result contracts for adapter callers", () => {
    const request: CodexA2ADeliveryRequest = {
      adapter: "ipc-direct",
      target: {
        routingAddress: "ko",
        hostId: "HOST",
        conversationId: "ko-conversation",
        ownerClientId: "ko-owner",
      },
      message: {
        sender: { routingAddress: "윤", displayName: "윤" },
        recipient: { routingAddress: "ko", displayName: "코" },
        subject: "contract-smoke",
        content: "hello",
        fileName: "contract.md",
      },
    };
    const delivered: CodexA2ADeliveryResult = {
      status: "delivered",
      adapter: request.adapter,
      turnId: "turn-1",
      consentRef: "receipt-1",
    };
    const blocked: CodexA2ADeliveryResult = {
      status: "blocked",
      adapter: "ipc-direct",
      reason: "recipient-active-turn",
      message: "recipient is busy",
      fallbackToInbox: true,
    };

    expect(delivered.adapter).toBe("ipc-direct");
    expect(blocked.reason).toBe("recipient-active-turn");
  });
});
