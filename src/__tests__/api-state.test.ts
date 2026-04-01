import { beforeEach, describe, expect, it, vi } from "vitest";

const collectDashboardSnapshotMock = vi.fn();

vi.mock("../engine/dashboard.js", () => ({
  collectDashboardSnapshot: collectDashboardSnapshotMock,
}));

const { getHealthReport } = await import("../api/state.js");

describe("getHealthReport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("marks degraded-no-thread bridges unhealthy", () => {
    collectDashboardSnapshotMock.mockReturnValue({
      generatedAt: "2026-04-01T00:00:00.000Z",
      repoRoot: "D:/repo",
      commsDir: "D:/repo/.tap-comms",
      agents: [],
      bridges: [
        {
          instanceId: "codex",
          runtime: "codex",
          status: "running",
          lifecycle: {
            presence: "bridge-live",
            status: "degraded-no-thread",
            summary: "bridge-live, degraded-no-thread (saved thread only)",
            threadId: null,
            threadCwd: null,
            savedThreadId: "thread_saved",
            savedThreadCwd: "D:/repo",
            activeTurnId: null,
            connected: false,
            initialized: true,
            appServerHealthy: true,
          },
          pid: 1234,
          port: 4501,
          heartbeatAge: 5,
          headless: true,
        },
      ],
      prs: [],
      warnings: [
        {
          level: "warn",
          message: "Bridge codex is degraded (no active thread)",
        },
      ],
    });

    const report = getHealthReport({ repoRoot: "D:/repo" });

    expect(report.ok).toBe(false);
    expect(report.bridges[0]?.lifecycle?.status).toBe("degraded-no-thread");
  });

  it("keeps initializing bridges healthy", () => {
    collectDashboardSnapshotMock.mockReturnValue({
      generatedAt: "2026-04-01T00:00:00.000Z",
      repoRoot: "D:/repo",
      commsDir: "D:/repo/.tap-comms",
      agents: [],
      bridges: [
        {
          instanceId: "codex",
          runtime: "codex",
          status: "running",
          lifecycle: {
            presence: "bridge-live",
            status: "initializing",
            summary: "bridge-live, initializing",
            threadId: null,
            threadCwd: null,
            savedThreadId: null,
            savedThreadCwd: null,
            activeTurnId: null,
            connected: null,
            initialized: false,
            appServerHealthy: true,
          },
          pid: 1234,
          port: 4501,
          heartbeatAge: 1,
          headless: true,
        },
      ],
      prs: [],
      warnings: [],
    });

    const report = getHealthReport({ repoRoot: "D:/repo" });

    expect(report.ok).toBe(true);
    expect(report.bridges[0]?.lifecycle?.status).toBe("initializing");
  });
});
