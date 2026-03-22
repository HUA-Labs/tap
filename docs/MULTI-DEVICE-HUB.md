# sum-back Hub Ops

> 2026-03-22 operational note for the hidden Linux hub pattern

## Goal

Use `sum-back` as the single shared TAP file hub while agents stay on their own devices.

## What Was Proven

These paths were directly demonstrated today:

1. `tap-comms` core runs unchanged on Windows, Ubuntu Linux, and macOS.
2. A macOS client can write a message file into `sum-back` over Tailscale SSH.
3. `sum-back` can act as the file source of truth for `hua-comms`.
4. Hub-local `fs.watch` is the safest place to rely on push semantics.

## Recommended V1 Pattern

- Source of truth: `sum-back:~/hua-comms`
- Hub-local process: `tap-comms.ts` running on `sum-back`
- Hub-local push path: trust `fs.watch` only on `sum-back` local disk
- Optional hub-local Codex bridge: run next to `hua-comms` and target a remote `AppServerUrl`
- Push semantics: trust `fs.watch` only on `sum-back` local disk
- Remote write path: SSH command or mounted shared path
- Remote read baseline: polling over a mounted path, or hub-local processing plus sync

In short:

- write remotely
- watch locally on the hub
- treat polling as the baseline outside the hub

## Process Placement

### sum-back

- `hua-comms` source of truth
- `tap-comms.ts` watcher/polling server
- optional auto-sync/push job
- optional Codex bridge process when the bridge should stay next to the hub-local inbox

### agent device

- interactive Claude / Codex / Gemini session
- local Codex App Server when using remote TUI mode
- optional mounted-path local MCP polling if the hub comms directory is mounted as a normal local path

## Launcher / Bridge Notes

- `AppServerUrl` and `TAP_COMMS_DIR` are different classes of input.
- `AppServerUrl` is a network endpoint and may be remote, for example `ws://100.x.x.x:4501`.
- `TAP_COMMS_DIR` is still a path to a locally visible filesystem.
- This means a Codex bridge can run on `sum-back` against local hub files while steering a remote App Server on another machine over Tailscale.
- It also means a local client without a mounted comms path cannot directly poll the hub inbox through a local `tap-comms` MCP process.

## Why This Shape Is Stable

- `TAP_COMMS_DIR` is a local filesystem path, not a remote transport URL.
- `tap-comms.ts` and the Codex bridge both use direct file operations (`readdirSync`, `readFileSync`, `fs.watch`).
- That means raw `ssh://...` is not a supported comms path today.
- A Linux hub avoids cross-platform watcher differences for the push side.

## Supported Today

- Hub-local `hua-comms` on Linux
- SSH direct file writes into the hub inbox
- Mounted shared path as a local path on another machine
- Polling-first behavior on non-hub machines
- Remote Codex App Server URLs with a bridge process running near the hub-local comms directory

## Not Supported Today

- Using `ssh://...` directly as `TAP_COMMS_DIR`
- Treating network-mounted `fs.watch` as equally reliable to local disk
- A remote comms transport protocol in place of files

## Practical Guidance

If we publish this pattern, label it `Experimental` and describe it as:

> A shared Linux hub can host the TAP comms directory and watcher. Other devices may write into the hub over SSH or a mounted path, while polling remains the safe baseline outside the hub.

Also state this explicitly:

> Remote App Server endpoints are compatible with the current bridge model. Remote comms directories are not; they still need to appear as normal local paths to the process that reads them.

## Follow-Up

- Add a small hub runbook if we operationalize `sum-back`
- Decide whether mounted-path polling is enough, or whether a real remote transport/API should exist
- Keep launcher/bridge docs explicit that `AppServerUrl` can be remote, but `TAP_COMMS_DIR` is still path-based
