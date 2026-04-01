/**
 * Headless regression pack — contracts that must never break.
 *
 * Coverage scope:
 * - Termination engine: empty output guard, quality-threshold correctness
 * - Review helpers: recipient isolation, processed markers, receipt routing, filename parsing
 * - Bridge prompt: tool instruction presence + raw sender routing (via buildUserInput behavior)
 * - Loop bootstrap: createHeadlessLoop interface, initial state, headless-state.json write
 *
 * NOT covered here (requires checkActiveSession refactor or integration test):
 * - Session/round timeout ordering (output-before-timeout)
 * - Timeout → session release lifecycle
 * These are documented in the design doc and covered by code review contract.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
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
} from "../engine/review.js";
import { createHeadlessLoop } from "../engine/headless-loop.js";
import { buildUserInput } from "../../scripts/codex-app-server-bridge.js";

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

// ── 3. Tool instruction contract (behavior test) ──────────────

describe("tool instruction contract", () => {
  it("buildUserInput output contains tap_reply instruction", () => {
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
    expect(output).toContain("tap_reply");
    expect(output).toContain("Do NOT respond with plain text only");
    expect(output).toContain("MUST use the tap_reply tool");
  });

  it("buildUserInput uses raw sender for tap_reply routing, not display label", () => {
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

    // tap_reply instruction must use raw sender "돌", not display "돌 [claude]"
    expect(output).toContain('tap_reply(to: "돌"');
    expect(output).not.toContain('tap_reply(to: "돌 [claude]"');
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

    const forMuk = scanInboxForReviews(commsDir, stateDir, "gen15", "묵");
    const forGyeol = scanInboxForReviews(commsDir, stateDir, "gen15", "결");

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

    const results = scanInboxForReviews(commsDir, stateDir, "gen15", "묵");
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
      sender: "돌",
      recipient: "묵",
      prNumber: 804,
      generation: "gen15",
      isReReview: false,
      round: 1,
    };

    expect(isAlreadyProcessed(stateDir, filePath)).toBe(false);
    markAsProcessed(stateDir, request);
    expect(isAlreadyProcessed(stateDir, filePath)).toBe(true);
  });

  it("unmarkProcessed removes marker", () => {
    const filePath = writeInboxFile(
      "20260326-돌-묵-review-request-pr805.md",
      "PR #805 리뷰요청",
    );
    const request: ReviewRequest = {
      sourcePath: filePath,
      sender: "돌",
      recipient: "묵",
      prNumber: 805,
      generation: "gen15",
      isReReview: false,
      round: 1,
    };

    markAsProcessed(stateDir, request);
    expect(isAlreadyProcessed(stateDir, filePath)).toBe(true);

    unmarkProcessed(stateDir, request);
    expect(isAlreadyProcessed(stateDir, filePath)).toBe(false);
  });

  it("scanInboxForReviews skips processed requests", () => {
    writeInboxFile(
      "20260326-돌-묵-review-request-pr806.md",
      "PR #806 리뷰요청",
    );

    const before = scanInboxForReviews(commsDir, stateDir, "gen15", "묵");
    expect(before).toHaveLength(1);

    markAsProcessed(stateDir, before[0]);

    const after = scanInboxForReviews(commsDir, stateDir, "gen15", "묵");
    expect(after).toHaveLength(0);
  });
});

// ── 6. Receipt routing ─────────────────────────────────────────

describe("receipt routing contract", () => {
  it("writeReviewReceipt includes requester in filename for correct routing", () => {
    const request: ReviewRequest = {
      sourcePath: path.join(inboxDir, "20260326-돌-묵-review-request-pr807.md"),
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
});
