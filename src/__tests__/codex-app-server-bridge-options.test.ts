import { afterEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  buildOptions,
  buildUserInput,
  chooseLoadedThreadForCwd,
  isOwnMessageSender,
  recipientMatchesAgent,
  resolveAddressLabel,
  resolveCurrentAgentName,
  threadCwdMatches,
} from "../../../../scripts/codex-app-server-bridge.ts";

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

  it("keeps TAP_AGENT_ID unchanged for bridge routing", () => {
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

    expect(options.agentId).toBe("codex-reviewer");
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

  it("matches inbox recipients by both agent id and agent name", () => {
    expect(
      recipientMatchesAgent("codex-reviewer", "codex-reviewer", "묵"),
    ).toBe(true);
    expect(recipientMatchesAgent("묵", "codex-reviewer", "묵")).toBe(true);
    expect(recipientMatchesAgent("전체", "codex-reviewer", "묵")).toBe(true);
    expect(recipientMatchesAgent("결", "codex-reviewer", "묵")).toBe(false);
  });

  it("treats messages from either id or display name as self-authored", () => {
    expect(isOwnMessageSender("codex-reviewer", "codex-reviewer", "묵")).toBe(
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
    expect(
      threadCwdMatches("C:/hua-wt-review", "c:\\HUA-WT-REVIEW"),
    ).toBe(true);
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
});
