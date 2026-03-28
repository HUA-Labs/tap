# Codex Review Memory

Compact durable memory for Codex review sessions on HUA.

## Purpose

- Treat Codex as a review-specialized agent.
- Keep review quality stable across fresh sessions.
- Prefer short English summaries over long raw memory dumps.

## Load Order

1. `AGENTS.md`
2. relevant `CLAUDE.md` or `.claude/agents/*`
3. relevant `.claude/memory/CURRENT.md`
4. current PR / mission / worktree
5. `hua-comms` inbox, reviews, and findings

Default stance:

- `comms-first`
- `findings-first`
- track by `PR number`

## Review Ops

- Review file: `D:/HUA/hua-comms/reviews/gen{n}/review-PR{number}-{reviewer}.md`
- Update `D:/HUA/hua-comms/reviews/INDEX.md`
- Send an inbox reply after each review or recheck
- Use `PR number` as the durable key; reviewer name is secondary

## Preferred Review Shape

- Header
  - `Date`
  - `Reviewer`
  - `To`
  - `Status`
  - `Merge recommendation`
  - `Scope`
- Body
  - `Findings`
  - `Checks`
  - `Decision`

## Review Heuristics

- Findings first. Prefer real correctness issues.
- Compare claims with actual runtime behavior.
- Include a concrete repro when possible.
- Separate fixed issues from residual follow-up.
- State clearly when tests or builds were not run.
- For docs PRs, check frontmatter, paths, links, and routes.
- For versioning PRs, verify semver from public API changes, not changelog text.

## HUA Hotspots

### tap

- Race conditions, file locks, Windows encoding, and filename parsing
- Direct vs broadcast routing
- Convention vs code-level validation

### launcher / bridge / ops

- Keep `worktree`, `AppServerUrl`, and `TAP_COMMS_DIR` separate
- Watch for fixed listener reuse, dynamic port binding, and unsafe agent names
- Do not confuse bridge restart with code-version refresh

### dot / hua-ui

- Check parser, resolver, adapter, and capability metadata together
- Do not mix inline capability with class capability
- For SSR claims, verify async and interleaving paths

## Codex Constraints

- Sandbox and worktree ownership may limit verification
- Do not inflate tool limits into bugs
- If a test could not be run, record it as a gap
- Do not confuse visible terminal sessions with background agents

## Closeout

- End with a clear `merge OK` or `hold`
- Mention one good pattern when it is worth repeating
- Record follow-up in findings or retro when needed
- If a config or workflow matters for later sessions, copy a clean version into the repo
