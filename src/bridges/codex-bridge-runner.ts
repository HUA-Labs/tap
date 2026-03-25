import * as fs from "node:fs";
import * as path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  resolveConfig,
  SHARED_CONFIG_FILE,
  LOCAL_CONFIG_FILE,
} from "../config/index.js";
import { resolveAppServerUrl } from "../engine/bridge.js";
import { resolveNodeRuntime, buildRuntimeEnv } from "../runtime/index.js";

// ─── Repo root discovery (fallback for unbundled runs) ─────────

function findRepoRootFromRunner(): string | null {
  let dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)));

  while (true) {
    if (fs.existsSync(path.join(dir, SHARED_CONFIG_FILE))) return dir;
    if (fs.existsSync(path.join(dir, LOCAL_CONFIG_FILE))) return dir;
    if (fs.existsSync(path.join(dir, "scripts", "codex-app-server-bridge.ts")))
      return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

// ─── Headless review loop integration ──────────────────────────

function maybeStartHeadlessLoop(
  repoRoot: string,
  commsDir: string,
  stateDir: string | undefined,
): void {
  if (process.env.TAP_HEADLESS !== "true") return;

  // Dynamic import to avoid loading review/termination engines in non-headless mode
  import("../engine/headless-loop.js")
    .then(({ createHeadlessLoop }) => {
      const agentName =
        process.env.TAP_AGENT_NAME ??
        process.env.CODEX_TAP_AGENT_NAME ??
        "reviewer";
      const generation = process.env.TAP_REVIEW_GENERATION ?? "gen11";
      const resolvedStateDir = stateDir ?? path.join(repoRoot, ".tap-comms");

      const loop = createHeadlessLoop({
        commsDir,
        stateDir: resolvedStateDir,
        repoRoot,
        agentName,
        generation,
        pollIntervalMs: 3_000, // Poll faster than generic bridge (5s) for review priority
      });

      loop.start();

      // Clean shutdown
      process.on("SIGTERM", () => loop.stop());
      process.on("SIGINT", () => loop.stop());
    })
    .catch((err) => {
      console.error("[headless-loop] Failed to start:", err);
    });
}

// ─── Main ──────────────────────────────────────────────────────

interface BridgeScriptArgsOptions {
  repoRoot: string;
  commsDir: string;
  appServerUrl: string;
  gatewayTokenFile?: string;
  stateDir?: string;
  agentName?: string;
}

export function resolveBridgeDaemonScript(
  repoRoot: string,
  runnerUrl: string = import.meta.url,
  fileExists: (candidate: string) => boolean = fs.existsSync,
): string | null {
  const moduleDir = path.dirname(fileURLToPath(runnerUrl));
  const candidates = [
    // 1. Bundled standalone/npm install
    path.join(moduleDir, "codex-app-server-bridge.mjs"),
    // 2. Source run from monorepo package
    path.join(moduleDir, "codex-app-server-bridge.ts"),
    // 3. Built monorepo package dist
    path.join(
      repoRoot,
      "packages",
      "tap-comms",
      "dist",
      "bridges",
      "codex-app-server-bridge.mjs",
    ),
    // 4. Monorepo source wrapper
    path.join(
      repoRoot,
      "packages",
      "tap-comms",
      "src",
      "bridges",
      "codex-app-server-bridge.ts",
    ),
    // 5. Legacy monorepo root script
    path.join(repoRoot, "scripts", "codex-app-server-bridge.ts"),
  ];

  for (const candidate of candidates) {
    if (fileExists(candidate)) {
      return candidate;
    }
  }

  return null;
}

export function buildBridgeScriptArgs(
  scriptPath: string,
  options: BridgeScriptArgsOptions,
): string[] {
  const args = [
    scriptPath,
    `--repo-root=${options.repoRoot}`,
    `--comms-dir=${options.commsDir}`,
    `--app-server-url=${options.appServerUrl}`,
  ];

  if (options.agentName) {
    args.push(`--agent-name=${options.agentName}`);
  }

  if (options.gatewayTokenFile) {
    args.push(`--gateway-token-file=${options.gatewayTokenFile}`);
  }

  if (options.stateDir) {
    args.push(`--state-dir=${options.stateDir}`);
  }

  return args;
}

async function main(): Promise<void> {
  const repoRootHint = findRepoRootFromRunner() ?? undefined;
  const { config } = resolveConfig({}, repoRootHint);

  const repoRoot = config.repoRoot;
  const commsDir = config.commsDir;
  const instancePortRaw = process.env.TAP_BRIDGE_PORT;
  const instancePort = instancePortRaw
    ? Number.parseInt(instancePortRaw, 10)
    : undefined;
  const envAppServerUrl = process.env.CODEX_APP_SERVER_URL?.trim();
  const gatewayTokenFile = process.env.TAP_GATEWAY_TOKEN_FILE?.trim();
  const appServerUrl =
    envAppServerUrl ||
    resolveAppServerUrl(
      config.appServerUrl,
      Number.isFinite(instancePort) ? instancePort : undefined,
    );

  // Multi-instance: derive instance-specific state dir
  // Honor TAP_STATE_DIR env (set by config resolver) before falling back to .tmp/
  const instanceId = process.env.TAP_BRIDGE_INSTANCE_ID;
  const envStateDir = process.env.TAP_STATE_DIR;
  const stateDir = envStateDir
    ? envStateDir
    : instanceId
      ? path.join(repoRoot, ".tmp", `codex-app-server-bridge-${instanceId}`)
      : undefined;

  // Honor pre-resolved node from parent (2-stage spawn: engine → runner → daemon)
  // TAP_STRIP_TYPES preserves metadata so bun doesn't get --experimental-strip-types.
  const preResolved = process.env.TAP_RESOLVED_NODE;
  const resolved = preResolved
    ? {
        command: preResolved,
        supportsStripTypes: process.env.TAP_STRIP_TYPES === "1",
        source: "env" as const,
        majorVersion: null,
      }
    : resolveNodeRuntime(config.runtimeCommand, repoRoot);

  const command = resolved.command;
  const agentName =
    process.env.TAP_AGENT_NAME?.trim() ||
    process.env.CODEX_TAP_AGENT_NAME?.trim() ||
    undefined;

  // Locate bridge script
  const scriptPath = resolveBridgeDaemonScript(repoRoot);
  if (!scriptPath) {
    throw new Error(
      `Bridge script not found for repo root ${repoRoot}.\n` +
        `Expected a packaged dist/bridges/codex-app-server-bridge.mjs or monorepo bridge script.`,
    );
  }

  // Build args
  const args: string[] = [];
  if (resolved.supportsStripTypes) {
    args.push("--experimental-strip-types");
  }
  args.push(
    ...buildBridgeScriptArgs(scriptPath, {
      repoRoot,
      commsDir,
      appServerUrl,
      gatewayTokenFile,
      stateDir,
      agentName,
    }),
  );

  // Forward bridge operational flags from env (set by engine/bridge.ts)
  const busyMode = process.env.TAP_BUSY_MODE;
  if (busyMode) args.push(`--busy-mode=${busyMode}`);

  const pollSeconds = process.env.TAP_POLL_SECONDS;
  if (pollSeconds) args.push(`--poll-seconds=${pollSeconds}`);

  const reconnectSeconds = process.env.TAP_RECONNECT_SECONDS;
  if (reconnectSeconds) args.push(`--reconnect-seconds=${reconnectSeconds}`);

  const lookbackMinutes = process.env.TAP_MESSAGE_LOOKBACK_MINUTES;
  if (lookbackMinutes)
    args.push(`--message-lookback-minutes=${lookbackMinutes}`);

  const threadId = process.env.TAP_THREAD_ID;
  if (threadId) args.push(`--thread-id=${threadId}`);

  if (process.env.TAP_EPHEMERAL === "true") args.push("--ephemeral");
  if (process.env.TAP_PROCESS_EXISTING === "true")
    args.push("--process-existing-messages");

  // Spawn with fnm-aware PATH so any further child spawns also find the right Node
  const runtimeEnv = buildRuntimeEnv(repoRoot);

  const child = spawn(command, args, {
    cwd: repoRoot,
    env: runtimeEnv,
    stdio: "inherit",
  });

  // Start headless review loop if in headless mode
  maybeStartHeadlessLoop(repoRoot, commsDir, stateDir);

  child.on("exit", (code: number | null, signal: NodeJS.Signals | null) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 0);
  });

  child.on("error", (error: Error) => {
    console.error(String(error));
    process.exit(1);
  });
}

function isDirectExecution(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(path.resolve(entry)).href;
}

if (isDirectExecution()) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
