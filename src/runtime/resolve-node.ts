/**
 * Common Node.js runtime resolver for all tap-comms child processes.
 *
 * Resolution chain:
 *   .node-version + fnm probe → configured command → tsx fallback
 *
 * Extracted from codex-bridge-runner.ts (M69) to share across:
 *   - bridge engine spawn
 *   - bridge runner spawn
 *   - future CLI commands
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { execSync } from "node:child_process";

// ─── Types ─────────────────────────────────────────────────────

export type RuntimeSource = "fnm" | "config" | "path" | "tsx-fallback" | "bun";

export interface ResolvedRuntime {
  /** Absolute path or command name for the resolved runtime. */
  command: string;
  /** Whether --experimental-strip-types is supported and should be used. */
  supportsStripTypes: boolean;
  /** Where the runtime was resolved from (for diagnostics). */
  source: RuntimeSource;
  /** Detected major version, if available. */
  majorVersion: number | null;
}

// ─── .node-version ─────────────────────────────────────────────

export function readNodeVersion(repoRoot: string): string | null {
  const nvFile = path.join(repoRoot, ".node-version");
  if (!fs.existsSync(nvFile)) return null;
  try {
    const raw = fs.readFileSync(nvFile, "utf-8").trim();
    return raw.length > 0 ? raw.replace(/^v/, "") : null;
  } catch {
    return null;
  }
}

// ─── fnm probe ─────────────────────────────────────────────────

function fnmCandidateDirs(): string[] {
  if (process.platform === "win32") {
    return [
      process.env.FNM_DIR,
      process.env.APPDATA ? path.join(process.env.APPDATA, "fnm") : null,
      process.env.LOCALAPPDATA
        ? path.join(process.env.LOCALAPPDATA, "fnm")
        : null,
      process.env.USERPROFILE
        ? path.join(process.env.USERPROFILE, "scoop", "persist", "fnm")
        : null,
    ].filter(Boolean) as string[];
  }
  // macOS / Linux
  return [
    process.env.FNM_DIR,
    process.env.HOME
      ? path.join(process.env.HOME, ".local", "share", "fnm")
      : null,
    process.env.HOME ? path.join(process.env.HOME, ".fnm") : null,
    process.env.XDG_DATA_HOME
      ? path.join(process.env.XDG_DATA_HOME, "fnm")
      : null,
  ].filter(Boolean) as string[];
}

function nodeExecutableName(): string {
  return process.platform === "win32" ? "node.exe" : "node";
}

export function probeFnmNode(desiredVersion: string): string | null {
  const dirs = fnmCandidateDirs();
  const exe = nodeExecutableName();

  for (const baseDir of dirs) {
    const candidate = path.join(
      baseDir,
      "node-versions",
      `v${desiredVersion}`,
      "installation",
      exe,
    );
    if (!fs.existsSync(candidate)) continue;

    try {
      const v = execSync(`"${candidate}" --version`, {
        encoding: "utf-8",
        timeout: 5000,
      }).trim();
      if (v.startsWith(`v${desiredVersion.split(".")[0]}.`)) {
        return candidate;
      }
    } catch {
      // candidate exists but doesn't work — skip
    }
  }

  return null;
}

// ─── Version detection ─────────────────────────────────────────

export function detectNodeMajorVersion(command: string): number | null {
  try {
    const version = execSync(`"${command}" --version`, {
      encoding: "utf-8",
      timeout: 5000,
    }).trim();
    const match = version.match(/^v?(\d+)\./);
    return match ? parseInt(match[1], 10) : null;
  } catch {
    return null;
  }
}

export function checkStripTypesSupport(command: string): boolean {
  const major = detectNodeMajorVersion(command);
  if (major !== null && major >= 22) return true;
  try {
    execSync(`"${command}" --experimental-strip-types -e ""`, {
      timeout: 5000,
      stdio: "pipe",
    });
    return true;
  } catch {
    return false;
  }
}

// ─── tsx fallback ──────────────────────────────────────────────

export function findTsxFallback(repoRoot: string): string | null {
  const candidates = [
    path.join(repoRoot, "node_modules", ".bin", "tsx.exe"),
    path.join(repoRoot, "node_modules", ".bin", "tsx.CMD"),
    path.join(repoRoot, "node_modules", ".bin", "tsx"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

// ─── fnm bin directory (for PATH prepending) ───────────────────

/**
 * Returns the directory containing the fnm-managed node binary,
 * suitable for prepending to PATH in child processes.
 */
export function getFnmBinDir(repoRoot: string): string | null {
  const desiredVersion = readNodeVersion(repoRoot);
  if (!desiredVersion) return null;

  const nodePath = probeFnmNode(desiredVersion);
  if (!nodePath) return null;

  return path.dirname(nodePath);
}

// ─── Main resolver ─────────────────────────────────────────────

/**
 * Resolve the Node.js runtime to use for spawning child processes.
 *
 * Priority: bun passthrough → .node-version + fnm → configured command → tsx fallback
 */
export function resolveNodeRuntime(
  configCommand: string,
  repoRoot: string,
): ResolvedRuntime {
  // Bun: native TS support, no strip-types needed
  if (configCommand === "bun" || configCommand.endsWith("bun.exe")) {
    return {
      command: configCommand,
      supportsStripTypes: false,
      source: "bun",
      majorVersion: null,
    };
  }

  // .node-version + fnm discovery
  const desiredVersion = readNodeVersion(repoRoot);
  if (desiredVersion) {
    const fnmNode = probeFnmNode(desiredVersion);
    if (fnmNode) {
      const major = detectNodeMajorVersion(fnmNode);
      return {
        command: fnmNode,
        supportsStripTypes: checkStripTypesSupport(fnmNode),
        source: "fnm",
        majorVersion: major,
      };
    }
  }

  // Configured command (from config or PATH)
  const major = detectNodeMajorVersion(configCommand);
  if (major !== null) {
    return {
      command: configCommand,
      supportsStripTypes: checkStripTypesSupport(configCommand),
      source: major === detectNodeMajorVersion("node") ? "path" : "config",
      majorVersion: major,
    };
  }

  // tsx fallback
  const tsx = findTsxFallback(repoRoot);
  if (tsx) {
    return {
      command: tsx,
      supportsStripTypes: false,
      source: "tsx-fallback",
      majorVersion: null,
    };
  }

  // Last resort
  return {
    command: configCommand,
    supportsStripTypes: false,
    source: "path",
    majorVersion: null,
  };
}

// ─── Env builder for child processes ───────────────────────────

/**
 * Build an env object with fnm Node prepended to PATH.
 * Use this when spawning child processes that need the correct Node.
 */
export function buildRuntimeEnv(
  repoRoot: string,
  baseEnv: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const fnmBin = getFnmBinDir(repoRoot);
  if (!fnmBin) return { ...baseEnv };

  const pathKey = process.platform === "win32" ? "Path" : "PATH";
  const currentPath = baseEnv[pathKey] ?? baseEnv.PATH ?? "";

  return {
    ...baseEnv,
    [pathKey]: `${fnmBin}${path.delimiter}${currentPath}`,
  };
}
