#!/usr/bin/env bun
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
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";

import {
  INBOX_DIR,
  ARCHIVE_DIR,
  RECEIPTS_LOCK,
  HEARTBEATS_LOCK,
  debug,
  getAgentName,
  setAgentName,
  getRecentSenders,
  getLatestReviewDir,
  getLastActivityTime,
  updateActivityTime,
  type ChannelSource,
} from "./tap-utils.js";
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
import { readdirSync, renameSync, statSync } from "fs";

// ── Initialize ──────────────────────────────────────────────────────────

initDb();
autoSyncOnStartup();

seedStartupFiles("inbox");
seedStartupFiles("reviews");
seedStartupFiles("findings");

// ── MCP Server ──────────────────────────────────────────────────────────

const mcp = new Server(
  { name: "tap-comms", version: "0.2.0" },
  {
    capabilities: {
      experimental: { "claude/channel": {} },
      tools: {},
    },
    instructions:
      'You are connected to the tap-comms channel. Messages from other agents may arrive as <channel source="tap-comms" from="X" to="Y" subject="Z"> notifications. If your client does not surface Claude channel notifications, call tap_list_unread to pull pending inbox, review, and finding messages. Reply using the tap_reply tool to send messages back to other agents or the control tower.',
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
            type: "array" as const,
            items: { type: "string" as const },
            description:
              "Optional CC recipients. Each receives a copy of the message.",
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
              "Optional source filter. Defaults to inbox, reviews, findings.",
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
  ],
}));

// ── Activity Persistence ────────────────────────────────────────────────

function persistActivity(name: string): void {
  const locked = acquireLock(HEARTBEATS_LOCK);
  if (!locked) return; // Skip this cycle, retry next tool call
  try {
    const store = loadHeartbeats();
    const existing = store[name];
    store[name] = {
      agent: name,
      timestamp: existing?.timestamp ?? new Date().toISOString(),
      lastActivity: getLastActivityTime(),
      joinedAt: existing?.joinedAt,
      status: existing?.status ?? "active",
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
  const agentName = getAgentName();
  if (agentName !== "unknown" && req.params.name !== "tap_set_name") {
    persistActivity(agentName);
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
    const oldName = getAgentName();
    const activeSenders = getRecentSenders();
    activeSenders.delete(oldName);
    const isDuplicate = activeSenders.has(name);
    setAgentName(name);
    debug(
      `name changed: ${oldName} -> ${name}${isDuplicate ? " (DUPLICATE WARNING)" : ""}`,
    );

    const activeList = [...activeSenders]
      .filter((n) => n !== "unnamed" && n !== "unknown")
      .join(", ");
    // Remove old name from heartbeat store, persist under new name with joinedAt
    const now = new Date().toISOString();
    const locked = acquireLock(HEARTBEATS_LOCK);
    if (locked) {
      try {
        const store = loadHeartbeats();
        const oldEntry = oldName !== "unknown" ? store[oldName] : undefined;

        // Delete old entry on rename
        if (oldName !== "unknown" && oldName !== name) {
          delete store[oldName];
        }

        store[name] = {
          agent: name,
          timestamp: now,
          lastActivity: getLastActivityTime(),
          // First registration: set joinedAt. Rename: preserve from old entry.
          joinedAt: oldEntry?.joinedAt ?? now,
          status: "active",
        };
        saveHeartbeats(store);
      } catch {
        // Non-critical
      } finally {
        releaseLock(HEARTBEATS_LOCK);
      }
    }

    let text = `Name set: ${name} (was: ${oldName}). Messages to "${name}", "전체", or "all" will be received.`;
    if (isDuplicate)
      text += `\n⚠️ WARNING: "${name}" was already used in the last 24h. Pick a different name to avoid confusion.`;
    if (activeList) text += `\nRecent active names: ${activeList}`;
    return { content: [{ type: "text", text }] };
  }

  // ── tap_reply ─────────────────────────────────────────────────────
  if (req.params.name === "tap_reply") {
    const { to, subject, content, cc } = req.params.arguments as {
      to: string;
      subject: string;
      content: string;
      cc?: string[];
    };
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const agentName = getAgentName();
    const filename = `${date}-${agentName}-${to}-${subject}.md`;
    const filepath = join(INBOX_DIR, filename);
    const ccHeader = cc?.length ? `> CC: ${cc.join(", ")}\n\n` : "";
    writeFileSync(filepath, ccHeader + content, "utf-8");
    dbInsertMessage(filename, agentName, to, subject, "inbox", Date.now());

    const sent = [`Sent to ${to}: ${filename}`];
    if (cc?.length) {
      for (const recipient of cc) {
        try {
          const ccFilename = `${date}-${agentName}-${recipient}-${subject}.md`;
          writeFileSync(
            join(INBOX_DIR, ccFilename),
            `> CC from message to ${to}\n\n${content}`,
            "utf-8",
          );
          dbInsertMessage(
            ccFilename,
            agentName,
            recipient,
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
    return { content: [{ type: "text", text: sent.join("\n") }] };
  }

  // ── tap_broadcast ─────────────────────────────────────────────────
  if (req.params.name === "tap_broadcast") {
    const { subject, content } = req.params.arguments as {
      subject: string;
      content: string;
    };
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const agentName = getAgentName();
    const filename = `${date}-${agentName}-전체-${subject}.md`;
    writeFileSync(join(INBOX_DIR, filename), content, "utf-8");
    dbInsertMessage(filename, agentName, "전체", subject, "inbox", Date.now());
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
      const agentName = getAgentName();
      const already = store[filename].some((r) => r.reader === agentName);
      if (!already) {
        const ts = new Date().toISOString();
        store[filename].push({ reader: agentName, timestamp: ts });
        saveReceipts(store);
        dbInsertReceipt(filename, agentName, ts);
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

  // ── tap_stats ─────────────────────────────────────────────────────
  if (req.params.name === "tap_stats") {
    const hours =
      typeof (req.params.arguments as any)?.hours === "number"
        ? (req.params.arguments as any).hours
        : 24;
    const cutoff = Date.now() - hours * 60 * 60 * 1000;

    // DB fast path
    const dbResult = dbGetStats(cutoff);
    if (dbResult) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              { hours, ...dbResult, source: "sqlite" },
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
        const { parseFilename } = require("./tap-utils.js");
        const parsed = parseFilename(filename);
        if (!parsed) continue;
        sent[parsed.from] = (sent[parsed.from] || 0) + 1;
        if (parsed.to === "전체" || parsed.to === "all") broadcasts++;
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
            { hours, sent, received, broadcasts, totalReceipts: receiptCount },
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
    const agentName = getAgentName();
    if (!acquireLock(HEARTBEATS_LOCK)) {
      return {
        content: [{ type: "text", text: "Heartbeat store busy, try again." }],
      };
    }
    try {
      const store = loadHeartbeats();
      const existing = store[agentName];
      store[agentName] = {
        agent: agentName,
        timestamp: new Date().toISOString(),
        lastActivity: getLastActivityTime(),
        joinedAt: existing?.joinedAt,
        status,
      };
      saveHeartbeats(store);
      dbUpsertHeartbeat(agentName, status, getLastActivityTime());
    } finally {
      releaseLock(HEARTBEATS_LOCK);
    }
    return {
      content: [
        { type: "text", text: `Heartbeat sent: ${agentName} (${status})` },
      ],
    };
  }

  // ── tap_who ───────────────────────────────────────────────────────
  if (req.params.name === "tap_who") {
    const minutes =
      typeof (req.params.arguments as any)?.minutes === "number"
        ? (req.params.arguments as any).minutes
        : 10;
    const cutoff = Date.now() - minutes * 60 * 1000;
    const store = loadHeartbeats();
    const agents: Array<{
      agent: string;
      status: string;
      lastHeartbeat: string;
      lastActivity: string;
      alive: boolean;
    }> = [];
    for (const [name, hb] of Object.entries(store)) {
      // Use lastActivity as primary alive signal (updated every tool call)
      const actTime = new Date(hb.lastActivity).getTime();
      if (actTime < cutoff) continue;
      const alive = hb.status !== "signing-off";
      agents.push({
        agent: name,
        status: hb.status,
        lastHeartbeat: hb.timestamp,
        lastActivity: hb.lastActivity,
        alive,
      });
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

  throw new Error(`unknown tool: ${req.params.name}`);
});

// ── Start ───────────────────────────────────────────────────────────────

await mcp.connect(new StdioServerTransport());

debug(`agent name: ${getAgentName()}`);
debug(`watching inbox: ${INBOX_DIR}`);

watchDir(INBOX_DIR, "inbox", mcp);

const latestReviewDir = getLatestReviewDir();
if (latestReviewDir) {
  debug(`watching reviews: ${latestReviewDir}`);
  watchDir(latestReviewDir, "reviews", mcp);
}

import { FINDINGS_DIR } from "./tap-utils.js";
debug(`watching findings: ${FINDINGS_DIR}`);
watchDir(FINDINGS_DIR, "findings", mcp);

process.on("SIGINT", () => process.exit(0));
