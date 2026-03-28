import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  saveBridgeState,
  isAppServerUsedByOtherBridge,
} from "../engine/bridge.js";
import type { BridgeState, AppServerState } from "../types.js";

let tmpDir: string;
let stateDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tap-stop-iso-"));
  stateDir = tmpDir;
  fs.mkdirSync(path.join(stateDir, "pids"), { recursive: true });
});

afterEach(() => {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // best-effort cleanup
  }
});

function makeAppServer(
  overrides: Partial<AppServerState> = {},
): AppServerState {
  return {
    url: "ws://127.0.0.1:4501",
    pid: 9999,
    managed: true,
    healthy: true,
    lastCheckedAt: new Date().toISOString(),
    lastHealthyAt: new Date().toISOString(),
    logPath: "/tmp/log",
    manualCommand: "codex app-server",
    auth: null,
    ...overrides,
  };
}

function makeBridgeState(
  pid: number,
  appServer: AppServerState | null = null,
): BridgeState {
  return {
    pid,
    statePath: "",
    lastHeartbeat: new Date().toISOString(),
    appServer,
    runtimeStateDir: null,
  };
}

describe("isAppServerUsedByOtherBridge", () => {
  const appServer = makeAppServer({ pid: 9999 });

  it("returns false when no other bridges exist", () => {
    expect(
      isAppServerUsedByOtherBridge(stateDir, "codex" as any, appServer),
    ).toBe(false);
  });

  it("returns false when other bridge uses a different app-server", () => {
    const otherAppServer = makeAppServer({
      pid: 8888,
      url: "ws://127.0.0.1:4502",
    });
    saveBridgeState(
      stateDir,
      "codex-reviewer" as any,
      makeBridgeState(process.pid, otherAppServer),
    );

    expect(
      isAppServerUsedByOtherBridge(stateDir, "codex" as any, appServer),
    ).toBe(false);
  });

  it("returns true when another alive bridge shares the same app-server", () => {
    // Use current process PID so isProcessAlive returns true
    saveBridgeState(
      stateDir,
      "codex-reviewer" as any,
      makeBridgeState(process.pid, appServer),
    );

    expect(
      isAppServerUsedByOtherBridge(stateDir, "codex" as any, appServer),
    ).toBe(true);
  });

  it("returns false when the sharing bridge is the excluded instance", () => {
    saveBridgeState(
      stateDir,
      "codex" as any,
      makeBridgeState(process.pid, appServer),
    );

    expect(
      isAppServerUsedByOtherBridge(stateDir, "codex" as any, appServer),
    ).toBe(false);
  });

  it("returns false when other bridge has same app-server but bridge process is dead", () => {
    // PID 1 is init/system — won't match our process, and kill(1,0) may fail
    // Use a very high PID unlikely to exist
    saveBridgeState(
      stateDir,
      "codex-reviewer" as any,
      makeBridgeState(99999999, appServer),
    );

    expect(
      isAppServerUsedByOtherBridge(stateDir, "codex" as any, appServer),
    ).toBe(false);
  });
});
