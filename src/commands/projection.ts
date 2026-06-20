import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import { findRepoRoot, log, logHeader, parseArgs } from "../utils.js";
import { resolveConfig } from "../config/index.js";
import type { CommandResult } from "../types.js";
import {
  runLocalProjection,
  type ProjectionDir,
  type ProjectionMode,
  type RunLocalProjectionResult,
} from "../projection/local-receiver-projection.js";
import {
  mirrorRemoteProjectionTarget,
  pushRemoteProjectionTarget,
  type RemoteProjectionTransferRecord,
} from "../projection/remote-projection-target.js";

const PROJECTION_HELP = `
Usage:
  tap projection <check|apply|watch> --source-comms-dir <path> --target-comms-dir <path> --agent <name> [options]

Modes:
  check   Dry-run central-to-local projection. Does not copy files or write cursor state.
  apply   Project eligible append-only records once and write cursor state.
  watch   Poll central source until eligible records appear or --max-iterations is reached.

Options:
  --source-comms-dir <path>   Canonical/central comms dir, e.g. /home/devin/hua-comms.
  --target-comms-dir <path>   Device-local comms dir, e.g. /Users/devin/HUA/hua-comms.
  --target-ssh <host>         Treat --target-comms-dir as a remote path on this SSH host.
  --agent <name>              Local agent display/routing name, e.g. agent-a.
  --alias <name[,name...]>    Additional routing aliases. Repeatable/comma-separated.
  --dir <name[,name...]>      Append-only dirs to project. Default: inbox.
                              Allowed: inbox,reviews,findings,receipts,decisions.
  --since <iso>               Only consider source files at/after this timestamp.
  --since-minutes <n>         Only consider source files modified in the last n minutes.
  --all                       Include historical files. Use deliberately.
  --limit <n>                 Max records to surface/copy, 1-500. Default: 100.
  --state-name <name>         Cursor profile name. Default: local-projection-<agent>.
  --reset-cursor              Ignore existing projection cursor and start fresh.
  --include-own               Include messages sent by the active agent/aliases.
  --include-all-targets       Project inbox/reviews even when not addressed to this agent.
  --mirror-dir <path>         Local temp mirror for --target-ssh. Default: OS temp dir.
  --keep-mirror               Keep the remote target mirror after command exit.
  --interval-ms <n>           Watch polling interval. Default: 2000.
  --max-iterations <n>        Bound watch loops for smoke/tests.
  --help                      Show help.

Contract:
  Projection is append-only and polling/file-backed. It copies eligible central
  records into a local comms cache. It never syncs heartbeats, presence, owner
  tuples, locks, claims, or live IPC state.

  With --target-ssh, projection first mirrors the remote append-only target dirs
  into a local temp dir, runs the same projection/cursor logic, then pushes
  newly projected append-only files back to the remote target with rsync
  --ignore-existing.
`.trim();

const APPEND_ONLY_DIRS = new Set([
  "inbox",
  "reviews",
  "findings",
  "receipts",
  "decisions",
]);

function parseListFlag(value: string | boolean | undefined): string[] {
  if (typeof value !== "string") return [];
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function collectRepeatedListFlag(args: string[], flag: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (
      arg === `--${flag}` &&
      args[index + 1] &&
      !args[index + 1].startsWith("--")
    ) {
      values.push(...parseListFlag(args[index + 1]));
      index += 1;
      continue;
    }
    if (arg.startsWith(`--${flag}=`)) {
      values.push(...parseListFlag(arg.slice(flag.length + 3)));
    }
  }
  return values;
}

function parseNumberFlag(
  value: string | boolean | undefined,
  name: string,
  min: number,
  max: number,
): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new RangeError(`Invalid ${name}: expected a value.`);
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new RangeError(
      `Invalid ${name}: ${value}. Must be an integer between ${min} and ${max}.`,
    );
  }
  return parsed;
}

function resolveMode(value: string | undefined): ProjectionMode | null {
  if (value === "check" || value === "apply" || value === "watch") {
    return value;
  }
  return null;
}

function parseProjectionDirs(values: string[]): ProjectionDir[] {
  return values as ProjectionDir[];
}

function mirrorDirsForRequest(dirs: ProjectionDir[]): ProjectionDir[] {
  const requested = dirs.length ? dirs : (["inbox"] as ProjectionDir[]);
  const result: ProjectionDir[] = [];
  for (const dir of requested) {
    if (!APPEND_ONLY_DIRS.has(dir)) continue;
    if (!result.includes(dir)) result.push(dir);
  }
  return result.length ? result : (["inbox"] as ProjectionDir[]);
}

export async function projectionCommand(
  args: string[],
): Promise<CommandResult> {
  const first = args[0];
  if (!first || first === "--help" || first === "-h") {
    log(PROJECTION_HELP);
    return {
      ok: true,
      command: "projection",
      code: "TAP_NO_OP",
      message: PROJECTION_HELP,
      warnings: [],
      data: {},
    };
  }

  const mode = resolveMode(first);
  if (!mode) {
    return {
      ok: false,
      command: "projection",
      code: "TAP_INVALID_ARGUMENT",
      message: `Unknown projection mode: ${first}. Use check, apply, or watch.`,
      warnings: [],
      data: { requestedMode: first },
    };
  }

  const { flags } = parseArgs(args.slice(1));
  const agent =
    typeof flags.agent === "string"
      ? flags.agent.trim()
      : (process.env.TAP_AGENT_NAME ?? process.env.TAP_AGENT_ID ?? "").trim();
  if (!agent) {
    return {
      ok: false,
      command: "projection",
      code: "TAP_INVALID_ARGUMENT",
      message:
        "Missing projection agent. Pass --agent <name> or set TAP_AGENT_NAME.",
      warnings: [],
      data: {},
    };
  }

  const sourceCommsDir =
    typeof flags["source-comms-dir"] === "string"
      ? path.resolve(flags["source-comms-dir"])
      : "";
  const targetCommsDir =
    typeof flags["target-comms-dir"] === "string"
      ? flags["target-comms-dir"]
      : "";
  const targetSsh =
    typeof flags["target-ssh"] === "string" ? flags["target-ssh"].trim() : "";
  if (!sourceCommsDir || !targetCommsDir) {
    return {
      ok: false,
      command: "projection",
      code: "TAP_INVALID_ARGUMENT",
      message:
        "Missing projection paths. Pass --source-comms-dir and --target-comms-dir.",
      warnings: [],
      data: {},
    };
  }

  const repoRoot = findRepoRoot();
  const { config } = resolveConfig({}, repoRoot);
  const stateDir = path.resolve(config.stateDir);
  const aliases = [
    ...collectRepeatedListFlag(args.slice(1), "alias"),
    ...collectRepeatedListFlag(args.slice(1), "aliases"),
    ...parseListFlag(flags.alias),
    ...parseListFlag(flags.aliases),
  ];
  const dirs = parseProjectionDirs([
    ...collectRepeatedListFlag(args.slice(1), "dir"),
    ...collectRepeatedListFlag(args.slice(1), "dirs"),
    ...parseListFlag(flags.dir),
    ...parseListFlag(flags.dirs),
  ]);
  const mirrorDir =
    typeof flags["mirror-dir"] === "string"
      ? path.resolve(flags["mirror-dir"])
      : targetSsh
        ? fs.mkdtempSync(path.join(os.tmpdir(), "tap-projection-target-"))
        : null;
  const remoteMirrorRecords: RemoteProjectionTransferRecord[] = [];
  const remotePushRecords: RemoteProjectionTransferRecord[] = [];
  const remoteDirs = mirrorDirsForRequest(dirs);
  const mirrorRemoteTarget = targetSsh
    ? () => {
        if (!mirrorDir) {
          throw new Error("Missing remote projection mirror dir.");
        }
        remoteMirrorRecords.splice(
          0,
          remoteMirrorRecords.length,
          ...mirrorRemoteProjectionTarget({
            sshTarget: targetSsh,
            remoteCommsDir: targetCommsDir,
            localMirrorDir: mirrorDir,
            dirs: remoteDirs,
          }),
        );
      }
    : undefined;
  const pushRemoteTarget = targetSsh
    ? (
        items: Array<{
          dir: ProjectionDir;
          filename: string;
          projected: boolean;
        }>,
      ) => {
        if (!mirrorDir) {
          throw new Error("Missing remote projection mirror dir.");
        }
        const projectedFiles = items
          .filter((item) => item.projected)
          .map((item) => ({ dir: item.dir, filename: item.filename }));
        remotePushRecords.splice(
          0,
          remotePushRecords.length,
          ...pushRemoteProjectionTarget({
            sshTarget: targetSsh,
            remoteCommsDir: targetCommsDir,
            localMirrorDir: mirrorDir,
            dirs: remoteDirs,
            files: projectedFiles,
          }),
        );
      }
    : undefined;

  let result: RunLocalProjectionResult;
  try {
    result = await runLocalProjection({
      mode,
      sourceCommsDir,
      targetCommsDir: mirrorDir ?? path.resolve(targetCommsDir),
      targetCommsDirLabel: targetSsh
        ? `${targetSsh}:${targetCommsDir}`
        : undefined,
      stateDir,
      agent,
      aliases,
      dirs,
      since: typeof flags.since === "string" ? flags.since : undefined,
      sinceMinutes: parseNumberFlag(
        flags["since-minutes"],
        "--since-minutes",
        1,
        525_600,
      ),
      all: flags.all === true,
      resetCursor: flags["reset-cursor"] === true,
      stateName:
        typeof flags["state-name"] === "string"
          ? flags["state-name"]
          : undefined,
      includeOwn: flags["include-own"] === true,
      includeAllTargets: flags["include-all-targets"] === true,
      limit: parseNumberFlag(flags.limit, "--limit", 1, 500),
      intervalMs: parseNumberFlag(
        flags["interval-ms"],
        "--interval-ms",
        100,
        60_000,
      ),
      maxIterations: parseNumberFlag(
        flags["max-iterations"],
        "--max-iterations",
        1,
        100_000,
      ),
      beforeScan: mirrorRemoteTarget,
      afterApply: pushRemoteTarget,
    });
  } finally {
    if (targetSsh && mirrorDir && flags["keep-mirror"] !== true) {
      fs.rmSync(mirrorDir, { recursive: true, force: true });
    }
  }

  logHeader("tap projection");
  log(`adapter=${result.adapter}; receiveTransport=${result.receiveTransport}`);
  log(`agent=${result.agent}; aliases=${result.aliases.join(", ")}`);
  log(`sourceCommsDir=${result.sourceCommsDir}`);
  if (targetSsh && mirrorDir) {
    log(`targetMirrorDir=${mirrorDir}`);
  }
  log(`targetCommsDir=${result.targetCommsDir}`);
  log(`dirs=${result.dirs.join(",")}`);
  log(`statePath=${result.statePath}`);
  if (result.effectiveSince) {
    log(`effectiveSince=${result.effectiveSince}`);
  }
  log(
    `scanned=${result.scanned}; items=${result.items.length}; status=${result.status}`,
  );
  for (const item of result.items) {
    log(
      `- ${item.relativePath}; projected=${item.projected}; skipReason=${item.skipReason ?? "-"}`,
    );
  }

  return {
    ok: true,
    command: "projection",
    code: "TAP_PROJECTION_OK",
    message:
      result.items.length > 0
        ? result.status === "projected"
          ? `Projection copied ${result.items.filter((item) => item.projected).length} local record(s).`
          : `Projection found ${result.items.length} eligible central record(s).`
        : "Projection found no eligible central records.",
    warnings: result.warnings,
    data: {
      ...result,
      remoteTarget: targetSsh
        ? {
            sshTarget: targetSsh,
            commsDir: targetCommsDir,
            mirrorDir,
            mirrorRecords: remoteMirrorRecords,
            pushRecords: remotePushRecords,
          }
        : null,
    } as unknown as Record<string, unknown>,
  };
}
