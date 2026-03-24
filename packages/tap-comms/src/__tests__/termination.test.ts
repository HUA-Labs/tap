import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  evaluate,
  computeFindingHash,
  DEFAULT_TERMINATION_CONFIG,
  type TerminationContext,
  type ReviewRound,
  type ReviewFinding,
} from "../engine/termination.js";

let tmpDir: string;
let stopSignalPath: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tap-term-test-"));
  stopSignalPath = path.join(tmpDir, "stop-signal");
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ── Helpers ──────────────────────────────────────────────────────

function makeRound(overrides: Partial<ReviewRound> = {}): ReviewRound {
  return {
    round: 1,
    timestamp: new Date().toISOString(),
    findingCount: 0,
    findings: [],
    suggestedDiffLines: 0,
    findingHash: "empty",
    ...overrides,
  };
}

function makeFinding(overrides: Partial<ReviewFinding> = {}): ReviewFinding {
  return {
    severity: "medium",
    category: "general",
    description: "test finding",
    ...overrides,
  };
}

function makeContext(
  overrides: Partial<TerminationContext> = {},
): TerminationContext {
  return {
    round: 1,
    rounds: [],
    stopSignalPath,
    config: { ...DEFAULT_TERMINATION_CONFIG },
    ...overrides,
  };
}

// ── computeFindingHash ───────────────────────────────────────────

describe("computeFindingHash", () => {
  it("returns 'empty' for no findings", () => {
    expect(computeFindingHash([])).toBe("empty");
  });

  it("returns 'empty' when no high+ severity findings", () => {
    const findings: ReviewFinding[] = [
      makeFinding({ severity: "medium", description: "some issue" }),
      makeFinding({ severity: "low", description: "minor thing" }),
    ];
    expect(computeFindingHash(findings)).toBe("empty");
  });

  it("produces consistent hash for same findings", () => {
    const findings: ReviewFinding[] = [
      makeFinding({
        severity: "high",
        category: "security",
        description: "SQL injection in query",
      }),
    ];
    const hash1 = computeFindingHash(findings);
    const hash2 = computeFindingHash(findings);
    expect(hash1).toBe(hash2);
    expect(hash1).not.toBe("empty");
    expect(hash1).toHaveLength(16);
  });

  it("produces different hashes for different findings", () => {
    const findingsA: ReviewFinding[] = [
      makeFinding({
        severity: "critical",
        category: "security",
        description: "XSS vulnerability",
      }),
    ];
    const findingsB: ReviewFinding[] = [
      makeFinding({
        severity: "critical",
        category: "security",
        description: "CSRF missing",
      }),
    ];
    expect(computeFindingHash(findingsA)).not.toBe(
      computeFindingHash(findingsB),
    );
  });

  it("sorts findings for order-independent hashing", () => {
    const findingA = makeFinding({
      severity: "high",
      category: "a",
      description: "first",
    });
    const findingB = makeFinding({
      severity: "high",
      category: "b",
      description: "second",
    });
    const hash1 = computeFindingHash([findingA, findingB]);
    const hash2 = computeFindingHash([findingB, findingA]);
    expect(hash1).toBe(hash2);
  });
});

// ── manual-stop ──────────────────────────────────────────────────

describe("manual-stop strategy", () => {
  it("stops when stop signal file exists", () => {
    fs.writeFileSync(stopSignalPath, "stop", "utf-8");
    const ctx = makeContext({ round: 1 });
    const result = evaluate(ctx);
    expect(result.verdict).toBe("stop");
    expect(result.strategy).toBe("manual-stop");
  });

  it("continues when stop signal file does not exist", () => {
    const ctx = makeContext({
      round: 1,
      config: { ...DEFAULT_TERMINATION_CONFIG, strategies: ["manual-stop"] },
    });
    const result = evaluate(ctx);
    expect(result.verdict).toBe("continue");
  });
});

// ── round-cap ────────────────────────────────────────────────────

describe("round-cap strategy", () => {
  it("stops at max rounds", () => {
    const ctx = makeContext({
      round: 5,
      config: { ...DEFAULT_TERMINATION_CONFIG, maxRounds: 5 },
    });
    const result = evaluate(ctx);
    expect(result.verdict).toBe("stop");
    expect(result.strategy).toBe("round-cap");
  });

  it("stops when exceeding max rounds", () => {
    const ctx = makeContext({
      round: 7,
      config: { ...DEFAULT_TERMINATION_CONFIG, maxRounds: 5 },
    });
    const result = evaluate(ctx);
    expect(result.verdict).toBe("stop");
    expect(result.strategy).toBe("round-cap");
  });

  it("continues below max rounds", () => {
    const ctx = makeContext({
      round: 3,
      config: {
        ...DEFAULT_TERMINATION_CONFIG,
        strategies: ["round-cap"],
        maxRounds: 5,
      },
    });
    const result = evaluate(ctx);
    expect(result.verdict).toBe("continue");
  });
});

// ── repetition-detection ─────────────────────────────────────────

describe("repetition-detection strategy", () => {
  it("stops when same finding hash repeats", () => {
    const hash = "abcdef1234567890";
    const rounds: ReviewRound[] = [
      makeRound({ round: 1, findingHash: hash }),
      makeRound({ round: 2, findingHash: hash }),
    ];
    const ctx = makeContext({
      round: 2,
      rounds,
      config: {
        ...DEFAULT_TERMINATION_CONFIG,
        strategies: ["repetition-detection"],
        repetitionThreshold: 2,
      },
    });
    const result = evaluate(ctx);
    expect(result.verdict).toBe("stop");
    expect(result.strategy).toBe("repetition-detection");
  });

  it("continues when hashes are different", () => {
    const rounds: ReviewRound[] = [
      makeRound({ round: 1, findingHash: "hash1111" }),
      makeRound({ round: 2, findingHash: "hash2222" }),
    ];
    const ctx = makeContext({
      round: 2,
      rounds,
      config: {
        ...DEFAULT_TERMINATION_CONFIG,
        strategies: ["repetition-detection"],
        repetitionThreshold: 2,
      },
    });
    const result = evaluate(ctx);
    expect(result.verdict).toBe("continue");
  });

  it("continues with only one round", () => {
    const rounds: ReviewRound[] = [makeRound({ round: 1, findingHash: "abc" })];
    const ctx = makeContext({
      round: 1,
      rounds,
      config: {
        ...DEFAULT_TERMINATION_CONFIG,
        strategies: ["repetition-detection"],
      },
    });
    const result = evaluate(ctx);
    expect(result.verdict).toBe("continue");
  });
});

// ── quality-threshold ────────────────────────────────────────────

describe("quality-threshold strategy", () => {
  it("stops when no high+ findings in latest round", () => {
    const rounds: ReviewRound[] = [
      makeRound({
        round: 1,
        findings: [
          makeFinding({ severity: "low" }),
          makeFinding({ severity: "nitpick" }),
        ],
      }),
    ];
    const ctx = makeContext({
      round: 1,
      rounds,
      config: {
        ...DEFAULT_TERMINATION_CONFIG,
        strategies: ["quality-threshold"],
        qualitySeverityFloor: "high",
      },
    });
    const result = evaluate(ctx);
    expect(result.verdict).toBe("stop");
    expect(result.strategy).toBe("quality-threshold");
  });

  it("continues when high finding exists", () => {
    const rounds: ReviewRound[] = [
      makeRound({
        round: 1,
        findings: [
          makeFinding({ severity: "high", description: "auth bypass" }),
        ],
      }),
    ];
    const ctx = makeContext({
      round: 1,
      rounds,
      config: {
        ...DEFAULT_TERMINATION_CONFIG,
        strategies: ["quality-threshold"],
        qualitySeverityFloor: "high",
      },
    });
    const result = evaluate(ctx);
    expect(result.verdict).toBe("continue");
  });

  it("stops when floor is medium and only low/nitpick found", () => {
    const rounds: ReviewRound[] = [
      makeRound({
        round: 1,
        findings: [makeFinding({ severity: "low" })],
      }),
    ];
    const ctx = makeContext({
      round: 1,
      rounds,
      config: {
        ...DEFAULT_TERMINATION_CONFIG,
        strategies: ["quality-threshold"],
        qualitySeverityFloor: "medium",
      },
    });
    const result = evaluate(ctx);
    expect(result.verdict).toBe("stop");
  });

  it("continues with no rounds", () => {
    const ctx = makeContext({
      round: 0,
      rounds: [],
      config: {
        ...DEFAULT_TERMINATION_CONFIG,
        strategies: ["quality-threshold"],
      },
    });
    const result = evaluate(ctx);
    expect(result.verdict).toBe("continue");
  });

  it("treats empty output as inconclusive, not clean (P2 fix)", () => {
    // Malformed review output: parser extracts nothing
    const rounds: ReviewRound[] = [
      makeRound({
        round: 1,
        findingCount: 0,
        findings: [],
        suggestedDiffLines: 0,
      }),
    ];
    const ctx = makeContext({
      round: 1,
      rounds,
      config: {
        ...DEFAULT_TERMINATION_CONFIG,
        strategies: ["quality-threshold"],
        qualitySeverityFloor: "high",
      },
    });
    const result = evaluate(ctx);
    // Should NOT stop — empty output is inconclusive
    expect(result.verdict).toBe("continue");
  });
});

// ── diff-insignificance ──────────────────────────────────────────

describe("diff-insignificance strategy", () => {
  it("stops when suggested diff below threshold", () => {
    const rounds: ReviewRound[] = [
      makeRound({ round: 1, suggestedDiffLines: 2 }),
    ];
    const ctx = makeContext({
      round: 1,
      rounds,
      config: {
        ...DEFAULT_TERMINATION_CONFIG,
        strategies: ["diff-insignificance"],
        diffThreshold: 3,
      },
    });
    const result = evaluate(ctx);
    expect(result.verdict).toBe("stop");
    expect(result.strategy).toBe("diff-insignificance");
  });

  it("continues when suggested diff at threshold", () => {
    const rounds: ReviewRound[] = [
      makeRound({ round: 1, suggestedDiffLines: 3 }),
    ];
    const ctx = makeContext({
      round: 1,
      rounds,
      config: {
        ...DEFAULT_TERMINATION_CONFIG,
        strategies: ["diff-insignificance"],
        diffThreshold: 3,
      },
    });
    const result = evaluate(ctx);
    expect(result.verdict).toBe("continue");
  });

  it("continues when suggested diff above threshold", () => {
    const rounds: ReviewRound[] = [
      makeRound({ round: 1, suggestedDiffLines: 50 }),
    ];
    const ctx = makeContext({
      round: 1,
      rounds,
      config: {
        ...DEFAULT_TERMINATION_CONFIG,
        strategies: ["diff-insignificance"],
        diffThreshold: 3,
      },
    });
    const result = evaluate(ctx);
    expect(result.verdict).toBe("continue");
  });

  it("treats empty output as inconclusive, not trivial (P2 fix)", () => {
    const rounds: ReviewRound[] = [
      makeRound({
        round: 1,
        findingCount: 0,
        findings: [],
        suggestedDiffLines: 0,
      }),
    ];
    const ctx = makeContext({
      round: 1,
      rounds,
      config: {
        ...DEFAULT_TERMINATION_CONFIG,
        strategies: ["diff-insignificance"],
        diffThreshold: 3,
      },
    });
    const result = evaluate(ctx);
    // Should NOT stop — empty output is inconclusive
    expect(result.verdict).toBe("continue");
  });
});

// ── Evaluation order ─────────────────────────────────────────────

describe("evaluation order", () => {
  it("manual-stop wins over round-cap", () => {
    fs.writeFileSync(stopSignalPath, "stop", "utf-8");
    const ctx = makeContext({
      round: 10,
      config: {
        ...DEFAULT_TERMINATION_CONFIG,
        strategies: ["manual-stop", "round-cap"],
        maxRounds: 5,
      },
    });
    const result = evaluate(ctx);
    expect(result.strategy).toBe("manual-stop");
  });

  it("round-cap wins when manual-stop not triggered", () => {
    const ctx = makeContext({
      round: 5,
      config: {
        ...DEFAULT_TERMINATION_CONFIG,
        strategies: ["manual-stop", "round-cap"],
        maxRounds: 5,
      },
    });
    const result = evaluate(ctx);
    expect(result.strategy).toBe("round-cap");
  });

  it("returns continue when all strategies pass", () => {
    const rounds: ReviewRound[] = [
      makeRound({
        round: 1,
        suggestedDiffLines: 50,
        findings: [makeFinding({ severity: "high" })],
        findingHash: "unique-hash-1",
      }),
    ];
    const ctx = makeContext({
      round: 1,
      rounds,
      config: {
        ...DEFAULT_TERMINATION_CONFIG,
        maxRounds: 10,
      },
    });
    const result = evaluate(ctx);
    expect(result.verdict).toBe("continue");
  });
});

// ── Default config ───────────────────────────────────────────────

describe("DEFAULT_TERMINATION_CONFIG", () => {
  it("has all 5 strategies", () => {
    expect(DEFAULT_TERMINATION_CONFIG.strategies).toHaveLength(5);
    expect(DEFAULT_TERMINATION_CONFIG.strategies).toContain("manual-stop");
    expect(DEFAULT_TERMINATION_CONFIG.strategies).toContain("round-cap");
    expect(DEFAULT_TERMINATION_CONFIG.strategies).toContain(
      "repetition-detection",
    );
    expect(DEFAULT_TERMINATION_CONFIG.strategies).toContain(
      "quality-threshold",
    );
    expect(DEFAULT_TERMINATION_CONFIG.strategies).toContain(
      "diff-insignificance",
    );
  });

  it("has sensible defaults", () => {
    expect(DEFAULT_TERMINATION_CONFIG.maxRounds).toBe(5);
    expect(DEFAULT_TERMINATION_CONFIG.diffThreshold).toBe(3);
    expect(DEFAULT_TERMINATION_CONFIG.repetitionThreshold).toBe(2);
    expect(DEFAULT_TERMINATION_CONFIG.qualitySeverityFloor).toBe("high");
  });
});
