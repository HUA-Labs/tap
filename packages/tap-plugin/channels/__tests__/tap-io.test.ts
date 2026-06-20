import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { TEST_DIR, resetTestDir, setTestEnv } from "./test-helpers.ts";

setTestEnv();

const {
  INBOX_DIR,
  REVIEWS_DIR,
  RECEIPTS_DIR,
  RECEIPTS_PATH,
  HEARTBEATS_PATH,
  setAgentName,
  setObservedMcpClientName,
} = await import("../tap-utils.ts");
const {
  startupFiles,
  readFiles,
  readFileContentHashes,
  seedStartupFiles,
  getUnreadItems,
  acquireLock,
  releaseLock,
  saveReceipts,
  loadReceipts,
  saveHeartbeats,
  loadHeartbeats,
  getDurableReceiptKeys,
  hasDisplayedNotification,
  markDisplayedNotification,
} = await import("../tap-io.ts");

beforeEach(() => {
  resetTestDir();
  startupFiles.clear();
  readFiles.clear();
  readFileContentHashes.clear();
  setAgentName("담");
  mkdirSync(INBOX_DIR, { recursive: true });
  mkdirSync(join(REVIEWS_DIR, "gen13"), { recursive: true });
  mkdirSync(RECEIPTS_DIR, { recursive: true });
});

afterEach(() => {
  setObservedMcpClientName(null);
  startupFiles.clear();
  readFiles.clear();
  readFileContentHashes.clear();
  setAgentName("담");
  resetTestDir();
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

  it("delivers slot-addressed inbox items using frontmatter routing fields", () => {
    process.env.TAP_ROUTING_SLOT = "wt-1";
    writeFileSync(
      join(INBOX_DIR, "20260415-율-결-slot-route.md"),
      [
        "---",
        "type: inbox",
        "from: tower",
        "from_name: 율",
        "to: wt-1",
        "to_name: 결",
        "subject: slot-route",
        "---",
        "",
        "slot addressed message",
      ].join("\n"),
      "utf-8",
    );

    const items = getUnreadItems({
      sources: ["inbox"],
      markRead: false,
    });

    expect(items).toHaveLength(1);
    expect(items[0]?.from).toBe("율");
    expect(items[0]?.to).toBe("결");
    expect(items[0]?.display).toContain("Tap message for 결");
    expect(items[0]?.display).toContain("From: 율");
    expect(items[0]?.display).toContain("To: 결");
    expect(items[0]?.display).toContain("Subject: slot-route");
    expect(items[0]?.display).toContain("Message:");
    expect(items[0]?.display).toContain("slot addressed message");
    expect(items[0]?.display).toContain("Reply available: tower");
    expect(items[0]?.display).not.toContain("Tap-comms inbox message");
    expect(items[0]?.display).not.toContain("Use tap_reply");

    delete process.env.TAP_ROUTING_SLOT;
  });

  it("keeps unread missing-route display fail-closed", () => {
    writeFileSync(
      join(INBOX_DIR, "20260415-unknown-담-missing-route.md"),
      [
        "---",
        "type: inbox",
        "from: unknown",
        "to: 담",
        "subject: missing-route",
        'from_address: {"routingAddress":"unknown"}',
        "---",
        "",
        "missing route body",
      ].join("\n"),
      "utf-8",
    );

    const items = getUnreadItems({
      sources: ["inbox"],
      markRead: false,
    });

    expect(items).toHaveLength(1);
    expect(items[0]?.display).toContain(
      "Reply unavailable: no verified return route.",
    );
    expect(items[0]?.display).toContain(
      "`unknown` is not a valid reply target.",
    );
    expect(items[0]?.display).not.toContain('Use tap_reply(to: "unknown"');
  });

  it("treats codex-addressed inbox items as current Codex MCP unread items", () => {
    setObservedMcpClientName("codex-mcp-client");
    writeFileSync(
      join(INBOX_DIR, "20260603-jun-codex-review.md"),
      [
        "---",
        "type: inbox",
        "from: 준",
        "to: codex",
        'from_address: {"routingAddress":"준"}',
        'to_address: {"routingAddress":"codex"}',
        "subject: review",
        "message_id: msg-codex-alias",
        "---",
        "",
        "codex addressed review",
      ].join("\n"),
      "utf-8",
    );

    const items = getUnreadItems({
      sources: ["inbox"],
      markRead: false,
    });

    expect(items).toHaveLength(1);
    expect(items[0]?.from).toBe("준");
    expect(items[0]?.to).toBe("codex");
    expect(items[0]?.subject).toBe("review");
  });

  it("does not read another agent's structured codex route via the broad codex alias", () => {
    setAgentName("윤");
    setObservedMcpClientName("codex-mcp-client");
    writeFileSync(
      join(INBOX_DIR, "20260616-jun-bom-review.md"),
      [
        "---",
        "type: inbox",
        "from: 준",
        "to: codex",
        "to_name: 봄",
        'to_address: {"routingAddress":"codex","aliases":["codex","봄"]}',
        "subject: review",
        "message_id: msg-bom-review",
        "---",
        "",
        "structured route for 봄",
      ].join("\n"),
      "utf-8",
    );

    expect(
      getUnreadItems({
        sources: ["inbox"],
        markRead: false,
      }),
    ).toHaveLength(0);

    setAgentName("봄");

    const items = getUnreadItems({
      sources: ["inbox"],
      markRead: false,
    });

    expect(items).toHaveLength(1);
    expect(items[0]?.to).toBe("봄");
  });

  it("collapses stale review-meta while keeping review requests and new outcomes visible", () => {
    setAgentName("봄");
    writeRegisteredReview(1572);
    const staleRequest = join(
      INBOX_DIR,
      "20260616-yoon-bom-review-request-pr1572.md",
    );
    writeFileSync(
      staleRequest,
      [
        "---",
        "type: inbox",
        "from: 윤",
        "to: 봄",
        "subject: review-request-pr1572",
        "message_id: msg-stale-request",
        "---",
        "",
        "Please review PR #1572. Prior clean result: P1/P2/P3: none.",
      ].join("\n"),
      "utf-8",
    );
    writeFileSync(
      join(INBOX_DIR, "20260616-yoon-bom-status-correction-pr1572.md"),
      [
        "---",
        "type: inbox",
        "from: 윤",
        "to: 봄",
        "subject: status-correction-pr1572",
        "message_id: msg-status-correction",
        "---",
        "",
        "This status correction is stale after merge evidence.",
      ].join("\n"),
      "utf-8",
    );
    writeFileSync(
      join(INBOX_DIR, "20260616-yoon-cc-review-request-pr1572.md"),
      [
        "---",
        "type: inbox",
        "from: 윤",
        "to: 봄",
        "subject: review-request-pr1572",
        "message_id: msg-stale-request-cc",
        "---",
        "",
        "CC replay of the same stale request.",
      ].join("\n"),
      "utf-8",
    );
    writeFileSync(
      join(INBOX_DIR, "20260616-unknown-bom-pr1572-status-correction.md"),
      [
        "---",
        "type: inbox",
        "from: unknown",
        "to: 봄",
        "subject: pr1572-status-correction",
        "message_id: msg-corrected-replay",
        "---",
        "",
        "Corrected replay should also collapse once terminal evidence exists.",
      ].join("\n"),
      "utf-8",
    );
    writeFileSync(
      join(
        INBOX_DIR,
        "20260616-jun-bom-pr1572-r2-current-head-review-already-complete.md",
      ),
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
      "utf-8",
    );
    writeFileSync(
      join(INBOX_DIR, "20260616-jun-bom-r3-review-pr1572-clean.md"),
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
    writeFileSync(
      join(INBOX_DIR, "20260616-jun-bom-review-pr1572-findings.md"),
      [
        "---",
        "type: inbox",
        "from: 준",
        "to: 봄",
        "subject: review-pr1572-findings",
        "message_id: msg-new-findings",
        "---",
        "",
        "Findings:\n\nP2 `file.ts:1` - real issue.",
      ].join("\n"),
      "utf-8",
    );
    writeFileSync(
      join(INBOX_DIR, "20260616-yoon-bom-review-request-pr2000.md"),
      [
        "---",
        "type: inbox",
        "from: 윤",
        "to: 봄",
        "subject: review-request-pr2000",
        "message_id: msg-ambiguous-request",
        "---",
        "",
        "No terminal evidence exists for this PR yet.",
      ].join("\n"),
      "utf-8",
    );

    const items = getUnreadItems({
      sources: ["inbox"],
      markRead: false,
    });

    expect(items.map((item) => item.subject).sort()).toEqual([
      "r3-review-pr1572-clean",
      "review-pr1572-findings",
      "review-request-pr1572",
      "review-request-pr1572",
      "review-request-pr2000",
    ]);
    expect(existsSync(staleRequest)).toBe(true);
  });

  it("does not suppress files just because they existed at startup", () => {
    writeFileSync(
      join(INBOX_DIR, "20260325-돌-담-existing.md"),
      "existing",
      "utf-8",
    );

    seedStartupFiles("inbox");

    const items = getUnreadItems({
      sources: ["inbox"],
      markRead: false,
    });

    expect(items).toHaveLength(1);
    expect(items[0]?.subject).toBe("existing");
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

  it("re-surfaces a previously read file after its mtime advances", () => {
    const filepath = join(INBOX_DIR, "20260325-돌-담-reread.md");
    writeFileSync(filepath, "first body", "utf-8");

    const first = getUnreadItems({ sources: ["inbox"] });
    const second = getUnreadItems({ sources: ["inbox"] });

    writeFileSync(filepath, "second body", "utf-8");
    const bumpedTime = new Date(statSync(filepath).mtimeMs + 2_000);
    utimesSync(filepath, bumpedTime, bumpedTime);

    const third = getUnreadItems({ sources: ["inbox"] });

    expect(first).toHaveLength(1);
    expect(second).toEqual([]);
    expect(third).toHaveLength(1);
    expect(third[0]?.subject).toBe("reread");
    expect(third[0]?.content).toBe("second body");
  });

  it("does not re-surface a previously read file when only mtime advances", () => {
    const filepath = join(INBOX_DIR, "20260325-돌-담-retouched.md");
    writeFileSync(
      filepath,
      [
        "---",
        "type: inbox",
        "from: 돌",
        "to: 담",
        "subject: retouched",
        "message_id: msg-retouched-1",
        "---",
        "",
        "stable body",
      ].join("\n"),
      "utf-8",
    );

    const first = getUnreadItems({ sources: ["inbox"] });
    const second = getUnreadItems({ sources: ["inbox"] });

    const bumpedTime = new Date(statSync(filepath).mtimeMs + 2_000);
    utimesSync(filepath, bumpedTime, bumpedTime);

    const third = getUnreadItems({ sources: ["inbox"] });

    expect(first).toHaveLength(1);
    expect(second).toEqual([]);
    expect(third).toEqual([]);
  });

  it("suppresses files with a durable read receipt for the current agent", () => {
    const filename = "20260325-돌-담-receipt.md";
    const content = [
      "---",
      "type: inbox",
      "from: 돌",
      "to: 담",
      "subject: receipt",
      "message_id: msg-receipt-1",
      "---",
      "",
      "read elsewhere",
    ].join("\n");
    writeFileSync(join(INBOX_DIR, filename), content, "utf-8");
    saveReceipts({
      [getDurableReceiptKeys(filename, content)[0]!]: [
        { reader: "codex_1", timestamp: "2026-03-25T03:00:00.000Z" },
      ],
    });

    const items = getUnreadItems({
      sources: ["inbox"],
      markRead: false,
    });

    expect(items).toEqual([]);
  });

  it("does not let a stale legacy filename receipt hide a rewritten message", () => {
    const filename = "20260325-돌-담-status.md";
    writeFileSync(join(INBOX_DIR, filename), "fresh body", "utf-8");
    saveReceipts({
      [filename]: [
        { reader: "codex_1", timestamp: "2026-03-25T03:00:00.000Z" },
      ],
    });

    const items = getUnreadItems({
      sources: ["inbox"],
      markRead: false,
    });

    expect(items).toHaveLength(1);
    expect(items[0]?.subject).toBe("status");
  });

  it("keeps the joinedAt boundary while resurfacing post-join backlog", () => {
    writeFileSync(
      HEARTBEATS_PATH,
      JSON.stringify(
        {
          codex_1: {
            agent: "담",
            joinedAt: "2026-03-25T03:00:00.000Z",
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
    writeFileSync(
      join(INBOX_DIR, "20260325-돌-담-post-join.md"),
      "visible backlog",
      "utf-8",
    );

    const items = getUnreadItems({
      sources: ["inbox"],
      since: "2026-03-25T02:00:00.000Z",
      markRead: false,
    });

    expect(items).toHaveLength(1);
    expect(items[0]?.subject).toBe("post-join");
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

  it("persists displayed notification markers independently per receiver", () => {
    for (let index = 1; index <= 40; index += 1) {
      setAgentName(`agent-${index}`);
      markDisplayedNotification("inbox", "broadcast.md", "body");
    }

    const markerDir = join(TEST_DIR, "displayed-notifications", "markers");
    const markers = readdirSync(markerDir).filter((entry) =>
      entry.endsWith(".json"),
    );

    expect(markers).toHaveLength(40);
    setAgentName("agent-3");
    expect(hasDisplayedNotification("inbox", "broadcast.md", "body")).toBe(
      true,
    );
    setAgentName("agent-41");
    expect(hasDisplayedNotification("inbox", "broadcast.md", "body")).toBe(
      false,
    );
  });

  // M352 drift #4 regression: presence files written on another device with
  // a different case/dash convention should merge onto the same heartbeat
  // slot — otherwise tap_who silently shows two zombie entries and cross-
  // device DM to either surface fails.
  it("merges presence files with case/dash drift onto a canonical heartbeat key", async () => {
    const { PRESENCE_DIR } = await import("../tap-utils.ts");
    const presenceTs = new Date().toISOString();
    const sharedHeartbeat = (id: string, agent: string) => ({
      id,
      agent,
      status: "active" as const,
      timestamp: presenceTs,
      lastActivity: presenceTs,
    });

    // Local heartbeats.json is empty — cross-device presence is the only source.
    saveHeartbeats({});

    mkdirSync(PRESENCE_DIR, { recursive: true });
    // Device A wrote with dash separator + uppercase segment.
    writeFileSync(
      join(PRESENCE_DIR, "Codex-Reviewer.json"),
      JSON.stringify(sharedHeartbeat("Codex-Reviewer", "결")),
      "utf-8",
    );
    // Device B wrote the same logical agent with underscore + lowercase.
    writeFileSync(
      join(PRESENCE_DIR, "codex_reviewer.json"),
      JSON.stringify({
        ...sharedHeartbeat("codex_reviewer", "결"),
        timestamp: new Date(Date.now() - 60_000).toISOString(),
        lastActivity: new Date(Date.now() - 60_000).toISOString(),
      }),
      "utf-8",
    );

    const merged = loadHeartbeats();
    const keys = Object.keys(merged);
    expect(keys).toHaveLength(1);
    expect(keys[0]).toBe("codex_reviewer");
    // Latest-timestamp wins (Codex-Reviewer was written more recently here).
    expect(merged["codex_reviewer"].id).toBe("Codex-Reviewer");
  });

  // M352 codex review r1: legacy heartbeats.json keys must also canonicalize.
  // Without this, a pre-existing `Codex-Reviewer` entry on disk stayed as its
  // own slot alongside the new canonical presence entry, defeating the merge.
  it("canonicalizes pre-existing heartbeats.json keys and merges them with presence files", async () => {
    const { PRESENCE_DIR } = await import("../tap-utils.ts");
    const recent = new Date().toISOString();
    const older = new Date(Date.now() - 60_000).toISOString();

    // Legacy heartbeats.json on disk: mixed-case dash form, older timestamp.
    saveHeartbeats({
      "Codex-Reviewer": {
        id: "Codex-Reviewer",
        agent: "결",
        status: "active",
        timestamp: older,
        lastActivity: older,
      },
    });

    // Presence file from a different device: canonical form, newer timestamp.
    mkdirSync(PRESENCE_DIR, { recursive: true });
    writeFileSync(
      join(PRESENCE_DIR, "codex_reviewer.json"),
      JSON.stringify({
        id: "codex_reviewer",
        agent: "결",
        status: "active",
        timestamp: recent,
        lastActivity: recent,
      }),
      "utf-8",
    );

    const merged = loadHeartbeats();
    const keys = Object.keys(merged);
    expect(keys).toHaveLength(1);
    expect(keys[0]).toBe("codex_reviewer");
    // Presence file is newer → its id wins.
    expect(merged["codex_reviewer"].id).toBe("codex_reviewer");
  });

  it("canonicalizes pre-existing heartbeats.json keys even without a presence file", () => {
    // No presence dir at all — a lone legacy entry should still surface under
    // the canonical key so lookups that pass `agentId` in canonical form hit.
    saveHeartbeats({
      "Codex-Reviewer": {
        id: "Codex-Reviewer",
        agent: "결",
        status: "active",
        timestamp: new Date().toISOString(),
        lastActivity: new Date().toISOString(),
      },
    });

    const merged = loadHeartbeats();
    expect(Object.keys(merged)).toEqual(["codex_reviewer"]);
  });
});
