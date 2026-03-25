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

const MCP_SELECTOR = "mcp_servers.tap-comms";
const ENV_SELECTOR = "mcp_servers.tap-comms.env";

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

function verifyManagedToml(
  content: string,
  ctx: AdapterContext,
  configPath: string,
): VerifyCheck[] {
  const checks: VerifyCheck[] = [];
  const managed = buildManagedMcpServerSpec(ctx);
  const mainTable = extractTomlTable(content, MCP_SELECTOR);
  const envTable = extractTomlTable(content, ENV_SELECTOR);

  checks.push({
    name: "Codex config exists",
    passed: fs.existsSync(configPath),
    message: fs.existsSync(configPath) ? undefined : `${configPath} not found`,
  });
  checks.push({
    name: "tap-comms MCP table present",
    passed: !!mainTable,
    message: mainTable ? undefined : `${MCP_SELECTOR} not found`,
  });
  checks.push({
    name: "tap-comms env table present",
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
    checks.push({
      name: "Managed command configured",
      passed:
        mainTable.includes(
          `command = "${managed.command.replace(/\\/g, "\\\\")}"`,
        ) &&
        mainTable.includes(
          `args = ["${managed.args[0]?.replace(/\\/g, "\\\\") ?? ""}"]`,
        ),
      message: "Managed tap-comms command/args do not match expected values",
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
    const managed = buildManagedMcpServerSpec(ctx, ctx.instanceId);

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
    nextContent = replaceTomlTable(
      nextContent,
      MCP_SELECTOR,
      renderTomlTable(
        MCP_SELECTOR,
        {
          command: managed.command,
          args: managed.args,
        },
        extractTomlTable(existingContent, MCP_SELECTOR),
      ),
    );
    nextContent = replaceTomlTable(
      nextContent,
      ENV_SELECTOR,
      renderTomlTable(
        ENV_SELECTOR,
        managed.env,
        extractTomlTable(existingContent, ENV_SELECTOR),
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
