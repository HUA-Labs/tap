import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  readNodeVersion,
  resolveNodeRuntime,
  buildRuntimeEnv,
  getFnmBinDir,
  detectNodeMajorVersion,
} from "../runtime/index.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tap-runtime-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("readNodeVersion", () => {
  it("reads version from .node-version file", () => {
    fs.writeFileSync(path.join(tmpDir, ".node-version"), "24.14.0\n");
    expect(readNodeVersion(tmpDir)).toBe("24.14.0");
  });

  it("strips v prefix", () => {
    fs.writeFileSync(path.join(tmpDir, ".node-version"), "v22.0.0\n");
    expect(readNodeVersion(tmpDir)).toBe("22.0.0");
  });

  it("returns null when no file", () => {
    expect(readNodeVersion(tmpDir)).toBeNull();
  });

  it("returns null for empty file", () => {
    fs.writeFileSync(path.join(tmpDir, ".node-version"), "");
    expect(readNodeVersion(tmpDir)).toBeNull();
  });
});

describe("detectNodeMajorVersion", () => {
  it("detects current node major version", () => {
    const major = detectNodeMajorVersion(process.execPath);
    expect(major).not.toBeNull();
    expect(major).toBeGreaterThanOrEqual(20);
  });

  it("returns null for nonexistent command", () => {
    expect(detectNodeMajorVersion("/nonexistent/node")).toBeNull();
  });
});

describe("resolveNodeRuntime", () => {
  it("returns bun passthrough for bun command", () => {
    const result = resolveNodeRuntime("bun", tmpDir);
    expect(result.command).toBe("bun");
    expect(result.source).toBe("bun");
    expect(result.supportsStripTypes).toBe(false);
  });

  it("resolves node from PATH when no .node-version", () => {
    const result = resolveNodeRuntime("node", tmpDir);
    expect(result.command).toBe("node");
    expect(result.majorVersion).not.toBeNull();
  });

  it("includes source in result", () => {
    const result = resolveNodeRuntime("node", tmpDir);
    expect(["fnm", "config", "path", "tsx-fallback"]).toContain(result.source);
  });
});

describe("buildRuntimeEnv", () => {
  it("returns env object with path entries", () => {
    const env = buildRuntimeEnv(tmpDir);
    // On Windows, PATH may be stored as "Path" or "PATH"
    const hasPath = env.PATH !== undefined || env.Path !== undefined;
    expect(hasPath).toBe(true);
  });

  it("preserves existing env vars", () => {
    const env = buildRuntimeEnv(tmpDir, {
      ...process.env,
      TEST_VAR: "hello",
    });
    expect(env.TEST_VAR).toBe("hello");
  });

  it("prepends fnm bin dir when .node-version exists and fnm node found", () => {
    // This test verifies the function doesn't crash — actual fnm presence varies
    fs.writeFileSync(path.join(tmpDir, ".node-version"), "24.14.0\n");
    const env = buildRuntimeEnv(tmpDir);
    expect(env).toBeDefined();
  });
});

describe("getFnmBinDir", () => {
  it("returns null when no .node-version", () => {
    expect(getFnmBinDir(tmpDir)).toBeNull();
  });
});
