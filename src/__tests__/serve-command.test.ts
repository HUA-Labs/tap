import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import * as path from "node:path";

const spawnMock = vi.fn();
const buildManagedMcpServerSpecMock = vi.fn();
const createAdapterContextMock = vi.fn();
const findRepoRootMock = vi.fn();
const loadStateMock = vi.fn();

vi.mock("node:child_process", () => ({
  spawn: spawnMock,
}));

vi.mock("../adapters/common.js", () => ({
  buildManagedMcpServerSpec: buildManagedMcpServerSpecMock,
}));

vi.mock("../state.js", () => ({
  loadState: loadStateMock,
}));

vi.mock("../utils.js", async () => {
  const actual =
    await vi.importActual<typeof import("../utils.js")>("../utils.js");
  return {
    ...actual,
    createAdapterContext: createAdapterContextMock,
    findRepoRoot: findRepoRootMock,
    log: vi.fn(),
  };
});

const { serveCommand } = await import("../commands/serve.js");

describe("serveCommand", () => {
  const originalTapAgentName = process.env.TAP_AGENT_NAME;

  beforeEach(() => {
    vi.clearAllMocks();
    findRepoRootMock.mockReturnValue("D:/repo");
    createAdapterContextMock.mockReturnValue({
      commsDir: "D:/repo/tap-comms",
      repoRoot: "D:/repo",
      stateDir: "D:/repo/.tap-comms",
      platform: "win32",
      agentName: "솔",
    });
    buildManagedMcpServerSpecMock.mockReturnValue({
      command: "node",
      args: ["C:/repo/tap-comms.mjs"],
      env: {
        TAP_AGENT_NAME: "<set-per-session>",
        TAP_COMMS_DIR: "D:/repo/tap-comms",
        TAP_STATE_DIR: "D:/repo/.tap-comms",
        TAP_REPO_ROOT: "D:/repo",
      },
      sourcePath: "C:/repo/tap-comms.mjs",
      warnings: [],
      issues: [],
    });
    loadStateMock.mockReturnValue(null);
    spawnMock.mockImplementation(() => {
      const child = new EventEmitter();
      queueMicrotask(() => {
        child.emit("exit", 0);
      });
      return child as unknown as ReturnType<typeof spawnMock>;
    });
  });

  afterEach(() => {
    if (originalTapAgentName === undefined) {
      delete process.env.TAP_AGENT_NAME;
    } else {
      process.env.TAP_AGENT_NAME = originalTapAgentName;
    }
  });

  it("preserves an existing per-session TAP_AGENT_NAME over the managed placeholder", async () => {
    process.env.TAP_AGENT_NAME = "담";

    const result = await serveCommand(["--comms-dir", "D:/repo/tap-comms"]);
    const spawnOptions = spawnMock.mock.calls[0]?.[2];

    expect(result.ok).toBe(true);
    expect(spawnMock).toHaveBeenCalledWith(
      "node",
      ["C:/repo/tap-comms.mjs"],
      expect.any(Object),
    );
    expect(spawnOptions?.env).toMatchObject({
      TAP_AGENT_NAME: "담",
      TAP_COMMS_DIR: path.resolve("D:/repo/tap-comms"),
      TAP_STATE_DIR: "D:/repo/.tap-comms",
      TAP_REPO_ROOT: "D:/repo",
    });
  });

  it("uses the managed TAP_AGENT_NAME when no per-session name is present", async () => {
    delete process.env.TAP_AGENT_NAME;

    const result = await serveCommand(["--comms-dir", "D:/repo/tap-comms"]);
    const spawnOptions = spawnMock.mock.calls[0]?.[2];

    expect(result.ok).toBe(true);
    expect(spawnMock).toHaveBeenCalledWith(
      "node",
      ["C:/repo/tap-comms.mjs"],
      expect.any(Object),
    );
    expect(spawnOptions?.env).toMatchObject({
      TAP_AGENT_NAME: "<set-per-session>",
    });
  });
});
