import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { setupCommand } from "../commands/setup.js";

let tmpDir: string;
let originalCwd: string;
const originalCodexHome = process.env.CODEX_HOME;
const originalTapCommsDir = process.env.TAP_COMMS_DIR;
const originalTapStateDir = process.env.TAP_STATE_DIR;
const originalTapAgentName = process.env.TAP_AGENT_NAME;
const originalCodexTapAgentName = process.env.CODEX_TAP_AGENT_NAME;

function validProfilePack(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: "tap-profile-pack.v0",
    packId: "example-pack",
    label: "Example Profile Pack",
    profiles: [
      {
        id: "example-cli",
        label: "Example CLI",
        runtimeSurface: "codex-cli",
        agent: "example",
        paths: {
          repoRoot: "/example/repo",
          commsDir: "/example/comms",
        },
        capabilities: {
          ready: true,
          status: true,
          apply: false,
        },
        commands: {
          ready: {
            shell: "echo profile-pack-command-sentinel",
            risk: "read-only",
            reviewRequired: true,
            defaultEnabled: false,
          },
        },
        ready: {
          surface: "codex-cli",
          commandRef: "ready",
        },
      },
    ],
    ...overrides,
  };
}

function writeProfilePack(
  filePath: string,
  overrides: Record<string, unknown> = {},
): void {
  fs.writeFileSync(
    filePath,
    `${JSON.stringify(validProfilePack(overrides), null, 2)}\n`,
    "utf8",
  );
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tap-setup-command-"));
  tmpDir = fs.realpathSync(tmpDir);
  fs.writeFileSync(path.join(tmpDir, "package.json"), "{}", "utf8");
  originalCwd = process.cwd();
  process.chdir(tmpDir);
  process.env.CODEX_HOME = path.join(tmpDir, "codex-home");
  delete process.env.TAP_COMMS_DIR;
  delete process.env.TAP_STATE_DIR;
  delete process.env.TAP_AGENT_NAME;
  delete process.env.CODEX_TAP_AGENT_NAME;
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  process.chdir(originalCwd);
  fs.rmSync(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
  if (originalCodexHome === undefined) {
    delete process.env.CODEX_HOME;
  } else {
    process.env.CODEX_HOME = originalCodexHome;
  }
  if (originalTapCommsDir === undefined) {
    delete process.env.TAP_COMMS_DIR;
  } else {
    process.env.TAP_COMMS_DIR = originalTapCommsDir;
  }
  if (originalTapStateDir === undefined) {
    delete process.env.TAP_STATE_DIR;
  } else {
    process.env.TAP_STATE_DIR = originalTapStateDir;
  }
  if (originalTapAgentName === undefined) {
    delete process.env.TAP_AGENT_NAME;
  } else {
    process.env.TAP_AGENT_NAME = originalTapAgentName;
  }
  if (originalCodexTapAgentName === undefined) {
    delete process.env.CODEX_TAP_AGENT_NAME;
  } else {
    process.env.CODEX_TAP_AGENT_NAME = originalCodexTapAgentName;
  }
});

describe("setupCommand", () => {
  it("describes setup apply as guarded directory, state, and .mcp.json mutation", async () => {
    const result = await setupCommand(["--help"]);

    expect(result.ok).toBe(true);
    expect(result.message).toContain(
      "Create reviewed setup directories, initial state, and guarded tap-managed repo .mcp.json changes.",
    );
    expect(result.message).not.toContain("preview config edits");
  });

  it("returns a read-only codex-cli dry-run report with stable config targets", async () => {
    fs.writeFileSync(path.join(tmpDir, ".mcp.json"), "{}\n", "utf8");
    fs.mkdirSync(process.env.CODEX_HOME!, { recursive: true });
    fs.writeFileSync(
      path.join(process.env.CODEX_HOME!, "config.toml"),
      "# codex config\n",
      "utf8",
    );

    const result = await setupCommand(["--profile", "codex-cli"]);

    expect(result.ok).toBe(true);
    expect(result.code).toBe("TAP_SETUP_OK");
    expect(result.data).toMatchObject({
      command: "setup",
      profile: "codex-cli",
      dryRun: true,
      apply: false,
      status: "partial",
      environment: {
        cwd: tmpDir,
        repoRoot: tmpDir,
        packageVersion: expect.any(String),
        mcpConfigTargets: expect.arrayContaining([
          expect.objectContaining({
            kind: "repo-mcp",
            runtime: "codex-cli",
            path: path.join(tmpDir, ".mcp.json"),
            exists: true,
            status: "unmanaged",
            managedByTap: false,
          }),
          expect.objectContaining({
            kind: "codex-config",
            runtime: "codex-cli",
            path: path.join(process.env.CODEX_HOME!, "config.toml"),
            exists: true,
            status: "unmanaged",
            managedByTap: false,
          }),
        ]),
      },
      phases: expect.arrayContaining([
        expect.objectContaining({ id: "config" }),
        expect.objectContaining({ id: "permissions" }),
        expect.objectContaining({ id: "identity" }),
        expect.objectContaining({ id: "warmup" }),
        expect.objectContaining({ id: "runtime" }),
        expect.objectContaining({ id: "receive" }),
        expect.objectContaining({ id: "status" }),
        expect.objectContaining({ id: "delivery" }),
        expect.objectContaining({ id: "doctor" }),
      ]),
    });
    expect(result.data.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "start-receiver-explicitly",
          risk: "process-start",
          defaultEnabled: false,
          appliesWith: "future-explicit-flag",
        }),
      ]),
    );
    expect(result.data.nextActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "apply-reviewed-setup",
          command: "tap setup --profile codex-cli --apply --json",
          risk: "config-edit",
          reviewRequired: true,
          defaultEnabled: false,
        }),
        expect.objectContaining({
          id: "run-setup-doctor",
          command: "tap doctor --setup --profile codex-cli --json",
          risk: "read-only",
        }),
        expect.objectContaining({
          id: "run-status",
          command: "tap status --json",
        }),
        expect.objectContaining({
          id: "run-comms-doctor",
          command: "tap comms-doctor --json",
        }),
        expect.objectContaining({
          id: "provide-agent-for-receiver-check",
          command: undefined,
        }),
      ]),
    );
    const nextActionCommands = (
      result.data as { nextActions: Array<{ command?: string }> }
    ).nextActions
      .map((action) => action.command)
      .filter((command): command is string => Boolean(command));
    expect(nextActionCommands.join("\n")).not.toContain("<name>");
    const doctorPhase = (
      result.data as {
        phases: Array<{
          id: string;
          summary: string;
          actions: Array<{ id: string; appliesWith: string }>;
        }>;
      }
    ).phases.find((phase) => phase.id === "doctor");
    expect(doctorPhase).toMatchObject({
      summary:
        "`tap doctor --setup` reuses the setup report for readiness diagnosis",
      actions: [
        expect.objectContaining({
          id: "run-setup-doctor",
          appliesWith: "manual",
        }),
      ],
    });
  });

  it("uses a concrete receiver check command only when an agent is resolved", async () => {
    const result = await setupCommand([
      "--profile",
      "codex-cli",
      "--agent",
      "봄",
    ]);

    expect(result.ok).toBe(true);
    expect(result.data.nextActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "run-receiver-check",
          command: "tap receiver check --agent '봄' --json",
        }),
      ]),
    );
  });

  it("previews tap-owned directory creation without mutating during dry-run", async () => {
    const commsDir = path.join(tmpDir, "dry-run-comms");

    const result = await setupCommand([
      "--profile",
      "codex-cli",
      "--comms-dir",
      commsDir,
    ]);

    expect(result.ok).toBe(true);
    expect(result.code).toBe("TAP_SETUP_OK");
    expect(result.data).toMatchObject({
      command: "setup",
      profile: "codex-cli",
      dryRun: true,
      apply: false,
      status: "partial",
      applyPlan: {
        status: "preview",
        dryRun: true,
        apply: false,
        mutations: expect.arrayContaining([
          expect.objectContaining({
            kind: "directory-create",
            targetPath: commsDir,
            status: "planned",
            defaultEnabled: false,
          }),
          expect.objectContaining({
            kind: "directory-create",
            targetPath: path.join(tmpDir, ".tap-comms"),
            status: "planned",
            defaultEnabled: false,
          }),
          expect.objectContaining({
            kind: "json-file-create",
            targetPath: path.join(tmpDir, ".mcp.json"),
            status: "planned",
            defaultEnabled: false,
            reviewRequired: true,
            after: expect.objectContaining({
              generatedPayload: expect.objectContaining({
                serverKey: "tap",
                command: "npx",
                args: ["@hua-labs/tap", "serve"],
                managedBy: "tap",
              }),
            }),
          }),
        ]),
      },
    });
    expect(fs.existsSync(commsDir)).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, ".tap-comms"))).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, ".mcp.json"))).toBe(false);
  });

  it("validates profile packs as data-only setup context", async () => {
    const profilePackPath = path.join(tmpDir, "hua-profile-pack.json");
    writeProfilePack(profilePackPath);

    const result = await setupCommand([
      "--profile=codex-cli",
      `--profile-pack=${profilePackPath}`,
    ]);

    expect(result.ok).toBe(true);
    expect(result.code).toBe("TAP_SETUP_OK");
    expect(result.data).toMatchObject({
      environment: {
        profilePack: {
          summary: expect.objectContaining({
            path: profilePackPath,
            exists: true,
            status: "valid",
            schemaVersion: "tap-profile-pack.v0",
            packId: "example-pack",
            profileCount: 1,
            profileIds: ["example-cli"],
            commandCount: 1,
            commandRiskCounts: { "read-only": 1 },
          }),
        },
        mcpConfigTargets: expect.arrayContaining([
          expect.objectContaining({
            kind: "profile-pack",
            path: profilePackPath,
            status: "ready",
            source: "profile-pack",
          }),
        ]),
      },
      phases: expect.arrayContaining([
        expect.objectContaining({
          id: "config",
          checks: expect.arrayContaining([
            expect.objectContaining({
              id: "profile-pack-validation",
              status: "pass",
              evidence: expect.objectContaining({
                commandsExecution: "not-run",
                commandsReviewRequired: true,
                commandsDefaultEnabled: false,
              }),
            }),
          ]),
        }),
      ]),
      applyPlan: {
        guards: expect.arrayContaining([
          expect.objectContaining({
            id: "guard-profile-pack-validation",
            status: "pass",
          }),
        ]),
        mutations: expect.arrayContaining([
          expect.objectContaining({
            id: "validate-profile-pack",
            kind: "profile-pack-validate",
            status: "skipped",
            risk: "read-only",
          }),
        ]),
      },
    });
    expect(result.data.nextActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "apply-reviewed-setup",
          command: `tap setup --profile codex-cli --profile-pack ${profilePackPath} --apply --json`,
        }),
        expect.objectContaining({
          id: "run-setup-doctor",
          command: `tap doctor --setup --profile codex-cli --profile-pack ${profilePackPath} --json`,
        }),
        expect.objectContaining({
          id: "review-profile-pack-data",
          command: `tap setup --profile codex-cli --profile-pack ${profilePackPath} --json`,
          file: profilePackPath,
        }),
      ]),
    );
    expect(JSON.stringify(result.data)).not.toContain(
      "profile-pack-command-sentinel",
    );
  });

  it("blocks apply before mutation when profile pack validation fails", async () => {
    const profilePackPath = path.join(tmpDir, "invalid-profile-pack.json");
    writeProfilePack(profilePackPath, {
      profiles: [
        {
          id: "example-cli",
          label: "Example CLI",
          runtimeSurface: "codex-cli",
          agent: "example",
          paths: {
            repoRoot: "/example/repo",
            commsDir: "/example/comms",
          },
          capabilities: {
            ready: true,
            status: true,
            apply: false,
          },
          commands: {
            ready: {
              shell: "echo invalid-profile-pack-command-sentinel",
              risk: "read-only",
              reviewRequired: false,
              defaultEnabled: false,
            },
          },
          ready: {
            surface: "codex-cli",
            commandRef: "ready",
          },
        },
      ],
    });

    const result = await setupCommand([
      "--profile=codex-cli",
      "--apply",
      `--profile-pack=${profilePackPath}`,
    ]);

    expect(result.ok).toBe(false);
    expect(result.code).toBe("TAP_SETUP_APPLY_BLOCKED");
    expect(result.data).toMatchObject({
      status: "blocked",
      phases: expect.arrayContaining([
        expect.objectContaining({
          id: "config",
          status: "fail",
          checks: expect.arrayContaining([
            expect.objectContaining({
              id: "profile-pack-validation",
              status: "fail",
              evidence: expect.objectContaining({
                errors: expect.arrayContaining([
                  expect.objectContaining({
                    path: "profiles[0].commands.ready.reviewRequired",
                    message: "must be true in v0",
                  }),
                ]),
              }),
            }),
          ]),
        }),
      ]),
      applyPlan: {
        status: "blocked",
        guards: expect.arrayContaining([
          expect.objectContaining({
            id: "guard-profile-pack-validation",
            status: "fail",
          }),
        ]),
        mutations: expect.arrayContaining([
          expect.objectContaining({
            id: "validate-profile-pack",
            status: "blocked",
          }),
          expect.objectContaining({
            kind: "directory-create",
            targetPath: path.join(tmpDir, ".tap-comms"),
            status: "blocked",
          }),
          expect.objectContaining({
            kind: "json-file-create",
            targetPath: path.join(tmpDir, ".mcp.json"),
            status: "blocked",
          }),
        ]),
      },
    });
    const nextActions = (
      result.data as {
        nextActions: Array<{ id: string; command?: string; file?: string }>;
      }
    ).nextActions;
    expect(nextActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "review-blocked-setup",
          command: undefined,
          reason:
            "setup is fail-closed; repair the blocker or choose an explicit manual path before rerunning apply",
        }),
        expect.objectContaining({
          id: "repair-profile-pack-data",
          command: `tap setup --profile codex-cli --profile-pack ${profilePackPath} --json`,
          file: profilePackPath,
        }),
      ]),
    );
    expect(nextActions.map((action) => action.id)).not.toContain(
      "apply-reviewed-setup",
    );
    expect(fs.existsSync(path.join(tmpDir, ".tap-comms"))).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, ".mcp.json"))).toBe(false);
    expect(JSON.stringify(result.data)).not.toContain(
      "invalid-profile-pack-command-sentinel",
    );
  });

  it("previews managed .mcp.json edits with backup guidance only", async () => {
    const mcpPath = path.join(tmpDir, ".mcp.json");
    fs.writeFileSync(
      mcpPath,
      JSON.stringify(
        {
          mcpServers: {
            tap: {
              managedBy: "tap",
              schemaVersion: "setup-mcp-v0",
              command: "npx",
            },
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    const result = await setupCommand(["--profile=codex-cli"]);

    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      applyPlan: {
        status: "preview",
        guards: expect.arrayContaining([
          expect.objectContaining({
            status: "pass",
            message:
              "repo .mcp.json mcpServers.tap is recognizably tap-managed; edit preview is available",
          }),
        ]),
        mutations: expect.arrayContaining([
          expect.objectContaining({
            kind: "json-file-edit",
            targetPath: mcpPath,
            status: "planned",
            backupPath: path.join(
              tmpDir,
              ".tap-comms",
              "backups",
              "setup",
              "mcp-json.bak",
            ),
          }),
        ]),
        rollback: expect.arrayContaining([
          expect.objectContaining({
            action: "restore-backup",
            targetPath: mcpPath,
            status: "manual-only",
          }),
        ]),
      },
    });
    expect(JSON.parse(fs.readFileSync(mcpPath, "utf8"))).toMatchObject({
      mcpServers: {
        tap: {
          command: "npx",
        },
      },
    });
  });

  it("applies tap-owned directories and creates missing .mcp.json", async () => {
    const commsDir = path.join(tmpDir, "apply-comms");
    const mcpPath = path.join(tmpDir, ".mcp.json");

    const result = await setupCommand([
      "--profile",
      "codex-cli",
      "--apply",
      "--comms-dir",
      commsDir,
    ]);

    expect(result.ok).toBe(true);
    expect(result.code).toBe("TAP_SETUP_OK");
    expect(result.data).toMatchObject({
      command: "setup",
      profile: "codex-cli",
      dryRun: false,
      apply: true,
      status: "partial",
      applyPlan: {
        status: "applied",
        mutations: expect.arrayContaining([
          expect.objectContaining({
            kind: "directory-create",
            targetPath: commsDir,
            status: "applied",
            defaultEnabled: true,
          }),
          expect.objectContaining({
            kind: "directory-create",
            targetPath: path.join(tmpDir, ".tap-comms"),
            status: "applied",
            defaultEnabled: true,
          }),
          expect.objectContaining({
            kind: "directory-create",
            targetPath: path.join(tmpDir, ".tap-comms", "pids"),
            status: "applied",
            defaultEnabled: true,
          }),
          expect.objectContaining({
            kind: "directory-create",
            targetPath: path.join(tmpDir, ".tap-comms", "logs"),
            status: "applied",
            defaultEnabled: true,
          }),
          expect.objectContaining({
            kind: "json-file-create",
            targetPath: mcpPath,
            status: "applied",
            after: expect.objectContaining({
              generatedPayload: expect.objectContaining({
                managedBy: "tap",
                schemaVersion: "setup-mcp-v0",
              }),
            }),
          }),
          expect.objectContaining({
            kind: "state-file-create",
            targetPath: path.join(tmpDir, ".tap-comms", "state.json"),
            status: "applied",
            defaultEnabled: true,
          }),
        ]),
        evidence: expect.arrayContaining([
          expect.objectContaining({
            mutationId: "create-initial-state-file",
            status: "written",
            path: path.join(tmpDir, ".tap-comms", "state.json"),
          }),
          expect.objectContaining({
            mutationId: "preview-repo-mcp-json-create",
            status: "written",
            path: mcpPath,
          }),
        ]),
        rollback: expect.arrayContaining([
          expect.objectContaining({
            action: "delete-created-path",
            targetPath: commsDir,
            status: "available",
          }),
          expect.objectContaining({
            mutationId: "preview-repo-mcp-json-create",
            action: "delete-created-path",
            targetPath: mcpPath,
            status: "available",
          }),
          expect.objectContaining({
            mutationId: "create-initial-state-file",
            action: "delete-created-path",
            targetPath: path.join(tmpDir, ".tap-comms", "state.json"),
            status: "available",
          }),
        ]),
      },
      residual: expect.arrayContaining([
        expect.objectContaining({
          id: "setup-apply-directory-and-mcp-preview",
          severity: "info",
        }),
      ]),
    });
    expect(fs.statSync(commsDir).isDirectory()).toBe(true);
    expect(fs.statSync(path.join(tmpDir, ".tap-comms")).isDirectory()).toBe(
      true,
    );
    expect(
      fs.statSync(path.join(tmpDir, ".tap-comms", "pids")).isDirectory(),
    ).toBe(true);
    expect(
      fs.statSync(path.join(tmpDir, ".tap-comms", "logs")).isDirectory(),
    ).toBe(true);
    const state = JSON.parse(
      fs.readFileSync(path.join(tmpDir, ".tap-comms", "state.json"), "utf8"),
    ) as {
      commsDir: string;
      repoRoot: string;
      instances: Record<string, unknown>;
    };
    expect(state.commsDir).toBe(commsDir);
    expect(state.repoRoot).toBe(tmpDir);
    expect(state.instances).toEqual({});
    const mcpConfig = JSON.parse(fs.readFileSync(mcpPath, "utf8")) as {
      mcpServers: {
        tap: {
          command: string;
          args: string[];
          cwd: string;
          managedBy: string;
          schemaVersion: string;
          env: Record<string, string>;
        };
      };
    };
    expect(mcpConfig.mcpServers.tap).toMatchObject({
      type: "stdio",
      command: "npx",
      args: ["@hua-labs/tap", "serve"],
      cwd: tmpDir,
      managedBy: "tap",
      schemaVersion: "setup-mcp-v0",
    });
    expect(mcpConfig.mcpServers.tap.env.TAP_COMMS_DIR).toBe(commsDir);
    expect(fs.existsSync(process.env.CODEX_HOME!)).toBe(false);
  });

  it("updates tap-managed .mcp.json entries after writing a backup", async () => {
    const mcpPath = path.join(tmpDir, ".mcp.json");
    const backupPath = path.join(
      tmpDir,
      ".tap-comms",
      "backups",
      "setup",
      "mcp-json.bak",
    );
    fs.writeFileSync(
      mcpPath,
      JSON.stringify(
        {
          mcpServers: {
            other: {
              command: "node",
              args: ["other.js"],
            },
            tap: {
              managedBy: "tap",
              schemaVersion: "setup-mcp-v0",
              command: "npx",
              args: ["@hua-labs/tap", "old-serve"],
              env: {
                TAP_AGENT_NAME: "old-agent",
                TAP_COMMS_DIR: path.join(tmpDir, "old-comms"),
                TAP_STATE_DIR: path.join(tmpDir, "old-state"),
                TAP_REPO_ROOT: tmpDir,
                TAP_CHANNEL_LOG_PATH: path.join(tmpDir, "old.log"),
              },
              type: "stdio",
            },
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    const result = await setupCommand(["--profile=codex-cli", "--apply"]);

    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      applyPlan: {
        mutations: expect.arrayContaining([
          expect.objectContaining({
            id: "preview-repo-mcp-json-managed-edit",
            kind: "json-file-edit",
            targetPath: mcpPath,
            status: "applied",
            backupPath,
          }),
        ]),
        evidence: expect.arrayContaining([
          expect.objectContaining({
            mutationId: "preview-repo-mcp-json-managed-edit",
            status: "written",
            path: mcpPath,
          }),
        ]),
        rollback: expect.arrayContaining([
          expect.objectContaining({
            mutationId: "preview-repo-mcp-json-managed-edit",
            action: "restore-backup",
            targetPath: mcpPath,
            backupPath,
            status: "available",
          }),
        ]),
      },
    });
    expect(fs.existsSync(backupPath)).toBe(true);
    expect(fs.readFileSync(backupPath, "utf8")).toContain("old-serve");
    const mcpConfig = JSON.parse(fs.readFileSync(mcpPath, "utf8")) as {
      mcpServers: {
        other: { command: string };
        tap: { args: string[]; env: Record<string, string> };
      };
    };
    expect(mcpConfig.mcpServers.other.command).toBe("node");
    expect(mcpConfig.mcpServers.tap.args).toEqual(["@hua-labs/tap", "serve"]);
    expect(mcpConfig.mcpServers.tap.env.TAP_STATE_DIR).toBe(
      path.join(tmpDir, ".tap-comms"),
    );
  });

  it("adds missing tap MCP server entries after writing a backup", async () => {
    const mcpPath = path.join(tmpDir, ".mcp.json");
    const backupPath = path.join(
      tmpDir,
      ".tap-comms",
      "backups",
      "setup",
      "mcp-json.bak",
    );
    fs.writeFileSync(
      mcpPath,
      JSON.stringify(
        {
          mcpServers: {
            other: {
              command: "node",
              args: ["other.js"],
            },
          },
          note: "preserve me",
        },
        null,
        2,
      ),
      "utf8",
    );

    const result = await setupCommand(["--profile=codex-cli", "--apply"]);

    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      applyPlan: {
        mutations: expect.arrayContaining([
          expect.objectContaining({
            id: "preview-repo-mcp-json-add-entry",
            kind: "json-file-edit",
            targetPath: mcpPath,
            status: "applied",
            backupPath,
          }),
        ]),
      },
    });
    expect(fs.existsSync(backupPath)).toBe(true);
    expect(fs.readFileSync(backupPath, "utf8")).not.toContain('"tap"');
    const mcpConfig = JSON.parse(fs.readFileSync(mcpPath, "utf8")) as {
      note: string;
      mcpServers: {
        other: { command: string };
        tap: { managedBy: string };
      };
    };
    expect(mcpConfig.note).toBe("preserve me");
    expect(mcpConfig.mcpServers.other.command).toBe("node");
    expect(mcpConfig.mcpServers.tap.managedBy).toBe("tap");
  });

  it("keeps setup --apply idempotent when tap-owned directories already exist", async () => {
    const commsDir = path.join(tmpDir, "existing-comms");
    fs.mkdirSync(commsDir, { recursive: true });
    fs.mkdirSync(path.join(tmpDir, ".tap-comms", "pids"), {
      recursive: true,
    });
    fs.mkdirSync(path.join(tmpDir, ".tap-comms", "logs"), {
      recursive: true,
    });

    const result = await setupCommand([
      "--profile=codex-cli",
      "--apply",
      `--comms-dir=${commsDir}`,
    ]);

    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      applyPlan: {
        status: "applied",
        mutations: expect.arrayContaining([
          expect.objectContaining({
            targetPath: commsDir,
            status: "skipped",
            after: expect.objectContaining({
              exists: true,
              type: "directory",
            }),
          }),
          expect.objectContaining({
            targetPath: path.join(tmpDir, ".tap-comms", "pids"),
            status: "skipped",
          }),
        ]),
      },
    });
  });

  it("skips .mcp.json writes when the generated tap entry is already current", async () => {
    const commsDir = path.join(tmpDir, "current-comms");
    const stateDir = path.join(tmpDir, ".tap-comms");
    const mcpPath = path.join(tmpDir, ".mcp.json");
    const backupPath = path.join(stateDir, "backups", "setup", "mcp-json.bak");
    fs.writeFileSync(
      mcpPath,
      JSON.stringify(
        {
          mcpServers: {
            tap: {
              type: "stdio",
              command: "npx",
              args: ["@hua-labs/tap", "serve"],
              cwd: tmpDir,
              env: {
                TAP_AGENT_NAME: "<set-per-runtime>",
                TAP_COMMS_DIR: commsDir,
                TAP_STATE_DIR: stateDir,
                TAP_REPO_ROOT: tmpDir,
                TAP_CHANNEL_LOG_PATH: path.join(
                  stateDir,
                  "logs",
                  "tap-mcp.log",
                ),
              },
              managedBy: "tap",
              schemaVersion: "setup-mcp-v0",
            },
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    const result = await setupCommand([
      "--profile=codex-cli",
      "--apply",
      `--comms-dir=${commsDir}`,
    ]);

    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      applyPlan: {
        mutations: expect.arrayContaining([
          expect.objectContaining({
            id: "preview-repo-mcp-json-managed-edit",
            kind: "json-file-edit",
            targetPath: mcpPath,
            status: "skipped",
          }),
        ]),
        evidence: expect.arrayContaining([
          expect.objectContaining({
            mutationId: "preview-repo-mcp-json-managed-edit",
            status: "verified",
          }),
        ]),
      },
    });
    expect(fs.existsSync(backupPath)).toBe(false);
  });

  it("fails closed without mutating when a tap-owned directory target is a file", async () => {
    const commsDir = path.join(tmpDir, "blocked-comms");
    fs.writeFileSync(commsDir, "not a directory", "utf8");

    const result = await setupCommand([
      "--profile=codex-cli",
      "--apply",
      `--comms-dir=${commsDir}`,
    ]);

    expect(result.ok).toBe(false);
    expect(result.code).toBe("TAP_SETUP_APPLY_BLOCKED");
    expect(result.data).toMatchObject({
      status: "blocked",
      applyPlan: {
        status: "blocked",
        guards: expect.arrayContaining([
          expect.objectContaining({
            status: "fail",
            message: "directory target already exists as a non-directory path",
          }),
        ]),
        mutations: expect.arrayContaining([
          expect.objectContaining({
            targetPath: commsDir,
            status: "blocked",
          }),
          expect.objectContaining({
            targetPath: path.join(tmpDir, ".tap-comms"),
            status: "blocked",
          }),
        ]),
      },
      residual: expect.arrayContaining([
        expect.objectContaining({
          id: "setup-apply-directory-guard-blocked",
          severity: "blocker",
        }),
      ]),
    });
    expect(fs.readFileSync(commsDir, "utf8")).toBe("not a directory");
    expect(fs.existsSync(path.join(tmpDir, ".tap-comms"))).toBe(false);
  });

  it("fails closed without mutating when a directory target parent is a file", async () => {
    const parentFile = path.join(tmpDir, "parent-file");
    const commsDir = path.join(parentFile, "child-comms");
    fs.writeFileSync(parentFile, "not a directory", "utf8");

    const result = await setupCommand([
      "--profile=codex-cli",
      "--apply",
      `--comms-dir=${commsDir}`,
    ]);

    expect(result.ok).toBe(false);
    expect(result.code).toBe("TAP_SETUP_APPLY_BLOCKED");
    expect(result.data).toMatchObject({
      status: "blocked",
      applyPlan: {
        status: "blocked",
        guards: expect.arrayContaining([
          expect.objectContaining({
            status: "fail",
            message: "directory target parent exists as a non-directory path",
            evidence: expect.objectContaining({
              parentPath: parentFile,
            }),
          }),
        ]),
        mutations: expect.arrayContaining([
          expect.objectContaining({
            targetPath: commsDir,
            status: "blocked",
          }),
          expect.objectContaining({
            targetPath: path.join(tmpDir, ".tap-comms"),
            status: "blocked",
          }),
        ]),
      },
    });
    expect(fs.readFileSync(parentFile, "utf8")).toBe("not a directory");
    expect(fs.existsSync(path.join(tmpDir, ".tap-comms"))).toBe(false);
  });

  it("blocks apply before mutation when .mcp.json tap entry is user-managed", async () => {
    fs.writeFileSync(
      path.join(tmpDir, ".mcp.json"),
      JSON.stringify(
        {
          mcpServers: {
            tap: {
              command: "node",
              args: ["custom-server.js"],
              env: { USER_VALUE: "do-not-print" },
            },
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    const result = await setupCommand(["--profile=codex-cli", "--apply"]);

    expect(result.ok).toBe(false);
    expect(result.code).toBe("TAP_SETUP_APPLY_BLOCKED");
    expect(result.data).toMatchObject({
      status: "blocked",
      applyPlan: {
        status: "blocked",
        guards: expect.arrayContaining([
          expect.objectContaining({
            status: "fail",
            message:
              "repo .mcp.json mcpServers.tap exists but is not recognizably tap-managed",
          }),
        ]),
        mutations: expect.arrayContaining([
          expect.objectContaining({
            kind: "manual-only",
            targetPath: path.join(tmpDir, ".mcp.json"),
            status: "blocked",
            reason:
              "setup refuses key-name-only recognition and will not overwrite a user-managed mcpServers.tap entry",
          }),
          expect.objectContaining({
            kind: "directory-create",
            targetPath: path.join(tmpDir, ".tap-comms"),
            status: "blocked",
          }),
        ]),
      },
      residual: expect.arrayContaining([
        expect.objectContaining({
          id: "setup-mcp-json-user-managed-blocked",
          severity: "blocker",
        }),
      ]),
    });
    const nextActions = (result.data as { nextActions: Array<{ id: string }> })
      .nextActions;
    expect(nextActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "review-blocked-setup" }),
        expect.objectContaining({ id: "run-setup-doctor" }),
      ]),
    );
    expect(nextActions.map((action) => action.id)).not.toContain(
      "apply-reviewed-setup",
    );
    expect(fs.existsSync(path.join(tmpDir, ".tap-comms"))).toBe(false);
    expect(fs.readFileSync(path.join(tmpDir, ".mcp.json"), "utf8")).toContain(
      "custom-server.js",
    );
  });

  it("blocks generated-looking .mcp.json tap entries with extra execution fields", async () => {
    fs.writeFileSync(
      path.join(tmpDir, ".mcp.json"),
      JSON.stringify(
        {
          mcpServers: {
            tap: {
              type: "stdio",
              command: "npx",
              args: ["@hua-labs/tap", "serve"],
              env: {
                TAP_AGENT_NAME: "custom-agent",
                TAP_COMMS_DIR: path.join(tmpDir, "custom-comms"),
                TAP_STATE_DIR: path.join(tmpDir, "custom-state"),
                TAP_REPO_ROOT: path.join(tmpDir, "custom-root"),
                TAP_CHANNEL_LOG_PATH: path.join(tmpDir, "custom.log"),
              },
              cwd: path.join(tmpDir, "custom-cwd"),
            },
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    const result = await setupCommand(["--profile=codex-cli", "--apply"]);

    expect(result.ok).toBe(false);
    expect(result.code).toBe("TAP_SETUP_APPLY_BLOCKED");
    expect(result.data).toMatchObject({
      status: "blocked",
      applyPlan: {
        status: "blocked",
        guards: expect.arrayContaining([
          expect.objectContaining({
            status: "fail",
            message:
              "repo .mcp.json mcpServers.tap exists but is not recognizably tap-managed",
            evidence: expect.objectContaining({
              before: expect.objectContaining({
                tapEntry: expect.objectContaining({
                  keys: ["args", "command", "cwd", "env", "type"],
                  managedByTap: false,
                  schemaVersion: null,
                }),
              }),
            }),
          }),
        ]),
        mutations: expect.arrayContaining([
          expect.objectContaining({
            kind: "manual-only",
            targetPath: path.join(tmpDir, ".mcp.json"),
            status: "blocked",
          }),
          expect.objectContaining({
            kind: "directory-create",
            targetPath: path.join(tmpDir, ".tap-comms"),
            status: "blocked",
          }),
        ]),
      },
    });
    expect(fs.existsSync(path.join(tmpDir, ".tap-comms"))).toBe(false);
    expect(fs.readFileSync(path.join(tmpDir, ".mcp.json"), "utf8")).toContain(
      "custom-cwd",
    );
  });

  it("blocks generated-looking .mcp.json tap entries with non-tap provenance values", async () => {
    fs.writeFileSync(
      path.join(tmpDir, ".mcp.json"),
      JSON.stringify(
        {
          mcpServers: {
            tap: {
              type: "stdio",
              command: "npx",
              args: ["@hua-labs/tap", "serve"],
              env: {
                TAP_AGENT_NAME: "custom-agent",
                TAP_COMMS_DIR: path.join(tmpDir, "custom-comms"),
                TAP_STATE_DIR: path.join(tmpDir, "custom-state"),
                TAP_REPO_ROOT: path.join(tmpDir, "custom-root"),
                TAP_CHANNEL_LOG_PATH: path.join(tmpDir, "custom.log"),
              },
              managedBy: "custom",
              schemaVersion: "custom-v0",
            },
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    const result = await setupCommand(["--profile=codex-cli", "--apply"]);

    expect(result.ok).toBe(false);
    expect(result.code).toBe("TAP_SETUP_APPLY_BLOCKED");
    expect(result.data).toMatchObject({
      status: "blocked",
      applyPlan: {
        status: "blocked",
        guards: expect.arrayContaining([
          expect.objectContaining({
            status: "fail",
            message:
              "repo .mcp.json mcpServers.tap exists but is not recognizably tap-managed",
            evidence: expect.objectContaining({
              before: expect.objectContaining({
                tapEntry: expect.objectContaining({
                  keys: [
                    "args",
                    "command",
                    "env",
                    "managedBy",
                    "schemaVersion",
                    "type",
                  ],
                  managedByTap: false,
                  schemaVersion: "custom-v0",
                }),
              }),
            }),
          }),
        ]),
        mutations: expect.arrayContaining([
          expect.objectContaining({
            kind: "manual-only",
            targetPath: path.join(tmpDir, ".mcp.json"),
            status: "blocked",
          }),
          expect.objectContaining({
            kind: "directory-create",
            targetPath: path.join(tmpDir, ".tap-comms"),
            status: "blocked",
          }),
        ]),
      },
    });
    expect(fs.existsSync(path.join(tmpDir, ".tap-comms"))).toBe(false);
    expect(fs.readFileSync(path.join(tmpDir, ".mcp.json"), "utf8")).toContain(
      "custom-v0",
    );
  });

  it("blocks apply before mutation when .mcp.json is invalid JSON", async () => {
    fs.writeFileSync(path.join(tmpDir, ".mcp.json"), "{", "utf8");

    const result = await setupCommand(["--profile=codex-cli", "--apply"]);

    expect(result.ok).toBe(false);
    expect(result.code).toBe("TAP_SETUP_APPLY_BLOCKED");
    expect(result.data).toMatchObject({
      status: "blocked",
      applyPlan: {
        status: "blocked",
        guards: expect.arrayContaining([
          expect.objectContaining({
            status: "fail",
            message: "repo .mcp.json is not valid JSON",
          }),
        ]),
        mutations: expect.arrayContaining([
          expect.objectContaining({
            kind: "manual-only",
            targetPath: path.join(tmpDir, ".mcp.json"),
            status: "blocked",
          }),
          expect.objectContaining({
            kind: "directory-create",
            targetPath: path.join(tmpDir, ".tap-comms"),
            status: "blocked",
          }),
        ]),
      },
    });
    expect(fs.existsSync(path.join(tmpDir, ".tap-comms"))).toBe(false);
    expect(fs.readFileSync(path.join(tmpDir, ".mcp.json"), "utf8")).toBe("{");
  });

  it("uses --comms-dir only for report resolution", async () => {
    const commsDir = path.join(tmpDir, "custom-comms");

    const result = await setupCommand([
      "--profile",
      "codex-cli",
      "--comms-dir",
      commsDir,
    ]);

    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      environment: {
        commsDir,
      },
    });
    expect(fs.existsSync(commsDir)).toBe(false);
  });

  it("reports codex-app route tuple and runtime health from read-only presence evidence", async () => {
    const commsDir = path.join(tmpDir, "custom-comms");
    fs.mkdirSync(path.join(commsDir, "presence"), { recursive: true });
    fs.writeFileSync(
      path.join(commsDir, "presence", "app-agent.json"),
      JSON.stringify(
        {
          timestamp: new Date().toISOString(),
          receiveTransports: ["consent-drive"],
          address: {
            conversationId: "thread-live",
            ownerClientId: "owner-live",
          },
          consentDriveStatus: "ready",
          health: { status: "ready" },
        },
        null,
        2,
      ),
      "utf8",
    );

    const result = await setupCommand([
      "--profile",
      "codex-app",
      "--agent",
      "app-agent",
      "--comms-dir",
      commsDir,
    ]);

    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      profile: "codex-app",
      environment: {
        agent: "app-agent",
        commsDir,
      },
      phases: expect.arrayContaining([
        expect.objectContaining({
          id: "runtime",
          status: "pass",
          checks: expect.arrayContaining([
            expect.objectContaining({
              id: "codex-app-route-tuple",
              status: "pass",
              evidence: expect.objectContaining({
                conversationId: "<present>",
                ownerClientId: "<present>",
              }),
            }),
            expect.objectContaining({
              id: "codex-app-runtime-health",
              status: "pass",
              evidence: { runtimeHealth: "ready" },
            }),
          ]),
        }),
      ]),
      residual: expect.arrayContaining([
        expect.objectContaining({ id: "codex-app-live-smoke-deferred" }),
      ]),
    });
    expect(result.data.residual).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "codex-app-deep-probe-deferred" }),
      ]),
    );
  });

  it("fails closed for stale codex-app route presence without mutating it", async () => {
    const commsDir = path.join(tmpDir, "stale-comms");
    const presencePath = path.join(commsDir, "presence", "app-agent.json");
    fs.mkdirSync(path.dirname(presencePath), { recursive: true });
    fs.writeFileSync(
      presencePath,
      JSON.stringify(
        {
          timestamp: new Date(Date.now() - 60 * 60_000).toISOString(),
          receiveTransports: ["consent-drive"],
          address: {
            conversationId: "thread-stale",
            ownerClientId: "owner-stale",
          },
          consentDriveStatus: "ready",
          health: { status: "ready" },
        },
        null,
        2,
      ),
      "utf8",
    );

    const before = fs.readFileSync(presencePath, "utf8");
    const result = await setupCommand([
      "--profile=codex-app",
      "--agent=app-agent",
      `--comms-dir=${commsDir}`,
      "--fresh-minutes=30",
    ]);

    expect(result.ok).toBe(true);
    const runtimePhase = (
      result.data as {
        phases: Array<{
          id: string;
          status: string;
          checks: Array<{ id: string; status: string; evidence?: unknown }>;
          actions: Array<{ id: string; risk: string }>;
        }>;
      }
    ).phases.find((phase) => phase.id === "runtime");
    expect(runtimePhase).toMatchObject({
      status: "fail",
      checks: expect.arrayContaining([
        expect.objectContaining({
          id: "codex-app-presence",
          status: "fail",
          evidence: expect.objectContaining({
            freshness: "stale-visible",
          }),
        }),
        expect.objectContaining({
          id: "codex-app-consent-drive",
          status: "fail",
          evidence: {
            consentDriveStatus: "stale",
          },
        }),
      ]),
      actions: expect.arrayContaining([
        expect.objectContaining({
          id: "refresh-codex-app-warmup",
          risk: "read-only",
        }),
      ]),
    });
    expect(fs.readFileSync(presencePath, "utf8")).toBe(before);
  });

  it("fails closed when codex-app tuple lacks explicit consent and health evidence", async () => {
    const commsDir = path.join(tmpDir, "tuple-only-comms");
    const presencePath = path.join(commsDir, "presence", "app-agent.json");
    fs.mkdirSync(path.dirname(presencePath), { recursive: true });
    fs.writeFileSync(
      presencePath,
      JSON.stringify(
        {
          timestamp: new Date().toISOString(),
          receiveTransports: ["consent-drive"],
          address: {
            conversationId: "thread-live",
            ownerClientId: "owner-live",
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    const result = await setupCommand([
      "--profile",
      "codex-app",
      "--agent",
      "app-agent",
      "--comms-dir",
      commsDir,
    ]);

    expect(result.ok).toBe(true);
    const runtimePhase = (
      result.data as {
        phases: Array<{
          id: string;
          status: string;
          checks: Array<{ id: string; status: string; evidence?: unknown }>;
        }>;
      }
    ).phases.find((phase) => phase.id === "runtime");
    expect(runtimePhase).toMatchObject({
      status: "fail",
      checks: expect.arrayContaining([
        expect.objectContaining({
          id: "codex-app-route-tuple",
          status: "pass",
        }),
        expect.objectContaining({
          id: "codex-app-consent-drive",
          status: "fail",
          evidence: {
            consentDriveStatus: "not-observed",
          },
        }),
        expect.objectContaining({
          id: "codex-app-runtime-health",
          status: "fail",
          evidence: {
            runtimeHealth: "not-observed",
          },
        }),
      ]),
    });
  });

  it("fails closed when codex-app consent is ready but health is missing", async () => {
    const commsDir = path.join(tmpDir, "missing-health-comms");
    fs.mkdirSync(path.join(commsDir, "presence"), { recursive: true });
    fs.writeFileSync(
      path.join(commsDir, "presence", "app-agent.json"),
      JSON.stringify(
        {
          timestamp: new Date().toISOString(),
          receiveTransports: ["consent-drive"],
          address: {
            conversationId: "thread-live",
            ownerClientId: "owner-live",
          },
          consentDriveStatus: "ready",
        },
        null,
        2,
      ),
      "utf8",
    );

    const result = await setupCommand([
      "--profile=codex-app",
      "--agent=app-agent",
      `--comms-dir=${commsDir}`,
    ]);

    expect(result.ok).toBe(true);
    const runtimePhase = (
      result.data as {
        phases: Array<{
          id: string;
          status: string;
          checks: Array<{ id: string; status: string; evidence?: unknown }>;
        }>;
      }
    ).phases.find((phase) => phase.id === "runtime");
    expect(runtimePhase).toMatchObject({
      status: "fail",
      checks: expect.arrayContaining([
        expect.objectContaining({
          id: "codex-app-consent-drive",
          status: "pass",
          evidence: {
            consentDriveStatus: "ready",
          },
        }),
        expect.objectContaining({
          id: "codex-app-runtime-health",
          status: "fail",
          evidence: {
            runtimeHealth: "not-observed",
          },
        }),
      ]),
    });
  });

  it("keeps codex-app and claude-channel agentless reports manual-action only", async () => {
    const codexApp = await setupCommand(["--profile", "codex-app"]);
    const claude = await setupCommand(["--profile", "claude-channel"]);

    expect(codexApp.ok).toBe(true);
    const codexAppPhases = (
      codexApp.data as {
        phases: Array<{
          id: string;
          actions: Array<{ command?: string }>;
        }>;
      }
    ).phases;
    expect(
      codexAppPhases.find((phase) => phase.id === "permissions")?.actions[0]
        ?.command,
    ).toBe("tap ready --surface codex-app --agent <name> --json");
    expect(
      codexAppPhases.find((phase) => phase.id === "runtime")?.actions[0]
        ?.command,
    ).toBe("tap setup --profile codex-app --agent <name> --json");
    expect(codexApp.data).toMatchObject({
      profile: "codex-app",
      phases: expect.arrayContaining([
        expect.objectContaining({
          id: "runtime",
          status: "warn",
          checks: expect.arrayContaining([
            expect.objectContaining({ id: "codex-app-agent" }),
          ]),
        }),
      ]),
      residual: expect.arrayContaining([
        expect.objectContaining({ id: "codex-app-live-smoke-deferred" }),
      ]),
    });
    expect(claude.ok).toBe(true);
    const claudeTargets = (
      claude.data as {
        environment: { mcpConfigTargets: Array<{ kind: string }> };
      }
    ).environment.mcpConfigTargets;
    expect(claudeTargets.map((target) => target.kind)).toEqual([
      "repo-mcp",
      "claude-settings",
    ]);
    expect(claude.data).toMatchObject({
      profile: "claude-channel",
      environment: {
        mcpConfigTargets: expect.arrayContaining([
          expect.objectContaining({ kind: "claude-settings" }),
        ]),
      },
      phases: expect.arrayContaining([
        expect.objectContaining({
          id: "runtime",
          status: "warn",
          checks: expect.arrayContaining([
            expect.objectContaining({ id: "claude-channel-agent" }),
          ]),
        }),
      ]),
      residual: expect.arrayContaining([
        expect.objectContaining({
          id: "claude-channel-live-delivery-deferred",
        }),
      ]),
    });
  });

  it("reports claude-channel readiness from read-only durable presence evidence", async () => {
    const commsDir = path.join(tmpDir, "claude-comms");
    const presencePath = path.join(commsDir, "presence", "claude-agent.json");
    fs.mkdirSync(path.dirname(presencePath), { recursive: true });
    fs.mkdirSync(path.join(commsDir, "inbox"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, ".claude"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, ".mcp.json"), "{}\n", "utf8");
    fs.writeFileSync(
      path.join(tmpDir, ".claude", "settings.json"),
      "{}\n",
      "utf8",
    );
    fs.writeFileSync(
      presencePath,
      JSON.stringify(
        {
          timestamp: new Date().toISOString(),
          receiveTransports: ["mcp-channel"],
          health: { status: "ready" },
        },
        null,
        2,
      ),
      "utf8",
    );

    const before = fs.readFileSync(presencePath, "utf8");
    const result = await setupCommand([
      "--profile=claude-channel",
      "--agent=claude-agent",
      `--comms-dir=${commsDir}`,
    ]);

    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      profile: "claude-channel",
      environment: {
        agent: "claude-agent",
        commsDir,
      },
      phases: expect.arrayContaining([
        expect.objectContaining({
          id: "config",
          status: "pass",
        }),
        expect.objectContaining({
          id: "runtime",
          status: "pass",
          checks: expect.arrayContaining([
            expect.objectContaining({
              id: "claude-channel-presence",
              status: "pass",
              evidence: expect.objectContaining({
                freshness: "fresh-for-channel",
              }),
            }),
            expect.objectContaining({
              id: "claude-channel-transport",
              status: "pass",
              evidence: {
                receiveTransports: ["mcp-channel"],
              },
            }),
            expect.objectContaining({
              id: "claude-channel-runtime-health",
              status: "pass",
              evidence: { runtimeHealth: "ready" },
            }),
            expect.objectContaining({
              id: "claude-channel-durable-evidence",
              status: "pass",
              evidence: expect.objectContaining({
                exists: true,
              }),
            }),
          ]),
        }),
      ]),
      residual: expect.arrayContaining([
        expect.objectContaining({
          id: "claude-channel-live-delivery-deferred",
        }),
      ]),
    });
    expect(fs.readFileSync(presencePath, "utf8")).toBe(before);
  });

  it("fails closed for claude-channel missing runtime health evidence", async () => {
    const commsDir = path.join(tmpDir, "claude-missing-health-comms");
    fs.mkdirSync(path.join(commsDir, "presence"), { recursive: true });
    fs.mkdirSync(path.join(commsDir, "inbox"), { recursive: true });
    fs.writeFileSync(
      path.join(commsDir, "presence", "claude-agent.json"),
      JSON.stringify(
        {
          timestamp: new Date().toISOString(),
          receiveTransports: ["mcp-channel"],
        },
        null,
        2,
      ),
      "utf8",
    );

    const result = await setupCommand([
      "--profile",
      "claude-channel",
      "--agent",
      "claude-agent",
      "--comms-dir",
      commsDir,
    ]);

    expect(result.ok).toBe(true);
    const runtimePhase = (
      result.data as {
        phases: Array<{
          id: string;
          status: string;
          checks: Array<{ id: string; status: string; evidence?: unknown }>;
        }>;
      }
    ).phases.find((phase) => phase.id === "runtime");
    expect(runtimePhase).toMatchObject({
      status: "fail",
      checks: expect.arrayContaining([
        expect.objectContaining({
          id: "claude-channel-transport",
          status: "pass",
        }),
        expect.objectContaining({
          id: "claude-channel-runtime-health",
          status: "fail",
          evidence: {
            runtimeHealth: "not-observed",
          },
        }),
        expect.objectContaining({
          id: "claude-channel-durable-evidence",
          status: "pass",
        }),
      ]),
    });
  });

  it("fails closed for claude-channel without durable inbox evidence", async () => {
    const commsDir = path.join(tmpDir, "claude-no-inbox-comms");
    fs.mkdirSync(path.join(commsDir, "presence"), { recursive: true });
    fs.writeFileSync(
      path.join(commsDir, "presence", "claude-agent.json"),
      JSON.stringify(
        {
          timestamp: new Date().toISOString(),
          receiveTransports: ["mcp-channel"],
          health: { status: "ready" },
        },
        null,
        2,
      ),
      "utf8",
    );

    const result = await setupCommand([
      "--profile=claude-channel",
      "--agent=claude-agent",
      `--comms-dir=${commsDir}`,
    ]);

    expect(result.ok).toBe(true);
    const runtimePhase = (
      result.data as {
        phases: Array<{
          id: string;
          status: string;
          checks: Array<{ id: string; status: string; evidence?: unknown }>;
        }>;
      }
    ).phases.find((phase) => phase.id === "runtime");
    expect(runtimePhase).toMatchObject({
      status: "fail",
      checks: expect.arrayContaining([
        expect.objectContaining({
          id: "claude-channel-runtime-health",
          status: "pass",
        }),
        expect.objectContaining({
          id: "claude-channel-durable-evidence",
          status: "fail",
          evidence: expect.objectContaining({
            exists: false,
          }),
        }),
      ]),
    });
  });

  it("rejects unknown setup profiles", async () => {
    const result = await setupCommand(["--profile", "sumback-yoon"]);

    expect(result.ok).toBe(false);
    expect(result.code).toBe("TAP_INVALID_ARGUMENT");
    expect(result.message).toContain("Unknown setup profile");
  });
});
