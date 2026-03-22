# Codex App Server Bridge Deep Dive

> Detailed implementation log for how tap crossed from file-based inboxes into a live Codex TUI on 2026-03-21.

## Why this document exists

The public write-up explains **what** tap is and **why** it matters.

This document explains the narrower technical question:

- what we tried
- what failed
- what changed
- what finally worked

The target was very specific:

> make a message written by another agent show up inside a live Codex terminal session, not just inside a background worker log.

## Success criteria

We treated the work as successful only when all of these were true:

1. another agent writes a normal tap inbox file
2. a Codex-side bridge sees it without manual relaying
3. the bridge injects it into the same visible Codex TUI thread
4. the TUI actually renders it
5. the path is durable enough to survive daemon/background operation

Anything less was treated as partial progress, not success.

## Phase 0: identify the official surface

### Hypothesis

Codex probably does not expose a user-facing "channels" primitive, but it may expose a lower-level protocol that can be used for external input injection.

### What we checked

- local CLI help:
  - `codex --help`
  - `codex exec --help`
  - `codex app-server --help`
- official OpenAI docs:
  - Codex App Server
  - Codex app / remote TUI surfaces

### Result

- no Claude Channels equivalent was found for Codex CLI
- `codex app-server` existed
- `codex --remote` existed
- App Server docs exposed:
  - `thread/start`
  - `turn/start`
  - `turn/steer`
  - `turn/interrupt`

### Decision

The path forward was:

1. run Codex behind App Server
2. attach the visible TUI to that App Server
3. connect a second client that converts tap inbox files into App Server turns

This was the first point where the problem moved from “maybe impossible” to “probably doable.”

## Phase 1: raw App Server protocol spike

### Hypothesis

Before building any bridge code, we needed to prove that a second client could speak JSON-RPC to Codex App Server at all.

### First obstacle

Inside the Codex tool sandbox, `codex app-server` could not read the default user config and failed with:

```text
Error: error loading default config after config error: 액세스가 거부되었습니다. (os error 5)
```

### What we changed

We redirected the Codex home/config paths into a workspace-local temp area:

- `HOME`
- `USERPROFILE`
- `XDG_CONFIG_HOME`
- `CODEX_HOME`

### What we verified

With that isolated home, the raw protocol was good enough to continue:

- `initialize` succeeded
- `thread/start` succeeded with minimal params
- `turn/start` could be issued

We also found a useful boundary:

```text
thread/start.persistFullHistory requires experimentalApi capability
```

That told us two things:

- the server was really enforcing protocol capabilities
- we should stay on the minimum supported surface first

### Why this was only partial success

The sandbox-local App Server did not have the user’s normal authenticated Codex context, so it was enough for protocol proof, not for final UX proof.

## Phase 2: remote TUI path discovery

### Hypothesis

Even if App Server works, the visible TUI path might still be blocked behind a feature flag or require a real terminal.

### Attempt 1

```powershell
codex --remote ws://127.0.0.1:4501 --no-alt-screen
```

### Result

```text
ERROR: `--remote` requires the `tui_app_server` feature flag to be enabled.
```

### Attempt 2

```powershell
codex --enable tui_app_server --remote ws://127.0.0.1:4501 --no-alt-screen
```

### Result

```text
Error: stdout is not a terminal
```

### Interpretation

- the remote TUI path was real
- it was gated by `tui_app_server`
- it required a real interactive TTY

This was important because it meant hidden smoke tests were not enough. We needed a real user-side terminal.

## Phase 3: real terminal confirmation

### User-side run

```powershell
codex app-server --listen ws://127.0.0.1:4501
codex --enable tui_app_server --remote ws://127.0.0.1:4501
```

### Result

The remote Codex TUI actually opened against the App Server on `ws://127.0.0.1:4501`.

That removed the biggest uncertainty in the whole design. Up to this point, the protocol looked promising. After this point, the terminal path was real.

## Phase 4: minimal bridge client

### Goal

Replace “spawn a separate `codex exec` worker” with “inject into the already visible thread.”

### What we built

- [`scripts/codex-app-server-bridge.ts`](/D:/HUA/hua-platform/scripts/codex-app-server-bridge.ts)
- [`scripts/codex-app-server-bridge-start.ps1`](/D:/HUA/hua-platform/scripts/codex-app-server-bridge-start.ps1)
- [`scripts/codex-app-server-bridge-status.ps1`](/D:/HUA/hua-platform/scripts/codex-app-server-bridge-status.ps1)
- [`scripts/codex-app-server-bridge-stop.ps1`](/D:/HUA/hua-platform/scripts/codex-app-server-bridge-stop.ps1)

### Thread selection strategy

The bridge uses this order:

1. explicit thread id, if provided
2. currently loaded App Server thread with matching `cwd`
3. saved thread state from `thread.json`
4. fresh `thread/start`

That ordering mattered because “same terminal, same worktree” was the desired experience.

### First successful one-shot dispatch

```text
attached to loaded thread 019d107b-b366-7e90-b503-4688f0311454
dispatched 20260321-결-온-phase2-참고자료.md to thread 019d107b-b366-7e90-b503-4688f0311454
```

### What that proved

- the second client could discover the loaded TUI thread
- it could attach to that thread
- it could send `turn/start`

At this point, injection into the same thread was real, but visible TUI rendering still needed direct proof.

## Phase 5: prove visible TUI rendering

### Problem

App Server requests returning successfully does **not** prove the human-visible TUI updated.

### What we built

- [`scripts/codex-app-server-probe.ts`](/D:/HUA/hua-platform/scripts/codex-app-server-probe.ts)

The probe did two separate checks:

1. send `turn/start` into an idle TUI
2. send `turn/steer` into an already active turn

### What the user saw

The remote TUI rendered:

- the injected start probe prompt
- the follow-up steer probe instruction

One captured example was the `START-PROBE` / `STEER-PROBE-OK` sequence rendered directly inside the remote Codex interface.

### Operational conclusion

- idle session: `turn/start`
- active session: `turn/steer`

That is why the bridge default moved to `BusyMode=steer`.

## Phase 6: manual success is not enough

### Problem

A probe is controlled. Production is not.

We still had to prove the full automatic path:

```text
inbox file written -> bridge detects -> App Server dispatch -> visible TUI render
```

### First failure

The automatic path looked broken for `옴`, but the root cause was not App Server itself.

It was operational:

1. the daemon was not actually running
2. the saved state/agent name still pointed at `온`

### What we changed

- started a dedicated daemon for `옴`
- pointed it at `ws://127.0.0.1:4501`
- used an agent-specific state dir

### Proof

The bridge status and last-dispatch artifacts showed:

- the daemon processed the inbox file
- the dispatch mode used was `steer`
- the target thread/turn matched the live TUI session

Then `옴` explicitly confirmed that the message appeared in the visible TUI.

That was the first full automatic-path success.

## Phase 7: harden the operator path

### Problem 1: state reuse by similar names

`온` and `옴` were close enough operationally that the wrong saved state could be reused if the default state dir was shared.

### Fix

App Server bridge default state dirs became agent-scoped:

- `.tmp/codex-app-server-bridge-온`
- `.tmp/codex-app-server-bridge-옴`

Implemented in:

- [`scripts/codex-app-server-bridge.ts`](/D:/HUA/hua-platform/scripts/codex-app-server-bridge.ts)
- [`scripts/codex-app-server-bridge-start.ps1`](/D:/HUA/hua-platform/scripts/codex-app-server-bridge-start.ps1)
- [`scripts/codex-app-server-bridge-status.ps1`](/D:/HUA/hua-platform/scripts/codex-app-server-bridge-status.ps1)
- [`scripts/codex-app-server-bridge-stop.ps1`](/D:/HUA/hua-platform/scripts/codex-app-server-bridge-stop.ps1)

### Problem 2: operator could not see what the daemon last injected

Heartbeat alone was not enough. We also needed operator-visible proof of:

- which inbox file was last processed
- whether the dispatch mode was `start` or `steer`

### Fix

`status` now shows the last dispatch summary based on `last-dispatch.json`.

### Problem 3: operator checks were split across multiple scripts

Even after the path was working, review bridge status, app bridge status, and recent inbox context still required separate commands.

### Fix

Added [`scripts/tap-ops-dashboard.ps1`](/D:/HUA/hua-platform/scripts/tap-ops-dashboard.ps1) as the combined operator surface for:

- app bridge heartbeat / thread / turn / last dispatch
- review bridge heartbeat / active workers
- recent inbox involving the current agent
- App Server TCP reachability
- warning summary

## Phase 8: review ops collision

### Problem

The first review bridge assumed one shared review file per PR:

- `review-PR703.md`

That broke down when multiple Codex reviewers touched the same PR.

### Fix

We changed the rule to:

- review body and `INDEX.md`: keyed by PR number
- actual file storage: keyed by `PR + reviewer`

Pattern:

```text
review-PR{number}-{reviewer}.md
```

Examples:

- `review-PR703-온.md`
- `review-PR703-옴.md`

### Why this mattered

This was not cosmetic. It removed a real concurrency bug in the review workflow itself.

Implemented in:

- [`scripts/inbox-review-bridge.ps1`](/D:/HUA/hua-platform/scripts/inbox-review-bridge.ps1)
- [`D:/HUA/hua-comms/reviews/README.md`](D:/HUA/hua-comms/reviews/README.md)
- [`D:/HUA/hua-platform/.claude/memory/codex-review.md`](/D:/HUA/hua-platform/.claude/memory/codex-review.md)

## What still is not solved

- ordinary local Codex CLI sessions still do not get a first-class Channels-like push primitive
- secondary App Server notification fan-out is still inconsistent
- reconnect soak testing is still lighter than it should be
- some sandbox-local repro artifacts remained noisy enough that temp cleanup needed a follow-up pass

## Final proof checklist

By the end of the session, all of these were true:

- another agent could write a normal tap inbox file
- the bridge could detect it automatically
- the bridge could attach to the loaded Codex TUI thread
- the bridge could choose `turn/start` or `turn/steer` correctly
- the visible Codex TUI rendered the injected text
- operator status showed heartbeat, thread, turn, and last dispatch
- review files no longer collided when multiple reviewers touched the same PR

That is the point where we stopped calling it a spike and started calling it a working path.

## Related documents

- Public draft: [tap-public-writeup-draft.md](/D:/HUA/hua-platform/docs/areas/tasks/tap-public-writeup-draft.md)
- Continuity note: [codex-app-server-bridge.md](/D:/HUA/hua-platform/docs/areas/tap/codex-app-server-bridge.md)
- Devlog: [2026-03-21-codex-bridge-review-ops.md](/D:/HUA/hua-platform/docs/devlogs/2026-03/2026-03-21-codex-bridge-review-ops.md)
