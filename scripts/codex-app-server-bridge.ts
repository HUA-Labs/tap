#!/usr/bin/env node --experimental-strip-types

// Re-export everything for backward compatibility
export * from "./bridge/bridge-types.js";
export * from "./bridge/bridge-routing.js";
export * from "./bridge/bridge-config.js";
export * from "./bridge/bridge-candidates.js";
export * from "./bridge/bridge-format.js";
export * from "./bridge/bridge-ws-client.js";
export * from "./bridge/bridge-dispatch.js";
export * from "./bridge/bridge-main.js";

import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { main } from "./bridge/bridge-main.js";
import { sanitizeErrorForPersistence } from "./bridge/bridge-dispatch.js";

// isDirectExecution must live in the barrel — import.meta.url must
// refer to this file, not bridge-main.ts, for argv[1] comparison.
function isDirectExecution(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(resolve(entry)).href;
}

if (isDirectExecution()) {
  main().catch((error) => {
    const raw =
      error instanceof Error ? (error.stack ?? error.message) : String(error);
    console.error(sanitizeErrorForPersistence(raw));
    process.exitCode = 1;
  });
}
