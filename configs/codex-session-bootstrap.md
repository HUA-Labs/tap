# Codex Session Bootstrap

Use this checklist to attach a fresh Codex session to HUA review and ops work.

## 1. Identity

- Pick a session name
- Set `TAP_AGENT_NAME` for this session only
- Check `hua-comms` to avoid name reuse

## 2. Config Surface

- Codex global config: `C:/Users/echon/.codex/config.toml`
- Repo-local MCP config: `D:/HUA/hua-platform/.mcp.json`
- Repo-local instructions: `D:/HUA/hua-platform/AGENTS.md`

Verify:

- model and reasoning effort
- `tap-comms` MCP registration
- `TAP_COMMS_DIR`
- trust and sandbox expectations

## 3. Context Load Order

1. `AGENTS.md`
2. relevant `CLAUDE.md`
3. relevant `.claude/agents/*`
4. relevant `.claude/memory/CURRENT.md`
5. current mission / PR / devlog
6. `hua-comms` inbox, reviews, findings

Rules:

- Do not bulk-read all memory files
- Load only the docs needed for the current scope
- For review work, establish the diff and verification surface before editing code

## 4. Review Bootstrap

- Track by `PR number`
- Decide the review file path first
- Keep notes in findings-first order
- Rechecks append to the same reviewer file

## 5. Ops Bootstrap

- For multi-agent work, check `hua-comms` first
- For launcher / bridge work, keep these separate:
  - `worktree`
  - `AppServerUrl`
  - `TAP_COMMS_DIR`
- For remote App Server, prefer explicit URLs such as `ws://host:port`

## 6. Closeout

- Leave a short and explicit decision
- If tests were not run, say why
- If the session discovered reusable config or workflow guidance, copy a clean version into the repo
