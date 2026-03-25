import { bridgeCommand } from "./bridge.js";
import {
  collectDashboardSnapshot,
  type DashboardSnapshot,
} from "../engine/dashboard.js";
import { findRepoRoot, log } from "../utils.js";
import type { CommandResult } from "../types.js";

const DOWN_HELP = `
Usage:
  tap-comms down

Description:
  Stop all running bridge daemons and managed app-servers.

Examples:
  npx @hua-labs/tap down
`.trim();

type DownResultData = Record<string, unknown> & {
  snapshot: DashboardSnapshot;
};

export async function downCommand(args: string[]): Promise<CommandResult> {
  if (args.includes("--help") || args.includes("-h")) {
    log(DOWN_HELP);
    return {
      ok: true,
      command: "down",
      code: "TAP_NO_OP",
      message: DOWN_HELP,
      warnings: [],
      data: {},
    };
  }

  const repoRoot = findRepoRoot();
  const result = await bridgeCommand(["stop"]);
  const snapshot = collectDashboardSnapshot(repoRoot);

  if (!result.ok) {
    return {
      ...result,
      command: "down",
      data: {
        ...(result.data as Record<string, unknown>),
        snapshot,
      } satisfies DownResultData,
    };
  }

  return {
    ok: true,
    command: "down",
    code: "TAP_DOWN_OK",
    message: `tap down: ${snapshot.bridges.filter((bridge) => bridge.status === "running").length} bridge(s) still running`,
    warnings: result.warnings,
    data: {
      ...(result.data as Record<string, unknown>),
      snapshot,
    } satisfies DownResultData,
  };
}
