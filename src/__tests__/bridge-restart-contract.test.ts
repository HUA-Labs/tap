import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { BridgeState } from "../types.js";

const startBridgeMock = vi.fn();
const terminateProcessMock = vi.fn();
const cleanupHeadlessDispatchMock = vi.fn();

vi.mock("../engine/bridge-startup.js", async () => {
  const actual = await vi.importActual<
    typeof import("../engine/bridge-startup.js")
  >("../engine/bridge-startup.js");
  return {
    ...actual,
    startBridge: startBridgeMock,
  };
});

vi.mock("../engine/bridge-process-control.js", async () => {
  const actual = await vi.importActual<
    typeof import("../engine/bridge-process-control.js")
  >("../engine/bridge-process-control.js");
  return {
    ...actual,
    terminateProcess: terminateProcessMock,
  };
});

vi.mock("../engine/bridge-config.js", async () => {
  const actual = await vi.importActual<
    typeof import("../engine/bridge-config.js")
  >("../engine/bridge-config.js");
  return {
    ...actual,
    cleanupHeadlessDispatch: cleanupHeadlessDispatchMock,
  };
});

const { restartBridge, saveBridgeState, BridgeDrainTimeoutError } =
  await import("../engine/bridge.js");

describe("restartBridge contract hardening", () => {
  let tmpDir: string;
  let stateDir: string;
  let runtimeStateDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tap-bridge-restart-"));
    stateDir = path.join(tmpDir, ".tap-comms");
    runtimeStateDir = path.join(
      tmpDir,
      ".tmp",
      "codex-app-server-bridge-codex",
    );
    fs.mkdirSync(path.join(stateDir, "pids"), { recursive: true });
    fs.mkdirSync(runtimeStateDir, { recursive: true });
    terminateProcessMock.mockResolvedValue(true);
    startBridgeMock.mockResolvedValue({
      pid: 5200,
      statePath: path.join(stateDir, "pids", "bridge-codex.json"),
      lastHeartbeat: "2026-04-18T00:00:00.000Z",
      runtimeStateDir,
      appServer: null,
    });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function seedBridgeState(): BridgeState {
    const bridgeState: BridgeState = {
      pid: process.pid,
      statePath: path.join(stateDir, "pids", "bridge-codex.json"),
      lastHeartbeat: "2026-04-18T00:00:00.000Z",
      runtimeStateDir,
      appServer: null,
    };
    saveBridgeState(stateDir, "codex", bridgeState);
    return bridgeState;
  }

  function writeHeartbeat(payload: Record<string, unknown>) {
    fs.writeFileSync(
      path.join(runtimeStateDir, "heartbeat.json"),
      JSON.stringify(
        {
          updatedAt: "2026-04-18T00:00:00.000Z",
          connected: true,
          initialized: true,
          ...payload,
        },
        null,
        2,
      ),
      "utf-8",
    );
  }

  it("aborts restart on drain timeout unless --force is set", async () => {
    seedBridgeState();
    writeHeartbeat({
      activeTurnId: "turn-123",
      turnState: "active",
      turnStartedAt: "2026-04-18T00:00:00.000Z",
    });

    await expect(
      restartBridge({
        instanceId: "codex",
        runtime: "codex",
        stateDir,
        commsDir: tmpDir,
        bridgeScript: path.join(tmpDir, "bridge.js"),
        platform: "linux",
        agentName: "하",
        repoRoot: tmpDir,
        drainTimeoutSeconds: 0,
      }),
    ).rejects.toBeInstanceOf(BridgeDrainTimeoutError);

    expect(startBridgeMock).not.toHaveBeenCalled();
  });

  it("continues restart with forced=true after drain timeout when requested", async () => {
    seedBridgeState();
    writeHeartbeat({
      activeTurnId: "turn-123",
      turnState: "active",
      turnStartedAt: "2026-04-18T00:00:00.000Z",
    });

    const result = await restartBridge({
      instanceId: "codex",
      runtime: "codex",
      stateDir,
      commsDir: tmpDir,
      bridgeScript: path.join(tmpDir, "bridge.js"),
      platform: "linux",
      agentName: "하",
      repoRoot: tmpDir,
      drainTimeoutSeconds: 0,
      force: true,
    });

    expect(result).toMatchObject({
      drained: false,
      forced: true,
      bridge: {
        pid: 5200,
      },
    });
    expect(startBridgeMock).toHaveBeenCalledTimes(1);
  });

  it("treats idle/disconnected turn state as safe to stop", async () => {
    seedBridgeState();
    writeHeartbeat({
      activeTurnId: "turn-123",
      turnState: "idle",
      idleSince: "2026-04-18T00:00:00.000Z",
    });

    const result = await restartBridge({
      instanceId: "codex",
      runtime: "codex",
      stateDir,
      commsDir: tmpDir,
      bridgeScript: path.join(tmpDir, "bridge.js"),
      platform: "linux",
      agentName: "하",
      repoRoot: tmpDir,
      drainTimeoutSeconds: 0,
    });

    expect(result).toMatchObject({
      drained: true,
      forced: false,
      bridge: {
        pid: 5200,
      },
    });
    expect(startBridgeMock).toHaveBeenCalledTimes(1);
  });
});
