import * as fs from "node:fs";
import * as path from "node:path";
import { execSync } from "node:child_process";
import { fileHash, backupFile, ensureBackupDir } from "../state.js";
import { buildManagedMcpServerSpec } from "./common.js";
import type {
  RuntimeAdapter,
  AdapterContext,
  ProbeResult,
  PatchPlan,
  ApplyResult,
  VerifyResult,
  BridgeMode,
  OwnedArtifact,
  PatchOp,
  VerifyCheck,
} from "../types.js";

const MCP_SERVER_KEY = "tap";

// Legacy key name — used for auto-migration from pre-0.3 configs
const OLD_MCP_SERVER_KEY = "tap-comms";

function findMcpJsonPath(ctx: AdapterContext): string {
  return path.join(ctx.repoRoot, ".mcp.json");
}

function findClaudeCommand(): string | null {
  try {
    execSync("claude --version", { stdio: "pipe" });
    return "claude";
  } catch {
    return null;
  }
}

function buildMcpServerEntry(
  ctx: AdapterContext,
): Record<string, unknown> | null {
  const managed = buildManagedMcpServerSpec(ctx, ctx.instanceId);
  if (!managed.command) return null;

  return {
    type: "stdio",
    command: managed.command,
    args: managed.args,
    env: managed.env,
  };
}

export const claudeAdapter: RuntimeAdapter = {
  runtime: "claude",

  async probe(ctx: AdapterContext): Promise<ProbeResult> {
    const warnings: string[] = [];
    const issues: string[] = [];

    const configPath = findMcpJsonPath(ctx);
    const configExists = fs.existsSync(configPath);
    const runtimeCommand = findClaudeCommand();
    const canWrite = configExists
      ? (() => {
          try {
            fs.accessSync(configPath, fs.constants.W_OK);
            return true;
          } catch {
            return false;
          }
        })()
      : true; // Can create new file

    if (!runtimeCommand) {
      warnings.push(
        "Claude CLI not found in PATH. Config will be created but may need manual setup.",
      );
    }

    const managed = buildManagedMcpServerSpec(ctx);
    warnings.push(...managed.warnings);
    issues.push(...managed.issues);

    // Check if comms dir exists
    if (!fs.existsSync(ctx.commsDir)) {
      issues.push(
        `Comms directory not found: ${ctx.commsDir}. Run "init" first.`,
      );
    }

    return {
      installed: true, // Claude adapter always "installed" — .mcp.json is per-project
      configPath,
      configExists,
      runtimeCommand,
      version: null,
      canWrite,
      warnings,
      issues,
    };
  },

  async plan(ctx: AdapterContext, probe: ProbeResult): Promise<PatchPlan> {
    const configPath = probe.configPath ?? findMcpJsonPath(ctx);
    const conflicts: string[] = [];
    const warnings: string[] = [];
    const operations: PatchOp[] = [];
    const ownedArtifacts: OwnedArtifact[] = [];

    // Check for existing tap entry
    if (probe.configExists) {
      const raw = fs.readFileSync(configPath, "utf-8");
      try {
        const config = JSON.parse(raw);
        if (config.mcpServers?.[MCP_SERVER_KEY]) {
          conflicts.push(
            `Existing "${MCP_SERVER_KEY}" entry in .mcp.json will be overwritten.`,
          );
        }
        if (config.mcpServers?.[OLD_MCP_SERVER_KEY]) {
          conflicts.push(
            `Legacy "${OLD_MCP_SERVER_KEY}" entry will be migrated to "${MCP_SERVER_KEY}".`,
          );
        }
      } catch {
        warnings.push(
          ".mcp.json exists but is not valid JSON. Will be overwritten.",
        );
      }
    }

    const serverEntry = buildMcpServerEntry(ctx);

    if (!serverEntry) {
      warnings.push(
        "tap MCP server entry not found. Skipping .mcp.json patch. " +
          "Reinstall @hua-labs/tap or run from a repo with packages/tap-plugin/channels/ available.",
      );
      return {
        runtime: "claude",
        operations: [],
        ownedArtifacts: [],
        backupDir: ensureBackupDir(ctx.stateDir, "claude"),
        restartRequired: false,
        conflicts,
        warnings,
      };
    }

    operations.push({
      type: probe.configExists ? "merge" : "set",
      path: configPath,
      key: `mcpServers.${MCP_SERVER_KEY}`,
      value: serverEntry,
    });

    ownedArtifacts.push({
      kind: "json-path",
      path: configPath,
      selector: `mcpServers.${MCP_SERVER_KEY}`,
    });

    const backupDir = ensureBackupDir(ctx.stateDir, "claude");

    return {
      runtime: "claude",
      operations,
      ownedArtifacts,
      backupDir,
      restartRequired: true,
      conflicts,
      warnings,
    };
  },

  async apply(_ctx: AdapterContext, plan: PatchPlan): Promise<ApplyResult> {
    const changedFiles: string[] = [];
    const warnings: string[] = [];
    let appliedOps = 0;

    for (const op of plan.operations) {
      try {
        if (op.type === "set" || op.type === "merge") {
          // Read or create .mcp.json
          let config: Record<string, unknown> = {};
          if (fs.existsSync(op.path)) {
            // Backup first
            backupFile(op.path, plan.backupDir);
            const raw = fs.readFileSync(op.path, "utf-8");
            try {
              config = JSON.parse(raw);
            } catch {
              // Invalid JSON, start fresh but backup the original
              warnings.push(
                `${op.path} was invalid JSON. Created backup and starting fresh.`,
              );
            }
          }

          // Migrate: remove legacy "tap-comms" key if present
          const servers = config.mcpServers as
            | Record<string, unknown>
            | undefined;
          if (servers?.[OLD_MCP_SERVER_KEY]) {
            delete servers[OLD_MCP_SERVER_KEY];
          }

          // Set nested key
          if (op.key) {
            setNestedKey(config, op.key, op.value);
          }

          // Write atomically
          const tmp = `${op.path}.tmp.${process.pid}`;
          fs.writeFileSync(
            tmp,
            JSON.stringify(config, null, 2) + "\n",
            "utf-8",
          );
          fs.renameSync(tmp, op.path);
          changedFiles.push(op.path);
          appliedOps++;
        }
      } catch (err) {
        warnings.push(
          `Failed to apply op on ${op.path}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    const lastAppliedHash =
      changedFiles.length > 0 ? fileHash(changedFiles[0]) : "";

    return {
      success: appliedOps > 0,
      appliedOps,
      backupCreated: true,
      lastAppliedHash,
      ownedArtifacts: plan.ownedArtifacts,
      changedFiles,
      restartRequired: plan.restartRequired,
      warnings,
    };
  },

  async verify(ctx: AdapterContext, plan: PatchPlan): Promise<VerifyResult> {
    const checks: VerifyCheck[] = [];
    const warnings: string[] = [];

    // 1. Config file exists
    const configPath = plan.operations[0]?.path;
    if (configPath) {
      checks.push({
        name: "Config file exists",
        passed: fs.existsSync(configPath),
        message: fs.existsSync(configPath)
          ? undefined
          : `${configPath} not found`,
      });

      // 2. Config is valid JSON
      if (fs.existsSync(configPath)) {
        try {
          const raw = fs.readFileSync(configPath, "utf-8");
          const config = JSON.parse(raw);
          checks.push({ name: "Config is valid JSON", passed: true });

          // 3. Managed entry present
          const entry = config.mcpServers?.[MCP_SERVER_KEY];
          checks.push({
            name: "tap entry present",
            passed: !!entry,
            message: entry
              ? undefined
              : `mcpServers.${MCP_SERVER_KEY} not found`,
          });

          // 4. Entry has correct env
          if (entry) {
            const hasCommsDir =
              normalizeTapCommsDir(entry.env?.TAP_COMMS_DIR) ===
              normalizeTapCommsDir(ctx.commsDir);
            checks.push({
              name: "TAP_COMMS_DIR configured",
              passed: hasCommsDir,
              message: hasCommsDir ? undefined : `Expected ${ctx.commsDir}`,
            });
          }
        } catch {
          checks.push({
            name: "Config is valid JSON",
            passed: false,
            message: "Parse error",
          });
        }
      }
    }

    // 5. Comms dir exists
    checks.push({
      name: "Comms directory exists",
      passed: fs.existsSync(ctx.commsDir),
      message: fs.existsSync(ctx.commsDir)
        ? undefined
        : `${ctx.commsDir} not found`,
    });

    // 6. Runtime command found
    const cmd = findClaudeCommand();
    checks.push({
      name: "Claude CLI found",
      passed: !!cmd,
      message: cmd ? undefined : "claude not in PATH (non-blocking)",
    });
    if (!cmd) {
      warnings.push(
        "Claude CLI not in PATH. Config is ready but cannot verify runtime reads it.",
      );
    }

    const ok = checks
      .filter((c) => c.name !== "Claude CLI found")
      .every((c) => c.passed);

    return { ok, checks, restartRequired: true, warnings };
  },

  bridgeMode(): BridgeMode {
    return "native-push";
  },
};

// ─── Helpers ────────────────────────────────────────────────────

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

function normalizeTapCommsDir(value: unknown): string {
  return typeof value === "string"
    ? path.resolve(value).replace(/\\/g, "/")
    : "";
}
