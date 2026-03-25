import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RuntimeAdapter, TapState } from "../types.js";

const loadStateMock = vi.fn();
const getAdapterMock = vi.fn();
const findRepoRootMock = vi.fn();
const createAdapterContextMock = vi.fn();

vi.mock("../state.js", () => ({
  loadState: loadStateMock,
  saveState: vi.fn(),
  updateInstanceState: vi.fn(),
  ensureBackupDir: vi.fn(),
}));

vi.mock("../adapters/index.js", () => ({
  getAdapter: getAdapterMock,
}));

vi.mock("../utils.js", async () => {
  const actual =
    await vi.importActual<typeof import("../utils.js")>("../utils.js");
  return {
    ...actual,
    findRepoRoot: findRepoRootMock,
    createAdapterContext: createAdapterContextMock,
    log: vi.fn(),
    logSuccess: vi.fn(),
    logWarn: vi.fn(),
    logError: vi.fn(),
    logHeader: vi.fn(),
  };
});

const { addCommand } = await import("../commands/add.js");

function makeState(): TapState {
  return {
    schemaVersion: 2,
    createdAt: "2026-03-24T00:00:00.000Z",
    updatedAt: "2026-03-24T00:00:00.000Z",
    commsDir: "D:/repo/tap-comms",
    repoRoot: "D:/repo",
    packageVersion: "0.1.0",
    instances: {},
  };
}

describe("addCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findRepoRootMock.mockReturnValue("D:/repo");
    createAdapterContextMock.mockReturnValue({
      commsDir: "D:/repo/tap-comms",
      repoRoot: "D:/repo",
      stateDir: "D:/repo/.tap-comms",
      platform: "win32",
    });
    loadStateMock.mockReturnValue(makeState());
  });

  it("fails when the adapter cannot produce any patch operations", async () => {
    const adapter: RuntimeAdapter = {
      runtime: "claude",
      probe: vi.fn().mockResolvedValue({
        installed: true,
        configPath: "D:/repo/.mcp.json",
        configExists: false,
        runtimeCommand: "claude",
        version: null,
        canWrite: true,
        warnings: [],
        issues: [
          "tap-comms MCP server entry not found. Reinstall @hua-labs/tap or run from a repo with packages/tap-plugin/channels/ available.",
        ],
      }),
      plan: vi.fn().mockResolvedValue({
        runtime: "claude",
        operations: [],
        ownedArtifacts: [],
        backupDir: "D:/repo/.tap-comms/backups/claude",
        restartRequired: false,
        conflicts: [],
        warnings: [],
      }),
      apply: vi.fn(),
      verify: vi.fn(),
      bridgeMode: () => "native-push",
    };

    getAdapterMock.mockReturnValue(adapter);

    const result = await addCommand(["claude"]);

    expect(result.ok).toBe(false);
    expect(result.code).toBe("TAP_LOCAL_SERVER_MISSING");
    expect(result.message).toContain("tap-comms MCP server entry not found");
  });
});
