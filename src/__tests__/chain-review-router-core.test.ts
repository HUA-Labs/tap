import { afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
// @ts-expect-error script entrypoint is runtime-typed only
import { runChainRouterPass } from "../../scripts/lib/chain-review-router-core.mjs";

function makeHeartbeat(now: Date, minutesAgo = 1) {
  return new Date(now.getTime() - minutesAgo * 60 * 1000).toISOString();
}

describe("CHAIN review router core", () => {
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

  it("reroutes a PR when a new revision is pushed and keeps inbox filenames unique", async () => {
    const commsDir = fs.mkdtempSync(path.join(os.tmpdir(), "chain-router-"));
    const inboxDir = path.join(commsDir, "inbox");
    createdDirs.push(commsDir);
    fs.mkdirSync(inboxDir, { recursive: true });

    const baseNow = new Date("2026-03-25T10:00:00.000Z");
    fs.writeFileSync(
      path.join(commsDir, "heartbeats.json"),
      JSON.stringify(
        {
          돌: {
            agent: "돌",
            status: "active",
            timestamp: makeHeartbeat(baseNow, 1),
            lastActivity: makeHeartbeat(baseNow, 1),
          },
          담: {
            agent: "담",
            status: "active",
            timestamp: makeHeartbeat(baseNow, 1),
            lastActivity: makeHeartbeat(baseNow, 1),
          },
          빛: {
            agent: "빛",
            status: "active",
            timestamp: makeHeartbeat(baseNow, 4),
            lastActivity: makeHeartbeat(baseNow, 4),
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    let openPrs = [
      {
        number: 761,
        title: "[M95] tap doctor [견]",
        author: { login: "견" },
        headRefName: "feat/m95-tap-doctor",
        headRefOid: "sha-1",
        changedFiles: 4,
        additions: 120,
        deletions: 10,
        updatedAt: baseNow.toISOString(),
      },
    ];

    const execSync = vi.fn(() => JSON.stringify(openPrs));

    const first = await runChainRouterPass(
      { commsDir },
      { execSync, fs, now: () => baseNow },
    );
    expect(first.summary).toMatchObject({
      routed: 1,
      rerouted: 0,
      skipped: 0,
      escalated: 0,
      completions: 0,
    });
    expect(first.results[0]?.action).toBe("routed");
    expect(fs.readdirSync(inboxDir)).toContain("20260325-chain-담-review-PR761.md");

    const second = await runChainRouterPass(
      { commsDir },
      { execSync, fs, now: () => new Date("2026-03-25T10:05:00.000Z") },
    );
    expect(second.summary).toMatchObject({
      routed: 0,
      rerouted: 0,
      skipped: 1,
    });

    openPrs = [
      {
        ...openPrs[0],
        headRefOid: "sha-2",
        updatedAt: new Date("2026-03-25T10:10:00.000Z").toISOString(),
      },
    ];

    const third = await runChainRouterPass(
      { commsDir },
      { execSync, fs, now: () => new Date("2026-03-25T10:10:00.000Z") },
    );
    expect(third.summary).toMatchObject({
      routed: 0,
      rerouted: 1,
      skipped: 0,
      escalated: 0,
    });
    expect(third.results[0]?.action).toBe("rerouted");

    const reviewMessages = fs
      .readdirSync(inboxDir)
      .filter((file) => file.includes("review-PR761"))
      .sort();
    expect(reviewMessages).toEqual([
      "20260325-chain-담-review-PR761-2.md",
      "20260325-chain-담-review-PR761.md",
    ]);

    const state = JSON.parse(
      fs.readFileSync(path.join(commsDir, ".chain-state.json"), "utf8"),
    );
    expect(state.reviewCycles["pr-761"]).toBe(2);
    expect(state.seenPrs["pr-761"].routeRevision).toBe("sha-2");
  });

  it("notifies the PR author once per new review artifact", async () => {
    const commsDir = fs.mkdtempSync(path.join(os.tmpdir(), "chain-complete-"));
    const inboxDir = path.join(commsDir, "inbox");
    const reviewsDir = path.join(commsDir, "reviews", "gen13");
    createdDirs.push(commsDir);
    fs.mkdirSync(inboxDir, { recursive: true });
    fs.mkdirSync(reviewsDir, { recursive: true });

    const baseNow = new Date("2026-03-25T11:00:00.000Z");
    fs.writeFileSync(
      path.join(commsDir, "heartbeats.json"),
      JSON.stringify(
        {
          담: {
            agent: "담",
            status: "active",
            timestamp: makeHeartbeat(baseNow, 1),
            lastActivity: makeHeartbeat(baseNow, 1),
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    let openPrs = [
      {
        number: 761,
        title: "[M95] tap doctor [견]",
        author: { login: "견" },
        headRefName: "feat/m95-tap-doctor",
        headRefOid: "sha-1",
        changedFiles: 4,
        additions: 120,
        deletions: 10,
        updatedAt: baseNow.toISOString(),
      },
    ];
    const execSync = vi.fn(() => JSON.stringify(openPrs));

    await runChainRouterPass({ commsDir }, { execSync, fs, now: () => baseNow });

    openPrs = [];
    const firstReviewPath = path.join(reviewsDir, "review-PR761-담.md");
    fs.writeFileSync(firstReviewPath, "# review 1\n", "utf8");
    fs.utimesSync(firstReviewPath, baseNow, baseNow);

    const firstCompletion = await runChainRouterPass(
      { commsDir },
      { execSync, fs, now: () => new Date("2026-03-25T11:05:00.000Z") },
    );
    expect(firstCompletion.summary.completions).toBe(1);

    const secondCompletion = await runChainRouterPass(
      { commsDir },
      { execSync, fs, now: () => new Date("2026-03-25T11:06:00.000Z") },
    );
    expect(secondCompletion.summary.completions).toBe(0);

    const secondReviewPath = path.join(reviewsDir, "review-PR761-담-r2.md");
    fs.writeFileSync(secondReviewPath, "# review 2\n", "utf8");
    const later = new Date("2026-03-25T11:10:00.000Z");
    fs.utimesSync(secondReviewPath, later, later);

    const thirdCompletion = await runChainRouterPass(
      { commsDir },
      { execSync, fs, now: () => later },
    );
    expect(thirdCompletion.summary.completions).toBe(1);

    const authorNotifications = fs
      .readdirSync(inboxDir)
      .filter((file) => file.includes("review-done-PR761"))
      .sort();
    expect(authorNotifications).toEqual([
      "20260325-chain-견-review-done-PR761-2.md",
      "20260325-chain-견-review-done-PR761.md",
    ]);
  });

  it("does not mutate routing or completion state during dry runs", async () => {
    const commsDir = fs.mkdtempSync(path.join(os.tmpdir(), "chain-dry-run-"));
    const inboxDir = path.join(commsDir, "inbox");
    const reviewsDir = path.join(commsDir, "reviews", "gen13");
    createdDirs.push(commsDir);
    fs.mkdirSync(inboxDir, { recursive: true });
    fs.mkdirSync(reviewsDir, { recursive: true });

    const baseNow = new Date("2026-03-25T12:00:00.000Z");
    fs.writeFileSync(
      path.join(commsDir, "heartbeats.json"),
      JSON.stringify(
        {
          담: {
            agent: "담",
            status: "active",
            timestamp: makeHeartbeat(baseNow, 1),
            lastActivity: makeHeartbeat(baseNow, 1),
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    const initialState = {
      seenPrs: {
        "pr-761": {
          routed: true,
          author: "견",
          reviewer: "담",
          reviewerName: "담",
          routeRevision: "sha-1",
        },
      },
      reviewCycles: {
        "pr-761": 1,
      },
    };
    fs.writeFileSync(
      path.join(commsDir, ".chain-state.json"),
      JSON.stringify(initialState, null, 2),
      "utf8",
    );

    const reviewPath = path.join(reviewsDir, "review-PR761-담.md");
    fs.writeFileSync(reviewPath, "# clean\n", "utf8");
    fs.utimesSync(reviewPath, baseNow, baseNow);

    const execSync = vi.fn(() =>
      JSON.stringify([
        {
          number: 762,
          title: "[M97] findRepoRoot safeguard [견]",
          author: { login: "견" },
          headRefName: "feat/m97-find-root",
          headRefOid: "sha-2",
          changedFiles: 2,
          additions: 20,
          deletions: 1,
          updatedAt: new Date("2026-03-25T12:05:00.000Z").toISOString(),
        },
      ]),
    );

    const result = await runChainRouterPass(
      { commsDir, dryRun: true },
      { execSync, fs, now: () => new Date("2026-03-25T12:05:00.000Z") },
    );

    expect(result.summary).toMatchObject({
      routed: 1,
      rerouted: 0,
      skipped: 0,
      escalated: 0,
      completions: 1,
    });
    expect(result.state).toEqual(initialState);
    expect(fs.readdirSync(inboxDir)).toEqual([]);
    expect(
      JSON.parse(fs.readFileSync(path.join(commsDir, ".chain-state.json"), "utf8")),
    ).toEqual(initialState);
  });
});
