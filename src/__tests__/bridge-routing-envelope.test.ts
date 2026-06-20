import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { collectCandidates, getPendingCandidates } from "../../scripts/bridge/bridge-candidates.js";
import { buildOptions } from "../../scripts/codex/codex-app-server-bridge.js";
import { FORBIDDEN_RAW_PAIR_TOKEN_REASON } from "../../scripts/bridge/bridge-routing.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tap-bridge-envelope-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("bridge envelope routing", () => {
  it("parses tap_reply_v2 A2A metadata into the bridge candidate model", () => {
    const inboxDir = path.join(tmpDir, "inbox");
    fs.mkdirSync(inboxDir, { recursive: true });

    const filePath = path.join(
      inboxDir,
      "20260418-연-해-m345-phase1-wiring-pr-request.md",
    );
    fs.writeFileSync(
      filePath,
      [
        "---",
        "type: inbox",
        "message_id: 739f6b3c-5644-4e79-b096-04e924ba0401",
        "from: tower",
        "to: codex_impl",
        "subject: m345-phase1-wiring-pr-request",
        'from_address: {"hostId":"DEVIN","clientId":"claude-main","conversationId":null,"ownerClientId":null,"routingAddress":"tower","slot":"tower","aliases":["tower","claude-main","연"]}',
        'to_address: {"hostId":"DEVIN","clientId":"codex_impl","conversationId":"thread-42","ownerClientId":"codex_impl","routingAddress":"codex_impl","slot":null,"aliases":["codex_impl","해"]}',
        "scope: drive",
        "action: thread-follower-start-turn",
        "consent_ref: receipt-123",
        "---",
        "",
        "bridge wiring now",
        "",
      ].join("\n"),
      "utf-8",
    );

    const [candidate] = collectCandidates(inboxDir, "codex_impl", "해");
    expect(candidate).toMatchObject({
      sender: "tower",
      recipient: "codex_impl",
      subject: "m345-phase1-wiring-pr-request",
      messageId: "739f6b3c-5644-4e79-b096-04e924ba0401",
      scope: "drive",
      action: "thread-follower-start-turn",
      consentRef: "receipt-123",
      fromAddress: {
        hostId: "DEVIN",
        clientId: "claude-main",
        routingAddress: "tower",
        slot: "tower",
        aliases: ["tower", "claude-main", "연"],
      },
      toAddress: {
        hostId: "DEVIN",
        clientId: "codex_impl",
        conversationId: "thread-42",
        ownerClientId: "codex_impl",
        routingAddress: "codex_impl",
        aliases: ["codex_impl", "해"],
      },
    });
    expect(candidate?.body.trim()).toBe("bridge wiring now");
  });

  it("rejects envelopes with raw pairToken and records a rejection marker", () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tap-bridge-reject-"));
    const commsDir = path.join(repoRoot, "hua-comms");
    const stateDir = path.join(repoRoot, ".tmp", "codex-app-server-bridge");
    fs.mkdirSync(path.join(commsDir, "inbox"), { recursive: true });

    const filePath = path.join(
      commsDir,
      "inbox",
      "20260418-연-해-forbidden-pairtoken.md",
    );
    fs.writeFileSync(
      filePath,
      [
        "---",
        "type: inbox",
        "from: tower",
        "to: 해",
        "subject: forbidden-pairtoken",
        "scope: drive",
        "action: thread-follower-start-turn",
        "consent_ref: c1",
        "pairToken: raw-secret-should-never-be-here",
        "---",
        "",
        "should never reach candidate dispatch",
        "",
      ].join("\n"),
      "utf-8",
    );

    expect(collectCandidates(path.join(commsDir, "inbox"), "codex_impl", "해")).toHaveLength(0);

    const options = buildOptions([
      "--repo-root",
      repoRoot,
      "--comms-dir",
      commsDir,
      "--state-dir",
      stateDir,
      "--agent-name",
      "해",
      "--run-once",
    ]);

    const { candidates } = getPendingCandidates(options, new Date(0));
    expect(candidates).toHaveLength(0);

    const markerFiles = fs.readdirSync(path.join(stateDir, "processed"));
    expect(markerFiles).toHaveLength(1);

    const marker = JSON.parse(
      fs.readFileSync(path.join(stateDir, "processed", markerFiles[0] ?? ""), "utf8"),
    );
    expect(marker).toMatchObject({
      dispatchMode: "rejected",
      blockedReason: FORBIDDEN_RAW_PAIR_TOKEN_REASON,
      requestName: "20260418-연-해-forbidden-pairtoken.md",
    });

    fs.rmSync(repoRoot, { recursive: true, force: true });
  });
});
