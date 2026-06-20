# @hua-labs/tap Roadmap

This roadmap describes likely directions after the `0.6.x` advanced operator
preview. It is not a guarantee of dates, support contracts, or live-runtime
coverage.

tap's priority is to make AI-agent communication safer to inspect and harder to
overclaim. New features should preserve that bias: fail closed, report concrete
evidence, and separate durable files from live model execution.

## Current Baseline

`0.6.x` is the public preview line for:

- dry-run-first setup and guarded MCP configuration;
- concrete agent names instead of broad role aliases;
- file-backed inbox, projection, uplink, review, and handoff evidence;
- receiver/promoter delivery for CLI, TUI, and headless lanes;
- runtime-surface diagnostics through `ready`, `status`, `doctor`,
  `comms-doctor`, and `flow-doctor`;
- explicit review outcome registration through `tap reviews register`;
- data-only profile-pack validation for custom environments;
- npm provenance publishing from the standalone package repository.

## Near-Term Priorities

### 1. First-Run Confidence

- Keep the default install path small: setup, doctor, status, add, ready, and
  comms-doctor should remain enough for a fresh user to understand the system.
- Improve messages for common setup warnings, especially `.mcp.json` ownership,
  repository `cwd`, and profile-pack path mismatches.
- Keep README concise and move deeper operator detail into `AI_GUIDE.md`,
  `ROADMAP.md`, examples, or focused reference docs.

### 2. Evidence Semantics

- Continue tightening the difference between durable evidence and live runtime
  execution.
- Avoid claims that inbox, projection, uplink, or review files prove that a
  model read or acted on a message.
- Improve review-evidence ergonomics without automatically registering every
  writer path until the boundary is reviewed and tested.

### 3. Runtime-Surface Health

- Expand `ready`, `comms-doctor`, and `flow-doctor` coverage for common
  runtime surfaces without requiring private topology.
- Keep app/live delivery strict-gated by runtime health and route freshness.
- Make polling and file-backed paths reliable as the portable fallback for
  auth-free containers and remote shells.

### 4. Profile Packs

- Keep profile packs data-only by default.
- Improve validation diagnostics for missing files, stale paths, unknown
  commands, and unsupported capability declarations.
- Add more generic examples for local teams that need custom surfaces without
  copying another operator's machine paths.

### 5. Package And Release Hygiene

- Keep public npm artifacts free of private repo links, secrets, host paths, and
  copy-paste setup commands that depend on one team's topology.
- Keep source maps free of `sourcesContent`.
- Preserve GitHub Actions provenance publishing and post-publish registry
  verification.
- Prefer small patch releases for documentation, packaging, and safety wording
  fixes.

## Runtime Direction

| Runtime        | Direction                                                                                  |
| -------------- | ------------------------------------------------------------------------------------------ |
| Claude         | Keep channel and MCP setup paths simple and inspectable.                                   |
| Codex          | Continue improving CLI, MCP, and app-server diagnostics with strict live-readiness gates.  |
| Gemini         | Keep legacy compatibility where it already exists, but do not promote it as a new default. |
| Antigravity    | Treat as a custom profile-pack surface until a dedicated adapter is designed and tested.   |
| Other runtimes | Start with profile packs and file-backed evidence before adding first-class adapters.      |

## Possible Later Work

- A dedicated Antigravity adapter, if its CLI surface stabilizes enough to test
  without private assumptions.
- More structured machine-readable doctor reports for automated CI smoke tests.
- Public profile-pack schemas with stronger editor/tooling feedback.
- Safer guided repair flows for common setup drift, while keeping mutation
  explicit and reviewed.
- Better examples for multi-agent review loops that avoid broad role aliases and
  avoid claiming live delivery from file evidence alone.

## Non-Goals For Now

- No central hosted service requirement.
- No automatic execution of profile-pack command snippets.
- No default use of private topology, custom host paths, or broad role aliases.
- No claim that app/live delivery is ready without current runtime health and
  route freshness.
- No guarantee that every runtime surface can be installed or driven with one
  command in `0.6.x`.

## Contribution Guidance

When proposing a change, include:

- the runtime surface affected;
- what evidence proves success;
- what evidence is only durable file output;
- what should fail closed;
- whether the change belongs in public defaults, profile-pack data, or a
  runtime-specific adapter.

If a feature makes a first-run README path longer, consider moving it to
`AI_GUIDE.md`, `docs/`, or an example instead.
