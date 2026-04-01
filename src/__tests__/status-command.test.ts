import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { statusCommand } from "../commands/status.js";
import { version } from "../version.js";

let tmpDir: string;
let originalCwd: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tap-status-test-"));
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

describe("statusCommand", () => {
  it("reports the current package version instead of stale state metadata", async () => {
    const state = {
      schemaVersion: 2,
      createdAt: "2026-03-24T00:00:00.000Z",
      updatedAt: "2026-03-24T00:00:00.000Z",
      commsDir: path.join(tmpDir, "tap-comms"),
      repoRoot: tmpDir,
      packageVersion: "stale-version",
      instances: {},
    };

    fs.writeFileSync(
      path.join(tmpDir, ".tap-comms", "state.json"),
      JSON.stringify(state, null, 2),
      "utf-8",
    );

    vi.spyOn(console, "log").mockImplementation(() => {});

    const result = await statusCommand([]);

    expect(result.ok).toBe(true);
    expect(result.data).toHaveProperty("version", version);
  });

  it("surfaces app-server lifecycle for degraded saved-thread bridges", async () => {
    const runtimeStateDir = path.join(tmpDir, ".tap-comms", ".tmp", "codex");
    fs.mkdirSync(path.join(tmpDir, ".tap-comms", "pids"), { recursive: true });
    fs.mkdirSync(runtimeStateDir, { recursive: true });

    const bridgeState = {
      pid: process.pid,
      statePath: path.join(tmpDir, ".tap-comms", "pids", "bridge-codex.json"),
      lastHeartbeat: "2026-03-24T00:00:00.000Z",
      runtimeStateDir,
    };
    const state = {
      schemaVersion: 3,
      createdAt: "2026-03-24T00:00:00.000Z",
      updatedAt: "2026-03-24T00:00:00.000Z",
      commsDir: path.join(tmpDir, "tap-comms"),
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
          lastVerifiedAt: "2026-03-24T00:00:00.000Z",
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
          updatedAt: "2026-03-24T00:00:02.000Z",
          connected: false,
          initialized: true,
          threadId: null,
        },
        null,
        2,
      ),
      "utf-8",
    );
    fs.writeFileSync(
      path.join(runtimeStateDir, "thread.json"),
      JSON.stringify(
        {
          threadId: "thread_saved",
          cwd: tmpDir,
        },
        null,
        2,
      ),
      "utf-8",
    );

    vi.spyOn(console, "log").mockImplementation(() => {});

    const result = await statusCommand([]);

    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      instances: {
        codex: {
          status: "active",
          lifecycle: {
            presence: "bridge-live",
            status: "degraded-no-thread",
            savedThreadId: "thread_saved",
          },
          session: {
            status: "disconnected",
            turnState: "disconnected",
          },
        },
      },
    });
  });
});
