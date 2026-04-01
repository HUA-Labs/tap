export type {
  TapSharedConfig,
  TapLocalConfig,
  TapResolvedConfig,
  ConfigSource,
  ConfigResolution,
  TrackedConfigSource,
  TrackedValue,
  TapTrackedConfig,
} from "./types.js";

export {
  LEGACY_CONFIG_FILE,
  SHARED_CONFIG_FILE,
  LOCAL_CONFIG_FILE,
  findRepoRoot,
  loadSharedConfig,
  loadLocalConfig,
  resolveConfig,
  resolveTrackedConfig,
  loadInstanceConfig,
  loadSessionConfig,
  saveSharedConfig,
  saveLocalConfig,
  normalizeTapPath,
} from "./resolve.js";

export type { ConfigOverrides, TrackedResolveOpts } from "./resolve.js";

export { computeConfigHash } from "./config-hash.js";

export type {
  DriftCheckResult,
  DriftCheck,
  DriftSource,
} from "./drift-detector.js";
export {
  checkInstanceDrift,
  checkAllDrift,
  computeFileHash,
} from "./drift-detector.js";

export type {
  InstanceConfig,
  CreateInstanceConfigOpts,
} from "./instance-config.js";
export {
  loadInstanceConfig as loadFullInstanceConfig,
  saveInstanceConfig,
  listInstanceConfigs,
  deleteInstanceConfig,
  createInstanceConfig,
  updateInstanceConfig,
} from "./instance-config.js";
