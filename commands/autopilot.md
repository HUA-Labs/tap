---
description: "Control tower autonomous loop — monitor agents, route reviews, regenerate MISSIONS.md"
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

## Core Loop

Each pass:

1. **Inbox scan** — Read `{comms}/inbox/` for new messages, categorize and route
2. **PR watch** — `gh api` for open PRs, match to missions, route to reviewer
3. **Findings digest** — Scan `{comms}/findings/`, group by type/severity
4. **Round completion** — Check if all active missions are done
5. **MISSIONS.md regenerate** — Parse mission file Meta tables → rebuild index
6. **Review routing** — Watch `{comms}/reviews/`, notify agents

After each pass, print compact status report. If round complete, suggest next missions.

## Critical Rules

- **Never checkout branches** — you are the control tower
- **Never modify code** — only mission files, MISSIONS.md, and comms
- **Push comms before announcing** — agents can't see unpushed files
- **Generate MISSIONS.md, don't edit** — run `bash scripts/generate-missions.sh`
