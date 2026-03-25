import { bridgeCommand } from "./bridge.js";
import {
  collectDashboardSnapshot,
  type DashboardSnapshot,
} from "../engine/dashboard.js";
import { findRepoRoot, log } from "../utils.js";
import type { CommandResult } from "../types.js";

const UP_HELP = `
Usage:
  tap-comms up [bridge-start options]

Description:
  Start all registered app-server bridge daemons with one command.
  This is the orchestration entrypoint for headless/background TAP operation.

Examples:
  npx @hua-labs/tap up
  npx @hua-labs/tap up --no-auth
  npx @hua-labs/tap up --busy-mode wait
`.trim();

type UpResultData = Record<string, unknown> & {
  snapshot: DashboardSnapshot;
};

export async function upCommand(args: string[]): Promise<CommandResult> {
  if (args.includes("--help") || args.includes("-h")) {
    log(UP_HELP);
    return {
      ok: true,
      command: "up",
      code: "TAP_NO_OP",
      message: UP_HELP,
      warnings: [],
      data: {},
    };
  }

  const repoRoot = findRepoRoot();
  const result = await bridgeCommand(["start", "--all", ...args]);
  const snapshot = collectDashboardSnapshot(repoRoot);
  const activeBridges = snapshot.bridges.filter(
    (bridge) => bridge.status === "running",
  ).length;

  if (!result.ok) {
    return {
      ...result,
      command: "up",
      data: {
        ...(result.data as Record<string, unknown>),
        snapshot,
      } satisfies UpResultData,
    };
  }

  return {
    ok: true,
    command: "up",
    code: "TAP_UP_OK",
    message: `tap up: ${activeBridges} bridge(s) running`,
    warnings: result.warnings,
    data: {
      ...(result.data as Record<string, unknown>),
      snapshot,
    } satisfies UpResultData,
  };
}
