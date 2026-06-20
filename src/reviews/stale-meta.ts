import * as fs from "node:fs";
import * as path from "node:path";

export type ReviewMetaOperatorStatus =
  | "new-formal-outcome"
  | "collapsed-stale-meta"
  | "provenance-only"
  | "ambiguous"
  | "not-review-meta";

export interface ReviewMetaOperatorClassification {
  status: ReviewMetaOperatorStatus;
  prNumber: number | null;
  reason: string;
  terminalEvidencePath: string | null;
}

export interface ClassifyReviewMetaForOperatorOptions {
  root: string;
  filename: string;
  subject: string;
  body: string;
  sourceRelativePath?: string | null;
}

type SeveritySummary = {
  p1: number;
  p2: number;
  p3: number;
  hasNone: boolean;
};

export function classifyReviewMetaForOperator(
  options: ClassifyReviewMetaForOperatorOptions,
): ReviewMetaOperatorClassification {
  const subject = options.subject.trim();
  const body = options.body;
  const prNumber =
    extractPrNumber(subject) ??
    extractPrNumber(options.filename) ??
    extractPrNumber(body);
  const forceReviewMeta = isProvenanceOnlyReviewMetaSubject(subject);

  if (!forceReviewMeta && isFormalReviewOutcome(subject, body)) {
    return {
      status: "new-formal-outcome",
      prNumber,
      reason: "formal review outcome remains operator-visible",
      terminalEvidencePath: null,
    };
  }

  if (!isReviewMetaSubject(subject)) {
    return {
      status: "not-review-meta",
      prNumber,
      reason: "not a review-meta subject",
      terminalEvidencePath: null,
    };
  }

  if (prNumber === null) {
    return {
      status: "ambiguous",
      prNumber,
      reason: "review-meta message has no PR number",
      terminalEvidencePath: null,
    };
  }

  const terminalEvidencePath = findTerminalEvidence({
    root: options.root,
    prNumber,
    sourceRelativePath:
      options.sourceRelativePath ?? path.posix.join("inbox", options.filename),
  });

  if (terminalEvidencePath) {
    return {
      status: "collapsed-stale-meta",
      prNumber,
      reason: "terminal review or merge evidence already exists",
      terminalEvidencePath,
    };
  }

  return {
    status: "provenance-only",
    prNumber,
    reason: "review-meta message has no known terminal evidence yet",
    terminalEvidencePath: null,
  };
}

function findTerminalEvidence(input: {
  root: string;
  prNumber: number;
  sourceRelativePath: string;
}): string | null {
  const registered = findRegisteredReviewEvidence(input.root, input.prNumber);
  if (registered) return registered;

  const sourceRelativePath = normalizeRelativePath(input.sourceRelativePath);
  for (const filePath of listMarkdownFiles(input.root, [
    "inbox",
    "archive",
    "reviews",
  ])) {
    const relativePath = normalizeRelativePath(
      path.relative(input.root, filePath),
    );
    if (relativePath === sourceRelativePath) continue;
    if (relativePath.startsWith("reviews/registered/")) continue;

    const raw = readIfExists(filePath);
    if (raw === null) continue;
    const { frontmatter, body } = splitFrontmatter(raw);
    const filename = path.basename(filePath);
    const subject =
      frontmatter.subject ?? inferSubjectFromFilename(filename) ?? filename;
    const prNumber =
      extractPrNumber(subject) ??
      extractPrNumber(filename) ??
      extractPrNumber(body);
    if (prNumber !== input.prNumber) continue;
    if (
      isFormalReviewOutcome(subject, body) ||
      isMergeTerminal(subject, body)
    ) {
      return relativePath;
    }
  }

  return null;
}

function findRegisteredReviewEvidence(
  root: string,
  prNumber: number,
): string | null {
  const directory = path.join(root, "reviews", "registered", `pr${prNumber}`);
  if (!fs.existsSync(directory)) return null;
  const candidates = listMarkdownFiles(directory, ["."])
    .map((filePath) => normalizeRelativePath(path.relative(root, filePath)))
    .sort();
  return candidates[0] ?? null;
}

function isReviewMetaSubject(subject: string): boolean {
  const normalized = subject.toLowerCase();
  return (
    isProvenanceOnlyReviewMetaSubject(subject) ||
    normalized.includes("head-still-clean") ||
    normalized.includes("merge-ready") ||
    normalized.includes("merge-confirm") ||
    normalized.includes("merge-result") ||
    normalized.includes("merged") ||
    /\b(stale|correction|status)\b/.test(normalized)
  );
}

function isProvenanceOnlyReviewMetaSubject(subject: string): boolean {
  const normalized = subject.toLowerCase();
  return (
    normalized.includes("status-correction") ||
    normalized.includes("current-head") ||
    normalized.includes("superseded") ||
    /\balready(?:[-_\s]+(?:reviewed|merged|handled|resolved|complete|closed))\b/.test(
      normalized,
    ) ||
    /\b(?:review|rereview)?[-_\s]*request[-_\s]+already\b/.test(normalized)
  );
}

function isFormalReviewOutcome(subject: string, body: string): boolean {
  const normalized = subject.toLowerCase();
  if (
    normalized.includes("review-request") ||
    normalized.includes("rereview-request")
  ) {
    return false;
  }
  const severity = summarizeSeverity(body);
  const hasSeverity =
    severity.hasNone || severity.p1 > 0 || severity.p2 > 0 || severity.p3 > 0;
  if (!hasSeverity) return false;
  return /\breview\b|\brereview\b|head-still-clean|merge-ready|closeout/.test(
    normalized,
  );
}

function isMergeTerminal(subject: string, body: string): boolean {
  return (
    /\b(?:merged|merge-result|merge result|merge-ack|merge-confirmed|merge-confirmation)\b|mergedat|merge commit|merge 완료/i.test(
      subject,
    ) ||
    /\b(?:merged|merge-result|merge result|merge-ack|merge-confirmed|merge-confirmation)\b|mergedAt|merge commit|merge 완료/i.test(
      body,
    )
  );
}

function summarizeSeverity(body: string): SeveritySummary {
  const reviewText = stripFencedCodeBlocks(body);
  if (/P1\/P2\/P3\s*[:：]\s*none/i.test(reviewText)) {
    return { p1: 0, p2: 0, p3: 0, hasNone: true };
  }
  const labels = [...reviewText.matchAll(/^\s*P([123])\b(?!\/)/gm)].map(
    (match) => `P${match[1]}`,
  );
  return {
    p1: labels.filter((label) => label === "P1").length,
    p2: labels.filter((label) => label === "P2").length,
    p3: labels.filter((label) => label === "P3").length,
    hasNone: false,
  };
}

function stripFencedCodeBlocks(text: string): string {
  return text.replace(/```[\s\S]*?```/g, "");
}

function listMarkdownFiles(root: string, areas: string[]): string[] {
  return areas.flatMap((area) => listMarkdownFilesUnder(path.join(root, area)));
}

function listMarkdownFilesUnder(directory: string): string[] {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) return listMarkdownFilesUnder(filePath);
    if (entry.isFile() && entry.name.endsWith(".md")) return [filePath];
    return [];
  });
}

function readIfExists(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

function splitFrontmatter(raw: string): {
  frontmatter: Record<string, string>;
  body: string;
} {
  if (!raw.startsWith("---\n")) return { frontmatter: {}, body: raw };
  const end = raw.indexOf("\n---", 4);
  if (end === -1) return { frontmatter: {}, body: raw };
  const frontmatter: Record<string, string> = {};
  for (const line of raw.slice(4, end).split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (match) {
      frontmatter[match[1]] = match[2].replace(/^["']|["']$/g, "").trim();
    }
  }
  return { frontmatter, body: raw.slice(end + 4) };
}

function inferSubjectFromFilename(filename: string): string | null {
  return filename.match(/^\d{8}-[^-]+-[^-]+-(.+)\.md$/)?.[1] ?? null;
}

function extractPrNumber(text: string): number | null {
  const match = text.match(/(?:PR\s*#|#|pr)(\d{3,5})/i);
  return match ? Number(match[1]) : null;
}

function normalizeRelativePath(relativePath: string): string {
  return relativePath.split(path.sep).join("/");
}
