import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { reviewsCommand } from "../commands/reviews.js";

let tmpDir: string;

function writeMessage(
  root: string,
  area: "inbox" | "archive" | "reviews",
  filename: string,
  fields: Record<string, string>,
  body: string,
): void {
  const filePath = path.join(root, area, filename);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const frontmatter = Object.entries(fields)
    .map(([key, value]) => `${key}: "${value}"`)
    .join("\n");
  fs.writeFileSync(filePath, `---\n${frontmatter}\n---\n${body}`, "utf8");
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tap-reviews-command-"));
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("reviewsCommand", () => {
  it("plans clean review registration from an inbox-only formal outcome", async () => {
    const root = path.join(tmpDir, "comms");
    const source = path.join(
      root,
      "inbox",
      "20260616-준-윤-review-pr1562-m575-closeout-clean.md",
    );
    writeMessage(
      root,
      "inbox",
      path.basename(source),
      { subject: "review-pr1562-m575-closeout-clean", from: "준", to: "윤" },
      "P1/P2/P3: none.\n\nVerification:\n- `pnpm generate:missions:generate-only` PASS.",
    );

    const result = await reviewsCommand([
      "register",
      "--source",
      source,
      "--comms-dir",
      root,
    ]);

    expect(result.ok).toBe(true);
    expect(result.code).toBe("TAP_REVIEWS_REGISTER_OK");
    const data = result.data as {
      summary: Record<string, number>;
      registrations: Array<Record<string, unknown>>;
    };
    expect(data.summary).toEqual(
      expect.objectContaining({
        formalOutcomeCount: 1,
        plannedCount: 1,
        blockedCount: 0,
      }),
    );
    expect(data.registrations).toEqual([
      expect.objectContaining({
        status: "planned",
        source: expect.objectContaining({
          prNumber: 1562,
          outcomeType: "closeout-clean",
          classification: "formal-outcome",
          severitySummary: expect.objectContaining({ hasNone: true }),
          verificationSummary: expect.arrayContaining([
            expect.stringContaining("PASS"),
          ]),
        }),
      }),
    ]);
    expect(fs.existsSync(path.join(root, "reviews", "registered"))).toBe(false);
  });

  it("registers findings and rereview outcomes with severity and round metadata", async () => {
    const root = path.join(tmpDir, "comms");
    const findings = path.join(
      root,
      "inbox",
      "20260616-준-봄-review-pr1560-m575-r1.md",
    );
    const rereview = path.join(
      root,
      "inbox",
      "20260616-준-봄-r2-review-pr1560-clean.md",
    );
    writeMessage(
      root,
      "inbox",
      path.basename(findings),
      { subject: "review-pr1560-m575-r1", from: "준", to: "봄" },
      "Findings:\n\nP2 `packages/tap-comms/src/commands/flow-doctor.ts:675` - scan window mismatch.",
    );
    writeMessage(
      root,
      "inbox",
      path.basename(rereview),
      { subject: "r2-review-pr1560-m575-clean", from: "준", to: "봄" },
      "P1/P2/P3: none.\n\nVerification:\n- type-check PASS.",
    );

    const result = await reviewsCommand([
      "register",
      "--source",
      findings,
      "--source",
      rereview,
      "--comms-dir",
      root,
    ]);

    const data = result.data as {
      registrations: Array<{ source: Record<string, unknown> }>;
    };
    expect(data.registrations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: expect.objectContaining({
            prNumber: 1560,
            round: "R1",
            outcomeType: "findings",
            severitySummary: expect.objectContaining({ p2: 1 }),
          }),
        }),
        expect.objectContaining({
          source: expect.objectContaining({
            prNumber: 1560,
            round: "R2",
            outcomeType: "rereview-clean",
            severitySummary: expect.objectContaining({ hasNone: true }),
          }),
        }),
      ]),
    );
  });

  it("deduplicates CC recipient copies into one canonical registration", async () => {
    const root = path.join(tmpDir, "comms");
    const body = "P1/P2/P3: none.\n\nVerification:\n- build PASS.";
    const direct = path.join(
      root,
      "inbox",
      "20260616-준-봄-pr1555-r2-review-clean.md",
    );
    const cc = path.join(
      root,
      "inbox",
      "20260616-준-윤-pr1555-r2-review-clean.md",
    );
    writeMessage(
      root,
      "inbox",
      path.basename(direct),
      { subject: "pr1555-r2-review-clean", from: "준", to: "봄" },
      body,
    );
    writeMessage(
      root,
      "inbox",
      path.basename(cc),
      { subject: "pr1555-r2-review-clean", from: "준", to: "윤" },
      body,
    );

    const result = await reviewsCommand([
      "register",
      "--source",
      direct,
      "--source",
      cc,
      "--comms-dir",
      root,
    ]);

    const data = result.data as {
      summary: Record<string, number>;
      registrations: Array<Record<string, unknown>>;
    };
    expect(data.summary).toEqual(
      expect.objectContaining({ plannedCount: 1, duplicateSourceCount: 1 }),
    );
    expect(data.registrations.map((entry) => entry.status)).toEqual([
      "planned",
      "duplicate-source",
    ]);
    expect(
      new Set(data.registrations.map((entry) => entry.dedupeKey)).size,
    ).toBe(1);
  });

  it("deduplicates corrected unknown-author replay records without rewriting sources", async () => {
    const root = path.join(tmpDir, "comms");
    const body = "P1/P2/P3: none.\n\nVerification:\n- type-check PASS.";
    const unknown = path.join(
      root,
      "inbox",
      "20260616-unknown-윤-pr1550-r2-review-clean.md",
    );
    const corrected = path.join(
      root,
      "inbox",
      "20260616-준-윤-pr1550-r2-review-clean.md",
    );
    writeMessage(
      root,
      "inbox",
      path.basename(unknown),
      { subject: "pr1550-r2-review-clean", from: "unknown", to: "윤" },
      body,
    );
    writeMessage(
      root,
      "inbox",
      path.basename(corrected),
      { subject: "pr1550-r2-review-clean", from: "준", to: "윤" },
      body,
    );
    const unknownRaw = fs.readFileSync(unknown, "utf8");
    const correctedRaw = fs.readFileSync(corrected, "utf8");

    const result = await reviewsCommand([
      "register",
      "--source",
      unknown,
      "--source",
      corrected,
      "--comms-dir",
      root,
    ]);

    const data = result.data as {
      summary: Record<string, number>;
      registrations: Array<Record<string, unknown>>;
    };
    expect(data.summary).toEqual(
      expect.objectContaining({ plannedCount: 1, duplicateSourceCount: 1 }),
    );
    expect(
      new Set(data.registrations.map((entry) => entry.dedupeKey)).size,
    ).toBe(1);
    expect(fs.readFileSync(unknown, "utf8")).toBe(unknownRaw);
    expect(fs.readFileSync(corrected, "utf8")).toBe(correctedRaw);
  });

  it("keeps merge acks and stale review-meta chatter provenance-only", async () => {
    const root = path.join(tmpDir, "comms");
    const mergeAck = path.join(
      root,
      "inbox",
      "20260616-윤-봄-pr1562-merged.md",
    );
    const staleMeta = path.join(
      root,
      "inbox",
      "20260616-준-봄-pr1556-r2-superseded-message.md",
    );
    writeMessage(
      root,
      "inbox",
      path.basename(mergeAck),
      { subject: "pr1562-m575-closeout-merge-confirmed", from: "윤", to: "봄" },
      "PR #1562 merged with commit abc123.",
    );
    writeMessage(
      root,
      "inbox",
      path.basename(staleMeta),
      {
        subject: "pr1556-r2-superseded-message-already-resolved",
        from: "준",
        to: "봄",
      },
      "Terminal state is already known; no new formal review outcome.",
    );

    const result = await reviewsCommand([
      "register",
      "--source",
      mergeAck,
      "--source",
      staleMeta,
      "--comms-dir",
      root,
    ]);

    const data = result.data as {
      summary: Record<string, number>;
      provenanceOnly: Array<Record<string, unknown>>;
    };
    expect(result.ok).toBe(true);
    expect(data.summary).toEqual(
      expect.objectContaining({
        formalOutcomeCount: 0,
        provenanceOnlyCount: 2,
        plannedCount: 0,
      }),
    );
    expect(data.provenanceOnly).toHaveLength(2);
  });

  it("keeps review requests with quoted severity as provenance-only", async () => {
    const root = path.join(tmpDir, "comms");
    const source = path.join(
      root,
      "inbox",
      "20260616-봄-준-review-request-pr9999.md",
    );
    writeMessage(
      root,
      "inbox",
      path.basename(source),
      { subject: "review-request-pr9999", from: "봄", to: "준" },
      [
        "리뷰 담당에게 PR #9999 리뷰 요청.",
        "",
        "Prior reviewer result included for context:",
        "P1/P2/P3: none.",
      ].join("\n"),
    );

    const dryRun = await reviewsCommand([
      "register",
      "--source",
      source,
      "--comms-dir",
      root,
    ]);
    const apply = await reviewsCommand([
      "register",
      "--source",
      source,
      "--comms-dir",
      root,
      "--apply",
      "--limit",
      "1",
    ]);

    const dryRunData = dryRun.data as {
      summary: Record<string, number>;
      provenanceOnly: Array<Record<string, unknown>>;
    };
    const applyData = apply.data as {
      summary: Record<string, number>;
      provenanceOnly: Array<Record<string, unknown>>;
    };
    expect(dryRun.ok).toBe(true);
    expect(apply.ok).toBe(true);
    expect(dryRunData.summary).toEqual(
      expect.objectContaining({
        formalOutcomeCount: 0,
        plannedCount: 0,
        provenanceOnlyCount: 1,
      }),
    );
    expect(applyData.summary).toEqual(
      expect.objectContaining({
        appliedCount: 0,
        provenanceOnlyCount: 1,
      }),
    );
    expect(dryRunData.provenanceOnly[0]).toEqual(
      expect.objectContaining({
        reason: "review request is provenance-only",
      }),
    );
    expect(fs.existsSync(path.join(root, "reviews", "registered"))).toBe(false);
  });

  it("does not suppress stale-looking messages that contain a new formal outcome", async () => {
    const root = path.join(tmpDir, "comms");
    const source = path.join(
      root,
      "inbox",
      "20260616-준-봄-stale-r2-review-pr1556-clean.md",
    );
    writeMessage(
      root,
      "inbox",
      path.basename(source),
      { subject: "stale-r2-review-pr1556-clean", from: "준", to: "봄" },
      "P1/P2/P3: none.\n\nVerification:\n- diff check PASS.",
    );

    const result = await reviewsCommand([
      "register",
      "--source",
      source,
      "--comms-dir",
      root,
    ]);

    const data = result.data as {
      summary: Record<string, number>;
      registrations: Array<Record<string, unknown>>;
    };
    expect(data.summary).toEqual(
      expect.objectContaining({ formalOutcomeCount: 1, plannedCount: 1 }),
    );
    expect(data.registrations[0]).toEqual(
      expect.objectContaining({
        source: expect.objectContaining({ outcomeType: "rereview-clean" }),
      }),
    );
  });

  it("applies registration artifacts idempotently and preserves source files", async () => {
    const root = path.join(tmpDir, "comms");
    const source = path.join(
      root,
      "inbox",
      "20260616-준-봄-pr1554-review-clean.md",
    );
    writeMessage(
      root,
      "inbox",
      path.basename(source),
      { subject: "pr1554-review-clean", from: "준", to: "봄" },
      "P1/P2/P3: none.\n\nVerification:\n- focused tests PASS.",
    );
    const originalSource = fs.readFileSync(source, "utf8");
    const args = [
      "register",
      "--source",
      source,
      "--comms-dir",
      root,
      "--apply",
      "--limit",
      "1",
    ];

    const first = await reviewsCommand(args);
    const second = await reviewsCommand(args);

    const firstData = first.data as {
      registrations: Array<Record<string, unknown>>;
    };
    const secondData = second.data as {
      summary: Record<string, number>;
      registrations: Array<Record<string, unknown>>;
    };
    expect(firstData.registrations[0]).toEqual(
      expect.objectContaining({ status: "applied" }),
    );
    expect(secondData.summary).toEqual(
      expect.objectContaining({ alreadyRegisteredCount: 1 }),
    );
    expect(secondData.registrations[0]).toEqual(
      expect.objectContaining({ status: "already-registered" }),
    );
    expect(fs.readFileSync(source, "utf8")).toBe(originalSource);
  });

  it("reports collision handling without overwriting an existing artifact", async () => {
    const root = path.join(tmpDir, "comms");
    const source = path.join(
      root,
      "inbox",
      "20260616-준-봄-pr1554-review-clean.md",
    );
    writeMessage(
      root,
      "inbox",
      path.basename(source),
      { subject: "pr1554-review-clean", from: "준", to: "봄" },
      "P1/P2/P3: none.\n\nVerification:\n- focused tests PASS.",
    );
    const dryRun = await reviewsCommand([
      "register",
      "--source",
      source,
      "--comms-dir",
      root,
    ]);
    const dryRunData = dryRun.data as {
      registrations: Array<{ artifactPath: string }>;
    };
    const artifactPath = dryRunData.registrations[0]?.artifactPath;
    fs.mkdirSync(path.dirname(artifactPath), { recursive: true });
    fs.writeFileSync(artifactPath, "different artifact", "utf8");

    const result = await reviewsCommand([
      "register",
      "--source",
      source,
      "--comms-dir",
      root,
      "--apply",
      "--limit",
      "1",
    ]);

    const data = result.data as {
      summary: Record<string, number>;
      blocked: Array<Record<string, unknown>>;
    };
    expect(result.ok).toBe(false);
    expect(data.summary).toEqual(expect.objectContaining({ blockedCount: 1 }));
    expect(data.blocked[0]).toEqual(
      expect.objectContaining({
        status: "blocked",
        reason: "registration artifact path collision",
      }),
    );
    expect(fs.readFileSync(artifactPath, "utf8")).toBe("different artifact");
  });

  it("reports bounded inbox-only review outcomes from a PR scan", async () => {
    const root = path.join(tmpDir, "comms");
    writeMessage(
      root,
      "inbox",
      "20260616-준-봄-pr1547-r4-review-clean.md",
      { subject: "pr1547-r4-review-clean", from: "준", to: "봄" },
      "P1/P2/P3: none.\n\nVerification:\n- link smoke PASS.",
    );
    writeMessage(
      root,
      "inbox",
      "20260616-윤-봄-pr1547-merge-result.md",
      { subject: "pr1547-merge-result", from: "윤", to: "봄" },
      "PR #1547 merged.",
    );

    const result = await reviewsCommand([
      "register",
      "--pr",
      "1547",
      "--comms-dir",
      root,
    ]);

    const data = result.data as {
      scanned: number;
      summary: Record<string, number>;
      registrations: Array<Record<string, unknown>>;
      provenanceOnly: Array<Record<string, unknown>>;
    };
    expect(data.scanned).toBe(2);
    expect(data.summary).toEqual(
      expect.objectContaining({
        formalOutcomeCount: 1,
        plannedCount: 1,
        provenanceOnlyCount: 1,
      }),
    );
    expect(data.registrations[0]).toEqual(
      expect.objectContaining({ status: "planned" }),
    );
    expect(data.provenanceOnly[0]).toEqual(
      expect.objectContaining({
        reason: "merge acknowledgement is provenance-only",
      }),
    );

    const applied = await reviewsCommand([
      "register",
      "--pr",
      "1547",
      "--comms-dir",
      root,
      "--apply",
      "--limit",
      "1",
    ]);
    const repeated = await reviewsCommand([
      "register",
      "--pr",
      "1547",
      "--comms-dir",
      root,
      "--apply",
      "--limit",
      "1",
    ]);
    expect(
      (applied.data as { summary: Record<string, number> }).summary,
    ).toEqual(expect.objectContaining({ appliedCount: 1 }));
    expect(
      (repeated.data as { summary: Record<string, number> }).summary,
    ).toEqual(expect.objectContaining({ alreadyRegisteredCount: 1 }));
  });

  it("reports findings review and R2 clean rereview candidates without writing artifacts", async () => {
    const root = path.join(tmpDir, "comms");
    writeMessage(
      root,
      "inbox",
      "20260605-준-윤-pr1362-review-request.md",
      { subject: "pr1362-review-request", from: "준", to: "윤" },
      "Please review PR #1362.",
    );
    writeMessage(
      root,
      "inbox",
      "20260605-윤-준-pr1362-review.md",
      { subject: "pr1362-review", from: "윤", to: "준" },
      "Findings:\n\nP2 packages/tap-comms/src/foo.ts - regression summary only.",
    );
    writeMessage(
      root,
      "inbox",
      "20260605-윤-준-pr1362-r2-review-clean.md",
      { subject: "pr1362-r2-review-clean", from: "윤", to: "준" },
      "Findings:\n\nP1/P2/P3: none.",
    );
    writeMessage(
      root,
      "inbox",
      "20260605-준-윤-pr1362-r2-review-request.md",
      { subject: "pr1362-r2-review-request", from: "준", to: "윤" },
      "Please rereview PR #1362.",
    );

    const result = await reviewsCommand([
      "recover",
      "--pr",
      "1362",
      "--root",
      root,
    ]);

    expect(result.ok).toBe(true);
    expect(result.code).toBe("TAP_REVIEWS_RECOVERY_OK");
    const data = result.data as { candidates: Array<Record<string, unknown>> };
    expect(data.candidates).toHaveLength(2);
    expect(data.candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          prNumber: 1362,
          reviewType: "findings",
          round: "initial",
          recommendedAction: "recover-findings-review-artifact-candidate",
          severitySummary: expect.objectContaining({ p2: 1 }),
          sourcePaths: expect.arrayContaining([
            expect.objectContaining({ sourceKind: "review-request" }),
            expect.objectContaining({ sourceKind: "review-findings" }),
          ]),
        }),
        expect.objectContaining({
          prNumber: 1362,
          reviewType: "rereview-clean",
          round: "R2",
          recommendedAction: "recover-clean-review-artifact-candidate",
          severitySummary: expect.objectContaining({ hasNone: true }),
          sourcePaths: expect.arrayContaining([
            expect.objectContaining({ sourceKind: "rereview-request" }),
            expect.objectContaining({ sourceKind: "rereview-clean" }),
          ]),
        }),
      ]),
    );
    expect(fs.existsSync(path.join(root, "reviews"))).toBe(false);
  });

  it("classifies clean review evidence as a recovery candidate", async () => {
    const root = path.join(tmpDir, "comms");
    writeMessage(
      root,
      "archive",
      "20260605-윤-준-pr1402-review-clean.md",
      { subject: "pr1402-review-clean", from: "윤", to: "준" },
      "Findings:\n\nP1/P2/P3: none.\n\nReview notes: docs-only.",
    );

    const result = await reviewsCommand([
      "recover",
      "--pr",
      "1402",
      "--root",
      root,
    ]);

    const data = result.data as { candidates: Array<Record<string, unknown>> };
    expect(data.candidates).toEqual([
      expect.objectContaining({
        prNumber: 1402,
        reviewType: "clean",
        recommendedAction: "recover-clean-review-artifact-candidate",
        confidence: "high",
        severitySummary: expect.objectContaining({
          p1: 0,
          p2: 0,
          p3: 0,
          hasNone: true,
        }),
      }),
    ]);
  });

  it("keeps merge ack evidence as provenance without inferring clean review", async () => {
    const root = path.join(tmpDir, "comms");
    writeMessage(
      root,
      "inbox",
      "20260605-윤-준-pr1401-merge-ack.md",
      { subject: "pr1401-merge-ack", from: "윤", to: "준" },
      "PR #1401 merged.",
    );

    const result = await reviewsCommand([
      "recover",
      "--pr",
      "1401",
      "--root",
      root,
    ]);

    const data = result.data as { candidates: Array<Record<string, unknown>> };
    expect(data.candidates).toEqual([
      expect.objectContaining({
        prNumber: 1401,
        reviewType: "unknown",
        recommendedAction: "no-evidence-found",
        ackPaths: [expect.objectContaining({ sourceKind: "merge-ack" })],
      }),
    ]);
  });

  it("keeps review ack family evidence as provenance instead of competing outcomes", async () => {
    const root = path.join(tmpDir, "comms");
    writeMessage(
      root,
      "inbox",
      "20260605-윤-준-pr1402-review-request.md",
      { subject: "pr1402-review-request", from: "윤", to: "준" },
      "Please review PR #1402.",
    );
    writeMessage(
      root,
      "inbox",
      "20260605-준-윤-pr1402-review-clean.md",
      { subject: "pr1402-review-clean", from: "준", to: "윤" },
      "Findings:\n\nP1/P2/P3: none.",
    );
    writeMessage(
      root,
      "inbox",
      "20260605-윤-준-pr1402-review-ack.md",
      { subject: "pr1402-review-ack", from: "윤", to: "준" },
      "Received review notes.\n\nFindings:\nP2 quoted from the original review thread.",
    );
    writeMessage(
      root,
      "inbox",
      "20260605-윤-준-pr1402-review-clean-received.md",
      {
        subject: "pr1402-review-clean-received",
        from: "윤",
        to: "준",
      },
      "Clean review received.\n\nFindings:\nP1/P2/P3: none.",
    );
    writeMessage(
      root,
      "inbox",
      "20260605-윤-준-pr1402-review-finding-accepted.md",
      {
        subject: "pr1402-review-finding-accepted",
        from: "윤",
        to: "준",
      },
      "Accepted prior finding.\n\nFindings:\nP2 quoted finding text.",
    );
    writeMessage(
      root,
      "inbox",
      "20260605-윤-준-re-pr1402-review-findings.md",
      {
        subject: "re-pr1402-review-findings",
        from: "윤",
        to: "준",
      },
      "Reply to review findings.\n\nFindings:\nP2 quoted finding text.",
    );

    const result = await reviewsCommand([
      "recover",
      "--pr",
      "1402",
      "--root",
      root,
    ]);

    const data = result.data as {
      candidates: Array<{
        recommendedAction: string;
        sourcePaths: Array<{ sourceKind: string }>;
        ackPaths: Array<{ sourceKind: string }>;
      }>;
    };
    expect(data.candidates).toEqual([
      expect.objectContaining({
        prNumber: 1402,
        reviewType: "clean",
        recommendedAction: "recover-clean-review-artifact-candidate",
        confidence: "high",
        sourcePaths: expect.arrayContaining([
          expect.objectContaining({ sourceKind: "review-request" }),
          expect.objectContaining({ sourceKind: "review-clean" }),
        ]),
        ackPaths: [
          expect.objectContaining({ sourceKind: "review-ack" }),
          expect.objectContaining({ sourceKind: "review-ack" }),
          expect.objectContaining({ sourceKind: "review-ack" }),
          expect.objectContaining({ sourceKind: "review-ack" }),
        ],
      }),
    ]);
    expect(
      data.candidates[0].sourcePaths.some(
        (sourcePath) => sourcePath.sourceKind === "review-findings",
      ),
    ).toBe(false);
  });

  it("does not promote body-only PR mentions in compact archive notes", async () => {
    const root = path.join(tmpDir, "comms");
    const filePath = path.join(root, "archive", "compact-transcript.md");
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(
      filePath,
      [
        "# Compact runtime notes",
        "",
        "This is not a tap review artifact. It mentions PR #1402 while discussing review conventions.",
        "",
        "Findings:",
        "P2 example sentence in a retrospective, not an actual PR review finding.",
      ].join("\n"),
      "utf8",
    );

    const result = await reviewsCommand([
      "recover",
      "--pr",
      "1402",
      "--root",
      root,
    ]);

    const data = result.data as {
      scanned: number;
      candidates: Array<Record<string, unknown>>;
    };
    expect(data.scanned).toBe(0);
    expect(data.candidates).toEqual([
      expect.objectContaining({
        prNumber: 1402,
        reviewType: "unknown",
        recommendedAction: "no-evidence-found",
        confidence: "low",
        sourcePaths: [],
      }),
    ]);
  });

  it("accepts explicit numeric pr frontmatter as review identity", async () => {
    const root = path.join(tmpDir, "comms");
    writeMessage(
      root,
      "inbox",
      "manual-review-message.md",
      {
        subject: "manual-review-clean",
        from: "윤",
        to: "준",
        pr: "1402",
      },
      "Findings:\n\nP1/P2/P3: none.",
    );

    const result = await reviewsCommand([
      "recover",
      "--pr",
      "1402",
      "--root",
      root,
    ]);

    const data = result.data as {
      scanned: number;
      candidates: Array<Record<string, unknown>>;
    };
    expect(data.scanned).toBe(1);
    expect(data.candidates).toEqual([
      expect.objectContaining({
        prNumber: 1402,
        reviewType: "clean",
        recommendedAction: "recover-clean-review-artifact-candidate",
      }),
    ]);
  });

  it("accepts explicit numeric prNumber frontmatter as review identity", async () => {
    const root = path.join(tmpDir, "comms");
    writeMessage(
      root,
      "inbox",
      "manual-r2-review-message.md",
      {
        subject: "manual-r2-review-clean",
        from: "윤",
        to: "준",
        prNumber: "1402",
      },
      "Findings:\n\nP1/P2/P3: none.",
    );

    const result = await reviewsCommand([
      "recover",
      "--pr",
      "1402",
      "--root",
      root,
    ]);

    const data = result.data as {
      scanned: number;
      candidates: Array<Record<string, unknown>>;
    };
    expect(data.scanned).toBe(1);
    expect(data.candidates).toEqual([
      expect.objectContaining({
        prNumber: 1402,
        reviewType: "rereview-clean",
        round: "R2",
        recommendedAction: "recover-clean-review-artifact-candidate",
      }),
    ]);
  });

  it("dedupes mirrored source roots into a single candidate row", async () => {
    const macRoot = path.join(tmpDir, "mac-comms");
    const sumbackRoot = path.join(tmpDir, "sumback-comms");
    for (const root of [macRoot, sumbackRoot]) {
      writeMessage(
        root,
        "inbox",
        "20260605-윤-준-pr1380-review-clean.md",
        {
          subject: "pr1380-review-clean",
          from: "윤",
          to: "준",
          sent_at: "2026-06-05T00:03:00Z",
          message_id: "msg-pr1380-clean",
        },
        "Findings:\n\nP1/P2/P3: none.",
      );
    }

    const result = await reviewsCommand([
      "recover",
      "--pr",
      "1380",
      "--root",
      macRoot,
      "--root",
      sumbackRoot,
    ]);

    const data = result.data as {
      candidates: Array<{ sourcePaths: unknown[] }>;
    };
    expect(data.candidates).toHaveLength(1);
    expect(data.candidates[0].sourcePaths).toHaveLength(2);
  });

  it("detects existing normalized review artifacts instead of proposing recovery", async () => {
    const root = path.join(tmpDir, "comms");
    writeMessage(
      root,
      "reviews",
      "pr1398-review.md",
      { subject: "pr1398-review-clean", from: "윤", to: "준" },
      "Findings:\n\nP1/P2/P3: none.",
    );

    const result = await reviewsCommand([
      "recover",
      "--pr",
      "1398",
      "--root",
      root,
    ]);

    const data = result.data as { candidates: Array<Record<string, unknown>> };
    expect(data.candidates).toEqual([
      expect.objectContaining({
        prNumber: 1398,
        normalizedArtifactExists: true,
        recommendedAction: "already-normalized",
      }),
    ]);
  });

  it("leaves same-round multiple reviewers ambiguous for human review", async () => {
    const root = path.join(tmpDir, "comms");
    writeMessage(
      root,
      "inbox",
      "20260605-윤-준-pr1395-review-clean.md",
      { subject: "pr1395-review-clean", from: "윤", to: "준" },
      "Findings:\n\nP1/P2/P3: none.",
    );
    writeMessage(
      root,
      "inbox",
      "20260605-민-준-pr1395-review-clean.md",
      { subject: "pr1395-review-clean", from: "민", to: "준" },
      "Findings:\n\nP1/P2/P3: none.",
    );

    const result = await reviewsCommand([
      "recover",
      "--pr",
      "1395",
      "--root",
      root,
    ]);

    const data = result.data as { candidates: Array<Record<string, unknown>> };
    expect(data.candidates).toEqual([
      expect.objectContaining({
        prNumber: 1395,
        reviewType: "clean",
        confidence: "low",
        recommendedAction: "ambiguous-needs-human",
      }),
    ]);
  });

  it("requires explicit output directory and limit for apply mode", async () => {
    const result = await reviewsCommand(["recover", "--pr", "1402", "--apply"]);

    expect(result.ok).toBe(false);
    expect(result.code).toBe("TAP_INVALID_ARGUMENT");
    expect(result.message).toContain("--output-dir");

    const missingLimit = await reviewsCommand([
      "recover",
      "--pr",
      "1402",
      "--apply",
      "--output-dir",
      path.join(tmpDir, "recovered"),
    ]);

    expect(missingLimit.ok).toBe(false);
    expect(missingLimit.code).toBe("TAP_INVALID_ARGUMENT");
    expect(missingLimit.message).toContain("--limit");
  });

  it("writes bounded recovered artifacts without mutating source messages", async () => {
    const root = path.join(tmpDir, "comms");
    const outputDir = path.join(tmpDir, "recovered");
    const sourcePath = path.join(
      root,
      "inbox",
      "20260605-윤-준-pr1402-review-clean.md",
    );
    writeMessage(
      root,
      "inbox",
      "20260605-윤-준-pr1402-review-clean.md",
      { subject: "pr1402-review-clean", from: "윤", to: "준" },
      "Findings:\n\nP1/P2/P3: none.",
    );
    writeMessage(
      root,
      "inbox",
      "20260605-준-윤-pr1402-review-request.md",
      { subject: "pr1402-review-request", from: "준", to: "윤" },
      "Please review PR #1402.",
    );
    writeMessage(
      root,
      "inbox",
      "20260605-준-윤-pr1402-review-finding-accepted.md",
      { subject: "pr1402-review-finding-accepted", from: "준", to: "윤" },
      "Accepted note.\n\nFindings:\nP2 quoted text that must stay provenance.",
    );

    const result = await reviewsCommand([
      "recover",
      "--pr",
      "1402",
      "--root",
      root,
      "--apply",
      "--output-dir",
      outputDir,
      "--limit",
      "1",
    ]);

    expect(result.ok).toBe(true);
    const data = result.data as {
      mode: string;
      apply: {
        appliedCount: number;
        results: Array<{ status: string; artifactPath: string | null }>;
      };
    };
    expect(data.mode).toBe("apply");
    expect(data.apply.appliedCount).toBe(1);
    const artifactPath = data.apply.results.find(
      (entry) => entry.status === "applied",
    )?.artifactPath;
    expect(artifactPath).toBeTruthy();
    expect(fs.existsSync(artifactPath!)).toBe(true);
    expect(fs.existsSync(sourcePath)).toBe(true);
    const artifact = fs.readFileSync(artifactPath!, "utf8");
    expect(artifact).toContain("type: tap-review-recovery");
    expect(artifact).toContain("sourcePreserved: true");
    expect(artifact).toContain("review-clean");
    expect(artifact).toContain("review-ack");
    expect(artifact).not.toContain("quoted text that must stay provenance");
  });

  it("does not overwrite an existing recovered artifact on repeated apply", async () => {
    const root = path.join(tmpDir, "comms");
    const outputDir = path.join(tmpDir, "recovered");
    writeMessage(
      root,
      "inbox",
      "20260605-윤-준-pr1402-review-clean.md",
      { subject: "pr1402-review-clean", from: "윤", to: "준" },
      "Findings:\n\nP1/P2/P3: none.",
    );

    const args = [
      "recover",
      "--pr",
      "1402",
      "--root",
      root,
      "--apply",
      "--output-dir",
      outputDir,
      "--limit",
      "1",
    ];
    const first = await reviewsCommand(args);
    const firstData = first.data as {
      apply: { results: Array<{ artifactPath: string | null }> };
    };
    const artifactPath = firstData.apply.results[0].artifactPath!;
    fs.appendFileSync(artifactPath, "\noperator note stays\n", "utf8");

    const second = await reviewsCommand(args);
    const secondData = second.data as {
      apply: {
        appliedCount: number;
        results: Array<{ status: string; artifactPath: string | null }>;
      };
    };

    expect(secondData.apply.appliedCount).toBe(0);
    expect(secondData.apply.results).toEqual([
      expect.objectContaining({
        status: "already-normalized",
        artifactPath,
      }),
    ]);
    expect(fs.readFileSync(artifactPath, "utf8")).toContain(
      "operator note stays",
    );
  });

  it("exposes stable selection ids and reports dry-run selector matches", async () => {
    const root = path.join(tmpDir, "comms");
    writeMessage(
      root,
      "inbox",
      "20260605-윤-준-pr1402-review-clean.md",
      { subject: "pr1402-review-clean", from: "윤", to: "준" },
      "Findings:\n\nP1/P2/P3: none.",
    );

    const first = await reviewsCommand([
      "recover",
      "--pr",
      "1402",
      "--root",
      root,
    ]);
    const firstData = first.data as {
      candidates: Array<{ selectionId: string }>;
    };
    const selectionId = firstData.candidates[0].selectionId;
    expect(selectionId).toMatch(/^pr1402:initial:clean:[a-f0-9]{10}$/);

    const selected = await reviewsCommand([
      "recover",
      "--pr",
      "1402",
      "--root",
      root,
      "--select",
      selectionId,
    ]);
    const selectedData = selected.data as {
      selection: { selectors: string[]; matchedCount: number };
    };
    expect(selectedData.selection).toEqual({
      selectors: [selectionId],
      matchedCount: 1,
    });
  });

  it("applies only explicitly selected candidates when selectors are provided", async () => {
    const root = path.join(tmpDir, "comms");
    const outputDir = path.join(tmpDir, "recovered");
    for (const pr of [1402, 1403]) {
      writeMessage(
        root,
        "inbox",
        `20260605-윤-준-pr${pr}-review-clean.md`,
        { subject: `pr${pr}-review-clean`, from: "윤", to: "준" },
        "Findings:\n\nP1/P2/P3: none.",
      );
    }

    const dryRun = await reviewsCommand([
      "recover",
      "--pr",
      "1402",
      "--pr",
      "1403",
      "--root",
      root,
    ]);
    const dryRunData = dryRun.data as {
      candidates: Array<{ prNumber: number; selectionId: string }>;
    };
    const selectedId = dryRunData.candidates.find(
      (candidate) => candidate.prNumber === 1403,
    )!.selectionId;

    const result = await reviewsCommand([
      "recover",
      "--pr",
      "1402",
      "--pr",
      "1403",
      "--root",
      root,
      "--apply",
      "--output-dir",
      outputDir,
      "--limit",
      "2",
      "--select",
      selectedId,
    ]);

    const data = result.data as {
      apply: {
        appliedCount: number;
        results: Array<{
          prNumber: number;
          status: string;
          reason: string | null;
          selectionId: string;
        }>;
      };
    };
    expect(data.apply.appliedCount).toBe(1);
    expect(data.apply.results).toEqual([
      expect.objectContaining({
        prNumber: 1402,
        status: "skipped",
        reason: "not selected for apply",
      }),
      expect.objectContaining({
        prNumber: 1403,
        selectionId: selectedId,
        status: "applied",
        reason: null,
      }),
    ]);
  });

  it("does not let explicit selection override ambiguous human-review gates", async () => {
    const root = path.join(tmpDir, "comms");
    const outputDir = path.join(tmpDir, "recovered");
    writeMessage(
      root,
      "inbox",
      "20260605-윤-준-pr1395-review-clean.md",
      { subject: "pr1395-review-clean", from: "윤", to: "준" },
      "Findings:\n\nP1/P2/P3: none.",
    );
    writeMessage(
      root,
      "inbox",
      "20260605-민-준-pr1395-review-clean.md",
      { subject: "pr1395-review-clean", from: "민", to: "준" },
      "Findings:\n\nP1/P2/P3: none.",
    );
    const dryRun = await reviewsCommand([
      "recover",
      "--pr",
      "1395",
      "--root",
      root,
    ]);
    const dryRunData = dryRun.data as {
      candidates: Array<{ selectionId: string }>;
    };

    const result = await reviewsCommand([
      "recover",
      "--pr",
      "1395",
      "--root",
      root,
      "--apply",
      "--output-dir",
      outputDir,
      "--limit",
      "1",
      "--select",
      dryRunData.candidates[0].selectionId,
    ]);

    const data = result.data as {
      apply: {
        appliedCount: number;
        results: Array<{ status: string; reason: string | null }>;
      };
    };
    expect(data.apply.appliedCount).toBe(0);
    expect(data.apply.results).toEqual([
      expect.objectContaining({
        status: "skipped",
        reason: "candidate requires human review",
      }),
    ]);
  });

  it("preserves selection ids when selected reapply scans recovered artifacts", async () => {
    const root = path.join(tmpDir, "comms");
    const outputDir = path.join(root, "reviews", "recovered");
    writeMessage(
      root,
      "inbox",
      "20260605-윤-준-pr1409-review-clean.md",
      { subject: "pr1409-review-clean", from: "윤", to: "준" },
      "Findings:\n\nP1/P2/P3: none.",
    );

    const dryRun = await reviewsCommand([
      "recover",
      "--pr",
      "1409",
      "--root",
      root,
    ]);
    const dryRunData = dryRun.data as {
      candidates: Array<{ selectionId: string }>;
    };
    const selectionId = dryRunData.candidates[0].selectionId;

    const first = await reviewsCommand([
      "recover",
      "--pr",
      "1409",
      "--root",
      root,
      "--apply",
      "--output-dir",
      outputDir,
      "--limit",
      "1",
      "--select",
      selectionId,
    ]);
    const firstData = first.data as {
      apply: { results: Array<{ artifactPath: string | null }> };
    };
    const artifactPath = firstData.apply.results[0].artifactPath!;

    const second = await reviewsCommand([
      "recover",
      "--pr",
      "1409",
      "--root",
      root,
      "--apply",
      "--output-dir",
      outputDir,
      "--limit",
      "1",
      "--select",
      selectionId,
    ]);

    const secondData = second.data as {
      apply: {
        appliedCount: number;
        results: Array<{
          reviewType: string;
          status: string;
          reason: string | null;
          artifactPath: string | null;
          selectionId: string;
        }>;
      };
    };
    expect(secondData.apply.appliedCount).toBe(0);
    expect(secondData.apply.results).toEqual([
      expect.objectContaining({
        reviewType: "clean",
        status: "already-normalized",
        reason: "normalized artifact already exists",
        artifactPath,
        selectionId,
      }),
    ]);
  });

  it("preserves normalized artifact rounds for selector aliases", async () => {
    const root = path.join(tmpDir, "comms");
    const outputDir = path.join(root, "reviews", "recovered");
    const artifactPath = path.join(
      outputDir,
      "pr1405",
      "r2-rereview-clean-deadbeef00.md",
    );
    fs.mkdirSync(path.dirname(artifactPath), { recursive: true });
    fs.writeFileSync(
      artifactPath,
      [
        "---",
        "type: tap-review-recovery",
        "schema: tap-review-recovery.v1",
        "status: recovered",
        "pr: 1405",
        'round: "R2"',
        'reviewType: "rereview-clean"',
        'reviewer: "윤"',
        'reviewee: "준"',
        'subject: "pr1405-r2-review-clean"',
        'selectionId: "pr1405:r2:rereview-clean:deadbeef00"',
        'dedupeKey: "pr1405:R2:test-key"',
        "sourcePaths:",
        '  - host: "sum-back"',
        '    root: "/home/devin/hua-comms"',
        '    path: "inbox/20260605-yoon-jun-pr1405-r2-review-clean.md"',
        '    sourceKind: "rereview-clean"',
        "ackPaths:",
        "  []",
        "severitySummary:",
        "  p1: 0",
        "  p2: 0",
        "  p3: 0",
        "  hasNone: true",
        'recoveredAt: "2026-06-05T00:00:00.000Z"',
        'recoveredBy: "tap reviews recover"',
        "sourcePreserved: true",
        "---",
        "# recovered",
      ].join("\n"),
      "utf8",
    );

    const selectedR2 = await reviewsCommand([
      "recover",
      "--pr",
      "1405",
      "--root",
      root,
      "--select",
      "pr1405:r2",
    ]);
    const selectedR2Data = selectedR2.data as {
      selection: { matchedCount: number };
      candidates: Array<{ round: string; selectionId: string }>;
    };
    expect(selectedR2Data.selection.matchedCount).toBe(1);
    expect(selectedR2Data.candidates).toEqual([
      expect.objectContaining({
        round: "R2",
        selectionId: "pr1405:r2:rereview-clean:deadbeef00",
      }),
    ]);

    const selectedInitial = await reviewsCommand([
      "recover",
      "--pr",
      "1405",
      "--root",
      root,
      "--select",
      "pr1405:initial",
    ]);
    const selectedInitialData = selectedInitial.data as {
      selection: { matchedCount: number };
    };
    expect(selectedInitialData.selection.matchedCount).toBe(0);
  });

  it("keeps multiple normalized rounds for the same PR as separate candidates", async () => {
    const root = path.join(tmpDir, "comms");
    const outputDir = path.join(root, "reviews", "recovered", "pr1405");
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(
      path.join(outputDir, "initial-findings-1111111111.md"),
      [
        "---",
        "type: tap-review-recovery",
        "schema: tap-review-recovery.v1",
        "status: recovered",
        "pr: 1405",
        'round: "initial"',
        'reviewType: "findings"',
        'reviewer: "윤"',
        'reviewee: "준"',
        'subject: "pr1405-review-findings"',
        'selectionId: "pr1405:initial:findings:1111111111"',
        'dedupeKey: "pr1405:initial:test-key"',
        "sourcePaths:",
        '  - host: "sum-back"',
        '    root: "/home/devin/hua-comms"',
        '    path: "inbox/20260605-yoon-jun-pr1405-review-findings.md"',
        '    sourceKind: "review-findings"',
        "ackPaths:",
        "  []",
        "---",
        "# recovered",
        "Findings:",
        "P2 selected finding.",
      ].join("\n"),
      "utf8",
    );
    fs.writeFileSync(
      path.join(outputDir, "r2-rereview-clean-2222222222.md"),
      [
        "---",
        "type: tap-review-recovery",
        "schema: tap-review-recovery.v1",
        "status: recovered",
        "pr: 1405",
        'round: "R2"',
        'reviewType: "rereview-clean"',
        'reviewer: "윤"',
        'reviewee: "준"',
        'subject: "pr1405-r2-review-clean"',
        'selectionId: "pr1405:r2:rereview-clean:2222222222"',
        'dedupeKey: "pr1405:R2:test-key"',
        "sourcePaths:",
        '  - host: "sum-back"',
        '    root: "/home/devin/hua-comms"',
        '    path: "inbox/20260605-yoon-jun-pr1405-r2-review-clean.md"',
        '    sourceKind: "rereview-clean"',
        "ackPaths:",
        "  []",
        "---",
        "# recovered",
        "Findings:",
        "P1/P2/P3: none.",
      ].join("\n"),
      "utf8",
    );

    const all = await reviewsCommand([
      "recover",
      "--pr",
      "1405",
      "--root",
      root,
    ]);
    const allData = all.data as {
      candidates: Array<{
        round: string;
        reviewType: string;
        selectionId: string;
        sourcePaths: Array<{ path: string }>;
      }>;
    };
    expect(allData.candidates).toEqual([
      expect.objectContaining({
        round: "initial",
        reviewType: "findings",
        selectionId: "pr1405:initial:findings:1111111111",
        sourcePaths: [
          expect.objectContaining({
            path: "reviews/recovered/pr1405/initial-findings-1111111111.md",
          }),
        ],
      }),
      expect.objectContaining({
        round: "R2",
        reviewType: "rereview-clean",
        selectionId: "pr1405:r2:rereview-clean:2222222222",
        sourcePaths: [
          expect.objectContaining({
            path: "reviews/recovered/pr1405/r2-rereview-clean-2222222222.md",
          }),
        ],
      }),
    ]);

    const selectedR2 = await reviewsCommand([
      "recover",
      "--pr",
      "1405",
      "--root",
      root,
      "--select",
      "pr1405:r2",
    ]);
    const selectedInitial = await reviewsCommand([
      "recover",
      "--pr",
      "1405",
      "--root",
      root,
      "--select",
      "pr1405:initial",
    ]);
    expect(
      (selectedR2.data as { selection: { matchedCount: number } }).selection
        .matchedCount,
    ).toBe(1);
    expect(
      (selectedInitial.data as { selection: { matchedCount: number } })
        .selection.matchedCount,
    ).toBe(1);
  });

  it("keeps unrecovered raw outcomes visible after another round is normalized", async () => {
    const root = path.join(tmpDir, "comms");
    const outputDir = path.join(root, "reviews", "recovered", "pr1405");
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(
      path.join(outputDir, "initial-findings-1111111111.md"),
      [
        "---",
        "type: tap-review-recovery",
        "schema: tap-review-recovery.v1",
        "status: recovered",
        "pr: 1405",
        'round: "initial"',
        'reviewType: "findings"',
        'reviewer: "윤"',
        'reviewee: "준"',
        'subject: "pr1405-review-findings"',
        'selectionId: "pr1405:initial:findings:1111111111"',
        'dedupeKey: "pr1405:initial:test-key"',
        "sourcePaths:",
        '  - host: "sum-back"',
        '    root: "/home/devin/hua-comms"',
        '    path: "inbox/20260605-yoon-jun-pr1405-review-findings.md"',
        '    sourceKind: "review-findings"',
        "ackPaths:",
        "  []",
        "---",
        "# recovered",
      ].join("\n"),
      "utf8",
    );
    writeMessage(
      root,
      "inbox",
      "20260605-윤-준-pr1405-r2-review-clean.md",
      { subject: "pr1405-r2-review-clean", from: "윤", to: "준" },
      "Findings:\n\nP1/P2/P3: none.",
    );

    const result = await reviewsCommand([
      "recover",
      "--pr",
      "1405",
      "--root",
      root,
      "--select",
      "pr1405:r2",
    ]);

    const data = result.data as {
      selection: { matchedCount: number };
      candidates: Array<{
        round: string;
        reviewType: string;
        recommendedAction: string;
        selectionId: string;
        sourcePaths: Array<{ sourceKind: string; path: string }>;
      }>;
    };
    expect(data.selection.matchedCount).toBe(1);
    expect(data.candidates).toEqual([
      expect.objectContaining({
        round: "initial",
        reviewType: "findings",
        recommendedAction: "already-normalized",
        selectionId: "pr1405:initial:findings:1111111111",
      }),
      expect.objectContaining({
        round: "R2",
        reviewType: "rereview-clean",
        recommendedAction: "recover-clean-review-artifact-candidate",
        sourcePaths: [
          expect.objectContaining({
            sourceKind: "rereview-clean",
            path: "inbox/20260605-윤-준-pr1405-r2-review-clean.md",
          }),
        ],
      }),
    ]);
  });

  it("ignores fenced code blocks when classifying review outcome severity", async () => {
    const root = path.join(tmpDir, "comms");
    writeMessage(
      root,
      "inbox",
      "20260605-윤-준-pr1405-r2-review-findings.md",
      { subject: "pr1405-r2-review-findings", from: "윤", to: "준" },
      [
        "Findings:",
        "",
        "P3 packages/tap-comms/src/reviews.ts - numeric frontmatter was ignored.",
        "",
        "Verification rerun:",
        "- Prior P2 body-only false-positive smoke remains PASS.",
        "",
        "P1/P2: none.",
        "",
        "```bash",
        "cat > review-message.md <<'EOF'",
        "Findings:",
        "",
        "P1/P2/P3: none.",
        "EOF",
        "```",
      ].join("\n"),
    );

    const result = await reviewsCommand([
      "recover",
      "--pr",
      "1405",
      "--root",
      root,
    ]);

    const data = result.data as {
      candidates: Array<{
        reviewType: string;
        recommendedAction: string;
        severitySummary: {
          p1: number;
          p2: number;
          p3: number;
          hasNone: boolean;
        };
      }>;
    };
    expect(data.candidates).toEqual([
      expect.objectContaining({
        reviewType: "findings",
        recommendedAction: "recover-findings-review-artifact-candidate",
        severitySummary: expect.objectContaining({
          p1: 0,
          p2: 0,
          p3: 1,
          hasNone: false,
        }),
      }),
    ]);
  });

  it("renders bounded excerpts only from selected review outcome sources", async () => {
    const root = path.join(tmpDir, "comms");
    const outputDir = path.join(tmpDir, "recovered");
    writeMessage(
      root,
      "inbox",
      "20260605-윤-준-pr1405-review-findings.md",
      { subject: "pr1405-review-findings", from: "윤", to: "준" },
      [
        "Findings:",
        "",
        "P2 packages/tap-comms/src/reviews.ts - selected finding text.",
        "",
        "Review notes:",
        "- Outcome-only note.",
      ].join("\n"),
    );
    writeMessage(
      root,
      "inbox",
      "20260605-준-윤-pr1405-review-request.md",
      { subject: "pr1405-review-request", from: "준", to: "윤" },
      "Please review PR #1405. Request prose must stay out of recovered excerpts.",
    );
    writeMessage(
      root,
      "inbox",
      "20260605-준-윤-pr1405-review-request-followup.md",
      { subject: "pr1405-review-request", from: "준", to: "윤" },
      "Request context mentions P1/P2/P3 labels but is not outcome evidence.",
    );
    writeMessage(
      root,
      "inbox",
      "20260605-준-윤-pr1405-review-ack.md",
      { subject: "pr1405-review-ack", from: "준", to: "윤" },
      "Ack quoted text must stay provenance-only.\n\nFindings:\nP2 quoted ack text.",
    );

    const result = await reviewsCommand([
      "recover",
      "--pr",
      "1405",
      "--root",
      root,
      "--apply",
      "--output-dir",
      outputDir,
      "--limit",
      "1",
    ]);

    const data = result.data as {
      candidates: Array<{
        severitySummary: {
          p1: number;
          p2: number;
          p3: number;
          hasNone: boolean;
        };
      }>;
      apply: { results: Array<{ artifactPath: string | null }> };
    };
    expect(data.candidates[0]?.severitySummary).toEqual(
      expect.objectContaining({ p1: 0, p2: 1, p3: 0, hasNone: false }),
    );
    const artifact = fs.readFileSync(
      data.apply.results[0].artifactPath!,
      "utf8",
    );
    expect(artifact).toContain("## Selected Review Excerpts");
    expect(artifact).toContain(
      "P2 packages/tap-comms/src/reviews.ts - selected finding text.",
    );
    expect(artifact).toContain("Outcome-only note.");
    expect(artifact).not.toContain("Request prose must stay out");
    expect(artifact).not.toContain("quoted ack text");
  });

  it("preserves normalized artifact severity from frontmatter", async () => {
    const root = path.join(tmpDir, "comms");
    const recoveredDir = path.join(root, "reviews", "recovered", "pr1405");
    fs.mkdirSync(recoveredDir, { recursive: true });
    fs.writeFileSync(
      path.join(recoveredDir, "r2-findings-2ac491e7b1.md"),
      [
        "---",
        "type: tap-review-recovery",
        "schema: tap-review-recovery.v1",
        "status: recovered",
        "pr: 1405",
        'round: "R2"',
        'reviewType: "findings"',
        'selectionId: "pr1405:r2:findings:2ac491e7b1"',
        "severitySummary:",
        "  p1: 0",
        "  p2: 0",
        "  p3: 1",
        "  hasNone: false",
        "---",
        "# PR #1405 R2 Review Recovery",
        "",
        "## Review Outcome",
        "",
        "- Severity summary: P1=0, P2=0, P3=1, none=false",
        "",
        "## Selected Review Excerpts",
        "",
        "    Findings:",
        "    P3 `packages/tap-comms/src/reviews.ts` - real finding.",
        "    ```bash",
        "    P1/P2/P3: none.",
        "    ```",
      ].join("\n"),
    );

    const result = await reviewsCommand([
      "recover",
      "--pr",
      "1405",
      "--root",
      root,
    ]);

    const data = result.data as {
      candidates: Array<{
        recommendedAction: string;
        severitySummary: {
          p1: number;
          p2: number;
          p3: number;
          hasNone: boolean;
        };
      }>;
    };
    expect(data.candidates).toEqual([
      expect.objectContaining({
        recommendedAction: "already-normalized",
        severitySummary: expect.objectContaining({
          p1: 0,
          p2: 0,
          p3: 1,
          hasNone: false,
        }),
      }),
    ]);
  });
});
