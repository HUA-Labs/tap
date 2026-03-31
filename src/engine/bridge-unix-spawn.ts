/**
 * Unix detached background spawn utilities for bridge/app-server processes.
 *
 * Extracted from inline non-Windows spawn paths to centralize detached launch
 * and listening PID discovery for macOS/Linux.
 *
 * @module engine/bridge-unix-spawn
 */

import * as fs from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import type { Platform } from "../types.js";
import { splitResolvedCommand } from "./bridge-codex-command.js";
import { stderrLogFilePath } from "./bridge-paths.js";

const DEFAULT_UNIX_PLATFORM: Platform =
  process.platform === "darwin" ? "darwin" : "linux";

function resolveUnixSpawnCommand(
  command: string,
  args: string[],
  platform: Platform,
): { command: string; args: string[] } {
  if (platform === "linux") {
    // `nohup` keeps the child immune to SIGHUP when launched from SSH/login shells.
    return {
      command: "nohup",
      args: [command, ...args],
    };
  }

  return { command, args };
}

function findListeningPidWithLsof(port: number): number | null {
  const result = spawnSync(
    "lsof",
    ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"],
    {
      encoding: "utf-8",
      windowsHide: true,
    },
  );

  if (!result || result.status !== 0) {
    return null;
  }

  const parsedPid = Number.parseInt((result.stdout ?? "").trim(), 10);
  return Number.isFinite(parsedPid) ? parsedPid : null;
}

function findListeningPidWithSs(port: number): number | null {
  const result = spawnSync("ss", ["-ltnpH", `sport = :${port}`], {
    encoding: "utf-8",
    windowsHide: true,
  });

  if (!result || result.status !== 0) {
    return null;
  }

  const match = (result.stdout ?? "").match(/\bpid=(\d+)\b/);
  if (!match) {
    return null;
  }

  const parsedPid = Number.parseInt(match[1], 10);
  return Number.isFinite(parsedPid) ? parsedPid : null;
}

export function startUnixDetachedProcess(
  command: string,
  args: string[],
  repoRoot: string,
  logPath: string,
  env: NodeJS.ProcessEnv = process.env,
  platform: Platform = DEFAULT_UNIX_PLATFORM,
): number | null {
  const stderrPath = stderrLogFilePath(logPath);
  let logFd: number | null = null;
  let stderrFd: number | null = null;

  try {
    logFd = fs.openSync(logPath, "a");
    stderrFd = fs.openSync(stderrPath, "a");
    const launch = resolveUnixSpawnCommand(command, args, platform);

    const child = spawn(launch.command, launch.args, {
      cwd: repoRoot,
      detached: true,
      stdio: ["ignore", logFd, stderrFd],
      env,
      windowsHide: true,
    });

    child.unref();
    return child.pid ?? null;
  } finally {
    if (logFd != null) {
      fs.closeSync(logFd);
    }
    if (stderrFd != null) {
      fs.closeSync(stderrFd);
    }
  }
}

export function startUnixCodexAppServer(
  command: string,
  url: string,
  repoRoot: string,
  logPath: string,
  platform: Platform = DEFAULT_UNIX_PLATFORM,
): number | null {
  const { command: exe, prefixArgs } = splitResolvedCommand(command);
  return startUnixDetachedProcess(
    exe,
    [...prefixArgs, "app-server", "--listen", url],
    repoRoot,
    logPath,
    process.env,
    platform,
  );
}

export function findUnixListeningProcessId(
  url: string,
  platform: Platform,
): number | null {
  if (platform === "win32") {
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

  if (platform === "linux") {
    const ssPid = findListeningPidWithSs(port);
    if (ssPid != null) {
      return ssPid;
    }
  }

  return findListeningPidWithLsof(port);
}
