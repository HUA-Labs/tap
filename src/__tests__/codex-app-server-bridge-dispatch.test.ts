import { afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  buildOptions,
  dispatchCandidate,
  DRIVE_ACTION_NOT_YET_SUPPORTED_REASON,
  writeHeartbeat,
} from "../../scripts/codex/codex-app-server-bridge.js";

describe("codex app-server bridge approval blocking", () => {
  const createdDirs: string[] = [];

  afterEach(() => {
    while (createdDirs.length > 0) {
      const dir = createdDirs.pop();
      if (dir) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }

    vi.restoreAllMocks();
  });

  function makeOptions(agentName = "현") {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bridge-dispatch-"));
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

  function makeCandidate(overrides: Record<string, unknown> = {}) {
    return {
      markerId: "candidate-1",
      filePath: "D:/repo/hua-comms/inbox/20260409-길-현-ping.md",
      fileName: "20260409-길-현-ping.md",
      sender: "길",
      recipient: "현",
      subject: "ping",
      body: "hello",
      mtimeMs: Date.now(),
      ...overrides,
    };
  }

  function readLedgerEntries(options: ReturnType<typeof makeOptions>) {
    const ledgerDir = path.join(options.commsDir, "receipts", "consent-ledger");
    if (!fs.existsSync(ledgerDir)) {
      return [];
    }
    return fs
      .readdirSync(ledgerDir)
      .sort()
      .map((name) => ({
        name,
        content: fs.readFileSync(path.join(ledgerDir, name), "utf8"),
      }));
  }

  function makeDriveTransport() {
    return {
      connect: vi.fn(async () => undefined),
      disconnect: vi.fn(async () => undefined),
      startTurn: vi.fn(async () => ({
        response: {
          result: {
            ok: true,
            turn: {
              id: "remote-turn-1",
            },
          },
        },
      })),
    };
  }

  it("does not start a fresh turn while the current thread is waiting on approval", async () => {
    const options = makeOptions();
    const client = {
      threadId: "thread-1",
      activeTurnId: null as string | null,
      turnStartedAt: null as string | null,
      lastTurnStatus: "waitingOnApproval" as string | null,
      isBusy: vi.fn(() => false),
      isWaitingOnApproval: vi.fn(() => true),
      startTurn: vi.fn(),
      steerTurn: vi.fn(),
      refreshCurrentThreadState: vi.fn(async () => undefined),
    };

    await expect(
      dispatchCandidate(client as never, options, makeCandidate(), {}),
    ).resolves.toBe(false);

    expect(client.startTurn).not.toHaveBeenCalled();
    expect(client.steerTurn).not.toHaveBeenCalled();
  });

  it("dispatches legacy candidates through the existing start-turn path", async () => {
    const options = makeOptions();
    const client = {
      threadId: "thread-1",
      activeTurnId: null as string | null,
      turnStartedAt: null as string | null,
      lastTurnStatus: null as string | null,
      isBusy: vi.fn(() => false),
      isWaitingOnApproval: vi.fn(() => false),
      startTurn: vi.fn(async () => "turn-1"),
      steerTurn: vi.fn(),
      refreshCurrentThreadState: vi.fn(async () => undefined),
    };

    await expect(
      dispatchCandidate(client as never, options, makeCandidate(), {}),
    ).resolves.toBe(true);

    expect(client.startTurn).toHaveBeenCalledTimes(1);
    expect(client.steerTurn).not.toHaveBeenCalled();
  });

  it("keeps observe-scoped envelopes on the existing legacy dispatch path", async () => {
    const options = makeOptions();
    const client = {
      threadId: "thread-1",
      activeTurnId: null as string | null,
      turnStartedAt: null as string | null,
      lastTurnStatus: null as string | null,
      isBusy: vi.fn(() => false),
      isWaitingOnApproval: vi.fn(() => false),
      startTurn: vi.fn(async () => "turn-1"),
      steerTurn: vi.fn(),
      refreshCurrentThreadState: vi.fn(async () => undefined),
    };

    await expect(
      dispatchCandidate(
        client as never,
        options,
        makeCandidate({
          scope: "observe",
          messageId: "observe-1",
        }),
        {},
      ),
    ).resolves.toBe(true);

    expect(client.startTurn).toHaveBeenCalledTimes(1);
    expect(client.steerTurn).not.toHaveBeenCalled();
  });

  it("hands drive start-turn envelopes to the control transport", async () => {
    const options = makeOptions();
    const client = {
      threadId: "thread-1",
      activeTurnId: null as string | null,
      turnStartedAt: null as string | null,
      lastTurnStatus: null as string | null,
      isBusy: vi.fn(() => false),
      isWaitingOnApproval: vi.fn(() => false),
      startTurn: vi.fn(),
      steerTurn: vi.fn(),
      refreshCurrentThreadState: vi.fn(async () => undefined),
    };
    const driveTransport = makeDriveTransport();

    await expect(
      dispatchCandidate(
        client as never,
        options,
        makeCandidate({
          messageId: "drive-1",
          scope: "drive",
          action: "thread-follower-start-turn",
          consentRef: "receipt-1",
          toAddress: {
            hostId: "DEVIN",
            clientId: "codex_impl",
            conversationId: "thread-99",
            ownerClientId: "codex_impl",
            routingAddress: "codex_impl",
          },
          body: "bridge wiring now",
        }),
        {},
        () => driveTransport,
      ),
    ).resolves.toBe(true);

    expect(client.startTurn).not.toHaveBeenCalled();
    expect(client.steerTurn).not.toHaveBeenCalled();
    expect(driveTransport.connect).toHaveBeenCalledTimes(1);
    expect(driveTransport.startTurn).toHaveBeenCalledWith({
      conversationId: "thread-99",
      text: "bridge wiring now",
      action: "thread-follower-start-turn",
      consentRef: "receipt-1",
      hostId: "DEVIN",
      ownerClientId: "codex_impl",
    });
    expect(driveTransport.disconnect).toHaveBeenCalledTimes(1);

    expect(
      fs.existsSync(
        path.join(options.stateDir, "processed", "candidate-1.done"),
      ),
    ).toBe(true);

    const lastDispatch = JSON.parse(
      fs.readFileSync(
        path.join(options.stateDir, "last-dispatch.json"),
        "utf8",
      ),
    );
    expect(lastDispatch).toMatchObject({
      dispatchMode: "drive",
      requestName: "20260409-길-현-ping.md",
      threadId: "thread-99",
      turnId: "remote-turn-1",
    });

    const processed = JSON.parse(
      fs.readFileSync(
        path.join(options.stateDir, "processed", "candidate-1.done"),
        "utf8",
      ),
    );
    expect(processed).toMatchObject({
      dispatchMode: "drive",
      requestName: "20260409-길-현-ping.md",
      threadId: "thread-99",
      turnId: "remote-turn-1",
    });
  });

  it("extracts live nested IPC turn ids from drive responses", async () => {
    const options = makeOptions();
    const client = {
      threadId: "thread-1",
      activeTurnId: null as string | null,
      turnStartedAt: null as string | null,
      lastTurnStatus: null as string | null,
      isBusy: vi.fn(() => false),
      isWaitingOnApproval: vi.fn(() => false),
      startTurn: vi.fn(),
      steerTurn: vi.fn(),
      refreshCurrentThreadState: vi.fn(async () => undefined),
    };
    const driveTransport = {
      connect: vi.fn(async () => undefined),
      disconnect: vi.fn(async () => undefined),
      startTurn: vi.fn(async () => ({
        response: {
          result: {
            result: {
              turn: {
                id: "remote-turn-live",
              },
            },
          },
        },
      })),
    };

    await expect(
      dispatchCandidate(
        client as never,
        options,
        makeCandidate({
          messageId: "drive-2",
          scope: "drive",
          action: "thread-follower-start-turn",
          consentRef: "receipt-2",
          toAddress: {
            hostId: "DEVIN",
            clientId: "codex_impl",
            conversationId: "thread-99",
            ownerClientId: "codex_impl",
            routingAddress: "codex_impl",
          },
          body: "bridge wiring nested shape",
        }),
        {},
        () => driveTransport,
      ),
    ).resolves.toBe(true);

    const lastDispatch = JSON.parse(
      fs.readFileSync(
        path.join(options.stateDir, "last-dispatch.json"),
        "utf8",
      ),
    );
    expect(lastDispatch).toMatchObject({
      dispatchMode: "drive",
      requestName: "20260409-길-현-ping.md",
      threadId: "thread-99",
      turnId: "remote-turn-live",
    });
  });

  it("leaves unsupported drive actions pending for a later handoff phase", async () => {
    const options = makeOptions();
    const client = {
      threadId: "thread-1",
      activeTurnId: null as string | null,
      turnStartedAt: null as string | null,
      lastTurnStatus: null as string | null,
      isBusy: vi.fn(() => false),
      isWaitingOnApproval: vi.fn(() => false),
      startTurn: vi.fn(),
      steerTurn: vi.fn(),
      refreshCurrentThreadState: vi.fn(async () => undefined),
    };
    const driveTransport = makeDriveTransport();

    await expect(
      dispatchCandidate(
        client as never,
        options,
        makeCandidate({
          messageId: "drive-unsupported-1",
          scope: "drive",
          action: "thread-follower-steer-turn",
          consentRef: "receipt-1",
          toAddress: {
            hostId: "DEVIN",
            clientId: "codex_impl",
            conversationId: "thread-99",
            ownerClientId: "codex_impl",
            routingAddress: "codex_impl",
          },
        }),
        {},
        () => driveTransport,
      ),
    ).resolves.toBe(false);

    expect(client.startTurn).not.toHaveBeenCalled();
    expect(client.steerTurn).not.toHaveBeenCalled();
    expect(driveTransport.connect).not.toHaveBeenCalled();
    expect(driveTransport.startTurn).not.toHaveBeenCalled();

    expect(
      fs.existsSync(
        path.join(options.stateDir, "processed", "candidate-1.done"),
      ),
    ).toBe(false);

    const lastDispatch = JSON.parse(
      fs.readFileSync(
        path.join(options.stateDir, "last-dispatch.json"),
        "utf8",
      ),
    );
    expect(lastDispatch).toMatchObject({
      dispatchMode: "blocked",
      blockedReason: `${DRIVE_ACTION_NOT_YET_SUPPORTED_REASON}: thread-follower-steer-turn`,
      requestName: "20260409-길-현-ping.md",
    });

    const ledgerEntries = readLedgerEntries(options);
    expect(ledgerEntries.map((entry) => entry.name)).toEqual(
      expect.arrayContaining([expect.stringContaining("-rejected-")]),
    );
    expect(ledgerEntries[0]?.content).toContain(
      'result: "drive action is not yet wired through bridge dispatch: thread-follower-steer-turn"',
    );
  });

  it("writes waiting-approval into the runtime heartbeat when approval blocks progress", () => {
    const options = makeOptions();
    const client = {
      connected: true,
      initialized: true,
      threadId: "thread-1",
      currentThreadCwd: options.repoRoot,
      activeTurnId: null as string | null,
      turnStartedAt: null as string | null,
      lastTurnStatus: "waitingOnApproval" as string | null,
      lastNotificationMethod: null as string | null,
      lastNotificationAt: null as string | null,
      lastError: null as string | null,
      lastSuccessfulAppServerAt: null as string | null,
      lastSuccessfulAppServerMethod: null as string | null,
    };

    writeHeartbeat(options, client as never, {
      consecutiveFailureCount: 0,
    });

    const heartbeat = JSON.parse(
      fs.readFileSync(path.join(options.stateDir, "heartbeat.json"), "utf8"),
    );
    expect(heartbeat.turnState).toBe("waiting-approval");
    expect(heartbeat.lastTurnStatus).toBe("waitingOnApproval");
  });
});
