# @hua-labs/tap

> *Other tools give agents instructions. tap gives them context.*

**탑 (塔)** — Korean for *stone tower* and *control tower*. Stone towers are built by stacking stones one by one. Each generation of AI agents adds records to a shared directory — findings, retros, letters, handoffs. The tower grows. A control tower observes and coordinates. The tower agent orchestrates missions, routes reviews, and keeps the team aligned.

*"돌이 쌓이면 탑이 된다"* — When stones stack, they become a tower.

Zero-dependency CLI for cross-model AI agent communication setup.

One command to connect Claude, Codex, and Gemini agents through a shared file-based communication layer.

### Why "tap"?

탑 (塔) — Korean for **stone tower** and **control tower**.

- **Stone tower** (석탑): built by stacking stones one by one. Each generation of agents adds records to the comms directory — findings, retros, letters, handoffs. The tower grows.
- **Control tower** (관제탑): observes and coordinates from the center. The tower agent orchestrates missions, routes reviews, and keeps the team aligned.

*Stacked records + central coordination = tap.*

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

### `doctor`

Diagnose and optionally fix tap infrastructure health.

```bash
npx @hua-labs/tap doctor
npx @hua-labs/tap doctor --fix
```

### `up` / `down`

Start or stop all managed bridges.

```bash
npx @hua-labs/tap up
npx @hua-labs/tap down
```

### `gui`

Start a local web dashboard showing bridge status, agents, mission kanban, and PR board.

```bash
npx @hua-labs/tap gui
```

### `watch`

Autonomous bridge health monitoring with auto-restart for stuck bridges.

```bash
npx @hua-labs/tap watch
npx @hua-labs/tap watch --loop --interval 60
```

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
    "version": "0.3.0",
    "commsDir": "/path/to/comms",
    "instances": {
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

## What's New (0.3.0)

### Headless Durable

TUI-free Codex operation is now fully automated:
- **Auto app-server spawn** — `tap bridge start` launches codex app-server without manual setup
- **Thread self-heal** — Stale thread state automatically reconciled from heartbeat
- **Warmup on restart** — Cold-start warmup triggers on `bridge restart`, not just `tap up`

### Web Dashboard

```bash
npx @hua-labs/tap gui
```

Live dashboard at `http://127.0.0.1:3847` with:
- Agent status + bridge health (SSE live updates)
- Mission kanban board (`/missions`)
- PR board (`/prs`)
- JSON APIs with CORS (`/api/snapshot`, `/api/missions`, `/api/prs`)

### Autonomous Monitoring

```bash
npx @hua-labs/tap watch --loop --interval 60
```

Continuous health monitoring with auto-restart for stuck bridges. Cron/systemd friendly.

### Cross-Platform

- **Windows**: PowerShell hidden spawn + `.cmd` shim unwrap
- **macOS/Linux**: Unix detached process + `lsof` PID discovery
- **Gemini**: Fake IDE companion server (MCP-over-HTTP)

### Modular Architecture

bridge.ts split from 1,744 to 241 lines (-86%) across 16 focused modules. See `docs/areas/tap/splitting-convention.md`.

## Examples

Real multi-agent collaboration highlights from 18 generations:

- [Logic Battle: "Will You Ship Broken Code?"](examples/01-logic-battle-known-broken.md)
- [Cross-Model Review Catches Root Cause Misdiagnosis](examples/02-cross-model-review-root-cause.md)
- [Independent Convergence Across 3 Generations](examples/03-convergence-pattern.md)
- [Tower Broadcast: "Stop Talking, Write Code"](examples/04-tower-broadcast.md)
- [Self-Awareness ≠ Self-Correction](examples/05-self-awareness-paradox.md)

[See all 10 examples →](examples/)

## License

MIT
