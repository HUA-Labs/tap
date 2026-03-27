import * as fs from "node:fs";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { createInitialState, saveState, stateExists } from "../state.js";
import {
  findRepoRoot,
  resolveCommsDir,
  log,
  logSuccess,
  logWarn,
  logError,
  logHeader,
} from "../utils.js";
import { version } from "../version.js";
import {
  applyClaudePermissions,
  applyCodexPermissions,
  buildPermissionSummary,
} from "../permissions.js";
import type { CommandResult } from "../types.js";
import type { PermissionMode } from "../permissions.js";
import {
  resolveConfig,
  saveSharedConfig,
  loadSharedConfig,
} from "../config/index.js";

const COMMS_DIRS = [
  "inbox",
  "reviews",
  "findings",
  "handoff",
  "retros",
  "archive",
];

function parsePermissionMode(args: string[]): PermissionMode {
  const idx = args.indexOf("--permissions");
  if (idx !== -1 && args[idx + 1]) {
    const value = args[idx + 1];
    if (value === "full" || value === "safe") return value;
    logWarn(`Unknown permission mode: ${value}. Using "safe".`);
  }
  return "safe";
}

const INIT_HELP = `
Usage:
  tap init [options]

Description:
  Initialize the tap directory structure, state file, and permissions.
  Optionally clone a shared comms repository.

Options:
  --comms-dir <path>    Override comms directory (default: tap-comms/)
  --comms-repo <url>    Clone a shared comms git repo into comms directory
  --permissions <mode>  Permission mode: safe (default) or full
  --force               Re-initialize even if already set up
  --help, -h            Show help

Examples:
  npx @hua-labs/tap init
  npx @hua-labs/tap init --permissions full
  npx @hua-labs/tap init --comms-repo https://github.com/org/comms.git
  npx @hua-labs/tap init --comms-dir /shared/comms --force
`.trim();

export async function initCommand(args: string[]): Promise<CommandResult> {
  if (args.includes("--help") || args.includes("-h")) {
    log(INIT_HELP);
    return {
      ok: true,
      command: "init",
      code: "TAP_NO_OP",
      message: INIT_HELP,
      warnings: [],
      data: {},
    };
  }

  const repoRoot = findRepoRoot();
  const commsDir = resolveCommsDir(args, repoRoot);
  const permMode = parsePermissionMode(args);

  // Check if already initialized
  if (stateExists(repoRoot) && !args.includes("--force")) {
    return {
      ok: true,
      command: "init",
      code: "TAP_ALREADY_INITIALIZED",
      message: "Already initialized. Use --force to re-initialize.",
      warnings: [],
      data: { commsDir, repoRoot },
    };
  }

  logHeader("@hua-labs/tap init");

  // Clone comms repo if --comms-repo provided
  const commsRepoIdx = args.indexOf("--comms-repo");
  const commsRepoUrl =
    commsRepoIdx !== -1 && args[commsRepoIdx + 1]
      ? args[commsRepoIdx + 1]
      : undefined;

  if (commsRepoUrl) {
    if (fs.existsSync(commsDir) && fs.readdirSync(commsDir).length > 0) {
      const gitDir = path.join(commsDir, ".git");
      if (fs.existsSync(gitDir)) {
        log(`Comms directory exists: ${commsDir}`);
        logSuccess("Comms directory is already a git repo — linking only");
      } else {
        logError(`Comms directory exists but is not a git repo: ${commsDir}`);
        return {
          ok: false,
          command: "init",
          code: "TAP_INIT_CLONE_FAILED",
          message: `Comms directory "${commsDir}" exists but is not a git repo. Remove it or use --force to reinitialize.`,
          warnings: [],
          data: { commsDir, commsRepoUrl },
        };
      }
    } else {
      log(`Cloning comms repo: ${commsRepoUrl}`);
      try {
        const cloneResult = spawnSync(
          "git",
          ["clone", commsRepoUrl, commsDir],
          {
            stdio: "pipe",
            encoding: "utf-8",
          },
        );
        if (cloneResult.status !== 0) {
          throw new Error(
            cloneResult.stderr ||
              `git clone exited with code ${cloneResult.status}`,
          );
        }
        logSuccess(`Cloned comms repo to ${commsDir}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logError(`Failed to clone comms repo: ${msg}`);
        return {
          ok: false,
          command: "init",
          code: "TAP_INIT_CLONE_FAILED",
          message: `Failed to clone comms repo: ${msg}`,
          warnings: [],
          data: { commsRepoUrl },
        };
      }
    }
  }

  // Persist comms config (commsDir + optional repoUrl) for tap comms pull/push
  {
    const sharedConfig = loadSharedConfig(repoRoot) ?? {};
    let configChanged = false;
    if (commsRepoUrl) {
      sharedConfig.commsRepoUrl = commsRepoUrl;
      configChanged = true;
    }
    const commsDirRelative = path.relative(repoRoot, commsDir);
    if (commsDirRelative && commsDirRelative !== "tap-comms") {
      sharedConfig.commsDir = commsDirRelative;
      configChanged = true;
    }
    if (configChanged) {
      saveSharedConfig(repoRoot, sharedConfig);
      logSuccess("Saved comms config to tap-config.json");
    }
  }

  // Create comms directory structure
  log(`Comms directory: ${commsDir}`);
  for (const dir of COMMS_DIRS) {
    const dirPath = path.join(commsDir, dir);
    fs.mkdirSync(dirPath, { recursive: true });
    logSuccess(`Created ${dir}/`);
  }

  // Create .gitignore in comms dir
  const gitignorePath = path.join(commsDir, ".gitignore");
  if (!fs.existsSync(gitignorePath)) {
    fs.writeFileSync(
      gitignorePath,
      ["tap.db", ".lock", "*.tmp.*", ".DS_Store"].join("\n") + "\n",
      "utf-8",
    );
    logSuccess("Created .gitignore");
  }

  // Create state directory (config-resolved — may differ from default .tap-comms/)
  const { config } = resolveConfig({}, repoRoot);
  const stateDir = config.stateDir;
  fs.mkdirSync(path.join(stateDir, "pids"), { recursive: true });
  fs.mkdirSync(path.join(stateDir, "logs"), { recursive: true });
  fs.mkdirSync(path.join(stateDir, "backups"), { recursive: true });
  const stateDirRel = path.relative(repoRoot, stateDir);
  logSuccess(`Created ${stateDirRel}/ state directory`);

  // Add state dir + local config to repo .gitignore if not present
  const repoGitignore = path.join(repoRoot, ".gitignore");
  const gitignoreEntries = [
    { entry: stateDirRel.replace(/\\/g, "/") + "/", label: "tap-comms state" },
    {
      entry: "tap-config.local.json",
      label: "tap-comms local config (machine-specific)",
    },
  ];
  if (fs.existsSync(repoGitignore)) {
    const content = fs.readFileSync(repoGitignore, "utf-8");
    for (const { entry, label } of gitignoreEntries) {
      if (!content.includes(entry)) {
        fs.appendFileSync(repoGitignore, `\n# ${label}\n${entry}\n`);
        logSuccess(`Added ${entry} to .gitignore`);
      }
    }
  }

  // Create initial state
  const state = createInitialState(commsDir, repoRoot, version);
  saveState(repoRoot, state);
  logSuccess("Created state.json");

  // Apply permissions
  const warnings: string[] = [];
  logHeader(`Permissions: ${permMode} mode`);

  const claudeResult = applyClaudePermissions(repoRoot, permMode);
  warnings.push(...claudeResult.warnings);

  const codexResult = applyCodexPermissions(repoRoot, commsDir, permMode);
  warnings.push(...codexResult.warnings);

  const permSummary = buildPermissionSummary(permMode, repoRoot, commsDir);

  if (permMode === "full") {
    logWarn("Full mode: no destructive operation guards. Use with caution.");
  }

  logHeader("Done! Next steps:");
  log("npx @hua-labs/tap add claude    # Add Claude runtime");
  log("npx @hua-labs/tap add codex     # Add Codex runtime");
  log("npx @hua-labs/tap status        # Check status");

  return {
    ok: true,
    command: "init",
    code: "TAP_INIT_OK",
    message: "Initialized successfully",
    warnings,
    data: {
      commsDir,
      repoRoot,
      permissions: permSummary,
    },
  };
}
