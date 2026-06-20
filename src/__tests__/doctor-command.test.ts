import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { TapState } from "../types.js";

const mockHomeDir = vi.fn();
const loadStateMock = vi.fn();
const saveStateMock = vi.fn();
const getInstalledInstancesMock = vi.fn();
const isBridgeRunningMock = vi.fn();
const getHeartbeatAgeMock = vi.fn();
const loadBridgeStateMock = vi.fn();
const saveBridgeStateMock = vi.fn();
const loadRuntimeBridgeHeartbeatMock = vi.fn(
  (bridgeState?: { runtimeStateDir?: string | null }) => {
    const runtimeStateDir = bridgeState?.runtimeStateDir;
    if (!runtimeStateDir) return null;
    const heartbeatPath = path.join(runtimeStateDir, "heartbeat.json");
    if (!fs.existsSync(heartbeatPath)) return null;
    return JSON.parse(fs.readFileSync(heartbeatPath, "utf8")) as {
      lastError?: string | null;
      threadId?: string | null;
      threadCwd?: string | null;
    };
  },
);
const loadRuntimeBridgeThreadStateMock = vi.fn(
  (bridgeState?: { runtimeStateDir?: string | null }) => {
    const runtimeStateDir = bridgeState?.runtimeStateDir;
    if (!runtimeStateDir) return null;
    const threadPath = path.join(runtimeStateDir, "thread.json");
    if (!fs.existsSync(threadPath)) return null;
    return JSON.parse(fs.readFileSync(threadPath, "utf8")) as {
      threadId?: string;
      cwd?: string | null;
    };
  },
);
const resolveConfigMock = vi.fn();
const findRepoRootMock = vi.fn();
const logMock = vi.fn();
const logHeaderMock = vi.fn();
const logSuccessMock = vi.fn();
const logWarnMock = vi.fn();
const buildManagedMcpServerSpecMock = vi.fn();
const probeCommandMock = vi.fn();

function getMockStatePath(repoRoot: string): string {
  return path.join(repoRoot, ".tap-comms", "state.json");
}

function createInitialStateMock(
  commsDir: string,
  repoRoot: string,
  packageVersion: string,
): TapState {
  const timestamp = new Date().toISOString();
  return {
    schemaVersion: 3,
    createdAt: timestamp,
    updatedAt: timestamp,
    commsDir,
    repoRoot,
    packageVersion,
    instances: {},
  };
}

function writeSetupState(repoRoot: string, state: TapState): void {
  const statePath = getMockStatePath(repoRoot);
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

vi.mock("node:os", async () => {
  const actual = await vi.importActual<typeof import("node:os")>("node:os");
  return {
    ...actual,
    homedir: () => mockHomeDir(),
  };
});

vi.mock("../state.js", () => ({
  loadState: loadStateMock,
  saveState: writeSetupState,
  getInstalledInstances: getInstalledInstancesMock,
  createInitialState: createInitialStateMock,
  getStatePath: getMockStatePath,
}));

vi.mock("../engine/bridge.js", () => ({
  isBridgeRunning: isBridgeRunningMock,
  getHeartbeatAge: getHeartbeatAgeMock,
  loadBridgeState: loadBridgeStateMock,
  loadRuntimeBridgeHeartbeat: loadRuntimeBridgeHeartbeatMock,
  loadRuntimeBridgeThreadState: loadRuntimeBridgeThreadStateMock,
  saveBridgeState: saveBridgeStateMock,
}));

vi.mock("../config/index.js", async () => {
  const actual =
    await vi.importActual<typeof import("../config/index.js")>(
      "../config/index.js",
    );
  return {
    ...actual,
    resolveConfig: resolveConfigMock,
  };
});

vi.mock("../adapters/common.js", async () => {
  const actual = await vi.importActual<typeof import("../adapters/common.js")>(
    "../adapters/common.js",
  );
  return {
    ...actual,
    buildManagedMcpServerSpec: buildManagedMcpServerSpecMock,
    getCodexConfigPath: () => path.join(mockHomeDir(), ".codex", "config.toml"),
    probeCommand: probeCommandMock,
  };
});

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

function writeProfilePack(filePath: string, options: { valid?: boolean } = {}) {
  const valid = options.valid !== false;
  fs.writeFileSync(
    filePath,
    `${JSON.stringify(
      {
        schemaVersion: "tap-profile-pack.v0",
        packId: "doctor-pack",
        label: "Doctor Profile Pack",
        profiles: [
          {
            id: "doctor-cli",
            label: "Doctor CLI",
            runtimeSurface: "codex-cli",
            agent: "doctor",
            paths: {
              repoRoot: "/doctor/repo",
              commsDir: "/doctor/comms",
            },
            capabilities: {
              ready: true,
              status: true,
              apply: false,
            },
            commands: {
              ready: {
                shell: valid
                  ? "echo doctor-profile-pack-command-sentinel"
                  : "echo invalid-doctor-profile-pack-command-sentinel",
                risk: "read-only",
                reviewRequired: valid,
                defaultEnabled: false,
              },
            },
            ready: {
              surface: "codex-cli",
              commandRef: "ready",
            },
          },
        ],
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

describe("doctorCommand", () => {
  const createdDirs: string[] = [];
  let repoRoot: string;
  let commsDir: string;
  let stateDir: string;
  let runtimeStateDir: string;
  let codexHomeDir: string;

  function canonicalizeTrustPath(targetPath: string): string {
    let resolved = path.resolve(targetPath).replace(/\//g, "\\");
    const driveRoot = /^[A-Za-z]:\\$/;
    if (!driveRoot.test(resolved)) {
      resolved = resolved.replace(/\\+$/g, "");
    }
    return resolved.startsWith("\\\\?\\") ? resolved : `\\\\?\\${resolved}`;
  }

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
    codexHomeDir = fs.mkdtempSync(path.join(os.tmpdir(), "doctor-home-"));
    createdDirs.push(codexHomeDir);
    mockHomeDir.mockReturnValue(codexHomeDir);
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
          defaultAgentName: "온",
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
    resolveConfigMock.mockImplementation(
      (overrides: { commsDir?: string; stateDir?: string } = {}) => ({
        config: {
          commsDir: overrides.commsDir ?? commsDir,
          stateDir: overrides.stateDir ?? stateDir,
        },
      }),
    );
    findRepoRootMock.mockReturnValue(repoRoot);
    probeCommandMock.mockImplementation((candidates: string[]) => ({
      command: candidates[0] ?? null,
      version: "1.0.0",
    }));
    buildManagedMcpServerSpecMock.mockReturnValue({
      command: "bun",
      args: ["server.ts"],
      env: {
        TAP_AGENT_NAME: "<set-per-session>",
        TAP_COMMS_DIR: commsDir.replace(/\\/g, "/"),
        TAP_STATE_DIR: stateDir.replace(/\\/g, "/"),
        TAP_REPO_ROOT: repoRoot.replace(/\\/g, "/"),
      },
      sourcePath: "/fake/server.ts",
      warnings: [],
      issues: [],
    });

    const codexConfigPath = path.join(codexHomeDir, ".codex", "config.toml");
    fs.mkdirSync(path.dirname(codexConfigPath), { recursive: true });
    fs.writeFileSync(
      codexConfigPath,
      [
        "[mcp_servers.tap]",
        'command = "bun"',
        'args = ["server.ts"]',
        "",
        "[mcp_servers.tap.env]",
        'TAP_AGENT_NAME = "<set-per-session>"',
        `TAP_COMMS_DIR = "${commsDir.replace(/\\/g, "/")}"`,
        `TAP_STATE_DIR = "${stateDir.replace(/\\/g, "/")}"`,
        `TAP_REPO_ROOT = "${repoRoot.replace(/\\/g, "/")}"`,
        "",
        `[projects.'${canonicalizeTrustPath(repoRoot)}']`,
        'trust_level = "trusted"',
        "",
        `[projects.'${canonicalizeTrustPath(process.cwd())}']`,
        'trust_level = "trusted"',
        "",
      ].join("\n"),
      "utf8",
    );
  });

  it("documents setup profile-pack validation in doctor help", async () => {
    const result = await doctorCommand(["--help"]);

    expect(result.ok).toBe(true);
    expect(result.message).toContain("--profile-pack <path>");
    expect(result.message).toContain(
      "Validate a profile pack as data-only setup context",
    );
    expect(result.message).toContain(
      "tap doctor --setup --profile codex-cli --profile-pack ./tap-profile-pack.json --json",
    );
  });

  it("returns a read-only setup doctor report without running infrastructure checks", async () => {
    const result = await doctorCommand([
      "--setup",
      "--profile",
      "codex-cli",
      "--comms-dir",
      path.join(repoRoot, "custom-comms"),
    ]);

    expect(result.ok).toBe(true);
    expect(result.code).toBe("TAP_DOCTOR_SETUP_OK");
    expect(loadStateMock).not.toHaveBeenCalled();
    expect(result.data).toMatchObject({
      command: "doctor",
      mode: "setup",
      profile: "codex-cli",
      dryRun: true,
      apply: false,
      status: "partial",
      environment: {
        repoRoot: repoRoot.replace(/\\/g, "/"),
        commsDir: path.join(repoRoot, "custom-comms").replace(/\\/g, "/"),
      },
      setupReport: {
        command: "setup",
        profile: "codex-cli",
      },
      residual: expect.arrayContaining([
        expect.objectContaining({
          id: "delivery-doctor-separated",
          severity: "info",
        }),
      ]),
    });
    const phases = (
      result.data as {
        phases: Array<{
          id: string;
          actions: Array<{
            risk: string;
            defaultEnabled: boolean;
            appliesWith: string;
          }>;
        }>;
      }
    ).phases;
    expect(phases.map((phase) => phase.id)).not.toContain("delivery");
    expect(phases.map((phase) => phase.id)).not.toContain("doctor");
    const processActions = phases
      .flatMap((phase) => phase.actions)
      .filter((action) =>
        ["process-start", "process-restart"].includes(action.risk),
      );
    expect(processActions).not.toEqual([]);
    expect(processActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          defaultEnabled: false,
          appliesWith: "future-explicit-flag",
        }),
      ]),
    );
    const nextActions = (result.data as { nextActions: Array<{ id: string }> })
      .nextActions;
    expect(nextActions.map((action) => action.id)).not.toContain(
      "run-setup-doctor",
    );
    expect(fs.existsSync(path.join(repoRoot, "custom-comms"))).toBe(false);
  });

  it("accepts equals-form setup doctor flags", async () => {
    const customCommsDir = path.join(repoRoot, "custom-comms-equals");
    const result = await doctorCommand([
      "--setup",
      "--profile=codex-cli",
      `--comms-dir=${customCommsDir}`,
    ]);

    expect(result.ok).toBe(true);
    expect(result.code).toBe("TAP_DOCTOR_SETUP_OK");
    expect(loadStateMock).not.toHaveBeenCalled();
    expect(result.data).toMatchObject({
      command: "doctor",
      mode: "setup",
      profile: "codex-cli",
      environment: {
        commsDir: customCommsDir.replace(/\\/g, "/"),
      },
    });
    expect(fs.existsSync(customCommsDir)).toBe(false);
  });

  it("passes profile-pack validation through setup doctor reports", async () => {
    const profilePackPath = path.join(repoRoot, "doctor-profile-pack.json");
    writeProfilePack(profilePackPath);

    const result = await doctorCommand([
      "--setup",
      "--profile=codex-cli",
      `--profile-pack=${profilePackPath}`,
    ]);

    expect(result.ok).toBe(true);
    expect(result.code).toBe("TAP_DOCTOR_SETUP_OK");
    expect(loadStateMock).not.toHaveBeenCalled();
    expect(result.data).toMatchObject({
      command: "doctor",
      mode: "setup",
      environment: {
        profilePack: {
          summary: expect.objectContaining({
            path: profilePackPath.replace(/\\/g, "/"),
            status: "valid",
            packId: "doctor-pack",
            profileIds: ["doctor-cli"],
          }),
        },
      },
      phases: expect.arrayContaining([
        expect.objectContaining({
          id: "config",
          checks: expect.arrayContaining([
            expect.objectContaining({
              id: "profile-pack-validation",
              status: "pass",
            }),
          ]),
        }),
      ]),
      setupReport: {
        applyPlan: expect.objectContaining({
          guards: expect.arrayContaining([
            expect.objectContaining({
              id: "guard-profile-pack-validation",
              status: "pass",
            }),
          ]),
        }),
      },
    });
    expect(JSON.stringify(result.data)).not.toContain(
      "doctor-profile-pack-command-sentinel",
    );
  });

  it("includes codex-app route health in setup doctor without delivery phases", async () => {
    const presencePath = path.join(commsDir, "presence", "app-agent.json");
    fs.mkdirSync(path.dirname(presencePath), { recursive: true });
    fs.writeFileSync(
      presencePath,
      JSON.stringify(
        {
          timestamp: new Date().toISOString(),
          receiveTransports: ["consent-drive"],
          address: {
            conversationId: "thread-live",
            ownerClientId: "owner-live",
          },
          consentDriveStatus: "ready",
          health: { status: "ready" },
        },
        null,
        2,
      ),
      "utf8",
    );

    const result = await doctorCommand([
      "--setup",
      "--profile=codex-app",
      "--agent=app-agent",
    ]);

    expect(result.ok).toBe(true);
    expect(result.code).toBe("TAP_DOCTOR_SETUP_OK");
    expect(loadStateMock).not.toHaveBeenCalled();
    expect(result.data).toMatchObject({
      command: "doctor",
      mode: "setup",
      profile: "codex-app",
      environment: {
        agent: "app-agent",
      },
      phases: expect.arrayContaining([
        expect.objectContaining({
          id: "runtime",
          status: "pass",
          checks: expect.arrayContaining([
            expect.objectContaining({
              id: "codex-app-route-tuple",
              status: "pass",
            }),
            expect.objectContaining({
              id: "codex-app-runtime-health",
              status: "pass",
            }),
          ]),
        }),
      ]),
    });
    const phaseIds = (
      result.data as { phases: Array<{ id: string }> }
    ).phases.map((phase) => phase.id);
    expect(phaseIds).not.toContain("delivery");
    expect(phaseIds).not.toContain("doctor");
  });

  it("includes claude-channel readiness in setup doctor without delivery phases", async () => {
    const presencePath = path.join(commsDir, "presence", "claude-agent.json");
    fs.mkdirSync(path.dirname(presencePath), { recursive: true });
    fs.writeFileSync(
      presencePath,
      JSON.stringify(
        {
          timestamp: new Date().toISOString(),
          receiveTransports: ["mcp-channel"],
          health: { status: "ready" },
        },
        null,
        2,
      ),
      "utf8",
    );

    const result = await doctorCommand([
      "--setup",
      "--profile=claude-channel",
      "--agent=claude-agent",
    ]);

    expect(result.ok).toBe(true);
    expect(result.code).toBe("TAP_DOCTOR_SETUP_OK");
    expect(loadStateMock).not.toHaveBeenCalled();
    expect(result.data).toMatchObject({
      command: "doctor",
      mode: "setup",
      profile: "claude-channel",
      environment: {
        agent: "claude-agent",
      },
      phases: expect.arrayContaining([
        expect.objectContaining({
          id: "runtime",
          status: "pass",
          checks: expect.arrayContaining([
            expect.objectContaining({
              id: "claude-channel-transport",
              status: "pass",
            }),
            expect.objectContaining({
              id: "claude-channel-runtime-health",
              status: "pass",
            }),
            expect.objectContaining({
              id: "claude-channel-durable-evidence",
              status: "pass",
            }),
          ]),
        }),
      ]),
    });
    const phaseIds = (
      result.data as { phases: Array<{ id: string }> }
    ).phases.map((phase) => phase.id);
    expect(phaseIds).not.toContain("delivery");
    expect(phaseIds).not.toContain("doctor");
  });

  it("reuses setup apply plan from setup doctor apply without running the infrastructure fixer", async () => {
    const result = await doctorCommand([
      "--setup",
      "--profile",
      "codex-cli",
      "--apply",
    ]);

    expect(result.ok).toBe(true);
    expect(result.code).toBe("TAP_DOCTOR_SETUP_OK");
    expect(loadStateMock).not.toHaveBeenCalled();
    expect(saveStateMock).not.toHaveBeenCalled();
    expect(result.data).toMatchObject({
      command: "doctor",
      mode: "setup",
      dryRun: false,
      apply: true,
      status: "partial",
      residual: expect.arrayContaining([
        expect.objectContaining({
          id: "doctor-setup-apply-reuses-setup-plan",
          severity: "info",
          message:
            "`tap doctor --setup --apply` reuses the same guarded SetupApplyPlan as `tap setup --apply`; it does not run the broad infrastructure fixer.",
        }),
      ]),
      setupReport: {
        applyPlan: expect.objectContaining({
          status: "applied",
          mutations: expect.arrayContaining([
            expect.objectContaining({
              kind: "json-file-create",
              targetPath: path.join(repoRoot, ".mcp.json").replace(/\\/g, "/"),
              status: "applied",
            }),
          ]),
        }),
      },
    });
    expect(fs.existsSync(path.join(repoRoot, ".mcp.json"))).toBe(true);
    expect(fs.statSync(stateDir).isDirectory()).toBe(true);
  });

  it("reuses setup apply plan from setup doctor --fix without running infrastructure repair", async () => {
    const result = await doctorCommand([
      "--setup",
      "--profile",
      "codex-cli",
      "--fix",
    ]);

    expect(result.ok).toBe(true);
    expect(result.code).toBe("TAP_DOCTOR_SETUP_OK");
    expect(loadStateMock).not.toHaveBeenCalled();
    expect(saveStateMock).not.toHaveBeenCalled();
    expect(result.data).toMatchObject({
      command: "doctor",
      mode: "setup",
      apply: true,
      status: "partial",
      setupReport: {
        applyPlan: expect.objectContaining({
          status: "applied",
        }),
      },
    });
    expect(fs.existsSync(path.join(repoRoot, ".mcp.json"))).toBe(true);
  });

  it("fails closed from setup doctor apply when setup apply guards block", async () => {
    fs.writeFileSync(
      path.join(repoRoot, ".mcp.json"),
      JSON.stringify(
        {
          mcpServers: {
            tap: {
              command: "node",
              args: ["custom-server.js"],
              env: { USER_VALUE: "do-not-print" },
            },
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    const result = await doctorCommand([
      "--setup",
      "--profile=codex-cli",
      "--apply",
    ]);

    expect(result.ok).toBe(false);
    expect(result.code).toBe("TAP_DOCTOR_SETUP_APPLY_BLOCKED");
    expect(loadStateMock).not.toHaveBeenCalled();
    expect(saveStateMock).not.toHaveBeenCalled();
    expect(result.data).toMatchObject({
      command: "doctor",
      mode: "setup",
      apply: true,
      status: "blocked",
      setupReport: {
        applyPlan: expect.objectContaining({
          status: "blocked",
          guards: expect.arrayContaining([
            expect.objectContaining({
              status: "fail",
              message:
                "repo .mcp.json mcpServers.tap exists but is not recognizably tap-managed",
            }),
          ]),
        }),
      },
    });
    expect(fs.existsSync(stateDir)).toBe(false);
    expect(fs.readFileSync(path.join(repoRoot, ".mcp.json"), "utf8")).toContain(
      "custom-server.js",
    );
  });

  it("fails closed from setup doctor apply when profile pack validation fails", async () => {
    const profilePackPath = path.join(repoRoot, "invalid-doctor-pack.json");
    writeProfilePack(profilePackPath, { valid: false });

    const result = await doctorCommand([
      "--setup",
      "--profile=codex-cli",
      "--apply",
      `--profile-pack=${profilePackPath}`,
    ]);

    expect(result.ok).toBe(false);
    expect(result.code).toBe("TAP_DOCTOR_SETUP_APPLY_BLOCKED");
    expect(loadStateMock).not.toHaveBeenCalled();
    expect(saveStateMock).not.toHaveBeenCalled();
    expect(result.data).toMatchObject({
      command: "doctor",
      mode: "setup",
      status: "blocked",
      setupReport: {
        applyPlan: expect.objectContaining({
          status: "blocked",
          guards: expect.arrayContaining([
            expect.objectContaining({
              id: "guard-profile-pack-validation",
              status: "fail",
            }),
          ]),
          mutations: expect.arrayContaining([
            expect.objectContaining({
              id: "validate-profile-pack",
              status: "blocked",
            }),
            expect.objectContaining({
              kind: "directory-create",
              targetPath: stateDir.replace(/\\/g, "/"),
              status: "blocked",
            }),
            expect.objectContaining({
              kind: "json-file-create",
              targetPath: path.join(repoRoot, ".mcp.json").replace(/\\/g, "/"),
              status: "blocked",
            }),
          ]),
        }),
      },
    });
    const nextActions = (
      result.data as {
        nextActions: Array<{
          id: string;
          command?: string;
          file?: string;
          reason?: string;
        }>;
      }
    ).nextActions;
    expect(nextActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "review-blocked-setup",
          command: undefined,
          reason:
            "setup is fail-closed; repair the blocker or choose an explicit manual path before rerunning apply",
        }),
        expect.objectContaining({
          id: "repair-profile-pack-data",
          command: `tap setup --profile codex-cli --profile-pack ${profilePackPath} --json`,
          file: profilePackPath,
        }),
        expect.objectContaining({
          id: "run-comms-doctor",
          command: "tap comms-doctor --json",
        }),
      ]),
    );
    expect(nextActions.map((action) => action.id)).not.toContain(
      "run-setup-doctor",
    );
    expect(nextActions.map((action) => action.id)).not.toContain(
      "apply-reviewed-setup",
    );
    expect(fs.existsSync(stateDir)).toBe(false);
    expect(fs.existsSync(path.join(repoRoot, ".mcp.json"))).toBe(false);
    expect(JSON.stringify(result.data)).not.toContain(
      "invalid-doctor-profile-pack-command-sentinel",
    );
  });

  it("rejects unknown setup doctor profiles before infrastructure checks", async () => {
    const result = await doctorCommand([
      "--setup",
      "--profile",
      "sumback-yoon",
    ]);

    expect(result.ok).toBe(false);
    expect(result.code).toBe("TAP_INVALID_ARGUMENT");
    expect(result.message).toContain("Unknown setup profile");
    expect(loadStateMock).not.toHaveBeenCalled();
  });

  it("warns about legacy tap-comms MCP key in .mcp.json", async () => {
    // Write .mcp.json with old "tap-comms" key
    fs.writeFileSync(
      path.join(repoRoot, ".mcp.json"),
      JSON.stringify({
        mcpServers: {
          "tap-comms": {
            command: "bun",
            args: ["server.ts"],
            env: { TAP_COMMS_DIR: commsDir },
          },
        },
      }),
      "utf-8",
    );

    const result = await doctorCommand([]);

    const checks = result.data?.checks as Array<{
      name: string;
      status: string;
      message?: string;
    }>;
    const mcpCheck = checks?.find(
      (c) =>
        c.name === "MCP config (.mcp.json)" && c.message?.includes("Legacy"),
    );
    expect(mcpCheck).toBeDefined();
    expect(mcpCheck?.status).toBe("warn");
    expect(mcpCheck?.message).toContain("tap-comms");
  });

  it("uses new tap key when both old and new keys coexist", async () => {
    fs.writeFileSync(
      path.join(repoRoot, ".mcp.json"),
      JSON.stringify({
        mcpServers: {
          "tap-comms": {
            command: "old-legacy-runner",
            args: ["old.ts"],
            env: { TAP_COMMS_DIR: commsDir },
          },
          tap: {
            command: "new-tap-runner",
            args: ["new.ts"],
            cwd: repoRoot,
            env: { TAP_COMMS_DIR: commsDir },
          },
        },
      }),
      "utf-8",
    );

    const result = await doctorCommand([]);

    const checks = result.data?.checks as Array<{
      name: string;
      status: string;
      message?: string;
    }>;
    // Should warn about legacy key
    const legacyCheck = checks?.find(
      (c) =>
        c.name === "MCP config (.mcp.json)" && c.message?.includes("Legacy"),
    );
    expect(legacyCheck).toBeDefined();
    // Should use NEW key's command, not legacy key's command
    const commandCheck = checks?.find(
      (c) =>
        c.name === "MCP config (.mcp.json)" &&
        c.message?.includes("new-tap-runner"),
    );
    expect(commandCheck).toBeDefined();
    // Should NOT show legacy command as the active one
    const legacyCommandCheck = checks?.find(
      (c) =>
        c.name === "MCP config (.mcp.json)" &&
        c.message?.includes("old-legacy-runner"),
    );
    expect(legacyCommandCheck).toBeUndefined();
  });

  it("warns instead of failing when a fresh inbox has no messages yet", async () => {
    fs.rmSync(path.join(commsDir, "inbox", "20260325-초-온-check.md"), {
      force: true,
    });

    const result = await doctorCommand([]);

    const checks = result.data?.checks as Array<{
      name: string;
      status: string;
      message?: string;
    }>;
    const messageFlowCheck = checks.find((c) => c.name === "message flow");

    expect(result.ok).toBe(true);
    expect(messageFlowCheck?.status).toBe("warn");
    expect(messageFlowCheck?.message).toContain("0 total");
    expect(messageFlowCheck?.message).toContain(
      "expected before first exchange",
    );
  });

  it("accepts npx package launchers in .mcp.json", async () => {
    fs.writeFileSync(
      path.join(repoRoot, ".mcp.json"),
      JSON.stringify({
        mcpServers: {
          tap: {
            command: "npx",
            args: ["@hua-labs/tap", "serve"],
            cwd: repoRoot,
            env: { TAP_COMMS_DIR: commsDir },
          },
        },
      }),
      "utf-8",
    );

    const result = await doctorCommand([]);

    const checks = result.data?.checks as Array<{
      name: string;
      status: string;
      message?: string;
    }>;
    const scriptCheck = checks.find((c) => c.name === "MCP server script");

    expect(scriptCheck?.status).toBe("pass");
    expect(scriptCheck?.message).toContain("npx @hua-labs/tap serve");
  });

  it("surfaces runtime heartbeat lastError as a doctor warning", async () => {
    const result = await doctorCommand([]);

    expect(result.ok).toBe(true);
    expect(result.warnings).toEqual(
      expect.arrayContaining([expect.stringContaining("bridge last error")]),
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

  it("treats default-name live dispatch evidence as a running bridge", async () => {
    isBridgeRunningMock.mockReturnValue(false);
    loadBridgeStateMock.mockReturnValue(null);
    const state = loadStateMock() as TapState;
    if (state?.instances.codex) {
      state.instances.codex.defaultAgentName = "윤";
    }
    fs.writeFileSync(
      path.join(commsDir, "heartbeats.json"),
      JSON.stringify(
        {
          윤: {
            id: "윤",
            agent: "윤",
            timestamp: new Date().toISOString(),
            lastActivity: new Date().toISOString(),
            status: "active",
            source: "bridge-dispatch",
            instanceId: "윤",
            bridgePid: process.pid,
            connectHash: "instance:윤",
            address: {
              routingAddress: "윤",
              aliases: ["윤"],
            },
          },
        },
        null,
        2,
      ),
      "utf-8",
    );

    const result = await doctorCommand([]);

    expect(result.ok).toBe(true);
    expect(result.data).toEqual(
      expect.objectContaining({
        checks: expect.arrayContaining([
          expect.objectContaining({
            name: "bridge: codex",
            status: "pass",
            message: expect.stringContaining("Live dispatch PID"),
          }),
        ]),
      }),
    );
  });

  it("warns when saved and active thread state diverge from the repo cwd", async () => {
    fs.writeFileSync(
      path.join(runtimeStateDir, "heartbeat.json"),
      JSON.stringify({
        threadId: "thread-active",
        threadCwd: path.join(repoRoot, "..", "other"),
      }),
      "utf8",
    );
    fs.writeFileSync(
      path.join(runtimeStateDir, "thread.json"),
      JSON.stringify({
        threadId: "thread-saved",
        updatedAt: "2026-03-25T00:00:00.000Z",
        appServerUrl: "ws://127.0.0.1:4510",
        ephemeral: false,
        cwd: path.join(repoRoot, "..", "other"),
      }),
      "utf8",
    );

    const result = await doctorCommand([]);

    expect(result.ok).toBe(true);
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining("saved thread cwd mismatch"),
        expect.stringContaining(
          "saved thread thread-saved differs from active thread thread-active",
        ),
        expect.stringContaining("active thread cwd mismatch"),
      ]),
    );
  });

  it("warns when Codex config env paths drift from the current repo", async () => {
    const codexConfigPath = path.join(codexHomeDir, ".codex", "config.toml");
    fs.writeFileSync(
      codexConfigPath,
      [
        "[mcp_servers.tap]",
        'command = "bun"',
        'args = ["server.ts"]',
        "",
        "[mcp_servers.tap.env]",
        'TAP_AGENT_NAME = "온"',
        'TAP_AGENT_ID = "codex"',
        'TAP_COMMS_DIR = "C:/tap-ceo-test/hua-comms"',
        'TAP_STATE_DIR = "C:/tap-ceo-test/.tap-comms"',
        'TAP_REPO_ROOT = "C:/tap-ceo-test"',
        "",
      ].join("\n"),
      "utf8",
    );

    const result = await doctorCommand([]);

    const checks = result.data?.checks as Array<{
      name: string;
      status: string;
      message?: string;
    }>;
    const codexCheck = checks.find(
      (c) => c.name === "MCP config (Codex config.toml)",
    );
    expect(codexCheck).toBeDefined();
    expect(codexCheck?.status).toBe("warn");
    expect(codexCheck?.message).toContain("TAP_COMMS_DIR drift");
    expect(codexCheck?.message).toContain("TAP_REPO_ROOT drift");
    expect(codexCheck?.message).toContain("missing trust");
  });

  it("warns when Codex config launcher command or args drift from the managed spec", async () => {
    const codexConfigPath = path.join(codexHomeDir, ".codex", "config.toml");
    fs.writeFileSync(
      codexConfigPath,
      [
        "[mcp_servers.tap]",
        'command = "node"',
        'args = ["old-server.ts"]',
        "",
        "[mcp_servers.tap.env]",
        'TAP_AGENT_NAME = "온"',
        'TAP_AGENT_ID = "codex"',
        `TAP_COMMS_DIR = "${commsDir.replace(/\\/g, "/")}"`,
        `TAP_STATE_DIR = "${stateDir.replace(/\\/g, "/")}"`,
        `TAP_REPO_ROOT = "${repoRoot.replace(/\\/g, "/")}"`,
        "",
        `[projects.'${canonicalizeTrustPath(repoRoot)}']`,
        'trust_level = "trusted"',
        "",
        `[projects.'${canonicalizeTrustPath(process.cwd())}']`,
        'trust_level = "trusted"',
        "",
      ].join("\n"),
      "utf8",
    );

    const result = await doctorCommand([]);

    const checks = result.data?.checks as Array<{
      name: string;
      status: string;
      message?: string;
    }>;
    const codexCheck = checks.find(
      (c) => c.name === "MCP config (Codex config.toml)",
    );
    expect(codexCheck?.status).toBe("warn");
    expect(codexCheck?.message).toContain("tap MCP command drift (node)");
    expect(codexCheck?.message).toContain(
      'tap MCP args drift (["old-server.ts"])',
    );
  });

  it("warns when Codex config still uses legacy tap-comms tables", async () => {
    const codexConfigPath = path.join(codexHomeDir, ".codex", "config.toml");
    fs.writeFileSync(
      codexConfigPath,
      [
        "[mcp_servers.tap-comms]",
        'command = "bun"',
        'args = ["server.ts"]',
        "",
        "[mcp_servers.tap-comms.env]",
        'TAP_AGENT_NAME = "온"',
        'TAP_AGENT_ID = "codex"',
        `TAP_COMMS_DIR = "${commsDir.replace(/\\/g, "/")}"`,
        `TAP_STATE_DIR = "${stateDir.replace(/\\/g, "/")}"`,
        `TAP_REPO_ROOT = "${repoRoot.replace(/\\/g, "/")}"`,
        "",
        `[projects.'${canonicalizeTrustPath(repoRoot)}']`,
        'trust_level = "trusted"',
        "",
      ].join("\n"),
      "utf8",
    );

    const result = await doctorCommand([]);

    const checks = result.data?.checks as Array<{
      name: string;
      status: string;
      message?: string;
    }>;
    const codexCheck = checks.find(
      (c) => c.name === "MCP config (Codex config.toml)",
    );
    expect(codexCheck?.status).toBe("warn");
    expect(codexCheck?.message).toContain('legacy "tap-comms" key present');
  });

  it("repairs Codex config drift with --fix", async () => {
    const codexConfigPath = path.join(codexHomeDir, ".codex", "config.toml");
    fs.writeFileSync(
      codexConfigPath,
      [
        "[mcp_servers.tap-comms]",
        'command = "bun"',
        'args = ["old-server.ts"]',
        "",
        "[mcp_servers.tap-comms.env]",
        'TAP_AGENT_NAME = "온"',
        'TAP_AGENT_ID = "codex"',
        'TAP_COMMS_DIR = "C:/tap-ceo-test/hua-comms"',
        'TAP_STATE_DIR = "C:/tap-ceo-test/.tap-comms"',
        'TAP_REPO_ROOT = "C:/tap-ceo-test"',
        "",
      ].join("\n"),
      "utf8",
    );

    const result = await doctorCommand(["--fix"]);
    const written = fs.readFileSync(codexConfigPath, "utf8");

    expect(result.ok).toBe(true);
    expect(result.data).toEqual(
      expect.objectContaining({
        fixed: expect.arrayContaining([
          expect.stringContaining("Repaired Codex config"),
        ]),
      }),
    );
    expect(written).toContain("[mcp_servers.tap]");
    expect(written).toContain("[mcp_servers.tap.env]");
    expect(written).not.toContain("[mcp_servers.tap-comms]");
    expect(written).not.toContain("[mcp_servers.tap-comms.env]");
    expect(written).toContain('TAP_AGENT_NAME = "<set-per-session>"');
    expect(written).not.toContain("TAP_AGENT_ID");
    expect(written).toContain(
      `TAP_COMMS_DIR = "${commsDir.replace(/\\/g, "/")}"`,
    );
    expect(written).toContain(
      `TAP_REPO_ROOT = "${repoRoot.replace(/\\/g, "/")}"`,
    );
    expect(written).toContain(
      `[projects.'${canonicalizeTrustPath(repoRoot)}']`,
    );
    expect(written).toContain(
      `[projects.'${canonicalizeTrustPath(process.cwd())}']`,
    );
    expect(written).toContain('trust_level = "trusted"');
  });

  it("warns when concrete Codex identity is persisted globally", async () => {
    const codexConfigPath = path.join(codexHomeDir, ".codex", "config.toml");
    fs.writeFileSync(
      codexConfigPath,
      [
        "[mcp_servers.tap]",
        'command = "bun"',
        'args = ["server.ts"]',
        "",
        "[mcp_servers.tap.env]",
        'TAP_AGENT_NAME = "온"',
        'TAP_AGENT_ID = "codex"',
        `TAP_COMMS_DIR = "${commsDir.replace(/\\/g, "/")}"`,
        `TAP_STATE_DIR = "${stateDir.replace(/\\/g, "/")}"`,
        `TAP_REPO_ROOT = "${repoRoot.replace(/\\/g, "/")}"`,
        "",
        `[projects.'${canonicalizeTrustPath(repoRoot)}']`,
        'trust_level = "trusted"',
        "",
        `[projects.'${canonicalizeTrustPath(process.cwd())}']`,
        'trust_level = "trusted"',
        "",
      ].join("\n"),
      "utf8",
    );

    const result = await doctorCommand([]);

    const checks = result.data?.checks as Array<{
      name: string;
      status: string;
      message?: string;
    }>;
    const codexCheck = checks.find(
      (c) => c.name === "MCP config (Codex config.toml)",
    );
    expect(codexCheck?.status).toBe("warn");
    expect(codexCheck?.message).toContain(
      "non-neutral TAP_AGENT_NAME persisted (온)",
    );
    expect(codexCheck?.message).toContain(
      "concrete TAP_AGENT_ID persisted (codex)",
    );
  });

  it("neutralizes Codex identity env on --fix in multi-instance setups", async () => {
    loadStateMock.mockReturnValue({
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
          defaultAgentName: "온",
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
        "codex-reviewer": {
          instanceId: "codex-reviewer",
          runtime: "codex",
          defaultAgentName: "덱",
          port: 4511,
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
    } satisfies TapState);

    const codexConfigPath = path.join(codexHomeDir, ".codex", "config.toml");
    fs.writeFileSync(
      codexConfigPath,
      [
        "[mcp_servers.tap]",
        'command = "bun"',
        'args = ["old-server.ts"]',
        "",
        "[mcp_servers.tap.env]",
        'TAP_AGENT_NAME = "덱"',
        'TAP_AGENT_ID = "codex-reviewer"',
        'TAP_COMMS_DIR = "C:/tap-ceo-test/hua-comms"',
        'TAP_STATE_DIR = "C:/tap-ceo-test/.tap-comms"',
        'TAP_REPO_ROOT = "C:/tap-ceo-test"',
        "",
      ].join("\n"),
      "utf8",
    );

    await doctorCommand(["--fix"]);

    const written = fs.readFileSync(codexConfigPath, "utf8");
    expect(written).toContain('TAP_AGENT_NAME = "<set-per-session>"');
    expect(written).not.toContain("TAP_AGENT_ID");
  });

  it("prunes stale bridge heartbeats during --fix cleanup", async () => {
    isBridgeRunningMock.mockReturnValue(false);

    const pidDir = path.join(stateDir, "pids");
    fs.mkdirSync(pidDir, { recursive: true });
    fs.writeFileSync(
      path.join(pidDir, "bridge-codex.json"),
      JSON.stringify({ pid: 1234 }),
      "utf8",
    );
    fs.writeFileSync(
      path.join(commsDir, "heartbeats.json"),
      JSON.stringify(
        {
          codex: {
            id: "codex",
            agent: "온",
            timestamp: "2026-03-25T00:00:00.000Z",
            lastActivity: "2026-03-25T00:00:00.000Z",
            status: "active",
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    const result = await doctorCommand(["--fix"]);
    const heartbeats = JSON.parse(
      fs.readFileSync(path.join(commsDir, "heartbeats.json"), "utf8"),
    ) as Record<string, unknown>;

    expect(result.ok).toBe(true);
    expect(heartbeats.codex).toBeUndefined();
    expect(result.data).toEqual(
      expect.objectContaining({
        fixed: expect.arrayContaining([
          expect.stringContaining("Pruned 1 stale heartbeat entry"),
          expect.stringContaining(
            "Cleaned stale bridge + managed processes for codex",
          ),
        ]),
      }),
    );
  });

  it("warns about and prunes orphaned stale heartbeats", async () => {
    fs.writeFileSync(
      path.join(commsDir, "heartbeats.json"),
      JSON.stringify(
        {
          codex: {
            id: "codex",
            agent: "온",
            timestamp: new Date().toISOString(),
            lastActivity: new Date().toISOString(),
            status: "active",
          },
          haru: {
            id: "haru",
            agent: "하루",
            timestamp: "2026-03-25T00:00:00.000Z",
            lastActivity: "2026-03-25T00:00:00.000Z",
            status: "active",
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    const warnResult = await doctorCommand([]);
    const warnChecks = warnResult.data?.checks as Array<{
      name: string;
      status: string;
      message?: string;
    }>;
    const staleCheck = warnChecks.find((c) => c.name === "stale heartbeats");

    expect(staleCheck?.status).toBe("warn");
    expect(staleCheck?.message).toContain("하루");

    const fixResult = await doctorCommand(["--fix"]);
    const heartbeats = JSON.parse(
      fs.readFileSync(path.join(commsDir, "heartbeats.json"), "utf8"),
    ) as Record<string, unknown>;

    expect(heartbeats.codex).toBeDefined();
    expect(heartbeats.haru).toBeUndefined();
    expect(fixResult.data).toEqual(
      expect.objectContaining({
        fixed: expect.arrayContaining([
          expect.stringContaining("Pruned 1 stale heartbeat entry"),
        ]),
      }),
    );
  });

  it("keeps idle orphaned heartbeats within the grace window", async () => {
    const idleStartedAt = new Date(Date.now() - 31 * 60 * 1000).toISOString();
    fs.writeFileSync(
      path.join(commsDir, "heartbeats.json"),
      JSON.stringify(
        {
          codex: {
            id: "codex",
            agent: "온",
            timestamp: new Date().toISOString(),
            lastActivity: new Date().toISOString(),
            status: "active",
          },
          quiet: {
            id: "quiet",
            agent: "하루",
            timestamp: idleStartedAt,
            lastActivity: idleStartedAt,
            status: "active",
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    const warnResult = await doctorCommand([]);
    const warnChecks = warnResult.data?.checks as Array<{
      name: string;
      status: string;
      message?: string;
    }>;
    const staleCheck = warnChecks.find((c) => c.name === "stale heartbeats");

    expect(staleCheck?.status).toBe("pass");

    await doctorCommand(["--fix"]);
    const heartbeats = JSON.parse(
      fs.readFileSync(path.join(commsDir, "heartbeats.json"), "utf8"),
    ) as Record<string, unknown>;

    expect(heartbeats.codex).toBeDefined();
    expect(heartbeats.quiet).toBeDefined();
  });
});
