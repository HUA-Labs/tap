import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  __setFlowSupervisorStatusRunnerForTests,
  __setHeadlessRunnerStatusRunnerForTests,
  __setProfileLocalPathExistsForTests,
  __setProfileProbeRunnerForTests,
  statusCommand,
} from "../commands/status.js";
import { version } from "../version.js";

let tmpDir: string;
let originalCwd: string;
let profilePackPath: string;

function probeResult(
  stdout: string,
  status = 0,
): {
  ok: boolean;
  stdout: string;
  stderr: string;
  status: number;
} {
  return {
    ok: status === 0,
    stdout,
    stderr: "",
    status,
  };
}

function writeProfilePack(filePath: string): void {
  fs.writeFileSync(
    filePath,
    JSON.stringify(
      {
        schemaVersion: "tap-profile-pack.v0",
        profiles: [
          {
            id: "sumback-yoon",
            label: "sum-back 윤 CLI/TUI receiver",
            agent: "윤",
            runtimeSurface: "codex-cli",
            sshTarget: "sum-back",
            paths: {
              repoRoot: "/home/devin/hua-platform",
              commsDir: "/home/devin/hua-comms",
            },
            capabilities: { status: true, ready: false, apply: false },
            status: {
              expectedPermissionMode: "full",
              receiverSession: "tap-receiver-yoon",
              receiverLogPath:
                "/home/devin/hua-platform/.tap-comms/logs/tap-receiver-yoon.log",
              supervisorStateName: "sumback-yoon",
              appServerUrl: "ws://127.0.0.1:4501",
              headlessRunner: {
                profile: "sumback-yoon",
                tmuxSession: "tap-headless-sumback-yoon",
                startCommand:
                  "bash scripts/tap-headless-runner-supervisor.sh sumback-yoon --tmux",
                stopCommand:
                  "bash scripts/tap-headless-runner-supervisor.sh sumback-yoon --stop",
                statusCommand:
                  "bash scripts/tap-headless-runner-supervisor.sh sumback-yoon --status",
              },
            },
          },
          {
            id: "mac-jun-ssh-tui",
            label: "Mac 준 SSH/TUI receiver",
            agent: "준",
            runtimeSurface: "codex-cli",
            sshTarget: "sum-mac",
            paths: {
              repoRoot: "/Users/devin/HUA/hua-platform",
              commsDir: "/Users/devin/HUA/hua-comms",
            },
            capabilities: { status: true, ready: false, apply: false },
            status: {
              expectedPermissionMode: "full",
              receiverSession: "tap-receiver-jun-ssh-tui",
              receiverLogPath:
                "/Users/devin/HUA/hua-platform/.tap-comms/logs/tap-receiver-jun-ssh-tui.log",
              supervisorStateName: "mac-jun-ssh-tui",
              appServerUrl: "ws://127.0.0.1:4501",
              flowSupervisors: [
                {
                  id: "mac-jun-projection",
                  label: "sum-back -> Mac 준 projection",
                  host: "sum-back",
                  tmuxSession: "tap-projection-jun",
                  startCommand:
                    "ssh sum-back 'bash scripts/tap-flow-supervisor.sh mac-jun-projection --start'",
                  statusCommand:
                    "ssh sum-back 'bash scripts/tap-flow-supervisor.sh mac-jun-projection --status'",
                },
                {
                  id: "mac-jun-uplink",
                  label: "Mac 준 -> sum-back uplink",
                  host: "sum-back",
                  tmuxSession: "tap-uplink-jun",
                  startCommand:
                    "ssh sum-back 'bash scripts/tap-flow-supervisor.sh mac-jun-uplink --start'",
                  statusCommand:
                    "ssh sum-back 'bash scripts/tap-flow-supervisor.sh mac-jun-uplink --status'",
                },
              ],
              headlessRunner: {
                profile: "mac-jun-ssh-tui",
                tmuxSession: "tap-headless-mac-jun-ssh-tui",
                startCommand:
                  "bash scripts/tap-headless-runner-supervisor.sh mac-jun-ssh-tui --tmux",
                stopCommand:
                  "bash scripts/tap-headless-runner-supervisor.sh mac-jun-ssh-tui --stop",
                statusCommand:
                  "bash scripts/tap-headless-runner-supervisor.sh mac-jun-ssh-tui --status",
              },
            },
          },
          {
            id: "remote-panel-yoon",
            label: "sum-back 윤 remote phone panel",
            agent: "윤",
            runtimeSurface: "remote-panel",
            paths: {
              repoRoot: "/home/devin/hua-platform",
              commsDir: "/home/devin/hua-comms",
            },
            capabilities: { status: true, ready: false, apply: false },
            status: {
              host: "100.121.45.22",
              port: 8765,
              readOnly: true,
              sendEnabled: false,
            },
          },
        ],
      },
      null,
      2,
    ),
    "utf8",
  );
}

function profileArgs(profileId: string): string[] {
  return ["--profile", profileId, "--profile-pack", profilePackPath];
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tap-status-test-"));
  profilePackPath = path.join(tmpDir, "tap-profile-pack.json");
  writeProfilePack(profilePackPath);
  fs.writeFileSync(path.join(tmpDir, "package.json"), "{}", "utf-8");
  fs.mkdirSync(path.join(tmpDir, ".tap-comms"), { recursive: true });
  __setHeadlessRunnerStatusRunnerForTests((runner) =>
    probeResult(`stopped: ${runner.tmuxSession}`),
  );

  originalCwd = process.cwd();
  process.chdir(tmpDir);
});

afterEach(() => {
  process.chdir(originalCwd);
  fs.rmSync(tmpDir, { recursive: true, force: true });
  __setProfileProbeRunnerForTests(null);
  __setProfileLocalPathExistsForTests(null);
  __setFlowSupervisorStatusRunnerForTests(null);
  __setHeadlessRunnerStatusRunnerForTests(null);
  vi.restoreAllMocks();
});

describe("statusCommand", () => {
  it("reports profile readiness with machine-readable checks and next actions", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    __setProfileProbeRunnerForTests(() =>
      probeResult(
        [
          "repoExists=yes",
          "gitExists=yes",
          "commsExists=yes",
          "inboxExists=yes",
          "branch=main",
          "head=abc1234",
          "originMain=abc1234",
          "dirtyCount=0",
          "receiver=running",
          "logExists=yes",
          "inboxCount=7",
          "codexPermissionStatus=ready",
          "codexPermissionConfigPath=/home/devin/.codex/config.toml",
          "codexPermissionExpectedMode=full",
          "codexPermissionSandboxMode=danger-full-access",
          "codexPermissionNetworkAccess=missing",
        ].join("\n"),
      ),
    );

    const result = await statusCommand(profileArgs("sumback-yoon"));

    expect(result.ok).toBe(true);
    expect(result.code).toBe("TAP_STATUS_PROFILE_READY");
    expect(result.data).toMatchObject({
      profile: "sumback-yoon",
      agent: "윤",
      runtimeSurface: "codex-cli",
      status: "ready",
      checks: expect.arrayContaining([
        expect.objectContaining({ name: "repo", status: "pass" }),
        expect.objectContaining({ name: "repo-sync", status: "pass" }),
        expect.objectContaining({ name: "repo-clean", status: "pass" }),
        expect.objectContaining({
          name: "receiver-supervisor",
          status: "pass",
        }),
        expect.objectContaining({ name: "comms-inbox", status: "pass" }),
        expect.objectContaining({
          name: "codex-permission-profile",
          status: "pass",
        }),
        expect.objectContaining({ name: "receiver-log", status: "pass" }),
        expect.objectContaining({
          name: "headless-runner-standing",
          status: "pass",
          message: "tap-headless-sumback-yoon is not running",
        }),
      ]),
      nextActions: expect.arrayContaining([
        expect.objectContaining({
          label: "Start headless runner",
          command: expect.stringContaining(
            "tap-headless-runner-supervisor.sh sumback-yoon --tmux",
          ),
        }),
      ]),
      surfaceGuidance: expect.arrayContaining([
        expect.objectContaining({
          id: "receiver-promoter-backbone",
          summary: expect.stringContaining(
            "durable inbox evidence followed by receiver/promoter gates",
          ),
          nextAction:
            "Use tap receiver check --agent 윤 --json for receiver queue evidence.",
        }),
        expect.objectContaining({
          id: "durable-live-boundary",
          summary: expect.stringContaining(
            "Inbox/projection/uplink evidence is audit and fallback evidence",
          ),
        }),
        expect.objectContaining({
          id: "consent-drive-boundary",
          summary: expect.stringContaining(
            "experimental live adapter and requires fresh route evidence",
          ),
        }),
      ]),
      surfaces: {
        receiverSupervisor: {
          tmuxSession: "tap-receiver-yoon",
          status: "running",
        },
        headlessRunner: {
          profile: "sumback-yoon",
          tmuxSession: "tap-headless-sumback-yoon",
          status: "stopped",
          startCommand: expect.stringContaining(
            "tap-headless-runner-supervisor.sh sumback-yoon --tmux",
          ),
          stopCommand: expect.stringContaining(
            "tap-headless-runner-supervisor.sh sumback-yoon --stop",
          ),
          statusCommand: expect.stringContaining(
            "tap-headless-runner-supervisor.sh sumback-yoon --status",
          ),
        },
      },
    });
  });

  it("keeps blocked profile diagnostics parseable and returns start commands", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    __setProfileLocalPathExistsForTests(() => false);
    __setFlowSupervisorStatusRunnerForTests((supervisor) =>
      probeResult(`stopped: ${supervisor.tmuxSession}`),
    );
    __setProfileProbeRunnerForTests(() =>
      probeResult(
        [
          "repoExists=yes",
          "gitExists=yes",
          "commsExists=yes",
          "inboxExists=yes",
          "branch=main",
          "head=abc1234",
          "originMain=def5678",
          "dirtyCount=0",
          "receiver=stopped",
          "logExists=no",
          "inboxCount=7",
          "codexPermissionStatus=ready",
          "codexPermissionConfigPath=/Users/devin/.codex/config.toml",
          "codexPermissionExpectedMode=full",
          "codexPermissionSandboxMode=danger-full-access",
          "codexPermissionNetworkAccess=missing",
        ].join("\n"),
      ),
    );

    const result = await statusCommand(profileArgs("mac-jun-ssh-tui"));

    expect(result.ok).toBe(true);
    expect(result.code).toBe("TAP_STATUS_PROFILE_BLOCKED");
    expect(result.data).toMatchObject({
      profile: "mac-jun-ssh-tui",
      status: "blocked",
      host: "ssh",
      checks: expect.arrayContaining([
        expect.objectContaining({
          name: "receiver-supervisor",
          status: "fail",
        }),
        expect.objectContaining({
          name: "flow-supervisor-mac-jun-projection",
          status: "fail",
        }),
        expect.objectContaining({
          name: "flow-supervisor-mac-jun-uplink",
          status: "fail",
        }),
        expect.objectContaining({
          name: "repo-sync",
          status: "warn",
        }),
      ]),
      nextActions: expect.arrayContaining([
        expect.objectContaining({
          label: "Sync profile repo",
          command: expect.stringContaining("ssh sum-mac"),
        }),
        expect.objectContaining({
          label: "Start receiver supervisor",
          command: expect.stringContaining("tap-receiver-supervisor.sh"),
        }),
        expect.objectContaining({
          label: "Start sum-back -> Mac 준 projection",
          command: expect.stringContaining("tap-flow-supervisor.sh"),
        }),
        expect.objectContaining({
          label: "Start Mac 준 -> sum-back uplink",
          command: expect.stringContaining("tap-flow-supervisor.sh"),
        }),
        expect.objectContaining({
          label: "Start headless runner",
          command: expect.stringContaining("ssh sum-mac"),
        }),
      ]),
      surfaces: {
        flowSupervisors: expect.arrayContaining([
          expect.objectContaining({
            id: "mac-jun-projection",
            status: "stopped",
            tmuxSession: "tap-projection-jun",
          }),
          expect.objectContaining({
            id: "mac-jun-uplink",
            status: "stopped",
            tmuxSession: "tap-uplink-jun",
          }),
        ]),
        headlessRunner: {
          profile: "mac-jun-ssh-tui",
          status: "stopped",
          tmuxSession: "tap-headless-mac-jun-ssh-tui",
          startCommand: expect.stringContaining("ssh sum-mac"),
          stopCommand: expect.stringContaining("ssh sum-mac"),
          statusCommand: expect.stringContaining("ssh sum-mac"),
        },
      },
    });
  });

  it("probes the Mac 준 profile locally when the Mac checkout exists on the current host", async () => {
    const observedHosts: string[] = [];

    vi.spyOn(console, "log").mockImplementation(() => {});
    __setProfileLocalPathExistsForTests(
      (profile) => profile.id === "mac-jun-ssh-tui",
    );
    __setFlowSupervisorStatusRunnerForTests((supervisor) =>
      probeResult(`running: ${supervisor.tmuxSession}`),
    );
    __setProfileProbeRunnerForTests((_profile, _script, host) => {
      observedHosts.push(host);
      return probeResult(
        [
          "repoExists=yes",
          "gitExists=yes",
          "commsExists=yes",
          "inboxExists=yes",
          "branch=main",
          "head=abc1234",
          "originMain=def5678",
          "dirtyCount=0",
          "receiver=running",
          "logExists=yes",
          "inboxCount=7",
          "codexPermissionStatus=ready",
          "codexPermissionConfigPath=/Users/devin/.codex/config.toml",
          "codexPermissionExpectedMode=full",
          "codexPermissionSandboxMode=danger-full-access",
          "codexPermissionNetworkAccess=missing",
        ].join("\n"),
      );
    });

    const result = await statusCommand(profileArgs("mac-jun-ssh-tui"));

    expect(observedHosts).toEqual(["local"]);
    expect(result.ok).toBe(true);
    expect(result.code).toBe("TAP_STATUS_PROFILE_DEGRADED");
    expect(result.data).toMatchObject({
      profile: "mac-jun-ssh-tui",
      host: "local",
      checks: expect.arrayContaining([
        expect.objectContaining({
          name: "receiver-supervisor",
          status: "pass",
        }),
        expect.objectContaining({
          name: "flow-supervisor-mac-jun-projection",
          status: "pass",
        }),
        expect.objectContaining({
          name: "flow-supervisor-mac-jun-uplink",
          status: "pass",
        }),
      ]),
      nextActions: expect.arrayContaining([
        expect.objectContaining({
          label: "Sync profile repo",
          command: expect.not.stringContaining("ssh sum-mac"),
        }),
      ]),
      surfaces: {
        flowSupervisors: expect.arrayContaining([
          expect.objectContaining({
            id: "mac-jun-projection",
            host: "sum-back",
            statusCommand: expect.stringContaining("ssh sum-back"),
            startCommand: expect.stringContaining("ssh sum-back"),
          }),
          expect.objectContaining({
            id: "mac-jun-uplink",
            host: "sum-back",
            statusCommand: expect.stringContaining("ssh sum-back"),
            startCommand: expect.stringContaining("ssh sum-back"),
          }),
        ]),
      },
    });
  });

  it("blocks a Codex CLI profile when permission posture is downgraded", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    __setProfileProbeRunnerForTests(() =>
      probeResult(
        [
          "repoExists=yes",
          "gitExists=yes",
          "commsExists=yes",
          "inboxExists=yes",
          "branch=main",
          "head=abc1234",
          "originMain=abc1234",
          "dirtyCount=0",
          "receiver=running",
          "logExists=yes",
          "inboxCount=7",
          "codexPermissionStatus=downgraded",
          "codexPermissionConfigPath=/home/devin/.codex/config.toml",
          "codexPermissionExpectedMode=full",
          "codexPermissionSandboxMode=workspace-write",
          "codexPermissionNetworkAccess=full",
        ].join("\n"),
      ),
    );

    const result = await statusCommand(profileArgs("sumback-yoon"));

    expect(result.ok).toBe(true);
    expect(result.code).toBe("TAP_STATUS_PROFILE_BLOCKED");
    expect(result.data).toMatchObject({
      profile: "sumback-yoon",
      status: "blocked",
      checks: expect.arrayContaining([
        expect.objectContaining({
          name: "receiver-supervisor",
          status: "pass",
        }),
        expect.objectContaining({
          name: "codex-permission-profile",
          status: "fail",
          message: expect.stringContaining("expected=full"),
        }),
      ]),
      nextActions: expect.arrayContaining([
        expect.objectContaining({
          label: "Inspect Codex permission profile",
          command: expect.stringContaining("config.toml"),
        }),
      ]),
    });
  });

  it("fails clearly for unknown status profiles", async () => {
    const result = await statusCommand(["--profile", "windows-ko-app"]);

    expect(result.ok).toBe(false);
    expect(result.code).toBe("TAP_STATUS_UNKNOWN_PROFILE");
    expect(result.data).toMatchObject({
      knownProfiles: [],
    });
    expect(result.warnings).toContain(
      "Use a reviewed local status profile id.",
    );
  });

  it("reports the remote panel profile as blocked when the panel is not listening", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    __setProfileProbeRunnerForTests(() =>
      probeResult(
        [
          "repoExists=yes",
          "gitExists=yes",
          "commsExists=yes",
          "inboxExists=yes",
          "branch=main",
          "head=abc1234",
          "originMain=abc1234",
          "dirtyCount=0",
          "inboxCount=7",
          "tokenLength=unknown",
          "remotePanelListening=no",
          "remotePanelStatus=not-listening",
          "remotePanelReadOnly=unknown",
          "remotePanelSendEnabled=unknown",
          "remotePanelPendingCount=unknown",
          "remotePanelRecentCount=unknown",
        ].join("\n"),
      ),
    );

    const result = await statusCommand(profileArgs("remote-panel-yoon"));

    expect(result.ok).toBe(true);
    expect(result.code).toBe("TAP_STATUS_PROFILE_BLOCKED");
    expect(result.data).toMatchObject({
      profile: "remote-panel-yoon",
      agent: "윤",
      runtimeSurface: "remote-panel",
      status: "blocked",
      checks: expect.arrayContaining([
        expect.objectContaining({
          name: "remote-panel-http",
          status: "fail",
        }),
        expect.objectContaining({
          name: "remote-panel-mode",
          status: "pass",
        }),
      ]),
      surfaces: {
        remotePanel: {
          host: "100.121.45.22",
          port: 8765,
          url: "http://100.121.45.22:8765",
          readOnly: true,
          sendEnabled: false,
          tokenEnv: null,
          status: "not-listening",
          listening: false,
        },
      },
      nextActions: expect.arrayContaining([
        expect.objectContaining({
          label: "Start remote panel",
          command: expect.stringContaining("remote-panel"),
        }),
      ]),
    });
    expect(result.data.nextActions).toContainEqual(
      expect.objectContaining({
        command: expect.stringContaining("--read-only"),
      }),
    );
  });

  it("reports the remote panel profile as ready when the snapshot is reachable", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    __setProfileProbeRunnerForTests(() =>
      probeResult(
        [
          "repoExists=yes",
          "gitExists=yes",
          "commsExists=yes",
          "inboxExists=yes",
          "branch=main",
          "head=abc1234",
          "originMain=abc1234",
          "dirtyCount=0",
          "inboxCount=7",
          "tokenLength=unknown",
          "remotePanelListening=yes",
          "remotePanelStatus=read-only",
          "remotePanelReadOnly=yes",
          "remotePanelSendEnabled=no",
          "remotePanelPendingCount=2",
          "remotePanelRecentCount=5",
        ].join("\n"),
      ),
    );

    const result = await statusCommand(profileArgs("remote-panel-yoon"));

    expect(result.ok).toBe(true);
    expect(result.code).toBe("TAP_STATUS_PROFILE_READY");
    expect(result.data).toMatchObject({
      profile: "remote-panel-yoon",
      runtimeSurface: "remote-panel",
      status: "ready",
      checks: expect.arrayContaining([
        expect.objectContaining({
          name: "remote-panel-http",
          status: "pass",
          message: expect.stringContaining("pending=2"),
        }),
      ]),
      nextActions: [],
      surfaces: {
        remotePanel: {
          status: "read-only",
          listening: true,
        },
      },
    });
  });

  it("blocks the read-only remote panel profile when the running panel is send-enabled", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    __setProfileProbeRunnerForTests(() =>
      probeResult(
        [
          "repoExists=yes",
          "gitExists=yes",
          "commsExists=yes",
          "inboxExists=yes",
          "branch=main",
          "head=abc1234",
          "originMain=abc1234",
          "dirtyCount=0",
          "inboxCount=7",
          "tokenLength=8",
          "remotePanelListening=yes",
          "remotePanelStatus=send-enabled",
          "remotePanelReadOnly=no",
          "remotePanelSendEnabled=yes",
          "remotePanelPendingCount=0",
          "remotePanelRecentCount=5",
        ].join("\n"),
      ),
    );

    const result = await statusCommand(profileArgs("remote-panel-yoon"));

    expect(result.ok).toBe(true);
    expect(result.code).toBe("TAP_STATUS_PROFILE_BLOCKED");
    expect(result.data).toMatchObject({
      profile: "remote-panel-yoon",
      status: "blocked",
      checks: expect.arrayContaining([
        expect.objectContaining({
          name: "remote-panel-http",
          status: "fail",
          message: expect.stringContaining("mode mismatch"),
        }),
        expect.objectContaining({
          name: "remote-panel-snapshot",
          status: "pass",
          message: expect.stringContaining("status=send-enabled"),
        }),
      ]),
      nextActions: expect.arrayContaining([
        expect.objectContaining({
          label: "Restart remote panel with profile mode",
          command: expect.stringContaining("--read-only"),
        }),
      ]),
    });
  });

  it("reports the current package version instead of stale state metadata", async () => {
    const state = {
      schemaVersion: 2,
      createdAt: "2026-03-24T00:00:00.000Z",
      updatedAt: "2026-03-24T00:00:00.000Z",
      commsDir: path.join(tmpDir, "tap-comms"),
      repoRoot: tmpDir,
      packageVersion: "stale-version",
      instances: {},
    };

    fs.writeFileSync(
      path.join(tmpDir, ".tap-comms", "state.json"),
      JSON.stringify(state, null, 2),
      "utf-8",
    );

    vi.spyOn(console, "log").mockImplementation(() => {});

    const result = await statusCommand([]);

    expect(result.ok).toBe(true);
    expect(result.data).toHaveProperty("version", version);
  });

  it("surfaces app-server lifecycle for degraded saved-thread bridges", async () => {
    const runtimeStateDir = path.join(tmpDir, ".tap-comms", ".tmp", "codex");
    fs.mkdirSync(path.join(tmpDir, ".tap-comms", "pids"), { recursive: true });
    fs.mkdirSync(runtimeStateDir, { recursive: true });

    const bridgeState = {
      pid: process.pid,
      statePath: path.join(tmpDir, ".tap-comms", "pids", "bridge-codex.json"),
      lastHeartbeat: "2026-03-24T00:00:00.000Z",
      runtimeStateDir,
    };
    const state = {
      schemaVersion: 3,
      createdAt: "2026-03-24T00:00:00.000Z",
      updatedAt: "2026-03-24T00:00:00.000Z",
      commsDir: path.join(tmpDir, "tap-comms"),
      repoRoot: tmpDir,
      packageVersion: version,
      instances: {
        codex: {
          instanceId: "codex",
          runtime: "codex",
          agentName: "솔",
          port: 4501,
          installed: true,
          configPath: "",
          bridgeMode: "app-server",
          restartRequired: false,
          ownedArtifacts: [],
          backupPath: "",
          lastAppliedHash: "",
          lastVerifiedAt: "2026-03-24T00:00:00.000Z",
          bridge: bridgeState,
          headless: null,
          warnings: [],
        },
      },
    };

    fs.writeFileSync(
      path.join(tmpDir, ".tap-comms", "state.json"),
      JSON.stringify(state, null, 2),
      "utf-8",
    );
    fs.writeFileSync(
      bridgeState.statePath,
      JSON.stringify(bridgeState, null, 2),
      "utf-8",
    );
    fs.writeFileSync(
      path.join(runtimeStateDir, "heartbeat.json"),
      JSON.stringify(
        {
          updatedAt: "2026-03-24T00:00:02.000Z",
          connected: false,
          initialized: true,
          threadId: null,
        },
        null,
        2,
      ),
      "utf-8",
    );
    fs.writeFileSync(
      path.join(runtimeStateDir, "thread.json"),
      JSON.stringify(
        {
          threadId: "thread_saved",
          cwd: tmpDir,
        },
        null,
        2,
      ),
      "utf-8",
    );

    vi.spyOn(console, "log").mockImplementation(() => {});

    const result = await statusCommand([]);

    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      instances: {
        codex: {
          status: "active",
          lifecycle: {
            presence: "bridge-live",
            status: "degraded-no-thread",
            savedThreadId: "thread_saved",
          },
          session: {
            status: "disconnected",
            turnState: "disconnected",
          },
        },
      },
    });
  });

  it("marks stopped bridge state as dispatch-live when fresh bridge-dispatch evidence exists", async () => {
    const commsDir = path.join(tmpDir, "tap-comms");
    fs.mkdirSync(commsDir, { recursive: true });

    const state = {
      schemaVersion: 3,
      createdAt: "2026-03-24T00:00:00.000Z",
      updatedAt: "2026-03-24T00:00:00.000Z",
      commsDir,
      repoRoot: tmpDir,
      packageVersion: version,
      instances: {
        codex: {
          instanceId: "codex",
          runtime: "codex",
          agentName: "솔",
          port: 4501,
          installed: true,
          configPath: "",
          bridgeMode: "app-server",
          restartRequired: false,
          ownedArtifacts: [],
          backupPath: "",
          lastAppliedHash: "",
          lastVerifiedAt: "2026-03-24T00:00:00.000Z",
          bridge: null,
          headless: null,
          warnings: [],
        },
      },
    };

    fs.writeFileSync(
      path.join(tmpDir, ".tap-comms", "state.json"),
      JSON.stringify(state, null, 2),
      "utf-8",
    );
    fs.writeFileSync(
      path.join(commsDir, "heartbeats.json"),
      JSON.stringify(
        {
          codex: {
            id: "codex",
            agent: "솔",
            timestamp: new Date().toISOString(),
            lastActivity: new Date().toISOString(),
            status: "active",
            source: "bridge-dispatch",
            instanceId: "codex",
            bridgePid: process.pid,
            connectHash: "instance:codex",
          },
        },
        null,
        2,
      ),
      "utf-8",
    );

    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await statusCommand([]);

    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      instances: {
        codex: {
          status: "dispatch-live",
          lifecycle: {
            status: "stopped",
          },
          session: {
            status: "initializing",
          },
          warnings: [
            expect.stringContaining("fresh bridge-dispatch heartbeat from PID"),
          ],
        },
      },
    });
  });

  it("matches live dispatch evidence by default agent name aliases", async () => {
    const commsDir = path.join(tmpDir, "tap-comms");
    fs.mkdirSync(commsDir, { recursive: true });

    const state = {
      schemaVersion: 3,
      createdAt: "2026-05-03T00:00:00.000Z",
      updatedAt: "2026-05-03T00:00:00.000Z",
      commsDir,
      repoRoot: tmpDir,
      packageVersion: version,
      instances: {
        codex: {
          instanceId: "codex",
          runtime: "codex",
          defaultAgentName: "윤",
          agentName: "윤",
          port: 4501,
          installed: true,
          configPath: "",
          bridgeMode: "app-server",
          restartRequired: false,
          ownedArtifacts: [],
          backupPath: "",
          lastAppliedHash: "",
          lastVerifiedAt: "2026-05-03T00:00:00.000Z",
          bridge: null,
          headless: null,
          warnings: [],
        },
      },
    };

    fs.writeFileSync(
      path.join(tmpDir, ".tap-comms", "state.json"),
      JSON.stringify(state, null, 2),
      "utf-8",
    );
    fs.writeFileSync(
      path.join(commsDir, "heartbeats.json"),
      JSON.stringify(
        {
          윤: {
            id: "윤",
            agent: "윤",
            timestamp: new Date().toISOString(),
            lastActivity: new Date().toISOString(),
            status: "active",
            source: "bridge-dispatch",
            instanceId: "윤",
            bridgePid: process.pid,
            connectHash: "instance:윤",
            address: {
              routingAddress: "윤",
              aliases: ["윤"],
            },
          },
        },
        null,
        2,
      ),
      "utf-8",
    );

    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await statusCommand([]);

    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      instances: {
        codex: {
          status: "dispatch-live",
          warnings: [
            expect.stringContaining("fresh bridge-dispatch heartbeat from PID"),
          ],
        },
      },
    });
  });

  it("does not match live dispatch evidence by a non-unique agent name alias", async () => {
    const commsDir = path.join(tmpDir, "tap-comms");
    fs.mkdirSync(commsDir, { recursive: true });

    const duplicateBase = {
      runtime: "codex",
      agentName: "윤",
      port: 4501,
      installed: true,
      configPath: "",
      bridgeMode: "app-server",
      restartRequired: false,
      ownedArtifacts: [],
      backupPath: "",
      lastAppliedHash: "",
      lastVerifiedAt: "2026-05-03T00:00:00.000Z",
      bridge: null,
      headless: null,
      warnings: [],
    };
    const state = {
      schemaVersion: 3,
      createdAt: "2026-05-03T00:00:00.000Z",
      updatedAt: "2026-05-03T00:00:00.000Z",
      commsDir,
      repoRoot: tmpDir,
      packageVersion: version,
      instances: {
        codex: {
          ...duplicateBase,
          instanceId: "codex",
          defaultAgentName: "윤",
        },
        "codex-review": {
          ...duplicateBase,
          instanceId: "codex-review",
          defaultAgentName: "윤",
          port: 4502,
        },
      },
    };

    fs.writeFileSync(
      path.join(tmpDir, ".tap-comms", "state.json"),
      JSON.stringify(state, null, 2),
      "utf-8",
    );
    fs.writeFileSync(
      path.join(commsDir, "heartbeats.json"),
      JSON.stringify(
        {
          윤: {
            id: "윤",
            agent: "윤",
            timestamp: new Date().toISOString(),
            lastActivity: new Date().toISOString(),
            status: "active",
            source: "bridge-dispatch",
            instanceId: "윤",
            bridgePid: process.pid,
            connectHash: "instance:윤",
            address: {
              routingAddress: "윤",
              aliases: ["윤"],
            },
          },
        },
        null,
        2,
      ),
      "utf-8",
    );

    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await statusCommand([]);

    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      instances: {
        codex: {
          status: "configured",
          warnings: [],
        },
        "codex-review": {
          status: "configured",
          warnings: [],
        },
      },
    });
  });

  it("prefers live dispatch evidence over stale bridge metadata on the first status call", async () => {
    const commsDir = path.join(tmpDir, "tap-comms");
    const bridgeStatePath = path.join(
      tmpDir,
      ".tap-comms",
      "pids",
      "bridge-codex.json",
    );
    const bridgeState = {
      pid: 999999,
      statePath: bridgeStatePath,
      lastHeartbeat: "2026-03-24T00:00:00.000Z",
      runtimeStateDir: path.join(tmpDir, ".tap-comms", ".tmp", "codex"),
    };
    fs.mkdirSync(path.dirname(bridgeStatePath), { recursive: true });
    fs.mkdirSync(bridgeState.runtimeStateDir, { recursive: true });
    fs.mkdirSync(commsDir, { recursive: true });

    const state = {
      schemaVersion: 3,
      createdAt: "2026-03-24T00:00:00.000Z",
      updatedAt: "2026-03-24T00:00:00.000Z",
      commsDir,
      repoRoot: tmpDir,
      packageVersion: version,
      instances: {
        codex: {
          instanceId: "codex",
          runtime: "codex",
          agentName: "솔",
          port: 4501,
          installed: true,
          configPath: "",
          bridgeMode: "app-server",
          restartRequired: false,
          ownedArtifacts: [],
          backupPath: "",
          lastAppliedHash: "",
          lastVerifiedAt: "2026-03-24T00:00:00.000Z",
          bridge: bridgeState,
          headless: null,
          warnings: [],
        },
      },
    };

    fs.writeFileSync(
      path.join(tmpDir, ".tap-comms", "state.json"),
      JSON.stringify(state, null, 2),
      "utf-8",
    );
    fs.writeFileSync(
      bridgeStatePath,
      JSON.stringify(bridgeState, null, 2),
      "utf-8",
    );
    fs.writeFileSync(
      path.join(commsDir, "heartbeats.json"),
      JSON.stringify(
        {
          codex: {
            id: "codex",
            agent: "솔",
            timestamp: new Date().toISOString(),
            lastActivity: new Date().toISOString(),
            status: "active",
            source: "bridge-dispatch",
            instanceId: "codex",
            bridgePid: process.pid,
            connectHash: "instance:codex",
          },
        },
        null,
        2,
      ),
      "utf-8",
    );

    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await statusCommand([]);

    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      instances: {
        codex: {
          status: "dispatch-live",
          lifecycle: {
            status: "stopped",
          },
          session: {
            status: "initializing",
          },
          warnings: [
            expect.stringContaining("fresh bridge-dispatch heartbeat from PID"),
          ],
        },
      },
    });
    const persisted = JSON.parse(
      fs.readFileSync(path.join(tmpDir, ".tap-comms", "state.json"), "utf-8"),
    ) as {
      instances: {
        codex: {
          bridge: unknown;
        };
      };
    };
    expect(persisted.instances.codex.bridge).toBeNull();
  });
});
