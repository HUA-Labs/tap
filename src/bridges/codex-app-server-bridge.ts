import { pathToFileURL } from "node:url";
import { basename, resolve } from "node:path";
import { main } from "../../scripts/bridge/index.js";

export * from "../../scripts/bridge/index.js";

function isDirectExecution(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  if (!basename(entry).startsWith("codex-app-server-bridge")) return false;
  return import.meta.url === pathToFileURL(resolve(entry)).href;
}

if (isDirectExecution()) {
  main().catch((error) => {
    console.error(
      error instanceof Error ? (error.stack ?? error.message) : String(error),
    );
    process.exitCode = 1;
  });
}
