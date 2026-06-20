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
import { runCodexCliAppServerPromotion } from "../receiver/codex-cli-app-server-promotion.js";
import {
  runPollingReceiver,
  type PollingReceiverMode,
} from "../receiver/codex-cli-polling-receiver.js";
import { runSupervisedReceiverPromotion } from "../receiver/supervised-receiver-promotion.js";

const RECEIVER_HELP = `
Usage:
  tap receiver <check|apply|watch|promote|supervise> --agent <name> [options]

Modes:
  check   Dry-run local inbox detection. Does not write receiver cursor state.
  apply   Detect pending local inbox items once and mark them in receiver cursor state.
  watch   Poll local inbox until a pending item appears or --max-iterations is reached.
  promote Promote one pending inbox item into a Codex app-server turn/start when idle.
  supervise
          Run a supervised receiver loop that promotes when idle and blocks on active turns.
          Active-turn items remain queued as pending receiver evidence; receiver does not
          default to turn/steer.

Options:
  --agent <name>              Active agent display/routing name, e.g. agent-a.
  --alias <name[,name...]>    Additional routing aliases. Repeatable/comma-separated.
  --since <iso>               Only consider inbox files at/after this timestamp.
  --since-minutes <n>         Only consider inbox files modified in the last n minutes.
  --all                       Include historical files. Use deliberately.
  --limit <n>                 Max items to surface, 1-100. Default: 20.
  --state-name <name>         Cursor profile name. Default: codex-cli-<agent>.
  --reset-cursor              Ignore existing receiver cursor and start fresh.
  --include-own               Include messages sent by the active agent/aliases.
  --no-content                Omit message bodies from result data.
  --interval-ms <n>           Watch polling interval. Default: 2000.
  --max-iterations <n>        Bound watch loops for smoke/tests.
  --endpoint-profile <id>     App-server endpoint profile. Default: public-auth-gateway.
  --app-server-url <ws-url>   Explicit app-server URL override for smoke/debug.
  --thread-id <id>            Explicit app-server thread id. Otherwise loaded cwd thread is used.
  --cwd <path>                Target loaded-thread cwd. Default: current working directory.
  --dry-run                   Build promotion prompt/result but do not connect or start a turn.
  --debug-envelope            Include inbox filename, dedupe key, and route metadata in prompt output.
  --once                      Supervise once. Default for supervise mode.
  --watch                     Supervise repeatedly. Active-turn blocks are retried until delivered or max iterations is reached.
  --max-promotions-per-iteration <n>
                              Bound delivered promotions per supervisor iteration. Default: 1.
  --comms-dir <path>          Override local comms directory.
  --help                      Show help.

Contract:
  This is polling/file-polling promotion for Codex CLI. It preserves inbox files,
  keeps check/apply/watch operator-mediated, and keeps app-server promotion
  distinct from mcp-channel or consent-drive.
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

function resolveMode(value: string | undefined): PollingReceiverMode | null {
  if (value === "check" || value === "apply" || value === "watch") {
    return value;
  }
  return null;
}

export async function receiverCommand(args: string[]): Promise<CommandResult> {
  const first = args[0];
  if (!first || first === "--help" || first === "-h") {
    log(RECEIVER_HELP);
    return {
      ok: true,
      command: "receiver",
      code: "TAP_NO_OP",
      message: RECEIVER_HELP,
      warnings: [],
      data: {},
    };
  }

  const mode = resolveMode(first);
  const wantsPromote = first === "promote";
  const wantsSupervise = first === "supervise";
  if (!mode && !wantsPromote && !wantsSupervise) {
    return {
      ok: false,
      command: "receiver",
      code: "TAP_INVALID_ARGUMENT",
      message: `Unknown receiver mode: ${first}. Use check, apply, watch, promote, or supervise.`,
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
      command: "receiver",
      code: "TAP_INVALID_ARGUMENT",
      message:
        "Missing receiver agent. Pass --agent <name> or set TAP_AGENT_NAME.",
      warnings: [],
      data: {},
    };
  }

  const repoRoot = findRepoRoot();
  const commsDir = resolveCommsDirFromArgs(args, repoRoot);
  const { config } = resolveConfig({}, repoRoot);
  const stateDir = path.resolve(config.stateDir);

  const aliases = uniqueList([
    ...collectRepeatedListFlag(args.slice(1), "alias"),
    ...collectRepeatedListFlag(args.slice(1), "aliases"),
    ...parseListFlag(flags.alias),
    ...parseListFlag(flags.aliases),
  ]);

  if (wantsSupervise) {
    const endpointProfile =
      typeof flags["endpoint-profile"] === "string"
        ? flags["endpoint-profile"]
        : undefined;
    const shouldUseConfiguredAppServerUrl =
      typeof flags["app-server-url"] !== "string" &&
      (!endpointProfile ||
        endpointProfile === "public-auth-gateway" ||
        endpointProfile === "public-auth-gateway-compat");
    const result = await runSupervisedReceiverPromotion({
      mode: flags.watch === true ? "watch" : "once",
      commsDir,
      stateDir,
      agent,
      aliases,
      includeOwn: flags["include-own"] === true,
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
      appServerUrl:
        typeof flags["app-server-url"] === "string"
          ? flags["app-server-url"]
          : undefined,
      endpointProfile,
      endpointConfig: shouldUseConfiguredAppServerUrl
        ? {
            profiles: {
              [endpointProfile ?? "public-auth-gateway"]: {
                url: config.appServerUrl,
              },
            },
          }
        : {},
      threadId:
        typeof flags["thread-id"] === "string" ? flags["thread-id"] : null,
      cwd: typeof flags.cwd === "string" ? flags.cwd : undefined,
      dryRun: flags["dry-run"] === true,
      debugEnvelope: flags["debug-envelope"] === true,
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
      maxPromotionsPerIteration: parseNumberFlag(
        flags["max-promotions-per-iteration"],
        "--max-promotions-per-iteration",
        1,
        20,
      ),
    });

    logHeader("tap receiver supervise");
    log(
      `adapter=${result.adapter}; receiveTransport=${result.receiveTransport}`,
    );
    log(`agent=${result.agent}; aliases=${result.aliases.join(", ")}`);
    log(`runtimeSurface=${result.runtimeSurface}; mode=${result.mode}`);
    log(
      `status=${result.status}; delivered=${result.delivered}; blocked=${result.blocked}; queued=${result.queued}`,
    );
    log(`iterations=${result.iterations}; attempts=${result.attempts.length}`);
    if (result.statePath) log(`statePath=${result.statePath}`);
    if (result.lastBlockedReason) {
      log(`blockedReason=${result.lastBlockedReason}`);
    }
    if (result.lastQueueReason) {
      log(`queueReason=${result.lastQueueReason}`);
    }

    return {
      ok: true,
      command: "receiver",
      code: "TAP_RECEIVER_OK",
      message:
        result.status === "idle"
          ? "Receiver supervisor found no pending local inbox items."
          : result.status === "delivered"
            ? `Receiver supervisor delivered ${result.delivered} item(s).`
            : `Receiver supervisor ${result.status} after ${result.attempts.length} attempt(s).`,
      warnings: result.warnings,
      data: result as unknown as Record<string, unknown>,
    };
  }

  if (wantsPromote) {
    const endpointProfile =
      typeof flags["endpoint-profile"] === "string"
        ? flags["endpoint-profile"]
        : undefined;
    const shouldUseConfiguredAppServerUrl =
      typeof flags["app-server-url"] !== "string" &&
      (!endpointProfile ||
        endpointProfile === "public-auth-gateway" ||
        endpointProfile === "public-auth-gateway-compat");
    const result = await runCodexCliAppServerPromotion({
      commsDir,
      stateDir,
      agent,
      aliases,
      includeOwn: flags["include-own"] === true,
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
      limit: parseNumberFlag(flags.limit, "--limit", 1, 1),
      appServerUrl:
        typeof flags["app-server-url"] === "string"
          ? flags["app-server-url"]
          : undefined,
      endpointProfile,
      endpointConfig: shouldUseConfiguredAppServerUrl
        ? {
            profiles: {
              [endpointProfile ?? "public-auth-gateway"]: {
                url: config.appServerUrl,
              },
            },
          }
        : {},
      threadId:
        typeof flags["thread-id"] === "string" ? flags["thread-id"] : null,
      cwd: typeof flags.cwd === "string" ? flags.cwd : undefined,
      dryRun: flags["dry-run"] === true,
      debugEnvelope: flags["debug-envelope"] === true,
    });

    logHeader("tap receiver promote");
    log(
      `adapter=${result.adapter}; receiveTransport=${result.receiveTransport}`,
    );
    log(`agent=${result.agent}; aliases=${result.aliases.join(", ")}`);
    log(`runtimeSurface=${result.runtimeSurface}`);
    log(
      `endpointProfile=${result.endpointProfile.profileId}; appServerUrl=${result.appServerUrl ?? "(none)"}`,
    );
    log(`statePath=${result.statePath}`);
    if (result.item) {
      log(
        `item=${result.item.path}; delivered=${result.delivered}; status=${result.status}`,
      );
    }
    if (result.blockedReason) {
      log(`blockedReason=${result.blockedReason}`);
    }
    if (result.queueReason) {
      log(`queueReason=${result.queueReason}`);
    }

    return {
      ok: true,
      command: "receiver",
      code: "TAP_RECEIVER_OK",
      message: result.item
        ? result.delivered
          ? `Receiver promoted ${result.item.path} into Codex app-server.`
          : `Receiver promotion blocked for ${result.item.path}.`
        : "Receiver found no pending local inbox items to promote.",
      warnings: result.warnings,
      data: result as unknown as Record<string, unknown>,
    };
  }

  const result = await runPollingReceiver({
    mode: mode!,
    commsDir,
    stateDir,
    agent,
    aliases,
    includeContent: flags["no-content"] !== true,
    includeOwn: flags["include-own"] === true,
    limit: parseNumberFlag(flags.limit, "--limit", 1, 100),
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
      typeof flags["state-name"] === "string" ? flags["state-name"] : undefined,
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
    debugEnvelope: flags["debug-envelope"] === true,
  });

  logHeader("tap receiver");
  log(`adapter=${result.adapter}; receiveTransport=${result.receiveTransport}`);
  log(`agent=${result.agent}; aliases=${result.aliases.join(", ")}`);
  log(`commsDir=${result.commsDir}`);
  log(`statePath=${result.statePath}`);
  if (result.effectiveSince) {
    log(`effectiveSince=${result.effectiveSince}`);
  }
  log(result.promptBundle);

  return {
    ok: true,
    command: "receiver",
    code: "TAP_RECEIVER_OK",
    message:
      result.items.length > 0
        ? `Receiver found ${result.items.length} pending local inbox item(s).`
        : "Receiver found no pending local inbox items.",
    warnings: result.warnings,
    data: result as unknown as Record<string, unknown>,
  };
}
