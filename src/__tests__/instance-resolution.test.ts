import { describe, it, expect } from "vitest";
import {
  resolveInstanceId,
  buildInstanceId,
  extractRuntimeFromInstanceId,
  findPortConflict,
  findNextAvailablePort,
} from "../utils.js";
import type { TapState } from "../types.js";

function makeState(
  instances: Record<string, { runtime: string; port?: number | null }>,
): TapState {
  const full: TapState = {
    schemaVersion: 2,
    createdAt: "",
    updatedAt: "",
    commsDir: "",
    repoRoot: "",
    packageVersion: "0.1.0",
    instances: {},
  };

  for (const [id, { runtime, port }] of Object.entries(instances)) {
    full.instances[id] = {
      instanceId: id,
      runtime: runtime as "codex" | "claude" | "gemini",
      agentName: null,
      port: port ?? null,
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
    };
  }

  return full;
}

describe("resolveInstanceId", () => {
  it("exact match returns instance ID", () => {
    const state = makeState({ codex: { runtime: "codex" } });
    const result = resolveInstanceId("codex", state);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.instanceId).toBe("codex");
  });

  it("exact match for named instance", () => {
    const state = makeState({
      codex: { runtime: "codex" },
      "codex-reviewer": { runtime: "codex" },
    });
    const result = resolveInstanceId("codex-reviewer", state);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.instanceId).toBe("codex-reviewer");
  });

  it("runtime name resolves when single instance exists", () => {
    const state = makeState({ "codex-main": { runtime: "codex" } });
    const result = resolveInstanceId("codex", state);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.instanceId).toBe("codex-main");
  });

  it("runtime name returns AMBIGUOUS when multiple instances exist", () => {
    const state = makeState({
      codex: { runtime: "codex" },
      "codex-reviewer": { runtime: "codex" },
    });
    // "codex" is exact match here, so it resolves directly
    const result = resolveInstanceId("codex", state);
    expect(result.ok).toBe(true);

    // But if there's no exact match for the runtime name...
    const state2 = makeState({
      "codex-builder": { runtime: "codex" },
      "codex-reviewer": { runtime: "codex" },
    });
    const result2 = resolveInstanceId("codex", state2);
    expect(result2.ok).toBe(false);
    if (!result2.ok) {
      expect(result2.code).toBe("TAP_INSTANCE_AMBIGUOUS");
      expect(result2.message).toContain("codex-builder");
      expect(result2.message).toContain("codex-reviewer");
    }
  });

  it("returns NOT_FOUND for unknown identifier", () => {
    const state = makeState({ codex: { runtime: "codex" } });
    const result = resolveInstanceId("gemini", state);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("TAP_INSTANCE_NOT_FOUND");
  });

  it("returns NOT_FOUND for completely unknown string", () => {
    const state = makeState({ codex: { runtime: "codex" } });
    const result = resolveInstanceId("foobar", state);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("TAP_INSTANCE_NOT_FOUND");
  });
});

describe("buildInstanceId", () => {
  it("returns runtime name for default instance", () => {
    expect(buildInstanceId("codex")).toBe("codex");
  });

  it("returns runtime-name for named instance", () => {
    expect(buildInstanceId("codex", "reviewer")).toBe("codex-reviewer");
  });

  it("handles claude runtime", () => {
    expect(buildInstanceId("claude", "main")).toBe("claude-main");
  });
});

describe("extractRuntimeFromInstanceId", () => {
  it("extracts from default instance ID", () => {
    expect(extractRuntimeFromInstanceId("codex")).toBe("codex");
  });

  it("extracts from named instance ID", () => {
    expect(extractRuntimeFromInstanceId("codex-reviewer")).toBe("codex");
  });

  it("extracts from claude instance", () => {
    expect(extractRuntimeFromInstanceId("claude-main")).toBe("claude");
  });

  it("throws for invalid instance ID", () => {
    expect(() => extractRuntimeFromInstanceId("foobar")).toThrow(
      "Cannot extract runtime",
    );
  });
});

describe("findPortConflict", () => {
  it("returns null when no conflict", () => {
    const state = makeState({
      codex: { runtime: "codex", port: 4500 },
      "codex-reviewer": { runtime: "codex", port: 4501 },
    });
    expect(findPortConflict(state, 4502)).toBeNull();
  });

  it("returns conflicting instance ID", () => {
    const state = makeState({
      codex: { runtime: "codex", port: 4500 },
      "codex-reviewer": { runtime: "codex", port: 4501 },
    });
    expect(findPortConflict(state, 4501)).toBe("codex-reviewer");
  });

  it("excludes self from conflict check", () => {
    const state = makeState({
      codex: { runtime: "codex", port: 4500 },
    });
    expect(findPortConflict(state, 4500, "codex")).toBeNull();
  });

  it("returns null when instances have no port", () => {
    const state = makeState({
      codex: { runtime: "codex" },
      claude: { runtime: "claude" },
    });
    expect(findPortConflict(state, 4500)).toBeNull();
  });
});

describe("findNextAvailablePort", () => {
  it("returns basePort when no ports are assigned", () => {
    const state = makeState({
      codex: { runtime: "codex" },
      claude: { runtime: "claude" },
    });
    expect(findNextAvailablePort(state)).toBe(4501);
  });

  it("returns basePort when specified", () => {
    const state = makeState({});
    expect(findNextAvailablePort(state, 5000)).toBe(5000);
  });

  it("skips occupied ports", () => {
    const state = makeState({
      codex: { runtime: "codex", port: 4501 },
      "codex-reviewer": { runtime: "codex", port: 4502 },
    });
    expect(findNextAvailablePort(state)).toBe(4503);
  });

  it("finds gap between occupied ports", () => {
    const state = makeState({
      codex: { runtime: "codex", port: 4501 },
      "codex-reviewer": { runtime: "codex", port: 4503 },
    });
    expect(findNextAvailablePort(state)).toBe(4502);
  });

  it("excludes self from conflict check", () => {
    const state = makeState({
      codex: { runtime: "codex", port: 4501 },
    });
    expect(findNextAvailablePort(state, 4501, "codex")).toBe(4501);
  });

  it("handles mixed null and assigned ports", () => {
    const state = makeState({
      codex: { runtime: "codex", port: 4501 },
      claude: { runtime: "claude" }, // null port
      "codex-reviewer": { runtime: "codex", port: 4502 },
    });
    expect(findNextAvailablePort(state)).toBe(4503);
  });
});
