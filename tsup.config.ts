import { defineConfig } from "tsup";

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/cli.ts",
    "src/mcp-server.ts",
    "src/bridges/codex-app-server-auth-gateway.ts",
    "src/bridges/codex-app-server-bridge.ts",
    "src/bridges/codex-bridge-runner.ts",
    "src/bridges/gemini-ide-companion-runner.ts",
  ],
  format: ["esm"],
  dts: true,
  clean: true,
  outDir: "dist",
  outExtension: () => ({ js: ".mjs" }),
  target: "node20",
  splitting: false,
  sourcemap: true,
  external: [
    "@modelcontextprotocol/sdk",
    "@modelcontextprotocol/sdk/server/index.js",
    "@modelcontextprotocol/sdk/server/streamableHttp.js",
    "@modelcontextprotocol/sdk/server/stdio.js",
    "@modelcontextprotocol/sdk/types.js",
  ],
});
