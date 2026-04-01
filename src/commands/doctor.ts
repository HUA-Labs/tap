/**
 * `tap doctor` — Diagnose and optionally fix tap infrastructure health.
 *
 * Checks: comms directory, state file, instances, bridge health,
 * watcher readiness, MCP server, message lifecycle.
 *
 * M95: Diagnostic layer for tap.
 * M100: --fix auto-repair for common issues.
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import {
  buildManagedMcpServerSpec,
  type ManagedMcpServerSpec,
} from "../adapters/common.js";
import { loadState, saveState, getInstalledInstances } from "../state.js";
import {
  isBridgeRunning,
  getHeartbeatAge,
  loadBridgeState,
  loadRuntimeBridgeHeartbeat,
  loadRuntimeBridgeThreadState,
} from "../engine/bridge.js";
import { resolveConfig } from "../config/index.js";
import { checkAllDrift } from "../config/drift-detector.js";
import {
  createAdapterContext,
  findRepoRoot,
  log,
  logHeader,
  logSuccess,
  logWarn,
} from "../utils.js";
import {
  extractTomlTable,
  parseTomlAssignments,
  removeTomlTable,
  renderTomlTable,
  replaceTomlTable,
} from "../toml.js";
import { version } from "../version.js";
import type { CommandResult, TapState } from "../types.js";

// ── Types ───────────────────────────────────────────────────────────────

interface Check {
  name: string;
  status: "pass" | "warn" | "fail" | "skip";
  message?: string;
  fix?: () => string; // Returns description of what was fixed
}

interface DoctorHeartbeatRecord {
  id?: string;
  agent?: string;
  timestamp?: string;
  lastActivity?: string;
  status?: "active" | "idle" | "signing-off" | string;
}

// ── Helpers ─────────────────────────────────────────────────────────────

const PASS = "pass" as const;
const WARN = "warn" as const;
const FAIL = "fail" as const;
const HEARTBEAT_ACTIVE_WINDOW_MS = 10 * 60 * 1000;
const ORPHAN_HEARTBEAT_WINDOW_MS = 24 * 60 * 60 * 1000;
const SIGNING_OFF_HEARTBEAT_WINDOW_MS = 5 * 60 * 1000;
const CODEX_ENV_DRIFT_KEYS = [
  "TAP_COMMS_DIR",
  "TAP_STATE_DIR",
  "TAP_REPO_ROOT",
] as const;
const CODEX_SESSION_NEUTRAL_NAME = "<set-per-session>";

function normalizeComparablePath(value: string): string {
  return resolve(value).replace(/\\/g, "/").toLowerCase();
}

function samePath(left: string, right: string): boolean {
  return normalizeComparablePath(left) === normalizeComparablePath(right);
}

function looksLikePathToken(value: string): boolean {
  return (
    /^[A-Za-z]:[\\/]/.test(value) ||
    value.startsWith("/") ||
    value.startsWith("\\") ||
    value.startsWith(".") ||
    value.includes("/") ||
    value.includes("\\")
  );
}

function sameCommandToken(left: string, right: string): boolean {
  return looksLikePathToken(left) || looksLikePathToken(right)
    ? samePath(left, right)
    : left === right;
}

function sameStringArray(left: string[], right: string[]): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => sameCommandToken(value, right[index] ?? ""))
  );
}

function appendWarningMessage(message: string, extra: string): string {
  return message.includes(extra) ? message : `${message}; ${extra}`;
}

function findCodexConfigPath(): string {
  return join(homedir(), ".codex", "config.toml");
}

function canonicalizeTrustPath(targetPath: string): string {
  let resolved = resolve(targetPath).replace(/\//g, "\\");
  const driveRoot = /^[A-Za-z]:\\$/;
  if (!driveRoot.test(resolved)) {
    resolved = resolved.replace(/\\+$/g, "");
  }
  return resolved.startsWith("\\\\?\\") ? resolved : `\\\\?\\${resolved}`;
}

function trustSelector(targetPath: string): string {
  return `projects.'${canonicalizeTrustPath(targetPath)}'`;
}

function writeTomlAtomically(filePath: string, content: string): void {
  const dir = dirname(filePath);
  mkdirSync(dir, { recursive: true });
  const tmp = `${filePath}.tmp.${process.pid}`;
  writeFileSync(tmp, content, "utf-8");
  renameSync(tmp, filePath);
}

function hasInstalledCodexInstance(state: TapState | null): boolean {
  return state
    ? Object.values(state.instances).some(
        (instance) => instance.runtime === "codex" && instance.installed,
      )
    : false;
}

function getCodexTrustTargets(repoRoot: string): string[] {
  return [...new Set([repoRoot, process.cwd()].map((value) => resolve(value)))];
}

function buildSessionNeutralCodexEnv(
  env: Record<string, string>,
): Record<string, string> {
  const neutralEnv: Record<string, string> = {
    ...env,
    TAP_AGENT_NAME: CODEX_SESSION_NEUTRAL_NAME,
  };
  delete neutralEnv.TAP_AGENT_ID;
  return neutralEnv;
}

function buildCodexEnvEntries(
  existingTable: string | null,
  managedEnv: Record<string, string | string[]>,
): Record<string, string | string[]> {
  const preservedEnv = parseTomlAssignments(existingTable ?? "");
  delete preservedEnv.TAP_AGENT_ID;
  return {
    ...preservedEnv,
    ...managedEnv,
  };
}

function buildCodexDoctorSpec(
  repoRoot: string,
  commsDir: string,
): {
  configPath: string;
  trustTargets: string[];
  managed: ManagedMcpServerSpec;
} | null {
  const state = loadState(repoRoot);
  if (!hasInstalledCodexInstance(state)) {
    return null;
  }

  const ctx = createAdapterContext(commsDir, repoRoot);
  const managed = buildManagedMcpServerSpec(ctx);

  return {
    configPath: findCodexConfigPath(),
    trustTargets: getCodexTrustTargets(repoRoot),
    managed: {
      ...managed,
      env: buildSessionNeutralCodexEnv(managed.env),
    },
  };
}

function repairCodexConfig(repoRoot: string, commsDir: string): string {
  const spec = buildCodexDoctorSpec(repoRoot, commsDir);
  if (!spec) {
    throw new Error("No installed Codex instance found in tap state.");
  }
  if (!spec.managed.command || spec.managed.issues.length > 0) {
    throw new Error(
      spec.managed.issues[0] ??
        "Unable to resolve the managed tap MCP server for Codex.",
    );
  }

  const existingContent = existsSync(spec.configPath)
    ? readFileSync(spec.configPath, "utf-8")
    : "";
  const existingTapEnvTable = extractTomlTable(
    existingContent,
    "mcp_servers.tap.env",
  );
  const existingLegacyEnvTable = extractTomlTable(
    existingContent,
    "mcp_servers.tap-comms.env",
  );
  const preservedEnv = parseTomlAssignments(
    existingTapEnvTable ?? existingLegacyEnvTable ?? "",
  );
  const repairedEnv: Record<string, string | string[]> = {
    ...preservedEnv,
    ...(Object.fromEntries(
      CODEX_ENV_DRIFT_KEYS.map((key) => [key, spec.managed.env[key]]),
    ) as Record<string, string>),
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
        approval_mode: "auto",
      },
      extractTomlTable(existingContent, "mcp_servers.tap"),
    ),
  );
  nextContent = replaceTomlTable(
    nextContent,
    "mcp_servers.tap.env",
    renderTomlTable(
      "mcp_servers.tap.env",
      buildCodexEnvEntries(
        existingTapEnvTable ?? existingLegacyEnvTable,
        repairedEnv,
      ),
    ),
  );
  for (const trustTarget of spec.trustTargets) {
    const selector = trustSelector(trustTarget);
    nextContent = replaceTomlTable(
      nextContent,
      selector,
      renderTomlTable(
        selector,
        { trust_level: "trusted" },
        extractTomlTable(existingContent, selector),
      ),
    );
  }

  writeTomlAtomically(spec.configPath, nextContent);
  return `Repaired Codex config at ${spec.configPath}. Restart Codex to reload MCP settings.`;
}

function countFiles(dir: string, ext = ".md"): number {
  if (!existsSync(dir)) return 0;
  try {
    return readdirSync(dir).filter((f) => f.endsWith(ext)).length;
  } catch {
    return 0;
  }
}

function recentFileCount(dir: string, withinMs: number): number {
  if (!existsSync(dir)) return 0;
  const cutoff = Date.now() - withinMs;
  let count = 0;
  try {
    for (const f of readdirSync(dir)) {
      if (!f.endsWith(".md")) continue;
      try {
        if (statSync(join(dir, f)).mtimeMs > cutoff) count++;
      } catch {
        // skip
      }
    }
  } catch {
    // skip
  }
  return count;
}

function loadDoctorHeartbeatStore(
  commsDir: string,
): Record<string, DoctorHeartbeatRecord> | null {
  const heartbeatsPath = join(commsDir, "heartbeats.json");
  if (!existsSync(heartbeatsPath)) return null;
  try {
    return JSON.parse(readFileSync(heartbeatsPath, "utf-8")) as Record<
      string,
      DoctorHeartbeatRecord
    >;
  } catch {
    return null;
  }
}

function saveDoctorHeartbeatStore(
  commsDir: string,
  store: Record<string, DoctorHeartbeatRecord>,
): void {
  const heartbeatsPath = join(commsDir, "heartbeats.json");
  const tmp = `${heartbeatsPath}.tmp.${process.pid}`;
  writeFileSync(tmp, JSON.stringify(store, null, 2), "utf-8");
  renameSync(tmp, heartbeatsPath);
}

function parseHeartbeatAgeMs(
  record: DoctorHeartbeatRecord,
  now: number,
): number {
  const raw = record.lastActivity ?? record.timestamp;
  if (!raw) return Number.POSITIVE_INFINITY;
  const parsed = new Date(raw).getTime();
  if (!Number.isFinite(parsed)) return Number.POSITIVE_INFINITY;
  return Math.max(0, now - parsed);
}

function resolveHeartbeatInstanceId(
  state: TapState | null,
  heartbeatId: string,
): string | null {
  if (!state) return null;
  if (state.instances[heartbeatId]) return heartbeatId;
  const hyphenated = heartbeatId.replace(/_/g, "-");
  if (state.instances[hyphenated]) return hyphenated;
  const underscored = heartbeatId.replace(/-/g, "_");
  if (state.instances[underscored]) return underscored;
  return null;
}

function collectStaleHeartbeatIds(
  commsDir: string,
  state: TapState | null,
  stateDir: string,
): Array<{ id: string; label: string; ageMs: number }> {
  const store = loadDoctorHeartbeatStore(commsDir);
  if (!store) return [];

  const now = Date.now();
  const stale: Array<{ id: string; label: string; ageMs: number }> = [];

  for (const [heartbeatId, heartbeat] of Object.entries(store)) {
    const ageMs = parseHeartbeatAgeMs(heartbeat, now);
    const instanceId = resolveHeartbeatInstanceId(state, heartbeatId);
    const instance = instanceId ? state?.instances[instanceId] : null;
    const bridgeBacked = instance?.bridgeMode === "app-server";
    const bridgeRunning =
      bridgeBacked && instanceId
        ? isBridgeRunning(stateDir, instanceId)
        : false;
    const status = heartbeat.status ?? "active";

    const staleByStatus =
      status === "signing-off" && ageMs >= SIGNING_OFF_HEARTBEAT_WINDOW_MS;
    const staleByDeadBridge =
      bridgeBacked && !bridgeRunning && ageMs >= HEARTBEAT_ACTIVE_WINDOW_MS;
    const staleByAge = !bridgeRunning && ageMs >= ORPHAN_HEARTBEAT_WINDOW_MS;

    if (staleByStatus || staleByDeadBridge || staleByAge) {
      stale.push({
        id: heartbeatId,
        label: heartbeat.agent?.trim() || heartbeatId,
        ageMs,
      });
    }
  }

  return stale;
}

function pruneHeartbeatIds(commsDir: string, heartbeatIds: string[]): number {
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

// ── Checks ──────────────────────────────────────────────────────────────

function checkComms(commsDir: string): Check[] {
  const checks: Check[] = [];

  checks.push({
    name: "comms directory",
    status: existsSync(commsDir) ? PASS : FAIL,
    message: existsSync(commsDir) ? commsDir : `Not found: ${commsDir}`,
    fix: existsSync(commsDir)
      ? undefined
      : () => {
          mkdirSync(commsDir, { recursive: true });
          return `Created ${commsDir}`;
        },
  });

  for (const [subdir, required] of [
    ["inbox", true],
    ["reviews", false],
    ["findings", false],
  ] as const) {
    const dir = join(commsDir, subdir);
    const exists = existsSync(dir);
    checks.push({
      name: `${subdir} directory`,
      status: exists ? PASS : required ? FAIL : WARN,
      message: exists
        ? subdir === "findings"
          ? `${countFiles(dir)} findings`
          : subdir === "inbox"
            ? `${countFiles(dir)} messages`
            : "exists"
        : `Missing${required ? "" : " (optional)"}`,
      fix: exists
        ? undefined
        : () => {
            mkdirSync(dir, { recursive: true });
            return `Created ${dir}`;
          },
    });
  }

  // Heartbeats
  const heartbeats = join(commsDir, "heartbeats.json");
  if (existsSync(heartbeats)) {
    try {
      const store = JSON.parse(readFileSync(heartbeats, "utf-8"));
      const agents = Object.keys(store);
      const now = Date.now();
      const active = agents.filter((a) => {
        const ts = store[a]?.lastActivity;
        return ts && now - new Date(ts).getTime() < HEARTBEAT_ACTIVE_WINDOW_MS;
      });
      checks.push({
        name: "heartbeats",
        status: active.length > 0 ? PASS : WARN,
        message: `${active.length} active / ${agents.length} total`,
      });
    } catch {
      checks.push({
        name: "heartbeats",
        status: WARN,
        message: "File exists but unreadable",
      });
    }
  } else {
    checks.push({
      name: "heartbeats",
      status: WARN,
      message: "No heartbeats file",
    });
  }

  return checks;
}

function checkStaleHeartbeats(
  repoRoot: string,
  commsDir: string,
  stateDir: string,
): Check[] {
  const state = loadState(repoRoot);
  const stale = collectStaleHeartbeatIds(commsDir, state, stateDir);
  if (stale.length === 0) {
    return [
      {
        name: "stale heartbeats",
        status: PASS,
        message: "none",
      },
    ];
  }

  const preview = stale
    .slice(0, 3)
    .map((entry) => `${entry.label} (${Math.round(entry.ageMs / 60000)}m)`)
    .join(", ");

  return [
    {
      name: "stale heartbeats",
      status: WARN,
      message:
        stale.length > 3
          ? `${stale.length} stale entries: ${preview}, ...`
          : `${stale.length} stale entr${stale.length === 1 ? "y" : "ies"}: ${preview}`,
      fix: () => {
        const removed = pruneHeartbeatIds(
          commsDir,
          stale.map((entry) => entry.id),
        );
        return `Pruned ${removed} stale heartbeat entr${removed === 1 ? "y" : "ies"}`;
      },
    },
  ];
}

function checkInstances(
  repoRoot: string,
  stateDir: string,
  commsDir: string,
): Check[] {
  const checks: Check[] = [];
  const state = loadState(repoRoot);

  if (!state) {
    checks.push({
      name: "tap state",
      status: FAIL,
      message: "Not initialized. Run: tap init",
    });
    return checks;
  }

  checks.push({
    name: "tap state",
    status: PASS,
    message: `v${state.schemaVersion}, ${getInstalledInstances(state).length} instance(s)`,
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

      let status: "pass" | "warn" | "fail";
      let message: string;
      let fix: (() => string) | undefined;

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
          // Kill managed app-server/gateway if still alive
          const appServer = bridgeState.appServer;
          if (appServer?.managed) {
            for (const pid of [appServer.auth?.gatewayPid, appServer.pid]) {
              if (pid) {
                try {
                  if (process.platform === "win32") {
                    spawnSync("taskkill", ["/PID", String(pid), "/F", "/T"], {
                      stdio: "pipe",
                    });
                  } else {
                    process.kill(pid);
                  }
                } catch {
                  // Already dead — fine
                }
              }
            }
          }
          // Clean up stale bridge PID file
          const pidPath = join(stateDir, "pids", `bridge-${id}.json`);
          try {
            unlinkSync(pidPath);
          } catch {
            // ignore
          }
          // Clear bridge reference in instance state
          const currentState = loadState(repoRoot);
          if (currentState?.instances[id]) {
            currentState.instances[id].bridge = null;
            currentState.updatedAt = new Date().toISOString();
            saveState(repoRoot, currentState);
          }
          const removedHeartbeats = pruneHeartbeatIds(commsDir, [
            id,
            id.replace(/-/g, "_"),
            id.replace(/_/g, "-"),
          ]);
          const suffix =
            removedHeartbeats > 0
              ? `; pruned ${removedHeartbeats} heartbeat entr${removedHeartbeats === 1 ? "y" : "ies"}`
              : "";
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

      if (
        savedThread?.threadId &&
        savedThread.cwd &&
        !samePath(savedThread.cwd, repoRoot)
      ) {
        status = WARN;
        message = appendWarningMessage(
          message,
          `saved thread cwd mismatch (${savedThread.cwd})`,
        );
      }

      if (
        runtimeHeartbeat?.threadId &&
        savedThread?.threadId &&
        runtimeHeartbeat.threadId !== savedThread.threadId
      ) {
        status = WARN;
        message = appendWarningMessage(
          message,
          `saved thread ${savedThread.threadId} differs from active thread ${runtimeHeartbeat.threadId}`,
        );
      }

      if (
        runtimeHeartbeat?.threadCwd &&
        !samePath(runtimeHeartbeat.threadCwd, repoRoot)
      ) {
        status = WARN;
        message = appendWarningMessage(
          message,
          `active thread cwd mismatch (${runtimeHeartbeat.threadCwd})`,
        );
      }

      checks.push({ name: `bridge: ${id}`, status, message, fix });
    } else {
      checks.push({
        name: `instance: ${id}`,
        status: PASS,
        message: `${inst.runtime} (${inst.bridgeMode})`,
      });
    }
  }

  return checks;
}

function checkMessageLifecycle(commsDir: string): Check[] {
  const checks: Check[] = [];
  const inbox = join(commsDir, "inbox");

  if (!existsSync(inbox)) {
    checks.push({
      name: "message flow",
      status: FAIL,
      message: "No inbox",
    });
    return checks;
  }

  const total = countFiles(inbox);
  const recent1h = recentFileCount(inbox, 60 * 60 * 1000);
  const recent10m = recentFileCount(inbox, 10 * 60 * 1000);

  checks.push({
    name: "message flow",
    status: recent10m > 0 ? PASS : total > 0 ? WARN : FAIL,
    message: `${total} total, ${recent1h} in last 1h, ${recent10m} in last 10m`,
  });

  // Receipt coverage
  const receiptsPath = join(commsDir, "receipts", "receipts.json");
  if (existsSync(receiptsPath)) {
    try {
      const receipts = JSON.parse(readFileSync(receiptsPath, "utf-8"));
      const receiptCount = Object.keys(receipts).length;
      checks.push({
        name: "read receipts",
        status: PASS,
        message: `${receiptCount} receipts tracked`,
      });
    } catch {
      checks.push({
        name: "read receipts",
        status: WARN,
        message: "File exists but unreadable",
      });
    }
  }

  return checks;
}

function checkMcpServer(repoRoot: string): Check[] {
  const checks: Check[] = [];

  const mcpJson = join(repoRoot, ".mcp.json");
  if (!existsSync(mcpJson)) {
    checks.push({
      name: "MCP config (.mcp.json)",
      status: WARN,
      message: "Not found — MCP channel notifications won't work",
    });
    return checks;
  }

  let config: Record<string, unknown>;
  try {
    config = JSON.parse(readFileSync(mcpJson, "utf-8"));
  } catch {
    checks.push({
      name: "MCP config (.mcp.json)",
      status: WARN,
      message: "File exists but invalid JSON",
    });
    return checks;
  }

  const mcpServers = config?.mcpServers as Record<string, unknown> | undefined;
  const hasTap = mcpServers?.["tap"] as
    | {
        command?: string;
        args?: string[];
        cwd?: string;
        env?: Record<string, string>;
      }
    | undefined;
  const hasOldKey = mcpServers?.["tap-comms"] as
    | Record<string, unknown>
    | undefined;

  if (hasOldKey) {
    checks.push({
      name: "MCP config (.mcp.json)",
      status: WARN,
      message:
        'Legacy "tap-comms" key found. Run "tap add claude" to migrate to the new "tap" key.',
    });
  }

  if (!hasTap && !hasOldKey) {
    checks.push({
      name: "MCP config (.mcp.json)",
      status: WARN,
      message: "tap not configured",
    });
    return checks;
  }

  // Use new key if available, fall back to old key for backward compat
  const hasTapComms = (hasTap ?? hasOldKey) as
    | {
        command?: string;
        args?: string[];
        cwd?: string;
        env?: Record<string, string>;
      }
    | undefined;
  if (!hasTapComms) {
    checks.push({
      name: "MCP config (.mcp.json)",
      status: FAIL,
      message: "No tap or tap-comms key found in .mcp.json",
    });
    return checks;
  }

  checks.push({
    name: "MCP config (.mcp.json)",
    status: PASS,
    message: `command: ${hasTapComms.command}`,
  });

  // Check if MCP command is available (absolute path or PATH lookup)
  if (hasTapComms.command) {
    const cmd = hasTapComms.command;
    let cmdAvailable = existsSync(cmd); // Absolute path check
    if (!cmdAvailable) {
      // PATH-based command — try running with --version
      try {
        const result = spawnSync(cmd, ["--version"], {
          stdio: "pipe",
          timeout: 5000,
          shell: process.platform === "win32",
        });
        cmdAvailable = result.status === 0;
      } catch {
        // command not found or failed
      }
    }
    checks.push({
      name: "MCP command binary",
      status: cmdAvailable ? PASS : FAIL,
      message: cmdAvailable
        ? cmd
        : `Not found: ${cmd} (checked PATH and absolute)`,
    });
  }

  // Check if MCP server script/args exist
  if (hasTapComms.args?.[0]) {
    const mcpScript = hasTapComms.args[0];
    checks.push({
      name: "MCP server script",
      status: existsSync(mcpScript) ? PASS : FAIL,
      message: existsSync(mcpScript) ? mcpScript : `Not found: ${mcpScript}`,
    });

    // Warn if using compiled .mjs with node (bun:sqlite fallback)
    if (
      mcpScript.endsWith(".mjs") &&
      hasTapComms.command &&
      !hasTapComms.command.includes("bun")
    ) {
      checks.push({
        name: "MCP SQLite support",
        status: WARN,
        message:
          "Node + .mjs = no SQLite (bun:sqlite unavailable). Use bun or .ts source for full features.",
      });
    }
  }

  // Check cwd field — missing cwd caused MCP connection failures in Gen 11
  if (!hasTapComms.cwd) {
    checks.push({
      name: "MCP cwd field",
      status: WARN,
      message:
        "No cwd in .mcp.json — worktree sessions may fail to resolve MCP server dependencies",
    });
  } else {
    checks.push({
      name: "MCP cwd field",
      status: PASS,
      message: hasTapComms.cwd,
    });
  }

  // Check TAP_COMMS_DIR in env
  const envCommsDir = hasTapComms.env?.TAP_COMMS_DIR;
  if (!envCommsDir) {
    checks.push({
      name: "MCP TAP_COMMS_DIR",
      status: FAIL,
      message:
        "TAP_COMMS_DIR not set in .mcp.json env — server will fail to start",
    });
  } else {
    checks.push({
      name: "MCP TAP_COMMS_DIR",
      status: existsSync(envCommsDir) ? PASS : FAIL,
      message: existsSync(envCommsDir)
        ? envCommsDir
        : `Directory not found: ${envCommsDir}`,
    });
  }

  // Note about --resume/--continue cache behavior
  // (Can't detect at runtime, but document in output)
  checks.push({
    name: "MCP session cache",
    status: PASS,
    message:
      "If .mcp.json was changed mid-session, restart Claude (Ctrl+C → claude --resume) to reload",
  });

  return checks;
}

function checkCodexConfig(repoRoot: string, commsDir: string): Check[] {
  const spec = buildCodexDoctorSpec(repoRoot, commsDir);
  if (!spec) {
    return [];
  }

  const checks: Check[] = [];
  const fixHint = 'Run "tap doctor --fix" or "tap add codex --force".';

  if (!existsSync(spec.configPath)) {
    checks.push({
      name: "MCP config (~/.codex/config.toml)",
      status: WARN,
      message: `${spec.configPath} not found. ${fixHint}`,
      fix: () => repairCodexConfig(repoRoot, commsDir),
    });
    return checks;
  }

  const content = readFileSync(spec.configPath, "utf-8");
  const tapTable = extractTomlTable(content, "mcp_servers.tap");
  const tapEnvTable = extractTomlTable(content, "mcp_servers.tap.env");
  const legacyTable = extractTomlTable(content, "mcp_servers.tap-comms");
  const legacyEnvTable = extractTomlTable(content, "mcp_servers.tap-comms.env");
  const selectedMain = parseTomlAssignments(tapTable ?? "");
  const selectedEnv = parseTomlAssignments(tapEnvTable ?? legacyEnvTable ?? "");
  const issues: string[] = [];

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

  // M224: approval_mode drift check
  if (tapTable) {
    const actualApprovalMode = selectedMain.approval_mode;
    if (typeof actualApprovalMode !== "string") {
      issues.push("approval_mode missing (expected auto)");
    } else if (actualApprovalMode !== "auto") {
      issues.push(`approval_mode drift (${actualApprovalMode})`);
    }
  }

  for (const trustTarget of spec.trustTargets) {
    const trustTable = extractTomlTable(content, trustSelector(trustTarget));
    if (!trustTable || !trustTable.includes('trust_level = "trusted"')) {
      issues.push(`missing trust for ${trustTarget}`);
    }
  }

  if (issues.length === 0) {
    checks.push({
      name: "MCP config (~/.codex/config.toml)",
      status: PASS,
      message: spec.configPath,
    });
    return checks;
  }

  checks.push({
    name: "MCP config (~/.codex/config.toml)",
    status: WARN,
    message: `${issues.join("; ")}. ${fixHint}`,
    fix: () => repairCodexConfig(repoRoot, commsDir),
  });

  return checks;
}

// ── Bridge Turn Health (zombie detection) ───────────────────────────

function checkBridgeTurnHealth(repoRoot: string): Check[] {
  const checks: Check[] = [];
  const tmpDir = join(repoRoot, ".tmp");
  if (!existsSync(tmpDir)) return checks;

  // Only scan dirs that belong to active instances or their agents
  const state = loadState(repoRoot);
  const activeMatchers = new Set<string>();
  if (state) {
    for (const [id, inst] of Object.entries(state.instances)) {
      if (inst?.installed && inst.bridgeMode === "app-server") {
        activeMatchers.add(id);
        // Also match agentName-based dirs (manual runbook pattern)
        if (inst.agentName) activeMatchers.add(inst.agentName);
      }
    }
  }

  let dirs: string[];
  try {
    dirs = readdirSync(tmpDir).filter((d) => {
      if (!d.startsWith("codex-app-server-bridge")) return false;
      const suffix = d.replace("codex-app-server-bridge-", "");
      if (activeMatchers.size === 0) return true; // No state → scan all
      for (const matcher of activeMatchers) {
        if (suffix === matcher || suffix.startsWith(matcher)) return true;
      }
      return false;
    });
  } catch {
    return checks;
  }

  for (const dir of dirs) {
    const heartbeatPath = join(tmpDir, dir, "heartbeat.json");
    if (!existsSync(heartbeatPath)) continue;

    let heartbeat: {
      updatedAt?: string;
      activeTurnId?: string | null;
      lastTurnStatus?: string;
      lastNotificationAt?: string;
      lastNotificationMethod?: string;
      connected?: boolean;
      initialized?: boolean;
      authenticated?: boolean;
      consecutiveFailureCount?: number;
      lastError?: string | null;
    };

    try {
      heartbeat = JSON.parse(readFileSync(heartbeatPath, "utf-8"));
    } catch {
      checks.push({
        name: `turn: ${dir}`,
        status: WARN,
        message: "heartbeat.json unreadable",
      });
      continue;
    }

    // Calculate heartbeat age
    const heartbeatAge = heartbeat.updatedAt
      ? Math.floor(
          (Date.now() - new Date(heartbeat.updatedAt).getTime()) / 1000,
        )
      : null;

    // Not connected
    if (heartbeat.connected === false || heartbeat.initialized === false) {
      checks.push({
        name: `turn: ${dir}`,
        status: FAIL,
        message: `disconnected (connected=${heartbeat.connected}, initialized=${heartbeat.initialized})${heartbeat.lastError ? ` — ${heartbeat.lastError}` : ""}`,
      });
      continue;
    }

    // Dead — no heartbeat update for 5+ minutes
    if (heartbeatAge !== null && heartbeatAge > 300) {
      checks.push({
        name: `turn: ${dir}`,
        status: FAIL,
        message: `dead — heartbeat ${Math.round(heartbeatAge)}s ago, no updates`,
      });
      continue;
    }

    // Zombie — active turn with no notification progress for 30+ minutes (Fix 1)
    if (heartbeat.activeTurnId) {
      const ZOMBIE_THRESHOLD = 30 * 60; // 30 minutes
      const lastNotifAge = heartbeat.lastNotificationAt
        ? Math.floor(
            (Date.now() - new Date(heartbeat.lastNotificationAt).getTime()) /
              1000,
          )
        : null;

      // Primary: use lastNotificationAt to detect stuck turns
      if (lastNotifAge !== null && lastNotifAge > ZOMBIE_THRESHOLD) {
        checks.push({
          name: `turn: ${dir}`,
          status: WARN,
          message: `zombie — active turn ${heartbeat.activeTurnId}, last notification ${Math.round(lastNotifAge / 60)}m ago (${heartbeat.lastNotificationMethod ?? "?"}). MCP tools may not be exposed in app-server turns — try bridge restart${heartbeat.lastError ? `. Error: ${heartbeat.lastError}` : ""}`,
        });
        continue;
      }

      // Fallback: consecutive failures + active turn = zombie signal
      const failures = heartbeat.consecutiveFailureCount ?? 0;
      if (failures > 0 && heartbeatAge !== null && heartbeatAge < 60) {
        checks.push({
          name: `turn: ${dir}`,
          status: WARN,
          message: `zombie — active turn ${heartbeat.activeTurnId}, ${failures} consecutive failures. MCP tools may not be exposed in app-server turns — try bridge restart${heartbeat.lastError ? `. Error: ${heartbeat.lastError}` : ""}`,
        });
        continue;
      }
    }

    // Slow — heartbeat fresh but lots of failures
    const failures = heartbeat.consecutiveFailureCount ?? 0;
    if (failures > 5) {
      checks.push({
        name: `turn: ${dir}`,
        status: WARN,
        message: `slow — ${failures} consecutive failures, last: ${heartbeat.lastError ?? "unknown"}`,
      });
      continue;
    }

    // M175: Warn when a live bridge is running without auth
    if (heartbeat.authenticated === false) {
      checks.push({
        name: `turn: ${dir}`,
        status: WARN,
        message:
          "bridge running without auth — app-server session is unprotected. " +
          "Use --gateway-token-file to enable auth.",
      });
    }

    // Healthy
    const turnInfo = heartbeat.activeTurnId
      ? `active turn ${heartbeat.activeTurnId}`
      : `idle (last: ${heartbeat.lastTurnStatus ?? "none"})`;
    checks.push({
      name: `turn: ${dir}`,
      status: PASS,
      message: `healthy — ${turnInfo}, heartbeat ${heartbeatAge ?? "?"}s ago`,
    });
  }

  return checks;
}

// ── Render ──────────────────────────────────────────────────────────────

function renderCheck(check: Check, fixMode: boolean): string {
  const icons: Record<string, string> = {
    pass: "[OK]",
    warn: "[!!]",
    fail: "[XX]",
    skip: "[--]",
  };
  const icon = icons[check.status] || "[??]";
  const fixable = fixMode && check.fix ? " (fixable)" : "";
  const msg = check.message ? ` — ${check.message}${fixable}` : "";
  return `  ${icon} ${check.name}${msg}`;
}

const DOCTOR_HELP = `
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

// ── Command ─────────────────────────────────────────────────────────────

export async function doctorCommand(args: string[]): Promise<CommandResult> {
  if (args.includes("--help") || args.includes("-h")) {
    log(DOCTOR_HELP);
    return {
      ok: true,
      command: "doctor",
      code: "TAP_NO_OP",
      message: DOCTOR_HELP,
      warnings: [],
      data: {},
    };
  }

  const repoRoot = findRepoRoot();

  // Parse flags
  const overrides: Record<string, string> = {};
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
  const commsDir = overrides.commsDir
    ? config.commsDir
    : (state?.commsDir ?? config.commsDir);

  logHeader(`@hua-labs/tap doctor (v${version})${fixMode ? " --fix" : ""}`);

  function checkConfigDrift(): Check[] {
    let driftResults;
    try {
      driftResults = checkAllDrift(config.stateDir, state);
    } catch (err) {
      // Surface the error as a warn so drift check failure is visible
      return [
        {
          name: "drift:infrastructure",
          status: "warn" as const,
          message: `Config drift check failed: ${err instanceof Error ? err.message : String(err)}`,
        },
      ];
    }
    const checks: Check[] = [];
    for (const result of driftResults) {
      for (const dc of result.checks) {
        const check: Check = {
          name: `drift:${result.instanceId}:${dc.name}`,
          status:
            dc.status === "ok" ? "pass" : dc.autoFixable ? "warn" : "fail",
          message: dc.details ?? undefined,
        };
        if (dc.autoFixable && dc.status !== "ok") {
          check.fix = () => {
            const {
              loadInstanceConfig: loadInst,
              saveInstanceConfig: saveInst,
            } = require("../config/instance-config.js");
            const {
              computeFileHash: hashFile,
            } = require("../config/drift-detector.js");
            const instConfig = loadInst(config.stateDir, result.instanceId);
            if (!instConfig || !state) {
              return `Skipped: instance config not found for ${result.instanceId}`;
            }
            const inst = state.instances[result.instanceId];
            if (!inst) {
              return `Skipped: instance not in state.json for ${result.instanceId}`;
            }

            // Sync state.json fields from instance config
            inst.agentName = instConfig.agentName;
            inst.port = instConfig.port;
            inst.configHash = instConfig.configHash;
            inst.configSourceFile =
              inst.configSourceFile ||
              join(config.stateDir, "instances", `${result.instanceId}.json`);
            saveState(repoRoot, state);

            // Resync runtime config hash if configPath exists
            if (inst.configPath && existsSync(inst.configPath)) {
              const currentHash = hashFile(inst.configPath);
              if (instConfig.runtimeConfigHash !== currentHash) {
                instConfig.runtimeConfigHash = currentHash;
                instConfig.lastSyncedToRuntime = new Date().toISOString();
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

  function runAllChecks(): Check[] {
    const checks: Check[] = [];
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

  // Initial scan
  const initialChecks = runAllChecks();
  for (const section of [
    "Comms",
    "Instances",
    "Config Drift",
    "Messages",
    "MCP",
    "Turns",
  ] as const) {
    const sectionChecks = {
      Comms: initialChecks.filter((c) =>
        [
          "comms directory",
          "inbox directory",
          "reviews directory",
          "findings directory",
          "heartbeats",
          "stale heartbeats",
        ].includes(c.name),
      ),
      Instances: initialChecks.filter(
        (c) =>
          c.name.startsWith("bridge:") ||
          c.name.startsWith("instance:") ||
          c.name === "tap state",
      ),
      "Config Drift": initialChecks.filter((c) => c.name.startsWith("drift:")),
      Messages: initialChecks.filter((c) =>
        ["message flow", "read receipts"].includes(c.name),
      ),
      MCP: initialChecks.filter(
        (c) => c.name.startsWith("MCP") || c.name === "MCP server script",
      ),
      Turns: initialChecks.filter((c) => c.name.startsWith("turn:")),
    }[section];
    if (sectionChecks.length > 0) {
      log(`${section}:`);
      for (const c of sectionChecks) log(renderCheck(c, fixMode));
      log("");
    }
  }

  // Auto-fix + re-verify
  const fixed: string[] = [];
  let finalChecks = initialChecks;

  if (fixMode) {
    const fixable = initialChecks.filter(
      (c) => (c.status === "warn" || c.status === "fail") && c.fix,
    );
    if (fixable.length > 0) {
      log("Fixes:");
      for (const c of fixable) {
        try {
          const desc = c.fix!();
          fixed.push(desc);
          logSuccess(`  ${desc}`);
        } catch (err) {
          logWarn(
            `  Failed to fix ${c.name}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
      // Re-run all checks after fixes for accurate post-fix status
      log("");
      log("Re-verifying...");
      finalChecks = runAllChecks();
      const postFails = finalChecks.filter((c) => c.status === "fail").length;
      const postWarns = finalChecks.filter((c) => c.status === "warn").length;
      log(
        `  ${postFails === 0 ? "All clear" : `${postFails} remaining failures, ${postWarns} warnings`}`,
      );
    } else {
      log("Nothing to fix.");
    }
  }

  // Summary (based on final state)
  const passes = finalChecks.filter((c) => c.status === "pass").length;
  const warns = finalChecks.filter((c) => c.status === "warn").length;
  const fails = finalChecks.filter((c) => c.status === "fail").length;

  log("");
  log(
    `${finalChecks.length} checks: ${passes} passed, ${warns} warnings, ${fails} failures` +
      (fixed.length > 0 ? ` (${fixed.length} fixed)` : ""),
  );

  return {
    ok: fails === 0,
    command: "doctor",
    code: fails === 0 ? "TAP_STATUS_OK" : "TAP_VERIFY_FAILED",
    message: `${passes} passed, ${warns} warnings, ${fails} failures`,
    warnings: finalChecks
      .filter((c) => c.status === "warn")
      .map((c) => `${c.name}: ${c.message}`),
    data: {
      checks: finalChecks.map(({ fix, ...rest }) => rest),
      summary: { total: finalChecks.length, passes, warns, fails },
      fixed,
    },
  };
}
