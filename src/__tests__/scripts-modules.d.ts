declare module "../../scripts/lib/chain-review-router-core.mjs" {
  export function runChainRouterPass(options?: unknown, deps?: unknown): Promise<any>;
}

declare module "../../scripts/tap-autopilot.mjs" {
  export function getAutopilotStatus(options?: unknown, deps?: unknown): any;
  export function runAutopilotPass(options?: unknown, deps?: unknown): Promise<any>;
}
