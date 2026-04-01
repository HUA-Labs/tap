---
description: "Control tower autonomous loop — review-routing/status loop with CHAIN integration"
allowed-tools:
  - Bash
  - Read
  - Write
  - Glob
  - Grep
  - Agent
  - WebFetch
---

# /tap:autopilot — Control Tower Auto-Pilot

Read and execute the autopilot skill at `skills/autopilot/SKILL.md`.

Based on `$ARGUMENTS`:

- (empty) → Start autonomous monitoring loop
- `--once` → Single pass (check everything once, then stop)
- `--status` → Just print current state without taking actions

## Current Implementation

M96 wires CHAIN review routing into a real runner:

```bash
node scripts/tap-autopilot.mjs
node scripts/tap-autopilot.mjs --once
node scripts/tap-autopilot.mjs --status
node scripts/chain-review-router.mjs --dry-run
```

Today the implemented loop covers:

1. open PR scan via `gh pr list`
2. cross-model reviewer auto-routing
3. review completion detection -> author notification
4. compact status reporting

Inbox triage, findings digest, and `MISSIONS.md` regeneration remain planned in the skill doc but are not yet part of the shipped runner.

## Core Loop

Each pass:

1. **PR watch** — `gh pr list` for open PRs, match to branch/mission hints, route to reviewer
2. **Review completion watch** — Scan `{comms}/reviews/` for new review artifacts, notify authors
3. **Status report** — Print routed/rerouted/escalated/completion counts and active reviewers

After each pass, print a compact routing status report.

## Critical Rules

- **Never checkout branches** — you are the control tower
- **Never modify code** — only mission files, MISSIONS.md, and comms
- **Push comms before announcing** — agents can't see unpushed files
- **Treat the current runner as review-routing-first** — broader autopilot phases are still planned
