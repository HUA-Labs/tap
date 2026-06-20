type BusyMode = "wait" | "steer";
type LogLevel = "debug" | "info" | "warn" | "error";
type CandidateScope = "observe" | "suggest" | "drive";
type DispatchMode = "start" | "steer" | "drive" | "blocked" | "rejected";
interface Options {
    repoRoot: string;
    commsDir: string;
    agentId: string;
    agentName: string;
    stateDir: string;
    pollSeconds: number;
    reconnectSeconds: number;
    messageLookbackMinutes: number;
    processExistingMessages: boolean;
    dryRun: boolean;
    runOnce: boolean;
    waitAfterDispatchSeconds: number;
    appServerUrl: string;
    connectAppServerUrl: string;
    gatewayToken: string | null;
    gatewayTokenFile: string | null;
    busyMode: BusyMode;
    logLevel: LogLevel;
    threadId: string | null;
    ephemeral: boolean;
    /**
     * M392: explicit routing slot derived from the base instance id by the
     * bridge launcher and forwarded via `TAP_ROUTING_SLOT`. When set, takes
     * precedence over `resolveBridgeRoutingSlot(agentId)` in
     * `buildBridgeAddress` so suffixed agent ids (`codex-wt1-abc123`) still
     * advertise the correct slot in heartbeats / presence.
     */
    routingSlot: BridgeRoutingSlot | null;
}
interface InboxRoute {
    sender: string;
    recipient: string;
    subject: string;
    messageId?: string | null;
    fromAddress?: HeartbeatAddressRecord | null;
    toAddress?: HeartbeatAddressRecord | null;
    scope?: CandidateScope | null;
    action?: string | null;
    consentRef?: string | null;
    validationError?: string | null;
}
interface Candidate {
    markerId: string;
    filePath: string;
    fileName: string;
    sender: string;
    recipient: string;
    subject: string;
    body: string;
    mtimeMs: number;
    messageId?: string | null;
    fromAddress?: HeartbeatAddressRecord | null;
    toAddress?: HeartbeatAddressRecord | null;
    scope?: CandidateScope | null;
    action?: string | null;
    consentRef?: string | null;
}
interface ThreadStateRecord {
    threadId: string;
    updatedAt: string;
    appServerUrl: string;
    ephemeral: boolean;
    cwd?: string | null;
}
interface HeartbeatRecord {
    pid: number;
    agent: string;
    updatedAt: string;
    pollSeconds: number;
    appServerUrl: string;
    authenticated: boolean;
    connected: boolean;
    initialized: boolean;
    threadId: string | null;
    threadCwd?: string | null;
    activeTurnId: string | null;
    turnStartedAt: string | null;
    lastTurnStatus: string | null;
    lastTurnAt?: string | null;
    lastDispatchAt?: string | null;
    idleSince?: string | null;
    turnState?: "active" | "idle" | "waiting-approval" | "disconnected";
    lastNotificationMethod: string | null;
    lastNotificationAt: string | null;
    lastError: string | null;
    lastSuccessfulAppServerAt: string | null;
    lastSuccessfulAppServerMethod: string | null;
    consecutiveFailureCount: number;
    busyMode: BusyMode;
}
type BridgeRoutingSlot = "tower" | "reviewer" | `wt-${number}`;
interface HeartbeatAddressRecord {
    hostId?: string | null;
    clientId?: string | null;
    conversationId?: string | null;
    ownerClientId?: string | null;
    routingAddress?: string;
    slot?: BridgeRoutingSlot | null;
    aliases?: string[];
}
interface BridgeHealthState {
    consecutiveFailureCount: number;
}
interface HeadlessWarmupClient {
    activeTurnId: string | null;
    lastTurnStatus: string | null;
    startTurn(inputText: string): Promise<string | null>;
    refreshCurrentThreadState(): Promise<void>;
}
interface LoadedThreadCandidate {
    id: string;
    cwd: string;
    updatedAt: number;
    statusType: string | null;
    thread: any;
}
interface RequestRecord {
    jsonrpc: "2.0";
    id: number;
    method: string;
    params: unknown;
}
interface HeartbeatStoreRecord {
    id?: string;
    agent?: string;
    timestamp?: string;
    lastActivity?: string;
    joinedAt?: string;
    status?: string;
    source?: "bridge-dispatch" | "mcp-direct";
    instanceId?: string | null;
    bridgePid?: number | null;
    connectHash?: string;
    address?: HeartbeatAddressRecord;
    receiveTransports?: string[];
}
type HeartbeatStore = Record<string, HeartbeatStoreRecord>;
interface JsonRpcResponse {
    id?: number;
    result?: any;
    error?: {
        code?: number;
        message?: string;
        data?: unknown;
    };
    method?: string;
    params?: any;
}
declare const DEFAULT_AGENT: string;
declare const DEFAULT_APP_SERVER_URL = "ws://127.0.0.1:4501";
declare const AUTH_SUBPROTOCOL_PREFIX = "tap-auth-";
declare const PLACEHOLDER_AGENT_VALUES: Set<string>;
declare const HEADLESS_WARMUP_PROMPT: string;
declare const HEADLESS_WARMUP_TIMEOUT_MS = 30000;
declare const TURN_COMPLETION_POLL_MS = 250;
declare const TURN_COMPLETION_REFRESH_MS = 1000;
declare const HEADLESS_SKIP_PATTERNS: RegExp[];
declare const COMMS_HEARTBEAT_LOCK_TIMEOUT_MS = 2000;
declare const COMMS_LOCK_STALE_AGE_MS = 10000;
/** M203: Timeout after which an active turn is considered stale (5 minutes). */
declare const STALE_TURN_MS: number;

/**
 * M206: Re-export canonicalizeAgentId as canonicalize for backward compat.
 */
declare function canonicalize(id: string): string;
declare function stripWindowsNamespacePrefix(cwd: string): string;
declare function normalizeThreadCwd(cwd: string): string;
declare function normalizePersistedThreadCwd(cwd: string | null | undefined): string | null;
declare function threadCwdMatches(expectedCwd: string, actualCwd: string | null | undefined): boolean;
declare function chooseLoadedThreadForCwd(cwd: string, threads: LoadedThreadCandidate[]): LoadedThreadCandidate | null;
declare function normalizeAgentToken(value?: string | null): string | null;
declare function resolveAgentId(preferredAgentName?: string | null): string;
declare function resolveAgentName(preferredAgentName: string | null, stateDir: string): string;
declare function resolveCurrentAgentName(agentId: string, fallbackAgentName: string, heartbeats: HeartbeatStore): string;
declare function resolveAddressLabel(address: string, heartbeats: HeartbeatStore): string;
declare function persistAgentName(stateDir: string, agentName: string): void;
declare function formatAgentLabel(agentIdOrName: string, displayName?: string | null): string;
/**
 * Resolve the current display name from heartbeats and persist if changed.
 * Returns the resolved name WITHOUT mutating options.agentName — callers
 * should use the return value for the current scan cycle only.
 * This prevents recipient matching from losing the original configured name.
 */
declare function refreshAgentIdentity(options: Options, heartbeats: HeartbeatStore): string;
/**
 * M206: Delegate to shared tap-identity helper.
 * Kept as named export for barrel backward compatibility.
 */
declare function recipientMatchesAgent(recipient: string, agentId: string, agentName: string): boolean;
/**
 * M206: Delegate to shared tap-identity helper.
 * Kept as named export for barrel backward compatibility.
 */
declare function isOwnMessageSender(sender: string, agentId: string, agentName: string): boolean;
/**
 * M203: Check if a turn's activeFlags indicate it cannot accept steer.
 * Returns true if the turn should be treated as not active.
 */
declare function isTurnStuckOnApproval(activeFlags: string[]): boolean;
declare function isWaitingApprovalStatus(status: string | null | undefined): boolean;
/**
 * M203: Check if a turn has been running longer than the stale threshold.
 */
declare function isTurnStale(turnStartedAt: string | null, nowMs?: number): boolean;
declare function shouldRetrySteerAsStart(error: unknown): boolean;
declare const FORBIDDEN_RAW_PAIR_TOKEN_REASON = "envelope rejected: forbidden raw pairToken field present (M355 defensive drop)";
/**
 * Parse YAML frontmatter from message content for routing.
 * Returns null if no valid frontmatter found.
 */
declare function parseBridgeFrontmatter(content: string): InboxRoute | null;
/**
 * Strip YAML frontmatter from message content, returning only the body.
 */
declare function stripBridgeFrontmatter(content: string): string;
declare function getInboxRoute(fileName: string, body?: string): InboxRoute;
declare function getInboxRouteFromFilename(fileName: string): InboxRoute;

declare function parseArgs(argv: string[]): {
    repoRoot?: string;
    commsDir?: string;
    agentName?: string;
    stateDir?: string;
    pollSeconds?: number;
    reconnectSeconds?: number;
    messageLookbackMinutes?: number;
    processExistingMessages: boolean;
    dryRun: boolean;
    runOnce: boolean;
    waitAfterDispatchSeconds?: number;
    appServerUrl?: string;
    gatewayTokenFile?: string;
    busyMode?: BusyMode;
    logLevel?: LogLevel;
    threadId?: string;
    ephemeral: boolean;
};
declare function resolveRepoRoot(explicit?: string): string;
declare function resolveTapConfigPath(repoRoot: string, input: string): string;
declare function resolveCommsDir(repoRoot: string, explicit?: string): string;
declare function resolvePreferredAgentName(requested?: string): string | null;
declare function sanitizeStateSegment(agentName: string): string;
declare function buildDefaultStateDir(repoRoot: string, preferredAgentName?: string | null): string;
declare function resolveStateDir(repoRoot: string, explicit?: string, preferredAgentName?: string | null): string;
declare function readGatewayTokenFile(tokenFile: string): string;
declare function normalizeRoutingSlotEnv(value: string | null | undefined): BridgeRoutingSlot | null;
declare function buildOptions(argv: string[]): Options;

declare function buildMarkerId(filePath: string, mtimeMs: number): string;
declare function getProcessedMarkerPath(stateDir: string, markerId: string): string;
interface SweepOrphanProcessedMarkersResult {
    scanned: number;
    removed: number;
    kept: number;
    errors: number;
    removedMarkerIds: string[];
}
type SweepLogger = (message: string, context?: Record<string, unknown>) => void;
/**
 * M362 (M346 cache-contract drift #5): scan processed markers and retire
 * those whose source inbox artefact no longer exists, plus those that have
 * aged past the retention window.
 *
 * The sweep is idempotent and failure-tolerant — unreadable payloads and
 * unlink failures are counted into `errors` and skipped, never thrown. The
 * intent is to run once at bridge startup; callers may also invoke it
 * periodically without guard.
 */
declare function sweepOrphanProcessedMarkers(stateDir: string, options?: {
    nowMs?: number;
    maxAgeMs?: number;
    graceMs?: number;
    logger?: SweepLogger;
}): SweepOrphanProcessedMarkersResult;
declare function loadHeartbeats(commsDir: string): HeartbeatStore;
declare function shouldSkipInHeadlessMode(fileName: string, body: string): boolean;
declare function collectCandidates(inboxDir: string, agentId: string, agentName: string, aliasName?: string): Candidate[];
declare function getPendingCandidates(options: Options, cutoff: Date): {
    heartbeats: HeartbeatStore;
    candidates: Candidate[];
};

declare function buildUserInput(candidate: Candidate, agentName: string, heartbeats: HeartbeatStore): string;
declare function writeProcessedMarker(stateDir: string, candidate: Candidate, dispatchMode: DispatchMode, threadId: string | null, turnId: string | null, blockedReason?: string | null): void;
declare function writeLastDispatch(stateDir: string, candidate: Candidate, dispatchMode: DispatchMode, threadId: string | null, turnId: string | null, blockedReason?: string | null): void;

declare function isAutoElicitationRequestMethod(method: string): boolean;
interface ElicitationResult {
    action: "accept" | "cancel";
    content?: Record<string, unknown>;
}
declare function buildAutoElicitationResult(rawParams: unknown): ElicitationResult | null;

type LogContext = Record<string, unknown>;
interface BridgeLogger {
    debug(message: string, context?: LogContext): void;
    info(message: string, context?: LogContext): void;
    warn(message: string, context?: LogContext): void;
    error(message: string, context?: LogContext): void;
}

declare function readSocketData(data: unknown): Promise<string>;
declare function formatJsonRpcError(error: JsonRpcResponse["error"]): string;
declare const DEFAULT_APP_SERVER_REQUEST_TIMEOUT_MS = 30000;
declare class AppServerClient {
    private socket;
    private readonly url;
    private readonly gatewayToken;
    private readonly logger;
    private readonly clientId;
    private nextId;
    private readonly requestTimeoutMs;
    private readonly pending;
    private readonly socketListeners;
    connected: boolean;
    initialized: boolean;
    threadId: string | null;
    currentThreadCwd: string | null;
    activeTurnId: string | null;
    turnStartedAt: string | null;
    lastTurnStatus: string | null;
    lastNotificationMethod: string | null;
    lastNotificationAt: string | null;
    lastError: string | null;
    lastSuccessfulAppServerAt: string | null;
    lastSuccessfulAppServerMethod: string | null;
    constructor(url: string, logger: BridgeLogger, gatewayToken?: string | null, requestTimeoutMs?: number);
    getPendingRequestCount(): number;
    connect(): Promise<void>;
    disconnect(): Promise<void>;
    ensureThread(explicitThreadId: string | null, savedThread: ThreadStateRecord | null, cwd: string, ephemeral: boolean): Promise<string>;
    findLoadedThread(cwd: string): Promise<string | null>;
    startTurn(inputText: string): Promise<string | null>;
    steerTurn(inputText: string): Promise<string>;
    isBusy(): boolean;
    isWaitingOnApproval(): boolean;
    refreshCurrentThreadState(): Promise<void>;
    private requireThreadId;
    private requireActiveTurnId;
    private refreshThreadState;
    private syncThreadStateFromThread;
    private handleMessage;
    private handleNotification;
    private request;
    private sendJsonRpcResult;
    private rejectPending;
    private clearPendingTimeout;
    private detachSocketListeners;
    private buildMetricsContext;
}

declare const DRIVE_NOT_YET_WIRED_REASON = "missing pairToken / drive not yet wired (M345 Phase 2 / M355 pending)";
declare const DRIVE_ACTION_NOT_YET_SUPPORTED_REASON = "drive action is not yet wired through bridge dispatch";
interface DriveDispatchTransport {
    connect(): Promise<unknown>;
    disconnect(): Promise<void>;
    startTurn(options: {
        conversationId: string;
        text: string;
        action?: string | null;
        consentRef?: string | null;
        hostId?: string | null;
        ownerClientId?: string | null;
    }): Promise<unknown>;
}
type DriveDispatchTransportFactory = (options: Options) => DriveDispatchTransport;
declare function sanitizeErrorForPersistence(error: string | null): string | null;
declare function readThreadState(stateDir: string): ThreadStateRecord | null;
declare function persistThreadState(stateDir: string, threadId: string, appServerUrl: string, ephemeral: boolean, cwd: string | null): void;
declare function acquireCommsLock(lockPath: string): boolean;
declare function releaseCommsLock(lockPath: string): void;
declare function updateCommsHeartbeat(options: Options, status: string, conversationId?: string | null): void;
declare function markBridgeActivity(): void;
declare function getLastBridgeActivityAt(): string | null;
declare function writeHeartbeat(options: Options, client: AppServerClient | null, health: BridgeHealthState): void;
declare function dispatchCandidate(client: AppServerClient, options: Options, candidate: Candidate, heartbeats: HeartbeatStore, driveTransportFactory?: DriveDispatchTransportFactory): Promise<boolean>;
declare function runScan(options: Options, cutoff: Date, client: AppServerClient | null): Promise<{
    dispatched: boolean;
    maxMtimeMs: number;
}>;
declare function waitForTurnDrain(options: Options, client: AppServerClient, health: BridgeHealthState): Promise<void>;
declare function waitForTurnCompletion(client: Pick<HeadlessWarmupClient, "activeTurnId" | "lastTurnStatus" | "refreshCurrentThreadState">, turnId: string, timeoutMs: number): Promise<string | null>;
declare function maybeBootstrapHeadlessTurn(options: Options, cutoff: Date, client: HeadlessWarmupClient): Promise<boolean>;

declare function readHeartbeatState(stateDir: string): HeartbeatRecord | null;
declare function loadResumableThreadState(stateDir: string, fallbackAppServerUrl: string): ThreadStateRecord | null;
declare function getGeneralInboxCutoff(stateDir: string, lookbackMinutes: number, processExistingMessages: boolean): Date;
declare function main(): Promise<void>;
declare function isDirectExecution(): boolean;

export { AUTH_SUBPROTOCOL_PREFIX, AppServerClient, type BridgeHealthState, type BridgeRoutingSlot, type BusyMode, COMMS_HEARTBEAT_LOCK_TIMEOUT_MS, COMMS_LOCK_STALE_AGE_MS, type Candidate, type CandidateScope, DEFAULT_AGENT, DEFAULT_APP_SERVER_REQUEST_TIMEOUT_MS, DEFAULT_APP_SERVER_URL, DRIVE_ACTION_NOT_YET_SUPPORTED_REASON, DRIVE_NOT_YET_WIRED_REASON, type DispatchMode, type ElicitationResult, FORBIDDEN_RAW_PAIR_TOKEN_REASON, HEADLESS_SKIP_PATTERNS, HEADLESS_WARMUP_PROMPT, HEADLESS_WARMUP_TIMEOUT_MS, type HeadlessWarmupClient, type HeartbeatAddressRecord, type HeartbeatRecord, type HeartbeatStore, type HeartbeatStoreRecord, type InboxRoute, type JsonRpcResponse, type LoadedThreadCandidate, type LogLevel, type Options, PLACEHOLDER_AGENT_VALUES, type RequestRecord, STALE_TURN_MS, type SweepOrphanProcessedMarkersResult, TURN_COMPLETION_POLL_MS, TURN_COMPLETION_REFRESH_MS, type ThreadStateRecord, acquireCommsLock, buildAutoElicitationResult, buildDefaultStateDir, buildMarkerId, buildOptions, buildUserInput, canonicalize, chooseLoadedThreadForCwd, collectCandidates, dispatchCandidate, formatAgentLabel, formatJsonRpcError, getGeneralInboxCutoff, getInboxRoute, getInboxRouteFromFilename, getLastBridgeActivityAt, getPendingCandidates, getProcessedMarkerPath, isAutoElicitationRequestMethod, isDirectExecution, isOwnMessageSender, isTurnStale, isTurnStuckOnApproval, isWaitingApprovalStatus, loadHeartbeats, loadResumableThreadState, main, markBridgeActivity, maybeBootstrapHeadlessTurn, normalizeAgentToken, normalizePersistedThreadCwd, normalizeRoutingSlotEnv, normalizeThreadCwd, parseArgs, parseBridgeFrontmatter, persistAgentName, persistThreadState, readGatewayTokenFile, readHeartbeatState, readSocketData, readThreadState, recipientMatchesAgent, refreshAgentIdentity, releaseCommsLock, resolveAddressLabel, resolveAgentId, resolveAgentName, resolveCommsDir, resolveCurrentAgentName, resolvePreferredAgentName, resolveRepoRoot, resolveStateDir, resolveTapConfigPath, runScan, sanitizeErrorForPersistence, sanitizeStateSegment, shouldRetrySteerAsStart, shouldSkipInHeadlessMode, stripBridgeFrontmatter, stripWindowsNamespacePrefix, sweepOrphanProcessedMarkers, threadCwdMatches, updateCommsHeartbeat, waitForTurnCompletion, waitForTurnDrain, writeHeartbeat, writeLastDispatch, writeProcessedMarker };
