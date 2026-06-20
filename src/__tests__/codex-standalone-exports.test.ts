import { describe, expect, it } from "vitest";
import {
  buildCodexBindingRegistry,
  resolveCodexBinding,
  type CodexBindingHeartbeat,
} from "../codex-a2a/index.js";
import {
  CODEX_IPC_DRIVE_METHODS,
  decodeCodexIpcFrames,
  encodeCodexIpcFrame,
  isCodexIpcDefaultSupported,
  resolveCodexIpcPath,
} from "../codex-ipc/index.js";
import {
  classifyCodexBindings,
  isStaleActiveInProgressConversation,
  isStuckInProgressConversation,
} from "../codex-health/index.js";

const NOW = "2026-05-25T10:00:00.000Z";

function heartbeat(): CodexBindingHeartbeat {
  return {
    id: "코",
    agent: "코",
    status: "active",
    lastActivity: NOW,
    receiveTransports: ["consent-drive"],
    address: {
      hostId: "D:\\HUA\\hua-comms",
      routingAddress: "코",
      conversationId: "thread-ko",
      ownerClientId: "owner-ko",
      aliases: ["코"],
    },
  };
}

describe("Codex standalone export boundaries", () => {
  it("exposes the codex-a2a binding registry through the future standalone boundary", () => {
    const registry = buildCodexBindingRegistry({
      heartbeats: { ko: heartbeat() },
      now: NOW,
    });

    const result = resolveCodexBinding({
      registry,
      target: { routingAddress: "코" },
      localHostId: "D:\\HUA\\hua-comms",
    });

    expect(result.status).toBe("resolved");
    if (result.status !== "resolved") return;
    expect(result.binding).toMatchObject({
      routingAddress: "코",
      conversationId: "thread-ko",
      ownerClientId: "owner-ko",
      bindingStatus: "ready",
    });
  });

  it("exposes Codex IPC endpoint and frame helpers through the future standalone boundary", () => {
    expect(isCodexIpcDefaultSupported("win32")).toBe(true);
    expect(isCodexIpcDefaultSupported("darwin")).toBe(true);
    expect(isCodexIpcDefaultSupported("linux")).toBe(false);
    expect(resolveCodexIpcPath({ platform: "win32" })).toBe(
      String.raw`\\.\pipe\codex-ipc`,
    );
    expect(
      resolveCodexIpcPath({
        platform: "darwin",
        tmpDir: "/tmp/example/",
        uid: 501,
      }),
    ).toBe("/tmp/example/codex-ipc/ipc-501.sock");
    expect(CODEX_IPC_DRIVE_METHODS).toContain("thread-follower-start-turn");

    const encoded = encodeCodexIpcFrame({
      type: "request",
      requestId: "request-1",
      method: "initialize",
      params: { clientType: "tap-export-fixture" },
    });
    const decoded = decodeCodexIpcFrames(encoded);
    expect(decoded.messages[0]).toMatchObject({
      type: "request",
      requestId: "request-1",
      method: "initialize",
    });
  });

  it("exposes Codex runtime health classification through the future standalone boundary", () => {
    const stuckConversation = {
      conversationId: "thread-ko",
      hostId: "D:\\HUA\\hua-comms",
      ownerClientId: "owner-ko",
      lastChangeType: "snapshot",
      lastTurn: {
        turnId: "turn-stuck",
        status: "inProgress",
        turnStartedAgeSeconds: 121,
        durationMs: null,
        finalAssistantStartedAtMs: null,
        itemCount: 0,
      },
      lastSeenAt: NOW,
    };

    expect(
      isStuckInProgressConversation(stuckConversation, {
        stuckTurnSeconds: 120,
      }),
    ).toBe(true);

    const [classified] = classifyCodexBindings(
      [
        {
          id: "코",
          agent: "코",
          routingAddress: "코",
          receiveTransports: ["consent-drive"],
          hostId: "D:\\HUA\\hua-comms",
          conversationId: "thread-ko",
          ownerClientId: "owner-ko",
        },
      ],
      {
        supported: true,
        connected: true,
        initializedClientId: "observer",
        conversations: [stuckConversation],
        agents: [],
        error: null,
      },
      { checkedAt: NOW, stuckTurnSeconds: 120 },
    );

    expect(classified?.lifecycleStatus).toBe("ready");
    expect(classified?.health.status).toBe("stuck-turn");
    expect(classified?.health.recovery).toContain("--interrupt-stuck");
  });

  it("exposes stale active turn classification through the standalone boundary", () => {
    const staleActiveConversation = {
      conversationId: "thread-ko",
      hostId: "D:\\HUA\\hua-comms",
      ownerClientId: "owner-ko",
      lastChangeType: "snapshot",
      lastTurn: {
        turnId: "turn-stale-active",
        status: "inProgress",
        turnStartedAgeSeconds: 601,
        durationMs: null,
        finalAssistantStartedAtMs: 1,
        itemCount: 11,
      },
      lastSeenAt: NOW,
    };

    expect(
      isStaleActiveInProgressConversation(staleActiveConversation, {
        staleActiveTurnSeconds: 600,
      }),
    ).toBe(true);

    const [classified] = classifyCodexBindings(
      [
        {
          id: "코",
          agent: "코",
          routingAddress: "코",
          receiveTransports: ["consent-drive"],
          hostId: "D:\\HUA\\hua-comms",
          conversationId: "thread-ko",
          ownerClientId: "owner-ko",
        },
      ],
      {
        supported: true,
        connected: true,
        initializedClientId: "observer",
        conversations: [staleActiveConversation],
        agents: [],
        error: null,
      },
      { checkedAt: NOW, staleActiveTurnSeconds: 600 },
    );

    expect(classified?.lifecycleStatus).toBe("ready");
    expect(classified?.health.status).toBe("stale-active-turn");
    expect(classified?.health.recovery).toContain("--interrupt-stale-active");
  });
});
