import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "fs";
import { join } from "path";

const TEST_DIR = join(import.meta.dir, ".test-tmp");
const INBOX_DIR = join(TEST_DIR, "inbox");
const RECEIPTS_DIR = join(TEST_DIR, "receipts");
const RECEIPTS_PATH = join(RECEIPTS_DIR, "receipts.json");
const RECEIPTS_LOCK = join(RECEIPTS_DIR, ".lock");
const HEARTBEATS_PATH = join(TEST_DIR, "heartbeats.json");
const HEARTBEATS_LOCK = join(TEST_DIR, ".heartbeats.lock");
const ARCHIVE_DIR = join(TEST_DIR, "archive");

// ── Helpers (mirror tap-comms.ts logic) ─────────────────────────────────

type ParsedFilename = { from: string; to: string; subject: string };

function decodeRouteSegment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function parseFilename(filename: string): ParsedFilename | null {
  const stem = filename.replace(/\.md$/i, "");
  const dated = stem.match(/^(\d{8})-(.+)$/);
  if (dated) {
    const parts = dated[2].split("-");
    if (parts.length >= 3) {
      return {
        from: decodeRouteSegment(parts[0] || "?"),
        to: decodeRouteSegment(parts[1] || "?"),
        subject: decodeRouteSegment(parts.slice(2).join("-") || "?"),
      };
    }
  }

  const parts = stem.split("-");
  if (parts.length >= 4) {
    return {
      from: decodeRouteSegment(parts[1] || "?"),
      to: decodeRouteSegment(parts[2] || "?"),
      subject: decodeRouteSegment(parts.slice(3).join("-") || "?"),
    };
  }
  return null;
}

function parseInboxEnvelope(
  filename: string,
  content?: string,
): ParsedFilename | null {
  if (content) {
    const frontmatter = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
    if (frontmatter) {
      let from = "";
      let to = "";
      let subject = "";

      for (const line of frontmatter[1].split(/\r?\n/)) {
        const separator = line.indexOf(":");
        if (separator <= 0) continue;

        const key = line.slice(0, separator).trim();
        const value = line.slice(separator + 1).trim();

        if (key === "from") from = value;
        if (key === "to") to = value;
        if (key === "subject") subject = value;
      }

      if (from && to && subject) {
        return { from, to, subject };
      }
    }
  }

  return parseFilename(filename);
}

function isForMe(to: string, agentId: string, agentName: string): boolean {
  const aliases = new Set([
    agentId,
    agentId.replace(/-/g, "_"),
    agentId.replace(/_/g, "-"),
    agentName,
  ]);

  return to === "전체" || to === "all" || aliases.has(to);
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

// ── Setup / Teardown ────────────────────────────────────────────────────

beforeEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
  mkdirSync(INBOX_DIR, { recursive: true });
  mkdirSync(RECEIPTS_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

// ════════════════════════════════════════════════════════════════════════
// HAPPY PATH (5)
// ════════════════════════════════════════════════════════════════════════

describe("happy path", () => {
  it("parseFilename extracts from/to/subject", () => {
    const result = parseFilename("20260322-초-매-m56-checkin.md");
    expect(result).toEqual({ from: "초", to: "매", subject: "m56-checkin" });
  });

  it("parseFilename decodes delimiter-safe route segments", () => {
    const result = parseFilename(
      "20260330-codex%2Dcodex%2D1-codex_codex_2-dm%2Drouting%2Dtest.md",
    );
    expect(result).toEqual({
      from: "codex-codex-1",
      to: "codex_codex_2",
      subject: "dm-routing-test",
    });
  });

  it("parseInboxEnvelope recovers hyphenated recipient from frontmatter", () => {
    const result = parseInboxEnvelope(
      "20260330-claude-codex-codex-1-name-confirmed.md",
      [
        "---",
        "type: inbox",
        "from: claude",
        "to: codex-codex-1",
        "subject: name-confirmed",
        "---",
        "",
        "body",
      ].join("\n"),
    );
    expect(result).toEqual({
      from: "claude",
      to: "codex-codex-1",
      subject: "name-confirmed",
    });
  });

  it("isForMe matches agent id, aliases, 전체, and all", () => {
    expect(isForMe("codex_codex_1", "codex_codex_1", "온")).toBe(true);
    expect(isForMe("codex-codex-1", "codex_codex_1", "온")).toBe(true);
    expect(isForMe("온", "codex_codex_1", "온")).toBe(true);
    expect(isForMe("전체", "codex_codex_1", "온")).toBe(true);
    expect(isForMe("all", "codex_codex_1", "온")).toBe(true);
    expect(isForMe("초", "codex_codex_1", "온")).toBe(false);
  });

  it("receipts read-modify-write cycle", () => {
    const store: Record<
      string,
      Array<{ reader: string; timestamp: string }>
    > = {};
    const filename = "20260322-초-매-test.md";
    store[filename] = [{ reader: "매", timestamp: new Date().toISOString() }];
    writeFileSync(RECEIPTS_PATH, JSON.stringify(store, null, 2), "utf-8");

    const loaded = JSON.parse(readFileSync(RECEIPTS_PATH, "utf-8"));
    expect(loaded[filename]).toHaveLength(1);
    expect(loaded[filename][0].reader).toBe("매");
  });

  it("tap_stats counts sent/received/broadcasts", () => {
    // Create test inbox files
    writeFileSync(join(INBOX_DIR, "20260322-초-매-msg1.md"), "hello", "utf-8");
    writeFileSync(join(INBOX_DIR, "20260322-매-초-msg2.md"), "reply", "utf-8");
    writeFileSync(
      join(INBOX_DIR, "20260322-휘-전체-announce.md"),
      "broadcast",
      "utf-8",
    );

    const sent: Record<string, number> = {};
    const received: Record<string, number> = {};
    let broadcasts = 0;

    for (const filename of readdirSync(INBOX_DIR)) {
      if (!filename.endsWith(".md")) continue;
      const parsed = parseFilename(filename);
      if (!parsed) continue;
      sent[parsed.from] = (sent[parsed.from] || 0) + 1;
      if (parsed.to === "전체" || parsed.to === "all") {
        broadcasts++;
      } else {
        received[parsed.to] = (received[parsed.to] || 0) + 1;
      }
    }

    expect(sent["초"]).toBe(1);
    expect(sent["매"]).toBe(1);
    expect(sent["휘"]).toBe(1);
    expect(received["매"]).toBe(1);
    expect(received["초"]).toBe(1);
    expect(broadcasts).toBe(1);
  });

  it("cleanup moves old files to archive", () => {
    mkdirSync(ARCHIVE_DIR, { recursive: true });
    const oldFile = join(INBOX_DIR, "20260315-초-매-old.md");
    writeFileSync(oldFile, "old message", "utf-8");
    // Set mtime to 10 days ago
    const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    const { utimesSync } = require("fs");
    utimesSync(oldFile, tenDaysAgo, tenDaysAgo);

    const newFile = join(INBOX_DIR, "20260322-초-매-new.md");
    writeFileSync(newFile, "new message", "utf-8");

    // Simulate cleanup: 7 day cutoff
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const { statSync, renameSync } = require("fs");
    let moved = 0;
    for (const filename of readdirSync(INBOX_DIR)) {
      if (!filename.endsWith(".md")) continue;
      const filepath = join(INBOX_DIR, filename);
      if (statSync(filepath).mtimeMs < cutoff) {
        renameSync(filepath, join(ARCHIVE_DIR, filename));
        moved++;
      }
    }

    expect(moved).toBe(1);
    expect(existsSync(join(ARCHIVE_DIR, "20260315-초-매-old.md"))).toBe(true);
    expect(existsSync(newFile)).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════
// EDGE CASES (3)
// ════════════════════════════════════════════════════════════════════════

describe("edge cases", () => {
  it("since filter skips old files by mtime", () => {
    const oldFile = join(INBOX_DIR, "20260320-초-매-old.md");
    writeFileSync(oldFile, "old", "utf-8");
    const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    const { utimesSync, statSync } = require("fs");
    utimesSync(oldFile, tenDaysAgo, tenDaysAgo);

    const newFile = join(INBOX_DIR, "20260322-초-매-new.md");
    writeFileSync(newFile, "new", "utf-8");

    const sinceMs = Date.now() - 24 * 60 * 60 * 1000; // 1 day ago
    const results: string[] = [];
    for (const filename of readdirSync(INBOX_DIR)) {
      if (!filename.endsWith(".md")) continue;
      const mtime = statSync(join(INBOX_DIR, filename)).mtimeMs;
      if (mtime < sinceMs) continue;
      results.push(filename);
    }

    expect(results).toHaveLength(1);
    expect(results[0]).toContain("new");
  });

  it("CC with empty array produces no extra files", () => {
    const cc: string[] = [];
    const date = "20260322";
    const agentName = "매";
    const to = "초";
    const subject = "test";
    const content = "hello";

    const filename = `${date}-${agentName}-${to}-${subject}.md`;
    writeFileSync(join(INBOX_DIR, filename), content, "utf-8");

    // CC loop should not execute
    const sent = [`Sent to ${to}: ${filename}`];
    for (const recipient of cc) {
      sent.push(`CC to ${recipient}`);
    }

    expect(sent).toHaveLength(1);
    expect(readdirSync(INBOX_DIR)).toHaveLength(1);
  });

  it("parseFilename handles non-standard filenames gracefully", () => {
    // "random-file.md" has only 2 parts after split, needs >= 4
    expect(parseFilename("random-file.md")).toBeNull();
    expect(parseFilename("no-extension")).toBeNull();
    // 4+ parts parses as fallback
    expect(parseFilename("a-b-c-d.md")).toEqual({
      from: "b",
      to: "c",
      subject: "d",
    });
  });
});

// ════════════════════════════════════════════════════════════════════════
// NEGATIVE (2)
// ════════════════════════════════════════════════════════════════════════

describe("negative", () => {
  it("broken JSON in receipts/heartbeats returns empty store", () => {
    writeFileSync(RECEIPTS_PATH, "not json{{{", "utf-8");
    writeFileSync(HEARTBEATS_PATH, "broken!!!", "utf-8");

    let receipts: Record<string, unknown>;
    try {
      receipts = JSON.parse(readFileSync(RECEIPTS_PATH, "utf-8"));
    } catch {
      receipts = {};
    }
    expect(receipts).toEqual({});

    let heartbeats: Record<string, unknown>;
    try {
      heartbeats = JSON.parse(readFileSync(HEARTBEATS_PATH, "utf-8"));
    } catch {
      heartbeats = {};
    }
    expect(heartbeats).toEqual({});
  });

  it("stripBom handles normal text and BOM text", () => {
    expect(stripBom("hello")).toBe("hello");
    expect(stripBom("\uFEFFhello")).toBe("hello");
    expect(stripBom("")).toBe("");
  });
});
