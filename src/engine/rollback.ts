import * as fs from "node:fs";
import { readArtifactBackup } from "../artifact-backups.js";
import {
  extractTomlTable,
  removeTomlTable,
  replaceTomlTable,
} from "../toml.js";
import type { InstanceId, InstanceState, OwnedArtifact } from "../types.js";

export interface RollbackResult {
  success: boolean;
  restoredCount: number;
  restoredFiles: string[];
  errors: string[];
}

/**
 * Roll back only the artifacts the runtime owns, restoring prior table/key
 * content when selector backups are available.
 */
export async function rollbackRuntime(
  _instanceId: InstanceId,
  runtimeState: InstanceState,
): Promise<RollbackResult> {
  const errors: string[] = [];
  const restoredFiles: string[] = [];
  let restoredCount = 0;

  for (const artifact of runtimeState.ownedArtifacts) {
    try {
      const result = rollbackArtifact(artifact);
      if (result.restored) {
        restoredCount++;
        restoredFiles.push(artifact.path);
      }
      if (result.error) {
        errors.push(result.error);
      }
    } catch (err) {
      errors.push(
        `Failed to rollback ${artifact.path}#${artifact.selector}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return {
    success: errors.length === 0,
    restoredCount,
    restoredFiles,
    errors,
  };
}

interface ArtifactRollbackResult {
  restored: boolean;
  error?: string;
}

function rollbackArtifact(artifact: OwnedArtifact): ArtifactRollbackResult {
  if (!fs.existsSync(artifact.path)) {
    return { restored: false, error: `File not found: ${artifact.path}` };
  }

  switch (artifact.kind) {
    case "json-path":
      return rollbackJsonPath(artifact);
    case "toml-table":
      return rollbackTomlTable(artifact);
    case "file":
      return rollbackFile(artifact);
    default:
      return {
        restored: false,
        error: `Unknown artifact kind: ${artifact.kind}`,
      };
  }
}

function rollbackJsonPath(artifact: OwnedArtifact): ArtifactRollbackResult {
  const raw = fs.readFileSync(artifact.path, "utf-8");
  let config: Record<string, unknown>;

  try {
    config = JSON.parse(raw);
  } catch {
    return { restored: false, error: `Invalid JSON: ${artifact.path}` };
  }

  const backup = artifact.backupPath
    ? readArtifactBackup(artifact.backupPath)
    : null;
  if (backup?.kind === "json-path" && backup.selector === artifact.selector) {
    if (backup.existed) {
      setNestedKey(config, artifact.selector, backup.value);
    } else {
      deleteNestedKey(config, artifact.selector);
      cleanEmptyParents(config, artifact.selector);
    }
  } else {
    const removed = deleteNestedKey(config, artifact.selector);
    if (!removed) {
      return {
        restored: false,
        error: `Key not found: ${artifact.selector} in ${artifact.path}`,
      };
    }
    cleanEmptyParents(config, artifact.selector);
  }

  const tmp = `${artifact.path}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(config, null, 2) + "\n", "utf-8");
  fs.renameSync(tmp, artifact.path);
  return { restored: true };
}

function rollbackTomlTable(artifact: OwnedArtifact): ArtifactRollbackResult {
  const content = fs.readFileSync(artifact.path, "utf-8");
  const backup = artifact.backupPath
    ? readArtifactBackup(artifact.backupPath)
    : null;

  if (backup?.kind === "toml-table" && backup.selector === artifact.selector) {
    const nextContent = backup.existed
      ? replaceTomlTable(content, artifact.selector, backup.content ?? "")
      : removeTomlTable(content, artifact.selector);
    const tmp = `${artifact.path}.tmp.${process.pid}`;
    fs.writeFileSync(tmp, nextContent, "utf-8");
    fs.renameSync(tmp, artifact.path);
    return { restored: true };
  }

  if (!extractTomlTable(content, artifact.selector)) {
    return {
      restored: false,
      error: `TOML table not found: ${artifact.selector}`,
    };
  }

  const tmp = `${artifact.path}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, removeTomlTable(content, artifact.selector), "utf-8");
  fs.renameSync(tmp, artifact.path);
  return { restored: true };
}

function rollbackFile(artifact: OwnedArtifact): ArtifactRollbackResult {
  if (fs.existsSync(artifact.path)) {
    fs.unlinkSync(artifact.path);
    return { restored: true };
  }
  return { restored: false, error: `File not found: ${artifact.path}` };
}

function deleteNestedKey(
  obj: Record<string, unknown>,
  keyPath: string,
): boolean {
  const keys = keyPath.split(".");
  let current = obj;

  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (typeof current[key] !== "object" || current[key] === null) {
      return false;
    }
    current = current[key] as Record<string, unknown>;
  }

  const lastKey = keys[keys.length - 1];
  if (!(lastKey in current)) return false;
  delete current[lastKey];
  return true;
}

function setNestedKey(
  obj: Record<string, unknown>,
  keyPath: string,
  value: unknown,
): void {
  const keys = keyPath.split(".");
  let current = obj;

  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (typeof current[key] !== "object" || current[key] === null) {
      current[key] = {};
    }
    current = current[key] as Record<string, unknown>;
  }

  current[keys[keys.length - 1]] = value;
}

function cleanEmptyParents(
  obj: Record<string, unknown>,
  keyPath: string,
): void {
  const keys = keyPath.split(".");
  for (let depth = keys.length - 2; depth >= 0; depth--) {
    let current = obj;
    for (let i = 0; i < depth; i++) {
      current = current[keys[i]] as Record<string, unknown>;
      if (!current) return;
    }

    const key = keys[depth];
    const value = current[key];
    if (
      typeof value === "object" &&
      value !== null &&
      Object.keys(value).length === 0
    ) {
      delete current[key];
    }
  }
}
