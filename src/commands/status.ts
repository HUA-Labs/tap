import { loadState, saveState, getInstalledInstances } from "../state.js";
import {
  deriveBridgeLifecycleState,
  resolveBridgeLifecycleSnapshot,
  deriveCodexSessionState,
  loadRuntimeBridgeHeartbeat,
} from "../engine/bridge.js";
import { resolveConfig } from "../config/index.js";
import { findRepoRoot, log, logHeader, logWarn } from "../utils.js";
import { version } from "../version.js";
import type { InstanceState, CommandResult } from "../types.js";
import type {
  BridgeLifecycleSnapshot,
  CodexSessionSnapshot,
} from "../engine/bridge.js";

const STATUS_HELP = `
Usage:
  tap status

Description:
  Show all installed instances, their bridge status, and configuration info.

Examples:
  npx @hua-labs/tap status
`.trim();

interface ResolvedStatus {
  status: string;
  lifecycle: BridgeLifecycleSnapshot | null;
  session: CodexSessionSnapshot | null;
}

function resolveStatus(inst: InstanceState, stateDir: string): ResolvedStatus {
  if (!inst.installed) {
    return {
      status: "not installed",
      lifecycle: null,
      session: null,
    };
  }

  switch (inst.bridgeMode) {
    case "native-push":
    case "polling":
      return {
        status: inst.lastVerifiedAt ? "active" : "configured",
        lifecycle: null,
        session: null,
      };

    case "app-server": {
      if (inst.bridge) {
        const lifecycle = resolveBridgeLifecycleSnapshot(
          stateDir,
          inst.instanceId,
          inst.bridge,
        );
        if (lifecycle.status === "bridge-stale") {
          inst.bridge = null;
          return {
            status: inst.lastVerifiedAt ? "configured" : "installed",
            lifecycle,
            session: null,
          };
        }
        const runtimeHeartbeat = loadRuntimeBridgeHeartbeat(inst.bridge);
        return {
          status: "active",
          lifecycle,
          session: deriveCodexSessionState({
            runtimeHeartbeat,
            runtimeStateDir: inst.bridge.runtimeStateDir ?? null,
          }),
        };
      }
      return {
        status: inst.lastVerifiedAt ? "configured" : "installed",
        lifecycle: deriveBridgeLifecycleState({
          bridgeStatus: "stopped",
        }),
        session: deriveCodexSessionState({ runtimeHeartbeat: null }),
      };
    }

    default:
      return {
        status: "installed",
        lifecycle: null,
        session: null,
      };
  }
}

function instanceStatusLine(
  inst: InstanceState,
  status: string,
  lifecycle: BridgeLifecycleSnapshot | null,
  session: CodexSessionSnapshot | null,
): string {
  const bridgeInfo = inst.bridge ? ` (pid: ${inst.bridge.pid})` : "";
  const lifecycleStr = lifecycle?.status ?? "-";
  const sessionStr = session?.status ?? "-";
  const mode = inst.bridgeMode;
  const portStr = inst.port ? ` port:${inst.port}` : "";
  const restart = inst.restartRequired ? " [restart required]" : "";
  const warns =
    inst.warnings.length > 0 ? ` [${inst.warnings.length} warning(s)]` : "";

  return `${inst.instanceId.padEnd(20)} ${inst.runtime.padEnd(8)} ${status.padEnd(14)} ${lifecycleStr.padEnd(20)} ${sessionStr.padEnd(18)} ${mode.padEnd(14)}${bridgeInfo}${portStr}${restart}${warns}`;
}

export async function statusCommand(args: string[]): Promise<CommandResult> {
  if (args.includes("--help") || args.includes("-h")) {
    log(STATUS_HELP);
    return {
      ok: true,
      command: "status",
      code: "TAP_NO_OP",
      message: STATUS_HELP,
      warnings: [],
      data: {},
    };
  }

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

  log(`Version:    ${version}`);
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
      lifecycle: BridgeLifecycleSnapshot | null;
      session: CodexSessionSnapshot | null;
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
      `${"Instance".padEnd(20)} ${"Runtime".padEnd(8)} ${"Status".padEnd(14)} ${"Lifecycle".padEnd(20)} ${"Session".padEnd(18)} ${"Bridge Mode".padEnd(14)} Details`,
    );
    log(
      `${"─".repeat(20)} ${"─".repeat(8)} ${"─".repeat(14)} ${"─".repeat(20)} ${"─".repeat(18)} ${"─".repeat(14)} ${"─".repeat(20)}`,
    );

    for (const id of installed) {
      const inst = state.instances[id];
      if (inst) {
        // resolveStatus may clear inst.bridge if stale
        const { status, lifecycle, session } = resolveStatus(inst, stateDir);
        log(instanceStatusLine(inst, status, lifecycle, session));
        if (inst.warnings.length > 0) {
          for (const w of inst.warnings) {
            logWarn(`  ${w}`);
          }
        }
        instances[id] = {
          status,
          lifecycle,
          session,
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
      version,
      commsDir: state.commsDir,
      repoRoot: state.repoRoot,
      instances,
    },
  };
}
