import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const spawnMock = vi.fn();
const spawnSyncMock = vi.fn();
const execSyncMock = vi.fn();
const probeCommandMock = vi.fn();

vi.mock("node:child_process", async () => {
  const actual =
    await vi.importActual<typeof import("node:child_process")>(
      "node:child_process",
    );
  return {
    ...actual,
    spawn: spawnMock,
    spawnSync: spawnSyncMock,
    execSync: execSyncMock,
  };
});

vi.mock("../adapters/common.js", () => ({
  probeCommand: probeCommandMock,
}));

const { ensureCodexAppServer, resolveAppServerUrl } =
  await import("../engine/bridge.js");

type SocketEvent = "open" | "error" | "close";

let tmpDir: string;
let socketEvents: SocketEvent[] = [];
let tempSpawnWrappersBefore: Set<string>;
const originalWebSocket = (
  globalThis as { WebSocket?: typeof globalThis.WebSocket }
).WebSocket;

function listTapSpawnWrappers(): string[] {
  return fs
    .readdirSync(os.tmpdir())
    .filter((entry) => /^tap-spawn-.*\.(cmd|ps1)$/i.test(entry))
    .map((entry) => path.join(os.tmpdir(), entry))
    .sort();
}

function newTapSpawnWrappers(): string[] {
  return listTapSpawnWrappers().filter(
    (wrapperPath) => !tempSpawnWrappersBefore.has(wrapperPath),
  );
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
    // No-op for tests.
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tap-app-server-test-"));
  fs.mkdirSync(path.join(tmpDir, "logs"), { recursive: true });
  createAuthGatewayScriptStub(tmpDir);
  socketEvents = [];
  tempSpawnWrappersBefore = new Set(listTapSpawnWrappers());
  execSyncMock.mockImplementation((command: string) => {
    if (command.includes("--version")) {
      return "v24.14.0\n";
    }
    return "";
  });
  (globalThis as { WebSocket?: unknown }).WebSocket =
    FakeWebSocket as unknown as typeof globalThis.WebSocket;
});

afterEach(() => {
  for (const wrapperPath of newTapSpawnWrappers()) {
    fs.rmSync(wrapperPath, { force: true });
  }
  fs.rmSync(tmpDir, { recursive: true, force: true });
  (globalThis as { WebSocket?: typeof globalThis.WebSocket }).WebSocket =
    originalWebSocket;
});

describe("resolveAppServerUrl", () => {
  it("overrides the configured port for instance-specific app servers", () => {
    expect(resolveAppServerUrl("ws://127.0.0.1:4501/", 4512)).toBe(
      "ws://127.0.0.1:4512",
    );
  });
});

describe("ensureCodexAppServer", () => {
  it("reuses an existing managed auth gateway stack from bridge state", async () => {
    fs.mkdirSync(path.join(tmpDir, "pids"), { recursive: true });
    const sharedAppServer = {
      url: "ws://127.0.0.1:4510",
      pid: process.pid,
      managed: true,
      healthy: true,
      lastCheckedAt: "2026-03-25T00:00:00.000Z",
      lastHealthyAt: "2026-03-25T00:00:00.000Z",
      logPath: path.join(tmpDir, "logs", "app-server-reviewer.log"),
      manualCommand: "codex app-server --listen ws://127.0.0.1:55210",
      auth: {
        mode: "subprotocol" as const,
        protectedUrl: "ws://127.0.0.1:4510",
        upstreamUrl: "ws://127.0.0.1:55210",
        tokenPath: path.join(tmpDir, "secrets", "gateway-reviewer.token"),
        gatewayPid: process.pid,
        gatewayLogPath: path.join(tmpDir, "logs", "gateway-reviewer.log"),
      },
    };
    fs.mkdirSync(path.join(tmpDir, "secrets"), { recursive: true });
    fs.writeFileSync(sharedAppServer.auth.tokenPath, "secret\n", {
      encoding: "utf8",
      mode: 0o600,
    });
    fs.writeFileSync(
      path.join(tmpDir, "pids", "bridge-codex-reviewer.json"),
      JSON.stringify({
        pid: 7001,
        statePath: path.join(tmpDir, "pids", "bridge-codex-reviewer.json"),
        lastHeartbeat: "2026-03-25T00:00:00.000Z",
        appServer: sharedAppServer,
      }),
      "utf8",
    );

    const appServer = await ensureCodexAppServer({
      instanceId: "codex",
      stateDir: tmpDir,
      repoRoot: tmpDir,
      platform: "win32",
      appServerUrl: "ws://127.0.0.1:4510",
    });

    expect(appServer.auth?.protectedUrl).toBe("ws://127.0.0.1:4510");
    expect(appServer.managed).toBe(true);
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("rejects an already-occupied public listener because auth gateway cannot be inserted", async () => {
    socketEvents = ["open"];
    await expect(
      ensureCodexAppServer({
        instanceId: "codex",
        stateDir: tmpDir,
        repoRoot: tmpDir,
        platform: "win32",
        appServerUrl: "ws://127.0.0.1:4510",
      }),
    ).rejects.toThrow(/cannot insert the auth gateway/i);
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("spawns auth gateway plus codex app-server when the public listener is free", async () => {
    socketEvents = ["error", "open", "open"];
    probeCommandMock.mockReturnValue({ command: "codex", version: "1.0.0" });
    const unref = vi.fn();
    spawnMock
      .mockReturnValueOnce({
        pid: 5301,
        unref,
      })
      .mockReturnValueOnce({
        pid: 4242,
        unref,
      });

    const appServer = await ensureCodexAppServer({
      instanceId: "codex",
      stateDir: tmpDir,
      repoRoot: tmpDir,
      platform: "linux",
      appServerUrl: "ws://127.0.0.1:4511",
    });

    expect(spawnMock).toHaveBeenNthCalledWith(
      1,
      process.execPath,
      expect.arrayContaining([
        "--experimental-strip-types",
        expect.stringContaining("codex-app-server-auth-gateway.ts"),
      ]),
      expect.objectContaining({
        cwd: tmpDir,
        detached: true,
        env: expect.objectContaining({
          TAP_GATEWAY_TOKEN_FILE: expect.stringContaining(
            path.join("secrets", "app-server-gateway-codex.token"),
          ),
        }),
        windowsHide: true,
      }),
    );
    expect(spawnMock).toHaveBeenNthCalledWith(
      2,
      "codex",
      [
        "app-server",
        "--listen",
        expect.stringMatching(/^ws:\/\/127\.0\.0\.1:\d+$/),
      ],
      expect.objectContaining({
        cwd: tmpDir,
        detached: true,
        windowsHide: true,
      }),
    );
    expect(unref).toHaveBeenCalled();
    expect(appServer.managed).toBe(true);
    expect(appServer.pid).toBe(4242);
    expect(appServer.healthy).toBe(true);
    expect(appServer.logPath).toBe(
      path.join(tmpDir, "logs", "app-server-codex.log"),
    );
    expect(fs.existsSync(appServer.logPath!)).toBe(true);
    expect(appServer.url).toBe("ws://127.0.0.1:4511");
    expect(appServer.auth?.protectedUrl).toBe("ws://127.0.0.1:4511");
    expect(appServer.auth?.upstreamUrl).toMatch(/^ws:\/\/127\.0\.0\.1:\d+$/);
    expect(appServer.auth?.tokenPath).toContain(
      path.join("secrets", "app-server-gateway-codex.token"),
    );
    expect(
      fs.readFileSync(appServer.auth!.tokenPath, "utf8").trim().length,
    ).toBeGreaterThan(0);
    expect(appServer.auth?.gatewayPid).toBe(5301);
  });

  it("returns null PID when PowerShell hidden spawn fails on Windows", async () => {
    socketEvents = ["error", "open"];
    probeCommandMock.mockImplementation((candidates: string[]) => {
      if (candidates.includes("codex.cmd")) {
        return { command: "codex.cmd", version: "1.0.0" };
      }
      return { command: "pwsh", version: "7.0.0" };
    });
    // Simulate PowerShell failure (e.g. not installed, execution policy)
    spawnSyncMock.mockReturnValue({
      status: 1,
      stdout: "",
      stderr: "PowerShell not available",
    });

    await expect(
      ensureCodexAppServer({
        instanceId: "codex",
        stateDir: tmpDir,
        repoRoot: tmpDir,
        platform: "win32",
        appServerUrl: "ws://127.0.0.1:4513",
      }),
    ).rejects.toThrow(/gateway/i);

    // Should have attempted spawnSync (PowerShell) but not regular spawn
    expect(spawnMock).not.toHaveBeenCalled();

    // Only the gateway hidden spawn should have been attempted — no app-server
    // spawn and no Get-NetTCPConnection port probe after the failure.
    const hiddenSpawnCalls = (
      spawnSyncMock.mock.calls as [string, string[], Record<string, unknown>][]
    ).filter((call) => call[1]?.some((a) => a.includes?.("Start-Process")));
    const portProbeCalls = (
      spawnSyncMock.mock.calls as [string, string[], Record<string, unknown>][]
    ).filter((call) =>
      call[1]?.some((a) => a.includes?.("Get-NetTCPConnection")),
    );
    expect(hiddenSpawnCalls).toHaveLength(1); // gateway only, no app-server
    expect(portProbeCalls).toHaveLength(0); // aborted before port probe
  });

  it("uses PowerShell hidden spawn on Windows for codex.cmd and records the listening PID", async () => {
    socketEvents = ["error", "open", "open"];
    const quotedRoot = fs.mkdtempSync(
      path.join(tmpDir, "repo %name%'s hidden spawn-"),
    );
    fs.mkdirSync(path.join(quotedRoot, "logs"), { recursive: true });
    createAuthGatewayScriptStub(quotedRoot);
    probeCommandMock.mockImplementation((candidates: string[]) => {
      if (candidates.includes("codex.cmd")) {
        return { command: "codex.cmd", version: "1.0.0" };
      }
      return { command: "pwsh", version: "7.0.0" };
    });
    // On win32, startWindowsDetachedProcess uses spawnSync(powershell, Start-Process)
    // instead of spawn({ detached: true }). Each call returns a PID string.
    spawnSyncMock.mockReturnValue({
      status: 0,
      stdout: "14632\n",
      stderr: "",
    });

    const appServer = await ensureCodexAppServer({
      instanceId: "codex",
      stateDir: quotedRoot,
      repoRoot: quotedRoot,
      platform: "win32",
      appServerUrl: "ws://127.0.0.1:4512",
    });

    // Windows path uses spawnSync(powershell) for hidden spawn, NOT spawn({ detached })
    expect(spawnMock).not.toHaveBeenCalled();

    // Classify spawnSync calls by payload: hidden spawn vs port probe
    const hiddenSpawnCalls = (
      spawnSyncMock.mock.calls as [string, string[], Record<string, unknown>][]
    ).filter((call) => {
      const cmdArg = call[1]?.find((a) => a.includes?.("Start-Process"));
      return cmdArg != null;
    });
    const portProbeCalls = (
      spawnSyncMock.mock.calls as [string, string[], Record<string, unknown>][]
    ).filter((call) => {
      const cmdArg = call[1]?.find((a) => a.includes?.("Get-NetTCPConnection"));
      return cmdArg != null;
    });

    // Expect 2 hidden spawn calls: gateway + app-server
    expect(hiddenSpawnCalls).toHaveLength(2);
    for (const call of hiddenSpawnCalls) {
      expect(call[0]).toBe("pwsh");
      const commandStr = call[1].find((a: string) =>
        a.includes("Start-Process"),
      );
      expect(commandStr).toContain("-FilePath 'pwsh'");
      expect(commandStr).toContain(
        "-ArgumentList @('-NoLogo', '-NoProfile', '-File', ",
      );
      expect(commandStr).toContain("-WindowStyle Hidden");
      expect(commandStr).toContain("-PassThru");
      expect(commandStr).toContain(".ps1");
      expect(commandStr).not.toContain("cmd.exe");
      expect(call[2]).toEqual(expect.objectContaining({ windowsHide: true }));
    }

    // Expect 1 port probe call: findListeningProcessId
    expect(portProbeCalls).toHaveLength(1);
    expect(portProbeCalls[0][0]).toBe("pwsh");
    expect(portProbeCalls[0][2]).toEqual(
      expect.objectContaining({ windowsHide: true }),
    );
    const wrapperPaths = newTapSpawnWrappers();
    expect(wrapperPaths).toHaveLength(2);
    expect(
      wrapperPaths.every((wrapperPath) => wrapperPath.endsWith(".ps1")),
    ).toBe(true);
    const wrapperContents = wrapperPaths.map((wrapperPath) =>
      fs.readFileSync(wrapperPath, "utf8"),
    );
    for (const content of wrapperContents) {
      expect(content).toContain("& $commandPath @commandArgs");
      expect(content).toContain(
        "Remove-Item -LiteralPath $PSCommandPath -Force -ErrorAction SilentlyContinue",
      );
    }
    expect(
      wrapperContents.some((content) => content.includes("codex.cmd")),
    ).toBe(true);
    expect(
      wrapperContents.some((content) =>
        content.includes(quotedRoot.replace(/'/g, "''")),
      ),
    ).toBe(true);
    expect(appServer.managed).toBe(true);
    expect(appServer.pid).toBe(14632);
    expect(appServer.logPath).toBe(
      path.join(quotedRoot, "logs", "app-server-codex.log"),
    );
    expect(appServer.auth?.protectedUrl).toBe("ws://127.0.0.1:4512");
    expect(appServer.auth?.tokenPath).toContain(
      path.join("secrets", "app-server-gateway-codex.token"),
    );
  });

  it("cleans up stale tap-spawn wrappers before launching a new Windows process", async () => {
    socketEvents = ["error", "open", "open"];
    probeCommandMock.mockImplementation((candidates: string[]) => {
      if (candidates.includes("codex.cmd")) {
        return { command: "codex.cmd", version: "1.0.0" };
      }
      return { command: "pwsh", version: "7.0.0" };
    });
    spawnSyncMock.mockReturnValue({
      status: 0,
      stdout: "14632\n",
      stderr: "",
    });

    const staleWrapperPath = path.join(os.tmpdir(), "tap-spawn-deadbeef.cmd");
    fs.writeFileSync(staleWrapperPath, "@echo off\r\n");
    const staleDate = new Date(Date.now() - 2 * 60 * 60 * 1000);
    fs.utimesSync(staleWrapperPath, staleDate, staleDate);

    await ensureCodexAppServer({
      instanceId: "codex",
      stateDir: tmpDir,
      repoRoot: tmpDir,
      platform: "win32",
      appServerUrl: "ws://127.0.0.1:4513",
    });

    expect(fs.existsSync(staleWrapperPath)).toBe(false);
  });
});
