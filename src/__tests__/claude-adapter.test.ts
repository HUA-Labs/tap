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
            "tap-comms": {
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
          key: "mcpServers.tap-comms",
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
