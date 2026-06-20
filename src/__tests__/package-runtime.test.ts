import { beforeAll, afterAll, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { fileURLToPath } from "node:url";

const packageDir = fileURLToPath(new URL("../../", import.meta.url));
const distCliPath = path.join(packageDir, "dist", "cli.mjs");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const describePackagedRuntime = fs.existsSync(distCliPath)
  ? describe
  : describe.skip;

let tempDir: string;
let tarballPath: string;

function runCommand(
  command: string,
  args: string[],
  cwd: string,
): SpawnSyncReturns<string> {
  if (process.platform === "win32") {
    return spawnSync(
      process.env.ComSpec ?? "cmd.exe",
      ["/d", "/c", command, ...args],
      {
        cwd,
        encoding: "utf8",
      },
    );
  }

  return spawnSync(command, args, {
    cwd,
    encoding: "utf8",
  });
}

function expectSuccess(result: SpawnSyncReturns<string>, label: string): void {
  const details = [
    label,
    `status: ${result.status}`,
    `stdout:\n${result.stdout ?? ""}`,
    `stderr:\n${result.stderr ?? ""}`,
  ].join("\n\n");

  expect(result.status, details).toBe(0);
}

function runPackagedCli(binName: string): SpawnSyncReturns<string> {
  return runCommand(
    npmCommand,
    ["exec", "--yes", "--package", tarballPath, binName, "--", "--help"],
    tempDir,
  );
}

// This acceptance check exercises the packaged CLI only when a local build
// has already produced dist/. The test itself should not trigger prepack.
describePackagedRuntime("packaged npm runtime", () => {
  beforeAll(() => {
    tempDir = path.join(
      packageDir,
      `.tmp-package-runtime-${process.pid}-${Date.now()}`,
    );
    fs.mkdirSync(tempDir, { recursive: true });

    const packResult = runCommand(
      npmCommand,
      [
        "pack",
        ".",
        "--ignore-scripts",
        "--pack-destination",
        tempDir,
        "--silent",
      ],
      packageDir,
    );
    expectSuccess(packResult, "npm pack --ignore-scripts should succeed");

    const tarballName = packResult.stdout
      .trim()
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .at(-1);

    expect(tarballName).toBeTruthy();
    tarballPath = path.join(tempDir, tarballName!);
    expect(fs.existsSync(tarballPath)).toBe(true);
  }, 120_000);

  afterAll(() => {
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("runs the packaged tap bin via npm exec", () => {
    const result = runPackagedCli("tap");
    expectSuccess(result, "npm exec tap should succeed");
    expect(result.stdout).toContain(
      "@hua-labs/tap — Cross-model AI agent communication setup",
    );
    expect(result.stdout).toContain("Usage:");
  }, 120_000);

  it("runs the packaged tap-comms alias via npm exec", () => {
    const result = runPackagedCli("tap-comms");
    expectSuccess(result, "npm exec tap-comms should succeed");
    expect(result.stdout).toContain(
      "@hua-labs/tap — Cross-model AI agent communication setup",
    );
    expect(result.stdout).toContain("Usage:");
  }, 120_000);
});
