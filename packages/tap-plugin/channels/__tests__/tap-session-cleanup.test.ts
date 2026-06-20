import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type ChildProcessByStdio,
  execFileSync,
  spawn,
  spawnSync,
} from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { Readable } from "node:stream";
import { fileURLToPath } from "node:url";

const TESTS_DIR = dirname(fileURLToPath(import.meta.url));
const TEST_DIR = join(TESTS_DIR, ".cleanup-script-tmp");
const SCRIPT_SOURCE = resolve(
  TESTS_DIR,
  "../../../../scripts/tap-session-cleanup.sh",
);
type LiveSleepParent = ChildProcessByStdio<null, Readable, Readable>;
type LiveSleepProcess = {
  parent: LiveSleepParent;
  runtimePid: number;
};

function locateBashOnPath(): string | null {
  try {
    const locator =
      process.platform === "win32"
        ? { command: "where.exe", args: ["bash"] }
        : { command: "which", args: ["bash"] };
    const output = execFileSync(locator.command, locator.args, {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const candidates = output
      .split(/\r?\n/)
      .map((candidate) => candidate.trim())
      .filter(Boolean);
    if (process.platform !== "win32") {
      return candidates[0] ?? null;
    }

    const preferredWindowsCandidates = candidates.filter((candidate) => {
      const normalized = candidate.toLowerCase().replace(/\\/g, "/");
      return normalized !== "c:/windows/system32/bash.exe";
    });
    return preferredWindowsCandidates[0] ?? null;
  } catch {
    return null;
  }
}

function resolveBashExecutable(): string {
  const envOverride = process.env.TAP_TEST_BASH_PATH?.trim();
  if (envOverride) {
    if (!existsSync(envOverride)) {
      throw new Error(`TAP_TEST_BASH_PATH does not exist: ${envOverride}`);
    }
    return envOverride;
  }

  if (process.platform === "win32") {
    const windowsCandidates = [
      "C:/Program Files/Git/bin/bash.exe",
      "C:/Program Files/Git/usr/bin/bash.exe",
    ];
    const directMatch = windowsCandidates.find((candidate) =>
      existsSync(candidate),
    );
    if (directMatch) {
      return directMatch;
    }
  }

  const pathMatch = locateBashOnPath();
  if (pathMatch) {
    return pathMatch;
  }

  throw new Error(
    `bash executable not found for tap-session-cleanup test (platform=${process.platform})`,
  );
}

function hasBashExecutable(): boolean {
  try {
    resolveBashExecutable();
    return true;
  } catch {
    return false;
  }
}

function resetTestDir() {
  rmSync(TEST_DIR, { recursive: true, force: true });
  mkdirSync(TEST_DIR, { recursive: true });
}

function setupRepoFixture() {
  const repoDir = join(TEST_DIR, "repo");
  const scriptsDir = join(repoDir, "scripts");
  const stateDir = join(repoDir, ".tap-comms");
  const runtimeDir = join(stateDir, "routing-runtimes");
  const commsDir = join(TEST_DIR, "comms");
  mkdirSync(scriptsDir, { recursive: true });
  mkdirSync(runtimeDir, { recursive: true });
  mkdirSync(commsDir, { recursive: true });
  copyFileSync(SCRIPT_SOURCE, join(scriptsDir, "tap-session-cleanup.sh"));
  writeFileSync(join(commsDir, "heartbeats.json"), "{}\n", "utf-8");
  return { repoDir, runtimeDir, commsDir };
}

function writeRuntimeSnapshot(
  runtimeDir: string,
  pid: number,
  updatedAt: string,
  agentId = "codex_worker",
  agentName = "온",
) {
  writeFileSync(
    join(runtimeDir, `${agentId}.json`),
    JSON.stringify(
      {
        version: 1,
        pid,
        runtimeKey: `runtime:${agentId}`,
        agentId,
        agentName,
        idLocked: true,
        nameConfirmed: true,
        routingAddress: agentId,
        routingSlot: null,
        aliases: [agentId, agentName],
        stateDir: runtimeDir,
        runtimeStateDir: join(runtimeDir, "..", `${agentId}-runtime`),
        repoRoot: dirname(dirname(runtimeDir)),
        updatedAt,
      },
      null,
      2,
    ),
    "utf-8",
  );
}

function writeHeartbeats(
  commsDir: string,
  heartbeat: Record<string, unknown>,
  agentId = "codex_worker",
) {
  writeFileSync(
    join(commsDir, "heartbeats.json"),
    JSON.stringify(
      {
        [agentId]: heartbeat,
      },
      null,
      2,
    ),
    "utf-8",
  );
}

function runCleanupScript(
  repoDir: string,
  commsDir: string,
  ...args: string[]
) {
  const bash = resolveBashExecutable();
  const result = spawnSync(
    bash,
    [join(repoDir, "scripts", "tap-session-cleanup.sh"), ...args],
    {
      cwd: repoDir,
      encoding: "utf-8",
      env: {
        ...process.env,
        TAP_COMMS_DIR: commsDir,
      },
    },
  );
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";

  if (result.status === 0) {
    return stdout;
  }

  if (result.error) {
    throw new Error(
      [
        `tap-session-cleanup failed with status ${result.status ?? "unknown"}`,
        `stdout:\n${stdout}`,
        `stderr:\n${stderr}`,
      ].join("\n\n"),
      { cause: result.error },
    );
  }

  throw new Error(
    [
      `tap-session-cleanup failed with status ${result.status ?? "unknown"}`,
      `stdout:\n${stdout}`,
      `stderr:\n${stderr}`,
    ].join("\n\n"),
  );
}

async function startLiveSleepProcess(): Promise<LiveSleepProcess> {
  const parent = spawn(
    resolveBashExecutable(),
    ["-lc", "sleep 120 & echo $!; wait $!"],
    {
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  return await new Promise((resolve, reject) => {
    let settled = false;
    let stdout = "";
    let stderr = "";

    const finish = (
      handler: (value: { parent: LiveSleepParent; runtimePid: number }) => void,
      runtimePid?: number,
      error?: Error,
    ) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      if (error) {
        reject(error);
        return;
      }
      if (runtimePid == null) {
        reject(new Error("live sleep process started without runtime pid"));
        return;
      }
      handler({ parent, runtimePid });
    };

    const timeout = setTimeout(() => {
      finish(
        resolve,
        undefined,
        new Error(
          `timed out waiting for live sleep pid (stdout=${JSON.stringify(stdout)}, stderr=${JSON.stringify(stderr)})`,
        ),
      );
    }, 2_000);

    parent.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
      const match = stdout.match(/^(\d+)\r?\n/);
      if (!match) {
        return;
      }
      finish(resolve, Number(match[1]));
    });

    parent.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    parent.once("error", (error) => {
      finish(
        resolve,
        undefined,
        new Error(`failed to start live sleep process: ${error.message}`),
      );
    });

    parent.once("exit", (code, signal) => {
      finish(
        resolve,
        undefined,
        new Error(
          `live sleep process exited before publishing pid (code=${code}, signal=${signal}, stdout=${JSON.stringify(stdout)}, stderr=${JSON.stringify(stderr)})`,
        ),
      );
    });
  });
}

function stopLiveSleepProcess(liveProcess: LiveSleepProcess | null) {
  if (!liveProcess) {
    return;
  }

  try {
    execFileSync(
      resolveBashExecutable(),
      ["-lc", `kill -9 ${liveProcess.runtimePid} >/dev/null 2>&1 || true`],
      {
        encoding: "utf-8",
      },
    );
  } catch {
    // best-effort
  }

  try {
    liveProcess.parent.kill("SIGKILL");
  } catch {
    // best-effort
  }
}

describe.skipIf(!hasBashExecutable())(
  "tap-session-cleanup runtime PID semantics",
  () => {
    let liveProcess: LiveSleepProcess | null = null;

    beforeEach(() => {
      resetTestDir();
    });

    afterEach(() => {
      stopLiveSleepProcess(liveProcess);
      liveProcess = null;
      resetTestDir();
    });

    it("does not kill a live PID from snapshot age alone in dry-run mode", async () => {
      const { repoDir, runtimeDir, commsDir } = setupRepoFixture();
      liveProcess = await startLiveSleepProcess();

      writeRuntimeSnapshot(
        runtimeDir,
        liveProcess.runtimePid,
        "2026-04-19T00:00:00.000Z",
      );

      const output = runCleanupScript(
        repoDir,
        commsDir,
        "--dry-run",
        "--kill-inactive-runtime-pids",
      );

      expect(output).not.toContain("killing inactive runtime pid");
      expect(output).toContain("live runtime:");
    });

    it("kills a live PID only when heartbeat inactivity is also confirmed", async () => {
      const { repoDir, runtimeDir, commsDir } = setupRepoFixture();
      liveProcess = await startLiveSleepProcess();

      writeRuntimeSnapshot(
        runtimeDir,
        liveProcess.runtimePid,
        "2026-04-19T00:00:00.000Z",
      );
      writeHeartbeats(commsDir, {
        id: "codex_worker",
        agent: "온",
        timestamp: "2026-04-19T00:00:00.000Z",
        lastActivity: "2026-04-19T00:00:00.000Z",
        status: "active",
      });

      const output = runCleanupScript(
        repoDir,
        commsDir,
        "--dry-run",
        "--kill-inactive-runtime-pids",
      );

      expect(output).toContain("killing inactive runtime pid");
      expect(output).toContain("heartbeat idle");
    });
  },
);
