# Handoff: {MISSION_ID} — {MISSION_TITLE}

**Date**: {YYYYMMDD}
**Handing off**: {AGENT_NAME} ({SESSION_DESCRIPTION})
**Receiving**: next agent (generation {NEXT_GENERATION})
**Branch**: `{BRANCH}`
**Worktree**: `{WORKTREE_PATH}`

---

## Current State

**Status**: {active | paused | blocked}
**Progress**: {N}/{TOTAL} tasks complete ({PCT}%)
**Last commit**: {COMMIT_HASH} — {COMMIT_MESSAGE}

## What Was Done This Session

{2-5 bullet points of concrete accomplishments}

- {accomplishment 1}
- {accomplishment 2}
- {accomplishment 3}

## What Needs to Be Done Next

{Ordered list of immediate next steps}

1. {next step 1} — {context/why}
2. {next step 2}
3. {next step 3}

## Context You Need

### Architecture Decisions Made

{Any significant decisions that shaped the current implementation}

### Gotchas and Traps

{Things that caused confusion or wasted time — save the next agent from repeating}

- {gotcha 1}
- {gotcha 2}

### Files That Matter

```
{path/to/key-file.ts}       — {what it does and why it matters}
{path/to/another-file.ts}   — {same}
```

### Current Blockers

{If any. If none, say "none."}

## Environment Notes

```bash
# Commands to verify current state
git -C {WORKTREE_PATH} log --oneline -5
git -C {WORKTREE_PATH} diff --stat main...HEAD
```

## Comms Summary

- Inbox: {N} messages received, {M} pending response
- Reviews: {review status or "none"}
- Findings filed: {list of finding filenames or "none"}

---

## How to Resume

```bash
cd {WORKTREE_PATH}
git pull origin {BRANCH}
claude

# Then paste:
# "Read docs/missions/{MISSION_FILE} and the handoff at {COMMS_DIR}/handoff/{THIS_FILE}.
#  Continue from where the previous agent left off."
```

---

*Written by {AGENT_NAME} — context preservation for tap gen {NEXT_GENERATION}*
