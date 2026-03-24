import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { bridgeCommand } from "../commands/bridge.js";

let tmpDir: string;
let originalCwd: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tap-bridge-cmd-test-"));

  // Create a minimal repo structure
  fs.writeFileSync(path.join(tmpDir, "package.json"), "{}", "utf-8");
  fs.mkdirSync(path.join(tmpDir, ".tap-comms"), { recursive: true });

  originalCwd = process.cwd();
  process.chdir(tmpDir);
});

afterEach(() => {
  process.chdir(originalCwd);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("bridgeCommand routing", () => {
  it("shows help with no subcommand", async () => {
    const result = await bridgeCommand([]);
    expect(result.ok).toBe(true);
    expect(result.code).toBe("TAP_NO_OP");
  });

  it("shows help with --help", async () => {
    const result = await bridgeCommand(["--help"]);
    expect(result.ok).toBe(true);
    expect(result.code).toBe("TAP_NO_OP");
  });

  it("rejects unknown subcommand", async () => {
    const result = await bridgeCommand(["foo"]);
    expect(result.ok).toBe(false);
    expect(result.code).toBe("TAP_INVALID_ARGUMENT");
    expect(result.message).toContain("Unknown bridge subcommand");
  });

  it("start requires instance argument", async () => {
    const result = await bridgeCommand(["start"]);
    expect(result.ok).toBe(false);
    expect(result.code).toBe("TAP_INVALID_ARGUMENT");
    expect(result.message).toContain("Missing instance");
  });

  it("start returns NOT_INITIALIZED when no state file", async () => {
    const result = await bridgeCommand(["start", "codex"]);
    expect(result.ok).toBe(false);
    expect(result.code).toBe("TAP_NOT_INITIALIZED");
  });

  it("stop returns NOT_INITIALIZED when no state file", async () => {
    const result = await bridgeCommand(["stop", "codex"]);
    expect(result.ok).toBe(false);
    expect(result.code).toBe("TAP_NOT_INITIALIZED");
  });

  it("stop all returns NOT_INITIALIZED when no state file", async () => {
    const result = await bridgeCommand(["stop"]);
    expect(result.ok).toBe(false);
    expect(result.code).toBe("TAP_NOT_INITIALIZED");
  });

  it("status returns NOT_INITIALIZED when no state file", async () => {
    const result = await bridgeCommand(["status"]);
    expect(result.ok).toBe(false);
    expect(result.code).toBe("TAP_NOT_INITIALIZED");
  });
});

function makeV2State(instances: Record<string, unknown>) {
  return {
    schemaVersion: 2,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    commsDir: path.join(tmpDir, "comms"),
    repoRoot: tmpDir,
    packageVersion: "0.1.0",
    instances,
  };
}

function makeInstance(
  runtime: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    instanceId: overrides.instanceId ?? runtime,
    runtime,
    agentName: null,
    port: null,
    installed: true,
    configPath: "",
    bridgeMode: overrides.bridgeMode ?? "app-server",
    restartRequired: false,
    ownedArtifacts: [],
    backupPath: "",
    lastAppliedHash: "",
    lastVerifiedAt: null,
    bridge: null,
    warnings: [],
    ...overrides,
  };
}

describe("bridgeCommand with initialized state", () => {
  beforeEach(() => {
    const state = makeV2State({
      codex: makeInstance("codex"),
      claude: makeInstance("claude", { bridgeMode: "native-push" }),
    });
    fs.writeFileSync(
      path.join(tmpDir, ".tap-comms", "state.json"),
      JSON.stringify(state, null, 2),
      "utf-8",
    );
    fs.mkdirSync(path.join(tmpDir, "comms"), { recursive: true });
  });

  it("start native-push instance returns NO_OP", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const result = await bridgeCommand(["start", "claude"]);
    expect(result.ok).toBe(true);
    expect(result.code).toBe("TAP_NO_OP");
    expect(result.message).toContain("native-push");
    vi.restoreAllMocks();
  });

  it("status shows all instances", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const result = await bridgeCommand(["status"]);
    expect(result.ok).toBe(true);
    expect(result.code).toBe("TAP_BRIDGE_STATUS_OK");
    expect(result.data).toHaveProperty("bridges");
    vi.restoreAllMocks();
  });

  it("status for specific instance works", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const result = await bridgeCommand(["status", "codex"]);
    expect(result.ok).toBe(true);
    expect(result.code).toBe("TAP_BRIDGE_STATUS_OK");
    expect(result.data).toHaveProperty("bridgeMode", "app-server");
    vi.restoreAllMocks();
  });

  it("stop with no running bridge returns BRIDGE_NOT_RUNNING", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const result = await bridgeCommand(["stop", "codex"]);
    expect(result.ok).toBe(true);
    expect(result.code).toBe("TAP_BRIDGE_NOT_RUNNING");
    vi.restoreAllMocks();
  });

  it("stop all with no running bridges returns BRIDGE_NOT_RUNNING", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const result = await bridgeCommand(["stop"]);
    expect(result.ok).toBe(true);
    expect(result.code).toBe("TAP_BRIDGE_NOT_RUNNING");
    vi.restoreAllMocks();
  });

  it("start for non-existent instance returns INSTANCE_NOT_FOUND", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const result = await bridgeCommand(["start", "gemini"]);
    expect(result.ok).toBe(false);
    expect(result.code).toBe("TAP_INSTANCE_NOT_FOUND");
    vi.restoreAllMocks();
  });

  it("status for native-push instance reports n/a (not stopped)", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const result = await bridgeCommand(["status", "claude"]);
    expect(result.ok).toBe(true);
    expect(result.code).toBe("TAP_BRIDGE_STATUS_OK");
    expect(result.data).toHaveProperty("status", "n/a");
    expect(result.message).toContain("n/a");
    vi.restoreAllMocks();
  });

  it("stop clears stale bridge metadata from state", async () => {
    // Write stale bridge info into state
    const stateFile = path.join(tmpDir, ".tap-comms", "state.json");
    const state = JSON.parse(fs.readFileSync(stateFile, "utf-8"));
    state.instances.codex.bridge = {
      pid: 999999,
      statePath: path.join(tmpDir, ".tap-comms", "pids", "bridge-codex.json"),
      lastHeartbeat: "2026-01-01T00:00:00.000Z",
    };
    fs.writeFileSync(stateFile, JSON.stringify(state, null, 2), "utf-8");

    vi.spyOn(console, "log").mockImplementation(() => {});
    const result = await bridgeCommand(["stop", "codex"]);
    expect(result.ok).toBe(true);
    expect(result.code).toBe("TAP_BRIDGE_NOT_RUNNING");

    // Verify state.json bridge field was cleared
    const after = JSON.parse(fs.readFileSync(stateFile, "utf-8"));
    expect(after.instances.codex.bridge).toBeNull();
    vi.restoreAllMocks();
  });
});

describe("multi-instance resolution", () => {
  beforeEach(() => {
    const state = makeV2State({
      codex: makeInstance("codex", { instanceId: "codex" }),
      "codex-reviewer": makeInstance("codex", {
        instanceId: "codex-reviewer",
        port: 4501,
      }),
    });
    fs.writeFileSync(
      path.join(tmpDir, ".tap-comms", "state.json"),
      JSON.stringify(state, null, 2),
      "utf-8",
    );
    fs.mkdirSync(path.join(tmpDir, "comms"), { recursive: true });
  });

  it("start with runtime name returns INSTANCE_AMBIGUOUS when multiple exist (no exact match)", async () => {
    // Overwrite state with instances where runtime name isn't an exact instance ID
    const state = makeV2State({
      "codex-builder": makeInstance("codex", { instanceId: "codex-builder" }),
      "codex-reviewer": makeInstance("codex", {
        instanceId: "codex-reviewer",
        port: 4501,
      }),
    });
    fs.writeFileSync(
      path.join(tmpDir, ".tap-comms", "state.json"),
      JSON.stringify(state, null, 2),
      "utf-8",
    );

    vi.spyOn(console, "log").mockImplementation(() => {});
    const result = await bridgeCommand(["start", "codex"]);
    expect(result.ok).toBe(false);
    expect(result.code).toBe("TAP_INSTANCE_AMBIGUOUS");
    expect(result.message).toContain("codex-reviewer");
    expect(result.message).toContain("codex-builder");
    vi.restoreAllMocks();
  });

  it("start with explicit instance ID works", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const result = await bridgeCommand(["status", "codex-reviewer"]);
    expect(result.ok).toBe(true);
    expect(result.data).toHaveProperty("port", 4501);
    vi.restoreAllMocks();
  });

  it("status shows both instances", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const result = await bridgeCommand(["status"]);
    expect(result.ok).toBe(true);
    const bridges = result.data.bridges as Record<string, unknown>;
    expect(Object.keys(bridges)).toHaveLength(2);
    expect(bridges).toHaveProperty("codex");
    expect(bridges).toHaveProperty("codex-reviewer");
    vi.restoreAllMocks();
  });
});
