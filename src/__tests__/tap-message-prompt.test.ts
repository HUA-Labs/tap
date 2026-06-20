import { describe, expect, it } from "vitest";
import { buildTapMessagePrompt } from "../routing/tap-message-prompt.js";

describe("tap message prompt", () => {
  it("renders a compact reply affordance for valid reply targets", () => {
    const prompt = buildTapMessagePrompt({
      agentName: "준",
      sender: "윤",
      recipient: "준",
      subject: "review",
      fileName: "20260602-yoon-jun-review.md",
      body: "please review",
      replyTo: "codex",
    });

    expect(prompt).toContain("Reply available: codex");
    expect(prompt).not.toContain("Use tap_reply");
    expect(prompt).not.toContain("No valid structured return route");
  });

  it("uses structured return routes before display-name fallback", () => {
    const prompt = buildTapMessagePrompt({
      agentName: "준",
      sender: "윤",
      recipient: "준",
      subject: "structured",
      fileName: "20260602-yoon-jun-structured.md",
      body: "reply through the route",
      replyTo: "unknown",
      returnAddress: {
        routingAddress: "codex",
        hostId: "/home/devin/hua-comms",
        aliases: ["codex", "윤"],
      },
      runtimeSurface: "codex-cli",
    });

    expect(prompt).toContain("Tap message for 준");
    expect(prompt).toContain("From: 윤");
    expect(prompt).toContain("Message:\nreply through the route\n\nReply:");
    expect(prompt).toContain("Reply available: codex");
    expect(prompt).not.toContain("Use tap_reply");
    expect(prompt).not.toContain("Return route: routingAddress=codex");
    expect(prompt).not.toContain("hostId=/home/devin/hua-comms");
    expect(prompt).not.toContain("runtimeSurface=codex-cli");
    expect(prompt).not.toContain("File:");
    expect(prompt).not.toContain('tap_reply(to: "unknown"');
  });

  it("exposes route details only when debug envelope is requested", () => {
    const prompt = buildTapMessagePrompt({
      agentName: "준",
      sender: "윤",
      recipient: "준",
      subject: "debug",
      fileName: "20260602-yoon-jun-debug.md",
      body: "reply through the route",
      replyTo: "unknown",
      returnAddress: {
        routingAddress: "codex",
        hostId: "/home/devin/hua-comms",
        aliases: ["codex", "윤"],
      },
      runtimeSurface: "codex-cli",
      debugEnvelope: true,
    });

    expect(prompt).toContain("Debug envelope:");
    expect(prompt).toContain('replyInstruction: Use tap_reply(to: "codex"');
    expect(prompt).toContain("- file: 20260602-yoon-jun-debug.md");
    expect(prompt).toContain("returnRoute: routingAddress=codex");
    expect(prompt).toContain("hostId=/home/devin/hua-comms");
    expect(prompt).toContain("runtimeSurface=codex-cli");
  });

  it("fails closed instead of generating unknown reply targets", () => {
    const prompt = buildTapMessagePrompt({
      agentName: "준",
      sender: "unknown",
      recipient: "준",
      subject: "missing-route",
      fileName: "20260602-unknown-jun-missing-route.md",
      body: "missing return route",
      replyTo: "unknown",
    });

    expect(prompt).toContain("No valid structured return route");
    expect(prompt).toContain("`unknown` is not a valid reply target");
    expect(prompt).toContain('Do not reply to "unknown".');
    expect(prompt).not.toContain('Use tap_reply(to: "unknown"');
  });

  it("separates markdown message bodies from prompt chrome", () => {
    const body = [
      "Findings:",
      "",
      "P1/P2/P3: none.",
      "",
      "Review notes:",
      "- First bullet stays visible.",
      "- Second bullet stays visible.",
    ].join("\n");
    const prompt = buildTapMessagePrompt({
      agentName: "윤",
      sender: "준",
      recipient: "codex",
      subject: "pr-review",
      fileName: "20260603-jun-codex-pr-review.md",
      body,
      replyTo: "준",
    });

    expect(prompt).toContain(
      [
        "Subject: pr-review",
        "",
        "Message:",
        "Findings:",
        "",
        "P1/P2/P3: none.",
        "",
        "Review notes:",
        "- First bullet stays visible.",
      ].join("\n"),
    );
    expect(prompt).toContain("\n\nReply:\n");
  });
});
