#!/usr/bin/env node
import * as path from "node:path";
import { startGeminiIdeCompanionServer } from "./gemini-ide-companion.js";

function readNumberEnv(name: string): number | undefined {
  const value = process.env[name];
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function readWorkspacePaths(): string[] {
  const fromEnv =
    process.env.GEMINI_IDE_WORKSPACE_PATHS ??
    process.env.GEMINI_CLI_IDE_WORKSPACE_PATH;
  if (!fromEnv) {
    return [process.cwd()];
  }

  return fromEnv
    .split(path.delimiter)
    .map((workspacePath) => workspacePath.trim())
    .filter(Boolean);
}

const server = await startGeminiIdeCompanionServer({
  host: process.env.GEMINI_IDE_COMPANION_HOST ?? "127.0.0.1",
  port: readNumberEnv("GEMINI_IDE_COMPANION_PORT") ?? 0,
  authToken:
    process.env.GEMINI_IDE_AUTH_TOKEN ?? process.env.GEMINI_CLI_IDE_AUTH_TOKEN,
  enableDiscoveryFile: process.env.GEMINI_IDE_WRITE_DISCOVERY !== "0",
  discoveryPid: readNumberEnv("GEMINI_IDE_DISCOVERY_PID"),
  workspacePaths: readWorkspacePaths(),
  ideInfo: {
    name: process.env.GEMINI_IDE_NAME ?? "tap",
    displayName: process.env.GEMINI_IDE_DISPLAY_NAME ?? "TAP Gemini Companion",
  },
});

console.log(
  JSON.stringify(
    {
      url: server.url,
      authToken: server.authToken,
      discoveryFilePath: server.discoveryFilePath,
    },
    null,
    2,
  ),
);

const shutdown = async () => {
  await server.close();
  process.exit(0);
};

process.on("SIGINT", () => {
  void shutdown();
});

process.on("SIGTERM", () => {
  void shutdown();
});
