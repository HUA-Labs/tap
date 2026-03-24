type RuntimeName = "claude" | "codex" | "gemini";
type BridgeMode = "native-push" | "app-server" | "polling";
type Platform = "win32" | "darwin" | "linux";
/** Unique, immutable identifier for a runtime instance. e.g. "codex", "codex-reviewer" */
type InstanceId = string;
interface AdapterContext {
    commsDir: string;
    repoRoot: string;
    stateDir: string;
    platform: Platform;
}
interface ProbeResult {
    installed: boolean;
    configPath: string | null;
    configExists: boolean;
    runtimeCommand: string | null;
    version: string | null;
    canWrite: boolean;
    warnings: string[];
    issues: string[];
}
type ArtifactKind = "json-path" | "toml-table" | "file";
interface OwnedArtifact {
    kind: ArtifactKind;
    path: string;
    selector: string;
    backupPath?: string;
}
type PatchOpType = "set" | "merge" | "append" | "create-file";
interface PatchOp {
    type: PatchOpType;
    path: string;
    key?: string;
    value?: unknown;
    content?: string;
}
interface PatchPlan {
    runtime: RuntimeName;
    operations: PatchOp[];
    ownedArtifacts: OwnedArtifact[];
    backupDir: string;
    restartRequired: boolean;
    conflicts: string[];
    warnings: string[];
}
interface ApplyResult {
    success: boolean;
    appliedOps: number;
    backupCreated: boolean;
    lastAppliedHash: string;
    ownedArtifacts: OwnedArtifact[];
    changedFiles: string[];
    restartRequired: boolean;
    warnings: string[];
}
interface VerifyCheck {
    name: string;
    passed: boolean;
    message?: string;
}
interface VerifyResult {
    ok: boolean;
    checks: VerifyCheck[];
    restartRequired: boolean;
    warnings: string[];
}
interface RuntimeAdapter {
    readonly runtime: RuntimeName;
    probe(ctx: AdapterContext): Promise<ProbeResult>;
    plan(ctx: AdapterContext, probe: ProbeResult): Promise<PatchPlan>;
    apply(ctx: AdapterContext, plan: PatchPlan): Promise<ApplyResult>;
    verify(ctx: AdapterContext, plan: PatchPlan): Promise<VerifyResult>;
    bridgeMode(): BridgeMode;
    /** Resolve the bridge script path. Only called for app-server mode. */
    resolveBridgeScript?(ctx: AdapterContext): string | null;
}
type AgentRole = "reviewer" | "validator" | "long-running";
interface HeadlessConfig {
    enabled: boolean;
    role: AgentRole;
    /** Max review rounds before forced termination. Default: 5 */
    maxRounds: number;
    /** Severity floor for quality-threshold strategy. Default: "high" */
    qualitySeverityFloor: "critical" | "high" | "medium";
}
interface BridgeState {
    pid: number;
    statePath: string;
    lastHeartbeat: string;
}
/** Runtime instance state. Supports multiple instances per runtime (e.g. codex-reviewer, codex-builder). */
interface InstanceState {
    instanceId: InstanceId;
    runtime: RuntimeName;
    agentName: string | null;
    port: number | null;
    installed: boolean;
    configPath: string;
    bridgeMode: BridgeMode;
    restartRequired: boolean;
    ownedArtifacts: OwnedArtifact[];
    backupPath: string;
    lastAppliedHash: string;
    lastVerifiedAt: string | null;
    bridge: BridgeState | null;
    /** Headless mode configuration. null = interactive (default). */
    headless: HeadlessConfig | null;
    warnings: string[];
}
/** @deprecated Use InstanceState. Kept for v1 state migration. */
interface RuntimeState {
    installed: boolean;
    configPath: string;
    bridgeMode: BridgeMode;
    restartRequired: boolean;
    ownedArtifacts: OwnedArtifact[];
    backupPath: string;
    lastAppliedHash: string;
    lastVerifiedAt: string | null;
    bridge: BridgeState | null;
    warnings: string[];
}
/** Schema v2: instances keyed by InstanceId */
interface TapState {
    schemaVersion: number;
    createdAt: string;
    updatedAt: string;
    commsDir: string;
    repoRoot: string;
    packageVersion: string;
    instances: Record<InstanceId, InstanceState>;
}
/** Schema v1: runtimes keyed by RuntimeName. Used for migration only. */
interface TapStateV1 {
    schemaVersion: 1;
    createdAt: string;
    updatedAt: string;
    commsDir: string;
    repoRoot: string;
    packageVersion: string;
    runtimes: Partial<Record<RuntimeName, RuntimeState>>;
}
type CommandName = "init" | "init-worktree" | "add" | "remove" | "status" | "serve" | "bridge" | "dashboard" | "unknown";
type CommandCode = "TAP_INIT_OK" | "TAP_ADD_OK" | "TAP_REMOVE_OK" | "TAP_STATUS_OK" | "TAP_SERVE_OK" | "TAP_NO_OP" | "TAP_ALREADY_INITIALIZED" | "TAP_NOT_INITIALIZED" | "TAP_RUNTIME_UNKNOWN" | "TAP_RUNTIME_NOT_FOUND" | "TAP_CONFIG_INVALID" | "TAP_LOCAL_SERVER_MISSING" | "TAP_INVALID_ARGUMENT" | "TAP_INSTANCE_NOT_FOUND" | "TAP_INSTANCE_AMBIGUOUS" | "TAP_PORT_CONFLICT" | "TAP_PATCH_FAILED" | "TAP_VERIFY_FAILED" | "TAP_ROLLBACK_FAILED" | "TAP_BRIDGE_START_OK" | "TAP_BRIDGE_START_FAILED" | "TAP_BRIDGE_STOP_OK" | "TAP_BRIDGE_STATUS_OK" | "TAP_BRIDGE_NOT_RUNNING" | "TAP_BRIDGE_SCRIPT_MISSING" | "TAP_SERVE_NO_SERVER" | "TAP_SERVE_BUN_REQUIRED" | "TAP_REVIEW_START_OK" | "TAP_REVIEW_TERMINATED" | "TAP_INTERNAL_ERROR";
interface CommandResult<T = Record<string, unknown>> {
    ok: boolean;
    command: CommandName;
    runtime?: RuntimeName;
    instanceId?: InstanceId;
    code: CommandCode;
    message: string;
    warnings: string[];
    data: T;
}

declare function stateExists(repoRoot: string): boolean;
declare function loadState(repoRoot: string): TapState | null;
declare function saveState(repoRoot: string, state: TapState): void;
declare function createInitialState(commsDir: string, repoRoot: string, packageVersion: string): TapState;

declare const version = "0.1.0";

/**
 * Shared config (tap-config.json) — git tracked, repo-level defaults.
 * All paths are repo-relative unless explicitly absolute.
 */
interface TapSharedConfig {
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
type TapLocalConfig = TapSharedConfig;
/**
 * Resolved config — all values populated, absolute paths.
 */
interface TapResolvedConfig {
    repoRoot: string;
    commsDir: string;
    stateDir: string;
    runtimeCommand: string;
    appServerUrl: string;
}
/** Config resolution source for diagnostics. */
type ConfigSource = "cli-flag" | "env" | "local-config" | "shared-config" | "auto";
interface ConfigResolution {
    config: TapResolvedConfig;
    sources: Record<keyof TapResolvedConfig, ConfigSource>;
}

declare const SHARED_CONFIG_FILE = "tap-config.json";
declare const LOCAL_CONFIG_FILE = "tap-config.local.json";
declare function loadSharedConfig(repoRoot: string): TapSharedConfig | null;
declare function loadLocalConfig(repoRoot: string): TapLocalConfig | null;
interface ConfigOverrides {
    commsDir?: string;
    stateDir?: string;
    runtimeCommand?: string;
    appServerUrl?: string;
}
/**
 * Resolve config with priority: CLI flag > env > local config > shared config > auto.
 */
declare function resolveConfig(overrides?: ConfigOverrides, startDir?: string): ConfigResolution;
declare function saveSharedConfig(repoRoot: string, config: TapSharedConfig): void;
declare function saveLocalConfig(repoRoot: string, config: TapLocalConfig): void;

declare function rotateLog(logPath: string): void;
/**
 * Update the heartbeat timestamp for a running bridge.
 * Bridge processes should call this periodically.
 *
 * Only the owning process (matching PID) can update the heartbeat.
 * This prevents state dir collision when multiple writers exist.
 * See: 묵 finding — bridge-heartbeat-state-dir-collision
 */
declare function updateBridgeHeartbeat(stateDir: string, instanceId: InstanceId): void;
/**
 * Get heartbeat age in seconds. Returns null if no state or no heartbeat.
 */
declare function getHeartbeatAge(stateDir: string, instanceId: InstanceId): number | null;

/**
 * Common Node.js runtime resolver for all tap-comms child processes.
 *
 * Resolution chain:
 *   .node-version + fnm probe → configured command → tsx fallback
 *
 * Extracted from codex-bridge-runner.ts (M69) to share across:
 *   - bridge engine spawn
 *   - bridge runner spawn
 *   - future CLI commands
 */
type RuntimeSource = "fnm" | "config" | "path" | "tsx-fallback" | "bun";
interface ResolvedRuntime {
    /** Absolute path or command name for the resolved runtime. */
    command: string;
    /** Whether --experimental-strip-types is supported and should be used. */
    supportsStripTypes: boolean;
    /** Where the runtime was resolved from (for diagnostics). */
    source: RuntimeSource;
    /** Detected major version, if available. */
    majorVersion: number | null;
}
declare function readNodeVersion(repoRoot: string): string | null;
declare function probeFnmNode(desiredVersion: string): string | null;
/**
 * Returns the directory containing the fnm-managed node binary,
 * suitable for prepending to PATH in child processes.
 */
declare function getFnmBinDir(repoRoot: string): string | null;
/**
 * Resolve the Node.js runtime to use for spawning child processes.
 *
 * Priority: bun passthrough → .node-version + fnm → configured command → tsx fallback
 */
declare function resolveNodeRuntime(configCommand: string, repoRoot: string): ResolvedRuntime;
/**
 * Build an env object with fnm Node prepended to PATH.
 * Use this when spawning child processes that need the correct Node.
 */
declare function buildRuntimeEnv(repoRoot: string, baseEnv?: NodeJS.ProcessEnv): NodeJS.ProcessEnv;

export { type AdapterContext, type ApplyResult, type ArtifactKind, type BridgeMode, type BridgeState, type CommandCode, type CommandName, type CommandResult, type ConfigOverrides, type ConfigResolution, type ConfigSource, type InstanceId, type InstanceState, LOCAL_CONFIG_FILE, type OwnedArtifact, type PatchOp, type PatchOpType, type PatchPlan, type Platform, type ProbeResult, type ResolvedRuntime, type RuntimeAdapter, type RuntimeName, type RuntimeSource, type RuntimeState, SHARED_CONFIG_FILE, type TapLocalConfig, type TapResolvedConfig, type TapSharedConfig, type TapState, type TapStateV1, type VerifyCheck, type VerifyResult, buildRuntimeEnv, createInitialState, getFnmBinDir, getHeartbeatAge, loadLocalConfig, loadSharedConfig, loadState, probeFnmNode, readNodeVersion, resolveConfig, resolveNodeRuntime, rotateLog, saveLocalConfig, saveSharedConfig, saveState, stateExists, updateBridgeHeartbeat, version };
