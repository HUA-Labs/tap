#!/usr/bin/env node
/**
 * tap-comms: file-based real-time channel for tap multi-session orchestration.
 * Claude can receive fs.watch-driven channel notifications.
 * Other MCP clients can poll unread items via tap_list_unread.
 *
 * This is the thin orchestrator — tool definitions + handler routing.
 * Logic lives in tap-utils, tap-io, tap-db, tap-watcher.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolRequest,
} from "@modelcontextprotocol/sdk/types.js";
import { randomUUID } from "crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { basename, join } from "path";
import {
  isBroadcastRecipient,
  isPlaceholderAgentValue,
  normalizeRecipientList,
  sameRoutingAddress,
} from "./tap-identity.js";
import {
  buildHeartbeatRecord,
  parseCapabilityRegistrationArgs,
} from "./tap-capability-snapshot.js";
import { handleRegisterCapabilities } from "./handlers/capabilities.ts";
import {
  checkPeerDmRateLimit,
  recordPeerDm,
  type PeerDmHistoryStore,
  type PeerDmRoute,
} from "./tap-peer-dm-rate-limit.js";

import {
  INBOX_DIR,
  ARCHIVE_DIR,
  RECEIPTS_LOCK,
  HEARTBEATS_LOCK,
  buildHeartbeatConnectHash,
  buildAgentIdentityProbeSnapshot,
  debug,
  getAgentId,
  getAgentName,
  getAgentIdentitySnapshot,
  getAgentRoutingAddress,
  claimAgentName,
  getRecentSenders,
  getRecentReplyableRecipients,
  getLatestReviewDir,
  getLastActivityTime,
  logInfo,
  logWarn,
  resetIdentity,
  getRoutingRuntimeConflicts,
  getRoutingRuntimeKey,
  loadStateInstances,
  normalizeRoutingSlot,
  TAP_ROUTING_SLOTS,
  updateActivityTime,
  parseFilename,
  stripBom,
  isInGraceWindow,
  sealGraceWindow,
  setObservedMcpClientName,
  type TapAddressMetadata,
} from "./tap-utils.js";
import {
  claimName,
  renewClaimTTL,
  releaseClaim,
  resolveClaimInstanceId,
  getClaimedNames,
} from "./tap-claims.js";
import {
  getUnreadItems,
  acquireLock,
  releaseLock,
  ensureReceiptsDir,
  getDurableReceiptKeys,
  loadReceipts,
  saveReceipts,
  loadHeartbeats,
  saveHeartbeats,
  writePresenceFile,
  deletePresenceFile,
} from "./tap-io.js";
import {
  initDb,
  autoSyncOnStartup,
  dbInsertMessage,
  dbUpsertHeartbeat,
  dbInsertReceipt,
  dbGetStats,
  dbSyncAll,
} from "./tap-db.js";
import { watchDir } from "./tap-watcher.js";
import {
  buildWhoAgents,
  POLLING_RECIPIENT_VISIBILITY_MINUTES,
  resolvePreferredRecipient,
  resolveStructuredRecipient,
  validateStructuredEnvelopeMetadata,
  type TapEnvelopeScope,
  type TapStructuredRecipientTarget,
} from "./tap-presence.js";
import { createTapConsentReceiptFromIdentity } from "./tap-consent.js";
import { routeTapReplyDelivery } from "./tap-drive-routing.js";
import { writeRouteLeaseFile } from "./tap-route-lease.js";
import { writeSlotCollisionAudit } from "../../../src/transport/slot-collision-audit.js";
import { writeInstanceOwnershipChangeAudit } from "../../../src/transport/instance-ownership-audit.js";
import { pruneInstanceOwnershipChange } from "./tap-instance-ownership.js";
import { readdirSync, renameSync, statSync } from "fs";

// ── Initialize ──────────────────────────────────────────────────────────

initDb();
autoSyncOnStartup();

// ── Onboarding ─────────────────────────────────────────────────────────

const ONBOARDING_TEASER_LINES = 10;
const peerDmHistory: PeerDmHistoryStore = new Map();
const HEADLESS_REPLY_RECEIPT_ENV = "TAP_HEADLESS_REPLY_RECEIPT_DIR";

function shouldSurfaceTapReplyRoutingWarning(options: {
  warning: string | null | undefined;
  fallbackToInbox: boolean;
  structured: boolean;
}): boolean {
  if (!options.warning) return false;
  if (options.structured) return true;
  if (!options.fallbackToInbox) return true;
  return !options.warning.includes("only stale-visible Codex presence matched");
}

function formatTapReplyRouteDiagnostic(options: {
  transport: string;
  delivered: boolean;
  fallbackToInbox: boolean;
  dryRun?: boolean;
  turnId?: string | null;
  inboxPath?: string | null;
}): string {
  const liveAttemptStatus =
    options.transport === "consent-drive" && !options.fallbackToInbox
      ? options.dryRun
        ? "would-attempt"
        : options.delivered
          ? "delivered"
          : "not-delivered"
      : "not-attempted";
  return (
    `tap_reply route: transport=${options.transport}` +
    ` liveAttemptStatus=${liveAttemptStatus}` +
    ` fallbackToInbox=${String(options.fallbackToInbox)}` +
    (options.inboxPath
      ? ` inboxEvidence=${options.dryRun ? "would-write:" : ""}${options.inboxPath}`
      : "") +
    (options.turnId ? ` turnId=${options.turnId}` : "")
  );
}

function loadTowerNameFromConfig(): string | null {
  const repoRoot = process.env.TAP_REPO_ROOT ?? ".";
  try {
    const cfgPath = join(repoRoot, "tap-config.json");
    if (!existsSync(cfgPath)) return null;
    const cfg = JSON.parse(readFileSync(cfgPath, "utf-8")) as {
      towerName?: string | null;
    };
    return cfg.towerName?.trim() || null;
  } catch {
    return null;
  }
}

/**
 * M382 — write through `.mcp.json`'s `TAP_AGENT_NAME` so the next bootstrap
 * starts with the chosen name. Opt out via `TAP_AUTOWRITE_MCP_JSON=0`.
 *
 * Best-effort: silently no-ops on missing file, parse errors, or write
 * permission issues. Logs via `debug()` for traceability.
 *
 * If `.mcp.json` exists but does not have `mcpServers.tap.env`, emits a
 * debug log instead of skipping silently — so users can see why their
 * `tap_set_name` did not propagate to the bootstrap config.
 *
 * Called by both `tap_set_name` (with the chosen name) and
 * `tap_reset_identity` (with `"unnamed"`).
 */
function writeMcpJsonAgentName(name: string): void {
  if (process.env.TAP_AUTOWRITE_MCP_JSON === "0") return;
  try {
    const repoRoot = process.env.TAP_REPO_ROOT || process.cwd();
    const mcpPath = join(repoRoot, ".mcp.json");
    if (!existsSync(mcpPath)) return;
    const raw = readFileSync(mcpPath, "utf-8");
    const cfg = JSON.parse(raw) as {
      mcpServers?: Record<string, { env?: Record<string, string> }>;
    };
    const tapEnv = cfg?.mcpServers?.tap?.env;
    if (!tapEnv || typeof tapEnv !== "object") {
      debug(
        `.mcp.json mcpServers.tap.env not found — write-through skipped (target: "${name}")`,
      );
      return;
    }
    if (tapEnv.TAP_AGENT_NAME === name) return;
    tapEnv.TAP_AGENT_NAME = name;
    writeFileSync(mcpPath, JSON.stringify(cfg, null, 2) + "\n");
    debug(`.mcp.json TAP_AGENT_NAME set to "${name}"`);
  } catch {
    // Non-critical — best-effort
  }
}

/**
 * M310: Load known remote agents from tap-config.json + local config.
 * These agents bypass local heartbeat validation for cross-machine routing.
 * Tower name is always included as a remote agent.
 */
function loadRemoteAgents(): Set<string> {
  const repoRoot = process.env.TAP_REPO_ROOT ?? ".";
  const agents = new Set<string>();
  for (const filename of ["tap-config.json", "tap-config.local.json"]) {
    try {
      const cfgPath = join(repoRoot, filename);
      if (!existsSync(cfgPath)) continue;
      const cfg = JSON.parse(readFileSync(cfgPath, "utf-8")) as {
        towerName?: string | null;
        remoteAgents?: string[];
      };
      if (cfg.towerName?.trim()) agents.add(cfg.towerName.trim());
      if (Array.isArray(cfg.remoteAgents)) {
        for (const a of cfg.remoteAgents) {
          if (typeof a === "string" && a.trim()) agents.add(a.trim());
        }
      }
    } catch {
      // best-effort
    }
  }
  return agents;
}

function resolveMatchingStableTarget(
  recipient: string,
  candidates: Iterable<string>,
): string | null {
  const normalized = recipient.trim();
  if (!normalized) return null;

  for (const candidate of candidates) {
    const stable = candidate.trim();
    if (
      stable &&
      (stable === normalized || sameRoutingAddress(stable, normalized))
    ) {
      return stable;
    }
  }

  return null;
}

function resolveFileLabel(
  preferred: string | null | undefined,
  fallback: string,
): string {
  const normalizedPreferred = preferred?.trim();
  if (
    normalizedPreferred &&
    !isPlaceholderAgentValue(normalizedPreferred) &&
    normalizedPreferred !== "<set-per-session>"
  ) {
    return normalizedPreferred;
  }

  const normalizedFallback = fallback.trim();
  return normalizedFallback || "unknown";
}

type TapEnvelopeAddress = {
  hostId: string | null;
  clientId: string | null;
  conversationId: string | null;
  ownerClientId: string | null;
  routingAddress: string;
  slot?: string | null;
  aliases?: string[];
};

function normalizeUniqueStrings(
  values: Array<string | null | undefined>,
): string[] {
  const normalized = new Set<string>();
  for (const value of values) {
    const trimmed = value?.trim();
    if (!trimmed) continue;
    normalized.add(trimmed);
  }
  return [...normalized];
}

function normalizeStructuredTarget(
  target: TapStructuredRecipientTarget,
): TapStructuredRecipientTarget | null {
  const routingAddress = target.routingAddress?.trim();
  if (!routingAddress) return null;
  return {
    routingAddress,
    hostId: target.hostId?.trim() || null,
    clientId: target.clientId?.trim() || null,
    conversationId: target.conversationId?.trim() || null,
    ownerClientId: target.ownerClientId?.trim() || null,
  };
}

function buildEnvelopeAddress(options: {
  explicit?: TapStructuredRecipientTarget | null;
  resolved?: TapAddressMetadata | null;
  fallbackRoutingAddress: string;
  displayName?: string | null;
}): TapEnvelopeAddress | null {
  const routingAddress =
    options.explicit?.routingAddress?.trim() ||
    options.resolved?.routingAddress?.trim() ||
    options.fallbackRoutingAddress.trim();
  if (!routingAddress) return null;

  return {
    hostId: options.explicit?.hostId ?? options.resolved?.hostId ?? null,
    clientId: options.explicit?.clientId ?? options.resolved?.clientId ?? null,
    conversationId:
      options.explicit?.conversationId ??
      options.resolved?.conversationId ??
      null,
    ownerClientId:
      options.explicit?.ownerClientId ??
      options.resolved?.ownerClientId ??
      null,
    routingAddress,
    slot: options.resolved?.slot ?? null,
    aliases: normalizeUniqueStrings([
      ...(options.resolved?.aliases ?? []),
      options.explicit?.routingAddress,
      options.displayName,
      routingAddress,
    ]),
  };
}

function buildInboxFrontmatter(options: {
  from: string;
  fromName?: string | null;
  to: string;
  toName?: string | null;
  subject: string;
  sentAt: string;
  messageId: string;
  fromAddress?: TapEnvelopeAddress | null;
  toAddress?: TapEnvelopeAddress | null;
  scope?: TapEnvelopeScope | null;
  action?: string | null;
  consentRef?: string | null;
}): string {
  const lines = [
    "---",
    "type: inbox",
    `message_id: ${options.messageId}`,
    `from: ${options.from}`,
  ];
  const fromName = options.fromName?.trim() || null;
  const toName = options.toName?.trim() || null;

  if (fromName && !sameRoutingAddress(fromName, options.from)) {
    lines.push(`from_name: ${fromName}`);
  }

  lines.push(`to: ${options.to}`);

  if (toName && !sameRoutingAddress(toName, options.to)) {
    lines.push(`to_name: ${toName}`);
  }

  if (options.fromAddress) {
    lines.push(`from_address: ${JSON.stringify(options.fromAddress)}`);
  }
  if (options.toAddress) {
    lines.push(`to_address: ${JSON.stringify(options.toAddress)}`);
  }
  if (options.scope) {
    lines.push(`scope: ${options.scope}`);
  }
  if (options.action?.trim()) {
    lines.push(`action: ${options.action.trim()}`);
  }
  if (options.consentRef?.trim()) {
    lines.push(`consent_ref: ${options.consentRef.trim()}`);
  }

  lines.push(
    `subject: ${options.subject}`,
    `sent_at: ${options.sentAt}`,
    "---",
    "",
  );

  return lines.join("\n");
}

function formatTapReplyError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isFileExistsError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  return "code" in error && error.code === "EEXIST";
}

function addInboxFilenameSuffix(filename: string, suffix: number): string {
  const extension = filename.toLowerCase().endsWith(".md") ? ".md" : "";
  const stem = extension ? filename.slice(0, -extension.length) : filename;
  return `${stem}-${suffix}${extension}`;
}

function resolveInboxEvidenceCandidate(filename: string): {
  filename: string;
  inboxPath: string;
} {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const candidate =
      attempt === 0 ? filename : addInboxFilenameSuffix(filename, attempt + 1);
    if (!existsSync(join(INBOX_DIR, candidate))) {
      return { filename: candidate, inboxPath: `inbox/${candidate}` };
    }
  }
  const fallback = addInboxFilenameSuffix(filename, Date.now());
  return { filename: fallback, inboxPath: `inbox/${fallback}` };
}

function writePrimaryInboxEvidence(options: {
  filename: string;
  body: string;
  fromId: string;
  to: string;
  subject: string;
}):
  | { ok: true; filename: string; inboxPath: string }
  | { ok: false; error: string } {
  try {
    mkdirSync(INBOX_DIR, { recursive: true });
  } catch (error) {
    return { ok: false, error: formatTapReplyError(error) };
  }

  for (let attempt = 0; attempt < 100; attempt += 1) {
    const filename =
      attempt === 0
        ? options.filename
        : addInboxFilenameSuffix(options.filename, attempt + 1);
    try {
      writeFileSync(join(INBOX_DIR, filename), options.body, {
        encoding: "utf-8",
        flag: "wx",
      });
      dbInsertMessage(
        filename,
        options.fromId,
        options.to,
        options.subject,
        "inbox",
        Date.now(),
      );
      return { ok: true, filename, inboxPath: `inbox/${filename}` };
    } catch (error) {
      if (isFileExistsError(error)) continue;
      return { ok: false, error: formatTapReplyError(error) };
    }
  }

  return {
    ok: false,
    error: `could not reserve a unique inbox evidence filename for ${options.filename}`,
  };
}

function writeHeadlessReplyReceipt(options: {
  messageId: string;
  from: string;
  fromName: string;
  to: string;
  toName: string | null;
  subject: string;
  fileName: string;
  transport: string;
  fallbackToInbox: boolean;
  turnId?: string | null;
  consentRef?: string | null;
  inboxPath?: string | null;
}): string | null {
  const receiptDir = process.env[HEADLESS_REPLY_RECEIPT_ENV]?.trim();
  if (!receiptDir) return null;

  try {
    mkdirSync(receiptDir, { recursive: true });
    const receiptFile = `${Date.now()}-${options.messageId}.json`;
    const receiptPath = join(receiptDir, receiptFile);
    writeFileSync(
      receiptPath,
      JSON.stringify(
        {
          version: 1,
          type: "tap_reply.sent",
          createdAt: new Date().toISOString(),
          messageId: options.messageId,
          from: options.from,
          fromName: options.fromName,
          to: options.to,
          toName: options.toName,
          subject: options.subject,
          fileName: options.fileName,
          inboxPath: options.inboxPath ?? null,
          transport: options.transport,
          fallbackToInbox: options.fallbackToInbox,
          turnId: options.turnId ?? null,
          consentRef: options.consentRef ?? null,
        },
        null,
        2,
      ) + "\n",
      { encoding: "utf-8", flag: "wx" },
    );
    return receiptPath;
  } catch (error) {
    debug(
      `failed to write headless reply receipt: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return null;
  }
}

function isValidAgentName(name: string): boolean {
  return Boolean(name) && /^[A-Za-z0-9가-힣_]+$/.test(name);
}

function hasCapabilityRegistrationArgs(
  rawArgs: Record<string, unknown>,
): boolean {
  return (
    typeof rawArgs.receiveTransports !== "undefined" ||
    typeof rawArgs.conversationId !== "undefined" ||
    typeof rawArgs.ownerClientId !== "undefined"
  );
}

function loadOnboardingTeaser(): string {
  const commsDir = process.env.TAP_COMMS_DIR;
  if (!commsDir) return "";

  // Startup-time gating: skip teaser if agent already onboarded
  const stateDir = process.env.TAP_STATE_DIR;
  const agentId = getAgentId();
  if (stateDir && agentId !== "unknown") {
    try {
      const markerPath = join(stateDir, "onboarded.json");
      if (existsSync(markerPath)) {
        const store = JSON.parse(readFileSync(markerPath, "utf-8"));
        if (store[agentId]) return ""; // Already onboarded — skip teaser
      }
    } catch {
      // best-effort — serve teaser if marker unreadable
    }
  }

  try {
    const welcomePath = join(commsDir, "onboarding", "welcome.md");
    if (!existsSync(welcomePath)) return "";
    const content = readFileSync(welcomePath, "utf-8");
    const lines = content.split("\n").slice(0, ONBOARDING_TEASER_LINES);

    // Write marker on teaser serve — so next startup skips it
    if (stateDir && agentId !== "unknown") {
      try {
        const markerPath = join(stateDir, "onboarded.json");
        let store: Record<string, { onboardedAt: string }> = {};
        if (existsSync(markerPath)) {
          store = JSON.parse(readFileSync(markerPath, "utf-8"));
        }
        if (!store[agentId]) {
          store[agentId] = { onboardedAt: new Date().toISOString() };
          mkdirSync(stateDir, { recursive: true });
          writeFileSync(markerPath, JSON.stringify(store, null, 2), "utf-8");
        }
      } catch {
        // best-effort
      }
    }

    return (
      "\n\n--- Onboarding ---\n" +
      lines.join("\n") +
      "\n(Use tap_onboard tool for full onboarding guide.)"
    );
  } catch {
    return "";
  }
}

// ── MCP Server ──────────────────────────────────────────────────────────

const baseInstructions =
  'You are connected to the tap-comms channel. Messages from other agents may arrive as <channel source="tap-comms" from="X" to="Y" subject="Z"> notifications or standard MCP notification messages. If your client does not surface realtime notifications, call tap_list_unread to pull pending inbox and review messages. Reply using the tap_reply tool to send messages back to other agents or the control tower.';

const serverCapabilities = {
  experimental: { "claude/channel": {} },
  logging: {},
  tools: {},
} as const;

const mcp = new Server(
  { name: "tap-comms", version: "0.2.2" },
  {
    capabilities: serverCapabilities,
    instructions: baseInstructions + loadOnboardingTeaser(),
  },
);

function getMcpSessionSnapshot() {
  const clientVersion = mcp.getClientVersion() ?? null;
  setObservedMcpClientName(
    typeof clientVersion === "object" && clientVersion
      ? clientVersion.name
      : typeof clientVersion === "string"
        ? clientVersion
        : null,
  );
  return {
    clientVersion,
    clientCapabilities: mcp.getClientCapabilities() ?? null,
    serverCapabilities,
  };
}

function observeCurrentMcpClient() {
  void getMcpSessionSnapshot();
}

function logRoutingRuntimeConflictWarning(context: string) {
  const conflicts = getRoutingRuntimeConflicts();
  if (conflicts.length === 0) return;

  logWarn("mcp multi-runtime stateDir conflict detected", {
    context,
    runtimeKey: getRoutingRuntimeKey(),
    conflictCount: conflicts.length,
    conflicts: conflicts.map((conflict) => ({
      pid: conflict.pid,
      runtimeKey: conflict.runtimeKey,
      agentId: conflict.agentId,
      agentName: conflict.agentName,
      updatedAt: conflict.updatedAt,
    })),
  });
}

mcp.oninitialized = () => {
  logInfo("mcp initialize handshake completed", getMcpSessionSnapshot());
  logRoutingRuntimeConflictWarning("initialized");
};

// ── Tool Definitions ────────────────────────────────────────────────────

mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "tap_set_name",
      description:
        "Set your agent name. Call this when you pick your name at session start.",
      inputSchema: {
        type: "object" as const,
        properties: {
          name: {
            type: "string" as const,
            description: "Your chosen agent name.",
          },
          tower: {
            type: "boolean" as const,
            description:
              "Set to true if this agent is the control tower. Registers towerName in tap-config.json for rate-limit exemption.",
          },
          receiveTransports: {
            type: "array" as const,
            description:
              "Optional explicit receive transport declaration. Overrides runtime heuristic when provided.",
            items: {
              type: "string" as const,
              enum: ["mcp-channel", "consent-drive", "polling"],
            },
          },
        },
        required: ["name"],
      },
    },
    {
      name: "tap_reply",
      description:
        "Send a message to another tap agent. Use concrete agent names for assignments; broad role words such as codex/reviewer/implementer may be rejected when ambiguous. Accepts either a simple `to` string or a structured `target` route.",
      inputSchema: {
        type: "object" as const,
        properties: {
          to: {
            type: "string" as const,
            description:
              "Concrete recipient agent name. Avoid broad role aliases unless a role mapping is explicitly configured.",
          },
          target: {
            type: "object" as const,
            properties: {
              routingAddress: {
                type: "string" as const,
                description:
                  "Primary routing address or alias (slot, instance, or known stable route).",
              },
              hostId: {
                type: "string" as const,
                description: "Optional host constraint for disambiguation.",
              },
              clientId: {
                type: "string" as const,
                description:
                  "Optional client/instance constraint for disambiguation.",
              },
              conversationId: {
                type: "string" as const,
                description:
                  "Optional conversation/thread constraint for disambiguation.",
              },
              ownerClientId: {
                type: "string" as const,
                description: "Optional owner constraint for disambiguation.",
              },
            },
            required: ["routingAddress"],
          },
          subject: {
            type: "string" as const,
            description: "Message subject in kebab-case.",
          },
          content: {
            type: "string" as const,
            description: "Markdown message content.",
          },
          cc: {
            description:
              "Optional CC recipients. Each receives a copy of the message. Pass a single string or an array of strings.",
            oneOf: [
              { type: "string" as const },
              {
                type: "array" as const,
                items: { type: "string" as const },
              },
            ],
          },
          dryRun: {
            type: "boolean" as const,
            description:
              "When true, resolve the delivery path without writing inbox files or starting a consent-drive turn.",
          },
          scope: {
            type: "string" as const,
            enum: ["observe", "suggest", "drive"],
            description:
              "Optional capability scope metadata for future A2A envelope readers.",
          },
          action: {
            type: "string" as const,
            description:
              "Optional action metadata for future A2A envelope readers.",
          },
          consentRef: {
            type: "string" as const,
            description: "Optional consent/grant reference metadata.",
          },
        },
        required: ["subject", "content"],
      },
    },
    {
      name: "tap_reply_v2",
      description:
        "Compatibility alias for structured tap sends. Prefer tap_reply with `target` for new callers; use concrete routing metadata rather than broad role aliases.",
      inputSchema: {
        type: "object" as const,
        properties: {
          target: {
            type: "object" as const,
            properties: {
              routingAddress: {
                type: "string" as const,
                description:
                  "Primary routing address or alias (slot, instance, or known stable route).",
              },
              hostId: {
                type: "string" as const,
                description: "Optional host constraint for disambiguation.",
              },
              clientId: {
                type: "string" as const,
                description:
                  "Optional client/instance constraint for disambiguation.",
              },
              conversationId: {
                type: "string" as const,
                description:
                  "Optional conversation/thread constraint for disambiguation.",
              },
              ownerClientId: {
                type: "string" as const,
                description: "Optional owner constraint for disambiguation.",
              },
            },
            required: ["routingAddress"],
          },
          subject: {
            type: "string" as const,
            description: "Message subject in kebab-case.",
          },
          content: {
            type: "string" as const,
            description: "Markdown message content.",
          },
          scope: {
            type: "string" as const,
            enum: ["observe", "suggest", "drive"],
            description:
              "Optional capability scope metadata for future A2A envelope readers.",
          },
          action: {
            type: "string" as const,
            description:
              "Optional action metadata for future A2A envelope readers.",
          },
          consentRef: {
            type: "string" as const,
            description: "Optional consent/grant reference metadata.",
          },
          dryRun: {
            type: "boolean" as const,
            description:
              "When true, resolve the delivery path without writing inbox files or starting a consent-drive turn.",
          },
        },
        required: ["target", "subject", "content"],
      },
    },
    {
      name: "tap_reset_identity",
      description:
        "Clear the current session's tap identity lock so a new session can call tap_set_name again.",
      inputSchema: { type: "object" as const, properties: {} },
    },
    {
      name: "tap_session_warmup",
      description:
        "Perform common session warm-up: set or confirm identity, register receive capabilities, send heartbeat, and return the current tap_who summary.",
      inputSchema: {
        type: "object" as const,
        properties: {
          name: {
            type: "string" as const,
            description:
              "Agent name to set or confirm. Required when the current session has no confirmed identity.",
          },
          receiveTransports: {
            type: "array" as const,
            description:
              "Optional explicit receive transport declaration for this session.",
            items: {
              type: "string" as const,
              enum: ["mcp-channel", "consent-drive", "polling"],
            },
          },
          conversationId: {
            type: "string" as const,
            description:
              "Optional explicit conversation binding for this session. Pass an empty string to clear it.",
          },
          ownerClientId: {
            type: "string" as const,
            description:
              "Optional explicit Codex IPC owner client binding for this session. Pass an empty string to clear it. Omit it with conversationId to trigger owner discovery where supported.",
          },
          status: {
            type: "string" as const,
            enum: ["active", "idle", "signing-off"],
            description: "Heartbeat status to publish. Default active.",
          },
          minutes: {
            type: "number" as const,
            description: `tap_who window in minutes for the returned summary. Default ${POLLING_RECIPIENT_VISIBILITY_MINUTES}.`,
          },
        },
      },
    },
    {
      name: "tap_register_capabilities",
      description:
        "Register capability metadata for the current agent session without changing its display name.",
      inputSchema: {
        type: "object" as const,
        properties: {
          receiveTransports: {
            type: "array" as const,
            description:
              "Optional explicit receive transport declaration for this session.",
            items: {
              type: "string" as const,
              enum: ["mcp-channel", "consent-drive", "polling"],
            },
          },
          conversationId: {
            type: "string" as const,
            description:
              "Optional explicit conversation binding for this session. Pass an empty string to clear it.",
          },
          ownerClientId: {
            type: "string" as const,
            description:
              "Optional explicit Codex IPC owner client binding for this session. Pass an empty string to clear it.",
          },
        },
      },
    },
    {
      name: "tap_broadcast",
      description:
        "Broadcast a message to all agents. Shorthand for tap_reply with to='전체'.",
      inputSchema: {
        type: "object" as const,
        properties: {
          subject: {
            type: "string" as const,
            description: "Message subject in kebab-case.",
          },
          content: {
            type: "string" as const,
            description: "Markdown message content.",
          },
        },
        required: ["subject", "content"],
      },
    },
    {
      name: "tap_list_unread",
      description:
        "Poll unread tap-comms items for clients that do not receive channel notifications.",
      inputSchema: {
        type: "object" as const,
        properties: {
          sources: {
            type: "array" as const,
            description:
              'Optional source filter. Defaults to inbox, reviews. Add "findings" explicitly if needed.',
            items: {
              type: "string" as const,
              enum: ["inbox", "reviews", "findings"],
            },
          },
          limit: {
            type: "number" as const,
            description:
              "Maximum number of unread items to return. Default 20.",
          },
          includeContent: {
            type: "boolean" as const,
            description: "Include full markdown content. Default true.",
          },
          markRead: {
            type: "boolean" as const,
            description: "Mark returned items as read. Default true.",
          },
          since: {
            type: "string" as const,
            description:
              "ISO timestamp. Only return files modified after this time.",
          },
        },
      },
    },
    {
      name: "tap_read_receipt",
      description:
        "Acknowledge that you read a message. Stores a read receipt so the sender can verify delivery.",
      inputSchema: {
        type: "object" as const,
        properties: {
          filename: {
            type: "string" as const,
            description: "The inbox filename of the message you read.",
          },
        },
        required: ["filename"],
      },
    },
    {
      name: "tap_stats",
      description:
        "Show communication statistics: messages sent/received per agent, read receipts.",
      inputSchema: {
        type: "object" as const,
        properties: {
          hours: {
            type: "number" as const,
            description: "Time window in hours. Default 24.",
          },
        },
      },
    },
    {
      name: "tap_heartbeat",
      description:
        "Send a heartbeat to signal this agent is alive. Call periodically or before/after major work.",
      inputSchema: {
        type: "object" as const,
        properties: {
          status: {
            type: "string" as const,
            enum: ["active", "idle", "signing-off"],
            description:
              "Agent status. Default 'active'. Use 'signing-off' before session end.",
          },
        },
      },
    },
    {
      name: "tap_who",
      description:
        "List online agents based on recent heartbeats. Shows status, last heartbeat, and zombie detection.",
      inputSchema: {
        type: "object" as const,
        properties: {
          minutes: {
            type: "number" as const,
            description: `Consider agents alive if heartbeat within this many minutes. Default ${POLLING_RECIPIENT_VISIBILITY_MINUTES}.`,
          },
        },
      },
    },
    {
      name: "tap_cleanup",
      description:
        "Archive inbox files older than N days. Moves them to archive/ directory.",
      inputSchema: {
        type: "object" as const,
        properties: {
          days: {
            type: "number" as const,
            description: "Archive files older than this many days. Default 7.",
          },
          dryRun: {
            type: "boolean" as const,
            description: "Preview only, don't move files. Default false.",
          },
        },
      },
    },
    {
      name: "tap_db_sync",
      description:
        "Sync existing inbox/receipts/heartbeats files into the SQLite database.",
      inputSchema: { type: "object" as const, properties: {} },
    },
    {
      name: "tap_onboard",
      description:
        "Get the full onboarding guide for this project. Returns welcome.md + any additional onboarding docs from commsDir/onboarding/.",
      inputSchema: { type: "object" as const, properties: {} },
    },
    {
      name: "tap_identity_probe",
      description:
        "Dump the current MCP-side identity/runtime env snapshot seen by tap tools.",
      inputSchema: {
        type: "object" as const,
        properties: {
          testName: {
            type: "string" as const,
            description:
              "Optional routing-address dry-run. Returns whether the current runtime would accept this recipient.",
          },
        },
      },
    },
    {
      name: "tap_create_consent_receipt",
      description:
        "Create a target-initiated one-shot consent receipt bound to the current conversation address tuple.",
      inputSchema: {
        type: "object" as const,
        properties: {
          scope: {
            type: "string" as const,
            enum: ["observe", "suggest", "drive"],
            description:
              "Capability scope granted by this receipt. Default drive.",
          },
          conversationId: {
            type: "string" as const,
            description:
              "Optional explicit conversationId override. Defaults to the current bridge-backed identity snapshot.",
          },
          ownerClientId: {
            type: "string" as const,
            description:
              "Optional explicit ownerClientId override. Defaults to the current bridge-backed identity snapshot.",
          },
          hostId: {
            type: "string" as const,
            description:
              "Optional explicit hostId override. Defaults to the current bridge-backed identity snapshot.",
          },
          ttlSeconds: {
            type: "number" as const,
            description: "Receipt TTL in seconds. Default 600.",
          },
          allowedMethods: {
            type: "array" as const,
            items: { type: "string" as const },
            description:
              "Optional follower-control method allowlist for narrower grants.",
          },
        },
      },
    },
  ],
}));

// ── Activity Persistence ────────────────────────────────────────────────

function prunePhantomHeartbeats(
  store: Record<string, { id?: string; [k: string]: unknown }>,
): number {
  let removed = 0;
  for (const key of Object.keys(store)) {
    if (!store[key].id) {
      delete store[key];
      removed++;
    }
  }
  return removed;
}

function persistActivity(id: string, name: string): void {
  const locked = acquireLock(HEARTBEATS_LOCK);
  if (!locked) return; // Skip this cycle, retry next tool call
  try {
    const store = loadHeartbeats();
    // M210: Remove phantom entries (no id field) on every write cycle
    prunePhantomHeartbeats(store);
    const existing = store[id];
    const heartbeatRecord = buildHeartbeatRecord({
      agentId: id,
      agentName: name,
      status: existing?.status ?? "active",
      existing,
      timestamp: existing?.timestamp ?? new Date().toISOString(),
      lastActivity: getLastActivityTime(),
      joinedAt: existing?.joinedAt,
    });
    store[id] = {
      ...existing,
      ...heartbeatRecord.heartbeat,
    };
    saveHeartbeats(store);
  } catch {
    // Non-critical
  } finally {
    releaseLock(HEARTBEATS_LOCK);
  }
}

// ── Tool Handlers ───────────────────────────────────────────────────────

mcp.setRequestHandler(CallToolRequestSchema, async (req: CallToolRequest) => {
  observeCurrentMcpClient();
  updateActivityTime();

  // Auto-persist activity to heartbeat store so tap_who can find us
  // Skip for tap_set_name/tap_reset_identity — handled in their own flows
  const currentId = getAgentId();
  const currentName = getAgentName();
  if (
    currentId !== "unknown" &&
    req.params.name !== "tap_set_name" &&
    req.params.name !== "tap_reset_identity"
  ) {
    persistActivity(currentId, currentName);
    // M309: Seal grace window on any non-set_name tool call
    sealGraceWindow();
  }

  // ── tap_set_name ──────────────────────────────────────────────────
  if (req.params.name === "tap_set_name") {
    const rawArgs = ((req.params.arguments as
      | Record<string, unknown>
      | undefined) ?? {}) as Record<string, unknown>;
    const name = typeof rawArgs.name === "string" ? rawArgs.name : "";
    const tower = rawArgs.tower === true;
    const parsedCapabilities = parseCapabilityRegistrationArgs(rawArgs);
    if (!parsedCapabilities.ok) {
      return {
        content: [{ type: "text", text: parsedCapabilities.errorText }],
      };
    }
    const { explicitReceiveTransports } = parsedCapabilities;
    if (!name || !/^[A-Za-z0-9가-힣_]+$/.test(name)) {
      return {
        content: [
          {
            type: "text",
            text: `Rejected: "${name}" contains invalid characters. Agent names must match [A-Za-z0-9가-힣_] — no hyphens, spaces, or special characters.`,
          },
        ],
      };
    }
    // Step 1: Pre-check memory guard (read-only) — reject if already confirmed with different name
    // M309: Allow rename within grace window (60s after first set_name, before other tool calls)
    const { isNameConfirmed: isConfirmed, getAgentName: currentName } =
      await import("./tap-utils.js");
    if (isConfirmed() && currentName() !== name && !isInGraceWindow()) {
      return {
        content: [
          {
            type: "text",
            text:
              `Rejected: Name already confirmed as "${currentName()}". ` +
              `tap_set_name can only be called once per session. ` +
              `Agent ID: ${getAgentId()} (immutable).`,
          },
        ],
      };
    }

    // M309 Step 1b: Pre-validate against active heartbeats — warn on duplicates
    // This is advisory only — the file claim protocol (Step 2) handles dead process
    // takeover via PID/TTL checks. Heartbeat alone can't distinguish dead from alive.
    let heartbeatDuplicateWarning: string | null = null;
    const locked1b = acquireLock(HEARTBEATS_LOCK);
    if (locked1b) {
      try {
        const store = loadHeartbeats();
        const ACTIVE_THRESHOLD_MS = 60 * 60 * 1000; // 1 hour
        for (const [otherId, otherHb] of Object.entries(store)) {
          if (otherId === getAgentId()) continue;
          if (otherHb.agent !== name) continue;
          if (otherHb.status === "signing-off") continue;
          const freshestTs = Math.max(
            otherHb.lastActivity ? new Date(otherHb.lastActivity).getTime() : 0,
            otherHb.timestamp ? new Date(otherHb.timestamp).getTime() : 0,
          );
          if (Date.now() - freshestTs < ACTIVE_THRESHOLD_MS) {
            heartbeatDuplicateWarning =
              `⚠️ Name "${name}" was recently used by agent "${otherId}" ` +
              `(last active ${Math.round((Date.now() - freshestTs) / 60000)}m ago). ` +
              `Proceeding with claim check.`;
            break;
          }
        }
      } catch {
        // Non-critical — proceed without pre-validation
      } finally {
        releaseLock(HEARTBEATS_LOCK);
      }
    }

    // Step 2: File claim — atomic cross-instance lock
    const claimInstanceId = resolveClaimInstanceId();
    const fileClaim = claimName(
      name,
      claimInstanceId,
      process.pid,
      "mcp-direct",
    );
    if (!fileClaim.success) {
      const conflict = fileClaim.conflictWith;
      return {
        content: [
          {
            type: "text",
            text:
              `Rejected: Name "${name}" is claimed by instance "${conflict?.instanceId}" (alive: ${conflict?.alive}). ` +
              `Agent ID: ${getAgentId()} (immutable).`,
          },
        ],
      };
    }

    // Step 3: Memory claim — only after file claim succeeds
    const claim = claimAgentName(name);
    if (!claim.ok) {
      // Should not happen (pre-check passed), but safety net
      releaseClaim(name, claimInstanceId, process.pid);
      return {
        content: [
          {
            type: "text",
            text:
              `Rejected: Name already confirmed as "${claim.currentName}". ` +
              `Agent ID: ${claim.agentId} (immutable).`,
          },
        ],
      };
    }

    const { oldName, agentId, wasIdLocked } = claim;

    const activeSenders = getRecentSenders();
    activeSenders.delete(oldName);
    const isDuplicate = activeSenders.has(name);
    debug(
      `name changed: ${oldName} -> ${name} (id: ${agentId}, locked: ${wasIdLocked})${isDuplicate ? " (DUPLICATE WARNING)" : ""}`,
    );

    const activeList = [...activeSenders]
      .filter((n) => n !== "unnamed" && n !== "unknown")
      .join(", ");
    // Persist heartbeat under agent id (not name) for stable routing
    const now = new Date().toISOString();
    let priorJoinedAt: string | null = null; // M111: capture pre-write state
    let priorLastActivity: string | null = null;
    // M354: capture ownership-change prune result outside the lock so the
    // audit writer can emit without holding the heartbeat lock.
    let ownershipPrune: ReturnType<typeof pruneInstanceOwnershipChange> | null =
      null;
    let ownershipInstanceId: string | null = null;
    let ownershipHostId: string | null = null;
    const locked = acquireLock(HEARTBEATS_LOCK);
    if (locked) {
      try {
        const store = loadHeartbeats();
        // Find existing entry by id or old name (migration from name-keyed)
        const oldEntry =
          store[agentId] ??
          (oldName !== "unknown" ? store[oldName] : undefined);

        // M111: capture pre-write state for tower notify dedupe
        priorJoinedAt = oldEntry?.joinedAt ?? null;
        priorLastActivity = oldEntry?.lastActivity ?? null;

        // Delete old name-keyed entry if migrating to id-keyed
        if (oldName !== "unknown" && oldName !== agentId) {
          delete store[oldName];
        }

        const heartbeatRecord = buildHeartbeatRecord({
          agentId,
          agentName: name,
          status: "active",
          existing: oldEntry,
          timestamp: now,
          lastActivity: getLastActivityTime(),
          joinedAt: oldEntry?.joinedAt ?? now,
          resetCapabilities: Boolean(oldEntry) && oldEntry?.agent !== name,
          explicitReceiveTransports,
        });
        const { heartbeat, connectHash } = heartbeatRecord;
        store[agentId] = heartbeat;

        // M162: Clean stale heartbeats with the same display name but
        // different agent ID. Prevents duplicate routing when a bridge
        // restarts with a new session ID but the same agent name.
        // Use lastActivity (updated on every tool call) rather than
        // timestamp (only set at tap_set_name time) to avoid removing
        // sessions that are still actively using tools.
        const STALE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes
        for (const [otherId, otherHb] of Object.entries(store)) {
          if (otherId === agentId) continue;
          if (otherHb.agent !== name) continue;
          const otherConnectHash =
            otherHb.connectHash ??
            buildHeartbeatConnectHash(otherHb.instanceId ?? null, otherId);
          if (otherConnectHash !== connectHash) continue;
          const freshestTs = Math.max(
            otherHb.lastActivity ? new Date(otherHb.lastActivity).getTime() : 0,
            otherHb.timestamp ? new Date(otherHb.timestamp).getTime() : 0,
          );
          if (Date.now() - freshestTs > STALE_THRESHOLD_MS) {
            delete store[otherId];
          }
        }

        // M354: instance_id ownership change pruning. When the same
        // instance_id was previously held by a different agent on this host,
        // clear that agent's heartbeat/presence metadata so Layer 2 routing
        // starts clean. Cross-device presence (hostId mismatch) is preserved.
        const currentInstanceId = heartbeat.instanceId?.trim() ?? null;
        const currentHostId = heartbeat.address?.hostId?.trim() ?? null;
        if (currentInstanceId) {
          const pruneResult = pruneInstanceOwnershipChange({
            store,
            currentAgentId: agentId,
            currentInstanceId,
            currentHostId,
          });
          if (
            pruneResult.prunedKeys.length > 0 ||
            pruneResult.prunedPresenceFiles.length > 0
          ) {
            ownershipPrune = pruneResult;
            ownershipInstanceId = currentInstanceId;
            ownershipHostId = currentHostId;
          }
        }

        saveHeartbeats(store);
        // M334: Write per-agent presence file for cross-device visibility
        writePresenceFile(agentId, store[agentId]);
        writeRouteLeaseFile(agentId, store[agentId], "tap_set_name");
      } catch {
        // Non-critical
      } finally {
        releaseLock(HEARTBEATS_LOCK);
      }
    }

    // M354: emit ownership-change audit outside the lock to avoid I/O while
    // the heartbeat store is held. Dedupe is per (UTC day, instance, prev,
    // next) so steady-state churn stays quiet.
    if (ownershipPrune && ownershipPrune.previous && ownershipInstanceId) {
      writeInstanceOwnershipChangeAudit({
        instanceId: ownershipInstanceId,
        previous: {
          agentId: ownershipPrune.previous.agentId,
          displayName: ownershipPrune.previous.displayName,
          instanceId: ownershipPrune.previous.instanceId,
          hostId: ownershipPrune.previous.hostId,
          lastActivity: ownershipPrune.previous.lastActivity,
        },
        next: {
          agentId,
          displayName: name,
          instanceId: ownershipInstanceId,
          hostId: ownershipHostId,
          lastActivity: now,
        },
        prunedKeys: ownershipPrune.prunedKeys,
        prunedPresenceFiles: ownershipPrune.prunedPresenceFiles,
      });
    }

    // M299: state.json backwrite REMOVED — session names are mutable and belong
    // in claims + heartbeats, not in stable instance metadata. state.json
    // agentName (now defaultAgentName) is bootstrap-only, set at install time.

    // M310: Write agent-name.txt in runtime state dir for restart recovery.
    // This ensures all 3 mutable stores agree after name change:
    // heartbeats.json, .claims/, and agent-name.txt.
    // M187: Use atomic rename to prevent EBUSY on concurrent read.
    try {
      const runtimeStateDir = process.env.TAP_RUNTIME_STATE_DIR;
      if (runtimeStateDir && existsSync(runtimeStateDir)) {
        const targetPath = join(runtimeStateDir, "agent-name.txt");
        const tmpPath = `${targetPath}.tmp.${process.pid}`;
        writeFileSync(tmpPath, name, "utf-8");
        renameSync(tmpPath, targetPath);
      }
    } catch {
      // Non-critical — runtime dir may not exist for direct MCP sessions
    }

    // M111: Notify tower on new agent join (first non-placeholder name)
    if (oldName === "unknown" || oldName === "unnamed") {
      try {
        const towerName = loadTowerNameFromConfig();

        // Resolve runtime from state.json (works for all runtimes)
        let runtime = process.env.TAP_BRIDGE_RUNTIME ?? null;
        const stateDir = process.env.TAP_STATE_DIR;
        if (!runtime && stateDir) {
          try {
            const statePath = join(stateDir, "state.json");
            if (existsSync(statePath)) {
              const state = JSON.parse(readFileSync(statePath, "utf-8"));
              const instanceKey = agentId.replace(/_/g, "-");
              const inst =
                state.instances?.[agentId] ?? state.instances?.[instanceKey];
              runtime = inst?.runtime ?? null;
            }
          } catch {
            /* best-effort */
          }
        }

        if (towerName && towerName !== name && towerName !== agentId) {
          // Dedupe using pre-write heartbeat state (avoids self-skip on first join)
          const SKIP_WINDOW_MS = 10 * 60 * 1000;
          const STALE_WINDOW_MS = 30 * 60 * 1000;
          let shouldNotify = true;

          if (priorJoinedAt) {
            // Existing agent — check lastActivity freshness
            const activityTs = priorLastActivity ?? priorJoinedAt;
            const activityAge = Date.now() - new Date(activityTs).getTime();
            if (activityAge < SKIP_WINDOW_MS) {
              shouldNotify = false; // Recently active — skip
            } else if (activityAge < STALE_WINDOW_MS) {
              shouldNotify = false; // Active within window — skip
            }
            // > 30min since last activity → re-notify
          }
          // priorJoinedAt === null → truly new agent → notify

          if (shouldNotify) {
            const ts = new Date().toISOString().replace(/[:.]/g, "-");
            const notifyFilename = `${ts.slice(0, 10).replace(/-/g, "")}-tap-${towerName}-new-agent-${agentId}.md`;
            const notifyPath = join(INBOX_DIR, notifyFilename);
            writeFileSync(
              notifyPath,
              `[NEW] ${name} (${agentId}) joined. Runtime: ${runtime ?? "unknown"}.`,
              "utf-8",
            );
            debug(
              `tower notify: ${towerName} ← new agent ${name} (${runtime})`,
            );
          }
        }
      } catch {
        // Non-critical — tower notify is best-effort
      }
    }

    // Register tower name in tap-config.json for rate-limit exemption
    if (tower) {
      try {
        const repoRoot = process.env.TAP_REPO_ROOT || process.cwd();
        const cfgPath = join(repoRoot, "tap-config.json");
        let cfg: Record<string, unknown> = {};
        if (existsSync(cfgPath)) {
          cfg = JSON.parse(readFileSync(cfgPath, "utf-8"));
        }
        cfg.towerName = name;
        writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + "\n");
        debug(`tap-config.json towerName set to "${name}"`);
      } catch {
        // Non-critical — best-effort
      }
    }

    writeMcpJsonAgentName(name);

    const identityProbe = buildAgentIdentityProbeSnapshot();
    const routingConflicts =
      identityProbe.runtimeCoordination.conflictingRuntimes;
    const runtimeKey =
      identityProbe.runtimeCoordination.runtimeKey ?? "unknown";

    let text = `Name set: ${name} (was: ${oldName}). Messages to "${name}", "${agentId}", "전체", or "all" will be received.`;
    if (tower)
      text += `\nTower registered: ${name} (rate-limit exempt for tower↔agent messages)`;
    if (!wasIdLocked)
      text += `\nAgent ID locked: ${agentId} (immutable for this session)`;
    if (explicitReceiveTransports) {
      text += `\nReceive transports override: ${explicitReceiveTransports.join(", ")}`;
    }
    text +=
      `\n⚠️ tap_set_name is process-local first. ` +
      `It updates this live runtime immediately and syncs same-runtime siblings via runtime key "${runtimeKey}", ` +
      `but other already-running MCP runtimes keep their current bootstrap until restart/reload.`;
    if (
      identityProbe.bootstrapDrift.envAgentNameIsPlaceholder ||
      identityProbe.bootstrapDrift.differsFromRuntime
    ) {
      const bootstrapName =
        identityProbe.bootstrapDrift.envAgentName?.trim() || "unset";
      text +=
        `\n⚠️ Bootstrap config still resolves to "${bootstrapName}". ` +
        `Update .mcp.json or ~/.codex/config.toml if future runtimes should start as "${name}", then restart/reload the affected session.`;
    }
    if (heartbeatDuplicateWarning) text += `\n${heartbeatDuplicateWarning}`;
    else if (isDuplicate)
      text += `\n⚠️ WARNING: "${name}" was already used in the last 24h. Pick a different name to avoid confusion.`;
    if (routingConflicts.length > 0) {
      text +=
        `\n⚠️ ${routingConflicts.length} other live MCP runtime(s) share this TAP_STATE_DIR. ` +
        `Routing aliases now sync within runtime key "${runtimeKey}", but not across those other runtimes. ` +
        `tap_set_name alone is not sufficient for cross-runtime realtime receive; update bootstrap config and restart/reload those sessions if realtime delivery still matters.`;
    }
    if (activeList) text += `\nRecent active names: ${activeList}`;
    return { content: [{ type: "text", text }] };
  }

  // ── tap_reset_identity ──────────────────────────────────────────
  if (req.params.name === "tap_reset_identity") {
    const reset = await resetIdentity();

    const locked = acquireLock(HEARTBEATS_LOCK);
    if (locked) {
      try {
        const store = loadHeartbeats();
        if (reset.previousId !== "unknown") {
          delete store[reset.previousId];
          deletePresenceFile(reset.previousId);
        }
        if (
          reset.previousName !== "unknown" &&
          reset.previousName !== reset.previousId
        ) {
          delete store[reset.previousName];
          deletePresenceFile(reset.previousName);
        }
        saveHeartbeats(store);
      } finally {
        releaseLock(HEARTBEATS_LOCK);
      }
    }

    debug(
      `identity reset: ${reset.previousName} (${reset.previousId}) -> ${reset.nextName} (${reset.nextId}), releasedClaim=${reset.releasedClaim}`,
    );

    // M382: reset bootstrap config so the next session starts clean.
    writeMcpJsonAgentName("unnamed");
    if (process.env.TAP_AUTOWRITE_MCP_JSON !== "0") {
      try {
        const repoRoot = process.env.TAP_REPO_ROOT || process.cwd();
        const cfgPath = join(repoRoot, "tap-config.json");
        if (existsSync(cfgPath)) {
          const tcfg = JSON.parse(readFileSync(cfgPath, "utf-8")) as Record<
            string,
            unknown
          >;
          if (tcfg.towerName === reset.previousName) {
            delete tcfg.towerName;
            writeFileSync(cfgPath, JSON.stringify(tcfg, null, 2) + "\n");
            debug(
              `tap-config.json towerName cleared (was "${reset.previousName}")`,
            );
          }
        }
      } catch {
        // Non-critical — best-effort
      }
    }

    return {
      content: [
        {
          type: "text",
          text:
            `Identity reset. Previous: "${reset.previousName}" ` +
            `(id: ${reset.previousId}). Current display name: "${reset.nextName}". ` +
            `Name lock cleared; call tap_set_name to choose a new name. ` +
            `Claim released: ${reset.releasedClaim}.`,
        },
      ],
    };
  }

  // ── tap_register_capabilities ─────────────────────────────────────
  if (req.params.name === "tap_register_capabilities") {
    const rawArgs = ((req.params.arguments as
      | Record<string, unknown>
      | undefined) ?? {}) as Record<string, unknown>;
    return await handleRegisterCapabilities(rawArgs, HEARTBEATS_LOCK);
  }

  // ── tap_session_warmup ────────────────────────────────────────────
  if (req.params.name === "tap_session_warmup") {
    const rawArgs = ((req.params.arguments as
      | Record<string, unknown>
      | undefined) ?? {}) as Record<string, unknown>;
    const requestedName =
      typeof rawArgs.name === "string" ? rawArgs.name.trim() : "";
    const existingName = getAgentName();
    const existingId = getAgentId();
    const status =
      rawArgs.status === "idle" || rawArgs.status === "signing-off"
        ? rawArgs.status
        : "active";
    const minutes =
      typeof rawArgs.minutes === "number" && rawArgs.minutes > 0
        ? rawArgs.minutes
        : POLLING_RECIPIENT_VISIBILITY_MINUTES;

    const parsedCapabilities = parseCapabilityRegistrationArgs(rawArgs, {
      allowConversationId: true,
      requireAtLeastOne: false,
    });
    if (!parsedCapabilities.ok) {
      return {
        content: [{ type: "text", text: parsedCapabilities.errorText }],
      };
    }

    const effectiveName =
      requestedName ||
      (existingName !== "unknown" && existingName !== "unnamed"
        ? existingName
        : "");
    if (!isValidAgentName(effectiveName)) {
      return {
        content: [
          {
            type: "text",
            text:
              `Rejected: tap_session_warmup requires a valid agent name when identity is not already confirmed. ` +
              `Agent names must match [A-Za-z0-9가-힣_] — no hyphens, spaces, or special characters.`,
          },
        ],
      };
    }
    if (
      existingName !== "unknown" &&
      existingName !== "unnamed" &&
      existingName !== effectiveName
    ) {
      return {
        content: [
          {
            type: "text",
            text:
              `Rejected: session is already named "${existingName}". ` +
              `tap_session_warmup does not rename live sessions; use tap_reset_identity only when you intentionally want a new identity.`,
          },
        ],
      };
    }

    const warmupNotes: string[] = [];
    let agentId = existingId;
    if (existingName === "unknown" || existingName === "unnamed") {
      const claimInstanceId = resolveClaimInstanceId();
      const fileClaim = claimName(
        effectiveName,
        claimInstanceId,
        process.pid,
        "mcp-direct",
      );
      if (!fileClaim.success) {
        const conflict = fileClaim.conflictWith;
        return {
          content: [
            {
              type: "text",
              text:
                `Rejected: Name "${effectiveName}" is claimed by instance "${conflict?.instanceId}" ` +
                `(alive: ${conflict?.alive}).`,
            },
          ],
        };
      }

      const claim = claimAgentName(effectiveName);
      if (!claim.ok) {
        releaseClaim(effectiveName, claimInstanceId, process.pid);
        return {
          content: [
            {
              type: "text",
              text:
                `Rejected: Name already confirmed as "${claim.currentName}". ` +
                `Agent ID: ${claim.agentId} (immutable).`,
            },
          ],
        };
      }
      agentId = claim.agentId;

      if (!acquireLock(HEARTBEATS_LOCK)) {
        return {
          content: [{ type: "text", text: "Heartbeat store busy, try again." }],
        };
      }
      try {
        const store = loadHeartbeats();
        const existing = store[agentId];
        const now = new Date().toISOString();
        const heartbeatRecord = buildHeartbeatRecord({
          agentId,
          agentName: effectiveName,
          status,
          existing,
          timestamp: now,
          lastActivity: getLastActivityTime(),
          joinedAt: existing?.joinedAt ?? now,
          resetCapabilities:
            Boolean(existing) && existing?.agent !== effectiveName,
          explicitReceiveTransports:
            parsedCapabilities.explicitReceiveTransports,
        });
        store[agentId] = heartbeatRecord.heartbeat;
        saveHeartbeats(store);
        writePresenceFile(agentId, store[agentId]);
        writeRouteLeaseFile(agentId, store[agentId], "tap_session_warmup");
      } finally {
        releaseLock(HEARTBEATS_LOCK);
      }
      writeMcpJsonAgentName(effectiveName);
      warmupNotes.push(`identity=set(${effectiveName})`);
    } else {
      warmupNotes.push(`identity=confirmed(${effectiveName})`);
    }

    let capabilityText: string | null = null;
    if (hasCapabilityRegistrationArgs(rawArgs)) {
      const capabilityResult = await handleRegisterCapabilities(
        {
          receiveTransports: rawArgs.receiveTransports,
          conversationId: rawArgs.conversationId,
          ownerClientId: rawArgs.ownerClientId,
        },
        HEARTBEATS_LOCK,
      );
      capabilityText = capabilityResult.content[0]?.text ?? null;
    }

    if (!acquireLock(HEARTBEATS_LOCK)) {
      return {
        content: [{ type: "text", text: "Heartbeat store busy, try again." }],
      };
    }
    try {
      const store = loadHeartbeats();
      const existing = store[agentId];
      const heartbeatRecord = buildHeartbeatRecord({
        agentId,
        agentName: effectiveName,
        status,
        existing,
        timestamp: new Date().toISOString(),
        lastActivity: getLastActivityTime(),
        joinedAt: existing?.joinedAt,
      });
      store[agentId] = heartbeatRecord.heartbeat;
      saveHeartbeats(store);
      writePresenceFile(agentId, store[agentId]);
      writeRouteLeaseFile(agentId, store[agentId], "tap_session_warmup");
      dbUpsertHeartbeat(agentId, status, getLastActivityTime());
    } finally {
      releaseLock(HEARTBEATS_LOCK);
    }

    if (effectiveName && effectiveName !== "unknown") {
      if (status === "signing-off") {
        releaseClaim(effectiveName, resolveClaimInstanceId(), process.pid);
      } else {
        renewClaimTTL(effectiveName, resolveClaimInstanceId(), process.pid);
      }
    }

    const agents = buildWhoAgents(loadHeartbeats(), minutes);
    const self =
      agents.find((agent) => agent.id === agentId) ??
      agents.find((agent) => agent.agent === effectiveName) ??
      null;

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              ok: true,
              agent: effectiveName,
              agentId,
              status,
              notes: warmupNotes,
              capabilities: capabilityText,
              who: {
                minutes,
                onlineCount: agents.length,
                self,
              },
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  // ── tap_reply ─────────────────────────────────────────────────────
  if (req.params.name === "tap_reply" || req.params.name === "tap_reply_v2") {
    const isV2 = req.params.name === "tap_reply_v2";
    const {
      to: rawTo,
      target: rawTarget,
      subject: rawSubject,
      content,
      cc: rawCc,
      scope: rawScope,
      action: rawAction,
      consentRef: rawConsentRef,
      dryRun: rawDryRun,
    } = req.params.arguments as {
      to?: string;
      target?: TapStructuredRecipientTarget;
      subject: string;
      content: string;
      cc?: string | string[];
      scope?: TapEnvelopeScope;
      action?: string;
      consentRef?: string;
      dryRun?: boolean;
    };
    const routeTarget = rawTarget ? normalizeStructuredTarget(rawTarget) : null;
    const scope = rawScope ?? null;
    const action = rawAction?.trim() || null;
    const consentRef = rawConsentRef?.trim() || null;
    const dryRun = rawDryRun === true;
    const explicitTo = typeof rawTo === "string" ? rawTo.trim() : "";
    const rawRecipientAddress = routeTarget?.routingAddress ?? rawTo ?? "";

    // M142: Validate required fields
    const to =
      typeof rawRecipientAddress === "string" ? rawRecipientAddress.trim() : "";
    const subject = typeof rawSubject === "string" ? rawSubject.trim() : "";
    if (!to) {
      return {
        content: [
          {
            type: "text",
            text: isV2
              ? 'Rejected: "target.routingAddress" is required and must be a non-empty string.'
              : 'Rejected: "to" is required and must be a non-empty string.',
          },
        ],
      };
    }
    if (rawTarget != null && !routeTarget) {
      return {
        content: [
          {
            type: "text",
            text: 'Rejected: "target.routingAddress" is required and must be a non-empty string.',
          },
        ],
      };
    }
    if (
      explicitTo &&
      routeTarget &&
      !sameRoutingAddress(explicitTo, routeTarget.routingAddress)
    ) {
      return {
        content: [
          {
            type: "text",
            text: 'Rejected: "to" and "target.routingAddress" disagree; pass only one target form or make them match.',
          },
        ],
      };
    }
    if (!subject) {
      return {
        content: [
          {
            type: "text",
            text: 'Rejected: "subject" is required and must be a non-empty string.',
          },
        ],
      };
    }

    if (
      isV2 ||
      routeTarget ||
      scope != null ||
      action != null ||
      consentRef != null
    ) {
      const metadataError = validateStructuredEnvelopeMetadata({
        target: routeTarget,
        scope,
        action,
        consentRef,
      });
      if (metadataError) {
        return {
          content: [
            {
              type: "text",
              text: `Rejected: ${metadataError}`,
            },
          ],
        };
      }
    }

    const cc = normalizeRecipientList(rawCc, [to]);

    type ResolvedRecipient = {
      original: string;
      target: string;
      routingTarget: string;
      displayName: string | null;
      found: boolean;
      warning: string | null;
      address: TapAddressMetadata | null;
      receiveTransports: string[];
      ambiguous: boolean;
    };

    const recipientWarnings: string[] = [];
    const towerName = loadTowerNameFromConfig();
    const remoteAgents = loadRemoteAgents();
    const store = loadHeartbeats();
    const knownAgents = new Set<string>();
    const claimedNames = new Set(getClaimedNames());
    const replyableRecipients = getRecentReplyableRecipients();
    const replyableSenders = new Set(replyableRecipients.keys());
    const knownInstanceIds = new Set<string>();
    for (const [key, hb] of Object.entries(store)) {
      if (!isPlaceholderAgentValue(key)) knownAgents.add(key);
      if (!isPlaceholderAgentValue(hb.agent)) {
        knownAgents.add(hb.agent); // display name (exclude placeholders)
      }
      const instanceId = hb.instanceId?.trim() || null;
      if (instanceId && !isPlaceholderAgentValue(instanceId)) {
        knownAgents.add(instanceId);
        knownInstanceIds.add(instanceId);
      }
    }
    // M294: Include comms-level claims registry (covers offline/not-yet-started agents)
    for (const name of claimedNames) {
      knownAgents.add(name);
    }
    // M327: cross-device inbox sync carries append-only message files but not
    // mutable presence state (heartbeats/.claims). A sender who has already
    // delivered a message to this agent is safe to reply to even if their
    // heartbeat has not synced into the local roster yet.
    for (const sender of replyableSenders) {
      knownAgents.add(sender);
    }
    for (const slot of TAP_ROUTING_SLOTS) {
      knownAgents.add(slot);
    }
    const stateInstances = loadStateInstances();
    for (const instanceId of Object.keys(stateInstances ?? {})) {
      if (isPlaceholderAgentValue(instanceId)) continue;
      knownAgents.add(instanceId);
      knownInstanceIds.add(instanceId);
    }
    const knownList = [...knownAgents]
      .filter((n) => n !== "unknown")
      .join(", ");

    function resolveRecipient(recipient: string): ResolvedRecipient {
      const resolution = resolvePreferredRecipient(store, recipient);
      if (resolution.found) {
        return {
          original: recipient,
          target: resolution.target,
          routingTarget: resolution.routingTarget,
          displayName: resolution.displayName,
          found: true,
          warning: resolution.warning,
          address: resolution.address,
          receiveTransports: resolution.receiveTransports,
          ambiguous: resolution.ambiguous,
        };
      }
      if (resolution.ambiguous) {
        return {
          original: recipient,
          target: recipient,
          routingTarget: recipient,
          displayName: null,
          found: false,
          warning: resolution.warning,
          address: null,
          receiveTransports: [],
          ambiguous: true,
        };
      }

      // M294: Fall back to comms-level claims registry — covers offline/not-yet-started agents
      if (claimedNames.has(recipient)) {
        return {
          original: recipient,
          target: recipient,
          routingTarget: recipient,
          displayName: recipient,
          found: true,
          warning: `⚠️ "${recipient}" found in claims registry but not in active heartbeats. Message will be delivered when agent starts.`,
          address: null,
          receiveTransports: [],
          ambiguous: false,
        };
      }

      const replyableRecipient = resolveMatchingStableTarget(
        recipient,
        replyableRecipients.keys(),
      );
      if (replyableRecipient) {
        const routingTarget =
          replyableRecipients.get(replyableRecipient) ?? replyableRecipient;
        return {
          original: recipient,
          target: routingTarget,
          routingTarget,
          displayName: sameRoutingAddress(replyableRecipient, routingTarget)
            ? null
            : replyableRecipient,
          found: true,
          warning:
            `⚠️ "${recipient}" matched a recent inbound sender ` +
            `(stored as "${routingTarget}", not in local heartbeats). ` +
            "Message will be delivered via inbox sync.",
          address: null,
          receiveTransports: [],
          ambiguous: false,
        };
      }

      const stableSlot = normalizeRoutingSlot(recipient);
      if (stableSlot) {
        return {
          original: recipient,
          target: stableSlot,
          routingTarget: stableSlot,
          displayName: null,
          found: true,
          warning: null,
          address: null,
          receiveTransports: [],
          ambiguous: false,
        };
      }

      const stableInstance = resolveMatchingStableTarget(
        recipient,
        knownInstanceIds,
      );
      if (stableInstance) {
        return {
          original: recipient,
          target: stableInstance,
          routingTarget: stableInstance,
          displayName: null,
          found: true,
          warning:
            `⚠️ "${recipient}" matched instance "${stableInstance}" ` +
            "but is not in active heartbeats. Message will be delivered when that instance resumes.",
          address: null,
          receiveTransports: [],
          ambiguous: false,
        };
      }

      // M310: Fall back to known remote agents — cross-machine routing via comms sync.
      // Remote agents (tower + configured remoteAgents) are trusted even without
      // local heartbeats. The message file is written to comms dir and delivered
      // when the remote machine syncs (git pull).
      const remoteTarget = resolveMatchingStableTarget(recipient, remoteAgents);
      if (remoteTarget) {
        return {
          original: recipient,
          target: remoteTarget,
          routingTarget: remoteTarget,
          displayName: null,
          found: true,
          warning:
            `⚠️ Routed "${recipient}" as remote agent ` +
            `(stored as "${remoteTarget}", not in local heartbeats). ` +
            "Message will be delivered via comms sync.",
          address: null,
          receiveTransports: [],
          ambiguous: false,
        };
      }

      return {
        original: recipient,
        target: recipient,
        routingTarget: recipient,
        displayName: null,
        found: false,
        warning:
          `⚠️ WARNING: "${recipient}" is not a known agent. ` +
          `Check spelling. Known: ${knownList}`,
        address: null,
        receiveTransports: [],
        ambiguous: false,
      };
    }

    const resolvedTower = towerName ? resolveRecipient(towerName) : null;
    const resolvedTowerId = resolvedTower?.routingTarget ?? "tower";
    let primaryRecipient: ResolvedRecipient = {
      original: to,
      target: to,
      routingTarget: to,
      displayName: null,
      found: true,
      warning: null,
      address: null,
      receiveTransports: [],
      ambiguous: false,
    };
    if (!isBroadcastRecipient(to)) {
      const resolution = routeTarget
        ? (() => {
            const structured = resolveStructuredRecipient(store, routeTarget);
            return {
              original: to,
              target: structured.target,
              routingTarget: structured.routingTarget,
              displayName: structured.displayName,
              found: structured.found,
              warning: structured.warning,
              address: structured.address,
              receiveTransports: structured.receiveTransports,
              ambiguous: structured.ambiguous,
            } satisfies ResolvedRecipient;
          })()
        : resolveRecipient(to);
      if (!resolution.found) {
        // M294: Block DM to unknown agents — prevents message leaking to wrong recipients
        const structuredDetail =
          routeTarget && resolution.warning ? ` ${resolution.warning}` : "";
        const simpleDetail = resolution.warning
          ? ` ${resolution.warning}`
          : ` Known agents: ${knownList || "(none)"}`;
        return {
          content: [
            {
              type: "text",
              text: routeTarget
                ? `Rejected: structured target "${to}" did not match a live recipient with the requested address constraints. Message NOT sent to prevent misrouting.${structuredDetail}`
                : `Rejected: "${to}" is not a known or unambiguous agent. Message NOT sent to prevent DM routing leak.${simpleDetail}`,
            },
          ],
        };
      }
      primaryRecipient = resolution;
      if (resolution.warning) recipientWarnings.push(resolution.warning);
    }

    // M294: Filter out unknown CC recipients to prevent leak
    const validCc: ResolvedRecipient[] = [];
    if (cc?.length) {
      for (const recipient of cc) {
        if (isBroadcastRecipient(recipient)) {
          validCc.push({
            original: recipient,
            target: recipient,
            routingTarget: recipient,
            displayName: null,
            found: true,
            warning: null,
            address: null,
            receiveTransports: [],
            ambiguous: false,
          });
          continue;
        }
        const resolution = resolveRecipient(recipient);
        if (!resolution.found) {
          recipientWarnings.push(
            resolution.warning
              ? resolution.warning.replace(
                  `alias "${recipient}"`,
                  `CC alias "${recipient}"`,
                )
              : `⚠️ CC "${recipient}" is not a known agent — skipped. Known: ${knownList}`,
          );
        } else {
          validCc.push(resolution);
          if (resolution.warning) {
            recipientWarnings.push(
              resolution.warning.replace(`"${recipient}"`, `CC "${recipient}"`),
            );
          }
        }
      }
    }

    const now = new Date();
    const nowMs = now.getTime();
    const date = now.toISOString().slice(0, 10).replace(/-/g, "");
    const fromId = getAgentRoutingAddress();
    const fromName = getAgentName();
    const fromFileLabel = resolveFileLabel(fromName, fromId);
    const rateLimitRoutes = new Map<string, PeerDmRoute>();
    const primaryRoute: PeerDmRoute = {
      fromId,
      fromName,
      to,
      resolvedTo: primaryRecipient.routingTarget,
      towerName,
      towerId: resolvedTowerId,
    };
    const primaryCheck = checkPeerDmRateLimit(
      peerDmHistory,
      primaryRoute,
      nowMs,
    );
    if (!primaryCheck.exempt && primaryCheck.key) {
      rateLimitRoutes.set(primaryCheck.key, primaryRoute);
    }

    for (const recipient of validCc ?? []) {
      const route: PeerDmRoute = {
        fromId,
        fromName,
        to: recipient.original,
        resolvedTo: recipient.routingTarget,
        towerName,
        towerId: resolvedTowerId,
      };
      const check = checkPeerDmRateLimit(peerDmHistory, route, nowMs);
      if (check.exempt || !check.key) continue;
      rateLimitRoutes.set(check.key, route);
    }

    for (const route of rateLimitRoutes.values()) {
      const check = checkPeerDmRateLimit(peerDmHistory, route, nowMs);
      if (!check.allowed) {
        return {
          content: [
            {
              type: "text",
              text:
                `Rate limited: too many messages between ${fromId}→${check.target}. ` +
                "Route through tower instead.",
            },
          ],
        };
      }
    }

    const messageId = randomUUID();
    const identitySnapshot = getAgentIdentitySnapshot();
    const primaryToName =
      primaryRecipient.displayName ??
      (!sameRoutingAddress(to, primaryRecipient.routingTarget) ? to : null);
    const primaryFileLabel = resolveFileLabel(
      primaryToName,
      primaryRecipient.routingTarget,
    );
    const baseFilename = `${date}-${fromFileLabel}-${primaryFileLabel}-${subject}.md`;
    const ccHeader = cc?.length ? `> CC: ${cc.join(", ")}\n\n` : "";
    const frontmatter = buildInboxFrontmatter({
      from: fromId,
      fromName,
      to: primaryRecipient.routingTarget,
      toName: primaryToName,
      subject,
      sentAt: now.toISOString(),
      messageId,
      fromAddress: identitySnapshot.address,
      toAddress: buildEnvelopeAddress({
        explicit: routeTarget,
        resolved: primaryRecipient.address,
        fallbackRoutingAddress: primaryRecipient.routingTarget,
        displayName: primaryToName,
      }),
      scope,
      action,
      consentRef,
    });
    const sent: string[] = [];
    const dryRunEvidence = resolveInboxEvidenceCandidate(baseFilename);
    let filename = dryRunEvidence.filename;
    let primaryInboxPath = dryRunEvidence.inboxPath;

    if (!dryRun) {
      const evidence = writePrimaryInboxEvidence({
        filename: baseFilename,
        body: frontmatter + ccHeader + content,
        fromId,
        to: primaryRecipient.routingTarget,
        subject,
      });
      if (!evidence.ok) {
        return {
          content: [
            {
              type: "text",
              text:
                `Failed to send to ${to}: durable inbox evidence write failed ` +
                `(${evidence.error}). Live delivery was not attempted.`,
            },
          ],
        };
      }
      filename = evidence.filename;
      primaryInboxPath = evidence.inboxPath;
      for (const route of rateLimitRoutes.values()) {
        recordPeerDm(peerDmHistory, route, nowMs);
      }
    }

    const autoRouteResult =
      !isBroadcastRecipient(to) && primaryRecipient.found
        ? await routeTapReplyDelivery({
            commsDir: process.env.TAP_COMMS_DIR,
            localHostId: identitySnapshot.address.hostId,
            explicitEnvelope:
              scope != null || action != null || consentRef != null,
            sender: {
              routingAddress: fromId,
              displayName: fromName,
            },
            target: {
              routingAddress: primaryRecipient.routingTarget,
              displayName: primaryToName,
              address: primaryRecipient.address,
              receiveTransports: primaryRecipient.receiveTransports,
              ambiguous: primaryRecipient.ambiguous,
            },
            subject,
            content,
            fileName: filename,
            heartbeats: store,
            dryRun,
          })
        : null;
    const autoRouteWarning = autoRouteResult?.warning ?? null;
    const isStructuredRoute =
      routeTarget != null ||
      scope != null ||
      action != null ||
      consentRef != null;
    if (
      autoRouteWarning &&
      shouldSurfaceTapReplyRoutingWarning({
        warning: autoRouteWarning,
        fallbackToInbox: autoRouteResult?.fallbackToInbox ?? false,
        structured: isStructuredRoute,
      })
    ) {
      recipientWarnings.push(autoRouteWarning);
    }

    if (dryRun) {
      const primaryTransport =
        autoRouteResult?.transport === "consent-drive" &&
        !autoRouteResult.fallbackToInbox
          ? "consent-drive"
          : primaryRecipient.receiveTransports.includes("polling")
            ? "polling"
            : primaryRecipient.receiveTransports.includes("mcp-channel")
              ? "mcp-channel"
              : "inbox";
      sent.push(
        `Dry run to ${to}: would use ${primaryTransport} ` +
          `with inbox evidence ${primaryInboxPath}`,
      );
      if (isStructuredRoute && autoRouteResult) {
        sent.push(
          formatTapReplyRouteDiagnostic({
            ...autoRouteResult,
            dryRun,
            inboxPath: primaryInboxPath,
          }),
        );
      }
      if (cc?.length) {
        for (const recipient of validCc ?? []) {
          sent.push(`Dry run CC to ${recipient.original}: would write inbox`);
        }
      }
      sent.push("Dry run: no inbox files written and no Codex turn started.");
      sent.push(...recipientWarnings);
      return { content: [{ type: "text", text: sent.join("\n") }] };
    }

    const primaryDeliveredLive =
      autoRouteResult?.transport === "consent-drive" &&
      !autoRouteResult.fallbackToInbox;
    if (primaryDeliveredLive) {
      sent.push(
        `Sent to ${to} via consent-drive` +
          (autoRouteResult.turnId ? ` (turn ${autoRouteResult.turnId})` : "") +
          `; inbox evidence ${primaryInboxPath}`,
      );
    } else {
      sent.push(`Sent to ${to}: ${filename}`);
    }
    if (isStructuredRoute && autoRouteResult) {
      sent.push(
        formatTapReplyRouteDiagnostic({
          ...autoRouteResult,
          inboxPath: primaryInboxPath,
        }),
      );
    }
    writeHeadlessReplyReceipt({
      messageId,
      from: fromId,
      fromName,
      to: primaryRecipient.routingTarget,
      toName: primaryToName,
      subject,
      fileName: filename,
      inboxPath: primaryInboxPath,
      transport: primaryDeliveredLive
        ? (autoRouteResult?.transport ?? "consent-drive")
        : "inbox",
      fallbackToInbox: autoRouteResult?.fallbackToInbox ?? true,
      turnId: autoRouteResult?.turnId ?? null,
      consentRef: autoRouteResult?.consentRef ?? null,
    });

    if (cc?.length) {
      const writtenFiles = new Set<string>([filename]); // Track to prevent overwrite/duplicate primary delivery
      for (const recipient of validCc ?? []) {
        try {
          const ccToName =
            recipient.displayName ??
            (!sameRoutingAddress(recipient.original, recipient.routingTarget)
              ? recipient.original
              : null);
          const ccFileLabel = resolveFileLabel(
            ccToName,
            recipient.routingTarget,
          );
          const ccFilename = `${date}-${fromFileLabel}-${ccFileLabel}-${subject}.md`;
          // Skip if resolved filename matches primary or already written CC
          if (writtenFiles.has(ccFilename)) {
            sent.push(
              `CC to ${recipient.original}: skipped (resolves to same target)`,
            );
            continue;
          }
          writtenFiles.add(ccFilename);
          const ccFrontmatter = buildInboxFrontmatter({
            from: fromId,
            fromName,
            to: recipient.routingTarget,
            toName: ccToName,
            subject,
            sentAt: now.toISOString(),
            messageId,
            fromAddress: identitySnapshot.address,
            toAddress: buildEnvelopeAddress({
              resolved: recipient.address,
              fallbackRoutingAddress: recipient.routingTarget,
              displayName: ccToName,
            }),
            scope,
            action,
            consentRef,
          });
          writeFileSync(
            join(INBOX_DIR, ccFilename),
            ccFrontmatter + `> CC from message to ${to}\n\n${content}`,
            "utf-8",
          );
          dbInsertMessage(
            ccFilename,
            fromId,
            recipient.routingTarget,
            subject,
            "inbox",
            Date.now(),
          );
          sent.push(`CC to ${recipient.original}: ${ccFilename}`);
        } catch (err) {
          sent.push(
            `CC to ${recipient.original}: FAILED (${err instanceof Error ? err.message : String(err)})`,
          );
        }
      }
    }
    // Append warnings after delivery (still send — warning only, not blocking)
    sent.push(...recipientWarnings);
    return { content: [{ type: "text", text: sent.join("\n") }] };
  }

  // ── tap_broadcast ─────────────────────────────────────────────────
  if (req.params.name === "tap_broadcast") {
    const { subject, content } = req.params.arguments as {
      subject: string;
      content: string;
    };
    const now = new Date();
    const date = now.toISOString().slice(0, 10).replace(/-/g, "");
    const broadcastId = getAgentRoutingAddress();
    const broadcastName = getAgentName();
    const filename = `${date}-${resolveFileLabel(broadcastName, broadcastId)}-전체-${subject}.md`;
    const broadcastMessageId = randomUUID();
    const broadcastFrontmatter = buildInboxFrontmatter({
      from: broadcastId,
      fromName: broadcastName,
      to: "전체",
      subject,
      sentAt: now.toISOString(),
      messageId: broadcastMessageId,
    });
    writeFileSync(
      join(INBOX_DIR, filename),
      broadcastFrontmatter + content,
      "utf-8",
    );
    dbInsertMessage(
      filename,
      broadcastId,
      "전체",
      subject,
      "inbox",
      Date.now(),
    );
    return { content: [{ type: "text", text: `Broadcast sent: ${filename}` }] };
  }

  // ── tap_list_unread ───────────────────────────────────────────────
  if (req.params.name === "tap_list_unread") {
    const unread = getUnreadItems((req.params.arguments as any) || {});
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            { agent: getAgentName(), count: unread.length, items: unread },
            null,
            2,
          ),
        },
      ],
    };
  }

  // ── tap_read_receipt ──────────────────────────────────────────────
  if (req.params.name === "tap_read_receipt") {
    const { filename } = req.params.arguments as { filename: string };
    ensureReceiptsDir();
    if (!acquireLock(RECEIPTS_LOCK)) {
      return {
        content: [{ type: "text", text: "Receipt store busy, try again." }],
      };
    }
    try {
      const store = loadReceipts();
      const inboxPath = join(INBOX_DIR, filename);
      if (!existsSync(inboxPath)) {
        return {
          content: [
            {
              type: "text",
              text: `Inbox file not found: ${filename}`,
            },
          ],
        };
      }

      const content = stripBom(readFileSync(inboxPath, "utf-8"));
      const receiptKey =
        getDurableReceiptKeys(filename, content)[0] ?? filename;
      if (!store[receiptKey]) store[receiptKey] = [];
      const readerId = getAgentId();
      const already = store[receiptKey].some((r) => r.reader === readerId);
      if (!already) {
        const ts = new Date().toISOString();
        store[receiptKey].push({ reader: readerId, timestamp: ts });
        saveReceipts(store);
        dbInsertReceipt(filename, readerId, ts);
      }
      return {
        content: [
          {
            type: "text",
            text: already
              ? `Already acknowledged: ${filename}`
              : `Read receipt saved for: ${filename}`,
          },
        ],
      };
    } finally {
      releaseLock(RECEIPTS_LOCK);
    }
  }

  // ── M194: HUD formatter ──────────────────────────────────────────
  function buildHudLine(): string {
    const hbStore = loadHeartbeats();
    const agentCount = buildWhoAgents(hbStore, 10).filter(
      (agent) => agent.alive,
    ).length;

    // Unread count — use getUnreadItems with markRead=false for accurate semantics
    // (respects joinedAt, durable receipts, processed markers, readFiles, isForMe)
    const unreadItems = getUnreadItems({
      sources: ["inbox"],
      limit: 100,
      includeContent: false,
      markRead: false,
    });
    // getUnreadItems clamps at 100 — display "99+" if at limit
    const unreadCount = unreadItems.length;
    const unreadDisplay = unreadCount >= 100 ? "99+" : String(unreadCount);

    // Status emoji
    const status = agentCount > 0 ? "🟢" : "⚪";

    return `[tap] ${status} ${agentCount} agents | 📨 ${unreadDisplay} unread`;
  }

  // ── tap_stats ─────────────────────────────────────────────────────
  if (req.params.name === "tap_stats") {
    const hours =
      typeof (req.params.arguments as any)?.hours === "number"
        ? (req.params.arguments as any).hours
        : 24;
    const cutoff = Date.now() - hours * 60 * 60 * 1000;

    const hud = buildHudLine();

    // DB fast path
    const dbResult = dbGetStats(cutoff);
    if (dbResult) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              { hours, ...dbResult, source: "sqlite", hud },
              null,
              2,
            ),
          },
        ],
      };
    }

    // File fallback
    const sent: Record<string, number> = {};
    const received: Record<string, number> = {};
    let broadcasts = 0;
    if (existsSync(INBOX_DIR)) {
      for (const filename of readdirSync(INBOX_DIR)) {
        if (!filename.endsWith(".md")) continue;
        try {
          if (statSync(join(INBOX_DIR, filename)).mtimeMs < cutoff) continue;
        } catch {
          continue;
        }
        const parsed = parseFilename(filename);
        if (!parsed) continue;
        sent[parsed.from] = (sent[parsed.from] || 0) + 1;
        if (isBroadcastRecipient(parsed.to)) broadcasts++;
        else received[parsed.to] = (received[parsed.to] || 0) + 1;
      }
    }
    const receipts = loadReceipts();
    const cutoffISO = new Date(cutoff).toISOString();
    const receiptCount = Object.values(receipts).reduce(
      (sum, arr) => sum + arr.filter((r) => r.timestamp >= cutoffISO).length,
      0,
    );
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              hours,
              sent,
              received,
              broadcasts,
              totalReceipts: receiptCount,
              hud,
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  // ── tap_heartbeat ─────────────────────────────────────────────────
  if (req.params.name === "tap_heartbeat") {
    const status =
      ((req.params.arguments as any)?.status as
        | "active"
        | "idle"
        | "signing-off") || "active";
    const hbId = getAgentId();
    const hbName = getAgentName();
    if (!acquireLock(HEARTBEATS_LOCK)) {
      return {
        content: [{ type: "text", text: "Heartbeat store busy, try again." }],
      };
    }
    try {
      const store = loadHeartbeats();
      const existing = store[hbId];
      const heartbeatRecord = buildHeartbeatRecord({
        agentId: hbId,
        agentName: hbName,
        status,
        existing,
        timestamp: new Date().toISOString(),
        lastActivity: getLastActivityTime(),
        joinedAt: existing?.joinedAt,
      });
      store[hbId] = heartbeatRecord.heartbeat;
      saveHeartbeats(store);
      // M334: Write per-agent presence file for cross-device visibility
      writePresenceFile(hbId, store[hbId]);
      dbUpsertHeartbeat(hbId, status, getLastActivityTime());
    } finally {
      releaseLock(HEARTBEATS_LOCK);
    }

    // M221: Renew claim TTL on heartbeat, release on signing-off
    // Pass ownership (instanceId + pid) to prevent cross-instance interference
    if (hbName && hbName !== "unknown") {
      const hbInstanceId = resolveClaimInstanceId();
      if (status === "signing-off") {
        releaseClaim(hbName, hbInstanceId, process.pid);
      } else {
        renewClaimTTL(hbName, hbInstanceId, process.pid);
      }
    }

    return {
      content: [
        {
          type: "text",
          text: `Heartbeat sent: ${hbName} [${hbId}] (${status})`,
        },
      ],
    };
  }

  // ── tap_who ───────────────────────────────────────────────────────
  if (req.params.name === "tap_who") {
    const minutes =
      typeof (req.params.arguments as any)?.minutes === "number"
        ? (req.params.arguments as any).minutes
        : POLLING_RECIPIENT_VISIBILITY_MINUTES;
    const store = loadHeartbeats();
    const agents = buildWhoAgents(store, minutes);

    // M353: emit a slot-collision audit record whenever `tap_who` surfaces a
    // stale-by-newer entry. The writer dedupes per (UTC day, slot, pair) so
    // steady-state drift produces one record per day, not one per poll.
    const bySlot = new Map<string, typeof agents>();
    for (const agent of agents) {
      if (!agent.slot) continue;
      const group = bySlot.get(agent.slot);
      if (group) group.push(agent);
      else bySlot.set(agent.slot, [agent]);
    }
    for (const [slot, group] of bySlot) {
      const winner = group.find((a) => a.slotStatus === "active");
      if (!winner) continue;
      for (const loser of group) {
        if (loser.slotStatus !== "stale-by-newer") continue;
        writeSlotCollisionAudit({
          slot,
          winner: {
            agentId: winner.id,
            displayName: winner.agent,
            instanceId: winner.instanceId,
            lastActivity: winner.lastActivity,
            source: winner.source,
            presence: winner.presence,
            hostId: winner.address.hostId ?? null,
          },
          loser: {
            agentId: loser.id,
            displayName: loser.agent,
            instanceId: loser.instanceId,
            lastActivity: loser.lastActivity,
            source: loser.source,
            presence: loser.presence,
            hostId: loser.address.hostId ?? null,
          },
        });
      }
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ onlineCount: agents.length, agents }, null, 2),
        },
      ],
    };
  }

  // ── tap_db_sync ───────────────────────────────────────────────────
  if (req.params.name === "tap_db_sync") {
    const result = dbSyncAll();
    if (!result)
      return {
        content: [{ type: "text", text: "SQLite not available. Cannot sync." }],
      };
    return {
      content: [
        {
          type: "text",
          text: `DB sync complete: ${result.messages} messages, ${result.heartbeats} heartbeats, ${result.receipts} receipts`,
        },
      ],
    };
  }

  // ── tap_cleanup ───────────────────────────────────────────────────
  if (req.params.name === "tap_cleanup") {
    const days =
      typeof (req.params.arguments as any)?.days === "number"
        ? (req.params.arguments as any).days
        : 7;
    const dryRun = (req.params.arguments as any)?.dryRun === true;
    const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const cutoffStr =
      cutoffDate.getFullYear().toString() +
      (cutoffDate.getMonth() + 1).toString().padStart(2, "0") +
      cutoffDate.getDate().toString().padStart(2, "0");
    const moved: string[] = [];
    if (!existsSync(ARCHIVE_DIR)) mkdirSync(ARCHIVE_DIR, { recursive: true });
    if (existsSync(INBOX_DIR)) {
      for (const filename of readdirSync(INBOX_DIR)) {
        if (!filename.endsWith(".md")) continue;
        // Parse date from filename: YYYYMMDD-from-to-subject.md
        const dateMatch = filename.match(/^(\d{8})-/);
        if (!dateMatch) continue;
        if (dateMatch[1] >= cutoffStr) continue; // not old enough
        const filepath = join(INBOX_DIR, filename);
        if (!dryRun) renameSync(filepath, join(ARCHIVE_DIR, filename));
        moved.push(filename);
      }
    }
    return {
      content: [
        {
          type: "text",
          text: dryRun
            ? `[DRY RUN] Would archive ${moved.length} files older than ${days} days (filename date).`
            : `Archived ${moved.length} files older than ${days} days to archive/ (filename date).`,
        },
      ],
    };
  }

  // ── tap_onboard ──────────────────────────────────────────────────
  if (req.params.name === "tap_onboard") {
    const commsDir = process.env.TAP_COMMS_DIR;
    if (!commsDir) {
      return {
        content: [
          {
            type: "text",
            text: "TAP_COMMS_DIR not set. Cannot load onboarding docs.",
          },
        ],
      };
    }

    // Idempotent marker — agent-scoped onboarding tracker
    const stateDir = process.env.TAP_STATE_DIR;
    const agentId = getAgentId();
    let alreadyOnboarded = false;
    let markerStore: Record<string, { onboardedAt: string }> = {};
    const markerPath = stateDir ? join(stateDir, "onboarded.json") : null;
    if (markerPath) {
      try {
        if (existsSync(markerPath)) {
          markerStore = JSON.parse(readFileSync(markerPath, "utf-8"));
          if (markerStore[agentId]) {
            alreadyOnboarded = true;
          }
        }
      } catch {
        // best-effort
      }
    }

    const onboardingDir = join(commsDir, "onboarding");
    if (!existsSync(onboardingDir)) {
      return {
        content: [
          {
            type: "text",
            text: "No onboarding directory found at " + onboardingDir,
          },
        ],
      };
    }

    const docs: string[] = [];
    const allFiles = readdirSync(onboardingDir).filter((f: string) =>
      f.endsWith(".md"),
    );

    // welcome.md always first, then alphabetical
    const files = [
      ...allFiles.filter((f: string) => f === "welcome.md"),
      ...allFiles.filter((f: string) => f !== "welcome.md").sort(),
    ];

    for (const file of files) {
      try {
        const content = readFileSync(join(onboardingDir, file), "utf-8");
        docs.push(`# ${file}\n\n${content}`);
      } catch {
        docs.push(`# ${file}\n\n(failed to read)`);
      }
    }

    if (docs.length === 0) {
      return {
        content: [{ type: "text", text: "Onboarding directory is empty." }],
      };
    }

    // Write agent-scoped onboarded marker
    if (markerPath && !alreadyOnboarded) {
      try {
        markerStore[agentId] = { onboardedAt: new Date().toISOString() };
        writeFileSync(
          markerPath,
          JSON.stringify(markerStore, null, 2),
          "utf-8",
        );
      } catch {
        // best-effort
      }
    }

    const prefix = alreadyOnboarded
      ? "(You have already been onboarded. Showing docs again for reference.)\n\n"
      : "";

    return {
      content: [{ type: "text", text: prefix + docs.join("\n\n---\n\n") }],
    };
  }

  // ── tap_identity_probe ──────────────────────────────────────────
  if (req.params.name === "tap_identity_probe") {
    const rawArgs = ((req.params.arguments as
      | Record<string, unknown>
      | undefined) ?? {}) as Record<string, unknown>;
    const testName =
      typeof rawArgs.testName === "string" ? rawArgs.testName : null;
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              ...buildAgentIdentityProbeSnapshot(testName),
              mcpSession: getMcpSessionSnapshot(),
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  // ── tap_create_consent_receipt ─────────────────────────────────
  if (req.params.name === "tap_create_consent_receipt") {
    const rawArgs = ((req.params.arguments as
      | Record<string, unknown>
      | undefined) ?? {}) as Record<string, unknown>;
    if (typeof rawArgs.pairToken !== "undefined") {
      return {
        content: [
          {
            type: "text",
            text: "Rejected: tap_create_consent_receipt no longer accepts a caller-provided pairToken.",
          },
        ],
      };
    }

    const {
      scope,
      conversationId,
      ownerClientId,
      hostId,
      ttlSeconds,
      allowedMethods,
    } = rawArgs as {
      scope?: TapEnvelopeScope;
      conversationId?: string;
      ownerClientId?: string;
      hostId?: string;
      ttlSeconds?: number;
      allowedMethods?: string[];
    };

    try {
      const identitySnapshot = getAgentIdentitySnapshot();
      const created = createTapConsentReceiptFromIdentity(identitySnapshot, {
        scope,
        conversationId,
        ownerClientId,
        hostId,
        ttlSeconds,
        allowedMethods,
      });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                consentRef: created.receipt.id,
                receipt: created.receipt,
                filePath: created.filePath,
              },
              null,
              2,
            ),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Rejected: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  }

  throw new Error(`unknown tool: ${req.params.name}`);
});

// ── Start ───────────────────────────────────────────────────────────────

await mcp.connect(new StdioServerTransport());
logRoutingRuntimeConflictWarning("startup");

// M221 hotfix: auto-claim bootstrapped name so persisted names are protected
{
  const { isNameConfirmed, getAgentName: bootName } =
    await import("./tap-utils.js");
  if (isNameConfirmed()) {
    const name = bootName();
    if (name && name !== "unknown") {
      const bootInstanceId = resolveClaimInstanceId();
      const bootClaim = claimName(
        name,
        bootInstanceId,
        process.pid,
        "mcp-direct",
      );
      if (bootClaim.success) {
        debug(
          `auto-claimed bootstrapped name: ${name} (instance: ${bootInstanceId})`,
        );
      } else {
        // Demote name so tap_set_name can recover with a different name
        const { demoteAgentName } = await import("./tap-utils.js");
        demoteAgentName();
        debug(
          `WARNING: bootstrapped name "${name}" claimed by ${bootClaim.conflictWith?.instanceId ?? "unknown"} — demoted to unknown, use tap_set_name to pick a new name`,
        );
      }
    }
  }
}

debug(`agent id: ${getAgentId()}, name: ${getAgentName()}`);
debug(`watching inbox: ${INBOX_DIR}`);

watchDir(INBOX_DIR, "inbox", mcp);

const latestReviewDir = getLatestReviewDir();
if (latestReviewDir) {
  debug("watching reviews watcher snapshot", {
    dir: latestReviewDir,
    generation: basename(latestReviewDir),
    mode: "startup-snapshot",
    pollFallbackTracksLatest: true,
  });
  watchDir(latestReviewDir, "reviews", mcp);
} else {
  debug("watching reviews watcher snapshot", {
    dir: null,
    generation: null,
    mode: "startup-snapshot",
    pollFallbackTracksLatest: true,
  });
}

// findings are record-keeping, not real-time comms — no watcher needed.
// Agents read findings on-demand via tap_list_unread(sources: ["findings"]).

// M93: Poll fallback catches messages missed by fs.watch (Windows race, watcher death, etc.)
import { startPollFallback } from "./tap-poll-fallback.js";
startPollFallback(mcp);

process.on("SIGINT", () => process.exit(0));
