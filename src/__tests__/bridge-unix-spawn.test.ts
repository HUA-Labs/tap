import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const spawnMock = vi.fn();
const spawnSyncMock = vi.fn();

vi.mock("node:child_process", async () => {
  const actual =
    await vi.importActual<typeof import("node:child_process")>(
      "node:child_process",
    );
  return {
    ...actual,
    spawn: spawnMock,
    spawnSync: spawnSyncMock,
  };
});

const {
  startUnixDetachedProcess,
  startUnixCodexAppServer,
  findUnixListeningProcessId,
} = await import("../engine/bridge-unix-spawn.js");
const { stderrLogFilePath } = await import("../engine/bridge-paths.js");

let tmpDir: string;

beforeEach(() => {
  vi.clearAllMocks();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tap-unix-spawn-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("startUnixDetachedProcess", () => {
  it("spawns a detached process and creates stdout/stderr logs", () => {
    const unref = vi.fn();
    spawnMock.mockReturnValue({ pid: 4242, unref });
    const logPath = path.join(tmpDir, "bridge.log");

    const pid = startUnixDetachedProcess(
      "node",
      ["bridge.js"],
      tmpDir,
      logPath,
      { TAP_AGENT_NAME: "신" },
    );

    expect(pid).toBe(4242);
    expect(spawnMock).toHaveBeenCalledWith(
      "node",
      ["bridge.js"],
      expect.objectContaining({
        cwd: tmpDir,
        detached: true,
        env: { TAP_AGENT_NAME: "신" },
        windowsHide: true,
      }),
    );
    expect(unref).toHaveBeenCalled();
    expect(fs.existsSync(logPath)).toBe(true);
    expect(fs.existsSync(stderrLogFilePath(logPath))).toBe(true);
  });
});

describe("startUnixCodexAppServer", () => {
  it("unwraps NUL-separated commands before spawning codex app-server", () => {
    const unref = vi.fn();
    spawnMock.mockReturnValue({ pid: 5150, unref });
    const logPath = path.join(tmpDir, "app-server.log");

    const pid = startUnixCodexAppServer(
      "node\0/tmp/codex.js",
      "ws://127.0.0.1:4501",
      tmpDir,
      logPath,
    );

    expect(pid).toBe(5150);
    expect(spawnMock).toHaveBeenCalledWith(
      "node",
      ["/tmp/codex.js", "app-server", "--listen", "ws://127.0.0.1:4501"],
      expect.any(Object),
    );
  });
});

describe("findUnixListeningProcessId", () => {
  it("returns the first lsof PID on macOS", () => {
    spawnSyncMock.mockReturnValue({
      status: 0,
      stdout: "9132\n9133\n",
      stderr: "",
    });

    expect(findUnixListeningProcessId("ws://127.0.0.1:4501", "darwin")).toBe(
      9132,
    );
    expect(spawnSyncMock).toHaveBeenCalledWith(
      "lsof",
      ["-nP", "-iTCP:4501", "-sTCP:LISTEN", "-t"],
      expect.objectContaining({
        encoding: "utf-8",
        windowsHide: true,
      }),
    );
  });

  it("returns null for Windows or invalid URLs", () => {
    expect(findUnixListeningProcessId("ws://127.0.0.1:4501", "win32")).toBe(
      null,
    );
    expect(findUnixListeningProcessId("not-a-url", "darwin")).toBe(null);
    expect(spawnSyncMock).not.toHaveBeenCalled();
  });
});
