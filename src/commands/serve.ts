import * as path from "node:path";
import { spawn } from "node:child_process";
import { buildManagedMcpServerSpec } from "../adapters/common.js";
import { createAdapterContext, findRepoRoot, log } from "../utils.js";
import { loadState } from "../state.js";
import type { CommandResult } from "../types.js";

const SERVE_HELP = `
Usage:
  tap serve [options]

Description:
  Start the tap MCP server over stdio. This command takes over the
  process — it is intended to be launched by an MCP host (e.g. Claude Code).

Options:
  --comms-dir <path>    Override comms directory (also reads TAP_COMMS_DIR env)
  --help, -h            Show help

Examples:
  npx @hua-labs/tap serve
  npx @hua-labs/tap serve --comms-dir /shared/comms
`.trim();

/**
 * serve is special: it takes over the process on success.
 * Only returns a CommandResult on error.
 */
export async function serveCommand(args: string[]): Promise<CommandResult> {
  if (args.includes("--help") || args.includes("-h")) {
    log(SERVE_HELP);
    return {
      ok: true,
      command: "serve",
      code: "TAP_NO_OP",
      message: SERVE_HELP,
      warnings: [],
      data: {},
    };
  }

  const repoRoot = findRepoRoot();

  let commsDir: string | undefined;

  const commsDirIdx = args.indexOf("--comms-dir");
  if (commsDirIdx !== -1 && args[commsDirIdx + 1]) {
    commsDir = path.resolve(args[commsDirIdx + 1]);
  }

  if (!commsDir && process.env.TAP_COMMS_DIR) {
    commsDir = process.env.TAP_COMMS_DIR;
  }

  if (!commsDir) {
    const state = loadState(repoRoot);
    if (state) {
      commsDir = state.commsDir;
    }
  }

  if (!commsDir) {
    return {
      ok: false,
      command: "serve",
      code: "TAP_NOT_INITIALIZED",
      message:
        "Cannot determine comms directory. Set TAP_COMMS_DIR env var, use --comms-dir, or run 'init' first.",
      warnings: [],
      data: {},
    };
  }

  const ctx = createAdapterContext(commsDir, repoRoot);
  const managed = buildManagedMcpServerSpec(ctx);
  if (!managed.command || !managed.sourcePath) {
    const fallbackMessage =
      managed.issues[0] ??
      "tap-comms MCP server not found. Reinstall @hua-labs/tap or run from a repo with packages/tap-plugin/channels/.";
    return {
      ok: false,
      command: "serve",
      code: managed.sourcePath
        ? "TAP_SERVE_BUN_REQUIRED"
        : "TAP_SERVE_NO_SERVER",
      message: fallbackMessage,
      warnings: [],
      data: {},
    };
  }

  // For serve, always use direct path (not npx launcher which would recurse)
  const serveCommand = managed.command === "npx" ? "node" : managed.command;
  const serveArgs =
    managed.command === "npx" && managed.sourcePath
      ? [managed.sourcePath]
      : managed.args;

  // Start MCP server
  const child = spawn(serveCommand, serveArgs, {
    stdio: "inherit",
    env: {
      ...process.env,
      TAP_COMMS_DIR: commsDir,
    },
  });

  return new Promise((resolve) => {
    child.on("error", (err) => {
      resolve({
        ok: false,
        command: "serve",
        code: "TAP_INTERNAL_ERROR",
        message: `Failed to start MCP server: ${err.message}`,
        warnings: [],
        data: {},
      });
    });

    child.on("exit", (code) => {
      resolve({
        ok: code === 0,
        command: "serve",
        code: code === 0 ? "TAP_SERVE_OK" : "TAP_INTERNAL_ERROR",
        message:
          code === 0
            ? "MCP server stopped"
            : `MCP server exited with code ${code}`,
        warnings: [],
        data: { exitCode: code },
      });
    });
  });
}
