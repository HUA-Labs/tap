import * as fs from "node:fs";
import * as path from "node:path";
import { logSuccess, logWarn } from "./utils.js";
import {
  listInstanceConfigs,
  saveInstanceConfig,
} from "./config/instance-config.js";
import { backupFile, ensureBackupDir, fileHash, getStateDir } from "./state.js";
import {
  replaceTomlTable,
  renderTomlTable,
  extractTomlTable,
  parseTomlAssignments,
} from "./toml.js";
import { getCodexConfigPath } from "./adapters/common.js";

export type PermissionMode = "safe" | "full";
export type CodexPermissionProfileStatus =
  | "ready"
  | "missing-config"
  | "downgraded"
  | "missing-writable-roots"
  | "unreadable";

export interface CodexPermissionProfileProbe {
  status: CodexPermissionProfileStatus;
  configPath: string;
  expectedMode: PermissionMode;
  actualMode: string | null;
  sandboxMode: string | null;
  networkAccess: string | null;
  missingWritableRoots: string[];
  writableRoots: string[];
  message: string;
}

// ─── Claude Deny List ───────────────────────────────────────────

const CLAUDE_DENY_RULES = [
  "Bash(git push --force:*)",
  "Bash(git push -f:*)",
  "Bash(git push --force-with-lease:*)",
  "Bash(git reset --hard:*)",
  "Bash(git checkout -- .:*)",
  "Bash(git clean -f:*)",
  "Bash(git clean -fd:*)",
  "Bash(git clean -fdx:*)",
  "Bash(git restore --source=:*)",
  "Bash(git branch -D:*)",
  "Bash(git stash drop:*)",
  "Bash(rm -rf:*)",
];

/**
 * Apply Claude permission settings to .claude/settings.json.
 * Safe mode: adds deny list for destructive operations.
 * Full mode: removes tap-managed deny rules (restores full access).
 */
export function applyClaudePermissions(
  repoRoot: string,
  mode: PermissionMode,
): { applied: boolean; warnings: string[] } {
  const warnings: string[] = [];
  const claudeDir = path.join(repoRoot, ".claude");
  const settingsPath = path.join(claudeDir, "settings.json");

  fs.mkdirSync(claudeDir, { recursive: true });

  let settings: Record<string, unknown> = {};
  if (fs.existsSync(settingsPath)) {
    try {
      settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
    } catch {
      warnings.push(".claude/settings.json was invalid JSON. Starting fresh.");
      settings = {};
    }
  }

  const permissions =
    typeof settings.permissions === "object" &&
    settings.permissions !== null &&
    !Array.isArray(settings.permissions)
      ? { ...(settings.permissions as Record<string, unknown>) }
      : {};

  const existingDeny = Array.isArray(permissions.deny)
    ? (permissions.deny as string[])
    : Array.isArray(settings.deny)
      ? (settings.deny as string[])
      : [];

  if (mode === "full") {
    // Remove tap-managed deny rules, keep user-added ones
    const tapRuleSet = new Set(CLAUDE_DENY_RULES);
    const cleaned = existingDeny.filter((r) => !tapRuleSet.has(r));
    permissions.deny = cleaned;
    settings.permissions = permissions;
    delete settings.deny;

    const tmp = `${settingsPath}.tmp.${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(settings, null, 2) + "\n", "utf-8");
    fs.renameSync(tmp, settingsPath);

    logWarn("Claude: full mode — tap deny rules removed. Use with caution.");
    warnings.push("Full permission mode: tap deny rules removed.");
    return { applied: true, warnings };
  }

  // Safe mode: merge deny rules without duplicating
  const newDeny = [...new Set([...existingDeny, ...CLAUDE_DENY_RULES])];
  permissions.deny = newDeny;
  settings.permissions = permissions;
  delete settings.deny;

  const tmp = `${settingsPath}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(settings, null, 2) + "\n", "utf-8");
  fs.renameSync(tmp, settingsPath);

  logSuccess(
    `Claude: ${CLAUDE_DENY_RULES.length} deny rules applied to .claude/settings.json`,
  );

  return { applied: true, warnings };
}

// ─── Codex Config Patching ──────────────────────────────────────

function findCodexConfigPath(): string {
  return getCodexConfigPath();
}

export function canonicalizeCodexTrustPath(
  targetPath: string,
  resolvePath: (...segments: string[]) => string = path.resolve,
): string {
  let resolved = resolvePath(targetPath).replace(/\//g, "\\");
  const driveRoot = /^[A-Za-z]:\\$/;
  if (!driveRoot.test(resolved)) {
    resolved = resolved.replace(/\\+$/g, "");
  }
  return resolved.startsWith("\\\\?\\") ? resolved : `\\\\?\\${resolved}`;
}

function listManagedRepoWorktrees(repoRoot: string): string[] {
  const managed: string[] = [];

  const parent = path.dirname(repoRoot);
  for (let i = 1; i <= 4; i++) {
    const legacyPath = path.join(parent, `hua-wt-${i}`);
    if (fs.existsSync(legacyPath)) managed.push(legacyPath);
  }

  const dotTmpDir = path.join(repoRoot, ".tmp");
  if (!fs.existsSync(dotTmpDir)) return managed;

  for (const entry of fs.readdirSync(dotTmpDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith("wt-")) continue;
    managed.push(path.join(dotTmpDir, entry.name));
  }

  return managed;
}

function readCodexPermissionMode(configPath: string): PermissionMode {
  if (!fs.existsSync(configPath)) return "safe";

  const content = fs.readFileSync(configPath, "utf-8");
  const sandboxTable = extractTomlTable(content, "sandbox");
  if (!sandboxTable) return "safe";

  const sandboxValues = parseTomlAssignments(sandboxTable);
  return sandboxValues.mode === "danger-full-access" ? "full" : "safe";
}

function normalizeWritableRoot(root: string): string {
  let normalized = root.replace(/\\/g, "/");
  if (normalized !== "/" && !/^[A-Za-z]:\/$/.test(normalized)) {
    normalized = normalized.replace(/\/+$/g, "");
  }
  return normalized;
}

function readCodexWritableRoots(configPath: string): string[] {
  if (!fs.existsSync(configPath)) return [];

  const content = fs.readFileSync(configPath, "utf-8");
  const sandboxWorkspaceWriteTable = extractTomlTable(
    content,
    "sandbox_workspace_write",
  );
  if (!sandboxWorkspaceWriteTable) return [];

  const values = parseTomlAssignments(sandboxWorkspaceWriteTable);
  return Array.isArray(values.writable_roots)
    ? values.writable_roots.map(normalizeWritableRoot)
    : [];
}

function readCodexSandboxValues(
  configPath: string,
): Record<string, string | string[]> {
  if (!fs.existsSync(configPath)) return {};
  const content = fs.readFileSync(configPath, "utf-8");
  return parseTomlAssignments(extractTomlTable(content, "sandbox") ?? "");
}

function mergeWritableRoots(...rootSets: string[][]): string[] {
  const merged = new Map<string, string>();

  for (const rootSet of rootSets) {
    for (const root of rootSet) {
      const normalized = normalizeWritableRoot(root);
      if (!normalized || merged.has(normalized)) continue;
      merged.set(normalized, normalized);
    }
  }

  return [...merged.values()];
}

function syncCodexRuntimeConfigHashes(
  stateDir: string,
  configPath: string,
): number {
  const runtimeHash = fileHash(configPath);
  if (!runtimeHash) return 0;

  const now = new Date().toISOString();
  let synced = 0;

  for (const instConfig of listInstanceConfigs(stateDir)) {
    if (instConfig.runtime !== "codex") continue;
    if (
      instConfig.runtimeConfigHash === runtimeHash &&
      instConfig.lastSyncedToRuntime
    ) {
      continue;
    }

    instConfig.runtimeConfigHash = runtimeHash;
    instConfig.lastSyncedToRuntime = now;
    instConfig.updatedAt = now;
    saveInstanceConfig(stateDir, instConfig);
    synced += 1;
  }

  return synced;
}

interface ApplyCodexPermissionsOptions {
  preserveExistingWritableRoots?: boolean;
}

/**
 * Apply Codex permission settings to the active Codex config.toml.
 * Respects CODEX_HOME when set; otherwise uses ~/.codex/config.toml.
 * Safe mode: network full + trust project paths.
 * Full mode: danger-full-access warning (manual step).
 */
export function applyCodexPermissions(
  repoRoot: string,
  commsDir: string,
  mode: PermissionMode,
  extraPaths: string[] = [],
  options: ApplyCodexPermissionsOptions = {},
): { applied: boolean; warnings: string[]; backupPath?: string } {
  const warnings: string[] = [];
  const configPath = findCodexConfigPath();

  // Read existing config
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  let content = "";
  let backupPath: string | undefined;
  if (fs.existsSync(configPath)) {
    content = fs.readFileSync(configPath, "utf-8");
    backupPath = backupFile(
      configPath,
      ensureBackupDir(getStateDir(repoRoot), "codex"),
    );
  }

  const trustTargets = getCodexWritableRoots(repoRoot, commsDir, extraPaths);
  const existingRoots = readCodexWritableRoots(configPath);
  const computedRoots = trustTargets.map((r) => normalizeWritableRoot(r));
  const writableRoots =
    mode === "full" || options.preserveExistingWritableRoots
      ? mergeWritableRoots(existingRoots, computedRoots)
      : computedRoots;

  content = replaceTomlTable(
    content,
    "sandbox_workspace_write",
    renderTomlTable(
      "sandbox_workspace_write",
      { writable_roots: writableRoots },
      extractTomlTable(content, "sandbox_workspace_write"),
    ),
  );

  if (mode === "full") {
    // Full mode: danger-full-access + trust
    logWarn("Codex: full mode — setting sandbox to danger-full-access.");
    warnings.push(
      "Full mode: sandbox set to danger-full-access. Use with caution.",
    );

    content = replaceTomlTable(
      content,
      "sandbox",
      renderTomlTable(
        "sandbox",
        { mode: "danger-full-access" },
        extractTomlTable(content, "sandbox"),
      ),
    );
  } else {
    // Safe mode: workspace-write + network full + writable_roots
    content = replaceTomlTable(
      content,
      "sandbox",
      renderTomlTable(
        "sandbox",
        { mode: "workspace-write", network_access: "full" },
        extractTomlTable(content, "sandbox"),
      ),
    );

    // Windows elevated sandbox
    if (process.platform === "win32") {
      content = replaceTomlTable(
        content,
        "windows",
        renderTomlTable(
          "windows",
          { sandbox: "elevated" },
          extractTomlTable(content, "windows"),
        ),
      );
    }
  }

  // Trust project paths (both modes)
  for (const target of trustTargets) {
    const selector = `projects.'${canonicalizeCodexTrustPath(target)}'`;
    content = replaceTomlTable(
      content,
      selector,
      renderTomlTable(
        selector,
        { trust_level: "trusted" },
        extractTomlTable(content, selector),
      ),
    );
  }

  // Write back
  const tmp = `${configPath}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, content, "utf-8");
  fs.renameSync(tmp, configPath);

  const modeLabel =
    mode === "full" ? "danger-full-access" : "workspace-write, network=full";
  logSuccess(
    `Codex: sandbox=${modeLabel}, ${trustTargets.length} path(s) trusted`,
  );

  return { applied: true, warnings, backupPath };
}

// ─── Codex Writable Roots ───────────────────────────────────────

export function getCodexWritableRoots(
  repoRoot: string,
  commsDir: string,
  extraPaths: string[] = [],
  resolvePath: (...segments: string[]) => string = path.resolve,
): string[] {
  const roots = [
    repoRoot,
    commsDir,
    ...extraPaths,
    ...listManagedRepoWorktrees(repoRoot),
  ];

  return [...new Set(roots.map((r) => resolvePath(r)))];
}

export function probeCodexPermissionProfile(options: {
  repoRoot: string;
  commsDir: string;
  expectedMode?: PermissionMode;
  extraPaths?: string[];
  configPath?: string;
}): CodexPermissionProfileProbe {
  const expectedMode = options.expectedMode ?? "safe";
  const configPath = options.configPath ?? findCodexConfigPath();
  const expectedRoots = getCodexWritableRoots(
    options.repoRoot,
    options.commsDir,
    options.extraPaths ?? [],
  ).map(normalizeWritableRoot);

  if (!fs.existsSync(configPath)) {
    return {
      status: "missing-config",
      configPath,
      expectedMode,
      actualMode: null,
      sandboxMode: null,
      networkAccess: null,
      missingWritableRoots: expectedMode === "full" ? [] : expectedRoots,
      writableRoots: [],
      message: `Codex config not found at ${configPath}`,
    };
  }

  try {
    const sandboxValues = readCodexSandboxValues(configPath);
    const sandboxMode =
      typeof sandboxValues.mode === "string" ? sandboxValues.mode : null;
    const networkAccess =
      typeof sandboxValues.network_access === "string"
        ? sandboxValues.network_access
        : null;
    const actualMode: string =
      sandboxMode === "danger-full-access" ? "full" : "safe";
    const writableRoots = readCodexWritableRoots(configPath);
    const writableRootSet = new Set(writableRoots.map(normalizeWritableRoot));
    const missingWritableRoots =
      expectedMode === "full"
        ? []
        : expectedRoots.filter((root) => !writableRootSet.has(root));

    if (expectedMode === "full" && sandboxMode !== "danger-full-access") {
      return {
        status: "downgraded",
        configPath,
        expectedMode,
        actualMode,
        sandboxMode,
        networkAccess,
        missingWritableRoots,
        writableRoots,
        message: `Codex permission profile mismatch: expected full/danger-full-access, found sandbox.mode=${sandboxMode ?? "missing"}`,
      };
    }

    if (
      expectedMode === "safe" &&
      (sandboxMode !== "workspace-write" || networkAccess !== "full")
    ) {
      return {
        status: "downgraded",
        configPath,
        expectedMode,
        actualMode,
        sandboxMode,
        networkAccess,
        missingWritableRoots,
        writableRoots,
        message: `Codex permission profile mismatch: expected workspace-write with network_access=full, found sandbox.mode=${sandboxMode ?? "missing"} network_access=${networkAccess ?? "missing"}`,
      };
    }

    if (missingWritableRoots.length > 0) {
      return {
        status: "missing-writable-roots",
        configPath,
        expectedMode,
        actualMode,
        sandboxMode,
        networkAccess,
        missingWritableRoots,
        writableRoots,
        message: `Codex permission profile is missing ${missingWritableRoots.length} writable root(s)`,
      };
    }

    return {
      status: "ready",
      configPath,
      expectedMode,
      actualMode,
      sandboxMode,
      networkAccess,
      missingWritableRoots,
      writableRoots,
      message:
        expectedMode === "full"
          ? "Codex permission profile is full/danger-full-access"
          : "Codex permission profile is workspace-write with network_access=full and expected writable roots",
    };
  } catch (error) {
    return {
      status: "unreadable",
      configPath,
      expectedMode,
      actualMode: null,
      sandboxMode: null,
      networkAccess: null,
      missingWritableRoots: [],
      writableRoots: [],
      message: `Codex permission profile could not be read: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export function ensureCodexWorktreeCoverage(
  repoRoot: string,
  commsDir: string,
  worktreePath: string,
  options: { stateDir?: string } = {},
): {
  applied: boolean;
  warnings: string[];
  mode: PermissionMode;
  syncedRuntimeConfigs: number;
} {
  const configPath = findCodexConfigPath();
  const mode = readCodexPermissionMode(configPath);
  const result = applyCodexPermissions(
    repoRoot,
    commsDir,
    mode,
    [worktreePath],
    {
      preserveExistingWritableRoots: true,
    },
  );
  const syncedRuntimeConfigs = options.stateDir
    ? syncCodexRuntimeConfigHashes(options.stateDir, configPath)
    : 0;
  return { ...result, mode, syncedRuntimeConfigs };
}

// ─── Permission Summary ────────────────────────────────────────

export interface PermissionSummary {
  mode: PermissionMode;
  claude: { applied: boolean; denyCount: number; warnings: string[] };
  codex: { applied: boolean; trustedPaths: string[]; warnings: string[] };
}

export function buildPermissionSummary(
  mode: PermissionMode,
  repoRoot: string,
  commsDir: string,
  extraPaths: string[] = [],
): PermissionSummary {
  const trustedPaths = getCodexWritableRoots(repoRoot, commsDir, extraPaths);

  return {
    mode,
    claude: {
      applied: true,
      denyCount: mode === "safe" ? CLAUDE_DENY_RULES.length : 0,
      warnings: mode === "full" ? ["Full mode: tap deny rules removed."] : [],
    },
    codex: {
      applied: true,
      trustedPaths,
      warnings:
        mode === "full"
          ? ["Full mode: sandbox set to danger-full-access."]
          : [],
    },
  };
}
