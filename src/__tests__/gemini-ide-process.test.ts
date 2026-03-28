import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import os from "node:os";

const mockedExec = vi.hoisted(() => vi.fn());

vi.mock("node:util", () => ({
  promisify: vi.fn().mockReturnValue(mockedExec),
}));

vi.mock("node:os", () => ({
  default: {
    platform: vi.fn(),
  },
}));

const { detectGeminiIdeProcessPid } =
  await import("../bridges/gemini-ide-process.js");

describe("detectGeminiIdeProcessPid", () => {
  beforeEach(() => {
    Object.defineProperty(process, "pid", {
      configurable: true,
      value: 1000,
    });
    mockedExec.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("uses GEMINI_CLI_IDE_PID override when present", async () => {
    vi.stubEnv("GEMINI_CLI_IDE_PID", "54321");
    vi.mocked(os.platform).mockReturnValue("win32");

    await expect(detectGeminiIdeProcessPid()).resolves.toBe(54321);
    expect(mockedExec).not.toHaveBeenCalled();
  });

  it("matches Gemini CLI Windows process-tree selection", async () => {
    vi.mocked(os.platform).mockReturnValue("win32");
    mockedExec.mockResolvedValueOnce({
      stdout: JSON.stringify([
        {
          ProcessId: 1000,
          ParentProcessId: 900,
          Name: "node.exe",
          CommandLine: "node.exe",
        },
        {
          ProcessId: 900,
          ParentProcessId: 800,
          Name: "powershell.exe",
          CommandLine: "powershell.exe",
        },
        {
          ProcessId: 800,
          ParentProcessId: 700,
          Name: "Code.exe",
          CommandLine: "Code.exe",
        },
        {
          ProcessId: 700,
          ParentProcessId: 0,
          Name: "wininit.exe",
          CommandLine: "wininit.exe",
        },
      ]),
    });

    await expect(detectGeminiIdeProcessPid()).resolves.toBe(900);
  });

  it("finds the IDE pid above the shell on Unix", async () => {
    vi.mocked(os.platform).mockReturnValue("linux");
    mockedExec
      .mockResolvedValueOnce({ stdout: "800 /bin/bash" })
      .mockResolvedValueOnce({ stdout: "700 /usr/lib/vscode/code" });

    await expect(detectGeminiIdeProcessPid()).resolves.toBe(700);
  });

  it("falls back to the current process when Windows process lookup fails", async () => {
    vi.mocked(os.platform).mockReturnValue("win32");
    mockedExec.mockRejectedValueOnce(new Error("PowerShell failed"));

    await expect(detectGeminiIdeProcessPid()).resolves.toBe(1000);
  });
});
