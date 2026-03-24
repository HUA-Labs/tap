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
  RuntimeState,
  BridgeState,
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
  updateBridgeHeartbeat,
  getHeartbeatAge,
  rotateLog,
} from "./engine/bridge.js";

// Runtime resolver
export type { ResolvedRuntime, RuntimeSource } from "./runtime/index.js";
export {
  resolveNodeRuntime,
  buildRuntimeEnv,
  readNodeVersion,
  probeFnmNode,
  getFnmBinDir,
} from "./runtime/index.js";
