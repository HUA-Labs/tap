import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { TEST_DIR, resetTestDir, setTestEnv } from "./test-helpers.ts";

beforeEach(() => {
  resetTestDir();
  setTestEnv();
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

type Heartbeat = Record<string, unknown>;

async function loadHelper() {
  const mod = await import("../tap-instance-ownership.ts");
  return mod.pruneInstanceOwnershipChange;
}

function seedPresenceFile(agentId: string, entry: Heartbeat): void {
  const presenceDir = join(TEST_DIR, "presence");
  mkdirSync(presenceDir, { recursive: true });
  writeFileSync(
    join(presenceDir, `${agentId}.json`),
    JSON.stringify(entry, null, 2),
    "utf-8",
  );
}

describe("pruneInstanceOwnershipChange (M354)", () => {
  it("prunes prior-owner heartbeat entries bound to the same instance on this host", async () => {
    const prune = await loadHelper();
    const store: Record<string, Heartbeat> = {
      윤: {
        id: "윤",
        agent: "윤",
        timestamp: "2026-04-20T10:00:00.000Z",
        lastActivity: "2026-04-20T10:00:00.000Z",
        status: "active",
        instanceId: "codex",
        address: { hostId: "DEVIN", clientId: "codex" },
      },
      codex_윤: {
        id: "codex_윤",
        agent: "윤",
        timestamp: "2026-04-20T10:00:00.000Z",
        lastActivity: "2026-04-20T10:00:00.000Z",
        status: "active",
        instanceId: "codex",
        address: { hostId: "DEVIN", clientId: "codex" },
      },
      해: {
        id: "해",
        agent: "해",
        timestamp: "2026-04-23T10:00:00.000Z",
        lastActivity: "2026-04-23T10:00:00.000Z",
        status: "active",
        instanceId: "codex",
        address: { hostId: "DEVIN", clientId: "codex" },
      },
    };

    const result = prune({
      store: store as never,
      currentAgentId: "해",
      currentInstanceId: "codex",
      currentHostId: "DEVIN",
    });

    expect(result.prunedKeys.sort()).toEqual(["codex_윤", "윤"]);
    expect(store["해"]).toBeDefined();
    expect(store["윤"]).toBeUndefined();
    expect(store["codex_윤"]).toBeUndefined();
    expect(result.previous?.instanceId).toBe("codex");
  });

  it("preserves prior-owner entries whose hostId differs (cross-device)", async () => {
    const prune = await loadHelper();
    const store: Record<string, Heartbeat> = {
      윤: {
        id: "윤",
        agent: "윤",
        timestamp: "2026-04-20T10:00:00.000Z",
        lastActivity: "2026-04-20T10:00:00.000Z",
        status: "active",
        instanceId: "codex",
        address: { hostId: "sum-back", clientId: "codex" },
      },
      해: {
        id: "해",
        agent: "해",
        timestamp: "2026-04-23T10:00:00.000Z",
        lastActivity: "2026-04-23T10:00:00.000Z",
        status: "active",
        instanceId: "codex",
        address: { hostId: "DEVIN", clientId: "codex" },
      },
    };

    const result = prune({
      store: store as never,
      currentAgentId: "해",
      currentInstanceId: "codex",
      currentHostId: "DEVIN",
    });

    expect(result.prunedKeys).toEqual([]);
    expect(store["윤"]).toBeDefined();
    expect(store["해"]).toBeDefined();
  });

  it("leaves unrelated instance_id entries alone", async () => {
    const prune = await loadHelper();
    const store: Record<string, Heartbeat> = {
      결: {
        id: "결",
        agent: "결",
        timestamp: "2026-04-23T10:00:00.000Z",
        lastActivity: "2026-04-23T10:00:00.000Z",
        status: "active",
        instanceId: "claude-wt1",
        address: { hostId: "DEVIN", clientId: "claude-wt1" },
      },
      해: {
        id: "해",
        agent: "해",
        timestamp: "2026-04-23T10:00:00.000Z",
        lastActivity: "2026-04-23T10:00:00.000Z",
        status: "active",
        instanceId: "codex",
        address: { hostId: "DEVIN", clientId: "codex" },
      },
    };

    const result = prune({
      store: store as never,
      currentAgentId: "해",
      currentInstanceId: "codex",
      currentHostId: "DEVIN",
    });

    expect(result.prunedKeys).toEqual([]);
    expect(store["결"]).toBeDefined();
  });

  it("returns empty result when current agent already holds the instance", async () => {
    const prune = await loadHelper();
    const store: Record<string, Heartbeat> = {
      해: {
        id: "해",
        agent: "해",
        timestamp: "2026-04-23T10:00:00.000Z",
        lastActivity: "2026-04-23T10:00:00.000Z",
        status: "active",
        instanceId: "codex",
        address: { hostId: "DEVIN", clientId: "codex" },
      },
    };

    const result = prune({
      store: store as never,
      currentAgentId: "해",
      currentInstanceId: "codex",
      currentHostId: "DEVIN",
    });

    expect(result.prunedKeys).toEqual([]);
    expect(result.previous).toBeNull();
    expect(store["해"]).toBeDefined();
  });

  it("prunes orphan presence files bound to the same instance on this host", async () => {
    const prune = await loadHelper();
    seedPresenceFile("윤", {
      id: "윤",
      agent: "윤",
      timestamp: "2026-04-20T10:00:00.000Z",
      lastActivity: "2026-04-20T10:00:00.000Z",
      status: "active",
      instanceId: "codex",
      address: { hostId: "DEVIN", clientId: "codex" },
    });
    const store: Record<string, Heartbeat> = {
      해: {
        id: "해",
        agent: "해",
        timestamp: "2026-04-23T10:00:00.000Z",
        lastActivity: "2026-04-23T10:00:00.000Z",
        status: "active",
        instanceId: "codex",
        address: { hostId: "DEVIN", clientId: "codex" },
      },
    };

    const result = prune({
      store: store as never,
      currentAgentId: "해",
      currentInstanceId: "codex",
      currentHostId: "DEVIN",
    });

    expect(result.prunedPresenceFiles).toContain("윤.json");
    const presenceDir = join(TEST_DIR, "presence");
    expect(existsSync(join(presenceDir, "윤.json"))).toBe(false);
  });

  it("M392: bridge daemon with suffixed instance_id stays in its own bucket — stale base-id entry is not falsely pruned", async () => {
    // M392 defense in depth: when bridge daemon runs with TAP_INSTANCE_ID=codex-<suffix>,
    // its heartbeat lives under a different instance_id key than the MCP server's
    // base "codex" entry. The 1순위 prune keys on instance_id, so the stale
    // codex_윤 entry is NOT touched by the bridge-side prune call. Conversely,
    // the MCP-side prune call (with currentInstanceId="codex") still cleans the
    // base bucket. The two layers protect different namespaces.
    const prune = await loadHelper();
    const store: Record<string, Heartbeat> = {
      codex_윤: {
        id: "codex_윤",
        agent: "윤",
        timestamp: "2026-04-20T10:00:00.000Z",
        lastActivity: "2026-04-20T10:00:00.000Z",
        status: "active",
        instanceId: "codex",
        address: { hostId: "DEVIN", clientId: "codex" },
      },
      "해-bridge": {
        id: "해-bridge",
        agent: "해",
        timestamp: "2026-05-05T02:00:00.000Z",
        lastActivity: "2026-05-05T02:00:00.000Z",
        status: "active",
        instanceId: "codex-a3f9d2",
        address: { hostId: "DEVIN", clientId: "codex-a3f9d2" },
      },
    };

    // Bridge-side prune call uses the suffixed instance id.
    const bridgeResult = prune({
      store: store as never,
      currentAgentId: "해-bridge",
      currentInstanceId: "codex-a3f9d2",
      currentHostId: "DEVIN",
    });

    // Stale base-id entry must NOT be pruned by the bridge-side call.
    expect(bridgeResult.prunedKeys).toEqual([]);
    expect(store["codex_윤"]).toBeDefined();
    expect(store["해-bridge"]).toBeDefined();
  });

  it("M392: MCP-side prune still cleans the base bucket while bridge bucket is untouched", async () => {
    const prune = await loadHelper();
    const store: Record<string, Heartbeat> = {
      codex_윤: {
        id: "codex_윤",
        agent: "윤",
        timestamp: "2026-04-20T10:00:00.000Z",
        lastActivity: "2026-04-20T10:00:00.000Z",
        status: "active",
        instanceId: "codex",
        address: { hostId: "DEVIN", clientId: "codex" },
      },
      "해-bridge": {
        id: "해-bridge",
        agent: "해",
        timestamp: "2026-05-05T02:00:00.000Z",
        lastActivity: "2026-05-05T02:00:00.000Z",
        status: "active",
        instanceId: "codex-a3f9d2",
        address: { hostId: "DEVIN", clientId: "codex-a3f9d2" },
      },
      해: {
        id: "해",
        agent: "해",
        timestamp: "2026-05-05T02:00:00.000Z",
        lastActivity: "2026-05-05T02:00:00.000Z",
        status: "active",
        instanceId: "codex",
        address: { hostId: "DEVIN", clientId: "codex" },
      },
    };

    // MCP-side prune: agent 해 owns the base "codex" instance now.
    const mcpResult = prune({
      store: store as never,
      currentAgentId: "해",
      currentInstanceId: "codex",
      currentHostId: "DEVIN",
    });

    expect(mcpResult.prunedKeys).toEqual(["codex_윤"]);
    expect(store["codex_윤"]).toBeUndefined();
    // Bridge bucket is in a different instance_id, so it survives the MCP prune.
    expect(store["해-bridge"]).toBeDefined();
    expect(store["해"]).toBeDefined();
  });

  it("preserves presence files whose hostId differs (cross-device)", async () => {
    const prune = await loadHelper();
    seedPresenceFile("윤", {
      id: "윤",
      agent: "윤",
      timestamp: "2026-04-20T10:00:00.000Z",
      lastActivity: "2026-04-20T10:00:00.000Z",
      status: "active",
      instanceId: "codex",
      address: { hostId: "sum-back", clientId: "codex" },
    });
    const store: Record<string, Heartbeat> = {
      해: {
        id: "해",
        agent: "해",
        timestamp: "2026-04-23T10:00:00.000Z",
        lastActivity: "2026-04-23T10:00:00.000Z",
        status: "active",
        instanceId: "codex",
        address: { hostId: "DEVIN", clientId: "codex" },
      },
    };

    prune({
      store: store as never,
      currentAgentId: "해",
      currentInstanceId: "codex",
      currentHostId: "DEVIN",
    });

    const presenceDir = join(TEST_DIR, "presence");
    expect(readdirSync(presenceDir)).toEqual(["윤.json"]);
  });
});
