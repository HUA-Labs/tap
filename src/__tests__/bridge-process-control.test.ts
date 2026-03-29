import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const execSyncMock = vi.fn();
const spawnSyncMock = vi.fn();
const delayMock = vi.fn(async () => undefined);

vi.mock("node:child_process", async () => {
  const actual =
    await vi.importActual<typeof import("node:child_process")>(
      "node:child_process",
    );
  return {
    ...actual,
    execSync: execSyncMock,
    spawnSync: spawnSyncMock,
  };
});

vi.mock("../engine/bridge-port-network.js", () => ({
  delay: delayMock,
}));

const { terminateProcess } = await import("../engine/bridge-process-control.js");

describe("terminateProcess", () => {
  let killSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    killSpy = vi.spyOn(process, "kill");
  });

  afterEach(() => {
    killSpy.mockRestore();
  });

  it("kills the unix process group when ps resolves a pgid", async () => {
    const alive = new Set([4322]);
    let groupAlive = true;
    spawnSyncMock.mockReturnValue({
      status: 0,
      stdout: "4321\n",
      stderr: "",
    });
    killSpy.mockImplementation(((pid: number, signal?: NodeJS.Signals | 0) => {
      if (signal === 0) {
        if (pid === -4321) {
          if (groupAlive) return true;
          throw new Error("ESRCH");
        }
        if (alive.has(pid)) return true;
        throw new Error("ESRCH");
      }
      if (pid === -4321) {
        alive.delete(4322);
        groupAlive = false;
        return true;
      }
      throw new Error(`unexpected kill target: ${pid}`);
    }) as typeof process.kill);

    await expect(terminateProcess(4322, "linux")).resolves.toBe(true);
    expect(spawnSyncMock).toHaveBeenCalledWith(
      "ps",
      ["-o", "pgid=", "-p", "4322"],
      expect.objectContaining({
        encoding: "utf-8",
        windowsHide: true,
      }),
    );
    expect(killSpy).toHaveBeenCalledWith(-4321, "SIGTERM");
    expect(killSpy).not.toHaveBeenCalledWith(-4321, "SIGKILL");
  });

  it("escalates to SIGKILL when the process group survives SIGTERM", async () => {
    const alive = new Set([7001]);
    let groupAlive = true;
    spawnSyncMock.mockReturnValue({
      status: 0,
      stdout: "7000\n",
      stderr: "",
    });
    killSpy.mockImplementation(((pid: number, signal?: NodeJS.Signals | 0) => {
      if (signal === 0) {
        if (pid === -7000) {
          if (groupAlive) return true;
          throw new Error("ESRCH");
        }
        if (alive.has(pid)) return true;
        throw new Error("ESRCH");
      }
      if (pid === -7000 && signal === "SIGTERM") {
        alive.delete(7001);
        return true;
      }
      if (pid === -7000 && signal === "SIGKILL") {
        groupAlive = false;
        return true;
      }
      throw new Error(`unexpected kill target: ${pid}`);
    }) as typeof process.kill);

    await expect(terminateProcess(7001, "linux")).resolves.toBe(true);
    expect(killSpy).toHaveBeenCalledWith(-7000, "SIGTERM");
    expect(killSpy).toHaveBeenCalledWith(-7000, "SIGKILL");
  });

  it("falls back to killing the pid when pgid lookup fails", async () => {
    const alive = new Set([5000]);
    spawnSyncMock.mockReturnValue({
      status: 1,
      stdout: "",
      stderr: "ps failed",
    });
    killSpy.mockImplementation(((pid: number, signal?: NodeJS.Signals | 0) => {
      if (signal === 0) {
        if (alive.has(pid)) return true;
        throw new Error("ESRCH");
      }
      if (pid === 5000) {
        alive.delete(5000);
        return true;
      }
      throw new Error(`unexpected kill target: ${pid}`);
    }) as typeof process.kill);

    await expect(terminateProcess(5000, "linux")).resolves.toBe(true);
    expect(killSpy).toHaveBeenCalledWith(5000, "SIGTERM");
  });
});
