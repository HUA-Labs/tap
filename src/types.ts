// ─── Runtime Types ──────────────────────────────────────────────

export type RuntimeName = "claude" | "codex" | "gemini";
export type BridgeMode = "native-push" | "app-server" | "polling";
export type Platform = "win32" | "darwin" | "linux";

// ─── Instance ID ───────────────────────────────────────────────

/** Unique, immutable identifier for a runtime instance. e.g. "codex", "codex-agent-a" */
export type InstanceId = string;

// ─── Adapter Context ────────────────────────────────────────────

export interface AdapterContext {
  commsDir: string;
  repoRoot: string;
  stateDir: string; // .tap-comms/
  platform: Platform;
  /** Instance ID for TAP_AGENT_ID env injection. Set by 'tap add'. */
  instanceId?: string;
  /** Agent name from state. Injected as TAP_AGENT_NAME in MCP config. */
  agentName?: string;
}

// ─── Probe ──────────────────────────────────────────────────────

export interface ProbeResult {
  installed: boolean;
  configPath: string | null;
  configExists: boolean;
  runtimeCommand: string | null;
  version: string | null;
  canWrite: boolean;
  warnings: string[];
  issues: string[];
}

// ─── Patch Plan ─────────────────────────────────────────────────

export type ArtifactKind = "json-path" | "toml-table" | "file";

export interface OwnedArtifact {
  kind: ArtifactKind;
  path: string;
  selector: string; // e.g. "mcpServers.tap" or "mcp_servers.tap"
  backupPath?: string;
}

export type PatchOpType = "set" | "merge" | "append" | "create-file";

export interface PatchOp {
  type: PatchOpType;
  path: string; // target file
  key?: string; // JSON/TOML key path
  value?: unknown;
  content?: string; // for create-file
}

export interface PatchPlan {
  runtime: RuntimeName;
  operations: PatchOp[];
  ownedArtifacts: OwnedArtifact[];
  backupDir: string;
  restartRequired: boolean;
  conflicts: string[];
  warnings: string[];
}

// ─── Apply ──────────────────────────────────────────────────────

export interface ApplyResult {
  success: boolean;
  appliedOps: number;
  backupCreated: boolean;
  lastAppliedHash: string;
  ownedArtifacts: OwnedArtifact[];
  changedFiles: string[];
  restartRequired: boolean;
  warnings: string[];
}

// ─── Verify ─────────────────────────────────────────────────────

export interface VerifyCheck {
  name: string;
  passed: boolean;
  message?: string;
}

export interface VerifyResult {
  ok: boolean;
  checks: VerifyCheck[];
  restartRequired: boolean;
  warnings: string[];
}

// ─── Adapter Interface ──────────────────────────────────────────

export interface RuntimeAdapter {
  readonly runtime: RuntimeName;
  probe(ctx: AdapterContext): Promise<ProbeResult>;
  plan(ctx: AdapterContext, probe: ProbeResult): Promise<PatchPlan>;
  apply(ctx: AdapterContext, plan: PatchPlan): Promise<ApplyResult>;
  verify(ctx: AdapterContext, plan: PatchPlan): Promise<VerifyResult>;
  bridgeMode(): BridgeMode;
  /** Resolve the bridge script path. Only called for app-server mode. */
  resolveBridgeScript?(ctx: AdapterContext): string | null;
}

// ─── Headless / Role ────────────────────────────────────────────

export type AgentRole = "reviewer" | "validator" | "long-running";

export interface HeadlessConfig {
  enabled: boolean;
  role: AgentRole;
  /** Max review rounds before forced termination. Default: 5 */
  maxRounds: number;
  /** Severity floor for quality-threshold strategy. Default: "high" */
  qualitySeverityFloor: "critical" | "high" | "medium";
}

// ─── State ──────────────────────────────────────────────────────

export interface AppServerAuthState {
  mode: "subprotocol" | "query-token";
  protectedUrl: string;
  upstreamUrl: string;
  tokenPath: string;
  gatewayPid: number | null;
  gatewayLogPath: string | null;
}

export interface AppServerState {
  url: string;
  pid: number | null;
  managed: boolean;
  healthy: boolean;
  lastCheckedAt: string; // ISO
  lastHealthyAt: string | null; // ISO
  logPath: string | null;
  manualCommand: string;
  auth?: AppServerAuthState | null;
}

export type PersistedBridgeLifecycleState =
  | "spawning"
  | "initializing"
  | "ready"
  | "degraded-no-thread"
  | "degraded-no-bridge"
  | "stopping"
  | "stopped"
  | "crashed";

export interface BridgeLifecycleRecord {
  state: PersistedBridgeLifecycleState;
  since: string; // ISO
  updatedAt: string; // ISO
  lastTransitionAt: string; // ISO
  lastTransitionReason: string | null;
  restartCount: number;
}

export interface BridgeState {
  pid: number;
  statePath: string;
  /**
   * M321 — Seed heartbeat timestamp, set at bridge start.
   * Covers the pre-first-poll gap before runtime heartbeat.json is written.
   * `resolveHeartbeatTimestamp()` prefers runtime heartbeat.json when available.
   * Not actively updated after startup — runtime heartbeat.json is the SSOT.
   */
  lastHeartbeat?: string; // ISO
  appServer?: AppServerState | null;
  /** Instance-specific daemon state dir (thread/heartbeat/processed markers). */
  runtimeStateDir?: string | null;
  lifecycle?: BridgeLifecycleRecord | null;
}

/** Runtime instance state. Supports multiple instances per runtime (e.g. codex-agent-a, codex-builder). */
export interface InstanceState {
  instanceId: InstanceId;
  runtime: RuntimeName;
  /**
   * Bootstrap default name set at install time (`tap add`) — display seed only.
   * NOT the active session name; session names live in heartbeats + claims.
   * M350: `agentName` (deprecated duplicate) removed. Legacy state files are
   * migrated on load by backfilling this field from the old `agentName`.
   */
  defaultAgentName: string | null;
  port: number | null;
  installed: boolean;
  configPath: string;
  bridgeMode: BridgeMode;
  restartRequired: boolean;
  ownedArtifacts: OwnedArtifact[];
  backupPath: string;
  lastAppliedHash: string;
  lastVerifiedAt: string | null; // ISO
  bridge: BridgeState | null;
  /** Persisted lifecycle summary even when no bridge pid file exists. */
  bridgeLifecycle?: BridgeLifecycleRecord | null;
  /** Headless mode configuration. null = interactive (default). */
  headless: HeadlessConfig | null;
  /** Whether bridge manages its own app-server process. Saved for restart mode preservation. */
  manageAppServer?: boolean;
  /** Whether bridge runs without auth gateway. Saved for restart mode preservation. */
  noAuth?: boolean;
  /** Whether managed Codex app-server bypasses the Codex sandbox at launch. */
  appServerUnsandboxed?: boolean;
  /** Retained managed app-server metadata when bridge stops with --keep-server. */
  managedAppServer?: AppServerState | null;
  /** Stable hash of resolved config for drift detection (v3+). */
  configHash?: string;
  /** Path to the instance config file (v3+). */
  configSourceFile?: string;
  warnings: string[];
}

/** @deprecated Use InstanceState. Kept for v1 state migration. */
export interface RuntimeState {
  installed: boolean;
  configPath: string;
  bridgeMode: BridgeMode;
  restartRequired: boolean;
  ownedArtifacts: OwnedArtifact[];
  backupPath: string;
  lastAppliedHash: string;
  lastVerifiedAt: string | null; // ISO
  bridge: BridgeState | null;
  warnings: string[];
}

/** Schema v2: instances keyed by InstanceId */
export interface TapState {
  schemaVersion: number;
  createdAt: string; // ISO
  updatedAt: string; // ISO
  commsDir: string;
  repoRoot: string;
  packageVersion: string;
  instances: Record<InstanceId, InstanceState>;
}

/** Schema v1: runtimes keyed by RuntimeName. Used for migration only. */
export interface TapStateV1 {
  schemaVersion: 1;
  createdAt: string;
  updatedAt: string;
  commsDir: string;
  repoRoot: string;
  packageVersion: string;
  runtimes: Partial<Record<RuntimeName, RuntimeState>>;
}

// ─── CLI ────────────────────────────────────────────────────────

export type CommandName =
  | "init"
  | "init-worktree"
  | "add"
  | "remove"
  | "status"
  | "setup"
  | "serve"
  | "bridge"
  | "up"
  | "down"
  | "comms"
  | "ready"
  | "receiver"
  | "headless"
  | "projection"
  | "uplink"
  | "dashboard"
  | "doctor"
  | "watch"
  | "gui"
  | "remote-panel"
  | "permissions"
  | "reviews"
  | "sessions"
  | "infra"
  | "windows-route-recover"
  | "app-route-freshness"
  | "comms-doctor"
  | "flow-doctor"
  | "unknown";

export type CommandCode =
  // Success
  | "TAP_INIT_OK"
  | "TAP_ADD_OK"
  | "TAP_REMOVE_OK"
  | "TAP_STATUS_OK"
  | "TAP_STATUS_PROFILE_READY"
  | "TAP_STATUS_PROFILE_DEGRADED"
  | "TAP_STATUS_PROFILE_BLOCKED"
  | "TAP_SETUP_OK"
  | "TAP_SETUP_APPLY_NOT_IMPLEMENTED"
  | "TAP_SETUP_APPLY_BLOCKED"
  | "TAP_DOCTOR_SETUP_OK"
  | "TAP_DOCTOR_SETUP_APPLY_NOT_IMPLEMENTED"
  | "TAP_DOCTOR_SETUP_APPLY_BLOCKED"
  | "TAP_SERVE_OK"
  | "TAP_PERMISSIONS_RESTORE_OK"
  | "TAP_REVIEWS_RECOVERY_OK"
  | "TAP_REVIEWS_REGISTER_OK"
  | "TAP_SESSIONS_ARCHIVE_OK"
  | "TAP_INFRA_STATUS_OK"
  | "TAP_WINDOWS_ROUTE_RECOVER_OK"
  | "TAP_APP_ROUTE_FRESHNESS_OK"
  | "TAP_COMMS_DOCTOR_OK"
  | "TAP_FLOW_DOCTOR_OK"
  // Benign no-op
  | "TAP_NO_OP"
  | "TAP_ALREADY_INITIALIZED"
  | "TAP_INIT_CLONE_FAILED"
  // User/environment errors
  | "TAP_NOT_INITIALIZED"
  | "TAP_RUNTIME_UNKNOWN"
  | "TAP_RUNTIME_NOT_FOUND"
  | "TAP_CONFIG_INVALID"
  | "TAP_LOCAL_SERVER_MISSING"
  | "TAP_INVALID_ARGUMENT"
  | "TAP_STATUS_PROFILE_REQUIRED"
  | "TAP_STATUS_UNKNOWN_PROFILE"
  // Instance errors
  | "TAP_INSTANCE_NOT_FOUND"
  | "TAP_INSTANCE_AMBIGUOUS"
  | "TAP_PORT_CONFLICT"
  // Operation failures
  | "TAP_PATCH_FAILED"
  | "TAP_VERIFY_FAILED"
  | "TAP_ROLLBACK_FAILED"
  | "TAP_BRIDGE_START_OK"
  | "TAP_BRIDGE_START_FAILED"
  | "TAP_BRIDGE_RESTART_OK"
  | "TAP_BRIDGE_RESTART_FAILED"
  | "TAP_BRIDGE_RESTART_EXTERNAL"
  | "TAP_BRIDGE_RESTART_BLOCKED"
  | "TAP_BRIDGE_DRAIN_TIMEOUT"
  | "TAP_BRIDGE_STOP_OK"
  | "TAP_BRIDGE_STATUS_OK"
  | "TAP_BRIDGE_NOT_RUNNING"
  | "TAP_BRIDGE_SCRIPT_MISSING"
  | "TAP_UP_OK"
  | "TAP_DOWN_OK"
  | "TAP_COMMS_PULL_OK"
  | "TAP_COMMS_PULL_FAILED"
  | "TAP_COMMS_PUSH_OK"
  | "TAP_COMMS_PUSH_FAILED"
  | "TAP_COMMS_NOT_REPO"
  | "TAP_READY_OK"
  | "TAP_READY_APPLY_FAILED"
  | "TAP_RECEIVER_OK"
  | "TAP_PROJECTION_OK"
  | "TAP_UPLINK_OK"
  | "TAP_SERVE_NO_SERVER"
  | "TAP_SERVE_BUN_REQUIRED"
  // Review (headless)
  | "TAP_REVIEW_START_OK"
  | "TAP_REVIEW_TERMINATED"
  // Watch / GUI
  | "TAP_WATCH_OK"
  | "TAP_WATCH_RESTARTED"
  | "TAP_WATCH_FAILED"
  | "TAP_BRIDGE_WATCH_OK"
  | "TAP_BRIDGE_WATCH_RESTARTED"
  | "TAP_PORT_IN_USE"
  | "TAP_GUI_ERROR"
  // Internal
  | "TAP_WINDOWS_ROUTE_RECOVER_BLOCKED"
  | "TAP_APP_ROUTE_FRESHNESS_BLOCKED"
  | "TAP_INTERNAL_ERROR";

export interface CommandResult<T = Record<string, unknown>> {
  ok: boolean;
  command: CommandName;
  runtime?: RuntimeName;
  instanceId?: InstanceId;
  code: CommandCode;
  message: string;
  warnings: string[];
  data: T;
}
