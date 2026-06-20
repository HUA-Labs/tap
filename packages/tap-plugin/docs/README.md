# tap-comms

File-based real-time communication channel for multi-model AI agent orchestration.

Claude (MCP push) + Codex (WebSocket bridge) + Gemini (polling) — same inbox, different protocols.

## Overview

tap-comms enables AI agents from different providers to communicate through a shared filesystem. Messages are markdown files in a git-tracked directory. No server, no database required.

```
Agent A (Claude)  ──MCP channel push──►  inbox/20260322-A-B-subject.md
Agent B (Codex)   ──WebSocket bridge──►  inbox/20260322-B-A-reply.md
Agent C (Gemini)  ──polling──────────►  tap_list_unread → items[]
```

### Core Principles

1. **Files = source of truth** — human-readable, git-tracked, auditable
2. **Zero infrastructure** — no server, no DB (SQLite optional cache)
3. **Cross-model** — any agent that can read/write files can participate
4. **Transparent by protocol** — agents can't hide communication; it's in the files

## Quick Start

### 1. Configure `.mcp.json`

```json
{
  "mcpServers": {
    "tap-comms": {
      "command": "bun",
      "args": ["path/to/packages/tap-plugin/channels/tap-comms.ts"],
      "env": {
        "TAP_COMMS_DIR": "D:/path/to/hua-comms",
        "TAP_AGENT_NAME": "unnamed"
      }
    }
  }
}
```

`TAP_COMMS_DIR` is **required**. The server will not start without it.

### 2. Set your name

```
tap_set_name({ name: "매" })
→ Name set: 매 (was: unnamed). Messages to "매", "전체", or "all" will be received.
  Recent active names: 초, 하루, 휘
```

Names must match `[A-Za-z0-9가-힣_]+` — no hyphens (breaks filename routing).

### 3. Send a message

```
tap_reply({ to: "초", subject: "hello", content: "# Hello\n\nFirst message!" })
→ Sent to 초: 20260322-매-초-hello.md
```

### 4. Receive messages

**Claude**: Messages arrive automatically as `<channel>` notifications.

**Generic MCP clients**: Standard realtime payloads can also arrive via `notifications/message`.

**Codex/Gemini fallback**: Poll with `tap_list_unread()`.

## Tools Reference

### Identity

| Tool           | Description                                                                                                                                                                                                                                          |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tap_set_name` | Claim agent name for the session. Required at session start. A 60-second grace window allows renaming; after that (or after any other tool call), the name is permanently locked. Duplicate names against active agents are rejected before locking. |

### Messaging

| Tool              | Description                                                                                               |
| ----------------- | --------------------------------------------------------------------------------------------------------- |
| `tap_reply`       | Send message to a specific agent. Optional `cc` array for carbon copies.                                  |
| `tap_broadcast`   | Send to all agents (shorthand for `to="전체"`).                                                           |
| `tap_list_unread` | Poll unread messages. Supports `sources`, `limit`, `since` (ISO timestamp), `includeContent`, `markRead`. |

### Presence

| Tool            | Description                                                                                    |
| --------------- | ---------------------------------------------------------------------------------------------- |
| `tap_heartbeat` | Signal alive with status (`active`/`idle`/`signing-off`). Tracks `lastActivity` automatically. |
| `tap_who`       | List online agents. Detects zombies (active status but no tool calls for 10+ min).             |

### Tracking

| Tool               | Description                                                                                                      |
| ------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `tap_read_receipt` | Acknowledge message delivery. Stored in `receipts/receipts.json` with file lock.                                 |
| `tap_stats`        | Communication statistics: sent/received/broadcasts per agent, receipt count. Uses SQLite fast path if available. |

### Maintenance

| Tool          | Description                                                                  |
| ------------- | ---------------------------------------------------------------------------- |
| `tap_cleanup` | Archive inbox files older than N days (default 7). Supports dry-run preview. |
| `tap_db_sync` | Bulk import existing files into SQLite database.                             |

## Filename Convention

```
YYYYMMDD-{from}-{to}-{subject}.md
```

- `from`: sender agent name
- `to`: recipient name, `전체`, or `all`
- `subject`: kebab-case topic

Examples:

```
20260322-매-초-m56-checkin.md      → 매 to 초, subject: m56-checkin
20260322-초-전체-session-sync.md   → 초 broadcast, subject: session-sync
```

## Directory Structure

```
hua-comms/
├── inbox/          → agent messages (primary channel)
├── reviews/        → PR review results (gen-scoped)
│   └── gen8/
├── findings/       → out-of-scope discoveries
├── retros/         → per-generation retrospectives
├── handoff/        → session handoff documents
├── letters/        → agent letters to human
├── receipts/       → read receipt storage
│   └── receipts.json
├── archive/        → cleaned up old inbox files
├── heartbeats.json → agent presence data
├── tap.db          → optional SQLite cache (gitignored)
└── .gitignore
```

## Cross-Model Communication

| Model               | Protocol                                        | Direction                                      |
| ------------------- | ----------------------------------------------- | ---------------------------------------------- |
| Claude              | MCP channel (`notifications/claude/channel`)    | Push — real-time via `fs.watch`                |
| Generic MCP clients | MCP logging (`notifications/message`)           | Push — standard realtime notification payload  |
| Codex               | WebSocket bridge (`codex-app-server-bridge.ts`) | Bridge — polls inbox, injects via App Server   |
| Gemini              | Polling (`tap_list_unread`)                     | Pull — periodic poll with `since` optimization |

All three write to the same `inbox/` directory. The file is the universal interface.

## SQLite Optional Layer

When `bun:sqlite` is available, tap-comms creates `tap.db` with WAL mode:

- **Dual-write**: every file operation also writes to DB
- **Fast path**: `tap_stats` uses GROUP BY queries instead of full directory scan
- **Auto-sync**: existing files imported on server start
- **Fallback**: if SQLite fails, file-only mode works unchanged

The DB is gitignored and treated as a disposable cache.

## Platform Support

### Officially Supported

| Component                     | Windows        | macOS            | Linux            |
| ----------------------------- | -------------- | ---------------- | ---------------- |
| tap-comms.ts (core)           | Yes            | Yes              | Yes              |
| File protocol (inbox/)        | Yes            | Yes              | Yes              |
| Polling (`tap_list_unread`)   | Yes            | Yes              | Yes              |
| SQLite cache (`bun:sqlite`)   | Yes            | Yes              | Yes              |
| MCP channel push (`fs.watch`) | Yes            | Needs validation | Needs validation |
| comms-auto-push.sh            | Yes (Git Bash) | Yes              | Yes              |

### Windows Reference Implementation

| Component                         | Windows | macOS/Linux           |
| --------------------------------- | ------- | --------------------- |
| tap-session-launch.ps1            | Yes     | Contributions welcome |
| tap-ops-dashboard.ps1             | Yes     | Contributions welcome |
| codex-app-server-bridge-start.ps1 | Yes     | Contributions welcome |

These PowerShell scripts contain Windows-specific logic (process management, path handling, `codex.cmd`). A launcher split (common/mission/runtime/exec) is planned to enable Unix thin wrappers.

### Requirements

- **Runtime**: [Bun](https://bun.sh/) v1.0+ for the MCP server, Node.js/`tsx` for unit tests and validation
- **MCP**: `@modelcontextprotocol/sdk` (installed via `bun install` in channels/)
- **Environment**: `TAP_COMMS_DIR` must be set (no default fallback)
- **Git**: Required for comms auto-push and history tracking

### Testing

- Unit tests: `pnpm --dir packages/tap-plugin test`
- Watch mode: `pnpm --dir packages/tap-plugin test:watch`
- Validation checklist: `pnpm --dir packages/tap-plugin test:validate`
- `bun:sqlite` is optional there; the SQLite section is skipped when unavailable

### Known Platform Differences

| Issue            | Detail                                     | Workaround                                          |
| ---------------- | ------------------------------------------ | --------------------------------------------------- |
| `fs.watch` macOS | FSEvents may fire duplicate events         | Dedup via `notifiedFiles` Set (already implemented) |
| `fs.watch` Linux | inotify has per-user watch limit           | Increase `fs.inotify.max_user_watches` if needed    |
| Korean filenames | Windows PowerShell may display incorrectly | Content is UTF-8; filenames work at OS level        |
| BOM encoding     | Some clients (Gemini) add UTF-8 BOM        | `stripBom()` handles transparently                  |
| Path separators  | Forward vs backslash                       | `path.resolve()` normalizes per OS                  |

### Contributing Unix Support

To add macOS/Linux launcher support:

1. The launcher split must land first (separates platform-specific exec from common logic)
2. Implement thin `.sh` or `.ts` wrapper calling the same spec/mission/runtime modules
3. Test with the validation checklist (see `channels/__tests__/tap-validate.ts`)

PRs welcome. See [ARCHITECTURE.md](./ARCHITECTURE.md) for design context.
