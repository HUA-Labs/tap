#!/usr/bin/env node

import { setTimeout as sleep } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import {
  getActiveReviewers,
  loadChainState,
  resolveChainConfig,
  runChainRouterPass,
} from "./lib/chain-review-router-core.mjs";

function parsePositiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function formatTime(now) {
  return new Date(now).toLocaleTimeString("en-GB", { hour12: false });
}

function registerSignalHandlers(proc, onSignal) {
  const subscriptions = [];

  for (const signal of ["SIGINT", "SIGTERM"]) {
    const handler = () => onSignal(signal);
    if (typeof proc.once === "function") {
      proc.once(signal, handler);
    } else if (typeof proc.on === "function") {
      proc.on(signal, handler);
    }
    subscriptions.push([signal, handler]);
  }

  return () => {
    for (const [signal, handler] of subscriptions) {
      if (typeof proc.off === "function") {
        proc.off(signal, handler);
      } else if (typeof proc.removeListener === "function") {
        proc.removeListener(signal, handler);
      }
    }
  };
}

export function parseAutopilotArgs(argv) {
  const args = argv.slice(2);
  return {
    once: args.includes("--once"),
    status: args.includes("--status"),
    dryRun: args.includes("--dry-run"),
    specificPR: args.includes("--pr")
      ? Number(args[args.indexOf("--pr") + 1])
      : null,
    intervalSeconds: args.includes("--interval")
      ? parsePositiveNumber(args[args.indexOf("--interval") + 1], 30)
      : 30,
    maxReviewCycles: args.includes("--max-review-cycles")
      ? parsePositiveNumber(args[args.indexOf("--max-review-cycles") + 1], 3)
      : null,
  };
}

export function getAutopilotStatus(options = {}, deps = {}) {
  const config = resolveChainConfig(options, deps);
  const state = loadChainState(config.statePath, deps.fs);
  const reviewers = getActiveReviewers(config, deps);
  const tracked = Object.keys(state.seenPrs);
  const pendingAuthorNotifications = tracked.filter((prKey) => {
    const entry = state.seenPrs[prKey];
    return entry?.routed && !entry?.lastReviewFile;
  });

  return {
    config,
    trackedPrs: tracked.length,
    pendingAuthorNotifications: pendingAuthorNotifications.length,
    activeReviewers: reviewers,
    state,
  };
}

export async function runAutopilotPass(options = {}, deps = {}) {
  const now = deps.now?.() ?? new Date();
  const passNumber = options.passNumber ?? 1;
  const chainResult = await (deps.runChainRouterPass ?? runChainRouterPass)(options, deps);

  return {
    passNumber,
    timestamp: new Date(now).toISOString(),
    chain: chainResult,
  };
}

export async function runAutopilotLoop(options = {}, deps = {}) {
  const log = deps.log ?? console.log;
  const errorLog = deps.error ?? console.error;
  const sleepFn = deps.sleep ?? sleep;
  const proc = deps.process ?? process;
  let passNumber = 1;
  let stopSignal = null;
  let currentSleepController = null;

  const unregisterSignals = registerSignalHandlers(proc, (signal) => {
    if (stopSignal) return;
    stopSignal = signal;
    log(`[autopilot] ${signal} received, stopping after current pass`);
    currentSleepController?.abort();
  });

  try {
    while (true) {
      try {
        const result = await runAutopilotPass({ ...options, passNumber }, deps);
        printAutopilotPass(result, log);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errorLog(`[autopilot] pass failed: ${message}`);
        if (options.once) {
          throw error;
        }
      }

      if (options.once || stopSignal) break;

      currentSleepController = new AbortController();
      try {
        await sleepFn(Math.max(1, options.intervalSeconds) * 1000, undefined, {
          signal: currentSleepController.signal,
        });
      } catch (error) {
        if (!(stopSignal && error instanceof Error && error.name === "AbortError")) {
          throw error;
        }
      } finally {
        currentSleepController = null;
      }

      if (stopSignal) break;
      passNumber += 1;
    }

    if (stopSignal) {
      log(`[autopilot] shutdown complete (${stopSignal})`);
    }

    return {
      passNumber,
      stoppedBySignal: stopSignal,
    };
  } finally {
    unregisterSignals();
  }
}

export function printAutopilotStatus(status, log = console.log) {
  log(`[autopilot] Comms: ${status.config.commsDir}`);
  log(`[autopilot] State: ${status.config.statePath}`);
  log(
    `[autopilot] Tracking ${status.trackedPrs} PR(s), ${status.pendingAuthorNotifications} pending author notification(s)`,
  );
  log(
    `[autopilot] Active reviewers: ${status.activeReviewers.length > 0 ? status.activeReviewers.map((reviewer) => reviewer.name).join(", ") : "none"}`,
  );
}

export function printAutopilotPass(result, log = console.log) {
  const { passNumber, timestamp, chain } = result;
  log(`[autopilot ${formatTime(timestamp)}] Pass #${passNumber}`);
  log(
    `  Review routing: ${chain.summary.routed} routed, ${chain.summary.rerouted} rerouted, ${chain.summary.skipped} skipped, ${chain.summary.escalated} escalated`,
  );
  log(
    `  Review completions: ${chain.summary.completions} author notification(s)`,
  );
  log(
    `  Active reviewers: ${chain.reviewers.length > 0 ? chain.reviewers.map((reviewer) => reviewer.name).join(", ") : "none"}`,
  );
}

export async function main(argv = process.argv) {
  const options = parseAutopilotArgs(argv);

  if (options.status) {
    printAutopilotStatus(getAutopilotStatus(options));
    return;
  }

  await runAutopilotLoop(options);
}

const isMainModule =
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule) {
  main().catch((error) => {
    console.error(
      `[autopilot] fatal: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  });
}
