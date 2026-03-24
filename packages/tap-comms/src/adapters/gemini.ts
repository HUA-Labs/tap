import * as fs from "node:fs";
import * as path from "node:path";
import { backupFile, ensureBackupDir, fileHash } from "../state.js";
import { artifactBackupPath, writeArtifactBackup } from "../artifact-backups.js";
import type {
  AdapterContext,
  ApplyResult,
  BridgeMode,
  OwnedArtifact,
  PatchOp,
  PatchPlan,
  ProbeResult,
  RuntimeAdapter,
  VerifyCheck,
  VerifyResult,
} from "../types.js";
import {
  buildManagedMcpServerSpec,
  canWriteOrCreate,
  getHomeDir,
  probeCommand,
} from "./common.js";

const GEMINI_SELECTOR = "mcpServers.tap-comms";

function candidateConfigPaths(ctx: AdapterContext): string[] {
  const home = getHomeDir();
  return [
    path.join(ctx.repoRoot, ".gemini", "settings.json"),
    path.join(home, ".gemini", "settings.json"),
    path.join(home, ".gemini", "antigravity", "mcp_config.json"),
  ];
}

function chooseGeminiConfigPath(ctx: AdapterContext): string {
  const [workspaceConfig, homeConfig, antigravityConfig] = candidateConfigPaths(ctx);

  if (fs.existsSync(workspaceConfig)) return workspaceConfig;
  if (fs.existsSync(homeConfig)) return homeConfig;

  if (fs.existsSync(antigravityConfig)) {
    const raw = fs.readFileSync(antigravityConfig, "utf-8").trim();
    if (raw) {
      try {
        JSON.parse(raw);
        return antigravityConfig;
      } catch {
        // Fall through to workspace-managed config.
      }
    }
  }

  return workspaceConfig;
}

function readJsonFile(filePath: string): Record<string, unknown> {
  if (!fs.existsSync(filePath)) return {};
  const raw = fs.readFileSync(filePath, "utf-8").trim();
  if (!raw) return {};
  return JSON.parse(raw) as Record<string, unknown>;
}

function setNestedKey(
  obj: Record<string, unknown>,
  keyPath: string,
  value: unknown,
): void {
  const keys = keyPath.split(".");
  let current = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (typeof current[key] !== "object" || current[key] === null) {
      current[key] = {};
    }
    current = current[key] as Record<string, unknown>;
  }
  current[keys[keys.length - 1]] = value;
}

function readNestedKey(obj: Record<string, unknown>, keyPath: string): unknown {
  let current: unknown = obj;
  for (const key of keyPath.split(".")) {
    if (typeof current !== "object" || current === null || !(key in current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function verifyGeminiConfig(
  config: Record<string, unknown>,
  configPath: string,
  ctx: AdapterContext,
): VerifyCheck[] {
  const checks: VerifyCheck[] = [];
  const entry = readNestedKey(config, GEMINI_SELECTOR) as Record<string, unknown> | undefined;

  checks.push({
    name: "Gemini config exists",
    passed: fs.existsSync(configPath),
    message: fs.existsSync(configPath) ? undefined : `${configPath} not found`,
  });
  checks.push({
    name: "tap-comms entry present",
    passed: !!entry,
    message: entry ? undefined : `${GEMINI_SELECTOR} not found`,
  });
  checks.push({
    name: "Comms directory exists",
    passed: fs.existsSync(ctx.commsDir),
    message: fs.existsSync(ctx.commsDir) ? undefined : `${ctx.commsDir} not found`,
  });

  if (entry?.env && typeof entry.env === "object") {
    checks.push({
      name: "TAP_COMMS_DIR configured",
      passed:
        (entry.env as Record<string, unknown>).TAP_COMMS_DIR ===
        ctx.commsDir.replace(/\\/g, "/"),
      message: `Expected ${ctx.commsDir.replace(/\\/g, "/")}`,
    });
  }

  return checks;
}

export const geminiAdapter: RuntimeAdapter = {
  runtime: "gemini",

  async probe(ctx: AdapterContext): Promise<ProbeResult> {
    const warnings: string[] = [];
    const issues: string[] = [];
    const configPath = chooseGeminiConfigPath(ctx);
    const configExists = fs.existsSync(configPath);
    const runtimeProbe = probeCommand(
      ctx.platform === "win32" ? ["gemini", "gemini.cmd"] : ["gemini"],
    );

    if (!runtimeProbe.command) {
      warnings.push(
        "Gemini CLI not found in PATH. Config can still be written, but runtime verification will be limited.",
      );
    }

    if (!fs.existsSync(ctx.commsDir)) {
      issues.push(`Comms directory not found: ${ctx.commsDir}. Run "init" first.`);
    }

    const managed = buildManagedMcpServerSpec(ctx);
    warnings.push(...managed.warnings);
    issues.push(...managed.issues);

    return {
      installed: true,
      configPath,
      configExists,
      runtimeCommand: runtimeProbe.command,
      version: runtimeProbe.version,
      canWrite: canWriteOrCreate(configPath),
      warnings,
      issues,
    };
  },

  async plan(ctx: AdapterContext, probe: ProbeResult): Promise<PatchPlan> {
    const configPath = probe.configPath ?? chooseGeminiConfigPath(ctx);
    const conflicts: string[] = [];
    const warnings: string[] = [];
    const operations: PatchOp[] = [];
    const ownedArtifacts: OwnedArtifact[] = [
      { kind: "json-path", path: configPath, selector: GEMINI_SELECTOR },
    ];

    if (probe.configExists) {
      try {
        const config = readJsonFile(configPath);
        if (readNestedKey(config, GEMINI_SELECTOR) !== undefined) {
          conflicts.push(`Existing ${GEMINI_SELECTOR} entry will be updated.`);
        }
      } catch {
        warnings.push(`${configPath} exists but is not valid JSON. It will be replaced.`);
      }
    }

    operations.push({
      type: probe.configExists ? "merge" : "set",
      path: configPath,
      key: GEMINI_SELECTOR,
    });

    return {
      runtime: "gemini",
      operations,
      ownedArtifacts,
      backupDir: ensureBackupDir(ctx.stateDir, "gemini"),
      restartRequired: true,
      conflicts,
      warnings,
    };
  },

  async apply(ctx: AdapterContext, plan: PatchPlan): Promise<ApplyResult> {
    const configPath = plan.operations[0]?.path ?? chooseGeminiConfigPath(ctx);
    const warnings: string[] = [];
    const changedFiles: string[] = [];
    const managed = buildManagedMcpServerSpec(ctx);

    warnings.push(...managed.warnings);
    if (managed.issues.length > 0 || !managed.command) {
      return {
        success: false,
        appliedOps: 0,
        backupCreated: false,
        lastAppliedHash: "",
        ownedArtifacts: [],
        changedFiles,
        restartRequired: false,
        warnings: [...managed.warnings, ...managed.issues],
      };
    }

    let config: Record<string, unknown> = {};
    let previousValue: unknown = undefined;

    if (fs.existsSync(configPath)) {
      if (fs.readFileSync(configPath, "utf-8").trim()) {
        backupFile(configPath, plan.backupDir);
      }
      try {
        config = readJsonFile(configPath);
      } catch {
        warnings.push(`${configPath} was invalid JSON. Created backup and starting fresh.`);
        config = {};
      }
      previousValue = readNestedKey(config, GEMINI_SELECTOR);
    }

    const artifact = plan.ownedArtifacts[0];
    const backupPath = artifactBackupPath(plan.backupDir, artifact.kind, artifact.selector);
    writeArtifactBackup(backupPath, {
      kind: "json-path",
      selector: artifact.selector,
      existed: previousValue !== undefined,
      value: previousValue,
    });

    setNestedKey(config, GEMINI_SELECTOR, {
      command: managed.command,
      args: managed.args,
      env: managed.env,
    });

    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    const tmp = `${configPath}.tmp.${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(config, null, 2) + "\n", "utf-8");
    fs.renameSync(tmp, configPath);
    changedFiles.push(configPath);

    return {
      success: true,
      appliedOps: plan.operations.length,
      backupCreated: true,
      lastAppliedHash: fileHash(configPath),
      ownedArtifacts: [{ ...artifact, backupPath }],
      changedFiles,
      restartRequired: true,
      warnings,
    };
  },

  async verify(ctx: AdapterContext, plan: PatchPlan): Promise<VerifyResult> {
    const warnings: string[] = [];
    const configPath = plan.operations[0]?.path ?? chooseGeminiConfigPath(ctx);
    const runtimeProbe = probeCommand(
      ctx.platform === "win32" ? ["gemini", "gemini.cmd"] : ["gemini"],
    );

    let checks: VerifyCheck[];
    try {
      const config = readJsonFile(configPath);
      checks = verifyGeminiConfig(config, configPath, ctx);
    } catch {
      checks = [
        {
          name: "Gemini config is valid JSON",
          passed: false,
          message: "Parse error",
        },
      ];
    }

    checks.push({
      name: "Gemini CLI found",
      passed: !!runtimeProbe.command,
      message: runtimeProbe.command ? undefined : "gemini not in PATH (non-blocking)",
    });

    if (!runtimeProbe.command) {
      warnings.push(
        "Gemini CLI not in PATH. Config is written, but runtime verification is partial.",
      );
    }

    return {
      ok: checks.filter((check) => check.name !== "Gemini CLI found").every((check) => check.passed),
      checks,
      restartRequired: true,
      warnings,
    };
  },

  bridgeMode(): BridgeMode {
    return "polling";
  },
};
