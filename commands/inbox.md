---
name: inbox
description: Check the tap comms inbox for new messages, reviews, and findings.
---

# /tap:inbox — Comms Inbox

> Check the multi-session communication directory for new messages.

## Behavior

**Step 1: Locate comms directory.**

```bash
REPO_ROOT=$(git rev-parse --show-toplevel)
CONFIG_FILE="${REPO_ROOT}/.tap-config"
if [[ -f "$CONFIG_FILE" ]]; then source "$CONFIG_FILE"; fi
COMMS_DIR="${TAP_COMMS_DIR:-$(dirname "$REPO_ROOT")/project-comms}"
```

If comms directory doesn't exist:
```
No comms directory found at: {COMMS_DIR}
Run /tap:tap setup to initialize, or set TAP_COMMS_DIR in .tap-config
```

**Step 2: Identify this agent.**

Use the current worktree path as the agent identifier. Compare against message filenames to find messages addressed to this session.

Filename convention: `{YYYYMMDD}-{HHMM?}-{from}-{to}-{subject}.md`
- `to` can be agent name or `all` for broadcast

**Step 3: Scan all inboxes.**

Check three directories:

```bash
# New inbox messages
ls -t "${COMMS_DIR}/inbox/" 2>/dev/null

# New reviews (code review results)
ls -t "${COMMS_DIR}/reviews/" 2>/dev/null

# New findings (out-of-scope discoveries from agents)
ls -t "${COMMS_DIR}/findings/" 2>/dev/null
```

**Step 4: Show unread messages.**

"Unread" = files newer than the last time this command ran.
Store last-checked timestamp in `{COMMS_DIR}/.last-checked-{session-id}`.

**Step 5: Display output.**

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  INBOX  —  {timestamp}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Messages ({count} new):
  ─────────────────────────────────────────────────
  {filename}  —  {first-line-preview}
  ...

  Reviews ({count} new):
  ─────────────────────────────────────────────────
  {filename}  —  {first-line-preview}
  ...

  Findings ({count} new):
  ─────────────────────────────────────────────────
  {filename}  —  {first-line-preview}
  ...

  Total unread: {N}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

If nothing new:
```
  No new messages. Comms are quiet.
```

**Step 6: For messages addressed to this agent specifically**, read the full content and display inline.

**Step 7: Update last-checked timestamp.**

```bash
date +%s > "${COMMS_DIR}/.last-checked-${SESSION_ID}"
```

## Notes

- Messages are files, not a database. Deletion = acknowledgment (optional convention).
- Reviews in `reviews/` come from external code reviewers (e.g., Codex). They are NOT GitHub PR comments.
- Findings in `findings/` are discoveries from agents that are out of scope — control tower decides what to do with them.
- Always check inbox at session start, even if the hook already fired.
