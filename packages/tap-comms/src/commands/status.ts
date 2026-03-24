import { loadState, saveState, getInstalledInstances } from "../state.js";
import { isBridgeRunning } from "../engine/bridge.js";
import { resolveConfig } from "../config/index.js";
import { findRepoRoot, log, logHeader, logWarn } from "../utils.js";
import type { InstanceState, CommandResult } from "../types.js";

function resolveStatus(inst: InstanceState, stateDir: string): string {
  if (!inst.installed) return "not installed";

  switch (inst.bridgeMode) {
    case "native-push":
    case "polling":
      return inst.lastVerifiedAt ? "active" : "configured";

    case "app-server":
      if (inst.bridge && isBridgeRunning(stateDir, inst.instanceId)) {
        return "active";
      }
      // Clear stale bridge metadata if process is dead
      if (inst.bridge) {
        inst.bridge = null;
      }
      return inst.lastVerifiedAt ? "configured" : "installed";

    default:
      return "installed";
  }
}

function instanceStatusLine(inst: InstanceState, status: string): string {
  const bridgeInfo = inst.bridge ? ` (pid: ${inst.bridge.pid})` : "";
  const mode = inst.bridgeMode;
  const portStr = inst.port ? ` port:${inst.port}` : "";
  const restart = inst.restartRequired ? " [restart required]" : "";
  const warns =
    inst.warnings.length > 0 ? ` [${inst.warnings.length} warning(s)]` : "";

  return `${inst.instanceId.padEnd(20)} ${inst.runtime.padEnd(8)} ${status.padEnd(14)} ${mode.padEnd(14)}${bridgeInfo}${portStr}${restart}${warns}`;
}

export async function statusCommand(_args: string[]): Promise<CommandResult> {
  const repoRoot = findRepoRoot();
  const state = loadState(repoRoot);

  if (!state) {
    return {
      ok: false,
      command: "status",
      code: "TAP_NOT_INITIALIZED",
      message: "Not initialized. Run: npx @hua-labs/tap init",
      warnings: [],
      data: {},
    };
  }

  logHeader("@hua-labs/tap status");

  log(`Version:    ${state.packageVersion}`);
  log(`Comms dir:  ${state.commsDir}`);
  log(`Repo root:  ${state.repoRoot}`);
  log(`Schema:     v${state.schemaVersion}`);
  log(`Updated:    ${state.updatedAt}`);

  const installed = getInstalledInstances(state);
  const { config: resolvedCfg } = resolveConfig({}, repoRoot);
  const stateDir = resolvedCfg.stateDir;

  const instances: Record<
    string,
    {
      status: string;
      runtime: string;
      bridgeMode: string;
      bridge: unknown;
      port: number | null;
      warnings: string[];
    }
  > = {};

  // Track if any stale bridge metadata was cleaned
  const bridgesBefore = installed.map((id) => state.instances[id]?.bridge);

  if (installed.length === 0) {
    log("");
    log("No instances installed.");
    log("Run: npx @hua-labs/tap add <claude|codex|gemini>");
  } else {
    log("");
    log(
      `${"Instance".padEnd(20)} ${"Runtime".padEnd(8)} ${"Status".padEnd(14)} ${"Bridge Mode".padEnd(14)} Details`,
    );
    log(
      `${"─".repeat(20)} ${"─".repeat(8)} ${"─".repeat(14)} ${"─".repeat(14)} ${"─".repeat(20)}`,
    );

    for (const id of installed) {
      const inst = state.instances[id];
      if (inst) {
        // resolveStatus may clear inst.bridge if stale
        const status = resolveStatus(inst, stateDir);
        log(instanceStatusLine(inst, status));
        if (inst.warnings.length > 0) {
          for (const w of inst.warnings) {
            logWarn(`  ${w}`);
          }
        }
        instances[id] = {
          status,
          runtime: inst.runtime,
          bridgeMode: inst.bridgeMode,
          bridge: inst.bridge,
          port: inst.port,
          warnings: inst.warnings,
        };
      }
    }
  }

  // Persist stale bridge cleanup if any were cleared
  const bridgesAfter = installed.map((id) => state.instances[id]?.bridge);
  const staleCleared = bridgesBefore.some((b, i) => b !== bridgesAfter[i]);
  if (staleCleared) {
    state.updatedAt = new Date().toISOString();
    saveState(repoRoot, state);
  }

  log("");

  return {
    ok: true,
    command: "status",
    code: "TAP_STATUS_OK",
    message: `${installed.length} instance(s) installed`,
    warnings: [],
    data: {
      version: state.packageVersion,
      commsDir: state.commsDir,
      repoRoot: state.repoRoot,
      instances,
    },
  };
}
