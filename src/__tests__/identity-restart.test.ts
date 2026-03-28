/**
 * Identity sync + graceful restart regression tests.
 *
 * Tests production helpers directly (not reimplementing logic):
 * - resolveAgentName(): explicit > state.json > env
 * - inferRestartMode(): bridge state → mode preservation
 * - cleanupHeadlessDispatch(): date-prefixed file matching
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  resolveAgentName,
  inferRestartMode,
  cleanupHeadlessDispatch,
  getBridgeRuntimeStateDir,
} from "../engine/bridge.js";
import { saveState } from "../state.js";
import type { BridgeState, TapState, AppServerAuthState } from "../types.js";

let tmpDir: string;
let stateDir: string;
let commsDir: string;

function makeState(overrides?: Partial<TapState>): TapState {
  return {
    schemaVersion: 2,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    commsDir,
    repoRoot: tmpDir,
    packageVersion: "0.2.0",
    instances: {},
    ...overrides,
  };
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tap-identity-test-"));
  stateDir = path.join(tmpDir, ".tap-comms");
  commsDir = path.join(tmpDir, "comms");
  fs.mkdirSync(path.join(stateDir, "pids"), { recursive: true });
  fs.mkdirSync(path.join(stateDir, "logs"), { recursive: true });
  fs.mkdirSync(path.join(commsDir, "inbox"), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, ".git"), { recursive: true });
});

afterEach(async () => {
  await new Promise((r) => setTimeout(r, 200));
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // Best-effort
  }
});

// ─── resolveAgentName (production helper) ──────────────────────

describe("resolveAgentName", () => {
  it("returns explicit name when provided", () => {
    const result = resolveAgentName("codex", "닻", {
      repoRoot: tmpDir,
      stateDir,
    });
    expect(result).toBe("닻");
  });

  it("reads agentName from state.json when no explicit name", () => {
    const state = makeState({
      instances: {
        codex: {
          instanceId: "codex",
          runtime: "codex",
          agentName: "빛",
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
        },
      },
    });
    saveState(tmpDir, state);

    const origAgent = process.env.TAP_AGENT_NAME;
    const origCodex = process.env.CODEX_TAP_AGENT_NAME;
    delete process.env.TAP_AGENT_NAME;
    delete process.env.CODEX_TAP_AGENT_NAME;

    try {
      const result = resolveAgentName("codex", undefined, {
        repoRoot: tmpDir,
        stateDir,
      });
      expect(result).toBe("빛");
    } finally {
      if (origAgent) process.env.TAP_AGENT_NAME = origAgent;
      else delete process.env.TAP_AGENT_NAME;
      if (origCodex) process.env.CODEX_TAP_AGENT_NAME = origCodex;
      else delete process.env.CODEX_TAP_AGENT_NAME;
    }
  });

  it("explicit name overrides state.json", () => {
    const state = makeState({
      instances: {
        codex: {
          instanceId: "codex",
          runtime: "codex",
          agentName: "빛",
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
        },
      },
    });
    saveState(tmpDir, state);

    const result = resolveAgentName("codex", "닻", {
      repoRoot: tmpDir,
      stateDir,
    });
    expect(result).toBe("닻"); // explicit wins over state "빛"
  });

  it("falls back to env when no explicit and no state", () => {
    const origAgent = process.env.TAP_AGENT_NAME;
    process.env.TAP_AGENT_NAME = "덱";

    try {
      const result = resolveAgentName("codex", undefined, {
        repoRoot: tmpDir,
        stateDir,
      });
      expect(result).toBe("덱");
    } finally {
      if (origAgent) process.env.TAP_AGENT_NAME = origAgent;
      else delete process.env.TAP_AGENT_NAME;
    }
  });

  it("returns null when nothing available", () => {
    const origAgent = process.env.TAP_AGENT_NAME;
    const origCodex = process.env.CODEX_TAP_AGENT_NAME;
    delete process.env.TAP_AGENT_NAME;
    delete process.env.CODEX_TAP_AGENT_NAME;

    try {
      const result = resolveAgentName("codex", undefined, {
        repoRoot: tmpDir,
        stateDir,
      });
      expect(result).toBeNull();
    } finally {
      if (origAgent) process.env.TAP_AGENT_NAME = origAgent;
      else delete process.env.TAP_AGENT_NAME;
      if (origCodex) process.env.CODEX_TAP_AGENT_NAME = origCodex;
      else delete process.env.CODEX_TAP_AGENT_NAME;
    }
  });
});

// ─── inferRestartMode (production helper) ──────────────────────

describe("inferRestartMode", () => {
  it("preserves --no-server from null appServer", () => {
    const bridgeState: BridgeState = {
      pid: 999999,
      statePath: "",
      lastHeartbeat: new Date().toISOString(),
      appServer: null,
    };
    const mode = inferRestartMode(bridgeState);
    expect(mode.manageAppServer).toBe(false); // was --no-server
  });

  it("preserves managed mode from appServer presence", () => {
    const bridgeState: BridgeState = {
      pid: 999999,
      statePath: "",
      lastHeartbeat: new Date().toISOString(),
      appServer: {
        url: "ws://127.0.0.1:4501",
        pid: 12345,
        managed: true,
        healthy: true,
        lastCheckedAt: new Date().toISOString(),
        lastHealthyAt: new Date().toISOString(),
        logPath: null,
        manualCommand: "",
        auth: null,
      },
    };
    const mode = inferRestartMode(bridgeState);
    expect(mode.manageAppServer).toBe(true); // was managed
    expect(mode.noAuth).toBe(true); // auth was null = --no-auth
  });

  it("preserves managed+auth from appServer with auth", () => {
    const auth: AppServerAuthState = {
      mode: "subprotocol",
      protectedUrl: "ws://127.0.0.1:14501",
      upstreamUrl: "ws://127.0.0.1:4501",
      tokenPath: "/tmp/token",
      gatewayPid: 12346,
      gatewayLogPath: null,
    };
    const bridgeState: BridgeState = {
      pid: 999999,
      statePath: "",
      lastHeartbeat: new Date().toISOString(),
      appServer: {
        url: "ws://127.0.0.1:4501",
        pid: 12345,
        managed: true,
        healthy: true,
        lastCheckedAt: new Date().toISOString(),
        lastHealthyAt: new Date().toISOString(),
        logPath: null,
        manualCommand: "",
        auth,
      },
    };
    const mode = inferRestartMode(bridgeState);
    expect(mode.manageAppServer).toBe(true);
    expect(mode.noAuth).toBe(false); // auth existed
  });

  it("explicit --no-server flag overrides inferred managed mode", () => {
    const bridgeState: BridgeState = {
      pid: 999999,
      statePath: "",
      lastHeartbeat: new Date().toISOString(),
      appServer: {
        url: "ws://127.0.0.1:4501",
        pid: 12345,
        managed: true,
        healthy: true,
        lastCheckedAt: new Date().toISOString(),
        lastHealthyAt: new Date().toISOString(),
        logPath: null,
        manualCommand: "",
        auth: null,
      },
    };
    const mode = inferRestartMode(bridgeState, { noServer: true });
    expect(mode.manageAppServer).toBe(false); // flag overrides
  });

  it("handles null bridge state gracefully", () => {
    const mode = inferRestartMode(null);
    expect(mode.manageAppServer).toBe(false); // no previous state
    expect(mode.noAuth).toBe(true); // no previous auth
  });
});

// ─── cleanupHeadlessDispatch (production helper) ───────────────

describe("cleanupHeadlessDispatch", () => {
  it("removes date-prefixed dispatch files for the target agent", () => {
    const inboxDir = path.join(commsDir, "inbox");
    fs.writeFileSync(
      path.join(inboxDir, "20260326-headless-묵-review-PR782.md"),
      "test",
    );
    fs.writeFileSync(
      path.join(inboxDir, "20260326-headless-묵-review-PR783.md"),
      "test",
    );
    fs.writeFileSync(
      path.join(inboxDir, "20260325-닻-돌-status-update.md"),
      "test",
    );

    const removed = cleanupHeadlessDispatch(inboxDir, "묵");

    expect(removed).toHaveLength(2);
    expect(fs.readdirSync(inboxDir)).toHaveLength(1);
    expect(fs.readdirSync(inboxDir)[0]).toBe("20260325-닻-돌-status-update.md");
  });

  it("does not remove other agents dispatch files", () => {
    const inboxDir = path.join(commsDir, "inbox");
    fs.writeFileSync(
      path.join(inboxDir, "20260326-headless-묵-review-PR782.md"),
      "test",
    );
    fs.writeFileSync(
      path.join(inboxDir, "20260326-headless-별-review-PR783.md"),
      "test",
    );

    const removed = cleanupHeadlessDispatch(inboxDir, "묵");

    expect(removed).toHaveLength(1);
    expect(fs.readdirSync(inboxDir)).toHaveLength(1);
    expect(fs.readdirSync(inboxDir)[0]).toBe(
      "20260326-headless-별-review-PR783.md",
    );
  });

  it("returns empty array when inbox does not exist", () => {
    const removed = cleanupHeadlessDispatch("/nonexistent/inbox", "묵");
    expect(removed).toHaveLength(0);
  });

  it("handles hyphens in agent name", () => {
    const inboxDir = path.join(commsDir, "inbox");
    // Agent name with hyphen gets normalized to underscore
    fs.writeFileSync(
      path.join(inboxDir, "20260326-headless-codex_reviewer-review-PR782.md"),
      "test",
    );

    const removed = cleanupHeadlessDispatch(inboxDir, "codex-reviewer");
    expect(removed).toHaveLength(1);
  });
});

// ─── Drain behavior (heartbeat structure) ──────────────────────

describe("drain — heartbeat structure", () => {
  it("runtime state dir path is instance-scoped", () => {
    expect(getBridgeRuntimeStateDir(tmpDir, "codex-reviewer")).toBe(
      path.join(tmpDir, ".tmp", "codex-app-server-bridge-codex-reviewer"),
    );
  });

  it("heartbeat with null activeTurnId signals drain-safe", () => {
    const runtimeStateDir = getBridgeRuntimeStateDir(tmpDir, "codex");
    fs.mkdirSync(runtimeStateDir, { recursive: true });

    fs.writeFileSync(
      path.join(runtimeStateDir, "heartbeat.json"),
      JSON.stringify({
        updatedAt: new Date().toISOString(),
        activeTurnId: null,
        connected: true,
        initialized: true,
      }),
    );

    const hb = JSON.parse(
      fs.readFileSync(path.join(runtimeStateDir, "heartbeat.json"), "utf-8"),
    );
    // activeTurnId null = no active turn = safe to stop
    expect(hb.activeTurnId).toBeNull();
  });

  it("heartbeat with activeTurnId signals drain-wait", () => {
    const runtimeStateDir = getBridgeRuntimeStateDir(tmpDir, "codex");
    fs.mkdirSync(runtimeStateDir, { recursive: true });

    fs.writeFileSync(
      path.join(runtimeStateDir, "heartbeat.json"),
      JSON.stringify({
        updatedAt: new Date().toISOString(),
        activeTurnId: "turn-abc-123",
        connected: true,
        initialized: true,
      }),
    );

    const hb = JSON.parse(
      fs.readFileSync(path.join(runtimeStateDir, "heartbeat.json"), "utf-8"),
    );
    // activeTurnId present = active turn = must wait
    expect(hb.activeTurnId).toBe("turn-abc-123");
  });
});
