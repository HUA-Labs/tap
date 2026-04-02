var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/utils.ts
import * as fs from "fs";
import * as path from "path";
function isValidRuntime(name) {
  return VALID_RUNTIMES.includes(name);
}
function detectPlatform() {
  return process.platform;
}
function _setNoGitWarned() {
  _noGitWarned = true;
}
function resetLoggedWarnings() {
  _loggedWarnings.clear();
}
function wasWarningLogged(message) {
  return _loggedWarnings.has(message);
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
function resolveCommsDir(args, repoRoot) {
  const idx = args.indexOf("--comms-dir");
  if (idx !== -1 && args[idx + 1]) {
    return path.resolve(normalizeTapPath(args[idx + 1]));
  }
  const { config } = resolveConfig({}, repoRoot);
  return config.commsDir;
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
function setJsonMode(enabled) {
  _jsonMode = enabled;
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
function validateInstanceName(name) {
  if (/[/\\]/.test(name) || name.includes("..")) {
    throw new Error(
      `Invalid instance name "${name}": must not contain path separators or ".." sequences`
    );
  }
}
function buildInstanceId(runtime, name) {
  if (name) {
    validateInstanceName(name);
  }
  return name ? `${runtime}-${name}` : runtime;
}
function findPortConflict(state, port, excludeInstanceId) {
  for (const [id, inst] of Object.entries(state.instances)) {
    if (id !== excludeInstanceId && inst.port === port) return id;
  }
  return null;
}
var VALID_RUNTIMES, _noGitWarned, _loggedWarnings, _jsonMode;
var init_utils = __esm({
  "src/utils.ts"() {
    "use strict";
    init_config();
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
    towerName: "auto"
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
  return {
    config: {
      repoRoot,
      commsDir,
      stateDir,
      runtimeCommand,
      appServerUrl,
      towerName
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
function resolvePath(repoRoot, p) {
  const normalized = normalizeTapPath(p);
  return path2.isAbsolute(normalized) ? normalized : path2.resolve(repoRoot, normalized);
}
function normalizeTapPath(input) {
  const trimmed = input.trim().replace(/^["'`]+|["'`]+$/g, "");
  if (/^[A-Za-z]:[\\/]/.test(trimmed)) {
    return trimmed;
  }
  if (process.platform === "win32") {
    const match = trimmed.match(/^\/([A-Za-z])\/(.*)$/);
    if (match) {
      return `${match[1].toUpperCase()}:\\${match[2].replace(/\//g, "\\")}`;
    }
  }
  return trimmed;
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
var instance_config_exports = {};
__export(instance_config_exports, {
  createInstanceConfig: () => createInstanceConfig,
  deleteInstanceConfig: () => deleteInstanceConfig,
  listInstanceConfigs: () => listInstanceConfigs,
  loadInstanceConfig: () => loadInstanceConfig,
  saveInstanceConfig: () => saveInstanceConfig,
  updateInstanceConfig: () => updateInstanceConfig
});
import * as fs3 from "fs";
import * as path3 from "path";
function instancesDir(stateDir) {
  return path3.join(stateDir, "instances");
}
function instanceConfigPath(stateDir, instanceId) {
  if (instanceId.includes("/") || instanceId.includes("\\") || instanceId.includes("..")) {
    throw new Error(
      `Invalid instanceId "${instanceId}": must not contain path separators or ".." sequences`
    );
  }
  return path3.join(instancesDir(stateDir), `${instanceId}.json`);
}
function loadInstanceConfig(stateDir, instanceId) {
  const filePath = instanceConfigPath(stateDir, instanceId);
  if (!fs3.existsSync(filePath)) return null;
  try {
    const raw = fs3.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    if (!parsed.permission) {
      parsed.permission = createPermissionFromRole("custom");
    }
    return parsed;
  } catch {
    return null;
  }
}
function saveInstanceConfig(stateDir, config) {
  const dir = instancesDir(stateDir);
  fs3.mkdirSync(dir, { recursive: true });
  const filePath = instanceConfigPath(stateDir, config.instanceId);
  const tmp = `${filePath}.tmp.${process.pid}`;
  fs3.writeFileSync(tmp, JSON.stringify(config, null, 2) + "\n", "utf-8");
  fs3.renameSync(tmp, filePath);
  return filePath;
}
function listInstanceConfigs(stateDir) {
  const dir = instancesDir(stateDir);
  if (!fs3.existsSync(dir)) return [];
  const files = fs3.readdirSync(dir).filter((f) => f.endsWith(".json"));
  const configs = [];
  for (const file of files) {
    try {
      const raw = fs3.readFileSync(path3.join(dir, file), "utf-8");
      configs.push(JSON.parse(raw));
    } catch {
    }
  }
  return configs;
}
function deleteInstanceConfig(stateDir, instanceId) {
  const filePath = instanceConfigPath(stateDir, instanceId);
  if (!fs3.existsSync(filePath)) return false;
  fs3.unlinkSync(filePath);
  return true;
}
function createInstanceConfig(opts) {
  const parts = opts.instanceId.split("-");
  if (parts.length > 1) {
    validateInstanceName(parts.slice(1).join("-"));
  }
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const config = {
    schemaVersion: INSTANCE_CONFIG_SCHEMA_VERSION,
    instanceId: opts.instanceId,
    runtime: opts.runtime,
    agentName: opts.agentName,
    agentId: opts.agentId,
    port: opts.port,
    appServerUrl: opts.appServerUrl,
    permission: createPermissionFromRole(opts.role ?? "custom"),
    // Top-level overrides consumed by resolveTrackedConfig
    commsDir: opts.commsDir,
    stateDir: opts.stateDir,
    mcpEnv: {
      TAP_COMMS_DIR: opts.commsDir,
      TAP_STATE_DIR: opts.stateDir,
      TAP_REPO_ROOT: opts.repoRoot,
      TAP_AGENT_NAME: opts.agentName ?? "<set-per-session>"
    },
    configHash: "",
    lastSyncedToRuntime: null,
    runtimeConfigHash: "",
    createdAt: now,
    updatedAt: now
  };
  config.configHash = computeInstanceConfigHash(config);
  return config;
}
function updateInstanceConfig(existing, updates) {
  const updated = {
    ...existing,
    ...updates,
    updatedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
  if (updates.agentName !== void 0) {
    updated.mcpEnv = {
      ...updated.mcpEnv,
      TAP_AGENT_NAME: updates.agentName ?? "<set-per-session>"
    };
  }
  updated.configHash = computeInstanceConfigHash(updated);
  return updated;
}
function computeInstanceConfigHash(config) {
  const hashInput = {
    instanceId: config.instanceId,
    runtime: config.runtime,
    agentName: config.agentName,
    agentId: config.agentId,
    port: config.port,
    appServerUrl: config.appServerUrl,
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
var INSTANCE_CONFIG_SCHEMA_VERSION;
var init_instance_config = __esm({
  "src/config/instance-config.ts"() {
    "use strict";
    init_utils();
    init_presets();
    INSTANCE_CONFIG_SCHEMA_VERSION = 1;
  }
});

// src/config/drift-detector.ts
var drift_detector_exports = {};
__export(drift_detector_exports, {
  checkAllDrift: () => checkAllDrift,
  checkInstanceDrift: () => checkInstanceDrift,
  computeFileHash: () => computeFileHash
});
import * as fs4 from "fs";
import * as crypto from "crypto";
function computeFileHash(filePath) {
  if (!fs4.existsSync(filePath)) return "";
  const content = fs4.readFileSync(filePath, "utf-8");
  return crypto.createHash("sha256").update(content).digest("hex").slice(0, 16);
}
function checkInstanceDrift(stateDir, instanceId, state) {
  const checks = [];
  const instConfig = loadInstanceConfig(stateDir, instanceId);
  const stateInstance = state?.instances[instanceId] ?? null;
  if (!instConfig) {
    if (stateInstance?.installed) {
      if (!stateInstance.configSourceFile) {
        return { instanceId, status: "ok", checks };
      }
      checks.push({
        name: "instance config exists",
        source: "instance-config",
        target: "state-json",
        status: "missing",
        details: `Instance "${instanceId}" is in state.json but has no instance config file. Run "tap add ${instanceId} --force" to recreate.`,
        autoFixable: false
        // Cannot generate config from state alone
      });
      return { instanceId, status: "missing", checks };
    }
    return { instanceId, status: "ok", checks };
  }
  if (!stateInstance) {
    checks.push({
      name: "instance registered",
      source: "instance-config",
      target: "state-json",
      status: "missing",
      details: `Instance config exists for "${instanceId}" but not registered in state.json`,
      autoFixable: false
    });
    return { instanceId, status: "orphaned", checks };
  }
  const fieldMismatches = [];
  if (instConfig.agentName !== stateInstance.agentName) {
    fieldMismatches.push(
      `agentName: instance="${instConfig.agentName}" vs state="${stateInstance.agentName}"`
    );
  }
  if (instConfig.port !== stateInstance.port) {
    fieldMismatches.push(
      `port: instance=${instConfig.port} vs state=${stateInstance.port}`
    );
  }
  if (fieldMismatches.length > 0) {
    checks.push({
      name: "state consistency",
      source: "instance-config",
      target: "state-json",
      status: "drifted",
      details: fieldMismatches.join("; "),
      autoFixable: true
    });
  } else {
    checks.push({
      name: "state consistency",
      source: "instance-config",
      target: "state-json",
      status: "ok",
      details: null,
      autoFixable: false
    });
  }
  const stateHash = stateInstance.configHash ?? "";
  if (!stateHash) {
    checks.push({
      name: "config hash baseline",
      source: "instance-config",
      target: "state-json",
      status: "drifted",
      details: `configHash not baselined for "${instanceId}" \u2014 needs backfill`,
      autoFixable: true
    });
  } else if (instConfig.configHash !== stateHash) {
    checks.push({
      name: "config hash",
      source: "instance-config",
      target: "state-json",
      status: "drifted",
      details: `instance hash="${instConfig.configHash}" vs state hash="${stateHash}"`,
      autoFixable: true
    });
  } else {
    checks.push({
      name: "config hash",
      source: "instance-config",
      target: "state-json",
      status: "ok",
      details: null,
      autoFixable: false
    });
  }
  if (stateInstance.configPath && fs4.existsSync(stateInstance.configPath)) {
    const currentRuntimeHash = computeFileHash(stateInstance.configPath);
    const lastSyncedHash = instConfig.runtimeConfigHash || "";
    if (!lastSyncedHash) {
      checks.push({
        name: "runtime config baseline",
        source: "instance-config",
        target: "runtime-config",
        status: "drifted",
        details: `runtimeConfigHash not baselined for "${instanceId}" \u2014 needs backfill`,
        autoFixable: true
      });
    } else if (currentRuntimeHash !== lastSyncedHash) {
      checks.push({
        name: "runtime config",
        source: "instance-config",
        target: "runtime-config",
        status: "drifted",
        details: `${stateInstance.configPath} has changed since last sync (hash: ${currentRuntimeHash.slice(0, 8)} vs synced: ${lastSyncedHash.slice(0, 8)})`,
        autoFixable: true
      });
    } else {
      checks.push({
        name: "runtime config",
        source: "instance-config",
        target: "runtime-config",
        status: "ok",
        details: null,
        autoFixable: false
      });
    }
  }
  const hasDrift = checks.some((c) => c.status !== "ok");
  return {
    instanceId,
    status: hasDrift ? "drifted" : "ok",
    checks
  };
}
function checkAllDrift(stateDir, state) {
  const results = [];
  const checkedIds = /* @__PURE__ */ new Set();
  if (state) {
    for (const instanceId of Object.keys(state.instances)) {
      checkedIds.add(instanceId);
      results.push(checkInstanceDrift(stateDir, instanceId, state));
    }
  }
  const instancesDir2 = `${stateDir}/instances`;
  if (fs4.existsSync(instancesDir2)) {
    for (const file of fs4.readdirSync(instancesDir2)) {
      if (!file.endsWith(".json")) continue;
      const id = file.replace(/\.json$/, "");
      if (!checkedIds.has(id)) {
        results.push(checkInstanceDrift(stateDir, id, state));
      }
    }
  }
  return results;
}
var init_drift_detector = __esm({
  "src/config/drift-detector.ts"() {
    "use strict";
    init_instance_config();
  }
});

// src/config/index.ts
var init_config = __esm({
  "src/config/index.ts"() {
    "use strict";
    init_resolve();
  }
});

// src/commands/init.ts
import * as fs8 from "fs";
import * as path7 from "path";
import { spawnSync } from "child_process";

// src/state.ts
init_config();
import * as fs5 from "fs";
import * as path4 from "path";
import * as crypto2 from "crypto";
var STATE_FILE = "state.json";
var SCHEMA_VERSION = 3;
function getStateDir(repoRoot) {
  const { config } = resolveConfig({}, repoRoot);
  return config.stateDir;
}
function getStatePath(repoRoot) {
  return path4.join(getStateDir(repoRoot), STATE_FILE);
}
function stateExists(repoRoot) {
  return fs5.existsSync(getStatePath(repoRoot));
}
function migrateStateV1toV2(v1) {
  const instances = {};
  for (const [runtime, rs] of Object.entries(v1.runtimes)) {
    if (!rs) continue;
    const instanceId = runtime;
    instances[instanceId] = {
      instanceId,
      runtime,
      agentName: null,
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
    instances[id] = {
      ...inst,
      configHash: inst.configHash ?? "",
      configSourceFile: inst.configSourceFile ?? ""
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
  if (!fs5.existsSync(statePath)) return null;
  const raw = fs5.readFileSync(statePath, "utf-8");
  const parsed = JSON.parse(raw);
  if (parsed.schemaVersion === 1 || parsed.runtimes) {
    const v2 = migrateStateV1toV2(parsed);
    const v3 = migrateStateV2toV3(v2);
    saveState(repoRoot, v3);
    return v3;
  }
  if (parsed.schemaVersion === 2) {
    const v3 = migrateStateV2toV3(parsed);
    saveState(repoRoot, v3);
    return v3;
  }
  return parsed;
}
function saveState(repoRoot, state) {
  const stateDir = getStateDir(repoRoot);
  fs5.mkdirSync(stateDir, { recursive: true });
  const statePath = getStatePath(repoRoot);
  const tmp = `${statePath}.tmp.${process.pid}`;
  fs5.writeFileSync(tmp, JSON.stringify(state, null, 2), "utf-8");
  fs5.renameSync(tmp, statePath);
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
function removeInstanceState(state, instanceId) {
  const { [instanceId]: _removed, ...remaining } = state.instances;
  return {
    ...state,
    updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
    instances: remaining
  };
}
function getInstalledInstances(state) {
  return Object.keys(state.instances).filter(
    (id) => state.instances[id]?.installed
  );
}
function ensureBackupDir(stateDir, instanceId) {
  const backupDir = path4.join(stateDir, "backups", instanceId);
  fs5.mkdirSync(backupDir, { recursive: true });
  return backupDir;
}
function backupFile(filePath, backupDir) {
  const basename3 = path4.basename(filePath);
  const hash = fileHash(filePath);
  const backupPath = path4.join(backupDir, `${basename3}.${hash}.bak`);
  fs5.copyFileSync(filePath, backupPath);
  return backupPath;
}
function fileHash(filePath) {
  if (!fs5.existsSync(filePath)) return "";
  const content = fs5.readFileSync(filePath);
  return crypto2.createHash("sha256").update(content).digest("hex").slice(0, 16);
}

// src/commands/init.ts
init_utils();

// src/version.ts
import * as fs6 from "fs";
import * as path5 from "path";
import { fileURLToPath } from "url";
var FALLBACK_VERSION = "0.0.0";
function resolvePackageVersion(metaUrl = import.meta.url) {
  const moduleDir = path5.dirname(fileURLToPath(metaUrl));
  const packageJsonPath = path5.join(moduleDir, "..", "package.json");
  try {
    const parsed = JSON.parse(fs6.readFileSync(packageJsonPath, "utf-8"));
    if (typeof parsed.version === "string" && parsed.version.trim()) {
      return parsed.version;
    }
  } catch {
  }
  return FALLBACK_VERSION;
}
var version = resolvePackageVersion();

// src/permissions.ts
init_utils();
import * as fs7 from "fs";
import * as path6 from "path";
import * as os from "os";

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
    const value = rawValue.trim();
    if (value.startsWith("[") && value.endsWith("]")) {
      const items = value.slice(1, -1).split(",").map((item) => item.trim()).filter(Boolean).map(unquoteTomlString);
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

// src/permissions.ts
var CLAUDE_DENY_RULES = [
  "Bash(git push --force:*)",
  "Bash(git push -f:*)",
  "Bash(git push --force-with-lease:*)",
  "Bash(git reset --hard:*)",
  "Bash(git checkout -- .:*)",
  "Bash(git clean -f:*)",
  "Bash(git clean -fd:*)",
  "Bash(git clean -fdx:*)",
  "Bash(git restore --source=:*)",
  "Bash(git branch -D:*)",
  "Bash(git stash drop:*)",
  "Bash(rm -rf:*)"
];
function applyClaudePermissions(repoRoot, mode) {
  const warnings = [];
  const claudeDir = path6.join(repoRoot, ".claude");
  const settingsPath = path6.join(claudeDir, "settings.local.json");
  fs7.mkdirSync(claudeDir, { recursive: true });
  let settings = {};
  if (fs7.existsSync(settingsPath)) {
    try {
      settings = JSON.parse(fs7.readFileSync(settingsPath, "utf-8"));
    } catch {
      warnings.push(
        ".claude/settings.local.json was invalid JSON. Starting fresh."
      );
      settings = {};
    }
  }
  const existingDeny = Array.isArray(settings.deny) ? settings.deny : [];
  if (mode === "full") {
    const tapRuleSet = new Set(CLAUDE_DENY_RULES);
    const cleaned = existingDeny.filter((r) => !tapRuleSet.has(r));
    settings.deny = cleaned;
    const tmp2 = `${settingsPath}.tmp.${process.pid}`;
    fs7.writeFileSync(tmp2, JSON.stringify(settings, null, 2) + "\n", "utf-8");
    fs7.renameSync(tmp2, settingsPath);
    logWarn("Claude: full mode \u2014 tap deny rules removed. Use with caution.");
    warnings.push("Full permission mode: tap deny rules removed.");
    return { applied: true, warnings };
  }
  const newDeny = [.../* @__PURE__ */ new Set([...existingDeny, ...CLAUDE_DENY_RULES])];
  settings.deny = newDeny;
  const tmp = `${settingsPath}.tmp.${process.pid}`;
  fs7.writeFileSync(tmp, JSON.stringify(settings, null, 2) + "\n", "utf-8");
  fs7.renameSync(tmp, settingsPath);
  logSuccess(
    `Claude: ${CLAUDE_DENY_RULES.length} deny rules applied to .claude/settings.local.json`
  );
  return { applied: true, warnings };
}
function findCodexConfigPath() {
  return path6.join(os.homedir(), ".codex", "config.toml");
}
function canonicalizeTrustPath(targetPath) {
  let resolved = path6.resolve(targetPath).replace(/\//g, "\\");
  const driveRoot = /^[A-Za-z]:\\$/;
  if (!driveRoot.test(resolved)) {
    resolved = resolved.replace(/\\+$/g, "");
  }
  return resolved.startsWith("\\\\?\\") ? resolved : `\\\\?\\${resolved}`;
}
function applyCodexPermissions(repoRoot, commsDir, mode) {
  const warnings = [];
  const configPath = findCodexConfigPath();
  fs7.mkdirSync(path6.dirname(configPath), { recursive: true });
  let content = "";
  if (fs7.existsSync(configPath)) {
    content = fs7.readFileSync(configPath, "utf-8");
  }
  const trustTargets = getCodexWritableRoots(repoRoot, commsDir);
  if (mode === "full") {
    logWarn("Codex: full mode \u2014 setting sandbox to danger-full-access.");
    warnings.push(
      "Full mode: sandbox set to danger-full-access. Use with caution."
    );
    content = replaceTomlTable(
      content,
      "sandbox",
      renderTomlTable(
        "sandbox",
        { mode: "danger-full-access" },
        extractTomlTable(content, "sandbox")
      )
    );
  } else {
    content = replaceTomlTable(
      content,
      "sandbox",
      renderTomlTable(
        "sandbox",
        { mode: "workspace-write", network_access: "full" },
        extractTomlTable(content, "sandbox")
      )
    );
    const forwardSlashRoots = trustTargets.map((r) => r.replace(/\\/g, "/"));
    content = replaceTomlTable(
      content,
      "sandbox_workspace_write",
      renderTomlTable(
        "sandbox_workspace_write",
        { writable_roots: forwardSlashRoots },
        extractTomlTable(content, "sandbox_workspace_write")
      )
    );
    if (process.platform === "win32") {
      content = replaceTomlTable(
        content,
        "windows",
        renderTomlTable(
          "windows",
          { sandbox: "elevated" },
          extractTomlTable(content, "windows")
        )
      );
    }
  }
  for (const target of trustTargets) {
    const selector = `projects.'${canonicalizeTrustPath(target)}'`;
    content = replaceTomlTable(
      content,
      selector,
      renderTomlTable(
        selector,
        { trust_level: "trusted" },
        extractTomlTable(content, selector)
      )
    );
  }
  const tmp = `${configPath}.tmp.${process.pid}`;
  fs7.writeFileSync(tmp, content, "utf-8");
  fs7.renameSync(tmp, configPath);
  const modeLabel = mode === "full" ? "danger-full-access" : "workspace-write, network=full";
  logSuccess(
    `Codex: sandbox=${modeLabel}, ${trustTargets.length} path(s) trusted`
  );
  return { applied: true, warnings };
}
function getCodexWritableRoots(repoRoot, commsDir) {
  const roots = [repoRoot, commsDir];
  const parent = path6.dirname(repoRoot);
  for (let i = 1; i <= 4; i++) {
    const wtPath = path6.join(parent, `hua-wt-${i}`);
    if (fs7.existsSync(wtPath)) roots.push(wtPath);
  }
  return [...new Set(roots.map((r) => path6.resolve(r)))];
}
function buildPermissionSummary(mode, repoRoot, commsDir) {
  const trustedPaths = getCodexWritableRoots(repoRoot, commsDir);
  return {
    mode,
    claude: {
      applied: true,
      denyCount: mode === "safe" ? CLAUDE_DENY_RULES.length : 0,
      warnings: mode === "full" ? ["Full mode: tap deny rules removed."] : []
    },
    codex: {
      applied: true,
      trustedPaths,
      warnings: mode === "full" ? ["Full mode: sandbox set to danger-full-access."] : []
    }
  };
}

// src/commands/init.ts
init_config();
var COMMS_DIRS = [
  "inbox",
  "reviews",
  "findings",
  "handoff",
  "retros",
  "archive"
];
function parsePermissionMode(args) {
  const idx = args.indexOf("--permissions");
  if (idx !== -1 && args[idx + 1]) {
    const value = args[idx + 1];
    if (value === "full" || value === "safe") return value;
    logWarn(`Unknown permission mode: ${value}. Using "safe".`);
  }
  return "safe";
}
var INIT_HELP = `
Usage:
  tap init [options]

Description:
  Initialize the tap directory structure, state file, and permissions.
  Optionally clone a shared comms repository.

Options:
  --comms-dir <path>    Override comms directory (default: tap-comms/)
  --comms-repo <url>    Clone a shared comms git repo into comms directory
  --permissions <mode>  Permission mode: safe (default) or full
  --force               Re-initialize even if already set up
  --help, -h            Show help

Examples:
  npx @hua-labs/tap init
  npx @hua-labs/tap init --permissions full
  npx @hua-labs/tap init --comms-repo https://github.com/org/comms.git
  npx @hua-labs/tap init --comms-dir /shared/comms --force
`.trim();
async function initCommand(args) {
  if (args.includes("--help") || args.includes("-h")) {
    log(INIT_HELP);
    return {
      ok: true,
      command: "init",
      code: "TAP_NO_OP",
      message: INIT_HELP,
      warnings: [],
      data: {}
    };
  }
  const repoRoot = findRepoRoot();
  const commsDir = resolveCommsDir(args, repoRoot);
  const permMode = parsePermissionMode(args);
  if (stateExists(repoRoot) && !args.includes("--force")) {
    return {
      ok: true,
      command: "init",
      code: "TAP_ALREADY_INITIALIZED",
      message: "Already initialized. Use --force to re-initialize.",
      warnings: [],
      data: { commsDir, repoRoot }
    };
  }
  logHeader("@hua-labs/tap init");
  const commsRepoIdx = args.indexOf("--comms-repo");
  const commsRepoUrl = commsRepoIdx !== -1 && args[commsRepoIdx + 1] ? args[commsRepoIdx + 1] : void 0;
  if (commsRepoUrl) {
    if (fs8.existsSync(commsDir) && fs8.readdirSync(commsDir).length > 0) {
      const gitDir = path7.join(commsDir, ".git");
      if (fs8.existsSync(gitDir)) {
        log(`Comms directory exists: ${commsDir}`);
        logSuccess("Comms directory is already a git repo \u2014 linking only");
      } else {
        logError(`Comms directory exists but is not a git repo: ${commsDir}`);
        return {
          ok: false,
          command: "init",
          code: "TAP_INIT_CLONE_FAILED",
          message: `Comms directory "${commsDir}" exists but is not a git repo. Remove it or use --force to reinitialize.`,
          warnings: [],
          data: { commsDir, commsRepoUrl }
        };
      }
    } else {
      log(`Cloning comms repo: ${commsRepoUrl}`);
      try {
        const cloneResult = spawnSync(
          "git",
          ["clone", commsRepoUrl, commsDir],
          {
            stdio: "pipe",
            encoding: "utf-8"
          }
        );
        if (cloneResult.status !== 0) {
          throw new Error(
            cloneResult.stderr || `git clone exited with code ${cloneResult.status}`
          );
        }
        logSuccess(`Cloned comms repo to ${commsDir}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logError(`Failed to clone comms repo: ${msg}`);
        return {
          ok: false,
          command: "init",
          code: "TAP_INIT_CLONE_FAILED",
          message: `Failed to clone comms repo: ${msg}`,
          warnings: [],
          data: { commsRepoUrl }
        };
      }
    }
  }
  {
    const sharedConfig = loadSharedConfig(repoRoot) ?? {};
    let configChanged = false;
    if (commsRepoUrl) {
      sharedConfig.commsRepoUrl = commsRepoUrl;
      configChanged = true;
    }
    const commsDirRelative = path7.relative(repoRoot, commsDir);
    if (commsDirRelative && commsDirRelative !== "tap-comms") {
      sharedConfig.commsDir = commsDirRelative;
      configChanged = true;
    }
    if (configChanged) {
      saveSharedConfig(repoRoot, sharedConfig);
      logSuccess("Saved comms config to tap-config.json");
    }
  }
  log(`Comms directory: ${commsDir}`);
  for (const dir of COMMS_DIRS) {
    const dirPath = path7.join(commsDir, dir);
    fs8.mkdirSync(dirPath, { recursive: true });
    logSuccess(`Created ${dir}/`);
  }
  const gitignorePath = path7.join(commsDir, ".gitignore");
  if (!fs8.existsSync(gitignorePath)) {
    fs8.writeFileSync(
      gitignorePath,
      ["tap.db", ".lock", "*.tmp.*", ".DS_Store"].join("\n") + "\n",
      "utf-8"
    );
    logSuccess("Created .gitignore");
  }
  const { config } = resolveConfig({}, repoRoot);
  const stateDir = config.stateDir;
  fs8.mkdirSync(path7.join(stateDir, "pids"), { recursive: true });
  fs8.mkdirSync(path7.join(stateDir, "logs"), { recursive: true });
  fs8.mkdirSync(path7.join(stateDir, "backups"), { recursive: true });
  const stateDirRel = path7.relative(repoRoot, stateDir);
  logSuccess(`Created ${stateDirRel}/ state directory`);
  const repoGitignore = path7.join(repoRoot, ".gitignore");
  const gitignoreEntries = [
    { entry: stateDirRel.replace(/\\/g, "/") + "/", label: "tap-comms state" },
    {
      entry: "tap-config.local.json",
      label: "tap-comms local config (machine-specific)"
    }
  ];
  if (fs8.existsSync(repoGitignore)) {
    const content = fs8.readFileSync(repoGitignore, "utf-8");
    for (const { entry, label } of gitignoreEntries) {
      if (!content.includes(entry)) {
        fs8.appendFileSync(repoGitignore, `
# ${label}
${entry}
`);
        logSuccess(`Added ${entry} to .gitignore`);
      }
    }
  }
  const state = createInitialState(commsDir, repoRoot, version);
  saveState(repoRoot, state);
  logSuccess("Created state.json");
  const warnings = [];
  logHeader(`Permissions: ${permMode} mode`);
  const claudeResult = applyClaudePermissions(repoRoot, permMode);
  warnings.push(...claudeResult.warnings);
  const codexResult = applyCodexPermissions(repoRoot, commsDir, permMode);
  warnings.push(...codexResult.warnings);
  const permSummary = buildPermissionSummary(permMode, repoRoot, commsDir);
  if (permMode === "full") {
    logWarn("Full mode: no destructive operation guards. Use with caution.");
  }
  logHeader("Done! Next steps:");
  log("npx @hua-labs/tap add claude    # Add Claude runtime");
  log("npx @hua-labs/tap add codex     # Add Codex runtime");
  log("npx @hua-labs/tap status        # Check status");
  return {
    ok: true,
    command: "init",
    code: "TAP_INIT_OK",
    message: "Initialized successfully",
    warnings,
    data: {
      commsDir,
      repoRoot,
      permissions: permSummary
    }
  };
}

// src/commands/add.ts
init_utils();

// src/adapters/claude.ts
import * as fs10 from "fs";
import * as path9 from "path";
import { execSync } from "child_process";

// src/adapters/common.ts
import * as fs9 from "fs";
import * as os2 from "os";
import * as path8 from "path";
import { spawnSync as spawnSync2 } from "child_process";
import { fileURLToPath as fileURLToPath2 } from "url";
function resolveProbeCommand(candidate) {
  return resolveCommandPath(candidate) ?? candidate;
}
function probeCommandVersion(command) {
  return spawnSync2(command, ["--version"], {
    encoding: "utf-8",
    windowsHide: true
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
  if (path8.isAbsolute(command)) return command;
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
      const candidateExt = path8.extname(command).toLowerCase();
      if (candidateExt) {
        const extMatch = lines.find(
          (l) => path8.extname(l).toLowerCase() === candidateExt && fs9.existsSync(l)
        );
        if (extMatch) return extMatch;
      }
      const executableMatch = lines.find(
        (l) => /\.(cmd|exe|ps1)$/i.test(l) && fs9.existsSync(l)
      );
      if (executableMatch) return executableMatch;
    }
    const firstValid = lines.find((l) => fs9.existsSync(l));
    return firstValid ?? null;
  } catch {
    return null;
  }
}
function getHomeDir() {
  return os2.homedir();
}
function toForwardSlashPath(filePath) {
  return path8.resolve(filePath).replace(/\\/g, "/");
}
function canWriteOrCreate(filePath) {
  try {
    if (fs9.existsSync(filePath)) {
      fs9.accessSync(filePath, fs9.constants.W_OK);
      return true;
    }
    const parent = path8.dirname(filePath);
    fs9.mkdirSync(parent, { recursive: true });
    fs9.accessSync(parent, fs9.constants.W_OK);
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
    path8.join(
      ctx.repoRoot,
      "packages",
      "tap-plugin",
      "channels",
      "tap-comms.ts"
    ),
    path8.join(
      ctx.repoRoot,
      "node_modules",
      "@hua-labs",
      "tap-plugin",
      "channels",
      "tap-comms.ts"
    )
  ];
  for (const candidate of candidates) {
    if (fs9.existsSync(candidate)) return candidate;
  }
  return null;
}
function findBundledTapCommsSource(metaUrl = import.meta.url) {
  const moduleDir = path8.dirname(fileURLToPath2(metaUrl));
  const candidates = [
    path8.join(moduleDir, "mcp-server.mjs"),
    path8.join(moduleDir, "..", "mcp-server.mjs"),
    path8.join(moduleDir, "..", "mcp-server.ts")
  ];
  for (const candidate of candidates) {
    if (fs9.existsSync(candidate)) return candidate;
  }
  return null;
}
function findTapCommsServerEntry(ctx, metaUrl = import.meta.url) {
  return findBundledTapCommsSource(metaUrl) ?? findLocalTapCommsSource(ctx);
}
function findPreferredBunCommand() {
  const home = getHomeDir();
  const candidates = process.platform === "win32" ? [path8.join(home, ".bun", "bin", "bun.exe"), "bun", "bun.cmd"] : [path8.join(home, ".bun", "bin", "bun"), "bun"];
  for (const candidate of candidates) {
    if (path8.isAbsolute(candidate) && !fs9.existsSync(candidate)) continue;
    const resolvedCommand = resolveProbeCommand(candidate);
    const result = probeCommandVersion(resolvedCommand);
    if (result.status === 0) {
      return path8.isAbsolute(resolvedCommand) ? toForwardSlashPath(resolvedCommand) : resolvedCommand;
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
    TAP_REPO_ROOT: toForwardSlashPath(ctx.repoRoot)
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

// src/adapters/claude.ts
var MCP_SERVER_KEY = "tap";
var OLD_MCP_SERVER_KEY = "tap-comms";
function findMcpJsonPath(ctx) {
  return path9.join(ctx.repoRoot, ".mcp.json");
}
function findClaudeCommand() {
  try {
    execSync("claude --version", { stdio: "pipe" });
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
var claudeAdapter = {
  runtime: "claude",
  async probe(ctx) {
    const warnings = [];
    const issues = [];
    const configPath = findMcpJsonPath(ctx);
    const configExists = fs10.existsSync(configPath);
    const runtimeCommand = findClaudeCommand();
    const canWrite = configExists ? (() => {
      try {
        fs10.accessSync(configPath, fs10.constants.W_OK);
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
    if (!fs10.existsSync(ctx.commsDir)) {
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
      const raw = fs10.readFileSync(configPath, "utf-8");
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
          if (fs10.existsSync(op.path)) {
            backupFile(op.path, plan.backupDir);
            const raw = fs10.readFileSync(op.path, "utf-8");
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
          fs10.writeFileSync(
            tmp,
            JSON.stringify(config, null, 2) + "\n",
            "utf-8"
          );
          fs10.renameSync(tmp, op.path);
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
        passed: fs10.existsSync(configPath),
        message: fs10.existsSync(configPath) ? void 0 : `${configPath} not found`
      });
      if (fs10.existsSync(configPath)) {
        try {
          const raw = fs10.readFileSync(configPath, "utf-8");
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
      passed: fs10.existsSync(ctx.commsDir),
      message: fs10.existsSync(ctx.commsDir) ? void 0 : `${ctx.commsDir} not found`
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
  return typeof value === "string" ? path9.resolve(value).replace(/\\/g, "/") : "";
}

// src/adapters/codex.ts
import * as fs12 from "fs";
import * as path11 from "path";
import { fileURLToPath as fileURLToPath3 } from "url";

// src/artifact-backups.ts
import * as crypto3 from "crypto";
import * as fs11 from "fs";
import * as path10 from "path";
function selectorHash(selector) {
  return crypto3.createHash("sha256").update(selector).digest("hex").slice(0, 12);
}
function artifactBackupPath(backupDir, kind, selector) {
  const safeKind = kind.replace(/[^a-z-]/gi, "-");
  return path10.join(backupDir, `${safeKind}-${selectorHash(selector)}.json`);
}
function writeArtifactBackup(backupPath, payload) {
  fs11.mkdirSync(path10.dirname(backupPath), { recursive: true });
  const tmp = `${backupPath}.tmp.${process.pid}`;
  fs11.writeFileSync(tmp, JSON.stringify(payload, null, 2) + "\n", "utf-8");
  fs11.renameSync(tmp, backupPath);
}
function readArtifactBackup(backupPath) {
  if (!fs11.existsSync(backupPath)) return null;
  try {
    const raw = fs11.readFileSync(backupPath, "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// src/adapters/codex.ts
var MCP_SELECTOR = "mcp_servers.tap";
var ENV_SELECTOR = "mcp_servers.tap.env";
var SESSION_NEUTRAL_AGENT_NAME = "<set-per-session>";
var OLD_MCP_SELECTOR = "mcp_servers.tap-comms";
var OLD_ENV_SELECTOR = "mcp_servers.tap-comms.env";
function findCodexConfigPath2() {
  return path11.join(getHomeDir(), ".codex", "config.toml");
}
function canonicalizeTrustPath2(targetPath) {
  let resolved = path11.resolve(targetPath).replace(/\//g, "\\");
  const driveRoot = /^[A-Za-z]:\\$/;
  if (!driveRoot.test(resolved)) {
    resolved = resolved.replace(/\\+$/g, "");
  }
  return resolved.startsWith("\\\\?\\") ? resolved : `\\\\?\\${resolved}`;
}
function trustSelector(targetPath) {
  return `projects.'${canonicalizeTrustPath2(targetPath)}'`;
}
function getTrustTargets(ctx) {
  const targets = [ctx.repoRoot, process.cwd()];
  return [...new Set(targets.map((value) => path11.resolve(value)))];
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
  if (!fs12.existsSync(configPath)) return "";
  return fs12.readFileSync(configPath, "utf-8");
}
function writeTomlFile(filePath, content) {
  fs12.mkdirSync(path11.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp.${process.pid}`;
  fs12.writeFileSync(tmp, content, "utf-8");
  fs12.renameSync(tmp, filePath);
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
    passed: fs12.existsSync(configPath),
    message: fs12.existsSync(configPath) ? void 0 : `${configPath} not found`
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
      name: `Trust table present: ${canonicalizeTrustPath2(target)}`,
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
var codexAdapter = {
  runtime: "codex",
  async probe(ctx) {
    const warnings = [];
    const issues = [];
    const configPath = findCodexConfigPath2();
    const configExists = fs12.existsSync(configPath);
    const runtimeProbe = probeCommand(
      ctx.platform === "win32" ? ["codex", "codex.cmd"] : ["codex"]
    );
    if (!runtimeProbe.command) {
      warnings.push(
        "Codex CLI not found in PATH. Config can still be written, but runtime verification will be limited."
      );
    }
    if (!fs12.existsSync(ctx.commsDir)) {
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
    const configPath = probe.configPath ?? findCodexConfigPath2();
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
    const configPath = plan.operations[0]?.path ?? findCodexConfigPath2();
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
    if (fs12.existsSync(configPath) && existingContent) {
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
    const configPath = plan.operations[0]?.path ?? findCodexConfigPath2();
    const content = readConfigOrEmpty(configPath);
    const runtimeProbe = probeCommand(
      ctx.platform === "win32" ? ["codex", "codex.cmd"] : ["codex"]
    );
    const checks = verifyManagedToml(content, ctx, configPath);
    checks.push({
      name: "Comms directory exists",
      passed: fs12.existsSync(ctx.commsDir),
      message: fs12.existsSync(ctx.commsDir) ? void 0 : `${ctx.commsDir} not found`
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
    const distDir = path11.dirname(fileURLToPath3(import.meta.url));
    const candidates = [
      // 1. Relative to bundled CLI (npm install / npx)
      path11.join(distDir, "bridges", "codex-bridge-runner.mjs"),
      // 2. Monorepo development — dist inside repo
      path11.join(
        ctx.repoRoot,
        "packages",
        "tap-comms",
        "dist",
        "bridges",
        "codex-bridge-runner.mjs"
      ),
      // 3. Source file — dev mode with strip-types
      path11.join(
        ctx.repoRoot,
        "packages",
        "tap-comms",
        "src",
        "bridges",
        "codex-bridge-runner.ts"
      )
    ];
    for (const candidate of candidates) {
      if (fs12.existsSync(candidate)) return candidate;
    }
    return null;
  }
};
function patchCodexApprovalMode() {
  const configPath = findCodexConfigPath2();
  if (!fs12.existsSync(configPath)) return null;
  const content = fs12.readFileSync(configPath, "utf-8");
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

// src/adapters/gemini.ts
import * as fs13 from "fs";
import * as path12 from "path";
var GEMINI_SELECTOR = "mcpServers.tap";
var OLD_GEMINI_SELECTOR = "mcpServers.tap-comms";
function candidateConfigPaths(ctx) {
  const home = getHomeDir();
  return [
    path12.join(ctx.repoRoot, ".gemini", "settings.json"),
    path12.join(home, ".gemini", "settings.json"),
    path12.join(home, ".gemini", "antigravity", "mcp_config.json")
  ];
}
function chooseGeminiConfigPath(ctx) {
  const [workspaceConfig, homeConfig, antigravityConfig] = candidateConfigPaths(ctx);
  if (fs13.existsSync(workspaceConfig)) return workspaceConfig;
  if (fs13.existsSync(homeConfig)) return homeConfig;
  if (fs13.existsSync(antigravityConfig)) {
    const raw = fs13.readFileSync(antigravityConfig, "utf-8").trim();
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
  if (!fs13.existsSync(filePath)) return {};
  const raw = fs13.readFileSync(filePath, "utf-8").trim();
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
    passed: fs13.existsSync(configPath),
    message: fs13.existsSync(configPath) ? void 0 : `${configPath} not found`
  });
  checks.push({
    name: "tap entry present",
    passed: !!entry,
    message: entry ? void 0 : `${GEMINI_SELECTOR} not found`
  });
  checks.push({
    name: "Comms directory exists",
    passed: fs13.existsSync(ctx.commsDir),
    message: fs13.existsSync(ctx.commsDir) ? void 0 : `${ctx.commsDir} not found`
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
var geminiAdapter = {
  runtime: "gemini",
  async probe(ctx) {
    const warnings = [];
    const issues = [];
    const configPath = chooseGeminiConfigPath(ctx);
    const configExists = fs13.existsSync(configPath);
    const runtimeProbe = probeCommand(
      ctx.platform === "win32" ? ["gemini", "gemini.cmd"] : ["gemini"]
    );
    if (!runtimeProbe.command) {
      warnings.push(
        "Gemini CLI not found in PATH. Config can still be written, but runtime verification will be limited."
      );
    }
    if (!fs13.existsSync(ctx.commsDir)) {
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
    if (fs13.existsSync(configPath)) {
      if (fs13.readFileSync(configPath, "utf-8").trim()) {
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
    fs13.mkdirSync(path12.dirname(configPath), { recursive: true });
    const tmp = `${configPath}.tmp.${process.pid}`;
    fs13.writeFileSync(tmp, JSON.stringify(config, null, 2) + "\n", "utf-8");
    fs13.renameSync(tmp, configPath);
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

// src/adapters/index.ts
var adapters = {
  claude: claudeAdapter,
  codex: codexAdapter,
  gemini: geminiAdapter
};
function getAdapter(runtime) {
  const adapter = adapters[runtime];
  if (!adapter) {
    throw new Error(
      `Adapter for "${runtime}" is not yet available. Supported: ${Object.keys(adapters).join(", ")}`
    );
  }
  return adapter;
}

// src/engine/bridge-paths.ts
import * as path13 from "path";
function assertPathContained(resolved, stateDir, subDir) {
  const expectedDir = path13.resolve(stateDir, subDir) + path13.sep;
  const normalizedResolved = path13.resolve(resolved);
  if (!normalizedResolved.startsWith(expectedDir)) {
    throw new Error(
      `Path traversal blocked: resolved path escapes "${subDir}/" directory`
    );
  }
  return normalizedResolved;
}
function appServerLogFilePath(stateDir, instanceId) {
  return assertPathContained(
    path13.join(stateDir, "logs", `app-server-${instanceId}.log`),
    stateDir,
    "logs"
  );
}
function appServerGatewayLogFilePath(stateDir, instanceId) {
  return assertPathContained(
    path13.join(stateDir, "logs", `app-server-gateway-${instanceId}.log`),
    stateDir,
    "logs"
  );
}
function appServerGatewayTokenFilePath(stateDir, instanceId) {
  return assertPathContained(
    path13.join(stateDir, "secrets", `app-server-gateway-${instanceId}.token`),
    stateDir,
    "secrets"
  );
}
function stderrLogFilePath(logPath) {
  return `${logPath}.stderr`;
}
function pidFilePath(stateDir, instanceId) {
  return assertPathContained(
    path13.join(stateDir, "pids", `bridge-${instanceId}.json`),
    stateDir,
    "pids"
  );
}
function logFilePath(stateDir, instanceId) {
  return assertPathContained(
    path13.join(stateDir, "logs", `bridge-${instanceId}.log`),
    stateDir,
    "logs"
  );
}
function runtimeHeartbeatFilePath(runtimeStateDir) {
  return path13.join(runtimeStateDir, "heartbeat.json");
}
function runtimeThreadStateFilePath(runtimeStateDir) {
  return path13.join(runtimeStateDir, "thread.json");
}

// src/engine/bridge-file-io.ts
import * as fs14 from "fs";
import * as path14 from "path";
var APP_SERVER_AUTH_FILE_MODE = 384;
function writeProtectedTextFile(filePath, content) {
  fs14.mkdirSync(path14.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp.${process.pid}`;
  fs14.writeFileSync(tmp, content, {
    encoding: "utf-8",
    mode: APP_SERVER_AUTH_FILE_MODE
  });
  fs14.chmodSync(tmp, APP_SERVER_AUTH_FILE_MODE);
  fs14.renameSync(tmp, filePath);
  fs14.chmodSync(filePath, APP_SERVER_AUTH_FILE_MODE);
}
function removeFileIfExists(filePath) {
  if (!filePath || !fs14.existsSync(filePath)) {
    return;
  }
  try {
    fs14.unlinkSync(filePath);
  } catch {
  }
}
function toPowerShellSingleQuotedString(value) {
  return `'${value.replace(/'/g, "''")}'`;
}
function toPowerShellStringArrayLiteral(values) {
  return `@(${values.map(toPowerShellSingleQuotedString).join(", ")})`;
}

// src/engine/bridge-port-network.ts
import * as net from "net";
var DEFAULT_APP_SERVER_URL2 = "ws://127.0.0.1:4501";
function getWebSocketCtor() {
  const candidate = globalThis.WebSocket;
  return typeof candidate === "function" ? candidate : null;
}
function delay(ms) {
  return new Promise((resolve15) => setTimeout(resolve15, ms));
}
function isLoopbackHost(hostname) {
  return hostname === "127.0.0.1" || hostname === "localhost";
}
async function allocateLoopbackPort(hostname) {
  const bindHost = hostname === "localhost" ? "127.0.0.1" : hostname;
  return await new Promise((resolve15, reject) => {
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
        resolve15(port);
      });
    });
  });
}
async function isTcpPortAvailable(hostname, port) {
  const bindHost = hostname === "localhost" ? "127.0.0.1" : hostname;
  return await new Promise((resolve15) => {
    const server = net.createServer();
    server.unref();
    server.once("error", () => resolve15(false));
    server.listen(port, bindHost, () => {
      server.close((error) => resolve15(!error));
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
async function findNextAvailableAppServerPort(state, baseUrl, basePort = 4501, excludeInstanceId) {
  let hostname = "127.0.0.1";
  try {
    hostname = new URL(baseUrl ?? DEFAULT_APP_SERVER_URL2).hostname;
  } catch {
  }
  const maxAttempts = 1e3;
  let port = basePort;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1, port += 1) {
    const claimedInState = Object.entries(state.instances).some(
      ([id, inst]) => id !== excludeInstanceId && inst.port === port
    );
    if (claimedInState) {
      continue;
    }
    if (!isLoopbackHost(hostname)) {
      return port;
    }
    if (await isTcpPortAvailable(hostname, port)) {
      return port;
    }
  }
  throw new Error(
    `Failed to find a free app-server port starting at ${basePort}`
  );
}

// src/engine/bridge-codex-command.ts
import * as fs15 from "fs";
import * as path15 from "path";
import { fileURLToPath as fileURLToPath4 } from "url";
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
    content = fs15.readFileSync(cmdPath, "utf-8");
  } catch {
    return null;
  }
  const match = content.match(/"%_prog%"\s+"(%dp0%\\[^"]+)"\s+%\*/);
  if (!match) return null;
  const dp0 = path15.dirname(cmdPath);
  const scriptRelative = match[1].replace(/%dp0%\\/g, "");
  const scriptPath = path15.resolve(dp0, scriptRelative);
  if (!fs15.existsSync(scriptPath)) return null;
  const localNode = path15.join(dp0, "node.exe");
  const nodeCommand = fs15.existsSync(localNode) ? localNode : probeCommand(["node.exe", "node"]).command ?? "node";
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
function resolveAuthGatewayScript(repoRoot) {
  const moduleDir = path15.dirname(fileURLToPath4(import.meta.url));
  const resolvedModuleDir = path15.resolve(moduleDir);
  const resolvedRepoRoot = path15.resolve(repoRoot);
  const candidates = [
    // Bundled: dist/bridges/ sibling (npm install / built package)
    path15.join(moduleDir, "bridges", "codex-app-server-auth-gateway.mjs"),
    // Source: src/bridges/ sibling (monorepo dev with ts runner)
    path15.join(moduleDir, "bridges", "codex-app-server-auth-gateway.ts"),
    // Monorepo dist fallback
    path15.join(
      repoRoot,
      "packages",
      "tap-comms",
      "dist",
      "bridges",
      "codex-app-server-auth-gateway.mjs"
    ),
    path15.join(
      repoRoot,
      "packages",
      "tap-comms",
      "src",
      "bridges",
      "codex-app-server-auth-gateway.ts"
    )
  ];
  for (const candidate of candidates) {
    const resolved = path15.resolve(candidate);
    if (!resolved.startsWith(resolvedModuleDir + path15.sep) && !resolved.startsWith(resolvedRepoRoot + path15.sep)) {
      continue;
    }
    if (fs15.existsSync(resolved)) {
      return resolved;
    }
  }
  return null;
}

// src/engine/bridge-windows-spawn.ts
import * as fs16 from "fs";
import * as os3 from "os";
import * as path16 from "path";
import { randomBytes } from "crypto";
import { spawnSync as spawnSync3 } from "child_process";
var WINDOWS_SPAWN_WRAPPER_PREFIX = "tap-spawn-";
var WINDOWS_SPAWN_WRAPPER_STALE_MS = 60 * 60 * 1e3;
function cleanupStaleWindowsSpawnWrappers(now = Date.now()) {
  let entries;
  try {
    entries = fs16.readdirSync(os3.tmpdir());
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.startsWith(WINDOWS_SPAWN_WRAPPER_PREFIX) || !/\.(cmd|ps1)$/i.test(entry)) {
      continue;
    }
    const wrapperPath = path16.join(os3.tmpdir(), entry);
    try {
      const stats = fs16.statSync(wrapperPath);
      if (now - stats.mtimeMs < WINDOWS_SPAWN_WRAPPER_STALE_MS) {
        continue;
      }
      fs16.unlinkSync(wrapperPath);
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
function startWindowsDetachedProcess(command, args, repoRoot, logPath, env = process.env) {
  const stderrLogPath = stderrLogFilePath(logPath);
  const powerShellCommand = resolvePowerShellCommand();
  cleanupStaleWindowsSpawnWrappers();
  const wrapperPath = path16.join(
    os3.tmpdir(),
    `${WINDOWS_SPAWN_WRAPPER_PREFIX}${randomBytes(4).toString("hex")}.ps1`
  );
  fs16.writeFileSync(
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
    removeFileIfExists(wrapperPath);
    return null;
  }
  const pid = parseInt(result.stdout.trim(), 10);
  if (!Number.isFinite(pid)) {
    removeFileIfExists(wrapperPath);
    return null;
  }
  return pid;
}
function startWindowsCodexAppServer(command, url, repoRoot, logPath, env = process.env) {
  const { command: exe, prefixArgs } = splitResolvedCommand(command);
  return startWindowsDetachedProcess(
    exe,
    [...prefixArgs, "app-server", "--listen", url],
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

// src/engine/bridge-unix-spawn.ts
import * as fs17 from "fs";
import { spawn, spawnSync as spawnSync4 } from "child_process";
var DEFAULT_UNIX_PLATFORM = process.platform === "darwin" ? "darwin" : "linux";
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
    logFd = fs17.openSync(logPath, "a");
    stderrFd = fs17.openSync(stderrPath, "a");
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
      fs17.closeSync(logFd);
    }
    if (stderrFd != null) {
      fs17.closeSync(stderrFd);
    }
  }
}
function startUnixCodexAppServer(command, url, repoRoot, logPath, env = process.env, platform = DEFAULT_UNIX_PLATFORM) {
  const { command: exe, prefixArgs } = splitResolvedCommand(command);
  return startUnixDetachedProcess(
    exe,
    [...prefixArgs, "app-server", "--listen", url],
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

// src/engine/bridge-process-control.ts
import { execSync as execSync2, spawnSync as spawnSync5 } from "child_process";
function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
function getUnixProcessGroupId(pid) {
  const result = spawnSync5("ps", ["-o", "pgid=", "-p", String(pid)], {
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
      execSync2(`taskkill /PID ${pid} /F /T`, { stdio: "pipe" });
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
  removeFileIfExists(appServer.auth?.tokenPath);
  return stopped;
}

// src/engine/bridge-config.ts
import * as fs18 from "fs";
import * as path17 from "path";
init_instance_config();
function resolveAgentName(instanceId, explicit, context) {
  if (explicit) return explicit;
  if (context?.stateDir) {
    try {
      const instConfig = loadInstanceConfig(context.stateDir, instanceId);
      if (instConfig?.agentName) return instConfig.agentName;
    } catch {
    }
  }
  try {
    const repoRoot = context?.repoRoot ?? context?.stateDir?.replace(/[\\/].tap-comms$/, "") ?? process.cwd();
    const state = loadState(repoRoot);
    const stateAgent = state?.instances[instanceId]?.agentName;
    if (stateAgent) return stateAgent;
  } catch {
  }
  return process.env.TAP_AGENT_NAME || process.env.CODEX_TAP_AGENT_NAME || null;
}
function inferRestartMode(bridgeState, flags, savedMode) {
  const wasManaged = bridgeState?.appServer != null;
  const hadAuth = bridgeState?.appServer?.auth != null;
  const manageAppServer = flags?.noServer === true ? false : flags?.noServer === void 0 ? savedMode?.manageAppServer ?? wasManaged : true;
  const noAuth = flags?.noAuth === true ? true : flags?.noAuth === void 0 ? savedMode?.noAuth ?? !hadAuth : false;
  return { manageAppServer, noAuth };
}
function cleanupHeadlessDispatch(inboxDir, agentName) {
  const removed = [];
  if (!fs18.existsSync(inboxDir)) return removed;
  const normalizedAgent = agentName.replace(/-/g, "_");
  const marker = `-headless-${normalizedAgent}-review-`;
  try {
    for (const file of fs18.readdirSync(inboxDir)) {
      if (file.includes(marker)) {
        fs18.unlinkSync(path17.join(inboxDir, file));
        removed.push(file);
      }
    }
  } catch {
  }
  return removed;
}

// src/engine/bridge-state.ts
import * as fs19 from "fs";
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
  if (!fs19.existsSync(heartbeatPath)) {
    return null;
  }
  try {
    return JSON.parse(
      fs19.readFileSync(heartbeatPath, "utf-8")
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
  if (!fs19.existsSync(threadPath)) {
    return null;
  }
  try {
    const parsed = JSON.parse(
      fs19.readFileSync(threadPath, "utf-8")
    );
    return parsed.threadId ? parsed : null;
  } catch {
    return null;
  }
}
function loadBridgeState(stateDir, instanceId) {
  const pidPath = pidFilePath(stateDir, instanceId);
  if (!fs19.existsSync(pidPath)) return null;
  try {
    const raw = fs19.readFileSync(pidPath, "utf-8");
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
  if (fs19.existsSync(pidPath)) {
    fs19.unlinkSync(pidPath);
  }
}
function isBridgeRunning(stateDir, instanceId) {
  const state = loadBridgeState(stateDir, instanceId);
  if (!state) return false;
  return isProcessAlive(state.pid);
}

// src/engine/bridge-observability.ts
import * as fs20 from "fs";
function loadRuntimeHeartbeatTimestamp(runtimeStateDir) {
  const heartbeat = loadRuntimeBridgeHeartbeat({ runtimeStateDir });
  return typeof heartbeat?.updatedAt === "string" ? heartbeat.updatedAt : null;
}
function resolveHeartbeatTimestamp(state) {
  return loadRuntimeHeartbeatTimestamp(state?.runtimeStateDir) ?? state?.lastHeartbeat ?? null;
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
  if (!fs20.existsSync(logPath)) return;
  try {
    const stats = fs20.statSync(logPath);
    if (stats.size === 0) return;
    const prevPath = `${logPath}.prev`;
    fs20.renameSync(logPath, prevPath);
  } catch {
  }
}

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

// src/engine/codex-session-state.ts
import * as fs21 from "fs";
import * as path18 from "path";
function readLastDispatchAt(runtimeStateDir) {
  if (!runtimeStateDir) return null;
  const filePath = path18.join(runtimeStateDir, "last-dispatch.json");
  if (!fs21.existsSync(filePath)) return null;
  try {
    const parsed = JSON.parse(
      fs21.readFileSync(filePath, "utf-8")
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

// src/engine/bridge-app-server-health.ts
import * as net2 from "net";
var APP_SERVER_HEALTH_TIMEOUT_MS = 1500;
var APP_SERVER_HEALTH_RETRY_MS = 250;
var APP_SERVER_READYZ_PATH = "/readyz";
var AUTH_SUBPROTOCOL_PREFIX = "tap-auth-";
async function checkAppServerHealth(url, timeoutMs = APP_SERVER_HEALTH_TIMEOUT_MS, gatewayToken) {
  const WebSocket = getWebSocketCtor();
  if (!WebSocket) {
    return false;
  }
  return new Promise((resolve15) => {
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
      resolve15(healthy);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    try {
      const protocols = gatewayToken ? [`${AUTH_SUBPROTOCOL_PREFIX}${gatewayToken}`] : void 0;
      socket = new WebSocket(url, protocols);
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
  return new Promise((resolve15) => {
    const socket = net2.createConnection({ host: hostname, port });
    const timer = setTimeout(() => {
      socket.destroy();
      resolve15(false);
    }, timeoutMs);
    socket.once("connect", () => {
      clearTimeout(timer);
      socket.destroy();
      resolve15(true);
    });
    socket.once("error", () => {
      clearTimeout(timer);
      socket.destroy();
      resolve15(false);
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

// src/engine/bridge-app-server-auth.ts
import * as fs23 from "fs";
import * as path20 from "path";
import { randomBytes as randomBytes2 } from "crypto";

// src/runtime/resolve-node.ts
import * as fs22 from "fs";
import * as path19 from "path";
import { execSync as execSync3 } from "child_process";
function readNodeVersion(repoRoot) {
  const nvFile = path19.join(repoRoot, ".node-version");
  if (!fs22.existsSync(nvFile)) return null;
  try {
    const raw = fs22.readFileSync(nvFile, "utf-8").trim();
    return raw.length > 0 ? raw.replace(/^v/, "") : null;
  } catch {
    return null;
  }
}
function fnmCandidateDirs() {
  if (process.platform === "win32") {
    return [
      process.env.FNM_DIR,
      process.env.APPDATA ? path19.join(process.env.APPDATA, "fnm") : null,
      process.env.LOCALAPPDATA ? path19.join(process.env.LOCALAPPDATA, "fnm") : null,
      process.env.USERPROFILE ? path19.join(process.env.USERPROFILE, "scoop", "persist", "fnm") : null
    ].filter(Boolean);
  }
  return [
    process.env.FNM_DIR,
    process.env.HOME ? path19.join(process.env.HOME, ".local", "share", "fnm") : null,
    process.env.HOME ? path19.join(process.env.HOME, ".fnm") : null,
    process.env.XDG_DATA_HOME ? path19.join(process.env.XDG_DATA_HOME, "fnm") : null
  ].filter(Boolean);
}
function nodeExecutableName() {
  return process.platform === "win32" ? "node.exe" : "node";
}
function probeFnmNode(desiredVersion) {
  const dirs = fnmCandidateDirs();
  const exe = nodeExecutableName();
  for (const baseDir of dirs) {
    const candidate = path19.join(
      baseDir,
      "node-versions",
      `v${desiredVersion}`,
      "installation",
      exe
    );
    if (!fs22.existsSync(candidate)) continue;
    try {
      const v = execSync3(`"${candidate}" --version`, {
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
    const version2 = execSync3(`"${command}" --version`, {
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
    execSync3(`"${command}" --experimental-strip-types -e ""`, {
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
    path19.join(repoRoot, "node_modules", ".bin", "tsx.exe"),
    path19.join(repoRoot, "node_modules", ".bin", "tsx.CMD"),
    path19.join(repoRoot, "node_modules", ".bin", "tsx")
  ];
  for (const c of candidates) {
    if (fs22.existsSync(c)) return c;
  }
  return null;
}
function getFnmBinDir(repoRoot) {
  const desiredVersion = readNodeVersion(repoRoot);
  if (!desiredVersion) return null;
  const nodePath = probeFnmNode(desiredVersion);
  if (!nodePath) return null;
  return path19.dirname(nodePath);
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
    [pathKey]: `${fnmBin}${path19.delimiter}${currentPath}`
  };
}

// src/engine/bridge-app-server-auth.ts
function buildProtectedAppServerUrl(publicUrl, _token) {
  return publicUrl;
}
function readGatewayTokenFromPath(tokenPath) {
  return fs23.readFileSync(tokenPath, "utf8").trim();
}
function readGatewayToken(auth) {
  if (!auth) {
    return null;
  }
  const legacyToken = auth.token;
  if (legacyToken?.trim()) {
    return legacyToken.trim();
  }
  if (!auth.tokenPath || !fs23.existsSync(auth.tokenPath)) {
    return null;
  }
  const fileToken = readGatewayTokenFromPath(auth.tokenPath);
  return fileToken || null;
}
function materializeGatewayTokenFile(stateDir, instanceId, publicUrl, auth) {
  if (auth.tokenPath && fs23.existsSync(auth.tokenPath)) {
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
  fs23.mkdirSync(path20.dirname(gatewayLogPath), { recursive: true });
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
    removeFileIfExists(tokenPath);
    throw error;
  }
  if (gatewayPid == null) {
    removeFileIfExists(tokenPath);
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

// src/engine/bridge-app-server-lifecycle.ts
import * as fs24 from "fs";
import * as path21 from "path";
var DEFAULT_APP_SERVER_URL3 = "ws://127.0.0.1:4501";
var APP_SERVER_START_TIMEOUT_MS = 2e4;
var APP_SERVER_GATEWAY_START_TIMEOUT_MS = 5e3;
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
  const pidDir = path21.join(stateDir, "pids");
  if (!fs24.existsSync(pidDir)) return false;
  for (const name of fs24.readdirSync(pidDir)) {
    if (!name.startsWith("bridge-") || !name.endsWith(".json")) continue;
    const otherId = name.slice("bridge-".length, -".json".length);
    if (otherId === excludeInstanceId) continue;
    try {
      const raw = fs24.readFileSync(path21.join(pidDir, name), "utf-8");
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
  const pidDir = path21.join(stateDir, "pids");
  if (!fs24.existsSync(pidDir)) {
    return null;
  }
  for (const name of fs24.readdirSync(pidDir)) {
    if (!name.startsWith("bridge-") || !name.endsWith(".json")) {
      continue;
    }
    try {
      const raw = fs24.readFileSync(path21.join(pidDir, name), "utf-8");
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
    effectiveUrl
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
  fs24.mkdirSync(path21.dirname(logPath), { recursive: true });
  rotateLog(logPath);
  const appServerEnv = buildCodexAppServerEnv(options);
  if (options.noAuth) {
    const manualCommand2 = formatCodexAppServerCommand("codex", effectiveUrl);
    let pid2;
    if (options.platform === "win32") {
      try {
        pid2 = startWindowsCodexAppServer(
          resolvedCommand,
          effectiveUrl,
          options.repoRoot,
          logPath,
          appServerEnv
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
          options.platform
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
  const manualCommand = formatCodexAppServerCommand("codex", auth.upstreamUrl);
  let pid;
  if (options.platform === "win32") {
    try {
      pid = startWindowsCodexAppServer(
        resolvedCommand,
        auth.upstreamUrl,
        options.repoRoot,
        logPath,
        appServerEnv
      );
    } catch (err) {
      if (auth.gatewayPid != null) {
        await terminateProcess(auth.gatewayPid, options.platform);
      }
      removeFileIfExists(auth.tokenPath);
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
        options.platform
      );
    } catch (err) {
      if (auth.gatewayPid != null) {
        await terminateProcess(auth.gatewayPid, options.platform);
      }
      removeFileIfExists(auth.tokenPath);
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
    removeFileIfExists(auth.tokenPath);
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
    removeFileIfExists(auth.tokenPath);
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
    removeFileIfExists(auth.tokenPath);
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
    removeFileIfExists(auth.tokenPath);
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
function formatCodexAppServerCommand(command, url) {
  return `${command} app-server --listen ${url}`;
}

// src/engine/bridge-startup.ts
import * as fs25 from "fs";
import * as path22 from "path";
function getBridgeRuntimeStateDir(repoRoot, instanceId) {
  const resolved = path22.resolve(
    path22.join(repoRoot, ".tmp", `codex-app-server-bridge-${instanceId}`)
  );
  const expectedBase = path22.resolve(repoRoot, ".tmp") + path22.sep;
  if (!resolved.startsWith(expectedBase)) {
    throw new Error(
      `Path traversal blocked: runtime state dir escapes .tmp/ directory`
    );
  }
  return resolved;
}
var STALE_DIRECT_HEARTBEAT_MS = 5 * 60 * 1e3;
function warnHeartbeatCleanup(instanceId, message) {
  console.warn(
    `[tap] heartbeat cleanup skipped for ${instanceId}: ${message}`
  );
}
function getHeartbeatActivityMs(record) {
  const timestamp = new Date(record.lastActivity ?? record.timestamp ?? 0).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}
function isSameInstanceHeartbeat(key, heartbeat, instanceId) {
  if (heartbeat.instanceId === instanceId) return true;
  if (heartbeat.connectHash === `instance:${instanceId}`) return true;
  return key === instanceId || key.replace(/_/g, "-") === instanceId || key.replace(/-/g, "_") === instanceId;
}
function cleanupStaleSameInstanceHeartbeats(commsDir, instanceId) {
  const heartbeatsPath = path22.join(commsDir, "heartbeats.json");
  if (!fs25.existsSync(heartbeatsPath)) return;
  const lockPath = path22.join(commsDir, ".heartbeats.lock");
  try {
    fs25.writeFileSync(lockPath, String(process.pid), { flag: "wx" });
  } catch {
    warnHeartbeatCleanup(instanceId, "heartbeat store busy");
    return;
  }
  try {
    let store = {};
    try {
      store = JSON.parse(
        fs25.readFileSync(heartbeatsPath, "utf-8")
      );
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
    fs25.writeFileSync(tmpPath, JSON.stringify(store, null, 2), "utf-8");
    fs25.renameSync(tmpPath, heartbeatsPath);
  } catch (error) {
    warnHeartbeatCleanup(
      instanceId,
      error instanceof Error ? error.message : String(error)
    );
  } finally {
    try {
      fs25.unlinkSync(lockPath);
    } catch {
    }
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
  if (isBridgeRunning(stateDir, instanceId)) {
    const existing = loadBridgeState(stateDir, instanceId);
    throw new Error(
      `Bridge for ${instanceId} is already running (PID: ${existing.pid})`
    );
  }
  const previousBridgeState = loadBridgeState(stateDir, instanceId);
  const previousLifecycle = options.previousLifecycle ?? previousBridgeState?.lifecycle ?? null;
  const previousAppServer = previousBridgeState?.appServer ?? null;
  clearBridgeState(stateDir, instanceId);
  cleanupStaleSameInstanceHeartbeats(commsDir, instanceId);
  const logPath = logFilePath(stateDir, instanceId);
  fs25.mkdirSync(path22.dirname(logPath), { recursive: true });
  rotateLog(logPath);
  const repoRoot = options.repoRoot ?? path22.resolve(stateDir, "..");
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
      noAuth: options.noAuth
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
  try {
    const bridgeEnv = {
      ...runtimeEnv,
      TAP_COMMS_DIR: commsDir,
      TAP_STATE_DIR: stateDir,
      TAP_RUNTIME_STATE_DIR: runtimeStateDir,
      TAP_REPO_ROOT: repoRoot,
      TAP_BRIDGE_RUNTIME: runtime,
      TAP_BRIDGE_INSTANCE_ID: instanceId,
      TAP_AGENT_ID: instanceId,
      TAP_AGENT_NAME: resolvedAgent,
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
    const state = {
      pid: bridgePid,
      statePath: pidFilePath(stateDir, instanceId),
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
  }
}

// src/engine/bridge-orchestrator.ts
import * as fs26 from "fs";
import * as path23 from "path";
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
async function restartBridge(options) {
  const { instanceId, stateDir, platform } = options;
  const drainTimeout = (options.drainTimeoutSeconds ?? 30) * 1e3;
  const repoRoot = options.repoRoot ?? stateDir.replace(/[\\/].tap-comms$/, "");
  const runtimeStateDir = getBridgeRuntimeStateDir(repoRoot, instanceId);
  const heartbeatPath = path23.join(runtimeStateDir, "heartbeat.json");
  if (fs26.existsSync(heartbeatPath)) {
    const startWait = Date.now();
    while (Date.now() - startWait < drainTimeout) {
      try {
        const hb = JSON.parse(fs26.readFileSync(heartbeatPath, "utf-8"));
        if (!hb.activeTurnId) break;
      } catch {
        break;
      }
      await new Promise((resolve15) => setTimeout(resolve15, 1e3));
    }
  }
  if (options.headless?.enabled && options.commsDir) {
    const agentName = options.agentName ?? instanceId;
    cleanupHeadlessDispatch(path23.join(options.commsDir, "inbox"), agentName);
  }
  const stopResult = await stopBridge({ instanceId, stateDir, platform });
  return startBridge({
    ...options,
    processExistingMessages: true,
    previousLifecycle: stopResult.lifecycle ?? options.previousLifecycle ?? null
  });
}

// src/commands/add.ts
init_config();
init_instance_config();
var ADD_HELP = `
Usage:
  tap add <claude|codex|gemini> [options]

Description:
  Install a runtime instance and configure it to use tap.

Options:
  --name <name>         Instance name (default: runtime name)
  --port <port>         Port for app-server bridge
  --agent-name <name>   Agent display name for bridge identification
  --force               Re-install even if already configured
  --headless            Enable headless reviewer mode (requires --name)
  --role <role>         Headless role: reviewer, validator, long-running
  --help, -h            Show help

Examples:
  npx @hua-labs/tap add claude
  npx @hua-labs/tap add codex --name reviewer --port 4501 --headless --role reviewer
`.trim();
function normalizeAgentName(value) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}
function resolveAgentName2(options) {
  return normalizeAgentName(options.explicit) ?? normalizeAgentName(options.stored) ?? normalizeAgentName(options.env) ?? normalizeAgentName(options.fallback) ?? null;
}
async function addCommand(args) {
  const { positional, flags } = parseArgs(args);
  if (flags["help"] === true || flags["h"] === true) {
    log(ADD_HELP);
    return {
      ok: true,
      command: "add",
      code: "TAP_NO_OP",
      message: ADD_HELP,
      warnings: [],
      data: {}
    };
  }
  const runtimeArg = positional[0];
  if (!runtimeArg) {
    return {
      ok: false,
      command: "add",
      code: "TAP_INVALID_ARGUMENT",
      message: "Missing runtime argument. Usage: npx @hua-labs/tap add <claude|codex|gemini> [--name <name>] [--port <port>] [--agent-name <name>] [--headless] [--role <role>]",
      warnings: [],
      data: {}
    };
  }
  if (!isValidRuntime(runtimeArg)) {
    return {
      ok: false,
      command: "add",
      code: "TAP_RUNTIME_UNKNOWN",
      message: `Unknown runtime: ${runtimeArg}. Available: claude, codex, gemini`,
      warnings: [],
      data: {}
    };
  }
  const runtime = runtimeArg;
  const instanceName = typeof flags["name"] === "string" ? flags["name"] : void 0;
  const instanceId = buildInstanceId(runtime, instanceName);
  const portStr = typeof flags["port"] === "string" ? flags["port"] : void 0;
  const port = portStr ? Number(portStr) : null;
  const agentNameFlag = normalizeAgentName(
    typeof flags["agent-name"] === "string" ? flags["agent-name"] : null
  );
  const force = flags["force"] === true;
  const headlessFlag = flags["headless"] === true;
  const roleArg = typeof flags["role"] === "string" ? flags["role"] : void 0;
  const validRoles = ["reviewer", "validator", "long-running"];
  if (roleArg && !validRoles.includes(roleArg)) {
    return {
      ok: false,
      command: "add",
      runtime,
      instanceId,
      code: "TAP_INVALID_ARGUMENT",
      message: `Invalid role: ${roleArg}. Available: ${validRoles.join(", ")}`,
      warnings: [],
      data: {}
    };
  }
  if (headlessFlag && !instanceName) {
    return {
      ok: false,
      command: "add",
      runtime,
      instanceId,
      code: "TAP_INVALID_ARGUMENT",
      message: "--headless requires --name for instance isolation",
      warnings: [],
      data: {}
    };
  }
  const headless = headlessFlag ? {
    enabled: true,
    role: roleArg ?? "reviewer",
    maxRounds: 5,
    qualitySeverityFloor: "high"
  } : null;
  if (portStr && (port === null || isNaN(port) || port < 1 || port > 65535)) {
    return {
      ok: false,
      command: "add",
      runtime,
      instanceId,
      code: "TAP_INVALID_ARGUMENT",
      message: `Invalid port: ${portStr}. Must be between 1 and 65535.`,
      warnings: [],
      data: {}
    };
  }
  const repoRoot = findRepoRoot();
  const state = loadState(repoRoot);
  const adapter = getAdapter(runtime);
  if (!state) {
    return {
      ok: false,
      command: "add",
      runtime,
      instanceId,
      code: "TAP_NOT_INITIALIZED",
      message: "Not initialized. Run: npx @hua-labs/tap init",
      warnings: [],
      data: {}
    };
  }
  const existingInstance = state.instances[instanceId];
  const mode = adapter.bridgeMode();
  const envAgentName = normalizeAgentName(
    process.env.TAP_AGENT_NAME ?? process.env.CODEX_TAP_AGENT_NAME
  );
  const defaultAgentName = mode === "app-server" ? instanceId : null;
  const resolvedAgentName = resolveAgentName2({
    explicit: agentNameFlag,
    env: envAgentName,
    stored: existingInstance?.agentName ?? null,
    fallback: defaultAgentName
  });
  if (existingInstance?.installed && !force) {
    if (resolvedAgentName !== existingInstance.agentName) {
      const updatedState = updateInstanceState(state, instanceId, {
        ...existingInstance,
        agentName: resolvedAgentName
      });
      saveState(repoRoot, updatedState);
      const { config: cfg } = resolveConfig({}, repoRoot);
      try {
        const {
          loadInstanceConfig: loadInstCfg,
          updateInstanceConfig: updateInstCfg,
          saveInstanceConfig: saveInstCfg
        } = await Promise.resolve().then(() => (init_instance_config(), instance_config_exports));
        const existing = loadInstCfg(cfg.stateDir, instanceId);
        if (existing) {
          const updated = updateInstCfg(existing, {
            agentName: resolvedAgentName
          });
          saveInstCfg(cfg.stateDir, updated);
        }
      } catch {
      }
      return {
        ok: true,
        command: "add",
        runtime,
        instanceId,
        code: "TAP_ADD_OK",
        message: resolvedAgentName === null ? `${instanceId} updated` : `${instanceId} agent name updated to "${resolvedAgentName}".`,
        warnings: [],
        data: {
          updatedFields: ["agentName"],
          agentName: resolvedAgentName
        }
      };
    }
    return {
      ok: true,
      command: "add",
      runtime,
      instanceId,
      code: "TAP_NO_OP",
      message: `${instanceId} is already installed. Use --force to re-install.`,
      warnings: [],
      data: {}
    };
  }
  if (port !== null) {
    const conflict = findPortConflict(state, port, instanceId);
    if (conflict) {
      return {
        ok: false,
        command: "add",
        runtime,
        instanceId,
        code: "TAP_PORT_CONFLICT",
        message: `Port ${port} is already used by instance "${conflict}".`,
        warnings: [],
        data: { conflictingInstance: conflict }
      };
    }
  }
  logHeader(`@hua-labs/tap add ${instanceId}`);
  if (instanceName) log(`Instance name: ${instanceName}`);
  if (port !== null) log(`Port: ${port}`);
  if (resolvedAgentName) log(`Agent name: ${resolvedAgentName}`);
  const ctx = {
    ...createAdapterContext(state.commsDir, repoRoot),
    instanceId,
    agentName: resolvedAgentName ?? void 0
  };
  const warnings = [];
  log("Probing runtime...");
  const probe = await adapter.probe(ctx);
  if (!probe.installed) {
    return {
      ok: false,
      command: "add",
      runtime,
      instanceId,
      code: "TAP_RUNTIME_NOT_FOUND",
      message: `${runtime} runtime not found.`,
      warnings: probe.warnings,
      data: { issues: probe.issues }
    };
  }
  logSuccess(`Found ${runtime} (${probe.runtimeCommand ?? "unknown"})`);
  if (probe.configPath) log(`Config: ${probe.configPath}`);
  warnings.push(...probe.warnings);
  for (const w of probe.warnings) logWarn(w);
  log("Planning patches...");
  const plan = await adapter.plan(ctx, probe);
  warnings.push(...plan.warnings);
  if (plan.conflicts.length > 0) {
    logWarn("Conflicts detected:");
    for (const c of plan.conflicts) logWarn(`  ${c}`);
  }
  log(`Operations: ${plan.operations.length}`);
  log(`Artifacts:  ${plan.ownedArtifacts.length}`);
  for (const w of plan.warnings) logWarn(w);
  if (plan.operations.length === 0) {
    const failureMessage = probe.issues[0] ?? plan.warnings[0] ?? probe.warnings[0] ?? "No operations to apply. Runtime not configured.";
    const failureCode = /MCP server/i.test(failureMessage) ? "TAP_LOCAL_SERVER_MISSING" : "TAP_PATCH_FAILED";
    return {
      ok: false,
      command: "add",
      runtime,
      instanceId,
      code: failureCode,
      message: failureMessage,
      warnings,
      data: { planOps: 0 }
    };
  }
  const backupDir = ensureBackupDir(ctx.stateDir, instanceId);
  log(`Backup dir: ${backupDir}`);
  log("Applying patches...");
  const result = await adapter.apply(ctx, plan);
  warnings.push(...result.warnings);
  if (!result.success) {
    return {
      ok: false,
      command: "add",
      runtime,
      instanceId,
      code: "TAP_PATCH_FAILED",
      message: "Failed to apply patches.",
      warnings,
      data: { appliedOps: result.appliedOps }
    };
  }
  logSuccess(`Applied ${result.appliedOps} operation(s)`);
  for (const f of result.changedFiles) logSuccess(`Modified: ${f}`);
  for (const w of result.warnings) logWarn(w);
  log("Verifying...");
  const verify = await adapter.verify(ctx, plan);
  warnings.push(...verify.warnings);
  for (const check of verify.checks) {
    if (check.passed) {
      logSuccess(`${check.name}`);
    } else {
      logError(`${check.name}: ${check.message ?? "failed"}`);
    }
  }
  if (!verify.ok) {
    logWarn(
      "Verification had failures. Runtime may need manual configuration."
    );
  }
  const { config: resolvedCfg } = resolveConfig({}, repoRoot);
  let bridge = null;
  let effectivePort = port;
  if (mode === "app-server") {
    const bridgeScript = adapter.resolveBridgeScript?.(ctx);
    if (!bridgeScript) {
      logWarn("Bridge script not found. Bridge not started.");
      warnings.push("Bridge script not found. Run bridge manually.");
    } else {
      if (effectivePort == null && runtime === "codex") {
        const currentState = loadState(repoRoot) ?? state;
        effectivePort = await findNextAvailableAppServerPort(
          currentState,
          resolvedCfg.appServerUrl,
          4501,
          instanceId
        );
        log(`Auto-assigned port ${effectivePort} for ${instanceId}`);
      }
      log(`Starting bridge: ${bridgeScript}`);
      try {
        const manageAppServer = runtime === "codex";
        bridge = await startBridge({
          instanceId,
          runtime,
          stateDir: ctx.stateDir,
          commsDir: ctx.commsDir,
          bridgeScript,
          platform: ctx.platform,
          agentName: resolvedAgentName ?? void 0,
          runtimeCommand: resolvedCfg.runtimeCommand,
          appServerUrl: resolvedCfg.appServerUrl,
          repoRoot,
          port: effectivePort ?? void 0,
          manageAppServer,
          headless
        });
        logSuccess(`Bridge started (PID: ${bridge.pid})`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logWarn(`Bridge not started: ${msg}`);
        warnings.push(`Bridge not started: ${msg}`);
      }
    }
  }
  let effectiveAppServerUrl = resolvedCfg.appServerUrl;
  if (effectivePort != null) {
    try {
      const parsed = new URL(resolvedCfg.appServerUrl);
      parsed.port = String(effectivePort);
      effectiveAppServerUrl = parsed.toString().replace(/\/$/, "");
    } catch {
    }
  }
  const permRole = roleArg === "reviewer" ? "reviewer" : headlessFlag ? "implementer" : void 0;
  const instConfig = createInstanceConfig({
    instanceId,
    runtime,
    agentName: resolvedAgentName,
    agentId: null,
    port: effectivePort,
    appServerUrl: effectiveAppServerUrl,
    commsDir: ctx.commsDir,
    stateDir: ctx.stateDir,
    repoRoot,
    role: permRole
  });
  if (probe.configPath) {
    try {
      const { computeFileHash: computeFileHash2 } = await Promise.resolve().then(() => (init_drift_detector(), drift_detector_exports));
      const runtimeHash = computeFileHash2(probe.configPath);
      if (runtimeHash) {
        instConfig.runtimeConfigHash = runtimeHash;
        instConfig.lastSyncedToRuntime = (/* @__PURE__ */ new Date()).toISOString();
      }
    } catch {
    }
  }
  const instConfigPath = saveInstanceConfig(ctx.stateDir, instConfig);
  logSuccess(`Instance config: ${instConfigPath}`);
  const instanceState = {
    instanceId,
    runtime,
    agentName: resolvedAgentName,
    port: effectivePort,
    installed: true,
    configPath: probe.configPath ?? "",
    bridgeMode: mode,
    restartRequired: result.restartRequired,
    ownedArtifacts: result.ownedArtifacts,
    backupPath: backupDir,
    lastAppliedHash: result.lastAppliedHash,
    lastVerifiedAt: verify.ok ? (/* @__PURE__ */ new Date()).toISOString() : null,
    bridge,
    manageAppServer: runtime === "codex",
    noAuth: false,
    headless,
    configHash: instConfig.configHash,
    configSourceFile: instConfigPath,
    warnings: Array.from(/* @__PURE__ */ new Set([...result.warnings, ...verify.warnings]))
  };
  const newState = updateInstanceState(state, instanceId, instanceState);
  saveState(repoRoot, newState);
  logSuccess("State saved");
  if (result.restartRequired) {
    logWarn(`Restart ${runtime} to pick up the new configuration.`);
  }
  if (runtime === "claude") {
    log("");
    log("For real-time notifications:");
    log("  claude --dangerously-load-development-channels server:tap-comms");
    log("Or polling mode (tools still work):");
    log("  claude");
  }
  logHeader("Done!");
  return {
    ok: true,
    command: "add",
    runtime,
    instanceId,
    code: "TAP_ADD_OK",
    message: `${instanceId} configured`,
    warnings,
    data: {
      appliedOps: result.appliedOps,
      restartRequired: result.restartRequired,
      changedFiles: result.changedFiles,
      verified: verify.ok
    }
  };
}

// src/engine/health-monitor.ts
import * as fs27 from "fs";
import * as path24 from "path";
var DISPATCH_EVIDENCE_FRESH_THRESHOLD_MS = 2 * 60 * 1e3;
function getHeartbeatActivityMs2(record) {
  const timestamp = new Date(record.lastActivity ?? record.timestamp ?? 0).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}
function isSameInstanceHeartbeat2(key, heartbeat, instanceId) {
  if (heartbeat.instanceId === instanceId) return true;
  if (heartbeat.connectHash === `instance:${instanceId}`) return true;
  return key === instanceId || key.replace(/_/g, "-") === instanceId || key.replace(/-/g, "_") === instanceId;
}
function loadLiveDispatchEvidence(commsDir, instanceId) {
  const heartbeatsPath = path24.join(commsDir, "heartbeats.json");
  if (!fs27.existsSync(heartbeatsPath)) return null;
  try {
    const store = JSON.parse(
      fs27.readFileSync(heartbeatsPath, "utf-8")
    );
    let best = null;
    let bestActivityMs = -1;
    for (const [key, heartbeat] of Object.entries(store)) {
      if (!isSameInstanceHeartbeat2(key, heartbeat, instanceId)) continue;
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
var HEARTBEAT_FRESH_THRESHOLD_MS = 2 * 60 * 1e3;

// src/commands/status.ts
init_config();
init_utils();
var STATUS_HELP = `
Usage:
  tap status

Description:
  Show all installed instances, their bridge status, and configuration info.

Examples:
  npx @hua-labs/tap status
`.trim();
function resolveStatus(inst, stateDir, commsDir) {
  if (!inst.installed) {
    return {
      status: "not installed",
      lifecycle: null,
      session: null,
      warnings: []
    };
  }
  switch (inst.bridgeMode) {
    case "native-push":
    case "polling":
      return {
        status: inst.lastVerifiedAt ? "active" : "configured",
        lifecycle: null,
        session: null,
        warnings: []
      };
    case "app-server": {
      let staleLifecycle = null;
      if (inst.bridge) {
        const lifecycle = resolveBridgeLifecycleSnapshot(
          stateDir,
          inst.instanceId,
          inst.bridge
        );
        if (lifecycle.status === "bridge-stale") {
          staleLifecycle = lifecycle;
          inst.bridge = null;
        } else {
          const runtimeHeartbeat = loadRuntimeBridgeHeartbeat(inst.bridge);
          return {
            status: "active",
            lifecycle,
            session: deriveCodexSessionState({
              runtimeHeartbeat,
              runtimeStateDir: inst.bridge.runtimeStateDir ?? null
            }),
            warnings: []
          };
        }
      }
      const liveDispatch = loadLiveDispatchEvidence(commsDir, inst.instanceId);
      if (liveDispatch) {
        return {
          status: "dispatch-live",
          lifecycle: deriveBridgeLifecycleState({
            bridgeStatus: "stopped"
          }),
          session: deriveCodexSessionState({ runtimeHeartbeat: null }),
          warnings: [
            `fresh bridge-dispatch heartbeat from PID ${liveDispatch.bridgePid} without bridge pid state`
          ]
        };
      }
      if (staleLifecycle) {
        return {
          status: inst.lastVerifiedAt ? "configured" : "installed",
          lifecycle: staleLifecycle,
          session: null,
          warnings: []
        };
      }
      return {
        status: inst.lastVerifiedAt ? "configured" : "installed",
        lifecycle: deriveBridgeLifecycleState({
          bridgeStatus: "stopped"
        }),
        session: deriveCodexSessionState({ runtimeHeartbeat: null }),
        warnings: []
      };
    }
    default:
      return {
        status: "installed",
        lifecycle: null,
        session: null,
        warnings: []
      };
  }
}
function instanceStatusLine(inst, status, lifecycle, session, warnings) {
  const bridgeInfo = inst.bridge ? ` (pid: ${inst.bridge.pid})` : "";
  const lifecycleStr = lifecycle?.status ?? "-";
  const sessionStr = session?.status ?? "-";
  const mode = inst.bridgeMode;
  const portStr = inst.port ? ` port:${inst.port}` : "";
  const restart = inst.restartRequired ? " [restart required]" : "";
  const warns = warnings.length > 0 ? ` [${warnings.length} warning(s)]` : "";
  return `${inst.instanceId.padEnd(20)} ${inst.runtime.padEnd(8)} ${status.padEnd(14)} ${lifecycleStr.padEnd(20)} ${sessionStr.padEnd(18)} ${mode.padEnd(14)}${bridgeInfo}${portStr}${restart}${warns}`;
}
async function statusCommand(args) {
  if (args.includes("--help") || args.includes("-h")) {
    log(STATUS_HELP);
    return {
      ok: true,
      command: "status",
      code: "TAP_NO_OP",
      message: STATUS_HELP,
      warnings: [],
      data: {}
    };
  }
  const repoRoot = findRepoRoot();
  const state = loadState(repoRoot);
  if (!state) {
    return {
      ok: false,
      command: "status",
      code: "TAP_NOT_INITIALIZED",
      message: "Not initialized. Run: npx @hua-labs/tap init",
      warnings: [],
      data: {}
    };
  }
  logHeader("@hua-labs/tap status");
  log(`Version:    ${version}`);
  log(`Comms dir:  ${state.commsDir}`);
  log(`Repo root:  ${state.repoRoot}`);
  log(`Schema:     v${state.schemaVersion}`);
  log(`Updated:    ${state.updatedAt}`);
  const installed = getInstalledInstances(state);
  const { config: resolvedCfg } = resolveConfig({}, repoRoot);
  const stateDir = resolvedCfg.stateDir;
  const instances = {};
  const bridgesBefore = installed.map((id) => state.instances[id]?.bridge);
  if (installed.length === 0) {
    log("");
    log("No instances installed.");
    log("Run: npx @hua-labs/tap add <claude|codex|gemini>");
  } else {
    log("");
    log(
      `${"Instance".padEnd(20)} ${"Runtime".padEnd(8)} ${"Status".padEnd(14)} ${"Lifecycle".padEnd(20)} ${"Session".padEnd(18)} ${"Bridge Mode".padEnd(14)} Details`
    );
    log(
      `${"\u2500".repeat(20)} ${"\u2500".repeat(8)} ${"\u2500".repeat(14)} ${"\u2500".repeat(20)} ${"\u2500".repeat(18)} ${"\u2500".repeat(14)} ${"\u2500".repeat(20)}`
    );
    for (const id of installed) {
      const inst = state.instances[id];
      if (inst) {
        const { status, lifecycle, session, warnings } = resolveStatus(
          inst,
          stateDir,
          state.commsDir
        );
        const mergedWarnings = [...inst.warnings, ...warnings];
        log(instanceStatusLine(inst, status, lifecycle, session, mergedWarnings));
        if (mergedWarnings.length > 0) {
          for (const w of mergedWarnings) {
            logWarn(`  ${w}`);
          }
        }
        instances[id] = {
          status,
          lifecycle,
          session,
          runtime: inst.runtime,
          bridgeMode: inst.bridgeMode,
          bridge: inst.bridge,
          port: inst.port,
          warnings: mergedWarnings
        };
      }
    }
  }
  const bridgesAfter = installed.map((id) => state.instances[id]?.bridge);
  const staleCleared = bridgesBefore.some((b, i) => b !== bridgesAfter[i]);
  if (staleCleared) {
    state.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
    saveState(repoRoot, state);
  }
  log("");
  return {
    ok: true,
    command: "status",
    code: "TAP_STATUS_OK",
    message: `${installed.length} instance(s) installed`,
    warnings: [],
    data: {
      version,
      commsDir: state.commsDir,
      repoRoot: state.repoRoot,
      instances
    }
  };
}

// src/commands/remove.ts
init_utils();

// src/engine/rollback.ts
import * as fs28 from "fs";
async function rollbackRuntime(_instanceId, runtimeState) {
  const errors = [];
  const restoredFiles = [];
  let restoredCount = 0;
  for (const artifact of runtimeState.ownedArtifacts) {
    try {
      const result = rollbackArtifact(artifact);
      if (result.restored) {
        restoredCount++;
        restoredFiles.push(artifact.path);
      }
      if (result.error) {
        errors.push(result.error);
      }
    } catch (err) {
      errors.push(
        `Failed to rollback ${artifact.path}#${artifact.selector}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
  return {
    success: errors.length === 0,
    restoredCount,
    restoredFiles,
    errors
  };
}
function rollbackArtifact(artifact) {
  if (!fs28.existsSync(artifact.path)) {
    return { restored: false, error: `File not found: ${artifact.path}` };
  }
  switch (artifact.kind) {
    case "json-path":
      return rollbackJsonPath(artifact);
    case "toml-table":
      return rollbackTomlTable(artifact);
    case "file":
      return rollbackFile(artifact);
    default:
      return {
        restored: false,
        error: `Unknown artifact kind: ${artifact.kind}`
      };
  }
}
function rollbackJsonPath(artifact) {
  const raw = fs28.readFileSync(artifact.path, "utf-8");
  let config;
  try {
    config = JSON.parse(raw);
  } catch {
    return { restored: false, error: `Invalid JSON: ${artifact.path}` };
  }
  const backup = artifact.backupPath ? readArtifactBackup(artifact.backupPath) : null;
  if (backup?.kind === "json-path" && backup.selector === artifact.selector) {
    if (backup.existed) {
      setNestedKey3(config, artifact.selector, backup.value);
    } else {
      deleteNestedKey(config, artifact.selector);
      cleanEmptyParents(config, artifact.selector);
    }
  } else {
    const removed = deleteNestedKey(config, artifact.selector);
    if (!removed) {
      return {
        restored: false,
        error: `Key not found: ${artifact.selector} in ${artifact.path}`
      };
    }
    cleanEmptyParents(config, artifact.selector);
  }
  const tmp = `${artifact.path}.tmp.${process.pid}`;
  fs28.writeFileSync(tmp, JSON.stringify(config, null, 2) + "\n", "utf-8");
  fs28.renameSync(tmp, artifact.path);
  return { restored: true };
}
function rollbackTomlTable(artifact) {
  const content = fs28.readFileSync(artifact.path, "utf-8");
  const backup = artifact.backupPath ? readArtifactBackup(artifact.backupPath) : null;
  if (backup?.kind === "toml-table" && backup.selector === artifact.selector) {
    const nextContent = backup.existed ? replaceTomlTable(content, artifact.selector, backup.content ?? "") : removeTomlTable(content, artifact.selector);
    const tmp2 = `${artifact.path}.tmp.${process.pid}`;
    fs28.writeFileSync(tmp2, nextContent, "utf-8");
    fs28.renameSync(tmp2, artifact.path);
    return { restored: true };
  }
  if (!extractTomlTable(content, artifact.selector)) {
    return {
      restored: false,
      error: `TOML table not found: ${artifact.selector}`
    };
  }
  const tmp = `${artifact.path}.tmp.${process.pid}`;
  fs28.writeFileSync(tmp, removeTomlTable(content, artifact.selector), "utf-8");
  fs28.renameSync(tmp, artifact.path);
  return { restored: true };
}
function rollbackFile(artifact) {
  if (fs28.existsSync(artifact.path)) {
    fs28.unlinkSync(artifact.path);
    return { restored: true };
  }
  return { restored: false, error: `File not found: ${artifact.path}` };
}
function deleteNestedKey(obj, keyPath) {
  const keys = keyPath.split(".");
  let current = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (typeof current[key] !== "object" || current[key] === null) {
      return false;
    }
    current = current[key];
  }
  const lastKey = keys[keys.length - 1];
  if (!(lastKey in current)) return false;
  delete current[lastKey];
  return true;
}
function setNestedKey3(obj, keyPath, value) {
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
function cleanEmptyParents(obj, keyPath) {
  const keys = keyPath.split(".");
  for (let depth = keys.length - 2; depth >= 0; depth--) {
    let current = obj;
    for (let i = 0; i < depth; i++) {
      current = current[keys[i]];
      if (!current) return;
    }
    const key = keys[depth];
    const value = current[key];
    if (typeof value === "object" && value !== null && Object.keys(value).length === 0) {
      delete current[key];
    }
  }
}

// src/commands/remove.ts
var REMOVE_HELP = `
Usage:
  tap remove <instance>

Description:
  Remove a registered instance, stop its bridge, and rollback config changes.

Arguments:
  <instance>    Instance ID or runtime name (e.g. claude, codex-reviewer)

Examples:
  npx @hua-labs/tap remove claude
  npx @hua-labs/tap remove codex-reviewer
`.trim();
async function removeCommand(args) {
  if (args.includes("--help") || args.includes("-h")) {
    log(REMOVE_HELP);
    return {
      ok: true,
      command: "remove",
      code: "TAP_NO_OP",
      message: REMOVE_HELP,
      warnings: [],
      data: {}
    };
  }
  const identifier = args.find((a) => !a.startsWith("-"));
  if (!identifier) {
    return {
      ok: false,
      command: "remove",
      code: "TAP_INVALID_ARGUMENT",
      message: "Missing instance argument. Usage: npx @hua-labs/tap remove <instance>",
      warnings: [],
      data: {}
    };
  }
  const repoRoot = findRepoRoot();
  const state = loadState(repoRoot);
  if (!state) {
    return {
      ok: false,
      command: "remove",
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
      command: "remove",
      code: resolved.code,
      message: resolved.message,
      warnings: [],
      data: {}
    };
  }
  const instanceId = resolved.instanceId;
  const instance = state.instances[instanceId];
  if (!instance?.installed) {
    return {
      ok: true,
      command: "remove",
      instanceId,
      code: "TAP_NO_OP",
      message: `${instanceId} is not installed.`,
      warnings: [],
      data: {}
    };
  }
  logHeader(`@hua-labs/tap remove ${instanceId}`);
  if (instance.bridge) {
    const ctx = createAdapterContext(state.commsDir, repoRoot);
    const stopResult = await stopBridge({
      instanceId,
      stateDir: ctx.stateDir,
      platform: ctx.platform
    });
    if (stopResult.stopped) {
      logSuccess(`Bridge for ${instanceId} stopped`);
    } else {
      log(`No running bridge for ${instanceId}`);
    }
  }
  const result = await rollbackRuntime(instanceId, instance);
  if (result.success) {
    logSuccess(`Rolled back ${result.restoredCount} artifact(s)`);
    for (const f of result.restoredFiles) logSuccess(`Restored: ${f}`);
    const newState = removeInstanceState(state, instanceId);
    saveState(repoRoot, newState);
    logSuccess("State updated");
    logHeader("Done!");
    return {
      ok: true,
      command: "remove",
      instanceId,
      runtime: instance.runtime,
      code: "TAP_REMOVE_OK",
      message: `${instanceId} removed successfully`,
      warnings: [],
      data: {
        restoredCount: result.restoredCount,
        restoredFiles: result.restoredFiles
      }
    };
  }
  for (const e of result.errors) logError(e);
  return {
    ok: false,
    command: "remove",
    instanceId,
    runtime: instance.runtime,
    code: "TAP_ROLLBACK_FAILED",
    message: "Rollback had errors. State preserved for retry.",
    warnings: result.errors,
    data: { restoredCount: result.restoredCount }
  };
}

// src/commands/bridge.ts
init_utils();

// src/commands/bridge-start.ts
import * as path27 from "path";
init_instance_config();
init_config();
init_utils();

// src/commands/bridge-helpers.ts
import * as path25 from "path";
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
function normalizeComparablePath(value) {
  return path25.resolve(value).replace(/\\/g, "/").toLowerCase();
}
function sameOptionalPath(left, right) {
  if (!left || !right) {
    return left === right;
  }
  return normalizeComparablePath(left) === normalizeComparablePath(right);
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
    bridge: updatedBridge
  };
  return true;
}

// src/commands/bridge-heartbeat.ts
import { existsSync as existsSync26, readFileSync as readFileSync22, renameSync as renameSync13, writeFileSync as writeFileSync14 } from "fs";
import * as path26 from "path";
var BRIDGE_UP_ACTIVE_HEARTBEAT_WINDOW_MS = 10 * 60 * 1e3;
var BRIDGE_UP_ORPHAN_HEARTBEAT_WINDOW_MS = 24 * 60 * 60 * 1e3;
var BRIDGE_UP_SIGNING_OFF_HEARTBEAT_WINDOW_MS = 5 * 60 * 1e3;
function loadBridgeHeartbeatStore(commsDir) {
  const heartbeatsPath = path26.join(commsDir, "heartbeats.json");
  if (!existsSync26(heartbeatsPath)) return {};
  try {
    return JSON.parse(readFileSync22(heartbeatsPath, "utf-8"));
  } catch {
    return null;
  }
}
function saveBridgeHeartbeatStore(commsDir, store) {
  const heartbeatsPath = path26.join(commsDir, "heartbeats.json");
  const tmp = `${heartbeatsPath}.tmp.${process.pid}`;
  writeFileSync14(tmp, JSON.stringify(store, null, 2), "utf-8");
  renameSync13(tmp, heartbeatsPath);
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
      removed += 1;
    }
  }
  if (removed > 0) {
    saveBridgeHeartbeatStore(commsDir, store);
  }
  return { removed };
}

// src/commands/bridge-start.ts
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
  if ((resolvedAgentName ?? null) !== instance.agentName) {
    instance = { ...instance, agentName: resolvedAgentName ?? null };
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
  const manageAppServer = instance.runtime === "codex" && flags["no-server"] !== true;
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
  const noAuth = flags["no-auth"] === true;
  if (!manageAppServer && instance.runtime === "codex") {
    log("Auto server:   disabled (--no-server)");
  }
  if (noAuth && manageAppServer) {
    log("Auth gateway:  disabled (--no-auth)");
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
        headless,
        busyMode,
        pollSeconds,
        reconnectSeconds,
        messageLookbackMinutes,
        threadId,
        ephemeral,
        processExistingMessages,
        previousLifecycle: instance.bridgeLifecycle ?? instance.bridge?.lifecycle ?? null
      });
    } finally {
      if (previousWarmup === void 0) {
        delete process.env.TAP_COLD_START_WARMUP;
      } else {
        process.env.TAP_COLD_START_WARMUP = previousWarmup;
      }
    }
    logSuccess(`Bridge started (PID: ${bridge.pid})`);
    log(`Log: ${path27.join(ctx.stateDir, "logs", `bridge-${instanceId}.log`)}`);
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
      noAuth
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
      inst?.agentName ?? void 0,
      repoRoot,
      ctx.stateDir
    );
    if (!storedName) {
      const msg = `${instanceId}: skipped \u2014 no stored agent-name. Set it first: tap bridge start ${instanceId} --agent-name <name>`;
      log(msg);
      warnings.push(msg);
      continue;
    }
    const stateDir = path27.join(repoRoot, ".tap-comms");
    const currentBridgeState = loadBridgeState(stateDir, instanceId);
    const { manageAppServer, noAuth } = inferRestartMode(
      currentBridgeState,
      {
        noServer: flags["no-server"] === true ? true : void 0,
        noAuth: flags["no-auth"] === true ? true : void 0
      },
      {
        manageAppServer: inst.manageAppServer,
        noAuth: inst.noAuth
      }
    );
    const mergedFlags = {
      ...flags,
      ...manageAppServer === false ? { "no-server": true } : {},
      ...noAuth === true ? { "no-auth": true } : {}
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

// src/commands/bridge-stop.ts
init_utils();
async function bridgeStopOne(identifier) {
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
  logHeader(`@hua-labs/tap bridge stop ${instanceId}`);
  const stopResult = await stopBridge({
    instanceId,
    stateDir: ctx.stateDir,
    platform: ctx.platform
  });
  let appServerStopped = false;
  let appServerTransferredTo = null;
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
      bridgeLifecycle: stopResult.lifecycle ?? instance.bridgeLifecycle ?? null
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
        appServerTransferredTo
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
      appServerTransferredTo
    }
  };
}
async function bridgeStopAll() {
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
  logHeader("@hua-labs/tap bridge stop (all)");
  let stateChanged = false;
  for (const instanceId of instanceIds) {
    const bridgeState = loadCurrentBridgeState(
      ctx.stateDir,
      instanceId,
      state.instances[instanceId]?.bridge
    );
    const appServer = bridgeState?.appServer;
    if (appServer?.managed && appServer.pid != null) {
      managedAppServers.set(
        `${appServer.url}:${appServer.pid}:${appServer.auth?.gatewayPid ?? "-"}`,
        appServer
      );
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
        bridgeLifecycle: stopResult.lifecycle ?? instance.bridgeLifecycle ?? null
      };
      stateChanged = true;
    }
  }
  const stoppedAppServers = [];
  const releasePorts = [];
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
    data: { stopped, stoppedAppServers }
  };
}

// src/commands/bridge-watch.ts
init_config();
init_utils();
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
        )
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
        const newBridgeState = await restartBridge({
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
          manageAppServer,
          noAuth,
          previousLifecycle: inst.bridgeLifecycle ?? inst.bridge?.lifecycle ?? null
        });
        const updatedInst = {
          ...inst,
          agentName: recoveredAgentName ?? inst.agentName ?? null,
          bridge: newBridgeState,
          bridgeLifecycle: newBridgeState.lifecycle ?? inst.bridgeLifecycle ?? null
        };
        const updatedState = updateInstanceState(
          state,
          instanceId,
          updatedInst
        );
        saveState(repoRoot, updatedState);
        state = updatedState;
        restarted.push(instanceId);
        logSuccess(`${instanceId}: restarted`);
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

// src/commands/bridge-status.ts
import * as path28 from "path";
init_config();
init_utils();
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
        appServer: null
      };
      continue;
    }
    const rawStatus = getBridgeStatus(stateDir, instanceId);
    const bridgeState = loadBridgeState(stateDir, instanceId) ?? inst.bridge;
    const liveDispatch = rawStatus === "running" ? null : loadLiveDispatchEvidence(state.commsDir, instanceId);
    const surfaceBridgeState = liveDispatch ? null : bridgeState;
    const runtimeHeartbeat = loadRuntimeBridgeHeartbeat(surfaceBridgeState);
    const savedThread = loadRuntimeBridgeThreadState(surfaceBridgeState);
    const status = liveDispatch ? "dispatch-live" : rawStatus;
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
        )
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
    if (surfaceBridgeState?.appServer) {
      log(`  App server: ${formatAppServerState(surfaceBridgeState.appServer)}`);
      if (surfaceBridgeState.appServer.logPath) {
        log(`  Server log: ${surfaceBridgeState.appServer.logPath}`);
      }
      if (surfaceBridgeState.appServer.auth) {
        log(
          `  Protected: ${redactProtectedUrl(surfaceBridgeState.appServer.auth.protectedUrl)}`
        );
      }
    }
    if (runtimeHeartbeat?.threadId) {
      log(
        `  Thread:     ${formatThreadSummary(runtimeHeartbeat.threadId, runtimeHeartbeat.threadCwd)}`
      );
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
      appServer: surfaceBridgeState?.appServer ?? null
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
  const liveDispatch = rawStatus === "running" ? null : loadLiveDispatchEvidence(state.commsDir, instanceId);
  const surfaceBridgeState = liveDispatch ? null : bridgeState;
  const runtimeHeartbeat = loadRuntimeBridgeHeartbeat(surfaceBridgeState);
  const savedThread = loadRuntimeBridgeThreadState(surfaceBridgeState);
  const age = liveDispatch ? null : getHeartbeatAge(stateDir, instanceId);
  const heartbeat = liveDispatch ? null : getBridgeHeartbeatTimestamp(stateDir, instanceId);
  const status = liveDispatch ? "dispatch-live" : rawStatus;
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
      )
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
    log(
      `Log:         ${path28.join(stateDir, "logs", `bridge-${instanceId}.log`)}`
    );
    if (surfaceBridgeState.appServer) {
      log(`App server:  ${surfaceBridgeState.appServer.url}`);
      log(`Server PID:  ${surfaceBridgeState.appServer.pid ?? "-"}`);
      log(
        `Server mode: ${surfaceBridgeState.appServer.managed ? "managed" : "external"}`
      );
      log(
        `Health:      ${surfaceBridgeState.appServer.healthy ? "healthy" : "unhealthy"}`
      );
      log(`Checked:     ${surfaceBridgeState.appServer.lastCheckedAt}`);
      if (surfaceBridgeState.appServer.logPath) {
        log(`Server log:  ${surfaceBridgeState.appServer.logPath}`);
      }
      if (surfaceBridgeState.appServer.auth) {
        log(`Auth:        ${surfaceBridgeState.appServer.auth.mode}`);
        log(
          `Protected:   ${redactProtectedUrl(surfaceBridgeState.appServer.auth.protectedUrl)}`
        );
        log(`Upstream:    ${surfaceBridgeState.appServer.auth.upstreamUrl}`);
        log(`TUI connect: ${surfaceBridgeState.appServer.auth.upstreamUrl}`);
        log(`Gateway PID: ${surfaceBridgeState.appServer.auth.gatewayPid ?? "-"}`);
        if (surfaceBridgeState.appServer.auth.gatewayLogPath) {
          log(`Gateway log: ${surfaceBridgeState.appServer.auth.gatewayLogPath}`);
        }
      } else if (surfaceBridgeState.appServer.managed) {
        log(`Auth:        none (--no-auth)`);
        log(`TUI connect: ${surfaceBridgeState.appServer.url}`);
      }
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
      appServer: surfaceBridgeState?.appServer ?? null
    }
  };
}

// src/commands/bridge-tui.ts
init_config();
init_utils();
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
  if (typeof inst.agentName === "string" && inst.agentName.trim()) {
    attachEnv.TAP_AGENT_NAME = inst.agentName;
    attachEnv.CODEX_TAP_AGENT_NAME = inst.agentName;
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

// src/commands/bridge-restart.ts
init_config();
init_utils();
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
  try {
    const resolvedAgentName = resolveRecoveredAgentName(
      instanceId,
      explicitAgentName,
      repoRoot,
      ctx.stateDir
    );
    const currentBridgeState = loadBridgeState(ctx.stateDir, instanceId);
    const { manageAppServer, noAuth } = inferRestartMode(
      currentBridgeState,
      {
        noServer: flags["no-server"] === true ? true : void 0,
        noAuth: flags["no-auth"] === true ? true : void 0
      },
      {
        manageAppServer: inst.manageAppServer,
        noAuth: inst.noAuth
      }
    );
    const previousColdStartWarmup = process.env.TAP_COLD_START_WARMUP;
    process.env.TAP_COLD_START_WARMUP = "true";
    let bridge;
    try {
      bridge = await restartBridge({
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
        manageAppServer,
        noAuth,
        previousLifecycle: inst.bridgeLifecycle ?? inst.bridge?.lifecycle ?? null
      });
    } finally {
      if (previousColdStartWarmup === void 0) {
        delete process.env.TAP_COLD_START_WARMUP;
      } else {
        process.env.TAP_COLD_START_WARMUP = previousColdStartWarmup;
      }
    }
    logSuccess(`Bridge restarted (PID: ${bridge.pid})`);
    const updated = {
      ...inst,
      agentName: resolvedAgentName ?? inst.agentName ?? null,
      bridge,
      bridgeLifecycle: bridge.lifecycle ?? inst.bridgeLifecycle ?? null,
      manageAppServer,
      noAuth
    };
    const newState = updateInstanceState(state, instanceId, updated);
    saveState(repoRoot, newState);
    return {
      ok: true,
      command: "bridge",
      instanceId,
      code: "TAP_BRIDGE_START_OK",
      message: `Bridge for ${instanceId} restarted (PID: ${bridge.pid})`,
      warnings: [],
      data: { pid: bridge.pid }
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logError(msg);
    return {
      ok: false,
      command: "bridge",
      instanceId,
      code: "TAP_BRIDGE_START_FAILED",
      message: msg,
      warnings: [],
      data: {}
    };
  }
}

// src/commands/bridge.ts
var BRIDGE_HELP = `
Usage:
  tap bridge <subcommand> [instance] [options]

Subcommands:
  start <instance>  Start bridge for an instance (e.g. codex, codex-reviewer)
  start --all       Start all registered app-server instances
  stop  <instance>  Stop bridge for an instance
  stop              Stop all running bridges
  status            Show bridge status for all instances
  status <instance> Show bridge status for a specific instance
  tui <instance>    Show the safe Codex TUI attach command for a running bridge
  watch             Monitor bridges and auto-restart stuck/stale ones

Options:
  --agent-name <name>              Agent identity for bridge (or set TAP_AGENT_NAME env)
                                   Overrides the stored name from 'tap add' when needed
  --all                            Start all registered app-server instances
  --busy-mode <steer|wait>         How to handle active turns (default: steer)
  --poll-seconds <n>               Inbox poll interval (default: 5)
  --reconnect-seconds <n>          Reconnect delay after disconnect (default: 5)
  --message-lookback-minutes <n>   Process messages from last N minutes (default: 10)
  --thread-id <id>                 Resume specific thread
  --ephemeral                      Use ephemeral thread (no persistence)
  --process-existing-messages      Process all existing inbox messages
  --no-server                      Skip app-server auto-start and connect only
  --no-auth                        Skip auth gateway (app-server listens directly, localhost only)

Port Assignment:
  Ports are auto-assigned from 4501 on first bridge start if not set via --port
  during 'tap add'. Auto-assigned ports are saved to state for future starts.

Examples:
  npx @hua-labs/tap bridge start codex --agent-name myAgent
  npx @hua-labs/tap bridge start --all
  npx @hua-labs/tap bridge start codex --agent-name myAgent --no-server
  npx @hua-labs/tap bridge start codex-reviewer --agent-name reviewer --busy-mode steer
  npx @hua-labs/tap bridge stop codex
  npx @hua-labs/tap bridge stop
  npx @hua-labs/tap bridge status
  npx @hua-labs/tap bridge tui codex
`.trim();
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
        return bridgeStopAll();
      }
      return bridgeStopOne(identifierArg);
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

// src/engine/dashboard.ts
init_config();
import * as fs29 from "fs";
import * as path29 from "path";
import { execSync as execSync4 } from "child_process";
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
function resolveHeartbeatInstanceId(heartbeatId, displayName, state) {
  if (!state) return null;
  if (state.instances[heartbeatId]?.installed) return heartbeatId;
  const hyphenated = heartbeatId.replace(/_/g, "-");
  if (state.instances[hyphenated]?.installed) return hyphenated;
  const underscored = heartbeatId.replace(/-/g, "_");
  if (state.instances[underscored]?.installed) return underscored;
  if (!displayName) return null;
  const matches = Object.values(state.instances).filter(
    (inst) => inst?.installed && inst.agentName === displayName
  );
  return matches.length === 1 ? matches[0].instanceId : null;
}
function collectAgents(commsDir, state, bridges) {
  const heartbeatsPath = path29.join(commsDir, "heartbeats.json");
  if (!fs29.existsSync(heartbeatsPath)) return [];
  try {
    const raw = fs29.readFileSync(heartbeatsPath, "utf-8");
    const data = JSON.parse(raw);
    return Object.entries(data).map(([agentId, info]) => {
      const instanceId = resolveHeartbeatInstanceId(
        agentId,
        info.agent ?? null,
        state
      );
      const bridge = instanceId ? bridges.find((candidate) => candidate.instanceId === instanceId) ?? null : null;
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
        idleSeconds: parseIsoAgeSeconds(idleBasis)
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
  const tmpDir = path29.join(repoRoot, ".tmp");
  if (fs29.existsSync(tmpDir)) {
    try {
      const dirs = fs29.readdirSync(tmpDir).filter((d) => d.startsWith("codex-app-server-bridge"));
      for (const dir of dirs) {
        const daemonPath = path29.join(tmpDir, dir, "bridge-daemon.json");
        if (!fs29.existsSync(daemonPath)) continue;
        try {
          const raw = fs29.readFileSync(daemonPath, "utf-8");
          const daemon = JSON.parse(raw);
          const alreadyCovered = bridges.some(
            (b) => b.pid === daemon.pid && b.pid !== null
          );
          if (alreadyCovered) continue;
          const agentFile = path29.join(tmpDir, dir, "agent-name.txt");
          const agentName = fs29.existsSync(agentFile) ? fs29.readFileSync(agentFile, "utf-8").trim() : dir;
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
    const output = execSync4(
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

// src/commands/up.ts
init_utils();
var UP_HELP = `
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

// src/commands/down.ts
init_utils();
var DOWN_HELP = `
Usage:
  tap down

Description:
  Stop all running bridge daemons and managed app-servers.

Examples:
  npx @hua-labs/tap down
`.trim();
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

// src/commands/serve.ts
import * as path30 from "path";
import { spawn as spawn2 } from "child_process";
init_utils();
init_config();
var SERVE_HELP = `
Usage:
  tap serve [options]

Description:
  Start the tap MCP server over stdio. This command takes over the
  process \u2014 it is intended to be launched by an MCP host (e.g. Claude Code).

Options:
  --comms-dir <path>    Override comms directory (also reads TAP_COMMS_DIR env)
  --help, -h            Show help

Examples:
  npx @hua-labs/tap serve
  npx @hua-labs/tap serve --comms-dir /shared/comms
`.trim();
async function serveCommand(args) {
  if (args.includes("--help") || args.includes("-h")) {
    log(SERVE_HELP);
    return {
      ok: true,
      command: "serve",
      code: "TAP_NO_OP",
      message: SERVE_HELP,
      warnings: [],
      data: {}
    };
  }
  const repoRoot = findRepoRoot();
  let commsDir;
  const commsDirIdx = args.indexOf("--comms-dir");
  if (commsDirIdx !== -1 && args[commsDirIdx + 1]) {
    commsDir = path30.resolve(normalizeTapPath(args[commsDirIdx + 1]));
  }
  if (!commsDir && process.env.TAP_COMMS_DIR) {
    commsDir = path30.resolve(normalizeTapPath(process.env.TAP_COMMS_DIR));
  }
  if (!commsDir) {
    const state = loadState(repoRoot);
    if (state) {
      commsDir = state.commsDir;
    }
  }
  if (!commsDir) {
    return {
      ok: false,
      command: "serve",
      code: "TAP_NOT_INITIALIZED",
      message: "Cannot determine comms directory. Set TAP_COMMS_DIR env var, use --comms-dir, or run 'init' first.",
      warnings: [],
      data: {}
    };
  }
  const ctx = createAdapterContext(commsDir, repoRoot);
  const managed = buildManagedMcpServerSpec(ctx);
  if (!managed.command || !managed.sourcePath) {
    const fallbackMessage = managed.issues[0] ?? "tap-comms MCP server not found. Reinstall @hua-labs/tap or run from a repo with packages/tap-plugin/channels/.";
    return {
      ok: false,
      command: "serve",
      code: managed.sourcePath ? "TAP_SERVE_BUN_REQUIRED" : "TAP_SERVE_NO_SERVER",
      message: fallbackMessage,
      warnings: [],
      data: {}
    };
  }
  const serveCommand2 = managed.command === "npx" ? "node" : managed.command;
  const serveArgs = managed.command === "npx" && managed.sourcePath ? [managed.sourcePath] : managed.args;
  const child = spawn2(serveCommand2, serveArgs, {
    stdio: "inherit",
    env: {
      ...process.env,
      TAP_COMMS_DIR: commsDir
    }
  });
  return new Promise((resolve15) => {
    child.on("error", (err) => {
      resolve15({
        ok: false,
        command: "serve",
        code: "TAP_INTERNAL_ERROR",
        message: `Failed to start MCP server: ${err.message}`,
        warnings: [],
        data: {}
      });
    });
    child.on("exit", (code) => {
      resolve15({
        ok: code === 0,
        command: "serve",
        code: code === 0 ? "TAP_SERVE_OK" : "TAP_INTERNAL_ERROR",
        message: code === 0 ? "MCP server stopped" : `MCP server exited with code ${code}`,
        warnings: [],
        data: { exitCode: code }
      });
    });
  });
}

// src/commands/init-worktree.ts
init_config();
init_utils();
import * as fs30 from "fs";
import * as path31 from "path";
import { execSync as execSync5 } from "child_process";
var INIT_WORKTREE_HELP = `
Usage:
  tap init-worktree [options]

Options:
  --path <dir>         Worktree directory (required, e.g. ../hua-wt-3)
  --branch <name>      Branch name to create (default: derived from path)
  --base <ref>         Base ref for new branch (default: origin/main)
  --mission <file>     Mission file to associate (e.g. m74-feature.md)
  --comms-dir <path>   Override comms directory
  --skip-install       Skip pnpm install step
  --help, -h           Show help

Examples:
  npx @hua-labs/tap init-worktree --path ../hua-wt-3 --branch feat/my-feature
  npx @hua-labs/tap init-worktree --path ../hua-wt-4 --branch fix/bug --mission m74-fix.md
`.trim();
function warn(warnings, message) {
  logWarn(message);
  warnings.push(message);
}
function run(cmd, opts) {
  try {
    return execSync5(cmd, {
      cwd: opts?.cwd,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 12e4
    }).trim();
  } catch (err) {
    if (opts?.ignoreError) return "";
    throw err;
  }
}
function toAbsolute(p) {
  const resolved = path31.resolve(p);
  return resolved.replace(/\\/g, "/");
}
function probeBun(candidate) {
  try {
    const out = execSync5(`"${candidate}" --version`, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 5e3
    }).trim();
    return /^\d+\.\d+/.test(out);
  } catch {
    return false;
  }
}
function findBun() {
  const candidates = process.platform === "win32" ? ["bun.exe", "bun"] : ["bun"];
  for (const name of candidates) {
    try {
      const out = execSync5(
        process.platform === "win32" ? `where ${name}` : `which ${name}`,
        { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"], timeout: 5e3 }
      ).trim();
      for (const line of out.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (trimmed && probeBun(trimmed)) return trimmed;
      }
    } catch {
    }
  }
  const home = process.env.HOME || process.env.USERPROFILE || "";
  const bunHome = path31.join(
    home,
    ".bun",
    "bin",
    process.platform === "win32" ? "bun.exe" : "bun"
  );
  if (fs30.existsSync(bunHome) && probeBun(bunHome)) return bunHome;
  return null;
}
function step1CreateWorktree(opts) {
  log("Step 1/9: Creating worktree...");
  if (fs30.existsSync(opts.worktreePath)) {
    logWarn(`Directory already exists: ${opts.worktreePath}`);
    try {
      run("git rev-parse --git-dir", { cwd: opts.worktreePath });
      logWarn("Already a git worktree. Continuing...");
      return true;
    } catch {
      logError("Directory exists but is not a git worktree.");
      return false;
    }
  }
  try {
    run(
      `git worktree add "${opts.worktreePath}" -b ${opts.branch} ${opts.base}`,
      { cwd: opts.repoRoot }
    );
    logSuccess(`Worktree created: ${opts.worktreePath}`);
    logSuccess(`Branch: ${opts.branch} (from ${opts.base})`);
  } catch {
    try {
      run(`git worktree add "${opts.worktreePath}" ${opts.branch}`, {
        cwd: opts.repoRoot
      });
      logSuccess(`Worktree created with existing branch: ${opts.branch}`);
    } catch (err) {
      logError(
        `Failed to create worktree: ${err instanceof Error ? err.message : String(err)}`
      );
      return false;
    }
  }
  return true;
}
function step2MergeMain(opts, warnings) {
  log("Step 2/9: Merging origin/main...");
  try {
    run("git fetch origin main", { cwd: opts.worktreePath });
  } catch {
    warn(warnings, "Could not fetch origin/main. Skipping merge.");
    return;
  }
  try {
    const behind = run("git rev-list --count HEAD..origin/main", {
      cwd: opts.worktreePath
    });
    if (behind === "0") {
      logSuccess("Already up to date with origin/main.");
      return;
    }
    run("git merge origin/main --no-edit -X theirs", {
      cwd: opts.worktreePath
    });
    logSuccess("Merged origin/main.");
  } catch {
    warn(
      warnings,
      "Merge had issues. You may need to resolve conflicts manually."
    );
  }
}
function step3CopyPermissions(opts, warnings) {
  log("Step 3/9: Copying permissions...");
  const srcSettings = path31.join(
    opts.repoRoot,
    ".claude",
    "settings.local.json"
  );
  const destDir = path31.join(opts.worktreePath, ".claude");
  const destSettings = path31.join(destDir, "settings.local.json");
  if (!fs30.existsSync(srcSettings)) {
    warn(
      warnings,
      "No .claude/settings.local.json found in main repo. Skipping."
    );
    return;
  }
  fs30.mkdirSync(destDir, { recursive: true });
  fs30.copyFileSync(srcSettings, destSettings);
  logSuccess("Copied settings.local.json");
  try {
    run("git update-index --skip-worktree .claude/settings.local.json", {
      cwd: opts.worktreePath
    });
    logSuccess("Marked skip-worktree");
  } catch {
    warn(warnings, "Could not set skip-worktree. File may show as modified.");
  }
}
function step4GenerateMcpJson(opts, warnings) {
  log("Step 4/9: Generating .mcp.json...");
  const bunPath = findBun();
  if (!bunPath) {
    warn(warnings, "bun not found. .mcp.json not generated.");
    warn(
      warnings,
      "Install bun (https://bun.sh) and re-run, or create .mcp.json manually."
    );
    return;
  }
  const wtAbs = toAbsolute(opts.worktreePath);
  const bunAbs = toAbsolute(bunPath);
  const commsAbs = toAbsolute(opts.commsDir);
  const channelEntry = path31.join(
    wtAbs,
    "packages/tap-plugin/channels/tap-comms.ts"
  );
  const mcpConfig = {
    mcpServers: {
      tap: {
        command: bunAbs,
        args: [channelEntry],
        cwd: wtAbs,
        env: {
          TAP_COMMS_DIR: commsAbs,
          TAP_AGENT_NAME: "unnamed"
        }
      }
    }
  };
  const mcpPath = path31.join(opts.worktreePath, ".mcp.json");
  fs30.writeFileSync(mcpPath, JSON.stringify(mcpConfig, null, 2) + "\n", "utf-8");
  logSuccess(`.mcp.json generated (absolute paths + cwd)`);
  log(`  bun: ${bunAbs}`);
  log(`  comms: ${commsAbs}`);
}
function step5Install(opts, warnings) {
  if (opts.skipInstall) {
    log("Step 5/9: Skipping pnpm install (--skip-install).");
    return;
  }
  log("Step 5/9: Installing dependencies...");
  try {
    run("pnpm install --prefer-offline", { cwd: opts.worktreePath });
    logSuccess("Dependencies installed.");
  } catch {
    warn(
      warnings,
      "pnpm install failed. Try running manually in the worktree."
    );
  }
}
function step6BuildEslintPlugin(opts, warnings) {
  if (opts.skipInstall) {
    log("Step 6/9: Skipping eslint plugin build (--skip-install).");
    return;
  }
  log("Step 6/9: Building eslint-plugin-i18n...");
  try {
    run("pnpm build --filter @hua-labs/eslint-plugin-i18n", {
      cwd: opts.worktreePath
    });
    logSuccess("eslint-plugin-i18n built.");
  } catch {
    warn(warnings, "eslint-plugin-i18n build failed. Non-blocking.");
  }
}
function step7VerifyComms(opts, warnings) {
  log("Step 7/9: Verifying comms directory...");
  if (!fs30.existsSync(opts.commsDir)) {
    warn(warnings, `Comms directory not found: ${opts.commsDir}`);
    warn(warnings, "Create it or run: npx @hua-labs/tap init");
    return;
  }
  const requiredDirs = ["inbox", "findings", "reviews", "letters"];
  for (const dir of requiredDirs) {
    const dirPath = path31.join(opts.commsDir, dir);
    if (!fs30.existsSync(dirPath)) {
      fs30.mkdirSync(dirPath, { recursive: true });
      logSuccess(`Created ${dir}/`);
    }
  }
  logSuccess(`Comms verified: ${opts.commsDir}`);
}
function step8VerifyBun(warnings) {
  log("Step 8/9: Verifying bun...");
  const bunPath = findBun();
  if (!bunPath) {
    warn(warnings, "bun not found in PATH.");
    warn(warnings, "Install: curl -fsSL https://bun.sh/install | bash");
    return;
  }
  try {
    const version2 = run(`"${bunPath}" --version`);
    logSuccess(`bun ${version2} found: ${bunPath}`);
  } catch {
    warn(warnings, "bun found but version check failed.");
  }
}
function step9Ready(opts) {
  logHeader("Ready!");
  log(`Worktree: ${toAbsolute(opts.worktreePath)}`);
  log(`Branch:   ${opts.branch}`);
  log(`Comms:    ${toAbsolute(opts.commsDir)}`);
  if (opts.mission) log(`Mission:  ${opts.mission}`);
  log("");
  log("Next steps:");
  log(`  cd ${opts.worktreePath}`);
  log("  claude  # Start Claude Code session");
  log("");
}
async function initWorktreeCommand(args) {
  const { flags } = parseArgs(args);
  if (flags["help"] === true || flags["h"] === true) {
    log(INIT_WORKTREE_HELP);
    return {
      ok: true,
      command: "init-worktree",
      code: "TAP_NO_OP",
      message: INIT_WORKTREE_HELP,
      warnings: [],
      data: {}
    };
  }
  const worktreePath = typeof flags["path"] === "string" ? flags["path"] : void 0;
  if (!worktreePath) {
    return {
      ok: false,
      command: "init-worktree",
      code: "TAP_INVALID_ARGUMENT",
      message: "Missing --path. Usage: npx @hua-labs/tap init-worktree --path ../hua-wt-3",
      warnings: [],
      data: {}
    };
  }
  const repoRoot = findRepoRoot();
  const { config } = resolveConfig({}, repoRoot);
  const branch = typeof flags["branch"] === "string" ? flags["branch"] : path31.basename(path31.resolve(worktreePath));
  const base = typeof flags["base"] === "string" ? flags["base"] : "origin/main";
  const mission = typeof flags["mission"] === "string" ? flags["mission"] : void 0;
  const commsDir = typeof flags["comms-dir"] === "string" ? flags["comms-dir"] : config.commsDir;
  const skipInstall = flags["skip-install"] === true;
  const opts = {
    worktreePath: path31.resolve(worktreePath),
    branch,
    base,
    mission,
    commsDir: path31.resolve(commsDir),
    skipInstall,
    repoRoot
  };
  logHeader(`@hua-labs/tap init-worktree`);
  log(`Path:     ${opts.worktreePath}`);
  log(`Branch:   ${opts.branch}`);
  log(`Base:     ${opts.base}`);
  log(`Comms:    ${opts.commsDir}`);
  if (mission) log(`Mission:  ${mission}`);
  log("");
  const warnings = [];
  const created = step1CreateWorktree(opts);
  if (!created) {
    return {
      ok: false,
      command: "init-worktree",
      code: "TAP_PATCH_FAILED",
      message: "Failed to create worktree.",
      warnings,
      data: {}
    };
  }
  step2MergeMain(opts, warnings);
  step3CopyPermissions(opts, warnings);
  step4GenerateMcpJson(opts, warnings);
  step5Install(opts, warnings);
  step6BuildEslintPlugin(opts, warnings);
  step7VerifyComms(opts, warnings);
  step8VerifyBun(warnings);
  step9Ready(opts);
  return {
    ok: true,
    command: "init-worktree",
    code: "TAP_INIT_OK",
    message: `Worktree initialized: ${opts.worktreePath}`,
    warnings,
    data: {
      path: opts.worktreePath,
      branch: opts.branch,
      commsDir: opts.commsDir
    }
  };
}

// src/commands/dashboard.ts
init_utils();
function formatAge2(seconds) {
  if (seconds === null) return "-";
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor(seconds % 3600 / 60)}m ago`;
}
function formatStatus(status) {
  switch (status) {
    case "running":
      return "running";
    case "stale":
      return "stale!";
    case "stopped":
      return "stopped";
    case "MERGED":
      return "merged";
    case "OPEN":
      return "open";
    case "CLOSED":
      return "closed";
    default:
      return status;
  }
}
function truncate(str, len) {
  return str.length > len ? str.slice(0, len - 1) + "\u2026" : str;
}
function renderSnapshot(snapshot) {
  logHeader("tap dashboard");
  log(`Time:  ${snapshot.generatedAt}`);
  log(`Repo:  ${snapshot.repoRoot}`);
  log(`Comms: ${snapshot.commsDir}`);
  log("");
  log("\u2500\u2500 Agents \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500");
  if (snapshot.agents.length === 0) {
    log("  (no heartbeats)");
  } else {
    log(
      `  ${"Agent".padEnd(18)} ${"Presence".padEnd(18)} ${"Lifecycle".padEnd(20)} ${"Idle"}`
    );
    log(
      `  ${"\u2500".repeat(18)} ${"\u2500".repeat(18)} ${"\u2500".repeat(20)} ${"\u2500".repeat(12)}`
    );
    for (const agent of snapshot.agents) {
      log(
        `  ${truncate(agent.name, 18).padEnd(18)} ${agent.presence.padEnd(18)} ${String(agent.lifecycle ?? "-").padEnd(20)} ${formatAge2(agent.idleSeconds)}`
      );
    }
  }
  log("");
  log("\u2500\u2500 Bridges \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500");
  if (snapshot.bridges.length === 0) {
    log("  (none)");
  } else {
    log(
      `  ${"Instance".padEnd(20)} ${"Status".padEnd(10)} ${"Lifecycle".padEnd(20)} ${"PID".padEnd(8)} ${"Port".padEnd(6)} ${"Heartbeat"}`
    );
    log(
      `  ${"\u2500".repeat(20)} ${"\u2500".repeat(10)} ${"\u2500".repeat(20)} ${"\u2500".repeat(8)} ${"\u2500".repeat(6)} ${"\u2500".repeat(12)}`
    );
    for (const b of snapshot.bridges) {
      const headlessTag = b.headless ? " [H]" : "";
      const lifecycle = b.lifecycle?.status ?? "-";
      log(
        `  ${truncate(b.instanceId + headlessTag, 20).padEnd(20)} ${formatStatus(b.status).padEnd(10)} ${truncate(lifecycle, 20).padEnd(20)} ${(b.pid ? String(b.pid) : "-").padEnd(8)} ${(b.port ? String(b.port) : "-").padEnd(6)} ${formatAge2(b.heartbeatAge)}`
      );
    }
  }
  log("");
  log("\u2500\u2500 PRs \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500");
  if (snapshot.prs.length === 0) {
    log("  (gh CLI unavailable or no PRs)");
  } else {
    for (const pr of snapshot.prs) {
      const icon = pr.state === "MERGED" ? "+" : pr.state === "OPEN" ? "~" : "x";
      log(
        `  ${icon} #${String(pr.number).padEnd(5)} ${formatStatus(pr.state).padEnd(8)} ${truncate(pr.title, 50)}`
      );
    }
  }
  log("");
  log("\u2500\u2500 Warnings \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500");
  if (snapshot.warnings.length === 0) {
    log("  [OK] no warnings");
  } else {
    for (const w of snapshot.warnings) {
      const prefix = w.level === "error" ? "[ERR]" : "[WARN]";
      log(`  ${prefix} ${w.message}`);
    }
  }
}
var DASHBOARD_HELP = `
Usage:
  tap dashboard [options]

Description:
  Display a unified ops dashboard: agents, bridges, PRs, and warnings.

Options:
  --json                Output snapshot as JSON
  --watch               Refresh dashboard on an interval
  --interval <seconds>  Refresh interval in seconds (default: 5, min: 2)
  --comms-dir <path>    Override comms directory
  --help, -h            Show help

Examples:
  npx @hua-labs/tap dashboard
  npx @hua-labs/tap dashboard --watch --interval 10
  npx @hua-labs/tap dashboard --json
`.trim();
async function dashboardCommand(args) {
  const { flags } = parseArgs(args);
  if (flags["help"] === true || flags["h"] === true) {
    log(DASHBOARD_HELP);
    return {
      ok: true,
      command: "dashboard",
      code: "TAP_NO_OP",
      message: DASHBOARD_HELP,
      warnings: [],
      data: {}
    };
  }
  const jsonMode = flags["json"] === true;
  const watchMode = flags["watch"] === true;
  const intervalStr = typeof flags["interval"] === "string" ? flags["interval"] : "5";
  const intervalSeconds = Math.max(2, parseInt(intervalStr, 10) || 5);
  const commsDirOverride = typeof flags["comms-dir"] === "string" ? flags["comms-dir"] : void 0;
  const repoRoot = findRepoRoot();
  if (watchMode) {
    const run2 = () => {
      const snapshot2 = collectDashboardSnapshot(repoRoot, commsDirOverride);
      if (jsonMode) {
        console.log(JSON.stringify(snapshot2, null, 2));
      } else {
        process.stdout.write("\x1B[2J\x1B[H");
        renderSnapshot(snapshot2);
        log("");
        log(`  Refreshing every ${intervalSeconds}s \u2014 Ctrl+C to exit`);
      }
    };
    run2();
    const timer = setInterval(run2, intervalSeconds * 1e3);
    const cleanup = () => {
      clearInterval(timer);
      process.exit(0);
    };
    process.on("SIGINT", cleanup);
    process.on("SIGTERM", cleanup);
    await new Promise(() => {
    });
    return {
      ok: true,
      command: "unknown",
      code: "TAP_NO_OP",
      message: "Watch mode ended",
      warnings: [],
      data: {}
    };
  }
  const snapshot = collectDashboardSnapshot(repoRoot, commsDirOverride);
  if (jsonMode) {
    console.log(JSON.stringify(snapshot, null, 2));
  } else {
    renderSnapshot(snapshot);
  }
  return {
    ok: true,
    command: "dashboard",
    code: "TAP_STATUS_OK",
    message: `Dashboard: ${snapshot.bridges.length} bridge(s), ${snapshot.agents.length} agent(s), ${snapshot.prs.length} PR(s)`,
    warnings: snapshot.warnings.map((w) => w.message),
    data: snapshot
  };
}

// src/commands/doctor.ts
import {
  existsSync as existsSync29,
  mkdirSync as mkdirSync14,
  readdirSync as readdirSync8,
  readFileSync as readFileSync24,
  renameSync as renameSync14,
  statSync as statSync3,
  unlinkSync as unlinkSync8,
  writeFileSync as writeFileSync16
} from "fs";
import { homedir as homedir3 } from "os";
import { spawnSync as spawnSync6 } from "child_process";
import { dirname as dirname15, join as join28, resolve as resolve14 } from "path";
init_config();
init_drift_detector();
init_utils();
var PASS = "pass";
var WARN = "warn";
var FAIL = "fail";
var HEARTBEAT_ACTIVE_WINDOW_MS = 10 * 60 * 1e3;
var ORPHAN_HEARTBEAT_WINDOW_MS = 24 * 60 * 60 * 1e3;
var SIGNING_OFF_HEARTBEAT_WINDOW_MS = 5 * 60 * 1e3;
var CODEX_ENV_DRIFT_KEYS = [
  "TAP_COMMS_DIR",
  "TAP_STATE_DIR",
  "TAP_REPO_ROOT"
];
var CODEX_SESSION_NEUTRAL_NAME = "<set-per-session>";
function normalizeComparablePath2(value) {
  return resolve14(value).replace(/\\/g, "/").toLowerCase();
}
function samePath(left, right) {
  return normalizeComparablePath2(left) === normalizeComparablePath2(right);
}
function looksLikePathToken(value) {
  return /^[A-Za-z]:[\\/]/.test(value) || value.startsWith("/") || value.startsWith("\\") || value.startsWith(".") || value.includes("/") || value.includes("\\");
}
function sameCommandToken(left, right) {
  return looksLikePathToken(left) || looksLikePathToken(right) ? samePath(left, right) : left === right;
}
function sameStringArray(left, right) {
  return left.length === right.length && left.every((value, index) => sameCommandToken(value, right[index] ?? ""));
}
function normalizeCommandBasename(command) {
  const token = command.split(/[\\/]/).pop() ?? command;
  return token.toLowerCase().replace(/\.(cmd|exe|ps1|bat)$/i, "");
}
function findFirstLauncherTarget(args) {
  for (const arg of args) {
    if (!arg || arg === "--" || arg.startsWith("-")) {
      continue;
    }
    return arg;
  }
  return null;
}
function looksLikePackageSpecifier(value) {
  const normalized = value.trim();
  if (!normalized || /^[A-Za-z]:[\\/]/.test(normalized) || normalized.startsWith("/") || normalized.startsWith("\\") || normalized.startsWith(".") || /\.(?:[cm]?js|tsx?|json|ps1|cmd|exe)$/i.test(normalized)) {
    return false;
  }
  return /^(?:@[^/\\]+\/)?[A-Za-z0-9][A-Za-z0-9._-]*(?:@[A-Za-z0-9][A-Za-z0-9._.-]*)?$/.test(
    normalized
  );
}
function getNpxPackageLauncher(command, args) {
  if (normalizeCommandBasename(command) !== "npx") {
    return null;
  }
  const packageName = findFirstLauncherTarget(args);
  if (!packageName || !looksLikePackageSpecifier(packageName)) {
    return null;
  }
  return [command, ...args].join(" ");
}
function appendWarningMessage(message, extra) {
  return message.includes(extra) ? message : `${message}; ${extra}`;
}
function findCodexConfigPath3() {
  return join28(homedir3(), ".codex", "config.toml");
}
function canonicalizeTrustPath3(targetPath) {
  let resolved = resolve14(targetPath).replace(/\//g, "\\");
  const driveRoot = /^[A-Za-z]:\\$/;
  if (!driveRoot.test(resolved)) {
    resolved = resolved.replace(/\\+$/g, "");
  }
  return resolved.startsWith("\\\\?\\") ? resolved : `\\\\?\\${resolved}`;
}
function trustSelector2(targetPath) {
  return `projects.'${canonicalizeTrustPath3(targetPath)}'`;
}
function writeTomlAtomically(filePath, content) {
  const dir = dirname15(filePath);
  mkdirSync14(dir, { recursive: true });
  const tmp = `${filePath}.tmp.${process.pid}`;
  writeFileSync16(tmp, content, "utf-8");
  renameSync14(tmp, filePath);
}
function hasInstalledCodexInstance(state) {
  return state ? Object.values(state.instances).some(
    (instance) => instance.runtime === "codex" && instance.installed
  ) : false;
}
function getCodexTrustTargets(repoRoot) {
  return [...new Set([repoRoot, process.cwd()].map((value) => resolve14(value)))];
}
function buildSessionNeutralCodexEnv(env) {
  const neutralEnv = {
    ...env,
    TAP_AGENT_NAME: CODEX_SESSION_NEUTRAL_NAME
  };
  delete neutralEnv.TAP_AGENT_ID;
  return neutralEnv;
}
function buildCodexEnvEntries2(existingTable, managedEnv) {
  const preservedEnv = parseTomlAssignments(existingTable ?? "");
  delete preservedEnv.TAP_AGENT_ID;
  return {
    ...preservedEnv,
    ...managedEnv
  };
}
function buildCodexDoctorSpec(repoRoot, commsDir) {
  const state = loadState(repoRoot);
  if (!hasInstalledCodexInstance(state)) {
    return null;
  }
  const ctx = createAdapterContext(commsDir, repoRoot);
  const managed = buildManagedMcpServerSpec(ctx);
  return {
    configPath: findCodexConfigPath3(),
    trustTargets: getCodexTrustTargets(repoRoot),
    managed: {
      ...managed,
      env: buildSessionNeutralCodexEnv(managed.env)
    }
  };
}
function repairCodexConfig(repoRoot, commsDir) {
  const spec = buildCodexDoctorSpec(repoRoot, commsDir);
  if (!spec) {
    throw new Error("No installed Codex instance found in tap state.");
  }
  if (!spec.managed.command || spec.managed.issues.length > 0) {
    throw new Error(
      spec.managed.issues[0] ?? "Unable to resolve the managed tap MCP server for Codex."
    );
  }
  const existingContent = existsSync29(spec.configPath) ? readFileSync24(spec.configPath, "utf-8") : "";
  const existingTapEnvTable = extractTomlTable(
    existingContent,
    "mcp_servers.tap.env"
  );
  const existingLegacyEnvTable = extractTomlTable(
    existingContent,
    "mcp_servers.tap-comms.env"
  );
  const preservedEnv = parseTomlAssignments(
    existingTapEnvTable ?? existingLegacyEnvTable ?? ""
  );
  const repairedEnv = {
    ...preservedEnv,
    ...Object.fromEntries(
      CODEX_ENV_DRIFT_KEYS.map((key) => [key, spec.managed.env[key]])
    )
  };
  repairedEnv.TAP_AGENT_NAME = spec.managed.env.TAP_AGENT_NAME;
  delete repairedEnv.TAP_AGENT_ID;
  let nextContent = existingContent;
  if (extractTomlTable(nextContent, "mcp_servers.tap-comms.env")) {
    nextContent = removeTomlTable(nextContent, "mcp_servers.tap-comms.env");
  }
  if (extractTomlTable(nextContent, "mcp_servers.tap-comms")) {
    nextContent = removeTomlTable(nextContent, "mcp_servers.tap-comms");
  }
  nextContent = replaceTomlTable(
    nextContent,
    "mcp_servers.tap",
    renderTomlTable(
      "mcp_servers.tap",
      {
        command: spec.managed.command,
        args: spec.managed.args,
        approval_mode: "auto"
      },
      extractTomlTable(existingContent, "mcp_servers.tap")
    )
  );
  nextContent = replaceTomlTable(
    nextContent,
    "mcp_servers.tap.env",
    renderTomlTable(
      "mcp_servers.tap.env",
      buildCodexEnvEntries2(
        existingTapEnvTable ?? existingLegacyEnvTable,
        repairedEnv
      )
    )
  );
  for (const trustTarget of spec.trustTargets) {
    const selector = trustSelector2(trustTarget);
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
  writeTomlAtomically(spec.configPath, nextContent);
  return `Repaired Codex config at ${spec.configPath}. Restart Codex to reload MCP settings.`;
}
function countFiles(dir, ext = ".md") {
  if (!existsSync29(dir)) return 0;
  try {
    return readdirSync8(dir).filter((f) => f.endsWith(ext)).length;
  } catch {
    return 0;
  }
}
function recentFileCount(dir, withinMs) {
  if (!existsSync29(dir)) return 0;
  const cutoff = Date.now() - withinMs;
  let count = 0;
  try {
    for (const f of readdirSync8(dir)) {
      if (!f.endsWith(".md")) continue;
      try {
        if (statSync3(join28(dir, f)).mtimeMs > cutoff) count++;
      } catch {
      }
    }
  } catch {
  }
  return count;
}
function loadDoctorHeartbeatStore(commsDir) {
  const heartbeatsPath = join28(commsDir, "heartbeats.json");
  if (!existsSync29(heartbeatsPath)) return null;
  try {
    return JSON.parse(readFileSync24(heartbeatsPath, "utf-8"));
  } catch {
    return null;
  }
}
function saveDoctorHeartbeatStore(commsDir, store) {
  const heartbeatsPath = join28(commsDir, "heartbeats.json");
  const tmp = `${heartbeatsPath}.tmp.${process.pid}`;
  writeFileSync16(tmp, JSON.stringify(store, null, 2), "utf-8");
  renameSync14(tmp, heartbeatsPath);
}
function parseHeartbeatAgeMs(record, now) {
  const raw = record.lastActivity ?? record.timestamp;
  if (!raw) return Number.POSITIVE_INFINITY;
  const parsed = new Date(raw).getTime();
  if (!Number.isFinite(parsed)) return Number.POSITIVE_INFINITY;
  return Math.max(0, now - parsed);
}
function resolveHeartbeatInstanceId2(state, heartbeatId) {
  if (!state) return null;
  if (state.instances[heartbeatId]) return heartbeatId;
  const hyphenated = heartbeatId.replace(/_/g, "-");
  if (state.instances[hyphenated]) return hyphenated;
  const underscored = heartbeatId.replace(/-/g, "_");
  if (state.instances[underscored]) return underscored;
  return null;
}
function collectStaleHeartbeatIds(commsDir, state, stateDir) {
  const store = loadDoctorHeartbeatStore(commsDir);
  if (!store) return [];
  const now = Date.now();
  const stale = [];
  for (const [heartbeatId, heartbeat] of Object.entries(store)) {
    const ageMs = parseHeartbeatAgeMs(heartbeat, now);
    const instanceId = resolveHeartbeatInstanceId2(state, heartbeatId);
    const instance = instanceId ? state?.instances[instanceId] : null;
    const bridgeBacked = instance?.bridgeMode === "app-server";
    const bridgeRunning = bridgeBacked && instanceId ? isBridgeRunning(stateDir, instanceId) : false;
    const status = heartbeat.status ?? "active";
    const staleByStatus = status === "signing-off" && ageMs >= SIGNING_OFF_HEARTBEAT_WINDOW_MS;
    const staleByDeadBridge = bridgeBacked && !bridgeRunning && ageMs >= HEARTBEAT_ACTIVE_WINDOW_MS;
    const staleByAge = !bridgeRunning && ageMs >= ORPHAN_HEARTBEAT_WINDOW_MS;
    if (staleByStatus || staleByDeadBridge || staleByAge) {
      stale.push({
        id: heartbeatId,
        label: heartbeat.agent?.trim() || heartbeatId,
        ageMs
      });
    }
  }
  return stale;
}
function pruneHeartbeatIds(commsDir, heartbeatIds) {
  if (heartbeatIds.length === 0) return 0;
  const store = loadDoctorHeartbeatStore(commsDir);
  if (!store) return 0;
  let removed = 0;
  for (const heartbeatId of new Set(heartbeatIds)) {
    if (heartbeatId in store) {
      delete store[heartbeatId];
      removed += 1;
    }
  }
  if (removed > 0) {
    saveDoctorHeartbeatStore(commsDir, store);
  }
  return removed;
}
function checkComms(commsDir) {
  const checks = [];
  checks.push({
    name: "comms directory",
    status: existsSync29(commsDir) ? PASS : FAIL,
    message: existsSync29(commsDir) ? commsDir : `Not found: ${commsDir}`,
    fix: existsSync29(commsDir) ? void 0 : () => {
      mkdirSync14(commsDir, { recursive: true });
      return `Created ${commsDir}`;
    }
  });
  for (const [subdir, required] of [
    ["inbox", true],
    ["reviews", false],
    ["findings", false]
  ]) {
    const dir = join28(commsDir, subdir);
    const exists = existsSync29(dir);
    checks.push({
      name: `${subdir} directory`,
      status: exists ? PASS : required ? FAIL : WARN,
      message: exists ? subdir === "findings" ? `${countFiles(dir)} findings` : subdir === "inbox" ? `${countFiles(dir)} messages` : "exists" : `Missing${required ? "" : " (optional)"}`,
      fix: exists ? void 0 : () => {
        mkdirSync14(dir, { recursive: true });
        return `Created ${dir}`;
      }
    });
  }
  const heartbeats = join28(commsDir, "heartbeats.json");
  if (existsSync29(heartbeats)) {
    try {
      const store = JSON.parse(readFileSync24(heartbeats, "utf-8"));
      const agents = Object.keys(store);
      const now = Date.now();
      const active = agents.filter((a) => {
        const ts = store[a]?.lastActivity;
        return ts && now - new Date(ts).getTime() < HEARTBEAT_ACTIVE_WINDOW_MS;
      });
      checks.push({
        name: "heartbeats",
        status: active.length > 0 ? PASS : WARN,
        message: `${active.length} active / ${agents.length} total`
      });
    } catch {
      checks.push({
        name: "heartbeats",
        status: WARN,
        message: "File exists but unreadable"
      });
    }
  } else {
    checks.push({
      name: "heartbeats",
      status: WARN,
      message: "No heartbeats file"
    });
  }
  return checks;
}
function checkStaleHeartbeats(repoRoot, commsDir, stateDir) {
  const state = loadState(repoRoot);
  const stale = collectStaleHeartbeatIds(commsDir, state, stateDir);
  if (stale.length === 0) {
    return [
      {
        name: "stale heartbeats",
        status: PASS,
        message: "none"
      }
    ];
  }
  const preview = stale.slice(0, 3).map((entry) => `${entry.label} (${Math.round(entry.ageMs / 6e4)}m)`).join(", ");
  return [
    {
      name: "stale heartbeats",
      status: WARN,
      message: stale.length > 3 ? `${stale.length} stale entries: ${preview}, ...` : `${stale.length} stale entr${stale.length === 1 ? "y" : "ies"}: ${preview}`,
      fix: () => {
        const removed = pruneHeartbeatIds(
          commsDir,
          stale.map((entry) => entry.id)
        );
        return `Pruned ${removed} stale heartbeat entr${removed === 1 ? "y" : "ies"}`;
      }
    }
  ];
}
function checkInstances(repoRoot, stateDir, commsDir) {
  const checks = [];
  const state = loadState(repoRoot);
  if (!state) {
    checks.push({
      name: "tap state",
      status: FAIL,
      message: "Not initialized. Run: tap init"
    });
    return checks;
  }
  checks.push({
    name: "tap state",
    status: PASS,
    message: `v${state.schemaVersion}, ${getInstalledInstances(state).length} instance(s)`
  });
  const installed = getInstalledInstances(state);
  for (const id of installed) {
    const inst = state.instances[id];
    if (!inst) continue;
    if (inst.bridgeMode === "app-server") {
      const running = isBridgeRunning(stateDir, id);
      const bridgeState = loadBridgeState(stateDir, id);
      const heartbeatAge = getHeartbeatAge(stateDir, id);
      const runtimeHeartbeat = loadRuntimeBridgeHeartbeat(bridgeState);
      const savedThread = loadRuntimeBridgeThreadState(bridgeState);
      let status;
      let message;
      let fix;
      if (running && bridgeState) {
        if (heartbeatAge !== null && heartbeatAge > 120) {
          status = WARN;
          message = `PID ${bridgeState.pid} alive but heartbeat stale (${Math.round(heartbeatAge)}s ago)`;
        } else {
          status = PASS;
          message = `PID ${bridgeState.pid}, port ${inst.port ?? "auto"}`;
        }
      } else if (bridgeState && !running) {
        status = WARN;
        message = `Stale PID ${bridgeState.pid} (process dead)`;
        fix = () => {
          const appServer = bridgeState.appServer;
          if (appServer?.managed) {
            for (const pid of [appServer.auth?.gatewayPid, appServer.pid]) {
              if (pid) {
                try {
                  if (process.platform === "win32") {
                    spawnSync6("taskkill", ["/PID", String(pid), "/F", "/T"], {
                      stdio: "pipe"
                    });
                  } else {
                    process.kill(pid);
                  }
                } catch {
                }
              }
            }
          }
          const pidPath = join28(stateDir, "pids", `bridge-${id}.json`);
          try {
            unlinkSync8(pidPath);
          } catch {
          }
          const currentState = loadState(repoRoot);
          if (currentState?.instances[id]) {
            currentState.instances[id].bridge = null;
            currentState.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
            saveState(repoRoot, currentState);
          }
          const removedHeartbeats = pruneHeartbeatIds(commsDir, [
            id,
            id.replace(/-/g, "_"),
            id.replace(/_/g, "-")
          ]);
          const suffix = removedHeartbeats > 0 ? `; pruned ${removedHeartbeats} heartbeat entr${removedHeartbeats === 1 ? "y" : "ies"}` : "";
          return `Cleaned stale bridge + managed processes for ${id}${suffix}`;
        };
      } else {
        status = WARN;
        message = "Not running";
      }
      const lastRuntimeError = runtimeHeartbeat?.lastError?.trim();
      if (lastRuntimeError) {
        status = WARN;
        message = `${message}; bridge last error: ${lastRuntimeError}`;
      }
      if (savedThread?.threadId && savedThread.cwd && !samePath(savedThread.cwd, repoRoot)) {
        status = WARN;
        message = appendWarningMessage(
          message,
          `saved thread cwd mismatch (${savedThread.cwd})`
        );
      }
      if (runtimeHeartbeat?.threadId && savedThread?.threadId && runtimeHeartbeat.threadId !== savedThread.threadId) {
        status = WARN;
        message = appendWarningMessage(
          message,
          `saved thread ${savedThread.threadId} differs from active thread ${runtimeHeartbeat.threadId}`
        );
      }
      if (runtimeHeartbeat?.threadCwd && !samePath(runtimeHeartbeat.threadCwd, repoRoot)) {
        status = WARN;
        message = appendWarningMessage(
          message,
          `active thread cwd mismatch (${runtimeHeartbeat.threadCwd})`
        );
      }
      checks.push({ name: `bridge: ${id}`, status, message, fix });
    } else {
      checks.push({
        name: `instance: ${id}`,
        status: PASS,
        message: `${inst.runtime} (${inst.bridgeMode})`
      });
    }
  }
  return checks;
}
function checkMessageLifecycle(commsDir) {
  const checks = [];
  const inbox = join28(commsDir, "inbox");
  if (!existsSync29(inbox)) {
    checks.push({
      name: "message flow",
      status: FAIL,
      message: "No inbox"
    });
    return checks;
  }
  const total = countFiles(inbox);
  const recent1h = recentFileCount(inbox, 60 * 60 * 1e3);
  const recent10m = recentFileCount(inbox, 10 * 60 * 1e3);
  const messageSummary = `${total} total, ${recent1h} in last 1h, ${recent10m} in last 10m`;
  checks.push({
    name: "message flow",
    status: recent10m > 0 ? PASS : WARN,
    message: total === 0 ? `${messageSummary} (expected before first exchange)` : messageSummary
  });
  const receiptsPath = join28(commsDir, "receipts", "receipts.json");
  if (existsSync29(receiptsPath)) {
    try {
      const receipts = JSON.parse(readFileSync24(receiptsPath, "utf-8"));
      const receiptCount = Object.keys(receipts).length;
      checks.push({
        name: "read receipts",
        status: PASS,
        message: `${receiptCount} receipts tracked`
      });
    } catch {
      checks.push({
        name: "read receipts",
        status: WARN,
        message: "File exists but unreadable"
      });
    }
  }
  return checks;
}
function checkMcpServer(repoRoot) {
  const checks = [];
  const mcpJson = join28(repoRoot, ".mcp.json");
  if (!existsSync29(mcpJson)) {
    checks.push({
      name: "MCP config (.mcp.json)",
      status: WARN,
      message: "Not found \u2014 MCP channel notifications won't work"
    });
    return checks;
  }
  let config;
  try {
    config = JSON.parse(readFileSync24(mcpJson, "utf-8"));
  } catch {
    checks.push({
      name: "MCP config (.mcp.json)",
      status: WARN,
      message: "File exists but invalid JSON"
    });
    return checks;
  }
  const mcpServers = config?.mcpServers;
  const hasTap = mcpServers?.["tap"];
  const hasOldKey = mcpServers?.["tap-comms"];
  if (hasOldKey) {
    checks.push({
      name: "MCP config (.mcp.json)",
      status: WARN,
      message: 'Legacy "tap-comms" key found. Run "tap add claude" to migrate to the new "tap" key.'
    });
  }
  if (!hasTap && !hasOldKey) {
    checks.push({
      name: "MCP config (.mcp.json)",
      status: WARN,
      message: "tap not configured"
    });
    return checks;
  }
  const hasTapComms = hasTap ?? hasOldKey;
  if (!hasTapComms) {
    checks.push({
      name: "MCP config (.mcp.json)",
      status: FAIL,
      message: "No tap or tap-comms key found in .mcp.json"
    });
    return checks;
  }
  checks.push({
    name: "MCP config (.mcp.json)",
    status: PASS,
    message: `command: ${hasTapComms.command}`
  });
  if (hasTapComms.command) {
    const cmd = hasTapComms.command;
    let cmdAvailable = existsSync29(cmd);
    if (!cmdAvailable) {
      cmdAvailable = probeCommand([cmd]).command !== null;
    }
    checks.push({
      name: "MCP command binary",
      status: cmdAvailable ? PASS : FAIL,
      message: cmdAvailable ? cmd : `Not found: ${cmd} (checked PATH and absolute)`
    });
  }
  const npxPackageLauncher = hasTapComms.command && hasTapComms.args ? getNpxPackageLauncher(hasTapComms.command, hasTapComms.args) : null;
  if (npxPackageLauncher) {
    checks.push({
      name: "MCP server script",
      status: PASS,
      message: `Package launcher: ${npxPackageLauncher}`
    });
  } else if (hasTapComms.args?.[0]) {
    const mcpScript = hasTapComms.args[0];
    checks.push({
      name: "MCP server script",
      status: existsSync29(mcpScript) ? PASS : FAIL,
      message: existsSync29(mcpScript) ? mcpScript : `Not found: ${mcpScript}`
    });
    if (mcpScript.endsWith(".mjs") && hasTapComms.command && !hasTapComms.command.includes("bun")) {
      checks.push({
        name: "MCP SQLite support",
        status: WARN,
        message: "Node + .mjs = no SQLite (bun:sqlite unavailable). Use bun or .ts source for full features."
      });
    }
  }
  if (!hasTapComms.cwd) {
    checks.push({
      name: "MCP cwd field",
      status: WARN,
      message: "No cwd in .mcp.json \u2014 worktree sessions may fail to resolve MCP server dependencies"
    });
  } else {
    checks.push({
      name: "MCP cwd field",
      status: PASS,
      message: hasTapComms.cwd
    });
  }
  const envCommsDir = hasTapComms.env?.TAP_COMMS_DIR;
  if (!envCommsDir) {
    checks.push({
      name: "MCP TAP_COMMS_DIR",
      status: FAIL,
      message: "TAP_COMMS_DIR not set in .mcp.json env \u2014 server will fail to start"
    });
  } else {
    checks.push({
      name: "MCP TAP_COMMS_DIR",
      status: existsSync29(envCommsDir) ? PASS : FAIL,
      message: existsSync29(envCommsDir) ? envCommsDir : `Directory not found: ${envCommsDir}`
    });
  }
  checks.push({
    name: "MCP session cache",
    status: PASS,
    message: "If .mcp.json was changed mid-session, restart Claude (Ctrl+C \u2192 claude --resume) to reload"
  });
  return checks;
}
function checkCodexConfig(repoRoot, commsDir) {
  const spec = buildCodexDoctorSpec(repoRoot, commsDir);
  if (!spec) {
    return [];
  }
  const checks = [];
  const fixHint = 'Run "tap doctor --fix" or "tap add codex --force".';
  if (!existsSync29(spec.configPath)) {
    checks.push({
      name: "MCP config (~/.codex/config.toml)",
      status: WARN,
      message: `${spec.configPath} not found. ${fixHint}`,
      fix: () => repairCodexConfig(repoRoot, commsDir)
    });
    return checks;
  }
  const content = readFileSync24(spec.configPath, "utf-8");
  const tapTable = extractTomlTable(content, "mcp_servers.tap");
  const tapEnvTable = extractTomlTable(content, "mcp_servers.tap.env");
  const legacyTable = extractTomlTable(content, "mcp_servers.tap-comms");
  const legacyEnvTable = extractTomlTable(content, "mcp_servers.tap-comms.env");
  const selectedMain = parseTomlAssignments(tapTable ?? "");
  const selectedEnv = parseTomlAssignments(tapEnvTable ?? legacyEnvTable ?? "");
  const issues = [];
  if (legacyTable || legacyEnvTable) {
    issues.push('legacy "tap-comms" key present');
  }
  if (!tapTable && !legacyTable) {
    issues.push("tap MCP table missing");
  }
  if (!tapEnvTable && !legacyEnvTable) {
    issues.push("tap MCP env table missing");
  }
  if (tapTable && spec.managed.command) {
    const actualCommand = selectedMain.command;
    if (typeof actualCommand !== "string") {
      issues.push("tap MCP command missing");
    } else if (!sameCommandToken(actualCommand, spec.managed.command)) {
      issues.push(`tap MCP command drift (${actualCommand})`);
    }
    const actualArgs = selectedMain.args;
    if (!Array.isArray(actualArgs)) {
      issues.push("tap MCP args missing");
    } else if (!sameStringArray(actualArgs, spec.managed.args)) {
      issues.push(`tap MCP args drift (${JSON.stringify(actualArgs)})`);
    }
  }
  for (const key of CODEX_ENV_DRIFT_KEYS) {
    const expected = spec.managed.env[key];
    const actual = selectedEnv[key];
    if (typeof actual !== "string") {
      issues.push(`${key} missing`);
      continue;
    }
    if (!samePath(actual, expected)) {
      issues.push(`${key} drift (${actual})`);
    }
  }
  const actualAgentName = selectedEnv.TAP_AGENT_NAME;
  if (typeof actualAgentName !== "string") {
    issues.push("TAP_AGENT_NAME missing");
  } else if (actualAgentName !== spec.managed.env.TAP_AGENT_NAME) {
    issues.push(`non-neutral TAP_AGENT_NAME persisted (${actualAgentName})`);
  }
  const actualAgentId = selectedEnv.TAP_AGENT_ID;
  if (typeof actualAgentId === "string" && actualAgentId.trim()) {
    issues.push(`concrete TAP_AGENT_ID persisted (${actualAgentId})`);
  }
  if (tapTable) {
    const actualApprovalMode = selectedMain.approval_mode;
    if (typeof actualApprovalMode !== "string") {
      issues.push("approval_mode missing (expected auto)");
    } else if (actualApprovalMode !== "auto") {
      issues.push(`approval_mode drift (${actualApprovalMode})`);
    }
  }
  for (const trustTarget of spec.trustTargets) {
    const trustTable = extractTomlTable(content, trustSelector2(trustTarget));
    if (!trustTable || !trustTable.includes('trust_level = "trusted"')) {
      issues.push(`missing trust for ${trustTarget}`);
    }
  }
  if (issues.length === 0) {
    checks.push({
      name: "MCP config (~/.codex/config.toml)",
      status: PASS,
      message: spec.configPath
    });
    return checks;
  }
  checks.push({
    name: "MCP config (~/.codex/config.toml)",
    status: WARN,
    message: `${issues.join("; ")}. ${fixHint}`,
    fix: () => repairCodexConfig(repoRoot, commsDir)
  });
  return checks;
}
function checkBridgeTurnHealth(repoRoot) {
  const checks = [];
  const tmpDir = join28(repoRoot, ".tmp");
  if (!existsSync29(tmpDir)) return checks;
  const state = loadState(repoRoot);
  const activeMatchers = /* @__PURE__ */ new Set();
  if (state) {
    for (const [id, inst] of Object.entries(state.instances)) {
      if (inst?.installed && inst.bridgeMode === "app-server") {
        activeMatchers.add(id);
        if (inst.agentName) activeMatchers.add(inst.agentName);
      }
    }
  }
  let dirs;
  try {
    dirs = readdirSync8(tmpDir).filter((d) => {
      if (!d.startsWith("codex-app-server-bridge")) return false;
      const suffix = d.replace("codex-app-server-bridge-", "");
      if (activeMatchers.size === 0) return true;
      for (const matcher of activeMatchers) {
        if (suffix === matcher || suffix.startsWith(matcher)) return true;
      }
      return false;
    });
  } catch {
    return checks;
  }
  for (const dir of dirs) {
    const heartbeatPath = join28(tmpDir, dir, "heartbeat.json");
    if (!existsSync29(heartbeatPath)) continue;
    let heartbeat;
    try {
      heartbeat = JSON.parse(readFileSync24(heartbeatPath, "utf-8"));
    } catch {
      checks.push({
        name: `turn: ${dir}`,
        status: WARN,
        message: "heartbeat.json unreadable"
      });
      continue;
    }
    const heartbeatAge = heartbeat.updatedAt ? Math.floor(
      (Date.now() - new Date(heartbeat.updatedAt).getTime()) / 1e3
    ) : null;
    if (heartbeat.connected === false || heartbeat.initialized === false) {
      checks.push({
        name: `turn: ${dir}`,
        status: FAIL,
        message: `disconnected (connected=${heartbeat.connected}, initialized=${heartbeat.initialized})${heartbeat.lastError ? ` \u2014 ${heartbeat.lastError}` : ""}`
      });
      continue;
    }
    if (heartbeatAge !== null && heartbeatAge > 300) {
      checks.push({
        name: `turn: ${dir}`,
        status: FAIL,
        message: `dead \u2014 heartbeat ${Math.round(heartbeatAge)}s ago, no updates`
      });
      continue;
    }
    if (heartbeat.activeTurnId) {
      const ZOMBIE_THRESHOLD = 30 * 60;
      const lastNotifAge = heartbeat.lastNotificationAt ? Math.floor(
        (Date.now() - new Date(heartbeat.lastNotificationAt).getTime()) / 1e3
      ) : null;
      if (lastNotifAge !== null && lastNotifAge > ZOMBIE_THRESHOLD) {
        checks.push({
          name: `turn: ${dir}`,
          status: WARN,
          message: `zombie \u2014 active turn ${heartbeat.activeTurnId}, last notification ${Math.round(lastNotifAge / 60)}m ago (${heartbeat.lastNotificationMethod ?? "?"}). MCP tools may not be exposed in app-server turns \u2014 try bridge restart${heartbeat.lastError ? `. Error: ${heartbeat.lastError}` : ""}`
        });
        continue;
      }
      const failures2 = heartbeat.consecutiveFailureCount ?? 0;
      if (failures2 > 0 && heartbeatAge !== null && heartbeatAge < 60) {
        checks.push({
          name: `turn: ${dir}`,
          status: WARN,
          message: `zombie \u2014 active turn ${heartbeat.activeTurnId}, ${failures2} consecutive failures. MCP tools may not be exposed in app-server turns \u2014 try bridge restart${heartbeat.lastError ? `. Error: ${heartbeat.lastError}` : ""}`
        });
        continue;
      }
    }
    const failures = heartbeat.consecutiveFailureCount ?? 0;
    if (failures > 5) {
      checks.push({
        name: `turn: ${dir}`,
        status: WARN,
        message: `slow \u2014 ${failures} consecutive failures, last: ${heartbeat.lastError ?? "unknown"}`
      });
      continue;
    }
    if (heartbeat.authenticated === false) {
      checks.push({
        name: `turn: ${dir}`,
        status: WARN,
        message: "bridge running without auth \u2014 app-server session is unprotected. Use --gateway-token-file to enable auth."
      });
    }
    const turnInfo = heartbeat.activeTurnId ? `active turn ${heartbeat.activeTurnId}` : `idle (last: ${heartbeat.lastTurnStatus ?? "none"})`;
    checks.push({
      name: `turn: ${dir}`,
      status: PASS,
      message: `healthy \u2014 ${turnInfo}, heartbeat ${heartbeatAge ?? "?"}s ago`
    });
  }
  return checks;
}
function renderCheck(check, fixMode) {
  const icons = {
    pass: "[OK]",
    warn: "[!!]",
    fail: "[XX]",
    skip: "[--]"
  };
  const icon = icons[check.status] || "[??]";
  const fixable = fixMode && check.fix ? " (fixable)" : "";
  const msg = check.message ? ` \u2014 ${check.message}${fixable}` : "";
  return `  ${icon} ${check.name}${msg}`;
}
var DOCTOR_HELP = `
Usage:
  tap doctor [options]

Description:
  Diagnose tap infrastructure health: comms directory, instances, bridges,
  message lifecycle, and MCP server configuration.

Options:
  --fix                 Auto-repair detected issues where possible
  --comms-dir <path>    Override comms directory
  --help, -h            Show help

Examples:
  npx @hua-labs/tap doctor
  npx @hua-labs/tap doctor --fix
`.trim();
async function doctorCommand(args) {
  if (args.includes("--help") || args.includes("-h")) {
    log(DOCTOR_HELP);
    return {
      ok: true,
      command: "doctor",
      code: "TAP_NO_OP",
      message: DOCTOR_HELP,
      warnings: [],
      data: {}
    };
  }
  const repoRoot = findRepoRoot();
  const overrides = {};
  let fixMode = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--comms-dir" && args[i + 1]) {
      overrides.commsDir = args[i + 1];
    }
    if (args[i] === "--fix") {
      fixMode = true;
    }
  }
  const { config } = resolveConfig(overrides, repoRoot);
  const state = loadState(repoRoot);
  const commsDir = overrides.commsDir ? config.commsDir : state?.commsDir ?? config.commsDir;
  logHeader(`@hua-labs/tap doctor (v${version})${fixMode ? " --fix" : ""}`);
  function checkConfigDrift() {
    let driftResults;
    try {
      driftResults = checkAllDrift(config.stateDir, state);
    } catch (err) {
      return [
        {
          name: "drift:infrastructure",
          status: "warn",
          message: `Config drift check failed: ${err instanceof Error ? err.message : String(err)}`
        }
      ];
    }
    const checks = [];
    for (const result of driftResults) {
      for (const dc of result.checks) {
        const check = {
          name: `drift:${result.instanceId}:${dc.name}`,
          status: dc.status === "ok" ? "pass" : dc.autoFixable ? "warn" : "fail",
          message: dc.details ?? void 0
        };
        if (dc.autoFixable && dc.status !== "ok") {
          check.fix = () => {
            const {
              loadInstanceConfig: loadInst,
              saveInstanceConfig: saveInst
            } = (init_instance_config(), __toCommonJS(instance_config_exports));
            const {
              computeFileHash: hashFile
            } = (init_drift_detector(), __toCommonJS(drift_detector_exports));
            const instConfig = loadInst(config.stateDir, result.instanceId);
            if (!instConfig || !state) {
              return `Skipped: instance config not found for ${result.instanceId}`;
            }
            const inst = state.instances[result.instanceId];
            if (!inst) {
              return `Skipped: instance not in state.json for ${result.instanceId}`;
            }
            inst.agentName = instConfig.agentName;
            inst.port = instConfig.port;
            inst.configHash = instConfig.configHash;
            inst.configSourceFile = inst.configSourceFile || join28(config.stateDir, "instances", `${result.instanceId}.json`);
            saveState(repoRoot, state);
            if (inst.configPath && existsSync29(inst.configPath)) {
              const currentHash = hashFile(inst.configPath);
              if (instConfig.runtimeConfigHash !== currentHash) {
                instConfig.runtimeConfigHash = currentHash;
                instConfig.lastSyncedToRuntime = (/* @__PURE__ */ new Date()).toISOString();
                saveInst(config.stateDir, instConfig);
              }
            }
            return `Synced state.json + runtime hash for ${result.instanceId}`;
          };
        }
        checks.push(check);
      }
    }
    return checks;
  }
  function runAllChecks() {
    const checks = [];
    checks.push(...checkComms(commsDir));
    checks.push(...checkStaleHeartbeats(repoRoot, commsDir, config.stateDir));
    checks.push(...checkInstances(repoRoot, config.stateDir, commsDir));
    checks.push(...checkConfigDrift());
    checks.push(...checkMessageLifecycle(commsDir));
    checks.push(...checkMcpServer(repoRoot));
    checks.push(...checkCodexConfig(repoRoot, commsDir));
    checks.push(...checkBridgeTurnHealth(repoRoot));
    return checks;
  }
  const initialChecks = runAllChecks();
  for (const section of [
    "Comms",
    "Instances",
    "Config Drift",
    "Messages",
    "MCP",
    "Turns"
  ]) {
    const sectionChecks = {
      Comms: initialChecks.filter(
        (c) => [
          "comms directory",
          "inbox directory",
          "reviews directory",
          "findings directory",
          "heartbeats",
          "stale heartbeats"
        ].includes(c.name)
      ),
      Instances: initialChecks.filter(
        (c) => c.name.startsWith("bridge:") || c.name.startsWith("instance:") || c.name === "tap state"
      ),
      "Config Drift": initialChecks.filter((c) => c.name.startsWith("drift:")),
      Messages: initialChecks.filter(
        (c) => ["message flow", "read receipts"].includes(c.name)
      ),
      MCP: initialChecks.filter(
        (c) => c.name.startsWith("MCP") || c.name === "MCP server script"
      ),
      Turns: initialChecks.filter((c) => c.name.startsWith("turn:"))
    }[section];
    if (sectionChecks.length > 0) {
      log(`${section}:`);
      for (const c of sectionChecks) log(renderCheck(c, fixMode));
      log("");
    }
  }
  const fixed = [];
  let finalChecks = initialChecks;
  if (fixMode) {
    const fixable = initialChecks.filter(
      (c) => (c.status === "warn" || c.status === "fail") && c.fix
    );
    if (fixable.length > 0) {
      log("Fixes:");
      for (const c of fixable) {
        try {
          const desc = c.fix();
          fixed.push(desc);
          logSuccess(`  ${desc}`);
        } catch (err) {
          logWarn(
            `  Failed to fix ${c.name}: ${err instanceof Error ? err.message : String(err)}`
          );
        }
      }
      log("");
      log("Re-verifying...");
      finalChecks = runAllChecks();
      const postFails = finalChecks.filter((c) => c.status === "fail").length;
      const postWarns = finalChecks.filter((c) => c.status === "warn").length;
      log(
        `  ${postFails === 0 ? "All clear" : `${postFails} remaining failures, ${postWarns} warnings`}`
      );
    } else {
      log("Nothing to fix.");
    }
  }
  const passes = finalChecks.filter((c) => c.status === "pass").length;
  const warns = finalChecks.filter((c) => c.status === "warn").length;
  const fails = finalChecks.filter((c) => c.status === "fail").length;
  log("");
  log(
    `${finalChecks.length} checks: ${passes} passed, ${warns} warnings, ${fails} failures` + (fixed.length > 0 ? ` (${fixed.length} fixed)` : "")
  );
  return {
    ok: fails === 0,
    command: "doctor",
    code: fails === 0 ? "TAP_STATUS_OK" : "TAP_VERIFY_FAILED",
    message: `${passes} passed, ${warns} warnings, ${fails} failures`,
    warnings: finalChecks.filter((c) => c.status === "warn").map((c) => `${c.name}: ${c.message}`),
    data: {
      checks: finalChecks.map(({ fix: _fix, ...rest }) => rest),
      summary: { total: finalChecks.length, passes, warns, fails },
      fixed
    }
  };
}

// src/commands/comms.ts
init_utils();
import { execSync as execSync6, spawnSync as spawnSync7 } from "child_process";
import * as fs31 from "fs";
import * as path32 from "path";
var COMMS_HELP = `
Usage:
  tap comms <subcommand>

Subcommands:
  pull    Pull latest changes from comms remote repo
  push    Commit and push comms changes to remote repo

Examples:
  npx @hua-labs/tap comms pull
  npx @hua-labs/tap comms push
`.trim();
function isGitRepo(dir) {
  return fs31.existsSync(path32.join(dir, ".git"));
}
function commsPull(commsDir) {
  logHeader("tap comms pull");
  if (!isGitRepo(commsDir)) {
    logError(`${commsDir} is not a git repository`);
    return {
      ok: false,
      command: "comms",
      code: "TAP_COMMS_NOT_REPO",
      message: `Comms directory is not a git repo. Use 'tap init --comms-repo <url>' to set up.`,
      warnings: [],
      data: { commsDir }
    };
  }
  try {
    const output = execSync6("git pull --rebase", {
      cwd: commsDir,
      encoding: "utf-8",
      stdio: "pipe"
    });
    logSuccess("Comms pull complete");
    if (output.trim()) log(output.trim());
    return {
      ok: true,
      command: "comms",
      code: "TAP_COMMS_PULL_OK",
      message: "Comms pull complete",
      warnings: [],
      data: { commsDir }
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logError(`Pull failed: ${msg}`);
    return {
      ok: false,
      command: "comms",
      code: "TAP_COMMS_PULL_FAILED",
      message: `Pull failed: ${msg}`,
      warnings: [],
      data: { commsDir }
    };
  }
}
function commsPush(commsDir) {
  logHeader("tap comms push");
  if (!isGitRepo(commsDir)) {
    logError(`${commsDir} is not a git repository`);
    return {
      ok: false,
      command: "comms",
      code: "TAP_COMMS_NOT_REPO",
      message: `Comms directory is not a git repo. Use 'tap init --comms-repo <url>' to set up.`,
      warnings: [],
      data: { commsDir }
    };
  }
  try {
    execSync6("git add -A", { cwd: commsDir, stdio: "pipe" });
    const status = execSync6("git status --porcelain", {
      cwd: commsDir,
      encoding: "utf-8",
      stdio: "pipe"
    }).trim();
    if (!status) {
      log("Nothing to push \u2014 comms directory is clean");
      return {
        ok: true,
        command: "comms",
        code: "TAP_COMMS_PUSH_OK",
        message: "Nothing to push",
        warnings: [],
        data: { commsDir, changed: false }
      };
    }
    const timestamp = (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-");
    const commitResult = spawnSync7(
      "git",
      ["commit", "-m", `chore(comms): sync ${timestamp}`],
      { cwd: commsDir, stdio: "pipe", encoding: "utf-8" }
    );
    if (commitResult.status !== 0) {
      const msg = commitResult.stderr || `git commit exited with code ${commitResult.status}`;
      return {
        ok: false,
        command: "comms",
        code: "TAP_COMMS_PUSH_FAILED",
        message: `Commit failed: ${msg}`,
        warnings: [],
        data: { commsDir }
      };
    }
    execSync6("git push", { cwd: commsDir, stdio: "pipe" });
    logSuccess("Comms push complete");
    return {
      ok: true,
      command: "comms",
      code: "TAP_COMMS_PUSH_OK",
      message: "Comms push complete",
      warnings: [],
      data: { commsDir, changed: true }
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logError(`Push failed: ${msg}`);
    return {
      ok: false,
      command: "comms",
      code: "TAP_COMMS_PUSH_FAILED",
      message: `Push failed: ${msg}`,
      warnings: [],
      data: { commsDir }
    };
  }
}
async function commsCommand(args) {
  const subcommand = args[0];
  if (!subcommand || subcommand === "--help" || subcommand === "-h") {
    log(COMMS_HELP);
    return {
      ok: true,
      command: "comms",
      code: "TAP_NO_OP",
      message: COMMS_HELP,
      warnings: [],
      data: {}
    };
  }
  const repoRoot = findRepoRoot();
  const commsDir = resolveCommsDir(args, repoRoot);
  switch (subcommand) {
    case "pull":
      return commsPull(commsDir);
    case "push":
      return commsPush(commsDir);
    default:
      return {
        ok: false,
        command: "comms",
        code: "TAP_INVALID_ARGUMENT",
        message: `Unknown comms subcommand: ${subcommand}. Use pull or push.`,
        warnings: [],
        data: {}
      };
  }
}

// src/commands/watch.ts
init_utils();
var WATCH_HELP = `
Usage:
  tap watch [options]

Description:
  Monitor all bridges and auto-restart stuck/stale ones.
  Single-pass by default. Use --loop for continuous monitoring.

Options:
  --stuck-threshold <seconds>  Turn stuck threshold (default: 300)
  --interval <seconds>         Loop interval (default: 60)
  --loop                       Run continuously instead of single-pass
  --max-rounds <n>             Max loop iterations (default: unlimited)

Examples:
  npx @hua-labs/tap watch                          # single check
  npx @hua-labs/tap watch --loop                   # continuous
  npx @hua-labs/tap watch --loop --interval 30     # check every 30s
  npx @hua-labs/tap watch --stuck-threshold 120    # 2 min threshold
`.trim();
function delay2(ms) {
  return new Promise((resolve15) => setTimeout(resolve15, ms));
}
async function watchCommand(args) {
  const { flags } = parseArgs(args);
  if (flags["help"] === true || flags["h"] === true) {
    log(WATCH_HELP);
    return {
      ok: true,
      command: "watch",
      code: "TAP_NO_OP",
      message: WATCH_HELP,
      warnings: [],
      data: {}
    };
  }
  const stuckThresholdStr = typeof flags["stuck-threshold"] === "string" ? flags["stuck-threshold"] : void 0;
  const intervalStr = typeof flags["interval"] === "string" ? flags["interval"] : void 0;
  const loop = flags["loop"] === true;
  const maxRoundsStr = typeof flags["max-rounds"] === "string" ? flags["max-rounds"] : void 0;
  let stuckThreshold;
  let interval;
  let maxRounds;
  try {
    stuckThreshold = parseIntFlag(stuckThresholdStr, "--stuck-threshold", 30, 3600) ?? 300;
    interval = parseIntFlag(intervalStr, "--interval", 5, 3600) ?? 60;
    maxRounds = parseIntFlag(maxRoundsStr, "--max-rounds", 1, 1e4) ?? null;
  } catch (err) {
    return {
      ok: false,
      command: "watch",
      code: "TAP_INVALID_ARGUMENT",
      message: err instanceof Error ? err.message : String(err),
      warnings: [],
      data: {}
    };
  }
  const bridgeArgs = ["watch", "--stuck-threshold", String(stuckThreshold)];
  if (!loop) {
    return bridgeCommand(bridgeArgs);
  }
  logHeader("@hua-labs/tap watch (loop mode)");
  log(`Interval: ${interval}s, Stuck threshold: ${stuckThreshold}s`);
  if (maxRounds != null) {
    log(`Max rounds: ${maxRounds}`);
  }
  log("");
  let round = 0;
  let failedRounds = 0;
  const allRestarted = [];
  const allWarnings = [];
  while (maxRounds == null || round < maxRounds) {
    round++;
    const timestamp = (/* @__PURE__ */ new Date()).toISOString().slice(11, 19);
    log(`[${timestamp}] Round ${round}`);
    const result = await bridgeCommand(bridgeArgs);
    if (!result.ok) {
      failedRounds++;
      allWarnings.push(`Round ${round}: ${result.message}`);
    }
    if (result.data?.restarted) {
      const restarted = result.data.restarted;
      allRestarted.push(...restarted);
    }
    if (result.warnings?.length) {
      allWarnings.push(...result.warnings);
    }
    if (maxRounds != null && round >= maxRounds) break;
    await delay2(interval * 1e3);
  }
  const allOk = failedRounds === 0;
  const message = [
    `Completed ${round} round(s)`,
    failedRounds > 0 ? `${failedRounds} failed` : null,
    allRestarted.length > 0 ? `Total restarts: ${allRestarted.length} (${allRestarted.join(", ")})` : "No restarts needed"
  ].filter(Boolean).join(". ");
  return {
    ok: allOk,
    command: "watch",
    code: !allOk ? "TAP_WATCH_FAILED" : allRestarted.length > 0 ? "TAP_WATCH_RESTARTED" : "TAP_WATCH_OK",
    message,
    warnings: allWarnings,
    data: { rounds: round, restarted: allRestarted }
  };
}

// src/commands/gui.ts
import * as http from "http";

// src/engine/missions.ts
import * as fs32 from "fs";
import * as path33 from "path";
function parseStatus(raw) {
  const trimmed = raw.trim();
  if (trimmed.includes("active")) return "active";
  if (trimmed.includes("completed")) return "completed";
  return "planned";
}
function parseRow(line) {
  if (!line.startsWith("|") || !line.endsWith("|")) return null;
  const cells = line.split("|").slice(1, -1).map((c) => c.trim());
  if (cells.length < 4) return null;
  const [idCell, missionCell, branchCell, statusCell, ownerCell] = cells;
  if (/^[-: ]+$/.test(idCell ?? "")) return null;
  const id = (idCell ?? "").replace(/[^\w]/g, "");
  if (!id || !/^M\d+$/i.test(id)) return null;
  const titleMatch = missionCell?.match(/\[([^\]]+)\]/);
  const title = titleMatch ? titleMatch[1] : (missionCell ?? "").trim();
  if (!title) return null;
  const branchMatch = branchCell?.match(/`([^`]+)`/);
  const branch = branchMatch ? branchMatch[1] : null;
  const status = parseStatus(statusCell ?? "");
  const rawOwner = (ownerCell ?? "").trim();
  const owner = rawOwner === "" || rawOwner === "\u2014" || rawOwner === "\uBBF8\uBC30\uC815" ? null : rawOwner;
  return { id: id.toUpperCase(), title, branch, status, owner };
}
function parseMissionsFile(repoRoot) {
  const missionsPath = path33.join(repoRoot, "docs", "missions", "MISSIONS.md");
  let content;
  try {
    content = fs32.readFileSync(missionsPath, "utf-8");
  } catch {
    return [];
  }
  const missions = [];
  for (const line of content.split("\n")) {
    const mission = parseRow(line);
    if (!mission) continue;
    missions.push(mission);
  }
  return missions;
}

// src/engine/pull-requests.ts
import { spawnSync as spawnSync8 } from "child_process";
function runGhPrList(repoRoot, extraArgs) {
  try {
    const result = spawnSync8(
      "gh",
      [
        "pr",
        "list",
        "--json",
        "number,title,state,author,headRefName,url,mergedAt",
        ...extraArgs
      ],
      { cwd: repoRoot, encoding: "utf-8", timeout: 1e4 }
    );
    if (result.error || result.status !== 0) return null;
    const raw = result.stdout.trim();
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
function mapEntry(entry) {
  const state = entry.state?.toLowerCase();
  return {
    number: entry.number,
    title: entry.title ?? "",
    state: state === "merged" ? "merged" : state === "closed" ? "closed" : "open",
    author: entry.author?.login ?? "",
    branch: entry.headRefName ?? "",
    url: entry.url ?? "",
    mergedAt: entry.mergedAt ?? null
  };
}
function fetchOpenPrs(repoRoot) {
  const entries = runGhPrList(repoRoot, ["--limit", "50"]);
  if (!entries) return [];
  return entries.map(mapEntry);
}
function fetchMergedPrs(repoRoot, limit = 20) {
  const entries = runGhPrList(repoRoot, [
    "--state",
    "merged",
    "--limit",
    String(limit)
  ]);
  if (!entries) return [];
  return entries.map(mapEntry).sort((a, b) => {
    if (!a.mergedAt || !b.mergedAt) return 0;
    return new Date(b.mergedAt).getTime() - new Date(a.mergedAt).getTime();
  });
}
function fetchPrs(repoRoot) {
  return {
    open: fetchOpenPrs(repoRoot),
    merged: fetchMergedPrs(repoRoot)
  };
}

// src/commands/gui.ts
init_config();
init_utils();
var GUI_HELP = `
Usage:
  tap gui [options]

Description:
  Start a local web dashboard showing bridge status, agents, and turn info.

Options:
  --port <n>    Dashboard port (default: 3847)
  --help, -h    Show help

Examples:
  npx @hua-labs/tap gui
  npx @hua-labs/tap gui --port 8080
`.trim();
function esc(str) {
  if (!str) return "-";
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function buildHtml(snapshot, turnData) {
  const agentRows = snapshot.agents.map(
    (a) => `<tr><td>${esc(a.name)}</td><td class="${a.presence === "bridge-live" ? "ok" : a.presence === "bridge-stale" ? "warn" : "off"}">${esc(a.presence)}</td><td>${esc(a.lifecycle ?? "-")}</td><td>${a.lastActivity ? esc(new Date(a.lastActivity).toLocaleTimeString()) : "-"}</td></tr>`
  ).join("\n");
  const bridgeRows = snapshot.bridges.map((b) => {
    const turn = turnData[b.instanceId];
    const turnCell = turn?.activeTurnId ? `<span class="${turn.stuck ? "stuck" : "ok"}">${esc(turn.activeTurnId.slice(0, 8))}... ${turn.stuck ? "\u26A0 STUCK" : ""} ${turn.ageSeconds != null ? `(${turn.ageSeconds}s)` : ""}</span>` : "-";
    const statusClass = b.status === "running" ? "ok" : b.status === "stale" ? "stuck" : "off";
    return `<tr><td>${esc(b.instanceId)}</td><td>${esc(b.runtime)}</td><td class="${statusClass}">${esc(b.status)}</td><td>${b.pid ?? "-"}</td><td>${b.port ?? "-"}</td><td>${b.heartbeatAge != null ? `${b.heartbeatAge}s ago` : "-"}</td><td>${turnCell}</td></tr>`;
  }).join("\n");
  const warningRows = snapshot.warnings.map(
    (w) => `<tr><td class="warn">${esc(w.level)}</td><td>${esc(w.message)}</td></tr>`
  ).join("\n");
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>tap dashboard</title>
<style>
  body { font-family: system-ui, -apple-system, sans-serif; background: #0d1117; color: #c9d1d9; margin: 0; padding: 20px; }
  h1 { color: #58a6ff; font-size: 1.4em; }
  h2 { color: #8b949e; font-size: 1.1em; margin-top: 24px; }
  table { border-collapse: collapse; width: 100%; margin: 8px 0; }
  th, td { text-align: left; padding: 6px 12px; border-bottom: 1px solid #21262d; }
  th { color: #8b949e; font-size: 0.85em; text-transform: uppercase; }
  .ok { color: #3fb950; }
  .warn { color: #d29922; }
  .stuck { color: #f85149; font-weight: bold; }
  .off { color: #8b949e; }
  .meta { color: #8b949e; font-size: 0.85em; }
  .refresh { color: #8b949e; font-size: 0.8em; margin-top: 16px; }
</style>
</head>
<body>
<h1>tap dashboard</h1>
<p class="meta">${esc(snapshot.generatedAt)} &middot; ${esc(snapshot.repoRoot)}</p>

<h2>Agents</h2>
<table>
<tr><th>Name</th><th>Presence</th><th>Lifecycle</th><th>Last Activity</th></tr>
${agentRows || '<tr><td colspan="4" class="off">No agents</td></tr>'}
</table>

<h2>Bridges</h2>
<table>
<tr><th>Instance</th><th>Runtime</th><th>Status</th><th>PID</th><th>Port</th><th>Heartbeat</th><th>Turn</th></tr>
${bridgeRows || '<tr><td colspan="7" class="off">No bridges</td></tr>'}
</table>

${warningRows ? `<h2>Warnings</h2><table><tr><th>Level</th><th>Message</th></tr>${warningRows}</table>` : ""}

<p class="refresh" id="status">Connecting to live updates...</p>
<script>
const es = new EventSource('/api/events');
const statusEl = document.getElementById('status');
let lastReloadAt = Date.now();
es.onmessage = (e) => {
  statusEl.textContent = 'Live \u2014 updated ' + new Date().toLocaleTimeString();
  statusEl.style.color = '#3fb950';
  const elapsed = Date.now() - lastReloadAt;
  if (elapsed >= 9000) { lastReloadAt = Date.now(); location.reload(); }
};
es.onerror = () => {
  statusEl.textContent = 'Disconnected \u2014 will retry...';
  statusEl.style.color = '#f85149';
};
</script>
<p class="refresh"><a href="/missions" style="color:#58a6ff;">Mission Kanban</a> &middot; <a href="/prs" style="color:#58a6ff;">PR Board</a></p>
</body>
</html>`;
}
function buildMissionsHtml(repoRoot) {
  const missions = parseMissionsFile(repoRoot);
  const byStatus = {
    active: missions.filter((m) => m.status === "active"),
    planned: missions.filter((m) => m.status === "planned"),
    completed: missions.filter((m) => m.status === "completed")
  };
  function card(m) {
    return `<div class="card">
  <div class="card-id">${esc(m.id)}</div>
  <div class="card-title">${esc(m.title)}</div>
  ${m.owner ? `<div class="card-meta">Owner: ${esc(m.owner)}</div>` : ""}
  ${m.branch ? `<div class="card-meta card-branch">${esc(m.branch)}</div>` : ""}
</div>`;
  }
  function column(label, headerClass, items) {
    return `<div class="column">
  <div class="col-header ${headerClass}">${label} <span class="badge">${items.length}</span></div>
  <div class="col-body">
    ${items.length ? items.map(card).join("\n    ") : '<div class="empty">No missions</div>'}
  </div>
</div>`;
  }
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>tap \u2014 mission kanban</title>
<meta http-equiv="refresh" content="30">
<style>
  body { font-family: system-ui, -apple-system, sans-serif; background: #0d1117; color: #c9d1d9; margin: 0; padding: 20px; }
  h1 { color: #58a6ff; font-size: 1.4em; }
  a { color: #58a6ff; text-decoration: none; }
  a:hover { text-decoration: underline; }
  .meta { color: #8b949e; font-size: 0.85em; }
  .refresh { color: #8b949e; font-size: 0.8em; margin-top: 16px; }
  .board { display: flex; gap: 16px; margin-top: 16px; align-items: flex-start; flex-wrap: wrap; }
  .column { flex: 1; min-width: 240px; background: #161b22; border: 1px solid #21262d; border-radius: 6px; overflow: hidden; }
  .col-header { padding: 10px 14px; font-size: 0.85em; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; display: flex; justify-content: space-between; align-items: center; }
  .col-header.active { color: #3fb950; border-bottom: 2px solid #3fb950; }
  .col-header.planned { color: #d29922; border-bottom: 2px solid #d29922; }
  .col-header.completed { color: #8b949e; border-bottom: 2px solid #8b949e; }
  .badge { background: #21262d; color: #c9d1d9; border-radius: 10px; padding: 1px 7px; font-size: 0.8em; }
  .col-body { padding: 8px; display: flex; flex-direction: column; gap: 8px; }
  .card { background: #0d1117; border: 1px solid #21262d; border-radius: 4px; padding: 10px 12px; }
  .card-id { font-size: 0.75em; color: #58a6ff; font-weight: 600; margin-bottom: 4px; }
  .card-title { font-size: 0.9em; color: #e6edf3; line-height: 1.4; }
  .card-meta { font-size: 0.75em; color: #8b949e; margin-top: 4px; }
  .card-branch { font-family: ui-monospace, monospace; color: #6e7681; }
  .empty { color: #6e7681; font-size: 0.85em; padding: 8px 4px; }
</style>
</head>
<body>
<h1>mission kanban</h1>
<p class="meta"><a href="/">&larr; Dashboard</a> &middot; ${esc(repoRoot)}</p>
<div class="board">
  ${column("Active", "active", byStatus.active)}
  ${column("Planned", "planned", byStatus.planned)}
  ${column("Completed", "completed", byStatus.completed)}
</div>
<p class="refresh">Auto-refresh every 30s</p>
</body>
</html>`;
}
function buildPrsHtml(repoRoot) {
  const { open, merged } = fetchPrs(repoRoot);
  function prRow(pr) {
    return `<tr>
  <td><a href="${esc(pr.url)}" target="_blank" rel="noopener" style="color:#58a6ff;">#${pr.number}</a></td>
  <td>${esc(pr.title)}</td>
  <td>${esc(pr.author)}</td>
  <td class="branch">${esc(pr.branch)}</td>
</tr>`;
  }
  const openRows = open.map(prRow).join("\n");
  const mergedRows = merged.map(
    (pr) => `<tr>
  <td><a href="${esc(pr.url)}" target="_blank" rel="noopener" style="color:#58a6ff;">#${pr.number}</a></td>
  <td>${esc(pr.title)}</td>
  <td>${esc(pr.author)}</td>
</tr>`
  ).join("\n");
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>tap \u2014 pr board</title>
<meta http-equiv="refresh" content="60">
<style>
  body { font-family: system-ui, -apple-system, sans-serif; background: #0d1117; color: #c9d1d9; margin: 0; padding: 20px; }
  h1 { color: #58a6ff; font-size: 1.4em; }
  h2 { color: #8b949e; font-size: 1.1em; margin-top: 24px; }
  a { color: #58a6ff; text-decoration: none; }
  a:hover { text-decoration: underline; }
  table { border-collapse: collapse; width: 100%; margin: 8px 0; }
  th, td { text-align: left; padding: 6px 12px; border-bottom: 1px solid #21262d; }
  th { color: #8b949e; font-size: 0.85em; text-transform: uppercase; }
  .branch { font-family: ui-monospace, monospace; font-size: 0.85em; color: #6e7681; }
  .meta { color: #8b949e; font-size: 0.85em; }
  .refresh { color: #8b949e; font-size: 0.8em; margin-top: 16px; }
  .off { color: #8b949e; }
</style>
</head>
<body>
<h1>pr board</h1>
<p class="meta"><a href="/">&larr; Dashboard</a> &middot; ${esc(repoRoot)}</p>

<h2>Open PRs <span style="color:#3fb950;">(${open.length})</span></h2>
<table>
<tr><th>#</th><th>Title</th><th>Author</th><th>Branch</th></tr>
${openRows || '<tr><td colspan="4" class="off">No open PRs</td></tr>'}
</table>

<h2>Recently Merged <span style="color:#8b949e;">(${merged.length})</span></h2>
<table>
<tr><th>#</th><th>Title</th><th>Author</th></tr>
${mergedRows || '<tr><td colspan="3" class="off">No merged PRs</td></tr>'}
</table>

<p class="refresh">Auto-refresh every 60s</p>
</body>
</html>`;
}
async function guiCommand(args) {
  const { flags } = parseArgs(args);
  if (flags["help"] === true || flags["h"] === true) {
    log(GUI_HELP);
    return {
      ok: true,
      command: "gui",
      code: "TAP_NO_OP",
      message: GUI_HELP,
      warnings: [],
      data: {}
    };
  }
  const portStr = typeof flags["port"] === "string" ? flags["port"] : void 0;
  let port;
  try {
    port = parseIntFlag(portStr, "--port", 1024, 65535) ?? 3847;
  } catch (err) {
    return {
      ok: false,
      command: "gui",
      code: "TAP_INVALID_ARGUMENT",
      message: err instanceof Error ? err.message : String(err),
      warnings: [],
      data: {}
    };
  }
  const repoRoot = findRepoRoot();
  const server = http.createServer((req, res) => {
    const snapshot = collectDashboardSnapshot(repoRoot);
    const state = loadState(repoRoot);
    const { config } = resolveConfig({}, repoRoot);
    const turnData = {};
    if (state) {
      for (const [id, inst] of Object.entries(state.instances)) {
        if (!inst?.installed || inst.bridgeMode !== "app-server") continue;
        turnData[id] = getTurnInfo(config.stateDir, id);
      }
    }
    const jsonHeaders = {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*"
    };
    if (req.url === "/api/snapshot") {
      res.writeHead(200, jsonHeaders);
      res.end(JSON.stringify({ ...snapshot, turns: turnData }, null, 2));
      return;
    }
    if (req.url === "/api/events") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "Access-Control-Allow-Origin": "*"
      });
      const sendEvent = () => {
        const s = collectDashboardSnapshot(repoRoot);
        const st = loadState(repoRoot);
        const cfg = resolveConfig({}, repoRoot).config;
        const td = {};
        if (st) {
          for (const [id, inst] of Object.entries(st.instances)) {
            if (!inst?.installed || inst.bridgeMode !== "app-server") continue;
            td[id] = getTurnInfo(cfg.stateDir, id);
          }
        }
        res.write(`data: ${JSON.stringify({ ...s, turns: td })}

`);
      };
      sendEvent();
      const interval = setInterval(sendEvent, 5e3);
      req.on("close", () => clearInterval(interval));
      return;
    }
    if (req.url === "/api/missions") {
      const missions = parseMissionsFile(repoRoot);
      res.writeHead(200, jsonHeaders);
      res.end(JSON.stringify(missions, null, 2));
      return;
    }
    if (req.url === "/missions") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(buildMissionsHtml(repoRoot));
      return;
    }
    if (req.url === "/api/prs") {
      const prs = fetchPrs(repoRoot);
      res.writeHead(200, jsonHeaders);
      res.end(JSON.stringify(prs, null, 2));
      return;
    }
    if (req.url === "/prs") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(buildPrsHtml(repoRoot));
      return;
    }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(buildHtml(snapshot, turnData));
  });
  return new Promise((resolve15) => {
    server.on("error", (err) => {
      if (err.code === "EADDRINUSE") {
        resolve15({
          ok: false,
          command: "gui",
          code: "TAP_PORT_IN_USE",
          message: `Port ${port} is already in use. Try: tap gui --port <other>`,
          warnings: [],
          data: {}
        });
      } else {
        resolve15({
          ok: false,
          command: "gui",
          code: "TAP_GUI_ERROR",
          message: err.message,
          warnings: [],
          data: {}
        });
      }
    });
    server.listen(port, "127.0.0.1", () => {
      logHeader("tap gui dashboard");
      logSuccess(`Dashboard: http://127.0.0.1:${port}`);
      log(`API:       http://127.0.0.1:${port}/api/snapshot`);
      log("Press Ctrl+C to stop");
    });
  });
}

// src/output.ts
init_utils();
function emitResult(result, jsonMode) {
  if (jsonMode) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (result.ok) {
    logSuccess(result.message);
  } else {
    logError(result.message);
  }
  const emittedWarnings = /* @__PURE__ */ new Set();
  for (const w of result.warnings) {
    if (emittedWarnings.has(w) || wasWarningLogged(w)) {
      continue;
    }
    emittedWarnings.add(w);
    logWarn(w);
  }
}
function exitCode(result) {
  return result.ok ? 0 : 1;
}
function extractJsonFlag(args) {
  const jsonMode = args.includes("--json");
  const cleanArgs = args.filter((a) => a !== "--json");
  return { jsonMode, cleanArgs };
}

// src/cli.ts
init_utils();

// src/cli-suggest.ts
var COMMANDS = [
  "init",
  "init-worktree",
  "add",
  "remove",
  "status",
  "bridge",
  "up",
  "down",
  "comms",
  "dashboard",
  "doctor",
  "serve",
  "version"
];
function suggestCommand(input) {
  let best = null;
  let bestDist = Infinity;
  for (const cmd of COMMANDS) {
    const d = levenshtein(input.toLowerCase(), cmd);
    if (d < bestDist && d <= Math.max(2, Math.floor(cmd.length / 2))) {
      bestDist = d;
      best = cmd;
    }
  }
  return best;
}
function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  const dp = Array.from(
    { length: m + 1 },
    () => Array.from({ length: n + 1 }).fill(0)
  );
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

// src/cli.ts
var HELP = `
@hua-labs/tap \u2014 Cross-model AI agent communication setup

Usage:
  tap <command> [options]

Commands:
  init                  Initialize comms directory and state
  init-worktree         Set up a new git worktree with tap
  add <runtime>         Add a runtime instance (claude, codex, gemini)
  remove <instance>     Remove an instance and rollback config
  status                Show installed instances and bridge status
  bridge <sub> [inst]   Manage bridges (start, stop, status)
  up                    Start all registered bridge daemons
  down                  Stop all running bridge daemons
  comms <pull|push>     Sync comms directory with remote repo
  dashboard             Show unified ops dashboard
  watch                 Monitor bridges and auto-restart stuck ones
  gui                   Start local web dashboard (http)
  doctor                Diagnose tap infrastructure health
  serve                 Start tap MCP server (stdio)
  version               Show version

Options:
  --help, -h            Show help
  --json                Machine-readable JSON output
  --comms-dir <path>    Override comms directory path

Examples:
  npx @hua-labs/tap init
  npx @hua-labs/tap init-worktree --path ../hua-wt-3 --branch feat/my-feature
  npx @hua-labs/tap add claude
  npx @hua-labs/tap add codex --name reviewer --port 4501
  npx @hua-labs/tap status
`.trim();
function normalizeCommandName(command) {
  switch (command) {
    case "init":
    case "init-worktree":
    case "add":
    case "remove":
    case "status":
    case "bridge":
    case "up":
    case "down":
    case "comms":
    case "dashboard":
    case "doctor":
    case "serve":
    case "watch":
    case "gui":
      return command;
    default:
      return "unknown";
  }
}
async function main() {
  const rawArgs = process.argv.slice(2);
  const { jsonMode, cleanArgs } = extractJsonFlag(rawArgs);
  resetLoggedWarnings();
  setJsonMode(jsonMode);
  const command = cleanArgs[0];
  if (!command || command === "--help" || command === "-h") {
    if (jsonMode) {
      console.log(JSON.stringify({ help: HELP }));
    } else {
      console.log(HELP);
    }
    process.exit(0);
  }
  if (command === "version" || command === "--version" || command === "-v") {
    if (jsonMode) {
      console.log(JSON.stringify({ version }));
    } else {
      console.log(`@hua-labs/tap v${version}`);
    }
    process.exit(0);
  }
  const commandArgs = cleanArgs.slice(1);
  let result;
  try {
    switch (command) {
      case "init":
        result = await initCommand(commandArgs);
        break;
      case "init-worktree":
        result = await initWorktreeCommand(commandArgs);
        break;
      case "add":
        result = await addCommand(commandArgs);
        break;
      case "remove":
        result = await removeCommand(commandArgs);
        break;
      case "status":
        result = await statusCommand(commandArgs);
        break;
      case "bridge":
        result = await bridgeCommand(commandArgs);
        break;
      case "up":
        result = await upCommand(commandArgs);
        break;
      case "down":
        result = await downCommand(commandArgs);
        break;
      case "comms":
        result = await commsCommand(commandArgs);
        break;
      case "dashboard":
        result = await dashboardCommand(commandArgs);
        break;
      case "doctor":
        result = await doctorCommand(commandArgs);
        break;
      case "watch":
        result = await watchCommand(commandArgs);
        break;
      case "gui":
        result = await guiCommand(commandArgs);
        break;
      case "serve": {
        const serveResult = await serveCommand(commandArgs);
        if (!serveResult.ok || serveResult.code === "TAP_NO_OP") {
          emitResult(serveResult, jsonMode);
        }
        process.exit(exitCode(serveResult));
        break;
      }
      default: {
        const suggestion = suggestCommand(command);
        const hint = suggestion ? `

Did you mean: tap ${suggestion}?` : "\n\nRun tap --help for a list of commands.";
        result = {
          ok: false,
          command: "unknown",
          code: "TAP_INVALID_ARGUMENT",
          message: `Unknown command: ${command}${hint}`,
          warnings: [],
          data: { requestedCommand: command, suggestion }
        };
        break;
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    result = {
      ok: false,
      command: normalizeCommandName(command),
      code: "TAP_INTERNAL_ERROR",
      message,
      warnings: [],
      data: command ? { requestedCommand: command } : {}
    };
  }
  emitResult(result, jsonMode);
  process.exit(exitCode(result));
}
main();
//# sourceMappingURL=cli.mjs.map