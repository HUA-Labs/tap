import { O as ObserveTransport, a as ObserveTransportSnapshot, b as ObserveTransportListener } from './types-FWvKrFUt.mjs';
export { c as ObserveTransportAgent, d as ObserveTransportConversation, e as ObserveTransportEvent, f as ObserveTransportEventKind, T as TransportAddress } from './types-FWvKrFUt.mjs';
import { C as CapabilityScope, a as CodexIpcObserveTransportOptions } from './index-DMToLyGd.mjs';
export { b as CODEX_IPC_DRIVE_METHODS, c as CONSENT_RECEIPTS_DIRNAME, d as CodexIpcBroadcastMessage, e as CodexIpcControlTransportOptions, f as CodexIpcCreateConsentReceiptOptions, g as CodexIpcDraftActionOptions, h as CodexIpcDriveActionOptions, i as CodexIpcDriveActionResult, j as CodexIpcDriveMethod, k as CodexIpcDriveStartTurnOptions, l as CodexIpcMessage, m as CodexIpcRequestMessage, n as CodexIpcResponseMessage, o as CodexIpcSocket, p as CodexIpcStartTurnOptions, q as CodexIpcSuggestionDraft, r as ConsentReceipt, s as ConsentReceiptError, t as ConsumeConsentReceiptOptions, u as CreateConsentReceiptOptions, v as CreatedConsentReceipt, D as DEFAULT_CODEX_IPC_PIPE_PATH, w as DEFAULT_CODEX_IPC_WINDOWS_PIPE_PATH, x as DEFAULT_CONSENT_TTL_SECONDS, E as ExperimentalCodexIpcControlTransport, y as ExperimentalCodexIpcObserveTransport, R as ResolveCodexIpcPathOptions, z as buildFollowerStartTurnParams, A as consumeConsentReceipt, B as createConsentReceipt, F as createExperimentalCodexIpcControlTransport, G as createExperimentalCodexIpcObserveTransport, H as decodeCodexIpcFrames, I as encodeCodexIpcFrame, J as isCodexIpcDefaultSupported, K as resolveCodexIpcPath } from './index-DMToLyGd.mjs';
export { B as BuildCodexBindingRegistryOptions, C as CodexA2AAdapterKind, a as CodexA2ADeliveryRequest, b as CodexA2ADeliveryResult, c as CodexA2AFailureReason, d as CodexA2AMessageEnvelope, e as CodexA2ATargetTuple, f as CodexBinding, g as CodexBindingAddress, h as CodexBindingBlockReason, i as CodexBindingHeartbeat, j as CodexBindingRegistry, k as CodexBindingSource, l as CodexBindingStatus, m as ConsentDriveReceipt, n as ConsentDriveResponse, o as ConsentDriveTransport, p as ConsentDriveTransportFactory, R as RemoteCodexRelayConfig, q as RemoteCodexRelayExecutor, r as RemoteCodexRelayInput, s as RemoteCodexRelayResult, t as ResolveCodexBindingOptions, u as ResolveCodexBindingResult, v as ResolveCodexBindingTarget, T as TapReceiveTransport, w as buildCodexBindingRegistry, x as canUseConsentDriveForAddress, y as inferReceiveTransports, z as normalizeReceiveTransports, A as prefersConsentDrive, D as resolveCodexBinding } from './index-D4Khz2Mh.mjs';

type RuntimeName = "claude" | "codex" | "gemini";
type BridgeMode = "native-push" | "app-server" | "polling";
type Platform = "win32" | "darwin" | "linux";
/** Unique, immutable identifier for a runtime instance. e.g. "codex", "codex-agent-a" */
type InstanceId = string;
interface AdapterContext {
    commsDir: string;
    repoRoot: string;
    stateDir: string;
    platform: Platform;
    /** Instance ID for TAP_AGENT_ID env injection. Set by 'tap add'. */
    instanceId?: string;
    /** Agent name from state. Injected as TAP_AGENT_NAME in MCP config. */
    agentName?: string;
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
interface AppServerAuthState {
    mode: "subprotocol" | "query-token";
    protectedUrl: string;
    upstreamUrl: string;
    tokenPath: string;
    gatewayPid: number | null;
    gatewayLogPath: string | null;
}
interface AppServerState {
    url: string;
    pid: number | null;
    managed: boolean;
    healthy: boolean;
    lastCheckedAt: string;
    lastHealthyAt: string | null;
    logPath: string | null;
    manualCommand: string;
    auth?: AppServerAuthState | null;
}
type PersistedBridgeLifecycleState = "spawning" | "initializing" | "ready" | "degraded-no-thread" | "degraded-no-bridge" | "stopping" | "stopped" | "crashed";
interface BridgeLifecycleRecord {
    state: PersistedBridgeLifecycleState;
    since: string;
    updatedAt: string;
    lastTransitionAt: string;
    lastTransitionReason: string | null;
    restartCount: number;
}
interface BridgeState {
    pid: number;
    statePath: string;
    /**
     * M321 — Seed heartbeat timestamp, set at bridge start.
     * Covers the pre-first-poll gap before runtime heartbeat.json is written.
     * `resolveHeartbeatTimestamp()` prefers runtime heartbeat.json when available.
     * Not actively updated after startup — runtime heartbeat.json is the SSOT.
     */
    lastHeartbeat?: string;
    appServer?: AppServerState | null;
    /** Instance-specific daemon state dir (thread/heartbeat/processed markers). */
    runtimeStateDir?: string | null;
    lifecycle?: BridgeLifecycleRecord | null;
}
/** Runtime instance state. Supports multiple instances per runtime (e.g. codex-agent-a, codex-builder). */
interface InstanceState {
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
    lastVerifiedAt: string | null;
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
type CommandName = "init" | "init-worktree" | "add" | "remove" | "status" | "setup" | "serve" | "bridge" | "up" | "down" | "comms" | "ready" | "receiver" | "headless" | "projection" | "uplink" | "dashboard" | "doctor" | "watch" | "gui" | "remote-panel" | "permissions" | "reviews" | "sessions" | "infra" | "windows-route-recover" | "app-route-freshness" | "comms-doctor" | "flow-doctor" | "unknown";
type CommandCode = "TAP_INIT_OK" | "TAP_ADD_OK" | "TAP_REMOVE_OK" | "TAP_STATUS_OK" | "TAP_STATUS_PROFILE_READY" | "TAP_STATUS_PROFILE_DEGRADED" | "TAP_STATUS_PROFILE_BLOCKED" | "TAP_SETUP_OK" | "TAP_SETUP_APPLY_NOT_IMPLEMENTED" | "TAP_SETUP_APPLY_BLOCKED" | "TAP_DOCTOR_SETUP_OK" | "TAP_DOCTOR_SETUP_APPLY_NOT_IMPLEMENTED" | "TAP_DOCTOR_SETUP_APPLY_BLOCKED" | "TAP_SERVE_OK" | "TAP_PERMISSIONS_RESTORE_OK" | "TAP_REVIEWS_RECOVERY_OK" | "TAP_REVIEWS_REGISTER_OK" | "TAP_SESSIONS_ARCHIVE_OK" | "TAP_INFRA_STATUS_OK" | "TAP_WINDOWS_ROUTE_RECOVER_OK" | "TAP_APP_ROUTE_FRESHNESS_OK" | "TAP_COMMS_DOCTOR_OK" | "TAP_FLOW_DOCTOR_OK" | "TAP_NO_OP" | "TAP_ALREADY_INITIALIZED" | "TAP_INIT_CLONE_FAILED" | "TAP_NOT_INITIALIZED" | "TAP_RUNTIME_UNKNOWN" | "TAP_RUNTIME_NOT_FOUND" | "TAP_CONFIG_INVALID" | "TAP_LOCAL_SERVER_MISSING" | "TAP_INVALID_ARGUMENT" | "TAP_STATUS_PROFILE_REQUIRED" | "TAP_STATUS_UNKNOWN_PROFILE" | "TAP_INSTANCE_NOT_FOUND" | "TAP_INSTANCE_AMBIGUOUS" | "TAP_PORT_CONFLICT" | "TAP_PATCH_FAILED" | "TAP_VERIFY_FAILED" | "TAP_ROLLBACK_FAILED" | "TAP_BRIDGE_START_OK" | "TAP_BRIDGE_START_FAILED" | "TAP_BRIDGE_RESTART_OK" | "TAP_BRIDGE_RESTART_FAILED" | "TAP_BRIDGE_RESTART_EXTERNAL" | "TAP_BRIDGE_RESTART_BLOCKED" | "TAP_BRIDGE_DRAIN_TIMEOUT" | "TAP_BRIDGE_STOP_OK" | "TAP_BRIDGE_STATUS_OK" | "TAP_BRIDGE_NOT_RUNNING" | "TAP_BRIDGE_SCRIPT_MISSING" | "TAP_UP_OK" | "TAP_DOWN_OK" | "TAP_COMMS_PULL_OK" | "TAP_COMMS_PULL_FAILED" | "TAP_COMMS_PUSH_OK" | "TAP_COMMS_PUSH_FAILED" | "TAP_COMMS_NOT_REPO" | "TAP_READY_OK" | "TAP_READY_APPLY_FAILED" | "TAP_RECEIVER_OK" | "TAP_PROJECTION_OK" | "TAP_UPLINK_OK" | "TAP_SERVE_NO_SERVER" | "TAP_SERVE_BUN_REQUIRED" | "TAP_REVIEW_START_OK" | "TAP_REVIEW_TERMINATED" | "TAP_WATCH_OK" | "TAP_WATCH_RESTARTED" | "TAP_WATCH_FAILED" | "TAP_BRIDGE_WATCH_OK" | "TAP_BRIDGE_WATCH_RESTARTED" | "TAP_PORT_IN_USE" | "TAP_GUI_ERROR" | "TAP_WINDOWS_ROUTE_RECOVER_BLOCKED" | "TAP_APP_ROUTE_FRESHNESS_BLOCKED" | "TAP_INTERNAL_ERROR";
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

declare const version: string;

interface GeminiIdeCursor {
    line: number;
    character: number;
}
interface GeminiIdeFile {
    path: string;
    timestamp: number;
    isActive?: boolean;
    cursor?: GeminiIdeCursor;
    selectedText?: string;
}
interface GeminiIdeContext {
    workspaceState?: {
        openFiles?: GeminiIdeFile[];
        isTrusted?: boolean;
    };
}
interface GeminiIdeInfo {
    name: string;
    displayName: string;
}
interface GeminiIdeCompanionServerOptions {
    port?: number;
    host?: string;
    endpointPath?: string;
    authToken?: string;
    enableDiscoveryFile?: boolean;
    discoveryPid?: number;
    workspacePaths?: string[];
    ideInfo?: GeminiIdeInfo;
    logger?: {
        info?: (...args: unknown[]) => void;
        warn?: (...args: unknown[]) => void;
        error?: (...args: unknown[]) => void;
    };
}
interface GeminiIdeCompanionServer {
    readonly port: number;
    readonly host: string;
    readonly url: string;
    readonly endpointPath: string;
    readonly authToken: string;
    readonly discoveryFilePath: string | null;
    sessionIds(): string[];
    sendDiffAccepted(filePath: string, content?: string, sessionId?: string): Promise<string[]>;
    sendDiffRejected(filePath: string, sessionId?: string): Promise<string[]>;
    sendContextUpdate(context: GeminiIdeContext, sessionId?: string): Promise<string[]>;
    close(): Promise<void>;
}
declare function startGeminiIdeCompanionServer(options?: GeminiIdeCompanionServerOptions): Promise<GeminiIdeCompanionServer>;

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
    /** GitHub URL for the comms repository (used by `tap comms pull/push`). */
    commsRepoUrl?: string;
    /** Control tower agent name. Used for auto-notify on new agent join (M111). */
    towerName?: string;
    /**
     * M310: Known agents on remote machines that share this comms dir via git sync.
     * These agents bypass local heartbeat validation in tap_reply routing,
     * allowing cross-machine DM delivery through comms repo sync.
     */
    remoteAgents?: string[];
    /**
     * M320: Optional map of instanceId -> preferred app-server port.
     * When present, `tap add codex` consults this table before falling back to
     * auto-assign. A missing entry, a conflicting state record, or a taken TCP
     * port all downgrade the instance to auto-assign; entries never cause an
     * error.
     *
     * Convention (non-enforced, for multi-instance setups):
     *   4510 codex-agent-a, 4511 codex-agent-b, 4512 codex-agent-c
     *   4520 codex-agent-d
     *   4530 codex-diagnostic-a
     *   451x = active workers, 452x = review/evaluation lanes,
     *   453x = diagnostic/probe lanes
     */
    portMap?: Record<string, number>;
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
    towerName: string | null;
    /** M310: Known agents on remote machines. */
    remoteAgents: string[];
    /** M320: Resolved instanceId -> port preferences (empty object when unset). */
    portMap: Record<string, number>;
}
/** Config resolution source for diagnostics (legacy API — backward compatible). */
type ConfigSource = "cli-flag" | "env" | "local-config" | "shared-config" | "legacy-shell-config" | "auto";
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

declare function normalizeTapPath(input: string, platform?: NodeJS.Platform): string;

/**
 * Bridge observability — heartbeat monitoring, turn stuck detection, log rotation.
 *
 * ## SSOT Hierarchy (M321)
 *
 * - **Process liveness** → `{runtimeStateDir}/heartbeat.json` (SSOT).
 *   Written by bridge-dispatch on each poll cycle. Contains detailed
 *   runtime state: threadId, turnState, connected, etc.
 *
 * - **`state.json` lastHeartbeat** → Legacy fallback only. No longer
 *   actively written. `resolveHeartbeatTimestamp()` prefers runtime
 *   heartbeat and falls back to this for pre-M321 state files.
 *
 * - **Agent presence** → `heartbeats.json` (commsDir). Separate concern,
 *   managed by MCP layer (`tap-plugin`). Not accessed here.
 *
 * Consolidated from bridge-state.ts (heartbeat/turn functions) and
 * bridge-log-rotate.ts into a single observability module.
 *
 * @module engine/bridge-observability
 */

/**
 * Update the heartbeat timestamp for a running bridge.
 * Only the owning process (matching PID) can update the heartbeat.
 *
 * @deprecated M321 — Runtime heartbeat (`{runtimeStateDir}/heartbeat.json`)
 * is the SSOT for process liveness. `state.json lastHeartbeat` is no longer
 * actively updated. This function is kept for backward compatibility but
 * is a no-op. Use runtime heartbeat written by bridge-dispatch instead.
 */
declare function updateBridgeHeartbeat(_stateDir: string, _instanceId: InstanceId): void;
/**
 * Get heartbeat age in seconds. Returns null if no state or no heartbeat.
 */
declare function getHeartbeatAge(stateDir: string, instanceId: InstanceId): number | null;
declare function rotateLog(logPath: string): void;

/**
 * Bridge state management — persistence, process liveness, runtime state readers.
 *
 * Extracted from engine/bridge.ts (Phase 2) to isolate state CRUD and
 * runtime heartbeat/thread readers.
 * Observability helpers (heartbeat age, turn stuck, log rotation) live in
 * bridge-observability.ts.
 *
 * @module engine/bridge-state
 */

interface RuntimeBridgeHeartbeat {
    updatedAt?: string;
    threadId?: string | null;
    threadCwd?: string | null;
    activeTurnId?: string | null;
    turnStartedAt?: string | null;
    lastTurnStatus?: string | null;
    lastTurnAt?: string | null;
    lastDispatchAt?: string | null;
    idleSince?: string | null;
    turnState?: "active" | "idle" | "waiting-approval" | "disconnected" | null;
    lastNotificationMethod?: string | null;
    lastNotificationAt?: string | null;
    lastError?: string | null;
    connected?: boolean;
    initialized?: boolean;
}

type BridgePresence = "bridge-live" | "bridge-stale" | "stopped";
type BridgeLifecycleStatus = "ready" | "initializing" | "degraded-no-thread" | "bridge-stale" | "stopped";
interface BridgeLifecycleSnapshot {
    presence: BridgePresence;
    status: BridgeLifecycleStatus;
    summary: string;
    lastTransitionAt: string | null;
    lastTransitionReason: string | null;
    restartCount: number;
    threadId: string | null;
    threadCwd: string | null;
    savedThreadId: string | null;
    savedThreadCwd: string | null;
    activeTurnId: string | null;
    connected: boolean | null;
    initialized: boolean | null;
    appServerHealthy: boolean | null;
}

type CodexSessionTurnState = "active" | "idle" | "waiting-approval" | "disconnected";
type CodexSessionStatus = "initializing" | "active" | "idle" | "waiting-approval" | "disconnected";
interface CodexSessionSnapshot {
    status: CodexSessionStatus;
    turnState: CodexSessionTurnState | null;
    summary: string;
    activeTurnId: string | null;
    lastTurnAt: string | null;
    lastDispatchAt: string | null;
    idleSince: string | null;
    connected: boolean | null;
    initialized: boolean | null;
}

interface BridgeStartOptions {
    instanceId: InstanceId;
    runtime: RuntimeName;
    stateDir: string;
    commsDir: string;
    bridgeScript: string;
    platform: Platform;
    agentName?: string;
    runtimeCommand?: string;
    appServerUrl?: string;
    repoRoot?: string;
    port?: number;
    /** Headless configuration. Passed as env vars to the bridge process. */
    headless?: HeadlessConfig | null;
    /** Bridge script operational flags (forwarded to codex-app-server-bridge.ts) */
    busyMode?: "steer" | "wait";
    pollSeconds?: number;
    reconnectSeconds?: number;
    messageLookbackMinutes?: number;
    threadId?: string;
    ephemeral?: boolean;
    processExistingMessages?: boolean;
    manageAppServer?: boolean;
    /** Skip auth gateway — app-server listens directly on the public port (localhost only). */
    noAuth?: boolean;
    /** Launch managed Codex app-server without the Codex sandbox. */
    appServerUnsandboxed?: boolean;
    /** Reuse previously managed app-server metadata even after bridge state is cleared. */
    existingAppServer?: AppServerState | null;
    /** Persisted lifecycle from the previous session, used to track restarts. */
    previousLifecycle?: BridgeLifecycleRecord | null;
    /**
     * M392: per-session suffix appended to TAP_INSTANCE_ID for the bridge daemon.
     * When set, bridge writes heartbeats under `${instanceId}-${suffix}` while the
     * MCP server keeps the base id. Defense in depth alongside M354 1순위
     * (ownership pruning) — different bucket, complementary defense.
     */
    instanceIdSuffix?: string;
    /**
     * M392: explicit routing slot to inject as TAP_ROUTING_SLOT. Set when the
     * suffix decouples TAP_INSTANCE_ID from the slot regex in the bridge runner.
     */
    routingSlot?: string;
}

interface RestartBridgeOptions extends BridgeStartOptions {
    /** Max seconds to wait for active turn to complete before killing. Default: 30 */
    drainTimeoutSeconds?: number;
    /** Continue restart after drain timeout instead of aborting. */
    force?: boolean;
    /** Optional observer for user-facing drain wait logs. */
    onDrainWait?: (state: BridgeDrainWaitState) => void;
}
interface BridgeDrainWaitState {
    activeTurnId: string | null;
    turnState: RuntimeBridgeHeartbeat["turnState"] | null;
    waitedMs: number;
}
interface RestartBridgeResult {
    bridge: BridgeState;
    drained: boolean;
    forced: boolean;
}
/**
 * Graceful bridge restart: wait for active turn -> cleanup -> stop -> start.
 * Prevents message loss during restart by draining active work first
 * and replaying unprocessed messages on the new instance.
 */
declare function restartBridge(options: RestartBridgeOptions): Promise<RestartBridgeResult>;

/**
 * Dashboard data collection engine.
 * Aggregates: agents (comms presence), bridges (state + PID), PRs (gh CLI).
 *
 * Ref: tap public repo tap-ops-dashboard.ps1 (single-agent view)
 * M74 extends to control-tower view (all agents, all bridges, all PRs).
 */

interface AgentInfo {
    name: string;
    instanceId: string | null;
    presence: "bridge-live" | "bridge-stale" | "mcp-only";
    lifecycle: BridgeLifecycleSnapshot["status"] | null;
    status: string | null;
    lastActivity: string | null;
    joinedAt: string | null;
    idleSeconds: number | null;
    address: {
        hostId: string | null;
        clientId: string | null;
        conversationId: string | null;
        ownerClientId: string | null;
        routingAddress: string;
        slot: "tower" | "reviewer" | `wt-${number}` | null;
        aliases: string[];
    };
}
interface BridgeInfo {
    instanceId: string;
    runtime: string;
    status: "running" | "stopped" | "stale";
    lifecycle: BridgeLifecycleSnapshot | null;
    session: CodexSessionSnapshot | null;
    pid: number | null;
    port: number | null;
    heartbeatAge: number | null;
    headless: boolean;
}
interface PRInfo {
    number: number;
    title: string;
    author: string;
    state: string;
    url: string;
}
interface DashboardWarning {
    level: "warn" | "error";
    message: string;
}
interface DashboardSnapshot {
    generatedAt: string;
    repoRoot: string;
    commsDir: string;
    agents: AgentInfo[];
    bridges: BridgeInfo[];
    prs: PRInfo[];
    warnings: DashboardWarning[];
}
declare function collectDashboardSnapshot(repoRoot?: string, commsDirOverride?: string): DashboardSnapshot;

declare const TRUSTED_DEVICE_LEASES_DIRNAME = "devices";
type TrustedDeviceLeaseFailureReason = "registry-unavailable" | "missing" | "invalid" | "not-yet-valid" | "expired" | "revoked" | "scope-not-allowed" | "target-not-allowed";
interface TrustedDeviceLease {
    deviceId: string;
    hostId: string;
    label: string | null;
    publicKeyHash: string | null;
    tokenHash: string | null;
    operator: string | null;
    allowedScopes: CapabilityScope[];
    allowedTargets: string[];
    issuedAt: string;
    expiresAt: string;
    lastSeenAt: string | null;
    revokedAt: string | null;
}
interface TrustedDeviceLeaseCheck {
    ok: boolean;
    reason: TrustedDeviceLeaseFailureReason | null;
    message: string | null;
    lease: TrustedDeviceLease | null;
    filePath: string | null;
}
interface TrustedDeviceLeaseGateResult {
    ok: boolean;
    reason: TrustedDeviceLeaseFailureReason | null;
    message: string | null;
    requester: TrustedDeviceLeaseCheck | null;
    target: TrustedDeviceLeaseCheck | null;
}
interface CheckTrustedDeviceLeaseOptions {
    commsDir?: string | null;
    devicesDir?: string | null;
    deviceId?: string | null;
    hostId?: string | null;
    scope?: CapabilityScope;
    target?: string | null;
    now?: Date | string | number;
}
interface CheckTrustedDeviceLeaseGateOptions {
    commsDir?: string | null;
    devicesDir?: string | null;
    requesterDeviceId?: string | null;
    requesterHostId?: string | null;
    targetDeviceId?: string | null;
    targetHostId?: string | null;
    scope?: CapabilityScope;
    target?: string | null;
    now?: Date | string | number;
}
declare function resolveTrustedDeviceLeasesDir(options: {
    commsDir?: string | null;
    devicesDir?: string | null;
}): string | null;
declare function parseTrustedDeviceLease(value: unknown): TrustedDeviceLease | null;
declare function loadTrustedDeviceLease(filePath: string): TrustedDeviceLease | null;
declare function checkTrustedDeviceLease(options: CheckTrustedDeviceLeaseOptions): TrustedDeviceLeaseCheck;
declare function checkTrustedDeviceLeaseGate(options: CheckTrustedDeviceLeaseGateOptions): TrustedDeviceLeaseGateResult;

interface FileObserveTransportOptions {
    commsDir: string;
    hostId?: string | null;
    watchIntervalMs?: number;
}
declare class FileObserveTransport implements ObserveTransport {
    readonly kind = "file-observe";
    private readonly heartbeatsPath;
    private readonly hostId;
    private readonly watchIntervalMs;
    private readonly listeners;
    private watching;
    private snapshot;
    constructor(options: FileObserveTransportOptions);
    connect(): Promise<ObserveTransportSnapshot>;
    disconnect(): Promise<void>;
    getSnapshot(): ObserveTransportSnapshot;
    subscribe(listener: ObserveTransportListener): () => void;
    private readonly handleHeartbeatsChanged;
    private buildSnapshot;
    private startWatching;
    private stopWatching;
    private loadHeartbeats;
    private emit;
}
declare function createFileObserveTransport(options: FileObserveTransportOptions): ObserveTransport;

interface TapReturnAddress {
    routingAddress?: string | null;
    hostId?: string | null;
    clientId?: string | null;
    conversationId?: string | null;
    ownerClientId?: string | null;
    surfaceInstanceId?: string | null;
    aliases?: string[];
}
interface TapMessagePromptOptions {
    agentName: string;
    sender: string;
    recipient: string;
    subject: string;
    fileName: string;
    body: string;
    replyTo: string;
    returnAddress?: TapReturnAddress | null;
    runtimeSurface?: string | null;
    debugEnvelope?: boolean;
}
interface TapMessageViewModel {
    agentName: string;
    sender: string;
    recipient: string;
    subject: string;
    body: string;
    replyTarget: string | null;
    returnRoute: string | null;
    missingRoute: boolean;
    debugEnvelope: {
        fileName: string;
        returnAddress: TapReturnAddress | null;
        runtimeSurface: string | null;
    };
}
interface RenderTapMessagePromptOptions {
    debugEnvelope?: boolean;
}
declare function createTapMessageViewModel(options: TapMessagePromptOptions): TapMessageViewModel;
declare function renderAgentMessagePrompt(viewModel: TapMessageViewModel, options?: RenderTapMessagePromptOptions): string;
declare function buildTapMessagePrompt(options: TapMessagePromptOptions): string;

type PollingReceiverMode = "check" | "apply" | "watch";
type PollingReceiverSource = "inbox";
interface PollingReceiverItem {
    source: PollingReceiverSource;
    filename: string;
    path: string;
    from: string;
    fromName?: string | null;
    fromAddress?: TapReturnAddress | null;
    to: string;
    toName?: string | null;
    toAddress?: TapReturnAddress | null;
    subject: string;
    mtime: string;
    dedupeKey: string;
    messageId: string | null;
    content?: string;
}
interface PollingReceiverStateEntry {
    filename: string;
    messageId: string | null;
    mtime: string;
    processedAt: string;
}
interface PollingReceiverState {
    schemaVersion: 1;
    agent: string;
    aliases: string[];
    createdAt: string;
    joinedAt: string;
    processed: Record<string, PollingReceiverStateEntry>;
}
interface RunPollingReceiverOptions {
    mode: PollingReceiverMode;
    commsDir: string;
    stateDir: string;
    agent: string;
    aliases?: string[];
    includeContent?: boolean;
    includeOwn?: boolean;
    limit?: number;
    since?: string;
    sinceMinutes?: number;
    all?: boolean;
    resetCursor?: boolean;
    stateName?: string;
    intervalMs?: number;
    maxIterations?: number;
    now?: Date;
    excludeDedupeKeys?: Iterable<string>;
    debugEnvelope?: boolean;
}
interface RunPollingReceiverResult {
    mode: PollingReceiverMode;
    agent: string;
    aliases: string[];
    commsDir: string;
    statePath: string;
    receiveTransport: "polling";
    adapter: "file-polling";
    status: "idle" | "pending";
    items: PollingReceiverItem[];
    promptBundle: string;
    scanned: number;
    skipped: {
        old: number;
        duplicate: number;
        notForAgent: number;
        own: number;
        staleMeta: number;
    };
    stateWritten: boolean;
    effectiveSince: string | null;
    warnings: string[];
}
interface MarkPollingReceiverItemsProcessedOptions {
    stateDir: string;
    agent: string;
    aliases?: string[];
    stateName?: string;
    items: PollingReceiverItem[];
    now?: Date;
}
declare function resolvePollingReceiverStatePath(options: {
    stateDir: string;
    agent: string;
    stateName?: string;
}): string;
declare function markPollingReceiverItemsProcessed(rawOptions: MarkPollingReceiverItemsProcessedOptions): {
    statePath: string;
    stateWritten: boolean;
    processedAt: string;
};
declare function buildPromptBundle(agent: string, items: PollingReceiverItem[], options?: {
    debugEnvelope?: boolean;
}): string;
declare function runPollingReceiver(rawOptions: RunPollingReceiverOptions): Promise<RunPollingReceiverResult>;

interface ProjectedEnvelopeBackfillInput {
    commsDir: string;
    sender: string;
    recipient: string;
    subject: string;
    body?: string | null;
    sourceSurface: string;
    receivedAt?: Date | string | null;
    messageId?: string | null;
    projectionId?: string | null;
    routeTurnId?: string | null;
}
interface ProjectedEnvelopeBackfillResult {
    status: "written" | "exists";
    inboxPath: string;
    filePath: string;
    dedupeKey: string;
    messageId: string;
}
declare function writeProjectedEnvelopeBackfill(input: ProjectedEnvelopeBackfillInput): ProjectedEnvelopeBackfillResult;

type CodexEndpointProfileRole = "public" | "direct-local" | "upstream" | "remote-tui";
type CodexEndpointProfileMode = "auth-gateway" | "direct-no-auth-localhost-only" | "upstream-internal" | "ssh-forwarded-client";
type CodexEndpointProfileStability = "target" | "compatibility" | "custom";
interface CodexEndpointProfile {
    id: string;
    role: CodexEndpointProfileRole;
    defaultUrl: string;
    mode: CodexEndpointProfileMode;
    operatorVisible: boolean;
    stability: CodexEndpointProfileStability;
    namespace: string;
    description: string;
}
interface ParsedCodexEndpointUrl {
    raw: string;
    protocol: "ws:" | "wss:";
    hostname: string;
    port: number;
    loopback: boolean;
}
interface CodexEndpointClassification {
    profile: CodexEndpointProfile | null;
    endpoint: ParsedCodexEndpointUrl | null;
    reason: string;
}
interface ResolveCodexEndpointProfileOptions {
    profileId?: string;
    requestedUrl?: string | null;
    config?: Record<string, unknown>;
    env?: Record<string, string | undefined>;
}
type ResolvedCodexEndpointProfile = CodexEndpointProfile & {
    profileId: string;
    requestedProfileId: string;
    resolvedUrl: string | null;
    source: "explicit" | "env" | "config" | "default" | "missing";
    valid: boolean;
    classification: string;
    classifiedProfileId?: string | null;
};
declare const CODEX_ENDPOINT_PROFILE_ALIASES: Record<string, string>;
declare const CODEX_APP_SERVER_ENDPOINT_PROFILES: CodexEndpointProfile[];
declare function normalizeCodexEndpointProfileId(profileId: string | null | undefined): string | null;
declare function listCodexEndpointProfiles(): CodexEndpointProfile[];
declare function getCodexEndpointProfile(profileId: string | null | undefined): CodexEndpointProfile | null;
declare function parseCodexEndpointUrl(url: string | null | undefined): ParsedCodexEndpointUrl | null;
declare function classifyCodexEndpointUrl(url: string | null | undefined): CodexEndpointClassification;
declare function resolveCodexEndpointProfile(options?: ResolveCodexEndpointProfileOptions): ResolvedCodexEndpointProfile;

interface CodexAppServerPromotionRequest {
    appServerUrl: string;
    cwd: string;
    threadId?: string | null;
    text: string;
}
interface CodexAppServerPromotionDelivery {
    delivered: boolean;
    turnId: string | null;
    threadId: string | null;
    runtimeHealth: "idle" | "active-turn" | "stuck-turn" | "unhealthy" | "adapter-unavailable";
    blockedReason: string | null;
}
interface CodexAppServerPromoter {
    promote(request: CodexAppServerPromotionRequest): Promise<CodexAppServerPromotionDelivery>;
}
interface RunCodexCliAppServerPromotionOptions extends Omit<RunPollingReceiverOptions, "mode" | "limit"> {
    limit?: number;
    appServerUrl?: string | null;
    endpointProfile?: string;
    endpointConfig?: Record<string, unknown>;
    cwd?: string;
    threadId?: string | null;
    dryRun?: boolean;
    promoter?: CodexAppServerPromoter;
}
interface CodexCliAppServerPromotionResult {
    mode: "promote";
    agent: string;
    aliases: string[];
    commsDir: string;
    statePath: string;
    receiveTransport: "polling";
    adapter: "app-server-promotion";
    runtimeSurface: "codex-cli-app-server";
    endpointProfile: ResolvedCodexEndpointProfile;
    appServerUrl: string | null;
    cwd: string;
    threadId: string | null;
    status: "idle" | "dry-run" | "delivered" | "blocked";
    delivered: boolean;
    queued: boolean;
    queueReason: string | null;
    steerAttempted: boolean;
    turnId: string | null;
    blockedReason: string | null;
    runtimeHealth: CodexAppServerPromotionDelivery["runtimeHealth"] | null;
    item: PollingReceiverItem | null;
    promptText: string | null;
    scanned: number;
    skipped: {
        old: number;
        duplicate: number;
        notForAgent: number;
        own: number;
    };
    stateWritten: boolean;
    effectiveSince: string | null;
    warnings: string[];
}
declare class WebSocketCodexAppServerPromoter implements CodexAppServerPromoter {
    private socket;
    private nextId;
    private readonly pending;
    promote(request: CodexAppServerPromotionRequest): Promise<CodexAppServerPromotionDelivery>;
    private connect;
    private disconnect;
    private attachThread;
    private startTurn;
    private request;
    private handleMessage;
    private rejectPending;
}
declare function runCodexCliAppServerPromotion(options: RunCodexCliAppServerPromotionOptions): Promise<CodexCliAppServerPromotionResult>;

type SupervisedReceiverPromotionMode = "once" | "watch";
interface RunSupervisedReceiverPromotionOptions extends Omit<RunCodexCliAppServerPromotionOptions, "limit"> {
    mode: SupervisedReceiverPromotionMode;
    maxPromotionsPerIteration?: number;
    intervalMs?: number;
    maxIterations?: number;
    promoter?: CodexAppServerPromoter;
}
interface SupervisedReceiverPromotionResult {
    mode: SupervisedReceiverPromotionMode;
    agent: string;
    aliases: string[];
    commsDir: string;
    statePath: string | null;
    receiveTransport: "polling";
    adapter: "supervised-app-server-promotion";
    runtimeSurface: "codex-cli-app-server";
    status: "idle" | "delivered" | "blocked" | "dry-run";
    delivered: number;
    blocked: number;
    queued: number;
    dryRun: boolean;
    iterations: number;
    attempts: CodexCliAppServerPromotionResult[];
    lastBlockedReason: string | null;
    lastQueueReason: string | null;
    warnings: string[];
}
declare function runSupervisedReceiverPromotion(options: RunSupervisedReceiverPromotionOptions): Promise<SupervisedReceiverPromotionResult>;

type ProjectionMode = "check" | "apply" | "watch";
type ProjectionDir = "inbox" | "reviews" | "findings" | "receipts" | "decisions";
interface ProjectionItem {
    dir: ProjectionDir;
    filename: string;
    sourcePath: string;
    targetPath: string;
    relativePath: string;
    mtime: string;
    dedupeKey: string;
    messageId: string | null;
    from: string | null;
    to: string | null;
    subject: string | null;
    projected: boolean;
    skipReason: null | "target-exists" | "dry-run";
}
interface ProjectionStateEntry {
    relativePath: string;
    messageId: string | null;
    mtime: string;
    projectedAt: string;
}
interface ProjectionState {
    schemaVersion: 1;
    agent: string;
    aliases: string[];
    sourceCommsDir: string;
    targetCommsDir: string;
    createdAt: string;
    joinedAt: string;
    projected: Record<string, ProjectionStateEntry>;
}
interface RunLocalProjectionOptions {
    mode: ProjectionMode;
    sourceCommsDir: string;
    targetCommsDir: string;
    targetCommsDirLabel?: string;
    stateDir: string;
    agent: string;
    aliases?: string[];
    dirs?: ProjectionDir[];
    since?: string;
    sinceMinutes?: number;
    all?: boolean;
    resetCursor?: boolean;
    stateName?: string;
    includeOwn?: boolean;
    includeAllTargets?: boolean;
    limit?: number;
    intervalMs?: number;
    maxIterations?: number;
    now?: Date;
    beforeScan?: () => void | Promise<void>;
    afterApply?: (items: ProjectionItem[]) => void | Promise<void>;
}
interface RunLocalProjectionResult {
    mode: ProjectionMode;
    agent: string;
    aliases: string[];
    sourceCommsDir: string;
    targetCommsDir: string;
    statePath: string;
    adapter: "local-projection";
    receiveTransport: "polling";
    status: "idle" | "pending" | "projected";
    dirs: ProjectionDir[];
    items: ProjectionItem[];
    scanned: number;
    skipped: {
        old: number;
        duplicate: number;
        notForAgent: number;
        own: number;
        disallowed: number;
    };
    stateWritten: boolean;
    effectiveSince: string | null;
    warnings: string[];
}
declare function resolveLocalProjectionStatePath(options: {
    stateDir: string;
    agent: string;
    stateName?: string;
}): string;
declare function runLocalProjection(rawOptions: RunLocalProjectionOptions): Promise<RunLocalProjectionResult>;

type UplinkMode = "check" | "apply" | "watch";
type UplinkDir = "inbox" | "reviews" | "findings" | "receipts" | "decisions";
interface UplinkItem {
    dir: UplinkDir;
    filename: string;
    sourcePath: string;
    targetPath: string;
    relativePath: string;
    mtime: string;
    dedupeKey: string;
    messageId: string | null;
    from: string | null;
    fromName: string | null;
    to: string | null;
    subject: string | null;
    uploaded: boolean;
    skipReason: null | "dry-run" | "target-exists" | "collision";
}
interface UplinkStateEntry {
    relativePath: string;
    messageId: string | null;
    mtime: string;
    uploadedAt: string;
}
interface UplinkState {
    schemaVersion: 1;
    agent: string;
    aliases: string[];
    sourceCommsDir: string;
    targetCommsDir: string;
    createdAt: string;
    joinedAt: string;
    uploaded: Record<string, UplinkStateEntry>;
}
interface RunLocalUplinkOptions {
    mode: UplinkMode;
    sourceCommsDir: string;
    targetCommsDir: string;
    sourceCommsDirLabel?: string;
    stateDir: string;
    agent: string;
    aliases?: string[];
    dirs?: UplinkDir[];
    since?: string;
    sinceMinutes?: number;
    all?: boolean;
    resetCursor?: boolean;
    stateName?: string;
    includeAllSources?: boolean;
    limit?: number;
    intervalMs?: number;
    maxIterations?: number;
    now?: Date;
    beforeScan?: () => void | Promise<void>;
}
interface RunLocalUplinkResult {
    mode: UplinkMode;
    agent: string;
    aliases: string[];
    sourceCommsDir: string;
    targetCommsDir: string;
    statePath: string;
    adapter: "local-uplink";
    receiveTransport: "polling";
    status: "idle" | "pending" | "uploaded" | "blocked";
    dirs: UplinkDir[];
    items: UplinkItem[];
    scanned: number;
    skipped: {
        old: number;
        duplicate: number;
        notFromAgent: number;
        disallowed: number;
    };
    stateWritten: boolean;
    effectiveSince: string | null;
    warnings: string[];
}
declare function resolveLocalUplinkStatePath(options: {
    stateDir: string;
    agent: string;
    stateName?: string;
}): string;
declare function runLocalUplink(rawOptions: RunLocalUplinkOptions): Promise<RunLocalUplinkResult>;

interface RemoteUplinkCommandResult {
    status: number;
    stdout: string;
    stderr: string;
}
type RemoteUplinkCommandRunner = (command: string, args: string[]) => RemoteUplinkCommandResult;
interface RemoteUplinkMirrorRecord {
    dir: UplinkDir;
    source: string;
    target: string;
    status: number;
    changed: number;
    stdout: string;
    stderr: string;
}
interface MirrorRemoteUplinkSourceOptions {
    sshTarget: string;
    remoteCommsDir: string;
    localMirrorDir: string;
    dirs: UplinkDir[];
    runner?: RemoteUplinkCommandRunner;
}
declare function mirrorRemoteUplinkSource(options: MirrorRemoteUplinkSourceOptions): RemoteUplinkMirrorRecord[];

type CodexOwnerDiscoveryResult = {
    status: "found";
    conversationId: string;
    ownerClientId: string;
    hostId: string | null;
    source: "snapshot" | "event";
} | {
    status: "not-found";
    conversationId: string;
    message: string;
} | {
    status: "unavailable";
    conversationId: string;
    message: string;
};
interface DiscoverCodexOwnerClientIdOptions {
    conversationId: string;
    hostId?: string | null;
    timeoutMs?: number;
    transport?: ObserveTransport;
    transportFactory?: (options: CodexIpcObserveTransportOptions) => ObserveTransport;
}
declare function discoverCodexOwnerClientId(options: DiscoverCodexOwnerClientIdOptions): Promise<CodexOwnerDiscoveryResult>;

/**
 * State/Control API — programmatic access to tap state.
 * GUI and autopilot consume these functions instead of shelling out to CLI.
 *
 * M105 P1: getDashboardSnapshot, streamEvents (read-only)
 * M105 P2: startAgents, stopAgents (write — wraps tap up/down)
 */

interface StateApiOptions {
    repoRoot?: string;
    commsDir?: string;
}
/**
 * Get a point-in-time snapshot of all tap state:
 * agents, bridges, PRs, and warnings.
 *
 * This is the read-only entry point for GUI dashboards and autopilot.
 */
declare function getDashboardSnapshot(options?: StateApiOptions): DashboardSnapshot;
interface EventStreamOptions extends StateApiOptions {
    /** Poll interval in milliseconds (default: 2000) */
    intervalMs?: number;
    /** AbortSignal to stop the stream */
    signal?: AbortSignal;
}
/**
 * Async generator that yields dashboard snapshots at regular intervals.
 * Useful for SSE or WebSocket push to GUI clients.
 *
 * Stops when the AbortSignal fires or the consumer breaks out.
 */
declare function streamEvents(options?: EventStreamOptions): AsyncGenerator<DashboardSnapshot>;
interface AgentControlOptions {
    /** Extra CLI args forwarded to `tap up` (e.g. `["--no-auth"]`) */
    args?: string[];
}
interface AgentControlResult {
    ok: boolean;
    message: string;
    snapshot: DashboardSnapshot;
    commandResult: CommandResult;
}
/**
 * Start all registered bridge daemons.
 * Equivalent to `tap up [...args]`.
 *
 * Always operates on the cwd-based repo (same as CLI commands).
 * Use read-only APIs (getDashboardSnapshot) for cross-repo queries.
 */
declare function startAgents(options?: AgentControlOptions): Promise<AgentControlResult>;
/**
 * Stop all running bridge daemons.
 * Equivalent to `tap down`.
 *
 * Always operates on the cwd-based repo (same as CLI commands).
 */
declare function stopAgents(): Promise<AgentControlResult>;
interface HealthReport {
    ok: boolean;
    timestamp: string;
    bridges: DashboardSnapshot["bridges"];
    agents: DashboardSnapshot["agents"];
    warnings: DashboardSnapshot["warnings"];
    headless: Record<string, unknown>[];
}
/**
 * Health check that combines dashboard snapshot with headless state.
 * Consumed by monitoring tools (Uptime Kuma, cron, autopilot).
 */
declare function getHealthReport(options?: StateApiOptions): HealthReport;
/**
 * Resolve tap configuration for API consumers.
 * Returns paths and settings without requiring CLI args.
 */
declare function getConfig(options?: StateApiOptions): {
    repoRoot: string;
    commsDir: string;
    stateDir: string;
    appServerUrl: string;
};

/**
 * Minimal HTTP transport for tap State API.
 * localhost-only, no external dependencies (uses node:http).
 *
 * Endpoints:
 *   GET /api/snapshot    — DashboardSnapshot JSON
 *   GET /api/events      — SSE stream of snapshots
 *   GET /api/config      — Resolved tap configuration
 *   GET /health          — Health check
 */

interface HttpServerOptions extends StateApiOptions {
    /** Port to listen on (default: 4580) */
    port?: number;
    /** Pre-set API token (default: auto-generated) */
    token?: string;
}
/**
 * Start a localhost-only HTTP server for the tap State API.
 * Resolves after the server is listening. Rejects on bind failure (e.g. EADDRINUSE).
 */
declare function startHttpServer(options?: HttpServerOptions): Promise<{
    port: number;
    token: string;
    close: () => Promise<void>;
}>;

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

export { type AdapterContext, type AgentControlOptions, type AgentControlResult, type AgentInfo, type AppServerAuthState, type AppServerState, type ApplyResult, type ArtifactKind, type BridgeInfo, type BridgeMode, type BridgeState, CODEX_APP_SERVER_ENDPOINT_PROFILES, CODEX_ENDPOINT_PROFILE_ALIASES, CapabilityScope, type CheckTrustedDeviceLeaseGateOptions, type CheckTrustedDeviceLeaseOptions, type CodexAppServerPromoter, type CodexAppServerPromotionDelivery, type CodexAppServerPromotionRequest, type CodexCliAppServerPromotionResult, type CodexEndpointClassification, type CodexEndpointProfile, CodexIpcObserveTransportOptions, type CodexOwnerDiscoveryResult, type CommandCode, type CommandName, type CommandResult, type ConfigOverrides, type ConfigResolution, type ConfigSource, type DashboardSnapshot, type DashboardWarning, type DiscoverCodexOwnerClientIdOptions, type EventStreamOptions, FileObserveTransport, type FileObserveTransportOptions, type GeminiIdeCompanionServer, type GeminiIdeCompanionServerOptions, type GeminiIdeContext, type GeminiIdeCursor, type GeminiIdeFile, type GeminiIdeInfo, type HealthReport, type HttpServerOptions, type InstanceId, type InstanceState, LOCAL_CONFIG_FILE, type MarkPollingReceiverItemsProcessedOptions, type MirrorRemoteUplinkSourceOptions, ObserveTransport, ObserveTransportListener, ObserveTransportSnapshot, type OwnedArtifact, type PRInfo, type ParsedCodexEndpointUrl, type PatchOp, type PatchOpType, type PatchPlan, type Platform, type PollingReceiverItem, type PollingReceiverMode, type PollingReceiverState, type ProbeResult, type ProjectedEnvelopeBackfillInput, type ProjectedEnvelopeBackfillResult, type ProjectionDir, type ProjectionItem, type ProjectionMode, type ProjectionState, type ProjectionStateEntry, type RemoteUplinkCommandResult, type RemoteUplinkCommandRunner, type RemoteUplinkMirrorRecord, type RenderTapMessagePromptOptions, type ResolveCodexEndpointProfileOptions, type ResolvedCodexEndpointProfile, type ResolvedRuntime, type RunCodexCliAppServerPromotionOptions, type RunLocalProjectionOptions, type RunLocalProjectionResult, type RunLocalUplinkOptions, type RunLocalUplinkResult, type RunPollingReceiverOptions, type RunPollingReceiverResult, type RunSupervisedReceiverPromotionOptions, type RuntimeAdapter, type RuntimeName, type RuntimeSource, type RuntimeState, SHARED_CONFIG_FILE, type StateApiOptions, type SupervisedReceiverPromotionMode, type SupervisedReceiverPromotionResult, TRUSTED_DEVICE_LEASES_DIRNAME, type TapLocalConfig, type TapMessagePromptOptions, type TapMessageViewModel, type TapResolvedConfig, type TapReturnAddress, type TapSharedConfig, type TapState, type TapStateV1, type TrustedDeviceLease, type TrustedDeviceLeaseCheck, type TrustedDeviceLeaseFailureReason, type TrustedDeviceLeaseGateResult, type UplinkDir, type UplinkItem, type UplinkMode, type UplinkState, type UplinkStateEntry, type VerifyCheck, type VerifyResult, WebSocketCodexAppServerPromoter, buildPromptBundle, buildRuntimeEnv, buildTapMessagePrompt, checkTrustedDeviceLease, checkTrustedDeviceLeaseGate, classifyCodexEndpointUrl, collectDashboardSnapshot, createFileObserveTransport, createInitialState, createTapMessageViewModel, discoverCodexOwnerClientId, getCodexEndpointProfile, getConfig, getDashboardSnapshot, getFnmBinDir, getHealthReport, getHeartbeatAge, listCodexEndpointProfiles, loadLocalConfig, loadSharedConfig, loadState, loadTrustedDeviceLease, markPollingReceiverItemsProcessed, mirrorRemoteUplinkSource, normalizeCodexEndpointProfileId, normalizeTapPath, parseCodexEndpointUrl, parseTrustedDeviceLease, probeFnmNode, readNodeVersion, renderAgentMessagePrompt, resolveCodexEndpointProfile, resolveConfig, resolveLocalProjectionStatePath, resolveLocalUplinkStatePath, resolveNodeRuntime, resolvePollingReceiverStatePath, resolveTrustedDeviceLeasesDir, restartBridge, rotateLog, runCodexCliAppServerPromotion, runLocalProjection, runLocalUplink, runPollingReceiver, runSupervisedReceiverPromotion, saveLocalConfig, saveSharedConfig, saveState, startAgents, startGeminiIdeCompanionServer, startHttpServer, stateExists, stopAgents, streamEvents, updateBridgeHeartbeat, version, writeProjectedEnvelopeBackfill };
