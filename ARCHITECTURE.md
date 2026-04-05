# tap Architecture

tap is a local-first collaboration protocol for parallel AI coding sessions.

## Layers

### 1. Protocol Surface

- `commands/`, `hooks/`, `skills/`, `templates/`, `.claude-plugin/`
- Claude-facing plugin surface and mission/comms workflow helpers

### 2. Core Transport

- `channels/`
- File-based MCP server for inbox, reviews, findings, receipts, stats, and presence
- Cross-platform baseline: Windows, Linux, macOS

### 3. Runtime Bridges

- `bridges/`
- Optional real-time delivery adapters for runtimes that need something beyond plain polling
- Current adapters:
  - Codex App Server bridge
  - Gemini polling bridge

### 4. Bootstrap and Ops

- `scripts/`
- Project setup, launch flow, auto-push, shared shell helpers
- `scripts/windows/` is the current Windows reference implementation for launcher and bridge ops

### 5. Documentation and Examples

- `docs/`
- `configs/`
- Runbooks, protocol notes, launch spec, cross-platform guidance, config examples

## Repository Layout

```text
tap/
  bin/              # CLI entry points
  bridges/          # Runtime bridge adapters
  channels/         # MCP server (file-based transport)
  commands/         # CLI command implementations
  configs/          # Config examples
  docs/             # Guides and references
  examples/         # Real multi-agent collaboration highlights (10 excerpts)
  hooks/            # Git/session hooks
  packages/         # Sub-packages
  scripts/          # Bootstrap and ops scripts
  skills/           # Agent skill definitions
  src/              # Core source
  templates/        # File templates
  README.md
  ARCHITECTURE.md
  CHANGELOG.md
```

## Design Rules

- File protocol first, runtime integration second
- Shared inbox is the durable source of truth
- Polling is the safe baseline across runtimes
- Real-time bridges are optional adapters, not the protocol core
- Runtime-specific ops live outside `channels/`
- Windows launcher and bridge tooling is reference-grade today; Unix wrappers are follow-up work

## Platform Model

- `channels/` and file protocol: cross-platform baseline
- `scripts/*.sh`: shell bootstrap and comms helpers
- `scripts/windows/*`: PowerShell launcher, dashboard, and bridge controls
- `bridges/`: runtime adapters, with transport differences isolated from the file protocol

## Multi-Device Model

- A shared comms directory can live outside the project repo
- A Linux hub can own the comms directory and watcher
- Remote runtimes can still join through polling or bridge adapters
- `AppServerUrl` may be remote
- `TAP_COMMS_DIR` is still a path-based local or mounted filesystem view
