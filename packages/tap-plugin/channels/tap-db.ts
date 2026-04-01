/**
 * tap-comms optional SQLite cache layer.
 * Falls back gracefully if bun:sqlite is unavailable.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import {
  DB_PATH,
  INBOX_DIR,
  RECEIPTS_DIR,
  debug,
  parseFilename,
  type ChannelSource,
} from "./tap-utils.js";

// ── DB Instance ─────────────────────────────────────────────────────────

// bun:sqlite type stub — avoids TS2307 when not running in Bun
interface BunDatabase {
  exec(sql: string): void;
  run(sql: string, ...args: unknown[]): void;
  prepare(sql: string): {
    run(...args: unknown[]): void;
    all(...args: unknown[]): unknown[];
    get(...args: unknown[]): unknown;
  };
  close(): void;
}

let db: BunDatabase | null = null;

export function getDb() {
  return db;
}

// ── Init ────────────────────────────────────────────────────────────────

export function initDb(): boolean {
  try {
    const { Database } = require("bun:sqlite") as {
      Database: new (path: string, opts?: { create?: boolean }) => BunDatabase;
    };
    db = new Database(DB_PATH, { create: true });
    db.exec("PRAGMA journal_mode=WAL");
    db.exec("PRAGMA busy_timeout=5000");
    db.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        filename TEXT UNIQUE NOT NULL,
        from_agent TEXT NOT NULL,
        to_agent TEXT NOT NULL,
        subject TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'inbox',
        mtime REAL NOT NULL,
        created_at TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_messages_to ON messages(to_agent);
      CREATE INDEX IF NOT EXISTS idx_messages_mtime ON messages(mtime);
      CREATE INDEX IF NOT EXISTS idx_messages_from ON messages(from_agent);

      CREATE TABLE IF NOT EXISTS heartbeats (
        agent TEXT PRIMARY KEY,
        status TEXT NOT NULL DEFAULT 'active',
        last_activity TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS receipts (
        filename TEXT NOT NULL,
        reader TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        PRIMARY KEY (filename, reader)
      );
    `);
    debug("SQLite initialized: " + DB_PATH);
    return true;
  } catch (err) {
    debug("SQLite unavailable, using file-only mode: " + String(err));
    db = null;
    return false;
  }
}

// ── Auto Sync ───────────────────────────────────────────────────────────

export function autoSyncOnStartup() {
  if (!db) return;

  try {
    // Sync inbox
    if (existsSync(INBOX_DIR)) {
      for (const filename of readdirSync(INBOX_DIR)) {
        if (!filename.endsWith(".md")) continue;
        const match = filename.match(/^\d{8}-(.+?)-(.+?)-(.+)\.md$/);
        if (!match) continue;
        try {
          const mtime = statSync(join(INBOX_DIR, filename)).mtimeMs;
          db.run(
            "INSERT OR IGNORE INTO messages (filename, from_agent, to_agent, subject, source, mtime) VALUES (?, ?, ?, ?, ?, ?)",
            [filename, match[1], match[2], match[3], "inbox", mtime],
          );
        } catch {}
      }
    }
    debug("auto-sync: inbox files imported into DB");

    // Sync receipts
    const rcptPath = join(RECEIPTS_DIR, "receipts.json");
    if (existsSync(rcptPath)) {
      try {
        const rcptStore = JSON.parse(readFileSync(rcptPath, "utf-8"));
        for (const [fname, readers] of Object.entries(rcptStore)) {
          for (const r of readers as Array<{
            reader: string;
            timestamp: string;
          }>) {
            db.run(
              "INSERT OR IGNORE INTO receipts (filename, reader, timestamp) VALUES (?, ?, ?)",
              [fname, r.reader, r.timestamp],
            );
          }
        }
        debug("auto-sync: receipts imported into DB");
      } catch {}
    }
  } catch {}
}

// ── Write Helpers ───────────────────────────────────────────────────────

export function dbInsertMessage(
  filename: string,
  from: string,
  to: string,
  subject: string,
  source: ChannelSource,
  mtimeMs: number,
) {
  if (!db) return;
  try {
    db.run(
      "INSERT OR IGNORE INTO messages (filename, from_agent, to_agent, subject, source, mtime) VALUES (?, ?, ?, ?, ?, ?)",
      [filename, from, to, subject, source, mtimeMs],
    );
  } catch {}
}

export function dbUpsertHeartbeat(
  agent: string,
  status: string,
  lastActivity: string,
) {
  if (!db) return;
  try {
    db.run(
      `INSERT INTO heartbeats (agent, status, last_activity, updated_at)
       VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(agent) DO UPDATE SET
         status=excluded.status,
         last_activity=excluded.last_activity,
         updated_at=datetime('now')`,
      [agent, status, lastActivity],
    );
  } catch {}
}

export function dbInsertReceipt(
  filename: string,
  reader: string,
  timestamp: string,
) {
  if (!db) return;
  try {
    db.run(
      "INSERT OR IGNORE INTO receipts (filename, reader, timestamp) VALUES (?, ?, ?)",
      [filename, reader, timestamp],
    );
  } catch {}
}

// ── Query Helpers ───────────────────────────────────────────────────────

export function dbGetStats(cutoff: number): {
  sent: Record<string, number>;
  received: Record<string, number>;
  broadcasts: number;
  totalReceipts: number;
} | null {
  if (!db) return null;
  try {
    const sentRows = db
      .prepare(
        "SELECT from_agent, COUNT(*) as cnt FROM messages WHERE mtime >= ? AND source = 'inbox' GROUP BY from_agent",
      )
      .all(cutoff) as Array<{ from_agent: string; cnt: number }>;
    const receivedRows = db
      .prepare(
        "SELECT to_agent, COUNT(*) as cnt FROM messages WHERE mtime >= ? AND source = 'inbox' AND to_agent NOT IN ('전체','all') GROUP BY to_agent",
      )
      .all(cutoff) as Array<{ to_agent: string; cnt: number }>;
    const broadcastRow = db
      .prepare(
        "SELECT COUNT(*) as cnt FROM messages WHERE mtime >= ? AND source = 'inbox' AND to_agent IN ('전체','all')",
      )
      .get(cutoff) as { cnt: number } | null;
    const cutoffISO = new Date(cutoff).toISOString();
    const receiptRow = db
      .prepare("SELECT COUNT(*) as cnt FROM receipts WHERE timestamp >= ?")
      .get(cutoffISO) as { cnt: number } | null;

    const sent: Record<string, number> = {};
    for (const r of sentRows) sent[r.from_agent] = r.cnt;
    const received: Record<string, number> = {};
    for (const r of receivedRows) received[r.to_agent] = r.cnt;

    return {
      sent,
      received,
      broadcasts: broadcastRow?.cnt ?? 0,
      totalReceipts: receiptRow?.cnt ?? 0,
    };
  } catch {
    return null;
  }
}

export function dbSyncAll(): {
  messages: number;
  heartbeats: number;
  receipts: number;
} | null {
  if (!db) return null;

  let msgCount = 0;
  let hbCount = 0;
  let rcptCount = 0;

  // Sync inbox
  if (existsSync(INBOX_DIR)) {
    for (const filename of readdirSync(INBOX_DIR)) {
      if (!filename.endsWith(".md")) continue;
      const parsed = parseFilename(filename);
      if (!parsed) continue;
      try {
        const mtime = statSync(join(INBOX_DIR, filename)).mtimeMs;
        dbInsertMessage(
          filename,
          parsed.from,
          parsed.to,
          parsed.subject,
          "inbox",
          mtime,
        );
        msgCount++;
      } catch {}
    }
  }

  // Sync heartbeats
  try {
    const { loadHeartbeats } = require("./tap-io.js");
    const hbStore = loadHeartbeats();
    for (const [agent, hb] of Object.entries(hbStore) as Array<[string, any]>) {
      dbUpsertHeartbeat(agent, hb.status, hb.lastActivity);
      hbCount++;
    }
  } catch {}

  // Sync receipts
  try {
    const { loadReceipts } = require("./tap-io.js");
    const rcptStore = loadReceipts();
    for (const [filename, readers] of Object.entries(rcptStore) as Array<
      [string, any]
    >) {
      for (const r of readers) {
        dbInsertReceipt(filename, r.reader, r.timestamp);
        rcptCount++;
      }
    }
  } catch {}

  return { messages: msgCount, heartbeats: hbCount, receipts: rcptCount };
}
