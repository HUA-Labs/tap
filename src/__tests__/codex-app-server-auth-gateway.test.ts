import { afterEach, describe, expect, it, vi } from "vitest";
import * as http from "node:http";
import {
  APP_SERVER_READYZ_PATH,
} from "../engine/bridge-app-server-health.js";
import {
  GATEWAY_READYZ_PATH,
  startGatewayServer,
  type GatewayRuntime,
} from "../bridges/codex-app-server-auth-gateway.js";

vi.mock("ws", async () => {
  const { EventEmitter } = await import("node:events");

  class FakeWebSocket extends EventEmitter {
    static readonly OPEN = 1;
    static readonly CLOSING = 2;
    static readonly CLOSED = 3;
    readonly readyState = FakeWebSocket.OPEN;

    send(): void {}
    close(): void {}
  }

  class FakeWebSocketServer extends EventEmitter {
    handleUpgrade(
      _request: unknown,
      _socket: unknown,
      _head: Buffer,
      callback: (socket: FakeWebSocket, request: unknown) => void,
    ): void {
      callback(new FakeWebSocket(), {});
    }

    close(callback?: () => void): void {
      callback?.();
    }
  }

  return {
    WebSocket: FakeWebSocket,
    WebSocketServer: FakeWebSocketServer,
  };
});

let upstreamServer: http.Server | null = null;
let gatewayRuntime: GatewayRuntime | null = null;

function closeServer(server: http.Server): Promise<void> {
  return new Promise((resolvePromise, rejectPromise) => {
    server.close((error) => {
      if (error) {
        rejectPromise(error);
        return;
      }
      resolvePromise();
    });
  });
}

async function listen(server: http.Server, port: number = 0): Promise<number> {
  await new Promise<void>((resolvePromise) => {
    server.listen(port, "127.0.0.1", () => resolvePromise());
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("failed to resolve listening port");
  }
  return address.port;
}

async function reservePort(): Promise<number> {
  const server = http.createServer();
  const port = await listen(server);
  await closeServer(server);
  return port;
}

async function startUpstreamReadyzServer(statusCode: number): Promise<number> {
  upstreamServer = http.createServer((request, response) => {
    if (request.url === APP_SERVER_READYZ_PATH) {
      response.statusCode = statusCode;
      response.setHeader("Content-Type", "application/json");
      response.end("{}");
      return;
    }

    response.statusCode = 404;
    response.end("Not Found");
  });

  return listen(upstreamServer);
}

afterEach(async () => {
  if (gatewayRuntime) {
    await gatewayRuntime.close();
    gatewayRuntime = null;
  }

  if (upstreamServer) {
    await closeServer(upstreamServer);
    upstreamServer = null;
  }
});

describe("auth gateway /readyz", () => {
  it("returns 200 when upstream /readyz is ready", async () => {
    const upstreamPort = await startUpstreamReadyzServer(200);
    const gatewayPort = await reservePort();
    gatewayRuntime = await startGatewayServer({
      listenUrl: `ws://127.0.0.1:${gatewayPort}`,
      upstreamUrl: `ws://127.0.0.1:${upstreamPort}`,
      token: "secret",
    });

    const response = await fetch(
      `http://127.0.0.1:${gatewayPort}${GATEWAY_READYZ_PATH}`,
    );
    expect(response.status).toBe(200);
  });

  it("returns 503 when upstream /readyz is not ready", async () => {
    const upstreamPort = await startUpstreamReadyzServer(503);
    const gatewayPort = await reservePort();
    gatewayRuntime = await startGatewayServer({
      listenUrl: `ws://127.0.0.1:${gatewayPort}`,
      upstreamUrl: `ws://127.0.0.1:${upstreamPort}`,
      token: "secret",
    });

    const response = await fetch(
      `http://127.0.0.1:${gatewayPort}${GATEWAY_READYZ_PATH}`,
    );
    expect(response.status).toBe(503);
  });

  it("falls back to TCP when upstream does not expose /readyz", async () => {
    const upstreamPort = await startUpstreamReadyzServer(404);
    const gatewayPort = await reservePort();
    gatewayRuntime = await startGatewayServer({
      listenUrl: `ws://127.0.0.1:${gatewayPort}`,
      upstreamUrl: `ws://127.0.0.1:${upstreamPort}`,
      token: "secret",
    });

    const response = await fetch(
      `http://127.0.0.1:${gatewayPort}${GATEWAY_READYZ_PATH}`,
    );
    expect(response.status).toBe(200);
  });
});
