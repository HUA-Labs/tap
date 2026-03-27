# Changelog

All notable changes to tap will be documented in this file.

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
