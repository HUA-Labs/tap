import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import type { AdapterContext } from "../types.js";

export interface CommandProbe {
  command: string | null;
  version: string | null;
}

export interface ManagedMcpServerSpec {
  command: string | null;
  args: string[];
  env: Record<string, string>;
  sourcePath: string | null;
  warnings: string[];
  issues: string[];
}

export function probeCommand(candidates: string[]): CommandProbe {
  for (const candidate of candidates) {
    const result = spawnSync(candidate, ["--version"], {
      encoding: "utf-8",
      shell: process.platform === "win32",
    });

    if (result.status === 0) {
      const version =
        `${result.stdout ?? ""}${result.stderr ?? ""}`.trim() || null;
      return { command: candidate, version };
    }
  }

  return { command: null, version: null };
}

export function getHomeDir(): string {
  return os.homedir();
}

export function toForwardSlashPath(filePath: string): string {
  return path.resolve(filePath).replace(/\\/g, "/");
}

export function canWriteOrCreate(filePath: string): boolean {
  try {
    if (fs.existsSync(filePath)) {
      fs.accessSync(filePath, fs.constants.W_OK);
      return true;
    }

    const parent = path.dirname(filePath);
    fs.mkdirSync(parent, { recursive: true });
    fs.accessSync(parent, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

export function findLocalTapCommsSource(ctx: AdapterContext): string | null {
  const candidates = [
    path.join(
      ctx.repoRoot,
      "packages",
      "tap-plugin",
      "channels",
      "tap-comms.ts",
    ),
    path.join(
      ctx.repoRoot,
      "node_modules",
      "@hua-labs",
      "tap-plugin",
      "channels",
      "tap-comms.ts",
    ),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  return null;
}

export function findPreferredBunCommand(): string | null {
  const home = getHomeDir();
  const candidates =
    process.platform === "win32"
      ? [path.join(home, ".bun", "bin", "bun.exe"), "bun", "bun.cmd"]
      : [path.join(home, ".bun", "bin", "bun"), "bun"];

  for (const candidate of candidates) {
    if (path.isAbsolute(candidate) && !fs.existsSync(candidate)) continue;

    const result = spawnSync(candidate, ["--version"], {
      encoding: "utf-8",
      shell: process.platform === "win32",
    });
    if (result.status === 0) {
      return path.isAbsolute(candidate)
        ? toForwardSlashPath(candidate)
        : candidate;
    }
  }

  return null;
}

export function buildManagedMcpServerSpec(
  ctx: AdapterContext,
): ManagedMcpServerSpec {
  const sourcePath = findLocalTapCommsSource(ctx);
  const bunCommand = findPreferredBunCommand();
  const warnings: string[] = [];
  const issues: string[] = [];

  if (sourcePath && bunCommand) {
    return {
      command: bunCommand,
      args: [toForwardSlashPath(sourcePath)],
      env: {
        TAP_AGENT_NAME: "<set-per-session>",
        TAP_COMMS_DIR: toForwardSlashPath(ctx.commsDir),
      },
      sourcePath,
      warnings,
      issues,
    };
  }

  if (!sourcePath) {
    issues.push(
      "tap-comms MCP server source not found. v1 requires a repo-local tap-plugin/channels installation.",
    );
  }

  if (!bunCommand) {
    issues.push("bun is required to run the repo-local tap-comms MCP server.");
  }

  return {
    command: null,
    args: [],
    env: {
      TAP_AGENT_NAME: "<set-per-session>",
      TAP_COMMS_DIR: toForwardSlashPath(ctx.commsDir),
    },
    sourcePath,
    warnings,
    issues,
  };
}
