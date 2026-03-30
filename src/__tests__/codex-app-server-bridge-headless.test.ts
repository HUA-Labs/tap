import { afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  HEADLESS_WARMUP_PROMPT,
  buildOptions,
  maybeBootstrapHeadlessTurn,
  waitForTurnCompletion,
} from "../../scripts/codex-app-server-bridge.ts";

describe("codex app-server bridge headless cold-start", () => {
  const createdDirs: string[] = [];
  const originalHeadless = process.env.TAP_HEADLESS;
  const originalColdStartWarmup = process.env.TAP_COLD_START_WARMUP;

  afterEach(() => {
    while (createdDirs.length > 0) {
      const dir = createdDirs.pop();
      if (dir) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }

    if (originalHeadless === undefined) {
      delete process.env.TAP_HEADLESS;
    } else {
      process.env.TAP_HEADLESS = originalHeadless;
    }

    if (originalColdStartWarmup === undefined) {
      delete process.env.TAP_COLD_START_WARMUP;
    } else {
      process.env.TAP_COLD_START_WARMUP = originalColdStartWarmup;
    }

    vi.restoreAllMocks();
  });

  function makeOptions(agentName = "온") {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bridge-headless-"));
    createdDirs.push(repoRoot);

    const commsDir = path.join(repoRoot, "hua-comms");
    const stateDir = path.join(repoRoot, ".tmp", "codex-app-server-bridge");
    fs.mkdirSync(path.join(commsDir, "inbox"), { recursive: true });

    return buildOptions([
      "--repo-root",
      repoRoot,
      "--comms-dir",
      commsDir,
      "--state-dir",
      stateDir,
      "--agent-name",
      agentName,
      "--run-once",
    ]);
  }

  it("waits for a turn to complete by refreshing thread state", async () => {
    const client = {
      activeTurnId: "turn-1" as string | null,
      lastTurnStatus: null as string | null,
      refreshCurrentThreadState: vi.fn(async () => {
        client.activeTurnId = null;
        client.lastTurnStatus = "completed";
      }),
    };

    await expect(waitForTurnCompletion(client, "turn-1", 1_000)).resolves.toBe(
      "completed",
    );
    expect(client.refreshCurrentThreadState).toHaveBeenCalled();
  });

  it("starts a warmup turn for headless cold-start when inbox is empty", async () => {
    process.env.TAP_HEADLESS = "true";
    const options = makeOptions();

    const client = {
      activeTurnId: null as string | null,
      lastTurnStatus: null as string | null,
      startTurn: vi.fn(async (inputText: string) => {
        expect(inputText).toBe(HEADLESS_WARMUP_PROMPT);
        client.activeTurnId = "turn-1";
        return "turn-1";
      }),
      refreshCurrentThreadState: vi.fn(async () => {
        client.activeTurnId = null;
        client.lastTurnStatus = "completed";
      }),
    };

    await expect(
      maybeBootstrapHeadlessTurn(options, new Date(0), client),
    ).resolves.toBe(true);
    expect(client.startTurn).toHaveBeenCalledTimes(1);
  });

  it("starts a warmup turn for tap up cold-start without TAP_HEADLESS", async () => {
    process.env.TAP_COLD_START_WARMUP = "true";
    const options = makeOptions();

    const client = {
      activeTurnId: null as string | null,
      lastTurnStatus: null as string | null,
      startTurn: vi.fn(async (inputText: string) => {
        expect(inputText).toBe(HEADLESS_WARMUP_PROMPT);
        client.activeTurnId = "turn-1";
        return "turn-1";
      }),
      refreshCurrentThreadState: vi.fn(async () => {
        client.activeTurnId = null;
        client.lastTurnStatus = "completed";
      }),
    };

    await expect(
      maybeBootstrapHeadlessTurn(options, new Date(0), client),
    ).resolves.toBe(true);
    expect(client.startTurn).toHaveBeenCalledTimes(1);
  });

  it("skips warmup when a pending inbox message already exists", async () => {
    process.env.TAP_HEADLESS = "true";
    const options = makeOptions();
    fs.writeFileSync(
      path.join(options.commsDir, "inbox", "20260325-초-온-ping.md"),
      "hello",
      "utf8",
    );

    const client = {
      activeTurnId: null as string | null,
      lastTurnStatus: null as string | null,
      startTurn: vi.fn(),
      refreshCurrentThreadState: vi.fn(async () => undefined),
    };

    await expect(
      maybeBootstrapHeadlessTurn(options, new Date(0), client),
    ).resolves.toBe(false);
    expect(client.startTurn).not.toHaveBeenCalled();
  });

  it("surfaces a doctor hint when warmup finishes with a non-completed status", async () => {
    process.env.TAP_HEADLESS = "true";
    const options = makeOptions();

    const client = {
      activeTurnId: null as string | null,
      lastTurnStatus: null as string | null,
      startTurn: vi.fn(async () => {
        client.activeTurnId = "turn-1";
        return "turn-1";
      }),
      refreshCurrentThreadState: vi.fn(async () => {
        client.activeTurnId = null;
        client.lastTurnStatus = "failed";
      }),
    };

    await expect(
      maybeBootstrapHeadlessTurn(options, new Date(0), client),
    ).rejects.toThrow(/tap doctor/i);
  });
});
