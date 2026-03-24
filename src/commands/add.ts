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
import { startBridge } from "../engine/bridge.js";
import { resolveConfig } from "../config/index.js";
import type {
  RuntimeName,
  BridgeState,
  HeadlessConfig,
  AgentRole,
  CommandResult,
} from "../types.js";

export async function addCommand(args: string[]): Promise<CommandResult> {
  const { positional, flags } = parseArgs(args);
  const runtimeArg = positional[0];

  if (!runtimeArg) {
    return {
      ok: false,
      command: "add",
      code: "TAP_INVALID_ARGUMENT",
      message:
        "Missing runtime argument. Usage: npx @hua-labs/tap add <claude|codex|gemini> [--name <name>] [--port <port>] [--headless] [--role <role>]",
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
  const port = portStr ? parseInt(portStr, 10) : null;
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

  if (portStr && (port === null || isNaN(port))) {
    return {
      ok: false,
      command: "add",
      runtime,
      instanceId,
      code: "TAP_INVALID_ARGUMENT",
      message: `Invalid port: ${portStr}`,
      warnings: [],
      data: {},
    };
  }

  const repoRoot = findRepoRoot();
  const state = loadState(repoRoot);

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

  if (state.instances[instanceId]?.installed && !force) {
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

  const ctx = createAdapterContext(state.commsDir, repoRoot);
  const adapter = getAdapter(runtime);
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
    return {
      ok: true,
      command: "add",
      runtime,
      instanceId,
      code: "TAP_NO_OP",
      message: "No operations to apply. Runtime not configured.",
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
  const mode = adapter.bridgeMode();

  if (mode === "app-server") {
    const bridgeScript = adapter.resolveBridgeScript?.(ctx);
    if (!bridgeScript) {
      logWarn("Bridge script not found. Bridge not started.");
      warnings.push("Bridge script not found. Run bridge manually.");
    } else {
      const agentNameEnv =
        process.env.TAP_AGENT_NAME || process.env.CODEX_TAP_AGENT_NAME;
      if (!agentNameEnv) {
        logWarn(
          "No agent name set (TAP_AGENT_NAME). Bridge not started. " +
            "Use: npx @hua-labs/tap bridge start <instance> --agent-name <name>",
        );
        warnings.push("Bridge not auto-started: no agent name available.");
      } else {
        const { config: resolvedCfg } = resolveConfig({}, repoRoot);
        log(`Starting bridge: ${bridgeScript}`);
        try {
          bridge = await startBridge({
            instanceId,
            runtime,
            stateDir: ctx.stateDir,
            commsDir: ctx.commsDir,
            bridgeScript,
            platform: ctx.platform,
            agentName: agentNameEnv,
            runtimeCommand: resolvedCfg.runtimeCommand,
            appServerUrl: resolvedCfg.appServerUrl,
            repoRoot,
            port: port ?? undefined,
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
  }

  // 8. Save state
  const instanceState = {
    instanceId,
    runtime,
    agentName: null,
    port,
    installed: true,
    configPath: probe.configPath ?? "",
    bridgeMode: mode,
    restartRequired: result.restartRequired,
    ownedArtifacts: result.ownedArtifacts,
    backupPath: backupDir,
    lastAppliedHash: result.lastAppliedHash,
    lastVerifiedAt: verify.ok ? new Date().toISOString() : null,
    bridge,
    headless,
    warnings: [...result.warnings, ...verify.warnings],
  };

  const newState = updateInstanceState(state, instanceId, instanceState);
  saveState(repoRoot, newState);
  logSuccess("State saved");

  if (result.restartRequired) {
    logWarn(`Restart ${runtime} to pick up the new configuration.`);
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
