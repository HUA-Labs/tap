import * as path from "node:path";
import type { InstanceId } from "../types.js";

/**
 * Verify that a resolved path stays within the expected subdirectory.
 * Prevents path traversal via crafted instanceId or other interpolated values.
 */
function assertPathContained(
  resolved: string,
  stateDir: string,
  subDir: string,
): string {
  const expectedDir = path.resolve(stateDir, subDir) + path.sep;
  const normalizedResolved = path.resolve(resolved);
  if (!normalizedResolved.startsWith(expectedDir)) {
    throw new Error(
      `Path traversal blocked: resolved path escapes "${subDir}/" directory`,
    );
  }
  return normalizedResolved;
}

export function appServerLogFilePath(
  stateDir: string,
  instanceId: InstanceId,
): string {
  return assertPathContained(
    path.join(stateDir, "logs", `app-server-${instanceId}.log`),
    stateDir,
    "logs",
  );
}

export function appServerGatewayLogFilePath(
  stateDir: string,
  instanceId: InstanceId,
): string {
  return assertPathContained(
    path.join(stateDir, "logs", `app-server-gateway-${instanceId}.log`),
    stateDir,
    "logs",
  );
}

export function appServerGatewayTokenFilePath(
  stateDir: string,
  instanceId: InstanceId,
): string {
  return assertPathContained(
    path.join(stateDir, "secrets", `app-server-gateway-${instanceId}.token`),
    stateDir,
    "secrets",
  );
}

export function stderrLogFilePath(logPath: string): string {
  return `${logPath}.stderr`;
}

export function pidFilePath(stateDir: string, instanceId: InstanceId): string {
  return assertPathContained(
    path.join(stateDir, "pids", `bridge-${instanceId}.json`),
    stateDir,
    "pids",
  );
}

export function logFilePath(stateDir: string, instanceId: InstanceId): string {
  return assertPathContained(
    path.join(stateDir, "logs", `bridge-${instanceId}.log`),
    stateDir,
    "logs",
  );
}

export function runtimeHeartbeatFilePath(runtimeStateDir: string): string {
  return path.join(runtimeStateDir, "heartbeat.json");
}

export function runtimeThreadStateFilePath(runtimeStateDir: string): string {
  return path.join(runtimeStateDir, "thread.json");
}
