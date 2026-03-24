import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { logSuccess, logWarn } from "./utils.js";
import { replaceTomlTable, renderTomlTable, extractTomlTable } from "./toml.js";

export type PermissionMode = "safe" | "full";

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
 * Apply Claude permission settings to .claude/settings.local.json.
 * Safe mode: adds deny list for destructive operations.
 * Full mode: removes tap-managed deny rules (restores full access).
 */
export function applyClaudePermissions(
  repoRoot: string,
  mode: PermissionMode,
): { applied: boolean; warnings: string[] } {
  const warnings: string[] = [];
  const claudeDir = path.join(repoRoot, ".claude");
  const settingsPath = path.join(claudeDir, "settings.local.json");

  fs.mkdirSync(claudeDir, { recursive: true });

  let settings: Record<string, unknown> = {};
  if (fs.existsSync(settingsPath)) {
    try {
      settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
    } catch {
      warnings.push(
        ".claude/settings.local.json was invalid JSON. Starting fresh.",
      );
      settings = {};
    }
  }

  const existingDeny = Array.isArray(settings.deny)
    ? (settings.deny as string[])
    : [];

  if (mode === "full") {
    // Remove tap-managed deny rules, keep user-added ones
    const tapRuleSet = new Set(CLAUDE_DENY_RULES);
    const cleaned = existingDeny.filter((r) => !tapRuleSet.has(r));
    settings.deny = cleaned;

    const tmp = `${settingsPath}.tmp.${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(settings, null, 2) + "\n", "utf-8");
    fs.renameSync(tmp, settingsPath);

    logWarn("Claude: full mode — tap deny rules removed. Use with caution.");
    warnings.push("Full permission mode: tap deny rules removed.");
    return { applied: true, warnings };
  }

  // Safe mode: merge deny rules without duplicating
  const newDeny = [...new Set([...existingDeny, ...CLAUDE_DENY_RULES])];
  settings.deny = newDeny;

  const tmp = `${settingsPath}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(settings, null, 2) + "\n", "utf-8");
  fs.renameSync(tmp, settingsPath);

  logSuccess(
    `Claude: ${CLAUDE_DENY_RULES.length} deny rules applied to .claude/settings.local.json`,
  );

  return { applied: true, warnings };
}

// ─── Codex Config Patching ──────────────────────────────────────

function findCodexConfigPath(): string {
  return path.join(os.homedir(), ".codex", "config.toml");
}

function canonicalizeTrustPath(targetPath: string): string {
  let resolved = path.resolve(targetPath).replace(/\//g, "\\");
  const driveRoot = /^[A-Za-z]:\\$/;
  if (!driveRoot.test(resolved)) {
    resolved = resolved.replace(/\\+$/g, "");
  }
  return resolved.startsWith("\\\\?\\") ? resolved : `\\\\?\\${resolved}`;
}

/**
 * Apply Codex permission settings to ~/.codex/config.toml.
 * Safe mode: network full + trust project paths.
 * Full mode: danger-full-access warning (manual step).
 */
export function applyCodexPermissions(
  repoRoot: string,
  commsDir: string,
  mode: PermissionMode,
): { applied: boolean; warnings: string[] } {
  const warnings: string[] = [];
  const configPath = findCodexConfigPath();

  // Read existing config
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  let content = "";
  if (fs.existsSync(configPath)) {
    content = fs.readFileSync(configPath, "utf-8");
  }

  // Both modes need trust paths
  const trustTargets = getCodexWritableRoots(repoRoot, commsDir);

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

    // Writable roots for workspace-write mode
    const forwardSlashRoots = trustTargets.map((r) => r.replace(/\\/g, "/"));
    content = replaceTomlTable(
      content,
      "sandbox_workspace_write",
      renderTomlTable(
        "sandbox_workspace_write",
        { writable_roots: forwardSlashRoots },
        extractTomlTable(content, "sandbox_workspace_write"),
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
    const selector = `projects.'${canonicalizeTrustPath(target)}'`;
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

  return { applied: true, warnings };
}

// ─── Codex Writable Roots ───────────────────────────────────────

export function getCodexWritableRoots(
  repoRoot: string,
  commsDir: string,
): string[] {
  const roots = [repoRoot, commsDir];

  // Add worktree siblings
  const parent = path.dirname(repoRoot);
  for (let i = 1; i <= 4; i++) {
    const wtPath = path.join(parent, `hua-wt-${i}`);
    if (fs.existsSync(wtPath)) roots.push(wtPath);
  }

  return [...new Set(roots.map((r) => path.resolve(r)))];
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
): PermissionSummary {
  const trustedPaths = getCodexWritableRoots(repoRoot, commsDir);

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
