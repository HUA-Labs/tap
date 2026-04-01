import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { TEST_DIR, resetTestDir, setTestEnv } from "./test-helpers.ts";

setTestEnv();

const { buildWhoAgents, resolvePreferredRecipient } = await import(
  "../tap-presence.ts"
);

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
    });
    expect(agents[0]?.idleSeconds).not.toBeNull();
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
});
