import * as fs from "node:fs";
import * as path from "node:path";
import type {
  TapSharedConfig,
  TapLocalConfig,
  TapResolvedConfig,
  ConfigSource,
  ConfigResolution,
  TrackedConfigSource,
  TrackedValue,
  TapTrackedConfig,
} from "./types.js";
import { computeConfigHash } from "./config-hash.js";

// ─── File names ────────────────────────────────────────────────

export const SHARED_CONFIG_FILE = "tap-config.json";
export const LOCAL_CONFIG_FILE = "tap-config.local.json";
export const LEGACY_CONFIG_FILE = ".tap-config";

// ─── Defaults ──────────────────────────────────────────────────

const DEFAULT_RUNTIME_COMMAND = "node";
const DEFAULT_APP_SERVER_URL = "ws://127.0.0.1:4501";

// ─── Repo root discovery ───────────────────────────────────────

import { _noGitWarned, _setNoGitWarned, log } from "../utils.js";

export function findRepoRoot(startDir: string = process.cwd()): string {
  let dir = path.resolve(startDir);
  while (true) {
    if (fs.existsSync(path.join(dir, ".git"))) return dir;
    if (fs.existsSync(path.join(dir, "package.json"))) {
      if (!_noGitWarned) {
        _setNoGitWarned();
        log(
          "No .git directory found. Resolved tap root via package.json. " +
            "That's fine outside git; use --comms-dir to choose a different comms location.",
        );
      }
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  if (!_noGitWarned) {
    _setNoGitWarned();
    log(
      "No git repository or package.json found. Using the current directory as tap root. " +
        "That's fine outside git; use --comms-dir to choose a different comms location.",
    );
  }
  return process.cwd();
}

// ─── JSON file loading ─────────────────────────────────────────

function loadJsonFile<T>(filePath: string): T | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function loadSharedConfig(repoRoot: string): TapSharedConfig | null {
  return loadJsonFile<TapSharedConfig>(path.join(repoRoot, SHARED_CONFIG_FILE));
}

export function loadLocalConfig(repoRoot: string): TapLocalConfig | null {
  return loadJsonFile<TapLocalConfig>(path.join(repoRoot, LOCAL_CONFIG_FILE));
}

function readLegacyShellValue(configText: string, key: string): string | null {
  const match = configText.match(new RegExp(`^${key}="?(.+?)"?$`, "m"));
  return match?.[1]?.trim() || null;
}

function loadLegacyShellConfig(repoRoot: string): TapSharedConfig | null {
  const filePath = path.join(repoRoot, LEGACY_CONFIG_FILE);
  if (!fs.existsSync(filePath)) return null;

  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const commsDir = readLegacyShellValue(raw, "TAP_COMMS_DIR");
    if (!commsDir) return null;
    return { commsDir };
  } catch {
    return null;
  }
}

// ─── CLI overrides ─────────────────────────────────────────────

export interface ConfigOverrides {
  commsDir?: string;
  stateDir?: string;
  runtimeCommand?: string;
  appServerUrl?: string;
}

// ─── Resolution ────────────────────────────────────────────────

/**
 * Resolve config with priority: CLI flag > env > local config > shared config > auto.
 */
export function resolveConfig(
  overrides: ConfigOverrides = {},
  startDir?: string,
): ConfigResolution {
  const repoRoot = findRepoRoot(startDir);
  const shared = loadSharedConfig(repoRoot) ?? {};
  const local = loadLocalConfig(repoRoot) ?? {};
  const legacy = loadLegacyShellConfig(repoRoot) ?? {};

  const sources: Record<keyof TapResolvedConfig, ConfigSource> = {
    repoRoot: "auto",
    commsDir: "auto",
    stateDir: "auto",
    runtimeCommand: "auto",
    appServerUrl: "auto",
    towerName: "auto",
  };

  // ─── commsDir ──────────────────────────────────────────────
  let commsDir: string;
  if (overrides.commsDir) {
    commsDir = resolvePath(repoRoot, overrides.commsDir);
    sources.commsDir = "cli-flag";
  } else if (process.env.TAP_COMMS_DIR) {
    commsDir = resolvePath(repoRoot, process.env.TAP_COMMS_DIR);
    sources.commsDir = "env";
  } else if (local.commsDir) {
    commsDir = resolvePath(repoRoot, local.commsDir);
    sources.commsDir = "local-config";
  } else if (shared.commsDir) {
    commsDir = resolvePath(repoRoot, shared.commsDir);
    sources.commsDir = "shared-config";
  } else if (legacy.commsDir) {
    commsDir = resolvePath(repoRoot, legacy.commsDir);
    sources.commsDir = "legacy-shell-config";
  } else {
    commsDir = path.join(repoRoot, "tap-comms");
  }

  // ─── stateDir ──────────────────────────────────────────────
  let stateDir: string;
  if (overrides.stateDir) {
    stateDir = resolvePath(repoRoot, overrides.stateDir);
    sources.stateDir = "cli-flag";
  } else if (process.env.TAP_STATE_DIR) {
    stateDir = resolvePath(repoRoot, process.env.TAP_STATE_DIR);
    sources.stateDir = "env";
  } else if (local.stateDir) {
    stateDir = resolvePath(repoRoot, local.stateDir);
    sources.stateDir = "local-config";
  } else if (shared.stateDir) {
    stateDir = resolvePath(repoRoot, shared.stateDir);
    sources.stateDir = "shared-config";
  } else {
    stateDir = path.join(repoRoot, ".tap-comms");
  }

  // ─── runtimeCommand ────────────────────────────────────────
  let runtimeCommand: string;
  if (overrides.runtimeCommand) {
    runtimeCommand = overrides.runtimeCommand;
    sources.runtimeCommand = "cli-flag";
  } else if (process.env.TAP_RUNTIME_COMMAND) {
    runtimeCommand = process.env.TAP_RUNTIME_COMMAND;
    sources.runtimeCommand = "env";
  } else if (local.runtimeCommand) {
    runtimeCommand = local.runtimeCommand;
    sources.runtimeCommand = "local-config";
  } else if (shared.runtimeCommand) {
    runtimeCommand = shared.runtimeCommand;
    sources.runtimeCommand = "shared-config";
  } else {
    runtimeCommand = DEFAULT_RUNTIME_COMMAND;
  }

  // ─── appServerUrl ──────────────────────────────────────────
  let appServerUrl: string;
  if (overrides.appServerUrl) {
    appServerUrl = overrides.appServerUrl;
    sources.appServerUrl = "cli-flag";
  } else if (process.env.TAP_APP_SERVER_URL) {
    appServerUrl = process.env.TAP_APP_SERVER_URL;
    sources.appServerUrl = "env";
  } else if (local.appServerUrl) {
    appServerUrl = local.appServerUrl;
    sources.appServerUrl = "local-config";
  } else if (shared.appServerUrl) {
    appServerUrl = shared.appServerUrl;
    sources.appServerUrl = "shared-config";
  } else {
    appServerUrl = DEFAULT_APP_SERVER_URL;
  }

  // ─── towerName ──────────────────────────────────────────────
  const towerName = local.towerName ?? shared.towerName ?? null;

  return {
    config: {
      repoRoot,
      commsDir,
      stateDir,
      runtimeCommand,
      appServerUrl,
      towerName,
    },
    sources,
  };
}

// ─── Save helpers ──────────────────────────────────────────────

export function saveSharedConfig(
  repoRoot: string,
  config: TapSharedConfig,
): void {
  const filePath = path.join(repoRoot, SHARED_CONFIG_FILE);
  const tmp = `${filePath}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(config, null, 2) + "\n", "utf-8");
  fs.renameSync(tmp, filePath);
}

export function saveLocalConfig(
  repoRoot: string,
  config: TapLocalConfig,
): void {
  const filePath = path.join(repoRoot, LOCAL_CONFIG_FILE);
  const tmp = `${filePath}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(config, null, 2) + "\n", "utf-8");
  fs.renameSync(tmp, filePath);
}

// ─── Helpers ───────────────────────────────────────────────────

/** Resolve a path relative to repoRoot, or keep absolute as-is. */
function resolvePath(repoRoot: string, p: string): string {
  const normalized = normalizeTapPath(p);
  return path.isAbsolute(normalized)
    ? normalized
    : path.resolve(repoRoot, normalized);
}

// ─── Instance / Session Config Loading ────────────────────────

/** Subset of config fields that can be overridden per-instance or per-session. */
interface ResolveOverrides {
  agentName?: string | null;
  port?: number | null;
  bridgeMode?: string | null;
  commsDir?: string;
  stateDir?: string;
  runtimeCommand?: string;
  appServerUrl?: string;
  towerName?: string;
}

type SessionOverrides = ResolveOverrides;

/**
 * Verify that a resolved path stays within the expected subdirectory.
 * Prevents crafted IDs from crossing source boundaries
 * (e.g., instanceId="../sessions/gen22" reading a session file as instance).
 */
function assertConfigPathContained(
  resolved: string,
  baseDir: string,
  subDir: string,
): string {
  const expectedDir = path.resolve(baseDir, subDir) + path.sep;
  const normalizedResolved = path.resolve(resolved);
  if (!normalizedResolved.startsWith(expectedDir)) {
    throw new Error(
      `Config path traversal blocked: resolved path escapes "${subDir}/" directory`,
    );
  }
  return normalizedResolved;
}

export function loadInstanceConfig(
  stateDir: string,
  instanceId: string,
): ResolveOverrides | null {
  const filePath = path.join(stateDir, "instances", `${instanceId}.json`);
  assertConfigPathContained(filePath, stateDir, "instances");
  return loadJsonFile<ResolveOverrides>(filePath);
}

export function loadSessionConfig(
  stateDir: string,
  sessionId: string,
): SessionOverrides | null {
  const filePath = path.join(stateDir, "sessions", `${sessionId}.json`);
  assertConfigPathContained(filePath, stateDir, "sessions");
  return loadJsonFile<SessionOverrides>(filePath);
}

// ─── Tracked Config Resolution ────────────────────────────────

function tracked<T>(
  value: T,
  source: TrackedConfigSource,
  sourceFile: string | null = null,
): TrackedValue<T> {
  return { value, source, sourceFile };
}

export interface TrackedResolveOpts extends ConfigOverrides {
  instanceId?: string;
  sessionId?: string;
}

/**
 * Resolve config with full source tracking.
 * 7-level priority: cli > env > instance > session > local > project > default
 */
export function resolveTrackedConfig(
  opts: TrackedResolveOpts = {},
  startDir?: string,
): { tracked: TapTrackedConfig; hash: string } {
  const repoRoot = findRepoRoot(startDir);
  const shared = loadSharedConfig(repoRoot) ?? {};
  const local = loadLocalConfig(repoRoot) ?? {};
  const legacy = loadLegacyShellConfig(repoRoot) ?? {};

  // Resolve stateDir first (needed for instance/session paths)
  const rawStateDir =
    opts.stateDir ??
    process.env.TAP_STATE_DIR ??
    local.stateDir ??
    shared.stateDir ??
    null;
  const stateDir = rawStateDir
    ? resolvePath(repoRoot, rawStateDir)
    : path.join(repoRoot, ".tap-comms");

  // Load instance/session configs (graceful fallback)
  const inst = opts.instanceId
    ? loadInstanceConfig(stateDir, opts.instanceId)
    : null;
  const instFile = opts.instanceId
    ? path.join(stateDir, "instances", `${opts.instanceId}.json`)
    : null;
  const sess = opts.sessionId
    ? loadSessionConfig(stateDir, opts.sessionId)
    : null;
  const sessFile = opts.sessionId
    ? path.join(stateDir, "sessions", `${opts.sessionId}.json`)
    : null;

  // Chain resolution helper — finds first defined value from highest priority
  function resolveField<T>(
    cliVal: T | undefined,
    envVal: T | undefined,
    instVal: T | undefined,
    sessVal: T | undefined,
    localVal: T | undefined,
    projectVal: T | undefined,
    defaultVal: T,
  ): TrackedValue<T> {
    if (cliVal !== undefined) return tracked(cliVal, "cli");
    if (envVal !== undefined) return tracked(envVal, "env");
    if (instVal !== undefined) return tracked(instVal, "instance", instFile);
    if (sessVal !== undefined) return tracked(sessVal, "session", sessFile);
    if (localVal !== undefined)
      return tracked(localVal, "local", path.join(repoRoot, LOCAL_CONFIG_FILE));
    if (projectVal !== undefined)
      return tracked(
        projectVal,
        "project",
        path.join(repoRoot, SHARED_CONFIG_FILE),
      );
    return tracked(defaultVal, "default");
  }

  const commsDirTracked = resolveField(
    opts.commsDir ? resolvePath(repoRoot, opts.commsDir) : undefined,
    process.env.TAP_COMMS_DIR
      ? resolvePath(repoRoot, process.env.TAP_COMMS_DIR)
      : undefined,
    inst?.commsDir ? resolvePath(repoRoot, inst.commsDir) : undefined,
    sess?.commsDir ? resolvePath(repoRoot, sess.commsDir) : undefined,
    local.commsDir ? resolvePath(repoRoot, local.commsDir) : undefined,
    (shared.commsDir ?? legacy.commsDir)
      ? resolvePath(repoRoot, (shared.commsDir ?? legacy.commsDir)!)
      : undefined,
    path.join(repoRoot, "tap-comms"),
  );

  const stateDirTracked = resolveField(
    opts.stateDir ? resolvePath(repoRoot, opts.stateDir) : undefined,
    process.env.TAP_STATE_DIR
      ? resolvePath(repoRoot, process.env.TAP_STATE_DIR)
      : undefined,
    inst?.stateDir ? resolvePath(repoRoot, inst.stateDir) : undefined,
    sess?.stateDir ? resolvePath(repoRoot, sess.stateDir) : undefined,
    local.stateDir ? resolvePath(repoRoot, local.stateDir) : undefined,
    shared.stateDir ? resolvePath(repoRoot, shared.stateDir) : undefined,
    stateDir,
  );

  const runtimeCommandTracked = resolveField(
    opts.runtimeCommand,
    process.env.TAP_RUNTIME_COMMAND,
    inst?.runtimeCommand,
    sess?.runtimeCommand,
    local.runtimeCommand,
    shared.runtimeCommand,
    DEFAULT_RUNTIME_COMMAND,
  );

  const appServerUrlTracked = resolveField(
    opts.appServerUrl,
    process.env.TAP_APP_SERVER_URL,
    inst?.appServerUrl,
    sess?.appServerUrl,
    local.appServerUrl,
    shared.appServerUrl,
    DEFAULT_APP_SERVER_URL,
  );

  const towerNameTracked = resolveField<string | null>(
    undefined, // no CLI flag for towerName
    undefined, // no env for towerName
    inst?.towerName ?? undefined,
    sess?.towerName ?? undefined,
    local.towerName ?? undefined,
    shared.towerName ?? undefined,
    null,
  );

  const agentNameTracked = resolveField<string | null>(
    undefined,
    undefined,
    inst?.agentName ?? undefined,
    sess?.agentName ?? undefined,
    undefined,
    undefined,
    null,
  );

  const portTracked = resolveField<number | null>(
    undefined,
    undefined,
    inst?.port ?? undefined,
    sess?.port ?? undefined,
    undefined,
    undefined,
    null,
  );

  const bridgeModeTracked = resolveField<string | null>(
    undefined,
    undefined,
    inst?.bridgeMode ?? undefined,
    sess?.bridgeMode ?? undefined,
    undefined,
    undefined,
    null,
  );

  const trackedConfig: TapTrackedConfig = {
    repoRoot: tracked(repoRoot, "default"),
    commsDir: commsDirTracked,
    stateDir: stateDirTracked,
    runtimeCommand: runtimeCommandTracked,
    appServerUrl: appServerUrlTracked,
    towerName: towerNameTracked,
    agentName: agentNameTracked,
    port: portTracked,
    bridgeMode: bridgeModeTracked,
  };

  return { tracked: trackedConfig, hash: computeConfigHash(trackedConfig) };
}

export function normalizeTapPath(input: string): string {
  const trimmed = input.trim().replace(/^["'`]+|["'`]+$/g, "");
  if (/^[A-Za-z]:[\\/]/.test(trimmed)) {
    return trimmed;
  }

  // MSYS/Git Bash `/c/...` → `C:\...` conversion — Windows only.
  // On POSIX, `/d/...` is a legitimate absolute path and must not be rewritten.
  if (process.platform === "win32") {
    const match = trimmed.match(/^\/([A-Za-z])\/(.*)$/);
    if (match) {
      return `${match[1].toUpperCase()}:\\${match[2].replace(/\//g, "\\")}`;
    }
  }

  return trimmed;
}
