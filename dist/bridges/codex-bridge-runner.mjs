var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// src/engine/termination.ts
import * as fs5 from "fs";
import * as crypto from "crypto";
function isAtOrAbove(severity, floor) {
  return SEVERITY_RANK[severity] >= SEVERITY_RANK[floor];
}
function computeFindingHash(findings) {
  const normalized = findings.filter((f) => isAtOrAbove(f.severity, "high")).map((f) => `${f.category}:${f.description.slice(0, 100)}`).sort().join("|");
  if (!normalized) return "empty";
  return crypto.createHash("sha256").update(normalized).digest("hex").slice(0, 16);
}
function evalManualStop(ctx) {
  if (fs5.existsSync(ctx.stopSignalPath)) {
    return {
      verdict: "stop",
      reason: `Manual stop signal found at ${ctx.stopSignalPath}`,
      strategy: "manual-stop",
      summary: `Review stopped manually at round ${ctx.round}`
    };
  }
  return null;
}
function evalRoundCap(ctx) {
  if (ctx.round >= ctx.config.maxRounds) {
    return {
      verdict: "stop",
      reason: `Round cap reached (${ctx.round}/${ctx.config.maxRounds})`,
      strategy: "round-cap",
      summary: `Review stopped at round cap (${ctx.config.maxRounds})`
    };
  }
  return null;
}
function evalRepetition(ctx) {
  if (ctx.rounds.length < 2) return null;
  const latest = ctx.rounds[ctx.rounds.length - 1];
  if (!latest) return null;
  let count = 0;
  for (const round of ctx.rounds) {
    if (round.findingHash === latest.findingHash) count++;
  }
  if (count >= ctx.config.repetitionThreshold) {
    return {
      verdict: "stop",
      reason: `Same finding hash repeated ${count} times (threshold: ${ctx.config.repetitionThreshold})`,
      strategy: "repetition-detection",
      summary: `Review going in circles \u2014 same findings repeated ${count}x`
    };
  }
  return null;
}
function evalQualityThreshold(ctx) {
  if (ctx.rounds.length === 0) return null;
  const latest = ctx.rounds[ctx.rounds.length - 1];
  if (!latest) return null;
  if (latest.findingCount === 0 && latest.suggestedDiffLines === 0 && latest.findings.length === 0) {
    return null;
  }
  const significantFindings = latest.findings.filter(
    (f) => isAtOrAbove(f.severity, ctx.config.qualitySeverityFloor)
  );
  if (significantFindings.length === 0) {
    return {
      verdict: "stop",
      reason: `No findings at ${ctx.config.qualitySeverityFloor}+ severity in round ${ctx.round}`,
      strategy: "quality-threshold",
      summary: `Review clean \u2014 no ${ctx.config.qualitySeverityFloor}+ findings in round ${ctx.round}`
    };
  }
  return null;
}
function evalDiffInsignificance(ctx) {
  if (ctx.rounds.length === 0) return null;
  const latest = ctx.rounds[ctx.rounds.length - 1];
  if (!latest) return null;
  if (latest.findingCount === 0 && latest.suggestedDiffLines === 0 && latest.findings.length === 0) {
    return null;
  }
  if (latest.suggestedDiffLines < ctx.config.diffThreshold) {
    return {
      verdict: "stop",
      reason: `Suggested diff (${latest.suggestedDiffLines} lines) below threshold (${ctx.config.diffThreshold})`,
      strategy: "diff-insignificance",
      summary: `Review suggestions are trivial (${latest.suggestedDiffLines} lines)`
    };
  }
  return null;
}
function evaluate(ctx) {
  for (const strategy of ctx.config.strategies) {
    const evaluator = STRATEGY_EVALUATORS[strategy];
    if (!evaluator) continue;
    const result = evaluator(ctx);
    if (result) return result;
  }
  return {
    verdict: "continue",
    reason: "All strategies passed \u2014 review continues",
    strategy: ctx.config.strategies[ctx.config.strategies.length - 1] ?? "round-cap",
    summary: `Round ${ctx.round} complete, continuing`
  };
}
var DEFAULT_TERMINATION_CONFIG, SEVERITY_RANK, STRATEGY_EVALUATORS;
var init_termination = __esm({
  "src/engine/termination.ts"() {
    "use strict";
    DEFAULT_TERMINATION_CONFIG = {
      strategies: [
        "manual-stop",
        "round-cap",
        "repetition-detection",
        "quality-threshold",
        "diff-insignificance"
      ],
      maxRounds: 5,
      diffThreshold: 3,
      repetitionThreshold: 2,
      qualitySeverityFloor: "high"
    };
    SEVERITY_RANK = {
      critical: 5,
      high: 4,
      medium: 3,
      low: 2,
      nitpick: 1
    };
    STRATEGY_EVALUATORS = {
      "manual-stop": evalManualStop,
      "round-cap": evalRoundCap,
      "repetition-detection": evalRepetition,
      "quality-threshold": evalQualityThreshold,
      "diff-insignificance": evalDiffInsignificance
    };
  }
});

// src/engine/review.ts
import * as fs6 from "fs";
import * as path5 from "path";
import * as crypto2 from "crypto";
import { spawnSync } from "child_process";
function trimAddress(value) {
  return value.trim();
}
function canonicalizeAgentId(value) {
  return trimAddress(value).replace(/-/g, "_").toLowerCase();
}
function isOwnMessageAddress(sender, agentId, agentName) {
  const normalizedSender = trimAddress(sender);
  if (!normalizedSender) return false;
  return canonicalizeAgentId(normalizedSender) === canonicalizeAgentId(agentId) || normalizedSender.toLowerCase() === trimAddress(agentName).toLowerCase();
}
function parseInboxFilename(filename) {
  const base = path5.basename(filename, ".md");
  const match = base.match(/^(\d{8})-([^-]+)-([^-]+)-(.+)$/);
  if (!match) return null;
  return {
    date: match[1],
    sender: match[2],
    recipient: match[3],
    subject: match[4]
  };
}
function extractPrNumber(text) {
  for (const pattern of PR_NUMBER_PATTERNS) {
    const match = text.match(pattern);
    if (match?.[1]) return parseInt(match[1], 10);
  }
  return null;
}
function computePendingRequestKey(request) {
  return request.messageId ? `message:${request.messageId}` : `source:${request.sourcePath}`;
}
function parseInboxContentFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match?.[1]) return null;
  const fields = {};
  for (const line of match[1].split("\n")) {
    const kv = line.match(/^(\w+):\s*(.+)$/);
    if (kv?.[1] && kv[2]) fields[kv[1]] = kv[2].trim();
  }
  return {
    sent_at: fields.sent_at,
    message_id: fields.message_id,
    to: fields.to
  };
}
function detectReviewRequest(filePath, content, generation) {
  const parsed = parseInboxFilename(filePath);
  if (!parsed) return null;
  if (parsed.subject.startsWith("headless-dispatch-")) return null;
  const fullText = `${parsed.subject} ${content}`;
  const isReview = REVIEW_KEYWORDS.some((re) => re.test(fullText));
  const isReReview = REREVIEW_KEYWORDS.some((re) => re.test(fullText));
  if (!isReview && !isReReview) return null;
  const prNumber = extractPrNumber(fullText);
  if (!prNumber) return null;
  const sourceMtimeMs = fs6.existsSync(filePath) ? fs6.statSync(filePath).mtimeMs : 0;
  const fm = parseInboxContentFrontmatter(content);
  return {
    sourcePath: filePath,
    sourceMtimeMs,
    requestTimestampMs: extractRequestTimestampMs(
      parsed.date,
      fm,
      sourceMtimeMs
    ),
    sender: parsed.sender,
    recipient: parsed.recipient,
    prNumber,
    generation,
    isReReview,
    round: isReReview ? 2 : 1,
    // Will be adjusted by session tracking
    messageId: fm?.message_id || void 0,
    dedupeRecipient: fm?.to || void 0
  };
}
function extractRequestTimestampMs(inboxDate, fm, fallbackMtimeMs) {
  if (fm?.sent_at) {
    const sentAtMs = new Date(fm.sent_at).getTime();
    if (Number.isFinite(sentAtMs) && sentAtMs > 0) return sentAtMs;
  }
  const dateMatch = inboxDate.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (dateMatch) {
    const [, year, month, day] = dateMatch;
    return Date.UTC(
      Number.parseInt(year, 10),
      Number.parseInt(month, 10) - 1,
      Number.parseInt(day, 10)
    );
  }
  return fallbackMtimeMs;
}
function buildReviewPrompt(request, agentName, round) {
  const roundLabel = round > 1 ? ` (re-review round ${round})` : "";
  return [
    `You are a code reviewer for the HUA Platform monorepo.`,
    ``,
    `## Task`,
    `Review PR #${request.prNumber}${roundLabel}.`,
    ``,
    `## Instructions`,
    `1. Run: gh pr diff ${request.prNumber}`,
    `2. Read changed files for understanding`,
    `3. Apply review checklist: security > data integrity > performance > error handling > code quality`,
    `4. Write structured findings`,
    ``,
    `## Output`,
    `Write review to: ${path5.join("reviews", request.generation, `review-PR${request.prNumber}-${agentName}.md`)}`,
    ``,
    `### Review File Format`,
    `\`\`\`markdown`,
    `---`,
    `date: ${(/* @__PURE__ */ new Date()).toISOString().split("T")[0]}`,
    `reviewer: ${agentName}`,
    `pr: ${request.prNumber}`,
    `round: ${round}`,
    `status: clean | p1-Nitems | p2-Nitems`,
    `merge: merge | fix-then-merge | hold`,
    `---`,
    ``,
    `## Findings`,
    ``,
    `### Critical / High`,
    `- [severity] [category] file:line \u2014 description`,
    ``,
    `### Medium / Low`,
    `- [severity] [category] file:line \u2014 description`,
    ``,
    `## Checks`,
    `- [ ] Build verified`,
    `- [ ] Typecheck passed`,
    `- [ ] Scope check (only expected files changed)`,
    ``,
    `## Suggested Diff Lines`,
    `{number of lines the author should change to address findings}`,
    ``,
    `## Decision`,
    `{one-line merge recommendation}`,
    `\`\`\``,
    ``,
    `## After Review`,
    `- Update reviews/INDEX.md`,
    `- Write inbox reply to ${request.sender}`,
    `- Commit and push comms changes`
  ].join("\n");
}
function extractSuggestedDiffLines(content) {
  const match = content.match(/## Suggested Diff Lines\s*\n\s*(\d+)/i);
  if (match?.[1]) return parseInt(match[1], 10);
  const codeBlocks = content.match(/```[\s\S]*?```/g) ?? [];
  let totalLines = 0;
  for (const block of codeBlocks) {
    totalLines += block.split("\n").length - 2;
  }
  return totalLines;
}
function extractFindings(content) {
  const findings = [];
  const lines = content.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("-") && !trimmed.startsWith("*")) continue;
    let severity = "medium";
    for (const [sev, pattern] of Object.entries(SEVERITY_PATTERNS)) {
      if (pattern.test(trimmed)) {
        severity = sev;
        break;
      }
    }
    let category = "general";
    for (const cat of CATEGORY_PATTERNS) {
      if (trimmed.toLowerCase().includes(cat)) {
        category = cat;
        break;
      }
    }
    const fileMatch = trimmed.match(/([a-zA-Z0-9_/.-]+\.[a-zA-Z]+):(\d+)/);
    const hasSeverityKeyword = Object.values(SEVERITY_PATTERNS).some(
      (p) => p.test(trimmed)
    );
    if (hasSeverityKeyword || fileMatch) {
      findings.push({
        severity,
        category,
        description: trimmed.replace(/^[-*]\s*/, "").slice(0, 200),
        file: fileMatch?.[1],
        line: fileMatch?.[2] ? parseInt(fileMatch[2], 10) : void 0
      });
    }
  }
  return findings;
}
function parseReviewOutput(reviewFilePath2, round) {
  if (!fs6.existsSync(reviewFilePath2)) return null;
  const content = fs6.readFileSync(reviewFilePath2, "utf-8");
  const findings = extractFindings(content);
  const suggestedDiffLines = extractSuggestedDiffLines(content);
  return {
    round,
    timestamp: (/* @__PURE__ */ new Date()).toISOString(),
    findingCount: findings.length,
    findings,
    suggestedDiffLines,
    findingHash: computeFindingHash(findings)
  };
}
function reviewFilePath(repoRoot, generation, prNumber, agentName) {
  return path5.join(
    repoRoot,
    "reviews",
    generation,
    `review-PR${prNumber}-${agentName}.md`
  );
}
function isStaleReviewRequest(request, repoRoot, agentName) {
  const revPath = reviewFilePath(
    repoRoot,
    request.generation,
    request.prNumber,
    agentName
  );
  if (fs6.existsSync(revPath) && fs6.existsSync(request.sourcePath)) {
    const reviewStat = fs6.statSync(revPath);
    const requestStat = fs6.statSync(request.sourcePath);
    if (reviewStat.mtimeMs > requestStat.mtimeMs) return true;
  }
  return false;
}
function resolvePrHead(repoRoot, request, cache) {
  const cacheKey = request.messageId ? `message:${request.messageId}` : `source:${request.sourcePath}:mtime:${request.sourceMtimeMs}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.checkedAtMs < PR_HEAD_CACHE_REVALIDATE_MS) {
    return cached.value;
  }
  let result = null;
  try {
    const command = spawnSync(
      "gh",
      [
        "pr",
        "view",
        String(request.prNumber),
        "--json",
        "headRefName,headRefOid"
      ],
      { cwd: repoRoot, encoding: "utf-8", timeout: 1e4 }
    );
    if (command.status === 0 && command.stdout.trim()) {
      const parsed = JSON.parse(command.stdout);
      result = {
        headRefName: parsed.headRefName,
        headRefOid: parsed.headRefOid
      };
    }
  } catch {
    result = null;
  }
  cache.set(cacheKey, {
    value: result,
    checkedAtMs: Date.now()
  });
  return result;
}
function computeRequestMarkerId(request) {
  const recipient = request.dedupeRecipient || request.recipient;
  if (request.prTipSha) {
    return crypto2.createHash("sha1").update(
      `pr:${request.prNumber}:tip:${request.prTipSha}:recipient:${recipient}`
    ).digest("hex");
  }
  if (request.messageId) {
    return crypto2.createHash("sha1").update(`message_id:${request.messageId}:recipient:${recipient}`).digest("hex");
  }
  let contentHash = "";
  try {
    const content = fs6.readFileSync(request.sourcePath, "utf-8");
    contentHash = crypto2.createHash("sha1").update(content).digest("hex");
  } catch {
  }
  const input = JSON.stringify({
    sourcePath: request.sourcePath,
    sender: request.sender,
    recipient: request.recipient,
    prNumber: request.prNumber,
    generation: request.generation,
    isReReview: request.isReReview,
    contentHash
  });
  return crypto2.createHash("sha1").update(input).digest("hex");
}
function isAlreadyProcessed(stateDir, request) {
  const markerId = computeRequestMarkerId(request);
  return fs6.existsSync(path5.join(stateDir, "processed", `${markerId}.done`));
}
function unmarkProcessed(stateDir, request) {
  const markerId = computeRequestMarkerId(request);
  const markerPath = path5.join(stateDir, "processed", `${markerId}.done`);
  if (fs6.existsSync(markerPath)) {
    fs6.unlinkSync(markerPath);
  }
}
function markAsProcessed(stateDir, request) {
  const markerId = computeRequestMarkerId(request);
  const markerDir = path5.join(stateDir, "processed");
  fs6.mkdirSync(markerDir, { recursive: true });
  const markerPath = path5.join(markerDir, `${markerId}.done`);
  const payload = {
    prNumber: request.prNumber,
    prTipSha: request.prTipSha ?? null,
    sourcePath: request.sourcePath,
    processedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
  const tmp = `${markerPath}.tmp.${process.pid}`;
  fs6.writeFileSync(tmp, JSON.stringify(payload, null, 2), "utf-8");
  fs6.renameSync(tmp, markerPath);
}
function writeReviewReceipt(commsDir, request, agentName) {
  const date = (/* @__PURE__ */ new Date()).toISOString().split("T")[0].replace(/-/g, "");
  const filename = `${date}-${agentName}-${request.sender}-PR${request.prNumber}-ack.md`;
  const content = [
    `## ${agentName} > ${request.sender}`,
    ``,
    `- PR #${request.prNumber} review request received.`,
    `- headless reviewer processing.`,
    `- request: ${path5.basename(request.sourcePath)}`
  ].join("\n");
  const inboxDir = path5.join(commsDir, "inbox");
  fs6.mkdirSync(inboxDir, { recursive: true });
  const inboxPath = path5.join(inboxDir, filename);
  const tmp = `${inboxPath}.tmp.${process.pid}`;
  fs6.writeFileSync(tmp, content, "utf-8");
  fs6.renameSync(tmp, inboxPath);
  return inboxPath;
}
function isHeadlessReviewer() {
  return process.env.TAP_HEADLESS === "true";
}
function getHeadlessEnvConfig() {
  if (!isHeadlessReviewer()) return null;
  return {
    role: process.env.TAP_AGENT_ROLE ?? "reviewer",
    maxRounds: parseInt(process.env.TAP_MAX_REVIEW_ROUNDS ?? "5", 10),
    qualityFloor: process.env.TAP_QUALITY_FLOOR ?? "high"
  };
}
function scanInboxForReviews(commsDir, stateDir, repoRoot, generation, agentName, agentId = agentName, activeSessionPrNumber, prHeadCache) {
  const inboxDir = path5.join(commsDir, "inbox");
  if (!fs6.existsSync(inboxDir)) return [];
  const files = fs6.readdirSync(inboxDir).filter((f) => f.endsWith(".md"));
  const requests = [];
  const shouldResolvePrHead = fs6.existsSync(path5.join(repoRoot, ".git"));
  const activePrHeadCache = shouldResolvePrHead ? prHeadCache ?? /* @__PURE__ */ new Map() : null;
  for (const file of files) {
    const filePath = path5.join(inboxDir, file);
    const content = fs6.readFileSync(filePath, "utf-8");
    const request = detectReviewRequest(filePath, content, generation);
    if (!request) continue;
    const to = request.recipient.toLowerCase();
    if (to !== agentName.toLowerCase() && to !== "\uC804\uCCB4" && to !== "all" && to !== "") {
      continue;
    }
    if (isOwnMessageAddress(request.sender, agentId, agentName)) continue;
    if (activePrHeadCache) {
      const prHead = resolvePrHead(repoRoot, request, activePrHeadCache);
      if (prHead?.headRefName) request.branch = prHead.headRefName;
      if (prHead?.headRefOid) request.prTipSha = prHead.headRefOid;
    }
    const bypassProcessedCheck = request.isReReview && activeSessionPrNumber != null && request.prNumber === activeSessionPrNumber;
    const bypassStaleCheck = request.isReReview && activeSessionPrNumber != null && request.prNumber === activeSessionPrNumber;
    if (!bypassStaleCheck && isStaleReviewRequest(request, repoRoot, agentName))
      continue;
    if (!bypassProcessedCheck && isAlreadyProcessed(stateDir, request))
      continue;
    requests.push(request);
  }
  requests.sort((a, b) => {
    if (a.isReReview !== b.isReReview) {
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
  return requests;
}
var REVIEW_KEYWORDS, REREVIEW_KEYWORDS, PR_NUMBER_PATTERNS, PR_HEAD_CACHE_REVALIDATE_MS, SEVERITY_PATTERNS, CATEGORY_PATTERNS;
var init_review = __esm({
  "src/engine/review.ts"() {
    "use strict";
    init_termination();
    REVIEW_KEYWORDS = [/리뷰\s*요청/, /review[- ]?request/i];
    REREVIEW_KEYWORDS = [/재리뷰/, /re-?review/i];
    PR_NUMBER_PATTERNS = [
      /PR\s*#?\s*(\d+)/i,
      /pull\/(\d+)/,
      /review[-_ ]?(\d+)/i
    ];
    PR_HEAD_CACHE_REVALIDATE_MS = 3e4;
    SEVERITY_PATTERNS = {
      critical: /\bcritical\b/i,
      high: /\bhigh\b/i,
      medium: /\bmedium\b/i,
      low: /\blow\b/i,
      nitpick: /\bnitpick\b/i
    };
    CATEGORY_PATTERNS = [
      "security",
      "performance",
      "correctness",
      "data-integrity",
      "error-handling",
      "code-quality",
      "style"
    ];
  }
});

// src/engine/headless-loop.ts
var headless_loop_exports = {};
__export(headless_loop_exports, {
  createHeadlessLoop: () => createHeadlessLoop,
  mergePendingRequests: () => mergePendingRequests,
  sortRequests: () => sortRequests
});
import * as fs7 from "fs";
import * as path6 from "path";
function sortRequests(requests, consecutiveReReviews) {
  const reReviewQuotaExhausted = consecutiveReReviews >= MAX_CONSECUTIVE_REREVIEWS;
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
function mergePendingRequests(queued, scanned, consecutiveReReviews) {
  const merged = /* @__PURE__ */ new Map();
  for (const request of [...queued, ...scanned]) {
    merged.set(computePendingRequestKey(request), request);
  }
  return sortRequests([...merged.values()], consecutiveReReviews);
}
function createHeadlessLoop(options) {
  const envConfig = getHeadlessEnvConfig();
  const terminationConfig = {
    ...DEFAULT_TERMINATION_CONFIG,
    maxRounds: envConfig?.maxRounds ?? DEFAULT_TERMINATION_CONFIG.maxRounds,
    qualitySeverityFloor: envConfig?.qualityFloor ?? DEFAULT_TERMINATION_CONFIG.qualitySeverityFloor
  };
  const state = {
    running: false,
    activeSession: null,
    pendingRequests: [],
    completedSessions: 0,
    lastPollAt: null
  };
  let sessionTimeouts = 0;
  let roundTimeouts = 0;
  let consecutiveReReviews = 0;
  let lastCompletionAt = null;
  const PROCESSED_MARKER_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1e3;
  const GC_INTERVAL_MS = 60 * 60 * 1e3;
  let lastGcAt = 0;
  let timer = null;
  const prHeadCache = /* @__PURE__ */ new Map();
  let watcher = null;
  let watchRestartTimer = null;
  const WATCH_DEBOUNCE_MS = 150;
  const WATCH_RESTART_MS = 2e3;
  let lastWatchWakeMs = 0;
  function startInboxWatcher() {
    disposeInboxWatcher();
    const inboxDir = path6.join(options.commsDir, "inbox");
    if (!fs7.existsSync(inboxDir)) {
      fs7.mkdirSync(inboxDir, { recursive: true });
    }
    try {
      watcher = fs7.watch(inboxDir, (eventType, filename) => {
        if (!filename || !filename.endsWith(".md")) return;
        if (filename.includes("headless-dispatch-")) return;
        const now = Date.now();
        if (now - lastWatchWakeMs < WATCH_DEBOUNCE_MS) return;
        lastWatchWakeMs = now;
        log2(`fs.watch wake: ${eventType} ${filename}`);
        pollOnce();
      });
      watcher.on("error", (error) => {
        log2(
          `fs.watch error: ${error instanceof Error ? error.message : String(error)}`
        );
        scheduleWatchRestart("error");
      });
      watcher.on("close", () => {
        scheduleWatchRestart("close");
      });
      log2("fs.watch active on inbox");
    } catch (error) {
      log2(
        `fs.watch start failed: ${error instanceof Error ? error.message : String(error)}`
      );
      scheduleWatchRestart("start-failed");
    }
  }
  function disposeInboxWatcher() {
    if (!watcher) return;
    watcher.removeAllListeners();
    try {
      watcher.close();
    } catch {
    }
    watcher = null;
  }
  function scheduleWatchRestart(reason) {
    if (watchRestartTimer) return;
    log2(`fs.watch restart scheduled (${reason})`);
    watchRestartTimer = setTimeout(() => {
      watchRestartTimer = null;
      if (!state.running) return;
      startInboxWatcher();
    }, WATCH_RESTART_MS);
    if (watchRestartTimer.unref) watchRestartTimer.unref();
  }
  function log2(msg) {
    const ts = (/* @__PURE__ */ new Date()).toISOString();
    console.error(`[${ts}] [headless-loop] ${msg}`);
  }
  function dispatchSender() {
    return "headless";
  }
  function dispatchSubject(prNumber, round) {
    return round == null ? `headless-dispatch-pr${prNumber}` : `headless-dispatch-pr${prNumber}-r${round}`;
  }
  function dispatchFilename(prNumber, round) {
    const date = (/* @__PURE__ */ new Date()).toISOString().split("T")[0].replace(/-/g, "");
    return `${date}-${dispatchSender()}-${options.agentName}-${dispatchSubject(prNumber, round)}.md`;
  }
  function dispatchFileMatch(prNumber) {
    return `-${dispatchSender()}-${options.agentName}-headless-dispatch-pr${prNumber}`;
  }
  function computeOldestPendingMs() {
    if (state.pendingRequests.length === 0) return null;
    const oldest = Math.min(
      ...state.pendingRequests.map((r) => r.requestTimestampMs)
    );
    return Date.now() - oldest;
  }
  function computeActiveSessionAgeMs() {
    if (!state.activeSession) return null;
    return Date.now() - new Date(state.activeSession.startedAt).getTime();
  }
  function countProcessedMarkers() {
    const markerDir = path6.join(options.stateDir, "processed");
    if (!fs7.existsSync(markerDir)) return 0;
    try {
      return fs7.readdirSync(markerDir).filter((f) => f.endsWith(".done")).length;
    } catch {
      return 0;
    }
  }
  function maybeGcProcessedMarkers() {
    const now = Date.now();
    if (now - lastGcAt < GC_INTERVAL_MS) return;
    lastGcAt = now;
    gcProcessedMarkers();
  }
  function gcProcessedMarkers() {
    const markerDir = path6.join(options.stateDir, "processed");
    if (!fs7.existsSync(markerDir)) return 0;
    const now = Date.now();
    let removed = 0;
    try {
      for (const file of fs7.readdirSync(markerDir)) {
        if (!file.endsWith(".done")) continue;
        const filePath = path6.join(markerDir, file);
        try {
          const age = now - fs7.statSync(filePath).mtimeMs;
          if (age > PROCESSED_MARKER_MAX_AGE_MS) {
            fs7.unlinkSync(filePath);
            removed++;
          }
        } catch {
        }
      }
    } catch {
    }
    if (removed > 0)
      log2(`GC: removed ${removed} stale processed markers (>7d)`);
    return removed;
  }
  function writeStateFile() {
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
          round: request.round
        })),
        activeReview: state.activeSession ? {
          prNumber: state.activeSession.request.prNumber,
          round: state.activeSession.rounds.length + 1,
          startedAt: state.activeSession.startedAt,
          sender: state.activeSession.request.sender
        } : null,
        terminationConfig: {
          maxRounds: terminationConfig.maxRounds,
          qualitySeverityFloor: terminationConfig.qualitySeverityFloor
        },
        // M326: Operational metrics for queue health monitoring
        metrics: {
          oldestPendingMs: computeOldestPendingMs(),
          activeSessionAgeMs: computeActiveSessionAgeMs(),
          lastCompletionAt,
          sessionTimeouts,
          roundTimeouts,
          consecutiveReReviews,
          processedMarkerCount: countProcessedMarkers()
        },
        updatedAt: (/* @__PURE__ */ new Date()).toISOString()
      };
      const filePath = path6.join(options.stateDir, "headless-state.json");
      const tmp = `${filePath}.tmp.${process.pid}`;
      fs7.writeFileSync(tmp, JSON.stringify(payload, null, 2), "utf-8");
      fs7.renameSync(tmp, filePath);
    } catch {
    }
  }
  function requestStillEligible(request) {
    if (!fs7.existsSync(request.sourcePath)) return false;
    const bypassProcessedCheck = request.isReReview && state.activeSession?.request.prNumber === request.prNumber;
    if (!bypassProcessedCheck && isAlreadyProcessed(options.stateDir, request))
      return false;
    const bypassStaleCheck = request.isReReview && state.activeSession?.request.prNumber === request.prNumber;
    if (!bypassStaleCheck && isStaleReviewRequest(request, options.repoRoot, options.agentName))
      return false;
    return true;
  }
  function refreshPendingQueue() {
    const queued = state.pendingRequests.filter(requestStillEligible);
    const scanned = scanInboxForReviews(
      options.commsDir,
      options.stateDir,
      options.repoRoot,
      options.generation,
      options.agentName,
      options.agentId,
      state.activeSession?.request.prNumber ?? null,
      prHeadCache
    );
    state.pendingRequests = mergePendingRequests(
      queued,
      scanned,
      consecutiveReReviews
    );
  }
  function pollOnce() {
    if (!state.running) return;
    state.lastPollAt = (/* @__PURE__ */ new Date()).toISOString();
    maybeGcProcessedMarkers();
    refreshPendingQueue();
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
    const request = state.pendingRequests.shift();
    if (!request) {
      writeStateFile();
      return;
    }
    startReviewSession(request);
    writeStateFile();
  }
  function startReviewSession(request) {
    log2(`Starting review for PR #${request.prNumber}`);
    markAsProcessed(options.stateDir, request);
    try {
      writeReviewReceipt(options.commsDir, request, options.agentName);
      const prompt = buildReviewPrompt(request, options.agentName, 1);
      const inboxDir = path6.join(options.commsDir, "inbox");
      fs7.mkdirSync(inboxDir, { recursive: true });
      const dispatchFile = path6.join(
        inboxDir,
        dispatchFilename(request.prNumber)
      );
      const tmp = `${dispatchFile}.tmp.${process.pid}`;
      fs7.writeFileSync(tmp, prompt, "utf-8");
      fs7.renameSync(tmp, dispatchFile);
      state.activeSession = {
        request,
        agentName: options.agentName,
        role: envConfig?.role ?? "reviewer",
        rounds: [],
        startedAt: (/* @__PURE__ */ new Date()).toISOString(),
        reviewFilePath: reviewFilePath(
          options.repoRoot,
          request.generation,
          request.prNumber,
          options.agentName
        )
      };
      log2(`Dispatched review prompt for PR #${request.prNumber} (round 1)`);
    } catch (err) {
      log2(
        `Failed to start review for PR #${request.prNumber}: ${err instanceof Error ? err.message : String(err)}`
      );
      unmarkProcessed(options.stateDir, request);
    }
  }
  function checkActiveSession() {
    if (!state.activeSession) return;
    const session = state.activeSession;
    const revPath = session.reviewFilePath;
    let hasNewOutput = false;
    if (fs7.existsSync(revPath)) {
      const stat = fs7.statSync(revPath);
      const lastRound = session.rounds[session.rounds.length - 1];
      const lastCheck = lastRound?.timestamp ?? session.startedAt;
      hasNewOutput = stat.mtime.toISOString() > lastCheck;
    }
    if (hasNewOutput) {
      const roundNum = session.rounds.length + 1;
      const round = parseReviewOutput(revPath, roundNum);
      if (!round) return;
      session.rounds.push(round);
      log2(
        `PR #${session.request.prNumber} round ${roundNum}: ${round.findingCount} findings, ${round.suggestedDiffLines} suggested diff lines`
      );
      const stopSignalPath = path6.join(options.stateDir, "stop-signal");
      const ctx = {
        round: roundNum,
        rounds: session.rounds,
        stopSignalPath,
        config: terminationConfig
      };
      const result = evaluate(ctx);
      if (result.verdict === "stop") {
        log2(
          `PR #${session.request.prNumber} terminated: ${result.reason} (${result.strategy})`
        );
        completeSession(session);
      } else {
        log2(
          `PR #${session.request.prNumber} continues to round ${roundNum + 1}`
        );
        dispatchFollowUp(session, roundNum + 1);
      }
      return;
    }
    const SESSION_TIMEOUT_MS = 10 * 60 * 1e3;
    const elapsed = Date.now() - new Date(session.startedAt).getTime();
    if (elapsed > SESSION_TIMEOUT_MS && session.rounds.length === 0) {
      log2(
        `PR #${session.request.prNumber} timed out \u2014 no output after ${Math.round(elapsed / 6e4)}min. Releasing session.`
      );
      sessionTimeouts++;
      state.activeSession = null;
      return;
    }
    const ROUND_TIMEOUT_MS = 5 * 60 * 1e3;
    if (session.rounds.length > 0) {
      const lastRoundTime = new Date(
        session.rounds[session.rounds.length - 1].timestamp
      ).getTime();
      if (Date.now() - lastRoundTime > ROUND_TIMEOUT_MS) {
        log2(
          `PR #${session.request.prNumber} round timeout \u2014 no new output after ${Math.round((Date.now() - lastRoundTime) / 6e4)}min. Completing session.`
        );
        roundTimeouts++;
        completeSession(session);
        return;
      }
    }
  }
  function dispatchFollowUp(session, round) {
    const prompt = buildReviewPrompt(session.request, options.agentName, round);
    const inboxDir = path6.join(options.commsDir, "inbox");
    fs7.mkdirSync(inboxDir, { recursive: true });
    const dispatchFile = path6.join(
      inboxDir,
      dispatchFilename(session.request.prNumber, round)
    );
    const tmp = `${dispatchFile}.tmp.${process.pid}`;
    fs7.writeFileSync(tmp, prompt, "utf-8");
    fs7.renameSync(tmp, dispatchFile);
  }
  function completeSession(session) {
    session.terminatedAt = (/* @__PURE__ */ new Date()).toISOString();
    lastCompletionAt = session.terminatedAt;
    if (session.request.isReReview) {
      consecutiveReReviews++;
    } else {
      consecutiveReReviews = 0;
    }
    const inboxDir = path6.join(options.commsDir, "inbox");
    if (fs7.existsSync(inboxDir)) {
      const prefix = dispatchFileMatch(session.request.prNumber);
      const files = fs7.readdirSync(inboxDir).filter((f) => f.includes(prefix));
      for (const f of files) {
        fs7.unlinkSync(path6.join(inboxDir, f));
      }
    }
    state.activeSession = null;
    state.completedSessions++;
    log2(
      `PR #${session.request.prNumber} review complete (${session.rounds.length} rounds)`
    );
  }
  return {
    start() {
      if (!isHeadlessReviewer()) {
        log2("Not in headless mode \u2014 loop not started");
        return;
      }
      state.running = true;
      log2(
        `Headless review loop started (${envConfig?.role ?? "reviewer"}, poll ${options.pollIntervalMs}ms, max ${terminationConfig.maxRounds} rounds)`
      );
      gcProcessedMarkers();
      lastGcAt = Date.now();
      writeStateFile();
      pollOnce();
      startInboxWatcher();
      timer = setInterval(pollOnce, options.pollIntervalMs);
    },
    stop() {
      state.running = false;
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      disposeInboxWatcher();
      if (watchRestartTimer) {
        clearTimeout(watchRestartTimer);
        watchRestartTimer = null;
      }
      writeStateFile();
      log2("Headless review loop stopped");
    },
    getState() {
      return { ...state };
    }
  };
}
var MAX_CONSECUTIVE_REREVIEWS;
var init_headless_loop = __esm({
  "src/engine/headless-loop.ts"() {
    "use strict";
    init_review();
    init_termination();
    MAX_CONSECUTIVE_REREVIEWS = 3;
  }
});

// src/bridges/codex-bridge-runner.ts
import * as fs8 from "fs";
import * as path7 from "path";
import { spawn } from "child_process";
import { fileURLToPath, pathToFileURL } from "url";

// src/config/resolve.ts
import * as fs2 from "fs";
import * as path2 from "path";

// src/utils.ts
import * as fs from "fs";
import * as path from "path";
function normalizeTapPath(input, platform = process.platform) {
  const trimmed = input.trim().replace(/^["'`]+|["'`]+$/g, "");
  if (/^[A-Za-z]:[\\/]/.test(trimmed)) {
    return trimmed;
  }
  if (platform === "win32") {
    const match = trimmed.match(/^\/([A-Za-z])\/(.*)$/);
    if (match) {
      return `${match[1].toUpperCase()}:\\${match[2].replace(/\//g, "\\")}`;
    }
  }
  return trimmed;
}
var _noGitWarned = false;
function _setNoGitWarned() {
  _noGitWarned = true;
}
var _jsonMode = false;
function log(message) {
  if (!_jsonMode) console.log(`  ${message}`);
}

// src/config/resolve.ts
var SHARED_CONFIG_FILE = "tap-config.json";
var LOCAL_CONFIG_FILE = "tap-config.local.json";
var LEGACY_CONFIG_FILE = ".tap-config";
var DEFAULT_RUNTIME_COMMAND = "node";
var DEFAULT_APP_SERVER_URL = "ws://127.0.0.1:4501";
function findRepoRoot(startDir = process.cwd()) {
  let dir = path2.resolve(startDir);
  while (true) {
    if (fs2.existsSync(path2.join(dir, ".git"))) return dir;
    if (fs2.existsSync(path2.join(dir, "package.json"))) {
      if (!_noGitWarned) {
        _setNoGitWarned();
        log(
          "No .git directory found. Resolved tap root via package.json. That's fine outside git; use --comms-dir to choose a different comms location."
        );
      }
      return dir;
    }
    const parent = path2.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  if (!_noGitWarned) {
    _setNoGitWarned();
    log(
      "No git repository or package.json found. Using the current directory as tap root. That's fine outside git; use --comms-dir to choose a different comms location."
    );
  }
  return process.cwd();
}
function loadJsonFile(filePath) {
  if (!fs2.existsSync(filePath)) return null;
  try {
    const raw = fs2.readFileSync(filePath, "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
function loadSharedConfig(repoRoot) {
  return loadJsonFile(path2.join(repoRoot, SHARED_CONFIG_FILE));
}
function loadLocalConfig(repoRoot) {
  return loadJsonFile(path2.join(repoRoot, LOCAL_CONFIG_FILE));
}
function readLegacyShellValue(configText, key) {
  const match = configText.match(new RegExp(`^${key}="?(.+?)"?$`, "m"));
  return match?.[1]?.trim() || null;
}
function loadLegacyShellConfig(repoRoot) {
  const filePath = path2.join(repoRoot, LEGACY_CONFIG_FILE);
  if (!fs2.existsSync(filePath)) return null;
  try {
    const raw = fs2.readFileSync(filePath, "utf-8");
    const commsDir = readLegacyShellValue(raw, "TAP_COMMS_DIR");
    if (!commsDir) return null;
    return { commsDir };
  } catch {
    return null;
  }
}
function resolveConfig(overrides = {}, startDir) {
  const repoRoot = findRepoRoot(startDir);
  const shared = loadSharedConfig(repoRoot) ?? {};
  const local = loadLocalConfig(repoRoot) ?? {};
  const legacy = loadLegacyShellConfig(repoRoot) ?? {};
  const sources = {
    repoRoot: "auto",
    commsDir: "auto",
    stateDir: "auto",
    runtimeCommand: "auto",
    appServerUrl: "auto",
    towerName: "auto",
    remoteAgents: "auto",
    portMap: "auto"
  };
  let commsDir;
  if (overrides.commsDir) {
    commsDir = resolvePath(repoRoot, overrides.commsDir);
    sources.commsDir = "cli-flag";
  } else if (process.env.TAP_COMMS_DIR) {
    commsDir = resolvePath(repoRoot, process.env.TAP_COMMS_DIR);
    sources.commsDir = "env";
  } else if (local.commsDir) {
    commsDir = resolvePath(repoRoot, local.commsDir);
    sources.commsDir = "local-config";
  } else if (shared.commsDir) {
    commsDir = resolvePath(repoRoot, shared.commsDir);
    sources.commsDir = "shared-config";
  } else if (legacy.commsDir) {
    commsDir = resolvePath(repoRoot, legacy.commsDir);
    sources.commsDir = "legacy-shell-config";
  } else {
    commsDir = path2.join(repoRoot, "tap-comms");
  }
  let stateDir;
  if (overrides.stateDir) {
    stateDir = resolvePath(repoRoot, overrides.stateDir);
    sources.stateDir = "cli-flag";
  } else if (process.env.TAP_STATE_DIR) {
    stateDir = resolvePath(repoRoot, process.env.TAP_STATE_DIR);
    sources.stateDir = "env";
  } else if (local.stateDir) {
    stateDir = resolvePath(repoRoot, local.stateDir);
    sources.stateDir = "local-config";
  } else if (shared.stateDir) {
    stateDir = resolvePath(repoRoot, shared.stateDir);
    sources.stateDir = "shared-config";
  } else {
    stateDir = path2.join(repoRoot, ".tap-comms");
  }
  let runtimeCommand;
  if (overrides.runtimeCommand) {
    runtimeCommand = overrides.runtimeCommand;
    sources.runtimeCommand = "cli-flag";
  } else if (process.env.TAP_RUNTIME_COMMAND) {
    runtimeCommand = process.env.TAP_RUNTIME_COMMAND;
    sources.runtimeCommand = "env";
  } else if (local.runtimeCommand) {
    runtimeCommand = local.runtimeCommand;
    sources.runtimeCommand = "local-config";
  } else if (shared.runtimeCommand) {
    runtimeCommand = shared.runtimeCommand;
    sources.runtimeCommand = "shared-config";
  } else {
    runtimeCommand = DEFAULT_RUNTIME_COMMAND;
  }
  let appServerUrl;
  if (overrides.appServerUrl) {
    appServerUrl = overrides.appServerUrl;
    sources.appServerUrl = "cli-flag";
  } else if (process.env.TAP_APP_SERVER_URL) {
    appServerUrl = process.env.TAP_APP_SERVER_URL;
    sources.appServerUrl = "env";
  } else if (local.appServerUrl) {
    appServerUrl = local.appServerUrl;
    sources.appServerUrl = "local-config";
  } else if (shared.appServerUrl) {
    appServerUrl = shared.appServerUrl;
    sources.appServerUrl = "shared-config";
  } else {
    appServerUrl = DEFAULT_APP_SERVER_URL;
  }
  const towerName = local.towerName ?? shared.towerName ?? null;
  const remoteAgents = [
    ...shared.remoteAgents ?? [],
    ...local.remoteAgents ?? []
  ];
  const portMap = {};
  if (shared.portMap) {
    Object.assign(portMap, shared.portMap);
    sources.portMap = "shared-config";
  }
  if (local.portMap) {
    Object.assign(portMap, local.portMap);
    sources.portMap = "local-config";
  }
  return {
    config: {
      repoRoot,
      commsDir,
      stateDir,
      runtimeCommand,
      appServerUrl,
      towerName,
      remoteAgents,
      portMap
    },
    sources
  };
}
function resolvePath(repoRoot, p) {
  const normalized = normalizeTapPath(p);
  return path2.isAbsolute(normalized) ? normalized : path2.resolve(repoRoot, normalized);
}

// src/runtime/resolve-node.ts
import * as fs3 from "fs";
import * as path3 from "path";
import { execSync } from "child_process";
function readNodeVersion(repoRoot) {
  const nvFile = path3.join(repoRoot, ".node-version");
  if (!fs3.existsSync(nvFile)) return null;
  try {
    const raw = fs3.readFileSync(nvFile, "utf-8").trim();
    return raw.length > 0 ? raw.replace(/^v/, "") : null;
  } catch {
    return null;
  }
}
function fnmCandidateDirs() {
  if (process.platform === "win32") {
    return [
      process.env.FNM_DIR,
      process.env.APPDATA ? path3.join(process.env.APPDATA, "fnm") : null,
      process.env.LOCALAPPDATA ? path3.join(process.env.LOCALAPPDATA, "fnm") : null,
      process.env.USERPROFILE ? path3.join(process.env.USERPROFILE, "scoop", "persist", "fnm") : null
    ].filter(Boolean);
  }
  return [
    process.env.FNM_DIR,
    process.env.HOME ? path3.join(process.env.HOME, ".local", "share", "fnm") : null,
    process.env.HOME ? path3.join(process.env.HOME, ".fnm") : null,
    process.env.XDG_DATA_HOME ? path3.join(process.env.XDG_DATA_HOME, "fnm") : null
  ].filter(Boolean);
}
function nodeExecutableName() {
  return process.platform === "win32" ? "node.exe" : "node";
}
function probeFnmNode(desiredVersion) {
  const dirs = fnmCandidateDirs();
  const exe = nodeExecutableName();
  for (const baseDir of dirs) {
    const candidate = path3.join(
      baseDir,
      "node-versions",
      `v${desiredVersion}`,
      "installation",
      exe
    );
    if (!fs3.existsSync(candidate)) continue;
    try {
      const v = execSync(`"${candidate}" --version`, {
        encoding: "utf-8",
        timeout: 5e3
      }).trim();
      if (v.startsWith(`v${desiredVersion.split(".")[0]}.`)) {
        return candidate;
      }
    } catch {
    }
  }
  return null;
}
function detectNodeMajorVersion(command) {
  try {
    const version = execSync(`"${command}" --version`, {
      encoding: "utf-8",
      timeout: 5e3
    }).trim();
    const match = version.match(/^v?(\d+)\./);
    return match ? parseInt(match[1], 10) : null;
  } catch {
    return null;
  }
}
function checkStripTypesSupport(command) {
  const major = detectNodeMajorVersion(command);
  if (major !== null && major >= 22) return true;
  try {
    execSync(`"${command}" --experimental-strip-types -e ""`, {
      timeout: 5e3,
      stdio: "pipe"
    });
    return true;
  } catch {
    return false;
  }
}
function findTsxFallback(repoRoot) {
  const candidates = [
    path3.join(repoRoot, "node_modules", ".bin", "tsx.exe"),
    path3.join(repoRoot, "node_modules", ".bin", "tsx.CMD"),
    path3.join(repoRoot, "node_modules", ".bin", "tsx")
  ];
  for (const c of candidates) {
    if (fs3.existsSync(c)) return c;
  }
  return null;
}
function getFnmBinDir(repoRoot) {
  const desiredVersion = readNodeVersion(repoRoot);
  if (!desiredVersion) return null;
  const nodePath = probeFnmNode(desiredVersion);
  if (!nodePath) return null;
  return path3.dirname(nodePath);
}
function resolveNodeRuntime(configCommand, repoRoot) {
  if (configCommand === "bun" || configCommand.endsWith("bun.exe")) {
    return {
      command: configCommand,
      supportsStripTypes: false,
      source: "bun",
      majorVersion: null
    };
  }
  const desiredVersion = readNodeVersion(repoRoot);
  if (desiredVersion) {
    const fnmNode = probeFnmNode(desiredVersion);
    if (fnmNode) {
      const major2 = detectNodeMajorVersion(fnmNode);
      return {
        command: fnmNode,
        supportsStripTypes: checkStripTypesSupport(fnmNode),
        source: "fnm",
        majorVersion: major2
      };
    }
  }
  const major = detectNodeMajorVersion(configCommand);
  if (major !== null) {
    return {
      command: configCommand,
      supportsStripTypes: checkStripTypesSupport(configCommand),
      source: major === detectNodeMajorVersion("node") ? "path" : "config",
      majorVersion: major
    };
  }
  const tsx = findTsxFallback(repoRoot);
  if (tsx) {
    return {
      command: tsx,
      supportsStripTypes: false,
      source: "tsx-fallback",
      majorVersion: null
    };
  }
  return {
    command: configCommand,
    supportsStripTypes: false,
    source: "path",
    majorVersion: null
  };
}
function buildRuntimeEnv(repoRoot, baseEnv = process.env) {
  const fnmBin = getFnmBinDir(repoRoot);
  if (!fnmBin) return { ...baseEnv };
  const pathKey = process.platform === "win32" ? "Path" : "PATH";
  const currentPath = baseEnv[pathKey] ?? baseEnv.PATH ?? "";
  return {
    ...baseEnv,
    [pathKey]: `${fnmBin}${path3.delimiter}${currentPath}`
  };
}

// src/engine/bridge-app-server-lifecycle.ts
import * as fs4 from "fs";
import * as path4 from "path";
var DEFAULT_APP_SERVER_URL2 = "ws://127.0.0.1:4501";
function resolveAppServerUrl(baseUrl, port) {
  const resolvedBase = (baseUrl ?? DEFAULT_APP_SERVER_URL2).replace(/\/$/, "");
  if (port == null) {
    return resolvedBase;
  }
  try {
    const parsed = new URL(resolvedBase);
    parsed.port = String(port);
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return resolvedBase;
  }
}

// src/bridges/codex-bridge-runner.ts
function resolveRepoRootHintFromRunner(runnerUrl = import.meta.url, env = process.env, fileExists = fs8.existsSync) {
  const envRepoRoot = env.TAP_REPO_ROOT?.trim();
  if (envRepoRoot) {
    return path7.resolve(envRepoRoot);
  }
  let dir = path7.resolve(path7.dirname(fileURLToPath(runnerUrl)));
  while (true) {
    if (fileExists(path7.join(dir, SHARED_CONFIG_FILE))) return dir;
    if (fileExists(path7.join(dir, LOCAL_CONFIG_FILE))) return dir;
    if (fileExists(
      path7.join(dir, "scripts", "codex", "codex-app-server-bridge.ts")
    )) {
      return dir;
    }
    if (fileExists(path7.join(dir, "scripts", "codex-app-server-bridge.ts")))
      return dir;
    const parent = path7.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}
function maybeStartHeadlessLoop(repoRoot, commsDir, stateDir) {
  if (process.env.TAP_HEADLESS !== "true") return;
  Promise.resolve().then(() => (init_headless_loop(), headless_loop_exports)).then(({ createHeadlessLoop: createHeadlessLoop2 }) => {
    const agentName = process.env.TAP_AGENT_NAME ?? process.env.CODEX_TAP_AGENT_NAME ?? "reviewer";
    const agentId = process.env.TAP_AGENT_ID ?? process.env.TAP_BRIDGE_INSTANCE_ID ?? agentName;
    const generation = resolveHeadlessReviewGeneration(repoRoot, commsDir);
    const resolvedStateDir = stateDir ?? path7.join(repoRoot, ".tap-comms");
    const loop = createHeadlessLoop2({
      commsDir,
      stateDir: resolvedStateDir,
      repoRoot,
      agentId,
      agentName,
      generation,
      pollIntervalMs: 3e3
      // Poll faster than generic bridge (5s) for review priority
    });
    loop.start();
    process.on("SIGTERM", () => loop.stop());
    process.on("SIGINT", () => loop.stop());
  }).catch((err) => {
    console.error("[headless-loop] Failed to start:", err);
  });
}
function resolveHeadlessReviewGeneration(repoRoot, commsDir, env = process.env) {
  const explicit = env.TAP_REVIEW_GENERATION?.trim();
  if (explicit) return explicit;
  const envGeneration = normalizeGenerationValue(env.TAP_GENERATION);
  if (envGeneration) return envGeneration;
  try {
    const reviewsDir = path7.join(repoRoot, "reviews");
    const generations = readGenerationNumbers(reviewsDir);
    if (generations.length > 0) {
      return `gen${generations[0]}`;
    }
  } catch {
  }
  const resolvedCommsDir = commsDir?.trim() || env.TAP_COMMS_DIR?.trim() || null;
  if (resolvedCommsDir) {
    const commsGenerations = [
      ...readGenerationNumbers(path7.join(resolvedCommsDir, "retros")),
      ...readGenerationNumbers(path7.join(resolvedCommsDir, "letters"))
    ].sort((a, b) => b - a);
    if (commsGenerations.length > 0) {
      return `gen${commsGenerations[0]}`;
    }
  }
  return "gen1";
}
function normalizeGenerationValue(value) {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/^gen(\d+)$/i) ?? trimmed.match(/^(\d+)$/);
  if (!match?.[1]) return null;
  return `gen${Number.parseInt(match[1], 10)}`;
}
function readGenerationNumbers(dir) {
  try {
    return fs8.readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => normalizeGenerationValue(entry.name)).filter((value) => Boolean(value)).map((value) => Number.parseInt(value.slice(3), 10)).filter(Number.isFinite).sort((a, b) => b - a);
  } catch {
    return [];
  }
}
function resolveBridgeDaemonScript(repoRoot, runnerUrl = import.meta.url, fileExists = fs8.existsSync) {
  const moduleDir = path7.dirname(fileURLToPath(runnerUrl));
  const candidates = [
    // 1. Bundled standalone/npm install
    path7.join(moduleDir, "codex-app-server-bridge.mjs"),
    // 2. Source run from monorepo package
    path7.join(moduleDir, "codex-app-server-bridge.ts"),
    // 3. Built monorepo package dist
    path7.join(
      repoRoot,
      "packages",
      "tap-comms",
      "dist",
      "bridges",
      "codex-app-server-bridge.mjs"
    ),
    // 4. Monorepo source wrapper
    path7.join(
      repoRoot,
      "packages",
      "tap-comms",
      "src",
      "bridges",
      "codex-app-server-bridge.ts"
    ),
    // 5. Monorepo scripts/codex/ subfolder
    path7.join(repoRoot, "scripts", "codex", "codex-app-server-bridge.ts"),
    // 6. Legacy monorepo root script (pre-cleanup)
    path7.join(repoRoot, "scripts", "codex-app-server-bridge.ts")
  ];
  for (const candidate of candidates) {
    if (fileExists(candidate)) {
      return candidate;
    }
  }
  return null;
}
function buildBridgeScriptArgs(scriptPath, options) {
  const args = [
    scriptPath,
    `--repo-root=${options.repoRoot}`,
    `--comms-dir=${options.commsDir}`,
    `--app-server-url=${options.appServerUrl}`
  ];
  if (options.agentName) {
    args.push(`--agent-name=${options.agentName}`);
  }
  if (options.gatewayTokenFile) {
    args.push(`--gateway-token-file=${options.gatewayTokenFile}`);
  }
  if (options.stateDir) {
    args.push(`--state-dir=${options.stateDir}`);
  }
  return args;
}
function buildBridgeDaemonEnv(parentEnv, runtimeEnv) {
  return {
    ...parentEnv,
    ...runtimeEnv
  };
}
function normalizeRoutingSlot(value) {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === "tower") return "tower";
  if (normalized === "reviewer") return "reviewer";
  const worktreeMatch = normalized.match(/^wt[-_]?(\d+)$/);
  if (worktreeMatch) {
    return `wt-${Number.parseInt(worktreeMatch[1], 10)}`;
  }
  return null;
}
function resolveBridgeRoutingSlot(repoRoot, env = process.env) {
  const explicit = normalizeRoutingSlot(env.TAP_ROUTING_SLOT);
  if (explicit) return explicit;
  const instanceId = env.TAP_INSTANCE_ID?.trim() || env.TAP_BRIDGE_INSTANCE_ID?.trim() || "";
  const normalizedInstance = instanceId.toLowerCase().replace(/_/g, "-");
  if (normalizedInstance === "tower" || normalizedInstance === "claude-main" || normalizedInstance === "codex-main") {
    return "tower";
  }
  if (normalizedInstance === "reviewer" || normalizedInstance === "claude-reviewer" || normalizedInstance === "codex-reviewer") {
    return "reviewer";
  }
  if (/^(?:(?:claude|codex)-)?wt-?(\d+)$/.test(normalizedInstance)) {
    return normalizeRoutingSlot(
      normalizedInstance.replace(/^(?:claude|codex)-/, "")
    );
  }
  return normalizeRoutingSlot(path7.basename(repoRoot));
}
async function main() {
  const repoRootHint = resolveRepoRootHintFromRunner() ?? void 0;
  const { config } = resolveConfig({}, repoRootHint);
  const repoRoot = config.repoRoot;
  const commsDir = config.commsDir;
  const instancePortRaw = process.env.TAP_BRIDGE_PORT;
  const instancePort = instancePortRaw ? Number.parseInt(instancePortRaw, 10) : void 0;
  const envAppServerUrl = process.env.CODEX_APP_SERVER_URL?.trim();
  const gatewayTokenFile = process.env.TAP_GATEWAY_TOKEN_FILE?.trim();
  const appServerUrl = envAppServerUrl || resolveAppServerUrl(
    config.appServerUrl,
    Number.isFinite(instancePort) ? instancePort : void 0
  );
  const instanceId = process.env.TAP_BRIDGE_INSTANCE_ID;
  const envStateDir = process.env.TAP_RUNTIME_STATE_DIR;
  let stateDir;
  if (envStateDir) {
    stateDir = envStateDir;
  } else if (instanceId) {
    const resolved2 = path7.resolve(
      path7.join(repoRoot, ".tmp", `codex-app-server-bridge-${instanceId}`)
    );
    const expectedBase = path7.resolve(repoRoot, ".tmp") + path7.sep;
    if (!resolved2.startsWith(expectedBase)) {
      throw new Error(
        `Path traversal blocked: runtime state dir escapes .tmp/ directory`
      );
    }
    stateDir = resolved2;
  }
  const preResolved = process.env.TAP_RESOLVED_NODE;
  const resolved = preResolved ? {
    command: preResolved,
    supportsStripTypes: process.env.TAP_STRIP_TYPES === "1",
    source: "env",
    majorVersion: null
  } : resolveNodeRuntime(config.runtimeCommand, repoRoot);
  const command = resolved.command;
  const agentName = process.env.TAP_AGENT_NAME?.trim() || process.env.CODEX_TAP_AGENT_NAME?.trim() || void 0;
  const scriptPath = resolveBridgeDaemonScript(repoRoot);
  if (!scriptPath) {
    throw new Error(
      `Bridge script not found for repo root ${repoRoot}.
Expected a packaged dist/bridges/codex-app-server-bridge.mjs or monorepo bridge script.`
    );
  }
  const args = [];
  if (resolved.supportsStripTypes) {
    args.push("--experimental-strip-types");
  }
  args.push(
    ...buildBridgeScriptArgs(scriptPath, {
      repoRoot,
      commsDir,
      appServerUrl,
      gatewayTokenFile,
      stateDir,
      agentName
    })
  );
  const busyMode = process.env.TAP_BUSY_MODE;
  if (busyMode) args.push(`--busy-mode=${busyMode}`);
  const pollSeconds = process.env.TAP_POLL_SECONDS;
  if (pollSeconds) args.push(`--poll-seconds=${pollSeconds}`);
  const reconnectSeconds = process.env.TAP_RECONNECT_SECONDS;
  if (reconnectSeconds) args.push(`--reconnect-seconds=${reconnectSeconds}`);
  const lookbackMinutes = process.env.TAP_MESSAGE_LOOKBACK_MINUTES;
  if (lookbackMinutes)
    args.push(`--message-lookback-minutes=${lookbackMinutes}`);
  const threadId = process.env.TAP_THREAD_ID;
  if (threadId) args.push(`--thread-id=${threadId}`);
  if (process.env.TAP_EPHEMERAL === "true") args.push("--ephemeral");
  if (process.env.TAP_PROCESS_EXISTING === "true")
    args.push("--process-existing-messages");
  const runtimeEnv = buildRuntimeEnv(repoRoot);
  const daemonEnv = buildBridgeDaemonEnv(process.env, runtimeEnv);
  const routingSlot = resolveBridgeRoutingSlot(repoRoot, daemonEnv);
  if (routingSlot && !daemonEnv.TAP_ROUTING_SLOT) {
    daemonEnv.TAP_ROUTING_SLOT = routingSlot;
  }
  const child = spawn(command, args, {
    cwd: repoRoot,
    env: daemonEnv,
    stdio: "inherit"
  });
  maybeStartHeadlessLoop(repoRoot, commsDir, stateDir);
  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 0);
  });
  child.on("error", (error) => {
    console.error(String(error));
    process.exit(1);
  });
}
function isDirectExecution() {
  const entry = process.argv[1];
  if (!entry) return false;
  if (!path7.basename(entry).startsWith("codex-bridge-runner")) return false;
  return import.meta.url === pathToFileURL(path7.resolve(entry)).href;
}
if (isDirectExecution()) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
export {
  buildBridgeDaemonEnv,
  buildBridgeScriptArgs,
  resolveBridgeDaemonScript,
  resolveBridgeRoutingSlot,
  resolveHeadlessReviewGeneration,
  resolveRepoRootHintFromRunner
};
//# sourceMappingURL=codex-bridge-runner.mjs.map