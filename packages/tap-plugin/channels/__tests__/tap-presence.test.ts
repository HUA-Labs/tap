import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { TEST_DIR, resetTestDir, setTestEnv } from "./test-helpers.ts";
import type { Heartbeat } from "../tap-utils.ts";

setTestEnv();

const {
  buildWhoAgents,
  POLLING_RECIPIENT_VISIBILITY_MINUTES,
  resolvePreferredRecipient,
  resolveStructuredRecipient,
  validateStructuredEnvelopeMetadata,
} = await import("../tap-presence.ts");

function writeState(instances: Record<string, unknown>) {
  const stateDir = join(TEST_DIR, ".tap-comms");
  mkdirSync(join(stateDir, "pids"), { recursive: true });
  writeFileSync(
    join(stateDir, "state.json"),
    JSON.stringify(
      {
        schemaVersion: 3,
        createdAt: "2026-04-01T00:00:00.000Z",
        updatedAt: "2026-04-01T00:00:00.000Z",
        commsDir: TEST_DIR,
        repoRoot: TEST_DIR,
        packageVersion: "0.1.0",
        instances,
      },
      null,
      2,
    ),
    "utf-8",
  );
  process.env.TAP_STATE_DIR = stateDir;
  return stateDir;
}

beforeEach(() => {
  resetTestDir();
});

afterEach(() => {
  delete process.env.TAP_STATE_DIR;
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("tap-presence", () => {
  it("correlates live bridge heartbeats into presence/lifecycle/session", () => {
    const stateDir = writeState({
      "codex-worker": {
        instanceId: "codex-worker",
        runtime: "codex",
        installed: true,
        bridgeMode: "app-server",
        agentName: "솔",
      },
    });
    const runtimeStateDir = join(TEST_DIR, "runtime-codex-worker");
    mkdirSync(runtimeStateDir, { recursive: true });
    writeFileSync(
      join(stateDir, "pids", "bridge-codex-worker.json"),
      JSON.stringify(
        {
          pid: process.pid,
          runtimeStateDir,
        },
        null,
        2,
      ),
      "utf-8",
    );
    writeFileSync(
      join(runtimeStateDir, "heartbeat.json"),
      JSON.stringify(
        {
          connected: true,
          initialized: true,
          threadId: "thread-1",
          turnState: "idle",
          idleSince: "2026-04-01T00:00:00.000Z",
        },
        null,
        2,
      ),
      "utf-8",
    );

    const agents = buildWhoAgents(
      {
        codex_worker: {
          id: "codex_worker",
          agent: "솔",
          timestamp: "2026-04-01T00:01:00.000Z",
          lastActivity: new Date().toISOString(),
          status: "active",
        },
      },
      10,
    );

    expect(agents).toHaveLength(1);
    expect(agents[0]).toMatchObject({
      agent: "솔 [codex_worker]",
      presence: "bridge-live",
      lifecycle: "ready",
      session: "idle",
      health: {
        status: "ready",
        reason: null,
        adapter: "codex-bridge",
        recovery: null,
      },
    });
    expect(agents[0]?.idleSeconds).not.toBeNull();
    expect(agents[0]?.address).toMatchObject({
      clientId: "codex-worker",
      conversationId: "thread-1",
      ownerClientId: "codex-worker",
      routingAddress: "codex-worker",
      slot: null,
    });
    expect(agents[0]?.address.hostId).toBeTruthy();
  });

  it("preserves stored heartbeat address metadata before falling back to local bridge state", () => {
    const stateDir = writeState({
      "codex-worker": {
        instanceId: "codex-worker",
        runtime: "codex",
        installed: true,
        bridgeMode: "app-server",
        agentName: "솔",
      },
    });
    const runtimeStateDir = join(TEST_DIR, "runtime-codex-worker-preserved");
    mkdirSync(runtimeStateDir, { recursive: true });
    writeFileSync(
      join(stateDir, "pids", "bridge-codex-worker.json"),
      JSON.stringify(
        {
          pid: process.pid,
          runtimeStateDir,
        },
        null,
        2,
      ),
      "utf-8",
    );
    writeFileSync(
      join(runtimeStateDir, "heartbeat.json"),
      JSON.stringify(
        {
          connected: true,
          initialized: true,
          threadId: "thread-local",
          turnState: "idle",
        },
        null,
        2,
      ),
      "utf-8",
    );

    const agents = buildWhoAgents(
      {
        "codex-worker": {
          id: "codex-worker",
          agent: "솔",
          timestamp: "2026-04-01T00:01:00.000Z",
          lastActivity: new Date().toISOString(),
          status: "active",
          source: "bridge-dispatch",
          instanceId: "codex-worker",
          connectHash: "instance:codex-worker",
          address: {
            hostId: "remote-host",
            clientId: "codex-worker",
            conversationId: "thread-remote",
            ownerClientId: "remote-owner",
            routingAddress: "wt-1",
            slot: "wt-1",
            aliases: ["wt-1", "codex-worker", "솔"],
          },
        },
      },
      10,
    );

    expect(agents).toHaveLength(1);
    expect(agents[0]).toMatchObject({
      presence: "bridge-live",
      lifecycle: "ready",
      session: "idle",
      address: {
        hostId: "remote-host",
        clientId: "codex-worker",
        conversationId: "thread-remote",
        ownerClientId: "remote-owner",
        routingAddress: "wt-1",
        slot: "wt-1",
      },
    });
    expect(agents[0]?.address.aliases).toEqual(
      expect.arrayContaining(["wt-1", "codex-worker", "솔"]),
    );
  });

  it("keeps mcp-only and stale bridge agents distinct", () => {
    const stateDir = writeState({
      "codex-reviewer": {
        instanceId: "codex-reviewer",
        runtime: "codex",
        installed: true,
        bridgeMode: "app-server",
        agentName: "결",
      },
    });
    writeFileSync(
      join(stateDir, "pids", "bridge-codex-reviewer.json"),
      JSON.stringify(
        {
          pid: 999999,
          runtimeStateDir: join(TEST_DIR, "runtime-codex-reviewer"),
        },
        null,
        2,
      ),
      "utf-8",
    );

    const agents = buildWhoAgents(
      {
        codex_reviewer: {
          id: "codex_reviewer",
          agent: "결",
          timestamp: "2026-04-01T00:01:00.000Z",
          lastActivity: new Date().toISOString(),
          status: "active",
        },
        reviewer_agent: {
          id: "reviewer_agent",
          agent: "검",
          timestamp: "2026-04-01T00:01:00.000Z",
          lastActivity: new Date().toISOString(),
          status: "active",
        },
      },
      10,
    );

    expect(agents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          agent: "결 [codex_reviewer]",
          presence: "bridge-stale",
          lifecycle: "bridge-stale",
          session: null,
        }),
        expect.objectContaining({
          agent: "검 [reviewer_agent]",
          presence: "mcp-only",
          lifecycle: null,
          session: null,
        }),
      ]),
    );
  });

  it("marks installed app-server instances without a bridge pid as stopped", () => {
    writeState({
      "codex-reviewer": {
        instanceId: "codex-reviewer",
        runtime: "codex",
        installed: true,
        bridgeMode: "app-server",
        agentName: "결",
      },
    });

    const agents = buildWhoAgents(
      {
        codex_reviewer: {
          id: "codex_reviewer",
          agent: "결",
          timestamp: "2026-04-01T00:01:00.000Z",
          lastActivity: new Date().toISOString(),
          status: "active",
        },
      },
      10,
    );

    expect(agents).toHaveLength(1);
    expect(agents[0]).toMatchObject({
      agent: "결 [codex_reviewer]",
      presence: "mcp-only",
      lifecycle: "stopped",
      session: null,
      slot: "reviewer",
      routingAddress: "reviewer",
      health: {
        status: "adapter-unavailable",
        reason: "bridge/app-server is stopped",
        adapter: "codex-bridge",
      },
    });
    expect(agents[0].health.recovery).toContain(
      "docs/areas/tap/codex-app-server-bridge-runbook.md",
    );
    expect(agents[0]?.address).toMatchObject({
      clientId: "codex-reviewer",
      conversationId: null,
      ownerClientId: null,
      routingAddress: "reviewer",
      slot: "reviewer",
    });
  });

  it("routes nickname matches through the occupant's stable slot", () => {
    const resolution = resolvePreferredRecipient(
      {
        claude_wt1: {
          id: "claude_wt1",
          agent: "결",
          timestamp: "2026-04-01T00:01:00.000Z",
          lastActivity: "2026-04-01T00:01:00.000Z",
          status: "active",
          source: "mcp-direct",
          instanceId: "claude-wt1",
          connectHash: "instance:claude-wt1",
        },
      },
      "결",
    );

    expect(resolution).toMatchObject({
      target: "claude_wt1",
      routingTarget: "wt-1",
      displayName: "결",
      slot: "wt-1",
      found: true,
      ambiguous: false,
    });
    expect(resolution.address).toMatchObject({
      clientId: "claude-wt1",
      routingAddress: "wt-1",
      slot: "wt-1",
    });
  });

  it("blocks ambiguous broad role alias matches instead of picking a preferred runtime", () => {
    const now = new Date().toISOString();
    const resolution = resolvePreferredRecipient(
      {
        "yoon-app": {
          id: "yoon-app",
          agent: "윤",
          timestamp: now,
          lastActivity: now,
          status: "active",
          source: "mcp-direct",
          instanceId: "yoon-app",
          connectHash: "instance:yoon-app",
          address: {
            hostId: "/home/devin/hua-comms",
            clientId: "yoon-app",
            conversationId: "thread-yoon",
            ownerClientId: "owner-yoon",
            routingAddress: "윤",
            slot: null,
            aliases: ["codex", "윤"],
          },
        },
        "bom-cli": {
          id: "bom-cli",
          agent: "봄",
          timestamp: now,
          lastActivity: now,
          status: "active",
          source: "mcp-direct",
          instanceId: "bom-cli",
          connectHash: "instance:bom-cli",
          address: {
            hostId: "/Users/devin/HUA/hua-comms",
            clientId: "bom-cli",
            conversationId: null,
            ownerClientId: null,
            routingAddress: "봄",
            slot: null,
            aliases: ["codex", "봄"],
          },
          receiveTransports: ["polling"],
        },
      },
      "codex",
    );

    expect(resolution.found).toBe(false);
    expect(resolution.ambiguous).toBe(true);
    expect(resolution.candidates).toEqual(
      expect.arrayContaining(["yoon-app", "bom-cli"]),
    );
    expect(resolution.warning).toContain("Blocked ambiguous role alias");
    expect(resolution.warning).toContain("Use a concrete agent name");
  });

  it("preserves exact personal alias routing when a broad role alias is ambiguous", () => {
    const now = new Date().toISOString();
    const store: Record<string, Heartbeat> = {
      "yoon-app": {
        id: "yoon-app",
        agent: "윤",
        timestamp: now,
        lastActivity: now,
        status: "active",
        source: "mcp-direct",
        instanceId: "yoon-app",
        connectHash: "instance:yoon-app",
        address: {
          hostId: "/home/devin/hua-comms",
          clientId: "yoon-app",
          conversationId: "thread-yoon",
          ownerClientId: "owner-yoon",
          routingAddress: "윤",
          slot: null,
          aliases: ["codex", "윤"],
        },
      },
      "bom-cli": {
        id: "bom-cli",
        agent: "봄",
        timestamp: now,
        lastActivity: now,
        status: "active",
        source: "mcp-direct",
        instanceId: "bom-cli",
        connectHash: "instance:bom-cli",
        address: {
          hostId: "/Users/devin/HUA/hua-comms",
          clientId: "bom-cli",
          conversationId: null,
          ownerClientId: null,
          routingAddress: "봄",
          slot: null,
          aliases: ["codex", "봄"],
        },
        receiveTransports: ["polling"],
      },
    };

    const resolution = resolvePreferredRecipient(store, "봄");

    expect(resolution).toMatchObject({
      target: "bom-cli",
      routingTarget: "봄",
      displayName: "봄",
      found: true,
      ambiguous: false,
    });
  });

  it("allows broad role aliases only when they resolve to one candidate", () => {
    const now = new Date().toISOString();
    const resolution = resolvePreferredRecipient(
      {
        "bom-cli": {
          id: "bom-cli",
          agent: "봄",
          timestamp: now,
          lastActivity: now,
          status: "active",
          source: "mcp-direct",
          instanceId: "bom-cli",
          connectHash: "instance:bom-cli",
          address: {
            hostId: "/Users/devin/HUA/hua-comms",
            clientId: "bom-cli",
            conversationId: null,
            ownerClientId: null,
            routingAddress: "봄",
            slot: null,
            aliases: ["codex", "봄"],
          },
          receiveTransports: ["polling"],
        },
      },
      "codex",
    );

    expect(resolution).toMatchObject({
      target: "bom-cli",
      routingTarget: "봄",
      found: true,
      ambiguous: false,
    });
  });

  it("preserves normalized receive transport metadata in recipient resolution", () => {
    const now = new Date().toISOString();
    const resolution = resolvePreferredRecipient(
      {
        "codex-worker": {
          id: "codex-worker",
          agent: "솔",
          timestamp: now,
          lastActivity: now,
          status: "active",
          source: "bridge-dispatch",
          instanceId: "codex-worker",
          connectHash: "instance:codex-worker",
          receiveTransports: ["consent-drive", "bogus"] as any,
        },
      },
      "솔",
    );

    expect(resolution.found).toBe(true);
    expect(resolution.receiveTransports).toEqual(["consent-drive"]);
  });

  it("prefers a polling CLI surface over stale-visible consent-drive for simple DM routing", () => {
    const fresh = new Date().toISOString();
    const stale = new Date(Date.now() - 40 * 60 * 1000).toISOString();
    const resolution = resolvePreferredRecipient(
      {
        준: {
          id: "준",
          agent: "준",
          timestamp: stale,
          lastActivity: stale,
          status: "active",
          source: "mcp-direct",
          instanceId: "jun-app",
          connectHash: "instance:jun-app",
          address: {
            hostId: "/Users/devin/HUA/hua-comms",
            clientId: "jun-app",
            conversationId: "thread-jun-app",
            ownerClientId: "owner-jun-app",
            routingAddress: "준",
            slot: null,
            aliases: ["준"],
          },
          receiveTransports: ["consent-drive"],
          capabilities: {
            receiveTransports: ["consent-drive"],
            conversationId: "thread-jun-app",
            ownerClientId: "owner-jun-app",
          },
        },
        "jun-ssh-tui": {
          id: "jun-ssh-tui",
          agent: "준",
          timestamp: fresh,
          lastActivity: fresh,
          status: "active",
          source: "mcp-direct",
          instanceId: "jun-ssh-tui",
          connectHash: "session:jun-ssh-tui",
          address: {
            hostId: "/Users/devin/HUA/hua-comms",
            clientId: "jun-ssh-tui",
            conversationId: null,
            ownerClientId: null,
            routingAddress: "준",
            slot: null,
            aliases: ["준", "jun-ssh-tui"],
          },
          receiveTransports: ["polling"],
          capabilities: {
            receiveTransports: ["polling"],
          },
        },
      },
      "준",
    );

    expect(resolution).toMatchObject({
      target: "jun-ssh-tui",
      routingTarget: "준",
      found: true,
      ambiguous: false,
      warning: null,
      receiveTransports: ["polling"],
    });
  });

  it("prefers capability snapshot metadata over legacy heartbeat fields", () => {
    const now = new Date().toISOString();
    const agents = buildWhoAgents(
      {
        "codex-worker": {
          id: "codex-worker",
          agent: "솔",
          timestamp: now,
          lastActivity: now,
          status: "active",
          source: "bridge-dispatch",
          instanceId: "codex-worker",
          connectHash: "instance:codex-worker",
          address: {
            hostId: "host-a",
            clientId: "codex-worker",
            conversationId: null,
            ownerClientId: null,
            routingAddress: "솔",
            slot: null,
            aliases: ["솔", "codex-worker"],
          },
          receiveTransports: ["mcp-channel"],
          capabilities: {
            receiveTransports: ["consent-drive", "bogus"] as any,
            conversationId: "thread-99",
            ownerClientId: "codex-worker",
          },
        },
      },
      10,
    );

    expect(agents).toHaveLength(1);
    expect(agents[0].receiveTransports).toEqual(["consent-drive"]);
    expect(agents[0].address.conversationId).toBe("thread-99");
    expect(agents[0].address.ownerClientId).toBe("codex-worker");
    expect(agents[0].consentDriveStatus).toBe("ready");
    expect(agents[0].health).toMatchObject({
      status: "ready",
      reason: null,
      adapter: "codex-consent-drive",
      recovery: null,
    });
  });

  it("marks Codex consent-drive presence as partial when ownerClientId is missing", () => {
    const now = new Date().toISOString();
    const agents = buildWhoAgents(
      {
        "codex-ha": {
          id: "codex-ha",
          agent: "하",
          timestamp: now,
          lastActivity: now,
          status: "active",
          source: "mcp-direct",
          instanceId: "codex-ha",
          connectHash: "instance:codex-ha",
          address: {
            hostId: "D:\\HUA\\hua-comms",
            clientId: "codex-ha",
            conversationId: "thread-ha",
            ownerClientId: null,
            routingAddress: "하",
            slot: null,
            aliases: ["하", "codex-ha"],
          },
          capabilities: {
            receiveTransports: ["consent-drive"],
            conversationId: "thread-ha",
            ownerClientId: null,
          },
        },
      },
      10,
    );

    expect(agents).toHaveLength(1);
    expect(agents[0].receiveTransports).toEqual(["consent-drive"]);
    expect(agents[0].address.conversationId).toBe("thread-ha");
    expect(agents[0].address.ownerClientId).toBeNull();
    expect(agents[0].consentDriveStatus).toBe("partial");
    expect(agents[0].health).toMatchObject({
      status: "partial",
      reason: "ownerClientId is missing",
      adapter: "codex-consent-drive",
    });
    expect(agents[0].health.recovery).toContain("tap_register_capabilities");
  });

  it("lets current partial consent-drive state override persisted ready health", () => {
    const now = new Date().toISOString();
    const agents = buildWhoAgents(
      {
        "codex-ko": {
          id: "codex-ko",
          agent: "코",
          timestamp: now,
          lastActivity: now,
          status: "active",
          source: "mcp-direct",
          instanceId: "codex-ko",
          connectHash: "instance:codex-ko",
          address: {
            hostId: "D:\\HUA\\hua-comms",
            clientId: "codex-ko",
            conversationId: "thread-ko",
            ownerClientId: null,
            routingAddress: "코",
            slot: null,
            aliases: ["코", "codex-ko"],
          },
          capabilities: {
            receiveTransports: ["consent-drive"],
            conversationId: "thread-ko",
            ownerClientId: null,
          },
          health: {
            status: "ready",
            reason: null,
            checkedAt: now,
            adapter: "codex-desktop-ipc",
            recovery: null,
          },
        },
      },
      10,
    );

    expect(agents).toHaveLength(1);
    expect(agents[0]).toMatchObject({
      presenceFreshness: "fresh-for-routing",
      consentDriveStatus: "partial",
      health: {
        status: "partial",
        reason: "ownerClientId is missing",
        adapter: "codex-consent-drive",
      },
    });
  });

  it("lets current unavailable consent-drive state override persisted ready health", () => {
    const now = new Date().toISOString();
    const agents = buildWhoAgents(
      {
        "codex-ko": {
          id: "codex-ko",
          agent: "코",
          timestamp: now,
          lastActivity: now,
          status: "active",
          source: "mcp-direct",
          instanceId: "codex-ko",
          connectHash: "instance:codex-ko",
          capabilities: {
            receiveTransports: ["consent-drive"],
            conversationId: null,
            ownerClientId: null,
          },
          health: {
            status: "ready",
            reason: null,
            checkedAt: now,
            adapter: "codex-desktop-ipc",
            recovery: null,
          },
        },
      },
      10,
    );

    expect(agents).toHaveLength(1);
    expect(agents[0]).toMatchObject({
      presenceFreshness: "fresh-for-routing",
      consentDriveStatus: "unavailable",
      health: {
        status: "adapter-unavailable",
        reason: "consent-drive is advertised but no route tuple is registered",
        adapter: "codex-consent-drive",
      },
    });
  });

  it("marks old cross-device Codex presence as stale-visible", () => {
    const old = new Date(Date.now() - 40 * 60 * 1000).toISOString();
    const agents = buildWhoAgents(
      {
        "codex-ko": {
          id: "codex-ko",
          agent: "코",
          timestamp: old,
          lastActivity: old,
          status: "active",
          source: "mcp-direct",
          instanceId: "codex-ko",
          connectHash: "instance:codex-ko",
          address: {
            hostId: "D:\\HUA\\hua-comms",
            clientId: "codex-ko",
            conversationId: "thread-ko",
            ownerClientId: "owner-ko",
            routingAddress: "코",
            slot: null,
            aliases: ["코", "codex-ko"],
          },
          capabilities: {
            receiveTransports: ["consent-drive"],
            conversationId: "thread-ko",
            ownerClientId: "owner-ko",
          },
        },
      },
      1440,
    );

    expect(agents).toHaveLength(1);
    expect(agents[0]).toMatchObject({
      presenceFreshness: "stale-visible",
      consentDriveStatus: "stale",
      health: {
        status: "stale-owner",
        reason: "cross-device presence is stale-visible, not fresh-for-routing",
        adapter: "codex-consent-drive",
      },
    });
    expect(agents[0].health.recovery).toContain("tap:presence-publish");
    expect(agents[0].health.recovery).toContain("warm up");
    expect(agents[0].health.recovery).toContain("publish fresh presence");
  });

  it("keeps polling-only CLI lanes visible within the 17-hour local window", () => {
    const localAge = new Date(Date.now() - 16 * 60 * 60 * 1000).toISOString();
    const agents = buildWhoAgents(
      {
        준: {
          id: "준",
          agent: "준",
          timestamp: localAge,
          lastActivity: localAge,
          status: "active",
          source: "mcp-direct",
          connectHash: "session:준",
          address: {
            hostId: "/Users/devin/HUA/hua-comms",
            clientId: "jun-cli",
            conversationId: null,
            ownerClientId: null,
            routingAddress: "준",
            aliases: ["준", "codex"],
            slot: null,
          },
          receiveTransports: ["polling"],
          capabilities: {
            receiveTransports: ["polling"],
          },
        },
      },
      POLLING_RECIPIENT_VISIBILITY_MINUTES,
    );

    expect(agents).toHaveLength(1);
    expect(agents[0]).toMatchObject({
      presenceFreshness: "visible",
      consentDriveStatus: null,
      health: {
        status: "ready",
        reason:
          "inbox polling via tap_list_unread; no realtime push channel advertised",
        adapter: "file-polling",
      },
    });
  });

  it("marks polling-only CLI lanes stale after the 17-hour local window", () => {
    const old = new Date(Date.now() - 18 * 60 * 60 * 1000).toISOString();
    const agents = buildWhoAgents(
      {
        준: {
          id: "준",
          agent: "준",
          timestamp: old,
          lastActivity: old,
          status: "active",
          source: "mcp-direct",
          connectHash: "session:준",
          address: {
            hostId: "/Users/devin/HUA/hua-comms",
            clientId: "jun-cli",
            conversationId: null,
            ownerClientId: null,
            routingAddress: "준",
            aliases: ["준", "codex"],
            slot: null,
          },
          receiveTransports: ["polling"],
          capabilities: {
            receiveTransports: ["polling"],
          },
        },
      },
      24 * 60,
    );

    expect(agents).toHaveLength(1);
    expect(agents[0]).toMatchObject({
      presenceFreshness: "stale-visible",
      consentDriveStatus: null,
    });
  });

  it("lets stale-visible freshness override persisted ready health", () => {
    const old = new Date(Date.now() - 40 * 60 * 1000).toISOString();
    const agents = buildWhoAgents(
      {
        "codex-ko": {
          id: "codex-ko",
          agent: "코",
          timestamp: old,
          lastActivity: old,
          status: "active",
          source: "mcp-direct",
          instanceId: "codex-ko",
          connectHash: "instance:codex-ko",
          address: {
            hostId: "D:\\HUA\\hua-comms",
            clientId: "codex-ko",
            conversationId: "thread-ko",
            ownerClientId: "owner-ko",
            routingAddress: "코",
            slot: null,
            aliases: ["코", "codex-ko"],
          },
          capabilities: {
            receiveTransports: ["consent-drive"],
            conversationId: "thread-ko",
            ownerClientId: "owner-ko",
          },
          health: {
            status: "ready",
            reason: null,
            checkedAt: old,
            adapter: "codex-desktop-ipc",
            recovery: null,
          },
        },
      },
      1440,
    );

    expect(agents).toHaveLength(1);
    expect(agents[0]).toMatchObject({
      presenceFreshness: "stale-visible",
      consentDriveStatus: "stale",
      health: {
        status: "stale-owner",
        reason: "cross-device presence is stale-visible, not fresh-for-routing",
      },
    });
  });

  it("lets stale-visible health override lower-severity persisted health", () => {
    const old = new Date(Date.now() - 40 * 60 * 1000).toISOString();
    const agents = buildWhoAgents(
      {
        "codex-ko": {
          id: "codex-ko",
          agent: "코",
          timestamp: old,
          lastActivity: old,
          status: "active",
          source: "mcp-direct",
          instanceId: "codex-ko",
          connectHash: "instance:codex-ko",
          address: {
            hostId: "D:\\HUA\\hua-comms",
            clientId: "codex-ko",
            conversationId: "thread-ko",
            ownerClientId: "owner-ko",
            routingAddress: "코",
            slot: null,
            aliases: ["코", "codex-ko"],
          },
          capabilities: {
            receiveTransports: ["consent-drive"],
            conversationId: "thread-ko",
            ownerClientId: "owner-ko",
          },
          health: {
            status: "partial",
            reason: "owner was missing before snapshot aged out",
            checkedAt: old,
            adapter: "codex-desktop-ipc",
            recovery: "register capabilities",
          },
        },
      },
      1440,
    );

    expect(agents).toHaveLength(1);
    expect(agents[0].health).toMatchObject({
      status: "stale-owner",
      reason: "cross-device presence is stale-visible, not fresh-for-routing",
    });
    expect(agents[0].health.recovery).toContain("publish fresh presence");
  });

  it("preserves higher-severity persisted health on stale-visible rows", () => {
    const old = new Date(Date.now() - 40 * 60 * 1000).toISOString();
    const agents = buildWhoAgents(
      {
        "codex-ko": {
          id: "codex-ko",
          agent: "코",
          timestamp: old,
          lastActivity: old,
          status: "active",
          source: "mcp-direct",
          instanceId: "codex-ko",
          connectHash: "instance:codex-ko",
          address: {
            hostId: "D:\\HUA\\hua-comms",
            clientId: "codex-ko",
            conversationId: "thread-ko",
            ownerClientId: "owner-ko",
            routingAddress: "코",
            slot: null,
            aliases: ["코", "codex-ko"],
          },
          capabilities: {
            receiveTransports: ["consent-drive"],
            conversationId: "thread-ko",
            ownerClientId: "owner-ko",
          },
          health: {
            status: "stuck-turn",
            reason: "empty inProgress turn exceeded threshold",
            checkedAt: old,
            adapter: "codex-desktop-ipc",
            recovery:
              "codex:windows -- --conversation-id thread-ko --interrupt-stuck",
          },
        },
      },
      1440,
    );

    expect(agents).toHaveLength(1);
    expect(agents[0]).toMatchObject({
      presenceFreshness: "stale-visible",
      consentDriveStatus: "stale",
      health: {
        status: "stuck-turn",
        reason: "empty inProgress turn exceeded threshold",
      },
    });
  });

  it("preserves heartbeat-published health metadata", () => {
    const now = new Date().toISOString();
    const agents = buildWhoAgents(
      {
        "codex-ha": {
          id: "codex-ha",
          agent: "하",
          timestamp: now,
          lastActivity: now,
          status: "active",
          source: "mcp-direct",
          instanceId: "codex-ha",
          connectHash: "instance:codex-ha",
          receiveTransports: ["consent-drive"],
          health: {
            status: "stuck-turn",
            reason: "empty inProgress turn exceeded threshold",
            checkedAt: now,
            adapter: "codex-desktop-ipc",
            recovery:
              "codex:windows -- --conversation-id thread-ha --interrupt-stuck",
          },
        },
      },
      10,
    );

    expect(agents).toHaveLength(1);
    expect(agents[0].health).toEqual({
      status: "stuck-turn",
      reason: "empty inProgress turn exceeded threshold",
      checkedAt: now,
      adapter: "codex-desktop-ipc",
      recovery:
        "codex:windows -- --conversation-id thread-ha --interrupt-stuck",
    });
  });

  it("preserves heartbeat-published stale-owner health metadata", () => {
    const now = new Date().toISOString();
    const agents = buildWhoAgents(
      {
        "codex-ha": {
          id: "codex-ha",
          agent: "하",
          timestamp: now,
          lastActivity: now,
          status: "active",
          source: "mcp-direct",
          instanceId: "codex-ha",
          connectHash: "instance:codex-ha",
          receiveTransports: ["consent-drive"],
          health: {
            status: "stale-owner",
            reason: "stored owner differs from live IPC owner",
            checkedAt: now,
            adapter: "codex-desktop-ipc",
            recovery:
              "run tap_register_capabilities from the target runtime with conversationId and omit ownerClientId",
          },
        },
      },
      10,
    );

    expect(agents).toHaveLength(1);
    expect(agents[0].health).toMatchObject({
      status: "stale-owner",
      reason: "stored owner differs from live IPC owner",
      adapter: "codex-desktop-ipc",
    });
    expect(agents[0].health.recovery).toContain("tap_register_capabilities");
  });

  it("marks active bridge turns as active-turn health", () => {
    const stateDir = writeState({
      "codex-worker": {
        instanceId: "codex-worker",
        runtime: "codex",
        installed: true,
        bridgeMode: "app-server",
        agentName: "솔",
      },
    });
    const runtimeStateDir = join(TEST_DIR, "runtime-codex-active");
    mkdirSync(runtimeStateDir, { recursive: true });
    writeFileSync(
      join(stateDir, "pids", "bridge-codex-worker.json"),
      JSON.stringify(
        {
          pid: process.pid,
          runtimeStateDir,
        },
        null,
        2,
      ),
      "utf-8",
    );
    writeFileSync(
      join(runtimeStateDir, "heartbeat.json"),
      JSON.stringify(
        {
          connected: true,
          initialized: true,
          threadId: "thread-1",
          activeTurnId: "turn-1",
          turnState: "active",
        },
        null,
        2,
      ),
      "utf-8",
    );

    const agents = buildWhoAgents(
      {
        codex_worker: {
          id: "codex_worker",
          agent: "솔",
          timestamp: "2026-04-01T00:01:00.000Z",
          lastActivity: new Date().toISOString(),
          status: "active",
        },
      },
      10,
    );

    expect(agents).toHaveLength(1);
    expect(agents[0].session).toBe("active");
    expect(agents[0].health).toMatchObject({
      status: "active-turn",
      reason: "target conversation has an active turn",
      adapter: "codex-bridge",
      recovery: "wait for the active turn to finish",
    });
  });

  it("marks initializing bridge presence as degraded health", () => {
    const stateDir = writeState({
      "codex-worker": {
        instanceId: "codex-worker",
        runtime: "codex",
        installed: true,
        bridgeMode: "app-server",
        agentName: "솔",
      },
    });
    const runtimeStateDir = join(TEST_DIR, "runtime-codex-initializing");
    mkdirSync(runtimeStateDir, { recursive: true });
    writeFileSync(
      join(stateDir, "pids", "bridge-codex-worker.json"),
      JSON.stringify(
        {
          pid: process.pid,
          runtimeStateDir,
        },
        null,
        2,
      ),
      "utf-8",
    );
    writeFileSync(
      join(runtimeStateDir, "heartbeat.json"),
      JSON.stringify(
        {
          connected: true,
          initialized: false,
          threadId: null,
        },
        null,
        2,
      ),
      "utf-8",
    );

    const agents = buildWhoAgents(
      {
        codex_worker: {
          id: "codex_worker",
          agent: "솔",
          timestamp: "2026-04-01T00:01:00.000Z",
          lastActivity: new Date().toISOString(),
          status: "active",
        },
      },
      10,
    );

    expect(agents).toHaveLength(1);
    expect(agents[0].lifecycle).toBe("initializing");
    expect(agents[0].health).toMatchObject({
      status: "degraded",
      reason: "bridge/app-server is initializing",
      adapter: "codex-bridge",
    });
    expect(agents[0].health.recovery).toContain(
      "docs/areas/tap/codex-app-server-bridge-runbook.md",
    );
  });

  it("marks stale bridge presence as adapter-unavailable health", () => {
    const stateDir = writeState({
      "codex-worker": {
        instanceId: "codex-worker",
        runtime: "codex",
        installed: true,
        bridgeMode: "app-server",
        agentName: "솔",
      },
    });
    writeFileSync(
      join(stateDir, "pids", "bridge-codex-worker.json"),
      JSON.stringify(
        {
          pid: 99999999,
          runtimeStateDir: join(TEST_DIR, "missing-runtime"),
        },
        null,
        2,
      ),
      "utf-8",
    );

    const agents = buildWhoAgents(
      {
        codex_worker: {
          id: "codex_worker",
          agent: "솔",
          timestamp: "2026-04-01T00:01:00.000Z",
          lastActivity: new Date().toISOString(),
          status: "active",
        },
      },
      10,
    );

    expect(agents).toHaveLength(1);
    expect(agents[0].presence).toBe("bridge-stale");
    expect(agents[0].health).toMatchObject({
      status: "adapter-unavailable",
      reason: "bridge process is stale",
      adapter: "codex-bridge",
    });
    expect(agents[0].health.recovery).toContain("restart");
    expect(agents[0].health.recovery).toContain(
      "docs/areas/tap/codex-app-server-bridge-runbook.md",
    );
    expect(agents[0].health.recovery).toContain(
      "docs/areas/tap/sumback-codex-lifecycle.md",
    );
  });

  it("resolves structured targets using client and conversation constraints", () => {
    const now = new Date().toISOString();
    const resolution = resolveStructuredRecipient(
      {
        "codex-worker": {
          id: "codex-worker",
          agent: "솔",
          timestamp: now,
          lastActivity: now,
          status: "active",
          source: "bridge-dispatch",
          instanceId: "codex-worker",
          connectHash: "instance:codex-worker",
          address: {
            hostId: "host-a",
            clientId: "codex-worker",
            conversationId: "thread-1",
            ownerClientId: "codex-worker",
            routingAddress: "솔",
            slot: null,
            aliases: ["솔", "codex-worker"],
          },
        },
        reviewer_agent: {
          id: "reviewer_agent",
          agent: "솔",
          timestamp: now,
          lastActivity: now,
          status: "active",
          source: "mcp-direct",
          connectHash: "session:reviewer_agent",
          address: {
            hostId: "host-b",
            clientId: null,
            conversationId: null,
            ownerClientId: null,
            routingAddress: "솔",
            slot: null,
            aliases: ["솔", "reviewer_agent"],
          },
        },
      },
      {
        routingAddress: "솔",
        clientId: "codex-worker",
        conversationId: "thread-1",
      },
    );

    expect(resolution).toMatchObject({
      target: "codex-worker",
      routingTarget: "솔",
      found: true,
      ambiguous: false,
      displayName: "솔",
    });
    expect(resolution.address).toMatchObject({
      hostId: "host-a",
      clientId: "codex-worker",
      conversationId: "thread-1",
    });
  });

  it("rejects structured targets when requested address constraints do not match any live recipient", () => {
    const now = new Date().toISOString();
    const resolution = resolveStructuredRecipient(
      {
        "codex-worker": {
          id: "codex-worker",
          agent: "솔",
          timestamp: now,
          lastActivity: now,
          status: "active",
          source: "bridge-dispatch",
          instanceId: "codex-worker",
          connectHash: "instance:codex-worker",
          address: {
            hostId: "host-a",
            clientId: "codex-worker",
            conversationId: "thread-1",
            ownerClientId: "codex-worker",
            routingAddress: "wt-1",
            slot: "wt-1",
            aliases: ["wt-1", "codex-worker"],
          },
        },
      },
      {
        routingAddress: "wt-1",
        clientId: "codex-worker",
        conversationId: "thread-missing",
      },
    );

    expect(resolution).toMatchObject({
      target: "wt-1",
      routingTarget: "wt-1",
      found: false,
      ambiguous: false,
      address: null,
    });
  });

  it("rejects structured targets that only match stale-visible presence", () => {
    const old = new Date(Date.now() - 40 * 60 * 1000).toISOString();
    const resolution = resolveStructuredRecipient(
      {
        "codex-ko": {
          id: "codex-ko",
          agent: "코",
          timestamp: old,
          lastActivity: old,
          status: "active",
          source: "mcp-direct",
          instanceId: "codex-ko",
          connectHash: "instance:codex-ko",
          address: {
            hostId: "D:\\HUA\\hua-comms",
            clientId: "codex-ko",
            conversationId: "thread-ko",
            ownerClientId: "owner-ko",
            routingAddress: "코",
            slot: null,
            aliases: ["코", "codex-ko"],
          },
          capabilities: {
            receiveTransports: ["consent-drive"],
            conversationId: "thread-ko",
            ownerClientId: "owner-ko",
          },
        },
      },
      {
        routingAddress: "코",
        conversationId: "thread-ko",
        ownerClientId: "owner-ko",
      },
    );

    expect(resolution).toMatchObject({
      target: "코",
      routingTarget: "코",
      found: false,
      ambiguous: false,
      candidates: ["codex-ko"],
    });
    expect(resolution.warning).toContain("stale-visible");
    expect(resolution.warning).toContain("fresh-for-routing");
    expect(resolution.warning).toContain("tap:presence-publish");
    expect(resolution.warning).toContain("warm up");
  });

  it("allows structured polling targets within the 17-hour local window without consent-drive authority", () => {
    const localAge = new Date(Date.now() - 16 * 60 * 60 * 1000).toISOString();
    const resolution = resolveStructuredRecipient(
      {
        준: {
          id: "준",
          agent: "준",
          timestamp: localAge,
          lastActivity: localAge,
          status: "active",
          source: "mcp-direct",
          connectHash: "session:준",
          address: {
            hostId: "/Users/devin/HUA/hua-comms",
            clientId: "jun-cli",
            conversationId: null,
            ownerClientId: null,
            routingAddress: "준",
            aliases: ["준", "codex"],
            slot: null,
          },
          receiveTransports: ["polling"],
          capabilities: {
            receiveTransports: ["polling"],
          },
        },
      },
      {
        routingAddress: "준",
        hostId: "/Users/devin/HUA/hua-comms",
      },
    );

    expect(resolution).toMatchObject({
      target: "준",
      routingTarget: "준",
      found: true,
      ambiguous: false,
      receiveTransports: ["polling"],
    });
  });

  it("rejects structured targets for signing-off heartbeat rows", () => {
    const resolution = resolveStructuredRecipient(
      {
        reviewer_agent: {
          id: "reviewer_agent",
          agent: "솔",
          timestamp: new Date().toISOString(),
          lastActivity: new Date().toISOString(),
          status: "signing-off",
          source: "mcp-direct",
          connectHash: "session:reviewer_agent",
          address: {
            hostId: "host-b",
            clientId: "reviewer-agent",
            conversationId: "thread-2",
            ownerClientId: "reviewer-agent",
            routingAddress: "솔",
            slot: null,
            aliases: ["솔", "reviewer_agent"],
          },
        },
      },
      {
        routingAddress: "솔",
      },
    );

    expect(resolution).toMatchObject({
      target: "솔",
      routingTarget: "솔",
      found: false,
      ambiguous: false,
      address: null,
    });
  });

  it("rejects structured targets for stale bridge-backed recipients", () => {
    const stateDir = writeState({
      "codex-reviewer": {
        instanceId: "codex-reviewer",
        runtime: "codex",
        installed: true,
        bridgeMode: "app-server",
        agentName: "결",
      },
    });
    writeFileSync(
      join(stateDir, "pids", "bridge-codex-reviewer.json"),
      JSON.stringify(
        {
          pid: 999999,
          runtimeStateDir: join(TEST_DIR, "runtime-codex-reviewer-stale"),
        },
        null,
        2,
      ),
      "utf-8",
    );

    const resolution = resolveStructuredRecipient(
      {
        codex_reviewer: {
          id: "codex_reviewer",
          agent: "결",
          timestamp: new Date().toISOString(),
          lastActivity: new Date().toISOString(),
          status: "active",
          source: "bridge-dispatch",
          instanceId: "codex-reviewer",
          connectHash: "instance:codex-reviewer",
          address: {
            hostId: "host-a",
            clientId: "codex-reviewer",
            conversationId: "thread-9",
            ownerClientId: "codex-reviewer",
            routingAddress: "wt-9",
            slot: "wt-9",
            aliases: ["wt-9", "codex-reviewer", "결"],
          },
        },
      },
      {
        routingAddress: "wt-9",
        clientId: "codex-reviewer",
      },
    );

    expect(resolution).toMatchObject({
      target: "wt-9",
      routingTarget: "wt-9",
      found: false,
      ambiguous: false,
      address: null,
    });
  });

  it("rejects action metadata without a capability scope", () => {
    expect(
      validateStructuredEnvelopeMetadata({
        target: { routingAddress: "wt-1", conversationId: "thread-1" },
        scope: null,
        action: "start-turn",
        consentRef: null,
      }),
    ).toBe('A2A envelope "action" metadata requires a scope.');
  });

  it("rejects observe metadata that tries to carry control fields", () => {
    expect(
      validateStructuredEnvelopeMetadata({
        target: { routingAddress: "wt-1", conversationId: "thread-1" },
        scope: "observe",
        action: "start-turn",
        consentRef: null,
      }),
    ).toBe("Observe scope is passive-only and cannot include an action.");
  });

  it("requires conversation binding for suggest and drive scopes", () => {
    expect(
      validateStructuredEnvelopeMetadata({
        target: { routingAddress: "wt-1" },
        scope: "suggest",
        action: "start-turn",
        consentRef: null,
      }),
    ).toBe(
      "suggest scope requires target.conversationId for auditable routing.",
    );

    expect(
      validateStructuredEnvelopeMetadata({
        target: { routingAddress: "wt-1" },
        scope: "drive",
        action: "start-turn",
        consentRef: "grant-1",
      }),
    ).toBe("drive scope requires target.conversationId for auditable routing.");
  });

  it("requires action and consent for drive envelopes", () => {
    expect(
      validateStructuredEnvelopeMetadata({
        target: { routingAddress: "wt-1", conversationId: "thread-1" },
        scope: "drive",
        action: null,
        consentRef: "grant-1",
      }),
    ).toBe("drive scope requires a non-empty action.");

    expect(
      validateStructuredEnvelopeMetadata({
        target: { routingAddress: "wt-1", conversationId: "thread-1" },
        scope: "drive",
        action: "start-turn",
        consentRef: null,
      }),
    ).toBe("Drive scope requires a non-empty consentRef.");
  });

  it("accepts suggest and drive metadata when the required fields are present", () => {
    expect(
      validateStructuredEnvelopeMetadata({
        target: { routingAddress: "wt-1", conversationId: "thread-1" },
        scope: "suggest",
        action: "start-turn",
        consentRef: null,
      }),
    ).toBeNull();

    expect(
      validateStructuredEnvelopeMetadata({
        target: { routingAddress: "wt-1", conversationId: "thread-1" },
        scope: "drive",
        action: "start-turn",
        consentRef: "grant-1",
      }),
    ).toBeNull();
  });

  it("dedupes bridge and direct heartbeats for the same instance", () => {
    const stateDir = writeState({
      "codex-worker": {
        instanceId: "codex-worker",
        runtime: "codex",
        installed: true,
        bridgeMode: "app-server",
        agentName: "솔",
      },
    });
    const runtimeStateDir = join(TEST_DIR, "runtime-codex-worker");
    mkdirSync(runtimeStateDir, { recursive: true });
    writeFileSync(
      join(stateDir, "pids", "bridge-codex-worker.json"),
      JSON.stringify(
        {
          pid: process.pid,
          runtimeStateDir,
        },
        null,
        2,
      ),
      "utf-8",
    );
    writeFileSync(
      join(runtimeStateDir, "heartbeat.json"),
      JSON.stringify(
        {
          connected: true,
          initialized: true,
          threadId: "thread-1",
          turnState: "idle",
          idleSince: "2026-04-01T00:00:00.000Z",
        },
        null,
        2,
      ),
      "utf-8",
    );

    const agents = buildWhoAgents(
      {
        codex_worker: {
          id: "codex_worker",
          agent: "솔",
          timestamp: "2026-04-01T00:01:00.000Z",
          lastActivity: new Date().toISOString(),
          status: "active",
          source: "mcp-direct",
          instanceId: "codex-worker",
          connectHash: "instance:codex-worker",
        },
        "codex-worker": {
          id: "codex-worker",
          agent: "솔",
          timestamp: "2026-04-01T00:02:00.000Z",
          lastActivity: new Date().toISOString(),
          status: "active",
          source: "bridge-dispatch",
          instanceId: "codex-worker",
          bridgePid: process.pid,
          connectHash: "instance:codex-worker",
        },
      },
      10,
    );

    expect(agents).toHaveLength(1);
    expect(agents[0]).toMatchObject({
      id: "codex-worker",
      agent: "솔 [codex-worker]",
      source: "bridge-dispatch",
      instanceId: "codex-worker",
      presence: "bridge-live",
      lifecycle: "ready",
    });
  });

  it("M317-7: tap_who keeps Claude and Codex instances separate", () => {
    const now = new Date().toISOString();
    const agents = buildWhoAgents(
      {
        claude_main: {
          id: "claude_main",
          agent: "담",
          timestamp: "2026-04-01T00:01:00.000Z",
          lastActivity: now,
          status: "active",
          source: "mcp-direct",
          instanceId: "claude-main",
          connectHash: "instance:claude-main",
        },
        codex_reviewer: {
          id: "codex_reviewer",
          agent: "담",
          timestamp: "2026-04-01T00:01:30.000Z",
          lastActivity: now,
          status: "active",
          source: "bridge-dispatch",
          instanceId: "codex-reviewer",
          connectHash: "instance:codex-reviewer",
        },
      },
      10,
    );

    expect(agents).toHaveLength(2);
    expect(agents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "claude_main",
          agent: "담 [claude_main]",
          instanceId: "claude-main",
          slot: "tower",
          routingAddress: "tower",
        }),
        expect.objectContaining({
          id: "codex_reviewer",
          agent: "담 [codex_reviewer]",
          instanceId: "codex-reviewer",
          slot: "reviewer",
          routingAddress: "reviewer",
        }),
      ]),
    );
  });

  it("routes duplicate display names to the preferred live bridge candidate", () => {
    const stateDir = writeState({
      "codex-worker": {
        instanceId: "codex-worker",
        runtime: "codex",
        installed: true,
        bridgeMode: "app-server",
        agentName: "솔",
      },
    });
    const runtimeStateDir = join(TEST_DIR, "runtime-codex-worker");
    mkdirSync(runtimeStateDir, { recursive: true });
    writeFileSync(
      join(stateDir, "pids", "bridge-codex-worker.json"),
      JSON.stringify(
        {
          pid: process.pid,
          runtimeStateDir,
        },
        null,
        2,
      ),
      "utf-8",
    );
    writeFileSync(
      join(runtimeStateDir, "heartbeat.json"),
      JSON.stringify(
        {
          connected: true,
          initialized: true,
          threadId: "thread-1",
          turnState: "idle",
        },
        null,
        2,
      ),
      "utf-8",
    );

    const resolution = resolvePreferredRecipient(
      {
        "codex-worker": {
          id: "codex-worker",
          agent: "솔",
          timestamp: "2026-04-01T00:02:00.000Z",
          lastActivity: "2026-04-01T00:02:00.000Z",
          status: "active",
          source: "bridge-dispatch",
          instanceId: "codex-worker",
          bridgePid: process.pid,
          connectHash: "instance:codex-worker",
        },
        reviewer_agent: {
          id: "reviewer_agent",
          agent: "솔",
          timestamp: "2026-04-01T00:03:00.000Z",
          lastActivity: "2026-04-01T00:03:00.000Z",
          status: "active",
          source: "mcp-direct",
          connectHash: "session:reviewer_agent",
        },
      },
      "솔",
    );

    expect(resolution).toMatchObject({
      target: "codex-worker",
      found: true,
      ambiguous: true,
      candidates: ["codex-worker", "reviewer_agent"],
    });
    expect(resolution.warning).toContain("bridge-live/bridge-dispatch");
  });

  it("prefers the freshest attached TUI display name within the same connect hash", () => {
    const earlier = new Date(Date.now() - 2_000).toISOString();
    const later = new Date(Date.now() - 1_000).toISOString();
    const stateDir = writeState({
      "codex-impl": {
        instanceId: "codex-impl",
        runtime: "codex",
        installed: true,
        bridgeMode: "app-server",
        agentName: "해",
      },
    });
    const runtimeStateDir = join(TEST_DIR, "runtime-codex-impl");
    mkdirSync(runtimeStateDir, { recursive: true });
    writeFileSync(
      join(stateDir, "pids", "bridge-codex-impl.json"),
      JSON.stringify(
        {
          pid: process.pid,
          runtimeStateDir,
        },
        null,
        2,
      ),
      "utf-8",
    );
    writeFileSync(
      join(runtimeStateDir, "heartbeat.json"),
      JSON.stringify(
        {
          connected: true,
          initialized: true,
          threadId: "thread-1",
          turnState: "idle",
        },
        null,
        2,
      ),
      "utf-8",
    );

    const agents = buildWhoAgents(
      {
        "codex-impl": {
          id: "codex-impl",
          agent: "해",
          timestamp: earlier,
          lastActivity: earlier,
          status: "active",
          source: "bridge-dispatch",
          instanceId: "codex-impl",
          bridgePid: process.pid,
          connectHash: "instance:codex-impl",
        },
        codex_impl: {
          id: "codex_impl",
          agent: "온",
          timestamp: later,
          lastActivity: later,
          status: "active",
          source: "mcp-direct",
          instanceId: "codex-impl",
          connectHash: "instance:codex-impl",
          health: {
            status: "stuck-turn",
            reason: "empty inProgress turn exceeded threshold",
            checkedAt: later,
            adapter: "codex-desktop-ipc",
            recovery:
              "codex:windows -- --conversation-id thread-1 --interrupt-stuck",
          },
        },
      },
      10,
    );

    expect(agents).toHaveLength(1);
    expect(agents[0]).toMatchObject({
      id: "codex-impl",
      agent: "온 [codex-impl]",
      source: "bridge-dispatch",
      presence: "bridge-live",
      instanceId: "codex-impl",
      health: {
        status: "stuck-turn",
        reason: "empty inProgress turn exceeded threshold",
        adapter: "codex-desktop-ipc",
      },
    });
    expect(agents[0].health.recovery).toContain("--interrupt-stuck");
  });

  it("routes attached TUI alias names back to the bridge-backed winner for the same instance", () => {
    const earlier = new Date(Date.now() - 2_000).toISOString();
    const later = new Date(Date.now() - 1_000).toISOString();
    const stateDir = writeState({
      "codex-impl": {
        instanceId: "codex-impl",
        runtime: "codex",
        installed: true,
        bridgeMode: "app-server",
        agentName: "해",
      },
    });
    const runtimeStateDir = join(TEST_DIR, "runtime-codex-impl");
    mkdirSync(runtimeStateDir, { recursive: true });
    writeFileSync(
      join(stateDir, "pids", "bridge-codex-impl.json"),
      JSON.stringify(
        {
          pid: process.pid,
          runtimeStateDir,
        },
        null,
        2,
      ),
      "utf-8",
    );
    writeFileSync(
      join(runtimeStateDir, "heartbeat.json"),
      JSON.stringify(
        {
          connected: true,
          initialized: true,
          threadId: "thread-1",
          turnState: "idle",
        },
        null,
        2,
      ),
      "utf-8",
    );

    const resolution = resolvePreferredRecipient(
      {
        "codex-impl": {
          id: "codex-impl",
          agent: "해",
          timestamp: earlier,
          lastActivity: earlier,
          status: "active",
          source: "bridge-dispatch",
          instanceId: "codex-impl",
          bridgePid: process.pid,
          connectHash: "instance:codex-impl",
        },
        codex_impl: {
          id: "codex_impl",
          agent: "온",
          timestamp: later,
          lastActivity: later,
          status: "active",
          source: "mcp-direct",
          instanceId: "codex-impl",
          connectHash: "instance:codex-impl",
        },
      },
      "온",
    );

    expect(resolution).toMatchObject({
      target: "codex-impl",
      found: true,
      ambiguous: false,
      candidates: ["codex-impl"],
      warning: null,
    });
  });

  it("preserves exact attached TUI id routing instead of collapsing to the bridge winner", () => {
    const earlier = new Date(Date.now() - 2_000).toISOString();
    const later = new Date(Date.now() - 1_000).toISOString();

    const resolution = resolvePreferredRecipient(
      {
        "codex-impl": {
          id: "codex-impl",
          agent: "해",
          timestamp: earlier,
          lastActivity: earlier,
          status: "active",
          source: "bridge-dispatch",
          instanceId: "codex-impl",
          bridgePid: process.pid,
          connectHash: "instance:codex-impl",
        },
        codex_impl: {
          id: "codex_impl",
          agent: "온",
          timestamp: later,
          lastActivity: later,
          status: "active",
          source: "mcp-direct",
          instanceId: "codex-impl",
          connectHash: "instance:codex-impl",
        },
      },
      "codex_impl",
    );

    expect(resolution).toMatchObject({
      target: "codex_impl",
      found: true,
      ambiguous: false,
      candidates: ["codex_impl"],
      warning: null,
    });
  });

  it("keeps the attached TUI display name as representative even when bridge activity is newer", () => {
    const now = Date.now();
    const bridgeLater = new Date(now - 1_000).toISOString();
    const attachedEarlier = new Date(now - 5_000).toISOString();
    const stateDir = writeState({
      "codex-impl": {
        instanceId: "codex-impl",
        runtime: "codex",
        installed: true,
        bridgeMode: "app-server",
        agentName: "해",
      },
    });
    const runtimeStateDir = join(TEST_DIR, "runtime-codex-impl-newer-bridge");
    mkdirSync(runtimeStateDir, { recursive: true });
    writeFileSync(
      join(stateDir, "pids", "bridge-codex-impl.json"),
      JSON.stringify(
        {
          pid: process.pid,
          runtimeStateDir,
        },
        null,
        2,
      ),
      "utf-8",
    );
    writeFileSync(
      join(runtimeStateDir, "heartbeat.json"),
      JSON.stringify(
        {
          connected: true,
          initialized: true,
          threadId: "thread-1",
          turnState: "idle",
        },
        null,
        2,
      ),
      "utf-8",
    );

    const agents = buildWhoAgents(
      {
        "codex-impl": {
          id: "codex-impl",
          agent: "해",
          timestamp: bridgeLater,
          lastActivity: bridgeLater,
          status: "active",
          source: "bridge-dispatch",
          instanceId: "codex-impl",
          bridgePid: process.pid,
          connectHash: "instance:codex-impl",
        },
        codex_impl: {
          id: "codex_impl",
          agent: "온",
          timestamp: attachedEarlier,
          lastActivity: attachedEarlier,
          status: "active",
          source: "mcp-direct",
          instanceId: "codex-impl",
          connectHash: "instance:codex-impl",
        },
      },
      10,
    );

    expect(agents).toHaveLength(1);
    expect(agents[0]).toMatchObject({
      id: "codex-impl",
      agent: "온 [codex-impl]",
      source: "bridge-dispatch",
      presence: "bridge-live",
    });
  });

  it("does not prefer a signing-off attached TUI alias over a live bridge name", () => {
    const now = Date.now();
    const bridgeLater = new Date(now - 1_000).toISOString();
    const attachedEarlier = new Date(now - 5_000).toISOString();
    const stateDir = writeState({
      "codex-impl": {
        instanceId: "codex-impl",
        runtime: "codex",
        installed: true,
        bridgeMode: "app-server",
        agentName: "해",
      },
    });
    const runtimeStateDir = join(TEST_DIR, "runtime-codex-impl-signing-off");
    mkdirSync(runtimeStateDir, { recursive: true });
    writeFileSync(
      join(stateDir, "pids", "bridge-codex-impl.json"),
      JSON.stringify(
        {
          pid: process.pid,
          runtimeStateDir,
        },
        null,
        2,
      ),
      "utf-8",
    );
    writeFileSync(
      join(runtimeStateDir, "heartbeat.json"),
      JSON.stringify(
        {
          connected: true,
          initialized: true,
          threadId: "thread-1",
          turnState: "idle",
        },
        null,
        2,
      ),
      "utf-8",
    );

    const agents = buildWhoAgents(
      {
        "codex-impl": {
          id: "codex-impl",
          agent: "해",
          timestamp: bridgeLater,
          lastActivity: bridgeLater,
          status: "active",
          source: "bridge-dispatch",
          instanceId: "codex-impl",
          bridgePid: process.pid,
          connectHash: "instance:codex-impl",
        },
        codex_impl: {
          id: "codex_impl",
          agent: "온",
          timestamp: attachedEarlier,
          lastActivity: attachedEarlier,
          status: "signing-off",
          source: "mcp-direct",
          instanceId: "codex-impl",
          connectHash: "instance:codex-impl",
        },
      },
      10,
    );

    expect(agents).toHaveLength(1);
    expect(agents[0]).toMatchObject({
      id: "codex-impl",
      agent: "해 [codex-impl]",
      source: "bridge-dispatch",
      presence: "bridge-live",
    });
  });

  describe("M353: slot holder disambiguation (drift #5)", () => {
    it("marks newer heartbeat active and older stale-by-newer on same slot", () => {
      const now = Date.now();
      const older = new Date(now - 5_000).toISOString();
      const newer = new Date(now - 1_000).toISOString();
      const agents = buildWhoAgents(
        {
          claude_wt1_old: {
            id: "claude_wt1_old",
            agent: "결",
            timestamp: older,
            lastActivity: older,
            status: "active",
            source: "mcp-direct",
            instanceId: "claude-wt1",
            connectHash: "instance:claude-wt1-old",
          },
          claude_wt1_new: {
            id: "claude_wt1_new",
            agent: "담",
            timestamp: newer,
            lastActivity: newer,
            status: "active",
            source: "mcp-direct",
            instanceId: "claude-wt1",
            connectHash: "instance:claude-wt1-new",
          },
        },
        10,
      );

      expect(agents).toHaveLength(2);
      const byId = Object.fromEntries(agents.map((a) => [a.id, a]));
      expect(byId.claude_wt1_new.slotStatus).toBe("active");
      expect(byId.claude_wt1_old.slotStatus).toBe("stale-by-newer");
      expect(byId.claude_wt1_new.slot).toBe("wt-1");
      expect(byId.claude_wt1_old.slot).toBe("wt-1");
    });

    it("leaves slotStatus null for a sole slot holder or a no-slot entry", () => {
      const now = new Date().toISOString();
      const agents = buildWhoAgents(
        {
          claude_wt1: {
            id: "claude_wt1",
            agent: "결",
            timestamp: now,
            lastActivity: now,
            status: "active",
            source: "mcp-direct",
            instanceId: "claude-wt1",
            connectHash: "instance:claude-wt1",
          },
          "some-adhoc": {
            id: "some-adhoc",
            agent: "솔",
            timestamp: now,
            lastActivity: now,
            status: "active",
            source: "mcp-direct",
            connectHash: "session:some-adhoc",
          },
        },
        10,
      );

      const byId = Object.fromEntries(agents.map((a) => [a.id, a]));
      expect(byId.claude_wt1.slotStatus).toBeNull();
      expect(byId.claude_wt1.slot).toBe("wt-1");
      expect(byId["some-adhoc"].slotStatus).toBeNull();
      expect(byId["some-adhoc"].slot).toBeNull();
    });

    it("excludes signing-off and stale-bridge entries from slot contention", () => {
      const now = Date.now();
      const older = new Date(now - 5_000).toISOString();
      const newer = new Date(now - 1_000).toISOString();
      const agents = buildWhoAgents(
        {
          claude_wt1_signing_off: {
            id: "claude_wt1_signing_off",
            agent: "결",
            timestamp: newer,
            lastActivity: newer,
            status: "signing-off",
            source: "mcp-direct",
            instanceId: "claude-wt1",
            connectHash: "instance:claude-wt1-signing-off",
          },
          claude_wt1_live: {
            id: "claude_wt1_live",
            agent: "담",
            timestamp: older,
            lastActivity: older,
            status: "active",
            source: "mcp-direct",
            instanceId: "claude-wt1",
            connectHash: "instance:claude-wt1-live",
          },
        },
        10,
      );

      const byId = Object.fromEntries(agents.map((a) => [a.id, a]));
      // Signing-off entry did not contend → slotStatus null (not stale-by-newer).
      expect(byId.claude_wt1_signing_off.slotStatus).toBeNull();
      // The live entry is the sole contender → no competition, null.
      expect(byId.claude_wt1_live.slotStatus).toBeNull();
    });

    it("marks N-1 losers stale-by-newer in a three-way same-slot collision", () => {
      const now = Date.now();
      const oldest = new Date(now - 9_000).toISOString();
      const middle = new Date(now - 5_000).toISOString();
      const newest = new Date(now - 1_000).toISOString();
      const agents = buildWhoAgents(
        {
          claude_wt1_a: {
            id: "claude_wt1_a",
            agent: "결",
            timestamp: oldest,
            lastActivity: oldest,
            status: "active",
            source: "mcp-direct",
            instanceId: "claude-wt1",
            connectHash: "instance:claude-wt1-a",
          },
          claude_wt1_b: {
            id: "claude_wt1_b",
            agent: "돌",
            timestamp: middle,
            lastActivity: middle,
            status: "active",
            source: "mcp-direct",
            instanceId: "claude-wt1",
            connectHash: "instance:claude-wt1-b",
          },
          claude_wt1_c: {
            id: "claude_wt1_c",
            agent: "담",
            timestamp: newest,
            lastActivity: newest,
            status: "active",
            source: "mcp-direct",
            instanceId: "claude-wt1",
            connectHash: "instance:claude-wt1-c",
          },
        },
        10,
      );

      const byId = Object.fromEntries(agents.map((a) => [a.id, a]));
      expect(byId.claude_wt1_c.slotStatus).toBe("active");
      expect(byId.claude_wt1_b.slotStatus).toBe("stale-by-newer");
      expect(byId.claude_wt1_a.slotStatus).toBe("stale-by-newer");
    });

    it("routes slot-form address to the newer holder and excludes the stale loser", () => {
      const now = Date.now();
      const older = new Date(now - 5_000).toISOString();
      const newer = new Date(now - 1_000).toISOString();
      const store = {
        claude_wt1_old: {
          id: "claude_wt1_old",
          agent: "결",
          timestamp: older,
          lastActivity: older,
          status: "active" as const,
          source: "mcp-direct" as const,
          instanceId: "claude-wt1",
          connectHash: "instance:claude-wt1-old",
        },
        claude_wt1_new: {
          id: "claude_wt1_new",
          agent: "담",
          timestamp: newer,
          lastActivity: newer,
          status: "active" as const,
          source: "mcp-direct" as const,
          instanceId: "claude-wt1",
          connectHash: "instance:claude-wt1-new",
        },
      };

      const resolution = resolvePreferredRecipient(store, "wt-1");
      expect(resolution).toMatchObject({
        target: "claude_wt1_new",
        routingTarget: "wt-1",
        found: true,
        ambiguous: false,
      });
      expect(resolution.candidates).toEqual(["claude_wt1_new"]);
    });

    it("still allows direct agent_id routing to the stale-by-newer loser", () => {
      const now = Date.now();
      const older = new Date(now - 5_000).toISOString();
      const newer = new Date(now - 1_000).toISOString();
      const store = {
        claude_wt1_old: {
          id: "claude_wt1_old",
          agent: "결",
          timestamp: older,
          lastActivity: older,
          status: "active" as const,
          source: "mcp-direct" as const,
          instanceId: "claude-wt1",
          connectHash: "instance:claude-wt1-old",
        },
        claude_wt1_new: {
          id: "claude_wt1_new",
          agent: "담",
          timestamp: newer,
          lastActivity: newer,
          status: "active" as const,
          source: "mcp-direct" as const,
          instanceId: "claude-wt1",
          connectHash: "instance:claude-wt1-new",
        },
      };

      // Exact agent_id direct routing is allowed even for the stale-by-newer
      // loser — only the slot-form address is protected.
      const resolution = resolvePreferredRecipient(store, "claude_wt1_old");
      expect(resolution).toMatchObject({
        target: "claude_wt1_old",
        found: true,
        ambiguous: false,
      });
    });

    it("excludes stale-by-newer holders from structured slot-form routing", () => {
      const now = Date.now();
      const older = new Date(now - 5_000).toISOString();
      const newer = new Date(now - 1_000).toISOString();
      const resolution = resolveStructuredRecipient(
        {
          claude_wt1_old: {
            id: "claude_wt1_old",
            agent: "결",
            timestamp: older,
            lastActivity: older,
            status: "active",
            source: "mcp-direct",
            instanceId: "claude-wt1",
            connectHash: "instance:claude-wt1-old",
          },
          claude_wt1_new: {
            id: "claude_wt1_new",
            agent: "담",
            timestamp: newer,
            lastActivity: newer,
            status: "active",
            source: "mcp-direct",
            instanceId: "claude-wt1",
            connectHash: "instance:claude-wt1-new",
          },
        },
        { routingAddress: "wt-1" },
      );

      expect(resolution).toMatchObject({
        target: "claude_wt1_new",
        routingTarget: "wt-1",
        found: true,
        ambiguous: false,
      });
    });
  });
});
