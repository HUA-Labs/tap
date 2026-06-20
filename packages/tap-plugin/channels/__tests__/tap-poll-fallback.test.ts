import { describe, expect, it } from "vitest";
import { setTestEnv } from "./test-helpers.ts";

setTestEnv();

const { buildPollCycleSummary, isWatcherVerboseEnabled } =
  await import("../tap-poll-fallback.ts");

describe("tap poll fallback", () => {
  it("enables verbose mode for explicit truthy env values", () => {
    expect(isWatcherVerboseEnabled({ TAP_WATCHER_VERBOSE: "1" } as never)).toBe(
      true,
    );
    expect(
      isWatcherVerboseEnabled({ TAP_WATCHER_VERBOSE: "true" } as never),
    ).toBe(true);
    expect(
      isWatcherVerboseEnabled({ TAP_WATCHER_VERBOSE: " yes " } as never),
    ).toBe(true);
  });

  it("keeps verbose mode off by default and for falsey env values", () => {
    expect(isWatcherVerboseEnabled({} as never)).toBe(false);
    expect(isWatcherVerboseEnabled({ TAP_WATCHER_VERBOSE: "0" } as never)).toBe(
      false,
    );
    expect(
      isWatcherVerboseEnabled({ TAP_WATCHER_VERBOSE: "false" } as never),
    ).toBe(false);
  });

  it("builds poll cycle summaries with per-source totals", () => {
    const summary = buildPollCycleSummary(
      7,
      {
        recovered: 2,
        sources: [
          {
            source: "inbox",
            dir: "D:/HUA/hua-comms/inbox",
            reviewGeneration: null,
            discovered: 4,
            eligible: 2,
            recovered: 1,
            skippedBeforeServerStart: 2,
            processErrors: 0,
            dirMissing: false,
          },
          {
            source: "reviews",
            dir: "D:/HUA/hua-comms/reviews/gen9",
            reviewGeneration: "gen9",
            discovered: 3,
            eligible: 2,
            recovered: 1,
            skippedBeforeServerStart: 1,
            processErrors: 1,
            dirMissing: false,
          },
        ],
      },
      3_000,
    );

    expect(summary).toEqual({
      cycle: 7,
      intervalMs: 3_000,
      discovered: 7,
      eligible: 4,
      recovered: 2,
      skippedBeforeServerStart: 3,
      processErrors: 1,
      sources: [
        expect.objectContaining({
          source: "inbox",
          discovered: 4,
          eligible: 2,
        }),
        expect.objectContaining({
          source: "reviews",
          reviewGeneration: "gen9",
          processErrors: 1,
        }),
      ],
    });
  });
});
