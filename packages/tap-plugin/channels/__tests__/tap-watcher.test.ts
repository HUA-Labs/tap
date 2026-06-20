import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { TEST_DIR, resetTestDir, setTestEnv } from "./test-helpers.ts";

const FAKE_REPO_ROOT = join(TEST_DIR, "repo");
process.env.TAP_REPO_ROOT = FAKE_REPO_ROOT;
setTestEnv();

const {
  INBOX_DIR,
  REVIEWS_DIR,
  FINDINGS_DIR,
  HEARTBEATS_PATH,
  setAgentName,
  setObservedMcpClientName,
} = await import("../tap-utils.ts");
const { saveReceipts, getDurableReceiptKeys, getUnreadItems } =
  await import("../tap-io.ts");
const { processWatchFile, resetWatcherStateForTests } =
  await import("../tap-watcher.ts");

function writeBridgeProcessedMarker(filePath: string, mtimeMs: number): void {
  const markerId = createHash("sha1")
    .update(`${filePath}|${mtimeMs}`)
    .digest("hex");
  const processedDir = join(
    FAKE_REPO_ROOT,
    ".tmp",
    "codex-app-server-bridge-린",
    "processed",
  );
  mkdirSync(processedDir, { recursive: true });
  writeFileSync(join(processedDir, `${markerId}.done`), "{}", "utf-8");
}

function bumpFileMtime(filepath: string, deltaMs = 2_000): void {
  const bumpedTime = new Date(statSync(filepath).mtimeMs + deltaMs);
  utimesSync(filepath, bumpedTime, bumpedTime);
}

type NotificationPayload = {
  method: string;
  params: any;
  transport?: "notification" | "logging";
};

function createMockServer(
  notifications: NotificationPayload[],
  options?: {
    failGeneric?: boolean;
  },
) {
  return {
    notification: async (payload: NotificationPayload) => {
      notifications.push({ ...payload, transport: "notification" });
    },
    sendLoggingMessage: async (params: NotificationPayload["params"]) => {
      if (options?.failGeneric) {
        throw new Error("mock failure for notifications/message");
      }
      notifications.push({
        method: "notifications/message",
        params,
        transport: "logging",
      });
    },
  };
}

function expectGenericTapMessage(
  notification: NotificationPayload | undefined,
) {
  expect(notification?.method).toBe("notifications/message");
  expect(notification?.transport).toBe("logging");
  expect(notification?.params).toMatchObject({
    level: "info",
    logger: "tap-comms",
    data: {
      kind: "tap-message",
    },
  });
  return notification!.params.data;
}

beforeEach(() => {
  resetTestDir();
  mkdirSync(INBOX_DIR, { recursive: true });
  mkdirSync(REVIEWS_DIR, { recursive: true });
  mkdirSync(FINDINGS_DIR, { recursive: true });
  setAgentName("담");
  resetWatcherStateForTests();
});

afterEach(() => {
  delete process.env.CLAUDE_PLUGIN_ROOT;
  delete process.env.TAP_CLAUDE_CHANNEL_PUSH;
  setObservedMcpClientName(null);
  rmSync(TEST_DIR, { recursive: true, force: true });
  resetWatcherStateForTests();
  setAgentName("담");
});

function writeRegisteredReview(prNumber: number): void {
  const dir = join(REVIEWS_DIR, "registered", `pr${prNumber}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "r2-rereview-clean-jun.md"),
    [
      "---",
      "type: tap-review-registration",
      "status: registered",
      `pr: ${prNumber}`,
      'outcomeType: "rereview-clean"',
      "---",
      "",
      "registered review evidence",
    ].join("\n"),
    "utf-8",
  );
}

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
    const data = expectGenericTapMessage(notifications[0]);
    expect(data.meta).toEqual({
      from: "돌",
      to: "담",
      subject: "race",
      filename,
      source: "inbox",
    });
    expect(data.content).toContain("Tap message for 담");
    expect(data.content).toContain("race test");
    expect(data.display).toBe(data.content);
  });

  it("strips inbox frontmatter from pushed notification content", async () => {
    const notifications: NotificationPayload[] = [];
    const mcp = createMockServer(notifications);
    const filename = "20260409-율-담-frontmatter.md";
    const filepath = join(INBOX_DIR, filename);

    writeFileSync(
      filepath,
      [
        "---",
        "type: inbox",
        "from: 율",
        "to: 담",
        "subject: frontmatter",
        "---",
        "",
        "> CC: 봄",
        "",
        "real body",
      ].join("\n"),
      "utf-8",
    );

    const result = await processWatchFile(
      INBOX_DIR,
      "inbox",
      filename,
      mcp as any,
    );

    expect(result).toBe(true);
    expect(notifications).toHaveLength(1);
    const data = expectGenericTapMessage(notifications[0]);
    expect(data.rawContent).toBe("> CC: 봄\n\nreal body");
    expect(data.content).toBe(data.display);
    expect(data.display).toContain("Tap message for 담");
    expect(data.display).toContain("From: 율");
    expect(data.display).toContain("To: 담");
    expect(data.display).toContain("Subject: frontmatter");
    expect(data.display).toContain("Message:");
    expect(data.display).toContain("> CC: 봄\n\nreal body");
    expect(data.display).toContain("Reply available: 율");
    expect(data.display).not.toContain("Tap-comms inbox message");
    expect(data.display).not.toContain("Use tap_reply");
  });

  it("keeps missing return routes visible without exact reply instructions", async () => {
    const notifications: NotificationPayload[] = [];
    const mcp = createMockServer(notifications);
    const filename = "20260409-unknown-담-missing-route.md";
    const filepath = join(INBOX_DIR, filename);

    writeFileSync(
      filepath,
      [
        "---",
        "type: inbox",
        "from: unknown",
        "to: 담",
        "subject: missing-route",
        'from_address: {"routingAddress":"unknown"}',
        "---",
        "",
        "needs operator route",
      ].join("\n"),
      "utf-8",
    );

    const result = await processWatchFile(
      INBOX_DIR,
      "inbox",
      filename,
      mcp as any,
    );

    expect(result).toBe(true);
    const data = expectGenericTapMessage(notifications[0]);
    expect(data.content).toBe(data.display);
    expect(data.content).toContain(
      "Reply unavailable: no verified return route.",
    );
    expect(data.content).toContain("`unknown` is not a valid reply target.");
    expect(data.content).not.toContain('Use tap_reply(to: "unknown"');
  });

  it("uses display names when slot routing is stored in inbox frontmatter", async () => {
    process.env.TAP_ROUTING_SLOT = "wt-1";
    const notifications: NotificationPayload[] = [];
    const mcp = createMockServer(notifications);
    const filename = "20260415-율-결-slot-frontmatter.md";
    const filepath = join(INBOX_DIR, filename);

    writeFileSync(
      filepath,
      [
        "---",
        "type: inbox",
        "from: tower",
        "from_name: 율",
        "to: wt-1",
        "to_name: 결",
        "subject: slot-frontmatter",
        "---",
        "",
        "slot frontmatter body",
      ].join("\n"),
      "utf-8",
    );

    const result = await processWatchFile(
      INBOX_DIR,
      "inbox",
      filename,
      mcp as any,
    );

    expect(result).toBe(true);
    expect(notifications).toHaveLength(1);
    const data = expectGenericTapMessage(notifications[0]);
    expect(data.meta).toEqual({
      from: "율",
      to: "결",
      subject: "slot-frontmatter",
      filename,
      source: "inbox",
    });

    delete process.env.TAP_ROUTING_SLOT;
  });

  it("does not notify another agent's structured codex route via the broad codex alias", async () => {
    setAgentName("윤");
    setObservedMcpClientName("codex-mcp-client");
    const notifications: NotificationPayload[] = [];
    const mcp = createMockServer(notifications);
    const filename = "20260616-준-봄-review-clean.md";
    const filepath = join(INBOX_DIR, filename);

    writeFileSync(
      filepath,
      [
        "---",
        "type: inbox",
        "from: 준",
        "to: codex",
        "to_name: 봄",
        'to_address: {"routingAddress":"codex","aliases":["codex","봄"]}',
        "subject: review-clean",
        "message_id: msg-bom-review",
        "---",
        "",
        "this is for 봄, not 윤",
      ].join("\n"),
      "utf-8",
    );

    const result = await processWatchFile(
      INBOX_DIR,
      "inbox",
      filename,
      mcp as any,
    );

    expect(result).toBe(false);
    expect(notifications).toHaveLength(0);

    setAgentName("봄");

    const delivered = await processWatchFile(
      INBOX_DIR,
      "inbox",
      filename,
      mcp as any,
    );

    expect(delivered).toBe(true);
    expect(notifications).toHaveLength(1);
    expect(expectGenericTapMessage(notifications[0]).meta.to).toBe("봄");
  });

  it("collapses stale review-meta notifications after terminal evidence", async () => {
    setAgentName("봄");
    writeRegisteredReview(1572);
    const notifications: NotificationPayload[] = [];
    const mcp = createMockServer(notifications);
    const staleFilename = "20260616-yoon-bom-status-correction-pr1572.md";
    const stalePath = join(INBOX_DIR, staleFilename);

    writeFileSync(
      stalePath,
      [
        "---",
        "type: inbox",
        "from: 윤",
        "to: 봄",
        "subject: status-correction-pr1572",
        "message_id: msg-stale-correction",
        "---",
        "",
        "Status correction after terminal review evidence.",
      ].join("\n"),
      "utf-8",
    );

    const first = await processWatchFile(
      INBOX_DIR,
      "inbox",
      staleFilename,
      mcp as any,
    );
    const replay = await processWatchFile(
      INBOX_DIR,
      "inbox",
      staleFilename,
      mcp as any,
    );

    expect(first).toBe(false);
    expect(replay).toBe(false);
    expect(notifications).toHaveLength(0);
    expect(readFileSync(stalePath, "utf-8")).toContain(
      "Status correction after terminal review evidence.",
    );

    const requestFilename = "20260616-yoon-bom-r2-review-request-pr1572.md";
    writeFileSync(
      join(INBOX_DIR, requestFilename),
      [
        "---",
        "type: inbox",
        "from: 윤",
        "to: 봄",
        "subject: r2-review-request-pr1572",
        "message_id: msg-r2-review-request",
        "---",
        "",
        "Please review the updated head. Prior result: P1/P2/P3: none.",
      ].join("\n"),
      "utf-8",
    );

    const request = await processWatchFile(
      INBOX_DIR,
      "inbox",
      requestFilename,
      mcp as any,
    );

    expect(request).toBe(true);
    expect(notifications).toHaveLength(1);
    expect(expectGenericTapMessage(notifications[0]).meta.subject).toBe(
      "r2-review-request-pr1572",
    );

    const freshFilename = "20260616-jun-bom-r3-review-pr1572-clean.md";
    writeFileSync(
      join(INBOX_DIR, freshFilename),
      [
        "---",
        "type: inbox",
        "from: 준",
        "to: 봄",
        "subject: r3-review-pr1572-clean",
        "message_id: msg-new-clean",
        "---",
        "",
        "P1/P2/P3: none.\n\nVerification:\n- type-check PASS.",
      ].join("\n"),
      "utf-8",
    );

    const fresh = await processWatchFile(
      INBOX_DIR,
      "inbox",
      freshFilename,
      mcp as any,
    );

    expect(fresh).toBe(true);
    expect(notifications).toHaveLength(2);
    expect(expectGenericTapMessage(notifications[1]).meta.subject).toBe(
      "r3-review-pr1572-clean",
    );
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
    expect(expectGenericTapMessage(notifications[0]).meta.subject).toBe("once");
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
    const data = expectGenericTapMessage(notifications[0]);
    expect(data.meta).toEqual({
      from: "덱 [codex_2]",
      to: "담 [codex_1]",
      subject: "dm",
      filename,
      source: "inbox",
    });
  });

  it("writes channel relay events to the tap mcp log file", async () => {
    const notifications: NotificationPayload[] = [];
    const mcp = createMockServer(notifications);
    const filename = "20260325-돌-담-logged.md";
    const filepath = join(INBOX_DIR, filename);

    writeFileSync(filepath, "channel logging check", "utf-8");

    const result = await processWatchFile(
      INBOX_DIR,
      "inbox",
      filename,
      mcp as any,
    );

    expect(result).toBe(true);
    const logContents = readFileSync(
      process.env.TAP_CHANNEL_LOG_PATH!,
      "utf-8",
    );
    expect(logContents).toContain("INFO channel relay attempt");
    expect(logContents).toContain(`filename=${JSON.stringify(filename)}`);
    expect(logContents).toContain("INFO channel relay sent");
  });

  it("re-evaluates files that were already read when their content changes", async () => {
    const notifications: NotificationPayload[] = [];
    const mcp = createMockServer(notifications);
    const filename = "20260418-돌-담-reread-watch.md";
    const filepath = join(INBOX_DIR, filename);

    writeFileSync(filepath, "first watcher body", "utf-8");

    const firstUnread = getUnreadItems({ sources: ["inbox"] });
    const skippedWhileSameMtime = await processWatchFile(
      INBOX_DIR,
      "inbox",
      filename,
      mcp as any,
    );

    writeFileSync(filepath, "second watcher body", "utf-8");
    bumpFileMtime(filepath);

    const resent = await processWatchFile(
      INBOX_DIR,
      "inbox",
      filename,
      mcp as any,
    );

    expect(firstUnread).toHaveLength(1);
    expect(skippedWhileSameMtime).toBe(false);
    expect(resent).toBe(true);
    expect(notifications).toHaveLength(1);
    const data = expectGenericTapMessage(notifications[0]);
    expect(data.rawContent).toBe("second watcher body");
    expect(data.content).toContain("second watcher body");
  });

  it("does not re-emit unchanged inbox content when projection only advances mtime", async () => {
    const notifications: NotificationPayload[] = [];
    const mcp = createMockServer(notifications);
    const filename = "20260615-봄-담-duplicate-projection.md";
    const filepath = join(INBOX_DIR, filename);
    const content = [
      "---",
      "type: inbox",
      "from: 봄",
      "to: 담",
      "subject: duplicate-projection",
      "message_id: msg-duplicate-projection-1",
      "---",
      "",
      "same body from projected inbox",
    ].join("\n");

    writeFileSync(filepath, content, "utf-8");

    const first = await processWatchFile(
      INBOX_DIR,
      "inbox",
      filename,
      mcp as any,
    );

    bumpFileMtime(filepath);

    const second = await processWatchFile(
      INBOX_DIR,
      "inbox",
      filename,
      mcp as any,
    );

    expect(first).toBe(true);
    expect(second).toBe(false);
    expect(notifications).toHaveLength(1);
    expect(expectGenericTapMessage(notifications[0]).meta.subject).toBe(
      "duplicate-projection",
    );
  });

  it("does not replay a displayed inbox file after watcher state resets", async () => {
    const notifications: NotificationPayload[] = [];
    const mcp = createMockServer(notifications);
    const filename = "20260615-준-담-restart-replay.md";
    const filepath = join(INBOX_DIR, filename);
    const content = [
      "---",
      "type: inbox",
      "from: 준",
      "to: 담",
      "subject: restart-replay",
      "message_id: msg-restart-replay-1",
      "---",
      "",
      "stable replay body",
    ].join("\n");

    writeFileSync(filepath, content, "utf-8");

    const first = await processWatchFile(
      INBOX_DIR,
      "inbox",
      filename,
      mcp as any,
    );

    resetWatcherStateForTests();
    bumpFileMtime(filepath);

    const replay = await processWatchFile(
      INBOX_DIR,
      "inbox",
      filename,
      mcp as any,
    );

    writeFileSync(
      filepath,
      content.replace("stable replay body", "updated replay body"),
      "utf-8",
    );
    bumpFileMtime(filepath);

    const changed = await processWatchFile(
      INBOX_DIR,
      "inbox",
      filename,
      mcp as any,
    );

    expect(first).toBe(true);
    expect(replay).toBe(false);
    expect(changed).toBe(true);
    expect(notifications).toHaveLength(2);
    expect(expectGenericTapMessage(notifications[0]).meta.subject).toBe(
      "restart-replay",
    );
    expect(expectGenericTapMessage(notifications[1]).rawContent).toBe(
      "updated replay body",
    );
  });

  it("keeps displayed replay markers scoped per receiving agent for broadcasts", async () => {
    const notifications: NotificationPayload[] = [];
    const mcp = createMockServer(notifications);
    const filename = "20260615-봄-전체-broadcast-replay.md";
    const filepath = join(INBOX_DIR, filename);
    const content = [
      "---",
      "type: inbox",
      "from: 봄",
      "to: 전체",
      "subject: broadcast-replay",
      "message_id: msg-broadcast-replay-1",
      "---",
      "",
      "broadcast replay body",
    ].join("\n");

    writeFileSync(filepath, content, "utf-8");

    setAgentName("alice");
    const aliceFirst = await processWatchFile(
      INBOX_DIR,
      "inbox",
      filename,
      mcp as any,
    );

    resetWatcherStateForTests();
    setAgentName("bob");
    bumpFileMtime(filepath);
    const bobFirst = await processWatchFile(
      INBOX_DIR,
      "inbox",
      filename,
      mcp as any,
    );

    resetWatcherStateForTests();
    setAgentName("alice");
    bumpFileMtime(filepath);
    const aliceReplay = await processWatchFile(
      INBOX_DIR,
      "inbox",
      filename,
      mcp as any,
    );

    expect(aliceFirst).toBe(true);
    expect(bobFirst).toBe(true);
    expect(aliceReplay).toBe(false);
    expect(notifications).toHaveLength(2);
    expect(expectGenericTapMessage(notifications[0]).meta.subject).toBe(
      "broadcast-replay",
    );
    expect(expectGenericTapMessage(notifications[1]).meta.subject).toBe(
      "broadcast-replay",
    );
  });

  it("keeps Claude channel delivery even if generic MCP notification fails", async () => {
    process.env.CLAUDE_PLUGIN_ROOT = "/tmp/mock-claude-plugin";
    const notifications: NotificationPayload[] = [];
    const mcp = createMockServer(notifications, {
      failGeneric: true,
    });
    const filename = "20260418-돌-담-generic-fallback.md";
    const filepath = join(INBOX_DIR, filename);

    writeFileSync(filepath, "generic fallback body", "utf-8");

    const result = await processWatchFile(
      INBOX_DIR,
      "inbox",
      filename,
      mcp as any,
    );

    expect(result).toBe(true);
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({
      method: "notifications/claude/channel",
      params: {
        rawContent: "generic fallback body",
        debugEnvelope: {
          meta: {
            from: "돌",
            to: "담",
            subject: "generic-fallback",
            filename,
            source: "inbox",
          },
        },
      },
    });
    expect(notifications[0]?.params.content).toContain("generic fallback body");

    delete process.env.CLAUDE_PLUGIN_ROOT;
  });

  it("keeps legacy Claude metadata shape for non-inbox channel artifacts", async () => {
    process.env.CLAUDE_PLUGIN_ROOT = "/tmp/mock-claude-plugin";
    const notifications: NotificationPayload[] = [];
    const mcp = createMockServer(notifications);
    const filename = "review-PR758-돌.md";
    const filepath = join(REVIEWS_DIR, filename);

    writeFileSync(filepath, "review artifact body", "utf-8");

    const result = await processWatchFile(
      REVIEWS_DIR,
      "reviews",
      filename,
      mcp as any,
    );

    expect(result).toBe(true);
    expect(notifications).toHaveLength(2);
    expect(notifications[0]).toMatchObject({
      method: "notifications/claude/channel",
      params: {
        content: "review artifact body",
        meta: {
          from: "reviews",
          to: "all",
          subject: "review-PR758-돌",
          filename,
          source: "reviews",
        },
      },
    });

    delete process.env.CLAUDE_PLUGIN_ROOT;
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

  it("skips bridge-processed inbox files so push stays single-delivery", async () => {
    const notifications: NotificationPayload[] = [];
    const mcp = createMockServer(notifications);
    const filename = "20260402-결-전체-broadcast.md";
    const filepath = join(INBOX_DIR, filename);
    const content = [
      "---",
      "type: inbox",
      "from: 결",
      "from_name: 결",
      "to: 전체",
      "subject: broadcast",
      "sent_at: 2026-04-02T10:40:00.000Z",
      "---",
      "",
      "single delivery only",
    ].join("\n");

    writeFileSync(filepath, content, "utf-8");
    writeBridgeProcessedMarker(filepath, statSync(filepath).mtimeMs);

    const result = await processWatchFile(
      INBOX_DIR,
      "inbox",
      filename,
      mcp as any,
    );

    expect(result).toBe(false);
    expect(notifications).toHaveLength(0);
  });

  it("re-evaluates bridge-processed files when the file mtime advances", async () => {
    const notifications: NotificationPayload[] = [];
    const mcp = createMockServer(notifications);
    const filename = "20260418-돌-담-bridge-refresh.md";
    const filepath = join(INBOX_DIR, filename);

    writeFileSync(filepath, "bridge v1", "utf-8");
    writeBridgeProcessedMarker(filepath, statSync(filepath).mtimeMs);

    const first = await processWatchFile(
      INBOX_DIR,
      "inbox",
      filename,
      mcp as any,
    );

    writeFileSync(filepath, "bridge v2", "utf-8");
    bumpFileMtime(filepath);

    const second = await processWatchFile(
      INBOX_DIR,
      "inbox",
      filename,
      mcp as any,
    );

    expect(first).toBe(false);
    expect(second).toBe(true);
    expect(notifications).toHaveLength(1);
    const data = expectGenericTapMessage(notifications[0]);
    expect(data.rawContent).toBe("bridge v2");
    expect(data.content).toContain("bridge v2");
  });

  it("skips inbox files that already have a durable read receipt", async () => {
    const notifications: NotificationPayload[] = [];
    const mcp = createMockServer(notifications);
    const filename = "20260418-돌-담-read-receipt.md";
    const filepath = join(INBOX_DIR, filename);
    const content = [
      "---",
      "type: inbox",
      "from: 돌",
      "to: 담",
      "subject: read-receipt",
      "message_id: msg-read-receipt-1",
      "---",
      "",
      "already acknowledged",
    ].join("\n");

    writeFileSync(filepath, content, "utf-8");
    saveReceipts({
      [getDurableReceiptKeys(filename, content)[0]!]: [
        { reader: "codex_1", timestamp: "2026-04-18T06:00:00.000Z" },
      ],
    });

    const result = await processWatchFile(
      INBOX_DIR,
      "inbox",
      filename,
      mcp as any,
    );

    expect(result).toBe(false);
    expect(notifications).toHaveLength(0);
  });

  it("skips inbox files that fall before the joinedAt visibility boundary", async () => {
    const notifications: NotificationPayload[] = [];
    const mcp = createMockServer(notifications);
    const filename = "20260418-돌-담-pre-join.md";
    const filepath = join(INBOX_DIR, filename);

    writeFileSync(
      HEARTBEATS_PATH,
      JSON.stringify(
        {
          codex_1: {
            agent: "담",
            joinedAt: new Date(Date.now() + 60_000).toISOString(),
            status: "active",
            timestamp: "2026-04-18T06:00:00.000Z",
            lastActivity: "2026-04-18T06:00:00.000Z",
          },
        },
        null,
        2,
      ),
      "utf-8",
    );
    writeFileSync(filepath, "pre-join backlog", "utf-8");

    const result = await processWatchFile(
      INBOX_DIR,
      "inbox",
      filename,
      mcp as any,
    );

    expect(result).toBe(false);
    expect(notifications).toHaveLength(0);
  });
});
