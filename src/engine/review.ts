/**
 * Review engine — detects review requests, builds prompts, parses output.
 *
 * This module handles the "what" of review sessions.
 * The termination engine handles the "when to stop."
 * The bridge handles the "how to deliver."
 */
import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import type {
  ReviewFinding,
  ReviewRound,
  FindingSeverity,
  TerminationConfig,
} from "./termination.js";
import { computeFindingHash } from "./termination.js";

// ── Types ──────────────────────────────────────────────────────────

export type AgentRole = "reviewer" | "validator" | "long-running";

export interface ReviewRequest {
  sourcePath: string;
  sourceMtimeMs: number;
  requestTimestampMs: number;
  sender: string;
  /** Intake matching — display name from filename, used by scanInboxForReviews filter. */
  recipient: string;
  prNumber: number;
  branch?: string;
  prTipSha?: string;
  generation: string;
  isReReview: boolean;
  round: number;
  /** M325: Stable message ID from frontmatter — primary dedupe key when present. */
  messageId?: string;
  /** M325: Logical routing target from frontmatter `to` — used in dedupe key.
   *  Separate from `recipient` (intake) to avoid breaking scan filters. */
  dedupeRecipient?: string;
}

export interface ReviewSession {
  request: ReviewRequest;
  agentName: string;
  role: AgentRole;
  rounds: ReviewRound[];
  startedAt: string;
  terminatedAt?: string;
  reviewFilePath: string;
}

export interface ReviewEngineConfig {
  role: AgentRole;
  generation: string;
  commsDir: string;
  repoRoot: string;
  agentName: string;
  termination: TerminationConfig;
}

export interface HeadlessConfig {
  enabled: boolean;
  role: AgentRole;
  termination: TerminationConfig;
}

// ── Request Detection ──────────────────────────────────────────────

const REVIEW_KEYWORDS = [/리뷰\s*요청/, /review[- ]?request/i];

const REREVIEW_KEYWORDS = [/재리뷰/, /re-?review/i];

const PR_NUMBER_PATTERNS = [
  /PR\s*#?\s*(\d+)/i,
  /pull\/(\d+)/,
  /review[-_ ]?(\d+)/i,
];

function trimAddress(value: string): string {
  return value.trim();
}

function canonicalizeAgentId(value: string): string {
  return trimAddress(value).replace(/-/g, "_").toLowerCase();
}

export function isOwnMessageAddress(
  sender: string,
  agentId: string,
  agentName: string,
): boolean {
  const normalizedSender = trimAddress(sender);
  if (!normalizedSender) return false;

  return (
    canonicalizeAgentId(normalizedSender) === canonicalizeAgentId(agentId) ||
    normalizedSender.toLowerCase() === trimAddress(agentName).toLowerCase()
  );
}

/**
 * Parse inbox filename to extract routing info.
 * Format: YYYYMMDD-sender-recipient-subject.md
 */
export function parseInboxFilename(filename: string): {
  date: string;
  sender: string;
  recipient: string;
  subject: string;
} | null {
  const base = path.basename(filename, ".md");
  const match = base.match(/^(\d{8})-([^-]+)-([^-]+)-(.+)$/);
  if (!match) return null;

  return {
    date: match[1],
    sender: match[2],
    recipient: match[3],
    subject: match[4],
  };
}

/**
 * Extract PR number from text content.
 */
export function extractPrNumber(text: string): number | null {
  for (const pattern of PR_NUMBER_PATTERNS) {
    const match = text.match(pattern);
    if (match?.[1]) return parseInt(match[1], 10);
  }
  return null;
}

// ── Inbox Frontmatter ─────────────────────────────────────────────

/**
 * Parse inbox message frontmatter once, returning all fields needed
 * by detection and timestamp extraction. Single parse point avoids
 * regex duplication across detectReviewRequest / extractRequestTimestampMs.
 */
interface InboxFrontmatter {
  sent_at?: string;
  message_id?: string;
  to?: string;
}

interface PullRequestHead {
  headRefName?: string;
  headRefOid?: string;
}

interface PrHeadCacheEntry {
  value: PullRequestHead | null;
  checkedAtMs: number;
}

export type PrHeadCache = Map<string, PrHeadCacheEntry>;
const PR_HEAD_CACHE_REVALIDATE_MS = 30_000;

export function computePendingRequestKey(request: ReviewRequest): string {
  return request.messageId
    ? `message:${request.messageId}`
    : `source:${request.sourcePath}`;
}

function parseInboxContentFrontmatter(
  content: string,
): InboxFrontmatter | null {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match?.[1]) return null;

  const fields: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const kv = line.match(/^(\w+):\s*(.+)$/);
    if (kv?.[1] && kv[2]) fields[kv[1]] = kv[2].trim();
  }

  return {
    sent_at: fields.sent_at,
    message_id: fields.message_id,
    to: fields.to,
  };
}

// ── Request Detection ─────────────────────────────────────────────

/**
 * Detect if a file represents a review request.
 * Returns a ReviewRequest if detected, null otherwise.
 */
export function detectReviewRequest(
  filePath: string,
  content: string,
  generation: string,
): ReviewRequest | null {
  const parsed = parseInboxFilename(filePath);
  if (!parsed) return null;
  if (parsed.subject.startsWith("headless-dispatch-")) return null;

  const fullText = `${parsed.subject} ${content}`;

  // Check for review keywords
  const isReview = REVIEW_KEYWORDS.some((re) => re.test(fullText));
  const isReReview = REREVIEW_KEYWORDS.some((re) => re.test(fullText));

  if (!isReview && !isReReview) return null;

  // Extract PR number
  const prNumber = extractPrNumber(fullText);
  if (!prNumber) return null;

  const sourceMtimeMs = fs.existsSync(filePath)
    ? fs.statSync(filePath).mtimeMs
    : 0;

  // Parse frontmatter once — shared by timestamp extraction and M325 fields.
  // Single parse point: no more independent regex per field.
  const fm = parseInboxContentFrontmatter(content);

  return {
    sourcePath: filePath,
    sourceMtimeMs,
    requestTimestampMs: extractRequestTimestampMs(
      parsed.date,
      fm,
      sourceMtimeMs,
    ),
    sender: parsed.sender,
    recipient: parsed.recipient,
    prNumber,
    generation,
    isReReview,
    round: isReReview ? 2 : 1, // Will be adjusted by session tracking
    messageId: fm?.message_id || undefined,
    dedupeRecipient: fm?.to || undefined,
  };
}

function extractRequestTimestampMs(
  inboxDate: string,
  fm: InboxFrontmatter | null,
  fallbackMtimeMs: number,
): number {
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
      Number.parseInt(day, 10),
    );
  }

  return fallbackMtimeMs;
}

// ── Review Prompt ──────────────────────────────────────────────────

export function buildReviewPrompt(
  request: ReviewRequest,
  agentName: string,
  round: number,
): string {
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
    `Write review to: ${path.join("reviews", request.generation, `review-PR${request.prNumber}-${agentName}.md`)}`,
    ``,
    `### Review File Format`,
    `\`\`\`markdown`,
    `---`,
    `date: ${new Date().toISOString().split("T")[0]}`,
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
    `- [severity] [category] file:line — description`,
    ``,
    `### Medium / Low`,
    `- [severity] [category] file:line — description`,
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
    `- Commit and push comms changes`,
  ].join("\n");
}

// ── Review Output Parsing ──────────────────────────────────────────

const SEVERITY_PATTERNS: Record<FindingSeverity, RegExp> = {
  critical: /\bcritical\b/i,
  high: /\bhigh\b/i,
  medium: /\bmedium\b/i,
  low: /\blow\b/i,
  nitpick: /\bnitpick\b/i,
};

const CATEGORY_PATTERNS = [
  "security",
  "performance",
  "correctness",
  "data-integrity",
  "error-handling",
  "code-quality",
  "style",
];

/**
 * Parse frontmatter from review file.
 */
export function parseFrontmatter(
  content: string,
): Record<string, string> | null {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match?.[1]) return null;

  const fields: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const kv = line.match(/^(\w+):\s*(.+)$/);
    if (kv?.[1] && kv[2]) {
      fields[kv[1]] = kv[2].trim();
    }
  }
  return fields;
}

/**
 * Extract suggested diff lines from review content.
 */
export function extractSuggestedDiffLines(content: string): number {
  const match = content.match(/## Suggested Diff Lines\s*\n\s*(\d+)/i);
  if (match?.[1]) return parseInt(match[1], 10);

  // Fallback: count lines in code blocks that look like suggestions
  const codeBlocks = content.match(/```[\s\S]*?```/g) ?? [];
  let totalLines = 0;
  for (const block of codeBlocks) {
    totalLines += block.split("\n").length - 2; // minus fences
  }
  return totalLines;
}

/**
 * Extract findings from review content.
 * Best-effort parsing — reviews may not follow exact format.
 */
export function extractFindings(content: string): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  // Match lines that look like finding entries
  const lines = content.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("-") && !trimmed.startsWith("*")) continue;

    // Detect severity
    let severity: FindingSeverity = "medium";
    for (const [sev, pattern] of Object.entries(SEVERITY_PATTERNS)) {
      if (pattern.test(trimmed)) {
        severity = sev as FindingSeverity;
        break;
      }
    }

    // Detect category
    let category = "general";
    for (const cat of CATEGORY_PATTERNS) {
      if (trimmed.toLowerCase().includes(cat)) {
        category = cat;
        break;
      }
    }

    // Extract file:line if present
    const fileMatch = trimmed.match(/([a-zA-Z0-9_/.-]+\.[a-zA-Z]+):(\d+)/);

    // Only include if it looks like an actual finding (has severity keyword or file ref)
    const hasSeverityKeyword = Object.values(SEVERITY_PATTERNS).some((p) =>
      p.test(trimmed),
    );
    if (hasSeverityKeyword || fileMatch) {
      findings.push({
        severity,
        category,
        description: trimmed.replace(/^[-*]\s*/, "").slice(0, 200),
        file: fileMatch?.[1],
        line: fileMatch?.[2] ? parseInt(fileMatch[2], 10) : undefined,
      });
    }
  }

  return findings;
}

/**
 * Parse a review output file into a ReviewRound.
 */
export function parseReviewOutput(
  reviewFilePath: string,
  round: number,
): ReviewRound | null {
  if (!fs.existsSync(reviewFilePath)) return null;

  const content = fs.readFileSync(reviewFilePath, "utf-8");
  const findings = extractFindings(content);
  const suggestedDiffLines = extractSuggestedDiffLines(content);

  return {
    round,
    timestamp: new Date().toISOString(),
    findingCount: findings.length,
    findings,
    suggestedDiffLines,
    findingHash: computeFindingHash(findings),
  };
}

// ── Review File Path ───────────────────────────────────────────────

export function reviewFilePath(
  repoRoot: string,
  generation: string,
  prNumber: number,
  agentName: string,
): string {
  return path.join(
    repoRoot,
    "reviews",
    generation,
    `review-PR${prNumber}-${agentName}.md`,
  );
}

// ── Stale Detection ────────────────────────────────────────────────

/**
 * Check if a review request is stale (already handled).
 * Mirrors PS1 Test-IsStaleRequest logic.
 */
export function isStaleReviewRequest(
  request: ReviewRequest,
  repoRoot: string,
  agentName: string,
): boolean {
  // 1. Check if review file exists and is newer than request
  const revPath = reviewFilePath(
    repoRoot,
    request.generation,
    request.prNumber,
    agentName,
  );
  if (fs.existsSync(revPath) && fs.existsSync(request.sourcePath)) {
    const reviewStat = fs.statSync(revPath);
    const requestStat = fs.statSync(request.sourcePath);
    if (reviewStat.mtimeMs > requestStat.mtimeMs) return true;
  }

  return false;
}

function resolvePrHead(
  repoRoot: string,
  request: ReviewRequest,
  cache: PrHeadCache,
): PullRequestHead | null {
  const cacheKey = request.messageId
    ? `message:${request.messageId}`
    : `source:${request.sourcePath}:mtime:${request.sourceMtimeMs}`;

  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.checkedAtMs < PR_HEAD_CACHE_REVALIDATE_MS) {
    return cached.value;
  }

  let result: PullRequestHead | null = null;
  try {
    const command = spawnSync(
      "gh",
      [
        "pr",
        "view",
        String(request.prNumber),
        "--json",
        "headRefName,headRefOid",
      ],
      { cwd: repoRoot, encoding: "utf-8", timeout: 10_000 },
    );

    if (command.status === 0 && command.stdout.trim()) {
      const parsed = JSON.parse(command.stdout) as PullRequestHead;
      result = {
        headRefName: parsed.headRefName,
        headRefOid: parsed.headRefOid,
      };
    }
  } catch {
    result = null;
  }

  cache.set(cacheKey, {
    value: result,
    checkedAtMs: Date.now(),
  });
  return result;
}

// ── Processed Marker ───────────────────────────────────────────────

export function computeRequestMarkerId(request: ReviewRequest): string {
  const recipient = request.dedupeRecipient || request.recipient;

  // M338: PR tip is the logical review unit. Keep same-tip requests deduped
  // even when towers resend with a new message_id, but allow re-review once
  // the PR head changes.
  if (request.prTipSha) {
    return crypto
      .createHash("sha1")
      .update(
        `pr:${request.prNumber}:tip:${request.prTipSha}:recipient:${recipient}`,
      )
      .digest("hex");
  }

  // M325: Use message_id as primary dedupe key when available — stable across
  // file renames, relay copies, and sync collisions.
  // Include dedupeRecipient (logical routing target from frontmatter `to`)
  // to distinguish per-endpoint delivery. Falls back to filename recipient.
  if (request.messageId) {
    return crypto
      .createHash("sha1")
      .update(`message_id:${request.messageId}:recipient:${recipient}`)
      .digest("hex");
  }

  // Fallback: content-hash-based marker for messages without message_id
  let contentHash = "";
  try {
    const content = fs.readFileSync(request.sourcePath, "utf-8");
    contentHash = crypto.createHash("sha1").update(content).digest("hex");
  } catch {
    // Best-effort: deleted/moved request files should still produce a stable ID.
  }

  const input = JSON.stringify({
    sourcePath: request.sourcePath,
    sender: request.sender,
    recipient: request.recipient,
    prNumber: request.prNumber,
    generation: request.generation,
    isReReview: request.isReReview,
    contentHash,
  });
  return crypto.createHash("sha1").update(input).digest("hex");
}

export function isAlreadyProcessed(
  stateDir: string,
  request: ReviewRequest,
): boolean {
  const markerId = computeRequestMarkerId(request);
  return fs.existsSync(path.join(stateDir, "processed", `${markerId}.done`));
}

export function unmarkProcessed(
  stateDir: string,
  request: ReviewRequest,
): void {
  const markerId = computeRequestMarkerId(request);
  const markerPath = path.join(stateDir, "processed", `${markerId}.done`);
  if (fs.existsSync(markerPath)) {
    fs.unlinkSync(markerPath);
  }
}

export function markAsProcessed(
  stateDir: string,
  request: ReviewRequest,
): void {
  const markerId = computeRequestMarkerId(request);
  const markerDir = path.join(stateDir, "processed");
  fs.mkdirSync(markerDir, { recursive: true });
  const markerPath = path.join(markerDir, `${markerId}.done`);
  const payload = {
    prNumber: request.prNumber,
    prTipSha: request.prTipSha ?? null,
    sourcePath: request.sourcePath,
    processedAt: new Date().toISOString(),
  };
  const tmp = `${markerPath}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), "utf-8");
  fs.renameSync(tmp, markerPath);
}

// ── Bridge Receipt ─────────────────────────────────────────────────

/**
 * Write immediate inbox acknowledgment before review starts.
 * Mirrors PS1 Write-BridgeReceipt pattern.
 */
export function writeReviewReceipt(
  commsDir: string,
  request: ReviewRequest,
  agentName: string,
): string {
  const date = new Date().toISOString().split("T")[0].replace(/-/g, "");
  const filename = `${date}-${agentName}-${request.sender}-PR${request.prNumber}-ack.md`;
  const content = [
    `## ${agentName} > ${request.sender}`,
    ``,
    `- PR #${request.prNumber} review request received.`,
    `- headless reviewer processing.`,
    `- request: ${path.basename(request.sourcePath)}`,
  ].join("\n");

  const inboxDir = path.join(commsDir, "inbox");
  fs.mkdirSync(inboxDir, { recursive: true });
  const inboxPath = path.join(inboxDir, filename);
  const tmp = `${inboxPath}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, content, "utf-8");
  fs.renameSync(tmp, inboxPath);
  return inboxPath;
}

// ── Orchestrator Entry Point ───────────────────────────────────

/**
 * Check if the current bridge process is running in headless reviewer mode.
 * Reads from env vars set by engine/bridge.ts startBridge().
 */
export function isHeadlessReviewer(): boolean {
  return process.env.TAP_HEADLESS === "true";
}

/**
 * Get headless reviewer configuration from env vars.
 * Returns null if not in headless mode.
 */
export function getHeadlessEnvConfig(): {
  role: string;
  maxRounds: number;
  qualityFloor: string;
} | null {
  if (!isHeadlessReviewer()) return null;
  return {
    role: process.env.TAP_AGENT_ROLE ?? "reviewer",
    maxRounds: parseInt(process.env.TAP_MAX_REVIEW_ROUNDS ?? "5", 10),
    qualityFloor: process.env.TAP_QUALITY_FLOOR ?? "high",
  };
}

/**
 * Scan inbox for pending review requests.
 * This is the entry point for the headless review loop.
 *
 * Phase 3 will wire this into the bridge runner's poll cycle:
 * 1. scanInboxForReviews() → detect pending requests
 * 2. For each: writeReviewReceipt() → dispatch to bridge → parseReviewOutput()
 * 3. evaluate() termination → continue or stop
 */
export function scanInboxForReviews(
  commsDir: string,
  stateDir: string,
  repoRoot: string,
  generation: string,
  agentName: string,
  agentId: string = agentName,
  activeSessionPrNumber?: number | null,
  prHeadCache?: PrHeadCache,
): ReviewRequest[] {
  const inboxDir = path.join(commsDir, "inbox");
  if (!fs.existsSync(inboxDir)) return [];

  const files = fs.readdirSync(inboxDir).filter((f) => f.endsWith(".md"));
  const requests: ReviewRequest[] = [];
  const shouldResolvePrHead = fs.existsSync(path.join(repoRoot, ".git"));
  const activePrHeadCache = shouldResolvePrHead
    ? (prHeadCache ?? new Map<string, PrHeadCacheEntry>())
    : null;

  for (const file of files) {
    const filePath = path.join(inboxDir, file);
    const content = fs.readFileSync(filePath, "utf-8");
    const request = detectReviewRequest(filePath, content, generation);

    if (!request) continue;

    // Only process requests addressed to this agent or broadcast ("전체"/"all")
    const to = request.recipient.toLowerCase();
    if (
      to !== agentName.toLowerCase() &&
      to !== "전체" &&
      to !== "all" &&
      to !== ""
    ) {
      continue;
    }

    if (isOwnMessageAddress(request.sender, agentId, agentName)) continue;

    if (activePrHeadCache) {
      const prHead = resolvePrHead(repoRoot, request, activePrHeadCache);
      if (prHead?.headRefName) request.branch = prHead.headRefName;
      if (prHead?.headRefOid) request.prTipSha = prHead.headRefOid;
    }

    const bypassProcessedCheck =
      request.isReReview &&
      activeSessionPrNumber != null &&
      request.prNumber === activeSessionPrNumber;
    const bypassStaleCheck =
      request.isReReview &&
      activeSessionPrNumber != null &&
      request.prNumber === activeSessionPrNumber;
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
