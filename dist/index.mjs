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
var VALID_RUNTIMES, _noGitWarned, _jsonMode;
var init_utils = __esm({
  "src/utils.ts"() {
    "use strict";
    init_config();
    VALID_RUNTIMES = ["claude", "codex", "gemini"];
    _noGitWarned = false;
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
  if (!fs4.existsSync(statePath)) return null;
  const raw = fs4.readFileSync(statePath, "utf-8");
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
  const basename2 = path4.basename(filePath);
  const hash = fileHash(filePath);
  const backupPath = path4.join(backupDir, `${basename2}.${hash}.bak`);
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
  return new Promise((resolve12) => setTimeout(resolve12, ms));
}
function isLoopbackHost(hostname) {
  return hostname === "127.0.0.1" || hostname === "localhost";
}
async function allocateLoopbackPort(hostname) {
  const bindHost = hostname === "localhost" ? "127.0.0.1" : hostname;
  return await new Promise((resolve12, reject) => {
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
        resolve12(port);
      });
    });
  });
}
async function isTcpPortAvailable(hostname, port) {
  const bindHost = hostname === "localhost" ? "127.0.0.1" : hostname;
  return await new Promise((resolve12) => {
    const server = net.createServer();
    server.unref();
    server.once("error", () => resolve12(false));
    server.listen(port, bindHost, () => {
      server.close((error) => resolve12(!error));
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
function updateBridgeHeartbeat(stateDir, instanceId) {
  const state = loadBridgeState(stateDir, instanceId);
  if (!state) return;
  if (state.pid !== process.pid) return;
  state.lastHeartbeat = (/* @__PURE__ */ new Date()).toISOString();
  saveBridgeState(stateDir, instanceId, state);
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
function probeCommand(candidates) {
  for (const candidate of candidates) {
    const result = spawnSync2(candidate, ["--version"], {
      encoding: "utf-8",
      shell: process.platform === "win32"
    });
    if (result.status === 0) {
      const version2 = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim() || null;
      const absolutePath = resolveCommandPath(candidate);
      return { command: absolutePath ?? candidate, version: version2 };
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
    const result = spawnSync2(candidate, ["--version"], {
      encoding: "utf-8",
      shell: process.platform === "win32"
    });
    if (result.status === 0) {
      return path10.isAbsolute(candidate) ? toForwardSlashPath(candidate) : candidate;
    }
  }
  return null;
}
function buildManagedMcpServerSpec(ctx, instanceId) {
  const sourcePath = findTapCommsServerEntry(ctx);
  const bunCommand = findPreferredBunCommand();
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
  let command = null;
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
    command = bunCommand;
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
  const scriptRelative = match[1].replace(/%dp0%\\/g, "");
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
function resolveAuthGatewayScript(repoRoot) {
  const moduleDir = path11.dirname(fileURLToPath3(import.meta.url));
  const resolvedModuleDir = path11.resolve(moduleDir);
  const resolvedRepoRoot = path11.resolve(repoRoot);
  const candidates = [
    // Bundled: dist/bridges/ sibling (npm install / built package)
    path11.join(moduleDir, "bridges", "codex-app-server-auth-gateway.mjs"),
    // Source: src/bridges/ sibling (monorepo dev with ts runner)
    path11.join(moduleDir, "bridges", "codex-app-server-auth-gateway.ts"),
    // Monorepo dist fallback
    path11.join(
      repoRoot,
      "packages",
      "tap-comms",
      "dist",
      "bridges",
      "codex-app-server-auth-gateway.mjs"
    ),
    path11.join(
      repoRoot,
      "packages",
      "tap-comms",
      "src",
      "bridges",
      "codex-app-server-auth-gateway.ts"
    )
  ];
  for (const candidate of candidates) {
    const resolved = path11.resolve(candidate);
    if (!resolved.startsWith(resolvedModuleDir + path11.sep) && !resolved.startsWith(resolvedRepoRoot + path11.sep)) {
      continue;
    }
    if (fs11.existsSync(resolved)) {
      return resolved;
    }
  }
  return null;
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
function startWindowsDetachedProcess(command, args, repoRoot, logPath, env = process.env) {
  const stderrLogPath = stderrLogFilePath(logPath);
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
function startWindowsCodexAppServer(command, url, repoRoot, logPath) {
  const { command: exe, prefixArgs } = splitResolvedCommand(command);
  return startWindowsDetachedProcess(
    exe,
    [...prefixArgs, "app-server", "--listen", url],
    repoRoot,
    logPath
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
function startUnixCodexAppServer(command, url, repoRoot, logPath, platform = DEFAULT_UNIX_PLATFORM) {
  const { command: exe, prefixArgs } = splitResolvedCommand(command);
  return startUnixDetachedProcess(
    exe,
    [...prefixArgs, "app-server", "--listen", url],
    repoRoot,
    logPath,
    process.env,
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
var init_bridge_config = __esm({
  "src/engine/bridge-config.ts"() {
    "use strict";
    init_state();
    init_instance_config();
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
  const WebSocket = getWebSocketCtor();
  if (!WebSocket) {
    return false;
  }
  return new Promise((resolve12) => {
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
      resolve12(healthy);
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
  return new Promise((resolve12) => {
    const socket = net2.createConnection({ host: hostname, port });
    const timer = setTimeout(() => {
      socket.destroy();
      resolve12(false);
    }, timeoutMs);
    socket.once("connect", () => {
      clearTimeout(timer);
      socket.destroy();
      resolve12(true);
    });
    socket.once("error", () => {
      clearTimeout(timer);
      socket.destroy();
      resolve12(false);
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
  fs18.mkdirSync(path17.dirname(logPath), { recursive: true });
  rotateLog(logPath);
  if (options.noAuth) {
    const manualCommand2 = formatCodexAppServerCommand("codex", effectiveUrl);
    let pid2;
    if (options.platform === "win32") {
      try {
        pid2 = startWindowsCodexAppServer(
          resolvedCommand,
          effectiveUrl,
          options.repoRoot,
          logPath
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
        logPath
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
        options.platform
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
function formatCodexAppServerCommand(command, url) {
  return `${command} app-server --listen ${url}`;
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
      store = JSON.parse(
        fs19.readFileSync(heartbeatsPath, "utf-8")
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
  if (runtime === "codex" && options.manageAppServer) {
    appServer = await ensureCodexAppServer({
      instanceId,
      stateDir,
      repoRoot,
      platform: options.platform,
      appServerUrl: effectiveAppServerUrl,
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
      TAP_STATE_DIR: runtimeStateDir,
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
var STALE_DIRECT_HEARTBEAT_MS;
var init_bridge_startup = __esm({
  "src/engine/bridge-startup.ts"() {
    "use strict";
    init_runtime();
    init_bridge_paths();
    init_bridge_windows_spawn();
    init_bridge_unix_spawn();
    init_bridge_process_control();
    init_bridge_config();
    init_bridge_state();
    init_bridge_app_server_auth();
    init_bridge_observability();
    init_bridge_app_server_lifecycle();
    STALE_DIRECT_HEARTBEAT_MS = 5 * 60 * 1e3;
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
async function restartBridge(options) {
  const { instanceId, stateDir, platform } = options;
  const drainTimeout = (options.drainTimeoutSeconds ?? 30) * 1e3;
  const repoRoot = options.repoRoot ?? stateDir.replace(/[\\/].tap-comms$/, "");
  const runtimeStateDir = getBridgeRuntimeStateDir(repoRoot, instanceId);
  const heartbeatPath = path19.join(runtimeStateDir, "heartbeat.json");
  if (fs20.existsSync(heartbeatPath)) {
    const startWait = Date.now();
    while (Date.now() - startWait < drainTimeout) {
      try {
        const hb = JSON.parse(fs20.readFileSync(heartbeatPath, "utf-8"));
        if (!hb.activeTurnId) break;
      } catch {
        break;
      }
      await new Promise((resolve12) => setTimeout(resolve12, 1e3));
    }
  }
  if (options.headless?.enabled && options.commsDir) {
    const agentName = options.agentName ?? instanceId;
    cleanupHeadlessDispatch(path19.join(options.commsDir, "inbox"), agentName);
  }
  const stopResult = await stopBridge({ instanceId, stateDir, platform });
  return startBridge({
    ...options,
    processExistingMessages: true,
    previousLifecycle: stopResult.lifecycle ?? options.previousLifecycle ?? null
  });
}
var init_bridge_orchestrator = __esm({
  "src/engine/bridge-orchestrator.ts"() {
    "use strict";
    init_bridge_process_control();
    init_bridge_config();
    init_bridge_state();
    init_bridge_startup();
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
  }
});

// src/engine/dashboard.ts
import * as fs21 from "fs";
import * as path20 from "path";
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
  const heartbeatsPath = path20.join(commsDir, "heartbeats.json");
  if (!fs21.existsSync(heartbeatsPath)) return [];
  try {
    const raw = fs21.readFileSync(heartbeatsPath, "utf-8");
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
  const tmpDir = path20.join(repoRoot, ".tmp");
  if (fs21.existsSync(tmpDir)) {
    try {
      const dirs = fs21.readdirSync(tmpDir).filter((d) => d.startsWith("codex-app-server-bridge"));
      for (const dir of dirs) {
        const daemonPath = path20.join(tmpDir, dir, "bridge-daemon.json");
        if (!fs21.existsSync(daemonPath)) continue;
        try {
          const raw = fs21.readFileSync(daemonPath, "utf-8");
          const daemon = JSON.parse(raw);
          const alreadyCovered = bridges.some(
            (b) => b.pid === daemon.pid && b.pid !== null
          );
          if (alreadyCovered) continue;
          const agentFile = path20.join(tmpDir, dir, "agent-name.txt");
          const agentName = fs21.existsSync(agentFile) ? fs21.readFileSync(agentFile, "utf-8").trim() : dir;
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

// src/adapters/claude.ts
import * as fs22 from "fs";
import * as path21 from "path";
import { execSync as execSync4 } from "child_process";
function findMcpJsonPath(ctx) {
  return path21.join(ctx.repoRoot, ".mcp.json");
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
  return typeof value === "string" ? path21.resolve(value).replace(/\\/g, "/") : "";
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
        const configExists = fs22.existsSync(configPath);
        const runtimeCommand = findClaudeCommand();
        const canWrite = configExists ? (() => {
          try {
            fs22.accessSync(configPath, fs22.constants.W_OK);
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
        if (!fs22.existsSync(ctx.commsDir)) {
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
          const raw = fs22.readFileSync(configPath, "utf-8");
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
              if (fs22.existsSync(op.path)) {
                backupFile(op.path, plan.backupDir);
                const raw = fs22.readFileSync(op.path, "utf-8");
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
              fs22.writeFileSync(
                tmp,
                JSON.stringify(config, null, 2) + "\n",
                "utf-8"
              );
              fs22.renameSync(tmp, op.path);
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
            passed: fs22.existsSync(configPath),
            message: fs22.existsSync(configPath) ? void 0 : `${configPath} not found`
          });
          if (fs22.existsSync(configPath)) {
            try {
              const raw = fs22.readFileSync(configPath, "utf-8");
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
          passed: fs22.existsSync(ctx.commsDir),
          message: fs22.existsSync(ctx.commsDir) ? void 0 : `${ctx.commsDir} not found`
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
import * as crypto2 from "crypto";
import * as fs23 from "fs";
import * as path22 from "path";
function selectorHash(selector) {
  return crypto2.createHash("sha256").update(selector).digest("hex").slice(0, 12);
}
function artifactBackupPath(backupDir, kind, selector) {
  const safeKind = kind.replace(/[^a-z-]/gi, "-");
  return path22.join(backupDir, `${safeKind}-${selectorHash(selector)}.json`);
}
function writeArtifactBackup(backupPath, payload) {
  fs23.mkdirSync(path22.dirname(backupPath), { recursive: true });
  const tmp = `${backupPath}.tmp.${process.pid}`;
  fs23.writeFileSync(tmp, JSON.stringify(payload, null, 2) + "\n", "utf-8");
  fs23.renameSync(tmp, backupPath);
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
var init_toml = __esm({
  "src/toml.ts"() {
    "use strict";
  }
});

// src/adapters/codex.ts
import * as fs24 from "fs";
import * as path23 from "path";
import { fileURLToPath as fileURLToPath4 } from "url";
function findCodexConfigPath() {
  return path23.join(getHomeDir(), ".codex", "config.toml");
}
function canonicalizeTrustPath(targetPath) {
  let resolved = path23.resolve(targetPath).replace(/\//g, "\\");
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
  return [...new Set(targets.map((value) => path23.resolve(value)))];
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
  if (!fs24.existsSync(configPath)) return "";
  return fs24.readFileSync(configPath, "utf-8");
}
function writeTomlFile(filePath, content) {
  fs24.mkdirSync(path23.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp.${process.pid}`;
  fs24.writeFileSync(tmp, content, "utf-8");
  fs24.renameSync(tmp, filePath);
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
    passed: fs24.existsSync(configPath),
    message: fs24.existsSync(configPath) ? void 0 : `${configPath} not found`
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
  if (!fs24.existsSync(configPath)) return null;
  const content = fs24.readFileSync(configPath, "utf-8");
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
        const configExists = fs24.existsSync(configPath);
        const runtimeProbe = probeCommand(
          ctx.platform === "win32" ? ["codex", "codex.cmd"] : ["codex"]
        );
        if (!runtimeProbe.command) {
          warnings.push(
            "Codex CLI not found in PATH. Config can still be written, but runtime verification will be limited."
          );
        }
        if (!fs24.existsSync(ctx.commsDir)) {
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
        if (fs24.existsSync(configPath) && existingContent) {
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
          passed: fs24.existsSync(ctx.commsDir),
          message: fs24.existsSync(ctx.commsDir) ? void 0 : `${ctx.commsDir} not found`
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
        const distDir = path23.dirname(fileURLToPath4(import.meta.url));
        const candidates = [
          // 1. Relative to bundled CLI (npm install / npx)
          path23.join(distDir, "bridges", "codex-bridge-runner.mjs"),
          // 2. Monorepo development — dist inside repo
          path23.join(
            ctx.repoRoot,
            "packages",
            "tap-comms",
            "dist",
            "bridges",
            "codex-bridge-runner.mjs"
          ),
          // 3. Source file — dev mode with strip-types
          path23.join(
            ctx.repoRoot,
            "packages",
            "tap-comms",
            "src",
            "bridges",
            "codex-bridge-runner.ts"
          )
        ];
        for (const candidate of candidates) {
          if (fs24.existsSync(candidate)) return candidate;
        }
        return null;
      }
    };
  }
});

// src/adapters/gemini.ts
import * as fs25 from "fs";
import * as path24 from "path";
function candidateConfigPaths(ctx) {
  const home = getHomeDir();
  return [
    path24.join(ctx.repoRoot, ".gemini", "settings.json"),
    path24.join(home, ".gemini", "settings.json"),
    path24.join(home, ".gemini", "antigravity", "mcp_config.json")
  ];
}
function chooseGeminiConfigPath(ctx) {
  const [workspaceConfig, homeConfig, antigravityConfig] = candidateConfigPaths(ctx);
  if (fs25.existsSync(workspaceConfig)) return workspaceConfig;
  if (fs25.existsSync(homeConfig)) return homeConfig;
  if (fs25.existsSync(antigravityConfig)) {
    const raw = fs25.readFileSync(antigravityConfig, "utf-8").trim();
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
  if (!fs25.existsSync(filePath)) return {};
  const raw = fs25.readFileSync(filePath, "utf-8").trim();
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
    passed: fs25.existsSync(configPath),
    message: fs25.existsSync(configPath) ? void 0 : `${configPath} not found`
  });
  checks.push({
    name: "tap entry present",
    passed: !!entry,
    message: entry ? void 0 : `${GEMINI_SELECTOR} not found`
  });
  checks.push({
    name: "Comms directory exists",
    passed: fs25.existsSync(ctx.commsDir),
    message: fs25.existsSync(ctx.commsDir) ? void 0 : `${ctx.commsDir} not found`
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
        const configExists = fs25.existsSync(configPath);
        const runtimeProbe = probeCommand(
          ctx.platform === "win32" ? ["gemini", "gemini.cmd"] : ["gemini"]
        );
        if (!runtimeProbe.command) {
          warnings.push(
            "Gemini CLI not found in PATH. Config can still be written, but runtime verification will be limited."
          );
        }
        if (!fs25.existsSync(ctx.commsDir)) {
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
        if (fs25.existsSync(configPath)) {
          if (fs25.readFileSync(configPath, "utf-8").trim()) {
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
        fs25.mkdirSync(path24.dirname(configPath), { recursive: true });
        const tmp = `${configPath}.tmp.${process.pid}`;
        fs25.writeFileSync(tmp, JSON.stringify(config, null, 2) + "\n", "utf-8");
        fs25.renameSync(tmp, configPath);
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
function formatCodexTuiAttachCommand(tuiConnectUrl, cwd) {
  return `codex --enable tui_app_server --remote ${quoteCliArg(tuiConnectUrl)} --cd ${quoteCliArg(cwd)}`;
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
var init_bridge_helpers = __esm({
  "src/commands/bridge-helpers.ts"() {
    "use strict";
    init_bridge();
  }
});

// src/commands/bridge-heartbeat.ts
import { existsSync as existsSync22, readFileSync as readFileSync18, renameSync as renameSync11, writeFileSync as writeFileSync12 } from "fs";
import * as path26 from "path";
function loadBridgeHeartbeatStore(commsDir) {
  const heartbeatsPath = path26.join(commsDir, "heartbeats.json");
  if (!existsSync22(heartbeatsPath)) return {};
  try {
    return JSON.parse(readFileSync18(heartbeatsPath, "utf-8"));
  } catch {
    return null;
  }
}
function saveBridgeHeartbeatStore(commsDir, store) {
  const heartbeatsPath = path26.join(commsDir, "heartbeats.json");
  const tmp = `${heartbeatsPath}.tmp.${process.pid}`;
  writeFileSync12(tmp, JSON.stringify(store, null, 2), "utf-8");
  renameSync11(tmp, heartbeatsPath);
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
var BRIDGE_UP_ACTIVE_HEARTBEAT_WINDOW_MS, BRIDGE_UP_ORPHAN_HEARTBEAT_WINDOW_MS, BRIDGE_UP_SIGNING_OFF_HEARTBEAT_WINDOW_MS;
var init_bridge_heartbeat = __esm({
  "src/commands/bridge-heartbeat.ts"() {
    "use strict";
    init_bridge();
    BRIDGE_UP_ACTIVE_HEARTBEAT_WINDOW_MS = 10 * 60 * 1e3;
    BRIDGE_UP_ORPHAN_HEARTBEAT_WINDOW_MS = 24 * 60 * 60 * 1e3;
    BRIDGE_UP_SIGNING_OFF_HEARTBEAT_WINDOW_MS = 5 * 60 * 1e3;
  }
});

// src/commands/bridge-start.ts
import * as path27 from "path";
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
var init_bridge_start = __esm({
  "src/commands/bridge-start.ts"() {
    "use strict";
    init_state();
    init_instance_config();
    init_bridge();
    init_config();
    init_adapters();
    init_utils();
    init_bridge_helpers();
    init_bridge_heartbeat();
    init_codex();
  }
});

// src/commands/bridge-stop.ts
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
import * as path28 from "path";
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
    const status = getBridgeStatus(stateDir, instanceId);
    const bridgeState = loadBridgeState(stateDir, instanceId) ?? inst.bridge;
    const runtimeHeartbeat = loadRuntimeBridgeHeartbeat(bridgeState);
    const savedThread = loadRuntimeBridgeThreadState(bridgeState);
    const lifecycle = deriveBridgeLifecycleState({
      bridgeStatus: status,
      bridgeState,
      runtimeHeartbeat,
      savedThread,
      persistedLifecycle: inst.bridgeLifecycle ?? bridgeState?.lifecycle ?? null
    });
    const session = status === "running" ? deriveCodexSessionState({
      runtimeHeartbeat,
      runtimeStateDir: bridgeState?.runtimeStateDir ?? null
    }) : null;
    const age = getHeartbeatAge(stateDir, instanceId);
    if (lifecycle.status === "bridge-stale" && inst.bridge) {
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
    const pid = bridgeState?.pid ?? null;
    const heartbeat = getBridgeHeartbeatTimestamp(stateDir, instanceId);
    const pidStr = pid ? String(pid) : "-";
    const portStr = inst.port ? String(inst.port) : "-";
    const ageStr = age !== null ? formatAge(age) : "-";
    log(
      `${instanceId.padEnd(20)} ${inst.runtime.padEnd(8)} ${status.padEnd(10)} ${lifecycle.status.padEnd(20)} ${(session?.status ?? "-").padEnd(18)} ${pidStr.padEnd(8)} ${portStr.padEnd(6)} ${ageStr}`
    );
    if (bridgeState?.appServer) {
      log(`  App server: ${formatAppServerState(bridgeState.appServer)}`);
      if (bridgeState.appServer.logPath) {
        log(`  Server log: ${bridgeState.appServer.logPath}`);
      }
      if (bridgeState.appServer.auth) {
        log(
          `  Protected: ${redactProtectedUrl(bridgeState.appServer.auth.protectedUrl)}`
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
      appServer: bridgeState?.appServer ?? null
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
  const status = getBridgeStatus(stateDir, instanceId);
  const bridgeState = loadBridgeState(stateDir, instanceId) ?? inst.bridge;
  const runtimeHeartbeat = loadRuntimeBridgeHeartbeat(bridgeState);
  const savedThread = loadRuntimeBridgeThreadState(bridgeState);
  const age = getHeartbeatAge(stateDir, instanceId);
  const heartbeat = getBridgeHeartbeatTimestamp(stateDir, instanceId);
  const lifecycle = deriveBridgeLifecycleState({
    bridgeStatus: status,
    bridgeState,
    runtimeHeartbeat,
    savedThread,
    persistedLifecycle: inst.bridgeLifecycle ?? bridgeState?.lifecycle ?? null
  });
  const session = deriveCodexSessionState({
    runtimeHeartbeat,
    runtimeStateDir: bridgeState?.runtimeStateDir ?? null
  });
  log(`Status:      ${status}`);
  log(`Lifecycle:   ${lifecycle.summary}`);
  log(`Session:     ${session.summary}`);
  if (bridgeState) {
    log(`PID:         ${bridgeState.pid}`);
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
    if (bridgeState.appServer) {
      log(`App server:  ${bridgeState.appServer.url}`);
      log(`Server PID:  ${bridgeState.appServer.pid ?? "-"}`);
      log(
        `Server mode: ${bridgeState.appServer.managed ? "managed" : "external"}`
      );
      log(
        `Health:      ${bridgeState.appServer.healthy ? "healthy" : "unhealthy"}`
      );
      log(`Checked:     ${bridgeState.appServer.lastCheckedAt}`);
      if (bridgeState.appServer.logPath) {
        log(`Server log:  ${bridgeState.appServer.logPath}`);
      }
      if (bridgeState.appServer.auth) {
        log(`Auth:        ${bridgeState.appServer.auth.mode}`);
        log(
          `Protected:   ${redactProtectedUrl(bridgeState.appServer.auth.protectedUrl)}`
        );
        log(`Upstream:    ${bridgeState.appServer.auth.upstreamUrl}`);
        log(`TUI connect: ${bridgeState.appServer.auth.upstreamUrl}`);
        log(`Gateway PID: ${bridgeState.appServer.auth.gatewayPid ?? "-"}`);
        if (bridgeState.appServer.auth.gatewayLogPath) {
          log(`Gateway log: ${bridgeState.appServer.auth.gatewayLogPath}`);
        }
      } else if (bridgeState.appServer.managed) {
        log(`Auth:        none (--no-auth)`);
        log(`TUI connect: ${bridgeState.appServer.url}`);
      }
    }
  }
  const transition = formatLifecycleTransition(lifecycle);
  if (transition) {
    log(`Transition:  ${transition}`);
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
      pid: bridgeState?.pid ?? null,
      port: inst.port,
      lastHeartbeat: heartbeat,
      threadId: runtimeHeartbeat?.threadId ?? null,
      threadCwd: runtimeHeartbeat?.threadCwd ?? null,
      savedThreadId: savedThread?.threadId ?? null,
      savedThreadCwd: savedThread?.cwd ?? null,
      appServer: bridgeState?.appServer ?? null
    }
  };
}
var init_bridge_status = __esm({
  "src/commands/bridge-status.ts"() {
    "use strict";
    init_state();
    init_bridge();
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
  const attachCommand = formatCodexTuiAttachCommand(tuiConnectUrl, attachCwd);
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
var init_bridge_restart = __esm({
  "src/commands/bridge-restart.ts"() {
    "use strict";
    init_state();
    init_bridge();
    init_config();
    init_adapters();
    init_utils();
    init_bridge_helpers();
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
  await new Promise((resolve12, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(port, host, () => {
      httpServer.off("error", reject);
      resolve12();
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
    await new Promise((resolve12, reject) => {
      httpServer.close((closeError) => {
        if (closeError) {
          reject(closeError);
          return;
        }
        resolve12();
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
    await new Promise((resolve12, reject) => {
      httpServer.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve12();
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
init_bridge_observability();
init_bridge();
init_dashboard();

// src/api/state.ts
init_dashboard();
init_utils();
init_config();
init_state();
import * as fs26 from "fs";
import * as path29 from "path";
function getDashboardSnapshot(options) {
  const repoRoot = options?.repoRoot ?? findRepoRoot();
  return collectDashboardSnapshot(repoRoot, options?.commsDir);
}
async function* streamEvents(options) {
  const intervalMs = options?.intervalMs ?? 2e3;
  const repoRoot = options?.repoRoot ?? findRepoRoot();
  while (!options?.signal?.aborted) {
    yield collectDashboardSnapshot(repoRoot, options?.commsDir);
    await new Promise((resolve12) => {
      const onAbort = () => {
        clearTimeout(timer);
        resolve12();
      };
      const timer = setTimeout(() => {
        options?.signal?.removeEventListener("abort", onAbort);
        resolve12();
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
          if (inst.agentName) activeMatchers.add(inst.agentName);
        }
      }
    }
    const tmpDir = path29.join(repoRoot, ".tmp");
    if (fs26.existsSync(tmpDir)) {
      for (const dir of fs26.readdirSync(tmpDir)) {
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
        const hsPath = path29.join(tmpDir, dir, "headless-state.json");
        if (!fs26.existsSync(hsPath)) continue;
        try {
          const hs = JSON.parse(fs26.readFileSync(hsPath, "utf-8"));
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
import { randomBytes as randomBytes3, timingSafeEqual } from "crypto";
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
  const token = options?.token ?? randomBytes3(24).toString("base64url");
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
  await new Promise((resolve12, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.removeListener("error", reject);
      resolve12();
    });
  });
  const addr = server.address();
  const actualPort = typeof addr === "object" && addr ? addr.port : port;
  return {
    port: actualPort,
    token,
    close: () => new Promise((resolve12, reject) => {
      server.close((err) => err ? reject(err) : resolve12());
    })
  };
}

// src/index.ts
init_runtime();
export {
  LOCAL_CONFIG_FILE,
  SHARED_CONFIG_FILE,
  buildRuntimeEnv,
  collectDashboardSnapshot,
  createInitialState,
  getConfig,
  getDashboardSnapshot,
  getFnmBinDir,
  getHealthReport,
  getHeartbeatAge,
  loadLocalConfig,
  loadSharedConfig,
  loadState,
  normalizeTapPath,
  probeFnmNode,
  readNodeVersion,
  resolveConfig,
  resolveNodeRuntime,
  restartBridge,
  rotateLog,
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
  version
};
//# sourceMappingURL=index.mjs.map