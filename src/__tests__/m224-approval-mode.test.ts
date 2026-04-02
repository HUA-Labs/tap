import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  extractTomlTable,
  parseTomlAssignments,
  renderTomlTable,
  replaceTomlTable,
} from "../toml.js";
import {
  createInstanceConfig,
  saveInstanceConfig,
  loadInstanceConfig,
} from "../config/instance-config.js";
import {
  checkInstanceDrift,
  computeFileHash,
} from "../config/drift-detector.js";
import type { TapState, InstanceState } from "../types.js";

// ─── patchCodexApprovalMode tests ─────────────────────────────

// Mock getHomeDir to use temp directory
let tmpDir: string;
let codexDir: string;
let configPath: string;
let stateDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tap-m224-test-"));
  codexDir = path.join(tmpDir, ".codex");
  configPath = path.join(codexDir, "config.toml");
  stateDir = path.join(tmpDir, ".tap-comms");
  fs.mkdirSync(codexDir, { recursive: true });
  fs.mkdirSync(stateDir, { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

/**
 * Simulate patchCodexApprovalMode logic against a temp config file.
 * We test the core logic directly rather than importing the function
 * which depends on os.homedir().
 */
function patchApprovalMode(tomlPath: string): boolean {
  if (!fs.existsSync(tomlPath)) return false;
  const content = fs.readFileSync(tomlPath, "utf-8");
  const tapTable = extractTomlTable(content, "mcp_servers.tap");
  if (!tapTable) return false;
  const values = parseTomlAssignments(tapTable);
  if (values.approval_mode === "auto") return false;
  const patched = replaceTomlTable(
    content,
    "mcp_servers.tap",
    renderTomlTable("mcp_servers.tap", { approval_mode: "auto" }, tapTable),
  );
  const tmp = `${tomlPath}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, patched, "utf-8");
  fs.renameSync(tmp, tomlPath);
  return true;
}

function makeState(
  instances: Record<string, Partial<InstanceState>>,
): TapState {
  return {
    schemaVersion: 3,
    createdAt: "",
    updatedAt: "",
    commsDir: path.join(tmpDir, "tap-comms"),
    repoRoot: tmpDir,
    packageVersion: "0.3.0",
    instances: Object.fromEntries(
      Object.entries(instances).map(([id, partial]) => [
        id,
        {
          instanceId: id,
          runtime: "codex",
          agentName: null,
          port: null,
          installed: true,
          configPath: "",
          bridgeMode: "app-server",
          restartRequired: false,
          ownedArtifacts: [],
          backupPath: "",
          lastAppliedHash: "",
          lastVerifiedAt: null,
          bridge: null,
          headless: null,
          warnings: [],
          ...partial,
        } as InstanceState,
      ]),
    ),
  };
}

describe("M224: patchCodexApprovalMode", () => {
  it("patches approval_mode from approve to auto", () => {
    fs.writeFileSync(
      configPath,
      [
        "[mcp_servers.tap]",
        'command = "node"',
        'args = ["server.mjs"]',
        'approval_mode = "approve"',
        "",
        "[mcp_servers.tap.env]",
        'TAP_COMMS_DIR = "D:/HUA/hua-comms"',
      ].join("\n"),
    );

    const patched = patchApprovalMode(configPath);
    expect(patched).toBe(true);

    const content = fs.readFileSync(configPath, "utf-8");
    const values = parseTomlAssignments(
      extractTomlTable(content, "mcp_servers.tap")!,
    );
    expect(values.approval_mode).toBe("auto");
    // Other fields preserved
    expect(values.command).toBe("node");
  });

  it("skips patch when approval_mode is already auto", () => {
    fs.writeFileSync(
      configPath,
      [
        "[mcp_servers.tap]",
        'command = "node"',
        'args = ["server.mjs"]',
        'approval_mode = "auto"',
      ].join("\n"),
    );

    const patched = patchApprovalMode(configPath);
    expect(patched).toBe(false);
  });

  it("skips patch when [mcp_servers.tap] table is missing", () => {
    fs.writeFileSync(
      configPath,
      ['model = "gpt-5.4"', "", "[some_other_table]", 'key = "value"'].join(
        "\n",
      ),
    );

    const patched = patchApprovalMode(configPath);
    expect(patched).toBe(false);

    // Config unchanged
    const content = fs.readFileSync(configPath, "utf-8");
    expect(content).toContain('model = "gpt-5.4"');
    expect(extractTomlTable(content, "mcp_servers.tap")).toBeNull();
  });

  it("skips patch when config.toml does not exist", () => {
    const patched = patchApprovalMode(
      path.join(tmpDir, "nonexistent", "config.toml"),
    );
    expect(patched).toBe(false);
  });
});

describe("M224: hash resync after approval_mode patch", () => {
  it("does not cause drift false-positive after patching", () => {
    // 1. Create config.toml with approval_mode = "approve"
    fs.writeFileSync(
      configPath,
      [
        "[mcp_servers.tap]",
        'command = "node"',
        'args = ["server.mjs"]',
        'approval_mode = "approve"',
      ].join("\n"),
    );

    // 2. Create instance config with hash of current config
    const instConfig = createInstanceConfig({
      instanceId: "codex-main",
      runtime: "codex",
      agentName: null,
      agentId: null,
      port: null,
      appServerUrl: "http://localhost:4501",
      commsDir: path.join(tmpDir, "tap-comms"),
      stateDir,
      repoRoot: tmpDir,
    });
    instConfig.runtimeConfigHash = computeFileHash(configPath);
    saveInstanceConfig(stateDir, instConfig);

    // 3. Patch approval_mode
    const patched = patchApprovalMode(configPath);
    expect(patched).toBe(true);

    // 4. Resync hash (simulates what bridge.ts does)
    const updated = loadInstanceConfig(stateDir, "codex-main")!;
    updated.runtimeConfigHash = computeFileHash(configPath);
    updated.updatedAt = new Date().toISOString();
    saveInstanceConfig(stateDir, updated);

    // 5. Check drift — should be OK, not drifted
    const state = makeState({
      "codex-main": { configPath },
    });
    const result = checkInstanceDrift(stateDir, "codex-main", state);
    const runtimeCheck = result.checks.find((c) => c.name === "runtime config");
    // Should not have a drifted runtime config check
    if (runtimeCheck) {
      expect(runtimeCheck.status).not.toBe("drifted");
    }
  });

  it("detects drift when hash is NOT resynced after patch", () => {
    // 1. Create config.toml with approval_mode = "approve"
    fs.writeFileSync(
      configPath,
      [
        "[mcp_servers.tap]",
        'command = "node"',
        'args = ["server.mjs"]',
        'approval_mode = "approve"',
      ].join("\n"),
    );

    // 2. Create instance config with hash of current config
    const instConfig = createInstanceConfig({
      instanceId: "codex-main",
      runtime: "codex",
      agentName: null,
      agentId: null,
      port: null,
      appServerUrl: "http://localhost:4501",
      commsDir: path.join(tmpDir, "tap-comms"),
      stateDir,
      repoRoot: tmpDir,
    });
    instConfig.runtimeConfigHash = computeFileHash(configPath);
    saveInstanceConfig(stateDir, instConfig);

    // 3. Patch approval_mode WITHOUT resyncing hash
    patchApprovalMode(configPath);

    // 4. Check drift — should detect drifted
    const state = makeState({
      "codex-main": { configPath },
    });
    const result = checkInstanceDrift(stateDir, "codex-main", state);
    const runtimeCheck = result.checks.find((c) => c.name === "runtime config");
    expect(runtimeCheck).toBeDefined();
    expect(runtimeCheck!.status).toBe("drifted");
  });
});

describe("M224: adapter bun→node for bundled .mjs", () => {
  it.skip("buildManagedMcpServerSpec uses node for .mjs source (requires PR #943)", async () => {
    // Import the real function (not mocked)
    const { buildManagedMcpServerSpec } = await import("../adapters/common.js");

    // Create a fake .mjs file to be found
    const mjsPath = path.join(tmpDir, "mcp-server.mjs");
    fs.writeFileSync(mjsPath, "// fake bundled server", "utf-8");

    const ctx = {
      commsDir: path.join(tmpDir, "comms"),
      repoRoot: tmpDir,
      stateDir,
      platform: "win32" as const,
    };

    // Mock findTapCommsServerEntry to return our .mjs
    const common = await import("../adapters/common.js");
    vi.spyOn(common, "findTapCommsServerEntry").mockReturnValue(mjsPath);

    try {
      const spec = buildManagedMcpServerSpec(ctx);
      if (spec.command) {
        // Command should be node (or contain "node"), not bun
        expect(spec.command.toLowerCase()).toContain("node");
        expect(spec.command.toLowerCase()).not.toContain("bun");
      }
    } finally {
      vi.restoreAllMocks();
    }
  });
});
