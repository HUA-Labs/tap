import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { AdapterContext, PatchPlan } from "../types.js";

const buildManagedMcpServerSpecMock = vi.fn();

vi.mock("../adapters/common.js", () => ({
  buildManagedMcpServerSpec: buildManagedMcpServerSpecMock,
  canWriteOrCreate: () => true,
  getHomeDir: () => os.homedir(),
  probeCommand: () => ({ command: null, version: null }),
}));

const { geminiAdapter } = await import("../adapters/gemini.js");

let tmpDir: string;

beforeEach(() => {
  vi.clearAllMocks();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tap-gemini-test-"));
  buildManagedMcpServerSpecMock.mockReturnValue({
    command: "node",
    args: ["new-server.mjs"],
    env: {
      TAP_AGENT_NAME: "reviewer",
      TAP_COMMS_DIR: path.join(tmpDir, "comms").replace(/\\/g, "/"),
    },
    sourcePath: "/fake/server.mjs",
    warnings: [],
    issues: [],
  });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("geminiAdapter.apply — legacy key migration", () => {
  it("removes old tap-comms key and writes new tap key via real apply()", async () => {
    const commsDir = path.join(tmpDir, "comms");
    const configPath = path.join(tmpDir, ".gemini", "settings.json");
    const backupDir = path.join(tmpDir, ".tap-comms", "backups", "gemini");

    fs.mkdirSync(commsDir, { recursive: true });
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.mkdirSync(backupDir, { recursive: true });

    // Write legacy config with old "tap-comms" key
    fs.writeFileSync(
      configPath,
      JSON.stringify(
        {
          mcpServers: {
            "tap-comms": {
              command: "node",
              args: ["old-server.mjs"],
              env: { TAP_COMMS_DIR: commsDir.replace(/\\/g, "/") },
            },
            "other-server": { command: "python", args: ["other.py"] },
          },
        },
        null,
        2,
      ) + "\n",
      "utf-8",
    );

    const ctx: AdapterContext = {
      commsDir,
      repoRoot: tmpDir,
      stateDir: path.join(tmpDir, ".tap-comms"),
      platform: "linux",
    };

    const plan: PatchPlan = {
      runtime: "gemini",
      operations: [{ type: "merge", path: configPath, key: "mcpServers.tap" }],
      ownedArtifacts: [
        { kind: "json-path", path: configPath, selector: "mcpServers.tap" },
      ],
      backupDir,
      restartRequired: true,
      conflicts: [],
      warnings: [],
    };

    const result = await geminiAdapter.apply(ctx, plan);
    expect(result.success).toBe(true);

    const written = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    // New key present with values from mock
    expect(written.mcpServers.tap).toBeDefined();
    expect(written.mcpServers.tap.command).toBe("node");
    expect(written.mcpServers.tap.args).toEqual(["new-server.mjs"]);
    // Old key removed
    expect(written.mcpServers["tap-comms"]).toBeUndefined();
    // Other servers preserved
    expect(written.mcpServers["other-server"]).toBeDefined();
  });
});
