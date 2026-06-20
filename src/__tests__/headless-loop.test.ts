/**
 * headless-loop.test.ts — Tests for gaps identified in headless-regression.test.ts:
 * - Session timeout → session release lifecycle
 * - Round timeout → session completion
 * - Processed marker GC (7-day expiry)
 * - Fairness: re-review quota exhaustion → first-round priority
 * - Dispatch file cleanup on session completion
 *
 * M332: headless-loop test coverage.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  createHeadlessLoop,
  mergePendingRequests,
  sortRequests,
} from "../engine/headless-loop.js";
import type { ReviewRequest } from "../engine/review.js";

let tmpDir: string;
let commsDir: string;
let stateDir: string;
let inboxDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "headless-loop-"));
  commsDir = path.join(tmpDir, "comms");
  stateDir = path.join(tmpDir, "state");
  inboxDir = path.join(commsDir, "inbox");
  fs.mkdirSync(inboxDir, { recursive: true });
  fs.mkdirSync(stateDir, { recursive: true });
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeInboxFile(filename: string, content: string): string {
  const filePath = path.join(inboxDir, filename);
  fs.writeFileSync(filePath, content, "utf-8");
  return filePath;
}

function readStateFile(): Record<string, unknown> {
  const filePath = path.join(stateDir, "headless-state.json");
  if (!fs.existsSync(filePath)) return {};
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

function markFileNewerThanSession(filePath: string, startedAt: string): void {
  const newerThanSession = new Date(new Date(startedAt).getTime() + 1);
  fs.utimesSync(filePath, newerThanSession, newerThanSession);
}

// Use performance.now() for wall-clock timing — immune to Date.now mocks
async function waitFor(
  predicate: () => boolean,
  timeoutMs = 1_000,
  intervalMs = 20,
): Promise<void> {
  const start = performance.now();
  while (performance.now() - start < timeoutMs) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`waitFor timed out after ${timeoutMs}ms`);
}

function withHeadless<T>(fn: () => T): T {
  const orig = process.env.TAP_HEADLESS;
  process.env.TAP_HEADLESS = "true";
  try {
    return fn();
  } finally {
    if (orig === undefined) {
      delete process.env.TAP_HEADLESS;
    } else {
      process.env.TAP_HEADLESS = orig;
    }
  }
}

// ── 1. Processed marker GC ─────────────────────────────────────

describe("processed marker GC", () => {
  it("removes markers older than 7 days on loop start", () => {
    withHeadless(() => {
      // Create old processed markers
      const processedDir = path.join(stateDir, "processed");
      fs.mkdirSync(processedDir, { recursive: true });

      const oldMarker = path.join(processedDir, "old-request.done");
      const freshMarker = path.join(processedDir, "fresh-request.done");
      fs.writeFileSync(oldMarker, "", "utf-8");
      fs.writeFileSync(freshMarker, "", "utf-8");

      // Set old marker to 8 days ago
      const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
      fs.utimesSync(oldMarker, eightDaysAgo, eightDaysAgo);

      const loop = createHeadlessLoop({
        commsDir,
        stateDir,
        repoRoot: tmpDir,
        agentName: "test-gc",
        generation: "gen15",
        pollIntervalMs: 60_000,
      });

      loop.start();
      loop.stop();

      // Old marker should be removed, fresh marker kept
      expect(fs.existsSync(oldMarker)).toBe(false);
      expect(fs.existsSync(freshMarker)).toBe(true);
    });
  });

  it("does not remove markers younger than 7 days", () => {
    withHeadless(() => {
      const processedDir = path.join(stateDir, "processed");
      fs.mkdirSync(processedDir, { recursive: true });

      const recentMarker = path.join(processedDir, "recent-request.done");
      fs.writeFileSync(recentMarker, "", "utf-8");

      // Set to 6 days ago (within 7-day window)
      const sixDaysAgo = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000);
      fs.utimesSync(recentMarker, sixDaysAgo, sixDaysAgo);

      const loop = createHeadlessLoop({
        commsDir,
        stateDir,
        repoRoot: tmpDir,
        agentName: "test-gc",
        generation: "gen15",
        pollIntervalMs: 60_000,
      });

      loop.start();
      loop.stop();

      expect(fs.existsSync(recentMarker)).toBe(true);
    });
  });
});

// ── 2. Session timeout ──────────────────────────────────────────

describe("session timeout", () => {
  it("session with active review has non-null activeSession", () => {
    withHeadless(() => {
      writeInboxFile("20260326-돌-묵-review-PR999.md", "PR #999 리뷰요청");

      const loop = createHeadlessLoop({
        commsDir,
        stateDir,
        repoRoot: tmpDir,
        agentName: "묵",
        generation: "gen15",
        pollIntervalMs: 60_000,
      });

      loop.start();

      const state = loop.getState();
      expect(state.activeSession).not.toBeNull();
      expect(state.activeSession!.request.prNumber).toBe(999);

      const stateFile = readStateFile();
      expect(
        (stateFile.activeReview as Record<string, unknown>)?.prNumber,
      ).toBe(999);

      loop.stop();
    });
  });

  it("releases session after 10 minutes with no output via poll", async () => {
    await withHeadless(async () => {
      writeInboxFile("20260326-돌-묵-review-PR998.md", "PR #998 리뷰요청");

      // Use short poll interval so we can trigger timeout via Date.now mock
      const loop = createHeadlessLoop({
        commsDir,
        stateDir,
        repoRoot: tmpDir,
        agentName: "묵",
        generation: "gen15",
        pollIntervalMs: 25,
      });

      loop.start();

      // Wait for session to become active
      await waitFor(() => loop.getState().activeSession !== null);
      expect(loop.getState().activeSession!.request.prNumber).toBe(998);

      // Mock Date.now to jump 11 minutes into the future
      const realDateNow = Date.now;
      const elevenMinutesMs = 11 * 60 * 1000;
      const baseTime = realDateNow();
      Date.now = () => baseTime + elevenMinutesMs;

      try {
        // Wait for poll to fire and detect timeout
        await waitFor(() => {
          const state = loop.getState();
          return state.activeSession === null;
        }, 2_000);

        // Session should be released (timeout)
        expect(loop.getState().activeSession).toBeNull();

        // State file should reflect sessionTimeouts increment
        const stateFile = readStateFile();
        const metrics = stateFile.metrics as Record<string, unknown>;
        expect(metrics.sessionTimeouts).toBe(1);
      } finally {
        Date.now = realDateNow;
        loop.stop();
      }
    });
  });
});

// ── 3. Dispatch file cleanup ────────────────────────────────────

describe("dispatch file cleanup", () => {
  it("dispatch files are created during session start", () => {
    withHeadless(() => {
      writeInboxFile("20260326-돌-묵-review-PR850.md", "PR #850 리뷰요청");

      const loop = createHeadlessLoop({
        commsDir,
        stateDir,
        repoRoot: tmpDir,
        agentName: "묵",
        generation: "gen15",
        pollIntervalMs: 60_000,
      });

      loop.start();

      const files = fs.readdirSync(inboxDir);
      const dispatchFiles = files.filter((f) =>
        f.includes("headless-dispatch-pr850"),
      );
      expect(dispatchFiles.length).toBeGreaterThan(0);

      loop.stop();
    });
  });

  it("dispatch files are removed after session completes", async () => {
    await withHeadless(async () => {
      writeInboxFile("20260326-돌-묵-review-PR851.md", "PR #851 리뷰요청");

      const loop = createHeadlessLoop({
        commsDir,
        stateDir,
        repoRoot: tmpDir,
        agentName: "묵",
        generation: "gen15",
        pollIntervalMs: 25,
      });

      loop.start();

      // Wait for session to become active
      await waitFor(() => loop.getState().activeSession !== null);

      // Verify dispatch file exists
      let files = fs.readdirSync(inboxDir);
      let dispatchFiles = files.filter((f) =>
        f.includes("headless-dispatch-pr851"),
      );
      expect(dispatchFiles.length).toBeGreaterThan(0);

      // Write review output to trigger session completion
      const reviewDir = path.join(tmpDir, "reviews", "gen15");
      fs.mkdirSync(reviewDir, { recursive: true });
      const reviewFile = path.join(reviewDir, "review-PR851-묵.md");
      fs.writeFileSync(
        reviewFile,
        [
          "---",
          "date: 2026-04-16",
          "reviewer: 묵",
          "pr: 851",
          "round: 1",
          "status: clean",
          "merge: merge",
          "---",
          "",
          "## Findings",
          "",
          "### Medium / Low",
          "- [low] [code-quality] foo.ts:1 — minor style",
          "",
          "## Suggested Diff Lines",
          "1",
        ].join("\n"),
        "utf-8",
      );
      markFileNewerThanSession(
        reviewFile,
        loop.getState().activeSession!.startedAt,
      );

      // Wait for session to complete
      await waitFor(() => loop.getState().activeSession === null, 2_000);

      // Dispatch files should be cleaned up
      files = fs.readdirSync(inboxDir);
      dispatchFiles = files.filter((f) =>
        f.includes("headless-dispatch-pr851"),
      );
      expect(dispatchFiles.length).toBe(0);

      // completedSessions should increment
      expect(loop.getState().completedSessions).toBe(1);

      loop.stop();
    });
  });
});

// ── 4. Metrics in state file ────────────────────────────────────

describe("operational metrics", () => {
  it("writes metrics to headless-state.json", () => {
    withHeadless(() => {
      const loop = createHeadlessLoop({
        commsDir,
        stateDir,
        repoRoot: tmpDir,
        agentName: "test-metrics",
        generation: "gen15",
        pollIntervalMs: 60_000,
      });

      loop.start();

      const state = readStateFile();
      expect(state.metrics).toBeDefined();

      const metrics = state.metrics as Record<string, unknown>;
      expect(metrics.sessionTimeouts).toBe(0);
      expect(metrics.roundTimeouts).toBe(0);
      expect(metrics.consecutiveReReviews).toBe(0);
      expect(metrics.processedMarkerCount).toBeTypeOf("number");

      loop.stop();
    });
  });

  it("includes termination config in state file", () => {
    withHeadless(() => {
      const loop = createHeadlessLoop({
        commsDir,
        stateDir,
        repoRoot: tmpDir,
        agentName: "test-config",
        generation: "gen15",
        pollIntervalMs: 60_000,
      });

      loop.start();

      const state = readStateFile();
      expect(state.terminationConfig).toBeDefined();

      const config = state.terminationConfig as Record<string, unknown>;
      expect(config.maxRounds).toBeTypeOf("number");
      expect(config.qualitySeverityFloor).toBeTypeOf("string");

      loop.stop();
    });
  });
});

// ── 5. Loop lifecycle ───────────────────────────────────────────

describe("loop lifecycle", () => {
  it("does not start loop when not in headless mode", () => {
    // Ensure TAP_HEADLESS is not set
    const orig = process.env.TAP_HEADLESS;
    delete process.env.TAP_HEADLESS;

    try {
      const loop = createHeadlessLoop({
        commsDir,
        stateDir,
        repoRoot: tmpDir,
        agentName: "test-no-headless",
        generation: "gen15",
        pollIntervalMs: 60_000,
      });

      loop.start();

      const state = loop.getState();
      expect(state.running).toBe(false);

      loop.stop();
    } finally {
      if (orig !== undefined) {
        process.env.TAP_HEADLESS = orig;
      }
    }
  });

  it("stop sets running to false and writes state", () => {
    withHeadless(() => {
      const loop = createHeadlessLoop({
        commsDir,
        stateDir,
        repoRoot: tmpDir,
        agentName: "test-stop",
        generation: "gen15",
        pollIntervalMs: 60_000,
      });

      loop.start();
      expect(loop.getState().running).toBe(true);

      loop.stop();
      expect(loop.getState().running).toBe(false);

      const stateFile = readStateFile();
      expect(stateFile.running).toBe(false);
    });
  });

  it("sets lastPollAt after start", () => {
    withHeadless(() => {
      const loop = createHeadlessLoop({
        commsDir,
        stateDir,
        repoRoot: tmpDir,
        agentName: "test-poll",
        generation: "gen15",
        pollIntervalMs: 60_000,
      });

      expect(loop.getState().lastPollAt).toBeNull();

      loop.start();

      expect(loop.getState().lastPollAt).not.toBeNull();

      loop.stop();
    });
  });
});

// ── 6. sortRequests fairness (M326) ─────────────────────────────

describe("sortRequests fairness", () => {
  function makeRequest(overrides: Partial<ReviewRequest>): ReviewRequest {
    return {
      sourcePath: "/fake/inbox/review.md",
      sourceMtimeMs: Date.now(),
      requestTimestampMs: Date.now(),
      sender: "돌",
      recipient: "묵",
      prNumber: 100,
      generation: "gen15",
      isReReview: false,
      round: 1,
      ...overrides,
    };
  }

  it("re-reviews get priority over first-round by default", () => {
    const firstRound = makeRequest({ prNumber: 1, isReReview: false });
    const reReview = makeRequest({ prNumber: 2, isReReview: true });

    const sorted = sortRequests([firstRound, reReview], 0);
    expect(sorted[0].prNumber).toBe(2); // re-review first
    expect(sorted[1].prNumber).toBe(1);
  });

  it("first-round gets priority after 3 consecutive re-reviews (quota exhausted)", () => {
    const firstRound = makeRequest({ prNumber: 1, isReReview: false });
    const reReview = makeRequest({ prNumber: 2, isReReview: true });

    // consecutiveReReviews = 3 → quota exhausted
    const sorted = sortRequests([firstRound, reReview], 3);
    expect(sorted[0].prNumber).toBe(1); // first-round gets priority
    expect(sorted[1].prNumber).toBe(2);
  });

  it("quota not exhausted at 2 consecutive re-reviews", () => {
    const firstRound = makeRequest({ prNumber: 1, isReReview: false });
    const reReview = makeRequest({ prNumber: 2, isReReview: true });

    const sorted = sortRequests([firstRound, reReview], 2);
    expect(sorted[0].prNumber).toBe(2); // re-review still first
    expect(sorted[1].prNumber).toBe(1);
  });

  it("newer requests sorted first among same type", () => {
    const older = makeRequest({
      prNumber: 1,
      requestTimestampMs: 1000,
      sourceMtimeMs: 1000,
    });
    const newer = makeRequest({
      prNumber: 2,
      requestTimestampMs: 2000,
      sourceMtimeMs: 2000,
    });

    const sorted = sortRequests([older, newer], 0);
    expect(sorted[0].prNumber).toBe(2); // newer first
    expect(sorted[1].prNumber).toBe(1);
  });

  it("higher PR number breaks ties", () => {
    const ts = Date.now();
    const low = makeRequest({
      prNumber: 100,
      requestTimestampMs: ts,
      sourceMtimeMs: ts,
    });
    const high = makeRequest({
      prNumber: 200,
      requestTimestampMs: ts,
      sourceMtimeMs: ts,
    });

    const sorted = sortRequests([low, high], 0);
    expect(sorted[0].prNumber).toBe(200); // higher PR number first
    expect(sorted[1].prNumber).toBe(100);
  });

  it("keeps one pending entry when the same request is rescanned with a new PR tip", () => {
    const sourcePath = path.join(inboxDir, "20260326-돌-묵-review-PR996.md");
    const queued = makeRequest({
      prNumber: 996,
      sourcePath,
      messageId: "msg-996",
      prTipSha: "sha-old",
      requestTimestampMs: 100,
      sourceMtimeMs: 100,
    });
    const rescanned = makeRequest({
      prNumber: 996,
      sourcePath,
      messageId: "msg-996",
      prTipSha: "sha-new",
      requestTimestampMs: 100,
      sourceMtimeMs: 100,
    });

    const merged = mergePendingRequests([queued], [rescanned], 0);

    expect(merged).toHaveLength(1);
    expect(merged[0]?.prTipSha).toBe("sha-new");
  });
});

// ── 7. Round timeout ────────────────────────────────────────────

describe("round timeout", () => {
  it("completes session after 5 minutes with no new output between rounds", async () => {
    await withHeadless(async () => {
      writeInboxFile("20260326-돌-묵-review-PR997.md", "PR #997 리뷰요청");

      const loop = createHeadlessLoop({
        commsDir,
        stateDir,
        repoRoot: tmpDir,
        agentName: "묵",
        generation: "gen15",
        pollIntervalMs: 25,
      });

      loop.start();

      // Wait for session to become active
      await waitFor(() => loop.getState().activeSession !== null);

      // Write round 1 output
      const reviewDir = path.join(tmpDir, "reviews", "gen15");
      fs.mkdirSync(reviewDir, { recursive: true });
      const reviewFile = path.join(reviewDir, "review-PR997-묵.md");
      fs.writeFileSync(
        reviewFile,
        [
          "---",
          "date: 2026-04-16",
          "reviewer: 묵",
          "pr: 997",
          "round: 1",
          "status: p1-1items",
          "merge: fix-then-merge",
          "---",
          "",
          "## Findings",
          "",
          "### Critical / High",
          "- [high] [correctness] foo.ts:1 — important issue",
          "",
          "## Suggested Diff Lines",
          "10",
        ].join("\n"),
        "utf-8",
      );
      markFileNewerThanSession(
        reviewFile,
        loop.getState().activeSession!.startedAt,
      );

      // Wait for round 1 to be processed (session continues with round 2)
      await waitFor(() => {
        const state = loop.getState();
        return (
          state.activeSession !== null && state.activeSession.rounds.length >= 1
        );
      }, 2_000);

      // Session should still be active (high finding → continue)
      expect(loop.getState().activeSession).not.toBeNull();

      // Now mock Date.now to jump 6 minutes past the last round
      const realDateNow = Date.now;
      const sixMinutesMs = 6 * 60 * 1000;
      const baseTime = realDateNow();
      Date.now = () => baseTime + sixMinutesMs;

      try {
        // Wait for poll to fire and detect round timeout
        await waitFor(() => loop.getState().activeSession === null, 2_000);

        // Session should be completed (round timeout)
        expect(loop.getState().activeSession).toBeNull();
        expect(loop.getState().completedSessions).toBe(1);

        // roundTimeouts metric should increment
        const stateFile = readStateFile();
        const metrics = stateFile.metrics as Record<string, unknown>;
        expect(metrics.roundTimeouts).toBe(1);
      } finally {
        Date.now = realDateNow;
        loop.stop();
      }
    });
  });
});
