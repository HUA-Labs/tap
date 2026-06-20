import { loadState, saveState, updateInstanceState } from "../state.js";
import {
  restartBridge,
  inferRestartMode,
  loadBridgeState,
  resolveBridgeRestartPlan,
  BridgeDrainTimeoutError,
} from "../engine/bridge.js";
import { resolveConfig } from "../config/index.js";
import { resolveUniqueLiveDispatchAliases } from "../engine/health-monitor.js";
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
import { resolveLauncherInstanceOverrides } from "./bridge-start.js";

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
  if (flags["force"] === true) {
    log("Force restart enabled after drain timeout");
  }

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
    const restartPlan = resolveBridgeRestartPlan({
      instanceId,
      stateDir: ctx.stateDir,
      commsDir: ctx.commsDir,
      liveDispatchAliases: resolveUniqueLiveDispatchAliases(
        state.instances,
        instanceId,
      ),
      platform: ctx.platform,
      persistedLifecycle:
        inst.bridgeLifecycle ?? currentBridgeState?.lifecycle ?? null,
      fallbackBridgeState: currentBridgeState,
    });

    if (restartPlan.kind === "blocked") {
      const message = `Restart blocked for ${instanceId}: ${restartPlan.reason}`;
      logError(message);
      if (restartPlan.manualHint) {
        log(`Hint: ${restartPlan.manualHint}`);
      }
      return {
        ok: false,
        command: "bridge",
        instanceId,
        runtime: inst.runtime,
        code: "TAP_BRIDGE_RESTART_BLOCKED",
        message,
        warnings: [],
        data: {
          restartKind: restartPlan.kind,
          manualHint: restartPlan.manualHint ?? null,
        },
      };
    }

    if (restartPlan.kind === "external-managed") {
      const message = `External-managed bridge detected for ${instanceId}. Automatic restart skipped.`;
      log(message);
      if (restartPlan.evidence) {
        log(`Evidence: ${restartPlan.evidence}`);
      }
      if (restartPlan.manualHint) {
        log(`Hint: ${restartPlan.manualHint}`);
      }
      return {
        ok: true,
        command: "bridge",
        instanceId,
        runtime: inst.runtime,
        code: "TAP_BRIDGE_RESTART_EXTERNAL",
        message,
        warnings: [],
        data: {
          restartKind: restartPlan.kind,
          drained: false,
          forced: false,
          manualHint: restartPlan.manualHint ?? null,
          evidence: restartPlan.evidence ?? null,
          pid: restartPlan.liveDispatch?.bridgePid ?? null,
        },
      };
    }

    if (restartPlan.kind === "not-running") {
      log(
        `No tracked running bridge found for ${instanceId}; starting a new bridge`,
      );
    }

    if (
      flags["unsandboxed"] === true &&
      (inst.runtime !== "codex" || flags["no-server"] === true)
    ) {
      return {
        ok: false,
        command: "bridge",
        instanceId,
        runtime: inst.runtime,
        code: "TAP_INVALID_ARGUMENT",
        message:
          "--unsandboxed requires a managed Codex app-server (omit --no-server)",
        warnings: [],
        data: {},
      };
    }

    const { manageAppServer, noAuth, appServerUnsandboxed } = inferRestartMode(
      currentBridgeState,
      {
        noServer: flags["no-server"] === true ? true : undefined,
        noAuth: flags["no-auth"] === true ? true : undefined,
        unsandboxed: flags["unsandboxed"] === true ? true : undefined,
      },
      {
        manageAppServer: inst.manageAppServer,
        noAuth: inst.noAuth,
        appServerUnsandboxed: inst.appServerUnsandboxed,
      },
    );
    const existingAppServer =
      currentBridgeState?.appServer ?? inst.managedAppServer ?? null;

    // M392: forward suffix / routing slot through restart so a session that
    // started with `--instance-id-suffix` does not silently revert to the
    // base id on restart.
    const launcher = resolveLauncherInstanceOverrides({
      flags,
      env: process.env,
      repoRoot,
      baseInstanceId: instanceId,
    });
    if (!launcher.ok) {
      return {
        ok: false,
        command: "bridge",
        instanceId,
        runtime: inst.runtime,
        code: "TAP_INVALID_ARGUMENT",
        message: launcher.message,
        warnings: [],
        data: {},
      };
    }
    const { instanceIdSuffix, routingSlot } = launcher;
    for (const line of launcher.logs) log(line);

    const previousColdStartWarmup = process.env.TAP_COLD_START_WARMUP;
    process.env.TAP_COLD_START_WARMUP = "true";
    let bridgeResult: Awaited<ReturnType<typeof restartBridge>>;
    try {
      bridgeResult = await restartBridge({
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
        force: flags["force"] === true,
        manageAppServer,
        noAuth,
        appServerUnsandboxed,
        existingAppServer,
        previousLifecycle:
          inst.bridgeLifecycle ?? inst.bridge?.lifecycle ?? null,
        instanceIdSuffix,
        routingSlot,
        onDrainWait: ({ activeTurnId, turnState, waitedMs }) => {
          const waitedSeconds = Math.floor(waitedMs / 1000);
          const busyDetail = activeTurnId
            ? `active turn ${activeTurnId}`
            : turnState
              ? `state ${turnState}`
              : "bridge busy";
          log(`Waiting for drain (${waitedSeconds}s): ${busyDetail}`);
        },
      });
    } finally {
      if (previousColdStartWarmup === undefined) {
        delete process.env.TAP_COLD_START_WARMUP;
      } else {
        process.env.TAP_COLD_START_WARMUP = previousColdStartWarmup;
      }
    }

    const bridge = bridgeResult.bridge as BridgeState;
    const modeLabel =
      restartPlan.kind === "not-running" ? "started via restart" : "restarted";
    const forceSuffix = bridgeResult.forced
      ? " (forced after drain timeout)"
      : "";
    logSuccess(`Bridge ${modeLabel} (PID: ${bridge.pid})${forceSuffix}`);

    // Save bridge mode for next restart (#799 follow-up)
    const updated = {
      ...inst,
      defaultAgentName: resolvedAgentName ?? inst.defaultAgentName ?? null,
      bridge,
      bridgeLifecycle: bridge.lifecycle ?? inst.bridgeLifecycle ?? null,
      manageAppServer,
      noAuth,
      appServerUnsandboxed,
      managedAppServer: bridge.appServer?.managed ? bridge.appServer : null,
    };
    const newState = updateInstanceState(state, instanceId, updated);
    saveState(repoRoot, newState);

    return {
      ok: true,
      command: "bridge",
      instanceId,
      code: "TAP_BRIDGE_RESTART_OK",
      message:
        restartPlan.kind === "not-running"
          ? `Bridge for ${instanceId} started via restart (PID: ${bridge.pid})`
          : `Bridge for ${instanceId} restarted (PID: ${bridge.pid})`,
      warnings: [],
      data: {
        pid: bridge.pid,
        restartKind: restartPlan.kind,
        drained: bridgeResult.drained,
        forced: bridgeResult.forced,
      },
    };
  } catch (err) {
    if (err instanceof BridgeDrainTimeoutError) {
      logError(err.message);
      return {
        ok: false,
        command: "bridge",
        instanceId,
        runtime: inst.runtime,
        code: "TAP_BRIDGE_DRAIN_TIMEOUT",
        message: err.message,
        warnings: [],
        data: {
          restartKind: "managed-restart",
          drained: false,
          forced: false,
          activeTurnId: err.activeTurnId,
          turnState: err.turnState,
          waitedMs: err.waitedMs,
        },
      };
    }
    const msg = err instanceof Error ? err.message : String(err);
    logError(msg);
    return {
      ok: false,
      command: "bridge",
      instanceId,
      code: "TAP_BRIDGE_RESTART_FAILED",
      message: msg,
      warnings: [],
      data: {},
    };
  }
}
