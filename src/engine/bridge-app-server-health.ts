import * as net from "node:net";
import type { AppServerState } from "../types.js";
import { getWebSocketCtor, delay } from "./bridge-port-network.js";

export interface WebSocketLike {
  addEventListener(
    type: "open" | "error" | "close",
    listener: () => void,
    options?: { once?: boolean },
  ): void;
  close(code?: number, reason?: string): void;
}

export type WebSocketCtor = new (
  url: string,
  protocols?: string | string[],
) => WebSocketLike;

export const APP_SERVER_HEALTH_TIMEOUT_MS = 1_500;
export const APP_SERVER_HEALTH_RETRY_MS = 250;
export const APP_SERVER_READYZ_PATH = "/readyz";

export const AUTH_SUBPROTOCOL_PREFIX = "tap-auth-";

export type AppServerReadyzStatus = "ready" | "not-ready" | "unsupported";

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

export async function waitForAppServerHealth(
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

export function buildAppServerReadyzUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  if (parsed.protocol === "ws:") {
    parsed.protocol = "http:";
  } else if (parsed.protocol === "wss:") {
    parsed.protocol = "https:";
  } else if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return null;
  }

  parsed.pathname = APP_SERVER_READYZ_PATH;
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString();
}

export async function checkAppServerReadyz(
  url: string,
  timeoutMs: number = APP_SERVER_HEALTH_TIMEOUT_MS,
): Promise<AppServerReadyzStatus> {
  const readyzUrl = buildAppServerReadyzUrl(url);
  if (!readyzUrl) {
    return "unsupported";
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(readyzUrl, {
      method: "GET",
      signal: controller.signal,
      headers: {
        accept: "application/json",
      },
    });

    if (response.ok) {
      return "ready";
    }

    if (
      response.status === 400 ||
      response.status === 404 ||
      response.status === 405 ||
      response.status === 426 ||
      response.status === 501
    ) {
      return "unsupported";
    }

    return "not-ready";
  } catch {
    return "not-ready";
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Check if a TCP port is accepting connections (without WebSocket upgrade).
 * Use this for managed startup health checks to avoid creating app-server sessions.
 */
export async function checkTcpPortListening(
  url: string,
  timeoutMs: number = APP_SERVER_HEALTH_TIMEOUT_MS,
): Promise<boolean> {
  let hostname: string;
  let port: number;
  try {
    const parsed = new URL(url.replace(/^ws/, "http"));
    hostname = parsed.hostname;
    port = parseInt(parsed.port, 10);
  } catch {
    return false;
  }
  if (!port || !Number.isFinite(port)) return false;

  return new Promise<boolean>((resolve) => {
    const socket = net.createConnection({ host: hostname, port });
    const timer = setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, timeoutMs);

    socket.once("connect", () => {
      clearTimeout(timer);
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => {
      clearTimeout(timer);
      socket.destroy();
      resolve(false);
    });
  });
}

/**
 * Wait for a TCP port to start accepting connections.
 * Does NOT open a WebSocket, so no app-server session is created.
 */
export async function waitForTcpPortListening(
  url: string,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (await checkTcpPortListening(url, APP_SERVER_HEALTH_TIMEOUT_MS)) {
      return true;
    }
    await delay(APP_SERVER_HEALTH_RETRY_MS);
  }

  return false;
}

export async function checkManagedAppServerReady(
  url: string,
  timeoutMs: number = APP_SERVER_HEALTH_TIMEOUT_MS,
): Promise<boolean> {
  const readyzStatus = await checkAppServerReadyz(url, timeoutMs);
  if (readyzStatus === "ready") {
    return true;
  }

  if (readyzStatus === "unsupported") {
    return checkTcpPortListening(url, timeoutMs);
  }

  return false;
}

export async function waitForManagedAppServerReady(
  url: string,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const remaining = Math.max(
      1,
      Math.min(APP_SERVER_HEALTH_TIMEOUT_MS, deadline - Date.now()),
    );
    if (await checkManagedAppServerReady(url, remaining)) {
      return true;
    }
    await delay(APP_SERVER_HEALTH_RETRY_MS);
  }

  return false;
}

export function markAppServerHealthy(
  appServer: AppServerState,
): AppServerState {
  const checkedAt = new Date().toISOString();
  return {
    ...appServer,
    healthy: true,
    lastCheckedAt: checkedAt,
    lastHealthyAt: checkedAt,
  };
}
