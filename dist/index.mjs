var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// src/utils.ts
import * as fs from "fs";
import * as path from "path";
function isValidRuntime(name) {
  return VALID_RUNTIMES.includes(name);
}
function detectPlatform() {
  return process.platform;
}
function normalizeTapPath(input, platform = process.platform) {
  const trimmed = input.trim().replace(/^["'`]+|["'`]+$/g, "");
  if (/^[A-Za-z]:[\\/]/.test(trimmed)) {
    return trimmed;
  }
  if (platform === "win32") {
    const match = trimmed.match(/^\/([A-Za-z])\/(.*)$/);
    if (match) {
      return `${match[1].toUpperCase()}:\\${match[2].replace(/\//g, "\\")}`;
    }
  }
  return trimmed;
}
function _setNoGitWarned() {
  _noGitWarned = true;
}
function findRepoRoot(startDir = process.cwd()) {
  let dir = path.resolve(startDir);
  while (true) {
    if (fs.existsSync(path.join(dir, ".git"))) return dir;
    if (fs.existsSync(path.join(dir, "package.json"))) {
      if (!_noGitWarned) {
        _setNoGitWarned();
        log(
          "No .git directory found. Resolved tap root via package.json. That's fine outside git; use --comms-dir to choose a different comms location."
        );
      }
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  if (!_noGitWarned) {
    _setNoGitWarned();
    log(
      "No git repository or package.json found. Using the current directory as tap root. That's fine outside git; use --comms-dir to choose a different comms location."
    );
  }
  return process.cwd();
}
function createAdapterContext(commsDir, repoRoot) {
  const { config } = resolveConfig({}, repoRoot);
  return {
    commsDir: path.resolve(normalizeTapPath(commsDir)),
    repoRoot: path.resolve(normalizeTapPath(repoRoot)),
    stateDir: config.stateDir,
    platform: detectPlatform()
  };
}
function parseArgs(args) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith("--")) {
      const eqIdx = arg.indexOf("=");
      if (eqIdx > 2) {
        const key2 = arg.slice(2, eqIdx);
        const value = arg.slice(eqIdx + 1);
        flags[key2] = value;
        continue;
      }
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else if (arg.startsWith("-")) {
      flags[arg.slice(1)] = true;
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags };
}
function log(message) {
  if (!_jsonMode) console.log(`  ${message}`);
}
function logSuccess(message) {
  if (!_jsonMode) console.log(`  + ${message}`);
}
function logWarn(message) {
  if (_jsonMode) return;
  _loggedWarnings.add(message);
  console.log(`  ! ${message}`);
}
function logError(message) {
  if (!_jsonMode) console.error(`  x ${message}`);
}
function logHeader(message) {
  if (!_jsonMode) console.log(`
  ${message}
`);
}
function parseIntFlag(value, name, min, max) {
  if (value === void 0) return void 0;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new RangeError(
      `Invalid ${name}: ${value}. Must be an integer between ${min} and ${max}.`
    );
  }
  return parsed;
}
function resolveInstanceId(identifier, state) {
  if (state.instances[identifier]) {
    return { ok: true, instanceId: identifier };
  }
  if (isValidRuntime(identifier)) {
    const matches = Object.values(state.instances).filter(
      (inst) => inst.runtime === identifier
    );
    if (matches.length === 1) {
      return { ok: true, instanceId: matches[0].instanceId };
    }
    if (matches.length > 1) {
      const ids = matches.map((m) => m.instanceId).join(", ");
      return {
        ok: false,
        code: "TAP_INSTANCE_AMBIGUOUS",
        message: `Multiple ${identifier} instances found: ${ids}. Specify one explicitly.`
      };
    }
  }
  return {
    ok: false,
    code: "TAP_INSTANCE_NOT_FOUND",
    message: `Instance not found: ${identifier}`
  };
}
var VALID_RUNTIMES, _noGitWarned, _loggedWarnings, _jsonMode;
var init_utils = __esm({
  "src/utils.ts"() {
    "use strict";
    init_resolve();
    VALID_RUNTIMES = ["claude", "codex", "gemini"];
    _noGitWarned = false;
    _loggedWarnings = /* @__PURE__ */ new Set();
    _jsonMode = false;
  }
});

// src/config/resolve.ts
import * as fs2 from "fs";
import * as path2 from "path";
function findRepoRoot2(startDir = process.cwd()) {
  let dir = path2.resolve(startDir);
  while (true) {
    if (fs2.existsSync(path2.join(dir, ".git"))) return dir;
    if (fs2.existsSync(path2.join(dir, "package.json"))) {
      if (!_noGitWarned) {
        _setNoGitWarned();
        log(
          "No .git directory found. Resolved tap root via package.json. That's fine outside git; use --comms-dir to choose a different comms location."
        );
      }
      return dir;
    }
    const parent = path2.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  if (!_noGitWarned) {
    _setNoGitWarned();
    log(
      "No git repository or package.json found. Using the current directory as tap root. That's fine outside git; use --comms-dir to choose a different comms location."
    );
  }
  return process.cwd();
}
function loadJsonFile(filePath) {
  if (!fs2.existsSync(filePath)) return null;
  try {
    const raw = fs2.readFileSync(filePath, "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
function loadSharedConfig(repoRoot) {
  return loadJsonFile(path2.join(repoRoot, SHARED_CONFIG_FILE));
}
function loadLocalConfig(repoRoot) {
  return loadJsonFile(path2.join(repoRoot, LOCAL_CONFIG_FILE));
}
function readLegacyShellValue(configText, key) {
  const match = configText.match(new RegExp(`^${key}="?(.+?)"?$`, "m"));
  return match?.[1]?.trim() || null;
}
function loadLegacyShellConfig(repoRoot) {
  const filePath = path2.join(repoRoot, LEGACY_CONFIG_FILE);
  if (!fs2.existsSync(filePath)) return null;
  try {
    const raw = fs2.readFileSync(filePath, "utf-8");
    const commsDir = readLegacyShellValue(raw, "TAP_COMMS_DIR");
    if (!commsDir) return null;
    return { commsDir };
  } catch {
    return null;
  }
}
function resolveConfig(overrides = {}, startDir) {
  const repoRoot = findRepoRoot2(startDir);
  const shared = loadSharedConfig(repoRoot) ?? {};
  const local = loadLocalConfig(repoRoot) ?? {};
  const legacy = loadLegacyShellConfig(repoRoot) ?? {};
  const sources = {
    repoRoot: "auto",
    commsDir: "auto",
    stateDir: "auto",
    runtimeCommand: "auto",
    appServerUrl: "auto",
    towerName: "auto",
    remoteAgents: "auto",
    portMap: "auto"
  };
  let commsDir;
  if (overrides.commsDir) {
    commsDir = resolvePath(repoRoot, overrides.commsDir);
    sources.commsDir = "cli-flag";
  } else if (process.env.TAP_COMMS_DIR) {
    commsDir = resolvePath(repoRoot, process.env.TAP_COMMS_DIR);
    sources.commsDir = "env";
  } else if (local.commsDir) {
    commsDir = resolvePath(repoRoot, local.commsDir);
    sources.commsDir = "local-config";
  } else if (shared.commsDir) {
    commsDir = resolvePath(repoRoot, shared.commsDir);
    sources.commsDir = "shared-config";
  } else if (legacy.commsDir) {
    commsDir = resolvePath(repoRoot, legacy.commsDir);
    sources.commsDir = "legacy-shell-config";
  } else {
    commsDir = path2.join(repoRoot, "tap-comms");
  }
  let stateDir;
  if (overrides.stateDir) {
    stateDir = resolvePath(repoRoot, overrides.stateDir);
    sources.stateDir = "cli-flag";
  } else if (process.env.TAP_STATE_DIR) {
    stateDir = resolvePath(repoRoot, process.env.TAP_STATE_DIR);
    sources.stateDir = "env";
  } else if (local.stateDir) {
    stateDir = resolvePath(repoRoot, local.stateDir);
    sources.stateDir = "local-config";
  } else if (shared.stateDir) {
    stateDir = resolvePath(repoRoot, shared.stateDir);
    sources.stateDir = "shared-config";
  } else {
    stateDir = path2.join(repoRoot, ".tap-comms");
  }
  let runtimeCommand;
  if (overrides.runtimeCommand) {
    runtimeCommand = overrides.runtimeCommand;
    sources.runtimeCommand = "cli-flag";
  } else if (process.env.TAP_RUNTIME_COMMAND) {
    runtimeCommand = process.env.TAP_RUNTIME_COMMAND;
    sources.runtimeCommand = "env";
  } else if (local.runtimeCommand) {
    runtimeCommand = local.runtimeCommand;
    sources.runtimeCommand = "local-config";
  } else if (shared.runtimeCommand) {
    runtimeCommand = shared.runtimeCommand;
    sources.runtimeCommand = "shared-config";
  } else {
    runtimeCommand = DEFAULT_RUNTIME_COMMAND;
  }
  let appServerUrl;
  if (overrides.appServerUrl) {
    appServerUrl = overrides.appServerUrl;
    sources.appServerUrl = "cli-flag";
  } else if (process.env.TAP_APP_SERVER_URL) {
    appServerUrl = process.env.TAP_APP_SERVER_URL;
    sources.appServerUrl = "env";
  } else if (local.appServerUrl) {
    appServerUrl = local.appServerUrl;
    sources.appServerUrl = "local-config";
  } else if (shared.appServerUrl) {
    appServerUrl = shared.appServerUrl;
    sources.appServerUrl = "shared-config";
  } else {
    appServerUrl = DEFAULT_APP_SERVER_URL;
  }
  const towerName = local.towerName ?? shared.towerName ?? null;
  const remoteAgents = [
    ...shared.remoteAgents ?? [],
    ...local.remoteAgents ?? []
  ];
  const portMap = {};
  if (shared.portMap) {
    Object.assign(portMap, shared.portMap);
    sources.portMap = "shared-config";
  }
  if (local.portMap) {
    Object.assign(portMap, local.portMap);
    sources.portMap = "local-config";
  }
  return {
    config: {
      repoRoot,
      commsDir,
      stateDir,
      runtimeCommand,
      appServerUrl,
      towerName,
      remoteAgents,
      portMap
    },
    sources
  };
}
function saveSharedConfig(repoRoot, config) {
  const filePath = path2.join(repoRoot, SHARED_CONFIG_FILE);
  const tmp = `${filePath}.tmp.${process.pid}`;
  fs2.writeFileSync(tmp, JSON.stringify(config, null, 2) + "\n", "utf-8");
  fs2.renameSync(tmp, filePath);
}
function saveLocalConfig(repoRoot, config) {
  const filePath = path2.join(repoRoot, LOCAL_CONFIG_FILE);
  const tmp = `${filePath}.tmp.${process.pid}`;
  fs2.writeFileSync(tmp, JSON.stringify(config, null, 2) + "\n", "utf-8");
  fs2.renameSync(tmp, filePath);
}
function resolvePath(repoRoot, p) {
  const normalized = normalizeTapPath(p);
  return path2.isAbsolute(normalized) ? normalized : path2.resolve(repoRoot, normalized);
}
var SHARED_CONFIG_FILE, LOCAL_CONFIG_FILE, LEGACY_CONFIG_FILE, DEFAULT_RUNTIME_COMMAND, DEFAULT_APP_SERVER_URL;
var init_resolve = __esm({
  "src/config/resolve.ts"() {
    "use strict";
    init_utils();
    SHARED_CONFIG_FILE = "tap-config.json";
    LOCAL_CONFIG_FILE = "tap-config.local.json";
    LEGACY_CONFIG_FILE = ".tap-config";
    DEFAULT_RUNTIME_COMMAND = "node";
    DEFAULT_APP_SERVER_URL = "ws://127.0.0.1:4501";
  }
});

// src/permissions/presets.ts
function createPermissionFromRole(role) {
  const preset = ROLE_PRESETS[role];
  return {
    ...preset,
    allowedTools: [...preset.allowedTools],
    deniedTools: [...preset.deniedTools],
    allowedPaths: [...preset.allowedPaths]
  };
}
var ROLE_PRESETS;
var init_presets = __esm({
  "src/permissions/presets.ts"() {
    "use strict";
    ROLE_PRESETS = {
      tower: {
        role: "tower",
        mode: "full-access",
        allowedTools: ["*"],
        deniedTools: [],
        allowedPaths: ["**"],
        escalateTo: null
      },
      implementer: {
        role: "implementer",
        mode: "workspace-write",
        allowedTools: [
          "Read",
          "Edit",
          "Write",
          "Bash",
          "Grep",
          "Glob",
          "mcp__tap__*"
        ],
        deniedTools: ["Bash(git push --force:*)", "Bash(git reset --hard:*)"],
        allowedPaths: ["packages/**", "apps/**", "docs/**"],
        escalateTo: "tower"
      },
      reviewer: {
        role: "reviewer",
        mode: "readonly",
        allowedTools: [
          "Read",
          "Grep",
          "Glob",
          "Bash(grep:*)",
          "Bash(git diff:*)",
          "mcp__tap__*"
        ],
        deniedTools: ["Edit", "Write", "Bash(rm:*)"],
        allowedPaths: ["hua-comms/reviews/**"],
        escalateTo: "tower"
      },
      custom: {
        role: "custom",
        mode: "prompt",
        allowedTools: [],
        deniedTools: [],
        allowedPaths: [],
        escalateTo: "tower"
      }
    };
  }
});

// src/config/instance-config.ts
import * as fs3 from "fs";
import * as path3 from "path";
function instancesDir(stateDir) {
  return path3.join(stateDir, "instances");
}
function getInstanceConfigPath(stateDir, instanceId) {
  if (instanceId.includes("/") || instanceId.includes("\\") || instanceId.includes("..")) {
    throw new Error(
      `Invalid instanceId "${instanceId}": must not contain path separators or ".." sequences`
    );
  }
  return path3.join(instancesDir(stateDir), `${instanceId}.json`);
}
function loadInstanceConfig(stateDir, instanceId) {
  const filePath = getInstanceConfigPath(stateDir, instanceId);
  if (!fs3.existsSync(filePath)) return null;
  try {
    const raw = fs3.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    if (!parsed.permission) {
      parsed.permission = createPermissionFromRole("custom");
    }
    if (parsed.defaultAgentName === void 0 || parsed.defaultAgentName === null) {
      parsed.defaultAgentName = parsed.agentName ?? null;
    }
    delete parsed.agentName;
    delete parsed.agentId;
    return parsed;
  } catch {
    return null;
  }
}
function saveInstanceConfig(stateDir, config) {
  const dir = instancesDir(stateDir);
  fs3.mkdirSync(dir, { recursive: true });
  const filePath = getInstanceConfigPath(stateDir, config.instanceId);
  const tmp = `${filePath}.tmp.${process.pid}`;
  fs3.writeFileSync(tmp, JSON.stringify(config, null, 2) + "\n", "utf-8");
  fs3.renameSync(tmp, filePath);
  return filePath;
}
function normalizeComparablePath(filePath) {
  const normalized = path3.resolve(filePath);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}
function pathDrifted(actual, expected) {
  if (!actual) return true;
  return normalizeComparablePath(actual) !== normalizeComparablePath(expected);
}
function reconcileInstanceConfigPaths(existing, opts) {
  const nextMcpEnv = {
    ...existing.mcpEnv,
    TAP_COMMS_DIR: opts.commsDir,
    TAP_STATE_DIR: opts.stateDir,
    TAP_REPO_ROOT: opts.repoRoot
  };
  const changed = pathDrifted(existing.commsDir, opts.commsDir) || pathDrifted(existing.stateDir, opts.stateDir) || pathDrifted(existing.mcpEnv.TAP_COMMS_DIR, opts.commsDir) || pathDrifted(existing.mcpEnv.TAP_STATE_DIR, opts.stateDir) || pathDrifted(existing.mcpEnv.TAP_REPO_ROOT, opts.repoRoot);
  if (!changed) {
    return existing;
  }
  const updated = {
    ...existing,
    commsDir: opts.commsDir,
    stateDir: opts.stateDir,
    mcpEnv: nextMcpEnv,
    updatedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
  updated.configHash = computeInstanceConfigHash(updated);
  return updated;
}
function computeInstanceConfigHash(config) {
  const hashInput = {
    instanceId: config.instanceId,
    runtime: config.runtime,
    defaultAgentName: config.defaultAgentName,
    port: config.port,
    appServerUrl: config.appServerUrl,
    appServerUnsandboxed: config.appServerUnsandboxed ?? false,
    mcpEnv: config.mcpEnv,
    permission: config.permission
  };
  const serialized = JSON.stringify(hashInput, Object.keys(hashInput).sort());
  let hash = 2166136261;
  for (let i = 0; i < serialized.length; i++) {
    hash ^= serialized.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
var init_instance_config = __esm({
  "src/config/instance-config.ts"() {
    "use strict";
    init_presets();
  }
});

// src/config/index.ts
var init_config = __esm({
  "src/config/index.ts"() {
    "use strict";
    init_resolve();
  }
});

// src/state.ts
import * as fs4 from "fs";
import * as path4 from "path";
import * as crypto from "crypto";
function getStateDir(repoRoot) {
  const { config } = resolveConfig({}, repoRoot);
  return config.stateDir;
}
function getStatePath(repoRoot) {
  return path4.join(getStateDir(repoRoot), STATE_FILE);
}
function stateExists(repoRoot) {
  return fs4.existsSync(getStatePath(repoRoot));
}
function normalizeComparablePath2(filePath) {
  const normalized = path4.resolve(filePath);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}
function pathDrifted2(actual, expected) {
  if (!actual) return true;
  return normalizeComparablePath2(actual) !== normalizeComparablePath2(expected);
}
function reconcileStateConfig(repoRoot, state) {
  const { config } = resolveConfig({}, repoRoot);
  const resolvedRepoRoot = path4.resolve(repoRoot);
  const resolvedCommsDir = path4.resolve(config.commsDir);
  const resolvedStateDir = path4.resolve(config.stateDir);
  const instanceIds = Object.keys(state.instances);
  let nextState = state;
  let changed = false;
  if (pathDrifted2(state.commsDir, resolvedCommsDir) || pathDrifted2(state.repoRoot, resolvedRepoRoot)) {
    nextState = {
      ...nextState,
      commsDir: resolvedCommsDir,
      repoRoot: resolvedRepoRoot,
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    changed = true;
  }
  for (const instanceId of instanceIds) {
    const instConfig = loadInstanceConfig(resolvedStateDir, instanceId);
    if (!instConfig) continue;
    const synced = reconcileInstanceConfigPaths(instConfig, {
      commsDir: resolvedCommsDir,
      stateDir: resolvedStateDir,
      repoRoot: resolvedRepoRoot
    });
    const currentInstance = nextState.instances[instanceId];
    if (!currentInstance) continue;
    const expectedConfigSourceFile = getInstanceConfigPath(
      resolvedStateDir,
      instanceId
    );
    const stateNeedsSync = currentInstance.configHash !== synced.configHash || pathDrifted2(currentInstance.configSourceFile, expectedConfigSourceFile);
    if (synced === instConfig && !stateNeedsSync) continue;
    if (synced !== instConfig) {
      saveInstanceConfig(resolvedStateDir, synced);
    }
    nextState = {
      ...nextState,
      updatedAt: synced.updatedAt,
      instances: {
        ...nextState.instances,
        [instanceId]: {
          ...currentInstance,
          configHash: synced.configHash,
          configSourceFile: expectedConfigSourceFile
        }
      }
    };
    changed = true;
  }
  if (changed) {
    saveState(repoRoot, nextState);
  }
  return nextState;
}
function migrateStateV1toV2(v1) {
  const instances = {};
  for (const [runtime, rs] of Object.entries(v1.runtimes)) {
    if (!rs) continue;
    const instanceId = runtime;
    instances[instanceId] = {
      instanceId,
      runtime,
      defaultAgentName: null,
      port: null,
      headless: null,
      ...rs
    };
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    createdAt: v1.createdAt,
    updatedAt: v1.updatedAt,
    commsDir: v1.commsDir,
    repoRoot: v1.repoRoot,
    packageVersion: v1.packageVersion,
    instances
  };
}
function migrateStateV2toV3(v2) {
  const instances = {};
  for (const [id, inst] of Object.entries(v2.instances)) {
    const legacy = inst;
    const { agentName: legacyAgentName, ...rest } = legacy;
    instances[id] = {
      ...rest,
      defaultAgentName: rest.defaultAgentName ?? legacyAgentName ?? null,
      configHash: rest.configHash ?? "",
      configSourceFile: rest.configSourceFile ?? ""
    };
  }
  return {
    ...v2,
    schemaVersion: SCHEMA_VERSION,
    instances
  };
}
function loadState(repoRoot) {
  const statePath = getStatePath(repoRoot);
  if (!fs4.existsSync(statePath)) return null;
  const raw = fs4.readFileSync(statePath, "utf-8");
  const parsed = JSON.parse(raw);
  if (parsed.schemaVersion === 1 || parsed.runtimes) {
    const v2 = migrateStateV1toV2(parsed);
    const v3 = migrateStateV2toV3(v2);
    saveState(repoRoot, v3);
    return reconcileStateConfig(repoRoot, v3);
  }
  if (parsed.schemaVersion === 2) {
    const v3 = migrateStateV2toV3(parsed);
    saveState(repoRoot, v3);
    return reconcileStateConfig(repoRoot, v3);
  }
  const state = parsed;
  for (const [id, inst] of Object.entries(state.instances)) {
    const legacy = inst;
    if (legacy.defaultAgentName === void 0 || legacy.defaultAgentName === null) {
      legacy.defaultAgentName = legacy.agentName ?? null;
    }
    if ("agentName" in legacy) {
      delete legacy.agentName;
    }
    state.instances[id] = legacy;
  }
  return reconcileStateConfig(repoRoot, state);
}
function saveState(repoRoot, state) {
  const stateDir = getStateDir(repoRoot);
  fs4.mkdirSync(stateDir, { recursive: true });
  const statePath = getStatePath(repoRoot);
  const tmp = `${statePath}.tmp.${process.pid}`;
  fs4.writeFileSync(tmp, JSON.stringify(state, null, 2), "utf-8");
  fs4.renameSync(tmp, statePath);
}
function createInitialState(commsDir, repoRoot, packageVersion) {
  const now = (/* @__PURE__ */ new Date()).toISOString();
  return {
    schemaVersion: SCHEMA_VERSION,
    createdAt: now,
    updatedAt: now,
    commsDir: path4.resolve(commsDir),
    repoRoot: path4.resolve(repoRoot),
    packageVersion,
    instances: {}
  };
}
function updateInstanceState(state, instanceId, instanceState) {
  return {
    ...state,
    updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
    instances: {
      ...state.instances,
      [instanceId]: instanceState
    }
  };
}
function ensureBackupDir(stateDir, instanceId) {
  const backupDir = path4.join(stateDir, "backups", instanceId);
  fs4.mkdirSync(backupDir, { recursive: true });
  return backupDir;
}
function backupFile(filePath, backupDir) {
  const basename7 = path4.basename(filePath);
  const hash = fileHash(filePath);
  const backupPath = path4.join(backupDir, `${basename7}.${hash}.bak`);
  fs4.copyFileSync(filePath, backupPath);
  return backupPath;
}
function fileHash(filePath) {
  if (!fs4.existsSync(filePath)) return "";
  const content = fs4.readFileSync(filePath);
  return crypto.createHash("sha256").update(content).digest("hex").slice(0, 16);
}
var STATE_FILE, SCHEMA_VERSION;
var init_state = __esm({
  "src/state.ts"() {
    "use strict";
    init_config();
    init_instance_config();
    STATE_FILE = "state.json";
    SCHEMA_VERSION = 3;
  }
});

// src/engine/bridge-paths.ts
import * as path8 from "path";
function assertPathContained(resolved, stateDir, subDir) {
  const expectedDir = path8.resolve(stateDir, subDir) + path8.sep;
  const normalizedResolved = path8.resolve(resolved);
  if (!normalizedResolved.startsWith(expectedDir)) {
    throw new Error(
      `Path traversal blocked: resolved path escapes "${subDir}/" directory`
    );
  }
  return normalizedResolved;
}
function appServerLogFilePath(stateDir, instanceId) {
  return assertPathContained(
    path8.join(stateDir, "logs", `app-server-${instanceId}.log`),
    stateDir,
    "logs"
  );
}
function appServerGatewayLogFilePath(stateDir, instanceId) {
  return assertPathContained(
    path8.join(stateDir, "logs", `app-server-gateway-${instanceId}.log`),
    stateDir,
    "logs"
  );
}
function appServerGatewayTokenFilePath(stateDir, instanceId) {
  return assertPathContained(
    path8.join(stateDir, "secrets", `app-server-gateway-${instanceId}.token`),
    stateDir,
    "secrets"
  );
}
function stderrLogFilePath(logPath) {
  return `${logPath}.stderr`;
}
function pidFilePath(stateDir, instanceId) {
  return assertPathContained(
    path8.join(stateDir, "pids", `bridge-${instanceId}.json`),
    stateDir,
    "pids"
  );
}
function logFilePath(stateDir, instanceId) {
  return assertPathContained(
    path8.join(stateDir, "logs", `bridge-${instanceId}.log`),
    stateDir,
    "logs"
  );
}
function runtimeHeartbeatFilePath(runtimeStateDir) {
  return path8.join(runtimeStateDir, "heartbeat.json");
}
function runtimeThreadStateFilePath(runtimeStateDir) {
  return path8.join(runtimeStateDir, "thread.json");
}
var init_bridge_paths = __esm({
  "src/engine/bridge-paths.ts"() {
    "use strict";
  }
});

// src/engine/bridge-file-io.ts
import * as fs7 from "fs";
import * as path9 from "path";
function writeProtectedTextFile(filePath, content) {
  fs7.mkdirSync(path9.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp.${process.pid}`;
  fs7.writeFileSync(tmp, content, {
    encoding: "utf-8",
    mode: APP_SERVER_AUTH_FILE_MODE
  });
  fs7.chmodSync(tmp, APP_SERVER_AUTH_FILE_MODE);
  fs7.renameSync(tmp, filePath);
  fs7.chmodSync(filePath, APP_SERVER_AUTH_FILE_MODE);
}
function removeFileIfExists2(filePath) {
  if (!filePath || !fs7.existsSync(filePath)) {
    return;
  }
  try {
    fs7.unlinkSync(filePath);
  } catch {
  }
}
function toPowerShellSingleQuotedString(value) {
  return `'${value.replace(/'/g, "''")}'`;
}
function toPowerShellStringArrayLiteral(values) {
  return `@(${values.map(toPowerShellSingleQuotedString).join(", ")})`;
}
var APP_SERVER_AUTH_FILE_MODE;
var init_bridge_file_io = __esm({
  "src/engine/bridge-file-io.ts"() {
    "use strict";
    APP_SERVER_AUTH_FILE_MODE = 384;
  }
});

// src/engine/bridge-port-network.ts
import * as net from "net";
function getWebSocketCtor() {
  const candidate = globalThis.WebSocket;
  return typeof candidate === "function" ? candidate : null;
}
function delay(ms) {
  return new Promise((resolve21) => setTimeout(resolve21, ms));
}
function isLoopbackHost(hostname) {
  return hostname === "127.0.0.1" || hostname === "localhost";
}
async function allocateLoopbackPort(hostname) {
  const bindHost = hostname === "localhost" ? "127.0.0.1" : hostname;
  return await new Promise((resolve21, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, bindHost, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => {
          reject(new Error("Failed to allocate a loopback port"));
        });
        return;
      }
      const port = address.port;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve21(port);
      });
    });
  });
}
async function isTcpPortAvailable(hostname, port) {
  const bindHost = hostname === "localhost" ? "127.0.0.1" : hostname;
  return await new Promise((resolve21) => {
    const server = net.createServer();
    server.unref();
    server.once("error", () => resolve21(false));
    server.listen(port, bindHost, () => {
      server.close((error) => resolve21(!error));
    });
  });
}
async function waitForPortRelease(url, timeoutMs = 1e4, intervalMs = 500) {
  let hostname;
  let port;
  try {
    const parsed = new URL(url);
    hostname = parsed.hostname;
    port = parseInt(parsed.port, 10);
  } catch {
    return true;
  }
  if (!port || !Number.isFinite(port)) return true;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isTcpPortAvailable(hostname, port)) {
      return true;
    }
    await delay(intervalMs);
  }
  return false;
}
async function isPortAvailableForInstance(state, hostname, port, excludeInstanceId) {
  const claimedInState = Object.entries(state.instances).some(
    ([id, inst]) => id !== excludeInstanceId && inst.port === port
  );
  if (claimedInState) {
    return false;
  }
  if (!isLoopbackHost(hostname)) {
    return true;
  }
  return await isTcpPortAvailable(hostname, port);
}
async function findNextAvailableAppServerPort(state, baseUrl, basePort = 4501, excludeInstanceId, preferredPort) {
  let hostname = "127.0.0.1";
  try {
    hostname = new URL(baseUrl ?? DEFAULT_APP_SERVER_URL2).hostname;
  } catch {
  }
  if (typeof preferredPort === "number" && Number.isFinite(preferredPort) && preferredPort >= 1 && preferredPort <= 65535) {
    if (await isPortAvailableForInstance(
      state,
      hostname,
      preferredPort,
      excludeInstanceId
    )) {
      return preferredPort;
    }
  }
  const maxAttempts = 1e3;
  let port = basePort;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1, port += 1) {
    if (await isPortAvailableForInstance(state, hostname, port, excludeInstanceId)) {
      return port;
    }
  }
  throw new Error(
    `Failed to find a free app-server port starting at ${basePort}`
  );
}
var DEFAULT_APP_SERVER_URL2;
var init_bridge_port_network = __esm({
  "src/engine/bridge-port-network.ts"() {
    "use strict";
    DEFAULT_APP_SERVER_URL2 = "ws://127.0.0.1:4501";
  }
});

// src/engine/bridge-process-control.ts
import { execSync, spawnSync } from "child_process";
function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
function getUnixProcessGroupId(pid) {
  const result = spawnSync("ps", ["-o", "pgid=", "-p", String(pid)], {
    encoding: "utf-8",
    windowsHide: true
  });
  if (!result || result.status !== 0) {
    return null;
  }
  const parsed = Number.parseInt((result.stdout ?? "").trim(), 10);
  return Number.isFinite(parsed) ? parsed : null;
}
function isUnixProcessGroupAlive(processGroupId) {
  try {
    process.kill(-processGroupId, 0);
    return true;
  } catch {
    return false;
  }
}
async function terminateProcess(pid, platform) {
  if (!isProcessAlive(pid)) {
    return false;
  }
  try {
    if (platform === "win32") {
      execSync(`taskkill /PID ${pid} /F /T`, { stdio: "pipe" });
    } else {
      const processGroupId = getUnixProcessGroupId(pid);
      const signalTarget = processGroupId != null ? -processGroupId : pid;
      const isTargetAlive = () => processGroupId != null ? isUnixProcessGroupAlive(processGroupId) : isProcessAlive(pid);
      process.kill(signalTarget, "SIGTERM");
      await delay(2e3);
      if (isTargetAlive()) {
        process.kill(signalTarget, "SIGKILL");
        await delay(500);
      }
      return !isTargetAlive();
    }
  } catch {
  }
  return !isProcessAlive(pid);
}
async function stopManagedAppServer(appServer, platform) {
  if (!appServer.managed) {
    return false;
  }
  let stopped = false;
  if (appServer.auth?.gatewayPid != null) {
    stopped = await terminateProcess(appServer.auth.gatewayPid, platform) || stopped;
  }
  if (appServer.pid != null) {
    stopped = await terminateProcess(appServer.pid, platform) || stopped;
  }
  removeFileIfExists2(appServer.auth?.tokenPath);
  return stopped;
}
var init_bridge_process_control = __esm({
  "src/engine/bridge-process-control.ts"() {
    "use strict";
    init_bridge_port_network();
    init_bridge_file_io();
  }
});

// src/engine/bridge-state.ts
import * as fs8 from "fs";
function transitionBridgeLifecycle(previous, nextState, reason, options) {
  const at = options?.at ?? (/* @__PURE__ */ new Date()).toISOString();
  const changed = previous?.state !== nextState;
  return {
    state: nextState,
    since: changed || !previous?.since ? at : previous.since,
    updatedAt: at,
    lastTransitionAt: changed || !previous?.lastTransitionAt ? at : previous.lastTransitionAt,
    lastTransitionReason: changed || previous?.lastTransitionReason == null ? reason : previous.lastTransitionReason,
    restartCount: (previous?.restartCount ?? 0) + (options?.incrementRestart ? 1 : 0)
  };
}
function loadRuntimeBridgeHeartbeat(bridgeState) {
  const runtimeStateDir = bridgeState?.runtimeStateDir;
  if (!runtimeStateDir) {
    return null;
  }
  const heartbeatPath = runtimeHeartbeatFilePath(runtimeStateDir);
  if (!fs8.existsSync(heartbeatPath)) {
    return null;
  }
  try {
    return JSON.parse(
      fs8.readFileSync(heartbeatPath, "utf-8")
    );
  } catch {
    return null;
  }
}
function loadRuntimeBridgeThreadState(bridgeState) {
  const runtimeStateDir = bridgeState?.runtimeStateDir;
  if (!runtimeStateDir) {
    return null;
  }
  const threadPath = runtimeThreadStateFilePath(runtimeStateDir);
  if (!fs8.existsSync(threadPath)) {
    return null;
  }
  try {
    const parsed = JSON.parse(
      fs8.readFileSync(threadPath, "utf-8")
    );
    return parsed.threadId ? parsed : null;
  } catch {
    return null;
  }
}
function loadBridgeState(stateDir, instanceId) {
  const pidPath = pidFilePath(stateDir, instanceId);
  if (!fs8.existsSync(pidPath)) return null;
  try {
    const raw = fs8.readFileSync(pidPath, "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
function saveBridgeState(stateDir, instanceId, state) {
  const pidPath = pidFilePath(stateDir, instanceId);
  const serializable = JSON.parse(JSON.stringify(state));
  if (serializable.appServer?.auth) {
    delete serializable.appServer.auth.token;
  }
  writeProtectedTextFile(pidPath, JSON.stringify(serializable, null, 2));
}
function clearBridgeState(stateDir, instanceId) {
  const pidPath = pidFilePath(stateDir, instanceId);
  if (fs8.existsSync(pidPath)) {
    fs8.unlinkSync(pidPath);
  }
}
function isBridgeRunning(stateDir, instanceId) {
  const state = loadBridgeState(stateDir, instanceId);
  if (!state) return false;
  return isProcessAlive(state.pid);
}
var init_bridge_state = __esm({
  "src/engine/bridge-state.ts"() {
    "use strict";
    init_bridge_paths();
    init_bridge_file_io();
    init_bridge_process_control();
  }
});

// src/engine/bridge-observability.ts
import * as fs9 from "fs";
function loadRuntimeHeartbeatTimestamp(runtimeStateDir) {
  const heartbeat = loadRuntimeBridgeHeartbeat({ runtimeStateDir });
  return typeof heartbeat?.updatedAt === "string" ? heartbeat.updatedAt : null;
}
function resolveHeartbeatTimestamp(state) {
  return loadRuntimeHeartbeatTimestamp(state?.runtimeStateDir) ?? state?.lastHeartbeat ?? null;
}
function updateBridgeHeartbeat(_stateDir, _instanceId) {
}
function getHeartbeatAge(stateDir, instanceId) {
  const state = loadBridgeState(stateDir, instanceId);
  const heartbeat = resolveHeartbeatTimestamp(state);
  if (!heartbeat) return null;
  const heartbeatTime = new Date(heartbeat).getTime();
  if (isNaN(heartbeatTime)) return null;
  return Math.floor((Date.now() - heartbeatTime) / 1e3);
}
function getBridgeHeartbeatTimestamp(stateDir, instanceId) {
  return resolveHeartbeatTimestamp(loadBridgeState(stateDir, instanceId));
}
function getBridgeStatus(stateDir, instanceId) {
  const state = loadBridgeState(stateDir, instanceId);
  if (!state) return "stopped";
  if (!isProcessAlive(state.pid)) {
    clearBridgeState(stateDir, instanceId);
    return "stale";
  }
  return "running";
}
function getTurnInfo(stateDir, instanceId, stuckThresholdSeconds = 300) {
  const state = loadBridgeState(stateDir, instanceId);
  if (!state) return null;
  const heartbeat = loadRuntimeBridgeHeartbeat(state);
  if (!heartbeat) return null;
  const activeTurnId = heartbeat.activeTurnId ?? null;
  const lastTurnStatus = heartbeat.lastTurnStatus ?? null;
  const turnTimestamp = heartbeat.turnStartedAt ?? null;
  const updatedAt = turnTimestamp ?? heartbeat.updatedAt ?? null;
  let ageSeconds = null;
  if (turnTimestamp) {
    const ts = new Date(turnTimestamp).getTime();
    if (!isNaN(ts)) {
      ageSeconds = Math.floor((Date.now() - ts) / 1e3);
    }
  }
  const stuck = activeTurnId !== null && ageSeconds !== null && ageSeconds > stuckThresholdSeconds;
  return { activeTurnId, lastTurnStatus, updatedAt, ageSeconds, stuck };
}
function isTurnStuck(stateDir, instanceId, thresholdSeconds = 300) {
  const info = getTurnInfo(stateDir, instanceId, thresholdSeconds);
  return info?.stuck ?? false;
}
function rotateLog(logPath) {
  if (!fs9.existsSync(logPath)) return;
  try {
    const stats = fs9.statSync(logPath);
    if (stats.size === 0) return;
    const prevPath = `${logPath}.prev`;
    fs9.renameSync(logPath, prevPath);
  } catch {
  }
}
var init_bridge_observability = __esm({
  "src/engine/bridge-observability.ts"() {
    "use strict";
    init_bridge_state();
    init_bridge_process_control();
  }
});

// src/adapters/common.ts
import * as fs10 from "fs";
import * as os3 from "os";
import * as path10 from "path";
import { spawnSync as spawnSync2 } from "child_process";
import { fileURLToPath as fileURLToPath2 } from "url";
function resolveProbeCommand(candidate) {
  return resolveCommandPath(candidate) ?? candidate;
}
function shouldProbeWithShell(command) {
  if (process.platform !== "win32") {
    return false;
  }
  const ext = path10.extname(command).toLowerCase();
  if (!ext) {
    return !path10.isAbsolute(command);
  }
  return ext === ".cmd" || ext === ".bat" || ext === ".ps1";
}
function probeCommandVersion(command) {
  return spawnSync2(command, ["--version"], {
    encoding: "utf-8",
    windowsHide: true,
    shell: shouldProbeWithShell(command)
  });
}
function probeCommand(candidates) {
  for (const candidate of candidates) {
    const resolvedCommand = resolveProbeCommand(candidate);
    const result = probeCommandVersion(resolvedCommand);
    if (result.status === 0) {
      const version2 = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim() || null;
      return { command: resolvedCommand, version: version2 };
    }
  }
  return { command: null, version: null };
}
function resolveCommandPath(command) {
  if (path10.isAbsolute(command)) return command;
  const whichCmd = process.platform === "win32" ? "where.exe" : "which";
  try {
    const result = spawnSync2(whichCmd, [command], {
      encoding: "utf-8",
      windowsHide: true
    });
    if (result.status !== 0) return null;
    const lines = result.stdout.trim().split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) return null;
    if (process.platform === "win32") {
      const candidateExt = path10.extname(command).toLowerCase();
      if (candidateExt) {
        const extMatch = lines.find(
          (l) => path10.extname(l).toLowerCase() === candidateExt && fs10.existsSync(l)
        );
        if (extMatch) return extMatch;
      }
      const executableMatch = lines.find(
        (l) => /\.(cmd|exe|ps1)$/i.test(l) && fs10.existsSync(l)
      );
      if (executableMatch) return executableMatch;
    }
    const firstValid = lines.find((l) => fs10.existsSync(l));
    return firstValid ?? null;
  } catch {
    return null;
  }
}
function getHomeDir() {
  return os3.homedir();
}
function getCodexHomeDir() {
  const override = process.env.CODEX_HOME?.trim();
  if (override) {
    return path10.resolve(override);
  }
  return path10.join(getHomeDir(), ".codex");
}
function getCodexConfigPath() {
  return path10.join(getCodexHomeDir(), "config.toml");
}
function toForwardSlashPath(filePath) {
  return path10.resolve(filePath).replace(/\\/g, "/");
}
function canWriteOrCreate(filePath) {
  try {
    if (fs10.existsSync(filePath)) {
      fs10.accessSync(filePath, fs10.constants.W_OK);
      return true;
    }
    const parent = path10.dirname(filePath);
    fs10.mkdirSync(parent, { recursive: true });
    fs10.accessSync(parent, fs10.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}
function isEphemeralPath(p) {
  const normalized = p.replace(/\\/g, "/").toLowerCase();
  return normalized.includes("/_npx/") || normalized.includes("\\_npx\\") || normalized.includes("/fnm_multishells/") || normalized.includes("\\fnm_multishells\\") || normalized.includes("/tmp/") || normalized.includes("\\temp\\");
}
function findLocalTapCommsSource(ctx) {
  const candidates = [
    path10.join(
      ctx.repoRoot,
      "packages",
      "tap-plugin",
      "channels",
      "tap-comms.ts"
    ),
    path10.join(
      ctx.repoRoot,
      "node_modules",
      "@hua-labs",
      "tap-plugin",
      "channels",
      "tap-comms.ts"
    )
  ];
  for (const candidate of candidates) {
    if (fs10.existsSync(candidate)) return candidate;
  }
  return null;
}
function findBundledTapCommsSource(metaUrl = import.meta.url) {
  const moduleDir = path10.dirname(fileURLToPath2(metaUrl));
  const candidates = [
    path10.join(moduleDir, "mcp-server.mjs"),
    path10.join(moduleDir, "..", "mcp-server.mjs"),
    path10.join(moduleDir, "..", "mcp-server.ts")
  ];
  for (const candidate of candidates) {
    if (fs10.existsSync(candidate)) return candidate;
  }
  return null;
}
function findTapCommsServerEntry(ctx, metaUrl = import.meta.url) {
  return findBundledTapCommsSource(metaUrl) ?? findLocalTapCommsSource(ctx);
}
function findPreferredBunCommand() {
  const home = getHomeDir();
  const candidates = process.platform === "win32" ? [path10.join(home, ".bun", "bin", "bun.exe"), "bun", "bun.cmd"] : [path10.join(home, ".bun", "bin", "bun"), "bun"];
  for (const candidate of candidates) {
    if (path10.isAbsolute(candidate) && !fs10.existsSync(candidate)) continue;
    const resolvedCommand = resolveProbeCommand(candidate);
    const result = probeCommandVersion(resolvedCommand);
    if (result.status === 0) {
      return path10.isAbsolute(resolvedCommand) ? toForwardSlashPath(resolvedCommand) : resolvedCommand;
    }
  }
  return null;
}
function buildManagedMcpServerSpec(ctx, instanceId) {
  const sourcePath = findTapCommsServerEntry(ctx);
  const warnings = [];
  const issues = [];
  const env = {
    TAP_AGENT_NAME: ctx.agentName ?? "<set-per-session>",
    TAP_COMMS_DIR: toForwardSlashPath(ctx.commsDir),
    TAP_STATE_DIR: toForwardSlashPath(ctx.stateDir),
    TAP_REPO_ROOT: toForwardSlashPath(ctx.repoRoot),
    TAP_CHANNEL_LOG_PATH: toForwardSlashPath(
      path10.join(ctx.stateDir, "logs", "tap-mcp.log")
    )
  };
  if (instanceId) {
    env.TAP_AGENT_ID = instanceId;
  }
  if (!sourcePath) {
    issues.push(
      "tap MCP server entry not found. Reinstall @hua-labs/tap or run from a repo with packages/tap-plugin/channels/ available."
    );
    return { command: null, args: [], env, sourcePath, warnings, issues };
  }
  const isBundled = sourcePath.endsWith(".mjs");
  const isEphemeralSource = isEphemeralPath(sourcePath);
  let command;
  let args = [toForwardSlashPath(sourcePath)];
  if (isEphemeralSource && isBundled) {
    command = "npx";
    args = ["@hua-labs/tap", "serve"];
    warnings.push(
      "Detected npx cache path. Using `npx @hua-labs/tap serve` as stable MCP launcher."
    );
  } else if (isBundled) {
    const nodeProbe = probeCommand(
      process.platform === "win32" ? ["node", "node.exe"] : ["node"]
    );
    command = nodeProbe.command ?? "node";
  } else {
    command = findPreferredBunCommand();
  }
  if (!command) {
    issues.push(
      isBundled ? "node is required to run the compiled MCP server (.mjs). Ensure node is in PATH." : "bun is required to run the repo-local tap MCP server (.ts source). Install bun: https://bun.sh"
    );
    return { command: null, args: [], env, sourcePath, warnings, issues };
  }
  return {
    command,
    args,
    env,
    sourcePath,
    warnings,
    issues
  };
}
var init_common = __esm({
  "src/adapters/common.ts"() {
    "use strict";
  }
});

// src/engine/bridge-codex-command.ts
import * as fs11 from "fs";
import * as path11 from "path";
import { fileURLToPath as fileURLToPath3 } from "url";
function resolveCodexCommand(platform) {
  const candidates = platform === "win32" ? ["codex.cmd", "codex.exe", "codex", "codex.ps1"] : ["codex"];
  const resolved = probeCommand(candidates).command;
  if (!resolved) return null;
  if (platform === "win32" && resolved.endsWith(".cmd")) {
    const unwrapped = unwrapNpmCmdShim(resolved);
    if (unwrapped) return unwrapped;
  }
  return resolved;
}
function unwrapNpmCmdShim(cmdPath) {
  let content;
  try {
    content = fs11.readFileSync(cmdPath, "utf-8");
  } catch {
    return null;
  }
  const match = content.match(/"%_prog%"\s+"(%dp0%\\[^"]+)"\s+%\*/);
  if (!match) return null;
  const dp0 = path11.dirname(cmdPath);
  const scriptRelative = match[1].replace(/%dp0%\\/g, "").replace(/\\/g, path11.sep);
  const scriptPath = path11.resolve(dp0, scriptRelative);
  if (!fs11.existsSync(scriptPath)) return null;
  const localNode = path11.join(dp0, "node.exe");
  const nodeCommand = fs11.existsSync(localNode) ? localNode : probeCommand(["node.exe", "node"]).command ?? "node";
  return `${nodeCommand}\0${scriptPath}`;
}
function splitResolvedCommand(resolved) {
  const parts = resolved.split("\0");
  if (parts.length === 2) {
    return { command: parts[0], prefixArgs: [parts[1]] };
  }
  return { command: resolved, prefixArgs: [] };
}
function resolvePowerShellCommand() {
  return probeCommand(["pwsh", "powershell", "powershell.exe"]).command ?? "powershell";
}
function findAncestorAsset(startDir, relativeSegments) {
  let dir = path11.resolve(startDir);
  while (true) {
    const candidate = path11.join(dir, ...relativeSegments);
    if (fs11.existsSync(candidate)) {
      return candidate;
    }
    const parent = path11.dirname(dir);
    if (parent === dir) {
      return null;
    }
    dir = parent;
  }
}
function resolvePackagedBridgeAsset(repoRoot, assetName, runnerUrl = import.meta.url) {
  const moduleDir = path11.dirname(fileURLToPath3(runnerUrl));
  const bundledChild = path11.join(moduleDir, "bridges", assetName);
  if (fs11.existsSync(bundledChild)) {
    return bundledChild;
  }
  const bundledSibling = path11.resolve(moduleDir, "..", "bridges", assetName);
  if (fs11.existsSync(bundledSibling)) {
    return bundledSibling;
  }
  return findAncestorAsset(repoRoot, [
    "packages",
    "tap-comms",
    "dist",
    "bridges",
    assetName
  ]) ?? findAncestorAsset(repoRoot, [
    "node_modules",
    "@hua-labs",
    "tap",
    "dist",
    "bridges",
    assetName
  ]);
}
function resolveAuthGatewayScript(repoRoot) {
  return resolvePackagedBridgeAsset(
    repoRoot,
    "codex-app-server-auth-gateway.mjs"
  );
}
var init_bridge_codex_command = __esm({
  "src/engine/bridge-codex-command.ts"() {
    "use strict";
    init_common();
  }
});

// src/engine/bridge-windows-spawn.ts
import * as fs12 from "fs";
import * as os4 from "os";
import * as path12 from "path";
import { randomBytes } from "crypto";
import { spawnSync as spawnSync3 } from "child_process";
function cleanupStaleWindowsSpawnWrappers(now = Date.now()) {
  let entries;
  try {
    entries = fs12.readdirSync(os4.tmpdir());
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.startsWith(WINDOWS_SPAWN_WRAPPER_PREFIX) || !/\.(cmd|ps1)$/i.test(entry)) {
      continue;
    }
    const wrapperPath = path12.join(os4.tmpdir(), entry);
    try {
      const stats = fs12.statSync(wrapperPath);
      if (now - stats.mtimeMs < WINDOWS_SPAWN_WRAPPER_STALE_MS) {
        continue;
      }
      fs12.unlinkSync(wrapperPath);
    } catch {
    }
  }
}
function buildWindowsDetachedWrapperScript(command, args, logPath, stderrLogPath, env) {
  const lines = ["$ErrorActionPreference = 'Stop'"];
  for (const [key, value] of Object.entries(env)) {
    if (value !== void 0 && value !== process.env[key]) {
      lines.push(
        `[Environment]::SetEnvironmentVariable(${toPowerShellSingleQuotedString(key)}, ${toPowerShellSingleQuotedString(value)}, 'Process')`
      );
    }
  }
  lines.push(
    `$logPath = ${toPowerShellSingleQuotedString(logPath)}`,
    `$stderrLogPath = ${toPowerShellSingleQuotedString(stderrLogPath)}`,
    `$commandPath = ${toPowerShellSingleQuotedString(command)}`,
    `$commandArgs = ${toPowerShellStringArrayLiteral(args)}`,
    "$exitCode = 1",
    "try {",
    "  & $commandPath @commandArgs >> $logPath 2>> $stderrLogPath",
    "  $exitCode = if ($null -ne $LASTEXITCODE) { $LASTEXITCODE } else { 0 }",
    "} finally {",
    "  Remove-Item -LiteralPath $PSCommandPath -Force -ErrorAction SilentlyContinue",
    "}",
    "exit $exitCode"
  );
  return `${lines.join("\r\n")}\r
`;
}
function resolveWritableStderrLogPath(logPath, fileOps = fs12) {
  const defaultPath = stderrLogFilePath(logPath);
  fileOps.mkdirSync(path12.dirname(defaultPath), { recursive: true });
  try {
    const fd = fileOps.openSync(defaultPath, "a");
    fileOps.closeSync(fd);
    return defaultPath;
  } catch {
    return `${defaultPath}.${process.pid}.${randomBytes(4).toString("hex")}`;
  }
}
function startWindowsDetachedProcess(command, args, repoRoot, logPath, env = process.env) {
  const stderrLogPath = resolveWritableStderrLogPath(logPath);
  const powerShellCommand = resolvePowerShellCommand();
  cleanupStaleWindowsSpawnWrappers();
  const wrapperPath = path12.join(
    os4.tmpdir(),
    `${WINDOWS_SPAWN_WRAPPER_PREFIX}${randomBytes(4).toString("hex")}.ps1`
  );
  fs12.writeFileSync(
    wrapperPath,
    buildWindowsDetachedWrapperScript(
      command,
      args,
      logPath,
      stderrLogPath,
      env
    )
  );
  const psCommand = [
    "$p = Start-Process",
    `-FilePath ${toPowerShellSingleQuotedString(powerShellCommand)}`,
    `-ArgumentList ${toPowerShellStringArrayLiteral(["-NoLogo", "-NoProfile", "-File", wrapperPath])}`,
    `-WorkingDirectory ${toPowerShellSingleQuotedString(repoRoot)}`,
    "-WindowStyle Hidden",
    "-PassThru",
    "; Write-Output $p.Id"
  ].join(" ");
  const result = spawnSync3(
    powerShellCommand,
    ["-NoLogo", "-NoProfile", "-Command", psCommand],
    {
      encoding: "utf-8",
      windowsHide: true
    }
  );
  if (result.status !== 0) {
    removeFileIfExists2(wrapperPath);
    return null;
  }
  const pid = parseInt(result.stdout.trim(), 10);
  if (!Number.isFinite(pid)) {
    removeFileIfExists2(wrapperPath);
    return null;
  }
  return pid;
}
function startWindowsCodexAppServer(command, url, repoRoot, logPath, env = process.env, unsandboxed = false) {
  const { command: exe, prefixArgs } = splitResolvedCommand(command);
  return startWindowsDetachedProcess(
    exe,
    [
      ...prefixArgs,
      ...unsandboxed ? ["--dangerously-bypass-approvals-and-sandbox"] : [],
      "app-server",
      "--listen",
      url
    ],
    repoRoot,
    logPath,
    env
  );
}
function findListeningProcessId(url, platform) {
  if (platform !== "win32") {
    return null;
  }
  let port;
  try {
    const parsed = new URL(url);
    port = parsed.port ? Number.parseInt(parsed.port, 10) : null;
  } catch {
    return null;
  }
  if (port == null || !Number.isFinite(port)) {
    return null;
  }
  const result = spawnSync3(
    resolvePowerShellCommand(),
    [
      "-NoLogo",
      "-NoProfile",
      "-Command",
      [
        `$port = ${port}`,
        "$processId = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty OwningProcess",
        "if ($processId) { $processId }"
      ].join("; ")
    ],
    {
      encoding: "utf-8",
      windowsHide: true
    }
  );
  if (result.status !== 0) {
    return null;
  }
  const parsedPid = Number.parseInt((result.stdout ?? "").trim(), 10);
  return Number.isFinite(parsedPid) ? parsedPid : null;
}
var WINDOWS_SPAWN_WRAPPER_PREFIX, WINDOWS_SPAWN_WRAPPER_STALE_MS;
var init_bridge_windows_spawn = __esm({
  "src/engine/bridge-windows-spawn.ts"() {
    "use strict";
    init_bridge_paths();
    init_bridge_file_io();
    init_bridge_codex_command();
    WINDOWS_SPAWN_WRAPPER_PREFIX = "tap-spawn-";
    WINDOWS_SPAWN_WRAPPER_STALE_MS = 60 * 60 * 1e3;
  }
});

// src/engine/bridge-unix-spawn.ts
import * as fs13 from "fs";
import { spawn, spawnSync as spawnSync4 } from "child_process";
function resolveUnixSpawnCommand(command, args, platform) {
  if (platform === "linux") {
    return {
      command: "nohup",
      args: [command, ...args]
    };
  }
  return { command, args };
}
function findListeningPidWithLsof(port) {
  const result = spawnSync4(
    "lsof",
    ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"],
    {
      encoding: "utf-8",
      windowsHide: true
    }
  );
  if (!result || result.status !== 0) {
    return null;
  }
  const parsedPid = Number.parseInt((result.stdout ?? "").trim(), 10);
  return Number.isFinite(parsedPid) ? parsedPid : null;
}
function findListeningPidWithSs(port) {
  const result = spawnSync4("ss", ["-ltnpH", `sport = :${port}`], {
    encoding: "utf-8",
    windowsHide: true
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
function startUnixDetachedProcess(command, args, repoRoot, logPath, env = process.env, platform = DEFAULT_UNIX_PLATFORM) {
  const stderrPath = stderrLogFilePath(logPath);
  let logFd = null;
  let stderrFd = null;
  try {
    logFd = fs13.openSync(logPath, "a");
    stderrFd = fs13.openSync(stderrPath, "a");
    const launch = resolveUnixSpawnCommand(command, args, platform);
    const child = spawn(launch.command, launch.args, {
      cwd: repoRoot,
      detached: true,
      stdio: ["ignore", logFd, stderrFd],
      env,
      windowsHide: true
    });
    child.unref();
    return child.pid ?? null;
  } finally {
    if (logFd != null) {
      fs13.closeSync(logFd);
    }
    if (stderrFd != null) {
      fs13.closeSync(stderrFd);
    }
  }
}
function startUnixCodexAppServer(command, url, repoRoot, logPath, env = process.env, platform = DEFAULT_UNIX_PLATFORM, unsandboxed = false) {
  const { command: exe, prefixArgs } = splitResolvedCommand(command);
  return startUnixDetachedProcess(
    exe,
    [
      ...prefixArgs,
      ...unsandboxed ? ["--dangerously-bypass-approvals-and-sandbox"] : [],
      "app-server",
      "--listen",
      url
    ],
    repoRoot,
    logPath,
    env,
    platform
  );
}
function findUnixListeningProcessId(url, platform) {
  if (platform === "win32") {
    return null;
  }
  let port;
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
var DEFAULT_UNIX_PLATFORM;
var init_bridge_unix_spawn = __esm({
  "src/engine/bridge-unix-spawn.ts"() {
    "use strict";
    init_bridge_codex_command();
    init_bridge_paths();
    DEFAULT_UNIX_PLATFORM = process.platform === "darwin" ? "darwin" : "linux";
  }
});

// src/engine/bridge-config.ts
import * as fs14 from "fs";
import * as path13 from "path";
function resolveAgentName(instanceId, explicit, context) {
  if (explicit) return explicit;
  try {
    const repoRoot = context?.repoRoot ?? context?.stateDir?.replace(/[\\/].tap-comms$/, "") ?? process.cwd();
    const { config: resolved } = resolveConfig({}, repoRoot);
    const commsDir = resolved.commsDir;
    const heartbeatsPath = path13.join(commsDir, "heartbeats.json");
    if (fs14.existsSync(heartbeatsPath)) {
      const store = JSON.parse(
        fs14.readFileSync(heartbeatsPath, "utf-8")
      );
      const normalizedId = instanceId.replace(/-/g, "_");
      for (const [key, hb] of Object.entries(store)) {
        const keyNormalized = key.replace(/-/g, "_");
        const matchesId = keyNormalized === normalizedId || hb.instanceId === instanceId || hb.instanceId === normalizedId;
        if (!matchesId) continue;
        if (!hb.agent || hb.agent === "unknown" || hb.agent === "unnamed")
          continue;
        const activityMs = hb.lastActivity ? new Date(hb.lastActivity).getTime() : 0;
        const timestampMs = hb.timestamp ? new Date(hb.timestamp).getTime() : 0;
        const freshestMs = Math.max(activityMs, timestampMs);
        if (Date.now() - freshestMs < HEARTBEAT_RECOVERY_MAX_AGE_MS) {
          return hb.agent;
        }
      }
    }
  } catch {
  }
  try {
    const repoRoot = context?.repoRoot ?? context?.stateDir?.replace(/[\\/].tap-comms$/, "") ?? process.cwd();
    const state = loadState(repoRoot);
    const inst = state?.instances[instanceId];
    const stateAgent = inst?.defaultAgentName;
    if (stateAgent) return stateAgent;
  } catch {
  }
  if (context?.stateDir) {
    try {
      const instConfig = loadInstanceConfig(context.stateDir, instanceId);
      const instName = instConfig?.defaultAgentName;
      if (instName) return instName;
    } catch {
    }
  }
  return process.env.TAP_AGENT_NAME || process.env.CODEX_TAP_AGENT_NAME || null;
}
function inferRestartMode(bridgeState, flags, savedMode) {
  const wasManaged = bridgeState?.appServer != null;
  const hadAuth = bridgeState?.appServer?.auth != null;
  const wasUnsandboxed = bridgeState?.appServer?.manualCommand.includes(
    "--dangerously-bypass-approvals-and-sandbox"
  ) ?? false;
  const manageAppServer = flags?.noServer === true ? false : flags?.noServer === void 0 ? savedMode?.manageAppServer ?? wasManaged : true;
  const noAuth = flags?.noAuth === true ? true : flags?.noAuth === void 0 ? savedMode?.noAuth ?? !hadAuth : false;
  const appServerUnsandboxed = flags?.unsandboxed === true ? true : flags?.unsandboxed === void 0 ? savedMode?.appServerUnsandboxed ?? wasUnsandboxed : false;
  return { manageAppServer, noAuth, appServerUnsandboxed };
}
function cleanupHeadlessDispatch(inboxDir, agentName) {
  const removed = [];
  if (!fs14.existsSync(inboxDir)) return removed;
  const normalizedAgent = agentName.replace(/-/g, "_");
  const marker = `-headless-${normalizedAgent}-review-`;
  try {
    for (const file of fs14.readdirSync(inboxDir)) {
      if (file.includes(marker)) {
        fs14.unlinkSync(path13.join(inboxDir, file));
        removed.push(file);
      }
    }
  } catch {
  }
  return removed;
}
var HEARTBEAT_RECOVERY_MAX_AGE_MS;
var init_bridge_config = __esm({
  "src/engine/bridge-config.ts"() {
    "use strict";
    init_state();
    init_instance_config();
    init_resolve();
    HEARTBEAT_RECOVERY_MAX_AGE_MS = 24 * 60 * 60 * 1e3;
  }
});

// src/engine/server-lifecycle.ts
function lifecycleMeta(persistedLifecycle) {
  return {
    lastTransitionAt: persistedLifecycle?.lastTransitionAt ?? null,
    lastTransitionReason: persistedLifecycle?.lastTransitionReason ?? null,
    restartCount: persistedLifecycle?.restartCount ?? 0
  };
}
function resolveBridgeLifecycleSnapshot(stateDir, instanceId, fallbackBridgeState, persistedLifecycle) {
  const persistedBridgeState = loadBridgeState(stateDir, instanceId) ?? fallbackBridgeState ?? null;
  const bridgeStatus = getBridgeStatus(stateDir, instanceId);
  const bridgeState = bridgeStatus === "running" ? loadBridgeState(stateDir, instanceId) ?? persistedBridgeState : persistedBridgeState;
  return deriveBridgeLifecycleState({
    bridgeStatus,
    bridgeState,
    runtimeHeartbeat: loadRuntimeBridgeHeartbeat(bridgeState),
    savedThread: loadRuntimeBridgeThreadState(bridgeState),
    persistedLifecycle
  });
}
function deriveBridgeLifecycleState(options) {
  const runtimeHeartbeat = options.runtimeHeartbeat ?? null;
  const savedThread = options.savedThread ?? null;
  const meta = lifecycleMeta(
    options.persistedLifecycle ?? options.bridgeState?.lifecycle ?? null
  );
  if (options.bridgeStatus === "stopped") {
    return {
      presence: "stopped",
      status: "stopped",
      summary: "stopped",
      ...meta,
      threadId: null,
      threadCwd: null,
      savedThreadId: savedThread?.threadId ?? null,
      savedThreadCwd: savedThread?.cwd ?? null,
      activeTurnId: null,
      connected: null,
      initialized: null,
      appServerHealthy: options.bridgeState?.appServer?.healthy ?? null
    };
  }
  if (options.bridgeStatus === "stale") {
    return {
      presence: "bridge-stale",
      status: "bridge-stale",
      summary: "bridge-stale",
      ...meta,
      threadId: runtimeHeartbeat?.threadId ?? null,
      threadCwd: runtimeHeartbeat?.threadCwd ?? null,
      savedThreadId: savedThread?.threadId ?? null,
      savedThreadCwd: savedThread?.cwd ?? null,
      activeTurnId: runtimeHeartbeat?.activeTurnId ?? null,
      connected: runtimeHeartbeat?.connected ?? null,
      initialized: runtimeHeartbeat?.initialized ?? null,
      appServerHealthy: options.bridgeState?.appServer?.healthy ?? null
    };
  }
  const appServerHealthy = options.bridgeState?.appServer?.healthy ?? null;
  const threadId = runtimeHeartbeat?.threadId ?? null;
  const threadCwd = runtimeHeartbeat?.threadCwd ?? null;
  const connected = runtimeHeartbeat?.connected ?? null;
  const initialized = runtimeHeartbeat?.initialized ?? null;
  if (!runtimeHeartbeat) {
    return {
      presence: "bridge-live",
      status: "initializing",
      summary: "bridge-live, initializing",
      ...meta,
      threadId: null,
      threadCwd: null,
      savedThreadId: savedThread?.threadId ?? null,
      savedThreadCwd: savedThread?.cwd ?? null,
      activeTurnId: null,
      connected: null,
      initialized: null,
      appServerHealthy
    };
  }
  if (initialized === false) {
    return {
      presence: "bridge-live",
      status: "initializing",
      summary: "bridge-live, initializing",
      ...meta,
      threadId,
      threadCwd,
      savedThreadId: savedThread?.threadId ?? null,
      savedThreadCwd: savedThread?.cwd ?? null,
      activeTurnId: runtimeHeartbeat.activeTurnId ?? null,
      connected,
      initialized,
      appServerHealthy
    };
  }
  if (threadId && connected !== false) {
    return {
      presence: "bridge-live",
      status: "ready",
      summary: "bridge-live, ready",
      ...meta,
      threadId,
      threadCwd,
      savedThreadId: savedThread?.threadId ?? null,
      savedThreadCwd: savedThread?.cwd ?? null,
      activeTurnId: runtimeHeartbeat.activeTurnId ?? null,
      connected,
      initialized,
      appServerHealthy
    };
  }
  const degradedReason = savedThread?.threadId ? "saved thread only" : connected === false ? "disconnected" : "no active thread";
  return {
    presence: "bridge-live",
    status: "degraded-no-thread",
    summary: `bridge-live, degraded-no-thread (${degradedReason})`,
    ...meta,
    threadId,
    threadCwd,
    savedThreadId: savedThread?.threadId ?? null,
    savedThreadCwd: savedThread?.cwd ?? null,
    activeTurnId: runtimeHeartbeat.activeTurnId ?? null,
    connected,
    initialized,
    appServerHealthy
  };
}
var init_server_lifecycle = __esm({
  "src/engine/server-lifecycle.ts"() {
    "use strict";
    init_bridge_state();
    init_bridge_observability();
  }
});

// src/engine/codex-session-state.ts
import * as fs15 from "fs";
import * as path14 from "path";
function readLastDispatchAt(runtimeStateDir) {
  if (!runtimeStateDir) return null;
  const filePath = path14.join(runtimeStateDir, "last-dispatch.json");
  if (!fs15.existsSync(filePath)) return null;
  try {
    const parsed = JSON.parse(
      fs15.readFileSync(filePath, "utf-8")
    );
    return typeof parsed.dispatchedAt === "string" ? parsed.dispatchedAt : null;
  } catch {
    return null;
  }
}
function formatIdleSummary(idleSince) {
  if (!idleSince) return "idle";
  return `idle since ${idleSince}`;
}
function deriveCodexSessionState(options) {
  const runtimeHeartbeat = options.runtimeHeartbeat ?? null;
  if (!runtimeHeartbeat) {
    return {
      status: "initializing",
      turnState: null,
      summary: "initializing",
      activeTurnId: null,
      lastTurnAt: null,
      lastDispatchAt: null,
      idleSince: null,
      connected: null,
      initialized: null
    };
  }
  const turnState = runtimeHeartbeat.turnState ?? null;
  const activeTurnId = runtimeHeartbeat.activeTurnId ?? null;
  const lastTurnAt = runtimeHeartbeat.lastTurnAt ?? null;
  const lastDispatchAt = runtimeHeartbeat.lastDispatchAt ?? readLastDispatchAt(options.runtimeStateDir) ?? null;
  const idleSince = runtimeHeartbeat.idleSince ?? null;
  const connected = runtimeHeartbeat.connected ?? null;
  const initialized = runtimeHeartbeat.initialized ?? null;
  if (initialized === false) {
    return {
      status: "initializing",
      turnState,
      summary: "initializing",
      activeTurnId,
      lastTurnAt,
      lastDispatchAt,
      idleSince,
      connected,
      initialized
    };
  }
  if (turnState === "active" || activeTurnId) {
    return {
      status: "active",
      turnState: "active",
      summary: activeTurnId ? `active turn ${activeTurnId}` : "active",
      activeTurnId,
      lastTurnAt,
      lastDispatchAt,
      idleSince: null,
      connected,
      initialized
    };
  }
  if (turnState === "waiting-approval") {
    return {
      status: "waiting-approval",
      turnState,
      summary: `waiting-approval (${formatIdleSummary(idleSince)})`,
      activeTurnId,
      lastTurnAt,
      lastDispatchAt,
      idleSince,
      connected,
      initialized
    };
  }
  if (turnState === "disconnected" || connected === false) {
    return {
      status: "disconnected",
      turnState: "disconnected",
      summary: "disconnected",
      activeTurnId,
      lastTurnAt,
      lastDispatchAt,
      idleSince: null,
      connected,
      initialized
    };
  }
  return {
    status: "idle",
    turnState: turnState === "idle" ? turnState : "idle",
    summary: formatIdleSummary(idleSince),
    activeTurnId,
    lastTurnAt,
    lastDispatchAt,
    idleSince,
    connected,
    initialized
  };
}
var init_codex_session_state = __esm({
  "src/engine/codex-session-state.ts"() {
    "use strict";
  }
});

// src/engine/bridge-app-server-health.ts
import * as net2 from "net";
async function checkAppServerHealth(url, timeoutMs = APP_SERVER_HEALTH_TIMEOUT_MS, gatewayToken) {
  const WebSocket2 = getWebSocketCtor();
  if (!WebSocket2) {
    return false;
  }
  return new Promise((resolve21) => {
    let settled = false;
    let socket = null;
    const finish = (healthy) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      try {
        socket?.close();
      } catch {
      }
      resolve21(healthy);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    try {
      const protocols = gatewayToken ? [`${AUTH_SUBPROTOCOL_PREFIX}${gatewayToken}`] : void 0;
      socket = new WebSocket2(url, protocols);
      socket.addEventListener("open", () => finish(true), { once: true });
      socket.addEventListener("error", () => finish(false), { once: true });
      socket.addEventListener("close", () => finish(false), { once: true });
    } catch {
      finish(false);
    }
  });
}
function buildAppServerReadyzUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol === "ws:") {
    parsed.protocol = "http:";
  } else if (parsed.protocol === "wss:") {
    parsed.protocol = "https:";
  } else if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return null;
  }
  parsed.pathname = APP_SERVER_READYZ_PATH;
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString();
}
async function checkAppServerReadyz(url, timeoutMs = APP_SERVER_HEALTH_TIMEOUT_MS) {
  const readyzUrl = buildAppServerReadyzUrl(url);
  if (!readyzUrl) {
    return "unsupported";
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(readyzUrl, {
      method: "GET",
      signal: controller.signal,
      headers: {
        accept: "application/json"
      }
    });
    if (response.ok) {
      return "ready";
    }
    if (response.status === 400 || response.status === 404 || response.status === 405 || response.status === 426 || response.status === 501) {
      return "unsupported";
    }
    return "not-ready";
  } catch {
    return "not-ready";
  } finally {
    clearTimeout(timer);
  }
}
async function checkTcpPortListening(url, timeoutMs = APP_SERVER_HEALTH_TIMEOUT_MS) {
  let hostname;
  let port;
  try {
    const parsed = new URL(url.replace(/^ws/, "http"));
    hostname = parsed.hostname;
    port = parseInt(parsed.port, 10);
  } catch {
    return false;
  }
  if (!port || !Number.isFinite(port)) return false;
  return new Promise((resolve21) => {
    const socket = net2.createConnection({ host: hostname, port });
    const timer = setTimeout(() => {
      socket.destroy();
      resolve21(false);
    }, timeoutMs);
    socket.once("connect", () => {
      clearTimeout(timer);
      socket.destroy();
      resolve21(true);
    });
    socket.once("error", () => {
      clearTimeout(timer);
      socket.destroy();
      resolve21(false);
    });
  });
}
async function checkManagedAppServerReady(url, timeoutMs = APP_SERVER_HEALTH_TIMEOUT_MS) {
  const readyzStatus = await checkAppServerReadyz(url, timeoutMs);
  if (readyzStatus === "ready") {
    return true;
  }
  if (readyzStatus === "unsupported") {
    return checkTcpPortListening(url, timeoutMs);
  }
  return false;
}
async function waitForManagedAppServerReady(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const remaining = Math.max(
      1,
      Math.min(APP_SERVER_HEALTH_TIMEOUT_MS, deadline - Date.now())
    );
    if (await checkManagedAppServerReady(url, remaining)) {
      return true;
    }
    await delay(APP_SERVER_HEALTH_RETRY_MS);
  }
  return false;
}
function markAppServerHealthy(appServer) {
  const checkedAt = (/* @__PURE__ */ new Date()).toISOString();
  return {
    ...appServer,
    healthy: true,
    lastCheckedAt: checkedAt,
    lastHealthyAt: checkedAt
  };
}
var APP_SERVER_HEALTH_TIMEOUT_MS, APP_SERVER_HEALTH_RETRY_MS, APP_SERVER_READYZ_PATH, AUTH_SUBPROTOCOL_PREFIX;
var init_bridge_app_server_health = __esm({
  "src/engine/bridge-app-server-health.ts"() {
    "use strict";
    init_bridge_port_network();
    APP_SERVER_HEALTH_TIMEOUT_MS = 1500;
    APP_SERVER_HEALTH_RETRY_MS = 250;
    APP_SERVER_READYZ_PATH = "/readyz";
    AUTH_SUBPROTOCOL_PREFIX = "tap-auth-";
  }
});

// src/runtime/resolve-node.ts
import * as fs16 from "fs";
import * as path15 from "path";
import { execSync as execSync2 } from "child_process";
function readNodeVersion(repoRoot) {
  const nvFile = path15.join(repoRoot, ".node-version");
  if (!fs16.existsSync(nvFile)) return null;
  try {
    const raw = fs16.readFileSync(nvFile, "utf-8").trim();
    return raw.length > 0 ? raw.replace(/^v/, "") : null;
  } catch {
    return null;
  }
}
function fnmCandidateDirs() {
  if (process.platform === "win32") {
    return [
      process.env.FNM_DIR,
      process.env.APPDATA ? path15.join(process.env.APPDATA, "fnm") : null,
      process.env.LOCALAPPDATA ? path15.join(process.env.LOCALAPPDATA, "fnm") : null,
      process.env.USERPROFILE ? path15.join(process.env.USERPROFILE, "scoop", "persist", "fnm") : null
    ].filter(Boolean);
  }
  return [
    process.env.FNM_DIR,
    process.env.HOME ? path15.join(process.env.HOME, ".local", "share", "fnm") : null,
    process.env.HOME ? path15.join(process.env.HOME, ".fnm") : null,
    process.env.XDG_DATA_HOME ? path15.join(process.env.XDG_DATA_HOME, "fnm") : null
  ].filter(Boolean);
}
function nodeExecutableName() {
  return process.platform === "win32" ? "node.exe" : "node";
}
function probeFnmNode(desiredVersion) {
  const dirs = fnmCandidateDirs();
  const exe = nodeExecutableName();
  for (const baseDir of dirs) {
    const candidate = path15.join(
      baseDir,
      "node-versions",
      `v${desiredVersion}`,
      "installation",
      exe
    );
    if (!fs16.existsSync(candidate)) continue;
    try {
      const v = execSync2(`"${candidate}" --version`, {
        encoding: "utf-8",
        timeout: 5e3
      }).trim();
      if (v.startsWith(`v${desiredVersion.split(".")[0]}.`)) {
        return candidate;
      }
    } catch {
    }
  }
  return null;
}
function detectNodeMajorVersion(command) {
  try {
    const version2 = execSync2(`"${command}" --version`, {
      encoding: "utf-8",
      timeout: 5e3
    }).trim();
    const match = version2.match(/^v?(\d+)\./);
    return match ? parseInt(match[1], 10) : null;
  } catch {
    return null;
  }
}
function checkStripTypesSupport(command) {
  const major = detectNodeMajorVersion(command);
  if (major !== null && major >= 22) return true;
  try {
    execSync2(`"${command}" --experimental-strip-types -e ""`, {
      timeout: 5e3,
      stdio: "pipe"
    });
    return true;
  } catch {
    return false;
  }
}
function findTsxFallback(repoRoot) {
  const candidates = [
    path15.join(repoRoot, "node_modules", ".bin", "tsx.exe"),
    path15.join(repoRoot, "node_modules", ".bin", "tsx.CMD"),
    path15.join(repoRoot, "node_modules", ".bin", "tsx")
  ];
  for (const c of candidates) {
    if (fs16.existsSync(c)) return c;
  }
  return null;
}
function getFnmBinDir(repoRoot) {
  const desiredVersion = readNodeVersion(repoRoot);
  if (!desiredVersion) return null;
  const nodePath = probeFnmNode(desiredVersion);
  if (!nodePath) return null;
  return path15.dirname(nodePath);
}
function resolveNodeRuntime(configCommand, repoRoot) {
  if (configCommand === "bun" || configCommand.endsWith("bun.exe")) {
    return {
      command: configCommand,
      supportsStripTypes: false,
      source: "bun",
      majorVersion: null
    };
  }
  const desiredVersion = readNodeVersion(repoRoot);
  if (desiredVersion) {
    const fnmNode = probeFnmNode(desiredVersion);
    if (fnmNode) {
      const major2 = detectNodeMajorVersion(fnmNode);
      return {
        command: fnmNode,
        supportsStripTypes: checkStripTypesSupport(fnmNode),
        source: "fnm",
        majorVersion: major2
      };
    }
  }
  const major = detectNodeMajorVersion(configCommand);
  if (major !== null) {
    return {
      command: configCommand,
      supportsStripTypes: checkStripTypesSupport(configCommand),
      source: major === detectNodeMajorVersion("node") ? "path" : "config",
      majorVersion: major
    };
  }
  const tsx = findTsxFallback(repoRoot);
  if (tsx) {
    return {
      command: tsx,
      supportsStripTypes: false,
      source: "tsx-fallback",
      majorVersion: null
    };
  }
  return {
    command: configCommand,
    supportsStripTypes: false,
    source: "path",
    majorVersion: null
  };
}
function buildRuntimeEnv(repoRoot, baseEnv = process.env) {
  const fnmBin = getFnmBinDir(repoRoot);
  if (!fnmBin) return { ...baseEnv };
  const pathKey = process.platform === "win32" ? "Path" : "PATH";
  const currentPath = baseEnv[pathKey] ?? baseEnv.PATH ?? "";
  return {
    ...baseEnv,
    [pathKey]: `${fnmBin}${path15.delimiter}${currentPath}`
  };
}
var init_resolve_node = __esm({
  "src/runtime/resolve-node.ts"() {
    "use strict";
  }
});

// src/runtime/index.ts
var init_runtime = __esm({
  "src/runtime/index.ts"() {
    "use strict";
    init_resolve_node();
  }
});

// src/engine/bridge-app-server-auth.ts
import * as fs17 from "fs";
import * as path16 from "path";
import { randomBytes as randomBytes2 } from "crypto";
function buildProtectedAppServerUrl(publicUrl, _token) {
  return publicUrl;
}
function readGatewayTokenFromPath(tokenPath) {
  return fs17.readFileSync(tokenPath, "utf8").trim();
}
function readGatewayToken(auth) {
  if (!auth) {
    return null;
  }
  const legacyToken = auth.token;
  if (legacyToken?.trim()) {
    return legacyToken.trim();
  }
  if (!auth.tokenPath || !fs17.existsSync(auth.tokenPath)) {
    return null;
  }
  const fileToken = readGatewayTokenFromPath(auth.tokenPath);
  return fileToken || null;
}
function materializeGatewayTokenFile(stateDir, instanceId, publicUrl, auth) {
  if (auth.tokenPath && fs17.existsSync(auth.tokenPath)) {
    return auth;
  }
  const token = readGatewayToken(auth);
  if (!token) {
    throw new Error(`Missing auth gateway token for ${instanceId}`);
  }
  const tokenPath = appServerGatewayTokenFilePath(stateDir, instanceId);
  writeProtectedTextFile(tokenPath, `${token}
`);
  return {
    ...auth,
    protectedUrl: buildProtectedAppServerUrl(publicUrl, "***"),
    tokenPath
  };
}
async function createManagedAppServerAuth(options) {
  const publicUrl = new URL(options.publicUrl);
  const upstreamUrl = new URL(options.publicUrl);
  upstreamUrl.port = String(await allocateLoopbackPort(publicUrl.hostname));
  upstreamUrl.search = "";
  upstreamUrl.hash = "";
  const gatewayScript = resolveAuthGatewayScript(options.repoRoot);
  if (!gatewayScript) {
    throw new Error("Auth gateway script not found");
  }
  const token = randomBytes2(24).toString("base64url");
  const tokenPath = appServerGatewayTokenFilePath(
    options.stateDir,
    options.instanceId
  );
  writeProtectedTextFile(tokenPath, `${token}
`);
  const protectedUrl = buildProtectedAppServerUrl(options.publicUrl, "***");
  const gatewayLogPath = appServerGatewayLogFilePath(
    options.stateDir,
    options.instanceId
  );
  fs17.mkdirSync(path16.dirname(gatewayLogPath), { recursive: true });
  rotateLog(gatewayLogPath);
  const runtime = resolveNodeRuntime(process.execPath, options.repoRoot);
  const gatewayArgs = [];
  if (gatewayScript.endsWith(".ts")) {
    if (!runtime.supportsStripTypes) {
      throw new Error(
        "Current Node runtime cannot start the auth gateway from TypeScript source. Rebuild @hua-labs/tap or use Node 22.6+."
      );
    }
    gatewayArgs.push("--experimental-strip-types");
  }
  gatewayArgs.push(gatewayScript);
  const gatewayEnv = {
    ...buildRuntimeEnv(options.repoRoot),
    TAP_GATEWAY_LISTEN_URL: options.publicUrl,
    TAP_GATEWAY_UPSTREAM_URL: upstreamUrl.toString().replace(/\/$/, ""),
    TAP_GATEWAY_TOKEN_FILE: tokenPath
  };
  let gatewayPid;
  try {
    gatewayPid = options.platform === "win32" ? startWindowsDetachedProcess(
      runtime.command,
      gatewayArgs,
      options.repoRoot,
      gatewayLogPath,
      gatewayEnv
    ) : startUnixDetachedProcess(
      runtime.command,
      gatewayArgs,
      options.repoRoot,
      gatewayLogPath,
      gatewayEnv,
      options.platform
    );
  } catch (error) {
    removeFileIfExists2(tokenPath);
    throw error;
  }
  if (gatewayPid == null) {
    removeFileIfExists2(tokenPath);
    throw new Error("Failed to spawn app-server auth gateway");
  }
  return {
    mode: "subprotocol",
    protectedUrl,
    upstreamUrl: upstreamUrl.toString().replace(/\/$/, ""),
    tokenPath,
    gatewayPid,
    gatewayLogPath
  };
}
function canReuseManagedAppServer(appServer) {
  if (!appServer?.managed) {
    return false;
  }
  if (appServer.pid != null && !isProcessAlive(appServer.pid)) {
    return false;
  }
  const auth = appServer.auth;
  if (auth) {
    if (!auth.protectedUrl) {
      return false;
    }
    if (!readGatewayToken(auth)) {
      return false;
    }
    if (auth.gatewayPid != null && !isProcessAlive(auth.gatewayPid)) {
      return false;
    }
  }
  return true;
}
var init_bridge_app_server_auth = __esm({
  "src/engine/bridge-app-server-auth.ts"() {
    "use strict";
    init_runtime();
    init_bridge_paths();
    init_bridge_file_io();
    init_bridge_port_network();
    init_bridge_codex_command();
    init_bridge_process_control();
    init_bridge_windows_spawn();
    init_bridge_unix_spawn();
    init_bridge_observability();
  }
});

// src/engine/bridge-app-server-lifecycle.ts
import * as fs18 from "fs";
import * as path17 from "path";
function buildCodexAppServerEnv(options) {
  return {
    ...process.env,
    TAP_COMMS_DIR: options.commsDir,
    TAP_STATE_DIR: options.stateDir,
    TAP_RUNTIME_STATE_DIR: options.runtimeStateDir,
    TAP_REPO_ROOT: options.repoRoot,
    TAP_BRIDGE_INSTANCE_ID: options.instanceId,
    TAP_AGENT_ID: options.instanceId,
    TAP_AGENT_NAME: options.agentName,
    CODEX_TAP_AGENT_NAME: options.agentName
  };
}
function isAppServerUsedByOtherBridge(stateDir, excludeInstanceId, appServer) {
  const pidDir = path17.join(stateDir, "pids");
  if (!fs18.existsSync(pidDir)) return false;
  for (const name of fs18.readdirSync(pidDir)) {
    if (!name.startsWith("bridge-") || !name.endsWith(".json")) continue;
    const otherId = name.slice("bridge-".length, -".json".length);
    if (otherId === excludeInstanceId) continue;
    try {
      const raw = fs18.readFileSync(path17.join(pidDir, name), "utf-8");
      const state = JSON.parse(raw);
      if (state.appServer?.url === appServer.url && state.appServer?.pid === appServer.pid && isProcessAlive(state.pid)) {
        return true;
      }
    } catch {
      continue;
    }
  }
  return false;
}
function findReusableManagedAppServer(stateDir, publicUrl) {
  const pidDir = path17.join(stateDir, "pids");
  if (!fs18.existsSync(pidDir)) {
    return null;
  }
  for (const name of fs18.readdirSync(pidDir)) {
    if (!name.startsWith("bridge-") || !name.endsWith(".json")) {
      continue;
    }
    try {
      const raw = fs18.readFileSync(path17.join(pidDir, name), "utf-8");
      const parsed = JSON.parse(raw);
      if (parsed.appServer?.url !== publicUrl) {
        continue;
      }
      if (canReuseManagedAppServer(parsed.appServer)) {
        return markAppServerHealthy(parsed.appServer);
      }
    } catch {
    }
  }
  return null;
}
function resolveAppServerUrl(baseUrl, port) {
  const resolvedBase = (baseUrl ?? DEFAULT_APP_SERVER_URL3).replace(/\/$/, "");
  if (port == null) {
    return resolvedBase;
  }
  try {
    const parsed = new URL(resolvedBase);
    parsed.port = String(port);
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return resolvedBase;
  }
}
async function ensureCodexAppServer(options) {
  const effectiveUrl = resolveAppServerUrl(options.appServerUrl);
  const fallbackManualCommand = formatCodexAppServerCommand(
    "codex",
    effectiveUrl,
    options.unsandboxed
  );
  if (options.existingAppServer?.url === effectiveUrl && canReuseManagedAppServer(options.existingAppServer)) {
    return markAppServerHealthy(options.existingAppServer);
  }
  const sharedManaged = findReusableManagedAppServer(
    options.stateDir,
    effectiveUrl
  );
  if (sharedManaged) {
    return sharedManaged;
  }
  let parsedUrl;
  try {
    parsedUrl = new URL(effectiveUrl);
  } catch {
    throw new Error(
      `Invalid app-server URL: ${effectiveUrl}
Start it manually:
  ${fallbackManualCommand}`
    );
  }
  if (!isLoopbackHost(parsedUrl.hostname)) {
    throw new Error(
      `Auto-start only supports loopback app-server URLs. Current URL: ${effectiveUrl}
Start it manually:
  ${fallbackManualCommand}`
    );
  }
  if (await checkAppServerHealth(effectiveUrl)) {
    const hint = options.noAuth ? "Stop it first or use --no-server for an unmanaged external app-server." : "A listener is already running, so tap cannot insert the auth gateway there.\nStop it first or use --no-server for an unmanaged external app-server.";
    throw new Error(`${effectiveUrl}: ${hint}`);
  }
  const resolvedCommand = resolveCodexCommand(options.platform);
  if (!resolvedCommand) {
    throw new Error(
      `Codex CLI not found in PATH.
Start the app-server manually:
  ${fallbackManualCommand}`
    );
  }
  const logPath = appServerLogFilePath(options.stateDir, options.instanceId);
  fs18.mkdirSync(path17.dirname(logPath), { recursive: true });
  rotateLog(logPath);
  const appServerEnv = buildCodexAppServerEnv(options);
  if (options.noAuth) {
    const manualCommand2 = formatCodexAppServerCommand(
      "codex",
      effectiveUrl,
      options.unsandboxed
    );
    let pid2;
    if (options.platform === "win32") {
      try {
        pid2 = startWindowsCodexAppServer(
          resolvedCommand,
          effectiveUrl,
          options.repoRoot,
          logPath,
          appServerEnv,
          options.unsandboxed
        );
      } catch (err) {
        throw new Error(
          `Failed to spawn Codex app-server: ${err instanceof Error ? err.message : String(err)}
Start it manually:
  ${manualCommand2}`,
          { cause: err }
        );
      }
    } else {
      try {
        pid2 = startUnixCodexAppServer(
          resolvedCommand,
          effectiveUrl,
          options.repoRoot,
          logPath,
          appServerEnv,
          options.platform,
          options.unsandboxed
        );
      } catch (err) {
        throw new Error(
          `Failed to spawn Codex app-server: ${err instanceof Error ? err.message : String(err)}
Start it manually:
  ${manualCommand2}`,
          { cause: err }
        );
      }
    }
    if (pid2 == null) {
      throw new Error(
        `Failed to spawn Codex app-server.
Start it manually:
  ${manualCommand2}`
      );
    }
    const healthy2 = await waitForManagedAppServerReady(
      effectiveUrl,
      APP_SERVER_START_TIMEOUT_MS
    );
    if (!healthy2) {
      await terminateProcess(pid2, options.platform);
      throw new Error(
        `Codex app-server did not become healthy at ${effectiveUrl}.
Check ${logPath}
Or start it manually:
  ${manualCommand2}`
      );
    }
    pid2 = (options.platform === "win32" ? findListeningProcessId(effectiveUrl, options.platform) : findUnixListeningProcessId(effectiveUrl, options.platform)) ?? pid2;
    const healthyAt2 = (/* @__PURE__ */ new Date()).toISOString();
    return {
      url: effectiveUrl,
      pid: pid2,
      managed: true,
      healthy: true,
      lastCheckedAt: healthyAt2,
      lastHealthyAt: healthyAt2,
      logPath,
      manualCommand: manualCommand2,
      auth: null
    };
  }
  const auth = await createManagedAppServerAuth({
    instanceId: options.instanceId,
    stateDir: options.stateDir,
    repoRoot: options.repoRoot,
    platform: options.platform,
    publicUrl: effectiveUrl
  });
  const manualCommand = formatCodexAppServerCommand(
    "codex",
    auth.upstreamUrl,
    options.unsandboxed
  );
  let pid;
  if (options.platform === "win32") {
    try {
      pid = startWindowsCodexAppServer(
        resolvedCommand,
        auth.upstreamUrl,
        options.repoRoot,
        logPath,
        appServerEnv,
        options.unsandboxed
      );
    } catch (err) {
      if (auth.gatewayPid != null) {
        await terminateProcess(auth.gatewayPid, options.platform);
      }
      removeFileIfExists2(auth.tokenPath);
      throw new Error(
        `Failed to spawn Codex app-server: ${err instanceof Error ? err.message : String(err)}
Start it manually:
  ${manualCommand}`,
        { cause: err }
      );
    }
  } else {
    try {
      pid = startUnixCodexAppServer(
        resolvedCommand,
        auth.upstreamUrl,
        options.repoRoot,
        logPath,
        appServerEnv,
        options.platform,
        options.unsandboxed
      );
    } catch (err) {
      if (auth.gatewayPid != null) {
        await terminateProcess(auth.gatewayPid, options.platform);
      }
      removeFileIfExists2(auth.tokenPath);
      throw new Error(
        `Failed to spawn Codex app-server: ${err instanceof Error ? err.message : String(err)}
Start it manually:
  ${manualCommand}`,
        { cause: err }
      );
    }
  }
  if (pid == null) {
    if (auth.gatewayPid != null) {
      await terminateProcess(auth.gatewayPid, options.platform);
    }
    removeFileIfExists2(auth.tokenPath);
    throw new Error(
      `Failed to spawn Codex app-server.
Start it manually:
  ${manualCommand}`
    );
  }
  const healthy = await waitForManagedAppServerReady(
    auth.upstreamUrl,
    APP_SERVER_START_TIMEOUT_MS
  );
  if (!healthy) {
    await terminateProcess(pid, options.platform);
    if (auth.gatewayPid != null) {
      await terminateProcess(auth.gatewayPid, options.platform);
    }
    removeFileIfExists2(auth.tokenPath);
    throw new Error(
      `Codex app-server did not become healthy at ${auth.upstreamUrl}.
Check ${logPath}
Or start it manually:
  ${manualCommand}`
    );
  }
  const gatewayToken = readGatewayToken(auth);
  if (!gatewayToken) {
    await terminateProcess(pid, options.platform);
    if (auth.gatewayPid != null) {
      await terminateProcess(auth.gatewayPid, options.platform);
    }
    removeFileIfExists2(auth.tokenPath);
    throw new Error("Tap auth gateway token is missing after startup.");
  }
  const gatewayHealthy = await waitForManagedAppServerReady(
    effectiveUrl,
    APP_SERVER_GATEWAY_START_TIMEOUT_MS
  );
  if (!gatewayHealthy) {
    await terminateProcess(pid, options.platform);
    if (auth.gatewayPid != null) {
      await terminateProcess(auth.gatewayPid, options.platform);
    }
    removeFileIfExists2(auth.tokenPath);
    throw new Error(
      `Tap auth gateway did not become healthy at ${effectiveUrl}.
Check ${auth.gatewayLogPath ?? "the gateway log"} and ${logPath}.`
    );
  }
  const healthyAt = (/* @__PURE__ */ new Date()).toISOString();
  pid = (options.platform === "win32" ? findListeningProcessId(auth.upstreamUrl, options.platform) : findUnixListeningProcessId(auth.upstreamUrl, options.platform)) ?? pid;
  return {
    url: effectiveUrl,
    pid,
    managed: true,
    healthy: true,
    lastCheckedAt: healthyAt,
    lastHealthyAt: healthyAt,
    logPath,
    manualCommand,
    auth
  };
}
function formatCodexAppServerCommand(command, url, unsandboxed = false) {
  return `${command}${unsandboxed ? " --dangerously-bypass-approvals-and-sandbox" : ""} app-server --listen ${url}`;
}
var DEFAULT_APP_SERVER_URL3, APP_SERVER_START_TIMEOUT_MS, APP_SERVER_GATEWAY_START_TIMEOUT_MS;
var init_bridge_app_server_lifecycle = __esm({
  "src/engine/bridge-app-server-lifecycle.ts"() {
    "use strict";
    init_bridge_paths();
    init_bridge_file_io();
    init_bridge_port_network();
    init_bridge_codex_command();
    init_bridge_windows_spawn();
    init_bridge_unix_spawn();
    init_bridge_process_control();
    init_bridge_app_server_health();
    init_bridge_app_server_auth();
    init_bridge_observability();
    DEFAULT_APP_SERVER_URL3 = "ws://127.0.0.1:4501";
    APP_SERVER_START_TIMEOUT_MS = 2e4;
    APP_SERVER_GATEWAY_START_TIMEOUT_MS = 5e3;
  }
});

// src/engine/bridge-startup.ts
import * as fs19 from "fs";
import * as path18 from "path";
function getBridgeRuntimeStateDir(repoRoot, instanceId) {
  const resolved = path18.resolve(
    path18.join(repoRoot, ".tmp", `codex-app-server-bridge-${instanceId}`)
  );
  const expectedBase = path18.resolve(repoRoot, ".tmp") + path18.sep;
  if (!resolved.startsWith(expectedBase)) {
    throw new Error(
      `Path traversal blocked: runtime state dir escapes .tmp/ directory`
    );
  }
  return resolved;
}
function warnHeartbeatCleanup(instanceId, message) {
  console.warn(`[tap] heartbeat cleanup skipped for ${instanceId}: ${message}`);
}
function getHeartbeatActivityMs(record) {
  const timestamp = new Date(
    record.lastActivity ?? record.timestamp ?? 0
  ).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}
function isSameInstanceHeartbeat(key, heartbeat, instanceId) {
  if (heartbeat.instanceId === instanceId) return true;
  if (heartbeat.connectHash === `instance:${instanceId}`) return true;
  return key === instanceId || key.replace(/_/g, "-") === instanceId || key.replace(/-/g, "_") === instanceId;
}
function cleanupStaleSameInstanceHeartbeats(commsDir, instanceId) {
  const heartbeatsPath = path18.join(commsDir, "heartbeats.json");
  if (!fs19.existsSync(heartbeatsPath)) return;
  const lockPath = path18.join(commsDir, ".heartbeats.lock");
  try {
    fs19.writeFileSync(lockPath, String(process.pid), { flag: "wx" });
  } catch {
    warnHeartbeatCleanup(instanceId, "heartbeat store busy");
    return;
  }
  try {
    let store = {};
    try {
      store = JSON.parse(fs19.readFileSync(heartbeatsPath, "utf-8"));
    } catch {
      warnHeartbeatCleanup(instanceId, "heartbeat store unreadable");
      return;
    }
    let changed = false;
    for (const [key, heartbeat] of Object.entries(store)) {
      if (!isSameInstanceHeartbeat(key, heartbeat, instanceId)) continue;
      const status = heartbeat.status ?? "active";
      const isDeadBridge = heartbeat.source === "bridge-dispatch" && heartbeat.bridgePid != null && !isProcessAlive(heartbeat.bridgePid);
      const activityMs = getHeartbeatActivityMs(heartbeat);
      const isStaleDirect = heartbeat.source !== "bridge-dispatch" && activityMs != null && Date.now() - activityMs > STALE_DIRECT_HEARTBEAT_MS;
      if (status === "signing-off" || isDeadBridge || isStaleDirect) {
        delete store[key];
        changed = true;
      }
    }
    if (!changed) return;
    const tmpPath = `${heartbeatsPath}.tmp.${process.pid}`;
    fs19.writeFileSync(tmpPath, JSON.stringify(store, null, 2), "utf-8");
    fs19.renameSync(tmpPath, heartbeatsPath);
  } catch (error) {
    warnHeartbeatCleanup(
      instanceId,
      error instanceof Error ? error.message : String(error)
    );
  } finally {
    try {
      fs19.unlinkSync(lockPath);
    } catch {
    }
  }
}
function bridgeStartupLockPath(stateDir, instanceId) {
  return path18.join(stateDir, "pids", `bridge-${instanceId}.startup.lock`);
}
function readBridgeStartupLock(lockPath) {
  if (!fs19.existsSync(lockPath)) {
    return null;
  }
  try {
    return JSON.parse(fs19.readFileSync(lockPath, "utf-8"));
  } catch {
    return null;
  }
}
function isBridgeStartupLockStale(lockPath) {
  try {
    const stats = fs19.statSync(lockPath);
    if (Date.now() - stats.mtimeMs > BRIDGE_STARTUP_LOCK_STALE_MS) {
      return true;
    }
  } catch {
    return true;
  }
  const record = readBridgeStartupLock(lockPath);
  if (record?.pid == null) {
    return false;
  }
  return !isProcessAlive(record.pid);
}
function tryAcquireBridgeStartupLock(stateDir, instanceId) {
  const lockPath = bridgeStartupLockPath(stateDir, instanceId);
  fs19.mkdirSync(path18.dirname(lockPath), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      fs19.writeFileSync(
        lockPath,
        JSON.stringify(
          {
            pid: process.pid,
            startedAt: (/* @__PURE__ */ new Date()).toISOString()
          },
          null,
          2
        ),
        { flag: "wx" }
      );
      return { path: lockPath };
    } catch {
      if (!isBridgeStartupLockStale(lockPath)) {
        return null;
      }
      try {
        fs19.unlinkSync(lockPath);
      } catch {
        return null;
      }
    }
  }
  return null;
}
async function acquireBridgeStartupLock(stateDir, instanceId) {
  const deadline = Date.now() + BRIDGE_STARTUP_WAIT_MS;
  while (true) {
    const lock = tryAcquireBridgeStartupLock(stateDir, instanceId);
    if (lock) {
      return { lock, existingState: null };
    }
    const existingState = loadBridgeState(stateDir, instanceId);
    if (existingState && isProcessAlive(existingState.pid)) {
      return {
        lock: null,
        existingState
      };
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `Bridge startup for ${instanceId} is already in progress`
      );
    }
    await delay(BRIDGE_STARTUP_POLL_MS);
  }
}
function releaseBridgeStartupLock(lock) {
  if (!lock) {
    return;
  }
  try {
    fs19.unlinkSync(lock.path);
  } catch {
  }
}
async function startBridge(options) {
  const {
    instanceId,
    runtime,
    stateDir,
    commsDir,
    bridgeScript,
    agentName,
    port
  } = options;
  const resolvedAgent = resolveAgentName(instanceId, agentName, {
    repoRoot: options.repoRoot,
    stateDir
  });
  if (!resolvedAgent) {
    throw new Error(
      `No agent name for ${instanceId} bridge. Set TAP_AGENT_NAME env var or pass --agent-name flag.`
    );
  }
  const startup = await acquireBridgeStartupLock(stateDir, instanceId);
  if (startup.existingState) {
    return startup.existingState;
  }
  if (isBridgeRunning(stateDir, instanceId)) {
    releaseBridgeStartupLock(startup.lock);
    const existing = loadBridgeState(stateDir, instanceId);
    throw new Error(
      `Bridge for ${instanceId} is already running (PID: ${existing.pid})`
    );
  }
  const previousBridgeState = loadBridgeState(stateDir, instanceId);
  const previousLifecycle = options.previousLifecycle ?? previousBridgeState?.lifecycle ?? null;
  const previousAppServer = options.existingAppServer ?? previousBridgeState?.appServer ?? null;
  clearBridgeState(stateDir, instanceId);
  cleanupStaleSameInstanceHeartbeats(commsDir, instanceId);
  const logPath = logFilePath(stateDir, instanceId);
  fs19.mkdirSync(path18.dirname(logPath), { recursive: true });
  rotateLog(logPath);
  const repoRoot = options.repoRoot ?? path18.resolve(stateDir, "..");
  const runtimeStateDir = getBridgeRuntimeStateDir(repoRoot, instanceId);
  const resolved = resolveNodeRuntime(
    options.runtimeCommand ?? "node",
    repoRoot
  );
  const command = resolved.command;
  const runtimeEnv = buildRuntimeEnv(repoRoot);
  const effectiveAppServerUrl = resolveAppServerUrl(options.appServerUrl, port);
  let appServer = null;
  let bridgeAppServerUrl = effectiveAppServerUrl;
  const startedAt = (/* @__PURE__ */ new Date()).toISOString();
  try {
    if (runtime === "codex" && options.manageAppServer) {
      appServer = await ensureCodexAppServer({
        instanceId,
        stateDir,
        runtimeStateDir,
        commsDir,
        repoRoot,
        platform: options.platform,
        appServerUrl: effectiveAppServerUrl,
        agentName: resolvedAgent,
        existingAppServer: previousAppServer,
        noAuth: options.noAuth,
        unsandboxed: options.appServerUnsandboxed
      });
      if (appServer.auth) {
        appServer = {
          ...appServer,
          auth: materializeGatewayTokenFile(
            stateDir,
            instanceId,
            effectiveAppServerUrl,
            appServer.auth
          )
        };
      }
      bridgeAppServerUrl = effectiveAppServerUrl;
    }
    const effectiveInstanceId = options.instanceIdSuffix ? `${instanceId}-${options.instanceIdSuffix}` : instanceId;
    const bridgeEnv = {
      ...runtimeEnv,
      TAP_COMMS_DIR: commsDir,
      TAP_STATE_DIR: stateDir,
      TAP_RUNTIME_STATE_DIR: runtimeStateDir,
      TAP_REPO_ROOT: repoRoot,
      TAP_BRIDGE_RUNTIME: runtime,
      TAP_BRIDGE_INSTANCE_ID: instanceId,
      TAP_AGENT_ID: effectiveInstanceId,
      TAP_AGENT_NAME: resolvedAgent,
      ...options.instanceIdSuffix ? { TAP_INSTANCE_ID: effectiveInstanceId } : {},
      ...options.routingSlot ? { TAP_ROUTING_SLOT: options.routingSlot } : {},
      CODEX_TAP_AGENT_NAME: resolvedAgent,
      TAP_RESOLVED_NODE: resolved.command,
      TAP_STRIP_TYPES: resolved.supportsStripTypes ? "1" : "0",
      ...bridgeAppServerUrl ? { CODEX_APP_SERVER_URL: bridgeAppServerUrl } : {},
      ...appServer?.auth?.tokenPath ? { TAP_GATEWAY_TOKEN_FILE: appServer.auth.tokenPath } : {},
      ...port != null ? { TAP_BRIDGE_PORT: String(port) } : {},
      ...options.headless?.enabled ? {
        TAP_HEADLESS: "true",
        TAP_AGENT_ROLE: options.headless.role,
        TAP_MAX_REVIEW_ROUNDS: String(options.headless.maxRounds),
        TAP_QUALITY_FLOOR: options.headless.qualitySeverityFloor
      } : {},
      ...options.busyMode ? { TAP_BUSY_MODE: options.busyMode } : {},
      ...options.pollSeconds != null ? { TAP_POLL_SECONDS: String(options.pollSeconds) } : {},
      ...options.reconnectSeconds != null ? { TAP_RECONNECT_SECONDS: String(options.reconnectSeconds) } : {},
      ...options.messageLookbackMinutes != null ? {
        TAP_MESSAGE_LOOKBACK_MINUTES: String(
          options.messageLookbackMinutes
        )
      } : {},
      ...process.env.TAP_COLD_START_WARMUP === "true" ? { TAP_COLD_START_WARMUP: "true" } : {},
      ...options.threadId ? { TAP_THREAD_ID: options.threadId } : {},
      ...options.ephemeral ? { TAP_EPHEMERAL: "true" } : {},
      ...options.processExistingMessages ? { TAP_PROCESS_EXISTING: "true" } : {}
    };
    const bridgePid = options.platform === "win32" ? startWindowsDetachedProcess(
      command,
      [bridgeScript],
      repoRoot,
      logPath,
      bridgeEnv
    ) : startUnixDetachedProcess(
      command,
      [bridgeScript],
      repoRoot,
      logPath,
      bridgeEnv,
      options.platform
    );
    if (!bridgePid) {
      throw new Error(`Failed to spawn bridge process for ${instanceId}`);
    }
    {
      const SETTLE_MS = 200;
      const reportDeath = () => {
        let logSnippet = "";
        try {
          const logContent = fs19.readFileSync(logPath, "utf-8").trim();
          if (logContent) {
            logSnippet = `
Log output:
${logContent.slice(0, 500)}`;
          }
          const stderrContent = fs19.readFileSync(`${logPath}.stderr`, "utf-8").trim();
          if (stderrContent) {
            logSnippet += `
Stderr:
${stderrContent.slice(0, 500)}`;
          }
        } catch {
        }
        throw new Error(
          `Bridge process for ${instanceId} (PID: ${bridgePid}) exited shortly after spawn.${logSnippet}`
        );
      };
      if (!isProcessAlive(bridgePid)) {
        await delay(SETTLE_MS);
        reportDeath();
      }
      await delay(SETTLE_MS);
      if (!isProcessAlive(bridgePid)) {
        reportDeath();
      }
    }
    const state = {
      pid: bridgePid,
      statePath: pidFilePath(stateDir, instanceId),
      // M321: Runtime heartbeat.json is SSOT for process liveness.
      // This seed covers the pre-first-poll gap (bridge start → first
      // runtime heartbeat write) to prevent false-stale in health checks.
      // Once runtime heartbeat.json is written, resolveHeartbeatTimestamp()
      // prefers it over this value.
      lastHeartbeat: startedAt,
      appServer,
      runtimeStateDir,
      lifecycle: transitionBridgeLifecycle(
        previousLifecycle,
        "initializing",
        previousLifecycle ? "bridge restart" : "bridge start",
        {
          at: startedAt,
          incrementRestart: previousLifecycle != null
        }
      )
    };
    saveBridgeState(stateDir, instanceId, state);
    return state;
  } catch (err) {
    if (appServer?.managed) {
      const shared = isAppServerUsedByOtherBridge(
        stateDir,
        instanceId,
        appServer
      );
      if (!shared) {
        await stopManagedAppServer(appServer, options.platform);
      }
    }
    throw err;
  } finally {
    releaseBridgeStartupLock(startup.lock);
  }
}
var STALE_DIRECT_HEARTBEAT_MS, BRIDGE_STARTUP_LOCK_STALE_MS, BRIDGE_STARTUP_WAIT_MS, BRIDGE_STARTUP_POLL_MS;
var init_bridge_startup = __esm({
  "src/engine/bridge-startup.ts"() {
    "use strict";
    init_runtime();
    init_bridge_paths();
    init_bridge_windows_spawn();
    init_bridge_unix_spawn();
    init_bridge_process_control();
    init_bridge_port_network();
    init_bridge_config();
    init_bridge_state();
    init_bridge_app_server_auth();
    init_bridge_observability();
    init_bridge_app_server_lifecycle();
    STALE_DIRECT_HEARTBEAT_MS = 5 * 60 * 1e3;
    BRIDGE_STARTUP_LOCK_STALE_MS = 60 * 1e3;
    BRIDGE_STARTUP_WAIT_MS = 10 * 1e3;
    BRIDGE_STARTUP_POLL_MS = 100;
  }
});

// src/engine/bridge-orchestrator.ts
import * as fs20 from "fs";
import * as path19 from "path";
async function stopBridge(options) {
  const { instanceId, stateDir, platform } = options;
  const state = loadBridgeState(stateDir, instanceId);
  if (!state) {
    return {
      stopped: false,
      lifecycle: null
    };
  }
  const currentLifecycle = state.lifecycle ?? null;
  if (!isProcessAlive(state.pid)) {
    clearBridgeState(stateDir, instanceId);
    return {
      stopped: false,
      lifecycle: transitionBridgeLifecycle(
        currentLifecycle,
        "crashed",
        "bridge pid not alive"
      )
    };
  }
  state.lifecycle = transitionBridgeLifecycle(
    currentLifecycle,
    "stopping",
    "bridge stop requested"
  );
  saveBridgeState(stateDir, instanceId, state);
  try {
    await terminateProcess(state.pid, platform);
  } catch {
  }
  clearBridgeState(stateDir, instanceId);
  return {
    stopped: true,
    lifecycle: transitionBridgeLifecycle(
      state.lifecycle ?? currentLifecycle,
      "stopped",
      "bridge stopped"
    )
  };
}
function canStopAfterDrain(heartbeat) {
  if (!heartbeat) return true;
  return !heartbeat.activeTurnId || heartbeat.turnState === "idle" || heartbeat.turnState === "disconnected";
}
async function restartBridge(options) {
  const { instanceId, stateDir, platform } = options;
  const drainTimeout = (options.drainTimeoutSeconds ?? 30) * 1e3;
  const repoRoot = options.repoRoot ?? stateDir.replace(/[\\/].tap-comms$/, "");
  const runtimeStateDir = getBridgeRuntimeStateDir(repoRoot, instanceId);
  const heartbeatPath = path19.join(runtimeStateDir, "heartbeat.json");
  let drained = true;
  let forced = false;
  if (fs20.existsSync(heartbeatPath)) {
    const startWait = Date.now();
    while (true) {
      let heartbeat;
      try {
        heartbeat = JSON.parse(
          fs20.readFileSync(heartbeatPath, "utf-8")
        );
      } catch {
        break;
      }
      if (canStopAfterDrain(heartbeat)) {
        break;
      }
      const waitedMs = Date.now() - startWait;
      options.onDrainWait?.({
        activeTurnId: heartbeat.activeTurnId ?? null,
        turnState: heartbeat.turnState ?? null,
        waitedMs
      });
      if (waitedMs >= drainTimeout) {
        if (!options.force) {
          throw new BridgeDrainTimeoutError({
            instanceId,
            activeTurnId: heartbeat.activeTurnId ?? null,
            turnState: heartbeat.turnState ?? null,
            waitedMs
          });
        }
        drained = false;
        forced = true;
        break;
      }
      await new Promise((resolve21) => setTimeout(resolve21, 1e3));
    }
  }
  if (options.headless?.enabled && options.commsDir) {
    const agentName = options.agentName ?? instanceId;
    cleanupHeadlessDispatch(path19.join(options.commsDir, "inbox"), agentName);
  }
  const stopResult = await stopBridge({ instanceId, stateDir, platform });
  const bridge = await startBridge({
    ...options,
    processExistingMessages: true,
    previousLifecycle: stopResult.lifecycle ?? options.previousLifecycle ?? null
  });
  return {
    bridge,
    drained,
    forced
  };
}
var BridgeDrainTimeoutError;
var init_bridge_orchestrator = __esm({
  "src/engine/bridge-orchestrator.ts"() {
    "use strict";
    init_bridge_process_control();
    init_bridge_config();
    init_bridge_state();
    init_bridge_startup();
    BridgeDrainTimeoutError = class extends Error {
      instanceId;
      activeTurnId;
      turnState;
      waitedMs;
      constructor(options) {
        const waitedSeconds = Math.ceil(options.waitedMs / 1e3);
        const turnSuffix = options.activeTurnId ? ` active turn ${options.activeTurnId}` : "";
        const stateSuffix = options.turnState ? ` (${options.turnState})` : "";
        super(
          `Bridge drain timed out for ${options.instanceId} after ${waitedSeconds}s while${turnSuffix || " bridge"} was still busy${stateSuffix}. Re-run with --force to continue.`
        );
        this.name = "BridgeDrainTimeoutError";
        this.instanceId = options.instanceId;
        this.activeTurnId = options.activeTurnId;
        this.turnState = options.turnState;
        this.waitedMs = options.waitedMs;
      }
    };
  }
});

// src/engine/health-monitor.ts
import * as fs21 from "fs";
import * as path20 from "path";
function getHeartbeatActivityMs2(record) {
  const activityMs = new Date(record.lastActivity ?? 0).getTime();
  const timestampMs = new Date(record.timestamp ?? 0).getTime();
  const best = Math.max(
    Number.isFinite(activityMs) ? activityMs : 0,
    Number.isFinite(timestampMs) ? timestampMs : 0
  );
  return best > 0 ? best : null;
}
function normalizeAliasCandidate(value) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}
function addAliasOwner(owners, ownerId, value) {
  const alias = normalizeAliasCandidate(value);
  if (!alias) return;
  const current = owners.get(alias) ?? /* @__PURE__ */ new Set();
  current.add(ownerId);
  owners.set(alias, current);
}
function resolveUniqueLiveDispatchAliases(instances, instanceId) {
  const target = instances[instanceId];
  if (!target) return [];
  const owners = /* @__PURE__ */ new Map();
  for (const [key, instance] of Object.entries(instances)) {
    if (!instance || instance.installed === false) continue;
    const ownerId = normalizeAliasCandidate(instance.instanceId) ?? key;
    addAliasOwner(owners, ownerId, key);
    addAliasOwner(owners, ownerId, instance.instanceId);
    addAliasOwner(owners, ownerId, instance.defaultAgentName);
    addAliasOwner(owners, ownerId, instance.agentName);
  }
  const aliases = /* @__PURE__ */ new Set();
  for (const value of [target.defaultAgentName, target.agentName]) {
    const alias = normalizeAliasCandidate(value);
    if (!alias) continue;
    const aliasOwners = owners.get(alias);
    if (aliasOwners?.size === 1 && aliasOwners.has(instanceId)) {
      aliases.add(alias);
    }
  }
  return [...aliases];
}
function isSameInstanceHeartbeat2(key, heartbeat, instanceId, aliases = []) {
  const candidates = new Set(
    [instanceId, ...aliases].map((value) => value.trim()).filter((value) => value.length > 0)
  );
  const heartbeatAliases = Array.isArray(heartbeat.address?.aliases) ? heartbeat.address.aliases.filter(
    (value) => typeof value === "string"
  ) : [];
  for (const candidate of candidates) {
    if (heartbeat.id === candidate) return true;
    if (heartbeat.agent === candidate) return true;
    if (heartbeat.instanceId === candidate) return true;
    if (heartbeat.connectHash === `instance:${candidate}`) return true;
    if (heartbeat.address?.routingAddress === candidate) return true;
    if (heartbeatAliases.includes(candidate)) return true;
    if (key === candidate) return true;
    if (key.replace(/_/g, "-") === candidate) return true;
    if (key.replace(/-/g, "_") === candidate) return true;
  }
  return false;
}
function loadLiveDispatchEvidence(commsDir, instanceId, aliases = []) {
  const heartbeatsPath = path20.join(commsDir, "heartbeats.json");
  if (!fs21.existsSync(heartbeatsPath)) return null;
  try {
    const store = JSON.parse(
      fs21.readFileSync(heartbeatsPath, "utf-8")
    );
    let best = null;
    let bestActivityMs = -1;
    const normalizedAliases = aliases.filter(
      (alias) => typeof alias === "string" && alias.trim() !== ""
    );
    for (const [key, heartbeat] of Object.entries(store)) {
      if (!isSameInstanceHeartbeat2(key, heartbeat, instanceId, normalizedAliases))
        continue;
      if (heartbeat.source !== "bridge-dispatch") continue;
      if (heartbeat.bridgePid == null || !isProcessAlive(heartbeat.bridgePid)) {
        continue;
      }
      const activityMs = getHeartbeatActivityMs2(heartbeat);
      if (activityMs == null || Date.now() - activityMs > DISPATCH_EVIDENCE_FRESH_THRESHOLD_MS) {
        continue;
      }
      if (activityMs > bestActivityMs) {
        bestActivityMs = activityMs;
        best = {
          bridgePid: heartbeat.bridgePid,
          lastActivity: heartbeat.lastActivity ?? heartbeat.timestamp ?? new Date(activityMs).toISOString()
        };
      }
    }
    return best;
  } catch {
    return null;
  }
}
var DISPATCH_EVIDENCE_FRESH_THRESHOLD_MS, HEARTBEAT_FRESH_THRESHOLD_MS;
var init_health_monitor = __esm({
  "src/engine/health-monitor.ts"() {
    "use strict";
    init_bridge_process_control();
    DISPATCH_EVIDENCE_FRESH_THRESHOLD_MS = 2 * 60 * 1e3;
    HEARTBEAT_FRESH_THRESHOLD_MS = 2 * 60 * 1e3;
  }
});

// src/engine/bridge-restart-plan.ts
import * as fs22 from "fs";
import * as path21 from "path";
function startupLockPath(stateDir, instanceId) {
  return path21.join(stateDir, "pids", `bridge-${instanceId}.startup.lock`);
}
function hasFreshStartupLock(stateDir, instanceId) {
  const lockPath = startupLockPath(stateDir, instanceId);
  if (!fs22.existsSync(lockPath)) {
    return false;
  }
  try {
    const stats = fs22.statSync(lockPath);
    return Date.now() - stats.mtimeMs < BRIDGE_STARTUP_LOCK_STALE_MS2;
  } catch {
    return false;
  }
}
function formatExternalManagedHint(platform, instanceId, bridgePid) {
  if (bridgePid != null) {
    if (platform === "win32") {
      return `Use the owning PowerShell/script manager to restart ${instanceId}. Hint: Get-Process -Id ${bridgePid}; Stop-Process -Id ${bridgePid}`;
    }
    return `Use the owning shell/service manager to restart ${instanceId}. Hint: ps -fp ${bridgePid}; kill ${bridgePid}`;
  }
  if (platform === "win32") {
    return `Use the owning PowerShell/script manager to restart ${instanceId}.`;
  }
  return `Use the owning shell/service manager to restart ${instanceId}.`;
}
function resolveBridgeRestartPlan(options) {
  const persistedBridgeState = loadBridgeState(options.stateDir, options.instanceId) ?? options.fallbackBridgeState ?? null;
  const rawStatus = getBridgeStatus(options.stateDir, options.instanceId);
  const bridgeState = rawStatus === "running" ? loadBridgeState(options.stateDir, options.instanceId) ?? persistedBridgeState : null;
  const lifecycle = resolveBridgeLifecycleSnapshot(
    options.stateDir,
    options.instanceId,
    bridgeState ?? persistedBridgeState,
    options.persistedLifecycle ?? persistedBridgeState?.lifecycle ?? null
  );
  const liveDispatch = rawStatus === "running" ? null : loadLiveDispatchEvidence(
    options.commsDir,
    options.instanceId,
    options.liveDispatchAliases
  );
  if (hasFreshStartupLock(options.stateDir, options.instanceId)) {
    return {
      kind: "blocked",
      reason: "bridge startup already in progress",
      manualHint: `Wait for startup to finish, then rerun: npx @hua-labs/tap bridge restart ${options.instanceId}`,
      bridgeState,
      lifecycle,
      liveDispatch
    };
  }
  if (lifecycle.status === "initializing" || (options.persistedLifecycle?.state ?? bridgeState?.lifecycle?.state) === "stopping") {
    return {
      kind: "blocked",
      reason: `bridge is ${lifecycle.status === "initializing" ? "initializing" : "stopping"}`,
      manualHint: `Wait for bridge state to settle, then rerun: npx @hua-labs/tap bridge restart ${options.instanceId}`,
      bridgeState,
      lifecycle,
      liveDispatch
    };
  }
  if (liveDispatch) {
    return {
      kind: "external-managed",
      reason: "fresh bridge-dispatch heartbeat exists without a tracked bridge pid",
      evidence: `fresh bridge-dispatch heartbeat from PID ${liveDispatch.bridgePid}`,
      manualHint: formatExternalManagedHint(
        options.platform,
        options.instanceId,
        liveDispatch.bridgePid
      ),
      bridgeState,
      lifecycle,
      liveDispatch
    };
  }
  if (rawStatus === "stopped" || rawStatus === "stale") {
    return {
      kind: "not-running",
      reason: "no tracked running bridge found",
      bridgeState,
      lifecycle,
      liveDispatch
    };
  }
  return {
    kind: "managed-restart",
    reason: "tracked bridge pid is alive",
    bridgeState,
    lifecycle,
    liveDispatch
  };
}
var BRIDGE_STARTUP_LOCK_STALE_MS2;
var init_bridge_restart_plan = __esm({
  "src/engine/bridge-restart-plan.ts"() {
    "use strict";
    init_bridge_observability();
    init_bridge_state();
    init_server_lifecycle();
    init_health_monitor();
    BRIDGE_STARTUP_LOCK_STALE_MS2 = 60 * 1e3;
  }
});

// src/engine/bridge.ts
var init_bridge = __esm({
  "src/engine/bridge.ts"() {
    "use strict";
    init_bridge_port_network();
    init_bridge_process_control();
    init_bridge_config();
    init_bridge_state();
    init_bridge_observability();
    init_server_lifecycle();
    init_codex_session_state();
    init_bridge_app_server_health();
    init_bridge_app_server_lifecycle();
    init_bridge_startup();
    init_bridge_orchestrator();
    init_bridge_restart_plan();
  }
});

// src/engine/dashboard.ts
import * as fs23 from "fs";
import * as path22 from "path";
import { execSync as execSync3 } from "child_process";
function formatAgentLabel(agentIdOrName, displayName) {
  const normalizedId = agentIdOrName.trim();
  const normalizedName = displayName?.trim();
  if (!normalizedId) {
    return normalizedName ?? agentIdOrName;
  }
  if (!normalizedName || normalizedName === normalizedId) {
    return normalizedId;
  }
  return `${normalizedName} [${normalizedId}]`;
}
function parseIsoAgeSeconds(value) {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) return null;
  return Math.max(0, Math.floor((Date.now() - timestamp) / 1e3));
}
function resolveHostId() {
  const explicitHostId = process.env.TAP_HOST_ID?.trim();
  if (explicitHostId) return explicitHostId;
  const computerName = process.env.COMPUTERNAME?.trim();
  if (computerName) return computerName;
  const hostName = process.env.HOSTNAME?.trim();
  if (hostName) return hostName;
  return null;
}
function deriveRoutingSlot(instanceId) {
  if (!instanceId) return null;
  const normalized = instanceId.replace(/-/g, "_").toLowerCase();
  if (normalized === "tower" || normalized === "claude_main" || normalized === "codex_main") {
    return "tower";
  }
  if (normalized === "reviewer" || normalized === "claude_reviewer" || normalized === "codex_reviewer") {
    return "reviewer";
  }
  const worktreeMatch = normalized.match(/^(?:(?:claude|codex)_)?wt_?(\d+)$/);
  if (!worktreeMatch) return null;
  return `wt-${Number.parseInt(worktreeMatch[1], 10)}`;
}
function uniqueAliases(values) {
  const aliases = [];
  for (const value of values) {
    const normalized = value?.trim();
    if (!normalized || aliases.includes(normalized)) continue;
    aliases.push(normalized);
  }
  return aliases;
}
function resolveHeartbeatInstanceId(heartbeatId, displayName, state) {
  if (!state) return null;
  if (state.instances[heartbeatId]?.installed) return heartbeatId;
  const hyphenated = heartbeatId.replace(/_/g, "-");
  if (state.instances[hyphenated]?.installed) return hyphenated;
  const underscored = heartbeatId.replace(/-/g, "_");
  if (state.instances[underscored]?.installed) return underscored;
  if (!displayName) return null;
  const matches = Object.values(state.instances).filter(
    (inst) => inst?.installed && inst.defaultAgentName === displayName
  );
  return matches.length === 1 ? matches[0].instanceId : null;
}
function collectAgents(commsDir, state, bridges) {
  const heartbeatsPath = path22.join(commsDir, "heartbeats.json");
  if (!fs23.existsSync(heartbeatsPath)) return [];
  try {
    const raw = fs23.readFileSync(heartbeatsPath, "utf-8");
    const data = JSON.parse(raw);
    return Object.entries(data).map(([agentId, info]) => {
      const instanceId = resolveHeartbeatInstanceId(
        agentId,
        info.agent ?? null,
        state
      );
      const bridge = instanceId ? bridges.find((candidate) => candidate.instanceId === instanceId) ?? null : null;
      const slot = deriveRoutingSlot(instanceId);
      const routingAddress = info.address?.routingAddress ?? slot ?? instanceId ?? agentId;
      const conversationId = info.address?.conversationId ?? bridge?.lifecycle?.threadId ?? bridge?.lifecycle?.savedThreadId ?? null;
      const presence = bridge?.status === "stale" || bridge?.lifecycle?.status === "bridge-stale" ? "bridge-stale" : bridge?.status === "running" ? "bridge-live" : "mcp-only";
      const lastActivity = info.lastActivity ?? info.timestamp ?? null;
      const idleBasis = bridge?.session?.idleSince ?? lastActivity;
      return {
        name: formatAgentLabel(agentId, info.agent ?? null),
        instanceId,
        presence,
        lifecycle: bridge?.lifecycle?.status ?? null,
        status: info.status ?? null,
        lastActivity,
        joinedAt: info.joinedAt ?? null,
        idleSeconds: parseIsoAgeSeconds(idleBasis),
        address: {
          hostId: info.address?.hostId ?? resolveHostId(),
          clientId: info.address?.clientId ?? instanceId,
          conversationId,
          ownerClientId: info.address?.ownerClientId ?? (conversationId && instanceId ? instanceId : null),
          routingAddress,
          slot: info.address?.slot ?? slot,
          aliases: uniqueAliases([
            ...info.address?.aliases ?? [],
            routingAddress,
            slot,
            instanceId,
            agentId,
            info.agent ?? null
          ])
        }
      };
    });
  } catch {
    return [];
  }
}
function collectBridges(repoRoot) {
  const state = loadState(repoRoot);
  const { config } = resolveConfig({}, repoRoot);
  const stateDir = config.stateDir;
  const bridges = [];
  if (state) {
    for (const [id, inst] of Object.entries(state.instances)) {
      if (!inst?.installed) continue;
      if (inst.bridgeMode !== "app-server") continue;
      const instanceId = id;
      const status = getBridgeStatus(stateDir, instanceId);
      const persistedBridgeState = loadBridgeState(stateDir, instanceId);
      const bridgeState = persistedBridgeState ?? inst.bridge ?? null;
      const age = getHeartbeatAge(stateDir, instanceId);
      const runtimeHeartbeat = loadRuntimeBridgeHeartbeat(bridgeState);
      const lifecycle = bridgeState != null ? resolveBridgeLifecycleSnapshot(stateDir, instanceId, bridgeState) : null;
      const session = bridgeState != null ? deriveCodexSessionState({
        runtimeHeartbeat,
        runtimeStateDir: bridgeState.runtimeStateDir ?? null
      }) : null;
      bridges.push({
        instanceId: id,
        runtime: inst.runtime,
        status,
        lifecycle,
        session,
        pid: bridgeState?.pid ?? null,
        port: inst.port ?? null,
        heartbeatAge: age,
        headless: inst.headless?.enabled ?? false
      });
    }
  }
  const tmpDir = path22.join(repoRoot, ".tmp");
  if (fs23.existsSync(tmpDir)) {
    try {
      const dirs = fs23.readdirSync(tmpDir).filter((d) => d.startsWith("codex-app-server-bridge"));
      for (const dir of dirs) {
        const daemonPath = path22.join(tmpDir, dir, "bridge-daemon.json");
        if (!fs23.existsSync(daemonPath)) continue;
        try {
          const raw = fs23.readFileSync(daemonPath, "utf-8");
          const daemon = JSON.parse(raw);
          const alreadyCovered = bridges.some(
            (b) => b.pid === daemon.pid && b.pid !== null
          );
          if (alreadyCovered) continue;
          const agentFile = path22.join(tmpDir, dir, "agent-name.txt");
          const agentName = fs23.existsSync(agentFile) ? fs23.readFileSync(agentFile, "utf-8").trim() : dir;
          const running = daemon.pid ? isProcessAlive(daemon.pid) : false;
          const portMatch = daemon.appServerUrl?.match(/:(\d+)/);
          const port = portMatch ? parseInt(portMatch[1], 10) : null;
          bridges.push({
            instanceId: agentName,
            runtime: "codex",
            status: running ? "running" : "stale",
            lifecycle: null,
            session: null,
            pid: daemon.pid ?? null,
            port,
            heartbeatAge: null,
            headless: false
          });
        } catch {
        }
      }
    } catch {
    }
  }
  return bridges;
}
function collectPRs() {
  try {
    const output = execSync3(
      "gh pr list --state all --limit 10 --json number,title,author,state,url",
      { encoding: "utf-8", timeout: 1e4, stdio: ["pipe", "pipe", "pipe"] }
    );
    const prs = JSON.parse(output);
    return prs.map((pr) => ({
      number: pr.number,
      title: pr.title,
      author: pr.author.login,
      state: pr.state,
      url: pr.url
    }));
  } catch {
    return [];
  }
}
function collectWarnings(bridges, agents) {
  const warnings = [];
  for (const bridge of bridges) {
    if (bridge.status === "stale") {
      warnings.push({
        level: "warn",
        message: `Bridge ${bridge.instanceId} is stale (PID ${bridge.pid} dead)`
      });
    }
    if (bridge.status === "running" && bridge.heartbeatAge !== null && bridge.heartbeatAge > 60) {
      warnings.push({
        level: "warn",
        message: `Bridge ${bridge.instanceId} heartbeat stale (${bridge.heartbeatAge}s ago)`
      });
    }
    if (bridge.lifecycle?.status === "degraded-no-thread") {
      warnings.push({
        level: "warn",
        message: `Bridge ${bridge.instanceId} is degraded (no active thread)`
      });
    }
  }
  if (bridges.length === 0) {
    warnings.push({
      level: "warn",
      message: "No bridges configured"
    });
  }
  if (agents.length === 0) {
    warnings.push({
      level: "warn",
      message: "No agent heartbeats found"
    });
  }
  return warnings;
}
function collectDashboardSnapshot(repoRoot, commsDirOverride) {
  const { config } = resolveConfig(
    commsDirOverride ? { commsDir: commsDirOverride } : {},
    repoRoot
  );
  const resolved = config;
  const state = loadState(resolved.repoRoot);
  const bridges = collectBridges(resolved.repoRoot);
  const agents = collectAgents(resolved.commsDir, state, bridges);
  const prs = collectPRs();
  const warnings = collectWarnings(bridges, agents);
  return {
    generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
    repoRoot: resolved.repoRoot,
    commsDir: resolved.commsDir,
    agents,
    bridges,
    prs,
    warnings
  };
}
var init_dashboard = __esm({
  "src/engine/dashboard.ts"() {
    "use strict";
    init_config();
    init_bridge();
    init_state();
  }
});

// src/engine/termination.ts
import * as fs35 from "fs";
import * as crypto2 from "crypto";
function isAtOrAbove(severity, floor) {
  return SEVERITY_RANK[severity] >= SEVERITY_RANK[floor];
}
function computeFindingHash(findings) {
  const normalized = findings.filter((f) => isAtOrAbove(f.severity, "high")).map((f) => `${f.category}:${f.description.slice(0, 100)}`).sort().join("|");
  if (!normalized) return "empty";
  return crypto2.createHash("sha256").update(normalized).digest("hex").slice(0, 16);
}
function evalManualStop(ctx) {
  if (fs35.existsSync(ctx.stopSignalPath)) {
    return {
      verdict: "stop",
      reason: `Manual stop signal found at ${ctx.stopSignalPath}`,
      strategy: "manual-stop",
      summary: `Review stopped manually at round ${ctx.round}`
    };
  }
  return null;
}
function evalRoundCap(ctx) {
  if (ctx.round >= ctx.config.maxRounds) {
    return {
      verdict: "stop",
      reason: `Round cap reached (${ctx.round}/${ctx.config.maxRounds})`,
      strategy: "round-cap",
      summary: `Review stopped at round cap (${ctx.config.maxRounds})`
    };
  }
  return null;
}
function evalRepetition(ctx) {
  if (ctx.rounds.length < 2) return null;
  const latest = ctx.rounds[ctx.rounds.length - 1];
  if (!latest) return null;
  let count = 0;
  for (const round of ctx.rounds) {
    if (round.findingHash === latest.findingHash) count++;
  }
  if (count >= ctx.config.repetitionThreshold) {
    return {
      verdict: "stop",
      reason: `Same finding hash repeated ${count} times (threshold: ${ctx.config.repetitionThreshold})`,
      strategy: "repetition-detection",
      summary: `Review going in circles \u2014 same findings repeated ${count}x`
    };
  }
  return null;
}
function evalQualityThreshold(ctx) {
  if (ctx.rounds.length === 0) return null;
  const latest = ctx.rounds[ctx.rounds.length - 1];
  if (!latest) return null;
  if (latest.findingCount === 0 && latest.suggestedDiffLines === 0 && latest.findings.length === 0) {
    return null;
  }
  const significantFindings = latest.findings.filter(
    (f) => isAtOrAbove(f.severity, ctx.config.qualitySeverityFloor)
  );
  if (significantFindings.length === 0) {
    return {
      verdict: "stop",
      reason: `No findings at ${ctx.config.qualitySeverityFloor}+ severity in round ${ctx.round}`,
      strategy: "quality-threshold",
      summary: `Review clean \u2014 no ${ctx.config.qualitySeverityFloor}+ findings in round ${ctx.round}`
    };
  }
  return null;
}
function evalDiffInsignificance(ctx) {
  if (ctx.rounds.length === 0) return null;
  const latest = ctx.rounds[ctx.rounds.length - 1];
  if (!latest) return null;
  if (latest.findingCount === 0 && latest.suggestedDiffLines === 0 && latest.findings.length === 0) {
    return null;
  }
  if (latest.suggestedDiffLines < ctx.config.diffThreshold) {
    return {
      verdict: "stop",
      reason: `Suggested diff (${latest.suggestedDiffLines} lines) below threshold (${ctx.config.diffThreshold})`,
      strategy: "diff-insignificance",
      summary: `Review suggestions are trivial (${latest.suggestedDiffLines} lines)`
    };
  }
  return null;
}
function evaluate(ctx) {
  for (const strategy of ctx.config.strategies) {
    const evaluator = STRATEGY_EVALUATORS[strategy];
    if (!evaluator) continue;
    const result = evaluator(ctx);
    if (result) return result;
  }
  return {
    verdict: "continue",
    reason: "All strategies passed \u2014 review continues",
    strategy: ctx.config.strategies[ctx.config.strategies.length - 1] ?? "round-cap",
    summary: `Round ${ctx.round} complete, continuing`
  };
}
var DEFAULT_TERMINATION_CONFIG, SEVERITY_RANK, STRATEGY_EVALUATORS;
var init_termination = __esm({
  "src/engine/termination.ts"() {
    "use strict";
    DEFAULT_TERMINATION_CONFIG = {
      strategies: [
        "manual-stop",
        "round-cap",
        "repetition-detection",
        "quality-threshold",
        "diff-insignificance"
      ],
      maxRounds: 5,
      diffThreshold: 3,
      repetitionThreshold: 2,
      qualitySeverityFloor: "high"
    };
    SEVERITY_RANK = {
      critical: 5,
      high: 4,
      medium: 3,
      low: 2,
      nitpick: 1
    };
    STRATEGY_EVALUATORS = {
      "manual-stop": evalManualStop,
      "round-cap": evalRoundCap,
      "repetition-detection": evalRepetition,
      "quality-threshold": evalQualityThreshold,
      "diff-insignificance": evalDiffInsignificance
    };
  }
});

// src/engine/review.ts
import * as fs36 from "fs";
import * as path33 from "path";
import * as crypto3 from "crypto";
import { spawnSync as spawnSync6 } from "child_process";
function trimAddress(value) {
  return value.trim();
}
function canonicalizeAgentId(value) {
  return trimAddress(value).replace(/-/g, "_").toLowerCase();
}
function isOwnMessageAddress(sender, agentId, agentName) {
  const normalizedSender = trimAddress(sender);
  if (!normalizedSender) return false;
  return canonicalizeAgentId(normalizedSender) === canonicalizeAgentId(agentId) || normalizedSender.toLowerCase() === trimAddress(agentName).toLowerCase();
}
function parseInboxFilename(filename) {
  const base = path33.basename(filename, ".md");
  const match = base.match(/^(\d{8})-([^-]+)-([^-]+)-(.+)$/);
  if (!match) return null;
  return {
    date: match[1],
    sender: match[2],
    recipient: match[3],
    subject: match[4]
  };
}
function extractPrNumber2(text) {
  for (const pattern of PR_NUMBER_PATTERNS) {
    const match = text.match(pattern);
    if (match?.[1]) return parseInt(match[1], 10);
  }
  return null;
}
function computePendingRequestKey(request) {
  return request.messageId ? `message:${request.messageId}` : `source:${request.sourcePath}`;
}
function parseInboxContentFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match?.[1]) return null;
  const fields = {};
  for (const line of match[1].split("\n")) {
    const kv = line.match(/^(\w+):\s*(.+)$/);
    if (kv?.[1] && kv[2]) fields[kv[1]] = kv[2].trim();
  }
  return {
    sent_at: fields.sent_at,
    message_id: fields.message_id,
    to: fields.to
  };
}
function detectReviewRequest(filePath, content, generation) {
  const parsed = parseInboxFilename(filePath);
  if (!parsed) return null;
  if (parsed.subject.startsWith("headless-dispatch-")) return null;
  const fullText = `${parsed.subject} ${content}`;
  const isReview = REVIEW_KEYWORDS.some((re) => re.test(fullText));
  const isReReview = REREVIEW_KEYWORDS.some((re) => re.test(fullText));
  if (!isReview && !isReReview) return null;
  const prNumber = extractPrNumber2(fullText);
  if (!prNumber) return null;
  const sourceMtimeMs = fs36.existsSync(filePath) ? fs36.statSync(filePath).mtimeMs : 0;
  const fm = parseInboxContentFrontmatter(content);
  return {
    sourcePath: filePath,
    sourceMtimeMs,
    requestTimestampMs: extractRequestTimestampMs(
      parsed.date,
      fm,
      sourceMtimeMs
    ),
    sender: parsed.sender,
    recipient: parsed.recipient,
    prNumber,
    generation,
    isReReview,
    round: isReReview ? 2 : 1,
    // Will be adjusted by session tracking
    messageId: fm?.message_id || void 0,
    dedupeRecipient: fm?.to || void 0
  };
}
function extractRequestTimestampMs(inboxDate, fm, fallbackMtimeMs) {
  if (fm?.sent_at) {
    const sentAtMs = new Date(fm.sent_at).getTime();
    if (Number.isFinite(sentAtMs) && sentAtMs > 0) return sentAtMs;
  }
  const dateMatch = inboxDate.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (dateMatch) {
    const [, year, month, day] = dateMatch;
    return Date.UTC(
      Number.parseInt(year, 10),
      Number.parseInt(month, 10) - 1,
      Number.parseInt(day, 10)
    );
  }
  return fallbackMtimeMs;
}
function buildReviewPrompt(request, agentName, round) {
  const roundLabel = round > 1 ? ` (re-review round ${round})` : "";
  return [
    `You are a code reviewer for the HUA Platform monorepo.`,
    ``,
    `## Task`,
    `Review PR #${request.prNumber}${roundLabel}.`,
    ``,
    `## Instructions`,
    `1. Run: gh pr diff ${request.prNumber}`,
    `2. Read changed files for understanding`,
    `3. Apply review checklist: security > data integrity > performance > error handling > code quality`,
    `4. Write structured findings`,
    ``,
    `## Output`,
    `Write review to: ${path33.join("reviews", request.generation, `review-PR${request.prNumber}-${agentName}.md`)}`,
    ``,
    `### Review File Format`,
    `\`\`\`markdown`,
    `---`,
    `date: ${(/* @__PURE__ */ new Date()).toISOString().split("T")[0]}`,
    `reviewer: ${agentName}`,
    `pr: ${request.prNumber}`,
    `round: ${round}`,
    `status: clean | p1-Nitems | p2-Nitems`,
    `merge: merge | fix-then-merge | hold`,
    `---`,
    ``,
    `## Findings`,
    ``,
    `### Critical / High`,
    `- [severity] [category] file:line \u2014 description`,
    ``,
    `### Medium / Low`,
    `- [severity] [category] file:line \u2014 description`,
    ``,
    `## Checks`,
    `- [ ] Build verified`,
    `- [ ] Typecheck passed`,
    `- [ ] Scope check (only expected files changed)`,
    ``,
    `## Suggested Diff Lines`,
    `{number of lines the author should change to address findings}`,
    ``,
    `## Decision`,
    `{one-line merge recommendation}`,
    `\`\`\``,
    ``,
    `## After Review`,
    `- Update reviews/INDEX.md`,
    `- Write inbox reply to ${request.sender}`,
    `- Commit and push comms changes`
  ].join("\n");
}
function extractSuggestedDiffLines(content) {
  const match = content.match(/## Suggested Diff Lines\s*\n\s*(\d+)/i);
  if (match?.[1]) return parseInt(match[1], 10);
  const codeBlocks = content.match(/```[\s\S]*?```/g) ?? [];
  let totalLines = 0;
  for (const block of codeBlocks) {
    totalLines += block.split("\n").length - 2;
  }
  return totalLines;
}
function extractFindings(content) {
  const findings = [];
  const lines = content.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("-") && !trimmed.startsWith("*")) continue;
    let severity = "medium";
    for (const [sev, pattern] of Object.entries(SEVERITY_PATTERNS)) {
      if (pattern.test(trimmed)) {
        severity = sev;
        break;
      }
    }
    let category = "general";
    for (const cat of CATEGORY_PATTERNS) {
      if (trimmed.toLowerCase().includes(cat)) {
        category = cat;
        break;
      }
    }
    const fileMatch = trimmed.match(/([a-zA-Z0-9_/.-]+\.[a-zA-Z]+):(\d+)/);
    const hasSeverityKeyword = Object.values(SEVERITY_PATTERNS).some(
      (p) => p.test(trimmed)
    );
    if (hasSeverityKeyword || fileMatch) {
      findings.push({
        severity,
        category,
        description: trimmed.replace(/^[-*]\s*/, "").slice(0, 200),
        file: fileMatch?.[1],
        line: fileMatch?.[2] ? parseInt(fileMatch[2], 10) : void 0
      });
    }
  }
  return findings;
}
function parseReviewOutput(reviewFilePath2, round) {
  if (!fs36.existsSync(reviewFilePath2)) return null;
  const content = fs36.readFileSync(reviewFilePath2, "utf-8");
  const findings = extractFindings(content);
  const suggestedDiffLines = extractSuggestedDiffLines(content);
  return {
    round,
    timestamp: (/* @__PURE__ */ new Date()).toISOString(),
    findingCount: findings.length,
    findings,
    suggestedDiffLines,
    findingHash: computeFindingHash(findings)
  };
}
function reviewFilePath(repoRoot, generation, prNumber, agentName) {
  return path33.join(
    repoRoot,
    "reviews",
    generation,
    `review-PR${prNumber}-${agentName}.md`
  );
}
function isStaleReviewRequest(request, repoRoot, agentName) {
  const revPath = reviewFilePath(
    repoRoot,
    request.generation,
    request.prNumber,
    agentName
  );
  if (fs36.existsSync(revPath) && fs36.existsSync(request.sourcePath)) {
    const reviewStat = fs36.statSync(revPath);
    const requestStat = fs36.statSync(request.sourcePath);
    if (reviewStat.mtimeMs > requestStat.mtimeMs) return true;
  }
  return false;
}
function resolvePrHead(repoRoot, request, cache) {
  const cacheKey = request.messageId ? `message:${request.messageId}` : `source:${request.sourcePath}:mtime:${request.sourceMtimeMs}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.checkedAtMs < PR_HEAD_CACHE_REVALIDATE_MS) {
    return cached.value;
  }
  let result = null;
  try {
    const command = spawnSync6(
      "gh",
      [
        "pr",
        "view",
        String(request.prNumber),
        "--json",
        "headRefName,headRefOid"
      ],
      { cwd: repoRoot, encoding: "utf-8", timeout: 1e4 }
    );
    if (command.status === 0 && command.stdout.trim()) {
      const parsed = JSON.parse(command.stdout);
      result = {
        headRefName: parsed.headRefName,
        headRefOid: parsed.headRefOid
      };
    }
  } catch {
    result = null;
  }
  cache.set(cacheKey, {
    value: result,
    checkedAtMs: Date.now()
  });
  return result;
}
function computeRequestMarkerId(request) {
  const recipient = request.dedupeRecipient || request.recipient;
  if (request.prTipSha) {
    return crypto3.createHash("sha1").update(
      `pr:${request.prNumber}:tip:${request.prTipSha}:recipient:${recipient}`
    ).digest("hex");
  }
  if (request.messageId) {
    return crypto3.createHash("sha1").update(`message_id:${request.messageId}:recipient:${recipient}`).digest("hex");
  }
  let contentHash = "";
  try {
    const content = fs36.readFileSync(request.sourcePath, "utf-8");
    contentHash = crypto3.createHash("sha1").update(content).digest("hex");
  } catch {
  }
  const input = JSON.stringify({
    sourcePath: request.sourcePath,
    sender: request.sender,
    recipient: request.recipient,
    prNumber: request.prNumber,
    generation: request.generation,
    isReReview: request.isReReview,
    contentHash
  });
  return crypto3.createHash("sha1").update(input).digest("hex");
}
function isAlreadyProcessed(stateDir, request) {
  const markerId = computeRequestMarkerId(request);
  return fs36.existsSync(path33.join(stateDir, "processed", `${markerId}.done`));
}
function unmarkProcessed(stateDir, request) {
  const markerId = computeRequestMarkerId(request);
  const markerPath = path33.join(stateDir, "processed", `${markerId}.done`);
  if (fs36.existsSync(markerPath)) {
    fs36.unlinkSync(markerPath);
  }
}
function markAsProcessed(stateDir, request) {
  const markerId = computeRequestMarkerId(request);
  const markerDir = path33.join(stateDir, "processed");
  fs36.mkdirSync(markerDir, { recursive: true });
  const markerPath = path33.join(markerDir, `${markerId}.done`);
  const payload = {
    prNumber: request.prNumber,
    prTipSha: request.prTipSha ?? null,
    sourcePath: request.sourcePath,
    processedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
  const tmp = `${markerPath}.tmp.${process.pid}`;
  fs36.writeFileSync(tmp, JSON.stringify(payload, null, 2), "utf-8");
  fs36.renameSync(tmp, markerPath);
}
function writeReviewReceipt(commsDir, request, agentName) {
  const date = (/* @__PURE__ */ new Date()).toISOString().split("T")[0].replace(/-/g, "");
  const filename = `${date}-${agentName}-${request.sender}-PR${request.prNumber}-ack.md`;
  const content = [
    `## ${agentName} > ${request.sender}`,
    ``,
    `- PR #${request.prNumber} review request received.`,
    `- headless reviewer processing.`,
    `- request: ${path33.basename(request.sourcePath)}`
  ].join("\n");
  const inboxDir = path33.join(commsDir, "inbox");
  fs36.mkdirSync(inboxDir, { recursive: true });
  const inboxPath = path33.join(inboxDir, filename);
  const tmp = `${inboxPath}.tmp.${process.pid}`;
  fs36.writeFileSync(tmp, content, "utf-8");
  fs36.renameSync(tmp, inboxPath);
  return inboxPath;
}
function isHeadlessReviewer() {
  return process.env.TAP_HEADLESS === "true";
}
function getHeadlessEnvConfig() {
  if (!isHeadlessReviewer()) return null;
  return {
    role: process.env.TAP_AGENT_ROLE ?? "reviewer",
    maxRounds: parseInt(process.env.TAP_MAX_REVIEW_ROUNDS ?? "5", 10),
    qualityFloor: process.env.TAP_QUALITY_FLOOR ?? "high"
  };
}
function scanInboxForReviews(commsDir, stateDir, repoRoot, generation, agentName, agentId = agentName, activeSessionPrNumber, prHeadCache) {
  const inboxDir = path33.join(commsDir, "inbox");
  if (!fs36.existsSync(inboxDir)) return [];
  const files = fs36.readdirSync(inboxDir).filter((f) => f.endsWith(".md"));
  const requests = [];
  const shouldResolvePrHead = fs36.existsSync(path33.join(repoRoot, ".git"));
  const activePrHeadCache = shouldResolvePrHead ? prHeadCache ?? /* @__PURE__ */ new Map() : null;
  for (const file of files) {
    const filePath = path33.join(inboxDir, file);
    const content = fs36.readFileSync(filePath, "utf-8");
    const request = detectReviewRequest(filePath, content, generation);
    if (!request) continue;
    const to = request.recipient.toLowerCase();
    if (to !== agentName.toLowerCase() && to !== "\uC804\uCCB4" && to !== "all" && to !== "") {
      continue;
    }
    if (isOwnMessageAddress(request.sender, agentId, agentName)) continue;
    if (activePrHeadCache) {
      const prHead = resolvePrHead(repoRoot, request, activePrHeadCache);
      if (prHead?.headRefName) request.branch = prHead.headRefName;
      if (prHead?.headRefOid) request.prTipSha = prHead.headRefOid;
    }
    const bypassProcessedCheck = request.isReReview && activeSessionPrNumber != null && request.prNumber === activeSessionPrNumber;
    const bypassStaleCheck = request.isReReview && activeSessionPrNumber != null && request.prNumber === activeSessionPrNumber;
    if (!bypassStaleCheck && isStaleReviewRequest(request, repoRoot, agentName))
      continue;
    if (!bypassProcessedCheck && isAlreadyProcessed(stateDir, request))
      continue;
    requests.push(request);
  }
  requests.sort((a, b) => {
    if (a.isReReview !== b.isReReview) {
      return Number(b.isReReview) - Number(a.isReReview);
    }
    if (a.requestTimestampMs !== b.requestTimestampMs) {
      return b.requestTimestampMs - a.requestTimestampMs;
    }
    if (a.sourceMtimeMs !== b.sourceMtimeMs) {
      return b.sourceMtimeMs - a.sourceMtimeMs;
    }
    return b.prNumber - a.prNumber;
  });
  return requests;
}
var REVIEW_KEYWORDS, REREVIEW_KEYWORDS, PR_NUMBER_PATTERNS, PR_HEAD_CACHE_REVALIDATE_MS, SEVERITY_PATTERNS, CATEGORY_PATTERNS;
var init_review = __esm({
  "src/engine/review.ts"() {
    "use strict";
    init_termination();
    REVIEW_KEYWORDS = [/리뷰\s*요청/, /review[- ]?request/i];
    REREVIEW_KEYWORDS = [/재리뷰/, /re-?review/i];
    PR_NUMBER_PATTERNS = [
      /PR\s*#?\s*(\d+)/i,
      /pull\/(\d+)/,
      /review[-_ ]?(\d+)/i
    ];
    PR_HEAD_CACHE_REVALIDATE_MS = 3e4;
    SEVERITY_PATTERNS = {
      critical: /\bcritical\b/i,
      high: /\bhigh\b/i,
      medium: /\bmedium\b/i,
      low: /\blow\b/i,
      nitpick: /\bnitpick\b/i
    };
    CATEGORY_PATTERNS = [
      "security",
      "performance",
      "correctness",
      "data-integrity",
      "error-handling",
      "code-quality",
      "style"
    ];
  }
});

// src/engine/headless-loop.ts
var headless_loop_exports = {};
__export(headless_loop_exports, {
  createHeadlessLoop: () => createHeadlessLoop,
  mergePendingRequests: () => mergePendingRequests,
  sortRequests: () => sortRequests
});
import * as fs37 from "fs";
import * as path34 from "path";
function sortRequests(requests, consecutiveReReviews) {
  const reReviewQuotaExhausted = consecutiveReReviews >= MAX_CONSECUTIVE_REREVIEWS;
  return [...requests].sort((a, b) => {
    if (a.isReReview !== b.isReReview) {
      if (reReviewQuotaExhausted) {
        return Number(a.isReReview) - Number(b.isReReview);
      }
      return Number(b.isReReview) - Number(a.isReReview);
    }
    if (a.requestTimestampMs !== b.requestTimestampMs) {
      return b.requestTimestampMs - a.requestTimestampMs;
    }
    if (a.sourceMtimeMs !== b.sourceMtimeMs) {
      return b.sourceMtimeMs - a.sourceMtimeMs;
    }
    return b.prNumber - a.prNumber;
  });
}
function mergePendingRequests(queued, scanned, consecutiveReReviews) {
  const merged = /* @__PURE__ */ new Map();
  for (const request of [...queued, ...scanned]) {
    merged.set(computePendingRequestKey(request), request);
  }
  return sortRequests([...merged.values()], consecutiveReReviews);
}
function createHeadlessLoop(options) {
  const envConfig = getHeadlessEnvConfig();
  const terminationConfig = {
    ...DEFAULT_TERMINATION_CONFIG,
    maxRounds: envConfig?.maxRounds ?? DEFAULT_TERMINATION_CONFIG.maxRounds,
    qualitySeverityFloor: envConfig?.qualityFloor ?? DEFAULT_TERMINATION_CONFIG.qualitySeverityFloor
  };
  const state = {
    running: false,
    activeSession: null,
    pendingRequests: [],
    completedSessions: 0,
    lastPollAt: null
  };
  let sessionTimeouts = 0;
  let roundTimeouts = 0;
  let consecutiveReReviews = 0;
  let lastCompletionAt = null;
  const PROCESSED_MARKER_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1e3;
  const GC_INTERVAL_MS = 60 * 60 * 1e3;
  let lastGcAt = 0;
  let timer = null;
  const prHeadCache = /* @__PURE__ */ new Map();
  let watcher = null;
  let watchRestartTimer = null;
  const WATCH_DEBOUNCE_MS = 150;
  const WATCH_RESTART_MS = 2e3;
  let lastWatchWakeMs = 0;
  function startInboxWatcher() {
    disposeInboxWatcher();
    const inboxDir = path34.join(options.commsDir, "inbox");
    if (!fs37.existsSync(inboxDir)) {
      fs37.mkdirSync(inboxDir, { recursive: true });
    }
    try {
      watcher = fs37.watch(inboxDir, (eventType, filename) => {
        if (!filename || !filename.endsWith(".md")) return;
        if (filename.includes("headless-dispatch-")) return;
        const now = Date.now();
        if (now - lastWatchWakeMs < WATCH_DEBOUNCE_MS) return;
        lastWatchWakeMs = now;
        log2(`fs.watch wake: ${eventType} ${filename}`);
        pollOnce();
      });
      watcher.on("error", (error) => {
        log2(
          `fs.watch error: ${error instanceof Error ? error.message : String(error)}`
        );
        scheduleWatchRestart("error");
      });
      watcher.on("close", () => {
        scheduleWatchRestart("close");
      });
      log2("fs.watch active on inbox");
    } catch (error) {
      log2(
        `fs.watch start failed: ${error instanceof Error ? error.message : String(error)}`
      );
      scheduleWatchRestart("start-failed");
    }
  }
  function disposeInboxWatcher() {
    if (!watcher) return;
    watcher.removeAllListeners();
    try {
      watcher.close();
    } catch {
    }
    watcher = null;
  }
  function scheduleWatchRestart(reason) {
    if (watchRestartTimer) return;
    log2(`fs.watch restart scheduled (${reason})`);
    watchRestartTimer = setTimeout(() => {
      watchRestartTimer = null;
      if (!state.running) return;
      startInboxWatcher();
    }, WATCH_RESTART_MS);
    if (watchRestartTimer.unref) watchRestartTimer.unref();
  }
  function log2(msg) {
    const ts = (/* @__PURE__ */ new Date()).toISOString();
    console.error(`[${ts}] [headless-loop] ${msg}`);
  }
  function dispatchSender() {
    return "headless";
  }
  function dispatchSubject(prNumber, round) {
    return round == null ? `headless-dispatch-pr${prNumber}` : `headless-dispatch-pr${prNumber}-r${round}`;
  }
  function dispatchFilename(prNumber, round) {
    const date = (/* @__PURE__ */ new Date()).toISOString().split("T")[0].replace(/-/g, "");
    return `${date}-${dispatchSender()}-${options.agentName}-${dispatchSubject(prNumber, round)}.md`;
  }
  function dispatchFileMatch(prNumber) {
    return `-${dispatchSender()}-${options.agentName}-headless-dispatch-pr${prNumber}`;
  }
  function computeOldestPendingMs() {
    if (state.pendingRequests.length === 0) return null;
    const oldest = Math.min(
      ...state.pendingRequests.map((r) => r.requestTimestampMs)
    );
    return Date.now() - oldest;
  }
  function computeActiveSessionAgeMs() {
    if (!state.activeSession) return null;
    return Date.now() - new Date(state.activeSession.startedAt).getTime();
  }
  function countProcessedMarkers() {
    const markerDir = path34.join(options.stateDir, "processed");
    if (!fs37.existsSync(markerDir)) return 0;
    try {
      return fs37.readdirSync(markerDir).filter((f) => f.endsWith(".done")).length;
    } catch {
      return 0;
    }
  }
  function maybeGcProcessedMarkers() {
    const now = Date.now();
    if (now - lastGcAt < GC_INTERVAL_MS) return;
    lastGcAt = now;
    gcProcessedMarkers();
  }
  function gcProcessedMarkers() {
    const markerDir = path34.join(options.stateDir, "processed");
    if (!fs37.existsSync(markerDir)) return 0;
    const now = Date.now();
    let removed = 0;
    try {
      for (const file of fs37.readdirSync(markerDir)) {
        if (!file.endsWith(".done")) continue;
        const filePath = path34.join(markerDir, file);
        try {
          const age = now - fs37.statSync(filePath).mtimeMs;
          if (age > PROCESSED_MARKER_MAX_AGE_MS) {
            fs37.unlinkSync(filePath);
            removed++;
          }
        } catch {
        }
      }
    } catch {
    }
    if (removed > 0)
      log2(`GC: removed ${removed} stale processed markers (>7d)`);
    return removed;
  }
  function writeStateFile() {
    try {
      const payload = {
        running: state.running,
        agentName: options.agentName,
        generation: options.generation,
        pollIntervalMs: options.pollIntervalMs,
        completedSessions: state.completedSessions,
        lastPollAt: state.lastPollAt,
        pendingReviewCount: state.pendingRequests.length,
        pendingReviews: state.pendingRequests.map((request) => ({
          prNumber: request.prNumber,
          sender: request.sender,
          isReReview: request.isReReview,
          round: request.round
        })),
        activeReview: state.activeSession ? {
          prNumber: state.activeSession.request.prNumber,
          round: state.activeSession.rounds.length + 1,
          startedAt: state.activeSession.startedAt,
          sender: state.activeSession.request.sender
        } : null,
        terminationConfig: {
          maxRounds: terminationConfig.maxRounds,
          qualitySeverityFloor: terminationConfig.qualitySeverityFloor
        },
        // M326: Operational metrics for queue health monitoring
        metrics: {
          oldestPendingMs: computeOldestPendingMs(),
          activeSessionAgeMs: computeActiveSessionAgeMs(),
          lastCompletionAt,
          sessionTimeouts,
          roundTimeouts,
          consecutiveReReviews,
          processedMarkerCount: countProcessedMarkers()
        },
        updatedAt: (/* @__PURE__ */ new Date()).toISOString()
      };
      const filePath = path34.join(options.stateDir, "headless-state.json");
      const tmp = `${filePath}.tmp.${process.pid}`;
      fs37.writeFileSync(tmp, JSON.stringify(payload, null, 2), "utf-8");
      fs37.renameSync(tmp, filePath);
    } catch {
    }
  }
  function requestStillEligible(request) {
    if (!fs37.existsSync(request.sourcePath)) return false;
    const bypassProcessedCheck = request.isReReview && state.activeSession?.request.prNumber === request.prNumber;
    if (!bypassProcessedCheck && isAlreadyProcessed(options.stateDir, request))
      return false;
    const bypassStaleCheck = request.isReReview && state.activeSession?.request.prNumber === request.prNumber;
    if (!bypassStaleCheck && isStaleReviewRequest(request, options.repoRoot, options.agentName))
      return false;
    return true;
  }
  function refreshPendingQueue() {
    const queued = state.pendingRequests.filter(requestStillEligible);
    const scanned = scanInboxForReviews(
      options.commsDir,
      options.stateDir,
      options.repoRoot,
      options.generation,
      options.agentName,
      options.agentId,
      state.activeSession?.request.prNumber ?? null,
      prHeadCache
    );
    state.pendingRequests = mergePendingRequests(
      queued,
      scanned,
      consecutiveReReviews
    );
  }
  function pollOnce() {
    if (!state.running) return;
    state.lastPollAt = (/* @__PURE__ */ new Date()).toISOString();
    maybeGcProcessedMarkers();
    refreshPendingQueue();
    if (state.activeSession) {
      checkActiveSession();
      if (state.activeSession) {
        writeStateFile();
        return;
      }
    }
    if (state.pendingRequests.length === 0) {
      writeStateFile();
      return;
    }
    const request = state.pendingRequests.shift();
    if (!request) {
      writeStateFile();
      return;
    }
    startReviewSession(request);
    writeStateFile();
  }
  function startReviewSession(request) {
    log2(`Starting review for PR #${request.prNumber}`);
    markAsProcessed(options.stateDir, request);
    try {
      writeReviewReceipt(options.commsDir, request, options.agentName);
      const prompt = buildReviewPrompt(request, options.agentName, 1);
      const inboxDir = path34.join(options.commsDir, "inbox");
      fs37.mkdirSync(inboxDir, { recursive: true });
      const dispatchFile = path34.join(
        inboxDir,
        dispatchFilename(request.prNumber)
      );
      const tmp = `${dispatchFile}.tmp.${process.pid}`;
      fs37.writeFileSync(tmp, prompt, "utf-8");
      fs37.renameSync(tmp, dispatchFile);
      state.activeSession = {
        request,
        agentName: options.agentName,
        role: envConfig?.role ?? "reviewer",
        rounds: [],
        startedAt: (/* @__PURE__ */ new Date()).toISOString(),
        reviewFilePath: reviewFilePath(
          options.repoRoot,
          request.generation,
          request.prNumber,
          options.agentName
        )
      };
      log2(`Dispatched review prompt for PR #${request.prNumber} (round 1)`);
    } catch (err) {
      log2(
        `Failed to start review for PR #${request.prNumber}: ${err instanceof Error ? err.message : String(err)}`
      );
      unmarkProcessed(options.stateDir, request);
    }
  }
  function checkActiveSession() {
    if (!state.activeSession) return;
    const session = state.activeSession;
    const revPath = session.reviewFilePath;
    let hasNewOutput = false;
    if (fs37.existsSync(revPath)) {
      const stat = fs37.statSync(revPath);
      const lastRound = session.rounds[session.rounds.length - 1];
      const lastCheck = lastRound?.timestamp ?? session.startedAt;
      hasNewOutput = stat.mtime.toISOString() > lastCheck;
    }
    if (hasNewOutput) {
      const roundNum = session.rounds.length + 1;
      const round = parseReviewOutput(revPath, roundNum);
      if (!round) return;
      session.rounds.push(round);
      log2(
        `PR #${session.request.prNumber} round ${roundNum}: ${round.findingCount} findings, ${round.suggestedDiffLines} suggested diff lines`
      );
      const stopSignalPath = path34.join(options.stateDir, "stop-signal");
      const ctx = {
        round: roundNum,
        rounds: session.rounds,
        stopSignalPath,
        config: terminationConfig
      };
      const result = evaluate(ctx);
      if (result.verdict === "stop") {
        log2(
          `PR #${session.request.prNumber} terminated: ${result.reason} (${result.strategy})`
        );
        completeSession(session);
      } else {
        log2(
          `PR #${session.request.prNumber} continues to round ${roundNum + 1}`
        );
        dispatchFollowUp(session, roundNum + 1);
      }
      return;
    }
    const SESSION_TIMEOUT_MS = 10 * 60 * 1e3;
    const elapsed = Date.now() - new Date(session.startedAt).getTime();
    if (elapsed > SESSION_TIMEOUT_MS && session.rounds.length === 0) {
      log2(
        `PR #${session.request.prNumber} timed out \u2014 no output after ${Math.round(elapsed / 6e4)}min. Releasing session.`
      );
      sessionTimeouts++;
      state.activeSession = null;
      return;
    }
    const ROUND_TIMEOUT_MS = 5 * 60 * 1e3;
    if (session.rounds.length > 0) {
      const lastRoundTime = new Date(
        session.rounds[session.rounds.length - 1].timestamp
      ).getTime();
      if (Date.now() - lastRoundTime > ROUND_TIMEOUT_MS) {
        log2(
          `PR #${session.request.prNumber} round timeout \u2014 no new output after ${Math.round((Date.now() - lastRoundTime) / 6e4)}min. Completing session.`
        );
        roundTimeouts++;
        completeSession(session);
        return;
      }
    }
  }
  function dispatchFollowUp(session, round) {
    const prompt = buildReviewPrompt(session.request, options.agentName, round);
    const inboxDir = path34.join(options.commsDir, "inbox");
    fs37.mkdirSync(inboxDir, { recursive: true });
    const dispatchFile = path34.join(
      inboxDir,
      dispatchFilename(session.request.prNumber, round)
    );
    const tmp = `${dispatchFile}.tmp.${process.pid}`;
    fs37.writeFileSync(tmp, prompt, "utf-8");
    fs37.renameSync(tmp, dispatchFile);
  }
  function completeSession(session) {
    session.terminatedAt = (/* @__PURE__ */ new Date()).toISOString();
    lastCompletionAt = session.terminatedAt;
    if (session.request.isReReview) {
      consecutiveReReviews++;
    } else {
      consecutiveReReviews = 0;
    }
    const inboxDir = path34.join(options.commsDir, "inbox");
    if (fs37.existsSync(inboxDir)) {
      const prefix = dispatchFileMatch(session.request.prNumber);
      const files = fs37.readdirSync(inboxDir).filter((f) => f.includes(prefix));
      for (const f of files) {
        fs37.unlinkSync(path34.join(inboxDir, f));
      }
    }
    state.activeSession = null;
    state.completedSessions++;
    log2(
      `PR #${session.request.prNumber} review complete (${session.rounds.length} rounds)`
    );
  }
  return {
    start() {
      if (!isHeadlessReviewer()) {
        log2("Not in headless mode \u2014 loop not started");
        return;
      }
      state.running = true;
      log2(
        `Headless review loop started (${envConfig?.role ?? "reviewer"}, poll ${options.pollIntervalMs}ms, max ${terminationConfig.maxRounds} rounds)`
      );
      gcProcessedMarkers();
      lastGcAt = Date.now();
      writeStateFile();
      pollOnce();
      startInboxWatcher();
      timer = setInterval(pollOnce, options.pollIntervalMs);
    },
    stop() {
      state.running = false;
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      disposeInboxWatcher();
      if (watchRestartTimer) {
        clearTimeout(watchRestartTimer);
        watchRestartTimer = null;
      }
      writeStateFile();
      log2("Headless review loop stopped");
    },
    getState() {
      return { ...state };
    }
  };
}
var MAX_CONSECUTIVE_REREVIEWS;
var init_headless_loop = __esm({
  "src/engine/headless-loop.ts"() {
    "use strict";
    init_review();
    init_termination();
    MAX_CONSECUTIVE_REREVIEWS = 3;
  }
});

// src/bridges/codex-bridge-runner.ts
import * as fs38 from "fs";
import * as path35 from "path";
import { spawn as spawn2 } from "child_process";
import { fileURLToPath as fileURLToPath4, pathToFileURL } from "url";
function resolveRepoRootHintFromRunner(runnerUrl = import.meta.url, env = process.env, fileExists = fs38.existsSync) {
  const envRepoRoot = env.TAP_REPO_ROOT?.trim();
  if (envRepoRoot) {
    return path35.resolve(envRepoRoot);
  }
  let dir = path35.resolve(path35.dirname(fileURLToPath4(runnerUrl)));
  while (true) {
    if (fileExists(path35.join(dir, SHARED_CONFIG_FILE))) return dir;
    if (fileExists(path35.join(dir, LOCAL_CONFIG_FILE))) return dir;
    if (fileExists(
      path35.join(dir, "scripts", "codex", "codex-app-server-bridge.ts")
    )) {
      return dir;
    }
    if (fileExists(path35.join(dir, "scripts", "codex-app-server-bridge.ts")))
      return dir;
    const parent = path35.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}
function maybeStartHeadlessLoop(repoRoot, commsDir, stateDir) {
  if (process.env.TAP_HEADLESS !== "true") return;
  Promise.resolve().then(() => (init_headless_loop(), headless_loop_exports)).then(({ createHeadlessLoop: createHeadlessLoop2 }) => {
    const agentName = process.env.TAP_AGENT_NAME ?? process.env.CODEX_TAP_AGENT_NAME ?? "reviewer";
    const agentId = process.env.TAP_AGENT_ID ?? process.env.TAP_BRIDGE_INSTANCE_ID ?? agentName;
    const generation = resolveHeadlessReviewGeneration(repoRoot, commsDir);
    const resolvedStateDir = stateDir ?? path35.join(repoRoot, ".tap-comms");
    const loop = createHeadlessLoop2({
      commsDir,
      stateDir: resolvedStateDir,
      repoRoot,
      agentId,
      agentName,
      generation,
      pollIntervalMs: 3e3
      // Poll faster than generic bridge (5s) for review priority
    });
    loop.start();
    process.on("SIGTERM", () => loop.stop());
    process.on("SIGINT", () => loop.stop());
  }).catch((err) => {
    console.error("[headless-loop] Failed to start:", err);
  });
}
function resolveHeadlessReviewGeneration(repoRoot, commsDir, env = process.env) {
  const explicit = env.TAP_REVIEW_GENERATION?.trim();
  if (explicit) return explicit;
  const envGeneration = normalizeGenerationValue(env.TAP_GENERATION);
  if (envGeneration) return envGeneration;
  try {
    const reviewsDir = path35.join(repoRoot, "reviews");
    const generations = readGenerationNumbers(reviewsDir);
    if (generations.length > 0) {
      return `gen${generations[0]}`;
    }
  } catch {
  }
  const resolvedCommsDir = commsDir?.trim() || env.TAP_COMMS_DIR?.trim() || null;
  if (resolvedCommsDir) {
    const commsGenerations = [
      ...readGenerationNumbers(path35.join(resolvedCommsDir, "retros")),
      ...readGenerationNumbers(path35.join(resolvedCommsDir, "letters"))
    ].sort((a, b) => b - a);
    if (commsGenerations.length > 0) {
      return `gen${commsGenerations[0]}`;
    }
  }
  return "gen1";
}
function normalizeGenerationValue(value) {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/^gen(\d+)$/i) ?? trimmed.match(/^(\d+)$/);
  if (!match?.[1]) return null;
  return `gen${Number.parseInt(match[1], 10)}`;
}
function readGenerationNumbers(dir) {
  try {
    return fs38.readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => normalizeGenerationValue(entry.name)).filter((value) => Boolean(value)).map((value) => Number.parseInt(value.slice(3), 10)).filter(Number.isFinite).sort((a, b) => b - a);
  } catch {
    return [];
  }
}
function resolveBridgeDaemonScript(repoRoot, runnerUrl = import.meta.url, fileExists = fs38.existsSync) {
  const moduleDir = path35.dirname(fileURLToPath4(runnerUrl));
  const candidates = [
    // 1. Bundled standalone/npm install
    path35.join(moduleDir, "codex-app-server-bridge.mjs"),
    // 2. Source run from monorepo package
    path35.join(moduleDir, "codex-app-server-bridge.ts"),
    // 3. Built monorepo package dist
    path35.join(
      repoRoot,
      "packages",
      "tap-comms",
      "dist",
      "bridges",
      "codex-app-server-bridge.mjs"
    ),
    // 4. Monorepo source wrapper
    path35.join(
      repoRoot,
      "packages",
      "tap-comms",
      "src",
      "bridges",
      "codex-app-server-bridge.ts"
    ),
    // 5. Monorepo scripts/codex/ subfolder
    path35.join(repoRoot, "scripts", "codex", "codex-app-server-bridge.ts"),
    // 6. Legacy monorepo root script (pre-cleanup)
    path35.join(repoRoot, "scripts", "codex-app-server-bridge.ts")
  ];
  for (const candidate of candidates) {
    if (fileExists(candidate)) {
      return candidate;
    }
  }
  return null;
}
function buildBridgeScriptArgs(scriptPath, options) {
  const args = [
    scriptPath,
    `--repo-root=${options.repoRoot}`,
    `--comms-dir=${options.commsDir}`,
    `--app-server-url=${options.appServerUrl}`
  ];
  if (options.agentName) {
    args.push(`--agent-name=${options.agentName}`);
  }
  if (options.gatewayTokenFile) {
    args.push(`--gateway-token-file=${options.gatewayTokenFile}`);
  }
  if (options.stateDir) {
    args.push(`--state-dir=${options.stateDir}`);
  }
  return args;
}
function buildBridgeDaemonEnv(parentEnv, runtimeEnv) {
  return {
    ...parentEnv,
    ...runtimeEnv
  };
}
function normalizeRoutingSlot(value) {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === "tower") return "tower";
  if (normalized === "reviewer") return "reviewer";
  const worktreeMatch = normalized.match(/^wt[-_]?(\d+)$/);
  if (worktreeMatch) {
    return `wt-${Number.parseInt(worktreeMatch[1], 10)}`;
  }
  return null;
}
function resolveBridgeRoutingSlot(repoRoot, env = process.env) {
  const explicit = normalizeRoutingSlot(env.TAP_ROUTING_SLOT);
  if (explicit) return explicit;
  const instanceId = env.TAP_INSTANCE_ID?.trim() || env.TAP_BRIDGE_INSTANCE_ID?.trim() || "";
  const normalizedInstance = instanceId.toLowerCase().replace(/_/g, "-");
  if (normalizedInstance === "tower" || normalizedInstance === "claude-main" || normalizedInstance === "codex-main") {
    return "tower";
  }
  if (normalizedInstance === "reviewer" || normalizedInstance === "claude-reviewer" || normalizedInstance === "codex-reviewer") {
    return "reviewer";
  }
  if (/^(?:(?:claude|codex)-)?wt-?(\d+)$/.test(normalizedInstance)) {
    return normalizeRoutingSlot(
      normalizedInstance.replace(/^(?:claude|codex)-/, "")
    );
  }
  return normalizeRoutingSlot(path35.basename(repoRoot));
}
async function main() {
  const repoRootHint = resolveRepoRootHintFromRunner() ?? void 0;
  const { config } = resolveConfig({}, repoRootHint);
  const repoRoot = config.repoRoot;
  const commsDir = config.commsDir;
  const instancePortRaw = process.env.TAP_BRIDGE_PORT;
  const instancePort = instancePortRaw ? Number.parseInt(instancePortRaw, 10) : void 0;
  const envAppServerUrl = process.env.CODEX_APP_SERVER_URL?.trim();
  const gatewayTokenFile = process.env.TAP_GATEWAY_TOKEN_FILE?.trim();
  const appServerUrl = envAppServerUrl || resolveAppServerUrl(
    config.appServerUrl,
    Number.isFinite(instancePort) ? instancePort : void 0
  );
  const instanceId = process.env.TAP_BRIDGE_INSTANCE_ID;
  const envStateDir = process.env.TAP_RUNTIME_STATE_DIR;
  let stateDir;
  if (envStateDir) {
    stateDir = envStateDir;
  } else if (instanceId) {
    const resolved2 = path35.resolve(
      path35.join(repoRoot, ".tmp", `codex-app-server-bridge-${instanceId}`)
    );
    const expectedBase = path35.resolve(repoRoot, ".tmp") + path35.sep;
    if (!resolved2.startsWith(expectedBase)) {
      throw new Error(
        `Path traversal blocked: runtime state dir escapes .tmp/ directory`
      );
    }
    stateDir = resolved2;
  }
  const preResolved = process.env.TAP_RESOLVED_NODE;
  const resolved = preResolved ? {
    command: preResolved,
    supportsStripTypes: process.env.TAP_STRIP_TYPES === "1",
    source: "env",
    majorVersion: null
  } : resolveNodeRuntime(config.runtimeCommand, repoRoot);
  const command = resolved.command;
  const agentName = process.env.TAP_AGENT_NAME?.trim() || process.env.CODEX_TAP_AGENT_NAME?.trim() || void 0;
  const scriptPath = resolveBridgeDaemonScript(repoRoot);
  if (!scriptPath) {
    throw new Error(
      `Bridge script not found for repo root ${repoRoot}.
Expected a packaged dist/bridges/codex-app-server-bridge.mjs or monorepo bridge script.`
    );
  }
  const args = [];
  if (resolved.supportsStripTypes) {
    args.push("--experimental-strip-types");
  }
  args.push(
    ...buildBridgeScriptArgs(scriptPath, {
      repoRoot,
      commsDir,
      appServerUrl,
      gatewayTokenFile,
      stateDir,
      agentName
    })
  );
  const busyMode = process.env.TAP_BUSY_MODE;
  if (busyMode) args.push(`--busy-mode=${busyMode}`);
  const pollSeconds = process.env.TAP_POLL_SECONDS;
  if (pollSeconds) args.push(`--poll-seconds=${pollSeconds}`);
  const reconnectSeconds = process.env.TAP_RECONNECT_SECONDS;
  if (reconnectSeconds) args.push(`--reconnect-seconds=${reconnectSeconds}`);
  const lookbackMinutes = process.env.TAP_MESSAGE_LOOKBACK_MINUTES;
  if (lookbackMinutes)
    args.push(`--message-lookback-minutes=${lookbackMinutes}`);
  const threadId = process.env.TAP_THREAD_ID;
  if (threadId) args.push(`--thread-id=${threadId}`);
  if (process.env.TAP_EPHEMERAL === "true") args.push("--ephemeral");
  if (process.env.TAP_PROCESS_EXISTING === "true")
    args.push("--process-existing-messages");
  const runtimeEnv = buildRuntimeEnv(repoRoot);
  const daemonEnv = buildBridgeDaemonEnv(process.env, runtimeEnv);
  const routingSlot = resolveBridgeRoutingSlot(repoRoot, daemonEnv);
  if (routingSlot && !daemonEnv.TAP_ROUTING_SLOT) {
    daemonEnv.TAP_ROUTING_SLOT = routingSlot;
  }
  const child = spawn2(command, args, {
    cwd: repoRoot,
    env: daemonEnv,
    stdio: "inherit"
  });
  maybeStartHeadlessLoop(repoRoot, commsDir, stateDir);
  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 0);
  });
  child.on("error", (error) => {
    console.error(String(error));
    process.exit(1);
  });
}
function isDirectExecution() {
  const entry = process.argv[1];
  if (!entry) return false;
  if (!path35.basename(entry).startsWith("codex-bridge-runner")) return false;
  return import.meta.url === pathToFileURL(path35.resolve(entry)).href;
}
var init_codex_bridge_runner = __esm({
  "src/bridges/codex-bridge-runner.ts"() {
    "use strict";
    init_config();
    init_bridge();
    init_runtime();
    if (isDirectExecution()) {
      main().catch((error) => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exit(1);
      });
    }
  }
});

// src/adapters/claude.ts
import * as fs39 from "fs";
import * as path36 from "path";
import { execSync as execSync4 } from "child_process";
function findMcpJsonPath(ctx) {
  return path36.join(ctx.repoRoot, ".mcp.json");
}
function findClaudeCommand() {
  try {
    execSync4("claude --version", { stdio: "pipe" });
    return "claude";
  } catch {
    return null;
  }
}
function buildMcpServerEntry(ctx) {
  const managed = buildManagedMcpServerSpec(ctx, ctx.instanceId);
  if (!managed.command) return null;
  return {
    type: "stdio",
    command: managed.command,
    args: managed.args,
    env: managed.env
  };
}
function setNestedKey(obj, keyPath, value) {
  const keys = keyPath.split(".");
  let current = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (typeof current[key] !== "object" || current[key] === null) {
      current[key] = {};
    }
    current = current[key];
  }
  current[keys[keys.length - 1]] = value;
}
function normalizeTapCommsDir(value) {
  return typeof value === "string" ? path36.resolve(value).replace(/\\/g, "/") : "";
}
var MCP_SERVER_KEY, OLD_MCP_SERVER_KEY, claudeAdapter;
var init_claude = __esm({
  "src/adapters/claude.ts"() {
    "use strict";
    init_state();
    init_common();
    MCP_SERVER_KEY = "tap";
    OLD_MCP_SERVER_KEY = "tap-comms";
    claudeAdapter = {
      runtime: "claude",
      async probe(ctx) {
        const warnings = [];
        const issues = [];
        const configPath = findMcpJsonPath(ctx);
        const configExists = fs39.existsSync(configPath);
        const runtimeCommand = findClaudeCommand();
        const canWrite = configExists ? (() => {
          try {
            fs39.accessSync(configPath, fs39.constants.W_OK);
            return true;
          } catch {
            return false;
          }
        })() : true;
        if (!runtimeCommand) {
          warnings.push(
            "Claude CLI not found in PATH. Config will be created but may need manual setup."
          );
        }
        const managed = buildManagedMcpServerSpec(ctx);
        warnings.push(...managed.warnings);
        issues.push(...managed.issues);
        if (!fs39.existsSync(ctx.commsDir)) {
          issues.push(
            `Comms directory not found: ${ctx.commsDir}. Run "init" first.`
          );
        }
        return {
          installed: true,
          // Claude adapter always "installed" — .mcp.json is per-project
          configPath,
          configExists,
          runtimeCommand,
          version: null,
          canWrite,
          warnings,
          issues
        };
      },
      async plan(ctx, probe) {
        const configPath = probe.configPath ?? findMcpJsonPath(ctx);
        const conflicts = [];
        const warnings = [];
        const operations = [];
        const ownedArtifacts = [];
        if (probe.configExists) {
          const raw = fs39.readFileSync(configPath, "utf-8");
          try {
            const config = JSON.parse(raw);
            if (config.mcpServers?.[MCP_SERVER_KEY]) {
              conflicts.push(
                `Existing "${MCP_SERVER_KEY}" entry in .mcp.json will be overwritten.`
              );
            }
            if (config.mcpServers?.[OLD_MCP_SERVER_KEY]) {
              conflicts.push(
                `Legacy "${OLD_MCP_SERVER_KEY}" entry will be migrated to "${MCP_SERVER_KEY}".`
              );
            }
          } catch {
            warnings.push(
              ".mcp.json exists but is not valid JSON. Will be overwritten."
            );
          }
        }
        const serverEntry = buildMcpServerEntry(ctx);
        if (!serverEntry) {
          warnings.push(
            "tap MCP server entry not found. Skipping .mcp.json patch. Reinstall @hua-labs/tap or run from a repo with packages/tap-plugin/channels/ available."
          );
          return {
            runtime: "claude",
            operations: [],
            ownedArtifacts: [],
            backupDir: ensureBackupDir(ctx.stateDir, "claude"),
            restartRequired: false,
            conflicts,
            warnings
          };
        }
        operations.push({
          type: probe.configExists ? "merge" : "set",
          path: configPath,
          key: `mcpServers.${MCP_SERVER_KEY}`,
          value: serverEntry
        });
        ownedArtifacts.push({
          kind: "json-path",
          path: configPath,
          selector: `mcpServers.${MCP_SERVER_KEY}`
        });
        const backupDir = ensureBackupDir(ctx.stateDir, "claude");
        return {
          runtime: "claude",
          operations,
          ownedArtifacts,
          backupDir,
          restartRequired: true,
          conflicts,
          warnings
        };
      },
      async apply(_ctx, plan) {
        const changedFiles = [];
        const warnings = [];
        let appliedOps = 0;
        for (const op of plan.operations) {
          try {
            if (op.type === "set" || op.type === "merge") {
              let config = {};
              if (fs39.existsSync(op.path)) {
                backupFile(op.path, plan.backupDir);
                const raw = fs39.readFileSync(op.path, "utf-8");
                try {
                  config = JSON.parse(raw);
                } catch {
                  warnings.push(
                    `${op.path} was invalid JSON. Created backup and starting fresh.`
                  );
                }
              }
              const servers = config.mcpServers;
              if (servers?.[OLD_MCP_SERVER_KEY]) {
                delete servers[OLD_MCP_SERVER_KEY];
              }
              if (op.key) {
                setNestedKey(config, op.key, op.value);
              }
              const tmp = `${op.path}.tmp.${process.pid}`;
              fs39.writeFileSync(
                tmp,
                JSON.stringify(config, null, 2) + "\n",
                "utf-8"
              );
              fs39.renameSync(tmp, op.path);
              changedFiles.push(op.path);
              appliedOps++;
            }
          } catch (err) {
            warnings.push(
              `Failed to apply op on ${op.path}: ${err instanceof Error ? err.message : String(err)}`
            );
          }
        }
        const lastAppliedHash = changedFiles.length > 0 ? fileHash(changedFiles[0]) : "";
        return {
          success: appliedOps > 0,
          appliedOps,
          backupCreated: true,
          lastAppliedHash,
          ownedArtifacts: plan.ownedArtifacts,
          changedFiles,
          restartRequired: plan.restartRequired,
          warnings
        };
      },
      async verify(ctx, plan) {
        const checks = [];
        const warnings = [];
        const configPath = plan.operations[0]?.path;
        if (configPath) {
          checks.push({
            name: "Config file exists",
            passed: fs39.existsSync(configPath),
            message: fs39.existsSync(configPath) ? void 0 : `${configPath} not found`
          });
          if (fs39.existsSync(configPath)) {
            try {
              const raw = fs39.readFileSync(configPath, "utf-8");
              const config = JSON.parse(raw);
              checks.push({ name: "Config is valid JSON", passed: true });
              const entry = config.mcpServers?.[MCP_SERVER_KEY];
              checks.push({
                name: "tap entry present",
                passed: !!entry,
                message: entry ? void 0 : `mcpServers.${MCP_SERVER_KEY} not found`
              });
              if (entry) {
                const hasCommsDir = normalizeTapCommsDir(entry.env?.TAP_COMMS_DIR) === normalizeTapCommsDir(ctx.commsDir);
                checks.push({
                  name: "TAP_COMMS_DIR configured",
                  passed: hasCommsDir,
                  message: hasCommsDir ? void 0 : `Expected ${ctx.commsDir}`
                });
              }
            } catch {
              checks.push({
                name: "Config is valid JSON",
                passed: false,
                message: "Parse error"
              });
            }
          }
        }
        checks.push({
          name: "Comms directory exists",
          passed: fs39.existsSync(ctx.commsDir),
          message: fs39.existsSync(ctx.commsDir) ? void 0 : `${ctx.commsDir} not found`
        });
        const cmd = findClaudeCommand();
        checks.push({
          name: "Claude CLI found",
          passed: !!cmd,
          message: cmd ? void 0 : "claude not in PATH (non-blocking)"
        });
        if (!cmd) {
          warnings.push(
            "Claude CLI not in PATH. Config is ready but cannot verify runtime reads it."
          );
        }
        const ok = checks.filter((c) => c.name !== "Claude CLI found").every((c) => c.passed);
        return { ok, checks, restartRequired: true, warnings };
      },
      bridgeMode() {
        return "native-push";
      }
    };
  }
});

// src/artifact-backups.ts
import * as crypto4 from "crypto";
import * as fs40 from "fs";
import * as path37 from "path";
function selectorHash(selector) {
  return crypto4.createHash("sha256").update(selector).digest("hex").slice(0, 12);
}
function artifactBackupPath(backupDir, kind, selector) {
  const safeKind = kind.replace(/[^a-z-]/gi, "-");
  return path37.join(backupDir, `${safeKind}-${selectorHash(selector)}.json`);
}
function writeArtifactBackup(backupPath, payload) {
  fs40.mkdirSync(path37.dirname(backupPath), { recursive: true });
  const tmp = `${backupPath}.tmp.${process.pid}`;
  fs40.writeFileSync(tmp, JSON.stringify(payload, null, 2) + "\n", "utf-8");
  fs40.renameSync(tmp, backupPath);
}
var init_artifact_backups = __esm({
  "src/artifact-backups.ts"() {
    "use strict";
  }
});

// src/toml.ts
function splitLines(content) {
  return content.replace(/\r\n/g, "\n").split("\n");
}
function tableHeader(selector) {
  return `[${selector}]`;
}
function findTableRange(lines, selector) {
  const header = tableHeader(selector);
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() !== header) continue;
    let end = lines.length;
    for (let j = i + 1; j < lines.length; j++) {
      const trimmed = lines[j].trim();
      if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
        end = j;
        break;
      }
    }
    return { start: i, end };
  }
  return null;
}
function escapeBasicString(value) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
function renderValue(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => `"${escapeBasicString(item)}"`).join(", ")}]`;
  }
  return `"${escapeBasicString(value)}"`;
}
function extractTomlTable(content, selector) {
  const lines = splitLines(content);
  const range = findTableRange(lines, selector);
  if (!range) return null;
  return `${lines.slice(range.start, range.end).join("\n")}
`;
}
function removeTomlTable(content, selector) {
  const lines = splitLines(content);
  const range = findTableRange(lines, selector);
  if (!range) return content;
  const next = [...lines.slice(0, range.start), ...lines.slice(range.end)];
  return `${trimTomlDocument(next.join("\n"))}
`;
}
function replaceTomlTable(content, selector, replacement) {
  const lines = splitLines(content);
  const range = findTableRange(lines, selector);
  const replacementLines = replacement.replace(/\r\n/g, "\n").trimEnd().split("\n");
  if (!range) {
    const doc = trimTomlDocument(content);
    if (!doc) return `${replacement.trimEnd()}
`;
    return `${doc}

${replacement.trimEnd()}
`;
  }
  const next = [
    ...lines.slice(0, range.start),
    ...replacementLines,
    ...lines.slice(range.end)
  ];
  return `${trimTomlDocument(next.join("\n"))}
`;
}
function renderTomlTable(selector, entries, existingContent) {
  const preserved = parseTomlAssignments(existingContent ?? "");
  const merged = { ...preserved, ...entries };
  const lines = [tableHeader(selector)];
  for (const [key, value] of Object.entries(merged)) {
    lines.push(`${key} = ${renderValue(value)}`);
  }
  return `${lines.join("\n")}
`;
}
function parseTomlAssignments(tableContent) {
  const lines = splitLines(tableContent);
  const values = {};
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || line.startsWith("[") && line.endsWith("]")) {
      continue;
    }
    const match = line.match(/^([A-Za-z0-9_.-]+)\s*=\s*(.+)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    const value = stripTomlInlineComment(rawValue.trim());
    if (!value) continue;
    if (value.startsWith("[") && value.endsWith("]")) {
      const items = splitTomlArrayItems(value.slice(1, -1)).map(
        unquoteTomlString
      );
      values[key] = items;
      continue;
    }
    values[key] = unquoteTomlString(value);
  }
  return values;
}
function trimTomlDocument(content) {
  return content.replace(/\s+$/g, "").replace(/\n{3,}/g, "\n\n");
}
function unquoteTomlString(value) {
  if (value.startsWith('"') && value.endsWith('"') || value.startsWith("'") && value.endsWith("'")) {
    const inner = value.slice(1, -1);
    return value.startsWith('"') ? inner.replace(/\\"/g, '"').replace(/\\\\/g, "\\") : inner;
  }
  return value;
}
function stripTomlInlineComment(value) {
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let escaped = false;
  for (let i = 0; i < value.length; i++) {
    const char = value[i];
    if (inDoubleQuote) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === '"') {
        inDoubleQuote = false;
      }
      continue;
    }
    if (inSingleQuote) {
      if (char === "'") {
        inSingleQuote = false;
      }
      continue;
    }
    if (char === '"') {
      inDoubleQuote = true;
      continue;
    }
    if (char === "'") {
      inSingleQuote = true;
      continue;
    }
    if (char === "#" && (i === 0 || /\s/.test(value[i - 1] ?? ""))) {
      return value.slice(0, i).trimEnd();
    }
  }
  return value.trimEnd();
}
function splitTomlArrayItems(value) {
  const items = [];
  let current = "";
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let escaped = false;
  for (let i = 0; i < value.length; i++) {
    const char = value[i];
    if (inDoubleQuote) {
      current += char;
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === '"') {
        inDoubleQuote = false;
      }
      continue;
    }
    if (inSingleQuote) {
      current += char;
      if (char === "'") {
        inSingleQuote = false;
      }
      continue;
    }
    if (char === ",") {
      const item = current.trim();
      if (item) items.push(item);
      current = "";
      continue;
    }
    if (char === '"') {
      inDoubleQuote = true;
    } else if (char === "'") {
      inSingleQuote = true;
    }
    current += char;
  }
  const tail = current.trim();
  if (tail) items.push(tail);
  return items;
}
var init_toml = __esm({
  "src/toml.ts"() {
    "use strict";
  }
});

// src/adapters/codex.ts
import * as fs41 from "fs";
import * as path38 from "path";
function findCodexConfigPath() {
  return getCodexConfigPath();
}
function canonicalizeTrustPath(targetPath) {
  let resolved = path38.resolve(targetPath).replace(/\//g, "\\");
  const driveRoot = /^[A-Za-z]:\\$/;
  if (!driveRoot.test(resolved)) {
    resolved = resolved.replace(/\\+$/g, "");
  }
  return resolved.startsWith("\\\\?\\") ? resolved : `\\\\?\\${resolved}`;
}
function trustSelector(targetPath) {
  return `projects.'${canonicalizeTrustPath(targetPath)}'`;
}
function getTrustTargets(ctx) {
  const targets = [ctx.repoRoot, process.cwd()];
  return [...new Set(targets.map((value) => path38.resolve(value)))];
}
function buildManagedArtifacts(configPath, ctx) {
  const artifacts = [
    { kind: "toml-table", path: configPath, selector: MCP_SELECTOR },
    { kind: "toml-table", path: configPath, selector: ENV_SELECTOR }
  ];
  for (const target of getTrustTargets(ctx)) {
    artifacts.push({
      kind: "toml-table",
      path: configPath,
      selector: trustSelector(target)
    });
  }
  return artifacts;
}
function readConfigOrEmpty(configPath) {
  if (!fs41.existsSync(configPath)) return "";
  return fs41.readFileSync(configPath, "utf-8");
}
function writeTomlFile(filePath, content) {
  fs41.mkdirSync(path38.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp.${process.pid}`;
  fs41.writeFileSync(tmp, content, "utf-8");
  fs41.renameSync(tmp, filePath);
}
function buildSessionNeutralCodexSpec(ctx) {
  const managed = buildManagedMcpServerSpec(ctx);
  const env = {
    ...managed.env,
    TAP_AGENT_NAME: SESSION_NEUTRAL_AGENT_NAME
  };
  delete env.TAP_AGENT_ID;
  return { ...managed, env };
}
function buildCodexEnvEntries(existingTable, managedEnv) {
  const preservedEnv = parseTomlAssignments(existingTable ?? "");
  delete preservedEnv.TAP_AGENT_ID;
  return {
    ...preservedEnv,
    ...managedEnv
  };
}
function verifyManagedToml(content, ctx, configPath) {
  const checks = [];
  const managed = buildSessionNeutralCodexSpec(ctx);
  const mainTable = extractTomlTable(content, MCP_SELECTOR);
  const envTable = extractTomlTable(content, ENV_SELECTOR);
  checks.push({
    name: "Codex config exists",
    passed: fs41.existsSync(configPath),
    message: fs41.existsSync(configPath) ? void 0 : `${configPath} not found`
  });
  checks.push({
    name: "tap MCP table present",
    passed: !!mainTable,
    message: mainTable ? void 0 : `${MCP_SELECTOR} not found`
  });
  checks.push({
    name: "tap env table present",
    passed: !!envTable,
    message: envTable ? void 0 : `${ENV_SELECTOR} not found`
  });
  for (const target of getTrustTargets(ctx)) {
    const selector = trustSelector(target);
    const trustTable = extractTomlTable(content, selector);
    checks.push({
      name: `Trust table present: ${canonicalizeTrustPath(target)}`,
      passed: !!trustTable && trustTable.includes('trust_level = "trusted"'),
      message: trustTable && trustTable.includes('trust_level = "trusted"') ? void 0 : `${selector} missing trust_level = "trusted"`
    });
  }
  if (mainTable && managed.command) {
    const expectedArgs = managed.args.map((a) => `"${a.replace(/\\/g, "\\\\")}"`).join(", ");
    checks.push({
      name: "Managed command configured",
      passed: mainTable.includes(
        `command = "${managed.command.replace(/\\/g, "\\\\")}"`
      ) && mainTable.includes(`args = [${expectedArgs}]`),
      message: "Managed tap command/args do not match expected values"
    });
  }
  if (mainTable) {
    const mainValues = parseTomlAssignments(mainTable);
    checks.push({
      name: "approval_mode is auto",
      passed: mainValues.approval_mode === "auto",
      message: mainValues.approval_mode ? `approval_mode is "${mainValues.approval_mode}", expected "auto"` : 'approval_mode missing, expected "auto"'
    });
  }
  if (envTable) {
    const envValues = parseTomlAssignments(envTable);
    checks.push({
      name: "Managed TAP_AGENT_NAME is session-neutral",
      passed: envValues.TAP_AGENT_NAME === managed.env.TAP_AGENT_NAME,
      message: `TAP_AGENT_NAME should be "${SESSION_NEUTRAL_AGENT_NAME}"`
    });
    checks.push({
      name: "Managed TAP_AGENT_ID is omitted",
      passed: typeof envValues.TAP_AGENT_ID !== "string",
      message: "TAP_AGENT_ID should not be persisted in Codex config"
    });
  }
  return checks;
}
function patchCodexApprovalMode() {
  const configPath = findCodexConfigPath();
  if (!fs41.existsSync(configPath)) return null;
  const content = fs41.readFileSync(configPath, "utf-8");
  const tapTable = extractTomlTable(content, MCP_SELECTOR);
  if (!tapTable) return null;
  const values = parseTomlAssignments(tapTable);
  if (values.approval_mode === "auto") return null;
  const patched = replaceTomlTable(
    content,
    MCP_SELECTOR,
    renderTomlTable(MCP_SELECTOR, { approval_mode: "auto" }, tapTable)
  );
  writeTomlFile(configPath, patched);
  return configPath;
}
var MCP_SELECTOR, ENV_SELECTOR, SESSION_NEUTRAL_AGENT_NAME, OLD_MCP_SELECTOR, OLD_ENV_SELECTOR, codexAdapter;
var init_codex = __esm({
  "src/adapters/codex.ts"() {
    "use strict";
    init_state();
    init_artifact_backups();
    init_toml();
    init_bridge_codex_command();
    init_common();
    MCP_SELECTOR = "mcp_servers.tap";
    ENV_SELECTOR = "mcp_servers.tap.env";
    SESSION_NEUTRAL_AGENT_NAME = "<set-per-session>";
    OLD_MCP_SELECTOR = "mcp_servers.tap-comms";
    OLD_ENV_SELECTOR = "mcp_servers.tap-comms.env";
    codexAdapter = {
      runtime: "codex",
      async probe(ctx) {
        const warnings = [];
        const issues = [];
        const configPath = findCodexConfigPath();
        const configExists = fs41.existsSync(configPath);
        const runtimeProbe = probeCommand(
          ctx.platform === "win32" ? ["codex", "codex.cmd"] : ["codex"]
        );
        if (!runtimeProbe.command) {
          warnings.push(
            "Codex CLI not found in PATH. Config can still be written, but runtime verification will be limited."
          );
        }
        if (!fs41.existsSync(ctx.commsDir)) {
          issues.push(
            `Comms directory not found: ${ctx.commsDir}. Run "init" first.`
          );
        }
        const managed = buildManagedMcpServerSpec(ctx);
        warnings.push(...managed.warnings);
        issues.push(...managed.issues);
        return {
          installed: true,
          configPath,
          configExists,
          runtimeCommand: runtimeProbe.command,
          version: runtimeProbe.version,
          canWrite: canWriteOrCreate(configPath),
          warnings,
          issues
        };
      },
      async plan(ctx, probe) {
        const configPath = probe.configPath ?? findCodexConfigPath();
        const conflicts = [];
        const warnings = [];
        const operations = [];
        const ownedArtifacts = buildManagedArtifacts(configPath, ctx);
        if (probe.configExists) {
          const content = readConfigOrEmpty(configPath);
          if (extractTomlTable(content, MCP_SELECTOR)) {
            conflicts.push(`Existing ${MCP_SELECTOR} table will be updated.`);
          }
          if (extractTomlTable(content, OLD_MCP_SELECTOR)) {
            conflicts.push(
              `Legacy ${OLD_MCP_SELECTOR} table will be migrated to ${MCP_SELECTOR}.`
            );
          }
          if (extractTomlTable(content, ENV_SELECTOR)) {
            conflicts.push(`Existing ${ENV_SELECTOR} table will be updated.`);
          }
          for (const target of getTrustTargets(ctx)) {
            const selector = trustSelector(target);
            if (extractTomlTable(content, selector)) {
              conflicts.push(`Existing ${selector} table will be updated.`);
            }
          }
        }
        for (const artifact of ownedArtifacts) {
          operations.push({
            type: probe.configExists ? "merge" : "set",
            path: configPath,
            key: artifact.selector
          });
        }
        return {
          runtime: "codex",
          operations,
          ownedArtifacts,
          backupDir: ensureBackupDir(ctx.stateDir, "codex"),
          restartRequired: true,
          conflicts,
          warnings
        };
      },
      async apply(ctx, plan) {
        const configPath = plan.operations[0]?.path ?? findCodexConfigPath();
        const warnings = [];
        const changedFiles = [];
        const managed = buildSessionNeutralCodexSpec(ctx);
        warnings.push(...managed.warnings);
        if (managed.issues.length > 0 || !managed.command) {
          return {
            success: false,
            appliedOps: 0,
            backupCreated: false,
            lastAppliedHash: "",
            ownedArtifacts: [],
            changedFiles,
            restartRequired: false,
            warnings: [...managed.warnings, ...managed.issues]
          };
        }
        const existingContent = readConfigOrEmpty(configPath);
        if (fs41.existsSync(configPath) && existingContent) {
          backupFile(configPath, plan.backupDir);
        }
        const artifactsWithBackups = plan.ownedArtifacts.map((artifact) => {
          const previousContent = artifact.kind === "toml-table" ? extractTomlTable(existingContent, artifact.selector) : null;
          const backupPath = artifactBackupPath(
            plan.backupDir,
            artifact.kind,
            artifact.selector
          );
          writeArtifactBackup(backupPath, {
            kind: "toml-table",
            selector: artifact.selector,
            existed: previousContent !== null,
            content: previousContent ?? void 0
          });
          return { ...artifact, backupPath };
        });
        let nextContent = existingContent;
        if (extractTomlTable(nextContent, OLD_ENV_SELECTOR)) {
          nextContent = removeTomlTable(nextContent, OLD_ENV_SELECTOR);
        }
        if (extractTomlTable(nextContent, OLD_MCP_SELECTOR)) {
          nextContent = removeTomlTable(nextContent, OLD_MCP_SELECTOR);
        }
        nextContent = replaceTomlTable(
          nextContent,
          MCP_SELECTOR,
          renderTomlTable(
            MCP_SELECTOR,
            {
              command: managed.command,
              args: managed.args,
              approval_mode: "auto"
            },
            extractTomlTable(existingContent, MCP_SELECTOR)
          )
        );
        nextContent = replaceTomlTable(
          nextContent,
          ENV_SELECTOR,
          renderTomlTable(
            ENV_SELECTOR,
            buildCodexEnvEntries(
              extractTomlTable(existingContent, ENV_SELECTOR),
              managed.env
            )
          )
        );
        for (const target of getTrustTargets(ctx)) {
          const selector = trustSelector(target);
          nextContent = replaceTomlTable(
            nextContent,
            selector,
            renderTomlTable(
              selector,
              { trust_level: "trusted" },
              extractTomlTable(existingContent, selector)
            )
          );
        }
        writeTomlFile(configPath, nextContent);
        changedFiles.push(configPath);
        return {
          success: true,
          appliedOps: plan.operations.length,
          backupCreated: true,
          lastAppliedHash: fileHash(configPath),
          ownedArtifacts: artifactsWithBackups,
          changedFiles,
          restartRequired: true,
          warnings
        };
      },
      async verify(ctx, plan) {
        const warnings = [];
        const configPath = plan.operations[0]?.path ?? findCodexConfigPath();
        const content = readConfigOrEmpty(configPath);
        const runtimeProbe = probeCommand(
          ctx.platform === "win32" ? ["codex", "codex.cmd"] : ["codex"]
        );
        const checks = verifyManagedToml(content, ctx, configPath);
        checks.push({
          name: "Comms directory exists",
          passed: fs41.existsSync(ctx.commsDir),
          message: fs41.existsSync(ctx.commsDir) ? void 0 : `${ctx.commsDir} not found`
        });
        checks.push({
          name: "Codex CLI found",
          passed: !!runtimeProbe.command,
          message: runtimeProbe.command ? void 0 : "codex not in PATH (non-blocking)"
        });
        if (!runtimeProbe.command) {
          warnings.push(
            "Codex CLI not in PATH. Config is written, but runtime verification is partial."
          );
        }
        return {
          ok: checks.filter((check) => check.name !== "Codex CLI found").every((check) => check.passed),
          checks,
          restartRequired: true,
          warnings
        };
      },
      bridgeMode() {
        return "app-server";
      },
      resolveBridgeScript(ctx) {
        return resolvePackagedBridgeAsset(
          ctx.repoRoot,
          "codex-bridge-runner.mjs",
          import.meta.url
        );
      }
    };
  }
});

// src/adapters/gemini.ts
import * as fs42 from "fs";
import * as path39 from "path";
function candidateConfigPaths(ctx) {
  const home = getHomeDir();
  return [
    path39.join(ctx.repoRoot, ".gemini", "settings.json"),
    path39.join(home, ".gemini", "settings.json"),
    path39.join(home, ".gemini", "antigravity", "mcp_config.json")
  ];
}
function chooseGeminiConfigPath(ctx) {
  const [workspaceConfig, homeConfig, antigravityConfig] = candidateConfigPaths(ctx);
  if (fs42.existsSync(workspaceConfig)) return workspaceConfig;
  if (fs42.existsSync(homeConfig)) return homeConfig;
  if (fs42.existsSync(antigravityConfig)) {
    const raw = fs42.readFileSync(antigravityConfig, "utf-8").trim();
    if (raw) {
      try {
        JSON.parse(raw);
        return antigravityConfig;
      } catch {
      }
    }
  }
  return workspaceConfig;
}
function readJsonFile(filePath) {
  if (!fs42.existsSync(filePath)) return {};
  const raw = fs42.readFileSync(filePath, "utf-8").trim();
  if (!raw) return {};
  return JSON.parse(raw);
}
function setNestedKey2(obj, keyPath, value) {
  const keys = keyPath.split(".");
  let current = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (typeof current[key] !== "object" || current[key] === null) {
      current[key] = {};
    }
    current = current[key];
  }
  current[keys[keys.length - 1]] = value;
}
function readNestedKey(obj, keyPath) {
  let current = obj;
  for (const key of keyPath.split(".")) {
    if (typeof current !== "object" || current === null || !(key in current)) {
      return void 0;
    }
    current = current[key];
  }
  return current;
}
function verifyGeminiConfig(config, configPath, ctx) {
  const checks = [];
  const entry = readNestedKey(config, GEMINI_SELECTOR);
  checks.push({
    name: "Gemini config exists",
    passed: fs42.existsSync(configPath),
    message: fs42.existsSync(configPath) ? void 0 : `${configPath} not found`
  });
  checks.push({
    name: "tap entry present",
    passed: !!entry,
    message: entry ? void 0 : `${GEMINI_SELECTOR} not found`
  });
  checks.push({
    name: "Comms directory exists",
    passed: fs42.existsSync(ctx.commsDir),
    message: fs42.existsSync(ctx.commsDir) ? void 0 : `${ctx.commsDir} not found`
  });
  if (entry?.env && typeof entry.env === "object") {
    checks.push({
      name: "TAP_COMMS_DIR configured",
      passed: entry.env.TAP_COMMS_DIR === ctx.commsDir.replace(/\\/g, "/"),
      message: `Expected ${ctx.commsDir.replace(/\\/g, "/")}`
    });
  }
  return checks;
}
var GEMINI_SELECTOR, OLD_GEMINI_SELECTOR, geminiAdapter;
var init_gemini = __esm({
  "src/adapters/gemini.ts"() {
    "use strict";
    init_state();
    init_artifact_backups();
    init_common();
    GEMINI_SELECTOR = "mcpServers.tap";
    OLD_GEMINI_SELECTOR = "mcpServers.tap-comms";
    geminiAdapter = {
      runtime: "gemini",
      async probe(ctx) {
        const warnings = [];
        const issues = [];
        const configPath = chooseGeminiConfigPath(ctx);
        const configExists = fs42.existsSync(configPath);
        const runtimeProbe = probeCommand(
          ctx.platform === "win32" ? ["gemini", "gemini.cmd"] : ["gemini"]
        );
        if (!runtimeProbe.command) {
          warnings.push(
            "Gemini CLI not found in PATH. Config can still be written, but runtime verification will be limited."
          );
        }
        if (!fs42.existsSync(ctx.commsDir)) {
          issues.push(
            `Comms directory not found: ${ctx.commsDir}. Run "init" first.`
          );
        }
        const managed = buildManagedMcpServerSpec(ctx, ctx.instanceId);
        warnings.push(...managed.warnings);
        issues.push(...managed.issues);
        return {
          installed: true,
          configPath,
          configExists,
          runtimeCommand: runtimeProbe.command,
          version: runtimeProbe.version,
          canWrite: canWriteOrCreate(configPath),
          warnings,
          issues
        };
      },
      async plan(ctx, probe) {
        const configPath = probe.configPath ?? chooseGeminiConfigPath(ctx);
        const conflicts = [];
        const warnings = [];
        const operations = [];
        const ownedArtifacts = [
          { kind: "json-path", path: configPath, selector: GEMINI_SELECTOR }
        ];
        if (probe.configExists) {
          try {
            const config = readJsonFile(configPath);
            if (readNestedKey(config, GEMINI_SELECTOR) !== void 0) {
              conflicts.push(`Existing ${GEMINI_SELECTOR} entry will be updated.`);
            }
            if (readNestedKey(config, OLD_GEMINI_SELECTOR) !== void 0) {
              conflicts.push(
                `Legacy ${OLD_GEMINI_SELECTOR} entry will be migrated to ${GEMINI_SELECTOR}.`
              );
            }
          } catch {
            warnings.push(
              `${configPath} exists but is not valid JSON. It will be replaced.`
            );
          }
        }
        operations.push({
          type: probe.configExists ? "merge" : "set",
          path: configPath,
          key: GEMINI_SELECTOR
        });
        return {
          runtime: "gemini",
          operations,
          ownedArtifacts,
          backupDir: ensureBackupDir(ctx.stateDir, "gemini"),
          restartRequired: true,
          conflicts,
          warnings
        };
      },
      async apply(ctx, plan) {
        const configPath = plan.operations[0]?.path ?? chooseGeminiConfigPath(ctx);
        const warnings = [];
        const changedFiles = [];
        const managed = buildManagedMcpServerSpec(ctx, ctx.instanceId);
        warnings.push(...managed.warnings);
        if (managed.issues.length > 0 || !managed.command) {
          return {
            success: false,
            appliedOps: 0,
            backupCreated: false,
            lastAppliedHash: "",
            ownedArtifacts: [],
            changedFiles,
            restartRequired: false,
            warnings: [...managed.warnings, ...managed.issues]
          };
        }
        let config = {};
        let previousValue = void 0;
        if (fs42.existsSync(configPath)) {
          if (fs42.readFileSync(configPath, "utf-8").trim()) {
            backupFile(configPath, plan.backupDir);
          }
          try {
            config = readJsonFile(configPath);
          } catch {
            warnings.push(
              `${configPath} was invalid JSON. Created backup and starting fresh.`
            );
            config = {};
          }
          previousValue = readNestedKey(config, GEMINI_SELECTOR);
        }
        const artifact = plan.ownedArtifacts[0];
        const backupPath = artifactBackupPath(
          plan.backupDir,
          artifact.kind,
          artifact.selector
        );
        writeArtifactBackup(backupPath, {
          kind: "json-path",
          selector: artifact.selector,
          existed: previousValue !== void 0,
          value: previousValue
        });
        const oldValue = readNestedKey(config, OLD_GEMINI_SELECTOR);
        if (oldValue !== void 0) {
          const servers = config.mcpServers;
          if (servers) {
            delete servers["tap-comms"];
          }
        }
        setNestedKey2(config, GEMINI_SELECTOR, {
          command: managed.command,
          args: managed.args,
          env: managed.env
        });
        fs42.mkdirSync(path39.dirname(configPath), { recursive: true });
        const tmp = `${configPath}.tmp.${process.pid}`;
        fs42.writeFileSync(tmp, JSON.stringify(config, null, 2) + "\n", "utf-8");
        fs42.renameSync(tmp, configPath);
        changedFiles.push(configPath);
        return {
          success: true,
          appliedOps: plan.operations.length,
          backupCreated: true,
          lastAppliedHash: fileHash(configPath),
          ownedArtifacts: [{ ...artifact, backupPath }],
          changedFiles,
          restartRequired: true,
          warnings
        };
      },
      async verify(ctx, plan) {
        const warnings = [];
        const configPath = plan.operations[0]?.path ?? chooseGeminiConfigPath(ctx);
        const runtimeProbe = probeCommand(
          ctx.platform === "win32" ? ["gemini", "gemini.cmd"] : ["gemini"]
        );
        let checks;
        try {
          const config = readJsonFile(configPath);
          checks = verifyGeminiConfig(config, configPath, ctx);
        } catch {
          checks = [
            {
              name: "Gemini config is valid JSON",
              passed: false,
              message: "Parse error"
            }
          ];
        }
        checks.push({
          name: "Gemini CLI found",
          passed: !!runtimeProbe.command,
          message: runtimeProbe.command ? void 0 : "gemini not in PATH (non-blocking)"
        });
        if (!runtimeProbe.command) {
          warnings.push(
            "Gemini CLI not in PATH. Config is written, but runtime verification is partial."
          );
        }
        return {
          ok: checks.filter((check) => check.name !== "Gemini CLI found").every((check) => check.passed),
          checks,
          restartRequired: true,
          warnings
        };
      },
      bridgeMode() {
        return "polling";
      }
    };
  }
});

// src/adapters/index.ts
function getAdapter(runtime) {
  const adapter = adapters[runtime];
  if (!adapter) {
    throw new Error(
      `Adapter for "${runtime}" is not yet available. Supported: ${Object.keys(adapters).join(", ")}`
    );
  }
  return adapter;
}
var adapters;
var init_adapters = __esm({
  "src/adapters/index.ts"() {
    "use strict";
    init_claude();
    init_codex();
    init_gemini();
    adapters = {
      claude: claudeAdapter,
      codex: codexAdapter,
      gemini: geminiAdapter
    };
  }
});

// src/config/comms-path-drift.ts
import * as fs43 from "fs";
import * as path40 from "path";
function normalize2(p) {
  return path40.resolve(p).replace(/\\/g, "/");
}
function tryJsonRead(filePath) {
  if (!fs43.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs43.readFileSync(filePath, "utf-8"));
  } catch {
    return null;
  }
}
function tryTomlMcpTapEnvValue(filePath, envKey) {
  if (!fs43.existsSync(filePath)) return null;
  try {
    const raw = fs43.readFileSync(filePath, "utf-8");
    const table = extractTomlTable(raw, "mcp_servers.tap.env");
    if (!table) return null;
    const assigns = parseTomlAssignments(table);
    const value = assigns[envKey];
    return typeof value === "string" ? value : null;
  } catch {
    return null;
  }
}
function readMcpJson(repoRoot) {
  const filePath = path40.join(repoRoot, ".mcp.json");
  const json = tryJsonRead(filePath);
  const raw = json?.mcpServers?.tap?.env?.TAP_COMMS_DIR ?? null;
  return {
    name: "mcp.json",
    filePath,
    key: "mcpServers.tap.env.TAP_COMMS_DIR",
    present: fs43.existsSync(filePath),
    raw,
    resolved: raw ? normalize2(path40.resolve(repoRoot, raw)) : null
  };
}
function readCodexConfigToml(repoRoot) {
  const filePath = getCodexConfigPath();
  const raw = tryTomlMcpTapEnvValue(filePath, "TAP_COMMS_DIR");
  return {
    name: "codex-config.toml",
    filePath,
    key: "[mcp_servers.tap.env] TAP_COMMS_DIR",
    present: fs43.existsSync(filePath),
    raw,
    resolved: raw ? normalize2(path40.resolve(repoRoot, raw)) : null
  };
}
function readTapConfigJson(repoRoot) {
  const filePath = path40.join(repoRoot, "tap-config.json");
  const json = tryJsonRead(filePath);
  const raw = json?.commsDir ?? null;
  return {
    name: "tap-config.json",
    filePath,
    key: "commsDir",
    present: fs43.existsSync(filePath),
    raw,
    resolved: raw ? normalize2(path40.resolve(repoRoot, raw)) : null
  };
}
function readStateJson(repoRoot, stateDir) {
  const filePath = path40.join(stateDir, "state.json");
  const json = tryJsonRead(filePath);
  const raw = json?.commsDir ?? null;
  return {
    name: "state.json",
    filePath,
    key: "commsDir",
    present: fs43.existsSync(filePath),
    raw,
    resolved: raw ? normalize2(path40.resolve(repoRoot, raw)) : null
  };
}
function detectCommsPathDrift(repoRoot, stateDir = path40.join(repoRoot, ".tap-comms")) {
  const sources = [
    readMcpJson(repoRoot),
    readCodexConfigToml(repoRoot),
    readTapConfigJson(repoRoot),
    readStateJson(repoRoot, stateDir)
  ];
  const resolvedValues = sources.map((s) => s.resolved).filter((v) => v !== null);
  if (resolvedValues.length === 0) {
    return {
      status: "empty",
      sources,
      effective: null,
      mismatches: [],
      hint: "No commsDir found in any source. Set TAP_COMMS_DIR in .mcp.json or commsDir in tap-config.json."
    };
  }
  const unique4 = Array.from(new Set(resolvedValues));
  if (unique4.length === 1) {
    return {
      status: "ok",
      sources,
      effective: unique4[0],
      mismatches: [],
      hint: null
    };
  }
  const votes = /* @__PURE__ */ new Map();
  for (const v of resolvedValues) {
    votes.set(v, (votes.get(v) ?? 0) + 1);
  }
  let effective = resolvedValues[0];
  let bestVotes = 0;
  for (const [value, count] of votes) {
    if (count > bestVotes) {
      bestVotes = count;
      effective = value;
    }
  }
  const mismatches = [];
  for (const source of sources) {
    if (source.resolved && source.resolved !== effective) {
      mismatches.push(
        `${source.name} (${source.key}) = ${source.resolved} (raw: ${source.raw})`
      );
    } else if (!source.resolved && source.present) {
      mismatches.push(`${source.name} exists but has no ${source.key}`);
    } else if (!source.present) {
      mismatches.push(`${source.name} missing at ${source.filePath}`);
    }
  }
  return {
    status: "drifted",
    sources,
    effective,
    mismatches,
    hint: "Pick the intended canonical path, then align all four slots. See docs/areas/tap/comms-path-drift-runbook.md for migration steps."
  };
}
function formatCommsPathDriftSummary(result) {
  if (result.status === "ok") {
    return `commsDir OK (all 4 slots agree on ${result.effective})`;
  }
  if (result.status === "empty") {
    return "commsDir not set in any slot \u2014 runtime falls back to <repoRoot>/tap-comms (deprecated default)";
  }
  const n = result.mismatches.length;
  return `commsDir drifted (${n} slot${n === 1 ? "" : "s"} disagree, effective=${result.effective})`;
}
var init_comms_path_drift = __esm({
  "src/config/comms-path-drift.ts"() {
    "use strict";
    init_common();
    init_toml();
  }
});

// src/commands/bridge-helpers.ts
import * as path41 from "path";
function formatAge(seconds) {
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor(seconds % 3600 / 60)}m ago`;
}
function formatAppServerState(appServer) {
  const ownership = appServer.managed ? "managed" : "external";
  const pid = appServer.pid != null ? ` pid:${appServer.pid}` : "";
  const health = appServer.healthy ? "healthy" : "unhealthy";
  const auth = appServer.auth != null ? `, auth gateway:${appServer.auth.gatewayPid ?? "-"} -> ${appServer.auth.upstreamUrl}` : "";
  return `${health}, ${ownership}${pid}, ${appServer.url}${auth}`;
}
function redactProtectedUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.searchParams.has("tap_token")) {
      parsed.searchParams.delete("tap_token");
    }
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return url.replace(/[?&]tap_token=[^&]+/g, "");
  }
}
function resolveTuiConnectUrl(appServer) {
  return appServer.auth?.upstreamUrl ?? appServer.url;
}
function quoteCliArg(value) {
  return `"${value.replace(/"/g, '\\"')}"`;
}
function quoteShellEnvValue(value) {
  if (process.platform === "win32") {
    return `'${value.replace(/'/g, "''")}'`;
  }
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
function formatCodexTuiAttachCommand(tuiConnectUrl, cwd, env = {}) {
  const base = `codex --enable tui_app_server --remote ${quoteCliArg(tuiConnectUrl)} --cd ${quoteCliArg(cwd)}`;
  const entries = Object.entries(env).filter(([, value]) => value.length > 0);
  if (entries.length === 0) {
    return base;
  }
  if (process.platform === "win32") {
    const envPrefix2 = entries.map(([key, value]) => `$env:${key} = ${quoteShellEnvValue(value)}`).join("; ");
    return `${envPrefix2}; ${base}`;
  }
  const envPrefix = entries.map(([key, value]) => `${key}=${quoteShellEnvValue(value)}`).join(" ");
  return `${envPrefix} ${base}`;
}
function resolveTuiAttachCwd(repoRoot, stateRepoRoot, runtimeThreadCwd, savedThreadCwd) {
  return runtimeThreadCwd ?? savedThreadCwd ?? stateRepoRoot ?? repoRoot;
}
function loadCurrentBridgeState(stateDir, instanceId, fallback) {
  return loadBridgeState(stateDir, instanceId) ?? fallback ?? null;
}
function formatThreadSummary(threadId, cwd) {
  if (!threadId) {
    return "-";
  }
  return cwd ? `${threadId} (${cwd})` : threadId;
}
function normalizeComparablePath3(value) {
  return path41.resolve(value).replace(/\\/g, "/").toLowerCase();
}
function sameOptionalPath(left, right) {
  if (!left || !right) {
    return left === right;
  }
  return normalizeComparablePath3(left) === normalizeComparablePath3(right);
}
function resolveRecoveredAgentName(instanceId, explicitAgentName, repoRoot, stateDir) {
  return resolveAgentName(instanceId, explicitAgentName, { repoRoot, stateDir }) ?? void 0;
}
function formatLifecycleTransition(lifecycle) {
  if (!lifecycle?.lastTransitionAt) {
    return null;
  }
  const reason = lifecycle.lastTransitionReason ? ` (${lifecycle.lastTransitionReason})` : "";
  return `${lifecycle.lastTransitionAt}${reason}, restarts=${lifecycle.restartCount}`;
}
function getSharedAppServerUsers(state, stateDir, currentInstanceId, appServerUrl) {
  const shared = [];
  for (const [id, inst] of Object.entries(state.instances)) {
    if (id === currentInstanceId || !inst?.installed) {
      continue;
    }
    const instanceId = id;
    if (getBridgeStatus(stateDir, instanceId) !== "running") {
      continue;
    }
    const bridgeState = loadCurrentBridgeState(
      stateDir,
      instanceId,
      inst.bridge
    );
    if (bridgeState?.appServer?.url === appServerUrl) {
      shared.push(instanceId);
    }
  }
  return shared;
}
function transferManagedAppServerOwnership(state, stateDir, recipientId, appServer) {
  const recipient = state.instances[recipientId];
  if (!recipient) {
    return false;
  }
  const bridgeState = loadCurrentBridgeState(
    stateDir,
    recipientId,
    recipient.bridge
  );
  if (!bridgeState) {
    return false;
  }
  const transferredAppServer = {
    ...appServer,
    managed: true,
    healthy: true,
    lastCheckedAt: (/* @__PURE__ */ new Date()).toISOString(),
    lastHealthyAt: appServer.lastHealthyAt ?? (/* @__PURE__ */ new Date()).toISOString()
  };
  const updatedBridge = {
    ...bridgeState,
    appServer: transferredAppServer
  };
  saveBridgeState(stateDir, recipientId, updatedBridge);
  state.instances[recipientId] = {
    ...recipient,
    bridge: updatedBridge,
    managedAppServer: transferredAppServer
  };
  return true;
}
var init_bridge_helpers = __esm({
  "src/commands/bridge-helpers.ts"() {
    "use strict";
    init_bridge();
  }
});

// src/commands/bridge-heartbeat.ts
import {
  existsSync as existsSync37,
  readFileSync as readFileSync30,
  renameSync as renameSync14,
  statSync as statSync11,
  unlinkSync as unlinkSync10,
  writeFileSync as writeFileSync20
} from "fs";
import * as path42 from "path";
function acquireHeartbeatLock(commsDir, retries = 3, delayMs = 100) {
  const lockPath = path42.join(commsDir, ".heartbeats.lock");
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      writeFileSync20(lockPath, String(process.pid), { flag: "wx" });
      return true;
    } catch {
      try {
        const age = Date.now() - statSync11(lockPath).mtimeMs;
        if (age > 1e4) {
          unlinkSync10(lockPath);
          continue;
        }
      } catch {
      }
      if (attempt < retries - 1) {
        busySpin(delayMs);
      }
    }
  }
  return false;
}
function releaseHeartbeatLock(commsDir) {
  try {
    unlinkSync10(path42.join(commsDir, ".heartbeats.lock"));
  } catch {
  }
}
function isEbusyError(error) {
  if (!error || typeof error !== "object" || !("code" in error)) return false;
  const code = error.code;
  return code === "EBUSY" || code === "EPERM" || code === "EACCES";
}
function busySpin(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
  }
}
function resilientRename(tmpPath, targetPath) {
  for (let attempt = 0; attempt < EBUSY_MAX_RETRIES; attempt++) {
    try {
      renameSync14(tmpPath, targetPath);
      return;
    } catch (error) {
      if (!isEbusyError(error) || attempt === EBUSY_MAX_RETRIES - 1) throw error;
      busySpin(EBUSY_BASE_DELAY_MS * (attempt + 1));
    }
  }
}
function resilientReadJson(filePath, fallback) {
  for (let attempt = 0; attempt < EBUSY_MAX_RETRIES; attempt++) {
    try {
      return JSON.parse(readFileSync30(filePath, "utf-8"));
    } catch (error) {
      if (!isEbusyError(error) || attempt === EBUSY_MAX_RETRIES - 1) {
        return fallback;
      }
      busySpin(EBUSY_BASE_DELAY_MS * (attempt + 1));
    }
  }
  return fallback;
}
function loadBridgeHeartbeatStore(commsDir) {
  const heartbeatsPath = path42.join(commsDir, "heartbeats.json");
  if (!existsSync37(heartbeatsPath)) return {};
  const result = resilientReadJson(
    heartbeatsPath,
    null
  );
  return result;
}
function saveBridgeHeartbeatStore(commsDir, store) {
  const heartbeatsPath = path42.join(commsDir, "heartbeats.json");
  const tmp = `${heartbeatsPath}.tmp.${process.pid}`;
  writeFileSync20(tmp, JSON.stringify(store, null, 2), "utf-8");
  resilientRename(tmp, heartbeatsPath);
}
function parseBridgeHeartbeatAgeMs(record, now) {
  const raw = record.lastActivity ?? record.timestamp;
  if (!raw) return Number.POSITIVE_INFINITY;
  const parsed = new Date(raw).getTime();
  if (!Number.isFinite(parsed)) return Number.POSITIVE_INFINITY;
  return Math.max(0, now - parsed);
}
function resolveBridgeHeartbeatInstanceId(state, heartbeatId) {
  if (state.instances[heartbeatId]) return heartbeatId;
  const hyphenated = heartbeatId.replace(/_/g, "-");
  if (state.instances[hyphenated]) return hyphenated;
  const underscored = heartbeatId.replace(/-/g, "_");
  if (state.instances[underscored]) return underscored;
  return null;
}
function pruneStaleHeartbeatsForBridgeUp(state, stateDir, commsDir) {
  if (!acquireHeartbeatLock(commsDir)) {
    return {
      removed: 0,
      warning: "Auto-clean skipped \u2014 heartbeat lock busy"
    };
  }
  try {
    const store = loadBridgeHeartbeatStore(commsDir);
    if (store === null) {
      return {
        removed: 0,
        warning: "Auto-clean skipped \u2014 heartbeats.json unreadable"
      };
    }
    const now = Date.now();
    let removed = 0;
    for (const [heartbeatId, heartbeat] of Object.entries(store)) {
      const ageMs = parseBridgeHeartbeatAgeMs(heartbeat, now);
      const instanceId = resolveBridgeHeartbeatInstanceId(state, heartbeatId);
      const instance = instanceId ? state.instances[instanceId] : null;
      const bridgeBacked = instance?.bridgeMode === "app-server";
      const bridgeRunning = bridgeBacked && instanceId ? getBridgeStatus(stateDir, instanceId) === "running" : false;
      const status = heartbeat.status ?? "active";
      const staleByStatus = status === "signing-off" && ageMs >= BRIDGE_UP_SIGNING_OFF_HEARTBEAT_WINDOW_MS;
      const staleByDeadBridge = bridgeBacked && !bridgeRunning && ageMs >= BRIDGE_UP_ACTIVE_HEARTBEAT_WINDOW_MS;
      const staleByAge = !bridgeRunning && ageMs >= BRIDGE_UP_ORPHAN_HEARTBEAT_WINDOW_MS;
      if (staleByStatus || staleByDeadBridge || staleByAge) {
        delete store[heartbeatId];
        try {
          const sanitizedId = heartbeatId.replace(/[/\\:]/g, "_");
          const presencePath = path42.join(commsDir, "presence", `${sanitizedId}.json`);
          if (existsSync37(presencePath)) unlinkSync10(presencePath);
        } catch {
        }
        removed += 1;
      }
    }
    if (removed > 0) {
      saveBridgeHeartbeatStore(commsDir, store);
    }
    return { removed };
  } finally {
    releaseHeartbeatLock(commsDir);
  }
}
var EBUSY_MAX_RETRIES, EBUSY_BASE_DELAY_MS, BRIDGE_UP_ACTIVE_HEARTBEAT_WINDOW_MS, BRIDGE_UP_ORPHAN_HEARTBEAT_WINDOW_MS, BRIDGE_UP_SIGNING_OFF_HEARTBEAT_WINDOW_MS;
var init_bridge_heartbeat = __esm({
  "src/commands/bridge-heartbeat.ts"() {
    "use strict";
    init_bridge();
    EBUSY_MAX_RETRIES = 4;
    EBUSY_BASE_DELAY_MS = 25;
    BRIDGE_UP_ACTIVE_HEARTBEAT_WINDOW_MS = 10 * 60 * 1e3;
    BRIDGE_UP_ORPHAN_HEARTBEAT_WINDOW_MS = 24 * 60 * 60 * 1e3;
    BRIDGE_UP_SIGNING_OFF_HEARTBEAT_WINDOW_MS = 5 * 60 * 1e3;
  }
});

// src/commands/bridge-start.ts
import * as path43 from "path";
import { randomBytes as randomBytes4 } from "crypto";
function resolveInstanceIdSuffix(flagValue, env) {
  if (typeof flagValue === "string") {
    const trimmed = flagValue.trim();
    if (!trimmed) {
      return { ok: true, suffix: randomBytes4(3).toString("hex") };
    }
    if (!INSTANCE_ID_SUFFIX_PATTERN.test(trimmed)) {
      return {
        ok: false,
        message: `Invalid --instance-id-suffix: ${trimmed}. Must match /^[a-z0-9]{4,16}$/`
      };
    }
    return { ok: true, suffix: trimmed };
  }
  if (flagValue === true) {
    return { ok: true, suffix: randomBytes4(3).toString("hex") };
  }
  const envFlag = env.TAP_INSTANCE_ID_AUTO_SUFFIX?.trim().toLowerCase();
  if (envFlag === "1" || envFlag === "true") {
    return { ok: true, suffix: randomBytes4(3).toString("hex") };
  }
  return { ok: true, suffix: void 0 };
}
function resolveLauncherInstanceOverrides(args) {
  const suffixResolution = resolveInstanceIdSuffix(
    args.flags["instance-id-suffix"],
    args.env
  );
  if (!suffixResolution.ok) return suffixResolution;
  const instanceIdSuffix = suffixResolution.suffix;
  const explicitRoutingSlot = typeof args.flags["routing-slot"] === "string" ? args.flags["routing-slot"] : void 0;
  let routingSlot = explicitRoutingSlot;
  if (instanceIdSuffix && !routingSlot) {
    const derived = resolveBridgeRoutingSlot(args.repoRoot, {
      ...args.env,
      TAP_INSTANCE_ID: args.baseInstanceId,
      TAP_BRIDGE_INSTANCE_ID: args.baseInstanceId
    }) ?? void 0;
    if (derived) routingSlot = derived;
  }
  const logs = [];
  if (instanceIdSuffix) {
    logs.push(
      `Instance suffix: ${instanceIdSuffix} (TAP_INSTANCE_ID=${args.baseInstanceId}-${instanceIdSuffix})`
    );
    if (routingSlot) {
      logs.push(`Routing slot:    ${routingSlot} (preserved from base id)`);
    }
  }
  return { ok: true, instanceIdSuffix, routingSlot, logs };
}
async function bridgeStart(identifier, agentName, flags = {}) {
  const repoRoot = findRepoRoot();
  let state = loadState(repoRoot);
  if (!state) {
    return {
      ok: false,
      command: "bridge",
      code: "TAP_NOT_INITIALIZED",
      message: "Not initialized. Run: npx @hua-labs/tap init",
      warnings: [],
      data: {}
    };
  }
  const resolved = resolveInstanceId(identifier, state);
  if (!resolved.ok) {
    return {
      ok: false,
      command: "bridge",
      code: resolved.code,
      message: resolved.message,
      warnings: [],
      data: {}
    };
  }
  const instanceId = resolved.instanceId;
  let instance = state.instances[instanceId];
  if (!instance?.installed) {
    return {
      ok: false,
      command: "bridge",
      instanceId,
      runtime: instance?.runtime,
      code: "TAP_INSTANCE_NOT_FOUND",
      message: `${instanceId} is not installed. Run: npx @hua-labs/tap add ${instance?.runtime ?? identifier}`,
      warnings: [],
      data: {}
    };
  }
  const adapter = getAdapter(instance.runtime);
  const mode = adapter.bridgeMode();
  const ctx = createAdapterContext(state.commsDir, repoRoot);
  if (instance.runtime === "codex") {
    const patched = patchCodexApprovalMode();
    if (patched) {
      log(`patched approval_mode \u2192 auto in ${patched}`);
      const instConfig = loadInstanceConfig(ctx.stateDir, instanceId);
      if (instConfig) {
        instConfig.runtimeConfigHash = fileHash(patched);
        instConfig.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
        saveInstanceConfig(ctx.stateDir, instConfig);
      }
    }
  }
  if (mode !== "app-server") {
    return {
      ok: true,
      command: "bridge",
      instanceId,
      runtime: instance.runtime,
      code: "TAP_NO_OP",
      message: `${instanceId} uses ${mode} mode \u2014 no bridge needed.`,
      warnings: [],
      data: { bridgeMode: mode }
    };
  }
  const resolvedAgentName = resolveRecoveredAgentName(
    instanceId,
    agentName,
    repoRoot,
    ctx.stateDir
  );
  const currentName = instance.defaultAgentName;
  if ((resolvedAgentName ?? null) !== currentName) {
    instance = {
      ...instance,
      defaultAgentName: resolvedAgentName ?? null
    };
    const updatedState = updateInstanceState(state, instanceId, instance);
    saveState(repoRoot, updatedState);
    state = updatedState;
  }
  const bridgeScript = adapter.resolveBridgeScript?.(ctx);
  if (!bridgeScript) {
    return {
      ok: false,
      command: "bridge",
      instanceId,
      runtime: instance.runtime,
      code: "TAP_BRIDGE_SCRIPT_MISSING",
      message: `Bridge script not found for ${instanceId}. Ensure the runtime is properly configured.`,
      warnings: [],
      data: {}
    };
  }
  const { config: resolvedConfig } = resolveConfig({}, repoRoot);
  const runtimeCommand = resolvedConfig.runtimeCommand;
  if (flags["unsandboxed"] === true && (instance.runtime !== "codex" || flags["no-server"] === true)) {
    return {
      ok: false,
      command: "bridge",
      instanceId,
      runtime: instance.runtime,
      code: "TAP_INVALID_ARGUMENT",
      message: "--unsandboxed requires a managed Codex app-server (omit --no-server)",
      warnings: [],
      data: {}
    };
  }
  const currentBridgeState = loadBridgeState(ctx.stateDir, instanceId);
  const { manageAppServer, noAuth, appServerUnsandboxed } = inferRestartMode(
    currentBridgeState,
    {
      noServer: flags["no-server"] === true ? true : void 0,
      noAuth: flags["no-auth"] === true ? true : void 0,
      unsandboxed: flags["unsandboxed"] === true ? true : void 0
    },
    {
      manageAppServer: instance.manageAppServer,
      noAuth: instance.noAuth,
      appServerUnsandboxed: instance.appServerUnsandboxed
    }
  );
  let effectivePort = instance.port;
  if (effectivePort == null && manageAppServer) {
    effectivePort = await findNextAvailableAppServerPort(
      state,
      resolvedConfig.appServerUrl,
      4501,
      instanceId
    );
    instance = { ...instance, port: effectivePort };
    const updatedState = updateInstanceState(state, instanceId, instance);
    saveState(repoRoot, updatedState);
    state = updatedState;
  }
  const appServerUrl = resolveAppServerUrl(
    resolvedConfig.appServerUrl,
    effectivePort ?? void 0
  );
  logHeader(`@hua-labs/tap bridge start ${instanceId}`);
  log(`Bridge script: ${bridgeScript}`);
  log(`Bridge mode:   ${mode}`);
  log(`Runtime cmd:   ${runtimeCommand}`);
  log(`App server:    ${appServerUrl}`);
  if (effectivePort != null) log(`Port:          ${effectivePort}`);
  if (resolvedAgentName) log(`Agent name:    ${resolvedAgentName}`);
  const pathDrift = detectCommsPathDrift(repoRoot, ctx.stateDir);
  if (pathDrift.status === "drifted") {
    logWarn(formatCommsPathDriftSummary(pathDrift));
    for (const mismatch of pathDrift.mismatches) {
      logWarn(`  ${mismatch}`);
    }
    logWarn(
      "  Run `tap bridge doctor` or see docs/areas/tap/comms-path-drift-runbook.md"
    );
  } else if (pathDrift.status === "empty") {
    logWarn(formatCommsPathDriftSummary(pathDrift));
  }
  if (!manageAppServer && instance.runtime === "codex") {
    log("Auto server:   disabled (--no-server)");
  }
  if (noAuth && manageAppServer) {
    log("Auth gateway:  disabled (--no-auth)");
  }
  if (appServerUnsandboxed && manageAppServer && instance.runtime === "codex") {
    log("Sandbox:       bypassed (--dangerously-bypass-approvals-and-sandbox)");
  }
  const willBeHeadless = flags["headless"] === true || instance.headless?.enabled;
  if (willBeHeadless) {
    const role = (typeof flags["role"] === "string" ? flags["role"] : null) ?? instance.headless?.role ?? "reviewer";
    log(`Headless:      ${role}`);
  }
  try {
    if (!manageAppServer && instance.runtime === "codex") {
      log("Checking app-server health...");
      const healthy = await checkAppServerHealth(appServerUrl);
      if (healthy) {
        logSuccess("App server reachable");
      } else {
        logError(`App server not reachable at ${appServerUrl}`);
        return {
          ok: false,
          command: "bridge",
          instanceId,
          runtime: instance.runtime,
          code: "TAP_BRIDGE_START_FAILED",
          message: `App server not reachable at ${appServerUrl}. Start it first: codex app-server --listen ${appServerUrl}`,
          warnings: [],
          data: {}
        };
      }
    }
    const busyModeRaw = flags["busy-mode"];
    if (busyModeRaw !== void 0 && busyModeRaw !== "steer" && busyModeRaw !== "wait") {
      return {
        ok: false,
        command: "bridge",
        instanceId,
        runtime: instance.runtime,
        code: "TAP_INVALID_ARGUMENT",
        message: `Invalid --busy-mode: ${String(busyModeRaw)}. Must be "steer" or "wait".`,
        warnings: [],
        data: {}
      };
    }
    const busyMode = busyModeRaw;
    const pollSecondsRaw = typeof flags["poll-seconds"] === "string" ? flags["poll-seconds"] : void 0;
    const reconnectSecondsRaw = typeof flags["reconnect-seconds"] === "string" ? flags["reconnect-seconds"] : void 0;
    const lookbackRaw = typeof flags["message-lookback-minutes"] === "string" ? flags["message-lookback-minutes"] : void 0;
    let pollSeconds;
    let reconnectSeconds;
    let messageLookbackMinutes;
    try {
      pollSeconds = parseIntFlag(pollSecondsRaw, "--poll-seconds", 1, 3600);
      reconnectSeconds = parseIntFlag(
        reconnectSecondsRaw,
        "--reconnect-seconds",
        1,
        3600
      );
      messageLookbackMinutes = parseIntFlag(
        lookbackRaw,
        "--message-lookback-minutes",
        1,
        10080
      );
    } catch (err) {
      return {
        ok: false,
        command: "bridge",
        instanceId,
        runtime: instance.runtime,
        code: "TAP_INVALID_ARGUMENT",
        message: err instanceof Error ? err.message : String(err),
        warnings: [],
        data: {}
      };
    }
    const threadId = typeof flags["thread-id"] === "string" ? flags["thread-id"] : void 0;
    const ephemeral = flags["ephemeral"] === true;
    const processExistingMessages = flags["process-existing-messages"] === true;
    const headlessFlag = flags["headless"] === true;
    const roleArg = typeof flags["role"] === "string" ? flags["role"] : void 0;
    const validRoles = ["reviewer", "validator", "long-running"];
    if (roleArg && !validRoles.includes(roleArg)) {
      return {
        ok: false,
        command: "bridge",
        instanceId,
        runtime: instance.runtime,
        code: "TAP_INVALID_ARGUMENT",
        message: `Invalid --role: ${roleArg}. Must be: ${validRoles.join(", ")}`,
        warnings: [],
        data: {}
      };
    }
    const headless = headlessFlag ? {
      enabled: true,
      role: roleArg ?? "reviewer",
      maxRounds: 5,
      qualitySeverityFloor: "high"
    } : instance.headless;
    const launcher = resolveLauncherInstanceOverrides({
      flags,
      env: process.env,
      repoRoot,
      baseInstanceId: instanceId
    });
    if (!launcher.ok) {
      return {
        ok: false,
        command: "bridge",
        instanceId,
        runtime: instance.runtime,
        code: "TAP_INVALID_ARGUMENT",
        message: launcher.message,
        warnings: [],
        data: {}
      };
    }
    const { instanceIdSuffix, routingSlot } = launcher;
    for (const line of launcher.logs) log(line);
    const previousWarmup = process.env.TAP_COLD_START_WARMUP;
    process.env.TAP_COLD_START_WARMUP = "true";
    let bridge;
    try {
      bridge = await startBridge({
        instanceId,
        runtime: instance.runtime,
        stateDir: ctx.stateDir,
        commsDir: ctx.commsDir,
        bridgeScript,
        platform: ctx.platform,
        agentName: resolvedAgentName,
        runtimeCommand,
        appServerUrl,
        repoRoot,
        port: effectivePort ?? void 0,
        manageAppServer,
        noAuth,
        appServerUnsandboxed,
        existingAppServer: instance.managedAppServer ?? null,
        headless,
        busyMode,
        pollSeconds,
        reconnectSeconds,
        messageLookbackMinutes,
        threadId,
        ephemeral,
        processExistingMessages,
        previousLifecycle: instance.bridgeLifecycle ?? instance.bridge?.lifecycle ?? null,
        instanceIdSuffix,
        routingSlot
      });
    } finally {
      if (previousWarmup === void 0) {
        delete process.env.TAP_COLD_START_WARMUP;
      } else {
        process.env.TAP_COLD_START_WARMUP = previousWarmup;
      }
    }
    logSuccess(`Bridge started (PID: ${bridge.pid})`);
    log(`Log: ${logFilePath(ctx.stateDir, instanceId)}`);
    if (bridge.appServer) {
      log(`App server:   ${formatAppServerState(bridge.appServer)}`);
      if (bridge.appServer.logPath) {
        log(`Server log:   ${bridge.appServer.logPath}`);
      }
      if (bridge.appServer.auth) {
        log(
          `Protected:    ${redactProtectedUrl(bridge.appServer.auth.protectedUrl)}`
        );
        if (bridge.appServer.auth.gatewayLogPath) {
          log(`Gateway log:  ${bridge.appServer.auth.gatewayLogPath}`);
        }
        log(`TUI connect:  ${bridge.appServer.auth.upstreamUrl}`);
      }
      if (bridge.appServer.managed && !bridge.appServer.auth) {
        log(`TUI connect:  ${bridge.appServer.url}`);
      }
    }
    const updated = {
      ...instance,
      bridge,
      bridgeLifecycle: bridge.lifecycle ?? instance.bridgeLifecycle ?? null,
      manageAppServer,
      noAuth,
      appServerUnsandboxed,
      managedAppServer: bridge.appServer?.managed ? bridge.appServer : null
    };
    const newState = updateInstanceState(state, instanceId, updated);
    saveState(repoRoot, newState);
    return {
      ok: true,
      command: "bridge",
      instanceId,
      runtime: instance.runtime,
      code: "TAP_BRIDGE_START_OK",
      message: `Bridge for ${instanceId} started (PID: ${bridge.pid})`,
      warnings: [],
      data: { pid: bridge.pid, appServer: bridge.appServer ?? null }
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logError(msg);
    return {
      ok: false,
      command: "bridge",
      instanceId,
      runtime: instance.runtime,
      code: "TAP_BRIDGE_START_FAILED",
      message: msg,
      warnings: [],
      data: {}
    };
  }
}
async function bridgeStartAll(flags = {}) {
  const repoRoot = findRepoRoot();
  const state = loadState(repoRoot);
  if (!state) {
    return {
      ok: false,
      command: "bridge",
      code: "TAP_NOT_INITIALIZED",
      message: "Not initialized. Run: npx @hua-labs/tap init",
      warnings: [],
      data: {}
    };
  }
  const ctx = createAdapterContext(state.commsDir, repoRoot);
  const warnings = [];
  let prunedHeartbeats = 0;
  if (flags["auto-prune-heartbeats"] === true) {
    const cleanup = pruneStaleHeartbeatsForBridgeUp(
      state,
      ctx.stateDir,
      ctx.commsDir
    );
    prunedHeartbeats = cleanup.removed;
    if (cleanup.warning) {
      warnings.push(cleanup.warning);
      log(cleanup.warning);
    }
    if (prunedHeartbeats > 0) {
      log(
        `Auto-clean: pruned ${prunedHeartbeats} stale heartbeat entr${prunedHeartbeats === 1 ? "y" : "ies"}`
      );
    }
  }
  const instanceIds = Object.keys(state.instances);
  const appServerInstances = instanceIds.filter((id) => {
    const inst = state.instances[id];
    if (!inst?.installed) return false;
    const adapter = getAdapter(inst.runtime);
    return adapter.bridgeMode() === "app-server";
  });
  if (appServerInstances.length === 0) {
    const cleanupSuffix2 = prunedHeartbeats > 0 ? ` Auto-clean pruned ${prunedHeartbeats} stale heartbeat entr${prunedHeartbeats === 1 ? "y" : "ies"}.` : "";
    return {
      ok: true,
      command: "bridge",
      code: "TAP_NO_OP",
      message: `No app-server instances found to start.${cleanupSuffix2}`,
      warnings,
      data: { prunedHeartbeats }
    };
  }
  logHeader("@hua-labs/tap bridge start --all");
  log(
    `Found ${appServerInstances.length} app-server instance(s): ${appServerInstances.join(", ")}`
  );
  log("");
  const started = [];
  const failed = [];
  for (const instanceId of appServerInstances) {
    const inst = state.instances[instanceId];
    const storedName = resolveRecoveredAgentName(
      instanceId,
      inst?.defaultAgentName ?? void 0,
      repoRoot,
      ctx.stateDir
    );
    if (!storedName) {
      const msg = `${instanceId}: skipped \u2014 no stored agent-name. Set it first: tap bridge start ${instanceId} --agent-name <name>`;
      log(msg);
      warnings.push(msg);
      continue;
    }
    const stateDir = path43.join(repoRoot, ".tap-comms");
    const currentBridgeState = loadBridgeState(stateDir, instanceId);
    const { manageAppServer, noAuth, appServerUnsandboxed } = inferRestartMode(
      currentBridgeState,
      {
        noServer: flags["no-server"] === true ? true : void 0,
        noAuth: flags["no-auth"] === true ? true : void 0,
        unsandboxed: flags["unsandboxed"] === true ? true : void 0
      },
      {
        manageAppServer: inst.manageAppServer,
        noAuth: inst.noAuth,
        appServerUnsandboxed: inst.appServerUnsandboxed
      }
    );
    const mergedFlags = {
      ...flags,
      ...manageAppServer === false ? { "no-server": true } : {},
      ...noAuth === true ? { "no-auth": true } : {},
      ...appServerUnsandboxed === true ? { unsandboxed: true } : {}
    };
    log(`Starting ${instanceId} (agent: ${storedName})...`);
    const result = await bridgeStart(instanceId, storedName, mergedFlags);
    if (result.ok) {
      started.push(instanceId);
      logSuccess(`${instanceId} started`);
    } else {
      failed.push(instanceId);
      logError(`${instanceId}: ${result.message}`);
    }
    log("");
  }
  const message = started.length > 0 ? `Started ${started.length}/${appServerInstances.length} bridge(s): ${started.join(", ")}` + (failed.length > 0 ? `. Failed: ${failed.join(", ")}` : "") : `No bridges started. Failed: ${failed.join(", ")}`;
  const cleanupSuffix = prunedHeartbeats > 0 ? ` Auto-clean pruned ${prunedHeartbeats} stale heartbeat entr${prunedHeartbeats === 1 ? "y" : "ies"}.` : "";
  return {
    ok: failed.length === 0 && started.length > 0,
    command: "bridge",
    code: started.length > 0 ? "TAP_BRIDGE_START_OK" : "TAP_BRIDGE_START_FAILED",
    message: `${message}${cleanupSuffix}`,
    warnings,
    data: { started, failed, prunedHeartbeats }
  };
}
var INSTANCE_ID_SUFFIX_PATTERN;
var init_bridge_start = __esm({
  "src/commands/bridge-start.ts"() {
    "use strict";
    init_bridge_paths();
    init_codex_bridge_runner();
    init_state();
    init_instance_config();
    init_bridge();
    init_config();
    init_adapters();
    init_utils();
    init_comms_path_drift();
    init_bridge_helpers();
    init_bridge_heartbeat();
    init_codex();
    INSTANCE_ID_SUFFIX_PATTERN = /^[a-z0-9]{4,16}$/;
  }
});

// src/commands/bridge-stop.ts
function shouldKeepManagedServer(flags = {}) {
  return flags["keep-server"] === true || flags["bridge-only"] === true;
}
function retainManagedAppServer(appServer) {
  const now = (/* @__PURE__ */ new Date()).toISOString();
  return {
    ...appServer,
    managed: true,
    healthy: true,
    lastCheckedAt: now,
    lastHealthyAt: appServer.lastHealthyAt ?? now
  };
}
async function bridgeStopOne(identifier, flags = {}) {
  const repoRoot = findRepoRoot();
  const state = loadState(repoRoot);
  if (!state) {
    return {
      ok: false,
      command: "bridge",
      code: "TAP_NOT_INITIALIZED",
      message: "Not initialized. Run: npx @hua-labs/tap init",
      warnings: [],
      data: {}
    };
  }
  const resolved = resolveInstanceId(identifier, state);
  if (!resolved.ok) {
    return {
      ok: false,
      command: "bridge",
      code: resolved.code,
      message: resolved.message,
      warnings: [],
      data: {}
    };
  }
  const instanceId = resolved.instanceId;
  const ctx = createAdapterContext(state.commsDir, repoRoot);
  const instance = state.instances[instanceId];
  const bridgeState = loadCurrentBridgeState(
    ctx.stateDir,
    instanceId,
    instance?.bridge
  );
  const appServer = bridgeState?.appServer ?? null;
  const keepServer = shouldKeepManagedServer(flags);
  logHeader(`@hua-labs/tap bridge stop ${instanceId}`);
  const stopResult = await stopBridge({
    instanceId,
    stateDir: ctx.stateDir,
    platform: ctx.platform
  });
  let appServerStopped = false;
  let appServerTransferredTo = null;
  let retainedAppServer = null;
  if (stopResult.stopped) {
    logSuccess(`Bridge for ${instanceId} stopped`);
  } else {
    log(`No running bridge for ${instanceId}`);
  }
  if (appServer?.managed) {
    const sharedUsers = getSharedAppServerUsers(
      state,
      ctx.stateDir,
      instanceId,
      appServer.url
    );
    if (sharedUsers.length > 0) {
      const recipient = sharedUsers[0];
      if (transferManagedAppServerOwnership(
        state,
        ctx.stateDir,
        recipient,
        appServer
      )) {
        appServerTransferredTo = recipient;
        log(`Managed app-server ownership moved to ${recipient}`);
      } else {
        log(
          `Managed app-server left running at ${appServer.url} because ownership transfer failed`
        );
      }
    } else if (keepServer) {
      retainedAppServer = retainManagedAppServer(appServer);
      const gatewayNote = retainedAppServer.auth?.gatewayPid != null ? `, gateway PID: ${retainedAppServer.auth.gatewayPid}` : "";
      logSuccess(
        `Managed app-server kept running (PID: ${retainedAppServer.pid ?? "-"}${gatewayNote})`
      );
    } else {
      appServerStopped = await stopManagedAppServer(appServer, ctx.platform);
      if (appServerStopped) {
        const gatewayNote = appServer.auth?.gatewayPid != null ? `, gateway PID: ${appServer.auth.gatewayPid}` : "";
        logSuccess(
          `Managed app-server stopped (PID: ${appServer.pid ?? "-"}${gatewayNote})`
        );
        const released = await waitForPortRelease(appServer.url, 5e3);
        if (!released) {
          log(
            `Warning: port for ${appServer.url} still in use after stop \u2014 next start may need a different port`
          );
        }
      }
    }
  }
  if (instance) {
    const updated = {
      ...instance,
      bridge: null,
      bridgeLifecycle: stopResult.lifecycle ?? instance.bridgeLifecycle ?? null,
      managedAppServer: retainedAppServer
    };
    const newState = updateInstanceState(state, instanceId, updated);
    saveState(repoRoot, newState);
  }
  if (stopResult.stopped) {
    return {
      ok: true,
      command: "bridge",
      instanceId,
      code: "TAP_BRIDGE_STOP_OK",
      message: `Bridge for ${instanceId} stopped`,
      warnings: [],
      data: {
        appServerStopped,
        appServerTransferredTo,
        appServerKept: retainedAppServer != null
      }
    };
  }
  return {
    ok: true,
    command: "bridge",
    instanceId,
    code: "TAP_BRIDGE_NOT_RUNNING",
    message: `No running bridge for ${instanceId}`,
    warnings: [],
    data: {
      appServerStopped,
      appServerTransferredTo,
      appServerKept: retainedAppServer != null
    }
  };
}
async function bridgeStopAll(flags = {}) {
  const repoRoot = findRepoRoot();
  const state = loadState(repoRoot);
  if (!state) {
    return {
      ok: false,
      command: "bridge",
      code: "TAP_NOT_INITIALIZED",
      message: "Not initialized. Run: npx @hua-labs/tap init",
      warnings: [],
      data: {}
    };
  }
  const ctx = createAdapterContext(state.commsDir, repoRoot);
  const instanceIds = Object.keys(state.instances);
  const stopped = [];
  const managedAppServers = /* @__PURE__ */ new Map();
  const retainedAppServers = /* @__PURE__ */ new Map();
  const keepServer = shouldKeepManagedServer(flags);
  logHeader("@hua-labs/tap bridge stop (all)");
  let stateChanged = false;
  for (const instanceId of instanceIds) {
    const bridgeState = loadCurrentBridgeState(
      ctx.stateDir,
      instanceId,
      state.instances[instanceId]?.bridge
    );
    const appServer = bridgeState?.appServer;
    if (appServer?.managed) {
      if (keepServer) {
        retainedAppServers.set(instanceId, retainManagedAppServer(appServer));
      } else if (appServer.pid != null) {
        managedAppServers.set(
          `${appServer.url}:${appServer.pid}:${appServer.auth?.gatewayPid ?? "-"}`,
          appServer
        );
      }
    }
    const stopResult = await stopBridge({
      instanceId,
      stateDir: ctx.stateDir,
      platform: ctx.platform
    });
    if (stopResult.stopped) {
      logSuccess(`Stopped bridge for ${instanceId}`);
      stopped.push(instanceId);
    }
    const instance = state.instances[instanceId];
    if (instance?.bridge || stopResult.lifecycle) {
      state.instances[instanceId] = {
        ...instance,
        bridge: null,
        bridgeLifecycle: stopResult.lifecycle ?? instance.bridgeLifecycle ?? null,
        managedAppServer: retainedAppServers.get(instanceId) ?? null
      };
      stateChanged = true;
    }
  }
  const stoppedAppServers = [];
  const releasePorts = [];
  if (!keepServer) {
    for (const appServer of managedAppServers.values()) {
      if (await stopManagedAppServer(appServer, ctx.platform)) {
        stoppedAppServers.push(appServer.pid);
        releasePorts.push(appServer.url);
        const gatewayNote = appServer.auth?.gatewayPid != null ? `, gateway PID ${appServer.auth.gatewayPid}` : "";
        logSuccess(
          `Stopped app-server PID ${appServer.pid} (${appServer.url}${gatewayNote})`
        );
      }
    }
  } else {
    for (const [instanceId, appServer] of retainedAppServers) {
      const gatewayNote = appServer.auth?.gatewayPid != null ? `, gateway PID ${appServer.auth.gatewayPid}` : "";
      logSuccess(
        `Kept app-server for ${instanceId} running (PID ${appServer.pid ?? "-"}${gatewayNote})`
      );
    }
  }
  if (releasePorts.length > 0) {
    await Promise.all(
      releasePorts.map((url) => waitForPortRelease(url, 5e3))
    );
  }
  if (stateChanged) {
    state.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
    saveState(repoRoot, state);
  }
  const message = stopped.length > 0 ? `Stopped ${stopped.length} bridge(s): ${stopped.join(", ")}` : "No running bridges found";
  log(message);
  return {
    ok: true,
    command: "bridge",
    code: stopped.length > 0 ? "TAP_BRIDGE_STOP_OK" : "TAP_BRIDGE_NOT_RUNNING",
    message,
    warnings: [],
    data: {
      stopped,
      stoppedAppServers,
      keptAppServers: Array.from(retainedAppServers.keys())
    }
  };
}
var init_bridge_stop = __esm({
  "src/commands/bridge-stop.ts"() {
    "use strict";
    init_state();
    init_bridge();
    init_utils();
    init_bridge_helpers();
  }
});

// src/commands/bridge-watch.ts
async function bridgeWatch(_intervalSeconds, stuckThresholdSeconds) {
  const repoRoot = findRepoRoot();
  let state = loadState(repoRoot);
  if (!state) {
    return {
      ok: false,
      command: "bridge",
      code: "TAP_NOT_INITIALIZED",
      message: "Not initialized. Run: npx @hua-labs/tap init",
      warnings: [],
      data: {}
    };
  }
  const { config: resolvedCfg } = resolveConfig({}, repoRoot);
  const stateDir = resolvedCfg.stateDir;
  const instanceIds = Object.keys(state.instances);
  logHeader("@hua-labs/tap bridge watch");
  log(
    `Checking ${instanceIds.length} instance(s), stuck threshold: ${stuckThresholdSeconds}s`
  );
  const restarted = [];
  const cleaned = [];
  const initializing = [];
  const degraded = [];
  const healthy = [];
  const warnings = [];
  let stateChanged = false;
  for (const instanceId of instanceIds) {
    const inst = state.instances[instanceId];
    if (!inst?.installed || inst.bridgeMode !== "app-server") continue;
    const status = getBridgeStatus(stateDir, instanceId);
    if (status === "stale") {
      log(`${instanceId}: stale (process dead) \u2014 cleaning up`);
      state.instances[instanceId] = {
        ...inst,
        bridge: null,
        bridgeLifecycle: transitionBridgeLifecycle(
          inst.bridgeLifecycle ?? inst.bridge?.lifecycle ?? null,
          "crashed",
          "bridge pid not alive"
        ),
        managedAppServer: inst.bridge?.appServer?.managed ? inst.bridge.appServer : inst.managedAppServer ?? null
      };
      stateChanged = true;
      cleaned.push(instanceId);
      continue;
    }
    if (status === "stopped") {
      log(`${instanceId}: stopped`);
      continue;
    }
    const lifecycle = resolveBridgeLifecycleSnapshot(
      stateDir,
      instanceId,
      inst.bridge,
      inst.bridgeLifecycle ?? null
    );
    if (lifecycle.status === "initializing") {
      initializing.push(instanceId);
      log(`${instanceId}: initializing`);
      continue;
    }
    if (lifecycle.status === "degraded-no-thread") {
      degraded.push(instanceId);
      log(
        `${instanceId}: degraded-no-thread${lifecycle.savedThreadId ? ` (saved thread ${lifecycle.savedThreadId})` : ""}`
      );
      continue;
    }
    if (isTurnStuck(stateDir, instanceId, stuckThresholdSeconds)) {
      const turnInfo = getTurnInfo(stateDir, instanceId, stuckThresholdSeconds);
      const ageStr = turnInfo?.ageSeconds != null ? formatAge(turnInfo.ageSeconds) : "?";
      log(
        `${instanceId}: \u26A0 STUCK turn ${turnInfo?.activeTurnId?.slice(0, 8)}... (${ageStr}) \u2014 restarting`
      );
      const adapter = getAdapter(inst.runtime);
      const ctx = {
        ...createAdapterContext(state.commsDir, repoRoot),
        instanceId
      };
      const bridgeScript = adapter.resolveBridgeScript?.(ctx);
      if (!bridgeScript) {
        warnings.push(
          `${instanceId}: cannot restart \u2014 bridge script not found`
        );
        continue;
      }
      const bridgeState = loadBridgeState(stateDir, instanceId);
      const { manageAppServer, noAuth } = inferRestartMode(bridgeState, {});
      const previousWarmup = process.env.TAP_COLD_START_WARMUP;
      process.env.TAP_COLD_START_WARMUP = "true";
      try {
        const recoveredAgentName = resolveRecoveredAgentName(
          instanceId,
          void 0,
          repoRoot,
          ctx.stateDir
        );
        const restart = await restartBridge({
          instanceId,
          runtime: inst.runtime,
          stateDir: ctx.stateDir,
          commsDir: ctx.commsDir,
          bridgeScript,
          platform: ctx.platform,
          agentName: recoveredAgentName,
          runtimeCommand: resolvedCfg.runtimeCommand,
          appServerUrl: resolvedCfg.appServerUrl,
          repoRoot,
          port: inst.port ?? void 0,
          headless: inst.headless,
          drainTimeoutSeconds: 30,
          force: true,
          manageAppServer,
          noAuth,
          existingAppServer: bridgeState?.appServer ?? inst.managedAppServer ?? null,
          previousLifecycle: inst.bridgeLifecycle ?? inst.bridge?.lifecycle ?? null
        });
        const updatedInst = {
          ...inst,
          defaultAgentName: recoveredAgentName ?? inst.defaultAgentName ?? null,
          bridge: restart.bridge,
          bridgeLifecycle: restart.bridge.lifecycle ?? inst.bridgeLifecycle ?? null,
          managedAppServer: restart.bridge.appServer?.managed ? restart.bridge.appServer : null
        };
        const updatedState = updateInstanceState(
          state,
          instanceId,
          updatedInst
        );
        saveState(repoRoot, updatedState);
        state = updatedState;
        restarted.push(instanceId);
        logSuccess(
          `${instanceId}: restarted${restart.forced ? " (forced after drain timeout)" : ""}`
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        warnings.push(`${instanceId}: restart failed \u2014 ${msg}`);
        logError(`${instanceId}: restart failed \u2014 ${msg}`);
      } finally {
        if (previousWarmup === void 0) {
          delete process.env.TAP_COLD_START_WARMUP;
        } else {
          process.env.TAP_COLD_START_WARMUP = previousWarmup;
        }
      }
    } else {
      healthy.push(instanceId);
      log(`${instanceId}: healthy`);
    }
  }
  const message = [
    restarted.length > 0 ? `Restarted: ${restarted.join(", ")}` : null,
    cleaned.length > 0 ? `Cleaned stale: ${cleaned.join(", ")}` : null,
    initializing.length > 0 ? `Initializing: ${initializing.join(", ")}` : null,
    degraded.length > 0 ? `Degraded: ${degraded.join(", ")}` : null,
    healthy.length > 0 ? `Healthy: ${healthy.join(", ")}` : null
  ].filter(Boolean).join(". ") || "No app-server bridges found";
  log("");
  log(message);
  if (stateChanged) {
    saveState(repoRoot, state);
  }
  return {
    ok: true,
    command: "bridge",
    code: restarted.length > 0 ? "TAP_BRIDGE_WATCH_RESTARTED" : "TAP_BRIDGE_WATCH_OK",
    message,
    warnings,
    data: { restarted, cleaned, initializing, degraded, healthy }
  };
}
var init_bridge_watch = __esm({
  "src/commands/bridge-watch.ts"() {
    "use strict";
    init_state();
    init_bridge();
    init_config();
    init_adapters();
    init_utils();
    init_bridge_helpers();
  }
});

// src/commands/bridge-status.ts
function probeRetainedAppServer(appServer) {
  if (!appServer) {
    return null;
  }
  const pidAlive = appServer.pid != null && isProcessAlive(appServer.pid);
  const gatewayAlive = appServer.auth?.gatewayPid != null ? isProcessAlive(appServer.auth.gatewayPid) : true;
  const healthy = pidAlive && gatewayAlive;
  const checkedAt = (/* @__PURE__ */ new Date()).toISOString();
  return {
    ...appServer,
    healthy,
    lastCheckedAt: checkedAt,
    lastHealthyAt: healthy ? appServer.lastHealthyAt ?? checkedAt : appServer.lastHealthyAt
  };
}
function bridgeStatusAll() {
  const repoRoot = findRepoRoot();
  const state = loadState(repoRoot);
  if (!state) {
    return {
      ok: false,
      command: "bridge",
      code: "TAP_NOT_INITIALIZED",
      message: "Not initialized. Run: npx @hua-labs/tap init",
      warnings: [],
      data: {}
    };
  }
  const { config: resolvedCfg } = resolveConfig({}, repoRoot);
  const stateDir = resolvedCfg.stateDir;
  const instanceIds = Object.keys(state.instances);
  const bridges = {};
  logHeader("@hua-labs/tap bridge status");
  log(
    `${"Instance".padEnd(20)} ${"Runtime".padEnd(8)} ${"Status".padEnd(10)} ${"Lifecycle".padEnd(20)} ${"Session".padEnd(18)} ${"PID".padEnd(8)} ${"Port".padEnd(6)} ${"Last Heartbeat"}`
  );
  log(
    `${"\u2500".repeat(20)} ${"\u2500".repeat(8)} ${"\u2500".repeat(10)} ${"\u2500".repeat(20)} ${"\u2500".repeat(18)} ${"\u2500".repeat(8)} ${"\u2500".repeat(6)} ${"\u2500".repeat(20)}`
  );
  let stateChanged = false;
  for (const instanceId of instanceIds) {
    const inst = state.instances[instanceId];
    if (!inst?.installed) continue;
    if (inst.bridgeMode !== "app-server") {
      log(
        `${instanceId.padEnd(20)} ${inst.runtime.padEnd(8)} ${"n/a".padEnd(10)} ${"-".padEnd(8)} ${"-".padEnd(6)} ${inst.bridgeMode} mode`
      );
      bridges[instanceId] = {
        status: "n/a",
        lifecycle: null,
        session: null,
        runtime: inst.runtime,
        pid: null,
        port: inst.port,
        lastHeartbeat: null,
        threadId: null,
        threadCwd: null,
        savedThreadId: null,
        savedThreadCwd: null,
        appServer: null,
        lastNotificationMethod: null,
        lastNotificationAt: null,
        lastError: null
      };
      continue;
    }
    const rawStatus = getBridgeStatus(stateDir, instanceId);
    const bridgeState = loadBridgeState(stateDir, instanceId) ?? inst.bridge;
    const liveDispatch = rawStatus === "running" ? null : loadLiveDispatchEvidence(
      state.commsDir,
      instanceId,
      resolveUniqueLiveDispatchAliases(state.instances, instanceId)
    );
    const surfaceBridgeState = liveDispatch ? null : bridgeState;
    const runtimeHeartbeat = loadRuntimeBridgeHeartbeat(surfaceBridgeState);
    const savedThread = loadRuntimeBridgeThreadState(surfaceBridgeState);
    const status = liveDispatch ? "dispatch-live" : rawStatus;
    const surfaceAppServer = surfaceBridgeState?.appServer ?? (status === "stopped" || status === "stale" ? probeRetainedAppServer(inst.managedAppServer) : null);
    const lifecycle = liveDispatch ? deriveBridgeLifecycleState({ bridgeStatus: "stopped" }) : deriveBridgeLifecycleState({
      bridgeStatus: rawStatus,
      bridgeState,
      runtimeHeartbeat,
      savedThread,
      persistedLifecycle: inst.bridgeLifecycle ?? bridgeState?.lifecycle ?? null
    });
    const session = rawStatus === "running" || liveDispatch ? deriveCodexSessionState({
      runtimeHeartbeat,
      runtimeStateDir: surfaceBridgeState?.runtimeStateDir ?? null
    }) : null;
    const age = liveDispatch ? null : getHeartbeatAge(stateDir, instanceId);
    if (rawStatus === "stale" && inst.bridge) {
      state.instances[instanceId] = {
        ...inst,
        bridge: null,
        bridgeLifecycle: transitionBridgeLifecycle(
          inst.bridgeLifecycle ?? inst.bridge?.lifecycle ?? null,
          "crashed",
          "bridge pid not alive"
        ),
        managedAppServer: inst.bridge?.appServer?.managed ? probeRetainedAppServer(inst.bridge.appServer) : inst.managedAppServer ?? null
      };
      stateChanged = true;
    }
    const pid = surfaceBridgeState?.pid ?? null;
    const heartbeat = liveDispatch ? null : getBridgeHeartbeatTimestamp(stateDir, instanceId);
    const pidStr = pid ? String(pid) : "-";
    const portStr = inst.port ? String(inst.port) : "-";
    const ageStr = age !== null ? formatAge(age) : "-";
    log(
      `${instanceId.padEnd(20)} ${inst.runtime.padEnd(8)} ${status.padEnd(10)} ${lifecycle.status.padEnd(20)} ${(session?.status ?? "-").padEnd(18)} ${pidStr.padEnd(8)} ${portStr.padEnd(6)} ${ageStr}`
    );
    if (surfaceAppServer) {
      log(`  App server: ${formatAppServerState(surfaceAppServer)}`);
      if (surfaceAppServer.logPath) {
        log(`  Server log: ${surfaceAppServer.logPath}`);
      }
      if (surfaceAppServer.auth) {
        log(
          `  Protected: ${redactProtectedUrl(surfaceAppServer.auth.protectedUrl)}`
        );
      }
    }
    if (runtimeHeartbeat?.threadId) {
      log(
        `  Thread:     ${formatThreadSummary(runtimeHeartbeat.threadId, runtimeHeartbeat.threadCwd)}`
      );
    }
    if (runtimeHeartbeat?.lastNotificationMethod) {
      log(
        `  Notify:     ${runtimeHeartbeat.lastNotificationMethod} @ ${runtimeHeartbeat.lastNotificationAt ?? "-"}`
      );
    }
    if (runtimeHeartbeat?.lastError) {
      log(`  Last error: ${runtimeHeartbeat.lastError}`);
    }
    if (savedThread?.threadId && (savedThread.threadId !== runtimeHeartbeat?.threadId || !sameOptionalPath(savedThread.cwd, runtimeHeartbeat?.threadCwd))) {
      log(
        `  Saved:      ${formatThreadSummary(savedThread.threadId, savedThread.cwd)}`
      );
    }
    const transition = formatLifecycleTransition(lifecycle);
    if (transition) {
      log(`  Transition: ${transition}`);
    }
    if (liveDispatch) {
      log(
        `  Drift:      fresh bridge-dispatch heartbeat from PID ${liveDispatch.bridgePid} without bridge pid state`
      );
    }
    const turnInfo = getTurnInfo(stateDir, instanceId);
    if (turnInfo?.activeTurnId) {
      const ageStr2 = turnInfo.ageSeconds != null ? formatAge(turnInfo.ageSeconds) : "?";
      if (turnInfo.stuck) {
        log(
          `  \u26A0 STUCK:    turn ${turnInfo.activeTurnId.slice(0, 8)}... active ${ageStr2} (threshold: 5m)`
        );
      } else {
        log(
          `  Turn:       ${turnInfo.activeTurnId.slice(0, 8)}... active ${ageStr2}`
        );
      }
    }
    bridges[instanceId] = {
      status,
      lifecycle,
      session,
      runtime: inst.runtime,
      pid,
      port: inst.port,
      lastHeartbeat: heartbeat,
      threadId: runtimeHeartbeat?.threadId ?? null,
      threadCwd: runtimeHeartbeat?.threadCwd ?? null,
      savedThreadId: savedThread?.threadId ?? null,
      savedThreadCwd: savedThread?.cwd ?? null,
      appServer: surfaceAppServer,
      lastNotificationMethod: runtimeHeartbeat?.lastNotificationMethod ?? null,
      lastNotificationAt: runtimeHeartbeat?.lastNotificationAt ?? null,
      lastError: runtimeHeartbeat?.lastError ?? null
    };
  }
  if (instanceIds.length === 0) {
    log("No instances installed.");
  }
  if (stateChanged) {
    saveState(repoRoot, state);
  }
  log("");
  return {
    ok: true,
    command: "bridge",
    code: "TAP_BRIDGE_STATUS_OK",
    message: `${instanceIds.length} instance(s) checked`,
    warnings: [],
    data: { bridges }
  };
}
function bridgeStatusOne(identifier) {
  const repoRoot = findRepoRoot();
  const state = loadState(repoRoot);
  if (!state) {
    return {
      ok: false,
      command: "bridge",
      code: "TAP_NOT_INITIALIZED",
      message: "Not initialized. Run: npx @hua-labs/tap init",
      warnings: [],
      data: {}
    };
  }
  const resolved = resolveInstanceId(identifier, state);
  if (!resolved.ok) {
    return {
      ok: false,
      command: "bridge",
      code: resolved.code,
      message: resolved.message,
      warnings: [],
      data: {}
    };
  }
  const instanceId = resolved.instanceId;
  const inst = state.instances[instanceId];
  if (!inst?.installed) {
    return {
      ok: false,
      command: "bridge",
      instanceId,
      code: "TAP_INSTANCE_NOT_FOUND",
      message: `${instanceId} is not installed.`,
      warnings: [],
      data: {}
    };
  }
  logHeader(`@hua-labs/tap bridge status ${instanceId}`);
  log(`Instance:    ${instanceId}`);
  log(`Runtime:     ${inst.runtime}`);
  log(`Bridge mode: ${inst.bridgeMode}`);
  if (inst.port) log(`Port:        ${inst.port}`);
  if (inst.bridgeMode !== "app-server") {
    log(`Status:      n/a (${inst.bridgeMode} mode)`);
    log("");
    return {
      ok: true,
      command: "bridge",
      instanceId,
      runtime: inst.runtime,
      code: "TAP_BRIDGE_STATUS_OK",
      message: `${instanceId} bridge: n/a (${inst.bridgeMode} mode)`,
      warnings: [],
      data: {
        status: "n/a",
        lifecycle: {
          presence: "stopped",
          status: "stopped",
          summary: "stopped",
          lastTransitionAt: null,
          lastTransitionReason: null,
          restartCount: 0
        },
        session: null,
        bridgeMode: inst.bridgeMode,
        pid: null,
        port: inst.port,
        lastHeartbeat: null,
        threadId: null,
        threadCwd: null,
        savedThreadId: null,
        savedThreadCwd: null,
        appServer: null
      }
    };
  }
  const { config: resolvedCfg2 } = resolveConfig({}, repoRoot);
  const stateDir = resolvedCfg2.stateDir;
  const rawStatus = getBridgeStatus(stateDir, instanceId);
  const bridgeState = loadBridgeState(stateDir, instanceId) ?? inst.bridge;
  const liveDispatch = rawStatus === "running" ? null : loadLiveDispatchEvidence(
    state.commsDir,
    instanceId,
    resolveUniqueLiveDispatchAliases(state.instances, instanceId)
  );
  const surfaceBridgeState = liveDispatch ? null : bridgeState;
  const runtimeHeartbeat = loadRuntimeBridgeHeartbeat(surfaceBridgeState);
  const savedThread = loadRuntimeBridgeThreadState(surfaceBridgeState);
  const age = liveDispatch ? null : getHeartbeatAge(stateDir, instanceId);
  const heartbeat = liveDispatch ? null : getBridgeHeartbeatTimestamp(stateDir, instanceId);
  const status = liveDispatch ? "dispatch-live" : rawStatus;
  const surfaceAppServer = surfaceBridgeState?.appServer ?? (status === "stopped" || status === "stale" ? probeRetainedAppServer(inst.managedAppServer) : null);
  const lifecycle = liveDispatch ? deriveBridgeLifecycleState({ bridgeStatus: "stopped" }) : deriveBridgeLifecycleState({
    bridgeStatus: rawStatus,
    bridgeState,
    runtimeHeartbeat,
    savedThread,
    persistedLifecycle: inst.bridgeLifecycle ?? bridgeState?.lifecycle ?? null
  });
  const session = deriveCodexSessionState({
    runtimeHeartbeat,
    runtimeStateDir: surfaceBridgeState?.runtimeStateDir ?? null
  });
  log(`Status:      ${status}`);
  log(`Lifecycle:   ${lifecycle.summary}`);
  log(`Session:     ${session.summary}`);
  if (rawStatus === "stale" && inst.bridge) {
    state.instances[instanceId] = {
      ...inst,
      bridge: null,
      bridgeLifecycle: transitionBridgeLifecycle(
        inst.bridgeLifecycle ?? inst.bridge?.lifecycle ?? null,
        "crashed",
        "bridge pid not alive"
      ),
      managedAppServer: inst.bridge?.appServer?.managed ? probeRetainedAppServer(inst.bridge.appServer) : inst.managedAppServer ?? null
    };
    saveState(repoRoot, state);
  }
  if (surfaceBridgeState) {
    log(`PID:         ${surfaceBridgeState.pid}`);
    log(
      `Heartbeat:   ${heartbeat ?? "-"}${age !== null ? ` (${formatAge(age)})` : ""}`
    );
    if (runtimeHeartbeat?.threadId) {
      log(
        `Thread:      ${formatThreadSummary(runtimeHeartbeat.threadId, runtimeHeartbeat.threadCwd)}`
      );
    }
    if (savedThread?.threadId && (savedThread.threadId !== runtimeHeartbeat?.threadId || !sameOptionalPath(savedThread.cwd, runtimeHeartbeat?.threadCwd))) {
      log(
        `Saved:       ${formatThreadSummary(savedThread.threadId, savedThread.cwd)}`
      );
    }
    if (runtimeHeartbeat?.lastNotificationMethod) {
      log(
        `Notify:      ${runtimeHeartbeat.lastNotificationMethod} @ ${runtimeHeartbeat.lastNotificationAt ?? "-"}`
      );
    }
    if (runtimeHeartbeat?.lastError) {
      log(`Last error:  ${runtimeHeartbeat.lastError}`);
    }
    log(`Log:         ${logFilePath(stateDir, instanceId)}`);
  }
  if (surfaceAppServer) {
    log(`App server:  ${surfaceAppServer.url}`);
    log(`Server PID:  ${surfaceAppServer.pid ?? "-"}`);
    log(`Server mode: ${surfaceAppServer.managed ? "managed" : "external"}`);
    log(`Health:      ${surfaceAppServer.healthy ? "healthy" : "unhealthy"}`);
    log(`Checked:     ${surfaceAppServer.lastCheckedAt}`);
    if (surfaceAppServer.logPath) {
      log(`Server log:  ${surfaceAppServer.logPath}`);
    }
    if (surfaceAppServer.auth) {
      log(`Auth:        ${surfaceAppServer.auth.mode}`);
      log(
        `Protected:   ${redactProtectedUrl(surfaceAppServer.auth.protectedUrl)}`
      );
      log(`Upstream:    ${surfaceAppServer.auth.upstreamUrl}`);
      log(`TUI connect: ${surfaceAppServer.auth.upstreamUrl}`);
      log(`Gateway PID: ${surfaceAppServer.auth.gatewayPid ?? "-"}`);
      if (surfaceAppServer.auth.gatewayLogPath) {
        log(`Gateway log: ${surfaceAppServer.auth.gatewayLogPath}`);
      }
    } else if (surfaceAppServer.managed) {
      log(`Auth:        none (--no-auth)`);
      log(`TUI connect: ${surfaceAppServer.url}`);
    }
  }
  const transition = formatLifecycleTransition(lifecycle);
  if (transition) {
    log(`Transition:  ${transition}`);
  }
  if (liveDispatch) {
    log(
      `Drift:       fresh bridge-dispatch heartbeat from PID ${liveDispatch.bridgePid} without bridge pid state`
    );
  }
  log("");
  return {
    ok: true,
    command: "bridge",
    instanceId,
    runtime: inst.runtime,
    code: "TAP_BRIDGE_STATUS_OK",
    message: `${instanceId} bridge: ${status}`,
    warnings: [],
    data: {
      status,
      lifecycle: {
        presence: lifecycle.presence,
        status: lifecycle.status,
        summary: lifecycle.summary,
        lastTransitionAt: lifecycle.lastTransitionAt,
        lastTransitionReason: lifecycle.lastTransitionReason,
        restartCount: lifecycle.restartCount
      },
      session: {
        status: session.status,
        turnState: session.turnState,
        summary: session.summary,
        activeTurnId: session.activeTurnId,
        idleSince: session.idleSince,
        lastTurnAt: session.lastTurnAt,
        lastDispatchAt: session.lastDispatchAt
      },
      bridgeMode: inst.bridgeMode,
      pid: surfaceBridgeState?.pid ?? null,
      port: inst.port,
      lastHeartbeat: heartbeat,
      threadId: runtimeHeartbeat?.threadId ?? null,
      threadCwd: runtimeHeartbeat?.threadCwd ?? null,
      savedThreadId: savedThread?.threadId ?? null,
      savedThreadCwd: savedThread?.cwd ?? null,
      appServer: surfaceAppServer,
      lastNotificationMethod: runtimeHeartbeat?.lastNotificationMethod ?? null,
      lastNotificationAt: runtimeHeartbeat?.lastNotificationAt ?? null,
      lastError: runtimeHeartbeat?.lastError ?? null
    }
  };
}
var init_bridge_status = __esm({
  "src/commands/bridge-status.ts"() {
    "use strict";
    init_bridge_paths();
    init_state();
    init_bridge();
    init_health_monitor();
    init_config();
    init_utils();
    init_bridge_helpers();
  }
});

// src/commands/bridge-tui.ts
function bridgeTuiOne(identifier) {
  const repoRoot = findRepoRoot();
  const state = loadState(repoRoot);
  if (!state) {
    return {
      ok: false,
      command: "bridge",
      code: "TAP_NOT_INITIALIZED",
      message: "Not initialized. Run: npx @hua-labs/tap init",
      warnings: [],
      data: {}
    };
  }
  const resolved = resolveInstanceId(identifier, state);
  if (!resolved.ok) {
    return {
      ok: false,
      command: "bridge",
      code: resolved.code,
      message: resolved.message,
      warnings: [],
      data: {}
    };
  }
  const instanceId = resolved.instanceId;
  const inst = state.instances[instanceId];
  if (!inst?.installed) {
    return {
      ok: false,
      command: "bridge",
      instanceId,
      code: "TAP_INSTANCE_NOT_FOUND",
      message: `${instanceId} is not installed.`,
      warnings: [],
      data: {}
    };
  }
  if (inst.runtime !== "codex" || inst.bridgeMode !== "app-server") {
    return {
      ok: false,
      command: "bridge",
      instanceId,
      runtime: inst.runtime,
      code: "TAP_INVALID_ARGUMENT",
      message: `${instanceId} does not support Codex TUI attach. Use a Codex app-server bridge instance.`,
      warnings: [],
      data: {}
    };
  }
  const { config: resolvedConfig } = resolveConfig({}, repoRoot);
  const stateDir = resolvedConfig.stateDir;
  const status = getBridgeStatus(stateDir, instanceId);
  if (status !== "running") {
    return {
      ok: false,
      command: "bridge",
      instanceId,
      runtime: inst.runtime,
      code: "TAP_BRIDGE_NOT_RUNNING",
      message: `${instanceId} bridge is ${status}. Start it first with: npx @hua-labs/tap bridge start ${instanceId}`,
      warnings: [],
      data: { status }
    };
  }
  const bridgeState = loadBridgeState(stateDir, instanceId);
  const appServer = bridgeState?.appServer;
  const runtimeHeartbeat = loadRuntimeBridgeHeartbeat(bridgeState);
  const savedThread = loadRuntimeBridgeThreadState(bridgeState);
  if (!appServer) {
    return {
      ok: false,
      command: "bridge",
      instanceId,
      runtime: inst.runtime,
      code: "TAP_BRIDGE_NOT_RUNNING",
      message: `${instanceId} app-server state is missing. Restart the bridge first.`,
      warnings: [],
      data: { status }
    };
  }
  const tuiConnectUrl = resolveTuiConnectUrl(appServer);
  const attachCwd = resolveTuiAttachCwd(
    repoRoot,
    state.repoRoot,
    runtimeHeartbeat?.threadCwd,
    savedThread?.cwd
  );
  const attachEnv = {
    TAP_BRIDGE_INSTANCE_ID: instanceId,
    TAP_AGENT_ID: instanceId,
    TAP_COMMS_DIR: resolvedConfig.commsDir,
    TAP_STATE_DIR: stateDir,
    TAP_RUNTIME_STATE_DIR: bridgeState?.runtimeStateDir ?? getBridgeRuntimeStateDir(repoRoot, instanceId),
    TAP_REPO_ROOT: repoRoot
  };
  if (typeof inst.defaultAgentName === "string" && inst.defaultAgentName.trim()) {
    attachEnv.TAP_AGENT_NAME = inst.defaultAgentName;
    attachEnv.CODEX_TAP_AGENT_NAME = inst.defaultAgentName;
  }
  const attachCommand = formatCodexTuiAttachCommand(
    tuiConnectUrl,
    attachCwd,
    attachEnv
  );
  const warnings = appServer.auth != null ? [
    "Use the upstream TUI URL, not the protected gateway URL. The protected URL is bridge-only."
  ] : [];
  logHeader(`@hua-labs/tap bridge tui ${instanceId}`);
  if (appServer.auth) {
    log(`Protected: ${redactProtectedUrl(appServer.auth.protectedUrl)}`);
    log(`Upstream:  ${appServer.auth.upstreamUrl}`);
  }
  log(`Using:     ${tuiConnectUrl}`);
  log(`Attach:    ${attachCommand}`);
  log("");
  return {
    ok: true,
    command: "bridge",
    instanceId,
    runtime: inst.runtime,
    code: "TAP_BRIDGE_STATUS_OK",
    message: `${instanceId} TUI attach command ready`,
    warnings,
    data: {
      status,
      tuiConnectUrl,
      attachCwd,
      attachCommand,
      attachEnv,
      appServer
    }
  };
}
var init_bridge_tui = __esm({
  "src/commands/bridge-tui.ts"() {
    "use strict";
    init_state();
    init_bridge();
    init_config();
    init_utils();
    init_bridge_helpers();
  }
});

// src/commands/bridge-restart.ts
async function bridgeRestart(identifier, flags, explicitAgentName) {
  const repoRoot = findRepoRoot();
  const state = loadState(repoRoot);
  if (!state) {
    return {
      ok: false,
      command: "bridge",
      code: "TAP_NOT_INITIALIZED",
      message: "Not initialized. Run: npx @hua-labs/tap init",
      warnings: [],
      data: {}
    };
  }
  const resolved = resolveInstanceId(identifier, state);
  if (!resolved.ok) {
    return {
      ok: false,
      command: "bridge",
      code: resolved.code,
      message: resolved.message,
      warnings: [],
      data: {}
    };
  }
  const instanceId = resolved.instanceId;
  const inst = state.instances[instanceId];
  if (!inst) {
    return {
      ok: false,
      command: "bridge",
      code: "TAP_INSTANCE_NOT_FOUND",
      message: `Instance not found: ${instanceId}`,
      warnings: [],
      data: {}
    };
  }
  const adapter = getAdapter(inst.runtime);
  const ctx = {
    ...createAdapterContext(state.commsDir, repoRoot),
    instanceId
  };
  const bridgeScript = adapter.resolveBridgeScript?.(ctx);
  if (!bridgeScript) {
    return {
      ok: false,
      command: "bridge",
      instanceId,
      code: "TAP_BRIDGE_SCRIPT_MISSING",
      message: `Bridge script not found for ${instanceId}`,
      warnings: [],
      data: {}
    };
  }
  const { config: resolvedConfig } = resolveConfig({}, repoRoot);
  const drainStr = typeof flags["drain-timeout"] === "string" ? flags["drain-timeout"] : void 0;
  let drainTimeout;
  try {
    drainTimeout = parseIntFlag(drainStr, "--drain-timeout", 1, 300) ?? 30;
  } catch (err) {
    return {
      ok: false,
      command: "bridge",
      instanceId,
      runtime: inst.runtime,
      code: "TAP_INVALID_ARGUMENT",
      message: err instanceof Error ? err.message : String(err),
      warnings: [],
      data: {}
    };
  }
  logHeader(`@hua-labs/tap bridge restart ${instanceId}`);
  log(`Drain timeout: ${drainTimeout}s`);
  if (flags["force"] === true) {
    log("Force restart enabled after drain timeout");
  }
  try {
    const resolvedAgentName = resolveRecoveredAgentName(
      instanceId,
      explicitAgentName,
      repoRoot,
      ctx.stateDir
    );
    const currentBridgeState = loadBridgeState(ctx.stateDir, instanceId);
    const restartPlan = resolveBridgeRestartPlan({
      instanceId,
      stateDir: ctx.stateDir,
      commsDir: ctx.commsDir,
      liveDispatchAliases: resolveUniqueLiveDispatchAliases(
        state.instances,
        instanceId
      ),
      platform: ctx.platform,
      persistedLifecycle: inst.bridgeLifecycle ?? currentBridgeState?.lifecycle ?? null,
      fallbackBridgeState: currentBridgeState
    });
    if (restartPlan.kind === "blocked") {
      const message = `Restart blocked for ${instanceId}: ${restartPlan.reason}`;
      logError(message);
      if (restartPlan.manualHint) {
        log(`Hint: ${restartPlan.manualHint}`);
      }
      return {
        ok: false,
        command: "bridge",
        instanceId,
        runtime: inst.runtime,
        code: "TAP_BRIDGE_RESTART_BLOCKED",
        message,
        warnings: [],
        data: {
          restartKind: restartPlan.kind,
          manualHint: restartPlan.manualHint ?? null
        }
      };
    }
    if (restartPlan.kind === "external-managed") {
      const message = `External-managed bridge detected for ${instanceId}. Automatic restart skipped.`;
      log(message);
      if (restartPlan.evidence) {
        log(`Evidence: ${restartPlan.evidence}`);
      }
      if (restartPlan.manualHint) {
        log(`Hint: ${restartPlan.manualHint}`);
      }
      return {
        ok: true,
        command: "bridge",
        instanceId,
        runtime: inst.runtime,
        code: "TAP_BRIDGE_RESTART_EXTERNAL",
        message,
        warnings: [],
        data: {
          restartKind: restartPlan.kind,
          drained: false,
          forced: false,
          manualHint: restartPlan.manualHint ?? null,
          evidence: restartPlan.evidence ?? null,
          pid: restartPlan.liveDispatch?.bridgePid ?? null
        }
      };
    }
    if (restartPlan.kind === "not-running") {
      log(
        `No tracked running bridge found for ${instanceId}; starting a new bridge`
      );
    }
    if (flags["unsandboxed"] === true && (inst.runtime !== "codex" || flags["no-server"] === true)) {
      return {
        ok: false,
        command: "bridge",
        instanceId,
        runtime: inst.runtime,
        code: "TAP_INVALID_ARGUMENT",
        message: "--unsandboxed requires a managed Codex app-server (omit --no-server)",
        warnings: [],
        data: {}
      };
    }
    const { manageAppServer, noAuth, appServerUnsandboxed } = inferRestartMode(
      currentBridgeState,
      {
        noServer: flags["no-server"] === true ? true : void 0,
        noAuth: flags["no-auth"] === true ? true : void 0,
        unsandboxed: flags["unsandboxed"] === true ? true : void 0
      },
      {
        manageAppServer: inst.manageAppServer,
        noAuth: inst.noAuth,
        appServerUnsandboxed: inst.appServerUnsandboxed
      }
    );
    const existingAppServer = currentBridgeState?.appServer ?? inst.managedAppServer ?? null;
    const launcher = resolveLauncherInstanceOverrides({
      flags,
      env: process.env,
      repoRoot,
      baseInstanceId: instanceId
    });
    if (!launcher.ok) {
      return {
        ok: false,
        command: "bridge",
        instanceId,
        runtime: inst.runtime,
        code: "TAP_INVALID_ARGUMENT",
        message: launcher.message,
        warnings: [],
        data: {}
      };
    }
    const { instanceIdSuffix, routingSlot } = launcher;
    for (const line of launcher.logs) log(line);
    const previousColdStartWarmup = process.env.TAP_COLD_START_WARMUP;
    process.env.TAP_COLD_START_WARMUP = "true";
    let bridgeResult;
    try {
      bridgeResult = await restartBridge({
        instanceId,
        runtime: inst.runtime,
        stateDir: ctx.stateDir,
        commsDir: ctx.commsDir,
        bridgeScript,
        platform: ctx.platform,
        agentName: resolvedAgentName,
        runtimeCommand: resolvedConfig.runtimeCommand,
        appServerUrl: resolvedConfig.appServerUrl,
        repoRoot,
        port: inst.port ?? void 0,
        headless: inst.headless,
        drainTimeoutSeconds: drainTimeout,
        force: flags["force"] === true,
        manageAppServer,
        noAuth,
        appServerUnsandboxed,
        existingAppServer,
        previousLifecycle: inst.bridgeLifecycle ?? inst.bridge?.lifecycle ?? null,
        instanceIdSuffix,
        routingSlot,
        onDrainWait: ({ activeTurnId, turnState, waitedMs }) => {
          const waitedSeconds = Math.floor(waitedMs / 1e3);
          const busyDetail = activeTurnId ? `active turn ${activeTurnId}` : turnState ? `state ${turnState}` : "bridge busy";
          log(`Waiting for drain (${waitedSeconds}s): ${busyDetail}`);
        }
      });
    } finally {
      if (previousColdStartWarmup === void 0) {
        delete process.env.TAP_COLD_START_WARMUP;
      } else {
        process.env.TAP_COLD_START_WARMUP = previousColdStartWarmup;
      }
    }
    const bridge = bridgeResult.bridge;
    const modeLabel = restartPlan.kind === "not-running" ? "started via restart" : "restarted";
    const forceSuffix = bridgeResult.forced ? " (forced after drain timeout)" : "";
    logSuccess(`Bridge ${modeLabel} (PID: ${bridge.pid})${forceSuffix}`);
    const updated = {
      ...inst,
      defaultAgentName: resolvedAgentName ?? inst.defaultAgentName ?? null,
      bridge,
      bridgeLifecycle: bridge.lifecycle ?? inst.bridgeLifecycle ?? null,
      manageAppServer,
      noAuth,
      appServerUnsandboxed,
      managedAppServer: bridge.appServer?.managed ? bridge.appServer : null
    };
    const newState = updateInstanceState(state, instanceId, updated);
    saveState(repoRoot, newState);
    return {
      ok: true,
      command: "bridge",
      instanceId,
      code: "TAP_BRIDGE_RESTART_OK",
      message: restartPlan.kind === "not-running" ? `Bridge for ${instanceId} started via restart (PID: ${bridge.pid})` : `Bridge for ${instanceId} restarted (PID: ${bridge.pid})`,
      warnings: [],
      data: {
        pid: bridge.pid,
        restartKind: restartPlan.kind,
        drained: bridgeResult.drained,
        forced: bridgeResult.forced
      }
    };
  } catch (err) {
    if (err instanceof BridgeDrainTimeoutError) {
      logError(err.message);
      return {
        ok: false,
        command: "bridge",
        instanceId,
        runtime: inst.runtime,
        code: "TAP_BRIDGE_DRAIN_TIMEOUT",
        message: err.message,
        warnings: [],
        data: {
          restartKind: "managed-restart",
          drained: false,
          forced: false,
          activeTurnId: err.activeTurnId,
          turnState: err.turnState,
          waitedMs: err.waitedMs
        }
      };
    }
    const msg = err instanceof Error ? err.message : String(err);
    logError(msg);
    return {
      ok: false,
      command: "bridge",
      instanceId,
      code: "TAP_BRIDGE_RESTART_FAILED",
      message: msg,
      warnings: [],
      data: {}
    };
  }
}
var init_bridge_restart = __esm({
  "src/commands/bridge-restart.ts"() {
    "use strict";
    init_state();
    init_bridge();
    init_config();
    init_health_monitor();
    init_adapters();
    init_utils();
    init_bridge_helpers();
    init_bridge_start();
  }
});

// src/commands/bridge.ts
async function bridgeCommand(args) {
  const { positional, flags } = parseArgs(args);
  const subcommand = positional[0];
  const identifierArg = positional[1];
  const agentName = typeof flags["agent-name"] === "string" ? flags["agent-name"] : void 0;
  if (!subcommand || subcommand === "--help" || subcommand === "-h") {
    log(BRIDGE_HELP);
    return {
      ok: true,
      command: "bridge",
      code: "TAP_NO_OP",
      message: BRIDGE_HELP,
      warnings: [],
      data: {}
    };
  }
  switch (subcommand) {
    case "start": {
      const wantsAll = flags["all"] === true || identifierArg === "--all";
      const hasInstance = identifierArg && identifierArg !== "--all";
      if (wantsAll && hasInstance) {
        return {
          ok: false,
          command: "bridge",
          code: "TAP_INVALID_ARGUMENT",
          message: `Cannot combine <instance> with --all. Use either:
  tap bridge start ${identifierArg}
  tap bridge start --all`,
          warnings: [],
          data: {}
        };
      }
      if (wantsAll) {
        return bridgeStartAll(flags);
      }
      if (!identifierArg) {
        return {
          ok: false,
          command: "bridge",
          code: "TAP_INVALID_ARGUMENT",
          message: "Missing instance. Usage: npx @hua-labs/tap bridge start <instance> or --all",
          warnings: [],
          data: {}
        };
      }
      return bridgeStart(identifierArg, agentName, flags);
    }
    case "stop": {
      if (!identifierArg) {
        return bridgeStopAll(flags);
      }
      return bridgeStopOne(identifierArg, flags);
    }
    case "status": {
      if (identifierArg) {
        return bridgeStatusOne(identifierArg);
      }
      return bridgeStatusAll();
    }
    case "tui": {
      if (!identifierArg) {
        return {
          ok: false,
          command: "bridge",
          code: "TAP_INVALID_ARGUMENT",
          message: "Missing instance. Usage: npx @hua-labs/tap bridge tui <instance>",
          warnings: [],
          data: {}
        };
      }
      return bridgeTuiOne(identifierArg);
    }
    case "watch": {
      const intervalStr = typeof flags["interval"] === "string" ? flags["interval"] : void 0;
      const interval = intervalStr ? parseInt(intervalStr, 10) : 30;
      const stuckThresholdStr = typeof flags["stuck-threshold"] === "string" ? flags["stuck-threshold"] : void 0;
      const stuckThreshold = stuckThresholdStr ? parseInt(stuckThresholdStr, 10) : 300;
      return bridgeWatch(interval, stuckThreshold);
    }
    case "restart": {
      if (!identifierArg) {
        return {
          ok: false,
          command: "bridge",
          code: "TAP_INVALID_ARGUMENT",
          message: "Missing instance. Usage: npx @hua-labs/tap bridge restart <instance>",
          warnings: [],
          data: {}
        };
      }
      return bridgeRestart(identifierArg, flags);
    }
    default:
      return {
        ok: false,
        command: "bridge",
        code: "TAP_INVALID_ARGUMENT",
        message: `Unknown bridge subcommand: ${subcommand}. Use: start, stop, restart, status, tui`,
        warnings: [],
        data: {}
      };
  }
}
var BRIDGE_HELP;
var init_bridge2 = __esm({
  "src/commands/bridge.ts"() {
    "use strict";
    init_utils();
    init_bridge_start();
    init_bridge_stop();
    init_bridge_watch();
    init_bridge_status();
    init_bridge_tui();
    init_bridge_restart();
    BRIDGE_HELP = `
Usage:
  tap bridge <subcommand> [instance] [options]

Subcommands:
  start <instance>  Start bridge for an instance (e.g. codex, codex-agent-c)
  start --all       Start all registered app-server instances
  stop  <instance>  Stop bridge for an instance
  stop              Stop all running bridges
  status            Show bridge status for all instances
  status <instance> Show bridge status for a specific instance
  tui <instance>    Show the safe Codex TUI attach command with preserved tap context
  watch             Monitor bridges and auto-restart stuck/stale ones

Options:
  --agent-name <name>              Agent identity for bridge (or set TAP_AGENT_NAME env)
                                   Overrides the stored name from 'tap add' when needed
  --all                            Start all registered app-server instances
  --keep-server                    Leave the managed app-server running when bridge stops
  --bridge-only                    Alias for --keep-server
  --busy-mode <steer|wait>         How to handle active turns (default: steer)
  --poll-seconds <n>               Inbox poll interval (default: 5)
  --reconnect-seconds <n>          Reconnect delay after disconnect (default: 5)
  --message-lookback-minutes <n>   Process messages from last N minutes (default: 10)
  --thread-id <id>                 Resume specific thread
  --ephemeral                      Use ephemeral thread (no persistence)
  --process-existing-messages      Process all existing inbox messages
  --drain-timeout <seconds>        Restart: wait this long for active turn drain (default: 30)
  --force                          Restart: continue after drain timeout instead of aborting
  --no-server                      Skip app-server auto-start and connect only
  --no-auth                        Skip auth gateway (app-server listens directly, localhost only)
  --unsandboxed                    Launch managed Codex app-server with sandbox bypass
  --instance-id-suffix [<id>]      M392: append per-session suffix to TAP_INSTANCE_ID for the
                                   bridge daemon. Bare flag auto-generates 6 hex chars; pass an
                                   explicit value (4-16 [a-z0-9]) to pin one. Env: TAP_INSTANCE_ID_AUTO_SUFFIX=1
  --routing-slot <slot>            M392: explicit TAP_ROUTING_SLOT for reviewed deployments
                                   into bridge env. Auto-derived from base instance id when --instance-id-suffix is set

Port Assignment:
  Ports are auto-assigned from 4501 on first bridge start if not set via --port
  during 'tap add'. Auto-assigned ports are saved to state for future starts.

Examples:
  npx @hua-labs/tap bridge start codex --agent-name myAgent
  npx @hua-labs/tap bridge start --all
  npx @hua-labs/tap bridge start codex --agent-name myAgent --no-server
  npx @hua-labs/tap bridge start codex-agent-c --agent-name agent-c --busy-mode steer
  npx @hua-labs/tap bridge stop codex --keep-server
  npx @hua-labs/tap bridge restart codex
  npx @hua-labs/tap bridge restart codex --drain-timeout 10 --force
  npx @hua-labs/tap bridge stop
  npx @hua-labs/tap bridge status
  npx @hua-labs/tap bridge tui codex
`.trim();
  }
});

// src/commands/up.ts
var up_exports = {};
__export(up_exports, {
  upCommand: () => upCommand
});
function summarizeLifecycle(snapshot) {
  const ready = snapshot.bridges.filter(
    (bridge) => bridge.lifecycle?.status === "ready"
  ).length;
  const initializing = snapshot.bridges.filter(
    (bridge) => bridge.lifecycle?.status === "initializing"
  ).length;
  const degraded = snapshot.bridges.filter(
    (bridge) => bridge.lifecycle?.status === "degraded-no-thread"
  ).length;
  return `${ready} ready, ${initializing} initializing, ${degraded} degraded`;
}
async function upCommand(args) {
  if (args.includes("--help") || args.includes("-h")) {
    log(UP_HELP);
    return {
      ok: true,
      command: "up",
      code: "TAP_NO_OP",
      message: UP_HELP,
      warnings: [],
      data: {}
    };
  }
  const repoRoot = findRepoRoot();
  const previousColdStartWarmup = process.env.TAP_COLD_START_WARMUP;
  process.env.TAP_COLD_START_WARMUP = "true";
  let result;
  try {
    result = await bridgeCommand([
      "start",
      "--all",
      "--auto-prune-heartbeats",
      ...args
    ]);
  } finally {
    if (previousColdStartWarmup === void 0) {
      delete process.env.TAP_COLD_START_WARMUP;
    } else {
      process.env.TAP_COLD_START_WARMUP = previousColdStartWarmup;
    }
  }
  const snapshot = collectDashboardSnapshot(repoRoot);
  const activeBridges = snapshot.bridges.filter(
    (bridge) => bridge.status === "running"
  ).length;
  if (!result.ok) {
    return {
      ...result,
      command: "up",
      data: {
        ...result.data,
        snapshot
      }
    };
  }
  return {
    ok: true,
    command: "up",
    code: "TAP_UP_OK",
    message: `tap up: ${activeBridges} bridge(s) running (${summarizeLifecycle(snapshot)})`,
    warnings: result.warnings,
    data: {
      ...result.data,
      snapshot
    }
  };
}
var UP_HELP;
var init_up = __esm({
  "src/commands/up.ts"() {
    "use strict";
    init_bridge2();
    init_dashboard();
    init_utils();
    UP_HELP = `
Usage:
  tap up [bridge-start options]

Description:
  Start all registered app-server bridge daemons with one command.
  This is the orchestration entrypoint for headless/background TAP operation.
  tap up auto-prunes stale heartbeat entries before bridge startup.

Examples:
  npx @hua-labs/tap up
  npx @hua-labs/tap up --no-auth
  npx @hua-labs/tap up --busy-mode wait
`.trim();
  }
});

// src/commands/down.ts
var down_exports = {};
__export(down_exports, {
  downCommand: () => downCommand
});
async function downCommand(args) {
  if (args.includes("--help") || args.includes("-h")) {
    log(DOWN_HELP);
    return {
      ok: true,
      command: "down",
      code: "TAP_NO_OP",
      message: DOWN_HELP,
      warnings: [],
      data: {}
    };
  }
  const repoRoot = findRepoRoot();
  const result = await bridgeCommand(["stop"]);
  const snapshot = collectDashboardSnapshot(repoRoot);
  if (!result.ok) {
    return {
      ...result,
      command: "down",
      data: {
        ...result.data,
        snapshot
      }
    };
  }
  return {
    ok: true,
    command: "down",
    code: "TAP_DOWN_OK",
    message: `tap down: ${snapshot.bridges.filter((bridge) => bridge.status === "running").length} bridge(s) still running`,
    warnings: result.warnings,
    data: {
      ...result.data,
      snapshot
    }
  };
}
var DOWN_HELP;
var init_down = __esm({
  "src/commands/down.ts"() {
    "use strict";
    init_bridge2();
    init_dashboard();
    init_utils();
    DOWN_HELP = `
Usage:
  tap down

Description:
  Stop all running bridge daemons and managed app-servers.

Examples:
  npx @hua-labs/tap down
`.trim();
  }
});

// src/index.ts
init_state();

// src/version.ts
import * as fs5 from "fs";
import * as path5 from "path";
import { fileURLToPath } from "url";
var FALLBACK_VERSION = "0.0.0";
function resolvePackageVersion(metaUrl = import.meta.url) {
  const moduleDir = path5.dirname(fileURLToPath(metaUrl));
  const packageJsonPath = path5.join(moduleDir, "..", "package.json");
  try {
    const parsed = JSON.parse(fs5.readFileSync(packageJsonPath, "utf-8"));
    if (typeof parsed.version === "string" && parsed.version.trim()) {
      return parsed.version;
    }
  } catch {
  }
  return FALLBACK_VERSION;
}
var version = resolvePackageVersion();

// src/bridges/gemini-ide-companion.ts
import * as fs6 from "fs";
import * as os2 from "os";
import * as path7 from "path";
import { randomUUID } from "crypto";
import {
  createServer
} from "http";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError
} from "@modelcontextprotocol/sdk/types.js";

// src/bridges/gemini-ide-process.ts
import { exec } from "child_process";
import os from "os";
import path6 from "path";
import { promisify } from "util";
var execAsync = promisify(exec);
var MAX_TRAVERSAL_DEPTH = 32;
var WINDOWS_PROCESS_TABLE_COMMAND = "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CommandLine | ConvertTo-Json -Compress";
async function getWindowsProcessTable() {
  const processMap = /* @__PURE__ */ new Map();
  try {
    const { stdout } = await execAsync(
      `powershell "${WINDOWS_PROCESS_TABLE_COMMAND}"`,
      {
        maxBuffer: 10 * 1024 * 1024
      }
    );
    if (!stdout.trim()) {
      return processMap;
    }
    let processes = JSON.parse(stdout);
    if (!Array.isArray(processes)) {
      processes = [processes];
    }
    for (const processInfo of processes) {
      if (!processInfo || typeof processInfo !== "object" || typeof processInfo.ProcessId !== "number") {
        continue;
      }
      const processId = processInfo.ProcessId;
      processMap.set(processId, {
        pid: processId,
        parentPid: typeof processInfo.ParentProcessId === "number" ? processInfo.ParentProcessId ?? 0 : 0,
        name: typeof processInfo.Name === "string" ? processInfo.Name : "",
        command: typeof processInfo.CommandLine === "string" ? processInfo.CommandLine : ""
      });
    }
  } catch {
    return processMap;
  }
  return processMap;
}
async function getUnixProcessInfo(pid) {
  try {
    const { stdout } = await execAsync(`ps -o ppid=,command= -p ${pid}`);
    const trimmed = stdout.trim();
    if (!trimmed) {
      return null;
    }
    const [parentPidText, ...commandParts] = trimmed.split(/\s+/);
    const parentPid = Number.parseInt(parentPidText ?? "", 10);
    const command = commandParts.join(" ").trim();
    return {
      pid,
      parentPid: Number.isFinite(parentPid) ? parentPid : 0,
      name: path6.basename(command.split(" ")[0] ?? ""),
      command
    };
  } catch {
    return null;
  }
}
async function detectWindowsIdePid() {
  const processMap = await getWindowsProcessTable();
  const currentProcess = processMap.get(process.pid);
  if (!currentProcess) {
    return process.pid;
  }
  const ancestors = [];
  let current = currentProcess;
  for (let i = 0; i < MAX_TRAVERSAL_DEPTH && current; i += 1) {
    ancestors.push(current);
    if (current.parentPid === 0 || !processMap.has(current.parentPid)) {
      break;
    }
    current = processMap.get(current.parentPid);
  }
  if (ancestors.length >= 3) {
    return ancestors[ancestors.length - 3]?.pid ?? process.pid;
  }
  return ancestors[ancestors.length - 1]?.pid ?? process.pid;
}
async function detectUnixIdePid() {
  const shells = /* @__PURE__ */ new Set([
    "zsh",
    "bash",
    "sh",
    "tcsh",
    "csh",
    "ksh",
    "fish",
    "dash"
  ]);
  let currentPid = process.pid;
  for (let i = 0; i < MAX_TRAVERSAL_DEPTH; i += 1) {
    const processInfo = await getUnixProcessInfo(currentPid);
    if (!processInfo) {
      break;
    }
    if (shells.has(processInfo.name)) {
      let idePid = processInfo.parentPid;
      const grandParentInfo = processInfo.parentPid > 1 ? await getUnixProcessInfo(processInfo.parentPid) : null;
      if (grandParentInfo && grandParentInfo.parentPid > 1) {
        idePid = grandParentInfo.parentPid;
      }
      return idePid > 0 ? idePid : currentPid;
    }
    if (processInfo.parentPid <= 1) {
      break;
    }
    currentPid = processInfo.parentPid;
  }
  return currentPid;
}
async function detectGeminiIdeProcessPid() {
  const explicitPid = Number.parseInt(process.env.GEMINI_CLI_IDE_PID ?? "", 10);
  if (Number.isFinite(explicitPid) && explicitPid > 0) {
    return explicitPid;
  }
  if (os.platform() === "win32") {
    return detectWindowsIdePid();
  }
  return detectUnixIdePid();
}

// src/bridges/gemini-ide-companion.ts
var DEFAULT_IDE_INFO = {
  name: "tap",
  displayName: "TAP Gemini Companion"
};
function readBearerToken(req) {
  const authorization = req.headers.authorization;
  if (!authorization) {
    return null;
  }
  const [scheme, token] = authorization.split(/\s+/, 2);
  if (!scheme || !token || scheme.toLowerCase() !== "bearer") {
    return null;
  }
  return token;
}
function writeJson(res, statusCode, body) {
  res.writeHead(statusCode, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}
function createSession() {
  const diffContents = /* @__PURE__ */ new Map();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID()
  });
  const mcpServer = new Server(
    {
      name: "tap-gemini-ide-companion",
      version: "0.1.0"
    },
    {
      capabilities: {
        tools: {
          listChanged: false
        }
      }
    }
  );
  mcpServer.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "openDiff",
        description: "Open a diff view for a file inside the IDE companion.",
        inputSchema: {
          type: "object",
          properties: {
            filePath: { type: "string" },
            newContent: { type: "string" }
          },
          required: ["filePath", "newContent"]
        }
      },
      {
        name: "closeDiff",
        description: "Close an open diff view and return the final content.",
        inputSchema: {
          type: "object",
          properties: {
            filePath: { type: "string" },
            suppressNotification: { type: "boolean" }
          },
          required: ["filePath"]
        }
      }
    ]
  }));
  mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
    switch (request.params.name) {
      case "openDiff": {
        const filePath = request.params.arguments?.filePath;
        const newContent = request.params.arguments?.newContent;
        if (typeof filePath !== "string" || typeof newContent !== "string") {
          throw new McpError(
            ErrorCode.InvalidParams,
            "openDiff requires string filePath and newContent arguments."
          );
        }
        diffContents.set(filePath, newContent);
        return { content: [] };
      }
      case "closeDiff": {
        const filePath = request.params.arguments?.filePath;
        const suppressNotification = request.params.arguments?.suppressNotification;
        if (typeof filePath !== "string") {
          throw new McpError(
            ErrorCode.InvalidParams,
            "closeDiff requires a string filePath argument."
          );
        }
        if (suppressNotification !== void 0 && typeof suppressNotification !== "boolean") {
          throw new McpError(
            ErrorCode.InvalidParams,
            "closeDiff suppressNotification must be a boolean when provided."
          );
        }
        const content = diffContents.get(filePath) ?? null;
        diffContents.delete(filePath);
        if (content !== null && !suppressNotification) {
          await transport.send({
            jsonrpc: "2.0",
            method: "ide/diffRejected",
            params: { filePath }
          });
        }
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ content })
            }
          ]
        };
      }
      default:
        throw new McpError(
          ErrorCode.InvalidParams,
          `Unknown tool: ${request.params.name}`
        );
    }
  });
  return {
    mcpServer,
    transport,
    diffContents
  };
}
function resolveDiscoveryFilePath(pid, port) {
  return path7.join(
    os2.tmpdir(),
    "gemini",
    "ide",
    `gemini-ide-server-${pid}-${port}.json`
  );
}
function writeDiscoveryFile(options) {
  const filePath = resolveDiscoveryFilePath(options.pid, options.port);
  fs6.mkdirSync(path7.dirname(filePath), { recursive: true });
  fs6.writeFileSync(
    filePath,
    JSON.stringify(
      {
        port: options.port,
        workspacePath: options.workspacePaths.join(path7.delimiter),
        authToken: options.authToken,
        ideInfo: options.ideInfo
      },
      null,
      2
    ) + "\n",
    "utf-8"
  );
  return filePath;
}
function removeFileIfExists(filePath) {
  if (!filePath) {
    return;
  }
  try {
    fs6.unlinkSync(filePath);
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }
}
async function startGeminiIdeCompanionServer(options = {}) {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 0;
  const endpointPath = options.endpointPath ?? "/mcp";
  const authToken = options.authToken ?? randomUUID();
  const ideInfo = options.ideInfo ?? DEFAULT_IDE_INFO;
  const sessions = /* @__PURE__ */ new Map();
  let resolvedPort = port;
  const httpServer = createServer(async (req, res) => {
    try {
      const requestUrl = new URL(
        req.url ?? "/",
        `http://${req.headers.host ?? `${host}:${resolvedPort}`}`
      );
      if (requestUrl.pathname !== endpointPath) {
        writeJson(res, 404, { error: "Not found" });
        return;
      }
      const suppliedToken = readBearerToken(req);
      if (suppliedToken !== authToken) {
        res.setHeader("www-authenticate", 'Bearer realm="gemini-ide"');
        writeJson(res, 401, { error: "Unauthorized" });
        return;
      }
      const sessionIdHeader = req.headers["mcp-session-id"];
      const sessionId = typeof sessionIdHeader === "string" ? sessionIdHeader : null;
      if (!sessionId) {
        if (req.method !== "POST") {
          writeJson(res, 400, {
            error: "Missing MCP session ID for non-initialization request."
          });
          return;
        }
        const session = createSession();
        session.transport.onclose = () => {
          const activeSessionId = session.transport.sessionId;
          if (activeSessionId) {
            sessions.delete(activeSessionId);
          }
        };
        await session.mcpServer.connect(session.transport);
        await session.transport.handleRequest(req, res);
        const initializedSessionId = session.transport.sessionId;
        if (initializedSessionId) {
          sessions.set(initializedSessionId, session);
        }
        return;
      }
      const existingSession = sessions.get(sessionId);
      if (!existingSession) {
        writeJson(res, 404, { error: `Unknown MCP session: ${sessionId}` });
        return;
      }
      await existingSession.transport.handleRequest(req, res);
    } catch (error) {
      options.logger?.error?.("[gemini-ide-companion] request failed", error);
      if (!res.headersSent) {
        writeJson(res, 500, { error: "Internal server error" });
      } else {
        res.end();
      }
    }
  });
  await new Promise((resolve21, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(port, host, () => {
      httpServer.off("error", reject);
      resolve21();
    });
  });
  const resolvedAddress = httpServer.address();
  if (!resolvedAddress || typeof resolvedAddress === "string") {
    throw new Error("Failed to resolve Gemini IDE companion listen address.");
  }
  resolvedPort = resolvedAddress.port;
  const workspacePaths = (options.workspacePaths ?? []).map((workspacePath) => path7.resolve(workspacePath)).filter(Boolean);
  let discoveryFilePath = null;
  try {
    if (options.enableDiscoveryFile) {
      if (workspacePaths.length === 0) {
        throw new Error(
          "workspacePaths is required when enableDiscoveryFile is true."
        );
      }
      const discoveryPid = options.discoveryPid ?? await detectGeminiIdeProcessPid();
      discoveryFilePath = writeDiscoveryFile({
        port: resolvedPort,
        pid: discoveryPid,
        authToken,
        workspacePaths,
        ideInfo
      });
    }
  } catch (error) {
    await new Promise((resolve21, reject) => {
      httpServer.close((closeError) => {
        if (closeError) {
          reject(closeError);
          return;
        }
        resolve21();
      });
    });
    throw error;
  }
  const close = async () => {
    removeFileIfExists(discoveryFilePath);
    const closePromises = [...sessions.values()].map(async (session) => {
      await session.mcpServer.close();
      session.diffContents.clear();
    });
    await Promise.all(closePromises);
    sessions.clear();
    await new Promise((resolve21, reject) => {
      httpServer.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve21();
      });
    });
  };
  const sendContextUpdate = async (context, sessionId) => {
    const targets = sessionId ? [[sessionId, sessions.get(sessionId) ?? null]] : [...sessions.entries()].map(([id, session]) => [id, session]);
    const delivered = [];
    for (const [targetSessionId, session] of targets) {
      if (!session) {
        continue;
      }
      await session.transport.send({
        jsonrpc: "2.0",
        method: "ide/contextUpdate",
        params: context
      });
      delivered.push(targetSessionId);
    }
    return delivered;
  };
  const sendDiffAccepted = async (filePath, content, sessionId) => {
    const targets = sessionId ? [[sessionId, sessions.get(sessionId) ?? null]] : [...sessions.entries()].map(([id, session]) => [id, session]);
    const delivered = [];
    for (const [targetSessionId, session] of targets) {
      if (!session) {
        continue;
      }
      const finalContent = content ?? session.diffContents.get(filePath);
      if (typeof finalContent !== "string") {
        continue;
      }
      await session.transport.send({
        jsonrpc: "2.0",
        method: "ide/diffAccepted",
        params: { filePath, content: finalContent }
      });
      session.diffContents.delete(filePath);
      delivered.push(targetSessionId);
    }
    return delivered;
  };
  const sendDiffRejected = async (filePath, sessionId) => {
    const targets = sessionId ? [[sessionId, sessions.get(sessionId) ?? null]] : [...sessions.entries()].map(([id, session]) => [id, session]);
    const delivered = [];
    for (const [targetSessionId, session] of targets) {
      if (!session) {
        continue;
      }
      if (!sessionId && !session.diffContents.has(filePath)) {
        continue;
      }
      await session.transport.send({
        jsonrpc: "2.0",
        method: "ide/diffRejected",
        params: { filePath }
      });
      session.diffContents.delete(filePath);
      delivered.push(targetSessionId);
    }
    return delivered;
  };
  return {
    port: resolvedPort,
    host,
    url: `http://${host}:${resolvedPort}${endpointPath}`,
    endpointPath,
    authToken,
    discoveryFilePath,
    sessionIds: () => [...sessions.keys()],
    sendDiffAccepted,
    sendDiffRejected,
    sendContextUpdate,
    close
  };
}

// src/index.ts
init_config();
init_utils();
init_bridge_observability();
init_bridge();
init_dashboard();

// src/transport/consent.ts
import { createHash as createHash2, randomBytes as randomBytes3, randomUUID as randomUUID2 } from "crypto";
import { execFileSync } from "child_process";
import * as fs24 from "fs";
import * as os5 from "os";
import * as path23 from "path";
var CONSENT_RECEIPTS_DIRNAME = "tap-codex-a2a-consent";
var CONSENT_SECRETS_DIRNAME = "tap-codex-a2a-consent-secrets";
var DEFAULT_CONSENT_TTL_SECONDS = 10 * 60;
var CONSENT_METADATA_DRIFT_TOLERANCE_MS = 5e3;
var CONSENT_RESERVATION_TTL_MS = 3e4;
var pendingConsentReservations = /* @__PURE__ */ new Set();
var SCOPE_PRIORITY = {
  observe: 1,
  suggest: 2,
  drive: 3
};
var ConsentReceiptError = class extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = "ConsentReceiptError";
  }
  code;
};
function normalizeString(value) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}
function assertPendingReservationAvailable(consentRef) {
  if (!pendingConsentReservations.has(consentRef)) {
    return;
  }
  throw new ConsentReceiptError(
    "missing",
    `Consent receipt "${consentRef}" is already reserved or consumed.`
  );
}
function markPendingReservation(consentRef) {
  pendingConsentReservations.add(consentRef);
}
function clearPendingReservation(consentRef) {
  pendingConsentReservations.delete(consentRef);
}
function normalizeMethods(values) {
  const methods = /* @__PURE__ */ new Set();
  for (const value of values ?? []) {
    const normalized = value.trim();
    if (!normalized) continue;
    methods.add(normalized);
  }
  return [...methods].sort();
}
function normalizePathForComparison(value) {
  return path23.resolve(value).replace(/\\/g, "/").toLowerCase();
}
function resolveReceiptsDir(explicitDir) {
  const configuredDir = explicitDir?.trim() || process.env.TAP_CONSENT_RECEIPTS_DIR?.trim();
  return configuredDir ? path23.resolve(configuredDir) : path23.join(os5.tmpdir(), CONSENT_RECEIPTS_DIRNAME);
}
function resolveSecretsDir(explicitDir) {
  const configuredDir = explicitDir?.trim() || process.env.TAP_CONSENT_SECRETS_DIR?.trim();
  return configuredDir ? path23.resolve(configuredDir) : path23.join(os5.tmpdir(), CONSENT_SECRETS_DIRNAME);
}
function resolveConsentDirs(options) {
  const receiptsDir = resolveReceiptsDir(options.receiptsDir);
  const secretsDir = resolveSecretsDir(options.secretsDir);
  if (normalizePathForComparison(receiptsDir) === normalizePathForComparison(secretsDir)) {
    throw new ConsentReceiptError(
      "invalid",
      "Consent receipts dir and secrets dir must be different paths."
    );
  }
  return { receiptsDir, secretsDir };
}
function hashPairTokenBinding(options) {
  return createHash2("sha256").update(
    [
      options.pairToken,
      options.hostId ?? "",
      options.conversationId,
      options.ownerClientId ?? ""
    ].join("\0"),
    "utf-8"
  ).digest("hex");
}
function readUtf8PreservingTimes(filePath) {
  const originalStats = fs24.statSync(filePath);
  const contents = fs24.readFileSync(filePath, "utf-8");
  try {
    fs24.utimesSync(filePath, originalStats.atime, originalStats.mtime);
  } catch {
  }
  return contents;
}
function loadConsentReceipt(filePath) {
  try {
    const parsed = JSON.parse(
      readUtf8PreservingTimes(filePath)
    );
    if (typeof parsed.id !== "string" || typeof parsed.scope !== "string" || typeof parsed.conversationId !== "string" || typeof parsed.pairTokenHash !== "string" || typeof parsed.createdAt !== "string" || typeof parsed.expiresAt !== "string") {
      return null;
    }
    if (parsed.scope !== "observe" && parsed.scope !== "suggest" && parsed.scope !== "drive") {
      return null;
    }
    return {
      id: parsed.id,
      scope: parsed.scope,
      hostId: normalizeString(parsed.hostId),
      conversationId: parsed.conversationId,
      ownerClientId: normalizeString(parsed.ownerClientId),
      issuedByClientId: normalizeString(parsed.issuedByClientId),
      allowedMethods: normalizeMethods(parsed.allowedMethods),
      pairTokenHash: parsed.pairTokenHash,
      createdAt: parsed.createdAt,
      expiresAt: parsed.expiresAt
    };
  } catch {
    return null;
  }
}
function loadReservedReceiptRecord(filePath) {
  try {
    const parsed = JSON.parse(readUtf8PreservingTimes(filePath));
    return {
      receipt: loadConsentReceipt(filePath),
      reservationOwnerId: normalizeString(parsed.reservationOwnerId)
    };
  } catch {
    return {
      receipt: null,
      reservationOwnerId: null
    };
  }
}
function isExpired(receipt, now) {
  const expiresAtMs = new Date(receipt.expiresAt).getTime();
  return Number.isNaN(expiresAtMs) || expiresAtMs <= now.getTime();
}
function resolveSecretPath(secretsDir, receiptId) {
  return path23.join(secretsDir, `${receiptId}.token`);
}
function resolveReservedReceiptPath(receiptsDir, receiptId) {
  return path23.join(receiptsDir, `${receiptId}.reserved.json`);
}
function extractReceiptIdFromPath(filePath) {
  return path23.basename(filePath).replace(/(?:\.reserved)?\.json$/i, "");
}
function isReceiptPath(fileName) {
  return /\.json$/i.test(fileName);
}
function resolveWindowsAclPrincipals() {
  const username = process.env.USERNAME?.trim();
  if (!username) return [];
  const principals = /* @__PURE__ */ new Set();
  const userDomain = process.env.USERDOMAIN?.trim();
  if (userDomain) {
    principals.add(`${userDomain}\\${username}`);
  }
  principals.add(username);
  return [...principals];
}
function applyWindowsPrivateAcl(targetPath) {
  if (process.platform !== "win32") return;
  const principals = resolveWindowsAclPrincipals();
  if (principals.length === 0) {
    throw new ConsentReceiptError(
      "invalid",
      `Unable to resolve a Windows principal for "${path23.basename(targetPath)}".`
    );
  }
  let lastError = null;
  for (const principal of principals) {
    try {
      execFileSync(
        "icacls",
        [targetPath, "/inheritance:r", "/grant:r", `${principal}:F`],
        {
          stdio: "pipe",
          windowsHide: true
        }
      );
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw new ConsentReceiptError(
    "invalid",
    `Failed to apply Windows ACL hardening to "${path23.basename(targetPath)}": ${lastError instanceof Error ? lastError.message : String(lastError)}`
  );
}
function hardenSecretStorePath(targetPath, mode) {
  try {
    fs24.chmodSync(targetPath, mode);
  } catch {
  }
  applyWindowsPrivateAcl(targetPath);
}
function hasTimestampDrift(stats, mintedAtMs) {
  if (!Number.isFinite(mintedAtMs)) {
    return false;
  }
  return Math.abs(stats.mtimeMs - mintedAtMs) > CONSENT_METADATA_DRIFT_TOLERANCE_MS || Math.abs(stats.atimeMs - mintedAtMs) > CONSENT_METADATA_DRIFT_TOLERANCE_MS;
}
function stampMintedAt(targetPath, mintedAt) {
  fs24.utimesSync(targetPath, mintedAt, mintedAt);
}
function stampReservationAt(targetPath, reservedAt) {
  fs24.utimesSync(targetPath, reservedAt, reservedAt);
}
function resolveReceiptCreatedAtMs(receipt) {
  const createdAtMs = new Date(receipt.createdAt).getTime();
  if (Number.isNaN(createdAtMs)) {
    throw new ConsentReceiptError(
      "invalid",
      `Consent receipt "${receipt.id}" has an invalid createdAt timestamp.`
    );
  }
  return createdAtMs;
}
function resolveReceiptCreatedAt(receipt) {
  return new Date(resolveReceiptCreatedAtMs(receipt));
}
function isReservationExpired(stats, now) {
  return now.getTime() - stats.mtimeMs > CONSENT_RESERVATION_TTL_MS;
}
function assertUntamperedConsentPath(stats, receipt, label) {
  if (!hasTimestampDrift(stats, resolveReceiptCreatedAtMs(receipt))) {
    return;
  }
  throw new ConsentReceiptError(
    "invalid",
    `Consent ${label} "${receipt.id}" showed timestamp drift after mint.`
  );
}
function removeSecretPath(secretPath) {
  try {
    fs24.rmSync(secretPath, { force: true });
  } catch {
  }
}
function removeReceiptPath(receiptPath) {
  try {
    fs24.rmSync(receiptPath, { force: true });
  } catch {
  }
}
function writeActiveReceiptFile(filePath, receipt) {
  fs24.writeFileSync(filePath, JSON.stringify(receipt, null, 2), "utf-8");
  stampMintedAt(filePath, resolveReceiptCreatedAt(receipt));
}
function writeReservedReceiptFile(filePath, receipt, reservationOwnerId, reservedAt) {
  fs24.writeFileSync(
    filePath,
    JSON.stringify(
      {
        ...receipt,
        reservationOwnerId
      },
      null,
      2
    ),
    "utf-8"
  );
  stampReservationAt(filePath, reservedAt);
}
function cleanupExpiredReceipts(receiptsDir, secretsDir, now) {
  if (!fs24.existsSync(receiptsDir)) return;
  for (const entry of fs24.readdirSync(receiptsDir, { withFileTypes: true })) {
    if (!entry.isFile() || !isReceiptPath(entry.name)) continue;
    const filePath = path23.join(receiptsDir, entry.name);
    const receipt = loadConsentReceipt(filePath);
    const receiptId = receipt?.id ?? extractReceiptIdFromPath(filePath);
    if (!receipt || isExpired(receipt, now)) {
      removeReceiptPath(filePath);
      removeSecretPath(resolveSecretPath(secretsDir, receiptId));
    }
  }
}
function listReceiptPaths(receiptsDir) {
  if (!fs24.existsSync(receiptsDir)) return [];
  return fs24.readdirSync(receiptsDir, { withFileTypes: true }).filter(
    (entry) => entry.isFile() && entry.name.endsWith(".json") && !entry.name.endsWith(".reserved.json")
  ).map((entry) => path23.join(receiptsDir, entry.name)).sort();
}
function scopeSatisfies(actual, required) {
  return SCOPE_PRIORITY[actual] >= SCOPE_PRIORITY[required];
}
function resolveReceiptPath(receiptsDir, consentRef) {
  const normalizedConsentRef = normalizeString(consentRef);
  if (!normalizedConsentRef) return null;
  return path23.join(receiptsDir, `${normalizedConsentRef}.json`);
}
function reserveReceiptPath(filePath, receipt, reservationOwnerId, now) {
  const reservedPath = resolveReservedReceiptPath(
    path23.dirname(filePath),
    receipt.id
  );
  try {
    fs24.renameSync(filePath, reservedPath);
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new ConsentReceiptError(
        "missing",
        `Consent receipt "${receipt.id}" is already reserved or consumed.`
      );
    }
    throw error;
  }
  writeReservedReceiptFile(reservedPath, receipt, reservationOwnerId, now);
  return reservedPath;
}
function mintPairToken() {
  return randomBytes3(32).toString("base64url");
}
function writeSecretFile(secretPath, pairToken, mintedAt) {
  fs24.writeFileSync(secretPath, pairToken, {
    encoding: "utf-8",
    mode: 384
  });
  stampMintedAt(secretPath, mintedAt);
  hardenSecretStorePath(secretPath, 384);
}
function assertNoLegacyPairTokenInput(options, context) {
  const legacyPairToken = options.pairToken;
  if (typeof legacyPairToken !== "undefined") {
    throw new ConsentReceiptError(
      "invalid",
      `${context} no longer accepts a caller-provided pairToken.`
    );
  }
}
function createConsentReceipt(options) {
  assertNoLegacyPairTokenInput(options, "createConsentReceipt");
  const now = options.now ?? /* @__PURE__ */ new Date();
  const { receiptsDir, secretsDir } = resolveConsentDirs(options);
  const scope = options.scope ?? "drive";
  const conversationId = options.conversationId.trim();
  if (!conversationId) {
    throw new ConsentReceiptError(
      "invalid",
      "Consent receipt requires a non-empty conversationId."
    );
  }
  fs24.mkdirSync(receiptsDir, { recursive: true });
  fs24.mkdirSync(secretsDir, { recursive: true, mode: 448 });
  hardenSecretStorePath(secretsDir, 448);
  cleanupExpiredReceipts(receiptsDir, secretsDir, now);
  const ttlSeconds = Math.max(
    1,
    options.ttlSeconds ?? DEFAULT_CONSENT_TTL_SECONDS
  );
  const receiptId = randomUUID2();
  const hostId = normalizeString(options.hostId);
  const ownerClientId = normalizeString(options.ownerClientId);
  const pairToken = mintPairToken();
  const receipt = {
    id: receiptId,
    scope,
    hostId,
    conversationId,
    ownerClientId,
    issuedByClientId: normalizeString(options.issuedByClientId),
    allowedMethods: normalizeMethods(options.allowedMethods),
    pairTokenHash: hashPairTokenBinding({
      pairToken,
      hostId,
      conversationId,
      ownerClientId
    }),
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + ttlSeconds * 1e3).toISOString()
  };
  const filePath = path23.join(receiptsDir, `${receipt.id}.json`);
  const secretPath = resolveSecretPath(secretsDir, receipt.id);
  const createdAt = new Date(receipt.createdAt);
  try {
    writeSecretFile(secretPath, pairToken, createdAt);
    fs24.writeFileSync(filePath, JSON.stringify(receipt, null, 2), "utf-8");
    stampMintedAt(filePath, createdAt);
  } catch (error) {
    removeSecretPath(secretPath);
    removeReceiptPath(filePath);
    throw error;
  }
  return { receipt, filePath };
}
function consumeConsentReceipt(options) {
  const prepared = prepareConsentReceipt(options);
  prepared.commit();
  return prepared.receipt;
}
function prepareConsentReceipt(options) {
  assertNoLegacyPairTokenInput(options, "consumeConsentReceipt");
  const now = options.now ?? /* @__PURE__ */ new Date();
  const { receiptsDir, secretsDir } = resolveConsentDirs(options);
  cleanupExpiredReceipts(receiptsDir, secretsDir, now);
  const requiredScope = options.requiredScope ?? "drive";
  const method = normalizeString(options.method);
  const conversationId = options.conversationId.trim();
  const ownerClientId = normalizeString(options.ownerClientId);
  const hostId = normalizeString(options.hostId);
  const reservationOwnerId = normalizeString(options.reservationOwnerId);
  const explicitConsentRef = normalizeString(options.consentRef);
  if (!conversationId) {
    throw new ConsentReceiptError(
      "invalid",
      "Consent receipt consumption requires a conversationId."
    );
  }
  const explicitPath = resolveReceiptPath(receiptsDir, explicitConsentRef);
  const explicitReservedPath = explicitConsentRef ? resolveReservedReceiptPath(receiptsDir, explicitConsentRef) : null;
  const reservedConsentRef = explicitConsentRef;
  if (reservedConsentRef && explicitPath && explicitReservedPath && !fs24.existsSync(explicitPath) && fs24.existsSync(explicitReservedPath)) {
    assertPendingReservationAvailable(reservedConsentRef);
    const reservedRecord = loadReservedReceiptRecord(explicitReservedPath);
    const reservedReceipt = reservedRecord.receipt;
    const reservedReceiptId = reservedReceipt?.id ?? extractReceiptIdFromPath(explicitReservedPath);
    if (!reservedReceipt || isExpired(reservedReceipt, now)) {
      removeReceiptPath(explicitReservedPath);
      removeSecretPath(resolveSecretPath(secretsDir, reservedReceiptId));
    } else if (reservationOwnerId && reservedRecord.reservationOwnerId === reservationOwnerId && isReservationExpired(fs24.statSync(explicitReservedPath), now)) {
      fs24.renameSync(explicitReservedPath, explicitPath);
      writeActiveReceiptFile(explicitPath, reservedReceipt);
    } else {
      throw new ConsentReceiptError(
        "missing",
        `Consent receipt "${explicitConsentRef}" is already reserved or consumed.`
      );
    }
  }
  const candidatePaths = explicitPath ? [explicitPath] : listReceiptPaths(receiptsDir);
  let deferredError = null;
  for (const filePath of candidatePaths) {
    if (!fs24.existsSync(filePath)) {
      if (explicitPath && explicitReservedPath && fs24.existsSync(explicitReservedPath)) {
        throw new ConsentReceiptError(
          "missing",
          `Consent receipt "${explicitConsentRef}" is already reserved or consumed.`
        );
      }
      continue;
    }
    const receiptStats = fs24.statSync(filePath);
    const receipt = loadConsentReceipt(filePath);
    if (!receipt) {
      removeReceiptPath(filePath);
      removeSecretPath(
        resolveSecretPath(secretsDir, extractReceiptIdFromPath(filePath))
      );
      continue;
    }
    if (isExpired(receipt, now)) {
      removeReceiptPath(filePath);
      removeSecretPath(resolveSecretPath(secretsDir, receipt.id));
      if (explicitPath) {
        throw new ConsentReceiptError(
          "expired",
          `Consent receipt "${receipt.id}" expired at ${receipt.expiresAt}.`
        );
      }
      continue;
    }
    const secretPath = resolveSecretPath(secretsDir, receipt.id);
    if (!fs24.existsSync(secretPath)) {
      if (explicitPath) {
        throw new ConsentReceiptError(
          "missing",
          `Consent secret "${receipt.id}" was not found.`
        );
      }
      continue;
    }
    let receiptPrepared = false;
    let cleanupSecretOnFailure = true;
    try {
      assertUntamperedConsentPath(receiptStats, receipt, "receipt");
      const secretStats = fs24.statSync(secretPath);
      assertUntamperedConsentPath(secretStats, receipt, "secret");
      const pairToken = readUtf8PreservingTimes(secretPath).trim();
      if (!pairToken) {
        throw new ConsentReceiptError(
          "invalid",
          `Consent secret "${receipt.id}" was empty.`
        );
      }
      const expectedHash = hashPairTokenBinding({
        pairToken,
        hostId,
        conversationId,
        ownerClientId
      });
      if (receipt.conversationId !== conversationId || receipt.ownerClientId !== ownerClientId || receipt.hostId !== hostId || receipt.pairTokenHash !== expectedHash) {
        if (explicitPath) {
          throw new ConsentReceiptError(
            "binding-mismatch",
            `Consent receipt "${receipt.id}" did not match the requested conversation binding.`
          );
        }
        continue;
      }
      if (!scopeSatisfies(receipt.scope, requiredScope)) {
        deferredError = new ConsentReceiptError(
          "scope-mismatch",
          `Consent receipt "${receipt.id}" grants ${receipt.scope}, not ${requiredScope}.`
        );
        if (explicitPath) throw deferredError;
        continue;
      }
      if (method && receipt.allowedMethods.length > 0 && !receipt.allowedMethods.includes(method)) {
        deferredError = new ConsentReceiptError(
          "method-mismatch",
          `Consent receipt "${receipt.id}" does not allow method "${method}".`
        );
        if (explicitPath) throw deferredError;
        continue;
      }
      let reservedReceiptPath;
      try {
        assertPendingReservationAvailable(receipt.id);
        reservedReceiptPath = reserveReceiptPath(
          filePath,
          receipt,
          reservationOwnerId,
          now
        );
      } catch (error) {
        cleanupSecretOnFailure = false;
        throw error;
      }
      markPendingReservation(receipt.id);
      receiptPrepared = true;
      return {
        receipt,
        commit() {
          if (!receiptPrepared) {
            return;
          }
          receiptPrepared = false;
          try {
            fs24.rmSync(reservedReceiptPath, { force: false });
          } finally {
            clearPendingReservation(receipt.id);
            removeSecretPath(secretPath);
          }
        },
        abort() {
          if (!receiptPrepared) {
            return;
          }
          receiptPrepared = false;
          try {
            fs24.renameSync(reservedReceiptPath, filePath);
            writeActiveReceiptFile(filePath, receipt);
          } finally {
            clearPendingReservation(receipt.id);
          }
        }
      };
    } finally {
      if (!receiptPrepared && cleanupSecretOnFailure) {
        removeSecretPath(secretPath);
      }
    }
  }
  if (deferredError) {
    throw deferredError;
  }
  throw new ConsentReceiptError(
    "missing",
    explicitPath ? `Consent receipt "${options.consentRef}" was not found.` : "No matching consent receipt was found for the requested drive action."
  );
}

// src/transport/trusted-device-lease.ts
import * as fs25 from "fs";
import * as path24 from "path";
var TRUSTED_DEVICE_LEASES_DIRNAME = "devices";
function normalizeString2(value) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}
function normalizeArray(value) {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value.filter((item) => typeof item === "string").map((item) => item.trim()).filter(Boolean)
    )
  ].sort();
}
function normalizeScopeArray(value) {
  return normalizeArray(value).filter(
    (item) => item === "observe" || item === "suggest" || item === "drive"
  );
}
function normalizeComparable(value) {
  const normalized = normalizeString2(value);
  return normalized ? normalized.replace(/\\/g, "/").toLowerCase() : null;
}
function normalizeDate(value) {
  if (value instanceof Date) return value;
  if (typeof value === "string" || typeof value === "number") {
    return new Date(value);
  }
  return /* @__PURE__ */ new Date();
}
function parseTimestamp(value) {
  const timestamp = new Date(value).getTime();
  return Number.isNaN(timestamp) ? null : timestamp;
}
function fail(reason, message, lease = null, filePath = null) {
  return { ok: false, reason, message, lease, filePath };
}
function pass(lease, filePath) {
  return { ok: true, reason: null, message: null, lease, filePath };
}
function resolveTrustedDeviceLeasesDir(options) {
  const explicit = normalizeString2(options.devicesDir);
  if (explicit) return path24.resolve(explicit);
  const commsDir = normalizeString2(options.commsDir) ?? normalizeString2(process.env.TAP_COMMS_DIR);
  return commsDir ? path24.join(path24.resolve(commsDir), TRUSTED_DEVICE_LEASES_DIRNAME) : null;
}
function parseTrustedDeviceLease(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value;
  const deviceId = typeof record.deviceId === "string" ? normalizeString2(record.deviceId) : null;
  const hostId = typeof record.hostId === "string" ? normalizeString2(record.hostId) : null;
  const issuedAt = typeof record.issuedAt === "string" ? normalizeString2(record.issuedAt) : null;
  const expiresAt = typeof record.expiresAt === "string" ? normalizeString2(record.expiresAt) : null;
  const publicKeyHash = typeof record.publicKeyHash === "string" ? normalizeString2(record.publicKeyHash) : null;
  const tokenHash = typeof record.tokenHash === "string" ? normalizeString2(record.tokenHash) : null;
  if (!deviceId || !hostId || !issuedAt || !expiresAt) {
    return null;
  }
  if (!publicKeyHash && !tokenHash) {
    return null;
  }
  return {
    deviceId,
    hostId,
    label: typeof record.label === "string" ? normalizeString2(record.label) : null,
    publicKeyHash,
    tokenHash,
    operator: typeof record.operator === "string" ? normalizeString2(record.operator) : null,
    allowedScopes: normalizeScopeArray(record.allowedScopes),
    allowedTargets: normalizeArray(record.allowedTargets),
    issuedAt,
    expiresAt,
    lastSeenAt: typeof record.lastSeenAt === "string" ? normalizeString2(record.lastSeenAt) : null,
    revokedAt: typeof record.revokedAt === "string" ? normalizeString2(record.revokedAt) : null
  };
}
function loadTrustedDeviceLease(filePath) {
  try {
    return parseTrustedDeviceLease(
      JSON.parse(fs25.readFileSync(filePath, "utf-8"))
    );
  } catch {
    return null;
  }
}
function listLeaseFiles(devicesDir) {
  try {
    return fs25.readdirSync(devicesDir, { withFileTypes: true }).filter((entry) => entry.isFile() && entry.name.endsWith(".json")).map((entry) => path24.join(devicesDir, entry.name)).sort();
  } catch {
    return [];
  }
}
function matchesLease(lease, options) {
  const expectedDeviceId = normalizeComparable(options.deviceId);
  const expectedHostId = normalizeComparable(options.hostId);
  const deviceMatches = expectedDeviceId ? normalizeComparable(lease.deviceId) === expectedDeviceId : true;
  const hostMatches = expectedHostId ? normalizeComparable(lease.hostId) === expectedHostId : true;
  return Boolean(
    (expectedDeviceId || expectedHostId) && deviceMatches && hostMatches
  );
}
function validateLease(lease, filePath, options) {
  const nowMs = options.now.getTime();
  const issuedAtMs = parseTimestamp(lease.issuedAt);
  const expiresAtMs = parseTimestamp(lease.expiresAt);
  if (Number.isNaN(nowMs) || issuedAtMs === null || expiresAtMs === null || lease.revokedAt && parseTimestamp(lease.revokedAt) === null) {
    return fail(
      "invalid",
      "Trusted device lease has invalid timestamps.",
      lease,
      filePath
    );
  }
  if (issuedAtMs > nowMs) {
    return fail(
      "not-yet-valid",
      "Trusted device lease is not valid yet.",
      lease,
      filePath
    );
  }
  if (expiresAtMs <= nowMs) {
    return fail("expired", "Trusted device lease is expired.", lease, filePath);
  }
  if (lease.revokedAt) {
    return fail("revoked", "Trusted device lease is revoked.", lease, filePath);
  }
  if (!lease.allowedScopes.includes(options.scope)) {
    return fail(
      "scope-not-allowed",
      `Trusted device lease does not allow ${options.scope}.`,
      lease,
      filePath
    );
  }
  if (!lease.allowedTargets.includes(options.target)) {
    return fail(
      "target-not-allowed",
      `Trusted device lease does not allow target ${options.target}.`,
      lease,
      filePath
    );
  }
  return pass(lease, filePath);
}
function checkTrustedDeviceLease(options) {
  const devicesDir = resolveTrustedDeviceLeasesDir(options);
  if (!devicesDir) {
    return fail(
      "registry-unavailable",
      "Trusted device lease registry is unavailable."
    );
  }
  const deviceId = normalizeString2(options.deviceId);
  const hostId = normalizeString2(options.hostId);
  if (!deviceId && !hostId) {
    return fail(
      "missing",
      "Trusted device lease check requires deviceId or hostId."
    );
  }
  let invalidMatch = null;
  for (const filePath of listLeaseFiles(devicesDir)) {
    const lease = loadTrustedDeviceLease(filePath);
    if (!lease) continue;
    if (!matchesLease(lease, { deviceId, hostId })) continue;
    const checked = validateLease(lease, filePath, {
      scope: options.scope ?? "drive",
      target: normalizeString2(options.target) ?? "self-owned",
      now: normalizeDate(options.now)
    });
    if (checked.ok) return checked;
    invalidMatch ??= checked;
  }
  return invalidMatch ?? fail("missing", "No matching trusted device lease was found.");
}
function checkTrustedDeviceLeaseGate(options) {
  const scope = options.scope ?? "drive";
  const target = normalizeString2(options.target) ?? "self-owned";
  const requester = checkTrustedDeviceLease({
    commsDir: options.commsDir,
    devicesDir: options.devicesDir,
    deviceId: options.requesterDeviceId,
    hostId: options.requesterHostId,
    scope,
    target,
    now: options.now
  });
  if (!requester.ok) {
    return {
      ok: false,
      reason: requester.reason,
      message: `Requester ${requester.message ?? "trusted device lease check failed"}`,
      requester,
      target: null
    };
  }
  const requesterHostId = normalizeComparable(requester.lease?.hostId);
  const targetHostId = normalizeComparable(options.targetHostId);
  if (!targetHostId || targetHostId === requesterHostId) {
    return {
      ok: true,
      reason: null,
      message: null,
      requester,
      target: null
    };
  }
  const targetCheck = checkTrustedDeviceLease({
    commsDir: options.commsDir,
    devicesDir: options.devicesDir,
    deviceId: options.targetDeviceId,
    hostId: options.targetHostId,
    scope,
    target,
    now: options.now
  });
  if (!targetCheck.ok) {
    return {
      ok: false,
      reason: targetCheck.reason,
      message: `Target ${targetCheck.message ?? "trusted device lease check failed"}`,
      requester,
      target: targetCheck
    };
  }
  return {
    ok: true,
    reason: null,
    message: null,
    requester,
    target: targetCheck
  };
}

// src/transport/file-observe-transport.ts
import * as fs26 from "fs";
import * as path25 from "path";

// src/routing/receive-transports.ts
import { basename as basename3 } from "path";
var CODEX_BRIDGE_STATE_DIR_PREFIX = "codex-app-server-bridge-";
var VALID_RECEIVE_TRANSPORTS = [
  "mcp-channel",
  "consent-drive",
  "polling"
];
function normalizeString3(value) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}
function normalizeRuntimeToken(value) {
  const normalized = normalizeString3(value)?.replace(/-/g, "_").toLowerCase();
  return normalized || null;
}
function isCodexLikeToken(value) {
  const normalized = normalizeRuntimeToken(value);
  return normalized === "codex" || Boolean(normalized?.startsWith("codex_"));
}
function isCodexRuntimeStateDir(value) {
  const normalized = normalizeString3(value);
  if (!normalized) return false;
  return basename3(normalized).startsWith(CODEX_BRIDGE_STATE_DIR_PREFIX);
}
function isCodexMcpClient(value) {
  const normalized = normalizeRuntimeToken(value);
  return normalized === "codex_mcp_client";
}
function normalizeReceiveTransports(values) {
  const transports = [];
  for (const value of values ?? []) {
    if (!VALID_RECEIVE_TRANSPORTS.includes(value)) {
      continue;
    }
    const transport = value;
    if (transports.includes(transport)) {
      continue;
    }
    transports.push(transport);
  }
  return transports;
}
function inferReceiveTransports(hints = {}) {
  if (normalizeRuntimeToken(hints.runtimeName) === "codex" || isCodexLikeToken(hints.instanceId) || isCodexLikeToken(hints.bridgeInstanceId) || isCodexLikeToken(hints.agentId) || isCodexRuntimeStateDir(hints.runtimeStateDir)) {
    return ["consent-drive"];
  }
  if (isCodexMcpClient(hints.mcpClientName)) {
    return ["polling"];
  }
  return ["mcp-channel"];
}
function prefersConsentDrive(values) {
  return normalizeReceiveTransports(values).includes("consent-drive");
}
function canUseConsentDriveForAddress(options) {
  const address = options.address;
  if (!address?.conversationId?.trim() || !address.ownerClientId?.trim()) {
    return false;
  }
  const localHostId = normalizeString3(options.localHostId);
  const targetHostId = normalizeString3(address.hostId);
  if (!localHostId || !targetHostId) {
    return true;
  }
  return localHostId.toLowerCase() === targetHostId.toLowerCase();
}

// src/transport/file-observe-transport.ts
function resolveHostId2(explicitHostId) {
  const normalizedExplicit = explicitHostId?.trim();
  if (normalizedExplicit) return normalizedExplicit;
  const computerName = process.env.COMPUTERNAME?.trim();
  if (computerName) return computerName;
  const hostName = process.env.HOSTNAME?.trim();
  if (hostName) return hostName;
  return null;
}
function normalizeAddress(heartbeat, hostId) {
  return {
    hostId: heartbeat.address?.hostId ?? hostId,
    clientId: heartbeat.address?.clientId ?? heartbeat.instanceId?.trim() ?? null,
    conversationId: heartbeat.address?.conversationId ?? null,
    ownerClientId: heartbeat.address?.ownerClientId ?? null
  };
}
function compareById(a, b) {
  return a.id.localeCompare(b.id);
}
var FileObserveTransport = class {
  kind = "file-observe";
  heartbeatsPath;
  hostId;
  watchIntervalMs;
  listeners = /* @__PURE__ */ new Set();
  watching = false;
  snapshot = {
    transport: this.kind,
    connected: false,
    connectedAt: null,
    agents: [],
    conversations: []
  };
  constructor(options) {
    this.heartbeatsPath = path25.join(options.commsDir, "heartbeats.json");
    this.hostId = resolveHostId2(options.hostId);
    this.watchIntervalMs = options.watchIntervalMs ?? 500;
  }
  async connect() {
    const connectedAt = (/* @__PURE__ */ new Date()).toISOString();
    this.snapshot = {
      ...this.buildSnapshot(),
      connected: true,
      connectedAt
    };
    this.startWatching();
    this.emit({
      kind: "transport-connected",
      receivedAt: connectedAt,
      method: null,
      sourceAddress: {
        hostId: this.hostId,
        clientId: null,
        conversationId: null,
        ownerClientId: null
      },
      payload: { heartbeatsPath: this.heartbeatsPath },
      snapshot: this.snapshot
    });
    return this.snapshot;
  }
  async disconnect() {
    this.stopWatching();
    const disconnectedAt = (/* @__PURE__ */ new Date()).toISOString();
    this.snapshot = {
      ...this.snapshot,
      connected: false,
      connectedAt: null
    };
    this.emit({
      kind: "transport-disconnected",
      receivedAt: disconnectedAt,
      method: null,
      sourceAddress: {
        hostId: this.hostId,
        clientId: null,
        conversationId: null,
        ownerClientId: null
      },
      payload: null,
      snapshot: this.snapshot
    });
  }
  getSnapshot() {
    return this.snapshot;
  }
  subscribe(listener) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  handleHeartbeatsChanged = (current, previous) => {
    if (!this.snapshot.connected) return;
    if (current.mtimeMs === previous.mtimeMs && current.ctimeMs === previous.ctimeMs && current.size === previous.size) {
      return;
    }
    const nextSnapshot = {
      ...this.buildSnapshot(),
      connected: true,
      connectedAt: this.snapshot.connectedAt
    };
    const previousState = JSON.stringify({
      agents: this.snapshot.agents,
      conversations: this.snapshot.conversations
    });
    const nextState = JSON.stringify({
      agents: nextSnapshot.agents,
      conversations: nextSnapshot.conversations
    });
    if (previousState === nextState) {
      this.snapshot = nextSnapshot;
      return;
    }
    this.snapshot = nextSnapshot;
    this.emit({
      kind: "raw",
      receivedAt: (/* @__PURE__ */ new Date()).toISOString(),
      method: "heartbeats-changed",
      sourceAddress: {
        hostId: this.hostId,
        clientId: null,
        conversationId: null,
        ownerClientId: null
      },
      payload: { heartbeatsPath: this.heartbeatsPath },
      snapshot: this.snapshot
    });
  };
  buildSnapshot() {
    const store = this.loadHeartbeats();
    const agents = [];
    const conversations = /* @__PURE__ */ new Map();
    for (const [heartbeatKey, heartbeat] of Object.entries(store)) {
      const id = heartbeat.id?.trim() || heartbeatKey;
      const address = normalizeAddress(heartbeat, this.hostId);
      agents.push({
        id,
        name: heartbeat.agent?.trim() || null,
        address,
        metadata: {
          status: heartbeat.status ?? null,
          source: heartbeat.source ?? null,
          lastActivity: heartbeat.lastActivity ?? heartbeat.timestamp ?? null,
          receiveTransports: normalizeReceiveTransports(
            heartbeat.receiveTransports
          )
        }
      });
      if (!address.conversationId) continue;
      const existingConversation = conversations.get(address.conversationId);
      const participantIds = new Set(
        Array.isArray(existingConversation?.metadata.participantClientIds) ? existingConversation?.metadata.participantClientIds : []
      );
      participantIds.add(address.clientId ?? id);
      conversations.set(address.conversationId, {
        id: address.conversationId,
        address: {
          hostId: address.hostId,
          clientId: address.clientId,
          conversationId: address.conversationId,
          ownerClientId: address.ownerClientId ?? existingConversation?.address.ownerClientId ?? null
        },
        metadata: {
          participantClientIds: [...participantIds].sort(),
          lastActivity: heartbeat.lastActivity ?? heartbeat.timestamp ?? existingConversation?.metadata.lastActivity ?? null
        }
      });
    }
    return {
      transport: this.kind,
      connected: this.snapshot.connected,
      connectedAt: this.snapshot.connectedAt,
      agents: agents.sort(compareById),
      conversations: [...conversations.values()].sort(compareById)
    };
  }
  startWatching() {
    if (this.watching) return;
    fs26.watchFile(
      this.heartbeatsPath,
      { interval: this.watchIntervalMs },
      this.handleHeartbeatsChanged
    );
    this.watching = true;
  }
  stopWatching() {
    if (!this.watching) return;
    fs26.unwatchFile(this.heartbeatsPath, this.handleHeartbeatsChanged);
    this.watching = false;
  }
  loadHeartbeats() {
    if (!fs26.existsSync(this.heartbeatsPath)) {
      return {};
    }
    try {
      return JSON.parse(
        fs26.readFileSync(this.heartbeatsPath, "utf-8")
      );
    } catch {
      return {};
    }
  }
  emit(event) {
    for (const listener of this.listeners) {
      void listener(event);
    }
  }
};
function createFileObserveTransport(options) {
  return new FileObserveTransport(options);
}

// src/transport/experimental/codex-ipc-observe.ts
import * as net3 from "net";
import { randomUUID as randomUUID3 } from "crypto";

// src/transport/experimental/codex-ipc-endpoint.ts
import { tmpdir as tmpdir4 } from "os";
var DEFAULT_CODEX_IPC_WINDOWS_PIPE_PATH = String.raw`\\.\pipe\codex-ipc`;
function normalizeDirectory(value) {
  return value.replace(/[\\/]+$/, "");
}
function resolveCodexIpcPath(options = {}) {
  const env = options.env ?? process.env;
  const explicit = env.TAP_CODEX_IPC_PATH?.trim();
  if (explicit) return explicit;
  const platform = options.platform ?? process.platform;
  if (platform === "win32") return DEFAULT_CODEX_IPC_WINDOWS_PIPE_PATH;
  if (platform === "darwin") {
    const baseTmp = normalizeDirectory(
      options.tmpDir?.trim() || env.TMPDIR?.trim() || tmpdir4()
    );
    const uid = typeof options.uid === "number" && Number.isFinite(options.uid) ? options.uid : typeof process.getuid === "function" ? process.getuid() : null;
    if (uid == null) {
      throw new Error("Cannot resolve macOS Codex IPC socket without a uid.");
    }
    return `${baseTmp}/codex-ipc/ipc-${uid}.sock`;
  }
  return DEFAULT_CODEX_IPC_WINDOWS_PIPE_PATH;
}
function isCodexIpcDefaultSupported(platform = process.platform) {
  return platform === "win32" || platform === "darwin";
}

// src/transport/experimental/codex-ipc-observe.ts
var MAX_FRAME_BYTES = 256 * 1024 * 1024;
var DEFAULT_REQUEST_TIMEOUT_MS = 5e3;
var DEFAULT_TARGETED_REQUEST_VERSION = 1;
var DEFAULT_CODEX_IPC_PIPE_PATH = DEFAULT_CODEX_IPC_WINDOWS_PIPE_PATH;
function isTapIpcTraceEnabled() {
  const value = process.env.TAP_IPC_TRACE?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes" || value === "on";
}
function formatTraceValue(value) {
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  if (value === null) {
    return "null";
  }
  return JSON.stringify(value);
}
function formatTraceContext(context) {
  if (!context) return "";
  const entries = Object.entries(context).filter(
    ([, value]) => typeof value !== "undefined"
  );
  if (entries.length === 0) return "";
  return ` ${entries.map(([key, value]) => `${key}=${formatTraceValue(value)}`).join(" ")}`;
}
function resolveHostId3(explicitHostId) {
  const normalizedExplicit = explicitHostId?.trim();
  if (normalizedExplicit) return normalizedExplicit;
  const computerName = process.env.COMPUTERNAME?.trim();
  if (computerName) return computerName;
  const hostName = process.env.HOSTNAME?.trim();
  if (hostName) return hostName;
  return null;
}
function asRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value;
}
function asString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
function getStringField(record, ...keys) {
  if (!record) return null;
  for (const key of keys) {
    const value = asString(record[key]);
    if (value) return value;
  }
  return null;
}
function normalizeTransportAddress(hostId, clientId, conversationId, ownerClientId) {
  return {
    hostId,
    clientId,
    conversationId,
    ownerClientId
  };
}
function extractConversationId(params) {
  return getStringField(params, "conversationId", "threadId") ?? getStringField(asRecord(params?.change), "conversationId", "threadId") ?? getStringField(asRecord(params?.thread), "id");
}
function listRecordKeys(value) {
  if (!value) return null;
  return Object.keys(value);
}
function encodeCodexIpcFrame(message) {
  const json = JSON.stringify(message);
  const payload = Buffer.from(json, "utf-8");
  const frame = Buffer.allocUnsafe(4 + payload.length);
  frame.writeUInt32LE(payload.length, 0);
  payload.copy(frame, 4);
  return frame;
}
function decodeCodexIpcFrames(buffer) {
  const messages = [];
  let offset = 0;
  while (offset + 4 <= buffer.length) {
    const frameLength = buffer.readUInt32LE(offset);
    if (frameLength > MAX_FRAME_BYTES) {
      throw new Error(
        `Codex IPC frame exceeds max size (${frameLength} bytes > ${MAX_FRAME_BYTES})`
      );
    }
    if (offset + 4 + frameLength > buffer.length) break;
    const json = buffer.toString("utf-8", offset + 4, offset + 4 + frameLength);
    messages.push(JSON.parse(json));
    offset += 4 + frameLength;
  }
  return {
    messages,
    remainder: buffer.subarray(offset)
  };
}
var ExperimentalCodexIpcObserveTransport = class {
  constructor(options = {}) {
    this.options = options;
    this.pipePath = options.pipePath ?? resolveCodexIpcPath();
    this.hostId = resolveHostId3(options.hostId);
    this.clientType = options.clientType ?? "tap-observe";
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  }
  options;
  kind = "experimental-codex-ipc-observe";
  pipePath;
  hostId;
  clientType;
  requestTimeoutMs;
  listeners = /* @__PURE__ */ new Set();
  agents = /* @__PURE__ */ new Map();
  conversations = /* @__PURE__ */ new Map();
  pendingRequests = /* @__PURE__ */ new Map();
  socket = null;
  remainder = Buffer.alloc(0);
  connectedAt = null;
  ownClientId = null;
  snapshot = {
    transport: this.kind,
    connected: false,
    connectedAt: null,
    agents: [],
    conversations: []
  };
  handleData = (...args) => {
    const [chunk] = args;
    if (!Buffer.isBuffer(chunk)) {
      return;
    }
    this.remainder = Buffer.concat([this.remainder, chunk]);
    const decoded = decodeCodexIpcFrames(this.remainder);
    this.remainder = decoded.remainder;
    for (const message of decoded.messages) {
      this.handleMessage(message);
    }
  };
  handleError = (...args) => {
    const [error] = args;
    this.rejectPendingRequests(
      error instanceof Error ? error : new Error(String(error ?? "Codex IPC transport error"))
    );
  };
  handleClose = () => {
    this.rejectPendingRequests(new Error("Codex IPC transport closed"));
    this.remainder = Buffer.alloc(0);
    this.emitDisconnected(null);
    this.detachSocket();
  };
  async connect() {
    if (this.socket) {
      await this.disconnect();
    }
    this.trace("connect:start", {
      pipePath: this.pipePath,
      clientType: this.clientType,
      hostId: this.hostId
    });
    const socket = this.options.socketFactory?.(this.pipePath) ?? net3.createConnection({
      path: this.pipePath
    });
    this.socket = socket;
    this.attachSocket(socket);
    await this.waitForConnect(socket);
    socket.setNoDelay?.(true);
    this.trace("connect:open", {
      pipePath: this.pipePath
    });
    const response = await this.sendRequest("initialize", {
      clientType: this.clientType
    });
    const result = asRecord(response.result);
    const clientId = getStringField(result, "clientId");
    if (!clientId) {
      throw new Error("Codex IPC initialize response did not include clientId");
    }
    this.ownClientId = clientId;
    this.connectedAt = (/* @__PURE__ */ new Date()).toISOString();
    this.snapshot = this.buildSnapshot(true);
    this.trace("connect:initialized", {
      clientId,
      connectedAt: this.connectedAt,
      handledByClientId: response.handledByClientId ?? null,
      resultType: response.resultType ?? null,
      resultKeys: listRecordKeys(result)
    });
    this.emit({
      kind: "transport-connected",
      receivedAt: this.connectedAt,
      method: "initialize",
      sourceAddress: normalizeTransportAddress(
        this.hostId,
        this.ownClientId,
        null,
        null
      ),
      payload: response,
      snapshot: this.snapshot
    });
    return this.snapshot;
  }
  async disconnect() {
    if (!this.socket) return;
    const socket = this.socket;
    this.detachSocket();
    this.rejectPendingRequests(new Error("Codex IPC transport disconnected"));
    this.remainder = Buffer.alloc(0);
    this.emitDisconnected({ reason: "disconnect" });
    socket.end();
    socket.destroy();
  }
  getSnapshot() {
    return this.snapshot;
  }
  subscribe(listener) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  attachSocket(socket) {
    socket.on("data", this.handleData);
    socket.on("error", this.handleError);
    socket.on("close", this.handleClose);
  }
  emitDisconnected(payload) {
    const receivedAt = (/* @__PURE__ */ new Date()).toISOString();
    this.connectedAt = null;
    this.snapshot = this.buildSnapshot(false);
    this.emit({
      kind: "transport-disconnected",
      receivedAt,
      method: null,
      sourceAddress: normalizeTransportAddress(
        this.hostId,
        this.ownClientId,
        null,
        null
      ),
      payload,
      snapshot: this.snapshot
    });
  }
  detachSocket() {
    if (!this.socket) return;
    this.socket.removeListener("data", this.handleData);
    this.socket.removeListener("error", this.handleError);
    this.socket.removeListener("close", this.handleClose);
    this.socket = null;
  }
  async waitForConnect(socket) {
    await new Promise((resolve21, reject) => {
      const cleanup = () => {
        clearTimeout(timeout);
        socket.removeListener("connect", onConnect);
        socket.removeListener("error", onError);
      };
      const onConnect = () => {
        cleanup();
        resolve21();
      };
      const onError = (...args) => {
        const [error] = args;
        cleanup();
        reject(
          error instanceof Error ? error : new Error(String(error ?? "Codex IPC connection failed"))
        );
      };
      const timeout = setTimeout(() => {
        cleanup();
        reject(
          new Error(
            `Timed out connecting to Codex IPC transport at ${this.pipePath}`
          )
        );
      }, this.requestTimeoutMs);
      socket.on("connect", onConnect);
      socket.on("error", onError);
    });
  }
  getHostId() {
    return this.hostId;
  }
  getOwnClientId() {
    return this.ownClientId;
  }
  trace(message, context) {
    if (!isTapIpcTraceEnabled()) {
      return;
    }
    const timestamp = (/* @__PURE__ */ new Date()).toISOString().replace("T", " ").replace("Z", " UTC");
    console.log(
      `[${timestamp}] TAP_IPC_TRACE [${this.kind}] ${message}${formatTraceContext(context)}`
    );
  }
  resolveRequestVersion(_method, targetClientId) {
    if (this.options.protocolVersion !== null) {
      const configuredVersion = this.options.protocolVersion;
      if (typeof configuredVersion !== "undefined") {
        return configuredVersion;
      }
    }
    if (targetClientId?.trim()) {
      return DEFAULT_TARGETED_REQUEST_VERSION;
    }
    return null;
  }
  async sendRequest(method, params, targetClientId) {
    if (!this.socket) {
      throw new Error("Codex IPC observe transport is not connected");
    }
    const requestId = randomUUID3();
    const message = {
      type: "request",
      requestId,
      method,
      params
    };
    if (this.ownClientId) {
      message.sourceClientId = this.ownClientId;
    }
    const requestVersion = this.resolveRequestVersion(method, targetClientId);
    if (requestVersion !== null) {
      message.version = requestVersion;
    }
    if (targetClientId) {
      message.targetClientId = targetClientId;
    }
    this.trace("request:send", {
      requestId,
      method,
      targetClientId: targetClientId ?? null,
      version: message.version ?? null,
      conversationId: extractConversationId(params ?? null),
      paramKeys: listRecordKeys(params ?? null)
    });
    const promise = new Promise((resolve21, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(
          new Error(
            `Codex IPC request "${method}" timed out after ${this.requestTimeoutMs}ms`
          )
        );
      }, this.requestTimeoutMs);
      this.pendingRequests.set(requestId, { resolve: resolve21, reject, timeout });
    });
    this.socket.write(encodeCodexIpcFrame(message));
    return promise;
  }
  handleMessage(message) {
    if (message.type === "response") {
      this.handleResponse(message);
      return;
    }
    if (message.type === "broadcast") {
      this.handleBroadcast(message);
    }
  }
  handleResponse(message) {
    const requestId = asString(message.requestId);
    if (!requestId) return;
    const pending = this.pendingRequests.get(requestId);
    if (!pending) return;
    clearTimeout(pending.timeout);
    this.pendingRequests.delete(requestId);
    this.trace("response:recv", {
      requestId,
      method: message.method ?? null,
      resultType: message.resultType ?? null,
      handledByClientId: message.handledByClientId ?? null,
      hasError: message.error != null,
      hasResult: typeof message.result !== "undefined"
    });
    if (message.resultType === "error") {
      pending.reject(
        new Error(
          `Codex IPC request failed: ${JSON.stringify(message.error ?? {})}`
        )
      );
      return;
    }
    pending.resolve(message);
  }
  handleBroadcast(message) {
    const method = message.method ?? null;
    const params = asRecord(message.params);
    const sourceClientId = asString(message.sourceClientId);
    const receivedAt = (/* @__PURE__ */ new Date()).toISOString();
    this.trace("broadcast:recv", {
      method,
      sourceClientId,
      conversationId: extractConversationId(params),
      version: message.version ?? null
    });
    if (method === "client-status-changed") {
      const clientId = getStringField(params, "clientId");
      if (clientId) {
        this.upsertAgent(clientId, {
          name: getStringField(params, "clientType"),
          metadata: {
            status: getStringField(params, "status"),
            clientType: getStringField(params, "clientType")
          }
        });
        this.snapshot = this.buildSnapshot(true);
        this.emit({
          kind: "agent-status",
          receivedAt,
          method,
          sourceAddress: normalizeTransportAddress(
            this.hostId,
            clientId,
            null,
            null
          ),
          payload: message,
          snapshot: this.snapshot
        });
      }
      return;
    }
    if (method === "thread-stream-state-changed") {
      const conversationId = extractConversationId(params);
      if (conversationId) {
        const ownerClientId = sourceClientId;
        if (ownerClientId) {
          this.upsertAgent(ownerClientId, {
            name: null,
            metadata: {}
          });
        }
        this.conversations.set(conversationId, {
          id: conversationId,
          address: normalizeTransportAddress(
            this.hostId,
            ownerClientId,
            conversationId,
            ownerClientId
          ),
          metadata: {
            change: params?.change ?? null,
            lastMethod: method,
            sourceClientId: ownerClientId
          }
        });
        this.snapshot = this.buildSnapshot(true);
        this.emit({
          kind: "conversation-state",
          receivedAt,
          method,
          sourceAddress: normalizeTransportAddress(
            this.hostId,
            ownerClientId,
            conversationId,
            ownerClientId
          ),
          payload: message,
          snapshot: this.snapshot
        });
        return;
      }
    }
    this.snapshot = this.buildSnapshot(true);
    this.emit({
      kind: "raw",
      receivedAt,
      method,
      sourceAddress: normalizeTransportAddress(
        this.hostId,
        sourceClientId,
        extractConversationId(params),
        sourceClientId
      ),
      payload: message,
      snapshot: this.snapshot
    });
  }
  upsertAgent(clientId, update) {
    const existing = this.agents.get(clientId);
    this.agents.set(clientId, {
      id: clientId,
      name: update.name ?? existing?.name ?? null,
      address: normalizeTransportAddress(this.hostId, clientId, null, null),
      metadata: {
        ...existing?.metadata ?? {},
        ...update.metadata
      }
    });
  }
  buildSnapshot(connected) {
    return {
      transport: this.kind,
      connected,
      connectedAt: connected ? this.connectedAt : null,
      agents: [...this.agents.values()].sort(
        (a, b) => a.id.localeCompare(b.id)
      ),
      conversations: [...this.conversations.values()].sort(
        (a, b) => a.id.localeCompare(b.id)
      )
    };
  }
  rejectPendingRequests(error) {
    for (const [requestId, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(error);
      this.pendingRequests.delete(requestId);
    }
  }
  emit(event) {
    for (const listener of this.listeners) {
      void listener(event);
    }
  }
};
function createExperimentalCodexIpcObserveTransport(options = {}) {
  return new ExperimentalCodexIpcObserveTransport(options);
}

// src/receiver/codex-cli-polling-receiver.ts
import * as fs28 from "fs";
import * as path27 from "path";

// src/routing/tap-message-prompt.ts
function isValidReplyTarget(value) {
  const normalized = value?.trim().toLowerCase();
  return Boolean(
    normalized && normalized !== "unknown" && normalized !== "unnamed" && normalized !== "null" && normalized !== "undefined" && normalized !== "?"
  );
}
function resolveReplyTarget(options) {
  if (isValidReplyTarget(options.returnAddress?.routingAddress)) {
    return options.returnAddress.routingAddress.trim();
  }
  if (isValidReplyTarget(options.replyTo)) {
    return options.replyTo.trim();
  }
  return null;
}
function formatReturnRoute(options) {
  const address = options.returnAddress;
  const parts = [];
  if (isValidReplyTarget(address?.routingAddress)) {
    parts.push(`routingAddress=${address.routingAddress.trim()}`);
  }
  if (address?.hostId?.trim()) parts.push(`hostId=${address.hostId.trim()}`);
  if (options.runtimeSurface?.trim()) {
    parts.push(`runtimeSurface=${options.runtimeSurface.trim()}`);
  }
  if (address?.clientId?.trim()) {
    parts.push(`clientId=${address.clientId.trim()}`);
  }
  if (address?.conversationId?.trim()) {
    parts.push(`conversationId=${address.conversationId.trim()}`);
  }
  if (address?.ownerClientId?.trim()) {
    parts.push(`ownerClientId=${address.ownerClientId.trim()}`);
  }
  if (address?.surfaceInstanceId?.trim()) {
    parts.push(`surfaceInstanceId=${address.surfaceInstanceId.trim()}`);
  }
  return parts.length ? parts.join("; ") : null;
}
function createTapMessageViewModel(options) {
  const body = options.body.trim();
  const replyTo = resolveReplyTarget(options);
  const returnRoute = formatReturnRoute(options);
  return {
    agentName: options.agentName,
    sender: options.sender,
    recipient: options.recipient,
    subject: options.subject,
    body: body || "(empty)",
    replyTarget: replyTo,
    returnRoute,
    missingRoute: !replyTo,
    debugEnvelope: {
      fileName: options.fileName,
      returnAddress: options.returnAddress ?? null,
      runtimeSurface: options.runtimeSurface ?? null
    }
  };
}
function renderDebugEnvelope(viewModel) {
  const address = viewModel.debugEnvelope.returnAddress;
  const lines = [
    "",
    "Debug envelope:",
    `- file: ${viewModel.debugEnvelope.fileName}`
  ];
  if (viewModel.replyTarget) {
    lines.push(
      `- replyInstruction: Use tap_reply(to: "${viewModel.replyTarget}", subject: "<your-subject>", content: "<your-response>").`
    );
  } else {
    lines.push("- replyInstruction: unavailable; do not reply to unknown");
  }
  if (viewModel.returnRoute) {
    lines.push(`- returnRoute: ${viewModel.returnRoute}`);
  }
  if (viewModel.debugEnvelope.runtimeSurface?.trim()) {
    lines.push(
      `- runtimeSurface: ${viewModel.debugEnvelope.runtimeSurface.trim()}`
    );
  }
  if (address?.aliases?.length) {
    lines.push(`- aliases: ${address.aliases.join(", ")}`);
  }
  return lines;
}
function renderAgentMessagePrompt(viewModel, options = {}) {
  const replyInstructions = viewModel.replyTarget ? ["Reply:", `Reply available: ${viewModel.replyTarget}`] : [
    "Reply:",
    "Reply unavailable: no verified return route.",
    "No valid structured return route was provided; `unknown` is not a valid reply target.",
    "Preserve durable inbox evidence or ask tower/operator for a valid return route before replying.",
    "If the message is a review request, perform the review locally and report that the return route is missing.",
    'Do not reply to "unknown".'
  ];
  const lines = [
    `Tap message for ${viewModel.agentName}`,
    `From: ${viewModel.sender}`,
    `To: ${viewModel.recipient}`,
    `Subject: ${viewModel.subject}`,
    "",
    "Message:",
    viewModel.body,
    "",
    ...replyInstructions
  ];
  if (options.debugEnvelope) {
    lines.push(...renderDebugEnvelope(viewModel));
  }
  return lines.join("\n");
}
function buildTapMessagePrompt(options) {
  return renderAgentMessagePrompt(createTapMessageViewModel(options), {
    debugEnvelope: options.debugEnvelope
  });
}

// src/reviews/stale-meta.ts
import * as fs27 from "fs";
import * as path26 from "path";
function classifyReviewMetaForOperator(options) {
  const subject = options.subject.trim();
  const body = options.body;
  const prNumber = extractPrNumber(subject) ?? extractPrNumber(options.filename) ?? extractPrNumber(body);
  const forceReviewMeta = isProvenanceOnlyReviewMetaSubject(subject);
  if (!forceReviewMeta && isFormalReviewOutcome(subject, body)) {
    return {
      status: "new-formal-outcome",
      prNumber,
      reason: "formal review outcome remains operator-visible",
      terminalEvidencePath: null
    };
  }
  if (!isReviewMetaSubject(subject)) {
    return {
      status: "not-review-meta",
      prNumber,
      reason: "not a review-meta subject",
      terminalEvidencePath: null
    };
  }
  if (prNumber === null) {
    return {
      status: "ambiguous",
      prNumber,
      reason: "review-meta message has no PR number",
      terminalEvidencePath: null
    };
  }
  const terminalEvidencePath = findTerminalEvidence({
    root: options.root,
    prNumber,
    sourceRelativePath: options.sourceRelativePath ?? path26.posix.join("inbox", options.filename)
  });
  if (terminalEvidencePath) {
    return {
      status: "collapsed-stale-meta",
      prNumber,
      reason: "terminal review or merge evidence already exists",
      terminalEvidencePath
    };
  }
  return {
    status: "provenance-only",
    prNumber,
    reason: "review-meta message has no known terminal evidence yet",
    terminalEvidencePath: null
  };
}
function findTerminalEvidence(input) {
  const registered = findRegisteredReviewEvidence(input.root, input.prNumber);
  if (registered) return registered;
  const sourceRelativePath = normalizeRelativePath(input.sourceRelativePath);
  for (const filePath of listMarkdownFiles(input.root, [
    "inbox",
    "archive",
    "reviews"
  ])) {
    const relativePath = normalizeRelativePath(
      path26.relative(input.root, filePath)
    );
    if (relativePath === sourceRelativePath) continue;
    if (relativePath.startsWith("reviews/registered/")) continue;
    const raw = readIfExists(filePath);
    if (raw === null) continue;
    const { frontmatter, body } = splitFrontmatter(raw);
    const filename = path26.basename(filePath);
    const subject = frontmatter.subject ?? inferSubjectFromFilename(filename) ?? filename;
    const prNumber = extractPrNumber(subject) ?? extractPrNumber(filename) ?? extractPrNumber(body);
    if (prNumber !== input.prNumber) continue;
    if (isFormalReviewOutcome(subject, body) || isMergeTerminal(subject, body)) {
      return relativePath;
    }
  }
  return null;
}
function findRegisteredReviewEvidence(root, prNumber) {
  const directory = path26.join(root, "reviews", "registered", `pr${prNumber}`);
  if (!fs27.existsSync(directory)) return null;
  const candidates = listMarkdownFiles(directory, ["."]).map((filePath) => normalizeRelativePath(path26.relative(root, filePath))).sort();
  return candidates[0] ?? null;
}
function isReviewMetaSubject(subject) {
  const normalized = subject.toLowerCase();
  return isProvenanceOnlyReviewMetaSubject(subject) || normalized.includes("head-still-clean") || normalized.includes("merge-ready") || normalized.includes("merge-confirm") || normalized.includes("merge-result") || normalized.includes("merged") || /\b(stale|correction|status)\b/.test(normalized);
}
function isProvenanceOnlyReviewMetaSubject(subject) {
  const normalized = subject.toLowerCase();
  return normalized.includes("status-correction") || normalized.includes("current-head") || normalized.includes("superseded") || /\balready(?:[-_\s]+(?:reviewed|merged|handled|resolved|complete|closed))\b/.test(
    normalized
  ) || /\b(?:review|rereview)?[-_\s]*request[-_\s]+already\b/.test(normalized);
}
function isFormalReviewOutcome(subject, body) {
  const normalized = subject.toLowerCase();
  if (normalized.includes("review-request") || normalized.includes("rereview-request")) {
    return false;
  }
  const severity = summarizeSeverity(body);
  const hasSeverity = severity.hasNone || severity.p1 > 0 || severity.p2 > 0 || severity.p3 > 0;
  if (!hasSeverity) return false;
  return /\breview\b|\brereview\b|head-still-clean|merge-ready|closeout/.test(
    normalized
  );
}
function isMergeTerminal(subject, body) {
  return /\b(?:merged|merge-result|merge result|merge-ack|merge-confirmed|merge-confirmation)\b|mergedat|merge commit|merge 완료/i.test(
    subject
  ) || /\b(?:merged|merge-result|merge result|merge-ack|merge-confirmed|merge-confirmation)\b|mergedAt|merge commit|merge 완료/i.test(
    body
  );
}
function summarizeSeverity(body) {
  const reviewText = stripFencedCodeBlocks(body);
  if (/P1\/P2\/P3\s*[:：]\s*none/i.test(reviewText)) {
    return { p1: 0, p2: 0, p3: 0, hasNone: true };
  }
  const labels = [...reviewText.matchAll(/^\s*P([123])\b(?!\/)/gm)].map(
    (match) => `P${match[1]}`
  );
  return {
    p1: labels.filter((label) => label === "P1").length,
    p2: labels.filter((label) => label === "P2").length,
    p3: labels.filter((label) => label === "P3").length,
    hasNone: false
  };
}
function stripFencedCodeBlocks(text) {
  return text.replace(/```[\s\S]*?```/g, "");
}
function listMarkdownFiles(root, areas) {
  return areas.flatMap((area) => listMarkdownFilesUnder(path26.join(root, area)));
}
function listMarkdownFilesUnder(directory) {
  if (!fs27.existsSync(directory)) return [];
  return fs27.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filePath = path26.join(directory, entry.name);
    if (entry.isDirectory()) return listMarkdownFilesUnder(filePath);
    if (entry.isFile() && entry.name.endsWith(".md")) return [filePath];
    return [];
  });
}
function readIfExists(filePath) {
  try {
    return fs27.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}
function splitFrontmatter(raw) {
  if (!raw.startsWith("---\n")) return { frontmatter: {}, body: raw };
  const end = raw.indexOf("\n---", 4);
  if (end === -1) return { frontmatter: {}, body: raw };
  const frontmatter = {};
  for (const line of raw.slice(4, end).split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (match) {
      frontmatter[match[1]] = match[2].replace(/^["']|["']$/g, "").trim();
    }
  }
  return { frontmatter, body: raw.slice(end + 4) };
}
function inferSubjectFromFilename(filename) {
  return filename.match(/^\d{8}-[^-]+-[^-]+-(.+)\.md$/)?.[1] ?? null;
}
function extractPrNumber(text) {
  const match = text.match(/(?:PR\s*#|#|pr)(\d{3,5})/i);
  return match ? Number(match[1]) : null;
}
function normalizeRelativePath(relativePath) {
  return relativePath.split(path26.sep).join("/");
}

// src/receiver/codex-cli-polling-receiver.ts
var DEFAULT_LOOKBACK_MINUTES = 5;
var DEFAULT_LIMIT = 20;
var DEFAULT_INTERVAL_MS = 2e3;
function normalizeAddress2(value) {
  return value.trim().toLowerCase();
}
function unique(values) {
  const seen = /* @__PURE__ */ new Set();
  const result = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) continue;
    const key = normalizeAddress2(trimmed);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }
  return result;
}
function safeStateName(value) {
  return value.trim().replace(/[^\p{L}\p{N}._-]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 80);
}
function parseFrontmatter(content) {
  if (!content.startsWith("---")) return {};
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const fields = {};
  for (const line of match[1].split(/\r?\n/)) {
    const field = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!field) continue;
    fields[field[1].toLowerCase()] = field[2].trim().replace(/^["']|["']$/g, "");
  }
  return fields;
}
function parseHeaderFields(content) {
  const fields = {};
  for (const line of content.split(/\r?\n/).slice(0, 12)) {
    if (!line.trim()) break;
    const field = line.match(/^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/);
    if (!field) continue;
    fields[field[1].toLowerCase()] = field[2].trim();
  }
  return fields;
}
function parseStringArray(value) {
  if (!Array.isArray(value)) return void 0;
  const aliases = value.map((item) => typeof item === "string" ? item.trim() : "").filter(Boolean);
  return aliases.length ? aliases : void 0;
}
function parseAddressField(value) {
  if (!value?.trim()) return null;
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object") return null;
    return {
      routingAddress: typeof parsed.routingAddress === "string" ? parsed.routingAddress : null,
      hostId: typeof parsed.hostId === "string" ? parsed.hostId : null,
      clientId: typeof parsed.clientId === "string" ? parsed.clientId : null,
      conversationId: typeof parsed.conversationId === "string" ? parsed.conversationId : null,
      ownerClientId: typeof parsed.ownerClientId === "string" ? parsed.ownerClientId : null,
      surfaceInstanceId: typeof parsed.surfaceInstanceId === "string" ? parsed.surfaceInstanceId : null,
      aliases: parseStringArray(parsed.aliases)
    };
  } catch {
    return null;
  }
}
function stripMetadata(content) {
  if (content.startsWith("---")) {
    return content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").trim();
  }
  const lines = content.split(/\r?\n/);
  let index = 0;
  while (index < lines.length) {
    if (!lines[index].trim()) {
      index += 1;
      break;
    }
    if (!/^[A-Za-z][A-Za-z0-9_-]*:\s*/.test(lines[index])) break;
    index += 1;
  }
  return lines.slice(index).join("\n").trim();
}
function parseFilename(filename) {
  const stem = filename.replace(/\.md$/i, "");
  const parts = stem.split("-");
  if (parts.length < 4) return null;
  return {
    from: parts[1] || "unknown",
    to: parts[2] || "all",
    subject: parts.slice(3).join("-") || stem
  };
}
function splitAddressList(value) {
  return value.split(/[,\s]+/).map((part) => part.trim()).filter(Boolean);
}
function isForAgent(to, aliases) {
  const normalizedAliases = new Set(aliases.map(normalizeAddress2));
  for (const target of splitAddressList(to)) {
    const normalized = normalizeAddress2(target);
    if (normalized === "all" || normalized === "broadcast" || normalized === "\uC804\uCCB4" || normalizedAliases.has(normalized)) {
      return true;
    }
  }
  return false;
}
var GENERIC_RUNTIME_RECIPIENTS = /* @__PURE__ */ new Set([
  "codex",
  "reviewer",
  "implementer",
  "implementation"
]);
function isGenericRuntimeRecipient(value) {
  if (!value?.trim()) return false;
  return GENERIC_RUNTIME_RECIPIENTS.has(normalizeAddress2(value));
}
function structuredRecipientHints(parsed) {
  const hints = [
    parsed.toName,
    ...parsed.toAddress?.aliases ?? [],
    parsed.toAddress?.routingAddress
  ].filter((value) => Boolean(value?.trim()));
  const concrete = [];
  for (const hint of hints) {
    if (isGenericRuntimeRecipient(hint)) continue;
    if (concrete.some(
      (value) => normalizeAddress2(value) === normalizeAddress2(hint)
    )) {
      continue;
    }
    concrete.push(hint);
  }
  return concrete;
}
function isParsedMessageForAgent(parsed, aliases) {
  const concreteHints = structuredRecipientHints(parsed);
  if (concreteHints.length > 0) {
    if (concreteHints.some((hint) => isForAgent(hint, aliases))) {
      return true;
    }
    if (isGenericRuntimeRecipient(parsed.to)) {
      return false;
    }
  }
  return isForAgent(parsed.to, aliases);
}
function isOwnMessage(from, aliases) {
  const normalizedAliases = new Set(aliases.map(normalizeAddress2));
  return splitAddressList(from).some(
    (address) => normalizedAliases.has(normalizeAddress2(address))
  );
}
function parseMessage(filename, content) {
  const frontmatter = parseFrontmatter(content);
  const headers = parseHeaderFields(content);
  const parsedFilename = parseFilename(filename);
  const from = frontmatter.from ?? headers.from ?? parsedFilename?.from;
  const to = frontmatter.to ?? headers.to ?? parsedFilename?.to;
  const subject = frontmatter.subject ?? headers.subject ?? parsedFilename?.subject;
  if (!from || !to || !subject) return null;
  const messageId = frontmatter.message_id ?? frontmatter.messageid ?? headers["message-id"] ?? headers.message_id ?? null;
  return {
    from,
    fromName: frontmatter.from_name ?? headers.from_name ?? null,
    fromAddress: parseAddressField(
      frontmatter.from_address ?? headers.from_address
    ),
    to,
    toName: frontmatter.to_name ?? headers.to_name ?? null,
    toAddress: parseAddressField(frontmatter.to_address ?? headers.to_address),
    subject,
    messageId,
    displayContent: stripMetadata(content)
  };
}
function resolvePollingReceiverStatePath(options) {
  const receiverDir = path27.join(options.stateDir, "receiver");
  const rawName = options.stateName?.trim() || `codex-cli-${options.agent}`;
  const name = safeStateName(rawName) || "codex-cli";
  return path27.join(receiverDir, `${name}.json`);
}
function loadState2(statePath, options) {
  if (!options.resetCursor && fs28.existsSync(statePath)) {
    try {
      const parsed = JSON.parse(
        fs28.readFileSync(statePath, "utf8")
      );
      if (parsed.schemaVersion === 1 && parsed.joinedAt && parsed.processed) {
        return {
          schemaVersion: 1,
          agent: options.agent,
          aliases: options.aliases,
          createdAt: parsed.createdAt ?? options.now.toISOString(),
          joinedAt: parsed.joinedAt,
          processed: parsed.processed
        };
      }
    } catch {
    }
  }
  return {
    schemaVersion: 1,
    agent: options.agent,
    aliases: options.aliases,
    createdAt: options.now.toISOString(),
    joinedAt: options.now.toISOString(),
    processed: {}
  };
}
function saveState2(statePath, state) {
  fs28.mkdirSync(path27.dirname(statePath), { recursive: true });
  fs28.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}
`, "utf8");
}
function parseSinceMs(options, state) {
  if (options.all) return 0;
  const explicitSince = typeof options.since === "string" ? new Date(options.since).getTime() : 0;
  if (Number.isFinite(explicitSince) && explicitSince > 0) {
    return explicitSince;
  }
  if (typeof options.sinceMinutes === "number") {
    return options.now.getTime() - options.sinceMinutes * 6e4;
  }
  if (options.mode === "check") {
    return options.now.getTime() - DEFAULT_LOOKBACK_MINUTES * 6e4;
  }
  const joinedAtMs = new Date(state.joinedAt).getTime();
  return Number.isFinite(joinedAtMs) ? joinedAtMs : options.now.getTime();
}
function scanInbox(options, state, aliases) {
  const inboxDir = path27.join(options.commsDir, "inbox");
  const limit = Math.max(1, Math.min(100, options.limit ?? DEFAULT_LIMIT));
  const sinceMs = parseSinceMs(options, state);
  const items = [];
  const skipped = {
    old: 0,
    duplicate: 0,
    notForAgent: 0,
    own: 0,
    staleMeta: 0
  };
  const excludeDedupeKeys = new Set(options.excludeDedupeKeys ?? []);
  let scanned = 0;
  if (!fs28.existsSync(inboxDir)) {
    return {
      status: "idle",
      items,
      promptBundle: buildPromptBundle(options.agent, items, {
        debugEnvelope: options.debugEnvelope
      }),
      scanned,
      skipped
    };
  }
  const filenames = fs28.readdirSync(inboxDir).filter((filename) => filename.endsWith(".md")).sort();
  for (const filename of filenames) {
    const fullPath = path27.join(inboxDir, filename);
    let stat;
    try {
      stat = fs28.statSync(fullPath);
    } catch {
      continue;
    }
    if (!stat.isFile()) continue;
    scanned += 1;
    if (sinceMs && stat.mtimeMs < sinceMs) {
      skipped.old += 1;
      continue;
    }
    let content;
    try {
      content = fs28.readFileSync(fullPath, "utf8").replace(/^\uFEFF/, "");
    } catch {
      continue;
    }
    const parsed = parseMessage(filename, content);
    if (!parsed || !isParsedMessageForAgent(parsed, aliases)) {
      skipped.notForAgent += 1;
      continue;
    }
    if (!options.includeOwn && isOwnMessage(parsed.from, aliases)) {
      skipped.own += 1;
      continue;
    }
    const reviewMeta = classifyReviewMetaForOperator({
      root: options.commsDir,
      filename,
      subject: parsed.subject,
      body: parsed.displayContent,
      sourceRelativePath: `inbox/${filename}`
    });
    if (reviewMeta.status === "collapsed-stale-meta") {
      skipped.staleMeta += 1;
      continue;
    }
    const dedupeKey = parsed.messageId?.trim() || filename;
    if (excludeDedupeKeys.has(dedupeKey)) {
      skipped.duplicate += 1;
      continue;
    }
    if (state.processed[dedupeKey]) {
      skipped.duplicate += 1;
      continue;
    }
    const item = {
      source: "inbox",
      filename,
      path: `inbox/${filename}`,
      from: parsed.from,
      fromName: parsed.fromName,
      fromAddress: parsed.fromAddress,
      to: parsed.to,
      toName: parsed.toName,
      toAddress: parsed.toAddress,
      subject: parsed.subject,
      mtime: stat.mtime.toISOString(),
      dedupeKey,
      messageId: parsed.messageId
    };
    if (options.includeContent !== false) {
      item.content = parsed.displayContent;
    }
    items.push(item);
    if (items.length >= limit) break;
  }
  return {
    status: items.length > 0 ? "pending" : "idle",
    items,
    promptBundle: buildPromptBundle(options.agent, items, {
      debugEnvelope: options.debugEnvelope
    }),
    scanned,
    skipped
  };
}
function markProcessed(state, items, processedAt) {
  for (const item of items) {
    state.processed[item.dedupeKey] = {
      filename: item.filename,
      messageId: item.messageId,
      mtime: item.mtime,
      processedAt
    };
  }
}
function markPollingReceiverItemsProcessed(rawOptions) {
  const now = rawOptions.now ?? /* @__PURE__ */ new Date();
  const aliases = unique([
    rawOptions.agent,
    ...rawOptions.aliases ?? [],
    process.env.TAP_AGENT_ID ?? "",
    process.env.TAP_AGENT_NAME ?? ""
  ]);
  const statePath = resolvePollingReceiverStatePath({
    stateDir: rawOptions.stateDir,
    agent: rawOptions.agent,
    stateName: rawOptions.stateName
  });
  const state = loadState2(statePath, {
    agent: rawOptions.agent,
    aliases,
    now
  });
  const processedAt = now.toISOString();
  markProcessed(state, rawOptions.items, processedAt);
  saveState2(statePath, state);
  return { statePath, stateWritten: true, processedAt };
}
function buildPromptBundle(agent, items, options = {}) {
  if (items.length === 0) {
    return `[tap receiver] polling/file-polling: no new local inbox items for ${agent}.`;
  }
  const lines = [
    `[tap receiver] polling/file-polling: ${items.length} local inbox item(s) for ${agent}.`,
    "Promotion is operator-mediated; no Codex turn was started automatically.",
    "",
    "Suggested next step inside Codex CLI:",
    'tap_list_unread({ sources: ["inbox"], includeContent: true, markRead: false })',
    "",
    "Pending messages:"
  ];
  for (const [index, item] of items.entries()) {
    const prompt = renderAgentMessagePrompt(
      createTapMessageViewModel({
        agentName: agent,
        sender: item.fromName ?? item.from,
        recipient: item.toName ?? item.to,
        subject: item.subject,
        fileName: item.filename,
        body: item.content ?? "",
        replyTo: item.from,
        returnAddress: item.fromAddress
      }),
      { debugEnvelope: options.debugEnvelope }
    );
    lines.push("", `#${index + 1}`, prompt);
    if (options.debugEnvelope) {
      lines.push(
        `- source: ${item.path}`,
        `- mtime: ${item.mtime}`,
        `- dedupeKey: ${item.dedupeKey}`,
        `- messageId: ${item.messageId ?? "(none)"}`
      );
    }
  }
  return lines.join("\n");
}
function sleep(ms) {
  return new Promise((resolve21) => setTimeout(resolve21, ms));
}
async function runPollingReceiver(rawOptions) {
  const now = rawOptions.now ?? /* @__PURE__ */ new Date();
  const options = { ...rawOptions, now };
  const aliases = unique([
    options.agent,
    ...options.aliases ?? [],
    process.env.TAP_AGENT_ID ?? "",
    process.env.TAP_AGENT_NAME ?? ""
  ]);
  const warnings = [];
  const statePath = resolvePollingReceiverStatePath({
    stateDir: options.stateDir,
    agent: options.agent,
    stateName: options.stateName
  });
  const state = loadState2(statePath, {
    agent: options.agent,
    aliases,
    now,
    resetCursor: options.resetCursor
  });
  const hadState = fs28.existsSync(statePath);
  let aggregate = scanInbox(options, state, aliases);
  const maxIterations = options.mode === "watch" ? Math.max(1, options.maxIterations ?? 0) : 1;
  const intervalMs = Math.max(100, options.intervalMs ?? DEFAULT_INTERVAL_MS);
  if (options.mode === "watch") {
    let iteration = 1;
    while (aggregate.items.length === 0) {
      if (maxIterations > 0 && iteration >= maxIterations) break;
      await sleep(intervalMs);
      iteration += 1;
      aggregate = scanInbox(options, state, aliases);
    }
  }
  let stateWritten = false;
  if (options.mode !== "check" && aggregate.items.length > 0) {
    markProcessed(state, aggregate.items, (/* @__PURE__ */ new Date()).toISOString());
    saveState2(statePath, state);
    stateWritten = true;
  } else if (options.mode !== "check" && !hadState) {
    saveState2(statePath, state);
    stateWritten = true;
  }
  const effectiveSinceMs = parseSinceMs(options, state);
  return {
    mode: options.mode,
    agent: options.agent,
    aliases,
    commsDir: options.commsDir,
    statePath,
    receiveTransport: "polling",
    adapter: "file-polling",
    stateWritten,
    effectiveSince: effectiveSinceMs > 0 ? new Date(effectiveSinceMs).toISOString() : null,
    warnings,
    ...aggregate
  };
}

// src/receiver/projected-envelope-backfill.ts
import * as fs29 from "fs";
import * as path28 from "path";
import { createHash as createHash3 } from "crypto";
function normalize(value) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}
function safeFileLabel(value, fallback) {
  const normalized = value.normalize("NFKD").replace(/[^\p{L}\p{N}_-]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 64);
  return normalized || fallback;
}
function hashText(value) {
  return createHash3("sha256").update(value).digest("hex");
}
function buildDedupeKey(input) {
  return normalize(input.messageId) ?? normalize(input.projectionId) ?? normalize(input.routeTurnId) ?? hashText(
    [input.sender, input.recipient, input.subject, input.body ?? ""].join(
      "\0"
    )
  );
}
function yamlString(value) {
  return JSON.stringify(value);
}
function fieldMatches(content, field, value) {
  return content.includes(`${field}: ${value}`) || content.includes(`${field}: ${yamlString(value)}`);
}
function findExistingEvidence(options) {
  if (!fs29.existsSync(options.inboxDir)) return null;
  for (const filename of fs29.readdirSync(options.inboxDir).sort()) {
    if (!filename.endsWith(".md")) continue;
    const filePath = path28.join(options.inboxDir, filename);
    let content;
    try {
      content = fs29.readFileSync(filePath, "utf8");
    } catch {
      continue;
    }
    if (fieldMatches(content, "dedupe_key", options.dedupeKey)) {
      return { inboxPath: `inbox/${filename}`, filePath };
    }
    if (options.messageId && (fieldMatches(content, "message_id", options.messageId) || fieldMatches(content, "original_message_id", options.messageId))) {
      return { inboxPath: `inbox/${filename}`, filePath };
    }
    if (options.projectionId && fieldMatches(content, "projection_id", options.projectionId)) {
      return { inboxPath: `inbox/${filename}`, filePath };
    }
    if (options.routeTurnId && fieldMatches(content, "route_turn_id", options.routeTurnId)) {
      return { inboxPath: `inbox/${filename}`, filePath };
    }
  }
  return null;
}
function summarizeBody(body) {
  const normalized = body?.replace(/\s+/g, " ").trim() ?? "";
  if (!normalized) return "(no message body observed)";
  return normalized.length > 240 ? `${normalized.slice(0, 237).trimEnd()}...` : normalized;
}
function isFileExistsError(error) {
  if (!error || typeof error !== "object") return false;
  return "code" in error && error.code === "EEXIST";
}
function writeProjectedEnvelopeBackfill(input) {
  const sender = normalize(input.sender) ?? "unknown";
  const recipient = normalize(input.recipient) ?? "unknown";
  const subject = normalize(input.subject) ?? "no-subject";
  const sourceSurface = normalize(input.sourceSurface) ?? "unknown";
  const receivedAt = input.receivedAt ? new Date(input.receivedAt).toISOString() : (/* @__PURE__ */ new Date()).toISOString();
  const messageId = normalize(input.messageId);
  const projectionId = normalize(input.projectionId);
  const routeTurnId = normalize(input.routeTurnId);
  const dedupeKey = buildDedupeKey(input);
  const backfillMessageId = `backfill-${hashText(dedupeKey).slice(0, 16)}`;
  const inboxDir = path28.join(input.commsDir, "inbox");
  const existing = findExistingEvidence({
    inboxDir,
    dedupeKey,
    messageId,
    projectionId,
    routeTurnId
  });
  if (existing) {
    return {
      status: "exists",
      ...existing,
      dedupeKey,
      messageId: backfillMessageId
    };
  }
  fs29.mkdirSync(inboxDir, { recursive: true });
  const date = receivedAt.slice(0, 10).replace(/-/g, "");
  const filename = `${date}-backfill-${safeFileLabel(sender, "sender")}-${safeFileLabel(
    recipient,
    "recipient"
  )}-${safeFileLabel(subject, "subject")}-${hashText(dedupeKey).slice(0, 8)}.md`;
  const filePath = path28.join(inboxDir, filename);
  const lines = [
    "---",
    "type: inbox",
    "subtype: envelope-backfill",
    `message_id: ${backfillMessageId}`,
    messageId ? `original_message_id: ${messageId}` : null,
    `dedupe_key: ${yamlString(dedupeKey)}`,
    `from: ${sender}`,
    `to: ${recipient}`,
    `subject: ${subject}`,
    `source_surface: ${sourceSurface}`,
    `received_at: ${receivedAt}`,
    projectionId ? `projection_id: ${projectionId}` : null,
    routeTurnId ? `route_turn_id: ${routeTurnId}` : null,
    "---",
    "",
    "# Projected Envelope Backfill",
    "",
    "A projected tap envelope was observed without matching durable inbox evidence. This compact record preserves receiver-side audit context; it is not proof of live App delivery.",
    "",
    "## Summary",
    "",
    summarizeBody(input.body),
    ""
  ].filter((line) => line !== null);
  try {
    fs29.writeFileSync(filePath, lines.join("\n"), {
      encoding: "utf8",
      flag: "wx"
    });
  } catch (error) {
    if (!isFileExistsError(error)) throw error;
  }
  return {
    status: "written",
    inboxPath: `inbox/${filename}`,
    filePath,
    dedupeKey,
    messageId: backfillMessageId
  };
}

// src/receiver/codex-cli-app-server-promotion.ts
import { resolve as resolve12 } from "path";

// src/routing/codex-endpoint-profiles.ts
var LOOPBACK_HOSTS = /* @__PURE__ */ new Set(["127.0.0.1", "localhost", "::1"]);
var CODEX_ENDPOINT_PROFILE_ALIASES = {
  "direct-local": "direct-local-main"
};
var CODEX_APP_SERVER_ENDPOINT_PROFILES = [
  {
    id: "public-auth-gateway",
    role: "public",
    defaultUrl: "ws://127.0.0.1:4500",
    mode: "auth-gateway",
    operatorVisible: true,
    stability: "target",
    namespace: "canonical-public",
    description: "Canonical operator-facing gateway endpoint. Auth protection must only be claimed when the gateway path is actually healthy."
  },
  {
    id: "public-auth-gateway-compat",
    role: "public",
    defaultUrl: "ws://127.0.0.1:4501",
    mode: "auth-gateway",
    operatorVisible: true,
    stability: "compatibility",
    namespace: "compat-public",
    description: "Historical tap public/default endpoint kept as a compatibility alias during migration."
  },
  {
    id: "direct-local-main",
    role: "direct-local",
    defaultUrl: "ws://127.0.0.1:4510",
    mode: "direct-no-auth-localhost-only",
    operatorVisible: true,
    stability: "target",
    namespace: "direct-local",
    description: "Canonical no-auth localhost direct/debug endpoint for the main local profile."
  },
  {
    id: "direct-local-worker-1",
    role: "direct-local",
    defaultUrl: "ws://127.0.0.1:4511",
    mode: "direct-no-auth-localhost-only",
    operatorVisible: true,
    stability: "target",
    namespace: "direct-local",
    description: "Worker/debug no-auth localhost direct endpoint in the 4510+ namespace."
  },
  {
    id: "direct-local-worker-2",
    role: "direct-local",
    defaultUrl: "ws://127.0.0.1:4512",
    mode: "direct-no-auth-localhost-only",
    operatorVisible: true,
    stability: "target",
    namespace: "direct-local",
    description: "Second worker/debug no-auth localhost direct endpoint in the 4510+ namespace."
  },
  {
    id: "direct-local-compat",
    role: "direct-local",
    defaultUrl: "ws://127.0.0.1:35089",
    mode: "direct-no-auth-localhost-only",
    operatorVisible: true,
    stability: "compatibility",
    namespace: "accidental-compat",
    description: "Temporary compatibility alias for the long-lived accidental/random direct app-server port."
  },
  {
    id: "upstream-app-server",
    role: "upstream",
    defaultUrl: "dynamic loopback/high port",
    mode: "upstream-internal",
    operatorVisible: false,
    stability: "target",
    namespace: "internal-upstream",
    description: "Internal Codex app-server endpoint behind a public gateway; random or high ports must stay out of operator commands."
  },
  {
    id: "remote-tui-forward",
    role: "remote-tui",
    defaultUrl: "profile-configured forwarded endpoint",
    mode: "ssh-forwarded-client",
    operatorVisible: true,
    stability: "target",
    namespace: "remote-forward",
    description: "Client-side endpoint used by remote TUI attach aliases; profile config should hide raw forwarded port details."
  }
];
function cloneProfile(profile) {
  return { ...profile };
}
function normalizeCodexEndpointProfileId(profileId) {
  if (typeof profileId !== "string" || !profileId.trim()) return null;
  const trimmed = profileId.trim();
  return CODEX_ENDPOINT_PROFILE_ALIASES[trimmed] ?? trimmed;
}
function listCodexEndpointProfiles() {
  return CODEX_APP_SERVER_ENDPOINT_PROFILES.map(cloneProfile);
}
function getCodexEndpointProfile(profileId) {
  const normalized = normalizeCodexEndpointProfileId(profileId);
  if (!normalized) return null;
  const profile = CODEX_APP_SERVER_ENDPOINT_PROFILES.find(
    (candidate) => candidate.id === normalized
  ) ?? null;
  return profile ? cloneProfile(profile) : null;
}
function parseCodexEndpointUrl(url) {
  if (typeof url !== "string" || !url.trim()) return null;
  try {
    const parsed = new URL(url.trim());
    const port = Number(parsed.port);
    if (!["ws:", "wss:"].includes(parsed.protocol) || !Number.isInteger(port)) {
      return null;
    }
    return {
      raw: parsed.toString().replace(/\/$/, ""),
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port,
      loopback: LOOPBACK_HOSTS.has(parsed.hostname)
    };
  } catch {
    return null;
  }
}
function classifyCodexEndpointUrl(url) {
  const endpoint = parseCodexEndpointUrl(url);
  if (!endpoint) {
    return {
      profile: null,
      endpoint,
      reason: "invalid-or-missing-url"
    };
  }
  const exact = CODEX_APP_SERVER_ENDPOINT_PROFILES.find(
    (profile) => profile.defaultUrl === endpoint.raw
  ) ?? null;
  if (exact) {
    return {
      profile: cloneProfile(exact),
      endpoint,
      reason: "exact-default-url"
    };
  }
  if (endpoint.loopback && endpoint.port >= 4510 && endpoint.port <= 4599) {
    const direct = getCodexEndpointProfile("direct-local-main");
    return {
      profile: {
        ...direct,
        id: "direct-local-custom",
        defaultUrl: endpoint.raw,
        stability: "custom"
      },
      endpoint,
      reason: "direct-local-debug-namespace"
    };
  }
  if (endpoint.loopback) {
    const upstream = getCodexEndpointProfile("upstream-app-server");
    return {
      profile: {
        ...upstream,
        defaultUrl: endpoint.raw,
        stability: "custom"
      },
      endpoint,
      reason: "loopback-port-outside-operator-namespace"
    };
  }
  const remote = getCodexEndpointProfile("remote-tui-forward");
  return {
    profile: {
      ...remote,
      defaultUrl: endpoint.raw,
      stability: "custom"
    },
    endpoint,
    reason: "non-loopback-explicit-endpoint"
  };
}
function configuredEndpointUrl(profileId, config) {
  const profiles = config.profiles;
  if (profiles && typeof profiles === "object") {
    const entry = profiles[profileId];
    if (entry && typeof entry === "object") {
      const url = entry.url;
      if (typeof url === "string") return url;
    }
  }
  const directEntry = config[profileId];
  if (directEntry && typeof directEntry === "object") {
    const url = directEntry.url;
    if (typeof url === "string") return url;
  }
  return null;
}
function envEndpointUrl(profileId, env) {
  const key = `TAP_CODEX_ENDPOINT_${profileId.toUpperCase().replaceAll("-", "_")}`;
  const value = env[key];
  return typeof value === "string" && value.trim() ? value : null;
}
function resolveCodexEndpointProfile(options = {}) {
  const requestedProfileId = options.profileId ?? "public-auth-gateway";
  const profileId = normalizeCodexEndpointProfileId(requestedProfileId);
  const baseProfile = getCodexEndpointProfile(profileId);
  if (!profileId || !baseProfile) {
    throw new Error(`Unknown Codex endpoint profile: ${requestedProfileId}`);
  }
  const env = options.env ?? process.env;
  const config = options.config ?? {};
  const candidates = [
    ["explicit", options.requestedUrl],
    ["env", envEndpointUrl(profileId, env)],
    ["config", configuredEndpointUrl(profileId, config)],
    ["default", baseProfile.defaultUrl]
  ];
  const [source, selectedUrl] = candidates.find(
    ([, value]) => typeof value === "string" && value.trim()
  ) ?? ["missing", null];
  const classified = classifyCodexEndpointUrl(selectedUrl);
  if (!classified.endpoint) {
    return {
      ...baseProfile,
      profileId: baseProfile.id,
      requestedProfileId,
      resolvedUrl: null,
      source,
      valid: false,
      classification: classified.reason,
      classifiedProfileId: null,
      operatorVisible: baseProfile.operatorVisible
    };
  }
  return {
    ...baseProfile,
    profileId: baseProfile.id,
    requestedProfileId,
    resolvedUrl: classified.endpoint.raw,
    source,
    valid: true,
    classification: classified.reason,
    classifiedProfileId: classified.profile?.id ?? null,
    operatorVisible: classified.profile?.operatorVisible ?? baseProfile.operatorVisible
  };
}

// src/receiver/thread-cwd-match.ts
import * as fs30 from "fs";
function normalizeSeparators(value) {
  return value.replace(/^\\\\\?\\/, "").replace(/\\/g, "/").replace(/\/+/g, "/").replace(/\/$/, "");
}
function normalizeCaseInsensitivePath(value) {
  const normalized = normalizeSeparators(value);
  if (/^[a-z]:/i.test(normalized)) return normalized.toLowerCase();
  if (normalized.startsWith("/Users/")) return normalized.toLowerCase();
  return normalized;
}
function realpathOrNull(value) {
  try {
    return fs30.realpathSync.native(value);
  } catch {
    return null;
  }
}
function threadCwdMatches(expectedCwd, threadCwd) {
  if (!expectedCwd || !threadCwd) return false;
  if (expectedCwd === threadCwd) return true;
  const expectedRealpath = realpathOrNull(expectedCwd);
  const threadRealpath = realpathOrNull(threadCwd);
  if (expectedRealpath && threadRealpath && expectedRealpath === threadRealpath) {
    return true;
  }
  return normalizeCaseInsensitivePath(expectedCwd) === normalizeCaseInsensitivePath(threadCwd);
}

// src/receiver/codex-cli-app-server-promotion.ts
var DEFAULT_APP_SERVER_REQUEST_TIMEOUT_MS = 5e3;
async function readSocketData(data) {
  if (typeof data === "string") return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8");
  if (ArrayBuffer.isView(data)) {
    return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString(
      "utf8"
    );
  }
  if (typeof Blob !== "undefined" && data instanceof Blob) {
    return await data.text();
  }
  return String(data);
}
function objectValue(value) {
  return value && typeof value === "object" ? value : null;
}
function getString(value) {
  return typeof value === "string" && value.trim() ? value : null;
}
function extractActiveTurnId(thread) {
  const record = objectValue(thread);
  const turns = Array.isArray(record?.turns) ? record.turns : [];
  for (const turn of turns) {
    const turnRecord = objectValue(turn);
    if (turnRecord?.status === "inProgress" && typeof turnRecord.id === "string") {
      return turnRecord.id;
    }
  }
  return null;
}
function summarizeThread(thread) {
  const record = objectValue(thread);
  const id = getString(record?.id);
  if (!id) return null;
  const status = objectValue(record?.status);
  return {
    id,
    cwd: typeof record?.cwd === "string" ? record.cwd : "",
    updatedAt: typeof record?.updatedAt === "number" ? record.updatedAt : 0,
    statusType: typeof status?.type === "string" ? status.type : null,
    activeTurnId: extractActiveTurnId(thread),
    thread
  };
}
var WebSocketCodexAppServerPromoter = class {
  socket = null;
  nextId = 1;
  pending = /* @__PURE__ */ new Map();
  async promote(request) {
    try {
      await this.connect(request.appServerUrl);
      const thread = await this.attachThread(
        request.threadId ?? null,
        request.cwd
      );
      if (thread.statusType === "active" || thread.activeTurnId) {
        return {
          delivered: false,
          turnId: null,
          threadId: thread.id,
          runtimeHealth: "active-turn",
          blockedReason: `active-turn: thread ${thread.id} already has active turn ${thread.activeTurnId ?? "(status active)"}`
        };
      }
      const turnId = await this.startTurn(thread.id, request.text);
      return {
        delivered: Boolean(turnId),
        turnId,
        threadId: thread.id,
        runtimeHealth: "idle",
        blockedReason: turnId ? null : "turn/start did not return a turn id"
      };
    } catch (error) {
      return {
        delivered: false,
        turnId: null,
        threadId: null,
        runtimeHealth: "unhealthy",
        blockedReason: error instanceof Error ? error.message : `app-server error: ${error}`
      };
    } finally {
      this.disconnect();
    }
  }
  connect(url) {
    this.socket = new WebSocket(url);
    return new Promise((resolvePromise, rejectPromise) => {
      let settled = false;
      const resolveOnce = () => {
        if (settled) return;
        settled = true;
        resolvePromise();
      };
      const rejectOnce = (error) => {
        if (settled) return;
        settled = true;
        rejectPromise(error);
      };
      this.socket?.addEventListener("open", resolveOnce, { once: true });
      this.socket?.addEventListener("error", () => {
        rejectOnce(new Error(`Failed to connect to App Server at ${url}`));
      });
      this.socket?.addEventListener("close", () => {
        this.rejectPending(new Error("App Server connection closed"));
      });
      this.socket?.addEventListener("message", (event) => {
        void this.handleMessage(event.data);
      });
    }).then(async () => {
      await this.request("initialize", {
        clientInfo: {
          name: "tap-receiver-promotion",
          title: "tap receiver promotion",
          version: "0.1.0"
        },
        capabilities: {
          experimentalApi: false
        }
      });
    });
  }
  disconnect() {
    if (!this.socket) return;
    this.socket.close();
    this.socket = null;
  }
  async attachThread(requestedThreadId, cwd) {
    if (requestedThreadId) {
      const response = objectValue(
        await this.request("thread/read", {
          threadId: requestedThreadId,
          includeTurns: true
        })
      );
      const thread = summarizeThread(response?.thread);
      if (!thread) {
        throw new Error(
          `thread/read did not return thread ${requestedThreadId}`
        );
      }
      return thread;
    }
    const loaded = objectValue(
      await this.request("thread/loaded/list", {
        limit: 20
      })
    );
    const ids = Array.isArray(loaded?.data) ? loaded.data.filter(
      (value) => typeof value === "string"
    ) : [];
    const threads = [];
    for (const id of ids) {
      const response = objectValue(
        await this.request("thread/read", {
          threadId: id,
          includeTurns: true
        })
      );
      const thread = summarizeThread(response?.thread);
      if (thread) threads.push(thread);
    }
    const candidates = threads.filter(
      (thread) => threadCwdMatches(cwd, thread.cwd)
    );
    if (candidates.length === 0) {
      throw new Error(`No loaded threads matched cwd ${cwd}`);
    }
    candidates.sort((left, right) => {
      const leftActive = left.statusType === "active" || left.activeTurnId ? 1 : 0;
      const rightActive = right.statusType === "active" || right.activeTurnId ? 1 : 0;
      if (leftActive !== rightActive) return rightActive - leftActive;
      return right.updatedAt - left.updatedAt;
    });
    return candidates[0];
  }
  async startTurn(threadId, text) {
    const response = objectValue(
      await this.request("turn/start", {
        threadId,
        input: [
          {
            type: "text",
            text,
            text_elements: []
          }
        ]
      })
    );
    const turn = objectValue(response?.turn);
    return getString(turn?.id);
  }
  request(method, params) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error(`Socket is not open for ${method}`);
    }
    const id = this.nextId;
    this.nextId += 1;
    const payload = {
      jsonrpc: "2.0",
      id,
      method,
      params
    };
    return new Promise((resolvePromise, rejectPromise) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        rejectPromise(
          new Error(
            `app-server request timed out for ${method} after ${DEFAULT_APP_SERVER_REQUEST_TIMEOUT_MS}ms`
          )
        );
      }, DEFAULT_APP_SERVER_REQUEST_TIMEOUT_MS);
      this.pending.set(id, {
        method,
        resolve: (value) => {
          clearTimeout(timeout);
          resolvePromise(value);
        },
        reject: (reason) => {
          clearTimeout(timeout);
          rejectPromise(reason);
        }
      });
      this.socket?.send(JSON.stringify(payload));
    });
  }
  async handleMessage(data) {
    const message = JSON.parse(await readSocketData(data));
    if (typeof message.id !== "number" || !Object.hasOwn(message, "result") && !Object.hasOwn(message, "error")) {
      return;
    }
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    if (message.error) {
      pending.reject(
        new Error(
          `${pending.method} failed: ${message.error.message ?? JSON.stringify(message.error)}`
        )
      );
      return;
    }
    pending.resolve(message.result);
  }
  rejectPending(error) {
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();
  }
};
function buildPromotionPrompt(agent, item, options = {}) {
  return buildTapMessagePrompt({
    agentName: agent,
    sender: item.fromName ?? item.from,
    recipient: item.to,
    subject: item.subject,
    fileName: item.filename,
    body: item.content ?? "",
    replyTo: item.from,
    returnAddress: item.fromAddress,
    debugEnvelope: options.debugEnvelope
  });
}
async function runCodexCliAppServerPromotion(options) {
  const scan = await runPollingReceiver({
    ...options,
    mode: "check",
    limit: Math.max(1, Math.min(1, options.limit ?? 1)),
    includeContent: true
  });
  const endpointProfile = resolveCodexEndpointProfile({
    profileId: options.endpointProfile ?? "public-auth-gateway",
    requestedUrl: options.appServerUrl,
    config: options.endpointConfig ?? {}
  });
  const appServerUrl = endpointProfile.resolvedUrl;
  const item = scan.items[0] ?? null;
  const cwd = resolve12(options.cwd ?? process.cwd());
  const baseResult = {
    mode: "promote",
    agent: scan.agent,
    aliases: scan.aliases,
    commsDir: scan.commsDir,
    statePath: scan.statePath,
    receiveTransport: "polling",
    adapter: "app-server-promotion",
    runtimeSurface: "codex-cli-app-server",
    endpointProfile,
    appServerUrl,
    cwd,
    scanned: scan.scanned,
    skipped: scan.skipped,
    effectiveSince: scan.effectiveSince,
    warnings: scan.warnings
  };
  if (!item) {
    return {
      ...baseResult,
      status: "idle",
      delivered: false,
      queued: false,
      queueReason: null,
      steerAttempted: false,
      turnId: null,
      threadId: null,
      blockedReason: null,
      runtimeHealth: null,
      item: null,
      promptText: null,
      stateWritten: false
    };
  }
  const promptText = buildPromotionPrompt(scan.agent, item, {
    debugEnvelope: options.debugEnvelope
  });
  if (options.dryRun) {
    return {
      ...baseResult,
      status: "dry-run",
      delivered: false,
      queued: false,
      queueReason: null,
      steerAttempted: false,
      turnId: null,
      threadId: null,
      blockedReason: "dry-run: app-server turn/start was not attempted",
      runtimeHealth: null,
      item,
      promptText,
      stateWritten: false
    };
  }
  if (!endpointProfile.valid || !appServerUrl) {
    return {
      ...baseResult,
      status: "blocked",
      delivered: false,
      queued: false,
      queueReason: null,
      steerAttempted: false,
      turnId: null,
      threadId: null,
      blockedReason: `invalid endpoint profile ${endpointProfile.requestedProfileId}: ${endpointProfile.classification}`,
      runtimeHealth: "adapter-unavailable",
      item,
      promptText,
      stateWritten: false
    };
  }
  const promoter = options.promoter ?? new WebSocketCodexAppServerPromoter();
  const delivery = await promoter.promote({
    appServerUrl,
    cwd,
    threadId: options.threadId,
    text: promptText
  });
  let stateWritten = false;
  if (delivery.delivered) {
    const marked = markPollingReceiverItemsProcessed({
      stateDir: options.stateDir,
      agent: options.agent,
      aliases: options.aliases,
      stateName: options.stateName,
      items: [item],
      now: options.now
    });
    stateWritten = marked.stateWritten;
  }
  const queued = delivery.runtimeHealth === "active-turn";
  return {
    ...baseResult,
    status: delivery.delivered ? "delivered" : "blocked",
    delivered: delivery.delivered,
    queued,
    queueReason: queued ? delivery.blockedReason : null,
    steerAttempted: false,
    turnId: delivery.turnId,
    threadId: delivery.threadId,
    blockedReason: delivery.blockedReason,
    runtimeHealth: delivery.runtimeHealth,
    item,
    promptText,
    stateWritten
  };
}

// src/receiver/supervised-receiver-promotion.ts
var DEFAULT_INTERVAL_MS2 = 2e3;
function sleep2(ms) {
  return new Promise((resolve21) => setTimeout(resolve21, ms));
}
function summarizeStatus(attempts) {
  const last = attempts.at(-1);
  if (last?.status === "delivered") {
    return "delivered";
  }
  if (last?.status === "dry-run") {
    return "dry-run";
  }
  if (attempts.some((attempt) => attempt.status === "blocked")) {
    return "blocked";
  }
  return "idle";
}
function isRetryableActiveTurn(attempt) {
  return attempt.status === "blocked" && attempt.runtimeHealth === "active-turn";
}
async function runSupervisedReceiverPromotion(options) {
  const maxPromotions = Math.max(
    1,
    Math.min(20, options.maxPromotionsPerIteration ?? 1)
  );
  const maxIterations = options.mode === "watch" && options.maxIterations !== void 0 ? Math.max(1, options.maxIterations) : options.mode === "watch" ? 0 : 1;
  const intervalMs = Math.max(100, options.intervalMs ?? DEFAULT_INTERVAL_MS2);
  const attempts = [];
  const warnings = [];
  let iterations = 0;
  while (true) {
    iterations += 1;
    let promotedThisIteration = 0;
    const blockedThisIteration = /* @__PURE__ */ new Set();
    while (promotedThisIteration < maxPromotions) {
      const attempt = await runCodexCliAppServerPromotion({
        ...options,
        limit: 1,
        excludeDedupeKeys: blockedThisIteration
      });
      warnings.push(...attempt.warnings);
      if (!attempt.item) break;
      attempts.push(attempt);
      if (attempt.status === "delivered") {
        promotedThisIteration += 1;
        continue;
      }
      blockedThisIteration.add(attempt.item.dedupeKey);
      if (isRetryableActiveTurn(attempt)) continue;
      break;
    }
    const lastAttempt = attempts.at(-1);
    const shouldRetryActiveTurn = options.mode === "watch" && lastAttempt !== void 0 && isRetryableActiveTurn(lastAttempt);
    const hasTerminalAttempt = lastAttempt !== void 0 && (lastAttempt.status === "delivered" || lastAttempt.status === "dry-run" || lastAttempt.status === "blocked" && !shouldRetryActiveTurn);
    if (hasTerminalAttempt) break;
    if (options.mode !== "watch") break;
    if (maxIterations > 0 && iterations >= maxIterations) break;
    await sleep2(intervalMs);
  }
  const status = summarizeStatus(attempts);
  const first = attempts[0] ?? null;
  return {
    mode: options.mode,
    agent: first?.agent ?? options.agent,
    aliases: first?.aliases ?? [options.agent, ...options.aliases ?? []],
    commsDir: first?.commsDir ?? options.commsDir,
    statePath: first?.statePath ?? null,
    receiveTransport: "polling",
    adapter: "supervised-app-server-promotion",
    runtimeSurface: "codex-cli-app-server",
    status,
    delivered: attempts.filter((attempt) => attempt.delivered).length,
    blocked: attempts.filter((attempt) => attempt.status === "blocked").length,
    queued: attempts.filter((attempt) => attempt.queued).length,
    dryRun: attempts.some((attempt) => attempt.status === "dry-run"),
    iterations,
    attempts,
    lastBlockedReason: [...attempts].reverse().find((attempt) => attempt.blockedReason)?.blockedReason ?? null,
    lastQueueReason: [...attempts].reverse().find((attempt) => attempt.queueReason)?.queueReason ?? null,
    warnings
  };
}

// src/projection/local-receiver-projection.ts
import * as fs31 from "fs";
import * as path29 from "path";
var APPEND_ONLY_DIRS = [
  "inbox",
  "reviews",
  "findings",
  "receipts",
  "decisions"
];
var DEFAULT_DIRS = ["inbox"];
var DEFAULT_LOOKBACK_MINUTES2 = 5;
var DEFAULT_INTERVAL_MS3 = 2e3;
var DEFAULT_LIMIT2 = 100;
function normalizeAddress3(value) {
  return value.trim().toLowerCase();
}
function unique2(values) {
  const seen = /* @__PURE__ */ new Set();
  const result = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) continue;
    const key = normalizeAddress3(trimmed);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }
  return result;
}
function safeStateName2(value) {
  return value.trim().replace(/[^\p{L}\p{N}._-]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 100);
}
function normalizeProjectionDirs(values) {
  const requested = values?.length ? values : DEFAULT_DIRS;
  const dirs = [];
  let disallowed = 0;
  for (const value of requested) {
    if (APPEND_ONLY_DIRS.includes(value)) {
      if (!dirs.includes(value)) dirs.push(value);
    } else {
      disallowed += 1;
    }
  }
  return { dirs: dirs.length ? dirs : DEFAULT_DIRS, disallowed };
}
function parseFrontmatter2(content) {
  if (!content.startsWith("---")) return {};
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const fields = {};
  for (const line of match[1].split(/\r?\n/)) {
    const field = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!field) continue;
    fields[field[1].toLowerCase()] = field[2].trim().replace(/^["']|["']$/g, "");
  }
  return fields;
}
function parseHeaderFields2(content) {
  const fields = {};
  for (const line of content.split(/\r?\n/).slice(0, 12)) {
    if (!line.trim()) break;
    const field = line.match(/^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/);
    if (!field) continue;
    fields[field[1].toLowerCase()] = field[2].trim();
  }
  return fields;
}
function parseFilename2(filename) {
  const stem = filename.replace(/\.md$/i, "");
  const parts = stem.split("-");
  if (parts.length < 4) return { from: null, to: null, subject: stem || null };
  return {
    from: parts[1] || null,
    to: parts[2] || null,
    subject: parts.slice(3).join("-") || stem
  };
}
function parseMetadata(filename, content) {
  const frontmatter = parseFrontmatter2(content);
  const headers = parseHeaderFields2(content);
  const parsedFilename = parseFilename2(filename);
  return {
    from: frontmatter.from ?? headers.from ?? parsedFilename.from,
    to: frontmatter.to ?? headers.to ?? parsedFilename.to,
    subject: frontmatter.subject ?? headers.subject ?? parsedFilename.subject ?? null,
    messageId: frontmatter.message_id ?? frontmatter.messageid ?? headers["message-id"] ?? headers.message_id ?? null
  };
}
function splitAddressList2(value) {
  return value.split(/[,\s]+/).map((part) => part.trim()).filter(Boolean);
}
function isForAgent2(to, aliases) {
  if (!to) return false;
  const normalizedAliases = new Set(aliases.map(normalizeAddress3));
  for (const target of splitAddressList2(to)) {
    const normalized = normalizeAddress3(target);
    if (normalized === "all" || normalized === "broadcast" || normalized === "\uC804\uCCB4" || normalizedAliases.has(normalized)) {
      return true;
    }
  }
  return false;
}
function requiresAddressedTarget(dir) {
  return dir === "inbox" || dir === "reviews";
}
function isOwnMessage2(from, aliases) {
  if (!from) return false;
  const normalizedAliases = new Set(aliases.map(normalizeAddress3));
  return splitAddressList2(from).some(
    (address) => normalizedAliases.has(normalizeAddress3(address))
  );
}
function resolveLocalProjectionStatePath(options) {
  const projectionDir = path29.join(options.stateDir, "projection");
  const rawName = options.stateName?.trim() || `local-projection-${options.agent}`;
  const name = safeStateName2(rawName) || "local-projection";
  return path29.join(projectionDir, `${name}.json`);
}
function loadState3(statePath, options) {
  if (!options.resetCursor && fs31.existsSync(statePath)) {
    try {
      const parsed = JSON.parse(
        fs31.readFileSync(statePath, "utf8")
      );
      if (parsed.schemaVersion === 1 && parsed.joinedAt && parsed.projected) {
        return {
          schemaVersion: 1,
          agent: options.agent,
          aliases: options.aliases,
          sourceCommsDir: options.sourceCommsDir,
          targetCommsDir: options.targetCommsDir,
          createdAt: parsed.createdAt ?? options.now.toISOString(),
          joinedAt: parsed.joinedAt,
          projected: parsed.projected
        };
      }
    } catch {
    }
  }
  return {
    schemaVersion: 1,
    agent: options.agent,
    aliases: options.aliases,
    sourceCommsDir: options.sourceCommsDir,
    targetCommsDir: options.targetCommsDir,
    createdAt: options.now.toISOString(),
    joinedAt: options.now.toISOString(),
    projected: {}
  };
}
function saveState3(statePath, state) {
  fs31.mkdirSync(path29.dirname(statePath), { recursive: true });
  fs31.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}
`, "utf8");
}
function parseSinceMs2(options, state) {
  if (options.all) return null;
  if (options.since) {
    const parsed = Date.parse(options.since);
    if (Number.isNaN(parsed)) {
      throw new RangeError(`Invalid --since timestamp: ${options.since}`);
    }
    return parsed;
  }
  if (options.sinceMinutes) {
    return (options.now ?? /* @__PURE__ */ new Date()).getTime() - options.sinceMinutes * 6e4;
  }
  return Date.parse(state.joinedAt) || Date.now() - DEFAULT_LOOKBACK_MINUTES2 * 6e4;
}
function resolveTargetPath(targetCommsDir, dir, filename) {
  return path29.join(targetCommsDir, dir, filename);
}
function listCandidateFiles(sourceCommsDir, dirs) {
  const result = [];
  for (const dir of dirs) {
    const sourceDir = path29.join(sourceCommsDir, dir);
    if (!fs31.existsSync(sourceDir)) continue;
    for (const filename of fs31.readdirSync(sourceDir).sort()) {
      if (!filename.endsWith(".md") && !filename.endsWith(".json")) continue;
      const fullPath = path29.join(sourceDir, filename);
      result.push({ dir, filename, fullPath });
    }
  }
  return result;
}
function markProjected(state, items, projectedAt) {
  for (const item of items) {
    if (!item.projected && item.skipReason !== "target-exists") continue;
    state.projected[item.dedupeKey] = {
      relativePath: item.relativePath,
      messageId: item.messageId,
      mtime: item.mtime,
      projectedAt
    };
  }
}
function scanProjection(options, state, aliases, dirs, sinceMs) {
  const items = [];
  const skipped = {
    old: 0,
    duplicate: 0,
    notForAgent: 0,
    own: 0,
    disallowed: 0
  };
  let scanned = 0;
  const limit = Math.max(1, Math.min(500, options.limit ?? DEFAULT_LIMIT2));
  for (const candidate of listCandidateFiles(options.sourceCommsDir, dirs)) {
    let stat;
    try {
      stat = fs31.statSync(candidate.fullPath);
    } catch {
      continue;
    }
    if (!stat.isFile()) continue;
    scanned += 1;
    if (sinceMs && stat.mtimeMs < sinceMs) {
      skipped.old += 1;
      continue;
    }
    let content = "";
    try {
      content = fs31.readFileSync(candidate.fullPath, "utf8").replace(/^\uFEFF/, "");
    } catch {
      continue;
    }
    const metadata = parseMetadata(candidate.filename, content);
    if (!options.includeAllTargets && !isForAgent2(metadata.to, aliases) && requiresAddressedTarget(candidate.dir)) {
      skipped.notForAgent += 1;
      continue;
    }
    if (!options.includeOwn && isOwnMessage2(metadata.from, aliases)) {
      skipped.own += 1;
      continue;
    }
    const relativePath = `${candidate.dir}/${candidate.filename}`;
    const dedupeKey = metadata.messageId?.trim() || relativePath;
    if (state.projected[dedupeKey]) {
      skipped.duplicate += 1;
      continue;
    }
    const targetPath = resolveTargetPath(
      options.targetCommsDir,
      candidate.dir,
      candidate.filename
    );
    const targetExists = fs31.existsSync(targetPath);
    const item = {
      dir: candidate.dir,
      filename: candidate.filename,
      sourcePath: candidate.fullPath,
      targetPath,
      relativePath,
      mtime: stat.mtime.toISOString(),
      dedupeKey,
      messageId: metadata.messageId,
      from: metadata.from,
      to: metadata.to,
      subject: metadata.subject,
      projected: false,
      skipReason: targetExists ? "target-exists" : "dry-run"
    };
    items.push(item);
    if (items.length >= limit) break;
  }
  return {
    status: items.length > 0 ? "pending" : "idle",
    items,
    scanned,
    skipped
  };
}
function applyProjection(items) {
  for (const item of items) {
    if (item.skipReason === "target-exists") continue;
    fs31.mkdirSync(path29.dirname(item.targetPath), { recursive: true });
    fs31.copyFileSync(item.sourcePath, item.targetPath);
    const sourceStat = fs31.statSync(item.sourcePath);
    fs31.utimesSync(item.targetPath, sourceStat.atime, sourceStat.mtime);
    item.projected = true;
    item.skipReason = null;
  }
}
function sleep3(ms) {
  return new Promise((resolve21) => setTimeout(resolve21, ms));
}
async function runLocalProjection(rawOptions) {
  const now = rawOptions.now ?? /* @__PURE__ */ new Date();
  const options = {
    ...rawOptions,
    now,
    sourceCommsDir: path29.resolve(rawOptions.sourceCommsDir),
    targetCommsDir: path29.resolve(rawOptions.targetCommsDir)
  };
  const aliases = unique2([
    options.agent,
    ...options.aliases ?? [],
    process.env.TAP_AGENT_ID ?? "",
    process.env.TAP_AGENT_NAME ?? ""
  ]);
  const warnings = [];
  const normalizedDirs = normalizeProjectionDirs(options.dirs);
  const dirs = normalizedDirs.dirs;
  if (normalizedDirs.disallowed > 0) {
    warnings.push(
      `Ignored ${normalizedDirs.disallowed} disallowed projection dir(s); only append-only dirs are supported.`
    );
  }
  if (options.sourceCommsDir === options.targetCommsDir) {
    throw new RangeError(
      "Projection source and target comms directories must differ."
    );
  }
  const statePath = resolveLocalProjectionStatePath({
    stateDir: options.stateDir,
    agent: options.agent,
    stateName: options.stateName
  });
  const state = loadState3(statePath, {
    agent: options.agent,
    aliases,
    sourceCommsDir: options.sourceCommsDir,
    targetCommsDir: options.targetCommsDirLabel ?? options.targetCommsDir,
    now,
    resetCursor: options.resetCursor
  });
  const sinceMs = parseSinceMs2(options, state);
  const maxIterations = options.mode === "watch" ? Math.max(1, options.maxIterations ?? 0) : 1;
  const intervalMs = Math.max(100, options.intervalMs ?? DEFAULT_INTERVAL_MS3);
  await options.beforeScan?.();
  let aggregate = scanProjection(options, state, aliases, dirs, sinceMs);
  if (options.mode === "watch") {
    let iteration = 1;
    while (aggregate.items.length === 0) {
      if (maxIterations > 0 && iteration >= maxIterations) break;
      iteration += 1;
      await sleep3(intervalMs);
      await options.beforeScan?.();
      aggregate = scanProjection(options, state, aliases, dirs, sinceMs);
    }
  }
  let stateWritten = false;
  if (options.mode === "apply" || options.mode === "watch") {
    if (aggregate.items.length > 0) {
      applyProjection(aggregate.items);
      await options.afterApply?.(aggregate.items);
      markProjected(state, aggregate.items, now.toISOString());
    }
    saveState3(statePath, state);
    stateWritten = true;
  }
  return {
    mode: options.mode,
    agent: options.agent,
    aliases,
    sourceCommsDir: options.sourceCommsDir,
    targetCommsDir: options.targetCommsDirLabel ?? options.targetCommsDir,
    statePath,
    adapter: "local-projection",
    receiveTransport: "polling",
    status: aggregate.items.some((item) => item.projected) && options.mode !== "check" ? "projected" : aggregate.status,
    dirs,
    items: aggregate.items,
    scanned: aggregate.scanned,
    skipped: aggregate.skipped,
    stateWritten,
    effectiveSince: sinceMs ? new Date(sinceMs).toISOString() : null,
    warnings
  };
}

// src/uplink/local-append-only-uplink.ts
import * as fs32 from "fs";
import * as path30 from "path";
var APPEND_ONLY_DIRS2 = [
  "inbox",
  "reviews",
  "findings",
  "receipts",
  "decisions"
];
var DEFAULT_DIRS2 = ["inbox"];
var DEFAULT_LOOKBACK_MINUTES3 = 5;
var DEFAULT_INTERVAL_MS4 = 2e3;
var DEFAULT_LIMIT3 = 100;
var GUARDED_BROAD_RUNTIME_ALIASES = /* @__PURE__ */ new Set(["codex"]);
function normalizeAddress4(value) {
  return value.trim().toLowerCase();
}
function unique3(values) {
  const seen = /* @__PURE__ */ new Set();
  const result = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) continue;
    const key = normalizeAddress4(trimmed);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }
  return result;
}
function safeStateName3(value) {
  return value.trim().replace(/[^\p{L}\p{N}._-]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 100);
}
function normalizeUplinkDirs(values) {
  const hasExplicitRequest = Boolean(values?.length);
  const requested = hasExplicitRequest ? values : DEFAULT_DIRS2;
  const dirs = [];
  let disallowed = 0;
  for (const value of requested ?? []) {
    if (APPEND_ONLY_DIRS2.includes(value)) {
      if (!dirs.includes(value)) dirs.push(value);
    } else {
      disallowed += 1;
    }
  }
  return {
    dirs: dirs.length ? dirs : hasExplicitRequest ? [] : DEFAULT_DIRS2,
    disallowed
  };
}
function parseFrontmatter3(content) {
  if (!content.startsWith("---")) return {};
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const fields = {};
  for (const line of match[1].split(/\r?\n/)) {
    const field = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!field) continue;
    fields[field[1].toLowerCase()] = field[2].trim().replace(/^["']|["']$/g, "");
  }
  return fields;
}
function parseHeaderFields3(content) {
  const fields = {};
  for (const line of content.split(/\r?\n/).slice(0, 12)) {
    if (!line.trim()) break;
    const field = line.match(/^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/);
    if (!field) continue;
    fields[field[1].toLowerCase()] = field[2].trim();
  }
  return fields;
}
function parseStringArray2(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => typeof item === "string" ? item.trim() : "").filter(Boolean);
}
function parseAddressField2(value) {
  if (!value?.trim()) return null;
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object") return null;
    return {
      routingAddress: typeof parsed.routingAddress === "string" ? parsed.routingAddress : null,
      aliases: parseStringArray2(parsed.aliases)
    };
  } catch {
    return null;
  }
}
function parseFilename3(filename) {
  const stem = filename.replace(/\.(md|json)$/i, "");
  const parts = stem.split("-");
  if (parts.length < 4) return { from: null, to: null, subject: stem || null };
  return {
    from: parts[1] || null,
    to: parts[2] || null,
    subject: parts.slice(3).join("-") || stem
  };
}
function parseMetadata2(filename, content) {
  const frontmatter = parseFrontmatter3(content);
  const headers = parseHeaderFields3(content);
  const parsedFilename = parseFilename3(filename);
  return {
    from: frontmatter.from ?? headers.from ?? parsedFilename.from,
    fromName: frontmatter.from_name ?? frontmatter.fromname ?? headers.from_name ?? headers.fromname ?? null,
    fromAddress: parseAddressField2(
      frontmatter.from_address ?? headers.from_address
    ),
    to: frontmatter.to ?? headers.to ?? parsedFilename.to,
    subject: frontmatter.subject ?? headers.subject ?? parsedFilename.subject ?? null,
    messageId: frontmatter.message_id ?? frontmatter.messageid ?? headers["message-id"] ?? headers.message_id ?? null
  };
}
function splitAddressList3(value) {
  return value.split(/[,\s]+/).map((part) => part.trim()).filter(Boolean);
}
function matchesAnyAlias(value, aliases) {
  if (!value) return false;
  const normalizedAliases = new Set(aliases.map(normalizeAddress4));
  return splitAddressList3(value).some(
    (address) => normalizedAliases.has(normalizeAddress4(address))
  );
}
function isUnknownSender(value) {
  return !value || normalizeAddress4(value) === "unknown";
}
function isGuardedBroadRuntimeAlias(value) {
  return Boolean(
    value && GUARDED_BROAD_RUNTIME_ALIASES.has(normalizeAddress4(value))
  );
}
function addressRoutingMatchesBroadAlias(address, sender) {
  return Boolean(
    address?.routingAddress && sender && normalizeAddress4(address.routingAddress) === normalizeAddress4(sender) && isGuardedBroadRuntimeAlias(address.routingAddress)
  );
}
function addressAliasesInclude(address, value) {
  return Boolean(
    value && address?.aliases.some((alias) => matchesAnyAlias(alias, [value]))
  );
}
function matchesConcreteAlias(value, aliases) {
  return Boolean(
    value && !isGuardedBroadRuntimeAlias(value) && matchesAnyAlias(value, aliases)
  );
}
function isOwnMessage3(identity, aliases) {
  if (!isUnknownSender(identity.from)) {
    if (isGuardedBroadRuntimeAlias(identity.from)) {
      return addressRoutingMatchesBroadAlias(identity.fromAddress, identity.from) && matchesConcreteAlias(identity.fromName, aliases) && addressAliasesInclude(identity.fromAddress, identity.fromName);
    }
    return matchesAnyAlias(identity.from, aliases);
  }
  return matchesAnyAlias(identity.fromName, aliases);
}
function requiresOwnSource(dir) {
  return dir === "inbox" || dir === "reviews";
}
function resolveLocalUplinkStatePath(options) {
  const uplinkDir = path30.join(options.stateDir, "uplink");
  const rawName = options.stateName?.trim() || `local-uplink-${options.agent}`;
  const name = safeStateName3(rawName) || "local-uplink";
  return path30.join(uplinkDir, `${name}.json`);
}
function loadState4(statePath, options) {
  if (!options.resetCursor && fs32.existsSync(statePath)) {
    try {
      const parsed = JSON.parse(
        fs32.readFileSync(statePath, "utf8")
      );
      if (parsed.schemaVersion === 1 && parsed.joinedAt && parsed.uploaded) {
        return {
          schemaVersion: 1,
          agent: options.agent,
          aliases: options.aliases,
          sourceCommsDir: options.sourceCommsDir,
          targetCommsDir: options.targetCommsDir,
          createdAt: parsed.createdAt ?? options.now.toISOString(),
          joinedAt: parsed.joinedAt,
          uploaded: parsed.uploaded
        };
      }
    } catch {
    }
  }
  return {
    schemaVersion: 1,
    agent: options.agent,
    aliases: options.aliases,
    sourceCommsDir: options.sourceCommsDir,
    targetCommsDir: options.targetCommsDir,
    createdAt: options.now.toISOString(),
    joinedAt: options.now.toISOString(),
    uploaded: {}
  };
}
function saveState4(statePath, state) {
  fs32.mkdirSync(path30.dirname(statePath), { recursive: true });
  fs32.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}
`, "utf8");
}
function parseSinceMs3(options, state) {
  if (options.all) return null;
  if (options.since) {
    const parsed = Date.parse(options.since);
    if (Number.isNaN(parsed)) {
      throw new RangeError(`Invalid --since timestamp: ${options.since}`);
    }
    return parsed;
  }
  if (options.sinceMinutes) {
    return (options.now ?? /* @__PURE__ */ new Date()).getTime() - options.sinceMinutes * 6e4;
  }
  return Date.parse(state.joinedAt) || Date.now() - DEFAULT_LOOKBACK_MINUTES3 * 6e4;
}
function listCandidateFiles2(sourceCommsDir, dirs) {
  const result = [];
  for (const dir of dirs) {
    const sourceDir = path30.join(sourceCommsDir, dir);
    if (!fs32.existsSync(sourceDir)) continue;
    for (const filename of fs32.readdirSync(sourceDir).sort()) {
      if (!filename.endsWith(".md") && !filename.endsWith(".json")) continue;
      const fullPath = path30.join(sourceDir, filename);
      result.push({ dir, filename, fullPath });
    }
  }
  return result;
}
function markUploaded(state, items, uploadedAt) {
  for (const item of items) {
    if (!item.uploaded && item.skipReason !== "target-exists") continue;
    state.uploaded[item.dedupeKey] = {
      relativePath: item.relativePath,
      messageId: item.messageId,
      mtime: item.mtime,
      uploadedAt
    };
  }
}
function sameFileContent(leftPath, rightPath) {
  try {
    return fs32.readFileSync(leftPath).equals(fs32.readFileSync(rightPath));
  } catch {
    return false;
  }
}
function scanUplink(options, state, aliases, dirs, sinceMs) {
  const items = [];
  const skipped = {
    old: 0,
    duplicate: 0,
    notFromAgent: 0,
    disallowed: 0
  };
  let scanned = 0;
  const limit = Math.max(1, Math.min(500, options.limit ?? DEFAULT_LIMIT3));
  for (const candidate of listCandidateFiles2(options.sourceCommsDir, dirs)) {
    let stat;
    try {
      stat = fs32.statSync(candidate.fullPath);
    } catch {
      continue;
    }
    if (!stat.isFile()) continue;
    scanned += 1;
    if (sinceMs && stat.mtimeMs < sinceMs) {
      skipped.old += 1;
      continue;
    }
    let content = "";
    try {
      content = fs32.readFileSync(candidate.fullPath, "utf8").replace(/^\uFEFF/, "");
    } catch {
      continue;
    }
    const metadata = parseMetadata2(candidate.filename, content);
    if (!options.includeAllSources && requiresOwnSource(candidate.dir) && !isOwnMessage3(metadata, aliases)) {
      skipped.notFromAgent += 1;
      continue;
    }
    const relativePath = `${candidate.dir}/${candidate.filename}`;
    const dedupeKey = metadata.messageId?.trim() || relativePath;
    if (state.uploaded[dedupeKey]) {
      skipped.duplicate += 1;
      continue;
    }
    const targetPath = path30.join(
      options.targetCommsDir,
      candidate.dir,
      candidate.filename
    );
    const targetExists = fs32.existsSync(targetPath);
    const skipReason = targetExists ? sameFileContent(candidate.fullPath, targetPath) ? "target-exists" : "collision" : "dry-run";
    items.push({
      dir: candidate.dir,
      filename: candidate.filename,
      sourcePath: candidate.fullPath,
      targetPath,
      relativePath,
      mtime: stat.mtime.toISOString(),
      dedupeKey,
      messageId: metadata.messageId,
      from: metadata.from,
      fromName: metadata.fromName,
      to: metadata.to,
      subject: metadata.subject,
      uploaded: false,
      skipReason
    });
    if (items.length >= limit) break;
  }
  return {
    status: items.length > 0 ? "pending" : "idle",
    items,
    scanned,
    skipped
  };
}
function applyUplink(items) {
  for (const item of items) {
    if (item.skipReason === "target-exists" || item.skipReason === "collision") {
      continue;
    }
    fs32.mkdirSync(path30.dirname(item.targetPath), { recursive: true });
    fs32.copyFileSync(item.sourcePath, item.targetPath);
    const sourceStat = fs32.statSync(item.sourcePath);
    fs32.utimesSync(item.targetPath, sourceStat.atime, sourceStat.mtime);
    item.uploaded = true;
    item.skipReason = null;
  }
}
function sleep4(ms) {
  return new Promise((resolve21) => setTimeout(resolve21, ms));
}
async function runLocalUplink(rawOptions) {
  const now = rawOptions.now ?? /* @__PURE__ */ new Date();
  const options = {
    ...rawOptions,
    now,
    sourceCommsDir: path30.resolve(rawOptions.sourceCommsDir),
    targetCommsDir: path30.resolve(rawOptions.targetCommsDir)
  };
  const sourceCommsDirLabel = rawOptions.sourceCommsDirLabel ?? options.sourceCommsDir;
  const aliases = unique3([
    options.agent,
    ...options.aliases ?? [],
    process.env.TAP_AGENT_ID ?? "",
    process.env.TAP_AGENT_NAME ?? ""
  ]);
  const warnings = [];
  const normalizedDirs = normalizeUplinkDirs(options.dirs);
  const dirs = normalizedDirs.dirs;
  if (normalizedDirs.disallowed > 0) {
    warnings.push(
      `Ignored ${normalizedDirs.disallowed} disallowed uplink dir(s); only append-only dirs are supported.`
    );
  }
  if (options.sourceCommsDir === options.targetCommsDir) {
    throw new RangeError(
      "Uplink source and target comms directories must differ."
    );
  }
  const statePath = resolveLocalUplinkStatePath({
    stateDir: options.stateDir,
    agent: options.agent,
    stateName: options.stateName
  });
  const state = loadState4(statePath, {
    agent: options.agent,
    aliases,
    sourceCommsDir: sourceCommsDirLabel,
    targetCommsDir: options.targetCommsDir,
    now,
    resetCursor: options.resetCursor
  });
  const sinceMs = parseSinceMs3(options, state);
  const maxIterations = options.mode === "watch" && options.maxIterations !== void 0 ? Math.max(1, options.maxIterations) : options.mode === "watch" ? 0 : 1;
  const intervalMs = Math.max(100, options.intervalMs ?? DEFAULT_INTERVAL_MS4);
  await options.beforeScan?.();
  let aggregate = scanUplink(options, state, aliases, dirs, sinceMs);
  if (options.mode === "watch") {
    let iteration = 1;
    while (aggregate.items.length === 0) {
      if (maxIterations > 0 && iteration >= maxIterations) break;
      iteration += 1;
      await sleep4(intervalMs);
      await options.beforeScan?.();
      aggregate = scanUplink(options, state, aliases, dirs, sinceMs);
    }
  }
  let stateWritten = false;
  if (options.mode === "apply" || options.mode === "watch") {
    if (aggregate.items.length > 0) {
      applyUplink(aggregate.items);
      markUploaded(state, aggregate.items, now.toISOString());
    }
    saveState4(statePath, state);
    stateWritten = true;
  }
  const uploaded = aggregate.items.some((item) => item.uploaded);
  const blocked2 = aggregate.items.some(
    (item) => item.skipReason === "collision"
  );
  return {
    mode: options.mode,
    agent: options.agent,
    aliases,
    sourceCommsDir: sourceCommsDirLabel,
    targetCommsDir: options.targetCommsDir,
    statePath,
    adapter: "local-uplink",
    receiveTransport: "polling",
    status: uploaded && options.mode !== "check" ? "uploaded" : blocked2 ? "blocked" : aggregate.status,
    dirs,
    items: aggregate.items,
    scanned: aggregate.scanned,
    skipped: aggregate.skipped,
    stateWritten,
    effectiveSince: sinceMs ? new Date(sinceMs).toISOString() : null,
    warnings
  };
}

// src/uplink/remote-uplink-source.ts
import { spawnSync as spawnSync5 } from "child_process";
import * as fs33 from "fs";
import * as path31 from "path";
function defaultRunner(command, args) {
  const result = spawnSync5(command, args, {
    encoding: "utf8",
    stdio: "pipe"
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? ""
  };
}
function assertSafeSshTarget(value) {
  if (!value.trim() || /[\r\n]/.test(value) || value.startsWith("-")) {
    throw new RangeError(`Invalid --source-ssh target: ${value}`);
  }
}
function assertSafeRemotePath(value) {
  if (!value.trim() || /[\r\n]/.test(value)) {
    throw new RangeError(`Invalid remote comms path: ${value}`);
  }
}
function remoteDirPath(remoteCommsDir, dir) {
  return `${remoteCommsDir.replace(/[\\/]+$/, "")}/${dir}/`;
}
function remoteRsyncSource(sshTarget, remoteCommsDir, dir) {
  return `${sshTarget}:${remoteDirPath(remoteCommsDir, dir)}`;
}
function parseChangedCount(stdout) {
  return stdout.split(/\r?\n/).filter((line) => line.startsWith(">f") || line.startsWith("cd")).length;
}
function summarizeOutput(value, maxLines = 20) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const lines = trimmed.split(/\r?\n/);
  if (lines.length <= maxLines) return trimmed;
  return [
    ...lines.slice(0, maxLines),
    `... truncated ${lines.length - maxLines} line(s) ...`
  ].join("\n");
}
function mirrorRemoteUplinkSource(options) {
  assertSafeSshTarget(options.sshTarget);
  assertSafeRemotePath(options.remoteCommsDir);
  const runner = options.runner ?? defaultRunner;
  const records = [];
  for (const dir of options.dirs) {
    if (!/^[A-Za-z0-9._-]+$/.test(dir)) {
      throw new RangeError(`Unsafe uplink dir: ${dir}`);
    }
    const targetDir = path31.join(options.localMirrorDir, dir);
    fs33.mkdirSync(targetDir, { recursive: true });
    const source = remoteRsyncSource(
      options.sshTarget,
      options.remoteCommsDir,
      dir
    );
    const target = `${targetDir.replace(/[\\/]+$/, "")}/`;
    const args = [
      "-a",
      "--ignore-existing",
      "--itemize-changes",
      "--include=*.md",
      "--include=*.json",
      "--exclude=*",
      source,
      target
    ];
    const result = runner("rsync", args);
    const record = {
      dir,
      source,
      target,
      status: result.status,
      changed: parseChangedCount(result.stdout),
      stdout: summarizeOutput(result.stdout),
      stderr: summarizeOutput(result.stderr)
    };
    records.push(record);
    if (result.status !== 0) {
      throw new Error(
        `Failed to mirror remote uplink source ${source}: ${record.stderr}`
      );
    }
  }
  return records;
}

// src/codex-a2a/binding-registry.ts
var DEFAULT_STALE_AFTER_MS = 30 * 60 * 1e3;
var HEALTH_SEVERITY = {
  "stuck-turn": 90,
  "stale-owner": 80,
  "stale-active-turn": 75,
  "active-turn": 70,
  partial: 60,
  "adapter-unavailable": 50,
  degraded: 40,
  "not-observed": 30,
  unknown: 20,
  ready: 10
};
var HEALTH_STATUSES = new Set(
  Object.keys(HEALTH_SEVERITY)
);
function normalizeString4(value) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}
function normalizeToken(value) {
  return normalizeString4(value)?.replace(/-/g, "_").toLowerCase() ?? null;
}
function isCodexLike(value) {
  const token = normalizeToken(value);
  return token === "codex" || Boolean(token?.startsWith("codex_"));
}
function toTime(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : Date.now();
  }
  return Date.now();
}
function normalizeAliases(values) {
  const aliases = [];
  for (const value of values) {
    const normalized = normalizeString4(value);
    if (!normalized || aliases.includes(normalized)) continue;
    aliases.push(normalized);
  }
  return aliases;
}
function metadataString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
function normalizeRuntimeHealth(value) {
  if (!value || typeof value !== "object") return null;
  const status = typeof value.status === "string" && HEALTH_STATUSES.has(value.status) ? value.status : null;
  if (!status) return null;
  return {
    status,
    reason: normalizeString4(value.reason),
    checkedAt: normalizeString4(value.checkedAt),
    adapter: normalizeString4(value.adapter),
    recovery: normalizeString4(value.recovery)
  };
}
function runtimeHealthTime(value) {
  const parsed = Date.parse(value.checkedAt ?? "");
  return Number.isFinite(parsed) ? parsed : 0;
}
function mergeRuntimeHealth(existing, next) {
  if (!existing) return next;
  if (!next) return existing;
  const severityDelta = HEALTH_SEVERITY[next.status] - HEALTH_SEVERITY[existing.status];
  if (severityDelta > 0) return next;
  if (severityDelta < 0) return existing;
  const existingTime = runtimeHealthTime(existing);
  const nextTime = runtimeHealthTime(next);
  if (nextTime > existingTime) return next;
  return existing;
}
function deriveStaleReason(options) {
  const status = normalizeString4(options.status);
  if (status && status !== "active") {
    return `status:${status}`;
  }
  if (!options.lastSeenAt) {
    return "missing-last-seen";
  }
  const lastSeenMs = Date.parse(options.lastSeenAt);
  if (!Number.isFinite(lastSeenMs)) {
    return "invalid-last-seen";
  }
  const ageMs = options.nowMs - lastSeenMs;
  if (ageMs > options.staleAfterMs) {
    return `stale:${ageMs}ms`;
  }
  return null;
}
function bindingKey(binding) {
  return [
    binding.routingAddress,
    binding.hostId ?? "",
    binding.clientId ?? "",
    binding.conversationId ?? "",
    binding.ownerClientId ?? ""
  ].join("\0");
}
function mergeBinding(existing, next) {
  const nextIsLiveObserve = next.sources.includes("observe") && next.staleReason === null;
  return {
    ...existing,
    agentName: existing.agentName ?? next.agentName,
    hostId: existing.hostId ?? next.hostId,
    clientId: existing.clientId ?? next.clientId,
    conversationId: existing.conversationId ?? next.conversationId,
    ownerClientId: existing.ownerClientId ?? next.ownerClientId,
    instanceId: existing.instanceId ?? next.instanceId,
    receiveTransports: normalizeReceiveTransports([
      ...existing.receiveTransports,
      ...next.receiveTransports
    ]),
    bindingStatus: existing.bindingStatus === "ready" || next.bindingStatus === "ready" ? "ready" : existing.bindingStatus === "partial" || next.bindingStatus === "partial" ? "partial" : "stale",
    lastSeenAt: nextIsLiveObserve ? next.lastSeenAt ?? existing.lastSeenAt : existing.lastSeenAt ?? next.lastSeenAt,
    staleReason: nextIsLiveObserve ? null : existing.staleReason ?? next.staleReason,
    health: mergeRuntimeHealth(existing.health, next.health),
    sources: [.../* @__PURE__ */ new Set([...existing.sources, ...next.sources])],
    aliases: normalizeAliases([...existing.aliases, ...next.aliases])
  };
}
function shouldIncludeHeartbeatBinding(heartbeat, receiveTransports) {
  return receiveTransports.includes("consent-drive") || isCodexLike(heartbeat.instanceId) || isCodexLike(heartbeat.address?.clientId) || isCodexLike(heartbeat.address?.routingAddress) || isCodexLike(heartbeat.source);
}
function buildHeartbeatBinding(key, heartbeat, nowMs, staleAfterMs) {
  const receiveTransports = normalizeReceiveTransports([
    ...heartbeat.receiveTransports ?? [],
    ...heartbeat.capabilities?.receiveTransports ?? []
  ]);
  if (!shouldIncludeHeartbeatBinding(heartbeat, receiveTransports)) {
    return null;
  }
  const id = normalizeString4(heartbeat.id) ?? key;
  const routingAddress = normalizeString4(heartbeat.address?.routingAddress) ?? normalizeString4(heartbeat.instanceId) ?? id;
  const lastSeenAt = normalizeString4(heartbeat.lastActivity) ?? normalizeString4(heartbeat.timestamp);
  const conversationId = normalizeString4(heartbeat.capabilities?.conversationId) ?? normalizeString4(heartbeat.address?.conversationId);
  const ownerClientId = normalizeString4(heartbeat.capabilities?.ownerClientId) ?? normalizeString4(heartbeat.address?.ownerClientId);
  const bindingStatus = deriveBindingStatus({
    conversationId,
    ownerClientId,
    staleReason: deriveStaleReason({
      status: heartbeat.status,
      lastSeenAt,
      nowMs,
      staleAfterMs
    })
  });
  return {
    agentName: normalizeString4(heartbeat.agent),
    routingAddress,
    runtime: "codex",
    hostId: normalizeString4(heartbeat.address?.hostId),
    clientId: normalizeString4(heartbeat.address?.clientId) ?? normalizeString4(heartbeat.instanceId),
    conversationId,
    ownerClientId,
    instanceId: normalizeString4(heartbeat.instanceId),
    receiveTransports,
    lastSeenAt,
    staleReason: bindingStatus === "stale" ? deriveStaleReason({
      status: heartbeat.status,
      lastSeenAt,
      nowMs,
      staleAfterMs
    }) : null,
    health: normalizeRuntimeHealth(heartbeat.health),
    bindingStatus,
    sources: ["heartbeat"],
    aliases: normalizeAliases([
      id,
      heartbeat.agent,
      routingAddress,
      heartbeat.instanceId,
      ...heartbeat.address?.aliases ?? []
    ])
  };
}
function findAgentNameForClient(snapshot, clientId) {
  if (!clientId) return null;
  const agent = snapshot.agents.find((candidate) => candidate.id === clientId);
  return agent?.name ?? null;
}
function buildObserveBindings(snapshot, nowIso) {
  if (!snapshot.connected) {
    return [];
  }
  const bindings = [];
  for (const conversation of snapshot.conversations) {
    const ownerClientId = normalizeString4(conversation.address.ownerClientId);
    const conversationId = normalizeString4(conversation.id);
    if (!ownerClientId || !conversationId) continue;
    const metadata = conversation.metadata;
    const lastSeenAt = metadataString(metadata.lastActivity) ?? nowIso;
    const routingAddress = normalizeString4(conversation.address.clientId) ?? ownerClientId;
    bindings.push({
      agentName: findAgentNameForClient(snapshot, ownerClientId),
      routingAddress,
      runtime: "codex",
      hostId: normalizeString4(conversation.address.hostId),
      clientId: normalizeString4(conversation.address.clientId) ?? ownerClientId,
      conversationId,
      ownerClientId,
      instanceId: null,
      receiveTransports: ["consent-drive"],
      bindingStatus: "ready",
      lastSeenAt,
      staleReason: null,
      health: null,
      sources: ["observe"],
      aliases: normalizeAliases([routingAddress, ownerClientId])
    });
  }
  return bindings;
}
function buildCodexBindingRegistry(options = {}) {
  const nowMs = toTime(options.now);
  const nowIso = new Date(nowMs).toISOString();
  const staleAfterMs = options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
  const byKey = /* @__PURE__ */ new Map();
  for (const [key, heartbeat] of Object.entries(options.heartbeats ?? {})) {
    const binding = buildHeartbeatBinding(key, heartbeat, nowMs, staleAfterMs);
    if (!binding) continue;
    const existing = byKey.get(bindingKey(binding));
    byKey.set(
      bindingKey(binding),
      existing ? mergeBinding(existing, binding) : binding
    );
  }
  if (options.observeSnapshot) {
    for (const binding of buildObserveBindings(
      options.observeSnapshot,
      nowIso
    )) {
      const existing = byKey.get(bindingKey(binding));
      byKey.set(
        bindingKey(binding),
        existing ? mergeBinding(existing, binding) : binding
      );
    }
  }
  return {
    bindings: [...byKey.values()].sort(
      (a, b) => a.routingAddress.localeCompare(b.routingAddress)
    ),
    builtAt: nowIso,
    staleAfterMs
  };
}
function deriveBindingStatus(options) {
  if (options.staleReason) return "stale";
  if (options.conversationId && options.ownerClientId) return "ready";
  if (options.conversationId || options.ownerClientId) return "partial";
  return "partial";
}
function matchesTarget(binding, target) {
  const requestedAddress = normalizeString4(target.routingAddress);
  const requestedAgent = normalizeString4(target.agentName);
  if (requestedAddress && binding.routingAddress !== requestedAddress && !binding.aliases.includes(requestedAddress)) {
    return false;
  }
  if (requestedAgent && binding.agentName !== requestedAgent && !binding.aliases.includes(requestedAgent)) {
    return false;
  }
  const constraints = [
    [target.hostId, binding.hostId],
    [target.clientId, binding.clientId],
    [target.conversationId, binding.conversationId],
    [target.ownerClientId, binding.ownerClientId]
  ];
  return constraints.every(([requested, actual]) => {
    const normalizedRequested = normalizeString4(requested);
    return !normalizedRequested || normalizedRequested === actual;
  });
}
function hasExplicitTargetSelector(target) {
  return Boolean(
    normalizeString4(target.routingAddress) || normalizeString4(target.agentName) || normalizeString4(target.clientId) || normalizeString4(target.conversationId) || normalizeString4(target.ownerClientId)
  );
}
function liveSnapshotMatches(binding, snapshot) {
  if (!snapshot || !binding.conversationId || !binding.ownerClientId) {
    return true;
  }
  if (!snapshot.connected) {
    return false;
  }
  return snapshot.conversations.some((conversation) => {
    const address = conversation.address;
    return conversation.id === binding.conversationId && address.ownerClientId === binding.ownerClientId && (!binding.hostId || !address.hostId || address.hostId === binding.hostId);
  });
}
function toAddress(binding) {
  return {
    hostId: binding.hostId,
    clientId: binding.clientId,
    conversationId: binding.conversationId,
    ownerClientId: binding.ownerClientId
  };
}
function blocked(reason, candidates, message) {
  return {
    status: "blocked",
    reason,
    candidates,
    message
  };
}
function resolveCodexBinding(options) {
  if (!hasExplicitTargetSelector(options.target)) {
    return blocked(
      "missing-target",
      [],
      "Codex binding resolution requires an explicit target selector."
    );
  }
  const candidates = options.registry.bindings.filter(
    (binding) => matchesTarget(binding, options.target)
  );
  if (candidates.length === 0) {
    return blocked("not-found", [], "No Codex binding matched the target.");
  }
  const freshCandidates = candidates.filter((binding) => !binding.staleReason);
  if (freshCandidates.length === 0) {
    return blocked("stale", candidates, "Only stale Codex bindings matched.");
  }
  const readyCandidates = freshCandidates.filter(
    (binding) => binding.bindingStatus === "ready"
  );
  if (readyCandidates.length === 0) {
    return blocked(
      "partial",
      freshCandidates,
      "Only partial Codex bindings matched; conversationId and ownerClientId are both required."
    );
  }
  const liveCandidates = readyCandidates.filter(
    (binding) => liveSnapshotMatches(binding, options.liveSnapshot)
  );
  if (liveCandidates.length === 0) {
    return blocked(
      "binding-mismatch",
      freshCandidates,
      "Matched Codex bindings were not present in the live observe snapshot."
    );
  }
  const reachableCandidates = liveCandidates.filter(
    (binding) => canUseConsentDriveForAddress({
      localHostId: options.localHostId,
      address: toAddress(binding)
    })
  );
  if (reachableCandidates.length === 0) {
    return blocked(
      "not-reachable",
      liveCandidates,
      "Matched Codex bindings are not reachable from the local host."
    );
  }
  if (reachableCandidates.length > 1) {
    return blocked(
      "ambiguous",
      reachableCandidates,
      "Multiple fresh Codex bindings matched the target."
    );
  }
  return {
    status: "resolved",
    binding: reachableCandidates[0]
  };
}

// src/routing/codex-owner-discovery.ts
var DEFAULT_DISCOVERY_TIMEOUT_MS = 3e3;
function normalizeString5(value) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}
function resolveTimeoutMs(explicitTimeoutMs) {
  if (typeof explicitTimeoutMs === "number" && explicitTimeoutMs > 0) {
    return explicitTimeoutMs;
  }
  const envValue = Number(process.env.TAP_CODEX_OWNER_DISCOVERY_TIMEOUT_MS);
  if (Number.isFinite(envValue) && envValue > 0) {
    return envValue;
  }
  return DEFAULT_DISCOVERY_TIMEOUT_MS;
}
function isDiscoverySupported() {
  const override = process.env.TAP_CODEX_OWNER_DISCOVERY?.trim().toLowerCase();
  if (override === "1" || override === "true" || override === "yes") {
    return true;
  }
  if (override === "0" || override === "false" || override === "no") {
    return false;
  }
  return isCodexIpcDefaultSupported();
}
function findOwnerInSnapshot(snapshot, conversationId) {
  if (!snapshot.connected) return null;
  const conversation = snapshot.conversations.find(
    (candidate) => candidate.id === conversationId
  );
  const ownerClientId = normalizeString5(conversation?.address.ownerClientId);
  if (!ownerClientId) return null;
  return {
    ownerClientId,
    hostId: normalizeString5(conversation?.address.hostId)
  };
}
async function waitForOwner(options) {
  return await new Promise((resolve21) => {
    const unsubscribe = options.transport.subscribe((event) => {
      const found = findOwnerInSnapshot(event.snapshot, options.conversationId);
      if (!found) return;
      cleanup();
      resolve21({
        status: "found",
        conversationId: options.conversationId,
        ownerClientId: found.ownerClientId,
        hostId: found.hostId,
        source: "event"
      });
    });
    const timeout = setTimeout(() => {
      cleanup();
      resolve21(null);
    }, options.timeoutMs);
    function cleanup() {
      clearTimeout(timeout);
      unsubscribe();
    }
  });
}
async function discoverCodexOwnerClientId(options) {
  const conversationId = normalizeString5(options.conversationId);
  if (!conversationId) {
    return {
      status: "unavailable",
      conversationId: "",
      message: "conversationId is required for Codex owner discovery."
    };
  }
  if (!isDiscoverySupported() && !options.transport && !options.transportFactory) {
    return {
      status: "unavailable",
      conversationId,
      message: "Codex owner discovery is only enabled on Windows/macOS IPC hosts by default."
    };
  }
  const timeoutMs = resolveTimeoutMs(options.timeoutMs);
  const transport = options.transport ?? options.transportFactory?.({
    hostId: options.hostId,
    requestTimeoutMs: timeoutMs
  }) ?? createExperimentalCodexIpcObserveTransport({
    hostId: options.hostId,
    requestTimeoutMs: timeoutMs
  });
  const ownsTransport = !options.transport;
  try {
    const snapshot = await transport.connect();
    const found = findOwnerInSnapshot(snapshot, conversationId);
    if (found) {
      return {
        status: "found",
        conversationId,
        ownerClientId: found.ownerClientId,
        hostId: found.hostId,
        source: "snapshot"
      };
    }
    const eventFound = await waitForOwner({
      transport,
      conversationId,
      timeoutMs
    });
    if (eventFound) return eventFound;
    return {
      status: "not-found",
      conversationId,
      message: `No live Codex ownerClientId observed for conversationId ${conversationId}.`
    };
  } catch (error) {
    return {
      status: "unavailable",
      conversationId,
      message: error instanceof Error ? error.message : String(error ?? "Codex owner discovery failed.")
    };
  } finally {
    if (ownsTransport) {
      await transport.disconnect().catch(() => void 0);
    }
  }
}

// src/transport/experimental/codex-ipc-control.ts
import { randomUUID as randomUUID5 } from "crypto";

// src/transport/consent-ledger.ts
import { randomUUID as randomUUID4 } from "crypto";
import * as fs34 from "fs";
import * as path32 from "path";
function normalizeString6(value) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}
function normalizeAddress5(value) {
  if (!value) {
    return null;
  }
  const address = {
    hostId: normalizeString6(value.hostId),
    clientId: normalizeString6(value.clientId),
    conversationId: normalizeString6(value.conversationId),
    ownerClientId: normalizeString6(value.ownerClientId)
  };
  return Object.values(address).some((field) => field) ? address : null;
}
function isConsentLedgerEnabled() {
  const normalized = process.env.TAP_CONSENT_LEDGER?.trim().toLowerCase();
  if (!normalized) {
    return true;
  }
  return !["0", "false", "no", "off"].includes(normalized);
}
function resolveConsentLedgerDir(commsDir) {
  const resolvedCommsDir = normalizeString6(commsDir) ?? normalizeString6(process.env.TAP_COMMS_DIR);
  if (!resolvedCommsDir) {
    return null;
  }
  return path32.join(
    path32.resolve(resolvedCommsDir),
    "receipts",
    "consent-ledger"
  );
}
var MISSING_CONSENT_REF_ORPHAN_REASON = "missing_consent_ref";
function resolveGrantId(event, grantId) {
  if (grantId) {
    return {
      grantId,
      orphanReason: null
    };
  }
  if (event !== "rejected") {
    return {
      grantId: null,
      orphanReason: null
    };
  }
  return {
    grantId: `orphan-${Date.now().toString(36)}-${randomUUID4().slice(0, 8)}`,
    orphanReason: MISSING_CONSENT_REF_ORPHAN_REASON
  };
}
function formatLedgerTimestamp(value) {
  return value.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}
function buildLedgerFilePath(ledgerDir, record) {
  const timestamp = formatLedgerTimestamp(record.recordedAt);
  const shortGrantId = record.grantId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 8) || "unknown";
  const baseName = `${timestamp}-${record.event}-${shortGrantId}`;
  const preferredPath = path32.join(ledgerDir, `${baseName}.md`);
  if (!fs34.existsSync(preferredPath)) {
    return preferredPath;
  }
  return path32.join(
    ledgerDir,
    `${baseName}-${randomUUID4().replace(/-/g, "").slice(0, 6)}.md`
  );
}
function buildFrontmatter(record) {
  const fields = [
    ["type", "consent-ledger"],
    ["event", record.event],
    ["grant_id", record.grantId],
    ["orphan_reason", record.orphanReason],
    ["scope", record.scope],
    ["method", record.method],
    ["host_id", record.hostId],
    ["conversation_id", record.conversationId],
    ["issued_at", record.issuedAt],
    ["expires_at", record.expiresAt],
    ["consumed_at", record.consumedAt],
    ["recorded_at", record.recordedAt],
    ["result", record.result],
    ["issued_by_client_id", record.issuedByClientId],
    ["requester", record.requester],
    ["owner", record.owner]
  ];
  const lines = fields.map(
    ([key, value]) => `${key}: ${JSON.stringify(value ?? null)}`
  );
  return `---
${lines.join("\n")}
---

`;
}
function buildBody(record) {
  return [
    "# Consent Ledger Event",
    "",
    `- Event: \`${record.event}\``,
    `- Grant: \`${record.grantId}\``,
    ...record.orphanReason ? [`- Orphan Reason: \`${record.orphanReason}\``] : [],
    `- Scope: \`${record.scope}\``,
    `- Result: \`${record.result}\``,
    "",
    "## Owner",
    "",
    "```json",
    JSON.stringify(record.owner, null, 2),
    "```",
    "",
    "## Requester",
    "",
    "```json",
    JSON.stringify(record.requester, null, 2),
    "```",
    ""
  ].join("\n");
}
function writeConsentLedgerEvent(options) {
  if (!isConsentLedgerEnabled()) {
    return null;
  }
  const { grantId, orphanReason } = resolveGrantId(
    options.event,
    normalizeString6(options.grantId)
  );
  const result = normalizeString6(options.result);
  const ledgerDir = resolveConsentLedgerDir(options.commsDir);
  if (!grantId || !result || !ledgerDir) {
    return null;
  }
  const record = {
    event: options.event,
    grantId,
    orphanReason,
    scope: options.scope,
    method: normalizeString6(options.method),
    hostId: normalizeString6(options.hostId),
    conversationId: normalizeString6(options.conversationId),
    issuedAt: normalizeString6(options.issuedAt),
    expiresAt: normalizeString6(options.expiresAt),
    consumedAt: normalizeString6(options.consumedAt),
    recordedAt: normalizeString6(options.recordedAt) ?? (/* @__PURE__ */ new Date()).toISOString(),
    result,
    requester: normalizeAddress5(options.requester),
    owner: normalizeAddress5(options.owner),
    issuedByClientId: normalizeString6(options.issuedByClientId)
  };
  try {
    fs34.mkdirSync(ledgerDir, { recursive: true });
    const filePath = buildLedgerFilePath(ledgerDir, record);
    fs34.writeFileSync(
      filePath,
      buildFrontmatter(record) + buildBody(record),
      "utf-8"
    );
    return filePath;
  } catch {
    return null;
  }
}

// src/transport/experimental/codex-ipc-control.ts
function asJsonRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value;
}
var CODEX_IPC_DRIVE_METHODS = [
  "thread-follower-start-turn",
  "thread-follower-steer-turn",
  "thread-follower-interrupt-turn",
  "thread-follower-edit-last-user-turn",
  "thread-follower-submit-user-input",
  "thread-follower-submit-mcp-server-elicitation-response",
  "thread-follower-command-approval-decision",
  "thread-follower-file-approval-decision",
  "thread-follower-permissions-request-approval-response",
  "thread-follower-compact-thread",
  "thread-follower-set-model-and-reasoning",
  "thread-follower-set-collaboration-mode",
  "thread-follower-set-queued-follow-ups-state"
];
var STABILITY_GUARDED_METHODS = /* @__PURE__ */ new Set([
  "thread-follower-start-turn"
]);
var globalLocksKey = /* @__PURE__ */ Symbol.for("tap-comms:conversationLocks");
var globalDriveTimeKey = /* @__PURE__ */ Symbol.for("tap-comms:conversationLastDriveTime");
var globalStabilityGuardStore = globalThis;
var sharedConversationLocks = globalStabilityGuardStore[globalLocksKey] ?? /* @__PURE__ */ new Map();
if (!globalStabilityGuardStore[globalLocksKey]) {
  globalStabilityGuardStore[globalLocksKey] = sharedConversationLocks;
}
var sharedConversationLastDriveTime = globalStabilityGuardStore[globalDriveTimeKey] ?? /* @__PURE__ */ new Map();
if (!globalStabilityGuardStore[globalDriveTimeKey]) {
  globalStabilityGuardStore[globalDriveTimeKey] = sharedConversationLastDriveTime;
}
function normalizeAddress6(value) {
  return {
    hostId: value.hostId?.trim() || null,
    clientId: value.clientId?.trim() || null,
    conversationId: value.conversationId?.trim() || null,
    ownerClientId: value.ownerClientId?.trim() || null
  };
}
function isDriveMethod(method) {
  return CODEX_IPC_DRIVE_METHODS.includes(method);
}
function normalizeMethod(method) {
  const normalized = method.trim();
  if (!isDriveMethod(normalized)) {
    throw new Error(`Unsupported Codex IPC drive method "${method}".`);
  }
  return normalized;
}
function normalizeActionLabel(action, method) {
  const normalized = action?.trim();
  return normalized || method;
}
function asRecord2(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value;
}
function listRecordKeys2(value) {
  if (!value) {
    return null;
  }
  return Object.keys(value);
}
function summarizeDriveParams(params) {
  const turnStartParams = asRecord2(params?.turnStartParams);
  const input = Array.isArray(turnStartParams?.input) ? turnStartParams.input : null;
  const textLength = input?.reduce((total, item) => {
    const record = asRecord2(item);
    return total + (typeof record?.text === "string" ? record.text.length : 0);
  }, 0);
  return {
    paramKeys: listRecordKeys2(params),
    turnStartParamKeys: listRecordKeys2(turnStartParams),
    inputItemCount: input?.length ?? null,
    textLength: textLength ?? null
  };
}
function extractDriveTurnId(response) {
  const result = asRecord2(response.result);
  const nested = asRecord2(result?.result);
  const turn = asRecord2(result?.turn) ?? asRecord2(nested?.turn);
  const turnId = turn?.id;
  return typeof turnId === "string" && turnId.trim() ? turnId.trim() : null;
}
function extractConversationLastTurnStatus(conversation) {
  const change = asRecord2(conversation?.metadata.change);
  const turn = asRecord2(change?.turn);
  const turnStatus = turn?.status;
  if (typeof turnStatus === "string" && turnStatus.trim()) {
    return turnStatus.trim();
  }
  const conversationState = asRecord2(change?.conversationState);
  const turns = Array.isArray(conversationState?.turns) ? conversationState.turns : null;
  const lastTurn = turns?.length ? asRecord2(turns[turns.length - 1]) : null;
  const lastStatus = lastTurn?.status;
  return typeof lastStatus === "string" && lastStatus.trim() ? lastStatus.trim() : null;
}
function extractRejectionResult(error) {
  if (error && typeof error === "object" && "code" in error && typeof error.code === "string") {
    return error.code;
  }
  return "execution-rejected";
}
function buildFollowerStartTurnParams(options) {
  const turnStartParams = { ...options.turnStartParams ?? {} };
  const text = options.text.trim();
  if (!text) {
    throw new Error(
      "thread-follower-start-turn requires a non-empty text input."
    );
  }
  const existingInput = Array.isArray(turnStartParams.input) ? turnStartParams.input : null;
  if (!existingInput) {
    turnStartParams.input = [
      {
        type: "text",
        text,
        text_elements: []
      }
    ];
  }
  if (!Array.isArray(turnStartParams.attachments)) {
    turnStartParams.attachments = [];
  }
  if (!Array.isArray(turnStartParams.commentAttachments)) {
    turnStartParams.commentAttachments = [];
  }
  if (typeof turnStartParams.inheritThreadSettings !== "boolean") {
    turnStartParams.inheritThreadSettings = true;
  }
  return {
    conversationId: options.conversationId,
    turnStartParams
  };
}
var ExperimentalCodexIpcControlTransport = class extends ExperimentalCodexIpcObserveTransport {
  kind = "experimental-codex-ipc-control";
  commsDir;
  receiptsDir;
  secretsDir;
  defaultConsentTtlSeconds;
  reservationOwnerId;
  conversationLocks = sharedConversationLocks;
  conversationLastDriveTime = sharedConversationLastDriveTime;
  COOLDOWN_MS = 1e4;
  LOCK_TIMEOUT_MS = 6e4;
  RECIPIENT_STATE_WAIT_MS = 750;
  constructor(options = {}) {
    super({
      ...options,
      clientType: options.clientType ?? "tap-control"
    });
    this.commsDir = options.commsDir;
    this.receiptsDir = options.receiptsDir;
    this.secretsDir = options.secretsDir;
    this.defaultConsentTtlSeconds = options.defaultConsentTtlSeconds ?? DEFAULT_CONSENT_TTL_SECONDS;
    this.reservationOwnerId = options.reservationOwnerId?.trim() || randomUUID5();
    this.subscribe((event) => {
      if (event.kind === "conversation-state") {
        const conversationId = event.sourceAddress.conversationId;
        if (!conversationId) return;
        const payload = asJsonRecord(event.payload);
        const params = asJsonRecord(payload?.params);
        const change = asJsonRecord(params?.change);
        const turn = asJsonRecord(change?.turn);
        if (turn) {
          const status = turn.status;
          this.trace("guard:observe-turn-status", {
            conversationId,
            turnId: turn.id,
            status
          });
          if (status === "completed" || status === "failed" || status === "cancelled") {
            this.trace("guard:release-lock", {
              conversationId,
              turnId: turn.id,
              status
            });
            this.releaseLock(conversationId);
          }
        }
      }
    });
  }
  acquireLock(conversationId) {
    const existing = this.conversationLocks.get(conversationId);
    if (existing?.timer) {
      clearTimeout(existing.timer);
    }
    const timer = setTimeout(() => {
      this.trace("guard:lock-timeout", { conversationId });
      this.conversationLocks.delete(conversationId);
    }, this.LOCK_TIMEOUT_MS);
    if (timer && typeof timer.unref === "function") {
      timer.unref();
    }
    this.conversationLocks.set(conversationId, { timer });
  }
  releaseLock(conversationId) {
    const existing = this.conversationLocks.get(conversationId);
    if (existing) {
      if (existing.timer) {
        clearTimeout(existing.timer);
      }
      this.conversationLocks.delete(conversationId);
    }
  }
  getConversationSnapshot(conversationId) {
    return this.getSnapshot().conversations.find(
      (conversation) => conversation.id === conversationId
    ) ?? null;
  }
  async waitForConversationSnapshot(conversationId) {
    const existing = this.getConversationSnapshot(conversationId);
    if (existing) return existing;
    return await new Promise((resolve21) => {
      let unsubscribe = null;
      const timeout = setTimeout(() => {
        unsubscribe?.();
        resolve21(this.getConversationSnapshot(conversationId));
      }, this.RECIPIENT_STATE_WAIT_MS);
      if (typeof timeout.unref === "function") {
        timeout.unref();
      }
      unsubscribe = this.subscribe((event) => {
        if (event.kind !== "conversation-state" || event.sourceAddress.conversationId !== conversationId) {
          return;
        }
        clearTimeout(timeout);
        unsubscribe?.();
        resolve21(
          event.snapshot.conversations.find(
            (conversation) => conversation.id === conversationId
          ) ?? this.getConversationSnapshot(conversationId)
        );
      });
    });
  }
  async assertRecipientCanStartTurn(conversationId, method) {
    const conversation = await this.waitForConversationSnapshot(conversationId);
    const lastStatus = extractConversationLastTurnStatus(conversation);
    if (lastStatus === "inProgress") {
      this.trace("guard:recipient-active-turn", {
        conversationId,
        method,
        lastStatus
      });
      throw new Error(
        `[Stability Guard] Recipient conversation "${conversationId}" has an active in-progress turn; refusing "${method}" to avoid a stuck nested turn.`
      );
    }
  }
  createConsentReceipt(options) {
    const targetAddress = this.resolveConversationTargetAddress(
      options.conversationId,
      {
        hostId: options.hostId ?? null,
        ownerClientId: options.ownerClientId ?? null
      }
    );
    const createOptions = {
      receiptsDir: this.receiptsDir,
      secretsDir: this.secretsDir,
      scope: options.scope ?? "drive",
      hostId: targetAddress.hostId,
      conversationId: options.conversationId,
      ownerClientId: targetAddress.ownerClientId,
      issuedByClientId: this.getOwnClientId(),
      ttlSeconds: options.ttlSeconds ?? this.defaultConsentTtlSeconds,
      allowedMethods: [...options.allowedMethods ?? []]
    };
    const created = createConsentReceipt(createOptions);
    writeConsentLedgerEvent({
      commsDir: this.commsDir,
      event: "issued",
      grantId: created.receipt.id,
      scope: created.receipt.scope,
      method: created.receipt.allowedMethods.length === 1 ? created.receipt.allowedMethods[0] : null,
      hostId: created.receipt.hostId,
      conversationId: created.receipt.conversationId,
      issuedAt: created.receipt.createdAt,
      expiresAt: created.receipt.expiresAt,
      result: "granted",
      requester: this.buildSourceAddress(options.conversationId, targetAddress),
      owner: targetAddress,
      issuedByClientId: created.receipt.issuedByClientId
    });
    return created;
  }
  createStartTurnSuggestion(options) {
    return this.createSuggestion({
      conversationId: options.conversationId,
      method: "thread-follower-start-turn",
      params: buildFollowerStartTurnParams(options),
      action: options.action ?? "start-turn",
      consentRef: options.consentRef ?? null
    });
  }
  createSuggestion(options) {
    const method = normalizeMethod(options.method);
    const targetAddress = this.resolveConversationTargetAddress(
      options.conversationId
    );
    const sourceAddress = this.buildSourceAddress(
      options.conversationId,
      targetAddress
    );
    return {
      id: randomUUID5(),
      createdAt: (/* @__PURE__ */ new Date()).toISOString(),
      status: "pending-owner-approval",
      scope: "suggest",
      method,
      action: normalizeActionLabel(options.action, method),
      conversationId: options.conversationId,
      payload: options.params ?? null,
      sourceAddress,
      targetAddress,
      consentRef: options.consentRef?.trim() || null
    };
  }
  async startTurn(options) {
    return this.driveAction({
      conversationId: options.conversationId,
      method: "thread-follower-start-turn",
      params: buildFollowerStartTurnParams(options),
      action: options.action ?? "start-turn",
      consentRef: options.consentRef ?? null,
      hostId: options.hostId ?? null,
      ownerClientId: options.ownerClientId ?? null
    });
  }
  async driveAction(options) {
    const method = normalizeMethod(options.method);
    const conversationId = options.conversationId.trim();
    const isGuarded = STABILITY_GUARDED_METHODS.has(method);
    const targetAddress = this.resolveConversationTargetAddress(
      conversationId,
      {
        hostId: options.hostId ?? null,
        ownerClientId: options.ownerClientId ?? null
      }
    );
    const ownerClientId = targetAddress.ownerClientId?.trim();
    if (!ownerClientId) {
      throw new Error(
        `Conversation "${conversationId}" does not have a live ownerClientId.`
      );
    }
    const sourceAddress = this.buildSourceAddress(
      conversationId,
      targetAddress
    );
    this.trace("drive:prepare", {
      conversationId,
      method,
      action: normalizeActionLabel(options.action, method),
      consentRef: options.consentRef ?? null,
      hostId: targetAddress.hostId,
      ownerClientId,
      ...summarizeDriveParams(options.params)
    });
    let preparedReceipt = null;
    let guardLockAcquired = false;
    try {
      preparedReceipt = prepareConsentReceipt({
        receiptsDir: this.receiptsDir,
        secretsDir: this.secretsDir,
        consentRef: options.consentRef ?? null,
        requiredScope: "drive",
        method,
        hostId: targetAddress.hostId,
        conversationId,
        ownerClientId,
        reservationOwnerId: this.reservationOwnerId
      });
      if (isGuarded) {
        await this.assertRecipientCanStartTurn(conversationId, method);
        if (this.conversationLocks.has(conversationId)) {
          this.trace("guard:locked", { conversationId, method });
          throw new Error(
            `[Stability Guard] Rejecting "${method}". Conversation "${conversationId}" has an active in-progress turn.`
          );
        }
        const now = Date.now();
        const lastDrive = this.conversationLastDriveTime.get(conversationId) ?? 0;
        const elapsed = now - lastDrive;
        if (elapsed < this.COOLDOWN_MS) {
          const waitTime = this.COOLDOWN_MS - elapsed;
          this.trace("guard:cooldown", {
            conversationId,
            method,
            remainingMs: waitTime
          });
          throw new Error(
            `[Stability Guard] Cooldown active for "${method}" on conversation "${conversationId}". Wait ${Math.ceil(waitTime / 1e3)}s.`
          );
        }
        this.acquireLock(conversationId);
        guardLockAcquired = true;
      }
      this.trace("drive:request", {
        conversationId,
        method,
        ownerClientId
      });
      const response = await this.sendRequest(
        method,
        options.params,
        ownerClientId
      );
      this.trace("drive:response", {
        conversationId,
        method,
        ownerClientId,
        turnId: extractDriveTurnId(response),
        resultType: response.resultType ?? null
      });
      preparedReceipt.commit();
      if (isGuarded) {
        this.conversationLastDriveTime.set(conversationId, Date.now());
      }
      const executedAt = (/* @__PURE__ */ new Date()).toISOString();
      writeConsentLedgerEvent({
        commsDir: this.commsDir,
        event: "consumed",
        grantId: preparedReceipt.receipt.id,
        scope: preparedReceipt.receipt.scope,
        method,
        hostId: targetAddress.hostId,
        conversationId,
        issuedAt: preparedReceipt.receipt.createdAt,
        expiresAt: preparedReceipt.receipt.expiresAt,
        consumedAt: executedAt,
        recordedAt: executedAt,
        result: "executed",
        requester: sourceAddress,
        owner: targetAddress,
        issuedByClientId: preparedReceipt.receipt.issuedByClientId
      });
      return {
        executedAt,
        scope: "drive",
        method,
        action: normalizeActionLabel(options.action, method),
        conversationId,
        sourceAddress,
        targetAddress,
        consentRef: preparedReceipt.receipt.id,
        receipt: preparedReceipt.receipt,
        response
      };
    } catch (error) {
      if (guardLockAcquired) this.releaseLock(conversationId);
      this.trace("drive:error", {
        conversationId,
        method,
        ownerClientId,
        error: error instanceof Error ? error.stack ?? error.message : String(error)
      });
      preparedReceipt?.abort();
      writeConsentLedgerEvent({
        commsDir: this.commsDir,
        event: "rejected",
        grantId: preparedReceipt?.receipt.id ?? options.consentRef ?? null,
        scope: preparedReceipt?.receipt.scope ?? "drive",
        method,
        hostId: targetAddress.hostId,
        conversationId,
        issuedAt: preparedReceipt?.receipt.createdAt ?? null,
        expiresAt: preparedReceipt?.receipt.expiresAt ?? null,
        recordedAt: (/* @__PURE__ */ new Date()).toISOString(),
        result: extractRejectionResult(error),
        requester: sourceAddress,
        owner: targetAddress,
        issuedByClientId: preparedReceipt?.receipt.issuedByClientId ?? this.getOwnClientId()
      });
      throw error;
    }
  }
  resolveConversationTargetAddress(conversationId, fallback) {
    const normalizedConversationId = conversationId.trim();
    if (!normalizedConversationId) {
      throw new Error(
        "Codex IPC control actions require a non-empty conversationId."
      );
    }
    const conversation = this.getSnapshot().conversations.find(
      (candidate) => candidate.id === normalizedConversationId
    );
    if (conversation) {
      return normalizeAddress6(conversation.address);
    }
    const ownerClientId = fallback?.ownerClientId?.trim() || null;
    const hostId = fallback?.hostId?.trim() || this.getHostId();
    if (!ownerClientId) {
      throw new Error(
        `Conversation "${normalizedConversationId}" is not present in the current observe snapshot.`
      );
    }
    return {
      hostId,
      clientId: ownerClientId,
      conversationId: normalizedConversationId,
      ownerClientId
    };
  }
  buildSourceAddress(conversationId, targetAddress) {
    return {
      hostId: this.getHostId(),
      clientId: this.getOwnClientId(),
      conversationId,
      ownerClientId: targetAddress.ownerClientId
    };
  }
};
function createExperimentalCodexIpcControlTransport(options = {}) {
  return new ExperimentalCodexIpcControlTransport(options);
}

// src/api/state.ts
init_dashboard();
init_utils();
init_config();
init_state();
import * as fs44 from "fs";
import * as path44 from "path";
function getDashboardSnapshot(options) {
  const repoRoot = options?.repoRoot ?? findRepoRoot();
  return collectDashboardSnapshot(repoRoot, options?.commsDir);
}
async function* streamEvents(options) {
  const intervalMs = options?.intervalMs ?? 2e3;
  const repoRoot = options?.repoRoot ?? findRepoRoot();
  while (!options?.signal?.aborted) {
    yield collectDashboardSnapshot(repoRoot, options?.commsDir);
    await new Promise((resolve21) => {
      const onAbort = () => {
        clearTimeout(timer);
        resolve21();
      };
      const timer = setTimeout(() => {
        options?.signal?.removeEventListener("abort", onAbort);
        resolve21();
      }, intervalMs);
      options?.signal?.addEventListener("abort", onAbort, { once: true });
    });
  }
}
async function startAgents(options) {
  const { upCommand: upCommand2 } = await Promise.resolve().then(() => (init_up(), up_exports));
  const result = await upCommand2(options?.args ?? []);
  const repoRoot = findRepoRoot();
  const snapshot = collectDashboardSnapshot(repoRoot);
  return {
    ok: result.ok,
    message: result.message,
    snapshot,
    commandResult: result
  };
}
async function stopAgents() {
  const { downCommand: downCommand2 } = await Promise.resolve().then(() => (init_down(), down_exports));
  const result = await downCommand2([]);
  const repoRoot = findRepoRoot();
  const snapshot = collectDashboardSnapshot(repoRoot);
  return {
    ok: result.ok,
    message: result.message,
    snapshot,
    commandResult: result
  };
}
function getHealthReport(options) {
  const repoRoot = options?.repoRoot ?? findRepoRoot();
  const snapshot = collectDashboardSnapshot(repoRoot, options?.commsDir);
  const headlessStates = [];
  try {
    const state = loadState(repoRoot);
    const activeMatchers = /* @__PURE__ */ new Set();
    if (state) {
      for (const [id, inst] of Object.entries(state.instances)) {
        if (inst?.installed && inst.bridgeMode === "app-server") {
          activeMatchers.add(id);
          if (inst.defaultAgentName) activeMatchers.add(inst.defaultAgentName);
        }
      }
    }
    const tmpDir = path44.join(repoRoot, ".tmp");
    if (fs44.existsSync(tmpDir)) {
      for (const dir of fs44.readdirSync(tmpDir)) {
        if (!dir.startsWith("codex-app-server-bridge")) continue;
        const suffix = dir.replace("codex-app-server-bridge-", "");
        if (activeMatchers.size > 0) {
          let matched = false;
          for (const matcher of activeMatchers) {
            if (suffix === matcher || suffix.startsWith(matcher)) {
              matched = true;
              break;
            }
          }
          if (!matched) continue;
        }
        const hsPath = path44.join(tmpDir, dir, "headless-state.json");
        if (!fs44.existsSync(hsPath)) continue;
        try {
          const hs = JSON.parse(fs44.readFileSync(hsPath, "utf-8"));
          headlessStates.push({ instanceDir: dir, ...hs });
        } catch {
        }
      }
    }
  } catch {
  }
  const hasFailures = snapshot.warnings.some((w) => w.level === "error");
  const hasBridgeDown = snapshot.bridges.some(
    (b) => b.status === "stale" || b.status === "stopped" || b.lifecycle?.status === "degraded-no-thread"
  );
  const hasBridgeDegraded = snapshot.bridges.some(
    (b) => b.lifecycle?.status === "degraded-no-thread"
  );
  return {
    ok: !hasFailures && !hasBridgeDown && !hasBridgeDegraded,
    timestamp: snapshot.generatedAt,
    bridges: snapshot.bridges,
    agents: snapshot.agents,
    warnings: snapshot.warnings,
    headless: headlessStates
  };
}
function getConfig(options) {
  const repoRoot = options?.repoRoot ?? findRepoRoot();
  const { config } = resolveConfig({}, repoRoot);
  return {
    repoRoot,
    commsDir: options?.commsDir ?? config.commsDir,
    stateDir: config.stateDir,
    appServerUrl: config.appServerUrl
  };
}

// src/api/http.ts
import {
  createServer as createServer3
} from "http";
import { randomBytes as randomBytes5, timingSafeEqual } from "crypto";
function getCorsHeaders(req) {
  const origin = req.headers.origin ?? "";
  const isLoopback = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin);
  return {
    "Access-Control-Allow-Origin": isLoopback ? origin : "http://127.0.0.1",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    Vary: "Origin"
  };
}
function isLoopbackOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  return /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin);
}
function tokensMatch(presentedToken, expectedToken) {
  if (!presentedToken) {
    return false;
  }
  const presented = Buffer.from(presentedToken, "utf8");
  const expected = Buffer.from(expectedToken, "utf8");
  if (presented.length !== expected.length) {
    return false;
  }
  return timingSafeEqual(presented, expected);
}
function verifyBearerToken(req, expectedToken) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return false;
  }
  return tokensMatch(header.slice(7), expectedToken);
}
function verifySseToken(req, expectedToken, serverUrl) {
  if (verifyBearerToken(req, expectedToken)) {
    return true;
  }
  const url = new URL(req.url ?? "/", serverUrl);
  const queryToken = url.searchParams.get("token");
  return tokensMatch(queryToken, expectedToken);
}
function jsonResponse(req, res, data, status = 200) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    ...getCorsHeaders(req)
  });
  res.end(JSON.stringify(data));
}
function handleSnapshot(req, res, apiOptions) {
  const snapshot = getDashboardSnapshot(apiOptions);
  jsonResponse(req, res, snapshot);
}
function handleConfig(req, res, apiOptions) {
  const config = getConfig(apiOptions);
  jsonResponse(req, res, config);
}
async function handleEvents(req, res, apiOptions) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    ...getCorsHeaders(req)
  });
  const controller = new AbortController();
  req.on("close", () => controller.abort());
  for await (const snapshot of streamEvents({
    ...apiOptions,
    signal: controller.signal
  })) {
    if (controller.signal.aborted) break;
    res.write(`data: ${JSON.stringify(snapshot)}

`);
  }
  res.end();
}
function handleHealth(req, res, apiOptions) {
  const report = getHealthReport(apiOptions);
  jsonResponse(req, res, report);
}
async function startHttpServer(options) {
  const port = options?.port ?? 4580;
  const host = "127.0.0.1";
  const token = options?.token ?? randomBytes5(24).toString("base64url");
  const apiOptions = {
    repoRoot: options?.repoRoot,
    commsDir: options?.commsDir
  };
  const server = createServer3(
    async (req, res) => {
      const url = new URL(req.url ?? "/", `http://${host}:${port}`);
      const pathname = url.pathname;
      if (req.method === "OPTIONS") {
        res.writeHead(204, getCorsHeaders(req));
        res.end();
        return;
      }
      if (req.method === "POST" && !isLoopbackOrigin(req)) {
        jsonResponse(
          req,
          res,
          { error: "Forbidden: non-loopback origin" },
          403
        );
        return;
      }
      if (req.method === "GET" && pathname === "/health") {
        handleHealth(req, res, apiOptions);
        return;
      }
      if (req.method === "GET" && pathname === "/api/events") {
        const serverUrl = `http://${host}:${port}`;
        if (!verifySseToken(req, token, serverUrl)) {
          jsonResponse(req, res, { error: "Unauthorized" }, 401);
          return;
        }
        await handleEvents(req, res, apiOptions);
        return;
      }
      if (!verifyBearerToken(req, token)) {
        jsonResponse(req, res, { error: "Unauthorized" }, 401);
        return;
      }
      try {
        if (req.method === "GET") {
          switch (pathname) {
            case "/api/snapshot":
              handleSnapshot(req, res, apiOptions);
              return;
            case "/api/config":
              handleConfig(req, res, apiOptions);
              return;
          }
        }
        if (req.method === "POST") {
          const contentType = req.headers["content-type"] ?? "";
          if (!contentType.includes("application/json")) {
            jsonResponse(
              req,
              res,
              { error: "Content-Type must be application/json" },
              415
            );
            return;
          }
          switch (pathname) {
            case "/api/start":
              jsonResponse(req, res, await startAgents());
              return;
            case "/api/stop":
              jsonResponse(req, res, await stopAgents());
              return;
          }
        }
        jsonResponse(req, res, { error: "Not found" }, 404);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        jsonResponse(req, res, { error: message }, 500);
      }
    }
  );
  await new Promise((resolve21, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.removeListener("error", reject);
      resolve21();
    });
  });
  const addr = server.address();
  const actualPort = typeof addr === "object" && addr ? addr.port : port;
  return {
    port: actualPort,
    token,
    close: () => new Promise((resolve21, reject) => {
      server.close((err) => err ? reject(err) : resolve21());
    })
  };
}

// src/index.ts
init_runtime();
export {
  CODEX_APP_SERVER_ENDPOINT_PROFILES,
  CODEX_ENDPOINT_PROFILE_ALIASES,
  CODEX_IPC_DRIVE_METHODS,
  CONSENT_RECEIPTS_DIRNAME,
  ConsentReceiptError,
  DEFAULT_CODEX_IPC_PIPE_PATH,
  DEFAULT_CODEX_IPC_WINDOWS_PIPE_PATH,
  DEFAULT_CONSENT_TTL_SECONDS,
  ExperimentalCodexIpcControlTransport,
  ExperimentalCodexIpcObserveTransport,
  FileObserveTransport,
  LOCAL_CONFIG_FILE,
  SHARED_CONFIG_FILE,
  TRUSTED_DEVICE_LEASES_DIRNAME,
  WebSocketCodexAppServerPromoter,
  buildCodexBindingRegistry,
  buildFollowerStartTurnParams,
  buildPromptBundle,
  buildRuntimeEnv,
  buildTapMessagePrompt,
  canUseConsentDriveForAddress,
  checkTrustedDeviceLease,
  checkTrustedDeviceLeaseGate,
  classifyCodexEndpointUrl,
  collectDashboardSnapshot,
  consumeConsentReceipt,
  createConsentReceipt,
  createExperimentalCodexIpcControlTransport,
  createExperimentalCodexIpcObserveTransport,
  createFileObserveTransport,
  createInitialState,
  createTapMessageViewModel,
  decodeCodexIpcFrames,
  discoverCodexOwnerClientId,
  encodeCodexIpcFrame,
  getCodexEndpointProfile,
  getConfig,
  getDashboardSnapshot,
  getFnmBinDir,
  getHealthReport,
  getHeartbeatAge,
  inferReceiveTransports,
  isCodexIpcDefaultSupported,
  listCodexEndpointProfiles,
  loadLocalConfig,
  loadSharedConfig,
  loadState,
  loadTrustedDeviceLease,
  markPollingReceiverItemsProcessed,
  mirrorRemoteUplinkSource,
  normalizeCodexEndpointProfileId,
  normalizeReceiveTransports,
  normalizeTapPath,
  parseCodexEndpointUrl,
  parseTrustedDeviceLease,
  prefersConsentDrive,
  probeFnmNode,
  readNodeVersion,
  renderAgentMessagePrompt,
  resolveCodexBinding,
  resolveCodexEndpointProfile,
  resolveCodexIpcPath,
  resolveConfig,
  resolveLocalProjectionStatePath,
  resolveLocalUplinkStatePath,
  resolveNodeRuntime,
  resolvePollingReceiverStatePath,
  resolveTrustedDeviceLeasesDir,
  restartBridge,
  rotateLog,
  runCodexCliAppServerPromotion,
  runLocalProjection,
  runLocalUplink,
  runPollingReceiver,
  runSupervisedReceiverPromotion,
  saveLocalConfig,
  saveSharedConfig,
  saveState,
  startAgents,
  startGeminiIdeCompanionServer,
  startHttpServer,
  stateExists,
  stopAgents,
  streamEvents,
  updateBridgeHeartbeat,
  version,
  writeProjectedEnvelopeBackfill
};
//# sourceMappingURL=index.mjs.map