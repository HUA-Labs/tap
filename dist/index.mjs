// src/state.ts
import * as fs3 from "fs";
import * as path3 from "path";
import * as crypto from "crypto";

// src/config/resolve.ts
import * as fs2 from "fs";
import * as path2 from "path";

// src/utils.ts
import * as fs from "fs";
import * as path from "path";
var _noGitWarned = false;
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
        logWarn(
          "No .git directory found. Resolved repo root via package.json \u2014 comms directory may be created in an unexpected location. Use --comms-dir to specify explicitly."
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
    logWarn(
      "No git repository or package.json found. Using current directory as root. Run 'git init' first, or use --comms-dir to specify the comms path."
    );
  }
  return process.cwd();
}
var _jsonMode = false;
function logWarn(message) {
  if (!_jsonMode) console.log(`  ! ${message}`);
}

// src/config/resolve.ts
var SHARED_CONFIG_FILE = "tap-config.json";
var LOCAL_CONFIG_FILE = "tap-config.local.json";
var LEGACY_CONFIG_FILE = ".tap-config";
var DEFAULT_RUNTIME_COMMAND = "node";
var DEFAULT_APP_SERVER_URL = "ws://127.0.0.1:4501";
function findRepoRoot2(startDir = process.cwd()) {
  let dir = path2.resolve(startDir);
  while (true) {
    if (fs2.existsSync(path2.join(dir, ".git"))) return dir;
    if (fs2.existsSync(path2.join(dir, "package.json"))) {
      if (!_noGitWarned) {
        _setNoGitWarned();
        console.error(
          "[tap] warning: No .git directory found. Resolved via package.json. Use --comms-dir to specify explicitly."
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
    console.error(
      "[tap] warning: No git repository found. Using cwd as root. Run 'git init' or use --comms-dir."
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
    appServerUrl: "auto"
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
  return {
    config: { repoRoot, commsDir, stateDir, runtimeCommand, appServerUrl },
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

// src/state.ts
var STATE_FILE = "state.json";
var SCHEMA_VERSION = 2;
function getStateDir(repoRoot) {
  const { config } = resolveConfig({}, repoRoot);
  return config.stateDir;
}
function getStatePath(repoRoot) {
  return path3.join(getStateDir(repoRoot), STATE_FILE);
}
function stateExists(repoRoot) {
  return fs3.existsSync(getStatePath(repoRoot));
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
function loadState(repoRoot) {
  const statePath = getStatePath(repoRoot);
  if (!fs3.existsSync(statePath)) return null;
  const raw = fs3.readFileSync(statePath, "utf-8");
  const parsed = JSON.parse(raw);
  if (parsed.schemaVersion === 1 || parsed.runtimes) {
    const migrated = migrateStateV1toV2(parsed);
    saveState(repoRoot, migrated);
    return migrated;
  }
  return parsed;
}
function saveState(repoRoot, state) {
  const stateDir = getStateDir(repoRoot);
  fs3.mkdirSync(stateDir, { recursive: true });
  const statePath = getStatePath(repoRoot);
  const tmp = `${statePath}.tmp.${process.pid}`;
  fs3.writeFileSync(tmp, JSON.stringify(state, null, 2), "utf-8");
  fs3.renameSync(tmp, statePath);
}
function createInitialState(commsDir, repoRoot, packageVersion) {
  const now = (/* @__PURE__ */ new Date()).toISOString();
  return {
    schemaVersion: SCHEMA_VERSION,
    createdAt: now,
    updatedAt: now,
    commsDir: path3.resolve(commsDir),
    repoRoot: path3.resolve(repoRoot),
    packageVersion,
    instances: {}
  };
}

// src/version.ts
import * as fs4 from "fs";
import * as path4 from "path";
import { fileURLToPath } from "url";
var FALLBACK_VERSION = "0.0.0";
function resolvePackageVersion(metaUrl = import.meta.url) {
  const moduleDir = path4.dirname(fileURLToPath(metaUrl));
  const packageJsonPath = path4.join(moduleDir, "..", "package.json");
  try {
    const parsed = JSON.parse(fs4.readFileSync(packageJsonPath, "utf-8"));
    if (typeof parsed.version === "string" && parsed.version.trim()) {
      return parsed.version;
    }
  } catch {
  }
  return FALLBACK_VERSION;
}
var version = resolvePackageVersion();

// src/engine/bridge.ts
import * as fs6 from "fs";
import * as net from "net";
import * as path6 from "path";
import { randomBytes } from "crypto";
import { spawn, spawnSync, execSync as execSync2 } from "child_process";
import { fileURLToPath as fileURLToPath2 } from "url";

// src/runtime/resolve-node.ts
import * as fs5 from "fs";
import * as path5 from "path";
import { execSync } from "child_process";
function readNodeVersion(repoRoot) {
  const nvFile = path5.join(repoRoot, ".node-version");
  if (!fs5.existsSync(nvFile)) return null;
  try {
    const raw = fs5.readFileSync(nvFile, "utf-8").trim();
    return raw.length > 0 ? raw.replace(/^v/, "") : null;
  } catch {
    return null;
  }
}
function fnmCandidateDirs() {
  if (process.platform === "win32") {
    return [
      process.env.FNM_DIR,
      process.env.APPDATA ? path5.join(process.env.APPDATA, "fnm") : null,
      process.env.LOCALAPPDATA ? path5.join(process.env.LOCALAPPDATA, "fnm") : null,
      process.env.USERPROFILE ? path5.join(process.env.USERPROFILE, "scoop", "persist", "fnm") : null
    ].filter(Boolean);
  }
  return [
    process.env.FNM_DIR,
    process.env.HOME ? path5.join(process.env.HOME, ".local", "share", "fnm") : null,
    process.env.HOME ? path5.join(process.env.HOME, ".fnm") : null,
    process.env.XDG_DATA_HOME ? path5.join(process.env.XDG_DATA_HOME, "fnm") : null
  ].filter(Boolean);
}
function nodeExecutableName() {
  return process.platform === "win32" ? "node.exe" : "node";
}
function probeFnmNode(desiredVersion) {
  const dirs = fnmCandidateDirs();
  const exe = nodeExecutableName();
  for (const baseDir of dirs) {
    const candidate = path5.join(
      baseDir,
      "node-versions",
      `v${desiredVersion}`,
      "installation",
      exe
    );
    if (!fs5.existsSync(candidate)) continue;
    try {
      const v = execSync(`"${candidate}" --version`, {
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
    const version2 = execSync(`"${command}" --version`, {
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
    execSync(`"${command}" --experimental-strip-types -e ""`, {
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
    path5.join(repoRoot, "node_modules", ".bin", "tsx.exe"),
    path5.join(repoRoot, "node_modules", ".bin", "tsx.CMD"),
    path5.join(repoRoot, "node_modules", ".bin", "tsx")
  ];
  for (const c of candidates) {
    if (fs5.existsSync(c)) return c;
  }
  return null;
}
function getFnmBinDir(repoRoot) {
  const desiredVersion = readNodeVersion(repoRoot);
  if (!desiredVersion) return null;
  const nodePath = probeFnmNode(desiredVersion);
  if (!nodePath) return null;
  return path5.dirname(nodePath);
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
    [pathKey]: `${fnmBin}${path5.delimiter}${currentPath}`
  };
}

// src/engine/bridge.ts
var APP_SERVER_AUTH_FILE_MODE = 384;
function writeProtectedTextFile(filePath, content) {
  fs6.mkdirSync(path6.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp.${process.pid}`;
  fs6.writeFileSync(tmp, content, {
    encoding: "utf-8",
    mode: APP_SERVER_AUTH_FILE_MODE
  });
  fs6.chmodSync(tmp, APP_SERVER_AUTH_FILE_MODE);
  fs6.renameSync(tmp, filePath);
  fs6.chmodSync(filePath, APP_SERVER_AUTH_FILE_MODE);
}
function pidFilePath(stateDir, instanceId) {
  return path6.join(stateDir, "pids", `bridge-${instanceId}.json`);
}
function runtimeHeartbeatFilePath(runtimeStateDir) {
  return path6.join(runtimeStateDir, "heartbeat.json");
}
function loadRuntimeHeartbeatTimestamp(runtimeStateDir) {
  if (!runtimeStateDir) {
    return null;
  }
  const heartbeatPath = runtimeHeartbeatFilePath(runtimeStateDir);
  if (!fs6.existsSync(heartbeatPath)) {
    return null;
  }
  try {
    const raw = fs6.readFileSync(heartbeatPath, "utf-8");
    const parsed = JSON.parse(raw);
    return typeof parsed.updatedAt === "string" ? parsed.updatedAt : null;
  } catch {
    return null;
  }
}
function resolveHeartbeatTimestamp(state) {
  return loadRuntimeHeartbeatTimestamp(state?.runtimeStateDir) ?? state?.lastHeartbeat ?? null;
}
function loadBridgeState(stateDir, instanceId) {
  const pidPath = pidFilePath(stateDir, instanceId);
  if (!fs6.existsSync(pidPath)) return null;
  try {
    const raw = fs6.readFileSync(pidPath, "utf-8");
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
  if (fs6.existsSync(pidPath)) {
    fs6.unlinkSync(pidPath);
  }
}
function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
function rotateLog(logPath) {
  if (!fs6.existsSync(logPath)) return;
  try {
    const stats = fs6.statSync(logPath);
    if (stats.size === 0) return;
    const prevPath = `${logPath}.prev`;
    fs6.renameSync(logPath, prevPath);
  } catch {
  }
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
function getBridgeStatus(stateDir, instanceId) {
  const state = loadBridgeState(stateDir, instanceId);
  if (!state) return "stopped";
  if (!isProcessAlive(state.pid)) {
    clearBridgeState(stateDir, instanceId);
    return "stale";
  }
  return "running";
}

// src/engine/dashboard.ts
import * as fs7 from "fs";
import * as path7 from "path";
import { execSync as execSync3 } from "child_process";
function collectAgents(commsDir) {
  const heartbeatsPath = path7.join(commsDir, "heartbeats.json");
  if (!fs7.existsSync(heartbeatsPath)) return [];
  try {
    const raw = fs7.readFileSync(heartbeatsPath, "utf-8");
    const data = JSON.parse(raw);
    return Object.entries(data).map(([name, info]) => ({
      name: info.agent ?? name,
      status: info.status ?? null,
      lastActivity: info.lastActivity ?? info.timestamp ?? null,
      joinedAt: info.joinedAt ?? null
    }));
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
      const bridgeState = loadBridgeState(stateDir, instanceId);
      const age = getHeartbeatAge(stateDir, instanceId);
      bridges.push({
        instanceId: id,
        runtime: inst.runtime,
        status,
        pid: bridgeState?.pid ?? null,
        port: inst.port ?? null,
        heartbeatAge: age,
        headless: inst.headless?.enabled ?? false
      });
    }
  }
  const tmpDir = path7.join(repoRoot, ".tmp");
  if (fs7.existsSync(tmpDir)) {
    try {
      const dirs = fs7.readdirSync(tmpDir).filter((d) => d.startsWith("codex-app-server-bridge"));
      for (const dir of dirs) {
        const daemonPath = path7.join(tmpDir, dir, "bridge-daemon.json");
        if (!fs7.existsSync(daemonPath)) continue;
        try {
          const raw = fs7.readFileSync(daemonPath, "utf-8");
          const daemon = JSON.parse(raw);
          const alreadyCovered = bridges.some(
            (b) => b.pid === daemon.pid && b.pid !== null
          );
          if (alreadyCovered) continue;
          const agentFile = path7.join(tmpDir, dir, "agent-name.txt");
          const agentName = fs7.existsSync(agentFile) ? fs7.readFileSync(agentFile, "utf-8").trim() : dir;
          const running = daemon.pid ? isProcessAlive(daemon.pid) : false;
          const portMatch = daemon.appServerUrl?.match(/:(\d+)/);
          const port = portMatch ? parseInt(portMatch[1], 10) : null;
          bridges.push({
            instanceId: agentName,
            runtime: "codex",
            status: running ? "running" : "stale",
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
  const agents = collectAgents(resolved.commsDir);
  const bridges = collectBridges(resolved.repoRoot);
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

// src/api/state.ts
function getDashboardSnapshot(options) {
  const repoRoot = options?.repoRoot ?? findRepoRoot();
  return collectDashboardSnapshot(repoRoot, options?.commsDir);
}
async function* streamEvents(options) {
  const intervalMs = options?.intervalMs ?? 2e3;
  const repoRoot = options?.repoRoot ?? findRepoRoot();
  while (!options?.signal?.aborted) {
    yield collectDashboardSnapshot(repoRoot, options?.commsDir);
    await new Promise((resolve5) => {
      const onAbort = () => {
        clearTimeout(timer);
        resolve5();
      };
      const timer = setTimeout(() => {
        options?.signal?.removeEventListener("abort", onAbort);
        resolve5();
      }, intervalMs);
      options?.signal?.addEventListener("abort", onAbort, { once: true });
    });
  }
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
  createServer as createServer2
} from "http";
var CORS_HEADERS = {
  "Access-Control-Allow-Origin": "http://localhost:3000",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};
function jsonResponse(res, data, status = 200) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    ...CORS_HEADERS
  });
  res.end(JSON.stringify(data));
}
function handleSnapshot(res, apiOptions) {
  const snapshot = getDashboardSnapshot(apiOptions);
  jsonResponse(res, snapshot);
}
function handleConfig(res, apiOptions) {
  const config = getConfig(apiOptions);
  jsonResponse(res, config);
}
async function handleEvents(req, res, apiOptions) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    ...CORS_HEADERS
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
function handleHealth(res) {
  jsonResponse(res, { ok: true, timestamp: (/* @__PURE__ */ new Date()).toISOString() });
}
async function startHttpServer(options) {
  const port = options?.port ?? 4580;
  const host = "127.0.0.1";
  const apiOptions = {
    repoRoot: options?.repoRoot,
    commsDir: options?.commsDir
  };
  const server = createServer2(
    async (req, res) => {
      const url = new URL(req.url ?? "/", `http://${host}:${port}`);
      const pathname = url.pathname;
      if (req.method === "OPTIONS") {
        res.writeHead(204, CORS_HEADERS);
        res.end();
        return;
      }
      if (req.method !== "GET") {
        jsonResponse(res, { error: "Method not allowed" }, 405);
        return;
      }
      try {
        switch (pathname) {
          case "/api/snapshot":
            handleSnapshot(res, apiOptions);
            break;
          case "/api/events":
            await handleEvents(req, res, apiOptions);
            break;
          case "/api/config":
            handleConfig(res, apiOptions);
            break;
          case "/health":
            handleHealth(res);
            break;
          default:
            jsonResponse(res, { error: "Not found" }, 404);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        jsonResponse(res, { error: message }, 500);
      }
    }
  );
  await new Promise((resolve5, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.removeListener("error", reject);
      resolve5();
    });
  });
  return {
    port,
    close: () => new Promise((resolve5, reject) => {
      server.close((err) => err ? reject(err) : resolve5());
    })
  };
}
export {
  LOCAL_CONFIG_FILE,
  SHARED_CONFIG_FILE,
  buildRuntimeEnv,
  collectDashboardSnapshot,
  createInitialState,
  getConfig,
  getDashboardSnapshot,
  getFnmBinDir,
  getHeartbeatAge,
  loadLocalConfig,
  loadSharedConfig,
  loadState,
  probeFnmNode,
  readNodeVersion,
  resolveConfig,
  resolveNodeRuntime,
  rotateLog,
  saveLocalConfig,
  saveSharedConfig,
  saveState,
  startHttpServer,
  stateExists,
  streamEvents,
  updateBridgeHeartbeat,
  version
};
//# sourceMappingURL=index.mjs.map