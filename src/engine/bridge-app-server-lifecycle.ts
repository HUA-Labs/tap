import * as fs from "node:fs";
import * as path from "node:path";
import type {
  InstanceId,
  BridgeState,
  AppServerState,
  Platform,
} from "../types.js";

import { appServerLogFilePath } from "./bridge-paths.js";
import { removeFileIfExists } from "./bridge-file-io.js";
import { isLoopbackHost } from "./bridge-port-network.js";
import { resolveCodexCommand } from "./bridge-codex-command.js";
import {
  startWindowsCodexAppServer,
  findListeningProcessId,
} from "./bridge-windows-spawn.js";
import {
  startUnixCodexAppServer,
  findUnixListeningProcessId,
} from "./bridge-unix-spawn.js";
import { terminateProcess, isProcessAlive } from "./bridge-process-control.js";
import {
  checkAppServerHealth,
  waitForAppServerHealth,
  markAppServerHealthy,
} from "./bridge-app-server-health.js";
import {
  readGatewayToken,
  createManagedAppServerAuth,
  canReuseManagedAppServer,
} from "./bridge-app-server-auth.js";
import { rotateLog } from "./bridge-observability.js";

export interface EnsureCodexAppServerOptions {
  instanceId: InstanceId;
  stateDir: string;
  repoRoot: string;
  platform: Platform;
  appServerUrl: string;
  existingAppServer?: AppServerState | null;
  noAuth?: boolean;
}

export const DEFAULT_APP_SERVER_URL = "ws://127.0.0.1:4501";
export const APP_SERVER_START_TIMEOUT_MS = 20_000;
export const APP_SERVER_GATEWAY_START_TIMEOUT_MS = 5_000;

/**
 * Check if any OTHER running bridge is using the same managed app-server.
 * Used to prevent killing a shared app-server when one bridge fails to start.
 */
export function isAppServerUsedByOtherBridge(
  stateDir: string,
  excludeInstanceId: InstanceId,
  appServer: AppServerState,
): boolean {
  const pidDir = path.join(stateDir, "pids");
  if (!fs.existsSync(pidDir)) return false;

  for (const name of fs.readdirSync(pidDir)) {
    if (!name.startsWith("bridge-") || !name.endsWith(".json")) continue;
    const otherId = name.slice("bridge-".length, -".json".length);
    if (otherId === excludeInstanceId) continue;

    try {
      const raw = fs.readFileSync(path.join(pidDir, name), "utf-8");
      const state = JSON.parse(raw) as BridgeState;
      if (
        state.appServer?.url === appServer.url &&
        state.appServer?.pid === appServer.pid &&
        isProcessAlive(state.pid)
      ) {
        return true;
      }
    } catch {
      continue;
    }
  }
  return false;
}

export function findReusableManagedAppServer(
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
      try {
        pid = startUnixCodexAppServer(
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

    pid =
      (options.platform === "win32"
        ? findListeningProcessId(effectiveUrl, options.platform)
        : findUnixListeningProcessId(effectiveUrl, options.platform)) ?? pid;
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
    try {
      pid = startUnixCodexAppServer(
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
  pid =
    (options.platform === "win32"
      ? findListeningProcessId(auth.upstreamUrl, options.platform)
      : findUnixListeningProcessId(auth.upstreamUrl, options.platform)) ?? pid;
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

export function formatCodexAppServerCommand(
  command: string,
  url: string,
): string {
  return `${command} app-server --listen ${url}`;
}
