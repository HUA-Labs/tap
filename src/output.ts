import type { CommandResult } from "./types.js";
import { logSuccess, logWarn, logError, wasWarningLogged } from "./utils.js";

/**
 * Emit a CommandResult to stdout.
 * --json mode: single JSON object.
 * Human mode: formatted log messages.
 */
export function emitResult(result: CommandResult, jsonMode: boolean): void {
  if (jsonMode) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  // Human mode
  if (result.ok) {
    logSuccess(result.message);
  } else {
    logError(result.message);
  }

  const emittedWarnings = new Set<string>();
  for (const w of result.warnings) {
    if (emittedWarnings.has(w) || wasWarningLogged(w)) {
      continue;
    }
    emittedWarnings.add(w);
    logWarn(w);
  }
}

/**
 * Determine exit code from CommandResult.
 * 0 = ok:true, 1 = ok:false
 */
export function exitCode(result: CommandResult): number {
  return result.ok ? 0 : 1;
}

/**
 * Check if --json flag is present in args.
 * Removes it from the array and returns the flag state.
 */
export function extractJsonFlag(args: string[]): {
  jsonMode: boolean;
  cleanArgs: string[];
} {
  const jsonMode = args.includes("--json");
  const cleanArgs = args.filter((a) => a !== "--json");
  return { jsonMode, cleanArgs };
}
