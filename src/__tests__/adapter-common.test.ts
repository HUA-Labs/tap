import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const spawnSyncMock = vi.fn();
const homedirMock = vi.fn();

vi.mock("node:child_process", () => ({
  spawnSync: spawnSyncMock,
}));

vi.mock("node:os", async () => {
  const actual = await vi.importActual<typeof import("node:os")>("node:os");
  return {
    ...actual,
    homedir: () => homedirMock(),
  };
});

const resolverCommand = process.platform === "win32" ? "where.exe" : "which";

describe("adapter common command probes", () => {
  let tmpDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tap-common-test-"));
    homedirMock.mockReturnValue(path.join(tmpDir, "home"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("probes version commands without shell=true", async () => {
    const resolvedNodeCommand = path.join(
      tmpDir,
      process.platform === "win32" ? "node.exe" : "node",
    );
    fs.writeFileSync(resolvedNodeCommand, "", "utf8");

    spawnSyncMock.mockImplementation(
      (command: string, args?: string[], options?: Record<string, unknown>) => {
        if (command === resolverCommand && args?.[0] === "node") {
          return {
            status: 0,
            stdout: `${resolvedNodeCommand}\n`,
            stderr: "",
            output: [],
            pid: 1,
            signal: null,
          };
        }

        if (command === resolvedNodeCommand && args?.[0] === "--version") {
          expect(options).not.toHaveProperty("shell");
          return {
            status: 0,
            stdout: "v24.0.0\n",
            stderr: "",
            output: [],
            pid: 2,
            signal: null,
          };
        }

        return {
          status: 1,
          stdout: "",
          stderr: "",
          output: [],
          pid: 3,
          signal: null,
        };
      },
    );

    const { probeCommand } = await import("../adapters/common.js");
    const result = probeCommand(["node"]);

    expect(result).toEqual({
      command: resolvedNodeCommand,
      version: "v24.0.0",
    });
  });

  it("finds bun without shell=true on Windows-style launcher paths", async () => {
    const resolvedBunCommand = path.join(
      tmpDir,
      process.platform === "win32" ? "bun.cmd" : "bun",
    );
    fs.writeFileSync(resolvedBunCommand, "", "utf8");

    spawnSyncMock.mockImplementation(
      (command: string, args?: string[], options?: Record<string, unknown>) => {
        if (command === resolverCommand && args?.[0] === "bun") {
          return {
            status: 0,
            stdout: `${resolvedBunCommand}\n`,
            stderr: "",
            output: [],
            pid: 11,
            signal: null,
          };
        }

        if (command === resolvedBunCommand && args?.[0] === "--version") {
          expect(options).not.toHaveProperty("shell");
          return {
            status: 0,
            stdout: "1.2.0\n",
            stderr: "",
            output: [],
            pid: 12,
            signal: null,
          };
        }

        return {
          status: 1,
          stdout: "",
          stderr: "",
          output: [],
          pid: 13,
          signal: null,
        };
      },
    );

    const { findPreferredBunCommand } = await import("../adapters/common.js");
    const result = findPreferredBunCommand();

    expect(result).toBe(resolvedBunCommand.replace(/\\/g, "/"));
  });
});
