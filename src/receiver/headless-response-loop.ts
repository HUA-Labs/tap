import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  createTapMessageViewModel,
  renderAgentMessagePrompt,
} from "../routing/tap-message-prompt.js";
import {
  markPollingReceiverItemsProcessed,
  runPollingReceiver,
  type PollingReceiverItem,
  type RunPollingReceiverOptions,
} from "./codex-cli-polling-receiver.js";

export interface HeadlessRunnerRequest {
  promptText: string;
  agent: string;
  commsDir: string;
  stateDir: string;
  replyReceiptDir: string;
  cwd: string;
  item: PollingReceiverItem;
  timeoutMs: number;
}

export interface HeadlessRunnerResult {
  exitCode: number | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
}

export interface HeadlessRunner {
  run(request: HeadlessRunnerRequest): Promise<HeadlessRunnerResult>;
}

export interface RunHeadlessResponseLoopOptions extends Omit<
  RunPollingReceiverOptions,
  "mode" | "limit"
> {
  mode: "dry-run" | "once";
  cwd?: string;
  timeoutMs?: number;
  runnerCommand?: string | null;
  runner?: HeadlessRunner;
  allowNoReply?: boolean;
  replyReceiptDir?: string | null;
}

export interface HeadlessReplyEvidence {
  source: "inbox" | "reply-receipt";
  path: string;
  filename: string;
  from: string;
  to: string;
  subject: string;
  mtime: string;
}

interface RejectedReplyEvidence extends HeadlessReplyEvidence {
  reason: "sender-mismatch";
  expectedSenders: string[];
}

export interface HeadlessResponseLoopResult extends Record<string, unknown> {
  mode: "dry-run" | "once";
  agent: string;
  aliases: string[];
  commsDir: string;
  statePath: string;
  receiveTransport: "polling";
  adapter: "headless-runner";
  runtimeSurface: "codex-cli-headless";
  cwd: string;
  timeoutMs: number;
  status: "idle" | "dry-run" | "completed" | "blocked";
  blockedReason: string | null;
  item: PollingReceiverItem | null;
  replyTarget: string | null;
  promptText: string | null;
  runner: HeadlessRunnerResult | null;
  replyEvidence: HeadlessReplyEvidence | null;
  stateWritten: boolean;
  scanned: number;
  skipped: {
    old: number;
    duplicate: number;
    notForAgent: number;
    own: number;
  };
  effectiveSince: string | null;
  warnings: string[];
}

const DEFAULT_HEADLESS_TIMEOUT_MS = 120_000;
const NO_REPLY_MARKER = "TAP_HEADLESS_NO_REPLY";
const HEADLESS_REPLY_RECEIPT_ENV = "TAP_HEADLESS_REPLY_RECEIPT_DIR";
const FRESH_EVIDENCE_MTIME_TOLERANCE_MS = 1_000;

function isValidRoute(value: string | null | undefined): value is string {
  const normalized = value?.trim().toLowerCase();
  return Boolean(
    normalized &&
    normalized !== "unknown" &&
    normalized !== "unnamed" &&
    normalized !== "null" &&
    normalized !== "undefined" &&
    normalized !== "?",
  );
}

function resolveReplyTarget(item: PollingReceiverItem): string | null {
  if (isValidRoute(item.fromAddress?.routingAddress)) {
    return item.fromAddress.routingAddress.trim();
  }
  if (isValidRoute(item.from)) return item.from.trim();
  return null;
}

function buildHeadlessPrompt(agent: string, item: PollingReceiverItem): string {
  const viewModel = createTapMessageViewModel({
    agentName: agent,
    sender: item.fromName ?? item.from,
    recipient: item.toName ?? item.to,
    subject: item.subject,
    fileName: item.filename,
    body: item.content ?? "",
    replyTo: item.from,
    returnAddress: item.fromAddress,
    runtimeSurface: "codex-cli-headless",
    debugEnvelope: true,
  });
  return [
    renderAgentMessagePrompt(viewModel, { debugEnvelope: true }),
    "",
    "Headless response contract:",
    "- You are running as a bounded CLI/headless worker, not a visible TUI operator.",
    '- Before any tap_reply, call tap_reset_identity, then tap_set_name with your assigned agent name and receiveTransports ["polling"], then tap_session_warmup with the same name and receiveTransports.',
    `- Your assigned agent name for this run is "${agent}". If tap identity cannot be set to exactly "${agent}", do not call tap_reply; report the blocker on stdout instead.`,
    "- Do not run unrelated repository maintenance unless this message explicitly asks for it.",
    "- If a reply is required and a valid route is available, create durable reply evidence with tap_reply.",
    "- Plain text on stdout is diagnostic only and does not count as completion evidence.",
    `- If no reply is intentionally needed, emit exactly ${NO_REPLY_MARKER} only when the operator/profile allowed no-reply completion.`,
    '- Never reply to "unknown".',
  ].join("\n");
}

function buildSenderMismatchReason(evidence: RejectedReplyEvidence): string {
  return [
    "reply-evidence-sender-mismatch:",
    `expected=${evidence.expectedSenders.join(",")}`,
    `actual=${evidence.from}`,
    `path=${evidence.path}`,
  ].join(" ");
}

function expectedReplySenders(agent: string, aliases: string[]): string[] {
  const seen = new Set<string>();
  const expected: string[] = [];
  for (const value of [agent, ...aliases]) {
    const trimmed = value.trim();
    const normalized = trimmed.toLowerCase();
    if (!trimmed || seen.has(normalized)) continue;
    seen.add(normalized);
    expected.push(trimmed);
  }
  return expected;
}

function snapshotDir(
  dir: string,
  predicate: (filename: string) => boolean,
): Map<string, number> {
  if (!fs.existsSync(dir)) return new Map();
  const snapshot = new Map<string, number>();
  for (const filename of fs.readdirSync(dir).filter(predicate)) {
    try {
      const stat = fs.statSync(path.join(dir, filename));
      if (stat.isFile()) snapshot.set(filename, stat.mtimeMs);
    } catch {
      // Ignore files that disappear while the inbox is being scanned.
    }
  }
  return snapshot;
}

function snapshotInbox(commsDir: string): Map<string, number> {
  return snapshotDir(path.join(commsDir, "inbox"), (filename) =>
    filename.endsWith(".md"),
  );
}

function snapshotReplyReceipts(replyReceiptDir: string): Map<string, number> {
  return snapshotDir(replyReceiptDir, (filename) => filename.endsWith(".json"));
}

function parseField(content: string, name: string): string | null {
  const pattern = new RegExp(`^${name}:\\s*(.*)$`, "im");
  const match = content.match(pattern);
  return match?.[1]?.trim().replace(/^["']|["']$/g, "") || null;
}

function splitAddressList(value: string): string[] {
  return value
    .split(/[,\s]+/)
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
}

function normalizeReplySubject(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function isReplySubjectForRequest(
  candidateSubject: string,
  requestSubject: string,
): boolean {
  const candidate = normalizeReplySubject(candidateSubject);
  const request = normalizeReplySubject(requestSubject);
  if (!candidate || !request) return false;
  if (
    candidate === request ||
    candidate === `re-${request}` ||
    candidate === `re: ${request}` ||
    candidate === `reply-${request}` ||
    candidate === `${request}-reply`
  ) {
    return true;
  }

  const requestBase = stripTerminalRunToken(
    stripSubjectSuffix(request, ["-request"]),
  );
  const candidateBase = stripSubjectSuffix(candidate, [
    "-clean",
    "-findings",
    "-received",
    "-ack",
    "-reply",
  ]);
  return candidateBase === requestBase && candidateBase !== candidate;
}

function stripSubjectSuffix(value: string, suffixes: string[]): string {
  for (const suffix of suffixes) {
    if (value.endsWith(suffix) && value.length > suffix.length) {
      return value.slice(0, -suffix.length);
    }
  }
  return value;
}

function stripTerminalRunToken(value: string): string {
  return value.replace(
    /-(?:\d{8}t\d{4,6}z?|\d{8}t\d{4,6}(?:\.\d{1,3})?z?)$/,
    "",
  );
}

function findReplyEvidence(options: {
  commsDir: string;
  before: Map<string, number>;
  agent: string;
  aliases: string[];
  replyTarget: string;
  requestSubject: string;
  startedAtMs: number;
}): HeadlessReplyEvidence | null {
  return findReplyEvidenceCandidate(options).accepted;
}

function findRejectedReplyEvidence(options: {
  commsDir: string;
  before: Map<string, number>;
  agent: string;
  aliases: string[];
  replyTarget: string;
  requestSubject: string;
  startedAtMs: number;
  replyReceiptDir: string;
  beforeReplyReceipts: Map<string, number>;
}): RejectedReplyEvidence | null {
  return (
    findReplyEvidenceCandidate(options).rejected ??
    findReplyReceiptEvidenceCandidate({
      replyReceiptDir: options.replyReceiptDir,
      before: options.beforeReplyReceipts,
      agent: options.agent,
      aliases: options.aliases,
      replyTarget: options.replyTarget,
      requestSubject: options.requestSubject,
      startedAtMs: options.startedAtMs,
    }).rejected
  );
}

function findReplyEvidenceCandidate(options: {
  commsDir: string;
  before: Map<string, number>;
  agent: string;
  aliases: string[];
  replyTarget: string;
  requestSubject: string;
  startedAtMs: number;
}): {
  accepted: HeadlessReplyEvidence | null;
  rejected: RejectedReplyEvidence | null;
} {
  const inboxDir = path.join(options.commsDir, "inbox");
  if (!fs.existsSync(inboxDir)) {
    return { accepted: null, rejected: null };
  }
  const target = options.replyTarget.trim().toLowerCase();
  const expectedSenders = expectedReplySenders(options.agent, options.aliases);
  const senders = new Set(expectedSenders.map((value) => value.toLowerCase()));
  const candidates = fs
    .readdirSync(inboxDir)
    .filter((filename) => filename.endsWith(".md"))
    .sort();
  let accepted: HeadlessReplyEvidence | null = null;

  for (const filename of candidates) {
    const fullPath = path.join(inboxDir, filename);
    let stat: fs.Stats;
    let content: string;
    try {
      stat = fs.statSync(fullPath);
      if (
        !stat.isFile() ||
        stat.mtimeMs + FRESH_EVIDENCE_MTIME_TOLERANCE_MS < options.startedAtMs
      ) {
        continue;
      }
      const previousMtimeMs = options.before.get(filename);
      if (
        previousMtimeMs !== undefined &&
        stat.mtimeMs <= previousMtimeMs + 1
      ) {
        continue;
      }
      content = fs.readFileSync(fullPath, "utf8");
    } catch {
      continue;
    }
    const from = parseField(content, "from");
    const to = parseField(content, "to");
    const subject = parseField(content, "subject") ?? filename;
    if (!from || !to) continue;
    const fromMatches = senders.has(from.trim().toLowerCase());
    const toMatches = splitAddressList(to).includes(target);
    const subjectMatches = isReplySubjectForRequest(
      subject,
      options.requestSubject,
    );
    if (!toMatches || !subjectMatches) continue;
    const evidence = {
      source: "inbox",
      path: `inbox/${filename}`,
      filename,
      from,
      to,
      subject,
      mtime: stat.mtime.toISOString(),
    } satisfies HeadlessReplyEvidence;
    if (!fromMatches) {
      return {
        accepted: null,
        rejected: {
          ...evidence,
          reason: "sender-mismatch",
          expectedSenders,
        },
      };
    }
    accepted ??= evidence;
  }
  return { accepted, rejected: null };
}

function sanitizeReceiptPathSegment(value: string): string {
  return (
    value
      .trim()
      .replace(/[^A-Za-z0-9가-힣._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "default"
  );
}

function resolveReplyReceiptDir(
  options: RunHeadlessResponseLoopOptions,
): string {
  if (options.replyReceiptDir?.trim()) {
    return path.resolve(options.replyReceiptDir.trim());
  }
  const profile = sanitizeReceiptPathSegment(
    options.stateName ?? `codex-cli-${options.agent}`,
  );
  return path.join(options.stateDir, "headless-reply-receipts", profile);
}

function findReplyReceiptEvidence(options: {
  replyReceiptDir: string;
  before: Map<string, number>;
  agent: string;
  aliases: string[];
  replyTarget: string;
  requestSubject: string;
  startedAtMs: number;
}): HeadlessReplyEvidence | null {
  return findReplyReceiptEvidenceCandidate(options).accepted;
}

function findReplyReceiptEvidenceCandidate(options: {
  replyReceiptDir: string;
  before: Map<string, number>;
  agent: string;
  aliases: string[];
  replyTarget: string;
  requestSubject: string;
  startedAtMs: number;
}): {
  accepted: HeadlessReplyEvidence | null;
  rejected: RejectedReplyEvidence | null;
} {
  if (!fs.existsSync(options.replyReceiptDir)) {
    return { accepted: null, rejected: null };
  }
  const target = options.replyTarget.trim().toLowerCase();
  const expectedSenders = expectedReplySenders(options.agent, options.aliases);
  const senders = new Set(expectedSenders.map((value) => value.toLowerCase()));
  const candidates = fs
    .readdirSync(options.replyReceiptDir)
    .filter((filename) => filename.endsWith(".json"))
    .sort();
  let accepted: HeadlessReplyEvidence | null = null;

  for (const filename of candidates) {
    const fullPath = path.join(options.replyReceiptDir, filename);
    let stat: fs.Stats;
    let receipt: {
      type?: unknown;
      from?: unknown;
      to?: unknown;
      subject?: unknown;
      fileName?: unknown;
    };
    try {
      stat = fs.statSync(fullPath);
      if (
        !stat.isFile() ||
        stat.mtimeMs + FRESH_EVIDENCE_MTIME_TOLERANCE_MS < options.startedAtMs
      ) {
        continue;
      }
      const previousMtimeMs = options.before.get(filename);
      if (
        previousMtimeMs !== undefined &&
        stat.mtimeMs <= previousMtimeMs + 1
      ) {
        continue;
      }
      receipt = JSON.parse(fs.readFileSync(fullPath, "utf8")) as typeof receipt;
    } catch {
      continue;
    }
    if (receipt.type !== "tap_reply.sent") continue;
    if (
      typeof receipt.from !== "string" ||
      typeof receipt.to !== "string" ||
      typeof receipt.subject !== "string"
    ) {
      continue;
    }

    const fromMatches = senders.has(receipt.from.trim().toLowerCase());
    const toMatches = splitAddressList(receipt.to).includes(target);
    const subjectMatches = isReplySubjectForRequest(
      receipt.subject,
      options.requestSubject,
    );
    if (!toMatches || !subjectMatches) continue;

    const evidence = {
      source: "reply-receipt",
      path: `headless-reply-receipts/${filename}`,
      filename:
        typeof receipt.fileName === "string" && receipt.fileName.trim()
          ? receipt.fileName.trim()
          : filename,
      from: receipt.from,
      to: receipt.to,
      subject: receipt.subject,
      mtime: stat.mtime.toISOString(),
    } satisfies HeadlessReplyEvidence;
    if (!fromMatches) {
      return {
        accepted: null,
        rejected: {
          ...evidence,
          reason: "sender-mismatch",
          expectedSenders,
        },
      };
    }
    accepted ??= evidence;
  }
  return { accepted, rejected: null };
}

class ShellHeadlessRunner implements HeadlessRunner {
  constructor(private readonly command: string) {}

  run(request: HeadlessRunnerRequest): Promise<HeadlessRunnerResult> {
    return new Promise((resolve) => {
      const child = spawn(this.command, {
        cwd: request.cwd,
        shell: true,
        stdio: ["pipe", "pipe", "pipe"],
        env: {
          ...process.env,
          TAP_AGENT_NAME: request.agent,
          CODEX_TAP_AGENT_NAME: request.agent,
          TAP_COMMS_DIR: request.commsDir,
          TAP_STATE_DIR: request.stateDir,
          TAP_REPO_ROOT: request.cwd,
          [HEADLESS_REPLY_RECEIPT_ENV]: request.replyReceiptDir,
          TAP_HEADLESS_ITEM_PATH: request.item.path,
          TAP_HEADLESS_ITEM_SUBJECT: request.item.subject,
        },
      });
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let settled = false;
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
      }, request.timeoutMs);

      child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
      child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
      child.on("close", (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({
          exitCode: code,
          timedOut,
          stdout: Buffer.concat(stdout).toString("utf8"),
          stderr: Buffer.concat(stderr).toString("utf8"),
        });
      });
      child.on("error", (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({
          exitCode: null,
          timedOut,
          stdout: Buffer.concat(stdout).toString("utf8"),
          stderr: error instanceof Error ? error.message : String(error),
        });
      });
      child.stdin.end(request.promptText);
    });
  }
}

function blockedResult(
  options: RunHeadlessResponseLoopOptions,
  scan: Awaited<ReturnType<typeof runPollingReceiver>>,
  item: PollingReceiverItem | null,
  fields: {
    cwd: string;
    timeoutMs: number;
    promptText: string | null;
    replyTarget: string | null;
    blockedReason: string;
    runner?: HeadlessRunnerResult | null;
  },
): HeadlessResponseLoopResult {
  return {
    mode: options.mode,
    agent: scan.agent,
    aliases: scan.aliases,
    commsDir: scan.commsDir,
    statePath: scan.statePath,
    receiveTransport: "polling",
    adapter: "headless-runner",
    runtimeSurface: "codex-cli-headless",
    cwd: fields.cwd,
    timeoutMs: fields.timeoutMs,
    status: "blocked",
    blockedReason: fields.blockedReason,
    item,
    replyTarget: fields.replyTarget,
    promptText: fields.promptText,
    runner: fields.runner ?? null,
    replyEvidence: null,
    stateWritten: false,
    scanned: scan.scanned,
    skipped: scan.skipped,
    effectiveSince: scan.effectiveSince,
    warnings: scan.warnings,
  };
}

export async function runHeadlessResponseLoop(
  options: RunHeadlessResponseLoopOptions,
): Promise<HeadlessResponseLoopResult> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const replyReceiptDir = resolveReplyReceiptDir(options);
  const timeoutMs = Math.max(
    100,
    options.timeoutMs ?? DEFAULT_HEADLESS_TIMEOUT_MS,
  );
  const scan = await runPollingReceiver({
    ...options,
    mode: "check",
    limit: 1,
    includeContent: true,
  });
  const item = scan.items[0] ?? null;
  if (!item) {
    return {
      mode: options.mode,
      agent: scan.agent,
      aliases: scan.aliases,
      commsDir: scan.commsDir,
      statePath: scan.statePath,
      receiveTransport: "polling",
      adapter: "headless-runner",
      runtimeSurface: "codex-cli-headless",
      cwd,
      timeoutMs,
      status: "idle",
      blockedReason: null,
      item: null,
      replyTarget: null,
      promptText: null,
      runner: null,
      replyEvidence: null,
      stateWritten: false,
      scanned: scan.scanned,
      skipped: scan.skipped,
      effectiveSince: scan.effectiveSince,
      warnings: scan.warnings,
    };
  }

  const replyTarget = resolveReplyTarget(item);
  const promptText = buildHeadlessPrompt(scan.agent, item);
  if (!replyTarget) {
    return blockedResult(options, scan, item, {
      cwd,
      timeoutMs,
      promptText,
      replyTarget,
      blockedReason:
        "missing-return-route: no valid reply target; refusing to reply to unknown",
    });
  }

  if (options.mode === "dry-run") {
    return {
      mode: options.mode,
      agent: scan.agent,
      aliases: scan.aliases,
      commsDir: scan.commsDir,
      statePath: scan.statePath,
      receiveTransport: "polling",
      adapter: "headless-runner",
      runtimeSurface: "codex-cli-headless",
      cwd,
      timeoutMs,
      status: "dry-run",
      blockedReason: null,
      item,
      replyTarget,
      promptText,
      runner: null,
      replyEvidence: null,
      stateWritten: false,
      scanned: scan.scanned,
      skipped: scan.skipped,
      effectiveSince: scan.effectiveSince,
      warnings: scan.warnings,
    };
  }

  const runner =
    options.runner ??
    (options.runnerCommand
      ? new ShellHeadlessRunner(options.runnerCommand)
      : null);
  if (!runner) {
    return blockedResult(options, scan, item, {
      cwd,
      timeoutMs,
      promptText,
      replyTarget,
      blockedReason:
        "missing-runner: pass --runner-command for once-mode headless execution",
    });
  }

  const before = snapshotInbox(scan.commsDir);
  fs.mkdirSync(replyReceiptDir, { recursive: true });
  const beforeReplyReceipts = snapshotReplyReceipts(replyReceiptDir);
  const startedAtMs = Date.now();
  const runnerResult = await runner.run({
    promptText,
    agent: scan.agent,
    commsDir: scan.commsDir,
    stateDir: options.stateDir,
    replyReceiptDir,
    cwd,
    item,
    timeoutMs,
  });
  if (runnerResult.timedOut) {
    return blockedResult(options, scan, item, {
      cwd,
      timeoutMs,
      promptText,
      replyTarget,
      runner: runnerResult,
      blockedReason: `timeout: headless runner exceeded ${timeoutMs}ms`,
    });
  }
  if (runnerResult.exitCode !== 0) {
    return blockedResult(options, scan, item, {
      cwd,
      timeoutMs,
      promptText,
      replyTarget,
      runner: runnerResult,
      blockedReason: `runner-failed: exitCode=${runnerResult.exitCode ?? "null"}`,
    });
  }

  const replyEvidence =
    findReplyEvidence({
      commsDir: scan.commsDir,
      before,
      agent: scan.agent,
      aliases: scan.aliases,
      replyTarget,
      requestSubject: item.subject,
      startedAtMs,
    }) ??
    findReplyReceiptEvidence({
      replyReceiptDir,
      before: beforeReplyReceipts,
      agent: scan.agent,
      aliases: scan.aliases,
      replyTarget,
      requestSubject: item.subject,
      startedAtMs,
    });
  const noReply = runnerResult.stdout.trim() === NO_REPLY_MARKER;
  const rejectedReplyEvidence = findRejectedReplyEvidence({
    commsDir: scan.commsDir,
    before,
    agent: scan.agent,
    aliases: scan.aliases,
    replyTarget,
    requestSubject: item.subject,
    startedAtMs,
    replyReceiptDir,
    beforeReplyReceipts,
  });
  if (rejectedReplyEvidence) {
    return blockedResult(options, scan, item, {
      cwd,
      timeoutMs,
      promptText,
      replyTarget,
      runner: runnerResult,
      blockedReason: buildSenderMismatchReason(rejectedReplyEvidence),
    });
  }
  if (!replyEvidence && !(options.allowNoReply && noReply)) {
    return blockedResult(options, scan, item, {
      cwd,
      timeoutMs,
      promptText,
      replyTarget,
      runner: runnerResult,
      blockedReason:
        "plain-text-only: runner completed without durable tap_reply evidence",
    });
  }

  const marked = markPollingReceiverItemsProcessed({
    stateDir: options.stateDir,
    agent: scan.agent,
    aliases: scan.aliases,
    stateName: options.stateName,
    items: [item],
  });

  return {
    mode: options.mode,
    agent: scan.agent,
    aliases: scan.aliases,
    commsDir: scan.commsDir,
    statePath: marked.statePath,
    receiveTransport: "polling",
    adapter: "headless-runner",
    runtimeSurface: "codex-cli-headless",
    cwd,
    timeoutMs,
    status: "completed",
    blockedReason: null,
    item,
    replyTarget,
    promptText,
    runner: runnerResult,
    replyEvidence,
    stateWritten: marked.stateWritten,
    scanned: scan.scanned,
    skipped: scan.skipped,
    effectiveSince: scan.effectiveSince,
    warnings: scan.warnings,
  };
}
