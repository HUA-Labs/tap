import { afterEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  buildOptions,
  buildUserInput,
  chooseLoadedThreadForCwd,
  isOwnMessageSender,
  isTurnStale,
  isTurnStuckOnApproval,
  loadResumableThreadState,
  recipientMatchesAgent,
  resolveAddressLabel,
  resolveCurrentAgentName,
  sanitizeErrorForPersistence,
  STALE_TURN_MS,
  stripBridgeFrontmatter,
  threadCwdMatches,
} from "../../../../scripts/codex-app-server-bridge.js";

describe("codex app-server bridge option building", () => {
  const createdDirs: string[] = [];
  const originalTapAgentId = process.env.TAP_AGENT_ID;

  afterEach(() => {
    while (createdDirs.length > 0) {
      const dir = createdDirs.pop();
      if (dir) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }

    if (originalTapAgentId === undefined) {
      delete process.env.TAP_AGENT_ID;
    } else {
      process.env.TAP_AGENT_ID = originalTapAgentId;
    }
  });

  it("resolves .tap-config commsDir relative to repoRoot", () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bridge-options-"));
    createdDirs.push(repoRoot);
    fs.writeFileSync(
      path.join(repoRoot, ".tap-config"),
      'TAP_COMMS_DIR="../hua-comms"\n',
      "utf8",
    );

    const options = buildOptions(["--repo-root", repoRoot, "--run-once"]);

    expect(options.commsDir).toBe(path.resolve(repoRoot, "../hua-comms"));
  });

  it("keeps explicit agent-name ahead of stale agent-name.txt", () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bridge-agent-"));
    createdDirs.push(repoRoot);
    const commsDir = path.join(repoRoot, "hua-comms");
    const stateDir = path.join(repoRoot, ".tmp", "codex-app-server-bridge");
    fs.mkdirSync(commsDir, { recursive: true });
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(path.join(stateDir, "agent-name.txt"), "stale\n", "utf8");

    const options = buildOptions([
      "--repo-root",
      repoRoot,
      "--comms-dir",
      commsDir,
      "--state-dir",
      stateDir,
      "--agent-name",
      "fresh",
      "--run-once",
    ]);

    expect(options.agentName).toBe("fresh");
    expect(
      fs.readFileSync(path.join(stateDir, "agent-name.txt"), "utf8").trim(),
    ).toBe("fresh");
  });

  it("canonicalizes TAP_AGENT_ID to underscore form for bridge routing", () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bridge-agent-id-"));
    createdDirs.push(repoRoot);
    const commsDir = path.join(repoRoot, "hua-comms");
    const stateDir = path.join(repoRoot, ".tmp", "codex-app-server-bridge");
    fs.mkdirSync(commsDir, { recursive: true });
    fs.mkdirSync(stateDir, { recursive: true });
    process.env.TAP_AGENT_ID = "codex-reviewer";

    const options = buildOptions([
      "--repo-root",
      repoRoot,
      "--comms-dir",
      commsDir,
      "--state-dir",
      stateDir,
      "--agent-name",
      "묵",
      "--run-once",
    ]);

    expect(options.agentId).toBe("codex_reviewer");
  });

  it("builds a tokenized connect URL from the gateway token file without changing the public URL", () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bridge-gateway-"));
    createdDirs.push(repoRoot);
    const commsDir = path.join(repoRoot, "hua-comms");
    const stateDir = path.join(repoRoot, ".tmp", "codex-app-server-bridge");
    const tokenFile = path.join(
      repoRoot,
      ".tap-comms",
      "secrets",
      "gateway.token",
    );
    fs.mkdirSync(commsDir, { recursive: true });
    fs.mkdirSync(path.dirname(tokenFile), { recursive: true });
    fs.writeFileSync(tokenFile, "secret-token\n", "utf8");

    const options = buildOptions([
      "--repo-root",
      repoRoot,
      "--comms-dir",
      commsDir,
      "--state-dir",
      stateDir,
      "--app-server-url",
      "ws://127.0.0.1:4510",
      "--gateway-token-file",
      tokenFile,
      "--run-once",
    ]);

    expect(options.appServerUrl).toBe("ws://127.0.0.1:4510");
    expect(options.gatewayTokenFile).toBe(tokenFile);
    // Subprotocol auth: token no longer in URL
    expect(options.connectAppServerUrl).toBe("ws://127.0.0.1:4510");
    expect(options.gatewayToken).toBe("secret-token");
  });

  it("defaults bridge log-level to info", () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bridge-log-level-"));
    createdDirs.push(repoRoot);
    const commsDir = path.join(repoRoot, "hua-comms");
    fs.mkdirSync(commsDir, { recursive: true });

    const options = buildOptions([
      "--repo-root",
      repoRoot,
      "--comms-dir",
      commsDir,
      "--run-once",
    ]);

    expect(options.logLevel).toBe("info");
  });

  it("parses an explicit bridge log-level", () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bridge-log-level-"));
    createdDirs.push(repoRoot);
    const commsDir = path.join(repoRoot, "hua-comms");
    fs.mkdirSync(commsDir, { recursive: true });

    const options = buildOptions([
      "--repo-root",
      repoRoot,
      "--comms-dir",
      commsDir,
      "--log-level",
      "debug",
      "--run-once",
    ]);

    expect(options.logLevel).toBe("debug");
  });

  it("rejects an invalid bridge log-level", () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bridge-log-level-"));
    createdDirs.push(repoRoot);
    const commsDir = path.join(repoRoot, "hua-comms");
    fs.mkdirSync(commsDir, { recursive: true });

    expect(() =>
      buildOptions([
        "--repo-root",
        repoRoot,
        "--comms-dir",
        commsDir,
        "--log-level",
        "trace",
        "--run-once",
      ]),
    ).toThrow(/Invalid --log-level: trace/);
  });

  it("matches inbox recipients by both agent id and agent name", () => {
    expect(
      recipientMatchesAgent("codex-reviewer", "codex-reviewer", "묵"),
    ).toBe(true);
    expect(
      recipientMatchesAgent("codex-reviewer", "codex_reviewer", "묵"),
    ).toBe(true);
    expect(recipientMatchesAgent("묵", "codex-reviewer", "묵")).toBe(true);
    expect(recipientMatchesAgent("전체", "codex-reviewer", "묵")).toBe(true);
    expect(recipientMatchesAgent("결", "codex-reviewer", "묵")).toBe(false);
  });

  it("treats messages from either id or display name as self-authored", () => {
    expect(isOwnMessageSender("codex-reviewer", "codex-reviewer", "묵")).toBe(
      true,
    );
    expect(isOwnMessageSender("codex-reviewer", "codex_reviewer", "묵")).toBe(
      true,
    );
    expect(isOwnMessageSender("묵", "codex-reviewer", "묵")).toBe(true);
    expect(isOwnMessageSender("결", "codex-reviewer", "묵")).toBe(false);
  });

  it("formats bridge prompts with heartbeat display labels", () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bridge-labels-"));
    createdDirs.push(repoRoot);
    const commsDir = path.join(repoRoot, "hua-comms");
    fs.mkdirSync(commsDir, { recursive: true });
    const heartbeats = {
      codex: {
        agent: "덱",
      },
      claude: {
        agent: "초",
      },
    };

    expect(resolveAddressLabel("codex", heartbeats)).toBe("덱 [codex]");
    expect(resolveAddressLabel("초", heartbeats)).toBe("초 [claude]");

    const prompt = buildUserInput(
      {
        markerId: "m1",
        filePath: path.join(commsDir, "inbox", "20260325-claude-codex-ping.md"),
        fileName: "20260325-claude-codex-ping.md",
        sender: "claude",
        recipient: "codex",
        subject: "ping",
        body: "hello",
        mtimeMs: Date.now(),
      },
      "덱",
      heartbeats,
    );

    expect(prompt).toContain("Sender: 초 [claude]");
    expect(prompt).toContain("Recipient: 덱 [codex]");
  });

  it("refreshes the bridge agent name from heartbeat id entries", () => {
    const heartbeats = {
      "codex-reviewer": {
        id: "codex-reviewer",
        agent: "별",
      },
    };

    expect(resolveCurrentAgentName("codex-reviewer", "묵", heartbeats)).toBe(
      "별",
    );
    expect(recipientMatchesAgent("별", "codex-reviewer", "별")).toBe(true);
    expect(recipientMatchesAgent("묵", "codex-reviewer", "별")).toBe(false);
    expect(isOwnMessageSender("별", "codex-reviewer", "별")).toBe(true);
  });

  it("matches thread cwd across slash and case differences", () => {
    expect(threadCwdMatches("C:/hua-wt-review", "c:\\HUA-WT-REVIEW")).toBe(
      true,
    );
    expect(threadCwdMatches("C:/hua-wt-review", "C:/hua-wt-1")).toBe(false);
  });

  it("chooses the active loaded thread whose cwd matches the repo", () => {
    const chosen = chooseLoadedThreadForCwd("C:/hua-wt-review", [
      {
        id: "thread-mismatch",
        cwd: "C:/hua-wt-1",
        updatedAt: 300,
        statusType: "active",
        thread: { id: "thread-mismatch", cwd: "C:/hua-wt-1" },
      },
      {
        id: "thread-match-idle",
        cwd: "C:/hua-wt-review",
        updatedAt: 200,
        statusType: "idle",
        thread: { id: "thread-match-idle", cwd: "C:/hua-wt-review" },
      },
      {
        id: "thread-match-active",
        cwd: "c:\\hua-wt-review",
        updatedAt: 100,
        statusType: "active",
        thread: { id: "thread-match-active", cwd: "c:\\hua-wt-review" },
      },
    ]);

    expect(chosen?.id).toBe("thread-match-active");
  });

  it("prefers a newer valid runtime heartbeat without mutating thread.json", () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bridge-thread-"));
    createdDirs.push(repoRoot);
    const stateDir = path.join(repoRoot, ".tmp", "codex-app-server-bridge");
    fs.mkdirSync(stateDir, { recursive: true });

    fs.writeFileSync(
      path.join(stateDir, "thread.json"),
      JSON.stringify({
        threadId: "thread-old",
        updatedAt: "2026-03-27T23:24:51.387Z",
        appServerUrl: "ws://127.0.0.1:4501",
        ephemeral: false,
      }),
      "utf8",
    );
    fs.writeFileSync(
      path.join(stateDir, "heartbeat.json"),
      JSON.stringify({
        threadId: "thread-new",
        updatedAt: "2026-03-27T23:40:38.698Z",
        appServerUrl: "ws://127.0.0.1:4501",
        threadCwd: repoRoot,
        connected: true,
        initialized: true,
      }),
      "utf8",
    );

    const resolved = loadResumableThreadState(stateDir, "ws://127.0.0.1:4501");

    expect(resolved).toEqual(
      expect.objectContaining({
        threadId: "thread-new",
        appServerUrl: "ws://127.0.0.1:4501",
        ephemeral: false,
        cwd: repoRoot,
      }),
    );
    expect(
      JSON.parse(fs.readFileSync(path.join(stateDir, "thread.json"), "utf8")),
    ).toEqual(
      expect.objectContaining({
        threadId: "thread-old",
        appServerUrl: "ws://127.0.0.1:4501",
        ephemeral: false,
      }),
    );
  });

  it("ignores a newer runtime heartbeat from a different app server", () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bridge-thread-"));
    createdDirs.push(repoRoot);
    const stateDir = path.join(repoRoot, ".tmp", "codex-app-server-bridge");
    fs.mkdirSync(stateDir, { recursive: true });

    fs.writeFileSync(
      path.join(stateDir, "thread.json"),
      JSON.stringify({
        threadId: "thread-current",
        updatedAt: "2026-03-27T23:24:51.387Z",
        appServerUrl: "ws://127.0.0.1:4501",
        ephemeral: false,
        cwd: repoRoot,
      }),
      "utf8",
    );
    fs.writeFileSync(
      path.join(stateDir, "heartbeat.json"),
      JSON.stringify({
        threadId: "thread-other-server",
        updatedAt: "2026-03-27T23:40:38.698Z",
        appServerUrl: "ws://127.0.0.1:4510",
        threadCwd: repoRoot,
        connected: true,
        initialized: true,
      }),
      "utf8",
    );

    const resolved = loadResumableThreadState(stateDir, "ws://127.0.0.1:4501");

    expect(resolved).toEqual(
      expect.objectContaining({
        threadId: "thread-current",
        appServerUrl: "ws://127.0.0.1:4501",
        cwd: repoRoot,
      }),
    );
  });

  it("ignores a newer runtime heartbeat without a thread cwd", () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bridge-thread-"));
    createdDirs.push(repoRoot);
    const stateDir = path.join(repoRoot, ".tmp", "codex-app-server-bridge");
    fs.mkdirSync(stateDir, { recursive: true });

    fs.writeFileSync(
      path.join(stateDir, "thread.json"),
      JSON.stringify({
        threadId: "thread-current",
        updatedAt: "2026-03-27T23:24:51.387Z",
        appServerUrl: "ws://127.0.0.1:4501",
        ephemeral: false,
        cwd: repoRoot,
      }),
      "utf8",
    );
    fs.writeFileSync(
      path.join(stateDir, "heartbeat.json"),
      JSON.stringify({
        threadId: "thread-missing-cwd",
        updatedAt: "2026-03-27T23:40:38.698Z",
        appServerUrl: "ws://127.0.0.1:4501",
        threadCwd: null,
        connected: true,
        initialized: true,
      }),
      "utf8",
    );

    const resolved = loadResumableThreadState(stateDir, "ws://127.0.0.1:4501");

    expect(resolved).toEqual(
      expect.objectContaining({
        threadId: "thread-current",
        appServerUrl: "ws://127.0.0.1:4501",
        cwd: repoRoot,
      }),
    );
  });

  it("keeps the saved thread when the heartbeat is older", () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bridge-thread-"));
    createdDirs.push(repoRoot);
    const stateDir = path.join(repoRoot, ".tmp", "codex-app-server-bridge");
    fs.mkdirSync(stateDir, { recursive: true });

    fs.writeFileSync(
      path.join(stateDir, "thread.json"),
      JSON.stringify({
        threadId: "thread-current",
        updatedAt: "2026-03-27T23:40:38.698Z",
        appServerUrl: "ws://127.0.0.1:4501",
        ephemeral: false,
        cwd: repoRoot,
      }),
      "utf8",
    );
    fs.writeFileSync(
      path.join(stateDir, "heartbeat.json"),
      JSON.stringify({
        threadId: "thread-stale",
        updatedAt: "2026-03-27T23:24:51.387Z",
        appServerUrl: "ws://127.0.0.1:4501",
        threadCwd: "D:/somewhere-else",
        connected: true,
        initialized: true,
      }),
      "utf8",
    );

    const resolved = loadResumableThreadState(stateDir, "ws://127.0.0.1:4501");

    expect(resolved).toEqual(
      expect.objectContaining({
        threadId: "thread-current",
        cwd: repoRoot,
      }),
    );
  });

  it("keeps the saved thread when timestamps are equal", () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bridge-thread-"));
    createdDirs.push(repoRoot);
    const stateDir = path.join(repoRoot, ".tmp", "codex-app-server-bridge");
    fs.mkdirSync(stateDir, { recursive: true });

    fs.writeFileSync(
      path.join(stateDir, "thread.json"),
      JSON.stringify({
        threadId: "thread-current",
        updatedAt: "2026-03-27T23:40:38.698Z",
        appServerUrl: "ws://127.0.0.1:4501",
        ephemeral: false,
        cwd: repoRoot,
      }),
      "utf8",
    );
    fs.writeFileSync(
      path.join(stateDir, "heartbeat.json"),
      JSON.stringify({
        threadId: "thread-same-timestamp",
        updatedAt: "2026-03-27T23:40:38.698Z",
        appServerUrl: "ws://127.0.0.1:4501",
        threadCwd: repoRoot,
        connected: true,
        initialized: true,
      }),
      "utf8",
    );

    const resolved = loadResumableThreadState(stateDir, "ws://127.0.0.1:4501");

    expect(resolved).toEqual(
      expect.objectContaining({
        threadId: "thread-current",
        cwd: repoRoot,
      }),
    );
  });

  it("returns null when neither saved state nor a valid heartbeat-backed thread exists", () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bridge-thread-"));
    createdDirs.push(repoRoot);
    const stateDir = path.join(repoRoot, ".tmp", "codex-app-server-bridge");
    fs.mkdirSync(stateDir, { recursive: true });

    const resolved = loadResumableThreadState(stateDir, "ws://127.0.0.1:4501");

    expect(resolved).toBeNull();
  });

  // ── M202: Frontmatter strip regression ──────────────────────────────

  it("strips YAML frontmatter from message body", () => {
    const withFrontmatter = [
      "---",
      "type: inbox",
      "from: codex_1",
      "from_name: 온",
      "to: claude",
      "to_name: 각",
      "subject: dm-test",
      "sent_at: 2026-03-30T05:00:00Z",
      "---",
      "",
      "Hello from 온",
    ].join("\n");

    expect(stripBridgeFrontmatter(withFrontmatter)).toBe("Hello from 온");
  });

  it("returns body unchanged when no frontmatter present", () => {
    const legacy = "> CC: 흔\n\nPlain legacy message";
    expect(stripBridgeFrontmatter(legacy)).toBe(legacy);
  });

  it("strips frontmatter but preserves CC header in body", () => {
    const withBoth = [
      "---",
      "type: inbox",
      "from: sender",
      "to: target",
      "subject: test",
      "sent_at: 2026-03-31T00:00:00Z",
      "---",
      "",
      "> CC: 흔",
      "",
      "Message with CC",
    ].join("\n");

    const stripped = stripBridgeFrontmatter(withBoth);
    expect(stripped).toContain("> CC: 흔");
    expect(stripped).toContain("Message with CC");
    expect(stripped).not.toContain("from: sender");
  });

  // ── M203: Stale turn fallback ─────────────────────────────────────

  it("detects waitingOnApproval as stuck turn", () => {
    expect(isTurnStuckOnApproval(["waitingOnApproval"])).toBe(true);
    expect(isTurnStuckOnApproval(["waitingOnApproval", "otherFlag"])).toBe(
      true,
    );
    expect(isTurnStuckOnApproval([])).toBe(false);
    expect(isTurnStuckOnApproval(["running"])).toBe(false);
  });

  it("detects stale turns past the timeout threshold", () => {
    const now = Date.now();
    const sixMinutesAgo = new Date(now - 6 * 60 * 1000).toISOString();
    const twoMinutesAgo = new Date(now - 2 * 60 * 1000).toISOString();

    expect(isTurnStale(sixMinutesAgo, now)).toBe(true);
    expect(isTurnStale(twoMinutesAgo, now)).toBe(false);
    expect(isTurnStale(null, now)).toBe(false);
  });

  it("exports STALE_TURN_MS as 5 minutes", () => {
    expect(STALE_TURN_MS).toBe(5 * 60 * 1000);
  });

  // ── M174: Token sanitization ──────────────────────────────────────

  it("sanitizes tap_token in URL query params", () => {
    const error = "Failed: ws://127.0.0.1:4501?tap_token=secret123&foo=bar";
    expect(sanitizeErrorForPersistence(error)).toContain("tap_token=***");
    expect(sanitizeErrorForPersistence(error)).not.toContain("secret123");
  });

  it("sanitizes tap-auth subprotocol prefix", () => {
    const error = "Protocol: tap-auth-eyJhbGciOiJIUzI1NiJ9.payload.sig";
    expect(sanitizeErrorForPersistence(error)).toContain("tap-auth-***");
    expect(sanitizeErrorForPersistence(error)).not.toContain("eyJhbGci");
  });

  it("sanitizes Bearer tokens", () => {
    const error = "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig";
    expect(sanitizeErrorForPersistence(error)).toContain("Bearer ***");
    expect(sanitizeErrorForPersistence(error)).not.toContain("eyJhbGci");
  });

  it("sanitizes JSON string token values", () => {
    const error = '{"token":"supersecret","message":"fail"}';
    expect(sanitizeErrorForPersistence(error)).toContain('"token":"***"');
    expect(sanitizeErrorForPersistence(error)).not.toContain("supersecret");
  });

  it("sanitizes multiple sensitive patterns in one string", () => {
    const error =
      "Failed at ws://host?tap_token=abc123 with Bearer xyz789 and tap-auth-tok456";
    const sanitized = sanitizeErrorForPersistence(error)!;
    expect(sanitized).not.toContain("abc123");
    expect(sanitized).not.toContain("xyz789");
    expect(sanitized).not.toContain("tok456");
  });

  it("returns null for null input", () => {
    expect(sanitizeErrorForPersistence(null)).toBeNull();
  });

  it("preserves non-sensitive error messages", () => {
    const error = "Connection refused: ECONNREFUSED 127.0.0.1:4501";
    expect(sanitizeErrorForPersistence(error)).toBe(error);
  });
});
