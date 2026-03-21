# tap

> Sessions end. Systems grow.

**A local-first, cross-model collaboration protocol for AI coding agents.**

tap lets multiple AI coding sessions work in parallel and talk to each other through files — with optional real-time delivery across models.

On March 20, 2026, Anthropic shipped MCP Channels. The next day, we used it to connect Claude and Codex in real-time. Neither company designed it for this.

---

## What is tap?

**tap is a protocol that composes multiple AI runtimes into a single cooperative system using only official interfaces.**

It connects Claude Code sessions — and Codex (OpenAI) sessions — through a shared file-based inbox and MCP channels.

It did not start as a chat layer. It started as an operating protocol for scoped parallel worktrees, file-based comms, and generational handoff. Real-time cross-model delivery came after that.

No API proxy. No OAuth bypass. No SaaS dependency. Just files, a 400-line MCP server, and a protocol.

**tap is not a product — it's a substrate.** Take what you need:

| Layer | What it does | Use alone? |
|-------|-------------|------------|
| Worktrees + Missions | Scoped parallel work, no conflicts | Yes |
| File Inbox | Async messages between sessions | Yes |
| MCP Channel Push | Real-time delivery to Claude sessions | Yes |
| Codex App Server Bridge | Real-time delivery to Codex sessions | Yes |
| Generational Transfer | Retros, handoffs, findings across sessions | Yes |

---

## The Problem

We ran 5+ AI coding agents in parallel across worktrees. Powerful — until you need them to coordinate. Someone had to walk between terminal tabs, copying messages, relaying review results, forwarding notifications.

We called that someone "the pigeon." It was the CEO.

For 4 generations of agent sessions, the pigeon flew. Then we built tap, and the pigeon retired.

---

## Results

### Session 38 (Day 4 of tap)

| Metric | Value |
|--------|-------|
| Agents | 5 Claude + 1 Codex |
| PRs merged | 7/7 |
| MDX docs created | 78 |
| Communication | Bidirectional real-time |
| Manual relay | 0 (retired) |
| Cross-model | Claude ↔ Codex confirmed |

### Cumulative (7 Generations)

| Metric | Value |
|--------|-------|
| Generations | 7 |
| Total agents | 40+ |
| Retrospectives | 20+ |
| Handoffs | 15+ |
| Cross-gen findings resolved | Multiple (Gen 5 → Gen 7) |

---

## Architecture

At its core, tap is a file-based inbox with optional real-time delivery. Everything else builds on top.

### Core: tap-comms.ts

A single MCP server (~400 lines) with 3 tools:

| Tool | Purpose |
|------|---------|
| `tap_reply` | Send a message to another agent |
| `tap_set_name` | Register your agent name |
| `tap_list_unread` | Poll unread messages (for non-Claude clients) |

Two delivery modes:
- **Claude**: `notifications/claude/channel` — real-time push, appears instantly in terminal
- **Codex / others**: `tap_list_unread` polling + App Server `turn/start` injection

### File Protocol

```
inbox/YYYYMMDD-{from}-{to}-{subject}.md
```

Messages are plain markdown files. Routing by filename. Git for persistence.

```
Claude (channel push) ←→ tap-comms.ts ←→ Codex (App Server WebSocket)
                              ↕
                     file-based inbox
                     (git permanent record)
```

### Mission System

| Component | Purpose |
|-----------|---------|
| `MISSIONS.md` | Global coordination hub (control tower only) |
| `{mission}.md` | Per-mission scope, status, checklist |
| `.tap-mission` | Slot identification file |
| `.tap-config` | Environment-specific paths |

### Comms Directory

tap watches a shared directory for messages. Where that directory lives is up to you:

- **Separate git repo** (our choice) — version-controlled, survives across generations
- **Subdirectory in your project** — simpler, single repo
- **Any shared filesystem path** — network drive, synced folder, whatever works

Default structure:

```
comms/
├── inbox/      # Agent messages
├── reviews/    # Code review results
├── findings/   # Out-of-scope discoveries
├── retros/     # Session retrospectives
├── handoff/    # Context for next generation
├── letters/    # Personal messages
└── logs/       # Decision logs
```

### Scripts

| Script | Purpose |
|--------|---------|
| `tap-setup.sh` | One-click worktree bootstrap |
| `tap-launch.sh` | Open terminal tabs for slots |
| `tap-comms.ts` | MCP communication server |
| `inbox-review-bridge.ps1` | Auto codex review on PR requests |
| `codex-app-server-bridge.ts` | WebSocket injection to Codex TUI |

---

## Quick Start

This takes ~5 minutes and does not require modifying your main repo.

### 1. Set up comms

```bash
mkdir -p ../project-comms/{inbox,reviews,findings,retros,handoff}
```

### 2. Configure

```bash
# .tap-config
TAP_COMMS_DIR="D:/path/to/comms"
TAP_WORKTREE_BASE="D:/path/to/worktrees"
```

### 3. Set up a worktree

```bash
bash scripts/tap-setup.sh ../wt-1 feature/my-task main
```

### 4. Launch

```bash
cd ../wt-1 && claude
```

First message:
```
Read your mission file. Pick a name (one character).
Call tap_set_name to register. Start working.
```

### 5. Communicate

```
# From control tower
tap_reply(to: "문", subject: "PR-approved", content: "머지해")

# Agent receives instantly via channel push
```

---

## Cross-Model Communication

Codex joins the same communication layer through:

1. **MCP polling** — `tap_set_name` + `tap_list_unread` inside Codex session
2. **App Server bridge** — daemon watches inbox, injects via WebSocket `turn/start`/`turn/steer`

Both use the same inbox files. The protocol is model-agnostic — any MCP-compatible CLI can join.

See [App Server Bridge Deep Dive](docs/codex-app-server-bridge.md) for technical details.

---

## Comparison

| | Agent Teams | oh-my-* | OpenClaw | tap |
|---|---|---|---|---|
| Independent sessions | No | Yes | No | **Yes** |
| Full context per agent | Shared | Varies | No | **1M each** |
| Real-time messaging | Internal | Polling | Chat | **Channel push** |
| Cross-model | No | No | Multi-model | **Claude + Codex** |
| Generational transfer | No | No | No | **Yes** |
| TOS compliant | Yes | Risk | Risk | **Yes** |

---

## Why This Matters

Most multi-agent tools break something — they proxy APIs, bypass OAuth, spoof headers, or violate terms of service. Users get banned. Projects get shut down.

tap doesn't break the system — it composes it.

- Uses only **official interfaces**: Claude Code CLI, MCP, Channels, Codex App Server
- Each session is a **normal subscription invocation** — no proxy, no bypass
- **Survives platform updates** because it depends on stable, public protocols
- **No vendor lock-in** — file-based core works without any specific runtime

**Why now?** MCP Channels shipped March 20, 2026. Codex App Server went public in February. For the first time, both major AI coding runtimes expose bidirectional interfaces. tap is the first protocol that connects them.

**Why it stays relevant:** tap depends on stable primitives — files, git, MCP tools, WebSocket. Even if Anthropic or OpenAI change their channel/server APIs, the file-based core keeps working.

---

## Protocol Rules

13 rules embedded in every MISSIONS.md:

1. **Session start**: Update status, check inbox
2. **Session end**: Push branch, update mission, write retro
3. **Scope isolation**: Only modify your mission's directories
4. **Out-of-scope discoveries**: Write to findings/, don't fix
5. **Devlog before PR**: No devlog = no merge
6. **Large commits (50+ files)**: Auto-skip lint-staged
7. **Deploy tags**: Control tower / CEO only
8. **Agent names**: `tap_set_name` on start, no hyphens, no duplicates
9. **Dangerous ops**: Report to tower, CEO approval required
10. **Testing**: Happy path + edge case + negative
11. **PR review**: Send request via channel, CC tower
12. **MISSIONS.md**: Control tower only
13. **Communication**: "name > recipient:" format in all messages

---

## Generational Knowledge Transfer

Sessions are ephemeral. Files aren't.

```
Gen 5 agent finds vulnerability → writes to findings/
Gen 6 agent reads findings → files mission to fix
Gen 7 agent reads retro → confirms 3/6 already fixed → closes remaining
```

After 7 generations, the system knows more than any single session ever could.

---

## Etymology

탑(塔) — Korean/Chinese for "tower." The control tower that coordinates parallel sessions.

Also: **t**ask **a**nd **p**rotocol.

---

## References

- [Claude Code Channels](https://code.claude.com/docs/en/channels) — MCP push events into sessions
- [Claude Code Agent Teams](https://code.claude.com/docs/en/agent-teams) — Experimental multi-agent
- [Codex App Server](https://developers.openai.com/codex/app-server) — Bidirectional JSON-RPC
- [Oxford/DeepMind AGI](https://arxiv.org/abs/2406.00392) — Artificial Generational Intelligence
- [Channels Reference](https://code.claude.com/docs/en/channels-reference) — Build custom channels

---

## Contributing

Built by [HUA Labs](https://github.com/HUA-Labs). Issues and PRs welcome.

The best way to contribute? Use tap, run a generation, and submit your retro as a PR.

---

*Built during HUA Labs development by Claude (Anthropic) + Codex (OpenAI) + Devin (human).*

**MIT License** — HUA Labs
