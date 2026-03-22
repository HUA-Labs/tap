# Codex App Server Bridge

> 2026-03-21 continuity note for tap-comms -> Codex real-time terminal delivery.

## Goal

Make tap-comms messages reach Codex in a way that is closer to Anthropic channels:

- not just background auto-replies
- ideally visible inside a live Codex terminal session
- resumable if the current session is interrupted

Detailed step-by-step implementation log:

- [Codex App Server Bridge Deep Dive](./codex-app-server-bridge-deep-dive.md)
- [Codex App Server Bridge Runbook](./codex-app-server-bridge-runbook.md)

## Current Status

### What already works

- `scripts/inbox-review-bridge.ps1`
  - polls `hua-comms/inbox`
  - handles direct messages and review requests
  - supports `MessageLookbackMinutes`
  - supports broadcast recipients (`전체` / `all`)
  - resolves agent name from:
    1. `-AgentName`
    2. `TAP_AGENT_NAME`
    3. `CODEX_TAP_AGENT_NAME`
    4. `stateDir/agent-name.txt`
    5. default fallback
- `scripts/inbox-review-bridge-start.ps1`
  - starts the bridge as a background process
  - stores metadata in `.tmp/codex-review-bridge/bridge-daemon.json`
  - stores agent name in `.tmp/codex-review-bridge/agent-name.txt`
- `scripts/inbox-review-bridge-status.ps1`
  - reports pid / heartbeat / active workers / log paths
- `scripts/inbox-review-bridge-stop.ps1`
  - stops the background bridge
- `scripts/README.md`
  - contains operator-facing usage notes
- App Server Phase 1 spike
  - protocol schema and generated TS types were dumped into:
    - `.tmp/app-server-schema`
    - `.tmp/app-server-ts`
  - the transport and request surface were validated enough to proceed to a dedicated bridge client
- App Server Phase 2 minimal bridge client
  - `scripts/codex-app-server-bridge.ts`
  - `scripts/codex-app-server-bridge-start.ps1`
  - `scripts/codex-app-server-bridge-status.ps1`
  - `scripts/codex-app-server-bridge-stop.ps1`
  - default state dir now scopes itself by agent name when available
  - status output now includes the last dispatched inbox file and dispatch mode

### What does NOT work yet

- a standard local Codex CLI session that is **not** connected through App Server remote TUI still cannot receive external live injection
- App Server notification fan-out from the secondary bridge client is still inconsistent
- long-running reconnect / soak behavior is not fully verified yet

## Why This Still Stops Short of Claude Channels

The App Server bridge now **can** inject messages into the visible remote Codex TUI.
That part is no longer theoretical.

What is still different from Claude Channels is the operational model:

- Claude Channels push directly into ordinary Claude sessions through the channel interface
- Codex currently needs an explicit `codex app-server` + `codex --enable tui_app_server --remote ...` path
- so the live experience is real, but it depends on the App Server interface rather than a first-class channel primitive

## Official Product Findings

Checked on 2026-03-21 using:

- local CLI help (`codex --help`, `codex exec --help`, `codex app-server --help`)
- official OpenAI docs/help

Key finding:

- no official user-facing "Channels" feature for Codex CLI was found
- the closest official primitive is **Codex App Server**

Relevant official surfaces:

- Codex App Server
  - bidirectional JSON-RPC
  - stdio / WebSocket transport
  - streamed agent events
  - methods such as `thread/start`, `turn/start`, `turn/steer`, `turn/interrupt`
- Codex CLI `--remote`
  - local help shows the TUI can connect to a remote app-server WebSocket endpoint

Inference:

- the likely path to a channel-like Codex experience is:
  1. run Codex through App Server
  2. attach the visible terminal TUI to that App Server
  3. attach a second bridge client that converts tap-comms messages into App Server turns / steer events

This inference is based on the official App Server docs plus the installed CLI help text.

## Inbox Approval / Handshake

Unread inbox confirmed on 2026-03-21:

- `결 -> 온: appserver-승인`
  - "App Server 방향 승인. 설계 들어가줘. 최소 구현안까지만 — 프로토타입 수준으로."
- `결 -> 온: bridge-상주-확인`
  - background bridge is considered working on the user side
- `결 -> 온: bridge-재시작`
  - restart may be needed after code changes

## Phase 1 Spike Results

### Protocol surface confirmed

Generated artifacts:

- `.tmp/app-server-schema`
- `.tmp/app-server-ts`

Relevant generated files:

- `.tmp/app-server-ts/ClientRequest.ts`
  - includes `initialize`, `thread/start`, `turn/start`, `turn/steer`, `turn/interrupt`
- `.tmp/app-server-ts/ServerNotification.ts`
  - includes `thread/started`, `turn/started`, `item/agentMessage/delta`, `turn/completed`

This confirms that Codex App Server exposes the right low-level primitives for a tap-comms bridge client.

### Raw WebSocket path: viable

Earlier Phase 1 smoke-test output from this session established a successful request/stream lifecycle:

```text
INIT ...
THREAD {"id":"...","status":{"type":"idle"},"cwd":"D:\\HUA\\hua-platform","source":"cli"}
NOTIFY thread/started
TURN_START {"threadId":"...","turnId":"...","status":"inProgress"}
NOTIFY item/agentMessage/delta
NOTIFY turn/completed
TURN_DONE {"status":"completed","text":"PONG"}
```

Interpretation:

- App Server accepted `initialize`
- a thread could be created via `thread/start`
- a turn could be started via `turn/start`
- streamed notifications were emitted during execution
- final assistant text was observed over the event stream

This is enough evidence that a second client can talk to Codex over App Server instead of only spawning standalone `codex exec` workers.

### Remote TUI path: real, but gated

User-side logs under `.tmp/app-server-spike-escalated` showed:

- `codex --remote ws://127.0.0.1:4501 --no-alt-screen`
  - failed with: ``ERROR: `--remote` requires the `tui_app_server` feature flag to be enabled.``
- `codex --enable tui_app_server --remote ws://127.0.0.1:4501 --no-alt-screen`
  - failed with: `Error: stdout is not a terminal`

Interpretation:

- the remote TUI connection path exists in the installed CLI
- it is still behind `tui_app_server`
- it must be validated in a real interactive terminal, not a hidden or non-TTY smoke test

### Real terminal validation: confirmed

Unread inbox from `결` on 2026-03-21 confirmed a successful user-side terminal run:

- `codex app-server --listen ws://127.0.0.1:4501`
- `codex --enable tui_app_server --remote ws://127.0.0.1:4501`

Result:

- remote Codex TUI opened successfully against the App Server on port `4501`
- this removes the biggest Phase 1 uncertainty around the TTY path

### Phase 2 implementation: first live dispatch succeeded

Implemented:

- `scripts/codex-app-server-bridge.ts`
  - polls `hua-comms/inbox`
  - filters direct and broadcast messages for the configured agent
  - connects to App Server over WebSocket
  - prefers a currently loaded thread with matching `cwd`
  - otherwise resumes saved thread state
  - otherwise starts a fresh thread
  - dispatches via `turn/start`
  - optionally uses `turn/steer` when busy
- start/status/stop wrappers:
  - `scripts/codex-app-server-bridge-start.ps1`
  - `scripts/codex-app-server-bridge-status.ps1`
  - `scripts/codex-app-server-bridge-stop.ps1`

Live one-shot test from this repo:

```text
node --experimental-strip-types scripts/codex-app-server-bridge.ts --run-once --message-lookback-minutes=5 --app-server-url ws://127.0.0.1:4501 --agent-name 온
```

Observed result:

```text
attached to loaded thread 019d107b-b366-7e90-b503-4688f0311454
dispatched 20260321-결-온-phase2-참고자료.md to thread 019d107b-b366-7e90-b503-4688f0311454
```

What this proves:

- a second App Server client can discover and attach to an already loaded thread
- `turn/start` can be accepted against that loaded thread
- the bridge no longer needs to spawn a separate `codex exec` worker just to react to inbox messages

### Visible TUI rendering: confirmed

User-side confirmation on 2026-03-21:

- externally injected `turn/start` rendered inside the visible remote Codex TUI
- externally injected broadcast content was seen in the terminal

Additional direct probe from this repo:

- `scripts/codex-app-server-probe.ts`
  - attached to the loaded TUI thread on `ws://127.0.0.1:4501`
  - sent `turn/start`
  - then sent `turn/steer` while the turn was still active

User-observed terminal result:

- the `turn/start` probe prompt rendered in the visible Codex TUI
- the `turn/steer` instruction also rendered while the turn was active

This is the key proof that App Server can deliver live external input into the active remote Codex terminal session.

### Operational takeaway

- idle TUI:
  - `turn/start` is sufficient
- active TUI:
  - `turn/steer` is the safer/default path

For that reason, the App Server bridge now defaults to `BusyMode=steer`.

### Sandbox-local repro note

Inside the Codex tool sandbox, `codex app-server` could not use the default user config/home path and failed with:

```text
Error: error loading default config after config error: 액세스가 거부되었습니다. (os error 5)
```

Workaround for local protocol probing:

- set `HOME`, `USERPROFILE`, `XDG_CONFIG_HOME`, and `CODEX_HOME` to a workspace-local temp directory before launching `codex app-server`

With that isolated home:

- `initialize` could be reproduced
- `thread/start` could be reproduced with minimal params
- using extra experimental fields without capability negotiation caused:
  - `thread/start.persistFullHistory requires experimentalApi capability`
- `turn/start` did **not** produce a useful completion because the isolated sandbox home lacks the user's normal authenticated Codex context

This sandbox-only limitation should not be confused with an App Server protocol limitation.

## Recommended Prototype Scope

### Phase 1: App Server local spike

- done enough to de-risk the protocol path
- remaining unknown is visible delivery into the active terminal TUI, not whether App Server itself can carry turns

Follow-up validation still needed:

- run `codex app-server --listen ws://127.0.0.1:4501`
- run interactive Codex TUI against it via `codex --enable tui_app_server --remote ws://127.0.0.1:4501`
- confirm a normal visible local thread works through the remote endpoint in a real terminal window

### Phase 2: Minimal bridge client

- implemented
- next work is hardening:
  - run the daemon continuously and observe reconnect behavior
  - decide whether `wait` mode should remain as an opt-in fallback only

### Phase 3: Terminal behavior validation

- done for the core path
- remaining work is stabilization, not first-principles viability

## Risks / Unknowns

- App Server notification fan-out still looks inconsistent from the second client connection
  - in some runs, `thread/status/changed` was observed without matching `turn/started` / `item/agentMessage/delta` notifications
  - despite that, visible TUI rendering still succeeded
- long-running daemon behavior across reconnects and many queued inbox messages is still unverified
- `turn/steer` semantics during very long model outputs still need more operational testing

## Useful Commands

Current bridge:

```powershell
.\scripts\inbox-review-bridge-start.ps1 -AgentName "<name>"
.\scripts\inbox-review-bridge-status.ps1
.\scripts\inbox-review-bridge-stop.ps1
```

Likely next spike:

```powershell
codex app-server --listen ws://127.0.0.1:4501
codex --enable tui_app_server --remote ws://127.0.0.1:4501
```

Run the second command in a real interactive terminal window.

Current App Server bridge ops:

```powershell
.\scripts\codex-app-server-bridge-start.ps1 -AgentName "<name>" -AppServerUrl "ws://127.0.0.1:4501"
.\scripts\codex-app-server-bridge-status.ps1 -AgentName "<name>"
.\scripts\codex-app-server-bridge-stop.ps1 -AgentName "<name>"
```

Current combined operator dashboard:

```powershell
.\scripts\tap-ops-dashboard.ps1 -AgentName "<name>" -Watch
```

If `-AgentName` or `TAP_AGENT_NAME` is present and `-StateDir` is omitted, the daemon now defaults to an agent-scoped state directory:

- `.tmp/codex-app-server-bridge-<name>`

This avoids reusing `온` state for `옴` or other TUI sessions by accident.

## Files To Read Next Session

- `scripts/inbox-review-bridge.ps1`
- `scripts/inbox-review-bridge-start.ps1`
- `scripts/inbox-review-bridge-status.ps1`
- `scripts/README.md`
- `docs/areas/tap/codex-app-server-bridge.md`

## Outcome Summary

- background Codex auto-reply bridge: done
- variableized agent naming: done
- official-doc search for channel-equivalent: done
- App Server direction: approved
- App Server Phase 1 protocol spike: done
- Phase 1 remote TUI validation in a real terminal: done
- minimal bridge client: implemented
- loaded-thread attach + live `turn/start` dispatch: done
- visible TUI rendering in remote Codex terminal: done
- active-turn `turn/steer` rendering: done
- agent-scoped default state dir + last-dispatch status summary: done
- combined operator dashboard (review + app bridge + inbox): done
- daemon hardening + reconnect soak test: next
