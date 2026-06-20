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
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import {
  buildManagedMcpServerSpec,
  getCodexConfigPath,
  type ManagedMcpServerSpec,
  probeCommand,
} from "../adapters/common.js";
import { loadState, saveState, getInstalledInstances } from "../state.js";
import {
  isBridgeRunning,
  getHeartbeatAge,
  loadBridgeState,
  loadRuntimeBridgeHeartbeat,
  loadRuntimeBridgeThreadState,
} from "../engine/bridge.js";
import {
  loadLiveDispatchEvidence,
  resolveUniqueLiveDispatchAliases,
} from "../engine/health-monitor.js";
import { resolveConfig } from "../config/index.js";
import { checkAllDrift } from "../config/drift-detector.js";
import {
  detectCommsPathDrift,
  type CommsPathSource,
} from "../config/comms-path-drift.js";
import { logFilePath, pidFilePath } from "../engine/bridge-paths.js";
import { resolvePackagedBridgeAsset } from "../engine/bridge-codex-command.js";
import {
  createAdapterContext,
  findRepoRoot,
  log,
  logHeader,
  logSuccess,
  logWarn,
  parseArgs,
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
import {
  buildSetupReport,
  parseSetupProfile,
  type SetupPhase,
  type SetupProfile,
  type SetupResidual,
  type SetupStatus,
  type TapSetupReport,
} from "./setup.js";

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

interface SetupDoctorReport extends Record<string, unknown> {
  command: "doctor";
  mode: "setup";
  profile: SetupProfile;
  dryRun: boolean;
  apply: boolean;
  status: SetupStatus;
  generatedAt: string;
  summary: string;
  environment: TapSetupReport["environment"];
  phases: SetupPhase[];
  actions: TapSetupReport["actions"];
  nextActions: TapSetupReport["nextActions"];
  residual: SetupResidual[];
  setupReport: Pick<
    TapSetupReport,
    "command" | "profile" | "status" | "generatedAt" | "summary" | "applyPlan"
  >;
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
const CODEX_CONFIG_CHECK_NAME = "MCP config (Codex config.toml)";

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

function normalizeCommandBasename(command: string): string {
  const token = command.split(/[\\/]/).pop() ?? command;
  return token.toLowerCase().replace(/\.(cmd|exe|ps1|bat)$/i, "");
}

function findFirstLauncherTarget(args: string[]): string | null {
  for (const arg of args) {
    if (!arg || arg === "--" || arg.startsWith("-")) {
      continue;
    }
    return arg;
  }

  return null;
}

function looksLikePackageSpecifier(value: string): boolean {
  const normalized = value.trim();
  if (
    !normalized ||
    /^[A-Za-z]:[\\/]/.test(normalized) ||
    normalized.startsWith("/") ||
    normalized.startsWith("\\") ||
    normalized.startsWith(".") ||
    /\.(?:[cm]?js|tsx?|json|ps1|cmd|exe)$/i.test(normalized)
  ) {
    return false;
  }

  return /^(?:@[^/\\]+\/)?[A-Za-z0-9][A-Za-z0-9._-]*(?:@[A-Za-z0-9][A-Za-z0-9._.-]*)?$/.test(
    normalized,
  );
}

function getNpxPackageLauncher(command: string, args: string[]): string | null {
  if (normalizeCommandBasename(command) !== "npx") {
    return null;
  }

  const packageName = findFirstLauncherTarget(args);
  if (!packageName || !looksLikePackageSpecifier(packageName)) {
    return null;
  }

  return [command, ...args].join(" ");
}

function appendWarningMessage(message: string, extra: string): string {
  return message.includes(extra) ? message : `${message}; ${extra}`;
}

function findCodexConfigPath(): string {
  return getCodexConfigPath();
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

function formatCommsPathSources(sources: CommsPathSource[]): string {
  const lines: string[] = [];
  for (const s of sources) {
    if (!s.present) {
      lines.push(`${s.name}: missing`);
    } else if (!s.raw) {
      lines.push(`${s.name}: no ${s.key}`);
    } else {
      lines.push(`${s.name}: ${s.resolved}`);
    }
  }
  return lines.join("; ");
}

function checkCommsPathDrift(repoRoot: string, stateDir: string): Check[] {
  const result = detectCommsPathDrift(repoRoot, stateDir);

  if (result.status === "ok") {
    return [
      {
        name: "comms path drift",
        status: PASS,
        message: `all 4 slots agree (${result.effective})`,
      },
    ];
  }

  if (result.status === "empty") {
    return [
      {
        name: "comms path drift",
        status: WARN,
        message:
          "No TAP_COMMS_DIR / commsDir configured anywhere. Runtime falls back to <repoRoot>/tap-comms (deprecated).",
      },
    ];
  }

  const detail = formatCommsPathSources(result.sources);
  return [
    {
      name: "comms path drift",
      status: WARN,
      message: `effective=${result.effective}; ${detail}. See docs/areas/tap/comms-path-drift-runbook.md`,
    },
  ];
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
      const liveDispatch =
        running && bridgeState
          ? null
          : loadLiveDispatchEvidence(
              commsDir,
              id,
              resolveUniqueLiveDispatchAliases(state.instances, id),
            );

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
      } else if (liveDispatch) {
        status = PASS;
        message = `Live dispatch PID ${liveDispatch.bridgePid} (no tracked bridge pid state)`;
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

      // Always append active log path so users know where to look
      const bridgeLogPath = logFilePath(stateDir, id);
      message = `${message}; log: ${bridgeLogPath}`;

      checks.push({ name: `bridge: ${id}`, status, message, fix });

      // M329: Check if bridge is running stale code (dist updated after bridge start)
      if (running && inst.runtime === "codex") {
        const staleCheck = checkBridgeCodeStaleness(repoRoot, stateDir, id);
        if (staleCheck) {
          checks.push(staleCheck);
        }
      }
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

/**
 * M329: Check if a running bridge is using stale code.
 * Compares dist file mtime against the PID file mtime (≈ bridge start time).
 * If dist is newer, the bridge needs a restart to pick up code changes.
 */
function checkBridgeCodeStaleness(
  repoRoot: string,
  stateDir: string,
  instanceId: string,
): Check | null {
  const pidPath = pidFilePath(stateDir, instanceId);
  let bridgeStartTime: number;
  try {
    bridgeStartTime = statSync(pidPath).mtimeMs;
  } catch {
    return null; // No PID file — can't determine start time
  }

  // Check bridge runner dist — the script the bridge process actually runs
  const distFiles = [
    resolvePackagedBridgeAsset(repoRoot, "codex-bridge-runner.mjs"),
    resolvePackagedBridgeAsset(repoRoot, "codex-app-server-bridge.mjs"),
  ].filter(Boolean) as string[];

  if (distFiles.length === 0) {
    return null; // Can't locate dist files
  }

  let newestDistTime = 0;
  for (const distFile of distFiles) {
    try {
      const mtime = statSync(distFile).mtimeMs;
      if (mtime > newestDistTime) {
        newestDistTime = mtime;
      }
    } catch {
      // Skip inaccessible files
    }
  }

  if (newestDistTime === 0) {
    return null;
  }

  if (newestDistTime > bridgeStartTime) {
    const driftMinutes = Math.round(
      (newestDistTime - bridgeStartTime) / 60_000,
    );
    return {
      name: `code-drift: ${instanceId}`,
      status: WARN,
      message: `Bridge running stale code — dist updated ${driftMinutes}m after bridge start. Restart recommended: tap bridge restart ${instanceId}`,
    };
  }

  return {
    name: `code-drift: ${instanceId}`,
    status: PASS,
    message: "Bridge code is up to date",
  };
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
  const messageSummary = `${total} total, ${recent1h} in last 1h, ${recent10m} in last 10m`;

  checks.push({
    name: "message flow",
    status: recent10m > 0 ? PASS : WARN,
    message:
      total === 0
        ? `${messageSummary} (expected before first exchange)`
        : messageSummary,
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
      // PATH-based command — reuse the same direct spawn probe as runtime setup
      cmdAvailable = probeCommand([cmd]).command !== null;
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
  const npxPackageLauncher =
    hasTapComms.command && hasTapComms.args
      ? getNpxPackageLauncher(hasTapComms.command, hasTapComms.args)
      : null;
  if (npxPackageLauncher) {
    checks.push({
      name: "MCP server script",
      status: PASS,
      message: `Package launcher: ${npxPackageLauncher}`,
    });
  } else if (hasTapComms.args?.[0]) {
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
      name: CODEX_CONFIG_CHECK_NAME,
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
      name: CODEX_CONFIG_CHECK_NAME,
      status: PASS,
      message: spec.configPath,
    });
    return checks;
  }

  checks.push({
    name: CODEX_CONFIG_CHECK_NAME,
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
        // Also match display-name-based dirs (manual runbook pattern)
        if (inst.defaultAgentName) activeMatchers.add(inst.defaultAgentName);
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
  tap doctor --setup --profile <codex-cli|codex-app|claude-channel> [--profile-pack <path>] [--json]

Description:
  Diagnose tap infrastructure health: comms directory, instances, bridges,
  message lifecycle, and MCP server configuration.

Options:
  --setup               Run setup/config/warm-up readiness doctor
  --profile <id>        Setup profile for --setup
  --profile-pack <path> Validate a profile pack as data-only setup context
  --agent <name>        Optional runtime identity for setup probes
  --fresh-minutes <n>   Presence freshness window for setup probes
  --fix                 Auto-repair detected issues where possible
  --comms-dir <path>    Override comms directory
  --help, -h            Show help

Examples:
  npx @hua-labs/tap doctor
  npx @hua-labs/tap doctor --fix
  npx @hua-labs/tap doctor --setup --profile codex-cli --json
  npx @hua-labs/tap doctor --setup --profile codex-cli --profile-pack ./tap-profile-pack.json --json
`.trim();

// ── Command ─────────────────────────────────────────────────────────────

function parseDoctorSetupOptions(args: string[]):
  | {
      setup: false;
    }
  | {
      setup: true;
      profile: SetupProfile | null;
      rawProfile: string | boolean | undefined;
      apply: boolean;
      commsDir?: string;
      agent?: string;
      freshMinutes?: number;
      profilePackPath?: string;
    } {
  const { flags } = parseArgs(args);
  if (flags.setup !== true) return { setup: false };

  const rawProfile = flags.profile;
  const commsDir =
    typeof flags["comms-dir"] === "string" ? flags["comms-dir"] : undefined;
  const agent = typeof flags.agent === "string" ? flags.agent : undefined;
  const profilePackPath =
    typeof flags["profile-pack"] === "string"
      ? flags["profile-pack"]
      : undefined;
  const freshMinutes =
    typeof flags["fresh-minutes"] === "string"
      ? Number.parseInt(flags["fresh-minutes"], 10)
      : undefined;
  const apply = flags.apply === true || flags.fix === true;

  return {
    setup: true,
    profile: parseSetupProfile(rawProfile),
    rawProfile,
    apply,
    commsDir,
    agent,
    profilePackPath,
    freshMinutes:
      freshMinutes && Number.isFinite(freshMinutes) && freshMinutes > 0
        ? freshMinutes
        : undefined,
  };
}

function buildSetupDoctorReport(
  profile: SetupProfile,
  apply: boolean,
  options: {
    commsDir?: string;
    agent?: string;
    freshMinutes?: number;
    profilePackPath?: string;
  } = {},
): SetupDoctorReport {
  const setupReport = buildSetupReport(profile, apply, options, {
    executeApply: apply,
  });
  const phases = setupReport.phases.filter(
    (phase) => !["delivery", "doctor"].includes(phase.id),
  );
  const residual: SetupResidual[] = [
    ...setupReport.residual,
    {
      id: "delivery-doctor-separated",
      severity: "info",
      message:
        "`tap doctor --setup` is setup/config/warm-up readiness only; use `tap comms-doctor` for delivery and evidence diagnostics.",
      nextAction: "tap comms-doctor --json",
    },
  ];
  if (apply) {
    residual.push({
      id: "doctor-setup-apply-reuses-setup-plan",
      severity: "info",
      message:
        "`tap doctor --setup --apply` reuses the same guarded SetupApplyPlan as `tap setup --apply`; it does not run the broad infrastructure fixer.",
      nextAction: `tap setup --profile ${profile} --apply --json`,
    });
  }

  return {
    command: "doctor",
    mode: "setup",
    profile,
    dryRun: !apply,
    apply,
    status: setupReport.status,
    generatedAt: setupReport.generatedAt,
    summary: apply
      ? `tap doctor --setup ${profile} apply reused setup apply plan: ${setupReport.applyPlan?.status ?? "unknown"}`
      : `tap doctor --setup ${profile} read-only report generated`,
    environment: setupReport.environment,
    phases,
    actions: phases.flatMap((phase) => phase.actions),
    nextActions: setupReport.nextActions.filter(
      (action) => action.id !== "run-setup-doctor",
    ),
    residual,
    setupReport: {
      command: setupReport.command,
      profile: setupReport.profile,
      status: setupReport.status,
      generatedAt: setupReport.generatedAt,
      summary: setupReport.summary,
      applyPlan: setupReport.applyPlan,
    },
  };
}

function setupDoctorResult(
  args: string[],
): CommandResult<SetupDoctorReport | Record<string, unknown>> | null {
  const parsed = parseDoctorSetupOptions(args);
  if (!parsed.setup) return null;

  if (parsed.rawProfile === undefined || parsed.rawProfile === true) {
    return {
      ok: false,
      command: "doctor",
      code: "TAP_INVALID_ARGUMENT",
      message: "Missing --profile <codex-cli|codex-app|claude-channel>.",
      warnings: [],
      data: {},
    };
  }
  if (!parsed.profile) {
    return {
      ok: false,
      command: "doctor",
      code: "TAP_INVALID_ARGUMENT",
      message: `Unknown setup profile: ${String(parsed.rawProfile)}. Expected codex-cli, codex-app, or claude-channel.`,
      warnings: [],
      data: {},
    };
  }

  const report = buildSetupDoctorReport(parsed.profile, parsed.apply, {
    commsDir: parsed.commsDir,
    agent: parsed.agent,
    freshMinutes: parsed.freshMinutes,
    profilePackPath: parsed.profilePackPath,
  });
  logHeader(`@hua-labs/tap doctor --setup (${parsed.profile})`);
  log(report.summary);
  if (parsed.apply) {
    log(
      `setup applyPlan: ${report.setupReport.applyPlan?.status ?? "missing"}`,
    );
  } else {
    log(
      "No files, config, permissions, inbox evidence, or processes were changed.",
    );
  }
  const blocked =
    parsed.apply &&
    (report.setupReport.applyPlan?.status === "blocked" ||
      report.setupReport.applyPlan?.status === "partial");
  return {
    ok: !blocked,
    command: "doctor",
    code: blocked ? "TAP_DOCTOR_SETUP_APPLY_BLOCKED" : "TAP_DOCTOR_SETUP_OK",
    message: report.summary,
    warnings: report.residual
      .filter((item) => item.severity !== "info")
      .map((item) => item.message),
    data: report,
  };
}

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

  const setupResult = setupDoctorResult(args);
  if (setupResult) return setupResult;

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
              getInstanceConfigPath: getInstPath,
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
            inst.defaultAgentName = instConfig.defaultAgentName;
            inst.port = instConfig.port;
            inst.configHash = instConfig.configHash;
            inst.configSourceFile = getInstPath(
              config.stateDir,
              result.instanceId,
            );
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

  /**
   * M310: Check identity state convergence across mutable stores.
   * Warns when heartbeats, claims, and agent-name.txt disagree.
   */
  function checkIdentityConvergence(): Check[] {
    const checks: Check[] = [];
    const state = loadState(repoRoot);
    if (!state) return checks;

    const heartbeatsPath = join(commsDir, "heartbeats.json");
    let heartbeatStore: Record<string, DoctorHeartbeatRecord> = {};
    try {
      if (existsSync(heartbeatsPath)) {
        heartbeatStore = JSON.parse(readFileSync(heartbeatsPath, "utf-8"));
      }
    } catch {
      // skip if unreadable
    }

    const claimsDir = join(commsDir, ".claims");
    const claimNames = new Map<string, string>(); // name → instanceId
    try {
      if (existsSync(claimsDir)) {
        for (const file of readdirSync(claimsDir)) {
          if (!file.endsWith(".json") || file.endsWith(".lock")) continue;
          try {
            const raw = JSON.parse(
              readFileSync(join(claimsDir, file), "utf-8"),
            ) as {
              name?: string;
              claimedBy?: { instanceId?: string };
            };
            if (raw.name && raw.claimedBy?.instanceId) {
              claimNames.set(raw.name, raw.claimedBy.instanceId);
            }
          } catch {
            /* skip */
          }
        }
      }
    } catch {
      /* skip */
    }

    const tmpDir = join(repoRoot, ".tmp");

    for (const [instanceId, inst] of Object.entries(state.instances)) {
      if (!inst.installed) continue;

      const sources: Record<string, string | null> = {};

      // 1. state.json name (bootstrap default)
      // M310 → M350: defaultAgentName is the only identity field here.
      sources["state.json"] = inst.defaultAgentName ?? null;

      // 2. heartbeat name (session mutable)
      const normalizedId = instanceId.replace(/-/g, "_");
      const hbEntry =
        heartbeatStore[instanceId] ?? heartbeatStore[normalizedId];
      sources["heartbeats"] = hbEntry?.agent ?? null;

      // 3. claims — find claim matching this instance
      let claimName: string | null = null;
      for (const [name, claimInstanceId] of claimNames) {
        if (
          claimInstanceId === instanceId ||
          claimInstanceId === normalizedId
        ) {
          claimName = name;
          break;
        }
      }
      sources["claims"] = claimName;

      // 4. agent-name.txt (runtime file)
      let runtimeName: string | null = null;
      try {
        const runtimeDir = join(
          tmpDir,
          `codex-app-server-bridge-${instanceId}`,
        );
        const agentNamePath = join(runtimeDir, "agent-name.txt");
        if (existsSync(agentNamePath)) {
          runtimeName = readFileSync(agentNamePath, "utf-8").trim() || null;
        }
      } catch {
        /* skip */
      }
      sources["agent-name.txt"] = runtimeName;

      // Check convergence among mutable stores (heartbeats, claims, agent-name.txt)
      const mutableValues = [
        sources["heartbeats"],
        sources["claims"],
        sources["agent-name.txt"],
      ].filter(
        (v): v is string => v != null && v !== "unknown" && v !== "unnamed",
      );

      const uniqueValues = new Set(mutableValues);
      if (uniqueValues.size > 1) {
        const detail = Object.entries(sources)
          .filter(([, v]) => v != null)
          .map(([k, v]) => `${k}="${v}"`)
          .join(", ");
        checks.push({
          name: `identity: ${instanceId}`,
          status: WARN,
          message: `Identity divergence — ${detail}`,
        });
      } else if (mutableValues.length > 0) {
        checks.push({
          name: `identity: ${instanceId}`,
          status: PASS,
          message: `Converged as "${mutableValues[0]}"`,
        });
      }

      // M350: the deprecated `agentName` field is now stripped on load, so
      // there is nothing to cross-check against `defaultAgentName` here.
    }

    // M310: Warn about deprecated instances/*.json files
    const instancesDir = join(config.stateDir, "instances");
    try {
      if (existsSync(instancesDir)) {
        const files = readdirSync(instancesDir).filter((f) =>
          f.endsWith(".json"),
        );
        if (files.length > 0) {
          checks.push({
            name: "identity: instance-configs",
            status: WARN,
            message: `${files.length} deprecated instances/*.json file(s) found — identity now uses state.json defaultAgentName + heartbeats`,
          });
        }
      }
    } catch {
      /* skip */
    }

    return checks;
  }

  function runAllChecks(): Check[] {
    const checks: Check[] = [];
    checks.push(...checkComms(commsDir));
    checks.push(...checkCommsPathDrift(repoRoot, config.stateDir));
    checks.push(...checkStaleHeartbeats(repoRoot, commsDir, config.stateDir));
    checks.push(...checkInstances(repoRoot, config.stateDir, commsDir));
    checks.push(...checkConfigDrift());
    checks.push(...checkIdentityConvergence());
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
    "Identity",
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
          "comms path drift",
        ].includes(c.name),
      ),
      Instances: initialChecks.filter(
        (c) =>
          c.name.startsWith("bridge:") ||
          c.name.startsWith("code-drift:") ||
          c.name.startsWith("instance:") ||
          c.name === "tap state",
      ),
      Identity: initialChecks.filter((c) => c.name.startsWith("identity:")),
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
      checks: finalChecks.map(({ fix: _fix, ...rest }) => rest),
      summary: { total: finalChecks.length, passes, warns, fails },
      fixed,
    },
  };
}
