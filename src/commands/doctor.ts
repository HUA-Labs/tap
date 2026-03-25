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
  if (existsSync(mcpJson)) {
    try {
      const config = JSON.parse(readFileSync(mcpJson, "utf-8"));
      const hasTapComms = config?.mcpServers?.["tap-comms"];
      checks.push({
        name: "MCP config (.mcp.json)",
        status: hasTapComms ? PASS : WARN,
        message: hasTapComms
          ? `command: ${hasTapComms.command}`
          : "tap-comms not configured",
      });

      // Check if MCP command path exists
      if (hasTapComms?.args?.[0]) {
        const mcpScript = hasTapComms.args[0];
        checks.push({
          name: "MCP server script",
          status: existsSync(mcpScript) ? PASS : FAIL,
          message: existsSync(mcpScript)
            ? mcpScript
            : `Not found: ${mcpScript}`,
        });
      }
    } catch {
      checks.push({
        name: "MCP config (.mcp.json)",
        status: WARN,
        message: "File exists but invalid JSON",
      });
    }
  } else {
    checks.push({
      name: "MCP config (.mcp.json)",
      status: WARN,
      message: "Not found — MCP channel notifications won't work",
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

// ── Command ─────────────────────────────────────────────────────────────

export async function doctorCommand(args: string[]): Promise<CommandResult> {
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
    return checks;
  }

  // Initial scan
  const initialChecks = runAllChecks();
  for (const section of ["Comms", "Instances", "Messages", "MCP"] as const) {
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
