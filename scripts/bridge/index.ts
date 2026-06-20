// bridge/index.ts — barrel re-export for bridge modules.
// Keep this file non-executable so bundled entrypoints don't inherit
// a second direct-execution block.

export * from "./bridge-types.ts";
export * from "./bridge-routing.ts";
export * from "./bridge-config.ts";
export * from "./bridge-candidates.ts";
export * from "./bridge-format.ts";
export * from "./bridge-elicitation.ts";
export * from "./bridge-ws-client.ts";
export * from "./bridge-dispatch.ts";
export * from "./bridge-main.ts";
