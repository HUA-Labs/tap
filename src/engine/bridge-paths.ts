import * as path from "node:path";
import type { InstanceId } from "../types.js";

export function appServerLogFilePath(
  stateDir: string,
  instanceId: InstanceId,
): string {
  return path.join(stateDir, "logs", `app-server-${instanceId}.log`);
}

export function appServerGatewayLogFilePath(
  stateDir: string,
  instanceId: InstanceId,
): string {
  return path.join(stateDir, "logs", `app-server-gateway-${instanceId}.log`);
}

export function appServerGatewayTokenFilePath(
  stateDir: string,
  instanceId: InstanceId,
): string {
  return path.join(
    stateDir,
    "secrets",
    `app-server-gateway-${instanceId}.token`,
  );
}

export function stderrLogFilePath(logPath: string): string {
  return `${logPath}.stderr`;
}

export function pidFilePath(stateDir: string, instanceId: InstanceId): string {
  return path.join(stateDir, "pids", `bridge-${instanceId}.json`);
}

export function logFilePath(stateDir: string, instanceId: InstanceId): string {
  return path.join(stateDir, "logs", `bridge-${instanceId}.log`);
}

export function runtimeHeartbeatFilePath(runtimeStateDir: string): string {
  return path.join(runtimeStateDir, "heartbeat.json");
}

export function runtimeThreadStateFilePath(runtimeStateDir: string): string {
  return path.join(runtimeStateDir, "thread.json");
}
