import * as fs from "node:fs";
import * as path from "node:path";
import type {
  AdapterContext,
  CommandCode,
  InstanceId,
  Platform,
  RuntimeName,
  TapState,
} from "./types.js";
import { resolveConfig } from "./config/index.js";

const VALID_RUNTIMES: RuntimeName[] = ["claude", "codex", "gemini"];

export function isValidRuntime(name: string): name is RuntimeName {
  return VALID_RUNTIMES.includes(name as RuntimeName);
}

export function detectPlatform(): Platform {
  return process.platform as Platform;
}

export function findRepoRoot(startDir: string = process.cwd()): string {
  let dir = path.resolve(startDir);
  while (true) {
    if (fs.existsSync(path.join(dir, ".git"))) return dir;
    if (fs.existsSync(path.join(dir, "package.json"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

export function resolveCommsDir(args: string[], repoRoot: string): string {
  // Check --comms-dir flag
  const idx = args.indexOf("--comms-dir");
  if (idx !== -1 && args[idx + 1]) {
    return path.resolve(args[idx + 1]);
  }

  // Delegate to config resolution (env > local > shared > auto)
  const { config } = resolveConfig({}, repoRoot);
  return config.commsDir;
}

export function createAdapterContext(
  commsDir: string,
  repoRoot: string,
): AdapterContext {
  // Use config-resolved stateDir if available
  const { config } = resolveConfig({}, repoRoot);
  return {
    commsDir: path.resolve(commsDir),
    repoRoot: path.resolve(repoRoot),
    stateDir: config.stateDir,
    platform: detectPlatform(),
  };
}

export function parseArgs(args: string[]): {
  positional: string[];
  flags: Record<string, string | boolean>;
} {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else if (arg.startsWith("-")) {
      flags[arg.slice(1)] = true;
    } else {
      positional.push(arg);
    }
  }

  return { positional, flags };
}

// ─── JSON mode suppression ──────────────────────────────────────

let _jsonMode = false;

export function setJsonMode(enabled: boolean): void {
  _jsonMode = enabled;
}

export function log(message: string): void {
  if (!_jsonMode) console.log(`  ${message}`);
}

export function logSuccess(message: string): void {
  if (!_jsonMode) console.log(`  + ${message}`);
}

export function logWarn(message: string): void {
  if (!_jsonMode) console.log(`  ! ${message}`);
}

export function logError(message: string): void {
  if (!_jsonMode) console.error(`  x ${message}`);
}

export function logHeader(message: string): void {
  if (!_jsonMode) console.log(`\n  ${message}\n`);
}

// ─── Instance ID utilities ─────────────────────────────────────

export type ResolveResult =
  | { ok: true; instanceId: InstanceId }
  | { ok: false; code: CommandCode; message: string };

/**
 * Resolve a user-provided identifier to an instance ID.
 * Accepts either an exact instance ID or a runtime name (if unambiguous).
 */
export function resolveInstanceId(
  identifier: string,
  state: TapState,
): ResolveResult {
  // Exact match
  if (state.instances[identifier]) {
    return { ok: true, instanceId: identifier };
  }

  // Runtime name → find matching instances
  if (isValidRuntime(identifier)) {
    const matches = Object.values(state.instances).filter(
      (inst) => inst.runtime === identifier,
    );

    if (matches.length === 1) {
      return { ok: true, instanceId: matches[0].instanceId };
    }

    if (matches.length > 1) {
      const ids = matches.map((m) => m.instanceId).join(", ");
      return {
        ok: false,
        code: "TAP_INSTANCE_AMBIGUOUS",
        message: `Multiple ${identifier} instances found: ${ids}. Specify one explicitly.`,
      };
    }
  }

  return {
    ok: false,
    code: "TAP_INSTANCE_NOT_FOUND",
    message: `Instance not found: ${identifier}`,
  };
}

/** Build an instance ID from runtime + optional name. */
export function buildInstanceId(
  runtime: RuntimeName,
  name?: string,
): InstanceId {
  return name ? `${runtime}-${name}` : runtime;
}

/** Extract the runtime name from an instance ID. */
export function extractRuntimeFromInstanceId(id: InstanceId): RuntimeName {
  for (const r of VALID_RUNTIMES) {
    if (id === r || id.startsWith(`${r}-`)) return r;
  }
  throw new Error(`Cannot extract runtime from instance ID: ${id}`);
}

/** Check if a port is already claimed by another instance. */
export function findPortConflict(
  state: TapState,
  port: number,
  excludeInstanceId?: InstanceId,
): InstanceId | null {
  for (const [id, inst] of Object.entries(state.instances)) {
    if (id !== excludeInstanceId && inst.port === port) return id;
  }
  return null;
}
