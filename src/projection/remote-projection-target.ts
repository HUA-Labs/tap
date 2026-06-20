import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ProjectionDir } from "./local-receiver-projection.js";

export interface RemoteProjectionCommandResult {
  status: number;
  stdout: string;
  stderr: string;
}

export type RemoteProjectionCommandRunner = (
  command: string,
  args: string[],
) => RemoteProjectionCommandResult;

export interface RemoteProjectionTransferRecord {
  dir: ProjectionDir;
  source: string;
  target: string;
  status: number;
  changed: number;
  stdout: string;
  stderr: string;
}

export interface RemoteProjectionTargetOptions {
  sshTarget: string;
  remoteCommsDir: string;
  localMirrorDir: string;
  dirs: ProjectionDir[];
  files?: Array<{ dir: ProjectionDir; filename: string }>;
  runner?: RemoteProjectionCommandRunner;
}

function defaultRunner(
  command: string,
  args: string[],
): RemoteProjectionCommandResult {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: "pipe",
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function assertSafeSshTarget(value: string): void {
  if (!value.trim() || /[\r\n]/.test(value) || value.startsWith("-")) {
    throw new RangeError(`Invalid --target-ssh target: ${value}`);
  }
}

function assertSafeRemotePath(value: string): void {
  if (!value.trim() || /[\r\n]/.test(value)) {
    throw new RangeError(`Invalid remote comms path: ${value}`);
  }
}

function remoteDirPath(remoteCommsDir: string, dir: ProjectionDir): string {
  return `${remoteCommsDir.replace(/[\\/]+$/, "")}/${dir}/`;
}

function remoteRsyncSource(
  sshTarget: string,
  remoteCommsDir: string,
  dir: ProjectionDir,
): string {
  return `${sshTarget}:${remoteDirPath(remoteCommsDir, dir)}`;
}

function remoteRsyncTarget(
  sshTarget: string,
  remoteCommsDir: string,
  dir: ProjectionDir,
): string {
  return `${sshTarget}:${remoteDirPath(remoteCommsDir, dir)}`;
}

function parseChangedCount(stdout: string): number {
  return stdout
    .split(/\r?\n/)
    .filter(
      (line) =>
        line.startsWith(">f") || line.startsWith("<f") || line.startsWith("cd"),
    ).length;
}

function summarizeOutput(value: string, maxLines = 20): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const lines = trimmed.split(/\r?\n/);
  if (lines.length <= maxLines) return trimmed;
  return [
    ...lines.slice(0, maxLines),
    `... truncated ${lines.length - maxLines} line(s) ...`,
  ].join("\n");
}

function assertSafeDir(dir: ProjectionDir): void {
  if (!/^[A-Za-z0-9._-]+$/.test(dir)) {
    throw new RangeError(`Unsafe projection dir: ${dir}`);
  }
}

export function mirrorRemoteProjectionTarget(
  options: RemoteProjectionTargetOptions,
): RemoteProjectionTransferRecord[] {
  assertSafeSshTarget(options.sshTarget);
  assertSafeRemotePath(options.remoteCommsDir);

  const runner = options.runner ?? defaultRunner;
  const records: RemoteProjectionTransferRecord[] = [];

  for (const dir of options.dirs) {
    assertSafeDir(dir);
    const targetDir = path.join(options.localMirrorDir, dir);
    fs.mkdirSync(targetDir, { recursive: true });
    const source = remoteRsyncSource(
      options.sshTarget,
      options.remoteCommsDir,
      dir,
    );
    const target = `${targetDir.replace(/[\\/]+$/, "")}/`;
    const result = runner("rsync", [
      "-a",
      "--ignore-existing",
      "--itemize-changes",
      "--include=*.md",
      "--include=*.json",
      "--exclude=*",
      source,
      target,
    ]);
    const record: RemoteProjectionTransferRecord = {
      dir,
      source,
      target,
      status: result.status,
      changed: parseChangedCount(result.stdout),
      stdout: summarizeOutput(result.stdout),
      stderr: summarizeOutput(result.stderr),
    };
    records.push(record);
    if (result.status !== 0) {
      throw new Error(
        `Failed to mirror remote projection target ${source}: ${record.stderr}`,
      );
    }
  }

  return records;
}

export function pushRemoteProjectionTarget(
  options: RemoteProjectionTargetOptions,
): RemoteProjectionTransferRecord[] {
  assertSafeSshTarget(options.sshTarget);
  assertSafeRemotePath(options.remoteCommsDir);

  const runner = options.runner ?? defaultRunner;
  const records: RemoteProjectionTransferRecord[] = [];
  const filesByDir = new Map<ProjectionDir, string[]>();
  for (const file of options.files ?? []) {
    assertSafeDir(file.dir);
    if (!/^[^/\\]+$/.test(file.filename)) {
      throw new RangeError(`Unsafe projection filename: ${file.filename}`);
    }
    const files = filesByDir.get(file.dir) ?? [];
    if (!files.includes(file.filename)) files.push(file.filename);
    filesByDir.set(file.dir, files);
  }
  const dirs = options.files ? [...filesByDir.keys()] : options.dirs;
  const stagingRoot = options.files
    ? fs.mkdtempSync(path.join(os.tmpdir(), "tap-projection-push-"))
    : null;

  try {
    for (const dir of dirs) {
      assertSafeDir(dir);
      const sourceDir = path.join(options.localMirrorDir, dir);
      fs.mkdirSync(sourceDir, { recursive: true });
      let rsyncSourceDir = sourceDir;

      if (stagingRoot) {
        const stagedDir = path.join(stagingRoot, dir);
        fs.mkdirSync(stagedDir, { recursive: true });
        for (const filename of filesByDir.get(dir) ?? []) {
          const sourceFile = path.join(sourceDir, filename);
          const stagedFile = path.join(stagedDir, filename);
          fs.copyFileSync(sourceFile, stagedFile);
          const stat = fs.statSync(sourceFile);
          fs.utimesSync(stagedFile, stat.atime, stat.mtime);
        }
        rsyncSourceDir = stagedDir;
      }

      const source = `${rsyncSourceDir.replace(/[\\/]+$/, "")}/`;
      const target = remoteRsyncTarget(
        options.sshTarget,
        options.remoteCommsDir,
        dir,
      );
      const result = runner("rsync", [
        "-a",
        "--ignore-existing",
        "--itemize-changes",
        "--include=*.md",
        "--include=*.json",
        "--exclude=*",
        source,
        target,
      ]);
      const record: RemoteProjectionTransferRecord = {
        dir,
        source,
        target,
        status: result.status,
        changed: parseChangedCount(result.stdout),
        stdout: summarizeOutput(result.stdout),
        stderr: summarizeOutput(result.stderr),
      };
      records.push(record);
      if (result.status !== 0) {
        throw new Error(
          `Failed to push remote projection target ${target}: ${record.stderr}`,
        );
      }
    }
  } finally {
    if (stagingRoot) {
      fs.rmSync(stagingRoot, { recursive: true, force: true });
    }
  }

  return records;
}
