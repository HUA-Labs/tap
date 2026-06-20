import { describe, expect, it } from "vitest";
import { threadCwdMatches } from "../receiver/thread-cwd-match.js";

describe("threadCwdMatches", () => {
  it("normalizes Windows slashes, namespace prefixes, and drive letter case", () => {
    expect(threadCwdMatches("C:/hua-wt-review", "c:\\HUA-WT-REVIEW")).toBe(
      true,
    );
    expect(
      threadCwdMatches("D:/HUA/hua-platform", "\\\\?\\D:\\HUA\\hua-platform"),
    ).toBe(true);
  });

  it("treats Mac /Users paths as case-insensitive logical paths", () => {
    expect(
      threadCwdMatches(
        "/Users/devin/HUA/hua-platform",
        "/Users/devin/hua/hua-platform",
      ),
    ).toBe(true);
  });

  it("keeps generic Linux paths case-sensitive", () => {
    expect(
      threadCwdMatches(
        "/home/devin/HUA/hua-platform",
        "/home/devin/hua/hua-platform",
      ),
    ).toBe(false);
  });
});
