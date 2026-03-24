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
}

/** Config resolution source for diagnostics. */
export type ConfigSource =
  | "cli-flag"
  | "env"
  | "local-config"
  | "shared-config"
  | "auto";

export interface ConfigResolution {
  config: TapResolvedConfig;
  sources: Record<keyof TapResolvedConfig, ConfigSource>;
}
