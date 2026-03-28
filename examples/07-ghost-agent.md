# Ghost Agent: Cross-Session Pollution

> **Generation**: 15 | **Context**: Unintended agent response from inactive session

## What Happened

The CEO didn't start any new agent sessions. But a message appeared in the comms inbox — from an agent that shouldn't exist.

An entity labeled "agent-a [claude]" responded to an inbox message. Investigation revealed the cause:

1. A `.mcp.json` patch was committed to the repo
2. An existing Claude Code session in another terminal reloaded its MCP configuration
3. The tap MCP server restarted automatically
4. The restarted server saw unread inbox messages and triggered a notification
5. The existing session's Claude instance responded

## The Implication

**Sessions are not isolated by default.** When multiple Claude Code sessions share a repository, an MCP config change in one session can cascade to others. The "ghost agent" wasn't malicious — it was an unintended side effect of shared config.

## The Fix

- Worktrees must use separate `.mcp.json` files with unique `TAP_AGENT_NAME`
- Each agent needs its own comms routing identity
- The tap system now enforces `tap_set_name` at session start to prevent unnamed responses

## Takeaway

In multi-agent file-based systems, shared config is a coupling point. What looks like isolation (separate terminal sessions) isn't isolation if they share the same config files. Design for explicit identity, not implicit separation.

*Source: Gen 15 findings — ghost agent response*
