import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
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
  transitionBridgeLifecycle,
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
      path.resolve("D:/repo", ".tmp", "codex-app-server-bridge-codex-reviewer"),
    );
  });
});

describe("persisted bridge lifecycle", () => {
  it("increments restart count without resetting since for the same state", () => {
    const first = transitionBridgeLifecycle(
      null,
      "initializing",
      "bridge start",
      {
        at: "2026-04-01T00:00:00.000Z",
      },
    );
    const sameState = transitionBridgeLifecycle(
      first,
      "initializing",
      "runtime heartbeat",
      {
        at: "2026-04-01T00:01:00.000Z",
      },
    );
    const restarted = transitionBridgeLifecycle(
      sameState,
      "initializing",
      "bridge restart",
      {
        at: "2026-04-01T00:02:00.000Z",
        incrementRestart: true,
      },
    );

    expect(sameState.since).toBe("2026-04-01T00:00:00.000Z");
    expect(sameState.lastTransitionAt).toBe("2026-04-01T00:00:00.000Z");
    expect(restarted.restartCount).toBe(1);
    expect(restarted.since).toBe("2026-04-01T00:00:00.000Z");
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

  it("accepts explicit agentName option without throwing", async () => {
    // Clear env vars to prove agentName option is used
    const origAgent = process.env.TAP_AGENT_NAME;
    const origCodex = process.env.CODEX_TAP_AGENT_NAME;
    delete process.env.TAP_AGENT_NAME;
    delete process.env.CODEX_TAP_AGENT_NAME;

    const platform =
      process.platform === "win32"
        ? "win32"
        : process.platform === "darwin"
          ? "darwin"
          : "linux";

    // With agentName provided, should NOT throw "No agent name"
    // (spawn may succeed even with nonexistent script — node process starts then fails)
    const result = await startBridge({
      instanceId: "codex",
      runtime: "codex",
      stateDir,
      commsDir: tmpDir,
      bridgeScript: "/nonexistent/bridge.js",
      platform,
      agentName: "testAgent",
      repoRoot: tmpDir,
    });

    expect(result.pid).toBeGreaterThan(0);
    expect(result.runtimeStateDir).toBe(
      path.join(tmpDir, ".tmp", "codex-app-server-bridge-codex"),
    );

    // Clean up spawned process
    try {
      process.kill(result.pid);
    } catch {
      /* already exited */
    }
    clearBridgeState(stateDir, "codex");

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

  it("exports TAP_RUNTIME_STATE_DIR alongside the daemon runtime dir", async () => {
    const outputPath = path.join(tmpDir, "runtime-state-env.json");
    const bridgeScript = path.join(tmpDir, "record-runtime-state-env.js");
    const platform =
      process.platform === "win32"
        ? "win32"
        : process.platform === "darwin"
          ? "darwin"
          : "linux";

    fs.writeFileSync(
      bridgeScript,
      [
        "const fs = require('node:fs');",
        `fs.writeFileSync(${JSON.stringify(outputPath)}, JSON.stringify({`,
        "  stateDir: process.env.TAP_STATE_DIR ?? null,",
        "  runtimeStateDir: process.env.TAP_RUNTIME_STATE_DIR ?? null,",
        "}));",
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
      expect(
        JSON.parse(fs.readFileSync(outputPath, "utf-8")) as {
          stateDir: string | null;
          runtimeStateDir: string | null;
        },
      ).toEqual({
        stateDir,
        runtimeStateDir: path.join(
          tmpDir,
          ".tmp",
          "codex-app-server-bridge-codex",
        ),
      });
    } finally {
      if (pid != null) {
        try {
          process.kill(pid);
        } catch {
          /* already exited */
        }
      }
      clearBridgeState(stateDir, "codex");
    }
  });

  it("cleans stale same-instance heartbeats before spawning", async () => {
    const heartbeatsPath = path.join(tmpDir, "heartbeats.json");
    fs.writeFileSync(
      heartbeatsPath,
      JSON.stringify(
        {
          codex_worker: {
            id: "codex_worker",
            agent: "솔",
            timestamp: "2026-04-01T00:00:00.000Z",
            lastActivity: "2026-04-01T00:00:00.000Z",
            status: "active",
            source: "mcp-direct",
            instanceId: "codex-worker",
            connectHash: "instance:codex-worker",
          },
          stale_bridge: {
            id: "stale_bridge",
            agent: "솔",
            timestamp: "2026-04-01T00:00:00.000Z",
            lastActivity: "2026-04-01T00:00:00.000Z",
            status: "active",
            source: "bridge-dispatch",
            instanceId: "codex-worker",
            bridgePid: 999999,
            connectHash: "instance:codex-worker",
          },
          other_agent: {
            id: "other_agent",
            agent: "결",
            timestamp: new Date().toISOString(),
            lastActivity: new Date().toISOString(),
            status: "active",
            source: "mcp-direct",
            connectHash: "session:other_agent",
          },
        },
        null,
        2,
      ),
      "utf-8",
    );

    const bridgeScript = path.join(tmpDir, "hold-open.js");
    fs.writeFileSync(bridgeScript, "setInterval(() => {}, 1000);\n", "utf-8");

    const platform =
      process.platform === "win32"
        ? "win32"
        : process.platform === "darwin"
          ? "darwin"
          : "linux";

    let pid: number | null = null;
    try {
      const result = await startBridge({
        instanceId: "codex-worker",
        runtime: "codex",
        stateDir,
        commsDir: tmpDir,
        bridgeScript,
        platform,
        agentName: "솔",
        repoRoot: tmpDir,
      });
      pid = result.pid;

      const store = JSON.parse(
        fs.readFileSync(heartbeatsPath, "utf-8"),
      ) as Record<string, unknown>;
      expect(store.codex_worker).toBeUndefined();
      expect(store.stale_bridge).toBeUndefined();
      expect(store.other_agent).toBeDefined();
    } finally {
      if (pid != null) {
        try {
          process.kill(pid);
        } catch {
          /* already exited */
        }
      }
      clearBridgeState(stateDir, "codex-worker");
    }
  });

  it("warns when stale heartbeat cleanup is skipped because the store is locked", async () => {
    const heartbeatsPath = path.join(tmpDir, "heartbeats.json");
    const lockPath = path.join(tmpDir, ".heartbeats.lock");
    fs.writeFileSync(heartbeatsPath, "{}", "utf-8");
    fs.writeFileSync(lockPath, "someone-else", "utf-8");

    const bridgeScript = path.join(tmpDir, "hold-open.js");
    fs.writeFileSync(bridgeScript, "setInterval(() => {}, 1000);\n", "utf-8");

    const platform =
      process.platform === "win32"
        ? "win32"
        : process.platform === "darwin"
          ? "darwin"
          : "linux";

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    let pid: number | null = null;
    try {
      const result = await startBridge({
        instanceId: "codex-worker",
        runtime: "codex",
        stateDir,
        commsDir: tmpDir,
        bridgeScript,
        platform,
        agentName: "솔",
        repoRoot: tmpDir,
      });
      pid = result.pid;

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          "heartbeat cleanup skipped for codex-worker: heartbeat store busy",
        ),
      );
    } finally {
      warnSpy.mockRestore();
      if (pid != null) {
        try {
          process.kill(pid);
        } catch {
          /* already exited */
        }
      }
      clearBridgeState(stateDir, "codex-worker");
      try {
        fs.unlinkSync(lockPath);
      } catch {
        /* already removed */
      }
    }
  });

  it("forwards shared state separately from runtime state dir", async () => {
    const outputPath = path.join(tmpDir, "state-env.json");
    const bridgeScript = path.join(tmpDir, "record-state-env.js");
    const platform =
      process.platform === "win32"
        ? "win32"
        : process.platform === "darwin"
          ? "darwin"
          : "linux";

    fs.writeFileSync(
      bridgeScript,
      [
        "const fs = require('node:fs');",
        `fs.writeFileSync(${JSON.stringify(outputPath)}, JSON.stringify({ stateDir: process.env.TAP_STATE_DIR ?? null, runtimeStateDir: process.env.TAP_RUNTIME_STATE_DIR ?? null }), 'utf8');`,
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
      expect(JSON.parse(fs.readFileSync(outputPath, "utf-8"))).toEqual({
        stateDir,
        runtimeStateDir: path.join(
          tmpDir,
          ".tmp",
          "codex-app-server-bridge-codex",
        ),
      });
    } finally {
      if (pid != null) {
        try {
          process.kill(pid);
        } catch {
          /* already exited */
        }
      }
      clearBridgeState(stateDir, "codex");
    }
  });
});
