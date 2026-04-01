import * as fs from "node:fs";
import * as path from "node:path";
import type { InstanceId } from "../types.js";
import { validateInstanceName } from "../utils.js";
import type { AgentPermission, AgentRole } from "../permissions/types.js";
import { createPermissionFromRole } from "../permissions/presets.js";

// ─── Instance Config Schema ────────────────────────────────────

const INSTANCE_CONFIG_SCHEMA_VERSION = 1;

export interface InstanceConfig {
  schemaVersion: number;
  instanceId: string;
  runtime: "codex" | "claude" | "gemini";

  // identity
  agentName: string | null;
  agentId: string | null;

  // network
  port: number | null;
  appServerUrl: string;

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

function instanceConfigPath(stateDir: string, instanceId: InstanceId): string {
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
  const filePath = instanceConfigPath(stateDir, instanceId);
  if (!fs.existsSync(filePath)) return null;
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw) as InstanceConfig;
    // Backfill permission for pre-M219 instance configs
    if (!parsed.permission) {
      parsed.permission = createPermissionFromRole("custom");
    }
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
  const filePath = instanceConfigPath(stateDir, config.instanceId);
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
  const filePath = instanceConfigPath(stateDir, instanceId);
  if (!fs.existsSync(filePath)) return false;
  fs.unlinkSync(filePath);
  return true;
}

// ─── Factory ───────────────────────────────────────────────────

export interface CreateInstanceConfigOpts {
  instanceId: InstanceId;
  runtime: "codex" | "claude" | "gemini";
  agentName: string | null;
  agentId: string | null;
  port: number | null;
  appServerUrl: string;
  commsDir: string;
  stateDir: string;
  repoRoot: string;
  role?: AgentRole;
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
    agentName: opts.agentName,
    agentId: opts.agentId,
    port: opts.port,
    appServerUrl: opts.appServerUrl,
    permission: createPermissionFromRole(opts.role ?? "custom"),
    // Top-level overrides consumed by resolveTrackedConfig
    commsDir: opts.commsDir,
    stateDir: opts.stateDir,
    mcpEnv: {
      TAP_COMMS_DIR: opts.commsDir,
      TAP_STATE_DIR: opts.stateDir,
      TAP_REPO_ROOT: opts.repoRoot,
      TAP_AGENT_NAME: opts.agentName ?? "<set-per-session>",
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

export function updateInstanceConfig(
  existing: InstanceConfig,
  updates: Partial<
    Pick<InstanceConfig, "agentName" | "agentId" | "port" | "appServerUrl">
  >,
): InstanceConfig {
  const updated: InstanceConfig = {
    ...existing,
    ...updates,
    updatedAt: new Date().toISOString(),
  };

  // Sync mcpEnv if agentName changed
  if (updates.agentName !== undefined) {
    updated.mcpEnv = {
      ...updated.mcpEnv,
      TAP_AGENT_NAME: updates.agentName ?? "<set-per-session>",
    };
  }

  updated.configHash = computeInstanceConfigHash(updated);
  return updated;
}

// ─── Hash ──────────────────────────────────────────────────────

function computeInstanceConfigHash(config: InstanceConfig): string {
  // Hash the mutable fields that affect runtime behavior
  const hashInput: Record<string, unknown> = {
    instanceId: config.instanceId,
    runtime: config.runtime,
    agentName: config.agentName,
    agentId: config.agentId,
    port: config.port,
    appServerUrl: config.appServerUrl,
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
