import * as fs from "node:fs";
import * as path from "node:path";
import { execSync } from "node:child_process";
import { resolveConfig } from "../config/index.js";
import {
  findRepoRoot,
  parseArgs,
  log,
  logSuccess,
  logWarn,
  logError,
  logHeader,
} from "../utils.js";
import type { CommandResult } from "../types.js";

const INIT_WORKTREE_HELP = `
Usage:
  tap-comms init-worktree [options]

Options:
  --path <dir>         Worktree directory (required, e.g. ../hua-wt-3)
  --branch <name>      Branch name to create (default: derived from path)
  --base <ref>         Base ref for new branch (default: origin/main)
  --mission <file>     Mission file to associate (e.g. m74-feature.md)
  --comms-dir <path>   Override comms directory
  --skip-install       Skip pnpm install step
  --help, -h           Show help

Examples:
  npx @hua-labs/tap init-worktree --path ../hua-wt-3 --branch feat/my-feature
  npx @hua-labs/tap init-worktree --path ../hua-wt-4 --branch fix/bug --mission m74-fix.md
`.trim();

interface WorktreeOptions {
  worktreePath: string;
  branch: string;
  base: string;
  mission?: string;
  commsDir: string;
  skipInstall: boolean;
  repoRoot: string;
}

// ─── Warning collector ─────────────────────────────────────────

function warn(warnings: string[], message: string): void {
  logWarn(message);
  warnings.push(message);
}

// ─── Step helpers ──────────────────────────────────────────────

function run(
  cmd: string,
  opts?: { cwd?: string; ignoreError?: boolean },
): string {
  try {
    return execSync(cmd, {
      cwd: opts?.cwd,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 120_000,
    }).trim();
  } catch (err) {
    if (opts?.ignoreError) return "";
    throw err;
  }
}

function toAbsolute(p: string): string {
  const resolved = path.resolve(p);
  // Normalize to forward slashes for .mcp.json compatibility
  return resolved.replace(/\\/g, "/");
}

function probeBun(candidate: string): boolean {
  try {
    const out = execSync(`"${candidate}" --version`, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 5000,
    }).trim();
    return /^\d+\.\d+/.test(out);
  } catch {
    return false;
  }
}

function findBun(): string | null {
  const candidates =
    process.platform === "win32" ? ["bun.exe", "bun"] : ["bun"];

  for (const name of candidates) {
    try {
      const out = execSync(
        process.platform === "win32" ? `where ${name}` : `which ${name}`,
        { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"], timeout: 5000 },
      ).trim();
      // Validate each candidate with --version before accepting
      for (const line of out.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (trimmed && probeBun(trimmed)) return trimmed;
      }
    } catch {
      // not found
    }
  }

  // Check common locations
  const home = process.env.HOME || process.env.USERPROFILE || "";
  const bunHome = path.join(
    home,
    ".bun",
    "bin",
    process.platform === "win32" ? "bun.exe" : "bun",
  );
  if (fs.existsSync(bunHome) && probeBun(bunHome)) return bunHome;

  return null;
}

// ─── Step 1: Create worktree ───────────────────────────────────

function step1CreateWorktree(opts: WorktreeOptions): boolean {
  log("Step 1/9: Creating worktree...");

  if (fs.existsSync(opts.worktreePath)) {
    logWarn(`Directory already exists: ${opts.worktreePath}`);
    // Check if it's already a worktree
    try {
      run("git rev-parse --git-dir", { cwd: opts.worktreePath });
      logWarn("Already a git worktree. Continuing...");
      return true;
    } catch {
      logError("Directory exists but is not a git worktree.");
      return false;
    }
  }

  try {
    // Try creating with new branch
    run(
      `git worktree add "${opts.worktreePath}" -b ${opts.branch} ${opts.base}`,
      { cwd: opts.repoRoot },
    );
    logSuccess(`Worktree created: ${opts.worktreePath}`);
    logSuccess(`Branch: ${opts.branch} (from ${opts.base})`);
  } catch {
    // Branch may already exist
    try {
      run(`git worktree add "${opts.worktreePath}" ${opts.branch}`, {
        cwd: opts.repoRoot,
      });
      logSuccess(`Worktree created with existing branch: ${opts.branch}`);
    } catch (err) {
      logError(
        `Failed to create worktree: ${err instanceof Error ? err.message : String(err)}`,
      );
      return false;
    }
  }
  return true;
}

// ─── Step 2: Merge origin/main ─────────────────────────────────

function step2MergeMain(opts: WorktreeOptions, warnings: string[]): void {
  log("Step 2/9: Merging origin/main...");

  try {
    run("git fetch origin main", { cwd: opts.worktreePath });
  } catch {
    warn(warnings, "Could not fetch origin/main. Skipping merge.");
    return;
  }

  try {
    const behind = run("git rev-list --count HEAD..origin/main", {
      cwd: opts.worktreePath,
    });
    if (behind === "0") {
      logSuccess("Already up to date with origin/main.");
      return;
    }

    run("git merge origin/main --no-edit -X theirs", {
      cwd: opts.worktreePath,
    });
    logSuccess("Merged origin/main.");
  } catch {
    warn(
      warnings,
      "Merge had issues. You may need to resolve conflicts manually.",
    );
  }
}

// ─── Step 3: Copy permissions ──────────────────────────────────

function step3CopyPermissions(opts: WorktreeOptions, warnings: string[]): void {
  log("Step 3/9: Copying permissions...");

  const srcSettings = path.join(
    opts.repoRoot,
    ".claude",
    "settings.local.json",
  );
  const destDir = path.join(opts.worktreePath, ".claude");
  const destSettings = path.join(destDir, "settings.local.json");

  if (!fs.existsSync(srcSettings)) {
    warn(
      warnings,
      "No .claude/settings.local.json found in main repo. Skipping.",
    );
    return;
  }

  fs.mkdirSync(destDir, { recursive: true });
  fs.copyFileSync(srcSettings, destSettings);
  logSuccess("Copied settings.local.json");

  try {
    run("git update-index --skip-worktree .claude/settings.local.json", {
      cwd: opts.worktreePath,
    });
    logSuccess("Marked skip-worktree");
  } catch {
    warn(warnings, "Could not set skip-worktree. File may show as modified.");
  }
}

// ─── Step 4: Generate .mcp.json ────────────────────────────────

function step4GenerateMcpJson(opts: WorktreeOptions, warnings: string[]): void {
  log("Step 4/9: Generating .mcp.json...");

  const bunPath = findBun();
  if (!bunPath) {
    warn(warnings, "bun not found. .mcp.json not generated.");
    warn(
      warnings,
      "Install bun (https://bun.sh) and re-run, or create .mcp.json manually.",
    );
    return;
  }

  const wtAbs = toAbsolute(opts.worktreePath);
  const bunAbs = toAbsolute(bunPath);
  const commsAbs = toAbsolute(opts.commsDir);

  // Find tap-comms channel entry point
  const channelEntry = path.join(
    wtAbs,
    "packages/tap-plugin/channels/tap-comms.ts",
  );

  const mcpConfig = {
    mcpServers: {
      "tap-comms": {
        command: bunAbs,
        args: [channelEntry],
        cwd: wtAbs,
        env: {
          TAP_COMMS_DIR: commsAbs,
          TAP_AGENT_NAME: "unnamed",
        },
      },
    },
  };

  const mcpPath = path.join(opts.worktreePath, ".mcp.json");
  fs.writeFileSync(mcpPath, JSON.stringify(mcpConfig, null, 2) + "\n", "utf-8");
  logSuccess(`.mcp.json generated (absolute paths + cwd)`);
  log(`  bun: ${bunAbs}`);
  log(`  comms: ${commsAbs}`);
}

// ─── Step 5: Install dependencies ──────────────────────────────

function step5Install(opts: WorktreeOptions, warnings: string[]): void {
  if (opts.skipInstall) {
    log("Step 5/9: Skipping pnpm install (--skip-install).");
    return;
  }

  log("Step 5/9: Installing dependencies...");

  try {
    run("pnpm install --prefer-offline", { cwd: opts.worktreePath });
    logSuccess("Dependencies installed.");
  } catch {
    warn(
      warnings,
      "pnpm install failed. Try running manually in the worktree.",
    );
  }
}

// ─── Step 6: Build ESLint plugin ───────────────────────────────

function step6BuildEslintPlugin(
  opts: WorktreeOptions,
  warnings: string[],
): void {
  if (opts.skipInstall) {
    log("Step 6/9: Skipping eslint plugin build (--skip-install).");
    return;
  }

  log("Step 6/9: Building eslint-plugin-i18n...");

  try {
    run("pnpm build --filter @hua-labs/eslint-plugin-i18n", {
      cwd: opts.worktreePath,
    });
    logSuccess("eslint-plugin-i18n built.");
  } catch {
    warn(warnings, "eslint-plugin-i18n build failed. Non-blocking.");
  }
}

// ─── Step 7: Verify comms ──────────────────────────────────────

function step7VerifyComms(opts: WorktreeOptions, warnings: string[]): void {
  log("Step 7/9: Verifying comms directory...");

  if (!fs.existsSync(opts.commsDir)) {
    warn(warnings, `Comms directory not found: ${opts.commsDir}`);
    warn(warnings, "Create it or run: npx @hua-labs/tap init");
    return;
  }

  const requiredDirs = ["inbox", "findings", "reviews", "letters"];
  for (const dir of requiredDirs) {
    const dirPath = path.join(opts.commsDir, dir);
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
      logSuccess(`Created ${dir}/`);
    }
  }

  logSuccess(`Comms verified: ${opts.commsDir}`);
}

// ─── Step 8: Verify bun ────────────────────────────────────────

function step8VerifyBun(warnings: string[]): void {
  log("Step 8/9: Verifying bun...");

  const bunPath = findBun();
  if (!bunPath) {
    warn(warnings, "bun not found in PATH.");
    warn(warnings, "Install: curl -fsSL https://bun.sh/install | bash");
    return;
  }

  try {
    const version = run(`"${bunPath}" --version`);
    logSuccess(`bun ${version} found: ${bunPath}`);
  } catch {
    warn(warnings, "bun found but version check failed.");
  }
}

// ─── Step 9: Ready message ─────────────────────────────────────

function step9Ready(opts: WorktreeOptions): void {
  logHeader("Ready!");
  log(`Worktree: ${toAbsolute(opts.worktreePath)}`);
  log(`Branch:   ${opts.branch}`);
  log(`Comms:    ${toAbsolute(opts.commsDir)}`);
  if (opts.mission) log(`Mission:  ${opts.mission}`);
  log("");
  log("Next steps:");
  log(`  cd ${opts.worktreePath}`);
  log("  claude  # Start Claude Code session");
  log("");
}

// ─── Command entry ─────────────────────────────────────────────

export async function initWorktreeCommand(
  args: string[],
): Promise<CommandResult> {
  const { flags } = parseArgs(args);

  if (flags["help"] === true || flags["h"] === true) {
    log(INIT_WORKTREE_HELP);
    return {
      ok: true,
      command: "init-worktree",
      code: "TAP_NO_OP",
      message: INIT_WORKTREE_HELP,
      warnings: [],
      data: {},
    };
  }

  const worktreePath =
    typeof flags["path"] === "string" ? flags["path"] : undefined;
  if (!worktreePath) {
    return {
      ok: false,
      command: "init-worktree",
      code: "TAP_INVALID_ARGUMENT",
      message:
        "Missing --path. Usage: npx @hua-labs/tap init-worktree --path ../hua-wt-3",
      warnings: [],
      data: {},
    };
  }

  const repoRoot = findRepoRoot();
  const { config } = resolveConfig({}, repoRoot);

  const branch =
    typeof flags["branch"] === "string"
      ? flags["branch"]
      : path.basename(path.resolve(worktreePath));
  const base =
    typeof flags["base"] === "string" ? flags["base"] : "origin/main";
  const mission =
    typeof flags["mission"] === "string" ? flags["mission"] : undefined;
  const commsDir =
    typeof flags["comms-dir"] === "string"
      ? flags["comms-dir"]
      : config.commsDir;
  const skipInstall = flags["skip-install"] === true;

  const opts: WorktreeOptions = {
    worktreePath: path.resolve(worktreePath),
    branch,
    base,
    mission,
    commsDir: path.resolve(commsDir),
    skipInstall,
    repoRoot,
  };

  logHeader(`@hua-labs/tap init-worktree`);
  log(`Path:     ${opts.worktreePath}`);
  log(`Branch:   ${opts.branch}`);
  log(`Base:     ${opts.base}`);
  log(`Comms:    ${opts.commsDir}`);
  if (mission) log(`Mission:  ${mission}`);
  log("");

  const warnings: string[] = [];

  // Execute steps
  const created = step1CreateWorktree(opts);
  if (!created) {
    return {
      ok: false,
      command: "init-worktree",
      code: "TAP_PATCH_FAILED",
      message: "Failed to create worktree.",
      warnings,
      data: {},
    };
  }

  step2MergeMain(opts, warnings);
  step3CopyPermissions(opts, warnings);
  step4GenerateMcpJson(opts, warnings);
  step5Install(opts, warnings);
  step6BuildEslintPlugin(opts, warnings);
  step7VerifyComms(opts, warnings);
  step8VerifyBun(warnings);
  step9Ready(opts);

  return {
    ok: true,
    command: "init-worktree" as never,
    code: "TAP_INIT_OK",
    message: `Worktree initialized: ${opts.worktreePath}`,
    warnings,
    data: {
      path: opts.worktreePath,
      branch: opts.branch,
      commsDir: opts.commsDir,
    },
  };
}
