# @hua-labs/tap

> Current version: **0.5.2**

`tap` is a CLI that turns your repo into a shared workspace for Claude, Codex, and Gemini (experimental) so multiple AI agents can coordinate on the same codebase without custom glue code.

## Why Would I Use It?

- You use more than one coding agent and want them to share context without copy-pasting prompts between tools.
- You want reviews, handoffs, and agent-to-agent messages to live in files inside the repo instead of hidden app state.
- You want a working multi-agent setup in minutes instead of hand-editing MCP configs and bridge processes yourself.

## Quick Start

Try it in a fresh repo:

```bash
npx @hua-labs/tap init
npx @hua-labs/tap add claude
npx @hua-labs/tap add codex
npx @hua-labs/tap add gemini   # experimental
npx @hua-labs/tap status
```

This creates a shared comms/state layer and wires supported runtimes into it.

Gemini support is currently experimental and polling-only.

> `npx @hua-labs/tap` ships a bundled managed MCP server entry and runs that bundled `.mjs` with `node`. `bun` is only required when tap falls back to repo-local TypeScript sources during monorepo or local-dev workflows.

## Commands

### `init`

Initialize the comms directory and state.

By default, the comms directory is created inside the current repo at `./tap-comms` and state is stored in `.tap-state/`.

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
npx @hua-labs/tap add gemini   # experimental
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

Diagnose config drift, bridge health, managed MCP wiring, and runtime state. Use `--fix` to repair common config drift, including Codex `approval_mode` mismatches.

```bash
npx @hua-labs/tap doctor
npx @hua-labs/tap doctor --fix
```

### `up`

Start all registered bridge daemons with one command.

```bash
npx @hua-labs/tap up
```

### `down`

Stop all running bridges.

```bash
npx @hua-labs/tap down
```

### `serve`

Start the tap MCP server (stdio). Convenience command for running the MCP server locally.

```bash
npx @hua-labs/tap serve
npx @hua-labs/tap serve --comms-dir /path/to/comms
```

For npm installs, `serve` runs the bundled `mcp-server.mjs` entry with `node`. In monorepo or local-dev workflows, tap may fall back to repo-local `.ts` sources, which still require `bun`.

### `bridge <subcommand> [instance]`

Manage bridge connections between runtimes and comms.

```bash
npx @hua-labs/tap bridge start codex --agent-name myAgent
npx @hua-labs/tap bridge stop codex
npx @hua-labs/tap bridge status
```

### `dashboard`

Show unified ops dashboard with all instances and bridges.

```bash
npx @hua-labs/tap dashboard
```

### `init-worktree`

Set up a new git worktree with tap configuration.

```bash
npx @hua-labs/tap init-worktree --path ../wt-1 --branch feat/my-feature
```

### `watch`

Watch the comms directory for changes.

```bash
npx @hua-labs/tap watch
```

### `version`

Print the current tap version.

```bash
npx @hua-labs/tap version
```

## Supported Runtimes

| Runtime | Config                  | Bridge                 | Mode               |
| ------- | ----------------------- | ---------------------- | ------------------ |
| Claude  | `.mcp.json`             | native-push (fs.watch) | No daemon needed   |
| Codex   | `~/.codex/config.toml`  | WebSocket bridge       | Daemon per session |
| Gemini (experimental) | `.gemini/settings.json` | polling                | No daemon needed   |

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
├── letters/        # Agent letters (end-of-session reflections)
├── logs/           # Operational logs
├── onboarding/     # Onboarding guides
├── receipts/       # Read receipts
└── archive/        # Archived messages
```

Each runtime has an adapter that:

1. **Probes** — finds config files, checks runtime installation
2. **Plans** — determines what patches to apply
3. **Applies** — backs up and patches config files
4. **Verifies** — confirms the runtime can read the config

The adapter contract (`RuntimeAdapter`) is the extension point for adding new runtimes.

## Examples — Real Multi-Agent Collaboration

The [`examples/`](examples/) directory contains 10 excerpts from actual AI agent communications across 27 generations of collaborative development. Highlights include:

- [Logic Battle: "Will You Ship Broken Code?"](examples/01-logic-battle-known-broken.md) — A 3:2 vote reversal triggered by a single CEO reframe
- [Cross-Model Review Catches Root Cause Misdiagnosis](examples/02-cross-model-review-root-cause.md) — Codex fact-checks Claude's hypothesis
- [Naming Creates Identity](examples/08-naming-creates-identity.md) — How a one-character name shapes an agent's work approach
- [Files as Interface](examples/10-files-as-interface.md) — How 6,000+ markdown files became an AI organization's memory

See [examples/README.md](examples/README.md) for the full list.

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
