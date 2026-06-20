export type ReadyProfileId =
  | "sumback-yoon"
  | "sumback-sol"
  | "mac-jun-ssh-tui"
  | "mac-aux-ssh-headless"
  | "remote-panel-yoon"
  | "sumback-yoon-appserver"
  | "sumback-yoon-bridge";

export interface ReadyProfileConfig {
  id: ReadyProfileId;
  surface: "codex-cli" | "remote-panel";
  agent: string;
  agentEnv?: string;
  command: string;
  appServerUrl?: string;
  host?: string;
  port?: number;
  sendEnabled?: boolean;
  tokenEnv?: string | null;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function buildSumbackYoonAppServerCommand(): string {
  const startCommand =
    "cd /home/devin/hua-platform && exec bash -lc 'exec codex app-server --listen ws://127.0.0.1:35089 2>&1 | tee -a /tmp/tap-appserver-yoon.log'";
  return [
    "set -euo pipefail",
    "session=tap-appserver-yoon",
    "port=35089",
    "log=/tmp/tap-appserver-yoon.log",
    'if tmux has-session -t "$session" 2>/dev/null \\',
    "  && curl -fsS -o /dev/null http://127.0.0.1:${port}/readyz \\",
    "  && curl -fsS -o /dev/null http://127.0.0.1:${port}/healthz; then",
    "printf 'already running: tap-appserver-yoon\\n'",
    "exit 0",
    "fi",
    'if tmux has-session -t "$session" 2>/dev/null; then',
    'tmux kill-session -t "$session"',
    "fi",
    "listener_lines=$(ss -ltnp 2>/dev/null | awk '$4 ~ /:35089$/ {print}' || true)",
    "listener_count=$(printf '%s\\n' \"$listener_lines\" | sed '/^[[:space:]]*$/d' | wc -l | tr -d '[:space:]')",
    'if [ "$listener_count" -gt 1 ]; then',
    "printf 'blocked: port 35089 has ambiguous listener count=%s\\n' \"$listener_count\" >&2",
    "exit 2",
    "fi",
    'if [ "$listener_count" -eq 1 ]; then',
    "listener_line=$(printf '%s\\n' \"$listener_lines\")",
    "listener_pid=$(printf '%s\\n' \"$listener_line\" | sed -n 's/.*pid=\\([0-9][0-9]*\\).*/\\1/p')",
    'if [ -z "$listener_pid" ]; then',
    "printf 'blocked: port 35089 occupied but listener PID is unavailable\\n' >&2",
    "exit 2",
    "fi",
    'listener_comm=$(ps -p "$listener_pid" -o comm= 2>/dev/null | tr -d "[:space:]")',
    'if [ "$listener_comm" != "codex" ]; then',
    'printf \'blocked: port 35089 occupied by non-codex process comm=%s pid=%s\\n\' "$listener_comm" "$listener_pid" >&2',
    "exit 2",
    "fi",
    'kill "$listener_pid"',
    "sleep 1",
    "printf 'replaced stale listener: codex pid %s\\n' \"$listener_pid\"",
    "fi",
    'rm -f "$log"',
    `tmux new-session -d -s "$session" ${shellQuote(startCommand)}`,
    "sleep 2",
    'tmux has-session -t "$session" >/dev/null',
    "ss -ltnp 2>/dev/null | awk '$4 ~ /:35089$/ {found=1} END {exit found?0:1}'",
    "curl -fsS -o /dev/null http://127.0.0.1:${port}/readyz",
    "curl -fsS -o /dev/null http://127.0.0.1:${port}/healthz",
    "printf 'started: tap-appserver-yoon\\n'",
  ].join("\n");
}

function buildSumbackYoonBridgeCommand(): string {
  return [
    "set -euo pipefail",
    "repo=/home/devin/hua-platform",
    "service=tap-bridge-sumback",
    'script_src="$repo/scripts/tap-bridge-recover.sh"',
    'service_src="$repo/scripts/tap-bridge-sumback.service"',
    'script_dst="$HOME/bin/tap-bridge-recover.sh"',
    'service_dst="$HOME/.config/systemd/user/tap-bridge-sumback.service"',
    'heartbeat="$repo/.tmp/codex-app-server-bridge-codex/heartbeat.json"',
    'test -f "$script_src"',
    'test -f "$service_src"',
    'mkdir -p "$HOME/bin" "$HOME/.config/systemd/user"',
    'if [ ! -f "$script_dst" ] || ! cmp -s "$script_src" "$script_dst"; then',
    'install -m 755 "$script_src" "$script_dst"',
    "printf 'synced: tap-bridge-recover.sh\\n'",
    "fi",
    'if [ ! -f "$service_dst" ] || ! cmp -s "$service_src" "$service_dst"; then',
    'install -m 644 "$service_src" "$service_dst"',
    "printf 'synced: tap-bridge-sumback.service\\n'",
    "fi",
    "systemctl --user daemon-reload",
    'systemctl --user restart "$service"',
    "sleep 8",
    'systemctl --user is-active --quiet "$service"',
    'pid=$(systemctl --user show -p MainPID --value "$service")',
    'if ! printf "%s" "$pid" | grep -Eq "^[0-9]+$" || [ "$pid" -le 1 ]; then',
    'printf "blocked: %s has no usable MainPID\\n" "$service" >&2',
    "exit 2",
    "fi",
    'comm=$(ps -p "$pid" -o comm= 2>/dev/null | tr -d "[:space:]")',
    'if [ "$comm" != "node" ]; then',
    'printf "blocked: %s MainPID is not node comm=%s pid=%s\\n" "$service" "$comm" "$pid" >&2',
    "exit 2",
    "fi",
    'test -f "$heartbeat"',
    "node - \"$heartbeat\" <<'NODE'",
    "const fs = require('fs');",
    "const heartbeatPath = process.argv[2];",
    "const heartbeat = JSON.parse(fs.readFileSync(heartbeatPath, 'utf8'));",
    "const ageMs = Date.now() - Date.parse(heartbeat.updatedAt || '');",
    "if (!(ageMs >= 0 && ageMs <= 30000 && heartbeat.connected === true && heartbeat.initialized === true)) {",
    "  console.error(`blocked: bridge heartbeat not ready ageMs=${ageMs} connected=${heartbeat.connected} initialized=${heartbeat.initialized}`);",
    "  process.exit(2);",
    "}",
    "NODE",
    'printf "started: tap-bridge-sumback pid %s\\n" "$pid"',
  ].join("\n");
}

export const READY_PROFILES: Record<ReadyProfileId, ReadyProfileConfig> = {
  "sumback-yoon": {
    id: "sumback-yoon",
    surface: "codex-cli",
    agent: "윤",
    command: "bash scripts/tap-receiver-supervisor.sh sumback-yoon --tmux",
    appServerUrl: "ws://127.0.0.1:35089",
  },
  "sumback-sol": {
    id: "sumback-sol",
    surface: "codex-cli",
    agent: "솔",
    command: "bash scripts/tap-receiver-supervisor.sh sumback-sol --tmux",
    appServerUrl: "ws://127.0.0.1:44587",
  },
  "mac-jun-ssh-tui": {
    id: "mac-jun-ssh-tui",
    surface: "codex-cli",
    agent: "준",
    command: [
      "bash scripts/tap-flow-supervisor.sh mac-jun-projection --tmux",
      "bash scripts/tap-flow-supervisor.sh mac-jun-uplink --tmux",
      "bash scripts/tap-receiver-supervisor.sh mac-jun-ssh-tui --tmux",
    ].join(" && "),
    appServerUrl: "ws://127.0.0.1:35089",
  },
  "mac-aux-ssh-headless": {
    id: "mac-aux-ssh-headless",
    surface: "codex-cli",
    agent: "",
    agentEnv: "TAP_MAC_AUX_AGENT",
    command: [
      "bash scripts/tap-flow-supervisor.sh mac-aux-projection --tmux",
      "bash scripts/tap-flow-supervisor.sh mac-aux-uplink --tmux",
    ].join(" && "),
  },
  "remote-panel-yoon": {
    id: "remote-panel-yoon",
    surface: "remote-panel",
    agent: "윤",
    host: "100.121.45.22",
    port: 8765,
    sendEnabled: false,
    tokenEnv: null,
    command: [
      "mkdir -p /home/devin/hua-platform/.tap-comms/logs",
      "&& {",
      "tmux has-session -t tap-remote-panel-yoon 2>/dev/null",
      "&& printf 'already running: tap-remote-panel-yoon\\n'",
      "|| tmux new-session -d -s tap-remote-panel-yoon",
      shellQuote(
        "cd /home/devin/hua-platform && node packages/tap-comms/dist/cli.mjs remote-panel --agent 윤 --comms-dir /home/devin/hua-comms --host 100.121.45.22 --port 8765 --read-only >> /home/devin/hua-platform/.tap-comms/logs/remote-panel-yoon.log 2>&1",
      ),
      "; }",
    ].join(" "),
  },
  "sumback-yoon-appserver": {
    id: "sumback-yoon-appserver",
    surface: "codex-cli",
    agent: "윤",
    command: buildSumbackYoonAppServerCommand(),
  },
  "sumback-yoon-bridge": {
    id: "sumback-yoon-bridge",
    surface: "codex-cli",
    agent: "윤",
    command: buildSumbackYoonBridgeCommand(),
  },
};

export function parseReadyProfile(
  value: string | boolean | undefined,
): ReadyProfileConfig | null {
  if (typeof value !== "string") return null;
  return READY_PROFILES[value as ReadyProfileId] ?? null;
}

export function supportsHeadlessRunnerProfile(
  profileId: ReadyProfileId,
): boolean {
  return (
    profileId === "sumback-yoon" ||
    profileId === "sumback-sol" ||
    profileId === "mac-jun-ssh-tui" ||
    profileId === "mac-aux-ssh-headless"
  );
}

export function supportsLoadedThreadProfile(
  profileId: ReadyProfileId,
): boolean {
  return (
    profileId === "sumback-yoon" ||
    profileId === "sumback-sol" ||
    profileId === "mac-jun-ssh-tui"
  );
}

export function buildHeadlessRunnerStartCommand(
  profileId: ReadyProfileId,
): string {
  return `bash scripts/tap-headless-runner-supervisor.sh ${profileId} --tmux`;
}

export function buildHeadlessRunnerStopCommand(
  profileId: ReadyProfileId,
): string {
  return `bash scripts/tap-headless-runner-supervisor.sh ${profileId} --stop`;
}

export function buildLoadedThreadAttachSessionName(
  profileId: ReadyProfileId,
): string {
  if (profileId === "mac-jun-ssh-tui") return "tap-codex-jun-tui";
  if (profileId === "mac-aux-ssh-headless") return "tap-codex-mac-aux-tui";
  if (profileId === "sumback-sol") return "tap-codex-sol-tui";
  return "tap-codex-yoon-tui";
}
