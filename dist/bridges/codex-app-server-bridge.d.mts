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
interface HeadlessWarmupClient {
    activeTurnId: string | null;
    lastTurnStatus: string | null;
    startTurn(inputText: string): Promise<string | null>;
    refreshCurrentThreadState(): Promise<void>;
}
interface HeartbeatStoreRecord {
    id?: string;
    agent?: string;
}
type HeartbeatStore = Record<string, HeartbeatStoreRecord>;
declare const HEADLESS_WARMUP_PROMPT: string;
declare function resolveAgentId(preferredAgentName?: string | null): string;
declare function recipientMatchesAgent(recipient: string, agentId: string, agentName: string): boolean;
declare function isOwnMessageSender(sender: string, agentId: string, agentName: string): boolean;
declare function resolveAddressLabel(address: string, heartbeats: HeartbeatStore): string;
declare function resolveCurrentAgentName(agentId: string, fallbackAgentName: string, heartbeats: HeartbeatStore): string;
declare function buildUserInput(candidate: Candidate, agentName: string, heartbeats: HeartbeatStore): string;
declare function waitForTurnCompletion(client: Pick<HeadlessWarmupClient, "activeTurnId" | "lastTurnStatus" | "refreshCurrentThreadState">, turnId: string, timeoutMs: number): Promise<string | null>;
declare function maybeBootstrapHeadlessTurn(options: Options, cutoff: Date, client: HeadlessWarmupClient): Promise<boolean>;
declare function buildOptions(argv: string[]): Options;
declare function main(): Promise<void>;

export { HEADLESS_WARMUP_PROMPT, type HeadlessWarmupClient, buildOptions, buildUserInput, isOwnMessageSender, main, maybeBootstrapHeadlessTurn, recipientMatchesAgent, resolveAddressLabel, resolveAgentId, resolveCurrentAgentName, waitForTurnCompletion };
