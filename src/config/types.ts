// ─── Config Types ──────────────────────────────────────────────

/**
 * Shared config (tap-config.json) — git tracked, repo-level defaults.
 * All paths are repo-relative unless explicitly absolute.
 */
export interface TapSharedConfig {
  /** Comms directory path. Repo-relative or absolute. */
  commsDir?: string;
  /** State directory path. Defaults to .tap-comms/ under repoRoot. */
  stateDir?: string;
  /** Runtime command: "bun" | "node". */
  runtimeCommand?: string;
  /** App server WebSocket URL for bridge connections. */
  appServerUrl?: string;
  /** GitHub URL for the comms repository (used by `tap comms pull/push`). */
  commsRepoUrl?: string;
  /** Control tower agent name. Used for auto-notify on new agent join (M111). */
  towerName?: string;
}

/**
 * Local config (tap-config.local.json) — gitignored, machine-specific overrides.
 * Same shape as shared, overrides shared values.
 */
export type TapLocalConfig = TapSharedConfig;

/**
 * Resolved config — all values populated, absolute paths.
 */
export interface TapResolvedConfig {
  repoRoot: string;
  commsDir: string;
  stateDir: string;
  runtimeCommand: string;
  appServerUrl: string;
  towerName: string | null;
}

/** Config resolution source for diagnostics (legacy API — backward compatible). */
export type ConfigSource =
  | "cli-flag"
  | "env"
  | "local-config"
  | "shared-config"
  | "legacy-shell-config"
  | "auto";

export interface ConfigResolution {
  config: TapResolvedConfig;
  sources: Record<keyof TapResolvedConfig, ConfigSource>;
}

// ─── Tracked Config (source-aware values) ──────────────────────

/**
 * Extended config source — 7-level priority hierarchy for TrackedValue.
 * Priority: cli(7) > env(6) > instance(5) > session(4) > local(3) > project(2) > default(1)
 */
export type TrackedConfigSource =
  | "cli" // --flag (highest priority)
  | "env" // TAP_* environment variables
  | "instance" // .tap-comms/instances/{id}.json
  | "session" // .tap-comms/sessions/{gen}.json
  | "local" // tap-config.local.json (gitignored)
  | "project" // tap-config.json (git-tracked)
  | "default"; // hardcoded defaults (lowest priority)

/** A config value with its origin tracked for diagnostics and drift detection. */
export interface TrackedValue<T> {
  value: T;
  source: TrackedConfigSource;
  /** File path this value was loaded from (null for env/cli/default sources). */
  sourceFile: string | null;
}

/** Fully resolved config where every value carries its source. */
export interface TapTrackedConfig {
  repoRoot: TrackedValue<string>;
  commsDir: TrackedValue<string>;
  stateDir: TrackedValue<string>;
  runtimeCommand: TrackedValue<string>;
  appServerUrl: TrackedValue<string>;
  towerName: TrackedValue<string | null>;
  // Instance-specific (populated when instanceId is provided)
  agentName: TrackedValue<string | null>;
  port: TrackedValue<number | null>;
  bridgeMode: TrackedValue<string | null>;
}
