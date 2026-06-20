# @hua-labs/tap AI Guide

This guide is for AI operators using the public `@hua-labs/tap` package without
access to HUA's private monorepo notes.

## Release Boundary

`0.6.x` is an advanced operator preview. It helps AI runtimes produce durable
communication evidence and inspect setup state, but it does not guarantee live
model execution in every app surface.

Keep these boundaries explicit:

- Inbox, projection, uplink, and review files are durable evidence.
- Receiver/promoter delivery is the portable CLI/TUI/headless backbone.
- Codex App / Desktop live delivery is strict-gated by runtime health and route
  freshness.
- `tap reviews register` is explicit; automatic registration from every writer
  path is a later follow-up.
- Profile packs are data-only validation inputs in `0.6.x`; tap does not run
  commands from a pack.

## First-Run Path

Run from a git repository:

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

## Expected Fresh-Install Results

- `tap setup --apply --json` should return setup evidence without starting
  receiver, projection, uplink, app-server, or remote-panel processes.
- `tap status --json` may show zero installed instances until `tap add` runs.
- `tap ready --surface codex-cli --agent agent-a --apply --json` should publish
  readiness for the concrete `agent-a` lane.
- `tap comms-doctor --all-known --json` should diagnose locally installed or
  observed agents. Bundled operator profile surfaces require explicit
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

If you are using `npx` without a local install, create `tap-profile-pack.json`
from the example shape below or install the package as a dev dependency first.

Profile-pack paths are not auto-corrected because each operator may keep the
repo, comms directory, state directory, and runtime surfaces in different
places. Use paths that are valid on the machine where the command runs:

- `paths.repoRoot`: the repository where tap commands run;
- `paths.commsDir`: the durable comms directory for inbox/projection/evidence;
- command snippets: reviewed operator hints only; tap validates them but does
  not execute them in `0.6.x`.

If the pack is invalid, `tap setup --apply` blocks before writing setup
artifacts. Repair the reported JSON path, or rerun without `--profile-pack`.

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

Rerun current `tap setup --profile codex-cli --apply --json`. The reviewed
setup apply path writes guarded tap-managed `.mcp.json` entries with a `cwd`
field. If an existing user-managed MCP entry is ambiguous, tap fails closed
instead of overwriting it.

### `tap comms-doctor --all-known` shows app/live blockers

That can be expected on a fresh auth-free machine. Check whether inbox and
receiver evidence are healthy before claiming live delivery is broken. App live
delivery needs runtime health and route freshness that package setup cannot
invent.

### Profile-pack validation passes but nothing starts

That is expected in `0.6.x`. Profile packs are data-only. Commands in a pack
must be reviewed manually and remain `defaultEnabled: false`.

### A command lists a bundled operator profile you do not recognize

Treat it as a compatibility profile, not a public default. Some legacy helper
surfaces remain discoverable for operators who already own those local runbooks,
paths, and process managers. For a new install, use neutral concrete agents
such as `agent-a`, or provide a reviewed local profile pack. Do not copy a
profile command unless you own every path, host, and process name it references.

### Profile-pack paths are wrong after moving machines

Edit the pack for the current machine. Prefer repo-relative paths when the
comms directory is inside the repo, and absolute paths when the comms directory
is shared outside the repo. Do not copy another machine's host paths blindly.

### Source package says `0.6.0` but npm shows an older version

Treat `package.json` version and public npm registry state separately. Verify
the registry with:

```bash
npm view @hua-labs/tap version time.modified --json
```
