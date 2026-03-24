import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  rotateLog,
  updateBridgeHeartbeat,
  getHeartbeatAge,
  saveBridgeState,
  loadBridgeState,
} from "../engine/bridge.js";
import type { BridgeState } from "../types.js";

let tmpDir: string;
let stateDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tap-bridge-enh-test-"));
  stateDir = tmpDir;
  fs.mkdirSync(path.join(stateDir, "pids"), { recursive: true });
  fs.mkdirSync(path.join(stateDir, "logs"), { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ─── Log Rotation ──────────────────────────────────────────────

describe("rotateLog", () => {
  it("rotates existing log to .prev", () => {
    const logPath = path.join(stateDir, "logs", "bridge-codex.log");
    fs.writeFileSync(logPath, "line 1\nline 2\n", "utf-8");

    rotateLog(logPath);

    expect(fs.existsSync(logPath)).toBe(false);
    expect(fs.existsSync(`${logPath}.prev`)).toBe(true);
    expect(fs.readFileSync(`${logPath}.prev`, "utf-8")).toBe(
      "line 1\nline 2\n",
    );
  });

  it("does nothing when log does not exist", () => {
    const logPath = path.join(stateDir, "logs", "bridge-codex.log");
    expect(() => rotateLog(logPath)).not.toThrow();
  });

  it("does nothing when log is empty", () => {
    const logPath = path.join(stateDir, "logs", "bridge-codex.log");
    fs.writeFileSync(logPath, "", "utf-8");

    rotateLog(logPath);

    // Empty log should not be rotated
    expect(fs.existsSync(logPath)).toBe(true);
    expect(fs.existsSync(`${logPath}.prev`)).toBe(false);
  });

  it("overwrites previous .prev file", () => {
    const logPath = path.join(stateDir, "logs", "bridge-codex.log");
    const prevPath = `${logPath}.prev`;

    fs.writeFileSync(prevPath, "old content", "utf-8");
    fs.writeFileSync(logPath, "new content", "utf-8");

    rotateLog(logPath);

    expect(fs.readFileSync(prevPath, "utf-8")).toBe("new content");
  });
});

// ─── Heartbeat ─────────────────────────────────────────────────

describe("updateBridgeHeartbeat", () => {
  it("updates lastHeartbeat timestamp", () => {
    const oldTime = "2026-01-01T00:00:00.000Z";
    const state: BridgeState = {
      pid: process.pid,
      statePath: path.join(stateDir, "pids", "bridge-codex.json"),
      lastHeartbeat: oldTime,
    };
    saveBridgeState(stateDir, "codex", state);

    updateBridgeHeartbeat(stateDir, "codex");

    const updated = loadBridgeState(stateDir, "codex");
    expect(updated).not.toBeNull();
    expect(updated!.lastHeartbeat).not.toBe(oldTime);
    // Should be a recent timestamp
    const diff = Date.now() - new Date(updated!.lastHeartbeat).getTime();
    expect(diff).toBeLessThan(5000);
  });

  it("does nothing when no PID file exists", () => {
    expect(() => updateBridgeHeartbeat(stateDir, "codex")).not.toThrow();
    expect(loadBridgeState(stateDir, "codex")).toBeNull();
  });

  it("refuses to update heartbeat for non-owning process", () => {
    const oldTime = "2026-01-01T00:00:00.000Z";
    const state: BridgeState = {
      pid: 999999, // different PID — not this process
      statePath: path.join(stateDir, "pids", "bridge-codex.json"),
      lastHeartbeat: oldTime,
    };
    saveBridgeState(stateDir, "codex", state);

    updateBridgeHeartbeat(stateDir, "codex");

    // Heartbeat should NOT be updated since PID doesn't match
    const unchanged = loadBridgeState(stateDir, "codex");
    expect(unchanged).not.toBeNull();
    expect(unchanged!.lastHeartbeat).toBe(oldTime);
  });
});

describe("getHeartbeatAge", () => {
  it("returns age in seconds for valid heartbeat", () => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const state: BridgeState = {
      pid: process.pid,
      statePath: path.join(stateDir, "pids", "bridge-codex.json"),
      lastHeartbeat: fiveMinAgo,
    };
    saveBridgeState(stateDir, "codex", state);

    const age = getHeartbeatAge(stateDir, "codex");
    expect(age).not.toBeNull();
    // Should be roughly 300 seconds (5 min), allow 5s tolerance
    expect(age!).toBeGreaterThanOrEqual(295);
    expect(age!).toBeLessThanOrEqual(305);
  });

  it("returns null when no PID file", () => {
    expect(getHeartbeatAge(stateDir, "codex")).toBeNull();
  });

  it("returns null for invalid heartbeat date", () => {
    const state: BridgeState = {
      pid: process.pid,
      statePath: path.join(stateDir, "pids", "bridge-codex.json"),
      lastHeartbeat: "not-a-date",
    };
    saveBridgeState(stateDir, "codex", state);

    expect(getHeartbeatAge(stateDir, "codex")).toBeNull();
  });

  it("returns 0 for very recent heartbeat", () => {
    const state: BridgeState = {
      pid: process.pid,
      statePath: path.join(stateDir, "pids", "bridge-codex.json"),
      lastHeartbeat: new Date().toISOString(),
    };
    saveBridgeState(stateDir, "codex", state);

    const age = getHeartbeatAge(stateDir, "codex");
    expect(age).not.toBeNull();
    expect(age!).toBeLessThanOrEqual(2);
  });
});
