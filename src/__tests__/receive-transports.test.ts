import { describe, expect, it } from "vitest";
import {
  canUseConsentDriveForAddress,
  inferReceiveTransports,
  normalizeReceiveTransports,
  prefersConsentDrive,
} from "../routing/receive-transports.js";

describe("receive transport helpers", () => {
  it("infers consent-drive for codex runtimes", () => {
    expect(inferReceiveTransports({ runtimeName: "codex" })).toEqual([
      "consent-drive",
    ]);
    expect(inferReceiveTransports({ instanceId: "codex-wt-3" })).toEqual([
      "consent-drive",
    ]);
    expect(
      inferReceiveTransports({
        runtimeStateDir: "C:/tmp/codex-app-server-bridge-codex-wt-3",
      }),
    ).toEqual(["consent-drive"]);
  });

  it("infers polling for Codex MCP clients without a bridge or runtime tuple", () => {
    expect(
      inferReceiveTransports({ mcpClientName: "codex-mcp-client" }),
    ).toEqual(["polling"]);
    expect(
      inferReceiveTransports({
        mcpClientName: "codex-mcp-client",
        runtimeName: "codex",
      }),
    ).toEqual(["consent-drive"]);
  });

  it("defaults to mcp-channel for non-codex runtimes", () => {
    expect(
      inferReceiveTransports({
        runtimeName: "claude",
        instanceId: "claude-wt-1",
        agentId: "결",
      }),
    ).toEqual(["mcp-channel"]);
  });

  it("normalizes and inspects advertised transport lists", () => {
    const transports = normalizeReceiveTransports([
      "consent-drive",
      "bogus",
      "polling",
      "mcp-channel",
      "consent-drive",
    ]);

    expect(transports).toEqual(["consent-drive", "polling", "mcp-channel"]);
    expect(prefersConsentDrive(transports)).toBe(true);
  });

  it("requires matching live address metadata before using consent-drive", () => {
    expect(
      canUseConsentDriveForAddress({
        localHostId: "DEVIN",
        address: {
          hostId: "DEVIN",
          clientId: "codex-wt-3",
          conversationId: "thread-1",
          ownerClientId: "codex-wt-3",
        },
      }),
    ).toBe(true);

    expect(
      canUseConsentDriveForAddress({
        localHostId: "DEVIN",
        address: {
          hostId: "OTHER-HOST",
          clientId: "codex-wt-3",
          conversationId: "thread-1",
          ownerClientId: "codex-wt-3",
        },
      }),
    ).toBe(false);

    expect(
      canUseConsentDriveForAddress({
        localHostId: "DEVIN",
        address: {
          hostId: "DEVIN",
          clientId: "codex-wt-3",
          conversationId: null,
          ownerClientId: "codex-wt-3",
        },
      }),
    ).toBe(false);
  });
});
