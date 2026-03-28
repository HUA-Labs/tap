import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { Platform } from "../types.js";
import { probeCommand } from "../adapters/common.js";

/**
 * Resolve the codex CLI command for the given platform.
 *
 * On Windows, npm-installed `codex.cmd` wrappers launch through cmd.exe,
 * which prevents PowerShell `Start-Process -WindowStyle Hidden` from properly
 * detaching the app-server process. When a `.cmd` wrapper is found, we parse
 * it to extract the underlying `node <script>` invocation and return that
 * instead, so the caller can spawn node directly.
 */
export function resolveCodexCommand(platform: Platform): string | null {
  const candidates =
    platform === "win32"
      ? ["codex.cmd", "codex.exe", "codex", "codex.ps1"]
      : ["codex"];
  const resolved = probeCommand(candidates).command;
  if (!resolved) return null;

  // Unwrap .cmd wrappers on Windows to avoid cmd.exe intermediate shell.
  // probeCommand() now returns absolute paths, so resolved is already
  // e.g. "C:\Users\...\npm\codex.cmd" — no extra where.exe lookup needed.
  if (platform === "win32" && resolved.endsWith(".cmd")) {
    const unwrapped = unwrapNpmCmdShim(resolved);
    if (unwrapped) return unwrapped;
  }

  return resolved;
}

/**
 * Parse an npm `.cmd` shim to extract the node + script path.
 *
 * npm `.cmd` shims follow this pattern:
 * ```
 * "%_prog%" "%dp0%\node_modules\...\bin\script.js" %*
 * ```
 *
 * Returns a space-separated `"node /abs/path/to/script.js"` string that
 * callers can split on the first space, or null if parsing fails.
 */
export function unwrapNpmCmdShim(cmdPath: string): string | null {
  let content: string;
  try {
    content = fs.readFileSync(cmdPath, "utf-8");
  } catch {
    return null;
  }

  // Match the final line: "%_prog%" "%dp0%\...\script.js" %*
  // npm shims use %dp0% (directory of the .cmd file) as base
  const match = content.match(
    /"%_prog%"\s+"(%dp0%\\[^"]+)"\s+%\*/,
  );
  if (!match) return null;

  const dp0 = path.dirname(cmdPath);
  const scriptRelative = match[1].replace(/%dp0%\\/g, "");
  const scriptPath = path.resolve(dp0, scriptRelative);

  if (!fs.existsSync(scriptPath)) return null;

  // Resolve node: prefer the local node next to the .cmd, else PATH node
  const localNode = path.join(dp0, "node.exe");
  const nodeCommand = fs.existsSync(localNode)
    ? localNode
    : (probeCommand(["node.exe", "node"]).command ?? "node");

  return `${nodeCommand}\0${scriptPath}`;
}

/**
 * Split a resolved codex command into executable + prefix args.
 * If the command contains a NUL separator (from unwrapNpmCmdShim),
 * split on it. Otherwise return as-is with empty prefix args.
 */
export function splitResolvedCommand(resolved: string): {
  command: string;
  prefixArgs: string[];
} {
  const parts = resolved.split("\0");
  if (parts.length === 2) {
    return { command: parts[0], prefixArgs: [parts[1]] };
  }
  return { command: resolved, prefixArgs: [] };
}

export function resolvePowerShellCommand(): string {
  return (
    probeCommand(["pwsh", "powershell", "powershell.exe"]).command ??
    "powershell"
  );
}

export function resolveAuthGatewayScript(repoRoot: string): string | null {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    // Bundled: dist/bridges/ sibling (npm install / built package)
    path.join(moduleDir, "bridges", "codex-app-server-auth-gateway.mjs"),
    // Source: src/bridges/ sibling (monorepo dev with ts runner)
    path.join(moduleDir, "bridges", "codex-app-server-auth-gateway.ts"),
    // Monorepo dist fallback
    path.join(
      repoRoot,
      "packages",
      "tap-comms",
      "dist",
      "bridges",
      "codex-app-server-auth-gateway.mjs",
    ),
    path.join(
      repoRoot,
      "packages",
      "tap-comms",
      "src",
      "bridges",
      "codex-app-server-auth-gateway.ts",
    ),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}
