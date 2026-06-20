import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import {
  __setLoadedThreadReadinessProbeForTests,
  __setReadyProfileCommandRunnerForTests,
  __setWindowsAppRouteHealthProbeForTests,
  __setWindowsAppRouteSmokeTransportFactoryForTests,
  readyCommand,
} from "../commands/ready.js";
import type {
  CodexCliLoadedThreadReadiness,
  ProbeCodexCliLoadedThreadReadinessOptions,
} from "../receiver/codex-cli-loaded-thread-readiness.js";
import type { WindowsAppRouteHealth } from "../routing/windows-app-route-health.js";
import {
  READY_PROFILES,
  type ReadyProfileConfig,
} from "../commands/ready-profiles.js";

let tmpDir: string;
let commsDir: string;
let originalCwd: string;
const originalCodexHome = process.env.CODEX_HOME;

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

function installReadyProfileFixtures(): void {
  const fixtures: Record<string, ReadyProfileConfig> = {
    "sumback-yoon": {
      id: "sumback-yoon",
      surface: "codex-cli",
      agent: "윤",
      command: "bash scripts/tap-receiver-supervisor.sh sumback-yoon --tmux",
      appServerUrl: "ws://127.0.0.1:35089",
      supportsHeadlessRunner: true,
      supportsLoadedThread: true,
      loadedThreadAttachSessionName: "tap-codex-yoon-tui",
    },
    "sumback-sol": {
      id: "sumback-sol",
      surface: "codex-cli",
      agent: "솔",
      command: "bash scripts/tap-receiver-supervisor.sh sumback-sol --tmux",
      appServerUrl: "ws://127.0.0.1:44587",
      supportsHeadlessRunner: true,
      supportsLoadedThread: true,
      loadedThreadAttachSessionName: "tap-codex-sol-tui",
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
      supportsHeadlessRunner: true,
      supportsLoadedThread: true,
      loadedThreadAttachSessionName: "tap-codex-jun-tui",
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
      supportsHeadlessRunner: true,
      loadedThreadAttachSessionName: "tap-codex-mac-aux-tui",
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
  Object.assign(READY_PROFILES, fixtures);
}

function resetReadyProfileFixtures(): void {
  for (const key of Object.keys(READY_PROFILES)) {
    delete READY_PROFILES[key];
  }
}

function writePresence(agent: string, record: Record<string, unknown>): void {
  const presenceDir = path.join(commsDir, "presence");
  fs.mkdirSync(presenceDir, { recursive: true });
  fs.writeFileSync(
    path.join(presenceDir, `${agent}.json`),
    JSON.stringify(record, null, 2),
    "utf8",
  );
}

function loadedThreadReadiness(
  overrides: Partial<CodexCliLoadedThreadReadiness>,
): CodexCliLoadedThreadReadiness {
  return {
    status: "loaded-idle",
    appServerUrl: "ws://127.0.0.1:35089",
    cwd: tmpDir,
    threadId: null,
    loadedThreadId: "thread-ready",
    activeTurnId: null,
    loadedThreadCount: 1,
    matchingThreadCount: 1,
    message: "loaded idle thread thread-ready is ready",
    ...overrides,
  };
}

function windowsRouteHealth(
  overrides: Partial<WindowsAppRouteHealth>,
): WindowsAppRouteHealth {
  return {
    status: "stale-presence",
    message:
      "live Windows App conversation thread-live does not match fresh durable presence thread-old",
    requestedConversationId: "thread-live",
    presenceConversationId: "thread-old",
    presenceOwnerClientId: "owner-old",
    presenceFreshness: "stale-visible",
    presenceAgeMinutes: 120,
    candidates: [
      {
        conversationId: "thread-live",
        ownerClientId: "owner-live",
        hostId: "local",
        lastChangeType: "snapshot",
        lastTurnId: null,
        lastTurnStatus: null,
        hasError: null,
        matchesRequestedConversation: true,
        matchesPresenceConversation: false,
        matchesPresenceOwner: false,
      },
    ],
    ...overrides,
  };
}

function useFullAccessCodexHome(): void {
  const codexHome = path.join(tmpDir, "codex-home");
  fs.mkdirSync(codexHome, { recursive: true });
  fs.writeFileSync(
    path.join(codexHome, "config.toml"),
    '[sandbox]\nmode = "danger-full-access"\n',
    "utf8",
  );
  process.env.CODEX_HOME = codexHome;
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tap-ready-"));
  commsDir = path.join(tmpDir, "hua-comms");
  fs.mkdirSync(path.join(commsDir, "inbox"), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, "package.json"), "{}", "utf8");
  originalCwd = process.cwd();
  process.chdir(tmpDir);
  vi.spyOn(console, "log").mockImplementation(() => {});
  installReadyProfileFixtures();
});

afterEach(() => {
  process.chdir(originalCwd);
  fs.rmSync(tmpDir, { recursive: true, force: true });
  resetReadyProfileFixtures();
  vi.restoreAllMocks();
  __setReadyProfileCommandRunnerForTests(null);
  __setLoadedThreadReadinessProbeForTests(null);
  __setWindowsAppRouteHealthProbeForTests(null);
  __setWindowsAppRouteSmokeTransportFactoryForTests(null);
  delete process.env.TAP_AGENT_NAME;
  delete process.env.TAP_AGENT_ID;
  delete process.env.TAP_MAC_AUX_AGENT;
  delete process.env.TAP_REMOTE_PANEL_TOKEN;
  if (originalCodexHome === undefined) {
    delete process.env.CODEX_HOME;
  } else {
    process.env.CODEX_HOME = originalCodexHome;
  }
});

describe("readyCommand", () => {
  it.each(["unknown", "unnamed"] as const)(
    "rejects placeholder %s agents before reporting a ready return route",
    async (agent) => {
      const result = await readyCommand([
        "--surface",
        "codex-cli",
        "--agent",
        agent,
        "--comms-dir",
        commsDir,
      ]);

      expect(result.ok).toBe(false);
      expect(result.code).toBe("TAP_INVALID_ARGUMENT");
      expect(result.message).toContain("Missing ready agent");
      expect(result.data).toEqual({});
    },
  );

  it("reports Codex CLI as polling-ready without consent-drive claims", async () => {
    const result = await readyCommand([
      "--surface",
      "codex-cli",
      "--agent",
      "준",
      "--comms-dir",
      commsDir,
    ]);

    expect(result.ok).toBe(true);
    expect(result.code).toBe("TAP_READY_OK");
    expect(result.data).toMatchObject({
      agent: "준",
      surface: "codex-cli",
      status: "ready",
      receiveTransports: ["polling"],
      returnRoute: { routingAddress: "준", status: "ready" },
    });
    expect(result.data.checks).toContainEqual(
      expect.objectContaining({
        name: "receive-transport",
        message: expect.stringContaining("polling/file-polling"),
      }),
    );
    expect(result.data.receiveTransports).not.toContain("consent-drive");
  });

  it("matches app-server instance presence by concrete agent alias", async () => {
    writePresence("codex-agent-a", {
      agent: "codex-agent-a",
      timestamp: new Date().toISOString(),
      address: {
        routingAddress: "codex-agent-a",
        aliases: ["codex-agent-a", "agent-a"],
      },
      receiveTransports: ["consent-drive"],
    });

    const result = await readyCommand([
      "--surface",
      "codex-cli",
      "--agent",
      "agent-a",
      "--comms-dir",
      commsDir,
    ]);

    expect(result.ok).toBe(true);
    expect(result.data.status).toBe("ready");
    expect(result.data.presence).toMatchObject({
      exists: true,
      matchedBy: "record-alias",
      requestedPath: path.join(commsDir, "presence", "agent-a.json"),
      path: path.join(commsDir, "presence", "codex-agent-a.json"),
    });
  });

  it("does not match unrelated presence by filename suffix alone", async () => {
    writePresence("other-agent-a", {
      agent: "other-agent-a",
      timestamp: new Date().toISOString(),
      health: { status: "ready" },
      address: {
        routingAddress: "other-agent-a",
        aliases: ["other-agent-a"],
      },
      receiveTransports: ["mcp-channel"],
    });

    const result = await readyCommand([
      "--surface",
      "claude",
      "--agent",
      "agent-a",
      "--comms-dir",
      commsDir,
    ]);

    expect(result.ok).toBe(true);
    expect(result.data.presence).toMatchObject({
      exists: false,
      matchedBy: "missing",
      requestedPath: path.join(commsDir, "presence", "agent-a.json"),
      path: path.join(commsDir, "presence", "agent-a.json"),
    });
  });

  it("applies safe local Codex CLI readiness directories", async () => {
    fs.rmSync(commsDir, { recursive: true, force: true });

    const result = await readyCommand([
      "--surface",
      "codex-cli",
      "--agent",
      "준",
      "--comms-dir",
      commsDir,
      "--apply",
    ]);

    expect(result.data.status).toBe("ready");
    expect(fs.existsSync(commsDir)).toBe(true);
    expect(fs.existsSync(path.join(commsDir, "inbox"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, ".tap-comms", "receiver"))).toBe(
      true,
    );
    expect(result.data.apply).toMatchObject({
      enabled: true,
      dryRun: false,
    });
    expect(result.data.apply.actions).toContainEqual(
      expect.objectContaining({
        name: "inbox",
        status: "applied",
      }),
    );
    expect(result.data.receiveTransports).toEqual(["polling"]);
  });

  it("infers Codex CLI readiness from a known profile and dry-runs profile start", async () => {
    const runs: string[] = [];
    const codexHome = path.join(tmpDir, "codex-home");
    fs.mkdirSync(codexHome, { recursive: true });
    fs.writeFileSync(
      path.join(codexHome, "config.toml"),
      '[sandbox]\nmode = "danger-full-access"\n',
      "utf8",
    );
    process.env.CODEX_HOME = codexHome;
    __setReadyProfileCommandRunnerForTests((profile) => {
      runs.push(profile.id);
      return { ok: true, status: 0, stdout: "started", stderr: "" };
    });

    const result = await readyCommand([
      "--profile",
      "sumback-yoon",
      "--apply",
      "--dry-run",
      "--comms-dir",
      commsDir,
    ]);

    expect(runs).toEqual([]);
    expect(result.data).toMatchObject({
      agent: "윤",
      surface: "codex-cli",
      profile: "sumback-yoon",
      status: "ready",
    });
    expect(result.data.apply.actions).toContainEqual(
      expect.objectContaining({
        name: "ready-profile",
        status: "would-apply",
        command: expect.stringContaining("tap-receiver-supervisor.sh"),
      }),
    );
    expect(result.data.actions).toContainEqual(
      expect.objectContaining({
        label: "Start ready profile",
        command: expect.stringContaining("sumback-yoon --tmux"),
      }),
    );
    expect(result.data.checks).toContainEqual(
      expect.objectContaining({
        name: "codex-permission-profile",
        status: "pass",
      }),
    );
  });

  it("dry-runs the sum-back app-server profile without executing recovery", async () => {
    const runs: string[] = [];
    const codexHome = path.join(tmpDir, "codex-home");
    fs.mkdirSync(codexHome, { recursive: true });
    fs.writeFileSync(
      path.join(codexHome, "config.toml"),
      '[sandbox]\nmode = "danger-full-access"\n',
      "utf8",
    );
    process.env.CODEX_HOME = codexHome;
    __setReadyProfileCommandRunnerForTests((profile) => {
      runs.push(profile.id);
      return { ok: true, status: 0, stdout: "started", stderr: "" };
    });

    const result = await readyCommand([
      "--profile",
      "sumback-yoon-appserver",
      "--apply",
      "--dry-run",
      "--comms-dir",
      commsDir,
    ]);

    const profileAction = result.data.apply.actions.find(
      (action) => action.name === "ready-profile",
    );

    expect(runs).toEqual([]);
    expect(result.data).toMatchObject({
      agent: "윤",
      surface: "codex-cli",
      profile: "sumback-yoon-appserver",
      status: "ready",
    });
    expect(profileAction).toMatchObject({
      status: "would-apply",
      message: "would start ready profile sumback-yoon-appserver",
    });
    expect(profileAction?.command).toContain("tap-appserver-yoon");
    expect(profileAction?.command).toContain(
      "codex app-server --listen ws://127.0.0.1:35089",
    );
    expect(profileAction?.command).toContain('ps -p "$listener_pid" -o comm=');
    expect(profileAction?.command).toContain("listener_count=");
    expect(profileAction?.command).toContain(
      "blocked: port 35089 has ambiguous listener count=",
    );
    expect(profileAction?.command).toContain(
      "blocked: port 35089 occupied by non-codex process",
    );
    const syntaxCheck = spawnSync("bash", ["-n"], {
      input: profileAction?.command,
      encoding: "utf8",
    });
    expect(syntaxCheck.status).toBe(0);
    expect(profileAction?.command).not.toContain("ps aux");
    expect(profileAction?.command).not.toContain("pkill");
    expect(profileAction?.command).not.toContain("killall");
    expect(profileAction?.command).not.toContain("{print; exit}");
    expect(result.data.actions).toContainEqual(
      expect.objectContaining({
        label: "Start ready profile",
        command: expect.stringContaining("tap-appserver-yoon"),
      }),
    );
  });

  it("dry-runs the sum-back bridge profile without executing recovery", async () => {
    const runs: string[] = [];
    const codexHome = path.join(tmpDir, "codex-home");
    fs.mkdirSync(codexHome, { recursive: true });
    fs.writeFileSync(
      path.join(codexHome, "config.toml"),
      '[sandbox]\nmode = "danger-full-access"\n',
      "utf8",
    );
    process.env.CODEX_HOME = codexHome;
    __setReadyProfileCommandRunnerForTests((profile) => {
      runs.push(profile.id);
      return { ok: true, status: 0, stdout: "started", stderr: "" };
    });

    const result = await readyCommand([
      "--profile",
      "sumback-yoon-bridge",
      "--apply",
      "--dry-run",
      "--comms-dir",
      commsDir,
    ]);

    const profileAction = result.data.apply.actions.find(
      (action) => action.name === "ready-profile",
    );

    expect(runs).toEqual([]);
    expect(result.data).toMatchObject({
      agent: "윤",
      surface: "codex-cli",
      profile: "sumback-yoon-bridge",
      status: "ready",
    });
    expect(profileAction).toMatchObject({
      status: "would-apply",
      message: "would start ready profile sumback-yoon-bridge",
    });
    expect(profileAction?.command).toContain("tap-bridge-sumback");
    expect(profileAction?.command).toContain("tap-bridge-recover.sh");
    expect(profileAction?.command).toContain("install -m 755");
    expect(profileAction?.command).toContain("install -m 644");
    expect(profileAction?.command).toContain("systemctl --user daemon-reload");
    expect(profileAction?.command).toContain(
      'systemctl --user restart "$service"',
    );
    expect(profileAction?.command).toContain(
      "systemctl --user show -p MainPID",
    );
    expect(profileAction?.command).toContain(
      ".tmp/codex-app-server-bridge-codex/heartbeat.json",
    );
    const syntaxCheck = spawnSync("bash", ["-n"], {
      input: profileAction?.command,
      encoding: "utf8",
    });
    expect(syntaxCheck.status).toBe(0);
    expect(profileAction?.command).not.toContain("ps aux");
    expect(profileAction?.command).not.toContain("pkill");
    expect(profileAction?.command).not.toContain("killall");
    expect(result.data.headlessRunner).toBeUndefined();
    expect(result.data.actions).not.toContainEqual(
      expect.objectContaining({
        label: "Headless runner dry-run",
      }),
    );
  });

  it("reports headless runner readiness for known Codex CLI profiles", async () => {
    const codexHome = path.join(tmpDir, "codex-home");
    fs.mkdirSync(codexHome, { recursive: true });
    fs.writeFileSync(
      path.join(codexHome, "config.toml"),
      '[sandbox]\nmode = "danger-full-access"\n',
      "utf8",
    );
    process.env.CODEX_HOME = codexHome;
    fs.mkdirSync(path.join(tmpDir, "packages", "tap-comms", "dist"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(tmpDir, "packages", "tap-comms", "dist", "cli.mjs"),
      "",
      "utf8",
    );
    const packageDir = path.join(tmpDir, "packages", "tap-comms");
    fs.mkdirSync(path.join(tmpDir, "scripts"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, "scripts", "tap-receiver-supervisor.sh"),
      "#!/usr/bin/env bash\n",
      "utf8",
    );
    process.chdir(packageDir);
    const expectedRepoRoot = fs.realpathSync(tmpDir);
    const absentHeadlessSession = `tap-headless-test-absent-${process.pid}`;

    const result = await readyCommand([
      "--profile",
      "sumback-yoon",
      "--comms-dir",
      commsDir,
      "--headless-session",
      absentHeadlessSession,
    ]);

    expect(result.data.status).toBe("ready");
    expect(result.data.headlessRunner).toMatchObject({
      installed: true,
      running: false,
      required: false,
      sessionName: absentHeadlessSession,
      stateName: "m472-headless-sumback-yoon",
    });
    expect(result.data.headlessRunner?.dryRunCommand).toContain(
      "headless dry-run",
    );
    expect(result.data.headlessRunner?.dryRunCommand).toContain(
      `cd '${expectedRepoRoot}' && node packages/tap-comms/dist/cli.mjs`,
    );
    expect(result.data.actions).toContainEqual(
      expect.objectContaining({
        label: "Start headless runner",
        command:
          "bash scripts/tap-headless-runner-supervisor.sh sumback-yoon --tmux",
      }),
    );
    expect(result.data.actions).toContainEqual(
      expect.objectContaining({
        label: "Stop headless runner",
        command:
          "bash scripts/tap-headless-runner-supervisor.sh sumback-yoon --stop",
      }),
    );
    expect(result.data.checks).toContainEqual(
      expect.objectContaining({
        name: "headless-runner-command",
        status: "pass",
      }),
    );
    expect(result.data.checks).toContainEqual(
      expect.objectContaining({
        name: "headless-runner-standing",
        status: "skip",
      }),
    );
    expect(result.data.actions).toContainEqual(
      expect.objectContaining({
        label: "Headless runner dry-run",
        command: expect.stringContaining("--state-name"),
      }),
    );
    expect(
      result.data.actions.find(
        (action) => action.label === "Headless runner dry-run",
      )?.command,
    ).toContain(
      `cd '${expectedRepoRoot}' && node packages/tap-comms/dist/cli.mjs`,
    );
  });

  it("fails known Codex CLI profiles when a required headless runner is absent", async () => {
    const codexHome = path.join(tmpDir, "codex-home");
    fs.mkdirSync(codexHome, { recursive: true });
    fs.writeFileSync(
      path.join(codexHome, "config.toml"),
      '[sandbox]\nmode = "danger-full-access"\n',
      "utf8",
    );
    process.env.CODEX_HOME = codexHome;
    fs.mkdirSync(path.join(tmpDir, "packages", "tap-comms", "dist"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(tmpDir, "packages", "tap-comms", "dist", "cli.mjs"),
      "",
      "utf8",
    );
    const absentHeadlessSession = `tap-headless-test-required-${process.pid}`;

    const result = await readyCommand([
      "--profile",
      "sumback-yoon",
      "--comms-dir",
      commsDir,
      "--require-headless-runner",
      "--headless-session",
      absentHeadlessSession,
    ]);

    expect(result.data.status).toBe("not-ready");
    expect(result.data.headlessRunner).toMatchObject({
      installed: true,
      running: false,
      required: true,
    });
    expect(result.data.checks).toContainEqual(
      expect.objectContaining({
        name: "headless-runner-standing",
        status: "fail",
      }),
    );
    expect(result.data.next).toContain(
      `start or recover standing headless runner: ${absentHeadlessSession}`,
    );
    expect(result.warnings.join("\n")).toContain("headless-runner-standing");
  });

  it.each([
    {
      status: "app-server-unreachable",
      expectedStatus: "not-ready",
      expectedCheckStatus: "fail",
      message: "Failed to connect to App Server at ws://127.0.0.1:35089",
    },
    {
      status: "thread-not-loaded",
      expectedStatus: "not-ready",
      expectedCheckStatus: "fail",
      message: "app-server reachable, but no loaded thread was found",
    },
    {
      status: "loaded-idle",
      expectedStatus: "ready",
      expectedCheckStatus: "pass",
      message: "loaded idle thread thread-ready is ready",
    },
    {
      status: "loaded-active",
      expectedStatus: "blocked",
      expectedCheckStatus: "block",
      message: "loaded thread thread-busy is active/busy",
    },
  ] as const)(
    "classifies loaded-thread readiness as $status for known Codex CLI profiles",
    async ({ status, expectedStatus, expectedCheckStatus, message }) => {
      useFullAccessCodexHome();
      const probes: Array<{
        appServerUrl: string;
        cwd: string;
        threadId?: string | null;
      }> = [];
      __setLoadedThreadReadinessProbeForTests(async (options) => {
        probes.push(options);
        return loadedThreadReadiness({
          status,
          message,
          loadedThreadId:
            status === "loaded-active" ? "thread-busy" : "thread-ready",
          activeTurnId: status === "loaded-active" ? "turn-busy" : null,
        });
      });

      const result = await readyCommand([
        "--profile",
        "sumback-yoon",
        "--comms-dir",
        commsDir,
        "--check-loaded-thread",
      ]);

      expect(probes).toEqual([
        {
          appServerUrl: "ws://127.0.0.1:35089",
          cwd: fs.realpathSync(tmpDir),
          threadId: null,
        },
      ]);
      expect(result.data.status).toBe(expectedStatus);
      expect(result.data.runtimeHealth).toBe(status);
      expect(result.data.loadedThread).toMatchObject({
        status,
        required: true,
        message,
        appServerUrl: "ws://127.0.0.1:35089",
      });
      expect(result.data.checks).toContainEqual(
        expect.objectContaining({
          name: "loaded-thread",
          status: expectedCheckStatus,
          message,
        }),
      );
      expect(result.data.actions).toContainEqual(
        expect.objectContaining({
          label: "Attach visible TUI to loaded-thread profile",
          command: expect.stringContaining("codex resume --last"),
        }),
      );
    },
  );

  it("composes loaded-thread diagnostics with a stopped receiver supervisor", async () => {
    useFullAccessCodexHome();
    __setLoadedThreadReadinessProbeForTests(async () =>
      loadedThreadReadiness({ status: "loaded-idle" }),
    );
    const absentReceiverSession = `tap-receiver-test-absent-${process.pid}`;

    const result = await readyCommand([
      "--profile",
      "sumback-yoon",
      "--comms-dir",
      commsDir,
      "--check-loaded-thread",
      "--require-supervisor",
      "--receiver-session",
      absentReceiverSession,
    ]);

    expect(result.data.status).toBe("partial");
    expect(result.data.loadedThread).toMatchObject({
      status: "loaded-idle",
    });
    expect(result.data.checks).toContainEqual(
      expect.objectContaining({
        name: "loaded-thread",
        status: "pass",
      }),
    );
    expect(result.data.checks).toContainEqual(
      expect.objectContaining({
        name: "receiver-supervisor",
        status: "warn",
        message: expect.stringContaining(absentReceiverSession),
      }),
    );
  });

  it("rejects loaded-thread diagnostics outside reviewed CLI/TUI ready profiles", async () => {
    const result = await readyCommand([
      "--surface",
      "codex-cli",
      "--agent",
      "준",
      "--comms-dir",
      commsDir,
      "--check-loaded-thread",
    ]);

    expect(result.ok).toBe(false);
    expect(result.code).toBe("TAP_INVALID_ARGUMENT");
    expect(result.message).toContain("reviewed Codex CLI/TUI profiles");
  });

  it.each([
    ["--app-server-url", "Invalid --app-server-url: expected a value."],
    ["--thread-id", "Invalid --thread-id: expected a value."],
  ] as const)(
    "rejects malformed loaded-thread flag %s before falling back to defaults",
    async (flag, expectedMessage) => {
      const result = await readyCommand([
        "--profile",
        "sumback-yoon",
        "--comms-dir",
        commsDir,
        "--check-loaded-thread",
        flag,
      ]);

      expect(result.ok).toBe(false);
      expect(result.code).toBe("TAP_INVALID_ARGUMENT");
      expect(result.message).toBe(expectedMessage);
      expect(result.data).toEqual({});
    },
  );

  it("rejects non-WebSocket loaded-thread app-server URLs", async () => {
    const result = await readyCommand([
      "--profile",
      "sumback-yoon",
      "--comms-dir",
      commsDir,
      "--check-loaded-thread",
      "--app-server-url",
      "http://127.0.0.1:35089",
    ]);

    expect(result.ok).toBe(false);
    expect(result.code).toBe("TAP_INVALID_ARGUMENT");
    expect(result.message).toContain("ws:// or wss://");
  });

  it("dry-runs visible TUI attach recovery only when the profile has no loaded thread", async () => {
    useFullAccessCodexHome();
    __setLoadedThreadReadinessProbeForTests(async () =>
      loadedThreadReadiness({
        status: "thread-not-loaded",
        loadedThreadId: null,
        loadedThreadCount: 0,
        matchingThreadCount: 0,
        message: "app-server reachable, but no loaded thread was found",
      }),
    );

    const result = await readyCommand([
      "--profile",
      "sumback-yoon",
      "--comms-dir",
      commsDir,
      "--check-loaded-thread",
      "--apply",
      "--dry-run",
      "--apply-loaded-thread-attach",
    ]);

    expect(result.data.status).toBe("not-ready");
    expect(result.data.apply).toMatchObject({
      enabled: true,
      dryRun: true,
    });
    expect(result.data.apply.actions).toContainEqual(
      expect.objectContaining({
        name: "loaded-thread-attach",
        status: "would-apply",
        command: expect.stringContaining("codex resume --last"),
        message: expect.stringContaining("would attach visible TUI"),
      }),
    );
    expect(result.data.apply.actions).toContainEqual(
      expect.objectContaining({
        name: "ready-profile",
        status: "would-apply",
      }),
    );
  });

  it("does not dry-run visible TUI attach when the loaded thread is active", async () => {
    useFullAccessCodexHome();
    __setLoadedThreadReadinessProbeForTests(async () =>
      loadedThreadReadiness({
        status: "loaded-active",
        loadedThreadId: "thread-busy",
        activeTurnId: "turn-busy",
        message: "loaded thread thread-busy is active/busy",
      }),
    );

    const result = await readyCommand([
      "--profile",
      "sumback-yoon",
      "--comms-dir",
      commsDir,
      "--check-loaded-thread",
      "--apply",
      "--dry-run",
      "--apply-loaded-thread-attach",
    ]);

    expect(result.data.status).toBe("blocked");
    expect(result.data.apply.actions).toContainEqual(
      expect.objectContaining({
        name: "loaded-thread-attach",
        status: "skipped",
        message: expect.stringContaining(
          "loaded-thread status is loaded-active",
        ),
      }),
    );
    expect(result.data.apply.actions).not.toContainEqual(
      expect.objectContaining({
        name: "loaded-thread-attach",
        status: "would-apply",
      }),
    );
  });

  it("applies visible TUI attach only when the profile has no loaded thread", async () => {
    useFullAccessCodexHome();
    __setLoadedThreadReadinessProbeForTests(async () =>
      loadedThreadReadiness({
        status: "thread-not-loaded",
        loadedThreadId: null,
        loadedThreadCount: 0,
        matchingThreadCount: 0,
        message: "app-server reachable, but no loaded thread was found",
      }),
    );
    const runs: Array<{ command: string; cwd: string }> = [];
    __setReadyProfileCommandRunnerForTests((profile, cwd) => {
      runs.push({ command: profile.command, cwd });
      return {
        ok: true,
        status: 0,
        stdout: profile.command.includes("tmux new-session")
          ? "started: tap-codex-yoon-tui\n"
          : "started: tap-receiver-yoon\n",
        stderr: "",
      };
    });

    const result = await readyCommand([
      "--profile",
      "sumback-yoon",
      "--comms-dir",
      commsDir,
      "--check-loaded-thread",
      "--apply",
      "--apply-loaded-thread-attach",
    ]);

    expect(result.ok).toBe(true);
    expect(result.data.status).toBe("not-ready");
    expect(runs).toHaveLength(2);
    expect(runs[1]!.command).toContain("tmux new-session -d");
    expect(runs[1]!.command).toContain("tap-codex-yoon-tui");
    expect(runs[1]!.command).toContain("codex resume --last");
    expect(runs[1]!.command).toContain("--enable tui_app_server");
    expect(result.data.apply.actions).toContainEqual(
      expect.objectContaining({
        name: "loaded-thread-attach",
        status: "applied",
        command: expect.stringContaining("tmux new-session -d"),
        message: expect.stringContaining("attached visible TUI"),
      }),
    );
  });

  it("does not apply visible TUI attach when the loaded thread is active", async () => {
    useFullAccessCodexHome();
    __setLoadedThreadReadinessProbeForTests(async () =>
      loadedThreadReadiness({
        status: "loaded-active",
        loadedThreadId: "thread-busy",
        activeTurnId: "turn-busy",
        message: "loaded thread thread-busy is active/busy",
      }),
    );
    const runs: string[] = [];
    __setReadyProfileCommandRunnerForTests((profile) => {
      runs.push(profile.command);
      return {
        ok: true,
        status: 0,
        stdout: "started\n",
        stderr: "",
      };
    });

    const result = await readyCommand([
      "--profile",
      "sumback-yoon",
      "--comms-dir",
      commsDir,
      "--check-loaded-thread",
      "--apply",
      "--apply-loaded-thread-attach",
    ]);

    expect(result.data.status).toBe("blocked");
    expect(runs).toHaveLength(1);
    expect(runs[0]).not.toContain("tap-codex-yoon-tui");
    expect(result.data.apply.actions).toContainEqual(
      expect.objectContaining({
        name: "loaded-thread-attach",
        status: "skipped",
        message: expect.stringContaining(
          "loaded-thread status is loaded-active",
        ),
      }),
    );
  });

  it("does not apply visible TUI attach when the app-server is unreachable", async () => {
    useFullAccessCodexHome();
    __setLoadedThreadReadinessProbeForTests(async () =>
      loadedThreadReadiness({
        status: "app-server-unreachable",
        loadedThreadId: null,
        loadedThreadCount: 0,
        matchingThreadCount: 0,
        message: "Failed to connect to App Server at ws://127.0.0.1:35089",
      }),
    );
    const runs: string[] = [];
    __setReadyProfileCommandRunnerForTests((profile) => {
      runs.push(profile.command);
      return {
        ok: true,
        status: 0,
        stdout: "started\n",
        stderr: "",
      };
    });

    const result = await readyCommand([
      "--profile",
      "sumback-yoon",
      "--comms-dir",
      commsDir,
      "--check-loaded-thread",
      "--apply",
      "--apply-loaded-thread-attach",
    ]);

    expect(result.data.status).toBe("not-ready");
    expect(runs).toHaveLength(1);
    expect(runs[0]).not.toContain("tap-codex-yoon-tui");
    expect(result.data.apply.actions).toContainEqual(
      expect.objectContaining({
        name: "loaded-thread-attach",
        status: "skipped",
        message: expect.stringContaining(
          "loaded-thread status is app-server-unreachable",
        ),
      }),
    );
  });

  it("requires loaded-thread diagnostics before dry-running visible TUI attach", async () => {
    const result = await readyCommand([
      "--profile",
      "sumback-yoon",
      "--comms-dir",
      commsDir,
      "--apply",
      "--dry-run",
      "--apply-loaded-thread-attach",
    ]);

    expect(result.ok).toBe(false);
    expect(result.code).toBe("TAP_INVALID_ARGUMENT");
    expect(result.message).toContain("requires --check-loaded-thread");
  });

  it("rejects headless runner apply without apply mode", async () => {
    const result = await readyCommand([
      "--profile",
      "sumback-yoon",
      "--comms-dir",
      commsDir,
      "--apply-headless-runner",
    ]);

    expect(result.ok).toBe(false);
    expect(result.code).toBe("TAP_INVALID_ARGUMENT");
    expect(result.message).toContain(
      "--apply-headless-runner requires --apply",
    );
  });

  it("rejects headless runner apply for non-worker ready profiles", async () => {
    const result = await readyCommand([
      "--profile",
      "sumback-yoon-appserver",
      "--comms-dir",
      commsDir,
      "--apply",
      "--apply-headless-runner",
    ]);

    expect(result.ok).toBe(false);
    expect(result.code).toBe("TAP_INVALID_ARGUMENT");
    expect(result.message).toContain("reviewed Codex CLI worker profiles");
  });

  it("dry-runs standing headless runner startup without executing the runner command", async () => {
    const runs: string[] = [];
    const codexHome = path.join(tmpDir, "codex-home");
    fs.mkdirSync(codexHome, { recursive: true });
    fs.writeFileSync(
      path.join(codexHome, "config.toml"),
      '[sandbox]\nmode = "danger-full-access"\n',
      "utf8",
    );
    process.env.CODEX_HOME = codexHome;
    fs.mkdirSync(path.join(tmpDir, "packages", "tap-comms", "dist"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(tmpDir, "packages", "tap-comms", "dist", "cli.mjs"),
      "",
      "utf8",
    );
    __setReadyProfileCommandRunnerForTests((profile) => {
      runs.push(profile.command);
      return { ok: true, status: 0, stdout: "started", stderr: "" };
    });

    const result = await readyCommand([
      "--profile",
      "sumback-yoon",
      "--comms-dir",
      commsDir,
      "--apply",
      "--dry-run",
      "--apply-headless-runner",
    ]);

    expect(runs).toEqual([]);
    expect(result.data.headlessRunner).toMatchObject({
      startCommand:
        "bash scripts/tap-headless-runner-supervisor.sh sumback-yoon --tmux",
    });
    expect(result.data.apply.actions).toContainEqual(
      expect.objectContaining({
        name: "headless-runner",
        status: "would-apply",
        command:
          "bash scripts/tap-headless-runner-supervisor.sh sumback-yoon --tmux",
      }),
    );
  });

  it("applies a known Codex CLI ready profile through the command runner", async () => {
    const runs: Array<{ id: string; cwd: string }> = [];
    const codexHome = path.join(tmpDir, "codex-home");
    fs.mkdirSync(codexHome, { recursive: true });
    fs.writeFileSync(
      path.join(codexHome, "config.toml"),
      '[sandbox]\nmode = "danger-full-access"\n',
      "utf8",
    );
    process.env.CODEX_HOME = codexHome;
    __setReadyProfileCommandRunnerForTests((profile, cwd) => {
      runs.push({ id: profile.id, cwd });
      return { ok: true, status: 0, stdout: "started", stderr: "" };
    });
    const packageDir = path.join(tmpDir, "packages", "tap-comms");
    fs.mkdirSync(packageDir, { recursive: true });
    fs.mkdirSync(path.join(tmpDir, "scripts"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, "scripts", "tap-receiver-supervisor.sh"),
      "#!/usr/bin/env bash\n",
      "utf8",
    );
    process.chdir(packageDir);
    const expectedRepoRoot = fs.realpathSync(tmpDir);

    const result = await readyCommand([
      "--profile",
      "sumback-yoon",
      "--apply",
      "--comms-dir",
      commsDir,
    ]);

    expect(runs).toEqual([{ id: "sumback-yoon", cwd: expectedRepoRoot }]);
    expect(result.data.status).toBe("ready");
    expect(result.data.apply.actions).toContainEqual(
      expect.objectContaining({
        name: "ready-profile",
        status: "applied",
        message: "applied ready profile sumback-yoon: started",
      }),
    );
  });

  it("includes Mac 준 projection and uplink supervisors in the ready profile apply command", async () => {
    const runs: Array<{ id: string; command: string; cwd: string }> = [];
    const codexHome = path.join(tmpDir, "codex-home");
    fs.mkdirSync(codexHome, { recursive: true });
    fs.writeFileSync(
      path.join(codexHome, "config.toml"),
      '[sandbox]\nmode = "danger-full-access"\n',
      "utf8",
    );
    process.env.CODEX_HOME = codexHome;
    __setReadyProfileCommandRunnerForTests((profile, cwd) => {
      runs.push({ id: profile.id, command: profile.command, cwd });
      return {
        ok: true,
        status: 0,
        stdout: [
          "already running: tap-projection-jun",
          "already running: tap-uplink-jun",
          "already running: tap-receiver-jun-ssh-tui",
        ].join("\n"),
        stderr: "",
      };
    });
    const packageDir = path.join(tmpDir, "packages", "tap-comms");
    fs.mkdirSync(packageDir, { recursive: true });
    fs.mkdirSync(path.join(tmpDir, "scripts"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, "scripts", "tap-receiver-supervisor.sh"),
      "#!/usr/bin/env bash\n",
      "utf8",
    );
    process.chdir(packageDir);
    const expectedRepoRoot = fs.realpathSync(tmpDir);

    const result = await readyCommand([
      "--profile",
      "mac-jun-ssh-tui",
      "--apply",
      "--comms-dir",
      commsDir,
    ]);

    expect(runs).toEqual([
      {
        id: "mac-jun-ssh-tui",
        command: [
          "bash scripts/tap-flow-supervisor.sh mac-jun-projection --tmux",
          "bash scripts/tap-flow-supervisor.sh mac-jun-uplink --tmux",
          "bash scripts/tap-receiver-supervisor.sh mac-jun-ssh-tui --tmux",
        ].join(" && "),
        cwd: expectedRepoRoot,
      },
    ]);
    expect(result.data.apply.actions).toContainEqual(
      expect.objectContaining({
        name: "ready-profile",
        status: "applied",
        command: expect.stringContaining("tap-flow-supervisor.sh"),
      }),
    );
  });

  it("requires an explicit agent name for the Mac auxiliary headless profile", async () => {
    const result = await readyCommand([
      "--profile",
      "mac-aux-ssh-headless",
      "--comms-dir",
      commsDir,
    ]);

    expect(result.ok).toBe(false);
    expect(result.message).toContain(
      "requires --agent <name> or TAP_MAC_AUX_AGENT",
    );
  });

  it("builds Mac auxiliary headless commands with a chosen non-jun agent", async () => {
    useFullAccessCodexHome();
    fs.mkdirSync(path.join(tmpDir, "scripts"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, "scripts", "tap-receiver-supervisor.sh"),
      "#!/usr/bin/env bash\n",
      "utf8",
    );
    fs.writeFileSync(
      path.join(tmpDir, "scripts", "tap-flow-supervisor.sh"),
      [
        "#!/usr/bin/env bash",
        "set -euo pipefail",
        'if [ -z "${TAP_MAC_AUX_AGENT:-}" ]; then',
        "  echo 'TAP_MAC_AUX_AGENT is required' >&2",
        "  exit 2",
        "fi",
        "echo \"$1 --agent '$TAP_MAC_AUX_AGENT'\"",
        "",
      ].join("\n"),
      "utf8",
    );
    fs.mkdirSync(path.join(tmpDir, "packages", "tap-comms", "dist"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(tmpDir, "packages", "tap-comms", "dist", "cli.mjs"),
      "",
      "utf8",
    );

    const result = await readyCommand([
      "--profile",
      "mac-aux-ssh-headless",
      "--agent",
      "민",
      "--apply",
      "--dry-run",
      "--apply-headless-runner",
      "--comms-dir",
      commsDir,
    ]);

    const readyProfileAction = result.data.apply.actions.find(
      (action) => action.name === "ready-profile",
    );
    const headlessAction = result.data.apply.actions.find(
      (action) => action.name === "headless-runner",
    );

    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      agent: "민",
      profile: "mac-aux-ssh-headless",
      surface: "codex-cli",
    });
    expect(readyProfileAction).toMatchObject({
      status: "would-apply",
      command: expect.stringContaining("TAP_MAC_AUX_AGENT='민'"),
    });
    const readyProfileCommand = readyProfileAction?.command ?? "";
    expect(readyProfileCommand).toContain("export TAP_MAC_AUX_AGENT");
    expect(readyProfileCommand).toContain("mac-aux-projection");
    expect(readyProfileCommand).toContain("mac-aux-uplink");
    expect(readyProfileCommand).not.toContain("--alias codex");
    expect(readyProfileCommand).not.toContain("mac-jun-");
    expect(readyProfileCommand).not.toContain("tap-receiver-jun-ssh-tui");
    expect(readyProfileCommand).not.toMatch(
      /TAP_MAC_AUX_AGENT='민' bash .*&& bash/,
    );
    const shellEnvSmoke = spawnSync(
      "bash",
      [
        "-lc",
        "unset TAP_MAC_AUX_AGENT; TAP_MAC_AUX_AGENT='민'; export TAP_MAC_AUX_AGENT; bash scripts/tap-flow-supervisor.sh mac-aux-projection --print-command && bash scripts/tap-flow-supervisor.sh mac-aux-uplink --print-command",
      ],
      {
        cwd: tmpDir,
        encoding: "utf8",
      },
    );
    expect(shellEnvSmoke.status).toBe(0);
    expect(shellEnvSmoke.stdout).toContain("--agent '민'");
    expect(shellEnvSmoke.stderr).not.toContain("TAP_MAC_AUX_AGENT is required");
    expect(headlessAction).toMatchObject({
      status: "would-apply",
      command: expect.stringContaining("TAP_MAC_AUX_AGENT='민'"),
    });
    const headlessStartCommand = headlessAction?.command ?? "";
    expect(headlessStartCommand).toContain(
      "tap-headless-runner-supervisor.sh mac-aux-ssh-headless --tmux",
    );
    expect(headlessStartCommand).not.toContain("--alias codex");
    expect(headlessStartCommand).not.toContain("mac-jun-ssh-tui");
    expect(result.data.headlessRunner).toMatchObject({
      sessionName: "tap-headless-mac-aux-ssh-headless",
      stateName: "m472-headless-mac-aux-ssh-headless",
    });
    const dryRunCommand = result.data.headlessRunner?.dryRunCommand ?? "";
    expect(dryRunCommand).toContain("headless dry-run --agent '민'");
    expect(dryRunCommand).not.toContain("--alias codex");
    expect(dryRunCommand).not.toContain("mac-jun-ssh-tui");
    expect(result.data.actions).toContainEqual(
      expect.objectContaining({
        label: "Start headless runner",
        command: expect.stringContaining("TAP_MAC_AUX_AGENT='민'"),
      }),
    );
    const startHeadlessAction = result.data.actions.find(
      (action) => action.label === "Start headless runner",
    );
    expect(startHeadlessAction?.command).not.toContain("--alias codex");
    expect(startHeadlessAction?.command).not.toContain("mac-jun-ssh-tui");
  });

  it("allows explicit auxiliary headless agents without package-bundled private name guards", async () => {
    const result = await readyCommand([
      "--profile",
      "mac-aux-ssh-headless",
      "--agent",
      "준",
      "--comms-dir",
      commsDir,
    ]);

    expect(result.ok).toBe(true);
    expect(result.data.agent).toBe("준");
    expect(result.data.profile).toBe("mac-aux-ssh-headless");
  });

  it("applies a standing headless runner through the reviewed profile command", async () => {
    const runs: Array<{ id: string; command: string; cwd: string }> = [];
    const codexHome = path.join(tmpDir, "codex-home");
    fs.mkdirSync(codexHome, { recursive: true });
    fs.writeFileSync(
      path.join(codexHome, "config.toml"),
      '[sandbox]\nmode = "danger-full-access"\n',
      "utf8",
    );
    process.env.CODEX_HOME = codexHome;
    __setReadyProfileCommandRunnerForTests((profile, cwd) => {
      runs.push({ id: profile.id, command: profile.command, cwd });
      return {
        ok: true,
        status: 0,
        stdout: profile.command.includes("tap-headless-runner-supervisor")
          ? "started: tap-headless-sumback-yoon\n"
          : "started: tap-receiver-yoon\n",
        stderr: "",
      };
    });
    const packageDir = path.join(tmpDir, "packages", "tap-comms");
    fs.mkdirSync(path.join(packageDir, "dist"), { recursive: true });
    fs.writeFileSync(path.join(packageDir, "dist", "cli.mjs"), "", "utf8");
    fs.mkdirSync(path.join(tmpDir, "scripts"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, "scripts", "tap-receiver-supervisor.sh"),
      "#!/usr/bin/env bash\n",
      "utf8",
    );
    fs.writeFileSync(
      path.join(tmpDir, "scripts", "tap-headless-runner-supervisor.sh"),
      "#!/usr/bin/env bash\n",
      "utf8",
    );
    process.chdir(packageDir);
    const expectedRepoRoot = fs.realpathSync(tmpDir);

    const result = await readyCommand([
      "--profile",
      "sumback-yoon",
      "--apply",
      "--apply-headless-runner",
      "--comms-dir",
      commsDir,
    ]);

    expect(runs).toEqual([
      {
        id: "sumback-yoon",
        command: "bash scripts/tap-receiver-supervisor.sh sumback-yoon --tmux",
        cwd: expectedRepoRoot,
      },
      {
        id: "sumback-yoon",
        command:
          "bash scripts/tap-headless-runner-supervisor.sh sumback-yoon --tmux",
        cwd: expectedRepoRoot,
      },
    ]);
    expect(result.data.apply.actions).toContainEqual(
      expect.objectContaining({
        name: "headless-runner",
        status: "applied",
        message:
          "applied headless runner tap-headless-sumback-yoon: started: tap-headless-sumback-yoon",
      }),
    );
  });

  it("applies the sum-back app-server ready profile through the command runner", async () => {
    const runs: Array<{ id: string; command: string }> = [];
    const codexHome = path.join(tmpDir, "codex-home");
    fs.mkdirSync(codexHome, { recursive: true });
    fs.writeFileSync(
      path.join(codexHome, "config.toml"),
      '[sandbox]\nmode = "danger-full-access"\n',
      "utf8",
    );
    process.env.CODEX_HOME = codexHome;
    __setReadyProfileCommandRunnerForTests((profile) => {
      runs.push({ id: profile.id, command: profile.command });
      return {
        ok: true,
        status: 0,
        stdout: "already running: tap-appserver-yoon\n",
        stderr: "",
      };
    });

    const result = await readyCommand([
      "--profile",
      "sumback-yoon-appserver",
      "--apply",
      "--comms-dir",
      commsDir,
    ]);

    expect(runs).toHaveLength(1);
    expect(runs[0]?.id).toBe("sumback-yoon-appserver");
    expect(runs[0]?.command).toContain("tap-appserver-yoon");
    expect(result.data.status).toBe("ready");
    expect(result.data.apply.actions).toContainEqual(
      expect.objectContaining({
        name: "ready-profile",
        status: "applied",
        message:
          "applied ready profile sumback-yoon-appserver: already running: tap-appserver-yoon",
      }),
    );
  });

  it("applies the sum-back bridge ready profile through the command runner", async () => {
    const runs: Array<{ id: string; command: string }> = [];
    const codexHome = path.join(tmpDir, "codex-home");
    fs.mkdirSync(codexHome, { recursive: true });
    fs.writeFileSync(
      path.join(codexHome, "config.toml"),
      '[sandbox]\nmode = "danger-full-access"\n',
      "utf8",
    );
    process.env.CODEX_HOME = codexHome;
    __setReadyProfileCommandRunnerForTests((profile) => {
      runs.push({ id: profile.id, command: profile.command });
      return {
        ok: true,
        status: 0,
        stdout:
          "synced: tap-bridge-recover.sh\nstarted: tap-bridge-sumback pid 123\n",
        stderr: "",
      };
    });

    const result = await readyCommand([
      "--profile",
      "sumback-yoon-bridge",
      "--apply",
      "--comms-dir",
      commsDir,
    ]);

    expect(runs).toHaveLength(1);
    expect(runs[0]?.id).toBe("sumback-yoon-bridge");
    expect(runs[0]?.command).toContain("systemctl --user restart");
    expect(result.data.status).toBe("ready");
    expect(result.data.apply.actions).toContainEqual(
      expect.objectContaining({
        name: "ready-profile",
        status: "applied",
        message: expect.stringContaining(
          "applied ready profile sumback-yoon-bridge",
        ),
      }),
    );
  });

  it("surfaces bridge profile blocked stderr when sync progress was already printed", async () => {
    const codexHome = path.join(tmpDir, "codex-home");
    fs.mkdirSync(codexHome, { recursive: true });
    fs.writeFileSync(
      path.join(codexHome, "config.toml"),
      '[sandbox]\nmode = "danger-full-access"\n',
      "utf8",
    );
    process.env.CODEX_HOME = codexHome;
    __setReadyProfileCommandRunnerForTests(() => ({
      ok: false,
      status: 2,
      stdout: "synced: tap-bridge-recover.sh\n",
      stderr:
        "blocked: bridge heartbeat not ready ageMs=90000 connected=false initialized=false\n",
    }));

    const result = await readyCommand([
      "--profile",
      "sumback-yoon-bridge",
      "--apply",
      "--comms-dir",
      commsDir,
    ]);

    expect(result.data.status).toBe("not-ready");
    expect(result.data.apply.actions).toContainEqual(
      expect.objectContaining({
        name: "ready-profile",
        status: "failed",
        message:
          "failed to start ready profile sumback-yoon-bridge: blocked: bridge heartbeat not ready ageMs=90000 connected=false initialized=false",
      }),
    );
    expect(result.data.apply.actions).not.toContainEqual(
      expect.objectContaining({
        message:
          "failed to start ready profile sumback-yoon-bridge: synced: tap-bridge-recover.sh",
      }),
    );
  });

  it("fails known Codex CLI ready profiles when permission posture is downgraded", async () => {
    const runs: string[] = [];
    const codexHome = path.join(tmpDir, "codex-home");
    fs.mkdirSync(codexHome, { recursive: true });
    fs.writeFileSync(
      path.join(codexHome, "config.toml"),
      '[sandbox]\nmode = "workspace-write"\nnetwork_access = "full"\n',
      "utf8",
    );
    process.env.CODEX_HOME = codexHome;
    __setReadyProfileCommandRunnerForTests((profile) => {
      runs.push(profile.id);
      return { ok: true, status: 0, stdout: "started", stderr: "" };
    });

    const result = await readyCommand([
      "--profile",
      "sumback-yoon",
      "--apply",
      "--comms-dir",
      commsDir,
    ]);

    expect(runs).toEqual([]);
    expect(result.data.status).toBe("not-ready");
    expect(result.data.codexPermissionProfile).toMatchObject({
      status: "downgraded",
      expectedMode: "full",
      sandboxMode: "workspace-write",
    });
    expect(result.data.checks).toContainEqual(
      expect.objectContaining({
        name: "codex-permission-profile",
        status: "fail",
      }),
    );
    expect(result.data.apply.actions).toContainEqual(
      expect.objectContaining({
        name: "ready-profile",
        status: "skipped",
        message: expect.stringContaining("permission profile mismatch"),
      }),
    );
    expect(result.data.actions).not.toContainEqual(
      expect.objectContaining({
        label: "Start ready profile",
      }),
    );
    expect(result.data.next).toContain(
      "restore the Codex permission profile before treating the CLI/TUI surface as ready",
    );
  });

  it("repairs downgraded known Codex CLI profile permissions before applying the ready profile", async () => {
    const runs: string[] = [];
    const codexHome = path.join(tmpDir, "codex-home");
    const configPath = path.join(codexHome, "config.toml");
    fs.mkdirSync(codexHome, { recursive: true });
    fs.writeFileSync(
      configPath,
      '[sandbox]\nmode = "workspace-write"\nnetwork_access = "full"\n',
      "utf8",
    );
    process.env.CODEX_HOME = codexHome;
    __setReadyProfileCommandRunnerForTests((profile) => {
      runs.push(profile.id);
      return { ok: true, status: 0, stdout: "started", stderr: "" };
    });

    const result = await readyCommand([
      "--profile",
      "sumback-yoon",
      "--apply",
      "--repair-permissions",
      "--comms-dir",
      commsDir,
    ]);

    expect(runs).toEqual(["sumback-yoon"]);
    expect(fs.readFileSync(configPath, "utf8")).toContain(
      'mode = "danger-full-access"',
    );
    expect(result.data.status).toBe("ready");
    expect(result.data.codexPermissionProfile).toMatchObject({
      status: "ready",
      expectedMode: "full",
      sandboxMode: "danger-full-access",
    });
    expect(result.data.apply.actions).toContainEqual(
      expect.objectContaining({
        name: "codex-permission-profile",
        status: "applied",
        path: configPath,
        backupPath: expect.stringContaining("config.toml."),
      }),
    );
    const permissionAction = result.data.apply.actions.find(
      (action) => action.name === "codex-permission-profile",
    );
    expect(fs.readFileSync(permissionAction!.backupPath!, "utf8")).toContain(
      'mode = "workspace-write"',
    );
    expect(result.data.apply.actions).toContainEqual(
      expect.objectContaining({
        name: "ready-profile",
        status: "applied",
      }),
    );
  });

  it("repairs missing known Codex CLI profile config before applying the ready profile", async () => {
    const runs: string[] = [];
    const codexHome = path.join(tmpDir, "codex-home");
    const configPath = path.join(codexHome, "config.toml");
    process.env.CODEX_HOME = codexHome;
    __setReadyProfileCommandRunnerForTests((profile) => {
      runs.push(profile.id);
      return { ok: true, status: 0, stdout: "started", stderr: "" };
    });

    const result = await readyCommand([
      "--profile",
      "sumback-yoon",
      "--apply",
      "--repair-permissions",
      "--comms-dir",
      commsDir,
    ]);

    expect(runs).toEqual(["sumback-yoon"]);
    expect(fs.readFileSync(configPath, "utf8")).toContain(
      'mode = "danger-full-access"',
    );
    expect(result.data.status).toBe("ready");
    expect(result.data.codexPermissionProfile).toMatchObject({
      status: "ready",
      configPath,
      expectedMode: "full",
    });
    expect(result.data.apply.actions).toContainEqual(
      expect.objectContaining({
        name: "codex-permission-profile",
        status: "applied",
        path: configPath,
      }),
    );
    const permissionAction = result.data.apply.actions.find(
      (action) => action.name === "codex-permission-profile",
    );
    expect(permissionAction?.backupPath).toBeUndefined();
  });

  it("dry-runs Codex permission repair without writing config or starting the ready profile", async () => {
    const runs: string[] = [];
    const codexHome = path.join(tmpDir, "codex-home");
    const configPath = path.join(codexHome, "config.toml");
    fs.mkdirSync(codexHome, { recursive: true });
    fs.writeFileSync(
      configPath,
      '[sandbox]\nmode = "workspace-write"\nnetwork_access = "full"\n',
      "utf8",
    );
    process.env.CODEX_HOME = codexHome;
    __setReadyProfileCommandRunnerForTests((profile) => {
      runs.push(profile.id);
      return { ok: true, status: 0, stdout: "started", stderr: "" };
    });

    const result = await readyCommand([
      "--profile",
      "sumback-yoon",
      "--apply",
      "--repair-permissions",
      "--dry-run",
      "--comms-dir",
      commsDir,
    ]);

    expect(runs).toEqual([]);
    expect(fs.readFileSync(configPath, "utf8")).toContain(
      'mode = "workspace-write"',
    );
    expect(result.data.status).toBe("not-ready");
    expect(result.data.apply.actions).toContainEqual(
      expect.objectContaining({
        name: "codex-permission-profile",
        status: "would-apply",
        message: expect.stringContaining("would repair"),
      }),
    );
    expect(result.data.apply.actions).toContainEqual(
      expect.objectContaining({
        name: "ready-profile",
        status: "skipped",
      }),
    );
  });

  it("rejects Codex permission repair without explicit apply", async () => {
    const result = await readyCommand([
      "--profile",
      "sumback-yoon",
      "--repair-permissions",
      "--comms-dir",
      commsDir,
    ]);

    expect(result.ok).toBe(false);
    expect(result.code).toBe("TAP_INVALID_ARGUMENT");
    expect(result.message).toContain("requires --apply");
  });

  it("fails closed when a ready profile command fails", async () => {
    const codexHome = path.join(tmpDir, "codex-home");
    fs.mkdirSync(codexHome, { recursive: true });
    fs.writeFileSync(
      path.join(codexHome, "config.toml"),
      '[sandbox]\nmode = "danger-full-access"\n',
      "utf8",
    );
    process.env.CODEX_HOME = codexHome;
    __setReadyProfileCommandRunnerForTests(() => ({
      ok: false,
      status: 42,
      stdout: "",
      stderr: "tmux unavailable",
    }));

    const result = await readyCommand([
      "--profile",
      "sumback-yoon",
      "--apply",
      "--comms-dir",
      commsDir,
    ]);

    expect(result.data.status).toBe("not-ready");
    expect(result.data.apply.actions).toContainEqual(
      expect.objectContaining({
        name: "ready-profile",
        status: "failed",
        message: expect.stringContaining("tmux unavailable"),
      }),
    );
    expect(result.data.checks).toContainEqual(
      expect.objectContaining({
        name: "ready-profile",
        status: "fail",
      }),
    );
  });

  it("uses the sumback-sol profile app-server URL for loaded-thread attach guidance", async () => {
    useFullAccessCodexHome();
    const probes: ProbeCodexCliLoadedThreadReadinessOptions[] = [];
    __setLoadedThreadReadinessProbeForTests(async (options) => {
      probes.push(options);
      return loadedThreadReadiness({
        status: "loaded-idle",
        appServerUrl: options.appServerUrl,
      });
    });

    const result = await readyCommand([
      "--profile",
      "sumback-sol",
      "--comms-dir",
      commsDir,
      "--check-loaded-thread",
    ]);

    expect(probes).toEqual([
      {
        appServerUrl: "ws://127.0.0.1:44587",
        cwd: fs.realpathSync(tmpDir),
        threadId: null,
      },
    ]);
    expect(result.data.loadedThread).toMatchObject({
      status: "loaded-idle",
      appServerUrl: "ws://127.0.0.1:44587",
    });
    expect(result.data.actions).toContainEqual(
      expect.objectContaining({
        label: "Attach visible TUI to loaded-thread profile",
        command: expect.stringContaining("ws://127.0.0.1:44587"),
      }),
    );
  });

  it("rejects ready profile surface and agent mismatches", async () => {
    const wrongSurface = await readyCommand([
      "--profile",
      "remote-panel-yoon",
      "--surface",
      "codex-cli",
      "--comms-dir",
      commsDir,
    ]);
    const wrongAgent = await readyCommand([
      "--profile",
      "sumback-yoon",
      "--agent",
      "준",
      "--comms-dir",
      commsDir,
    ]);

    expect(wrongSurface.ok).toBe(false);
    expect(wrongSurface.code).toBe("TAP_INVALID_ARGUMENT");
    expect(wrongSurface.message).toContain("not codex-cli");
    expect(wrongAgent.ok).toBe(false);
    expect(wrongAgent.code).toBe("TAP_INVALID_ARGUMENT");
    expect(wrongAgent.message).toContain("not 준");
  });

  it("fails closed when an external profile-pack ready command is applied", async () => {
    const profilePackPath = path.join(
      originalCwd,
      "examples",
      "tap-profile-pack.example.json",
    );

    const result = await readyCommand([
      "--profile",
      "local-agent-a-panel",
      "--profile-pack",
      profilePackPath,
      "--surface",
      "remote-panel",
      "--apply",
      "--comms-dir",
      commsDir,
    ]);

    expect(result.ok).toBe(false);
    expect(result.code).toBe("TAP_READY_APPLY_FAILED");
    expect(result.message).toContain("apply failed");
    expect(result.data.status).toBe("blocked");
    expect(result.data.apply.actions).toContainEqual(
      expect.objectContaining({
        name: "ready-profile",
        status: "skipped",
        message: expect.stringContaining("profile-pack commands are loaded"),
      }),
    );
    expect(result.data.checks).toContainEqual(
      expect.objectContaining({
        name: "profile-pack-command-guard",
        status: "block",
      }),
    );
    expect(result.warnings).toContainEqual(
      expect.stringContaining("profile-pack-command-guard"),
    );
  });

  it("dry-runs local readiness setup without creating directories", async () => {
    fs.rmSync(commsDir, { recursive: true, force: true });

    const result = await readyCommand([
      "--surface",
      "codex-cli",
      "--agent",
      "준",
      "--comms-dir",
      commsDir,
      "--apply",
      "--dry-run",
    ]);

    expect(fs.existsSync(commsDir)).toBe(false);
    expect(result.data.status).toBe("not-ready");
    expect(result.data.apply).toMatchObject({
      enabled: true,
      dryRun: true,
    });
    expect(result.data.apply.actions).toContainEqual(
      expect.objectContaining({
        name: "inbox",
        status: "would-apply",
      }),
    );
    expect(result.data.next).toContain(
      `create local inbox directory: ${path.join(commsDir, "inbox")}`,
    );
  });

  it.each(["codex-app", "windows-app"] as const)(
    "does not apply local directories for %s surfaces",
    async (surface) => {
      fs.rmSync(commsDir, { recursive: true, force: true });

      const result = await readyCommand([
        "--surface",
        surface,
        "--agent",
        "코",
        "--conversation-id",
        "thread-ko",
        "--comms-dir",
        commsDir,
        "--apply",
      ]);

      expect(fs.existsSync(commsDir)).toBe(false);
      expect(result.data.receiveTransports).toEqual(["consent-drive"]);
      expect(result.data.apply.actions).toContainEqual(
        expect.objectContaining({
          name: "app-surface-apply",
          status: "skipped",
          message: expect.stringContaining("diagnostic-only"),
        }),
      );
      expect(result.data.apply.actions).not.toContainEqual(
        expect.objectContaining({
          name: "inbox",
          status: "applied",
        }),
      );
      expect(result.data.actions).not.toContainEqual(
        expect.objectContaining({
          label: "Prepare local inbox",
          command: expect.stringContaining(`--surface ${surface}`),
        }),
      );
      expect(result.data.next).not.toContain(
        `create local inbox directory: ${path.join(commsDir, "inbox")}`,
      );
    },
  );

  it("fails Codex App readiness clearly when conversationId is missing", async () => {
    const result = await readyCommand([
      "--surface",
      "codex-app",
      "--agent",
      "코",
      "--comms-dir",
      commsDir,
    ]);

    expect(result.ok).toBe(true);
    expect(result.data.status).toBe("not-ready");
    expect(result.data.receiveTransports).toEqual(["consent-drive"]);
    expect(result.data.next).toContain(
      "rerun with --conversation-id <thread-id>",
    );
    expect(result.warnings.join("\n")).toContain("conversation-id");
  });

  it("reports Codex App ready when fresh consent-drive tuple is observed", async () => {
    writePresence("코", {
      agent: "코",
      timestamp: new Date().toISOString(),
      receiveTransports: ["consent-drive"],
      address: {
        routingAddress: "코",
        conversationId: "thread-ko",
        ownerClientId: "owner-ko",
      },
    });

    const result = await readyCommand([
      "--surface",
      "codex-app",
      "--agent",
      "코",
      "--conversation-id",
      "thread-ko",
      "--comms-dir",
      commsDir,
    ]);

    expect(result.data).toMatchObject({
      status: "ready",
      runtimeHealth: "ready",
      presenceFreshness: "fresh-for-routing",
      presence: {
        exists: true,
        consentDriveStatus: "ready",
        conversationId: "thread-ko",
        ownerClientId: "owner-ko",
      },
    });
  });

  it("diagnoses a fresh Codex App binding with a conversation but no owner as partial", async () => {
    writePresence("준", {
      agent: "준",
      timestamp: new Date().toISOString(),
      receiveTransports: ["consent-drive"],
      address: {
        routingAddress: "준",
        conversationId: "thread-jun",
        ownerClientId: null,
      },
      capabilities: {
        receiveTransports: ["consent-drive"],
        conversationId: "thread-jun",
        ownerClientId: null,
      },
    });

    const result = await readyCommand([
      "--surface",
      "codex-app",
      "--agent",
      "준",
      "--conversation-id",
      "thread-jun",
      "--comms-dir",
      commsDir,
    ]);

    expect(result.data.status).toBe("partial");
    expect(result.data.runtimeHealth).toBe("partial");
    expect(result.data.presence).toMatchObject({
      exists: true,
      consentDriveStatus: "partial",
      conversationId: "thread-jun",
      ownerClientId: null,
    });
    expect(result.data.checks).toContainEqual(
      expect.objectContaining({
        name: "presence-conversation-id",
        status: "pass",
      }),
    );
    expect(result.data.checks).toContainEqual(
      expect.objectContaining({
        name: "owner-client-id",
        status: "warn",
        message: expect.stringContaining("ownerClientId is missing"),
      }),
    );
    expect(result.data.actions).toContainEqual(
      expect.objectContaining({
        label: "Observe target IPC owner discovery",
        command: expect.stringContaining("pnpm --silent codex:desktop"),
      }),
    );
    expect(result.data.next).toContain(
      "focus/open the target Codex App thread, then run warmup from that runtime with owner omitted",
    );
    expect(result.data.next.join("\n")).toContain(
      "observe target IPC owner discovery: pnpm --silent codex:desktop",
    );
  });

  it("blocks Codex App readiness when published runtime health is active-turn", async () => {
    writePresence("코", {
      agent: "코",
      timestamp: new Date().toISOString(),
      receiveTransports: ["consent-drive"],
      address: {
        routingAddress: "코",
        conversationId: "thread-ko",
        ownerClientId: "owner-ko",
      },
      health: {
        status: "active-turn",
      },
    });

    const result = await readyCommand([
      "--surface",
      "codex-app",
      "--agent",
      "코",
      "--conversation-id",
      "thread-ko",
      "--comms-dir",
      commsDir,
    ]);

    expect(result.data.status).toBe("blocked");
    expect(result.data.runtimeHealth).toBe("active-turn");
    expect(result.data.checks).toContainEqual(
      expect.objectContaining({
        name: "runtime-health",
        status: "block",
        message: "runtime health is active-turn",
      }),
    );
    expect(result.warnings.join("\n")).toContain("runtime-health");
    expect(result.data.next).toContain(
      "wait for the target turn to finish before live delivery",
    );
  });

  it("keeps Windows App ready output on the live plus inbox evidence contract", async () => {
    const result = await readyCommand([
      "--surface",
      "windows-app",
      "--agent",
      "코",
      "--conversation-id",
      "thread-ko",
      "--comms-dir",
      commsDir,
    ]);

    expect(result.data.receiveTransports).toEqual(["consent-drive"]);
    expect(result.data.windowsDualLayer).toMatchObject({
      liveAttemptRequired: true,
      inboxEvidenceRequired: true,
      liveAttemptStatus: "not-attempted",
      inboxEvidenceStatus: "required",
    });
    expect(result.data.checks).toContainEqual(
      expect.objectContaining({ name: "windows-dual-layer", status: "pass" }),
    );
  });

  it("dry-runs Windows App route-health without mutating stale presence", async () => {
    writePresence("코", {
      agent: "코",
      timestamp: "2026-06-01T14:18:49.783Z",
      receiveTransports: ["consent-drive"],
      address: {
        routingAddress: "코",
        conversationId: "thread-old",
        ownerClientId: "owner-old",
      },
    });
    const presencePath = path.join(commsDir, "presence", "코.json");
    const before = fs.readFileSync(presencePath, "utf8");
    __setWindowsAppRouteHealthProbeForTests(async () => windowsRouteHealth({}));

    const result = await readyCommand([
      "--surface",
      "windows-app",
      "--agent",
      "코",
      "--conversation-id",
      "thread-live",
      "--comms-dir",
      commsDir,
      "--apply",
      "--dry-run",
    ]);

    expect(fs.readFileSync(presencePath, "utf8")).toBe(before);
    expect(result.data.windowsRouteHealth).toMatchObject({
      status: "stale-presence",
      requestedConversationId: "thread-live",
      presenceConversationId: "thread-old",
      candidates: [
        expect.objectContaining({
          conversationId: "thread-live",
          ownerClientId: "owner-live",
          matchesPresenceConversation: false,
        }),
      ],
    });
    expect(result.data.checks).toContainEqual(
      expect.objectContaining({
        name: "windows-route-health",
        status: "warn",
      }),
    );
    expect(result.data.apply.actions).toContainEqual(
      expect.objectContaining({
        name: "windows-route-health",
        status: "would-apply",
        message: expect.stringContaining("no presence was mutated in dry-run"),
      }),
    );
    expect(result.data.next).toContain(
      "run tap ready --surface windows-app --apply --apply-windows-route-refresh with the selected conversation id to refresh durable presence",
    );
  });

  it("does not trust stale persisted fresh-for-routing Windows presence", async () => {
    writePresence("코", {
      agent: "코",
      timestamp: "2026-06-01T14:18:49.783Z",
      receiveTransports: ["consent-drive"],
      address: {
        routingAddress: "코",
        hostId: "DEVIN",
        conversationId: "thread-live",
        ownerClientId: "owner-live",
      },
      capabilities: {
        receiveTransports: ["consent-drive"],
        conversationId: "thread-live",
        ownerClientId: "owner-live",
      },
      health: { status: "ready" },
      consentDriveStatus: "ready",
      presenceFreshness: "fresh-for-routing",
    });
    let observedPresenceFreshness: string | null = null;
    let observedPresenceAgeMinutes: number | null = null;
    __setWindowsAppRouteHealthProbeForTests(async (options) => {
      observedPresenceFreshness = options.presenceFreshness;
      observedPresenceAgeMinutes = options.presenceAgeMinutes ?? null;
      return windowsRouteHealth({
        presenceConversationId: "thread-live",
        presenceOwnerClientId: "owner-live",
        presenceFreshness: options.presenceFreshness,
        presenceAgeMinutes: options.presenceAgeMinutes,
      });
    });

    const result = await readyCommand([
      "--surface",
      "windows-app",
      "--agent",
      "코",
      "--conversation-id",
      "thread-live",
      "--comms-dir",
      commsDir,
      "--apply",
      "--dry-run",
    ]);

    expect(result.data.presenceFreshness).toBe("stale-visible");
    expect(result.data.presence.consentDriveStatus).toBe("stale");
    expect(result.data.checks).toContainEqual(
      expect.objectContaining({
        name: "presence",
        status: "warn",
        message: expect.stringContaining("older than 30 minutes"),
      }),
    );
    expect(result.data.checks).toContainEqual(
      expect.objectContaining({
        name: "consent-drive",
        status: "warn",
      }),
    );
    expect(observedPresenceFreshness).toBe("stale-visible");
    expect(observedPresenceAgeMinutes).not.toBeNull();
    expect(observedPresenceAgeMinutes!).toBeGreaterThan(30);
  });

  it("applies Windows App route-health refresh to durable presence only with the explicit flag", async () => {
    writePresence("코", {
      agent: "코",
      timestamp: "2026-06-01T14:18:49.783Z",
      receiveTransports: ["consent-drive"],
      address: {
        routingAddress: "코",
        aliases: ["코"],
        conversationId: "thread-old",
        ownerClientId: "owner-old",
      },
      capabilities: {
        receiveTransports: ["polling"],
        conversationId: "thread-old",
        ownerClientId: "owner-old",
      },
      health: { status: "partial" },
      consentDriveStatus: "stale",
      presenceFreshness: "stale-visible",
    });
    const presencePath = path.join(commsDir, "presence", "코.json");
    __setWindowsAppRouteHealthProbeForTests(async () => windowsRouteHealth({}));

    const result = await readyCommand([
      "--surface",
      "windows-app",
      "--agent",
      "코",
      "--conversation-id",
      "thread-live",
      "--comms-dir",
      commsDir,
      "--apply",
      "--apply-windows-route-refresh",
    ]);

    const written = JSON.parse(fs.readFileSync(presencePath, "utf8"));
    expect(written).toMatchObject({
      agent: "코",
      status: "active",
      receiveTransports: ["consent-drive", "polling"],
      address: {
        routingAddress: "코",
        conversationId: "thread-live",
        ownerClientId: "owner-live",
        clientId: "owner-live",
        hostId: "local",
      },
      capabilities: {
        conversationId: "thread-live",
        ownerClientId: "owner-live",
      },
      health: {
        status: "ready",
        source: "tap ready --apply-windows-route-refresh",
      },
      consentDriveStatus: "ready",
      presenceFreshness: "fresh-for-routing",
    });
    expect(new Date(written.timestamp).getTime()).toBeGreaterThan(
      new Date("2026-06-01T14:18:49.783Z").getTime(),
    );
    expect(result.data.apply.actions).toContainEqual(
      expect.objectContaining({
        name: "windows-route-health",
        status: "applied",
        path: presencePath,
        message: expect.stringContaining("thread-live"),
      }),
    );
    expect(result.data.apply.actions).not.toContainEqual(
      expect.objectContaining({
        name: "app-surface-apply",
      }),
    );
    expect(result.data.next).toContain(
      "rerun tap ready --surface windows-app with the selected conversation id to verify the refreshed durable presence",
    );
  });

  it("fails closed when Windows App route-health refresh cannot write durable presence", async () => {
    const presenceDir = path.join(commsDir, "presence");
    const presencePath = path.join(presenceDir, "코.json");
    fs.mkdirSync(presencePath, { recursive: true });
    __setWindowsAppRouteHealthProbeForTests(async () => windowsRouteHealth({}));

    const result = await readyCommand([
      "--surface",
      "windows-app",
      "--agent",
      "코",
      "--conversation-id",
      "thread-live",
      "--comms-dir",
      commsDir,
      "--apply",
      "--apply-windows-route-refresh",
    ]);

    expect(result).toMatchObject({
      ok: false,
      code: "TAP_READY_APPLY_FAILED",
      data: {
        status: "not-ready",
      },
    });
    expect(result.data.apply.actions).toContainEqual(
      expect.objectContaining({
        name: "windows-route-health",
        status: "failed",
        path: presencePath,
        message: expect.stringContaining(
          "failed to refresh Windows App durable presence",
        ),
      }),
    );
    expect(result.data.checks).toContainEqual(
      expect.objectContaining({
        name: "windows-route-health-apply",
        status: "fail",
      }),
    );
    expect(result.data.next).toContain(
      "fix the durable presence write failure before rerunning Windows route readiness",
    );
    expect(result.data.next).not.toContain(
      "rerun tap ready --surface windows-app with the selected conversation id to verify the refreshed durable presence",
    );
  });

  it("rejects Windows App route-health refresh without explicit apply context", async () => {
    await expect(
      readyCommand([
        "--surface",
        "windows-app",
        "--agent",
        "코",
        "--conversation-id",
        "thread-live",
        "--apply-windows-route-refresh",
      ]),
    ).resolves.toMatchObject({
      ok: false,
      code: "TAP_INVALID_ARGUMENT",
      message: "--apply-windows-route-refresh requires --apply.",
    });

    await expect(
      readyCommand([
        "--surface",
        "codex-app",
        "--agent",
        "준",
        "--conversation-id",
        "thread-live",
        "--apply",
        "--apply-windows-route-refresh",
      ]),
    ).resolves.toMatchObject({
      ok: false,
      code: "TAP_INVALID_ARGUMENT",
      message:
        "--apply-windows-route-refresh is only available for --surface windows-app.",
    });

    await expect(
      readyCommand([
        "--surface",
        "windows-app",
        "--agent",
        "코",
        "--apply",
        "--apply-windows-route-refresh",
      ]),
    ).resolves.toMatchObject({
      ok: false,
      code: "TAP_INVALID_ARGUMENT",
      message:
        "--apply-windows-route-refresh requires --conversation-id for explicit live tuple selection.",
    });
  });

  it("does not report Windows App route-health as would-apply without ownerClientId", async () => {
    writePresence("코", {
      agent: "코",
      timestamp: "2026-06-01T14:18:49.783Z",
      receiveTransports: ["consent-drive"],
      address: {
        routingAddress: "코",
        conversationId: "thread-old",
        ownerClientId: "owner-old",
      },
    });
    __setWindowsAppRouteHealthProbeForTests(async () =>
      windowsRouteHealth({
        status: "missing-owner-client",
        message:
          "live Windows App conversation thread-live is missing ownerClientId; durable presence refresh requires conversationId + ownerClientId",
        candidates: [
          {
            conversationId: "thread-live",
            ownerClientId: null,
            hostId: "local",
            lastChangeType: "snapshot",
            lastTurnId: null,
            lastTurnStatus: null,
            hasError: null,
            matchesRequestedConversation: true,
            matchesPresenceConversation: false,
            matchesPresenceOwner: false,
          },
        ],
      }),
    );

    const result = await readyCommand([
      "--surface",
      "windows-app",
      "--agent",
      "코",
      "--conversation-id",
      "thread-live",
      "--comms-dir",
      commsDir,
      "--apply",
      "--dry-run",
    ]);

    expect(result.data.windowsRouteHealth).toMatchObject({
      status: "missing-owner-client",
    });
    expect(result.data.apply.actions).toContainEqual(
      expect.objectContaining({
        name: "windows-route-health",
        status: "skipped",
        message: expect.stringContaining("missing-owner-client"),
      }),
    );
    expect(result.data.apply.actions).not.toContainEqual(
      expect.objectContaining({
        name: "windows-route-health",
        status: "would-apply",
      }),
    );
    expect(result.data.next).toContain(
      "wait for a live Windows App ownerClientId before refreshing durable presence",
    );
  });

  it("does not mutate Windows App durable presence when the live candidate lacks ownerClientId", async () => {
    writePresence("코", {
      agent: "코",
      timestamp: "2026-06-01T14:18:49.783Z",
      receiveTransports: ["consent-drive"],
      address: {
        routingAddress: "코",
        conversationId: "thread-old",
        ownerClientId: "owner-old",
      },
    });
    const presencePath = path.join(commsDir, "presence", "코.json");
    const before = fs.readFileSync(presencePath, "utf8");
    __setWindowsAppRouteHealthProbeForTests(async () =>
      windowsRouteHealth({
        status: "missing-owner-client",
        message:
          "live Windows App conversation thread-live is missing ownerClientId; durable presence refresh requires conversationId + ownerClientId",
        candidates: [
          {
            conversationId: "thread-live",
            ownerClientId: null,
            hostId: "local",
            lastChangeType: "snapshot",
            lastTurnId: null,
            lastTurnStatus: null,
            hasError: null,
            matchesRequestedConversation: true,
            matchesPresenceConversation: false,
            matchesPresenceOwner: false,
          },
        ],
      }),
    );

    const result = await readyCommand([
      "--surface",
      "windows-app",
      "--agent",
      "코",
      "--conversation-id",
      "thread-live",
      "--comms-dir",
      commsDir,
      "--apply",
      "--apply-windows-route-refresh",
    ]);

    expect(fs.readFileSync(presencePath, "utf8")).toBe(before);
    expect(result.data.apply.actions).toContainEqual(
      expect.objectContaining({
        name: "windows-route-health",
        status: "skipped",
        message: expect.stringContaining("missing-owner-client"),
      }),
    );
  });

  it("dry-runs Windows App tuple-scoped live smoke without inbox or IPC mutation", async () => {
    __setWindowsAppRouteHealthProbeForTests(async () =>
      windowsRouteHealth({
        status: "fresh-route-ready",
        message:
          "durable presence matches live Windows App conversation thread-live",
        presenceConversationId: "thread-live",
        presenceOwnerClientId: "owner-live",
        presenceFreshness: "fresh-for-routing",
        candidates: [
          {
            conversationId: "thread-live",
            ownerClientId: "owner-live",
            hostId: "local",
            lastChangeType: "snapshot",
            lastTurnId: null,
            lastTurnStatus: null,
            hasError: null,
            matchesRequestedConversation: true,
            matchesPresenceConversation: true,
            matchesPresenceOwner: true,
          },
        ],
      }),
    );

    const result = await readyCommand([
      "--surface",
      "windows-app",
      "--agent",
      "코",
      "--conversation-id",
      "thread-live",
      "--comms-dir",
      commsDir,
      "--apply",
      "--dry-run",
      "--apply-windows-route-smoke",
      "--smoke-subject",
      "m490 smoke",
      "--smoke-content",
      "hello windows app",
    ]);

    expect(fs.readdirSync(path.join(commsDir, "inbox"))).toHaveLength(0);
    expect(result.data.apply.actions).toContainEqual(
      expect.objectContaining({
        name: "windows-route-smoke",
        status: "would-apply",
      }),
    );
    expect(result.data.windowsDualLayer).toMatchObject({
      liveAttemptStatus: "not-attempted",
      inboxEvidenceStatus: "required",
    });
  });

  it("rejects Windows App route smoke outside explicit bounded apply context", async () => {
    await expect(
      readyCommand([
        "--surface",
        "windows-app",
        "--agent",
        "코",
        "--conversation-id",
        "thread-live",
        "--apply-windows-route-smoke",
        "--smoke-subject",
        "smoke",
        "--smoke-content",
        "hello",
      ]),
    ).resolves.toMatchObject({
      ok: false,
      code: "TAP_INVALID_ARGUMENT",
      message: "--apply-windows-route-smoke requires --apply.",
    });

    await expect(
      readyCommand([
        "--surface",
        "codex-app",
        "--agent",
        "준",
        "--conversation-id",
        "thread-live",
        "--apply",
        "--apply-windows-route-smoke",
        "--smoke-subject",
        "smoke",
        "--smoke-content",
        "hello",
      ]),
    ).resolves.toMatchObject({
      ok: false,
      code: "TAP_INVALID_ARGUMENT",
      message:
        "--apply-windows-route-smoke is only available for --surface windows-app.",
    });

    await expect(
      readyCommand([
        "--surface",
        "windows-app",
        "--agent",
        "코",
        "--conversation-id",
        "thread-live",
        "--apply",
        "--apply-windows-route-smoke",
      ]),
    ).resolves.toMatchObject({
      ok: false,
      code: "TAP_INVALID_ARGUMENT",
      message:
        "--apply-windows-route-smoke requires --smoke-subject and --smoke-content.",
    });

    await expect(
      readyCommand([
        "--surface",
        "windows-app",
        "--agent",
        "코",
        "--conversation-id",
        "thread-live",
        "--apply",
        "--apply-windows-route-refresh",
        "--apply-windows-route-smoke",
        "--smoke-subject",
        "smoke",
        "--smoke-content",
        "hello",
      ]),
    ).resolves.toMatchObject({
      ok: false,
      code: "TAP_INVALID_ARGUMENT",
      message:
        "--apply-windows-route-refresh and --apply-windows-route-smoke must run as separate steps.",
    });
  });

  it("applies Windows App tuple-scoped live smoke after durable inbox evidence", async () => {
    const events: string[] = [];
    __setWindowsAppRouteHealthProbeForTests(async () =>
      windowsRouteHealth({
        status: "fresh-route-ready",
        message:
          "durable presence matches live Windows App conversation thread-live",
        presenceConversationId: "thread-live",
        presenceOwnerClientId: "owner-live",
        presenceFreshness: "fresh-for-routing",
        candidates: [
          {
            conversationId: "thread-live",
            ownerClientId: "owner-live",
            hostId: "local",
            lastChangeType: "snapshot",
            lastTurnId: null,
            lastTurnStatus: null,
            hasError: null,
            matchesRequestedConversation: true,
            matchesPresenceConversation: true,
            matchesPresenceOwner: true,
          },
        ],
      }),
    );
    __setWindowsAppRouteSmokeTransportFactoryForTests(() => ({
      async connect() {
        events.push("connect");
        return {};
      },
      async disconnect() {
        events.push("disconnect");
      },
      createConsentReceipt() {
        events.push("consent");
        return { receipt: { id: "receipt-1" } };
      },
      async startTurn(options) {
        expect(fs.readdirSync(path.join(commsDir, "inbox"))).toHaveLength(1);
        events.push(`start:${options.text}`);
        return {
          response: { result: { turn: { id: "turn-live" } } },
        } as any;
      },
    }));

    const result = await readyCommand([
      "--surface",
      "windows-app",
      "--agent",
      "코",
      "--conversation-id",
      "thread-live",
      "--comms-dir",
      commsDir,
      "--apply",
      "--apply-windows-route-smoke",
      "--smoke-subject",
      "m490 smoke",
      "--smoke-content",
      "hello windows app",
    ]);

    const inboxFiles = fs.readdirSync(path.join(commsDir, "inbox"));
    expect(inboxFiles).toHaveLength(1);
    const written = fs.readFileSync(
      path.join(commsDir, "inbox", inboxFiles[0]),
      "utf8",
    );
    expect(written).toContain("type: inbox");
    expect(written).toContain("action: windows-route-smoke");
    expect(written).toContain('subject: "m490 smoke"');
    expect(written).toContain("hello windows app");
    expect(events).toEqual([
      "connect",
      "consent",
      "start:hello windows app",
      "disconnect",
    ]);
    expect(result).toMatchObject({
      ok: true,
      data: {
        windowsDualLayer: {
          liveAttemptStatus: "delivered",
          inboxEvidenceStatus: "written",
          turnId: "turn-live",
        },
      },
    });
    expect(result.data.apply.actions).toContainEqual(
      expect.objectContaining({
        name: "windows-route-smoke",
        status: "applied",
        evidencePath: `inbox/${inboxFiles[0]}`,
        turnId: "turn-live",
        consentRef: "receipt-1",
      }),
    );
  });

  it("preserves Windows App smoke inbox evidence when the live IPC attempt fails", async () => {
    __setWindowsAppRouteHealthProbeForTests(async () =>
      windowsRouteHealth({
        status: "fresh-route-ready",
        message:
          "durable presence matches live Windows App conversation thread-live",
        presenceConversationId: "thread-live",
        presenceOwnerClientId: "owner-live",
        presenceFreshness: "fresh-for-routing",
        candidates: [
          {
            conversationId: "thread-live",
            ownerClientId: "owner-live",
            hostId: "local",
            lastChangeType: "snapshot",
            lastTurnId: null,
            lastTurnStatus: null,
            hasError: null,
            matchesRequestedConversation: true,
            matchesPresenceConversation: true,
            matchesPresenceOwner: true,
          },
        ],
      }),
    );
    __setWindowsAppRouteSmokeTransportFactoryForTests(() => ({
      async connect() {
        return {};
      },
      async disconnect() {},
      createConsentReceipt() {
        return { receipt: { id: "receipt-1" } };
      },
      async startTurn() {
        throw new Error("ipc unavailable");
      },
    }));

    const result = await readyCommand([
      "--surface",
      "windows-app",
      "--agent",
      "코",
      "--conversation-id",
      "thread-live",
      "--comms-dir",
      commsDir,
      "--apply",
      "--apply-windows-route-smoke",
      "--smoke-subject",
      "m490 smoke",
      "--smoke-content",
      "hello windows app",
    ]);

    const inboxFiles = fs.readdirSync(path.join(commsDir, "inbox"));
    expect(inboxFiles).toHaveLength(1);
    expect(result).toMatchObject({
      ok: false,
      code: "TAP_READY_APPLY_FAILED",
      data: {
        status: "not-ready",
        windowsDualLayer: {
          liveAttemptStatus: "blocked",
          inboxEvidenceStatus: "written",
          evidencePath: `inbox/${inboxFiles[0]}`,
        },
      },
    });
    expect(result.data.apply.actions).toContainEqual(
      expect.objectContaining({
        name: "windows-route-smoke",
        status: "failed",
        evidencePath: `inbox/${inboxFiles[0]}`,
        message: expect.stringContaining("ipc unavailable"),
      }),
    );
  });

  it("models Claude as inbox/channel-capable without requiring consent-drive", async () => {
    const result = await readyCommand([
      "--surface",
      "claude",
      "--agent",
      "령",
      "--comms-dir",
      commsDir,
    ]);

    expect(result.data).toMatchObject({
      surface: "claude",
      receiveTransports: ["polling"],
      status: "ready",
    });
    expect(result.data.receiveTransports).not.toContain("consent-drive");
    expect(result.data.checks).toContainEqual(
      expect.objectContaining({
        name: "receive-transport",
        message: expect.stringContaining("no consent-drive claim"),
      }),
    );
  });

  it("reports remote panel read-only readiness without live delivery claims", async () => {
    const result = await readyCommand([
      "--surface",
      "remote-panel",
      "--agent",
      "윤",
      "--comms-dir",
      commsDir,
    ]);

    expect(result.data).toMatchObject({
      agent: "윤",
      surface: "remote-panel",
      status: "ready",
      receiveTransports: ["polling"],
      runtimeHealth: "ready",
      remotePanel: {
        host: "127.0.0.1",
        port: 8765,
        url: "http://127.0.0.1:8765",
        readOnly: true,
        sendEnabled: false,
        tokenEnv: null,
        liveAttempted: false,
      },
    });
    expect(result.data.receiveTransports).not.toContain("consent-drive");
    expect(result.data.checks).toContainEqual(
      expect.objectContaining({
        name: "remote-panel-mode",
        status: "pass",
        message: expect.stringContaining("read-only remote panel mode"),
      }),
    );
    expect(result.data.actions).toContainEqual(
      expect.objectContaining({
        label: "Start read-only remote panel",
        command: expect.stringContaining("tap remote-panel"),
      }),
    );
    expect(result.data.actions).toContainEqual(
      expect.objectContaining({
        command: expect.stringContaining("--read-only"),
      }),
    );
  });

  it("infers remote panel bind settings from a known profile", async () => {
    const result = await readyCommand([
      "--profile",
      "remote-panel-yoon",
      "--comms-dir",
      commsDir,
    ]);

    expect(result.data).toMatchObject({
      agent: "윤",
      surface: "remote-panel",
      profile: "remote-panel-yoon",
      status: "ready",
      remotePanel: {
        host: "100.121.45.22",
        port: 8765,
        readOnly: true,
        sendEnabled: false,
      },
    });
    expect(result.data.actions).toContainEqual(
      expect.objectContaining({
        label: "Start ready profile",
        command: expect.stringContaining("tap-remote-panel-yoon"),
      }),
    );
    expect(result.data.actions).toContainEqual(
      expect.objectContaining({
        command: expect.stringContaining(
          "mkdir -p /home/devin/hua-platform/.tap-comms/logs &&",
        ),
      }),
    );
  });

  it("requires a populated token env for send-enabled remote panel readiness", async () => {
    const result = await readyCommand([
      "--surface",
      "remote-panel",
      "--agent",
      "윤",
      "--comms-dir",
      commsDir,
      "--send-enabled",
      "--token-env",
      "TAP_REMOTE_PANEL_TOKEN",
    ]);

    expect(result.data.status).toBe("not-ready");
    expect(result.data.remotePanel).toMatchObject({
      sendEnabled: true,
      tokenEnv: "TAP_REMOTE_PANEL_TOKEN",
      liveAttempted: false,
    });
    expect(result.data.checks).toContainEqual(
      expect.objectContaining({
        name: "remote-panel-token",
        status: "fail",
      }),
    );
    expect(result.warnings.join("\n")).toContain("remote-panel-token");
  });

  it("rejects send-enabled remote panel readiness when the token env is too short", async () => {
    process.env.TAP_REMOTE_PANEL_TOKEN = "x";

    const result = await readyCommand([
      "--surface",
      "remote-panel",
      "--agent",
      "윤",
      "--comms-dir",
      commsDir,
      "--send-enabled",
      "--token-env",
      "TAP_REMOTE_PANEL_TOKEN",
    ]);

    expect(result.data.status).toBe("not-ready");
    expect(result.data.checks).toContainEqual(
      expect.objectContaining({
        name: "remote-panel-token",
        status: "fail",
        message: expect.stringContaining("at least 4 characters"),
      }),
    );
    expect(result.data.next).toContain(
      "set a remote panel token/PIN env var with at least 4 characters, then rerun tap ready --surface remote-panel --send-enabled --token-env <env>",
    );
  });

  it("accepts token-gated remote panel send readiness without starting live delivery", async () => {
    process.env.TAP_REMOTE_PANEL_TOKEN = "test-token";

    const result = await readyCommand([
      "--surface",
      "remote-panel",
      "--agent",
      "윤",
      "--comms-dir",
      commsDir,
      "--panel-host",
      "100.121.45.22",
      "--panel-port",
      "8787",
      "--send-enabled",
      "--token-env",
      "TAP_REMOTE_PANEL_TOKEN",
    ]);

    expect(result.data.status).toBe("ready");
    expect(result.data.remotePanel).toMatchObject({
      host: "100.121.45.22",
      port: 8787,
      url: "http://100.121.45.22:8787",
      readOnly: false,
      sendEnabled: true,
      tokenEnv: "TAP_REMOTE_PANEL_TOKEN",
      liveAttempted: false,
    });
    expect(result.data.actions).toContainEqual(
      expect.objectContaining({
        label: "Start token-gated append-only remote panel",
        command: expect.stringContaining(
          "--send-enabled --token-env TAP_REMOTE_PANEL_TOKEN",
        ),
      }),
    );
  });

  it.each(["99999", "0"])(
    "reports invalid remote panel port %s as an operator argument error",
    async (panelPort) => {
      const result = await readyCommand([
        "--surface",
        "remote-panel",
        "--agent",
        "윤",
        "--comms-dir",
        commsDir,
        "--panel-port",
        panelPort,
      ]);

      expect(result.ok).toBe(false);
      expect(result.code).toBe("TAP_INVALID_ARGUMENT");
      expect(result.message).toContain("Invalid --panel-port");
    },
  );

  it("rejects public remote panel bind hosts in readiness diagnostics", async () => {
    const result = await readyCommand([
      "--surface",
      "remote-panel",
      "--agent",
      "윤",
      "--comms-dir",
      commsDir,
      "--panel-host",
      "203.0.113.10",
    ]);

    expect(result.data.status).toBe("not-ready");
    expect(result.data.checks).toContainEqual(
      expect.objectContaining({
        name: "remote-panel-bind",
        status: "fail",
      }),
    );
    expect(result.data.next).toContain(
      "choose a loopback, private LAN, or Tailscale 100.64.0.0/10 bind host for the remote panel",
    );
  });

  it("applies safe remote panel local directories without creating token secrets", async () => {
    fs.rmSync(commsDir, { recursive: true, force: true });

    const result = await readyCommand([
      "--surface",
      "remote-panel",
      "--agent",
      "윤",
      "--comms-dir",
      commsDir,
      "--apply",
    ]);

    expect(result.data.status).toBe("ready");
    expect(fs.existsSync(commsDir)).toBe(true);
    expect(fs.existsSync(path.join(commsDir, "inbox"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, ".tap-comms", "remote-panel"))).toBe(
      true,
    );
    expect(result.data.apply.actions).toContainEqual(
      expect.objectContaining({
        name: "remote-panel-state",
        status: "applied",
      }),
    );
    expect(result.data.apply.actions).not.toContainEqual(
      expect.objectContaining({
        name: "receiver-state",
        status: "applied",
      }),
    );
    expect(process.env.TAP_REMOTE_PANEL_TOKEN).toBeUndefined();
  });
});
