import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { resetTestDir, setTestEnv } from "./test-helpers.ts";

setTestEnv();

const { INBOX_DIR, REVIEWS_DIR, RECEIPTS_DIR, RECEIPTS_PATH, HEARTBEATS_PATH } =
  await import("../tap-utils.ts");
const {
  startupFiles,
  readFiles,
  seedStartupFiles,
  getUnreadItems,
  acquireLock,
  releaseLock,
  saveReceipts,
  loadReceipts,
  saveHeartbeats,
  loadHeartbeats,
} = await import("../tap-io.ts");

beforeEach(() => {
  resetTestDir();
  startupFiles.clear();
  readFiles.clear();
  mkdirSync(INBOX_DIR, { recursive: true });
  mkdirSync(join(REVIEWS_DIR, "gen13"), { recursive: true });
  mkdirSync(RECEIPTS_DIR, { recursive: true });
});

afterEach(() => {
  startupFiles.clear();
  readFiles.clear();
  resetTestDir();
});

describe("tap-io", () => {
  it("returns targeted inbox messages and review artifacts from unread polling", () => {
    writeFileSync(
      join(INBOX_DIR, "20260325-돌-담-hello.md"),
      "# hello\n\nfrom tower",
      "utf-8",
    );
    writeFileSync(
      join(INBOX_DIR, "20260325-담-돌-self.md"),
      "self echo",
      "utf-8",
    );
    writeFileSync(
      join(INBOX_DIR, "20260325-돌-빛-other.md"),
      "other recipient",
      "utf-8",
    );
    writeFileSync(
      join(REVIEWS_DIR, "gen13", "review-PR758-견.md"),
      "clean",
      "utf-8",
    );

    const items = getUnreadItems({
      sources: ["inbox", "reviews"],
      markRead: false,
    });

    expect(items).toHaveLength(2);
    expect(items.map((item) => item.subject)).toEqual([
      "hello",
      "review-PR758-견",
    ]);
    expect(items[0]?.from).toBe("돌");
    expect(items[1]?.from).toBe("reviews");
  });

  it("uses heartbeat display names for id-addressed inbox items", () => {
    writeFileSync(
      join(INBOX_DIR, "20260325-codex_2-담-direct.md"),
      "hello from id route",
      "utf-8",
    );
    saveHeartbeats({
      codex_1: {
        agent: "담",
        status: "active",
        timestamp: "2026-03-25T03:00:00.000Z",
        lastActivity: "2026-03-25T03:00:00.000Z",
      },
      codex_2: {
        agent: "덱",
        status: "active",
        timestamp: "2026-03-25T03:00:00.000Z",
        lastActivity: "2026-03-25T03:00:00.000Z",
      },
    });

    const items = getUnreadItems({
      sources: ["inbox"],
      markRead: false,
    });

    expect(items).toHaveLength(1);
    expect(items[0]?.from).toBe("덱 [codex_2]");
    expect(items[0]?.to).toBe("담 [codex_1]");
  });

  it("skips files seeded at startup", () => {
    writeFileSync(
      join(INBOX_DIR, "20260325-돌-담-existing.md"),
      "existing",
      "utf-8",
    );

    seedStartupFiles("inbox");

    expect(getUnreadItems({ sources: ["inbox"] })).toEqual([]);
  });

  it("marks unread items as read by default", () => {
    writeFileSync(
      join(INBOX_DIR, "20260325-돌-담-once.md"),
      "read once",
      "utf-8",
    );

    const first = getUnreadItems({ sources: ["inbox"] });
    const second = getUnreadItems({ sources: ["inbox"] });

    expect(first).toHaveLength(1);
    expect(second).toEqual([]);
  });

  it("persists lock, receipt, and heartbeat files", () => {
    const lockPath = join(RECEIPTS_DIR, ".lock");

    expect(acquireLock(lockPath, 1, 0)).toBe(true);
    expect(acquireLock(lockPath, 1, 0)).toBe(false);
    releaseLock(lockPath);
    expect(acquireLock(lockPath, 1, 0)).toBe(true);
    releaseLock(lockPath);

    saveReceipts({
      "20260325-돌-담-hello.md": [
        { reader: "담", timestamp: "2026-03-25T03:00:00.000Z" },
      ],
    });
    expect(loadReceipts()).toEqual({
      "20260325-돌-담-hello.md": [
        { reader: "담", timestamp: "2026-03-25T03:00:00.000Z" },
      ],
    });

    saveHeartbeats({
      담: {
        agent: "담",
        status: "active",
        timestamp: "2026-03-25T03:00:00.000Z",
        lastActivity: "2026-03-25T03:00:00.000Z",
      },
    });
    expect(loadHeartbeats()).toEqual({
      담: {
        agent: "담",
        status: "active",
        timestamp: "2026-03-25T03:00:00.000Z",
        lastActivity: "2026-03-25T03:00:00.000Z",
      },
    });
  });
});
