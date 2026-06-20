import * as fs from "node:fs";

function normalizeSeparators(value: string): string {
  return value
    .replace(/^\\\\\?\\/, "")
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/")
    .replace(/\/$/, "");
}

function normalizeCaseInsensitivePath(value: string): string {
  const normalized = normalizeSeparators(value);
  if (/^[a-z]:/i.test(normalized)) return normalized.toLowerCase();
  if (normalized.startsWith("/Users/")) return normalized.toLowerCase();
  return normalized;
}

function realpathOrNull(value: string): string | null {
  try {
    return fs.realpathSync.native(value);
  } catch {
    return null;
  }
}

export function threadCwdMatches(
  expectedCwd: string,
  threadCwd: string,
): boolean {
  if (!expectedCwd || !threadCwd) return false;
  if (expectedCwd === threadCwd) return true;

  const expectedRealpath = realpathOrNull(expectedCwd);
  const threadRealpath = realpathOrNull(threadCwd);
  if (
    expectedRealpath &&
    threadRealpath &&
    expectedRealpath === threadRealpath
  ) {
    return true;
  }

  return (
    normalizeCaseInsensitivePath(expectedCwd) ===
    normalizeCaseInsensitivePath(threadCwd)
  );
}
