import { initCommand } from "./commands/init.js";
import { addCommand } from "./commands/add.js";
import { statusCommand } from "./commands/status.js";
import { removeCommand } from "./commands/remove.js";
import { bridgeCommand } from "./commands/bridge.js";
import { upCommand } from "./commands/up.js";
import { downCommand } from "./commands/down.js";
import { serveCommand } from "./commands/serve.js";
import { initWorktreeCommand } from "./commands/init-worktree.js";
import { dashboardCommand } from "./commands/dashboard.js";
import { doctorCommand } from "./commands/doctor.js";
import { version } from "./version.js";
import { extractJsonFlag, emitResult, exitCode } from "./output.js";
import { setJsonMode } from "./utils.js";
import type { CommandName, CommandResult } from "./types.js";

const HELP = `
@hua-labs/tap — Cross-model AI agent communication setup

Usage:
  tap-comms <command> [options]

Commands:
  init                  Initialize comms directory and state
  init-worktree         Set up a new git worktree with tap-comms
  add <runtime>         Add a runtime instance (claude, codex, gemini)
  remove <instance>     Remove an instance and rollback config
  status                Show installed instances and bridge status
  bridge <sub> [inst]   Manage bridges (start, stop, status)
  up                    Start all registered bridge daemons
  down                  Stop all running bridge daemons
  dashboard             Show unified ops dashboard
  doctor                Diagnose tap infrastructure health
  serve                 Start tap-comms MCP server (stdio)
  version               Show version

Options:
  --help, -h            Show help
  --json                Machine-readable JSON output
  --comms-dir <path>    Override comms directory path

Examples:
  npx @hua-labs/tap init
  npx @hua-labs/tap init-worktree --path ../hua-wt-3 --branch feat/my-feature
  npx @hua-labs/tap add claude
  npx @hua-labs/tap add codex --name reviewer --port 4501
  npx @hua-labs/tap status
`.trim();

function normalizeCommandName(command: string | undefined): CommandName {
  switch (command) {
    case "init":
    case "init-worktree":
    case "add":
    case "remove":
    case "status":
    case "bridge":
    case "up":
    case "down":
    case "dashboard":
    case "doctor":
    case "serve":
      return command;
    default:
      return "unknown";
  }
}

async function main(): Promise<void> {
  const rawArgs = process.argv.slice(2);
  const { jsonMode, cleanArgs } = extractJsonFlag(rawArgs);
  setJsonMode(jsonMode);
  const command = cleanArgs[0];

  if (!command || command === "--help" || command === "-h") {
    if (jsonMode) {
      console.log(JSON.stringify({ help: HELP }));
    } else {
      console.log(HELP);
    }
    process.exit(0);
  }

  if (command === "version" || command === "--version" || command === "-v") {
    if (jsonMode) {
      console.log(JSON.stringify({ version }));
    } else {
      console.log(`@hua-labs/tap v${version}`);
    }
    process.exit(0);
  }

  const commandArgs = cleanArgs.slice(1);
  let result: CommandResult;

  try {
    switch (command) {
      case "init":
        result = await initCommand(commandArgs);
        break;
      case "init-worktree":
        result = await initWorktreeCommand(commandArgs);
        break;
      case "add":
        result = await addCommand(commandArgs);
        break;
      case "remove":
        result = await removeCommand(commandArgs);
        break;
      case "status":
        result = await statusCommand(commandArgs);
        break;
      case "bridge":
        result = await bridgeCommand(commandArgs);
        break;
      case "up":
        result = await upCommand(commandArgs);
        break;
      case "down":
        result = await downCommand(commandArgs);
        break;
      case "dashboard":
        result = await dashboardCommand(commandArgs);
        break;
      case "doctor":
        result = await doctorCommand(commandArgs);
        break;
      case "serve": {
        // serve takes over stdio for MCP protocol — don't emit result on stdout
        const serveResult = await serveCommand(commandArgs);
        if (!serveResult.ok) {
          // Only emit on error (before MCP server starts)
          emitResult(serveResult, jsonMode);
        }
        process.exit(exitCode(serveResult));
        break;
      }
      default:
        result = {
          ok: false,
          command: "unknown",
          code: "TAP_INVALID_ARGUMENT",
          message: `Unknown command: ${command}`,
          warnings: [],
          data: { requestedCommand: command },
        };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    result = {
      ok: false,
      command: normalizeCommandName(command),
      code: "TAP_INTERNAL_ERROR",
      message,
      warnings: [],
      data: command ? { requestedCommand: command } : {},
    };
  }

  emitResult(result, jsonMode);
  process.exit(exitCode(result));
}

main();
