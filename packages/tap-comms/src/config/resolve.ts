import * as fs from "node:fs";
import * as path from "node:path";
import type {
  TapSharedConfig,
  TapLocalConfig,
  TapResolvedConfig,
  ConfigSource,
  ConfigResolution,
} from "./types.js";

// ─── File names ────────────────────────────────────────────────

export const SHARED_CONFIG_FILE = "tap-config.json";
export const LOCAL_CONFIG_FILE = "tap-config.local.json";

// ─── Defaults ──────────────────────────────────────────────────

const DEFAULT_RUNTIME_COMMAND = "node";
const DEFAULT_APP_SERVER_URL = "ws://127.0.0.1:4501";

// ─── Repo root discovery ───────────────────────────────────────

export function findRepoRoot(startDir: string = process.cwd()): string {
  let dir = path.resolve(startDir);
  while (true) {
    if (fs.existsSync(path.join(dir, ".git"))) return dir;
    if (fs.existsSync(path.join(dir, "package.json"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
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

  const sources: Record<keyof TapResolvedConfig, ConfigSource> = {
    repoRoot: "auto",
    commsDir: "auto",
    stateDir: "auto",
    runtimeCommand: "auto",
    appServerUrl: "auto",
  };

  // ─── commsDir ──────────────────────────────────────────────
  let commsDir: string;
  if (overrides.commsDir) {
    commsDir = path.resolve(overrides.commsDir);
    sources.commsDir = "cli-flag";
  } else if (process.env.TAP_COMMS_DIR) {
    commsDir = path.resolve(process.env.TAP_COMMS_DIR);
    sources.commsDir = "env";
  } else if (local.commsDir) {
    commsDir = resolvePath(repoRoot, local.commsDir);
    sources.commsDir = "local-config";
  } else if (shared.commsDir) {
    commsDir = resolvePath(repoRoot, shared.commsDir);
    sources.commsDir = "shared-config";
  } else {
    commsDir = path.join(path.dirname(repoRoot), "tap-comms");
  }

  // ─── stateDir ──────────────────────────────────────────────
  let stateDir: string;
  if (overrides.stateDir) {
    stateDir = path.resolve(overrides.stateDir);
    sources.stateDir = "cli-flag";
  } else if (process.env.TAP_STATE_DIR) {
    stateDir = path.resolve(process.env.TAP_STATE_DIR);
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

  return {
    config: { repoRoot, commsDir, stateDir, runtimeCommand, appServerUrl },
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
  return path.isAbsolute(p) ? p : path.resolve(repoRoot, p);
}
