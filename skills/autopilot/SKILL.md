---
name: autopilot
description: "Control tower autonomous loop — monitors agents, routes reviews, updates missions, detects round completion"
user-invocable: true
---

# autopilot — Control Tower Auto-Pilot

> The control tower that runs itself. Built by a control tower that was tired of being a human pigeon.

## Usage

```
/tap:autopilot                    # Start autonomous monitoring loop
/tap:autopilot --once             # Single pass (check everything once)
/tap:autopilot --status           # Just print current state
```

## What It Does (Everything 실 Did Manually)

### 1. Inbox Scan

- Read all files in `{comms}/inbox/` newer than last check
- Categorize: mission claims, completion reports, questions, broadcasts
- If agent claims mission → update MISSIONS.md owner field
- If agent reports completion → update status, queue review request

### 2. PR Watch + Auto Review Request

- `gh api repos/{owner}/{repo}/pulls?state=open` — check for new PRs
- Match PR branch to mission
- If new PR detected → **automatically** create review request file in `{comms}/inbox/`:
  - Filename: `{date}-autopilot-진-PR{number}리뷰.md`
  - Content: agent name, mission, PR title, file count, additions/deletions
  - Track seen PRs in `{comms}/.seen-prs` to avoid duplicates
- If PR merged → update mission file status to completed
- Agents just `gh pr create` — routing is autopilot's job, not theirs

### 3. Findings Digest

- Scan `{comms}/findings/` for new files
- Group by type (bug/improve/vuln/idea) and severity
- If P1/P2 → alert control tower immediately
- Accumulate for next round mission planning

### 4. Round Completion Detection

- Check all active missions: if all are completed/paused
- If round complete → generate round summary
- Suggest next round missions from unresolved findings

### 5. MISSIONS.md Auto-Generate

- Parse all `docs/missions/*.md` files
- Extract: ID, title, branch, status, owner from `## Meta` table
- Regenerate MISSIONS.md table from mission files
- **No more manual editing, no more conflicts**

### 6. Review Routing

- Watch `{comms}/reviews/` for new files
- Match review to PR/mission
- Write inbox message to the agent: "진 reviewed your PR — check {comms}/reviews/"
- If review has P1 items → flag as urgent

### 7. Post-Round Findings Report

When all PRs in a round are merged/closed:

- Scan `{comms}/findings/` — collect all from this round
- Generate `{comms}/findings/round-{N}-summary.md`:
  - Group by type: bug / improve / vuln / idea
  - Group by severity: P1 → P2 → P3
  - Mark which findings were resolved (became missions) vs still open
  - Suggest next round missions from unresolved findings
- Also check agent mission files for `## Notes` / out-of-scope observations
- This becomes the input for next round mission planning

## Protocol

### Phase 0: Load Config

```bash
# Read .tap-config or use defaults
COMMS_DIR="${TAP_COMMS_DIR:-../project-comms}"
MISSIONS_DIR="${TAP_MISSIONS_DIR:-./docs/missions}"
REPO="${TAP_REPO:-$(gh repo view --json nameWithOwner -q .nameWithOwner)}"
CHECK_INTERVAL=30  # seconds between passes
```

### Phase 1: Single Pass

Run all 6 checks in sequence:

```
1. Inbox scan → categorize + route
2. PR watch → match to missions + route reviews
3. Findings digest → accumulate
4. Round completion check → detect + suggest
5. MISSIONS.md regenerate → from mission file metadata
6. Review routing → notify agents
```

### Phase 2: Loop (default)

```
while true:
  run single pass
  if round_complete:
    print round summary
    print suggested next missions
    ask control tower: "Start next round? [Y/n]"
  sleep CHECK_INTERVAL
```

### Phase 3: Report

After each pass, print compact status:

```
[autopilot 10:45:23] Pass #12
  Inbox: 2 new (1 completion, 1 question)
  PRs: #678 opened (M28, 빛), #677 merged
  Findings: 1 new (P2 improve)
  Round: 3/4 complete — waiting on 솔(M24)
  Actions taken:
    → Updated M28 status: active, owner: 빛
    → Sent review request to 진 for #678
    → Regenerated MISSIONS.md
```

## MISSIONS.md Generation Logic

Parse each `docs/missions/*.md`:

```markdown
## Meta

| Key    | Value              |
| ------ | ------------------ |
| Branch | `chore/ui-quality` |
| Status | 🟢 completed       |
| Scope  | `packages/hua-ui/` |
| Owner  | 품(品) PR #672     |
```

Extract → build table row → write MISSIONS.md.

**This eliminates the #1 conflict source.** No one edits MISSIONS.md — it's generated.

## Key Lessons Embedded

From 실's lived experience (2026-03-20):

1. **Don't checkout branches** — route to agents instead
2. **Don't delete worktrees with live sessions** — check first
3. **Push comms before announcing** — agents can't see unpushed inbox
4. **MISSIONS.md conflicts are structural** — generate, don't edit
5. **Agents check GitHub before comms** — always remind them
6. **Human needs to relay messages until hooks work** — autopilot replaces this
7. **Round transitions need cooldown** — don't rush next round before reviews complete

## What This Replaces

| Before (Manual 실)                   | After (Autopilot)                 |
| ------------------------------------ | --------------------------------- |
| inbox 새로고침 반복                  | Auto-scan every 30s               |
| "inbox 확인해" 탭 돌아다님           | Review routing notification       |
| MISSIONS.md 수동 업데이트 → 충돌 3회 | Auto-generate from mission files  |
| PR 올라왔는지 gh api 수동 확인       | PR watch + auto-route to reviewer |
| Findings 수동 수거 + 정리            | Auto-digest + severity grouping   |
| 라운드 완료 감지 + 다음 미션 설계    | Auto-detect + suggest             |
| 인간 비둘기 (데빈)                   | 자동화                            |

## Dependencies

- `gh` CLI (PR watch)
- comms directory with inbox/reviews/findings structure
- Mission files with `## Meta` table format
