# @hua-labs/tap

[![npm version](https://img.shields.io/npm/v/@hua-labs/tap.svg)](https://www.npmjs.com/package/@hua-labs/tap)
[![npm downloads](https://img.shields.io/npm/dm/@hua-labs/tap.svg)](https://www.npmjs.com/package/@hua-labs/tap)
[![license](https://img.shields.io/npm/l/@hua-labs/tap.svg)](https://github.com/HUA-Labs/tap/blob/main/LICENSE)

`@hua-labs/tap` is a lightweight CLI that lets multiple AI agent runtimes, such
as Claude and Codex, exchange messages through a shared file-backed
communication directory.

It focuses on safe setup, durable delivery evidence, and runtime-specific
diagnostics without requiring a central daemon for every runtime.

## Preview Status

`0.6.x` is an advanced operator preview.

- Public defaults use neutral concrete agents such as `agent-a` and `agent-b`.
- `setup` is dry-run-first and only applies reviewed tap-managed changes.
- Profile packs are data-only validation inputs; tap does not run commands from
  a profile pack in `0.6.x`.
- Codex App / Desktop live delivery is experimental and strict-gated by runtime
  health and route freshness.
- Gemini CLI support is legacy/deprecated in this release line. If your
  workflow has moved to Antigravity CLI, treat it as a custom profile-pack
  surface until tap ships a dedicated adapter.

For detailed AI-operator troubleshooting, concepts, and advanced runtime notes,
read [AI_GUIDE.md](./AI_GUIDE.md). AI operators should read it before claiming
live delivery or runtime readiness.

## Requirements

- Node.js `>=22.6.0`
- A git repository for setup-managed MCP config

## Quick Start

Run inside an existing git repository. For a new test directory only:

```bash
git init
```

Then inspect and apply setup:

```bash
# 1. Inspect setup changes first
npx @hua-labs/tap setup --profile codex-cli --dry-run --json

# 2. Apply only reviewed setup-safe changes
npx @hua-labs/tap setup --profile codex-cli --apply --json

# 3. Check setup readiness
npx @hua-labs/tap doctor --setup --profile codex-cli --json
npx @hua-labs/tap status --json
```

To add and verify a concrete runtime lane later:

```bash
npx @hua-labs/tap add codex --name agent-a
npx @hua-labs/tap ready --surface codex-cli --agent agent-a --apply --json
npx @hua-labs/tap comms-doctor --all-known --json
```

## What Setup Changes

`tap setup` is dry-run by default. With `--apply`, the reviewed public setup
path creates tap-owned directories, an initial tap state file, and guarded
tap-managed repo `.mcp.json` entries.

It does **not** start receiver, projection, uplink, bridge, app-server,
headless runner, or remote panel processes. It does not publish presence,
repair route tuples, send messages, or read credentials.

Most users should start with `setup`. Use `init` only when you want to manually
create or reset the shared communication directory and local tap state.

## Supported Public Setup Profiles

| Profile          | Use when                                                                |
| ---------------- | ----------------------------------------------------------------------- |
| `codex-cli`      | Codex CLI or headless CLI will use MCP tools plus inbox/receiver paths. |
| `codex-app`      | Codex App/Desktop route readiness should be inspected read-only.        |
| `claude-channel` | Claude/channel readiness should be inspected read-only.                 |

## Common Commands

### `setup`

Inspect and optionally apply first-run public deployment changes.

```bash
npx @hua-labs/tap setup --profile codex-cli --dry-run --json
npx @hua-labs/tap setup --profile codex-cli --apply --json
npx @hua-labs/tap setup --profile codex-cli --profile-pack ./tap-profile-pack.json --json
```

tap refuses to mutate user-managed or ambiguous MCP entries.

### `ready`

Prepare or verify a concrete agent on a runtime surface.

```bash
npx @hua-labs/tap ready --surface codex-cli --agent agent-a --json
npx @hua-labs/tap ready --surface codex-cli --agent agent-a --apply --json
```

By default, `ready` reports the current or planned readiness state. With
`--apply`, it applies reviewed readiness changes for the selected surface and
agent.

### `init`

Create or reset the shared comms directory and `.tap-comms/` state.

```bash
npx @hua-labs/tap init
npx @hua-labs/tap init --comms-dir /path/to/comms
npx @hua-labs/tap init --permissions safe
npx @hua-labs/tap init --permissions full
```

### `add <runtime>`

Add a runtime instance and patch the runtime config when verification allows it.

```bash
npx @hua-labs/tap add claude
npx @hua-labs/tap add codex --name agent-a
npx @hua-labs/tap add codex --name agent-b --port 4520
```

`gemini` remains accepted for legacy compatibility, but new first-run docs do
not recommend it as a default runtime.

### `status`

Show installed runtimes and their status.

```bash
npx @hua-labs/tap status
npx @hua-labs/tap status --json
```

### `doctor`

Diagnose setup, config drift, bridge health, managed MCP wiring, and runtime
state.

```bash
npx @hua-labs/tap doctor
npx @hua-labs/tap doctor --setup --profile codex-cli --json
```

### `comms-doctor`

Explain delivery by runtime surface, including local inbox evidence and live
adapter readiness.

```bash
npx @hua-labs/tap comms-doctor --all-known --json
npx @hua-labs/tap comms-doctor --agent agent-a --plan-send --json
```

### `flow-doctor`

Diagnose one receiver/promoter lane without mutating process state.

```bash
npx @hua-labs/tap flow-doctor --agent agent-a --json
```

`flow-doctor` is read-only by default. Its reviewed cleanup mode only archives
stale non-lane presence records with a manifest and prunes matching stale
heartbeat entries.

### `reviews register`

Register formal review outcomes into a discoverable review evidence stream.

```bash
npx @hua-labs/tap reviews register --source ./tap-comms --dry-run --json
```

### `serve`

Start the bundled tap MCP server on stdio.

```bash
npx @hua-labs/tap serve
```

### `bridge start|stop|restart`

Manage Codex app-server bridge lifecycle.

```bash
npx @hua-labs/tap bridge start codex --agent-name agent-c
npx @hua-labs/tap bridge stop codex --keep-server
npx @hua-labs/tap bridge restart codex
```

## Core Concepts

- **Runtime**: an AI tool or environment tap can connect to, such as Claude or
  Codex.
- **Agent**: a named participant, such as `agent-a`, that sends or receives
  messages.
- **Surface**: a specific runtime interface, such as `codex-cli` or
  `codex-app`.
- **Comms directory**: the shared file-backed message store for inboxes,
  reviews, handoffs, and evidence.
- **Profile**: a setup target that describes which runtime surface tap should
  inspect or prepare.
- **Profile pack**: a data-only input for validating custom operator
  environments.

## Permissions

Safe mode reduces destructive local file operations. It is not a
network-isolated mode.

- `safe` is the default.
- `full` enables less restricted local runtime settings and should only be used
  on trusted machines.

See [AI_GUIDE.md](./AI_GUIDE.md#permissions-and-safety) for details.

## JSON Output

Most operational commands support `--json` for machine-readable output.

```bash
npx @hua-labs/tap status --json
```

Exit codes use `0` for ok and `1` for error. Error codes use the `TAP_*`
prefix.

## Supported Runtimes

| Runtime | Status                    | Notes                                      |
| ------- | ------------------------- | ------------------------------------------ |
| Claude  | supported                 | Uses `.mcp.json` / channel-style delivery. |
| Codex   | supported                 | Uses CLI, MCP, and app-server surfaces.    |
| Gemini  | legacy / deprecated       | Kept for compatibility only.               |
| Other   | custom profile-pack input | Use data-only profile packs in `0.6.x`.    |

Antigravity CLI is not a bundled adapter in `0.6.x`. Model it as a custom
profile-pack surface until a dedicated integration is released.

## Examples

- Generic profile pack:
  [`examples/tap-profile-pack.example.json`](./examples/tap-profile-pack.example.json)
- Narrative examples:
  [`examples/`](./examples/)

The narrative examples are real collaboration stories, not setup defaults.

## Recent Changes

See [CHANGELOG.md](./CHANGELOG.md) for full release history.

Highlights in `0.6.x`:

- dry-run-first public setup profiles;
- `ready`, `comms-doctor`, and `flow-doctor` for surface-specific diagnostics;
- explicit `tap reviews register` evidence registration;
- profile-pack validation for custom environments;
- stricter broad-role and stale-presence guards;
- packaged AI operator guide and npm provenance publishing.

## License

MIT
