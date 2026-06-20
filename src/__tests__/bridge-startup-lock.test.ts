import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const ensureCodexAppServerMock = vi.fn();
const startWindowsDetachedProcessMock = vi.fn();
const startUnixDetachedProcessMock = vi.fn();
const stopManagedAppServerMock = vi.fn();
const rotateLogMock = vi.fn();
const resolveAgentNameMock = vi.fn(
  (_instanceId: string, agentName?: string | null) => agentName ?? "테",
);
const isProcessAliveMock = vi.fn(
  (pid: number) => pid === 4101 || pid === process.pid,
);

vi.mock("../engine/bridge-app-server-lifecycle.js", () => ({
  ensureCodexAppServer: ensureCodexAppServerMock,
  resolveAppServerUrl: (appServerUrl?: string | null) =>
    appServerUrl ?? "ws://127.0.0.1:4501",
  isAppServerUsedByOtherBridge: () => false,
}));

vi.mock("../engine/bridge-windows-spawn.js", () => ({
  startWindowsDetachedProcess: startWindowsDetachedProcessMock,
}));

vi.mock("../engine/bridge-unix-spawn.js", () => ({
  startUnixDetachedProcess: startUnixDetachedProcessMock,
}));

vi.mock("../engine/bridge-process-control.js", () => ({
  isProcessAlive: isProcessAliveMock,
  stopManagedAppServer: stopManagedAppServerMock,
}));

vi.mock("../engine/bridge-config.js", () => ({
  resolveAgentName: resolveAgentNameMock,
}));

vi.mock("../engine/bridge-app-server-auth.js", () => ({
  materializeGatewayTokenFile: (
    _stateDir: string,
    _instanceId: string,
    _appServerUrl: string,
    auth: unknown,
  ) => auth,
}));

vi.mock("../engine/bridge-observability.js", () => ({
  rotateLog: rotateLogMock,
}));

vi.mock("../runtime/index.js", () => ({
  resolveNodeRuntime: () => ({
    command: process.execPath,
    supportsStripTypes: false,
    source: "test",
    majorVersion: Number.parseInt(process.versions.node.split(".")[0]!, 10),
  }),
  buildRuntimeEnv: () => ({}),
}));

const { startBridge } = await import("../engine/bridge-startup.js");

describe("bridge startup lock", () => {
  let tmpDir: string;
  let stateDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tap-bridge-startup-"));
    stateDir = path.join(tmpDir, ".tap-comms");
    fs.mkdirSync(path.join(stateDir, "pids"), { recursive: true });
    fs.mkdirSync(path.join(stateDir, "logs"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, "hua-comms"), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns the existing bridge state when another startup finishes first", async () => {
    const lockPath = path.join(stateDir, "pids", "bridge-codex.startup.lock");
    const statePath = path.join(stateDir, "pids", "bridge-codex.json");
    fs.writeFileSync(
      lockPath,
      JSON.stringify({
        pid: process.pid,
        startedAt: "2026-04-04T00:00:00.000Z",
      }),
      "utf8",
    );

    const expectedState = {
      pid: 4101,
      statePath,
      lastHeartbeat: "2026-04-04T00:00:00.000Z",
      runtimeStateDir: path.join(
        tmpDir,
        ".tmp",
        "codex-app-server-bridge-codex",
      ),
    };

    const publishExistingState = setTimeout(() => {
      fs.writeFileSync(
        statePath,
        JSON.stringify(expectedState, null, 2),
        "utf8",
      );
    }, 50);

    const result = await startBridge({
      instanceId: "codex",
      runtime: "codex",
      stateDir,
      commsDir: path.join(tmpDir, "hua-comms"),
      bridgeScript: path.join(tmpDir, "bridge.js"),
      platform: "linux",
      agentName: "테",
      repoRoot: tmpDir,
      appServerUrl: "ws://127.0.0.1:4501",
      manageAppServer: true,
    });

    clearTimeout(publishExistingState);

    expect(result).toEqual(expectedState);
    expect(ensureCodexAppServerMock).not.toHaveBeenCalled();
    expect(startUnixDetachedProcessMock).not.toHaveBeenCalled();
  });

  it("reclaims a stale startup lock before spawning a bridge", async () => {
    startUnixDetachedProcessMock.mockReturnValue(4101);
    const lockPath = path.join(stateDir, "pids", "bridge-codex.startup.lock");
    fs.writeFileSync(
      lockPath,
      JSON.stringify({
        pid: 999999,
        startedAt: "2026-04-04T00:00:00.000Z",
      }),
      "utf8",
    );
    const staleTime = new Date(Date.now() - 5 * 60 * 1000);
    fs.utimesSync(lockPath, staleTime, staleTime);

    const result = await startBridge({
      instanceId: "codex",
      runtime: "codex",
      stateDir,
      commsDir: path.join(tmpDir, "hua-comms"),
      bridgeScript: path.join(tmpDir, "bridge.js"),
      platform: "linux",
      agentName: "테",
      repoRoot: tmpDir,
      appServerUrl: "ws://127.0.0.1:4501",
      manageAppServer: false,
    });

    expect(result.pid).toBe(4101);
    expect(startUnixDetachedProcessMock).toHaveBeenCalledTimes(1);
    expect(fs.existsSync(lockPath)).toBe(false);
  });
});
