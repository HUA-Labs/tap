import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ROLE_PRESETS,
  VALID_ROLES,
  createPermissionFromRole,
} from "../permissions/index.js";
import {
  checkInstanceDrift,
  computeFileHash,
} from "../config/drift-detector.js";
import {
  createInstanceConfig,
  saveInstanceConfig,
  loadInstanceConfig,
} from "../config/instance-config.js";
import {
  applyClaudePermissions,
  applyCodexPermissions,
  canonicalizeCodexTrustPath,
  ensureCodexWorktreeCoverage,
  getCodexWritableRoots,
  probeCodexPermissionProfile,
} from "../permissions.js";
import { extractTomlTable, parseTomlAssignments } from "../toml.js";
import type { InstanceState, TapState } from "../types.js";

function makeState(
  tmpDir: string,
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
          defaultAgentName: null,
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

describe("ROLE_PRESETS", () => {
  it("defines all 4 roles", () => {
    expect(Object.keys(ROLE_PRESETS)).toHaveLength(4);
    expect(Object.keys(ROLE_PRESETS).sort()).toEqual([
      "custom",
      "implementer",
      "reviewer",
      "tower",
    ]);
  });

  it("tower has full-access mode", () => {
    expect(ROLE_PRESETS.tower.mode).toBe("full-access");
    expect(ROLE_PRESETS.tower.allowedTools).toEqual(["*"]);
    expect(ROLE_PRESETS.tower.deniedTools).toEqual([]);
    expect(ROLE_PRESETS.tower.escalateTo).toBeNull();
  });

  it("implementer has workspace-write mode with tool restrictions", () => {
    expect(ROLE_PRESETS.implementer.mode).toBe("workspace-write");
    expect(ROLE_PRESETS.implementer.allowedTools).toContain("Edit");
    expect(ROLE_PRESETS.implementer.allowedTools).toContain("Bash");
    expect(ROLE_PRESETS.implementer.deniedTools).toContain(
      "Bash(git push --force:*)",
    );
    expect(ROLE_PRESETS.implementer.escalateTo).toBe("tower");
  });

  it("reviewer has readonly mode", () => {
    expect(ROLE_PRESETS.reviewer.mode).toBe("readonly");
    expect(ROLE_PRESETS.reviewer.allowedTools).toContain("Read");
    expect(ROLE_PRESETS.reviewer.allowedTools).toContain("Grep");
    expect(ROLE_PRESETS.reviewer.deniedTools).toContain("Edit");
    expect(ROLE_PRESETS.reviewer.deniedTools).toContain("Write");
    expect(ROLE_PRESETS.reviewer.allowedPaths).toEqual([
      "hua-comms/reviews/**",
    ]);
  });

  it("custom has prompt mode with empty tools", () => {
    expect(ROLE_PRESETS.custom.mode).toBe("prompt");
    expect(ROLE_PRESETS.custom.allowedTools).toEqual([]);
    expect(ROLE_PRESETS.custom.deniedTools).toEqual([]);
    expect(ROLE_PRESETS.custom.escalateTo).toBe("tower");
  });
});

describe("createPermissionFromRole", () => {
  it("creates permission matching preset for each role", () => {
    for (const role of VALID_ROLES) {
      const perm = createPermissionFromRole(role);
      expect(perm.role).toBe(role);
      expect(perm.mode).toBe(ROLE_PRESETS[role].mode);
      expect(perm.allowedTools).toEqual(ROLE_PRESETS[role].allowedTools);
      expect(perm.deniedTools).toEqual(ROLE_PRESETS[role].deniedTools);
    }
  });

  it("returns a copy, not a reference to the preset", () => {
    const perm = createPermissionFromRole("tower");
    perm.allowedTools.push("custom-tool");
    expect(ROLE_PRESETS.tower.allowedTools).not.toContain("custom-tool");
  });
});

describe("VALID_ROLES", () => {
  it("contains all 4 roles", () => {
    expect(VALID_ROLES).toEqual(["tower", "implementer", "reviewer", "custom"]);
  });
});

describe("applyCodexPermissions", () => {
  let tmpDir: string | null = null;
  const originalCodexHome = process.env.CODEX_HOME;

  function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  afterEach(() => {
    vi.restoreAllMocks();

    if (originalCodexHome === undefined) {
      delete process.env.CODEX_HOME;
    } else {
      process.env.CODEX_HOME = originalCodexHome;
    }

    if (tmpDir) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      tmpDir = null;
    }
  });

  it("writes Codex permissions to CODEX_HOME instead of ~/.codex", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tap-perms-test-"));
    const repoRoot = path.join(tmpDir, "repo");
    const commsDir = path.join(repoRoot, "tap-comms");
    const codexHome = path.join(tmpDir, "isolated-codex-home");
    const configPath = path.join(codexHome, "config.toml");
    const legacyPath = path.join(tmpDir, "home", ".codex", "config.toml");

    fs.mkdirSync(commsDir, { recursive: true });
    process.env.CODEX_HOME = codexHome;

    const result = applyCodexPermissions(repoRoot, commsDir, "safe");

    expect(result.applied).toBe(true);
    expect(result.backupPath).toBeUndefined();
    expect(fs.existsSync(configPath)).toBe(true);
    expect(fs.existsSync(legacyPath)).toBe(false);

    const content = fs.readFileSync(configPath, "utf-8");
    expect(content).toContain('mode = "workspace-write"');
    expect(content).toContain(repoRoot.replace(/\\/g, "/"));
    expect(content).toContain(commsDir.replace(/\\/g, "/"));
  });

  it("backs up an existing Codex config before patching permissions", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tap-perms-test-"));
    const repoRoot = path.join(tmpDir, "repo");
    const commsDir = path.join(tmpDir, "comms");
    const codexHome = path.join(tmpDir, "isolated-codex-home");
    const configPath = path.join(codexHome, "config.toml");
    const originalContent =
      '[sandbox]\nmode = "workspace-write"\nnetwork_access = "restricted"\n';

    fs.mkdirSync(repoRoot, { recursive: true });
    fs.mkdirSync(commsDir, { recursive: true });
    fs.mkdirSync(codexHome, { recursive: true });
    fs.writeFileSync(configPath, originalContent, "utf-8");
    process.env.CODEX_HOME = codexHome;

    const result = applyCodexPermissions(repoRoot, commsDir, "full");

    expect(result.applied).toBe(true);
    expect(result.backupPath).toBeTruthy();
    expect(result.backupPath).toContain(path.join("backups", "codex"));
    expect(result.backupPath).toContain("config.toml.");
    expect(fs.readFileSync(result.backupPath!, "utf-8")).toBe(originalContent);

    const content = fs.readFileSync(configPath, "utf-8");
    expect(content).toContain('mode = "danger-full-access"');
  });

  it("adds explicit worktree coverage without duplicating repeated bootstrap runs", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tap-perms-test-"));
    const repoRoot = path.join(tmpDir, "repo");
    const commsDir = path.join(tmpDir, "comms");
    const worktreePath = path.join(repoRoot, ".tmp", "wt-7");
    const codexHome = path.join(tmpDir, "isolated-codex-home");
    const configPath = path.join(codexHome, "config.toml");

    fs.mkdirSync(worktreePath, { recursive: true });
    fs.mkdirSync(commsDir, { recursive: true });
    process.env.CODEX_HOME = codexHome;

    applyCodexPermissions(repoRoot, commsDir, "safe", [worktreePath]);
    applyCodexPermissions(repoRoot, commsDir, "safe", [worktreePath]);

    const content = fs.readFileSync(configPath, "utf-8");
    const trustHeader =
      "[projects.'" + canonicalizeCodexTrustPath(worktreePath) + "']";
    const trustMatches = content.match(
      new RegExp(escapeRegExp(trustHeader), "g"),
    );
    const rootMatches = content.match(
      new RegExp(escapeRegExp(worktreePath.replace(/\\/g, "/")), "g"),
    );

    expect(trustMatches).toHaveLength(1);
    expect(rootMatches).toHaveLength(1);
  });

  it("preserves full-mode sandbox semantics when patching a new worktree path", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tap-perms-test-"));
    const repoRoot = path.join(tmpDir, "repo");
    const commsDir = path.join(tmpDir, "comms");
    const worktreePath = path.join(repoRoot, ".tmp", "wt-8");
    const codexHome = path.join(tmpDir, "isolated-codex-home");
    const configPath = path.join(codexHome, "config.toml");

    fs.mkdirSync(worktreePath, { recursive: true });
    fs.mkdirSync(commsDir, { recursive: true });
    fs.mkdirSync(codexHome, { recursive: true });
    fs.writeFileSync(
      configPath,
      '[sandbox]\nmode = "danger-full-access"\n',
      "utf-8",
    );
    process.env.CODEX_HOME = codexHome;

    const result = ensureCodexWorktreeCoverage(
      repoRoot,
      commsDir,
      worktreePath,
    );
    const content = fs.readFileSync(configPath, "utf-8");

    expect(result.mode).toBe("full");
    expect(content).toContain('mode = "danger-full-access"');
    expect(content).toContain(worktreePath.replace(/\\/g, "/"));
    expect(content).toContain(
      "[projects.'" + canonicalizeCodexTrustPath(worktreePath) + "']",
    );
  });

  it("treats inline-commented danger-full-access mode as full", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tap-perms-test-"));
    const repoRoot = path.join(tmpDir, "repo");
    const commsDir = path.join(tmpDir, "comms");
    const worktreePath = path.join(repoRoot, ".tmp", "wt-10");
    const codexHome = path.join(tmpDir, "isolated-codex-home");
    const configPath = path.join(codexHome, "config.toml");

    fs.mkdirSync(worktreePath, { recursive: true });
    fs.mkdirSync(commsDir, { recursive: true });
    fs.mkdirSync(codexHome, { recursive: true });
    fs.writeFileSync(
      configPath,
      '[sandbox]\nmode = "danger-full-access" # existing comment\n',
      "utf-8",
    );
    process.env.CODEX_HOME = codexHome;

    const result = ensureCodexWorktreeCoverage(
      repoRoot,
      commsDir,
      worktreePath,
    );
    const content = fs.readFileSync(configPath, "utf-8");

    expect(result.mode).toBe("full");
    expect(content).toContain('mode = "danger-full-access"');
    expect(content).not.toContain('mode = "workspace-write"');
  });

  it("preserves existing full-mode writable roots while appending worktree coverage", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tap-perms-test-"));
    const repoRoot = path.join(tmpDir, "repo");
    const commsDir = path.join(tmpDir, "comms");
    const worktreePath = path.join(repoRoot, ".tmp", "wt-11");
    const customRoot = path
      .join(tmpDir, "folder,with-comma")
      .replace(/\\/g, "/");
    const codexHome = path.join(tmpDir, "isolated-codex-home");
    const configPath = path.join(codexHome, "config.toml");

    fs.mkdirSync(worktreePath, { recursive: true });
    fs.mkdirSync(commsDir, { recursive: true });
    fs.mkdirSync(codexHome, { recursive: true });
    fs.writeFileSync(
      configPath,
      [
        "[sandbox]",
        'mode = "danger-full-access"',
        "",
        "[sandbox_workspace_write]",
        `writable_roots = ["${customRoot}"]`,
      ].join("\n"),
      "utf-8",
    );
    process.env.CODEX_HOME = codexHome;

    applyCodexPermissions(repoRoot, commsDir, "full", [worktreePath]);

    const content = fs.readFileSync(configPath, "utf-8");
    const sandboxWorkspaceWrite = parseTomlAssignments(
      extractTomlTable(content, "sandbox_workspace_write")!,
    );

    expect(sandboxWorkspaceWrite.writable_roots).toEqual([
      customRoot,
      repoRoot.replace(/\\/g, "/"),
      commsDir.replace(/\\/g, "/"),
      worktreePath.replace(/\\/g, "/"),
    ]);
  });

  it("preserves prior writable roots when a new worktree is bootstrapped from inside another worktree", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tap-perms-test-"));
    const repoRoot = path.join(tmpDir, "repo");
    const commsDir = path.join(tmpDir, "comms");
    const firstWorktreePath = path.join(repoRoot, ".tmp", "wt-12");
    const secondWorktreePath = path.join(repoRoot, ".tmp", "wt-13");
    const codexHome = path.join(tmpDir, "isolated-codex-home");
    const configPath = path.join(codexHome, "config.toml");

    fs.mkdirSync(firstWorktreePath, { recursive: true });
    fs.mkdirSync(secondWorktreePath, { recursive: true });
    fs.mkdirSync(commsDir, { recursive: true });
    process.env.CODEX_HOME = codexHome;

    ensureCodexWorktreeCoverage(repoRoot, commsDir, firstWorktreePath);
    ensureCodexWorktreeCoverage(
      firstWorktreePath,
      commsDir,
      secondWorktreePath,
    );

    const content = fs.readFileSync(configPath, "utf-8");
    expect(content).toContain(repoRoot.replace(/\\/g, "/"));
    expect(content).toContain(firstWorktreePath.replace(/\\/g, "/"));
    expect(content).toContain(secondWorktreePath.replace(/\\/g, "/"));
  });

  it("resyncs managed Codex runtime hashes after patching worktree coverage", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tap-perms-test-"));
    const repoRoot = path.join(tmpDir, "repo");
    const commsDir = path.join(tmpDir, "comms");
    const stateDir = path.join(tmpDir, ".tap-comms");
    const worktreePath = path.join(repoRoot, ".tmp", "wt-14");
    const codexHome = path.join(tmpDir, "isolated-codex-home");
    const configPath = path.join(codexHome, "config.toml");
    const instanceId = "codex-reviewer";

    fs.mkdirSync(worktreePath, { recursive: true });
    fs.mkdirSync(commsDir, { recursive: true });
    fs.mkdirSync(stateDir, { recursive: true });
    fs.mkdirSync(codexHome, { recursive: true });
    fs.writeFileSync(
      configPath,
      '[sandbox]\nmode = "workspace-write"\n',
      "utf-8",
    );
    process.env.CODEX_HOME = codexHome;

    const instConfig = createInstanceConfig({
      instanceId,
      runtime: "codex",
      defaultAgentName: null,
      port: null,
      appServerUrl: "http://127.0.0.1:4501",
      commsDir,
      stateDir,
      repoRoot,
    });
    instConfig.runtimeConfigHash = "stale_hash_000000";
    saveInstanceConfig(stateDir, instConfig);

    const state = makeState(tmpDir, {
      [instanceId]: {
        configHash: instConfig.configHash,
        configPath,
      },
    });
    expect(
      checkInstanceDrift(stateDir, instanceId, state).checks.find(
        (check) => check.name === "runtime config",
      )?.status,
    ).toBe("drifted");

    const result = ensureCodexWorktreeCoverage(
      repoRoot,
      commsDir,
      worktreePath,
      {
        stateDir,
      },
    );
    const updatedConfig = loadInstanceConfig(stateDir, instanceId);
    const runtimeCheck = checkInstanceDrift(
      stateDir,
      instanceId,
      state,
    ).checks.find((check) => check.name === "runtime config");

    expect(result.syncedRuntimeConfigs).toBe(1);
    expect(updatedConfig?.runtimeConfigHash).toBe(computeFileHash(configPath));
    expect(runtimeCheck?.status).toBe("ok");
  });

  it("serializes Windows worktree coverage with canonical trust and writable-root paths", () => {
    const repoRoot = "C:/HUA/hua-platform";
    const commsDir = "C:/HUA/hua-comms";
    const worktreePath = "C:/HUA/hua-platform/.tmp/wt-9";

    const writableRoots = getCodexWritableRoots(
      repoRoot,
      commsDir,
      [worktreePath],
      path.win32.resolve,
    ).map((root) => root.replace(/\\/g, "/"));

    expect(writableRoots).toEqual([
      "C:/HUA/hua-platform",
      "C:/HUA/hua-comms",
      "C:/HUA/hua-platform/.tmp/wt-9",
    ]);
    expect(canonicalizeCodexTrustPath(worktreePath, path.win32.resolve)).toBe(
      "\\\\?\\C:\\HUA\\hua-platform\\.tmp\\wt-9",
    );
  });

  it("probes a ready full Codex permission profile", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tap-perms-test-"));
    const repoRoot = path.join(tmpDir, "repo");
    const commsDir = path.join(tmpDir, "comms");
    const codexHome = path.join(tmpDir, "isolated-codex-home");
    const configPath = path.join(codexHome, "config.toml");

    fs.mkdirSync(codexHome, { recursive: true });
    fs.writeFileSync(
      configPath,
      '[sandbox]\nmode = "danger-full-access"\n',
      "utf-8",
    );
    process.env.CODEX_HOME = codexHome;

    const result = probeCodexPermissionProfile({
      repoRoot,
      commsDir,
      expectedMode: "full",
    });

    expect(result).toMatchObject({
      status: "ready",
      configPath,
      expectedMode: "full",
      actualMode: "full",
      sandboxMode: "danger-full-access",
      missingWritableRoots: [],
    });
  });

  it("reports downgraded full Codex permission profiles", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tap-perms-test-"));
    const repoRoot = path.join(tmpDir, "repo");
    const commsDir = path.join(tmpDir, "comms");
    const codexHome = path.join(tmpDir, "isolated-codex-home");
    const configPath = path.join(codexHome, "config.toml");

    fs.mkdirSync(codexHome, { recursive: true });
    fs.writeFileSync(
      configPath,
      '[sandbox]\nmode = "workspace-write"\nnetwork_access = "full"\n',
      "utf-8",
    );
    process.env.CODEX_HOME = codexHome;

    const result = probeCodexPermissionProfile({
      repoRoot,
      commsDir,
      expectedMode: "full",
    });

    expect(result).toMatchObject({
      status: "downgraded",
      expectedMode: "full",
      actualMode: "safe",
      sandboxMode: "workspace-write",
      networkAccess: "full",
    });
    expect(result.message).toContain("expected full");
  });

  it("reports missing Codex config before permission repair", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tap-perms-test-"));
    const repoRoot = path.join(tmpDir, "repo");
    const commsDir = path.join(tmpDir, "comms");
    const codexHome = path.join(tmpDir, "isolated-codex-home");
    const configPath = path.join(codexHome, "config.toml");

    process.env.CODEX_HOME = codexHome;

    const result = probeCodexPermissionProfile({
      repoRoot,
      commsDir,
      expectedMode: "full",
    });

    expect(result).toMatchObject({
      status: "missing-config",
      configPath,
      expectedMode: "full",
      sandboxMode: null,
      networkAccess: null,
      writableRoots: [],
      missingWritableRoots: [],
    });
  });

  it("reports missing writable roots for safe Codex permission profiles", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tap-perms-test-"));
    const repoRoot = path.join(tmpDir, "repo");
    const commsDir = path.join(tmpDir, "comms");
    const codexHome = path.join(tmpDir, "isolated-codex-home");
    const configPath = path.join(codexHome, "config.toml");

    fs.mkdirSync(codexHome, { recursive: true });
    fs.writeFileSync(
      configPath,
      [
        "[sandbox]",
        'mode = "workspace-write"',
        'network_access = "full"',
        "",
        "[sandbox_workspace_write]",
        'writable_roots = ["/tmp/other"]',
      ].join("\n"),
      "utf-8",
    );
    process.env.CODEX_HOME = codexHome;

    const result = probeCodexPermissionProfile({
      repoRoot,
      commsDir,
      expectedMode: "safe",
    });

    expect(result.status).toBe("missing-writable-roots");
    expect(result.missingWritableRoots).toEqual([
      repoRoot.replace(/\\/g, "/"),
      commsDir.replace(/\\/g, "/"),
    ]);
  });
});

describe("applyClaudePermissions", () => {
  let tmpDir: string | null = null;

  afterEach(() => {
    if (tmpDir) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      tmpDir = null;
    }
  });

  it("writes tap-managed deny rules to settings.json permissions.deny", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tap-claude-perms-test-"));
    const repoRoot = path.join(tmpDir, "repo");
    const claudeDir = path.join(repoRoot, ".claude");
    const settingsPath = path.join(claudeDir, "settings.json");

    fs.mkdirSync(claudeDir, { recursive: true });
    fs.writeFileSync(
      settingsPath,
      JSON.stringify(
        {
          permissions: {
            allow: ["Read", "Write", "Agent"],
            deny: ["Custom(rule)"],
          },
          enabledMcpjsonServers: ["tap"],
        },
        null,
        2,
      ) + "\n",
      "utf-8",
    );

    const result = applyClaudePermissions(repoRoot, "safe");

    expect(result.applied).toBe(true);

    const next = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
    expect(next.permissions.allow).toEqual(["Read", "Write", "Agent"]);
    expect(next.permissions.deny).toContain("Custom(rule)");
    expect(next.permissions.deny).toContain("Bash(git push --force:*)");
    expect(next.deny).toBeUndefined();
    expect(next.enabledMcpjsonServers).toEqual(["tap"]);
  });

  it("removes only tap-managed deny rules in full mode", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tap-claude-perms-test-"));
    const repoRoot = path.join(tmpDir, "repo");
    const claudeDir = path.join(repoRoot, ".claude");
    const settingsPath = path.join(claudeDir, "settings.json");

    fs.mkdirSync(claudeDir, { recursive: true });
    fs.writeFileSync(
      settingsPath,
      JSON.stringify(
        {
          permissions: {
            deny: ["Custom(rule)", "Bash(git push --force:*)"],
          },
        },
        null,
        2,
      ) + "\n",
      "utf-8",
    );

    const result = applyClaudePermissions(repoRoot, "full");

    expect(result.applied).toBe(true);

    const next = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
    expect(next.permissions.deny).toEqual(["Custom(rule)"]);
  });
});
