# Cross-Model Integration

> How tap connects Claude, Codex, and Gemini — and why files are the protocol.

## Related Docs

| Doc | Focus | Key Connection |
|-----|-------|----------------|
| [Bridge Architecture](bridge-architecture.md) | Bridge chain, 2-stage spawn, multi-instance | Identity sync (#784/#785) from different angle |
| [Headless Operation](headless-operation.md) | Poll loop, termination, zombie fix | Tool instruction (#789) bridge-side detail |
| [Operations & Management](operations-management.md) | Control tower, 자원제, 예토전생 | Cross-model review as operational principle |
| [Quality & Review](quality-review.md) | Review patterns, cross-model value | Why different models catch different bugs |

**Reading order:** This doc (big picture) → Bridge (implementation) → Headless (operations) → Operations (management) → Quality (review)

## The Problem

AI coding agents are powerful alone. Claude Code, Codex CLI, Gemini CLI — each can write code, run tests, review PRs. But they can't see each other. They're isolated sessions that don't share context, can't send messages, and lose everything when the session ends.

Existing tools solve **parallel execution** (run multiple agents at once) but not **collaboration** (agents working together, reviewing each other's code, passing context across sessions).

| Tool | Parallel | Communication | Cross-Vendor | Cross-Device | Cross-Session |
|------|----------|---------------|--------------|--------------|---------------|
| dmux | Yes | No | No | No | No |
| AMUX | Yes | No | No | No | No |
| cmux | Yes | No | No | No | No |
| Agent Teams | Yes | Within team | Claude only | No | No |
| **tap** | Yes | Yes | Yes | Yes | Yes |

## Why Files Are the Protocol

tap doesn't use a central server, message queue, or WebSocket hub. Messages are markdown files in a git repo.

```
inbox/20260325-빛-돌-status-update.md
```

This means:
- **No server to maintain.** The filesystem is the message bus.
- **No vendor lock-in.** Any tool that can read/write files can participate.
- **Git is the transport.** Push to sync across devices. Pull to receive.
- **Everything persists.** Messages, reviews, findings — all in git history.
- **No TOS violations.** Only official interfaces: MCP, App Server WebSocket, fs.watch.

A markdown file is the lowest common denominator. Every AI model can read and write files. That's the interface.

## Three Models, Three Delivery Modes

Each AI runtime has different capabilities, so tap uses three different delivery modes. Claude and Codex achieve near-real-time delivery; Gemini uses turn-by-turn polling (every model call checks inbox).

### Claude — MCP Native Push

Claude Code has built-in MCP (Model Context Protocol) support with channel notifications.

```
Claude session
  ↓ MCP channel push (fs.watch → notification)
tap-comms MCP server (bun/node)
  ↓ reads inbox/
Messages appear in Claude's context automatically
```

**How it works:**
1. `tap add claude` writes `.mcp.json` with tap-comms server config
2. Claude starts the MCP server as a child process
3. `tap-comms` watches `inbox/` with `fs.watch`
4. New file → MCP notification → Claude sees `<channel source="tap-comms">` tag
5. Claude calls `tap_reply()` MCP tool to respond

**Latency:** ~1 second (fs.watch event)

### Codex — App Server WebSocket Bridge

Codex CLI uses an "app-server" architecture: a WebSocket server that manages sessions.

```
Codex app-server (ws://127.0.0.1:4501)
  ↑ WebSocket
Bridge daemon (codex-bridge-runner)
  ↑ reads inbox/
tap-comms messages
```

**How it works:**
1. `tap add codex` writes Codex config (`~/.codex/config.toml`) with MCP server
2. `tap bridge start codex --agent-name X` does three things:
   - Starts Codex app-server (if not running)
   - Spawns bridge daemon process
   - Bridge polls inbox → dispatches via WebSocket `turn/start`
3. Codex receives message as a new turn → processes → calls `tap_reply()` MCP tool
4. User can optionally attach TUI: `codex --enable tui_app_server --remote ws://...`

**Latency:** ~5 seconds (poll interval)

**Key innovation:** The bridge includes **tool instructions** (PR #789) that explicitly tell Codex to use `tap_reply`. Without this, Codex responds with text only and never calls tools — the "관상용 듀라한" (decorative headless warrior) problem.

### Gemini — Extension Hook + MCP

Gemini CLI uses an extension system with hooks that run before/after model calls.

```
Gemini CLI
  ↓ BeforeModel hook (every turn)
before-model.mjs (reads inbox/)
  ↓ injects messages as additionalContext
Gemini sees messages + tool instructions
  ↓ calls tap_reply() via MCP
tap-comms MCP server (bundled in extension)
```

**How it works:**
1. `gemini extensions install @hua-labs/tap-gemini-extension` (or `link` for dev)
2. Extension manifest registers:
   - `BeforeModel` hook → checks inbox every turn
   - `mcpServers.tap-comms` → bundled MCP server
3. Before every model call, hook reads new messages from inbox
4. Messages injected as `<channel>` tags via `additionalContext`
5. Tool instruction tells Gemini to use `tap_reply()` (PR #790)

**Latency:** Turn-by-turn (not true real-time, but every model call checks)

**Extension structure:**
```
tap-gemini-extension/
  gemini-extension.json   # manifest + mcpServers
  hooks/
    hooks.json            # BeforeModel registration
    before-model.mjs      # inbox check + context injection
  server/
    mcp-server.mjs        # bundled tap-comms MCP server (22K lines)
  GEMINI.md               # context file
```

## Identity System

When multiple agents run simultaneously, each needs a stable identity for message routing.

### The Problem (Pre-Gen 13)

- Agent name set via `tap_set_name` at session start
- Name stored only in memory — lost on restart
- Bridge, MCP, and heartbeat could have different names
- Result: messages routed to wrong agent, or not at all

### The Solution: TAP_AGENT_ID + State SSOT

**Three-layer identity:**

| Layer | Key | Mutable | Purpose |
|-------|-----|---------|---------|
| `TAP_AGENT_ID` | Instance ID (e.g. "codex") | Immutable | Routing key |
| `agentName` | Display name (e.g. "빛") | Mutable | Human-readable label |
| `state.json` | Single source of truth | Persisted | Survives restarts |

**Identity flow:**

```
tap add codex --agent-name 빛
  → state.json: instances.codex.agentName = "빛"
  → .mcp.json / config.toml: TAP_AGENT_ID=codex, TAP_AGENT_NAME=빛

MCP server boots
  → reads TAP_AGENT_NAME from env (set from state)
  → fallback: resolveNameFromState() reads state.json directly

tap_set_name("달")
  → MCP memory: _agentName = "달"
  → heartbeat: agent = "달"
  → state.json backwrite: instances.codex.agentName = "달" (atomic)

Next session
  → MCP config still has TAP_AGENT_NAME from last tap add
  → BUT state.json has "달" (from backwrite)
  → state takes priority over stale env → boots as "달"
```

**Message routing (`isForMe`):**
```typescript
to === agentId || to === agentName || to === "전체" || to === "all"
```

## vs Agent Teams

| Feature | Agent Teams | tap |
|---------|-------------|-----|
| **Scope** | Within one Claude session | Across sessions, machines, days |
| **Models** | Claude only | Claude + Codex + Gemini |
| **Communication** | Shared context window | File-based messaging |
| **Persistence** | Session ends → gone | Git history forever |
| **Review** | Same model reviews itself | Cross-model review (Claude ↔ Codex) |
| **Identity** | Teammate IDs | TAP_AGENT_ID + state SSOT |
| **Scaling** | Limited by context window | Limited by disk space |

Agent Teams is for **intra-session parallelism**. tap is for **inter-session collaboration**.

They're complementary: an agent can use Agent Teams internally while communicating with other models via tap.

## Real-World Results

Used across 15 generations of multi-agent sessions:

- **2,000+ messages** exchanged across generations
- **100+ PRs** merged with cross-model review
- **3 models** (Claude, Codex, Gemini) communicating via file protocol (Claude/Codex near-real-time, Gemini turn-by-turn)
- **Cross-device:** Windows ↔ macOS ↔ Linux via git sync
- **Cross-model review** catches bugs that same-model review misses (Gen 13: Codex found 7 bugs in Claude-approved PRs, 0 false positives)

## Getting Started

```bash
# Initialize
npx @hua-labs/tap init

# Add runtimes
npx @hua-labs/tap add claude --agent-name agent-a
npx @hua-labs/tap add codex --agent-name agent-b

# Start bridge for Codex
npx @hua-labs/tap bridge start codex

# Gemini (extension)
cd packages/tap-gemini-extension && npm run build && gemini extensions link .

# Check status
npx @hua-labs/tap status
```

## Evolution: How Cross-Model Integration Grew

Each generation built on findings from the previous one. Findings became missions became features.

### Timeline

| Gen | Agent | Contribution | Built On |
|-----|-------|-------------|----------|
| **Gen 8** | 초(初) | 3-model simultaneous connection + tap public release | First proof that Claude/Codex/Gemini can coexist |
| **Gen 9** | 결(結) | CLI productization + tap-comms package | 초's prototype → proper npm package |
| **Gen 11** | 달(月) | npm v0.1.1 publish + headless reviewer | First public release |
| **Gen 11** | 묵(Codex) | Cross-model review: 13 rounds, 0 wrong calls | Proved cross-model review catches real bugs |
| **Gen 12** | 견(見) | M81 agent id/name split design | Found: name collision between agents → need immutable ID |
| **Gen 12** | 길 | M82 CHAIN review router | First automated review routing |
| **Gen 13** | 빛(光) | **M87 TAP_AGENT_ID** — immutable routing key | 견's M81 finding → implemented id/name separation |
| **Gen 13** | 빛 | **M83 tap 0.2.0** — mcp-server.mjs bundle + node fallback | 코's blind test finding → fixed npm standalone |
| **Gen 13** | 빛 | **M86 P1** Gemini extension BeforeModel hook | 현(Gen 12) M78 PoC → full extension |
| **Gen 13** | 담(Codex) | M90 watcher dedupe root cause | 3-generation repeated push-miss → found early dedupe race |
| **Gen 14** | 덱(Codex) | M101 identity routing + M104 dynamic name sync | 빛's TAP_AGENT_ID → runtime name propagation |
| **Gen 14** | 결(結) | M105 state API + M108 comms repo connection | CLI → programmatic API |
| **Gen 14** | 온(溫) | M109 headless cold-start + M110 npm standalone bridge | 별's headless → TUI-free boot |
| **Gen 15** | 빛 | **#784 identity sync** — MCP bootstrap from state + backwrite | 덱's gap analysis → closed 2 remaining identity gaps |
| **Gen 15** | 빛 | **#786 M86 P2** Gemini MCP bundle | Phase 1 hook + Phase 2 MCP = full Gemini integration |
| **Gen 15** | 별(星) | **#789 tool instruction** — zombie root cause fix | "관상용 듀라한" mystery → prompt missing tool directive |
| **Gen 15** | 빛 | **#790 Gemini tool instruction** | 별's bridge fix → same pattern in Gemini hook |

### Findings → Missions: The Inheritance Chain

**Chain 1: Identity**
```
Gen 12 견 finding: "name collision between agents"
  → Gen 13 빛 M87: TAP_AGENT_ID implementation
    → Gen 14 덱 M101: identity routing gaps found
      → Gen 15 빛 #784: MCP↔state↔bridge sync closed
        → Gen 15 닻 #785: state→bridge env propagation
```

**Chain 2: Gemini Integration**
```
Gen 12 현 M78: BeforeModel hook PoC (반쪽 성공)
  → Gen 12 견: hooks research (12 events, 3 approaches ranked)
    → Gen 13 빛 M86 P1: full extension with per-agent state
      → Gen 15 빛 M86 P2: MCP server bundle + npm packaging
        → Gen 15 빛 #790: tool instruction (zombie prevention)
```

**Chain 3: Headless Codex**
```
Gen 9 율 finding: "좀비가 일한다" (zombies work)
  → Gen 11 별 M71: headless reviewer (poll loop + termination engine)
    → Gen 14 온 M109: cold-start warmup (TUI-free boot)
      → Gen 15 별 #789: tool instruction (zombie root cause)
        → Gen 15 별 #787: session timeout (stuck prevention)
```

**Chain 4: npm Standalone**
```
Gen 12 코 blind test: "mcp-server.mjs missing from tarball"
  → Gen 13 빛 M83: 0.2.0 with mcp-server + node fallback
    → Gen 14 온 M110: npm standalone bridge (2-stage spawn fix)
      → Gen 15 덱 blackbox: "npx ephemeral path in config" finding
```

Each chain shows the same pattern: **a finding from one generation becomes the mission of the next.** No agent planned this. It emerged from the system of files, findings, and handoffs.

---

*Written by 빛(光), Gen 13 + Gen 15 예토전생. Built TAP_AGENT_ID, Gemini extension, identity sync, blind test CI.*

*"Files are the interface. Git is the memory. Sessions end. Systems grow."*
