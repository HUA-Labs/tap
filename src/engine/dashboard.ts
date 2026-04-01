/**
 * Dashboard data collection engine.
 * Aggregates: agents (comms presence), bridges (state + PID), PRs (gh CLI).
 *
 * Ref: tap public repo tap-ops-dashboard.ps1 (single-agent view)
 * M74 extends to control-tower view (all agents, all bridges, all PRs).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { execSync } from "node:child_process";
import { resolveConfig } from "../config/index.js";
import {
  loadBridgeState,
  getBridgeStatus,
  getHeartbeatAge,
  isProcessAlive,
  loadRuntimeBridgeHeartbeat,
  resolveBridgeLifecycleSnapshot,
  deriveCodexSessionState,
} from "./bridge.js";
import type { InstanceId } from "../types.js";
import { loadState } from "../state.js";
import type {
  BridgeLifecycleSnapshot,
  CodexSessionSnapshot,
} from "./bridge.js";

// ─── Types ─────────────────────────────────────────────────────

export interface AgentInfo {
  name: string;
  instanceId: string | null;
  presence: "bridge-live" | "bridge-stale" | "mcp-only";
  lifecycle: BridgeLifecycleSnapshot["status"] | null;
  status: string | null;
  lastActivity: string | null;
  joinedAt: string | null;
  idleSeconds: number | null;
}

export interface BridgeInfo {
  instanceId: string;
  runtime: string;
  status: "running" | "stopped" | "stale";
  lifecycle: BridgeLifecycleSnapshot | null;
  session: CodexSessionSnapshot | null;
  pid: number | null;
  port: number | null;
  heartbeatAge: number | null;
  headless: boolean;
}

export interface PRInfo {
  number: number;
  title: string;
  author: string;
  state: string;
  url: string;
}

export interface DashboardWarning {
  level: "warn" | "error";
  message: string;
}

export interface DashboardSnapshot {
  generatedAt: string;
  repoRoot: string;
  commsDir: string;
  agents: AgentInfo[];
  bridges: BridgeInfo[];
  prs: PRInfo[];
  warnings: DashboardWarning[];
}

// ─── Agent collection ──────────────────────────────────────────

function formatAgentLabel(
  agentIdOrName: string,
  displayName?: string | null,
): string {
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

function parseIsoAgeSeconds(value: string | null | undefined): number | null {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) return null;
  return Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
}

function resolveHeartbeatInstanceId(
  heartbeatId: string,
  displayName: string | null,
  state: ReturnType<typeof loadState>,
): string | null {
  if (!state) return null;
  if (state.instances[heartbeatId]?.installed) return heartbeatId;

  const hyphenated = heartbeatId.replace(/_/g, "-");
  if (state.instances[hyphenated]?.installed) return hyphenated;

  const underscored = heartbeatId.replace(/-/g, "_");
  if (state.instances[underscored]?.installed) return underscored;

  if (!displayName) return null;
  const matches = Object.values(state.instances).filter(
    (inst) => inst?.installed && inst.agentName === displayName,
  );
  return matches.length === 1 ? matches[0].instanceId : null;
}

function collectAgents(
  commsDir: string,
  state: ReturnType<typeof loadState>,
  bridges: BridgeInfo[],
): AgentInfo[] {
  // Read heartbeats.json (written by tap-comms MCP server)
  const heartbeatsPath = path.join(commsDir, "heartbeats.json");
  if (!fs.existsSync(heartbeatsPath)) return [];

  try {
    const raw = fs.readFileSync(heartbeatsPath, "utf-8");
    const data = JSON.parse(raw) as Record<
      string,
      {
        agent?: string;
        timestamp?: string;
        lastActivity?: string;
        status?: string;
        joinedAt?: string;
      }
    >;

    return Object.entries(data).map(([agentId, info]) => {
      const instanceId = resolveHeartbeatInstanceId(
        agentId,
        info.agent ?? null,
        state,
      );
      const bridge = instanceId
        ? (bridges.find((candidate) => candidate.instanceId === instanceId) ??
          null)
        : null;
      const presence =
        bridge?.status === "stale" ||
        bridge?.lifecycle?.status === "bridge-stale"
          ? "bridge-stale"
          : bridge?.status === "running"
            ? "bridge-live"
            : "mcp-only";
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
        idleSeconds: parseIsoAgeSeconds(idleBasis),
      };
    });
  } catch {
    return [];
  }
}

// ─── Bridge collection ─────────────────────────────────────────

function collectBridges(repoRoot: string): BridgeInfo[] {
  const state = loadState(repoRoot);
  const { config } = resolveConfig({}, repoRoot);
  const stateDir = config.stateDir;
  const bridges: BridgeInfo[] = [];

  // Collect from state.json instances (if initialized)
  if (state) {
    for (const [id, inst] of Object.entries(state.instances)) {
      if (!inst?.installed) continue;
      if (inst.bridgeMode !== "app-server") continue;

      const instanceId = id as InstanceId;
      const status = getBridgeStatus(stateDir, instanceId);
      const persistedBridgeState = loadBridgeState(stateDir, instanceId);
      const bridgeState = persistedBridgeState ?? inst.bridge ?? null;
      const age = getHeartbeatAge(stateDir, instanceId);
      const runtimeHeartbeat = loadRuntimeBridgeHeartbeat(bridgeState);
      const lifecycle =
        bridgeState != null
          ? resolveBridgeLifecycleSnapshot(stateDir, instanceId, bridgeState)
          : null;
      const session =
        bridgeState != null
          ? deriveCodexSessionState({
              runtimeHeartbeat,
              runtimeStateDir: bridgeState.runtimeStateDir ?? null,
            })
          : null;

      bridges.push({
        instanceId: id,
        runtime: inst.runtime,
        status,
        lifecycle,
        session,
        pid: bridgeState?.pid ?? null,
        port: inst.port ?? null,
        heartbeatAge: age,
        headless: inst.headless?.enabled ?? false,
      });
    }
  }

  // Also scan .tmp/ for daemon state dirs (catches externally-launched bridges)
  const tmpDir = path.join(repoRoot, ".tmp");
  if (fs.existsSync(tmpDir)) {
    try {
      const dirs = fs
        .readdirSync(tmpDir)
        .filter((d) => d.startsWith("codex-app-server-bridge"));

      for (const dir of dirs) {
        const daemonPath = path.join(tmpDir, dir, "bridge-daemon.json");
        if (!fs.existsSync(daemonPath)) continue;

        try {
          const raw = fs.readFileSync(daemonPath, "utf-8");
          const daemon = JSON.parse(raw) as {
            pid?: number;
            startedAt?: string;
            appServerUrl?: string;
          };

          // Skip if already covered by state.json instances
          const alreadyCovered = bridges.some(
            (b) => b.pid === daemon.pid && b.pid !== null,
          );
          if (alreadyCovered) continue;

          const agentFile = path.join(tmpDir, dir, "agent-name.txt");
          const agentName = fs.existsSync(agentFile)
            ? fs.readFileSync(agentFile, "utf-8").trim()
            : dir;

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
            headless: false,
          });
        } catch {
          // Skip corrupted daemon files
        }
      }
    } catch {
      // .tmp/ read failed
    }
  }

  return bridges;
}

// ─── PR collection ─────────────────────────────────────────────

function collectPRs(): PRInfo[] {
  try {
    const output = execSync(
      "gh pr list --state all --limit 10 --json number,title,author,state,url",
      { encoding: "utf-8", timeout: 10000, stdio: ["pipe", "pipe", "pipe"] },
    );

    const prs = JSON.parse(output) as Array<{
      number: number;
      title: string;
      author: { login: string };
      state: string;
      url: string;
    }>;

    return prs.map((pr) => ({
      number: pr.number,
      title: pr.title,
      author: pr.author.login,
      state: pr.state,
      url: pr.url,
    }));
  } catch {
    return [];
  }
}

// ─── Warnings ──────────────────────────────────────────────────

function collectWarnings(
  bridges: BridgeInfo[],
  agents: AgentInfo[],
): DashboardWarning[] {
  const warnings: DashboardWarning[] = [];

  for (const bridge of bridges) {
    if (bridge.status === "stale") {
      warnings.push({
        level: "warn",
        message: `Bridge ${bridge.instanceId} is stale (PID ${bridge.pid} dead)`,
      });
    }
    if (
      bridge.status === "running" &&
      bridge.heartbeatAge !== null &&
      bridge.heartbeatAge > 60
    ) {
      warnings.push({
        level: "warn",
        message: `Bridge ${bridge.instanceId} heartbeat stale (${bridge.heartbeatAge}s ago)`,
      });
    }
    if (bridge.lifecycle?.status === "degraded-no-thread") {
      warnings.push({
        level: "warn",
        message: `Bridge ${bridge.instanceId} is degraded (no active thread)`,
      });
    }
  }

  if (bridges.length === 0) {
    warnings.push({
      level: "warn",
      message: "No bridges configured",
    });
  }

  if (agents.length === 0) {
    warnings.push({
      level: "warn",
      message: "No agent heartbeats found",
    });
  }

  return warnings;
}

// ─── Snapshot ──────────────────────────────────────────────────

export function collectDashboardSnapshot(
  repoRoot?: string,
  commsDirOverride?: string,
): DashboardSnapshot {
  const { config } = resolveConfig(
    commsDirOverride ? { commsDir: commsDirOverride } : {},
    repoRoot,
  );
  const resolved = config;

  const state = loadState(resolved.repoRoot);
  const bridges = collectBridges(resolved.repoRoot);
  const agents = collectAgents(resolved.commsDir, state, bridges);
  const prs = collectPRs();
  const warnings = collectWarnings(bridges, agents);

  return {
    generatedAt: new Date().toISOString(),
    repoRoot: resolved.repoRoot,
    commsDir: resolved.commsDir,
    agents,
    bridges,
    prs,
    warnings,
  };
}
