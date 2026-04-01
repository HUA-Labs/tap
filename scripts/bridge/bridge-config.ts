// bridge-config.ts — CLI argument parsing and options building

import { existsSync, mkdirSync, readFileSync } from "fs";
import { isAbsolute, join, resolve } from "path";
import { normalizeTapPath } from "../../src/config/resolve.js";
import {
  BusyMode,
  DEFAULT_APP_SERVER_URL,
  LogLevel,
  Options,
} from "./bridge-types.js";
import {
  persistAgentName,
  resolveAgentId,
  resolveAgentName,
} from "./bridge-routing.js";

function ensureDir(target: string): string {
  if (!existsSync(target)) {
    mkdirSync(target, { recursive: true });
  }
  return resolve(target);
}

function printHelp(): void {
  console.log(`Codex App Server bridge

Usage:
  node --experimental-strip-types scripts/codex-app-server-bridge.ts [options]

Options:
  --repo-root=<path>
  --comms-dir=<path>
  --agent-name=<name>
  --state-dir=<path>
  --poll-seconds=<n>
  --reconnect-seconds=<n>
  --message-lookback-minutes=<n>
  --process-existing-messages
  --dry-run
  --run-once
  --wait-after-dispatch-seconds=<n>
  --app-server-url=<ws-url>
  --gateway-token-file=<path>
  --busy-mode=wait|steer
  --log-level=debug|info|warn|error
  --thread-id=<id>
  --ephemeral
  --help
`);
}

function parseNumber(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Invalid ${flag}: ${value}`);
  }
  return parsed;
}

function readFlagValue(argv: string[], index: number, flag: string): string {
  const current = argv[index];
  const eqIndex = current.indexOf("=");
  if (eqIndex >= 0) {
    return current.slice(eqIndex + 1);
  }

  const next = argv[index + 1];
  if (!next || next.startsWith("--")) {
    throw new Error(`Missing value for ${flag}`);
  }
  return next;
}

export function parseArgs(argv: string[]): {
  repoRoot?: string;
  commsDir?: string;
  agentName?: string;
  stateDir?: string;
  pollSeconds?: number;
  reconnectSeconds?: number;
  messageLookbackMinutes?: number;
  processExistingMessages: boolean;
  dryRun: boolean;
  runOnce: boolean;
  waitAfterDispatchSeconds?: number;
  appServerUrl?: string;
  gatewayTokenFile?: string;
  busyMode?: BusyMode;
  logLevel?: LogLevel;
  threadId?: string;
  ephemeral: boolean;
} {
  const parsed = {
    processExistingMessages: false,
    dryRun: false,
    runOnce: false,
    ephemeral: false,
  } as {
    repoRoot?: string;
    commsDir?: string;
    agentName?: string;
    stateDir?: string;
    pollSeconds?: number;
    reconnectSeconds?: number;
    messageLookbackMinutes?: number;
    processExistingMessages: boolean;
    dryRun: boolean;
    runOnce: boolean;
    waitAfterDispatchSeconds?: number;
    appServerUrl?: string;
    gatewayTokenFile?: string;
    busyMode?: BusyMode;
    logLevel?: LogLevel;
    threadId?: string;
    ephemeral: boolean;
  };

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const consumesNext = !flag.includes("=");

    if (flag === "--help") {
      printHelp();
      process.exit(0);
    }

    if (flag === "--process-existing-messages") {
      parsed.processExistingMessages = true;
      continue;
    }

    if (flag === "--dry-run") {
      parsed.dryRun = true;
      continue;
    }

    if (flag === "--run-once") {
      parsed.runOnce = true;
      continue;
    }

    if (flag === "--ephemeral") {
      parsed.ephemeral = true;
      continue;
    }

    if (flag.startsWith("--repo-root")) {
      parsed.repoRoot = readFlagValue(argv, index, "--repo-root");
      if (consumesNext) {
        index += 1;
      }
      continue;
    }

    if (flag.startsWith("--comms-dir")) {
      parsed.commsDir = readFlagValue(argv, index, "--comms-dir");
      if (consumesNext) {
        index += 1;
      }
      continue;
    }

    if (flag.startsWith("--agent-name")) {
      parsed.agentName = readFlagValue(argv, index, "--agent-name");
      if (consumesNext) {
        index += 1;
      }
      continue;
    }

    if (flag.startsWith("--state-dir")) {
      parsed.stateDir = readFlagValue(argv, index, "--state-dir");
      if (consumesNext) {
        index += 1;
      }
      continue;
    }

    if (flag.startsWith("--poll-seconds")) {
      parsed.pollSeconds = parseNumber(
        readFlagValue(argv, index, "--poll-seconds"),
        "--poll-seconds",
      );
      if (consumesNext) {
        index += 1;
      }
      continue;
    }

    if (flag.startsWith("--reconnect-seconds")) {
      parsed.reconnectSeconds = parseNumber(
        readFlagValue(argv, index, "--reconnect-seconds"),
        "--reconnect-seconds",
      );
      if (consumesNext) {
        index += 1;
      }
      continue;
    }

    if (flag.startsWith("--message-lookback-minutes")) {
      parsed.messageLookbackMinutes = parseNumber(
        readFlagValue(argv, index, "--message-lookback-minutes"),
        "--message-lookback-minutes",
      );
      if (consumesNext) {
        index += 1;
      }
      continue;
    }

    if (flag.startsWith("--app-server-url")) {
      parsed.appServerUrl = readFlagValue(argv, index, "--app-server-url");
      if (consumesNext) {
        index += 1;
      }
      continue;
    }

    if (flag.startsWith("--gateway-token-file")) {
      parsed.gatewayTokenFile = readFlagValue(
        argv,
        index,
        "--gateway-token-file",
      );
      if (consumesNext) {
        index += 1;
      }
      continue;
    }

    if (flag.startsWith("--wait-after-dispatch-seconds")) {
      parsed.waitAfterDispatchSeconds = parseNumber(
        readFlagValue(argv, index, "--wait-after-dispatch-seconds"),
        "--wait-after-dispatch-seconds",
      );
      if (consumesNext) {
        index += 1;
      }
      continue;
    }

    if (flag.startsWith("--busy-mode")) {
      const value = readFlagValue(argv, index, "--busy-mode");
      if (value !== "wait" && value !== "steer") {
        throw new Error(`Invalid --busy-mode: ${value}`);
      }
      parsed.busyMode = value;
      if (consumesNext) {
        index += 1;
      }
      continue;
    }

    if (flag.startsWith("--thread-id")) {
      parsed.threadId = readFlagValue(argv, index, "--thread-id");
      if (consumesNext) {
        index += 1;
      }
      continue;
    }

    if (flag.startsWith("--log-level")) {
      const value = readFlagValue(argv, index, "--log-level");
      if (
        value !== "debug" &&
        value !== "info" &&
        value !== "warn" &&
        value !== "error"
      ) {
        throw new Error(`Invalid --log-level: ${value}`);
      }
      parsed.logLevel = value;
      if (consumesNext) {
        index += 1;
      }
      continue;
    }

    throw new Error(`Unknown argument: ${flag}`);
  }

  return parsed;
}

export function resolveRepoRoot(explicit?: string): string {
  if (explicit) {
    return resolve(explicit);
  }

  return process.cwd();
}

export function resolveTapConfigPath(repoRoot: string, input: string): string {
  const converted = normalizeTapPath(input);
  return isAbsolute(converted)
    ? resolve(converted)
    : resolve(repoRoot, converted);
}

export function resolveCommsDir(repoRoot: string, explicit?: string): string {
  if (explicit) {
    return resolve(normalizeTapPath(explicit));
  }

  const tapConfigPath = join(repoRoot, ".tap-config");
  if (!existsSync(tapConfigPath)) {
    throw new Error(
      "Unable to resolve comms directory. Pass --comms-dir explicitly.",
    );
  }

  const configText = readFileSync(tapConfigPath, "utf8");
  const match = configText.match(/^TAP_COMMS_DIR="?(.*?)"?$/m);
  if (!match?.[1]) {
    throw new Error(
      "Unable to resolve comms directory. Pass --comms-dir explicitly.",
    );
  }

  return resolveTapConfigPath(repoRoot, match[1]);
}

export function resolvePreferredAgentName(requested?: string): string | null {
  if (requested?.trim()) {
    return requested.trim();
  }

  for (const envName of ["TAP_AGENT_NAME", "CODEX_TAP_AGENT_NAME"]) {
    const candidate = process.env[envName];
    if (candidate?.trim()) {
      return candidate.trim();
    }
  }

  return null;
}

export function sanitizeStateSegment(agentName: string): string {
  const normalized = agentName
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "-")
    .replace(/[. ]+$/g, "");

  return normalized || "agent";
}

export function buildDefaultStateDir(
  repoRoot: string,
  preferredAgentName?: string | null,
): string {
  const suffix = preferredAgentName?.trim()
    ? `-${sanitizeStateSegment(preferredAgentName)}`
    : "";
  return resolve(join(repoRoot, ".tmp", `codex-app-server-bridge${suffix}`));
}

export function resolveStateDir(
  repoRoot: string,
  explicit?: string,
  preferredAgentName?: string | null,
): string {
  const root = explicit
    ? resolve(explicit)
    : buildDefaultStateDir(repoRoot, preferredAgentName);

  ensureDir(root);
  ensureDir(join(root, "processed"));
  ensureDir(join(root, "logs"));
  return root;
}

export function readGatewayTokenFile(tokenFile: string): string {
  const token = readFileSync(tokenFile, "utf8").trim();
  if (!token) {
    throw new Error(`Gateway token file is empty: ${tokenFile}`);
  }
  return token;
}

export function buildOptions(argv: string[]): Options {
  const parsed = parseArgs(argv);
  const repoRoot = resolveRepoRoot(parsed.repoRoot);
  const commsDir = resolveCommsDir(repoRoot, parsed.commsDir);
  const preferredAgentName = resolvePreferredAgentName(parsed.agentName);
  const stateDir = resolveStateDir(
    repoRoot,
    parsed.stateDir,
    preferredAgentName,
  );
  const agentName = resolveAgentName(preferredAgentName, stateDir);
  const agentId = resolveAgentId(agentName);
  persistAgentName(stateDir, agentName);
  const gatewayTokenFile =
    parsed.gatewayTokenFile?.trim() ||
    process.env.TAP_GATEWAY_TOKEN_FILE?.trim() ||
    null;
  const appServerUrl =
    parsed.appServerUrl?.trim() ||
    process.env.CODEX_APP_SERVER_URL ||
    DEFAULT_APP_SERVER_URL;

  return {
    repoRoot,
    commsDir,
    agentId,
    stateDir,
    agentName,
    pollSeconds: parsed.pollSeconds ?? 5,
    reconnectSeconds: parsed.reconnectSeconds ?? 5,
    messageLookbackMinutes: parsed.messageLookbackMinutes ?? 10,
    processExistingMessages: parsed.processExistingMessages,
    dryRun: parsed.dryRun,
    runOnce: parsed.runOnce,
    waitAfterDispatchSeconds: parsed.waitAfterDispatchSeconds ?? 0,
    appServerUrl,
    connectAppServerUrl: appServerUrl,
    gatewayToken: gatewayTokenFile
      ? readGatewayTokenFile(gatewayTokenFile)
      : null,
    gatewayTokenFile,
    busyMode: parsed.busyMode ?? "steer",
    logLevel: parsed.logLevel ?? "info",
    threadId: parsed.threadId?.trim() || null,
    ephemeral: parsed.ephemeral,
  };
}
