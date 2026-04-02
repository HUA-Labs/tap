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

export { buildBridgeDaemonEnv, buildBridgeScriptArgs, resolveBridgeDaemonScript };
