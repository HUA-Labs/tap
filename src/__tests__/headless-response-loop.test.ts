import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { headlessCommand } from "../commands/headless.js";
import {
  runHeadlessResponseLoop,
  type HeadlessRunner,
} from "../receiver/headless-response-loop.js";
import { runPollingReceiver } from "../receiver/codex-cli-polling-receiver.js";

function makeRoot(): { root: string; commsDir: string; stateDir: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tap-headless-"));
  const commsDir = path.join(root, "hua-comms");
  const stateDir = path.join(root, ".tap-comms");
  fs.mkdirSync(path.join(commsDir, "inbox"), { recursive: true });
  fs.mkdirSync(stateDir, { recursive: true });
  return { root, commsDir, stateDir };
}

function writeInbox(
  commsDir: string,
  filename: string,
  content: string,
  mtime: Date,
): void {
  const filePath = path.join(commsDir, "inbox", filename);
  fs.writeFileSync(filePath, content, "utf8");
  fs.utimesSync(filePath, mtime, mtime);
}

function writeReplyEvidence(
  commsDir: string,
  filename: string,
  from = "준",
  subject = "headless-reply",
): void {
  fs.writeFileSync(
    path.join(commsDir, "inbox", filename),
    [
      "---",
      "type: inbox",
      "message_id: reply-1",
      `from: ${from}`,
      "to: 윤",
      `subject: ${subject}`,
      "sent_at: 2026-06-03T00:05:30.000Z",
      "---",
      "",
      "reply body",
    ].join("\n"),
    "utf8",
  );
}

describe("headless response loop", () => {
  it("dry-runs one pending item without writing cursor state", async () => {
    const { root, commsDir, stateDir } = makeRoot();
    try {
      writeInbox(
        commsDir,
        "20260603-yoon-jun-headless-dry-run.md",
        [
          "---",
          "from: 윤",
          'from_address: {"routingAddress":"윤","hostId":"/home/devin/hua-comms"}',
          "to: 준",
          "subject: headless-dry-run",
          "message_id: msg-dry-run",
          "---",
          "",
          "please respond",
        ].join("\n"),
        new Date("2026-06-03T00:04:00.000Z"),
      );

      const result = await runHeadlessResponseLoop({
        mode: "dry-run",
        commsDir,
        stateDir,
        agent: "준",
        now: new Date("2026-06-03T00:05:00.000Z"),
      });

      expect(result.status).toBe("dry-run");
      expect(result.item?.subject).toBe("headless-dry-run");
      expect(result.replyTarget).toBe("윤");
      expect(result.promptText).toContain("Headless response contract:");
      expect(result.promptText).toContain(
        "Before any tap_reply, call tap_reset_identity",
      );
      expect(result.promptText).toContain(
        'tap_set_name with your assigned agent name and receiveTransports ["polling"]',
      );
      expect(result.promptText).toContain(
        'Your assigned agent name for this run is "준"',
      );
      expect(result.promptText).toContain("replyInstruction: Use tap_reply");
      expect(result.stateWritten).toBe(false);
      expect(fs.existsSync(result.statePath)).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("blocks missing return routes without invoking the runner", async () => {
    const { root, commsDir, stateDir } = makeRoot();
    const calls: string[] = [];
    const runner: HeadlessRunner = {
      async run(request) {
        calls.push(request.item.path);
        return { exitCode: 0, timedOut: false, stdout: "", stderr: "" };
      },
    };
    try {
      writeInbox(
        commsDir,
        "20260603-unknown-jun-headless-missing-route.md",
        "From: unknown\nTo: 준\nSubject: headless-missing-route\n\nplease respond",
        new Date("2026-06-03T00:04:00.000Z"),
      );

      const result = await runHeadlessResponseLoop({
        mode: "once",
        commsDir,
        stateDir,
        agent: "준",
        runner,
        now: new Date("2026-06-03T00:05:00.000Z"),
      });

      expect(calls).toEqual([]);
      expect(result.status).toBe("blocked");
      expect(result.blockedReason).toContain("missing-return-route");
      expect(result.promptText).not.toContain('tap_reply(to: "unknown"');
      expect(result.stateWritten).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not mark processed when the runner only emits plain text", async () => {
    const { root, commsDir, stateDir } = makeRoot();
    const runner: HeadlessRunner = {
      async run() {
        return {
          exitCode: 0,
          timedOut: false,
          stdout: "plain answer",
          stderr: "",
        };
      },
    };
    try {
      writeInbox(
        commsDir,
        "20260603-yoon-jun-headless-plain.md",
        "From: 윤\nTo: 준\nSubject: headless-plain\nMessage-Id: msg-plain\n\nplease respond",
        new Date("2026-06-03T00:04:00.000Z"),
      );

      const result = await runHeadlessResponseLoop({
        mode: "once",
        commsDir,
        stateDir,
        agent: "준",
        runner,
        now: new Date("2026-06-03T00:05:00.000Z"),
      });
      const stillPending = await runPollingReceiver({
        mode: "check",
        commsDir,
        stateDir,
        agent: "준",
        now: new Date("2026-06-03T00:06:00.000Z"),
        all: true,
      });

      expect(result.status).toBe("blocked");
      expect(result.blockedReason).toContain("plain-text-only");
      expect(result.stateWritten).toBe(false);
      expect(stillPending.items.map((item) => item.subject)).toContain(
        "headless-plain",
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("marks processed only after durable reply evidence appears", async () => {
    const { root, commsDir, stateDir } = makeRoot();
    const runner: HeadlessRunner = {
      async run() {
        writeReplyEvidence(
          commsDir,
          "20260603-jun-yoon-headless-reply.md",
          "준",
          "re-headless-success",
        );
        return { exitCode: 0, timedOut: false, stdout: "", stderr: "" };
      },
    };
    try {
      writeInbox(
        commsDir,
        "20260603-yoon-jun-headless-success.md",
        "From: 윤\nTo: 준\nSubject: headless-success\nMessage-Id: msg-success\n\nplease respond",
        new Date("2026-06-03T00:04:00.000Z"),
      );

      const result = await runHeadlessResponseLoop({
        mode: "once",
        commsDir,
        stateDir,
        agent: "준",
        runner,
        now: new Date("2026-06-03T00:05:00.000Z"),
      });
      const duplicate = await runPollingReceiver({
        mode: "check",
        commsDir,
        stateDir,
        agent: "준",
        now: new Date("2026-06-03T00:06:00.000Z"),
        all: true,
      });

      expect(result.status).toBe("completed");
      expect(result.replyEvidence?.path).toBe(
        "inbox/20260603-jun-yoon-headless-reply.md",
      );
      expect(result.stateWritten).toBe(true);
      expect(duplicate.items.map((item) => item.subject)).not.toContain(
        "headless-success",
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("accepts durable reply evidence from a routing alias", async () => {
    const { root, commsDir, stateDir } = makeRoot();
    const runner: HeadlessRunner = {
      async run() {
        writeReplyEvidence(
          commsDir,
          "20260603-codex-yoon-headless-reply.md",
          "codex",
          "re-headless-alias-reply",
        );
        return { exitCode: 0, timedOut: false, stdout: "", stderr: "" };
      },
    };
    try {
      writeInbox(
        commsDir,
        "20260603-yoon-jun-headless-alias-reply.md",
        "From: 윤\nTo: 준\nSubject: headless-alias-reply\nMessage-Id: msg-alias-reply\n\nplease respond",
        new Date("2026-06-03T00:04:00.000Z"),
      );

      const result = await runHeadlessResponseLoop({
        mode: "once",
        commsDir,
        stateDir,
        agent: "준",
        aliases: ["codex"],
        runner,
        now: new Date("2026-06-03T00:05:00.000Z"),
      });

      expect(result.status).toBe("completed");
      expect(result.replyEvidence).toMatchObject({
        path: "inbox/20260603-codex-yoon-headless-reply.md",
        from: "codex",
        to: "윤",
      });
      expect(result.stateWritten).toBe(true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("blocks correlated inbox reply evidence from the wrong sender", async () => {
    const { root, commsDir, stateDir } = makeRoot();
    const runner: HeadlessRunner = {
      async run() {
        writeReplyEvidence(
          commsDir,
          "20260603-jun-yoon-headless-sender-leak.md",
          "준",
          "re-headless-sender-leak",
        );
        return { exitCode: 0, timedOut: false, stdout: "", stderr: "" };
      },
    };
    try {
      writeInbox(
        commsDir,
        "20260603-yoon-yul-headless-sender-leak.md",
        "From: 윤\nTo: 율\nSubject: headless-sender-leak\nMessage-Id: msg-sender-leak\n\nplease respond",
        new Date("2026-06-03T00:04:00.000Z"),
      );

      const result = await runHeadlessResponseLoop({
        mode: "once",
        commsDir,
        stateDir,
        agent: "율",
        runner,
        now: new Date("2026-06-03T00:05:00.000Z"),
      });

      expect(result.status).toBe("blocked");
      expect(result.blockedReason).toContain("reply-evidence-sender-mismatch");
      expect(result.blockedReason).toContain("expected=율");
      expect(result.blockedReason).toContain("actual=준");
      expect(result.blockedReason).toContain(
        "path=inbox/20260603-jun-yoon-headless-sender-leak.md",
      );
      expect(result.replyEvidence).toBeNull();
      expect(result.stateWritten).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("blocks wrong-sender inbox evidence even when valid evidence is also present", async () => {
    const { root, commsDir, stateDir } = makeRoot();
    const runner: HeadlessRunner = {
      async run() {
        writeReplyEvidence(
          commsDir,
          "20260603-a-yul-yoon-headless-mixed-sender.md",
          "율",
          "re-headless-mixed-sender",
        );
        writeReplyEvidence(
          commsDir,
          "20260603-z-jun-yoon-headless-mixed-sender.md",
          "준",
          "re-headless-mixed-sender",
        );
        return { exitCode: 0, timedOut: false, stdout: "", stderr: "" };
      },
    };
    try {
      writeInbox(
        commsDir,
        "20260603-yoon-yul-headless-mixed-sender.md",
        "From: 윤\nTo: 율\nSubject: headless-mixed-sender\nMessage-Id: msg-mixed-sender\n\nplease respond",
        new Date("2026-06-03T00:04:00.000Z"),
      );

      const result = await runHeadlessResponseLoop({
        mode: "once",
        commsDir,
        stateDir,
        agent: "율",
        runner,
        now: new Date("2026-06-03T00:05:00.000Z"),
      });

      expect(result.status).toBe("blocked");
      expect(result.blockedReason).toContain("reply-evidence-sender-mismatch");
      expect(result.blockedReason).toContain("expected=율");
      expect(result.blockedReason).toContain("actual=준");
      expect(result.blockedReason).toContain(
        "path=inbox/20260603-z-jun-yoon-headless-mixed-sender.md",
      );
      expect(result.replyEvidence).toBeNull();
      expect(result.stateWritten).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("ignores unrelated inbox evidence and selects the correlated reply", async () => {
    const { root, commsDir, stateDir } = makeRoot();
    const runner: HeadlessRunner = {
      async run() {
        writeReplyEvidence(
          commsDir,
          "20260603-jun-yoon-pr1366-review-clean.md",
          "준",
          "pr1366-review-clean",
        );
        writeReplyEvidence(
          commsDir,
          "20260603-jun-yoon-re-headless-correlation.md",
          "준",
          "re-headless-correlation",
        );
        return { exitCode: 0, timedOut: false, stdout: "", stderr: "" };
      },
    };
    try {
      writeInbox(
        commsDir,
        "20260603-yoon-jun-headless-correlation.md",
        "From: 윤\nTo: 준\nSubject: headless-correlation\nMessage-Id: msg-correlation\n\nplease respond",
        new Date("2026-06-03T00:04:00.000Z"),
      );

      const result = await runHeadlessResponseLoop({
        mode: "once",
        commsDir,
        stateDir,
        agent: "준",
        runner,
        now: new Date("2026-06-03T00:05:00.000Z"),
      });

      expect(result.status).toBe("completed");
      expect(result.replyEvidence).toMatchObject({
        path: "inbox/20260603-jun-yoon-re-headless-correlation.md",
        subject: "re-headless-correlation",
      });
      expect(result.stateWritten).toBe(true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("accepts review-family inbox reply subjects", async () => {
    const { root, commsDir, stateDir } = makeRoot();
    const runner: HeadlessRunner = {
      async run() {
        writeReplyEvidence(
          commsDir,
          "20260603-jun-yoon-pr1367-review-clean.md",
          "준",
          "pr1367-review-clean",
        );
        return { exitCode: 0, timedOut: false, stdout: "", stderr: "" };
      },
    };
    try {
      writeInbox(
        commsDir,
        "20260603-yoon-jun-pr1367-review-request.md",
        "From: 윤\nTo: 준\nSubject: pr1367-review-request\nMessage-Id: msg-review-request\n\nplease review",
        new Date("2026-06-03T00:04:00.000Z"),
      );

      const result = await runHeadlessResponseLoop({
        mode: "once",
        commsDir,
        stateDir,
        agent: "준",
        runner,
        now: new Date("2026-06-03T00:05:00.000Z"),
      });

      expect(result.status).toBe("completed");
      expect(result.replyEvidence).toMatchObject({
        path: "inbox/20260603-jun-yoon-pr1367-review-clean.md",
        subject: "pr1367-review-clean",
      });
      expect(result.stateWritten).toBe(true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("accepts timestamped smoke-family inbox reply subjects", async () => {
    const { root, commsDir, stateDir } = makeRoot();
    const runner: HeadlessRunner = {
      async run() {
        writeReplyEvidence(
          commsDir,
          "20260603-jun-yoon-m472-tui-down-headless-receipt-smoke-reply.md",
          "준",
          "m472-tui-down-headless-receipt-smoke-reply",
        );
        return { exitCode: 0, timedOut: false, stdout: "", stderr: "" };
      },
    };
    try {
      writeInbox(
        commsDir,
        "20260603-yoon-jun-m472-tui-down-headless-receipt-smoke-20260603T2328Z.md",
        "From: 윤\nTo: 준\nSubject: m472-tui-down-headless-receipt-smoke-20260603T2328Z\nMessage-Id: msg-smoke-timestamp\n\nplease smoke",
        new Date("2026-06-03T00:04:00.000Z"),
      );

      const result = await runHeadlessResponseLoop({
        mode: "once",
        commsDir,
        stateDir,
        agent: "준",
        runner,
        now: new Date("2026-06-03T00:05:00.000Z"),
      });

      expect(result.status).toBe("completed");
      expect(result.replyEvidence).toMatchObject({
        path: "inbox/20260603-jun-yoon-m472-tui-down-headless-receipt-smoke-reply.md",
        subject: "m472-tui-down-headless-receipt-smoke-reply",
      });
      expect(result.stateWritten).toBe(true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("accepts updated same-filename inbox reply evidence", async () => {
    const { root, commsDir, stateDir } = makeRoot();
    const replyFilename =
      "20260603-jun-yoon-m472-tui-down-headless-receipt-smoke-reply.md";
    const runner: HeadlessRunner = {
      async run() {
        writeReplyEvidence(
          commsDir,
          replyFilename,
          "준",
          "m472-tui-down-headless-receipt-smoke-reply",
        );
        return { exitCode: 0, timedOut: false, stdout: "", stderr: "" };
      },
    };
    try {
      writeReplyEvidence(
        commsDir,
        replyFilename,
        "준",
        "m472-tui-down-headless-receipt-smoke-reply",
      );
      fs.utimesSync(
        path.join(commsDir, "inbox", replyFilename),
        new Date("2026-06-03T00:01:00.000Z"),
        new Date("2026-06-03T00:01:00.000Z"),
      );
      writeInbox(
        commsDir,
        "20260603-yoon-jun-m472-tui-down-headless-receipt-smoke-20260603T2328Z.md",
        "From: 윤\nTo: 준\nSubject: m472-tui-down-headless-receipt-smoke-20260603T2328Z\nMessage-Id: msg-smoke-same-filename\n\nplease smoke",
        new Date("2026-06-03T00:04:00.000Z"),
      );

      const result = await runHeadlessResponseLoop({
        mode: "once",
        commsDir,
        stateDir,
        agent: "준",
        runner,
        now: new Date("2026-06-03T00:05:00.000Z"),
      });

      expect(result.status).toBe("completed");
      expect(result.replyEvidence).toMatchObject({
        path: `inbox/${replyFilename}`,
        subject: "m472-tui-down-headless-receipt-smoke-reply",
      });
      expect(result.stateWritten).toBe(true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not accept unchanged preexisting inbox reply evidence", async () => {
    const { root, commsDir, stateDir } = makeRoot();
    const replyFilename =
      "20260603-jun-yoon-m472-tui-down-headless-receipt-smoke-reply.md";
    const runner: HeadlessRunner = {
      async run() {
        return {
          exitCode: 0,
          timedOut: false,
          stdout: "no durable reply",
          stderr: "",
        };
      },
    };
    try {
      writeReplyEvidence(
        commsDir,
        replyFilename,
        "준",
        "m472-tui-down-headless-receipt-smoke-reply",
      );
      fs.utimesSync(
        path.join(commsDir, "inbox", replyFilename),
        new Date("2026-06-03T00:01:00.000Z"),
        new Date("2026-06-03T00:01:00.000Z"),
      );
      writeInbox(
        commsDir,
        "20260603-yoon-jun-m472-tui-down-headless-receipt-smoke-20260603T2328Z.md",
        "From: 윤\nTo: 준\nSubject: m472-tui-down-headless-receipt-smoke-20260603T2328Z\nMessage-Id: msg-smoke-unchanged\n\nplease smoke",
        new Date("2026-06-03T00:04:00.000Z"),
      );

      const result = await runHeadlessResponseLoop({
        mode: "once",
        commsDir,
        stateDir,
        agent: "준",
        runner,
        now: new Date("2026-06-03T00:05:00.000Z"),
      });

      expect(result.status).toBe("blocked");
      expect(result.blockedReason).toContain("plain-text-only");
      expect(result.replyEvidence).toBeNull();
      expect(result.stateWritten).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("marks processed after a valid local tap_reply sent receipt", async () => {
    const { root, commsDir, stateDir } = makeRoot();
    const runner: HeadlessRunner = {
      async run(request) {
        fs.mkdirSync(request.replyReceiptDir, { recursive: true });
        fs.writeFileSync(
          path.join(request.replyReceiptDir, "reply-receipt.json"),
          JSON.stringify(
            {
              version: 1,
              type: "tap_reply.sent",
              messageId: "receipt-1",
              from: "codex",
              to: "윤",
              subject: "headless-receipt",
              fileName: "20260603-codex-yoon-headless-receipt.md",
              transport: "inbox",
              fallbackToInbox: true,
            },
            null,
            2,
          ),
          "utf8",
        );
        return { exitCode: 0, timedOut: false, stdout: "", stderr: "" };
      },
    };
    try {
      writeInbox(
        commsDir,
        "20260603-yoon-jun-headless-receipt.md",
        "From: 윤\nTo: 준\nSubject: headless-receipt\nMessage-Id: msg-receipt\n\nplease respond",
        new Date("2026-06-03T00:04:00.000Z"),
      );

      const result = await runHeadlessResponseLoop({
        mode: "once",
        commsDir,
        stateDir,
        stateName: "headless-receipt",
        agent: "준",
        aliases: ["codex"],
        runner,
        now: new Date("2026-06-03T00:05:00.000Z"),
      });

      expect(result.status).toBe("completed");
      expect(result.replyEvidence).toMatchObject({
        source: "reply-receipt",
        path: "headless-reply-receipts/reply-receipt.json",
        filename: "20260603-codex-yoon-headless-receipt.md",
        from: "codex",
        to: "윤",
      });
      expect(result.stateWritten).toBe(true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("accepts review-family tap_reply sent receipt subjects", async () => {
    const { root, commsDir, stateDir } = makeRoot();
    const runner: HeadlessRunner = {
      async run(request) {
        fs.mkdirSync(request.replyReceiptDir, { recursive: true });
        fs.writeFileSync(
          path.join(request.replyReceiptDir, "review-clean-receipt.json"),
          JSON.stringify(
            {
              version: 1,
              type: "tap_reply.sent",
              messageId: "receipt-review-clean",
              from: "codex",
              to: "윤",
              subject: "pr1367-review-clean",
              fileName: "20260603-codex-yoon-pr1367-review-clean.md",
              transport: "inbox",
              fallbackToInbox: true,
            },
            null,
            2,
          ),
          "utf8",
        );
        return { exitCode: 0, timedOut: false, stdout: "", stderr: "" };
      },
    };
    try {
      writeInbox(
        commsDir,
        "20260603-yoon-jun-pr1367-review-request.md",
        "From: 윤\nTo: 준\nSubject: pr1367-review-request\nMessage-Id: msg-review-receipt-request\n\nplease review",
        new Date("2026-06-03T00:04:00.000Z"),
      );

      const result = await runHeadlessResponseLoop({
        mode: "once",
        commsDir,
        stateDir,
        stateName: "pr1367-review-request",
        agent: "준",
        aliases: ["codex"],
        runner,
        now: new Date("2026-06-03T00:05:00.000Z"),
      });

      expect(result.status).toBe("completed");
      expect(result.replyEvidence).toMatchObject({
        source: "reply-receipt",
        path: "headless-reply-receipts/review-clean-receipt.json",
        filename: "20260603-codex-yoon-pr1367-review-clean.md",
        subject: "pr1367-review-clean",
      });
      expect(result.stateWritten).toBe(true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("accepts timestamped smoke-family tap_reply sent receipt subjects", async () => {
    const { root, commsDir, stateDir } = makeRoot();
    const runner: HeadlessRunner = {
      async run(request) {
        fs.mkdirSync(request.replyReceiptDir, { recursive: true });
        fs.writeFileSync(
          path.join(request.replyReceiptDir, "smoke-reply-receipt.json"),
          JSON.stringify(
            {
              version: 1,
              type: "tap_reply.sent",
              messageId: "receipt-smoke-reply",
              from: "codex",
              to: "윤",
              subject: "m472-tui-down-headless-receipt-smoke-reply",
              fileName:
                "20260603-codex-yoon-m472-tui-down-headless-receipt-smoke-reply.md",
              transport: "inbox",
              fallbackToInbox: true,
            },
            null,
            2,
          ),
          "utf8",
        );
        return { exitCode: 0, timedOut: false, stdout: "", stderr: "" };
      },
    };
    try {
      writeInbox(
        commsDir,
        "20260603-yoon-jun-m472-tui-down-headless-receipt-smoke-20260603T2328Z.md",
        "From: 윤\nTo: 준\nSubject: m472-tui-down-headless-receipt-smoke-20260603T2328Z\nMessage-Id: msg-smoke-receipt-timestamp\n\nplease smoke",
        new Date("2026-06-03T00:04:00.000Z"),
      );

      const result = await runHeadlessResponseLoop({
        mode: "once",
        commsDir,
        stateDir,
        stateName: "m472-tui-down-headless-receipt-smoke-20260603T2328Z",
        agent: "준",
        aliases: ["codex"],
        runner,
        now: new Date("2026-06-03T00:05:00.000Z"),
      });

      expect(result.status).toBe("completed");
      expect(result.replyEvidence).toMatchObject({
        source: "reply-receipt",
        path: "headless-reply-receipts/smoke-reply-receipt.json",
        filename:
          "20260603-codex-yoon-m472-tui-down-headless-receipt-smoke-reply.md",
        subject: "m472-tui-down-headless-receipt-smoke-reply",
      });
      expect(result.stateWritten).toBe(true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not accept reply receipts for unrelated subjects", async () => {
    const { root, commsDir, stateDir } = makeRoot();
    const runner: HeadlessRunner = {
      async run(request) {
        fs.mkdirSync(request.replyReceiptDir, { recursive: true });
        fs.writeFileSync(
          path.join(request.replyReceiptDir, "unrelated-subject.json"),
          JSON.stringify({
            type: "tap_reply.sent",
            from: "codex",
            to: "윤",
            subject: "pr1366-review-clean",
          }),
          "utf8",
        );
        return { exitCode: 0, timedOut: false, stdout: "", stderr: "" };
      },
    };
    try {
      writeInbox(
        commsDir,
        "20260603-yoon-jun-headless-receipt-subject.md",
        "From: 윤\nTo: 준\nSubject: headless-receipt-subject\nMessage-Id: msg-receipt-subject\n\nplease respond",
        new Date("2026-06-03T00:04:00.000Z"),
      );

      const result = await runHeadlessResponseLoop({
        mode: "once",
        commsDir,
        stateDir,
        stateName: "headless-receipt-subject",
        agent: "준",
        aliases: ["codex"],
        runner,
        now: new Date("2026-06-03T00:05:00.000Z"),
      });

      expect(result.status).toBe("blocked");
      expect(result.blockedReason).toContain("plain-text-only");
      expect(result.replyEvidence).toBeNull();
      expect(result.stateWritten).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("blocks correlated reply receipts from unrelated senders", async () => {
    const { root, commsDir, stateDir } = makeRoot();
    const runner: HeadlessRunner = {
      async run(request) {
        fs.mkdirSync(request.replyReceiptDir, { recursive: true });
        fs.writeFileSync(
          path.join(request.replyReceiptDir, "unrelated-receipt.json"),
          JSON.stringify({
            type: "tap_reply.sent",
            from: "하",
            to: "윤",
            subject: "headless-unrelated-receipt",
          }),
          "utf8",
        );
        return { exitCode: 0, timedOut: false, stdout: "", stderr: "" };
      },
    };
    try {
      writeInbox(
        commsDir,
        "20260603-yoon-jun-headless-unrelated-receipt.md",
        "From: 윤\nTo: 준\nSubject: headless-unrelated-receipt\nMessage-Id: msg-unrelated-receipt\n\nplease respond",
        new Date("2026-06-03T00:04:00.000Z"),
      );

      const result = await runHeadlessResponseLoop({
        mode: "once",
        commsDir,
        stateDir,
        stateName: "headless-unrelated-receipt",
        agent: "준",
        aliases: ["codex"],
        runner,
        now: new Date("2026-06-03T00:05:00.000Z"),
      });

      expect(result.status).toBe("blocked");
      expect(result.blockedReason).toContain("reply-evidence-sender-mismatch");
      expect(result.blockedReason).toContain("expected=준,codex");
      expect(result.blockedReason).toContain("actual=하");
      expect(result.replyEvidence).toBeNull();
      expect(result.stateWritten).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("blocks wrong-sender reply receipts even when valid receipts are also present", async () => {
    const { root, commsDir, stateDir } = makeRoot();
    const runner: HeadlessRunner = {
      async run(request) {
        fs.mkdirSync(request.replyReceiptDir, { recursive: true });
        fs.writeFileSync(
          path.join(request.replyReceiptDir, "a-valid-receipt.json"),
          JSON.stringify({
            type: "tap_reply.sent",
            from: "율",
            to: "윤",
            subject: "headless-mixed-receipt",
            fileName: "20260603-yul-yoon-headless-mixed-receipt.md",
          }),
          "utf8",
        );
        fs.writeFileSync(
          path.join(request.replyReceiptDir, "z-wrong-receipt.json"),
          JSON.stringify({
            type: "tap_reply.sent",
            from: "준",
            to: "윤",
            subject: "headless-mixed-receipt",
            fileName: "20260603-jun-yoon-headless-mixed-receipt.md",
          }),
          "utf8",
        );
        return { exitCode: 0, timedOut: false, stdout: "", stderr: "" };
      },
    };
    try {
      writeInbox(
        commsDir,
        "20260603-yoon-yul-headless-mixed-receipt.md",
        "From: 윤\nTo: 율\nSubject: headless-mixed-receipt\nMessage-Id: msg-mixed-receipt\n\nplease respond",
        new Date("2026-06-03T00:04:00.000Z"),
      );

      const result = await runHeadlessResponseLoop({
        mode: "once",
        commsDir,
        stateDir,
        stateName: "headless-mixed-receipt",
        agent: "율",
        runner,
        now: new Date("2026-06-03T00:05:00.000Z"),
      });

      expect(result.status).toBe("blocked");
      expect(result.blockedReason).toContain("reply-evidence-sender-mismatch");
      expect(result.blockedReason).toContain("expected=율");
      expect(result.blockedReason).toContain("actual=준");
      expect(result.blockedReason).toContain(
        "path=headless-reply-receipts/z-wrong-receipt.json",
      );
      expect(result.replyEvidence).toBeNull();
      expect(result.stateWritten).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("blocks timeouts without marking processed", async () => {
    const { root, commsDir, stateDir } = makeRoot();
    const runner: HeadlessRunner = {
      async run() {
        return { exitCode: null, timedOut: true, stdout: "", stderr: "" };
      },
    };
    try {
      writeInbox(
        commsDir,
        "20260603-yoon-jun-headless-timeout.md",
        "From: 윤\nTo: 준\nSubject: headless-timeout\nMessage-Id: msg-timeout\n\nplease respond",
        new Date("2026-06-03T00:04:00.000Z"),
      );

      const result = await runHeadlessResponseLoop({
        mode: "once",
        commsDir,
        stateDir,
        agent: "준",
        runner,
        timeoutMs: 100,
        now: new Date("2026-06-03T00:05:00.000Z"),
      });

      expect(result.status).toBe("blocked");
      expect(result.blockedReason).toContain("timeout");
      expect(result.stateWritten).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("exposes a headless dry-run command result", async () => {
    const { root, commsDir } = makeRoot();
    const originalCwd = process.cwd();
    try {
      fs.writeFileSync(path.join(root, "package.json"), "{}", "utf8");
      process.chdir(root);
      writeInbox(
        commsDir,
        "20260603-yoon-jun-headless-command.md",
        "From: 윤\nTo: 준\nSubject: headless-command\n\nplease respond",
        new Date("2026-06-03T00:04:00.000Z"),
      );

      const result = await headlessCommand([
        "dry-run",
        "--agent",
        "준",
        "--comms-dir",
        commsDir,
        "--all",
      ]);

      expect(result.ok).toBe(true);
      expect(result.command).toBe("headless");
      expect(result.data).toMatchObject({
        status: "dry-run",
        adapter: "headless-runner",
        runtimeSurface: "codex-cli-headless",
      });
    } finally {
      process.chdir(originalCwd);
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("honors --state-dir for command cursor isolation", async () => {
    const { root, commsDir, stateDir } = makeRoot();
    const originalCwd = process.cwd();
    try {
      fs.writeFileSync(path.join(root, "package.json"), "{}", "utf8");
      process.chdir(root);
      writeInbox(
        commsDir,
        "20260603-yoon-jun-headless-state-dir.md",
        "From: 윤\nTo: 준\nSubject: headless-state-dir\n\nplease respond",
        new Date("2026-06-03T00:04:00.000Z"),
      );

      const result = await headlessCommand([
        "dry-run",
        "--agent",
        "준",
        "--comms-dir",
        commsDir,
        "--state-dir",
        stateDir,
        "--all",
      ]);

      expect(result.ok).toBe(true);
      expect(result.data).toMatchObject({ status: "dry-run" });
      expect(String(result.data.statePath)).toContain(stateDir);
    } finally {
      process.chdir(originalCwd);
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects missing or empty --state-dir values", async () => {
    const missingValue = await headlessCommand([
      "dry-run",
      "--agent",
      "준",
      "--state-dir",
    ]);
    const emptyValue = await headlessCommand([
      "dry-run",
      "--agent",
      "준",
      "--state-dir=",
    ]);

    expect(missingValue.ok).toBe(false);
    expect(missingValue.code).toBe("TAP_INVALID_ARGUMENT");
    expect(missingValue.message).toContain("Invalid --state-dir");
    expect(emptyValue.ok).toBe(false);
    expect(emptyValue.code).toBe("TAP_INVALID_ARGUMENT");
    expect(emptyValue.message).toContain("Invalid --state-dir");
  });

  it("reports invalid numeric command flags as operator argument errors", async () => {
    const timeout = await headlessCommand([
      "dry-run",
      "--agent",
      "준",
      "--timeout-ms",
      "0",
    ]);
    const sinceMinutes = await headlessCommand([
      "dry-run",
      "--agent",
      "준",
      "--since-minutes",
      "nope",
    ]);

    expect(timeout.ok).toBe(false);
    expect(timeout.code).toBe("TAP_INVALID_ARGUMENT");
    expect(timeout.message).toContain("Invalid --timeout-ms");
    expect(sinceMinutes.ok).toBe(false);
    expect(sinceMinutes.code).toBe("TAP_INVALID_ARGUMENT");
    expect(sinceMinutes.message).toContain("Invalid --since-minutes");
  });
});
