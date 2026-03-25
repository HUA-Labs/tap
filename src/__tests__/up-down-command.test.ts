import { beforeEach, describe, expect, it, vi } from "vitest";

const bridgeCommandMock = vi.fn();
const collectDashboardSnapshotMock = vi.fn();
const findRepoRootMock = vi.fn();
const logMock = vi.fn();

vi.mock("../commands/bridge.js", () => ({
  bridgeCommand: bridgeCommandMock,
}));

vi.mock("../engine/dashboard.js", () => ({
  collectDashboardSnapshot: collectDashboardSnapshotMock,
}));

vi.mock("../utils.js", async () => {
  const actual =
    await vi.importActual<typeof import("../utils.js")>("../utils.js");
  return {
    ...actual,
    findRepoRoot: findRepoRootMock,
    log: logMock,
  };
});

const { upCommand } = await import("../commands/up.js");
const { downCommand } = await import("../commands/down.js");

describe("up/down orchestration commands", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findRepoRootMock.mockReturnValue("D:/repo");
    collectDashboardSnapshotMock.mockReturnValue({
      generatedAt: "2026-03-25T00:00:00.000Z",
      repoRoot: "D:/repo",
      commsDir: "D:/repo/.tap-comms",
      agents: [],
      bridges: [
        {
          instanceId: "codex",
          runtime: "codex",
          status: "running",
          pid: 1234,
          port: 4510,
          heartbeatAge: 1,
          headless: true,
        },
      ],
      prs: [],
      warnings: [],
    });
  });

  it("shows help for tap up without delegating", async () => {
    const result = await upCommand(["--help"]);

    expect(result.ok).toBe(true);
    expect(result.code).toBe("TAP_NO_OP");
    expect(bridgeCommandMock).not.toHaveBeenCalled();
    expect(logMock).toHaveBeenCalled();
  });

  it("delegates tap up to bridge start --all and attaches snapshot", async () => {
    bridgeCommandMock.mockResolvedValue({
      ok: true,
      command: "bridge",
      code: "TAP_BRIDGE_START_OK",
      message: "Started 1/1 bridge(s): codex",
      warnings: [],
      data: { started: ["codex"], failed: [] },
    });

    const result = await upCommand(["--no-auth"]);

    expect(bridgeCommandMock).toHaveBeenCalledWith([
      "start",
      "--all",
      "--no-auth",
    ]);
    expect(result.ok).toBe(true);
    expect(result.command).toBe("up");
    expect(result.code).toBe("TAP_UP_OK");
    expect(result.data).toHaveProperty("snapshot");
  });

  it("delegates tap down to bridge stop and attaches snapshot", async () => {
    bridgeCommandMock.mockResolvedValue({
      ok: true,
      command: "bridge",
      code: "TAP_BRIDGE_STOP_OK",
      message: "Stopped 1 bridge(s): codex",
      warnings: [],
      data: { stopped: ["codex"], stoppedAppServers: [8123] },
    });

    const result = await downCommand([]);

    expect(bridgeCommandMock).toHaveBeenCalledWith(["stop"]);
    expect(result.ok).toBe(true);
    expect(result.command).toBe("down");
    expect(result.code).toBe("TAP_DOWN_OK");
    expect(result.data).toHaveProperty("snapshot");
  });

  it("preserves bridge failures while returning up command metadata", async () => {
    bridgeCommandMock.mockResolvedValue({
      ok: false,
      command: "bridge",
      code: "TAP_NOT_INITIALIZED",
      message: "Not initialized",
      warnings: [],
      data: {},
    });

    const result = await upCommand([]);

    expect(result.ok).toBe(false);
    expect(result.command).toBe("up");
    expect(result.code).toBe("TAP_NOT_INITIALIZED");
    expect(result.data).toHaveProperty("snapshot");
  });
});
