export type {
  RuntimeName,
  BridgeMode,
  Platform,
  InstanceId,
  AdapterContext,
  ProbeResult,
  PatchPlan,
  PatchOp,
  PatchOpType,
  OwnedArtifact,
  ArtifactKind,
  ApplyResult,
  VerifyResult,
  VerifyCheck,
  RuntimeAdapter,
  TapState,
  TapStateV1,
  InstanceState,
  /** @deprecated Use InstanceState. Will be removed in 0.2.0. */
  RuntimeState,
  BridgeState,
  AppServerState,
  AppServerAuthState,
  CommandName,
  CommandCode,
  CommandResult,
} from "./types.js";

export {
  loadState,
  saveState,
  createInitialState,
  stateExists,
} from "./state.js";
export { version } from "./version.js";
export type {
  GeminiIdeCompanionServer,
  GeminiIdeCompanionServerOptions,
  GeminiIdeContext,
  GeminiIdeCursor,
  GeminiIdeFile,
  GeminiIdeInfo,
} from "./bridges/gemini-ide-companion.js";
export { startGeminiIdeCompanionServer } from "./bridges/gemini-ide-companion.js";

// Config
export type {
  TapSharedConfig,
  TapLocalConfig,
  TapResolvedConfig,
  ConfigSource,
  ConfigResolution,
  ConfigOverrides,
} from "./config/index.js";
export {
  resolveConfig,
  loadSharedConfig,
  loadLocalConfig,
  saveSharedConfig,
  saveLocalConfig,
  SHARED_CONFIG_FILE,
  LOCAL_CONFIG_FILE,
} from "./config/index.js";

// Bridge engine
export {
  /** @deprecated Internal use only. Will be removed in 0.2.0. */
  updateBridgeHeartbeat,
  getHeartbeatAge,
} from "./engine/bridge-observability.js";
export { rotateLog, restartBridge } from "./engine/bridge.js";

// Dashboard / State API
export type {
  AgentInfo,
  BridgeInfo,
  PRInfo,
  DashboardWarning,
  DashboardSnapshot,
} from "./engine/dashboard.js";
export { collectDashboardSnapshot } from "./engine/dashboard.js";

// State/Control API (M105)
export type {
  StateApiOptions,
  EventStreamOptions,
  AgentControlOptions,
  AgentControlResult,
  HealthReport,
} from "./api/state.js";
export {
  getDashboardSnapshot,
  streamEvents,
  getConfig,
  getHealthReport,
  startAgents,
  stopAgents,
} from "./api/state.js";
export type { HttpServerOptions } from "./api/http.js";
export { startHttpServer } from "./api/http.js";

// Runtime resolver
export type { ResolvedRuntime, RuntimeSource } from "./runtime/index.js";
export {
  resolveNodeRuntime,
  buildRuntimeEnv,
  readNodeVersion,
  probeFnmNode,
  getFnmBinDir,
} from "./runtime/index.js";
