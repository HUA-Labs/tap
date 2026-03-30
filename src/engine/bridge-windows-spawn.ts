/**
 * Windows detached background spawn utilities for bridge/app-server processes.
 *
 * Extracted from engine/bridge.ts (Phase 3) to isolate wrapper generation,
 * hidden PowerShell launch, and listening PID discovery.
 *
 * @module engine/bridge-windows-spawn
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import type { Platform } from "../types.js";
import { stderrLogFilePath } from "./bridge-paths.js";
import {
  toPowerShellSingleQuotedString,
  toPowerShellStringArrayLiteral,
  removeFileIfExists,
} from "./bridge-file-io.js";
import {
  resolvePowerShellCommand,
  splitResolvedCommand,
} from "./bridge-codex-command.js";
import { delay } from "./bridge-port-network.js";

const WINDOWS_SPAWN_WRAPPER_PREFIX = "tap-spawn-";
const WINDOWS_SPAWN_WRAPPER_STALE_MS = 60 * 60 * 1000;
export const WINDOWS_DETACHED_LIVENESS_TIMEOUT_MS = 1_500;
export const WINDOWS_DETACHED_LIVENESS_POLL_MS = 100;

export function cleanupStaleWindowsSpawnWrappers(now = Date.now()): void {
  let entries: string[];
  try {
    entries = fs.readdirSync(os.tmpdir());
  } catch {
    return;
  }

  for (const entry of entries) {
    if (
      !entry.startsWith(WINDOWS_SPAWN_WRAPPER_PREFIX) ||
      !/\.(cmd|ps1)$/i.test(entry)
    ) {
      continue;
    }

    const wrapperPath = path.join(os.tmpdir(), entry);

    try {
      const stats = fs.statSync(wrapperPath);
      if (now - stats.mtimeMs < WINDOWS_SPAWN_WRAPPER_STALE_MS) {
        continue;
      }
      fs.unlinkSync(wrapperPath);
    } catch {
      // Best-effort cleanup only.
    }
  }
}

export function buildWindowsDetachedWrapperScript(
  command: string,
  args: string[],
  logPath: string,
  stderrLogPath: string,
  env: NodeJS.ProcessEnv,
): string {
  const lines = ["$ErrorActionPreference = 'Stop'"];

  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined && value !== process.env[key]) {
      lines.push(
        `[Environment]::SetEnvironmentVariable(${toPowerShellSingleQuotedString(key)}, ${toPowerShellSingleQuotedString(value)}, 'Process')`,
      );
    }
  }

  lines.push(
    `$logPath = ${toPowerShellSingleQuotedString(logPath)}`,
    `$stderrLogPath = ${toPowerShellSingleQuotedString(stderrLogPath)}`,
    `$commandPath = ${toPowerShellSingleQuotedString(command)}`,
    `$commandArgs = ${toPowerShellStringArrayLiteral(args)}`,
    "$exitCode = 1",
    "try {",
    "  & $commandPath @commandArgs >> $logPath 2>> $stderrLogPath",
    "  $exitCode = if ($null -ne $LASTEXITCODE) { $LASTEXITCODE } else { 0 }",
    "} finally {",
    "  Remove-Item -LiteralPath $PSCommandPath -Force -ErrorAction SilentlyContinue",
    "}",
    "exit $exitCode",
  );

  return `${lines.join("\r\n")}\r\n`;
}

/**
 * Start a background process on Windows without creating a visible console window.
 *
 * Node.js `spawn({ detached: true })` sets `DETACHED_PROCESS` in CreateProcess,
 * which forces Windows to allocate a new console for console apps — even with
 * `windowsHide: true` (which only sets SW_HIDE, not CREATE_NO_WINDOW).
 * These two flags are mutually exclusive in the Windows API.
 *
 * Instead, we use PowerShell `Start-Process -WindowStyle Hidden` which internally
 * sets `ProcessStartInfo.CreateNoWindow = true`, preventing console allocation
 * entirely. A temp `.ps1` wrapper handles environment variables, robust argument
 * passing, append-mode log redirection, and self-cleans on normal exit.
 *
 * The returned PID is of the hidden PowerShell wrapper process, which stays alive
 * while the child runs.
 * `taskkill /PID <pid> /F /T` kills the entire tree.
 */
export function startWindowsDetachedProcess(
  command: string,
  args: string[],
  repoRoot: string,
  logPath: string,
  env: NodeJS.ProcessEnv = process.env,
): number | null {
  const stderrLogPath = stderrLogFilePath(logPath);
  const powerShellCommand = resolvePowerShellCommand();

  cleanupStaleWindowsSpawnWrappers();

  const wrapperPath = path.join(
    os.tmpdir(),
    `${WINDOWS_SPAWN_WRAPPER_PREFIX}${randomBytes(4).toString("hex")}.ps1`,
  );
  fs.writeFileSync(
    wrapperPath,
    buildWindowsDetachedWrapperScript(
      command,
      args,
      logPath,
      stderrLogPath,
      env,
    ),
  );

  const psCommand = [
    "$p = Start-Process",
    `-FilePath ${toPowerShellSingleQuotedString(powerShellCommand)}`,
    `-ArgumentList ${toPowerShellStringArrayLiteral(["-NoLogo", "-NoProfile", "-File", wrapperPath])}`,
    `-WorkingDirectory ${toPowerShellSingleQuotedString(repoRoot)}`,
    "-WindowStyle Hidden",
    "-PassThru",
    "; Write-Output $p.Id",
  ].join(" ");

  const result = spawnSync(
    powerShellCommand,
    ["-NoLogo", "-NoProfile", "-Command", psCommand],
    {
      encoding: "utf-8",
      windowsHide: true,
    },
  );

  if (result.status !== 0) {
    removeFileIfExists(wrapperPath);
    return null;
  }

  const pid = parseInt(result.stdout.trim(), 10);
  if (!Number.isFinite(pid)) {
    removeFileIfExists(wrapperPath);
    return null;
  }

  return pid;
}

/**
 * PowerShell hidden-spawn returns before we know whether the wrapper survives.
 * Treat the spawn as successful only if the wrapper PID stays alive for a
 * short grace period; otherwise bridge startup reports a false positive.
 */
export async function waitForWindowsDetachedProcessLiveness(
  pid: number,
  timeoutMs: number = WINDOWS_DETACHED_LIVENESS_TIMEOUT_MS,
  pollMs: number = WINDOWS_DETACHED_LIVENESS_POLL_MS,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
    } catch {
      return false;
    }

    await delay(pollMs);
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function startWindowsCodexAppServer(
  command: string,
  url: string,
  repoRoot: string,
  logPath: string,
): number | null {
  const { command: exe, prefixArgs } = splitResolvedCommand(command);
  return startWindowsDetachedProcess(
    exe,
    [...prefixArgs, "app-server", "--listen", url],
    repoRoot,
    logPath,
  );
}

export function findListeningProcessId(
  url: string,
  platform: Platform,
): number | null {
  if (platform !== "win32") {
    return null;
  }

  let port: number | null;
  try {
    const parsed = new URL(url);
    port = parsed.port ? Number.parseInt(parsed.port, 10) : null;
  } catch {
    return null;
  }

  if (port == null || !Number.isFinite(port)) {
    return null;
  }

  const result = spawnSync(
    resolvePowerShellCommand(),
    [
      "-NoLogo",
      "-NoProfile",
      "-Command",
      [
        `$port = ${port}`,
        "$processId = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty OwningProcess",
        "if ($processId) { $processId }",
      ].join("; "),
    ],
    {
      encoding: "utf-8",
      windowsHide: true,
    },
  );

  if (result.status !== 0) {
    return null;
  }

  const parsedPid = Number.parseInt((result.stdout ?? "").trim(), 10);
  return Number.isFinite(parsedPid) ? parsedPid : null;
}
