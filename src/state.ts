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

const STATE_FILE = "state.json";
const SCHEMA_VERSION = 2;

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

// ─── v1 → v2 Migration ────────────────────────────────────────

export function migrateStateV1toV2(v1: TapStateV1): TapState {
  const instances: Record<InstanceId, InstanceState> = {};

  for (const [runtime, rs] of Object.entries(v1.runtimes)) {
    if (!rs) continue;
    const instanceId = runtime as InstanceId; // default instance = runtime name
    instances[instanceId] = {
      instanceId,
      runtime: runtime as RuntimeName,
      agentName: null,
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

// ─── Load / Save ───────────────────────────────────────────────

export function loadState(repoRoot: string): TapState | null {
  const statePath = getStatePath(repoRoot);
  if (!fs.existsSync(statePath)) return null;

  const raw = fs.readFileSync(statePath, "utf-8");
  const parsed = JSON.parse(raw);

  // Auto-migrate v1 → v2
  if (parsed.schemaVersion === 1 || parsed.runtimes) {
    const migrated = migrateStateV1toV2(parsed as TapStateV1);
    saveState(repoRoot, migrated);
    return migrated;
  }

  return parsed as TapState;
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

// ─── Deprecated (v1 compat wrappers) ───────────────────────────

/** @deprecated Use updateInstanceState */
export function updateRuntimeState(
  state: TapState,
  runtime: RuntimeName,
  runtimeState: InstanceState,
): TapState {
  return updateInstanceState(state, runtime, runtimeState);
}

/** @deprecated Use removeInstanceState */
export function removeRuntimeState(
  state: TapState,
  runtime: RuntimeName,
): TapState {
  return removeInstanceState(state, runtime);
}

/** @deprecated Use getInstalledInstances */
export function getInstalledRuntimes(state: TapState): InstanceId[] {
  return getInstalledInstances(state);
}

/** @deprecated Use getInstanceArtifacts */
export function getRuntimeArtifacts(
  state: TapState,
  instanceId: InstanceId,
): OwnedArtifact[] {
  return getInstanceArtifacts(state, instanceId);
}
