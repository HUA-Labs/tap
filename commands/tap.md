---
name: tap
description: Multi-session orchestration control tower. Setup worktrees, launch agents, audit progress, teardown missions.
---

# /tap:tap — Mission Control

> Tap into parallel missions. File-based multi-session orchestration with git-synced coordination.

## Usage

```
/tap:tap                        # Dashboard (run tap-watch.sh)
/tap:tap setup <N>              # Create N missions interactively, bootstrap worktrees
/tap:tap launch [mission-ids]   # Print launch prompts for terminal tabs
/tap:tap audit                  # Audit all mission progress, blockers, insights
/tap:tap teardown [mission-id]  # Clean up completed mission worktree
/tap:tap sync                   # Sync MISSIONS.md to all active worktrees
```

---

## Phase 0: Parse $ARGUMENTS

Read `$ARGUMENTS` and determine mode:

| Input                  | Mode       |
| ---------------------- | ---------- |
| (empty)                | Dashboard  |
| `setup N`              | Setup      |
| `launch [ids]`         | Launch     |
| `audit`                | Audit      |
| `teardown [id]`        | Teardown   |
| `sync`                 | Sync       |

Detect project root: `git rev-parse --show-toplevel`
Detect comms dir: check for `.tap-config` file, default to `../project-comms/`

```bash
# Load config if exists
REPO_ROOT=$(git rev-parse --show-toplevel)
CONFIG_FILE="${REPO_ROOT}/.tap-config"
if [[ -f "$CONFIG_FILE" ]]; then
  source "$CONFIG_FILE"
fi
COMMS_DIR="${TAP_COMMS_DIR:-$(dirname "$REPO_ROOT")/project-comms}"
MISSIONS_DIR="${TAP_MISSIONS_DIR:-${REPO_ROOT}/docs/missions}"
```

---

## Mode: Dashboard

Run the monitoring script:

```bash
bash "${CLAUDE_PLUGIN_ROOT}/scripts/tap-watch.sh"
```

For detailed view:

```bash
bash "${CLAUDE_PLUGIN_ROOT}/scripts/tap-watch.sh" --detail
```

---

## Mode: Setup

**Step 1: Gather mission definitions interactively.**

For each mission (1..N), ask the user:
- Name (kebab-case, e.g., `ui-refactor`)
- One-line description
- Scope (directories/packages this mission owns — comma separated)
- Branch name (default: `feat/{name}`)
- Initial task phases (user can paste or describe; you structure into checkboxes)

Validate: no overlapping scopes between missions.

**Step 2: Confirm comms directory.**

Ask: "Comms directory? (default: `../project-comms/`)"
If directory doesn't exist, offer to create it with `git init`.

**Step 3: Generate files.**

Create `{MISSIONS_DIR}/MISSIONS.md` using the MISSIONS template:
- Fill in the mission table
- Include the 13 boilerplate rules
- Include scope map

Create `{MISSIONS_DIR}/{name}.md` per mission using the mission template.

**Step 4: Create slot-based worktrees.**

For each mission (index 1..N):

```bash
SLOT=$((INDEX))
WT_PATH="$(dirname "$REPO_ROOT")/wt-${SLOT}"
BRANCH="${mission_branch}"

bash "${CLAUDE_PLUGIN_ROOT}/scripts/tap-setup.sh" "$WT_PATH" "$BRANCH" main
```

Slot-based paths (`../wt-1`, `../wt-2`) prevent session breakage when tabs are reopened.

**Step 5: Copy permissions.**

Each worktree needs `.claude/settings.local.json` so Agent Teams run without permission prompts:

```bash
for wt in "$WT_PATH"; do
  mkdir -p "$wt/.claude"
  cp "${REPO_ROOT}/.claude/settings.local.json" "$wt/.claude/settings.local.json" 2>/dev/null || true
  git -C "$wt" update-index --skip-worktree .claude/settings.local.json 2>/dev/null || true
done
```

**Step 6: Commit and push** mission files to main so all worktrees can see them.

```bash
git -C "$REPO_ROOT" add docs/missions/
git -C "$REPO_ROOT" commit -m "tap: setup $(echo $N) missions — $(date +%Y-%m-%d)"
git -C "$REPO_ROOT" push origin main
```

**Step 7: Print launch instructions** for each mission (see Mode: Launch).

---

## Mode: Launch

If no mission IDs given, launch all active/planned missions.

For each mission, print a terminal tab launch block:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Tab {N} — {Mission Name}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Directory: {worktree-path}
  Command:   claude

  Paste this prompt:
  ─────────────────────────────────────────────────────
  Read docs/missions/{name}.md and begin your mission.
  You are a tap agent (generation {N}). Control tower is running from the main repo.
  Comms directory: {COMMS_DIR} — check inbox/ for messages, write findings/ for
  out-of-scope discoveries, reviews/ has code review results.
  MISSIONS.md is control-tower-only — never edit it. Only update your own mission file.
  Create PRs yourself with `gh pr create`. Pick a single-character name (any script)
  and announce yourself in {COMMS_DIR}/inbox/.
  ─────────────────────────────────────────────────────
```

---

## Mode: Audit

For each active mission:

**1. Find the worktree.**

```bash
git worktree list --porcelain | grep -A2 "branch refs/heads/${branch}"
```

**2. Read the mission file** from the worktree path (live state, not main):

```bash
mission_file="${wt_path}/docs/missions/${name}.md"
```

**3. Check progress.**

```bash
total=$(grep -c '^- \[' "$mission_file" 2>/dev/null || echo 0)
done=$(grep -c '^- \[x\]' "$mission_file" 2>/dev/null || echo 0)
pct=$((done * 100 / (total > 0 ? total : 1)))
```

**4. Check blockers.**

Read `## Blockers` section. If non-empty, flag for control tower action.

**5. Check git state.**

```bash
git -C "$wt_path" log --oneline -5
git -C "$wt_path" diff --stat main...HEAD
```

If 0 files changed vs main but agent reported success → flag as SUSPICIOUS.

**6. Check comms inbox** for messages from this agent.

```bash
ls "${COMMS_DIR}/inbox/" | grep "${agent_name}"
```

**7. Output audit report:**

```
## Mission Audit — {timestamp}

### {ID}: {name} — {pct}%
Current Phase: {phase}
Recent commits (5): {list}
Files changed vs main: {N}
Blockers: {list or "none"}
Inbox activity: {count} messages
Action needed: {yes/no — reason}
```

---

## Mode: Sync

Propagate `MISSIONS.md` and other missions' files to all active worktrees.
Never overwrite a worktree's own mission file.

```bash
for wt in "${worktrees[@]}"; do
  mission_name=$(basename "$wt")  # or read from worktree mapping
  git -C "$wt" checkout main -- docs/missions/MISSIONS.md
  # Sync other missions' files (not own)
  for other_mission in "${all_missions[@]}"; do
    if [[ "$other_mission" != "$mission_name" ]]; then
      git -C "$wt" checkout main -- "docs/missions/${other_mission}.md" 2>/dev/null || true
    fi
  done
done
```

---

## Mode: Teardown

1. Confirm mission is fully done (all tasks checked, PR merged).
2. Check PR status: `gh pr view {branch} --json mergeCommit,state`
3. Update mission file status → completed.
4. Remove worktree: `git worktree remove {path} --force`
5. Update MISSIONS.md — mark completed.
6. Commit and push.

---

## Boilerplate Rules (13)

These rules are embedded in every generated MISSIONS.md:

```
1.  Session start: update mission status → active, check {COMMS_DIR}/inbox/ for messages
2.  Session end: commit+push branch → update mission file → write retro → commit+push main
3.  PC/machine move: git pull + cd {COMMS_DIR} && git pull → check inbox → continue
4.  Scope isolation: only modify directories listed in your mission scope
5.  Blockers: set status → blocked, describe in ## Blockers section
6.  Out-of-scope changes: DO NOT self-modify. Record in {COMMS_DIR}/findings/ instead
7.  Execution: Agent Teams for 3+ independent tasks, autonomous loop when applicable
8.  Testing: happy path + edge case + negative — always
9.  Reporting: critical insights, architecture decisions → ## Notes immediately
10. Devlog: write your own devlog per session
11. Retro: session end → write retro to {COMMS_DIR}/retros/{session-name}.md
12. Large commits (50+ files): set HUSKY=0 before commit to avoid lint-staged OOM
13. Worktree settings: git update-index --skip-worktree .claude/settings.local.json after setup
```

---

## Key Files

| File                              | Purpose                                      |
| --------------------------------- | -------------------------------------------- |
| `docs/missions/MISSIONS.md`       | Global index — control tower only edits this |
| `docs/missions/{name}.md`         | Per-mission state, tasks, blockers, notes    |
| `{COMMS_DIR}/inbox/`             | Real-time message bus (file per message)     |
| `{COMMS_DIR}/reviews/`           | Code review results from external reviewers  |
| `{COMMS_DIR}/findings/`          | Out-of-scope discoveries (bug/improve/etc.)  |
| `{COMMS_DIR}/retros/`            | Session retrospectives                       |
| `../wt-{N}/`                     | Slot-based worktrees (stable paths)          |
| `.tap-config`                    | Optional: override comms dir, missions dir   |
