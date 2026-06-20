import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  __setCommsDoctorAppRouteFreshnessRunnerForTests,
  commsDoctorCommand,
} from "../commands/comms-doctor.js";
import {
  AGENT_PROFILES,
  type ProfileConfig,
} from "../commands/status-profiles.js";
import type { CommandResult } from "../types.js";

let tmpDir: string;
let commsDir: string;
let stateDir: string;

function writePresence(agent: string, record: Record<string, unknown>): void {
  const presenceDir = path.join(commsDir, "presence");
  fs.mkdirSync(presenceDir, { recursive: true });
  fs.writeFileSync(
    path.join(presenceDir, `${agent}.json`),
    JSON.stringify(record, null, 2),
    "utf8",
  );
}

function writeRouteLease(
  agent: string,
  overrides: Record<string, unknown> = {},
): void {
  const leaseDir = path.join(commsDir, "route-leases");
  fs.mkdirSync(leaseDir, { recursive: true });
  fs.writeFileSync(
    path.join(leaseDir, `${agent}.json`),
    JSON.stringify(
      {
        schemaVersion: 1,
        agentId: agent,
        agent,
        source: "tap_session_warmup",
        registeredAt: new Date(Date.now() - 60_000).toISOString(),
        updatedAt: new Date(Date.now() - 60_000).toISOString(),
        expiresAt: new Date(Date.now() + 23 * 60 * 60_000).toISOString(),
        status: "idle",
        receiveTransports: ["consent-drive"],
        route: {
          hostId: "DEVIN",
          conversationId: "thread-stable",
          ownerClientId: "owner-stable",
          routingAddress: agent,
        },
        capability: {
          conversationId: "thread-stable",
          ownerClientId: "owner-stable",
        },
        liveAuthority: false,
        liveAuthorityNote:
          "Route lease preserves stable registration only; live delivery must still re-check current runtime health and presence freshness.",
        ...overrides,
      },
      null,
      2,
    ),
    "utf8",
  );
}

function writeEvidence(
  relativePath: string,
  frontmatter: Record<string, string | boolean>,
  body = "evidence body",
): string {
  const filePath = path.join(tmpDir, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const yaml = Object.entries(frontmatter)
    .map(([key, value]) => `${key}: ${String(value)}`)
    .join("\n");
  fs.writeFileSync(filePath, `---\n${yaml}\n---\n\n${body}\n`, "utf8");
  return filePath;
}

function appResult(options: {
  status?: string;
  classification?: string;
  routeHealthStatus?: string;
  transport?: string;
  liveAttemptStatus?: string;
  fallbackToInbox?: boolean;
}): CommandResult<Record<string, unknown>> {
  return {
    ok: true,
    command: "app-route-freshness",
    code: "TAP_APP_ROUTE_FRESHNESS_OK",
    message: `tap app-route-freshness: ${options.status ?? "ready"}`,
    warnings: [],
    data: {
      status: options.status ?? "ready",
      classification: options.classification ?? "fresh-ready",
      recovery: {
        status: "ready",
        classification: options.classification ?? "fresh-ready",
        routeHealthStatus: options.routeHealthStatus ?? "fresh-route-ready",
        proof: {
          transport: options.transport ?? "consent-drive",
          liveAttemptStatus: options.liveAttemptStatus ?? "would-attempt",
          fallbackToInbox: options.fallbackToInbox ?? false,
          reason: "structured route proof ready",
        },
      },
    },
  };
}

function writeSchedulerLock(startedAt = new Date().toISOString()): string {
  const schedulerDir = path.join(stateDir, "app-route-freshness");
  fs.mkdirSync(schedulerDir, { recursive: true });
  const lockPath = path.join(schedulerDir, "windows-app-솔.lock.json");
  fs.writeFileSync(
    lockPath,
    JSON.stringify(
      {
        pid: 1234,
        agent: "솔",
        profile: "windows-app-sol",
        startedAt,
      },
      null,
      2,
    ),
    "utf8",
  );
  return lockPath;
}

function writeSchedulerState(overrides: Record<string, unknown> = {}): void {
  const schedulerDir = path.join(stateDir, "app-route-freshness");
  fs.mkdirSync(schedulerDir, { recursive: true });
  const lockPath = path.join(schedulerDir, "windows-app-솔.lock.json");
  const workerOverride =
    overrides.worker && typeof overrides.worker === "object"
      ? (overrides.worker as Record<string, unknown>)
      : {};
  fs.writeFileSync(
    path.join(schedulerDir, "windows-app-솔.json"),
    JSON.stringify(
      {
        schemaVersion: 1,
        profile: "windows-app-솔",
        agent: "솔",
        updatedAt: new Date().toISOString(),
        lastRunAt: new Date().toISOString(),
        lastStatus: "ready",
        lastClassification: "fresh-ready",
        lastRefreshAt: new Date().toISOString(),
        routeAgeSeconds: 10,
        nextRefreshAt: new Date(Date.now() + 10 * 60_000).toISOString(),
        ...overrides,
        worker: {
          enabled: true,
          lockPath,
          status: "acquired",
          owner: {
            pid: 1234,
            agent: "솔",
            profile: "windows-app-솔",
          },
          message: "worker-of-record lock acquired",
          ...workerOverride,
        },
      },
      null,
      2,
    ),
    "utf8",
  );
}

function writeStandingScheduler(): void {
  writeSchedulerState();
  writeSchedulerLock();
}

function baseArgs(...extra: string[]): string[] {
  return [
    "--comms-dir",
    commsDir,
    "--state-dir",
    stateDir,
    "--scan-inbox",
    "0",
    ...extra,
  ];
}

function installStatusProfileFixtures(): void {
  Object.assign(AGENT_PROFILES, {
    "sumback-yoon": {
      kind: "codex-cli",
      id: "sumback-yoon",
      label: "sum-back 윤 CLI/TUI receiver",
      agent: "윤",
      runtimeSurface: "codex-cli",
      expectedPermissionMode: "full",
      repoRoot: "/home/devin/hua-platform",
      commsDir: "/home/devin/hua-comms",
      receiverSession: "tap-receiver-yoon",
      receiverLogPath:
        "/home/devin/hua-platform/.tap-comms/logs/receiver-supervisor-sumback-yoon.log",
      supervisorStateName: "m463-live-sumback-yoon-main-supervisor",
      appServerUrl: "ws://127.0.0.1:35089",
    },
    "sumback-sol": {
      kind: "codex-cli",
      id: "sumback-sol",
      label: "sum-back 솔 CLI/TUI receiver",
      agent: "솔",
      runtimeSurface: "codex-cli",
      expectedPermissionMode: "full",
      repoRoot: "/home/devin/hua-platform",
      commsDir: "/home/devin/hua-comms",
      receiverSession: "tap-receiver-sol",
      receiverLogPath:
        "/home/devin/hua-platform/.tap-comms/logs/receiver-supervisor-sumback-sol.log",
      supervisorStateName: "m463-sumback-sol-supervisor",
      appServerUrl: "ws://127.0.0.1:44587",
    },
    "mac-jun-ssh-tui": {
      kind: "codex-cli",
      id: "mac-jun-ssh-tui",
      label: "sum-mac 준 SSH TUI receiver",
      agent: "준",
      runtimeSurface: "codex-cli",
      expectedPermissionMode: "full",
      repoRoot: "/Users/devin/HUA/hua-platform",
      commsDir: "/Users/devin/HUA/hua-comms",
      receiverSession: "tap-receiver-jun-ssh-tui",
      receiverLogPath:
        "/Users/devin/HUA/hua-platform/.tap-comms/logs/receiver-supervisor-mac-jun-ssh-tui.log",
      supervisorStateName: "m463-mac-jun-ssh-tui-supervisor",
      appServerUrl: "ws://127.0.0.1:35089",
      flowSupervisors: [
        {
          id: "mac-jun-projection",
          label: "sum-back -> Mac 준 projection",
          host: "sum-back",
          tmuxSession: "tap-projection-jun",
          statusCommand:
            "cd /home/devin/hua-platform && bash scripts/tap-flow-supervisor.sh mac-jun-projection --status",
          startCommand:
            "cd /home/devin/hua-platform && bash scripts/tap-flow-supervisor.sh mac-jun-projection --tmux",
        },
        {
          id: "mac-jun-uplink",
          label: "Mac 준 -> sum-back uplink",
          host: "sum-back",
          tmuxSession: "tap-uplink-jun",
          statusCommand:
            "cd /home/devin/hua-platform && bash scripts/tap-flow-supervisor.sh mac-jun-uplink --status",
          startCommand:
            "cd /home/devin/hua-platform && bash scripts/tap-flow-supervisor.sh mac-jun-uplink --tmux",
        },
      ],
    },
    "remote-panel-yoon": {
      kind: "remote-panel",
      id: "remote-panel-yoon",
      label: "sum-back 윤 remote phone panel",
      agent: "윤",
      runtimeSurface: "remote-panel",
      repoRoot: "/home/devin/hua-platform",
      commsDir: "/home/devin/hua-comms",
      host: "100.121.45.22",
      port: 8765,
      readOnly: true,
      sendEnabled: false,
    },
  } satisfies Record<string, ProfileConfig>);
}

function resetStatusProfileFixtures(): void {
  for (const key of Object.keys(AGENT_PROFILES)) {
    delete AGENT_PROFILES[key];
  }
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tap-comms-doctor-"));
  commsDir = path.join(tmpDir, "hua-comms");
  stateDir = path.join(tmpDir, ".tap-comms");
  fs.mkdirSync(path.join(commsDir, "inbox"), { recursive: true });
  vi.spyOn(console, "log").mockImplementation(() => {});
  installStatusProfileFixtures();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
  resetStatusProfileFixtures();
  __setCommsDoctorAppRouteFreshnessRunnerForTests(null);
});

describe("commsDoctorCommand", () => {
  it("reports Windows App consent-drive proof separately from inbox evidence", async () => {
    writePresence("솔", {
      timestamp: new Date().toISOString(),
      receiveTransports: ["consent-drive"],
      address: {
        hostId: "DEVIN",
        conversationId: "thread-live",
        ownerClientId: "owner-live",
      },
      consentDriveStatus: "ready",
    });
    writeStandingScheduler();
    __setCommsDoctorAppRouteFreshnessRunnerForTests(async () => appResult({}));

    const result = await commsDoctorCommand(
      baseArgs("--agent", "솔", "--plan-send"),
    );

    expect(result.ok).toBe(true);
    expect(result.code).toBe("TAP_COMMS_DOCTOR_OK");
    expect(result.data.status).toBe("ready");
    expect(result.data.surfaces).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "windows-app",
          liveDelivery: true,
          durableEvidence: false,
          readiness: "ready",
          scheduler: expect.objectContaining({
            operationalState: "standing-worker-ready",
            lockExists: true,
          }),
          dryRunProof: expect.objectContaining({
            transport: "consent-drive",
            liveAttemptStatus: "would-attempt",
            fallbackToInbox: false,
          }),
        }),
        expect.objectContaining({
          kind: "inbox-fallback",
          liveDelivery: false,
          durableEvidence: true,
          fallbackEvidence: true,
        }),
      ]),
    );
    expect(result.data.sendPlan).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          surface: "windows-app",
          reason: expect.stringContaining("fallbackToInbox=false"),
        }),
      ]),
    );
    expect(result.data.notes).toEqual(
      expect.arrayContaining([
        "Surface-first rule: choose delivery by runtime surface, not display name alone.",
        "Receiver/promoter is the portable CLI/TUI/headless backbone; active turns must surface queued/blocked evidence instead of default steer.",
        "Consent-drive / Codex App IPC is an experimental live adapter and must stay strict-gated by fresh route and runtime health evidence.",
        "Inbox evidence and live delivery are separate evidence layers.",
      ]),
    );
  });

  it("matches instance-keyed presence by concrete agent alias", async () => {
    writePresence("codex-agent-a", {
      timestamp: new Date().toISOString(),
      receiveTransports: ["mcp-channel"],
      address: {
        hostId: "local",
        routingAddress: "codex-agent-a",
        aliases: ["codex-agent-a", "agent-a"],
      },
    });

    const result = await commsDoctorCommand(
      baseArgs("--agent", "agent-a", "--surface", "mcp-channel"),
    );

    expect(result.ok).toBe(true);
    expect(result.data.surfaces).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          agent: "agent-a",
          kind: "mcp-channel",
          readiness: "ready",
          routeFreshness: expect.objectContaining({
            fresh: true,
          }),
        }),
      ]),
    );
  });

  it("does not mark unrelated suffix-matching presence as channel-ready", async () => {
    writePresence("other-agent-a", {
      agent: "other-agent-a",
      timestamp: new Date().toISOString(),
      receiveTransports: ["mcp-channel"],
      health: { status: "ready" },
      address: {
        hostId: "local",
        routingAddress: "other-agent-a",
        aliases: ["other-agent-a"],
      },
    });

    const result = await commsDoctorCommand(
      baseArgs("--agent", "agent-a", "--surface", "mcp-channel"),
    );

    expect(result.ok).toBe(true);
    expect(result.data.surfaces).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          agent: "agent-a",
          kind: "mcp-channel",
          readiness: "not-observed",
        }),
      ]),
    );
  });

  it("suggests M552 freshness repair for stale-but-recoverable App routes", async () => {
    writePresence("솔", {
      timestamp: "2000-01-01T00:00:00.000Z",
      receiveTransports: ["consent-drive"],
      address: {
        hostId: "DEVIN",
        conversationId: "thread-stale",
        ownerClientId: "owner-stale",
      },
    });
    __setCommsDoctorAppRouteFreshnessRunnerForTests(async () =>
      appResult({
        status: "needs-refresh",
        classification: "ttl-expired-target-ready",
        routeHealthStatus: "stale-presence",
        transport: "not-ready",
        liveAttemptStatus: "not-attempted",
        fallbackToInbox: true,
      }),
    );

    const result = await commsDoctorCommand(baseArgs("--agent", "솔"));

    expect(result.data.status).toBe("needs-attention");
    expect(result.data.surfaces).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "windows-app",
          readiness: "needs-repair",
          nextAction:
            "tap app-route-freshness --agent 솔 --apply --json; then run tap app-route-freshness --agent 솔 --watch --json under supervisor",
          scheduler: expect.objectContaining({
            operationalState: "target-local-ready-central-ttl-expired",
            operationalFailure: true,
          }),
          dryRunProof: expect.objectContaining({
            transport: "not-ready",
            fallbackToInbox: true,
          }),
        }),
      ]),
    );
    expect(result.data.gaps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "target-local-ready-central-ttl-expired",
          severity: "fail",
        }),
      ]),
    );
  });

  it("distinguishes expired presence from an active non-authoritative route lease", async () => {
    writePresence("솔", {
      timestamp: "2000-01-01T00:00:00.000Z",
      receiveTransports: ["consent-drive"],
      address: {
        hostId: "DEVIN",
        conversationId: "thread-stale",
        ownerClientId: "owner-stale",
      },
    });
    writeRouteLease("솔");
    __setCommsDoctorAppRouteFreshnessRunnerForTests(async () =>
      appResult({
        status: "needs-refresh",
        classification: "ttl-expired-target-ready",
        routeHealthStatus: "stale-presence",
        transport: "not-ready",
        liveAttemptStatus: "not-attempted",
        fallbackToInbox: true,
      }),
    );

    const result = await commsDoctorCommand(baseArgs("--agent", "솔"));

    expect(result.data.status).toBe("needs-attention");
    expect(result.data.surfaces).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "windows-app",
          readiness: "needs-repair",
          summary: expect.stringContaining(
            "routeLease=active(non-live-authority)",
          ),
          routeLease: expect.objectContaining({
            active: true,
            liveAuthority: false,
            route: expect.objectContaining({
              complete: true,
              conversationId: "thread-stable",
              ownerClientId: "owner-stable",
            }),
          }),
          dryRunProof: expect.objectContaining({
            transport: "not-ready",
            liveAttemptStatus: "not-attempted",
            fallbackToInbox: true,
          }),
        }),
      ]),
    );
    expect(result.data.gaps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "presence-expired-route-lease-active",
          severity: "warn",
        }),
        expect.objectContaining({
          id: "target-local-ready-central-ttl-expired",
          severity: "fail",
        }),
      ]),
    );
  });

  it("reads route leases through the same ASCII-normalized filename as the writer", async () => {
    writeRouteLease("codex_1", {
      agentId: "codex-1",
      agent: "codex-1",
    });
    __setCommsDoctorAppRouteFreshnessRunnerForTests(async () =>
      appResult({
        status: "needs-refresh",
        classification: "ttl-expired-target-ready",
        routeHealthStatus: "stale-presence",
        transport: "not-ready",
        liveAttemptStatus: "not-attempted",
        fallbackToInbox: true,
      }),
    );

    const result = await commsDoctorCommand(
      baseArgs("--agent", "codex-1", "--surface", "app"),
    );

    expect(result.data.surfaces).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "windows-app",
          routeLease: expect.objectContaining({
            path: expect.stringContaining("route-leases/codex_1.json"),
            exists: true,
            active: true,
            liveAuthority: false,
          }),
        }),
      ]),
    );
  });

  it("surfaces missing scheduler state for an otherwise healthy App route", async () => {
    writePresence("솔", {
      timestamp: new Date().toISOString(),
      receiveTransports: ["consent-drive"],
      address: {
        hostId: "DEVIN",
        conversationId: "thread-live",
        ownerClientId: "owner-live",
      },
      consentDriveStatus: "ready",
    });
    __setCommsDoctorAppRouteFreshnessRunnerForTests(async () => appResult({}));

    const result = await commsDoctorCommand(baseArgs("--agent", "솔"));

    expect(result.data.status).toBe("needs-attention");
    expect(result.data.surfaces).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "windows-app",
          readiness: "ready",
          nextAction:
            "start standing freshness: tap app-route-freshness --agent 솔 --watch --json under supervisor",
          scheduler: expect.objectContaining({
            operationalState: "scheduler-state-missing",
            operationalFailure: true,
          }),
        }),
      ]),
    );
    expect(result.data.gaps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "scheduler-state-missing",
          severity: "warn",
        }),
      ]),
    );
  });

  it("surfaces stopped freshness workers before the stable App route ages out", async () => {
    writePresence("솔", {
      timestamp: new Date().toISOString(),
      receiveTransports: ["consent-drive"],
      address: {
        hostId: "DEVIN",
        conversationId: "thread-live",
        ownerClientId: "owner-live",
      },
      consentDriveStatus: "ready",
    });
    writeSchedulerState({
      worker: {
        enabled: false,
        status: "not-requested",
        lockPath: null,
        owner: null,
        message: "watch worker lock not requested",
      },
    });
    __setCommsDoctorAppRouteFreshnessRunnerForTests(async () => appResult({}));

    const result = await commsDoctorCommand(baseArgs("--agent", "솔"));

    expect(result.data.status).toBe("needs-attention");
    expect(result.data.surfaces).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "windows-app",
          scheduler: expect.objectContaining({
            operationalState: "no-standing-freshness-worker",
            operationalFailure: true,
          }),
        }),
      ]),
    );
    expect(result.data.gaps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "no-standing-freshness-worker",
          severity: "warn",
        }),
      ]),
    );
  });

  it("does not report a stale acquired freshness worker lock as healthy", async () => {
    const staleAt = new Date(Date.now() - 2 * 60 * 60_000).toISOString();
    writePresence("솔", {
      timestamp: new Date().toISOString(),
      receiveTransports: ["consent-drive"],
      address: {
        hostId: "DEVIN",
        conversationId: "thread-live",
        ownerClientId: "owner-live",
      },
      consentDriveStatus: "ready",
    });
    writeSchedulerState({
      updatedAt: staleAt,
      lastRunAt: staleAt,
      lastRefreshAt: staleAt,
    });
    writeSchedulerLock(staleAt);
    __setCommsDoctorAppRouteFreshnessRunnerForTests(async () => appResult({}));

    const result = await commsDoctorCommand(baseArgs("--agent", "솔"));

    expect(result.data.status).toBe("needs-attention");
    expect(result.data.surfaces).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "windows-app",
          scheduler: expect.objectContaining({
            operationalState: "scheduler-stopped",
            operationalFailure: true,
          }),
        }),
      ]),
    );
    expect(result.data.gaps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "scheduler-stopped",
          severity: "warn",
        }),
      ]),
    );
  });

  it("keeps CLI inbox evidence separate from receiver/promoter live readiness", async () => {
    const evidencePath = writeEvidence("hua-comms/inbox/review-yoon.md", {
      type: "inbox",
      from: "솔",
      to: "윤",
      subject: "review-request",
    });

    const result = await commsDoctorCommand(
      baseArgs(
        "--agent",
        "윤",
        "--include-profile-pack",
        "--evidence-file",
        evidencePath,
      ),
    );

    expect(result.data.surfaces).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "codex-cli",
          recommendedTransport:
            "target inbox/projection plus receiver/promoter",
          receiverPromoter: expect.objectContaining({
            receiverSession: "tap-receiver-yoon",
          }),
        }),
        expect.objectContaining({
          kind: "inbox-fallback",
          liveDelivery: false,
          durableEvidence: true,
        }),
      ]),
    );
    expect(result.data.gaps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "durable-inbox-only-not-live",
          severity: "info",
        }),
      ]),
    );
  });

  it("keeps --all-known scoped to local public agents by default", async () => {
    writePresence("codex_agent_a", {
      agent: "agent-a",
      timestamp: new Date().toISOString(),
      receiveTransports: ["consent-drive"],
      address: {
        hostId: "blank-user-comms",
        routingAddress: "codex_agent_a",
        aliases: ["codex_agent_a", "agent-a"],
      },
    });
    writePresence("담", {
      timestamp: new Date().toISOString(),
      receiveTransports: ["mcp-channel"],
      address: {
        hostId: "sum-back",
        routingAddress: "담",
      },
    });
    writePresence("윤", {
      agent: "윤",
      timestamp: new Date().toISOString(),
      receiveTransports: ["mcp-channel"],
      address: {
        hostId: "public-local",
        routingAddress: "윤",
      },
    });
    __setCommsDoctorAppRouteFreshnessRunnerForTests(async () => appResult({}));

    const result = await commsDoctorCommand(
      baseArgs("--all-known", "--plan-send"),
    );

    expect(result.ok).toBe(true);
    expect(result.data.targets.map((target) => target.agent)).toHaveLength(3);
    expect(result.data.targets.map((target) => target.agent)).toEqual(
      expect.arrayContaining(["agent-a", "담", "윤"]),
    );
    expect(result.data.surfaces).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          agent: "담",
          kind: "mcp-channel",
          readiness: "ready",
          liveDelivery: true,
        }),
        expect.objectContaining({
          agent: "윤",
          kind: "mcp-channel",
          readiness: "ready",
          liveDelivery: true,
        }),
        expect.objectContaining({
          agent: "윤",
          kind: "inbox-fallback",
          durableEvidence: true,
        }),
        expect.objectContaining({
          agent: "담",
          kind: "inbox-fallback",
          durableEvidence: true,
        }),
      ]),
    );
    expect(result.data.surfaces).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ agent: "솔" }),
        expect.objectContaining({ agent: "codex_agent_a" }),
        expect.objectContaining({ id: "sumback-yoon" }),
        expect.objectContaining({ id: "remote-panel-yoon" }),
      ]),
    );
    expect(result.data.sendPlan).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          agent: "담",
          surface: "inbox-fallback",
        }),
      ]),
    );
  });

  it("includes bundled operator profiles only when explicitly requested", async () => {
    writePresence("담", {
      timestamp: new Date().toISOString(),
      receiveTransports: ["mcp-channel"],
      address: {
        hostId: "sum-back",
        routingAddress: "담",
      },
    });
    __setCommsDoctorAppRouteFreshnessRunnerForTests(async () => appResult({}));

    const result = await commsDoctorCommand(
      baseArgs("--all-known", "--include-profile-pack", "--plan-send"),
    );

    expect(result.ok).toBe(true);
    expect(result.data.targets.map((target) => target.agent)).toEqual(
      expect.arrayContaining(["솔", "윤", "준", "담"]),
    );
    expect(result.data.surfaces).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          agent: "윤",
          kind: "codex-cli",
          receiverPromoter: expect.objectContaining({
            receiverSession: "tap-receiver-yoon",
          }),
        }),
        expect.objectContaining({
          agent: "윤",
          kind: "remote-panel",
          liveDelivery: false,
        }),
        expect.objectContaining({
          agent: "준",
          kind: "codex-cli",
          receiverPromoter: expect.objectContaining({
            receiverSession: "tap-receiver-jun-ssh-tui",
            flowSupervisors: expect.arrayContaining([
              expect.objectContaining({ id: "mac-jun-projection" }),
              expect.objectContaining({ id: "mac-jun-uplink" }),
            ]),
          }),
        }),
        expect.objectContaining({
          agent: "담",
          kind: "mcp-channel",
          readiness: "ready",
          liveDelivery: true,
        }),
      ]),
    );
    expect(result.data.sendPlan).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          agent: "윤",
          surface: "codex-cli",
        }),
        expect.objectContaining({
          agent: "담",
          surface: "inbox-fallback",
        }),
      ]),
    );
  });

  it("explains observe-scope evidence and wrong expected recipient", async () => {
    writePresence("솔", {
      timestamp: new Date().toISOString(),
      receiveTransports: ["consent-drive"],
    });
    __setCommsDoctorAppRouteFreshnessRunnerForTests(async () => appResult({}));
    const evidencePath = writeEvidence("observe-review.md", {
      from: "준",
      to: "솔",
      subject: "review-result",
      scope: "observe",
    });

    const result = await commsDoctorCommand(
      baseArgs(
        "--agent",
        "솔",
        "--evidence-file",
        evidencePath,
        "--expected-recipient",
        "윤",
        "--expected-surface",
        "app",
      ),
    );

    expect(result.data.status).toBe("needs-attention");
    expect(result.data.gaps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "envelope-scope-not-live" }),
        expect.objectContaining({ id: "wrong-expected-recipient" }),
        expect.objectContaining({
          id: "expected-app-live-but-envelope-evidence",
        }),
      ]),
    );
  });

  it("detects live consent-drive attempts that lack durable inbox evidence", async () => {
    const evidencePath = writeEvidence("receipt.md", {
      from: "솔",
      to: "솔",
      subject: "live-only",
      transport: "consent-drive",
      liveAttemptStatus: "delivered",
      fallbackToInbox: false,
    });

    const result = await commsDoctorCommand(
      baseArgs(
        "--agent",
        "윤",
        "--surface",
        "inbox",
        "--evidence-file",
        evidencePath,
      ),
    );

    expect(result.data.status).toBe("needs-attention");
    expect(result.data.gaps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "missing-durable-evidence-after-live-attempt",
          severity: "fail",
        }),
      ]),
    );
  });
});
