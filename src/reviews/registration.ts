import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

export type ReviewRegistrationRound = "initial" | `R${number}`;
export type ReviewRegistrationOutcomeType =
  | "clean"
  | "findings"
  | "rereview-clean"
  | "rereview-findings"
  | "closeout-clean"
  | "merge-ready-clean";
export type ReviewRegistrationClassification =
  | "formal-outcome"
  | "provenance-only"
  | "not-review";
export type ReviewRegistrationStatus =
  | "planned"
  | "applied"
  | "already-registered"
  | "duplicate-source"
  | "provenance-only"
  | "blocked";

export interface ReviewRegistrationSeveritySummary {
  p1: number;
  p2: number;
  p3: number;
  hasNone: boolean;
  labels: string[];
}

export interface ReviewRegistrationSource {
  absolutePath: string;
  root: string;
  relativePath: string;
  area: "inbox" | "archive" | "reviews" | "external";
  subject: string;
  body: string;
  from: string | null;
  to: string | null;
  sentAt: string | null;
  messageId: string | null;
  prNumber: number | null;
  round: ReviewRegistrationRound;
  severitySummary: ReviewRegistrationSeveritySummary;
  verificationSummary: string[];
  classification: ReviewRegistrationClassification;
  outcomeType: ReviewRegistrationOutcomeType | null;
  provenanceReason: string | null;
}

export interface ReviewRegistrationRecord {
  source: ReviewRegistrationSource;
  status: ReviewRegistrationStatus;
  artifactPath: string | null;
  artifactRelativePath: string | null;
  dedupeKey: string | null;
  reason: string | null;
}

export interface ReviewRegistrationPlan {
  mode: "dry-run" | "apply";
  root: string;
  outputDir: string;
  registeredAt: string;
  sources: ReviewRegistrationSource[];
  registrations: ReviewRegistrationRecord[];
  provenanceOnly: ReviewRegistrationRecord[];
  blocked: ReviewRegistrationRecord[];
  summary: {
    sourceCount: number;
    formalOutcomeCount: number;
    plannedCount: number;
    appliedCount: number;
    alreadyRegisteredCount: number;
    duplicateSourceCount: number;
    provenanceOnlyCount: number;
    blockedCount: number;
  };
  nextActions: Array<{
    id: string;
    label: string;
    command?: string;
    reason: string;
  }>;
}

export interface BuildReviewRegistrationPlanOptions {
  root: string;
  sources: string[];
  prNumbers: number[];
  outputDir?: string;
  apply?: boolean;
  limit?: number;
  registeredAt?: string;
}

const DEFAULT_OUTPUT_SUBDIR = path.join("reviews", "registered");

export function collectReviewRegistrationSources(input: {
  root: string;
  sourcePaths: string[];
  prNumbers: number[];
}): string[] {
  const explicit = input.sourcePaths.map((entry) => path.resolve(entry));
  if (explicit.length > 0) return [...new Set(explicit)].sort();
  if (input.prNumbers.length === 0) return [];
  const root = path.resolve(input.root);
  const requested = new Set(input.prNumbers);
  return ["inbox", "archive", "reviews"]
    .flatMap((area) => listMarkdownFiles(path.join(root, area)))
    .filter((filePath) => !isRegistrationArtifact(root, filePath))
    .filter((filePath) => {
      const raw = fs.readFileSync(filePath, "utf8");
      const { frontmatter, body } = splitFrontmatter(raw);
      const subject =
        frontmatter.subject ??
        inferSubjectFromFilename(path.basename(filePath)) ??
        path.basename(filePath, ".md");
      const pr =
        extractPrNumber(subject) ??
        extractPrNumber(path.basename(filePath)) ??
        extractPrNumber(body);
      return pr !== null && requested.has(pr);
    })
    .sort();
}

function isRegistrationArtifact(root: string, filePath: string): boolean {
  const relative = path.relative(root, filePath).split(path.sep).join("/");
  return relative.startsWith("reviews/registered/");
}

export function buildReviewRegistrationPlan(
  options: BuildReviewRegistrationPlanOptions,
): ReviewRegistrationPlan {
  const root = path.resolve(options.root);
  const outputDir = path.resolve(
    options.outputDir ?? path.join(root, DEFAULT_OUTPUT_SUBDIR),
  );
  const registeredAt = options.registeredAt ?? new Date().toISOString();
  const sources = options.sources
    .map((sourcePath) => parseReviewRegistrationSource(sourcePath, root))
    .filter((source): source is ReviewRegistrationSource => source !== null);
  const mode = options.apply ? "apply" : "dry-run";
  const limit = options.limit ?? 20;
  const seenDedupeKeys = new Map<string, string>();
  const records: ReviewRegistrationRecord[] = [];
  let remaining = limit;

  for (const source of sources) {
    if (source.classification !== "formal-outcome" || !source.outcomeType) {
      records.push({
        source,
        status: "provenance-only",
        artifactPath: null,
        artifactRelativePath: null,
        dedupeKey: null,
        reason: source.provenanceReason ?? "not a formal review outcome",
      });
      continue;
    }
    if (!source.prNumber) {
      records.push(blockedRecord(source, null, "missing PR number"));
      continue;
    }
    const dedupeKey = buildRegistrationDedupeKey(source);
    const artifactPath = buildRegistrationArtifactPath(source, outputDir);
    const artifactRelativePath = path.relative(root, artifactPath);
    const canonicalArtifactPath = seenDedupeKeys.get(dedupeKey);
    if (canonicalArtifactPath) {
      records.push({
        source,
        status: "duplicate-source",
        artifactPath: canonicalArtifactPath,
        artifactRelativePath: path.relative(root, canonicalArtifactPath),
        dedupeKey,
        reason:
          "duplicate formal review outcome for this PR, round, outcome, and content",
      });
      continue;
    }
    seenDedupeKeys.set(dedupeKey, artifactPath);

    const rendered = renderReviewRegistrationArtifact(source, {
      artifactPath,
      dedupeKey,
      registeredAt,
    });
    const existing = readIfExists(artifactPath);
    if (existing !== null) {
      records.push({
        source,
        status: existing === rendered ? "already-registered" : "blocked",
        artifactPath,
        artifactRelativePath,
        dedupeKey,
        reason:
          existing === rendered
            ? "registration artifact already exists"
            : "registration artifact path collision",
      });
      continue;
    }
    if (mode === "dry-run") {
      records.push({
        source,
        status: "planned",
        artifactPath,
        artifactRelativePath,
        dedupeKey,
        reason: null,
      });
      continue;
    }
    if (remaining <= 0) {
      records.push(blockedRecord(source, dedupeKey, "apply limit reached"));
      continue;
    }
    const writeResult = writeFileAppendOnly(artifactPath, rendered);
    if (!writeResult.ok) {
      records.push({
        source,
        status: "blocked",
        artifactPath,
        artifactRelativePath,
        dedupeKey,
        reason: writeResult.reason,
      });
      continue;
    }
    remaining -= 1;
    records.push({
      source,
      status: "applied",
      artifactPath,
      artifactRelativePath,
      dedupeKey,
      reason: null,
    });
  }

  const registrations = records.filter((record) =>
    ["planned", "applied", "already-registered", "duplicate-source"].includes(
      record.status,
    ),
  );
  const provenanceOnly = records.filter(
    (record) => record.status === "provenance-only",
  );
  const blocked = records.filter((record) => record.status === "blocked");
  const summary = {
    sourceCount: sources.length,
    formalOutcomeCount: sources.filter(
      (source) => source.classification === "formal-outcome",
    ).length,
    plannedCount: records.filter((record) => record.status === "planned")
      .length,
    appliedCount: records.filter((record) => record.status === "applied")
      .length,
    alreadyRegisteredCount: records.filter(
      (record) => record.status === "already-registered",
    ).length,
    duplicateSourceCount: records.filter(
      (record) => record.status === "duplicate-source",
    ).length,
    provenanceOnlyCount: provenanceOnly.length,
    blockedCount: blocked.length,
  };
  return {
    mode,
    root,
    outputDir,
    registeredAt,
    sources,
    registrations,
    provenanceOnly,
    blocked,
    summary,
    nextActions: buildRegistrationNextActions(summary),
  };
}

function parseReviewRegistrationSource(
  sourcePath: string,
  root: string,
): ReviewRegistrationSource | null {
  const absolutePath = path.resolve(sourcePath);
  if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
    return null;
  }
  const raw = fs.readFileSync(absolutePath, "utf8");
  const { frontmatter, body } = splitFrontmatter(raw);
  const filename = path.basename(absolutePath);
  const subject =
    frontmatter.subject ?? inferSubjectFromFilename(filename) ?? filename;
  const prNumber =
    extractPrNumber(subject) ??
    extractPrNumber(filename) ??
    extractPrNumber(body);
  const severitySummary = summarizeSeverity(body);
  const round = inferRound(subject, body);
  const classificationResult = classifyReviewRegistration({
    subject,
    body,
    severitySummary,
    round,
  });
  return {
    absolutePath,
    root,
    relativePath: path.relative(root, absolutePath),
    area: inferArea(root, absolutePath),
    subject,
    body,
    from: frontmatter.from ?? inferFromFilename(filename, "from"),
    to: frontmatter.to ?? inferFromFilename(filename, "to"),
    sentAt: frontmatter.sent_at ?? frontmatter.sentAt ?? null,
    messageId: frontmatter.message_id ?? frontmatter.messageId ?? null,
    prNumber,
    round,
    severitySummary,
    verificationSummary: extractVerificationSummary(body),
    classification: classificationResult.classification,
    outcomeType: classificationResult.outcomeType,
    provenanceReason: classificationResult.reason,
  };
}

function classifyReviewRegistration(input: {
  subject: string;
  body: string;
  severitySummary: ReviewRegistrationSeveritySummary;
  round: ReviewRegistrationRound;
}): {
  classification: ReviewRegistrationClassification;
  outcomeType: ReviewRegistrationOutcomeType | null;
  reason: string | null;
} {
  const subject = input.subject.toLowerCase();
  if (
    subject.includes("review-request") ||
    subject.includes("rereview-request")
  ) {
    return {
      classification: "provenance-only",
      outcomeType: null,
      reason: "review request is provenance-only",
    };
  }
  const hasSeverity =
    input.severitySummary.hasNone ||
    input.severitySummary.p1 > 0 ||
    input.severitySummary.p2 > 0 ||
    input.severitySummary.p3 > 0;
  const reviewish =
    /\breview\b|\brereview\b|head-still-clean|merge-ready|closeout/.test(
      subject,
    );
  if (hasSeverity && reviewish) {
    return {
      classification: "formal-outcome",
      outcomeType: outcomeTypeFor(input),
      reason: null,
    };
  }
  if (
    /\bmerge(?:d|-result|-ack)?\b|mergedat|merge commit/.test(subject) ||
    /\bmerge(?:d|-result|-ack)?\b|mergedAt|merge commit/i.test(input.body)
  ) {
    return {
      classification: "provenance-only",
      outcomeType: null,
      reason: "merge acknowledgement is provenance-only",
    };
  }
  if (
    /ack|received|accepted|status|stale|superseded|correction/.test(subject)
  ) {
    return {
      classification: "provenance-only",
      outcomeType: null,
      reason: "review-meta message is provenance-only",
    };
  }
  return {
    classification: "not-review",
    outcomeType: null,
    reason: "not a recognized formal review outcome",
  };
}

function outcomeTypeFor(input: {
  subject: string;
  severitySummary: ReviewRegistrationSeveritySummary;
  round: ReviewRegistrationRound;
}): ReviewRegistrationOutcomeType {
  const subject = input.subject.toLowerCase();
  if (subject.includes("closeout")) return "closeout-clean";
  if (subject.includes("merge-ready") || subject.includes("head-still-clean")) {
    return "merge-ready-clean";
  }
  const hasFindings =
    input.severitySummary.p1 > 0 ||
    input.severitySummary.p2 > 0 ||
    input.severitySummary.p3 > 0;
  if (input.round !== "initial" && input.round !== "R1") {
    return hasFindings ? "rereview-findings" : "rereview-clean";
  }
  return hasFindings ? "findings" : "clean";
}

function buildRegistrationDedupeKey(source: ReviewRegistrationSource): string {
  return [
    `pr${source.prNumber}`,
    source.round,
    source.outcomeType ?? "unknown-outcome",
    normalizeBodyHash(source.body),
  ].join(":");
}

function buildRegistrationArtifactPath(
  source: ReviewRegistrationSource,
  outputDir: string,
): string {
  const prNumber = source.prNumber ?? "unknown";
  const round = String(source.round).toLowerCase();
  const reviewer = safeSegment(source.from ?? "unknown-reviewer");
  const outcome = safeSegment(source.outcomeType ?? "unknown-outcome");
  const hash = shortHash(buildRegistrationDedupeKey(source));
  return path.join(
    outputDir,
    `pr${prNumber}`,
    `${round}-${outcome}-${reviewer}-${hash}.md`,
  );
}

function renderReviewRegistrationArtifact(
  source: ReviewRegistrationSource,
  input: {
    artifactPath: string;
    dedupeKey: string;
    registeredAt: string;
  },
): string {
  const title = `PR #${source.prNumber} ${source.round} Review Registration`;
  return `---
type: tap-review-registration
schema: tap-review-registration.v1
status: registered
pr: ${source.prNumber}
round: ${yamlScalar(source.round)}
reviewer: ${yamlNullable(source.from)}
reviewee: ${yamlNullable(source.to)}
outcomeType: ${yamlNullable(source.outcomeType)}
subject: ${yamlScalar(source.subject)}
sourcePath: ${yamlScalar(source.absolutePath)}
sourceRelativePath: ${yamlScalar(source.relativePath)}
sourceArea: ${yamlScalar(source.area)}
dedupeKey: ${yamlScalar(input.dedupeKey)}
severitySummary:
  p1: ${source.severitySummary.p1}
  p2: ${source.severitySummary.p2}
  p3: ${source.severitySummary.p3}
  hasNone: ${source.severitySummary.hasNone}
verificationSummary:
${renderYamlList(source.verificationSummary)}
registeredAt: ${yamlScalar(source.sentAt ?? "not-recorded")}
registeredBy: ${yamlScalar("tap reviews register")}
sourcePreserved: true
---

# ${title}

## Source

- Source path: ${source.absolutePath}
- Source relative path: ${source.relativePath}
- Subject: ${source.subject}
- Reviewer: ${source.from ?? "unknown"}
- Reviewee: ${source.to ?? "unknown"}

## Outcome

- Outcome type: ${source.outcomeType}
- Severity summary: P1=${source.severitySummary.p1}, P2=${source.severitySummary.p2}, P3=${source.severitySummary.p3}, none=${source.severitySummary.hasNone}
- Dedupe key: ${input.dedupeKey}

## Verification Summary

${renderBullets(source.verificationSummary)}

## Notes

- Source evidence was not moved, deleted, or rewritten.
- This registration is append-only and collision-safe.
`;
}

function buildRegistrationNextActions(
  summary: ReviewRegistrationPlan["summary"],
): ReviewRegistrationPlan["nextActions"] {
  if (summary.blockedCount > 0) {
    return [
      {
        id: "review-registration-blocked",
        label: "Review blocked registration artifacts",
        reason:
          "At least one formal review outcome could not be registered safely.",
      },
    ];
  }
  if (summary.plannedCount > 0) {
    return [
      {
        id: "apply-review-registration",
        label: "Register planned formal review outcomes",
        reason: "Dry-run found inbox-only formal review outcomes.",
      },
    ];
  }
  return [
    {
      id: "no-action-required",
      label: "No review registration action required",
      reason: "No inbox-only formal review outcomes require registration.",
    },
  ];
}

function blockedRecord(
  source: ReviewRegistrationSource,
  dedupeKey: string | null,
  reason: string,
): ReviewRegistrationRecord {
  return {
    source,
    status: "blocked",
    artifactPath:
      source.prNumber && source.outcomeType
        ? buildRegistrationArtifactPath(
            source,
            path.join(source.root, DEFAULT_OUTPUT_SUBDIR),
          )
        : null,
    artifactRelativePath: null,
    dedupeKey,
    reason,
  };
}

function listMarkdownFiles(directory: string): string[] {
  if (!fs.existsSync(directory)) return [];
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const filePath = path.join(directory, entry.name);
      if (entry.isDirectory()) return listMarkdownFiles(filePath);
      if (entry.isFile() && entry.name.endsWith(".md")) return [filePath];
      return [];
    })
    .sort();
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

function inferFromFilename(
  filename: string,
  role: "from" | "to",
): string | null {
  const match = filename.match(/^\d{8}-([^-]+)-([^-]+)-.+\.md$/);
  if (!match) return null;
  return role === "from" ? match[1] : match[2];
}

function extractPrNumber(text: string): number | null {
  const match = text.match(/(?:PR\s*#|#|pr)(\d{3,5})/i);
  return match ? Number(match[1]) : null;
}

function inferRound(subject: string, body: string): ReviewRegistrationRound {
  const text = `${subject}\n${body}`;
  const match = text.match(/(?:^|[-_\s])r(\d+)(?:[-_\s]|$)/i);
  return match
    ? (`R${Number(match[1])}` as ReviewRegistrationRound)
    : "initial";
}

function summarizeSeverity(body: string): ReviewRegistrationSeveritySummary {
  const reviewText = stripFencedCodeBlocks(body);
  if (/P1\/P2\/P3\s*[:：]\s*none/i.test(reviewText)) {
    return { p1: 0, p2: 0, p3: 0, hasNone: true, labels: [] };
  }
  const labels = [...reviewText.matchAll(/^\s*P([123])\b(?!\/)/gm)].map(
    (match) => `P${match[1]}`,
  );
  return {
    p1: labels.filter((label) => label === "P1").length,
    p2: labels.filter((label) => label === "P2").length,
    p3: labels.filter((label) => label === "P3").length,
    hasNone: false,
    labels: [...new Set(labels)],
  };
}

function extractVerificationSummary(body: string): string[] {
  const lines = stripFencedCodeBlocks(body)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const verificationLines = lines.filter((line) =>
    /\b(PASS|FAIL|Verification|재검증|검증|type-check|build|test|Prettier|diff --check)\b/i.test(
      line,
    ),
  );
  return verificationLines.slice(0, 20);
}

function stripFencedCodeBlocks(body: string): string {
  return body.replace(/^```[\s\S]*?^```/gm, "");
}

function inferArea(
  root: string,
  filePath: string,
): ReviewRegistrationSource["area"] {
  const relative = path.relative(root, filePath);
  const first = relative.split(path.sep)[0];
  if (first === "inbox" || first === "archive" || first === "reviews") {
    return first;
  }
  return "external";
}

function readIfExists(filePath: string): string | null {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : null;
}

function writeFileAppendOnly(
  filePath: string,
  content: string,
): { ok: true } | { ok: false; reason: string } {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.tmp.${process.pid}.${Date.now()}.${Math.random()
      .toString(16)
      .slice(2)}`,
  );
  fs.writeFileSync(tempPath, content, { encoding: "utf8", flag: "wx" });
  try {
    fs.linkSync(tempPath, filePath);
    return { ok: true };
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "EEXIST"
    ) {
      return { ok: false, reason: "registration artifact path collision" };
    }
    throw error;
  } finally {
    fs.rmSync(tempPath, { force: true });
  }
}

function normalizeBodyHash(body: string): string {
  return shortHash(body.replace(/\r\n/g, "\n").trim());
}

function shortHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

function safeSegment(value: string): string {
  const normalized = value
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}._-]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "unknown";
}

function renderYamlList(values: string[]): string {
  if (values.length === 0) return "  []";
  return values.map((value) => `  - ${yamlScalar(value)}`).join("\n");
}

function renderBullets(values: string[]): string {
  if (values.length === 0) return "- none observed";
  return values.map((value) => `- ${value}`).join("\n");
}

function yamlNullable(value: string | null): string {
  return value === null ? "null" : yamlScalar(value);
}

function yamlScalar(value: string): string {
  return JSON.stringify(value);
}
