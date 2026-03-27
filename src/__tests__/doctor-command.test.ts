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
const loadRuntimeBridgeHeartbeatMock = vi.fn((bridgeState?: {
  runtimeStateDir?: string | null;
}) => {
  const runtimeStateDir = bridgeState?.runtimeStateDir;
  if (!runtimeStateDir) return null;
  const heartbeatPath = path.join(runtimeStateDir, "heartbeat.json");
  if (!fs.existsSync(heartbeatPath)) return null;
  return JSON.parse(fs.readFileSync(heartbeatPath, "utf8")) as {
    lastError?: string | null;
    threadId?: string | null;
    threadCwd?: string | null;
  };
});
const loadRuntimeBridgeThreadStateMock = vi.fn((bridgeState?: {
  runtimeStateDir?: string | null;
}) => {
  const runtimeStateDir = bridgeState?.runtimeStateDir;
  if (!runtimeStateDir) return null;
  const threadPath = path.join(runtimeStateDir, "thread.json");
  if (!fs.existsSync(threadPath)) return null;
  return JSON.parse(fs.readFileSync(threadPath, "utf8")) as {
    threadId?: string;
    cwd?: string | null;
  };
});
const resolveConfigMock = vi.fn();
const findRepoRootMock = vi.fn();
const logMock = vi.fn();
const logHeaderMock = vi.fn();
const logSuccessMock = vi.fn();
const logWarnMock = vi.fn();
const buildManagedMcpServerSpecMock = vi.fn();

vi.mock("node:os", async () => {
  const actual = await vi.importActual<typeof import("node:os")>("node:os");
  return {
    ...actual,
    homedir: () => mockHomeDir(),
  };
});

vi.mock("../state.js", () => ({
  loadState: loadStateMock,
  saveState: saveStateMock,
  getInstalledInstances: getInstalledInstancesMock,
}));

vi.mock("../engine/bridge.js", () => ({
  isBridgeRunning: isBridgeRunningMock,
  getHeartbeatAge: getHeartbeatAgeMock,
  loadBridgeState: loadBridgeStateMock,
  loadRuntimeBridgeHeartbeat: loadRuntimeBridgeHeartbeatMock,
  loadRuntimeBridgeThreadState: loadRuntimeBridgeThreadStateMock,
  saveBridgeState: saveBridgeStateMock,
}));

vi.mock("../config/index.js", () => ({
  resolveConfig: resolveConfigMock,
}));

vi.mock("../adapters/common.js", () => ({
  buildManagedMcpServerSpec: buildManagedMcpServerSpecMock,
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
    buildManagedMcpServerSpecMock.mockReturnValue({
      command: "bun",
      args: ["server.ts"],
      env: {
        TAP_AGENT_NAME: "온",
        TAP_AGENT_ID: "codex",
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
      (c) => c.name === "MCP config (~/.codex/config.toml)",
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
      (c) => c.name === "MCP config (~/.codex/config.toml)",
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
      (c) => c.name === "MCP config (~/.codex/config.toml)",
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

  it("preserves existing Codex identity env on --fix in multi-instance setups", async () => {
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
        "codex-reviewer": {
          instanceId: "codex-reviewer",
          runtime: "codex",
          agentName: "덱",
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
    expect(written).toContain('TAP_AGENT_NAME = "덱"');
    expect(written).toContain('TAP_AGENT_ID = "codex-reviewer"');
  });
});
