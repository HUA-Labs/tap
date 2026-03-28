import { execSync } from "node:child_process";
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
      process.kill(pid, "SIGTERM");
      await delay(2_000);
      if (isProcessAlive(pid)) {
        process.kill(pid, "SIGKILL");
      }
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
