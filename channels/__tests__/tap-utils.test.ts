import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { resetTestDir, setTestEnv } from "./test-helpers.ts";

setTestEnv();

const {
  INBOX_DIR,
  REVIEWS_DIR,
  FINDINGS_DIR,
  parseFilename,
  parseFrontmatter,
  stripFrontmatter,
  parseMessageRoute,
  canonicalizeAgentId,
  isForMe,
  normalizeSources,
  stripBom,
  getLatestReviewDir,
  getSourceDir,
  getSourceKey,
} = await import("../tap-utils.ts");

beforeEach(() => {
  resetTestDir();
  mkdirSync(INBOX_DIR, { recursive: true });
  mkdirSync(FINDINGS_DIR, { recursive: true });
});

afterEach(() => {
  resetTestDir();
});

describe("tap-utils", () => {
  it("parses inbox filenames with CJK agents and hyphenated subjects", () => {
    expect(parseFilename("20260325-돌-담-m90-check-in.md")).toEqual({
      from: "돌",
      to: "담",
      subject: "m90-check-in",
    });
  });

  it("returns null for non-inbox artifact filenames", () => {
    expect(parseFilename("review-PR758-담.md")).toBeNull();
    expect(parseFilename("random-file.md")).toBeNull();
  });

  it("matches inbox targets by id, name, and broadcast aliases", () => {
    expect(isForMe("codex_1")).toBe(true);
    expect(isForMe("codex-1")).toBe(true);
    expect(isForMe("담")).toBe(true);
    expect(isForMe("전체")).toBe(true);
    expect(isForMe("all")).toBe(true);
    expect(isForMe("다른이")).toBe(false);
  });

  it("filters invalid source entries but keeps valid ones in order", () => {
    expect(normalizeSources(["reviews", "bogus", "inbox"])).toEqual([
      "reviews",
      "inbox",
    ]);
  });

  it("resolves the latest review directory and source keys", () => {
    mkdirSync(join(REVIEWS_DIR, "gen12"), { recursive: true });
    mkdirSync(join(REVIEWS_DIR, "gen13"), { recursive: true });

    expect(getLatestReviewDir()).toBe(join(REVIEWS_DIR, "gen13"));
    expect(getSourceDir("reviews")).toBe(join(REVIEWS_DIR, "gen13"));
    expect(getSourceKey("inbox", "20260325-돌-담-hello.md")).toBe(
      "inbox/20260325-돌-담-hello.md",
    );
  });

  it("strips BOM only when present", () => {
    expect(stripBom("\uFEFFhello")).toBe("hello");
    expect(stripBom("hello")).toBe("hello");
  });

  // ── M202: Frontmatter parsing ──────────────────────────────────────

  it("parses valid YAML frontmatter from message content", () => {
    const content = [
      "---",
      "type: inbox",
      "from: codex_1",
      "from_name: 온",
      "to: claude",
      "to_name: 각",
      "subject: dm-test",
      "sent_at: 2026-03-30T05:00:00Z",
      "---",
      "",
      "Hello world",
    ].join("\n");

    const fm = parseFrontmatter(content);
    expect(fm).toEqual({
      from: "codex_1",
      from_name: "온",
      to: "claude",
      to_name: "각",
      subject: "dm-test",
      sent_at: "2026-03-30T05:00:00Z",
      type: "inbox",
    });
  });

  it("returns null for content without frontmatter", () => {
    expect(parseFrontmatter("Just plain text")).toBeNull();
    expect(parseFrontmatter("> CC: 흔\n\nContent")).toBeNull();
  });

  it("returns null for frontmatter missing required from/to", () => {
    const noTo = "---\nfrom: claude\nsubject: test\n---\nBody";
    expect(parseFrontmatter(noTo)).toBeNull();
  });

  it("strips frontmatter and returns body only", () => {
    const content = "---\nfrom: a\nto: b\n---\n\nBody text";
    expect(stripFrontmatter(content)).toBe("Body text");
  });

  it("stripFrontmatter returns full content when no frontmatter", () => {
    expect(stripFrontmatter("No frontmatter here")).toBe("No frontmatter here");
  });

  it("parseMessageRoute prefers frontmatter over filename", () => {
    const content =
      "---\nfrom: real_sender\nto: real_target\nsubject: real-subj\n---\nBody";
    const route = parseMessageRoute(
      "20260330-wrong-also_wrong-fake.md",
      content,
    );
    expect(route).toEqual({
      from: "real_sender",
      to: "real_target",
      subject: "real-subj",
    });
  });

  it("parseMessageRoute falls back to filename when no frontmatter", () => {
    const route = parseMessageRoute("20260330-돌-담-hello.md", "Plain body");
    expect(route).toEqual({ from: "돌", to: "담", subject: "hello" });
  });

  it("parseMessageRoute falls back to filename when content is undefined", () => {
    const route = parseMessageRoute("20260330-돌-담-hello.md");
    expect(route).toEqual({ from: "돌", to: "담", subject: "hello" });
  });

  // ── M204: ID canonicalization ──────────────────────────────────────

  it("canonicalizes hyphens to underscores", () => {
    expect(canonicalizeAgentId("codex-1")).toBe("codex_1");
    expect(canonicalizeAgentId("codex_1")).toBe("codex_1");
    expect(canonicalizeAgentId("codex-codex-2")).toBe("codex_codex_2");
    expect(canonicalizeAgentId(" codex-1 ")).toBe("codex_1");
  });

  it("isForMe matches hyphenated variant of agent id", () => {
    // Test env sets TAP_AGENT_ID=codex_1 — isForMe should match codex-1 too
    expect(isForMe("codex-1")).toBe(true);
    expect(isForMe("codex_1")).toBe(true);
  });

  it("isForMe still matches display name and broadcast", () => {
    expect(isForMe("담")).toBe(true);
    expect(isForMe("전체")).toBe(true);
    expect(isForMe("all")).toBe(true);
    expect(isForMe("다른이")).toBe(false);
  });
});
