interface BridgeScriptArgsOptions {
    repoRoot: string;
    commsDir: string;
    appServerUrl: string;
    gatewayTokenFile?: string;
    stateDir?: string;
    agentName?: string;
}
declare function buildBridgeScriptArgs(scriptPath: string, options: BridgeScriptArgsOptions): string[];

export { buildBridgeScriptArgs };
