import * as fs from "node:fs";
import * as path from "node:path";
import type { ReadyProfileConfig } from "./ready-profiles.js";
import type {
  CliProfileConfig,
  FlowSupervisorConfig,
  HeadlessRunnerStatusConfig,
  ProfileConfig,
  RemotePanelProfileConfig,
} from "./status-profiles.js";

const PROFILE_PACK_SCHEMA_VERSION = "tap-profile-pack.v0";

interface ProfilePackCommand {
  shell: string;
  risk: string;
  reviewRequired: boolean;
  defaultEnabled: boolean;
}

type ProfilePackCommandCatalog = Record<string, ProfilePackCommand>;

interface ProfilePackProfile {
  id: string;
  label: string;
  agent: string;
  runtimeSurface: string;
  sshTarget?: string;
  paths?: {
    repoRoot?: string;
    commsDir?: string;
  };
  capabilities?: {
    ready?: boolean;
    status?: boolean;
    apply?: boolean;
  };
  status?: Record<string, unknown>;
  ready?: Record<string, unknown>;
  commands?: ProfilePackCommandCatalog;
}

export interface LoadedProfilePack {
  path: string;
  profiles: ProfilePackProfile[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function booleanValue(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function resolveProfilePath(packPath: string, value: string | null): string {
  const fallback = path.dirname(packPath);
  if (!value) return fallback;
  return path.resolve(path.dirname(packPath), value);
}

function profilePackError(packPath: string, message: string): RangeError {
  return new RangeError(`Invalid profile pack ${packPath}: ${message}`);
}

export function loadProfilePack(profilePackPath: string): LoadedProfilePack {
  const resolvedPath = path.resolve(profilePackPath);
  if (!fs.existsSync(resolvedPath)) {
    throw profilePackError(resolvedPath, "file does not exist");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(resolvedPath, "utf8"));
  } catch (error) {
    throw profilePackError(
      resolvedPath,
      error instanceof Error ? error.message : String(error),
    );
  }
  if (!isRecord(parsed)) {
    throw profilePackError(resolvedPath, "root must be an object");
  }
  if (parsed.schemaVersion !== PROFILE_PACK_SCHEMA_VERSION) {
    throw profilePackError(
      resolvedPath,
      `schemaVersion must be ${PROFILE_PACK_SCHEMA_VERSION}`,
    );
  }
  if (!Array.isArray(parsed.profiles)) {
    throw profilePackError(resolvedPath, "profiles must be an array");
  }

  const profiles: ProfilePackProfile[] = [];
  const ids = new Set<string>();
  for (const [index, rawProfile] of parsed.profiles.entries()) {
    if (!isRecord(rawProfile)) {
      throw profilePackError(
        resolvedPath,
        `profiles[${index}] must be an object`,
      );
    }
    const id = stringValue(rawProfile.id);
    const label = stringValue(rawProfile.label);
    const agent = stringValue(rawProfile.agent);
    const runtimeSurface = stringValue(rawProfile.runtimeSurface);
    if (!id || !label || !agent || !runtimeSurface) {
      throw profilePackError(
        resolvedPath,
        `profiles[${index}] requires id, label, agent, and runtimeSurface`,
      );
    }
    if (ids.has(id)) {
      throw profilePackError(resolvedPath, `duplicate profile id ${id}`);
    }
    ids.add(id);

    const paths = isRecord(rawProfile.paths) ? rawProfile.paths : {};
    const capabilities = isRecord(rawProfile.capabilities)
      ? rawProfile.capabilities
      : {};
    const status = isRecord(rawProfile.status) ? rawProfile.status : undefined;
    const ready = isRecord(rawProfile.ready) ? rawProfile.ready : undefined;
    const commands = normalizeCommands(rawProfile.commands, resolvedPath, id);

    profiles.push({
      id,
      label,
      agent,
      runtimeSurface,
      sshTarget: stringValue(rawProfile.sshTarget) ?? undefined,
      paths: {
        repoRoot: stringValue(paths.repoRoot) ?? undefined,
        commsDir: stringValue(paths.commsDir) ?? undefined,
      },
      capabilities: {
        ready: booleanValue(capabilities.ready) ?? false,
        status: booleanValue(capabilities.status) ?? false,
        apply: booleanValue(capabilities.apply) ?? false,
      },
      status,
      ready,
      commands,
    });
  }

  return {
    path: resolvedPath,
    profiles,
  };
}

function normalizeCommands(
  rawCommands: unknown,
  packPath: string,
  profileId: string,
): ProfilePackCommandCatalog | undefined {
  if (rawCommands === undefined) return undefined;
  if (!isRecord(rawCommands)) {
    throw profilePackError(
      packPath,
      `profile ${profileId} commands must be an object`,
    );
  }
  const commands: ProfilePackCommandCatalog = {};
  for (const [commandId, rawCommand] of Object.entries(rawCommands)) {
    if (!isRecord(rawCommand)) {
      throw profilePackError(
        packPath,
        `profile ${profileId} command ${commandId} must be an object`,
      );
    }
    const shell = stringValue(rawCommand.shell);
    const risk = stringValue(rawCommand.risk);
    const reviewRequired = booleanValue(rawCommand.reviewRequired);
    const defaultEnabled = booleanValue(rawCommand.defaultEnabled);
    if (!shell || !risk) {
      throw profilePackError(
        packPath,
        `profile ${profileId} command ${commandId} requires shell and risk`,
      );
    }
    if (reviewRequired !== true || defaultEnabled !== false) {
      throw profilePackError(
        packPath,
        `profile ${profileId} command ${commandId} must set reviewRequired=true and defaultEnabled=false`,
      );
    }
    commands[commandId] = {
      shell,
      risk,
      reviewRequired,
      defaultEnabled,
    };
  }
  return commands;
}

function profileCommand(
  profile: ProfilePackProfile,
  commandRef: string | null,
): string | null {
  if (!commandRef || !profile.commands) return null;
  return profile.commands[commandRef]?.shell ?? null;
}

export function statusProfilesFromProfilePack(
  profilePackPath: string,
): ProfileConfig[] {
  const pack = loadProfilePack(profilePackPath);
  return pack.profiles
    .map((profile) => statusProfileFromPackProfile(pack.path, profile))
    .filter((profile): profile is ProfileConfig => Boolean(profile));
}

export function readyProfilesFromProfilePack(
  profilePackPath: string,
): ReadyProfileConfig[] {
  const pack = loadProfilePack(profilePackPath);
  return pack.profiles
    .map((profile) => readyProfileFromPackProfile(pack.path, profile))
    .filter((profile): profile is ReadyProfileConfig => Boolean(profile));
}

export function findStatusProfileInProfilePack(
  profilePackPath: string | null,
  profileId: string,
): ProfileConfig | null {
  if (!profilePackPath) return null;
  return (
    statusProfilesFromProfilePack(profilePackPath).find(
      (profile) => profile.id === profileId,
    ) ?? null
  );
}

export function findReadyProfileInProfilePack(
  profilePackPath: string | null,
  profileId: string,
): ReadyProfileConfig | null {
  if (!profilePackPath) return null;
  return (
    readyProfilesFromProfilePack(profilePackPath).find(
      (profile) => profile.id === profileId,
    ) ?? null
  );
}

function statusProfileFromPackProfile(
  packPath: string,
  profile: ProfilePackProfile,
): ProfileConfig | null {
  if (profile.capabilities?.status !== true) return null;
  if (profile.runtimeSurface === "codex-cli") {
    return codexCliStatusProfile(packPath, profile);
  }
  if (profile.runtimeSurface === "remote-panel") {
    return remotePanelStatusProfile(packPath, profile);
  }
  return null;
}

function codexCliStatusProfile(
  packPath: string,
  profile: ProfilePackProfile,
): CliProfileConfig {
  const status = profile.status ?? {};
  const repoRoot = resolveProfilePath(
    packPath,
    profile.paths?.repoRoot ?? null,
  );
  const commsDir = resolveProfilePath(
    packPath,
    profile.paths?.commsDir ?? null,
  );
  const expectedPermissionMode =
    stringValue(status.expectedPermissionMode) === "full" ? "full" : "safe";
  const receiverSession =
    stringValue(status.receiverSession) ?? `tap-receiver-${profile.id}`;
  const receiverLogPath =
    stringValue(status.receiverLogPath) ??
    path.join(repoRoot, ".tap-comms", "logs", `${receiverSession}.log`);
  const flowSupervisors = Array.isArray(status.flowSupervisors)
    ? status.flowSupervisors
        .map((rawSupervisor) => flowSupervisor(rawSupervisor))
        .filter((supervisor): supervisor is FlowSupervisorConfig =>
          Boolean(supervisor),
        )
    : undefined;
  const headlessRunner = headlessRunnerStatus(status.headlessRunner);

  return {
    kind: "codex-cli",
    id: profile.id,
    label: profile.label,
    agent: profile.agent,
    runtimeSurface: "codex-cli",
    expectedPermissionMode,
    repoRoot,
    commsDir,
    receiverSession,
    receiverLogPath,
    supervisorStateName:
      stringValue(status.supervisorStateName) ?? `${profile.id}-supervisor`,
    appServerUrl: stringValue(status.appServerUrl) ?? "ws://127.0.0.1:4501",
    sshTarget: profile.sshTarget,
    ...(flowSupervisors?.length ? { flowSupervisors } : {}),
    ...(headlessRunner ? { headlessRunner } : {}),
  };
}

function flowSupervisor(rawSupervisor: unknown): FlowSupervisorConfig | null {
  if (!isRecord(rawSupervisor)) return null;
  const id = stringValue(rawSupervisor.id);
  const label = stringValue(rawSupervisor.label);
  const tmuxSession = stringValue(rawSupervisor.tmuxSession);
  const startCommand = stringValue(rawSupervisor.startCommand);
  const statusCommand = stringValue(rawSupervisor.statusCommand);
  if (!id || !label || !tmuxSession || !startCommand || !statusCommand) {
    return null;
  }
  return {
    id,
    label,
    host: stringValue(rawSupervisor.host) ?? "local",
    tmuxSession,
    startCommand,
    statusCommand,
  };
}

function headlessRunnerStatus(
  rawRunner: unknown,
): HeadlessRunnerStatusConfig | null {
  if (!isRecord(rawRunner)) return null;
  const profile = stringValue(rawRunner.profile);
  const tmuxSession = stringValue(rawRunner.tmuxSession);
  const startCommand = stringValue(rawRunner.startCommand);
  const stopCommand = stringValue(rawRunner.stopCommand);
  const statusCommand = stringValue(rawRunner.statusCommand);
  if (
    !profile ||
    !tmuxSession ||
    !startCommand ||
    !stopCommand ||
    !statusCommand
  ) {
    return null;
  }
  return {
    profile,
    tmuxSession,
    startCommand,
    stopCommand,
    statusCommand,
  };
}

function remotePanelStatusProfile(
  packPath: string,
  profile: ProfilePackProfile,
): RemotePanelProfileConfig {
  const status = profile.status ?? {};
  return {
    kind: "remote-panel",
    id: profile.id,
    label: profile.label,
    agent: profile.agent,
    runtimeSurface: "remote-panel",
    repoRoot: resolveProfilePath(packPath, profile.paths?.repoRoot ?? null),
    commsDir: resolveProfilePath(packPath, profile.paths?.commsDir ?? null),
    sshTarget: profile.sshTarget,
    host: stringValue(status.host) ?? "127.0.0.1",
    port: numberValue(status.port) ?? 8765,
    readOnly: booleanValue(status.readOnly) ?? true,
    sendEnabled: booleanValue(status.sendEnabled) ?? false,
    tokenEnv: stringValue(status.tokenEnv) ?? undefined,
  };
}

function readyProfileFromPackProfile(
  packPath: string,
  profile: ProfilePackProfile,
): ReadyProfileConfig | null {
  if (profile.capabilities?.ready !== true) return null;
  if (!profile.ready) return null;
  const surface = stringValue(profile.ready.surface);
  if (surface !== "codex-cli" && surface !== "remote-panel") return null;
  const commandRef = stringValue(profile.ready.commandRef);
  const command = profileCommand(profile, commandRef);
  if (!command) return null;
  return {
    id: profile.id,
    surface,
    agent: profile.agent,
    command,
    appServerUrl: stringValue(profile.ready.appServerUrl) ?? undefined,
    host: stringValue(profile.ready.host) ?? undefined,
    port: numberValue(profile.ready.port) ?? undefined,
    sendEnabled: booleanValue(profile.ready.sendEnabled) ?? undefined,
    tokenEnv: stringValue(profile.ready.tokenEnv),
    source: "profile-pack",
    profilePackPath: packPath,
    allowApply: false,
  };
}
