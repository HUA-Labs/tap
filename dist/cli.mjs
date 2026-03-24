// src/commands/init.ts
import * as fs5 from "fs";
import * as path5 from "path";

// src/state.ts
import * as fs2 from "fs";
import * as path2 from "path";
import * as crypto from "crypto";

// src/config/resolve.ts
import * as fs from "fs";
import * as path from "path";
var SHARED_CONFIG_FILE = "tap-config.json";
var LOCAL_CONFIG_FILE = "tap-config.local.json";
var DEFAULT_RUNTIME_COMMAND = "node";
var DEFAULT_APP_SERVER_URL = "ws://127.0.0.1:4501";
function findRepoRoot(startDir = process.cwd()) {
  let dir = path.resolve(startDir);
  while (true) {
    if (fs.existsSync(path.join(dir, ".git"))) return dir;
    if (fs.existsSync(path.join(dir, "package.json"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}
function loadJsonFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
function loadSharedConfig(repoRoot) {
  return loadJsonFile(path.join(repoRoot, SHARED_CONFIG_FILE));
}
function loadLocalConfig(repoRoot) {
  return loadJsonFile(path.join(repoRoot, LOCAL_CONFIG_FILE));
}
function resolveConfig(overrides = {}, startDir) {
  const repoRoot = findRepoRoot(startDir);
  const shared = loadSharedConfig(repoRoot) ?? {};
  const local = loadLocalConfig(repoRoot) ?? {};
  const sources = {
    repoRoot: "auto",
    commsDir: "auto",
    stateDir: "auto",
    runtimeCommand: "auto",
    appServerUrl: "auto"
  };
  let commsDir;
  if (overrides.commsDir) {
    commsDir = path.resolve(overrides.commsDir);
    sources.commsDir = "cli-flag";
  } else if (process.env.TAP_COMMS_DIR) {
    commsDir = path.resolve(process.env.TAP_COMMS_DIR);
    sources.commsDir = "env";
  } else if (local.commsDir) {
    commsDir = resolvePath(repoRoot, local.commsDir);
    sources.commsDir = "local-config";
  } else if (shared.commsDir) {
    commsDir = resolvePath(repoRoot, shared.commsDir);
    sources.commsDir = "shared-config";
  } else {
    commsDir = path.join(path.dirname(repoRoot), "tap-comms");
  }
  let stateDir;
  if (overrides.stateDir) {
    stateDir = path.resolve(overrides.stateDir);
    sources.stateDir = "cli-flag";
  } else if (process.env.TAP_STATE_DIR) {
    stateDir = path.resolve(process.env.TAP_STATE_DIR);
    sources.stateDir = "env";
  } else if (local.stateDir) {
    stateDir = resolvePath(repoRoot, local.stateDir);
    sources.stateDir = "local-config";
  } else if (shared.stateDir) {
    stateDir = resolvePath(repoRoot, shared.stateDir);
    sources.stateDir = "shared-config";
  } else {
    stateDir = path.join(repoRoot, ".tap-comms");
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
function resolvePath(repoRoot, p) {
  return path.isAbsolute(p) ? p : path.resolve(repoRoot, p);
}

// src/state.ts
var STATE_FILE = "state.json";
var SCHEMA_VERSION = 2;
function getStateDir(repoRoot) {
  const { config } = resolveConfig({}, repoRoot);
  return config.stateDir;
}
function getStatePath(repoRoot) {
  return path2.join(getStateDir(repoRoot), STATE_FILE);
}
function stateExists(repoRoot) {
  return fs2.existsSync(getStatePath(repoRoot));
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
  if (!fs2.existsSync(statePath)) return null;
  const raw = fs2.readFileSync(statePath, "utf-8");
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
  fs2.mkdirSync(stateDir, { recursive: true });
  const statePath = getStatePath(repoRoot);
  const tmp = `${statePath}.tmp.${process.pid}`;
  fs2.writeFileSync(tmp, JSON.stringify(state, null, 2), "utf-8");
  fs2.renameSync(tmp, statePath);
}
function createInitialState(commsDir, repoRoot, packageVersion) {
  const now = (/* @__PURE__ */ new Date()).toISOString();
  return {
    schemaVersion: SCHEMA_VERSION,
    createdAt: now,
    updatedAt: now,
    commsDir: path2.resolve(commsDir),
    repoRoot: path2.resolve(repoRoot),
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
  const backupDir = path2.join(stateDir, "backups", instanceId);
  fs2.mkdirSync(backupDir, { recursive: true });
  return backupDir;
}
function backupFile(filePath, backupDir) {
  const basename3 = path2.basename(filePath);
  const hash = fileHash(filePath);
  const backupPath = path2.join(backupDir, `${basename3}.${hash}.bak`);
  fs2.copyFileSync(filePath, backupPath);
  return backupPath;
}
function fileHash(filePath) {
  if (!fs2.existsSync(filePath)) return "";
  const content = fs2.readFileSync(filePath);
  return crypto.createHash("sha256").update(content).digest("hex").slice(0, 16);
}

// src/utils.ts
import * as fs3 from "fs";
import * as path3 from "path";
var VALID_RUNTIMES = ["claude", "codex", "gemini"];
function isValidRuntime(name) {
  return VALID_RUNTIMES.includes(name);
}
function detectPlatform() {
  return process.platform;
}
function findRepoRoot2(startDir = process.cwd()) {
  let dir = path3.resolve(startDir);
  while (true) {
    if (fs3.existsSync(path3.join(dir, ".git"))) return dir;
    if (fs3.existsSync(path3.join(dir, "package.json"))) return dir;
    const parent = path3.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}
function resolveCommsDir(args, repoRoot) {
  const idx = args.indexOf("--comms-dir");
  if (idx !== -1 && args[idx + 1]) {
    return path3.resolve(args[idx + 1]);
  }
  const { config } = resolveConfig({}, repoRoot);
  return config.commsDir;
}
function createAdapterContext(commsDir, repoRoot) {
  const { config } = resolveConfig({}, repoRoot);
  return {
    commsDir: path3.resolve(commsDir),
    repoRoot: path3.resolve(repoRoot),
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
var _jsonMode = false;
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
function buildInstanceId(runtime, name) {
  return name ? `${runtime}-${name}` : runtime;
}
function findPortConflict(state, port, excludeInstanceId) {
  for (const [id, inst] of Object.entries(state.instances)) {
    if (id !== excludeInstanceId && inst.port === port) return id;
  }
  return null;
}

// src/version.ts
var version = "0.1.0";

// src/permissions.ts
import * as fs4 from "fs";
import * as path4 from "path";
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
  const claudeDir = path4.join(repoRoot, ".claude");
  const settingsPath = path4.join(claudeDir, "settings.local.json");
  fs4.mkdirSync(claudeDir, { recursive: true });
  let settings = {};
  if (fs4.existsSync(settingsPath)) {
    try {
      settings = JSON.parse(fs4.readFileSync(settingsPath, "utf-8"));
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
    fs4.writeFileSync(tmp2, JSON.stringify(settings, null, 2) + "\n", "utf-8");
    fs4.renameSync(tmp2, settingsPath);
    logWarn("Claude: full mode \u2014 tap deny rules removed. Use with caution.");
    warnings.push("Full permission mode: tap deny rules removed.");
    return { applied: true, warnings };
  }
  const newDeny = [.../* @__PURE__ */ new Set([...existingDeny, ...CLAUDE_DENY_RULES])];
  settings.deny = newDeny;
  const tmp = `${settingsPath}.tmp.${process.pid}`;
  fs4.writeFileSync(tmp, JSON.stringify(settings, null, 2) + "\n", "utf-8");
  fs4.renameSync(tmp, settingsPath);
  logSuccess(
    `Claude: ${CLAUDE_DENY_RULES.length} deny rules applied to .claude/settings.local.json`
  );
  return { applied: true, warnings };
}
function findCodexConfigPath() {
  return path4.join(os.homedir(), ".codex", "config.toml");
}
function canonicalizeTrustPath(targetPath) {
  let resolved = path4.resolve(targetPath).replace(/\//g, "\\");
  const driveRoot = /^[A-Za-z]:\\$/;
  if (!driveRoot.test(resolved)) {
    resolved = resolved.replace(/\\+$/g, "");
  }
  return resolved.startsWith("\\\\?\\") ? resolved : `\\\\?\\${resolved}`;
}
function applyCodexPermissions(repoRoot, commsDir, mode) {
  const warnings = [];
  const configPath = findCodexConfigPath();
  fs4.mkdirSync(path4.dirname(configPath), { recursive: true });
  let content = "";
  if (fs4.existsSync(configPath)) {
    content = fs4.readFileSync(configPath, "utf-8");
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
  fs4.writeFileSync(tmp, content, "utf-8");
  fs4.renameSync(tmp, configPath);
  const modeLabel = mode === "full" ? "danger-full-access" : "workspace-write, network=full";
  logSuccess(
    `Codex: sandbox=${modeLabel}, ${trustTargets.length} path(s) trusted`
  );
  return { applied: true, warnings };
}
function getCodexWritableRoots(repoRoot, commsDir) {
  const roots = [repoRoot, commsDir];
  const parent = path4.dirname(repoRoot);
  for (let i = 1; i <= 4; i++) {
    const wtPath = path4.join(parent, `hua-wt-${i}`);
    if (fs4.existsSync(wtPath)) roots.push(wtPath);
  }
  return [...new Set(roots.map((r) => path4.resolve(r)))];
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
async function initCommand(args) {
  const repoRoot = findRepoRoot2();
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
  log(`Comms directory: ${commsDir}`);
  for (const dir of COMMS_DIRS) {
    const dirPath = path5.join(commsDir, dir);
    fs5.mkdirSync(dirPath, { recursive: true });
    logSuccess(`Created ${dir}/`);
  }
  const gitignorePath = path5.join(commsDir, ".gitignore");
  if (!fs5.existsSync(gitignorePath)) {
    fs5.writeFileSync(
      gitignorePath,
      ["tap.db", ".lock", "*.tmp.*", ".DS_Store"].join("\n") + "\n",
      "utf-8"
    );
    logSuccess("Created .gitignore");
  }
  const { config } = resolveConfig({}, repoRoot);
  const stateDir = config.stateDir;
  fs5.mkdirSync(path5.join(stateDir, "pids"), { recursive: true });
  fs5.mkdirSync(path5.join(stateDir, "logs"), { recursive: true });
  fs5.mkdirSync(path5.join(stateDir, "backups"), { recursive: true });
  const stateDirRel = path5.relative(repoRoot, stateDir);
  logSuccess(`Created ${stateDirRel}/ state directory`);
  const repoGitignore = path5.join(repoRoot, ".gitignore");
  const gitignoreEntries = [
    { entry: stateDirRel.replace(/\\/g, "/") + "/", label: "tap-comms state" },
    {
      entry: "tap-config.local.json",
      label: "tap-comms local config (machine-specific)"
    }
  ];
  if (fs5.existsSync(repoGitignore)) {
    const content = fs5.readFileSync(repoGitignore, "utf-8");
    for (const { entry, label } of gitignoreEntries) {
      if (!content.includes(entry)) {
        fs5.appendFileSync(repoGitignore, `
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

// src/adapters/claude.ts
import * as fs6 from "fs";
import * as path6 from "path";
import { execSync } from "child_process";
var MCP_SERVER_KEY = "tap-comms";
function findMcpJsonPath(ctx) {
  return path6.join(ctx.repoRoot, ".mcp.json");
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
  const localChannels = findLocalChannels(ctx);
  if (!localChannels) return null;
  return {
    type: "stdio",
    command: "npx",
    args: ["bun", localChannels],
    env: { TAP_COMMS_DIR: ctx.commsDir }
  };
}
function findLocalChannels(ctx) {
  const candidates = [
    path6.join(
      ctx.repoRoot,
      "packages",
      "tap-plugin",
      "channels",
      "tap-comms.ts"
    ),
    path6.join(
      ctx.repoRoot,
      "node_modules",
      "@hua-labs",
      "channels",
      "tap-comms.ts"
    )
  ];
  for (const p of candidates) {
    if (fs6.existsSync(p)) return p;
  }
  return null;
}
var claudeAdapter = {
  runtime: "claude",
  async probe(ctx) {
    const warnings = [];
    const issues = [];
    const configPath = findMcpJsonPath(ctx);
    const configExists = fs6.existsSync(configPath);
    const runtimeCommand = findClaudeCommand();
    const canWrite = configExists ? (() => {
      try {
        fs6.accessSync(configPath, fs6.constants.W_OK);
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
    const localChannels = findLocalChannels(ctx);
    if (!localChannels) {
      issues.push(
        "tap-comms MCP server not found locally. Ensure packages/tap-plugin/channels/tap-comms.ts exists. Run from the monorepo root."
      );
    }
    if (!fs6.existsSync(ctx.commsDir)) {
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
      const raw = fs6.readFileSync(configPath, "utf-8");
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
        "tap-comms MCP server not found locally. Skipping .mcp.json patch. Run from monorepo root with packages/tap-plugin/channels/ available."
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
          if (fs6.existsSync(op.path)) {
            backupFile(op.path, plan.backupDir);
            const raw = fs6.readFileSync(op.path, "utf-8");
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
          fs6.writeFileSync(
            tmp,
            JSON.stringify(config, null, 2) + "\n",
            "utf-8"
          );
          fs6.renameSync(tmp, op.path);
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
        passed: fs6.existsSync(configPath),
        message: fs6.existsSync(configPath) ? void 0 : `${configPath} not found`
      });
      if (fs6.existsSync(configPath)) {
        try {
          const raw = fs6.readFileSync(configPath, "utf-8");
          const config = JSON.parse(raw);
          checks.push({ name: "Config is valid JSON", passed: true });
          const entry = config.mcpServers?.[MCP_SERVER_KEY];
          checks.push({
            name: "tap-comms entry present",
            passed: !!entry,
            message: entry ? void 0 : `mcpServers.${MCP_SERVER_KEY} not found`
          });
          if (entry) {
            const hasCommsDir = entry.env?.TAP_COMMS_DIR === ctx.commsDir;
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
      passed: fs6.existsSync(ctx.commsDir),
      message: fs6.existsSync(ctx.commsDir) ? void 0 : `${ctx.commsDir} not found`
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

// src/adapters/codex.ts
import * as fs9 from "fs";
import * as path9 from "path";
import { fileURLToPath } from "url";

// src/artifact-backups.ts
import * as crypto2 from "crypto";
import * as fs7 from "fs";
import * as path7 from "path";
function selectorHash(selector) {
  return crypto2.createHash("sha256").update(selector).digest("hex").slice(0, 12);
}
function artifactBackupPath(backupDir, kind, selector) {
  const safeKind = kind.replace(/[^a-z-]/gi, "-");
  return path7.join(backupDir, `${safeKind}-${selectorHash(selector)}.json`);
}
function writeArtifactBackup(backupPath, payload) {
  fs7.mkdirSync(path7.dirname(backupPath), { recursive: true });
  const tmp = `${backupPath}.tmp.${process.pid}`;
  fs7.writeFileSync(tmp, JSON.stringify(payload, null, 2) + "\n", "utf-8");
  fs7.renameSync(tmp, backupPath);
}
function readArtifactBackup(backupPath) {
  if (!fs7.existsSync(backupPath)) return null;
  try {
    const raw = fs7.readFileSync(backupPath, "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// src/adapters/common.ts
import * as fs8 from "fs";
import * as os2 from "os";
import * as path8 from "path";
import { spawnSync } from "child_process";
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
  return os2.homedir();
}
function toForwardSlashPath(filePath) {
  return path8.resolve(filePath).replace(/\\/g, "/");
}
function canWriteOrCreate(filePath) {
  try {
    if (fs8.existsSync(filePath)) {
      fs8.accessSync(filePath, fs8.constants.W_OK);
      return true;
    }
    const parent = path8.dirname(filePath);
    fs8.mkdirSync(parent, { recursive: true });
    fs8.accessSync(parent, fs8.constants.W_OK);
    return true;
  } catch {
    return false;
  }
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
    if (fs8.existsSync(candidate)) return candidate;
  }
  return null;
}
function findPreferredBunCommand() {
  const home = getHomeDir();
  const candidates = process.platform === "win32" ? [path8.join(home, ".bun", "bin", "bun.exe"), "bun", "bun.cmd"] : [path8.join(home, ".bun", "bin", "bun"), "bun"];
  for (const candidate of candidates) {
    if (path8.isAbsolute(candidate) && !fs8.existsSync(candidate)) continue;
    const result = spawnSync(candidate, ["--version"], {
      encoding: "utf-8",
      shell: process.platform === "win32"
    });
    if (result.status === 0) {
      return path8.isAbsolute(candidate) ? toForwardSlashPath(candidate) : candidate;
    }
  }
  return null;
}
function buildManagedMcpServerSpec(ctx) {
  const sourcePath = findLocalTapCommsSource(ctx);
  const bunCommand = findPreferredBunCommand();
  const warnings = [];
  const issues = [];
  if (sourcePath && bunCommand) {
    return {
      command: bunCommand,
      args: [toForwardSlashPath(sourcePath)],
      env: {
        TAP_AGENT_NAME: "<set-per-session>",
        TAP_COMMS_DIR: toForwardSlashPath(ctx.commsDir)
      },
      sourcePath,
      warnings,
      issues
    };
  }
  if (!sourcePath) {
    issues.push(
      "tap-comms MCP server source not found. v1 requires a repo-local tap-plugin/channels installation."
    );
  }
  if (!bunCommand) {
    issues.push("bun is required to run the repo-local tap-comms MCP server.");
  }
  return {
    command: null,
    args: [],
    env: {
      TAP_AGENT_NAME: "<set-per-session>",
      TAP_COMMS_DIR: toForwardSlashPath(ctx.commsDir)
    },
    sourcePath,
    warnings,
    issues
  };
}

// src/adapters/codex.ts
var MCP_SELECTOR = "mcp_servers.tap-comms";
var ENV_SELECTOR = "mcp_servers.tap-comms.env";
function findCodexConfigPath2() {
  return path9.join(getHomeDir(), ".codex", "config.toml");
}
function canonicalizeTrustPath2(targetPath) {
  let resolved = path9.resolve(targetPath).replace(/\//g, "\\");
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
  return [...new Set(targets.map((value) => path9.resolve(value)))];
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
  if (!fs9.existsSync(configPath)) return "";
  return fs9.readFileSync(configPath, "utf-8");
}
function writeTomlFile(filePath, content) {
  fs9.mkdirSync(path9.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp.${process.pid}`;
  fs9.writeFileSync(tmp, content, "utf-8");
  fs9.renameSync(tmp, filePath);
}
function verifyManagedToml(content, ctx, configPath) {
  const checks = [];
  const managed = buildManagedMcpServerSpec(ctx);
  const mainTable = extractTomlTable(content, MCP_SELECTOR);
  const envTable = extractTomlTable(content, ENV_SELECTOR);
  checks.push({
    name: "Codex config exists",
    passed: fs9.existsSync(configPath),
    message: fs9.existsSync(configPath) ? void 0 : `${configPath} not found`
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
      name: `Trust table present: ${canonicalizeTrustPath2(target)}`,
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
var codexAdapter = {
  runtime: "codex",
  async probe(ctx) {
    const warnings = [];
    const issues = [];
    const configPath = findCodexConfigPath2();
    const configExists = fs9.existsSync(configPath);
    const runtimeProbe = probeCommand(
      ctx.platform === "win32" ? ["codex", "codex.cmd"] : ["codex"]
    );
    if (!runtimeProbe.command) {
      warnings.push(
        "Codex CLI not found in PATH. Config can still be written, but runtime verification will be limited."
      );
    }
    if (!fs9.existsSync(ctx.commsDir)) {
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
    const managed = buildManagedMcpServerSpec(ctx);
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
    if (fs9.existsSync(configPath) && existingContent) {
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
    const configPath = plan.operations[0]?.path ?? findCodexConfigPath2();
    const content = readConfigOrEmpty(configPath);
    const runtimeProbe = probeCommand(
      ctx.platform === "win32" ? ["codex", "codex.cmd"] : ["codex"]
    );
    const checks = verifyManagedToml(content, ctx, configPath);
    checks.push({
      name: "Comms directory exists",
      passed: fs9.existsSync(ctx.commsDir),
      message: fs9.existsSync(ctx.commsDir) ? void 0 : `${ctx.commsDir} not found`
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
    const distDir = path9.dirname(fileURLToPath(import.meta.url));
    const candidates = [
      // 1. Relative to bundled CLI (npm install / npx)
      path9.join(distDir, "bridges", "codex-bridge-runner.mjs"),
      // 2. Monorepo development — dist inside repo
      path9.join(
        ctx.repoRoot,
        "packages",
        "tap-comms",
        "dist",
        "bridges",
        "codex-bridge-runner.mjs"
      ),
      // 3. Source file — dev mode with strip-types
      path9.join(
        ctx.repoRoot,
        "packages",
        "tap-comms",
        "src",
        "bridges",
        "codex-bridge-runner.ts"
      )
    ];
    for (const candidate of candidates) {
      if (fs9.existsSync(candidate)) return candidate;
    }
    return null;
  }
};

// src/adapters/gemini.ts
import * as fs10 from "fs";
import * as path10 from "path";
var GEMINI_SELECTOR = "mcpServers.tap-comms";
function candidateConfigPaths(ctx) {
  const home = getHomeDir();
  return [
    path10.join(ctx.repoRoot, ".gemini", "settings.json"),
    path10.join(home, ".gemini", "settings.json"),
    path10.join(home, ".gemini", "antigravity", "mcp_config.json")
  ];
}
function chooseGeminiConfigPath(ctx) {
  const [workspaceConfig, homeConfig, antigravityConfig] = candidateConfigPaths(ctx);
  if (fs10.existsSync(workspaceConfig)) return workspaceConfig;
  if (fs10.existsSync(homeConfig)) return homeConfig;
  if (fs10.existsSync(antigravityConfig)) {
    const raw = fs10.readFileSync(antigravityConfig, "utf-8").trim();
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
  if (!fs10.existsSync(filePath)) return {};
  const raw = fs10.readFileSync(filePath, "utf-8").trim();
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
    passed: fs10.existsSync(configPath),
    message: fs10.existsSync(configPath) ? void 0 : `${configPath} not found`
  });
  checks.push({
    name: "tap-comms entry present",
    passed: !!entry,
    message: entry ? void 0 : `${GEMINI_SELECTOR} not found`
  });
  checks.push({
    name: "Comms directory exists",
    passed: fs10.existsSync(ctx.commsDir),
    message: fs10.existsSync(ctx.commsDir) ? void 0 : `${ctx.commsDir} not found`
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
    const configExists = fs10.existsSync(configPath);
    const runtimeProbe = probeCommand(
      ctx.platform === "win32" ? ["gemini", "gemini.cmd"] : ["gemini"]
    );
    if (!runtimeProbe.command) {
      warnings.push(
        "Gemini CLI not found in PATH. Config can still be written, but runtime verification will be limited."
      );
    }
    if (!fs10.existsSync(ctx.commsDir)) {
      issues.push(`Comms directory not found: ${ctx.commsDir}. Run "init" first.`);
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
        warnings.push(`${configPath} exists but is not valid JSON. It will be replaced.`);
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
    const managed = buildManagedMcpServerSpec(ctx);
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
    if (fs10.existsSync(configPath)) {
      if (fs10.readFileSync(configPath, "utf-8").trim()) {
        backupFile(configPath, plan.backupDir);
      }
      try {
        config = readJsonFile(configPath);
      } catch {
        warnings.push(`${configPath} was invalid JSON. Created backup and starting fresh.`);
        config = {};
      }
      previousValue = readNestedKey(config, GEMINI_SELECTOR);
    }
    const artifact = plan.ownedArtifacts[0];
    const backupPath = artifactBackupPath(plan.backupDir, artifact.kind, artifact.selector);
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
    fs10.mkdirSync(path10.dirname(configPath), { recursive: true });
    const tmp = `${configPath}.tmp.${process.pid}`;
    fs10.writeFileSync(tmp, JSON.stringify(config, null, 2) + "\n", "utf-8");
    fs10.renameSync(tmp, configPath);
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

// src/engine/bridge.ts
import * as fs12 from "fs";
import * as path12 from "path";
import { spawn, execSync as execSync3 } from "child_process";

// src/runtime/resolve-node.ts
import * as fs11 from "fs";
import * as path11 from "path";
import { execSync as execSync2 } from "child_process";
function readNodeVersion(repoRoot) {
  const nvFile = path11.join(repoRoot, ".node-version");
  if (!fs11.existsSync(nvFile)) return null;
  try {
    const raw = fs11.readFileSync(nvFile, "utf-8").trim();
    return raw.length > 0 ? raw.replace(/^v/, "") : null;
  } catch {
    return null;
  }
}
function fnmCandidateDirs() {
  if (process.platform === "win32") {
    return [
      process.env.FNM_DIR,
      process.env.APPDATA ? path11.join(process.env.APPDATA, "fnm") : null,
      process.env.LOCALAPPDATA ? path11.join(process.env.LOCALAPPDATA, "fnm") : null,
      process.env.USERPROFILE ? path11.join(process.env.USERPROFILE, "scoop", "persist", "fnm") : null
    ].filter(Boolean);
  }
  return [
    process.env.FNM_DIR,
    process.env.HOME ? path11.join(process.env.HOME, ".local", "share", "fnm") : null,
    process.env.HOME ? path11.join(process.env.HOME, ".fnm") : null,
    process.env.XDG_DATA_HOME ? path11.join(process.env.XDG_DATA_HOME, "fnm") : null
  ].filter(Boolean);
}
function nodeExecutableName() {
  return process.platform === "win32" ? "node.exe" : "node";
}
function probeFnmNode(desiredVersion) {
  const dirs = fnmCandidateDirs();
  const exe = nodeExecutableName();
  for (const baseDir of dirs) {
    const candidate = path11.join(
      baseDir,
      "node-versions",
      `v${desiredVersion}`,
      "installation",
      exe
    );
    if (!fs11.existsSync(candidate)) continue;
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
    path11.join(repoRoot, "node_modules", ".bin", "tsx.exe"),
    path11.join(repoRoot, "node_modules", ".bin", "tsx.CMD"),
    path11.join(repoRoot, "node_modules", ".bin", "tsx")
  ];
  for (const c of candidates) {
    if (fs11.existsSync(c)) return c;
  }
  return null;
}
function getFnmBinDir(repoRoot) {
  const desiredVersion = readNodeVersion(repoRoot);
  if (!desiredVersion) return null;
  const nodePath = probeFnmNode(desiredVersion);
  if (!nodePath) return null;
  return path11.dirname(nodePath);
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
    [pathKey]: `${fnmBin}${path11.delimiter}${currentPath}`
  };
}

// src/engine/bridge.ts
function pidFilePath(stateDir, instanceId) {
  return path12.join(stateDir, "pids", `bridge-${instanceId}.json`);
}
function logFilePath(stateDir, instanceId) {
  return path12.join(stateDir, "logs", `bridge-${instanceId}.log`);
}
function loadBridgeState(stateDir, instanceId) {
  const pidPath = pidFilePath(stateDir, instanceId);
  if (!fs12.existsSync(pidPath)) return null;
  try {
    const raw = fs12.readFileSync(pidPath, "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
function saveBridgeState(stateDir, instanceId, state) {
  const pidPath = pidFilePath(stateDir, instanceId);
  fs12.mkdirSync(path12.dirname(pidPath), { recursive: true });
  const tmp = `${pidPath}.tmp.${process.pid}`;
  fs12.writeFileSync(tmp, JSON.stringify(state, null, 2), "utf-8");
  fs12.renameSync(tmp, pidPath);
}
function clearBridgeState(stateDir, instanceId) {
  const pidPath = pidFilePath(stateDir, instanceId);
  if (fs12.existsSync(pidPath)) {
    fs12.unlinkSync(pidPath);
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
  clearBridgeState(stateDir, instanceId);
  const logPath = logFilePath(stateDir, instanceId);
  fs12.mkdirSync(path12.dirname(logPath), { recursive: true });
  rotateLog(logPath);
  const logFd = fs12.openSync(logPath, "a");
  const repoRoot = options.repoRoot ?? path12.resolve(stateDir, "..");
  const resolved = resolveNodeRuntime(
    options.runtimeCommand ?? "node",
    repoRoot
  );
  const command = resolved.command;
  const runtimeEnv = buildRuntimeEnv(repoRoot);
  const child = spawn(command, [bridgeScript], {
    detached: true,
    stdio: ["ignore", logFd, logFd],
    env: {
      ...runtimeEnv,
      TAP_COMMS_DIR: commsDir,
      TAP_BRIDGE_RUNTIME: runtime,
      TAP_BRIDGE_INSTANCE_ID: instanceId,
      TAP_AGENT_NAME: resolvedAgent,
      CODEX_TAP_AGENT_NAME: resolvedAgent,
      TAP_RESOLVED_NODE: resolved.command,
      TAP_STRIP_TYPES: resolved.supportsStripTypes ? "1" : "0",
      ...options.appServerUrl ? { CODEX_APP_SERVER_URL: options.appServerUrl } : {},
      ...port != null ? { TAP_BRIDGE_PORT: String(port) } : {},
      ...options.headless?.enabled ? {
        TAP_HEADLESS: "true",
        TAP_AGENT_ROLE: options.headless.role,
        TAP_MAX_REVIEW_ROUNDS: String(options.headless.maxRounds),
        TAP_QUALITY_FLOOR: options.headless.qualitySeverityFloor
      } : {},
      // Bridge script operational flags
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
    }
  });
  child.unref();
  fs12.closeSync(logFd);
  if (!child.pid) {
    throw new Error(`Failed to spawn bridge process for ${instanceId}`);
  }
  const state = {
    pid: child.pid,
    statePath: pidFilePath(stateDir, instanceId),
    lastHeartbeat: (/* @__PURE__ */ new Date()).toISOString()
  };
  saveBridgeState(stateDir, instanceId, state);
  return state;
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
    if (platform === "win32") {
      execSync3(`taskkill /PID ${state.pid} /F /T`, { stdio: "pipe" });
    } else {
      process.kill(state.pid, "SIGTERM");
      await new Promise((resolve10) => setTimeout(resolve10, 2e3));
      if (isProcessAlive(state.pid)) {
        process.kill(state.pid, "SIGKILL");
      }
    }
  } catch {
  }
  clearBridgeState(stateDir, instanceId);
  return true;
}
function rotateLog(logPath) {
  if (!fs12.existsSync(logPath)) return;
  try {
    const stats = fs12.statSync(logPath);
    if (stats.size === 0) return;
    const prevPath = `${logPath}.prev`;
    fs12.renameSync(logPath, prevPath);
  } catch {
  }
}
function getHeartbeatAge(stateDir, instanceId) {
  const state = loadBridgeState(stateDir, instanceId);
  if (!state?.lastHeartbeat) return null;
  const heartbeatTime = new Date(state.lastHeartbeat).getTime();
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

// src/commands/add.ts
async function addCommand(args) {
  const { positional, flags } = parseArgs(args);
  const runtimeArg = positional[0];
  if (!runtimeArg) {
    return {
      ok: false,
      command: "add",
      code: "TAP_INVALID_ARGUMENT",
      message: "Missing runtime argument. Usage: npx @hua-labs/tap add <claude|codex|gemini> [--name <name>] [--port <port>] [--headless] [--role <role>]",
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
  const port = portStr ? parseInt(portStr, 10) : null;
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
  if (portStr && (port === null || isNaN(port))) {
    return {
      ok: false,
      command: "add",
      runtime,
      instanceId,
      code: "TAP_INVALID_ARGUMENT",
      message: `Invalid port: ${portStr}`,
      warnings: [],
      data: {}
    };
  }
  const repoRoot = findRepoRoot2();
  const state = loadState(repoRoot);
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
  if (state.instances[instanceId]?.installed && !force) {
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
  const ctx = createAdapterContext(state.commsDir, repoRoot);
  const adapter = getAdapter(runtime);
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
    return {
      ok: true,
      command: "add",
      runtime,
      instanceId,
      code: "TAP_NO_OP",
      message: "No operations to apply. Runtime not configured.",
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
  let bridge = null;
  const mode = adapter.bridgeMode();
  if (mode === "app-server") {
    const bridgeScript = adapter.resolveBridgeScript?.(ctx);
    if (!bridgeScript) {
      logWarn("Bridge script not found. Bridge not started.");
      warnings.push("Bridge script not found. Run bridge manually.");
    } else {
      const agentNameEnv = process.env.TAP_AGENT_NAME || process.env.CODEX_TAP_AGENT_NAME;
      if (!agentNameEnv) {
        logWarn(
          "No agent name set (TAP_AGENT_NAME). Bridge not started. Use: npx @hua-labs/tap bridge start <instance> --agent-name <name>"
        );
        warnings.push("Bridge not auto-started: no agent name available.");
      } else {
        const { config: resolvedCfg } = resolveConfig({}, repoRoot);
        log(`Starting bridge: ${bridgeScript}`);
        try {
          bridge = await startBridge({
            instanceId,
            runtime,
            stateDir: ctx.stateDir,
            commsDir: ctx.commsDir,
            bridgeScript,
            platform: ctx.platform,
            agentName: agentNameEnv,
            runtimeCommand: resolvedCfg.runtimeCommand,
            appServerUrl: resolvedCfg.appServerUrl,
            repoRoot,
            port: port ?? void 0,
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
  }
  const instanceState = {
    instanceId,
    runtime,
    agentName: null,
    port,
    installed: true,
    configPath: probe.configPath ?? "",
    bridgeMode: mode,
    restartRequired: result.restartRequired,
    ownedArtifacts: result.ownedArtifacts,
    backupPath: backupDir,
    lastAppliedHash: result.lastAppliedHash,
    lastVerifiedAt: verify.ok ? (/* @__PURE__ */ new Date()).toISOString() : null,
    bridge,
    headless,
    warnings: [...result.warnings, ...verify.warnings]
  };
  const newState = updateInstanceState(state, instanceId, instanceState);
  saveState(repoRoot, newState);
  logSuccess("State saved");
  if (result.restartRequired) {
    logWarn(`Restart ${runtime} to pick up the new configuration.`);
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

// src/commands/status.ts
function resolveStatus(inst, stateDir) {
  if (!inst.installed) return "not installed";
  switch (inst.bridgeMode) {
    case "native-push":
    case "polling":
      return inst.lastVerifiedAt ? "active" : "configured";
    case "app-server":
      if (inst.bridge && isBridgeRunning(stateDir, inst.instanceId)) {
        return "active";
      }
      if (inst.bridge) {
        inst.bridge = null;
      }
      return inst.lastVerifiedAt ? "configured" : "installed";
    default:
      return "installed";
  }
}
function instanceStatusLine(inst, status) {
  const bridgeInfo = inst.bridge ? ` (pid: ${inst.bridge.pid})` : "";
  const mode = inst.bridgeMode;
  const portStr = inst.port ? ` port:${inst.port}` : "";
  const restart = inst.restartRequired ? " [restart required]" : "";
  const warns = inst.warnings.length > 0 ? ` [${inst.warnings.length} warning(s)]` : "";
  return `${inst.instanceId.padEnd(20)} ${inst.runtime.padEnd(8)} ${status.padEnd(14)} ${mode.padEnd(14)}${bridgeInfo}${portStr}${restart}${warns}`;
}
async function statusCommand(_args) {
  const repoRoot = findRepoRoot2();
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
  log(`Version:    ${state.packageVersion}`);
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
      `${"Instance".padEnd(20)} ${"Runtime".padEnd(8)} ${"Status".padEnd(14)} ${"Bridge Mode".padEnd(14)} Details`
    );
    log(
      `${"\u2500".repeat(20)} ${"\u2500".repeat(8)} ${"\u2500".repeat(14)} ${"\u2500".repeat(14)} ${"\u2500".repeat(20)}`
    );
    for (const id of installed) {
      const inst = state.instances[id];
      if (inst) {
        const status = resolveStatus(inst, stateDir);
        log(instanceStatusLine(inst, status));
        if (inst.warnings.length > 0) {
          for (const w of inst.warnings) {
            logWarn(`  ${w}`);
          }
        }
        instances[id] = {
          status,
          runtime: inst.runtime,
          bridgeMode: inst.bridgeMode,
          bridge: inst.bridge,
          port: inst.port,
          warnings: inst.warnings
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
      version: state.packageVersion,
      commsDir: state.commsDir,
      repoRoot: state.repoRoot,
      instances
    }
  };
}

// src/engine/rollback.ts
import * as fs13 from "fs";
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
  if (!fs13.existsSync(artifact.path)) {
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
  const raw = fs13.readFileSync(artifact.path, "utf-8");
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
  fs13.writeFileSync(tmp, JSON.stringify(config, null, 2) + "\n", "utf-8");
  fs13.renameSync(tmp, artifact.path);
  return { restored: true };
}
function rollbackTomlTable(artifact) {
  const content = fs13.readFileSync(artifact.path, "utf-8");
  const backup = artifact.backupPath ? readArtifactBackup(artifact.backupPath) : null;
  if (backup?.kind === "toml-table" && backup.selector === artifact.selector) {
    const nextContent = backup.existed ? replaceTomlTable(content, artifact.selector, backup.content ?? "") : removeTomlTable(content, artifact.selector);
    const tmp2 = `${artifact.path}.tmp.${process.pid}`;
    fs13.writeFileSync(tmp2, nextContent, "utf-8");
    fs13.renameSync(tmp2, artifact.path);
    return { restored: true };
  }
  if (!extractTomlTable(content, artifact.selector)) {
    return {
      restored: false,
      error: `TOML table not found: ${artifact.selector}`
    };
  }
  const tmp = `${artifact.path}.tmp.${process.pid}`;
  fs13.writeFileSync(tmp, removeTomlTable(content, artifact.selector), "utf-8");
  fs13.renameSync(tmp, artifact.path);
  return { restored: true };
}
function rollbackFile(artifact) {
  if (fs13.existsSync(artifact.path)) {
    fs13.unlinkSync(artifact.path);
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
async function removeCommand(args) {
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
  const repoRoot = findRepoRoot2();
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
    const stopped = await stopBridge({
      instanceId,
      stateDir: ctx.stateDir,
      platform: ctx.platform
    });
    if (stopped) {
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
import * as path13 from "path";
function formatAge(seconds) {
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor(seconds % 3600 / 60)}m ago`;
}
var BRIDGE_HELP = `
Usage:
  tap-comms bridge <subcommand> [instance] [options]

Subcommands:
  start <instance>  Start bridge for an instance (e.g. codex, codex-reviewer)
  stop  <instance>  Stop bridge for an instance
  stop              Stop all running bridges
  status            Show bridge status for all instances
  status <instance> Show bridge status for a specific instance

Options:
  --agent-name <name>              Agent identity for bridge (or set TAP_AGENT_NAME env)
  --busy-mode <steer|wait>         How to handle active turns (default: steer)
  --poll-seconds <n>               Inbox poll interval (default: 5)
  --reconnect-seconds <n>          Reconnect delay after disconnect (default: 5)
  --message-lookback-minutes <n>   Process messages from last N minutes (default: 10)
  --thread-id <id>                 Resume specific thread
  --ephemeral                      Use ephemeral thread (no persistence)
  --process-existing-messages      Process all existing inbox messages

Examples:
  npx @hua-labs/tap bridge start codex --agent-name myAgent
  npx @hua-labs/tap bridge start codex-reviewer --agent-name reviewer --busy-mode steer
  npx @hua-labs/tap bridge stop codex
  npx @hua-labs/tap bridge stop
  npx @hua-labs/tap bridge status
`.trim();
async function bridgeStart(identifier, agentName, flags = {}) {
  const repoRoot = findRepoRoot2();
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
  const instance = state.instances[instanceId];
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
  const appServerUrl = resolvedConfig.appServerUrl;
  logHeader(`@hua-labs/tap bridge start ${instanceId}`);
  log(`Bridge script: ${bridgeScript}`);
  log(`Bridge mode:   ${mode}`);
  log(`Runtime cmd:   ${runtimeCommand}`);
  log(`App server:    ${appServerUrl}`);
  if (instance.port) log(`Port:          ${instance.port}`);
  const willBeHeadless = flags["headless"] === true || instance.headless?.enabled;
  if (willBeHeadless) {
    const role = (typeof flags["role"] === "string" ? flags["role"] : null) ?? instance.headless?.role ?? "reviewer";
    log(`Headless:      ${role}`);
  }
  try {
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
      agentName,
      runtimeCommand,
      appServerUrl,
      repoRoot,
      port: instance.port ?? void 0,
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
      data: { pid: bridge.pid }
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
async function bridgeStopOne(identifier) {
  const repoRoot = findRepoRoot2();
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
  logHeader(`@hua-labs/tap bridge stop ${instanceId}`);
  const stopped = await stopBridge({
    instanceId,
    stateDir: ctx.stateDir,
    platform: ctx.platform
  });
  if (stopped) {
    logSuccess(`Bridge for ${instanceId} stopped`);
    const instance2 = state.instances[instanceId];
    if (instance2) {
      const updated = { ...instance2, bridge: null };
      const newState = updateInstanceState(state, instanceId, updated);
      saveState(repoRoot, newState);
    }
    return {
      ok: true,
      command: "bridge",
      instanceId,
      code: "TAP_BRIDGE_STOP_OK",
      message: `Bridge for ${instanceId} stopped`,
      warnings: [],
      data: {}
    };
  }
  log(`No running bridge for ${instanceId}`);
  const instance = state.instances[instanceId];
  if (instance?.bridge) {
    const updated = { ...instance, bridge: null };
    const newState = updateInstanceState(state, instanceId, updated);
    saveState(repoRoot, newState);
  }
  return {
    ok: true,
    command: "bridge",
    instanceId,
    code: "TAP_BRIDGE_NOT_RUNNING",
    message: `No running bridge for ${instanceId}`,
    warnings: [],
    data: {}
  };
}
async function bridgeStopAll() {
  const repoRoot = findRepoRoot2();
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
  logHeader("@hua-labs/tap bridge stop (all)");
  let stateChanged = false;
  for (const instanceId of instanceIds) {
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
    data: { stopped }
  };
}
function bridgeStatusAll() {
  const repoRoot = findRepoRoot2();
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
        lastHeartbeat: null
      };
      continue;
    }
    const status = getBridgeStatus(stateDir, instanceId);
    const bridgeState = loadBridgeState(stateDir, instanceId);
    const age = getHeartbeatAge(stateDir, instanceId);
    const pid = bridgeState?.pid ?? null;
    const heartbeat = bridgeState?.lastHeartbeat ?? null;
    const pidStr = pid ? String(pid) : "-";
    const portStr = inst.port ? String(inst.port) : "-";
    const ageStr = age !== null ? formatAge(age) : "-";
    const statusColor = status === "running" ? "running" : status === "stale" ? "stale!" : "stopped";
    log(
      `${instanceId.padEnd(20)} ${inst.runtime.padEnd(8)} ${statusColor.padEnd(10)} ${pidStr.padEnd(8)} ${portStr.padEnd(6)} ${ageStr}`
    );
    bridges[instanceId] = {
      status,
      runtime: inst.runtime,
      pid,
      port: inst.port,
      lastHeartbeat: heartbeat
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
  const repoRoot = findRepoRoot2();
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
        lastHeartbeat: null
      }
    };
  }
  const { config: resolvedCfg2 } = resolveConfig({}, repoRoot);
  const stateDir = resolvedCfg2.stateDir;
  const status = getBridgeStatus(stateDir, instanceId);
  const bridgeState = loadBridgeState(stateDir, instanceId);
  const age = getHeartbeatAge(stateDir, instanceId);
  log(`Status:      ${status}`);
  if (bridgeState) {
    log(`PID:         ${bridgeState.pid}`);
    log(
      `Heartbeat:   ${bridgeState.lastHeartbeat}${age !== null ? ` (${formatAge(age)})` : ""}`
    );
    log(
      `Log:         ${path13.join(stateDir, "logs", `bridge-${instanceId}.log`)}`
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
      bridgeMode: inst.bridgeMode,
      pid: bridgeState?.pid ?? null,
      port: inst.port,
      lastHeartbeat: bridgeState?.lastHeartbeat ?? null
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
      if (!identifierArg) {
        return {
          ok: false,
          command: "bridge",
          code: "TAP_INVALID_ARGUMENT",
          message: "Missing instance. Usage: npx @hua-labs/tap bridge start <instance>",
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

// src/commands/serve.ts
import * as fs14 from "fs";
import * as path14 from "path";
import { execSync as execSync4, spawn as spawn2 } from "child_process";
function findServerEntry(repoRoot) {
  const candidates = [
    path14.join(repoRoot, "packages", "tap-plugin", "channels", "tap-comms.ts"),
    path14.join(
      repoRoot,
      "node_modules",
      "@hua-labs",
      "tap-plugin",
      "channels",
      "tap-comms.ts"
    )
  ];
  for (const p of candidates) {
    if (fs14.existsSync(p)) return p;
  }
  return null;
}
function isBunInstalled() {
  try {
    execSync4("bun --version", { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}
async function serveCommand(args) {
  const repoRoot = findRepoRoot2();
  let commsDir;
  const commsDirIdx = args.indexOf("--comms-dir");
  if (commsDirIdx !== -1 && args[commsDirIdx + 1]) {
    commsDir = path14.resolve(args[commsDirIdx + 1]);
  }
  if (!commsDir && process.env.TAP_COMMS_DIR) {
    commsDir = process.env.TAP_COMMS_DIR;
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
  if (!isBunInstalled()) {
    return {
      ok: false,
      command: "serve",
      code: "TAP_SERVE_BUN_REQUIRED",
      message: "bun is required to run the tap-comms MCP server. Install: https://bun.sh",
      warnings: [],
      data: {}
    };
  }
  const serverEntry = findServerEntry(repoRoot);
  if (!serverEntry) {
    return {
      ok: false,
      command: "serve",
      code: "TAP_SERVE_NO_SERVER",
      message: "tap-comms MCP server not found. Run from a repo with packages/tap-plugin/channels/.",
      warnings: [],
      data: {}
    };
  }
  const child = spawn2("bun", [serverEntry], {
    stdio: "inherit",
    env: {
      ...process.env,
      TAP_COMMS_DIR: commsDir
    }
  });
  return new Promise((resolve10) => {
    child.on("error", (err) => {
      resolve10({
        ok: false,
        command: "serve",
        code: "TAP_INTERNAL_ERROR",
        message: `Failed to start MCP server: ${err.message}`,
        warnings: [],
        data: {}
      });
    });
    child.on("exit", (code) => {
      resolve10({
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
import * as fs15 from "fs";
import * as path15 from "path";
import { execSync as execSync5 } from "child_process";
var INIT_WORKTREE_HELP = `
Usage:
  tap-comms init-worktree [options]

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
  const resolved = path15.resolve(p);
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
  const bunHome = path15.join(
    home,
    ".bun",
    "bin",
    process.platform === "win32" ? "bun.exe" : "bun"
  );
  if (fs15.existsSync(bunHome) && probeBun(bunHome)) return bunHome;
  return null;
}
function step1CreateWorktree(opts) {
  log("Step 1/9: Creating worktree...");
  if (fs15.existsSync(opts.worktreePath)) {
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
  const srcSettings = path15.join(
    opts.repoRoot,
    ".claude",
    "settings.local.json"
  );
  const destDir = path15.join(opts.worktreePath, ".claude");
  const destSettings = path15.join(destDir, "settings.local.json");
  if (!fs15.existsSync(srcSettings)) {
    warn(
      warnings,
      "No .claude/settings.local.json found in main repo. Skipping."
    );
    return;
  }
  fs15.mkdirSync(destDir, { recursive: true });
  fs15.copyFileSync(srcSettings, destSettings);
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
  const channelEntry = path15.join(
    wtAbs,
    "packages/tap-plugin/channels/tap-comms.ts"
  );
  const mcpConfig = {
    mcpServers: {
      "tap-comms": {
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
  const mcpPath = path15.join(opts.worktreePath, ".mcp.json");
  fs15.writeFileSync(mcpPath, JSON.stringify(mcpConfig, null, 2) + "\n", "utf-8");
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
  if (!fs15.existsSync(opts.commsDir)) {
    warn(warnings, `Comms directory not found: ${opts.commsDir}`);
    warn(warnings, "Create it or run: npx @hua-labs/tap init");
    return;
  }
  const requiredDirs = ["inbox", "findings", "reviews", "letters"];
  for (const dir of requiredDirs) {
    const dirPath = path15.join(opts.commsDir, dir);
    if (!fs15.existsSync(dirPath)) {
      fs15.mkdirSync(dirPath, { recursive: true });
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
      message: "init-worktree help",
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
  const repoRoot = findRepoRoot2();
  const { config } = resolveConfig({}, repoRoot);
  const branch = typeof flags["branch"] === "string" ? flags["branch"] : path15.basename(path15.resolve(worktreePath));
  const base = typeof flags["base"] === "string" ? flags["base"] : "origin/main";
  const mission = typeof flags["mission"] === "string" ? flags["mission"] : void 0;
  const commsDir = typeof flags["comms-dir"] === "string" ? flags["comms-dir"] : config.commsDir;
  const skipInstall = flags["skip-install"] === true;
  const opts = {
    worktreePath: path15.resolve(worktreePath),
    branch,
    base,
    mission,
    commsDir: path15.resolve(commsDir),
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

// src/engine/dashboard.ts
import * as fs16 from "fs";
import * as path16 from "path";
import { execSync as execSync6 } from "child_process";
function collectAgents(commsDir) {
  const heartbeatsPath = path16.join(commsDir, "heartbeats.json");
  if (!fs16.existsSync(heartbeatsPath)) return [];
  try {
    const raw = fs16.readFileSync(heartbeatsPath, "utf-8");
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
  const tmpDir = path16.join(repoRoot, ".tmp");
  if (fs16.existsSync(tmpDir)) {
    try {
      const dirs = fs16.readdirSync(tmpDir).filter((d) => d.startsWith("codex-app-server-bridge"));
      for (const dir of dirs) {
        const daemonPath = path16.join(tmpDir, dir, "bridge-daemon.json");
        if (!fs16.existsSync(daemonPath)) continue;
        try {
          const raw = fs16.readFileSync(daemonPath, "utf-8");
          const daemon = JSON.parse(raw);
          const alreadyCovered = bridges.some(
            (b) => b.pid === daemon.pid && b.pid !== null
          );
          if (alreadyCovered) continue;
          const agentFile = path16.join(tmpDir, dir, "agent-name.txt");
          const agentName = fs16.existsSync(agentFile) ? fs16.readFileSync(agentFile, "utf-8").trim() : dir;
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
    const output = execSync6(
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

// src/commands/dashboard.ts
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
    for (const agent of snapshot.agents) {
      const activity = agent.lastActivity ? formatAge2(
        Math.floor(
          (Date.now() - new Date(agent.lastActivity).getTime()) / 1e3
        )
      ) : "unknown";
      const status = agent.status ?? "unknown";
      log(`  ${agent.name.padEnd(12)} ${status.padEnd(10)} active ${activity}`);
    }
  }
  log("");
  log("\u2500\u2500 Bridges \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500");
  if (snapshot.bridges.length === 0) {
    log("  (none)");
  } else {
    log(
      `  ${"Instance".padEnd(20)} ${"Status".padEnd(10)} ${"PID".padEnd(8)} ${"Port".padEnd(6)} ${"Heartbeat"}`
    );
    log(
      `  ${"\u2500".repeat(20)} ${"\u2500".repeat(10)} ${"\u2500".repeat(8)} ${"\u2500".repeat(6)} ${"\u2500".repeat(12)}`
    );
    for (const b of snapshot.bridges) {
      const headlessTag = b.headless ? " [H]" : "";
      log(
        `  ${truncate(b.instanceId + headlessTag, 20).padEnd(20)} ${formatStatus(b.status).padEnd(10)} ${(b.pid ? String(b.pid) : "-").padEnd(8)} ${(b.port ? String(b.port) : "-").padEnd(6)} ${formatAge2(b.heartbeatAge)}`
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
async function dashboardCommand(args) {
  const { flags } = parseArgs(args);
  const jsonMode = flags["json"] === true;
  const watchMode = flags["watch"] === true;
  const intervalStr = typeof flags["interval"] === "string" ? flags["interval"] : "5";
  const intervalSeconds = Math.max(2, parseInt(intervalStr, 10) || 5);
  const commsDirOverride = typeof flags["comms-dir"] === "string" ? flags["comms-dir"] : void 0;
  const repoRoot = findRepoRoot2();
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

// src/output.ts
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
  for (const w of result.warnings) {
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
var HELP = `
@hua-labs/tap \u2014 Cross-model AI agent communication setup

Usage:
  tap-comms <command> [options]

Commands:
  init                  Initialize comms directory and state
  init-worktree         Set up a new git worktree with tap-comms
  add <runtime>         Add a runtime instance (claude, codex, gemini)
  remove <instance>     Remove an instance and rollback config
  status                Show installed instances and bridge status
  bridge <sub> [inst]   Manage bridges (start, stop, status)
  dashboard             Show unified ops dashboard
  serve                 Start tap-comms MCP server (stdio)
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
    case "dashboard":
    case "serve":
      return command;
    default:
      return "unknown";
  }
}
async function main() {
  const rawArgs = process.argv.slice(2);
  const { jsonMode, cleanArgs } = extractJsonFlag(rawArgs);
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
      case "dashboard":
        result = await dashboardCommand(commandArgs);
        break;
      case "serve": {
        const serveResult = await serveCommand(commandArgs);
        if (!serveResult.ok) {
          emitResult(serveResult, jsonMode);
        }
        process.exit(exitCode(serveResult));
        break;
      }
      default:
        result = {
          ok: false,
          command: "unknown",
          code: "TAP_INVALID_ARGUMENT",
          message: `Unknown command: ${command}`,
          warnings: [],
          data: { requestedCommand: command }
        };
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