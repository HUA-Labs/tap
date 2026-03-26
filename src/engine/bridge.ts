import * as fs from "node:fs";
import * as net from "node:net";
import * as path from "node:path";
import { randomBytes } from "node:crypto";
import { spawn, spawnSync, execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import type {
  RuntimeName,
  InstanceId,
  BridgeState,
  AppServerState,
  AppServerAuthState,
  HeadlessConfig,
  Platform,
  TapState,
} from "../types.js";
import { probeCommand } from "../adapters/common.js";
import { resolveNodeRuntime, buildRuntimeEnv } from "../runtime/index.js";
import { loadState } from "../state.js";

export interface BridgeStartOptions {
  instanceId: InstanceId;
  runtime: RuntimeName;
  stateDir: string;
  commsDir: string;
  bridgeScript: string;
  platform: Platform;
  agentName?: string;
  runtimeCommand?: string;
  appServerUrl?: string;
  repoRoot?: string;
  port?: number;
  /** Headless configuration. Passed as env vars to the bridge process. */
  headless?: HeadlessConfig | null;
  /** Bridge script operational flags (forwarded to codex-app-server-bridge.ts) */
  busyMode?: "steer" | "wait";
  pollSeconds?: number;
  reconnectSeconds?: number;
  messageLookbackMinutes?: number;
  threadId?: string;
  ephemeral?: boolean;
  processExistingMessages?: boolean;
  manageAppServer?: boolean;
  /** Skip auth gateway — app-server listens directly on the public port (localhost only). */
  noAuth?: boolean;
}

export interface BridgeStopOptions {
  instanceId: InstanceId;
  stateDir: string;
  platform: Platform;
}

interface EnsureCodexAppServerOptions {
  instanceId: InstanceId;
  stateDir: string;
  repoRoot: string;
  platform: Platform;
  appServerUrl: string;
  existingAppServer?: AppServerState | null;
  noAuth?: boolean;
}

interface ManagedAppServerGatewayOptions {
  instanceId: InstanceId;
  stateDir: string;
  repoRoot: string;
  platform: Platform;
  publicUrl: string;
}

interface WebSocketLike {
  addEventListener(
    type: "open" | "error" | "close",
    listener: () => void,
    options?: { once?: boolean },
  ): void;
  close(code?: number, reason?: string): void;
}

type WebSocketCtor = new (
  url: string,
  protocols?: string | string[],
) => WebSocketLike;

const DEFAULT_APP_SERVER_URL = "ws://127.0.0.1:4501";
const APP_SERVER_HEALTH_TIMEOUT_MS = 1_500;
const APP_SERVER_START_TIMEOUT_MS = 20_000;
const APP_SERVER_GATEWAY_START_TIMEOUT_MS = 5_000;
const APP_SERVER_HEALTH_RETRY_MS = 250;
const AUTH_SUBPROTOCOL_PREFIX = "tap-auth-";
const APP_SERVER_AUTH_FILE_MODE = 0o600;

function appServerLogFilePath(
  stateDir: string,
  instanceId: InstanceId,
): string {
  return path.join(stateDir, "logs", `app-server-${instanceId}.log`);
}

function appServerGatewayLogFilePath(
  stateDir: string,
  instanceId: InstanceId,
): string {
  return path.join(stateDir, "logs", `app-server-gateway-${instanceId}.log`);
}

function appServerGatewayTokenFilePath(
  stateDir: string,
  instanceId: InstanceId,
): string {
  return path.join(
    stateDir,
    "secrets",
    `app-server-gateway-${instanceId}.token`,
  );
}

function stderrLogFilePath(logPath: string): string {
  return `${logPath}.stderr`;
}

function writeProtectedTextFile(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, content, {
    encoding: "utf-8",
    mode: APP_SERVER_AUTH_FILE_MODE,
  });
  fs.chmodSync(tmp, APP_SERVER_AUTH_FILE_MODE);
  fs.renameSync(tmp, filePath);
  fs.chmodSync(filePath, APP_SERVER_AUTH_FILE_MODE);
}

function removeFileIfExists(filePath: string | null | undefined): void {
  if (!filePath || !fs.existsSync(filePath)) {
    return;
  }

  try {
    fs.unlinkSync(filePath);
  } catch {
    // Best-effort cleanup only.
  }
}

function getWebSocketCtor(): WebSocketCtor | null {
  const candidate = (globalThis as { WebSocket?: unknown }).WebSocket;
  return typeof candidate === "function" ? (candidate as WebSocketCtor) : null;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === "127.0.0.1" || hostname === "localhost";
}

function resolveCodexCommand(platform: Platform): string | null {
  const candidates =
    platform === "win32"
      ? ["codex.cmd", "codex.exe", "codex", "codex.ps1"]
      : ["codex"];
  return probeCommand(candidates).command;
}

function formatCodexAppServerCommand(command: string, url: string): string {
  return `${command} app-server --listen ${url}`;
}

function resolvePowerShellCommand(): string {
  return (
    probeCommand(["pwsh", "powershell", "powershell.exe"]).command ??
    "powershell"
  );
}

function resolveAuthGatewayScript(repoRoot: string): string | null {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    // Bundled: dist/bridges/ sibling (npm install / built package)
    path.join(moduleDir, "bridges", "codex-app-server-auth-gateway.mjs"),
    // Source: src/bridges/ sibling (monorepo dev with ts runner)
    path.join(moduleDir, "bridges", "codex-app-server-auth-gateway.ts"),
    // Monorepo dist fallback
    path.join(
      repoRoot,
      "packages",
      "tap-comms",
      "dist",
      "bridges",
      "codex-app-server-auth-gateway.mjs",
    ),
    path.join(
      repoRoot,
      "packages",
      "tap-comms",
      "src",
      "bridges",
      "codex-app-server-auth-gateway.ts",
    ),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

export function getBridgeRuntimeStateDir(
  repoRoot: string,
  instanceId: InstanceId,
): string {
  return path.join(repoRoot, ".tmp", `codex-app-server-bridge-${instanceId}`);
}

async function allocateLoopbackPort(hostname: string): Promise<number> {
  const bindHost = hostname === "localhost" ? "127.0.0.1" : hostname;
  return await new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, bindHost, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => {
          reject(new Error("Failed to allocate a loopback port"));
        });
        return;
      }

      const port = address.port;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
  });
}

function buildProtectedAppServerUrl(publicUrl: string, _token: string): string {
  // Subprotocol auth: token is no longer embedded in the URL.
  // Kept for backward compatibility with state display — shows base URL only.
  return publicUrl;
}

function readGatewayTokenFromPath(tokenPath: string): string {
  return fs.readFileSync(tokenPath, "utf8").trim();
}

function readGatewayToken(
  auth: AppServerAuthState | null | undefined,
): string | null {
  if (!auth) {
    return null;
  }

  const legacyToken = (auth as AppServerAuthState & { token?: string }).token;
  if (legacyToken?.trim()) {
    return legacyToken.trim();
  }

  if (!auth.tokenPath || !fs.existsSync(auth.tokenPath)) {
    return null;
  }

  const fileToken = readGatewayTokenFromPath(auth.tokenPath);
  return fileToken || null;
}

function materializeGatewayTokenFile(
  stateDir: string,
  instanceId: InstanceId,
  publicUrl: string,
  auth: AppServerAuthState,
): AppServerAuthState {
  if (auth.tokenPath && fs.existsSync(auth.tokenPath)) {
    return auth;
  }

  const token = readGatewayToken(auth);
  if (!token) {
    throw new Error(`Missing auth gateway token for ${instanceId}`);
  }

  const tokenPath = appServerGatewayTokenFilePath(stateDir, instanceId);
  writeProtectedTextFile(tokenPath, `${token}\n`);
  return {
    ...auth,
    protectedUrl: buildProtectedAppServerUrl(publicUrl, "***"),
    tokenPath,
  };
}

async function createManagedAppServerAuth(
  options: ManagedAppServerGatewayOptions,
): Promise<AppServerAuthState> {
  const publicUrl = new URL(options.publicUrl);
  const upstreamUrl = new URL(options.publicUrl);
  upstreamUrl.port = String(await allocateLoopbackPort(publicUrl.hostname));
  upstreamUrl.search = "";
  upstreamUrl.hash = "";

  const gatewayScript = resolveAuthGatewayScript(options.repoRoot);
  if (!gatewayScript) {
    throw new Error("Auth gateway script not found");
  }

  const token = randomBytes(24).toString("base64url");
  const tokenPath = appServerGatewayTokenFilePath(
    options.stateDir,
    options.instanceId,
  );
  writeProtectedTextFile(tokenPath, `${token}\n`);
  const protectedUrl = buildProtectedAppServerUrl(options.publicUrl, "***");

  const gatewayLogPath = appServerGatewayLogFilePath(
    options.stateDir,
    options.instanceId,
  );
  fs.mkdirSync(path.dirname(gatewayLogPath), { recursive: true });
  rotateLog(gatewayLogPath);

  const runtime = resolveNodeRuntime(process.execPath, options.repoRoot);
  const gatewayArgs: string[] = [];
  if (gatewayScript.endsWith(".ts")) {
    if (!runtime.supportsStripTypes) {
      throw new Error(
        "Current Node runtime cannot start the auth gateway from TypeScript source. Rebuild @hua-labs/tap or use Node 22.6+.",
      );
    }
    gatewayArgs.push("--experimental-strip-types");
  }
  gatewayArgs.push(gatewayScript);

  const gatewayEnv = {
    ...buildRuntimeEnv(options.repoRoot),
    TAP_GATEWAY_LISTEN_URL: options.publicUrl,
    TAP_GATEWAY_UPSTREAM_URL: upstreamUrl.toString().replace(/\/$/, ""),
    TAP_GATEWAY_TOKEN_FILE: tokenPath,
  };

  let gatewayPid: number | null;
  {
    let logFd: number | null = null;
    try {
      if (options.platform === "win32") {
        gatewayPid = startWindowsDetachedProcess(
          runtime.command,
          gatewayArgs,
          options.repoRoot,
          gatewayLogPath,
          gatewayEnv,
        );
      } else {
        logFd = fs.openSync(gatewayLogPath, "a");
        const child = spawn(runtime.command, gatewayArgs, {
          cwd: options.repoRoot,
          detached: true,
          stdio: ["ignore", logFd, logFd],
          env: gatewayEnv,
          windowsHide: true,
        });
        child.unref();
        gatewayPid = child.pid ?? null;
      }
    } catch (error) {
      removeFileIfExists(tokenPath);
      throw error;
    } finally {
      if (logFd != null) {
        fs.closeSync(logFd);
      }
    }
  }

  if (gatewayPid == null) {
    removeFileIfExists(tokenPath);
    throw new Error("Failed to spawn app-server auth gateway");
  }

  return {
    mode: "subprotocol",
    protectedUrl,
    upstreamUrl: upstreamUrl.toString().replace(/\/$/, ""),
    tokenPath,
    gatewayPid,
    gatewayLogPath,
  };
}

function canReuseManagedAppServer(
  appServer: AppServerState | null | undefined,
): boolean {
  if (!appServer?.managed) {
    return false;
  }

  // App-server process must be alive
  if (appServer.pid != null && !isProcessAlive(appServer.pid)) {
    return false;
  }

  const auth = appServer.auth;
  if (auth) {
    // Auth mode: verify gateway token and process are intact
    if (!auth.protectedUrl) {
      return false;
    }
    if (!readGatewayToken(auth)) {
      return false;
    }
    if (auth.gatewayPid != null && !isProcessAlive(auth.gatewayPid)) {
      return false;
    }
  }
  // No-auth mode (auth is null): only the app-server process check above is needed

  return true;
}

function markAppServerHealthy(appServer: AppServerState): AppServerState {
  const checkedAt = new Date().toISOString();
  return {
    ...appServer,
    healthy: true,
    lastCheckedAt: checkedAt,
    lastHealthyAt: checkedAt,
  };
}

function findReusableManagedAppServer(
  stateDir: string,
  publicUrl: string,
): AppServerState | null {
  const pidDir = path.join(stateDir, "pids");
  if (!fs.existsSync(pidDir)) {
    return null;
  }

  for (const name of fs.readdirSync(pidDir)) {
    if (!name.startsWith("bridge-") || !name.endsWith(".json")) {
      continue;
    }

    try {
      const raw = fs.readFileSync(path.join(pidDir, name), "utf-8");
      const parsed = JSON.parse(raw) as BridgeState;
      if (parsed.appServer?.url !== publicUrl) {
        continue;
      }
      if (canReuseManagedAppServer(parsed.appServer)) {
        return markAppServerHealthy(parsed.appServer!);
      }
    } catch {
      // Ignore stale or corrupted bridge state.
    }
  }

  return null;
}

function startWindowsDetachedProcess(
  command: string,
  args: string[],
  repoRoot: string,
  logPath: string,
  env: NodeJS.ProcessEnv = process.env,
): number | null {
  const ext = path.extname(command).toLowerCase();
  const stderrLogPath = stderrLogFilePath(logPath);
  const stdoutFd = fs.openSync(logPath, "a");
  const stderrFd = fs.openSync(stderrLogPath, "a");

  try {
    const child =
      ext === ".ps1"
        ? spawn(
            resolvePowerShellCommand(),
            ["-NoLogo", "-NoProfile", "-File", command, ...args],
            {
              cwd: repoRoot,
              detached: true,
              stdio: ["ignore", stdoutFd, stderrFd],
              env,
              windowsHide: true,
            },
          )
        : spawn(command, args, {
            cwd: repoRoot,
            detached: true,
            stdio: ["ignore", stdoutFd, stderrFd],
            env,
            windowsHide: true,
            shell: ext === ".cmd" || ext === ".bat",
          });

    child.unref();
    return child.pid ?? null;
  } finally {
    fs.closeSync(stdoutFd);
    fs.closeSync(stderrFd);
  }
}

function startWindowsCodexAppServer(
  command: string,
  url: string,
  repoRoot: string,
  logPath: string,
): number | null {
  return startWindowsDetachedProcess(
    command,
    ["app-server", "--listen", url],
    repoRoot,
    logPath,
  );
}

function findListeningProcessId(
  url: string,
  platform: Platform,
): number | null {
  if (platform !== "win32") {
    return null;
  }

  let port: number | null;
  try {
    const parsed = new URL(url);
    port = parsed.port ? Number.parseInt(parsed.port, 10) : null;
  } catch {
    return null;
  }

  if (port == null || !Number.isFinite(port)) {
    return null;
  }

  const result = spawnSync(
    resolvePowerShellCommand(),
    [
      "-NoLogo",
      "-NoProfile",
      "-Command",
      [
        `$port = ${port}`,
        "$processId = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty OwningProcess",
        "if ($processId) { $processId }",
      ].join("; "),
    ],
    {
      encoding: "utf-8",
      windowsHide: true,
    },
  );

  if (result.status !== 0) {
    return null;
  }

  const parsedPid = Number.parseInt((result.stdout ?? "").trim(), 10);
  return Number.isFinite(parsedPid) ? parsedPid : null;
}

export function resolveAppServerUrl(
  baseUrl: string | undefined,
  port?: number,
): string {
  const resolvedBase = (baseUrl ?? DEFAULT_APP_SERVER_URL).replace(/\/$/, "");
  if (port == null) {
    return resolvedBase;
  }

  try {
    const parsed = new URL(resolvedBase);
    parsed.port = String(port);
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return resolvedBase;
  }
}

export async function isTcpPortAvailable(
  hostname: string,
  port: number,
): Promise<boolean> {
  const bindHost = hostname === "localhost" ? "127.0.0.1" : hostname;
  return await new Promise<boolean>((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once("error", () => resolve(false));
    server.listen(port, bindHost, () => {
      server.close((error) => resolve(!error));
    });
  });
}

export async function findNextAvailableAppServerPort(
  state: TapState,
  baseUrl: string | undefined,
  basePort: number = 4501,
  excludeInstanceId?: InstanceId,
): Promise<number> {
  let hostname = "127.0.0.1";
  try {
    hostname = new URL(baseUrl ?? DEFAULT_APP_SERVER_URL).hostname;
  } catch {
    // Fall back to the default loopback host.
  }

  const maxAttempts = 1000;
  let port = basePort;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1, port += 1) {
    const claimedInState = Object.entries(state.instances).some(
      ([id, inst]) => id !== excludeInstanceId && inst.port === port,
    );
    if (claimedInState) {
      continue;
    }

    if (!isLoopbackHost(hostname)) {
      return port;
    }

    if (await isTcpPortAvailable(hostname, port)) {
      return port;
    }
  }

  throw new Error(
    `Failed to find a free app-server port starting at ${basePort}`,
  );
}

export async function checkAppServerHealth(
  url: string,
  timeoutMs: number = APP_SERVER_HEALTH_TIMEOUT_MS,
  gatewayToken?: string | null,
): Promise<boolean> {
  const WebSocket = getWebSocketCtor();
  if (!WebSocket) {
    return false;
  }

  return new Promise<boolean>((resolve) => {
    let settled = false;
    let socket: WebSocketLike | null = null;

    const finish = (healthy: boolean) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      try {
        socket?.close();
      } catch {
        // Best-effort cleanup only.
      }
      resolve(healthy);
    };

    const timer = setTimeout(() => finish(false), timeoutMs);

    try {
      // Authenticate via WebSocket subprotocol when a gateway token is provided.
      const protocols = gatewayToken
        ? [`${AUTH_SUBPROTOCOL_PREFIX}${gatewayToken}`]
        : undefined;
      socket = new WebSocket(url, protocols);
      socket.addEventListener("open", () => finish(true), { once: true });
      socket.addEventListener("error", () => finish(false), { once: true });
      socket.addEventListener("close", () => finish(false), { once: true });
    } catch {
      finish(false);
    }
  });
}

async function waitForAppServerHealth(
  url: string,
  timeoutMs: number,
  gatewayToken?: string | null,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (
      await checkAppServerHealth(
        url,
        APP_SERVER_HEALTH_TIMEOUT_MS,
        gatewayToken,
      )
    ) {
      return true;
    }
    await delay(APP_SERVER_HEALTH_RETRY_MS);
  }

  return false;
}

async function terminateProcess(
  pid: number,
  platform: Platform,
): Promise<boolean> {
  if (!isProcessAlive(pid)) {
    return false;
  }

  try {
    if (platform === "win32") {
      execSync(`taskkill /PID ${pid} /F /T`, { stdio: "pipe" });
    } else {
      process.kill(pid, "SIGTERM");
      await delay(2_000);
      if (isProcessAlive(pid)) {
        process.kill(pid, "SIGKILL");
      }
    }
  } catch {
    // Best effort. The caller only needs a boolean outcome.
  }

  return !isProcessAlive(pid);
}

export async function stopManagedAppServer(
  appServer: AppServerState,
  platform: Platform,
): Promise<boolean> {
  if (!appServer.managed) {
    return false;
  }

  let stopped = false;
  if (appServer.auth?.gatewayPid != null) {
    stopped =
      (await terminateProcess(appServer.auth.gatewayPid, platform)) || stopped;
  }
  if (appServer.pid != null) {
    stopped = (await terminateProcess(appServer.pid, platform)) || stopped;
  }
  removeFileIfExists(appServer.auth?.tokenPath);
  return stopped;
}

export async function ensureCodexAppServer(
  options: EnsureCodexAppServerOptions,
): Promise<AppServerState> {
  const effectiveUrl = resolveAppServerUrl(options.appServerUrl);
  const fallbackManualCommand = formatCodexAppServerCommand(
    "codex",
    effectiveUrl,
  );
  if (
    options.existingAppServer?.url === effectiveUrl &&
    canReuseManagedAppServer(options.existingAppServer)
  ) {
    return markAppServerHealthy(options.existingAppServer);
  }

  const sharedManaged = findReusableManagedAppServer(
    options.stateDir,
    effectiveUrl,
  );
  if (sharedManaged) {
    return sharedManaged;
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(effectiveUrl);
  } catch {
    throw new Error(
      `Invalid app-server URL: ${effectiveUrl}\nStart it manually:\n  ${fallbackManualCommand}`,
    );
  }

  if (!isLoopbackHost(parsedUrl.hostname)) {
    throw new Error(
      `Auto-start only supports loopback app-server URLs. Current URL: ${effectiveUrl}\nStart it manually:\n  ${fallbackManualCommand}`,
    );
  }

  if (await checkAppServerHealth(effectiveUrl)) {
    const hint = options.noAuth
      ? "Stop it first or use --no-server for an unmanaged external app-server."
      : "A listener is already running, so tap cannot insert the auth gateway there.\nStop it first or use --no-server for an unmanaged external app-server.";
    throw new Error(`${effectiveUrl}: ${hint}`);
  }

  const resolvedCommand = resolveCodexCommand(options.platform);
  if (!resolvedCommand) {
    throw new Error(
      `Codex CLI not found in PATH.\nStart the app-server manually:\n  ${fallbackManualCommand}`,
    );
  }

  const logPath = appServerLogFilePath(options.stateDir, options.instanceId);
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  rotateLog(logPath);

  // --no-auth: start app-server directly on the public URL (no gateway).
  // TUI and bridge both connect to the same port without token auth.
  if (options.noAuth) {
    const manualCommand = formatCodexAppServerCommand("codex", effectiveUrl);
    let pid: number | null;

    if (options.platform === "win32") {
      try {
        pid = startWindowsCodexAppServer(
          resolvedCommand,
          effectiveUrl,
          options.repoRoot,
          logPath,
        );
      } catch (err) {
        throw new Error(
          `Failed to spawn Codex app-server: ${err instanceof Error ? err.message : String(err)}\nStart it manually:\n  ${manualCommand}`,
          { cause: err },
        );
      }
    } else {
      const logFd = fs.openSync(logPath, "a");
      try {
        const child = spawn(
          resolvedCommand,
          ["app-server", "--listen", effectiveUrl],
          {
            cwd: options.repoRoot,
            detached: true,
            stdio: ["ignore", logFd, logFd],
            env: process.env,
            windowsHide: true,
          },
        );
        child.unref();
        pid = child.pid ?? null;
      } catch (err) {
        throw new Error(
          `Failed to spawn Codex app-server: ${err instanceof Error ? err.message : String(err)}\nStart it manually:\n  ${manualCommand}`,
          { cause: err },
        );
      } finally {
        fs.closeSync(logFd);
      }
    }

    if (pid == null) {
      throw new Error(
        `Failed to spawn Codex app-server.\nStart it manually:\n  ${manualCommand}`,
      );
    }

    const healthy = await waitForAppServerHealth(
      effectiveUrl,
      APP_SERVER_START_TIMEOUT_MS,
    );
    if (!healthy) {
      await terminateProcess(pid, options.platform);
      throw new Error(
        `Codex app-server did not become healthy at ${effectiveUrl}.\nCheck ${logPath}\nOr start it manually:\n  ${manualCommand}`,
      );
    }

    pid = findListeningProcessId(effectiveUrl, options.platform) ?? pid;
    const healthyAt = new Date().toISOString();
    return {
      url: effectiveUrl,
      pid,
      managed: true,
      healthy: true,
      lastCheckedAt: healthyAt,
      lastHealthyAt: healthyAt,
      logPath,
      manualCommand,
      auth: null,
    };
  }

  // Default: auth gateway mode — gateway on publicUrl, app-server on random upstream port
  const auth = await createManagedAppServerAuth({
    instanceId: options.instanceId,
    stateDir: options.stateDir,
    repoRoot: options.repoRoot,
    platform: options.platform,
    publicUrl: effectiveUrl,
  });
  const manualCommand = formatCodexAppServerCommand("codex", auth.upstreamUrl);

  let pid: number | null;

  if (options.platform === "win32") {
    try {
      pid = startWindowsCodexAppServer(
        resolvedCommand,
        auth.upstreamUrl,
        options.repoRoot,
        logPath,
      );
    } catch (err) {
      if (auth.gatewayPid != null) {
        await terminateProcess(auth.gatewayPid, options.platform);
      }
      removeFileIfExists(auth.tokenPath);
      throw new Error(
        `Failed to spawn Codex app-server: ${err instanceof Error ? err.message : String(err)}\nStart it manually:\n  ${manualCommand}`,
        { cause: err },
      );
    }
  } else {
    const logFd = fs.openSync(logPath, "a");

    try {
      const child = spawn(
        resolvedCommand,
        ["app-server", "--listen", auth.upstreamUrl],
        {
          cwd: options.repoRoot,
          detached: true,
          stdio: ["ignore", logFd, logFd],
          env: process.env,
          windowsHide: true,
        },
      );

      child.unref();
      pid = child.pid ?? null;
    } catch (err) {
      if (auth.gatewayPid != null) {
        await terminateProcess(auth.gatewayPid, options.platform);
      }
      removeFileIfExists(auth.tokenPath);
      throw new Error(
        `Failed to spawn Codex app-server: ${err instanceof Error ? err.message : String(err)}\nStart it manually:\n  ${manualCommand}`,
        { cause: err },
      );
    } finally {
      fs.closeSync(logFd);
    }
  }

  if (pid == null) {
    if (auth.gatewayPid != null) {
      await terminateProcess(auth.gatewayPid, options.platform);
    }
    removeFileIfExists(auth.tokenPath);
    throw new Error(
      `Failed to spawn Codex app-server.\nStart it manually:\n  ${manualCommand}`,
    );
  }

  const healthy = await waitForAppServerHealth(
    auth.upstreamUrl,
    APP_SERVER_START_TIMEOUT_MS,
  );

  if (!healthy) {
    await terminateProcess(pid, options.platform);
    if (auth.gatewayPid != null) {
      await terminateProcess(auth.gatewayPid, options.platform);
    }
    removeFileIfExists(auth.tokenPath);
    throw new Error(
      `Codex app-server did not become healthy at ${auth.upstreamUrl}.\nCheck ${logPath}\nOr start it manually:\n  ${manualCommand}`,
    );
  }

  const gatewayToken = readGatewayToken(auth);
  if (!gatewayToken) {
    await terminateProcess(pid, options.platform);
    if (auth.gatewayPid != null) {
      await terminateProcess(auth.gatewayPid, options.platform);
    }
    removeFileIfExists(auth.tokenPath);
    throw new Error("Tap auth gateway token is missing after startup.");
  }

  const gatewayHealthy = await waitForAppServerHealth(
    effectiveUrl,
    APP_SERVER_GATEWAY_START_TIMEOUT_MS,
    gatewayToken,
  );
  if (!gatewayHealthy) {
    await terminateProcess(pid, options.platform);
    if (auth.gatewayPid != null) {
      await terminateProcess(auth.gatewayPid, options.platform);
    }
    removeFileIfExists(auth.tokenPath);
    throw new Error(
      `Tap auth gateway did not become healthy at ${effectiveUrl}.\nCheck ${auth.gatewayLogPath ?? "the gateway log"} and ${logPath}.`,
    );
  }

  const healthyAt = new Date().toISOString();
  pid = findListeningProcessId(auth.upstreamUrl, options.platform) ?? pid;
  return {
    url: effectiveUrl,
    pid,
    managed: true,
    healthy: true,
    lastCheckedAt: healthyAt,
    lastHealthyAt: healthyAt,
    logPath,
    manualCommand,
    auth,
  };
}

function pidFilePath(stateDir: string, instanceId: InstanceId): string {
  return path.join(stateDir, "pids", `bridge-${instanceId}.json`);
}

function logFilePath(stateDir: string, instanceId: InstanceId): string {
  return path.join(stateDir, "logs", `bridge-${instanceId}.log`);
}

function runtimeHeartbeatFilePath(runtimeStateDir: string): string {
  return path.join(runtimeStateDir, "heartbeat.json");
}

function loadRuntimeHeartbeatTimestamp(
  runtimeStateDir: string | null | undefined,
): string | null {
  if (!runtimeStateDir) {
    return null;
  }

  const heartbeatPath = runtimeHeartbeatFilePath(runtimeStateDir);
  if (!fs.existsSync(heartbeatPath)) {
    return null;
  }

  try {
    const raw = fs.readFileSync(heartbeatPath, "utf-8");
    const parsed = JSON.parse(raw) as { updatedAt?: string };
    return typeof parsed.updatedAt === "string" ? parsed.updatedAt : null;
  } catch {
    return null;
  }
}

function resolveHeartbeatTimestamp(
  state: BridgeState | null | undefined,
): string | null {
  return (
    loadRuntimeHeartbeatTimestamp(state?.runtimeStateDir) ??
    state?.lastHeartbeat ??
    null
  );
}

export function loadBridgeState(
  stateDir: string,
  instanceId: InstanceId,
): BridgeState | null {
  const pidPath = pidFilePath(stateDir, instanceId);
  if (!fs.existsSync(pidPath)) return null;

  try {
    const raw = fs.readFileSync(pidPath, "utf-8");
    return JSON.parse(raw) as BridgeState;
  } catch {
    return null;
  }
}

export function saveBridgeState(
  stateDir: string,
  instanceId: InstanceId,
  state: BridgeState,
): void {
  const pidPath = pidFilePath(stateDir, instanceId);
  const serializable = JSON.parse(JSON.stringify(state)) as BridgeState & {
    appServer?: { auth?: { token?: string } | null } | null;
  };
  if (serializable.appServer?.auth) {
    delete serializable.appServer.auth.token;
  }
  writeProtectedTextFile(pidPath, JSON.stringify(serializable, null, 2));
}

export function clearBridgeState(
  stateDir: string,
  instanceId: InstanceId,
): void {
  const pidPath = pidFilePath(stateDir, instanceId);
  if (fs.existsSync(pidPath)) {
    fs.unlinkSync(pidPath);
  }
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function isBridgeRunning(
  stateDir: string,
  instanceId: InstanceId,
): boolean {
  const state = loadBridgeState(stateDir, instanceId);
  if (!state) return false;
  return isProcessAlive(state.pid);
}

// ─── Testable helpers (extracted for unit testing) ─────────────

/**
 * Resolve agent name: explicit > state.json > env.
 * Exported for direct testing without spawning a process.
 */
export function resolveAgentName(
  instanceId: InstanceId,
  explicit?: string,
  context?: { repoRoot?: string; stateDir?: string },
): string | null {
  if (explicit) return explicit;

  // state.json SSOT (#784 backwrite)
  try {
    const repoRoot =
      context?.repoRoot ??
      context?.stateDir?.replace(/[\\/].tap-comms$/, "") ??
      process.cwd();
    const state = loadState(repoRoot);
    const stateAgent = state?.instances[instanceId]?.agentName;
    if (stateAgent) return stateAgent;
  } catch {
    // state read failed — fall through
  }

  return process.env.TAP_AGENT_NAME || process.env.CODEX_TAP_AGENT_NAME || null;
}

/**
 * Infer restart mode from current bridge/instance state.
 * Priority: explicit flags > saved instance mode > bridge state inference > defaults.
 */
export function inferRestartMode(
  bridgeState: BridgeState | null,
  flags?: { noServer?: boolean; noAuth?: boolean },
  savedMode?: { manageAppServer?: boolean; noAuth?: boolean },
): { manageAppServer: boolean; noAuth: boolean } {
  const wasManaged = bridgeState?.appServer != null;
  const hadAuth = bridgeState?.appServer?.auth != null;

  const manageAppServer =
    flags?.noServer === true
      ? false
      : flags?.noServer === undefined
        ? (savedMode?.manageAppServer ?? wasManaged)
        : true;
  const noAuth =
    flags?.noAuth === true
      ? true
      : flags?.noAuth === undefined
        ? (savedMode?.noAuth ?? !hadAuth)
        : false;

  return { manageAppServer, noAuth };
}

/**
 * Clean up headless dispatch files from inbox.
 * Matches YYYYMMDD-headless-{agent}-review-PR{n}.md pattern.
 */
export function cleanupHeadlessDispatch(
  inboxDir: string,
  agentName: string,
): string[] {
  const removed: string[] = [];
  if (!fs.existsSync(inboxDir)) return removed;

  const normalizedAgent = agentName.replace(/-/g, "_");
  const marker = `-headless-${normalizedAgent}-review-`;

  try {
    for (const file of fs.readdirSync(inboxDir)) {
      if (file.includes(marker)) {
        fs.unlinkSync(path.join(inboxDir, file));
        removed.push(file);
      }
    }
  } catch {
    // best-effort
  }

  return removed;
}

export async function startBridge(
  options: BridgeStartOptions,
): Promise<BridgeState> {
  const {
    instanceId,
    runtime,
    stateDir,
    commsDir,
    bridgeScript,
    agentName,
    port,
  } = options;

  const resolvedAgent = resolveAgentName(instanceId, agentName, {
    repoRoot: options.repoRoot,
    stateDir,
  });

  if (!resolvedAgent) {
    throw new Error(
      `No agent name for ${instanceId} bridge. ` +
        `Set TAP_AGENT_NAME env var or pass --agent-name flag.`,
    );
  }

  // Check if already running
  if (isBridgeRunning(stateDir, instanceId)) {
    const existing = loadBridgeState(stateDir, instanceId)!;
    throw new Error(
      `Bridge for ${instanceId} is already running (PID: ${existing.pid})`,
    );
  }

  const previousBridgeState = loadBridgeState(stateDir, instanceId);
  const previousAppServer = previousBridgeState?.appServer ?? null;

  // Clear stale PID
  clearBridgeState(stateDir, instanceId);

  const logPath = logFilePath(stateDir, instanceId);
  fs.mkdirSync(path.dirname(logPath), { recursive: true });

  // Log rotation: rename existing log to .prev
  rotateLog(logPath);

  let logFd: number | null = null;

  // Use explicit repoRoot (not derived from stateDir — stateDir may be external)
  const repoRoot = options.repoRoot ?? path.resolve(stateDir, "..");
  const runtimeStateDir = getBridgeRuntimeStateDir(repoRoot, instanceId);
  const resolved = resolveNodeRuntime(
    options.runtimeCommand ?? "node",
    repoRoot,
  );
  const command = resolved.command;

  // Build env with fnm Node prepended to PATH so the bridge runner's
  // 2nd-stage spawn also finds the correct Node (결 finding: 2-stage spawn)
  const runtimeEnv = buildRuntimeEnv(repoRoot);
  const effectiveAppServerUrl = resolveAppServerUrl(options.appServerUrl, port);
  let appServer: AppServerState | null = null;
  let bridgeAppServerUrl = effectiveAppServerUrl;

  if (runtime === "codex" && options.manageAppServer) {
    appServer = await ensureCodexAppServer({
      instanceId,
      stateDir,
      repoRoot,
      platform: options.platform,
      appServerUrl: effectiveAppServerUrl,
      existingAppServer: previousAppServer,
      noAuth: options.noAuth,
    });
    if (appServer.auth) {
      appServer = {
        ...appServer,
        auth: materializeGatewayTokenFile(
          stateDir,
          instanceId,
          effectiveAppServerUrl,
          appServer.auth,
        ),
      };
    }
    bridgeAppServerUrl = effectiveAppServerUrl;
  }

  // Spawn detached process — pass both command and strip-types metadata
  // so the runner doesn't re-guess (avoids bun + --experimental-strip-types)
  try {
    const bridgeEnv = {
      ...runtimeEnv,
      TAP_COMMS_DIR: commsDir,
      TAP_STATE_DIR: runtimeStateDir,
      TAP_BRIDGE_RUNTIME: runtime,
      TAP_BRIDGE_INSTANCE_ID: instanceId,
      TAP_AGENT_ID: instanceId,
      TAP_AGENT_NAME: resolvedAgent,
      CODEX_TAP_AGENT_NAME: resolvedAgent,
      TAP_RESOLVED_NODE: resolved.command,
      TAP_STRIP_TYPES: resolved.supportsStripTypes ? "1" : "0",
      ...(bridgeAppServerUrl
        ? { CODEX_APP_SERVER_URL: bridgeAppServerUrl }
        : {}),
      ...(appServer?.auth?.tokenPath
        ? { TAP_GATEWAY_TOKEN_FILE: appServer.auth.tokenPath }
        : {}),
      ...(port != null ? { TAP_BRIDGE_PORT: String(port) } : {}),
      ...(options.headless?.enabled
        ? {
            TAP_HEADLESS: "true",
            TAP_AGENT_ROLE: options.headless.role,
            TAP_MAX_REVIEW_ROUNDS: String(options.headless.maxRounds),
            TAP_QUALITY_FLOOR: options.headless.qualitySeverityFloor,
          }
        : {}),
      ...(options.busyMode ? { TAP_BUSY_MODE: options.busyMode } : {}),
      ...(options.pollSeconds != null
        ? { TAP_POLL_SECONDS: String(options.pollSeconds) }
        : {}),
      ...(options.reconnectSeconds != null
        ? { TAP_RECONNECT_SECONDS: String(options.reconnectSeconds) }
        : {}),
      ...(options.messageLookbackMinutes != null
        ? {
            TAP_MESSAGE_LOOKBACK_MINUTES: String(
              options.messageLookbackMinutes,
            ),
          }
        : {}),
      ...(options.threadId ? { TAP_THREAD_ID: options.threadId } : {}),
      ...(options.ephemeral ? { TAP_EPHEMERAL: "true" } : {}),
      ...(options.processExistingMessages
        ? { TAP_PROCESS_EXISTING: "true" }
        : {}),
    };

    let bridgePid: number | null = null;

    if (options.platform === "win32") {
      bridgePid = startWindowsDetachedProcess(
        command,
        [bridgeScript],
        repoRoot,
        logPath,
        bridgeEnv,
      );
    } else {
      logFd = fs.openSync(logPath, "a");
      const child = spawn(command, [bridgeScript], {
        detached: true,
        stdio: ["ignore", logFd, logFd],
        env: bridgeEnv,
        windowsHide: true,
      });

      child.unref();
      bridgePid = child.pid ?? null;
    }

    if (logFd != null) {
      fs.closeSync(logFd);
      logFd = null;
    }

    if (!bridgePid) {
      throw new Error(`Failed to spawn bridge process for ${instanceId}`);
    }

    const state: BridgeState = {
      pid: bridgePid,
      statePath: pidFilePath(stateDir, instanceId),
      lastHeartbeat: new Date().toISOString(),
      appServer,
      runtimeStateDir,
    };

    saveBridgeState(stateDir, instanceId, state);

    // NOTE: Heartbeat updates are the bridge process's responsibility.
    // The bridge script should periodically write to the PID file's lastHeartbeat field.
    // CLI only records the initial heartbeat at spawn time.

    return state;
  } catch (err) {
    if (logFd != null) {
      try {
        fs.closeSync(logFd);
      } catch {
        // Best-effort cleanup only.
      }
    }
    if (appServer?.managed) {
      await stopManagedAppServer(appServer, options.platform);
    }
    throw err;
  }
}

export async function stopBridge(options: BridgeStopOptions): Promise<boolean> {
  const { instanceId, stateDir, platform } = options;
  const state = loadBridgeState(stateDir, instanceId);

  if (!state) {
    return false; // No PID file
  }

  if (!isProcessAlive(state.pid)) {
    clearBridgeState(stateDir, instanceId);
    return false; // Already dead
  }

  try {
    await terminateProcess(state.pid, platform);
  } catch {
    // Process may have already exited
  }

  clearBridgeState(stateDir, instanceId);
  return true;
}

// ─── Graceful restart ──────────────────────────────────────────

export interface RestartBridgeOptions extends BridgeStartOptions {
  /** Max seconds to wait for active turn to complete before killing. Default: 30 */
  drainTimeoutSeconds?: number;
}

/**
 * Graceful bridge restart: wait for active turn → cleanup → stop → start.
 * Prevents message loss during restart by draining active work first
 * and replaying unprocessed messages on the new instance.
 *
 * For headless instances: drain phase cleans up headless dispatch files
 * to prevent the new bridge from re-injecting completed review requests.
 * (별 finding: eager marking + replay collision)
 */
export async function restartBridge(
  options: RestartBridgeOptions,
): Promise<BridgeState> {
  const { instanceId, stateDir, platform } = options;
  const drainTimeout = (options.drainTimeoutSeconds ?? 30) * 1000;
  const repoRoot = options.repoRoot ?? stateDir.replace(/[\\/].tap-comms$/, "");

  // Phase 1: Drain — wait for active turn to complete
  const runtimeStateDir = getBridgeRuntimeStateDir(repoRoot, instanceId);
  const heartbeatPath = path.join(runtimeStateDir, "heartbeat.json");

  if (fs.existsSync(heartbeatPath)) {
    const startWait = Date.now();
    while (Date.now() - startWait < drainTimeout) {
      try {
        const hb = JSON.parse(fs.readFileSync(heartbeatPath, "utf-8"));
        if (!hb.activeTurnId) break; // No active turn — safe to stop
      } catch {
        break; // Can't read heartbeat — proceed with stop
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  // Phase 1.5: Clean up headless dispatch files (uses extracted helper)
  if (options.headless?.enabled && options.commsDir) {
    const agentName = options.agentName ?? instanceId;
    cleanupHeadlessDispatch(path.join(options.commsDir, "inbox"), agentName);
  }

  // Phase 2: Stop existing bridge
  await stopBridge({ instanceId, stateDir, platform });

  // Phase 3: Start new bridge with --process-existing-messages
  // This replays any messages that arrived during drain/restart
  const restartOptions: BridgeStartOptions = {
    ...options,
    processExistingMessages: true,
  };

  return startBridge(restartOptions);
}

// ─── Log rotation ──────────────────────────────────────────────

export function rotateLog(logPath: string): void {
  if (!fs.existsSync(logPath)) return;
  try {
    const stats = fs.statSync(logPath);
    if (stats.size === 0) return;
    const prevPath = `${logPath}.prev`;
    fs.renameSync(logPath, prevPath);
  } catch {
    // Best-effort: don't fail bridge start if rotation fails
  }
}

// ─── Heartbeat ─────────────────────────────────────────────────

/**
 * Update the heartbeat timestamp for a running bridge.
 * Bridge processes should call this periodically.
 *
 * Only the owning process (matching PID) can update the heartbeat.
 * This prevents state dir collision when multiple writers exist.
 * See: 묵 finding — bridge-heartbeat-state-dir-collision
 */
export function updateBridgeHeartbeat(
  stateDir: string,
  instanceId: InstanceId,
): void {
  const state = loadBridgeState(stateDir, instanceId);
  if (!state) return;

  // Guard: only the owning process may update heartbeat
  if (state.pid !== process.pid) return;

  state.lastHeartbeat = new Date().toISOString();
  saveBridgeState(stateDir, instanceId, state);
}

/**
 * Get heartbeat age in seconds. Returns null if no state or no heartbeat.
 */
export function getHeartbeatAge(
  stateDir: string,
  instanceId: InstanceId,
): number | null {
  const state = loadBridgeState(stateDir, instanceId);
  const heartbeat = resolveHeartbeatTimestamp(state);
  if (!heartbeat) return null;
  const heartbeatTime = new Date(heartbeat).getTime();
  if (isNaN(heartbeatTime)) return null;
  return Math.floor((Date.now() - heartbeatTime) / 1000);
}

export function getBridgeHeartbeatTimestamp(
  stateDir: string,
  instanceId: InstanceId,
): string | null {
  return resolveHeartbeatTimestamp(loadBridgeState(stateDir, instanceId));
}

export function getBridgeStatus(
  stateDir: string,
  instanceId: InstanceId,
): "running" | "stopped" | "stale" {
  const state = loadBridgeState(stateDir, instanceId);
  if (!state) return "stopped";

  // Primary check: is the process actually alive?
  if (!isProcessAlive(state.pid)) {
    clearBridgeState(stateDir, instanceId);
    return "stale";
  }

  // Process is alive → running.
  // Heartbeat staleness is informational only — the bridge process
  // is responsible for updating lastHeartbeat. If it doesn't,
  // PID alive is still the authoritative signal.
  return "running";
}
