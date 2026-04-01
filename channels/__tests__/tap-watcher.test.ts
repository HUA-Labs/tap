import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { TEST_DIR, resetTestDir, setTestEnv } from "./test-helpers.ts";

setTestEnv();

const { INBOX_DIR, REVIEWS_DIR, FINDINGS_DIR, HEARTBEATS_PATH } =
  await import("../tap-utils.ts");
const { processWatchFile, resetWatcherStateForTests } =
  await import("../tap-watcher.ts");

type NotificationPayload = {
  method: string;
  params: {
    content: string;
    meta: {
      from: string;
      to: string;
      subject: string;
      filename: string;
      source: "inbox" | "reviews" | "findings";
    };
  };
};

function createMockServer(notifications: NotificationPayload[]) {
  return {
    notification: async (payload: NotificationPayload) => {
      notifications.push(payload);
    },
  };
}

beforeEach(() => {
  resetTestDir();
  mkdirSync(INBOX_DIR, { recursive: true });
  mkdirSync(REVIEWS_DIR, { recursive: true });
  mkdirSync(FINDINGS_DIR, { recursive: true });
  resetWatcherStateForTests();
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
  resetWatcherStateForTests();
});

describe("tap watcher", () => {
  it("retries until a just-created inbox file becomes readable", async () => {
    const notifications: NotificationPayload[] = [];
    const mcp = createMockServer(notifications);
    const filename = "20260325-돌-담-race.md";
    const filepath = join(INBOX_DIR, filename);

    const pending = processWatchFile(INBOX_DIR, "inbox", filename, mcp as any);
    setTimeout(() => {
      writeFileSync(filepath, "# hello\n\nrace test", "utf-8");
    }, 30);

    await pending;

    expect(notifications).toHaveLength(1);
    expect(notifications[0]?.params.meta).toEqual({
      from: "돌",
      to: "담",
      subject: "race",
      filename,
      source: "inbox",
    });
    expect(notifications[0]?.params.content).toContain("race test");
  });

  it("deduplicates concurrent processing of the same file", async () => {
    const notifications: NotificationPayload[] = [];
    const mcp = createMockServer(notifications);
    const filename = "20260325-돌-담-once.md";
    const filepath = join(INBOX_DIR, filename);

    const first = processWatchFile(INBOX_DIR, "inbox", filename, mcp as any);
    const second = processWatchFile(INBOX_DIR, "inbox", filename, mcp as any);
    setTimeout(() => {
      writeFileSync(filepath, "only once", "utf-8");
    }, 30);

    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(firstResult).toBe(true);
    expect(secondResult).toBe(false);
    expect(notifications).toHaveLength(1);
    expect(notifications[0]?.params.meta.subject).toBe("once");
  });

  it("uses heartbeat display labels in notification metadata", async () => {
    const notifications: NotificationPayload[] = [];
    const mcp = createMockServer(notifications);
    const filename = "20260325-codex_2-담-dm.md";
    const filepath = join(INBOX_DIR, filename);

    writeFileSync(
      HEARTBEATS_PATH,
      JSON.stringify(
        {
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
        },
        null,
        2,
      ),
      "utf-8",
    );
    writeFileSync(filepath, "name label check", "utf-8");

    const result = await processWatchFile(
      INBOX_DIR,
      "inbox",
      filename,
      mcp as any,
    );

    expect(result).toBe(true);
    expect(notifications).toHaveLength(1);
    expect(notifications[0]?.params.meta).toEqual({
      from: "덱 [codex_2]",
      to: "담 [codex_1]",
      subject: "dm",
      filename,
      source: "inbox",
    });
  });

  it("skips self-authored review artifacts via filename suffix fallback", async () => {
    const notifications: NotificationPayload[] = [];
    const mcp = createMockServer(notifications);
    const filename = "review-PR758-담.md";
    const filepath = join(REVIEWS_DIR, filename);

    writeFileSync(filepath, "self review artifact", "utf-8");

    const result = await processWatchFile(
      REVIEWS_DIR,
      "reviews",
      filename,
      mcp as any,
    );

    expect(result).toBe(false);
    expect(notifications).toHaveLength(0);
  });
});
