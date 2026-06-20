import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { TEST_DIR, resetTestDir, setTestEnv } from "./test-helpers.ts";

setTestEnv();

const {
  INBOX_DIR,
  REVIEWS_DIR,
  FINDINGS_DIR,
  parseFilename,
  parseFrontmatter,
  stripFrontmatter,
  parseMessageRoute,
  canonicalizeAgentId,
  isForMe,
  normalizeSources,
  stripBom,
  getLatestReviewDir,
  getSourceDir,
  getSourceKey,
  getRecentReplyableRecipients,
  getRecentReplyableSenders,
  getAgentIdentitySnapshot,
  getAgentRoutingAddress,
  getAgentRoutingAliases,
  normalizeRoutingSlot,
  deriveRoutingSlotFromInstanceId,
} = await import("../tap-utils.ts");

beforeEach(() => {
  resetTestDir();
  mkdirSync(INBOX_DIR, { recursive: true });
  mkdirSync(FINDINGS_DIR, { recursive: true });
});

afterEach(() => {
  resetTestDir();
});

describe("tap-utils", () => {
  it("parses inbox filenames with CJK agents and hyphenated subjects", () => {
    expect(parseFilename("20260325-돌-담-m90-check-in.md")).toEqual({
      from: "돌",
      to: "담",
      subject: "m90-check-in",
    });
  });

  it("returns null for non-inbox artifact filenames", () => {
    expect(parseFilename("review-PR758-담.md")).toBeNull();
    expect(parseFilename("random-file.md")).toBeNull();
  });

  it("matches inbox targets by id, name, and broadcast aliases", () => {
    expect(isForMe("codex_1")).toBe(true);
    expect(isForMe("codex-1")).toBe(true);
    expect(isForMe("담")).toBe(true);
    expect(isForMe("전체")).toBe(true);
    expect(isForMe("all")).toBe(true);
    expect(isForMe("다른이")).toBe(false);
  });

  it("filters invalid source entries but keeps valid ones in order", () => {
    expect(normalizeSources(["reviews", "bogus", "inbox"])).toEqual([
      "reviews",
      "inbox",
    ]);
  });

  it("resolves the latest review directory and source keys", () => {
    mkdirSync(join(REVIEWS_DIR, "gen12"), { recursive: true });
    mkdirSync(join(REVIEWS_DIR, "gen13"), { recursive: true });

    expect(getLatestReviewDir()).toBe(join(REVIEWS_DIR, "gen13"));
    expect(getSourceDir("reviews")).toBe(join(REVIEWS_DIR, "gen13"));
    expect(getSourceKey("inbox", "20260325-돌-담-hello.md")).toBe(
      "inbox/20260325-돌-담-hello.md",
    );
  });

  it("collects recent replyable senders from inbound inbox files only", () => {
    mkdirSync(INBOX_DIR, { recursive: true });

    const inboundToMe = [
      "---",
      "type: inbox",
      "from: 준",
      "to: codex_1",
      "subject: ping",
      "sent_at: 2026-04-16T00:00:00Z",
      "---",
      "",
      "hello",
    ].join("\n");
    const inboundBroadcast = [
      "---",
      "type: inbox",
      "from: 률",
      "to: 전체",
      "subject: broadcast",
      "sent_at: 2026-04-16T00:00:00Z",
      "---",
      "",
      "hello all",
    ].join("\n");
    const inboundToOther = [
      "---",
      "type: inbox",
      "from: 묵",
      "to: 다른이",
      "subject: private",
      "sent_at: 2026-04-16T00:00:00Z",
      "---",
      "",
      "not for me",
    ].join("\n");

    writeFileSync(join(INBOX_DIR, "20260416-준-담-ping.md"), inboundToMe);
    writeFileSync(
      join(INBOX_DIR, "20260416-률-전체-broadcast.md"),
      inboundBroadcast,
    );
    writeFileSync(
      join(INBOX_DIR, "20260416-묵-다른이-private.md"),
      inboundToOther,
    );

    expect([...getRecentReplyableSenders()].sort()).toEqual(["률", "준"]);
  });

  it("maps M322 display-name aliases back to stable routing targets", () => {
    mkdirSync(INBOX_DIR, { recursive: true });

    const inboundStableAddress = [
      "---",
      "type: inbox",
      "from: tower",
      "from_name: 준",
      "to: codex_1",
      "to_name: 담",
      "subject: ping2",
      "sent_at: 2026-04-16T00:00:00Z",
      "---",
      "",
      "hello again",
    ].join("\n");

    writeFileSync(
      join(INBOX_DIR, "20260416-준-담-ping2.md"),
      inboundStableAddress,
    );

    expect(Object.fromEntries(getRecentReplyableRecipients())).toEqual({
      tower: "tower",
      준: "tower",
    });
    expect([...getRecentReplyableSenders()].sort()).toEqual(["tower", "준"]);
  });

  it("strips BOM only when present", () => {
    expect(stripBom("\uFEFFhello")).toBe("hello");
    expect(stripBom("hello")).toBe("hello");
  });

  // ── M202: Frontmatter parsing ──────────────────────────────────────

  it("parses valid YAML frontmatter from message content", () => {
    const content = [
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
      "Hello world",
    ].join("\n");

    const fm = parseFrontmatter(content);
    expect(fm).toEqual({
      from: "codex_1",
      from_name: "온",
      to: "claude",
      to_name: "각",
      subject: "dm-test",
      sent_at: "2026-03-30T05:00:00Z",
      type: "inbox",
    });
  });

  it("parses structured route metadata from inbox frontmatter when present", () => {
    const content = [
      "---",
      "type: inbox",
      "from: tower",
      'from_address: {"hostId":"host-a","clientId":"tower-client","conversationId":null,"ownerClientId":null,"routingAddress":"tower","slot":"tower","aliases":["tower"]}',
      "to: wt-1",
      'to_address: {"hostId":null,"clientId":"codex-wt1","conversationId":"thread-1","ownerClientId":"codex-wt1","routingAddress":"wt-1","slot":"wt-1","aliases":["wt-1","codex-wt1"]}',
      "scope: suggest",
      "action: start-turn",
      "consent_ref: grant-123",
      "subject: route-v2",
      "---",
      "",
      "Hello route",
    ].join("\n");

    const fm = parseFrontmatter(content);
    expect(fm).toEqual({
      from: "tower",
      to: "wt-1",
      subject: "route-v2",
      type: "inbox",
      from_address:
        '{"hostId":"host-a","clientId":"tower-client","conversationId":null,"ownerClientId":null,"routingAddress":"tower","slot":"tower","aliases":["tower"]}',
      to_address:
        '{"hostId":null,"clientId":"codex-wt1","conversationId":"thread-1","ownerClientId":"codex-wt1","routingAddress":"wt-1","slot":"wt-1","aliases":["wt-1","codex-wt1"]}',
      scope: "suggest",
      action: "start-turn",
      consent_ref: "grant-123",
    });
  });

  it("returns null for content without frontmatter", () => {
    expect(parseFrontmatter("Just plain text")).toBeNull();
    expect(parseFrontmatter("> CC: 흔\n\nContent")).toBeNull();
  });

  it("returns null for frontmatter missing required from/to", () => {
    const noTo = "---\nfrom: claude\nsubject: test\n---\nBody";
    expect(parseFrontmatter(noTo)).toBeNull();
  });

  it("strips frontmatter and returns body only", () => {
    const content = "---\nfrom: a\nto: b\n---\n\nBody text";
    expect(stripFrontmatter(content)).toBe("Body text");
  });

  it("stripFrontmatter returns full content when no frontmatter", () => {
    expect(stripFrontmatter("No frontmatter here")).toBe("No frontmatter here");
  });

  it("parseMessageRoute prefers frontmatter over filename", () => {
    const content =
      "---\nfrom: real_sender\nto: real_target\nsubject: real-subj\n---\nBody";
    const route = parseMessageRoute(
      "20260330-wrong-also_wrong-fake.md",
      content,
    );
    expect(route).toEqual({
      from: "real_sender",
      to: "real_target",
      subject: "real-subj",
    });
  });

  it("parseMessageRoute falls back to filename when no frontmatter", () => {
    const route = parseMessageRoute("20260330-돌-담-hello.md", "Plain body");
    expect(route).toEqual({ from: "돌", to: "담", subject: "hello" });
  });

  it("parseMessageRoute falls back to filename when content is undefined", () => {
    const route = parseMessageRoute("20260330-돌-담-hello.md");
    expect(route).toEqual({ from: "돌", to: "담", subject: "hello" });
  });

  // ── M204: ID canonicalization ──────────────────────────────────────

  it("canonicalizes hyphens to underscores", () => {
    expect(canonicalizeAgentId("codex-1")).toBe("codex_1");
    expect(canonicalizeAgentId("codex_1")).toBe("codex_1");
    expect(canonicalizeAgentId("codex-codex-2")).toBe("codex_codex_2");
    expect(canonicalizeAgentId(" codex-1 ")).toBe("codex_1");
  });

  it("isForMe matches hyphenated variant of agent id", () => {
    // Test env sets TAP_AGENT_ID=codex_1 — isForMe should match codex-1 too
    expect(isForMe("codex-1")).toBe(true);
    expect(isForMe("codex_1")).toBe(true);
  });

  it("isForMe still matches display name and broadcast", () => {
    expect(isForMe("담")).toBe(true);
    expect(isForMe("전체")).toBe(true);
    expect(isForMe("all")).toBe(true);
    expect(isForMe("다른이")).toBe(false);
  });

  it("matches stable slot aliases when TAP_ROUTING_SLOT is provided", () => {
    process.env.TAP_ROUTING_SLOT = "wt-1";

    expect(getAgentRoutingAddress()).toBe("wt-1");
    expect(getAgentRoutingAliases()).toEqual(
      expect.arrayContaining(["wt-1", "codex_1", "담"]),
    );
    expect(isForMe("wt-1")).toBe(true);

    delete process.env.TAP_ROUTING_SLOT;
  });

  it("normalizes dynamic wt-N slots from slot and instance inputs", () => {
    expect(normalizeRoutingSlot("wt-3")).toBe("wt-3");
    expect(normalizeRoutingSlot("wt3")).toBe("wt-3");
    expect(deriveRoutingSlotFromInstanceId("claude-wt3")).toBe("wt-3");
    expect(deriveRoutingSlotFromInstanceId("codex_wt12")).toBe("wt-12");
  });

  it("lazily rebinds unknown identity from runtime bridge env", async () => {
    delete process.env.TAP_AGENT_ID;
    delete process.env.TAP_BRIDGE_INSTANCE_ID;
    delete process.env.CODEX_TAP_AGENT_NAME;
    process.env.TAP_AGENT_NAME = "<set-per-session>";

    vi.resetModules();
    const rebound = await import("../tap-utils.ts");

    expect(rebound.getAgentId()).toBe("unknown");
    expect(rebound.getAgentName()).toBe("unknown");

    process.env.TAP_BRIDGE_INSTANCE_ID = "codex-reviewer";
    process.env.CODEX_TAP_AGENT_NAME = "린";

    expect(rebound.getAgentId()).toBe("codex_reviewer");
    expect(rebound.getAgentName()).toBe("린");
  });

  it("captures the current MCP-side identity snapshot", () => {
    delete process.env.TAP_ROUTING_SLOT;
    delete process.env.TAP_BRIDGE_INSTANCE_ID;
    delete process.env.CODEX_TAP_AGENT_NAME;
    process.env.CODEX_THREAD_ID = "thread-live";
    process.env.TAP_AGENT_ID = "codex_1";
    process.env.TAP_AGENT_NAME = "담";
    const snapshot = getAgentIdentitySnapshot();
    expect(snapshot.agentId).toBe("codex_1");
    expect(snapshot.agentName).toBe("담");
    expect(snapshot.idLocked).toBe(true);
    expect(snapshot.nameConfirmed).toBe(true);
    expect(snapshot.runtimeEnv.agentId).toBe("codex_1");
    expect(snapshot.runtimeEnv.agentName).toBe("담");
    expect(snapshot.runtimeEnv.commsDir).toBeTruthy();
    expect(snapshot.resolvedRoutingAddress).toBe("codex_1");
    expect(snapshot.address).toMatchObject({
      clientId: null,
      conversationId: "thread-live",
      ownerClientId: null,
      routingAddress: "codex_1",
      slot: null,
    });
    expect(snapshot.address.hostId).toBeTruthy();
    expect(snapshot.address.aliases).toContain("codex_1");
    delete process.env.CODEX_THREAD_ID;
  });

  it("adds bootstrap drift and routing dry-run details to identity probe", async () => {
    delete process.env.TAP_STATE_DIR;
    delete process.env.TAP_INSTANCE_ID;
    delete process.env.TAP_RUNTIME_STATE_DIR;
    delete process.env.TAP_ROUTING_SLOT;
    process.env.TAP_COMMS_DIR = TEST_DIR;
    process.env.TAP_AGENT_ID = "codex_reviewer";
    process.env.TAP_AGENT_NAME = "<set-per-session>";
    process.env.TAP_BRIDGE_INSTANCE_ID = "codex-reviewer";
    process.env.CODEX_TAP_AGENT_NAME = "한";

    vi.resetModules();
    const rebound = await import("../tap-utils.ts");

    expect(rebound.getAgentId()).toBe("codex_reviewer");
    expect(rebound.getAgentName()).toBe("한");

    const probe = rebound.buildAgentIdentityProbeSnapshot("한");
    const miss = rebound.buildAgentIdentityProbeSnapshot("다른이");

    expect(probe.agentName).toBe("한");
    expect(probe.resolvedRoutingAliases).toEqual(
      expect.arrayContaining(["한", "codex_reviewer"]),
    );
    expect(probe.bootstrapDrift).toEqual({
      envAgentName: "<set-per-session>",
      envAgentNameIsPlaceholder: true,
      runtimeAgentName: "한",
      differsFromRuntime: true,
    });
    expect(probe.dryRun).toEqual({
      testName: "한",
      matches: true,
    });
    expect(miss.dryRun).toEqual({
      testName: "다른이",
      matches: false,
    });
  });
});
