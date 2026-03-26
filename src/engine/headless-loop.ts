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
import * as path from "node:path";
import {
  scanInboxForReviews,
  isHeadlessReviewer,
  getHeadlessEnvConfig,
  buildReviewPrompt,
  writeReviewReceipt,
  parseReviewOutput,
  reviewFilePath,
  markAsProcessed,
  unmarkProcessed,
  type ReviewRequest,
  type ReviewSession,
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
  agentName: string;
  generation: string;
  pollIntervalMs: number;
}

export interface HeadlessLoopState {
  running: boolean;
  activeSession: ReviewSession | null;
  completedSessions: number;
  lastPollAt: string | null;
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
    completedSessions: 0,
    lastPollAt: null,
  };

  let timer: ReturnType<typeof setInterval> | null = null;

  function log(msg: string): void {
    const ts = new Date().toISOString();
    console.error(`[${ts}] [headless-loop] ${msg}`);
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

  function pollOnce(): void {
    state.lastPollAt = new Date().toISOString();

    // Skip if already processing a review
    if (state.activeSession) {
      checkActiveSession();
      writeStateFile();
      return;
    }

    // Scan for new review requests
    const requests = scanInboxForReviews(
      options.commsDir,
      options.stateDir,
      options.generation,
      options.agentName,
    );

    if (requests.length === 0) {
      writeStateFile();
      return;
    }

    // Process first request (sequential — one at a time)
    const request = requests[0];
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
      const date = new Date().toISOString().split("T")[0].replace(/-/g, "");
      const dispatchFilename = `${date}-headless-${options.agentName}-review-PR${request.prNumber}.md`;
      const inboxDir = path.join(options.commsDir, "inbox");
      fs.mkdirSync(inboxDir, { recursive: true });
      const dispatchFile = path.join(inboxDir, dispatchFilename);
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
          options.commsDir,
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
        completeSession(session);
        return;
      }
    }
  }

  function dispatchFollowUp(session: ReviewSession, round: number): void {
    const prompt = buildReviewPrompt(session.request, options.agentName, round);

    // Write follow-up dispatch to commsDir/inbox/ for bridge to steer
    const date = new Date().toISOString().split("T")[0].replace(/-/g, "");
    const dispatchFilename = `${date}-headless-${options.agentName}-review-PR${session.request.prNumber}-r${round}.md`;
    const inboxDir = path.join(options.commsDir, "inbox");
    fs.mkdirSync(inboxDir, { recursive: true });
    const dispatchFile = path.join(inboxDir, dispatchFilename);
    const tmp = `${dispatchFile}.tmp.${process.pid}`;
    fs.writeFileSync(tmp, prompt, "utf-8");
    fs.renameSync(tmp, dispatchFile);
  }

  function completeSession(session: ReviewSession): void {
    session.terminatedAt = new Date().toISOString();

    // Note: request was already marked as processed eagerly in startReviewSession()

    // Clean up dispatch files from inbox
    const inboxDir = path.join(options.commsDir, "inbox");
    if (fs.existsSync(inboxDir)) {
      const prefix = `headless-${options.agentName}-review-PR${session.request.prNumber}`;
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

      // Write initial state
      writeStateFile();

      // Initial poll
      pollOnce();

      // Set up interval
      timer = setInterval(pollOnce, options.pollIntervalMs);
    },

    stop() {
      state.running = false;
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      writeStateFile();
      log("Headless review loop stopped");
    },

    getState() {
      return { ...state };
    },
  };
}
