import { initCommand } from "./commands/init.js";
import { addCommand } from "./commands/add.js";
import { statusCommand } from "./commands/status.js";
import { setupCommand } from "./commands/setup.js";
import { removeCommand } from "./commands/remove.js";
import { bridgeCommand } from "./commands/bridge.js";
import { upCommand } from "./commands/up.js";
import { downCommand } from "./commands/down.js";
import { serveCommand } from "./commands/serve.js";
import { initWorktreeCommand } from "./commands/init-worktree.js";
import { dashboardCommand } from "./commands/dashboard.js";
import { doctorCommand } from "./commands/doctor.js";
import { commsCommand } from "./commands/comms.js";
import { readyCommand } from "./commands/ready.js";
import { receiverCommand } from "./commands/receiver.js";
import { headlessCommand } from "./commands/headless.js";
import { projectionCommand } from "./commands/projection.js";
import { uplinkCommand } from "./commands/uplink.js";
import { watchCommand } from "./commands/watch.js";
import { guiCommand } from "./commands/gui.js";
import { remotePanelCommand } from "./commands/remote-panel.js";
import { permissionsCommand } from "./commands/permissions.js";
import { reviewsCommand } from "./commands/reviews.js";
import { sessionsCommand } from "./commands/sessions.js";
import { infraCommand } from "./commands/infra.js";
import { windowsRouteRecoverCommand } from "./commands/windows-route-recover.js";
import { appRouteFreshnessCommand } from "./commands/app-route-freshness.js";
import { commsDoctorCommand } from "./commands/comms-doctor.js";
import { flowDoctorCommand } from "./commands/flow-doctor.js";
import { version } from "./version.js";
import { extractJsonFlag, emitResult, exitCode } from "./output.js";
import { resetLoggedWarnings, setJsonMode } from "./utils.js";
import { suggestCommand } from "./cli-suggest.js";
import type { CommandName, CommandResult } from "./types.js";

const HELP = `
@hua-labs/tap — Cross-model AI agent communication setup

Usage:
  tap <command> [options]

Commands:
  init                  Initialize comms directory and state
  init-worktree         Set up a new git worktree with tap
  add <runtime>         Add a runtime instance (claude, codex, gemini)
  remove <instance>     Remove an instance and rollback config
  status                Show installed instances and bridge status
  setup                 Generate a dry-run one-shot setup report
  bridge <sub> [inst]   Manage bridges (start, stop, status)
  up                    Start all registered bridge daemons
  down                  Stop all running bridge daemons
  comms <pull|push>     Sync comms directory with remote repo
  ready                 Report post-identity runtime-surface readiness
  receiver <mode>       Promote local inbox polling for Codex CLI
  headless <mode>       Run bounded CLI/headless inbox response loop
  projection <mode>     Project central append-only records to local comms
  uplink <mode>         Upload local append-only records to central comms
  dashboard             Show unified ops dashboard
  watch                 Monitor bridges and auto-restart stuck ones
  gui                   Start local web dashboard (http)
  remote-panel          Start mobile read-only tap communication panel
  permissions           Restore tap-managed permission backups
  reviews               Recover or register review evidence
  sessions              Archive inactive Codex session JSONL logs
  infra                 Summarize tap runtime operations
  windows-route-recover Recover Windows App consent-drive route
  app-route-freshness Check App consent-drive route evidence freshness
  comms-doctor        Explain surface-first delivery and evidence gaps
  flow-doctor         Diagnose receiver lane and return-uplink evidence flow
  doctor                Diagnose tap infrastructure health
  serve                 Start tap MCP server (stdio)
  version               Show version

Options:
  --help, -h            Show help
  --json                Machine-readable JSON output
  --comms-dir <path>    Override comms directory path

Examples:
  npx @hua-labs/tap init
  npx @hua-labs/tap init-worktree --path ../hua-wt-3 --branch feat/my-feature
  npx @hua-labs/tap add claude
  npx @hua-labs/tap add codex --name agent-a --port 4501
  npx @hua-labs/tap status
`.trim();

function normalizeCommandName(command: string | undefined): CommandName {
  switch (command) {
    case "init":
    case "init-worktree":
    case "add":
    case "remove":
    case "status":
    case "setup":
    case "bridge":
    case "up":
    case "down":
    case "comms":
    case "ready":
    case "receiver":
    case "headless":
    case "projection":
    case "uplink":
    case "dashboard":
    case "doctor":
    case "serve":
    case "watch":
    case "gui":
    case "remote-panel":
    case "permissions":
    case "reviews":
    case "sessions":
    case "infra":
    case "windows-route-recover":
    case "app-route-freshness":
    case "comms-doctor":
    case "flow-doctor":
      return command;
    default:
      return "unknown";
  }
}

const MIN_NODE_MAJOR = 22;

function assertNodeVersion(): void {
  const major = Number(process.versions.node.split(".")[0]);
  if (Number.isFinite(major) && major < MIN_NODE_MAJOR) {
    console.error(
      `\n  x @hua-labs/tap requires Node.js ${MIN_NODE_MAJOR}+ (detected: v${process.versions.node})\n` +
        `    tap uses the global WebSocket API, which is stable in Node ${MIN_NODE_MAJOR}+.\n` +
        `    Upgrade with fnm or nvm:\n` +
        `      fnm install ${MIN_NODE_MAJOR} && fnm use ${MIN_NODE_MAJOR}\n` +
        `      nvm install ${MIN_NODE_MAJOR} && nvm use ${MIN_NODE_MAJOR}\n`,
    );
    process.exit(1);
  }
}

async function main(): Promise<void> {
  assertNodeVersion();
  const rawArgs = process.argv.slice(2);
  const { jsonMode, cleanArgs } = extractJsonFlag(rawArgs);
  resetLoggedWarnings();
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
      case "setup":
        result = await setupCommand(commandArgs);
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
      case "comms":
        result = await commsCommand(commandArgs);
        break;
      case "ready":
        result = await readyCommand(commandArgs);
        break;
      case "receiver":
        result = await receiverCommand(commandArgs);
        break;
      case "headless":
        result = await headlessCommand(commandArgs);
        break;
      case "projection":
        result = await projectionCommand(commandArgs);
        break;
      case "uplink":
        result = await uplinkCommand(commandArgs);
        break;
      case "dashboard":
        result = await dashboardCommand(commandArgs);
        break;
      case "doctor":
        result = await doctorCommand(commandArgs);
        break;
      case "watch":
        result = await watchCommand(commandArgs);
        break;
      case "gui":
        result = await guiCommand(commandArgs);
        break;
      case "remote-panel":
        result = await remotePanelCommand(commandArgs);
        break;
      case "permissions":
        result = await permissionsCommand(commandArgs);
        break;
      case "reviews":
        result = await reviewsCommand(commandArgs);
        break;
      case "sessions":
        result = await sessionsCommand(commandArgs);
        break;
      case "infra":
        result = await infraCommand(commandArgs);
        break;
      case "windows-route-recover":
        result = await windowsRouteRecoverCommand(commandArgs);
        break;
      case "app-route-freshness":
        result = await appRouteFreshnessCommand(commandArgs);
        break;
      case "comms-doctor":
        result = await commsDoctorCommand(commandArgs);
        break;
      case "flow-doctor":
        result = await flowDoctorCommand(commandArgs);
        break;
      case "serve": {
        // serve takes over stdio for MCP protocol — don't emit result on stdout
        const serveResult = await serveCommand(commandArgs);
        if (!serveResult.ok || serveResult.code === "TAP_NO_OP") {
          // Emit on error OR help (help returns ok+TAP_NO_OP but needs output)
          emitResult(serveResult, jsonMode);
        }
        process.exit(exitCode(serveResult));
        break;
      }
      default: {
        const suggestion = suggestCommand(command);
        const hint = suggestion
          ? `\n\nDid you mean: tap ${suggestion}?`
          : "\n\nRun tap --help for a list of commands.";
        result = {
          ok: false,
          command: "unknown",
          code: "TAP_INVALID_ARGUMENT",
          message: `Unknown command: ${command}${hint}`,
          warnings: [],
          data: { requestedCommand: command, suggestion },
        };
        break;
      }
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
