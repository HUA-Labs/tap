#!/usr/bin/env node --experimental-strip-types

// Re-export everything for backward compatibility.
// Keep this file executable, but point exports at a non-executable barrel so
// bundled bridge entrypoints do not inherit a second direct-execution block.
export * from "../bridge/index.ts";

import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { main, sanitizeErrorForPersistence } from "../bridge/index.ts";

// isDirectExecution must live in the barrel — import.meta.url must
// refer to this file, not bridge-main.ts, for argv[1] comparison.
function isDirectExecution(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(resolve(entry)).href;
}

if (isDirectExecution()) {
  main().catch((error: unknown) => {
    const raw =
      error instanceof Error ? (error.stack ?? error.message) : String(error);
    console.error(sanitizeErrorForPersistence(raw));
    process.exitCode = 1;
  });
}
