import { Server } from 'node:http';

declare const GATEWAY_READYZ_PATH = "/readyz";
interface GatewayOptions {
    listenUrl: string;
    upstreamUrl: string;
    token: string;
}
interface GatewayRuntime {
    server: Server;
    close(): Promise<void>;
}
declare function buildGatewayOptions(argv: string[]): GatewayOptions;
declare function startGatewayServer(options: GatewayOptions): Promise<GatewayRuntime>;

export { GATEWAY_READYZ_PATH, type GatewayOptions, type GatewayRuntime, buildGatewayOptions, startGatewayServer };
