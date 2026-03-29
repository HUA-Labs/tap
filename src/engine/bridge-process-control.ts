import { execSync, spawnSync } from "node:child_process";
import type { AppServerState, Platform } from "../types.js";
import { delay } from "./bridge-port-network.js";
import { removeFileIfExists } from "./bridge-file-io.js";

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function getUnixProcessGroupId(pid: number): number | null {
  const result = spawnSync("ps", ["-o", "pgid=", "-p", String(pid)], {
    encoding: "utf-8",
    windowsHide: true,
  });

  if (!result || result.status !== 0) {
    return null;
  }

  const parsed = Number.parseInt((result.stdout ?? "").trim(), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function isUnixProcessGroupAlive(processGroupId: number): boolean {
  try {
    process.kill(-processGroupId, 0);
    return true;
  } catch {
    return false;
  }
}

export async function terminateProcess(
  pid: number,
  platform: Platform,
): Promise<boolean> {
  if (!isProcessAlive(pid)) {
    return false;
  }

  try {
    if (platform === "win32") {
      execSync(`taskkill /PID ${pid} /F /T`, { stdio: "pipe" });
    } else {
      const processGroupId = getUnixProcessGroupId(pid);
      const signalTarget = processGroupId != null ? -processGroupId : pid;
      const isTargetAlive = (): boolean =>
        processGroupId != null
          ? isUnixProcessGroupAlive(processGroupId)
          : isProcessAlive(pid);

      process.kill(signalTarget, "SIGTERM");
      await delay(2_000);
      if (isTargetAlive()) {
        process.kill(signalTarget, "SIGKILL");
        await delay(500);
      }

      return !isTargetAlive();
    }
  } catch {
    // Best effort. The caller only needs a boolean outcome.
  }

  return !isProcessAlive(pid);
}

export async function stopManagedAppServer(
  appServer: AppServerState,
  platform: Platform,
): Promise<boolean> {
  if (!appServer.managed) {
    return false;
  }

  let stopped = false;
  if (appServer.auth?.gatewayPid != null) {
    stopped =
      (await terminateProcess(appServer.auth.gatewayPid, platform)) || stopped;
  }
  if (appServer.pid != null) {
    stopped = (await terminateProcess(appServer.pid, platform)) || stopped;
  }
  removeFileIfExists(appServer.auth?.tokenPath);
  return stopped;
}
