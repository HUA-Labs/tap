import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import type {
  TapState,
  TapStateV1,
  InstanceState,
  InstanceId,
  RuntimeName,
  OwnedArtifact,
} from "./types.js";
import { resolveConfig } from "./config/index.js";
import {
  getInstanceConfigPath,
  loadInstanceConfig,
  reconcileInstanceConfigPaths,
  saveInstanceConfig,
} from "./config/instance-config.js";

const STATE_FILE = "state.json";
const SCHEMA_VERSION = 3;

export function getStateDir(repoRoot: string): string {
  const { config } = resolveConfig({}, repoRoot);
  return config.stateDir;
}

export function getStatePath(repoRoot: string): string {
  return path.join(getStateDir(repoRoot), STATE_FILE);
}

export function stateExists(repoRoot: string): boolean {
  return fs.existsSync(getStatePath(repoRoot));
}

function normalizeComparablePath(filePath: string): string {
  const normalized = path.resolve(filePath);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function pathDrifted(actual: string | undefined, expected: string): boolean {
  if (!actual) return true;
  return normalizeComparablePath(actual) !== normalizeComparablePath(expected);
}

function reconcileStateConfig(repoRoot: string, state: TapState): TapState {
  const { config } = resolveConfig({}, repoRoot);
  const resolvedRepoRoot = path.resolve(repoRoot);
  const resolvedCommsDir = path.resolve(config.commsDir);
  const resolvedStateDir = path.resolve(config.stateDir);
  const instanceIds = Object.keys(state.instances) as InstanceId[];

  let nextState = state;
  let changed = false;

  if (
    pathDrifted(state.commsDir, resolvedCommsDir) ||
    pathDrifted(state.repoRoot, resolvedRepoRoot)
  ) {
    nextState = {
      ...nextState,
      commsDir: resolvedCommsDir,
      repoRoot: resolvedRepoRoot,
      updatedAt: new Date().toISOString(),
    };
    changed = true;
  }

  for (const instanceId of instanceIds) {
    const instConfig = loadInstanceConfig(resolvedStateDir, instanceId);
    if (!instConfig) continue;

    const synced = reconcileInstanceConfigPaths(instConfig, {
      commsDir: resolvedCommsDir,
      stateDir: resolvedStateDir,
      repoRoot: resolvedRepoRoot,
    });
    const currentInstance = nextState.instances[instanceId];
    if (!currentInstance) continue;

    const expectedConfigSourceFile = getInstanceConfigPath(
      resolvedStateDir,
      instanceId,
    );
    const stateNeedsSync =
      currentInstance.configHash !== synced.configHash ||
      pathDrifted(currentInstance.configSourceFile, expectedConfigSourceFile);

    if (synced === instConfig && !stateNeedsSync) continue;

    if (synced !== instConfig) {
      saveInstanceConfig(resolvedStateDir, synced);
    }

    nextState = {
      ...nextState,
      updatedAt: synced.updatedAt,
      instances: {
        ...nextState.instances,
        [instanceId]: {
          ...currentInstance,
          configHash: synced.configHash,
          configSourceFile: expectedConfigSourceFile,
        },
      },
    };
    changed = true;
  }

  if (changed) {
    saveState(repoRoot, nextState);
  }

  return nextState;
}

// ─── v1 → v2 Migration ────────────────────────────────────────

export function migrateStateV1toV2(v1: TapStateV1): TapState {
  const instances: Record<InstanceId, InstanceState> = {};

  for (const [runtime, rs] of Object.entries(v1.runtimes)) {
    if (!rs) continue;
    const instanceId = runtime as InstanceId; // default instance = runtime name
    instances[instanceId] = {
      instanceId,
      runtime: runtime as RuntimeName,
      defaultAgentName: null,
      port: null,
      headless: null,
      ...rs,
    };
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    createdAt: v1.createdAt,
    updatedAt: v1.updatedAt,
    commsDir: v1.commsDir,
    repoRoot: v1.repoRoot,
    packageVersion: v1.packageVersion,
    instances,
  };
}

// ─── v2 → v3 Migration ────────────────────────────────────────

export function migrateStateV2toV3(v2: TapState): TapState {
  const instances: Record<InstanceId, InstanceState> = {};

  for (const [id, inst] of Object.entries(v2.instances)) {
    // M310: Backfill defaultAgentName from deprecated agentName.
    // M350: drop the legacy `agentName` field from the in-memory shape.
    const legacy = inst as InstanceState & { agentName?: string | null };
    const { agentName: legacyAgentName, ...rest } = legacy;
    instances[id] = {
      ...rest,
      defaultAgentName: rest.defaultAgentName ?? legacyAgentName ?? null,
      configHash: rest.configHash ?? "",
      configSourceFile: rest.configSourceFile ?? "",
    };
  }

  return {
    ...v2,
    schemaVersion: SCHEMA_VERSION,
    instances,
  };
}

// ─── Load / Save ───────────────────────────────────────────────

export function loadState(repoRoot: string): TapState | null {
  const statePath = getStatePath(repoRoot);
  if (!fs.existsSync(statePath)) return null;

  const raw = fs.readFileSync(statePath, "utf-8");
  const parsed = JSON.parse(raw);

  // Auto-migrate v1 → v2
  if (parsed.schemaVersion === 1 || parsed.runtimes) {
    const v2 = migrateStateV1toV2(parsed as TapStateV1);
    const v3 = migrateStateV2toV3(v2);
    saveState(repoRoot, v3);
    return reconcileStateConfig(repoRoot, v3);
  }

  // Auto-migrate v2 → v3
  if (parsed.schemaVersion === 2) {
    const v3 = migrateStateV2toV3(parsed as TapState);
    saveState(repoRoot, v3);
    return reconcileStateConfig(repoRoot, v3);
  }

  // M310 → M350: Backfill defaultAgentName from deprecated agentName and
  // drop the legacy field from the in-memory shape. Legacy v3 state files
  // written before the M350 cleanup still carry `agentName`; read-time
  // migration keeps the on-disk copy readable while normalising consumers.
  const state = parsed as TapState;
  for (const [id, inst] of Object.entries(state.instances)) {
    const legacy = inst as InstanceState & { agentName?: string | null };
    if (
      legacy.defaultAgentName === undefined ||
      legacy.defaultAgentName === null
    ) {
      legacy.defaultAgentName = legacy.agentName ?? null;
    }
    if ("agentName" in legacy) {
      delete legacy.agentName;
    }
    state.instances[id] = legacy;
  }
  return reconcileStateConfig(repoRoot, state);
}

export function saveState(repoRoot: string, state: TapState): void {
  const stateDir = getStateDir(repoRoot);
  fs.mkdirSync(stateDir, { recursive: true });
  const statePath = getStatePath(repoRoot);
  const tmp = `${statePath}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), "utf-8");
  fs.renameSync(tmp, statePath);
}

export function createInitialState(
  commsDir: string,
  repoRoot: string,
  packageVersion: string,
): TapState {
  const now = new Date().toISOString();
  return {
    schemaVersion: SCHEMA_VERSION,
    createdAt: now,
    updatedAt: now,
    commsDir: path.resolve(commsDir),
    repoRoot: path.resolve(repoRoot),
    packageVersion,
    instances: {},
  };
}

// ─── Instance CRUD ─────────────────────────────────────────────

export function updateInstanceState(
  state: TapState,
  instanceId: InstanceId,
  instanceState: InstanceState,
): TapState {
  return {
    ...state,
    updatedAt: new Date().toISOString(),
    instances: {
      ...state.instances,
      [instanceId]: instanceState,
    },
  };
}

export function removeInstanceState(
  state: TapState,
  instanceId: InstanceId,
): TapState {
  const { [instanceId]: _removed, ...remaining } = state.instances;
  return {
    ...state,
    updatedAt: new Date().toISOString(),
    instances: remaining,
  };
}

export function getInstalledInstances(state: TapState): InstanceId[] {
  return (Object.keys(state.instances) as InstanceId[]).filter(
    (id) => state.instances[id]?.installed,
  );
}

export function getInstanceArtifacts(
  state: TapState,
  instanceId: InstanceId,
): OwnedArtifact[] {
  return state.instances[instanceId]?.ownedArtifacts ?? [];
}

// ─── Backup ────────────────────────────────────────────────────

export function ensureBackupDir(
  stateDir: string,
  instanceId: InstanceId,
): string {
  const backupDir = path.join(stateDir, "backups", instanceId);
  fs.mkdirSync(backupDir, { recursive: true });
  return backupDir;
}

export function backupFile(filePath: string, backupDir: string): string {
  const basename = path.basename(filePath);
  const hash = fileHash(filePath);
  const backupPath = path.join(backupDir, `${basename}.${hash}.bak`);
  fs.copyFileSync(filePath, backupPath);
  return backupPath;
}

export function fileHash(filePath: string): string {
  if (!fs.existsSync(filePath)) return "";
  const content = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(content).digest("hex").slice(0, 16);
}
