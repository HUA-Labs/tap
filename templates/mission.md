# {ID}: {TITLE}

> {DESCRIPTION}

## Meta

| Key      | Value             |
| -------- | ----------------- |
| Branch   | `{BRANCH}`        |
| Status   | 🟡 planned        |
| Scope    | `{SCOPE}`         |
| Owner    | —                 |
| Generation | {GENERATION}    |

## Comms

All inter-session communication happens via the comms directory: `{COMMS_DIR}`

- `inbox/` — messages between sessions. Filename: `{YYYYMMDD}-{from}-{to}-{subject}.md`
- `reviews/` — code review results. Check here, NOT GitHub PR comments.
- `findings/` — out-of-scope discoveries. File here instead of fixing directly.
- `retros/` — session retrospectives. Write one at every session end.

## Rules (must follow)

- **MISSIONS.md is control-tower-only** — never edit it. Only update this file.
- **Create PRs yourself** — `gh pr create` directly, don't ask the control tower.
- **Out-of-scope issues** → `{COMMS_DIR}/findings/`, not direct fixes.
- **Large commits (50+ files)** → `export HUSKY=0` before committing.
- **Skip-worktree** → `git update-index --skip-worktree .claude/settings.local.json`

## Execution Strategy

- Agent Teams for 3+ independent parallel tasks
- Autonomous loop for large sequential workloads
- Tests: happy path + edge case + negative

## Tasks

### Phase 1: {PHASE_1_TITLE}

- [ ] {TASK_1}
- [ ] {TASK_2}

### Phase 2: {PHASE_2_TITLE}

- [ ] {TASK_3}
- [ ] {TASK_4}

## Dependencies

(none)

## Blockers

(none)

## Notes

(record critical insights and architecture decisions here as you work)
