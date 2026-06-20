import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { updateCommsHeartbeat } from "../../scripts/bridge/bridge-dispatch.js";
import type { Options } from "../../scripts/bridge/bridge-types.js";

let tmpDir: string;

function createOptions(): Options {
  return {
    repoRoot: tmpDir,
    commsDir: path.join(tmpDir, "comms"),
    agentId: "codex-wt-3",
    agentName: "해",
    stateDir: path.join(tmpDir, "state"),
    pollSeconds: 5,
    reconnectSeconds: 5,
    messageLookbackMinutes: 5,
    processExistingMessages: false,
    dryRun: false,
    runOnce: false,
    waitAfterDispatchSeconds: 1,
    appServerUrl: "ws://127.0.0.1:4501/rpc",
    connectAppServerUrl: "ws://127.0.0.1:4501/rpc",
    gatewayToken: null,
    gatewayTokenFile: null,
    busyMode: "wait",
    logLevel: "info",
    threadId: null,
    ephemeral: false,
    routingSlot: null,
  };
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tap-bridge-heartbeat-test-"));
  process.env.TAP_HOST_ID = "bridge-host";
});

afterEach(() => {
  delete process.env.TAP_HOST_ID;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("updateCommsHeartbeat", () => {
  it("writes address tuple metadata to the shared heartbeat and presence files", () => {
    const options = createOptions();
    fs.mkdirSync(options.commsDir, { recursive: true });
    fs.mkdirSync(options.stateDir, { recursive: true });
    fs.writeFileSync(
      path.join(options.stateDir, "thread.json"),
      JSON.stringify(
        {
          threadId: "thread-123",
          updatedAt: "2026-04-17T00:00:00.000Z",
          appServerUrl: options.appServerUrl,
          ephemeral: false,
        },
        null,
        2,
      ),
      "utf-8",
    );

    updateCommsHeartbeat(options, "idle");

    const store = JSON.parse(
      fs.readFileSync(path.join(options.commsDir, "heartbeats.json"), "utf-8"),
    ) as Record<string, { address?: Record<string, unknown> }>;
    expect(store[options.agentId]).toMatchObject({
      source: "bridge-dispatch",
      address: {
        hostId: "bridge-host",
        clientId: "codex-wt-3",
        conversationId: "thread-123",
        ownerClientId: "codex-wt-3",
        routingAddress: "wt-3",
        slot: "wt-3",
      },
    });
    expect(store[options.agentId]?.address?.aliases).toEqual(
      expect.arrayContaining(["wt-3", "codex-wt-3", "해"]),
    );

    const presence = JSON.parse(
      fs.readFileSync(
        path.join(options.commsDir, "presence", "codex-wt-3.json"),
        "utf-8",
      ),
    ) as { address?: Record<string, unknown> };
    expect(presence).toMatchObject({
      address: {
        hostId: "bridge-host",
        clientId: "codex-wt-3",
        conversationId: "thread-123",
        ownerClientId: "codex-wt-3",
        routingAddress: "wt-3",
        slot: "wt-3",
      },
    });
  });

  it("M392: launcher-supplied routingSlot survives suffixed agent ids", () => {
    // With suffix on, agentId becomes `codex-wt1-abc123` and the
    // legacy resolveBridgeRoutingSlot regex no longer matches. The
    // launcher-injected `routingSlot` must take precedence so the
    // heartbeat / presence record still advertises the wt-1 slot.
    const options: Options = {
      ...createOptions(),
      agentId: "codex-wt1-abc123",
      agentName: "진",
      routingSlot: "wt-1",
    };
    fs.mkdirSync(options.commsDir, { recursive: true });
    fs.mkdirSync(options.stateDir, { recursive: true });

    updateCommsHeartbeat(options, "idle");

    const store = JSON.parse(
      fs.readFileSync(path.join(options.commsDir, "heartbeats.json"), "utf-8"),
    ) as Record<string, { address?: Record<string, unknown> }>;
    expect(store[options.agentId]).toMatchObject({
      source: "bridge-dispatch",
      address: {
        clientId: "codex-wt1-abc123",
        routingAddress: "wt-1",
        slot: "wt-1",
      },
    });
    expect(store[options.agentId]?.address?.aliases).toEqual(
      expect.arrayContaining(["wt-1", "codex-wt1-abc123", "진"]),
    );
  });

  it("M392: routingSlot null falls back to id-derived slot (no regression)", () => {
    // routingSlot=null preserves the legacy behavior where slot is
    // derived from `resolveBridgeRoutingSlot(agentId)`. Verifies the
    // fallback path is intact when the launcher did not pin a slot.
    const options: Options = {
      ...createOptions(),
      agentId: "codex-wt-3",
      routingSlot: null,
    };
    fs.mkdirSync(options.commsDir, { recursive: true });
    fs.mkdirSync(options.stateDir, { recursive: true });

    updateCommsHeartbeat(options, "idle");

    const store = JSON.parse(
      fs.readFileSync(path.join(options.commsDir, "heartbeats.json"), "utf-8"),
    ) as Record<string, { address?: Record<string, unknown> }>;
    expect(store[options.agentId]).toMatchObject({
      address: {
        routingAddress: "wt-3",
        slot: "wt-3",
      },
    });
  });

  it("normalizes legacy array heartbeats before persisting bridge updates", () => {
    const options = createOptions();
    fs.mkdirSync(options.commsDir, { recursive: true });
    fs.mkdirSync(options.stateDir, { recursive: true });
    fs.writeFileSync(
      path.join(options.commsDir, "heartbeats.json"),
      JSON.stringify(
        [
          {
            id: "codex-wt-3",
            agent: "old-name",
            timestamp: "2026-04-01T00:00:00.000Z",
            lastActivity: "2026-04-01T00:00:00.000Z",
            joinedAt: "2026-04-01T00:00:00.000Z",
            source: "bridge-dispatch",
          },
          {
            id: "other-agent",
            agent: "타",
            timestamp: "2026-04-01T00:00:00.000Z",
          },
        ],
        null,
        2,
      ),
      "utf-8",
    );

    updateCommsHeartbeat(options, "active", "thread-456");

    const store = JSON.parse(
      fs.readFileSync(path.join(options.commsDir, "heartbeats.json"), "utf-8"),
    ) as Record<
      string,
      {
        agent?: string;
        joinedAt?: string;
        source?: string;
        address?: Record<string, unknown>;
      }
    >;

    expect(Array.isArray(store)).toBe(false);
    expect(store["other-agent"]).toMatchObject({ agent: "타" });
    expect(store[options.agentId]).toMatchObject({
      agent: "해",
      joinedAt: "2026-04-01T00:00:00.000Z",
      source: "bridge-dispatch",
      address: {
        conversationId: "thread-456",
        routingAddress: "wt-3",
      },
    });
  });
});
