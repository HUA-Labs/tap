# TAP Runtime Validation Checklist

> Cross-platform smoke spec for `tap-comms` core and polling-first runtimes

## Goal

Validate the cross-platform surface that TAP supports today:

- `tap-comms.ts` core
- file protocol compatibility
- polling baseline
- `fs.watch` push behavior as a best-effort enhancement

This checklist is meant to be executed on:

- macOS
- Linux
- Windows as a control run

## Scope Split

### Must Pass

- `tap-comms.ts` starts with explicit `TAP_COMMS_DIR`
- polling clients can exchange direct and broadcast messages
- unread routing matches filename protocol
- receipts and stats match file state
- name validation blocks filename-unsafe names

### Nice To Have

- `fs.watch` push notifications behave consistently
- startup replay suppression is stable across OS-specific watcher behavior

## Environment Preconditions

1. `TAP_COMMS_DIR` points at a writable TAP comms repo.
2. `bun` is available.
3. At least two test agents are available.
4. The repo under test uses the same `tap-comms.ts` revision on every machine.

## Test Matrix

| Area | Windows | macOS | Linux |
|------|---------|-------|-------|
| Explicit `TAP_COMMS_DIR` required | Yes | Yes | Yes |
| Direct message polling | Yes | Yes | Yes |
| Broadcast polling | Yes | Yes | Yes |
| `since` filter | Yes | Yes | Yes |
| BOM strip | Yes | Yes | Yes |
| Name validation | Yes | Yes | Yes |
| Read receipt parity | Yes | Yes | Yes |
| `tap_stats` parity | Yes | Yes | Yes |
| `fs.watch` duplicate suppression | Yes | Yes | Yes |
| `fs.watch` stale replay suppression | Yes | Yes | Yes |

## Smoke Flow

### 1. Startup Guard

1. Start `tap-comms.ts` without `TAP_COMMS_DIR`.
2. Expect fast failure with a fatal message.
3. Restart with a valid absolute `TAP_COMMS_DIR`.

Expected:

- no silent fallback path
- no OS-specific hardcoded path assumptions

### 2. Direct Routing

1. Agent A sets a filename-safe name.
2. Agent B sets a different filename-safe name.
3. Agent A sends a direct message to Agent B.
4. Agent B polls with `tap_list_unread`.

Expected:

- exactly one unread item for Agent B
- `from`, `to`, `subject` parse correctly
- sender does not receive echo-back

### 3. Broadcast Routing

1. Agent A sends a broadcast.
2. Agent B polls unread items.
3. Agent A polls unread items.

Expected:

- Agent B sees the broadcast
- Agent A does not receive its own broadcast as unread

### 4. `since` Filter

1. Poll once and record the current timestamp.
2. Send a new message after that timestamp.
3. Poll with `since=<recorded timestamp>`.

Expected:

- only the newer message appears
- older files are skipped regardless of directory size

### 5. BOM + Unicode

1. Create a message file with UTF-8 BOM.
2. Poll unread items.

Expected:

- content is readable
- no BOM prefix leaks into returned content
- Korean filenames/content do not break parsing

### 6. Name Validation

Try these names with `tap_set_name`:

- allowed: `하루`, `teum`, `agent_1`
- rejected: `granite-signal`, `with space`, `slash/name`, `weird!`

Expected:

- filename-safe subset accepted
- unsafe names rejected with a clear reason

### 7. Receipt + Stats Parity

1. Send a direct message.
2. Read it and save a receipt.
3. Call `tap_stats`.

Expected:

- file-backed receipt exists
- `tap_stats` matches file truth
- SQLite fast path and file fallback describe the same inbox-only traffic

### 8. Watcher Behavior

1. Start a watcher-capable client.
2. Create one new inbox file.
3. Observe whether one notification or multiple notifications arrive.
4. Restart the server and verify old files are not replayed.

Expected:

- duplicate events do not produce duplicate notifications
- stale files from before server start are not replayed

## OS-Specific Notes

### macOS

Watch for:

- duplicate create/rename notifications from FSEvents-backed behavior
- delayed event delivery when files are rewritten quickly

### Linux

Watch for:

- inotify rename/create ordering
- fast repeated writes causing duplicate wakeups

### Windows

Use as the control environment because current launcher/ops scripts are Windows reference implementations.

## Evidence To Capture

For each platform run, keep:

- runtime command used
- OS version
- pass/fail per scenario
- raw failure symptom
- whether the issue is polling-only, watch-only, or protocol-wide

## Findings Rule

If a failure is out of scope for the current fix, record it as a TAP finding instead of silently skipping it.
