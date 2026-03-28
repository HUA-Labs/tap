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

export const AUTH_SUBPROTOCOL_PREFIX = "tap-auth-";

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
      await checkAppServerHealth(url, APP_SERVER_HEALTH_TIMEOUT_MS, gatewayToken)
    ) {
      return true;
    }
    await delay(APP_SERVER_HEALTH_RETRY_MS);
  }

  return false;
}

export function markAppServerHealthy(appServer: AppServerState): AppServerState {
  const checkedAt = new Date().toISOString();
  return {
    ...appServer,
    healthy: true,
    lastCheckedAt: checkedAt,
    lastHealthyAt: checkedAt,
  };
}
