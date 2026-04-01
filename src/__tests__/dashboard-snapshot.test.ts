import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { collectDashboardSnapshot } from "../engine/dashboard.js";
import { version } from "../version.js";

let tmpDir: string;
let commsDir: string;
let originalCwd: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tap-dashboard-test-"));
  commsDir = path.join(tmpDir, "comms");
  fs.writeFileSync(path.join(tmpDir, "package.json"), "{}", "utf-8");
  fs.mkdirSync(path.join(tmpDir, ".tap-comms", "pids"), { recursive: true });
  fs.mkdirSync(commsDir, { recursive: true });

  originalCwd = process.cwd();
  process.chdir(tmpDir);
});

afterEach(() => {
  process.chdir(originalCwd);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("collectDashboardSnapshot", () => {
  it("adds bridge presence and lifecycle to agent rows", () => {
    const runtimeStateDir = path.join(tmpDir, ".tap-comms", ".tmp", "codex");
    fs.mkdirSync(runtimeStateDir, { recursive: true });

    const bridgeState = {
      pid: process.pid,
      statePath: path.join(tmpDir, ".tap-comms", "pids", "bridge-codex.json"),
      lastHeartbeat: "2026-04-01T00:00:00.000Z",
      runtimeStateDir,
    };
    const state = {
      schemaVersion: 3,
      createdAt: "2026-04-01T00:00:00.000Z",
      updatedAt: "2026-04-01T00:00:00.000Z",
      commsDir,
      repoRoot: tmpDir,
      packageVersion: version,
      instances: {
        codex: {
          instanceId: "codex",
          runtime: "codex",
          agentName: "솔",
          port: 4501,
          installed: true,
          configPath: "",
          bridgeMode: "app-server",
          restartRequired: false,
          ownedArtifacts: [],
          backupPath: "",
          lastAppliedHash: "",
          lastVerifiedAt: "2026-04-01T00:00:00.000Z",
          bridge: bridgeState,
          headless: null,
          warnings: [],
        },
      },
    };

    fs.writeFileSync(
      path.join(tmpDir, ".tap-comms", "state.json"),
      JSON.stringify(state, null, 2),
      "utf-8",
    );
    fs.writeFileSync(
      bridgeState.statePath,
      JSON.stringify(bridgeState, null, 2),
      "utf-8",
    );
    fs.writeFileSync(
      path.join(runtimeStateDir, "heartbeat.json"),
      JSON.stringify(
        {
          updatedAt: new Date().toISOString(),
          connected: true,
          initialized: true,
          threadId: "thread_live",
          threadCwd: tmpDir,
          turnState: "idle",
          idleSince: new Date(Date.now() - 3 * 60 * 1000).toISOString(),
        },
        null,
        2,
      ),
      "utf-8",
    );
    fs.writeFileSync(
      path.join(commsDir, "heartbeats.json"),
      JSON.stringify(
        {
          codex: {
            id: "codex",
            agent: "솔",
            timestamp: new Date().toISOString(),
            lastActivity: new Date().toISOString(),
            status: "active",
          },
          reviewer_agent: {
            id: "reviewer_agent",
            agent: "결",
            timestamp: new Date().toISOString(),
            lastActivity: new Date().toISOString(),
            status: "active",
          },
        },
        null,
        2,
      ),
      "utf-8",
    );

    const snapshot = collectDashboardSnapshot(tmpDir, commsDir);
    const codex = snapshot.agents.find((agent) => agent.instanceId === "codex");
    const reviewer = snapshot.agents.find(
      (agent) => agent.name === "결 [reviewer_agent]",
    );

    expect(codex).toMatchObject({
      name: "솔 [codex]",
      presence: "bridge-live",
      lifecycle: "ready",
      status: "active",
    });
    expect(codex?.idleSeconds).not.toBeNull();
    expect(codex!.idleSeconds!).toBeGreaterThanOrEqual(120);
    expect(reviewer).toMatchObject({
      presence: "mcp-only",
      lifecycle: null,
      instanceId: null,
    });
  });
});
