import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import { findRepoRoot, log, logHeader, parseArgs } from "../utils.js";
import { resolveConfig } from "../config/index.js";
import type { CommandResult } from "../types.js";
import {
  runLocalUplink,
  type RunLocalUplinkResult,
  type UplinkDir,
  type UplinkMode,
} from "../uplink/local-append-only-uplink.js";
import {
  mirrorRemoteUplinkSource,
  type RemoteUplinkMirrorRecord,
} from "../uplink/remote-uplink-source.js";

const UPLINK_HELP = `
Usage:
  tap uplink <check|apply|watch> --source-comms-dir <path> --target-comms-dir <path> --agent <name> [options]

Modes:
  check   Dry-run local-to-central uplink. Does not copy files or write cursor state.
  apply   Upload eligible append-only records once and write cursor state.
  watch   Poll local source until eligible records appear or --max-iterations is reached.

Options:
  --source-comms-dir <path>   Device-local comms dir, e.g. ./tap-comms.
  --source-ssh <host>         Treat --source-comms-dir as a remote path on this SSH host.
  --target-comms-dir <path>   Canonical/central comms dir, e.g. /path/to/central-comms.
  --agent <name>              Local sender display/routing name, e.g. agent-a.
  --alias <name[,name...]>    Additional local sender aliases. Repeatable/comma-separated.
  --dir <name[,name...]>      Append-only dirs to uplink. Default: inbox.
                              Allowed: inbox,reviews,findings,receipts,decisions.
  --since <iso>               Only consider source files at/after this timestamp.
  --since-minutes <n>         Only consider source files modified in the last n minutes.
  --all                       Include historical files. Use deliberately.
  --limit <n>                 Max records to surface/copy, 1-500. Default: 100.
  --state-name <name>         Cursor profile name. Default: local-uplink-<agent>.
  --reset-cursor              Ignore existing uplink cursor and start fresh.
  --include-all-sources       Upload inbox/reviews even when from: is not this agent.
  --mirror-dir <path>         Local temp mirror for --source-ssh. Default: OS temp dir.
  --keep-mirror               Keep the remote source mirror after command exit.
  --interval-ms <n>           Watch polling interval. Default: 2000.
  --max-iterations <n>        Bound watch loops for smoke/tests.
  --help                      Show help.

Contract:
  Uplink is append-only and polling/file-backed. It copies eligible device-local
  records to the canonical central comms bus. It never syncs heartbeats,
  presence, owner tuples, locks, claims, or live IPC state.

  With --source-ssh, uplink first mirrors allowed append-only source dirs with
  rsync into a local temp dir, then runs the same cursor/dedupe/collision logic.
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

function resolveMode(value: string | undefined): UplinkMode | null {
  if (value === "check" || value === "apply" || value === "watch") {
    return value;
  }
  return null;
}

function parseUplinkDirs(values: string[]): UplinkDir[] {
  return values as UplinkDir[];
}

function mirrorDirsForRequest(dirs: UplinkDir[]): UplinkDir[] {
  const requested = dirs.length ? dirs : (["inbox"] as UplinkDir[]);
  const result: UplinkDir[] = [];
  for (const dir of requested) {
    if (!APPEND_ONLY_DIRS.has(dir)) continue;
    if (!result.includes(dir)) result.push(dir);
  }
  return result;
}

export async function uplinkCommand(args: string[]): Promise<CommandResult> {
  const first = args[0];
  if (!first || first === "--help" || first === "-h") {
    log(UPLINK_HELP);
    return {
      ok: true,
      command: "uplink",
      code: "TAP_NO_OP",
      message: UPLINK_HELP,
      warnings: [],
      data: {},
    };
  }

  const mode = resolveMode(first);
  if (!mode) {
    return {
      ok: false,
      command: "uplink",
      code: "TAP_INVALID_ARGUMENT",
      message: `Unknown uplink mode: ${first}. Use check, apply, or watch.`,
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
      command: "uplink",
      code: "TAP_INVALID_ARGUMENT",
      message:
        "Missing uplink agent. Pass --agent <name> or set TAP_AGENT_NAME.",
      warnings: [],
      data: {},
    };
  }

  const sourceCommsDir =
    typeof flags["source-comms-dir"] === "string"
      ? flags["source-comms-dir"]
      : "";
  const sourceSsh =
    typeof flags["source-ssh"] === "string" ? flags["source-ssh"].trim() : "";
  const targetCommsDir =
    typeof flags["target-comms-dir"] === "string"
      ? path.resolve(flags["target-comms-dir"])
      : "";
  if (!sourceCommsDir || !targetCommsDir) {
    return {
      ok: false,
      command: "uplink",
      code: "TAP_INVALID_ARGUMENT",
      message:
        "Missing uplink paths. Pass --source-comms-dir and --target-comms-dir.",
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
  const dirs = parseUplinkDirs([
    ...collectRepeatedListFlag(args.slice(1), "dir"),
    ...collectRepeatedListFlag(args.slice(1), "dirs"),
    ...parseListFlag(flags.dir),
    ...parseListFlag(flags.dirs),
  ]);
  const mirrorDir =
    typeof flags["mirror-dir"] === "string"
      ? path.resolve(flags["mirror-dir"])
      : sourceSsh
        ? fs.mkdtempSync(path.join(os.tmpdir(), "tap-uplink-source-"))
        : null;
  const remoteMirrorRecords: RemoteUplinkMirrorRecord[] = [];
  const mirrorRemote = sourceSsh
    ? () => {
        if (!mirrorDir) {
          throw new Error("Missing remote uplink mirror dir.");
        }
        remoteMirrorRecords.splice(
          0,
          remoteMirrorRecords.length,
          ...mirrorRemoteUplinkSource({
            sshTarget: sourceSsh,
            remoteCommsDir: sourceCommsDir,
            localMirrorDir: mirrorDir,
            dirs: mirrorDirsForRequest(dirs),
          }),
        );
      }
    : undefined;

  let result: RunLocalUplinkResult;
  try {
    result = await runLocalUplink({
      mode,
      sourceCommsDir: mirrorDir ?? path.resolve(sourceCommsDir),
      sourceCommsDirLabel: sourceSsh
        ? `${sourceSsh}:${sourceCommsDir}`
        : undefined,
      targetCommsDir,
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
      includeAllSources: flags["include-all-sources"] === true,
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
      beforeScan: mirrorRemote,
    });
  } finally {
    if (sourceSsh && mirrorDir && flags["keep-mirror"] !== true) {
      fs.rmSync(mirrorDir, { recursive: true, force: true });
    }
  }

  logHeader("tap uplink");
  log(`adapter=${result.adapter}; receiveTransport=${result.receiveTransport}`);
  log(`agent=${result.agent}; aliases=${result.aliases.join(", ")}`);
  log(`sourceCommsDir=${result.sourceCommsDir}`);
  if (sourceSsh && mirrorDir) {
    log(`sourceMirrorDir=${mirrorDir}`);
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
      `- ${item.relativePath}; uploaded=${item.uploaded}; skipReason=${item.skipReason ?? "-"}`,
    );
  }

  return {
    ok: true,
    command: "uplink",
    code: "TAP_UPLINK_OK",
    message:
      result.items.length > 0
        ? result.status === "uploaded"
          ? `Uplink copied ${result.items.filter((item) => item.uploaded).length} target record(s).`
          : `Uplink found ${result.items.length} eligible local record(s).`
        : "Uplink found no eligible local records.",
    warnings: result.warnings,
    data: {
      ...result,
      remoteSource: sourceSsh
        ? {
            sshTarget: sourceSsh,
            commsDir: sourceCommsDir,
            mirrorDir,
            records: remoteMirrorRecords,
          }
        : null,
    } as unknown as Record<string, unknown>,
  };
}
