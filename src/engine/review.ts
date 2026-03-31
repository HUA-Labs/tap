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
  sender: string;
  recipient: string;
  prNumber: number;
  branch?: string;
  generation: string;
  isReReview: boolean;
  round: number;
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

  const fullText = `${parsed.subject} ${content}`;

  // Check for review keywords
  const isReview = REVIEW_KEYWORDS.some((re) => re.test(fullText));
  const isReReview = REREVIEW_KEYWORDS.some((re) => re.test(fullText));

  if (!isReview && !isReReview) return null;

  // Extract PR number
  const prNumber = extractPrNumber(fullText);
  if (!prNumber) return null;

  return {
    sourcePath: filePath,
    sender: parsed.sender,
    recipient: parsed.recipient,
    prNumber,
    generation,
    isReReview,
    round: isReReview ? 2 : 1, // Will be adjusted by session tracking
  };
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
  commsDir: string,
  generation: string,
  prNumber: number,
  agentName: string,
): string {
  return path.join(
    commsDir,
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
  commsDir: string,
  agentName: string,
): boolean {
  // 1. Check if review file exists and is newer than request
  const revPath = reviewFilePath(
    commsDir,
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

// ── Processed Marker ───────────────────────────────────────────────

export function computeRequestMarkerId(filePath: string): string {
  const stat = fs.statSync(filePath);
  const input = `${filePath}|${stat.mtimeMs}`;
  return crypto.createHash("sha1").update(input).digest("hex");
}

export function isAlreadyProcessed(
  stateDir: string,
  filePath: string,
): boolean {
  const markerId = computeRequestMarkerId(filePath);
  return fs.existsSync(path.join(stateDir, "processed", `${markerId}.done`));
}

export function unmarkProcessed(
  stateDir: string,
  request: ReviewRequest,
): void {
  const markerId = computeRequestMarkerId(request.sourcePath);
  const markerPath = path.join(stateDir, "processed", `${markerId}.done`);
  if (fs.existsSync(markerPath)) {
    fs.unlinkSync(markerPath);
  }
}

export function markAsProcessed(
  stateDir: string,
  request: ReviewRequest,
): void {
  const markerId = computeRequestMarkerId(request.sourcePath);
  const markerDir = path.join(stateDir, "processed");
  fs.mkdirSync(markerDir, { recursive: true });
  const markerPath = path.join(markerDir, `${markerId}.done`);
  const payload = {
    prNumber: request.prNumber,
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
  generation: string,
  agentName: string,
  agentId: string = agentName,
): ReviewRequest[] {
  const inboxDir = path.join(commsDir, "inbox");
  if (!fs.existsSync(inboxDir)) return [];

  const files = fs.readdirSync(inboxDir).filter((f) => f.endsWith(".md"));
  const requests: ReviewRequest[] = [];

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

    if (isStaleReviewRequest(request, commsDir, agentName)) continue;
    if (isAlreadyProcessed(stateDir, filePath)) continue;

    requests.push(request);
  }

  return requests;
}
