import { describe, expect, it } from "vitest";

const {
  canonicalizeAgentId,
  isBroadcastRecipient,
  isOwnMessageAddress,
  matchesAgentRecipient,
  normalizeRecipientList,
  sameRoutingAddress,
} = await import("../tap-identity.ts");

describe("tap identity helpers", () => {
  it("canonicalizes agent ids by trimming and converting hyphens to underscores", () => {
    expect(canonicalizeAgentId("  codex-reviewer  ")).toBe("codex_reviewer");
  });

  it("treats all/전체 as the same broadcast recipient", () => {
    expect(isBroadcastRecipient("all")).toBe(true);
    expect(isBroadcastRecipient("전체")).toBe(true);
    expect(sameRoutingAddress("all", "전체")).toBe(true);
  });

  it("matches recipients by immutable id, display name, and broadcast aliases", () => {
    expect(
      matchesAgentRecipient("codex-reviewer", "codex_reviewer", "결"),
    ).toBe(true);
    expect(matchesAgentRecipient("결", "codex_reviewer", "결")).toBe(true);
    expect(matchesAgentRecipient("전체", "codex_reviewer", "결")).toBe(true);
    expect(matchesAgentRecipient("다른이", "codex_reviewer", "결")).toBe(false);
  });

  it("treats canonical id aliases as the same sender for self-echo filtering", () => {
    expect(isOwnMessageAddress("codex-reviewer", "codex_reviewer", "결")).toBe(
      true,
    );
    expect(isOwnMessageAddress("결", "codex_reviewer", "결")).toBe(true);
    expect(isOwnMessageAddress("돌", "codex_reviewer", "결")).toBe(false);
  });

  it("normalizes recipient lists using address equivalence, not raw string equality", () => {
    expect(normalizeRecipientList(["전체"], ["all"])).toBeUndefined();
    expect(normalizeRecipientList(["codex_1"], ["codex-1"])).toBeUndefined();
    expect(normalizeRecipientList(["결", "결", "온"], [])).toEqual([
      "결",
      "온",
    ]);
  });
});
