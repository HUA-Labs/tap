import { describe, expect, it } from "vitest";
import { suggestCommand, levenshtein } from "../cli-suggest.js";

describe("levenshtein", () => {
  it("returns 0 for identical strings", () => {
    expect(levenshtein("status", "status")).toBe(0);
  });

  it("returns length for empty vs non-empty", () => {
    expect(levenshtein("", "abc")).toBe(3);
    expect(levenshtein("abc", "")).toBe(3);
  });

  it("counts single substitution", () => {
    expect(levenshtein("cat", "car")).toBe(1);
  });

  it("counts transposition as 2 operations", () => {
    expect(levenshtein("ab", "ba")).toBe(2);
  });
});

describe("suggestCommand", () => {
  it("suggests exact match", () => {
    expect(suggestCommand("status")).toBe("status");
  });

  it("suggests for common typos", () => {
    expect(suggestCommand("statsu")).toBe("status");
    expect(suggestCommand("brdige")).toBe("bridge");
    expect(suggestCommand("docotr")).toBe("doctor");
    expect(suggestCommand("init-worktree")).toBe("init-worktree");
  });

  it("suggests for single-char typos", () => {
    expect(suggestCommand("ad")).toBe("add");
    expect(suggestCommand("uo")).toBe("up");
  });

  it("returns null for completely unrelated input", () => {
    expect(suggestCommand("xyzabc")).toBeNull();
    expect(suggestCommand("foobar")).toBeNull();
  });

  it("is case-insensitive", () => {
    expect(suggestCommand("STATUS")).toBe("status");
    expect(suggestCommand("Bridge")).toBe("bridge");
  });
});
