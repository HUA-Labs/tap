import * as fs from "node:fs";
import * as path from "node:path";

export type UplinkMode = "check" | "apply" | "watch";

export type UplinkDir =
  | "inbox"
  | "reviews"
  | "findings"
  | "receipts"
  | "decisions";

export interface UplinkItem {
  dir: UplinkDir;
  filename: string;
  sourcePath: string;
  targetPath: string;
  relativePath: string;
  mtime: string;
  dedupeKey: string;
  messageId: string | null;
  from: string | null;
  fromName: string | null;
  to: string | null;
  subject: string | null;
  uploaded: boolean;
  skipReason: null | "dry-run" | "target-exists" | "collision";
}

export interface UplinkStateEntry {
  relativePath: string;
  messageId: string | null;
  mtime: string;
  uploadedAt: string;
}

export interface UplinkState {
  schemaVersion: 1;
  agent: string;
  aliases: string[];
  sourceCommsDir: string;
  targetCommsDir: string;
  createdAt: string;
  joinedAt: string;
  uploaded: Record<string, UplinkStateEntry>;
}

export interface RunLocalUplinkOptions {
  mode: UplinkMode;
  sourceCommsDir: string;
  targetCommsDir: string;
  sourceCommsDirLabel?: string;
  stateDir: string;
  agent: string;
  aliases?: string[];
  dirs?: UplinkDir[];
  since?: string;
  sinceMinutes?: number;
  all?: boolean;
  resetCursor?: boolean;
  stateName?: string;
  includeAllSources?: boolean;
  limit?: number;
  intervalMs?: number;
  maxIterations?: number;
  now?: Date;
  beforeScan?: () => void | Promise<void>;
}

export interface RunLocalUplinkResult {
  mode: UplinkMode;
  agent: string;
  aliases: string[];
  sourceCommsDir: string;
  targetCommsDir: string;
  statePath: string;
  adapter: "local-uplink";
  receiveTransport: "polling";
  status: "idle" | "pending" | "uploaded" | "blocked";
  dirs: UplinkDir[];
  items: UplinkItem[];
  scanned: number;
  skipped: {
    old: number;
    duplicate: number;
    notFromAgent: number;
    disallowed: number;
  };
  stateWritten: boolean;
  effectiveSince: string | null;
  warnings: string[];
}

const APPEND_ONLY_DIRS: UplinkDir[] = [
  "inbox",
  "reviews",
  "findings",
  "receipts",
  "decisions",
];
const DEFAULT_DIRS: UplinkDir[] = ["inbox"];
const DEFAULT_LOOKBACK_MINUTES = 5;
const DEFAULT_INTERVAL_MS = 2_000;
const DEFAULT_LIMIT = 100;
const GUARDED_BROAD_RUNTIME_ALIASES = new Set(["codex"]);

interface ParsedAddress {
  routingAddress: string | null;
  aliases: string[];
}

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

function normalizeUplinkDirs(values: UplinkDir[] | undefined): {
  dirs: UplinkDir[];
  disallowed: number;
} {
  const hasExplicitRequest = Boolean(values?.length);
  const requested = hasExplicitRequest ? values : DEFAULT_DIRS;
  const dirs: UplinkDir[] = [];
  let disallowed = 0;
  for (const value of requested ?? []) {
    if (APPEND_ONLY_DIRS.includes(value)) {
      if (!dirs.includes(value)) dirs.push(value);
    } else {
      disallowed += 1;
    }
  }
  return {
    dirs: dirs.length ? dirs : hasExplicitRequest ? [] : DEFAULT_DIRS,
    disallowed,
  };
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

function parseStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);
}

function parseAddressField(value: string | undefined): ParsedAddress | null {
  if (!value?.trim()) return null;
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object") return null;
    return {
      routingAddress:
        typeof parsed.routingAddress === "string"
          ? parsed.routingAddress
          : null,
      aliases: parseStringArray(parsed.aliases),
    };
  } catch {
    return null;
  }
}

function parseFilename(filename: string): {
  from: string | null;
  to: string | null;
  subject: string | null;
} {
  const stem = filename.replace(/\.(md|json)$/i, "");
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
  fromName: string | null;
  fromAddress: ParsedAddress | null;
  to: string | null;
  subject: string | null;
  messageId: string | null;
} {
  const frontmatter = parseFrontmatter(content);
  const headers = parseHeaderFields(content);
  const parsedFilename = parseFilename(filename);
  return {
    from: frontmatter.from ?? headers.from ?? parsedFilename.from,
    fromName:
      frontmatter.from_name ??
      frontmatter.fromname ??
      headers.from_name ??
      headers.fromname ??
      null,
    fromAddress: parseAddressField(
      frontmatter.from_address ?? headers.from_address,
    ),
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

function matchesAnyAlias(value: string | null, aliases: string[]): boolean {
  if (!value) return false;
  const normalizedAliases = new Set(aliases.map(normalizeAddress));
  return splitAddressList(value).some((address) =>
    normalizedAliases.has(normalizeAddress(address)),
  );
}

function isUnknownSender(value: string | null): boolean {
  return !value || normalizeAddress(value) === "unknown";
}

function isGuardedBroadRuntimeAlias(value: string | null): boolean {
  return Boolean(
    value && GUARDED_BROAD_RUNTIME_ALIASES.has(normalizeAddress(value)),
  );
}

function addressRoutingMatchesBroadAlias(
  address: ParsedAddress | null,
  sender: string | null,
): boolean {
  return Boolean(
    address?.routingAddress &&
    sender &&
    normalizeAddress(address.routingAddress) === normalizeAddress(sender) &&
    isGuardedBroadRuntimeAlias(address.routingAddress),
  );
}

function addressAliasesInclude(
  address: ParsedAddress | null,
  value: string | null,
): boolean {
  return Boolean(
    value && address?.aliases.some((alias) => matchesAnyAlias(alias, [value])),
  );
}

function matchesConcreteAlias(
  value: string | null,
  aliases: string[],
): boolean {
  return Boolean(
    value &&
    !isGuardedBroadRuntimeAlias(value) &&
    matchesAnyAlias(value, aliases),
  );
}

function isOwnMessage(
  identity: {
    from: string | null;
    fromName: string | null;
    fromAddress: ParsedAddress | null;
  },
  aliases: string[],
): boolean {
  if (!isUnknownSender(identity.from)) {
    if (isGuardedBroadRuntimeAlias(identity.from)) {
      return (
        addressRoutingMatchesBroadAlias(identity.fromAddress, identity.from) &&
        matchesConcreteAlias(identity.fromName, aliases) &&
        addressAliasesInclude(identity.fromAddress, identity.fromName)
      );
    }
    return matchesAnyAlias(identity.from, aliases);
  }
  return matchesAnyAlias(identity.fromName, aliases);
}

function requiresOwnSource(dir: UplinkDir): boolean {
  return dir === "inbox" || dir === "reviews";
}

export function resolveLocalUplinkStatePath(options: {
  stateDir: string;
  agent: string;
  stateName?: string;
}): string {
  const uplinkDir = path.join(options.stateDir, "uplink");
  const rawName = options.stateName?.trim() || `local-uplink-${options.agent}`;
  const name = safeStateName(rawName) || "local-uplink";
  return path.join(uplinkDir, `${name}.json`);
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
): UplinkState {
  if (!options.resetCursor && fs.existsSync(statePath)) {
    try {
      const parsed = JSON.parse(
        fs.readFileSync(statePath, "utf8"),
      ) as Partial<UplinkState>;
      if (parsed.schemaVersion === 1 && parsed.joinedAt && parsed.uploaded) {
        return {
          schemaVersion: 1,
          agent: options.agent,
          aliases: options.aliases,
          sourceCommsDir: options.sourceCommsDir,
          targetCommsDir: options.targetCommsDir,
          createdAt: parsed.createdAt ?? options.now.toISOString(),
          joinedAt: parsed.joinedAt,
          uploaded: parsed.uploaded,
        };
      }
    } catch {
      // Fall through to fresh uplink cursor.
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
    uploaded: {},
  };
}

function saveState(statePath: string, state: UplinkState): void {
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

function parseSinceMs(
  options: RunLocalUplinkOptions,
  state: UplinkState,
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

function listCandidateFiles(
  sourceCommsDir: string,
  dirs: UplinkDir[],
): Array<{ dir: UplinkDir; filename: string; fullPath: string }> {
  const result: Array<{
    dir: UplinkDir;
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

function markUploaded(
  state: UplinkState,
  items: UplinkItem[],
  uploadedAt: string,
): void {
  for (const item of items) {
    if (!item.uploaded && item.skipReason !== "target-exists") continue;
    state.uploaded[item.dedupeKey] = {
      relativePath: item.relativePath,
      messageId: item.messageId,
      mtime: item.mtime,
      uploadedAt,
    };
  }
}

function sameFileContent(leftPath: string, rightPath: string): boolean {
  try {
    return fs.readFileSync(leftPath).equals(fs.readFileSync(rightPath));
  } catch {
    return false;
  }
}

function scanUplink(
  options: RunLocalUplinkOptions,
  state: UplinkState,
  aliases: string[],
  dirs: UplinkDir[],
  sinceMs: number | null,
): Omit<
  RunLocalUplinkResult,
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
  const items: UplinkItem[] = [];
  const skipped = {
    old: 0,
    duplicate: 0,
    notFromAgent: 0,
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
      !options.includeAllSources &&
      requiresOwnSource(candidate.dir) &&
      !isOwnMessage(metadata, aliases)
    ) {
      skipped.notFromAgent += 1;
      continue;
    }

    const relativePath = `${candidate.dir}/${candidate.filename}`;
    const dedupeKey = metadata.messageId?.trim() || relativePath;
    if (state.uploaded[dedupeKey]) {
      skipped.duplicate += 1;
      continue;
    }

    const targetPath = path.join(
      options.targetCommsDir,
      candidate.dir,
      candidate.filename,
    );
    const targetExists = fs.existsSync(targetPath);
    const skipReason = targetExists
      ? sameFileContent(candidate.fullPath, targetPath)
        ? "target-exists"
        : "collision"
      : "dry-run";
    items.push({
      dir: candidate.dir,
      filename: candidate.filename,
      sourcePath: candidate.fullPath,
      targetPath,
      relativePath,
      mtime: stat.mtime.toISOString(),
      dedupeKey,
      messageId: metadata.messageId,
      from: metadata.from,
      fromName: metadata.fromName,
      to: metadata.to,
      subject: metadata.subject,
      uploaded: false,
      skipReason,
    });
    if (items.length >= limit) break;
  }

  return {
    status: items.length > 0 ? "pending" : "idle",
    items,
    scanned,
    skipped,
  };
}

function applyUplink(items: UplinkItem[]): void {
  for (const item of items) {
    if (
      item.skipReason === "target-exists" ||
      item.skipReason === "collision"
    ) {
      continue;
    }
    fs.mkdirSync(path.dirname(item.targetPath), { recursive: true });
    fs.copyFileSync(item.sourcePath, item.targetPath);
    const sourceStat = fs.statSync(item.sourcePath);
    fs.utimesSync(item.targetPath, sourceStat.atime, sourceStat.mtime);
    item.uploaded = true;
    item.skipReason = null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runLocalUplink(
  rawOptions: RunLocalUplinkOptions,
): Promise<RunLocalUplinkResult> {
  const now = rawOptions.now ?? new Date();
  const options = {
    ...rawOptions,
    now,
    sourceCommsDir: path.resolve(rawOptions.sourceCommsDir),
    targetCommsDir: path.resolve(rawOptions.targetCommsDir),
  };
  const sourceCommsDirLabel =
    rawOptions.sourceCommsDirLabel ?? options.sourceCommsDir;
  const aliases = unique([
    options.agent,
    ...(options.aliases ?? []),
    process.env.TAP_AGENT_ID ?? "",
    process.env.TAP_AGENT_NAME ?? "",
  ]);
  const warnings: string[] = [];
  const normalizedDirs = normalizeUplinkDirs(options.dirs);
  const dirs = normalizedDirs.dirs;

  if (normalizedDirs.disallowed > 0) {
    warnings.push(
      `Ignored ${normalizedDirs.disallowed} disallowed uplink dir(s); only append-only dirs are supported.`,
    );
  }
  if (options.sourceCommsDir === options.targetCommsDir) {
    throw new RangeError(
      "Uplink source and target comms directories must differ.",
    );
  }

  const statePath = resolveLocalUplinkStatePath({
    stateDir: options.stateDir,
    agent: options.agent,
    stateName: options.stateName,
  });
  const state = loadState(statePath, {
    agent: options.agent,
    aliases,
    sourceCommsDir: sourceCommsDirLabel,
    targetCommsDir: options.targetCommsDir,
    now,
    resetCursor: options.resetCursor,
  });
  const sinceMs = parseSinceMs(options, state);
  const maxIterations =
    options.mode === "watch" && options.maxIterations !== undefined
      ? Math.max(1, options.maxIterations)
      : options.mode === "watch"
        ? 0
        : 1;
  const intervalMs = Math.max(100, options.intervalMs ?? DEFAULT_INTERVAL_MS);

  await options.beforeScan?.();
  let aggregate = scanUplink(options, state, aliases, dirs, sinceMs);
  if (options.mode === "watch") {
    let iteration = 1;
    while (aggregate.items.length === 0) {
      if (maxIterations > 0 && iteration >= maxIterations) break;
      iteration += 1;
      await sleep(intervalMs);
      await options.beforeScan?.();
      aggregate = scanUplink(options, state, aliases, dirs, sinceMs);
    }
  }

  let stateWritten = false;
  if (options.mode === "apply" || options.mode === "watch") {
    if (aggregate.items.length > 0) {
      applyUplink(aggregate.items);
      markUploaded(state, aggregate.items, now.toISOString());
    }
    saveState(statePath, state);
    stateWritten = true;
  }

  const uploaded = aggregate.items.some((item) => item.uploaded);
  const blocked = aggregate.items.some(
    (item) => item.skipReason === "collision",
  );

  return {
    mode: options.mode,
    agent: options.agent,
    aliases,
    sourceCommsDir: sourceCommsDirLabel,
    targetCommsDir: options.targetCommsDir,
    statePath,
    adapter: "local-uplink",
    receiveTransport: "polling",
    status:
      uploaded && options.mode !== "check"
        ? "uploaded"
        : blocked
          ? "blocked"
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
