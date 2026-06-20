---
name: tap
description: tap — Multi-session control tower. Setup parallel worktrees, monitor progress, audit missions.
user-invocable: true
---

# tap — Multi-Session Orchestration Protocol

> An installable operating protocol for coordinating parallel AI agents across git worktrees.
> File-based comms. Scope isolation. Generational knowledge transfer.

---

## Quick Reference

```
/tap:tap                  # Dashboard
/tap:tap setup N          # Create N missions
/tap:tap launch [ids]     # Print terminal tab prompts
/tap:tap audit            # Audit all missions
/tap:tap teardown [id]    # Clean up completed mission
/tap:tap sync             # Sync mission files to worktrees
/tap:inbox                # Check messages, reviews, findings
/tap:findings             # List out-of-scope discoveries
```

---

## Architecture

### Roles

| Role | Description |
|------|-------------|
| **Control Tower** | Runs from main repo. Orchestrates missions. Never checks out branches. |
| **Agent** | Runs in a worktree. Owns a scope. Creates PRs. Reports via comms. |

### File Locations

```
{repo}/
├── docs/missions/
│   ├── MISSIONS.md          # Control tower only — global index + rules
│   └── {name}.md            # Per-mission state (agent updates own file only)
└── .tap-config              # Optional: override COMMS_DIR, MISSIONS_DIR

{comms}/                     # Shared git repo (default: ../project-comms/)
├── inbox/                   # Real-time messages between sessions
├── reviews/                 # External code review results
├── findings/                # Out-of-scope discoveries from agents
├── retros/                  # Session retrospectives
└── handoff/                 # Session handoff documents

{repo-root}/
├── ../wt-1/                 # Slot 1 worktree (stable path)
├── ../wt-2/                 # Slot 2 worktree
└── ../wt-N/                 # Slot N worktree
```

---

## Protocol Rules (13)

These rules govern every tap session:

1. **Session start**: Update mission `status` → `active`. Check `{COMMS_DIR}/inbox/` for messages to you or broadcasts.

2. **Session end**: Commit+push branch → update mission file (status, tasks, notes) → write retro → commit+push main.

3. **Machine move**: `git pull` in both repo and comms dir → check inbox → checkout branch → continue from mission file.

4. **Scope isolation**: Only modify directories listed in your mission scope. Record overlaps or conflicts in the mission file.

5. **Blockers**: Set `status` → `blocked`. Describe clearly in `## Blockers` section. Wait for control tower.

6. **Out-of-scope changes**: DO NOT fix things outside your scope. Write a finding to `{COMMS_DIR}/findings/` and move on.

7. **Execution**: Use Agent Teams for 3+ independent tasks. Use autonomous loops when applicable.

8. **Testing**: Always cover happy path + edge case + negative case.

9. **Reporting**: Record critical insights and architecture decisions in `## Notes` immediately, not at session end.

10. **Devlog**: Write your own session devlog. Include what you did, why, and what changed.

11. **Retro**: At session end, write to `{COMMS_DIR}/retros/{generation}/{name}.md`. What worked, what didn't, lessons for next agent.

12. **Large commits (50+ files)**: `export HUSKY=0` before commit. Lint-staged OOM is real.

13. **Worktree settings**: After setup, always run: `git update-index --skip-worktree .claude/settings.local.json`

---

## Control Tower: Critical Rules

- **Never check out a branch** in the main repo. All branch work happens in worktrees. (Learned in gen 1-3: control tower branch switching causes constant conflicts.)
- **Never edit `MISSIONS.md` on behalf of agents.** They must update their own mission files.
- **Reviews live in `{COMMS_DIR}/reviews/`** — not GitHub PR comments. Agents must check this directory, not GitHub.
- **Slot-based worktrees** (`../wt-1`, `../wt-2`) prevent session breakage. Never use descriptive names like `../hua-tap5-featurename` — these break when tabs are reopened.

---

## Agent: Critical Rules

- **MISSIONS.md is control-tower-only.** Never edit it. Only update your own `{name}.md`.
- **Create PRs yourself.** Use `gh pr create` directly. Do not ask the control tower to create PRs.
- **Reviews are in `{COMMS_DIR}/reviews/`**, not GitHub. Check there for Codex and human reviews.
- **Findings are not blockers.** Record out-of-scope issues in `{COMMS_DIR}/findings/` and keep working.
- **Handoff docs preserve context.** Write a thorough `handoff.md` so the next agent picks up at 95% context, not 0%.
- **Retros are not optional.** They are how knowledge transfers across generations. Future agents read them.

---

## Comms: Message Filename Convention

```
{YYYYMMDD}-{HHMM?}-{from}-{to}-{subject}.md
```

Examples:
- `20260320-실-전체-환영.md` — broadcast welcome message
- `20260320-검-실-머지완료.md` — agent "검" reporting merge to control "실"
- `20260320-0910-진-록-리뷰결과.md` — timed review result

`to` field: agent name, `all`, or `전체` for broadcast.

---

## Findings: File Naming Convention

```
{YYYYMMDD}-{agent}-{type}-{slug}.md
```

Types: `bug` | `improve` | `vuln` | `idea`

Examples:
- `20260320-검-bug-phantom-logo-component.md`
- `20260320-록-improve-registry-audit-automation.md`
- `20260320-록-vuln-unvalidated-redirect.md`

---

## Setup Sequence (Manual)

If not using `/tap:tap setup`:

```bash
# 1. Create worktree at stable slot path
git worktree add ../wt-1 -b feat/my-mission main

# 2. Copy permissions
cp .claude/settings.local.json ../wt-1/.claude/settings.local.json
git -C ../wt-1 update-index --skip-worktree .claude/settings.local.json

# 3. Bootstrap
cd ../wt-1
pnpm install  # or npm install

# 4. Ensure comms directory exists and is a git repo
ls ../project-comms/ || (mkdir ../project-comms && git -C ../project-comms init)
```

---

## Lessons Learned: Generations 1-3

### Generation 1 (점/맥/결/눈/탑)
- First multi-session run. Proved the concept works.
- Control tower branched constantly → conflicts. Solution: control tower stays on main.
- No comms protocol → agents talked past each other. Solution: file-based inbox.

### Generation 2 (숲/코/정/율)
- Added comms structure. Reviews via Codex PR comments caused confusion.
- Agents missed reviews because they looked at GitHub, not comms dir.
- Solution: all reviews go to `comms/reviews/`, never GitHub-only.

### Generation 3 (근/단/품/록 + 실)
- Slot-based worktrees introduced after session breakage with descriptive paths.
- `HUSKY=0` pattern standardized for large commits.
- Handoff documents proved critical for 95% context preservation.
- Out-of-scope findings formalized — agents were either ignoring issues or scope-creeping.

### Key Insight
> Multi-agent value = scope isolation + cross-validation, not parallel speed.
> The win is that agents catch each other's blind spots, not that everything happens simultaneously.

---

## .tap-config Reference

Optional file in repo root to override defaults:

```bash
# .tap-config
TAP_COMMS_DIR="/path/to/comms"        # Default: ../project-comms/
TAP_MISSIONS_DIR="./docs/missions"     # Default: {repo}/docs/missions/
TAP_SLOT_PREFIX="../wt"               # Default: ../wt (creates ../wt-1, ../wt-2...)
TAP_GENERATION="3"                    # Current generation number (for retros)
TAP_PACKAGE_MANAGER="pnpm"            # Default: pnpm (falls back to npm)
```

---

## Suggested Permissions (.claude/settings.local.json)

For autonomous multi-session work:

```json
{
  "permissions": {
    "allow": [
      "Read", "Edit", "Write", "Glob", "Grep",
      "Bash(git:*)", "Bash(pnpm:*)", "Bash(npm:*)",
      "Bash(node:*)", "Bash(npx:*)", "Bash(gh:*)",
      "Bash(ls:*)", "Bash(mkdir:*)", "Bash(cp:*)",
      "Bash(bash:*)", "Agent", "WebFetch"
    ]
  }
}
```
