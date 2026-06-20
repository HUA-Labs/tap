import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  buildRemotePanelHtml,
  collectRemotePanelSnapshot,
  createRemotePanelServer,
  formatRemotePanelUrlHost,
  isAllowedRemotePanelBindHost,
  readEvidenceFile,
  remotePanelCommand,
} from "../commands/remote-panel.js";

let tmpDir: string;
let commsDir: string;
let stateDir: string;
let originalCwd: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tap-remote-panel-test-"));
  commsDir = path.join(tmpDir, "hua-comms");
  stateDir = path.join(tmpDir, ".tap-comms");
  fs.mkdirSync(path.join(commsDir, "inbox"), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, "package.json"), "{}", "utf8");
  originalCwd = process.cwd();
  process.chdir(tmpDir);
});

afterEach(() => {
  process.chdir(originalCwd);
  fs.rmSync(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("remote panel", () => {
  it("allows only loopback, private, and Tailscale-style bind hosts", () => {
    expect(isAllowedRemotePanelBindHost("localhost")).toBe(true);
    expect(isAllowedRemotePanelBindHost("127.0.0.1")).toBe(true);
    expect(isAllowedRemotePanelBindHost("10.0.0.2")).toBe(true);
    expect(isAllowedRemotePanelBindHost("172.16.0.1")).toBe(true);
    expect(isAllowedRemotePanelBindHost("172.31.255.254")).toBe(true);
    expect(isAllowedRemotePanelBindHost("192.168.1.20")).toBe(true);
    expect(isAllowedRemotePanelBindHost("100.64.0.1")).toBe(true);
    expect(isAllowedRemotePanelBindHost("100.121.45.22")).toBe(true);
    expect(isAllowedRemotePanelBindHost("100.127.255.254")).toBe(true);
    expect(isAllowedRemotePanelBindHost("::1")).toBe(true);
    expect(isAllowedRemotePanelBindHost("fd00::1")).toBe(true);
    expect(isAllowedRemotePanelBindHost("fe80::1")).toBe(true);

    expect(isAllowedRemotePanelBindHost("0.0.0.0")).toBe(false);
    expect(isAllowedRemotePanelBindHost("::")).toBe(false);
    expect(isAllowedRemotePanelBindHost("8.8.8.8")).toBe(false);
    expect(isAllowedRemotePanelBindHost("203.0.113.10")).toBe(false);
    expect(isAllowedRemotePanelBindHost("100.128.0.1")).toBe(false);
    expect(isAllowedRemotePanelBindHost("172.15.255.255")).toBe(false);
    expect(isAllowedRemotePanelBindHost("172.32.0.1")).toBe(false);
    expect(isAllowedRemotePanelBindHost("2001:db8::1")).toBe(false);
    expect(isAllowedRemotePanelBindHost("fe80::1%lo0")).toBe(false);
    expect(isAllowedRemotePanelBindHost("fe80::1%25lo0")).toBe(false);
    expect(isAllowedRemotePanelBindHost("example.com")).toBe(false);
    expect(isAllowedRemotePanelBindHost("sum-back")).toBe(false);
  });

  it("formats IPv6 bind hosts for URL construction", () => {
    expect(formatRemotePanelUrlHost("127.0.0.1")).toBe("127.0.0.1");
    expect(formatRemotePanelUrlHost("localhost")).toBe("localhost");
    expect(formatRemotePanelUrlHost("::1")).toBe("[::1]");
    expect(formatRemotePanelUrlHost("fd00::1")).toBe("[fd00::1]");
    expect(formatRemotePanelUrlHost("fe80::1")).toBe("[fe80::1]");

    expect(
      new URL("/api/snapshot", `http://${formatRemotePanelUrlHost("::1")}:8765`)
        .href,
    ).toBe("http://[::1]:8765/api/snapshot");
  });

  it("collects recent inbox messages and escapes rendered HTML", async () => {
    fs.writeFileSync(
      path.join(commsDir, "inbox", "20260603-jun-codex-script-test.md"),
      [
        "---",
        "from: 준",
        "to: codex",
        "subject: '<script>alert(1)</script>'",
        "---",
        "",
        "Hello <img src=x onerror=alert(1)> & goodbye",
      ].join("\n"),
      "utf8",
    );

    const snapshot = await collectRemotePanelSnapshot({
      commsDir,
      stateDir,
      agent: "codex",
      limit: 10,
      now: new Date("2026-06-03T00:00:00.000Z"),
    });

    expect(snapshot).toMatchObject({
      status: "read-only",
      readOnly: true,
      sendEnabled: false,
      receiver: {
        status: "pending",
        pendingCount: 1,
      },
      messages: [
        {
          from: "준",
          to: "codex",
          subject: "<script>alert(1)</script>",
          relativePath: "inbox/20260603-jun-codex-script-test.md",
        },
      ],
    });

    const html = buildRemotePanelHtml(snapshot);
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).not.toContain("<img src=x onerror=alert(1)>");
    expect(html).toContain("receiver queue");
    expect(html).toContain("1 pending receiver item(s)");
  });

  it("uses receiver cursor state to show pending queue items", async () => {
    fs.mkdirSync(path.join(stateDir, "receiver"), { recursive: true });
    fs.writeFileSync(
      path.join(commsDir, "inbox", "20260603-jun-codex-old.md"),
      [
        "---",
        "message_id: old-message",
        "from: 준",
        "to: codex",
        "subject: old message",
        "---",
        "",
        "already processed",
      ].join("\n"),
      "utf8",
    );
    fs.writeFileSync(
      path.join(commsDir, "inbox", "20260603-jun-codex-new.md"),
      [
        "---",
        "message_id: new-message",
        "from: 준",
        "to: codex",
        "subject: new pending <tag>",
        "---",
        "",
        "not processed yet",
      ].join("\n"),
      "utf8",
    );
    fs.writeFileSync(
      path.join(stateDir, "receiver", "supervisor.json"),
      JSON.stringify(
        {
          schemaVersion: 1,
          agent: "윤",
          aliases: ["윤", "codex"],
          createdAt: "2026-06-03T00:00:00.000Z",
          joinedAt: "2026-06-03T00:00:00.000Z",
          processed: {
            "old-message": {
              filename: "20260603-jun-codex-old.md",
              messageId: "old-message",
              mtime: "2026-06-03T00:00:00.000Z",
              processedAt: "2026-06-03T00:01:00.000Z",
            },
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    const snapshot = await collectRemotePanelSnapshot({
      commsDir,
      stateDir,
      agent: "윤",
      aliases: ["codex"],
      limit: 10,
      receiverLimit: 5,
      receiverStateName: "supervisor",
      now: new Date("2026-06-03T00:02:00.000Z"),
    });

    expect(snapshot.receiver).toMatchObject({
      status: "pending",
      pendingCount: 1,
      stateName: "supervisor",
      receiveTransport: "polling",
      adapter: "file-polling",
      skipped: {
        duplicate: 1,
      },
      items: [
        {
          path: "inbox/20260603-jun-codex-new.md",
          from: "준",
          to: "codex",
          subject: "new pending <tag>",
        },
      ],
    });

    const html = buildRemotePanelHtml(snapshot);
    expect(html).toContain("new pending &lt;tag&gt;");
    expect(html).toContain("1 message(s) are waiting for 윤.");
    expect(html).toContain("Transport: polling/file-polling.");
    expect(html).toContain("AX:");
    expect(html).toContain("state supervisor");
    expect(html).toContain(
      "skipped old 0 · duplicate 1 · not-for-agent 0 · own 0",
    );
    expect(html).toContain('href="/api/snapshot"');
    expect(html).toContain("Pending receiver item.");
    expect(html).toContain("debug evidence");
    expect(html).not.toContain("statePath");
    expect(html).not.toContain("inbox/20260603-jun-codex-new.md |");
    expect(html).not.toContain("new pending <tag>");
  });

  it("refuses path traversal when reading evidence files", () => {
    fs.writeFileSync(
      path.join(commsDir, "inbox", "safe.md"),
      "safe evidence",
      "utf8",
    );
    fs.writeFileSync(path.join(tmpDir, "secret.md"), "secret", "utf8");

    expect(readEvidenceFile(commsDir, "inbox/safe.md")).toMatchObject({
      ok: true,
      status: 200,
      content: "safe evidence",
    });
    expect(readEvidenceFile(commsDir, "../secret.md")).toMatchObject({
      ok: false,
      status: 400,
    });
    expect(readEvidenceFile(commsDir, "/inbox/safe.md")).toMatchObject({
      ok: false,
      status: 400,
    });
    expect(readEvidenceFile(commsDir, "receipts/safe.md")).toMatchObject({
      ok: false,
      status: 400,
    });
  });

  it("keeps the HTTP panel read-only", async () => {
    const server = createRemotePanelServer({
      host: "127.0.0.1",
      port: 0,
      agent: "윤",
      aliases: ["codex"],
      commsDir,
      stateDir,
      limit: 10,
      receiverLimit: 5,
      receiverSinceMinutes: 60,
      readOnly: true,
      sendEnabled: false,
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("expected TCP server address");
    }
    try {
      const response = await fetch(
        `http://127.0.0.1:${address.port}/api/snapshot`,
        {
          method: "POST",
        },
      );
      expect(response.status).toBe(405);
      expect(await response.text()).toBe(
        "remote panel supports GET only except /api/send",
      );
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    }
  });

  it("requires explicit read-only mode and refuses public binds", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});

    await expect(
      remotePanelCommand([
        "--host",
        "203.0.113.10",
        "--port",
        "8765",
        "--agent",
        "윤",
        "--read-only",
        "--comms-dir",
        commsDir,
      ]),
    ).resolves.toMatchObject({
      ok: false,
      code: "TAP_INVALID_ARGUMENT",
    });

    await expect(
      remotePanelCommand([
        "--host",
        "0.0.0.0",
        "--port",
        "8765",
        "--agent",
        "윤",
        "--read-only",
        "--comms-dir",
        commsDir,
      ]),
    ).resolves.toMatchObject({
      ok: false,
      code: "TAP_INVALID_ARGUMENT",
    });

    await expect(
      remotePanelCommand([
        "--host",
        "127.0.0.1",
        "--port",
        "8765",
        "--agent",
        "윤",
        "--comms-dir",
        commsDir,
      ]),
    ).resolves.toMatchObject({
      ok: false,
      code: "TAP_INVALID_ARGUMENT",
    });
  });

  it("writes append-only inbox evidence when send is token-enabled", async () => {
    const server = createRemotePanelServer({
      host: "127.0.0.1",
      port: 0,
      agent: "윤",
      aliases: ["codex"],
      commsDir,
      stateDir,
      limit: 10,
      receiverLimit: 5,
      receiverSinceMinutes: 60,
      readOnly: true,
      sendEnabled: true,
      tokenEnv: "TAP_REMOTE_PANEL_TOKEN",
      sendToken: "1234",
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("expected TCP server address");
    }
    try {
      const badToken = await fetch(
        `http://127.0.0.1:${address.port}/api/send`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Tap-Panel-Token": "wrong",
          },
          body: JSON.stringify({
            to: "준",
            subject: "remote panel ping",
            content: "hello",
          }),
        },
      );
      expect(badToken.status).toBe(403);
      expect(fs.readdirSync(path.join(commsDir, "inbox"))).toHaveLength(0);

      const response = await fetch(
        `http://127.0.0.1:${address.port}/api/send`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Tap-Panel-Token": "1234",
          },
          body: JSON.stringify({
            to: "준",
            subject: "remote panel ping",
            content: "hello from phone",
          }),
        },
      );
      expect(response.status).toBe(201);
      const result = (await response.json()) as {
        ok: boolean;
        evidencePath: string;
        liveAttempted: boolean;
        sendMode: string;
      };
      expect(result).toMatchObject({
        ok: true,
        sendMode: "append-only-inbox",
        liveAttempted: false,
      });
      const files = fs.readdirSync(path.join(commsDir, "inbox"));
      expect(files).toHaveLength(1);
      expect(result.evidencePath).toBe(`inbox/${files[0]}`);
      const written = fs.readFileSync(
        path.join(commsDir, "inbox", files[0]),
        "utf8",
      );
      expect(written).toContain("type: inbox");
      expect(written).toContain("from: 윤");
      expect(written).toContain("to: 준");
      expect(written).toContain("action: remote-panel-send");
      expect(written).toContain('"routingAddress":"윤"');
      expect(written).toContain('"routingAddress":"준"');
      expect(written).toContain("hello from phone");
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    }
  });

  it("requires a token env before enabling send mode", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    delete process.env.TAP_REMOTE_PANEL_TOKEN;

    await expect(
      remotePanelCommand([
        "--host",
        "127.0.0.1",
        "--port",
        "8765",
        "--agent",
        "윤",
        "--send-enabled",
        "--token-env",
        "TAP_REMOTE_PANEL_TOKEN",
        "--comms-dir",
        commsDir,
      ]),
    ).resolves.toMatchObject({
      ok: false,
      code: "TAP_INVALID_ARGUMENT",
    });
  });
});
