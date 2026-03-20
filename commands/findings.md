---
name: findings
description: List all out-of-scope findings from agents, grouped by type.
---

# /tap:findings — Out-of-Scope Findings

> Review discoveries that agents found outside their mission scope.

## Behavior

**Step 1: Locate findings directory.**

```bash
REPO_ROOT=$(git rev-parse --show-toplevel)
CONFIG_FILE="${REPO_ROOT}/.tap-config"
if [[ -f "$CONFIG_FILE" ]]; then source "$CONFIG_FILE"; fi
COMMS_DIR="${TAP_COMMS_DIR:-$(dirname "$REPO_ROOT")/project-comms}"
FINDINGS_DIR="${COMMS_DIR}/findings"
```

If no findings directory or empty:
```
No findings recorded yet.
Agents use /tap:findings (or write to {FINDINGS_DIR}/) to record out-of-scope discoveries.
```

**Step 2: Read and parse all finding files.**

Each finding file follows the template: `{YYYYMMDD}-{agent}-{type}-{slug}.md`

Types: `bug` | `improve` | `vuln` | `idea`

**Step 3: Group by type and display.**

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  FINDINGS  —  {total} total
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  VULNERABILITIES ({count})
  ─────────────────────────────────────────────────
  [{date}] [{agent}] {title}
    {summary-line}
    File: {FINDINGS_DIR}/{filename}
  ...

  BUGS ({count})
  ─────────────────────────────────────────────────
  [{date}] [{agent}] {title}
    {summary-line}
  ...

  IMPROVEMENTS ({count})
  ─────────────────────────────────────────────────
  ...

  IDEAS ({count})
  ─────────────────────────────────────────────────
  ...

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Action: Review findings and assign to missions or backlog.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**Step 4: For vulnerability findings**, always display the full content (not just summary).

**Step 5: Offer actions.**

After displaying, suggest:
- "Assign finding to a mission: create a task in the relevant mission file"
- "Add to backlog: create an issue or note"
- "Archive: move to `{COMMS_DIR}/archive/findings/`"

## Filing a Finding (Agent Instructions)

Agents should NOT fix out-of-scope issues directly. Instead:

1. Create a file: `{COMMS_DIR}/findings/{YYYYMMDD}-{agent-name}-{type}-{slug}.md`
2. Use the finding template (see `templates/finding.md`)
3. Record it in your mission file's `## Notes` or `## Blockers` section
4. Continue with your own mission

The control tower will review findings and assign them to appropriate missions.
