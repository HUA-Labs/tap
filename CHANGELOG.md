# Changelog

All notable changes to tap will be documented in this file.

## 0.4.0 (2026-03-31)

Gen 19-21 release — DM routing, session-neutral bootstrap, bridge stability, multi-model team ops.

### Features

- **M202**: DM routing Phase 1 — frontmatter-based message routing for direct messages
- **M204**: DM routing Phase 2 — ID canonicalization (hyphen/underscore normalization)
- **M180**: Codex session-neutral bootstrap — multi-instance identity fix
- **M182**: Agent identity unification — plugin slice with shared routing helpers
- **M206**: Unified bridge routing — shared identity helpers across bridge and plugin

### Fixes

- **M208**: `tap add codex` now passes `manageAppServer` to `startBridge()` and persists in state — bridge auto-launches app-server correctly
- **M209**: Bridge restart no longer re-dispatches already-processed messages — cutoff stored as dispatched max mtime instead of wall-clock
- **M207**: `tap up` auto-prunes stale heartbeats before starting bridges (orphan 24h, dead bridge 10m, signing-off 5m)
- **M203**: Bridge stale turn fallback — `waitingOnApproval` detection prevents stuck turns
- **M201**: MCP server `bun` → `node` for multi-OS portability
- **M175**: WebSocket no-auth warning + doctor check
- **M197**: `inferRestartMode` connected to `bridge start --all`
- **M200**: Unified `normalizeTapPath` across all entrypoints
- **M186**: Restore `tap-comms` bin compatibility alias
- **M210**: Phantom agent heartbeat filtering — `tap_who`, HUD count, and write cycle prune entries without valid agent ID
- **M211**: `tap add codex` auto-assigns next free port when `--port` omitted, preventing multi-instance port collision
- **M212**: Managed startup health check upgraded to HTTP `/readyz` probe — no WebSocket session created, auth gateway end-to-end readiness restored, TCP fallback for legacy servers
- Standalone bridge runtime path sync + Windows spawn liveness gate
- Dual session fix: managed startup no longer opens extra Codex sessions via WebSocket health checks

### Architecture

- **M205**: App-server bridge splitting — 2289 → 22-line barrel + 8 extracted modules

### Security

- **M174**: Bridge token leak sanitization — all error output paths masked (query, JSON, subprotocol, Bearer)

### Tests

- **M176**: HTTP CSRF protection test coverage + port:0 dynamic binding
- Bridge inbox cutoff race condition coverage (M209)
- Heartbeat pruning: orphan, dead bridge, signing-off scenarios (M207)
- Bridge log visibility regression coverage (M181)
- TCP health probe: 6 tests for managed startup readiness
- HTTP `/readyz` health probe: readyz URL conversion, 200/unsupported/503 branching, auth gateway readyz (M212)
- Port auto-assignment: `findNextAvailableAppServerPort()` in `tap add` (M211)

## 0.3.1 (2026-03-29)

- Agent ID canonicalization — hyphen/underscore normalization
- Linux spawn helper — cross-platform detached process spawning
- prepack fix for CI publish
- Mini HUD statusline integration

## 0.3.0 (2026-03-28)

Gen 18 mega release — 48 PRs merged, headless durahan achieved, bridge.ts fully split.

> *"Other tools give agents instructions. tap gives them context."*

### Features

- **M133**: Headless thread resume self-heal — reconcile stale thread.json with heartbeat.json
- **M135**: Bridge heartbeat → comms sync — agents visible in `tap_who` without MCP tools
- **M154**: Windows app-server auto spawn — `.cmd` shim unwrap → node direct execution
- **M157**: Headless E2E test suite — 18 regression tests across 6 scenarios
- **M158**: macOS/Linux unix-spawn helper — cross-platform detached process spawning
- **M160**: Bridge stuck turn detection + `tap bridge watch` auto-restart
- **M165**: `tap watch` autonomous watchdog — single-pass or `--loop` continuous monitoring
- **M168**: Web GUI dashboard — `tap gui` with agents, bridges, mission kanban, PR board
- **Gemini IDE Companion** (M129): MCP-over-HTTP fake IDE server for Gemini CLI integration

### Architecture

- **M148**: bridge.ts modular split — 1744 → facade only (-98%)
  - 16 extracted modules: paths, file-io, port-network, codex-command, process-control, config, state, windows-spawn, unix-spawn, app-server-auth, app-server-health, app-server-lifecycle, observability, startup, orchestrator
  - Phase 6a/6b: startup + stop/restart orchestration fully extracted
  - Splitting convention documented

### Security

- **M174**: Token sanitizer — heartbeat lastError masking (query, JSON, subprotocol, Bearer)
- **M176**: CSRF protection — dynamic loopback CORS + origin guard (IPv4/IPv6)
- **M185**: Name confirmed guard — persisted name overwrite protection
- **M142**: tap_reply cc/to/subject validation + resolved-filename dedupe

### CI/CD

- **M172**: GitHub Actions — PR checks (build+test) + release workflow with npm provenance

### Fixes

- **M146**: Doctor tree kill on Windows — `spawnSync taskkill /F /T` for process tree
- **M161**: `probeCommand()` returns absolute paths via `where.exe`/`which`
- **M847**: Bridge restart warmup env scoping — `TAP_COLD_START_WARMUP` set/restore
- **M155**: Bridge stop isolation — cross-instance kill prevention
- **M156**: Port zombie CLOSE_WAIT detection
- **M162**: Agent name routing collision — stale heartbeat cleanup

### CLI

- `tap gui` — web dashboard with live SSE updates
- `tap gui /missions` — mission kanban board
- `tap gui /prs` — GitHub PR board
- `tap gui /api/*` — JSON API with CORS for external apps
- `tap watch` — autonomous bridge health monitoring
- `tap bridge watch` — single-pass stuck turn detection

### Tests

- 338 total tests (was 271 at 0.2.6)
- Headless E2E: thread resume, .cmd unwrap, port isolation, state isolation
- Unix spawn: detached process, lsof PID discovery
- Mission parser, PR fetcher, bridge restart warmup
- Bridge splitting: all phases preserve 100% test pass rate

### Documentation

- Agent startup guide (4 modes)
- Splitting convention
- Watchdog design (cron/systemd integration)
- Claude CLI automation investigation

## 0.2.6 (2026-03-27)

### Fixes

- **cc parameter normalization** — `tap_reply` cc field now auto-converts string to array, preventing delivery failures when a single cc recipient is passed as a string
- npm pkg fix — normalize bin paths and repository URL

## 0.2.5 (2026-03-27)

Gen 17 release — 13 PRs merged, 6 missions completed, 263 tests passing.

### Features

- **M119**: Per-command `--help` + Levenshtein "did you mean?" command suggestions + `tap` bin alias
- **M122**: Bridge thread rebind — cwd validation, cold-start warmup, doctor thread warnings
- **M126**: Codex config doctor — env drift detection, legacy key migration, trust check, `--fix` repair
- **M127**: Doctor command/args drift check — stale launcher false-negative fix

### Fixes

- **M123**: MCP server key rename `tap-comms` → `tap` (fixes Codex TUI `Tools: (none)` display bug)
- **M125**: Windows background spawn — PowerShell `Start-Process -WindowStyle Hidden` (no console windows)
- Windows spawn hardening — `.cmd` → `.ps1` wrapper, PowerShell-native quoting, stale cleanup
- Auth gateway bundling path fix
- Shell injection prevention (`execSync` → `spawnSync`)
- Dead `getCommsRepoUrl` removal
- Doctor `execSync` → `spawnSync` consistency

### Security

- **M110**: WebSocket subprotocol auth (query-param → first-message token, no URL log exposure)
- **M111**: Bearer token auth for HTTP state API (session-scoped random token)
- Doctor command-check `spawnSync` (no shell injection surface)

### Tests

- M122: thread rebind + warmup scope guard + reconnect snapshot
- M123: legacy key migration + doctor key distinction + Codex/Gemini adapter apply
- M125/M127: PowerShell hidden spawn assertions + negative tests
- Bridge-app-server test fixture restoration
- CLI suggest tests (Levenshtein, typo matching)
- 263 total tests (was 231 at 0.2.3)

## 0.2.4 (2026-03-26)

Gen 16 release — Phase 2 security, CLI hardening.

### Features

- M110: Subprotocol auth
- M111: HTTP bearer token
- M119: CLI `--help` (initial)
- M120: `tap add` UX improvements
- M121: CLI integer arg validation

### Fixes

- Auth gateway path dotdot fix
- Shell injection hotfix (`execSync` → `spawnSync`)
- Dead code cleanup

## 0.2.1 (2026-03-25)

Gen 14 release — headless cold-start, npm standalone bridge.

- M108: Comms repo integration
- M109: Headless cold-start handshake
- M110: npm standalone bridge path fix

## 0.2.0 (2026-03-25)

Gen 13 release — bridge daemon, CLI boot, doctor.

- Bridge daemon mode
- CLI error codes
- `tap doctor` initial implementation
- `tap up` / `tap down` orchestration

## 0.1.1 (2026-03-24)

- Repository URL fix + npm badges

## 0.1.0 (2026-03-24)

Initial public release.

- CLI: `init`, `add`, `remove`, `status`, `bridge`, `serve`
- Runtime adapters: Claude, Codex, Gemini
- File-based async communication protocol
- Bridge daemon for Codex app-server
