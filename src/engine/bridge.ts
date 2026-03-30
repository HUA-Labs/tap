// ─── Extracted modules ─────────────────────────────────────────

export {
  appServerLogFilePath,
  appServerGatewayLogFilePath,
  appServerGatewayTokenFilePath,
  stderrLogFilePath,
  pidFilePath,
  logFilePath,
  runtimeHeartbeatFilePath,
  runtimeThreadStateFilePath,
} from "./bridge-paths.js";

export {
  writeProtectedTextFile,
  removeFileIfExists,
  toPowerShellSingleQuotedString,
  toPowerShellStringArrayLiteral,
} from "./bridge-file-io.js";

export {
  getWebSocketCtor,
  delay,
  isLoopbackHost,
  allocateLoopbackPort,
  isTcpPortAvailable,
  findNextAvailableAppServerPort,
  waitForPortRelease,
} from "./bridge-port-network.js";

export {
  resolveCodexCommand,
  splitResolvedCommand,
  resolvePowerShellCommand,
  resolveAuthGatewayScript,
} from "./bridge-codex-command.js";

export {
  cleanupStaleWindowsSpawnWrappers,
  buildWindowsDetachedWrapperScript,
  WINDOWS_DETACHED_LIVENESS_TIMEOUT_MS,
  WINDOWS_DETACHED_LIVENESS_POLL_MS,
  startWindowsDetachedProcess,
  waitForWindowsDetachedProcessLiveness,
  startWindowsCodexAppServer,
  findListeningProcessId,
} from "./bridge-windows-spawn.js";

export {
  startUnixDetachedProcess,
  startUnixCodexAppServer,
  findUnixListeningProcessId,
} from "./bridge-unix-spawn.js";

export {
  isProcessAlive,
  terminateProcess,
  stopManagedAppServer,
} from "./bridge-process-control.js";

export {
  resolveAgentName,
  inferRestartMode,
  cleanupHeadlessDispatch,
} from "./bridge-config.js";

export {
  loadBridgeState,
  saveBridgeState,
  clearBridgeState,
  isBridgeRunning,
  loadRuntimeBridgeHeartbeat,
  loadRuntimeBridgeThreadState,
} from "./bridge-state.js";

export type {
  RuntimeBridgeHeartbeat,
  RuntimeBridgeThreadState,
} from "./bridge-state.js";

export {
  updateBridgeHeartbeat,
  getHeartbeatAge,
  getBridgeHeartbeatTimestamp,
  getBridgeStatus,
  getTurnInfo,
  isTurnStuck,
  rotateLog,
} from "./bridge-observability.js";

export type { TurnInfo } from "./bridge-observability.js";

export {
  checkAppServerHealth,
  waitForAppServerHealth,
  markAppServerHealthy,
  APP_SERVER_HEALTH_TIMEOUT_MS,
  APP_SERVER_HEALTH_RETRY_MS,
} from "./bridge-app-server-health.js";

export type {
  WebSocketLike,
  WebSocketCtor,
} from "./bridge-app-server-health.js";

export {
  buildProtectedAppServerUrl,
  readGatewayTokenFromPath,
  readGatewayToken,
  materializeGatewayTokenFile,
  createManagedAppServerAuth,
  canReuseManagedAppServer,
  AUTH_SUBPROTOCOL_PREFIX,
} from "./bridge-app-server-auth.js";

export type { EnsureCodexAppServerOptions } from "./bridge-app-server-lifecycle.js";

export {
  DEFAULT_APP_SERVER_URL,
  APP_SERVER_START_TIMEOUT_MS,
  APP_SERVER_GATEWAY_START_TIMEOUT_MS,
  isAppServerUsedByOtherBridge,
  findReusableManagedAppServer,
  resolveAppServerUrl,
  ensureCodexAppServer,
  formatCodexAppServerCommand,
} from "./bridge-app-server-lifecycle.js";

export type { BridgeStartOptions } from "./bridge-startup.js";

export { getBridgeRuntimeStateDir, startBridge } from "./bridge-startup.js";
export type {
  BridgeStopOptions,
  RestartBridgeOptions,
} from "./bridge-orchestrator.js";

export { stopBridge, restartBridge } from "./bridge-orchestrator.js";
