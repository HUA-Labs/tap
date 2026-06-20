import { describe, expect, it } from "vitest";
import {
  buildCodexBindingRegistry,
  resolveCodexBinding,
  type CodexBindingRuntimeHealth,
} from "../routing/codex-binding-registry.js";
import type { ObserveTransportSnapshot } from "../transport/types.js";

const now = "2026-05-21T01:30:00.000Z";

function health(
  overrides: Partial<CodexBindingRuntimeHealth> = {},
): CodexBindingRuntimeHealth {
  return {
    status: "ready",
    reason: null,
    checkedAt: now,
    adapter: "codex-windows-lifecycle",
    recovery: null,
    ...overrides,
  };
}

function snapshot(
  conversationId: string,
  ownerClientId: string,
  hostId = "DEVIN",
): ObserveTransportSnapshot {
  return {
    transport: "experimental-codex-ipc-observe",
    connected: true,
    connectedAt: now,
    agents: [
      {
        id: ownerClientId,
        name: "담",
        address: {
          hostId,
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
          hostId,
          clientId: ownerClientId,
          conversationId,
          ownerClientId,
        },
        metadata: { lastActivity: now },
      },
    ],
  };
}

function disconnectedSnapshot(
  conversationId: string,
  ownerClientId: string,
  hostId = "DEVIN",
): ObserveTransportSnapshot {
  return {
    ...snapshot(conversationId, ownerClientId, hostId),
    connected: false,
    connectedAt: null,
  };
}

describe("Codex binding registry", () => {
  it("resolves a single fresh Codex consent-drive binding", () => {
    const registry = buildCodexBindingRegistry({
      now,
      heartbeats: {
        codex_worker: {
          id: "codex_worker",
          agent: "담",
          status: "active",
          lastActivity: now,
          instanceId: "codex-worker",
          receiveTransports: ["consent-drive"],
          address: {
            hostId: "DEVIN",
            clientId: "codex-worker",
            conversationId: "thread-1",
            ownerClientId: "codex-worker",
            routingAddress: "codex-worker",
          },
        },
      },
    });

    const result = resolveCodexBinding({
      registry,
      target: { agentName: "담" },
      localHostId: "DEVIN",
    });

    expect(result.status).toBe("resolved");
    if (result.status === "resolved") {
      expect(result.binding).toMatchObject({
        routingAddress: "codex-worker",
        conversationId: "thread-1",
        ownerClientId: "codex-worker",
      });
    }
  });

  it("fails closed when the target has no explicit selector", () => {
    const registry = buildCodexBindingRegistry({
      now,
      observeSnapshot: snapshot("thread-1", "codex-worker"),
    });

    const result = resolveCodexBinding({
      registry,
      target: {},
      localHostId: "DEVIN",
    });

    expect(result).toMatchObject({
      status: "blocked",
      reason: "missing-target",
    });
  });

  it("fails closed when the only matching binding is stale", () => {
    const registry = buildCodexBindingRegistry({
      now,
      staleAfterMs: 60_000,
      heartbeats: {
        codex_worker: {
          id: "codex_worker",
          agent: "담",
          status: "active",
          lastActivity: "2026-05-21T01:20:00.000Z",
          instanceId: "codex-worker",
          receiveTransports: ["consent-drive"],
          address: {
            hostId: "DEVIN",
            clientId: "codex-worker",
            conversationId: "thread-1",
            ownerClientId: "codex-worker",
          },
        },
      },
    });

    const result = resolveCodexBinding({
      registry,
      target: { agentName: "담" },
      localHostId: "DEVIN",
    });

    expect(result).toMatchObject({
      status: "blocked",
      reason: "stale",
    });
  });

  it("uses the same thirty-minute default freshness window as tap presence", () => {
    const registry = buildCodexBindingRegistry({
      now,
      heartbeats: {
        codex_worker: {
          id: "codex_worker",
          agent: "담",
          status: "active",
          lastActivity: "2026-05-21T01:01:00.000Z",
          instanceId: "codex-worker",
          receiveTransports: ["consent-drive"],
          address: {
            hostId: "DEVIN",
            clientId: "codex-worker",
            conversationId: "thread-1",
            ownerClientId: "codex-worker",
          },
        },
      },
    });

    const result = resolveCodexBinding({
      registry,
      target: { agentName: "담" },
      localHostId: "DEVIN",
    });

    expect(registry.staleAfterMs).toBe(30 * 60 * 1000);
    expect(result.status).toBe("resolved");
  });

  it("allows a live observe binding to refresh stale heartbeat metadata", () => {
    const registry = buildCodexBindingRegistry({
      now,
      staleAfterMs: 60_000,
      heartbeats: {
        codex_worker: {
          id: "codex_worker",
          agent: "담",
          status: "active",
          lastActivity: "2026-05-21T01:20:00.000Z",
          instanceId: "codex-worker",
          receiveTransports: ["consent-drive"],
          address: {
            hostId: "DEVIN",
            clientId: "codex-worker",
            conversationId: "thread-1",
            ownerClientId: "codex-worker",
            routingAddress: "codex-worker",
          },
        },
      },
      observeSnapshot: snapshot("thread-1", "codex-worker"),
    });

    const result = resolveCodexBinding({
      registry,
      target: { routingAddress: "codex-worker" },
      localHostId: "DEVIN",
      liveSnapshot: snapshot("thread-1", "codex-worker"),
    });

    expect(result.status).toBe("resolved");
    if (result.status === "resolved") {
      expect(result.binding).toMatchObject({
        staleReason: null,
        lastSeenAt: now,
      });
    }
  });

  it("prefers fresh capabilities tuple over legacy heartbeat address tuple", () => {
    const registry = buildCodexBindingRegistry({
      now,
      heartbeats: {
        codex_worker: {
          id: "codex_worker",
          agent: "담",
          status: "active",
          lastActivity: now,
          instanceId: "codex-worker",
          receiveTransports: ["consent-drive"],
          address: {
            hostId: "DEVIN",
            clientId: "codex-worker",
            conversationId: "old-thread",
            ownerClientId: "old-owner",
            routingAddress: "codex-worker",
          },
          capabilities: {
            conversationId: "thread-1",
            ownerClientId: "codex-worker",
          },
        },
      },
    });

    expect(registry.bindings[0]).toMatchObject({
      conversationId: "thread-1",
      ownerClientId: "codex-worker",
      bindingStatus: "ready",
    });
  });

  it("preserves heartbeat-published runtime health on bindings", () => {
    const registry = buildCodexBindingRegistry({
      now,
      heartbeats: {
        codex_worker: {
          id: "codex_worker",
          agent: "담",
          status: "active",
          lastActivity: now,
          instanceId: "codex-worker",
          receiveTransports: ["consent-drive"],
          address: {
            hostId: "DEVIN",
            clientId: "codex-worker",
            conversationId: "thread-1",
            ownerClientId: "codex-worker",
            routingAddress: "codex-worker",
          },
          health: health({
            status: "stuck-turn",
            reason: "inProgress with no assistant output",
            recovery: "pnpm codex:windows -- --interrupt-stuck",
          }),
        },
      },
    });

    expect(registry.bindings[0].health).toMatchObject({
      status: "stuck-turn",
      reason: "inProgress with no assistant output",
      recovery: "pnpm codex:windows -- --interrupt-stuck",
    });
  });

  it("keeps the more severe runtime health when duplicate bindings merge", () => {
    const registry = buildCodexBindingRegistry({
      now,
      heartbeats: {
        codex_bridge: {
          id: "codex_bridge",
          agent: "담",
          status: "active",
          source: "bridge-dispatch",
          lastActivity: now,
          instanceId: "codex-worker",
          receiveTransports: ["consent-drive"],
          address: {
            hostId: "DEVIN",
            clientId: "codex-worker",
            conversationId: "thread-1",
            ownerClientId: "codex-worker",
            routingAddress: "codex-worker",
          },
          health: health({ status: "ready" }),
        },
        codex_mcp: {
          id: "codex_mcp",
          agent: "담",
          status: "active",
          source: "mcp-direct",
          lastActivity: now,
          instanceId: "codex-worker",
          receiveTransports: ["consent-drive"],
          address: {
            hostId: "DEVIN",
            clientId: "codex-worker",
            conversationId: "thread-1",
            ownerClientId: "codex-worker",
            routingAddress: "codex-worker",
          },
          health: health({
            status: "stuck-turn",
            checkedAt: "2026-05-21T01:29:00.000Z",
          }),
        },
      },
    });

    expect(registry.bindings).toHaveLength(1);
    expect(registry.bindings[0].health?.status).toBe("stuck-turn");
  });

  it("blocks partial bindings with conversationId but no ownerClientId", () => {
    const registry = buildCodexBindingRegistry({
      now,
      heartbeats: {
        codex_ha: {
          id: "codex_ha",
          agent: "하",
          status: "active",
          lastActivity: now,
          instanceId: "codex-ha",
          receiveTransports: ["consent-drive"],
          address: {
            hostId: "DEVIN",
            clientId: "codex-ha",
            conversationId: "thread-ha",
            ownerClientId: null,
            routingAddress: "하",
          },
          capabilities: {
            receiveTransports: ["consent-drive"],
            conversationId: "thread-ha",
            ownerClientId: null,
          },
        },
      },
    });

    expect(registry.bindings[0]).toMatchObject({
      routingAddress: "하",
      conversationId: "thread-ha",
      ownerClientId: null,
      bindingStatus: "partial",
    });

    const result = resolveCodexBinding({
      registry,
      target: { routingAddress: "하" },
      localHostId: "DEVIN",
    });

    expect(result).toMatchObject({
      status: "blocked",
      reason: "partial",
    });
  });

  it("fails closed when a target name maps to multiple fresh Codex bindings", () => {
    const registry = buildCodexBindingRegistry({
      now,
      heartbeats: {
        codex_a: {
          id: "codex_a",
          agent: "담",
          status: "active",
          lastActivity: now,
          instanceId: "codex-a",
          receiveTransports: ["consent-drive"],
          address: {
            hostId: "DEVIN",
            clientId: "codex-a",
            conversationId: "thread-a",
            ownerClientId: "codex-a",
          },
        },
        codex_b: {
          id: "codex_b",
          agent: "담",
          status: "active",
          lastActivity: now,
          instanceId: "codex-b",
          receiveTransports: ["consent-drive"],
          address: {
            hostId: "DEVIN",
            clientId: "codex-b",
            conversationId: "thread-b",
            ownerClientId: "codex-b",
          },
        },
      },
    });

    const result = resolveCodexBinding({
      registry,
      target: { agentName: "담" },
      localHostId: "DEVIN",
    });

    expect(result).toMatchObject({
      status: "blocked",
      reason: "ambiguous",
    });
  });

  it("rejects stale heartbeat metadata when the live IPC snapshot disagrees", () => {
    const registry = buildCodexBindingRegistry({
      now,
      heartbeats: {
        codex_worker: {
          id: "codex_worker",
          agent: "담",
          status: "active",
          lastActivity: now,
          instanceId: "codex-worker",
          receiveTransports: ["consent-drive"],
          address: {
            hostId: "DEVIN",
            clientId: "codex-worker",
            conversationId: "thread-1",
            ownerClientId: "old-owner",
          },
        },
      },
    });

    const result = resolveCodexBinding({
      registry,
      target: { routingAddress: "codex-worker" },
      localHostId: "DEVIN",
      liveSnapshot: snapshot("thread-1", "new-owner"),
    });

    expect(result).toMatchObject({
      status: "blocked",
      reason: "binding-mismatch",
    });
  });

  it("rejects same-user metadata that points at a different host", () => {
    const registry = buildCodexBindingRegistry({
      now,
      observeSnapshot: snapshot("thread-1", "codex-worker", "REMOTE"),
    });

    const result = resolveCodexBinding({
      registry,
      target: { routingAddress: "codex-worker" },
      localHostId: "DEVIN",
    });

    expect(result).toMatchObject({
      status: "blocked",
      reason: "not-reachable",
    });
  });

  it("does not treat disconnected observe cache as a live binding source", () => {
    const cachedSnapshot = disconnectedSnapshot("thread-1", "codex-worker");
    const registry = buildCodexBindingRegistry({
      now,
      observeSnapshot: cachedSnapshot,
    });

    const result = resolveCodexBinding({
      registry,
      target: { routingAddress: "codex-worker" },
      localHostId: "DEVIN",
      liveSnapshot: cachedSnapshot,
    });

    expect(registry.bindings).toHaveLength(0);
    expect(result).toMatchObject({
      status: "blocked",
      reason: "not-found",
    });
  });

  it("does not let disconnected live snapshots validate heartbeat bindings", () => {
    const registry = buildCodexBindingRegistry({
      now,
      heartbeats: {
        codex_worker: {
          id: "codex_worker",
          agent: "담",
          status: "active",
          lastActivity: now,
          instanceId: "codex-worker",
          receiveTransports: ["consent-drive"],
          address: {
            hostId: "DEVIN",
            clientId: "codex-worker",
            conversationId: "thread-1",
            ownerClientId: "codex-worker",
          },
        },
      },
    });

    const result = resolveCodexBinding({
      registry,
      target: { routingAddress: "codex-worker" },
      localHostId: "DEVIN",
      liveSnapshot: disconnectedSnapshot("thread-1", "codex-worker"),
    });

    expect(result).toMatchObject({
      status: "blocked",
      reason: "binding-mismatch",
    });
  });
});
