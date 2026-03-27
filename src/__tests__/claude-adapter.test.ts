import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { claudeAdapter } from "../adapters/claude.js";
import type { AdapterContext, PatchPlan } from "../types.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tap-claude-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("claudeAdapter.apply — legacy key migration", () => {
  it("removes old tap-comms key and writes new tap key", async () => {
    const commsDir = path.join(tmpDir, "tap-comms");
    const configPath = path.join(tmpDir, ".mcp.json");

    fs.mkdirSync(commsDir, { recursive: true });
    fs.mkdirSync(path.join(tmpDir, ".tap-comms", "backups", "claude"), {
      recursive: true,
    });

    // Write legacy config with old "tap-comms" key
    fs.writeFileSync(
      configPath,
      JSON.stringify(
        {
          mcpServers: {
            "tap-comms": {
              type: "stdio",
              command: "bun",
              args: ["old-server.ts"],
              env: { TAP_COMMS_DIR: commsDir.replace(/\\/g, "/") },
            },
          },
        },
        null,
        2,
      ),
      "utf-8",
    );

    const ctx: AdapterContext = {
      commsDir,
      repoRoot: tmpDir,
      stateDir: path.join(tmpDir, ".tap-comms"),
      platform: "win32",
    };

    const plan: PatchPlan = {
      runtime: "claude",
      operations: [
        {
          type: "merge",
          path: configPath,
          key: "mcpServers.tap",
          value: {
            type: "stdio",
            command: "bun",
            args: ["new-server.ts"],
            env: { TAP_COMMS_DIR: commsDir.replace(/\\/g, "/") },
          },
        },
      ],
      ownedArtifacts: [],
      backupDir: path.join(tmpDir, ".tap-comms", "backups", "claude"),
      restartRequired: true,
      conflicts: [],
      warnings: [],
    };

    const result = await claudeAdapter.apply(ctx, plan);
    expect(result.success).toBe(true);

    const written = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    // New key exists
    expect(written.mcpServers.tap).toBeDefined();
    expect(written.mcpServers.tap.args).toEqual(["new-server.ts"]);
    // Old key removed
    expect(written.mcpServers["tap-comms"]).toBeUndefined();
  });
});

describe("claudeAdapter.verify", () => {
  it("accepts forward-slash TAP_COMMS_DIR values on Windows-style paths", async () => {
    const commsDir = path.join(tmpDir, "tap-comms");
    const configPath = path.join(tmpDir, ".mcp.json");

    fs.mkdirSync(commsDir, { recursive: true });
    fs.writeFileSync(
      configPath,
      JSON.stringify(
        {
          mcpServers: {
            tap: {
              env: {
                TAP_COMMS_DIR: commsDir.replace(/\\/g, "/"),
              },
            },
          },
        },
        null,
        2,
      ),
      "utf-8",
    );

    const ctx: AdapterContext = {
      commsDir,
      repoRoot: tmpDir,
      stateDir: path.join(tmpDir, ".tap-comms"),
      platform: "win32",
    };

    const plan: PatchPlan = {
      runtime: "claude",
      operations: [
        {
          type: "set",
          path: configPath,
          key: "mcpServers.tap",
        },
      ],
      ownedArtifacts: [],
      backupDir: path.join(tmpDir, ".tap-comms", "backups", "claude"),
      restartRequired: true,
      conflicts: [],
      warnings: [],
    };

    vi.spyOn(process, "platform", "get").mockReturnValue("win32");

    const result = await claudeAdapter.verify(ctx, plan);
    const commsDirCheck = result.checks.find(
      (check) => check.name === "TAP_COMMS_DIR configured",
    );

    expect(commsDirCheck?.passed).toBe(true);
  });
});
