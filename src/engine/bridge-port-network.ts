import * as net from "node:net";
import type { TapState, InstanceId } from "../types.js";

const DEFAULT_APP_SERVER_URL = "ws://127.0.0.1:4501";

interface WebSocketLike {
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

export function getWebSocketCtor(): WebSocketCtor | null {
  const candidate = (globalThis as { WebSocket?: unknown }).WebSocket;
  return typeof candidate === "function" ? (candidate as WebSocketCtor) : null;
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isLoopbackHost(hostname: string): boolean {
  return hostname === "127.0.0.1" || hostname === "localhost";
}

export async function allocateLoopbackPort(hostname: string): Promise<number> {
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

/**
 * Wait for a TCP port to become available after a process is stopped.
 * Polls isTcpPortAvailable at intervals until the port is free or timeout.
 * Returns true if the port was released, false if timeout expired.
 */
export async function waitForPortRelease(
  url: string,
  timeoutMs: number = 10_000,
  intervalMs: number = 500,
): Promise<boolean> {
  let hostname: string;
  let port: number;
  try {
    const parsed = new URL(url);
    hostname = parsed.hostname;
    port = parseInt(parsed.port, 10);
  } catch {
    return true; // Can't parse URL — assume port is free
  }

  if (!port || !Number.isFinite(port)) return true;

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isTcpPortAvailable(hostname, port)) {
      return true;
    }
    await delay(intervalMs);
  }
  return false;
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
