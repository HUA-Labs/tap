import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppServerState, RuntimeAdapter, TapState } from "../types.js";

const loadStateMock = vi.fn();
const saveStateMock = vi.fn();
const updateInstanceStateMock = vi.fn();
const getAdapterMock = vi.fn();
const findRepoRootMock = vi.fn();
const createAdapterContextMock = vi.fn();
const resolveConfigMock = vi.fn();
const startBridgeMock = vi.fn();
const stopBridgeMock = vi.fn();
const getBridgeStatusMock = vi.fn();
const loadBridgeStateMock = vi.fn();
const getHeartbeatAgeMock = vi.fn();
const getBridgeHeartbeatTimestampMock = vi.fn();
const saveBridgeStateMock = vi.fn();
const stopManagedAppServerMock = vi.fn();
const findNextAvailableAppServerPortMock = vi.fn();

vi.mock("../state.js", () => ({
  loadState: loadStateMock,
  saveState: saveStateMock,
  updateInstanceState: updateInstanceStateMock,
}));

vi.mock("../adapters/index.js", () => ({
  getAdapter: getAdapterMock,
}));

vi.mock("../config/index.js", () => ({
  resolveConfig: resolveConfigMock,
}));

const checkAppServerHealthMock = vi.fn();

vi.mock("../engine/bridge.js", () => ({
  startBridge: startBridgeMock,
  stopBridge: stopBridgeMock,
  getBridgeStatus: getBridgeStatusMock,
  loadBridgeState: loadBridgeStateMock,
  getHeartbeatAge: getHeartbeatAgeMock,
  getBridgeHeartbeatTimestamp: getBridgeHeartbeatTimestampMock,
  saveBridgeState: saveBridgeStateMock,
  stopManagedAppServer: stopManagedAppServerMock,
  checkAppServerHealth: checkAppServerHealthMock,
  findNextAvailableAppServerPort: findNextAvailableAppServerPortMock,
  waitForPortRelease: vi.fn().mockResolvedValue(true),
  resolveAppServerUrl: (baseUrl: string | undefined, port?: number) => {
    const base = (baseUrl ?? "ws://127.0.0.1:4501").replace(/\/$/, "");
    if (port == null) return base;
    return base.replace(/:\d+$/, `:${port}`);
  },
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

function makeState(
  appServer?: AppServerState | null,
  overrides?: Partial<TapState["instances"]["codex"]>,
): TapState {
  return {
    schemaVersion: 2,
    createdAt: "2026-03-24T00:00:00.000Z",
    updatedAt: "2026-03-24T00:00:00.000Z",
    commsDir: "D:/repo/tap-comms",
    repoRoot: "D:/repo",
    packageVersion: "0.1.0",
    instances: {
      codex: {
        instanceId: "codex",
        runtime: "codex",
        agentName: null,
        port: 4510,
        installed: true,
        configPath: "D:/repo/.codex/config.json",
        bridgeMode: "app-server",
        restartRequired: false,
        ownedArtifacts: [],
        backupPath: "",
        lastAppliedHash: "",
        lastVerifiedAt: null,
        bridge: appServer
          ? {
              pid: 7001,
              statePath: "D:/repo/.tap-comms/pids/bridge-codex.json",
              lastHeartbeat: "2026-03-24T00:00:00.000Z",
              appServer,
            }
          : null,
        headless: null,
        warnings: [],
        ...overrides,
      },
    },
  };
}

describe("bridgeCommand auto app-server behavior", () => {
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
    startBridgeMock.mockResolvedValue({
      pid: 7001,
      statePath: "D:/repo/.tap-comms/pids/bridge-codex.json",
      lastHeartbeat: "2026-03-24T00:00:00.000Z",
      appServer: {
        url: "ws://127.0.0.1:4510",
        pid: 8123,
        managed: true,
        healthy: true,
        lastCheckedAt: "2026-03-24T00:00:00.000Z",
        lastHealthyAt: "2026-03-24T00:00:00.000Z",
        logPath: "D:/repo/.tap-comms/logs/app-server-codex.log",
        manualCommand: "codex app-server --listen ws://127.0.0.1:4510",
      },
    });
    stopBridgeMock.mockResolvedValue(true);
    loadBridgeStateMock.mockReturnValue(null);
    getHeartbeatAgeMock.mockReturnValue(null);
    getBridgeHeartbeatTimestampMock.mockReturnValue(null);
    getBridgeStatusMock.mockReturnValue("stopped");
    stopManagedAppServerMock.mockResolvedValue(true);
    checkAppServerHealthMock.mockResolvedValue(true);
    findNextAvailableAppServerPortMock.mockResolvedValue(4510);
  });

  it("enables app-server management by default for codex bridge start", async () => {
    loadStateMock.mockReturnValue(makeState());

    const result = await bridgeCommand([
      "start",
      "codex",
      "--agent-name",
      "ko",
    ]);

    expect(result.ok).toBe(true);
    expect(startBridgeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        instanceId: "codex",
        manageAppServer: true,
        appServerUrl: "ws://127.0.0.1:4510",
      }),
    );
    expect(result.data).toHaveProperty("appServer");
  });

  it("passes manageAppServer=false when --no-server is set", async () => {
    loadStateMock.mockReturnValue(makeState());

    const result = await bridgeCommand([
      "start",
      "codex",
      "--agent-name",
      "ko",
      "--no-server",
    ]);

    expect(result.ok).toBe(true);
    expect(startBridgeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        manageAppServer: false,
        appServerUrl: "ws://127.0.0.1:4510",
      }),
    );
  });

  it("auto-assigns a free managed app-server port when none is stored", async () => {
    loadStateMock.mockReturnValue(makeState(undefined, { port: null }));
    findNextAvailableAppServerPortMock.mockResolvedValue(4512);

    const result = await bridgeCommand([
      "start",
      "codex",
      "--agent-name",
      "ko",
    ]);

    expect(result.ok).toBe(true);
    expect(findNextAvailableAppServerPortMock).toHaveBeenCalledWith(
      expect.objectContaining({
        instances: expect.objectContaining({
          codex: expect.objectContaining({ port: null }),
        }),
      }),
      "ws://127.0.0.1:4501",
      4501,
      "codex",
    );
    expect(startBridgeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        port: 4512,
        appServerUrl: "ws://127.0.0.1:4512",
      }),
    );
    expect(saveStateMock).toHaveBeenCalledWith(
      "D:/repo",
      expect.objectContaining({
        instances: expect.objectContaining({
          codex: expect.objectContaining({ port: 4512 }),
        }),
      }),
    );
  });

  it("start --all assigns distinct ports per instance", async () => {
    let currentState: TapState = {
      ...makeState(undefined, { agentName: "온", port: null }),
      instances: {
        codex: {
          ...makeState(undefined, { agentName: "온", port: null }).instances
            .codex,
        },
        "codex-reviewer": {
          ...makeState(undefined, {
            instanceId: "codex-reviewer",
            agentName: "별",
            port: null,
          }).instances.codex,
          instanceId: "codex-reviewer",
          agentName: "별",
        },
      },
    };

    loadStateMock.mockImplementation(() => currentState);
    updateInstanceStateMock.mockImplementation(
      (state, instanceId, instance) => ({
        ...state,
        instances: {
          ...state.instances,
          [instanceId]: instance,
        },
      }),
    );
    saveStateMock.mockImplementation((_repoRoot, nextState) => {
      currentState = nextState;
    });
    findNextAvailableAppServerPortMock.mockImplementation(
      async (state: TapState, _baseUrl, _basePort, instanceId: string) => {
        expect(Object.values(state.instances).map((inst) => inst.port)).toEqual(
          instanceId === "codex" ? [null, null] : [4510, null],
        );
        return instanceId === "codex" ? 4510 : 4511;
      },
    );
    startBridgeMock.mockImplementation(
      async ({ instanceId, port }: { instanceId: string; port: number }) => ({
        pid: port + 1000,
        statePath: `D:/repo/.tap-comms/pids/bridge-${instanceId}.json`,
        lastHeartbeat: "2026-03-24T00:00:00.000Z",
        appServer: {
          url: `ws://127.0.0.1:${port}`,
          pid: port + 2000,
          managed: true,
          healthy: true,
          lastCheckedAt: "2026-03-24T00:00:00.000Z",
          lastHealthyAt: "2026-03-24T00:00:00.000Z",
          logPath: `D:/repo/.tap-comms/logs/app-server-${instanceId}.log`,
          manualCommand: `codex app-server --listen ws://127.0.0.1:${port}`,
        },
      }),
    );

    const result = await bridgeCommand(["start", "--all"]);

    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      started: ["codex", "codex-reviewer"],
      failed: [],
    });
    expect(startBridgeMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        instanceId: "codex",
        agentName: "온",
        port: 4510,
        appServerUrl: "ws://127.0.0.1:4510",
      }),
    );
    expect(startBridgeMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        instanceId: "codex-reviewer",
        agentName: "별",
        port: 4511,
        appServerUrl: "ws://127.0.0.1:4511",
      }),
    );
  });

  it("stops the managed app-server when the bridge is stopped", async () => {
    const appServer: AppServerState = {
      url: "ws://127.0.0.1:4510",
      pid: 8123,
      managed: true,
      healthy: true,
      lastCheckedAt: "2026-03-24T00:00:00.000Z",
      lastHealthyAt: "2026-03-24T00:00:00.000Z",
      logPath: "D:/repo/.tap-comms/logs/app-server-codex.log",
      manualCommand: "codex app-server --listen ws://127.0.0.1:4510",
    };
    loadStateMock.mockReturnValue(makeState(appServer));
    loadBridgeStateMock.mockReturnValue({
      pid: 7001,
      statePath: "D:/repo/.tap-comms/pids/bridge-codex.json",
      lastHeartbeat: "2026-03-24T00:00:00.000Z",
      appServer,
    });

    const result = await bridgeCommand(["stop", "codex"]);

    expect(result.ok).toBe(true);
    expect(stopManagedAppServerMock).toHaveBeenCalledWith(appServer, "win32");
    expect(result.data).toMatchObject({ appServerStopped: true });
  });
});
