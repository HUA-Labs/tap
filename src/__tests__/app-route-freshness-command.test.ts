import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  __setAppRouteFreshnessRecoveryRunnerForTests,
  appRouteFreshnessCommand,
} from "../commands/app-route-freshness.js";
import type { CommandResult } from "../types.js";

let tmpDir: string;
let centralDir: string;
let stateDir: string;

function recoveryResult(options: {
  ok?: boolean;
  status?: string;
  classification?: string;
  routeHealthStatus?: string;
  routeHealthMessage?: string;
  hostStatus?: string;
  ageSeconds?: number | null;
  proofReady?: boolean;
}): CommandResult<Record<string, unknown>> {
  const proofReady = options.proofReady ?? true;
  return {
    ok: options.ok ?? proofReady,
    command: "windows-route-recover",
    code:
      options.ok === false || !proofReady
        ? "TAP_WINDOWS_ROUTE_RECOVER_BLOCKED"
        : "TAP_WINDOWS_ROUTE_RECOVER_OK",
    message: `windows-route-recover: ${options.status ?? "ready"}`,
    warnings: [],
    data: {
      status: options.status ?? (proofReady ? "ready" : "blocked"),
      classification:
        options.classification ?? (proofReady ? "fresh-ready" : "blocked"),
      host: {
        requestedHost: "devin",
        sshTarget: "devin-win-ts",
        sourceEndpoint: "devin-win-ts:D:/HUA/hua-comms",
        status: options.hostStatus ?? "resolved",
      },
      presence: {
        source: {
          role: "source",
          exists: true,
          freshForRouting: true,
          ageSeconds: options.ageSeconds,
        },
        central: {
          role: "target",
          exists: true,
          freshForRouting: true,
          ageSeconds: options.ageSeconds,
        },
      },
      targetLocal: {
        routeHealth: {
          status: options.routeHealthStatus ?? "fresh-route-ready",
          message:
            options.routeHealthMessage ??
            "durable presence matches live Windows App conversation thread-live",
          presenceAgeMinutes:
            options.ageSeconds == null ? null : options.ageSeconds / 60,
          candidates: [],
        },
      },
      routeDryRunProof: {
        transport: proofReady ? "consent-drive" : "not-ready",
        liveAttemptStatus: proofReady ? "would-attempt" : "not-attempted",
        fallbackToInbox: !proofReady,
        reason: proofReady
          ? "structured route ready"
          : "structured route blocked",
      },
    },
  };
}

function baseArgs(...extra: string[]): string[] {
  return [
    "--agent",
    "솔",
    "--central",
    centralDir,
    "--state-dir",
    stateDir,
    "--fresh-minutes",
    "30",
    "--threshold-ratio",
    "0.75",
    ...extra,
  ];
}

function readState(): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(
      path.join(stateDir, "app-route-freshness", "windows-app-sol.json"),
      "utf8",
    ),
  ) as Record<string, unknown>;
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tap-route-freshness-"));
  centralDir = path.join(tmpDir, "hua-comms");
  stateDir = path.join(tmpDir, ".tap-comms");
  fs.mkdirSync(path.join(centralDir, "presence"), { recursive: true });
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
  __setAppRouteFreshnessRecoveryRunnerForTests(null);
});

describe("appRouteFreshnessCommand", () => {
  it("classifies a ready route as refresh-soon once it crosses the threshold", async () => {
    const calls: string[][] = [];
    __setAppRouteFreshnessRecoveryRunnerForTests(async (args) => {
      calls.push(args);
      return recoveryResult({ ageSeconds: 1_400 });
    });

    const result = await appRouteFreshnessCommand(baseArgs());

    expect(result.ok).toBe(true);
    expect(result.code).toBe("TAP_APP_ROUTE_FRESHNESS_OK");
    expect(result.data).toMatchObject({
      status: "needs-refresh",
      classification: "refresh-soon",
      recovery: {
        routeHealthStatus: "fresh-route-ready",
      },
      policy: {
        thresholdSeconds: 1_350,
        refreshDue: true,
      },
    });
    expect(calls).toHaveLength(1);
    expect(readState()).toMatchObject({
      lastStatus: "needs-refresh",
      lastClassification: "refresh-soon",
      routeAgeSeconds: 1_400,
    });
  });

  it("uses the M551 guarded refresh primitive for proactive apply", async () => {
    const calls: string[][] = [];
    __setAppRouteFreshnessRecoveryRunnerForTests(async (args) => {
      calls.push(args);
      return calls.length === 1
        ? recoveryResult({ ageSeconds: 1_400 })
        : recoveryResult({
            status: "recovered",
            classification: "fresh-ready",
            ageSeconds: 8,
          });
    });

    const result = await appRouteFreshnessCommand(baseArgs("--apply"));

    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      status: "refreshed",
      classification: "fresh-ready",
      recovery: {
        applied: true,
      },
    });
    expect(calls).toHaveLength(2);
    expect(calls[1]).toEqual(
      expect.arrayContaining(["--apply", "--force-fresh-route-refresh"]),
    );
    expect(calls[1]).not.toContain("--dry-run");
    expect(readState()).toMatchObject({
      lastStatus: "refreshed",
      lastClassification: "fresh-ready",
    });
    expect(typeof readState().lastRefreshAt).toBe("string");
  });

  it("maps target-ready publish gaps to applyable TTL recovery", async () => {
    const calls: string[][] = [];
    __setAppRouteFreshnessRecoveryRunnerForTests(async (args) => {
      calls.push(args);
      return calls.length === 1
        ? recoveryResult({
            ok: false,
            status: "needs-recovery",
            classification: "central-publish-needed",
            routeHealthStatus: "fresh-route-ready",
            ageSeconds: 1_900,
            proofReady: false,
          })
        : recoveryResult({
            status: "recovered",
            classification: "fresh-ready",
            ageSeconds: 12,
          });
    });

    const result = await appRouteFreshnessCommand(baseArgs("--apply"));

    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      status: "refreshed",
      classification: "fresh-ready",
    });
    expect(calls).toHaveLength(2);
    expect(calls[1]).toContain("--apply");
    expect(calls[1]).not.toContain("--force-fresh-route-refresh");
  });

  it("keeps active-turn target evidence blocked instead of drive-ready", async () => {
    const calls: string[][] = [];
    __setAppRouteFreshnessRecoveryRunnerForTests(async (args) => {
      calls.push(args);
      return recoveryResult({
        ok: false,
        status: "blocked",
        classification: "active-turn-blocked",
        routeHealthStatus: "active-turn-blocked",
        routeHealthMessage: "live Windows App conversation has an active turn",
        ageSeconds: 10,
        proofReady: false,
      });
    });

    const result = await appRouteFreshnessCommand(baseArgs("--apply"));

    expect(result.ok).toBe(false);
    expect(result.code).toBe("TAP_APP_ROUTE_FRESHNESS_BLOCKED");
    expect(result.data).toMatchObject({
      status: "blocked",
      classification: "active-turn-blocked",
      recovery: {
        routeHealthStatus: "active-turn-blocked",
      },
    });
    expect(calls).toHaveLength(1);
    expect(readState()).toMatchObject({
      lastStatus: "blocked",
      lastClassification: "active-turn-blocked",
    });
    expect(String(readState().lastBlockedReason)).toContain("active turn");
  });

  it("guards watch mode with a worker-of-record lock", async () => {
    const lockDir = path.join(stateDir, "app-route-freshness");
    fs.mkdirSync(lockDir, { recursive: true });
    fs.writeFileSync(
      path.join(lockDir, "windows-app-sol.lock.json"),
      JSON.stringify({
        pid: 1234,
        agent: "솔",
        profile: "windows-app-sol",
        startedAt: new Date().toISOString(),
      }),
      "utf8",
    );
    __setAppRouteFreshnessRecoveryRunnerForTests(async () => {
      throw new Error("recovery should not run when worker lock is held");
    });

    const result = await appRouteFreshnessCommand(
      baseArgs("--watch", "--max-iterations", "1"),
    );

    expect(result.ok).toBe(false);
    expect(result.data).toMatchObject({
      status: "blocked",
      classification: "worker-conflict",
      worker: {
        status: "conflict",
      },
    });
  });

  it("reports configured-vs-active host drift distinctly", async () => {
    __setAppRouteFreshnessRecoveryRunnerForTests(async () =>
      recoveryResult({
        ok: false,
        status: "blocked",
        classification: "remote-host-config-drift",
        hostStatus: "config-drift",
        ageSeconds: 10,
        proofReady: false,
      }),
    );

    const result = await appRouteFreshnessCommand(baseArgs());

    expect(result.ok).toBe(false);
    expect(result.data).toMatchObject({
      status: "blocked",
      classification: "remote-host-config-drift",
      source: {
        configuredHostDrift: true,
      },
    });
    expect(result.data.next).toEqual(
      expect.arrayContaining([
        expect.stringContaining("active remote host config matches configured"),
      ]),
    );
  });
});
