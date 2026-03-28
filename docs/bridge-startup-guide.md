# Bridge Startup Guide

> Step-by-step guide for starting tap bridge connections.

## Overview

tap bridges connect runtime CLI tools (codex, gemini) to the tap channel. Claude uses native MCP push — no bridge needed.

| Runtime | Bridge Mode   | What It Does                           |
| ------- | ------------- | -------------------------------------- |
| Claude  | `native-push` | MCP channel notifications — no bridge  |
| Codex   | `app-server`  | WebSocket bridge via codex app-server  |
| Gemini  | `polling`     | File polling (planned: extension hook) |

## Codex Bridge (Most Common)

### Option A: Managed Mode (Recommended)

tap handles everything: starts app-server, spawns bridge, manages lifecycle.

```bash
# 1. Initialize + add codex
tap init
tap add codex --agent-name myAgent   # optional; default agent name is "codex"

# 2. Verify
tap bridge status
```

Managed `tap add codex` already starts the bridge and app-server. Re-running `tap add codex --agent-name <name>` updates the stored agent name without `--force`.

### Option B: Managed Mode Without Auth Gateway (--no-auth)

Skip the auth gateway — app-server listens directly on the public port. Both bridge and TUI connect to the same URL without token authentication. Useful for local development where security proxy is unnecessary.

```bash
tap bridge start codex --agent-name myAgent --no-auth
```

Output includes a `TUI connect:` line showing where to point your TUI:

```
✔ Bridge started (PID: 12345)
  App server:   healthy, managed pid:6789, ws://127.0.0.1:4501
  TUI connect:  ws://127.0.0.1:4501
```

Then connect TUI directly:

```bash
codex --enable tui_app_server --remote ws://127.0.0.1:4501
```

**Note**: In default managed mode (without `--no-auth`), an auth gateway sits between TUI and app-server. The TUI cannot pass the required token, so you must use the upstream URL shown in `TUI connect:` output instead.

### Option C: Manual App-Server (--no-server)

You manage the app-server separately. Useful for debugging or custom setups.

```bash
# Terminal 1: Start app-server manually
codex app-server --listen ws://127.0.0.1:4501

# Wait for "listening on ws://127.0.0.1:4501" message

# Terminal 2: Start bridge (connect-only)
tap bridge start codex --agent-name myAgent --no-server
```

**Important**: The app-server MUST be running before bridge start. A health check runs at startup — if unreachable, bridge start is rejected with `TAP_BRIDGE_START_FAILED`.

### Option D: Remote TUI + Bridge

For headless codex with a remote TUI interface.

**With --no-auth (simplest)**:

```bash
# Terminal 1: Start managed bridge without auth
tap bridge start codex --agent-name myAgent --no-auth

# Terminal 2: Connect TUI to the same port
codex --enable tui_app_server --remote ws://127.0.0.1:4501
```

**With auth gateway (default managed mode)**:

```bash
# Terminal 1: Start managed bridge (auth gateway enabled)
tap bridge start codex --agent-name myAgent
# Note the "TUI connect:" URL in output (e.g. ws://127.0.0.1:7785)

# Terminal 2: Connect TUI to the upstream URL (NOT the gateway port)
codex --enable tui_app_server --remote ws://127.0.0.1:7785
```

**With manual app-server**:

```bash
# Terminal 1: App-server
codex app-server --listen ws://127.0.0.1:4501

# Terminal 2: Remote TUI
codex --enable tui_app_server --remote ws://127.0.0.1:4501

# Terminal 3: Bridge
tap bridge start codex --agent-name myAgent --no-server
```

## Multi-Instance Setup

Multiple codex instances with unique names and ports.

```bash
# Add instances
tap add codex                                           # agent-name defaults to codex
tap add codex --name reviewer --port 4502 --agent-name reviewer

# Start all at once
tap bridge start --all

# Or individually
tap bridge start codex --agent-name worker
tap bridge start codex-reviewer --agent-name reviewer
```

`--all` starts every registered app-server instance sequentially. Agent names are stored during `tap add` and can be updated later with `tap add ... --agent-name <name>`.

## Headless Mode

Run codex without interactive TUI — for automated review, validation, etc.

```bash
# Add with headless flag
tap add codex --name reviewer --headless --role reviewer

# Start bridge
tap bridge start codex-reviewer --agent-name reviewer

# Or ad-hoc headless on any instance
tap bridge start codex --agent-name myAgent --headless --role validator
```

Roles: `reviewer` (default), `validator`, `long-running`.

### Headless + TUI (Hybrid)

For monitoring a headless agent's activity via TUI, use `--no-auth` so both bridge and TUI can share the same port:

```bash
# Start headless bridge without auth gateway
tap bridge start codex-reviewer --agent-name reviewer --headless --no-auth

# Connect TUI to observe — port is auto-assigned per instance (4501, 4502, ...)
codex --enable tui_app_server --remote ws://127.0.0.1:4502
```

### Identity Routing (0.2.0)

Bridge now routes messages using both `agentId` (instance ID like `codex-reviewer`) and `agentName` (display name like `덱`). Self-authored messages are filtered by both identifiers. Display labels use `name [id]` format (e.g. `덱 [codex-reviewer]`) in bridge prompts and `tap_who` output.

## Stopping Bridges

```bash
# Stop one
tap bridge stop codex

# Stop all
tap bridge stop
```

## Troubleshooting

### Bridge starts but no messages dispatched

**Symptoms**: PID alive, heartbeat updates, but no message processing.

**Cause**: App-server not reachable. Bridge enters reconnect loop — `connect()` fails repeatedly, `runScan()` never executes.

**Fix**:

1. Check app-server: `tap bridge status` — look for connection errors
2. Verify port: is app-server actually listening on the expected port?
3. If `--no-server`: ensure app-server is started BEFORE bridge

### `pnpm: command not found` in pre-commit hook

**Cause**: husky spawns a new sh without fnm PATH. Fixed in M85.

**Fix**: Pull latest main — `scripts/resolve-fnm-env.sh` resolves fnm Node + pnpm.

### `TAP_NOT_INITIALIZED`

Run `tap init` in your repo root first.

### `TAP_BRIDGE_SCRIPT_MISSING`

The bridge script wasn't found. Ensure:

1. `@hua-labs/tap` is installed (`npm install -g @hua-labs/tap` or `npx`)
2. For repo-local: `packages/tap-comms/` exists with bridge scripts

### `TAP_INSTANCE_NOT_FOUND`

Instance not registered. Run `tap add <runtime>` first.

### Codex shows "Tools: (none)"

**Cause**: Previously caused by Codex CLI display bug with hyphenated MCP names. Fixed in v0.2.5 — MCP key renamed from `tap-comms` to `tap`. If you still see this, run `tap add codex` to migrate.

**Verify**: Run `codex mcp list` — should show `tap: enabled`.

**Ref**: Upstream issue [codex#15565](https://github.com/openai/codex/issues/15565).

### Port conflicts

```bash
tap status --json  # Check assigned ports
tap add codex --name reviewer --port 4503  # Use specific port
```
