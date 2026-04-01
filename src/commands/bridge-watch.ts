import { loadState, saveState, updateInstanceState } from "../state.js";
import {
  restartBridge,
  inferRestartMode,
  getBridgeStatus,
  loadBridgeState,
  getTurnInfo,
  isTurnStuck,
  resolveBridgeLifecycleSnapshot,
  transitionBridgeLifecycle,
} from "../engine/bridge.js";
import { resolveConfig } from "../config/index.js";
import { getAdapter } from "../adapters/index.js";
import {
  findRepoRoot,
  createAdapterContext,
  log,
  logSuccess,
  logError,
  logHeader,
} from "../utils.js";
import type { InstanceId, CommandResult } from "../types.js";
import { formatAge, resolveRecoveredAgentName } from "./bridge-helpers.js";

// ─── Subcommand: watch ───────────────────────────────────────

/**
 * Monitor all bridges and auto-restart stuck or stale ones.
 * Runs a single check cycle and returns results.
 * For continuous monitoring, call periodically (e.g., from a cron or loop).
 */
export async function bridgeWatch(
  _intervalSeconds: number,
  stuckThresholdSeconds: number,
): Promise<CommandResult> {
  const repoRoot = findRepoRoot();
  let state = loadState(repoRoot);

  if (!state) {
    return {
      ok: false,
      command: "bridge",
      code: "TAP_NOT_INITIALIZED",
      message: "Not initialized. Run: npx @hua-labs/tap init",
      warnings: [],
      data: {},
    };
  }

  const { config: resolvedCfg } = resolveConfig({}, repoRoot);
  const stateDir = resolvedCfg.stateDir;
  const instanceIds = Object.keys(state.instances) as InstanceId[];

  logHeader("@hua-labs/tap bridge watch");
  log(
    `Checking ${instanceIds.length} instance(s), stuck threshold: ${stuckThresholdSeconds}s`,
  );

  const restarted: string[] = [];
  const cleaned: string[] = [];
  const initializing: string[] = [];
  const degraded: string[] = [];
  const healthy: string[] = [];
  const warnings: string[] = [];
  let stateChanged = false;

  for (const instanceId of instanceIds) {
    const inst = state.instances[instanceId];
    if (!inst?.installed || inst.bridgeMode !== "app-server") continue;

    const status = getBridgeStatus(stateDir, instanceId);

    if (status === "stale") {
      log(`${instanceId}: stale (process dead) — cleaning up`);
      state.instances[instanceId] = {
        ...inst,
        bridge: null,
        bridgeLifecycle: transitionBridgeLifecycle(
          inst.bridgeLifecycle ?? inst.bridge?.lifecycle ?? null,
          "crashed",
          "bridge pid not alive",
        ),
      };
      stateChanged = true;
      cleaned.push(instanceId);
      continue;
    }

    if (status === "stopped") {
      log(`${instanceId}: stopped`);
      continue;
    }

    const lifecycle = resolveBridgeLifecycleSnapshot(
      stateDir,
      instanceId,
      inst.bridge,
      inst.bridgeLifecycle ?? null,
    );

    if (lifecycle.status === "initializing") {
      initializing.push(instanceId);
      log(`${instanceId}: initializing`);
      continue;
    }

    if (lifecycle.status === "degraded-no-thread") {
      degraded.push(instanceId);
      log(
        `${instanceId}: degraded-no-thread${
          lifecycle.savedThreadId
            ? ` (saved thread ${lifecycle.savedThreadId})`
            : ""
        }`,
      );
      continue;
    }

    // Running — check for stuck turns
    if (isTurnStuck(stateDir, instanceId, stuckThresholdSeconds)) {
      const turnInfo = getTurnInfo(stateDir, instanceId, stuckThresholdSeconds);
      const ageStr =
        turnInfo?.ageSeconds != null ? formatAge(turnInfo.ageSeconds) : "?";
      log(
        `${instanceId}: ⚠ STUCK turn ${turnInfo?.activeTurnId?.slice(0, 8)}... (${ageStr}) — restarting`,
      );

      const adapter = getAdapter(inst.runtime);
      const ctx = {
        ...createAdapterContext(state.commsDir, repoRoot),
        instanceId,
      };
      const bridgeScript = adapter.resolveBridgeScript?.(ctx);

      if (!bridgeScript) {
        warnings.push(
          `${instanceId}: cannot restart — bridge script not found`,
        );
        continue;
      }

      const bridgeState = loadBridgeState(stateDir, instanceId);
      const { manageAppServer, noAuth } = inferRestartMode(bridgeState, {});

      // Scope TAP_COLD_START_WARMUP around restart (mirrors bridgeRestart, PR #847)
      const previousWarmup = process.env.TAP_COLD_START_WARMUP;
      process.env.TAP_COLD_START_WARMUP = "true";
      try {
        const recoveredAgentName = resolveRecoveredAgentName(
          instanceId,
          undefined,
          repoRoot,
          ctx.stateDir,
        );
        const newBridgeState = await restartBridge({
          instanceId,
          runtime: inst.runtime,
          stateDir: ctx.stateDir,
          commsDir: ctx.commsDir,
          bridgeScript,
          platform: ctx.platform,
          agentName: recoveredAgentName,
          runtimeCommand: resolvedCfg.runtimeCommand,
          appServerUrl: resolvedCfg.appServerUrl,
          repoRoot,
          port: inst.port ?? undefined,
          headless: inst.headless,
          drainTimeoutSeconds: 30,
          manageAppServer,
          noAuth,
          previousLifecycle:
            inst.bridgeLifecycle ?? inst.bridge?.lifecycle ?? null,
        });
        // Backwrite new bridge state to state.json (mirrors bridgeRestart)
        const updatedInst = {
          ...inst,
          agentName: recoveredAgentName ?? inst.agentName ?? null,
          bridge: newBridgeState,
          bridgeLifecycle:
            newBridgeState.lifecycle ?? inst.bridgeLifecycle ?? null,
        };
        const updatedState = updateInstanceState(
          state,
          instanceId,
          updatedInst,
        );
        saveState(repoRoot, updatedState);
        state = updatedState;
        restarted.push(instanceId);
        logSuccess(`${instanceId}: restarted`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        warnings.push(`${instanceId}: restart failed — ${msg}`);
        logError(`${instanceId}: restart failed — ${msg}`);
      } finally {
        if (previousWarmup === undefined) {
          delete process.env.TAP_COLD_START_WARMUP;
        } else {
          process.env.TAP_COLD_START_WARMUP = previousWarmup;
        }
      }
    } else {
      healthy.push(instanceId);
      log(`${instanceId}: healthy`);
    }
  }

  const message =
    [
      restarted.length > 0 ? `Restarted: ${restarted.join(", ")}` : null,
      cleaned.length > 0 ? `Cleaned stale: ${cleaned.join(", ")}` : null,
      initializing.length > 0
        ? `Initializing: ${initializing.join(", ")}`
        : null,
      degraded.length > 0 ? `Degraded: ${degraded.join(", ")}` : null,
      healthy.length > 0 ? `Healthy: ${healthy.join(", ")}` : null,
    ]
      .filter(Boolean)
      .join(". ") || "No app-server bridges found";

  log("");
  log(message);

  if (stateChanged) {
    saveState(repoRoot, state);
  }

  return {
    ok: true,
    command: "bridge",
    code:
      restarted.length > 0
        ? "TAP_BRIDGE_WATCH_RESTARTED"
        : "TAP_BRIDGE_WATCH_OK",
    message,
    warnings,
    data: { restarted, cleaned, initializing, degraded, healthy },
  };
}
