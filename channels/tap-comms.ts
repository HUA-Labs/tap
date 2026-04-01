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
} from "@modelcontextprotocol/sdk/types.js";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import {
  isBroadcastRecipient,
  isPlaceholderAgentValue,
  normalizeRecipientList,
} from "./tap-identity.js";

import {
  INBOX_DIR,
  ARCHIVE_DIR,
  RECEIPTS_LOCK,
  HEARTBEATS_LOCK,
  buildHeartbeatConnectHash,
  debug,
  getAgentId,
  getAgentName,
  claimAgentName,
  getRecentSenders,
  getLatestReviewDir,
  getLastActivityTime,
  resolveCurrentInstanceId,
  updateActivityTime,
  parseFilename,
} from "./tap-utils.js";
import {
  claimName,
  renewClaimTTL,
  releaseClaim,
  resolveClaimInstanceId,
} from "./tap-claims.js";
import {
  seedStartupFiles,
  getUnreadItems,
  acquireLock,
  releaseLock,
  ensureReceiptsDir,
  loadReceipts,
  saveReceipts,
  loadHeartbeats,
  saveHeartbeats,
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
import { buildWhoAgents, resolvePreferredRecipient } from "./tap-presence.js";
import { readdirSync, renameSync, statSync, unlinkSync } from "fs";

// ── Initialize ──────────────────────────────────────────────────────────

initDb();
autoSyncOnStartup();

seedStartupFiles("inbox");
seedStartupFiles("reviews");
seedStartupFiles("findings");

// ── Onboarding ─────────────────────────────────────────────────────────

const ONBOARDING_TEASER_LINES = 10;

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
  'You are connected to the tap-comms channel. Messages from other agents may arrive as <channel source="tap-comms" from="X" to="Y" subject="Z"> notifications. If your client does not surface Claude channel notifications, call tap_list_unread to pull pending inbox and review messages. Reply using the tap_reply tool to send messages back to other agents or the control tower.';

const mcp = new Server(
  { name: "tap-comms", version: "0.2.2" },
  {
    capabilities: {
      experimental: { "claude/channel": {} },
      tools: {},
    },
    instructions: baseInstructions + loadOnboardingTeaser(),
  },
);

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
        },
        required: ["name"],
      },
    },
    {
      name: "tap_reply",
      description: "Send a message to another tap agent via comms inbox.",
      inputSchema: {
        type: "object" as const,
        properties: {
          to: { type: "string" as const, description: "Recipient agent name." },
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
        },
        required: ["to", "subject", "content"],
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
            description:
              "Consider agents alive if heartbeat within this many minutes. Default 10.",
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
    const resolvedInstanceId =
      resolveCurrentInstanceId() ?? existing?.instanceId ?? null;
    const connectHash = buildHeartbeatConnectHash(resolvedInstanceId, id);
    const preserveBridgeSource =
      existing?.source === "bridge-dispatch" &&
      existing.connectHash === connectHash;
    store[id] = {
      id,
      agent: name,
      timestamp: existing?.timestamp ?? new Date().toISOString(),
      lastActivity: getLastActivityTime(),
      joinedAt: existing?.joinedAt,
      status: existing?.status ?? "active",
      source: preserveBridgeSource ? "bridge-dispatch" : "mcp-direct",
      instanceId: resolvedInstanceId,
      bridgePid: preserveBridgeSource ? (existing?.bridgePid ?? null) : null,
      connectHash,
    };
    saveHeartbeats(store);
  } catch {
    // Non-critical
  } finally {
    releaseLock(HEARTBEATS_LOCK);
  }
}

// ── Tool Handlers ───────────────────────────────────────────────────────

mcp.setRequestHandler(CallToolRequestSchema, async (req) => {
  updateActivityTime();

  // Auto-persist activity to heartbeat store so tap_who can find us
  // Skip for tap_set_name — handled after name change below
  const currentId = getAgentId();
  const currentName = getAgentName();
  if (currentId !== "unknown" && req.params.name !== "tap_set_name") {
    persistActivity(currentId, currentName);
  }

  // ── tap_set_name ──────────────────────────────────────────────────
  if (req.params.name === "tap_set_name") {
    const { name } = req.params.arguments as { name: string };
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
    const { isNameConfirmed: isConfirmed, getAgentName: currentName } =
      await import("./tap-utils.js");
    if (isConfirmed() && currentName() !== name) {
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

        const resolvedInstanceId =
          resolveCurrentInstanceId() ?? oldEntry?.instanceId ?? null;
        const connectHash = buildHeartbeatConnectHash(
          resolvedInstanceId,
          agentId,
        );
        const preserveBridgeSource =
          oldEntry?.source === "bridge-dispatch" &&
          oldEntry.connectHash === connectHash;
        store[agentId] = {
          id: agentId,
          agent: name,
          timestamp: now,
          lastActivity: getLastActivityTime(),
          joinedAt: oldEntry?.joinedAt ?? now,
          status: "active",
          source: preserveBridgeSource ? "bridge-dispatch" : "mcp-direct",
          instanceId: resolvedInstanceId,
          bridgePid: preserveBridgeSource
            ? (oldEntry?.bridgePid ?? null)
            : null,
          connectHash,
        };

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

        saveHeartbeats(store);
      } catch {
        // Non-critical
      } finally {
        releaseLock(HEARTBEATS_LOCK);
      }
    }

    // Backwrite agentName to state.json so next session bootstraps with it
    const stateDir = process.env.TAP_STATE_DIR;
    if (stateDir) {
      try {
        const statePath = join(stateDir, "state.json");
        if (existsSync(statePath)) {
          const state = JSON.parse(readFileSync(statePath, "utf-8"));
          const instanceKey = agentId.replace(/_/g, "-");
          const instance =
            state.instances?.[agentId] ?? state.instances?.[instanceKey];
          if (instance) {
            instance.agentName = name;
            const tmp = `${statePath}.tmp.${process.pid}`;
            writeFileSync(tmp, JSON.stringify(state, null, 2), "utf-8");
            try {
              renameSync(tmp, statePath);
            } catch {
              // Retry once — Windows may hold file handle briefly
              try {
                renameSync(tmp, statePath);
              } catch {
                try {
                  unlinkSync(tmp);
                } catch {
                  /* best-effort cleanup */
                }
              }
            }
            debug(`backwrite agentName="${name}" to state.json for ${agentId}`);
          }
        }
      } catch {
        // Non-critical — state backwrite is best-effort
      }
    }

    // M111: Notify tower on new agent join (first non-placeholder name)
    if (oldName === "unknown" || oldName === "unnamed") {
      try {
        // Read towerName from tap-config.json (TAP_REPO_ROOT is canonical source)
        const repoRoot = process.env.TAP_REPO_ROOT ?? ".";
        let towerName: string | null = null;
        const cfgPath = join(repoRoot, "tap-config.json");
        if (existsSync(cfgPath)) {
          const cfg = JSON.parse(readFileSync(cfgPath, "utf-8"));
          towerName = cfg.towerName ?? null;
        }

        // Resolve runtime from state.json (works for all runtimes)
        let runtime = process.env.TAP_BRIDGE_RUNTIME ?? null;
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

    let text = `Name set: ${name} (was: ${oldName}). Messages to "${name}", "${agentId}", "전체", or "all" will be received.`;
    if (!wasIdLocked)
      text += `\nAgent ID locked: ${agentId} (immutable for this session)`;
    if (isDuplicate)
      text += `\n⚠️ WARNING: "${name}" was already used in the last 24h. Pick a different name to avoid confusion.`;
    if (activeList) text += `\nRecent active names: ${activeList}`;
    return { content: [{ type: "text", text }] };
  }

  // ── tap_reply ─────────────────────────────────────────────────────
  if (req.params.name === "tap_reply") {
    const {
      to: rawTo,
      subject: rawSubject,
      content,
      cc: rawCc,
    } = req.params.arguments as {
      to: string;
      subject: string;
      content: string;
      cc?: string | string[];
    };

    // M142: Validate required fields
    const to = typeof rawTo === "string" ? rawTo.trim() : "";
    const subject = typeof rawSubject === "string" ? rawSubject.trim() : "";
    if (!to) {
      return {
        content: [
          {
            type: "text",
            text: 'Rejected: "to" is required and must be a non-empty string.',
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
    const cc = normalizeRecipientList(rawCc, [to]);

    const recipientWarnings: string[] = [];
    const store = loadHeartbeats();
    const knownAgents = new Set<string>();
    for (const [key, hb] of Object.entries(store)) {
      if (!isPlaceholderAgentValue(key)) knownAgents.add(key);
      if (!isPlaceholderAgentValue(hb.agent)) {
        knownAgents.add(hb.agent); // display name (exclude placeholders)
      }
    }
    const knownList = [...knownAgents]
      .filter((n) => n !== "unknown")
      .join(", ");

    function resolveRecipient(recipient: string): {
      target: string;
      found: boolean;
      warning: string | null;
    } {
      const resolution = resolvePreferredRecipient(store, recipient);
      if (resolution.found) {
        return {
          target: resolution.target,
          found: true,
          warning: resolution.warning,
        };
      }

      return {
        target: recipient,
        found: false,
        warning:
          `⚠️ WARNING: "${recipient}" is not a known agent. ` +
          `Check spelling. Known: ${knownList}`,
      };
    }

    let resolvedTo = to;
    if (!isBroadcastRecipient(to)) {
      const resolution = resolveRecipient(to);
      if (!resolution.found) {
        if (resolution.warning) recipientWarnings.push(resolution.warning);
      } else {
        resolvedTo = resolution.target;
        if (resolution.warning) recipientWarnings.push(resolution.warning);
      }
    }

    if (cc?.length) {
      for (const recipient of cc) {
        if (isBroadcastRecipient(recipient)) continue;
        const resolution = resolveRecipient(recipient);
        if (resolution.warning) {
          recipientWarnings.push(
            resolution.warning.replace(`"${recipient}"`, `CC "${recipient}"`),
          );
        }
      }
    }

    const now = new Date();
    const date = now.toISOString().slice(0, 10).replace(/-/g, "");
    const fromId = getAgentId();
    const fromName = getAgentName();
    const filename = `${date}-${fromId}-${resolvedTo}-${subject}.md`;
    const filepath = join(INBOX_DIR, filename);
    const ccHeader = cc?.length ? `> CC: ${cc.join(", ")}\n\n` : "";
    const frontmatter = [
      "---",
      "type: inbox",
      `from: ${fromId}`,
      `from_name: ${fromName}`,
      `to: ${resolvedTo}`,
      `to_name: ${to}`,
      `subject: ${subject}`,
      `sent_at: ${now.toISOString()}`,
      "---",
      "",
    ].join("\n");
    writeFileSync(filepath, frontmatter + ccHeader + content, "utf-8");
    dbInsertMessage(
      filename,
      fromName,
      resolvedTo,
      subject,
      "inbox",
      Date.now(),
    );

    const sent = [`Sent to ${to}: ${filename}`];
    if (cc?.length) {
      const writtenFiles = new Set<string>([filename]); // Track to prevent overwrite
      for (const recipient of cc) {
        try {
          const resolvedRecipient = isBroadcastRecipient(recipient)
            ? recipient
            : resolveRecipient(recipient).target;
          const ccFilename = `${date}-${fromId}-${resolvedRecipient}-${subject}.md`;
          // Skip if resolved filename matches primary or already written CC
          if (writtenFiles.has(ccFilename)) {
            sent.push(`CC to ${recipient}: skipped (resolves to same target)`);
            continue;
          }
          writtenFiles.add(ccFilename);
          const ccFrontmatter = [
            "---",
            "type: inbox",
            `from: ${fromId}`,
            `from_name: ${fromName}`,
            `to: ${resolvedRecipient}`,
            `to_name: ${recipient}`,
            `subject: ${subject}`,
            `sent_at: ${now.toISOString()}`,
            "---",
            "",
          ].join("\n");
          writeFileSync(
            join(INBOX_DIR, ccFilename),
            ccFrontmatter + `> CC from message to ${to}\n\n${content}`,
            "utf-8",
          );
          dbInsertMessage(
            ccFilename,
            fromName,
            resolvedRecipient,
            subject,
            "inbox",
            Date.now(),
          );
          sent.push(`CC to ${recipient}: ${ccFilename}`);
        } catch (err) {
          sent.push(
            `CC to ${recipient}: FAILED (${err instanceof Error ? err.message : String(err)})`,
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
    const broadcastId = getAgentId();
    const broadcastName = getAgentName();
    const filename = `${date}-${broadcastId}-전체-${subject}.md`;
    const broadcastFrontmatter = [
      "---",
      "type: inbox",
      `from: ${broadcastId}`,
      `from_name: ${broadcastName}`,
      "to: 전체",
      `subject: ${subject}`,
      `sent_at: ${now.toISOString()}`,
      "---",
      "",
    ].join("\n");
    writeFileSync(
      join(INBOX_DIR, filename),
      broadcastFrontmatter + content,
      "utf-8",
    );
    dbInsertMessage(
      filename,
      broadcastName,
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
      if (!store[filename]) store[filename] = [];
      const readerId = getAgentId();
      const already = store[filename].some((r) => r.reader === readerId);
      if (!already) {
        const ts = new Date().toISOString();
        store[filename].push({ reader: readerId, timestamp: ts });
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
    // (respects joinedAt, startupFiles, readFiles, isForMe)
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
      const resolvedInstanceId =
        resolveCurrentInstanceId() ?? existing?.instanceId ?? null;
      const connectHash = buildHeartbeatConnectHash(resolvedInstanceId, hbId);
      const preserveBridgeSource =
        existing?.source === "bridge-dispatch" &&
        existing.connectHash === connectHash;
      store[hbId] = {
        id: hbId,
        agent: hbName,
        timestamp: new Date().toISOString(),
        lastActivity: getLastActivityTime(),
        joinedAt: existing?.joinedAt,
        status,
        source: preserveBridgeSource ? "bridge-dispatch" : "mcp-direct",
        instanceId: resolvedInstanceId,
        bridgePid: preserveBridgeSource ? (existing?.bridgePid ?? null) : null,
        connectHash,
      };
      saveHeartbeats(store);
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
        : 10;
    const store = loadHeartbeats();
    const agents = buildWhoAgents(store, minutes);
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

  throw new Error(`unknown tool: ${req.params.name}`);
});

// ── Start ───────────────────────────────────────────────────────────────

await mcp.connect(new StdioServerTransport());

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
  debug(`watching reviews: ${latestReviewDir}`);
  watchDir(latestReviewDir, "reviews", mcp);
}

// findings are record-keeping, not real-time comms — no watcher needed.
// Agents read findings on-demand via tap_list_unread(sources: ["findings"]).

// M93: Poll fallback catches messages missed by fs.watch (Windows race, watcher death, etc.)
import { startPollFallback } from "./tap-poll-fallback.js";
startPollFallback(mcp);

process.on("SIGINT", () => process.exit(0));
