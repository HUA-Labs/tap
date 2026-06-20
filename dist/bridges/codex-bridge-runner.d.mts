declare function resolveRepoRootHintFromRunner(runnerUrl?: string, env?: NodeJS.ProcessEnv, fileExists?: (candidate: string) => boolean): string | null;
declare function resolveHeadlessReviewGeneration(repoRoot: string, commsDir?: string | null, env?: NodeJS.ProcessEnv): string;
interface BridgeScriptArgsOptions {
    repoRoot: string;
    commsDir: string;
    appServerUrl: string;
    gatewayTokenFile?: string;
    stateDir?: string;
    agentName?: string;
}
declare function resolveBridgeDaemonScript(repoRoot: string, runnerUrl?: string, fileExists?: (candidate: string) => boolean): string | null;
declare function buildBridgeScriptArgs(scriptPath: string, options: BridgeScriptArgsOptions): string[];
declare function buildBridgeDaemonEnv(parentEnv: NodeJS.ProcessEnv, runtimeEnv: NodeJS.ProcessEnv): NodeJS.ProcessEnv;
declare function resolveBridgeRoutingSlot(repoRoot: string, env?: NodeJS.ProcessEnv): string | null;

export { buildBridgeDaemonEnv, buildBridgeScriptArgs, resolveBridgeDaemonScript, resolveBridgeRoutingSlot, resolveHeadlessReviewGeneration, resolveRepoRootHintFromRunner };
