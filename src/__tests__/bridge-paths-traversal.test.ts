import { describe, it, expect } from "vitest";
import {
  appServerLogFilePath,
  appServerGatewayLogFilePath,
  appServerGatewayTokenFilePath,
  pidFilePath,
  logFilePath,
} from "../engine/bridge-paths.js";
import { getBridgeRuntimeStateDir } from "../engine/bridge-startup.js";

import * as path from "node:path";
import * as os from "node:os";

// Use an absolute temp path so path.resolve works consistently
const STATE_DIR = path.join(os.tmpdir(), "tap-state-test");

describe("bridge-paths path traversal prevention", () => {
  it("allows normal instance IDs", () => {
    expect(() => appServerLogFilePath(STATE_DIR, "codex")).not.toThrow();
    expect(() =>
      appServerGatewayLogFilePath(STATE_DIR, "codex-reviewer"),
    ).not.toThrow();
    expect(() =>
      appServerGatewayTokenFilePath(STATE_DIR, "codex"),
    ).not.toThrow();
    expect(() => pidFilePath(STATE_DIR, "codex")).not.toThrow();
    expect(() => logFilePath(STATE_DIR, "codex")).not.toThrow();
  });

  // These payloads use extra segments to escape past both the filename prefix
  // (e.g., "bridge-") and the subdirectory (e.g., "pids/").
  // "x/../../.." escapes: prefix dir → subdir → stateDir
  const traversalIds = [
    "x/../../..",
    "foo/../../etc/passwd",
    "x/../../../outside",
  ];

  for (const id of traversalIds) {
    it(`blocks traversal in appServerLogFilePath: "${id}"`, () => {
      expect(() => appServerLogFilePath(STATE_DIR, id)).toThrow(
        "Path traversal blocked",
      );
    });

    it(`blocks traversal in appServerGatewayTokenFilePath: "${id}"`, () => {
      expect(() => appServerGatewayTokenFilePath(STATE_DIR, id)).toThrow(
        "Path traversal blocked",
      );
    });

    it(`blocks traversal in pidFilePath: "${id}"`, () => {
      expect(() => pidFilePath(STATE_DIR, id)).toThrow(
        "Path traversal blocked",
      );
    });

    it(`blocks traversal in logFilePath: "${id}"`, () => {
      expect(() => logFilePath(STATE_DIR, id)).toThrow(
        "Path traversal blocked",
      );
    });
  }
});

describe("getBridgeRuntimeStateDir path traversal prevention", () => {
  const REPO_ROOT = path.join(os.tmpdir(), "tap-repo-test");

  it("allows normal instance IDs", () => {
    expect(() => getBridgeRuntimeStateDir(REPO_ROOT, "codex")).not.toThrow();
    expect(() =>
      getBridgeRuntimeStateDir(REPO_ROOT, "codex-reviewer"),
    ).not.toThrow();
  });

  // Prefix "codex-app-server-bridge-" absorbs one ".." — need extra segments
  const traversalIds = [
    "x/../../outside",
    "x/../../../escape",
    "a/b/../../../breakout",
  ];

  for (const id of traversalIds) {
    it(`blocks traversal: "${id}"`, () => {
      expect(() => getBridgeRuntimeStateDir(REPO_ROOT, id)).toThrow(
        "Path traversal blocked",
      );
    });
  }
});
