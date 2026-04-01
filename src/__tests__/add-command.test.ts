import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RuntimeAdapter, TapState } from "../types.js";

const loadStateMock = vi.fn();
const saveStateMock = vi.fn();
const updateInstanceStateMock = vi.fn();
const ensureBackupDirMock = vi.fn();
const getAdapterMock = vi.fn();
const findRepoRootMock = vi.fn();
const createAdapterContextMock = vi.fn();
const startBridgeMock = vi.fn();
const resolveConfigMock = vi.fn();

vi.mock("../state.js", () => ({
  loadState: loadStateMock,
  saveState: saveStateMock,
  updateInstanceState: updateInstanceStateMock,
  ensureBackupDir: ensureBackupDirMock,
}));

vi.mock("../adapters/index.js", () => ({
  getAdapter: getAdapterMock,
}));

const findNextAvailableAppServerPortMock = vi.fn().mockResolvedValue(4501);

vi.mock("../engine/bridge.js", () => ({
  startBridge: startBridgeMock,
  findNextAvailableAppServerPort: findNextAvailableAppServerPortMock,
}));

vi.mock("../config/index.js", () => ({
  resolveConfig: resolveConfigMock,
}));

const createInstanceConfigMock = vi.fn().mockReturnValue({
  schemaVersion: 1,
  instanceId: "codex",
  runtime: "codex",
  agentName: null,
  configHash: "abcd1234",
  mcpEnv: {},
});
const saveInstanceConfigMock = vi
  .fn()
  .mockReturnValue("/mock/instances/codex.json");

vi.mock("../config/instance-config.js", () => ({
  createInstanceConfig: createInstanceConfigMock,
  saveInstanceConfig: saveInstanceConfigMock,
  loadInstanceConfig: vi.fn().mockReturnValue(null),
  updateInstanceConfig: vi.fn(),
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
    logWarn: vi.fn(),
    logError: vi.fn(),
    logHeader: vi.fn(),
  };
});

const { addCommand } = await import("../commands/add.js");

function makeState(): TapState {
  return {
    schemaVersion: 2,
    createdAt: "2026-03-24T00:00:00.000Z",
    updatedAt: "2026-03-24T00:00:00.000Z",
    commsDir: "D:/repo/tap-comms",
    repoRoot: "D:/repo",
    packageVersion: "0.1.0",
    instances: {},
  };
}

describe("addCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findRepoRootMock.mockReturnValue("D:/repo");
    createAdapterContextMock.mockReturnValue({
      commsDir: "D:/repo/tap-comms",
      repoRoot: "D:/repo",
      stateDir: "D:/repo/.tap-comms",
      platform: "win32",
    });
    loadStateMock.mockReturnValue(makeState());
    ensureBackupDirMock.mockReturnValue("D:/repo/.tap-comms/backups/codex");
    updateInstanceStateMock.mockImplementation(
      (state, instanceId, instance) => ({
        ...state,
        instances: {
          ...state.instances,
          [instanceId]: instance,
        },
      }),
    );
    resolveConfigMock.mockReturnValue({
      config: {
        repoRoot: "D:/repo",
        commsDir: "D:/repo/tap-comms",
        stateDir: "D:/repo/.tap-comms",
        runtimeCommand: "node",
        appServerUrl: "ws://127.0.0.1:4501",
      },
      sources: {
        repoRoot: "auto",
        commsDir: "auto",
        stateDir: "auto",
        runtimeCommand: "auto",
        appServerUrl: "auto",
      },
    });
  });

  it("fails when the adapter cannot produce any patch operations", async () => {
    const adapter: RuntimeAdapter = {
      runtime: "claude",
      probe: vi.fn().mockResolvedValue({
        installed: true,
        configPath: "D:/repo/.mcp.json",
        configExists: false,
        runtimeCommand: "claude",
        version: null,
        canWrite: true,
        warnings: [],
        issues: [
          "tap-comms MCP server entry not found. Reinstall @hua-labs/tap or run from a repo with packages/tap-plugin/channels/ available.",
        ],
      }),
      plan: vi.fn().mockResolvedValue({
        runtime: "claude",
        operations: [],
        ownedArtifacts: [],
        backupDir: "D:/repo/.tap-comms/backups/claude",
        restartRequired: false,
        conflicts: [],
        warnings: [],
      }),
      apply: vi.fn(),
      verify: vi.fn(),
      bridgeMode: () => "native-push",
    };

    getAdapterMock.mockReturnValue(adapter);

    const result = await addCommand(["claude"]);

    expect(result.ok).toBe(false);
    expect(result.code).toBe("TAP_LOCAL_SERVER_MISSING");
    expect(result.message).toContain("tap-comms MCP server entry not found");
  });

  it("defaults codex agent-name to the instance id and auto-starts the bridge", async () => {
    const bridgeState = {
      pid: 4321,
      statePath: "D:/repo/.tap-comms/pids/bridge-codex.json",
      lastHeartbeat: "2026-03-26T00:00:00.000Z",
    };
    const adapter: RuntimeAdapter = {
      runtime: "codex",
      probe: vi.fn().mockResolvedValue({
        installed: true,
        configPath: "C:/Users/test/.codex/config.toml",
        configExists: true,
        runtimeCommand: "codex.cmd",
        version: "0.0.1",
        canWrite: true,
        warnings: [],
        issues: [],
      }),
      plan: vi.fn().mockResolvedValue({
        runtime: "codex",
        operations: [{ type: "merge", path: "config.toml", key: "tap" }],
        ownedArtifacts: [],
        backupDir: "D:/repo/.tap-comms/backups/codex",
        restartRequired: true,
        conflicts: [],
        warnings: [],
      }),
      apply: vi.fn().mockResolvedValue({
        success: true,
        appliedOps: 1,
        backupCreated: true,
        lastAppliedHash: "abc123",
        ownedArtifacts: [],
        changedFiles: ["C:/Users/test/.codex/config.toml"],
        restartRequired: true,
        warnings: [],
      }),
      verify: vi.fn().mockResolvedValue({
        ok: true,
        checks: [],
        restartRequired: true,
        warnings: [],
      }),
      bridgeMode: () => "app-server",
      resolveBridgeScript: vi.fn().mockReturnValue("D:/repo/bridge.mjs"),
    };

    getAdapterMock.mockReturnValue(adapter);
    startBridgeMock.mockResolvedValue(bridgeState);

    const result = await addCommand(["codex"]);

    expect(result.ok).toBe(true);
    expect(result.code).toBe("TAP_ADD_OK");
    expect(startBridgeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        instanceId: "codex",
        runtime: "codex",
        agentName: "codex",
      }),
    );
    expect(updateInstanceStateMock).toHaveBeenCalledWith(
      expect.anything(),
      "codex",
      expect.objectContaining({
        agentName: "codex",
        bridge: bridgeState,
      }),
    );
  });

  it("updates the stored agent-name on an installed codex instance without --force", async () => {
    const state = makeState();
    state.instances.codex = {
      instanceId: "codex",
      runtime: "codex",
      agentName: null,
      port: null,
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
    };
    loadStateMock.mockReturnValue(state);

    const probe = vi.fn();
    getAdapterMock.mockReturnValue({
      runtime: "codex",
      probe,
      plan: vi.fn(),
      apply: vi.fn(),
      verify: vi.fn(),
      bridgeMode: () => "app-server",
      resolveBridgeScript: vi.fn(),
    } satisfies RuntimeAdapter);

    const result = await addCommand(["codex", "--agent-name", "reviewer"]);

    expect(result.ok).toBe(true);
    expect(result.code).toBe("TAP_ADD_OK");
    expect(result.message).toContain('agent name updated to "reviewer"');
    expect(updateInstanceStateMock).toHaveBeenCalledWith(
      state,
      "codex",
      expect.objectContaining({
        agentName: "reviewer",
      }),
    );
    expect(saveStateMock).toHaveBeenCalledTimes(1);
    expect(startBridgeMock).not.toHaveBeenCalled();
    expect(probe).not.toHaveBeenCalled();
  });
});
