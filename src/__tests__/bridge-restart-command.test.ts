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
const resolveAgentNameMock = vi.fn();
const resolveBridgeRestartPlanMock = vi.fn();

vi.mock("../engine/bridge.js", async () => {
  const actual = await vi.importActual<typeof import("../engine/bridge.js")>(
    "../engine/bridge.js",
  );
  return {
    ...actual,
    restartBridge: restartBridgeMock,
    inferRestartMode: inferRestartModeMock,
    loadBridgeState: loadBridgeStateMock,
    resolveAgentName: resolveAgentNameMock,
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

vi.mock("../engine/bridge-restart-plan.js", () => ({
  resolveBridgeRestartPlan: resolveBridgeRestartPlanMock,
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
const { BridgeDrainTimeoutError } = await import("../engine/bridge.js");

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
        defaultAgentName: "솔",
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
        managedAppServer: null,
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
      resolveBridgeScript: () =>
        "D:/repo/scripts/codex/codex-app-server-bridge.ts",
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
    resolveAgentNameMock.mockImplementation(
      (_instanceId: string, explicitName?: string) =>
        explicitName ?? state.instances.codex.defaultAgentName,
    );
    resolveBridgeRestartPlanMock.mockReturnValue({
      kind: "managed-restart",
      reason: "tracked bridge pid is alive",
      bridgeState: null,
      lifecycle: {
        presence: "bridge-live",
        status: "ready",
        summary: "bridge-live, ready",
        lastTransitionAt: null,
        lastTransitionReason: null,
        restartCount: 0,
        threadId: "thread-1",
        threadCwd: repoRoot,
        savedThreadId: null,
        savedThreadCwd: null,
        activeTurnId: null,
        connected: true,
        initialized: true,
        appServerHealthy: true,
      },
      liveDispatch: null,
    });
  });

  it("enables cold-start warmup only while delegating bridge restart", async () => {
    const originalWarmup = process.env.TAP_COLD_START_WARMUP;
    delete process.env.TAP_COLD_START_WARMUP;
    restartBridgeMock.mockImplementation(async () => {
      expect(process.env.TAP_COLD_START_WARMUP).toBe("true");
      return {
        bridge: {
          pid: 4321,
          statePath: "D:/repo/.tap-comms/pids/bridge-codex.json",
          lastHeartbeat: "2026-03-28T00:00:00.000Z",
          appServer: null,
        },
        drained: true,
        forced: false,
      };
    });

    try {
      const result = await bridgeCommand(["restart", "codex"]);

      expect(result.ok).toBe(true);
      expect(result.code).toBe("TAP_BRIDGE_RESTART_OK");
      expect(restartBridgeMock).toHaveBeenCalledWith(
        expect.objectContaining({
          instanceId: "codex",
          runtime: "codex",
          appServerUrl: "ws://127.0.0.1:4502",
          drainTimeoutSeconds: 30,
          force: false,
        }),
      );
      expect(resolveBridgeRestartPlanMock).toHaveBeenCalledWith(
        expect.objectContaining({
          instanceId: "codex",
          liveDispatchAliases: ["솔"],
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
      expect(result.code).toBe("TAP_BRIDGE_RESTART_FAILED");
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

  it("restarts with recovered agentName and syncs state", async () => {
    const recoveredState = {
      ...state,
      instances: {
        ...state.instances,
        codex: {
          ...state.instances.codex,
          defaultAgentName: null,
        },
      },
    };
    loadStateMock.mockReturnValue(recoveredState);
    resolveAgentNameMock.mockReturnValue("솔");
    restartBridgeMock.mockResolvedValue({
      bridge: {
        pid: 4321,
        statePath: "D:/repo/.tap-comms/pids/bridge-codex.json",
        lastHeartbeat: "2026-03-28T00:00:00.000Z",
        appServer: null,
      },
      drained: true,
      forced: false,
    });

    const result = await bridgeCommand(["restart", "codex"]);

    expect(result.ok).toBe(true);
    expect(resolveAgentNameMock).toHaveBeenCalledWith(
      "codex",
      undefined,
      expect.objectContaining({
        repoRoot: "D:/repo",
        stateDir: "D:/repo/.tap-comms",
      }),
    );
    expect(restartBridgeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        instanceId: "codex",
        agentName: "솔",
      }),
    );
    expect(saveStateMock).toHaveBeenCalledWith(
      "D:/repo",
      expect.objectContaining({
        instances: expect.objectContaining({
          codex: expect.objectContaining({ defaultAgentName: "솔" }),
        }),
      }),
    );
  });

  it("reuses retained managed app-server metadata on restart", async () => {
    const retainedAppServer = {
      url: "ws://127.0.0.1:4502",
      pid: 9911,
      managed: true,
      healthy: true,
      lastCheckedAt: "2026-03-28T00:00:00.000Z",
      lastHealthyAt: "2026-03-28T00:00:00.000Z",
      logPath: "D:/repo/.tap-comms/logs/app-server-codex.log",
      manualCommand: "codex app-server --listen ws://127.0.0.1:4502",
      auth: null,
    };
    loadStateMock.mockReturnValue({
      ...state,
      instances: {
        ...state.instances,
        codex: {
          ...state.instances.codex,
          managedAppServer: retainedAppServer,
        },
      },
    });
    restartBridgeMock.mockResolvedValue({
      bridge: {
        pid: 4321,
        statePath: "D:/repo/.tap-comms/pids/bridge-codex.json",
        lastHeartbeat: "2026-03-28T00:00:00.000Z",
        appServer: retainedAppServer,
      },
      drained: true,
      forced: false,
    });

    const result = await bridgeCommand(["restart", "codex"]);

    expect(result.ok).toBe(true);
    expect(restartBridgeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        instanceId: "codex",
        existingAppServer: retainedAppServer,
      }),
    );
    expect(saveStateMock).toHaveBeenCalledWith(
      "D:/repo",
      expect.objectContaining({
        instances: expect.objectContaining({
          codex: expect.objectContaining({
            managedAppServer: retainedAppServer,
          }),
        }),
      }),
    );
  });

  it("passes --force through to restartBridge", async () => {
    restartBridgeMock.mockResolvedValue({
      bridge: {
        pid: 4321,
        statePath: "D:/repo/.tap-comms/pids/bridge-codex.json",
        lastHeartbeat: "2026-03-28T00:00:00.000Z",
        appServer: null,
      },
      drained: false,
      forced: true,
    });

    const result = await bridgeCommand([
      "restart",
      "codex",
      "--drain-timeout",
      "10",
      "--force",
    ]);

    expect(result.ok).toBe(true);
    expect(result.code).toBe("TAP_BRIDGE_RESTART_OK");
    expect(restartBridgeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        drainTimeoutSeconds: 10,
        force: true,
      }),
    );
    expect(result.data).toMatchObject({
      forced: true,
      drained: false,
    });
  });

  it("returns info result for external-managed bridges", async () => {
    resolveBridgeRestartPlanMock.mockReturnValue({
      kind: "external-managed",
      reason:
        "fresh bridge-dispatch heartbeat exists without a tracked bridge pid",
      evidence: "fresh bridge-dispatch heartbeat from PID 9911",
      manualHint:
        "Use the owning PowerShell/script manager to restart codex. Hint: Get-Process -Id 9911; Stop-Process -Id 9911",
      bridgeState: null,
      lifecycle: {
        presence: "stopped",
        status: "stopped",
        summary: "stopped",
        lastTransitionAt: null,
        lastTransitionReason: null,
        restartCount: 0,
        threadId: null,
        threadCwd: null,
        savedThreadId: null,
        savedThreadCwd: null,
        activeTurnId: null,
        connected: null,
        initialized: null,
        appServerHealthy: null,
      },
      liveDispatch: {
        bridgePid: 9911,
        lastActivity: "2026-04-18T08:00:00.000Z",
      },
    });

    const result = await bridgeCommand(["restart", "codex"]);

    expect(result.ok).toBe(true);
    expect(result.code).toBe("TAP_BRIDGE_RESTART_EXTERNAL");
    expect(restartBridgeMock).not.toHaveBeenCalled();
    expect(result.data).toMatchObject({
      restartKind: "external-managed",
      pid: 9911,
    });
  });

  it("returns blocked result while a startup is still initializing", async () => {
    resolveBridgeRestartPlanMock.mockReturnValue({
      kind: "blocked",
      reason: "bridge is initializing",
      manualHint:
        "Wait for bridge state to settle, then rerun: npx @hua-labs/tap bridge restart codex",
      bridgeState: null,
      lifecycle: {
        presence: "bridge-live",
        status: "initializing",
        summary: "bridge-live, initializing",
        lastTransitionAt: null,
        lastTransitionReason: null,
        restartCount: 0,
        threadId: null,
        threadCwd: null,
        savedThreadId: null,
        savedThreadCwd: null,
        activeTurnId: null,
        connected: true,
        initialized: false,
        appServerHealthy: null,
      },
      liveDispatch: null,
    });

    const result = await bridgeCommand(["restart", "codex"]);

    expect(result.ok).toBe(false);
    expect(result.code).toBe("TAP_BRIDGE_RESTART_BLOCKED");
    expect(restartBridgeMock).not.toHaveBeenCalled();
  });

  it("maps drain timeout errors to a restart-specific code", async () => {
    restartBridgeMock.mockRejectedValue(
      new BridgeDrainTimeoutError({
        instanceId: "codex",
        activeTurnId: "turn-123",
        turnState: "active",
        waitedMs: 10_000,
      }),
    );

    const result = await bridgeCommand(["restart", "codex"]);

    expect(result.ok).toBe(false);
    expect(result.code).toBe("TAP_BRIDGE_DRAIN_TIMEOUT");
    expect(result.data).toMatchObject({
      activeTurnId: "turn-123",
      turnState: "active",
      forced: false,
    });
  });
});
