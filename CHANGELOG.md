# @hua-labs/tap

## 0.6.2

### Patch Changes

- Remove bundled HUA-local operator profile defaults from public runtime
  registries. Reviewed local topology now belongs in explicit profile-pack data
  instead of package defaults.
- Add profile-pack loading for status/ready/infra diagnostics while keeping
  profile-pack commands guarded as data-only unless a reviewed apply path allows
  execution.
- Make blocked `ready --apply` profile-pack commands fail closed with a nonzero
  result instead of reporting top-level success.

## 0.6.1

### Patch Changes

- Restructure the npm README for first-run clarity: shorter quick start, early
  preview boundary, explicit `ready` section, setup/init/add/ready relationship,
  concise concepts, and npm badges.
- Move advanced AX and operator-safety details into `AI_GUIDE.md`, including
  "do not claim" live-delivery rules, profile-pack flag distinctions, safer
  `git init` guidance, setup mutation boundaries, and troubleshooting notes.
- Mark Gemini CLI support as legacy/deprecated in public docs. Antigravity CLI
  should be modeled as a custom profile-pack surface until a dedicated adapter
  exists.

## 0.6.0

### Minor Changes

- Ship the tap 0.6 advanced operator preview.
- Make `tap setup` and `tap doctor --setup` the first-run path for public
  profiles (`codex-cli`, `codex-app`, and `claude-channel`), with dry-run-first
  reports, guarded tap-managed `.mcp.json` apply behavior, and data-only
  profile-pack validation.
- Position receiver/promoter delivery as the portable CLI/TUI/headless
  backbone. Receiver promotion is idle-only for live turn start; active targets
  leave queued/blocked evidence instead of silently steering or passing through.
- Add surface-first diagnostics across setup, status, comms-doctor, flow-doctor,
  and review registration so AI operators can distinguish durable inbox
  evidence, receiver/promoter delivery, return-uplink evidence, and experimental
  live App delivery.
- Persist displayed-notification dedupe with receiver-scoped marker files so
  restarts do not replay already displayed inbox items while broadcasts can
  still be shown once per receiving runtime.
- Register formal review outcomes through the explicit
  `tap reviews register` stream, including provenance-only handling for review
  requests and stale review-meta chatter.
- Guard broad role aliases such as `codex`, `reviewer`, `implementer`,
  `implementation`, and `tower` when multiple candidates exist. Release
  coordination should use concrete agents or reviewed structured targets.

### Preview Boundaries

- `0.6.0` is an advanced operator preview, not a universal one-click runtime
  installer.
- Host-specific topology, local process managers, custom agent names,
  governance docs, and external profile packs are examples or profile-pack
  inputs; they are not public defaults.
- Some advanced helper surfaces still expose existing named profiles for
  compatibility. Portable first-run docs use explicit neutral agents and
  profiles instead of relying on those helper defaults.
- Codex App consent-drive / IPC remains experimental and strict-gated. A
  conversation id or route tuple alone is not authority for live injection.
- Durable inbox, projection, uplink, and review files are evidence records; they
  are not proof that a target runtime executed work.
- Automatic registration from every tap reply/review writer remains a follow-up.
  Use explicit `tap reviews register` for the 0.6 preview evidence stream.
- Archive-audit commands remain available for compatibility, but they are not
  part of the first-run release story.

## 0.5.2

### Patch Changes

- Fix doctor onboarding false failures and remove DEP0190 shell deprecation warnings.
  - doctor: empty inbox treated as warning instead of failure on fresh setup
  - doctor: recognize npx package launcher as valid MCP entry
  - runtime: remove shell: true from command probes to eliminate Node 24 DEP0190 warnings
  - README: add git init to Quick Start

## 0.5.1

### Patch Changes

- c931481: Trust-layer repair and delivery hardening.
  - split shared state (`TAP_STATE_DIR`) from per-bridge runtime state (`TAP_RUNTIME_STATE_DIR`) so headless restarts and later attached TUI sessions keep the correct identity
  - rebind attached TUI identity from runtime heartbeat and agent-name files instead of relying on one-shot session env injection
  - align bridge status, runtime heartbeat, and presence surfaces so `tap status`, bridge state, and plugin-visible presence report the same runtime truth
  - deduplicate bridge-dispatched broadcast notifications
  - rate-limit peer DM auto-replies to stop acknowledgement loops from flooding the inbox
