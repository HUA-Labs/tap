import * as fs from "node:fs";
import * as path from "node:path";
import type { InstanceId } from "../types.js";
import { validateInstanceName } from "../utils.js";
import type { AgentPermission, AgentRole } from "../permissions/types.js";
import { createPermissionFromRole } from "../permissions/presets.js";

// ─── Instance Config Schema ────────────────────────────────────
//
// M310: Instance config files (instances/*.json) are DEPRECATED.
// They duplicate data from state.json and create divergence opportunities.
// New code should read identity from state.json (defaultAgentName field)
// and session identity from heartbeats/claims.
// These files are retained for backward compatibility and will be
// removed in a future version when all consumers migrate to state.json.
//
// M350: Legacy identity duplicates removed from the in-memory shape:
//   - `agentName` (deprecated duplicate of `defaultAgentName`)
//   - `agentId` (per-record mirror of `instanceId`)
// `loadInstanceConfig` migrates pre-M350 files on read by backfilling
// `defaultAgentName` and stripping the legacy fields.
//

const INSTANCE_CONFIG_SCHEMA_VERSION = 1;

export interface InstanceConfig {
  schemaVersion: number;
  instanceId: string;
  runtime: "codex" | "claude" | "gemini";

  // identity
  /**
   * Bootstrap default name — display seed only.
   * The canonical instance identifier is `instanceId` (the object key in
   * `state.json → instances`). `defaultAgentName` is the human-readable
   * name captured at `tap add` time.
   */
  defaultAgentName: string | null;

  // network
  port: number | null;
  appServerUrl: string;
  appServerUnsandboxed?: boolean;

  // config override fields (consumed by resolveTrackedConfig)
  commsDir?: string;
  stateDir?: string;
  runtimeCommand?: string;
  bridgeMode?: string | null;
  towerName?: string;

  // permissions (Phase 3-1)
  permission: AgentPermission;

  // Codex MCP tool approval mode (M224)
  approvalMode?: "auto" | "approve";

  // MCP env (tap source-of-truth for runtime injection)
  mcpEnv: Record<string, string>;

  // meta
  configHash: string;
  lastSyncedToRuntime: string | null;
  runtimeConfigHash: string;
  createdAt: string;
  updatedAt: string;
}

// ─── Path helpers ──────────────────────────────────────────────

function instancesDir(stateDir: string): string {
  return path.join(stateDir, "instances");
}

export function getInstanceConfigPath(
  stateDir: string,
  instanceId: InstanceId,
): string {
  // Validate to prevent path traversal (M190)
  if (
    instanceId.includes("/") ||
    instanceId.includes("\\") ||
    instanceId.includes("..")
  ) {
    throw new Error(
      `Invalid instanceId "${instanceId}": must not contain path separators or ".." sequences`,
    );
  }
  return path.join(instancesDir(stateDir), `${instanceId}.json`);
}

// ─── CRUD ──────────────────────────────────────────────────────

export function loadInstanceConfig(
  stateDir: string,
  instanceId: InstanceId,
): InstanceConfig | null {
  const filePath = getInstanceConfigPath(stateDir, instanceId);
  if (!fs.existsSync(filePath)) return null;
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw) as InstanceConfig & {
      agentName?: string | null;
      agentId?: string | null;
    };
    // Backfill permission for pre-M219 instance configs
    if (!parsed.permission) {
      parsed.permission = createPermissionFromRole("custom");
    }
    // M310 → M350 migration: backfill defaultAgentName from deprecated
    // `agentName`, then drop the legacy identity duplicates so consumers
    // see only the canonical shape.
    if (
      parsed.defaultAgentName === undefined ||
      parsed.defaultAgentName === null
    ) {
      parsed.defaultAgentName = parsed.agentName ?? null;
    }
    delete parsed.agentName;
    delete parsed.agentId;
    return parsed;
  } catch {
    return null;
  }
}

export function saveInstanceConfig(
  stateDir: string,
  config: InstanceConfig,
): string {
  const dir = instancesDir(stateDir);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = getInstanceConfigPath(stateDir, config.instanceId);
  const tmp = `${filePath}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(config, null, 2) + "\n", "utf-8");
  fs.renameSync(tmp, filePath);
  return filePath;
}

export function listInstanceConfigs(stateDir: string): InstanceConfig[] {
  const dir = instancesDir(stateDir);
  if (!fs.existsSync(dir)) return [];

  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
  const configs: InstanceConfig[] = [];
  for (const file of files) {
    try {
      const raw = fs.readFileSync(path.join(dir, file), "utf-8");
      configs.push(JSON.parse(raw) as InstanceConfig);
    } catch {
      // Skip corrupted files
    }
  }
  return configs;
}

export function deleteInstanceConfig(
  stateDir: string,
  instanceId: InstanceId,
): boolean {
  const filePath = getInstanceConfigPath(stateDir, instanceId);
  if (!fs.existsSync(filePath)) return false;
  fs.unlinkSync(filePath);
  return true;
}

// ─── Factory ───────────────────────────────────────────────────

export interface CreateInstanceConfigOpts {
  instanceId: InstanceId;
  runtime: "codex" | "claude" | "gemini";
  /** Display seed captured at install time. Session names live in heartbeats/claims. */
  defaultAgentName: string | null;
  port: number | null;
  appServerUrl: string;
  appServerUnsandboxed?: boolean;
  commsDir: string;
  stateDir: string;
  repoRoot: string;
  role?: AgentRole;
}

export interface ReconcileInstanceConfigPathsOpts {
  commsDir: string;
  stateDir: string;
  repoRoot: string;
}

export function createInstanceConfig(
  opts: CreateInstanceConfigOpts,
): InstanceConfig {
  // Validate instanceId for path safety
  const parts = opts.instanceId.split("-");
  if (parts.length > 1) {
    validateInstanceName(parts.slice(1).join("-"));
  }

  const now = new Date().toISOString();
  const config: InstanceConfig = {
    schemaVersion: INSTANCE_CONFIG_SCHEMA_VERSION,
    instanceId: opts.instanceId,
    runtime: opts.runtime,
    defaultAgentName: opts.defaultAgentName,
    port: opts.port,
    appServerUrl: opts.appServerUrl,
    appServerUnsandboxed: opts.appServerUnsandboxed ?? false,
    permission: createPermissionFromRole(opts.role ?? "custom"),
    // Top-level overrides consumed by resolveTrackedConfig
    commsDir: opts.commsDir,
    stateDir: opts.stateDir,
    mcpEnv: {
      TAP_COMMS_DIR: opts.commsDir,
      TAP_STATE_DIR: opts.stateDir,
      TAP_REPO_ROOT: opts.repoRoot,
      TAP_AGENT_NAME: opts.defaultAgentName ?? "<set-per-session>",
    },
    configHash: "",
    lastSyncedToRuntime: null,
    runtimeConfigHash: "",
    createdAt: now,
    updatedAt: now,
  };

  // Compute hash after creation
  config.configHash = computeInstanceConfigHash(config);
  return config;
}

export interface UpdateInstanceConfigUpdates {
  defaultAgentName?: string | null;
  port?: number | null;
  appServerUrl?: string;
}

export function updateInstanceConfig(
  existing: InstanceConfig,
  updates: UpdateInstanceConfigUpdates,
): InstanceConfig {
  const updated: InstanceConfig = {
    ...existing,
    ...updates,
    updatedAt: new Date().toISOString(),
  };

  if (updates.defaultAgentName !== undefined) {
    updated.mcpEnv = {
      ...updated.mcpEnv,
      TAP_AGENT_NAME: updates.defaultAgentName ?? "<set-per-session>",
    };
  }

  updated.configHash = computeInstanceConfigHash(updated);
  return updated;
}

function normalizeComparablePath(filePath: string): string {
  const normalized = path.resolve(filePath);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function pathDrifted(actual: string | undefined, expected: string): boolean {
  if (!actual) return true;
  return normalizeComparablePath(actual) !== normalizeComparablePath(expected);
}

export function reconcileInstanceConfigPaths(
  existing: InstanceConfig,
  opts: ReconcileInstanceConfigPathsOpts,
): InstanceConfig {
  const nextMcpEnv = {
    ...existing.mcpEnv,
    TAP_COMMS_DIR: opts.commsDir,
    TAP_STATE_DIR: opts.stateDir,
    TAP_REPO_ROOT: opts.repoRoot,
  };

  const changed =
    pathDrifted(existing.commsDir, opts.commsDir) ||
    pathDrifted(existing.stateDir, opts.stateDir) ||
    pathDrifted(existing.mcpEnv.TAP_COMMS_DIR, opts.commsDir) ||
    pathDrifted(existing.mcpEnv.TAP_STATE_DIR, opts.stateDir) ||
    pathDrifted(existing.mcpEnv.TAP_REPO_ROOT, opts.repoRoot);

  if (!changed) {
    return existing;
  }

  const updated: InstanceConfig = {
    ...existing,
    commsDir: opts.commsDir,
    stateDir: opts.stateDir,
    mcpEnv: nextMcpEnv,
    updatedAt: new Date().toISOString(),
  };

  updated.configHash = computeInstanceConfigHash(updated);
  return updated;
}

// ─── Hash ──────────────────────────────────────────────────────

function computeInstanceConfigHash(config: InstanceConfig): string {
  // Hash the mutable fields that affect runtime behavior.
  // M350: `agentName` + `agentId` removed — canonical identity is
  // `instanceId` (record key) + `defaultAgentName` (display seed).
  const hashInput: Record<string, unknown> = {
    instanceId: config.instanceId,
    runtime: config.runtime,
    defaultAgentName: config.defaultAgentName,
    port: config.port,
    appServerUrl: config.appServerUrl,
    appServerUnsandboxed: config.appServerUnsandboxed ?? false,
    mcpEnv: config.mcpEnv,
    permission: config.permission,
  };
  const serialized = JSON.stringify(hashInput, Object.keys(hashInput).sort());

  // FNV-1a 32-bit (same algorithm as config-hash.ts)
  let hash = 0x811c9dc5;
  for (let i = 0; i < serialized.length; i++) {
    hash ^= serialized.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
