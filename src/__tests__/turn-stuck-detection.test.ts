import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { saveBridgeState, getTurnInfo, isTurnStuck } from "../engine/bridge.js";
import type { BridgeState } from "../types.js";

let tmpDir: string;
let stateDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tap-turn-stuck-"));
  stateDir = tmpDir;
  fs.mkdirSync(path.join(stateDir, "pids"), { recursive: true });
});

afterEach(() => {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
});

function makeBridgeState(runtimeStateDir: string): BridgeState {
  return {
    pid: process.pid,
    statePath: "",
    lastHeartbeat: new Date().toISOString(),
    appServer: null,
    runtimeStateDir,
  };
}

function writeHeartbeat(
  runtimeStateDir: string,
  overrides: Record<string, unknown> = {},
) {
  fs.mkdirSync(runtimeStateDir, { recursive: true });
  fs.writeFileSync(
    path.join(runtimeStateDir, "heartbeat.json"),
    JSON.stringify({
      updatedAt: new Date().toISOString(),
      activeTurnId: null,
      lastTurnStatus: null,
      connected: true,
      initialized: true,
      ...overrides,
    }),
  );
}

describe("getTurnInfo", () => {
  it("returns null when no bridge state exists", () => {
    expect(getTurnInfo(stateDir, "codex" as any)).toBeNull();
  });

  it("returns null when no heartbeat exists", () => {
    const runtimeDir = path.join(tmpDir, "runtime-codex");
    saveBridgeState(stateDir, "codex" as any, makeBridgeState(runtimeDir));
    expect(getTurnInfo(stateDir, "codex" as any)).toBeNull();
  });

  it("returns not stuck when no active turn", () => {
    const runtimeDir = path.join(tmpDir, "runtime-codex");
    saveBridgeState(stateDir, "codex" as any, makeBridgeState(runtimeDir));
    writeHeartbeat(runtimeDir, { activeTurnId: null });

    const info = getTurnInfo(stateDir, "codex" as any);
    expect(info).not.toBeNull();
    expect(info!.stuck).toBe(false);
    expect(info!.activeTurnId).toBeNull();
  });

  it("returns not stuck when active turn is recent", () => {
    const runtimeDir = path.join(tmpDir, "runtime-codex");
    saveBridgeState(stateDir, "codex" as any, makeBridgeState(runtimeDir));
    writeHeartbeat(runtimeDir, {
      activeTurnId: "turn-123",
      turnStartedAt: new Date().toISOString(),
    });

    const info = getTurnInfo(stateDir, "codex" as any);
    expect(info!.stuck).toBe(false);
    expect(info!.activeTurnId).toBe("turn-123");
  });

  it("returns stuck when active turn exceeds threshold", () => {
    const runtimeDir = path.join(tmpDir, "runtime-codex");
    saveBridgeState(stateDir, "codex" as any, makeBridgeState(runtimeDir));
    const oldTime = new Date(Date.now() - 10 * 60 * 1000).toISOString(); // 10 min ago
    writeHeartbeat(runtimeDir, {
      activeTurnId: "turn-stuck",
      turnStartedAt: oldTime,
    });

    const info = getTurnInfo(stateDir, "codex" as any, 300); // 5 min threshold
    expect(info!.stuck).toBe(true);
    expect(info!.activeTurnId).toBe("turn-stuck");
    expect(info!.ageSeconds).toBeGreaterThan(500);
  });

  it("not stuck when turnStartedAt absent even with old updatedAt", () => {
    const runtimeDir = path.join(tmpDir, "runtime-codex");
    saveBridgeState(stateDir, "codex" as any, makeBridgeState(runtimeDir));
    const oldTime = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    writeHeartbeat(runtimeDir, {
      activeTurnId: "turn-no-ts",
      updatedAt: oldTime,
      // No turnStartedAt — should NOT be flagged as stuck
    });

    const info = getTurnInfo(stateDir, "codex" as any, 300);
    expect(info!.stuck).toBe(false); // ageSeconds is null without turnStartedAt
  });
});

describe("isTurnStuck", () => {
  it("returns false when no state", () => {
    expect(isTurnStuck(stateDir, "codex" as any)).toBe(false);
  });

  it("returns true for stuck turn", () => {
    const runtimeDir = path.join(tmpDir, "runtime-codex");
    saveBridgeState(stateDir, "codex" as any, makeBridgeState(runtimeDir));
    const oldTime = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    writeHeartbeat(runtimeDir, {
      activeTurnId: "turn-old",
      turnStartedAt: oldTime,
    });

    expect(isTurnStuck(stateDir, "codex" as any, 300)).toBe(true);
  });

  it("returns false for active recent turn", () => {
    const runtimeDir = path.join(tmpDir, "runtime-codex");
    saveBridgeState(stateDir, "codex" as any, makeBridgeState(runtimeDir));
    writeHeartbeat(runtimeDir, {
      activeTurnId: "turn-active",
      updatedAt: new Date().toISOString(),
    });

    expect(isTurnStuck(stateDir, "codex" as any, 300)).toBe(false);
  });
});
