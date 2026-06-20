import { afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  parseRemoteCodexHosts,
  parseRemoteRelayProcessResult,
  type RemoteCodexRelayExecutor,
  routeTapReplyDelivery,
} from "../tap-drive-routing.js";
import type { TapAddressMetadata } from "../tap-utils.js";
import type {
  CodexBindingHeartbeat,
  CodexBindingRuntimeHealth,
} from "../../../../src/routing/codex-binding-registry.js";

function makeAddress(
  overrides: Partial<TapAddressMetadata> = {},
): TapAddressMetadata {
  return {
    hostId: "DEVIN",
    clientId: "codex-wt-2",
    conversationId: "thread-42",
    ownerClientId: "codex-wt-2",
    routingAddress: "codex-wt-2",
    slot: "wt-2",
    aliases: ["codex-wt-2", "온"],
    ...overrides,
  };
}

function makeHeartbeat(
  overrides: Partial<CodexBindingHeartbeat> = {},
): CodexBindingHeartbeat {
  const { address: addressOverride, ...rest } = overrides;
  const addressOverrides: Partial<TapAddressMetadata> = {};
  if (addressOverride?.hostId !== undefined) {
    addressOverrides.hostId = addressOverride.hostId;
  }
  if (addressOverride?.clientId !== undefined) {
    addressOverrides.clientId = addressOverride.clientId;
  }
  if (addressOverride?.conversationId !== undefined) {
    addressOverrides.conversationId = addressOverride.conversationId;
  }
  if (addressOverride?.ownerClientId !== undefined) {
    addressOverrides.ownerClientId = addressOverride.ownerClientId;
  }
  if (addressOverride?.routingAddress != null) {
    addressOverrides.routingAddress = addressOverride.routingAddress;
  }
  if (addressOverride?.aliases !== undefined) {
    addressOverrides.aliases = addressOverride.aliases;
  }
  const address = makeAddress(addressOverrides);
  return {
    id: "codex-wt-2",
    agent: "온",
    status: "active",
    source: "bridge-dispatch",
    timestamp: new Date().toISOString(),
    lastActivity: new Date().toISOString(),
    instanceId: "codex-wt-2",
    receiveTransports: ["consent-drive"],
    address,
    capabilities: {
      receiveTransports: ["consent-drive"],
      conversationId: address.conversationId,
      ownerClientId: address.ownerClientId,
    },
    ...rest,
  };
}

function makeHealth(
  overrides: Partial<CodexBindingRuntimeHealth> = {},
): CodexBindingRuntimeHealth {
  return {
    status: "ready",
    reason: null,
    checkedAt: "2026-05-24T01:00:00.000Z",
    adapter: "codex-windows-lifecycle",
    recovery: null,
    ...overrides,
  };
}

const tempRoots: string[] = [];

function makeCommsDirWithTrustedDeviceLease(
  leases: Array<{
    deviceId: string;
    hostId: string;
    expiresAt?: string;
    revokedAt?: string | null;
  }>,
): string {
  const commsDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "tap-drive-lease-test-"),
  );
  tempRoots.push(commsDir);
  const devicesDir = path.join(commsDir, "devices");
  fs.mkdirSync(devicesDir, { recursive: true });
  for (const lease of leases) {
    fs.writeFileSync(
      path.join(devicesDir, `${lease.deviceId}.json`),
      JSON.stringify(
        {
          deviceId: lease.deviceId,
          hostId: lease.hostId,
          label: lease.deviceId,
          publicKeyHash: `sha256:${lease.deviceId}`,
          operator: "Devin",
          allowedScopes: ["drive"],
          allowedTargets: ["self-owned"],
          issuedAt: "2026-06-01T00:00:00.000Z",
          expiresAt: lease.expiresAt ?? "2026-07-01T00:00:00.000Z",
          lastSeenAt: "2026-06-01T00:05:00.000Z",
          revokedAt: lease.revokedAt ?? null,
        },
        null,
        2,
      ),
      "utf-8",
    );
  }
  return commsDir;
}

afterEach(() => {
  while (tempRoots.length) {
    fs.rmSync(tempRoots.pop()!, { recursive: true, force: true });
  }
});

describe("tap drive routing", () => {
  it("prefers consent-drive for eligible Codex targets", async () => {
    const transport = {
      connect: vi.fn(async () => undefined),
      disconnect: vi.fn(async () => undefined),
      createConsentReceipt: vi.fn(() => ({
        receipt: { id: "receipt-1" },
      })),
      startTurn: vi.fn(async () => ({
        response: {
          result: {
            turn: {
              id: "turn-1",
            },
          },
        },
      })),
    };

    const result = await routeTapReplyDelivery({
      commsDir: "D:/HUA/hua-comms",
      localHostId: "DEVIN",
      sender: {
        routingAddress: "담",
        displayName: "담",
      },
      target: {
        routingAddress: "온",
        displayName: "온",
        address: makeAddress(),
        receiveTransports: ["consent-drive"],
      },
      subject: "realtime-verify",
      content: "한 줄 답장 부탁해.",
      fileName: "20260419-담-온-realtime-verify.md",
      heartbeats: {
        "codex-wt-2": makeHeartbeat(),
      },
      transportFactory: () => transport,
    });

    expect(result).toEqual({
      transport: "consent-drive",
      delivered: true,
      fallbackToInbox: false,
      turnId: "turn-1",
      consentRef: "receipt-1",
      warning: null,
    });
    expect(transport.connect).toHaveBeenCalledTimes(1);
    expect(transport.createConsentReceipt).toHaveBeenCalledWith({
      conversationId: "thread-42",
      hostId: "DEVIN",
      ownerClientId: "codex-wt-2",
      allowedMethods: ["thread-follower-start-turn"],
    });
    expect(transport.startTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: "thread-42",
        consentRef: "receipt-1",
        hostId: "DEVIN",
        ownerClientId: "codex-wt-2",
      }),
    );
    const startTurnCall = transport.startTurn.mock.calls[0]?.at(0) as
      | { text?: string }
      | undefined;
    expect(startTurnCall?.text).toContain("Reply available: 담");
    expect(startTurnCall?.text).not.toContain("Use tap_reply");
    expect(transport.disconnect).toHaveBeenCalledTimes(1);
  });

  it("keeps mcp-channel delivery for non-Codex targets", async () => {
    const transportFactory = vi.fn();

    const result = await routeTapReplyDelivery({
      commsDir: "D:/HUA/hua-comms",
      localHostId: "DEVIN",
      sender: {
        routingAddress: "담",
        displayName: "담",
      },
      target: {
        routingAddress: "빛",
        displayName: "빛",
        address: null,
        receiveTransports: ["mcp-channel"],
      },
      subject: "status-check",
      content: "지금 상태 어때?",
      fileName: "20260419-담-빛-status-check.md",
      transportFactory: transportFactory as never,
    });

    expect(result).toEqual({
      transport: "mcp-channel",
      delivered: false,
      fallbackToInbox: true,
      turnId: null,
      consentRef: null,
      warning: null,
    });
    expect(transportFactory).not.toHaveBeenCalled();
  });

  it("keeps explicit envelopes on the inbox path", async () => {
    const transportFactory = vi.fn();

    const result = await routeTapReplyDelivery({
      commsDir: "D:/HUA/hua-comms",
      localHostId: "DEVIN",
      explicitEnvelope: true,
      sender: {
        routingAddress: "담",
        displayName: "담",
      },
      target: {
        routingAddress: "온",
        displayName: "온",
        address: makeAddress(),
        receiveTransports: ["consent-drive"],
      },
      subject: "structured-drive",
      content: "이건 명시적 envelope 라우팅이야.",
      fileName: "20260419-담-온-structured-drive.md",
      transportFactory: transportFactory as never,
    });

    expect(result).toEqual({
      transport: "mcp-channel",
      delivered: false,
      fallbackToInbox: true,
      turnId: null,
      consentRef: null,
      warning:
        "⚠️ 온 includes explicit A2A envelope metadata. Current tap_reply treats explicit envelopes as inbox/audit evidence only and does not use them to bypass consent-drive routing. Falling back to inbox delivery.",
    });
    expect(transportFactory).not.toHaveBeenCalled();
  });

  it("falls back to inbox when consent-drive delivery fails", async () => {
    const transport = {
      connect: vi.fn(async () => undefined),
      disconnect: vi.fn(async () => undefined),
      createConsentReceipt: vi.fn(() => ({
        receipt: { id: "receipt-2" },
      })),
      startTurn: vi.fn(async () => {
        throw new Error("desktop unavailable");
      }),
    };

    const result = await routeTapReplyDelivery({
      commsDir: "D:/HUA/hua-comms",
      localHostId: "DEVIN",
      sender: {
        routingAddress: "담",
        displayName: "담",
      },
      target: {
        routingAddress: "온",
        displayName: "온",
        address: makeAddress(),
        receiveTransports: ["consent-drive"],
      },
      subject: "fallback-check",
      content: "실패하면 inbox로 가야 해.",
      fileName: "20260419-담-온-fallback-check.md",
      heartbeats: {
        "codex-wt-2": makeHeartbeat(),
      },
      transportFactory: () => transport,
    });

    expect(result.transport).toBe("mcp-channel");
    expect(result.delivered).toBe(false);
    expect(result.fallbackToInbox).toBe(true);
    expect(result.warning).toContain("consent-drive delivery to 온 failed");
    expect(transport.disconnect).toHaveBeenCalledTimes(1);
  });

  it("reports stale owner binding when local IPC returns no-client-found", async () => {
    const transport = {
      connect: vi.fn(async () => undefined),
      disconnect: vi.fn(async () => undefined),
      createConsentReceipt: vi.fn(() => ({
        receipt: { id: "receipt-stale" },
      })),
      startTurn: vi.fn(async () => {
        throw new Error('Codex IPC request failed: "no-client-found"');
      }),
    };

    const result = await routeTapReplyDelivery({
      commsDir: "D:/HUA/hua-comms",
      localHostId: "DEVIN",
      sender: {
        routingAddress: "담",
        displayName: "담",
      },
      target: {
        routingAddress: "온",
        displayName: "온",
        address: makeAddress(),
        receiveTransports: ["consent-drive"],
      },
      subject: "stale-owner-check",
      content: "owner stale 이면 명확해야 해.",
      fileName: "20260522-담-온-stale-owner-check.md",
      heartbeats: {
        "codex-wt-2": makeHeartbeat(),
      },
      transportFactory: () => transport,
    });

    expect(result.transport).toBe("mcp-channel");
    expect(result.fallbackToInbox).toBe(true);
    expect(result.warning).toContain("ownerClientId appears stale");
    expect(result.warning).toContain("no-client-found");
  });

  it("refreshes a stale local owner once when IPC returns no-client-found", async () => {
    const transport = {
      connect: vi.fn(async () => undefined),
      disconnect: vi.fn(async () => undefined),
      createConsentReceipt: vi.fn(() => ({
        receipt: { id: "receipt-refresh" },
      })),
      startTurn: vi
        .fn()
        .mockRejectedValueOnce(
          new Error('Codex IPC request failed: "no-client-found"'),
        )
        .mockResolvedValueOnce({
          response: {
            result: {
              turn: {
                id: "turn-refreshed",
              },
            },
          },
        }),
    };

    const result = await routeTapReplyDelivery({
      commsDir: "D:/HUA/hua-comms",
      localHostId: "DEVIN",
      sender: {
        routingAddress: "담",
        displayName: "담",
      },
      target: {
        routingAddress: "온",
        displayName: "온",
        address: makeAddress(),
        receiveTransports: ["consent-drive"],
      },
      subject: "stale-owner-refresh",
      content: "owner stale 이면 refresh 후 재시도.",
      fileName: "20260522-담-온-stale-owner-refresh.md",
      heartbeats: {
        "codex-wt-2": makeHeartbeat({
          address: makeAddress({
            ownerClientId: "owner-stale",
          }),
          capabilities: {
            receiveTransports: ["consent-drive"],
            conversationId: "thread-42",
            ownerClientId: "owner-stale",
          },
        }),
      },
      ownerDiscovery: vi.fn(async () => ({
        status: "found" as const,
        conversationId: "thread-42",
        ownerClientId: "owner-fresh",
        hostId: "DEVIN",
        source: "event" as const,
      })),
      transportFactory: () => transport,
    });

    expect(result).toMatchObject({
      transport: "consent-drive",
      delivered: true,
      turnId: "turn-refreshed",
      warning: null,
    });
    expect(transport.createConsentReceipt).toHaveBeenNthCalledWith(1, {
      conversationId: "thread-42",
      hostId: "DEVIN",
      ownerClientId: "owner-stale",
      allowedMethods: ["thread-follower-start-turn"],
    });
    expect(transport.createConsentReceipt).toHaveBeenNthCalledWith(2, {
      conversationId: "thread-42",
      hostId: "DEVIN",
      ownerClientId: "owner-fresh",
      allowedMethods: ["thread-follower-start-turn"],
    });
  });

  it("resolves consent-drive in dry-run mode without opening transport", async () => {
    const transportFactory = vi.fn();

    const result = await routeTapReplyDelivery({
      commsDir: "D:/HUA/hua-comms",
      localHostId: "DEVIN",
      sender: {
        routingAddress: "담",
        displayName: "담",
      },
      target: {
        routingAddress: "온",
        displayName: "온",
        address: makeAddress(),
        receiveTransports: ["consent-drive"],
      },
      subject: "dry-run-check",
      content: "실제 주입 없이 경로만 확인해.",
      fileName: "20260419-담-온-dry-run-check.md",
      heartbeats: {
        "codex-wt-2": makeHeartbeat(),
      },
      dryRun: true,
      transportFactory: transportFactory as never,
    });

    expect(result).toEqual({
      transport: "consent-drive",
      delivered: false,
      fallbackToInbox: false,
      turnId: null,
      consentRef: null,
      warning: null,
      dryRun: true,
    });
    expect(transportFactory).not.toHaveBeenCalled();
  });

  it("allows auto-minted consent receipts when trusted-device lease gate passes", async () => {
    const commsDir = makeCommsDirWithTrustedDeviceLease([
      {
        deviceId: "devin-local",
        hostId: "DEVIN",
      },
    ]);
    const transport = {
      connect: vi.fn(async () => undefined),
      disconnect: vi.fn(async () => undefined),
      createConsentReceipt: vi.fn(() => ({
        receipt: { id: "receipt-trusted" },
      })),
      startTurn: vi.fn(async () => ({
        response: {
          result: {
            turn: {
              id: "turn-trusted",
            },
          },
        },
      })),
    };

    const result = await routeTapReplyDelivery({
      commsDir,
      localHostId: "DEVIN",
      sender: {
        routingAddress: "담",
        displayName: "담",
      },
      target: {
        routingAddress: "온",
        displayName: "온",
        address: makeAddress(),
        receiveTransports: ["consent-drive"],
      },
      subject: "trusted-device-check",
      content: "trusted device lease gate 통과.",
      fileName: "20260601-담-온-trusted-device-check.md",
      heartbeats: {
        "codex-wt-2": makeHeartbeat(),
      },
      now: "2026-06-01T00:10:00.000Z",
      trustedDeviceLeases: {
        enabled: true,
      },
      transportFactory: () => transport,
    });

    expect(result).toMatchObject({
      transport: "consent-drive",
      delivered: true,
      turnId: "turn-trusted",
      consentRef: "receipt-trusted",
      warning: null,
    });
    expect(transport.createConsentReceipt).toHaveBeenCalledTimes(1);
  });

  it("fails closed before opening transport when trusted-device lease is expired", async () => {
    const commsDir = makeCommsDirWithTrustedDeviceLease([
      {
        deviceId: "devin-local",
        hostId: "DEVIN",
        expiresAt: "2026-05-31T00:00:00.000Z",
      },
    ]);
    const transportFactory = vi.fn();

    const result = await routeTapReplyDelivery({
      commsDir,
      localHostId: "DEVIN",
      sender: {
        routingAddress: "담",
        displayName: "담",
      },
      target: {
        routingAddress: "온",
        displayName: "온",
        address: makeAddress(),
        receiveTransports: ["consent-drive"],
      },
      subject: "trusted-device-expired",
      content: "expired lease면 열면 안 됨.",
      fileName: "20260601-담-온-trusted-device-expired.md",
      heartbeats: {
        "codex-wt-2": makeHeartbeat(),
      },
      now: "2026-06-01T00:10:00.000Z",
      trustedDeviceLeases: {
        enabled: true,
      },
      transportFactory: transportFactory as never,
    });

    expect(result.transport).toBe("mcp-channel");
    expect(result.fallbackToInbox).toBe(true);
    expect(result.warning).toContain(
      "trusted-device lease verification failed",
    );
    expect(result.warning).toContain("expired");
    expect(transportFactory).not.toHaveBeenCalled();
    const ledgerDir = path.join(commsDir, "receipts", "consent-ledger");
    const ledgerFiles = fs.readdirSync(ledgerDir);
    expect(ledgerFiles).toHaveLength(1);
    expect(
      fs.readFileSync(path.join(ledgerDir, ledgerFiles[0]), "utf-8"),
    ).toContain("trusted-device-lease-expired");
  });

  it("fails closed to inbox when runtime health reports a stuck turn", async () => {
    const transportFactory = vi.fn();

    const result = await routeTapReplyDelivery({
      commsDir: "D:/HUA/hua-comms",
      localHostId: "DEVIN",
      sender: {
        routingAddress: "담",
        displayName: "담",
      },
      target: {
        routingAddress: "온",
        displayName: "온",
        address: makeAddress(),
        receiveTransports: ["consent-drive"],
      },
      subject: "stuck-turn-check",
      content: "stuck turn 이면 시작하면 안 돼.",
      fileName: "20260524-담-온-stuck-turn-check.md",
      heartbeats: {
        "codex-wt-2": makeHeartbeat({
          health: makeHealth({
            status: "stuck-turn",
            reason: "inProgress with no assistant output",
            recovery:
              "pnpm codex:windows -- --conversation-id thread-42 --interrupt-stuck",
          }),
        }),
      },
      transportFactory: transportFactory as never,
    });

    expect(result.transport).toBe("mcp-channel");
    expect(result.fallbackToInbox).toBe(true);
    expect(result.warning).toContain("runtime health is stuck-turn");
    expect(result.warning).toContain("--interrupt-stuck");
    expect(transportFactory).not.toHaveBeenCalled();
  });

  it("keeps runtime health fail-closed even when trusted-device lease is valid", async () => {
    const commsDir = makeCommsDirWithTrustedDeviceLease([
      {
        deviceId: "devin-local",
        hostId: "DEVIN",
      },
    ]);
    const transportFactory = vi.fn();

    const result = await routeTapReplyDelivery({
      commsDir,
      localHostId: "DEVIN",
      sender: {
        routingAddress: "담",
        displayName: "담",
      },
      target: {
        routingAddress: "온",
        displayName: "온",
        address: makeAddress(),
        receiveTransports: ["consent-drive"],
      },
      subject: "trusted-device-active-turn",
      content: "trusted device여도 active turn이면 시작 금지.",
      fileName: "20260601-담-온-trusted-device-active-turn.md",
      heartbeats: {
        "codex-wt-2": makeHeartbeat({
          health: makeHealth({
            status: "active-turn",
            reason: "recipient has an in-progress turn",
          }),
        }),
      },
      now: "2026-06-01T00:10:00.000Z",
      trustedDeviceLeases: {
        enabled: true,
      },
      transportFactory: transportFactory as never,
    });

    expect(result.transport).toBe("mcp-channel");
    expect(result.fallbackToInbox).toBe(true);
    expect(result.warning).toContain("runtime health is active-turn");
    expect(transportFactory).not.toHaveBeenCalled();
    expect(
      fs.existsSync(path.join(commsDir, "receipts", "consent-ledger")),
    ).toBe(false);
  });

  it("fails closed to inbox when runtime health reports an active turn", async () => {
    const transportFactory = vi.fn();

    const result = await routeTapReplyDelivery({
      commsDir: "D:/HUA/hua-comms",
      localHostId: "DEVIN",
      sender: {
        routingAddress: "담",
        displayName: "담",
      },
      target: {
        routingAddress: "온",
        displayName: "온",
        address: makeAddress(),
        receiveTransports: ["consent-drive"],
      },
      subject: "active-turn-check",
      content: "active turn 이면 nested turn 시작 금지.",
      fileName: "20260524-담-온-active-turn-check.md",
      heartbeats: {
        "codex-wt-2": makeHeartbeat({
          health: makeHealth({
            status: "active-turn",
            reason: "recipient has an in-progress turn",
            recovery: "Wait for the active turn to finish before retrying",
          }),
        }),
      },
      transportFactory: transportFactory as never,
    });

    expect(result.transport).toBe("mcp-channel");
    expect(result.fallbackToInbox).toBe(true);
    expect(result.warning).toContain("runtime health is active-turn");
    expect(result.warning).toContain("Wait for the active turn");
    expect(transportFactory).not.toHaveBeenCalled();
  });

  it("uses runtime health stale-owner guidance before opening transport", async () => {
    const transportFactory = vi.fn();

    const result = await routeTapReplyDelivery({
      commsDir: "D:/HUA/hua-comms",
      localHostId: "DEVIN",
      sender: {
        routingAddress: "담",
        displayName: "담",
      },
      target: {
        routingAddress: "온",
        displayName: "온",
        address: makeAddress(),
        receiveTransports: ["consent-drive"],
      },
      subject: "health-stale-owner",
      content: "health stale-owner면 등록 갱신 안내.",
      fileName: "20260524-담-온-health-stale-owner.md",
      heartbeats: {
        "codex-wt-2": makeHeartbeat({
          health: makeHealth({
            status: "stale-owner",
            reason: "stored owner was not observed over IPC",
          }),
        }),
      },
      transportFactory: transportFactory as never,
    });

    expect(result.transport).toBe("mcp-channel");
    expect(result.fallbackToInbox).toBe(true);
    expect(result.warning).toContain("runtime health is stale-owner");
    expect(result.warning).toContain("tap_register_capabilities");
    expect(result.warning).toContain("omit ownerClientId");
    expect(transportFactory).not.toHaveBeenCalled();
  });

  it("keeps stale-owner fail-closed before trusted-device receipt minting", async () => {
    const commsDir = makeCommsDirWithTrustedDeviceLease([
      {
        deviceId: "devin-local",
        hostId: "DEVIN",
      },
    ]);
    const transportFactory = vi.fn();

    const result = await routeTapReplyDelivery({
      commsDir,
      localHostId: "DEVIN",
      sender: {
        routingAddress: "담",
        displayName: "담",
      },
      target: {
        routingAddress: "온",
        displayName: "온",
        address: makeAddress(),
        receiveTransports: ["consent-drive"],
      },
      subject: "trusted-device-stale-owner",
      content: "trusted device여도 stale owner면 시작 금지.",
      fileName: "20260601-담-온-trusted-device-stale-owner.md",
      heartbeats: {
        "codex-wt-2": makeHeartbeat({
          health: makeHealth({
            status: "stale-owner",
            reason: "stored owner was not observed over IPC",
          }),
        }),
      },
      now: "2026-06-01T00:10:00.000Z",
      trustedDeviceLeases: {
        enabled: true,
      },
      transportFactory: transportFactory as never,
    });

    expect(result.transport).toBe("mcp-channel");
    expect(result.fallbackToInbox).toBe(true);
    expect(result.warning).toContain("runtime health is stale-owner");
    expect(transportFactory).not.toHaveBeenCalled();
  });

  it("uses runtime health partial guidance before opening transport", async () => {
    const transportFactory = vi.fn();
    const ownerDiscovery = vi.fn();

    const result = await routeTapReplyDelivery({
      commsDir: "D:/HUA/hua-comms",
      localHostId: "DEVIN",
      sender: {
        routingAddress: "담",
        displayName: "담",
      },
      target: {
        routingAddress: "하",
        displayName: "하",
        address: makeAddress({
          clientId: "codex-ha",
          conversationId: "thread-ha",
          ownerClientId: null,
          routingAddress: "하",
          aliases: ["하"],
        }),
        receiveTransports: ["consent-drive"],
      },
      subject: "health-partial",
      content: "health partial이면 missing tuple 안내.",
      fileName: "20260524-담-하-health-partial.md",
      heartbeats: {
        하: makeHeartbeat({
          id: "하",
          agent: "하",
          instanceId: "codex-ha",
          address: makeAddress({
            clientId: "codex-ha",
            conversationId: "thread-ha",
            ownerClientId: null,
            routingAddress: "하",
            aliases: ["하"],
          }),
          capabilities: {
            receiveTransports: ["consent-drive"],
            conversationId: "thread-ha",
            ownerClientId: null,
          },
          health: makeHealth({
            status: "partial",
            reason: "ownerClientId missing",
          }),
        }),
      },
      ownerDiscovery,
      transportFactory: transportFactory as never,
    });

    expect(result.transport).toBe("mcp-channel");
    expect(result.fallbackToInbox).toBe(true);
    expect(result.warning).toContain("runtime health is partial");
    expect(result.warning).toContain("conversationId + ownerClientId");
    expect(ownerDiscovery).not.toHaveBeenCalled();
    expect(transportFactory).not.toHaveBeenCalled();
  });

  it("uses the Codex binding registry instead of stale recipient metadata", async () => {
    const transport = {
      connect: vi.fn(async () => undefined),
      disconnect: vi.fn(async () => undefined),
      createConsentReceipt: vi.fn(() => ({
        receipt: { id: "receipt-registry" },
      })),
      startTurn: vi.fn(async () => ({
        response: {
          result: {
            turn: {
              id: "turn-registry",
            },
          },
        },
      })),
    };

    const result = await routeTapReplyDelivery({
      commsDir: "D:/HUA/hua-comms",
      localHostId: "DEVIN",
      sender: {
        routingAddress: "담",
        displayName: "담",
      },
      target: {
        routingAddress: "온",
        displayName: "온",
        address: makeAddress({
          conversationId: "stale-thread",
          ownerClientId: "stale-owner",
        }),
        receiveTransports: ["consent-drive"],
      },
      subject: "registry-check",
      content: "registry binding 을 우선해야 해.",
      fileName: "20260419-담-온-registry-check.md",
      heartbeats: {
        "codex-wt-2": makeHeartbeat({
          capabilities: {
            receiveTransports: ["consent-drive"],
            conversationId: "thread-fresh",
            ownerClientId: "codex-fresh",
          },
          address: makeAddress({
            conversationId: "thread-address-stale",
            ownerClientId: "codex-address-stale",
          }),
        }),
      },
      transportFactory: () => transport,
    });

    expect(result.transport).toBe("consent-drive");
    expect(transport.createConsentReceipt).toHaveBeenCalledWith({
      conversationId: "thread-fresh",
      hostId: "DEVIN",
      ownerClientId: "codex-fresh",
      allowedMethods: ["thread-follower-start-turn"],
    });
  });

  it("falls back when the Codex binding registry is ambiguous", async () => {
    const transportFactory = vi.fn();

    const result = await routeTapReplyDelivery({
      commsDir: "D:/HUA/hua-comms",
      localHostId: "DEVIN",
      sender: {
        routingAddress: "담",
        displayName: "담",
      },
      target: {
        routingAddress: "온",
        displayName: "온",
        address: makeAddress(),
        receiveTransports: ["consent-drive"],
      },
      subject: "ambiguous-check",
      content: "중복 바인딩이면 inbox 로 빠져야 해.",
      fileName: "20260419-담-온-ambiguous-check.md",
      heartbeats: {
        "codex-wt-2": makeHeartbeat(),
        "codex-wt-3": makeHeartbeat({
          id: "codex-wt-3",
          instanceId: "codex-wt-3",
          address: makeAddress({
            clientId: "codex-wt-3",
            conversationId: "thread-43",
            ownerClientId: "codex-wt-3",
            routingAddress: "codex-wt-3",
            slot: "wt-1",
            aliases: ["codex-wt-3", "온"],
          }),
          capabilities: {
            receiveTransports: ["consent-drive"],
            conversationId: "thread-43",
            ownerClientId: "codex-wt-3",
          },
        }),
      },
      transportFactory: transportFactory as never,
    });

    expect(result.transport).toBe("mcp-channel");
    expect(result.delivered).toBe(false);
    expect(result.fallbackToInbox).toBe(true);
    expect(result.warning).toContain("ambiguous");
    expect(transportFactory).not.toHaveBeenCalled();
  });

  it("falls back when presence already marked the recipient ambiguous", async () => {
    const transportFactory = vi.fn();

    const result = await routeTapReplyDelivery({
      commsDir: "D:/HUA/hua-comms",
      localHostId: "DEVIN",
      sender: {
        routingAddress: "담",
        displayName: "담",
      },
      target: {
        routingAddress: "codex-wt-2",
        displayName: "온",
        address: makeAddress(),
        receiveTransports: ["consent-drive"],
        ambiguous: true,
      },
      subject: "presence-ambiguous-check",
      content: "presence ambiguity 가 winner 로 지워지면 안 돼.",
      fileName: "20260419-담-온-presence-ambiguous-check.md",
      heartbeats: {
        "codex-wt-2": makeHeartbeat(),
      },
      transportFactory: transportFactory as never,
    });

    expect(result.transport).toBe("mcp-channel");
    expect(result.delivered).toBe(false);
    expect(result.fallbackToInbox).toBe(true);
    expect(result.warning).toContain("recipient resolution was ambiguous");
    expect(transportFactory).not.toHaveBeenCalled();
  });

  it("falls back when the Codex target lacks a local conversation binding", async () => {
    const transportFactory = vi.fn();

    const result = await routeTapReplyDelivery({
      commsDir: "D:/HUA/hua-comms",
      localHostId: "DEVIN",
      sender: {
        routingAddress: "담",
        displayName: "담",
      },
      target: {
        routingAddress: "온",
        displayName: "온",
        address: makeAddress({
          hostId: "OTHER-HOST",
        }),
        receiveTransports: ["consent-drive"],
      },
      subject: "binding-check",
      content: "로컬 conversation binding 이 필요해.",
      fileName: "20260419-담-온-binding-check.md",
      heartbeats: {
        "codex-wt-2": makeHeartbeat({
          address: makeAddress({
            hostId: "OTHER-HOST",
          }),
        }),
      },
      transportFactory: transportFactory as never,
    });

    expect(result.transport).toBe("mcp-channel");
    expect(result.delivered).toBe(false);
    expect(result.fallbackToInbox).toBe(true);
    expect(result.warning).toContain("remote/unmapped");
    expect(transportFactory).not.toHaveBeenCalled();
  });

  it("falls back as partial when a Codex binding has conversationId but no ownerClientId", async () => {
    const transportFactory = vi.fn();

    const result = await routeTapReplyDelivery({
      commsDir: "D:/HUA/hua-comms",
      localHostId: "DEVIN",
      sender: {
        routingAddress: "담",
        displayName: "담",
      },
      target: {
        routingAddress: "하",
        displayName: "하",
        address: makeAddress({
          clientId: "codex-ha",
          conversationId: "thread-ha",
          ownerClientId: null,
          routingAddress: "하",
          aliases: ["하"],
        }),
        receiveTransports: ["consent-drive"],
      },
      subject: "partial-check",
      content: "ownerClientId 없는 partial binding.",
      fileName: "20260522-담-하-partial-check.md",
      heartbeats: {
        하: makeHeartbeat({
          id: "하",
          agent: "하",
          instanceId: "codex-ha",
          address: makeAddress({
            clientId: "codex-ha",
            conversationId: "thread-ha",
            ownerClientId: null,
            routingAddress: "하",
            aliases: ["하"],
          }),
          capabilities: {
            receiveTransports: ["consent-drive"],
            conversationId: "thread-ha",
            ownerClientId: null,
          },
        }),
      },
      transportFactory: transportFactory as never,
    });

    expect(result.transport).toBe("mcp-channel");
    expect(result.fallbackToInbox).toBe(true);
    expect(result.warning).toContain("partial");
    expect(result.warning).toContain("conversationId and ownerClientId");
    expect(transportFactory).not.toHaveBeenCalled();
  });

  it("auto-discovers ownerClientId for a local partial Codex binding", async () => {
    const transport = {
      connect: vi.fn(async () => undefined),
      disconnect: vi.fn(async () => undefined),
      createConsentReceipt: vi.fn(() => ({
        receipt: { id: "receipt-partial-refresh" },
      })),
      startTurn: vi.fn(async () => ({
        response: {
          result: {
            turn: {
              id: "turn-partial-refresh",
            },
          },
        },
      })),
    };

    const result = await routeTapReplyDelivery({
      commsDir: "D:/HUA/hua-comms",
      localHostId: "DEVIN",
      sender: {
        routingAddress: "담",
        displayName: "담",
      },
      target: {
        routingAddress: "하",
        displayName: "하",
        address: makeAddress({
          clientId: "codex-ha",
          conversationId: "thread-ha",
          ownerClientId: null,
          routingAddress: "하",
          aliases: ["하"],
        }),
        receiveTransports: ["consent-drive"],
      },
      subject: "partial-refresh",
      content: "ownerClientId 없는 partial binding refresh.",
      fileName: "20260522-담-하-partial-refresh.md",
      heartbeats: {
        하: makeHeartbeat({
          id: "하",
          agent: "하",
          instanceId: "codex-ha",
          address: makeAddress({
            clientId: "codex-ha",
            conversationId: "thread-ha",
            ownerClientId: null,
            routingAddress: "하",
            aliases: ["하"],
          }),
          capabilities: {
            receiveTransports: ["consent-drive"],
            conversationId: "thread-ha",
            ownerClientId: null,
          },
        }),
      },
      ownerDiscovery: vi.fn(async () => ({
        status: "found" as const,
        conversationId: "thread-ha",
        ownerClientId: "owner-ha",
        hostId: "DEVIN",
        source: "snapshot" as const,
      })),
      transportFactory: () => transport,
    });

    expect(result).toMatchObject({
      transport: "consent-drive",
      delivered: true,
      turnId: "turn-partial-refresh",
      warning: null,
    });
    expect(transport.createConsentReceipt).toHaveBeenCalledWith({
      conversationId: "thread-ha",
      hostId: "DEVIN",
      ownerClientId: "owner-ha",
      allowedMethods: ["thread-follower-start-turn"],
    });
  });

  it("uses ssh relay for mapped remote Codex hosts", async () => {
    const remoteRelayExecutor: ReturnType<
      typeof vi.fn<RemoteCodexRelayExecutor>
    > = vi.fn(async () => ({
      turnId: "remote-turn-1",
      consentRef: "remote-consent-1",
    }));
    const transportFactory = vi.fn();

    const result = await routeTapReplyDelivery({
      commsDir: "/home/devin/hua-comms",
      localHostId: "/home/devin/hua-comms",
      sender: {
        routingAddress: "윤",
        displayName: "윤",
      },
      target: {
        routingAddress: "코",
        displayName: "코",
        address: makeAddress({
          hostId: "D:\\HUA\\hua-comms",
          clientId: "windows-owner",
          conversationId: "thread-remote",
          ownerClientId: "windows-owner",
          routingAddress: "코",
          aliases: ["코"],
        }),
        receiveTransports: ["consent-drive"],
      },
      subject: "remote-check",
      content: "원격 릴레이 테스트.",
      fileName: "20260522-윤-코-remote-check.md",
      heartbeats: {
        코: makeHeartbeat({
          id: "코",
          agent: "코",
          instanceId: null,
          address: makeAddress({
            hostId: "D:\\HUA\\hua-comms",
            clientId: "windows-owner",
            conversationId: "thread-remote",
            ownerClientId: "windows-owner",
            routingAddress: "코",
            aliases: ["코"],
          }),
          capabilities: {
            receiveTransports: ["consent-drive"],
            conversationId: "thread-remote",
            ownerClientId: "windows-owner",
          },
        }),
      },
      remoteHosts: {
        "d:\\hua\\hua-comms": {
          sshTarget: "devin-win-ts",
          platformDir: "D:\\HUA\\hua-platform",
          commsDir: "D:\\HUA\\hua-comms",
        },
      },
      remoteRelayExecutor,
      transportFactory: transportFactory as never,
    });

    expect(result).toEqual({
      transport: "consent-drive",
      delivered: true,
      fallbackToInbox: false,
      turnId: "remote-turn-1",
      consentRef: "remote-consent-1",
      warning: null,
    });
    expect(transportFactory).not.toHaveBeenCalled();
    expect(remoteRelayExecutor).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({
          sshTarget: "devin-win-ts",
        }),
        target: {
          routingAddress: "코",
          hostId: "D:\\HUA\\hua-comms",
          conversationId: "thread-remote",
          ownerClientId: "windows-owner",
        },
      }),
    );
    const relayInput = remoteRelayExecutor.mock.calls[0]?.[0];
    expect(relayInput?.text).toContain("Reply available: 윤");
    expect(relayInput?.text).not.toContain("Use tap_reply");
  });

  it("uses ssh relay for mapped remote Codex host aliases", async () => {
    const remoteRelayExecutor: ReturnType<
      typeof vi.fn<RemoteCodexRelayExecutor>
    > = vi.fn(async () => ({
      turnId: "remote-turn-alias",
      consentRef: "remote-consent-alias",
    }));

    const result = await routeTapReplyDelivery({
      commsDir: "/home/devin/hua-comms",
      localHostId: "/home/devin/hua-comms",
      sender: {
        routingAddress: "윤",
        displayName: "윤",
      },
      target: {
        routingAddress: "온",
        displayName: "온",
        address: makeAddress({
          hostId: "DEVIN",
          clientId: "windows-owner",
          conversationId: "thread-remote",
          ownerClientId: "windows-owner",
          routingAddress: "온",
          aliases: ["온"],
        }),
        receiveTransports: ["consent-drive"],
      },
      subject: "remote-alias-check",
      content: "원격 alias 릴레이 테스트.",
      fileName: "20260606-윤-온-remote-alias-check.md",
      heartbeats: {
        온: makeHeartbeat({
          id: "온",
          agent: "온",
          instanceId: null,
          address: makeAddress({
            hostId: "DEVIN",
            clientId: "windows-owner",
            conversationId: "thread-remote",
            ownerClientId: "windows-owner",
            routingAddress: "온",
            aliases: ["온"],
          }),
          capabilities: {
            receiveTransports: ["consent-drive"],
            conversationId: "thread-remote",
            ownerClientId: "windows-owner",
          },
        }),
      },
      remoteHosts: parseRemoteCodexHosts(
        JSON.stringify({
          "D:\\HUA\\hua-comms": {
            ssh: "devin-win-ts",
            repo: "D:\\HUA\\hua-platform",
            commsDir: "D:\\HUA\\hua-comms",
            hostAliases: ["DEVIN"],
          },
        }),
      ),
      remoteRelayExecutor,
    });

    expect(result).toEqual({
      transport: "consent-drive",
      delivered: true,
      fallbackToInbox: false,
      turnId: "remote-turn-alias",
      consentRef: "remote-consent-alias",
      warning: null,
    });
    expect(remoteRelayExecutor).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({
          sshTarget: "devin-win-ts",
          platformDir: "D:\\HUA\\hua-platform",
        }),
        target: {
          routingAddress: "온",
          hostId: "DEVIN",
          conversationId: "thread-remote",
          ownerClientId: "windows-owner",
        },
      }),
    );
  });

  it("reports stale owner binding when remote relay returns no-client-found", async () => {
    const remoteRelayExecutor: ReturnType<
      typeof vi.fn<RemoteCodexRelayExecutor>
    > = vi.fn(async () => {
      throw new Error('remote relay returned failure: "no-client-found"');
    });

    const result = await routeTapReplyDelivery({
      commsDir: "/home/devin/hua-comms",
      localHostId: "/home/devin/hua-comms",
      sender: {
        routingAddress: "윤",
        displayName: "윤",
      },
      target: {
        routingAddress: "코",
        displayName: "코",
        address: makeAddress({
          hostId: "D:\\HUA\\hua-comms",
          clientId: "windows-owner",
          conversationId: "thread-remote",
          ownerClientId: "stale-windows-owner",
          routingAddress: "코",
          aliases: ["코"],
        }),
        receiveTransports: ["consent-drive"],
      },
      subject: "remote-stale-check",
      content: "원격 owner stale 진단.",
      fileName: "20260522-윤-코-remote-stale-check.md",
      heartbeats: {
        코: makeHeartbeat({
          id: "코",
          agent: "코",
          instanceId: null,
          address: makeAddress({
            hostId: "D:\\HUA\\hua-comms",
            clientId: "windows-owner",
            conversationId: "thread-remote",
            ownerClientId: "stale-windows-owner",
            routingAddress: "코",
            aliases: ["코"],
          }),
          capabilities: {
            receiveTransports: ["consent-drive"],
            conversationId: "thread-remote",
            ownerClientId: "stale-windows-owner",
          },
        }),
      },
      remoteHosts: {
        "d:\\hua\\hua-comms": {
          sshTarget: "devin-win-ts",
          platformDir: "D:\\HUA\\hua-platform",
          commsDir: "D:\\HUA\\hua-comms",
        },
      },
      remoteRelayExecutor,
    });

    expect(result.transport).toBe("mcp-channel");
    expect(result.fallbackToInbox).toBe(true);
    expect(result.warning).toContain("ownerClientId appears stale");
    expect(result.warning).toContain("no-client-found");
  });

  it("surfaces remote active-turn relay failures instead of generic ssh exit", async () => {
    const remoteRelayExecutor: ReturnType<
      typeof vi.fn<RemoteCodexRelayExecutor>
    > = vi.fn(async () => {
      throw new Error(
        '[Stability Guard] Recipient conversation "thread-remote" has an active in-progress turn; refusing "thread-follower-start-turn" to avoid a stuck nested turn.',
      );
    });

    const result = await routeTapReplyDelivery({
      commsDir: "/home/devin/hua-comms",
      localHostId: "/home/devin/hua-comms",
      sender: {
        routingAddress: "윤",
        displayName: "윤",
      },
      target: {
        routingAddress: "코",
        displayName: "코",
        address: makeAddress({
          hostId: "D:\\HUA\\hua-comms",
          clientId: "windows-owner",
          conversationId: "thread-remote",
          ownerClientId: "windows-owner",
          routingAddress: "코",
          aliases: ["코"],
        }),
        receiveTransports: ["consent-drive"],
      },
      subject: "remote-active-check",
      content: "원격 active-turn 진단.",
      fileName: "20260525-윤-코-remote-active-check.md",
      heartbeats: {
        코: makeHeartbeat({
          id: "코",
          agent: "코",
          instanceId: null,
          address: makeAddress({
            hostId: "D:\\HUA\\hua-comms",
            clientId: "windows-owner",
            conversationId: "thread-remote",
            ownerClientId: "windows-owner",
            routingAddress: "코",
            aliases: ["코"],
          }),
          capabilities: {
            receiveTransports: ["consent-drive"],
            conversationId: "thread-remote",
            ownerClientId: "windows-owner",
          },
        }),
      },
      remoteHosts: {
        "d:\\hua\\hua-comms": {
          sshTarget: "devin-win-ts",
          platformDir: "D:\\HUA\\hua-platform",
          commsDir: "D:\\HUA\\hua-comms",
        },
      },
      remoteRelayExecutor,
    });

    expect(result.transport).toBe("mcp-channel");
    expect(result.fallbackToInbox).toBe(true);
    expect(result.warning).toContain("active in-progress turn");
    expect(result.warning).toContain("future steer path");
    expect(result.warning).not.toContain("ssh relay exited 1");
  });

  it("falls back with explicit remote-host-unmapped wording", async () => {
    const remoteRelayExecutor = vi.fn();
    const result = await routeTapReplyDelivery({
      commsDir: "/home/devin/hua-comms",
      localHostId: "/home/devin/hua-comms",
      sender: {
        routingAddress: "윤",
        displayName: "윤",
      },
      target: {
        routingAddress: "코",
        displayName: "코",
        address: makeAddress({
          hostId: "Z:\\UNMAPPED\\hua-comms",
          conversationId: "thread-remote",
          ownerClientId: "windows-owner",
          routingAddress: "코",
        }),
        receiveTransports: ["consent-drive"],
      },
      subject: "remote-unmapped",
      content: "매핑 없으면 fallback.",
      fileName: "20260522-윤-코-remote-unmapped.md",
      heartbeats: {
        코: makeHeartbeat({
          id: "코",
          agent: "코",
          instanceId: null,
          address: makeAddress({
            hostId: "Z:\\UNMAPPED\\hua-comms",
            conversationId: "thread-remote",
            ownerClientId: "windows-owner",
            routingAddress: "코",
            aliases: ["코"],
          }),
          capabilities: {
            receiveTransports: ["consent-drive"],
            conversationId: "thread-remote",
            ownerClientId: "windows-owner",
          },
        }),
      },
      remoteRelayExecutor,
    });

    expect(result.transport).toBe("mcp-channel");
    expect(result.fallbackToInbox).toBe(true);
    expect(result.warning).toContain("remote/unmapped");
    expect(remoteRelayExecutor).not.toHaveBeenCalled();
  });

  it("parses remote Codex host mappings from JSON", () => {
    expect(
      parseRemoteCodexHosts(
        JSON.stringify({
          "D:\\HUA\\hua-comms": {
            ssh: "devin-win-ts",
            repo: "D:\\HUA\\hua-platform",
            commsDir: "D:\\HUA\\hua-comms",
          },
        }),
      ),
    ).toEqual({
      "d:\\hua\\hua-comms": {
        sshTarget: "devin-win-ts",
        platformDir: "D:\\HUA\\hua-platform",
        commsDir: "D:\\HUA\\hua-comms",
        nodeCommand: null,
        helperPath: null,
        hostAliases: [],
      },
    });
  });

  it("parses remote Codex host aliases without overriding primary mappings", () => {
    expect(
      parseRemoteCodexHosts(
        JSON.stringify({
          "D:\\HUA\\hua-comms": {
            ssh: "devin-win-ts",
            repo: "D:\\HUA\\hua-platform",
            commsDir: "D:\\HUA\\hua-comms",
            hostAliases: ["DEVIN", "windows-app"],
          },
          DEVIN: {
            ssh: "explicit-devin",
            repo: "D:\\HUA\\explicit",
          },
        }),
      ),
    ).toEqual({
      "d:\\hua\\hua-comms": {
        sshTarget: "devin-win-ts",
        platformDir: "D:\\HUA\\hua-platform",
        commsDir: "D:\\HUA\\hua-comms",
        nodeCommand: null,
        helperPath: null,
        hostAliases: ["DEVIN", "windows-app"],
      },
      devin: {
        sshTarget: "explicit-devin",
        platformDir: "D:\\HUA\\explicit",
        commsDir: null,
        nodeCommand: null,
        helperPath: null,
        hostAliases: [],
      },
      "windows-app": {
        sshTarget: "devin-win-ts",
        platformDir: "D:\\HUA\\hua-platform",
        commsDir: "D:\\HUA\\hua-comms",
        nodeCommand: null,
        helperPath: null,
        hostAliases: ["DEVIN", "windows-app"],
      },
    });
  });

  it("parses helper JSON failure from nonzero remote relay output", () => {
    expect(() =>
      parseRemoteRelayProcessResult({
        exitCode: 1,
        stdout: JSON.stringify({
          ok: false,
          error:
            '[Stability Guard] Recipient conversation "thread-remote" has an active in-progress turn; refusing "thread-follower-start-turn" to avoid a stuck nested turn.',
        }),
        stderr: "",
      }),
    ).toThrow("active in-progress turn");
  });

  it("falls back to ssh exit diagnostics when remote relay has no JSON output", () => {
    expect(() =>
      parseRemoteRelayProcessResult({
        exitCode: 1,
        stdout: "",
        stderr: "ssh failed",
      }),
    ).toThrow("ssh relay exited 1: ssh failed");
  });
});
