import * as fs from "node:fs";
import { randomUUID, timingSafeEqual } from "node:crypto";
import * as http from "node:http";
import * as net from "node:net";
import * as path from "node:path";
import { resolveConfig } from "../config/index.js";
import {
  runPollingReceiver,
  type PollingReceiverItem,
} from "../receiver/codex-cli-polling-receiver.js";
import {
  findRepoRoot,
  log,
  logHeader,
  logSuccess,
  parseArgs,
  parseIntFlag,
  resolveCommsDir,
} from "../utils.js";
import type { CommandResult } from "../types.js";

const REMOTE_PANEL_HELP = `
Usage:
  tap remote-panel --host <ip-or-host> --port <n> --agent <name> (--read-only | --send-enabled --token-env <env>) [options]

Description:
  Start a mobile-friendly, read-only tap communication panel.

Options:
  --host <host>        Explicit bind host. Required. Refuses 0.0.0.0.
  --port <n>           Listener port. Default: 8765.
  --agent <name>       Operator/agent route to highlight. Default: codex.
  --alias <name>       Additional receiver alias. Repeatable/comma-separated.
  --comms-dir <path>   Override comms directory.
  --state-dir <path>   Override tap state directory.
  --limit <n>          Recent message limit. Default: 30.
  --receiver-limit <n> Pending receiver item limit. Default: 5.
  --receiver-since-minutes <n>
                       Pending receiver lookback. Default: 1440.
  --receiver-state-name <name>
                       Cursor profile to inspect. Auto-detected when omitted.
  --read-only          Inbox/status view only.
  --send-enabled       Enable append-only inbox writes through /api/send.
  --token-env <name>   Environment variable containing the send token/PIN.
  --help, -h           Show help.

Examples:
  tap remote-panel --host 127.0.0.1 --port 8765 --agent agent-a --read-only
  tap remote-panel --host 127.0.0.1 --port 8765 --agent agent-a --send-enabled --token-env TAP_REMOTE_PANEL_TOKEN
`.trim();

type RemotePanelStatus = "read-only" | "send-enabled" | "blocked";

interface RemotePanelMessage {
  filename: string;
  relativePath: string;
  evidencePath: string;
  from: string;
  to: string;
  subject: string;
  mtime: string;
  preview: string;
}

interface RemotePanelReceiverItem {
  path: string;
  from: string;
  to: string;
  subject: string;
  mtime: string;
}

interface RemotePanelReceiverSnapshot {
  status: "idle" | "pending";
  receiveTransport: "polling";
  adapter: "file-polling";
  statePath: string;
  stateName: string | null;
  pendingCount: number;
  effectiveSince: string | null;
  items: RemotePanelReceiverItem[];
  skipped: {
    old: number;
    duplicate: number;
    notForAgent: number;
    own: number;
  };
  warnings: string[];
}

interface RemotePanelSnapshot extends Record<string, unknown> {
  status: RemotePanelStatus;
  generatedAt: string;
  agent: string;
  aliases: string[];
  commsDir: string;
  stateDir: string;
  readOnly: boolean;
  sendEnabled: boolean;
  messages: RemotePanelMessage[];
  receiver: RemotePanelReceiverSnapshot;
}

export interface RemotePanelOptions {
  host: string;
  port: number;
  agent: string;
  aliases: string[];
  commsDir: string;
  stateDir: string;
  limit: number;
  receiverLimit: number;
  receiverSinceMinutes: number;
  receiverStateName?: string;
  readOnly: boolean;
  sendEnabled: boolean;
  tokenEnv?: string;
  sendToken?: string;
}

export function createRemotePanelServer(
  options: RemotePanelOptions,
): http.Server {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(
        req.url ?? "/",
        `http://${formatRemotePanelUrlHost(options.host)}:${options.port}`,
      );
      if (req.method === "POST" && url.pathname === "/api/send") {
        const result = await handleRemotePanelSend(options, req);
        res.writeHead(result.status, {
          "Content-Type": "application/json; charset=utf-8",
        });
        res.end(JSON.stringify(result.body, null, 2));
        return;
      }
      if (req.method && req.method !== "GET") {
        res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("remote panel supports GET only except /api/send");
        return;
      }
      if (url.pathname === "/api/snapshot") {
        const snapshot = await collectRemotePanelSnapshot(options);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(snapshot, null, 2));
        return;
      }
      if (url.pathname === "/evidence") {
        const result = readEvidenceFile(
          options.commsDir,
          url.searchParams.get("path") ?? "",
        );
        res.writeHead(result.status, {
          "Content-Type": "text/plain; charset=utf-8",
        });
        res.end(result.content);
        return;
      }
      const snapshot = await collectRemotePanelSnapshot(options);
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(buildRemotePanelHtml(snapshot));
    } catch (error) {
      log(
        `remote panel snapshot error: ${error instanceof Error ? error.message : String(error)}`,
      );
      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("remote panel snapshot error");
    }
  });
}

function normalizeRoute(value: string): string {
  return value.trim().toLowerCase();
}

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) continue;
    const key = normalizeRoute(trimmed);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }
  return result;
}

function parseListFlag(value: string | boolean | undefined): string[] {
  if (typeof value !== "string") return [];
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function collectRepeatedListFlag(args: string[], flag: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (
      arg === `--${flag}` &&
      args[index + 1] &&
      !args[index + 1].startsWith("--")
    ) {
      values.push(...parseListFlag(args[index + 1]));
      index += 1;
      continue;
    }
    if (arg.startsWith(`--${flag}=`)) {
      values.push(...parseListFlag(arg.slice(flag.length + 3)));
    }
  }
  return values;
}

function htmlEscape(value: string | null | undefined): string {
  if (!value) return "";
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function yamlScalar(value: string): string {
  return JSON.stringify(value);
}

function safeFileLabel(value: string, fallback: string): string {
  const normalized = value
    .trim()
    .replace(/[^A-Za-z0-9가-힣_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return normalized || fallback;
}

function parseSendFields(
  rawBody: string,
  contentType: string,
): Record<string, string> {
  if (contentType.toLowerCase().includes("application/json")) {
    const parsed = JSON.parse(rawBody || "{}") as Record<string, unknown>;
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "string") result[key] = value;
    }
    return result;
  }
  const params = new URLSearchParams(rawBody);
  const result: Record<string, string> = {};
  for (const [key, value] of params.entries()) {
    result[key] = value;
  }
  return result;
}

function readRequestBody(
  req: http.IncomingMessage,
  maxBytes = 16_384,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new Error("request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function isValidSendToken(provided: string, expected: string): boolean {
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);
  if (providedBuffer.length !== expectedBuffer.length) return false;
  return timingSafeEqual(providedBuffer, expectedBuffer);
}

function isValidSimpleRoute(value: string): boolean {
  return /^(전체|[A-Za-z0-9가-힣_]+)$/.test(value);
}

function validateSendInput(fields: Record<string, string>): {
  to: string;
  subject: string;
  content: string;
} | null {
  const to = fields.to?.trim() ?? "";
  const subject = fields.subject?.trim() ?? "";
  const content = fields.content?.trim() ?? "";
  if (!to || !subject || !content) return null;
  if (to.length > 80 || subject.length > 120 || content.length > 4_000) {
    return null;
  }
  if (!isValidSimpleRoute(to)) return null;
  return { to, subject, content };
}

function writeRemotePanelMessage(options: {
  commsDir: string;
  from: string;
  aliases: string[];
  to: string;
  subject: string;
  content: string;
  now?: Date;
}): {
  filename: string;
  evidencePath: string;
  messageId: string;
  sentAt: string;
} {
  const now = options.now ?? new Date();
  const sentAt = now.toISOString();
  const date = sentAt.slice(0, 10).replace(/-/g, "");
  const messageId = randomUUID();
  const fromLabel = safeFileLabel(options.from, "operator");
  const toLabel = safeFileLabel(options.to, "target");
  const subjectLabel = safeFileLabel(options.subject, "message");
  const filename = `${date}-${fromLabel}-${toLabel}-${subjectLabel}-${messageId.slice(0, 8)}.md`;
  const inboxDir = path.join(options.commsDir, "inbox");
  const filePath = path.join(inboxDir, filename);
  const fromAddress = {
    hostId: options.commsDir,
    clientId: "remote-panel",
    conversationId: null,
    ownerClientId: null,
    routingAddress: options.from,
    aliases: unique([options.from, ...options.aliases]),
  };
  const toAddress = {
    hostId: null,
    clientId: null,
    conversationId: null,
    ownerClientId: null,
    routingAddress: options.to,
    aliases: [options.to],
  };
  const frontmatter = [
    "---",
    "type: inbox",
    `message_id: ${messageId}`,
    `from: ${options.from}`,
    `to: ${options.to}`,
    `from_address: ${JSON.stringify(fromAddress)}`,
    `to_address: ${JSON.stringify(toAddress)}`,
    "scope: observe",
    "action: remote-panel-send",
    `subject: ${yamlScalar(options.subject)}`,
    `sent_at: ${sentAt}`,
    "---",
    "",
  ].join("\n");
  fs.mkdirSync(inboxDir, { recursive: true });
  fs.writeFileSync(filePath, `${frontmatter}${options.content}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
  return {
    filename,
    evidencePath: `inbox/${filename}`,
    messageId,
    sentAt,
  };
}

async function handleRemotePanelSend(
  options: RemotePanelOptions,
  req: http.IncomingMessage,
): Promise<{
  status: number;
  body: Record<string, unknown>;
}> {
  if (!options.sendEnabled || !options.sendToken) {
    return {
      status: 403,
      body: {
        ok: false,
        code: "TAP_REMOTE_PANEL_SEND_DISABLED",
        message: "send is disabled; start with --send-enabled --token-env",
      },
    };
  }
  let fields: Record<string, string>;
  try {
    const rawBody = await readRequestBody(req);
    fields = parseSendFields(rawBody, req.headers["content-type"] ?? "");
  } catch (error) {
    return {
      status: 400,
      body: {
        ok: false,
        code: "TAP_REMOTE_PANEL_BAD_REQUEST",
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
  const token =
    req.headers["x-tap-panel-token"]?.toString() || fields.token?.trim() || "";
  if (!isValidSendToken(token, options.sendToken)) {
    return {
      status: 403,
      body: {
        ok: false,
        code: "TAP_REMOTE_PANEL_INVALID_TOKEN",
        message: "invalid remote panel token",
      },
    };
  }
  const input = validateSendInput(fields);
  if (!input) {
    return {
      status: 400,
      body: {
        ok: false,
        code: "TAP_REMOTE_PANEL_INVALID_MESSAGE",
        message:
          "send requires to, subject, and content; target must be a simple tap route",
      },
    };
  }
  try {
    const written = writeRemotePanelMessage({
      commsDir: options.commsDir,
      from: options.agent,
      aliases: options.aliases,
      ...input,
    });
    return {
      status: 201,
      body: {
        ok: true,
        code: "TAP_REMOTE_PANEL_SENT_INBOX_ONLY",
        message:
          "append-only inbox evidence written; no live IPC or turn promotion was attempted",
        sendMode: "append-only-inbox",
        liveAttempted: false,
        ...written,
      },
    };
  } catch (error) {
    return {
      status: 500,
      body: {
        ok: false,
        code: "TAP_REMOTE_PANEL_WRITE_FAILED",
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

function stripMetadata(content: string): string {
  const withoutFrontmatter = content.replace(
    /^---\r?\n[\s\S]*?\r?\n---\r?\n?/,
    "",
  );
  return withoutFrontmatter
    .replace(/^From:\s*.+$/gim, "")
    .replace(/^To:\s*.+$/gim, "")
    .replace(/^Date:\s*.+$/gim, "")
    .replace(/^Subject:\s*.+$/gim, "")
    .trim();
}

function parseSimpleFrontmatter(content: string): Record<string, string> {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return {};
  const result: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    let value = line.slice(idx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

function parseHeaderFields(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of content.split(/\r?\n/).slice(0, 12)) {
    const match = line.match(/^([A-Za-z][A-Za-z_-]*):\s*(.+)$/);
    if (!match) continue;
    result[match[1].toLowerCase()] = match[2].trim();
  }
  return result;
}

function parseFilename(filename: string): {
  from: string;
  to: string;
  subject: string;
} | null {
  const base = filename.replace(/\.md$/i, "");
  const parts = base.split("-");
  if (parts.length < 4) return null;
  const from = parts[1];
  const to = parts[2];
  const subject = parts.slice(3).join("-");
  if (!from || !to || !subject) return null;
  return { from, to, subject };
}

function oneLinePreview(content: string, maxLength = 220): string {
  const normalized = content.replace(/\s+/g, " ").trim();
  return normalized.length > maxLength
    ? `${normalized.slice(0, maxLength - 1)}…`
    : normalized;
}

function parseMessageFile(options: {
  commsDir: string;
  dir: "inbox";
  filename: string;
}): RemotePanelMessage | null {
  const fullPath = path.join(options.commsDir, options.dir, options.filename);
  let stat: fs.Stats;
  let content: string;
  try {
    stat = fs.statSync(fullPath);
    if (!stat.isFile()) return null;
    content = fs.readFileSync(fullPath, "utf8").replace(/^\uFEFF/, "");
  } catch {
    return null;
  }
  const frontmatter = parseSimpleFrontmatter(content);
  const headers = parseHeaderFields(content);
  const parsedFilename = parseFilename(options.filename);
  const from =
    frontmatter.from ?? headers.from ?? parsedFilename?.from ?? "unknown";
  const to = frontmatter.to ?? headers.to ?? parsedFilename?.to ?? "unknown";
  const subject =
    frontmatter.subject ??
    headers.subject ??
    parsedFilename?.subject ??
    "(no subject)";
  const relativePath = `${options.dir}/${options.filename}`;
  return {
    filename: options.filename,
    relativePath,
    evidencePath: relativePath,
    from,
    to,
    subject,
    mtime: stat.mtime.toISOString(),
    preview: oneLinePreview(stripMetadata(content)),
  };
}

function receiverItemSummary(
  item: PollingReceiverItem,
): RemotePanelReceiverItem {
  return {
    path: item.path,
    from: item.from,
    to: item.to,
    subject: item.subject,
    mtime: item.mtime,
  };
}

function discoverReceiverStateName(options: {
  stateDir: string;
  agent: string;
  aliases: string[];
}): string | undefined {
  const receiverDir = path.join(options.stateDir, "receiver");
  if (!fs.existsSync(receiverDir)) return undefined;
  const aliases = new Set(
    unique([options.agent, ...options.aliases]).map(normalizeRoute),
  );
  let best: { name: string; mtimeMs: number } | null = null;
  for (const filename of fs.readdirSync(receiverDir)) {
    if (!filename.endsWith(".json")) continue;
    const fullPath = path.join(receiverDir, filename);
    let stat: fs.Stats;
    let parsed: {
      agent?: unknown;
      aliases?: unknown;
    };
    try {
      stat = fs.statSync(fullPath);
      parsed = JSON.parse(fs.readFileSync(fullPath, "utf8")) as {
        agent?: unknown;
        aliases?: unknown;
      };
    } catch {
      continue;
    }
    const stateAliases = unique([
      typeof parsed.agent === "string" ? parsed.agent : "",
      ...(Array.isArray(parsed.aliases)
        ? parsed.aliases.filter(
            (item): item is string => typeof item === "string",
          )
        : []),
    ]);
    if (!stateAliases.some((alias) => aliases.has(normalizeRoute(alias)))) {
      continue;
    }
    const name = filename.replace(/\.json$/i, "");
    if (!best || stat.mtimeMs > best.mtimeMs) {
      best = { name, mtimeMs: stat.mtimeMs };
    }
  }
  return best?.name;
}

async function collectReceiverSnapshot(
  options: RemotePanelOptions,
): Promise<RemotePanelReceiverSnapshot> {
  const stateName =
    options.receiverStateName ??
    discoverReceiverStateName({
      stateDir: options.stateDir,
      agent: options.agent,
      aliases: options.aliases,
    });
  const result = await runPollingReceiver({
    mode: "check",
    commsDir: options.commsDir,
    stateDir: options.stateDir,
    agent: options.agent,
    aliases: options.aliases,
    includeContent: false,
    limit: options.receiverLimit,
    sinceMinutes: options.receiverSinceMinutes,
    stateName,
  });
  return {
    status: result.status,
    receiveTransport: result.receiveTransport,
    adapter: result.adapter,
    statePath: result.statePath,
    stateName: stateName ?? null,
    pendingCount: result.items.length,
    effectiveSince: result.effectiveSince,
    items: result.items.map(receiverItemSummary),
    skipped: result.skipped,
    warnings: result.warnings,
  };
}

export async function collectRemotePanelSnapshot(options: {
  commsDir: string;
  stateDir: string;
  agent: string;
  aliases?: string[];
  limit: number;
  receiverLimit?: number;
  receiverSinceMinutes?: number;
  receiverStateName?: string;
  readOnly?: boolean;
  sendEnabled?: boolean;
  now?: Date;
}): Promise<RemotePanelSnapshot> {
  const fullOptions: RemotePanelOptions = {
    host: "127.0.0.1",
    port: 0,
    agent: options.agent,
    aliases: options.aliases ?? [],
    commsDir: options.commsDir,
    stateDir: options.stateDir,
    limit: options.limit,
    receiverLimit: options.receiverLimit ?? 5,
    receiverSinceMinutes: options.receiverSinceMinutes ?? 1_440,
    receiverStateName: options.receiverStateName,
    readOnly: options.readOnly ?? true,
    sendEnabled: options.sendEnabled ?? false,
  };
  const inboxDir = path.join(options.commsDir, "inbox");
  const messages: RemotePanelMessage[] = [];
  if (fs.existsSync(inboxDir)) {
    const files = fs
      .readdirSync(inboxDir)
      .filter((filename) => filename.endsWith(".md"))
      .map((filename) => {
        const fullPath = path.join(inboxDir, filename);
        try {
          return { filename, mtimeMs: fs.statSync(fullPath).mtimeMs };
        } catch {
          return null;
        }
      })
      .filter(
        (entry): entry is { filename: string; mtimeMs: number } => !!entry,
      )
      .sort((a, b) => b.mtimeMs - a.mtimeMs)
      .slice(0, Math.max(1, Math.min(100, options.limit)));

    for (const file of files) {
      const parsed = parseMessageFile({
        commsDir: options.commsDir,
        dir: "inbox",
        filename: file.filename,
      });
      if (parsed) messages.push(parsed);
    }
  }

  return {
    status: fullOptions.sendEnabled ? "send-enabled" : "read-only",
    generatedAt: (options.now ?? new Date()).toISOString(),
    agent: options.agent,
    aliases: fullOptions.aliases,
    commsDir: options.commsDir,
    stateDir: options.stateDir,
    readOnly: fullOptions.readOnly,
    sendEnabled: fullOptions.sendEnabled,
    messages,
    receiver: await collectReceiverSnapshot(fullOptions),
  };
}

function resolveEvidencePath(
  commsDir: string,
  requestedPath: string,
): string | null {
  if (requestedPath.includes("\0")) return null;
  if (path.isAbsolute(requestedPath)) return null;
  const normalized = path.normalize(requestedPath).replace(/^[/\\]+/, "");
  if (normalized.startsWith("..") || path.isAbsolute(normalized)) return null;
  const [dir] = normalized.split(/[\\/]/);
  if (dir !== "inbox") return null;
  const fullPath = path.resolve(commsDir, normalized);
  const root = path.resolve(commsDir);
  if (!fullPath.startsWith(`${root}${path.sep}`)) return null;
  return fullPath;
}

export function readEvidenceFile(
  commsDir: string,
  requestedPath: string,
): {
  ok: boolean;
  status: number;
  content: string;
} {
  const fullPath = resolveEvidencePath(commsDir, requestedPath);
  if (!fullPath) {
    return { ok: false, status: 400, content: "invalid evidence path" };
  }
  try {
    const stat = fs.statSync(fullPath);
    if (!stat.isFile()) {
      return { ok: false, status: 404, content: "evidence not found" };
    }
    return {
      ok: true,
      status: 200,
      content: fs.readFileSync(fullPath, "utf8"),
    };
  } catch {
    return { ok: false, status: 404, content: "evidence not found" };
  }
}

export function buildRemotePanelHtml(snapshot: RemotePanelSnapshot): string {
  const skipped = snapshot.receiver.skipped;
  const receiverHint = [
    snapshot.receiver.pendingCount > 0
      ? `${snapshot.receiver.pendingCount} message(s) are waiting for ${snapshot.agent}.`
      : `No pending receiver messages for ${snapshot.agent}.`,
    `Transport: ${snapshot.receiver.receiveTransport}/${snapshot.receiver.adapter}.`,
    snapshot.receiver.effectiveSince
      ? `Looking since ${snapshot.receiver.effectiveSince}.`
      : "Looking across the default receiver window.",
  ].join(" ");
  const receiverDebugHint = [
    `state ${snapshot.receiver.stateName ?? "auto/default"}`,
    `skipped old ${skipped.old}`,
    `duplicate ${skipped.duplicate}`,
    `not-for-agent ${skipped.notForAgent}`,
    `own ${skipped.own}`,
  ].join(" · ");
  const receiverRows = snapshot.receiver.items
    .map(
      (item) => `<article class="message receiver-message">
  <div class="meta">${htmlEscape(item.mtime)} · ${htmlEscape(item.from)} → ${htmlEscape(item.to)}</div>
  <h2>${htmlEscape(item.subject)}</h2>
  <p>Pending receiver item. Use the evidence link for the raw envelope when debugging.</p>
  <a href="/evidence?path=${encodeURIComponent(item.path)}">debug evidence</a>
</article>`,
    )
    .join("\n");
  const rows = snapshot.messages
    .map(
      (item) => `<article class="message">
  <div class="meta">${htmlEscape(item.mtime)} · ${htmlEscape(item.from)} → ${htmlEscape(item.to)}</div>
  <h2>${htmlEscape(item.subject)}</h2>
  <p>${htmlEscape(item.preview)}</p>
  <a href="/evidence?path=${encodeURIComponent(item.evidencePath)}">evidence</a>
</article>`,
    )
    .join("\n");
  const sendPanel = snapshot.sendEnabled
    ? `<section class="send-panel">
      <h2>send append-only message</h2>
      <p class="hint">Writes durable inbox evidence only. No live IPC, consent-drive, or turn promotion is attempted.</p>
      <form method="post" action="/api/send">
        <label>Token/PIN <input name="token" type="password" autocomplete="off" required></label>
        <label>To <input name="to" maxlength="80" placeholder="agent-b" required></label>
        <label>Subject <input name="subject" maxlength="120" placeholder="remote-panel-ping" required></label>
        <label>Content <textarea name="content" maxlength="4000" rows="5" required></textarea></label>
        <button type="submit">Write inbox evidence</button>
      </form>
    </section>`
    : `<section class="send-panel disabled">
      <h2>send disabled</h2>
      <p class="hint">Start with <code>--send-enabled --token-env &lt;env&gt;</code> to enable append-only inbox writes.</p>
    </section>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>tap remote panel</title>
<style>
  :root { color-scheme: light; --ink:#172016; --muted:#63705f; --line:#d9e3d3; --paper:#fbfff7; --leaf:#2f6f3e; --sun:#f3b43f; }
  * { box-sizing: border-box; }
  body { margin:0; font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; color:var(--ink); background: radial-gradient(circle at top left, #fff2c2, transparent 32rem), linear-gradient(135deg, #f8fff1, #eef7e9); }
  main { width:min(46rem, 100%); margin:0 auto; padding:1rem; }
  header { padding:1rem 0 0.5rem; }
  h1 { margin:0; font-size:1.55rem; letter-spacing:-0.04em; }
  .panel { border:1px solid var(--line); border-radius:1rem; background:rgba(255,255,255,0.72); box-shadow:0 1rem 3rem rgba(47,111,62,0.12); overflow:hidden; }
  .status { display:flex; flex-wrap:wrap; gap:0.5rem; padding:0.8rem; border-bottom:1px solid var(--line); color:var(--muted); font-size:0.86rem; }
  .pill { border:1px solid var(--line); border-radius:999px; padding:0.25rem 0.55rem; background:#fff; }
  .readonly { color:#fff; background:var(--leaf); border-color:var(--leaf); }
  .pending { color:#172016; background:var(--sun); border-color:var(--sun); }
  .message { padding:0.95rem; border-bottom:1px solid var(--line); }
  .message:last-child { border-bottom:0; }
  .receiver { border-bottom:1px solid var(--line); background:rgba(243,180,63,0.12); }
  .receiver h2 { padding:0 0.95rem; margin:0.75rem 0 0.2rem; }
  .receiver .hint { padding:0 0.95rem 0.35rem; margin:0; color:var(--muted); font-size:0.86rem; }
  .receiver .debug-hint { padding:0 0.95rem 0.75rem; margin:0; color:var(--muted); font-size:0.76rem; opacity:0.78; }
  .send-panel { padding:0.95rem; border-bottom:1px solid var(--line); background:rgba(47,111,62,0.08); }
  .send-panel.disabled { background:rgba(255,255,255,0.42); }
  .send-panel h2 { margin:0 0 0.25rem; }
  form { display:grid; gap:0.65rem; margin-top:0.75rem; }
  label { display:grid; gap:0.25rem; color:var(--muted); font-size:0.82rem; }
  input, textarea { width:100%; border:1px solid var(--line); border-radius:0.65rem; padding:0.65rem; font:inherit; color:var(--ink); background:#fff; }
  button { border:0; border-radius:0.75rem; padding:0.8rem 1rem; font:inherit; font-weight:800; color:#fff; background:var(--leaf); }
  code { font-size:0.82rem; }
  .receiver-message { background:rgba(255,255,255,0.55); }
  .meta { color:var(--muted); font-size:0.78rem; }
  h2 { margin:0.25rem 0; font-size:1.02rem; }
  p { margin:0.4rem 0 0.55rem; line-height:1.45; }
  a { color:var(--leaf); font-weight:700; text-decoration:none; }
  .empty { padding:1rem; color:var(--muted); }
</style>
</head>
<body>
<main>
  <header>
    <h1>tap remote panel</h1>
  </header>
  <section class="panel">
    <div class="status">
      <span class="pill readonly">read-only</span>
      <span class="pill ${snapshot.sendEnabled ? "pending" : ""}">${snapshot.sendEnabled ? "send-enabled" : "send-disabled"}</span>
      <span class="pill">agent ${htmlEscape(snapshot.agent)}</span>
      <span class="pill">${htmlEscape(snapshot.aliases.join(", ") || "no aliases")}</span>
      <span class="pill ${snapshot.receiver.pendingCount > 0 ? "pending" : ""}">${htmlEscape(snapshot.receiver.pendingCount.toString())} pending receiver item(s)</span>
      <span class="pill">${htmlEscape(snapshot.messages.length.toString())} recent inbox item(s)</span>
      <span class="pill">${htmlEscape(snapshot.generatedAt)}</span>
    </div>
    <section class="receiver">
      <h2>receiver queue</h2>
      <p class="hint">${htmlEscape(receiverHint)}</p>
      <p class="debug-hint">AX: ${htmlEscape(receiverDebugHint)} · raw snapshot at <a href="/api/snapshot">/api/snapshot</a></p>
      ${receiverRows || '<div class="empty">No pending receiver items.</div>'}
    </section>
    ${sendPanel}
    ${rows || '<div class="empty">No recent inbox messages.</div>'}
  </section>
</main>
</body>
</html>`;
}

function parseIpv4Octets(host: string): number[] | null {
  const parts = host.split(".");
  if (parts.length !== 4) return null;
  const octets = parts.map((part) => {
    if (!/^\d+$/.test(part)) return Number.NaN;
    const value = Number(part);
    return value >= 0 && value <= 255 ? value : Number.NaN;
  });
  return octets.every((octet) => Number.isInteger(octet)) ? octets : null;
}

function isPrivateIpv4(host: string): boolean {
  const octets = parseIpv4Octets(host);
  if (!octets) return false;
  const [a, b] = octets;
  if (a === 127) return true;
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // Tailscale/CGNAT.
  if (a === 169 && b === 254) return true;
  return false;
}

function isPrivateIpv6(host: string): boolean {
  const normalized = host.toLowerCase();
  if (normalized.includes("%")) return false;
  return (
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe80:")
  );
}

export function isAllowedRemotePanelBindHost(host: string): boolean {
  const trimmed = host.trim();
  if (!trimmed) return false;
  if (trimmed === "localhost") return true;
  const ipVersion = net.isIP(trimmed);
  if (ipVersion === 4) return isPrivateIpv4(trimmed);
  if (ipVersion === 6) return isPrivateIpv6(trimmed);
  return false;
}

export function formatRemotePanelUrlHost(host: string): string {
  const trimmed = host.trim();
  return net.isIP(trimmed) === 6 ? `[${trimmed}]` : trimmed;
}

export function isRemotePanelSendTokenReady(
  token: string | null | undefined,
): boolean {
  return Boolean(token?.trim() && token.trim().length >= 4);
}

function parseRemotePanelOptions(args: string[]): RemotePanelOptions | null {
  const { flags } = parseArgs(args);
  const host = typeof flags.host === "string" ? flags.host.trim() : "";
  if (!isAllowedRemotePanelBindHost(host)) return null;
  const port =
    parseIntFlag(
      typeof flags.port === "string" ? flags.port : undefined,
      "--port",
      1024,
      65535,
    ) ?? 8765;
  const agent =
    typeof flags.agent === "string" && flags.agent.trim()
      ? flags.agent.trim()
      : "codex";
  if (!isValidSimpleRoute(agent) || agent === "전체") return null;
  const repoRoot = findRepoRoot();
  const { config } = resolveConfig(
    {
      stateDir:
        typeof flags["state-dir"] === "string" ? flags["state-dir"] : undefined,
    },
    repoRoot,
  );
  const commsDir = resolveCommsDir(args, repoRoot);
  const aliases = unique([
    ...collectRepeatedListFlag(args, "alias"),
    ...collectRepeatedListFlag(args, "aliases"),
    ...parseListFlag(flags.alias),
    ...parseListFlag(flags.aliases),
    agent !== "codex" ? "codex" : "",
  ]);
  const limit =
    parseIntFlag(
      typeof flags.limit === "string" ? flags.limit : undefined,
      "--limit",
      1,
      100,
    ) ?? 30;
  const receiverLimit =
    parseIntFlag(
      typeof flags["receiver-limit"] === "string"
        ? flags["receiver-limit"]
        : undefined,
      "--receiver-limit",
      1,
      20,
    ) ?? 5;
  const receiverSinceMinutes =
    parseIntFlag(
      typeof flags["receiver-since-minutes"] === "string"
        ? flags["receiver-since-minutes"]
        : undefined,
      "--receiver-since-minutes",
      1,
      525_600,
    ) ?? 1_440;
  const receiverStateName =
    typeof flags["receiver-state-name"] === "string" &&
    flags["receiver-state-name"].trim()
      ? flags["receiver-state-name"].trim()
      : undefined;
  const sendEnabled = flags["send-enabled"] === true;
  const readOnly = flags["read-only"] === true || sendEnabled;
  const tokenEnv =
    typeof flags["token-env"] === "string" && flags["token-env"].trim()
      ? flags["token-env"].trim()
      : undefined;
  const sendToken = tokenEnv ? process.env[tokenEnv]?.trim() : undefined;
  if (!readOnly) return null;
  if (sendEnabled && (!tokenEnv || !isRemotePanelSendTokenReady(sendToken))) {
    throw new Error(
      "remote-panel --send-enabled requires --token-env <env> with a token/PIN of at least 4 characters",
    );
  }
  return {
    host,
    port,
    agent,
    aliases,
    commsDir,
    stateDir: path.resolve(config.stateDir),
    limit,
    receiverLimit,
    receiverSinceMinutes,
    receiverStateName,
    readOnly,
    sendEnabled,
    tokenEnv,
    sendToken,
  };
}

export async function remotePanelCommand(
  args: string[],
): Promise<CommandResult> {
  const { flags } = parseArgs(args);
  if (flags.help === true || flags.h === true) {
    log(REMOTE_PANEL_HELP);
    return {
      ok: true,
      command: "remote-panel",
      code: "TAP_NO_OP",
      message: REMOTE_PANEL_HELP,
      warnings: [],
      data: {},
    };
  }

  let options: RemotePanelOptions | null;
  try {
    options = parseRemotePanelOptions(args);
  } catch (err) {
    return {
      ok: false,
      command: "remote-panel",
      code: "TAP_INVALID_ARGUMENT",
      message: err instanceof Error ? err.message : String(err),
      warnings: [],
      data: {},
    };
  }

  if (!options) {
    return {
      ok: false,
      command: "remote-panel",
      code: "TAP_INVALID_ARGUMENT",
      message:
        "remote-panel requires --host <loopback-or-private-ip> and either --read-only or --send-enabled --token-env; public or wildcard binds are refused",
      warnings: [],
      data: {},
    };
  }

  const server = createRemotePanelServer(options);

  return new Promise<CommandResult>((resolve) => {
    server.on("error", (err: NodeJS.ErrnoException) => {
      resolve({
        ok: false,
        command: "remote-panel",
        code: err.code === "EADDRINUSE" ? "TAP_PORT_IN_USE" : "TAP_GUI_ERROR",
        message:
          err.code === "EADDRINUSE"
            ? `Port ${options.port} is already in use`
            : err.message,
        warnings: [],
        data: {},
      });
    });

    server.listen(options.port, options.host, () => {
      logHeader("tap remote panel");
      logSuccess(
        `Panel: http://${formatRemotePanelUrlHost(options.host)}:${options.port}`,
      );
      log(
        `Mode:  ${options.sendEnabled ? "send-enabled append-only" : "read-only"}`,
      );
      log(`Agent: ${options.agent}`);
      log(`Aliases: ${options.aliases.join(", ") || "(none)"}`);
      log(`Comms: ${options.commsDir}`);
      log(`State: ${options.stateDir}`);
      log("Press Ctrl+C to stop");
    });
  });
}
