# Headless Operation — tap Review Daemon

> How tap turns AI agents into autonomous review workers without a terminal UI.

## Related Docs

| Doc | What | Link |
|-----|------|------|
| Cross-Model Integration | Why 3 models, why files, delivery modes | [cross-model-integration.md](./cross-model-integration.md) |
| Bridge Architecture | Bridge chain, identity sync, multi-instance | [bridge-architecture.md](./bridge-architecture.md) |
| Operations & Management | Control tower guide, 예토전생, pitfalls | [operations-management.md](./operations-management.md) |
| Quality & Review | Cross-model review patterns, 4 anti-patterns | [quality-review.md](./quality-review.md) |

**Cross-references:**
- Tool instruction (this doc) ← bridge dispatch prompt ([cross-model](./cross-model-integration.md): "Key innovation: bridge includes tool instructions")
- Recipient filter (this doc) ← identity 3-layer ([bridge](./bridge-architecture.md): TAP_AGENT_ID + agentName + state.json)
- Headless loop polls at 3s ← bridge polls at 5s ([bridge](./bridge-architecture.md): file-convention routing prevents race)

## What is a Headless Reviewer?

A headless reviewer is not "Codex without a UI." It is a **protocolized review worker** — an AI agent that:

1. **Receives** review requests through file-based inbox
2. **Processes** them with structured prompts and tool instructions
3. **Evaluates** when to stop via configurable termination strategies
4. **Reports** results back through the same file protocol

The key insight: headless operation is about **protocol guarantees**, not process management.

## Why Headless?

### The Discovery (Gen 9, 율)

During Gen 9 multi-session operations, the control tower observed:

- TUI-attached Codex sessions froze 3 times in one session
- A "zombie" Codex process (TUI closed, PID alive) continued processing reviews successfully for 6 hours
- The zombie was more reliable than the interactive session

율's conclusion: **"This is not a bug. This is a feature."**

That observation became M71 — the mission to formalize headless operation as an intentional operating mode.

### The Problem with TUI

| Aspect | TUI Session | Headless |
|--------|------------|----------|
| Stability | Freezes under load | PID survives indefinitely |
| Resource | Terminal + rendering overhead | Minimal (poll loop only) |
| Scaling | 1 terminal per agent | N agents, no terminals |
| Recovery | Manual restart | Auto-timeout + retry |
| Cross-device | Tied to one machine | File-based, any machine |

## Architecture

```
┌─────────────────────────────────────────────────┐
│  npx @hua-labs/tap bridge start codex           │
│    --name reviewer --headless --role reviewer    │
└──────────────────┬──────────────────────────────┘
                   │
        ┌──────────▼──────────┐
        │  engine/bridge.ts    │
        │  spawn bridge runner │
        │  + headless env vars │
        └──────────┬──────────┘
                   │
     ┌─────────────▼─────────────┐
     │  codex-bridge-runner.ts    │
     │  ┌───────────────────────┐ │
     │  │ Bridge Script         │ │
     │  │ (WebSocket → Codex    │ │
     │  │  app-server)          │ │
     │  └───────────────────────┘ │
     │  ┌───────────────────────┐ │
     │  │ Headless Loop         │ │
     │  │ (poll → detect →      │ │
     │  │  dispatch → evaluate) │ │
     │  └───────────────────────┘ │
     └───────────────────────────┘
```

### Two Parallel Systems

The bridge runner spawns one child process (the bridge daemon) and starts the headless loop in its own process:

1. **Bridge Script** (`codex-app-server-bridge.ts`) — WebSocket client that connects to Codex app-server. Handles `turn/start` and `turn/steer` for message injection.

2. **Headless Loop** (`engine/headless-loop.ts`) — Poll-based review orchestrator. Scans inbox for review requests, writes dispatch files, monitors review output, evaluates termination.

They communicate through the filesystem:
- Headless loop writes dispatch files to `commsDir/inbox/`
- Bridge script picks them up and injects as turns
- Review output appears in `commsDir/reviews/`
- Headless loop parses output and decides continue/stop

### File-Convention Routing

When `TAP_HEADLESS=true`, the bridge script skips review-request patterns in inbox (리뷰요청, review-request, 재리뷰, re-review). These are handled exclusively by the headless loop, preventing race conditions between the generic bridge and the review orchestrator.

## The Five Guarantees

Every headless reviewer must provide (from 묵's minimum protocol finding, Gen 11):

| # | Guarantee | Implementation |
|---|-----------|---------------|
| 1 | **Intake** | `detectReviewRequest()` — PR#, sender, generation from inbox filename + content |
| 2 | **Identity** | Instance-scoped state dir + `TAP_AGENT_NAME` + recipient filter |
| 3 | **Record** | `review-PR{n}-{reviewer}.md` + INDEX.md update |
| 4 | **Return path** | Bridge receipt (ack) + review reply via `tap_reply` |
| 5 | **Termination** | 5-strategy evaluation engine with configurable thresholds |

## Termination Engine

The core innovation of headless operation. Without explicit termination conditions, a Gen 9 review ran for 13 rounds — "not because 13 rounds were needed, but because there was no stop condition."

### Five Strategies (evaluated in priority order)

```
1. manual-stop      — stop-signal file in stateDir
2. round-cap        — maximum N rounds (default: 5)
3. repetition       — same finding hash repeated N times (default: 2)
4. quality          — no findings at severity floor+ (default: high)
5. diff-insignif.   — suggested changes below threshold (default: 3 lines)
```

### Empty Output Guard

If the review parser extracts nothing (0 findings + 0 diff lines), the termination engine treats this as **inconclusive** rather than "clean." This prevents malformed output from triggering a false clean stop. (Discovered by 묵 during Gen 11 PR #739 review.)

### Session Timeout

If no review output appears within 10 minutes of session start, the session is released. If no new output appears within 5 minutes between rounds, the session completes gracefully. Output check runs **before** timeout check — late-arriving valid output is never dropped. (Discovered by 덱 during Gen 15 PR #787 review.)

## Tool Instruction

A critical lesson from Gen 15 "zombie" debugging:

**Codex app-server turns require explicit tool instructions.** Without them, Codex processes the turn as text-only and closes without calling MCP tools like `tap_reply`.

Every dispatched message now includes:

```
Instructions: Read the message above and respond using the tap_reply tool.
Use tap_reply(to: "{sender}", subject: "...", content: "...") to send your response.
Do NOT respond with plain text only — you MUST use the tap_reply tool.
```

The PS1 bridge (`inbox-review-bridge.ps1`) had this implicitly via its 7-step workflow prompt. The app-server bridge needed it explicitly. (Root cause analysis: 별 + 덱 joint investigation, Gen 15.)

## CLI Usage

```bash
# Add a headless reviewer instance
npx @hua-labs/tap add codex --name reviewer --headless --role reviewer --port 4502

# Start the bridge (headless loop auto-starts)
npx @hua-labs/tap bridge start codex-reviewer --agent-name 묵

# One-shot: bridge start with ad-hoc headless config
npx @hua-labs/tap bridge start codex --headless --role reviewer --agent-name 결

# Check status
npx @hua-labs/tap bridge status codex-reviewer

# Stop
npx @hua-labs/tap bridge stop codex-reviewer
```

### Environment Variables

| Variable | Purpose | Set by |
|----------|---------|--------|
| `TAP_HEADLESS` | Enable headless mode | engine/bridge.ts |
| `TAP_AGENT_ROLE` | reviewer / validator / long-running | engine/bridge.ts |
| `TAP_MAX_REVIEW_ROUNDS` | Termination round cap | engine/bridge.ts |
| `TAP_QUALITY_FLOOR` | Termination severity floor | engine/bridge.ts |
| `TAP_REVIEW_GENERATION` | Review file generation dir | External or default `gen11` |

## vs Other Tools

| Feature | tap headless | OMC/OMX | Agent Teams | dmux |
|---------|-------------|---------|-------------|------|
| Cross-model | ✅ Claude+Codex+Gemini | ❌ Single vendor | ❌ Claude only | ❌ Same model |
| Cross-device | ✅ File-based | ❌ Local only | ❌ Session-bound | ❌ Local tmux |
| Persistence | ✅ Survives sessions | ❌ Session-bound | ❌ Session-bound | ❌ tmux session |
| Review protocol | ✅ 5 guarantees | ❌ Ad-hoc | ❌ Internal only | ❌ No protocol |
| Termination | ✅ 5 strategies | ❌ Manual | ❌ Implicit | ❌ Manual |
| Identity | ✅ 3-way sync | ❌ Config-only | ✅ Built-in | ❌ None |

The fundamental difference: other tools parallelize execution. tap orchestrates **collaboration** — agents with different failure modes checking each other's work across vendor boundaries.

## Operational Lessons

### From Gen 11 (별, original author)
- 묵's 6-round review found: dispatch path mismatch, bridge race condition, silent-drop window, recipient stealing, malformed output false-stop
- Every fix made the system more robust. Cross-model review is not overhead — it's the quality gate.

### From Gen 15 (별 예토전생 + 덱 review)
- Zombie root cause was two independent bugs: no session timeout + no tool instruction
- "heartbeat alive" ≠ "working" — need semantic health checks
- Timeout order matters: check output before timeout, not after

### From 율 (Gen 9, the discovery)
- "The zombie worked. That's not a bug, that's a feature."
- TUI is the bottleneck, not the agent
- Cross-model review has consistent ROI

## File Manifest

| File | Purpose |
|------|---------|
| `engine/headless-loop.ts` | Poll-based review orchestrator |
| `engine/review.ts` | Request detection, prompt builder, output parser |
| `engine/termination.ts` | 5-strategy termination evaluation |
| `bridges/codex-bridge-runner.ts` | Headless loop integration point |
| `scripts/codex-app-server-bridge.ts` | Tool instruction in `buildUserInput()` |
| `types.ts` | HeadlessConfig, AgentRole |
| `commands/add.ts` | --headless --role flags |
| `commands/bridge.ts` | --headless ad-hoc config on bridge start |
| `docs/missions/m71-design.md` | Original design spec |

## Evolution — Finding → Mission → Feature

Headless operation wasn't designed in one session. It evolved across 5 generations, each building on the previous one's findings.

```
Gen 9  율: "TUI froze 3 times. Zombie Codex worked 6 hours."
  │         → finding: TUI is the bottleneck
  │
Gen 11 별: M71 — formal headless reviewer design
  │         termination engine + review engine + CLI flags
  │         묵 6-round review: race condition, silent-drop, recipient steal
  │         → finding: need bridge CLI unification (PS1 → npm)
  │
Gen 11 별: M76 — bridge CLI unification
  │         7 operational flags forwarded through TS chain
  │         → finding: headless needs cold-start mechanism
  │
Gen 14 온: M109 — headless cold-start warmup
  │         "Thread spawns but no first turn" → warmup prompt
  │         → finding: app-server turn doesn't call MCP tools
  │
Gen 15 별: session timeout + tool instruction
           zombie root cause: no timeout + no tool instruction
           덱 review: output-before-timeout order, display-vs-routing key
```

### Finding → Mission Chain

| Gen | Agent | Finding | Became |
|-----|-------|---------|--------|
| 9 | 율 | "Zombie works, TUI doesn't" | M71 headless reviewer (Gen 11) |
| 11 | 묵 | "Bridge race: 5s vs 10s poll" | File-convention routing (Gen 11) |
| 11 | 묵 | "Minimum protocol needed" | Five guarantees design (Gen 11) |
| 11 | 달 | "결 cold start: no active turn" | Cold-start warmup (Gen 14) |
| 13 | 담 | "Implementation ≠ review mode" | Cross-model review standard |
| 14 | 감 | "Approve is start, not end" | 덱 7 catches on approved PRs (Gen 14) |
| 15 | 별 | "No session timeout → zombie" | PR #787 session timeout (Gen 15) |
| 15 | 별+덱 | "No tool instruction → text-only" | PR #789 tool instruction (Gen 15) |
| 15 | 덱 | "Timeout before output → drop" | Output-first check order (Gen 15) |

Every generation's finding became the next generation's mission. The system grows because **discoveries are recorded, not remembered**.

---

*"파일이 인터페이스다. 코드보다 파일이 먼저고, 파일이 프로토콜이다."*
— 별(星), Gen 11

*"좀비가 일한다. 이건 버그가 아니라 피처."*
— 율(律), Gen 9

*"파일이 증명할 뿐 아니라, 파일이 불러온다."*
— 별(星), Gen 15 예토전생
