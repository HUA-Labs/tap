import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
// prettier-ignore
// @ts-expect-error — no type declarations for .mjs script
import { getAutopilotStatus, runAutopilotLoop, runAutopilotPass } from "../../scripts/tap-autopilot.mjs";

describe("tap autopilot", () => {
  const createdDirs: string[] = [];

  afterEach(() => {
    vi.restoreAllMocks();
    while (createdDirs.length > 0) {
      const dir = createdDirs.pop();
      if (dir) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it("summarizes tracked review-routing state", () => {
    const commsDir = fs.mkdtempSync(path.join(os.tmpdir(), "tap-autopilot-"));
    createdDirs.push(commsDir);
    fs.writeFileSync(
      path.join(commsDir, ".chain-state.json"),
      JSON.stringify(
        {
          seenPrs: {
            "pr-761": {
              routed: true,
              author: "견",
            },
          },
          reviewCycles: {
            "pr-761": 1,
          },
        },
        null,
        2,
      ),
      "utf8",
    );
    const now = new Date("2026-03-25T12:00:00.000Z");
    fs.writeFileSync(
      path.join(commsDir, "heartbeats.json"),
      JSON.stringify(
        {
          담: {
            agent: "담",
            status: "active",
            timestamp: new Date(now.getTime() - 60_000).toISOString(),
            lastActivity: new Date(now.getTime() - 60_000).toISOString(),
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    const status = getAutopilotStatus({ commsDir }, { fs, now: () => now });

    expect(status.trackedPrs).toBe(1);
    expect(status.pendingAuthorNotifications).toBe(1);
    expect(
      status.activeReviewers.map((reviewer: { name: string }) => reviewer.name),
    ).toEqual(["담"]);
  });

  it("runs a single autopilot pass by delegating to the chain router", async () => {
    const runChainRouterPassMock = vi.fn().mockResolvedValue({
      summary: {
        routed: 1,
        rerouted: 0,
        skipped: 2,
        escalated: 0,
        completions: 1,
      },
      reviewers: [{ name: "담" }],
    });

    const result = await runAutopilotPass(
      { passNumber: 4, dryRun: true },
      {
        now: () => new Date("2026-03-25T12:30:00.000Z"),
        runChainRouterPass: runChainRouterPassMock,
      },
    );

    expect(runChainRouterPassMock).toHaveBeenCalledWith(
      { passNumber: 4, dryRun: true },
      expect.objectContaining({
        now: expect.any(Function),
        runChainRouterPass: runChainRouterPassMock,
      }),
    );
    expect(result.passNumber).toBe(4);
    expect(result.chain.summary.routed).toBe(1);
    expect(result.chain.summary.completions).toBe(1);
  });

  it("gracefully stops the loop on SIGINT", async () => {
    const fakeProcess = new EventEmitter();
    const log = vi.fn();
    const errorLog = vi.fn();
    const runChainRouterPassMock = vi.fn().mockResolvedValue({
      summary: {
        routed: 1,
        rerouted: 0,
        skipped: 0,
        escalated: 0,
        completions: 0,
      },
      reviewers: [{ name: "담" }],
    });
    const sleepMock = vi.fn((_ms, _value, options) => {
      return new Promise((_resolve, reject) => {
        const abort = () =>
          reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
        if (options?.signal?.aborted) {
          abort();
          return;
        }
        options?.signal?.addEventListener("abort", abort, { once: true });
      });
    });

    const loopPromise = runAutopilotLoop(
      { intervalSeconds: 30 },
      {
        process: fakeProcess,
        log,
        error: errorLog,
        sleep: sleepMock,
        runChainRouterPass: runChainRouterPassMock,
        now: () => new Date("2026-03-25T12:30:00.000Z"),
      },
    );

    await Promise.resolve();
    await Promise.resolve();
    expect(runChainRouterPassMock).toHaveBeenCalledTimes(1);

    fakeProcess.emit("SIGINT");
    const result = await loopPromise;

    expect(result).toEqual({
      passNumber: 1,
      stoppedBySignal: "SIGINT",
    });
    expect(log).toHaveBeenCalledWith(
      "[autopilot] SIGINT received, stopping after current pass",
    );
    expect(log).toHaveBeenCalledWith("[autopilot] shutdown complete (SIGINT)");
    expect(fakeProcess.listenerCount("SIGINT")).toBe(0);
    expect(fakeProcess.listenerCount("SIGTERM")).toBe(0);
  });
});
