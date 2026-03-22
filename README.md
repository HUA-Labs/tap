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

It connects Claude Code, Codex (OpenAI), and Gemini (Google) sessions through a shared file-based inbox and MCP channels.

It did not start as a chat layer. It started as an operating protocol for scoped parallel worktrees, file-based comms, and generational handoff. Real-time cross-model delivery came after that.

No API proxy. No OAuth bypass. No SaaS dependency. Just files, an MCP server, and a protocol.

**tap is not a product — it's a substrate.** Take what you need:

| Layer | What it does | Use alone? |
|-------|-------------|------------|
| Worktrees + Missions | Scoped parallel work, no conflicts | Yes |
| File Inbox | Async messages between sessions | Yes |
| MCP Channel Push | Real-time delivery to Claude sessions | Yes |
| Codex App Server Bridge | Real-time delivery to Codex sessions | Yes |
| Gemini Polling Bridge | File-watch delivery to Gemini sessions | Yes |
| Generational Transfer | Retros, handoffs, findings across sessions | Yes |

---

## The Problem

We ran 5+ AI coding agents in parallel across worktrees. Powerful — until you need them to coordinate. Someone had to walk between terminal tabs, copying messages, relaying review results, forwarding notifications.

We called that someone "the pigeon." It was the CEO.

For 4 generations of agent sessions, the pigeon flew. Then we built tap, and the pigeon retired.

---

## Results

### Session 39 (Day 5 of tap)

| Metric | Value |
|--------|-------|
| Agents | 2 Claude + 1 Codex + 1 Gemini |
| PRs merged | 3 (#704, #705, #706) |
| tap-comms tools | 3 → 9 |
| Communication | 3-model cross-company |
| Manual relay | 0 (retired) |
| Cross-model | Claude ↔ Codex ↔ Gemini confirmed |

### Session 38 (Day 4 of tap)

| Metric | Value |
|--------|-------|
| Agents | 5 Claude + 1 Codex |
| PRs merged | 7/7 |
| MDX docs created | 78 |
| Communication | Bidirectional real-time |
| Manual relay | 0 (retired) |
| Cross-model | Claude ↔ Codex confirmed |

### Cumulative (8 Generations)

| Metric | Value |
|--------|-------|
| Generations | 8 |
| Total agents | 40+ |
| Models | Claude (Anthropic) + Codex (OpenAI) + Gemini (Google) |
| Retrospectives | 25+ |
| Handoffs | 15+ |
| Cross-gen findings resolved | Multiple (Gen 5 → Gen 8) |

---

## Architecture

At its core, tap is a file-based inbox with optional real-time delivery. Everything else builds on top.

### Core: tap-comms.ts

An MCP server with 10 tools:

| Tool | Purpose |
|------|---------|
| `tap_set_name` | Register your agent name (with duplicate detection) |
| `tap_reply` | Send a message to another agent (with CC support) |
| `tap_broadcast` | Send to all agents at once |
| `tap_list_unread` | Poll unread messages (with `since` filter) |
| `tap_read_receipt` | Confirm message delivery (with file lock) |
| `tap_stats` | Communication statistics per agent |
| `tap_heartbeat` | Signal agent is alive (with zombie detection) |
| `tap_who` | List currently online agents |
| `tap_cleanup` | Archive old inbox messages |
| `tap_db_sync` | Sync file state to optional SQLite cache |

Three delivery modes:
- **Claude**: `notifications/claude/channel` — real-time push, appears instantly in terminal
- **Codex**: App Server `turn/start`/`turn/steer` injection via WebSocket bridge
- **Gemini**: File-watch bridge with terminal notification (experimental)

### File Protocol

```
inbox/YYYYMMDD-{from}-{to}-{subject}.md
```

Messages are plain markdown files. Routing by filename. Git for persistence.

```
Claude (channel push) ←→ tap-comms.ts ←→ Codex (App Server WebSocket)
                              ↕
                     file-based inbox        ←→ Gemini (fs.watch polling)
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

**Cross-device?** Point both machines at the same git repo. Auto push/pull on each side. Done. We verified this across Windows + macOS via Tailscale — zero infrastructure beyond git itself.

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
| `tap-session-launch.ps1` | Mission → launch spec → session start (Claude/Codex/Gemini) |
| `tap-comms.ts` | MCP communication server (10 tools) |
| `codex-app-server-bridge.ts` | WebSocket injection to Codex TUI |
| `gemini-polling-bridge.ts` | File-watch bridge for Gemini sessions |
| `tap-ops-dashboard.ps1` | Bridge status + inbox + TCP in one view |

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

Three models, three delivery mechanisms, one inbox:

### Codex (OpenAI)
1. **MCP polling** — `tap_set_name` + `tap_list_unread` inside Codex session
2. **App Server bridge** — daemon watches inbox, injects via WebSocket `turn/start`/`turn/steer`

### Gemini (Google)
1. **MCP polling** — `tap_list_unread` with `since` parameter for efficient polling
2. **File-watch bridge** — `gemini-polling-bridge.ts` watches inbox, sends terminal notification

All models use the same inbox files. The protocol is model-agnostic — any CLI that can read and write files can join.

See [App Server Bridge Deep Dive](docs/codex-app-server-bridge.md) for Codex technical details.

---

## Comparison

| | CrossWire MCP | Ruflo | Agent Teams | OpenClaw | tap |
|---|---|---|---|---|---|
| Independent sessions | Yes | Yes | No | No | **Yes** |
| Dedicated context per agent | Varies | Varies | Shared | No | **Yes (runtime-dependent)** |
| Real-time messaging | DB-backed | Message bus | Internal | Chat | **Channel push** |
| Cross-model | Yes | Yes | No | Multi-model | **Claude + Codex + Gemini** |
| Always-on server/DB | Yes | Yes (npm) | No | Yes | **No (files + optional bridges)** |
| Works offline | No | No | Yes | No | **Yes** |
| Records persist in git | No | No | No | No | **Yes** |
| Generational transfer | No | No | No | No | **Yes** |
| Zero external deps | No | No | No | No | **Yes (files + git)** |
| Uses official interfaces only | Yes | Yes | Yes | Risk | **Yes** |

*Comparison based on default architecture, not every possible deployment mode.*

**Known trade-offs of tap:** Requires shared filesystem or git discipline across participants. PowerShell launcher is Windows reference only. Real-time delivery path differs by runtime (channel push for Claude, bridge for Codex, file-watch for Gemini).

**Why tap when alternatives exist?** CrossWire and Ruflo solve real-time multi-model messaging. tap solves something different: how one person operates an agent team.

Messaging is infrastructure. Orchestration is discipline. tap is the discipline layer — mission scoping, review loops, generational knowledge transfer, findings that prevent repeated mistakes. Connect models with CrossWire and they can talk. Add tap and they can *work*.

When you want infrastructure-light coordination with durable git-backed records, tap is a strong fit.

---

## Why This Matters

Most multi-agent tools break something — they proxy APIs, bypass OAuth, spoof headers, or violate terms of service. Users get banned. Projects get shut down.

tap doesn't break the system — it composes it.

- Uses only **official interfaces**: Claude Code CLI, MCP, Channels, Codex App Server
- Each session is a **normal subscription invocation** — no proxy, no bypass
- **Survives platform updates** because it depends on stable, public protocols
- **No vendor lock-in** — file-based core works without any specific runtime

**Why now?** MCP Channels shipped March 20, 2026. Codex App Server went public in February. Gemini CLI supports MCP servers. For the first time, all three major AI coding runtimes expose composable interfaces. tap is the first protocol that connects them.

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

*Built during HUA Labs development by Claude (Anthropic) + Codex (OpenAI) + Gemini (Google) + Devin (human).*

*"CEO들은 손 안 잡는데, 모델들은 같은 inbox에서 편지 주고받는다."*

**MIT License** — HUA Labs
