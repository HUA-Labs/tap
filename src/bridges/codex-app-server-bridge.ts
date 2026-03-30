import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { main } from "../../scripts/codex-app-server-bridge.ts";

export * from "../../scripts/codex-app-server-bridge.ts";

function isDirectExecution(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
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
