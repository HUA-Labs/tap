/**
 * Headless review loop — poll-based review orchestrator for bridge processes.
 *
 * Runs alongside the bridge script. When TAP_HEADLESS=true:
 * 1. Periodically scans inbox for review requests
 * 2. Writes review dispatch files that the bridge picks up
 * 3. Monitors review output for completion
 * 4. Evaluates termination conditions
 * 5. Continues or stops the review session
 *
 * This is a control loop, not a WebSocket client — the bridge handles dispatch.
 */
import * as fs from "node:fs";
import type { FSWatcher } from "node:fs";
import * as path from "node:path";
import {
  scanInboxForReviews,
  computePendingRequestKey,
  isAlreadyProcessed,
  isHeadlessReviewer,
  getHeadlessEnvConfig,
  buildReviewPrompt,
  writeReviewReceipt,
  parseReviewOutput,
  reviewFilePath,
  isStaleReviewRequest,
  markAsProcessed,
  unmarkProcessed,
  type ReviewRequest,
  type ReviewSession,
  type PrHeadCache,
} from "./review.js";
import {
  evaluate,
  DEFAULT_TERMINATION_CONFIG,
  type TerminationContext,
  type TerminationConfig,
  type FindingSeverity,
} from "./termination.js";

// ── Types ──────────────────────────────────────────────────────────

export interface HeadlessLoopOptions {
  commsDir: string;
  stateDir: string;
  repoRoot: string;
  agentId?: string;
  agentName: string;
  generation: string;
  pollIntervalMs: number;
}

export interface HeadlessLoopState {
  running: boolean;
  activeSession: ReviewSession | null;
  pendingRequests: ReviewRequest[];
  completedSessions: number;
  lastPollAt: string | null;
}

// ── Exported pure functions (testable) ─────────────────────────────

const MAX_CONSECUTIVE_REREVIEWS = 3; // After 3 re-reviews, let a first-round through

/**
 * Sort review requests by priority.
 * M326 fairness: after MAX_CONSECUTIVE_REREVIEWS, first-round gets priority.
 */
export function sortRequests(
  requests: ReviewRequest[],
  consecutiveReReviews: number,
): ReviewRequest[] {
  const reReviewQuotaExhausted =
    consecutiveReReviews >= MAX_CONSECUTIVE_REREVIEWS;

  return [...requests].sort((a, b) => {
    if (a.isReReview !== b.isReReview) {
      if (reReviewQuotaExhausted) {
        return Number(a.isReReview) - Number(b.isReReview);
      }
      return Number(b.isReReview) - Number(a.isReReview);
    }
    if (a.requestTimestampMs !== b.requestTimestampMs) {
      return b.requestTimestampMs - a.requestTimestampMs;
    }
    if (a.sourceMtimeMs !== b.sourceMtimeMs) {
      return b.sourceMtimeMs - a.sourceMtimeMs;
    }
    return b.prNumber - a.prNumber;
  });
}

export function mergePendingRequests(
  queued: ReviewRequest[],
  scanned: ReviewRequest[],
  consecutiveReReviews: number,
): ReviewRequest[] {
  const merged = new Map<string, ReviewRequest>();
  for (const request of [...queued, ...scanned]) {
    merged.set(computePendingRequestKey(request), request);
  }
  return sortRequests([...merged.values()], consecutiveReReviews);
}

// ── Loop implementation ────────────────────────────────────────────

export function createHeadlessLoop(options: HeadlessLoopOptions): {
  start: () => void;
  stop: () => void;
  getState: () => HeadlessLoopState;
} {
  const envConfig = getHeadlessEnvConfig();
  const terminationConfig: TerminationConfig = {
    ...DEFAULT_TERMINATION_CONFIG,
    maxRounds: envConfig?.maxRounds ?? DEFAULT_TERMINATION_CONFIG.maxRounds,
    qualitySeverityFloor:
      (envConfig?.qualityFloor as FindingSeverity) ??
      DEFAULT_TERMINATION_CONFIG.qualitySeverityFloor,
  };

  const state: HeadlessLoopState = {
    running: false,
    activeSession: null,
    pendingRequests: [],
    completedSessions: 0,
    lastPollAt: null,
  };

  // ── M326: Operational metrics ───────────────────────────────────
  let sessionTimeouts = 0;
  let roundTimeouts = 0;
  let consecutiveReReviews = 0;
  let lastCompletionAt: string | null = null;
  const PROCESSED_MARKER_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
  const GC_INTERVAL_MS = 60 * 60 * 1000; // Run GC at most once per hour
  let lastGcAt = 0;

  let timer: ReturnType<typeof setInterval> | null = null;
  const prHeadCache: PrHeadCache = new Map();

  // ── M324: fs.watch-based instant wakeup ─────────────────────────
  let watcher: FSWatcher | null = null;
  let watchRestartTimer: ReturnType<typeof setTimeout> | null = null;
  const WATCH_DEBOUNCE_MS = 150;
  const WATCH_RESTART_MS = 2_000;
  let lastWatchWakeMs = 0;

  function startInboxWatcher(): void {
    disposeInboxWatcher();

    const inboxDir = path.join(options.commsDir, "inbox");
    if (!fs.existsSync(inboxDir)) {
      fs.mkdirSync(inboxDir, { recursive: true });
    }

    try {
      watcher = fs.watch(inboxDir, (eventType, filename) => {
        if (!filename || !filename.endsWith(".md")) return;
        // Skip dispatch files written by this loop
        if (filename.includes("headless-dispatch-")) return;

        const now = Date.now();
        if (now - lastWatchWakeMs < WATCH_DEBOUNCE_MS) return;
        lastWatchWakeMs = now;

        log(`fs.watch wake: ${eventType} ${filename}`);
        // Immediate poll — don't wait for interval
        pollOnce();
      });

      watcher.on("error", (error) => {
        log(
          `fs.watch error: ${error instanceof Error ? error.message : String(error)}`,
        );
        scheduleWatchRestart("error");
      });

      watcher.on("close", () => {
        scheduleWatchRestart("close");
      });

      log("fs.watch active on inbox");
    } catch (error) {
      log(
        `fs.watch start failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      scheduleWatchRestart("start-failed");
    }
  }

  function disposeInboxWatcher(): void {
    if (!watcher) return;
    watcher.removeAllListeners();
    try {
      watcher.close();
    } catch {
      // Best-effort cleanup
    }
    watcher = null;
  }

  function scheduleWatchRestart(reason: string): void {
    if (watchRestartTimer) return;
    log(`fs.watch restart scheduled (${reason})`);
    watchRestartTimer = setTimeout(() => {
      watchRestartTimer = null;
      if (!state.running) return;
      startInboxWatcher();
    }, WATCH_RESTART_MS);
    if (watchRestartTimer.unref) watchRestartTimer.unref();
  }

  function log(msg: string): void {
    const ts = new Date().toISOString();
    console.error(`[${ts}] [headless-loop] ${msg}`);
  }

  function dispatchSender(): string {
    return "headless";
  }

  function dispatchSubject(prNumber: number, round?: number): string {
    return round == null
      ? `headless-dispatch-pr${prNumber}`
      : `headless-dispatch-pr${prNumber}-r${round}`;
  }

  function dispatchFilename(prNumber: number, round?: number): string {
    const date = new Date().toISOString().split("T")[0].replace(/-/g, "");
    return `${date}-${dispatchSender()}-${options.agentName}-${dispatchSubject(prNumber, round)}.md`;
  }

  function dispatchFileMatch(prNumber: number): string {
    return `-${dispatchSender()}-${options.agentName}-headless-dispatch-pr${prNumber}`;
  }

  // ── M326: Metrics helpers ─────────────────────────────────────
  function computeOldestPendingMs(): number | null {
    if (state.pendingRequests.length === 0) return null;
    const oldest = Math.min(
      ...state.pendingRequests.map((r) => r.requestTimestampMs),
    );
    return Date.now() - oldest;
  }

  function computeActiveSessionAgeMs(): number | null {
    if (!state.activeSession) return null;
    return Date.now() - new Date(state.activeSession.startedAt).getTime();
  }

  function countProcessedMarkers(): number {
    const markerDir = path.join(options.stateDir, "processed");
    if (!fs.existsSync(markerDir)) return 0;
    try {
      return fs.readdirSync(markerDir).filter((f) => f.endsWith(".done"))
        .length;
    } catch {
      return 0;
    }
  }

  // ── M326: Processed marker GC ──────────────────────────────────
  function maybeGcProcessedMarkers(): void {
    const now = Date.now();
    if (now - lastGcAt < GC_INTERVAL_MS) return;
    lastGcAt = now;
    gcProcessedMarkers();
  }

  function gcProcessedMarkers(): number {
    const markerDir = path.join(options.stateDir, "processed");
    if (!fs.existsSync(markerDir)) return 0;
    const now = Date.now();
    let removed = 0;
    try {
      for (const file of fs.readdirSync(markerDir)) {
        if (!file.endsWith(".done")) continue;
        const filePath = path.join(markerDir, file);
        try {
          const age = now - fs.statSync(filePath).mtimeMs;
          if (age > PROCESSED_MARKER_MAX_AGE_MS) {
            fs.unlinkSync(filePath);
            removed++;
          }
        } catch {
          // Skip unreadable files
        }
      }
    } catch {
      // Non-critical
    }
    if (removed > 0)
      log(`GC: removed ${removed} stale processed markers (>7d)`);
    return removed;
  }

  function writeStateFile(): void {
    try {
      const payload = {
        running: state.running,
        agentName: options.agentName,
        generation: options.generation,
        pollIntervalMs: options.pollIntervalMs,
        completedSessions: state.completedSessions,
        lastPollAt: state.lastPollAt,
        pendingReviewCount: state.pendingRequests.length,
        pendingReviews: state.pendingRequests.map((request) => ({
          prNumber: request.prNumber,
          sender: request.sender,
          isReReview: request.isReReview,
          round: request.round,
        })),
        activeReview: state.activeSession
          ? {
              prNumber: state.activeSession.request.prNumber,
              round: state.activeSession.rounds.length + 1,
              startedAt: state.activeSession.startedAt,
              sender: state.activeSession.request.sender,
            }
          : null,
        terminationConfig: {
          maxRounds: terminationConfig.maxRounds,
          qualitySeverityFloor: terminationConfig.qualitySeverityFloor,
        },
        // M326: Operational metrics for queue health monitoring
        metrics: {
          oldestPendingMs: computeOldestPendingMs(),
          activeSessionAgeMs: computeActiveSessionAgeMs(),
          lastCompletionAt,
          sessionTimeouts,
          roundTimeouts,
          consecutiveReReviews,
          processedMarkerCount: countProcessedMarkers(),
        },
        updatedAt: new Date().toISOString(),
      };
      const filePath = path.join(options.stateDir, "headless-state.json");
      const tmp = `${filePath}.tmp.${process.pid}`;
      fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), "utf-8");
      fs.renameSync(tmp, filePath);
    } catch {
      // Non-critical — state dump is best-effort
    }
  }

  // sortRequests is now a file-level export for testability (M332)

  function requestStillEligible(request: ReviewRequest): boolean {
    if (!fs.existsSync(request.sourcePath)) return false;
    const bypassProcessedCheck =
      request.isReReview &&
      state.activeSession?.request.prNumber === request.prNumber;
    if (!bypassProcessedCheck && isAlreadyProcessed(options.stateDir, request))
      return false;
    const bypassStaleCheck =
      request.isReReview &&
      state.activeSession?.request.prNumber === request.prNumber;
    if (
      !bypassStaleCheck &&
      isStaleReviewRequest(request, options.repoRoot, options.agentName)
    )
      return false;
    return true;
  }

  function refreshPendingQueue(): void {
    const queued = state.pendingRequests.filter(requestStillEligible);
    const scanned = scanInboxForReviews(
      options.commsDir,
      options.stateDir,
      options.repoRoot,
      options.generation,
      options.agentName,
      options.agentId,
      state.activeSession?.request.prNumber ?? null,
      prHeadCache,
    );

    state.pendingRequests = mergePendingRequests(
      queued,
      scanned,
      consecutiveReReviews,
    );
  }

  function pollOnce(): void {
    // M324: Guard against queued fs.watch callbacks firing after stop()
    if (!state.running) return;

    state.lastPollAt = new Date().toISOString();
    maybeGcProcessedMarkers();
    refreshPendingQueue();

    // If a session is active, update it first. If that session completes or
    // times out in this tick, continue scanning immediately instead of waiting
    // for the next poll interval.
    if (state.activeSession) {
      checkActiveSession();
      if (state.activeSession) {
        writeStateFile();
        return;
      }
    }

    if (state.pendingRequests.length === 0) {
      writeStateFile();
      return;
    }

    // Process next request from the pending queue (sequential — one active at a time).
    const request = state.pendingRequests.shift();
    if (!request) {
      writeStateFile();
      return;
    }
    startReviewSession(request);
    writeStateFile();
  }

  function startReviewSession(request: ReviewRequest): void {
    log(`Starting review for PR #${request.prNumber}`);

    // Mark as processed EAGERLY to prevent race with generic bridge.
    // If anything fails after this point, we roll back the marker.
    markAsProcessed(options.stateDir, request);

    try {
      // Write receipt
      writeReviewReceipt(options.commsDir, request, options.agentName);

      // Build review prompt
      const prompt = buildReviewPrompt(request, options.agentName, 1);

      // Write dispatch file to commsDir/inbox/ — the bridge watches this
      // directory and will inject it as a turn/start
      const inboxDir = path.join(options.commsDir, "inbox");
      fs.mkdirSync(inboxDir, { recursive: true });
      const dispatchFile = path.join(
        inboxDir,
        dispatchFilename(request.prNumber),
      );
      const tmp = `${dispatchFile}.tmp.${process.pid}`;
      fs.writeFileSync(tmp, prompt, "utf-8");
      fs.renameSync(tmp, dispatchFile);

      state.activeSession = {
        request,
        agentName: options.agentName,
        role:
          (envConfig?.role as "reviewer" | "validator" | "long-running") ??
          "reviewer",
        rounds: [],
        startedAt: new Date().toISOString(),
        reviewFilePath: reviewFilePath(
          options.repoRoot,
          request.generation,
          request.prNumber,
          options.agentName,
        ),
      };

      log(`Dispatched review prompt for PR #${request.prNumber} (round 1)`);
    } catch (err) {
      // Roll back processed marker so request can be retried on next poll
      log(
        `Failed to start review for PR #${request.prNumber}: ${err instanceof Error ? err.message : String(err)}`,
      );
      unmarkProcessed(options.stateDir, request);
    }
  }

  function checkActiveSession(): void {
    if (!state.activeSession) return;

    const session = state.activeSession;
    const revPath = session.reviewFilePath;

    // Check for new output FIRST — if output arrived, process it regardless
    // of elapsed time. Timeouts only apply when there's genuinely no output.
    // (덱 review: timeout before file check drops late-arriving valid output)
    let hasNewOutput = false;
    if (fs.existsSync(revPath)) {
      const stat = fs.statSync(revPath);
      const lastRound = session.rounds[session.rounds.length - 1];
      const lastCheck = lastRound?.timestamp ?? session.startedAt;
      hasNewOutput = stat.mtime.toISOString() > lastCheck;
    }

    if (hasNewOutput) {
      // New output arrived — parse and evaluate (skip timeout)
      const roundNum = session.rounds.length + 1;
      const round = parseReviewOutput(revPath, roundNum);
      if (!round) return;

      session.rounds.push(round);
      log(
        `PR #${session.request.prNumber} round ${roundNum}: ${round.findingCount} findings, ${round.suggestedDiffLines} suggested diff lines`,
      );

      // Evaluate termination
      const stopSignalPath = path.join(options.stateDir, "stop-signal");
      const ctx: TerminationContext = {
        round: roundNum,
        rounds: session.rounds,
        stopSignalPath,
        config: terminationConfig,
      };

      const result = evaluate(ctx);

      if (result.verdict === "stop") {
        log(
          `PR #${session.request.prNumber} terminated: ${result.reason} (${result.strategy})`,
        );
        completeSession(session);
      } else {
        log(
          `PR #${session.request.prNumber} continues to round ${roundNum + 1}`,
        );
        dispatchFollowUp(session, roundNum + 1);
      }
      return;
    }

    // No new output — apply timeout checks.

    // Session timeout: no output at all after SESSION_TIMEOUT_MS
    const SESSION_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
    const elapsed = Date.now() - new Date(session.startedAt).getTime();
    if (elapsed > SESSION_TIMEOUT_MS && session.rounds.length === 0) {
      log(
        `PR #${session.request.prNumber} timed out — no output after ${Math.round(elapsed / 60000)}min. Releasing session.`,
      );
      sessionTimeouts++;
      state.activeSession = null;
      return;
    }

    // Round timeout: no new output between rounds for ROUND_TIMEOUT_MS
    const ROUND_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes between rounds
    if (session.rounds.length > 0) {
      const lastRoundTime = new Date(
        session.rounds[session.rounds.length - 1]!.timestamp,
      ).getTime();
      if (Date.now() - lastRoundTime > ROUND_TIMEOUT_MS) {
        log(
          `PR #${session.request.prNumber} round timeout — no new output after ${Math.round((Date.now() - lastRoundTime) / 60000)}min. Completing session.`,
        );
        roundTimeouts++;
        completeSession(session);
        return;
      }
    }
  }

  function dispatchFollowUp(session: ReviewSession, round: number): void {
    const prompt = buildReviewPrompt(session.request, options.agentName, round);

    // Write follow-up dispatch to commsDir/inbox/ for bridge to steer
    const inboxDir = path.join(options.commsDir, "inbox");
    fs.mkdirSync(inboxDir, { recursive: true });
    const dispatchFile = path.join(
      inboxDir,
      dispatchFilename(session.request.prNumber, round),
    );
    const tmp = `${dispatchFile}.tmp.${process.pid}`;
    fs.writeFileSync(tmp, prompt, "utf-8");
    fs.renameSync(tmp, dispatchFile);
  }

  function completeSession(session: ReviewSession): void {
    session.terminatedAt = new Date().toISOString();
    lastCompletionAt = session.terminatedAt;

    // M326: Track consecutive re-reviews for fairness quota
    if (session.request.isReReview) {
      consecutiveReReviews++;
    } else {
      consecutiveReReviews = 0; // Reset on first-round completion
    }

    // Note: request was already marked as processed eagerly in startReviewSession()

    // Clean up dispatch files from inbox
    const inboxDir = path.join(options.commsDir, "inbox");
    if (fs.existsSync(inboxDir)) {
      const prefix = dispatchFileMatch(session.request.prNumber);
      const files = fs.readdirSync(inboxDir).filter((f) => f.includes(prefix));
      for (const f of files) {
        fs.unlinkSync(path.join(inboxDir, f));
      }
    }

    state.activeSession = null;
    state.completedSessions++;
    log(
      `PR #${session.request.prNumber} review complete (${session.rounds.length} rounds)`,
    );
  }

  return {
    start() {
      if (!isHeadlessReviewer()) {
        log("Not in headless mode — loop not started");
        return;
      }

      state.running = true;
      log(
        `Headless review loop started (${envConfig?.role ?? "reviewer"}, poll ${options.pollIntervalMs}ms, max ${terminationConfig.maxRounds} rounds)`,
      );

      // M326: GC stale processed markers on startup
      gcProcessedMarkers();
      lastGcAt = Date.now();

      // Write initial state
      writeStateFile();

      // Initial poll
      pollOnce();

      // M324: Start fs.watch for instant wakeup, poll interval as fallback
      startInboxWatcher();

      // Set up interval (fallback — fs.watch handles fast path)
      timer = setInterval(pollOnce, options.pollIntervalMs);
    },

    stop() {
      state.running = false;
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      // M324: Clean up fs.watch
      disposeInboxWatcher();
      if (watchRestartTimer) {
        clearTimeout(watchRestartTimer);
        watchRestartTimer = null;
      }
      writeStateFile();
      log("Headless review loop stopped");
    },

    getState() {
      return { ...state };
    },
  };
}
