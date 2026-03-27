# tap CLI Reference

> `@hua-labs/tap` — Cross-model AI agent communication setup

## Installation

```bash
npx @hua-labs/tap <command>
# or globally
npm install -g @hua-labs/tap
```

## Commands

### `init`

Initialize comms directory and tap state for the current repo.

```bash
tap init
```

| Code                      | Meaning                                         |
| ------------------------- | ----------------------------------------------- |
| `TAP_INIT_OK`             | Initialized successfully                        |
| `TAP_ALREADY_INITIALIZED` | Already initialized — use `tap status` to check |

### `add <runtime>`

Add a runtime instance (claude, codex, gemini). Patches the runtime's config file with MCP server entry.

```bash
tap add claude
tap add codex
tap add codex --agent-name reviewer
tap add codex --name reviewer --port 4502
tap add gemini
```

**Options:**

- `--name <name>` — Instance name suffix (e.g. `codex-reviewer`)
- `--agent-name <name>` — Stored display/bridge name for codex; defaults to the instance ID if omitted
- `--port <number>` — Bridge port (auto-assigned from 4501 if omitted)
- `--headless` — Enable headless mode (codex only)
- `--role <role>` — Headless role: `reviewer`, `validator`, `long-running`

| Code                       | Meaning                                            |
| -------------------------- | -------------------------------------------------- |
| `TAP_ADD_OK`               | Instance added and config patched                  |
| `TAP_RUNTIME_UNKNOWN`      | Unknown runtime — supported: claude, codex, gemini |
| `TAP_RUNTIME_NOT_FOUND`    | Runtime CLI not installed on system                |
| `TAP_PORT_CONFLICT`        | Port already used by another instance              |
| `TAP_PATCH_FAILED`         | Config file write failed                           |
| `TAP_LOCAL_SERVER_MISSING` | MCP server entry not found locally                 |
| `TAP_VERIFY_FAILED`        | Post-add verification failed                       |
| `TAP_NOT_INITIALIZED`      | Run `tap init` first                               |
| `TAP_NO_OP`                | Instance already installed                         |
| `TAP_INVALID_ARGUMENT`     | Bad flag value (port, name format, etc.)           |

### `remove <instance>`

Remove an instance and rollback its config changes.

```bash
tap remove codex
tap remove codex-reviewer
```

| Code                  | Meaning                                     |
| --------------------- | ------------------------------------------- |
| `TAP_REMOVE_OK`       | Instance removed, config restored           |
| `TAP_ROLLBACK_FAILED` | Removal succeeded but config restore failed |
| `TAP_NOT_INITIALIZED` | Run `tap init` first                        |
| `TAP_NO_OP`           | Instance not found or not installed         |

### `status`

Show installed instances, bridge states, and health.

```bash
tap status
tap status --json
```

| Code                  | Meaning              |
| --------------------- | -------------------- |
| `TAP_STATUS_OK`       | Status retrieved     |
| `TAP_NOT_INITIALIZED` | Run `tap init` first |

### `bridge <subcommand> [instance]`

Manage bridge connections between runtimes and comms.

```bash
# Start
tap bridge start codex --agent-name myAgent
tap bridge start codex --agent-name myAgent --no-server
tap bridge start --all

# Stop
tap bridge stop codex
tap bridge stop                   # stop all

# Status
tap bridge status
tap bridge status codex
```

**Start options:**

- `--agent-name <name>` — Agent identity override for bridge start; `tap add codex` already stores one by default
- `--all` — Start all registered app-server instances
- `--no-server` — Don't auto-start app-server (connect to existing)
- `--no-auth` — Skip auth gateway; app-server listens directly on public port (localhost only)
- `--busy-mode <steer|wait>` — How to handle active turns (default: steer)
- `--poll-seconds <n>` — Inbox poll interval (default: 5)
- `--reconnect-seconds <n>` — Reconnect delay (default: 5)
- `--headless` — Enable headless mode ad-hoc
- `--role <role>` — Headless role
- `--ephemeral` — Don't persist thread
- `--process-existing-messages` — Process all existing inbox messages

**Start output (managed mode):**

When using managed mode, the output includes a `TUI connect:` line:

```
✔ Bridge started (PID: 12345)
  App server:   healthy, managed pid:6789, ws://127.0.0.1:4501
  TUI connect:  ws://127.0.0.1:7785    # auth mode: upstream URL
  # or
  TUI connect:  ws://127.0.0.1:4501    # --no-auth: same as public URL
```

| Code                        | Meaning                                          |
| --------------------------- | ------------------------------------------------ |
| `TAP_BRIDGE_START_OK`       | Bridge started                                   |
| `TAP_BRIDGE_START_FAILED`   | Start failed — check logs                        |
| `TAP_BRIDGE_STOP_OK`        | Bridge stopped                                   |
| `TAP_BRIDGE_NOT_RUNNING`    | No bridge running for this instance              |
| `TAP_BRIDGE_SCRIPT_MISSING` | Bridge script not found                          |
| `TAP_BRIDGE_STATUS_OK`      | Status query succeeded                           |
| `TAP_NO_OP`                 | Runtime uses native-push mode — no bridge needed |
| `TAP_NOT_INITIALIZED`       | Run `tap init` first                             |
| `TAP_INSTANCE_NOT_FOUND`    | Instance not registered — run `tap add`          |
| `TAP_INVALID_ARGUMENT`      | Bad flag value                                   |

### `serve`

Start the tap MCP server (stdio transport). Used internally by runtime configs.

```bash
tap serve
```

| Code                     | Meaning                     |
| ------------------------ | --------------------------- |
| `TAP_SERVE_OK`           | MCP server exited cleanly   |
| `TAP_SERVE_BUN_REQUIRED` | Requires bun for .ts source |
| `TAP_SERVE_NO_SERVER`    | MCP server entry not found  |
| `TAP_NOT_INITIALIZED`    | Run `tap init` first        |

### `init-worktree`

Set up a new git worktree with tap configuration.

```bash
tap init-worktree --path ../hua-wt-3 --branch feat/my-feature
```

### `dashboard`

Show unified ops dashboard with all instances and bridges.

```bash
tap dashboard
```

### `version`

```bash
tap version
```

## Global Options

- `--help, -h` — Show help
- `--json` — Machine-readable JSON output (all commands)
- `--comms-dir <path>` — Override comms directory path

## Error Code Reference

All CLI commands return a `CommandResult` with a `code` field. Success codes end in `_OK`, error codes describe the failure.

| Category | Code                        | Description                         |
| -------- | --------------------------- | ----------------------------------- |
| Generic  | `TAP_INVALID_ARGUMENT`      | Invalid CLI argument                |
| Generic  | `TAP_INTERNAL_ERROR`        | Unexpected internal error           |
| Generic  | `TAP_NOT_INITIALIZED`       | Run `tap init` first                |
| Generic  | `TAP_NO_OP`                 | Nothing to do                       |
| Instance | `TAP_INSTANCE_AMBIGUOUS`    | Multiple matches — be more specific |
| Instance | `TAP_INSTANCE_NOT_FOUND`    | Instance not registered             |
| Init     | `TAP_INIT_OK`               | Initialized                         |
| Init     | `TAP_ALREADY_INITIALIZED`   | Already initialized                 |
| Add      | `TAP_ADD_OK`                | Instance added                      |
| Add      | `TAP_RUNTIME_UNKNOWN`       | Unknown runtime name                |
| Add      | `TAP_RUNTIME_NOT_FOUND`     | Runtime CLI not installed           |
| Add      | `TAP_PORT_CONFLICT`         | Port already in use                 |
| Add      | `TAP_PATCH_FAILED`          | Config write failed                 |
| Add      | `TAP_LOCAL_SERVER_MISSING`  | MCP server not found locally        |
| Add      | `TAP_VERIFY_FAILED`         | Post-add verification failed        |
| Remove   | `TAP_REMOVE_OK`             | Instance removed                    |
| Remove   | `TAP_ROLLBACK_FAILED`       | Config restore failed               |
| Bridge   | `TAP_BRIDGE_START_OK`       | Bridge started                      |
| Bridge   | `TAP_BRIDGE_START_FAILED`   | Start failed                        |
| Bridge   | `TAP_BRIDGE_STOP_OK`        | Bridge stopped                      |
| Bridge   | `TAP_BRIDGE_NOT_RUNNING`    | No bridge running                   |
| Bridge   | `TAP_BRIDGE_SCRIPT_MISSING` | Script not found                    |
| Bridge   | `TAP_BRIDGE_STATUS_OK`      | Status query OK                     |
| Serve    | `TAP_SERVE_OK`              | Server exited cleanly               |
| Serve    | `TAP_SERVE_BUN_REQUIRED`    | Bun required                        |
| Serve    | `TAP_SERVE_NO_SERVER`       | MCP server not found                |
| Config   | `TAP_CONFIG_INVALID`        | Config file invalid                 |
| Review   | `TAP_REVIEW_START_OK`       | Headless review started             |
| Review   | `TAP_REVIEW_TERMINATED`     | Headless review ended               |
| Status   | `TAP_STATUS_OK`             | Status OK                           |
