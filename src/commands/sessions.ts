import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createGzip } from "node:zlib";
import { pipeline } from "node:stream/promises";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { CommandResult } from "../types.js";
import { log, parseArgs } from "../utils.js";

const SESSIONS_HELP = `
Usage:
  tap sessions archive [options]

Description:
  Archive inactive Codex session JSONL files into gzip files with a manifest.
  The command is dry-run by default and never archives active session thread ids
  unless --include-active is explicitly passed.

Options:
  --sessions-dir <path>    Codex sessions directory. Default: $CODEX_HOME/sessions or ~/.codex/sessions.
  --archive-dir <path>     Archive output directory. Default: $CODEX_HOME/session-archives or ~/.codex/session-archives.
  --min-size-mb <n>        Minimum file size in MiB. Default: 100.
  --min-age-hours <n>      Minimum mtime age in hours. Default: 24.
  --apply                  Write archives. Without --apply this is a dry-run.
  --keep-original          Keep source JSONL after writing the gzip archive.
  --include-active         Include sessions whose thread id appears in running process argv.
  --help, -h               Show help

Examples:
  tap sessions archive --json
  tap sessions archive --min-size-mb 50 --min-age-hours 12 --apply --json
`.trim();

interface SessionArchiveData {
  [key: string]: unknown;
  mode: "dry-run" | "apply";
  sessionsDir: string;
  archiveDir: string;
  minSizeBytes: number;
  minAgeHours: number;
  includeActive: boolean;
  keepOriginal: boolean;
  activeThreadIds: string[];
  scanned: number;
  candidates: SessionArchiveRecord[];
  archived: SessionArchiveRecord[];
  skipped: SessionArchiveRecord[];
  manifestPath: string | null;
}

interface SessionArchiveRecord {
  sourcePath: string;
  relativePath: string;
  archivePath: string;
  sizeBytes: number;
  mtime: string;
  threadId: string | null;
  active: boolean;
  status: "candidate" | "would-archive" | "archived" | "skipped" | "failed";
  reason: string | null;
  originalRemoved: boolean;
  archiveSizeBytes: number | null;
}

type ActiveThreadIdResolver = () => Set<string>;
type ManifestAppender = (
  manifestPath: string,
  record: SessionArchiveRecord,
) => void;
type BeforeArchiveWriteHook = (record: SessionArchiveRecord) => void;

let activeThreadIdResolverForTests: ActiveThreadIdResolver | null = null;
let manifestAppenderForTests: ManifestAppender | null = null;
let beforeArchiveWriteHookForTests: BeforeArchiveWriteHook | null = null;

export function __setSessionActiveThreadIdResolverForTests(
  resolver: ActiveThreadIdResolver | null,
): void {
  activeThreadIdResolverForTests = resolver;
}

export function __setSessionManifestAppenderForTests(
  appender: ManifestAppender | null,
): void {
  manifestAppenderForTests = appender;
}

export function __setSessionBeforeArchiveWriteHookForTests(
  hook: BeforeArchiveWriteHook | null,
): void {
  beforeArchiveWriteHookForTests = hook;
}

function invalidArgument(message: string): CommandResult {
  return {
    ok: false,
    command: "sessions",
    code: "TAP_INVALID_ARGUMENT",
    message,
    warnings: [],
    data: {},
  };
}

function codexHome(): string {
  return process.env.CODEX_HOME
    ? path.resolve(process.env.CODEX_HOME)
    : path.join(os.homedir(), ".codex");
}

function resolvePathFlag(value: string | boolean | undefined): string | null {
  return typeof value === "string" && value.trim() ? path.resolve(value) : null;
}

function resolveOptionalPathFlag(
  flags: Record<string, string | boolean>,
  name: string,
  fallback: string,
): string | "invalid" {
  if (!(name in flags)) return fallback;
  const resolved = resolvePathFlag(flags[name]);
  return resolved ?? "invalid";
}

function parseNonNegativeNumberFlag(
  value: string | boolean | undefined,
  name: string,
  fallback: number,
): number {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || !value.trim()) {
    throw new RangeError(`Invalid ${name}: expected a number.`);
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new RangeError(`Invalid ${name}: expected a non-negative number.`);
  }
  return parsed;
}

function extractThreadId(filename: string): string | null {
  const match = filename.match(
    /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i,
  );
  return match ? match[1].toLowerCase() : null;
}

function collectSessionFiles(root: string): string[] {
  const files: string[] = [];
  if (!fs.existsSync(root)) return files;

  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    if (!dir) continue;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const entryPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(entryPath);
      } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        files.push(entryPath);
      }
    }
  }
  return files.sort();
}

function getActiveThreadIdsFromProcesses(): Set<string> {
  if (activeThreadIdResolverForTests) {
    return activeThreadIdResolverForTests();
  }

  const result = spawnSync("ps", ["-eo", "args="], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (result.status !== 0 || !result.stdout) return new Set();

  const ids = new Set<string>();
  const matcher =
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
  for (const match of result.stdout.matchAll(matcher)) {
    ids.add(match[0].toLowerCase());
  }
  return ids;
}

function buildRecord(
  sourcePath: string,
  sessionsDir: string,
  archiveDir: string,
  activeThreadIds: Set<string>,
): SessionArchiveRecord {
  const stat = fs.statSync(sourcePath);
  const relativePath = path.relative(sessionsDir, sourcePath);
  const threadId = extractThreadId(path.basename(sourcePath));
  const active = threadId ? activeThreadIds.has(threadId) : false;
  return {
    sourcePath,
    relativePath,
    archivePath: path.join(archiveDir, `${relativePath}.gz`),
    sizeBytes: stat.size,
    mtime: stat.mtime.toISOString(),
    threadId,
    active,
    status: "candidate",
    reason: null,
    originalRemoved: false,
    archiveSizeBytes: null,
  };
}

function classifyRecord(
  record: SessionArchiveRecord,
  nowMs: number,
  minSizeBytes: number,
  minAgeHours: number,
  includeActive: boolean,
): SessionArchiveRecord {
  const ageHours = (nowMs - Date.parse(record.mtime)) / 3_600_000;
  if (record.active && !includeActive) {
    return { ...record, status: "skipped", reason: "active-session" };
  }
  if (record.sizeBytes < minSizeBytes) {
    return { ...record, status: "skipped", reason: "below-min-size" };
  }
  if (ageHours < minAgeHours) {
    return { ...record, status: "skipped", reason: "below-min-age" };
  }
  if (fs.existsSync(record.archivePath)) {
    return { ...record, status: "skipped", reason: "archive-exists" };
  }
  return { ...record, status: "would-archive", reason: null };
}

async function writeArchive(record: SessionArchiveRecord): Promise<{
  status: "archived" | "failed";
  reason: string | null;
  archiveSizeBytes: number | null;
}> {
  const archiveParent = path.dirname(record.archivePath);
  fs.mkdirSync(archiveParent, { recursive: true });
  const tempPath = path.join(
    archiveParent,
    `.${path.basename(record.archivePath)}.${process.pid}.${randomUUID()}.tmp`,
  );
  try {
    beforeArchiveWriteHookForTests?.(record);
    await pipeline(
      fs.createReadStream(record.sourcePath),
      createGzip({ level: 9 }),
      fs.createWriteStream(tempPath, { flags: "wx" }),
    );
    fs.linkSync(tempPath, record.archivePath);
    fs.rmSync(tempPath, { force: true });
    const archiveSizeBytes = fs.statSync(record.archivePath).size;
    return { status: "archived", reason: null, archiveSizeBytes };
  } catch (err) {
    fs.rmSync(tempPath, { force: true });
    const message = err instanceof Error ? err.message : String(err);
    return { status: "failed", reason: message, archiveSizeBytes: null };
  }
}

function appendManifest(
  manifestPath: string,
  record: SessionArchiveRecord,
): void {
  if (manifestAppenderForTests) {
    manifestAppenderForTests(manifestPath, record);
    return;
  }
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.appendFileSync(
    manifestPath,
    `${JSON.stringify({ archivedAt: new Date().toISOString(), ...record })}\n`,
    "utf8",
  );
}

export async function sessionsCommand(
  args: string[],
): Promise<CommandResult<SessionArchiveData | Record<string, unknown>>> {
  if (args.includes("--help") || args.includes("-h")) {
    log(SESSIONS_HELP);
    return {
      ok: true,
      command: "sessions",
      code: "TAP_NO_OP",
      message: SESSIONS_HELP,
      warnings: [],
      data: {},
    };
  }

  const { positional, flags } = parseArgs(args);
  const subcommand = positional[0] ?? "archive";
  if (subcommand !== "archive") {
    return invalidArgument(
      `Unknown sessions subcommand: ${subcommand}. Use archive.`,
    );
  }

  let minSizeMb: number;
  let minAgeHours: number;
  try {
    minSizeMb = parseNonNegativeNumberFlag(
      flags["min-size-mb"],
      "--min-size-mb",
      100,
    );
    minAgeHours = parseNonNegativeNumberFlag(
      flags["min-age-hours"],
      "--min-age-hours",
      24,
    );
  } catch (err) {
    return invalidArgument(err instanceof Error ? err.message : String(err));
  }

  const home = codexHome();
  const sessionsDir = resolveOptionalPathFlag(
    flags,
    "sessions-dir",
    path.join(home, "sessions"),
  );
  if (sessionsDir === "invalid") {
    return invalidArgument(
      "Invalid --sessions-dir: expected a non-empty path.",
    );
  }
  const archiveDir = resolveOptionalPathFlag(
    flags,
    "archive-dir",
    path.join(home, "session-archives"),
  );
  if (archiveDir === "invalid") {
    return invalidArgument("Invalid --archive-dir: expected a non-empty path.");
  }
  const apply = flags.apply === true;
  const keepOriginal = flags["keep-original"] === true;
  const includeActive = flags["include-active"] === true;
  const activeThreadIds = getActiveThreadIdsFromProcesses();
  const minSizeBytes = Math.floor(minSizeMb * 1024 * 1024);
  const manifestPath = apply ? path.join(archiveDir, "manifest.jsonl") : null;

  const records = collectSessionFiles(sessionsDir).map((file) =>
    buildRecord(file, sessionsDir, archiveDir, activeThreadIds),
  );
  const classified = records.map((record) =>
    classifyRecord(
      record,
      Date.now(),
      minSizeBytes,
      minAgeHours,
      includeActive,
    ),
  );

  const candidates = classified.filter(
    (record) => record.status === "would-archive",
  );
  const skipped = classified.filter((record) => record.status === "skipped");
  const archived: SessionArchiveRecord[] = [];
  const failed: SessionArchiveRecord[] = [];

  if (apply) {
    for (const candidate of candidates) {
      const archiveResult = await writeArchive(candidate);
      const next: SessionArchiveRecord = {
        ...candidate,
        status: archiveResult.status,
        reason: archiveResult.reason,
        archiveSizeBytes: archiveResult.archiveSizeBytes,
      };
      if (archiveResult.status === "archived") {
        try {
          if (manifestPath) appendManifest(manifestPath, next);
        } catch (err) {
          next.status = "failed";
          next.reason = `manifest append failed: ${
            err instanceof Error ? err.message : String(err)
          }`;
          failed.push(next);
          continue;
        }
        if (!keepOriginal) {
          fs.unlinkSync(candidate.sourcePath);
          next.originalRemoved = true;
        }
        archived.push(next);
      } else {
        failed.push(next);
      }
    }
  }

  const warnings = failed.map(
    (record) =>
      `Failed to archive ${record.sourcePath}: ${record.reason ?? "unknown"}`,
  );
  const data: SessionArchiveData = {
    mode: apply ? "apply" : "dry-run",
    sessionsDir,
    archiveDir,
    minSizeBytes,
    minAgeHours,
    includeActive,
    keepOriginal,
    activeThreadIds: [...activeThreadIds].sort(),
    scanned: records.length,
    candidates: apply ? [] : candidates,
    archived,
    skipped: [...skipped, ...failed],
    manifestPath,
  };

  const archiveCount = apply ? archived.length : candidates.length;
  return {
    ok: failed.length === 0,
    command: "sessions",
    code: failed.length === 0 ? "TAP_SESSIONS_ARCHIVE_OK" : "TAP_VERIFY_FAILED",
    message: apply
      ? `Session archive applied: archived ${archiveCount} file(s), skipped ${data.skipped.length}.`
      : `Session archive dry-run: ${archiveCount} candidate file(s), skipped ${data.skipped.length}.`,
    warnings,
    data,
  };
}
