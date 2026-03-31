import {
  loadState,
  saveState,
  updateInstanceState,
  ensureBackupDir,
} from "../state.js";
import {
  findRepoRoot,
  isValidRuntime,
  createAdapterContext,
  parseArgs,
  buildInstanceId,
  findPortConflict,
  log,
  logSuccess,
  logWarn,
  logError,
  logHeader,
} from "../utils.js";
import { getAdapter } from "../adapters/index.js";
import {
  startBridge,
  findNextAvailableAppServerPort,
} from "../engine/bridge.js";
import { resolveConfig } from "../config/index.js";
import type {
  RuntimeName,
  BridgeState,
  HeadlessConfig,
  AgentRole,
  CommandResult,
} from "../types.js";

const ADD_HELP = `
Usage:
  tap add <claude|codex|gemini> [options]

Description:
  Install a runtime instance and configure it to use tap.

Options:
  --name <name>         Instance name (default: runtime name)
  --port <port>         Port for app-server bridge
  --agent-name <name>   Agent display name for bridge identification
  --force               Re-install even if already configured
  --headless            Enable headless reviewer mode (requires --name)
  --role <role>         Headless role: reviewer, validator, long-running
  --help, -h            Show help

Examples:
  npx @hua-labs/tap add claude
  npx @hua-labs/tap add codex --name reviewer --port 4501 --headless --role reviewer
`.trim();

function normalizeAgentName(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function resolveAgentName(options: {
  explicit?: string | null;
  env?: string | null;
  stored?: string | null;
  fallback?: string | null;
}): string | null {
  return (
    normalizeAgentName(options.explicit) ??
    normalizeAgentName(options.stored) ??
    normalizeAgentName(options.env) ??
    normalizeAgentName(options.fallback) ??
    null
  );
}

export async function addCommand(args: string[]): Promise<CommandResult> {
  const { positional, flags } = parseArgs(args);

  if (flags["help"] === true || flags["h"] === true) {
    log(ADD_HELP);
    return {
      ok: true,
      command: "add",
      code: "TAP_NO_OP",
      message: ADD_HELP,
      warnings: [],
      data: {},
    };
  }

  const runtimeArg = positional[0];

  if (!runtimeArg) {
    return {
      ok: false,
      command: "add",
      code: "TAP_INVALID_ARGUMENT",
      message:
        "Missing runtime argument. Usage: npx @hua-labs/tap add <claude|codex|gemini> [--name <name>] [--port <port>] [--agent-name <name>] [--headless] [--role <role>]",
      warnings: [],
      data: {},
    };
  }

  if (!isValidRuntime(runtimeArg)) {
    return {
      ok: false,
      command: "add",
      code: "TAP_RUNTIME_UNKNOWN",
      message: `Unknown runtime: ${runtimeArg}. Available: claude, codex, gemini`,
      warnings: [],
      data: {},
    };
  }

  const runtime: RuntimeName = runtimeArg;
  const instanceName =
    typeof flags["name"] === "string" ? flags["name"] : undefined;
  const instanceId = buildInstanceId(runtime, instanceName);
  const portStr = typeof flags["port"] === "string" ? flags["port"] : undefined;
  const port = portStr ? Number(portStr) : null;
  const agentNameFlag = normalizeAgentName(
    typeof flags["agent-name"] === "string" ? flags["agent-name"] : null,
  );
  const force = flags["force"] === true;
  const headlessFlag = flags["headless"] === true;
  const roleArg = typeof flags["role"] === "string" ? flags["role"] : undefined;

  // Validate --role value
  const validRoles: AgentRole[] = ["reviewer", "validator", "long-running"];
  if (roleArg && !validRoles.includes(roleArg as AgentRole)) {
    return {
      ok: false,
      command: "add",
      runtime,
      instanceId,
      code: "TAP_INVALID_ARGUMENT",
      message: `Invalid role: ${roleArg}. Available: ${validRoles.join(", ")}`,
      warnings: [],
      data: {},
    };
  }

  // --headless requires --name (for instance isolation)
  if (headlessFlag && !instanceName) {
    return {
      ok: false,
      command: "add",
      runtime,
      instanceId,
      code: "TAP_INVALID_ARGUMENT",
      message: "--headless requires --name for instance isolation",
      warnings: [],
      data: {},
    };
  }

  // Build headless config
  const headless: HeadlessConfig | null = headlessFlag
    ? {
        enabled: true,
        role: (roleArg as AgentRole) ?? "reviewer",
        maxRounds: 5,
        qualitySeverityFloor: "high",
      }
    : null;

  if (portStr && (port === null || isNaN(port) || port < 1 || port > 65535)) {
    return {
      ok: false,
      command: "add",
      runtime,
      instanceId,
      code: "TAP_INVALID_ARGUMENT",
      message: `Invalid port: ${portStr}. Must be between 1 and 65535.`,
      warnings: [],
      data: {},
    };
  }

  const repoRoot = findRepoRoot();
  const state = loadState(repoRoot);
  const adapter = getAdapter(runtime);

  if (!state) {
    return {
      ok: false,
      command: "add",
      runtime,
      instanceId,
      code: "TAP_NOT_INITIALIZED",
      message: "Not initialized. Run: npx @hua-labs/tap init",
      warnings: [],
      data: {},
    };
  }

  const existingInstance = state.instances[instanceId];
  const mode = adapter.bridgeMode();
  const envAgentName = normalizeAgentName(
    process.env.TAP_AGENT_NAME ?? process.env.CODEX_TAP_AGENT_NAME,
  );
  const defaultAgentName = mode === "app-server" ? instanceId : null;
  const resolvedAgentName = resolveAgentName({
    explicit: agentNameFlag,
    env: envAgentName,
    stored: existingInstance?.agentName ?? null,
    fallback: defaultAgentName,
  });

  if (existingInstance?.installed && !force) {
    if (resolvedAgentName !== existingInstance.agentName) {
      const updatedState = updateInstanceState(state, instanceId, {
        ...existingInstance,
        agentName: resolvedAgentName,
      });
      saveState(repoRoot, updatedState);
      return {
        ok: true,
        command: "add",
        runtime,
        instanceId,
        code: "TAP_ADD_OK",
        message:
          resolvedAgentName === null
            ? `${instanceId} updated`
            : `${instanceId} agent name updated to "${resolvedAgentName}".`,
        warnings: [],
        data: {
          updatedFields: ["agentName"],
          agentName: resolvedAgentName,
        },
      };
    }

    return {
      ok: true,
      command: "add",
      runtime,
      instanceId,
      code: "TAP_NO_OP",
      message: `${instanceId} is already installed. Use --force to re-install.`,
      warnings: [],
      data: {},
    };
  }

  // Port conflict check
  if (port !== null) {
    const conflict = findPortConflict(state, port, instanceId);
    if (conflict) {
      return {
        ok: false,
        command: "add",
        runtime,
        instanceId,
        code: "TAP_PORT_CONFLICT",
        message: `Port ${port} is already used by instance "${conflict}".`,
        warnings: [],
        data: { conflictingInstance: conflict },
      };
    }
  }

  logHeader(`@hua-labs/tap add ${instanceId}`);
  if (instanceName) log(`Instance name: ${instanceName}`);
  if (port !== null) log(`Port: ${port}`);
  if (resolvedAgentName) log(`Agent name: ${resolvedAgentName}`);
  const ctx = {
    ...createAdapterContext(state.commsDir, repoRoot),
    instanceId,
    agentName: resolvedAgentName ?? undefined,
  };
  const warnings: string[] = [];

  // 1. Probe
  log("Probing runtime...");
  const probe = await adapter.probe(ctx);

  if (!probe.installed) {
    return {
      ok: false,
      command: "add",
      runtime,
      instanceId,
      code: "TAP_RUNTIME_NOT_FOUND",
      message: `${runtime} runtime not found.`,
      warnings: probe.warnings,
      data: { issues: probe.issues },
    };
  }

  logSuccess(`Found ${runtime} (${probe.runtimeCommand ?? "unknown"})`);
  if (probe.configPath) log(`Config: ${probe.configPath}`);
  warnings.push(...probe.warnings);
  for (const w of probe.warnings) logWarn(w);

  // 2. Plan
  log("Planning patches...");
  const plan = await adapter.plan(ctx, probe);
  warnings.push(...plan.warnings);

  if (plan.conflicts.length > 0) {
    logWarn("Conflicts detected:");
    for (const c of plan.conflicts) logWarn(`  ${c}`);
  }

  log(`Operations: ${plan.operations.length}`);
  log(`Artifacts:  ${plan.ownedArtifacts.length}`);
  for (const w of plan.warnings) logWarn(w);

  // 3. Check for no-op plan
  if (plan.operations.length === 0) {
    const failureMessage =
      probe.issues[0] ??
      plan.warnings[0] ??
      probe.warnings[0] ??
      "No operations to apply. Runtime not configured.";
    const failureCode = /MCP server/i.test(failureMessage)
      ? "TAP_LOCAL_SERVER_MISSING"
      : "TAP_PATCH_FAILED";

    return {
      ok: false,
      command: "add",
      runtime,
      instanceId,
      code: failureCode,
      message: failureMessage,
      warnings,
      data: { planOps: 0 },
    };
  }

  // 4. Backup
  const backupDir = ensureBackupDir(ctx.stateDir, instanceId);
  log(`Backup dir: ${backupDir}`);

  // 5. Apply
  log("Applying patches...");
  const result = await adapter.apply(ctx, plan);
  warnings.push(...result.warnings);

  if (!result.success) {
    return {
      ok: false,
      command: "add",
      runtime,
      instanceId,
      code: "TAP_PATCH_FAILED",
      message: "Failed to apply patches.",
      warnings,
      data: { appliedOps: result.appliedOps },
    };
  }

  logSuccess(`Applied ${result.appliedOps} operation(s)`);
  for (const f of result.changedFiles) logSuccess(`Modified: ${f}`);
  for (const w of result.warnings) logWarn(w);

  // 6. Verify
  log("Verifying...");
  const verify = await adapter.verify(ctx, plan);
  warnings.push(...verify.warnings);

  for (const check of verify.checks) {
    if (check.passed) {
      logSuccess(`${check.name}`);
    } else {
      logError(`${check.name}: ${check.message ?? "failed"}`);
    }
  }

  if (!verify.ok) {
    logWarn(
      "Verification had failures. Runtime may need manual configuration.",
    );
  }

  // 7. Start bridge if needed (app-server mode only)
  let bridge: BridgeState | null = null;
  let effectivePort = port;
  if (mode === "app-server") {
    const bridgeScript = adapter.resolveBridgeScript?.(ctx);
    if (!bridgeScript) {
      logWarn("Bridge script not found. Bridge not started.");
      warnings.push("Bridge script not found. Run bridge manually.");
    } else {
      const { config: resolvedCfg } = resolveConfig({}, repoRoot);
      // Auto-assign a free port for managed codex instances without --port
      if (effectivePort == null && runtime === "codex") {
        const currentState = loadState(repoRoot);
        effectivePort = await findNextAvailableAppServerPort(
          currentState,
          resolvedCfg.appServerUrl,
          4501,
          instanceId,
        );
        log(`Auto-assigned port ${effectivePort} for ${instanceId}`);
      }
      log(`Starting bridge: ${bridgeScript}`);
      try {
        const manageAppServer = runtime === "codex";
        bridge = await startBridge({
          instanceId,
          runtime,
          stateDir: ctx.stateDir,
          commsDir: ctx.commsDir,
          bridgeScript,
          platform: ctx.platform,
          agentName: resolvedAgentName ?? undefined,
          runtimeCommand: resolvedCfg.runtimeCommand,
          appServerUrl: resolvedCfg.appServerUrl,
          repoRoot,
          port: effectivePort ?? undefined,
          manageAppServer,
          headless,
        });
        logSuccess(`Bridge started (PID: ${bridge.pid})`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logWarn(`Bridge not started: ${msg}`);
        warnings.push(`Bridge not started: ${msg}`);
      }
    }
  }

  // 8. Save state
  const instanceState = {
    instanceId,
    runtime,
    agentName: resolvedAgentName,
    port: effectivePort,
    installed: true,
    configPath: probe.configPath ?? "",
    bridgeMode: mode,
    restartRequired: result.restartRequired,
    ownedArtifacts: result.ownedArtifacts,
    backupPath: backupDir,
    lastAppliedHash: result.lastAppliedHash,
    lastVerifiedAt: verify.ok ? new Date().toISOString() : null,
    bridge,
    manageAppServer: runtime === "codex",
    noAuth: false,
    headless,
    warnings: Array.from(new Set([...result.warnings, ...verify.warnings])),
  };

  const newState = updateInstanceState(state, instanceId, instanceState);
  saveState(repoRoot, newState);
  logSuccess("State saved");

  if (result.restartRequired) {
    logWarn(`Restart ${runtime} to pick up the new configuration.`);
  }

  // Claude-specific: real-time notification hint
  if (runtime === "claude") {
    log("");
    log("For real-time notifications:");
    log("  claude --dangerously-load-development-channels server:tap-comms");
    log("Or polling mode (tools still work):");
    log("  claude");
  }

  logHeader("Done!");

  return {
    ok: true,
    command: "add",
    runtime,
    instanceId,
    code: "TAP_ADD_OK",
    message: `${instanceId} configured`,
    warnings,
    data: {
      appliedOps: result.appliedOps,
      restartRequired: result.restartRequired,
      changedFiles: result.changedFiles,
      verified: verify.ok,
    },
  };
}
