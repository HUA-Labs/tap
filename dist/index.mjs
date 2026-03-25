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
function createAdapterContext(commsDir, repoRoot) {
  const { config } = resolveConfig({}, repoRoot);
  return {
    commsDir: path.resolve(commsDir),
    repoRoot: path.resolve(repoRoot),
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
function logWarn(message) {
  if (!_jsonMode) console.log(`  ! ${message}`);
}
function logError(message) {
  if (!_jsonMode) console.error(`  x ${message}`);
}
function logHeader(message) {
  if (!_jsonMode) console.log(`
  ${message}
`);
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

// src/config/index.ts
var init_config = __esm({
  "src/config/index.ts"() {
    "use strict";
    init_resolve();
  }
});

// src/state.ts
import * as fs3 from "fs";
import * as path3 from "path";
import * as crypto from "crypto";
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
  const backupDir = path3.join(stateDir, "backups", instanceId);
  fs3.mkdirSync(backupDir, { recursive: true });
  return backupDir;
}
function backupFile(filePath, backupDir) {
  const basename2 = path3.basename(filePath);
  const hash = fileHash(filePath);
  const backupPath = path3.join(backupDir, `${basename2}.${hash}.bak`);
  fs3.copyFileSync(filePath, backupPath);
  return backupPath;
}
function fileHash(filePath) {
  if (!fs3.existsSync(filePath)) return "";
  const content = fs3.readFileSync(filePath);
  return crypto.createHash("sha256").update(content).digest("hex").slice(0, 16);
}
var STATE_FILE, SCHEMA_VERSION;
var init_state = __esm({
  "src/state.ts"() {
    "use strict";
    init_config();
    STATE_FILE = "state.json";
    SCHEMA_VERSION = 2;
  }
});

// src/adapters/common.ts
import * as fs5 from "fs";
import * as os from "os";
import * as path5 from "path";
import { spawnSync } from "child_process";
import { fileURLToPath as fileURLToPath2 } from "url";
function probeCommand(candidates) {
  for (const candidate of candidates) {
    const result = spawnSync(candidate, ["--version"], {
      encoding: "utf-8",
      shell: process.platform === "win32"
    });
    if (result.status === 0) {
      const version2 = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim() || null;
      return { command: candidate, version: version2 };
    }
  }
  return { command: null, version: null };
}
function getHomeDir() {
  return os.homedir();
}
function toForwardSlashPath(filePath) {
  return path5.resolve(filePath).replace(/\\/g, "/");
}
function canWriteOrCreate(filePath) {
  try {
    if (fs5.existsSync(filePath)) {
      fs5.accessSync(filePath, fs5.constants.W_OK);
      return true;
    }
    const parent = path5.dirname(filePath);
    fs5.mkdirSync(parent, { recursive: true });
    fs5.accessSync(parent, fs5.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}
function findLocalTapCommsSource(ctx) {
  const candidates = [
    path5.join(
      ctx.repoRoot,
      "packages",
      "tap-plugin",
      "channels",
      "tap-comms.ts"
    ),
    path5.join(
      ctx.repoRoot,
      "node_modules",
      "@hua-labs",
      "tap-plugin",
      "channels",
      "tap-comms.ts"
    )
  ];
  for (const candidate of candidates) {
    if (fs5.existsSync(candidate)) return candidate;
  }
  return null;
}
function findBundledTapCommsSource(metaUrl = import.meta.url) {
  const moduleDir = path5.dirname(fileURLToPath2(metaUrl));
  const candidates = [
    path5.join(moduleDir, "mcp-server.mjs"),
    path5.join(moduleDir, "..", "mcp-server.mjs"),
    path5.join(moduleDir, "..", "mcp-server.ts")
  ];
  for (const candidate of candidates) {
    if (fs5.existsSync(candidate)) return candidate;
  }
  return null;
}
function findTapCommsServerEntry(ctx, metaUrl = import.meta.url) {
  return findBundledTapCommsSource(metaUrl) ?? findLocalTapCommsSource(ctx);
}
function findPreferredBunCommand() {
  const home = getHomeDir();
  const candidates = process.platform === "win32" ? [path5.join(home, ".bun", "bin", "bun.exe"), "bun", "bun.cmd"] : [path5.join(home, ".bun", "bin", "bun"), "bun"];
  for (const candidate of candidates) {
    if (path5.isAbsolute(candidate) && !fs5.existsSync(candidate)) continue;
    const result = spawnSync(candidate, ["--version"], {
      encoding: "utf-8",
      shell: process.platform === "win32"
    });
    if (result.status === 0) {
      return path5.isAbsolute(candidate) ? toForwardSlashPath(candidate) : candidate;
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
    TAP_AGENT_NAME: "<set-per-session>",
    TAP_COMMS_DIR: toForwardSlashPath(ctx.commsDir)
  };
  if (instanceId) {
    env.TAP_AGENT_ID = instanceId;
  }
  if (!sourcePath) {
    issues.push(
      "tap-comms MCP server entry not found. Reinstall @hua-labs/tap or run from a repo with packages/tap-plugin/channels/ available."
    );
    return { command: null, args: [], env, sourcePath, warnings, issues };
  }
  const isBundled = sourcePath.endsWith(".mjs");
  let command = bunCommand;
  if (!command && isBundled) {
    command = process.execPath;
    warnings.push(
      "bun not found; using node to run the compiled MCP server. Install bun for better performance."
    );
  }
  if (!command) {
    issues.push(
      "bun is required to run the repo-local tap-comms MCP server (.ts source). Install bun: https://bun.sh"
    );
    return { command: null, args: [], env, sourcePath, warnings, issues };
  }
  return {
    command: isBundled && command === process.execPath ? toForwardSlashPath(command) : command,
    args: [toForwardSlashPath(sourcePath)],
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

// src/runtime/resolve-node.ts
import * as fs6 from "fs";
import * as path6 from "path";
import { execSync } from "child_process";
function readNodeVersion(repoRoot) {
  const nvFile = path6.join(repoRoot, ".node-version");
  if (!fs6.existsSync(nvFile)) return null;
  try {
    const raw = fs6.readFileSync(nvFile, "utf-8").trim();
    return raw.length > 0 ? raw.replace(/^v/, "") : null;
  } catch {
    return null;
  }
}
function fnmCandidateDirs() {
  if (process.platform === "win32") {
    return [
      process.env.FNM_DIR,
      process.env.APPDATA ? path6.join(process.env.APPDATA, "fnm") : null,
      process.env.LOCALAPPDATA ? path6.join(process.env.LOCALAPPDATA, "fnm") : null,
      process.env.USERPROFILE ? path6.join(process.env.USERPROFILE, "scoop", "persist", "fnm") : null
    ].filter(Boolean);
  }
  return [
    process.env.FNM_DIR,
    process.env.HOME ? path6.join(process.env.HOME, ".local", "share", "fnm") : null,
    process.env.HOME ? path6.join(process.env.HOME, ".fnm") : null,
    process.env.XDG_DATA_HOME ? path6.join(process.env.XDG_DATA_HOME, "fnm") : null
  ].filter(Boolean);
}
function nodeExecutableName() {
  return process.platform === "win32" ? "node.exe" : "node";
}
function probeFnmNode(desiredVersion) {
  const dirs = fnmCandidateDirs();
  const exe = nodeExecutableName();
  for (const baseDir of dirs) {
    const candidate = path6.join(
      baseDir,
      "node-versions",
      `v${desiredVersion}`,
      "installation",
      exe
    );
    if (!fs6.existsSync(candidate)) continue;
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
    path6.join(repoRoot, "node_modules", ".bin", "tsx.exe"),
    path6.join(repoRoot, "node_modules", ".bin", "tsx.CMD"),
    path6.join(repoRoot, "node_modules", ".bin", "tsx")
  ];
  for (const c of candidates) {
    if (fs6.existsSync(c)) return c;
  }
  return null;
}
function getFnmBinDir(repoRoot) {
  const desiredVersion = readNodeVersion(repoRoot);
  if (!desiredVersion) return null;
  const nodePath = probeFnmNode(desiredVersion);
  if (!nodePath) return null;
  return path6.dirname(nodePath);
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
    [pathKey]: `${fnmBin}${path6.delimiter}${currentPath}`
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

// src/engine/bridge.ts
import * as fs7 from "fs";
import * as net from "net";
import * as path7 from "path";
import { randomBytes } from "crypto";
import { spawn, spawnSync as spawnSync2, execSync as execSync2 } from "child_process";
import { fileURLToPath as fileURLToPath3 } from "url";
function appServerLogFilePath(stateDir, instanceId) {
  return path7.join(stateDir, "logs", `app-server-${instanceId}.log`);
}
function appServerGatewayLogFilePath(stateDir, instanceId) {
  return path7.join(stateDir, "logs", `app-server-gateway-${instanceId}.log`);
}
function appServerGatewayTokenFilePath(stateDir, instanceId) {
  return path7.join(
    stateDir,
    "secrets",
    `app-server-gateway-${instanceId}.token`
  );
}
function stderrLogFilePath(logPath) {
  return `${logPath}.stderr`;
}
function writeProtectedTextFile(filePath, content) {
  fs7.mkdirSync(path7.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp.${process.pid}`;
  fs7.writeFileSync(tmp, content, {
    encoding: "utf-8",
    mode: APP_SERVER_AUTH_FILE_MODE
  });
  fs7.chmodSync(tmp, APP_SERVER_AUTH_FILE_MODE);
  fs7.renameSync(tmp, filePath);
  fs7.chmodSync(filePath, APP_SERVER_AUTH_FILE_MODE);
}
function removeFileIfExists(filePath) {
  if (!filePath || !fs7.existsSync(filePath)) {
    return;
  }
  try {
    fs7.unlinkSync(filePath);
  } catch {
  }
}
function getWebSocketCtor() {
  const candidate = globalThis.WebSocket;
  return typeof candidate === "function" ? candidate : null;
}
function delay(ms) {
  return new Promise((resolve8) => setTimeout(resolve8, ms));
}
function isLoopbackHost(hostname) {
  return hostname === "127.0.0.1" || hostname === "localhost";
}
function resolveCodexCommand(platform) {
  const candidates = platform === "win32" ? ["codex.cmd", "codex.exe", "codex", "codex.ps1"] : ["codex"];
  return probeCommand(candidates).command;
}
function formatCodexAppServerCommand(command, url) {
  return `${command} app-server --listen ${url}`;
}
function resolvePowerShellCommand() {
  return probeCommand(["pwsh", "powershell", "powershell.exe"]).command ?? "powershell";
}
function resolveAuthGatewayScript(repoRoot) {
  const moduleDir = path7.dirname(fileURLToPath3(import.meta.url));
  const candidates = [
    path7.join(moduleDir, "..", "bridges", "codex-app-server-auth-gateway.mjs"),
    path7.join(moduleDir, "..", "bridges", "codex-app-server-auth-gateway.ts"),
    path7.join(
      repoRoot,
      "packages",
      "tap-comms",
      "dist",
      "bridges",
      "codex-app-server-auth-gateway.mjs"
    ),
    path7.join(
      repoRoot,
      "packages",
      "tap-comms",
      "src",
      "bridges",
      "codex-app-server-auth-gateway.ts"
    )
  ];
  for (const candidate of candidates) {
    if (fs7.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}
function getBridgeRuntimeStateDir(repoRoot, instanceId) {
  return path7.join(repoRoot, ".tmp", `codex-app-server-bridge-${instanceId}`);
}
async function allocateLoopbackPort(hostname) {
  const bindHost = hostname === "localhost" ? "127.0.0.1" : hostname;
  return await new Promise((resolve8, reject) => {
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
        resolve8(port);
      });
    });
  });
}
function buildProtectedAppServerUrl(publicUrl, token) {
  const url = new URL(publicUrl);
  url.searchParams.set(APP_SERVER_AUTH_QUERY_PARAM, token);
  return url.toString().replace(/\/(?=\?|$)/, "");
}
function readGatewayTokenFromPath(tokenPath) {
  return fs7.readFileSync(tokenPath, "utf8").trim();
}
function readGatewayToken(auth) {
  if (!auth) {
    return null;
  }
  const legacyToken = auth.token;
  if (legacyToken?.trim()) {
    return legacyToken.trim();
  }
  if (!auth.tokenPath || !fs7.existsSync(auth.tokenPath)) {
    return null;
  }
  const fileToken = readGatewayTokenFromPath(auth.tokenPath);
  return fileToken || null;
}
function materializeGatewayTokenFile(stateDir, instanceId, publicUrl, auth) {
  if (auth.tokenPath && fs7.existsSync(auth.tokenPath)) {
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
  const token = randomBytes(24).toString("base64url");
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
  fs7.mkdirSync(path7.dirname(gatewayLogPath), { recursive: true });
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
  {
    let logFd = null;
    try {
      if (options.platform === "win32") {
        gatewayPid = startWindowsDetachedProcess(
          runtime.command,
          gatewayArgs,
          options.repoRoot,
          gatewayLogPath,
          gatewayEnv
        );
      } else {
        logFd = fs7.openSync(gatewayLogPath, "a");
        const child = spawn(runtime.command, gatewayArgs, {
          cwd: options.repoRoot,
          detached: true,
          stdio: ["ignore", logFd, logFd],
          env: gatewayEnv,
          windowsHide: true
        });
        child.unref();
        gatewayPid = child.pid ?? null;
      }
    } catch (error) {
      removeFileIfExists(tokenPath);
      throw error;
    } finally {
      if (logFd != null) {
        fs7.closeSync(logFd);
      }
    }
  }
  if (gatewayPid == null) {
    removeFileIfExists(tokenPath);
    throw new Error("Failed to spawn app-server auth gateway");
  }
  return {
    mode: "query-token",
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
function markAppServerHealthy(appServer) {
  const checkedAt = (/* @__PURE__ */ new Date()).toISOString();
  return {
    ...appServer,
    healthy: true,
    lastCheckedAt: checkedAt,
    lastHealthyAt: checkedAt
  };
}
function findReusableManagedAppServer(stateDir, publicUrl) {
  const pidDir = path7.join(stateDir, "pids");
  if (!fs7.existsSync(pidDir)) {
    return null;
  }
  for (const name of fs7.readdirSync(pidDir)) {
    if (!name.startsWith("bridge-") || !name.endsWith(".json")) {
      continue;
    }
    try {
      const raw = fs7.readFileSync(path7.join(pidDir, name), "utf-8");
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
function startWindowsDetachedProcess(command, args, repoRoot, logPath, env = process.env) {
  const ext = path7.extname(command).toLowerCase();
  const stderrLogPath = stderrLogFilePath(logPath);
  const stdoutFd = fs7.openSync(logPath, "a");
  const stderrFd = fs7.openSync(stderrLogPath, "a");
  try {
    const child = ext === ".ps1" ? spawn(
      resolvePowerShellCommand(),
      ["-NoLogo", "-NoProfile", "-File", command, ...args],
      {
        cwd: repoRoot,
        detached: true,
        stdio: ["ignore", stdoutFd, stderrFd],
        env,
        windowsHide: true
      }
    ) : spawn(command, args, {
      cwd: repoRoot,
      detached: true,
      stdio: ["ignore", stdoutFd, stderrFd],
      env,
      windowsHide: true,
      shell: ext === ".cmd" || ext === ".bat"
    });
    child.unref();
    return child.pid ?? null;
  } finally {
    fs7.closeSync(stdoutFd);
    fs7.closeSync(stderrFd);
  }
}
function startWindowsCodexAppServer(command, url, repoRoot, logPath) {
  return startWindowsDetachedProcess(
    command,
    ["app-server", "--listen", url],
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
  const result = spawnSync2(
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
function resolveAppServerUrl(baseUrl, port) {
  const resolvedBase = (baseUrl ?? DEFAULT_APP_SERVER_URL2).replace(/\/$/, "");
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
async function isTcpPortAvailable(hostname, port) {
  const bindHost = hostname === "localhost" ? "127.0.0.1" : hostname;
  return await new Promise((resolve8) => {
    const server = net.createServer();
    server.unref();
    server.once("error", () => resolve8(false));
    server.listen(port, bindHost, () => {
      server.close((error) => resolve8(!error));
    });
  });
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
async function checkAppServerHealth(url, timeoutMs = APP_SERVER_HEALTH_TIMEOUT_MS) {
  const WebSocket = getWebSocketCtor();
  if (!WebSocket) {
    return false;
  }
  return new Promise((resolve8) => {
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
      resolve8(healthy);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    try {
      socket = new WebSocket(url);
      socket.addEventListener("open", () => finish(true), { once: true });
      socket.addEventListener("error", () => finish(false), { once: true });
      socket.addEventListener("close", () => finish(false), { once: true });
    } catch {
      finish(false);
    }
  });
}
async function waitForAppServerHealth(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await checkAppServerHealth(url)) {
      return true;
    }
    await delay(APP_SERVER_HEALTH_RETRY_MS);
  }
  return false;
}
async function terminateProcess(pid, platform) {
  if (!isProcessAlive(pid)) {
    return false;
  }
  try {
    if (platform === "win32") {
      execSync2(`taskkill /PID ${pid} /F /T`, { stdio: "pipe" });
    } else {
      process.kill(pid, "SIGTERM");
      await delay(2e3);
      if (isProcessAlive(pid)) {
        process.kill(pid, "SIGKILL");
      }
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
  fs7.mkdirSync(path7.dirname(logPath), { recursive: true });
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
      const logFd = fs7.openSync(logPath, "a");
      try {
        const child = spawn(
          resolvedCommand,
          ["app-server", "--listen", effectiveUrl],
          {
            cwd: options.repoRoot,
            detached: true,
            stdio: ["ignore", logFd, logFd],
            env: process.env,
            windowsHide: true
          }
        );
        child.unref();
        pid2 = child.pid ?? null;
      } catch (err) {
        throw new Error(
          `Failed to spawn Codex app-server: ${err instanceof Error ? err.message : String(err)}
Start it manually:
  ${manualCommand2}`,
          { cause: err }
        );
      } finally {
        fs7.closeSync(logFd);
      }
    }
    if (pid2 == null) {
      throw new Error(
        `Failed to spawn Codex app-server.
Start it manually:
  ${manualCommand2}`
      );
    }
    const healthy2 = await waitForAppServerHealth(
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
    pid2 = findListeningProcessId(effectiveUrl, options.platform) ?? pid2;
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
      removeFileIfExists(auth.tokenPath);
      throw new Error(
        `Failed to spawn Codex app-server: ${err instanceof Error ? err.message : String(err)}
Start it manually:
  ${manualCommand}`,
        { cause: err }
      );
    }
  } else {
    const logFd = fs7.openSync(logPath, "a");
    try {
      const child = spawn(
        resolvedCommand,
        ["app-server", "--listen", auth.upstreamUrl],
        {
          cwd: options.repoRoot,
          detached: true,
          stdio: ["ignore", logFd, logFd],
          env: process.env,
          windowsHide: true
        }
      );
      child.unref();
      pid = child.pid ?? null;
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
    } finally {
      fs7.closeSync(logFd);
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
  const healthy = await waitForAppServerHealth(
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
  const gatewayHealthy = await waitForAppServerHealth(
    buildProtectedAppServerUrl(effectiveUrl, gatewayToken),
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
  pid = findListeningProcessId(auth.upstreamUrl, options.platform) ?? pid;
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
function pidFilePath(stateDir, instanceId) {
  return path7.join(stateDir, "pids", `bridge-${instanceId}.json`);
}
function logFilePath(stateDir, instanceId) {
  return path7.join(stateDir, "logs", `bridge-${instanceId}.log`);
}
function runtimeHeartbeatFilePath(runtimeStateDir) {
  return path7.join(runtimeStateDir, "heartbeat.json");
}
function loadRuntimeHeartbeatTimestamp(runtimeStateDir) {
  if (!runtimeStateDir) {
    return null;
  }
  const heartbeatPath = runtimeHeartbeatFilePath(runtimeStateDir);
  if (!fs7.existsSync(heartbeatPath)) {
    return null;
  }
  try {
    const raw = fs7.readFileSync(heartbeatPath, "utf-8");
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
  if (!fs7.existsSync(pidPath)) return null;
  try {
    const raw = fs7.readFileSync(pidPath, "utf-8");
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
  if (fs7.existsSync(pidPath)) {
    fs7.unlinkSync(pidPath);
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
function isBridgeRunning(stateDir, instanceId) {
  const state = loadBridgeState(stateDir, instanceId);
  if (!state) return false;
  return isProcessAlive(state.pid);
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
  const resolvedAgent = agentName || process.env.TAP_AGENT_NAME || process.env.CODEX_TAP_AGENT_NAME;
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
  const previousAppServer = previousBridgeState?.appServer ?? null;
  clearBridgeState(stateDir, instanceId);
  const logPath = logFilePath(stateDir, instanceId);
  fs7.mkdirSync(path7.dirname(logPath), { recursive: true });
  rotateLog(logPath);
  let logFd = null;
  const repoRoot = options.repoRoot ?? path7.resolve(stateDir, "..");
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
      ...options.threadId ? { TAP_THREAD_ID: options.threadId } : {},
      ...options.ephemeral ? { TAP_EPHEMERAL: "true" } : {},
      ...options.processExistingMessages ? { TAP_PROCESS_EXISTING: "true" } : {}
    };
    let bridgePid = null;
    if (options.platform === "win32") {
      bridgePid = startWindowsDetachedProcess(
        command,
        [bridgeScript],
        repoRoot,
        logPath,
        bridgeEnv
      );
    } else {
      logFd = fs7.openSync(logPath, "a");
      const child = spawn(command, [bridgeScript], {
        detached: true,
        stdio: ["ignore", logFd, logFd],
        env: bridgeEnv,
        windowsHide: true
      });
      child.unref();
      bridgePid = child.pid ?? null;
    }
    if (logFd != null) {
      fs7.closeSync(logFd);
      logFd = null;
    }
    if (!bridgePid) {
      throw new Error(`Failed to spawn bridge process for ${instanceId}`);
    }
    const state = {
      pid: bridgePid,
      statePath: pidFilePath(stateDir, instanceId),
      lastHeartbeat: (/* @__PURE__ */ new Date()).toISOString(),
      appServer,
      runtimeStateDir
    };
    saveBridgeState(stateDir, instanceId, state);
    return state;
  } catch (err) {
    if (logFd != null) {
      try {
        fs7.closeSync(logFd);
      } catch {
      }
    }
    if (appServer?.managed) {
      await stopManagedAppServer(appServer, options.platform);
    }
    throw err;
  }
}
async function stopBridge(options) {
  const { instanceId, stateDir, platform } = options;
  const state = loadBridgeState(stateDir, instanceId);
  if (!state) {
    return false;
  }
  if (!isProcessAlive(state.pid)) {
    clearBridgeState(stateDir, instanceId);
    return false;
  }
  try {
    await terminateProcess(state.pid, platform);
  } catch {
  }
  clearBridgeState(stateDir, instanceId);
  return true;
}
function rotateLog(logPath) {
  if (!fs7.existsSync(logPath)) return;
  try {
    const stats = fs7.statSync(logPath);
    if (stats.size === 0) return;
    const prevPath = `${logPath}.prev`;
    fs7.renameSync(logPath, prevPath);
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
var DEFAULT_APP_SERVER_URL2, APP_SERVER_HEALTH_TIMEOUT_MS, APP_SERVER_START_TIMEOUT_MS, APP_SERVER_GATEWAY_START_TIMEOUT_MS, APP_SERVER_HEALTH_RETRY_MS, APP_SERVER_AUTH_QUERY_PARAM, APP_SERVER_AUTH_FILE_MODE;
var init_bridge = __esm({
  "src/engine/bridge.ts"() {
    "use strict";
    init_common();
    init_runtime();
    DEFAULT_APP_SERVER_URL2 = "ws://127.0.0.1:4501";
    APP_SERVER_HEALTH_TIMEOUT_MS = 1500;
    APP_SERVER_START_TIMEOUT_MS = 2e4;
    APP_SERVER_GATEWAY_START_TIMEOUT_MS = 5e3;
    APP_SERVER_HEALTH_RETRY_MS = 250;
    APP_SERVER_AUTH_QUERY_PARAM = "tap_token";
    APP_SERVER_AUTH_FILE_MODE = 384;
  }
});

// src/engine/dashboard.ts
import * as fs8 from "fs";
import * as path8 from "path";
import { execSync as execSync3 } from "child_process";
function collectAgents(commsDir) {
  const heartbeatsPath = path8.join(commsDir, "heartbeats.json");
  if (!fs8.existsSync(heartbeatsPath)) return [];
  try {
    const raw = fs8.readFileSync(heartbeatsPath, "utf-8");
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
  const tmpDir = path8.join(repoRoot, ".tmp");
  if (fs8.existsSync(tmpDir)) {
    try {
      const dirs = fs8.readdirSync(tmpDir).filter((d) => d.startsWith("codex-app-server-bridge"));
      for (const dir of dirs) {
        const daemonPath = path8.join(tmpDir, dir, "bridge-daemon.json");
        if (!fs8.existsSync(daemonPath)) continue;
        try {
          const raw = fs8.readFileSync(daemonPath, "utf-8");
          const daemon = JSON.parse(raw);
          const alreadyCovered = bridges.some(
            (b) => b.pid === daemon.pid && b.pid !== null
          );
          if (alreadyCovered) continue;
          const agentFile = path8.join(tmpDir, dir, "agent-name.txt");
          const agentName = fs8.existsSync(agentFile) ? fs8.readFileSync(agentFile, "utf-8").trim() : dir;
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
var init_dashboard = __esm({
  "src/engine/dashboard.ts"() {
    "use strict";
    init_config();
    init_bridge();
    init_state();
  }
});

// src/adapters/claude.ts
import * as fs9 from "fs";
import * as path9 from "path";
import { execSync as execSync4 } from "child_process";
function findMcpJsonPath(ctx) {
  return path9.join(ctx.repoRoot, ".mcp.json");
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
  return typeof value === "string" ? path9.resolve(value).replace(/\\/g, "/") : "";
}
var MCP_SERVER_KEY, claudeAdapter;
var init_claude = __esm({
  "src/adapters/claude.ts"() {
    "use strict";
    init_state();
    init_common();
    MCP_SERVER_KEY = "tap-comms";
    claudeAdapter = {
      runtime: "claude",
      async probe(ctx) {
        const warnings = [];
        const issues = [];
        const configPath = findMcpJsonPath(ctx);
        const configExists = fs9.existsSync(configPath);
        const runtimeCommand = findClaudeCommand();
        const canWrite = configExists ? (() => {
          try {
            fs9.accessSync(configPath, fs9.constants.W_OK);
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
        if (!fs9.existsSync(ctx.commsDir)) {
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
          const raw = fs9.readFileSync(configPath, "utf-8");
          try {
            const config = JSON.parse(raw);
            if (config.mcpServers?.[MCP_SERVER_KEY]) {
              conflicts.push(
                `Existing "${MCP_SERVER_KEY}" entry in .mcp.json will be overwritten.`
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
            "tap-comms MCP server entry not found. Skipping .mcp.json patch. Reinstall @hua-labs/tap or run from a repo with packages/tap-plugin/channels/ available."
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
              if (fs9.existsSync(op.path)) {
                backupFile(op.path, plan.backupDir);
                const raw = fs9.readFileSync(op.path, "utf-8");
                try {
                  config = JSON.parse(raw);
                } catch {
                  warnings.push(
                    `${op.path} was invalid JSON. Created backup and starting fresh.`
                  );
                }
              }
              if (op.key) {
                setNestedKey(config, op.key, op.value);
              }
              const tmp = `${op.path}.tmp.${process.pid}`;
              fs9.writeFileSync(
                tmp,
                JSON.stringify(config, null, 2) + "\n",
                "utf-8"
              );
              fs9.renameSync(tmp, op.path);
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
            passed: fs9.existsSync(configPath),
            message: fs9.existsSync(configPath) ? void 0 : `${configPath} not found`
          });
          if (fs9.existsSync(configPath)) {
            try {
              const raw = fs9.readFileSync(configPath, "utf-8");
              const config = JSON.parse(raw);
              checks.push({ name: "Config is valid JSON", passed: true });
              const entry = config.mcpServers?.[MCP_SERVER_KEY];
              checks.push({
                name: "tap-comms entry present",
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
          passed: fs9.existsSync(ctx.commsDir),
          message: fs9.existsSync(ctx.commsDir) ? void 0 : `${ctx.commsDir} not found`
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
import * as fs10 from "fs";
import * as path10 from "path";
function selectorHash(selector) {
  return crypto2.createHash("sha256").update(selector).digest("hex").slice(0, 12);
}
function artifactBackupPath(backupDir, kind, selector) {
  const safeKind = kind.replace(/[^a-z-]/gi, "-");
  return path10.join(backupDir, `${safeKind}-${selectorHash(selector)}.json`);
}
function writeArtifactBackup(backupPath, payload) {
  fs10.mkdirSync(path10.dirname(backupPath), { recursive: true });
  const tmp = `${backupPath}.tmp.${process.pid}`;
  fs10.writeFileSync(tmp, JSON.stringify(payload, null, 2) + "\n", "utf-8");
  fs10.renameSync(tmp, backupPath);
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
import * as fs11 from "fs";
import * as path11 from "path";
import { fileURLToPath as fileURLToPath4 } from "url";
function findCodexConfigPath() {
  return path11.join(getHomeDir(), ".codex", "config.toml");
}
function canonicalizeTrustPath(targetPath) {
  let resolved = path11.resolve(targetPath).replace(/\//g, "\\");
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
  if (!fs11.existsSync(configPath)) return "";
  return fs11.readFileSync(configPath, "utf-8");
}
function writeTomlFile(filePath, content) {
  fs11.mkdirSync(path11.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp.${process.pid}`;
  fs11.writeFileSync(tmp, content, "utf-8");
  fs11.renameSync(tmp, filePath);
}
function verifyManagedToml(content, ctx, configPath) {
  const checks = [];
  const managed = buildManagedMcpServerSpec(ctx);
  const mainTable = extractTomlTable(content, MCP_SELECTOR);
  const envTable = extractTomlTable(content, ENV_SELECTOR);
  checks.push({
    name: "Codex config exists",
    passed: fs11.existsSync(configPath),
    message: fs11.existsSync(configPath) ? void 0 : `${configPath} not found`
  });
  checks.push({
    name: "tap-comms MCP table present",
    passed: !!mainTable,
    message: mainTable ? void 0 : `${MCP_SELECTOR} not found`
  });
  checks.push({
    name: "tap-comms env table present",
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
    checks.push({
      name: "Managed command configured",
      passed: mainTable.includes(
        `command = "${managed.command.replace(/\\/g, "\\\\")}"`
      ) && mainTable.includes(
        `args = ["${managed.args[0]?.replace(/\\/g, "\\\\") ?? ""}"]`
      ),
      message: "Managed tap-comms command/args do not match expected values"
    });
  }
  return checks;
}
var MCP_SELECTOR, ENV_SELECTOR, codexAdapter;
var init_codex = __esm({
  "src/adapters/codex.ts"() {
    "use strict";
    init_state();
    init_artifact_backups();
    init_toml();
    init_common();
    MCP_SELECTOR = "mcp_servers.tap-comms";
    ENV_SELECTOR = "mcp_servers.tap-comms.env";
    codexAdapter = {
      runtime: "codex",
      async probe(ctx) {
        const warnings = [];
        const issues = [];
        const configPath = findCodexConfigPath();
        const configExists = fs11.existsSync(configPath);
        const runtimeProbe = probeCommand(
          ctx.platform === "win32" ? ["codex", "codex.cmd"] : ["codex"]
        );
        if (!runtimeProbe.command) {
          warnings.push(
            "Codex CLI not found in PATH. Config can still be written, but runtime verification will be limited."
          );
        }
        if (!fs11.existsSync(ctx.commsDir)) {
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
        const existingContent = readConfigOrEmpty(configPath);
        if (fs11.existsSync(configPath) && existingContent) {
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
        nextContent = replaceTomlTable(
          nextContent,
          MCP_SELECTOR,
          renderTomlTable(
            MCP_SELECTOR,
            {
              command: managed.command,
              args: managed.args
            },
            extractTomlTable(existingContent, MCP_SELECTOR)
          )
        );
        nextContent = replaceTomlTable(
          nextContent,
          ENV_SELECTOR,
          renderTomlTable(
            ENV_SELECTOR,
            managed.env,
            extractTomlTable(existingContent, ENV_SELECTOR)
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
          passed: fs11.existsSync(ctx.commsDir),
          message: fs11.existsSync(ctx.commsDir) ? void 0 : `${ctx.commsDir} not found`
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
        const distDir = path11.dirname(fileURLToPath4(import.meta.url));
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
          if (fs11.existsSync(candidate)) return candidate;
        }
        return null;
      }
    };
  }
});

// src/adapters/gemini.ts
import * as fs12 from "fs";
import * as path12 from "path";
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
  if (fs12.existsSync(workspaceConfig)) return workspaceConfig;
  if (fs12.existsSync(homeConfig)) return homeConfig;
  if (fs12.existsSync(antigravityConfig)) {
    const raw = fs12.readFileSync(antigravityConfig, "utf-8").trim();
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
  if (!fs12.existsSync(filePath)) return {};
  const raw = fs12.readFileSync(filePath, "utf-8").trim();
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
    passed: fs12.existsSync(configPath),
    message: fs12.existsSync(configPath) ? void 0 : `${configPath} not found`
  });
  checks.push({
    name: "tap-comms entry present",
    passed: !!entry,
    message: entry ? void 0 : `${GEMINI_SELECTOR} not found`
  });
  checks.push({
    name: "Comms directory exists",
    passed: fs12.existsSync(ctx.commsDir),
    message: fs12.existsSync(ctx.commsDir) ? void 0 : `${ctx.commsDir} not found`
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
var GEMINI_SELECTOR, geminiAdapter;
var init_gemini = __esm({
  "src/adapters/gemini.ts"() {
    "use strict";
    init_state();
    init_artifact_backups();
    init_common();
    GEMINI_SELECTOR = "mcpServers.tap-comms";
    geminiAdapter = {
      runtime: "gemini",
      async probe(ctx) {
        const warnings = [];
        const issues = [];
        const configPath = chooseGeminiConfigPath(ctx);
        const configExists = fs12.existsSync(configPath);
        const runtimeProbe = probeCommand(
          ctx.platform === "win32" ? ["gemini", "gemini.cmd"] : ["gemini"]
        );
        if (!runtimeProbe.command) {
          warnings.push(
            "Gemini CLI not found in PATH. Config can still be written, but runtime verification will be limited."
          );
        }
        if (!fs12.existsSync(ctx.commsDir)) {
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
        if (fs12.existsSync(configPath)) {
          if (fs12.readFileSync(configPath, "utf-8").trim()) {
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
        setNestedKey2(config, GEMINI_SELECTOR, {
          command: managed.command,
          args: managed.args,
          env: managed.env
        });
        fs12.mkdirSync(path12.dirname(configPath), { recursive: true });
        const tmp = `${configPath}.tmp.${process.pid}`;
        fs12.writeFileSync(tmp, JSON.stringify(config, null, 2) + "\n", "utf-8");
        fs12.renameSync(tmp, configPath);
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

// src/commands/bridge.ts
import * as path13 from "path";
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
      parsed.searchParams.set("tap_token", "***");
    }
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return url.replace(/tap_token=[^&]+/g, "tap_token=***");
  }
}
function loadCurrentBridgeState(stateDir, instanceId, fallback) {
  return loadBridgeState(stateDir, instanceId) ?? fallback ?? null;
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
  const resolvedAgentName = agentName ?? instance.agentName ?? void 0;
  if (agentName && agentName !== instance.agentName) {
    instance = { ...instance, agentName };
    const updatedState = updateInstanceState(state, instanceId, instance);
    saveState(repoRoot, updatedState);
    state = updatedState;
  }
  const ctx = createAdapterContext(state.commsDir, repoRoot);
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
    const pollSeconds = typeof flags["poll-seconds"] === "string" ? parseInt(flags["poll-seconds"], 10) : void 0;
    const reconnectSeconds = typeof flags["reconnect-seconds"] === "string" ? parseInt(flags["reconnect-seconds"], 10) : void 0;
    const messageLookbackMinutes = typeof flags["message-lookback-minutes"] === "string" ? parseInt(flags["message-lookback-minutes"], 10) : void 0;
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
    const bridge = await startBridge({
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
      processExistingMessages
    });
    logSuccess(`Bridge started (PID: ${bridge.pid})`);
    log(`Log: ${path13.join(ctx.stateDir, "logs", `bridge-${instanceId}.log`)}`);
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
    const updated = { ...instance, bridge };
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
  const instanceIds = Object.keys(state.instances);
  const appServerInstances = instanceIds.filter((id) => {
    const inst = state.instances[id];
    if (!inst?.installed) return false;
    const adapter = getAdapter(inst.runtime);
    return adapter.bridgeMode() === "app-server";
  });
  if (appServerInstances.length === 0) {
    return {
      ok: true,
      command: "bridge",
      code: "TAP_NO_OP",
      message: "No app-server instances found to start.",
      warnings: [],
      data: {}
    };
  }
  logHeader("@hua-labs/tap bridge start --all");
  log(
    `Found ${appServerInstances.length} app-server instance(s): ${appServerInstances.join(", ")}`
  );
  log("");
  const started = [];
  const failed = [];
  const warnings = [];
  for (const instanceId of appServerInstances) {
    const inst = state.instances[instanceId];
    const storedName = inst?.agentName ?? void 0;
    if (!storedName) {
      const msg = `${instanceId}: skipped \u2014 no stored agent-name. Set it first: tap bridge start ${instanceId} --agent-name <name>`;
      log(msg);
      warnings.push(msg);
      continue;
    }
    log(`Starting ${instanceId} (agent: ${storedName})...`);
    const result = await bridgeStart(instanceId, storedName, flags);
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
  return {
    ok: failed.length === 0 && started.length > 0,
    command: "bridge",
    code: started.length > 0 ? "TAP_BRIDGE_START_OK" : "TAP_BRIDGE_START_FAILED",
    message,
    warnings,
    data: { started, failed }
  };
}
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
  const stopped = await stopBridge({
    instanceId,
    stateDir: ctx.stateDir,
    platform: ctx.platform
  });
  let appServerStopped = false;
  let appServerTransferredTo = null;
  if (stopped) {
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
      }
    }
  }
  if (instance) {
    const updated = { ...instance, bridge: null };
    const newState = updateInstanceState(state, instanceId, updated);
    saveState(repoRoot, newState);
  }
  if (stopped) {
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
    const didStop = await stopBridge({
      instanceId,
      stateDir: ctx.stateDir,
      platform: ctx.platform
    });
    if (didStop) {
      logSuccess(`Stopped bridge for ${instanceId}`);
      stopped.push(instanceId);
    }
    const instance = state.instances[instanceId];
    if (instance?.bridge) {
      state.instances[instanceId] = { ...instance, bridge: null };
      stateChanged = true;
    }
  }
  const stoppedAppServers = [];
  for (const appServer of managedAppServers.values()) {
    if (await stopManagedAppServer(appServer, ctx.platform)) {
      stoppedAppServers.push(appServer.pid);
      const gatewayNote = appServer.auth?.gatewayPid != null ? `, gateway PID ${appServer.auth.gatewayPid}` : "";
      logSuccess(
        `Stopped app-server PID ${appServer.pid} (${appServer.url}${gatewayNote})`
      );
    }
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
    `${"Instance".padEnd(20)} ${"Runtime".padEnd(8)} ${"Status".padEnd(10)} ${"PID".padEnd(8)} ${"Port".padEnd(6)} ${"Last Heartbeat"}`
  );
  log(
    `${"\u2500".repeat(20)} ${"\u2500".repeat(8)} ${"\u2500".repeat(10)} ${"\u2500".repeat(8)} ${"\u2500".repeat(6)} ${"\u2500".repeat(20)}`
  );
  for (const instanceId of instanceIds) {
    const inst = state.instances[instanceId];
    if (!inst?.installed) continue;
    if (inst.bridgeMode !== "app-server") {
      log(
        `${instanceId.padEnd(20)} ${inst.runtime.padEnd(8)} ${"n/a".padEnd(10)} ${"-".padEnd(8)} ${"-".padEnd(6)} ${inst.bridgeMode} mode`
      );
      bridges[instanceId] = {
        status: "n/a",
        runtime: inst.runtime,
        pid: null,
        port: inst.port,
        lastHeartbeat: null,
        appServer: null
      };
      continue;
    }
    const status = getBridgeStatus(stateDir, instanceId);
    const bridgeState = loadBridgeState(stateDir, instanceId);
    const age = getHeartbeatAge(stateDir, instanceId);
    const pid = bridgeState?.pid ?? null;
    const heartbeat = getBridgeHeartbeatTimestamp(stateDir, instanceId);
    const pidStr = pid ? String(pid) : "-";
    const portStr = inst.port ? String(inst.port) : "-";
    const ageStr = age !== null ? formatAge(age) : "-";
    const statusColor = status === "running" ? "running" : status === "stale" ? "stale!" : "stopped";
    log(
      `${instanceId.padEnd(20)} ${inst.runtime.padEnd(8)} ${statusColor.padEnd(10)} ${pidStr.padEnd(8)} ${portStr.padEnd(6)} ${ageStr}`
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
    bridges[instanceId] = {
      status,
      runtime: inst.runtime,
      pid,
      port: inst.port,
      lastHeartbeat: heartbeat,
      appServer: bridgeState?.appServer ?? null
    };
  }
  if (instanceIds.length === 0) {
    log("No instances installed.");
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
        bridgeMode: inst.bridgeMode,
        pid: null,
        port: inst.port,
        lastHeartbeat: null,
        appServer: null
      }
    };
  }
  const { config: resolvedCfg2 } = resolveConfig({}, repoRoot);
  const stateDir = resolvedCfg2.stateDir;
  const status = getBridgeStatus(stateDir, instanceId);
  const bridgeState = loadBridgeState(stateDir, instanceId);
  const age = getHeartbeatAge(stateDir, instanceId);
  const heartbeat = getBridgeHeartbeatTimestamp(stateDir, instanceId);
  log(`Status:      ${status}`);
  if (bridgeState) {
    log(`PID:         ${bridgeState.pid}`);
    log(
      `Heartbeat:   ${heartbeat ?? "-"}${age !== null ? ` (${formatAge(age)})` : ""}`
    );
    log(
      `Log:         ${path13.join(stateDir, "logs", `bridge-${instanceId}.log`)}`
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
      bridgeMode: inst.bridgeMode,
      pid: bridgeState?.pid ?? null,
      port: inst.port,
      lastHeartbeat: heartbeat,
      appServer: bridgeState?.appServer ?? null
    }
  };
}
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
    default:
      return {
        ok: false,
        command: "bridge",
        code: "TAP_INVALID_ARGUMENT",
        message: `Unknown bridge subcommand: ${subcommand}. Use: start, stop, status`,
        warnings: [],
        data: {}
      };
  }
}
var BRIDGE_HELP;
var init_bridge2 = __esm({
  "src/commands/bridge.ts"() {
    "use strict";
    init_state();
    init_bridge();
    init_config();
    init_adapters();
    init_utils();
    BRIDGE_HELP = `
Usage:
  tap-comms bridge <subcommand> [instance] [options]

Subcommands:
  start <instance>  Start bridge for an instance (e.g. codex, codex-reviewer)
  start --all       Start all registered app-server instances
  stop  <instance>  Stop bridge for an instance
  stop              Stop all running bridges
  status            Show bridge status for all instances
  status <instance> Show bridge status for a specific instance

Options:
  --agent-name <name>              Agent identity for bridge (or set TAP_AGENT_NAME env)
                                   Saved to state \u2014 only needed on first start
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
`.trim();
  }
});

// src/commands/up.ts
var up_exports = {};
__export(up_exports, {
  upCommand: () => upCommand
});
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
  const result = await bridgeCommand(["start", "--all", ...args]);
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
    message: `tap up: ${activeBridges} bridge(s) running`,
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
  tap-comms up [bridge-start options]

Description:
  Start all registered app-server bridge daemons with one command.
  This is the orchestration entrypoint for headless/background TAP operation.

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
  tap-comms down

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

// src/index.ts
init_config();
init_bridge();
init_dashboard();

// src/api/state.ts
init_dashboard();
init_utils();
init_config();
function getDashboardSnapshot(options) {
  const repoRoot = options?.repoRoot ?? findRepoRoot();
  return collectDashboardSnapshot(repoRoot, options?.commsDir);
}
async function* streamEvents(options) {
  const intervalMs = options?.intervalMs ?? 2e3;
  const repoRoot = options?.repoRoot ?? findRepoRoot();
  while (!options?.signal?.aborted) {
    yield collectDashboardSnapshot(repoRoot, options?.commsDir);
    await new Promise((resolve8) => {
      const onAbort = () => {
        clearTimeout(timer);
        resolve8();
      };
      const timer = setTimeout(() => {
        options?.signal?.removeEventListener("abort", onAbort);
        resolve8();
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
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
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
      try {
        if (req.method === "GET") {
          switch (pathname) {
            case "/api/snapshot":
              handleSnapshot(res, apiOptions);
              return;
            case "/api/events":
              await handleEvents(req, res, apiOptions);
              return;
            case "/api/config":
              handleConfig(res, apiOptions);
              return;
            case "/health":
              handleHealth(res);
              return;
          }
        }
        if (req.method === "POST") {
          const contentType = req.headers["content-type"] ?? "";
          if (!contentType.includes("application/json")) {
            jsonResponse(
              res,
              { error: "Content-Type must be application/json" },
              415
            );
            return;
          }
          switch (pathname) {
            case "/api/start":
              jsonResponse(res, await startAgents());
              return;
            case "/api/stop":
              jsonResponse(res, await stopAgents());
              return;
          }
        }
        jsonResponse(res, { error: "Not found" }, 404);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        jsonResponse(res, { error: message }, 500);
      }
    }
  );
  await new Promise((resolve8, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.removeListener("error", reject);
      resolve8();
    });
  });
  return {
    port,
    close: () => new Promise((resolve8, reject) => {
      server.close((err) => err ? reject(err) : resolve8());
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
  startAgents,
  startHttpServer,
  stateExists,
  stopAgents,
  streamEvents,
  updateBridgeHeartbeat,
  version
};
//# sourceMappingURL=index.mjs.map