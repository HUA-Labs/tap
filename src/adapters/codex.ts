import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { backupFile, ensureBackupDir, fileHash } from "../state.js";
import {
  artifactBackupPath,
  writeArtifactBackup,
} from "../artifact-backups.js";
import {
  extractTomlTable,
  parseTomlAssignments,
  removeTomlTable,
  renderTomlTable,
  replaceTomlTable,
} from "../toml.js";
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
import type { ManagedMcpServerSpec } from "./common.js";

const MCP_SELECTOR = "mcp_servers.tap";
const ENV_SELECTOR = "mcp_servers.tap.env";
const SESSION_NEUTRAL_AGENT_NAME = "<set-per-session>";

// Legacy key names — used for auto-migration from pre-0.3 configs
const OLD_MCP_SELECTOR = "mcp_servers.tap-comms";
const OLD_ENV_SELECTOR = "mcp_servers.tap-comms.env";

function findCodexConfigPath(): string {
  return path.join(getHomeDir(), ".codex", "config.toml");
}

function canonicalizeTrustPath(targetPath: string): string {
  let resolved = path.resolve(targetPath).replace(/\//g, "\\");
  const driveRoot = /^[A-Za-z]:\\$/;
  if (!driveRoot.test(resolved)) {
    resolved = resolved.replace(/\\+$/g, "");
  }
  return resolved.startsWith("\\\\?\\") ? resolved : `\\\\?\\${resolved}`;
}

function trustSelector(targetPath: string): string {
  return `projects.'${canonicalizeTrustPath(targetPath)}'`;
}

function getTrustTargets(ctx: AdapterContext): string[] {
  const targets = [ctx.repoRoot, process.cwd()];
  return [...new Set(targets.map((value) => path.resolve(value)))];
}

function buildManagedArtifacts(
  configPath: string,
  ctx: AdapterContext,
): OwnedArtifact[] {
  const artifacts: OwnedArtifact[] = [
    { kind: "toml-table", path: configPath, selector: MCP_SELECTOR },
    { kind: "toml-table", path: configPath, selector: ENV_SELECTOR },
  ];

  for (const target of getTrustTargets(ctx)) {
    artifacts.push({
      kind: "toml-table",
      path: configPath,
      selector: trustSelector(target),
    });
  }

  return artifacts;
}

function readConfigOrEmpty(configPath: string): string {
  if (!fs.existsSync(configPath)) return "";
  return fs.readFileSync(configPath, "utf-8");
}

function writeTomlFile(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, content, "utf-8");
  fs.renameSync(tmp, filePath);
}

function buildSessionNeutralCodexSpec(
  ctx: AdapterContext,
): ManagedMcpServerSpec {
  const managed = buildManagedMcpServerSpec(ctx);
  const env: Record<string, string> = {
    ...managed.env,
    TAP_AGENT_NAME: SESSION_NEUTRAL_AGENT_NAME,
  };
  delete env.TAP_AGENT_ID;
  return { ...managed, env };
}

function buildCodexEnvEntries(
  existingTable: string | null,
  managedEnv: Record<string, string | string[]>,
): Record<string, string | string[]> {
  const preservedEnv = parseTomlAssignments(existingTable ?? "");
  delete preservedEnv.TAP_AGENT_ID;
  return {
    ...preservedEnv,
    ...managedEnv,
  };
}

function verifyManagedToml(
  content: string,
  ctx: AdapterContext,
  configPath: string,
): VerifyCheck[] {
  const checks: VerifyCheck[] = [];
  const managed = buildSessionNeutralCodexSpec(ctx);
  const mainTable = extractTomlTable(content, MCP_SELECTOR);
  const envTable = extractTomlTable(content, ENV_SELECTOR);

  checks.push({
    name: "Codex config exists",
    passed: fs.existsSync(configPath),
    message: fs.existsSync(configPath) ? undefined : `${configPath} not found`,
  });
  checks.push({
    name: "tap MCP table present",
    passed: !!mainTable,
    message: mainTable ? undefined : `${MCP_SELECTOR} not found`,
  });
  checks.push({
    name: "tap env table present",
    passed: !!envTable,
    message: envTable ? undefined : `${ENV_SELECTOR} not found`,
  });

  for (const target of getTrustTargets(ctx)) {
    const selector = trustSelector(target);
    const trustTable = extractTomlTable(content, selector);
    checks.push({
      name: `Trust table present: ${canonicalizeTrustPath(target)}`,
      passed: !!trustTable && trustTable.includes('trust_level = "trusted"'),
      message:
        trustTable && trustTable.includes('trust_level = "trusted"')
          ? undefined
          : `${selector} missing trust_level = "trusted"`,
    });
  }

  if (mainTable && managed.command) {
    const expectedArgs = managed.args
      .map((a) => `"${a.replace(/\\/g, "\\\\")}"`)
      .join(", ");
    checks.push({
      name: "Managed command configured",
      passed:
        mainTable.includes(
          `command = "${managed.command.replace(/\\/g, "\\\\")}"`,
        ) && mainTable.includes(`args = [${expectedArgs}]`),
      message: "Managed tap command/args do not match expected values",
    });
  }

  if (mainTable) {
    const mainValues = parseTomlAssignments(mainTable);
    checks.push({
      name: "approval_mode is auto",
      passed: mainValues.approval_mode === "auto",
      message: mainValues.approval_mode
        ? `approval_mode is "${mainValues.approval_mode}", expected "auto"`
        : 'approval_mode missing, expected "auto"',
    });
  }

  if (envTable) {
    const envValues = parseTomlAssignments(envTable);
    checks.push({
      name: "Managed TAP_AGENT_NAME is session-neutral",
      passed: envValues.TAP_AGENT_NAME === managed.env.TAP_AGENT_NAME,
      message: `TAP_AGENT_NAME should be "${SESSION_NEUTRAL_AGENT_NAME}"`,
    });
    checks.push({
      name: "Managed TAP_AGENT_ID is omitted",
      passed: typeof envValues.TAP_AGENT_ID !== "string",
      message: "TAP_AGENT_ID should not be persisted in Codex config",
    });
  }

  return checks;
}

export const codexAdapter: RuntimeAdapter = {
  runtime: "codex",

  async probe(ctx: AdapterContext): Promise<ProbeResult> {
    const warnings: string[] = [];
    const issues: string[] = [];
    const configPath = findCodexConfigPath();
    const configExists = fs.existsSync(configPath);
    const runtimeProbe = probeCommand(
      ctx.platform === "win32" ? ["codex", "codex.cmd"] : ["codex"],
    );

    if (!runtimeProbe.command) {
      warnings.push(
        "Codex CLI not found in PATH. Config can still be written, but runtime verification will be limited.",
      );
    }

    if (!fs.existsSync(ctx.commsDir)) {
      issues.push(
        `Comms directory not found: ${ctx.commsDir}. Run "init" first.`,
      );
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
    const configPath = probe.configPath ?? findCodexConfigPath();
    const conflicts: string[] = [];
    const warnings: string[] = [];
    const operations: PatchOp[] = [];
    const ownedArtifacts = buildManagedArtifacts(configPath, ctx);

    if (probe.configExists) {
      const content = readConfigOrEmpty(configPath);
      if (extractTomlTable(content, MCP_SELECTOR)) {
        conflicts.push(`Existing ${MCP_SELECTOR} table will be updated.`);
      }
      if (extractTomlTable(content, OLD_MCP_SELECTOR)) {
        conflicts.push(
          `Legacy ${OLD_MCP_SELECTOR} table will be migrated to ${MCP_SELECTOR}.`,
        );
      }
      if (extractTomlTable(content, ENV_SELECTOR)) {
        conflicts.push(`Existing ${ENV_SELECTOR} table will be updated.`);
      }
      for (const target of getTrustTargets(ctx)) {
        const selector = trustSelector(target);
        if (extractTomlTable(content, selector)) {
          conflicts.push(`Existing ${selector} table will be updated.`);
        }
      }
    }

    for (const artifact of ownedArtifacts) {
      operations.push({
        type: probe.configExists ? "merge" : "set",
        path: configPath,
        key: artifact.selector,
      });
    }

    return {
      runtime: "codex",
      operations,
      ownedArtifacts,
      backupDir: ensureBackupDir(ctx.stateDir, "codex"),
      restartRequired: true,
      conflicts,
      warnings,
    };
  },

  async apply(ctx: AdapterContext, plan: PatchPlan): Promise<ApplyResult> {
    const configPath = plan.operations[0]?.path ?? findCodexConfigPath();
    const warnings: string[] = [];
    const changedFiles: string[] = [];
    const managed = buildSessionNeutralCodexSpec(ctx);

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

    const existingContent = readConfigOrEmpty(configPath);
    if (fs.existsSync(configPath) && existingContent) {
      backupFile(configPath, plan.backupDir);
    }

    const artifactsWithBackups = plan.ownedArtifacts.map((artifact) => {
      const previousContent =
        artifact.kind === "toml-table"
          ? extractTomlTable(existingContent, artifact.selector)
          : null;
      const backupPath = artifactBackupPath(
        plan.backupDir,
        artifact.kind,
        artifact.selector,
      );

      writeArtifactBackup(backupPath, {
        kind: "toml-table",
        selector: artifact.selector,
        existed: previousContent !== null,
        content: previousContent ?? undefined,
      });

      return { ...artifact, backupPath };
    });

    let nextContent = existingContent;

    // Migrate: remove legacy "tap-comms" keys if present
    if (extractTomlTable(nextContent, OLD_ENV_SELECTOR)) {
      nextContent = removeTomlTable(nextContent, OLD_ENV_SELECTOR);
    }
    if (extractTomlTable(nextContent, OLD_MCP_SELECTOR)) {
      nextContent = removeTomlTable(nextContent, OLD_MCP_SELECTOR);
    }

    nextContent = replaceTomlTable(
      nextContent,
      MCP_SELECTOR,
      renderTomlTable(
        MCP_SELECTOR,
        {
          command: managed.command,
          args: managed.args,
          approval_mode: "auto",
        },
        extractTomlTable(existingContent, MCP_SELECTOR),
      ),
    );
    nextContent = replaceTomlTable(
      nextContent,
      ENV_SELECTOR,
      renderTomlTable(
        ENV_SELECTOR,
        buildCodexEnvEntries(
          extractTomlTable(existingContent, ENV_SELECTOR),
          managed.env,
        ),
      ),
    );

    for (const target of getTrustTargets(ctx)) {
      const selector = trustSelector(target);
      nextContent = replaceTomlTable(
        nextContent,
        selector,
        renderTomlTable(
          selector,
          { trust_level: "trusted" },
          extractTomlTable(existingContent, selector),
        ),
      );
    }

    writeTomlFile(configPath, nextContent);
    changedFiles.push(configPath);

    return {
      success: true,
      appliedOps: plan.operations.length,
      backupCreated: true,
      lastAppliedHash: fileHash(configPath),
      ownedArtifacts: artifactsWithBackups,
      changedFiles,
      restartRequired: true,
      warnings,
    };
  },

  async verify(ctx: AdapterContext, plan: PatchPlan): Promise<VerifyResult> {
    const warnings: string[] = [];
    const configPath = plan.operations[0]?.path ?? findCodexConfigPath();
    const content = readConfigOrEmpty(configPath);
    const runtimeProbe = probeCommand(
      ctx.platform === "win32" ? ["codex", "codex.cmd"] : ["codex"],
    );

    const checks = verifyManagedToml(content, ctx, configPath);
    checks.push({
      name: "Comms directory exists",
      passed: fs.existsSync(ctx.commsDir),
      message: fs.existsSync(ctx.commsDir)
        ? undefined
        : `${ctx.commsDir} not found`,
    });
    checks.push({
      name: "Codex CLI found",
      passed: !!runtimeProbe.command,
      message: runtimeProbe.command
        ? undefined
        : "codex not in PATH (non-blocking)",
    });

    if (!runtimeProbe.command) {
      warnings.push(
        "Codex CLI not in PATH. Config is written, but runtime verification is partial.",
      );
    }

    return {
      ok: checks
        .filter((check) => check.name !== "Codex CLI found")
        .every((check) => check.passed),
      checks,
      restartRequired: true,
      warnings,
    };
  },

  bridgeMode(): BridgeMode {
    return "app-server";
  },

  resolveBridgeScript(ctx: AdapterContext): string | null {
    const distDir = path.dirname(fileURLToPath(import.meta.url));
    const candidates = [
      // 1. Relative to bundled CLI (npm install / npx)
      path.join(distDir, "bridges", "codex-bridge-runner.mjs"),
      // 2. Monorepo development — dist inside repo
      path.join(
        ctx.repoRoot,
        "packages",
        "tap-comms",
        "dist",
        "bridges",
        "codex-bridge-runner.mjs",
      ),
      // 3. Source file — dev mode with strip-types
      path.join(
        ctx.repoRoot,
        "packages",
        "tap-comms",
        "src",
        "bridges",
        "codex-bridge-runner.ts",
      ),
    ];

    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) return candidate;
    }

    return null;
  },
};

// ─── Public helpers ──────────────────────────────────────────

/**
 * Ensure Codex config.toml has approval_mode = "auto" for the tap MCP server.
 * Codex resets this to "approve" on session restart, so we re-patch before
 * bridge startup. Only patches when [mcp_servers.tap] already exists
 * (i.e. tap was previously added to this Codex installation).
 *
 * Returns the config path if patched, null otherwise.
 */
export function patchCodexApprovalMode(): string | null {
  const configPath = findCodexConfigPath();
  if (!fs.existsSync(configPath)) return null;

  const content = fs.readFileSync(configPath, "utf-8");
  const tapTable = extractTomlTable(content, MCP_SELECTOR);
  if (!tapTable) return null;

  const values = parseTomlAssignments(tapTable);
  if (values.approval_mode === "auto") return null;

  const patched = replaceTomlTable(
    content,
    MCP_SELECTOR,
    renderTomlTable(MCP_SELECTOR, { approval_mode: "auto" }, tapTable),
  );

  writeTomlFile(configPath, patched);
  return configPath;
}
