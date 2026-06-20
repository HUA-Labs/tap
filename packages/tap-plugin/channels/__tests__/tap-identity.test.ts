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

  // M352 drift #4: cross-device case + separator boundary cases. Before the
  // fix, `Codex-Reviewer` typed on one device silently missed `codex_reviewer`
  // heartbeats registered from another.
  describe("M352 canonicalization — case and separator boundaries", () => {
    it("collapses ASCII case differences", () => {
      expect(canonicalizeAgentId("Codex")).toBe("codex");
      expect(canonicalizeAgentId("CODEX")).toBe("codex");
      expect(canonicalizeAgentId("Codex-Reviewer")).toBe("codex_reviewer");
    });

    it("leaves CJK agent names unchanged (case is a no-op)", () => {
      expect(canonicalizeAgentId("닻")).toBe("닻");
      expect(canonicalizeAgentId("윤")).toBe("윤");
      expect(canonicalizeAgentId("  진  ")).toBe("진");
    });

    it("treats Codex-Reviewer and codex_reviewer as the same routing address", () => {
      expect(sameRoutingAddress("Codex-Reviewer", "codex_reviewer")).toBe(true);
      expect(sameRoutingAddress("CLAUDE-MAIN", "claude_main")).toBe(true);
    });

    it("matches cross-device DM recipients regardless of case", () => {
      expect(
        matchesAgentRecipient("Codex_Reviewer", "codex_reviewer", "결"),
      ).toBe(true);
      expect(matchesAgentRecipient("CODEX-1", "codex_1", "닻")).toBe(true);
    });

    it("dedupes recipient lists that only differ in case", () => {
      expect(normalizeRecipientList(["Codex-1"], ["codex_1"])).toBeUndefined();
      expect(normalizeRecipientList(["codex-1", "Codex_1"], [])).toEqual([
        "codex-1",
      ]);
    });

    it("filters self-echoes that differ only in case or separator", () => {
      expect(
        isOwnMessageAddress("CODEX-REVIEWER", "codex_reviewer", "결"),
      ).toBe(true);
    });
  });
});
