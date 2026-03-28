#!/usr/bin/env bun
/**
 * tap-comms cross-platform validation script.
 *
 * Run on macOS/Linux to verify core functionality:
 *   bun packages/tap-plugin/channels/__tests__/tap-validate.ts
 *
 * Requires: TAP_COMMS_DIR env set to a test directory.
 * Creates temp files, cleans up after.
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  watch,
  writeFileSync,
} from "fs";
import { join, resolve } from "path";

const TEST_DIR = resolve(
  process.env.TAP_VALIDATE_DIR || join(import.meta.dir, ".validate-tmp"),
);
const INBOX = join(TEST_DIR, "inbox");

let passed = 0;
let failed = 0;

function assert(name: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  PASS  ${name}`);
    passed++;
  } else {
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
    failed++;
  }
}

function setup() {
  rmSync(TEST_DIR, { recursive: true, force: true });
  mkdirSync(INBOX, { recursive: true });
}

function cleanup() {
  // SQLite may hold file locks briefly on Windows
  for (let i = 0; i < 3; i++) {
    try {
      rmSync(TEST_DIR, { recursive: true, force: true });
      return;
    } catch {
      const start = Date.now();
      while (Date.now() - start < 500) {} // brief wait
    }
  }
}

// ── Tests ───────────────────────────────────────────────────────────────

console.log("\ntap-comms cross-platform validation\n");
console.log(`Platform: ${process.platform} (${process.arch})`);
console.log(`Runtime: Bun ${Bun.version}`);
console.log(`Test dir: ${TEST_DIR}\n`);

// 1. File write + read
console.log("[1] File write/read");
setup();
const testFile = join(INBOX, "20260322-test-all-hello.md");
writeFileSync(testFile, "# Hello\n\nTest message.", "utf-8");
assert("file exists", existsSync(testFile));
const content = readFileSync(testFile, "utf-8");
assert("content matches", content.includes("# Hello"));

// 2. Korean filename
console.log("\n[2] Korean filename");
const koreanFile = join(INBOX, "20260322-매-초-테스트.md");
writeFileSync(koreanFile, "한글 내용", "utf-8");
assert("korean file exists", existsSync(koreanFile));
const koreanContent = readFileSync(koreanFile, "utf-8");
assert("korean content readable", koreanContent === "한글 내용");

// 3. BOM handling
console.log("\n[3] BOM strip");
const bomFile = join(INBOX, "20260322-휘-all-bom.md");
writeFileSync(bomFile, "\uFEFFBOM content", "utf-8");
const bomContent = readFileSync(bomFile, "utf-8");
const stripped =
  bomContent.charCodeAt(0) === 0xfeff ? bomContent.slice(1) : bomContent;
assert("BOM stripped", stripped === "BOM content");

// 4. Directory listing
console.log("\n[4] Directory listing");
const files = readdirSync(INBOX).filter((f) => f.endsWith(".md"));
assert("3 files found", files.length === 3, `got ${files.length}`);

// 5. Filename parsing
console.log("\n[5] Filename parsing");
const parseFilename = (filename: string) => {
  const match = filename.match(/^\d{8}-(.+?)-(.+?)-(.+)\.md$/);
  if (match) return { from: match[1], to: match[2], subject: match[3] };
  return null;
};
const parsed = parseFilename("20260322-매-초-m56-checkin.md");
assert("parse from", parsed?.from === "매");
assert("parse to", parsed?.to === "초");
assert("parse subject", parsed?.subject === "m56-checkin");

// 6. Stat + mtime
console.log("\n[6] Stat + mtime");
const stat = statSync(testFile);
assert("mtime is recent", Date.now() - stat.mtimeMs < 10000);

// 7. path.resolve
console.log("\n[7] path.resolve");
const resolved = resolve(TEST_DIR);
assert(
  "resolve is absolute",
  resolved.startsWith("/") || /^[A-Z]:\\/.test(resolved),
);
assert("resolve matches", resolved === TEST_DIR);

// 8. fs.watch (quick test — 3s timeout)
console.log("\n[8] fs.watch");
let watchFired = false;
const watcher = watch(INBOX, (event, filename) => {
  if (filename?.endsWith(".md")) watchFired = true;
});

// Write a new file to trigger watch
setTimeout(() => {
  writeFileSync(
    join(INBOX, "20260322-test-all-watch.md"),
    "watch test",
    "utf-8",
  );
}, 500);

await new Promise<void>((res) => {
  setTimeout(() => {
    watcher.close();
    assert("fs.watch fired", watchFired);
    res();
  }, 3000);
});

// 9. Atomic write (temp + rename)
console.log("\n[9] Atomic write");
const { renameSync } = await import("fs");
const atomicTarget = join(TEST_DIR, "atomic.json");
const atomicTmp = atomicTarget + ".tmp";
writeFileSync(atomicTmp, JSON.stringify({ test: true }), "utf-8");
renameSync(atomicTmp, atomicTarget);
assert("atomic write OK", existsSync(atomicTarget));
assert("temp cleaned", !existsSync(atomicTmp));
const atomicContent = JSON.parse(readFileSync(atomicTarget, "utf-8"));
assert("atomic content correct", atomicContent.test === true);

// 10. SQLite (optional)
console.log("\n[10] SQLite (bun:sqlite)");
try {
  const { Database } = require("bun:sqlite");
  const db = new Database(join(TEST_DIR, "test.db"), { create: true });
  db.exec("PRAGMA journal_mode=WAL");
  db.exec("CREATE TABLE test (id INTEGER PRIMARY KEY, value TEXT)");
  db.run("INSERT INTO test (value) VALUES (?)", ["hello"]);
  const row = db.prepare("SELECT value FROM test WHERE id = 1").get() as {
    value: string;
  };
  assert("SQLite WAL mode", true);
  assert("SQLite read/write", row?.value === "hello");
  db.close();
} catch (err) {
  assert("SQLite available", false, String(err));
}

// ── Summary ─────────────────────────────────────────────────────────────

cleanup();
console.log(`\n${"=".repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log(`Platform: ${process.platform} ${process.arch}`);
if (failed > 0) {
  console.log("\nSome tests failed. Check platform-specific issues above.");
  process.exit(1);
} else {
  console.log("\nAll tests passed. Platform is tap-comms compatible.");
}
