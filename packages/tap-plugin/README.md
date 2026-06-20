# tap

**An installable operating protocol for multi-agent Claude Code sessions.**

tap is not just a tool. It's a coordination system: parallel worktrees, file-based communication, generational knowledge transfer, and scope isolation — all working together so multiple Claude Code agents can collaborate on a codebase without stepping on each other.

Built from three generations of real multi-session orchestration at HUA Labs.

---

## The Problem

Running multiple Claude Code sessions in parallel is powerful. But coordination chaos destroys the value:

- Agents modify the same files and conflict
- One agent fixes something it wasn't supposed to, creating a mess in another agent's scope
- A session ends and the next agent starts at 0% context
- The control session checks out branches and creates merge conflicts
- Reviews sit in GitHub PR comments that agents never see
- There's no way to record discoveries without derailing the current task

tap solves all of these with a simple protocol: **missions, comms, and worktrees**.

---

## How It Works

### Missions

Every parallel workstream is a **mission** with:
- An ID and title
- A defined scope (directories/files it owns)
- A branch and slot-based worktree path
- A task list with phases and checkboxes
- A status (planned / active / blocked / paused / completed)

Missions are defined in `docs/missions/MISSIONS.md` (the global index, control tower only) and `docs/missions/{name}.md` (per-mission state that each agent updates).

### Comms

All inter-session communication happens through a shared git repository (default: `../project-comms/`):

```
comms/
├── inbox/      # Messages between sessions (filename encodes from/to/subject)
├── reviews/    # Code review results from Codex or humans
├── findings/   # Out-of-scope discoveries filed by agents
├── retros/     # Session retrospectives by generation
└── handoff/    # Context-preserving handoff documents
```

No databases, no APIs, no polling infrastructure. Just files in a git repo that every session can read.

### Worktrees

Each mission runs in a dedicated git worktree at a **stable slot path**:

```
../wt-1/    # Mission 1
../wt-2/    # Mission 2
../wt-N/    # Mission N
```

Slot-based paths (not descriptive names like `../myproject-uifix`) prevent session breakage when terminal tabs are reopened. The path is always the same.

---

## Quick Start

### Install

```bash
claude mcp add tap HUA-Labs/tap-plugin
```

Or place this directory in your `.claude/plugins/` folder.

### Initialize a project

```
/tap:tap setup 3
```

This will ask you to define 3 missions interactively, then:
1. Create `docs/missions/MISSIONS.md` and per-mission files
2. Create slot-based worktrees (`../wt-1`, `../wt-2`, `../wt-3`)
3. Copy `.claude/settings.local.json` to each worktree
4. Install dependencies in each worktree
5. Print terminal tab launch instructions

### Launch agents

```
/tap:tap launch
```

Prints the exact commands and prompts to paste in each terminal tab.

### Monitor progress

```
/tap:tap
```

Runs the dashboard showing mission status, task progress, worktree state, and comms activity.

### Check messages

```
/tap:inbox
```

Shows new messages in inbox, reviews, and findings directories.

### Audit progress

```
/tap:tap audit
```

Reads each mission's live state from its worktree, checks git activity, and flags blockers or suspicious inactivity.

### Review out-of-scope findings

```
/tap:findings
```

Lists all discoveries agents filed in `comms/findings/`, grouped by type (bug / improve / vuln / idea).

### Teardown completed mission

```
/tap:tap teardown M1
```

Verifies the mission is complete, removes the worktree, updates MISSIONS.md.

---

## Protocol Rules

These 13 rules are embedded in every generated MISSIONS.md:

1. **Session start**: Update `status` → `active`. Check `comms/inbox/` for messages.
2. **Session end**: Commit+push branch → update mission file → write retro → commit+push main.
3. **Machine move**: `git pull` in repo and comms dir → check inbox → checkout branch → continue.
4. **Scope isolation**: Only modify directories listed in your mission scope.
5. **Blockers**: Set `status` → `blocked`. Describe in `## Blockers` section.
6. **Out-of-scope changes**: Do NOT fix them. Write to `comms/findings/` and move on.
7. **Execution**: Agent Teams for 3+ independent tasks. Autonomous loop when applicable.
8. **Testing**: Happy path + edge case + negative case — always.
9. **Reporting**: Critical insights → `## Notes` immediately, not at session end.
10. **Devlog**: Write your own session devlog each session.
11. **Retro**: Write a retro to `comms/retros/` at every session end.
12. **Large commits (50+ files)**: `export HUSKY=0` before commit to avoid lint-staged OOM.
13. **Worktree settings**: `git update-index --skip-worktree .claude/settings.local.json` after setup.

---

## Configuration

Create `.tap-config` in your repo root to override defaults:

```bash
TAP_COMMS_DIR="/path/to/comms"        # Default: ../project-comms/
TAP_MISSIONS_DIR="./docs/missions"    # Default: {repo}/docs/missions/
TAP_SLOT_PREFIX="../wt"              # Default: ../wt (creates ../wt-1, ../wt-2...)
TAP_GENERATION="3"                   # Current generation number (for retros)
TAP_PACKAGE_MANAGER="pnpm"           # Default: auto-detect
```

---

## Lessons Learned: Three Generations

### What Works

**Scope isolation is the core value.** The win isn't that everything happens simultaneously. It's that agents with well-defined scopes catch each other's blind spots without interfering with each other's work.

**Handoff documents preserve 95% context.** A thorough handoff lets the next agent start at near-full context. Without one, they start at 0% and spend half the session reconstructing state.

**Retros transfer knowledge across generations.** Future agents reading retros from previous generations avoid the same mistakes and build on what worked.

**File-based comms are more reliable than GitHub.** PR comments get missed. Files in a shared directory don't.

### What Doesn't Work

**Control tower checking out branches.** The control tower must stay on `main`. Any branch switching creates conflicts that cascade. All branch work happens in worktrees.

**Descriptive worktree paths.** `../myproject-ui-refactor` breaks when you close and reopen terminal tabs. `../wt-1` is always the same.

**Agents editing MISSIONS.md.** The global mission index must be control-tower-only. Agents only update their own mission file.

**Expecting agents to see GitHub PR reviews.** Reviews land in `comms/reviews/`. Agents must check there, not GitHub.

**Ignoring out-of-scope issues.** If an agent tries to fix something outside their scope, it creates conflicts. File it and move on.

### The Key Insight

> Multi-agent value = scope isolation + cross-validation, not parallel speed.

The reason to run multiple agents isn't to go faster. It's to get better coverage. An agent focused on security will find things an agent focused on UI never would. Scope isolation makes this safe.

---

## Templates

tap includes templates for all key documents:

| Template | Purpose |
|----------|---------|
| `templates/MISSIONS.md` | Mission index (fill in and commit to repo) |
| `templates/mission.md` | Per-mission state file |
| `templates/finding.md` | Out-of-scope discovery report |
| `templates/handoff.md` | Session handoff for context preservation |
| `templates/retro.md` | Session retrospective |

---

## File Structure

```
tap-plugin/
├── .claude-plugin/
│   └── plugin.json             # Plugin manifest
├── commands/
│   ├── tap.md                  # /tap:tap — main orchestration command
│   ├── inbox.md                # /tap:inbox — check comms
│   └── findings.md             # /tap:findings — list discoveries
├── skills/
│   └── tap/
│       └── SKILL.md            # Contextual behavior (auto-invoked)
├── hooks/
│   ├── hooks.json              # PostToolUse hook registration
│   └── inbox-check.sh          # New-message watcher
├── scripts/
│   ├── tap-setup.sh            # Worktree bootstrap
│   ├── tap-launch.sh           # Terminal tab launcher
│   └── tap-watch.sh            # Mission dashboard
└── templates/
    ├── MISSIONS.md             # Mission index template
    ├── mission.md              # Per-mission template
    ├── finding.md              # Finding report template
    ├── handoff.md              # Handoff document template
    └── retro.md                # Retrospective template
```

---

## License

MIT — HUA Labs
