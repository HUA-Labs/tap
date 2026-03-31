import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { extractTomlTable } from "../toml.js";
import type { AdapterContext, PatchPlan } from "../types.js";

const buildManagedMcpServerSpecMock = vi.fn();

vi.mock("../adapters/common.js", () => ({
  buildManagedMcpServerSpec: buildManagedMcpServerSpecMock,
  canWriteOrCreate: () => true,
  getHomeDir: () => os.homedir(),
  probeCommand: () => ({ command: null, version: null }),
}));

const { codexAdapter } = await import("../adapters/codex.js");

let tmpDir: string;

beforeEach(() => {
  vi.clearAllMocks();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tap-codex-test-"));
  buildManagedMcpServerSpecMock.mockReturnValue({
    command: "bun",
    args: ["new-server.ts"],
    env: {
      TAP_AGENT_NAME: "reviewer",
      TAP_AGENT_ID: "codex-reviewer",
      TAP_COMMS_DIR: path.join(tmpDir, "comms").replace(/\\/g, "/"),
      TAP_STATE_DIR: path.join(tmpDir, ".tap-comms").replace(/\\/g, "/"),
      TAP_REPO_ROOT: tmpDir.replace(/\\/g, "/"),
    },
    sourcePath: "/fake/server.ts",
    warnings: [],
    issues: [],
  });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("codexAdapter.apply — legacy key migration", () => {
  it("removes old mcp_servers.tap-comms TOML tables and writes mcp_servers.tap via real apply()", async () => {
    const commsDir = path.join(tmpDir, "comms");
    const configDir = path.join(tmpDir, ".codex");
    const configPath = path.join(configDir, "config.toml");
    const backupDir = path.join(tmpDir, ".tap-comms", "backups", "codex");

    fs.mkdirSync(commsDir, { recursive: true });
    fs.mkdirSync(configDir, { recursive: true });
    fs.mkdirSync(backupDir, { recursive: true });

    // Write legacy TOML config with old "tap-comms" keys
    fs.writeFileSync(
      configPath,
      `model = "gpt-5.4"

[mcp_servers.tap-comms]
command = "bun"
args = ["old-server.ts"]

[mcp_servers.tap-comms.env]
TAP_AGENT_NAME = "old-name"
TAP_COMMS_DIR = "C:/old-comms"
`,
      "utf-8",
    );

    const ctx: AdapterContext = {
      commsDir,
      repoRoot: tmpDir,
      stateDir: path.join(tmpDir, ".tap-comms"),
      platform: "win32",
    };

    const plan: PatchPlan = {
      runtime: "codex",
      operations: [
        { type: "merge", path: configPath, key: "mcp_servers.tap" },
        { type: "merge", path: configPath, key: "mcp_servers.tap.env" },
      ],
      ownedArtifacts: [
        { kind: "toml-table", path: configPath, selector: "mcp_servers.tap" },
        {
          kind: "toml-table",
          path: configPath,
          selector: "mcp_servers.tap.env",
        },
      ],
      backupDir,
      restartRequired: true,
      conflicts: [],
      warnings: [],
    };

    const result = await codexAdapter.apply(ctx, plan);
    expect(result.success).toBe(true);

    const written = fs.readFileSync(configPath, "utf-8");

    // Old tables removed
    expect(extractTomlTable(written, "mcp_servers.tap-comms")).toBeNull();
    expect(extractTomlTable(written, "mcp_servers.tap-comms.env")).toBeNull();

    // New tables present with values from mock
    const newMain = extractTomlTable(written, "mcp_servers.tap");
    expect(newMain).not.toBeNull();
    expect(newMain).toContain("new-server.ts");

    const newEnv = extractTomlTable(written, "mcp_servers.tap.env");
    expect(newEnv).not.toBeNull();
    expect(newEnv).toContain('TAP_AGENT_NAME = "<set-per-session>"');
    expect(newEnv).not.toContain("TAP_AGENT_ID");

    // Unrelated content preserved
    expect(written).toContain('model = "gpt-5.4"');

    const verify = await codexAdapter.verify(ctx, plan);
    expect(verify.ok).toBe(true);
  });
});
