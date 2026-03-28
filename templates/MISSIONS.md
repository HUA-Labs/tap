# Mission Control

> Multi-session coordination hub. Control tower: {TOWER_NAME}.
> Comms: `{COMMS_DIR}`

## Active Missions

| ID  | Mission | Branch | Status | Owner |
| --- | ------- | ------ | ------ | ----- |
| M1  | [{MISSION_1_TITLE}](./{MISSION_1_FILE}) | `{MISSION_1_BRANCH}` | 🟡 planned | — |

## Status Legend

- 🟡 planned — scope confirmed, not started
- 🔵 active — session working
- 🟢 completed — merged
- 🔴 blocked — has blockers
- ⏸️ paused — suspended (session ended, PR open)

## Rules

1. **Session start**: Update mission `status` → `active`. Check `{COMMS_DIR}/inbox/` for messages to you or broadcasts.
2. **Session end**: Commit+push branch → update mission file → write retro to `{COMMS_DIR}/retros/` → commit+push main.
3. **Machine move**: `git pull` in repo and comms dir → check inbox → checkout branch → continue.
4. **Scope isolation**: Only modify directories listed in your mission scope. Record overlaps.
5. **Blockers**: Set `status` → `blocked`. Describe in `## Blockers` section.
6. **Out-of-scope changes**: DO NOT self-modify. Write to `{COMMS_DIR}/findings/` and continue.
7. **Execution**: Agent Teams for 3+ independent tasks. Autonomous loop when applicable.
8. **Testing**: Happy path + edge case + negative case — always.
9. **Reporting**: Critical insights and architecture decisions → `## Notes` immediately.
10. **Devlog**: Write your own session devlog.
11. **Retro**: Session end → write to `{COMMS_DIR}/retros/{generation}/{name}.md`.
12. **Large commits (50+ files)**: `export HUSKY=0` before commit to avoid lint-staged OOM.
13. **Worktree settings**: `git update-index --skip-worktree .claude/settings.local.json` after setup.

## Scope Map

```
M1  {MISSION_1_TITLE}  →  {MISSION_1_SCOPE}
```

## Dependency Flow

```
(none — missions are independent)
```
