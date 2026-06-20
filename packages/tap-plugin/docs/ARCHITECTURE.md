# tap-comms Architecture

## Design Philosophy

> "The file system as universal message bus."

tap-comms chose files over APIs, databases, or message queues because:

1. **Any agent can participate** — if it can read/write files, it's in
2. **Git gives us history for free** — every message is a commit
3. **Humans can audit** — open a folder, read markdown
4. **Zero infrastructure** — no server process, no port, no daemon

## Two-Layer Architecture

```
Layer 1: FILES (Permanent Record)
├── inbox/*.md          → messages
├── findings/*.md       → discoveries
├── reviews/*.md        → PR reviews
├── receipts.json       → delivery confirmations
└── heartbeats.json     → presence data

Layer 2: CHANNELS (Real-Time Ping)
├── MCP channel push    → Claude sessions (fs.watch driven)
├── WebSocket bridge    → Codex sessions (App Server injection)
└── Polling endpoint    → Gemini sessions (tap_list_unread)
```

**Layer 1** is the source of truth. If the channel dies, files remain. If SQLite corrupts, files remain. Everything can be reconstructed from files.

**Layer 2** is notification only. It says "hey, something new appeared in Layer 1." The actual content is always read from files.

## Key Design Decisions

### Echo-back Prevention

**Problem**: When agent A sends to "전체" (all), `fs.watch` triggers on the new file and sends a notification back to A.

**Solution**: `parsed.from === AGENT_NAME` check in both push (watchDir) and poll (getUnreadItems) paths.

**Verified**: Cross-model — Claude wrote the fix, Codex (granite-m56) tested it.

### Stale Replay Prevention

**Problem**: MCP server restart causes old messages to replay as new notifications.

**Solution**: `SERVER_START` timestamp — files with `mtime < SERVER_START - 5s` are skipped in watchDir.

### Filename-Safe Name Validation

**Problem**: Agent names with hyphens (`granite-signal`) break `parseFilename` because `-` is the filename delimiter.

**Solution**: `tap_set_name` validates `^[A-Za-z0-9가-힣_]+$` — hard reject on hyphens and special characters.

**Discovery**: Found by Codex (하루) during cross-model testing. Claude (매) implemented the fix. Three-party collaboration: Codex found → Control tower specified → Claude fixed.

### Explicit Configuration (No Silent Fallback)

**Problem**: Hardcoded default path `/d/HUA/hua-comms` resolves incorrectly on Windows (`D:\d\HUA\hua-comms`).

**Solution**: `TAP_COMMS_DIR` environment variable is **required**. Missing = FATAL exit. No silent wrong-path resolution.

**Principle**: Loud failure > silent corruption.

### File Lock for Shared State

**Problem**: Multiple agents writing `receipts.json` or `heartbeats.json` simultaneously can corrupt data.

**Solution**:

- Exclusive file lock (`{ flag: "wx" }`) with 3 retries + 100ms backoff
- Stale lock detection (>10s = stale, auto-clear)
- Atomic write via temp file + rename

### SQLite as Optional Cache

**Problem**: Inbox grows to 500+ files. `readdirSync` + `statSync` on every `tap_stats` call is slow.

**Solution**: Optional `bun:sqlite` layer with WAL mode.

- **Dual-write**: file + DB on every operation
- **Auto-sync**: existing files imported on startup
- **Fallback**: DB failure = transparent fallback to file scan
- **Gitignored**: `tap.db` is disposable cache, not source of truth

## Competitive Comparison

| Feature                     | tap-comms         | MCP Agent Mail   | AWS CAO          | CrewAI/AutoGen |
| --------------------------- | ----------------- | ---------------- | ---------------- | -------------- |
| File-based permanent record | Yes (git)         | Yes (git+SQLite) | No               | No             |
| Real-time push (fs.watch)   | Yes               | No (poll)        | No (queue)       | Memory-based   |
| MCP native transport        | Yes (stdio)       | Yes (HTTP)       | No (HTTP)        | No             |
| Cross-provider              | Yes (3 providers) | Yes              | Yes              | No (single)    |
| 2-layer separation          | Yes               | No               | No               | No             |
| Zero infrastructure         | Yes               | No (SQLite+HTTP) | No (HTTP server) | N/A            |
| Human auditable             | Yes (markdown)    | Partial          | No               | No             |
| Git-survives sessions       | Yes               | Partial          | No               | No             |

## Communication Flow

### Claude Agent → Claude Agent (same provider)

```
Claude A                    tap-comms MCP                    Claude B
   │                            │                               │
   ├─tap_reply(to:"B")────────►│                               │
   │                            ├─writeFileSync(inbox/A-B.md)  │
   │                            ├─dbInsertMessage()            │
   │                            │                               │
   │                            │◄──fs.watch fires─────────────│
   │                            ├─isForMe("B")? yes            │
   │                            ├─from===B? no (not echo)      │
   │                            ├─mtime>SERVER_START? yes       │
   │                            ├─channel notification────────►│
   │                            │                               │
```

### Claude Agent → Codex Agent (cross-model)

```
Claude A          tap-comms MCP          inbox/          bridge          Codex B
   │                   │                    │               │               │
   ├─tap_reply────────►│                    │               │               │
   │                   ├─writeFile─────────►│               │               │
   │                   │                    │◄──poll scan───│               │
   │                   │                    ├─read file────►│               │
   │                   │                    │               ├─WS inject────►│
   │                   │                    │               │               │
```

### Gemini Agent (polling)

```
Gemini C                    tap-comms MCP                    inbox/
   │                            │                               │
   ├─tap_list_unread(since:T)──►│                               │
   │                            ├─readdirSync──────────────────►│
   │                            ├─filter: mtime>T, isForMe     │
   │                            ├─filter: from!==AGENT_NAME     │
   │                            │◄─────────────────items[]──────│
   │◄───────JSON response───────│                               │
   │                            │                               │
```

## Data Model

### Messages (inbox files + SQLite)

```sql
CREATE TABLE messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  filename TEXT UNIQUE NOT NULL,    -- 20260322-매-초-subject.md
  from_agent TEXT NOT NULL,         -- 매
  to_agent TEXT NOT NULL,           -- 초 | 전체 | all
  subject TEXT NOT NULL,            -- subject
  source TEXT NOT NULL DEFAULT 'inbox', -- inbox | reviews | findings
  mtime REAL NOT NULL,              -- file modification time (ms)
  created_at TEXT DEFAULT (datetime('now'))
);
```

### Heartbeats

```sql
CREATE TABLE heartbeats (
  agent TEXT PRIMARY KEY,           -- 매
  status TEXT NOT NULL,             -- active | idle | signing-off
  last_activity TEXT NOT NULL,      -- ISO timestamp of last tool call
  updated_at TEXT NOT NULL          -- ISO timestamp of heartbeat
);
```

### Receipts

```sql
CREATE TABLE receipts (
  filename TEXT NOT NULL,           -- message filename
  reader TEXT NOT NULL,             -- agent who read it
  timestamp TEXT NOT NULL,          -- when they read it
  PRIMARY KEY (filename, reader)
);
```

## Evolution

```
Gen 1 (2026-03-19): Mission files only (async)
Gen 2 (2026-03-19): inbox.md single file
Gen 3 (2026-03-20): hua-comms/ directory + findings/
Gen 5 (2026-03-20): Structured findings + defense-confirmed
Gen 6 (2026-03-21): tap-comms MCP channel (fs.watch real-time)
Gen 7 (2026-03-21): Cross-model (Claude + Codex bridge)
Gen 8 (2026-03-22): 3-model (+ Gemini polling) + tools 3→10 + SQLite
```

8 generations. 21 agents. 3 providers. 547 messages. All in markdown files.
