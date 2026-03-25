import { defineConfig } from "tsup";

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/cli.ts",
    "src/mcp-server.ts",
    "src/bridges/codex-app-server-auth-gateway.ts",
    "src/bridges/codex-bridge-runner.ts",
  ],
  format: ["esm"],
  dts: true,
  clean: true,
  outDir: "dist",
  outExtension: () => ({ js: ".mjs" }),
  target: "node20",
  splitting: false,
  sourcemap: true,
});
