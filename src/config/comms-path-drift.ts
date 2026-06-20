import * as fs from "node:fs";
import * as path from "node:path";
import { getCodexConfigPath } from "../adapters/common.js";
import { extractTomlTable, parseTomlAssignments } from "../toml.js";

/**
 * Comms path drift detection — M361.
 *
 * Checks four SSOT slots that should agree on a single resolved commsDir.
 * When they diverge, the MCP server, Codex bridge, and CLI end up looking at
 * different inboxes. Pure read-only; no auto-fix.
 */

export type CommsPathSourceName =
  | "mcp.json"
  | "codex-config.toml"
  | "tap-config.json"
  | "state.json";

export interface CommsPathSource {
  name: CommsPathSourceName;
  filePath: string;
  key: string;
  present: boolean;
  raw: string | null;
  resolved: string | null;
}

export interface CommsPathDriftResult {
  status: "ok" | "drifted" | "empty";
  sources: CommsPathSource[];
  effective: string | null;
  mismatches: string[];
  hint: string | null;
}

function normalize(p: string): string {
  return path.resolve(p).replace(/\\/g, "/");
}

function tryJsonRead<T = unknown>(filePath: string): T | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
  } catch {
    return null;
  }
}

function tryTomlMcpTapEnvValue(
  filePath: string,
  envKey: string,
): string | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const table = extractTomlTable(raw, "mcp_servers.tap.env");
    if (!table) return null;
    const assigns = parseTomlAssignments(table);
    const value = assigns[envKey];
    // TAP_COMMS_DIR is a scalar; array-valued env entries aren't meaningful here.
    return typeof value === "string" ? value : null;
  } catch {
    return null;
  }
}

function readMcpJson(repoRoot: string): CommsPathSource {
  const filePath = path.join(repoRoot, ".mcp.json");
  const json = tryJsonRead<{
    mcpServers?: {
      tap?: { env?: { TAP_COMMS_DIR?: string } };
    };
  }>(filePath);
  const raw = json?.mcpServers?.tap?.env?.TAP_COMMS_DIR ?? null;
  return {
    name: "mcp.json",
    filePath,
    key: "mcpServers.tap.env.TAP_COMMS_DIR",
    present: fs.existsSync(filePath),
    raw,
    resolved: raw ? normalize(path.resolve(repoRoot, raw)) : null,
  };
}

function readCodexConfigToml(repoRoot: string): CommsPathSource {
  // getCodexConfigPath() respects CODEX_HOME, falling back to
  // os.homedir()/.codex when unset. Hardcoding os.homedir() here missed
  // isolated Codex installs and caused false drift warnings (윤 PR #1161 P2).
  const filePath = getCodexConfigPath();
  const raw = tryTomlMcpTapEnvValue(filePath, "TAP_COMMS_DIR");
  return {
    name: "codex-config.toml",
    filePath,
    key: "[mcp_servers.tap.env] TAP_COMMS_DIR",
    present: fs.existsSync(filePath),
    raw,
    resolved: raw ? normalize(path.resolve(repoRoot, raw)) : null,
  };
}

function readTapConfigJson(repoRoot: string): CommsPathSource {
  const filePath = path.join(repoRoot, "tap-config.json");
  const json = tryJsonRead<{ commsDir?: string }>(filePath);
  const raw = json?.commsDir ?? null;
  return {
    name: "tap-config.json",
    filePath,
    key: "commsDir",
    present: fs.existsSync(filePath),
    raw,
    resolved: raw ? normalize(path.resolve(repoRoot, raw)) : null,
  };
}

function readStateJson(repoRoot: string, stateDir: string): CommsPathSource {
  const filePath = path.join(stateDir, "state.json");
  const json = tryJsonRead<{ commsDir?: string }>(filePath);
  const raw = json?.commsDir ?? null;
  return {
    name: "state.json",
    filePath,
    key: "commsDir",
    present: fs.existsSync(filePath),
    raw,
    resolved: raw ? normalize(path.resolve(repoRoot, raw)) : null,
  };
}

/**
 * Collect and compare commsDir from the four canonical slots.
 *
 * stateDir defaults to `<repoRoot>/.tap-comms` (matching resolveConfig default).
 */
export function detectCommsPathDrift(
  repoRoot: string,
  stateDir: string = path.join(repoRoot, ".tap-comms"),
): CommsPathDriftResult {
  const sources: CommsPathSource[] = [
    readMcpJson(repoRoot),
    readCodexConfigToml(repoRoot),
    readTapConfigJson(repoRoot),
    readStateJson(repoRoot, stateDir),
  ];

  const resolvedValues = sources
    .map((s) => s.resolved)
    .filter((v): v is string => v !== null);

  if (resolvedValues.length === 0) {
    return {
      status: "empty",
      sources,
      effective: null,
      mismatches: [],
      hint: "No commsDir found in any source. Set TAP_COMMS_DIR in .mcp.json or commsDir in tap-config.json.",
    };
  }

  const unique = Array.from(new Set(resolvedValues));
  if (unique.length === 1) {
    return {
      status: "ok",
      sources,
      effective: unique[0],
      mismatches: [],
      hint: null,
    };
  }

  // Drifted. Effective path = what runtime resolveConfig() actually picks.
  // resolveConfig priority: env > local-config > tap-config.json > default.
  // Here we approximate "effective" as the most-voted value; ties break
  // by source priority order (.mcp.json env > codex env > tap-config > state).
  const votes = new Map<string, number>();
  for (const v of resolvedValues) {
    votes.set(v, (votes.get(v) ?? 0) + 1);
  }
  let effective = resolvedValues[0];
  let bestVotes = 0;
  for (const [value, count] of votes) {
    if (count > bestVotes) {
      bestVotes = count;
      effective = value;
    }
  }

  const mismatches: string[] = [];
  for (const source of sources) {
    if (source.resolved && source.resolved !== effective) {
      mismatches.push(
        `${source.name} (${source.key}) = ${source.resolved} (raw: ${source.raw})`,
      );
    } else if (!source.resolved && source.present) {
      mismatches.push(`${source.name} exists but has no ${source.key}`);
    } else if (!source.present) {
      mismatches.push(`${source.name} missing at ${source.filePath}`);
    }
  }

  return {
    status: "drifted",
    sources,
    effective,
    mismatches,
    hint:
      "Pick the intended canonical path, then align all four slots. " +
      "See docs/areas/tap/comms-path-drift-runbook.md for migration steps.",
  };
}

/**
 * Format drift result as a one-line human summary for log output.
 */
export function formatCommsPathDriftSummary(
  result: CommsPathDriftResult,
): string {
  if (result.status === "ok") {
    return `commsDir OK (all 4 slots agree on ${result.effective})`;
  }
  if (result.status === "empty") {
    return "commsDir not set in any slot — runtime falls back to <repoRoot>/tap-comms (deprecated default)";
  }
  const n = result.mismatches.length;
  return `commsDir drifted (${n} slot${n === 1 ? "" : "s"} disagree, effective=${result.effective})`;
}
