import * as fs from "node:fs";
import * as path from "node:path";
import {
  createTapMessageViewModel,
  renderAgentMessagePrompt,
  type TapReturnAddress,
} from "../routing/tap-message-prompt.js";
import { classifyReviewMetaForOperator } from "../reviews/stale-meta.js";

export type PollingReceiverMode = "check" | "apply" | "watch";

export type PollingReceiverSource = "inbox";

export interface PollingReceiverItem {
  source: PollingReceiverSource;
  filename: string;
  path: string;
  from: string;
  fromName?: string | null;
  fromAddress?: TapReturnAddress | null;
  to: string;
  toName?: string | null;
  toAddress?: TapReturnAddress | null;
  subject: string;
  mtime: string;
  dedupeKey: string;
  messageId: string | null;
  content?: string;
}

export interface PollingReceiverStateEntry {
  filename: string;
  messageId: string | null;
  mtime: string;
  processedAt: string;
}

export interface PollingReceiverState {
  schemaVersion: 1;
  agent: string;
  aliases: string[];
  createdAt: string;
  joinedAt: string;
  processed: Record<string, PollingReceiverStateEntry>;
}

export interface RunPollingReceiverOptions {
  mode: PollingReceiverMode;
  commsDir: string;
  stateDir: string;
  agent: string;
  aliases?: string[];
  includeContent?: boolean;
  includeOwn?: boolean;
  limit?: number;
  since?: string;
  sinceMinutes?: number;
  all?: boolean;
  resetCursor?: boolean;
  stateName?: string;
  intervalMs?: number;
  maxIterations?: number;
  now?: Date;
  excludeDedupeKeys?: Iterable<string>;
  debugEnvelope?: boolean;
}

export interface RunPollingReceiverResult {
  mode: PollingReceiverMode;
  agent: string;
  aliases: string[];
  commsDir: string;
  statePath: string;
  receiveTransport: "polling";
  adapter: "file-polling";
  status: "idle" | "pending";
  items: PollingReceiverItem[];
  promptBundle: string;
  scanned: number;
  skipped: {
    old: number;
    duplicate: number;
    notForAgent: number;
    own: number;
    staleMeta: number;
  };
  stateWritten: boolean;
  effectiveSince: string | null;
  warnings: string[];
}

export interface MarkPollingReceiverItemsProcessedOptions {
  stateDir: string;
  agent: string;
  aliases?: string[];
  stateName?: string;
  items: PollingReceiverItem[];
  now?: Date;
}

const DEFAULT_LOOKBACK_MINUTES = 5;
const DEFAULT_LIMIT = 20;
const DEFAULT_INTERVAL_MS = 2_000;

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
    .slice(0, 80);
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

function parseStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const aliases = value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);
  return aliases.length ? aliases : undefined;
}

function parseAddressField(value: string | undefined): TapReturnAddress | null {
  if (!value?.trim()) return null;
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object") return null;
    return {
      routingAddress:
        typeof parsed.routingAddress === "string"
          ? parsed.routingAddress
          : null,
      hostId: typeof parsed.hostId === "string" ? parsed.hostId : null,
      clientId: typeof parsed.clientId === "string" ? parsed.clientId : null,
      conversationId:
        typeof parsed.conversationId === "string"
          ? parsed.conversationId
          : null,
      ownerClientId:
        typeof parsed.ownerClientId === "string" ? parsed.ownerClientId : null,
      surfaceInstanceId:
        typeof parsed.surfaceInstanceId === "string"
          ? parsed.surfaceInstanceId
          : null,
      aliases: parseStringArray(parsed.aliases),
    };
  } catch {
    return null;
  }
}

function stripMetadata(content: string): string {
  if (content.startsWith("---")) {
    return content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").trim();
  }
  const lines = content.split(/\r?\n/);
  let index = 0;
  while (index < lines.length) {
    if (!lines[index].trim()) {
      index += 1;
      break;
    }
    if (!/^[A-Za-z][A-Za-z0-9_-]*:\s*/.test(lines[index])) break;
    index += 1;
  }
  return lines.slice(index).join("\n").trim();
}

function parseFilename(filename: string): {
  from: string;
  to: string;
  subject: string;
} | null {
  const stem = filename.replace(/\.md$/i, "");
  const parts = stem.split("-");
  if (parts.length < 4) return null;
  return {
    from: parts[1] || "unknown",
    to: parts[2] || "all",
    subject: parts.slice(3).join("-") || stem,
  };
}

function splitAddressList(value: string): string[] {
  return value
    .split(/[,\s]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function isForAgent(to: string, aliases: string[]): boolean {
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

const GENERIC_RUNTIME_RECIPIENTS = new Set([
  "codex",
  "reviewer",
  "implementer",
  "implementation",
]);

function isGenericRuntimeRecipient(value: string | null | undefined): boolean {
  if (!value?.trim()) return false;
  return GENERIC_RUNTIME_RECIPIENTS.has(normalizeAddress(value));
}

function structuredRecipientHints(parsed: {
  to: string;
  toName: string | null;
  toAddress: TapReturnAddress | null;
}): string[] {
  const hints = [
    parsed.toName,
    ...(parsed.toAddress?.aliases ?? []),
    parsed.toAddress?.routingAddress,
  ].filter((value): value is string => Boolean(value?.trim()));
  const concrete: string[] = [];
  for (const hint of hints) {
    if (isGenericRuntimeRecipient(hint)) continue;
    if (
      concrete.some(
        (value) => normalizeAddress(value) === normalizeAddress(hint),
      )
    ) {
      continue;
    }
    concrete.push(hint);
  }
  return concrete;
}

function isParsedMessageForAgent(
  parsed: {
    to: string;
    toName: string | null;
    toAddress: TapReturnAddress | null;
  },
  aliases: string[],
): boolean {
  const concreteHints = structuredRecipientHints(parsed);
  if (concreteHints.length > 0) {
    if (concreteHints.some((hint) => isForAgent(hint, aliases))) {
      return true;
    }
    if (isGenericRuntimeRecipient(parsed.to)) {
      return false;
    }
  }
  return isForAgent(parsed.to, aliases);
}

function isOwnMessage(from: string, aliases: string[]): boolean {
  const normalizedAliases = new Set(aliases.map(normalizeAddress));
  return splitAddressList(from).some((address) =>
    normalizedAliases.has(normalizeAddress(address)),
  );
}

function parseMessage(
  filename: string,
  content: string,
): {
  from: string;
  fromName: string | null;
  fromAddress: TapReturnAddress | null;
  to: string;
  toName: string | null;
  toAddress: TapReturnAddress | null;
  subject: string;
  messageId: string | null;
  displayContent: string;
} | null {
  const frontmatter = parseFrontmatter(content);
  const headers = parseHeaderFields(content);
  const parsedFilename = parseFilename(filename);

  const from = frontmatter.from ?? headers.from ?? parsedFilename?.from;
  const to = frontmatter.to ?? headers.to ?? parsedFilename?.to;
  const subject =
    frontmatter.subject ?? headers.subject ?? parsedFilename?.subject;
  if (!from || !to || !subject) return null;

  const messageId =
    frontmatter.message_id ??
    frontmatter.messageid ??
    headers["message-id"] ??
    headers.message_id ??
    null;

  return {
    from,
    fromName: frontmatter.from_name ?? headers.from_name ?? null,
    fromAddress: parseAddressField(
      frontmatter.from_address ?? headers.from_address,
    ),
    to,
    toName: frontmatter.to_name ?? headers.to_name ?? null,
    toAddress: parseAddressField(frontmatter.to_address ?? headers.to_address),
    subject,
    messageId,
    displayContent: stripMetadata(content),
  };
}

export function resolvePollingReceiverStatePath(options: {
  stateDir: string;
  agent: string;
  stateName?: string;
}): string {
  const receiverDir = path.join(options.stateDir, "receiver");
  const rawName = options.stateName?.trim() || `codex-cli-${options.agent}`;
  const name = safeStateName(rawName) || "codex-cli";
  return path.join(receiverDir, `${name}.json`);
}

function loadState(
  statePath: string,
  options: {
    agent: string;
    aliases: string[];
    now: Date;
    resetCursor?: boolean;
  },
): PollingReceiverState {
  if (!options.resetCursor && fs.existsSync(statePath)) {
    try {
      const parsed = JSON.parse(
        fs.readFileSync(statePath, "utf8"),
      ) as Partial<PollingReceiverState>;
      if (parsed.schemaVersion === 1 && parsed.joinedAt && parsed.processed) {
        return {
          schemaVersion: 1,
          agent: options.agent,
          aliases: options.aliases,
          createdAt: parsed.createdAt ?? options.now.toISOString(),
          joinedAt: parsed.joinedAt,
          processed: parsed.processed,
        };
      }
    } catch {
      // Fall through to a fresh cursor. The caller reports a warning.
    }
  }
  return {
    schemaVersion: 1,
    agent: options.agent,
    aliases: options.aliases,
    createdAt: options.now.toISOString(),
    joinedAt: options.now.toISOString(),
    processed: {},
  };
}

function saveState(statePath: string, state: PollingReceiverState): void {
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

function parseSinceMs(
  options: RunPollingReceiverOptions,
  state: PollingReceiverState,
): number {
  if (options.all) return 0;
  const explicitSince =
    typeof options.since === "string" ? new Date(options.since).getTime() : 0;
  if (Number.isFinite(explicitSince) && explicitSince > 0) {
    return explicitSince;
  }
  if (typeof options.sinceMinutes === "number") {
    return options.now!.getTime() - options.sinceMinutes * 60_000;
  }
  if (options.mode === "check") {
    return options.now!.getTime() - DEFAULT_LOOKBACK_MINUTES * 60_000;
  }
  const joinedAtMs = new Date(state.joinedAt).getTime();
  return Number.isFinite(joinedAtMs) ? joinedAtMs : options.now!.getTime();
}

function scanInbox(
  options: RunPollingReceiverOptions,
  state: PollingReceiverState,
  aliases: string[],
): Omit<
  RunPollingReceiverResult,
  | "mode"
  | "agent"
  | "aliases"
  | "commsDir"
  | "statePath"
  | "receiveTransport"
  | "adapter"
  | "stateWritten"
  | "effectiveSince"
  | "warnings"
> {
  const inboxDir = path.join(options.commsDir, "inbox");
  const limit = Math.max(1, Math.min(100, options.limit ?? DEFAULT_LIMIT));
  const sinceMs = parseSinceMs(options, state);
  const items: PollingReceiverItem[] = [];
  const skipped = {
    old: 0,
    duplicate: 0,
    notForAgent: 0,
    own: 0,
    staleMeta: 0,
  };
  const excludeDedupeKeys = new Set(options.excludeDedupeKeys ?? []);
  let scanned = 0;

  if (!fs.existsSync(inboxDir)) {
    return {
      status: "idle",
      items,
      promptBundle: buildPromptBundle(options.agent, items, {
        debugEnvelope: options.debugEnvelope,
      }),
      scanned,
      skipped,
    };
  }

  const filenames = fs
    .readdirSync(inboxDir)
    .filter((filename) => filename.endsWith(".md"))
    .sort();

  for (const filename of filenames) {
    const fullPath = path.join(inboxDir, filename);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(fullPath);
    } catch {
      continue;
    }
    if (!stat.isFile()) continue;
    scanned += 1;
    if (sinceMs && stat.mtimeMs < sinceMs) {
      skipped.old += 1;
      continue;
    }

    let content: string;
    try {
      content = fs.readFileSync(fullPath, "utf8").replace(/^\uFEFF/, "");
    } catch {
      continue;
    }
    const parsed = parseMessage(filename, content);
    if (!parsed || !isParsedMessageForAgent(parsed, aliases)) {
      skipped.notForAgent += 1;
      continue;
    }
    if (!options.includeOwn && isOwnMessage(parsed.from, aliases)) {
      skipped.own += 1;
      continue;
    }
    const reviewMeta = classifyReviewMetaForOperator({
      root: options.commsDir,
      filename,
      subject: parsed.subject,
      body: parsed.displayContent,
      sourceRelativePath: `inbox/${filename}`,
    });
    if (reviewMeta.status === "collapsed-stale-meta") {
      skipped.staleMeta += 1;
      continue;
    }

    const dedupeKey = parsed.messageId?.trim() || filename;
    if (excludeDedupeKeys.has(dedupeKey)) {
      // Transient supervisor exclusion: count with duplicate-style skips so
      // the public result shape remains stable while this cycle tries newer
      // candidates.
      skipped.duplicate += 1;
      continue;
    }
    if (state.processed[dedupeKey]) {
      skipped.duplicate += 1;
      continue;
    }

    const item: PollingReceiverItem = {
      source: "inbox",
      filename,
      path: `inbox/${filename}`,
      from: parsed.from,
      fromName: parsed.fromName,
      fromAddress: parsed.fromAddress,
      to: parsed.to,
      toName: parsed.toName,
      toAddress: parsed.toAddress,
      subject: parsed.subject,
      mtime: stat.mtime.toISOString(),
      dedupeKey,
      messageId: parsed.messageId,
    };
    if (options.includeContent !== false) {
      item.content = parsed.displayContent;
    }
    items.push(item);
    if (items.length >= limit) break;
  }

  return {
    status: items.length > 0 ? "pending" : "idle",
    items,
    promptBundle: buildPromptBundle(options.agent, items, {
      debugEnvelope: options.debugEnvelope,
    }),
    scanned,
    skipped,
  };
}

function markProcessed(
  state: PollingReceiverState,
  items: PollingReceiverItem[],
  processedAt: string,
): void {
  for (const item of items) {
    state.processed[item.dedupeKey] = {
      filename: item.filename,
      messageId: item.messageId,
      mtime: item.mtime,
      processedAt,
    };
  }
}

export function markPollingReceiverItemsProcessed(
  rawOptions: MarkPollingReceiverItemsProcessedOptions,
): { statePath: string; stateWritten: boolean; processedAt: string } {
  const now = rawOptions.now ?? new Date();
  const aliases = unique([
    rawOptions.agent,
    ...(rawOptions.aliases ?? []),
    process.env.TAP_AGENT_ID ?? "",
    process.env.TAP_AGENT_NAME ?? "",
  ]);
  const statePath = resolvePollingReceiverStatePath({
    stateDir: rawOptions.stateDir,
    agent: rawOptions.agent,
    stateName: rawOptions.stateName,
  });
  const state = loadState(statePath, {
    agent: rawOptions.agent,
    aliases,
    now,
  });
  const processedAt = now.toISOString();
  markProcessed(state, rawOptions.items, processedAt);
  saveState(statePath, state);
  return { statePath, stateWritten: true, processedAt };
}

export function buildPromptBundle(
  agent: string,
  items: PollingReceiverItem[],
  options: { debugEnvelope?: boolean } = {},
): string {
  if (items.length === 0) {
    return `[tap receiver] polling/file-polling: no new local inbox items for ${agent}.`;
  }
  const lines = [
    `[tap receiver] polling/file-polling: ${items.length} local inbox item(s) for ${agent}.`,
    "Promotion is operator-mediated; no Codex turn was started automatically.",
    "",
    "Suggested next step inside Codex CLI:",
    'tap_list_unread({ sources: ["inbox"], includeContent: true, markRead: false })',
    "",
    "Pending messages:",
  ];
  for (const [index, item] of items.entries()) {
    const prompt = renderAgentMessagePrompt(
      createTapMessageViewModel({
        agentName: agent,
        sender: item.fromName ?? item.from,
        recipient: item.toName ?? item.to,
        subject: item.subject,
        fileName: item.filename,
        body: item.content ?? "",
        replyTo: item.from,
        returnAddress: item.fromAddress,
      }),
      { debugEnvelope: options.debugEnvelope },
    );
    lines.push("", `#${index + 1}`, prompt);
    if (options.debugEnvelope) {
      lines.push(
        `- source: ${item.path}`,
        `- mtime: ${item.mtime}`,
        `- dedupeKey: ${item.dedupeKey}`,
        `- messageId: ${item.messageId ?? "(none)"}`,
      );
    }
  }
  return lines.join("\n");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runPollingReceiver(
  rawOptions: RunPollingReceiverOptions,
): Promise<RunPollingReceiverResult> {
  const now = rawOptions.now ?? new Date();
  const options = { ...rawOptions, now };
  const aliases = unique([
    options.agent,
    ...(options.aliases ?? []),
    process.env.TAP_AGENT_ID ?? "",
    process.env.TAP_AGENT_NAME ?? "",
  ]);
  const warnings: string[] = [];
  const statePath = resolvePollingReceiverStatePath({
    stateDir: options.stateDir,
    agent: options.agent,
    stateName: options.stateName,
  });
  const state = loadState(statePath, {
    agent: options.agent,
    aliases,
    now,
    resetCursor: options.resetCursor,
  });
  const hadState = fs.existsSync(statePath);

  let aggregate = scanInbox(options, state, aliases);
  const maxIterations =
    options.mode === "watch" ? Math.max(1, options.maxIterations ?? 0) : 1;
  const intervalMs = Math.max(100, options.intervalMs ?? DEFAULT_INTERVAL_MS);

  if (options.mode === "watch") {
    let iteration = 1;
    while (aggregate.items.length === 0) {
      if (maxIterations > 0 && iteration >= maxIterations) break;
      await sleep(intervalMs);
      iteration += 1;
      aggregate = scanInbox(options, state, aliases);
    }
  }

  let stateWritten = false;
  if (options.mode !== "check" && aggregate.items.length > 0) {
    markProcessed(state, aggregate.items, new Date().toISOString());
    saveState(statePath, state);
    stateWritten = true;
  } else if (options.mode !== "check" && !hadState) {
    saveState(statePath, state);
    stateWritten = true;
  }

  const effectiveSinceMs = parseSinceMs(options, state);
  return {
    mode: options.mode,
    agent: options.agent,
    aliases,
    commsDir: options.commsDir,
    statePath,
    receiveTransport: "polling",
    adapter: "file-polling",
    stateWritten,
    effectiveSince:
      effectiveSinceMs > 0 ? new Date(effectiveSinceMs).toISOString() : null,
    warnings,
    ...aggregate,
  };
}
