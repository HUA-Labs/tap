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
  statSync,
  unlinkSync,
} from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";
import { loadState, saveState, getInstalledInstances } from "../state.js";
import {
  isBridgeRunning,
  getHeartbeatAge,
  loadBridgeState,
  saveBridgeState,
} from "../engine/bridge.js";
import { resolveConfig } from "../config/index.js";
import { findRepoRoot, log, logHeader, logSuccess, logWarn } from "../utils.js";
import { version } from "../version.js";
import type { CommandResult } from "../types.js";

// ── Types ───────────────────────────────────────────────────────────────

interface Check {
  name: string;
  status: "pass" | "warn" | "fail" | "skip";
  message?: string;
  fix?: () => string; // Returns description of what was fixed
}

// ── Helpers ─────────────────────────────────────────────────────────────

const PASS = "pass" as const;
const WARN = "warn" as const;
const FAIL = "fail" as const;

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

function loadBridgeRuntimeHeartbeat(
  bridgeState:
    | {
        runtimeStateDir?: string | null;
      }
    | null
    | undefined,
): {
  lastError?: string | null;
} | null {
  const runtimeStateDir = bridgeState?.runtimeStateDir;
  if (!runtimeStateDir) {
    return null;
  }

  const heartbeatPath = join(runtimeStateDir, "heartbeat.json");
  if (!existsSync(heartbeatPath)) {
    return null;
  }

  try {
    return JSON.parse(readFileSync(heartbeatPath, "utf-8")) as {
      lastError?: string | null;
    };
  } catch {
    return null;
  }
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
        return ts && now - new Date(ts).getTime() < 10 * 60 * 1000;
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

function checkInstances(repoRoot: string, stateDir: string): Check[] {
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
      const runtimeHeartbeat = loadBridgeRuntimeHeartbeat(bridgeState);

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
                  process.kill(pid);
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
          return `Cleaned stale bridge + managed processes for ${id}`;
        };
      } else {
        status = WARN;
        message = "Not running";
      }

      const lastRuntimeError = runtimeHeartbeat?.lastError?.trim();
      if (lastRuntimeError) {
        status = status === FAIL ? FAIL : WARN;
        message = `${message}; bridge last error: ${lastRuntimeError}`;
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

  const hasTapComms = (config?.mcpServers as Record<string, unknown>)?.[
    "tap-comms"
  ] as
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
      status: WARN,
      message: "tap-comms not configured",
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
        execSync(`"${cmd}" --version`, {
          stdio: "pipe",
          timeout: 5000,
        });
        cmdAvailable = true;
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
  tap-comms doctor [options]

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

  function runAllChecks(): Check[] {
    const checks: Check[] = [];
    checks.push(...checkComms(commsDir));
    checks.push(...checkInstances(repoRoot, config.stateDir));
    checks.push(...checkMessageLifecycle(commsDir));
    checks.push(...checkMcpServer(repoRoot));
    checks.push(...checkBridgeTurnHealth(repoRoot));
    return checks;
  }

  // Initial scan
  const initialChecks = runAllChecks();
  for (const section of [
    "Comms",
    "Instances",
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
        ].includes(c.name),
      ),
      Instances: initialChecks.filter(
        (c) =>
          c.name.startsWith("bridge:") ||
          c.name.startsWith("instance:") ||
          c.name === "tap state",
      ),
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
