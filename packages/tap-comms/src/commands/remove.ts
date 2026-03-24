import { loadState, saveState, removeInstanceState } from "../state.js";
import {
  findRepoRoot,
  createAdapterContext,
  resolveInstanceId,
  log,
  logSuccess,
  logError,
  logHeader,
} from "../utils.js";
import { rollbackRuntime } from "../engine/rollback.js";
import { stopBridge } from "../engine/bridge.js";
import type { CommandResult } from "../types.js";

export async function removeCommand(args: string[]): Promise<CommandResult> {
  const identifier = args.find((a) => !a.startsWith("-"));

  if (!identifier) {
    return {
      ok: false,
      command: "remove",
      code: "TAP_INVALID_ARGUMENT",
      message:
        "Missing instance argument. Usage: npx @hua-labs/tap remove <instance>",
      warnings: [],
      data: {},
    };
  }

  const repoRoot = findRepoRoot();
  const state = loadState(repoRoot);

  if (!state) {
    return {
      ok: false,
      command: "remove",
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
      command: "remove",
      code: resolved.code,
      message: resolved.message,
      warnings: [],
      data: {},
    };
  }

  const instanceId = resolved.instanceId;
  const instance = state.instances[instanceId];

  if (!instance?.installed) {
    return {
      ok: true,
      command: "remove",
      instanceId,
      code: "TAP_NO_OP",
      message: `${instanceId} is not installed.`,
      warnings: [],
      data: {},
    };
  }

  logHeader(`@hua-labs/tap remove ${instanceId}`);

  // Stop bridge if running before rollback
  if (instance.bridge) {
    const ctx = createAdapterContext(state.commsDir, repoRoot);
    const stopped = await stopBridge({
      instanceId,
      stateDir: ctx.stateDir,
      platform: ctx.platform,
    });
    if (stopped) {
      logSuccess(`Bridge for ${instanceId} stopped`);
    } else {
      log(`No running bridge for ${instanceId}`);
    }
  }

  const result = await rollbackRuntime(instanceId, instance);

  if (result.success) {
    logSuccess(`Rolled back ${result.restoredCount} artifact(s)`);
    for (const f of result.restoredFiles) logSuccess(`Restored: ${f}`);

    const newState = removeInstanceState(state, instanceId);
    saveState(repoRoot, newState);
    logSuccess("State updated");

    logHeader("Done!");

    return {
      ok: true,
      command: "remove",
      instanceId,
      runtime: instance.runtime,
      code: "TAP_REMOVE_OK",
      message: `${instanceId} removed successfully`,
      warnings: [],
      data: {
        restoredCount: result.restoredCount,
        restoredFiles: result.restoredFiles,
      },
    };
  }

  for (const e of result.errors) logError(e);

  return {
    ok: false,
    command: "remove",
    instanceId,
    runtime: instance.runtime,
    code: "TAP_ROLLBACK_FAILED",
    message: "Rollback had errors. State preserved for retry.",
    warnings: result.errors,
    data: { restoredCount: result.restoredCount },
  };
}
