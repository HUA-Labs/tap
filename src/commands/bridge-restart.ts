import { loadState, saveState, updateInstanceState } from "../state.js";
import {
  restartBridge,
  inferRestartMode,
  loadBridgeState,
} from "../engine/bridge.js";
import { resolveConfig } from "../config/index.js";
import { getAdapter } from "../adapters/index.js";
import {
  findRepoRoot,
  createAdapterContext,
  resolveInstanceId,
  parseIntFlag,
  log,
  logSuccess,
  logError,
  logHeader,
} from "../utils.js";
import type { CommandResult, BridgeState } from "../types.js";
import { resolveRecoveredAgentName } from "./bridge-helpers.js";

// ─── Subcommand: restart ───────────────────────────────────────

export async function bridgeRestart(
  identifier: string,
  flags: Record<string, string | boolean>,
  explicitAgentName?: string,
): Promise<CommandResult> {
  const repoRoot = findRepoRoot();
  const state = loadState(repoRoot);
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

  const resolved = resolveInstanceId(identifier, state);
  if (!resolved.ok) {
    return {
      ok: false,
      command: "bridge",
      code: resolved.code,
      message: resolved.message,
      warnings: [],
      data: {},
    };
  }

  const instanceId = resolved.instanceId;
  const inst = state.instances[instanceId];
  if (!inst) {
    return {
      ok: false,
      command: "bridge",
      code: "TAP_INSTANCE_NOT_FOUND",
      message: `Instance not found: ${instanceId}`,
      warnings: [],
      data: {},
    };
  }

  const adapter = getAdapter(inst.runtime);
  const ctx = {
    ...createAdapterContext(state.commsDir, repoRoot),
    instanceId,
  };
  const bridgeScript = adapter.resolveBridgeScript?.(ctx);

  if (!bridgeScript) {
    return {
      ok: false,
      command: "bridge",
      instanceId,
      code: "TAP_BRIDGE_SCRIPT_MISSING",
      message: `Bridge script not found for ${instanceId}`,
      warnings: [],
      data: {},
    };
  }

  const { config: resolvedConfig } = resolveConfig({}, repoRoot);
  const drainStr =
    typeof flags["drain-timeout"] === "string"
      ? flags["drain-timeout"]
      : undefined;
  let drainTimeout: number;
  try {
    drainTimeout = parseIntFlag(drainStr, "--drain-timeout", 1, 300) ?? 30;
  } catch (err) {
    return {
      ok: false,
      command: "bridge",
      instanceId,
      runtime: inst.runtime,
      code: "TAP_INVALID_ARGUMENT",
      message: err instanceof Error ? err.message : String(err),
      warnings: [],
      data: {},
    };
  }

  logHeader(`@hua-labs/tap bridge restart ${instanceId}`);
  log(`Drain timeout: ${drainTimeout}s`);

  try {
    const resolvedAgentName = resolveRecoveredAgentName(
      instanceId,
      explicitAgentName,
      repoRoot,
      ctx.stateDir,
    );

    // Use production helper for mode inference (tested in identity-restart.test.ts)
    // Priority: flags > saved instance mode > bridge state inference
    const currentBridgeState = loadBridgeState(ctx.stateDir, instanceId);
    const { manageAppServer, noAuth } = inferRestartMode(
      currentBridgeState,
      {
        noServer: flags["no-server"] === true ? true : undefined,
        noAuth: flags["no-auth"] === true ? true : undefined,
      },
      {
        manageAppServer: inst.manageAppServer,
        noAuth: inst.noAuth,
      },
    );

    const previousColdStartWarmup = process.env.TAP_COLD_START_WARMUP;
    process.env.TAP_COLD_START_WARMUP = "true";
    let bridge: BridgeState;
    try {
      bridge = await restartBridge({
        instanceId,
        runtime: inst.runtime,
        stateDir: ctx.stateDir,
        commsDir: ctx.commsDir,
        bridgeScript,
        platform: ctx.platform,
        agentName: resolvedAgentName,
        runtimeCommand: resolvedConfig.runtimeCommand,
        appServerUrl: resolvedConfig.appServerUrl,
        repoRoot,
        port: inst.port ?? undefined,
        headless: inst.headless,
        drainTimeoutSeconds: drainTimeout,
        manageAppServer,
        noAuth,
        previousLifecycle:
          inst.bridgeLifecycle ?? inst.bridge?.lifecycle ?? null,
      });
    } finally {
      if (previousColdStartWarmup === undefined) {
        delete process.env.TAP_COLD_START_WARMUP;
      } else {
        process.env.TAP_COLD_START_WARMUP = previousColdStartWarmup;
      }
    }

    logSuccess(`Bridge restarted (PID: ${bridge.pid})`);

    // Save bridge mode for next restart (#799 follow-up)
    const updated = {
      ...inst,
      agentName: resolvedAgentName ?? inst.agentName ?? null,
      bridge,
      bridgeLifecycle: bridge.lifecycle ?? inst.bridgeLifecycle ?? null,
      manageAppServer,
      noAuth,
    };
    const newState = updateInstanceState(state, instanceId, updated);
    saveState(repoRoot, newState);

    return {
      ok: true,
      command: "bridge",
      instanceId,
      code: "TAP_BRIDGE_START_OK",
      message: `Bridge for ${instanceId} restarted (PID: ${bridge.pid})`,
      warnings: [],
      data: { pid: bridge.pid },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logError(msg);
    return {
      ok: false,
      command: "bridge",
      instanceId,
      code: "TAP_BRIDGE_START_FAILED",
      message: msg,
      warnings: [],
      data: {},
    };
  }
}
