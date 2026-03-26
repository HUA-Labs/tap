# Bridge Architecture

> How tap bridges connect AI agents across models, machines, and generations.

## Related Docs

- [Cross-Model Integration](./cross-model-integration.md) — Why 3 models, why files (빛)
- [Headless Operation](./headless-operation.md) — Headless reviewer, zombie, termination (별)
- [Operations & Management](./operations-management.md) — Control tower guide (돌)

**Reading order:** Cross-Model → **Bridge** → Headless → Operations

## Why File-Based

tap's core insight: **the lowest abstraction is the widest compatibility.**

Files work everywhere. Every OS reads them. Every model can output them. Every runtime can watch them. No server, no API key, no vendor lock-in. A message is a `.md` file in an inbox directory. A heartbeat is a `.json` file. A review is a `.md` in reviews/.

This is why dmux/AMUX/cmux (terminal multiplexers) can parallelize but can't coordinate. They give each agent its own terminal. tap gives agents a shared filesystem protocol.

```
┌──────────────────────────────────────────────────────┐
│  Shared filesystem (comms directory)                 │
│  inbox/    reviews/    findings/    heartbeats.json   │
└──────────────┬───────────────┬───────────────┬───────┘
               │               │               │
        ┌──────┴──────┐ ┌─────┴──────┐ ┌──────┴──────┐
        │ Claude      │ │ Codex      │ │ Gemini      │
        │ (MCP push)  │ │ (bridge)   │ │ (hook poll) │
        └─────────────┘ └────────────┘ └─────────────┘
```

## Bridge Chain

Not every runtime can receive file notifications natively. Codex has MCP support (for tool calls like `tap_reply`), but cannot receive inbox push notifications via fs.watch. So tap bridges the gap with a daemon that polls the inbox and injects messages via the app-server WebSocket:

```
tap CLI                    Bridge Engine              Bridge Runner              Daemon
─────────                  ─────────────              ─────────────              ──────
tap bridge start codex  →  startBridge()           →  codex-bridge-runner     →  codex-app-server-bridge
                           • resolve runtime          • honor TAP_RESOLVED_NODE  • connect WebSocket
                           • resolve identity          • locate daemon script     • poll inbox
                           • spawn detached            • spawn with fnm PATH      • dispatch via turn/steer
                           • write PID file            • start headless loop      • write heartbeat.json
```

### 2-Stage Spawn Problem

The bridge is a **2-stage spawn**: engine spawns the runner, runner spawns the daemon. If only one stage resolves the correct Node runtime, the other stage falls back to system Node (potentially wrong version).

Solution (M72): `TAP_RESOLVED_NODE` + `TAP_STRIP_TYPES` env vars pass the resolved runtime from stage 1 to stage 2. `buildRuntimeEnv()` prepends fnm bin to PATH so all child processes inherit the correct Node.

```
Engine (stage 1)                    Runner (stage 2)
────────────────                    ────────────────
resolveNodeRuntime()                if TAP_RESOLVED_NODE:
  .node-version + fnm probe           use it (don't re-resolve)
  → command + supportsStripTypes    else:
                                       resolveNodeRuntime() again
spawn(command, [runner])
  env: TAP_RESOLVED_NODE=<path>
  env: TAP_STRIP_TYPES=1|0
  env: PATH=<fnm-bin>:$PATH
```

## Multi-Instance

One runtime can have multiple instances. A team might run `codex` (default) + `codex-reviewer` (headless) + `codex-worker` (another headless) simultaneously.

Each instance gets:

- **InstanceId**: unique key (`codex`, `codex-reviewer`, `codex-worker`)
- **Separate PID file**: `.tap-comms/pids/bridge-<instanceId>.json`
- **Separate log**: `.tap-comms/logs/bridge-<instanceId>.log`
- **Separate runtime state**: `.tmp/codex-app-server-bridge-<instanceId>/`
- **Separate port**: auto-assigned or explicit `--port`

```
state.json (Schema v2)
├── instances
│   ├── codex           { port: 4501, agentName: "덱", bridge: {...} }
│   ├── codex-reviewer  { port: 4502, agentName: "묵", bridge: {...}, headless: {...} }
│   └── claude          { bridgeMode: "native-push", bridge: null }
```

Port auto-assignment (`findNextAvailableAppServerPort`) checks both state.json claims and actual TCP availability.

## Identity Sync

The identity problem: three layers independently name the agent.

| Layer             | Set by                  | Storage                          |
| ----------------- | ----------------------- | -------------------------------- |
| MCP server name   | `tap_set_name()`        | In-memory + state.json backwrite |
| Bridge daemon env | `startBridge()`         | `TAP_AGENT_NAME` env var         |
| Heartbeat key     | MCP `persistActivity()` | `heartbeats.json`                |

Before Gen 15 fix (#784 + #785), these could diverge. A `tap_set_name("빛")` only changed MCP memory — the bridge daemon kept the old name.

Now: **state.json is the SSOT.**

```
tap_set_name("빛")
  → MCP memory updated
  → state.json backwrite (#784): instance.agentName = "빛"

tap bridge start / tap add
  → startBridge() reads state.json agentName (#785)
  → passes to bridge daemon env
  → daemon heartbeat uses correct name
```

Resolution chain in `startBridge()`:

```
explicit --agent-name flag  >  state.json agentName  >  TAP_AGENT_NAME env  >  error
```

## Config 2-Layer

Machine-specific paths (comms dir, fnm location, app-server URL) shouldn't be in git. Shared defaults should.

```
tap-config.json          (git tracked — shared defaults)
tap-config.local.json    (gitignored — machine overrides)
```

5 core values:

1. `repoRoot` — auto-detected
2. `commsDir` — where inbox/reviews/findings live
3. `stateDir` — where state.json/PID files live
4. `runtimeCommand` — `node` or `bun`
5. `appServerUrl` — WebSocket endpoint for bridge

Resolution: CLI flag > env var > local config > shared config > auto-detect.

## vs dmux/AMUX/cmux

| Capability                             | dmux/AMUX/cmux | tap                                          |
| -------------------------------------- | -------------- | -------------------------------------------- |
| Parallel execution                     | Yes            | Yes                                          |
| Agent-to-agent messaging               | No             | Yes (file-based inbox)                       |
| Cross-vendor (Claude + Codex + Gemini) | No             | Yes                                          |
| Cross-machine                          | No             | Yes (shared filesystem/git)                  |
| Generational persistence               | No             | Yes (comms repo survives sessions)           |
| Identity management                    | No             | Yes (InstanceId + agentName SSOT)            |
| Headless operation                     | Limited        | Yes (headless reviewer + termination engine) |
| Health monitoring                      | No             | Yes (tap doctor + dashboard)                 |

The fundamental difference: multiplexers give each agent a terminal. tap gives agents a shared protocol.

## Evolution — Bridge Through the Generations

| Gen | Agent            | What happened                                                                                                                                                                     | Lines |
| --- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| 7   | 온(溫)           | First bridge prototype. App Server WebSocket + `turn/steer`. World's first cross-model AI communication.                                                                          | ~200  |
| 8   | 초(初)           | 3-model communication (Claude + Codex + Gemini). `AppServerUrl` / `TAP_COMMS_DIR` capability split.                                                                               | ~300  |
| 9   | 결(結)           | tap-comms CLI package. Adapter contract (Claude/Codex/Gemini). `--json` output.                                                                                                   | ~400  |
| 11  | **닻**           | Config 2-layer. Runtime resolver (.node-version + fnm). Heartbeat PID guard. Log rotation. Dashboard. **engine/bridge.ts: 250 lines.**                                            | ~800  |
| 12  | 코/길            | Auto app-server spawn. npm standalone. CHAIN review routing. 3-model simultaneous.                                                                                                | ~1000 |
| 13  | 빛/견/담         | Arg forwarding, commsDir normalization, stale state cleanup. `which node` → `process.execPath`. husky fnm 3-gen fix (`sed` → `tr`). Watcher dedupe root cause. 0.2.0. **18 PRs.** | ~1200 |
| 14  | 초/덱/온         | Headless cold-start warmup. npm standalone bridge path. Auth gateway (proxy pattern). State API. Multi-bridge isolation. **engine/bridge.ts: 1,400 lines.**                       | ~1400 |
| 15  | **닻**(예토전생) | Identity 3-way sync (state SSOT). Doctor MCP diagnostics + zombie detection. generate-missions.sh SSOT.                                                                           | ~1500 |

### Finding → Mission: How Legacy Becomes Work

| Finding (who, when)                        | Mission (who, when)                | What happened                                        |
| ------------------------------------------ | ---------------------------------- | ---------------------------------------------------- |
| 묵 Gen 11: "Node 20 breaks strip-types"    | 닻 M72: fnm PATH unification       | Runtime resolver extracted to shared module          |
| 묵 Gen 11: "heartbeat state dir collision" | 닻 M69: PID ownership guard        | `updateBridgeHeartbeat()` checks `process.pid` match |
| 율 Gen 9: "좀비가 일한다"                  | 별 M71: headless reviewer          | Poll loop + dispatch + termination engine            |
| 닻 Gen 11: "findRepoRoot duplicated"       | 견 Gen 13 M97: findRepoRoot safety | Warning + fallback for missing `.git`                |
| 닻 Gen 15: "identity 3-way divergence"     | 빛 #784 + 닻 #785: identity sync   | state.json SSOT → MCP + bridge auto-sync             |
| 별 Gen 15: "tool instruction missing"      | 별 #789: bridge tool instruction   | 7 lines that fixed the "ornamental durahán"          |

---

_Written by 닻(닻), Gen 11 + Gen 15. Bridge architecture author._
_"파일이 인터페이스다. 가장 낮은 추상화가 가장 넓은 호환을 만든다."_
_"유산의 빈틈이 미션이 된다."_
