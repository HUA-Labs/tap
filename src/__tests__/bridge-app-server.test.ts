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
    // No-op for tests.
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tap-app-server-test-"));
  fs.mkdirSync(path.join(tmpDir, "logs"), { recursive: true });
  socketEvents = [];
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

  it("uses shell spawn on Windows for codex.cmd and records the listening PID", async () => {
    socketEvents = ["error", "open", "open"];
    probeCommandMock.mockImplementation((candidates: string[]) => {
      if (candidates.includes("codex.cmd")) {
        return { command: "codex.cmd", version: "1.0.0" };
      }
      return { command: "pwsh", version: "7.0.0" };
    });
    const unref = vi.fn();
    spawnMock
      .mockReturnValueOnce({
        pid: 26056,
        unref,
      })
      .mockReturnValueOnce({
        pid: 26057,
        unref,
      });
    spawnSyncMock.mockReturnValue({
      status: 0,
      stdout: "14632\n",
      stderr: "",
    });

    const appServer = await ensureCodexAppServer({
      instanceId: "codex",
      stateDir: tmpDir,
      repoRoot: tmpDir,
      platform: "win32",
      appServerUrl: "ws://127.0.0.1:4512",
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
      "codex.cmd",
      [
        "app-server",
        "--listen",
        expect.stringMatching(/^ws:\/\/127\.0\.0\.1:\d+$/),
      ],
      expect.objectContaining({
        cwd: tmpDir,
        detached: true,
        shell: true,
        windowsHide: true,
      }),
    );
    expect(unref).toHaveBeenCalled();
    expect(spawnSyncMock).toHaveBeenCalledWith(
      "pwsh",
      expect.arrayContaining(["-NoLogo", "-NoProfile", "-Command"]),
      expect.objectContaining({
        encoding: "utf-8",
        windowsHide: true,
      }),
    );
    expect(appServer.managed).toBe(true);
    expect(appServer.pid).toBe(14632);
    expect(appServer.logPath).toBe(
      path.join(tmpDir, "logs", "app-server-codex.log"),
    );
    expect(appServer.auth?.protectedUrl).toBe("ws://127.0.0.1:4512");
    expect(appServer.auth?.tokenPath).toContain(
      path.join("secrets", "app-server-gateway-codex.token"),
    );
  });
});
