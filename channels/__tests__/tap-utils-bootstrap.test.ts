import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
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
  delete process.env.TAP_STATE_DIR;
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

async function loadTapUtils() {
  vi.resetModules();
  return import("../tap-utils.ts");
}

beforeEach(() => {
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

  it("bootstraps from state when exactly one Codex instance exists", async () => {
    process.env.TAP_AGENT_NAME = "<set-per-session>";
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
    expect(tapUtils.isNameConfirmed()).toBe(true);
    expect(tapUtils.isForMe("codex_reviewer")).toBe(true);
    expect(tapUtils.isForMe("결")).toBe(true);
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
    expect(tapUtils.claimAgentName("돌")).toEqual({
      ok: false,
      currentName: "솔",
      agentId: "codex_worker",
    });
    expect(tapUtils.getAgentName()).toBe("솔");
  });

  it("treats a persisted real name as already confirmed and rejects overwrite", async () => {
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
    expect(tapUtils.getAgentName()).toBe("솔");
    expect(tapUtils.isNameConfirmed()).toBe(true);
    expect(tapUtils.claimAgentName("검")).toEqual({
      ok: false,
      currentName: "솔",
      agentId: "codex_worker",
    });
    expect(tapUtils.claimAgentName("솔")).toEqual({
      ok: true,
      oldName: "솔",
      agentId: "codex_worker",
      wasIdLocked: true,
    });
  });
});
