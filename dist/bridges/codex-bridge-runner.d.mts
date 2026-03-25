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

export { buildBridgeScriptArgs, resolveBridgeDaemonScript };
