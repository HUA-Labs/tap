/**
 * tap comms pull/push — sync comms directory with remote repo.
 * M108: GitHub/comms repo connection.
 */

import { execSync, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  findRepoRoot,
  resolveCommsDir as resolveCommsDirFromArgs,
  log,
  logSuccess,
  logError,
  logHeader,
} from "../utils.js";
import type { CommandResult } from "../types.js";

const COMMS_HELP = `
Usage:
  tap comms <subcommand>

Subcommands:
  pull    Pull latest changes from comms remote repo
  push    Commit and push comms changes to remote repo

Examples:
  npx @hua-labs/tap comms pull
  npx @hua-labs/tap comms push
`.trim();

function isGitRepo(dir: string): boolean {
  return fs.existsSync(path.join(dir, ".git"));
}

function commsPull(commsDir: string): CommandResult {
  logHeader("tap comms pull");

  if (!isGitRepo(commsDir)) {
    logError(`${commsDir} is not a git repository`);
    return {
      ok: false,
      command: "comms",
      code: "TAP_COMMS_NOT_REPO",
      message: `Comms directory is not a git repo. Use 'tap init --comms-repo <url>' to set up.`,
      warnings: [],
      data: { commsDir },
    };
  }

  try {
    const output = execSync("git pull --rebase", {
      cwd: commsDir,
      encoding: "utf-8",
      stdio: "pipe",
    });
    logSuccess("Comms pull complete");
    if (output.trim()) log(output.trim());
    return {
      ok: true,
      command: "comms",
      code: "TAP_COMMS_PULL_OK",
      message: "Comms pull complete",
      warnings: [],
      data: { commsDir },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logError(`Pull failed: ${msg}`);
    return {
      ok: false,
      command: "comms",
      code: "TAP_COMMS_PULL_FAILED",
      message: `Pull failed: ${msg}`,
      warnings: [],
      data: { commsDir },
    };
  }
}

function commsPush(commsDir: string): CommandResult {
  logHeader("tap comms push");

  if (!isGitRepo(commsDir)) {
    logError(`${commsDir} is not a git repository`);
    return {
      ok: false,
      command: "comms",
      code: "TAP_COMMS_NOT_REPO",
      message: `Comms directory is not a git repo. Use 'tap init --comms-repo <url>' to set up.`,
      warnings: [],
      data: { commsDir },
    };
  }

  try {
    // Stage all changes
    execSync("git add -A", { cwd: commsDir, stdio: "pipe" });

    // Check if there are changes to commit
    const status = execSync("git status --porcelain", {
      cwd: commsDir,
      encoding: "utf-8",
      stdio: "pipe",
    }).trim();

    if (!status) {
      log("Nothing to push — comms directory is clean");
      return {
        ok: true,
        command: "comms",
        code: "TAP_COMMS_PUSH_OK",
        message: "Nothing to push",
        warnings: [],
        data: { commsDir, changed: false },
      };
    }

    // Commit
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const commitResult = spawnSync(
      "git",
      ["commit", "-m", `chore(comms): sync ${timestamp}`],
      { cwd: commsDir, stdio: "pipe", encoding: "utf-8" },
    );
    if (commitResult.status !== 0) {
      const msg =
        commitResult.stderr ||
        `git commit exited with code ${commitResult.status}`;
      return {
        ok: false,
        command: "comms",
        code: "TAP_COMMS_PUSH_FAILED",
        message: `Commit failed: ${msg}`,
        warnings: [],
        data: { commsDir },
      };
    }

    // Push
    execSync("git push", { cwd: commsDir, stdio: "pipe" });
    logSuccess("Comms push complete");

    return {
      ok: true,
      command: "comms",
      code: "TAP_COMMS_PUSH_OK",
      message: "Comms push complete",
      warnings: [],
      data: { commsDir, changed: true },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logError(`Push failed: ${msg}`);
    return {
      ok: false,
      command: "comms",
      code: "TAP_COMMS_PUSH_FAILED",
      message: `Push failed: ${msg}`,
      warnings: [],
      data: { commsDir },
    };
  }
}

export async function commsCommand(args: string[]): Promise<CommandResult> {
  const subcommand = args[0];

  if (!subcommand || subcommand === "--help" || subcommand === "-h") {
    log(COMMS_HELP);
    return {
      ok: true,
      command: "comms",
      code: "TAP_NO_OP",
      message: COMMS_HELP,
      warnings: [],
      data: {},
    };
  }

  const repoRoot = findRepoRoot();
  // --comms-dir flag > config (shared/local/env) > auto-default
  const commsDir = resolveCommsDirFromArgs(args, repoRoot);

  switch (subcommand) {
    case "pull":
      return commsPull(commsDir);
    case "push":
      return commsPush(commsDir);
    default:
      return {
        ok: false,
        command: "comms",
        code: "TAP_INVALID_ARGUMENT",
        message: `Unknown comms subcommand: ${subcommand}. Use pull or push.`,
        warnings: [],
        data: {},
      };
  }
}
