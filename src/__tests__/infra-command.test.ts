import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  __setInfraHeadlessRunnerStatusRunnerForTests,
  __setInfraProfileReportBuilderForTests,
  infraCommand,
} from "../commands/infra.js";
import type { AgentProfileReport } from "../commands/status.js";
import type { ProfileConfig } from "../commands/status-profiles.js";

let tmpDir: string;
let commsDir: string;
let stateDir: string;
let previousFreshnessStateDir: string | undefined;

function profileReport(
  profile: ProfileConfig,
  overrides: Partial<AgentProfileReport> = {},
): AgentProfileReport {
  const receiverStatus = profile.kind === "codex-cli" ? "running" : undefined;
  const remotePanel =
    profile.kind === "remote-panel"
      ? {
          host: profile.host,
          port: profile.port,
          url: `http://${profile.host}:${profile.port}`,
          readOnly: profile.readOnly,
          sendEnabled: profile.sendEnabled,
          tokenEnv: profile.tokenEnv ?? null,
          status: "read-only",
          listening: true,
        }
      : undefined;

  return {
    profile: profile.id,
    label: profile.label,
    agent: profile.agent,
    runtimeSurface: profile.runtimeSurface,
    host: "local",
    status: "ready",
    summary: `${profile.label} is ready.`,
    checks: [
      {
        name: "probe",
        status: "pass",
        message: "profile probe ready",
      },
    ],
    nextActions: [],
    paths: {
      repoRoot: profile.repoRoot,
      commsDir: profile.commsDir,
      ...(profile.kind === "codex-cli"
        ? { receiverLogPath: profile.receiverLogPath }
        : {}),
    },
    surfaces:
      profile.kind === "codex-cli"
        ? {
            receiverSupervisor: {
              tmuxSession: profile.receiverSession,
              status: receiverStatus,
            },
          }
        : {
            remotePanel,
          },
    snapshot: {},
    ...overrides,
  } as AgentProfileReport;
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

function writeFreshnessState(record: Record<string, unknown>): void {
  const freshnessDir = path.join(stateDir, "app-route-freshness");
  fs.mkdirSync(freshnessDir, { recursive: true });
  fs.writeFileSync(
    path.join(freshnessDir, "windows-app-sol.json"),
    JSON.stringify(
      {
        schemaVersion: 1,
        profile: "windows-app-sol",
        agent: "솔",
        updatedAt: new Date().toISOString(),
        lastRunAt: new Date().toISOString(),
        ...record,
      },
      null,
      2,
    ),
    "utf8",
  );
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tap-infra-"));
  commsDir = path.join(tmpDir, "hua-comms");
  stateDir = path.join(tmpDir, ".tap-comms");
  previousFreshnessStateDir = process.env.TAP_APP_ROUTE_FRESHNESS_STATE_DIR;
  process.env.TAP_APP_ROUTE_FRESHNESS_STATE_DIR = stateDir;
  fs.mkdirSync(path.join(commsDir, "inbox"), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, "package.json"), "{}", "utf8");
  vi.spyOn(console, "log").mockImplementation(() => {});
  __setInfraProfileReportBuilderForTests((profile) => profileReport(profile));
  __setInfraHeadlessRunnerStatusRunnerForTests((profileId) => ({
    ok: true,
    stdout: `stopped: tap-headless-${profileId}\n`,
    stderr: "",
    status: 0,
  }));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  if (previousFreshnessStateDir === undefined) {
    delete process.env.TAP_APP_ROUTE_FRESHNESS_STATE_DIR;
  } else {
    process.env.TAP_APP_ROUTE_FRESHNESS_STATE_DIR = previousFreshnessStateDir;
  }
  vi.restoreAllMocks();
  __setInfraProfileReportBuilderForTests(null);
  __setInfraHeadlessRunnerStatusRunnerForTests(null);
});

describe("infraCommand", () => {
  it("aggregates known surfaces without mutating runtime state", async () => {
    const result = await infraCommand(["status", "--comms-dir", commsDir]);

    expect(result.ok).toBe(true);
    expect(result.code).toBe("TAP_INFRA_STATUS_OK");
    expect(result.data.status).toBe("degraded");
    expect(result.data.summary).toMatchObject({
      ready: 3,
      degraded: 0,
      blocked: 0,
      notObserved: 1,
    });
    expect(result.data.profiles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "sumback-yoon",
          workerOfRecord: expect.objectContaining({
            expected: "receiver-supervisor",
            active: ["receiver-supervisor"],
            status: "single",
          }),
        }),
        expect.objectContaining({
          id: "windows-app-sol",
          status: "not-observed",
          source: expect.objectContaining({ kind: "presence" }),
        }),
      ]),
    );
    expect(result.data.notes).toContain(
      "read-only report: no supervisors, routes, presence, inbox, or heartbeats were changed",
    );
  });

  it("surfaces receiver/headless worker-of-record conflicts", async () => {
    __setInfraHeadlessRunnerStatusRunnerForTests((profileId) => ({
      ok: true,
      stdout: `running: tap-headless-${profileId}\n`,
      stderr: "",
      status: 0,
    }));

    const result = await infraCommand([
      "status",
      "--profile",
      "sumback-yoon",
      "--comms-dir",
      commsDir,
    ]);

    expect(result.ok).toBe(true);
    expect(result.data.status).toBe("degraded");
    expect(result.data.profiles[0]).toMatchObject({
      id: "sumback-yoon",
      status: "degraded",
      workerOfRecord: {
        expected: "receiver-supervisor",
        active: ["receiver-supervisor", "headless-runner"],
        status: "conflict",
      },
      checks: expect.arrayContaining([
        expect.objectContaining({
          name: "worker-of-record",
          status: "warn",
        }),
      ]),
    });
  });

  it("reports stale Windows App route presence as blocked", async () => {
    writePresence("솔", {
      timestamp: "2026-06-13T00:00:00.000Z",
      conversationId: "thread-old",
      ownerClientId: "owner-old",
      consentDriveStatus: "ready",
    });

    const result = await infraCommand([
      "status",
      "--profile",
      "windows-app-sol",
      "--fresh-minutes",
      "1",
      "--comms-dir",
      commsDir,
    ]);

    expect(result.ok).toBe(true);
    expect(result.data.status).toBe("blocked");
    expect(result.data.profiles[0]).toMatchObject({
      id: "windows-app-sol",
      status: "blocked",
      workerOfRecord: expect.objectContaining({
        expected: "consent-drive-ipc",
        active: [],
        status: "missing",
      }),
      checks: expect.arrayContaining([
        expect.objectContaining({
          name: "presence-freshness",
          status: "fail",
        }),
        expect.objectContaining({
          name: "route-tuple",
          status: "pass",
        }),
      ]),
    });
  });

  it("reads Windows App route tuple from nested address metadata", async () => {
    writePresence("솔", {
      timestamp: new Date().toISOString(),
      receiveTransports: ["consent-drive"],
      address: {
        routingAddress: "솔",
        conversationId: "thread-nested",
        ownerClientId: "owner-nested",
      },
      capabilities: {
        receiveTransports: ["consent-drive"],
      },
      consentDriveStatus: "ready",
    });

    const result = await infraCommand([
      "status",
      "--profile",
      "windows-app-sol",
      "--fresh-minutes",
      "30",
      "--comms-dir",
      commsDir,
    ]);

    expect(result.ok).toBe(true);
    expect(result.data.status).toBe("ready");
    expect(result.data.profiles[0]).toMatchObject({
      id: "windows-app-sol",
      status: "ready",
      workerOfRecord: expect.objectContaining({
        expected: "consent-drive-ipc",
        active: ["consent-drive-ipc"],
        status: "single",
      }),
      checks: expect.arrayContaining([
        expect.objectContaining({
          name: "route-tuple",
          status: "pass",
          message: "conversationId=thread-nested, ownerClientId=owner-nested",
        }),
      ]),
    });
  });

  it("includes App route freshness scheduler state in Windows App infra status", async () => {
    writePresence("솔", {
      timestamp: new Date().toISOString(),
      conversationId: "thread-live",
      ownerClientId: "owner-live",
      consentDriveStatus: "ready",
    });
    writeFreshnessState({
      lastStatus: "needs-refresh",
      lastClassification: "refresh-soon",
      lastRefreshAt: "2026-06-14T00:00:00.000Z",
      routeAgeSeconds: 1400,
      routeAgeRatio: 0.78,
      thresholdRatio: 0.75,
      nextRefreshAt: "2026-06-14T00:05:00.000Z",
      sourceHost: "devin-win-ts",
      sourceHostStatus: "resolved",
      configuredHostDrift: true,
      nextAction:
        "run tap app-route-freshness --agent 솔 --apply --json before TTL expiry",
    });

    const result = await infraCommand([
      "status",
      "--profile",
      "windows-app-sol",
      "--fresh-minutes",
      "30",
      "--comms-dir",
      commsDir,
    ]);

    expect(result.ok).toBe(true);
    expect(result.data.status).toBe("degraded");
    expect(result.data.profiles[0]).toMatchObject({
      id: "windows-app-sol",
      status: "degraded",
      summary:
        "Windows App 솔 route tuple is fresh but scheduled refresh is due.",
      checks: expect.arrayContaining([
        expect.objectContaining({
          name: "app-route-freshness-state",
          status: "pass",
        }),
        expect.objectContaining({
          name: "app-route-last-refresh",
          status: "pass",
          message: "lastRefreshAt=2026-06-14T00:00:00.000Z",
        }),
        expect.objectContaining({
          name: "app-route-age",
          status: "warn",
          message: expect.stringContaining("route age is 1400.0s"),
        }),
        expect.objectContaining({
          name: "app-route-source-host",
          status: "warn",
          message: expect.stringContaining("configuredHostDrift=true"),
        }),
        expect.objectContaining({
          name: "app-route-next-action",
          status: "warn",
          message:
            "run tap app-route-freshness --agent 솔 --apply --json before TTL expiry",
        }),
      ]),
      nextActions: expect.arrayContaining([
        expect.objectContaining({
          command: "tap app-route-freshness --agent 솔 --apply --json",
        }),
      ]),
    });
  });

  it("does not treat non-ready consent-drive status as a live Windows worker", async () => {
    writePresence("솔", {
      timestamp: new Date().toISOString(),
      conversationId: "thread-live",
      ownerClientId: "owner-live",
      consentDriveStatus: "stale",
    });

    const result = await infraCommand([
      "status",
      "--profile",
      "windows-app-sol",
      "--fresh-minutes",
      "30",
      "--comms-dir",
      commsDir,
    ]);

    expect(result.ok).toBe(true);
    expect(result.data.status).toBe("blocked");
    expect(result.data.profiles[0]).toMatchObject({
      id: "windows-app-sol",
      status: "blocked",
      workerOfRecord: expect.objectContaining({
        expected: "consent-drive-ipc",
        active: [],
        status: "missing",
      }),
      checks: expect.arrayContaining([
        expect.objectContaining({
          name: "presence-freshness",
          status: "pass",
        }),
        expect.objectContaining({
          name: "route-tuple",
          status: "pass",
        }),
        expect.objectContaining({
          name: "consent-drive-status",
          status: "fail",
          message: "consentDriveStatus=stale",
        }),
      ]),
    });
  });

  it("rejects unknown infra subcommands", async () => {
    const result = await infraCommand(["repair"]);

    expect(result.ok).toBe(false);
    expect(result.code).toBe("TAP_INVALID_ARGUMENT");
    expect(result.message).toContain("Unknown tap infra subcommand");
  });
});
