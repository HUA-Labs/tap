import { describe, it, expect } from "vitest";
import {
  computeOperationalStatus,
  createHealthHistory,
  recordHealthCheck,
  recordRestart,
  evaluateHealthAction,
  computeBackoffMs,
  DEFAULT_HEALTH_POLICY,
  type HealthCheckResult,
} from "../engine/health-monitor.js";

function makeCheck(
  overrides: Partial<HealthCheckResult["checks"]> = {},
  operational?: string,
): HealthCheckResult {
  const checks = {
    bridgePidAlive: true,
    heartbeatFresh: true,
    threadActive: true,
    ...overrides,
  };
  return {
    instanceId: "codex",
    timestamp: new Date().toISOString(),
    operational:
      (operational as HealthCheckResult["operational"]) ??
      computeOperationalStatus(checks),
    checks,
  };
}

describe("computeOperationalStatus", () => {
  it("returns routing-healthy when all checks pass", () => {
    expect(
      computeOperationalStatus({
        bridgePidAlive: true,
        heartbeatFresh: true,
        threadActive: true,
      }),
    ).toBe("routing-healthy");
  });

  it("returns routing-degraded when thread inactive", () => {
    expect(
      computeOperationalStatus({
        bridgePidAlive: true,
        heartbeatFresh: true,
        threadActive: false,
      }),
    ).toBe("routing-degraded");
  });

  it("returns bridge-stale when heartbeat not fresh", () => {
    expect(
      computeOperationalStatus({
        bridgePidAlive: true,
        heartbeatFresh: false,
        threadActive: false,
      }),
    ).toBe("bridge-stale");
  });

  it("returns mcp-only when PID dead but heartbeat fresh", () => {
    expect(
      computeOperationalStatus({
        bridgePidAlive: false,
        heartbeatFresh: true,
        threadActive: false,
      }),
    ).toBe("mcp-only");
  });

  it("returns unreachable when all fail", () => {
    expect(
      computeOperationalStatus({
        bridgePidAlive: false,
        heartbeatFresh: false,
        threadActive: false,
      }),
    ).toBe("unreachable");
  });
});

describe("health history", () => {
  it("creates empty history", () => {
    const h = createHealthHistory("codex");
    expect(h.instanceId).toBe("codex");
    expect(h.entries).toHaveLength(0);
    expect(h.currentStreak).toBe(0);
  });

  it("records healthy check and increments streak", () => {
    let h = createHealthHistory("codex");
    h = recordHealthCheck(h, makeCheck());
    expect(h.currentStreak).toBe(1);
    h = recordHealthCheck(h, makeCheck());
    expect(h.currentStreak).toBe(2);
  });

  it("treats routing-degraded as unhealthy (thread missing)", () => {
    let h = createHealthHistory("codex");
    const degraded = makeCheck({ threadActive: false }); // routing-degraded
    h = recordHealthCheck(h, degraded);
    expect(h.currentStreak).toBe(-1); // not +1
    h = recordHealthCheck(h, degraded);
    expect(h.currentStreak).toBe(-2);
  });

  it("records unhealthy check and decrements streak", () => {
    let h = createHealthHistory("codex");
    const bad = makeCheck({ bridgePidAlive: false, heartbeatFresh: false });
    h = recordHealthCheck(h, bad);
    expect(h.currentStreak).toBe(-1);
    h = recordHealthCheck(h, bad);
    expect(h.currentStreak).toBe(-2);
  });

  it("resets streak on transition", () => {
    let h = createHealthHistory("codex");
    h = recordHealthCheck(h, makeCheck());
    h = recordHealthCheck(h, makeCheck());
    expect(h.currentStreak).toBe(2);

    const bad = makeCheck({ bridgePidAlive: false, heartbeatFresh: false });
    h = recordHealthCheck(h, bad);
    expect(h.currentStreak).toBe(-1);
  });

  it("caps history at 100 entries", () => {
    let h = createHealthHistory("codex");
    for (let i = 0; i < 110; i++) {
      h = recordHealthCheck(h, makeCheck());
    }
    expect(h.entries).toHaveLength(100);
  });

  it("records restart", () => {
    let h = createHealthHistory("codex");
    h = recordRestart(h);
    expect(h.totalRestarts).toBe(1);
    expect(h.lastRestart).not.toBeNull();
    expect(h.currentStreak).toBe(0);
  });
});

describe("evaluateHealthAction", () => {
  it("returns none when healthy", () => {
    let h = createHealthHistory("codex");
    h = recordHealthCheck(h, makeCheck());
    expect(evaluateHealthAction(h, DEFAULT_HEALTH_POLICY)).toBe("none");
  });

  it("returns none for few failures", () => {
    let h = createHealthHistory("codex");
    const bad = makeCheck({ bridgePidAlive: false, heartbeatFresh: false });
    h = recordHealthCheck(h, bad);
    h = recordHealthCheck(h, bad);
    expect(evaluateHealthAction(h, DEFAULT_HEALTH_POLICY)).toBe("none");
  });

  it("returns warn at unhealthy threshold", () => {
    let h = createHealthHistory("codex");
    const bad = makeCheck({ bridgePidAlive: false, heartbeatFresh: false });
    for (let i = 0; i < 3; i++) h = recordHealthCheck(h, bad);
    expect(evaluateHealthAction(h, DEFAULT_HEALTH_POLICY)).toBe("warn");
  });

  it("returns restart at dead threshold", () => {
    let h = createHealthHistory("codex");
    const bad = makeCheck({ bridgePidAlive: false, heartbeatFresh: false });
    for (let i = 0; i < 5; i++) h = recordHealthCheck(h, bad);
    expect(evaluateHealthAction(h, DEFAULT_HEALTH_POLICY)).toBe("restart");
  });

  it("returns alert-max-restarts when budget exhausted", () => {
    let h = createHealthHistory("codex");
    h = recordRestart(h);
    h = recordRestart(h);
    h = recordRestart(h);
    const bad = makeCheck({ bridgePidAlive: false, heartbeatFresh: false });
    for (let i = 0; i < 5; i++) h = recordHealthCheck(h, bad);
    expect(evaluateHealthAction(h, DEFAULT_HEALTH_POLICY)).toBe(
      "alert-max-restarts",
    );
  });
});

describe("computeBackoffMs", () => {
  it("returns base for first restart", () => {
    expect(computeBackoffMs(1, 5000)).toBe(5000);
  });

  it("doubles on second restart", () => {
    expect(computeBackoffMs(2, 5000)).toBe(10000);
  });

  it("caps at 5 minutes", () => {
    expect(computeBackoffMs(100, 5000)).toBe(300000);
  });
});
