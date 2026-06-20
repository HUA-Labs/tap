import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  loadInstanceConfig,
  saveInstanceConfig,
  listInstanceConfigs,
  deleteInstanceConfig,
  createInstanceConfig,
  reconcileInstanceConfigPaths,
  updateInstanceConfig,
} from "../config/instance-config.js";

let tmpDir: string;
let stateDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tap-inst-config-test-"));
  stateDir = path.join(tmpDir, ".tap-comms");
  fs.mkdirSync(stateDir, { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("instance config CRUD", () => {
  it("creates and loads an instance config", () => {
    const config = createInstanceConfig({
      instanceId: "codex-reviewer",
      runtime: "codex",
      defaultAgentName: "솔",
      port: 4502,
      appServerUrl: "ws://127.0.0.1:4502",
      commsDir: path.join(tmpDir, "tap-comms"),
      stateDir,
      repoRoot: tmpDir,
    });

    expect(config.schemaVersion).toBe(1);
    expect(config.instanceId).toBe("codex-reviewer");
    expect(config.defaultAgentName).toBe("솔");
    expect(config.mcpEnv.TAP_AGENT_NAME).toBe("솔");
    expect(config.configHash).toMatch(/^[0-9a-f]{8}$/);

    saveInstanceConfig(stateDir, config);
    const loaded = loadInstanceConfig(stateDir, "codex-reviewer");
    expect(loaded).not.toBeNull();
    expect(loaded!.instanceId).toBe("codex-reviewer");
    expect(loaded!.defaultAgentName).toBe("솔");
  });

  it("returns null for nonexistent instance", () => {
    expect(loadInstanceConfig(stateDir, "nonexistent")).toBeNull();
  });

  it("lists all instance configs", () => {
    const c1 = createInstanceConfig({
      instanceId: "codex",
      runtime: "codex",
      defaultAgentName: null,
      port: 4501,
      appServerUrl: "ws://127.0.0.1:4501",
      commsDir: "/comms",
      stateDir,
      repoRoot: tmpDir,
    });
    const c2 = createInstanceConfig({
      instanceId: "codex-reviewer",
      runtime: "codex",
      defaultAgentName: "결",
      port: 4502,
      appServerUrl: "ws://127.0.0.1:4502",
      commsDir: "/comms",
      stateDir,
      repoRoot: tmpDir,
    });

    saveInstanceConfig(stateDir, c1);
    saveInstanceConfig(stateDir, c2);

    const all = listInstanceConfigs(stateDir);
    expect(all).toHaveLength(2);
    const ids = all.map((c) => c.instanceId).sort();
    expect(ids).toEqual(["codex", "codex-reviewer"]);
  });

  it("deletes an instance config", () => {
    const config = createInstanceConfig({
      instanceId: "codex",
      runtime: "codex",
      defaultAgentName: null,
      port: null,
      appServerUrl: "ws://127.0.0.1:4501",
      commsDir: "/comms",
      stateDir,
      repoRoot: tmpDir,
    });
    saveInstanceConfig(stateDir, config);
    expect(loadInstanceConfig(stateDir, "codex")).not.toBeNull();

    const deleted = deleteInstanceConfig(stateDir, "codex");
    expect(deleted).toBe(true);
    expect(loadInstanceConfig(stateDir, "codex")).toBeNull();
  });

  it("returns false when deleting nonexistent config", () => {
    expect(deleteInstanceConfig(stateDir, "nonexistent")).toBe(false);
  });
});

describe("instance config update", () => {
  it("updates defaultAgentName and syncs mcpEnv", () => {
    const config = createInstanceConfig({
      instanceId: "codex",
      runtime: "codex",
      defaultAgentName: null,
      port: null,
      appServerUrl: "ws://127.0.0.1:4501",
      commsDir: "/comms",
      stateDir,
      repoRoot: tmpDir,
    });

    expect(config.mcpEnv.TAP_AGENT_NAME).toBe("<set-per-session>");

    const updated = updateInstanceConfig(config, { defaultAgentName: "돌" });
    expect(updated.defaultAgentName).toBe("돌");
    expect(updated.mcpEnv.TAP_AGENT_NAME).toBe("돌");
    expect(updated.configHash).not.toBe(config.configHash);
  });

  it("updates port without affecting defaultAgentName", () => {
    const config = createInstanceConfig({
      instanceId: "codex",
      runtime: "codex",
      defaultAgentName: "솔",
      port: 4501,
      appServerUrl: "ws://127.0.0.1:4501",
      commsDir: "/comms",
      stateDir,
      repoRoot: tmpDir,
    });

    const updated = updateInstanceConfig(config, { port: 4502 });
    expect(updated.port).toBe(4502);
    expect(updated.defaultAgentName).toBe("솔");
    expect(updated.mcpEnv.TAP_AGENT_NAME).toBe("솔");
  });

  it("reconciles stale path fields and TAP env values", () => {
    const config = createInstanceConfig({
      instanceId: "codex",
      runtime: "codex",
      defaultAgentName: "솔",
      port: 4501,
      appServerUrl: "ws://127.0.0.1:4501",
      commsDir: path.join(tmpDir, "old-comms"),
      stateDir: path.join(tmpDir, ".tap-comms-old"),
      repoRoot: path.join(tmpDir, "old-repo"),
    });

    const updated = reconcileInstanceConfigPaths(config, {
      commsDir: path.join(tmpDir, "tap-comms"),
      stateDir,
      repoRoot: tmpDir,
    });

    expect(updated.commsDir).toBe(path.join(tmpDir, "tap-comms"));
    expect(updated.stateDir).toBe(stateDir);
    expect(updated.mcpEnv.TAP_COMMS_DIR).toBe(path.join(tmpDir, "tap-comms"));
    expect(updated.mcpEnv.TAP_STATE_DIR).toBe(stateDir);
    expect(updated.mcpEnv.TAP_REPO_ROOT).toBe(tmpDir);
    expect(updated).not.toBe(config);
  });
});

describe("multi-instance isolation", () => {
  it("maintains independent configs for different instances", () => {
    const worker = createInstanceConfig({
      instanceId: "codex-worker",
      runtime: "codex",
      defaultAgentName: "솔",
      port: 4501,
      appServerUrl: "ws://127.0.0.1:4501",
      commsDir: "/comms",
      stateDir,
      repoRoot: tmpDir,
    });
    const reviewer = createInstanceConfig({
      instanceId: "codex-reviewer",
      runtime: "codex",
      defaultAgentName: "결",
      port: 4502,
      appServerUrl: "ws://127.0.0.1:4502",
      commsDir: "/comms",
      stateDir,
      repoRoot: tmpDir,
    });

    saveInstanceConfig(stateDir, worker);
    saveInstanceConfig(stateDir, reviewer);

    const loadedWorker = loadInstanceConfig(stateDir, "codex-worker");
    const loadedReviewer = loadInstanceConfig(stateDir, "codex-reviewer");

    expect(loadedWorker!.defaultAgentName).toBe("솔");
    expect(loadedReviewer!.defaultAgentName).toBe("결");
    expect(loadedWorker!.port).toBe(4501);
    expect(loadedReviewer!.port).toBe(4502);

    // Update one doesn't affect the other
    const updatedWorker = updateInstanceConfig(loadedWorker!, {
      defaultAgentName: "돌",
    });
    saveInstanceConfig(stateDir, updatedWorker);

    const reloadedReviewer = loadInstanceConfig(stateDir, "codex-reviewer");
    expect(reloadedReviewer!.defaultAgentName).toBe("결"); // unchanged
  });
});

describe("path traversal prevention", () => {
  it("blocks instanceId with path separators", () => {
    expect(() => loadInstanceConfig(stateDir, "../sessions/gen22")).toThrow();
  });

  it("blocks instanceId with backslash", () => {
    expect(() => loadInstanceConfig(stateDir, "..\\evil")).toThrow();
  });

  it("blocks instanceId with dotdot", () => {
    expect(() => loadInstanceConfig(stateDir, "foo..bar")).toThrow();
  });
});

describe("M350 legacy identity field migration", () => {
  it("backfills defaultAgentName from legacy agentName on load and strips the deprecated fields", () => {
    // Simulate a pre-M350 instance config file written directly to disk
    // with `agentName` + `agentId` duplicates and no `defaultAgentName`.
    const legacyFilePath = path.join(
      stateDir,
      "instances",
      "codex-legacy.json",
    );
    fs.mkdirSync(path.dirname(legacyFilePath), { recursive: true });
    const now = new Date().toISOString();
    const legacyContent = {
      schemaVersion: 1,
      instanceId: "codex-legacy",
      runtime: "codex",
      // NOTE: no defaultAgentName — only the deprecated fields exist
      agentName: "담",
      agentId: "codex-legacy",
      port: 4501,
      appServerUrl: "ws://127.0.0.1:4501",
      appServerUnsandboxed: false,
      permission: {
        role: "custom",
        capabilities: { fs_read: true },
      },
      mcpEnv: {
        TAP_COMMS_DIR: "/comms",
        TAP_STATE_DIR: stateDir,
        TAP_REPO_ROOT: tmpDir,
        TAP_AGENT_NAME: "담",
      },
      configHash: "deadbeef",
      lastSyncedToRuntime: null,
      runtimeConfigHash: "",
      createdAt: now,
      updatedAt: now,
    };
    fs.writeFileSync(legacyFilePath, JSON.stringify(legacyContent, null, 2));

    const loaded = loadInstanceConfig(stateDir, "codex-legacy");
    expect(loaded).not.toBeNull();
    // Canonical field is backfilled from the legacy agentName.
    expect(loaded!.defaultAgentName).toBe("담");
    // Legacy duplicates are stripped from the in-memory shape.
    expect(
      (loaded as unknown as Record<string, unknown>).agentName,
    ).toBeUndefined();
    expect(
      (loaded as unknown as Record<string, unknown>).agentId,
    ).toBeUndefined();
  });
});
