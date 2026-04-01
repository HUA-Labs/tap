import { describe, it, expect } from "vitest";
import { resolveRoute, type AgentEntry } from "../routing/agent-router.js";

const agents: AgentEntry[] = [
  {
    id: "codex_worker",
    name: "솔",
    lastActivity: 1000,
    presence: "bridge-live",
  },
  { id: "codex_reviewer", name: "결", lastActivity: 900, presence: "mcp-only" },
  {
    id: "claude_main",
    name: "돌",
    lastActivity: 1100,
    presence: "bridge-live",
  },
];

describe("resolveRoute", () => {
  it("resolves broadcast targets", () => {
    const r1 = resolveRoute("전체", agents);
    expect(r1.method).toBe("broadcast");
    expect(r1.ambiguous).toBe(false);

    const r2 = resolveRoute("all", agents);
    expect(r2.method).toBe("broadcast");
  });

  it("resolves @instanceId direct targeting", () => {
    const r = resolveRoute("@codex_worker", agents);
    expect(r.method).toBe("exact-instance");
    expect(r.target).toBe("codex_worker");
    expect(r.ambiguous).toBe(false);
    expect(r.warning).toBeNull();
  });

  it("warns for unknown @instanceId", () => {
    const r = resolveRoute("@nonexistent", agents);
    expect(r.method).toBe("exact-instance");
    expect(r.target).toBe("nonexistent");
    expect(r.warning).toContain("not found");
  });

  it("resolves unique agent name", () => {
    const r = resolveRoute("돌", agents);
    expect(r.method).toBe("exact-name");
    expect(r.target).toBe("claude_main");
    expect(r.ambiguous).toBe(false);
  });

  it("disambiguates duplicate names by presence", () => {
    const dupeAgents: AgentEntry[] = [
      {
        id: "codex_worker",
        name: "솔",
        lastActivity: 1000,
        presence: "bridge-live",
      },
      { id: "codex_mcp", name: "솔", lastActivity: 1200, presence: "mcp-only" },
    ];
    const r = resolveRoute("솔", dupeAgents);
    expect(r.method).toBe("most-recent");
    expect(r.ambiguous).toBe(true);
    // bridge-live wins over mcp-only despite lower lastActivity
    expect(r.target).toBe("codex_worker");
    expect(r.candidates).toEqual(["codex_worker", "codex_mcp"]);
  });

  it("disambiguates same presence by lastActivity", () => {
    const dupeAgents: AgentEntry[] = [
      {
        id: "codex_old",
        name: "솔",
        lastActivity: 500,
        presence: "bridge-live",
      },
      {
        id: "codex_new",
        name: "솔",
        lastActivity: 1500,
        presence: "bridge-live",
      },
    ];
    const r = resolveRoute("솔", dupeAgents);
    expect(r.target).toBe("codex_new");
    expect(r.ambiguous).toBe(true);
  });

  it("falls back to exact ID match (non-prefixed)", () => {
    const r = resolveRoute("codex_reviewer", agents);
    expect(r.method).toBe("exact-instance");
    expect(r.target).toBe("codex_reviewer");
  });

  it("falls back to canonical ID match", () => {
    const r = resolveRoute("codex-worker", agents);
    expect(r.method).toBe("canonical-id");
    expect(r.target).toBe("codex_worker");
  });

  it("returns warning for unknown target", () => {
    const r = resolveRoute("nobody", agents);
    expect(r.warning).toContain("not a known agent");
    expect(r.candidates).toHaveLength(0);
  });
});
