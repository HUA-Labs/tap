import { describe, it, expect, afterEach } from "vitest";
import * as net from "node:net";
import {
  checkTcpPortListening,
  waitForTcpPortListening,
} from "../engine/bridge-app-server-health.js";

let server: net.Server | null = null;

afterEach(() => {
  if (server) {
    server.close();
    server = null;
  }
});

function startTcpServer(port: number): Promise<void> {
  return new Promise((resolve) => {
    server = net.createServer();
    server.listen(port, "127.0.0.1", () => resolve());
  });
}

describe("checkTcpPortListening", () => {
  it("returns true when a TCP server is listening", async () => {
    const port = 19871;
    await startTcpServer(port);
    const result = await checkTcpPortListening(`ws://127.0.0.1:${port}`);
    expect(result).toBe(true);
  });

  it("returns false when nothing is listening", async () => {
    const result = await checkTcpPortListening("ws://127.0.0.1:19872", 500);
    expect(result).toBe(false);
  });

  it("returns false for invalid URL", async () => {
    const result = await checkTcpPortListening("not-a-url");
    expect(result).toBe(false);
  });

  it("does not create a WebSocket session", async () => {
    const port = 19873;
    let connectionCount = 0;
    await new Promise<void>((resolve) => {
      server = net.createServer((socket) => {
        connectionCount++;
        // Close immediately — a real WebSocket upgrade would need HTTP headers
        socket.end();
      });
      server.listen(port, "127.0.0.1", () => resolve());
    });

    await checkTcpPortListening(`ws://127.0.0.1:${port}`);
    // TCP connect happened but no WebSocket upgrade
    expect(connectionCount).toBe(1);
  });
});

describe("waitForTcpPortListening", () => {
  it("returns true once server starts listening", async () => {
    const port = 19874;
    // Start server after a short delay
    setTimeout(() => startTcpServer(port), 200);
    const result = await waitForTcpPortListening(
      `ws://127.0.0.1:${port}`,
      5000,
    );
    expect(result).toBe(true);
  });

  it("returns false if server never starts within timeout", async () => {
    const result = await waitForTcpPortListening("ws://127.0.0.1:19875", 500);
    expect(result).toBe(false);
  });
});
