import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  resolvePollingReceiverStatePath,
  runPollingReceiver,
} from "../receiver/codex-cli-polling-receiver.js";
import { writeProjectedEnvelopeBackfill } from "../receiver/projected-envelope-backfill.js";
import {
  runCodexCliAppServerPromotion,
  type CodexAppServerPromoter,
} from "../receiver/codex-cli-app-server-promotion.js";
import { runSupervisedReceiverPromotion } from "../receiver/supervised-receiver-promotion.js";
import { receiverCommand } from "../commands/receiver.js";

function makeRoot(): { root: string; commsDir: string; stateDir: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tap-receiver-"));
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

function writeRegisteredReview(commsDir: string, prNumber: number): void {
  const dir = path.join(commsDir, "reviews", "registered", `pr${prNumber}`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "r2-rereview-clean-jun.md"),
    [
      "---",
      "type: tap-review-registration",
      "status: registered",
      `pr: ${prNumber}`,
      'round: "R2"',
      'reviewer: "준"',
      'outcomeType: "rereview-clean"',
      "---",
      "",
      "registered review evidence",
    ].join("\n"),
    "utf8",
  );
}

describe("projected envelope backfill", () => {
  it("writes compact receiver-side evidence and dedupes repeated projections", () => {
    const { root, commsDir } = makeRoot();
    try {
      const first = writeProjectedEnvelopeBackfill({
        commsDir,
        sender: "윤",
        recipient: "솔",
        subject: "assignment-m550",
        body: "Implement the envelope SSOT invariant.",
        sourceSurface: "codex-app-chat-envelope",
        receivedAt: "2026-06-14T03:45:00.000Z",
        messageId: "msg-m550",
        projectionId: "projection-m550",
        routeTurnId: "turn-m550",
      });
      const second = writeProjectedEnvelopeBackfill({
        commsDir,
        sender: "윤",
        recipient: "솔",
        subject: "assignment-m550",
        body: "Implement the envelope SSOT invariant.",
        sourceSurface: "codex-app-chat-envelope",
        receivedAt: "2026-06-14T03:45:30.000Z",
        messageId: "msg-m550",
        projectionId: "projection-m550",
        routeTurnId: "turn-m550",
      });

      expect(first.status).toBe("written");
      expect(second.status).toBe("exists");
      expect(second.inboxPath).toBe(first.inboxPath);
      expect(fs.readdirSync(path.join(commsDir, "inbox"))).toHaveLength(1);
      const written = fs.readFileSync(first.filePath, "utf8");
      expect(written).toContain("subtype: envelope-backfill");
      expect(written).toContain("original_message_id: msg-m550");
      expect(written).toContain("source_surface: codex-app-chat-envelope");
      expect(written).toContain("route_turn_id: turn-m550");
      expect(written).toContain("Implement the envelope SSOT invariant.");
      expect(written).toContain("not proof of live App delivery");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not backfill when original durable message evidence already exists", () => {
    const { root, commsDir } = makeRoot();
    try {
      writeInbox(
        commsDir,
        "20260614-yoon-sol-existing.md",
        [
          "---",
          "type: inbox",
          "message_id: msg-existing",
          "from: 윤",
          "to: 솔",
          "subject: existing",
          "---",
          "",
          "original",
        ].join("\n"),
        new Date("2026-06-14T03:40:00.000Z"),
      );

      const result = writeProjectedEnvelopeBackfill({
        commsDir,
        sender: "윤",
        recipient: "솔",
        subject: "existing",
        body: "projected copy",
        sourceSurface: "codex-app-chat-envelope",
        receivedAt: "2026-06-14T03:45:00.000Z",
        messageId: "msg-existing",
      });

      expect(result.status).toBe("exists");
      expect(result.inboxPath).toBe("inbox/20260614-yoon-sol-existing.md");
      expect(fs.readdirSync(path.join(commsDir, "inbox"))).toHaveLength(1);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("dedupes backfill against projection and route-turn durable evidence", () => {
    const { root, commsDir } = makeRoot();
    try {
      writeInbox(
        commsDir,
        "20260614-yoon-sol-projection-existing.md",
        [
          "---",
          "type: inbox",
          "from: 윤",
          "to: 솔",
          "subject: projection-existing",
          "projection_id: projection-existing",
          "---",
          "",
          "original projection evidence",
        ].join("\n"),
        new Date("2026-06-14T03:40:00.000Z"),
      );
      writeInbox(
        commsDir,
        "20260614-yoon-sol-turn-existing.md",
        [
          "---",
          "type: inbox",
          "from: 윤",
          "to: 솔",
          "subject: turn-existing",
          "route_turn_id: turn-existing",
          "---",
          "",
          "original turn evidence",
        ].join("\n"),
        new Date("2026-06-14T03:41:00.000Z"),
      );

      const projectionResult = writeProjectedEnvelopeBackfill({
        commsDir,
        sender: "윤",
        recipient: "솔",
        subject: "projection-existing",
        body: "projected copy",
        sourceSurface: "codex-app-chat-envelope",
        receivedAt: "2026-06-14T03:45:00.000Z",
        projectionId: "projection-existing",
      });
      const routeTurnResult = writeProjectedEnvelopeBackfill({
        commsDir,
        sender: "윤",
        recipient: "솔",
        subject: "turn-existing",
        body: "turn copy",
        sourceSurface: "codex-app-chat-envelope",
        receivedAt: "2026-06-14T03:46:00.000Z",
        routeTurnId: "turn-existing",
      });

      expect(projectionResult.status).toBe("exists");
      expect(projectionResult.inboxPath).toBe(
        "inbox/20260614-yoon-sol-projection-existing.md",
      );
      expect(routeTurnResult.status).toBe("exists");
      expect(routeTurnResult.inboxPath).toBe(
        "inbox/20260614-yoon-sol-turn-existing.md",
      );
      expect(fs.readdirSync(path.join(commsDir, "inbox")).sort()).toEqual([
        "20260614-yoon-sol-projection-existing.md",
        "20260614-yoon-sol-turn-existing.md",
      ]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("Codex CLI polling receiver", () => {
  it("dry-runs pending local inbox items without writing cursor state", async () => {
    const { root, commsDir, stateDir } = makeRoot();
    try {
      writeInbox(
        commsDir,
        "20260602-yoon-jun-m460.md",
        "From: 윤\nTo: 준\nSubject: m460\n\nstart please",
        new Date("2026-06-02T00:04:00.000Z"),
      );

      const result = await runPollingReceiver({
        mode: "check",
        commsDir,
        stateDir,
        agent: "준",
        aliases: ["jun"],
        now: new Date("2026-06-02T00:05:00.000Z"),
      });

      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toMatchObject({
        from: "윤",
        to: "준",
        subject: "m460",
        content: "start please",
      });
      expect(result.stateWritten).toBe(false);
      expect(fs.existsSync(result.statePath)).toBe(false);
      expect(result.promptBundle).toContain("operator-mediated");
      expect(result.promptBundle).toContain("Tap message for 준");
      expect(result.promptBundle).not.toContain("dedupeKey:");
      expect(result.adapter).toBe("file-polling");
      expect(result.receiveTransport).toBe("polling");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not treat another agent's structured codex route as current receiver", async () => {
    const { root, commsDir, stateDir } = makeRoot();
    try {
      writeInbox(
        commsDir,
        "20260616-jun-bom-review-clean.md",
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
        new Date("2026-06-16T13:48:47.000Z"),
      );

      const result = await runPollingReceiver({
        mode: "check",
        commsDir,
        stateDir,
        agent: "윤",
        aliases: ["codex"],
        since: "2026-06-16T13:48:00.000Z",
        now: new Date("2026-06-16T13:49:00.000Z"),
      });

      expect(result.status).toBe("idle");
      expect(result.items).toHaveLength(0);
      expect(result.skipped.notForAgent).toBe(1);
      expect(result.stateWritten).toBe(false);
      expect(fs.existsSync(result.statePath)).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps the intended structured codex route deliverable by display name", async () => {
    const { root, commsDir, stateDir } = makeRoot();
    try {
      writeInbox(
        commsDir,
        "20260616-jun-bom-review-clean.md",
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
          "this is for 봄",
        ].join("\n"),
        new Date("2026-06-16T13:48:47.000Z"),
      );

      const result = await runPollingReceiver({
        mode: "check",
        commsDir,
        stateDir,
        agent: "봄",
        aliases: ["codex"],
        since: "2026-06-16T13:48:00.000Z",
        now: new Date("2026-06-16T13:49:00.000Z"),
      });

      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toMatchObject({
        to: "codex",
        toName: "봄",
        subject: "review-clean",
      });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps plain review requests visible after registered terminal evidence", async () => {
    const { root, commsDir, stateDir } = makeRoot();
    try {
      writeRegisteredReview(commsDir, 1572);
      writeInbox(
        commsDir,
        "20260616-yoon-bom-review-request-pr1572.md",
        [
          "---",
          "type: inbox",
          "from: 윤",
          "to: 봄",
          "subject: review-request-pr1572",
          "message_id: msg-stale-request",
          "---",
          "",
          "Please review PR #1572. Prior result: P1/P2/P3: none.",
        ].join("\n"),
        new Date("2026-06-16T13:48:47.000Z"),
      );

      const result = await runPollingReceiver({
        mode: "check",
        commsDir,
        stateDir,
        agent: "봄",
        since: "2026-06-16T13:48:00.000Z",
        now: new Date("2026-06-16T13:49:00.000Z"),
      });

      expect(result.status).toBe("pending");
      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toMatchObject({
        subject: "review-request-pr1572",
        messageId: "msg-stale-request",
      });
      expect(result.skipped.staleMeta).toBe(0);
      expect(result.stateWritten).toBe(false);
      expect(
        fs.existsSync(
          path.join(
            commsDir,
            "inbox",
            "20260616-yoon-bom-review-request-pr1572.md",
          ),
        ),
      ).toBe(true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps rereview requests visible even when an older review exists", async () => {
    const { root, commsDir, stateDir } = makeRoot();
    try {
      writeRegisteredReview(commsDir, 1592);
      writeInbox(
        commsDir,
        "20260619-yoon-jun-r2-review-request-pr1592.md",
        [
          "---",
          "type: inbox",
          "from: 윤",
          "to: 준",
          "subject: r2-review-request-pr1592-m585-bom-codex-uplink-attribution",
          "message_id: msg-r2-review-request",
          "---",
          "",
          "Please review the updated head after the R1 finding closure.",
          "",
          "Prior context quoted for continuity: P1/P2/P3: none.",
        ].join("\n"),
        new Date("2026-06-19T05:28:00.000Z"),
      );

      const result = await runPollingReceiver({
        mode: "check",
        commsDir,
        stateDir,
        agent: "준",
        since: "2026-06-19T05:00:00.000Z",
        now: new Date("2026-06-19T05:29:00.000Z"),
      });

      expect(result.status).toBe("pending");
      expect(result.items).toHaveLength(1);
      expect(result.items[0]?.subject).toBe(
        "r2-review-request-pr1592-m585-bom-codex-uplink-attribution",
      );
      expect(result.skipped.staleMeta).toBe(0);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("collapses already-current-head review meta even when it quotes severity", async () => {
    const { root, commsDir, stateDir } = makeRoot();
    try {
      writeRegisteredReview(commsDir, 1572);
      writeInbox(
        commsDir,
        "20260616-jun-bom-pr1572-r2-current-head-review-already-complete.md",
        [
          "---",
          "type: inbox",
          "from: 준",
          "to: 봄",
          "subject: pr1572-r2-current-head-review-already-complete",
          "message_id: msg-current-head-already-complete",
          "---",
          "",
          "This status correction is already handled.",
          "",
          "- Result: P1/P2/P3 none, merge-ready.",
        ].join("\n"),
        new Date("2026-06-16T13:48:47.000Z"),
      );

      const result = await runPollingReceiver({
        mode: "check",
        commsDir,
        stateDir,
        agent: "봄",
        since: "2026-06-16T13:48:00.000Z",
        now: new Date("2026-06-16T13:49:00.000Z"),
      });

      expect(result.status).toBe("idle");
      expect(result.items).toHaveLength(0);
      expect(result.skipped.staleMeta).toBe(1);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps new formal review outcomes visible for a PR with terminal evidence", async () => {
    const { root, commsDir, stateDir } = makeRoot();
    try {
      writeRegisteredReview(commsDir, 1572);
      writeInbox(
        commsDir,
        "20260616-jun-bom-r3-review-pr1572-clean.md",
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
        new Date("2026-06-16T13:48:47.000Z"),
      );

      const result = await runPollingReceiver({
        mode: "check",
        commsDir,
        stateDir,
        agent: "봄",
        since: "2026-06-16T13:48:00.000Z",
        now: new Date("2026-06-16T13:49:00.000Z"),
      });

      expect(result.status).toBe("pending");
      expect(result.items).toHaveLength(1);
      expect(result.items[0]?.subject).toBe("r3-review-pr1572-clean");
      expect(result.skipped.staleMeta).toBe(0);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("shows receiver envelope metadata only in debug mode", async () => {
    const { root, commsDir, stateDir } = makeRoot();
    try {
      writeInbox(
        commsDir,
        "20260602-yoon-jun-debug-envelope.md",
        [
          "---",
          "from: codex",
          "from_name: 윤",
          'from_address: {"routingAddress":"codex","hostId":"/home/devin/hua-comms"}',
          "to: 준",
          "subject: debug-envelope",
          "message_id: msg-debug-envelope",
          "---",
          "",
          "debug please",
        ].join("\n"),
        new Date("2026-06-02T00:04:00.000Z"),
      );

      const compact = await runPollingReceiver({
        mode: "check",
        commsDir,
        stateDir,
        agent: "준",
        now: new Date("2026-06-02T00:05:00.000Z"),
      });
      const debug = await runPollingReceiver({
        mode: "check",
        commsDir,
        stateDir,
        agent: "준",
        now: new Date("2026-06-02T00:05:00.000Z"),
        debugEnvelope: true,
      });

      expect(compact.promptBundle).toContain("Tap message for 준");
      expect(compact.promptBundle).not.toContain("Debug envelope:");
      expect(compact.promptBundle).not.toContain("dedupeKey:");
      expect(compact.promptBundle).not.toContain("msg-debug-envelope");
      expect(debug.promptBundle).toContain("Debug envelope:");
      expect(debug.promptBundle).toContain(
        "- file: 20260602-yoon-jun-debug-envelope.md",
      );
      expect(debug.promptBundle).toContain("dedupeKey: msg-debug-envelope");
      expect(debug.promptBundle).toContain("messageId: msg-debug-envelope");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("preserves structured sender addresses from message frontmatter", async () => {
    const { root, commsDir, stateDir } = makeRoot();
    try {
      writeInbox(
        commsDir,
        "20260602-yoon-jun-structured-route.md",
        [
          "---",
          "from: codex",
          "from_name: 윤",
          'from_address: {"hostId":"/home/devin/hua-comms","clientId":"codex","conversationId":null,"ownerClientId":null,"routingAddress":"codex","aliases":["codex","윤"]}',
          "to: 준",
          "to_name: 준",
          "subject: structured-route",
          "---",
          "",
          "reply through structured route",
        ].join("\n"),
        new Date("2026-06-02T00:04:00.000Z"),
      );

      const result = await runPollingReceiver({
        mode: "check",
        commsDir,
        stateDir,
        agent: "준",
        now: new Date("2026-06-02T00:05:00.000Z"),
      });

      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toMatchObject({
        from: "codex",
        fromName: "윤",
        to: "준",
        toName: "준",
        subject: "structured-route",
      });
      expect(result.items[0].fromAddress).toMatchObject({
        routingAddress: "codex",
        hostId: "/home/devin/hua-comms",
        aliases: ["codex", "윤"],
      });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("skips old historical inbox files by default when applying a fresh cursor", async () => {
    const { root, commsDir, stateDir } = makeRoot();
    try {
      writeInbox(
        commsDir,
        "20260602-yoon-jun-old.md",
        "From: 윤\nTo: 준\nSubject: old\n\nold message",
        new Date("2026-06-02T00:00:00.000Z"),
      );

      const result = await runPollingReceiver({
        mode: "apply",
        commsDir,
        stateDir,
        agent: "준",
        now: new Date("2026-06-02T00:10:00.000Z"),
      });

      expect(result.items).toHaveLength(0);
      expect(result.skipped.old).toBe(1);
      expect(result.stateWritten).toBe(true);
      expect(fs.existsSync(result.statePath)).toBe(true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("detects a synthetic inbox message after receiver start in watch mode", async () => {
    const { root, commsDir, stateDir } = makeRoot();
    try {
      const startedAt = new Date("2026-06-02T00:10:00.000Z");
      const watch = runPollingReceiver({
        mode: "watch",
        commsDir,
        stateDir,
        agent: "준",
        now: startedAt,
        intervalMs: 100,
        maxIterations: 5,
      });

      setTimeout(() => {
        writeInbox(
          commsDir,
          "20260602-yoon-jun-after-start.md",
          "From: 윤\nTo: 준\nSubject: after-start\n\nnew message",
          new Date("2026-06-02T00:10:01.000Z"),
        );
      }, 20);

      const result = await watch;
      expect(result.items).toHaveLength(1);
      expect(result.items[0].subject).toBe("after-start");
      expect(result.stateWritten).toBe(true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("ignores duplicate projection of the same file after apply", async () => {
    const { root, commsDir, stateDir } = makeRoot();
    try {
      writeInbox(
        commsDir,
        "20260602-yoon-jun-duplicate.md",
        "From: 윤\nTo: 준\nSubject: duplicate\n\nfirst",
        new Date("2026-06-02T00:10:01.000Z"),
      );
      const first = await runPollingReceiver({
        mode: "apply",
        commsDir,
        stateDir,
        agent: "준",
        since: "2026-06-02T00:10:00.000Z",
        now: new Date("2026-06-02T00:10:02.000Z"),
      });
      expect(first.items).toHaveLength(1);

      writeInbox(
        commsDir,
        "20260602-yoon-jun-duplicate.md",
        "From: 윤\nTo: 준\nSubject: duplicate\n\nsecond",
        new Date("2026-06-02T00:10:03.000Z"),
      );
      const second = await runPollingReceiver({
        mode: "apply",
        commsDir,
        stateDir,
        agent: "준",
        since: "2026-06-02T00:10:00.000Z",
        now: new Date("2026-06-02T00:10:04.000Z"),
      });

      expect(second.items).toHaveLength(0);
      expect(second.skipped.duplicate).toBe(1);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps receiver cursor state outside the comms directory", () => {
    const { root, commsDir, stateDir } = makeRoot();
    try {
      const statePath = resolvePollingReceiverStatePath({
        stateDir,
        agent: "준",
      });
      expect(statePath.startsWith(path.join(stateDir, "receiver"))).toBe(true);
      expect(statePath.startsWith(commsDir)).toBe(false);
      expect(path.basename(statePath)).toBe("codex-cli-준.json");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("exposes a check mode command for operator-mediated promotion", async () => {
    const { root, commsDir } = makeRoot();
    const originalCwd = process.cwd();
    try {
      fs.writeFileSync(path.join(root, "package.json"), "{}", "utf8");
      process.chdir(root);
      writeInbox(
        commsDir,
        "20260602-yoon-jun-command.md",
        "From: 윤\nTo: 준\nSubject: command\n\ncommand body",
        new Date("2026-06-02T00:10:01.000Z"),
      );

      const result = await receiverCommand([
        "check",
        "--agent",
        "준",
        "--comms-dir",
        commsDir,
        "--since",
        "2026-06-02T00:10:00.000Z",
      ]);

      expect(result.ok).toBe(true);
      expect(result.command).toBe("receiver");
      expect(result.code).toBe("TAP_RECEIVER_OK");
      expect(result.data).toMatchObject({
        adapter: "file-polling",
        receiveTransport: "polling",
        stateWritten: false,
      });
      expect((result.data as { items: unknown[] }).items).toHaveLength(1);
    } finally {
      process.chdir(originalCwd);
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("builds a shared app-server promotion prompt without writing cursor state in dry-run", async () => {
    const { root, commsDir, stateDir } = makeRoot();
    try {
      writeInbox(
        commsDir,
        "20260602-yoon-jun-promote-dry-run.md",
        "From: 윤\nTo: 준\nSubject: promote-dry-run\n\nplease review",
        new Date("2026-06-02T00:10:01.000Z"),
      );

      const result = await runCodexCliAppServerPromotion({
        commsDir,
        stateDir,
        agent: "준",
        since: "2026-06-02T00:10:00.000Z",
        appServerUrl: "ws://127.0.0.1:4510",
        dryRun: true,
        cwd: root,
      });

      expect(result.status).toBe("dry-run");
      expect(result.stateWritten).toBe(false);
      expect(result.promptText).toContain("Tap message for 준");
      expect(result.promptText).toContain("Reply available: 윤");
      expect(result.promptText).not.toContain("Use tap_reply");
      expect(result.promptText).not.toContain("File:");
      expect(result.endpointProfile.classifiedProfileId).toBe(
        "direct-local-main",
      );
      expect(fs.existsSync(result.statePath)).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("promotes structured return routes instead of unknown display routes", async () => {
    const { root, commsDir, stateDir } = makeRoot();
    try {
      writeInbox(
        commsDir,
        "20260602-unknown-jun-promote-structured.md",
        [
          "---",
          "from: unknown",
          "from_name: 윤",
          'from_address: {"hostId":"/home/devin/hua-comms","clientId":"codex","conversationId":null,"ownerClientId":null,"routingAddress":"codex","aliases":["codex","윤"]}',
          "to: 준",
          "subject: promote-structured",
          "---",
          "",
          "please reply through the structured return route",
        ].join("\n"),
        new Date("2026-06-02T00:10:01.000Z"),
      );

      const result = await runCodexCliAppServerPromotion({
        commsDir,
        stateDir,
        agent: "준",
        since: "2026-06-02T00:10:00.000Z",
        appServerUrl: "ws://127.0.0.1:4510",
        dryRun: true,
        cwd: root,
      });

      expect(result.status).toBe("dry-run");
      expect(result.promptText).toContain("From: 윤");
      expect(result.promptText).toContain("Reply available: codex");
      expect(result.promptText).not.toContain("Use tap_reply");
      expect(result.promptText).not.toContain("Return route:");
      expect(result.promptText).not.toContain("from_address");
      expect(result.promptText).not.toContain('tap_reply(to: "unknown"');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("diagnoses missing return routes during promotion instead of targeting unknown", async () => {
    const { root, commsDir, stateDir } = makeRoot();
    try {
      writeInbox(
        commsDir,
        "20260602-unknown-jun-promote-missing-route.md",
        "From: unknown\nTo: 준\nSubject: promote-missing-route\n\nplease reply",
        new Date("2026-06-02T00:10:01.000Z"),
      );

      const result = await runCodexCliAppServerPromotion({
        commsDir,
        stateDir,
        agent: "준",
        since: "2026-06-02T00:10:00.000Z",
        appServerUrl: "ws://127.0.0.1:4510",
        dryRun: true,
        cwd: root,
      });

      expect(result.status).toBe("dry-run");
      expect(result.promptText).toContain("No valid structured return route");
      expect(result.promptText).toContain(
        "`unknown` is not a valid reply target",
      );
      expect(result.promptText).not.toContain('Use tap_reply(to: "unknown"');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not promote clientId-only sender addresses into tap_reply targets", async () => {
    const { root, commsDir, stateDir } = makeRoot();
    try {
      writeInbox(
        commsDir,
        "20260602-unknown-jun-client-id-only.md",
        [
          "---",
          "from: unknown",
          'from_address: {"clientId":"client-uuid-only","conversationId":"thread","ownerClientId":"owner"}',
          "to: 준",
          "subject: client-id-only",
          "---",
          "",
          "client id is metadata, not a route",
        ].join("\n"),
        new Date("2026-06-02T00:10:01.000Z"),
      );

      const result = await runCodexCliAppServerPromotion({
        commsDir,
        stateDir,
        agent: "준",
        since: "2026-06-02T00:10:00.000Z",
        appServerUrl: "ws://127.0.0.1:4510",
        dryRun: true,
        cwd: root,
      });

      expect(result.status).toBe("dry-run");
      expect(result.item?.fromAddress).toMatchObject({
        clientId: "client-uuid-only",
        routingAddress: null,
      });
      expect(result.promptText).toContain("No valid structured return route");
      expect(result.promptText).toContain(
        "`unknown` is not a valid reply target",
      );
      expect(result.promptText).not.toContain(
        'Use tap_reply(to: "client-uuid-only"',
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("fails closed on active app-server turns without marking the item processed", async () => {
    const { root, commsDir, stateDir } = makeRoot();
    const promoter: CodexAppServerPromoter = {
      async promote(request) {
        expect(request.text).toContain("Subject: active-turn");
        return {
          delivered: false,
          turnId: null,
          threadId: "thread-active",
          runtimeHealth: "active-turn",
          blockedReason: "active-turn: thread already busy",
        };
      },
    };
    try {
      writeInbox(
        commsDir,
        "20260602-yoon-jun-active-turn.md",
        "From: 윤\nTo: 준\nSubject: active-turn\n\nbusy?",
        new Date("2026-06-02T00:10:01.000Z"),
      );

      const result = await runCodexCliAppServerPromotion({
        commsDir,
        stateDir,
        agent: "준",
        since: "2026-06-02T00:10:00.000Z",
        appServerUrl: "ws://127.0.0.1:4510",
        cwd: root,
        promoter,
      });

      expect(result.status).toBe("blocked");
      expect(result.runtimeHealth).toBe("active-turn");
      expect(result.queued).toBe(true);
      expect(result.queueReason).toContain("active-turn");
      expect(result.steerAttempted).toBe(false);
      expect(result.stateWritten).toBe(false);
      expect(fs.existsSync(result.statePath)).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("marks delivered app-server promotions so duplicate projection is not promoted twice", async () => {
    const { root, commsDir, stateDir } = makeRoot();
    let calls = 0;
    const promoter: CodexAppServerPromoter = {
      async promote() {
        calls += 1;
        return {
          delivered: true,
          turnId: "turn-1",
          threadId: "thread-1",
          runtimeHealth: "idle",
          blockedReason: null,
        };
      },
    };
    try {
      writeInbox(
        commsDir,
        "20260602-yoon-jun-delivered.md",
        "From: 윤\nTo: 준\nSubject: delivered\nMessage-Id: msg-delivered\n\nship it",
        new Date("2026-06-02T00:10:01.000Z"),
      );

      const first = await runCodexCliAppServerPromotion({
        commsDir,
        stateDir,
        agent: "준",
        since: "2026-06-02T00:10:00.000Z",
        appServerUrl: "ws://127.0.0.1:4510",
        cwd: root,
        promoter,
      });
      const second = await runCodexCliAppServerPromotion({
        commsDir,
        stateDir,
        agent: "준",
        since: "2026-06-02T00:10:00.000Z",
        appServerUrl: "ws://127.0.0.1:4510",
        cwd: root,
        promoter,
      });

      expect(first.status).toBe("delivered");
      expect(first.turnId).toBe("turn-1");
      expect(first.stateWritten).toBe(true);
      expect(second.status).toBe("idle");
      expect(second.item).toBeNull();
      expect(calls).toBe(1);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("exposes a promote command dry-run result", async () => {
    const { root, commsDir } = makeRoot();
    const originalCwd = process.cwd();
    try {
      fs.writeFileSync(path.join(root, "package.json"), "{}", "utf8");
      process.chdir(root);
      writeInbox(
        commsDir,
        "20260602-yoon-jun-promote-command.md",
        "From: 윤\nTo: 준\nSubject: promote-command\n\ncommand body",
        new Date("2026-06-02T00:10:01.000Z"),
      );

      const result = await receiverCommand([
        "promote",
        "--agent",
        "준",
        "--comms-dir",
        commsDir,
        "--since",
        "2026-06-02T00:10:00.000Z",
        "--app-server-url",
        "ws://127.0.0.1:4510",
        "--dry-run",
      ]);

      expect(result.ok).toBe(true);
      expect(result.code).toBe("TAP_RECEIVER_OK");
      expect(result.data).toMatchObject({
        adapter: "app-server-promotion",
        runtimeSurface: "codex-cli-app-server",
        status: "dry-run",
        stateWritten: false,
      });
    } finally {
      process.chdir(originalCwd);
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("supervises and promotes pending inbox items when the app-server is idle", async () => {
    const { root, commsDir, stateDir } = makeRoot();
    let calls = 0;
    const promoter: CodexAppServerPromoter = {
      async promote(request) {
        calls += 1;
        expect(request.text).toContain("Subject: supervised");
        return {
          delivered: true,
          turnId: `turn-${calls}`,
          threadId: "thread-supervised",
          runtimeHealth: "idle",
          blockedReason: null,
        };
      },
    };
    try {
      writeInbox(
        commsDir,
        "20260602-yoon-jun-supervised.md",
        "From: 윤\nTo: 준\nSubject: supervised\n\nplease see this",
        new Date("2026-06-02T00:10:01.000Z"),
      );

      const result = await runSupervisedReceiverPromotion({
        mode: "once",
        commsDir,
        stateDir,
        agent: "준",
        since: "2026-06-02T00:10:00.000Z",
        appServerUrl: "ws://127.0.0.1:4510",
        cwd: root,
        promoter,
      });
      const duplicate = await runSupervisedReceiverPromotion({
        mode: "once",
        commsDir,
        stateDir,
        agent: "준",
        since: "2026-06-02T00:10:00.000Z",
        appServerUrl: "ws://127.0.0.1:4510",
        cwd: root,
        promoter,
      });

      expect(result).toMatchObject({
        adapter: "supervised-app-server-promotion",
        status: "delivered",
        delivered: 1,
        blocked: 0,
        iterations: 1,
      });
      expect(result.attempts).toHaveLength(1);
      expect(result.attempts[0].stateWritten).toBe(true);
      expect(duplicate.status).toBe("idle");
      expect(duplicate.attempts).toHaveLength(0);
      expect(calls).toBe(1);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("supervisor fails closed on active turns without marking the item processed", async () => {
    const { root, commsDir, stateDir } = makeRoot();
    const promoter: CodexAppServerPromoter = {
      async promote() {
        return {
          delivered: false,
          turnId: null,
          threadId: "thread-active",
          runtimeHealth: "active-turn",
          blockedReason: "active-turn: thread already busy",
        };
      },
    };
    try {
      writeInbox(
        commsDir,
        "20260602-yoon-jun-supervised-active.md",
        "From: 윤\nTo: 준\nSubject: supervised-active\n\nbusy?",
        new Date("2026-06-02T00:10:01.000Z"),
      );

      const result = await runSupervisedReceiverPromotion({
        mode: "once",
        commsDir,
        stateDir,
        agent: "준",
        since: "2026-06-02T00:10:00.000Z",
        appServerUrl: "ws://127.0.0.1:4510",
        cwd: root,
        promoter,
      });
      const stillPending = await runPollingReceiver({
        mode: "check",
        commsDir,
        stateDir,
        agent: "준",
        since: "2026-06-02T00:10:00.000Z",
      });

      expect(result.status).toBe("blocked");
      expect(result.blocked).toBe(1);
      expect(result.queued).toBe(1);
      expect(result.lastBlockedReason).toContain("active-turn");
      expect(result.lastQueueReason).toContain("active-turn");
      expect(result.attempts[0].stateWritten).toBe(false);
      expect(result.attempts[0].steerAttempted).toBe(false);
      expect(stillPending.items).toHaveLength(1);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("supervisor does not let one blocked item starve newer pending items", async () => {
    const { root, commsDir, stateDir } = makeRoot();
    const promotedSubjects: string[] = [];
    const promoter: CodexAppServerPromoter = {
      async promote(request) {
        const subject = request.text.match(/^Subject: (.+)$/m)?.[1] ?? "";
        promotedSubjects.push(subject);
        if (subject === "old-blocked") {
          return {
            delivered: false,
            turnId: null,
            threadId: "thread-active",
            runtimeHealth: "active-turn",
            blockedReason: "active-turn: thread already busy",
          };
        }
        return {
          delivered: true,
          turnId: "turn-newer",
          threadId: "thread-idle",
          runtimeHealth: "idle",
          blockedReason: null,
        };
      },
    };
    try {
      writeInbox(
        commsDir,
        "20260602-yoon-jun-001-old-blocked.md",
        "From: 윤\nTo: 준\nSubject: old-blocked\nMessage-Id: old-blocked\n\nbusy first",
        new Date("2026-06-02T00:10:01.000Z"),
      );
      writeInbox(
        commsDir,
        "20260602-yoon-jun-002-newer-ready.md",
        "From: 윤\nTo: 준\nSubject: newer-ready\nMessage-Id: newer-ready\n\nplease deliver",
        new Date("2026-06-02T00:10:02.000Z"),
      );

      const result = await runSupervisedReceiverPromotion({
        mode: "once",
        commsDir,
        stateDir,
        agent: "준",
        since: "2026-06-02T00:10:00.000Z",
        appServerUrl: "ws://127.0.0.1:4510",
        cwd: root,
        promoter,
      });
      const stillPending = await runPollingReceiver({
        mode: "check",
        commsDir,
        stateDir,
        agent: "준",
        since: "2026-06-02T00:10:00.000Z",
      });

      expect(result.status).toBe("delivered");
      expect(result.delivered).toBe(1);
      expect(result.blocked).toBe(1);
      expect(result.queued).toBe(1);
      expect(result.attempts).toHaveLength(2);
      expect(promotedSubjects).toEqual(["old-blocked", "newer-ready"]);
      expect(result.attempts[0].stateWritten).toBe(false);
      expect(result.attempts[0].queued).toBe(true);
      expect(result.attempts[0].steerAttempted).toBe(false);
      expect(result.attempts[1].stateWritten).toBe(true);
      expect(stillPending.items.map((item) => item.subject)).toEqual([
        "old-blocked",
      ]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("supervisor watch retries active-turn blocks until the app-server becomes idle", async () => {
    const { root, commsDir, stateDir } = makeRoot();
    let calls = 0;
    const promoter: CodexAppServerPromoter = {
      async promote() {
        calls += 1;
        if (calls === 1) {
          return {
            delivered: false,
            turnId: null,
            threadId: "thread-active",
            runtimeHealth: "active-turn",
            blockedReason: "active-turn: thread already busy",
          };
        }
        return {
          delivered: true,
          turnId: "turn-after-idle",
          threadId: "thread-active",
          runtimeHealth: "idle",
          blockedReason: null,
        };
      },
    };
    try {
      writeInbox(
        commsDir,
        "20260602-yoon-jun-supervised-retry-active.md",
        "From: 윤\nTo: 준\nSubject: supervised-retry-active\n\nretry me",
        new Date("2026-06-02T00:10:01.000Z"),
      );

      const result = await runSupervisedReceiverPromotion({
        mode: "watch",
        commsDir,
        stateDir,
        agent: "준",
        since: "2026-06-02T00:10:00.000Z",
        appServerUrl: "ws://127.0.0.1:4510",
        cwd: root,
        intervalMs: 100,
        maxIterations: 3,
        promoter,
      });
      const duplicate = await runPollingReceiver({
        mode: "check",
        commsDir,
        stateDir,
        agent: "준",
        since: "2026-06-02T00:10:00.000Z",
      });

      expect(result.status).toBe("delivered");
      expect(result.delivered).toBe(1);
      expect(result.blocked).toBe(1);
      expect(result.queued).toBe(1);
      expect(result.iterations).toBe(2);
      expect(result.attempts).toHaveLength(2);
      expect(result.attempts[0].stateWritten).toBe(false);
      expect(result.attempts[0].queued).toBe(true);
      expect(result.attempts[0].steerAttempted).toBe(false);
      expect(result.attempts[1].stateWritten).toBe(true);
      expect(duplicate.items).toHaveLength(0);
      expect(calls).toBe(2);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("supervisor watch leaves active-turn items pending when retry budget expires", async () => {
    const { root, commsDir, stateDir } = makeRoot();
    let calls = 0;
    const promoter: CodexAppServerPromoter = {
      async promote() {
        calls += 1;
        return {
          delivered: false,
          turnId: null,
          threadId: "thread-active",
          runtimeHealth: "active-turn",
          blockedReason: "active-turn: thread already busy",
        };
      },
    };
    try {
      writeInbox(
        commsDir,
        "20260602-yoon-jun-supervised-retry-budget.md",
        "From: 윤\nTo: 준\nSubject: supervised-retry-budget\n\nstill busy",
        new Date("2026-06-02T00:10:01.000Z"),
      );

      const result = await runSupervisedReceiverPromotion({
        mode: "watch",
        commsDir,
        stateDir,
        agent: "준",
        since: "2026-06-02T00:10:00.000Z",
        appServerUrl: "ws://127.0.0.1:4510",
        cwd: root,
        intervalMs: 100,
        maxIterations: 2,
        promoter,
      });
      const stillPending = await runPollingReceiver({
        mode: "check",
        commsDir,
        stateDir,
        agent: "준",
        since: "2026-06-02T00:10:00.000Z",
      });

      expect(result.status).toBe("blocked");
      expect(result.delivered).toBe(0);
      expect(result.blocked).toBe(2);
      expect(result.queued).toBe(2);
      expect(result.iterations).toBe(2);
      expect(result.attempts.every((attempt) => !attempt.stateWritten)).toBe(
        true,
      );
      expect(result.attempts.every((attempt) => attempt.queued)).toBe(true);
      expect(result.attempts.every((attempt) => !attempt.steerAttempted)).toBe(
        true,
      );
      expect(stillPending.items).toHaveLength(1);
      expect(calls).toBe(2);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("supervisor watch detects a new inbox item without manual receiver check", async () => {
    const { root, commsDir, stateDir } = makeRoot();
    const promoter: CodexAppServerPromoter = {
      async promote() {
        return {
          delivered: true,
          turnId: "turn-watch",
          threadId: "thread-watch",
          runtimeHealth: "idle",
          blockedReason: null,
        };
      },
    };
    try {
      const watch = runSupervisedReceiverPromotion({
        mode: "watch",
        commsDir,
        stateDir,
        agent: "준",
        since: "2026-06-02T00:10:00.000Z",
        appServerUrl: "ws://127.0.0.1:4510",
        cwd: root,
        intervalMs: 100,
        promoter,
      });

      setTimeout(() => {
        writeInbox(
          commsDir,
          "20260602-yoon-jun-supervised-watch.md",
          "From: 윤\nTo: 준\nSubject: supervised-watch\n\nnew message",
          new Date("2026-06-02T00:10:01.000Z"),
        );
      }, 20);

      const result = await watch;
      expect(result.status).toBe("delivered");
      expect(result.delivered).toBe(1);
      expect(result.iterations).toBeGreaterThanOrEqual(1);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("exposes a supervise command dry-run result", async () => {
    const { root, commsDir } = makeRoot();
    const originalCwd = process.cwd();
    try {
      fs.writeFileSync(path.join(root, "package.json"), "{}", "utf8");
      process.chdir(root);
      writeInbox(
        commsDir,
        "20260602-yoon-jun-supervise-command.md",
        "From: 윤\nTo: 준\nSubject: supervise-command\n\ncommand body",
        new Date("2026-06-02T00:10:01.000Z"),
      );

      const result = await receiverCommand([
        "supervise",
        "--agent",
        "준",
        "--comms-dir",
        commsDir,
        "--since",
        "2026-06-02T00:10:00.000Z",
        "--app-server-url",
        "ws://127.0.0.1:4510",
        "--dry-run",
      ]);

      expect(result.ok).toBe(true);
      expect(result.code).toBe("TAP_RECEIVER_OK");
      expect(result.data).toMatchObject({
        adapter: "supervised-app-server-promotion",
        runtimeSurface: "codex-cli-app-server",
        status: "dry-run",
        delivered: 0,
      });
    } finally {
      process.chdir(originalCwd);
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("deduplicates repeated receiver command aliases", async () => {
    const { root, commsDir } = makeRoot();
    const originalCwd = process.cwd();
    try {
      fs.writeFileSync(path.join(root, "package.json"), "{}", "utf8");
      process.chdir(root);

      const result = await receiverCommand([
        "supervise",
        "--agent",
        "윤",
        "--alias",
        "codex",
        "--alias",
        "codex",
        "--comms-dir",
        commsDir,
        "--app-server-url",
        "ws://127.0.0.1:4510",
        "--dry-run",
      ]);

      expect(result.ok).toBe(true);
      expect((result.data as { aliases: string[] }).aliases).toEqual([
        "윤",
        "codex",
      ]);
    } finally {
      process.chdir(originalCwd);
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
