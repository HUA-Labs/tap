import * as path from "node:path";
import {
  findRepoRoot,
  log,
  logHeader,
  parseArgs,
  resolveCommsDir as resolveCommsDirFromArgs,
} from "../utils.js";
import { resolveConfig } from "../config/index.js";
import type { CommandResult } from "../types.js";
import {
  runHeadlessResponseLoop,
  type HeadlessResponseLoopResult,
} from "../receiver/headless-response-loop.js";

const HEADLESS_HELP = `
Usage:
  tap headless <dry-run|once> --agent <name> [options]

Modes:
  dry-run  Select one pending local inbox item and show the bounded prompt. Does not run a model or write cursor state.
  once     Run one pending item through an explicit bounded headless runner.

Options:
  --agent <name>              Active agent display/routing name, e.g. agent-a.
  --alias <name[,name...]>    Additional routing aliases. Repeatable/comma-separated.
  --since <iso>               Only consider inbox files at/after this timestamp.
  --since-minutes <n>         Only consider inbox files modified in the last n minutes.
  --all                       Include historical files. Use deliberately.
  --state-name <name>         Cursor profile name. Default: codex-cli-<agent>.
  --reset-cursor              Ignore existing receiver cursor and start fresh.
  --include-own               Include messages sent by the active agent/aliases.
  --cwd <path>                Headless runner cwd. Default: current working directory.
  --timeout-ms <n>            Bound runner execution. Default: 120000.
  --runner-command <cmd>      Explicit command for once-mode. Prompt is passed on stdin.
  --allow-no-reply            Allow TAP_HEADLESS_NO_REPLY stdout marker to mark processed.
  --comms-dir <path>          Override local comms directory.
  --state-dir <path>          Override tap state/cursor directory.
  --help                      Show help.

Contract:
  This is a bounded CLI/headless response loop. It reuses receiver inbox
  selection, requires a valid return route, and marks cursor state only after
  durable reply evidence or an explicit allowed no-reply marker.
`.trim();

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

function uniqueList(values: string[]): string[] {
  return Array.from(new Set(values));
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

export async function headlessCommand(
  args: string[],
): Promise<
  CommandResult<HeadlessResponseLoopResult | Record<string, unknown>>
> {
  const first = args[0];
  if (!first || first === "--help" || first === "-h") {
    log(HEADLESS_HELP);
    return {
      ok: true,
      command: "headless",
      code: "TAP_NO_OP",
      message: HEADLESS_HELP,
      warnings: [],
      data: {},
    };
  }
  if (first !== "dry-run" && first !== "once") {
    return {
      ok: false,
      command: "headless",
      code: "TAP_INVALID_ARGUMENT",
      message: `Unknown headless mode: ${first}. Use dry-run or once.`,
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
      command: "headless",
      code: "TAP_INVALID_ARGUMENT",
      message:
        "Missing headless agent. Pass --agent <name> or set TAP_AGENT_NAME.",
      warnings: [],
      data: {},
    };
  }
  const explicitStateDir = flags["state-dir"];
  if (
    explicitStateDir !== undefined &&
    (typeof explicitStateDir !== "string" || !explicitStateDir.trim())
  ) {
    return {
      ok: false,
      command: "headless",
      code: "TAP_INVALID_ARGUMENT",
      message: "Invalid --state-dir: expected a non-empty path.",
      warnings: [],
      data: {},
    };
  }

  const repoRoot = findRepoRoot();
  const commsDir = resolveCommsDirFromArgs(args, repoRoot);
  const { config } = resolveConfig(
    {
      stateDir: explicitStateDir?.trim(),
    },
    repoRoot,
  );
  const stateDir = path.resolve(config.stateDir);
  const aliases = uniqueList([
    ...collectRepeatedListFlag(args.slice(1), "alias"),
    ...collectRepeatedListFlag(args.slice(1), "aliases"),
    ...parseListFlag(flags.alias),
    ...parseListFlag(flags.aliases),
  ]);

  let sinceMinutes: number | undefined;
  let timeoutMs: number | undefined;
  try {
    sinceMinutes = parseNumberFlag(
      flags["since-minutes"],
      "--since-minutes",
      1,
      525_600,
    );
    timeoutMs = parseNumberFlag(
      flags["timeout-ms"],
      "--timeout-ms",
      100,
      86_400_000,
    );
  } catch (error) {
    if (error instanceof RangeError) {
      return {
        ok: false,
        command: "headless",
        code: "TAP_INVALID_ARGUMENT",
        message: error.message,
        warnings: [],
        data: {},
      };
    }
    throw error;
  }

  const result = await runHeadlessResponseLoop({
    mode: first,
    commsDir,
    stateDir,
    agent,
    aliases,
    includeOwn: flags["include-own"] === true,
    since: typeof flags.since === "string" ? flags.since : undefined,
    sinceMinutes,
    all: flags.all === true,
    resetCursor: flags["reset-cursor"] === true,
    stateName:
      typeof flags["state-name"] === "string" ? flags["state-name"] : undefined,
    cwd: typeof flags.cwd === "string" ? flags.cwd : undefined,
    timeoutMs,
    runnerCommand:
      typeof flags["runner-command"] === "string"
        ? flags["runner-command"]
        : null,
    allowNoReply: flags["allow-no-reply"] === true,
  });

  logHeader("tap headless");
  log(`adapter=${result.adapter}; receiveTransport=${result.receiveTransport}`);
  log(`agent=${result.agent}; aliases=${result.aliases.join(", ")}`);
  log(`runtimeSurface=${result.runtimeSurface}; mode=${result.mode}`);
  log(`status=${result.status}`);
  if (result.item) {
    log(`item=${result.item.path}; subject=${result.item.subject}`);
  }
  if (result.replyTarget) log(`replyTarget=${result.replyTarget}`);
  if (result.blockedReason) log(`blockedReason=${result.blockedReason}`);
  if (result.replyEvidence) log(`replyEvidence=${result.replyEvidence.path}`);
  if (result.statePath) log(`statePath=${result.statePath}`);

  return {
    ok: true,
    command: "headless",
    code: "TAP_RECEIVER_OK",
    message:
      result.status === "idle"
        ? "Headless runner found no pending local inbox items."
        : result.status === "blocked"
          ? `Headless runner blocked: ${result.blockedReason}`
          : result.status === "dry-run"
            ? `Headless runner selected ${result.item?.path} for dry-run.`
            : `Headless runner completed ${result.item?.path}.`,
    warnings: result.warnings,
    data: result,
  };
}
