import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RuntimeAdapter, TapState } from "../types.js";

const loadStateMock = vi.fn();
const saveStateMock = vi.fn();
const updateInstanceStateMock = vi.fn();
const fileHashMock = vi.fn();

const getAdapterMock = vi.fn();
const resolveConfigMock = vi.fn();
const patchCodexApprovalModeMock = vi.fn();
const loadInstanceConfigMock = vi.fn();
const saveInstanceConfigMock = vi.fn();

const startBridgeMock = vi.fn();
const stopBridgeMock = vi.fn();
const restartBridgeMock = vi.fn();
const inferRestartModeMock = vi.fn();
const getBridgeStatusMock = vi.fn();
const loadBridgeStateMock = vi.fn();
const getHeartbeatAgeMock = vi.fn();
const getBridgeHeartbeatTimestampMock = vi.fn();
const loadRuntimeBridgeHeartbeatMock = vi.fn();
const loadRuntimeBridgeThreadStateMock = vi.fn();
const saveBridgeStateMock = vi.fn();
const stopManagedAppServerMock = vi.fn();
const checkAppServerHealthMock = vi.fn();
const findNextAvailableAppServerPortMock = vi.fn();
const waitForPortReleaseMock = vi.fn();
const getTurnInfoMock = vi.fn();
const isTurnStuckMock = vi.fn();
const deriveBridgeLifecycleStateMock = vi.fn();
const deriveCodexSessionStateMock = vi.fn();

const collectDashboardSnapshotMock = vi.fn();

const findRepoRootMock = vi.fn();
const createAdapterContextMock = vi.fn();

vi.mock("../state.js", () => ({
  loadState: loadStateMock,
  saveState: saveStateMock,
  updateInstanceState: updateInstanceStateMock,
  fileHash: fileHashMock,
}));

vi.mock("../adapters/index.js", () => ({
  getAdapter: getAdapterMock,
}));

vi.mock("../adapters/codex.js", () => ({
  patchCodexApprovalMode: patchCodexApprovalModeMock,
}));

vi.mock("../config/index.js", () => ({
  resolveConfig: resolveConfigMock,
}));

vi.mock("../config/instance-config.js", () => ({
  loadInstanceConfig: loadInstanceConfigMock,
  saveInstanceConfig: saveInstanceConfigMock,
}));

vi.mock("../engine/dashboard.js", () => ({
  collectDashboardSnapshot: collectDashboardSnapshotMock,
}));

vi.mock("../engine/bridge.js", () => ({
  startBridge: startBridgeMock,
  stopBridge: stopBridgeMock,
  restartBridge: restartBridgeMock,
  inferRestartMode: inferRestartModeMock,
  getBridgeStatus: getBridgeStatusMock,
  loadBridgeState: loadBridgeStateMock,
  getHeartbeatAge: getHeartbeatAgeMock,
  getBridgeHeartbeatTimestamp: getBridgeHeartbeatTimestampMock,
  loadRuntimeBridgeHeartbeat: loadRuntimeBridgeHeartbeatMock,
  loadRuntimeBridgeThreadState: loadRuntimeBridgeThreadStateMock,
  saveBridgeState: saveBridgeStateMock,
  stopManagedAppServer: stopManagedAppServerMock,
  resolveAppServerUrl: (baseUrl: string | undefined, port?: number) => {
    const base = (baseUrl ?? "ws://127.0.0.1:4501").replace(/\/$/, "");
    if (port == null) return base;
    return base.replace(/:\d+$/, `:${port}`);
  },
  checkAppServerHealth: checkAppServerHealthMock,
  findNextAvailableAppServerPort: findNextAvailableAppServerPortMock,
  waitForPortRelease: waitForPortReleaseMock,
  getTurnInfo: getTurnInfoMock,
  isTurnStuck: isTurnStuckMock,
  deriveBridgeLifecycleState: deriveBridgeLifecycleStateMock,
  deriveCodexSessionState: deriveCodexSessionStateMock,
}));

vi.mock("../commands/bridge-helpers.js", () => ({
  formatAppServerState: vi.fn().mockReturnValue(""),
  redactProtectedUrl: vi.fn((url: string) => url),
  resolveRecoveredAgentName: vi.fn((_id: string, storedName?: string) => storedName),
}));

vi.mock("../commands/bridge-heartbeat.js", () => ({
  pruneStaleHeartbeatsForBridgeUp: vi.fn().mockReturnValue({ removed: 0 }),
}));

vi.mock("../utils.js", async () => {
  const actual =
    await vi.importActual<typeof import("../utils.js")>("../utils.js");
  return {
    ...actual,
    findRepoRoot: findRepoRootMock,
    createAdapterContext: createAdapterContextMock,
    log: vi.fn(),
    logSuccess: vi.fn(),
    logError: vi.fn(),
    logHeader: vi.fn(),
  };
});

const { bridgeCommand } = await import("../commands/bridge.js");
const { upCommand } = await import("../commands/up.js");

function makeState(overrides: Record<string, unknown> = {}): TapState {
  return {
    schemaVersion: 3,
    createdAt: "2026-04-01T00:00:00.000Z",
    updatedAt: "2026-04-01T00:00:00.000Z",
    commsDir: "D:/repo/tap-comms",
    repoRoot: "D:/repo",
    packageVersion: "0.3.1",
    instances: {
      codex: {
        instanceId: "codex",
        runtime: "codex",
        agentName: "담",
        port: 4510,
        installed: true,
        configPath: "D:/repo/.codex/config.toml",
        bridgeMode: "app-server",
        restartRequired: false,
        ownedArtifacts: [],
        backupPath: "",
        lastAppliedHash: "",
        lastVerifiedAt: null,
        bridge: null,
        headless: null,
        warnings: [],
        ...overrides,
      },
    },
  };
}

describe("M224 command-path coverage", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    findRepoRootMock.mockReturnValue("D:/repo");
    createAdapterContextMock.mockReturnValue({
      commsDir: "D:/repo/tap-comms",
      repoRoot: "D:/repo",
      stateDir: "D:/repo/.tap-comms",
      platform: "win32",
    });
    resolveConfigMock.mockReturnValue({
      config: {
        repoRoot: "D:/repo",
        commsDir: "D:/repo/tap-comms",
        stateDir: "D:/repo/.tap-comms",
        runtimeCommand: "node",
        appServerUrl: "ws://127.0.0.1:4501",
      },
      sources: {},
    });
    updateInstanceStateMock.mockImplementation(
      (state, instanceId, instance) => ({
        ...state,
        instances: {
          ...state.instances,
          [instanceId]: instance,
        },
      }),
    );
    getAdapterMock.mockReturnValue({
      runtime: "codex",
      probe: vi.fn(),
      plan: vi.fn(),
      apply: vi.fn(),
      verify: vi.fn(),
      bridgeMode: () => "app-server",
      resolveBridgeScript: () => "D:/repo/scripts/codex-bridge-runner.ts",
    } satisfies RuntimeAdapter);
    patchCodexApprovalModeMock.mockReturnValue("D:/repo/.codex/config.toml");
    loadInstanceConfigMock.mockReturnValue({
      instanceId: "codex",
      runtime: "codex",
      agentName: "담",
      agentId: null,
      port: 4510,
      appServerUrl: "ws://127.0.0.1:4510",
      permission: { mode: "default" },
      mcpEnv: {},
      configHash: "cfg12345",
      lastSyncedToRuntime: null,
      runtimeConfigHash: "old-runtime-hash",
      createdAt: "2026-04-01T00:00:00.000Z",
      updatedAt: "2026-04-01T00:00:00.000Z",
    });
    fileHashMock.mockReturnValue("new-runtime-hash");
    startBridgeMock.mockResolvedValue({
      pid: 7001,
      statePath: "D:/repo/.tap-comms/pids/bridge-codex.json",
      lastHeartbeat: "2026-04-01T00:00:00.000Z",
      appServer: null,
    });
    stopBridgeMock.mockResolvedValue(true);
    restartBridgeMock.mockResolvedValue({
      pid: 7002,
      statePath: "D:/repo/.tap-comms/pids/bridge-codex.json",
      lastHeartbeat: "2026-04-01T00:00:00.000Z",
      appServer: null,
    });
    inferRestartModeMock.mockReturnValue({
      manageAppServer: false,
      noAuth: false,
    });
    getBridgeStatusMock.mockReturnValue("stopped");
    loadBridgeStateMock.mockReturnValue(null);
    getHeartbeatAgeMock.mockReturnValue(null);
    getBridgeHeartbeatTimestampMock.mockReturnValue(null);
    loadRuntimeBridgeHeartbeatMock.mockReturnValue(null);
    loadRuntimeBridgeThreadStateMock.mockReturnValue(null);
    saveBridgeStateMock.mockReturnValue(undefined);
    stopManagedAppServerMock.mockResolvedValue(true);
    checkAppServerHealthMock.mockResolvedValue(false);
    findNextAvailableAppServerPortMock.mockResolvedValue(4510);
    waitForPortReleaseMock.mockResolvedValue(true);
    getTurnInfoMock.mockReturnValue(null);
    isTurnStuckMock.mockReturnValue(false);
    deriveBridgeLifecycleStateMock.mockReturnValue({
      presence: "stopped",
      status: "stopped",
      summary: "stopped",
    });
    deriveCodexSessionStateMock.mockReturnValue({
      status: "stopped",
      turnState: "stopped",
      summary: "stopped",
      activeTurnId: null,
      idleSince: null,
      lastTurnAt: null,
      lastDispatchAt: null,
    });
    collectDashboardSnapshotMock.mockReturnValue({
      generatedAt: "2026-04-01T00:00:00.000Z",
      repoRoot: "D:/repo",
      commsDir: "D:/repo/tap-comms",
      agents: [],
      bridges: [],
      prs: [],
      warnings: [],
    });
  });

  it("patches approval_mode on the live bridgeCommand start path before health-check failure", async () => {
    loadStateMock.mockReturnValue(makeState());

    const result = await bridgeCommand(["start", "codex", "--no-server"]);

    expect(result.ok).toBe(false);
    expect(result.code).toBe("TAP_BRIDGE_START_FAILED");
    expect(patchCodexApprovalModeMock).toHaveBeenCalledTimes(1);
    expect(loadInstanceConfigMock).toHaveBeenCalledWith(
      "D:/repo/.tap-comms",
      "codex",
    );
    expect(fileHashMock).toHaveBeenCalledWith("D:/repo/.codex/config.toml");
    expect(saveInstanceConfigMock).toHaveBeenCalledWith(
      "D:/repo/.tap-comms",
      expect.objectContaining({
        runtimeConfigHash: "new-runtime-hash",
      }),
    );
    expect(checkAppServerHealthMock).toHaveBeenCalledWith(
      "ws://127.0.0.1:4510",
    );
    expect(startBridgeMock).not.toHaveBeenCalled();
  });

  it("patches approval_mode on the live upCommand path via bridge start --all", async () => {
    loadStateMock.mockReturnValue(makeState());

    const result = await upCommand(["--no-server"]);

    expect(result.ok).toBe(false);
    expect(result.command).toBe("up");
    expect(patchCodexApprovalModeMock).toHaveBeenCalledTimes(1);
    expect(loadInstanceConfigMock).toHaveBeenCalledWith(
      "D:/repo/.tap-comms",
      "codex",
    );
    expect(saveInstanceConfigMock).toHaveBeenCalledWith(
      "D:/repo/.tap-comms",
      expect.objectContaining({
        runtimeConfigHash: "new-runtime-hash",
      }),
    );
    expect(checkAppServerHealthMock).toHaveBeenCalledWith(
      "ws://127.0.0.1:4510",
    );
  });
});
