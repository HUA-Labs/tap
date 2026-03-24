/**
 * Termination engine — decides when a review session should stop.
 *
 * Strategies are evaluated in priority order. First non-"continue" verdict wins.
 * Default order: manual-stop → round-cap → repetition → quality → diff-insignificance
 */
import * as fs from "node:fs";
import * as crypto from "node:crypto";

// ── Types ──────────────────────────────────────────────────────────

export type TerminationStrategy =
  | "diff-insignificance"
  | "repetition-detection"
  | "quality-threshold"
  | "round-cap"
  | "manual-stop";

export type TerminationVerdict = "continue" | "stop" | "escalate";

export type FindingSeverity =
  | "critical"
  | "high"
  | "medium"
  | "low"
  | "nitpick";

export interface ReviewFinding {
  severity: FindingSeverity;
  category: string;
  description: string;
  file?: string;
  line?: number;
}

export interface ReviewRound {
  round: number;
  timestamp: string;
  findingCount: number;
  findings: ReviewFinding[];
  suggestedDiffLines: number;
  findingHash: string;
}

export interface TerminationConfig {
  strategies: TerminationStrategy[];
  maxRounds: number;
  diffThreshold: number;
  repetitionThreshold: number;
  qualitySeverityFloor: FindingSeverity;
}

export interface TerminationContext {
  round: number;
  rounds: ReviewRound[];
  stopSignalPath: string;
  config: TerminationConfig;
}

export interface TerminationResult {
  verdict: TerminationVerdict;
  reason: string;
  strategy: TerminationStrategy;
  summary: string;
}

// ── Defaults ───────────────────────────────────────────────────────

export const DEFAULT_TERMINATION_CONFIG: TerminationConfig = {
  strategies: [
    "manual-stop",
    "round-cap",
    "repetition-detection",
    "quality-threshold",
    "diff-insignificance",
  ],
  maxRounds: 5,
  diffThreshold: 3,
  repetitionThreshold: 2,
  qualitySeverityFloor: "high",
};

// ── Severity ranking ───────────────────────────────────────────────

const SEVERITY_RANK: Record<FindingSeverity, number> = {
  critical: 5,
  high: 4,
  medium: 3,
  low: 2,
  nitpick: 1,
};

function isAtOrAbove(
  severity: FindingSeverity,
  floor: FindingSeverity,
): boolean {
  return SEVERITY_RANK[severity] >= SEVERITY_RANK[floor];
}

// ── Finding hash ───────────────────────────────────────────────────

export function computeFindingHash(findings: ReviewFinding[]): string {
  const normalized = findings
    .filter((f) => isAtOrAbove(f.severity, "high"))
    .map((f) => `${f.category}:${f.description.slice(0, 100)}`)
    .sort()
    .join("|");

  if (!normalized) return "empty";

  return crypto
    .createHash("sha256")
    .update(normalized)
    .digest("hex")
    .slice(0, 16);
}

// ── Strategy evaluators ────────────────────────────────────────────

function evalManualStop(ctx: TerminationContext): TerminationResult | null {
  if (fs.existsSync(ctx.stopSignalPath)) {
    return {
      verdict: "stop",
      reason: `Manual stop signal found at ${ctx.stopSignalPath}`,
      strategy: "manual-stop",
      summary: `Review stopped manually at round ${ctx.round}`,
    };
  }
  return null;
}

function evalRoundCap(ctx: TerminationContext): TerminationResult | null {
  if (ctx.round >= ctx.config.maxRounds) {
    return {
      verdict: "stop",
      reason: `Round cap reached (${ctx.round}/${ctx.config.maxRounds})`,
      strategy: "round-cap",
      summary: `Review stopped at round cap (${ctx.config.maxRounds})`,
    };
  }
  return null;
}

function evalRepetition(ctx: TerminationContext): TerminationResult | null {
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
      summary: `Review going in circles — same findings repeated ${count}x`,
    };
  }

  return null;
}

function evalQualityThreshold(
  ctx: TerminationContext,
): TerminationResult | null {
  if (ctx.rounds.length === 0) return null;

  const latest = ctx.rounds[ctx.rounds.length - 1];
  if (!latest) return null;

  // Guard: if parser extracted nothing at all (0 findings + 0 diff lines),
  // treat as inconclusive — not "clean". The parser may have failed to
  // extract from malformed output.
  if (
    latest.findingCount === 0 &&
    latest.suggestedDiffLines === 0 &&
    latest.findings.length === 0
  ) {
    return null; // inconclusive — continue to next strategy
  }

  const significantFindings = latest.findings.filter((f) =>
    isAtOrAbove(f.severity, ctx.config.qualitySeverityFloor),
  );

  if (significantFindings.length === 0) {
    return {
      verdict: "stop",
      reason: `No findings at ${ctx.config.qualitySeverityFloor}+ severity in round ${ctx.round}`,
      strategy: "quality-threshold",
      summary: `Review clean — no ${ctx.config.qualitySeverityFloor}+ findings in round ${ctx.round}`,
    };
  }

  return null;
}

function evalDiffInsignificance(
  ctx: TerminationContext,
): TerminationResult | null {
  if (ctx.rounds.length === 0) return null;

  const latest = ctx.rounds[ctx.rounds.length - 1];
  if (!latest) return null;

  // Guard: same as quality-threshold — empty output is inconclusive, not trivial
  if (
    latest.findingCount === 0 &&
    latest.suggestedDiffLines === 0 &&
    latest.findings.length === 0
  ) {
    return null;
  }

  if (latest.suggestedDiffLines < ctx.config.diffThreshold) {
    return {
      verdict: "stop",
      reason: `Suggested diff (${latest.suggestedDiffLines} lines) below threshold (${ctx.config.diffThreshold})`,
      strategy: "diff-insignificance",
      summary: `Review suggestions are trivial (${latest.suggestedDiffLines} lines)`,
    };
  }

  return null;
}

const STRATEGY_EVALUATORS: Record<
  TerminationStrategy,
  (ctx: TerminationContext) => TerminationResult | null
> = {
  "manual-stop": evalManualStop,
  "round-cap": evalRoundCap,
  "repetition-detection": evalRepetition,
  "quality-threshold": evalQualityThreshold,
  "diff-insignificance": evalDiffInsignificance,
};

// ── Main evaluator ─────────────────────────────────────────────────

export function evaluate(ctx: TerminationContext): TerminationResult {
  for (const strategy of ctx.config.strategies) {
    const evaluator = STRATEGY_EVALUATORS[strategy];
    if (!evaluator) continue;

    const result = evaluator(ctx);
    if (result) return result;
  }

  return {
    verdict: "continue",
    reason: "All strategies passed — review continues",
    strategy:
      ctx.config.strategies[ctx.config.strategies.length - 1] ?? "round-cap",
    summary: `Round ${ctx.round} complete, continuing`,
  };
}
