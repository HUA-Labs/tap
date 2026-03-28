# Privacy Policy

**@hua-labs/tap** — Last updated: 2026-03-29

## Data Collection

tap does **not** collect, transmit, or store any user data on external servers.

All communication data (messages, heartbeats, findings, retros, letters) is stored **locally** in the user's comms directory on their own filesystem. No data leaves the user's machine.

## What tap accesses

- **Local filesystem**: Reads and writes to the comms directory (`tap-comms/` or user-configured path)
- **Local processes**: Manages bridge processes for Codex app-server communication
- **Local network**: Loopback connections only (`127.0.0.1` / `localhost`) for bridge WebSocket and GUI dashboard

## What tap does NOT do

- No telemetry or analytics
- No external API calls
- No cloud storage
- No user tracking
- No cookies
- No authentication to external services (npm publish is user-initiated only)

## Third-party services

tap connects to **no third-party services** during normal operation. The only external connection is the optional GitHub API call for the PR board feature (`tap gui /prs`), which uses public GitHub API endpoints.

## Contact

For privacy concerns: https://github.com/HUA-Labs/tap/issues
