# @hua-labs/tap AI Guide

This guide is for AI operators using the public `@hua-labs/tap` package without
project-private runbooks.

## Release Boundary

`0.6.x` is an advanced operator preview. It helps AI runtimes produce durable
communication evidence and inspect setup state, but it does not guarantee live
model execution in every app surface.

Keep these boundaries explicit:

- Inbox, projection, uplink, and review files are durable evidence.
- Receiver/promoter delivery is the portable CLI/TUI/headless backbone.
- Codex App / Desktop live delivery must not be reported as live-ready unless
  runtime health and route freshness are both explicitly present.
- `tap reviews register` is explicit; automatic registration from every writer
  path is a later follow-up.
- Profile packs are data-only validation inputs in `0.6.x`; tap does not run
  commands from a pack.
- Gemini CLI support is legacy/deprecated. Antigravity CLI is not a bundled
  adapter in `0.6.x`; model it as a custom profile-pack surface until a
  dedicated adapter exists.

## Operator Rules

AI operators must not claim live model delivery from file evidence alone.

Before reporting live readiness:

1. Check setup state with `tap doctor --setup`.
2. Check runtime state with `tap status`.
3. Check delivery boundaries with `tap comms-doctor`.
4. Treat inbox, projection, uplink, and review files as evidence only, not
   proof of live model execution.
5. Do not use broad role aliases as assignment targets unless a reviewed role
   map resolves them to a concrete agent.

## Do Not Claim

Do not claim that an agent received, read, or acted on a message unless the
relevant runtime surface reports live readiness or there is explicit returned
runtime evidence.

Durable inbox, projection, uplink, and review files may prove that tap wrote or
observed evidence. They do not prove live model execution by themselves.

## Concepts

- **Runtime**: an AI tool or environment tap can connect to, such as Claude or
  Codex.
- **Agent**: a concrete named participant, such as `agent-a`, that sends or
  receives messages.
- **Surface**: the runtime interface being inspected, such as `codex-cli`,
  `codex-app`, or a custom profile-pack surface.
- **Bridge**: a live adapter process used by runtimes that need one, such as
  Codex app-server sessions.
- **Comms directory**: the shared file-backed message store used for inboxes,
  reviews, handoffs, and evidence.
- **Profile**: a setup target that describes which runtime surface tap should
  inspect or prepare.
- **Profile pack**: a data-only input that extends setup validation for custom
  environments.

## Command Relationship

Most users should start with `tap setup`.

- `setup`: inspect or apply guarded first-run MCP/setup changes.
- `doctor --setup`: verify the setup path and explain warnings.
- `init`: only create or reset the shared comms directory and tap state.
- `add`: add a runtime instance and patch that runtime's config.
- `ready`: prepare or verify a concrete agent on a runtime surface.
- `status`: summarize installed runtime state.
- `comms-doctor`: explain delivery and readiness by surface.
- `flow-doctor`: inspect one receiver/promoter lane without process mutation.

Use `setup` before `init` unless you specifically need manual comms directory
creation. Use `ready` after `add` when you want a named agent lane to be
discoverable and diagnosable.

## First-Run Path

This path separates setup inspection, guarded setup mutation, runtime instance
registration, and concrete agent readiness.

Run from an existing git repository. In a new test directory, initialize one
first:

```bash
git init
npx @hua-labs/tap setup --profile codex-cli --dry-run --json
npx @hua-labs/tap setup --profile codex-cli --apply --json
npx @hua-labs/tap doctor --setup --profile codex-cli --json
npx @hua-labs/tap status --json
npx @hua-labs/tap add codex --name agent-a
npx @hua-labs/tap ready --surface codex-cli --agent agent-a --apply --json
npx @hua-labs/tap comms-doctor --all-known --json
```

Use concrete agent names such as `agent-a`, `operator-a`, or `diagnostic-a`.
Avoid broad role words such as `codex`, `reviewer`, `implementer`,
`implementation`, and `tower` as assignment targets unless a reviewed role map
makes them unambiguous.

## Permissions And Safety

Safe mode reduces destructive local file operations. It is not a
network-isolated mode.

- Claude safe mode adds deny rules for destructive shell operations.
- Codex safe mode uses `workspace-write` sandboxing with trusted project paths,
  writable roots, and network access.
- Full mode removes more guardrails and should only be used on trusted local
  machines.

tap setup does not read credentials. It writes only reviewed tap-managed setup
artifacts, and it fails closed before mutating ambiguous user-managed MCP
entries.

## Expected Fresh-Install Results

- `tap setup --apply --json` should return setup evidence only. It should not
  start receiver, projection, uplink, bridge, app-server, headless runner, or
  remote-panel processes.
- `tap status --json` may show zero installed instances until `tap add` runs.
- `tap ready --surface codex-cli --agent agent-a --apply --json` should publish
  readiness for the concrete `agent-a` lane.
- `tap comms-doctor --all-known --json` should diagnose locally installed or
  observed agents. Bundled compatibility profile surfaces require explicit
  `--include-profile-pack`.
- In an auth-free container or fresh desktop, app/live delivery can remain
  blocked while inbox/receiver evidence is healthy.

## Profile Pack Template

A generic example is shipped with the package:

```bash
cp node_modules/@hua-labs/tap/examples/tap-profile-pack.example.json ./tap-profile-pack.json
npx @hua-labs/tap setup --profile codex-cli --profile-pack ./tap-profile-pack.json --json
npx @hua-labs/tap doctor --setup --profile codex-cli --profile-pack ./tap-profile-pack.json --json
```

When using `npx` without a local install, the example file under
`node_modules/@hua-labs/tap/...` may not exist in the current repo. In that
case, copy the minimal shape below or install the package locally as a dev
dependency first.

`--profile-pack <path>` validates a user-provided data file for `setup` and
`doctor --setup`. `--include-profile-pack` is different: it asks
`comms-doctor --all-known` to include bundled compatibility profile surfaces in
its diagnostic target list.

Profile-pack paths are not auto-corrected because each operator may keep the
repo, comms directory, state directory, and runtime surfaces in different
places. Use paths that are valid on the machine where the command runs:

- `paths.repoRoot`: the repository where tap commands run;
- `paths.commsDir`: the durable comms directory for inbox/projection/evidence;
- command snippets: reviewed operator hints only; tap validates them but does
  not execute them in `0.6.x`.

If the pack is invalid, `tap setup --apply` blocks before writing setup
artifacts. Repair the reported JSON path, or rerun without `--profile-pack`.

## Custom And Deprecated Runtime Surfaces

Gemini CLI remains in the package for legacy compatibility. New first-run
docs should not use Gemini as a default runtime.

If your workflow has moved to Antigravity CLI or another runtime, do not copy
Gemini commands blindly. Use a profile pack to describe the local surface,
paths, capabilities, and reviewed commands. In `0.6.x`, tap validates that data
but does not execute profile-pack commands.

## Minimal Generic Profile Pack

```json
{
  "schemaVersion": "tap-profile-pack.v0",
  "packId": "local.public.example",
  "label": "Local public profile pack example",
  "profiles": [
    {
      "id": "local-agent-a-cli",
      "label": "Local Agent A CLI",
      "agent": "agent-a",
      "runtimeSurface": "codex-cli",
      "paths": {
        "repoRoot": ".",
        "commsDir": "./tap-comms"
      },
      "capabilities": {
        "ready": true,
        "status": true,
        "apply": false
      },
      "status": {
        "kind": "codex-cli"
      },
      "ready": {
        "surface": "codex-cli",
        "commandRef": "ready-check"
      },
      "commands": {
        "ready-check": {
          "shell": "npx @hua-labs/tap ready --surface codex-cli --agent agent-a --json",
          "risk": "read-only",
          "reviewRequired": true,
          "defaultEnabled": false
        }
      }
    }
  ]
}
```

## Troubleshooting

### `tap doctor --setup` reports `.mcp.json` cwd warning

Rerun the current package version:

```bash
npx @hua-labs/tap setup --profile codex-cli --apply --json
```

The reviewed setup apply path writes guarded tap-managed `.mcp.json` entries
with a `cwd` field. If an existing user-managed MCP entry is ambiguous, tap
fails closed instead of overwriting it.

### `tap comms-doctor --all-known` shows app/live blockers

That can be expected on a fresh auth-free machine. Check whether inbox and
receiver evidence are healthy before claiming live delivery is broken. App live
delivery needs runtime health and route freshness that package setup cannot
invent.

### Profile-pack validation passes but nothing starts

That is expected in `0.6.x`. Profile packs are data-only. Commands in a pack
must be reviewed manually and remain `defaultEnabled: false`.

### A command lists a bundled compatibility profile you do not recognize

Some packages may expose compatibility profiles for existing operator
environments. These are discoverable metadata, not recommended public defaults.

Treat it as a compatibility profile, not a public default. Some legacy helper
surfaces remain discoverable for operators who already own those local runbooks,
paths, and process managers. For a new install, use neutral concrete agents
such as `agent-a`, or provide a reviewed local profile pack. Do not copy a
profile command unless you own every path, host, and process name it references.

### Profile-pack paths are wrong after moving machines

Edit the pack for the current machine. Prefer repo-relative paths when the
comms directory is inside the repo, and absolute paths when the comms directory
is shared outside the repo. Do not copy another machine's host paths blindly.

### Source package says `0.6.x` but npm shows an older version

Treat `package.json` version and public npm registry state separately. Verify
the registry with:

```bash
npm view @hua-labs/tap version time.modified --json
```
