type BusyMode = "wait" | "steer";
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
    threadId: string | null;
    ephemeral: boolean;
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
interface HeartbeatStoreRecord {
    id?: string;
    agent?: string;
}
type HeartbeatStore = Record<string, HeartbeatStoreRecord>;
declare const HEADLESS_WARMUP_PROMPT: string;
declare function threadCwdMatches(expectedCwd: string, actualCwd: string | null | undefined): boolean;
declare function chooseLoadedThreadForCwd(cwd: string, threads: LoadedThreadCandidate[]): LoadedThreadCandidate | null;
declare function resolveAgentId(preferredAgentName?: string | null): string;
declare function loadResumableThreadState(stateDir: string, fallbackAppServerUrl: string): ThreadStateRecord | null;
declare function recipientMatchesAgent(recipient: string, agentId: string, agentName: string): boolean;
declare function isOwnMessageSender(sender: string, agentId: string, agentName: string): boolean;
declare function resolveAddressLabel(address: string, heartbeats: HeartbeatStore): string;
declare function resolveCurrentAgentName(agentId: string, fallbackAgentName: string, heartbeats: HeartbeatStore): string;
declare function buildUserInput(candidate: Candidate, agentName: string, heartbeats: HeartbeatStore): string;
declare function waitForTurnCompletion(client: Pick<HeadlessWarmupClient, "activeTurnId" | "lastTurnStatus" | "refreshCurrentThreadState">, turnId: string, timeoutMs: number): Promise<string | null>;
declare function maybeBootstrapHeadlessTurn(options: Options, cutoff: Date, client: HeadlessWarmupClient): Promise<boolean>;
declare function buildOptions(argv: string[]): Options;
declare function main(): Promise<void>;

export { HEADLESS_WARMUP_PROMPT, type HeadlessWarmupClient, type LoadedThreadCandidate, buildOptions, buildUserInput, chooseLoadedThreadForCwd, isOwnMessageSender, loadResumableThreadState, main, maybeBootstrapHeadlessTurn, recipientMatchesAgent, resolveAddressLabel, resolveAgentId, resolveCurrentAgentName, threadCwdMatches, waitForTurnCompletion };
