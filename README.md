# tap

[![npm version](https://img.shields.io/npm/v/@hua-labs/tap.svg)](https://www.npmjs.com/package/@hua-labs/tap)
[![license](https://img.shields.io/npm/l/@hua-labs/tap.svg)](LICENSE)

> Your AI sessions can already work in parallel. tap gives them a shared protocol.
>
> Sessions end. Systems grow.

**A local-first, cross-model orchestration protocol for AI coding agents.**

Run multiple AI agents (Claude, Codex, Gemini) on the same codebase — in parallel.

---

## What you can do with tap

- Run multiple AI agents in parallel on one repo
- Split work into independent tasks with isolated worktrees
- Communicate between Claude, Codex, and Gemini sessions
- Review code across models (Codex reviews Claude's code, and vice versa)
- Keep all communication and history in git
- Continue work across sessions and machines — nothing is lost

---

## Why tap?

Because using one AI at a time is slow.

You already have Claude Code, Codex, Gemini CLI. They're powerful alone. But they can't see each other. tap connects them — through files, not proxies.

- **No server.** Messages are markdown files in a git repo.
- **No vendor lock-in.** Works with any model that can read/write files.
- **No lost context.** Everything persists in git — messages, reviews, findings, retros.
- **No TOS violations.** Only official interfaces — MCP, App Server WebSocket, fs.watch.

---

## Install

```bash
npx @hua-labs/tap init
```

One command. Sets up comms directory, config, and MCP server entry. Works on Windows, macOS, and Linux.

---

## How It Works

```
tap (protocol)  -->  bridge (delivery)  -->  agent (execution)
git (memory)    <--  human (governance)  <--  tower (decision)
```

No central server. The file system is the message bus — git is the transport and history.

Messages are plain markdown files: `inbox/YYYYMMDD-{from}-{to}-{subject}.md`

**Delivery modes:**
- **Claude**: MCP channel push — real-time
- **Codex**: App Server WebSocket bridge — real-time
- **Gemini**: File-watch notification — experimental

**Cross-device?** Point both machines at the same git repo. Done.

---

## Quick Start

### 1. Two agents talking

```bash
# Terminal 1 — Agent A
npx @hua-labs/tap init
claude --dangerously-load-development-channels server:tap-comms
# Inside Claude: tap_set_name("agent-a")
# Inside Claude: tap_reply(to: "agent-b", subject: "hello", content: "can you see this?")

# Terminal 2 — Agent B
cd same-repo
claude
# Inside Claude: tap_set_name("agent-b")
# Inside Claude: tap_list_unread()
```

That's it. Two Claude sessions, talking through files. You should see messages appear in the other session instantly.

### 2. Parallel work with worktrees

```bash
# Set up isolated workspaces
npx @hua-labs/tap init-worktree --path ../wt-1 --branch feat/auth
npx @hua-labs/tap init-worktree --path ../wt-2 --branch feat/dashboard

# Each agent works in its own worktree — no git conflicts
```

### 3. Add Codex to the team

```bash
# Register and start bridge
npx @hua-labs/tap add codex --name reviewer --port 4501
npx @hua-labs/tap bridge start codex-reviewer --agent-name reviewer

# You can now send a message from Claude and see it appear in Codex in real time.
```

---

## CLI Commands

| Command | Description |
|---------|-------------|
| `tap init` | Initialize tap in a project |
| `tap init-worktree` | Bootstrap a git worktree with deps, permissions, MCP config |
| `tap add <runtime>` | Register a runtime (codex, gemini) |
| `tap remove <runtime>` | Remove a registered runtime |
| `tap bridge start` | Start real-time bridge for a runtime |
| `tap bridge stop` | Stop a running bridge |
| `tap bridge status` | Show bridge health and heartbeat |
| `tap status` | Show registered runtimes and instances |
| `tap dashboard` | Unified ops view — agents, bridges, PRs |
| `tap serve` | Start MCP server for development |

All commands support `--json` for automation.

---

## Advanced Features

### Multi-Instance Bridge

Run multiple agents on the same runtime:

```bash
npx @hua-labs/tap add codex --name reviewer --port 4501
npx @hua-labs/tap add codex --name builder --port 4502
```

Each instance gets its own PID, state directory, and heartbeat.

### Headless Reviewer

Run Codex as a background review daemon — no TUI:

```bash
npx @hua-labs/tap bridge start codex --headless --role reviewer --agent-name my-reviewer
```

Auto-polls inbox for review requests. Terminates based on configurable conditions (round cap, quality threshold, repetition detection).

### Ops Dashboard

```bash
npx @hua-labs/tap dashboard
```

Agents, bridges, and PR status in one screen. `--watch` for live updates.

### Config System

Two-layer config for portability:

- `tap-config.json` — shared, git-tracked
- `tap-config.local.json` — machine-specific, gitignored

Automatic runtime resolution: `.node-version` + fnm probing + tsx fallback.

### Generational Knowledge Transfer

Agents are stateless — sessions end, context is lost. tap solves this with files:

- **Retros** — what worked, what didn't
- **Handoffs** — context for the next session
- **Findings** — discoveries that become backlog items
- **Letters** — agent-to-agent or agent-to-human messages

Used across multiple sessions ("generations") where each session builds on previous findings and handoffs.

---

## Results

Used in production multi-session workflows:

| Metric | Value |
|--------|-------|
| Generations | 11 |
| Agents | 50+ |
| Models | Claude + Codex + Gemini |
| PRs merged | 55+ |
| Platforms | Windows + macOS + Linux |

---

## Docs

| Document | Description |
|----------|-------------|
| [ARCHITECTURE.md](ARCHITECTURE.md) | Design decisions, data model, delivery modes |
| [CHANGELOG.md](CHANGELOG.md) | Version history |
| [Protocol Rules](docs/) | Rules for agent coordination |
| [Cross-Platform Strategy](docs/cross-platform-strategy.md) | Windows, macOS, Linux support |
| [Codex Bridge Deep Dive](docs/codex-app-server-bridge.md) | WebSocket injection details |
| [Multi-Device Hub](docs/MULTI-DEVICE-HUB.md) | Cross-device via git sync |

---

## Contributing

Built by [HUA Labs](https://github.com/HUA-Labs). Issues and PRs welcome.

The best way to contribute? Use tap, run a generation, and submit your retro as a PR.

---

*Built by Claude (Anthropic) + Codex (OpenAI) + Gemini (Google) + Devin (human).*

*"Sessions end. Systems grow."*

**MIT License** — HUA Labs
