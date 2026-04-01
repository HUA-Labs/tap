import * as fs from "node:fs";
import * as crypto from "node:crypto";
import type { InstanceId, TapState } from "../types.js";
import { loadInstanceConfig } from "./instance-config.js";

// ─── Types ─────────────────────────────────────────────────────

export type DriftSource = "instance-config" | "runtime-config" | "state-json";

export interface DriftCheck {
  name: string;
  source: DriftSource;
  target: DriftSource;
  status: "ok" | "drifted" | "missing";
  details: string | null;
  autoFixable: boolean;
}

export interface DriftCheckResult {
  instanceId: string;
  status: "ok" | "drifted" | "missing" | "orphaned";
  checks: DriftCheck[];
}

// ─── Hash helpers ──────────────────────────────────────────────

/**
 * Compute a stable hash of a file's contents for drift comparison.
 * Returns empty string if file doesn't exist.
 */
export function computeFileHash(filePath: string): string {
  if (!fs.existsSync(filePath)) return "";
  const content = fs.readFileSync(filePath, "utf-8");
  return crypto.createHash("sha256").update(content).digest("hex").slice(0, 16);
}

// ─── Instance Drift Check ──────────────────────────────────────

/**
 * Check drift for a single instance across 3 sources:
 * 1. instance config existence + state.json consistency
 * 2. instance config ↔ runtime config (config.toml) via hash
 * 3. config hash baseline (empty = not yet baselined)
 */
export function checkInstanceDrift(
  stateDir: string,
  instanceId: InstanceId,
  state: TapState | null,
): DriftCheckResult {
  const checks: DriftCheck[] = [];
  const instConfig = loadInstanceConfig(stateDir, instanceId);
  const stateInstance = state?.instances[instanceId] ?? null;

  // 1. Instance config existence
  if (!instConfig) {
    if (stateInstance?.installed) {
      // Pre-M214 instances have no configSourceFile — instance config absence is expected
      if (!stateInstance.configSourceFile) {
        return { instanceId, status: "ok", checks };
      }
      checks.push({
        name: "instance config exists",
        source: "instance-config",
        target: "state-json",
        status: "missing",
        details: `Instance "${instanceId}" is in state.json but has no instance config file. Run "tap add ${instanceId} --force" to recreate.`,
        autoFixable: false, // Cannot generate config from state alone
      });
      return { instanceId, status: "missing", checks };
    }
    return { instanceId, status: "ok", checks };
  }

  // Orphan check: instance config exists but not in state.json
  if (!stateInstance) {
    checks.push({
      name: "instance registered",
      source: "instance-config",
      target: "state-json",
      status: "missing",
      details: `Instance config exists for "${instanceId}" but not registered in state.json`,
      autoFixable: false,
    });
    return { instanceId, status: "orphaned", checks };
  }

  // 2. Instance config ↔ state.json field comparison
  const fieldMismatches: string[] = [];

  if (instConfig.agentName !== stateInstance.agentName) {
    fieldMismatches.push(
      `agentName: instance="${instConfig.agentName}" vs state="${stateInstance.agentName}"`,
    );
  }
  if (instConfig.port !== stateInstance.port) {
    fieldMismatches.push(
      `port: instance=${instConfig.port} vs state=${stateInstance.port}`,
    );
  }

  if (fieldMismatches.length > 0) {
    checks.push({
      name: "state consistency",
      source: "instance-config",
      target: "state-json",
      status: "drifted",
      details: fieldMismatches.join("; "),
      autoFixable: true,
    });
  } else {
    checks.push({
      name: "state consistency",
      source: "instance-config",
      target: "state-json",
      status: "ok",
      details: null,
      autoFixable: false,
    });
  }

  // 3. Config hash — detect changes since last sync
  const stateHash = stateInstance.configHash ?? "";
  if (!stateHash) {
    // Empty hash = never baselined (e.g., v2→v3 migration).
    // Report as drifted so doctor --fix can backfill.
    checks.push({
      name: "config hash baseline",
      source: "instance-config",
      target: "state-json",
      status: "drifted",
      details: `configHash not baselined for "${instanceId}" — needs backfill`,
      autoFixable: true,
    });
  } else if (instConfig.configHash !== stateHash) {
    checks.push({
      name: "config hash",
      source: "instance-config",
      target: "state-json",
      status: "drifted",
      details: `instance hash="${instConfig.configHash}" vs state hash="${stateHash}"`,
      autoFixable: true,
    });
  } else {
    checks.push({
      name: "config hash",
      source: "instance-config",
      target: "state-json",
      status: "ok",
      details: null,
      autoFixable: false,
    });
  }

  // 4. Runtime config drift (config.toml)
  // Compare instance config's runtimeConfigHash against actual file
  if (stateInstance.configPath && fs.existsSync(stateInstance.configPath)) {
    const currentRuntimeHash = computeFileHash(stateInstance.configPath);
    const lastSyncedHash = instConfig.runtimeConfigHash || "";
    if (!lastSyncedHash) {
      // Never baselined — report so doctor --fix can backfill
      checks.push({
        name: "runtime config baseline",
        source: "instance-config",
        target: "runtime-config",
        status: "drifted",
        details: `runtimeConfigHash not baselined for "${instanceId}" — needs backfill`,
        autoFixable: true,
      });
    } else if (currentRuntimeHash !== lastSyncedHash) {
      checks.push({
        name: "runtime config",
        source: "instance-config",
        target: "runtime-config",
        status: "drifted",
        details: `${stateInstance.configPath} has changed since last sync (hash: ${currentRuntimeHash.slice(0, 8)} vs synced: ${lastSyncedHash.slice(0, 8)})`,
        autoFixable: true,
      });
    } else {
      checks.push({
        name: "runtime config",
        source: "instance-config",
        target: "runtime-config",
        status: "ok",
        details: null,
        autoFixable: false,
      });
    }
  }

  const hasDrift = checks.some((c) => c.status !== "ok");
  return {
    instanceId,
    status: hasDrift ? "drifted" : "ok",
    checks,
  };
}

/**
 * Check drift for all instances in state.json + any orphaned instance configs.
 */
export function checkAllDrift(
  stateDir: string,
  state: TapState | null,
): DriftCheckResult[] {
  const results: DriftCheckResult[] = [];
  const checkedIds = new Set<string>();

  // Check all instances in state.json
  if (state) {
    for (const instanceId of Object.keys(state.instances)) {
      checkedIds.add(instanceId);
      results.push(checkInstanceDrift(stateDir, instanceId, state));
    }
  }

  // Check for orphaned instance configs
  const instancesDir = `${stateDir}/instances`;
  if (fs.existsSync(instancesDir)) {
    for (const file of fs.readdirSync(instancesDir)) {
      if (!file.endsWith(".json")) continue;
      const id = file.replace(/\.json$/, "");
      if (!checkedIds.has(id)) {
        results.push(checkInstanceDrift(stateDir, id, state));
      }
    }
  }

  return results;
}
