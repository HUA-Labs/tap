interface GatewayOptions {
    listenUrl: string;
    upstreamUrl: string;
    token: string;
}
declare function buildGatewayOptions(argv: string[]): GatewayOptions;

export { buildGatewayOptions };
