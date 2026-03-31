export type {
  TapSharedConfig,
  TapLocalConfig,
  TapResolvedConfig,
  ConfigSource,
  ConfigResolution,
} from "./types.js";

export {
  LEGACY_CONFIG_FILE,
  SHARED_CONFIG_FILE,
  LOCAL_CONFIG_FILE,
  findRepoRoot,
  loadSharedConfig,
  loadLocalConfig,
  resolveConfig,
  saveSharedConfig,
  saveLocalConfig,
  normalizeTapPath,
} from "./resolve.js";

export type { ConfigOverrides } from "./resolve.js";
