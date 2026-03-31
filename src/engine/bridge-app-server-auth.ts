import * as fs from "node:fs";
import * as path from "node:path";
import { randomBytes } from "node:crypto";
import type {
  InstanceId,
  AppServerState,
  AppServerAuthState,
  Platform,
} from "../types.js";
import { resolveNodeRuntime, buildRuntimeEnv } from "../runtime/index.js";
import {
  appServerGatewayTokenFilePath,
  appServerGatewayLogFilePath,
} from "./bridge-paths.js";
import {
  writeProtectedTextFile,
  removeFileIfExists,
} from "./bridge-file-io.js";
import { allocateLoopbackPort } from "./bridge-port-network.js";
import { resolveAuthGatewayScript } from "./bridge-codex-command.js";
import { isProcessAlive } from "./bridge-process-control.js";
import { startWindowsDetachedProcess } from "./bridge-windows-spawn.js";
import { startUnixDetachedProcess } from "./bridge-unix-spawn.js";
import { rotateLog } from "./bridge-observability.js";
import {
  checkAppServerHealth,
  waitForAppServerHealth,
} from "./bridge-app-server-health.js";

export { AUTH_SUBPROTOCOL_PREFIX } from "./bridge-app-server-health.js";

interface ManagedAppServerGatewayOptions {
  instanceId: InstanceId;
  stateDir: string;
  repoRoot: string;
  platform: Platform;
  publicUrl: string;
}

export function buildProtectedAppServerUrl(
  publicUrl: string,
  _token: string,
): string {
  // Subprotocol auth: token is no longer embedded in the URL.
  // Kept for backward compatibility with state display — shows base URL only.
  return publicUrl;
}

export function readGatewayTokenFromPath(tokenPath: string): string {
  return fs.readFileSync(tokenPath, "utf8").trim();
}

export function readGatewayToken(
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

export function materializeGatewayTokenFile(
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

export async function createManagedAppServerAuth(
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
  try {
    gatewayPid =
      options.platform === "win32"
        ? startWindowsDetachedProcess(
            runtime.command,
            gatewayArgs,
            options.repoRoot,
            gatewayLogPath,
            gatewayEnv,
          )
        : startUnixDetachedProcess(
            runtime.command,
            gatewayArgs,
            options.repoRoot,
            gatewayLogPath,
            gatewayEnv,
            options.platform,
          );
  } catch (error) {
    removeFileIfExists(tokenPath);
    throw error;
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

export function canReuseManagedAppServer(
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

export { checkAppServerHealth, waitForAppServerHealth };
