import * as fs from "node:fs";
import * as path from "node:path";
import { execSync, spawn } from "node:child_process";
import { findRepoRoot } from "../utils.js";
import { loadState } from "../state.js";
import type { CommandResult } from "../types.js";

function findServerEntry(repoRoot: string): string | null {
  const candidates = [
    path.join(repoRoot, "packages", "tap-plugin", "channels", "tap-comms.ts"),
    path.join(
      repoRoot,
      "node_modules",
      "@hua-labs",
      "tap-plugin",
      "channels",
      "tap-comms.ts",
    ),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function isBunInstalled(): boolean {
  try {
    execSync("bun --version", { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

/**
 * serve is special: it takes over the process on success.
 * Only returns a CommandResult on error.
 */
export async function serveCommand(args: string[]): Promise<CommandResult> {
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

  if (!isBunInstalled()) {
    return {
      ok: false,
      command: "serve",
      code: "TAP_SERVE_BUN_REQUIRED",
      message:
        "bun is required to run the tap-comms MCP server. Install: https://bun.sh",
      warnings: [],
      data: {},
    };
  }

  const serverEntry = findServerEntry(repoRoot);
  if (!serverEntry) {
    return {
      ok: false,
      command: "serve",
      code: "TAP_SERVE_NO_SERVER",
      message:
        "tap-comms MCP server not found. Run from a repo with packages/tap-plugin/channels/.",
      warnings: [],
      data: {},
    };
  }

  // Start MCP server — takes over the process
  const child = spawn("bun", [serverEntry], {
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
