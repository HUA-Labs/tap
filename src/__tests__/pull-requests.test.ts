import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ─── Module mock ────────────────────────────────────────────────
// vi.mock is hoisted, so mock fns must be declared before it via vi.hoisted

const spawnSyncMock = vi.fn();

vi.mock("node:child_process", async () => {
  const actual =
    await vi.importActual<typeof import("node:child_process")>(
      "node:child_process",
    );
  return {
    ...actual,
    spawnSync: spawnSyncMock,
  };
});

// Dynamic import so the mock is in place before module evaluation
const { fetchOpenPrs, fetchMergedPrs, fetchPrs } = await import(
  "../engine/pull-requests.js"
);

// ─── Helpers ────────────────────────────────────────────────────

function makePrEntry(
  overrides: Partial<{
    number: number;
    title: string;
    state: string;
    author: { login: string };
    headRefName: string;
    url: string;
  }> = {},
) {
  return {
    number: 1,
    title: "My PR",
    state: "OPEN",
    author: { login: "alice" },
    headRefName: "feat/my-feature",
    url: "https://github.com/owner/repo/pull/1",
    ...overrides,
  };
}

function mockSpawnSuccess(stdout: string) {
  spawnSyncMock.mockReturnValue({
    stdout,
    stderr: "",
    status: 0,
    pid: 0,
    output: [],
    signal: null,
    error: undefined,
  });
}

function mockSpawnFailure() {
  spawnSyncMock.mockReturnValue({
    stdout: "",
    stderr: "error",
    status: 1,
    pid: 0,
    output: [],
    signal: null,
    error: undefined,
  });
}

// ─── Tests ──────────────────────────────────────────────────────

beforeEach(() => {
  spawnSyncMock.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("fetchOpenPrs", () => {
  it("returns empty array when gh returns non-zero exit code", () => {
    mockSpawnFailure();
    expect(fetchOpenPrs("/some/repo")).toEqual([]);
  });

  it("returns empty array when gh returns empty output", () => {
    mockSpawnSuccess("");
    expect(fetchOpenPrs("/some/repo")).toEqual([]);
  });

  it("returns empty array when spawnSync reports an error", () => {
    spawnSyncMock.mockReturnValue({
      stdout: "",
      stderr: "",
      status: 1,
      pid: 0,
      output: [],
      signal: null,
      error: new Error("gh not found"),
    });
    expect(fetchOpenPrs("/some/repo")).toEqual([]);
  });

  it("parses open PRs correctly", () => {
    const entries = [
      makePrEntry({
        number: 42,
        title: "Add feature X",
        state: "OPEN",
        author: { login: "bob" },
        headRefName: "feat/x",
        url: "https://github.com/org/repo/pull/42",
      }),
    ];
    mockSpawnSuccess(JSON.stringify(entries));

    const result = fetchOpenPrs("/some/repo");
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      number: 42,
      title: "Add feature X",
      state: "open",
      author: "bob",
      branch: "feat/x",
      url: "https://github.com/org/repo/pull/42",
      mergedAt: null,
    });
  });

  it("maps OPEN state to open", () => {
    mockSpawnSuccess(JSON.stringify([makePrEntry({ state: "OPEN" })]));
    const [pr] = fetchOpenPrs("/repo");
    expect(pr?.state).toBe("open");
  });

  it("maps MERGED state to merged", () => {
    mockSpawnSuccess(JSON.stringify([makePrEntry({ state: "MERGED" })]));
    const [pr] = fetchOpenPrs("/repo");
    expect(pr?.state).toBe("merged");
  });

  it("maps CLOSED state to closed", () => {
    mockSpawnSuccess(JSON.stringify([makePrEntry({ state: "CLOSED" })]));
    const [pr] = fetchOpenPrs("/repo");
    expect(pr?.state).toBe("closed");
  });
});

describe("fetchMergedPrs", () => {
  it("returns empty array on failure", () => {
    mockSpawnFailure();
    expect(fetchMergedPrs("/some/repo")).toEqual([]);
  });

  it("passes --state merged and --limit to gh", () => {
    mockSpawnSuccess("[]");

    fetchMergedPrs("/repo", 5);

    const args = spawnSyncMock.mock.calls[0]?.[1] as string[];
    expect(args).toContain("--state");
    expect(args).toContain("merged");
    expect(args).toContain("--limit");
    expect(args).toContain("5");
  });

  it("uses default limit of 20", () => {
    mockSpawnSuccess("[]");

    fetchMergedPrs("/repo");

    const args = spawnSyncMock.mock.calls[0]?.[1] as string[];
    const limitIdx = args.indexOf("--limit");
    expect(args[limitIdx + 1]).toBe("20");
  });
});

describe("fetchPrs", () => {
  it("returns object with open and merged arrays", () => {
    mockSpawnSuccess(JSON.stringify([makePrEntry()]));

    const result = fetchPrs("/repo");
    expect(result).toHaveProperty("open");
    expect(result).toHaveProperty("merged");
    expect(Array.isArray(result.open)).toBe(true);
    expect(Array.isArray(result.merged)).toBe(true);
  });

  it("returns empty arrays when gh unavailable", () => {
    mockSpawnFailure();
    const result = fetchPrs("/repo");
    expect(result.open).toEqual([]);
    expect(result.merged).toEqual([]);
  });
});
