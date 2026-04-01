import { describe, expect, it } from "vitest";
import { deriveCodexSessionState } from "../engine/codex-session-state.js";

describe("deriveCodexSessionState", () => {
  it("reports initializing when no runtime heartbeat exists", () => {
    expect(deriveCodexSessionState({ runtimeHeartbeat: null })).toMatchObject({
      status: "initializing",
      turnState: null,
      summary: "initializing",
    });
  });

  it("reports active when a turn is in progress", () => {
    expect(
      deriveCodexSessionState({
        runtimeHeartbeat: {
          connected: true,
          initialized: true,
          threadId: "thread-1",
          activeTurnId: "turn-123",
          turnState: "active",
        },
      }),
    ).toMatchObject({
      status: "active",
      turnState: "active",
      activeTurnId: "turn-123",
    });
  });

  it("reports idle with idleSince when bridge is connected but not busy", () => {
    expect(
      deriveCodexSessionState({
        runtimeHeartbeat: {
          connected: true,
          initialized: true,
          threadId: "thread-1",
          turnState: "idle",
          idleSince: "2026-04-01T00:00:00.000Z",
          lastDispatchAt: "2026-04-01T00:00:00.000Z",
        },
      }),
    ).toMatchObject({
      status: "idle",
      turnState: "idle",
      idleSince: "2026-04-01T00:00:00.000Z",
    });
  });

  it("reports disconnected when the bridge lost the session", () => {
    expect(
      deriveCodexSessionState({
        runtimeHeartbeat: {
          connected: false,
          initialized: true,
          turnState: "disconnected",
        },
      }),
    ).toMatchObject({
      status: "disconnected",
      turnState: "disconnected",
      summary: "disconnected",
    });
  });
});
