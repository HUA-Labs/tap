import { loadState } from "../state.js";
import {
  getBridgeStatus,
  getBridgeRuntimeStateDir,
  loadBridgeState,
  loadRuntimeBridgeHeartbeat,
  loadRuntimeBridgeThreadState,
} from "../engine/bridge.js";
import { resolveConfig } from "../config/index.js";
import { findRepoRoot, resolveInstanceId, log, logHeader } from "../utils.js";
import type { CommandResult } from "../types.js";
import {
  resolveTuiConnectUrl,
  resolveTuiAttachCwd,
  formatCodexTuiAttachCommand,
  redactProtectedUrl,
} from "./bridge-helpers.js";

export function bridgeTuiOne(identifier: string): CommandResult {
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

  if (!inst?.installed) {
    return {
      ok: false,
      command: "bridge",
      instanceId,
      code: "TAP_INSTANCE_NOT_FOUND",
      message: `${instanceId} is not installed.`,
      warnings: [],
      data: {},
    };
  }

  if (inst.runtime !== "codex" || inst.bridgeMode !== "app-server") {
    return {
      ok: false,
      command: "bridge",
      instanceId,
      runtime: inst.runtime,
      code: "TAP_INVALID_ARGUMENT",
      message: `${instanceId} does not support Codex TUI attach. Use a Codex app-server bridge instance.`,
      warnings: [],
      data: {},
    };
  }

  const { config: resolvedConfig } = resolveConfig({}, repoRoot);
  const stateDir = resolvedConfig.stateDir;
  const status = getBridgeStatus(stateDir, instanceId);
  if (status !== "running") {
    return {
      ok: false,
      command: "bridge",
      instanceId,
      runtime: inst.runtime,
      code: "TAP_BRIDGE_NOT_RUNNING",
      message: `${instanceId} bridge is ${status}. Start it first with: npx @hua-labs/tap bridge start ${instanceId}`,
      warnings: [],
      data: { status },
    };
  }

  const bridgeState = loadBridgeState(stateDir, instanceId);
  const appServer = bridgeState?.appServer;
  const runtimeHeartbeat = loadRuntimeBridgeHeartbeat(bridgeState);
  const savedThread = loadRuntimeBridgeThreadState(bridgeState);
  if (!appServer) {
    return {
      ok: false,
      command: "bridge",
      instanceId,
      runtime: inst.runtime,
      code: "TAP_BRIDGE_NOT_RUNNING",
      message: `${instanceId} app-server state is missing. Restart the bridge first.`,
      warnings: [],
      data: { status },
    };
  }

  const tuiConnectUrl = resolveTuiConnectUrl(appServer);
  const attachCwd = resolveTuiAttachCwd(
    repoRoot,
    state.repoRoot,
    runtimeHeartbeat?.threadCwd,
    savedThread?.cwd,
  );
  const attachEnv: Record<string, string> = {
    TAP_BRIDGE_INSTANCE_ID: instanceId,
    TAP_AGENT_ID: instanceId,
    TAP_COMMS_DIR: resolvedConfig.commsDir,
    TAP_STATE_DIR: stateDir,
    TAP_RUNTIME_STATE_DIR:
      bridgeState?.runtimeStateDir ??
      getBridgeRuntimeStateDir(repoRoot, instanceId),
    TAP_REPO_ROOT: repoRoot,
  };
  if (typeof inst.agentName === "string" && inst.agentName.trim()) {
    attachEnv.TAP_AGENT_NAME = inst.agentName;
    attachEnv.CODEX_TAP_AGENT_NAME = inst.agentName;
  }
  const attachCommand = formatCodexTuiAttachCommand(
    tuiConnectUrl,
    attachCwd,
    attachEnv,
  );
  const warnings =
    appServer.auth != null
      ? [
          "Use the upstream TUI URL, not the protected gateway URL. The protected URL is bridge-only.",
        ]
      : [];

  logHeader(`@hua-labs/tap bridge tui ${instanceId}`);
  if (appServer.auth) {
    log(`Protected: ${redactProtectedUrl(appServer.auth.protectedUrl)}`);
    log(`Upstream:  ${appServer.auth.upstreamUrl}`);
  }
  log(`Using:     ${tuiConnectUrl}`);
  log(`Attach:    ${attachCommand}`);
  log("");

  return {
    ok: true,
    command: "bridge",
    instanceId,
    runtime: inst.runtime,
    code: "TAP_BRIDGE_STATUS_OK",
    message: `${instanceId} TUI attach command ready`,
    warnings,
    data: {
      status,
      tuiConnectUrl,
      attachCwd,
      attachCommand,
      attachEnv,
      appServer,
    },
  };
}
