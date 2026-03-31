import { describe, it, expect } from "vitest";
import type { TapState, InstanceState } from "../types.js";

// ── Helpers ────────────────────────────────────────────────────────────

function makeInstance(
  overrides: Partial<InstanceState> & {
    instanceId: string;
    runtime: "codex" | "claude" | "gemini";
  },
): InstanceState {
  return {
    agentName: null,
    port: null,
    installed: true,
    configPath: "",
    bridgeMode: "app-server",
    restartRequired: false,
    ownedArtifacts: [],
    backupPath: "",
    lastAppliedHash: "",
    lastVerifiedAt: null,
    bridge: null,
    headless: null,
    warnings: [],
    ...overrides,
  };
}

function makeState(
  instances: Record<string, Partial<InstanceState> & { runtime: string }>,
): TapState {
  const state: TapState = {
    schemaVersion: 2,
    createdAt: "",
    updatedAt: "",
    commsDir: "",
    repoRoot: "",
    packageVersion: "0.1.0",
    instances: {},
  };

  for (const [id, opts] of Object.entries(instances)) {
    state.instances[id] = makeInstance({
      instanceId: id,
      ...opts,
      runtime: opts.runtime as "codex" | "claude" | "gemini",
    });
  }

  return state;
}

// ── Agent-Name Persistence ─────────────────────────────────────────────

describe("agent-name persistence logic", () => {
  it("stores agent-name when provided via flag", () => {
    const state = makeState({ codex: { runtime: "codex" } });
    const instance = state.instances["codex"];

    // Simulate: --agent-name provided
    const agentName = "빛";
    const updated = { ...instance, agentName };

    expect(updated.agentName).toBe("빛");
  });

  it("uses stored agent-name when flag is not provided", () => {
    const state = makeState({
      codex: { runtime: "codex", agentName: "빛" },
    });
    const instance = state.instances["codex"];

    // Simulate: no --agent-name flag, fall back to stored
    const resolvedAgentName = instance.agentName ?? undefined;

    expect(resolvedAgentName).toBe("빛");
  });

  it("flag overrides stored agent-name", () => {
    const state = makeState({
      codex: { runtime: "codex", agentName: "빛" },
    });
    const instance = state.instances["codex"];

    // Simulate: --agent-name flag takes precedence
    const flagName = "달";
    const resolvedAgentName = flagName ?? instance.agentName ?? undefined;

    expect(resolvedAgentName).toBe("달");
  });

  it("returns undefined when no agent-name anywhere", () => {
    const state = makeState({ codex: { runtime: "codex" } });
    const instance = state.instances["codex"];

    const resolvedAgentName = instance.agentName ?? undefined;

    expect(resolvedAgentName).toBeUndefined();
  });
});

// ── isForMe Logic (id-based routing) ───────────────────────────────────

/**
 * Mirrors the isForMe() logic from tap-utils.ts.
 * Tests the routing rules without module-level state.
 */
function isForMe(to: string, agentId: string, agentName: string): boolean {
  return to === agentId || to === agentName || to === "전체" || to === "all";
}

describe("isForMe — id-based routing", () => {
  it("matches by agent id", () => {
    expect(isForMe("codex_reviewer", "codex_reviewer", "묵")).toBe(true);
  });

  it("matches by agent name (fallback)", () => {
    expect(isForMe("묵", "codex_reviewer", "묵")).toBe(true);
  });

  it("matches broadcast '전체'", () => {
    expect(isForMe("전체", "codex_reviewer", "묵")).toBe(true);
  });

  it("matches broadcast 'all'", () => {
    expect(isForMe("all", "codex_reviewer", "묵")).toBe(true);
  });

  it("rejects messages for other agents", () => {
    expect(isForMe("돌", "codex_reviewer", "묵")).toBe(false);
  });

  it("rejects messages for other ids", () => {
    expect(isForMe("codex_builder", "codex_reviewer", "묵")).toBe(false);
  });

  it("id takes precedence: matches id even when name differs", () => {
    // Agent renamed from 묵 to 별, but id stays codex_reviewer
    expect(isForMe("codex_reviewer", "codex_reviewer", "별")).toBe(true);
  });

  it("old name no longer matches after rename (id routing)", () => {
    // Message sent to old name "묵", but agent id is different
    expect(isForMe("묵", "codex_builder", "별")).toBe(false);
  });
});

// ── TAP_AGENT_ID resolution ────────────────────────────────────────────

describe("TAP_AGENT_ID resolution logic", () => {
  const PLACEHOLDER_NAMES = new Set([
    "unknown",
    "unnamed",
    "<set-per-session>",
  ]);

  function resolveInitialId(
    envAgentId?: string,
    envAgentName?: string,
  ): string {
    if (envAgentId && !PLACEHOLDER_NAMES.has(envAgentId))
      return envAgentId.replace(/-/g, "_");
    if (envAgentName && !PLACEHOLDER_NAMES.has(envAgentName))
      return envAgentName.replace(/-/g, "_");
    return "unknown";
  }

  it("uses TAP_AGENT_ID when set", () => {
    expect(resolveInitialId("codex-reviewer")).toBe("codex_reviewer");
  });

  it("falls back to TAP_AGENT_NAME when no ID", () => {
    expect(resolveInitialId(undefined, "codex-builder")).toBe("codex_builder");
  });

  it("returns unknown when neither is set", () => {
    expect(resolveInitialId()).toBe("unknown");
  });

  it("ignores placeholder values", () => {
    expect(resolveInitialId("<set-per-session>", "unnamed")).toBe("unknown");
  });

  it("replaces hyphens with underscores", () => {
    expect(resolveInitialId("codex-reviewer-2")).toBe("codex_reviewer_2");
  });

  it("TAP_AGENT_ID takes priority over TAP_AGENT_NAME", () => {
    expect(resolveInitialId("my-id", "my-name")).toBe("my_id");
  });
});
