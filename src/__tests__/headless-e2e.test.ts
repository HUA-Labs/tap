/**
 * Headless Codex bridge E2E scenarios — all using mocks.
 *
 * Coverage:
 * 1. .cmd unwrap → node direct execution (resolveCodexCommand pipeline)
 * 2. App-server auto spawn with unwrapped command on win32
 * 3. Bridge restart warmup env set/cleared (integration flow)
 * 4. Thread resume self-heal (loadResumableThreadState integration)
 * 5. Multi-instance port isolation (findNextAvailableAppServerPort)
 * 6. Bridge state isolation per instanceId (load/save/clear/isBridgeRunning)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// ── Scenario 1 & 2: .cmd unwrap + app-server spawn ───────────────────────────

const spawnMockE2E = vi.fn();
const spawnSyncMockE2E = vi.fn();
const execSyncMockE2E = vi.fn();
const probeCommandMockE2E = vi.fn();

vi.mock("node:child_process", async () => {
  const actual =
    await vi.importActual<typeof import("node:child_process")>(
      "node:child_process",
    );
  return {
    ...actual,
    spawn: spawnMockE2E,
    spawnSync: spawnSyncMockE2E,
    execSync: execSyncMockE2E,
  };
});

vi.mock("../adapters/common.js", () => ({
  probeCommand: probeCommandMockE2E,
}));

const { resolveCodexCommand, unwrapNpmCmdShim, splitResolvedCommand } =
  await import("../engine/bridge-codex-command.js");
const { ensureCodexAppServer } = await import("../engine/bridge.js");
const { loadBridgeState, saveBridgeState, clearBridgeState, isBridgeRunning } =
  await import("../engine/bridge-state.js");
const { findNextAvailableAppServerPort, isTcpPortAvailable } =
  await import("../engine/bridge-port-network.js");

// ── Shared temp dir management ────────────────────────────────────────────────

let tmpDir: string;

type SocketEvent = "open" | "error" | "close";
let socketEvents: SocketEvent[] = [];

const originalWebSocket = (
  globalThis as { WebSocket?: typeof globalThis.WebSocket }
).WebSocket;

class FakeWebSocket {
  private listeners: Partial<Record<SocketEvent, () => void>> = {};

  constructor(_url: string) {
    const nextEvent = socketEvents.shift() ?? "error";
    queueMicrotask(() => {
      this.listeners[nextEvent]?.();
    });
  }

  addEventListener(
    type: SocketEvent,
    listener: () => void,
    _options?: { once?: boolean },
  ): void {
    this.listeners[type] = listener;
  }

  close(): void {
    // no-op
  }
}

function createAuthGatewayScriptStub(repoRoot: string): void {
  const gatewayDir = path.join(
    repoRoot,
    "packages",
    "tap-comms",
    "src",
    "bridges",
  );
  fs.mkdirSync(gatewayDir, { recursive: true });
  fs.writeFileSync(
    path.join(gatewayDir, "codex-app-server-auth-gateway.ts"),
    "// stub for tests",
    "utf-8",
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tap-e2e-test-"));
  fs.mkdirSync(path.join(tmpDir, "logs"), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, "pids"), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, "secrets"), { recursive: true });
  socketEvents = [];
  execSyncMockE2E.mockImplementation((command: string) => {
    if (command.includes("--version")) {
      return "v24.14.0\n";
    }
    return "";
  });
  (globalThis as { WebSocket?: unknown }).WebSocket =
    FakeWebSocket as unknown as typeof globalThis.WebSocket;
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  (globalThis as { WebSocket?: typeof globalThis.WebSocket }).WebSocket =
    originalWebSocket;
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 1: .cmd unwrap → node direct execution
// ─────────────────────────────────────────────────────────────────────────────

describe("Scenario 1: .cmd unwrap → node direct execution", () => {
  it("resolveCodexCommand unwraps .cmd shim to node + script NUL-separated", () => {
    // Create a temp .cmd file in tmpDir that mimics an npm shim
    const scriptDir = path.join(
      tmpDir,
      "node_modules",
      "@openai",
      "codex",
      "bin",
    );
    fs.mkdirSync(scriptDir, { recursive: true });
    const scriptPath = path.join(scriptDir, "codex.js");
    fs.writeFileSync(scriptPath, "// codex stub", "utf-8");

    const cmdPath = path.join(tmpDir, "codex.cmd");
    const relScript = path.relative(tmpDir, scriptPath).replace(/\//g, "\\");
    fs.writeFileSync(
      cmdPath,
      [
        "@ECHO off",
        "GOTO start",
        ":find_dp0",
        "SET dp0=%~dp0",
        "EXIT /b",
        ":start",
        "SETLOCAL",
        "CALL :find_dp0",
        "",
        'IF EXIST "%dp0%\\node.exe" (',
        '  SET "_prog=%dp0%\\node.exe"',
        ") ELSE (",
        '  SET "_prog=node"',
        "  SET PATHEXT=%PATHEXT:;.JS;=;%",
        ")",
        "",
        `endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\${relScript}" %*`,
      ].join("\r\n"),
      "utf-8",
    );

    // probeCommand now returns absolute path (M161)
    probeCommandMockE2E.mockImplementation((candidates: string[]) => {
      if (candidates.includes("codex.cmd")) {
        return { command: cmdPath, version: "1.0.0" };
      }
      return { command: "node", version: "24.0.0" };
    });

    const resolved = resolveCodexCommand("win32");

    // Result should be NUL-separated: node\0scriptPath
    expect(resolved).not.toBeNull();
    expect(resolved).toContain("\0");
    expect(resolved).toContain("codex.js");
  });

  it("probeCommand returns absolute path via where.exe (tested through resolveCodexCommand)", () => {
    // probeCommand now resolves absolute paths internally.
    // When mock returns a bare candidate, resolveCodexCommand gets it as-is.
    // In production, probeCommand calls where.exe/which to get the absolute path.
    // This test verifies the unwrap pipeline works with absolute paths.
    const scriptDir = path.join(
      tmpDir,
      "node_modules",
      "@openai",
      "codex",
      "bin",
    );
    fs.mkdirSync(scriptDir, { recursive: true });
    const scriptPath = path.join(scriptDir, "codex.js");
    fs.writeFileSync(scriptPath, "// stub", "utf-8");

    const absoluteCmdPath = path.join(tmpDir, "codex.cmd");
    const relScript = path.relative(tmpDir, scriptPath).replace(/\//g, "\\");
    fs.writeFileSync(
      absoluteCmdPath,
      `endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\${relScript}" %*\r\n`,
      "utf-8",
    );

    // Mock probeCommand to return absolute path (as it now does in production)
    probeCommandMockE2E.mockImplementation((candidates: string[]) => {
      if (candidates.includes("codex.cmd")) {
        return { command: absoluteCmdPath, version: "1.0.0" };
      }
      return { command: "node", version: "24.0.0" };
    });

    const result = resolveCodexCommand("win32");
    expect(result).not.toBeNull();
    expect(result).toContain("\0");
    expect(result).toContain("codex.js");
  });

  it("splitResolvedCommand extracts command and prefixArgs from NUL-separated string", () => {
    const scriptPath = "C:\\Users\\test\\node_modules\\.bin\\codex.js";
    const nodeExe = "C:\\Program Files\\nodejs\\node.exe";
    const resolved = `${nodeExe}\0${scriptPath}`;

    const { command, prefixArgs } = splitResolvedCommand(resolved);

    expect(command).toBe(nodeExe);
    expect(prefixArgs).toEqual([scriptPath]);
  });

  it("unwrapNpmCmdShim produces NUL-separated node + script for standard npm shim", () => {
    const scriptDir = path.join(
      tmpDir,
      "node_modules",
      "@openai",
      "codex",
      "bin",
    );
    fs.mkdirSync(scriptDir, { recursive: true });
    const scriptPath = path.join(scriptDir, "codex.js");
    fs.writeFileSync(scriptPath, "// stub", "utf-8");

    const relScript = path.relative(tmpDir, scriptPath).replace(/\//g, "\\");
    const cmdPath = path.join(tmpDir, "codex.cmd");
    fs.writeFileSync(
      cmdPath,
      `endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\${relScript}" %*\r\n`,
      "utf-8",
    );

    // probeCommand is used internally to resolve node; return "node"
    probeCommandMockE2E.mockReturnValue({ command: "node", version: "24.0.0" });

    const result = unwrapNpmCmdShim(cmdPath);
    expect(result).not.toBeNull();
    expect(result).toContain("\0");
    expect(result!.split("\0")[1]).toBe(scriptPath);
  });

  it("full pipeline: resolveCodexCommand + splitResolvedCommand gives node command", () => {
    const scriptDir = path.join(
      tmpDir,
      "node_modules",
      "@openai",
      "codex",
      "bin",
    );
    fs.mkdirSync(scriptDir, { recursive: true });
    const scriptPath = path.join(scriptDir, "codex.js");
    fs.writeFileSync(scriptPath, "// stub", "utf-8");

    const relScript = path.relative(tmpDir, scriptPath).replace(/\//g, "\\");
    const cmdPath = path.join(tmpDir, "codex.cmd");
    fs.writeFileSync(
      cmdPath,
      `endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\${relScript}" %*\r\n`,
      "utf-8",
    );

    // probeCommand now returns absolute path (M161)
    probeCommandMockE2E.mockImplementation((candidates: string[]) => {
      if (candidates.includes("codex.cmd")) {
        return { command: cmdPath, version: "1.0.0" };
      }
      return { command: "node", version: "24.0.0" };
    });

    const resolved = resolveCodexCommand("win32");
    expect(resolved).not.toBeNull();

    const { command, prefixArgs } = splitResolvedCommand(resolved!);
    expect(command).toBe("node");
    expect(prefixArgs).toHaveLength(1);
    expect(prefixArgs[0]).toBe(scriptPath);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 2: App-server auto spawn with unwrapped command on win32
// ─────────────────────────────────────────────────────────────────────────────

describe("Scenario 2: App-server auto spawn uses node directly (not codex.cmd) on win32", () => {
  it("ensureCodexAppServer spawns via PowerShell on win32 when codex.cmd is detected", async () => {
    socketEvents = ["error", "open", "open"];
    createAuthGatewayScriptStub(tmpDir);

    // Capture wrapper content when spawnSync sees Start-Process
    let capturedWrapperContent: string | null = null;

    // Set up .cmd shim + script on disk so unwrapNpmCmdShim can parse it
    const scriptDir = path.join(
      tmpDir,
      "node_modules",
      "@openai",
      "codex",
      "bin",
    );
    fs.mkdirSync(scriptDir, { recursive: true });
    const scriptPath = path.join(scriptDir, "codex.js");
    fs.writeFileSync(scriptPath, "// stub", "utf-8");
    const cmdPath = path.join(tmpDir, "codex.cmd");
    const relScript = path.relative(tmpDir, scriptPath).replace(/\//g, "\\");
    fs.writeFileSync(
      cmdPath,
      `endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\${relScript}" %*\r\n`,
      "utf-8",
    );

    // probeCommand now returns absolute path (M161)
    probeCommandMockE2E.mockImplementation((candidates: string[]) => {
      if (candidates.includes("codex.cmd")) {
        return { command: cmdPath, version: "1.0.0" };
      }
      if (candidates.includes("node.exe") || candidates.includes("node")) {
        return { command: "node", version: "24.0.0" };
      }
      // For pwsh resolution
      return { command: "pwsh", version: "7.0.0" };
    });

    // spawnSync for PowerShell hidden spawn
    spawnSyncMockE2E.mockImplementation((command: string, args: string[]) => {
      // PowerShell hidden spawn → capture wrapper content + return PID
      if (
        command === "pwsh" &&
        args?.some((a: string) => a.includes("Start-Process"))
      ) {
        // Extract .ps1 wrapper path from the -File argument
        const cmdStr = args.find((a: string) =>
          a.includes("Start-Process"),
        ) as string;
        const ps1Match = cmdStr?.match(/tap-spawn-[a-f0-9]+\.ps1/);
        if (ps1Match) {
          const wrapperPath = path.join(os.tmpdir(), ps1Match[0]);
          try {
            capturedWrapperContent = fs.readFileSync(wrapperPath, "utf-8");
          } catch {
            /* wrapper may not exist in test env */
          }
        }
        return { status: 0, stdout: "9999\n", stderr: "" };
      }
      // PowerShell port probe
      if (
        command === "pwsh" &&
        args?.some((a) => a.includes("Get-NetTCPConnection"))
      ) {
        return { status: 0, stdout: "9999\n", stderr: "" };
      }
      return { status: 0, stdout: "", stderr: "" };
    });

    const appServer = await ensureCodexAppServer({
      instanceId: "codex",
      stateDir: tmpDir,
      repoRoot: tmpDir,
      platform: "win32",
      appServerUrl: "ws://127.0.0.1:4521",
    });

    // spawn (detached) should NOT be called on win32 — PowerShell handles it
    expect(spawnMockE2E).not.toHaveBeenCalled();

    // Hidden PowerShell spawn calls should contain a .ps1 wrapper (not codex.cmd direct)
    const hiddenSpawnCalls = (
      spawnSyncMockE2E.mock.calls as [
        string,
        string[],
        Record<string, unknown>,
      ][]
    ).filter(
      (call) =>
        call[0] === "pwsh" && call[1]?.some((a) => a.includes("Start-Process")),
    );
    expect(hiddenSpawnCalls.length).toBeGreaterThanOrEqual(1);

    // Critical M154 regression assertion: verify the wrapper .ps1 content
    // contains the unwrapped node + codex.js, NOT codex.cmd.
    // The wrapper is read from disk inside the spawnSync mock when Start-Process fires.
    expect(capturedWrapperContent).not.toBeNull();

    // $commandPath must contain codex.js (the unwrapped node script)
    expect(capturedWrapperContent).toContain("codex.js");
    // $commandPath must NOT be codex.cmd — that means unwrap failed
    expect(capturedWrapperContent).not.toMatch(
      /\$commandPath\s*=\s*'[^']*codex\.cmd'/,
    );
    // $commandArgs must include app-server
    expect(capturedWrapperContent).toContain("app-server");

    // probeCommand should have been called with codex.cmd candidates
    // and returned absolute path (no separate where.exe call needed with M161)
    expect(probeCommandMockE2E).toHaveBeenCalled();
    expect(appServer.managed).toBe(true);
  });

  it("ensureCodexAppServer spawns codex directly on linux (no unwrap needed)", async () => {
    socketEvents = ["error", "open", "open"];
    createAuthGatewayScriptStub(tmpDir);

    probeCommandMockE2E.mockReturnValue({ command: "codex", version: "1.0.0" });

    const unref = vi.fn();
    spawnMockE2E
      .mockReturnValueOnce({ pid: 5001, unref })
      .mockReturnValueOnce({ pid: 6001, unref });

    const appServer = await ensureCodexAppServer({
      instanceId: "codex",
      stateDir: tmpDir,
      repoRoot: tmpDir,
      platform: "linux",
      appServerUrl: "ws://127.0.0.1:4522",
    });

    // On linux, spawn is called directly (no PowerShell)
    expect(spawnMockE2E).toHaveBeenCalledTimes(2);

    // The app-server spawn (2nd call) should use "codex" directly, not cmd
    const appServerSpawnCall = spawnMockE2E.mock.calls[1];
    expect(appServerSpawnCall[0]).toBe("codex");
    expect(appServerSpawnCall[1]).toEqual([
      "app-server",
      "--listen",
      expect.stringMatching(/^ws:\/\/127\.0\.0\.1:\d+$/),
    ]);

    expect(appServer.managed).toBe(true);
    expect(appServer.pid).toBe(6001);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 3: Bridge restart preserves warmup env (integration)
// ─────────────────────────────────────────────────────────────────────────────

// Scenario 3: Bridge restart warmup env scoping
//
// Covered by bridge-restart-command.test.ts which tests the actual bridgeCommand()
// production code path with proper vi.mock wiring. That test verifies:
// - TAP_COLD_START_WARMUP is "true" inside restartBridge() call
// - env is restored after success
// - env is restored after failure
//
// No duplicate tests here — see bridge-restart-command.test.ts.

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 4: Thread resume self-heal (loadResumableThreadState integration)
// ─────────────────────────────────────────────────────────────────────────────

describe("Scenario 4: Thread resume self-heal via loadResumableThreadState", () => {
  it("integration: stale saved thread is replaced by newer heartbeat thread from same app-server", async () => {
    const { loadResumableThreadState } =
      await import("../../scripts/codex-app-server-bridge.ts");

    const repoRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "headless-e2e-thread-"),
    );
    const stateDir = path.join(repoRoot, ".tmp", "codex-app-server-bridge");
    fs.mkdirSync(stateDir, { recursive: true });

    try {
      // Saved thread is older
      fs.writeFileSync(
        path.join(stateDir, "thread.json"),
        JSON.stringify({
          threadId: "thread-stale",
          updatedAt: "2026-03-27T10:00:00.000Z",
          appServerUrl: "ws://127.0.0.1:4501",
          ephemeral: false,
          cwd: repoRoot,
        }),
        "utf8",
      );

      // Heartbeat has newer thread from same app-server
      fs.writeFileSync(
        path.join(stateDir, "heartbeat.json"),
        JSON.stringify({
          threadId: "thread-fresh",
          updatedAt: "2026-03-27T12:00:00.000Z",
          appServerUrl: "ws://127.0.0.1:4501",
          threadCwd: repoRoot,
          connected: true,
          initialized: true,
        }),
        "utf8",
      );

      const resolved = loadResumableThreadState(
        stateDir,
        "ws://127.0.0.1:4501",
      );

      // Self-heal: returns the heartbeat's newer thread
      expect(resolved).not.toBeNull();
      expect(resolved!.threadId).toBe("thread-fresh");
      expect(resolved!.appServerUrl).toBe("ws://127.0.0.1:4501");
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("integration: heartbeat from different app-server → keeps saved thread", async () => {
    const { loadResumableThreadState } =
      await import("../../scripts/codex-app-server-bridge.ts");

    const repoRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "headless-e2e-thread-"),
    );
    const stateDir = path.join(repoRoot, ".tmp", "codex-app-server-bridge");
    fs.mkdirSync(stateDir, { recursive: true });

    try {
      fs.writeFileSync(
        path.join(stateDir, "thread.json"),
        JSON.stringify({
          threadId: "thread-mine",
          updatedAt: "2026-03-27T10:00:00.000Z",
          appServerUrl: "ws://127.0.0.1:4501",
          ephemeral: false,
          cwd: repoRoot,
        }),
        "utf8",
      );

      // Heartbeat from a different app-server
      fs.writeFileSync(
        path.join(stateDir, "heartbeat.json"),
        JSON.stringify({
          threadId: "thread-other",
          updatedAt: "2026-03-27T12:00:00.000Z",
          appServerUrl: "ws://127.0.0.1:4510", // different port
          threadCwd: repoRoot,
          connected: true,
          initialized: true,
        }),
        "utf8",
      );

      const resolved = loadResumableThreadState(
        stateDir,
        "ws://127.0.0.1:4501",
      );

      expect(resolved).not.toBeNull();
      expect(resolved!.threadId).toBe("thread-mine");
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("integration: equal timestamps → keeps saved thread (no unnecessary churn)", async () => {
    const { loadResumableThreadState } =
      await import("../../scripts/codex-app-server-bridge.ts");

    const repoRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "headless-e2e-thread-"),
    );
    const stateDir = path.join(repoRoot, ".tmp", "codex-app-server-bridge");
    fs.mkdirSync(stateDir, { recursive: true });

    try {
      const timestamp = "2026-03-27T10:00:00.000Z";

      fs.writeFileSync(
        path.join(stateDir, "thread.json"),
        JSON.stringify({
          threadId: "thread-current",
          updatedAt: timestamp,
          appServerUrl: "ws://127.0.0.1:4501",
          ephemeral: false,
          cwd: repoRoot,
        }),
        "utf8",
      );

      fs.writeFileSync(
        path.join(stateDir, "heartbeat.json"),
        JSON.stringify({
          threadId: "thread-same-time",
          updatedAt: timestamp,
          appServerUrl: "ws://127.0.0.1:4501",
          threadCwd: repoRoot,
          connected: true,
          initialized: true,
        }),
        "utf8",
      );

      const resolved = loadResumableThreadState(
        stateDir,
        "ws://127.0.0.1:4501",
      );

      expect(resolved).not.toBeNull();
      expect(resolved!.threadId).toBe("thread-current");
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 5: Multi-instance port isolation (findNextAvailableAppServerPort)
// ─────────────────────────────────────────────────────────────────────────────

describe("Scenario 5: Multi-instance port isolation", () => {
  it("findNextAvailableAppServerPort skips ports already in use by other instances", async () => {
    // Mock isTcpPortAvailable at the network layer by occupying a real port
    // This is an integration-style test using actual TCP binding.
    // We bind port 4501 and verify the function skips it and returns 4502.

    const net = await import("node:net");
    const server = net.createServer();
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => resolve());
    });

    const addr = server.address();
    if (!addr || typeof addr === "string") {
      server.close();
      return;
    }

    const occupiedPort = addr.port;

    try {
      const state = {
        schemaVersion: 2 as const,
        createdAt: "",
        updatedAt: "",
        commsDir: "",
        repoRoot: "",
        packageVersion: "0.2.0",
        instances: {
          codex: {
            instanceId: "codex" as const,
            runtime: "codex" as const,
            agentName: null,
            port: null,
            installed: true,
            configPath: "",
            bridgeMode: "app-server" as const,
            restartRequired: false,
            ownedArtifacts: [],
            backupPath: "",
            lastAppliedHash: "",
            lastVerifiedAt: null,
            bridge: null,
            headless: null,
            warnings: [],
          },
          "codex-reviewer": {
            instanceId: "codex-reviewer" as const,
            runtime: "codex" as const,
            agentName: null,
            port: occupiedPort, // claims this port
            installed: true,
            configPath: "",
            bridgeMode: "app-server" as const,
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

      // codex wants a port, but codex-reviewer already claimed occupiedPort
      // AND it's actually in use by our server
      const nextPort = await findNextAvailableAppServerPort(
        state,
        `ws://127.0.0.1:${occupiedPort}`,
        occupiedPort,
        "codex",
      );

      // Should skip occupiedPort (claimed by codex-reviewer) and find the next
      expect(nextPort).toBeGreaterThan(occupiedPort);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it("isTcpPortAvailable returns false for an occupied port", async () => {
    const net = await import("node:net");
    const server = net.createServer();
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => resolve());
    });

    const addr = server.address();
    if (!addr || typeof addr === "string") {
      server.close();
      return;
    }

    const port = addr.port;

    try {
      const available = await isTcpPortAvailable("127.0.0.1", port);
      expect(available).toBe(false);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it("isTcpPortAvailable returns true for a free port", async () => {
    // Allocate and immediately release a port, then check
    const net = await import("node:net");
    const server = net.createServer();
    const port = await new Promise<number>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        if (!addr || typeof addr === "string") {
          reject(new Error("no address"));
          return;
        }
        resolve(addr.port);
      });
    });

    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });

    const available = await isTcpPortAvailable("127.0.0.1", port);
    expect(available).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 6: Bridge state isolation per instanceId
// ─────────────────────────────────────────────────────────────────────────────

describe("Scenario 6: Bridge state isolation per instanceId", () => {
  it("save + load roundtrip preserves state for each instance independently", () => {
    fs.mkdirSync(path.join(tmpDir, "pids"), { recursive: true });

    const codexState = {
      pid: 11111,
      statePath: path.join(tmpDir, "pids", "bridge-codex.json"),
      lastHeartbeat: "2026-03-28T00:00:00.000Z",
      appServer: null,
    };
    const reviewerState = {
      pid: 22222,
      statePath: path.join(tmpDir, "pids", "bridge-codex-reviewer.json"),
      lastHeartbeat: "2026-03-28T01:00:00.000Z",
      appServer: null,
    };

    saveBridgeState(tmpDir, "codex", codexState);
    saveBridgeState(tmpDir, "codex-reviewer", reviewerState);

    const loadedCodex = loadBridgeState(tmpDir, "codex");
    const loadedReviewer = loadBridgeState(tmpDir, "codex-reviewer");

    expect(loadedCodex).not.toBeNull();
    expect(loadedCodex!.pid).toBe(11111);
    expect(loadedReviewer).not.toBeNull();
    expect(loadedReviewer!.pid).toBe(22222);
  });

  it("clearBridgeState for codex does not affect codex-reviewer state", () => {
    fs.mkdirSync(path.join(tmpDir, "pids"), { recursive: true });

    saveBridgeState(tmpDir, "codex", {
      pid: 11111,
      statePath: path.join(tmpDir, "pids", "bridge-codex.json"),
      lastHeartbeat: "2026-03-28T00:00:00.000Z",
      appServer: null,
    });
    saveBridgeState(tmpDir, "codex-reviewer", {
      pid: 22222,
      statePath: path.join(tmpDir, "pids", "bridge-codex-reviewer.json"),
      lastHeartbeat: "2026-03-28T01:00:00.000Z",
      appServer: null,
    });

    clearBridgeState(tmpDir, "codex");

    expect(loadBridgeState(tmpDir, "codex")).toBeNull();
    const reviewer = loadBridgeState(tmpDir, "codex-reviewer");
    expect(reviewer).not.toBeNull();
    expect(reviewer!.pid).toBe(22222);
  });

  it("isBridgeRunning returns false after clearBridgeState", () => {
    fs.mkdirSync(path.join(tmpDir, "pids"), { recursive: true });

    saveBridgeState(tmpDir, "codex", {
      pid: process.pid, // a real live PID so isProcessAlive returns true initially
      statePath: path.join(tmpDir, "pids", "bridge-codex.json"),
      lastHeartbeat: "2026-03-28T00:00:00.000Z",
      appServer: null,
    });

    // Before clear: state exists (process is alive)
    expect(isBridgeRunning(tmpDir, "codex")).toBe(true);

    clearBridgeState(tmpDir, "codex");

    // After clear: returns false (no state file)
    expect(isBridgeRunning(tmpDir, "codex")).toBe(false);
  });

  it("isBridgeRunning returns false for unknown instanceId", () => {
    fs.mkdirSync(path.join(tmpDir, "pids"), { recursive: true });
    expect(isBridgeRunning(tmpDir, "nonexistent")).toBe(false);
  });

  it("saveBridgeState strips auth token before persisting", () => {
    fs.mkdirSync(path.join(tmpDir, "pids"), { recursive: true });

    const stateWithToken = {
      pid: 33333,
      statePath: path.join(tmpDir, "pids", "bridge-codex.json"),
      lastHeartbeat: "2026-03-28T00:00:00.000Z",
      appServer: {
        url: "ws://127.0.0.1:4501",
        pid: 44444,
        managed: true,
        healthy: true,
        lastCheckedAt: "2026-03-28T00:00:00.000Z",
        lastHealthyAt: "2026-03-28T00:00:00.000Z",
        logPath: path.join(tmpDir, "logs", "app-server-codex.log"),
        manualCommand: "codex app-server --listen ws://127.0.0.1:4501",
        auth: {
          mode: "subprotocol" as const,
          protectedUrl: "ws://127.0.0.1:4501",
          upstreamUrl: "ws://127.0.0.1:55001",
          tokenPath: path.join(tmpDir, "secrets", "token.txt"),
          token: "super-secret-token", // should be stripped
          gatewayPid: 55555,
          gatewayLogPath: path.join(tmpDir, "logs", "gateway.log"),
        },
      },
    };

    saveBridgeState(tmpDir, "codex", stateWithToken);

    const raw = fs.readFileSync(
      path.join(tmpDir, "pids", "bridge-codex.json"),
      "utf-8",
    );
    const parsed = JSON.parse(raw);

    // Token must not be persisted
    expect(parsed.appServer?.auth?.token).toBeUndefined();
    expect(parsed.appServer?.auth?.protectedUrl).toBe("ws://127.0.0.1:4501");
    expect(parsed.pid).toBe(33333);
  });
});
