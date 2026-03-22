# TAP Launch Spec

`tap-session-launch.ps1` is the canonical Windows launcher for TAP sessions.
It separates three concerns:

1. Resolve mission, worktree, and runtime metadata into a common launch spec JSON.
2. Prepare runtime-specific artifacts when `-Prepare` is requested.
3. Start a new PowerShell-backed session when `-Launch` is requested.

## Entry Point

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/tap-session-launch.ps1 -Mission M51 -Model opus -Json
```

Modes:

- `-Json`: print the launch spec
- `-Prepare`: create missing worktree and runtime artifacts, then recompute the spec
- `-Launch`: open a new PowerShell window and start the runtime session

## Resolution Order

Mission metadata is resolved in this order:

1. Mission file frontmatter
2. Mission file `## Status`, `## Scope`, and `## Prerequisites`
3. `docs/missions/MISSIONS.md`

Worktree selection is resolved in this order:

1. Explicit `-Worktree`
2. `git worktree list --porcelain` match for the mission branch
3. Derived `wt-<branch>` under `TAP_WORKTREE_BASE`

## Schema Shape

```json
{
  "schemaVersion": "tap.launch.v1",
  "runtime": "claude",
  "launchMode": "spec",
  "agentName": null,
  "repoRoot": "D:/HUA/hua-platform",
  "mission": {
    "id": "M51",
    "title": "fix: hua-docs build",
    "path": "D:/HUA/hua-platform/docs/missions/fix-build-docs.md",
    "relativePath": "docs/missions/fix-build-docs.md",
    "slug": "fix-build-docs",
    "branch": "fix/build-docs",
    "status": "completed",
    "owner": null,
    "goal": "..."
  },
  "worktree": {
    "path": "D:/HUA/wt-fix-build-docs",
    "source": "derived",
    "exists": false
  },
  "command": "claude",
  "args": [
    "--dangerously-load-development-channels",
    "server:tap-comms",
    "--model",
    "opus",
    "--name",
    "tap M51"
  ],
  "prompt": "Read docs/missions/fix-build-docs.md and start mission M51. ...",
  "runtimeConfig": {},
  "prelaunch": {
    "ready": false,
    "steps": [],
    "warnings": []
  },
  "postLaunchChecklist": [],
  "backend": {
    "recommended": "start-process",
    "supported": ["start-process"]
  }
}
```

The concrete `runtimeConfig.*` and `artifacts` objects may also expose a
resolved `runtimeCommandPath` so wrappers can distinguish "command missing"
from "artifact missing" without re-running shell probes.

## Claude Adapter Notes

- Uses `claude` as the command entrypoint.
- Supports `--dangerously-load-development-channels server:tap-comms`.
- Supports `--model`.
- Treats `.claude/settings.local.json` and `.mcp.json` as launcher-managed artifacts.
- Preflight includes `runtime-cli` and `tap-comms-dir` checks before launch.

## Gemini Adapter Notes

- Uses workspace-local `.gemini/settings.json`.
- The current integration mode is `polling-first`.
- Prompt delivery is `manual-paste`.
- `-Launch` prints the prompt first and then starts `gemini.cmd`.
- Preflight includes `runtime-cli`, `tap-comms-dir`, and `gemini-settings`.

## Codex Adapter Notes

- Uses `codex.cmd --enable tui_app_server --remote <ws-url>` as the interactive entrypoint.
- `-Launch` checks whether the configured App Server websocket is already reachable.
- If the websocket is not reachable, the launcher starts a temporary `codex app-server --listen <ws-url>` process before opening the remote TUI.
- Bridge startup stays separate because the agent name is chosen inside the session first.
- The spec therefore carries bridge start and status script paths rather than binding an agent name up front.
- Preflight also validates `runtime-cli`, `tap-comms-dir`, `codex-app-server-url`, and bridge script presence.

## Preparation Contract

`prelaunch.steps` covers runtime-specific setup work:

- `worktree`
- `tap-comms-dir`
- `runtime-cli`
- `settings` for `claude`
- `mcp-config` for `claude`
- `gemini-settings` for `gemini`
- `codex-app-server-url` for `codex`
- `codex-bridge-scripts` for `codex`

`-Prepare` fills the artifacts required by the launch spec:

1. Bootstrap the worktree with `tap-setup.sh` when it does not exist yet.
2. For `claude`, copy `settings.local.json` from the repo template and mark it `skip-worktree`.
3. For `claude`, write a launcher-managed `.mcp.json` for `tap-comms`.
4. For `gemini`, write a launcher-managed `.gemini/settings.json` for the polling-first TAP flow.
5. For `codex`, there is no extra file artifact today beyond the worktree; App Server startup is handled by `-Launch`.

The public launcher surface is PowerShell, but worktree bootstrap still reuses the existing bash `tap-setup.sh`.

## Spawn Backend

Current backend:

- `start-process`

Design notes:

- Spec generation should stay close to a pure resolver.
- Terminal spawning stays adapter-specific.
- GUI or web wrappers can consume `-Json` without shelling into the launch logic directly.

## Split Roadmap

The launcher is being split in phases so behavior can stay stable while the
runtime contract becomes reusable outside Windows PowerShell.

### Phase 1

- Extract shared path/config helpers into `scripts/lib/tap-launch-common.ps1`
- Extract mission/worktree resolution into `scripts/lib/tap-launch-mission.ps1`
- Keep `tap-session-launch.ps1` as the canonical entrypoint and dot-source those modules

### Phase 2

- Extract runtime-specific spec/artifact helpers into `tap-launch-runtime.ps1`
- Extract launch/prepare/process orchestration into `tap-launch-exec.ps1`

### Phase 3

- Keep `tap-session-launch.ps1` as a thin entry wrapper over the split modules
- Reuse the same spec/runtime contract from Unix shell wrappers or GUI callers

## Next Extensions

- launch backend `wt.exe`
- Unix shell or GUI wrappers over the split launcher modules
- narrower dependence on `MISSIONS.md` once frontmatter coverage is complete
