# TAP Config Backups

Gen 8 운영 중 실제로 쓰던 Codex / TAP 설정 표면을 다음 세션용으로 백업한 디렉터리다.

## Included

- `codex-config-example.toml`
  - source: `C:/Users/echon/.codex/config.toml`
  - Codex 기본 모델, reasoning effort, approval/sandbox defaults, MCP server registration
- `codex-review-memory.md`
  - source refs: `.claude/memory/codex-review.md`, `.claude/memory/MEMORY.md`, `.claude/memory/CURRENT.md`
  - compact English durable memory for Codex review sessions
- `codex-session-bootstrap.md`
  - source refs: `AGENTS.md`, `.claude/memory/*`
  - compact English bootstrap checklist for new Codex sessions
- `codex-mcp-example.json`
  - source: `D:/HUA/hua-platform/.mcp.json`
  - repo-local `tap` MCP wiring example
- `codex-agents-example.md`
  - source: `D:/HUA/hua-platform/AGENTS.md`
  - repo-local review guidance
- `mcp-claude-example.json`
  - Claude/TAP example
- `settings-local-example.json`
  - Claude local permissions example

## Notes

- 이 디렉터리는 `auth.json`, session logs, local sqlite, token 같은 민감값은 포함하지 않는다.
- `TAP_AGENT_NAME`은 세션마다 바꿔야 한다.
- `TAP_COMMS_DIR`과 worktree path는 현재 HUA 운영 경로 기준이다.
- `D:/HUA/hua-platform` 같은 절대 경로는 historical ops example이다. standalone checkout의 live runtime import path로 읽으면 안 된다.
- repo root의 `AGENTS.md`가 canonical이다. 여기 복제본은 다음 세션 bootstrap 용도다.
- `.claude/memory/` is the Claude-side canonical memory.
- For Codex, prefer the shorter English summaries here over copying long memory files verbatim.

## Canonical Sources

- Codex global config: `C:/Users/echon/.codex/config.toml`
- Repo-local agent instructions: `D:/HUA/hua-platform/AGENTS.md`
- Repo-local MCP config: `D:/HUA/hua-platform/.mcp.json`
- Repo-local Claude memory: `D:/HUA/hua-platform/.claude/memory/`
