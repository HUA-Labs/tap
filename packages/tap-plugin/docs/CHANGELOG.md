# tap-comms Changelog

## M58 — SQLite + Name Validation (2026-03-22)

PR #707 | Agent: 매(媒), Gen 8

### Added

- **Optional SQLite cache layer** (`bun:sqlite`, WAL mode)
  - Dual-write: file + DB on every operation
  - `tap_stats` DB fast path with `source='inbox'` filter
  - Auto-sync inbox + receipts on server startup
  - `tap_db_sync` tool for manual bulk import
- **Filename-safe name validation** in `tap_set_name`
  - Regex: `^[A-Za-z0-9가-힣_]+$`
  - Hard reject on hyphens, spaces, special characters
- **`.gitignore` for hua-comms** — excludes tap.db, lock files, temp files

### Fixed

- Explicit `TAP_COMMS_DIR` env required — no silent fallback to wrong path
- DB stats queries filter `WHERE source='inbox'` (excludes reviews/findings)
- Startup auto-sync includes receipts.json (fixes totalReceipts=0)
- Generalized lock function (reusable across receipts + heartbeats)
- Heartbeat atomic write (temp + rename pattern)
- CC file creation error handling (partial failure OK)

### Reviewed by

- 하루 (Codex) — 5 rounds, High 2 + Medium 4 found and resolved
- 틈 (Codex) — Medium 2 found and resolved

---

## M57 — Agent Presence + CC + Polling + Cleanup (2026-03-22)

PR #706 | Agent: 매(媒), Gen 8

### Added

- **`tap_heartbeat`** — agent presence with status (active/idle/signing-off)
- **`tap_who`** — online agent list with zombie detection (10min no activity)
- **`tap_reply` CC** — optional `cc: string[]` for carbon copies
- **`tap_list_unread` since** — ISO timestamp filter for polling optimization
- **`tap_cleanup`** — archive inbox files older than N days with dry-run
- **`tap_stats` broadcasts** — separate broadcast count

### Fixed

- Stale file replay on server restart (SERVER_START timestamp filter)

### Reviewed by

- 하루 (Codex) — lock retry, heartbeat atomic write, devlog path

---

## M56 — Echo-back + Windows + Name Dedup + Auto-push (2026-03-22)

PR #704, #705 | Agent: 매(媒), Gen 8

### Added

- **Name dedup warning** in `tap_set_name` — soft warning + active names list
- **`tap_broadcast`** — shorthand for sending to all agents
- **`tap_read_receipt`** — message delivery acknowledgment with file lock
- **`tap_stats`** — per-agent sent/received counts + receipt totals
- **Auto-push summary** — commit message shows `inbox(3) findings(1)` format

### Fixed

- **Echo-back prevention** — sender's own messages filtered in push + poll paths
- **Windows path** — `path.resolve()` preserves drive letter
- **BOM strip** — handles UTF-8 BOM from Gemini clients

---

## Pre-M56 — Original tap-comms (Gen 6-7)

### Tools (3)

- `tap_set_name` — set agent name
- `tap_reply` — send message to agent
- `tap_list_unread` — poll unread messages

### Architecture

- File-based inbox with `fs.watch` for Claude push notifications
- MCP server over stdio
- Cross-model support via bridge (Codex) and polling (Gemini)
