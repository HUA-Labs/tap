# @hua-labs/tap

Zero-dependency CLI for cross-model AI agent communication setup.

One command to connect Claude, Codex, and Gemini agents through a shared file-based communication layer.

## Quick Start

> `bun` is required to run the managed tap MCP server. When installed from npm, `@hua-labs/tap` now ships its own bundled MCP server entry.

```bash
# 1. Initialize comms directory and state
npx @hua-labs/tap init

# 2. Add runtimes
npx @hua-labs/tap add claude
npx @hua-labs/tap add codex
npx @hua-labs/tap add gemini

# 3. Check status
npx @hua-labs/tap status
```

Your agents can now communicate through the shared comms directory.

## Commands

### `init`

Initialize the comms directory and `.tap-comms/` state.

By default, the comms directory is created inside the current repo at `./tap-comms`.

```bash
npx @hua-labs/tap init
npx @hua-labs/tap init --comms-dir /path/to/comms
npx @hua-labs/tap init --permissions safe    # default: deny destructive ops
npx @hua-labs/tap init --permissions full    # no restrictions (use with caution)
npx @hua-labs/tap init --force               # re-initialize
```

### `add <runtime>`

Add a runtime. Probes config, plans patches, applies, and verifies.

```bash
npx @hua-labs/tap add claude
npx @hua-labs/tap add codex
npx @hua-labs/tap add gemini
npx @hua-labs/tap add claude --force   # re-install
```

### `remove <runtime>`

Remove a runtime and rollback config changes.

```bash
npx @hua-labs/tap remove claude
npx @hua-labs/tap remove codex
```

### `status`

Show installed runtimes and their status.

```bash
npx @hua-labs/tap status
```

Output shows three status levels:

- **installed** — config written but not verified
- **configured** — config written and verified
- **active** — runtime is running and connected

### `serve`

Start the tap MCP server (stdio). Convenience command for running the MCP server locally.

```bash
npx @hua-labs/tap serve
npx @hua-labs/tap serve --comms-dir /path/to/comms
```

Requires `bun`. Uses the bundled MCP server entry from `@hua-labs/tap`, with a repo-local fallback for monorepo checkouts.

## Supported Runtimes

| Runtime | Config                  | Bridge                 | Mode               |
| ------- | ----------------------- | ---------------------- | ------------------ |
| Claude  | `.mcp.json`             | native-push (fs.watch) | No daemon needed   |
| Codex   | `~/.codex/config.toml`  | WebSocket bridge       | Daemon per session |
| Gemini  | `.gemini/settings.json` | polling                | No daemon needed   |

## `--json` Flag

All commands support `--json` for machine-readable output. Returns a single JSON object to stdout with no human log noise.

```bash
npx @hua-labs/tap status --json
```

```json
{
  "ok": true,
  "command": "status",
  "code": "TAP_STATUS_OK",
  "message": "2 runtime(s) installed",
  "warnings": [],
  "data": {
    "version": "0.2.2",
    "commsDir": "/path/to/comms",
    "runtimes": {
      "claude": { "status": "active", "bridgeMode": "native-push" },
      "codex": { "status": "configured", "bridgeMode": "app-server" }
    }
  }
}
```

Error codes use `TAP_*` prefix: `TAP_ADD_OK`, `TAP_NO_OP`, `TAP_PATCH_FAILED`, etc.

Exit codes: `0` = ok, `1` = error.

## Permissions

`tap init` auto-configures runtime permissions.

### Safe mode (default)

**Claude**: Adds deny rules to `.claude/settings.local.json` blocking destructive operations (force push, hard reset, rm -rf, etc.).

**Codex**: Sets `workspace-write` sandbox, `full` network access, trusted project paths, and writable roots in `~/.codex/config.toml`.

### Full mode

```bash
npx @hua-labs/tap init --permissions full
```

**Claude**: Removes tap-managed deny rules. User-added rules preserved.

**Codex**: Sets `danger-full-access` sandbox. Use on trusted local machines only.

## How It Works

Agents communicate through a shared directory (`comms/`) using markdown files:

```
comms/
├── inbox/          # Agent-to-agent messages
├── reviews/        # Code review results
├── findings/       # Out-of-scope discoveries
├── handoff/        # Session handoff documents
├── retros/         # Retrospectives
└── archive/        # Archived messages
```

Each runtime has an adapter that:

1. **Probes** — finds config files, checks runtime installation
2. **Plans** — determines what patches to apply
3. **Applies** — backs up and patches config files
4. **Verifies** — confirms the runtime can read the config

The adapter contract (`RuntimeAdapter`) is the extension point for adding new runtimes.

## Changelog (0.2.2)

### Bridge

- **Auth gateway** — Managed bridge now includes an auth proxy with timing-safe token validation (M99)
- **`--no-auth` flag** — Skip auth gateway for localhost-only setups; app-server listens directly on public port (M102)
- **TUI connect URL** — `bridge start` and `bridge status` output shows where to connect Codex TUI (M102)
- **Identity routing** — Bridge matches inbox messages by both `agentId` and `agentName`; self echo-back filtered by both (M101)
- **Display labels** — Bridge prompts, `tap_who`, and notifications use `name [id]` format (M101)

### CLI

- **`tap doctor`** — Diagnose comms, bridge, message, and MCP issues (M95)
- **`tap doctor --fix`** — Auto-fix common issues with post-fix revalidation (M100)
- **Error codes** — 24 CLI error codes with consistent `TAP_*` prefix (M91)
- **Boot streamline** — Faster CLI startup with agent-name persistence (M92)

### Infrastructure

- **Auto-poll fallback** — Bridge falls back to polling when fs.watch is unavailable (M93)
- **Watcher dedup** — Root-cause fix for duplicate message dispatch (M90)
- **tap-plugin test infra** — In-memory test harness for MCP channel tests (M94)
- **Blind test CI** — Cross-model communication verification framework (M98)

## License

MIT
