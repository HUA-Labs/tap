import * as fs from "node:fs";
import * as path from "node:path";

export type ProjectionMode = "check" | "apply" | "watch";

export type ProjectionDir =
  | "inbox"
  | "reviews"
  | "findings"
  | "receipts"
  | "decisions";

export interface ProjectionItem {
  dir: ProjectionDir;
  filename: string;
  sourcePath: string;
  targetPath: string;
  relativePath: string;
  mtime: string;
  dedupeKey: string;
  messageId: string | null;
  from: string | null;
  to: string | null;
  subject: string | null;
  projected: boolean;
  skipReason: null | "target-exists" | "dry-run";
}

export interface ProjectionStateEntry {
  relativePath: string;
  messageId: string | null;
  mtime: string;
  projectedAt: string;
}

export interface ProjectionState {
  schemaVersion: 1;
  agent: string;
  aliases: string[];
  sourceCommsDir: string;
  targetCommsDir: string;
  createdAt: string;
  joinedAt: string;
  projected: Record<string, ProjectionStateEntry>;
}

export interface RunLocalProjectionOptions {
  mode: ProjectionMode;
  sourceCommsDir: string;
  targetCommsDir: string;
  targetCommsDirLabel?: string;
  stateDir: string;
  agent: string;
  aliases?: string[];
  dirs?: ProjectionDir[];
  since?: string;
  sinceMinutes?: number;
  all?: boolean;
  resetCursor?: boolean;
  stateName?: string;
  includeOwn?: boolean;
  includeAllTargets?: boolean;
  limit?: number;
  intervalMs?: number;
  maxIterations?: number;
  now?: Date;
  beforeScan?: () => void | Promise<void>;
  afterApply?: (items: ProjectionItem[]) => void | Promise<void>;
}

export interface RunLocalProjectionResult {
  mode: ProjectionMode;
  agent: string;
  aliases: string[];
  sourceCommsDir: string;
  targetCommsDir: string;
  statePath: string;
  adapter: "local-projection";
  receiveTransport: "polling";
  status: "idle" | "pending" | "projected";
  dirs: ProjectionDir[];
  items: ProjectionItem[];
  scanned: number;
  skipped: {
    old: number;
    duplicate: number;
    notForAgent: number;
    own: number;
    disallowed: number;
  };
  stateWritten: boolean;
  effectiveSince: string | null;
  warnings: string[];
}

const APPEND_ONLY_DIRS: ProjectionDir[] = [
  "inbox",
  "reviews",
  "findings",
  "receipts",
  "decisions",
];
const DEFAULT_DIRS: ProjectionDir[] = ["inbox"];
const DEFAULT_LOOKBACK_MINUTES = 5;
const DEFAULT_INTERVAL_MS = 2_000;
const DEFAULT_LIMIT = 100;

function normalizeAddress(value: string): string {
  return value.trim().toLowerCase();
}

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) continue;
    const key = normalizeAddress(trimmed);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }
  return result;
}

function safeStateName(value: string): string {
  return value
    .trim()
    .replace(/[^\p{L}\p{N}._-]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
}

function normalizeProjectionDirs(values: ProjectionDir[] | undefined): {
  dirs: ProjectionDir[];
  disallowed: number;
} {
  const requested = values?.length ? values : DEFAULT_DIRS;
  const dirs: ProjectionDir[] = [];
  let disallowed = 0;
  for (const value of requested) {
    if (APPEND_ONLY_DIRS.includes(value)) {
      if (!dirs.includes(value)) dirs.push(value);
    } else {
      disallowed += 1;
    }
  }
  return { dirs: dirs.length ? dirs : DEFAULT_DIRS, disallowed };
}

function parseFrontmatter(content: string): Record<string, string> {
  if (!content.startsWith("---")) return {};
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const fields: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const field = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!field) continue;
    fields[field[1].toLowerCase()] = field[2]
      .trim()
      .replace(/^["']|["']$/g, "");
  }
  return fields;
}

function parseHeaderFields(content: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const line of content.split(/\r?\n/).slice(0, 12)) {
    if (!line.trim()) break;
    const field = line.match(/^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/);
    if (!field) continue;
    fields[field[1].toLowerCase()] = field[2].trim();
  }
  return fields;
}

function parseFilename(filename: string): {
  from: string | null;
  to: string | null;
  subject: string | null;
} {
  const stem = filename.replace(/\.md$/i, "");
  const parts = stem.split("-");
  if (parts.length < 4) return { from: null, to: null, subject: stem || null };
  return {
    from: parts[1] || null,
    to: parts[2] || null,
    subject: parts.slice(3).join("-") || stem,
  };
}

function parseMetadata(
  filename: string,
  content: string,
): {
  from: string | null;
  to: string | null;
  subject: string | null;
  messageId: string | null;
} {
  const frontmatter = parseFrontmatter(content);
  const headers = parseHeaderFields(content);
  const parsedFilename = parseFilename(filename);
  return {
    from: frontmatter.from ?? headers.from ?? parsedFilename.from,
    to: frontmatter.to ?? headers.to ?? parsedFilename.to,
    subject:
      frontmatter.subject ?? headers.subject ?? parsedFilename.subject ?? null,
    messageId:
      frontmatter.message_id ??
      frontmatter.messageid ??
      headers["message-id"] ??
      headers.message_id ??
      null,
  };
}

function splitAddressList(value: string): string[] {
  return value
    .split(/[,\s]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function isForAgent(to: string | null, aliases: string[]): boolean {
  if (!to) return false;
  const normalizedAliases = new Set(aliases.map(normalizeAddress));
  for (const target of splitAddressList(to)) {
    const normalized = normalizeAddress(target);
    if (
      normalized === "all" ||
      normalized === "broadcast" ||
      normalized === "전체" ||
      normalizedAliases.has(normalized)
    ) {
      return true;
    }
  }
  return false;
}

function requiresAddressedTarget(dir: ProjectionDir): boolean {
  return dir === "inbox" || dir === "reviews";
}

function isOwnMessage(from: string | null, aliases: string[]): boolean {
  if (!from) return false;
  const normalizedAliases = new Set(aliases.map(normalizeAddress));
  return splitAddressList(from).some((address) =>
    normalizedAliases.has(normalizeAddress(address)),
  );
}

export function resolveLocalProjectionStatePath(options: {
  stateDir: string;
  agent: string;
  stateName?: string;
}): string {
  const projectionDir = path.join(options.stateDir, "projection");
  const rawName =
    options.stateName?.trim() || `local-projection-${options.agent}`;
  const name = safeStateName(rawName) || "local-projection";
  return path.join(projectionDir, `${name}.json`);
}

function loadState(
  statePath: string,
  options: {
    agent: string;
    aliases: string[];
    sourceCommsDir: string;
    targetCommsDir: string;
    now: Date;
    resetCursor?: boolean;
  },
): ProjectionState {
  if (!options.resetCursor && fs.existsSync(statePath)) {
    try {
      const parsed = JSON.parse(
        fs.readFileSync(statePath, "utf8"),
      ) as Partial<ProjectionState>;
      if (parsed.schemaVersion === 1 && parsed.joinedAt && parsed.projected) {
        return {
          schemaVersion: 1,
          agent: options.agent,
          aliases: options.aliases,
          sourceCommsDir: options.sourceCommsDir,
          targetCommsDir: options.targetCommsDir,
          createdAt: parsed.createdAt ?? options.now.toISOString(),
          joinedAt: parsed.joinedAt,
          projected: parsed.projected,
        };
      }
    } catch {
      // Fall through to a fresh projection cursor.
    }
  }
  return {
    schemaVersion: 1,
    agent: options.agent,
    aliases: options.aliases,
    sourceCommsDir: options.sourceCommsDir,
    targetCommsDir: options.targetCommsDir,
    createdAt: options.now.toISOString(),
    joinedAt: options.now.toISOString(),
    projected: {},
  };
}

function saveState(statePath: string, state: ProjectionState): void {
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

function parseSinceMs(
  options: RunLocalProjectionOptions,
  state: ProjectionState,
): number | null {
  if (options.all) return null;
  if (options.since) {
    const parsed = Date.parse(options.since);
    if (Number.isNaN(parsed)) {
      throw new RangeError(`Invalid --since timestamp: ${options.since}`);
    }
    return parsed;
  }
  if (options.sinceMinutes) {
    return (
      (options.now ?? new Date()).getTime() - options.sinceMinutes * 60_000
    );
  }
  return (
    Date.parse(state.joinedAt) || Date.now() - DEFAULT_LOOKBACK_MINUTES * 60_000
  );
}

function resolveTargetPath(
  targetCommsDir: string,
  dir: ProjectionDir,
  filename: string,
): string {
  return path.join(targetCommsDir, dir, filename);
}

function listCandidateFiles(
  sourceCommsDir: string,
  dirs: ProjectionDir[],
): Array<{ dir: ProjectionDir; filename: string; fullPath: string }> {
  const result: Array<{
    dir: ProjectionDir;
    filename: string;
    fullPath: string;
  }> = [];
  for (const dir of dirs) {
    const sourceDir = path.join(sourceCommsDir, dir);
    if (!fs.existsSync(sourceDir)) continue;
    for (const filename of fs.readdirSync(sourceDir).sort()) {
      if (!filename.endsWith(".md") && !filename.endsWith(".json")) continue;
      const fullPath = path.join(sourceDir, filename);
      result.push({ dir, filename, fullPath });
    }
  }
  return result;
}

function markProjected(
  state: ProjectionState,
  items: ProjectionItem[],
  projectedAt: string,
): void {
  for (const item of items) {
    if (!item.projected && item.skipReason !== "target-exists") continue;
    state.projected[item.dedupeKey] = {
      relativePath: item.relativePath,
      messageId: item.messageId,
      mtime: item.mtime,
      projectedAt,
    };
  }
}

function scanProjection(
  options: RunLocalProjectionOptions,
  state: ProjectionState,
  aliases: string[],
  dirs: ProjectionDir[],
  sinceMs: number | null,
): Omit<
  RunLocalProjectionResult,
  | "mode"
  | "agent"
  | "aliases"
  | "sourceCommsDir"
  | "targetCommsDir"
  | "statePath"
  | "adapter"
  | "receiveTransport"
  | "dirs"
  | "stateWritten"
  | "effectiveSince"
  | "warnings"
> {
  const items: ProjectionItem[] = [];
  const skipped = {
    old: 0,
    duplicate: 0,
    notForAgent: 0,
    own: 0,
    disallowed: 0,
  };
  let scanned = 0;
  const limit = Math.max(1, Math.min(500, options.limit ?? DEFAULT_LIMIT));

  for (const candidate of listCandidateFiles(options.sourceCommsDir, dirs)) {
    let stat: fs.Stats;
    try {
      stat = fs.statSync(candidate.fullPath);
    } catch {
      continue;
    }
    if (!stat.isFile()) continue;
    scanned += 1;
    if (sinceMs && stat.mtimeMs < sinceMs) {
      skipped.old += 1;
      continue;
    }

    let content = "";
    try {
      content = fs
        .readFileSync(candidate.fullPath, "utf8")
        .replace(/^\uFEFF/, "");
    } catch {
      continue;
    }
    const metadata = parseMetadata(candidate.filename, content);
    if (
      !options.includeAllTargets &&
      !isForAgent(metadata.to, aliases) &&
      requiresAddressedTarget(candidate.dir)
    ) {
      skipped.notForAgent += 1;
      continue;
    }
    if (!options.includeOwn && isOwnMessage(metadata.from, aliases)) {
      skipped.own += 1;
      continue;
    }

    const relativePath = `${candidate.dir}/${candidate.filename}`;
    const dedupeKey = metadata.messageId?.trim() || relativePath;
    if (state.projected[dedupeKey]) {
      skipped.duplicate += 1;
      continue;
    }

    const targetPath = resolveTargetPath(
      options.targetCommsDir,
      candidate.dir,
      candidate.filename,
    );
    const targetExists = fs.existsSync(targetPath);
    const item: ProjectionItem = {
      dir: candidate.dir,
      filename: candidate.filename,
      sourcePath: candidate.fullPath,
      targetPath,
      relativePath,
      mtime: stat.mtime.toISOString(),
      dedupeKey,
      messageId: metadata.messageId,
      from: metadata.from,
      to: metadata.to,
      subject: metadata.subject,
      projected: false,
      skipReason: targetExists ? "target-exists" : "dry-run",
    };
    items.push(item);
    if (items.length >= limit) break;
  }

  return {
    status: items.length > 0 ? "pending" : "idle",
    items,
    scanned,
    skipped,
  };
}

function applyProjection(items: ProjectionItem[]): void {
  for (const item of items) {
    if (item.skipReason === "target-exists") continue;
    fs.mkdirSync(path.dirname(item.targetPath), { recursive: true });
    fs.copyFileSync(item.sourcePath, item.targetPath);
    const sourceStat = fs.statSync(item.sourcePath);
    fs.utimesSync(item.targetPath, sourceStat.atime, sourceStat.mtime);
    item.projected = true;
    item.skipReason = null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runLocalProjection(
  rawOptions: RunLocalProjectionOptions,
): Promise<RunLocalProjectionResult> {
  const now = rawOptions.now ?? new Date();
  const options = {
    ...rawOptions,
    now,
    sourceCommsDir: path.resolve(rawOptions.sourceCommsDir),
    targetCommsDir: path.resolve(rawOptions.targetCommsDir),
  };
  const aliases = unique([
    options.agent,
    ...(options.aliases ?? []),
    process.env.TAP_AGENT_ID ?? "",
    process.env.TAP_AGENT_NAME ?? "",
  ]);
  const warnings: string[] = [];
  const normalizedDirs = normalizeProjectionDirs(options.dirs);
  const dirs = normalizedDirs.dirs;

  if (normalizedDirs.disallowed > 0) {
    warnings.push(
      `Ignored ${normalizedDirs.disallowed} disallowed projection dir(s); only append-only dirs are supported.`,
    );
  }
  if (options.sourceCommsDir === options.targetCommsDir) {
    throw new RangeError(
      "Projection source and target comms directories must differ.",
    );
  }

  const statePath = resolveLocalProjectionStatePath({
    stateDir: options.stateDir,
    agent: options.agent,
    stateName: options.stateName,
  });
  const state = loadState(statePath, {
    agent: options.agent,
    aliases,
    sourceCommsDir: options.sourceCommsDir,
    targetCommsDir: options.targetCommsDirLabel ?? options.targetCommsDir,
    now,
    resetCursor: options.resetCursor,
  });
  const sinceMs = parseSinceMs(options, state);
  const maxIterations =
    options.mode === "watch" ? Math.max(1, options.maxIterations ?? 0) : 1;
  const intervalMs = Math.max(100, options.intervalMs ?? DEFAULT_INTERVAL_MS);

  await options.beforeScan?.();
  let aggregate = scanProjection(options, state, aliases, dirs, sinceMs);
  if (options.mode === "watch") {
    let iteration = 1;
    while (aggregate.items.length === 0) {
      if (maxIterations > 0 && iteration >= maxIterations) break;
      iteration += 1;
      await sleep(intervalMs);
      await options.beforeScan?.();
      aggregate = scanProjection(options, state, aliases, dirs, sinceMs);
    }
  }

  let stateWritten = false;
  if (options.mode === "apply" || options.mode === "watch") {
    if (aggregate.items.length > 0) {
      applyProjection(aggregate.items);
      await options.afterApply?.(aggregate.items);
      markProjected(state, aggregate.items, now.toISOString());
    }
    saveState(statePath, state);
    stateWritten = true;
  }

  return {
    mode: options.mode,
    agent: options.agent,
    aliases,
    sourceCommsDir: options.sourceCommsDir,
    targetCommsDir: options.targetCommsDirLabel ?? options.targetCommsDir,
    statePath,
    adapter: "local-projection",
    receiveTransport: "polling",
    status:
      aggregate.items.some((item) => item.projected) && options.mode !== "check"
        ? "projected"
        : aggregate.status,
    dirs,
    items: aggregate.items,
    scanned: aggregate.scanned,
    skipped: aggregate.skipped,
    stateWritten,
    effectiveSince: sinceMs ? new Date(sinceMs).toISOString() : null,
    warnings,
  };
}
