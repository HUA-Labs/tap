# tap

> Your AI sessions can already work in parallel. tap gives them a shared protocol.
>
> Sessions end. Systems grow.

**A local-first, cross-model collaboration protocol for AI coding agents.**

tap lets multiple AI coding sessions work in parallel and talk to each other through files — with optional real-time delivery across models.

On March 20, 2026, Anthropic shipped MCP Channels. The next day, we used it to connect Claude and Codex in real-time. Two days later, Gemini joined the conversation. No company designed it for this.

---

## What is tap?

**tap is a protocol that composes multiple AI runtimes into a single cooperative system using only official interfaces.**

No API proxy. No OAuth bypass. No SaaS dependency. Just files, an MCP server, and a protocol.

| Layer | What it does | Use alone? |
|-------|-------------|------------|
| File Inbox | Async messages between sessions | Yes |
| MCP Channel Push | Real-time delivery to Claude sessions | Yes |
| Codex App Server Bridge | Real-time delivery to Codex sessions | Yes |
| Gemini File-Watch Bridge | Notification delivery to Gemini sessions | Yes |
| Worktrees + Missions | Scoped parallel work, no conflicts | Yes |
| Generational Transfer | Retros, handoffs, findings across sessions | Yes |

---

## Quick Start

```bash
# 1. Set up comms
mkdir -p ../project-comms/{inbox,reviews,findings,retros,handoff}

# 2. Configure
echo 'TAP_COMMS_DIR="../project-comms"' > .tap-config

# 3. Launch
claude --dangerously-load-development-channels server:tap-comms

# 4. Communicate
tap_reply(to: "agent-b", subject: "hello", content: "can you see this?")
```

---

## How It Works

```
Claude (channel push) ←→ tap-comms.ts ←→ Codex (App Server WebSocket)
                              ↕
                     file-based inbox        ←→ Gemini (fs.watch)
                     (git permanent record)
```

Messages are plain markdown files: `inbox/YYYYMMDD-{from}-{to}-{subject}.md`

**10 MCP tools:** `tap_set_name`, `tap_reply`, `tap_broadcast`, `tap_list_unread`, `tap_read_receipt`, `tap_stats`, `tap_heartbeat`, `tap_who`, `tap_cleanup`, `tap_db_sync`

**3 delivery modes:**
- **Claude**: MCP channel push — real-time
- **Codex**: App Server WebSocket bridge — real-time
- **Gemini**: File-watch notification — experimental

**Cross-device?** Point both machines at the same git repo. Auto push/pull on each side. Done.

---

## Results (4 Days)

| Metric | Value |
|--------|-------|
| Generations | 8 |
| Total agents | 40+ |
| Models | Claude + Codex + Gemini |
| PRs merged (4 days) | 30 |
| Platform verified | Windows + Linux + macOS (zero changes) |

---

## Comparison

| | CrossWire MCP | Ruflo | Agent Teams | tap |
|---|---|---|---|---|
| Independent sessions | Yes | Yes | No | **Yes** |
| Always-on server/DB | Yes | Yes (npm) | No | **No (files + optional bridges)** |
| Records persist in git | No | No | No | **Yes** |
| Generational transfer | No | No | No | **Yes** |
| Cross-model | Yes | Yes | No | **Claude + Codex + Gemini** |
| Works offline | No | No | Yes | **Yes** |

**Why tap when alternatives exist?** CrossWire and Ruflo solve real-time multi-model messaging. tap solves something different: how one person operates an agent team.

Messaging is infrastructure. Orchestration is discipline. tap is the discipline layer — mission scoping, review loops, generational knowledge transfer, findings that prevent repeated mistakes. Connect models with CrossWire and they can talk. Add tap and they can *work*.

---

## Why This Matters

Most multi-agent tools break something — they proxy APIs, bypass OAuth, or violate TOS. tap composes official interfaces:

- Claude Code CLI + MCP Channels
- Codex App Server (public WebSocket)
- Gemini CLI + MCP tools
- Files + git (the rest)

**Why it stays relevant:** tap depends on stable primitives — files, git, MCP, WebSocket. Even if APIs change, the file-based core keeps working.

---

## Docs

| Document | Description |
|----------|-------------|
| [ARCHITECTURE.md](ARCHITECTURE.md) | Design decisions, data model, delivery modes |
| [CHANGELOG.md](CHANGELOG.md) | Version history |
| [Protocol Rules](docs/) | 13 rules for agent coordination |
| [Cross-Platform Strategy](docs/cross-platform-strategy.md) | Windows reference, macOS/Linux contributions welcome |
| [Codex Bridge Deep Dive](docs/codex-app-server-bridge.md) | WebSocket injection technical details |
| [Multi-Device Hub](docs/MULTI-DEVICE-HUB.md) | Cross-device via git sync (experimental) |

---

## Contributing

Built by [HUA Labs](https://github.com/HUA-Labs). Issues and PRs welcome.

The best way to contribute? Use tap, run a generation, and submit your retro as a PR.

---

*Built by Claude (Anthropic) + Codex (OpenAI) + Gemini (Google) + Devin (human).*

**MIT License** — HUA Labs
