import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { writeInstanceOwnershipChangeAudit } from "../transport/instance-ownership-audit.js";

let tmpDir: string;
let originalEnv: string | undefined;

function readEntries(
  commsDir: string,
): Array<{ name: string; content: string }> {
  const dir = path.join(commsDir, "audit", "instance-ownership-changes");
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
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tap-instance-ownership-"));
  originalEnv = process.env.TAP_INSTANCE_OWNERSHIP_AUDIT;
  delete process.env.TAP_INSTANCE_OWNERSHIP_AUDIT;
});

afterEach(() => {
  if (originalEnv === undefined) {
    delete process.env.TAP_INSTANCE_OWNERSHIP_AUDIT;
  } else {
    process.env.TAP_INSTANCE_OWNERSHIP_AUDIT = originalEnv;
  }
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("instance ownership change audit writer", () => {
  it("writes a single audit record per ownership change", () => {
    const filePath = writeInstanceOwnershipChangeAudit({
      commsDir: tmpDir,
      instanceId: "codex",
      recordedAt: "2026-04-23T10:00:00.000Z",
      previous: {
        agentId: "윤",
        displayName: "윤",
        instanceId: "codex",
        hostId: "DEVIN",
        lastActivity: "2026-04-20T10:00:00.000Z",
      },
      next: {
        agentId: "해",
        displayName: "해",
        instanceId: "codex",
        hostId: "DEVIN",
        lastActivity: "2026-04-23T10:00:00.000Z",
      },
      prunedKeys: ["윤", "codex_윤"],
      prunedPresenceFiles: ["윤.json"],
    });

    expect(filePath).not.toBeNull();
    const entries = readEntries(tmpDir);
    expect(entries).toHaveLength(1);
    expect(entries[0].name).toMatch(/^20260423-codex-prev-.+-next-.+\.md$/);
    expect(entries[0].content).toContain(
      'type: "instance-ownership-change-audit"',
    );
    expect(entries[0].content).toContain('instance_id: "codex"');
    expect(entries[0].content).toContain("윤");
    expect(entries[0].content).toContain("해");
    expect(entries[0].content).toContain("pruned_keys");
  });

  it("dedupes same (instance, prev, next) within a UTC day", () => {
    const common = {
      commsDir: tmpDir,
      instanceId: "codex",
      previous: {
        agentId: "윤",
        displayName: "윤",
        instanceId: "codex",
        hostId: "DEVIN",
        lastActivity: "2026-04-20T10:00:00.000Z",
      },
      next: {
        agentId: "해",
        displayName: "해",
        instanceId: "codex",
        hostId: "DEVIN",
        lastActivity: "2026-04-23T10:00:00.000Z",
      },
      prunedKeys: ["윤"],
      prunedPresenceFiles: ["윤.json"],
    };

    writeInstanceOwnershipChangeAudit({
      ...common,
      recordedAt: "2026-04-23T10:00:00.000Z",
    });
    writeInstanceOwnershipChangeAudit({
      ...common,
      recordedAt: "2026-04-23T23:00:00.000Z",
    });

    const entries = readEntries(tmpDir);
    expect(entries).toHaveLength(1);
    expect(entries[0].content).toContain(
      'recorded_at: "2026-04-23T23:00:00.000Z"',
    );
  });

  it("produces a new record on a different UTC day", () => {
    const common = {
      commsDir: tmpDir,
      instanceId: "codex",
      previous: {
        agentId: "윤",
        displayName: "윤",
        instanceId: "codex",
        hostId: "DEVIN",
        lastActivity: "2026-04-20T10:00:00.000Z",
      },
      next: {
        agentId: "해",
        displayName: "해",
        instanceId: "codex",
        hostId: "DEVIN",
        lastActivity: "2026-04-23T10:00:00.000Z",
      },
      prunedKeys: ["윤"],
      prunedPresenceFiles: [],
    };

    writeInstanceOwnershipChangeAudit({
      ...common,
      recordedAt: "2026-04-23T23:59:00.000Z",
    });
    writeInstanceOwnershipChangeAudit({
      ...common,
      recordedAt: "2026-04-24T00:01:00.000Z",
    });

    const entries = readEntries(tmpDir);
    expect(entries).toHaveLength(2);
    expect(entries[0].name).toMatch(/^20260423-/);
    expect(entries[1].name).toMatch(/^20260424-/);
  });

  it("returns null and writes nothing when disabled via env", () => {
    process.env.TAP_INSTANCE_OWNERSHIP_AUDIT = "0";
    const filePath = writeInstanceOwnershipChangeAudit({
      commsDir: tmpDir,
      instanceId: "codex",
      previous: {
        agentId: "윤",
        displayName: null,
        instanceId: "codex",
        hostId: null,
        lastActivity: null,
      },
      next: {
        agentId: "해",
        displayName: null,
        instanceId: "codex",
        hostId: null,
        lastActivity: null,
      },
      prunedKeys: [],
      prunedPresenceFiles: [],
    });
    expect(filePath).toBeNull();
    expect(readEntries(tmpDir)).toHaveLength(0);
  });
});
