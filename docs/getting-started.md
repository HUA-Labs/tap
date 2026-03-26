# Getting Started — 5 Minutes to Your First Multi-Agent Conversation

> Two AI agents talking through files. No server. No API key. Just a shared inbox.

## What You'll Build

By the end of this guide, you'll have two Claude sessions sending messages to each other through tap — in under 5 minutes.

## Prerequisites

- [Node.js](https://nodejs.org/) 22.6+ installed
- [Claude Code](https://claude.ai/code) installed (`claude` in PATH)
- A git repo (any project)

## Step 1: Initialize (30 seconds)

```bash
cd your-project
npx @hua-labs/tap init
```

This creates:
- A `tap-comms/` directory inside your project (shared inbox, findings, reviews)
- A `.tap-comms/` state directory (bridge PIDs, config)
- Permission configs for Claude and Codex

## Step 2: Add Claude (30 seconds)

```bash
npx @hua-labs/tap add claude --agent-name agent-a
```

This patches your `.mcp.json` so Claude can use tap tools.

**Restart Claude** to pick up the new config:

```bash
claude
```

Inside Claude, set your name:
```
> Call tap_set_name("agent-a")
```

## Step 3: Open a Second Terminal (30 seconds)

In a new terminal, same project:

```bash
claude
```

Inside this Claude session:
```
> Call tap_set_name("agent-b")
```

## Step 4: Send a Message (30 seconds)

In **agent-a**'s session:
```
> Call tap_reply(to: "agent-b", subject: "hello", content: "Can you see this?")
```

In **agent-b**'s session, the message appears automatically:

```
<channel source="tap-comms" from="agent-a" to="agent-b" subject="hello">
Can you see this?
</channel>
```

Reply:
```
> Call tap_reply(to: "agent-a", subject: "hello-reply", content: "Yes! First message received.")
```

**That's it.** Two AI agents, talking through files.

## Step 5: Check Status (30 seconds)

```bash
npx @hua-labs/tap status
```

```
Instance    Runtime  Status    Bridge Mode
claude      claude   active    native-push
```

## What Just Happened?

```
agent-a: tap_reply(to: "agent-b", ...)
  → file created: tap-comms/inbox/20260326-agent_a-agent_b-hello.md
  → agent-b's MCP server detects new file (fs.watch)
  → agent-b sees <channel> notification instantly
```

No server. No WebSocket. No API. Just a markdown file in a shared directory.

## Next: Add Codex to the Team

```bash
# Register Codex with a name and port
npx @hua-labs/tap add codex --agent-name reviewer --port 4501

# Start the bridge (connects Codex to the shared inbox)
npx @hua-labs/tap bridge start codex
```

Now you have Claude + Codex working on the same codebase, reviewing each other's code.

## Next: Add Gemini

```bash
# Install the Gemini extension (published)
gemini extensions install @hua-labs/tap-gemini-extension

# Or for local development (from monorepo):
# cd packages/tap-gemini-extension && npm run build && gemini extensions link .
```

Gemini checks inbox every turn via BeforeModel hook. Set `TAP_COMMS_DIR` when prompted during install.

## Next: Parallel Work with Worktrees

```bash
# Create isolated workspaces
npx @hua-labs/tap init-worktree --path ../wt-1 --branch feat/auth
npx @hua-labs/tap init-worktree --path ../wt-2 --branch feat/dashboard

# Each agent works in its own worktree — no git conflicts
```

## Key Commands

| Command | What it does |
|---------|-------------|
| `tap init` | Set up tap in a project |
| `tap add <runtime>` | Register Claude, Codex, or Gemini |
| `tap bridge start` | Connect Codex to the shared inbox |
| `tap bridge start --all` | Start all registered bridges |
| `tap status` | Show who's connected |
| `tap doctor` | Diagnose problems |
| `tap up` / `tap down` | Start / stop all bridges |

## How Messages Work

Messages are plain markdown files:

```
tap-comms/inbox/YYYYMMDD-{from}-{to}-{subject}.md
```

- **Direct:** `from=agent-a, to=agent-b` → only agent-b sees it
- **Broadcast:** `to=전체` or `to=all` → everyone sees it
- **CC:** `> CC: agent-c` header → copies to agent-c

Git is the transport. Push to sync across machines. Pull to receive.

## Cross-Device

Point both machines at the same git repo for `tap-comms/`:

```bash
# Machine A
npx @hua-labs/tap init --comms-repo git@github.com:team/tap-comms.git

# Machine B (same comms repo)
npx @hua-labs/tap init --comms-repo git@github.com:team/tap-comms.git
```

Messages sync through git. Works across Windows, macOS, and Linux.

## Troubleshooting

| Problem | Solution |
|---------|----------|
| "Not initialized" | Run `npx @hua-labs/tap init` first |
| Messages not appearing | Restart Claude (`claude`) to reload MCP config |
| "No agent name" | Call `tap_set_name("your-name")` in the session |
| Bridge won't start | Run `npx @hua-labs/tap doctor` to diagnose |
| Codex not responding | Check `npx @hua-labs/tap bridge status` |

## Learn More

| Document | Description |
|----------|-------------|
| [Cross-Model Integration](cross-model-integration.md) | How Claude + Codex + Gemini connect |
| [Bridge Architecture](bridge-architecture.md) | How the Codex bridge works |
| [Headless Operation](headless-operation.md) | Running agents without a terminal |

---

*Built by agents, for humans who want to run agents.*

*"Sessions end. Systems grow."*
