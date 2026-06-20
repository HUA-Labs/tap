import * as fs from "node:fs";
import * as path from "node:path";
import { getCodexConfigPath, toForwardSlashPath } from "../adapters/common.js";
import { resolveConfig } from "../config/index.js";
import { createInitialState, getStatePath, saveState } from "../state.js";
import type { CommandResult } from "../types.js";
import { findRepoRoot, log, logHeader, parseArgs } from "../utils.js";
import { version } from "../version.js";

const SETUP_HELP = `
Usage:
  tap setup --profile <codex-cli|codex-app|claude-channel> [--dry-run] [--json]
  tap setup --profile <codex-cli|codex-app|claude-channel> --apply [--json]

Description:
  Generate a dry-run-first setup report for public tap deployment. The first
  apply implementation creates reviewed tap-owned directories, an initial tap
  state file, and guarded tap-managed repo .mcp.json changes. It never starts
  processes, changes runtime identity, or publishes route/presence state.

Options:
  --profile <id>        Public setup profile: codex-cli, codex-app, claude-channel.
  --agent <name>        Optional runtime identity for profile-specific probes.
  --profile-pack <path> Validate a profile pack as data-only setup context.
  --fresh-minutes <n>   Presence freshness window for setup probes. Default: 30.
  --dry-run             Report only. This is the default.
  --apply               Create reviewed setup directories, initial state, and guarded tap-managed repo .mcp.json changes.
  --comms-dir <path>    Override comms directory path for report resolution.
  --help, -h            Show help.
`.trim();

export type SetupProfile = "codex-cli" | "codex-app" | "claude-channel";
export type SetupStatus = "ready" | "partial" | "blocked" | "not-configured";
export type SetupPhaseStatus = "pass" | "warn" | "fail" | "skip";
export type SetupApplyPlanStatus =
  | "preview"
  | "applied"
  | "partial"
  | "blocked"
  | "not-supported";
export type SetupMutationKind =
  | "directory-create"
  | "json-file-create"
  | "state-file-create"
  | "json-file-edit"
  | "permission-restore"
  | "profile-pack-validate"
  | "manual-only";
export type SetupRisk =
  | "read-only"
  | "file-create"
  | "config-edit"
  | "permission-edit"
  | "process-start"
  | "process-restart"
  | "presence-write"
  | "inbox-write";
export type SetupConfigTargetKind =
  | "repo-mcp"
  | "codex-config"
  | "claude-settings"
  | "runtime-config"
  | "profile-pack";

const PROFILE_PACK_SCHEMA_VERSION = "tap-profile-pack.v0";
const PROFILE_PACK_RUNTIME_SURFACES = new Set(["codex-cli", "remote-panel"]);
const PROFILE_PACK_COMMAND_RISKS = new Set([
  "read-only",
  "process-start",
  "process-restart",
  "presence-write",
  "inbox-write",
]);

export interface SetupAction {
  id: string;
  label: string;
  command?: string;
  file?: string;
  risk: SetupRisk;
  appliesWith: "--apply" | "manual" | "future-explicit-flag";
  defaultEnabled: boolean;
  reviewRequired: boolean;
  reason: string;
}

export interface SetupConfigTarget {
  kind: SetupConfigTargetKind;
  runtime: SetupProfile | string;
  path: string;
  exists: boolean;
  status: "ready" | "missing" | "partial" | "unmanaged" | "blocked";
  writable?: boolean;
  managedByTap: boolean;
  source: "detected" | "configured" | "default" | "profile-pack";
  action?: SetupAction;
}

export interface SetupEnvironment {
  cwd: string;
  platform: string;
  packageVersion?: string;
  repoRoot?: string;
  commsDir?: string;
  stateDir?: string;
  agent?: string;
  freshMinutes?: number;
  mcpConfigTargets: SetupConfigTarget[];
  profilePack?: SetupProfilePackValidation;
}

export interface SetupCheck {
  id: string;
  label: string;
  status: SetupPhaseStatus;
  message: string;
  evidence?: Record<string, unknown>;
}

export interface SetupPhase {
  id:
    | "config"
    | "permissions"
    | "identity"
    | "warmup"
    | "runtime"
    | "receive"
    | "status"
    | "delivery"
    | "doctor";
  status: SetupPhaseStatus;
  summary: string;
  checks: SetupCheck[];
  actions: SetupAction[];
}

export interface SetupResidual {
  id: string;
  severity: "info" | "warn" | "blocker";
  message: string;
  nextAction?: string;
}

export interface SetupMutation {
  id: string;
  kind: SetupMutationKind;
  phase: SetupPhase["id"];
  actionId: string;
  targetPath?: string;
  status: "planned" | "applied" | "skipped" | "blocked" | "failed";
  risk: SetupRisk;
  defaultEnabled: boolean;
  reviewRequired: boolean;
  reason: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  backupPath?: string;
}

export interface SetupApplyGuard {
  id: string;
  status: "pass" | "warn" | "fail";
  message: string;
  evidence?: Record<string, unknown>;
}

export interface SetupApplyEvidence {
  id: string;
  mutationId: string;
  status: "planned" | "written" | "verified" | "failed";
  path?: string;
  checksum?: string;
  message: string;
}

export interface SetupRollbackStep {
  id: string;
  mutationId: string;
  action: "delete-created-path" | "restore-backup" | "manual";
  targetPath?: string;
  backupPath?: string;
  status: "available" | "not-needed" | "manual-only";
  message: string;
}

export interface SetupApplyPlan {
  status: SetupApplyPlanStatus;
  generatedAt: string;
  profile: SetupProfile;
  dryRun: boolean;
  apply: boolean;
  mutations: SetupMutation[];
  guards: SetupApplyGuard[];
  evidence: SetupApplyEvidence[];
  rollback: SetupRollbackStep[];
  residual: SetupResidual[];
}

export interface TapSetupReport extends Record<string, unknown> {
  command: "setup";
  profile: SetupProfile;
  dryRun: boolean;
  apply: boolean;
  status: SetupStatus;
  generatedAt: string;
  summary: string;
  environment: SetupEnvironment;
  phases: SetupPhase[];
  actions: SetupAction[];
  nextActions: SetupAction[];
  residual: SetupResidual[];
  applyPlan?: SetupApplyPlan;
}

export interface SetupProfilePackValidationError {
  path: string;
  message: string;
}

export interface SetupProfilePackValidationSummary {
  path: string;
  exists: boolean;
  status: "valid" | "missing" | "invalid";
  schemaVersion?: string | null;
  packId?: string | null;
  label?: string | null;
  profileCount: number;
  profileIds: string[];
  commandCount: number;
  commandRiskCounts: Record<string, number>;
  errors: SetupProfilePackValidationError[];
}

export interface SetupProfilePackValidation {
  targetPath: string;
  summary: SetupProfilePackValidationSummary;
}

function invalidArgument(message: string): CommandResult {
  return {
    ok: false,
    command: "setup",
    code: "TAP_INVALID_ARGUMENT",
    message,
    warnings: [],
    data: {},
  };
}

export function parseSetupProfile(
  value: string | boolean | undefined,
): SetupProfile | null {
  if (
    value === "codex-cli" ||
    value === "codex-app" ||
    value === "claude-channel"
  ) {
    return value;
  }
  return null;
}

function checkWritableWithoutCreate(targetPath: string): boolean | undefined {
  try {
    if (fs.existsSync(targetPath)) {
      fs.accessSync(targetPath, fs.constants.W_OK);
      return true;
    }

    const parent = path.dirname(targetPath);
    if (!fs.existsSync(parent)) return undefined;
    fs.accessSync(parent, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function manualAction(
  id: string,
  label: string,
  reason: string,
  command?: string,
  file?: string,
  risk: SetupRisk = "read-only",
): SetupAction {
  return {
    id,
    label,
    command,
    file,
    risk,
    appliesWith: "manual",
    defaultEnabled: false,
    reviewRequired: false,
    reason,
  };
}

function reviewedManualAction(
  id: string,
  label: string,
  reason: string,
  command: string,
  risk: SetupRisk,
): SetupAction {
  return {
    id,
    label,
    command,
    risk,
    appliesWith: "manual",
    defaultEnabled: false,
    reviewRequired: true,
    reason,
  };
}

function futureAction(
  id: string,
  label: string,
  reason: string,
  risk: SetupRisk,
  command?: string,
  file?: string,
): SetupAction {
  return {
    id,
    label,
    command,
    file,
    risk,
    appliesWith: "future-explicit-flag",
    defaultEnabled: false,
    reviewRequired: true,
    reason,
  };
}

function targetStatus(exists: boolean): SetupConfigTarget["status"] {
  return exists ? "unmanaged" : "missing";
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
    : [];
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

function readJsonFile(filePath: string): Record<string, unknown> | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return objectValue(parsed);
  } catch {
    return null;
  }
}

function readJsonFileResult(
  filePath: string,
):
  | { status: "missing" }
  | { status: "ok"; value: Record<string, unknown> }
  | { status: "invalid"; error: string } {
  try {
    if (!fs.existsSync(filePath)) return { status: "missing" };
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const value = objectValue(parsed);
    if (!value) {
      return {
        status: "invalid",
        error: "JSON root must be an object",
      };
    }
    return { status: "ok", value };
  } catch (error) {
    return {
      status: "invalid",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function addProfilePackError(
  errors: SetupProfilePackValidationError[],
  pathName: string,
  message: string,
): void {
  errors.push({ path: pathName, message });
}

function validateProfilePackString(
  errors: SetupProfilePackValidationError[],
  object: Record<string, unknown> | null,
  field: string,
  pathName: string,
  options: { oneOf?: Set<string> } = {},
): string | null {
  const value = object?.[field];
  if (typeof value !== "string" || value.trim() === "") {
    addProfilePackError(errors, pathName, "must be a non-empty string");
    return null;
  }
  if (options.oneOf && !options.oneOf.has(value)) {
    addProfilePackError(
      errors,
      pathName,
      `must be one of: ${[...options.oneOf].join(", ")}`,
    );
  }
  return value;
}

function validateProfilePackBoolean(
  errors: SetupProfilePackValidationError[],
  object: Record<string, unknown> | null,
  field: string,
  pathName: string,
): boolean | null {
  const value = object?.[field];
  if (typeof value !== "boolean") {
    addProfilePackError(errors, pathName, "must be a boolean");
    return null;
  }
  return value;
}

function validateProfilePackCommands(
  errors: SetupProfilePackValidationError[],
  profile: Record<string, unknown>,
  pathName: string,
  riskCounts: Record<string, number>,
): Set<string> {
  const commands = profile.commands;
  if (commands === undefined) return new Set();
  const commandCatalog = objectValue(commands);
  if (!commandCatalog) {
    addProfilePackError(errors, `${pathName}.commands`, "must be an object");
    return new Set();
  }

  const commandRefs = new Set(Object.keys(commandCatalog));
  for (const [commandId, commandValue] of Object.entries(commandCatalog)) {
    const command = objectValue(commandValue);
    const commandPath = `${pathName}.commands.${commandId}`;
    if (!command) {
      addProfilePackError(errors, commandPath, "must be an object");
      continue;
    }
    validateProfilePackString(errors, command, "shell", `${commandPath}.shell`);
    const risk = validateProfilePackString(
      errors,
      command,
      "risk",
      `${commandPath}.risk`,
    );
    if (risk && !PROFILE_PACK_COMMAND_RISKS.has(risk)) {
      addProfilePackError(
        errors,
        `${commandPath}.risk`,
        `must be one of: ${[...PROFILE_PACK_COMMAND_RISKS].join(", ")}`,
      );
    } else if (risk) {
      riskCounts[risk] = (riskCounts[risk] ?? 0) + 1;
    }
    const reviewRequired = validateProfilePackBoolean(
      errors,
      command,
      "reviewRequired",
      `${commandPath}.reviewRequired`,
    );
    if (reviewRequired === false) {
      addProfilePackError(
        errors,
        `${commandPath}.reviewRequired`,
        "must be true in v0",
      );
    }
    const defaultEnabled = validateProfilePackBoolean(
      errors,
      command,
      "defaultEnabled",
      `${commandPath}.defaultEnabled`,
    );
    if (defaultEnabled === true) {
      addProfilePackError(
        errors,
        `${commandPath}.defaultEnabled`,
        "must be false in v0",
      );
    }
  }
  return commandRefs;
}

function validateProfilePackFile(
  profilePackPath: string,
): SetupProfilePackValidation {
  const targetPath = path.resolve(profilePackPath);
  const readResult = readJsonFileResult(targetPath);
  const errors: SetupProfilePackValidationError[] = [];
  const summary: SetupProfilePackValidationSummary = {
    path: toForwardSlashPath(targetPath),
    exists: readResult.status !== "missing",
    status: "invalid",
    schemaVersion: null,
    packId: null,
    label: null,
    profileCount: 0,
    profileIds: [],
    commandCount: 0,
    commandRiskCounts: {},
    errors,
  };

  if (readResult.status === "missing") {
    summary.status = "missing";
    addProfilePackError(errors, "$", "profile pack file is missing");
    return { targetPath, summary };
  }
  if (readResult.status === "invalid") {
    addProfilePackError(errors, "$", readResult.error);
    return { targetPath, summary };
  }

  const profilePack = readResult.value;
  const schemaVersion = validateProfilePackString(
    errors,
    profilePack,
    "schemaVersion",
    "schemaVersion",
  );
  summary.schemaVersion = schemaVersion;
  if (schemaVersion && schemaVersion !== PROFILE_PACK_SCHEMA_VERSION) {
    addProfilePackError(
      errors,
      "schemaVersion",
      `must be ${PROFILE_PACK_SCHEMA_VERSION} for this contract`,
    );
  }
  summary.packId = validateProfilePackString(
    errors,
    profilePack,
    "packId",
    "packId",
  );
  summary.label = validateProfilePackString(
    errors,
    profilePack,
    "label",
    "label",
  );

  const profiles = Array.isArray(profilePack.profiles)
    ? profilePack.profiles
    : [];
  if (!Array.isArray(profilePack.profiles) || profiles.length === 0) {
    addProfilePackError(errors, "profiles", "must be a non-empty array");
  }

  const seenProfileIds = new Set<string>();
  for (const [index, profileValue] of profiles.entries()) {
    const profile = objectValue(profileValue);
    const profilePath = `profiles[${index}]`;
    if (!profile) {
      addProfilePackError(errors, profilePath, "must be an object");
      continue;
    }

    const id = validateProfilePackString(
      errors,
      profile,
      "id",
      `${profilePath}.id`,
    );
    if (id) {
      if (seenProfileIds.has(id)) {
        addProfilePackError(errors, `${profilePath}.id`, "must be unique");
      }
      seenProfileIds.add(id);
      summary.profileIds.push(id);
    }
    validateProfilePackString(errors, profile, "label", `${profilePath}.label`);
    validateProfilePackString(errors, profile, "agent", `${profilePath}.agent`);
    validateProfilePackString(
      errors,
      profile,
      "runtimeSurface",
      `${profilePath}.runtimeSurface`,
      { oneOf: PROFILE_PACK_RUNTIME_SURFACES },
    );

    const paths = objectValue(profile.paths);
    if (!paths) {
      addProfilePackError(errors, `${profilePath}.paths`, "must be an object");
    } else {
      validateProfilePackString(
        errors,
        paths,
        "repoRoot",
        `${profilePath}.paths.repoRoot`,
      );
      validateProfilePackString(
        errors,
        paths,
        "commsDir",
        `${profilePath}.paths.commsDir`,
      );
    }

    const capabilities = objectValue(profile.capabilities);
    if (!capabilities) {
      addProfilePackError(
        errors,
        `${profilePath}.capabilities`,
        "must be an object",
      );
    } else {
      validateProfilePackBoolean(
        errors,
        capabilities,
        "ready",
        `${profilePath}.capabilities.ready`,
      );
      validateProfilePackBoolean(
        errors,
        capabilities,
        "status",
        `${profilePath}.capabilities.status`,
      );
      validateProfilePackBoolean(
        errors,
        capabilities,
        "apply",
        `${profilePath}.capabilities.apply`,
      );
    }

    const commandRefs = validateProfilePackCommands(
      errors,
      profile,
      profilePath,
      summary.commandRiskCounts,
    );
    summary.commandCount += commandRefs.size;

    if (profile.ready !== undefined) {
      const ready = objectValue(profile.ready);
      if (!ready) {
        addProfilePackError(
          errors,
          `${profilePath}.ready`,
          "must be an object when present",
        );
      } else {
        validateProfilePackString(
          errors,
          ready,
          "surface",
          `${profilePath}.ready.surface`,
          { oneOf: PROFILE_PACK_RUNTIME_SURFACES },
        );
        const commandRef = validateProfilePackString(
          errors,
          ready,
          "commandRef",
          `${profilePath}.ready.commandRef`,
        );
        if (commandRef && !commandRefs.has(commandRef)) {
          addProfilePackError(
            errors,
            `${profilePath}.ready.commandRef`,
            "must reference a command in profile.commands",
          );
        }
      }
    }

    if (profile.status !== undefined) {
      const status = objectValue(profile.status);
      if (!status) {
        addProfilePackError(
          errors,
          `${profilePath}.status`,
          "must be an object when present",
        );
      } else {
        validateProfilePackString(
          errors,
          status,
          "kind",
          `${profilePath}.status.kind`,
          { oneOf: PROFILE_PACK_RUNTIME_SURFACES },
        );
      }
    }
  }

  summary.profileIds.sort();
  summary.profileCount = summary.profileIds.length;
  summary.status = errors.length === 0 ? "valid" : "invalid";
  return { targetPath, summary };
}

function shallowObjectKeys(value: unknown): string[] {
  return Object.keys(objectValue(value) ?? {}).sort();
}

function arraysEqual(left: unknown, right: unknown): boolean {
  if (!Array.isArray(left) || !Array.isArray(right)) return false;
  if (left.length !== right.length) return false;
  return left.every((item, index) => item === right[index]);
}

function generatedMcpEntry(environment: SetupEnvironment): {
  entry: Record<string, unknown>;
  summary: Record<string, unknown>;
} {
  const env: Record<string, string> = {
    TAP_AGENT_NAME: environment.agent ?? "<set-per-runtime>",
    TAP_COMMS_DIR: toForwardSlashPath(environment.commsDir ?? ""),
    TAP_STATE_DIR: toForwardSlashPath(environment.stateDir ?? ""),
    TAP_REPO_ROOT: toForwardSlashPath(environment.repoRoot ?? ""),
    TAP_CHANNEL_LOG_PATH: toForwardSlashPath(
      path.join(environment.stateDir ?? "", "logs", "tap-mcp.log"),
    ),
  };
  const entry = {
    type: "stdio",
    command: "npx",
    args: ["@hua-labs/tap", "serve"],
    cwd: toForwardSlashPath(environment.repoRoot ?? ""),
    env,
    managedBy: "tap",
    schemaVersion: "setup-mcp-v0",
  };
  const summary: Record<string, unknown> = {
    serverKey: "tap",
    type: entry.type,
    command: entry.command,
    args: entry.args,
    cwd: entry.cwd,
    envKeys: Object.keys(entry.env).sort(),
    managedBy: "tap",
    schemaVersion: entry.schemaVersion,
  };
  return { entry, summary };
}

function summarizeMcpEntry(entry: unknown): Record<string, unknown> {
  const record = objectValue(entry);
  return {
    exists: Boolean(record),
    keys: shallowObjectKeys(record),
    hasCommand: typeof record?.command === "string",
    hasArgs: Array.isArray(record?.args),
    envKeys: shallowObjectKeys(record?.env),
    managedByTap: record?.managedBy === "tap",
    schemaVersion:
      typeof record?.schemaVersion === "string" ? record.schemaVersion : null,
  };
}

function isExplicitTapManagedEntry(entry: Record<string, unknown>): boolean {
  return (
    entry.managedBy === "tap" &&
    (typeof entry.schemaVersion === "string" ||
      typeof entry.provenanceVersion === "string" ||
      typeof entry.tapManagedVersion === "string")
  );
}

function structurallyMatchesGeneratedMcpEntry(
  entry: Record<string, unknown>,
  generatedEntry: Record<string, unknown>,
): boolean {
  const entryEnv = objectValue(entry.env);
  const generatedEnv = objectValue(generatedEntry.env);
  if (!entryEnv || !generatedEnv) return false;
  const entryKeys = Object.keys(entry).sort();
  const generatedKeys = Object.keys(generatedEntry).sort();
  return (
    arraysEqual(entryKeys, generatedKeys) &&
    entry.type === generatedEntry.type &&
    entry.command === generatedEntry.command &&
    entry.cwd === generatedEntry.cwd &&
    entry.managedBy === generatedEntry.managedBy &&
    entry.schemaVersion === generatedEntry.schemaVersion &&
    arraysEqual(entry.args, generatedEntry.args) &&
    arraysEqual(Object.keys(entryEnv).sort(), Object.keys(generatedEnv).sort())
  );
}

function timestampAgeSeconds(value: unknown): number | null {
  const timestamp = stringValue(value);
  if (!timestamp) return null;
  const parsed = Date.parse(timestamp);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, (Date.now() - parsed) / 1000);
}

function routeValue(
  record: Record<string, unknown> | null,
  key: "conversationId" | "ownerClientId",
): string | null {
  const address = objectValue(record?.address);
  const capabilities = objectValue(record?.capabilities);
  return (
    stringValue(address?.[key]) ??
    stringValue(capabilities?.[key]) ??
    stringValue(record?.[key])
  );
}

function classifyRuntimeHealth(value: string | null): SetupPhaseStatus {
  if (!value) return "warn";
  return value === "ready" ? "pass" : "fail";
}

function agentFromEnvironment(): string | undefined {
  return (
    process.env.TAP_AGENT_NAME?.trim() ||
    process.env.CODEX_TAP_AGENT_NAME?.trim() ||
    undefined
  );
}

function validPresenceAgentName(agent: string): boolean {
  return Boolean(agent.trim()) && !/[\\/]/.test(agent);
}

function parsePositiveInteger(
  value: string | boolean | undefined,
  fallback: number,
): number {
  if (typeof value !== "string") return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function buildConfigTarget(
  kind: SetupConfigTargetKind,
  runtime: SetupProfile,
  filePath: string,
  action: SetupAction,
): SetupConfigTarget {
  const exists = fs.existsSync(filePath);
  return {
    kind,
    runtime,
    path: toForwardSlashPath(filePath),
    exists,
    status: targetStatus(exists),
    writable: checkWritableWithoutCreate(filePath),
    managedByTap: false,
    source: "detected",
    action,
  };
}

function buildConfigTargets(
  profile: SetupProfile,
  repoRoot: string,
  profilePack?: SetupProfilePackValidation,
): SetupConfigTarget[] {
  const repoMcp = buildConfigTarget(
    "repo-mcp",
    profile,
    path.join(repoRoot, ".mcp.json"),
    manualAction(
      "inspect-repo-mcp-config",
      "Inspect repo MCP config",
      "setup reports repo MCP config presence but does not edit it in the read-only slice",
      undefined,
      path.join(repoRoot, ".mcp.json"),
    ),
  );
  const profilePackTarget = profilePack
    ? [
        {
          kind: "profile-pack" as const,
          runtime: profile,
          path: profilePack.summary.path,
          exists: profilePack.summary.exists,
          status:
            profilePack.summary.status === "valid"
              ? ("ready" as const)
              : profilePack.summary.status === "missing"
                ? ("missing" as const)
                : ("blocked" as const),
          writable: false,
          managedByTap: false,
          source: "profile-pack" as const,
          action: manualAction(
            "validate-profile-pack",
            "Validate profile pack",
            "setup treats profile packs as data-only context and never executes embedded commands",
            `tap setup --profile ${profile} --profile-pack ${profilePack.summary.path} --json`,
            profilePack.summary.path,
          ),
        },
      ]
    : [];

  if (profile === "claude-channel") {
    return [
      repoMcp,
      buildConfigTarget(
        "claude-settings",
        profile,
        path.join(repoRoot, ".claude", "settings.json"),
        manualAction(
          "inspect-claude-settings",
          "Inspect Claude settings",
          "Claude settings remain user-managed until a reviewed apply contract exists",
          undefined,
          path.join(repoRoot, ".claude", "settings.json"),
        ),
      ),
      ...profilePackTarget,
    ];
  }

  return [
    repoMcp,
    buildConfigTarget(
      "codex-config",
      profile,
      getCodexConfigPath(),
      manualAction(
        "inspect-codex-config",
        "Inspect Codex config",
        "Codex config remains user-managed until a reviewed apply contract exists",
        undefined,
        getCodexConfigPath(),
      ),
    ),
    ...profilePackTarget,
  ];
}

function buildConfigPhase(
  environment: SetupEnvironment,
  profile: SetupProfile,
): SetupPhase {
  const notReadyTargets = environment.mcpConfigTargets.filter(
    (target) => target.status !== "ready" && target.status !== "unmanaged",
  );
  const status: SetupPhaseStatus = notReadyTargets.some(
    (target) => target.status === "blocked",
  )
    ? "fail"
    : notReadyTargets.length === 0
      ? "pass"
      : "warn";
  const actions = notReadyTargets.map((target) =>
    manualAction(
      `prepare-${target.kind}`,
      `Prepare ${target.kind}`,
      target.kind === "profile-pack"
        ? "profile-pack input must pass data-only validation before setup apply can proceed"
        : "read-only setup only reports missing config targets",
      target.kind === "profile-pack"
        ? `tap setup --profile ${profile} --profile-pack ${target.path} --json`
        : "tap init",
      target.path,
      target.kind === "profile-pack" ? "read-only" : "file-create",
    ),
  );
  const profilePackCheck: SetupCheck[] = environment.profilePack
    ? [
        {
          id: "profile-pack-validation",
          label: "Profile pack validation",
          status:
            environment.profilePack.summary.status === "valid"
              ? "pass"
              : "fail",
          message:
            environment.profilePack.summary.status === "valid"
              ? "profile pack passed v0 data-only validation"
              : `profile pack validation is ${environment.profilePack.summary.status}`,
          evidence: {
            path: environment.profilePack.summary.path,
            exists: environment.profilePack.summary.exists,
            status: environment.profilePack.summary.status,
            schemaVersion: environment.profilePack.summary.schemaVersion,
            packId: environment.profilePack.summary.packId,
            profileCount: environment.profilePack.summary.profileCount,
            profileIds: environment.profilePack.summary.profileIds,
            commandCount: environment.profilePack.summary.commandCount,
            commandRiskCounts:
              environment.profilePack.summary.commandRiskCounts,
            commandsExecution: "not-run",
            commandsReviewRequired: true,
            commandsDefaultEnabled: false,
            errors: environment.profilePack.summary.errors,
          },
        },
      ]
    : [];
  return {
    id: "config",
    status,
    summary:
      status === "pass"
        ? `${profile} config targets are present`
        : status === "fail"
          ? `${profile} config has blocked setup target(s)`
          : `${profile} config has ${notReadyTargets.length} missing target(s)`,
    checks: [
      {
        id: "repo-root",
        label: "Repo root",
        status: environment.repoRoot ? "pass" : "warn",
        message: environment.repoRoot
          ? `repo root resolved to ${environment.repoRoot}`
          : "repo root could not be resolved",
      },
      {
        id: "comms-dir",
        label: "Comms directory",
        status: environment.commsDir ? "pass" : "warn",
        message: environment.commsDir
          ? `comms directory resolves to ${environment.commsDir}`
          : "comms directory could not be resolved",
      },
      {
        id: "mcp-config-targets",
        label: "MCP config targets",
        status,
        message:
          notReadyTargets.length === 0
            ? "all reported config targets exist"
            : `${notReadyTargets.length} reported config target(s) need attention`,
        evidence: {
          targets: environment.mcpConfigTargets.map((target) => ({
            kind: target.kind,
            path: target.path,
            exists: target.exists,
            status: target.status,
            managedByTap: target.managedByTap,
          })),
        },
      },
      ...profilePackCheck,
    ],
    actions,
  };
}

function skeletonPhase(
  id: SetupPhase["id"],
  summary: string,
  nextAction: SetupAction,
): SetupPhase {
  return {
    id,
    status: "warn",
    summary,
    checks: [
      {
        id: `${id}-skeleton`,
        label: `${id} skeleton`,
        status: "warn",
        message:
          "read-only setup skeleton reports the required phase but does not run deep probes yet",
      },
    ],
    actions: [nextAction],
  };
}

function buildCodexAppRuntimePhase(environment: SetupEnvironment): SetupPhase {
  const agent = environment.agent;
  if (!agent) {
    return {
      id: "runtime",
      status: "warn",
      summary: "Codex App route probe needs an explicit agent identity",
      checks: [
        {
          id: "codex-app-agent",
          label: "Codex App agent identity",
          status: "warn",
          message:
            "pass --agent <name> or set TAP_AGENT_NAME inside the target runtime to inspect App route tuple evidence",
        },
      ],
      actions: [
        manualAction(
          "provide-codex-app-agent",
          "Provide Codex App agent identity",
          "setup cannot infer a public Codex App identity without a runtime-local name",
          "tap setup --profile codex-app --agent <name> --json",
        ),
      ],
    };
  }

  if (!validPresenceAgentName(agent)) {
    return {
      id: "runtime",
      status: "fail",
      summary: "Codex App route probe rejected an invalid agent identity",
      checks: [
        {
          id: "codex-app-agent",
          label: "Codex App agent identity",
          status: "fail",
          message:
            "agent identity must not contain path separators when reading presence evidence",
          evidence: { agent },
        },
      ],
      actions: [
        manualAction(
          "provide-safe-codex-app-agent",
          "Provide safe Codex App agent identity",
          "setup only reads presence/<agent>.json and refuses path-like names",
          "tap setup --profile codex-app --agent <name> --json",
        ),
      ],
    };
  }

  const commsDir = environment.commsDir;
  const freshMinutes = environment.freshMinutes ?? 30;
  const presencePath = commsDir
    ? path.join(commsDir, "presence", `${agent}.json`)
    : null;
  const record = presencePath ? readJsonFile(presencePath) : null;
  const timestamp =
    stringValue(record?.timestamp) ?? stringValue(record?.lastActivity);
  const ageSeconds = timestampAgeSeconds(timestamp);
  const fresh =
    ageSeconds !== null &&
    Number.isFinite(ageSeconds) &&
    ageSeconds <= freshMinutes * 60;
  const capabilities = objectValue(record?.capabilities);
  const receiveTransports = unique([
    ...stringArray(record?.receiveTransports),
    ...stringArray(capabilities?.receiveTransports),
  ]);
  const conversationId = routeValue(record, "conversationId");
  const ownerClientId = routeValue(record, "ownerClientId");
  const publishedConsentDriveStatus = stringValue(record?.consentDriveStatus);
  const consentDriveStatus =
    record && !fresh && publishedConsentDriveStatus === "ready"
      ? "stale"
      : publishedConsentDriveStatus;
  const runtimeHealth =
    stringValue(objectValue(record?.health)?.status) ?? "not-observed";

  const routeReady =
    Boolean(record) &&
    fresh &&
    consentDriveStatus === "ready" &&
    runtimeHealth === "ready" &&
    Boolean(conversationId) &&
    Boolean(ownerClientId);

  const status: SetupPhaseStatus = routeReady ? "pass" : "fail";
  const missingTupleParts = [
    conversationId ? null : "conversationId",
    ownerClientId ? null : "ownerClientId",
  ].filter((item): item is string => Boolean(item));
  const checks: SetupCheck[] = [
    {
      id: "codex-app-presence",
      label: "Codex App presence",
      status: record ? (fresh ? "pass" : "fail") : "fail",
      message: record
        ? fresh
          ? `presence snapshot is fresh within ${freshMinutes} minute(s)`
          : `presence snapshot is stale or timestamp is missing for ${agent}`
        : `presence snapshot is missing for ${agent}`,
      evidence: {
        path: presencePath ? toForwardSlashPath(presencePath) : null,
        exists: Boolean(record),
        ageSeconds:
          ageSeconds === null ? null : Math.round(ageSeconds * 10) / 10,
        freshness: record
          ? fresh
            ? "fresh-for-routing"
            : "stale-visible"
          : "missing",
      },
    },
    {
      id: "codex-app-route-tuple",
      label: "Codex App route tuple",
      status: missingTupleParts.length === 0 ? "pass" : "fail",
      message:
        missingTupleParts.length === 0
          ? "presence includes conversationId and ownerClientId"
          : `presence route tuple is incomplete: missing ${missingTupleParts.join(", ")}`,
      evidence: {
        conversationId: conversationId ? "<present>" : null,
        ownerClientId: ownerClientId ? "<present>" : null,
        receiveTransports,
      },
    },
    {
      id: "codex-app-consent-drive",
      label: "Codex App consent-drive",
      status: consentDriveStatus === "ready" ? "pass" : "fail",
      message:
        consentDriveStatus === "ready"
          ? "consent-drive route tuple is ready"
          : `consent-drive route tuple is ${consentDriveStatus ?? "not-observed"}`,
      evidence: {
        consentDriveStatus: consentDriveStatus ?? "not-observed",
      },
    },
    {
      id: "codex-app-runtime-health",
      label: "Codex App runtime health",
      status: classifyRuntimeHealth(runtimeHealth),
      message:
        runtimeHealth === "ready"
          ? "runtime health is ready"
          : `runtime health is ${runtimeHealth}`,
      evidence: { runtimeHealth },
    },
  ];

  const actions = routeReady
    ? [
        manualAction(
          "run-codex-app-ready-report",
          "Run Codex App ready report",
          "`tap ready` remains the post-identity readiness command",
          "tap ready --surface codex-app --agent <name> --json",
        ),
      ]
    : [
        manualAction(
          "refresh-codex-app-warmup",
          "Refresh Codex App warmup",
          "route tuple evidence must be refreshed from the active Codex App runtime; setup does not write presence or attempt live delivery",
          "tap_session_warmup(name:<agent>)",
        ),
        manualAction(
          "run-codex-app-ready-report",
          "Run Codex App ready report",
          "`tap ready` remains the post-identity readiness command",
          "tap ready --surface codex-app --agent <name> --json",
        ),
      ];

  return {
    id: "runtime",
    status,
    summary: routeReady
      ? "Codex App route tuple and runtime health are ready"
      : `Codex App route is fail-closed for ${agent}`,
    checks,
    actions,
  };
}

function buildClaudeChannelRuntimePhase(
  environment: SetupEnvironment,
): SetupPhase {
  const agent = environment.agent;
  if (!agent) {
    return {
      id: "runtime",
      status: "warn",
      summary: "Claude channel probe needs an explicit agent identity",
      checks: [
        {
          id: "claude-channel-agent",
          label: "Claude channel agent identity",
          status: "warn",
          message:
            "pass --agent <name> or set TAP_AGENT_NAME inside the target runtime to inspect channel presence evidence",
        },
      ],
      actions: [
        manualAction(
          "provide-claude-channel-agent",
          "Provide Claude channel agent identity",
          "setup cannot infer a public Claude channel identity without a runtime-local name",
          "tap setup --profile claude-channel --agent <name> --json",
        ),
      ],
    };
  }

  if (!validPresenceAgentName(agent)) {
    return {
      id: "runtime",
      status: "fail",
      summary: "Claude channel probe rejected an invalid agent identity",
      checks: [
        {
          id: "claude-channel-agent",
          label: "Claude channel agent identity",
          status: "fail",
          message:
            "agent identity must not contain path separators when reading presence evidence",
          evidence: { agent },
        },
      ],
      actions: [
        manualAction(
          "provide-safe-claude-channel-agent",
          "Provide safe Claude channel agent identity",
          "setup only reads presence/<agent>.json and refuses path-like names",
          "tap setup --profile claude-channel --agent <name> --json",
        ),
      ],
    };
  }

  const commsDir = environment.commsDir;
  const freshMinutes = environment.freshMinutes ?? 30;
  const presencePath = commsDir
    ? path.join(commsDir, "presence", `${agent}.json`)
    : null;
  const inboxPath = commsDir ? path.join(commsDir, "inbox") : null;
  const record = presencePath ? readJsonFile(presencePath) : null;
  const timestamp =
    stringValue(record?.timestamp) ?? stringValue(record?.lastActivity);
  const ageSeconds = timestampAgeSeconds(timestamp);
  const fresh =
    ageSeconds !== null &&
    Number.isFinite(ageSeconds) &&
    ageSeconds <= freshMinutes * 60;
  const capabilities = objectValue(record?.capabilities);
  const receiveTransports = unique([
    ...stringArray(record?.receiveTransports),
    ...stringArray(capabilities?.receiveTransports),
  ]);
  const hasChannelTransport = receiveTransports.includes("mcp-channel");
  const publishedRuntimeHealth = stringValue(
    objectValue(record?.health)?.status,
  );
  const runtimeHealth =
    record && !fresh && publishedRuntimeHealth === "ready"
      ? "stale"
      : (publishedRuntimeHealth ?? "not-observed");
  const durableInboxExists = inboxPath ? fs.existsSync(inboxPath) : false;

  const channelReady =
    Boolean(record) &&
    fresh &&
    hasChannelTransport &&
    runtimeHealth === "ready" &&
    durableInboxExists;
  const status: SetupPhaseStatus = channelReady ? "pass" : "fail";
  const checks: SetupCheck[] = [
    {
      id: "claude-channel-presence",
      label: "Claude channel presence",
      status: record ? (fresh ? "pass" : "fail") : "fail",
      message: record
        ? fresh
          ? `presence snapshot is fresh within ${freshMinutes} minute(s)`
          : `presence snapshot is stale or timestamp is missing for ${agent}`
        : `presence snapshot is missing for ${agent}`,
      evidence: {
        path: presencePath ? toForwardSlashPath(presencePath) : null,
        exists: Boolean(record),
        ageSeconds:
          ageSeconds === null ? null : Math.round(ageSeconds * 10) / 10,
        freshness: record
          ? fresh
            ? "fresh-for-channel"
            : "stale-visible"
          : "missing",
      },
    },
    {
      id: "claude-channel-transport",
      label: "Claude channel transport",
      status: hasChannelTransport ? "pass" : "fail",
      message: hasChannelTransport
        ? "presence advertises mcp-channel receive transport"
        : "presence does not advertise mcp-channel receive transport",
      evidence: { receiveTransports },
    },
    {
      id: "claude-channel-runtime-health",
      label: "Claude channel runtime health",
      status: classifyRuntimeHealth(runtimeHealth),
      message:
        runtimeHealth === "ready"
          ? "runtime health is ready"
          : `runtime health is ${runtimeHealth}`,
      evidence: { runtimeHealth },
    },
    {
      id: "claude-channel-durable-evidence",
      label: "Claude channel durable evidence",
      status: durableInboxExists ? "pass" : "fail",
      message: durableInboxExists
        ? "durable inbox evidence path is present"
        : "durable inbox evidence path is missing",
      evidence: {
        inboxPath: inboxPath ? toForwardSlashPath(inboxPath) : null,
        exists: durableInboxExists,
      },
    },
  ];

  const actions = channelReady
    ? [
        manualAction(
          "run-claude-ready-report",
          "Run Claude ready report",
          "`tap ready` remains the post-identity readiness command",
          "tap ready --surface claude --agent <name> --json",
        ),
      ]
    : [
        manualAction(
          "refresh-claude-channel-warmup",
          "Refresh Claude channel warmup",
          "channel evidence must be refreshed from the active Claude runtime; setup does not deliver messages, read credentials, or write presence",
          "tap_session_warmup(name:<agent>)",
        ),
        manualAction(
          "run-claude-ready-report",
          "Run Claude ready report",
          "`tap ready` remains the post-identity readiness command",
          "tap ready --surface claude --agent <name> --json",
        ),
      ];

  return {
    id: "runtime",
    status,
    summary: channelReady
      ? "Claude channel presence and runtime health are ready"
      : `Claude channel readiness is fail-closed for ${agent}`,
    checks,
    actions,
  };
}

function readySurfaceForProfile(profile: SetupProfile): string {
  return profile === "claude-channel" ? "claude" : profile;
}

function commandToken(value: string): string {
  return /^[A-Za-z0-9_./:@%+=,-]+$/.test(value)
    ? value
    : `'${value.replace(/'/g, "'\\''")}'`;
}

function setupCommandArgs(
  profile: SetupProfile,
  environment: SetupEnvironment,
): string {
  const agentArg = environment.agent
    ? ` --agent ${commandToken(environment.agent)}`
    : "";
  const profilePackArg = environment.profilePack
    ? ` --profile-pack ${commandToken(environment.profilePack.summary.path)}`
    : "";
  return `--profile ${profile}${agentArg}${profilePackArg}`;
}

function buildPhases(
  profile: SetupProfile,
  environment: SetupEnvironment,
): SetupPhase[] {
  const readySurface = readySurfaceForProfile(profile);
  const readyProfileAction = manualAction(
    "run-ready-report",
    "Run post-identity ready report",
    "`tap ready` remains the post-identity readiness command",
    `tap ready --surface ${readySurface} --agent <name> --json`,
  );
  return [
    buildConfigPhase(environment, profile),
    skeletonPhase(
      "permissions",
      "permission posture is not mutated by setup",
      manualAction(
        "review-permissions",
        "Review permission posture",
        "permission repair is outside this read-only setup slice",
        profile === "claude-channel"
          ? "tap init --permissions safe"
          : `tap ready --surface ${readySurface} --agent <name> --json`,
        undefined,
        profile === "claude-channel" ? "permission-edit" : "read-only",
      ),
    ),
    skeletonPhase(
      "identity",
      "identity must be set explicitly in the target runtime",
      manualAction(
        "set-runtime-identity",
        "Set runtime identity",
        "setup does not choose or rename agents",
        "tap_set_name(name:<agent>)",
      ),
    ),
    skeletonPhase(
      "warmup",
      "warmup remains runtime-local",
      manualAction(
        "warm-runtime-session",
        "Warm runtime session",
        "setup does not call MCP warmup from outside the runtime",
        "tap_session_warmup(name:<agent>)",
      ),
    ),
    profile === "codex-app"
      ? buildCodexAppRuntimePhase(environment)
      : profile === "claude-channel"
        ? buildClaudeChannelRuntimePhase(environment)
        : skeletonPhase(
            "runtime",
            "deep runtime probing is deferred",
            readyProfileAction,
          ),
    skeletonPhase(
      "receive",
      "receive workers are reported but never started by setup",
      futureAction(
        "start-receiver-explicitly",
        "Start receiver with an explicit future flag",
        "no hidden process start in setup",
        "process-start",
      ),
    ),
    skeletonPhase(
      "status",
      "`tap status` remains a separate status surface",
      manualAction(
        "run-status",
        "Run status report",
        "setup links to status instead of duplicating all status logic",
        "tap status --json",
      ),
    ),
    skeletonPhase(
      "delivery",
      "`tap comms-doctor` remains the delivery/evidence doctor",
      manualAction(
        "run-comms-doctor",
        "Run delivery doctor",
        "setup does not claim live delivery readiness",
        "tap comms-doctor --json",
      ),
    ),
    skeletonPhase(
      "doctor",
      "`tap doctor --setup` reuses the setup report for readiness diagnosis",
      manualAction(
        "run-setup-doctor",
        "Run setup doctor",
        "setup doctor reports setup/config/warm-up readiness without delivery attempts",
        `tap doctor --setup ${setupCommandArgs(profile, environment)} --json`,
      ),
    ),
  ];
}

function directoryState(targetPath: string): Record<string, unknown> {
  try {
    if (!fs.existsSync(targetPath)) {
      return { exists: false, type: "missing" };
    }
    const stat = fs.statSync(targetPath);
    return {
      exists: true,
      type: stat.isDirectory() ? "directory" : "non-directory",
    };
  } catch (error) {
    return {
      exists: false,
      type: "unknown",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function stateFileState(repoRoot: string): Record<string, unknown> {
  const statePath = getStatePath(repoRoot);
  try {
    if (!fs.existsSync(statePath)) {
      return { exists: false, type: "missing" };
    }
    const parsed = JSON.parse(fs.readFileSync(statePath, "utf8")) as Record<
      string,
      unknown
    >;
    const instances =
      parsed.instances && typeof parsed.instances === "object"
        ? Object.keys(parsed.instances as Record<string, unknown>).length
        : null;
    return {
      exists: true,
      type: "json",
      schemaVersion: parsed.schemaVersion ?? null,
      instances,
    };
  } catch (error) {
    return {
      exists: true,
      type: "invalid-json",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function setupDirectoryTargets(environment: SetupEnvironment): string[] {
  const targets = [
    environment.commsDir,
    environment.stateDir,
    environment.stateDir ? path.join(environment.stateDir, "pids") : undefined,
    environment.stateDir ? path.join(environment.stateDir, "logs") : undefined,
  ]
    .filter((item): item is string => Boolean(item))
    .map((item) => path.resolve(item));
  return unique(targets).sort((a, b) => a.length - b.length);
}

function parentCanBeCreated(
  targetPath: string,
  targetSet: Set<string>,
): { ok: true } | { ok: false; reason: string; parentPath: string } {
  const parent = path.dirname(targetPath);
  if (parent === targetPath) {
    return {
      ok: false,
      reason: "directory target has no parent directory",
      parentPath: parent,
    };
  }
  const parentState = directoryState(parent);
  if (parentState.exists) {
    return parentState.type === "directory"
      ? { ok: true }
      : {
          ok: false,
          reason: "directory target parent exists as a non-directory path",
          parentPath: parent,
        };
  }
  return targetSet.has(path.resolve(parent))
    ? { ok: true }
    : {
        ok: false,
        reason:
          "directory target parent is missing and is not part of the approved tap-owned directory set",
        parentPath: parent,
      };
}

function directoryCreateGuard(
  targetPath: string,
  targetSet: Set<string>,
): SetupApplyGuard {
  const resolved = path.resolve(targetPath);
  const root = path.parse(resolved).root;
  if (!resolved || resolved === root) {
    return {
      id: `guard-directory-${resolved || "empty"}`,
      status: "fail",
      message: "directory target resolves to a filesystem root",
      evidence: { targetPath: toForwardSlashPath(resolved) },
    };
  }

  const before = directoryState(resolved);
  if (before.exists && before.type !== "directory") {
    return {
      id: `guard-directory-${path.basename(resolved)}`,
      status: "fail",
      message: "directory target already exists as a non-directory path",
      evidence: { targetPath: toForwardSlashPath(resolved), before },
    };
  }

  const parentCheck = parentCanBeCreated(resolved, targetSet);
  if (!before.exists && !parentCheck.ok) {
    return {
      id: `guard-directory-${path.basename(resolved)}`,
      status: "fail",
      message: parentCheck.reason,
      evidence: {
        targetPath: toForwardSlashPath(resolved),
        parentPath: toForwardSlashPath(parentCheck.parentPath),
      },
    };
  }

  return {
    id: `guard-directory-${path.basename(resolved) || "root"}`,
    status: "pass",
    message: before.exists
      ? "directory target already exists"
      : "directory target is safe to create",
    evidence: { targetPath: toForwardSlashPath(resolved), before },
  };
}

function mcpJsonSummary(
  config: Record<string, unknown> | null,
): Record<string, unknown> {
  const servers = objectValue(config?.mcpServers);
  return {
    rootKeys: shallowObjectKeys(config),
    serverKeys: shallowObjectKeys(servers),
    tapEntry: summarizeMcpEntry(servers?.tap),
  };
}

function filesystemMcpBackupPath(environment: SetupEnvironment): string {
  return path.join(
    environment.stateDir ?? "",
    "backups",
    "setup",
    "mcp-json.bak",
  );
}

function pathIsWithin(childPath: string, parentPath: string): boolean {
  const relative = path.relative(
    path.resolve(parentPath),
    path.resolve(childPath),
  );
  return (
    Boolean(relative) &&
    !relative.startsWith("..") &&
    !path.isAbsolute(relative)
  );
}

function nearestExistingPath(targetPath: string): {
  path: string;
  state: ReturnType<typeof directoryState>;
} {
  let candidate = path.resolve(targetPath);
  while (!fs.existsSync(candidate)) {
    const parent = path.dirname(candidate);
    if (parent === candidate) break;
    candidate = parent;
  }
  return { path: candidate, state: directoryState(candidate) };
}

function mcpBackupGuard(
  environment: SetupEnvironment,
  backupPath: string,
): SetupApplyGuard {
  const stateDir = environment.stateDir
    ? path.resolve(environment.stateDir)
    : null;
  const resolvedBackupPath = path.resolve(backupPath);
  const backupParent = path.dirname(resolvedBackupPath);
  if (!stateDir || !pathIsWithin(resolvedBackupPath, stateDir)) {
    return {
      id: "guard-mcp-json-backup-path",
      status: "fail",
      message: "repo .mcp.json backup path is outside the tap state directory",
      evidence: {
        backupPath: toForwardSlashPath(resolvedBackupPath),
        stateDir: stateDir ? toForwardSlashPath(stateDir) : null,
      },
    };
  }

  const existing = nearestExistingPath(backupParent);
  if (existing.state.exists && existing.state.type !== "directory") {
    return {
      id: "guard-mcp-json-backup-path",
      status: "fail",
      message: "repo .mcp.json backup parent exists as a non-directory path",
      evidence: {
        backupPath: toForwardSlashPath(resolvedBackupPath),
        parentPath: toForwardSlashPath(existing.path),
        before: existing.state,
      },
    };
  }

  return {
    id: "guard-mcp-json-backup-path",
    status: "pass",
    message: "repo .mcp.json backup path is safe to create",
    evidence: {
      backupPath: toForwardSlashPath(resolvedBackupPath),
      parentPath: toForwardSlashPath(backupParent),
      nearestExistingPath: toForwardSlashPath(existing.path),
    },
  };
}

function writeJsonFile(filePath: string, value: Record<string, unknown>): void {
  const temporaryPath = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(
    temporaryPath,
    `${JSON.stringify(value, null, 2)}\n`,
    "utf8",
  );
  fs.renameSync(temporaryPath, filePath);
}

function nextMcpConfig(
  config: Record<string, unknown> | null,
  generatedEntry: Record<string, unknown>,
): Record<string, unknown> {
  const current = config ? { ...config } : {};
  const servers = objectValue(current.mcpServers) ?? {};
  return {
    ...current,
    mcpServers: {
      ...servers,
      tap: generatedEntry,
    },
  };
}

function jsonEquivalent(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function buildMcpJsonPreviewPlan(
  environment: SetupEnvironment,
  options: {
    apply?: boolean;
    executeApply?: boolean;
    blockedBySetupGuard?: boolean;
  } = {},
): {
  guards: SetupApplyGuard[];
  mutations: SetupMutation[];
  evidence: SetupApplyEvidence[];
  rollback: SetupRollbackStep[];
  residual: SetupResidual[];
} {
  const guards: SetupApplyGuard[] = [];
  const mutations: SetupMutation[] = [];
  const evidence: SetupApplyEvidence[] = [];
  const rollback: SetupRollbackStep[] = [];
  const residual: SetupResidual[] = [];
  const targetPath = environment.repoRoot
    ? path.join(environment.repoRoot, ".mcp.json")
    : null;

  if (!targetPath) {
    guards.push({
      id: "guard-mcp-json-target",
      status: "warn",
      message: "repo root is unavailable; .mcp.json preview is manual-only",
    });
    return { guards, mutations, evidence, rollback, residual };
  }

  const mcpJsonPath = targetPath;
  const generated = generatedMcpEntry(environment);
  const backupPath = filesystemMcpBackupPath(environment);
  const backupPathForReport = toForwardSlashPath(backupPath);
  const readResult = readJsonFileResult(mcpJsonPath);
  const mutationBase = {
    phase: "config" as const,
    actionId: "preview-repo-mcp-config",
    targetPath: toForwardSlashPath(mcpJsonPath),
    risk: "config-edit" as const,
    defaultEnabled: false,
    reviewRequired: true,
  };

  function pushEvidence(
    mutationId: string,
    message: string,
    status: SetupApplyEvidence["status"] = "planned",
  ): void {
    evidence.push({
      id: `${mutationId}-evidence`,
      mutationId,
      status,
      path: toForwardSlashPath(mcpJsonPath),
      message,
    });
  }

  if (readResult.status === "missing") {
    const mutationId = "preview-repo-mcp-json-create";
    const blocked =
      options.apply === true && options.blockedBySetupGuard === true;
    let status: SetupMutation["status"] =
      options.apply === true ? (blocked ? "blocked" : "planned") : "planned";
    let evidenceStatus: SetupApplyEvidence["status"] = "planned";
    let evidenceMessage =
      "repo .mcp.json create is previewed only; no config file was written";
    let rollbackStatus: SetupRollbackStep["status"] = "manual-only";
    let rollbackMessage =
      "future config apply should remove the created file only if it is still tap-owned";

    if (blocked) {
      evidenceMessage = "repo .mcp.json create was blocked before mutation";
      rollbackStatus = "not-needed";
      rollbackMessage =
        "no rollback needed because setup did not create .mcp.json";
    } else if (options.apply === true && options.executeApply === true) {
      try {
        writeJsonFile(mcpJsonPath, nextMcpConfig(null, generated.entry));
        status = "applied";
        evidenceStatus = "written";
        evidenceMessage =
          "repo .mcp.json was created with a tap-managed MCP server entry";
        rollbackStatus = "available";
        rollbackMessage =
          "delete the created .mcp.json only if it is still tap-owned and no longer needed";
      } catch (error) {
        status = "failed";
        evidenceStatus = "failed";
        evidenceMessage =
          error instanceof Error
            ? error.message
            : "repo .mcp.json create failed";
        rollbackStatus = "manual-only";
        rollbackMessage =
          "inspect the target path manually; setup could not verify rollback safety";
        residual.push({
          id: "setup-mcp-json-create-failed",
          severity: "blocker",
          message: "repo .mcp.json create failed during setup apply.",
        });
      }
    }

    guards.push({
      id: "guard-mcp-json-create",
      status: "pass",
      message: "repo .mcp.json is absent; create preview is available",
      evidence: {
        targetPath: toForwardSlashPath(targetPath),
        generatedPayload: generated.summary,
      },
    });
    mutations.push({
      ...mutationBase,
      id: mutationId,
      kind: "json-file-create",
      status,
      reason: blocked
        ? "setup apply is blocked by fail-closed setup guards"
        : status === "applied"
          ? "created a missing repo .mcp.json with a tap-managed MCP server entry"
          : "preview creating a missing repo .mcp.json with a tap-managed MCP server entry",
      before: { exists: false },
      after: { generatedPayload: generated.summary },
    });
    pushEvidence(mutationId, evidenceMessage, evidenceStatus);
    rollback.push({
      id: `${mutationId}-rollback`,
      mutationId,
      action: "delete-created-path",
      targetPath: toForwardSlashPath(targetPath),
      status: rollbackStatus,
      message: rollbackMessage,
    });
    return { guards, mutations, evidence, rollback, residual };
  }

  if (readResult.status === "invalid") {
    const mutationId = "blocked-repo-mcp-json-invalid";
    guards.push({
      id: "guard-mcp-json-valid",
      status: "fail",
      message: "repo .mcp.json is not valid JSON",
      evidence: {
        targetPath: toForwardSlashPath(targetPath),
        error: readResult.error,
      },
    });
    mutations.push({
      ...mutationBase,
      id: mutationId,
      kind: "manual-only",
      status: "blocked",
      reason:
        "setup will not edit invalid JSON; operator must repair .mcp.json manually",
      before: { exists: true, parseStatus: "invalid" },
    });
    pushEvidence(mutationId, "repo .mcp.json edit was blocked before mutation");
    rollback.push({
      id: `${mutationId}-rollback`,
      mutationId,
      action: "manual",
      targetPath: toForwardSlashPath(targetPath),
      status: "manual-only",
      message: "no rollback exists because setup did not edit .mcp.json",
    });
    residual.push({
      id: "setup-mcp-json-invalid-blocked",
      severity: "blocker",
      message:
        "repo .mcp.json is invalid JSON; setup config preview is manual-only.",
    });
    return { guards, mutations, evidence, rollback, residual };
  }

  const config = readResult.value;
  const servers = objectValue(config.mcpServers);
  if (config.mcpServers !== undefined && !servers) {
    const mutationId = "blocked-repo-mcp-json-servers-shape";
    guards.push({
      id: "guard-mcp-json-servers-object",
      status: "fail",
      message: "repo .mcp.json mcpServers field is not an object",
      evidence: {
        targetPath: toForwardSlashPath(targetPath),
        before: mcpJsonSummary(config),
      },
    });
    mutations.push({
      ...mutationBase,
      id: mutationId,
      kind: "manual-only",
      status: "blocked",
      reason:
        "setup will not replace a non-object mcpServers field automatically",
      before: mcpJsonSummary(config),
    });
    pushEvidence(mutationId, "repo .mcp.json edit was blocked before mutation");
    rollback.push({
      id: `${mutationId}-rollback`,
      mutationId,
      action: "manual",
      targetPath: toForwardSlashPath(targetPath),
      status: "manual-only",
      message: "no rollback exists because setup did not edit .mcp.json",
    });
    residual.push({
      id: "setup-mcp-json-servers-shape-blocked",
      severity: "blocker",
      message:
        "repo .mcp.json has a non-object mcpServers field; setup config preview is manual-only.",
    });
    return { guards, mutations, evidence, rollback, residual };
  }

  const tapEntry = objectValue(servers?.tap);
  const hasTapEntry = servers
    ? Object.prototype.hasOwnProperty.call(servers, "tap")
    : false;
  const tapManaged =
    Boolean(tapEntry) &&
    (isExplicitTapManagedEntry(tapEntry!) ||
      structurallyMatchesGeneratedMcpEntry(tapEntry!, generated.entry));

  if (hasTapEntry && !tapManaged) {
    const mutationId = "blocked-repo-mcp-json-user-managed";
    guards.push({
      id: "guard-mcp-json-tap-managed",
      status: "fail",
      message:
        "repo .mcp.json mcpServers.tap exists but is not recognizably tap-managed",
      evidence: {
        targetPath: toForwardSlashPath(targetPath),
        selector: "mcpServers.tap",
        before: mcpJsonSummary(config),
      },
    });
    mutations.push({
      ...mutationBase,
      id: mutationId,
      kind: "manual-only",
      status: "blocked",
      reason:
        "setup refuses key-name-only recognition and will not overwrite a user-managed mcpServers.tap entry",
      before: mcpJsonSummary(config),
    });
    pushEvidence(mutationId, "repo .mcp.json edit was blocked before mutation");
    rollback.push({
      id: `${mutationId}-rollback`,
      mutationId,
      action: "manual",
      targetPath: toForwardSlashPath(targetPath),
      status: "manual-only",
      message: "no rollback exists because setup did not edit .mcp.json",
    });
    residual.push({
      id: "setup-mcp-json-user-managed-blocked",
      severity: "blocker",
      message:
        "repo .mcp.json mcpServers.tap is user-managed; setup requires manual review before any edit.",
    });
    return { guards, mutations, evidence, rollback, residual };
  }

  const mutationId = tapManaged
    ? "preview-repo-mcp-json-managed-edit"
    : "preview-repo-mcp-json-add-entry";
  const backupGuard = mcpBackupGuard(environment, backupPath);
  guards.push(backupGuard);
  const blocked =
    options.apply === true &&
    (options.blockedBySetupGuard === true || backupGuard.status === "fail");
  const nextConfig = nextMcpConfig(config, generated.entry);
  const alreadyCurrent = jsonEquivalent(config, nextConfig);
  let status: SetupMutation["status"] =
    options.apply === true ? (blocked ? "blocked" : "planned") : "planned";
  let evidenceStatus: SetupApplyEvidence["status"] = "planned";
  let evidenceMessage =
    "repo .mcp.json edit and backup are previewed only; no config file or backup was written";
  let rollbackStatus: SetupRollbackStep["status"] = "manual-only";
  let rollbackMessage =
    "future config apply must create this backup before editing and restore it on rollback";

  if (blocked) {
    evidenceMessage = "repo .mcp.json edit was blocked before mutation";
    rollbackStatus = "not-needed";
    rollbackMessage = "no rollback needed because setup did not edit .mcp.json";
  } else if (options.apply === true && options.executeApply === true) {
    if (alreadyCurrent) {
      status = "skipped";
      evidenceStatus = "verified";
      evidenceMessage =
        "repo .mcp.json already contains the generated tap-managed MCP server entry";
      rollbackStatus = "not-needed";
      rollbackMessage =
        "no rollback needed because setup did not edit .mcp.json";
    } else {
      try {
        fs.mkdirSync(path.dirname(backupPath), { recursive: true });
        fs.copyFileSync(mcpJsonPath, backupPath);
        writeJsonFile(mcpJsonPath, nextConfig);
        status = "applied";
        evidenceStatus = "written";
        evidenceMessage =
          "repo .mcp.json was backed up and updated with a tap-managed MCP server entry";
        rollbackStatus = "available";
        rollbackMessage =
          "restore the backup if the tap-managed .mcp.json edit must be reverted";
      } catch (error) {
        status = "failed";
        evidenceStatus = "failed";
        evidenceMessage =
          error instanceof Error ? error.message : "repo .mcp.json edit failed";
        rollbackStatus = fs.existsSync(backupPath)
          ? "available"
          : "manual-only";
        rollbackMessage = fs.existsSync(backupPath)
          ? "restore the backup if the failed edit left .mcp.json in an unexpected state"
          : "inspect .mcp.json manually; setup could not create a verified backup";
        residual.push({
          id: "setup-mcp-json-edit-failed",
          severity: "blocker",
          message: "repo .mcp.json edit failed during setup apply.",
        });
      }
    }
  }

  guards.push({
    id: tapManaged
      ? "guard-mcp-json-managed-entry"
      : "guard-mcp-json-add-entry",
    status: "pass",
    message: tapManaged
      ? "repo .mcp.json mcpServers.tap is recognizably tap-managed; edit preview is available"
      : "repo .mcp.json has no tap entry; add-entry preview is available",
    evidence: {
      targetPath: toForwardSlashPath(targetPath),
      selector: "mcpServers.tap",
      before: mcpJsonSummary(config),
      generatedPayload: generated.summary,
      plannedBackupPath: backupPathForReport,
    },
  });
  mutations.push({
    ...mutationBase,
    id: mutationId,
    kind: "json-file-edit",
    status,
    reason: blocked
      ? "setup apply is blocked by fail-closed setup guards"
      : status === "applied"
        ? tapManaged
          ? "updated a tap-managed mcpServers.tap entry after writing a backup"
          : "added a tap-managed mcpServers.tap entry after writing a backup"
        : status === "skipped"
          ? "repo .mcp.json already matches the generated tap-managed MCP server entry"
          : tapManaged
            ? "preview updating a tap-managed mcpServers.tap entry with a backup plan"
            : "preview adding a tap-managed mcpServers.tap entry with a backup plan",
    before: mcpJsonSummary(config),
    after: { generatedPayload: generated.summary },
    backupPath: backupPathForReport,
  });
  pushEvidence(mutationId, evidenceMessage, evidenceStatus);
  rollback.push({
    id: `${mutationId}-rollback`,
    mutationId,
    action: "restore-backup",
    targetPath: toForwardSlashPath(targetPath),
    backupPath: backupPathForReport,
    status: rollbackStatus,
    message: rollbackMessage,
  });
  return { guards, mutations, evidence, rollback, residual };
}

function buildProfilePackValidationPlan(environment: SetupEnvironment): {
  guards: SetupApplyGuard[];
  mutations: SetupMutation[];
  evidence: SetupApplyEvidence[];
  rollback: SetupRollbackStep[];
  residual: SetupResidual[];
} {
  const profilePack = environment.profilePack;
  if (!profilePack) {
    return {
      guards: [],
      mutations: [],
      evidence: [],
      rollback: [],
      residual: [],
    };
  }

  const validation = profilePack.summary;
  const valid = validation.status === "valid";
  const mutationId = "validate-profile-pack";
  const message = valid
    ? "profile pack passed data-only validation; embedded commands were not executed"
    : `profile pack validation is ${validation.status}; setup apply is blocked before mutation`;
  const guard: SetupApplyGuard = {
    id: "guard-profile-pack-validation",
    status: valid ? "pass" : "fail",
    message,
    evidence: {
      path: validation.path,
      exists: validation.exists,
      status: validation.status,
      schemaVersion: validation.schemaVersion,
      packId: validation.packId,
      profileCount: validation.profileCount,
      profileIds: validation.profileIds,
      commandCount: validation.commandCount,
      commandRiskCounts: validation.commandRiskCounts,
      commandsExecution: "not-run",
      errors: validation.errors,
    },
  };

  const mutation: SetupMutation = {
    id: mutationId,
    kind: "profile-pack-validate",
    phase: "config",
    actionId: "validate-profile-pack",
    targetPath: validation.path,
    status: valid ? "skipped" : "blocked",
    risk: "read-only",
    defaultEnabled: false,
    reviewRequired: true,
    reason: valid
      ? "validated profile-pack data without executing embedded commands"
      : "profile-pack validation failed; setup apply is blocked before mutation",
    before: {
      status: validation.status,
      schemaVersion: validation.schemaVersion,
      packId: validation.packId,
      profileIds: validation.profileIds,
      commandCount: validation.commandCount,
      commandRiskCounts: validation.commandRiskCounts,
      commandsExecution: "not-run",
    },
  };

  return {
    guards: [guard],
    mutations: [mutation],
    evidence: [
      {
        id: `${mutationId}-evidence`,
        mutationId,
        status: valid ? "verified" : "planned",
        path: validation.path,
        message,
      },
    ],
    rollback: [
      {
        id: `${mutationId}-rollback`,
        mutationId,
        action: "manual",
        targetPath: validation.path,
        status: "not-needed",
        message: "no rollback needed because setup only read the profile pack",
      },
    ],
    residual: valid
      ? [
          {
            id: "profile-pack-data-only",
            severity: "info",
            message:
              "Profile-pack commands are validated as data only; setup does not execute commands or promote private profile defaults.",
          },
        ]
      : [
          {
            id: "profile-pack-validation-blocked",
            severity: "blocker",
            message:
              "Profile pack validation failed; setup apply is blocked before any directory or .mcp.json mutation.",
          },
        ],
  };
}

function buildSetupApplyPlan(
  profile: SetupProfile,
  environment: SetupEnvironment,
  apply: boolean,
  executeApply: boolean,
): SetupApplyPlan {
  const generatedAt = new Date().toISOString();
  const targets = setupDirectoryTargets(environment);
  const targetSet = new Set(targets);
  const directoryGuards = targets.map((target) =>
    directoryCreateGuard(target, targetSet),
  );
  const directoryGuardFailed = directoryGuards.some(
    (guard) => guard.status === "fail",
  );
  const profilePackPlan = buildProfilePackValidationPlan(environment);
  const profilePackGuardFailed = profilePackPlan.guards.some(
    (guard) => guard.status === "fail",
  );
  const mcpJsonPreviewPlan = buildMcpJsonPreviewPlan(environment);
  const guards = [
    ...profilePackPlan.guards,
    ...directoryGuards,
    ...mcpJsonPreviewPlan.guards,
  ];
  const mcpJsonGuardFailed = mcpJsonPreviewPlan.guards.some(
    (guard) => guard.status === "fail",
  );
  const guardFailed = guards.some((guard) => guard.status === "fail");
  const mutations: SetupMutation[] = [...profilePackPlan.mutations];
  const evidence: SetupApplyEvidence[] = [...profilePackPlan.evidence];
  const rollback: SetupRollbackStep[] = [...profilePackPlan.rollback];
  const residual: SetupResidual[] = [
    ...profilePackPlan.residual,
    ...mcpJsonPreviewPlan.residual,
  ];

  for (const targetPath of targets) {
    const mutationId = `create-${path.basename(targetPath) || "root"}-directory`;
    const before = directoryState(targetPath);
    const guard = guards.find(
      (item) =>
        path.resolve(String(item.evidence?.targetPath ?? "")) ===
        path.resolve(targetPath),
    );
    const blocked = guardFailed || guard?.status === "fail";
    let status: SetupMutation["status"] = apply ? "skipped" : "planned";
    let written = false;
    let after = before;
    let reason = before.exists
      ? "tap-owned directory already exists"
      : "create missing tap-owned setup directory";

    if (blocked) {
      status = "blocked";
      reason = "setup apply is blocked by fail-closed directory guards";
    } else if (apply && executeApply) {
      if (before.exists && before.type === "directory") {
        status = "skipped";
      } else {
        try {
          fs.mkdirSync(targetPath, { recursive: true });
          status = "applied";
          written = true;
        } catch (error) {
          status = "failed";
          reason =
            error instanceof Error
              ? error.message
              : `failed to create ${targetPath}`;
        }
      }
      after = directoryState(targetPath);
    }

    mutations.push({
      id: mutationId,
      kind: "directory-create",
      phase: "config",
      actionId: "create-tap-owned-directory",
      targetPath: toForwardSlashPath(targetPath),
      status,
      risk: "file-create",
      defaultEnabled: apply && executeApply && !blocked,
      reviewRequired: false,
      reason,
      before,
      after: apply && executeApply ? after : undefined,
    });

    evidence.push({
      id: `${mutationId}-evidence`,
      mutationId,
      status:
        status === "failed"
          ? "failed"
          : status === "blocked"
            ? "planned"
            : written
              ? "written"
              : apply && executeApply && after.exists
                ? "verified"
                : "planned",
      path: toForwardSlashPath(targetPath),
      message:
        status === "applied"
          ? "directory was created and verified"
          : status === "skipped"
            ? "directory already existed and was verified"
            : status === "blocked"
              ? "directory creation was blocked before mutation"
              : status === "failed"
                ? "directory creation failed"
                : "directory creation is planned only",
    });

    rollback.push({
      id: `${mutationId}-rollback`,
      mutationId,
      action: written ? "delete-created-path" : "manual",
      targetPath: toForwardSlashPath(targetPath),
      status: written ? "available" : "not-needed",
      message: written
        ? "remove the created directory if it is still empty and no longer needed"
        : "no rollback needed because setup did not create this directory",
    });
  }

  const directoryApplyFailed = mutations.some(
    (mutation) =>
      mutation.kind === "directory-create" && mutation.status === "failed",
  );
  const statePath = getStatePath(path.resolve(environment.repoRoot ?? "."));
  const beforeState = stateFileState(path.resolve(environment.repoRoot ?? "."));
  const stateBlocked =
    guardFailed ||
    directoryApplyFailed ||
    (beforeState.exists === true && beforeState.type === "invalid-json");
  let stateStatus: SetupMutation["status"] = apply ? "skipped" : "planned";
  let stateWritten = false;
  let afterState = beforeState;
  let stateReason = beforeState.exists
    ? beforeState.type === "invalid-json"
      ? "existing tap state file is invalid and will not be overwritten by setup"
      : "tap state file already exists"
    : "create initial tap state so tap status is usable after setup apply";

  if (stateBlocked) {
    stateStatus = "blocked";
    if (beforeState.type !== "invalid-json") {
      stateReason = "tap state creation is blocked by setup apply guards";
    }
  } else if (apply && executeApply) {
    if (beforeState.exists) {
      stateStatus = "skipped";
    } else {
      try {
        saveState(
          path.resolve(environment.repoRoot ?? "."),
          createInitialState(
            path.resolve(environment.commsDir ?? ""),
            path.resolve(environment.repoRoot ?? "."),
            version,
          ),
        );
        stateStatus = "applied";
        stateWritten = true;
      } catch (error) {
        stateStatus = "failed";
        stateReason =
          error instanceof Error
            ? error.message
            : `failed to create ${statePath}`;
      }
    }
    afterState = stateFileState(path.resolve(environment.repoRoot ?? "."));
  }

  mutations.push({
    id: "create-initial-state-file",
    kind: "state-file-create",
    phase: "status",
    actionId: "create-initial-state-file",
    targetPath: toForwardSlashPath(statePath),
    status: stateStatus,
    risk: "file-create",
    defaultEnabled: apply && executeApply && !stateBlocked,
    reviewRequired: false,
    reason: stateReason,
    before: beforeState,
    after: apply && executeApply ? afterState : undefined,
  });
  evidence.push({
    id: "create-initial-state-file-evidence",
    mutationId: "create-initial-state-file",
    status:
      stateStatus === "failed"
        ? "failed"
        : stateStatus === "blocked"
          ? "planned"
          : stateWritten
            ? "written"
            : apply && executeApply && afterState.exists
              ? "verified"
              : "planned",
    path: toForwardSlashPath(statePath),
    message:
      stateStatus === "applied"
        ? "initial tap state file was created and verified"
        : stateStatus === "skipped"
          ? "tap state file already existed and was verified"
          : stateStatus === "blocked"
            ? "tap state creation was blocked before mutation"
            : stateStatus === "failed"
              ? "tap state creation failed"
              : "tap state creation is planned only",
  });
  rollback.push({
    id: "create-initial-state-file-rollback",
    mutationId: "create-initial-state-file",
    action: stateWritten ? "delete-created-path" : "manual",
    targetPath: toForwardSlashPath(statePath),
    status: stateWritten ? "available" : "not-needed",
    message: stateWritten
      ? "remove the created state file if setup must be rolled back before adding instances"
      : "no rollback needed because setup did not create the tap state file",
  });

  const mcpJsonPlan = buildMcpJsonPreviewPlan(environment, {
    apply,
    executeApply,
    blockedBySetupGuard:
      guardFailed ||
      directoryApplyFailed ||
      stateStatus === "blocked" ||
      stateStatus === "failed",
  });

  if (directoryGuardFailed) {
    residual.push({
      id: "setup-apply-directory-guard-blocked",
      severity: "blocker",
      message:
        "tap setup --apply did not mutate because one or more directory guards failed.",
    });
  }
  if (mcpJsonGuardFailed) {
    residual.push({
      id: "setup-apply-mcp-json-guard-blocked",
      severity: "blocker",
      message:
        "tap setup --apply did not mutate because one or more .mcp.json guards failed.",
    });
  }
  if (profilePackGuardFailed) {
    residual.push({
      id: "setup-apply-profile-pack-guard-blocked",
      severity: "blocker",
      message:
        "tap setup --apply did not mutate because profile-pack validation failed.",
    });
  }
  if (stateStatus === "blocked" && beforeState.type === "invalid-json") {
    residual.push({
      id: "setup-apply-state-file-invalid",
      severity: "blocker",
      message:
        "tap setup --apply did not overwrite the existing invalid tap state file.",
    });
  }

  mutations.push(...mcpJsonPlan.mutations);
  evidence.push(...mcpJsonPlan.evidence);
  rollback.push(...mcpJsonPlan.rollback);

  const failed = mutations.some((mutation) => mutation.status === "failed");
  const blocked = mutations.some((mutation) => mutation.status === "blocked");
  const applied = mutations.some((mutation) => mutation.status === "applied");
  const status: SetupApplyPlanStatus = !apply
    ? "preview"
    : failed || (blocked && applied)
      ? "partial"
      : blocked
        ? "blocked"
        : "applied";

  return {
    status,
    generatedAt,
    profile,
    dryRun: !apply,
    apply,
    mutations,
    guards,
    evidence,
    rollback,
    residual,
  };
}

function summarizeStatus(applyPlan: SetupApplyPlan): SetupStatus {
  return applyPlan.status === "blocked" || applyPlan.status === "partial"
    ? "blocked"
    : "partial";
}

function buildNextActions(
  profile: SetupProfile,
  environment: SetupEnvironment,
  applyPlan: SetupApplyPlan,
): SetupAction[] {
  const setupArgs = setupCommandArgs(profile, environment);
  const guardFailed = applyPlan.guards.some((guard) => guard.status === "fail");
  const hasBlocker =
    guardFailed ||
    applyPlan.status === "blocked" ||
    applyPlan.status === "partial" ||
    applyPlan.residual.some((item) => item.severity === "blocker");
  const actions: SetupAction[] = [];

  if (!hasBlocker && applyPlan.status === "preview") {
    actions.push(
      reviewedManualAction(
        "apply-reviewed-setup",
        "Apply reviewed setup artifacts",
        "review applyPlan first; this creates only tap-owned directories, initial tap state, and guarded tap-managed repo .mcp.json changes",
        `tap setup ${setupArgs} --apply --json`,
        "config-edit",
      ),
    );
  }

  if (hasBlocker) {
    actions.push(
      manualAction(
        "review-blocked-setup",
        "Review blocked setup guard",
        "setup is fail-closed; repair the blocker or choose an explicit manual path before rerunning apply",
      ),
    );
  }

  const receiverAction = environment.agent
    ? manualAction(
        "run-receiver-check",
        "Run receiver check",
        "receiver/promoter checks remain explicit and do not start hidden processes",
        `tap receiver check --agent ${commandToken(environment.agent)} --json`,
      )
    : manualAction(
        "provide-agent-for-receiver-check",
        "Provide agent for receiver check",
        "receiver check needs a concrete runtime identity; rerun setup with --agent <name> or set TAP_AGENT_NAME in the target runtime",
      );

  actions.push(
    manualAction(
      "run-setup-doctor",
      "Run setup doctor",
      "setup doctor reuses this report builder for setup/config/warm-up readiness and apply-plan diagnosis",
      `tap doctor --setup ${setupArgs} --json`,
    ),
    manualAction(
      "run-status",
      "Run status report",
      "status stays separate from setup and summarizes runtime surfaces",
      "tap status --json",
    ),
    manualAction(
      "run-comms-doctor",
      "Run delivery doctor",
      "delivery and durable-evidence diagnostics stay separate from setup",
      "tap comms-doctor --json",
    ),
    receiverAction,
  );

  if (environment.profilePack?.summary.status !== undefined) {
    actions.push(
      manualAction(
        environment.profilePack.summary.status === "valid"
          ? "review-profile-pack-data"
          : "repair-profile-pack-data",
        environment.profilePack.summary.status === "valid"
          ? "Review profile-pack data"
          : "Repair profile-pack data",
        environment.profilePack.summary.status === "valid"
          ? "profile packs are validated as data only; setup does not execute embedded commands or promote private defaults"
          : "profile-pack validation must pass before setup apply can mutate tap-owned artifacts",
        `tap setup ${setupArgs} --json`,
        environment.profilePack.summary.path,
      ),
    );
  }

  return actions;
}

export function buildSetupReport(
  profile: SetupProfile,
  apply: boolean,
  overrides: {
    commsDir?: string;
    agent?: string;
    freshMinutes?: number;
    profilePackPath?: string;
  } = {},
  options: { executeApply?: boolean } = {},
): TapSetupReport {
  const repoRoot = findRepoRoot();
  const { config } = resolveConfig({ commsDir: overrides.commsDir }, repoRoot);
  const agent = overrides.agent?.trim() || agentFromEnvironment();
  const freshMinutes = overrides.freshMinutes ?? 30;
  const profilePack = overrides.profilePackPath
    ? validateProfilePackFile(overrides.profilePackPath)
    : undefined;
  const environment: SetupEnvironment = {
    cwd: toForwardSlashPath(process.cwd()),
    platform: process.platform,
    packageVersion: version,
    repoRoot: toForwardSlashPath(repoRoot),
    commsDir: toForwardSlashPath(config.commsDir),
    stateDir: toForwardSlashPath(config.stateDir),
    agent,
    freshMinutes,
    mcpConfigTargets: buildConfigTargets(profile, repoRoot, profilePack),
    profilePack,
  };
  const phases = buildPhases(profile, environment);
  const actions = phases.flatMap((phase) => phase.actions);
  const applyPlan = buildSetupApplyPlan(
    profile,
    environment,
    apply,
    options.executeApply === true,
  );
  const residual: SetupResidual[] = [
    {
      id: apply
        ? "setup-apply-directory-and-mcp-preview"
        : "setup-readonly-skeleton",
      severity: "info",
      message: apply
        ? "This setup apply implementation creates reviewed tap-owned directories, initial tap state, and guarded tap-managed repo .mcp.json changes; it does not edit permissions, identity, presence, inbox evidence, or processes."
        : "This setup implementation previews directories, initial tap state, and MCP config edits without mutating config, permissions, identity, presence, inbox, or processes.",
      nextAction: apply
        ? "Use the applyPlan for mutation evidence and rollback guidance."
        : "Use the reported manual actions or run --apply for reviewed directory, state, and .mcp.json setup only.",
    },
    ...applyPlan.residual,
  ];
  if (profile === "claude-channel") {
    residual.push({
      id: "claude-channel-live-delivery-deferred",
      severity: "info",
      message:
        "Claude channel setup probes read durable presence, channel transport, runtime health, and inbox evidence only; they do not attempt channel delivery, read credentials, start processes, or mutate config.",
      nextAction:
        "Refresh warmup from the active Claude runtime if the channel report is fail-closed.",
    });
  }
  if (profile === "codex-app") {
    residual.push({
      id: "codex-app-live-smoke-deferred",
      severity: "info",
      message:
        "Codex App setup probes read route tuple and runtime health evidence only; they do not attempt live consent-drive delivery or write presence.",
      nextAction:
        "Refresh warmup from the active Codex App runtime if the route report is fail-closed.",
    });
  }
  if (profilePack) {
    residual.push({
      id: "profile-pack-data-only-validation",
      severity: profilePack.summary.status === "valid" ? "info" : "blocker",
      message:
        profilePack.summary.status === "valid"
          ? "Profile-pack input was validated as data only; setup did not execute embedded commands or apply private profile defaults."
          : "Profile-pack input did not pass data-only validation; setup apply is blocked until the pack is repaired or omitted.",
      nextAction:
        profilePack.summary.status === "valid"
          ? "Use explicit future profile-pack apply flags only after a reviewed loader contract lands."
          : `Repair ${profilePack.summary.path} or rerun setup without --profile-pack.`,
    });
  }
  const nextActions = buildNextActions(profile, environment, applyPlan);

  const status = summarizeStatus(applyPlan);
  return {
    command: "setup",
    profile,
    dryRun: !apply,
    apply,
    status,
    generatedAt: applyPlan.generatedAt,
    summary: apply
      ? applyPlan.status === "applied"
        ? `tap setup ${profile} apply created or verified tap-owned directories and guarded .mcp.json config`
        : `tap setup ${profile} apply was blocked by setup guards`
      : `tap setup ${profile} dry-run report generated`,
    environment,
    phases,
    actions,
    nextActions,
    residual,
    applyPlan,
  };
}

function logReport(report: TapSetupReport): void {
  logHeader(`@hua-labs/tap setup (${report.profile})`);
  log(report.summary);
  log(`status: ${report.status}`);
  log(`repoRoot: ${report.environment.repoRoot ?? "(unknown)"}`);
  log(`commsDir: ${report.environment.commsDir ?? "(unknown)"}`);
  if (report.apply) {
    log(
      `applyPlan: ${report.applyPlan?.status ?? "missing"} (${report.applyPlan?.mutations.length ?? 0} mutation(s))`,
    );
  } else {
    log(
      "No files, config, permissions, inbox evidence, or processes were changed.",
    );
  }
  if (report.nextActions.length > 0) {
    log("nextActions:");
    for (const action of report.nextActions) {
      log(`- ${action.label}: ${action.command ?? action.reason}`);
    }
  }
}

export async function setupCommand(
  args: string[],
): Promise<CommandResult<TapSetupReport | Record<string, unknown>>> {
  if (args.includes("--help") || args.includes("-h")) {
    log(SETUP_HELP);
    return {
      ok: true,
      command: "setup",
      code: "TAP_NO_OP",
      message: SETUP_HELP,
      warnings: [],
      data: {},
    };
  }

  const { flags } = parseArgs(args);
  const rawProfile = flags.profile;
  if (rawProfile === undefined || rawProfile === true) {
    return invalidArgument(
      "Missing --profile <codex-cli|codex-app|claude-channel>.",
    );
  }
  const profile = parseSetupProfile(rawProfile);
  if (!profile) {
    return invalidArgument(
      `Unknown setup profile: ${String(rawProfile)}. Expected codex-cli, codex-app, or claude-channel.`,
    );
  }

  const apply = flags.apply === true;
  const commsDir =
    typeof flags["comms-dir"] === "string" ? flags["comms-dir"] : undefined;
  const agent = typeof flags.agent === "string" ? flags.agent : undefined;
  const freshMinutes = parsePositiveInteger(flags["fresh-minutes"], 30);
  const profilePackPath =
    typeof flags["profile-pack"] === "string"
      ? flags["profile-pack"]
      : undefined;
  const report = buildSetupReport(
    profile,
    apply,
    {
      commsDir,
      agent,
      freshMinutes,
      profilePackPath,
    },
    {
      executeApply: apply,
    },
  );
  logReport(report);
  const blocked =
    apply &&
    (report.applyPlan?.status === "blocked" ||
      report.applyPlan?.status === "partial");
  return {
    ok: !blocked,
    command: "setup",
    code: blocked ? "TAP_SETUP_APPLY_BLOCKED" : "TAP_SETUP_OK",
    message: report.summary,
    warnings: report.residual
      .filter((item) => item.severity !== "info")
      .map((item) => item.message),
    data: report,
  };
}
