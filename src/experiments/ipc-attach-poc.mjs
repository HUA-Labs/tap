#!/usr/bin/env node
// EXPERIMENTAL - depends on OAI Codex Desktop IPC; embargo until OAI patch

import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import process, { stdin as input, stdout as output } from 'node:process';
import { createInterface } from 'node:readline/promises';

const MAX_FRAME_BYTES = 256 * 1024 * 1024;
const MAX_BUFFER_BYTES = 512 * 1024 * 1024;
const DEFAULT_DISCOVERY_MS = 15_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 20_000;
const DEFAULT_CONSENT_TTL_MS = 10 * 60 * 1000;
const DEFAULT_CLIENT_TYPE = 'tap-ipc-attach-poc';
const CONSENT_DIRNAME = 'tap-codex-a2a-consent';

const METHOD_VERSIONS = Object.freeze({
  'thread-stream-state-changed': 6,
  'thread-read-state-changed': 1,
  'thread-archived': 2,
  'thread-unarchived': 1,
  'thread-follower-start-turn': 1,
  'thread-follower-compact-thread': 1,
  'thread-follower-steer-turn': 1,
  'thread-follower-interrupt-turn': 1,
  'thread-follower-set-model-and-reasoning': 1,
  'thread-follower-set-collaboration-mode': 1,
  'thread-follower-edit-last-user-turn': 1,
  'thread-follower-command-approval-decision': 1,
  'thread-follower-file-approval-decision': 1,
  'thread-follower-permissions-request-approval-response': 1,
  'thread-follower-submit-user-input': 1,
  'thread-follower-submit-mcp-server-elicitation-response': 1,
  'thread-follower-set-queued-follow-ups-state': 1,
  'thread-queued-followups-changed': 1,
});

function printHelp() {
  const socketPath = getSocketPath();
  console.log(`Codex Desktop IPC attach proof-of-concept

Usage:
  node packages/tap-comms/src/experiments/ipc-attach-poc.mjs [options]

Default mode:
  Metadata-only attach/discovery. Logs conversation and client metadata only.

Target approval mode:
  Creates a one-shot local consent receipt for a specific conversation.
  node ... --approve-target --conversation-id ID --pair-token TOKEN

Inject mode:
  Requires a matching target approval receipt plus explicit local confirmation.
  node ... --conversation-id ID --pair-token TOKEN --inject-text TEXT

Options:
  --help                         Show this help.
  --socket-path PATH             Override the local IPC socket/pipe path.
  --client-type TYPE             initialize.clientType value. Default: ${DEFAULT_CLIENT_TYPE}
  --watch-seconds N              Discovery watch window in seconds. Default: ${DEFAULT_DISCOVERY_MS / 1000}
  --request-timeout-seconds N    Request timeout in seconds. Default: ${DEFAULT_REQUEST_TIMEOUT_MS / 1000}
  --consent-ttl-seconds N        Approval receipt lifetime in seconds. Default: ${DEFAULT_CONSENT_TTL_MS / 1000}
  --approve-target               Create a one-shot approval receipt for --conversation-id.
  --conversation-id ID           Target conversation for follower start-turn.
  --target-client-id ID          Owner client id. Skips owner auto-discovery.
  --pair-token TOKEN             Shared one-shot token. Required for approval/inject modes.
  --inject-text TEXT             Send a follower start-turn after explicit confirmation.

Safety notes:
  - Always prompts before opening the local IPC connection.
  - Logs metadata only. No conversation content is printed.
  - Target-side approval writes a local one-shot consent receipt bound to --conversation-id.
  - Follower injection requires --conversation-id, --pair-token, a valid consent receipt, and a second exact confirmation.

Current default socket/pipe:
  ${socketPath}
`);
}

function getSocketPath() {
  if (process.platform === 'win32') {
    return path.join('\\\\.\\pipe', 'codex-ipc');
  }

  const dir = path.join(os.tmpdir(), 'codex-ipc');
  const uid = process.getuid?.();
  return path.join(dir, uid ? `ipc-${uid}.sock` : 'ipc.sock');
}

function getMethodVersion(method) {
  return METHOD_VERSIONS[method] ?? 0;
}

function getConsentDirectory() {
  return path.join(os.tmpdir(), CONSENT_DIRNAME);
}

function getConsentPath(conversationId) {
  const digest = createHash('sha256').update(conversationId, 'utf8').digest('hex');
  return path.join(getConsentDirectory(), `${digest}.json`);
}

function hashToken(token) {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

function encodeFrame(message) {
  const json = JSON.stringify(message);
  const size = Buffer.byteLength(json, 'utf8');
  if (size > MAX_FRAME_BYTES) {
    throw new Error(`frame-too-large:${size}`);
  }

  const frame = Buffer.allocUnsafe(4 + size);
  frame.writeUInt32LE(size, 0);
  frame.write(json, 4, size, 'utf8');
  return frame;
}

function createFrameReader(onMessage, onError) {
  let buffer = Buffer.alloc(0);
  let expected = null;

  return (chunk) => {
    if (chunk.length === 0) {
      return;
    }

    if (buffer.length + chunk.length > MAX_BUFFER_BYTES) {
      onError(new Error(`buffer-too-large:${buffer.length + chunk.length}`));
      return;
    }

    buffer = Buffer.concat([buffer, chunk]);
    while (true) {
      if (expected === null) {
        if (buffer.length < 4) {
          return;
        }

        expected = buffer.readUInt32LE(0);
        buffer = buffer.subarray(4);
        if (expected > MAX_FRAME_BYTES) {
          onError(new Error(`frame-too-large:${expected}`));
          return;
        }
      }

      if (buffer.length < expected) {
        return;
      }

      const payload = buffer.subarray(0, expected);
      buffer = buffer.subarray(expected);
      expected = null;

      let message;
      try {
        message = JSON.parse(payload.toString('utf8'));
      } catch (error) {
        onError(error);
        return;
      }

      try {
        onMessage(message);
      } catch (error) {
        onError(error);
        return;
      }
    }
  };
}

class IpcClient {
  constructor({ socketPath, clientType, requestTimeoutMs }) {
    this.socketPath = socketPath;
    this.clientType = clientType;
    this.requestTimeoutMs = requestTimeoutMs;
    this.socket = null;
    this.clientId = null;
    this.pendingResponses = new Map();
    this.broadcastHandlers = new Set();
    this.closed = false;
  }

  async connect() {
    if (this.socket) {
      return;
    }

    await new Promise((resolve, reject) => {
      const socket = net.createConnection(this.socketPath);
      let settled = false;

      const finish = (callback, value) => {
        if (settled) {
          return;
        }
        settled = true;
        callback(value);
      };

      const reader = createFrameReader(
        (message) => this.handleMessage(message),
        (error) => {
          finish(reject, error);
          socket.destroy(error);
        },
      );

      socket.on('connect', () => {
        this.socket = socket;
        finish(resolve);
      });
      socket.on('data', reader);
      socket.on('error', (error) => {
        finish(reject, error);
        this.failPending(error);
      });
      socket.on('close', () => {
        this.closed = true;
        this.failPending(new Error('socket-closed'));
      });
    });
  }

  addBroadcastHandler(handler) {
    this.broadcastHandlers.add(handler);
    return () => {
      this.broadcastHandlers.delete(handler);
    };
  }

  async initialize() {
    const response = await this.sendRequest('initialize', {
      clientType: this.clientType,
    });

    this.clientId = response.result?.clientId ?? null;
    if (!this.clientId) {
      throw new Error('initialize-missing-client-id');
    }

    return response;
  }

  async sendRequest(method, params, { targetClientId } = {}) {
    if (!this.socket || this.closed) {
      throw new Error('not-connected');
    }

    if (!this.clientId && method !== 'initialize') {
      throw new Error('not-initialized');
    }

    const requestId = randomUUID();
    const message = {
      type: 'request',
      requestId,
      sourceClientId: this.clientId ?? 'uninitialized',
      version: getMethodVersion(method),
      method,
      params,
      targetClientId,
    };

    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingResponses.delete(requestId);
        reject(new Error(`request-timeout:${method}`));
      }, this.requestTimeoutMs);

      this.pendingResponses.set(requestId, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });

      this.write(message);
    });
  }

  close() {
    this.closed = true;
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
  }

  handleMessage(message) {
    switch (message?.type) {
      case 'broadcast':
        for (const handler of this.broadcastHandlers) {
          handler(message);
        }
        break;
      case 'response':
        this.resolvePending(message);
        break;
      case 'client-discovery-request':
        this.handleClientDiscoveryRequest(message);
        break;
      case 'request':
        this.handleUnexpectedRequest(message);
        break;
      default:
        break;
    }
  }

  handleClientDiscoveryRequest(message) {
    const request = message.request ?? {};
    const expectedVersion = getMethodVersion(request.method);
    const versionMatches = (request.version ?? 0) === expectedVersion;

    this.write({
      type: 'client-discovery-response',
      requestId: message.requestId,
      response: {
        canHandle: false && versionMatches,
      },
    });
  }

  handleUnexpectedRequest(message) {
    this.write({
      type: 'response',
      requestId: message.requestId,
      resultType: 'error',
      error: 'no-handler-for-request',
    });
  }

  resolvePending(message) {
    const pending = this.pendingResponses.get(message.requestId);
    if (!pending) {
      return;
    }

    this.pendingResponses.delete(message.requestId);
    if (message.resultType === 'success') {
      pending.resolve(message);
      return;
    }

    pending.reject(new Error(message.error ?? 'request-failed'));
  }

  failPending(error) {
    for (const [requestId, pending] of this.pendingResponses) {
      this.pendingResponses.delete(requestId);
      pending.reject(error);
    }
  }

  write(message) {
    if (!this.socket || this.closed) {
      throw new Error('not-connected');
    }

    this.socket.write(encodeFrame(message));
  }
}

function parseArgs(argv) {
  const options = {
    socketPath: getSocketPath(),
    clientType: DEFAULT_CLIENT_TYPE,
    watchMs: DEFAULT_DISCOVERY_MS,
    requestTimeoutMs: DEFAULT_REQUEST_TIMEOUT_MS,
    consentTtlMs: DEFAULT_CONSENT_TTL_MS,
    approveTarget: false,
    conversationId: null,
    targetClientId: null,
    pairToken: null,
    injectText: null,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    switch (current) {
      case '--help':
        options.help = true;
        break;
      case '--socket-path':
        options.socketPath = requireValue(argv, ++index, current);
        break;
      case '--client-type':
        options.clientType = requireValue(argv, ++index, current);
        break;
      case '--watch-seconds':
        options.watchMs = parseNumber(requireValue(argv, ++index, current), current) * 1000;
        break;
      case '--request-timeout-seconds':
        options.requestTimeoutMs = parseNumber(requireValue(argv, ++index, current), current) * 1000;
        break;
      case '--consent-ttl-seconds':
        options.consentTtlMs = parseNumber(requireValue(argv, ++index, current), current) * 1000;
        break;
      case '--approve-target':
        options.approveTarget = true;
        break;
      case '--conversation-id':
        options.conversationId = requireValue(argv, ++index, current);
        break;
      case '--target-client-id':
        options.targetClientId = requireValue(argv, ++index, current);
        break;
      case '--pair-token':
        options.pairToken = requireValue(argv, ++index, current);
        break;
      case '--inject-text':
        options.injectText = requireValue(argv, ++index, current);
        break;
      default:
        throw new Error(`unknown-argument:${current}`);
    }
  }

  if (options.approveTarget && options.injectText) {
    throw new Error('--approve-target cannot be combined with --inject-text');
  }

  if (options.injectText && !options.conversationId) {
    throw new Error('--inject-text requires --conversation-id');
  }

  if (options.approveTarget && !options.conversationId) {
    throw new Error('--approve-target requires --conversation-id');
  }

  if ((options.approveTarget || options.injectText) && !options.pairToken) {
    throw new Error('--pair-token is required for approval/inject modes');
  }

  if (options.pairToken && options.pairToken.length < 8) {
    throw new Error('--pair-token must be at least 8 characters');
  }

  return options;
}

function requireValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith('--')) {
    throw new Error(`missing-value:${flag}`);
  }
  return value;
}

function parseNumber(value, flag) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`invalid-number:${flag}`);
  }
  return parsed;
}

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function nowStamp() {
  return new Date().toISOString();
}

async function promptExact(question, expected) {
  const rl = createInterface({ input, output });
  try {
    const answer = (await rl.question(question)).trim();
    return answer === expected;
  } finally {
    rl.close();
  }
}

async function ensureConsentDirectory() {
  await mkdir(getConsentDirectory(), { recursive: true });
}

async function cleanupExpiredConsentReceipts() {
  await ensureConsentDirectory();

  const entries = await readdir(getConsentDirectory(), { withFileTypes: true });
  const now = Date.now();

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) {
      continue;
    }

    const filePath = path.join(getConsentDirectory(), entry.name);
    let parsed;
    try {
      parsed = JSON.parse(await readFile(filePath, 'utf8'));
    } catch {
      continue;
    }

    if ((parsed?.expiresAtMs ?? 0) < now) {
      await rm(filePath, { force: true });
    }
  }
}

async function writeConsentReceipt({
  conversationId,
  pairToken,
  ownerClientId,
  hostId,
  approvedByClientId,
  ttlMs,
}) {
  await cleanupExpiredConsentReceipts();

  const now = Date.now();
  const receipt = {
    version: 1,
    conversationId,
    ownerClientId: ownerClientId ?? null,
    hostId: hostId ?? null,
    approvedByClientId: approvedByClientId ?? null,
    createdAtMs: now,
    expiresAtMs: now + ttlMs,
    pairTokenSha256: hashToken(pairToken),
  };

  const receiptPath = getConsentPath(conversationId);
  await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
  return { receipt, receiptPath };
}

async function readConsentReceipt({ conversationId, pairToken }) {
  await cleanupExpiredConsentReceipts();

  const receiptPath = getConsentPath(conversationId);
  let receipt;
  try {
    receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new Error(`consent-receipt-missing:${conversationId}`);
    }
    throw new Error(`consent-receipt-invalid:${conversationId}`);
  }
  const now = Date.now();

  if ((receipt?.expiresAtMs ?? 0) < now) {
    await rm(receiptPath, { force: true });
    throw new Error(`consent-receipt-expired:${conversationId}`);
  }

  if (receipt?.pairTokenSha256 !== hashToken(pairToken)) {
    throw new Error(`consent-token-mismatch:${conversationId}`);
  }

  return { receipt, receiptPath };
}

function recordConversation(discovered, message) {
  if (message.method !== 'thread-stream-state-changed') {
    return null;
  }

  const conversationId = message.params?.conversationId ?? null;
  const hostId = message.params?.hostId ?? null;
  const changeType = message.params?.change?.type ?? null;
  const ownerClientId = message.sourceClientId ?? null;

  if (!conversationId || !changeType) {
    return null;
  }

  const previous = discovered.get(conversationId) ?? {};
  const next = {
    conversationId,
    hostId,
    ownerClientId,
    lastChangeType: changeType,
    lastSeenAt: nowStamp(),
  };
  discovered.set(conversationId, { ...previous, ...next });
  return next;
}

function summarizeDiscovered(discovered) {
  if (discovered.size === 0) {
    console.log('No thread-stream-state-changed metadata observed in the watch window.');
    return;
  }

  console.log('\nDiscovered conversation metadata:');
  for (const entry of discovered.values()) {
    console.log(
      [
        `- conversationId=${entry.conversationId}`,
        `hostId=${entry.hostId ?? 'unknown'}`,
        `ownerClientId=${entry.ownerClientId ?? 'unknown'}`,
        `lastChange=${entry.lastChangeType ?? 'unknown'}`,
        `lastSeenAt=${entry.lastSeenAt ?? 'unknown'}`,
      ].join(' '),
    );
  }
}

function printBroadcastMetadata(message, discovered) {
  if (message.method === 'client-status-changed') {
    console.log(
      [
        `[${nowStamp()}]`,
        'client-status-changed',
        `clientId=${message.params?.clientId ?? 'unknown'}`,
        `clientType=${message.params?.clientType ?? 'unknown'}`,
        `status=${message.params?.status ?? 'unknown'}`,
      ].join(' '),
    );
    return;
  }

  const entry = recordConversation(discovered, message);
  if (!entry) {
    return;
  }

  console.log(
    [
      `[${entry.lastSeenAt}]`,
      'thread-stream-state-changed',
      `conversationId=${entry.conversationId}`,
      `hostId=${entry.hostId ?? 'unknown'}`,
      `change=${entry.lastChangeType ?? 'unknown'}`,
      `ownerClientId=${entry.ownerClientId ?? 'unknown'}`,
    ].join(' '),
  );
}

async function resolveTargetClientId({ options, discovered }) {
  if (options.targetClientId) {
    return options.targetClientId;
  }

  const deadline = Date.now() + options.watchMs;
  while (Date.now() < deadline) {
    const entry = discovered.get(options.conversationId);
    if (entry?.ownerClientId) {
      return entry.ownerClientId;
    }
    await wait(250);
  }

  throw new Error(`owner-not-discovered:${options.conversationId}`);
}

function getConversationMetadata(discovered, conversationId) {
  return discovered.get(conversationId) ?? null;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const attachMode = options.approveTarget
    ? 'target-consent'
    : options.injectText
      ? 'attach-and-inject'
      : 'metadata-only attach';
  const attachOk = await promptExact(
    `Experimental local Codex IPC ${attachMode}.\nType ATTACH to continue: `,
    'ATTACH',
  );
  if (!attachOk) {
    throw new Error('attach-confirmation-mismatch');
  }

  const client = new IpcClient({
    socketPath: options.socketPath,
    clientType: options.clientType,
    requestTimeoutMs: options.requestTimeoutMs,
  });
  const discovered = new Map();

  const close = () => {
    client.close();
  };

  process.on('SIGINT', () => {
    close();
    process.exitCode = 130;
  });
  process.on('SIGTERM', () => {
    close();
    process.exitCode = 143;
  });

  client.addBroadcastHandler((message) => {
    printBroadcastMetadata(message, discovered);
  });

  await client.connect();
  const initResponse = await client.initialize();
  const assignedClientId = initResponse.result?.clientId ?? client.clientId ?? 'unknown';
  console.log(
    `Connected to ${options.socketPath} as clientId=${assignedClientId} clientType=${options.clientType}`,
  );

  if (options.approveTarget) {
    const approvedOwnerClientId = await resolveTargetClientId({ options, discovered });
    const entry = getConversationMetadata(discovered, options.conversationId);
    const { receipt, receiptPath } = await writeConsentReceipt({
      conversationId: options.conversationId,
      pairToken: options.pairToken,
      ownerClientId: approvedOwnerClientId,
      hostId: entry?.hostId ?? null,
      approvedByClientId: assignedClientId,
      ttlMs: options.consentTtlMs,
    });

    console.log(
      [
        'Target approval receipt created.',
        `conversationId=${receipt.conversationId}`,
        `ownerClientId=${receipt.ownerClientId ?? 'unknown'}`,
        `expiresAt=${new Date(receipt.expiresAtMs).toISOString()}`,
        `receipt=${receiptPath}`,
      ].join(' '),
    );

    close();
    return;
  }

  if (!options.injectText) {
    console.log(`Watching metadata for ${options.watchMs / 1000}s...`);
    await wait(options.watchMs);
    summarizeDiscovered(discovered);
    close();
    return;
  }

  const { receipt, receiptPath } = await readConsentReceipt({
    conversationId: options.conversationId,
    pairToken: options.pairToken,
  });

  const discoveredTargetClientId =
    options.targetClientId ??
    receipt.ownerClientId ??
    (await resolveTargetClientId({ options, discovered }));
  console.log(
    `Resolved owner client metadata for conversationId=${options.conversationId} targetClientId=${discoveredTargetClientId} viaConsentReceipt=true`,
  );

  const injectOk = await promptExact(
    `Type INJECT ${options.conversationId} to send one follower start-turn without printing content: `,
    `INJECT ${options.conversationId}`,
  );
  if (!injectOk) {
    throw new Error('inject-confirmation-mismatch');
  }

  const response = await client.sendRequest(
    'thread-follower-start-turn',
    {
      conversationId: options.conversationId,
      turnStartParams: {
        input: [
          {
            type: 'text',
            text: options.injectText,
            text_elements: [],
          },
        ],
        attachments: [],
      },
    },
    { targetClientId: discoveredTargetClientId },
  );

  const turnId =
    response.result?.result?.turn?.id ??
    response.result?.turn?.id ??
    null;

  console.log(
    [
      'Follower start-turn request succeeded.',
      `handledByClientId=${response.handledByClientId ?? 'unknown'}`,
      `turnId=${turnId ?? 'unknown'}`,
      'consentReceiptConsumed=true',
    ].join(' '),
  );

  await rm(receiptPath, { force: true });
  close();
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Error: ${message}`);
  process.exitCode = 1;
});
