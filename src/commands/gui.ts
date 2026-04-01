import * as http from "node:http";
import { collectDashboardSnapshot } from "../engine/dashboard.js";
import { getTurnInfo } from "../engine/bridge.js";
import { parseMissionsFile } from "../engine/missions.js";
import { fetchPrs } from "../engine/pull-requests.js";
import { resolveConfig } from "../config/index.js";
import { loadState } from "../state.js";
import {
  findRepoRoot,
  log,
  logHeader,
  logSuccess,
  parseArgs,
  parseIntFlag,
} from "../utils.js";
import type { CommandResult, InstanceId } from "../types.js";

const GUI_HELP = `
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

/** Escape HTML special characters to prevent XSS */
function esc(str: string | null | undefined): string {
  if (!str) return "-";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildHtml(
  snapshot: ReturnType<typeof collectDashboardSnapshot>,
  turnData: Record<string, unknown>,
): string {
  const agentRows = snapshot.agents
    .map(
      (a) =>
        `<tr><td>${esc(a.name)}</td><td class="${a.presence === "bridge-live" ? "ok" : a.presence === "bridge-stale" ? "warn" : "off"}">${esc(a.presence)}</td><td>${esc(a.lifecycle ?? "-")}</td><td>${a.lastActivity ? esc(new Date(a.lastActivity).toLocaleTimeString()) : "-"}</td></tr>`,
    )
    .join("\n");

  const bridgeRows = snapshot.bridges
    .map((b) => {
      const turn = turnData[b.instanceId] as {
        activeTurnId?: string;
        stuck?: boolean;
        ageSeconds?: number;
      } | null;
      const turnCell = turn?.activeTurnId
        ? `<span class="${turn.stuck ? "stuck" : "ok"}">${esc(turn.activeTurnId.slice(0, 8))}... ${turn.stuck ? "⚠ STUCK" : ""} ${turn.ageSeconds != null ? `(${turn.ageSeconds}s)` : ""}</span>`
        : "-";
      const statusClass =
        b.status === "running" ? "ok" : b.status === "stale" ? "stuck" : "off";
      return `<tr><td>${esc(b.instanceId)}</td><td>${esc(b.runtime)}</td><td class="${statusClass}">${esc(b.status)}</td><td>${b.pid ?? "-"}</td><td>${b.port ?? "-"}</td><td>${b.heartbeatAge != null ? `${b.heartbeatAge}s ago` : "-"}</td><td>${turnCell}</td></tr>`;
    })
    .join("\n");

  const warningRows = snapshot.warnings
    .map(
      (w) =>
        `<tr><td class="warn">${esc(w.level)}</td><td>${esc(w.message)}</td></tr>`,
    )
    .join("\n");

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
  statusEl.textContent = 'Live — updated ' + new Date().toLocaleTimeString();
  statusEl.style.color = '#3fb950';
  const elapsed = Date.now() - lastReloadAt;
  if (elapsed >= 9000) { lastReloadAt = Date.now(); location.reload(); }
};
es.onerror = () => {
  statusEl.textContent = 'Disconnected — will retry...';
  statusEl.style.color = '#f85149';
};
</script>
<p class="refresh"><a href="/missions" style="color:#58a6ff;">Mission Kanban</a> &middot; <a href="/prs" style="color:#58a6ff;">PR Board</a></p>
</body>
</html>`;
}

function buildMissionsHtml(repoRoot: string): string {
  const missions = parseMissionsFile(repoRoot);

  const byStatus = {
    active: missions.filter((m) => m.status === "active"),
    planned: missions.filter((m) => m.status === "planned"),
    completed: missions.filter((m) => m.status === "completed"),
  };

  function card(m: ReturnType<typeof parseMissionsFile>[number]): string {
    return `<div class="card">
  <div class="card-id">${esc(m.id)}</div>
  <div class="card-title">${esc(m.title)}</div>
  ${m.owner ? `<div class="card-meta">Owner: ${esc(m.owner)}</div>` : ""}
  ${m.branch ? `<div class="card-meta card-branch">${esc(m.branch)}</div>` : ""}
</div>`;
  }

  function column(
    label: string,
    headerClass: string,
    items: ReturnType<typeof parseMissionsFile>,
  ): string {
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
<title>tap — mission kanban</title>
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

function buildPrsHtml(repoRoot: string): string {
  const { open, merged } = fetchPrs(repoRoot);

  function prRow(pr: ReturnType<typeof fetchPrs>["open"][number]): string {
    return `<tr>
  <td><a href="${esc(pr.url)}" target="_blank" rel="noopener" style="color:#58a6ff;">#${pr.number}</a></td>
  <td>${esc(pr.title)}</td>
  <td>${esc(pr.author)}</td>
  <td class="branch">${esc(pr.branch)}</td>
</tr>`;
  }

  const openRows = open.map(prRow).join("\n");
  const mergedRows = merged
    .map(
      (pr) =>
        `<tr>
  <td><a href="${esc(pr.url)}" target="_blank" rel="noopener" style="color:#58a6ff;">#${pr.number}</a></td>
  <td>${esc(pr.title)}</td>
  <td>${esc(pr.author)}</td>
</tr>`,
    )
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>tap — pr board</title>
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

export async function guiCommand(args: string[]): Promise<CommandResult> {
  const { flags } = parseArgs(args);

  if (flags["help"] === true || flags["h"] === true) {
    log(GUI_HELP);
    return {
      ok: true,
      command: "gui",
      code: "TAP_NO_OP",
      message: GUI_HELP,
      warnings: [],
      data: {},
    };
  }

  const portStr = typeof flags["port"] === "string" ? flags["port"] : undefined;
  let port: number;
  try {
    port = parseIntFlag(portStr, "--port", 1024, 65535) ?? 3847;
  } catch (err) {
    return {
      ok: false,
      command: "gui",
      code: "TAP_INVALID_ARGUMENT",
      message: err instanceof Error ? err.message : String(err),
      warnings: [],
      data: {},
    };
  }

  const repoRoot = findRepoRoot();

  const server = http.createServer((req, res) => {
    const snapshot = collectDashboardSnapshot(repoRoot);

    // Collect turn info for each bridge
    const state = loadState(repoRoot);
    const { config } = resolveConfig({}, repoRoot);
    const turnData: Record<string, unknown> = {};
    if (state) {
      for (const [id, inst] of Object.entries(state.instances)) {
        if (!inst?.installed || inst.bridgeMode !== "app-server") continue;
        turnData[id] = getTurnInfo(config.stateDir, id as InstanceId);
      }
    }

    const jsonHeaders = {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    };

    if (req.url === "/api/snapshot") {
      res.writeHead(200, jsonHeaders);
      res.end(JSON.stringify({ ...snapshot, turns: turnData }, null, 2));
      return;
    }

    // SSE endpoint — push updates every 5 seconds
    if (req.url === "/api/events") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "Access-Control-Allow-Origin": "*",
      });

      const sendEvent = () => {
        const s = collectDashboardSnapshot(repoRoot);
        const st = loadState(repoRoot);
        const cfg = resolveConfig({}, repoRoot).config;
        const td: Record<string, unknown> = {};
        if (st) {
          for (const [id, inst] of Object.entries(st.instances)) {
            if (!inst?.installed || inst.bridgeMode !== "app-server") continue;
            td[id] = getTurnInfo(cfg.stateDir, id as InstanceId);
          }
        }
        res.write(`data: ${JSON.stringify({ ...s, turns: td })}\n\n`);
      };

      sendEvent();
      const interval = setInterval(sendEvent, 5000);
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

  return new Promise<CommandResult>((resolve) => {
    server.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        resolve({
          ok: false,
          command: "gui",
          code: "TAP_PORT_IN_USE",
          message: `Port ${port} is already in use. Try: tap gui --port <other>`,
          warnings: [],
          data: {},
        });
      } else {
        resolve({
          ok: false,
          command: "gui",
          code: "TAP_GUI_ERROR",
          message: err.message,
          warnings: [],
          data: {},
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
