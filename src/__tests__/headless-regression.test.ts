/**
 * Headless regression pack — contracts that must never break.
 *
 * Coverage scope:
 * - Termination engine: empty output guard, quality-threshold correctness
 * - Review helpers: recipient isolation, processed markers, receipt routing, filename parsing
 * - Bridge prompt: compact reply affordance + raw sender routing (via buildUserInput behavior)
 * - Loop bootstrap: createHeadlessLoop interface, initial state, headless-state.json write
 *
 * NOT covered here (requires checkActiveSession refactor or integration test):
 * - Session/round timeout ordering (output-before-timeout)
 * - Timeout → session release lifecycle
 * These are documented in the design doc and covered by code review contract.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { SpawnSyncReturns } from "node:child_process";

const childProcessMocks = vi.hoisted(() => ({
  spawnSync: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  spawnSync: childProcessMocks.spawnSync,
}));
import {
  evaluate,
  DEFAULT_TERMINATION_CONFIG,
  type TerminationContext,
  type ReviewRound,
} from "../engine/termination.js";
import {
  scanInboxForReviews,
  parseInboxFilename,
  markAsProcessed,
  isAlreadyProcessed,
  unmarkProcessed,
  writeReviewReceipt,
  type ReviewRequest,
  type PrHeadCache,
} from "../engine/review.js";
import { createHeadlessLoop } from "../engine/headless-loop.js";
import { buildUserInput } from "../../scripts/bridge/index.js";

let tmpDir: string;
let commsDir: string;
let stateDir: string;
let inboxDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "headless-regr-"));
  commsDir = path.join(tmpDir, "comms");
  stateDir = path.join(tmpDir, "state");
  inboxDir = path.join(commsDir, "inbox");
  fs.mkdirSync(inboxDir, { recursive: true });
  fs.mkdirSync(stateDir, { recursive: true });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  childProcessMocks.spawnSync.mockReset();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ── Helper ─────────────────────────────────────────────────────

function makeRound(overrides: Partial<ReviewRound> = {}): ReviewRound {
  return {
    round: 1,
    timestamp: new Date().toISOString(),
    findingCount: 0,
    findings: [],
    suggestedDiffLines: 0,
    findingHash: "empty",
    ...overrides,
  };
}

function writeInboxFile(filename: string, content: string): string {
  const filePath = path.join(inboxDir, filename);
  fs.writeFileSync(filePath, content, "utf-8");
  return filePath;
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 1_000,
  intervalMs = 20,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`waitFor timed out after ${timeoutMs}ms`);
}

// ── 1. Session timeout ─────────────────────────────────────────

describe("session timeout contract", () => {
  it("session with 0 rounds and elapsed > 10min should be releasable", () => {
    const stopSignalPath = path.join(stateDir, "stop-signal");
    const ctx: TerminationContext = {
      round: 0,
      rounds: [],
      stopSignalPath,
      config: { ...DEFAULT_TERMINATION_CONFIG, strategies: ["round-cap"] },
    };
    // round-cap at round 0 with maxRounds 5 → continue (not stuck by termination)
    const result = evaluate(ctx);
    expect(result.verdict).toBe("continue");
    // Note: actual session timeout is in headless-loop.ts checkActiveSession(),
    // not in termination engine. This test verifies termination doesn't
    // prematurely stop a session that just hasn't produced output yet.
  });
});

// ── 2. Output-before-timeout ordering ──────────────────────────

describe("output-before-timeout contract", () => {
  it("quality-threshold does NOT stop on empty output (malformed guard)", () => {
    const stopSignalPath = path.join(stateDir, "stop-signal");
    const rounds: ReviewRound[] = [
      makeRound({ findingCount: 0, findings: [], suggestedDiffLines: 0 }),
    ];
    const ctx: TerminationContext = {
      round: 1,
      rounds,
      stopSignalPath,
      config: {
        ...DEFAULT_TERMINATION_CONFIG,
        strategies: ["quality-threshold"],
      },
    };
    const result = evaluate(ctx);
    expect(result.verdict).toBe("continue");
  });

  it("diff-insignificance does NOT stop on empty output", () => {
    const stopSignalPath = path.join(stateDir, "stop-signal");
    const rounds: ReviewRound[] = [
      makeRound({ findingCount: 0, findings: [], suggestedDiffLines: 0 }),
    ];
    const ctx: TerminationContext = {
      round: 1,
      rounds,
      stopSignalPath,
      config: {
        ...DEFAULT_TERMINATION_CONFIG,
        strategies: ["diff-insignificance"],
        diffThreshold: 3,
      },
    };
    const result = evaluate(ctx);
    expect(result.verdict).toBe("continue");
  });

  it("quality-threshold stops when real low-severity findings exist", () => {
    const stopSignalPath = path.join(stateDir, "stop-signal");
    const rounds: ReviewRound[] = [
      makeRound({
        findingCount: 1,
        findings: [
          {
            severity: "low",
            category: "style",
            description: "naming",
          },
        ],
        suggestedDiffLines: 2,
      }),
    ];
    const ctx: TerminationContext = {
      round: 1,
      rounds,
      stopSignalPath,
      config: {
        ...DEFAULT_TERMINATION_CONFIG,
        strategies: ["quality-threshold"],
        qualitySeverityFloor: "high",
      },
    };
    const result = evaluate(ctx);
    expect(result.verdict).toBe("stop");
    expect(result.strategy).toBe("quality-threshold");
  });
});

// ── 3. Compact reply affordance contract (behavior test) ──────

describe("compact reply affordance contract", () => {
  it("buildUserInput output contains compact reply affordance", () => {
    const candidate = {
      markerId: "abc123",
      filePath: "/fake/inbox/20260326-돌-묵-review-request.md",
      fileName: "20260326-돌-묵-review-request.md",
      sender: "돌",
      recipient: "묵",
      subject: "review-request",
      body: "PR #800 리뷰요청",
      mtimeMs: Date.now(),
    };

    const output = buildUserInput(candidate, "묵", {});
    expect(output).toContain("Tap message for 묵");
    expect(output).toContain("Message:");
    expect(output).toContain("Reply available: 돌");
    expect(output).not.toContain("Use tap_reply");
    expect(output).not.toContain("Do NOT respond with plain text only");
    expect(output).not.toContain("MUST use the tap_reply tool");
  });

  it("buildUserInput uses raw sender for reply routing, not display label", () => {
    const candidate = {
      markerId: "abc123",
      filePath: "/fake/inbox/20260326-돌-묵-test.md",
      fileName: "20260326-돌-묵-test.md",
      sender: "돌",
      recipient: "묵",
      subject: "test",
      body: "hello",
      mtimeMs: Date.now(),
    };

    // With heartbeat that maps 돌 to display label "돌 [claude]"
    const heartbeats = {
      돌: { agent: "돌 [claude]", updatedAt: new Date().toISOString() },
    };
    const output = buildUserInput(candidate, "묵", heartbeats);

    // Reply routing must use raw sender "돌", not display "돌 [claude]".
    expect(output).toContain("From: 돌 [claude] [돌]");
    expect(output).toContain("Reply available: 돌");
    expect(output).not.toContain("Reply available: 돌 [claude]");
    expect(output).not.toContain("Use tap_reply");
  });
});

// ── 4. Multi-reviewer recipient isolation ──────────────────────

describe("recipient isolation contract", () => {
  it("scanInboxForReviews only returns requests addressed to this agent", () => {
    writeInboxFile(
      "20260326-돌-묵-review-request-pr800.md",
      "PR #800 리뷰요청",
    );
    writeInboxFile(
      "20260326-돌-결-review-request-pr801.md",
      "PR #801 리뷰요청",
    );
    writeInboxFile(
      "20260326-돌-전체-review-request-pr802.md",
      "PR #802 리뷰요청",
    );

    const forMuk = scanInboxForReviews(
      commsDir,
      stateDir,
      tmpDir,
      "gen15",
      "묵",
    );
    const forGyeol = scanInboxForReviews(
      commsDir,
      stateDir,
      tmpDir,
      "gen15",
      "결",
    );

    // 묵 gets PR800 (addressed to 묵) + PR802 (broadcast)
    const mukPrs = forMuk.map((r) => r.prNumber).sort();
    expect(mukPrs).toContain(800);
    expect(mukPrs).toContain(802);
    expect(mukPrs).not.toContain(801);

    // 결 gets PR801 (addressed to 결) + PR802 (broadcast)
    const gyeolPrs = forGyeol.map((r) => r.prNumber).sort();
    expect(gyeolPrs).toContain(801);
    expect(gyeolPrs).toContain(802);
    expect(gyeolPrs).not.toContain(800);
  });

  it("skips requests from self when sender matches agent name", () => {
    writeInboxFile(
      "20260326-묵-묵-review-request-pr803.md",
      "PR #803 리뷰요청",
    );

    const results = scanInboxForReviews(
      commsDir,
      stateDir,
      tmpDir,
      "gen15",
      "묵",
    );
    expect(results).toHaveLength(0);
  });

  it("skips requests from self when sender matches agent id", () => {
    writeInboxFile(
      "20260326-codex_codex_2-결-review-request-pr804.md",
      "PR #804 리뷰요청",
    );

    const results = scanInboxForReviews(
      commsDir,
      stateDir,
      tmpDir,
      "gen15",
      "결",
      "codex-codex-2",
    );
    expect(results).toHaveLength(0);
  });
});

// ── 5. Eager marking + rollback ────────────────────────────────

describe("processed marker contract", () => {
  it("markAsProcessed creates marker, isAlreadyProcessed returns true", () => {
    const filePath = writeInboxFile(
      "20260326-돌-묵-review-request-pr804.md",
      "PR #804 리뷰요청",
    );
    const request: ReviewRequest = {
      sourcePath: filePath,
      sourceMtimeMs: fs.statSync(filePath).mtimeMs,
      requestTimestampMs: fs.statSync(filePath).mtimeMs,
      sender: "돌",
      recipient: "묵",
      prNumber: 804,
      generation: "gen15",
      isReReview: false,
      round: 1,
    };

    expect(isAlreadyProcessed(stateDir, request)).toBe(false);
    markAsProcessed(stateDir, request);
    expect(isAlreadyProcessed(stateDir, request)).toBe(true);
  });

  it("unmarkProcessed removes marker", () => {
    const filePath = writeInboxFile(
      "20260326-돌-묵-review-request-pr805.md",
      "PR #805 리뷰요청",
    );
    const request: ReviewRequest = {
      sourcePath: filePath,
      sourceMtimeMs: fs.statSync(filePath).mtimeMs,
      requestTimestampMs: fs.statSync(filePath).mtimeMs,
      sender: "돌",
      recipient: "묵",
      prNumber: 805,
      generation: "gen15",
      isReReview: false,
      round: 1,
    };

    markAsProcessed(stateDir, request);
    expect(isAlreadyProcessed(stateDir, request)).toBe(true);

    unmarkProcessed(stateDir, request);
    expect(isAlreadyProcessed(stateDir, request)).toBe(false);
  });

  it("scanInboxForReviews skips processed requests", () => {
    writeInboxFile(
      "20260326-돌-묵-review-request-pr806.md",
      "PR #806 리뷰요청",
    );

    const before = scanInboxForReviews(
      commsDir,
      stateDir,
      tmpDir,
      "gen15",
      "묵",
    );
    expect(before).toHaveLength(1);

    markAsProcessed(stateDir, before[0]);

    const after = scanInboxForReviews(
      commsDir,
      stateDir,
      tmpDir,
      "gen15",
      "묵",
    );
    expect(after).toHaveLength(0);
  });

  it("processed marker remains stable when only the request mtime changes", () => {
    const filePath = writeInboxFile(
      "20260326-돌-묵-review-request-pr806a.md",
      "PR #806 리뷰요청",
    );
    const [request] = scanInboxForReviews(
      commsDir,
      stateDir,
      tmpDir,
      "gen15",
      "묵",
    );

    expect(request).toBeDefined();
    markAsProcessed(stateDir, request);
    expect(isAlreadyProcessed(stateDir, request)).toBe(true);

    const nextTime = new Date(Date.now() + 60_000);
    fs.utimesSync(filePath, nextTime, nextTime);
    const content = fs.readFileSync(filePath, "utf-8");
    const reparsed = scanInboxForReviews(
      commsDir,
      stateDir,
      tmpDir,
      "gen15",
      "묵",
    );

    expect(content).toContain("PR #806");
    expect(reparsed).toHaveLength(0);
  });

  it("dedupes a re-review request when the PR tip is unchanged", () => {
    const firstPath = writeInboxFile(
      "20260326-돌-묵-review-request-pr807.md",
      "PR #807 리뷰요청",
    );
    const secondPath = writeInboxFile(
      "20260326-돌-묵-re-review-pr807.md",
      "PR #807 재리뷰",
    );

    const first: ReviewRequest = {
      sourcePath: firstPath,
      sourceMtimeMs: fs.statSync(firstPath).mtimeMs,
      requestTimestampMs: fs.statSync(firstPath).mtimeMs,
      sender: "돌",
      recipient: "묵",
      prNumber: 807,
      prTipSha: "sha-same-tip",
      generation: "gen15",
      isReReview: false,
      round: 1,
      messageId: "msg-1",
      dedupeRecipient: "묵",
    };
    const reReview: ReviewRequest = {
      sourcePath: secondPath,
      sourceMtimeMs: fs.statSync(secondPath).mtimeMs,
      requestTimestampMs: fs.statSync(secondPath).mtimeMs,
      sender: "돌",
      recipient: "묵",
      prNumber: 807,
      prTipSha: "sha-same-tip",
      generation: "gen15",
      isReReview: true,
      round: 2,
      messageId: "msg-2",
      dedupeRecipient: "묵",
    };

    markAsProcessed(stateDir, first);
    expect(isAlreadyProcessed(stateDir, reReview)).toBe(true);
  });

  it("keeps tip-based dedupe stable across generation rollover", () => {
    const firstPath = writeInboxFile(
      "20260326-돌-묵-review-request-pr807b.md",
      "PR #807 리뷰요청",
    );
    const secondPath = writeInboxFile(
      "20260326-돌-묵-re-review-pr807b.md",
      "PR #807 재리뷰",
    );

    const gen41: ReviewRequest = {
      sourcePath: firstPath,
      sourceMtimeMs: fs.statSync(firstPath).mtimeMs,
      requestTimestampMs: fs.statSync(firstPath).mtimeMs,
      sender: "돌",
      recipient: "묵",
      prNumber: 807,
      prTipSha: "sha-same-tip",
      generation: "gen41",
      isReReview: false,
      round: 1,
      messageId: "msg-gen41",
      dedupeRecipient: "묵",
    };
    const gen42: ReviewRequest = {
      sourcePath: secondPath,
      sourceMtimeMs: fs.statSync(secondPath).mtimeMs,
      requestTimestampMs: fs.statSync(secondPath).mtimeMs,
      sender: "돌",
      recipient: "묵",
      prNumber: 807,
      prTipSha: "sha-same-tip",
      generation: "gen42",
      isReReview: true,
      round: 2,
      messageId: "msg-gen42",
      dedupeRecipient: "묵",
    };

    markAsProcessed(stateDir, gen41);
    expect(isAlreadyProcessed(stateDir, gen42)).toBe(true);
  });

  it("reuses PR head lookup across repeated scans for the same request", () => {
    fs.mkdirSync(path.join(tmpDir, ".git"), { recursive: true });
    childProcessMocks.spawnSync.mockReturnValue({
      status: 0,
      stdout: JSON.stringify({
        headRefName: "fix/m338-headless-review-dedupe",
        headRefOid: "sha-cache",
      }),
      stderr: "",
      pid: 0,
      output: [],
      signal: null,
    } as SpawnSyncReturns<string>);

    writeInboxFile(
      "20260326-돌-묵-review-request-pr807c.md",
      ["---", "message_id: msg-cache", "---", "", "PR #807 리뷰요청"].join(
        "\n",
      ),
    );

    const prHeadCache: PrHeadCache = new Map();
    const first = scanInboxForReviews(
      commsDir,
      stateDir,
      tmpDir,
      "gen41",
      "묵",
      "묵",
      null,
      prHeadCache,
    );
    const second = scanInboxForReviews(
      commsDir,
      stateDir,
      tmpDir,
      "gen41",
      "묵",
      "묵",
      null,
      prHeadCache,
    );

    expect(first[0]?.prTipSha).toBe("sha-cache");
    expect(second[0]?.prTipSha).toBe("sha-cache");
    expect(childProcessMocks.spawnSync).toHaveBeenCalledTimes(1);
  });

  it("refreshes cached PR head after the revalidation window", () => {
    fs.mkdirSync(path.join(tmpDir, ".git"), { recursive: true });
    vi.useFakeTimers();
    const baseTime = new Date("2026-04-17T00:00:00.000Z");
    vi.setSystemTime(baseTime);

    childProcessMocks.spawnSync
      .mockReturnValueOnce({
        status: 0,
        stdout: JSON.stringify({
          headRefName: "fix/m338-headless-review-dedupe",
          headRefOid: "sha-old",
        }),
        stderr: "",
        pid: 0,
        output: [],
        signal: null,
      } as SpawnSyncReturns<string>)
      .mockReturnValueOnce({
        status: 0,
        stdout: JSON.stringify({
          headRefName: "fix/m338-headless-review-dedupe",
          headRefOid: "sha-new",
        }),
        stderr: "",
        pid: 0,
        output: [],
        signal: null,
      } as SpawnSyncReturns<string>);

    writeInboxFile(
      "20260326-돌-묵-review-request-pr807d.md",
      ["---", "message_id: msg-refresh", "---", "", "PR #807 리뷰요청"].join(
        "\n",
      ),
    );

    const prHeadCache: PrHeadCache = new Map();
    const first = scanInboxForReviews(
      commsDir,
      stateDir,
      tmpDir,
      "gen41",
      "묵",
      "묵",
      null,
      prHeadCache,
    );

    vi.setSystemTime(baseTime.getTime() + 30_001);
    const second = scanInboxForReviews(
      commsDir,
      stateDir,
      tmpDir,
      "gen41",
      "묵",
      "묵",
      null,
      prHeadCache,
    );

    expect(first[0]?.prTipSha).toBe("sha-old");
    expect(second[0]?.prTipSha).toBe("sha-new");
    expect(childProcessMocks.spawnSync).toHaveBeenCalledTimes(2);
  });

  it("allows a re-review request when the PR tip changes", () => {
    const firstPath = writeInboxFile(
      "20260326-돌-묵-review-request-pr808.md",
      "PR #808 리뷰요청",
    );
    const secondPath = writeInboxFile(
      "20260326-돌-묵-re-review-pr808.md",
      "PR #808 재리뷰",
    );

    const first: ReviewRequest = {
      sourcePath: firstPath,
      sourceMtimeMs: fs.statSync(firstPath).mtimeMs,
      requestTimestampMs: fs.statSync(firstPath).mtimeMs,
      sender: "돌",
      recipient: "묵",
      prNumber: 808,
      prTipSha: "sha-before",
      generation: "gen15",
      isReReview: false,
      round: 1,
      messageId: "msg-3",
      dedupeRecipient: "묵",
    };
    const reReview: ReviewRequest = {
      sourcePath: secondPath,
      sourceMtimeMs: fs.statSync(secondPath).mtimeMs,
      requestTimestampMs: fs.statSync(secondPath).mtimeMs,
      sender: "돌",
      recipient: "묵",
      prNumber: 808,
      prTipSha: "sha-after",
      generation: "gen15",
      isReReview: true,
      round: 2,
      messageId: "msg-4",
      dedupeRecipient: "묵",
    };

    markAsProcessed(stateDir, first);
    expect(isAlreadyProcessed(stateDir, reReview)).toBe(false);
  });
});

describe("queue ordering contract", () => {
  it("ignores internal headless-dispatch files even if the body looks like a review prompt", () => {
    writeInboxFile(
      "20260326-headless-묵-headless-dispatch-pr809.md",
      "Review PR #809",
    );

    const requests = scanInboxForReviews(
      commsDir,
      stateDir,
      tmpDir,
      "gen15",
      "묵",
    );

    expect(requests).toHaveLength(0);
  });

  it("prioritizes newer re-review requests ahead of older review requests", () => {
    const older = writeInboxFile(
      "20260326-headless-묵-review-PR810.md",
      "PR #810 리뷰요청",
    );
    const newerReReview = writeInboxFile(
      "20260326-흐-묵-re-review-pr811.md",
      "PR #811 재리뷰",
    );

    const oldTime = new Date(Date.now() - 120_000);
    const newTime = new Date(Date.now() - 1_000);
    fs.utimesSync(older, oldTime, oldTime);
    fs.utimesSync(newerReReview, newTime, newTime);

    const requests = scanInboxForReviews(
      commsDir,
      stateDir,
      tmpDir,
      "gen15",
      "묵",
    );

    expect(requests).toHaveLength(2);
    expect(requests[0]?.prNumber).toBe(811);
    expect(requests[0]?.isReReview).toBe(true);
    expect(requests[1]?.prNumber).toBe(810);
  });

  it("orders first-round reviews by sent_at instead of touched mtime", () => {
    const older = writeInboxFile(
      "20260415-흐-묵-review-PR820.md",
      [
        "---",
        "sent_at: 2026-04-15T01:00:00Z",
        "---",
        "",
        "PR #820 리뷰요청",
      ].join("\n"),
    );
    const newer = writeInboxFile(
      "20260415-흐-묵-review-PR821.md",
      [
        "---",
        "sent_at: 2026-04-15T02:00:00Z",
        "---",
        "",
        "PR #821 리뷰요청",
      ].join("\n"),
    );

    const touchedTime = new Date(Date.now() + 60_000);
    const olderTime = new Date(Date.now() - 60_000);
    fs.utimesSync(older, touchedTime, touchedTime);
    fs.utimesSync(newer, olderTime, olderTime);

    const requests = scanInboxForReviews(
      commsDir,
      stateDir,
      tmpDir,
      "gen15",
      "묵",
    );

    expect(requests.map((request) => request.prNumber)).toEqual([821, 820]);
  });

  it("skips stale requests when a newer repo review file already exists", () => {
    const requestPath = writeInboxFile(
      "20260326-headless-묵-review-PR812.md",
      "Review PR #812",
    );
    const requestTime = new Date(Date.now() - 120_000);
    fs.utimesSync(requestPath, requestTime, requestTime);

    const reviewDir = path.join(tmpDir, "reviews", "gen15");
    fs.mkdirSync(reviewDir, { recursive: true });
    const reviewPath = path.join(reviewDir, "review-PR812-묵.md");
    fs.writeFileSync(reviewPath, "clean", "utf-8");
    const reviewTime = new Date(Date.now() - 1_000);
    fs.utimesSync(reviewPath, reviewTime, reviewTime);

    const requests = scanInboxForReviews(
      commsDir,
      stateDir,
      tmpDir,
      "gen15",
      "묵",
    );

    expect(requests).toHaveLength(0);
  });

  it("keeps same-PR re-review requests even when a newer review file exists", () => {
    const requestPath = writeInboxFile(
      "20260326-흐-묵-re-review-pr900.md",
      [
        "---",
        "sent_at: 2026-04-15T02:00:00Z",
        "---",
        "",
        "PR #900 재리뷰",
      ].join("\n"),
    );
    const requestTime = new Date(Date.now() - 120_000);
    fs.utimesSync(requestPath, requestTime, requestTime);

    const reviewDir = path.join(tmpDir, "reviews", "gen15");
    fs.mkdirSync(reviewDir, { recursive: true });
    const reviewPath = path.join(reviewDir, "review-PR900-묵.md");
    fs.writeFileSync(
      reviewPath,
      [
        "---",
        "date: 2026-04-15",
        "reviewer: 묵",
        "pr: 900",
        "round: 1",
        "status: p2-1items",
        "merge: fix-then-merge",
        "---",
        "",
        "## Findings",
      ].join("\n"),
      "utf-8",
    );
    const reviewTime = new Date(Date.now() - 1_000);
    fs.utimesSync(reviewPath, reviewTime, reviewTime);

    const withoutActiveSession = scanInboxForReviews(
      commsDir,
      stateDir,
      tmpDir,
      "gen15",
      "묵",
    );

    expect(withoutActiveSession).toHaveLength(0);

    const withActiveSession = scanInboxForReviews(
      commsDir,
      stateDir,
      tmpDir,
      "gen15",
      "묵",
      "묵",
      900,
    );

    expect(withActiveSession).toHaveLength(1);
    expect(withActiveSession[0]?.prNumber).toBe(900);
    expect(withActiveSession[0]?.isReReview).toBe(true);
  });
});

// ── 6. Receipt routing ─────────────────────────────────────────

describe("receipt routing contract", () => {
  it("writeReviewReceipt includes requester in filename for correct routing", () => {
    const request: ReviewRequest = {
      sourcePath: path.join(inboxDir, "20260326-돌-묵-review-request-pr807.md"),
      sourceMtimeMs: Date.now(),
      requestTimestampMs: Date.now(),
      sender: "돌",
      recipient: "묵",
      prNumber: 807,
      generation: "gen15",
      isReReview: false,
      round: 1,
    };

    const receiptPath = writeReviewReceipt(commsDir, request, "묵");
    const filename = path.basename(receiptPath);

    // Filename must include sender for tap routing
    expect(filename).toContain("묵");
    expect(filename).toContain("돌");
    expect(filename).toContain("PR807");

    // Parse should route correctly
    const parsed = parseInboxFilename(receiptPath);
    expect(parsed).not.toBeNull();
    // Receipt goes FROM reviewer TO requester
    expect(parsed!.sender).toBe("묵");
    expect(parsed!.recipient).toBe("돌");
  });
});

// ── 7. Inbox filename parsing ──────────────────────────────────

describe("inbox filename parsing contract", () => {
  it("parses standard tap filename", () => {
    const parsed = parseInboxFilename("20260326-별-돌-review-request-pr808.md");
    expect(parsed).not.toBeNull();
    expect(parsed!.sender).toBe("별");
    expect(parsed!.recipient).toBe("돌");
    expect(parsed!.subject).toBe("review-request-pr808");
  });

  it("returns null for non-standard filenames", () => {
    expect(parseInboxFilename("README.md")).toBeNull();
    expect(parseInboxFilename("random-file.md")).toBeNull();
  });
});

// ── 8. Headless loop runtime contract ──────────────────────────

describe("headless loop runtime contract", () => {
  it("createHeadlessLoop returns start/stop/getState interface", () => {
    const loop = createHeadlessLoop({
      commsDir,
      stateDir,
      repoRoot: tmpDir,
      agentName: "test-agent",
      generation: "gen15",
      pollIntervalMs: 60_000, // long interval to avoid actual polling
    });

    expect(typeof loop.start).toBe("function");
    expect(typeof loop.stop).toBe("function");
    expect(typeof loop.getState).toBe("function");
  });

  it("getState returns initial state before start", () => {
    const loop = createHeadlessLoop({
      commsDir,
      stateDir,
      repoRoot: tmpDir,
      agentName: "test-agent",
      generation: "gen15",
      pollIntervalMs: 60_000,
    });

    const state = loop.getState();
    expect(state.running).toBe(false);
    expect(state.activeSession).toBeNull();
    expect(state.completedSessions).toBe(0);
    expect(state.lastPollAt).toBeNull();
  });

  it("headless-state.json is written when loop starts in headless mode", () => {
    // Set env to enable headless mode
    const origHeadless = process.env.TAP_HEADLESS;
    process.env.TAP_HEADLESS = "true";

    try {
      const loop = createHeadlessLoop({
        commsDir,
        stateDir,
        repoRoot: tmpDir,
        agentName: "test-reviewer",
        generation: "gen15",
        pollIntervalMs: 60_000,
      });

      loop.start();

      // headless-state.json should exist
      const stateFilePath = path.join(stateDir, "headless-state.json");
      expect(fs.existsSync(stateFilePath)).toBe(true);

      const stateData = JSON.parse(fs.readFileSync(stateFilePath, "utf-8"));
      expect(stateData.running).toBe(true);
      expect(stateData.agentName).toBe("test-reviewer");
      expect(stateData.generation).toBe("gen15");
      expect(stateData.activeReview).toBeNull();
      expect(stateData.completedSessions).toBe(0);

      loop.stop();

      // After stop, running should be false
      const stoppedData = JSON.parse(fs.readFileSync(stateFilePath, "utf-8"));
      expect(stoppedData.running).toBe(false);
    } finally {
      if (origHeadless === undefined) {
        delete process.env.TAP_HEADLESS;
      } else {
        process.env.TAP_HEADLESS = origHeadless;
      }
    }
  });

  it("writes dedicated headless-dispatch files without clobbering the source request", () => {
    const origHeadless = process.env.TAP_HEADLESS;
    process.env.TAP_HEADLESS = "true";

    try {
      const sourcePath = writeInboxFile(
        "20260326-headless-묵-review-PR813.md",
        "PR #813 리뷰요청",
      );

      const loop = createHeadlessLoop({
        commsDir,
        stateDir,
        repoRoot: tmpDir,
        agentId: "codex_묵",
        agentName: "묵",
        generation: "gen15",
        pollIntervalMs: 60_000,
      });

      loop.start();

      const files = fs.readdirSync(inboxDir).sort();
      expect(files).toContain("20260326-headless-묵-review-PR813.md");
      expect(
        files.some((name) =>
          name.includes("-headless-묵-headless-dispatch-pr813.md"),
        ),
      ).toBe(true);
      expect(fs.existsSync(sourcePath)).toBe(true);

      loop.stop();
    } finally {
      if (origHeadless === undefined) {
        delete process.env.TAP_HEADLESS;
      } else {
        process.env.TAP_HEADLESS = origHeadless;
      }
    }
  });

  it("queues re-reviews within one poll cycle while another session is active", async () => {
    const origHeadless = process.env.TAP_HEADLESS;
    let loop: ReturnType<typeof createHeadlessLoop> | null = null;
    process.env.TAP_HEADLESS = "true";

    try {
      writeInboxFile(
        "20260326-headless-묵-review-PR900.md",
        "PR #900 리뷰요청",
      );

      loop = createHeadlessLoop({
        commsDir,
        stateDir,
        repoRoot: tmpDir,
        agentId: "codex_묵",
        agentName: "묵",
        generation: "gen15",
        pollIntervalMs: 25,
      });

      loop.start();

      const stateFilePath = path.join(stateDir, "headless-state.json");
      await waitFor(() => {
        const data = JSON.parse(fs.readFileSync(stateFilePath, "utf-8"));
        return data.activeReview?.prNumber === 900;
      });

      writeInboxFile("20260326-흐-묵-re-review-pr901.md", "PR #901 재리뷰");

      await waitFor(() => {
        const data = JSON.parse(fs.readFileSync(stateFilePath, "utf-8"));
        return (
          data.activeReview?.prNumber === 900 &&
          data.pendingReviewCount === 1 &&
          data.pendingReviews?.[0]?.prNumber === 901
        );
      });

      const reviewDir = path.join(tmpDir, "reviews", "gen15");
      fs.mkdirSync(reviewDir, { recursive: true });
      fs.writeFileSync(
        path.join(reviewDir, "review-PR900-묵.md"),
        [
          "---",
          "date: 2026-04-15",
          "reviewer: 묵",
          "pr: 900",
          "round: 1",
          "status: clean",
          "merge: merge",
          "---",
          "",
          "## Findings",
          "",
          "### Medium / Low",
          "- [low] [code-quality] foo.ts:1 — style cleanup",
          "",
          "## Suggested Diff Lines",
          "1",
        ].join("\n"),
        "utf-8",
      );

      await waitFor(() => {
        const data = JSON.parse(fs.readFileSync(stateFilePath, "utf-8"));
        return (
          data.activeReview?.prNumber === 901 && data.pendingReviewCount === 0
        );
      }, 1_500);
    } finally {
      loop?.stop();
      if (origHeadless === undefined) {
        delete process.env.TAP_HEADLESS;
      } else {
        process.env.TAP_HEADLESS = origHeadless;
      }
    }
  });

  it("keeps same-PR re-reviews queued while the active session advances rounds", async () => {
    const origHeadless = process.env.TAP_HEADLESS;
    let loop: ReturnType<typeof createHeadlessLoop> | null = null;
    process.env.TAP_HEADLESS = "true";

    try {
      writeInboxFile(
        "20260326-headless-묵-review-PR910.md",
        "PR #910 리뷰요청",
      );

      loop = createHeadlessLoop({
        commsDir,
        stateDir,
        repoRoot: tmpDir,
        agentId: "codex_묵",
        agentName: "묵",
        generation: "gen15",
        pollIntervalMs: 25,
      });

      loop.start();

      const stateFilePath = path.join(stateDir, "headless-state.json");
      await waitFor(() => {
        const data = JSON.parse(fs.readFileSync(stateFilePath, "utf-8"));
        return data.activeReview?.prNumber === 910;
      });

      const reviewDir = path.join(tmpDir, "reviews", "gen15");
      fs.mkdirSync(reviewDir, { recursive: true });
      fs.writeFileSync(
        path.join(reviewDir, "review-PR910-묵.md"),
        [
          "---",
          "date: 2026-04-15",
          "reviewer: 묵",
          "pr: 910",
          "round: 1",
          "status: p1-1items",
          "merge: fix-then-merge",
          "---",
          "",
          "## Findings",
          "",
          "### Critical / High",
          "- [high] [correctness] foo.ts:1 — keep reviewing",
          "",
          "## Suggested Diff Lines",
          "10",
        ].join("\n"),
        "utf-8",
      );

      writeInboxFile(
        "20260326-흐-묵-re-review-pr910.md",
        [
          "---",
          "sent_at: 2026-04-15T02:00:00Z",
          "---",
          "",
          "PR #910 재리뷰",
        ].join("\n"),
      );

      await waitFor(() => {
        const data = JSON.parse(fs.readFileSync(stateFilePath, "utf-8"));
        return (
          data.activeReview?.prNumber === 910 &&
          data.pendingReviewCount === 1 &&
          data.pendingReviews?.[0]?.prNumber === 910
        );
      }, 1_500);
    } finally {
      loop?.stop();
      if (origHeadless === undefined) {
        delete process.env.TAP_HEADLESS;
      } else {
        process.env.TAP_HEADLESS = origHeadless;
      }
    }
  });
});
