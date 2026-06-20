import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as zlib from "node:zlib";
import {
  __setSessionActiveThreadIdResolverForTests,
  __setSessionBeforeArchiveWriteHookForTests,
  __setSessionManifestAppenderForTests,
  sessionsCommand,
} from "../commands/sessions.js";

let tmpDir: string;

const activeId = "019d98bf-ca72-75e3-ae54-a6e0b555184b";
const inactiveId = "019e92af-2b05-7ed2-9b09-7cfce1bcdb33";

function writeSession(
  sessionsDir: string,
  id: string,
  content = '{"type":"session_meta"}\n',
): string {
  const sessionPath = path.join(
    sessionsDir,
    "2026",
    "06",
    "04",
    `rollout-2026-06-04T00-00-00-${id}.jsonl`,
  );
  fs.mkdirSync(path.dirname(sessionPath), { recursive: true });
  fs.writeFileSync(sessionPath, content.repeat(3), "utf8");
  const old = new Date(Date.now() - 48 * 3_600_000);
  fs.utimesSync(sessionPath, old, old);
  return sessionPath;
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tap-sessions-command-"));
  vi.spyOn(console, "log").mockImplementation(() => {});
  __setSessionActiveThreadIdResolverForTests(() => new Set([activeId]));
});

afterEach(() => {
  __setSessionActiveThreadIdResolverForTests(null);
  __setSessionBeforeArchiveWriteHookForTests(null);
  __setSessionManifestAppenderForTests(null);
  vi.restoreAllMocks();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("sessionsCommand", () => {
  it("dry-runs inactive session archive candidates while excluding active thread ids", async () => {
    const sessionsDir = path.join(tmpDir, "sessions");
    const archiveDir = path.join(tmpDir, "archive");
    const activePath = writeSession(sessionsDir, activeId);
    const inactivePath = writeSession(sessionsDir, inactiveId);

    const result = await sessionsCommand([
      "archive",
      "--sessions-dir",
      sessionsDir,
      "--archive-dir",
      archiveDir,
      "--min-size-mb",
      "0",
      "--min-age-hours",
      "0",
    ]);

    expect(result.ok).toBe(true);
    expect(result.code).toBe("TAP_SESSIONS_ARCHIVE_OK");
    expect(result.data).toMatchObject({
      mode: "dry-run",
      scanned: 2,
      activeThreadIds: [activeId],
    });
    const data = result.data as {
      candidates: Array<{ sourcePath: string; status: string }>;
      skipped: Array<{ sourcePath: string; reason: string }>;
    };
    expect(data.candidates).toEqual([
      expect.objectContaining({
        sourcePath: inactivePath,
        status: "would-archive",
      }),
    ]);
    expect(data.skipped).toEqual([
      expect.objectContaining({
        sourcePath: activePath,
        reason: "active-session",
      }),
    ]);
    expect(fs.existsSync(archiveDir)).toBe(false);
  });

  it("applies an inactive session archive, writes manifest evidence, and removes the source by default", async () => {
    const sessionsDir = path.join(tmpDir, "sessions");
    const archiveDir = path.join(tmpDir, "archive");
    const inactivePath = writeSession(
      sessionsDir,
      inactiveId,
      '{"type":"turn_context"}\n',
    );

    const result = await sessionsCommand([
      "archive",
      "--sessions-dir",
      sessionsDir,
      "--archive-dir",
      archiveDir,
      "--min-size-mb",
      "0",
      "--min-age-hours",
      "0",
      "--apply",
    ]);

    expect(result.ok).toBe(true);
    const data = result.data as {
      archived: Array<{
        sourcePath: string;
        archivePath: string;
        originalRemoved: boolean;
      }>;
      manifestPath: string;
    };
    expect(data.archived).toHaveLength(1);
    expect(data.archived[0]).toMatchObject({
      sourcePath: inactivePath,
      originalRemoved: true,
    });
    expect(fs.existsSync(inactivePath)).toBe(false);
    const archivePath = data.archived[0].archivePath;
    expect(fs.existsSync(archivePath)).toBe(true);
    const inflated = zlib
      .gunzipSync(fs.readFileSync(archivePath))
      .toString("utf8");
    expect(inflated).toContain("turn_context");
    expect(fs.readFileSync(data.manifestPath, "utf8")).toContain(inactiveId);
  });

  it("keeps the source file when --keep-original is passed", async () => {
    const sessionsDir = path.join(tmpDir, "sessions");
    const archiveDir = path.join(tmpDir, "archive");
    const inactivePath = writeSession(sessionsDir, inactiveId);

    const result = await sessionsCommand([
      "archive",
      "--sessions-dir",
      sessionsDir,
      "--archive-dir",
      archiveDir,
      "--min-size-mb",
      "0",
      "--min-age-hours",
      "0",
      "--apply",
      "--keep-original",
    ]);

    expect(result.ok).toBe(true);
    const data = result.data as {
      archived: Array<{ originalRemoved: boolean }>;
    };
    expect(data.archived[0]?.originalRemoved).toBe(false);
    expect(fs.existsSync(inactivePath)).toBe(true);
  });

  it("does not remove a colliding archive created after candidate classification", async () => {
    const sessionsDir = path.join(tmpDir, "sessions");
    const archiveDir = path.join(tmpDir, "archive");
    const inactivePath = writeSession(sessionsDir, inactiveId);
    const relativePath = path.relative(sessionsDir, inactivePath);
    const archivePath = path.join(archiveDir, `${relativePath}.gz`);
    const existingArchive = "existing archive evidence";
    __setSessionBeforeArchiveWriteHookForTests((record) => {
      fs.mkdirSync(path.dirname(record.archivePath), { recursive: true });
      fs.writeFileSync(record.archivePath, existingArchive, "utf8");
    });

    const result = await sessionsCommand([
      "archive",
      "--sessions-dir",
      sessionsDir,
      "--archive-dir",
      archiveDir,
      "--min-size-mb",
      "0",
      "--min-age-hours",
      "0",
      "--apply",
    ]);

    expect(result.ok).toBe(false);
    expect(result.code).toBe("TAP_VERIFY_FAILED");
    const data = result.data as {
      archived: unknown[];
      skipped: Array<{ status: string; reason: string }>;
    };
    expect(data.archived).toHaveLength(0);
    expect(data.skipped).toEqual([
      expect.objectContaining({ status: "failed" }),
    ]);
    expect(fs.readFileSync(archivePath, "utf8")).toBe(existingArchive);
    expect(fs.existsSync(inactivePath)).toBe(true);
  });

  it("keeps the source file when manifest evidence cannot be written", async () => {
    const sessionsDir = path.join(tmpDir, "sessions");
    const archiveDir = path.join(tmpDir, "archive");
    const inactivePath = writeSession(sessionsDir, inactiveId);
    __setSessionManifestAppenderForTests(() => {
      throw new Error("manifest locked");
    });

    const result = await sessionsCommand([
      "archive",
      "--sessions-dir",
      sessionsDir,
      "--archive-dir",
      archiveDir,
      "--min-size-mb",
      "0",
      "--min-age-hours",
      "0",
      "--apply",
    ]);

    expect(result.ok).toBe(false);
    expect(result.code).toBe("TAP_VERIFY_FAILED");
    const data = result.data as {
      archived: unknown[];
      skipped: Array<{
        status: string;
        reason: string;
        originalRemoved: boolean;
      }>;
    };
    expect(data.archived).toHaveLength(0);
    expect(data.skipped).toEqual([
      expect.objectContaining({
        status: "failed",
        reason: "manifest append failed: manifest locked",
        originalRemoved: false,
      }),
    ]);
    expect(fs.existsSync(inactivePath)).toBe(true);
  });

  it("rejects malformed path flags instead of falling back to the default paths", async () => {
    const result = await sessionsCommand(["archive", "--sessions-dir"]);

    expect(result.ok).toBe(false);
    expect(result.code).toBe("TAP_INVALID_ARGUMENT");
    expect(result.message).toBe(
      "Invalid --sessions-dir: expected a non-empty path.",
    );
  });
});
