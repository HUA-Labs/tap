import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import type { UplinkDir } from "./local-append-only-uplink.js";

export interface RemoteUplinkCommandResult {
  status: number;
  stdout: string;
  stderr: string;
}

export type RemoteUplinkCommandRunner = (
  command: string,
  args: string[],
) => RemoteUplinkCommandResult;

export interface RemoteUplinkMirrorRecord {
  dir: UplinkDir;
  source: string;
  target: string;
  status: number;
  changed: number;
  stdout: string;
  stderr: string;
}

export interface MirrorRemoteUplinkSourceOptions {
  sshTarget: string;
  remoteCommsDir: string;
  localMirrorDir: string;
  dirs: UplinkDir[];
  runner?: RemoteUplinkCommandRunner;
}

function defaultRunner(
  command: string,
  args: string[],
): RemoteUplinkCommandResult {
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
    throw new RangeError(`Invalid --source-ssh target: ${value}`);
  }
}

function assertSafeRemotePath(value: string): void {
  if (!value.trim() || /[\r\n]/.test(value)) {
    throw new RangeError(`Invalid remote comms path: ${value}`);
  }
}

function remoteDirPath(remoteCommsDir: string, dir: UplinkDir): string {
  return `${remoteCommsDir.replace(/[\\/]+$/, "")}/${dir}/`;
}

function remoteRsyncSource(
  sshTarget: string,
  remoteCommsDir: string,
  dir: UplinkDir,
): string {
  return `${sshTarget}:${remoteDirPath(remoteCommsDir, dir)}`;
}

function parseChangedCount(stdout: string): number {
  return stdout
    .split(/\r?\n/)
    .filter((line) => line.startsWith(">f") || line.startsWith("cd")).length;
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

export function mirrorRemoteUplinkSource(
  options: MirrorRemoteUplinkSourceOptions,
): RemoteUplinkMirrorRecord[] {
  assertSafeSshTarget(options.sshTarget);
  assertSafeRemotePath(options.remoteCommsDir);

  const runner = options.runner ?? defaultRunner;
  const records: RemoteUplinkMirrorRecord[] = [];

  for (const dir of options.dirs) {
    if (!/^[A-Za-z0-9._-]+$/.test(dir)) {
      throw new RangeError(`Unsafe uplink dir: ${dir}`);
    }
    const targetDir = path.join(options.localMirrorDir, dir);
    fs.mkdirSync(targetDir, { recursive: true });
    const source = remoteRsyncSource(
      options.sshTarget,
      options.remoteCommsDir,
      dir,
    );
    const target = `${targetDir.replace(/[\\/]+$/, "")}/`;
    const args = [
      "-a",
      "--ignore-existing",
      "--itemize-changes",
      "--include=*.md",
      "--include=*.json",
      "--exclude=*",
      source,
      target,
    ];
    const result = runner("rsync", args);
    const record: RemoteUplinkMirrorRecord = {
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
        `Failed to mirror remote uplink source ${source}: ${record.stderr}`,
      );
    }
  }

  return records;
}
