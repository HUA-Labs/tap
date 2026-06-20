import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  __setWindowsRouteRecoverCommandRunnerForTests,
  windowsRouteRecoverCommand,
} from "../commands/windows-route-recover.js";

let tmpDir: string;
let centralDir: string;

const remoteHosts = JSON.stringify({
  "D:\\HUA\\hua-comms": {
    ssh: "devin-win-ts",
    repo: "D:\\HUA\\hua-platform",
    commsDir: "D:\\HUA\\hua-comms",
    hostAliases: ["DEVIN", "devin"],
  },
});

function writeCentralPresence(overrides: Record<string, unknown> = {}): void {
  const presenceDir = path.join(centralDir, "presence");
  fs.mkdirSync(presenceDir, { recursive: true });
  fs.writeFileSync(
    path.join(presenceDir, "솔.json"),
    JSON.stringify(
      {
        agent: "솔",
        timestamp: new Date().toISOString(),
        receiveTransports: ["consent-drive"],
        address: {
          hostId: "DEVIN",
          routingAddress: "솔",
          conversationId: "thread-live",
          ownerClientId: "owner-live",
        },
        capabilities: {
          receiveTransports: ["consent-drive"],
          conversationId: "thread-live",
          ownerClientId: "owner-live",
        },
        consentDriveStatus: "ready",
        presenceFreshness: "fresh-for-routing",
        ...overrides,
      },
      null,
      2,
    ),
    "utf8",
  );
}

function presenceOutput(options: {
  sourceFresh: boolean;
  centralFresh: boolean;
}): string {
  return JSON.stringify({
    ok: true,
    ready: options.sourceFresh && options.centralFresh,
    records: [],
    checks: [
      {
        role: "source",
        agent: "솔",
        endpoint: "devin-win-ts:D:/HUA/hua-comms",
        exists: true,
        freshness: options.sourceFresh ? "fresh-for-routing" : "stale-visible",
        consentDriveStatus: options.sourceFresh ? "ready" : "stale",
        freshForRouting: options.sourceFresh,
        conversationId: "thread-live",
        ownerClientId: "owner-live",
        receiveTransports: ["consent-drive"],
      },
      {
        role: "target",
        agent: "솔",
        endpoint: centralDir,
        exists: true,
        freshness: options.centralFresh ? "fresh-for-routing" : "stale-visible",
        consentDriveStatus: options.centralFresh ? "ready" : "stale",
        freshForRouting: options.centralFresh,
        conversationId: "thread-live",
        ownerClientId: "owner-live",
        receiveTransports: ["consent-drive"],
      },
    ],
  });
}

function readyOutput(status: "stale-presence" | "fresh-route-ready"): string {
  return JSON.stringify({
    ok: true,
    data: {
      windowsRouteHealth: {
        status,
        message:
          status === "stale-presence"
            ? "live Windows App conversation thread-live has no matching fresh durable presence"
            : "durable presence matches live Windows App conversation thread-live",
        requestedConversationId: "thread-live",
        presenceConversationId:
          status === "fresh-route-ready" ? "thread-live" : "thread-old",
        presenceOwnerClientId:
          status === "fresh-route-ready" ? "owner-live" : "owner-old",
        presenceFreshness:
          status === "fresh-route-ready"
            ? "fresh-for-routing"
            : "stale-visible",
        presenceAgeMinutes: status === "fresh-route-ready" ? 1 : 60,
        candidates: [
          {
            conversationId: "thread-live",
            ownerClientId: "owner-live",
            hostId: "DEVIN",
            lastChangeType: "snapshot",
            lastTurnId: null,
            lastTurnStatus: null,
            hasError: null,
            matchesRequestedConversation: true,
            matchesPresenceConversation: status === "fresh-route-ready",
            matchesPresenceOwner: status === "fresh-route-ready",
          },
        ],
      },
    },
  });
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tap-route-recover-"));
  centralDir = path.join(tmpDir, "hua-comms");
  fs.mkdirSync(path.join(centralDir, "presence"), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, "package.json"), "{}", "utf8");
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
  __setWindowsRouteRecoverCommandRunnerForTests(null);
});

describe("windowsRouteRecoverCommand", () => {
  it("plans stale-but-target-ready Windows route recovery without mutation", async () => {
    writeCentralPresence({
      timestamp: "2000-01-01T00:00:00.000Z",
      lastActivity: "2000-01-01T00:00:00.000Z",
    });
    const calls: string[] = [];
    __setWindowsRouteRecoverCommandRunnerForTests((request) => {
      calls.push(request.kind);
      if (request.kind === "presence-check") {
        return {
          ok: true,
          status: 0,
          stdout: presenceOutput({ sourceFresh: false, centralFresh: false }),
          stderr: "",
        };
      }
      if (request.kind === "remote-ready-dry-run") {
        return {
          ok: true,
          status: 0,
          stdout: readyOutput("stale-presence"),
          stderr: "",
        };
      }
      throw new Error(`unexpected ${request.kind}`);
    });

    const result = await windowsRouteRecoverCommand([
      "--agent",
      "솔",
      "--conversation-id",
      "thread-live",
      "--remote-hosts",
      remoteHosts,
      "--central",
      centralDir,
      "--apply",
      "--dry-run",
    ]);

    expect(result.ok).toBe(false);
    expect(result.data.status).toBe("needs-recovery");
    expect(result.data.classification).toBe("ttl-expired-target-ready");
    expect(result.data.host).toMatchObject({
      requestedHost: "devin",
      sshTarget: "devin-win-ts",
      configSource: "active-env",
    });
    expect(result.data.actions).toContainEqual(
      expect.objectContaining({
        name: "windows-route-refresh",
        status: "would-apply",
      }),
    );
    expect(calls).toEqual(["presence-check", "remote-ready-dry-run"]);
  });

  it("applies target refresh then guarded-publishes only selected presence", async () => {
    writeCentralPresence({
      timestamp: "2000-01-01T00:00:00.000Z",
      lastActivity: "2000-01-01T00:00:00.000Z",
    });
    const calls: string[] = [];
    let checkCount = 0;
    __setWindowsRouteRecoverCommandRunnerForTests((request) => {
      calls.push(request.kind);
      if (request.kind === "presence-check") {
        checkCount += 1;
        return {
          ok: true,
          status: 0,
          stdout: presenceOutput({
            sourceFresh: checkCount > 1,
            centralFresh: false,
          }),
          stderr: "",
        };
      }
      if (request.kind === "remote-ready-dry-run") {
        return {
          ok: true,
          status: 0,
          stdout: readyOutput("stale-presence"),
          stderr: "",
        };
      }
      if (request.kind === "remote-ready-refresh") {
        return {
          ok: true,
          status: 0,
          stdout: JSON.stringify({ ok: true }),
          stderr: "",
        };
      }
      if (request.kind === "presence-publish") {
        writeCentralPresence();
        return {
          ok: true,
          status: 0,
          stdout: presenceOutput({ sourceFresh: true, centralFresh: true }),
          stderr: "",
        };
      }
      throw new Error(`unexpected ${request.kind}`);
    });

    const result = await windowsRouteRecoverCommand([
      "--agent",
      "솔",
      "--conversation-id",
      "thread-live",
      "--remote-hosts",
      remoteHosts,
      "--central",
      centralDir,
      "--apply",
    ]);

    expect(result.ok).toBe(true);
    expect(result.data.status).toBe("recovered");
    expect(result.data.routeDryRunProof).toMatchObject({
      transport: "consent-drive",
      liveAttemptStatus: "would-attempt",
      fallbackToInbox: false,
    });
    expect(result.data.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "windows-route-refresh",
          status: "applied",
        }),
        expect.objectContaining({
          name: "presence-publish",
          status: "applied",
        }),
      ]),
    );
    expect(calls).toEqual([
      "presence-check",
      "remote-ready-dry-run",
      "remote-ready-refresh",
      "presence-check",
      "presence-publish",
    ]);
  });

  it("surfaces configured host alias drift separately from route recovery", async () => {
    writeCentralPresence();
    const codexHome = path.join(tmpDir, "codex-home");
    fs.mkdirSync(codexHome, { recursive: true });
    const configPath = path.join(codexHome, "config.toml");
    fs.writeFileSync(
      configPath,
      [
        "[mcp_servers.tap.env]",
        `TAP_CODEX_REMOTE_HOSTS = ${JSON.stringify(remoteHosts)}`,
        "",
      ].join("\n"),
      "utf8",
    );
    __setWindowsRouteRecoverCommandRunnerForTests((request) => {
      if (request.kind === "presence-check") {
        return {
          ok: true,
          status: 0,
          stdout: presenceOutput({ sourceFresh: true, centralFresh: true }),
          stderr: "",
        };
      }
      if (request.kind === "remote-ready-dry-run") {
        return {
          ok: true,
          status: 0,
          stdout: readyOutput("fresh-route-ready"),
          stderr: "",
        };
      }
      throw new Error(`unexpected ${request.kind}`);
    });

    const result = await windowsRouteRecoverCommand([
      "--agent",
      "솔",
      "--conversation-id",
      "thread-live",
      "--remote-hosts",
      JSON.stringify({}),
      "--codex-config",
      configPath,
      "--central",
      centralDir,
    ]);

    expect(result.ok).toBe(false);
    expect(result.data.status).toBe("blocked");
    expect(result.data.classification).toBe("remote-host-config-drift");
    expect(result.data.host).toMatchObject({
      configSource: "configured-env",
      sshTarget: "devin-win-ts",
      status: "config-drift",
    });
    expect(result.data.routeDryRunProof).toMatchObject({
      liveAttemptStatus: "not-attempted",
      fallbackToInbox: true,
    });
    expect(result.data.next).toContain(
      "reload/restart the tap MCP runtime so active TAP_CODEX_REMOTE_HOSTS matches config.toml",
    );
  });

  it("proves structured delivery would use consent-drive when source, central, and target are ready", async () => {
    writeCentralPresence();
    __setWindowsRouteRecoverCommandRunnerForTests((request) => {
      if (request.kind === "presence-check") {
        return {
          ok: true,
          status: 0,
          stdout: presenceOutput({ sourceFresh: true, centralFresh: true }),
          stderr: "",
        };
      }
      if (request.kind === "remote-ready-dry-run") {
        return {
          ok: true,
          status: 0,
          stdout: readyOutput("fresh-route-ready"),
          stderr: "",
        };
      }
      throw new Error(`unexpected ${request.kind}`);
    });

    const result = await windowsRouteRecoverCommand([
      "--agent",
      "솔",
      "--conversation-id",
      "thread-live",
      "--remote-hosts",
      remoteHosts,
      "--central",
      centralDir,
    ]);

    expect(result.ok).toBe(true);
    expect(result.data.status).toBe("ready");
    expect(result.data.classification).toBe("fresh-ready");
    expect(result.data.routeDryRunProof).toEqual(
      expect.objectContaining({
        transport: "consent-drive",
        liveAttemptStatus: "would-attempt",
        fallbackToInbox: false,
      }),
    );
  });

  it("allows scheduler to proactively refresh an already fresh selected route", async () => {
    writeCentralPresence();
    const calls: string[] = [];
    __setWindowsRouteRecoverCommandRunnerForTests((request) => {
      calls.push(request.kind);
      if (request.kind === "presence-check") {
        return {
          ok: true,
          status: 0,
          stdout: presenceOutput({ sourceFresh: true, centralFresh: true }),
          stderr: "",
        };
      }
      if (request.kind === "remote-ready-dry-run") {
        return {
          ok: true,
          status: 0,
          stdout: readyOutput("fresh-route-ready"),
          stderr: "",
        };
      }
      if (request.kind === "remote-ready-refresh") {
        return {
          ok: true,
          status: 0,
          stdout: JSON.stringify({ ok: true }),
          stderr: "",
        };
      }
      if (request.kind === "presence-publish") {
        return {
          ok: true,
          status: 0,
          stdout: presenceOutput({ sourceFresh: true, centralFresh: true }),
          stderr: "",
        };
      }
      throw new Error(`unexpected ${request.kind}`);
    });

    const result = await windowsRouteRecoverCommand([
      "--agent",
      "솔",
      "--conversation-id",
      "thread-live",
      "--remote-hosts",
      remoteHosts,
      "--central",
      centralDir,
      "--apply",
      "--force-fresh-route-refresh",
    ]);

    expect(result.ok).toBe(true);
    expect(result.data.status).toBe("recovered");
    expect(result.data.classification).toBe("fresh-ready");
    expect(result.data.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "windows-route-refresh",
          status: "applied",
          message:
            "refreshed target-local Windows presence from already fresh live IPC tuple",
        }),
        expect.objectContaining({
          name: "presence-publish",
          status: "applied",
        }),
      ]),
    );
    expect(calls).toEqual([
      "presence-check",
      "remote-ready-dry-run",
      "remote-ready-refresh",
      "presence-check",
      "presence-publish",
    ]);
  });
});
