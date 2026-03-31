import { afterEach, describe, expect, it } from "vitest";
import * as http from "node:http";
import * as net from "node:net";
import {
  APP_SERVER_READYZ_PATH,
  buildAppServerReadyzUrl,
  checkAppServerReadyz,
  checkManagedAppServerReady,
  waitForManagedAppServerReady,
} from "../engine/bridge-app-server-health.js";

const httpServers = new Set<http.Server>();
const tcpServers = new Set<net.Server>();

function closeServer(server: http.Server | net.Server): Promise<void> {
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

async function listen(server: http.Server | net.Server, port: number = 0): Promise<number> {
  await new Promise<void>((resolvePromise) => {
    server.listen(port, "127.0.0.1", () => resolvePromise());
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("failed to resolve listening port");
  }
  return address.port;
}

async function startHttpReadyzServer(statusCode: number, port: number = 0): Promise<number> {
  const server = http.createServer((request, response) => {
    if (request.url === APP_SERVER_READYZ_PATH) {
      response.statusCode = statusCode;
      response.setHeader("Content-Type", "application/json");
      response.end("{}");
      return;
    }

    response.statusCode = 404;
    response.end("Not Found");
  });
  httpServers.add(server);
  return listen(server, port);
}

async function startPlainTcpServer(): Promise<number> {
  const server = net.createServer((socket) => {
    socket.destroy();
  });
  tcpServers.add(server);
  return listen(server);
}

async function reservePort(): Promise<number> {
  const server = net.createServer();
  const port = await listen(server);
  await closeServer(server);
  return port;
}

afterEach(async () => {
  await Promise.all(
    [...httpServers].map(async (server) => {
      httpServers.delete(server);
      await closeServer(server);
    }),
  );
  await Promise.all(
    [...tcpServers].map(async (server) => {
      tcpServers.delete(server);
      await closeServer(server);
    }),
  );
});

describe("buildAppServerReadyzUrl", () => {
  it("maps ws URLs to http /readyz", () => {
    expect(buildAppServerReadyzUrl("ws://127.0.0.1:4501")).toBe(
      "http://127.0.0.1:4501/readyz",
    );
    expect(buildAppServerReadyzUrl("wss://127.0.0.1:4501/ws")).toBe(
      "https://127.0.0.1:4501/readyz",
    );
  });
});

describe("checkAppServerReadyz", () => {
  it("returns ready when /readyz returns 200", async () => {
    const port = await startHttpReadyzServer(200);
    const result = await checkAppServerReadyz(`ws://127.0.0.1:${port}`);
    expect(result).toBe("ready");
  });

  it("returns unsupported when /readyz is missing", async () => {
    const port = await startHttpReadyzServer(404);
    const result = await checkAppServerReadyz(`ws://127.0.0.1:${port}`);
    expect(result).toBe("unsupported");
  });
});

describe("checkManagedAppServerReady", () => {
  it("falls back to TCP when /readyz is unsupported", async () => {
    const port = await startHttpReadyzServer(404);
    const result = await checkManagedAppServerReady(`ws://127.0.0.1:${port}`);
    expect(result).toBe(true);
  });

  it("does not accept a plain TCP listener that cannot answer HTTP /readyz", async () => {
    const port = await startPlainTcpServer();
    const result = await checkManagedAppServerReady(
      `ws://127.0.0.1:${port}`,
      500,
    );
    expect(result).toBe(false);
  });
});

describe("waitForManagedAppServerReady", () => {
  it("returns true once /readyz starts answering", async () => {
    const port = await reservePort();
    setTimeout(() => {
      void startHttpReadyzServer(200, port);
    }, 200);

    const result = await waitForManagedAppServerReady(
      `ws://127.0.0.1:${port}`,
      5000,
    );
    expect(result).toBe(true);
  });
});
