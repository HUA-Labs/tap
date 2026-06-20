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

export function resolveRepoRootHintFromRunner(
  runnerUrl: string = import.meta.url,
  env: NodeJS.ProcessEnv = process.env,
  fileExists: (candidate: string) => boolean = fs.existsSync,
): string | null {
  const envRepoRoot = env.TAP_REPO_ROOT?.trim();
  if (envRepoRoot) {
    return path.resolve(envRepoRoot);
  }

  let dir = path.resolve(path.dirname(fileURLToPath(runnerUrl)));

  while (true) {
    if (fileExists(path.join(dir, SHARED_CONFIG_FILE))) return dir;
    if (fileExists(path.join(dir, LOCAL_CONFIG_FILE))) return dir;
    if (
      fileExists(
        path.join(dir, "scripts", "codex", "codex-app-server-bridge.ts"),
      )
    ) {
      return dir;
    }
    if (fileExists(path.join(dir, "scripts", "codex-app-server-bridge.ts")))
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
      const agentId =
        process.env.TAP_AGENT_ID ??
        process.env.TAP_BRIDGE_INSTANCE_ID ??
        agentName;
      const generation = resolveHeadlessReviewGeneration(repoRoot, commsDir);
      const resolvedStateDir = stateDir ?? path.join(repoRoot, ".tap-comms");

      const loop = createHeadlessLoop({
        commsDir,
        stateDir: resolvedStateDir,
        repoRoot,
        agentId,
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

export function resolveHeadlessReviewGeneration(
  repoRoot: string,
  commsDir?: string | null,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const explicit = env.TAP_REVIEW_GENERATION?.trim();
  if (explicit) return explicit;

  const envGeneration = normalizeGenerationValue(env.TAP_GENERATION);
  if (envGeneration) return envGeneration;

  try {
    const reviewsDir = path.join(repoRoot, "reviews");
    const generations = readGenerationNumbers(reviewsDir);
    if (generations.length > 0) {
      return `gen${generations[0]}`;
    }
  } catch {
    // Fall through to comms/env fallback.
  }

  const resolvedCommsDir =
    commsDir?.trim() || env.TAP_COMMS_DIR?.trim() || null;
  if (resolvedCommsDir) {
    const commsGenerations = [
      ...readGenerationNumbers(path.join(resolvedCommsDir, "retros")),
      ...readGenerationNumbers(path.join(resolvedCommsDir, "letters")),
    ].sort((a, b) => b - a);
    if (commsGenerations.length > 0) {
      return `gen${commsGenerations[0]}`;
    }
  }

  return "gen1";
}

function normalizeGenerationValue(
  value: string | null | undefined,
): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/^gen(\d+)$/i) ?? trimmed.match(/^(\d+)$/);
  if (!match?.[1]) return null;
  return `gen${Number.parseInt(match[1], 10)}`;
}

function readGenerationNumbers(dir: string): number[] {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => normalizeGenerationValue(entry.name))
      .filter((value): value is string => Boolean(value))
      .map((value) => Number.parseInt(value.slice(3), 10))
      .filter(Number.isFinite)
      .sort((a, b) => b - a);
  } catch {
    return [];
  }
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
    // 5. Monorepo scripts/codex/ subfolder
    path.join(repoRoot, "scripts", "codex", "codex-app-server-bridge.ts"),
    // 6. Legacy monorepo root script (pre-cleanup)
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

export function buildBridgeDaemonEnv(
  parentEnv: NodeJS.ProcessEnv,
  runtimeEnv: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  return {
    ...parentEnv,
    ...runtimeEnv,
  };
}

function normalizeRoutingSlot(value: string | null | undefined): string | null {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === "tower") return "tower";
  if (normalized === "reviewer") return "reviewer";
  const worktreeMatch = normalized.match(/^wt[-_]?(\d+)$/);
  if (worktreeMatch) {
    return `wt-${Number.parseInt(worktreeMatch[1], 10)}`;
  }
  return null;
}

export function resolveBridgeRoutingSlot(
  repoRoot: string,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const explicit = normalizeRoutingSlot(env.TAP_ROUTING_SLOT);
  if (explicit) return explicit;

  const instanceId =
    env.TAP_INSTANCE_ID?.trim() || env.TAP_BRIDGE_INSTANCE_ID?.trim() || "";
  const normalizedInstance = instanceId.toLowerCase().replace(/_/g, "-");
  if (
    normalizedInstance === "tower" ||
    normalizedInstance === "claude-main" ||
    normalizedInstance === "codex-main"
  ) {
    return "tower";
  }
  if (
    normalizedInstance === "reviewer" ||
    normalizedInstance === "claude-reviewer" ||
    normalizedInstance === "codex-reviewer"
  ) {
    return "reviewer";
  }
  if (/^(?:(?:claude|codex)-)?wt-?(\d+)$/.test(normalizedInstance)) {
    return normalizeRoutingSlot(
      normalizedInstance.replace(/^(?:claude|codex)-/, ""),
    );
  }

  return normalizeRoutingSlot(path.basename(repoRoot));
}

async function main(): Promise<void> {
  const repoRootHint = resolveRepoRootHintFromRunner() ?? undefined;
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

  // Multi-instance: derive instance-specific runtime state dir.
  // TAP_STATE_DIR points to shared state.json for MCP bootstrap/rebind.
  // TAP_RUNTIME_STATE_DIR is the bridge-only heartbeat/thread directory.
  const instanceId = process.env.TAP_BRIDGE_INSTANCE_ID;
  const envStateDir = process.env.TAP_RUNTIME_STATE_DIR;
  let stateDir: string | undefined;
  if (envStateDir) {
    stateDir = envStateDir;
  } else if (instanceId) {
    const resolved = path.resolve(
      path.join(repoRoot, ".tmp", `codex-app-server-bridge-${instanceId}`),
    );
    const expectedBase = path.resolve(repoRoot, ".tmp") + path.sep;
    if (!resolved.startsWith(expectedBase)) {
      throw new Error(
        `Path traversal blocked: runtime state dir escapes .tmp/ directory`,
      );
    }
    stateDir = resolved;
  }

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
  const daemonEnv = buildBridgeDaemonEnv(process.env, runtimeEnv);
  const routingSlot = resolveBridgeRoutingSlot(repoRoot, daemonEnv);
  if (routingSlot && !daemonEnv.TAP_ROUTING_SLOT) {
    daemonEnv.TAP_ROUTING_SLOT = routingSlot;
  }

  const child = spawn(command, args, {
    cwd: repoRoot,
    env: daemonEnv,
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
  if (!path.basename(entry).startsWith("codex-bridge-runner")) return false;
  return import.meta.url === pathToFileURL(path.resolve(entry)).href;
}

if (isDirectExecution()) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
