type BusyMode = "wait" | "steer";
type LogLevel = "debug" | "info" | "warn" | "error";
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
}
interface InboxRoute {
    sender: string;
    recipient: string;
    subject: string;
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
declare function normalizeThreadCwd(cwd: string): string;
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
/**
 * M203: Check if a turn has been running longer than the stale threshold.
 */
declare function isTurnStale(turnStartedAt: string | null, nowMs?: number): boolean;
declare function shouldRetrySteerAsStart(error: unknown): boolean;
/**
 * Parse YAML frontmatter from message content for routing.
 * Returns null if no valid frontmatter found.
 */
declare function parseBridgeFrontmatter(content: string): {
    sender: string;
    recipient: string;
    subject: string;
} | null;
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
declare function buildOptions(argv: string[]): Options;

declare function buildMarkerId(filePath: string, mtimeMs: number): string;
declare function getProcessedMarkerPath(stateDir: string, markerId: string): string;
declare function loadHeartbeats(commsDir: string): HeartbeatStore;
declare function shouldSkipInHeadlessMode(fileName: string, body: string): boolean;
declare function collectCandidates(inboxDir: string, agentId: string, agentName: string, aliasName?: string): Candidate[];
declare function getPendingCandidates(options: Options, cutoff: Date): {
    heartbeats: HeartbeatStore;
    candidates: Candidate[];
};

declare function buildUserInput(candidate: Candidate, agentName: string, heartbeats: HeartbeatStore): string;
declare function writeProcessedMarker(stateDir: string, candidate: Candidate, dispatchMode: "start" | "steer", threadId: string | null, turnId: string | null): void;
declare function writeLastDispatch(stateDir: string, candidate: Candidate, dispatchMode: "start" | "steer", threadId: string | null, turnId: string | null): void;

type LogContext = Record<string, unknown>;
interface BridgeLogger {
    debug(message: string, context?: LogContext): void;
    info(message: string, context?: LogContext): void;
    warn(message: string, context?: LogContext): void;
    error(message: string, context?: LogContext): void;
}

declare function readSocketData(data: unknown): Promise<string>;
declare function formatJsonRpcError(error: JsonRpcResponse["error"]): string;
declare class AppServerClient {
    private socket;
    private readonly url;
    private readonly gatewayToken;
    private readonly logger;
    private readonly clientId;
    private nextId;
    private pending;
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
    constructor(url: string, logger: BridgeLogger, gatewayToken?: string | null);
    connect(): Promise<void>;
    disconnect(): Promise<void>;
    ensureThread(explicitThreadId: string | null, savedThread: ThreadStateRecord | null, cwd: string, ephemeral: boolean): Promise<string>;
    findLoadedThread(cwd: string): Promise<string | null>;
    startTurn(inputText: string): Promise<string | null>;
    steerTurn(inputText: string): Promise<string>;
    isBusy(): boolean;
    refreshCurrentThreadState(): Promise<void>;
    private requireThreadId;
    private requireActiveTurnId;
    private refreshThreadState;
    private syncThreadStateFromThread;
    private handleMessage;
    private handleNotification;
    private request;
    private rejectPending;
}

declare function sanitizeErrorForPersistence(error: string | null): string | null;
declare function readThreadState(stateDir: string): ThreadStateRecord | null;
declare function persistThreadState(stateDir: string, threadId: string, appServerUrl: string, ephemeral: boolean, cwd: string | null): void;
declare function acquireCommsLock(lockPath: string): boolean;
declare function releaseCommsLock(lockPath: string): void;
declare function updateCommsHeartbeat(options: Options, status: string): void;
declare function writeHeartbeat(options: Options, client: AppServerClient | null, health: BridgeHealthState): void;
declare function dispatchCandidate(client: AppServerClient, options: Options, candidate: Candidate, heartbeats: HeartbeatStore): Promise<boolean>;
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

export { AUTH_SUBPROTOCOL_PREFIX, AppServerClient, type BridgeHealthState, type BusyMode, COMMS_HEARTBEAT_LOCK_TIMEOUT_MS, COMMS_LOCK_STALE_AGE_MS, type Candidate, DEFAULT_AGENT, DEFAULT_APP_SERVER_URL, HEADLESS_SKIP_PATTERNS, HEADLESS_WARMUP_PROMPT, HEADLESS_WARMUP_TIMEOUT_MS, type HeadlessWarmupClient, type HeartbeatRecord, type HeartbeatStore, type HeartbeatStoreRecord, type InboxRoute, type JsonRpcResponse, type LoadedThreadCandidate, type LogLevel, type Options, PLACEHOLDER_AGENT_VALUES, type RequestRecord, STALE_TURN_MS, TURN_COMPLETION_POLL_MS, TURN_COMPLETION_REFRESH_MS, type ThreadStateRecord, acquireCommsLock, buildDefaultStateDir, buildMarkerId, buildOptions, buildUserInput, canonicalize, chooseLoadedThreadForCwd, collectCandidates, dispatchCandidate, formatAgentLabel, formatJsonRpcError, getGeneralInboxCutoff, getInboxRoute, getInboxRouteFromFilename, getPendingCandidates, getProcessedMarkerPath, isDirectExecution, isOwnMessageSender, isTurnStale, isTurnStuckOnApproval, loadHeartbeats, loadResumableThreadState, main, maybeBootstrapHeadlessTurn, normalizeAgentToken, normalizeThreadCwd, parseArgs, parseBridgeFrontmatter, persistAgentName, persistThreadState, readGatewayTokenFile, readHeartbeatState, readSocketData, readThreadState, recipientMatchesAgent, refreshAgentIdentity, releaseCommsLock, resolveAddressLabel, resolveAgentId, resolveAgentName, resolveCommsDir, resolveCurrentAgentName, resolvePreferredAgentName, resolveRepoRoot, resolveStateDir, resolveTapConfigPath, runScan, sanitizeErrorForPersistence, sanitizeStateSegment, shouldRetrySteerAsStart, shouldSkipInHeadlessMode, stripBridgeFrontmatter, threadCwdMatches, updateCommsHeartbeat, waitForTurnCompletion, waitForTurnDrain, writeHeartbeat, writeLastDispatch, writeProcessedMarker };
