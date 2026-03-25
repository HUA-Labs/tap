// ─── Runtime Types ──────────────────────────────────────────────

export type RuntimeName = "claude" | "codex" | "gemini";
export type BridgeMode = "native-push" | "app-server" | "polling";
export type Platform = "win32" | "darwin" | "linux";

// ─── Instance ID ───────────────────────────────────────────────

/** Unique, immutable identifier for a runtime instance. e.g. "codex", "codex-reviewer" */
export type InstanceId = string;

// ─── Adapter Context ────────────────────────────────────────────

export interface AdapterContext {
  commsDir: string;
  repoRoot: string;
  stateDir: string; // .tap-comms/
  platform: Platform;
  /** Instance ID for TAP_AGENT_ID env injection. Set by 'tap add'. */
  instanceId?: string;
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
  selector: string; // e.g. "mcpServers.tap-comms" or "mcp_servers.tap-comms"
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
  mode: "query-token";
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

export interface BridgeState {
  pid: number;
  statePath: string;
  lastHeartbeat: string; // ISO
  appServer?: AppServerState | null;
  /** Instance-specific daemon state dir (thread/heartbeat/processed markers). */
  runtimeStateDir?: string | null;
}

/** Runtime instance state. Supports multiple instances per runtime (e.g. codex-reviewer, codex-builder). */
export interface InstanceState {
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
  lastVerifiedAt: string | null; // ISO
  bridge: BridgeState | null;
  /** Headless mode configuration. null = interactive (default). */
  headless: HeadlessConfig | null;
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
  | "serve"
  | "bridge"
  | "up"
  | "down"
  | "comms"
  | "dashboard"
  | "doctor"
  | "unknown";

export type CommandCode =
  // Success
  | "TAP_INIT_OK"
  | "TAP_ADD_OK"
  | "TAP_REMOVE_OK"
  | "TAP_STATUS_OK"
  | "TAP_SERVE_OK"
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
  | "TAP_SERVE_NO_SERVER"
  | "TAP_SERVE_BUN_REQUIRED"
  // Review (headless)
  | "TAP_REVIEW_START_OK"
  | "TAP_REVIEW_TERMINATED"
  // Internal
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
