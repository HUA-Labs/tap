import { collectDashboardSnapshot } from "../engine/dashboard.js";
import type { DashboardSnapshot } from "../engine/dashboard.js";
import { findRepoRoot, parseArgs, log, logHeader } from "../utils.js";
import type { CommandResult } from "../types.js";

// ─── Formatting helpers ────────────────────────────────────────

function formatAge(seconds: number | null): string {
  if (seconds === null) return "-";
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m ago`;
}

function formatStatus(status: string): string {
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

function truncate(str: string, len: number): string {
  return str.length > len ? str.slice(0, len - 1) + "…" : str;
}

// ─── Render ────────────────────────────────────────────────────

function renderSnapshot(snapshot: DashboardSnapshot): void {
  logHeader("tap dashboard");
  log(`Time:  ${snapshot.generatedAt}`);
  log(`Repo:  ${snapshot.repoRoot}`);
  log(`Comms: ${snapshot.commsDir}`);

  // ── Agents ──
  log("");
  log("── Agents ──────────────────────────");
  if (snapshot.agents.length === 0) {
    log("  (no heartbeats)");
  } else {
    for (const agent of snapshot.agents) {
      const activity = agent.lastActivity
        ? formatAge(
            Math.floor(
              (Date.now() - new Date(agent.lastActivity).getTime()) / 1000,
            ),
          )
        : "unknown";
      const status = agent.status ?? "unknown";
      log(`  ${agent.name.padEnd(12)} ${status.padEnd(10)} active ${activity}`);
    }
  }

  // ── Bridges ──
  log("");
  log("── Bridges ─────────────────────────");
  if (snapshot.bridges.length === 0) {
    log("  (none)");
  } else {
    log(
      `  ${"Instance".padEnd(20)} ${"Status".padEnd(10)} ${"PID".padEnd(8)} ${"Port".padEnd(6)} ${"Heartbeat"}`,
    );
    log(
      `  ${"─".repeat(20)} ${"─".repeat(10)} ${"─".repeat(8)} ${"─".repeat(6)} ${"─".repeat(12)}`,
    );
    for (const b of snapshot.bridges) {
      const headlessTag = b.headless ? " [H]" : "";
      log(
        `  ${truncate(b.instanceId + headlessTag, 20).padEnd(20)} ${formatStatus(b.status).padEnd(10)} ${(b.pid ? String(b.pid) : "-").padEnd(8)} ${(b.port ? String(b.port) : "-").padEnd(6)} ${formatAge(b.heartbeatAge)}`,
      );
    }
  }

  // ── PRs ──
  log("");
  log("── PRs ─────────────────────────────");
  if (snapshot.prs.length === 0) {
    log("  (gh CLI unavailable or no PRs)");
  } else {
    for (const pr of snapshot.prs) {
      const icon =
        pr.state === "MERGED" ? "+" : pr.state === "OPEN" ? "~" : "x";
      log(
        `  ${icon} #${String(pr.number).padEnd(5)} ${formatStatus(pr.state).padEnd(8)} ${truncate(pr.title, 50)}`,
      );
    }
  }

  // ── Warnings ──
  log("");
  log("── Warnings ────────────────────────");
  if (snapshot.warnings.length === 0) {
    log("  [OK] no warnings");
  } else {
    for (const w of snapshot.warnings) {
      const prefix = w.level === "error" ? "[ERR]" : "[WARN]";
      log(`  ${prefix} ${w.message}`);
    }
  }
}

const DASHBOARD_HELP = `
Usage:
  tap-comms dashboard [options]

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

// ─── Command ───────────────────────────────────────────────────

export async function dashboardCommand(args: string[]): Promise<CommandResult> {
  const { flags } = parseArgs(args);

  if (flags["help"] === true || flags["h"] === true) {
    log(DASHBOARD_HELP);
    return {
      ok: true,
      command: "dashboard",
      code: "TAP_NO_OP",
      message: DASHBOARD_HELP,
      warnings: [],
      data: {},
    };
  }

  const jsonMode = flags["json"] === true;
  const watchMode = flags["watch"] === true;
  const intervalStr =
    typeof flags["interval"] === "string" ? flags["interval"] : "5";
  const intervalSeconds = Math.max(2, parseInt(intervalStr, 10) || 5);
  const commsDirOverride =
    typeof flags["comms-dir"] === "string" ? flags["comms-dir"] : undefined;

  const repoRoot = findRepoRoot();

  if (watchMode) {
    // Watch loop — runs until Ctrl+C
    const run = (): void => {
      const snapshot = collectDashboardSnapshot(repoRoot, commsDirOverride);
      if (jsonMode) {
        console.log(JSON.stringify(snapshot, null, 2));
      } else {
        // Clear screen
        process.stdout.write("\x1B[2J\x1B[H");
        renderSnapshot(snapshot);
        log("");
        log(`  Refreshing every ${intervalSeconds}s — Ctrl+C to exit`);
      }
    };

    run();
    const timer = setInterval(run, intervalSeconds * 1000);

    // Handle graceful shutdown
    const cleanup = (): void => {
      clearInterval(timer);
      process.exit(0);
    };
    process.on("SIGINT", cleanup);
    process.on("SIGTERM", cleanup);

    // Keep alive
    await new Promise(() => {});

    return {
      ok: true,
      command: "unknown",
      code: "TAP_NO_OP",
      message: "Watch mode ended",
      warnings: [],
      data: {},
    };
  }

  // Single run
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
    data: snapshot as unknown as Record<string, unknown>,
  };
}
