import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const TEST_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  ".bootstrap-tmp",
);

function resetEnv() {
  delete process.env.TAP_COMMS_DIR;
  delete process.env.TAP_AGENT_ID;
  delete process.env.TAP_AGENT_NAME;
  delete process.env.TAP_INSTANCE_ID;
  delete process.env.TAP_BRIDGE_INSTANCE_ID;
  delete process.env.CODEX_TAP_AGENT_NAME;
  delete process.env.TAP_STATE_DIR;
  delete process.env.TAP_RUNTIME_STATE_DIR;
}

function resetTestDir() {
  rmSync(TEST_DIR, { recursive: true, force: true });
  mkdirSync(TEST_DIR, { recursive: true });
}

function writeState(instances: Record<string, unknown>) {
  const stateDir = join(TEST_DIR, ".tap-comms");
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(
    join(stateDir, "state.json"),
    JSON.stringify(
      {
        schemaVersion: 2,
        createdAt: "2026-03-31T00:00:00.000Z",
        updatedAt: "2026-03-31T00:00:00.000Z",
        commsDir: TEST_DIR,
        repoRoot: TEST_DIR,
        packageVersion: "0.3.1",
        instances,
      },
      null,
      2,
    ),
    "utf-8",
  );
  process.env.TAP_STATE_DIR = stateDir;
}

function bumpRoutingRegistryMarker() {
  const registryDir = join(TEST_DIR, ".tap-comms", "routing-runtimes");
  mkdirSync(registryDir, { recursive: true });
  writeRoutingRegistryMarker({
    version: randomUUID(),
    updatedAt: new Date().toISOString(),
  });
}

function writeRoutingRegistryMarker(
  marker: { updatedAt: string; version?: string; pid?: number },
  fixedMtime?: Date,
) {
  const registryDir = join(TEST_DIR, ".tap-comms", "routing-runtimes");
  mkdirSync(registryDir, { recursive: true });
  const markerPath = join(registryDir, ".registry-version");
  writeFileSync(markerPath, JSON.stringify(marker, null, 2), "utf-8");
  if (fixedMtime) {
    utimesSync(markerPath, fixedMtime, fixedMtime);
  }
}

async function loadTapUtils() {
  vi.resetModules();
  return import("../tap-utils.ts");
}

beforeEach(() => {
  resetEnv();
  resetTestDir();
  process.env.TAP_COMMS_DIR = TEST_DIR;
});

afterEach(() => {
  resetEnv();
  resetTestDir();
});

describe("tap-utils bootstrap", () => {
  it("keeps concrete env identity ahead of state bootstrap", async () => {
    process.env.TAP_AGENT_ID = "manual-agent";
    process.env.TAP_AGENT_NAME = "수";
    writeState({
      "codex-reviewer": {
        instanceId: "codex-reviewer",
        runtime: "codex",
        installed: true,
        agentName: "결",
      },
    });

    const tapUtils = await loadTapUtils();

    expect(tapUtils.getAgentId()).toBe("manual_agent");
    expect(tapUtils.getAgentName()).toBe("수");
    expect(tapUtils.isNameConfirmed()).toBe(true);
    expect(tapUtils.isForMe("manual_agent")).toBe(true);
  });

  it("bootstraps codex identity from shared state when codex runtime is detected", async () => {
    process.env.TAP_AGENT_NAME = "<set-per-session>";
    process.env.CODEX_TAP_AGENT_NAME = "결";
    writeState({
      "codex-reviewer": {
        instanceId: "codex-reviewer",
        runtime: "codex",
        installed: true,
        agentName: "결",
      },
      claude: {
        instanceId: "claude",
        runtime: "claude",
        installed: true,
        agentName: "흔",
      },
    });

    const tapUtils = await loadTapUtils();

    expect(tapUtils.getAgentId()).toBe("codex_reviewer");
    expect(tapUtils.getAgentName()).toBe("결");
    expect(tapUtils.isNameConfirmed()).toBe(false);
    expect(tapUtils.isForMe("codex_reviewer")).toBe(true);
    expect(tapUtils.isForMe("결")).toBe(true);
  });

  it("does not treat arbitrary TAP_RUNTIME_STATE_DIR as a codex runtime signal", async () => {
    process.env.TAP_AGENT_NAME = "unnamed";
    const runtimeStateDir = join(TEST_DIR, ".tmp", "random-runtime");
    mkdirSync(runtimeStateDir, { recursive: true });
    writeFileSync(join(runtimeStateDir, "agent-name.txt"), "솔", "utf-8");
    process.env.TAP_RUNTIME_STATE_DIR = runtimeStateDir;
    writeState({
      codex: {
        instanceId: "codex",
        runtime: "codex",
        installed: true,
        agentName: "솔",
      },
    });

    const tapUtils = await loadTapUtils();
    const snapshot = tapUtils.getAgentIdentitySnapshot();

    expect(tapUtils.getAgentId()).toBe("unknown");
    expect(tapUtils.getAgentName()).toBe("솔");
    expect(tapUtils.isNameConfirmed()).toBe(false);
    expect(snapshot.bootstrap).toBeNull();
    expect(snapshot.resolvedCurrentInstanceId).toBeNull();
  });

  it("ignores TAP_RUNTIME_STATE_DIR and still bootstraps from shared TAP_STATE_DIR", async () => {
    process.env.TAP_AGENT_NAME = "<set-per-session>";
    process.env.TAP_RUNTIME_STATE_DIR = join(
      TEST_DIR,
      ".tmp",
      "codex-app-server-bridge-codex-reviewer",
    );
    writeState({
      "codex-reviewer": {
        instanceId: "codex-reviewer",
        runtime: "codex",
        installed: true,
        agentName: "결",
      },
    });

    const tapUtils = await loadTapUtils();

    expect(tapUtils.getAgentId()).toBe("codex_reviewer");
    expect(tapUtils.getAgentName()).toBe("결");
    expect(tapUtils.isNameConfirmed()).toBe(false);
  });

  it("stays unknown when multiple Codex instances exist", async () => {
    process.env.TAP_AGENT_NAME = "<set-per-session>";
    writeState({
      codex: {
        instanceId: "codex",
        runtime: "codex",
        installed: true,
        agentName: "결",
      },
      "codex-reviewer": {
        instanceId: "codex-reviewer",
        runtime: "codex",
        installed: true,
        agentName: "덱",
      },
    });

    const tapUtils = await loadTapUtils();

    expect(tapUtils.getAgentId()).toBe("unknown");
    expect(tapUtils.getAgentName()).toBe("unknown");
    expect(tapUtils.isNameConfirmed()).toBe(false);
    expect(tapUtils.isForMe("codex_reviewer")).toBe(false);
  });

  it("rebinds attach sessions from runtime state dir when identity env is missing", async () => {
    process.env.TAP_AGENT_NAME = "<set-per-session>";
    writeState({
      codex: {
        instanceId: "codex",
        runtime: "codex",
        installed: true,
        agentName: "해",
      },
      "codex-reviewer": {
        instanceId: "codex-reviewer",
        runtime: "codex",
        installed: true,
        agentName: "린",
      },
    });

    const runtimeStateDir = join(
      TEST_DIR,
      ".tmp",
      "codex-app-server-bridge-codex-reviewer",
    );
    mkdirSync(runtimeStateDir, { recursive: true });
    writeFileSync(
      join(runtimeStateDir, "heartbeat.json"),
      JSON.stringify(
        {
          agent: "린",
          threadId: "thread-review",
        },
        null,
        2,
      ),
      "utf-8",
    );
    process.env.TAP_RUNTIME_STATE_DIR = runtimeStateDir;

    const tapUtils = await loadTapUtils();
    const snapshot = tapUtils.getAgentIdentitySnapshot();

    expect(tapUtils.getAgentId()).toBe("codex_reviewer");
    expect(tapUtils.getAgentName()).toBe("린");
    expect(tapUtils.isNameConfirmed()).toBe(false);
    expect(tapUtils.isForMe("codex_reviewer")).toBe(true);
    expect(tapUtils.isForMe("린")).toBe(true);
    expect(snapshot.address).toMatchObject({
      clientId: "codex-reviewer",
      conversationId: "thread-review",
      ownerClientId: "codex-reviewer",
    });
  });

  it("propagates same-runtime identity changes through the shared routing registry", async () => {
    process.env.TAP_AGENT_NAME = "<set-per-session>";
    writeState({
      "codex-reviewer": {
        instanceId: "codex-reviewer",
        runtime: "codex",
        installed: true,
        agentName: "린",
      },
    });

    const runtimeStateDir = join(
      TEST_DIR,
      ".tmp",
      "codex-app-server-bridge-codex-reviewer",
    );
    mkdirSync(runtimeStateDir, { recursive: true });
    process.env.TAP_RUNTIME_STATE_DIR = runtimeStateDir;

    const writer = await loadTapUtils();
    expect(writer.getAgentName()).toBe("린");
    expect(writer.claimAgentName("한")).toMatchObject({ ok: true });
    expect(writer.getAgentName()).toBe("한");

    const registryDir = join(TEST_DIR, ".tap-comms", "routing-runtimes");
    const registryFile = readdirSync(registryDir).find((entry) =>
      entry.endsWith(".json"),
    );
    expect(registryFile).toBeTruthy();
    const snapshotPath = join(registryDir, registryFile!);
    const siblingSnapshot = JSON.parse(readFileSync(snapshotPath, "utf-8")) as {
      updatedAt: string;
    };
    siblingSnapshot.updatedAt = "2099-01-01T00:00:00.000Z";
    writeFileSync(
      join(registryDir, "manual-sibling-runtime.json"),
      JSON.stringify(siblingSnapshot, null, 2),
      "utf-8",
    );
    bumpRoutingRegistryMarker();

    const sibling = await loadTapUtils();
    expect(sibling.getAgentId()).toBe("codex_reviewer");
    expect(sibling.getAgentName()).toBe("한");
    expect(sibling.isForMe("한")).toBe(true);
    expect(sibling.isForMe("린")).toBe(false);
  });

  it("invalidates a warmed routing cache immediately when a sibling snapshot marker changes", async () => {
    process.env.TAP_AGENT_NAME = "<set-per-session>";
    writeState({
      "codex-reviewer": {
        instanceId: "codex-reviewer",
        runtime: "codex",
        installed: true,
        agentName: "린",
      },
    });

    const runtimeStateDir = join(
      TEST_DIR,
      ".tmp",
      "codex-app-server-bridge-codex-reviewer",
    );
    mkdirSync(runtimeStateDir, { recursive: true });
    process.env.TAP_RUNTIME_STATE_DIR = runtimeStateDir;

    const tapUtils = await loadTapUtils();
    expect(tapUtils.isForMe("한")).toBe(false);

    const registryDir = join(TEST_DIR, ".tap-comms", "routing-runtimes");
    const runtimeKey = tapUtils.getRoutingRuntimeKey();
    const warmedSnapshot = {
      version: 1,
      pid: process.pid,
      runtimeKey,
      agentId: "codex_reviewer",
      agentName: "한",
      idLocked: true,
      nameConfirmed: true,
      routingAddress: "codex_reviewer",
      routingSlot: null,
      aliases: ["codex_reviewer", "한"],
      instanceId: "codex-reviewer",
      stateDir: process.env.TAP_STATE_DIR ?? null,
      runtimeStateDir,
      repoRoot: null,
      updatedAt: "2099-01-01T00:00:00.000Z",
    };

    writeFileSync(
      join(registryDir, "manual-hot-cache-runtime.json"),
      JSON.stringify(warmedSnapshot, null, 2),
      "utf-8",
    );
    bumpRoutingRegistryMarker();

    expect(tapUtils.isForMe("한")).toBe(true);
    expect(tapUtils.getAgentName()).toBe("한");
  });

  it("invalidates a warmed routing cache when marker version changes without an mtime bump", async () => {
    process.env.TAP_AGENT_NAME = "<set-per-session>";
    writeState({
      "codex-reviewer": {
        instanceId: "codex-reviewer",
        runtime: "codex",
        installed: true,
        agentName: "린",
      },
    });

    const runtimeStateDir = join(
      TEST_DIR,
      ".tmp",
      "codex-app-server-bridge-codex-reviewer",
    );
    mkdirSync(runtimeStateDir, { recursive: true });
    process.env.TAP_RUNTIME_STATE_DIR = runtimeStateDir;

    const tapUtils = await loadTapUtils();
    expect(tapUtils.isForMe("한")).toBe(false);

    const registryDir = join(TEST_DIR, ".tap-comms", "routing-runtimes");
    const runtimeKey = tapUtils.getRoutingRuntimeKey();
    const fixedMtime = new Date("2026-04-19T10:30:00.000Z");

    writeRoutingRegistryMarker(
      {
        version: "marker-v1",
        updatedAt: "2026-04-19T10:30:00.000Z",
      },
      fixedMtime,
    );
    expect(tapUtils.isForMe("한")).toBe(false);

    const warmedSnapshot = {
      version: 1,
      pid: process.pid,
      runtimeKey,
      agentId: "codex_reviewer",
      agentName: "한",
      idLocked: true,
      nameConfirmed: true,
      routingAddress: "codex_reviewer",
      routingSlot: null,
      aliases: ["codex_reviewer", "한"],
      instanceId: "codex-reviewer",
      stateDir: process.env.TAP_STATE_DIR ?? null,
      runtimeStateDir,
      repoRoot: null,
      updatedAt: "2099-01-01T00:00:00.000Z",
    };

    writeFileSync(
      join(registryDir, "manual-same-mtime-runtime.json"),
      JSON.stringify(warmedSnapshot, null, 2),
      "utf-8",
    );
    writeRoutingRegistryMarker(
      {
        version: "marker-v2",
        updatedAt: "2026-04-19T10:30:00.000Z",
      },
      fixedMtime,
    );

    expect(tapUtils.isForMe("한")).toBe(true);
    expect(tapUtils.getAgentName()).toBe("한");
  });

  it("invalidates a warmed routing cache when a legacy marker rewrites the same updatedAt", async () => {
    process.env.TAP_AGENT_NAME = "<set-per-session>";
    writeState({
      "codex-reviewer": {
        instanceId: "codex-reviewer",
        runtime: "codex",
        installed: true,
        agentName: "린",
      },
    });

    const runtimeStateDir = join(
      TEST_DIR,
      ".tmp",
      "codex-app-server-bridge-codex-reviewer",
    );
    mkdirSync(runtimeStateDir, { recursive: true });
    process.env.TAP_RUNTIME_STATE_DIR = runtimeStateDir;

    const tapUtils = await loadTapUtils();
    const registryDir = join(TEST_DIR, ".tap-comms", "routing-runtimes");
    const runtimeKey = tapUtils.getRoutingRuntimeKey();
    const fixedMtime = new Date("2026-04-19T10:35:00.000Z");
    const legacyUpdatedAt = "2026-04-19T10:35:00.000Z";

    writeRoutingRegistryMarker(
      {
        updatedAt: legacyUpdatedAt,
        pid: 111,
      },
      fixedMtime,
    );
    expect(tapUtils.isForMe("한")).toBe(false);

    const warmedSnapshot = {
      version: 1,
      pid: process.pid,
      runtimeKey,
      agentId: "codex_reviewer",
      agentName: "한",
      idLocked: true,
      nameConfirmed: true,
      routingAddress: "codex_reviewer",
      routingSlot: null,
      aliases: ["codex_reviewer", "한"],
      instanceId: "codex-reviewer",
      stateDir: process.env.TAP_STATE_DIR ?? null,
      runtimeStateDir,
      repoRoot: null,
      updatedAt: "2099-01-01T00:00:00.000Z",
    };

    writeFileSync(
      join(registryDir, "manual-legacy-runtime.json"),
      JSON.stringify(warmedSnapshot, null, 2),
      "utf-8",
    );
    writeRoutingRegistryMarker(
      {
        updatedAt: legacyUpdatedAt,
        pid: 222,
      },
      fixedMtime,
    );

    expect(tapUtils.isForMe("한")).toBe(true);
    expect(tapUtils.getAgentName()).toBe("한");
  });

  it("reports other live runtimes on the same TAP_STATE_DIR as conflicts", async () => {
    writeState({});

    const alphaRuntimeDir = join(
      TEST_DIR,
      ".tmp",
      "codex-app-server-bridge-codex-alpha",
    );
    mkdirSync(alphaRuntimeDir, { recursive: true });
    process.env.TAP_AGENT_NAME = "<set-per-session>";
    process.env.TAP_RUNTIME_STATE_DIR = alphaRuntimeDir;
    process.env.TAP_BRIDGE_INSTANCE_ID = "codex-alpha";
    process.env.CODEX_TAP_AGENT_NAME = "담";

    const alpha = await loadTapUtils();
    expect(alpha.getAgentId()).toBe("codex_alpha");
    expect(alpha.getAgentName()).toBe("담");

    const betaRuntimeDir = join(
      TEST_DIR,
      ".tmp",
      "codex-app-server-bridge-codex-beta",
    );
    mkdirSync(betaRuntimeDir, { recursive: true });
    process.env.TAP_RUNTIME_STATE_DIR = betaRuntimeDir;
    process.env.TAP_BRIDGE_INSTANCE_ID = "codex-beta";
    process.env.CODEX_TAP_AGENT_NAME = "한";

    const beta = await loadTapUtils();
    const probe = beta.buildAgentIdentityProbeSnapshot("한");

    expect(beta.getAgentId()).toBe("codex_beta");
    expect(beta.getAgentName()).toBe("한");
    expect(beta.isForMe("담")).toBe(false);
    expect(probe.runtimeCoordination.runtimeKey).toContain("codex-beta");
    expect(probe.runtimeCoordination.conflictingRuntimes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          agentId: "codex_alpha",
          agentName: "담",
        }),
      ]),
    );
  });

  it("allows first claim from placeholder bootstrap, then only idempotent repeats", async () => {
    process.env.TAP_AGENT_ID = "codex-worker";
    process.env.TAP_AGENT_NAME = "<set-per-session>";

    const tapUtils = await loadTapUtils();

    expect(tapUtils.isNameConfirmed()).toBe(false);
    expect(tapUtils.claimAgentName("솔")).toEqual({
      ok: true,
      oldName: "unknown",
      agentId: "codex_worker",
      wasIdLocked: true,
    });
    expect(tapUtils.getAgentName()).toBe("솔");
    expect(tapUtils.isNameConfirmed()).toBe(true);

    expect(tapUtils.claimAgentName("솔")).toEqual({
      ok: true,
      oldName: "솔",
      agentId: "codex_worker",
      wasIdLocked: true,
    });
    tapUtils.sealGraceWindow();
    expect(tapUtils.claimAgentName("돌")).toEqual({
      ok: false,
      currentName: "솔",
      agentId: "codex_worker",
    });
    expect(tapUtils.getAgentName()).toBe("솔");
  });

  // ── M317: Identity integration tests (M308 + M309 verification) ──

  it("M317-1: TAP_INSTANCE_ID skips codex bootstrap entirely", async () => {
    process.env.TAP_INSTANCE_ID = "claude-wt1";
    process.env.TAP_AGENT_NAME = "unnamed";
    writeState({
      "codex-reviewer": {
        instanceId: "codex-reviewer",
        runtime: "codex",
        installed: true,
        agentName: "결",
      },
    });

    const tapUtils = await loadTapUtils();

    // M308: TAP_INSTANCE_ID set → codex bootstrap skipped
    expect(tapUtils.getAgentId()).toBe("claude_wt1");
    expect(tapUtils.getAgentName()).not.toBe("결");
    expect(tapUtils.isNameConfirmed()).toBe(false);
  });

  it("M318: TAP_INSTANCE_ID only reads the matching Claude state entry", async () => {
    process.env.TAP_INSTANCE_ID = "claude-main";
    process.env.TAP_AGENT_NAME = "unnamed";
    writeState({
      "claude-main": {
        instanceId: "claude-main",
        runtime: "claude",
        installed: true,
        agentName: "흐",
      },
      "codex-reviewer": {
        instanceId: "codex-reviewer",
        runtime: "codex",
        installed: true,
        agentName: "결",
      },
    });

    const tapUtils = await loadTapUtils();
    const snapshot = tapUtils.getAgentIdentitySnapshot();

    expect(tapUtils.getAgentId()).toBe("claude_main");
    expect(tapUtils.getAgentName()).toBe("흐");
    expect(tapUtils.isNameConfirmed()).toBe(false);
    expect(snapshot.resolvedCurrentInstanceId).toBe("claude-main");
  });

  it("M318: does not derive agent id from TAP_AGENT_NAME alone", async () => {
    process.env.TAP_AGENT_NAME = "흐";

    const tapUtils = await loadTapUtils();

    expect(tapUtils.getAgentId()).toBe("unknown");
    expect(tapUtils.getAgentName()).toBe("흐");
    expect(tapUtils.isNameConfirmed()).toBe(true);
  });

  it("M317-2: grace window allows rename within 60s", async () => {
    process.env.TAP_AGENT_NAME = "unnamed";

    const tapUtils = await loadTapUtils();

    expect(tapUtils.claimAgentName("A")).toEqual(
      expect.objectContaining({ ok: true, oldName: "unknown" }),
    );
    expect(tapUtils.isNameConfirmed()).toBe(true);
    expect(tapUtils.isInGraceWindow()).toBe(true);
    // Rename within grace window
    expect(tapUtils.claimAgentName("B")).toEqual(
      expect.objectContaining({ ok: true, oldName: "A" }),
    );
    expect(tapUtils.getAgentName()).toBe("B");
  });

  it("M317-3: sealGraceWindow blocks subsequent rename", async () => {
    process.env.TAP_AGENT_NAME = "unnamed";

    const tapUtils = await loadTapUtils();

    tapUtils.claimAgentName("A");
    expect(tapUtils.isInGraceWindow()).toBe(true);
    // Simulate non-set_name tool call
    tapUtils.sealGraceWindow();
    expect(tapUtils.isInGraceWindow()).toBe(false);
    // Rename blocked
    expect(tapUtils.claimAgentName("B")).toEqual({
      ok: false,
      currentName: "A",
      agentId: expect.any(String),
    });
  });

  it("M317-4: grace window expiry blocks rename after 60 seconds", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-01T00:00:00.000Z"));
    process.env.TAP_AGENT_NAME = "unnamed";

    try {
      const tapUtils = await loadTapUtils();

      expect(tapUtils.claimAgentName("A")).toEqual(
        expect.objectContaining({ ok: true, oldName: "unknown" }),
      );
      expect(tapUtils.isInGraceWindow()).toBe(true);

      vi.advanceTimersByTime(60_001);

      expect(tapUtils.isInGraceWindow()).toBe(false);
      expect(tapUtils.claimAgentName("B")).toEqual({
        ok: false,
        currentName: "A",
        agentId: expect.any(String),
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("M317-5: unnamed env + stale state name → unconfirmed, set_name works", async () => {
    process.env.TAP_AGENT_ID = "my-agent";
    process.env.TAP_AGENT_NAME = "unnamed";
    writeState({
      "my-agent": {
        instanceId: "my-agent",
        runtime: "codex",
        installed: true,
        agentName: "이전세션이름",
      },
    });

    const tapUtils = await loadTapUtils();

    expect(tapUtils.getAgentName()).toBe("이전세션이름");
    expect(tapUtils.isNameConfirmed()).toBe(false);
    expect(tapUtils.claimAgentName("새이름")).toEqual(
      expect.objectContaining({ ok: true, oldName: "이전세션이름" }),
    );
    expect(tapUtils.getAgentName()).toBe("새이름");
  });

  it("M317-6: explicit env name overrides state name and is pre-confirmed", async () => {
    process.env.TAP_AGENT_ID = "my-agent";
    process.env.TAP_AGENT_NAME = "해";
    writeState({
      "my-agent": {
        instanceId: "my-agent",
        runtime: "codex",
        installed: true,
        agentName: "솔",
      },
    });

    const tapUtils = await loadTapUtils();

    // M309: explicit env takes priority over state
    expect(tapUtils.getAgentName()).toBe("해");
    expect(tapUtils.isNameConfirmed()).toBe(true);
    // Pre-sealed, rename blocked
    expect(tapUtils.claimAgentName("다른이름")).toEqual({
      ok: false,
      currentName: "해",
      agentId: expect.any(String),
    });
  });

  it("M309: placeholder env + persisted state name → unconfirmed, allows rename", async () => {
    process.env.TAP_AGENT_ID = "codex-worker";
    process.env.TAP_AGENT_NAME = "<set-per-session>";
    writeState({
      "codex-worker": {
        instanceId: "codex-worker",
        runtime: "codex",
        installed: true,
        agentName: "솔",
      },
    });

    const tapUtils = await loadTapUtils();

    expect(tapUtils.getAgentId()).toBe("codex_worker");
    // M309: state name loaded as display but NOT confirmed (env is placeholder)
    expect(tapUtils.getAgentName()).toBe("솔");
    expect(tapUtils.isNameConfirmed()).toBe(false);
    // New session can claim a different name
    expect(tapUtils.claimAgentName("검")).toEqual({
      ok: true,
      oldName: "솔",
      agentId: "codex_worker",
      wasIdLocked: true,
    });
    expect(tapUtils.getAgentName()).toBe("검");
  });

  it("M319: resetIdentity releases the active claim and suppresses stale rebootstrap", async () => {
    process.env.TAP_AGENT_ID = "codex-worker";
    process.env.TAP_AGENT_NAME = "<set-per-session>";
    writeState({
      "codex-worker": {
        instanceId: "codex-worker",
        runtime: "codex",
        installed: true,
        agentName: "이전세션이름",
      },
    });

    const tapUtils = await loadTapUtils();
    const claims = await import("../tap-claims.ts");

    expect(tapUtils.getAgentId()).toBe("codex_worker");
    expect(tapUtils.getAgentName()).toBe("이전세션이름");

    expect(tapUtils.claimAgentName("현재세션이름")).toEqual({
      ok: true,
      oldName: "이전세션이름",
      agentId: "codex_worker",
      wasIdLocked: true,
    });

    const instanceId = claims.resolveClaimInstanceId();
    expect(
      claims.claimName("현재세션이름", instanceId, process.pid, "mcp-direct")
        .success,
    ).toBe(true);
    expect(claims.checkClaim("현재세션이름")).not.toBeNull();

    const reset = await tapUtils.resetIdentity();

    expect(reset).toEqual({
      previousName: "현재세션이름",
      previousId: "codex_worker",
      nextName: "unknown",
      nextId: "unknown",
      releasedClaim: true,
    });
    expect(claims.checkClaim("현재세션이름")).toBeNull();
    expect(tapUtils.getAgentId()).toBe("unknown");
    expect(tapUtils.getAgentName()).toBe("unknown");
    expect(tapUtils.isIdLocked()).toBe(false);
    expect(tapUtils.isNameConfirmed()).toBe(false);
    expect(tapUtils.isInGraceWindow()).toBe(false);

    expect(tapUtils.claimAgentName("새세션이름")).toEqual({
      ok: true,
      oldName: "unknown",
      agentId: "새세션이름",
      wasIdLocked: false,
    });
    expect(tapUtils.getAgentId()).toBe("새세션이름");
    expect(tapUtils.getAgentName()).toBe("새세션이름");
  });
});
