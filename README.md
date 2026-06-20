# @hua-labs/tap

Zero-dependency CLI for cross-model AI agent communication setup.

tap connects Claude, Codex, and other agent runtimes through a shared
file-backed communication layer, with setup reports that keep runtime surfaces,
durable evidence, and optional live adapters separate.

## Requirements

- **Node.js ≥ 22.6.0** — tap uses the global `WebSocket` API (stable in Node 22+). Node 20 and earlier are not supported; run with `fnm use 22` or `nvm use 22`.

## Quick Start

> `npx @hua-labs/tap` ships a bundled managed MCP server entry and runs that bundled `.mjs` with `node`. `bun` is only required when tap falls back to repo-local TypeScript sources during monorepo or local-dev workflows.

```bash
# 1. Start in a git repo
git init

# 2. Generate a dry-run setup report for your runtime surface
npx @hua-labs/tap setup --profile codex-cli --dry-run --json

# 3. Apply only reviewed setup-safe changes
npx @hua-labs/tap setup --profile codex-cli --apply --json

# 4. Re-check setup readiness and surface status
npx @hua-labs/tap doctor --setup --profile codex-cli --json
npx @hua-labs/tap status --json

# 5. Add a concrete runtime only when you are ready to patch that runtime
npx @hua-labs/tap add codex --name agent-a
npx @hua-labs/tap ready --surface codex-cli --agent agent-a --apply --json

# 6. Diagnose delivery separately from setup
npx @hua-labs/tap comms-doctor --all-known --json
```

`tap setup` is dry-run by default. The current reviewed apply path creates
tap-owned directories, an initial tap state file, and guarded tap-managed repo
`.mcp.json` entries. It does not start receiver, projection, uplink, bridge,
app-server, headless runner, or remote panel processes, and it does not publish
presence, repair route tuples, send messages, or read credentials.

Supported public setup profiles:

| Profile          | Use when                                                                |
| ---------------- | ----------------------------------------------------------------------- |
| `codex-cli`      | Codex CLI or headless CLI will use MCP tools plus inbox/receiver paths. |
| `codex-app`      | Codex App/Desktop route readiness should be inspected read-only.        |
| `claude-channel` | Claude/channel readiness should be inspected read-only.                 |

HUA-specific machine names, paths, tmux sessions, one-character Korean agent
names, and private profile packs are examples, not package defaults.

For the `0.6.x` preview, release-facing commands use neutral agents such as
`agent-a` and `agent-b`. HUA profiles and paths can be supplied through a
reviewed profile pack or HUA runbook, but they are not package defaults.

## Commands

### `setup`

Generate a dry-run-first setup report for public tap deployment.

```bash
npx @hua-labs/tap setup --profile codex-cli --dry-run --json
npx @hua-labs/tap setup --profile codex-cli --apply --json
TAP_AGENT=agent-a
npx @hua-labs/tap setup --profile codex-app --agent "$TAP_AGENT" --json
npx @hua-labs/tap setup --profile claude-channel --agent "$TAP_AGENT" --json
npx @hua-labs/tap setup --profile codex-cli --profile-pack ./tap-profile-pack.json --json
```

`--apply` is intentionally narrow: create reviewed tap-owned directories, an
initial tap state file, and guarded tap-managed repo `.mcp.json` changes only.
User-managed or ambiguous MCP entries fail closed before mutation.

Profile packs are data-only validation inputs in `0.6.x`; tap reports their
shape and blocks invalid packs before setup mutation, but it does not execute
pack commands. A generic example is shipped at
`examples/tap-profile-pack.example.json`.

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
npx @hua-labs/tap add claude --force                        # re-install
npx @hua-labs/tap add codex --name agent-a --port 4520      # explicit port
npx @hua-labs/tap add codex --name agent-b                  # portMap lookup, else auto-assign
```

For Codex app-server instances, `--name agent-a` is the concrete agent identity
used by `tap ready --agent agent-a`; the managed instance id remains
`codex-agent-a`.

Codex instances bind to an app-server port. Resolution order:

1. `--port <n>` — explicit override.
2. `portMap[<instanceId>]` from `tap-config.json` / `tap-config.local.json` when the
   entry is free (no state claim, TCP-available on loopback).
3. Auto-assign — scan from 4501 upward for the first free port.

`portMap` is a hint, not a hard requirement: a missing entry or a conflict
silently drops through to auto-assign. Convention:

| Port | Instance        | Role               |
| ---- | --------------- | ------------------ |
| 4510 | `codex-agent-a` | Agent A            |
| 4511 | `codex-agent-b` | Agent B            |
| 4512 | `codex-agent-c` | Agent C            |
| 4520 | `codex-agent-d` | Agent D            |
| 4530 | `codex-probe`   | Diagnostic / probe |

```json
{
  "portMap": {
    "codex-agent-a": 4510,
    "codex-agent-b": 4511,
    "codex-agent-d": 4520
  }
}
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
npx @hua-labs/tap status --json
```

Output shows three status levels:

- **installed** — config written but not verified
- **configured** — config written and verified
- **active** — runtime is running and connected

### `doctor`

Diagnose config drift, bridge health, managed MCP wiring, and runtime state.
Use `--setup` for setup/config/warm-up readiness. Use the plain doctor for
broader infrastructure checks.

```bash
npx @hua-labs/tap doctor
npx @hua-labs/tap doctor --fix
npx @hua-labs/tap doctor --setup --profile codex-cli --json
npx @hua-labs/tap doctor --setup --profile codex-cli --profile-pack ./tap-profile-pack.json --json
```

`tap doctor --setup --apply` reuses the same guarded setup apply plan as
`tap setup --apply`. It does not run the broad infrastructure fixer.

### `comms-doctor`

Explain delivery by runtime surface. Use this when you need to separate live
delivery, durable inbox evidence, receiver/promoter paths, MCP/channel
visibility, and fallback evidence.

```bash
npx @hua-labs/tap comms-doctor --all-known --json
TAP_AGENT=agent-b
npx @hua-labs/tap comms-doctor --agent "$TAP_AGENT" --plan-send --json
```

### `flow-doctor`

Diagnose one receiver/promoter lane without mutating process state. Use this
when an agent appears present but the operator needs one report for identity,
receiver dry-run, return-uplink evidence, central presence freshness,
active-turn queue state, and stale presence cleanup candidates.

```bash
TAP_AGENT=agent-a
npx @hua-labs/tap flow-doctor --agent "$TAP_AGENT" --json
npx @hua-labs/tap flow-doctor --agent "$TAP_AGENT" --presence-source-comms-dir ./tap-comms --presence-target-comms-dir ./tap-comms --json
```

`flow-doctor` is read-only by default. Its only reviewed cleanup mutation is
`--apply-stale-presence-cleanup`, which archives stale non-lane presence
records with a manifest and prunes matching stale heartbeat entries. It never
publishes stale presence, restarts processes, changes route tuples, or deletes
inbox/archive evidence.

### `reviews register`

Register formal review outcomes into the review evidence stream. Use this when
review results should be discoverable outside the ordinary inbox flow.

```bash
npx @hua-labs/tap reviews register --source ./tap-comms --dry-run --json
```

The explicit registration path is part of the `0.6.x` preview boundary.
Automatic registration from every tap reply/review writer path is a future
follow-up, so release notes should name the explicit command as the current
workaround.

### `serve`

Start the tap-comms MCP server (stdio). Convenience command for running the MCP server locally.

```bash
npx @hua-labs/tap serve
npx @hua-labs/tap serve --comms-dir /path/to/comms
```

For npm installs, `serve` runs the bundled `mcp-server.mjs` entry with `node`. In monorepos or local checkouts, tap may fall back to repo-local `.ts` sources, which still require `bun`.

### `bridge start|stop|restart`

Manage the Codex app-server bridge lifecycle.

```bash
npx @hua-labs/tap bridge start codex --agent-name agent-c
npx @hua-labs/tap bridge stop codex --keep-server
npx @hua-labs/tap bridge restart codex
```

`bridge stop --keep-server` leaves the managed app-server running and preserves its metadata in instance state so the next `bridge start` or `bridge restart` can reuse the existing session instead of forcing a fresh app-server.

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
    "version": "0.x.y",
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

## Surface-First Delivery Model

tap does not route by display name alone. It asks which runtime surface is
available and what evidence exists:

- CLI/TUI surfaces use durable inbox files plus receiver/promoter loops.
- Claude/channel surfaces use channel readiness and durable inbox fallback.
- Codex App consent-drive / IPC is an experimental live adapter and must see
  fresh explicit runtime health before it is treated as live-ready.
- Inbox and projection files are durable evidence, not proof of live model
  execution.

Use `tap comms-doctor` to inspect these boundaries before claiming live
delivery.

## 0.6 Preview Boundary

`0.6.x` should be described as an advanced operator preview:

- Public defaults use neutral profile ids and concrete agents.
- Receiver/promoter plus durable inbox/projection/uplink evidence is the
  portable backbone for CLI/TUI/headless receive.
- Codex App consent-drive / IPC remains experimental and strict-gated.
- HUA machine topology, tmux sessions, one-character agent names, and
  mission/devlog governance are examples or profile-pack inputs.
- Broad role aliases such as `codex`, `reviewer`, `implementer`,
  `implementation`, and `tower` are unsafe assignment targets unless a reviewed
  role mapping makes them unambiguous.
- Archive-audit commands remain preserved, but they are not part of the
  first-run package story.

For AI-facing troubleshooting and first-run detail, read the package-local
[AI Guide](./AI_GUIDE.md).

## Recent Changes

### Config And Lifecycle

- **Layered config resolution** — ConfigSource-based loading, instance config isolation, and runtime drift detection reduce cross-instance config bleed-through
- **Managed lifecycle** — server lifecycle state, dual-session prevention, and health monitoring make bridge startup and recovery more predictable
- **Repair path** — `tap doctor --fix` can now repair more managed config drift, including Codex MCP table mismatches

### Identity And Routing

- **Permission mode + routing** — permission mode support, qualified name routing, and the name-claim protocol tighten runtime identity semantics
- **Claim safety** — same-instance claim stealing is blocked while a live claim is still valid, while expired claims can still be reclaimed safely

### Bridge And Runtime Updates

- **Bridge split and cleanup** — the legacy `bridge.ts` monolith was split into focused modules, then the old wrapper logic was removed
- **Codex MCP defaults** — managed Codex installs now persist `[mcp_servers.tap] approval_mode = "auto"` and re-sync the runtime config hash when tap rewrites managed config
- **Bundled MCP runtime** — bundled `.mjs` server entries now prefer `node`; repo-local TypeScript sources still use `bun`
- **Hotfixes** — ESM `require()` breakage, temp file leaks in name claims, and claim-stealing edge cases were fixed during publish prep

### Trust Layer And Delivery

- **Shared vs runtime state split** — `TAP_STATE_DIR` remains the shared source of truth while `TAP_RUNTIME_STATE_DIR` is reserved for per-bridge runtime files, so headless restarts and later TUI attaches keep the same identity contract
- **Attached TUI rebind** — Codex TUI attach can now recover `agentId` and `agentName` from runtime heartbeat and agent-name files without relying on per-session env injection
- **State surface alignment** — bridge status, runtime heartbeat, and presence now read from the same state surfaces, reducing mismatches between `tap status`, bridge state, and plugin-visible presence
- **Broadcast dedupe** — bridge-dispatched notifications are deduplicated so one broadcast does not fan out twice
- **Ack storm prevention** — peer DM auto-replies are rate-limited to stop acknowledgement loops from flooding the inbox

### Test Hardening

- **CLI-path coverage** — integration tests now exercise the actual `bridge` and `up` command paths that patch Codex `approval_mode`
- **Publish prep stabilization** — failing suites were fixed or quarantined so release-blocking regressions show up earlier in the main package tests

## Migration Notes

- **No hard breaking API change is intended in this release train**, but managed runtime defaults changed. Treat this as an operational migration, especially for Codex setups.
- **Bundled MCP command changed for packaged installs** — if your managed `config.toml` still points bundled tap MCP entries at `bun`, rerun `npx @hua-labs/tap add codex --force` or `npx @hua-labs/tap doctor --fix` so bundled `.mjs` entries switch to `node`.
- **Repo-local source workflows still use `bun`** — local monorepo or source-checkout paths can still resolve to `.ts` server entries, so keep `bun` installed for development workflows.
- **Codex approval mode should be `auto`** — managed Codex installs are expected to end up with `[mcp_servers.tap] approval_mode = "auto"`. `tap doctor --fix` will repair stale managed tables.
- **Restart Codex bridges after upgrading** — managed bridge launches now export both `TAP_STATE_DIR` and `TAP_RUNTIME_STATE_DIR`; restart existing bridge processes so headless/runtime identity repair is active end-to-end.

## License

MIT
