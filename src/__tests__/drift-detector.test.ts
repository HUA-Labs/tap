import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  checkInstanceDrift,
  checkAllDrift,
  computeFileHash,
} from "../config/drift-detector.js";
import {
  createInstanceConfig,
  saveInstanceConfig,
} from "../config/instance-config.js";
import type { TapState, InstanceState } from "../types.js";

let tmpDir: string;
let stateDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tap-drift-test-"));
  stateDir = path.join(tmpDir, ".tap-comms");
  fs.mkdirSync(stateDir, { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function makeState(
  instances: Record<string, Partial<InstanceState>>,
): TapState {
  const full: TapState = {
    schemaVersion: 3,
    createdAt: "",
    updatedAt: "",
    commsDir: path.join(tmpDir, "tap-comms"),
    repoRoot: tmpDir,
    packageVersion: "0.3.0",
    instances: {},
  };
  for (const [id, partial] of Object.entries(instances)) {
    full.instances[id] = {
      instanceId: id,
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
      warnings: [],
      ...partial,
    } as InstanceState;
  }
  return full;
}

describe("computeFileHash", () => {
  it("returns empty for nonexistent file", () => {
    expect(computeFileHash("/nonexistent/file.json")).toBe("");
  });

  it("returns consistent hash for same content", () => {
    const filePath = path.join(tmpDir, "test.json");
    fs.writeFileSync(filePath, '{"key": "value"}');
    const h1 = computeFileHash(filePath);
    const h2 = computeFileHash(filePath);
    expect(h1).toBe(h2);
    expect(h1.length).toBe(16);
  });

  it("returns different hash for different content", () => {
    const f1 = path.join(tmpDir, "a.json");
    const f2 = path.join(tmpDir, "b.json");
    fs.writeFileSync(f1, '{"a": 1}');
    fs.writeFileSync(f2, '{"b": 2}');
    expect(computeFileHash(f1)).not.toBe(computeFileHash(f2));
  });
});

describe("checkInstanceDrift", () => {
  it("returns ok when instance config and state match", () => {
    const config = createInstanceConfig({
      instanceId: "codex",
      runtime: "codex",
      agentName: "솔",
      agentId: null,
      port: 4501,
      appServerUrl: "ws://127.0.0.1:4501",
      commsDir: path.join(tmpDir, "tap-comms"),
      stateDir,
      repoRoot: tmpDir,
    });
    saveInstanceConfig(stateDir, config);

    const state = makeState({
      codex: {
        agentName: "솔",
        port: 4501,
        configHash: config.configHash,
      },
    });

    const result = checkInstanceDrift(stateDir, "codex", state);
    expect(result.status).toBe("ok");
    expect(result.checks.every((c) => c.status === "ok")).toBe(true);
  });

  it("detects agentName drift between instance config and state", () => {
    const config = createInstanceConfig({
      instanceId: "codex",
      runtime: "codex",
      agentName: "돌",
      agentId: null,
      port: 4501,
      appServerUrl: "ws://127.0.0.1:4501",
      commsDir: path.join(tmpDir, "tap-comms"),
      stateDir,
      repoRoot: tmpDir,
    });
    saveInstanceConfig(stateDir, config);

    const state = makeState({
      codex: { agentName: "솔", port: 4501 },
    });

    const result = checkInstanceDrift(stateDir, "codex", state);
    expect(result.status).toBe("drifted");
    const stateCheck = result.checks.find(
      (c) => c.name === "state consistency",
    );
    expect(stateCheck?.status).toBe("drifted");
    expect(stateCheck?.details).toContain("agentName");
    expect(stateCheck?.autoFixable).toBe(true);
  });

  it("detects port drift", () => {
    const config = createInstanceConfig({
      instanceId: "codex",
      runtime: "codex",
      agentName: "솔",
      agentId: null,
      port: 4502,
      appServerUrl: "ws://127.0.0.1:4502",
      commsDir: path.join(tmpDir, "tap-comms"),
      stateDir,
      repoRoot: tmpDir,
    });
    saveInstanceConfig(stateDir, config);

    const state = makeState({
      codex: { agentName: "솔", port: 4501 },
    });

    const result = checkInstanceDrift(stateDir, "codex", state);
    expect(result.status).toBe("drifted");
    const check = result.checks.find((c) => c.name === "state consistency");
    expect(check?.details).toContain("port");
  });

  it("skips missing instance config for pre-M214 instances (no configSourceFile)", () => {
    const state = makeState({
      codex: { agentName: "솔", installed: true },
    });

    const result = checkInstanceDrift(stateDir, "codex", state);
    expect(result.status).toBe("ok");
  });

  it("detects missing instance config for M214+ installed instance", () => {
    const state = makeState({
      codex: {
        agentName: "솔",
        installed: true,
        configSourceFile: "/some/path.json",
      },
    });

    const result = checkInstanceDrift(stateDir, "codex", state);
    expect(result.status).toBe("missing");
    const check = result.checks.find(
      (c) => c.name === "instance config exists",
    );
    expect(check?.status).toBe("missing");
    expect(check?.autoFixable).toBe(false);
  });

  it("detects empty configHash as not-baselined drift", () => {
    const config = createInstanceConfig({
      instanceId: "codex",
      runtime: "codex",
      agentName: "솔",
      agentId: null,
      port: 4501,
      appServerUrl: "ws://127.0.0.1:4501",
      commsDir: path.join(tmpDir, "tap-comms"),
      stateDir,
      repoRoot: tmpDir,
    });
    saveInstanceConfig(stateDir, config);

    const state = makeState({
      codex: {
        agentName: "솔",
        port: 4501,
        configHash: "", // empty = not baselined (v2→v3 migration)
      },
    });

    const result = checkInstanceDrift(stateDir, "codex", state);
    expect(result.status).toBe("drifted");
    const check = result.checks.find((c) => c.name === "config hash baseline");
    expect(check?.status).toBe("drifted");
    expect(check?.autoFixable).toBe(true);
    expect(check?.details).toContain("not baselined");
  });

  it("detects runtime config drift via file hash", () => {
    const configTomlPath = path.join(tmpDir, "config.toml");
    fs.writeFileSync(configTomlPath, '[mcp_servers.tap]\ncommand = "node"\n');

    const config = createInstanceConfig({
      instanceId: "codex",
      runtime: "codex",
      agentName: "솔",
      agentId: null,
      port: 4501,
      appServerUrl: "ws://127.0.0.1:4501",
      commsDir: path.join(tmpDir, "tap-comms"),
      stateDir,
      repoRoot: tmpDir,
    });
    // Set a stale runtime hash
    config.runtimeConfigHash = "stale_hash_00000";
    saveInstanceConfig(stateDir, config);

    const state = makeState({
      codex: {
        agentName: "솔",
        port: 4501,
        configHash: config.configHash,
        configPath: configTomlPath,
      },
    });

    const result = checkInstanceDrift(stateDir, "codex", state);
    const runtimeCheck = result.checks.find((c) => c.name === "runtime config");
    expect(runtimeCheck?.status).toBe("drifted");
    expect(runtimeCheck?.details).toContain("changed since last sync");
  });

  it("detects empty runtimeConfigHash as not-baselined", () => {
    const configTomlPath = path.join(tmpDir, "config.toml");
    fs.writeFileSync(configTomlPath, '[mcp_servers.tap]\ncommand = "node"\n');

    const config = createInstanceConfig({
      instanceId: "codex",
      runtime: "codex",
      agentName: "솔",
      agentId: null,
      port: 4501,
      appServerUrl: "ws://127.0.0.1:4501",
      commsDir: path.join(tmpDir, "tap-comms"),
      stateDir,
      repoRoot: tmpDir,
    });
    // runtimeConfigHash is "" by default — never baselined
    saveInstanceConfig(stateDir, config);

    const state = makeState({
      codex: {
        agentName: "솔",
        port: 4501,
        configHash: config.configHash,
        configPath: configTomlPath,
      },
    });

    const result = checkInstanceDrift(stateDir, "codex", state);
    const baselineCheck = result.checks.find(
      (c) => c.name === "runtime config baseline",
    );
    expect(baselineCheck?.status).toBe("drifted");
    expect(baselineCheck?.autoFixable).toBe(true);
    expect(baselineCheck?.details).toContain("not baselined");
  });

  it("detects orphaned instance config", () => {
    const config = createInstanceConfig({
      instanceId: "codex-orphan",
      runtime: "codex",
      agentName: null,
      agentId: null,
      port: null,
      appServerUrl: "ws://127.0.0.1:4501",
      commsDir: "/comms",
      stateDir,
      repoRoot: tmpDir,
    });
    saveInstanceConfig(stateDir, config);

    const state = makeState({}); // no instances

    const result = checkInstanceDrift(stateDir, "codex-orphan", state);
    expect(result.status).toBe("orphaned");
  });

  it("detects config hash drift", () => {
    const config = createInstanceConfig({
      instanceId: "codex",
      runtime: "codex",
      agentName: "솔",
      agentId: null,
      port: 4501,
      appServerUrl: "ws://127.0.0.1:4501",
      commsDir: path.join(tmpDir, "tap-comms"),
      stateDir,
      repoRoot: tmpDir,
    });
    saveInstanceConfig(stateDir, config);

    const state = makeState({
      codex: {
        agentName: "솔",
        port: 4501,
        configHash: "stale0000", // different from actual
      },
    });

    const result = checkInstanceDrift(stateDir, "codex", state);
    expect(result.status).toBe("drifted");
    const check = result.checks.find((c) => c.name === "config hash");
    expect(check?.status).toBe("drifted");
  });
});

describe("checkAllDrift", () => {
  it("checks all instances in state + orphans", () => {
    const c1 = createInstanceConfig({
      instanceId: "codex",
      runtime: "codex",
      agentName: "솔",
      agentId: null,
      port: 4501,
      appServerUrl: "ws://127.0.0.1:4501",
      commsDir: "/comms",
      stateDir,
      repoRoot: tmpDir,
    });
    const c2 = createInstanceConfig({
      instanceId: "codex-orphan",
      runtime: "codex",
      agentName: null,
      agentId: null,
      port: null,
      appServerUrl: "ws://127.0.0.1:4501",
      commsDir: "/comms",
      stateDir,
      repoRoot: tmpDir,
    });
    saveInstanceConfig(stateDir, c1);
    saveInstanceConfig(stateDir, c2);

    const state = makeState({
      codex: { agentName: "솔", port: 4501, configHash: c1.configHash },
    });

    const results = checkAllDrift(stateDir, state);
    expect(results).toHaveLength(2);

    const codex = results.find((r) => r.instanceId === "codex");
    expect(codex?.status).toBe("ok");

    const orphan = results.find((r) => r.instanceId === "codex-orphan");
    expect(orphan?.status).toBe("orphaned");
  });
});
