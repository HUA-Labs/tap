import { afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  resolveWritableStderrLogPath,
  stderrLogFilePath,
} from "../engine/bridge.js";

describe("resolveWritableStderrLogPath", () => {
  let tmpDir: string | null = null;

  afterEach(() => {
    vi.restoreAllMocks();
    if (tmpDir) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      tmpDir = null;
    }
  });

  it("uses the default stderr path when it is writable", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tap-win-spawn-test-"));
    const logPath = path.join(tmpDir, "app-server.log");

    const stderrPath = resolveWritableStderrLogPath(logPath);

    expect(stderrPath).toBe(stderrLogFilePath(logPath));
  });

  it("falls back to a unique stderr path when the default path is locked", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tap-win-spawn-test-"));
    const logPath = path.join(tmpDir, "app-server.log");
    const defaultStderrPath = stderrLogFilePath(logPath);
    const stderrPath = resolveWritableStderrLogPath(logPath, {
      mkdirSync: fs.mkdirSync,
      openSync: (target, flags) => {
        if (target === defaultStderrPath) {
          throw new Error("file busy");
        }
        return fs.openSync(target, flags);
      },
      closeSync: fs.closeSync,
    });

    expect(stderrPath).not.toBe(defaultStderrPath);
    expect(stderrPath.startsWith(`${defaultStderrPath}.`)).toBe(true);
  });
});
