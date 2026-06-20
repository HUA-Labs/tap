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
    delete process.env.CODEX_HOME;
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tap-common-test-"));
    homedirMock.mockReturnValue(path.join(tmpDir, "home"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("probes absolute executable paths without shell=true", async () => {
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
          if (process.platform === "win32") {
            expect(options).toHaveProperty("shell", false);
          } else {
            expect(options).toHaveProperty("shell", false);
          }
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
          if (process.platform === "win32") {
            expect(options).toHaveProperty("shell", true);
          } else {
            expect(options).toHaveProperty("shell", false);
          }
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

  it("falls back to shell probing for unresolved bare Windows commands", async () => {
    spawnSyncMock.mockImplementation(
      (command: string, args?: string[], options?: Record<string, unknown>) => {
        if (command === resolverCommand && args?.[0] === "node") {
          return {
            status: 1,
            stdout: "",
            stderr: "",
            output: [],
            pid: 21,
            signal: null,
          };
        }

        if (command === "node" && args?.[0] === "--version") {
          if (process.platform === "win32") {
            expect(options).toHaveProperty("shell", true);
          } else {
            expect(options).toHaveProperty("shell", false);
          }
          return {
            status: 0,
            stdout: "v24.0.0\n",
            stderr: "",
            output: [],
            pid: 22,
            signal: null,
          };
        }

        return {
          status: 1,
          stdout: "",
          stderr: "",
          output: [],
          pid: 23,
          signal: null,
        };
      },
    );

    const { probeCommand } = await import("../adapters/common.js");
    const result = probeCommand(["node"]);

    expect(result).toEqual({
      command: "node",
      version: "v24.0.0",
    });
  });

  it("uses CODEX_HOME as the Codex config root when set", async () => {
    process.env.CODEX_HOME = path.join(tmpDir, "isolated-codex-home");

    const { getCodexConfigPath, getCodexHomeDir } =
      await import("../adapters/common.js");

    expect(getCodexHomeDir()).toBe(path.resolve(process.env.CODEX_HOME));
    expect(getCodexConfigPath()).toBe(
      path.join(path.resolve(process.env.CODEX_HOME), "config.toml"),
    );
  });

  it("falls back to ~/.codex/config.toml when CODEX_HOME is unset", async () => {
    delete process.env.CODEX_HOME;

    const { getCodexConfigPath, getCodexHomeDir } =
      await import("../adapters/common.js");

    expect(getCodexHomeDir()).toBe(path.join(tmpDir, "home", ".codex"));
    expect(getCodexConfigPath()).toBe(
      path.join(tmpDir, "home", ".codex", "config.toml"),
    );
  });
});
