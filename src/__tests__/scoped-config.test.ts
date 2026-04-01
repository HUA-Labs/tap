import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  resolveTrackedConfig,
  saveSharedConfig,
  saveLocalConfig,
  computeConfigHash,
} from "../config/index.js";
import { migrateStateV2toV3 } from "../state.js";
import type { TapState } from "../types.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tap-scoped-config-test-"));
  fs.mkdirSync(path.join(tmpDir, ".git"), { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("resolveTrackedConfig", () => {
  it("returns default sources when no config files exist", () => {
    const { tracked } = resolveTrackedConfig({}, tmpDir);
    expect(tracked.repoRoot.value).toBe(tmpDir);
    expect(tracked.repoRoot.source).toBe("default");
    expect(tracked.commsDir.source).toBe("default");
    expect(tracked.stateDir.source).toBe("default");
    expect(tracked.runtimeCommand.source).toBe("default");
    expect(tracked.runtimeCommand.value).toBe("node");
    expect(tracked.appServerUrl.source).toBe("default");
  });

  it("tracks project source from shared config", () => {
    saveSharedConfig(tmpDir, { runtimeCommand: "bun" });
    const { tracked } = resolveTrackedConfig({}, tmpDir);
    expect(tracked.runtimeCommand.value).toBe("bun");
    expect(tracked.runtimeCommand.source).toBe("project");
    expect(tracked.runtimeCommand.sourceFile).toBe(
      path.join(tmpDir, "tap-config.json"),
    );
  });

  it("tracks local source from local config", () => {
    saveLocalConfig(tmpDir, { runtimeCommand: "bun" });
    const { tracked } = resolveTrackedConfig({}, tmpDir);
    expect(tracked.runtimeCommand.value).toBe("bun");
    expect(tracked.runtimeCommand.source).toBe("local");
    expect(tracked.runtimeCommand.sourceFile).toBe(
      path.join(tmpDir, "tap-config.local.json"),
    );
  });

  it("local overrides project", () => {
    saveSharedConfig(tmpDir, { runtimeCommand: "node" });
    saveLocalConfig(tmpDir, { runtimeCommand: "bun" });
    const { tracked } = resolveTrackedConfig({}, tmpDir);
    expect(tracked.runtimeCommand.value).toBe("bun");
    expect(tracked.runtimeCommand.source).toBe("local");
  });

  it("CLI overrides all", () => {
    saveSharedConfig(tmpDir, { runtimeCommand: "node" });
    saveLocalConfig(tmpDir, { runtimeCommand: "bun" });
    const { tracked } = resolveTrackedConfig(
      { runtimeCommand: "deno" },
      tmpDir,
    );
    expect(tracked.runtimeCommand.value).toBe("deno");
    expect(tracked.runtimeCommand.source).toBe("cli");
  });

  it("env overrides config files", () => {
    saveSharedConfig(tmpDir, { runtimeCommand: "node" });
    const orig = process.env.TAP_RUNTIME_COMMAND;
    process.env.TAP_RUNTIME_COMMAND = "bun";
    try {
      const { tracked } = resolveTrackedConfig({}, tmpDir);
      expect(tracked.runtimeCommand.value).toBe("bun");
      expect(tracked.runtimeCommand.source).toBe("env");
      expect(tracked.runtimeCommand.sourceFile).toBeNull();
    } finally {
      if (orig) {
        process.env.TAP_RUNTIME_COMMAND = orig;
      } else {
        delete process.env.TAP_RUNTIME_COMMAND;
      }
    }
  });

  it("instance config overrides session/local/project", () => {
    const stateDir = path.join(tmpDir, ".tap-comms");
    fs.mkdirSync(path.join(stateDir, "instances"), { recursive: true });
    fs.writeFileSync(
      path.join(stateDir, "instances", "codex-reviewer.json"),
      JSON.stringify({ runtimeCommand: "bun", agentName: "솔", port: 4502 }),
    );
    saveSharedConfig(tmpDir, { runtimeCommand: "node" });

    const { tracked } = resolveTrackedConfig(
      { instanceId: "codex-reviewer" },
      tmpDir,
    );
    expect(tracked.runtimeCommand.value).toBe("bun");
    expect(tracked.runtimeCommand.source).toBe("instance");
    expect(tracked.agentName.value).toBe("솔");
    expect(tracked.agentName.source).toBe("instance");
    expect(tracked.port.value).toBe(4502);
    expect(tracked.port.source).toBe("instance");
  });

  it("session config overrides local/project but not instance", () => {
    const stateDir = path.join(tmpDir, ".tap-comms");
    fs.mkdirSync(path.join(stateDir, "sessions"), { recursive: true });
    fs.mkdirSync(path.join(stateDir, "instances"), { recursive: true });
    fs.writeFileSync(
      path.join(stateDir, "sessions", "gen22.json"),
      JSON.stringify({ runtimeCommand: "bun" }),
    );
    fs.writeFileSync(
      path.join(stateDir, "instances", "codex.json"),
      JSON.stringify({ runtimeCommand: "deno" }),
    );
    saveSharedConfig(tmpDir, { runtimeCommand: "node" });

    const { tracked } = resolveTrackedConfig(
      { instanceId: "codex", sessionId: "gen22" },
      tmpDir,
    );
    // instance (deno) > session (bun) > project (node)
    expect(tracked.runtimeCommand.value).toBe("deno");
    expect(tracked.runtimeCommand.source).toBe("instance");
  });

  it("gracefully handles missing instance/session files", () => {
    const { tracked } = resolveTrackedConfig(
      { instanceId: "nonexistent", sessionId: "nonexistent" },
      tmpDir,
    );
    expect(tracked.runtimeCommand.source).toBe("default");
    expect(tracked.agentName.value).toBeNull();
  });

  it("blocks instanceId traversal across source boundaries", () => {
    const stateDir = path.join(tmpDir, ".tap-comms");
    fs.mkdirSync(path.join(stateDir, "sessions"), { recursive: true });
    fs.writeFileSync(
      path.join(stateDir, "sessions", "gen22.json"),
      JSON.stringify({ runtimeCommand: "stolen" }),
    );

    // crafted instanceId tries to read sessions/gen22.json as instance config
    expect(() =>
      resolveTrackedConfig({ instanceId: "../sessions/gen22" }, tmpDir),
    ).toThrow("Config path traversal blocked");
  });

  it("blocks sessionId traversal across source boundaries", () => {
    const stateDir = path.join(tmpDir, ".tap-comms");
    fs.mkdirSync(path.join(stateDir, "instances"), { recursive: true });
    fs.writeFileSync(
      path.join(stateDir, "instances", "codex.json"),
      JSON.stringify({ runtimeCommand: "stolen" }),
    );

    expect(() =>
      resolveTrackedConfig({ sessionId: "../instances/codex" }, tmpDir),
    ).toThrow("Config path traversal blocked");
  });

  it("null instance-specific fields default correctly", () => {
    const { tracked } = resolveTrackedConfig({}, tmpDir);
    expect(tracked.agentName.value).toBeNull();
    expect(tracked.agentName.source).toBe("default");
    expect(tracked.port.value).toBeNull();
    expect(tracked.bridgeMode.value).toBeNull();
  });
});

describe("computeConfigHash", () => {
  it("produces consistent hash for same config", () => {
    const { tracked, hash } = resolveTrackedConfig({}, tmpDir);
    const hash2 = computeConfigHash(tracked);
    expect(hash).toBe(hash2);
  });

  it("produces different hash when config changes", () => {
    const { hash: hash1 } = resolveTrackedConfig({}, tmpDir);
    saveSharedConfig(tmpDir, { runtimeCommand: "bun" });
    const { hash: hash2 } = resolveTrackedConfig({}, tmpDir);
    expect(hash1).not.toBe(hash2);
  });

  it("hash is 8-character hex string", () => {
    const { hash } = resolveTrackedConfig({}, tmpDir);
    expect(hash).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe("state v2 → v3 migration", () => {
  it("adds configHash and configSourceFile to instances", () => {
    const v2: TapState = {
      schemaVersion: 2,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
      commsDir: "/tmp/comms",
      repoRoot: "/tmp/repo",
      packageVersion: "0.3.0",
      instances: {
        codex: {
          instanceId: "codex",
          runtime: "codex",
          agentName: "솔",
          port: 4501,
          installed: true,
          configPath: "/tmp/config",
          bridgeMode: "app-server",
          restartRequired: false,
          ownedArtifacts: [],
          backupPath: "",
          lastAppliedHash: "",
          lastVerifiedAt: null,
          bridge: null,
          headless: null,
          warnings: [],
        },
      },
    };

    const v3 = migrateStateV2toV3(v2);
    expect(v3.schemaVersion).toBe(3);
    expect(v3.instances.codex.configHash).toBe("");
    expect(v3.instances.codex.configSourceFile).toBe("");
    // Original fields preserved
    expect(v3.instances.codex.agentName).toBe("솔");
    expect(v3.instances.codex.port).toBe(4501);
  });

  it("preserves existing configHash if already present", () => {
    const v2: TapState = {
      schemaVersion: 2,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
      commsDir: "/tmp/comms",
      repoRoot: "/tmp/repo",
      packageVersion: "0.3.0",
      instances: {
        codex: {
          instanceId: "codex",
          runtime: "codex",
          agentName: null,
          port: null,
          installed: true,
          configPath: "",
          bridgeMode: "app-server",
          restartRequired: false,
          ownedArtifacts: [],
          backupPath: "",
          lastAppliedHash: "",
          lastVerifiedAt: null,
          bridge: null,
          headless: null,
          configHash: "abcd1234",
          configSourceFile: "/tmp/inst.json",
          warnings: [],
        },
      },
    };

    const v3 = migrateStateV2toV3(v2);
    expect(v3.instances.codex.configHash).toBe("abcd1234");
    expect(v3.instances.codex.configSourceFile).toBe("/tmp/inst.json");
  });
});
