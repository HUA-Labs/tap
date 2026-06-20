import * as fs from "node:fs";
import * as path from "node:path";
import { getCodexConfigPath } from "../adapters/common.js";
import { backupFile, ensureBackupDir, getStateDir } from "../state.js";
import type { CommandResult } from "../types.js";
import { findRepoRoot, log, logSuccess, parseArgs } from "../utils.js";
import { readyCommand } from "./ready.js";

const PERMISSIONS_HELP = `
Usage:
  tap permissions restore --backup <path> [--profile <id>] [--profile-pack <path>] [--reload-profile <id>] [--apply]

Description:
  Restore a Codex permission config from a tap-managed backup.

Options:
  --backup <path>          Required backup file under .tap-comms/backups/codex/
  --profile <id>           Optional known ready profile for reload/readiness guidance
  --profile-pack <path>    Reviewed local profile pack for profile guidance
  --reload-profile <id>    Optional reviewed reload profile to apply after restore
  --apply                  Write the restore. Without --apply this is a dry-run.
  --help, -h               Show help

Examples:
  tap permissions restore --backup .tap-comms/backups/codex/config.toml.abc.bak
  tap permissions restore --backup .tap-comms/backups/codex/config.toml.abc.bak --apply
  tap permissions restore --backup .tap-comms/backups/codex/config.toml.abc.bak --apply --reload-profile <profile-id>
`.trim();

interface PermissionsRestoreData {
  mode: "dry-run" | "apply";
  backupPath: string;
  targetPath: string;
  restored: boolean;
  preRestoreBackupPath: string | null;
  runtimeReloadRequired: boolean;
  profile: PermissionsProfileId | null;
  reloadProfile: PermissionsReloadProfileId | null;
  reloadProfileAction: PermissionsReloadProfileAction | null;
  nextActions: PermissionsNextAction[];
}

type PermissionsProfileId = string;
type PermissionsReloadProfileId = string;

interface PermissionsNextAction {
  label: string;
  command: string;
}

interface PermissionsReloadProfileAction {
  profile: PermissionsReloadProfileId;
  status: "would-apply" | "applied" | "failed";
  command: string;
  message: string;
  resultCode?: string;
  resultStatus?: unknown;
}

type ReloadProfileApplier = (
  profile: PermissionsReloadProfileId,
  profilePackPath: string | null,
) => Promise<CommandResult>;

let reloadProfileApplierForTests: ReloadProfileApplier | null = null;

export function __setPermissionsReloadProfileApplierForTests(
  runner: ReloadProfileApplier | null,
): void {
  reloadProfileApplierForTests = runner;
}

function invalidArgument(message: string): CommandResult {
  return {
    ok: false,
    command: "permissions",
    code: "TAP_INVALID_ARGUMENT",
    message,
    warnings: [],
    data: {},
  };
}

function resolveRequiredPathFlag(
  flags: Record<string, string | boolean>,
  name: string,
): string | null {
  const value = flags[name];
  return typeof value === "string" && value.trim() ? value : null;
}

function isSubpath(candidate: string, parent: string): boolean {
  const relative = path.relative(parent, candidate);
  return (
    relative === "" ||
    (!!relative && !relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

function resolveBackupPath(repoRoot: string, backupInput: string): string {
  return path.resolve(repoRoot, backupInput);
}

function parseRestoreProfile(
  flags: Record<string, string | boolean>,
): PermissionsProfileId | null | "invalid" {
  const value = flags.profile;
  if (value === undefined) return null;
  if (typeof value === "string" && value.trim()) return value.trim();
  return "invalid";
}

function parseReloadProfile(
  flags: Record<string, string | boolean>,
): PermissionsReloadProfileId | null | "invalid" {
  const value = flags["reload-profile"];
  if (value === undefined) return null;
  if (typeof value === "string" && value.trim()) return value.trim();
  return "invalid";
}

function buildReloadNextActions(
  profile: PermissionsProfileId | null,
  profilePackPath: string | null,
): PermissionsNextAction[] {
  if (!profile) return [];
  const profilePackArg = profilePackPath
    ? ` --profile-pack ${shellQuote(profilePackPath)}`
    : "";
  return [
    {
      label: "Verify Codex profile readiness",
      command: `tap ready --profile ${profile}${profilePackArg} --json`,
    },
    {
      label: "Apply reviewed ready profile after restore",
      command: `tap ready --profile ${profile}${profilePackArg} --apply --json`,
    },
  ];
}

function buildReloadProfileCommand(
  profile: PermissionsReloadProfileId,
  profilePackPath: string | null,
): string {
  const profilePackArg = profilePackPath
    ? ` --profile-pack ${shellQuote(profilePackPath)}`
    : "";
  return `tap ready --profile ${profile}${profilePackArg} --apply --json`;
}

function buildWouldApplyReloadProfileAction(
  profile: PermissionsReloadProfileId,
  profilePackPath: string | null,
): PermissionsReloadProfileAction {
  return {
    profile,
    status: "would-apply",
    command: buildReloadProfileCommand(profile, profilePackPath),
    message: `would apply reload profile ${profile} after restore`,
  };
}

async function applyReloadProfile(
  profile: PermissionsReloadProfileId,
  profilePackPath: string | null,
): Promise<CommandResult> {
  if (reloadProfileApplierForTests) {
    return reloadProfileApplierForTests(profile, profilePackPath);
  }
  return readyCommand([
    "--profile",
    profile,
    ...(profilePackPath ? ["--profile-pack", profilePackPath] : []),
    "--apply",
  ]);
}

function getCommandDataStatus(result: CommandResult): unknown {
  return result.data && "status" in result.data
    ? result.data.status
    : undefined;
}

function isReloadProfileReady(result: CommandResult): boolean {
  return result.ok && getCommandDataStatus(result) === "ready";
}

function summarizeReloadProfileAction(
  profile: PermissionsReloadProfileId,
  profilePackPath: string | null,
  result: CommandResult,
): PermissionsReloadProfileAction {
  const ready = isReloadProfileReady(result);
  return {
    profile,
    status: ready ? "applied" : "failed",
    command: buildReloadProfileCommand(profile, profilePackPath),
    message: ready
      ? `applied reload profile ${profile}: ${result.message}`
      : `failed to apply reload profile ${profile}: ${result.message}`,
    resultCode: result.code,
    resultStatus: getCommandDataStatus(result),
  };
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function assertTapManagedCodexBackup(
  repoRoot: string,
  backupPath: string,
): string | null {
  const resolvedBackupPath = path.resolve(backupPath);
  if (
    !fs.existsSync(resolvedBackupPath) ||
    !fs.statSync(resolvedBackupPath).isFile()
  ) {
    return `Invalid --backup: file does not exist at ${resolvedBackupPath}.`;
  }
  const backupDir = fs.realpathSync(
    path.resolve(ensureBackupDir(getStateDir(repoRoot), "codex")),
  );
  const realBackupPath = fs.realpathSync(resolvedBackupPath);
  if (!isSubpath(realBackupPath, backupDir)) {
    return `Invalid --backup: expected a file under ${backupDir}.`;
  }
  return null;
}

export async function permissionsCommand(
  args: string[],
): Promise<CommandResult<Record<string, unknown>>> {
  if (args.includes("--help") || args.includes("-h")) {
    log(PERMISSIONS_HELP);
    return {
      ok: true,
      command: "permissions",
      code: "TAP_NO_OP",
      message: PERMISSIONS_HELP,
      warnings: [],
      data: {},
    };
  }

  const { positional, flags } = parseArgs(args);
  const subcommand = positional[0];
  if (subcommand !== "restore") {
    return invalidArgument(
      "Unknown permissions subcommand. Usage: tap permissions restore --backup <path> [--apply]",
    );
  }

  const backupInput = resolveRequiredPathFlag(flags, "backup");
  if (!backupInput) {
    return invalidArgument("Missing --backup <path>.");
  }

  const repoRoot = findRepoRoot();
  const backupPath = resolveBackupPath(repoRoot, backupInput);
  const backupError = assertTapManagedCodexBackup(repoRoot, backupPath);
  if (backupError) return invalidArgument(backupError);
  if (flags.target !== undefined) {
    return invalidArgument(
      "--target is not supported for permission restore; the target is the active Codex config.toml.",
    );
  }
  const profile = parseRestoreProfile(flags);
  if (profile === "invalid") {
    return invalidArgument(
      "Invalid --profile: expected a reviewed local permissions profile id.",
    );
  }
  const reloadProfile = parseReloadProfile(flags);
  if (reloadProfile === "invalid") {
    return invalidArgument(
      "Invalid --reload-profile: expected a reviewed local reload profile id.",
    );
  }
  const profilePackPath =
    typeof flags["profile-pack"] === "string"
      ? flags["profile-pack"].trim()
      : null;
  if (flags["profile-pack"] === true || profilePackPath === "") {
    return invalidArgument("Missing --profile-pack <path> value.");
  }

  const targetPath = getCodexConfigPath();
  const apply = flags.apply === true;

  const data: PermissionsRestoreData & Record<string, unknown> = {
    mode: apply ? "apply" : "dry-run",
    backupPath,
    targetPath,
    restored: false,
    preRestoreBackupPath: null,
    runtimeReloadRequired: false,
    profile,
    reloadProfile,
    reloadProfileAction: reloadProfile
      ? buildWouldApplyReloadProfileAction(reloadProfile, profilePackPath)
      : null,
    nextActions: [],
  };

  if (!apply) {
    return {
      ok: true,
      command: "permissions",
      code: "TAP_PERMISSIONS_RESTORE_OK",
      message: `Dry-run: would restore ${targetPath} from ${backupPath}. Add --apply to write.`,
      warnings: [],
      data,
    };
  }

  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  if (fs.existsSync(targetPath)) {
    data.preRestoreBackupPath = backupFile(
      targetPath,
      ensureBackupDir(getStateDir(repoRoot), "codex"),
    );
  }

  const tmp = `${targetPath}.tmp.${process.pid}`;
  fs.copyFileSync(backupPath, tmp);
  fs.renameSync(tmp, targetPath);
  data.restored = true;
  data.runtimeReloadRequired = true;
  data.nextActions = buildReloadNextActions(profile, profilePackPath);

  if (reloadProfile) {
    const reloadResult = await applyReloadProfile(
      reloadProfile,
      profilePackPath,
    );
    data.reloadProfileAction = summarizeReloadProfileAction(
      reloadProfile,
      profilePackPath,
      reloadResult,
    );
    if (!isReloadProfileReady(reloadResult)) {
      return {
        ok: false,
        command: "permissions",
        code: "TAP_VERIFY_FAILED",
        message: `Restored ${targetPath} from ${backupPath}, but reload profile ${reloadProfile} failed: ${reloadResult.message}`,
        warnings: reloadResult.warnings,
        data,
      };
    }
  }

  logSuccess(`Restored Codex config: ${targetPath}`);

  return {
    ok: true,
    command: "permissions",
    code: "TAP_PERMISSIONS_RESTORE_OK",
    message: profile
      ? `Restored ${targetPath} from ${backupPath}. Re-verify runtime readiness with profile ${profile}.`
      : `Restored ${targetPath} from ${backupPath}. Re-verify or restart the runtime that should consume this config.`,
    warnings: [],
    data,
  };
}
