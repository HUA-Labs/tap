import { bridgeCommand } from "./bridge.js";
import { log, logHeader, parseArgs, parseIntFlag } from "../utils.js";
import type { CommandResult } from "../types.js";

const WATCH_HELP = `
Usage:
  tap watch [options]

Description:
  Monitor all bridges and auto-restart stuck/stale ones.
  Single-pass by default. Use --loop for continuous monitoring.

Options:
  --stuck-threshold <seconds>  Turn stuck threshold (default: 300)
  --interval <seconds>         Loop interval (default: 60)
  --loop                       Run continuously instead of single-pass
  --max-rounds <n>             Max loop iterations (default: unlimited)

Examples:
  npx @hua-labs/tap watch                          # single check
  npx @hua-labs/tap watch --loop                   # continuous
  npx @hua-labs/tap watch --loop --interval 30     # check every 30s
  npx @hua-labs/tap watch --stuck-threshold 120    # 2 min threshold
`.trim();

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function watchCommand(args: string[]): Promise<CommandResult> {
  const { flags } = parseArgs(args);

  if (flags["help"] === true || flags["h"] === true) {
    log(WATCH_HELP);
    return {
      ok: true,
      command: "watch",
      code: "TAP_NO_OP",
      message: WATCH_HELP,
      warnings: [],
      data: {},
    };
  }

  const stuckThresholdStr =
    typeof flags["stuck-threshold"] === "string"
      ? flags["stuck-threshold"]
      : undefined;
  const intervalStr =
    typeof flags["interval"] === "string" ? flags["interval"] : undefined;
  const loop = flags["loop"] === true;
  const maxRoundsStr =
    typeof flags["max-rounds"] === "string" ? flags["max-rounds"] : undefined;

  let stuckThreshold: number;
  let interval: number;
  let maxRounds: number | null;
  try {
    stuckThreshold =
      parseIntFlag(stuckThresholdStr, "--stuck-threshold", 30, 3600) ?? 300;
    interval = parseIntFlag(intervalStr, "--interval", 5, 3600) ?? 60;
    maxRounds = parseIntFlag(maxRoundsStr, "--max-rounds", 1, 10000) ?? null;
  } catch (err) {
    return {
      ok: false,
      command: "watch",
      code: "TAP_INVALID_ARGUMENT",
      message: err instanceof Error ? err.message : String(err),
      warnings: [],
      data: {},
    };
  }

  // Build bridge watch args
  const bridgeArgs = ["watch", "--stuck-threshold", String(stuckThreshold)];

  if (!loop) {
    // Single-pass mode
    return bridgeCommand(bridgeArgs);
  }

  // Loop mode
  logHeader("@hua-labs/tap watch (loop mode)");
  log(`Interval: ${interval}s, Stuck threshold: ${stuckThreshold}s`);
  if (maxRounds != null) {
    log(`Max rounds: ${maxRounds}`);
  }
  log("");

  let round = 0;
  let failedRounds = 0;
  const allRestarted: string[] = [];
  const allWarnings: string[] = [];
  while (maxRounds == null || round < maxRounds) {
    round++;
    const timestamp = new Date().toISOString().slice(11, 19);
    log(`[${timestamp}] Round ${round}`);

    const result = await bridgeCommand(bridgeArgs);

    if (!result.ok) {
      failedRounds++;
      allWarnings.push(`Round ${round}: ${result.message}`);
    }

    if (result.data?.restarted) {
      const restarted = result.data.restarted as string[];
      allRestarted.push(...restarted);
    }
    if (result.warnings?.length) {
      allWarnings.push(...result.warnings);
    }

    if (maxRounds != null && round >= maxRounds) break;

    await delay(interval * 1000);
  }

  const allOk = failedRounds === 0;
  const message = [
    `Completed ${round} round(s)`,
    failedRounds > 0 ? `${failedRounds} failed` : null,
    allRestarted.length > 0
      ? `Total restarts: ${allRestarted.length} (${allRestarted.join(", ")})`
      : "No restarts needed",
  ]
    .filter(Boolean)
    .join(". ");

  return {
    ok: allOk,
    command: "watch",
    code: !allOk
      ? "TAP_WATCH_FAILED"
      : allRestarted.length > 0
        ? "TAP_WATCH_RESTARTED"
        : "TAP_WATCH_OK",
    message,
    warnings: allWarnings,
    data: { rounds: round, restarted: allRestarted },
  };
}
