#!/usr/bin/env node --experimental-strip-types

import { createHash } from "crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "fs";
import { join, resolve } from "path";

type BusyMode = "wait" | "steer";

interface Options {
  repoRoot: string;
  commsDir: string;
  agentName: string;
  stateDir: string;
  pollSeconds: number;
  reconnectSeconds: number;
  messageLookbackMinutes: number;
  processExistingMessages: boolean;
  dryRun: boolean;
  runOnce: boolean;
  waitAfterDispatchSeconds: number;
  appServerUrl: string;
  busyMode: BusyMode;
  threadId: string | null;
  ephemeral: boolean;
  dispatchTimeoutMinutes: number;
}

interface InboxRoute {
  sender: string;
  recipient: string;
  subject: string;
}

interface Candidate {
  markerId: string;
  filePath: string;
  fileName: string;
  sender: string;
  recipient: string;
  subject: string;
  body: string;
  mtimeMs: number;
}

interface ThreadStateRecord {
  threadId: string;
  updatedAt: string;
  appServerUrl: string;
  ephemeral: boolean;
}

interface HeartbeatRecord {
  pid: number;
  agent: string;
  updatedAt: string;
  pollSeconds: number;
  appServerUrl: string;
  connected: boolean;
  initialized: boolean;
  threadId: string | null;
  activeTurnId: string | null;
  lastTurnStatus: string | null;
  lastNotificationMethod: string | null;
  lastNotificationAt: string | null;
  lastError: string | null;
  lastSuccessfulAppServerAt: string | null;
  lastSuccessfulAppServerMethod: string | null;
  consecutiveFailureCount: number;
  busyMode: BusyMode;
  dispatchTimedOut: boolean;
  lastDispatchAt: string | null;
}

interface BridgeHealthState {
  consecutiveFailureCount: number;
  dispatchTimedOut: boolean;
  lastDispatchAt: string | null;
}

interface RequestRecord {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params: unknown;
}

interface JsonRpcResponse {
  id?: number;
  result?: any;
  error?: {
    code?: number;
    message?: string;
    data?: unknown;
  };
  method?: string;
  params?: any;
}

const DEFAULT_AGENT = String.fromCharCode(0xc628);
const DEFAULT_APP_SERVER_URL = "ws://127.0.0.1:4501";

function printHelp(): void {
  console.log(`Codex App Server bridge

Usage:
  node --experimental-strip-types scripts/codex-app-server-bridge.ts [options]

Options:
  --repo-root=<path>
  --comms-dir=<path>
  --agent-name=<name>
  --state-dir=<path>
  --poll-seconds=<n>
  --reconnect-seconds=<n>
  --message-lookback-minutes=<n>
  --process-existing-messages
  --dry-run
  --run-once
  --wait-after-dispatch-seconds=<n>
  --app-server-url=<ws-url>
  --busy-mode=wait|steer
  --thread-id=<id>
  --ephemeral
  --dispatch-timeout-minutes=<n>
  --help
`);
}

function parseNumber(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Invalid ${flag}: ${value}`);
  }
  return parsed;
}

function readFlagValue(argv: string[], index: number, flag: string): string {
  const current = argv[index];
  const eqIndex = current.indexOf("=");
  if (eqIndex >= 0) {
    return current.slice(eqIndex + 1);
  }

  const next = argv[index + 1];
  if (!next || next.startsWith("--")) {
    throw new Error(`Missing value for ${flag}`);
  }
  return next;
}

function parseArgs(argv: string[]): {
  repoRoot?: string;
  commsDir?: string;
  agentName?: string;
  stateDir?: string;
  pollSeconds?: number;
  reconnectSeconds?: number;
  messageLookbackMinutes?: number;
  processExistingMessages: boolean;
  dryRun: boolean;
  runOnce: boolean;
  waitAfterDispatchSeconds?: number;
  appServerUrl?: string;
  busyMode?: BusyMode;
  threadId?: string;
  ephemeral: boolean;
  dispatchTimeoutMinutes?: number;
} {
  const parsed = {
    processExistingMessages: false,
    dryRun: false,
    runOnce: false,
    ephemeral: false,
  } as {
    repoRoot?: string;
    commsDir?: string;
    agentName?: string;
    stateDir?: string;
    pollSeconds?: number;
    reconnectSeconds?: number;
    messageLookbackMinutes?: number;
    processExistingMessages: boolean;
    dryRun: boolean;
    runOnce: boolean;
    waitAfterDispatchSeconds?: number;
    appServerUrl?: string;
    busyMode?: BusyMode;
    threadId?: string;
    ephemeral: boolean;
  };

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const consumesNext = !flag.includes("=");

    if (flag === "--help") {
      printHelp();
      process.exit(0);
    }

    if (flag === "--process-existing-messages") {
      parsed.processExistingMessages = true;
      continue;
    }

    if (flag === "--dry-run") {
      parsed.dryRun = true;
      continue;
    }

    if (flag === "--run-once") {
      parsed.runOnce = true;
      continue;
    }

    if (flag === "--ephemeral") {
      parsed.ephemeral = true;
      continue;
    }

    if (flag.startsWith("--repo-root")) {
      parsed.repoRoot = readFlagValue(argv, index, "--repo-root");
      if (consumesNext) {
        index += 1;
      }
      continue;
    }

    if (flag.startsWith("--comms-dir")) {
      parsed.commsDir = readFlagValue(argv, index, "--comms-dir");
      if (consumesNext) {
        index += 1;
      }
      continue;
    }

    if (flag.startsWith("--agent-name")) {
      parsed.agentName = readFlagValue(argv, index, "--agent-name");
      if (consumesNext) {
        index += 1;
      }
      continue;
    }

    if (flag.startsWith("--state-dir")) {
      parsed.stateDir = readFlagValue(argv, index, "--state-dir");
      if (consumesNext) {
        index += 1;
      }
      continue;
    }

    if (flag.startsWith("--poll-seconds")) {
      parsed.pollSeconds = parseNumber(
        readFlagValue(argv, index, "--poll-seconds"),
        "--poll-seconds",
      );
      if (consumesNext) {
        index += 1;
      }
      continue;
    }

    if (flag.startsWith("--reconnect-seconds")) {
      parsed.reconnectSeconds = parseNumber(
        readFlagValue(argv, index, "--reconnect-seconds"),
        "--reconnect-seconds",
      );
      if (consumesNext) {
        index += 1;
      }
      continue;
    }

    if (flag.startsWith("--message-lookback-minutes")) {
      parsed.messageLookbackMinutes = parseNumber(
        readFlagValue(argv, index, "--message-lookback-minutes"),
        "--message-lookback-minutes",
      );
      if (consumesNext) {
        index += 1;
      }
      continue;
    }

    if (flag.startsWith("--app-server-url")) {
      parsed.appServerUrl = readFlagValue(argv, index, "--app-server-url");
      if (consumesNext) {
        index += 1;
      }
      continue;
    }

    if (flag.startsWith("--wait-after-dispatch-seconds")) {
      parsed.waitAfterDispatchSeconds = parseNumber(
        readFlagValue(argv, index, "--wait-after-dispatch-seconds"),
        "--wait-after-dispatch-seconds",
      );
      if (consumesNext) {
        index += 1;
      }
      continue;
    }

    if (flag.startsWith("--busy-mode")) {
      const value = readFlagValue(argv, index, "--busy-mode");
      if (value !== "wait" && value !== "steer") {
        throw new Error(`Invalid --busy-mode: ${value}`);
      }
      parsed.busyMode = value;
      if (consumesNext) {
        index += 1;
      }
      continue;
    }

    if (flag.startsWith("--thread-id")) {
      parsed.threadId = readFlagValue(argv, index, "--thread-id");
      if (consumesNext) {
        index += 1;
      }
      continue;
    }

    if (flag.startsWith("--dispatch-timeout-minutes")) {
      parsed.dispatchTimeoutMinutes = parseNumber(
        readFlagValue(argv, index, "--dispatch-timeout-minutes"),
        "--dispatch-timeout-minutes",
      );
      if (consumesNext) {
        index += 1;
      }
      continue;
    }

    throw new Error(`Unknown argument: ${flag}`);
  }

  return parsed;
}

function timestamp(): string {
  return new Date().toISOString().replace("T", " ").replace("Z", " UTC");
}

function logStatus(message: string): void {
  console.log(`[${timestamp()}] ${message}`);
}

function writeCommsBroadcast(
  options: Options,
  message: string,
  subject: string,
): void {
  const inboxDir = join(options.commsDir, "inbox");
  if (!existsSync(inboxDir)) return;

  const now = new Date();
  const date = now.toISOString().slice(0, 10).replace(/-/g, "");
  const fileName = `${date}-bridge-전체-${subject}.md`;
  const filePath = join(inboxDir, fileName);

  const body = [
    "# Bridge Alert",
    "",
    `- **Agent**: ${options.agentName}`,
    `- **Time**: ${now.toISOString()}`,
    `- **App Server**: ${options.appServerUrl}`,
    "",
    message,
    "",
  ].join("\n");

  try {
    writeFileSync(filePath, body, "utf8");
    logStatus(`comms broadcast: ${message}`);
  } catch {
    logStatus(`comms broadcast failed (could not write to ${filePath})`);
  }
}

function ensureDir(target: string): string {
  if (!existsSync(target)) {
    mkdirSync(target, { recursive: true });
  }
  return resolve(target);
}

function convertTapPath(input: string): string {
  const trimmed = input.trim().replace(/^["'`]+|["'`]+$/g, "");
  if (/^[A-Za-z]:\\/.test(trimmed)) {
    return trimmed;
  }

  const match = trimmed.match(/^\/([A-Za-z])\/(.*)$/);
  if (match) {
    return `${match[1].toUpperCase()}:\\${match[2].replace(/\//g, "\\")}`;
  }

  return trimmed;
}

function resolveRepoRoot(explicit?: string): string {
  if (explicit) {
    return resolve(explicit);
  }

  return process.cwd();
}

function resolveCommsDir(repoRoot: string, explicit?: string): string {
  if (explicit) {
    return resolve(convertTapPath(explicit));
  }

  const tapConfigPath = join(repoRoot, ".tap-config");
  if (!existsSync(tapConfigPath)) {
    throw new Error(
      "Unable to resolve comms directory. Pass --comms-dir explicitly.",
    );
  }

  const configText = readFileSync(tapConfigPath, "utf8");
  const match = configText.match(/^TAP_COMMS_DIR="?(.*?)"?$/m);
  if (!match?.[1]) {
    throw new Error(
      "Unable to resolve comms directory. Pass --comms-dir explicitly.",
    );
  }

  return resolve(convertTapPath(match[1]));
}

function resolvePreferredAgentName(requested?: string): string | null {
  if (requested?.trim()) {
    return requested.trim();
  }

  for (const envName of ["TAP_AGENT_NAME", "CODEX_TAP_AGENT_NAME"]) {
    const candidate = process.env[envName];
    if (candidate?.trim()) {
      return candidate.trim();
    }
  }

  return null;
}

function sanitizeStateSegment(agentName: string): string {
  const normalized = agentName
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "-")
    .replace(/[. ]+$/g, "");

  return normalized || "agent";
}

function buildDefaultStateDir(
  repoRoot: string,
  preferredAgentName?: string | null,
): string {
  const suffix = preferredAgentName?.trim()
    ? `-${sanitizeStateSegment(preferredAgentName)}`
    : "";
  return resolve(join(repoRoot, ".tmp", `codex-app-server-bridge${suffix}`));
}

function resolveStateDir(
  repoRoot: string,
  explicit?: string,
  preferredAgentName?: string | null,
): string {
  const root = explicit
    ? resolve(explicit)
    : buildDefaultStateDir(repoRoot, preferredAgentName);

  ensureDir(root);
  ensureDir(join(root, "processed"));
  ensureDir(join(root, "logs"));
  return root;
}

function resolveAgentName(
  requested: string | undefined,
  stateDir: string,
): string {
  if (requested?.trim()) {
    return requested.trim();
  }

  for (const envName of ["TAP_AGENT_NAME", "CODEX_TAP_AGENT_NAME"]) {
    const candidate = process.env[envName];
    if (candidate?.trim()) {
      return candidate.trim();
    }
  }

  const agentFile = join(stateDir, "agent-name.txt");
  if (existsSync(agentFile)) {
    const candidate = readFileSync(agentFile, "utf8").trim();
    if (candidate) {
      return candidate;
    }
  }

  return DEFAULT_AGENT;
}

function persistAgentName(stateDir: string, agentName: string): void {
  writeFileSync(join(stateDir, "agent-name.txt"), `${agentName}\n`, "utf8");
}

function readThreadState(stateDir: string): ThreadStateRecord | null {
  const threadPath = join(stateDir, "thread.json");
  if (!existsSync(threadPath)) {
    return null;
  }

  try {
    const parsed = JSON.parse(
      readFileSync(threadPath, "utf8"),
    ) as ThreadStateRecord;
    if (parsed.threadId) {
      return parsed;
    }
  } catch {
    return null;
  }

  return null;
}

function persistThreadState(
  stateDir: string,
  threadId: string,
  appServerUrl: string,
  ephemeral: boolean,
): void {
  const payload: ThreadStateRecord = {
    threadId,
    updatedAt: new Date().toISOString(),
    appServerUrl,
    ephemeral,
  };
  writeFileSync(
    join(stateDir, "thread.json"),
    `${JSON.stringify(payload, null, 2)}\n`,
    "utf8",
  );
}

function getGeneralInboxCutoff(
  stateDir: string,
  lookbackMinutes: number,
  processExistingMessages: boolean,
): Date {
  if (processExistingMessages) {
    return new Date(0);
  }

  if (lookbackMinutes > 0) {
    return new Date(Date.now() - lookbackMinutes * 60_000);
  }

  const cutoffPath = join(stateDir, "general-inbox-cutoff.txt");
  if (existsSync(cutoffPath)) {
    try {
      return new Date(readFileSync(cutoffPath, "utf8").trim());
    } catch {
      return new Date();
    }
  }

  const cutoff = new Date();
  writeFileSync(cutoffPath, `${cutoff.toISOString()}\n`, "utf8");
  return cutoff;
}

function recipientMatchesAgent(recipient: string, agentName: string): boolean {
  if (!recipient.trim()) {
    return !agentName.trim();
  }

  return recipient === "전체" || recipient === "all" || recipient === agentName;
}

function getInboxRoute(fileName: string): InboxRoute {
  const stem = fileName.replace(/\.md$/i, "");
  const parts = stem.split("-");
  let offset = 0;
  if (parts[0] && /^\d{8}$/.test(parts[0])) {
    offset = 1;
  }

  return {
    sender: parts[offset] ?? "",
    recipient: parts[offset + 1] ?? "",
    subject: parts.slice(offset + 2).join("-"),
  };
}

function buildMarkerId(filePath: string, mtimeMs: number): string {
  return createHash("sha1").update(`${filePath}|${mtimeMs}`).digest("hex");
}

function getProcessedMarkerPath(stateDir: string, markerId: string): string {
  return join(stateDir, "processed", `${markerId}.done`);
}

function collectCandidates(inboxDir: string, agentName: string): Candidate[] {
  const entries = readdirSync(inboxDir, { withFileTypes: true })
    .filter(
      (entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".md"),
    )
    .map((entry) => {
      const filePath = join(inboxDir, entry.name);
      const stats = statSync(filePath);
      return { entry, filePath, stats };
    })
    .sort((left, right) => left.stats.mtimeMs - right.stats.mtimeMs);

  const candidates: Candidate[] = [];
  for (const item of entries) {
    const route = getInboxRoute(item.entry.name);
    if (!recipientMatchesAgent(route.recipient, agentName)) {
      continue;
    }

    if (route.sender && route.sender === agentName) {
      continue;
    }

    const body = readFileSync(item.filePath, "utf8");
    candidates.push({
      markerId: buildMarkerId(item.filePath, item.stats.mtimeMs),
      filePath: item.filePath,
      fileName: item.entry.name,
      sender: route.sender,
      recipient: route.recipient,
      subject: route.subject,
      body,
      mtimeMs: item.stats.mtimeMs,
    });
  }

  return candidates;
}

function buildUserInput(candidate: Candidate, agentName: string): string {
  const sender = candidate.sender || "unknown";
  const recipient = candidate.recipient || agentName;
  const subject = candidate.subject || "(none)";
  const body = candidate.body.trim();

  return [
    `Tap-comms inbox message for ${agentName}.`,
    `Sender: ${sender}`,
    `Recipient: ${recipient}`,
    `Subject: ${subject}`,
    `File: ${candidate.fileName}`,
    "",
    "Message body:",
    body || "(empty)",
  ].join("\n");
}

function writeProcessedMarker(
  stateDir: string,
  candidate: Candidate,
  dispatchMode: "start" | "steer",
  threadId: string | null,
  turnId: string | null,
): void {
  const payload = {
    requestFile: candidate.filePath,
    requestName: candidate.fileName,
    sender: candidate.sender,
    recipient: candidate.recipient,
    subject: candidate.subject,
    dispatchMode,
    threadId,
    turnId,
    markedAt: new Date().toISOString(),
  };
  writeFileSync(
    getProcessedMarkerPath(stateDir, candidate.markerId),
    `${JSON.stringify(payload, null, 2)}\n`,
    "utf8",
  );
}

function writeLastDispatch(
  stateDir: string,
  candidate: Candidate,
  dispatchMode: "start" | "steer",
  threadId: string | null,
  turnId: string | null,
): void {
  const payload = {
    requestFile: candidate.filePath,
    requestName: candidate.fileName,
    markerId: candidate.markerId,
    sender: candidate.sender,
    recipient: candidate.recipient,
    subject: candidate.subject,
    dispatchMode,
    threadId,
    turnId,
    dispatchedAt: new Date().toISOString(),
  };
  writeFileSync(
    join(stateDir, "last-dispatch.json"),
    `${JSON.stringify(payload, null, 2)}\n`,
    "utf8",
  );
}

function formatJsonRpcError(error: JsonRpcResponse["error"]): string {
  if (!error) {
    return "Unknown App Server error";
  }

  return JSON.stringify(
    {
      code: error.code,
      message: error.message,
      data: error.data,
    },
    null,
    2,
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, ms);
  });
}

function shouldRetrySteerAsStart(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return (
    message.includes("no active turn") ||
    message.includes("expectedturnid") ||
    (message.includes("turn/steer failed") &&
      (message.includes("active turn") || message.includes("not found")))
  );
}

async function readSocketData(data: unknown): Promise<string> {
  if (typeof data === "string") {
    return data;
  }

  if (data instanceof ArrayBuffer) {
    return Buffer.from(data).toString("utf8");
  }

  if (ArrayBuffer.isView(data)) {
    return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString(
      "utf8",
    );
  }

  if (typeof Blob !== "undefined" && data instanceof Blob) {
    return await data.text();
  }

  return String(data);
}

class AppServerClient {
  private socket: WebSocket | null = null;
  private readonly url: string;
  private readonly logger: (message: string) => void;
  private nextId = 1;
  private pending = new Map<
    number,
    {
      resolve: (value: any) => void;
      reject: (reason?: unknown) => void;
      method: string;
    }
  >();

  connected = false;
  initialized = false;
  threadId: string | null = null;
  activeTurnId: string | null = null;
  lastTurnStatus: string | null = null;
  lastNotificationMethod: string | null = null;
  lastNotificationAt: string | null = null;
  lastError: string | null = null;
  lastSuccessfulAppServerAt: string | null = null;
  lastSuccessfulAppServerMethod: string | null = null;

  constructor(url: string, logger: (message: string) => void) {
    this.url = url;
    this.logger = logger;
  }

  async connect(): Promise<void> {
    if (this.connected && this.socket?.readyState === WebSocket.OPEN) {
      return;
    }

    this.socket = new WebSocket(this.url);

    await new Promise<void>((resolvePromise, rejectPromise) => {
      let settled = false;

      const resolveOnce = () => {
        if (settled) {
          return;
        }
        settled = true;
        resolvePromise();
      };

      const rejectOnce = (error: Error) => {
        if (settled) {
          return;
        }
        settled = true;
        rejectPromise(error);
      };

      this.socket?.addEventListener(
        "open",
        () => {
          this.connected = true;
          resolveOnce();
        },
        { once: true },
      );

      this.socket?.addEventListener("error", () => {
        const error = new Error(
          `Failed to connect to App Server at ${this.url}`,
        );
        this.lastError = error.message;
        rejectOnce(error);
      });

      this.socket?.addEventListener("close", () => {
        this.connected = false;
        this.initialized = false;
        this.activeTurnId = null;
        this.rejectPending(new Error("App Server connection closed"));
      });

      this.socket?.addEventListener("message", (event) => {
        void this.handleMessage(event.data);
      });
    });

    await this.request("initialize", {
      clientInfo: {
        name: "tap-app-server-bridge",
        title: "tap app-server bridge",
        version: "0.1.0",
      },
      capabilities: {
        experimentalApi: false,
      },
    });
    this.initialized = true;
  }

  async disconnect(): Promise<void> {
    if (!this.socket) {
      return;
    }

    this.socket.close();
    this.connected = false;
    this.initialized = false;
    this.socket = null;
  }

  async ensureThread(
    explicitThreadId: string | null,
    resumeThreadId: string | null,
    cwd: string,
    ephemeral: boolean,
  ): Promise<string> {
    if (explicitThreadId) {
      try {
        const resumeResponse = await this.request("thread/resume", {
          threadId: explicitThreadId,
          persistExtendedHistory: false,
        });
        const resumedThreadId = resumeResponse?.thread?.id ?? explicitThreadId;
        await this.refreshThreadState(resumedThreadId);
        this.logger(
          `resumed thread ${resumedThreadId}${
            this.activeTurnId ? ` (active turn ${this.activeTurnId})` : ""
          }`,
        );
        return resumedThreadId;
      } catch (error) {
        this.logger(
          `thread resume failed for ${explicitThreadId}; starting a fresh thread (${String(error)})`,
        );
      }
    }

    const loadedThreadId = await this.findLoadedThread(cwd);
    if (loadedThreadId) {
      return loadedThreadId;
    }

    if (resumeThreadId) {
      try {
        const resumeResponse = await this.request("thread/resume", {
          threadId: resumeThreadId,
          persistExtendedHistory: false,
        });
        const resumedThreadId = resumeResponse?.thread?.id ?? resumeThreadId;
        await this.refreshThreadState(resumedThreadId);
        this.logger(
          `resumed saved thread ${resumedThreadId}${
            this.activeTurnId ? ` (active turn ${this.activeTurnId})` : ""
          }`,
        );
        return resumedThreadId;
      } catch (error) {
        this.logger(
          `saved thread resume failed for ${resumeThreadId}; starting a fresh thread (${String(error)})`,
        );
      }
    }

    const startResponse = await this.request("thread/start", {
      cwd,
      ephemeral,
      experimentalRawEvents: false,
      persistExtendedHistory: false,
    });

    const startedThreadId = startResponse?.thread?.id;
    if (!startedThreadId) {
      throw new Error("thread/start did not return a thread id");
    }

    this.threadId = startedThreadId;
    this.activeTurnId = null;
    this.lastTurnStatus = null;
    this.logger(`started thread ${startedThreadId}`);
    return startedThreadId;
  }

  async findLoadedThread(cwd: string): Promise<string | null> {
    const response = await this.request("thread/loaded/list", {
      limit: 20,
    });
    const threadIds = Array.isArray(response?.data)
      ? response.data.filter(
          (value: unknown): value is string => typeof value === "string",
        )
      : [];

    if (threadIds.length === 0) {
      return null;
    }

    const threads: Array<{
      id: string;
      cwd: string;
      updatedAt: number;
      statusType: string | null;
      thread: any;
    }> = [];

    for (const threadId of threadIds) {
      try {
        const threadResponse = await this.request("thread/read", {
          threadId,
          includeTurns: true,
        });
        const thread = threadResponse?.thread;
        if (!thread?.id) {
          continue;
        }
        threads.push({
          id: thread.id,
          cwd: typeof thread.cwd === "string" ? thread.cwd : "",
          updatedAt:
            typeof thread.updatedAt === "number" ? thread.updatedAt : 0,
          statusType: thread.status?.type ?? null,
          thread,
        });
      } catch {
        continue;
      }
    }

    const matching = threads.filter((thread) => thread.cwd === cwd);
    const candidates = matching.length > 0 ? matching : threads;
    if (candidates.length === 0) {
      return null;
    }

    candidates.sort((left, right) => {
      const leftActive = left.statusType === "active" ? 1 : 0;
      const rightActive = right.statusType === "active" ? 1 : 0;
      if (leftActive !== rightActive) {
        return rightActive - leftActive;
      }
      return right.updatedAt - left.updatedAt;
    });

    const chosen = candidates[0];
    this.syncThreadStateFromThread(chosen.thread);
    this.logger(
      `attached to loaded thread ${chosen.id}${
        this.activeTurnId ? ` (active turn ${this.activeTurnId})` : ""
      }`,
    );
    return chosen.id;
  }

  async startTurn(inputText: string): Promise<string | null> {
    const threadId = this.requireThreadId();
    const response = await this.request("turn/start", {
      threadId,
      input: [
        {
          type: "text",
          text: inputText,
          text_elements: [],
        },
      ],
    });

    const turnId = response?.turn?.id ?? null;
    if (turnId) {
      this.activeTurnId = turnId;
    }
    return turnId;
  }

  async steerTurn(inputText: string): Promise<string> {
    const threadId = this.requireThreadId();
    const turnId = this.requireActiveTurnId();

    await this.request("turn/steer", {
      threadId,
      expectedTurnId: turnId,
      input: [
        {
          type: "text",
          text: inputText,
          text_elements: [],
        },
      ],
    });

    return turnId;
  }

  isBusy(): boolean {
    return Boolean(this.activeTurnId);
  }

  async refreshCurrentThreadState(): Promise<void> {
    if (!this.threadId) {
      return;
    }

    await this.refreshThreadState(this.threadId);
  }

  private requireThreadId(): string {
    if (!this.threadId) {
      throw new Error("No active App Server thread is available");
    }
    return this.threadId;
  }

  private requireActiveTurnId(): string {
    if (!this.activeTurnId) {
      throw new Error("No active turn is available for turn/steer");
    }
    return this.activeTurnId;
  }

  private async refreshThreadState(threadId: string): Promise<void> {
    const threadResponse = await this.request("thread/read", {
      threadId,
      includeTurns: true,
    });
    this.syncThreadStateFromThread(threadResponse?.thread);
  }

  private syncThreadStateFromThread(thread: any): void {
    if (typeof thread?.id === "string") {
      this.threadId = thread.id;
    }

    let activeTurnId: string | null = null;
    let lastTurnStatus: string | null = null;
    const turns = Array.isArray(thread?.turns) ? thread.turns : [];
    for (const turn of turns) {
      if (typeof turn?.status === "string") {
        lastTurnStatus = turn.status;
      }
      if (turn?.status === "inProgress" && typeof turn.id === "string") {
        activeTurnId = turn.id;
      }
    }

    this.activeTurnId = activeTurnId;
    this.lastTurnStatus = lastTurnStatus;
  }

  private async handleMessage(data: unknown): Promise<void> {
    const text = await readSocketData(data);
    const message = JSON.parse(text) as JsonRpcResponse;

    if (
      typeof message.id === "number" &&
      (Object.hasOwn(message, "result") || Object.hasOwn(message, "error"))
    ) {
      const pending = this.pending.get(message.id);
      if (!pending) {
        return;
      }

      this.pending.delete(message.id);
      if (message.error) {
        const errorText = formatJsonRpcError(message.error);
        this.lastError = errorText;
        pending.reject(new Error(`${pending.method} failed: ${errorText}`));
        return;
      }

      pending.resolve(message.result);
      this.lastSuccessfulAppServerAt = new Date().toISOString();
      this.lastSuccessfulAppServerMethod = pending.method;
      this.lastError = null;
      return;
    }

    if (!message.method) {
      return;
    }

    this.lastNotificationMethod = message.method;
    this.lastNotificationAt = new Date().toISOString();
    this.handleNotification(message.method, message.params);
  }

  private handleNotification(method: string, params: any): void {
    switch (method) {
      case "thread/started":
        if (params?.thread?.id) {
          this.threadId = params.thread.id;
        }
        this.logger(`thread started ${params?.thread?.id ?? ""}`.trim());
        break;
      case "thread/status/changed":
        this.logger(
          `thread status changed (${params?.thread?.status?.type ?? params?.status?.type ?? "unknown"})`,
        );
        break;
      case "turn/started":
        if (params?.turn?.id) {
          this.activeTurnId = params.turn.id;
          this.logger(`turn started ${params.turn.id}`);
        }
        break;
      case "turn/completed":
        this.lastTurnStatus = params?.turn?.status ?? null;
        this.activeTurnId = null;
        this.logger(`turn completed (${this.lastTurnStatus ?? "unknown"})`);
        break;
      case "error":
        this.lastError = JSON.stringify(params ?? {}, null, 2);
        this.logger(`app-server error notification: ${this.lastError}`);
        break;
      default:
        break;
    }
  }

  private request(method: string, params: unknown): Promise<any> {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error(`Cannot call ${method}; App Server socket is not open`);
    }

    const id = this.nextId;
    this.nextId += 1;

    const request: RequestRecord = {
      jsonrpc: "2.0",
      id,
      method,
      params,
    };

    return new Promise((resolvePromise, rejectPromise) => {
      this.pending.set(id, {
        resolve: resolvePromise,
        reject: rejectPromise,
        method,
      });
      this.socket?.send(JSON.stringify(request));
    });
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();
  }
}

function writeHeartbeat(
  options: Options,
  client: AppServerClient | null,
  health: BridgeHealthState,
): void {
  const payload: HeartbeatRecord = {
    pid: process.pid,
    agent: options.agentName,
    updatedAt: new Date().toISOString(),
    pollSeconds: options.pollSeconds,
    appServerUrl: options.appServerUrl,
    connected: client?.connected ?? false,
    initialized: client?.initialized ?? false,
    threadId: client?.threadId ?? null,
    activeTurnId: client?.activeTurnId ?? null,
    lastTurnStatus: client?.lastTurnStatus ?? null,
    lastNotificationMethod: client?.lastNotificationMethod ?? null,
    lastNotificationAt: client?.lastNotificationAt ?? null,
    lastError: client?.lastError ?? null,
    lastSuccessfulAppServerAt: client?.lastSuccessfulAppServerAt ?? null,
    lastSuccessfulAppServerMethod:
      client?.lastSuccessfulAppServerMethod ?? null,
    consecutiveFailureCount: health.consecutiveFailureCount,
    busyMode: options.busyMode,
    dispatchTimedOut: health.dispatchTimedOut,
    lastDispatchAt: health.lastDispatchAt,
  };

  writeFileSync(
    join(options.stateDir, "heartbeat.json"),
    `${JSON.stringify(payload, null, 2)}\n`,
    "utf8",
  );
}

async function dispatchCandidate(
  client: AppServerClient,
  options: Options,
  candidate: Candidate,
): Promise<boolean> {
  const input = buildUserInput(candidate, options.agentName);

  if (client.isBusy()) {
    if (options.busyMode !== "steer") {
      return false;
    }

    try {
      const turnId = await client.steerTurn(input);
      writeProcessedMarker(
        options.stateDir,
        candidate,
        "steer",
        client.threadId,
        turnId,
      );
      writeLastDispatch(
        options.stateDir,
        candidate,
        "steer",
        client.threadId,
        turnId,
      );
      logStatus(`steered active turn with ${candidate.fileName}`);
      return true;
    } catch (error) {
      await client.refreshCurrentThreadState().catch(() => undefined);

      if (!client.isBusy()) {
        return dispatchCandidate(client, options, candidate);
      }

      if (shouldRetrySteerAsStart(error)) {
        client.activeTurnId = null;
        logStatus(
          `steer fallback -> start for ${candidate.fileName} (${String(error)})`,
        );
        return dispatchCandidate(client, options, candidate);
      }

      throw error;
    }
  }

  const turnId = await client.startTurn(input);
  writeProcessedMarker(
    options.stateDir,
    candidate,
    "start",
    client.threadId,
    turnId,
  );
  writeLastDispatch(
    options.stateDir,
    candidate,
    "start",
    client.threadId,
    turnId,
  );
  logStatus(`dispatched ${candidate.fileName} to thread ${client.threadId}`);
  return true;
}

async function runScan(
  options: Options,
  cutoff: Date,
  client: AppServerClient | null,
): Promise<boolean> {
  const inboxDir = join(options.commsDir, "inbox");
  if (!existsSync(inboxDir)) {
    throw new Error(`Inbox directory not found: ${inboxDir}`);
  }

  const candidates = collectCandidates(inboxDir, options.agentName);
  for (const candidate of candidates) {
    if (candidate.mtimeMs < cutoff.getTime()) {
      continue;
    }

    const processedMarker = getProcessedMarkerPath(
      options.stateDir,
      candidate.markerId,
    );
    if (existsSync(processedMarker)) {
      continue;
    }

    if (options.dryRun) {
      logStatus(`dry-run candidate ${candidate.fileName}`);
      continue;
    }

    if (!client) {
      throw new Error("App Server client is not available");
    }

    const dispatched = await dispatchCandidate(client, options, candidate);
    if (!dispatched && options.busyMode === "wait") {
      return false;
    }
    return true;
  }

  return false;
}

async function waitForTurnDrain(
  options: Options,
  client: AppServerClient,
  health: BridgeHealthState,
): Promise<void> {
  const deadline = Date.now() + options.waitAfterDispatchSeconds * 1_000;
  while (Date.now() < deadline) {
    writeHeartbeat(options, client, health);
    if (!client.activeTurnId) {
      return;
    }
    await delay(1_000);
  }
}

function buildOptions(argv: string[]): Options {
  const parsed = parseArgs(argv);
  const repoRoot = resolveRepoRoot(parsed.repoRoot);
  const commsDir = resolveCommsDir(repoRoot, parsed.commsDir);
  const preferredAgentName = resolvePreferredAgentName(parsed.agentName);
  const stateDir = resolveStateDir(
    repoRoot,
    parsed.stateDir,
    preferredAgentName,
  );
  const agentName = resolveAgentName(parsed.agentName, stateDir);
  persistAgentName(stateDir, agentName);

  return {
    repoRoot,
    commsDir,
    stateDir,
    agentName,
    pollSeconds: parsed.pollSeconds ?? 5,
    reconnectSeconds: parsed.reconnectSeconds ?? 5,
    messageLookbackMinutes: parsed.messageLookbackMinutes ?? 10,
    processExistingMessages: parsed.processExistingMessages,
    dryRun: parsed.dryRun,
    runOnce: parsed.runOnce,
    waitAfterDispatchSeconds: parsed.waitAfterDispatchSeconds ?? 0,
    appServerUrl:
      parsed.appServerUrl?.trim() ||
      process.env.CODEX_APP_SERVER_URL ||
      DEFAULT_APP_SERVER_URL,
    busyMode: parsed.busyMode ?? "steer",
    threadId: parsed.threadId?.trim() || null,
    ephemeral: parsed.ephemeral,
    dispatchTimeoutMinutes: parsed.dispatchTimeoutMinutes ?? 3,
  };
}

async function main(): Promise<void> {
  const options = buildOptions(process.argv.slice(2));
  const cutoff = getGeneralInboxCutoff(
    options.stateDir,
    options.messageLookbackMinutes,
    options.processExistingMessages,
  );
  const savedThread = readThreadState(options.stateDir);

  logStatus("codex app-server bridge ready");
  console.log(`  repo:       ${options.repoRoot}`);
  console.log(`  comms:      ${options.commsDir}`);
  console.log(`  agent:      ${options.agentName}`);
  console.log(`  state:      ${options.stateDir}`);
  console.log(`  app-server: ${options.appServerUrl}`);
  console.log(`  busy-mode:  ${options.busyMode}`);
  if (options.waitAfterDispatchSeconds > 0) {
    console.log(
      `  wait:       ${options.waitAfterDispatchSeconds}s after dispatch`,
    );
  }
  console.log(
    `  lookback:   ${
      options.processExistingMessages
        ? "existing messages"
        : `${options.messageLookbackMinutes} minute(s)`
    }`,
  );
  if (options.threadId || savedThread?.threadId) {
    console.log(`  thread:     ${options.threadId ?? savedThread?.threadId}`);
  }
  if (options.dryRun) {
    logStatus("dry-run mode enabled");
  }

  let client: AppServerClient | null = null;
  let savedThreadId = savedThread?.threadId ?? null;
  const health: BridgeHealthState = {
    consecutiveFailureCount: 0,
    dispatchTimedOut: false,
    lastDispatchAt: null,
  };

  while (true) {
    try {
      if (!options.dryRun) {
        if (!client || !client.connected) {
          logStatus("ws: connecting...");
          // Notify recovery if we were previously failing
          const wasDown = health.consecutiveFailureCount > 0;
          client = new AppServerClient(options.appServerUrl, logStatus);
          await client.connect();
          logStatus("ws: connected");

          const threadId = await client.ensureThread(
            options.threadId,
            savedThreadId,
            options.repoRoot,
            options.ephemeral,
          );
          persistThreadState(
            options.stateDir,
            threadId,
            options.appServerUrl,
            options.ephemeral,
          );
          savedThreadId = threadId;

          if (wasDown) {
            writeCommsBroadcast(
              options,
              `${options.agentName} 세션 복귀 — 연결 복원됨`,
              "session-recovered",
            );
          }
        }
      }

      const dispatched = await runScan(options, cutoff, client);
      if (dispatched) {
        health.lastDispatchAt = new Date().toISOString();
        health.dispatchTimedOut = false;

        if (client && options.waitAfterDispatchSeconds > 0) {
          const timeoutMs = options.dispatchTimeoutMinutes * 60_000;
          const drainResult = await Promise.race([
            waitForTurnDrain(options, client, health).then(
              () => "drained" as const,
            ),
            delay(timeoutMs).then(() => "timeout" as const),
          ]);

          if (drainResult === "timeout") {
            health.dispatchTimedOut = true;
            logStatus(
              `dispatch timeout: ${options.dispatchTimeoutMinutes}min with no turn completion`,
            );
            writeCommsBroadcast(
              options,
              `${options.agentName} 세션 응답 없음 — ${options.dispatchTimeoutMinutes}분 경과`,
              "session-timeout",
            );
            health.consecutiveFailureCount += 1;
          }
        }
      }
      if (!health.dispatchTimedOut) {
        health.consecutiveFailureCount = 0;
      }
      writeHeartbeat(options, client, health);

      if (options.runOnce) {
        break;
      }

      await delay(options.pollSeconds * 1_000);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logStatus(`bridge error: ${errorMsg}`);
      health.consecutiveFailureCount += 1;
      health.dispatchTimedOut = false;
      writeHeartbeat(options, client, health);

      // Notify on first failure only (avoid inbox spam)
      if (health.consecutiveFailureCount === 1) {
        writeCommsBroadcast(
          options,
          `${options.agentName} 세션 응답 없음 — 연결 실패 (${errorMsg})`,
          "session-down",
        );
      }

      if (options.runOnce) {
        throw error;
      }

      logStatus("ws: disconnecting after error");
      client?.disconnect().catch(() => undefined);
      client = null;
      logStatus(`ws: reconnecting in ${options.reconnectSeconds}s`);
      await delay(options.reconnectSeconds * 1_000);
    }
  }

  await client?.disconnect();
}

main().catch((error) => {
  console.error(
    error instanceof Error ? (error.stack ?? error.message) : String(error),
  );
  process.exitCode = 1;
});
