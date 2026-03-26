import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
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

/** Detect paths that are ephemeral (npm _npx cache, fnm multishell, temp dirs). */
function isEphemeralPath(p: string): boolean {
  const normalized = p.replace(/\\/g, "/").toLowerCase();
  return (
    normalized.includes("/_npx/") ||
    normalized.includes("\\_npx\\") ||
    normalized.includes("/fnm_multishells/") ||
    normalized.includes("\\fnm_multishells\\") ||
    normalized.includes("/tmp/") ||
    normalized.includes("\\temp\\")
  );
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

export function findBundledTapCommsSource(
  metaUrl: string = import.meta.url,
): string | null {
  const moduleDir = path.dirname(fileURLToPath(metaUrl));
  const candidates = [
    path.join(moduleDir, "mcp-server.mjs"),
    path.join(moduleDir, "..", "mcp-server.mjs"),
    path.join(moduleDir, "..", "mcp-server.ts"),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  return null;
}

export function findTapCommsServerEntry(
  ctx: AdapterContext,
  metaUrl: string = import.meta.url,
): string | null {
  return findBundledTapCommsSource(metaUrl) ?? findLocalTapCommsSource(ctx);
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
  instanceId?: string,
): ManagedMcpServerSpec {
  const sourcePath = findTapCommsServerEntry(ctx);
  const bunCommand = findPreferredBunCommand();
  const warnings: string[] = [];
  const issues: string[] = [];

  const env: Record<string, string> = {
    TAP_AGENT_NAME: ctx.agentName ?? "<set-per-session>",
    TAP_COMMS_DIR: toForwardSlashPath(ctx.commsDir),
    TAP_STATE_DIR: toForwardSlashPath(ctx.stateDir),
    TAP_REPO_ROOT: toForwardSlashPath(ctx.repoRoot),
  };
  if (instanceId) {
    env.TAP_AGENT_ID = instanceId;
  }

  if (!sourcePath) {
    issues.push(
      "tap-comms MCP server entry not found. Reinstall @hua-labs/tap or run from a repo with packages/tap-plugin/channels/ available.",
    );
    return { command: null, args: [], env, sourcePath, warnings, issues };
  }

  // Prefer bun for .ts source files; for compiled .mjs, node works too
  const isBundled = sourcePath.endsWith(".mjs");
  const isEphemeralSource = isEphemeralPath(sourcePath);
  let command: string | null = bunCommand;
  let args: string[] = [toForwardSlashPath(sourcePath)];

  // Ephemeral source path (npx cache) → always use stable launcher, even with bun
  // This prevents persisting _npx cache paths in .mcp.json / config.toml
  if (isEphemeralSource && isBundled) {
    command = "npx";
    args = ["@hua-labs/tap", "serve"];
    warnings.push(
      "Detected npx cache path. Using `npx @hua-labs/tap serve` as stable MCP launcher.",
    );
  } else if (!command && isBundled) {
    // No bun, bundled .mjs — check node path stability
    const isEphemeralNode = isEphemeralPath(process.execPath);

    if (isEphemeralNode) {
      // fnm multishell node → use bare `node` (resolved from PATH at runtime)
      command = "node";
      warnings.push(
        "Detected ephemeral node path. Using `node` from PATH for MCP config stability.",
      );
    } else {
      command = toForwardSlashPath(process.execPath);
    }

    warnings.push(
      "bun not found; using node to run the compiled MCP server. Install bun for better performance.",
    );
  }

  if (!command) {
    issues.push(
      "bun is required to run the repo-local tap-comms MCP server (.ts source). Install bun: https://bun.sh",
    );
    return { command: null, args: [], env, sourcePath, warnings, issues };
  }

  return {
    command,
    args,
    env,
    sourcePath,
    warnings,
    issues,
  };
}
