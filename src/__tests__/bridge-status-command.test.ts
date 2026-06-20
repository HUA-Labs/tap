import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const { bridgeCommand } = await import("../commands/bridge.js");

let tmpDir: string;
let originalCwd: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tap-bridge-status-test-"));
  fs.writeFileSync(path.join(tmpDir, "package.json"), "{}", "utf-8");
  fs.mkdirSync(path.join(tmpDir, ".tap-comms"), { recursive: true });

  originalCwd = process.cwd();
  process.chdir(tmpDir);
});

afterEach(() => {
  process.chdir(originalCwd);
  fs.rmSync(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("bridge status retained app-server health", () => {
  it("probes retained managed app-server liveness before reporting health", async () => {
    const retainedAppServer = {
      url: "ws://127.0.0.1:4501",
      pid: 99999999,
      managed: true,
      healthy: true,
      lastCheckedAt: "2026-03-24T00:00:00.000Z",
      lastHealthyAt: "2026-03-24T00:00:00.000Z",
      logPath: path.join(tmpDir, ".tap-comms", "logs", "app-server-codex.log"),
      manualCommand: "codex app-server --listen ws://127.0.0.1:4501",
      auth: null,
    };
    const state = {
      schemaVersion: 3,
      createdAt: "2026-03-24T00:00:00.000Z",
      updatedAt: "2026-03-24T00:00:00.000Z",
      commsDir: path.join(tmpDir, "tap-comms"),
      repoRoot: tmpDir,
      packageVersion: "0.5.2",
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
          lastVerifiedAt: "2026-03-24T00:00:00.000Z",
          bridge: null,
          managedAppServer: retainedAppServer,
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

    vi.spyOn(console, "log").mockImplementation(() => {});

    const result = await bridgeCommand(["status", "codex"]);

    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      status: "stopped",
      appServer: {
        url: retainedAppServer.url,
        healthy: false,
      },
    });
  });

  it("surfaces last notification and last error from the runtime heartbeat", async () => {
    const runtimeStateDir = path.join(
      tmpDir,
      ".tmp",
      "codex-app-server-bridge",
    );
    fs.mkdirSync(runtimeStateDir, { recursive: true });

    const state = {
      schemaVersion: 3,
      createdAt: "2026-03-24T00:00:00.000Z",
      updatedAt: "2026-03-24T00:00:00.000Z",
      commsDir: path.join(tmpDir, "tap-comms"),
      repoRoot: tmpDir,
      packageVersion: "0.5.2",
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
          lastVerifiedAt: "2026-03-24T00:00:00.000Z",
          bridge: {
            pid: process.pid,
            statePath: path.join(
              tmpDir,
              ".tap-comms",
              "pids",
              "bridge-codex.json",
            ),
            lastHeartbeat: "2026-03-24T00:00:00.000Z",
            runtimeStateDir,
            appServer: null,
          },
          managedAppServer: null,
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
      path.join(runtimeStateDir, "heartbeat.json"),
      JSON.stringify(
        {
          pid: process.pid,
          agent: "솔",
          updatedAt: new Date().toISOString(),
          pollSeconds: 5,
          appServerUrl: "ws://127.0.0.1:4501",
          authenticated: true,
          connected: true,
          initialized: true,
          threadId: "thread-1",
          activeTurnId: null,
          turnStartedAt: null,
          lastTurnStatus: "completed",
          lastNotificationMethod: "notifications/claude/channel",
          lastNotificationAt: "2026-04-09T04:00:00.000Z",
          lastError: "relay stalled",
          lastSuccessfulAppServerAt: "2026-04-09T04:00:00.000Z",
          lastSuccessfulAppServerMethod: "thread/read",
          consecutiveFailureCount: 0,
          busyMode: "wait",
        },
        null,
        2,
      ),
      "utf-8",
    );

    vi.spyOn(console, "log").mockImplementation(() => {});

    const result = await bridgeCommand(["status", "codex"]);

    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      status: "stopped",
      lastNotificationMethod: "notifications/claude/channel",
      lastNotificationAt: "2026-04-09T04:00:00.000Z",
      lastError: "relay stalled",
    });
  });
});
