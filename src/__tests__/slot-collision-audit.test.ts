import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { writeSlotCollisionAudit } from "../transport/slot-collision-audit.js";

let tmpDir: string;
let originalEnv: string | undefined;

function readAuditEntries(
  commsDir: string,
): Array<{ name: string; content: string }> {
  const dir = path.join(commsDir, "audit", "slot-collisions");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .sort()
    .map((name) => ({
      name,
      content: fs.readFileSync(path.join(dir, name), "utf8"),
    }));
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tap-slot-audit-"));
  originalEnv = process.env.TAP_SLOT_COLLISION_AUDIT;
  delete process.env.TAP_SLOT_COLLISION_AUDIT;
});

afterEach(() => {
  if (originalEnv === undefined) {
    delete process.env.TAP_SLOT_COLLISION_AUDIT;
  } else {
    process.env.TAP_SLOT_COLLISION_AUDIT = originalEnv;
  }
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("slot collision audit writer", () => {
  it("writes a single audit record per collision", () => {
    const filePath = writeSlotCollisionAudit({
      commsDir: tmpDir,
      slot: "wt-1",
      recordedAt: "2026-04-23T10:00:00.000Z",
      winner: {
        agentId: "claude_wt1_new",
        displayName: "담 [claude_wt1_new]",
        instanceId: "claude-wt1",
        lastActivity: "2026-04-23T09:59:59.000Z",
        source: "mcp-direct",
        presence: "mcp-only",
      },
      loser: {
        agentId: "claude_wt1_old",
        displayName: "결 [claude_wt1_old]",
        instanceId: "claude-wt1",
        lastActivity: "2026-04-23T09:55:00.000Z",
        source: "mcp-direct",
        presence: "mcp-only",
      },
    });

    expect(filePath).not.toBeNull();
    const entries = readAuditEntries(tmpDir);
    expect(entries).toHaveLength(1);
    expect(entries[0].name).toMatch(/^20260423-wt-1-loser-.+-winner-.+\.md$/);
    expect(entries[0].content).toContain('type: "slot-collision-audit"');
    expect(entries[0].content).toContain('slot: "wt-1"');
    expect(entries[0].content).toContain("claude_wt1_new");
    expect(entries[0].content).toContain("claude_wt1_old");
  });

  it("dedupes the same collision pair within a UTC day (overwrite)", () => {
    const common = {
      commsDir: tmpDir,
      slot: "wt-1",
      winner: {
        agentId: "claude_wt1_new",
        displayName: "담",
        instanceId: "claude-wt1",
        lastActivity: "2026-04-23T09:59:59.000Z",
        source: "mcp-direct",
        presence: "mcp-only",
      },
      loser: {
        agentId: "claude_wt1_old",
        displayName: "결",
        instanceId: "claude-wt1",
        lastActivity: "2026-04-23T09:55:00.000Z",
        source: "mcp-direct",
        presence: "mcp-only",
      },
    };

    writeSlotCollisionAudit({
      ...common,
      recordedAt: "2026-04-23T10:00:00.000Z",
    });
    writeSlotCollisionAudit({
      ...common,
      recordedAt: "2026-04-23T11:30:00.000Z",
    });
    writeSlotCollisionAudit({
      ...common,
      recordedAt: "2026-04-23T14:00:00.000Z",
    });

    const entries = readAuditEntries(tmpDir);
    expect(entries).toHaveLength(1);
    expect(entries[0].content).toContain('recorded_at: "2026-04-23T14:00:00.000Z"');
  });

  it("produces a new record on a different UTC day", () => {
    const common = {
      commsDir: tmpDir,
      slot: "wt-1",
      winner: {
        agentId: "claude_wt1_new",
        displayName: "담",
        instanceId: "claude-wt1",
        lastActivity: "2026-04-23T09:59:59.000Z",
        source: "mcp-direct",
        presence: "mcp-only",
      },
      loser: {
        agentId: "claude_wt1_old",
        displayName: "결",
        instanceId: "claude-wt1",
        lastActivity: "2026-04-23T09:55:00.000Z",
        source: "mcp-direct",
        presence: "mcp-only",
      },
    };

    writeSlotCollisionAudit({
      ...common,
      recordedAt: "2026-04-23T23:59:00.000Z",
    });
    writeSlotCollisionAudit({
      ...common,
      recordedAt: "2026-04-24T00:01:00.000Z",
    });

    const entries = readAuditEntries(tmpDir);
    expect(entries).toHaveLength(2);
    expect(entries[0].name).toMatch(/^20260423-/);
    expect(entries[1].name).toMatch(/^20260424-/);
  });

  it("returns null and writes nothing when disabled via env", () => {
    process.env.TAP_SLOT_COLLISION_AUDIT = "0";
    const filePath = writeSlotCollisionAudit({
      commsDir: tmpDir,
      slot: "wt-1",
      winner: {
        agentId: "w",
        displayName: null,
        instanceId: null,
        lastActivity: "2026-04-23T10:00:00.000Z",
        source: "mcp-direct",
        presence: "mcp-only",
      },
      loser: {
        agentId: "l",
        displayName: null,
        instanceId: null,
        lastActivity: "2026-04-23T09:55:00.000Z",
        source: "mcp-direct",
        presence: "mcp-only",
      },
    });
    expect(filePath).toBeNull();
    expect(readAuditEntries(tmpDir)).toHaveLength(0);
  });
});
