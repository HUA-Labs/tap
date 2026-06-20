import * as fs from "node:fs";
import { createHash } from "node:crypto";
import * as os from "node:os";
import * as path from "node:path";
import type { CommandResult } from "../types.js";
import { findRepoRoot, log, parseArgs, resolveCommsDir } from "../utils.js";
import {
  buildReviewRegistrationPlan,
  collectReviewRegistrationSources,
} from "../reviews/registration.js";

type ReviewType = "clean" | "findings" | "rereview-clean" | "unknown";
type ReviewRound = "initial" | `R${number}`;
type SourceKind =
  | "review-request"
  | "review-clean"
  | "review-findings"
  | "rereview-request"
  | "rereview-clean"
  | "merge-ack"
  | "review-ack"
  | "normalized-artifact"
  | "unknown";
type RecommendedAction =
  | "recover-clean-review-artifact-candidate"
  | "recover-findings-review-artifact-candidate"
  | "already-normalized"
  | "no-evidence-found"
  | "ambiguous-needs-human"
  | "false-positive";
type RecoveryConfidence = "high" | "medium" | "low";
type ApplyStatus =
  | "applied"
  | "skipped"
  | "already-normalized"
  | "collision-needs-human";

interface SeveritySummary {
  p1: number;
  p2: number;
  p3: number;
  hasNone: boolean;
  labels: string[];
}

interface ParsedReviewMessage {
  prNumber: number;
  host: string;
  root: string;
  relativePath: string;
  selectionId: string | null;
  sourceKind: SourceKind;
  reviewType: ReviewType;
  round: ReviewRound;
  reviewer: string | null;
  reviewee: string | null;
  subject: string;
  sentAt: string | null;
  messageId: string | null;
  severitySummary: SeveritySummary;
}

interface CandidatePath {
  host: string;
  root: string;
  path: string;
  sourceKind: SourceKind;
}

interface ScanRoot {
  host: string;
  root: string;
  exists: boolean;
  inboxPath: string;
  archivePath: string;
  reviewsPath: string;
}

interface ReviewRecoveryCandidate {
  prNumber: number;
  reviewType: ReviewType;
  round: ReviewRound;
  selectionId: string;
  sourcePaths: CandidatePath[];
  reviewer: string | null;
  reviewee: string | null;
  subject: string | null;
  sentAt: string | null;
  severitySummary: SeveritySummary;
  ackPaths: CandidatePath[];
  normalizedArtifactExists: boolean;
  dedupeKey: string;
  confidence: RecoveryConfidence;
  recommendedAction: RecommendedAction;
}

interface ApplyOptions {
  outputDir: string;
  limit: number;
  recoveredAt: string;
  selectors: string[];
}

interface ApplyResult {
  prNumber: number;
  round: ReviewRound;
  reviewType: ReviewType;
  selectionId: string;
  recommendedAction: RecommendedAction;
  status: ApplyStatus;
  artifactPath: string | null;
  reason: string | null;
  sourcePaths: CandidatePath[];
}

const HELP = `Usage:
  tap reviews recover [options]
  tap reviews register [options]

Review evidence recovery and registration tools.

Recover options:
  --pr <number>          PR number to scan for; may be repeated
  --pr-range A..B        Inclusive PR number range
  --root <path>          Read-only tap comms root; may be repeated
  --roots <paths>        Path-delimited or comma-delimited comms roots
  --comms-dir <path>     Default comms root when --root is omitted
  --apply                Write bounded normalized artifacts
  --output-dir <path>    Required with --apply; artifact output directory
  --limit <number>       Required with --apply; max artifacts to write (1-20)
  --select <id>          Optional selection id to apply; may be repeated
  --json                 Emit JSON

Register options:
  --source <path>        Inbox/archive/reviews source file; may be repeated
  --pr <number>          Bounded PR number scan when --source is omitted
  --pr-range A..B        Inclusive bounded PR range
  --comms-dir <path>     Tap comms root for bounded scan and default output
  --output-dir <path>    Artifact output directory; default reviews/registered
  --apply                Append registration artifacts
  --limit <number>       Required with --apply; max artifacts to write (1-50)
  --json                 Emit JSON

Dry-run mode never writes. Apply mode writes only bounded, collision-safe
normalized artifacts and never moves, copies, deletes, or rewrites source
inbox/archive/review files.`;

function invalidArgument(message: string): CommandResult {
  return {
    ok: false,
    command: "reviews",
    code: "TAP_INVALID_ARGUMENT",
    message,
    warnings: [],
    data: { error: message },
  };
}

export async function reviewsCommand(args: string[]): Promise<CommandResult> {
  const parsed = parseArgs(args);
  const command = parsed.positional[0] ?? "recover";
  if (parsed.flags.help || parsed.flags.h) {
    log(HELP);
    return {
      ok: true,
      command: "reviews",
      code: "TAP_REVIEWS_RECOVERY_OK",
      message: "reviews help",
      warnings: [],
      data: { help: HELP },
    };
  }
  if (command === "register") return reviewsRegisterCommand(args);
  if (command !== "recover") {
    return invalidArgument(`Unsupported reviews command: ${command}`);
  }
  const prResult = parseRequestedPrNumbers(args);
  if ("error" in prResult) {
    return invalidArgument(prResult.error);
  }
  const rootResult = resolveScanRoots(args);
  if ("error" in rootResult) {
    return invalidArgument(rootResult.error);
  }
  const selectionResult = parseSelectionOptions(args);
  if ("error" in selectionResult) return invalidArgument(selectionResult.error);

  const messages = scanRoots(rootResult.roots, prResult.prNumbers);
  const candidates = buildCandidates(prResult.prNumbers, messages);
  if (parsed.flags.apply) {
    const applyOptions = parseApplyOptions(args, selectionResult.selectors);
    if ("error" in applyOptions) return invalidArgument(applyOptions.error);
    const applyResults = applyRecoveryArtifacts(candidates, applyOptions);
    const appliedCount = applyResults.filter(
      (result) => result.status === "applied",
    ).length;
    return {
      ok: true,
      command: "reviews",
      code: "TAP_REVIEWS_RECOVERY_OK",
      message: `review recovery apply wrote ${appliedCount} artifact(s), skipped ${applyResults.length - appliedCount} row(s)`,
      warnings: [],
      data: {
        mode: "apply",
        prNumbers: prResult.prNumbers,
        roots: rootResult.roots,
        scanned: messages.length,
        candidates,
        apply: {
          outputDir: applyOptions.outputDir,
          limit: applyOptions.limit,
          selectors: applyOptions.selectors,
          recoveredAt: applyOptions.recoveredAt,
          appliedCount,
          results: applyResults,
        },
      },
    };
  }
  return {
    ok: true,
    command: "reviews",
    code: "TAP_REVIEWS_RECOVERY_OK",
    message: `review recovery dry-run found ${candidates.length} candidate row(s)`,
    warnings: [],
    data: {
      mode: "dry-run",
      prNumbers: prResult.prNumbers,
      roots: rootResult.roots,
      scanned: messages.length,
      selection:
        selectionResult.selectors.length > 0
          ? {
              selectors: selectionResult.selectors,
              matchedCount: candidates.filter((candidate) =>
                selectionMatches(candidate, selectionResult.selectors),
              ).length,
            }
          : null,
      candidates,
    },
  };
}

function reviewsRegisterCommand(args: string[]): CommandResult {
  const root = path.resolve(resolveCommsDir(args, findRepoRoot(process.cwd())));
  const sourceResult = readRepeatedFlag(args, "source");
  if ("error" in sourceResult) return invalidArgument(sourceResult.error);
  const prResult = parseOptionalPrNumbers(args);
  if ("error" in prResult) return invalidArgument(prResult.error);
  if (sourceResult.values.length === 0 && prResult.prNumbers.length === 0) {
    return invalidArgument(
      "tap reviews register requires at least one --source, --pr, or --pr-range",
    );
  }
  const outputDirResult = readSingleFlag(args, "output-dir");
  if ("error" in outputDirResult) return invalidArgument(outputDirResult.error);
  const limitResult = parseRegisterLimit(args);
  if ("error" in limitResult) return invalidArgument(limitResult.error);
  const parsed = parseArgs(args);
  if (parsed.flags.apply && !limitResult.provided) {
    return invalidArgument("--apply requires --limit");
  }
  const sources = collectReviewRegistrationSources({
    root,
    sourcePaths: sourceResult.values,
    prNumbers: prResult.prNumbers,
  });
  const plan = buildReviewRegistrationPlan({
    root,
    sources,
    prNumbers: prResult.prNumbers,
    outputDir: outputDirResult.value ?? undefined,
    apply: Boolean(parsed.flags.apply),
    limit: limitResult.limit,
  });
  const blockedCount = plan.summary.blockedCount;
  return {
    ok: blockedCount === 0,
    command: "reviews",
    code: "TAP_REVIEWS_REGISTER_OK",
    message:
      blockedCount > 0
        ? `review registration blocked ${blockedCount} source(s)`
        : `review registration ${plan.mode} classified ${plan.summary.sourceCount} source(s)`,
    warnings: [],
    data: {
      mode: plan.mode,
      root: plan.root,
      outputDir: plan.outputDir,
      prNumbers: prResult.prNumbers,
      scanned: sources.length,
      summary: plan.summary,
      registrations: plan.registrations,
      provenanceOnly: plan.provenanceOnly,
      blocked: plan.blocked,
      nextActions: plan.nextActions,
    },
  };
}

function parseOptionalPrNumbers(
  args: string[],
): { prNumbers: number[] } | { error: string } {
  const prValues = readRepeatedFlag(args, "pr");
  if ("error" in prValues) return prValues;
  const rangeValues = readRepeatedFlag(args, "pr-range");
  if ("error" in rangeValues) return rangeValues;
  const numbers = new Set<number>();
  for (const value of prValues.values.flatMap((entry) => entry.split(","))) {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      return { error: `Invalid --pr value: ${value}` };
    }
    numbers.add(parsed);
  }
  for (const value of rangeValues.values) {
    const match = value.match(/^(\d+)\.\.(\d+)$/);
    if (!match) return { error: `Invalid --pr-range value: ${value}` };
    const start = Number(match[1]);
    const end = Number(match[2]);
    if (start <= 0 || end < start) {
      return { error: `Invalid --pr-range value: ${value}` };
    }
    for (let pr = start; pr <= end; pr += 1) numbers.add(pr);
  }
  return { prNumbers: [...numbers].sort((a, b) => a - b) };
}

function parseRegisterLimit(
  args: string[],
): { provided: boolean; limit: number } | { error: string } {
  const limitResult = readSingleFlag(args, "limit");
  if ("error" in limitResult) return limitResult;
  if (!limitResult.value) return { provided: false, limit: 20 };
  const limit = Number(limitResult.value);
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    return { error: `Invalid --limit value: ${limitResult.value}` };
  }
  return { provided: true, limit };
}

function parseSelectionOptions(
  args: string[],
): { selectors: string[] } | { error: string } {
  const selectValues = readRepeatedFlag(args, "select");
  if ("error" in selectValues) return selectValues;
  return {
    selectors: selectValues.values
      .flatMap((entry) => entry.split(","))
      .map((entry) => entry.trim())
      .filter(Boolean),
  };
}

function parseApplyOptions(
  args: string[],
  selectors: string[],
): ApplyOptions | { error: string } {
  const outputDirResult = readSingleFlag(args, "output-dir");
  if ("error" in outputDirResult) return outputDirResult;
  const limitResult = readSingleFlag(args, "limit");
  if ("error" in limitResult) return limitResult;
  if (!outputDirResult.value) {
    return { error: "--apply requires --output-dir" };
  }
  if (!limitResult.value) {
    return { error: "--apply requires --limit" };
  }
  const limit = Number(limitResult.value);
  if (!Number.isInteger(limit) || limit < 1 || limit > 20) {
    return { error: `Invalid --limit value: ${limitResult.value}` };
  }
  return {
    outputDir: path.resolve(outputDirResult.value),
    limit,
    recoveredAt: new Date().toISOString(),
    selectors,
  };
}

function parseRequestedPrNumbers(
  args: string[],
): { prNumbers: number[] } | { error: string } {
  const prValues = readRepeatedFlag(args, "pr");
  if ("error" in prValues) return prValues;
  const rangeValues = readRepeatedFlag(args, "pr-range");
  if ("error" in rangeValues) return rangeValues;
  const numbers = new Set<number>();
  for (const value of prValues.values.flatMap((entry) => entry.split(","))) {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      return { error: `Invalid --pr value: ${value}` };
    }
    numbers.add(parsed);
  }
  for (const value of rangeValues.values) {
    const match = value.match(/^(\d+)\.\.(\d+)$/);
    if (!match) return { error: `Invalid --pr-range value: ${value}` };
    const start = Number(match[1]);
    const end = Number(match[2]);
    if (start <= 0 || end < start) {
      return { error: `Invalid --pr-range value: ${value}` };
    }
    for (let pr = start; pr <= end; pr += 1) numbers.add(pr);
  }
  if (numbers.size === 0) {
    return { error: "At least one --pr or --pr-range is required" };
  }
  return { prNumbers: [...numbers].sort((a, b) => a - b) };
}

function resolveScanRoots(
  args: string[],
): { roots: ScanRoot[] } | { error: string } {
  const repeatedRoots = readRepeatedFlag(args, "root");
  if ("error" in repeatedRoots) return repeatedRoots;
  const rootsFlag = readRepeatedFlag(args, "roots");
  if ("error" in rootsFlag) return rootsFlag;
  const rawRoots = [
    ...repeatedRoots.values,
    ...rootsFlag.values.flatMap((value) =>
      value
        .split(value.includes(",") ? "," : path.delimiter)
        .map((entry) => entry.trim())
        .filter(Boolean),
    ),
  ];
  const roots =
    rawRoots.length > 0
      ? rawRoots
      : [resolveCommsDir(args, findRepoRoot(process.cwd()))];
  const host = process.env.TAP_REVIEWS_RECOVERY_HOST ?? os.hostname();
  return {
    roots: [...new Set(roots.map((entry) => path.resolve(entry)))].map(
      (root) => ({
        host,
        root,
        exists: fs.existsSync(root),
        inboxPath: path.join(root, "inbox"),
        archivePath: path.join(root, "archive"),
        reviewsPath: path.join(root, "reviews"),
      }),
    ),
  };
}

function readRepeatedFlag(
  args: string[],
  flag: string,
): { values: string[] } | { error: string } {
  const values: string[] = [];
  const name = `--${flag}`;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === name) {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) {
        return { error: `${name} requires a value` };
      }
      values.push(value);
      index += 1;
    } else if (arg.startsWith(`${name}=`)) {
      const value = arg.slice(name.length + 1);
      if (!value) return { error: `${name} requires a value` };
      values.push(value);
    }
  }
  return { values };
}

function readSingleFlag(
  args: string[],
  flag: string,
): { value: string | null } | { error: string } {
  const result = readRepeatedFlag(args, flag);
  if ("error" in result) return result;
  if (result.values.length > 1) {
    return { error: `--${flag} may only be provided once` };
  }
  return { value: result.values[0] ?? null };
}

function scanRoots(
  roots: ScanRoot[],
  prNumbers: number[],
): ParsedReviewMessage[] {
  const requested = new Set(prNumbers);
  const messages: ParsedReviewMessage[] = [];
  for (const root of roots) {
    for (const [directory, sourceRootKind] of [
      [root.inboxPath, "inbox"],
      [root.archivePath, "archive"],
      [root.reviewsPath, "reviews"],
    ] as const) {
      for (const filePath of listMarkdownFiles(directory)) {
        const parsed = parseReviewMessage(filePath, root, sourceRootKind);
        if (parsed && requested.has(parsed.prNumber)) messages.push(parsed);
      }
    }
  }
  return messages;
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

function parseReviewMessage(
  filePath: string,
  root: ScanRoot,
  sourceRootKind: "inbox" | "archive" | "reviews",
): ParsedReviewMessage | null {
  const raw = fs.readFileSync(filePath, "utf8");
  const { frontmatter, frontmatterRaw, body } = splitFrontmatter(raw);
  const filename = path.basename(filePath);
  const subject =
    frontmatter.subject ??
    inferSubjectFromFilename(filename) ??
    filename.replace(/\.md$/, "");
  const prNumber =
    extractPrNumber(subject) ??
    extractPrNumber(filename) ??
    parseFrontmatterPrNumber(frontmatter.pr ?? frontmatter.prNumber);
  if (!prNumber) return null;
  const sourceKind =
    sourceRootKind === "reviews"
      ? "normalized-artifact"
      : classifySourceKind(subject, body);
  const reviewType =
    sourceKind === "normalized-artifact"
      ? (parseFrontmatterReviewType(frontmatter.reviewType) ??
        classifyReviewType(sourceKind, subject, body))
      : classifyReviewType(sourceKind, subject, body);
  return {
    prNumber,
    host: root.host,
    root: root.root,
    relativePath: path.relative(root.root, filePath),
    selectionId: frontmatter.selectionId ?? null,
    sourceKind,
    reviewType,
    round:
      sourceKind === "normalized-artifact"
        ? (parseFrontmatterRound(frontmatter.round) ?? inferRound(subject))
        : inferRound(subject),
    reviewer: frontmatter.from ?? inferFromFilename(filename, "from"),
    reviewee: frontmatter.to ?? inferFromFilename(filename, "to"),
    subject,
    sentAt: frontmatter.sent_at ?? frontmatter.sentAt ?? null,
    messageId: frontmatter.message_id ?? frontmatter.messageId ?? null,
    severitySummary:
      sourceKind === "normalized-artifact"
        ? (parseFrontmatterSeverity(frontmatterRaw) ?? summarizeSeverity(body))
        : summarizeSeverity(body),
  };
}

function splitFrontmatter(raw: string): {
  frontmatter: Record<string, string>;
  frontmatterRaw: string;
  body: string;
} {
  if (!raw.startsWith("---\n")) {
    return { frontmatter: {}, frontmatterRaw: "", body: raw };
  }
  const end = raw.indexOf("\n---", 4);
  if (end === -1) return { frontmatter: {}, frontmatterRaw: "", body: raw };
  const frontmatter: Record<string, string> = {};
  const frontmatterRaw = raw.slice(4, end);
  for (const line of frontmatterRaw.split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (match)
      frontmatter[match[1]] = match[2].replace(/^["']|["']$/g, "").trim();
  }
  return { frontmatter, frontmatterRaw, body: raw.slice(end + 4) };
}

function parseFrontmatterSeverity(value: string): SeveritySummary | null {
  const block = value.match(
    /^severitySummary:\s*\n((?:\s+[A-Za-z0-9_-]+:\s*.*\n?)*)/m,
  )?.[1];
  if (!block) return null;
  const p1 = parseYamlInteger(block, "p1");
  const p2 = parseYamlInteger(block, "p2");
  const p3 = parseYamlInteger(block, "p3");
  const hasNone = parseYamlBoolean(block, "hasNone");
  if (p1 === null || p2 === null || p3 === null || hasNone === null) {
    return null;
  }
  const labels = [
    ...(p1 > 0 ? ["P1"] : []),
    ...(p2 > 0 ? ["P2"] : []),
    ...(p3 > 0 ? ["P3"] : []),
  ];
  return { p1, p2, p3, hasNone, labels };
}

function parseYamlInteger(block: string, key: string): number | null {
  const match = block.match(new RegExp(`^\\s+${key}:\\s+(\\d+)\\s*$`, "m"));
  return match ? Number(match[1]) : null;
}

function parseYamlBoolean(block: string, key: string): boolean | null {
  const match = block.match(
    new RegExp(`^\\s+${key}:\\s+(true|false)\\s*$`, "m"),
  );
  if (!match) return null;
  return match[1] === "true";
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

function parseFrontmatterPrNumber(value: string | undefined): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^\d{3,5}$/.test(trimmed)) return Number(trimmed);
  return extractPrNumber(trimmed);
}

function classifySourceKind(subject: string, body: string): SourceKind {
  const normalized = subject.toLowerCase();
  if (
    /\bci\b|billing|merge|merged|merge-ack|merge-noted|review-clean-ack|review-received|smoke/.test(
      normalized,
    ) ||
    isReviewAckSubject(normalized)
  ) {
    return normalized.includes("review") ? "review-ack" : "merge-ack";
  }
  if (normalized.includes("review-request")) {
    return inferRound(subject) === "initial"
      ? "review-request"
      : "rereview-request";
  }
  if (hasFindings(body)) return "review-findings";
  if (hasCleanNone(body) || normalized.includes("review-clean")) {
    return inferRound(subject) === "initial"
      ? "review-clean"
      : "rereview-clean";
  }
  if (normalized.includes("rereview")) return "rereview-request";
  return "unknown";
}

function isReviewAckSubject(normalizedSubject: string): boolean {
  if (/^re-pr\d{3,5}.*\breview\b/i.test(normalizedSubject)) return true;
  return /\breview(?:-[a-z0-9]+)*-(?:ack|received|accepted)\b/i.test(
    normalizedSubject,
  );
}

function classifyReviewType(
  sourceKind: SourceKind,
  subject: string,
  body: string,
): ReviewType {
  if (sourceKind === "review-findings") return "findings";
  if (sourceKind === "rereview-clean") return "rereview-clean";
  if (sourceKind === "review-clean") return "clean";
  if (sourceKind === "normalized-artifact") {
    if (hasFindings(body)) return "findings";
    if (hasCleanNone(body) || subject.toLowerCase().includes("clean")) {
      return inferRound(subject) === "initial" ? "clean" : "rereview-clean";
    }
  }
  return "unknown";
}

function parseFrontmatterReviewType(
  value: string | undefined,
): ReviewType | null {
  if (
    value === "clean" ||
    value === "findings" ||
    value === "rereview-clean" ||
    value === "unknown"
  ) {
    return value;
  }
  return null;
}

function inferRound(subject: string): ReviewRound {
  const match = subject.match(/(?:^|[-_\s])r(\d+)(?:[-_\s]|$)/i);
  return match ? (`R${Number(match[1])}` as ReviewRound) : "initial";
}

function parseFrontmatterRound(value: string | undefined): ReviewRound | null {
  if (!value) return null;
  if (value === "initial") return "initial";
  const match = value.match(/^R(\d+)$/i);
  return match ? (`R${Number(match[1])}` as ReviewRound) : null;
}

function hasCleanNone(body: string): boolean {
  return /P1\/P2\/P3\s*[:：]\s*none/i.test(stripFencedCodeBlocks(body));
}

function hasFindings(body: string): boolean {
  const reviewText = stripFencedCodeBlocks(body);
  if (/Findings\s*[:：]/i.test(reviewText) && !hasCleanNone(reviewText)) {
    return reviewFindingLabels(reviewText).length > 0;
  }
  return (
    reviewFindingLabels(reviewText).length > 0 && !hasCleanNone(reviewText)
  );
}

function summarizeSeverity(body: string): SeveritySummary {
  const reviewText = stripFencedCodeBlocks(body);
  if (hasCleanNone(reviewText)) {
    return { p1: 0, p2: 0, p3: 0, hasNone: true, labels: [] };
  }
  const labels = reviewFindingLabels(reviewText);
  return {
    p1: labels.filter((label) => label === "P1").length,
    p2: labels.filter((label) => label === "P2").length,
    p3: labels.filter((label) => label === "P3").length,
    hasNone: hasCleanNone(reviewText),
    labels: [...new Set(labels)],
  };
}

function reviewFindingLabels(body: string): string[] {
  return [...body.matchAll(/^\s*P([123])\b(?!\/)/gm)].map(
    (match) => `P${match[1]}`,
  );
}

function stripFencedCodeBlocks(body: string): string {
  return body.replace(/^```[\s\S]*?^```/gm, "");
}

function buildCandidates(
  prNumbers: number[],
  messages: ParsedReviewMessage[],
): ReviewRecoveryCandidate[] {
  const byPr = new Map<number, ParsedReviewMessage[]>();
  for (const message of messages) {
    const records = byPr.get(message.prNumber) ?? [];
    records.push(message);
    byPr.set(message.prNumber, records);
  }
  return prNumbers.flatMap((prNumber) =>
    buildPrCandidates(prNumber, byPr.get(prNumber) ?? []),
  );
}

function buildPrCandidates(prNumber: number, messages: ParsedReviewMessage[]) {
  const normalized = messages.filter(
    (message) => message.sourceKind === "normalized-artifact",
  );
  const ackPaths = toCandidatePaths(
    messages.filter((message) =>
      ["merge-ack", "review-ack"].includes(message.sourceKind),
    ),
  );
  const normalizedCandidates = buildNormalizedCandidates(
    prNumber,
    normalized,
    ackPaths,
  );
  const normalizedIdentities = new Set(
    normalizedCandidates.map((candidate) =>
      recoveryIdentity(candidate.round, candidate.reviewType),
    ),
  );
  const outcomes = messages.filter(
    (message) =>
      message.sourceKind !== "normalized-artifact" &&
      ["clean", "findings", "rereview-clean"].includes(message.reviewType) &&
      !normalizedIdentities.has(
        recoveryIdentity(message.round, message.reviewType),
      ),
  );
  const requests = messages.filter((message) =>
    ["review-request", "rereview-request"].includes(message.sourceKind),
  );
  if (outcomes.length === 0) {
    if (normalizedCandidates.length > 0) return normalizedCandidates;
    return [
      makeCandidate({
        prNumber,
        reviewType: "unknown",
        round: "initial",
        messages: messages.filter(
          (message) =>
            !["merge-ack", "review-ack"].includes(message.sourceKind),
        ),
        ackPaths,
        normalizedArtifactExists: false,
        recommendedAction: "no-evidence-found",
        confidence: ackPaths.length > 0 ? "medium" : "low",
      }),
    ];
  }
  return [
    ...normalizedCandidates,
    ...buildOutcomeCandidates(prNumber, outcomes, requests, ackPaths),
  ];
}

function buildOutcomeCandidates(
  prNumber: number,
  outcomes: ParsedReviewMessage[],
  requests: ParsedReviewMessage[],
  ackPaths: CandidatePath[],
): ReviewRecoveryCandidate[] {
  const byRound = new Map<ReviewRound, ParsedReviewMessage[]>();
  for (const outcome of outcomes) {
    const records = byRound.get(outcome.round) ?? [];
    records.push(outcome);
    byRound.set(outcome.round, records);
  }
  return [...byRound.entries()].map(([round, records]) => {
    const reviewTypes = new Set(records.map((record) => record.reviewType));
    const reviewers = new Set(
      records.map((record) => record.reviewer).filter(Boolean),
    );
    const ambiguous = reviewTypes.size > 1 || reviewers.size > 1;
    const reviewType = chooseReviewType(records);
    return makeCandidate({
      prNumber,
      reviewType,
      round,
      messages: [
        ...records,
        ...requests.filter((request) => request.round === round),
      ],
      ackPaths,
      normalizedArtifactExists: false,
      recommendedAction: ambiguous
        ? "ambiguous-needs-human"
        : actionForReviewType(reviewType),
      confidence: ambiguous ? "low" : "high",
    });
  });
}

function recoveryIdentity(round: ReviewRound, reviewType: ReviewType): string {
  return `${round}:${reviewType}`;
}

function buildNormalizedCandidates(
  prNumber: number,
  normalized: ParsedReviewMessage[],
  ackPaths: CandidatePath[],
): ReviewRecoveryCandidate[] {
  const byIdentity = new Map<string, ParsedReviewMessage[]>();
  for (const artifact of normalized) {
    const key =
      artifact.selectionId ??
      `${artifact.round}:${artifact.reviewType}:${artifact.relativePath}`;
    const records = byIdentity.get(key) ?? [];
    records.push(artifact);
    byIdentity.set(key, records);
  }
  return [...byIdentity.values()].map((records) =>
    makeCandidate({
      prNumber,
      reviewType: chooseReviewType(records),
      round: records[0]?.round ?? "initial",
      messages: records,
      ackPaths,
      normalizedArtifactExists: true,
      recommendedAction: "already-normalized",
      confidence: "high",
    }),
  );
}

function chooseReviewType(messages: ParsedReviewMessage[]): ReviewType {
  if (messages.some((message) => message.reviewType === "findings")) {
    return "findings";
  }
  if (messages.some((message) => message.reviewType === "rereview-clean")) {
    return "rereview-clean";
  }
  if (messages.some((message) => message.reviewType === "clean")) {
    return "clean";
  }
  return "unknown";
}

function actionForReviewType(reviewType: ReviewType): RecommendedAction {
  if (reviewType === "findings") {
    return "recover-findings-review-artifact-candidate";
  }
  if (reviewType === "clean" || reviewType === "rereview-clean") {
    return "recover-clean-review-artifact-candidate";
  }
  return "no-evidence-found";
}

function makeCandidate(input: {
  prNumber: number;
  reviewType: ReviewType;
  round: ReviewRound;
  messages: ParsedReviewMessage[];
  ackPaths: CandidatePath[];
  normalizedArtifactExists: boolean;
  recommendedAction: RecommendedAction;
  confidence: RecoveryConfidence;
}): ReviewRecoveryCandidate {
  const first = input.messages[0] ?? null;
  const dedupeKey = buildDedupeKey(input.prNumber, input.round, input.messages);
  const existingSelectionId =
    input.messages.map((message) => message.selectionId).find(Boolean) ?? null;
  const severityMessages = input.messages.filter(isSeverityMessage);
  return {
    prNumber: input.prNumber,
    reviewType: input.reviewType,
    round: input.round,
    selectionId:
      existingSelectionId ??
      buildSelectionId(
        input.prNumber,
        input.round,
        input.reviewType,
        dedupeKey,
      ),
    sourcePaths: toCandidatePaths(input.messages),
    reviewer: first?.reviewer ?? null,
    reviewee: first?.reviewee ?? null,
    subject: first?.subject ?? null,
    sentAt: first?.sentAt ?? null,
    severitySummary: combineSeverity(severityMessages),
    ackPaths: input.ackPaths,
    normalizedArtifactExists: input.normalizedArtifactExists,
    dedupeKey,
    confidence: input.confidence,
    recommendedAction: input.recommendedAction,
  };
}

function isSeverityMessage(message: ParsedReviewMessage): boolean {
  return [
    "review-findings",
    "review-clean",
    "rereview-clean",
    "normalized-artifact",
  ].includes(message.sourceKind);
}

function toCandidatePaths(messages: ParsedReviewMessage[]): CandidatePath[] {
  return messages.map((message) => ({
    host: message.host,
    root: message.root,
    path: message.relativePath,
    sourceKind: message.sourceKind,
  }));
}

function combineSeverity(messages: ParsedReviewMessage[]): SeveritySummary {
  const labels = new Set<string>();
  let p1 = 0;
  let p2 = 0;
  let p3 = 0;
  let hasNone = false;
  for (const message of messages) {
    p1 += message.severitySummary.p1;
    p2 += message.severitySummary.p2;
    p3 += message.severitySummary.p3;
    hasNone ||= message.severitySummary.hasNone;
    for (const label of message.severitySummary.labels) labels.add(label);
  }
  return { p1, p2, p3, hasNone, labels: [...labels].sort() };
}

function buildDedupeKey(
  prNumber: number,
  round: ReviewRound,
  messages: ParsedReviewMessage[],
): string {
  const identities = messages
    .map(
      (message) =>
        message.messageId ??
        `${message.subject}|${message.reviewer ?? ""}|${message.reviewee ?? ""}|${message.sentAt ?? ""}`,
    )
    .sort();
  return `pr${prNumber}:${round}:${identities.join("+") || "no-review-evidence"}`;
}

function applyRecoveryArtifacts(
  candidates: ReviewRecoveryCandidate[],
  options: ApplyOptions,
): ApplyResult[] {
  const results: ApplyResult[] = [];
  let remaining = options.limit;
  for (const candidate of candidates) {
    if (!selectionMatches(candidate, options.selectors)) {
      results.push(skipApply(candidate, "not selected for apply"));
      continue;
    }
    if (!isApplyCandidate(candidate)) {
      results.push(skipApply(candidate, reasonForSkip(candidate)));
      continue;
    }
    if (remaining <= 0) {
      results.push(skipApply(candidate, "apply limit reached"));
      continue;
    }
    const artifactPath = buildArtifactPath(candidate, options.outputDir);
    const writeResult = writeRecoveryArtifact(candidate, artifactPath, options);
    results.push(writeResult);
    if (writeResult.status === "applied") remaining -= 1;
  }
  return results;
}

function isApplyCandidate(candidate: ReviewRecoveryCandidate): boolean {
  return (
    candidate.confidence === "high" &&
    candidate.sourcePaths.length > 0 &&
    (candidate.recommendedAction ===
      "recover-clean-review-artifact-candidate" ||
      candidate.recommendedAction ===
        "recover-findings-review-artifact-candidate") &&
    Boolean(candidate.reviewer) &&
    Boolean(candidate.subject)
  );
}

function reasonForSkip(candidate: ReviewRecoveryCandidate): string {
  if (
    candidate.recommendedAction === "ambiguous-needs-human" ||
    candidate.confidence !== "high"
  ) {
    return "candidate requires human review";
  }
  if (candidate.recommendedAction === "already-normalized") {
    return "normalized artifact already exists";
  }
  if (candidate.recommendedAction === "no-evidence-found") {
    return "no recoverable review result evidence";
  }
  if (candidate.sourcePaths.length === 0) return "missing source paths";
  if (!candidate.reviewer) return "missing reviewer";
  if (!candidate.subject) return "missing subject";
  return "candidate is not eligible for apply";
}

function skipApply(
  candidate: ReviewRecoveryCandidate,
  reason: string,
): ApplyResult {
  return {
    prNumber: candidate.prNumber,
    round: candidate.round,
    reviewType: candidate.reviewType,
    selectionId: candidate.selectionId,
    recommendedAction: candidate.recommendedAction,
    status:
      candidate.recommendedAction === "already-normalized"
        ? "already-normalized"
        : "skipped",
    artifactPath:
      candidate.recommendedAction === "already-normalized"
        ? existingNormalizedArtifactPath(candidate)
        : null,
    reason,
    sourcePaths: candidate.sourcePaths,
  };
}

function existingNormalizedArtifactPath(
  candidate: ReviewRecoveryCandidate,
): string | null {
  const normalizedPath = candidate.sourcePaths.find(
    (sourcePath) => sourcePath.sourceKind === "normalized-artifact",
  );
  return normalizedPath
    ? path.join(normalizedPath.root, normalizedPath.path)
    : null;
}

function buildArtifactPath(
  candidate: ReviewRecoveryCandidate,
  outputDir: string,
): string {
  const round = String(candidate.round).toLowerCase();
  const reviewType = candidate.reviewType.replace(/[^a-z0-9-]/gi, "-");
  const hash = shortHash(candidate.dedupeKey);
  return path.join(
    outputDir,
    `pr${candidate.prNumber}`,
    `${round}-${reviewType}-${hash}.md`,
  );
}

function shortHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 10);
}

function buildSelectionId(
  prNumber: number,
  round: ReviewRound,
  reviewType: ReviewType,
  dedupeKey: string,
): string {
  return [
    `pr${prNumber}`,
    String(round).toLowerCase(),
    reviewType,
    shortHash(dedupeKey),
  ].join(":");
}

function selectionMatches(
  candidate: ReviewRecoveryCandidate,
  selectors: string[],
): boolean {
  if (selectors.length === 0) return true;
  const round = String(candidate.round).toLowerCase();
  const accepted = new Set([
    candidate.selectionId,
    shortHash(candidate.dedupeKey),
    candidate.dedupeKey,
    `pr${candidate.prNumber}:${round}`,
    `pr${candidate.prNumber}:${round}:${candidate.reviewType}`,
  ]);
  return selectors.some(
    (selector) =>
      accepted.has(selector) || accepted.has(selector.toLowerCase()),
  );
}

function writeRecoveryArtifact(
  candidate: ReviewRecoveryCandidate,
  artifactPath: string,
  options: ApplyOptions,
): ApplyResult {
  if (fs.existsSync(artifactPath)) {
    return applyResult(candidate, "already-normalized", artifactPath, null);
  }
  const artifactDir = path.dirname(artifactPath);
  fs.mkdirSync(artifactDir, { recursive: true });
  const tempPath = path.join(
    artifactDir,
    `.${path.basename(artifactPath)}.tmp.${process.pid}.${Date.now()}.${Math.random()
      .toString(16)
      .slice(2)}`,
  );
  try {
    fs.writeFileSync(tempPath, renderRecoveryArtifact(candidate, options), {
      encoding: "utf8",
      flag: "wx",
    });
    fs.linkSync(tempPath, artifactPath);
    fs.unlinkSync(tempPath);
    return applyResult(candidate, "applied", artifactPath, null);
  } catch (error) {
    fs.rmSync(tempPath, { force: true });
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "EEXIST"
    ) {
      return applyResult(
        candidate,
        "collision-needs-human",
        artifactPath,
        "artifact path already exists",
      );
    }
    throw error;
  }
}

function applyResult(
  candidate: ReviewRecoveryCandidate,
  status: ApplyStatus,
  artifactPath: string | null,
  reason: string | null,
): ApplyResult {
  return {
    prNumber: candidate.prNumber,
    round: candidate.round,
    reviewType: candidate.reviewType,
    selectionId: candidate.selectionId,
    recommendedAction: candidate.recommendedAction,
    status,
    artifactPath,
    reason,
    sourcePaths: candidate.sourcePaths,
  };
}

function renderRecoveryArtifact(
  candidate: ReviewRecoveryCandidate,
  options: ApplyOptions,
): string {
  return `${renderRecoveryFrontmatter(candidate, options)}
# PR #${candidate.prNumber} ${candidate.round} Review Recovery

## Summary

Recovered from tap review evidence. Original inbox/archive/review source files
are preserved.

## Source Evidence

${renderPathBullets(candidate.sourcePaths)}

## Acknowledgement Provenance

${renderPathBullets(candidate.ackPaths)}

## Review Outcome

- Review type: ${candidate.reviewType}
- Recommended action: ${candidate.recommendedAction}
- Severity summary: P1=${candidate.severitySummary.p1}, P2=${candidate.severitySummary.p2}, P3=${candidate.severitySummary.p3}, none=${candidate.severitySummary.hasNone}

## Selected Review Excerpts

${renderSelectedReviewExcerpts(candidate)}

## Recovery Notes

- Selection id: ${candidate.selectionId}
- Dedupe key: ${candidate.dedupeKey}
- Confidence: ${candidate.confidence}
- Source preserved: true
`;
}

function renderRecoveryFrontmatter(
  candidate: ReviewRecoveryCandidate,
  options: ApplyOptions,
): string {
  return `---
type: tap-review-recovery
schema: tap-review-recovery.v1
status: recovered
pr: ${candidate.prNumber}
round: ${yamlScalar(candidate.round)}
reviewType: ${yamlScalar(candidate.reviewType)}
reviewer: ${yamlNullable(candidate.reviewer)}
reviewee: ${yamlNullable(candidate.reviewee)}
subject: ${yamlNullable(candidate.subject)}
selectionId: ${yamlScalar(candidate.selectionId)}
dedupeKey: ${yamlScalar(candidate.dedupeKey)}
sourcePaths:
${renderYamlPaths(candidate.sourcePaths)}
ackPaths:
${renderYamlPaths(candidate.ackPaths)}
severitySummary:
  p1: ${candidate.severitySummary.p1}
  p2: ${candidate.severitySummary.p2}
  p3: ${candidate.severitySummary.p3}
  hasNone: ${candidate.severitySummary.hasNone}
recoveredAt: ${yamlScalar(options.recoveredAt)}
recoveredBy: ${yamlScalar("tap reviews recover")}
sourcePreserved: true
---
`;
}

function renderYamlPaths(paths: CandidatePath[]): string {
  if (paths.length === 0) return "  []";
  return paths
    .map(
      (entry) => `  - host: ${yamlScalar(entry.host)}
    root: ${yamlScalar(entry.root)}
    path: ${yamlScalar(entry.path)}
    sourceKind: ${yamlScalar(entry.sourceKind)}`,
    )
    .join("\n");
}

function renderPathBullets(paths: CandidatePath[]): string {
  if (paths.length === 0) return "- none";
  return paths
    .map(
      (entry) =>
        `- ${entry.sourceKind}: ${entry.host}:${entry.root}/${entry.path}`,
    )
    .join("\n");
}

function renderSelectedReviewExcerpts(
  candidate: ReviewRecoveryCandidate,
): string {
  const outcomePaths = candidate.sourcePaths.filter((sourcePath) =>
    ["review-findings", "review-clean", "rereview-clean"].includes(
      sourcePath.sourceKind,
    ),
  );
  if (outcomePaths.length === 0) return "- none";
  return outcomePaths
    .map((sourcePath) => {
      const filePath = path.join(sourcePath.root, sourcePath.path);
      const excerpt = fs.existsSync(filePath)
        ? extractReviewExcerpt(
            splitFrontmatter(fs.readFileSync(filePath, "utf8")).body,
          )
        : "[source file not available during recovery render]";
      return [
        `### ${sourcePath.sourceKind}: ${sourcePath.host}:${sourcePath.root}/${sourcePath.path}`,
        "",
        indentBlock(excerpt),
      ].join("\n");
    })
    .join("\n\n");
}

function extractReviewExcerpt(body: string): string {
  const normalized = body.replace(/\r\n/g, "\n").trim();
  const findingsIndex = normalized.search(/^Findings\s*[:：]\s*$/im);
  const start = findingsIndex >= 0 ? findingsIndex : 0;
  const tail = normalized.slice(start);
  const stopMatch = tail.match(/\n(?:Reply|Instructions)\s*[:：]/i);
  const bounded = stopMatch ? tail.slice(0, stopMatch.index) : tail;
  const lines = bounded.trim().split("\n").slice(0, 80);
  let excerpt = lines.join("\n");
  if (bounded.length > excerpt.length || bounded.split("\n").length > 80) {
    excerpt += "\n[truncated]";
  }
  if (excerpt.length > 4000) excerpt = `${excerpt.slice(0, 4000)}\n[truncated]`;
  return excerpt;
}

function indentBlock(value: string): string {
  return value
    .split("\n")
    .map((line) => `    ${line}`)
    .join("\n");
}

function yamlNullable(value: string | null): string {
  return value === null ? "null" : yamlScalar(value);
}

function yamlScalar(value: string): string {
  return JSON.stringify(value);
}
