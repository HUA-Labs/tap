import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { loadState, migrateStateV1toV2 } from "../state.js";
import type { TapStateV1 } from "../types.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tap-migration-test-"));
  fs.writeFileSync(path.join(tmpDir, "package.json"), "{}", "utf-8");
  fs.mkdirSync(path.join(tmpDir, ".tap-comms"), { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("migrateStateV1toV2", () => {
  it("converts runtimes to instances with correct fields", () => {
    const v1: TapStateV1 = {
      schemaVersion: 1,
      createdAt: "2026-03-20T00:00:00.000Z",
      updatedAt: "2026-03-23T00:00:00.000Z",
      commsDir: "/comms",
      repoRoot: "/repo",
      packageVersion: "0.1.0",
      runtimes: {
        codex: {
          installed: true,
          configPath: "/home/.codex/config.toml",
          bridgeMode: "app-server",
          restartRequired: false,
          ownedArtifacts: [],
          backupPath: "/backups/codex",
          lastAppliedHash: "abc123",
          lastVerifiedAt: "2026-03-23T00:00:00.000Z",
          bridge: null,
          warnings: [],
        },
        claude: {
          installed: true,
          configPath: "/home/.claude.json",
          bridgeMode: "native-push",
          restartRequired: false,
          ownedArtifacts: [],
          backupPath: "/backups/claude",
          lastAppliedHash: "def456",
          lastVerifiedAt: "2026-03-23T00:00:00.000Z",
          bridge: null,
          warnings: [],
        },
      },
    };

    const v2 = migrateStateV1toV2(v1);

    expect(v2.schemaVersion).toBe(2);
    expect(v2.instances).toBeDefined();
    expect(Object.keys(v2.instances)).toHaveLength(2);

    // Codex instance
    const codex = v2.instances["codex"];
    expect(codex.instanceId).toBe("codex");
    expect(codex.runtime).toBe("codex");
    expect(codex.agentName).toBeNull();
    expect(codex.port).toBeNull();
    expect(codex.installed).toBe(true);
    expect(codex.bridgeMode).toBe("app-server");
    expect(codex.configPath).toBe("/home/.codex/config.toml");

    // Claude instance
    const claude = v2.instances["claude"];
    expect(claude.instanceId).toBe("claude");
    expect(claude.runtime).toBe("claude");
    expect(claude.bridgeMode).toBe("native-push");
  });

  it("handles empty runtimes", () => {
    const v1: TapStateV1 = {
      schemaVersion: 1,
      createdAt: "2026-03-20T00:00:00.000Z",
      updatedAt: "2026-03-23T00:00:00.000Z",
      commsDir: "/comms",
      repoRoot: "/repo",
      packageVersion: "0.1.0",
      runtimes: {},
    };

    const v2 = migrateStateV1toV2(v1);
    expect(v2.schemaVersion).toBe(2);
    expect(Object.keys(v2.instances)).toHaveLength(0);
  });

  it("preserves metadata fields", () => {
    const v1: TapStateV1 = {
      schemaVersion: 1,
      createdAt: "2026-03-20T00:00:00.000Z",
      updatedAt: "2026-03-23T12:00:00.000Z",
      commsDir: "/custom/comms",
      repoRoot: "/custom/repo",
      packageVersion: "0.2.0",
      runtimes: {},
    };

    const v2 = migrateStateV1toV2(v1);
    expect(v2.createdAt).toBe("2026-03-20T00:00:00.000Z");
    expect(v2.updatedAt).toBe("2026-03-23T12:00:00.000Z");
    expect(v2.commsDir).toBe("/custom/comms");
    expect(v2.repoRoot).toBe("/custom/repo");
    expect(v2.packageVersion).toBe("0.2.0");
  });
});

describe("loadState auto-migration", () => {
  it("auto-migrates v1 state file to v2", () => {
    const v1State = {
      schemaVersion: 1,
      createdAt: "2026-03-20T00:00:00.000Z",
      updatedAt: "2026-03-23T00:00:00.000Z",
      commsDir: path.join(tmpDir, "comms"),
      repoRoot: tmpDir,
      packageVersion: "0.1.0",
      runtimes: {
        codex: {
          installed: true,
          configPath: "",
          bridgeMode: "app-server",
          restartRequired: false,
          ownedArtifacts: [],
          backupPath: "",
          lastAppliedHash: "",
          lastVerifiedAt: null,
          bridge: null,
          warnings: [],
        },
      },
    };

    fs.writeFileSync(
      path.join(tmpDir, ".tap-comms", "state.json"),
      JSON.stringify(v1State, null, 2),
      "utf-8",
    );

    const loaded = loadState(tmpDir);
    expect(loaded).not.toBeNull();
    expect(loaded!.schemaVersion).toBe(2);
    expect(loaded!.instances).toBeDefined();
    expect(loaded!.instances["codex"]).toBeDefined();
    expect(loaded!.instances["codex"].instanceId).toBe("codex");
    expect(loaded!.instances["codex"].runtime).toBe("codex");

    // Should have persisted the migrated state
    const persisted = JSON.parse(
      fs.readFileSync(path.join(tmpDir, ".tap-comms", "state.json"), "utf-8"),
    );
    expect(persisted.schemaVersion).toBe(2);
    expect(persisted.instances).toBeDefined();
  });

  it("loads v2 state without re-migrating", () => {
    const v2State = {
      schemaVersion: 2,
      createdAt: "2026-03-20T00:00:00.000Z",
      updatedAt: "2026-03-24T00:00:00.000Z",
      commsDir: path.join(tmpDir, "comms"),
      repoRoot: tmpDir,
      packageVersion: "0.1.0",
      instances: {
        "codex-reviewer": {
          instanceId: "codex-reviewer",
          runtime: "codex",
          agentName: "reviewer",
          port: 4501,
          installed: true,
          configPath: "",
          bridgeMode: "app-server",
          restartRequired: false,
          ownedArtifacts: [],
          backupPath: "",
          lastAppliedHash: "",
          lastVerifiedAt: null,
          bridge: null,
          warnings: [],
        },
      },
    };

    fs.writeFileSync(
      path.join(tmpDir, ".tap-comms", "state.json"),
      JSON.stringify(v2State, null, 2),
      "utf-8",
    );

    const loaded = loadState(tmpDir);
    expect(loaded).not.toBeNull();
    expect(loaded!.schemaVersion).toBe(2);
    expect(loaded!.instances["codex-reviewer"].port).toBe(4501);
  });
});

// M123 MCP key migration adapter-level tests are in:
// - codex-adapter.test.ts (TOML migration via real codexAdapter.apply)
// - gemini-adapter.test.ts (JSON migration via real geminiAdapter.apply)
// - claude-adapter.test.ts (JSON migration via real claudeAdapter.apply)
