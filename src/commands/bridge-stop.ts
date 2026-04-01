import { loadState, saveState, updateInstanceState } from "../state.js";
import {
  stopBridge,
  stopManagedAppServer,
  waitForPortRelease,
} from "../engine/bridge.js";
import {
  findRepoRoot,
  createAdapterContext,
  resolveInstanceId,
  log,
  logSuccess,
  logHeader,
} from "../utils.js";
import type { InstanceId, AppServerState, CommandResult } from "../types.js";
import {
  loadCurrentBridgeState,
  getSharedAppServerUsers,
  transferManagedAppServerOwnership,
} from "./bridge-helpers.js";

// ─── Subcommand: stop ──────────────────────────────────────────

export async function bridgeStopOne(
  identifier: string,
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
  const ctx = createAdapterContext(state.commsDir, repoRoot);
  const instance = state.instances[instanceId];
  const bridgeState = loadCurrentBridgeState(
    ctx.stateDir,
    instanceId,
    instance?.bridge,
  );
  const appServer = bridgeState?.appServer ?? null;

  logHeader(`@hua-labs/tap bridge stop ${instanceId}`);

  const stopResult = await stopBridge({
    instanceId,
    stateDir: ctx.stateDir,
    platform: ctx.platform,
  });

  let appServerStopped = false;
  let appServerTransferredTo: InstanceId | null = null;

  if (stopResult.stopped) {
    logSuccess(`Bridge for ${instanceId} stopped`);
  } else {
    log(`No running bridge for ${instanceId}`);
  }

  if (appServer?.managed) {
    const sharedUsers = getSharedAppServerUsers(
      state,
      ctx.stateDir,
      instanceId,
      appServer.url,
    );

    if (sharedUsers.length > 0) {
      const recipient = sharedUsers[0];
      if (
        transferManagedAppServerOwnership(
          state,
          ctx.stateDir,
          recipient,
          appServer,
        )
      ) {
        appServerTransferredTo = recipient;
        log(`Managed app-server ownership moved to ${recipient}`);
      } else {
        log(
          `Managed app-server left running at ${appServer.url} because ownership transfer failed`,
        );
      }
    } else {
      appServerStopped = await stopManagedAppServer(appServer, ctx.platform);
      if (appServerStopped) {
        const gatewayNote =
          appServer.auth?.gatewayPid != null
            ? `, gateway PID: ${appServer.auth.gatewayPid}`
            : "";
        logSuccess(
          `Managed app-server stopped (PID: ${appServer.pid ?? "-"}${gatewayNote})`,
        );
        // Wait for port to be released so the next bridge start won't
        // hit TIME_WAIT conflicts (port zombie prevention)
        const released = await waitForPortRelease(appServer.url, 5_000);
        if (!released) {
          log(
            `Warning: port for ${appServer.url} still in use after stop — next start may need a different port`,
          );
        }
      }
    }
  }

  // Clear bridge from state
  if (instance) {
    const updated = {
      ...instance,
      bridge: null,
      bridgeLifecycle: stopResult.lifecycle ?? instance.bridgeLifecycle ?? null,
    };
    const newState = updateInstanceState(state, instanceId, updated);
    saveState(repoRoot, newState);
  }

  if (stopResult.stopped) {
    return {
      ok: true,
      command: "bridge",
      instanceId,
      code: "TAP_BRIDGE_STOP_OK",
      message: `Bridge for ${instanceId} stopped`,
      warnings: [],
      data: {
        appServerStopped,
        appServerTransferredTo,
      },
    };
  }

  return {
    ok: true,
    command: "bridge",
    instanceId,
    code: "TAP_BRIDGE_NOT_RUNNING",
    message: `No running bridge for ${instanceId}`,
    warnings: [],
    data: {
      appServerStopped,
      appServerTransferredTo,
    },
  };
}

export async function bridgeStopAll(): Promise<CommandResult> {
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

  const ctx = createAdapterContext(state.commsDir, repoRoot);
  const instanceIds = Object.keys(state.instances) as InstanceId[];
  const stopped: string[] = [];
  const managedAppServers = new Map<string, AppServerState>();

  logHeader("@hua-labs/tap bridge stop (all)");

  let stateChanged = false;

  for (const instanceId of instanceIds) {
    const bridgeState = loadCurrentBridgeState(
      ctx.stateDir,
      instanceId,
      state.instances[instanceId]?.bridge,
    );
    const appServer = bridgeState?.appServer;
    if (appServer?.managed && appServer.pid != null) {
      managedAppServers.set(
        `${appServer.url}:${appServer.pid}:${appServer.auth?.gatewayPid ?? "-"}`,
        appServer,
      );
    }

    const stopResult = await stopBridge({
      instanceId,
      stateDir: ctx.stateDir,
      platform: ctx.platform,
    });

    if (stopResult.stopped) {
      logSuccess(`Stopped bridge for ${instanceId}`);
      stopped.push(instanceId);
    }

    // Clear stale bridge metadata regardless of whether process was alive
    const instance = state.instances[instanceId];
    if (instance?.bridge || stopResult.lifecycle) {
      state.instances[instanceId] = {
        ...instance,
        bridge: null,
        bridgeLifecycle:
          stopResult.lifecycle ?? instance.bridgeLifecycle ?? null,
      };
      stateChanged = true;
    }
  }

  const stoppedAppServers: number[] = [];
  const releasePorts: string[] = [];
  for (const appServer of managedAppServers.values()) {
    if (await stopManagedAppServer(appServer, ctx.platform)) {
      stoppedAppServers.push(appServer.pid!);
      releasePorts.push(appServer.url);
      const gatewayNote =
        appServer.auth?.gatewayPid != null
          ? `, gateway PID ${appServer.auth.gatewayPid}`
          : "";
      logSuccess(
        `Stopped app-server PID ${appServer.pid} (${appServer.url}${gatewayNote})`,
      );
    }
  }

  // Wait for all stopped app-server ports to release (parallel)
  if (releasePorts.length > 0) {
    await Promise.all(
      releasePorts.map((url) => waitForPortRelease(url, 5_000)),
    );
  }

  if (stateChanged) {
    state.updatedAt = new Date().toISOString();
    saveState(repoRoot, state);
  }

  const message =
    stopped.length > 0
      ? `Stopped ${stopped.length} bridge(s): ${stopped.join(", ")}`
      : "No running bridges found";

  log(message);

  return {
    ok: true,
    command: "bridge",
    code: stopped.length > 0 ? "TAP_BRIDGE_STOP_OK" : "TAP_BRIDGE_NOT_RUNNING",
    message,
    warnings: [],
    data: { stopped, stoppedAppServers },
  };
}
