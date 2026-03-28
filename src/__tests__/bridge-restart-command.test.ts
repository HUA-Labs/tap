import { beforeEach, describe, expect, it, vi } from "vitest";

const restartBridgeMock = vi.fn();
const inferRestartModeMock = vi.fn();
const loadBridgeStateMock = vi.fn();
const loadStateMock = vi.fn();
const saveStateMock = vi.fn();
const updateInstanceStateMock = vi.fn();
const getAdapterMock = vi.fn();
const resolveConfigMock = vi.fn();
const findRepoRootMock = vi.fn();
const createAdapterContextMock = vi.fn();
const logMock = vi.fn();
const logSuccessMock = vi.fn();
const logErrorMock = vi.fn();
const logHeaderMock = vi.fn();

vi.mock("../engine/bridge.js", async () => {
  const actual = await vi.importActual<typeof import("../engine/bridge.js")>(
    "../engine/bridge.js",
  );
  return {
    ...actual,
    restartBridge: restartBridgeMock,
    inferRestartMode: inferRestartModeMock,
    loadBridgeState: loadBridgeStateMock,
  };
});

vi.mock("../state.js", async () => {
  const actual =
    await vi.importActual<typeof import("../state.js")>("../state.js");
  return {
    ...actual,
    loadState: loadStateMock,
    saveState: saveStateMock,
    updateInstanceState: updateInstanceStateMock,
  };
});

vi.mock("../adapters/index.js", () => ({
  getAdapter: getAdapterMock,
}));

vi.mock("../config/index.js", () => ({
  resolveConfig: resolveConfigMock,
}));

vi.mock("../utils.js", async () => {
  const actual =
    await vi.importActual<typeof import("../utils.js")>("../utils.js");
  return {
    ...actual,
    findRepoRoot: findRepoRootMock,
    createAdapterContext: createAdapterContextMock,
    log: logMock,
    logSuccess: logSuccessMock,
    logError: logErrorMock,
    logHeader: logHeaderMock,
  };
});

const { bridgeCommand } = await import("../commands/bridge.js");

describe("bridge restart cold-start warmup env", () => {
  const repoRoot = "D:/repo";
  const state = {
    schemaVersion: 2 as const,
    createdAt: "2026-03-28T00:00:00.000Z",
    updatedAt: "2026-03-28T00:00:00.000Z",
    commsDir: "D:/repo/comms",
    repoRoot,
    packageVersion: "0.1.0",
    instances: {
      codex: {
        instanceId: "codex",
        runtime: "codex" as const,
        agentName: "솔",
        port: 4502,
        installed: true,
        configPath: "C:/Users/test/.codex/config.toml",
        bridgeMode: "app-server",
        restartRequired: false,
        ownedArtifacts: [],
        backupPath: "",
        lastAppliedHash: "",
        lastVerifiedAt: null,
        bridge: null,
        headless: null,
        warnings: [],
        manageAppServer: true,
        noAuth: false,
      },
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    loadStateMock.mockReturnValue(state);
    saveStateMock.mockImplementation(() => undefined);
    updateInstanceStateMock.mockImplementation(
      (
        currentState: typeof state,
        instanceId: string,
        instanceState: (typeof state)["instances"]["codex"],
      ) => ({
        ...currentState,
        instances: {
          ...currentState.instances,
          [instanceId]: instanceState,
        },
      }),
    );
    getAdapterMock.mockReturnValue({
      resolveBridgeScript: () => "D:/repo/scripts/codex-app-server-bridge.ts",
    });
    resolveConfigMock.mockReturnValue({
      config: {
        runtimeCommand: "codex",
        appServerUrl: "ws://127.0.0.1:4502",
      },
    });
    findRepoRootMock.mockReturnValue(repoRoot);
    createAdapterContextMock.mockReturnValue({
      commsDir: "D:/repo/comms",
      repoRoot,
      stateDir: "D:/repo/.tap-comms",
      platform: "win32",
    });
    inferRestartModeMock.mockReturnValue({
      manageAppServer: true,
      noAuth: false,
    });
    loadBridgeStateMock.mockReturnValue(null);
  });

  it("enables cold-start warmup only while delegating bridge restart", async () => {
    const originalWarmup = process.env.TAP_COLD_START_WARMUP;
    delete process.env.TAP_COLD_START_WARMUP;
    restartBridgeMock.mockImplementation(async () => {
      expect(process.env.TAP_COLD_START_WARMUP).toBe("true");
      return {
        pid: 4321,
        statePath: "D:/repo/.tap-comms/pids/bridge-codex.json",
        lastHeartbeat: "2026-03-28T00:00:00.000Z",
        appServer: null,
      };
    });

    try {
      const result = await bridgeCommand(["restart", "codex"]);

      expect(result.ok).toBe(true);
      expect(result.code).toBe("TAP_BRIDGE_START_OK");
      expect(restartBridgeMock).toHaveBeenCalledWith(
        expect.objectContaining({
          instanceId: "codex",
          runtime: "codex",
          appServerUrl: "ws://127.0.0.1:4502",
          drainTimeoutSeconds: 30,
        }),
      );
      expect(process.env.TAP_COLD_START_WARMUP).toBeUndefined();
    } finally {
      if (originalWarmup === undefined) {
        delete process.env.TAP_COLD_START_WARMUP;
      } else {
        process.env.TAP_COLD_START_WARMUP = originalWarmup;
      }
    }
  });

  it("restores the previous warmup env after restart failure", async () => {
    const originalWarmup = process.env.TAP_COLD_START_WARMUP;
    process.env.TAP_COLD_START_WARMUP = "outside";
    restartBridgeMock.mockImplementation(async () => {
      expect(process.env.TAP_COLD_START_WARMUP).toBe("true");
      throw new Error("restart failed");
    });

    try {
      const result = await bridgeCommand(["restart", "codex"]);

      expect(result.ok).toBe(false);
      expect(result.code).toBe("TAP_BRIDGE_START_FAILED");
      expect(result.message).toContain("restart failed");
      expect(process.env.TAP_COLD_START_WARMUP).toBe("outside");
    } finally {
      if (originalWarmup === undefined) {
        delete process.env.TAP_COLD_START_WARMUP;
      } else {
        process.env.TAP_COLD_START_WARMUP = originalWarmup;
      }
    }
  });
});
