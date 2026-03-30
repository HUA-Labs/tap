import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as net from "node:net";
import * as path from "node:path";
import * as os from "node:os";
import {
  loadBridgeState,
  saveBridgeState,
  clearBridgeState,
  isProcessAlive,
  isBridgeRunning,
  getBridgeStatus,
  startBridge,
  getBridgeRuntimeStateDir,
  findNextAvailableAppServerPort,
} from "../engine/bridge.js";
import type { BridgeState, TapState } from "../types.js";

let tmpDir: string;
let stateDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tap-bridge-test-"));
  stateDir = tmpDir;
  fs.mkdirSync(path.join(stateDir, "pids"), { recursive: true });
  fs.mkdirSync(path.join(stateDir, "logs"), { recursive: true });
});

afterEach(async () => {
  // Windows: spawned processes may hold log file handles briefly
  await new Promise((r) => setTimeout(r, 200));
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // Best-effort cleanup — Windows file locks may persist
  }
});

describe("PID file management", () => {
  it("saveBridgeState writes and loadBridgeState reads back", () => {
    const state: BridgeState = {
      pid: 12345,
      statePath: path.join(stateDir, "pids", "bridge-codex.json"),
      lastHeartbeat: "2026-03-23T00:00:00.000Z",
    };

    saveBridgeState(stateDir, "codex", state);
    const loaded = loadBridgeState(stateDir, "codex");

    expect(loaded).not.toBeNull();
    expect(loaded!.pid).toBe(12345);
    expect(loaded!.lastHeartbeat).toBe("2026-03-23T00:00:00.000Z");
  });

  it("works with named instance IDs", () => {
    const state: BridgeState = {
      pid: 12345,
      statePath: path.join(stateDir, "pids", "bridge-codex-reviewer.json"),
      lastHeartbeat: "2026-03-24T00:00:00.000Z",
    };

    saveBridgeState(stateDir, "codex-reviewer", state);
    const loaded = loadBridgeState(stateDir, "codex-reviewer");

    expect(loaded).not.toBeNull();
    expect(loaded!.pid).toBe(12345);

    // Default instance should still be separate
    expect(loadBridgeState(stateDir, "codex")).toBeNull();
  });

  it("loadBridgeState returns null when no PID file", () => {
    const loaded = loadBridgeState(stateDir, "gemini");
    expect(loaded).toBeNull();
  });

  it("clearBridgeState removes PID file", () => {
    const state: BridgeState = {
      pid: 99999,
      statePath: path.join(stateDir, "pids", "bridge-codex.json"),
      lastHeartbeat: new Date().toISOString(),
    };

    saveBridgeState(stateDir, "codex", state);
    expect(loadBridgeState(stateDir, "codex")).not.toBeNull();

    clearBridgeState(stateDir, "codex");
    expect(loadBridgeState(stateDir, "codex")).toBeNull();
  });

  it("clearBridgeState is safe when file does not exist", () => {
    expect(() => clearBridgeState(stateDir, "codex")).not.toThrow();
  });

  it("loadBridgeState returns null for corrupted JSON", () => {
    const pidPath = path.join(stateDir, "pids", "bridge-codex.json");
    fs.writeFileSync(pidPath, "not valid json{{{", "utf-8");
    const loaded = loadBridgeState(stateDir, "codex");
    expect(loaded).toBeNull();
  });
});

describe("isProcessAlive", () => {
  it("returns true for current process", () => {
    expect(isProcessAlive(process.pid)).toBe(true);
  });

  it("returns false for non-existent PID", () => {
    // PID 999999 is very unlikely to exist
    expect(isProcessAlive(999999)).toBe(false);
  });
});

describe("isBridgeRunning", () => {
  it("returns false when no PID file", () => {
    expect(isBridgeRunning(stateDir, "codex")).toBe(false);
  });

  it("returns true when PID file exists and process is alive", () => {
    const state: BridgeState = {
      pid: process.pid, // current process — definitely alive
      statePath: path.join(stateDir, "pids", "bridge-codex.json"),
      lastHeartbeat: new Date().toISOString(),
    };
    saveBridgeState(stateDir, "codex", state);
    expect(isBridgeRunning(stateDir, "codex")).toBe(true);
  });

  it("returns false when PID file exists but process is dead", () => {
    const state: BridgeState = {
      pid: 999999,
      statePath: path.join(stateDir, "pids", "bridge-codex.json"),
      lastHeartbeat: new Date().toISOString(),
    };
    saveBridgeState(stateDir, "codex", state);
    expect(isBridgeRunning(stateDir, "codex")).toBe(false);
  });
});

describe("getBridgeStatus", () => {
  it("returns 'stopped' when no PID file", () => {
    expect(getBridgeStatus(stateDir, "codex")).toBe("stopped");
  });

  it("returns 'running' when process is alive", () => {
    const state: BridgeState = {
      pid: process.pid,
      statePath: path.join(stateDir, "pids", "bridge-codex.json"),
      lastHeartbeat: new Date().toISOString(),
    };
    saveBridgeState(stateDir, "codex", state);
    expect(getBridgeStatus(stateDir, "codex")).toBe("running");
  });

  it("returns 'stale' and cleans up when process is dead", () => {
    const state: BridgeState = {
      pid: 999999,
      statePath: path.join(stateDir, "pids", "bridge-codex.json"),
      lastHeartbeat: new Date().toISOString(),
    };
    saveBridgeState(stateDir, "codex", state);

    expect(getBridgeStatus(stateDir, "codex")).toBe("stale");
    // Should have cleaned up the stale PID file
    expect(loadBridgeState(stateDir, "codex")).toBeNull();
  });
});

describe("multiple instances coexist", () => {
  it("two instances have independent PID files", () => {
    const state1: BridgeState = {
      pid: process.pid,
      statePath: path.join(stateDir, "pids", "bridge-codex.json"),
      lastHeartbeat: new Date().toISOString(),
    };
    const state2: BridgeState = {
      pid: 999999,
      statePath: path.join(stateDir, "pids", "bridge-codex-reviewer.json"),
      lastHeartbeat: new Date().toISOString(),
    };

    saveBridgeState(stateDir, "codex", state1);
    saveBridgeState(stateDir, "codex-reviewer", state2);

    expect(isBridgeRunning(stateDir, "codex")).toBe(true);
    expect(isBridgeRunning(stateDir, "codex-reviewer")).toBe(false);

    // Clearing one doesn't affect the other
    clearBridgeState(stateDir, "codex-reviewer");
    expect(loadBridgeState(stateDir, "codex")).not.toBeNull();
    expect(loadBridgeState(stateDir, "codex-reviewer")).toBeNull();
  });
});

describe("runtime state dir", () => {
  it("derives an instance-specific daemon state dir", () => {
    expect(getBridgeRuntimeStateDir("D:/repo", "codex-reviewer")).toBe(
      path.join("D:/repo", ".tmp", "codex-app-server-bridge-codex-reviewer"),
    );
  });
});

describe("findNextAvailableAppServerPort", () => {
  it("skips ports already occupied on loopback", async () => {
    const server = net.createServer();
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => resolve());
    });

    try {
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Failed to allocate an occupied test port");
      }

      const occupiedPort = address.port;
      const state: TapState = {
        schemaVersion: 2,
        createdAt: "",
        updatedAt: "",
        commsDir: "",
        repoRoot: "",
        packageVersion: "0.2.0",
        instances: {
          codex: {
            instanceId: "codex",
            runtime: "codex",
            agentName: null,
            port: null,
            installed: true,
            configPath: "",
            bridgeMode: "app-server",
            restartRequired: false,
            ownedArtifacts: [],
            backupPath: "",
            lastAppliedHash: "",
            lastVerifiedAt: null,
            bridge: null,
            headless: null,
            warnings: [],
          },
        },
      };

      const nextPort = await findNextAvailableAppServerPort(
        state,
        `ws://127.0.0.1:${occupiedPort}`,
        occupiedPort,
        "codex",
      );

      expect(nextPort).toBe(occupiedPort + 1);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });
});

describe("startBridge agent name requirement", () => {
  it("throws when no agent name is available", async () => {
    // Clear env vars
    const origAgent = process.env.TAP_AGENT_NAME;
    const origCodex = process.env.CODEX_TAP_AGENT_NAME;
    delete process.env.TAP_AGENT_NAME;
    delete process.env.CODEX_TAP_AGENT_NAME;

    await expect(
      startBridge({
        instanceId: "codex",
        runtime: "codex",
        stateDir,
        commsDir: tmpDir,
        bridgeScript: "/nonexistent/bridge.js",
        platform: "win32",
      }),
    ).rejects.toThrow("No agent name");

    // Restore
    if (origAgent) process.env.TAP_AGENT_NAME = origAgent;
    if (origCodex) process.env.CODEX_TAP_AGENT_NAME = origCodex;
  });

  it("fails when Windows detached bridge spawn exits during the liveness gate", async () => {
    // Clear env vars to prove agentName option is used
    const origAgent = process.env.TAP_AGENT_NAME;
    const origCodex = process.env.CODEX_TAP_AGENT_NAME;
    delete process.env.TAP_AGENT_NAME;
    delete process.env.CODEX_TAP_AGENT_NAME;

    await expect(
      startBridge({
        instanceId: "codex",
        runtime: "codex",
        stateDir,
        commsDir: tmpDir,
        bridgeScript: "/nonexistent/bridge.js",
        platform: "win32",
        agentName: "testAgent",
        repoRoot: tmpDir,
      }),
    ).rejects.toThrow(/exited immediately after Windows detached spawn/i);
    expect(loadBridgeState(stateDir, "codex")).toBeNull();

    // Restore
    if (origAgent) process.env.TAP_AGENT_NAME = origAgent;
    if (origCodex) process.env.CODEX_TAP_AGENT_NAME = origCodex;
  });

  it("does not forward cold-start warmup unless the caller opted in", async () => {
    const outputPath = path.join(tmpDir, "warmup-env.txt");
    const bridgeScript = path.join(tmpDir, "record-warmup-env.js");
    const platform =
      process.platform === "win32"
        ? "win32"
        : process.platform === "darwin"
          ? "darwin"
          : "linux";
    const originalWarmup = process.env.TAP_COLD_START_WARMUP;
    delete process.env.TAP_COLD_START_WARMUP;

    fs.writeFileSync(
      bridgeScript,
      [
        "const fs = require('node:fs');",
        `fs.writeFileSync(${JSON.stringify(outputPath)}, process.env.TAP_COLD_START_WARMUP ?? '', 'utf8');`,
        "setInterval(() => {}, 1000);",
      ].join("\n"),
      "utf-8",
    );

    let pid: number | null = null;

    try {
      const result = await startBridge({
        instanceId: "codex",
        runtime: "codex",
        stateDir,
        commsDir: tmpDir,
        bridgeScript,
        platform,
        agentName: "testAgent",
        repoRoot: tmpDir,
      });
      pid = result.pid;

      for (let attempt = 0; attempt < 20; attempt += 1) {
        if (fs.existsSync(outputPath)) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      expect(fs.existsSync(outputPath)).toBe(true);
      expect(fs.readFileSync(outputPath, "utf-8")).toBe("");
    } finally {
      if (pid != null) {
        try {
          process.kill(pid);
        } catch {
          /* already exited */
        }
      }
      clearBridgeState(stateDir, "codex");
      if (originalWarmup === undefined) {
        delete process.env.TAP_COLD_START_WARMUP;
      } else {
        process.env.TAP_COLD_START_WARMUP = originalWarmup;
      }
    }
  });
});
