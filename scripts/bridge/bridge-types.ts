// bridge-types.ts — All interfaces, types, type aliases, and constants

export type BusyMode = "wait" | "steer";
export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Options {
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

export interface InboxRoute {
  sender: string;
  recipient: string;
  subject: string;
}

export interface Candidate {
  markerId: string;
  filePath: string;
  fileName: string;
  sender: string;
  recipient: string;
  subject: string;
  body: string;
  mtimeMs: number;
}

export interface ThreadStateRecord {
  threadId: string;
  updatedAt: string;
  appServerUrl: string;
  ephemeral: boolean;
  cwd?: string | null;
}

export interface HeartbeatRecord {
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

export interface BridgeHealthState {
  consecutiveFailureCount: number;
}

export interface HeadlessWarmupClient {
  activeTurnId: string | null;
  lastTurnStatus: string | null;
  startTurn(inputText: string): Promise<string | null>;
  refreshCurrentThreadState(): Promise<void>;
}

export interface LoadedThreadCandidate {
  id: string;
  cwd: string;
  updatedAt: number;
  statusType: string | null;
  thread: any;
}

export interface RequestRecord {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params: unknown;
}

export interface HeartbeatStoreRecord {
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

export type HeartbeatStore = Record<string, HeartbeatStoreRecord>;

export interface JsonRpcResponse {
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

export const DEFAULT_AGENT = String.fromCharCode(0xc628);
export const DEFAULT_APP_SERVER_URL = "ws://127.0.0.1:4501";
export const AUTH_SUBPROTOCOL_PREFIX = "tap-auth-";
export const PLACEHOLDER_AGENT_VALUES = new Set([
  "unknown",
  "unnamed",
  "<set-per-session>",
]);
export const HEADLESS_WARMUP_PROMPT = [
  "You are a tap worker agent connected via the tap-comms inbox.",
  "This is a one-time warmup turn for headless bridge startup.",
  "Do not take any external actions.",
  "Reply briefly, then wait for future inbox instructions.",
].join(" ");
export const HEADLESS_WARMUP_TIMEOUT_MS = 30_000;
export const TURN_COMPLETION_POLL_MS = 250;
export const TURN_COMPLETION_REFRESH_MS = 1_000;

// When running in headless reviewer mode, review-request files are handled
// by the headless loop (engine/headless-loop.ts), not the generic bridge.
// Skip them here to prevent race conditions.
export const HEADLESS_SKIP_PATTERNS = [
  /리뷰\s*요청/,
  /review[- ]?request/i,
  /재리뷰/,
  /re-?review/i,
];

// ── Comms heartbeat (shared agent registry) ───────────────────────────
export const COMMS_HEARTBEAT_LOCK_TIMEOUT_MS = 2_000;
export const COMMS_LOCK_STALE_AGE_MS = 10_000;

/** M203: Timeout after which an active turn is considered stale (5 minutes). */
export const STALE_TURN_MS = 5 * 60 * 1000;
