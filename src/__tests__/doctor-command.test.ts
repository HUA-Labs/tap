import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { TapState } from "../types.js";

const loadStateMock = vi.fn();
const saveStateMock = vi.fn();
const getInstalledInstancesMock = vi.fn();
const isBridgeRunningMock = vi.fn();
const getHeartbeatAgeMock = vi.fn();
const loadBridgeStateMock = vi.fn();
const saveBridgeStateMock = vi.fn();
const resolveConfigMock = vi.fn();
const findRepoRootMock = vi.fn();
const logMock = vi.fn();
const logHeaderMock = vi.fn();
const logSuccessMock = vi.fn();
const logWarnMock = vi.fn();

vi.mock("../state.js", () => ({
  loadState: loadStateMock,
  saveState: saveStateMock,
  getInstalledInstances: getInstalledInstancesMock,
}));

vi.mock("../engine/bridge.js", () => ({
  isBridgeRunning: isBridgeRunningMock,
  getHeartbeatAge: getHeartbeatAgeMock,
  loadBridgeState: loadBridgeStateMock,
  saveBridgeState: saveBridgeStateMock,
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
    log: logMock,
    logHeader: logHeaderMock,
    logSuccess: logSuccessMock,
    logWarn: logWarnMock,
  };
});

vi.mock("../version.js", () => ({
  version: "0.2.0",
}));

const { doctorCommand } = await import("../commands/doctor.js");

describe("doctorCommand", () => {
  const createdDirs: string[] = [];
  let repoRoot: string;
  let commsDir: string;
  let stateDir: string;
  let runtimeStateDir: string;

  afterEach(() => {
    while (createdDirs.length > 0) {
      const dir = createdDirs.pop();
      if (dir) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  beforeEach(() => {
    vi.clearAllMocks();

    repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "doctor-repo-"));
    createdDirs.push(repoRoot);
    commsDir = path.join(repoRoot, "tap-comms");
    stateDir = path.join(repoRoot, ".tap-comms");
    runtimeStateDir = path.join(repoRoot, ".tmp", "codex-app-server-bridge");
    fs.mkdirSync(path.join(commsDir, "inbox"), { recursive: true });
    fs.mkdirSync(path.join(commsDir, "reviews"), { recursive: true });
    fs.mkdirSync(path.join(commsDir, "findings"), { recursive: true });
    fs.mkdirSync(runtimeStateDir, { recursive: true });
    fs.writeFileSync(
      path.join(commsDir, "inbox", "20260325-초-온-check.md"),
      "ping",
      "utf8",
    );
    fs.writeFileSync(
      path.join(runtimeStateDir, "heartbeat.json"),
      JSON.stringify({
        lastError:
          "Headless cold-start warmup failed: turn t1 finished with status failed.",
      }),
      "utf8",
    );

    const state: TapState = {
      schemaVersion: 2,
      createdAt: "2026-03-25T00:00:00.000Z",
      updatedAt: "2026-03-25T00:00:00.000Z",
      commsDir,
      repoRoot,
      packageVersion: "0.2.0",
      instances: {
        codex: {
          instanceId: "codex",
          runtime: "codex",
          agentName: "온",
          port: 4510,
          installed: true,
          configPath: path.join(repoRoot, ".codex", "config.toml"),
          bridgeMode: "app-server",
          restartRequired: false,
          ownedArtifacts: [],
          backupPath: "",
          lastAppliedHash: "",
          lastVerifiedAt: null,
          bridge: null,
          headless: null,
          warnings: [],
        },
      },
    };

    loadStateMock.mockReturnValue(state);
    getInstalledInstancesMock.mockReturnValue(["codex"]);
    isBridgeRunningMock.mockReturnValue(true);
    getHeartbeatAgeMock.mockReturnValue(1);
    loadBridgeStateMock.mockReturnValue({
      pid: 1234,
      statePath: path.join(stateDir, "pids", "bridge-codex.json"),
      lastHeartbeat: "2026-03-25T00:00:00.000Z",
      runtimeStateDir,
      appServer: null,
    });
    resolveConfigMock.mockReturnValue({
      config: {
        commsDir,
        stateDir,
      },
    });
    findRepoRootMock.mockReturnValue(repoRoot);
  });

  it("surfaces runtime heartbeat lastError as a doctor warning", async () => {
    const result = await doctorCommand([]);

    expect(result.ok).toBe(true);
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining("bridge last error"),
      ]),
    );
    expect(result.data).toEqual(
      expect.objectContaining({
        checks: expect.arrayContaining([
          expect.objectContaining({
            name: "bridge: codex",
            status: "warn",
          }),
        ]),
      }),
    );
  });
});
