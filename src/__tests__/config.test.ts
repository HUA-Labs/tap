import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  LEGACY_CONFIG_FILE,
  resolveConfig,
  loadSharedConfig,
  loadLocalConfig,
  saveSharedConfig,
  saveLocalConfig,
  SHARED_CONFIG_FILE,
  LOCAL_CONFIG_FILE,
} from "../config/index.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tap-config-test-"));
  // Create a .git marker so findRepoRoot resolves to tmpDir
  fs.mkdirSync(path.join(tmpDir, ".git"), { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("config file loading", () => {
  it("loadSharedConfig returns null when no file", () => {
    expect(loadSharedConfig(tmpDir)).toBeNull();
  });

  it("loadLocalConfig returns null when no file", () => {
    expect(loadLocalConfig(tmpDir)).toBeNull();
  });

  it("loadSharedConfig parses valid JSON", () => {
    fs.writeFileSync(
      path.join(tmpDir, SHARED_CONFIG_FILE),
      JSON.stringify({ commsDir: "../comms", runtimeCommand: "bun" }),
    );
    const config = loadSharedConfig(tmpDir);
    expect(config).not.toBeNull();
    expect(config!.commsDir).toBe("../comms");
    expect(config!.runtimeCommand).toBe("bun");
  });

  it("loadLocalConfig parses valid JSON", () => {
    fs.writeFileSync(
      path.join(tmpDir, LOCAL_CONFIG_FILE),
      JSON.stringify({ appServerUrl: "ws://localhost:9999" }),
    );
    const config = loadLocalConfig(tmpDir);
    expect(config).not.toBeNull();
    expect(config!.appServerUrl).toBe("ws://localhost:9999");
  });

  it("returns null for corrupted JSON", () => {
    fs.writeFileSync(path.join(tmpDir, SHARED_CONFIG_FILE), "{not valid");
    expect(loadSharedConfig(tmpDir)).toBeNull();
  });
});

describe("config saving", () => {
  it("saveSharedConfig writes valid JSON", () => {
    saveSharedConfig(tmpDir, { commsDir: "./comms", runtimeCommand: "node" });
    const content = fs.readFileSync(
      path.join(tmpDir, SHARED_CONFIG_FILE),
      "utf-8",
    );
    const parsed = JSON.parse(content);
    expect(parsed.commsDir).toBe("./comms");
    expect(parsed.runtimeCommand).toBe("node");
  });

  it("saveLocalConfig writes valid JSON", () => {
    saveLocalConfig(tmpDir, { appServerUrl: "ws://127.0.0.1:4501" });
    const content = fs.readFileSync(
      path.join(tmpDir, LOCAL_CONFIG_FILE),
      "utf-8",
    );
    const parsed = JSON.parse(content);
    expect(parsed.appServerUrl).toBe("ws://127.0.0.1:4501");
  });
});

describe("resolveConfig", () => {
  it("returns defaults when no config files exist", () => {
    const { config, sources } = resolveConfig({}, tmpDir);
    expect(config.repoRoot).toBe(tmpDir);
    expect(config.commsDir).toBe(path.join(tmpDir, "tap-comms"));
    expect(config.stateDir).toBe(path.join(tmpDir, ".tap-comms"));
    expect(config.runtimeCommand).toBe("node");
    expect(config.appServerUrl).toBe("ws://127.0.0.1:4501");
    expect(sources.runtimeCommand).toBe("auto");
    expect(sources.appServerUrl).toBe("auto");
  });

  it("reads from shared config", () => {
    saveSharedConfig(tmpDir, { runtimeCommand: "bun" });
    const { config, sources } = resolveConfig({}, tmpDir);
    expect(config.runtimeCommand).toBe("bun");
    expect(sources.runtimeCommand).toBe("shared-config");
  });

  it("local config overrides shared config", () => {
    saveSharedConfig(tmpDir, { runtimeCommand: "node" });
    saveLocalConfig(tmpDir, { runtimeCommand: "bun" });
    const { config, sources } = resolveConfig({}, tmpDir);
    expect(config.runtimeCommand).toBe("bun");
    expect(sources.runtimeCommand).toBe("local-config");
  });

  it("CLI overrides take highest priority", () => {
    saveSharedConfig(tmpDir, { runtimeCommand: "node" });
    saveLocalConfig(tmpDir, { runtimeCommand: "bun" });
    const { config, sources } = resolveConfig(
      { runtimeCommand: "deno" },
      tmpDir,
    );
    expect(config.runtimeCommand).toBe("deno");
    expect(sources.runtimeCommand).toBe("cli-flag");
  });

  it("env vars override config files", () => {
    saveSharedConfig(tmpDir, { runtimeCommand: "node" });
    const orig = process.env.TAP_RUNTIME_COMMAND;
    process.env.TAP_RUNTIME_COMMAND = "bun";
    try {
      const { config, sources } = resolveConfig({}, tmpDir);
      expect(config.runtimeCommand).toBe("bun");
      expect(sources.runtimeCommand).toBe("env");
    } finally {
      if (orig) {
        process.env.TAP_RUNTIME_COMMAND = orig;
      } else {
        delete process.env.TAP_RUNTIME_COMMAND;
      }
    }
  });

  it("resolves relative commsDir against repoRoot", () => {
    saveSharedConfig(tmpDir, { commsDir: "../my-comms" });
    const { config } = resolveConfig({}, tmpDir);
    expect(config.commsDir).toBe(path.resolve(tmpDir, "../my-comms"));
  });

  it("preserves absolute commsDir as-is", () => {
    const absPath = path.join(os.tmpdir(), "absolute-comms");
    saveLocalConfig(tmpDir, { commsDir: absPath });
    const { config } = resolveConfig({}, tmpDir);
    expect(config.commsDir).toBe(absPath);
  });

  it("falls back to legacy .tap-config for commsDir", () => {
    fs.writeFileSync(
      path.join(tmpDir, LEGACY_CONFIG_FILE),
      'TAP_COMMS_DIR="../hua-comms"\n',
      "utf-8",
    );

    const { config, sources } = resolveConfig({}, tmpDir);

    expect(config.commsDir).toBe(path.resolve(tmpDir, "../hua-comms"));
    expect(sources.commsDir).toBe("legacy-shell-config");
  });

  it("prefers JSON config over legacy .tap-config", () => {
    fs.writeFileSync(
      path.join(tmpDir, LEGACY_CONFIG_FILE),
      'TAP_COMMS_DIR="../legacy-comms"\n',
      "utf-8",
    );
    saveSharedConfig(tmpDir, { commsDir: "../json-comms" });

    const { config, sources } = resolveConfig({}, tmpDir);

    expect(config.commsDir).toBe(path.resolve(tmpDir, "../json-comms"));
    expect(sources.commsDir).toBe("shared-config");
  });
});
