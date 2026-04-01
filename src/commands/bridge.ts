import { parseArgs, log } from "../utils.js";
import type { CommandResult } from "../types.js";
import { bridgeStart, bridgeStartAll } from "./bridge-start.js";
import { bridgeStopOne, bridgeStopAll } from "./bridge-stop.js";
import { bridgeWatch } from "./bridge-watch.js";
import { bridgeStatusAll, bridgeStatusOne } from "./bridge-status.js";
import { bridgeTuiOne } from "./bridge-tui.js";
import { bridgeRestart } from "./bridge-restart.js";

const BRIDGE_HELP = `
Usage:
  tap bridge <subcommand> [instance] [options]

Subcommands:
  start <instance>  Start bridge for an instance (e.g. codex, codex-reviewer)
  start --all       Start all registered app-server instances
  stop  <instance>  Stop bridge for an instance
  stop              Stop all running bridges
  status            Show bridge status for all instances
  status <instance> Show bridge status for a specific instance
  tui <instance>    Show the safe Codex TUI attach command for a running bridge
  watch             Monitor bridges and auto-restart stuck/stale ones

Options:
  --agent-name <name>              Agent identity for bridge (or set TAP_AGENT_NAME env)
                                   Overrides the stored name from 'tap add' when needed
  --all                            Start all registered app-server instances
  --busy-mode <steer|wait>         How to handle active turns (default: steer)
  --poll-seconds <n>               Inbox poll interval (default: 5)
  --reconnect-seconds <n>          Reconnect delay after disconnect (default: 5)
  --message-lookback-minutes <n>   Process messages from last N minutes (default: 10)
  --thread-id <id>                 Resume specific thread
  --ephemeral                      Use ephemeral thread (no persistence)
  --process-existing-messages      Process all existing inbox messages
  --no-server                      Skip app-server auto-start and connect only
  --no-auth                        Skip auth gateway (app-server listens directly, localhost only)

Port Assignment:
  Ports are auto-assigned from 4501 on first bridge start if not set via --port
  during 'tap add'. Auto-assigned ports are saved to state for future starts.

Examples:
  npx @hua-labs/tap bridge start codex --agent-name myAgent
  npx @hua-labs/tap bridge start --all
  npx @hua-labs/tap bridge start codex --agent-name myAgent --no-server
  npx @hua-labs/tap bridge start codex-reviewer --agent-name reviewer --busy-mode steer
  npx @hua-labs/tap bridge stop codex
  npx @hua-labs/tap bridge stop
  npx @hua-labs/tap bridge status
  npx @hua-labs/tap bridge tui codex
`.trim();

export async function bridgeCommand(args: string[]): Promise<CommandResult> {
  const { positional, flags } = parseArgs(args);
  const subcommand = positional[0];
  const identifierArg = positional[1];
  const agentName =
    typeof flags["agent-name"] === "string" ? flags["agent-name"] : undefined;

  if (!subcommand || subcommand === "--help" || subcommand === "-h") {
    log(BRIDGE_HELP);
    return {
      ok: true,
      command: "bridge",
      code: "TAP_NO_OP",
      message: BRIDGE_HELP,
      warnings: [],
      data: {},
    };
  }

  switch (subcommand) {
    case "start": {
      const wantsAll = flags["all"] === true || identifierArg === "--all";
      const hasInstance = identifierArg && identifierArg !== "--all";

      if (wantsAll && hasInstance) {
        return {
          ok: false,
          command: "bridge",
          code: "TAP_INVALID_ARGUMENT",
          message: `Cannot combine <instance> with --all. Use either:\n  tap bridge start ${identifierArg}\n  tap bridge start --all`,
          warnings: [],
          data: {},
        };
      }
      if (wantsAll) {
        return bridgeStartAll(flags);
      }
      if (!identifierArg) {
        return {
          ok: false,
          command: "bridge",
          code: "TAP_INVALID_ARGUMENT",
          message:
            "Missing instance. Usage: npx @hua-labs/tap bridge start <instance> or --all",
          warnings: [],
          data: {},
        };
      }
      return bridgeStart(identifierArg, agentName, flags);
    }

    case "stop": {
      if (!identifierArg) {
        return bridgeStopAll();
      }
      return bridgeStopOne(identifierArg);
    }

    case "status": {
      if (identifierArg) {
        return bridgeStatusOne(identifierArg);
      }
      return bridgeStatusAll();
    }

    case "tui": {
      if (!identifierArg) {
        return {
          ok: false,
          command: "bridge",
          code: "TAP_INVALID_ARGUMENT",
          message:
            "Missing instance. Usage: npx @hua-labs/tap bridge tui <instance>",
          warnings: [],
          data: {},
        };
      }
      return bridgeTuiOne(identifierArg);
    }

    case "watch": {
      const intervalStr =
        typeof flags["interval"] === "string" ? flags["interval"] : undefined;
      const interval = intervalStr ? parseInt(intervalStr, 10) : 30;
      const stuckThresholdStr =
        typeof flags["stuck-threshold"] === "string"
          ? flags["stuck-threshold"]
          : undefined;
      const stuckThreshold = stuckThresholdStr
        ? parseInt(stuckThresholdStr, 10)
        : 300;
      return bridgeWatch(interval, stuckThreshold);
    }

    case "restart": {
      if (!identifierArg) {
        return {
          ok: false,
          command: "bridge",
          code: "TAP_INVALID_ARGUMENT",
          message:
            "Missing instance. Usage: npx @hua-labs/tap bridge restart <instance>",
          warnings: [],
          data: {},
        };
      }
      return bridgeRestart(identifierArg, flags);
    }

    default:
      return {
        ok: false,
        command: "bridge",
        code: "TAP_INVALID_ARGUMENT",
        message: `Unknown bridge subcommand: ${subcommand}. Use: start, stop, restart, status, tui`,
        warnings: [],
        data: {},
      };
  }
}
