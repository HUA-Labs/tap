import {
  createServer,
  type IncomingMessage,
  type Server as HttpServer,
  type ServerResponse,
} from "node:http";
import { readFileSync } from "node:fs";
import type { Socket } from "node:net";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { timingSafeEqual } from "node:crypto";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import { checkManagedAppServerReady } from "../engine/bridge-app-server-health.js";

const AUTH_SUBPROTOCOL_PREFIX = "tap-auth-";
const CLOSE_UNAUTHORIZED = 4401;
const CLOSE_UPSTREAM_ERROR = 1013;
export const GATEWAY_READYZ_PATH = "/readyz";

export interface GatewayOptions {
  listenUrl: string;
  upstreamUrl: string;
  token: string;
}

export interface GatewayRuntime {
  server: HttpServer;
  close(): Promise<void>;
}

function normalizeUrl(value: string): string {
  return value.replace(/\/$/, "");
}

function closeSocket(
  socket: Pick<WebSocket, "readyState" | "close">,
  code: number,
  reason: string,
): void {
  if (
    socket.readyState === WebSocket.CLOSING ||
    socket.readyState === WebSocket.CLOSED
  ) {
    return;
  }

  try {
    socket.close(code, reason);
  } catch {
    // Best-effort cleanup only.
  }
}

function readFlagValue(argv: string[], index: number, flag: string): string {
  const current = argv[index] ?? "";
  const eqIndex = current.indexOf("=");
  if (eqIndex >= 0) {
    return current.slice(eqIndex + 1);
  }

  const next = argv[index + 1];
  if (!next || next.startsWith("--")) {
    throw new Error(`Missing value for ${flag}`);
  }
  return next;
}

export function buildGatewayOptions(argv: string[]): GatewayOptions {
  let listenUrl = process.env.TAP_GATEWAY_LISTEN_URL?.trim() || "";
  let upstreamUrl = process.env.TAP_GATEWAY_UPSTREAM_URL?.trim() || "";
  let tokenFile = process.env.TAP_GATEWAY_TOKEN_FILE?.trim() || "";
  let token = process.env.TAP_GATEWAY_TOKEN?.trim() || "";

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index] ?? "";
    const consumesNext = !flag.includes("=");

    if (flag.startsWith("--listen-url")) {
      listenUrl = readFlagValue(argv, index, "--listen-url").trim();
      if (consumesNext) index += 1;
      continue;
    }

    if (flag.startsWith("--upstream-url")) {
      upstreamUrl = readFlagValue(argv, index, "--upstream-url").trim();
      if (consumesNext) index += 1;
      continue;
    }

    if (flag.startsWith("--token")) {
      token = readFlagValue(argv, index, "--token").trim();
      if (consumesNext) index += 1;
      continue;
    }

    if (flag.startsWith("--token-file")) {
      tokenFile = readFlagValue(argv, index, "--token-file").trim();
      if (consumesNext) index += 1;
      continue;
    }
  }

  if (tokenFile) {
    token = readFileSync(tokenFile, "utf8").trim();
  }

  if (!listenUrl) {
    throw new Error("Missing gateway listen URL");
  }
  if (!upstreamUrl) {
    throw new Error("Missing gateway upstream URL");
  }
  if (!token) {
    throw new Error("Missing gateway auth token");
  }

  const listen = new URL(listenUrl);
  const upstream = new URL(upstreamUrl);
  if (!/^wss?:$/.test(listen.protocol)) {
    throw new Error(`Unsupported gateway listen protocol: ${listen.protocol}`);
  }
  if (!/^wss?:$/.test(upstream.protocol)) {
    throw new Error(
      `Unsupported gateway upstream protocol: ${upstream.protocol}`,
    );
  }

  return {
    listenUrl: normalizeUrl(listen.toString()),
    upstreamUrl: normalizeUrl(upstream.toString()),
    token,
  };
}

function tokensMatch(
  presentedToken: string | null,
  expectedToken: string,
): boolean {
  if (!presentedToken) {
    return false;
  }

  const presented = Buffer.from(presentedToken, "utf8");
  const expected = Buffer.from(expectedToken, "utf8");
  if (presented.length !== expected.length) {
    return false;
  }

  return timingSafeEqual(presented, expected);
}

async function main(): Promise<void> {
  const options = buildGatewayOptions(process.argv.slice(2));
  const runtime = await startGatewayServer(options);

  const shutdown = () => {
    void runtime.close().finally(() => {
      process.exit(0);
    });
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

function writeJson(
  response: ServerResponse,
  statusCode: number,
  body: Record<string, unknown>,
): void {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json");
  response.end(JSON.stringify(body));
}

function writeUpgradeRequired(response: ServerResponse): void {
  response.statusCode = 426;
  response.setHeader("Connection", "Upgrade");
  response.setHeader("Upgrade", "websocket");
  response.end("Upgrade Required");
}

function writeNotFound(response: ServerResponse): void {
  response.statusCode = 404;
  response.end("Not Found");
}

function rejectUpgrade(socket: Socket | import("stream").Duplex, statusCode: number): void {
  socket.write(`HTTP/1.1 ${statusCode} ${statusCode === 404 ? "Not Found" : "Bad Request"}\r\n\r\n`);
  socket.destroy();
}

function isUpgradePath(listenUrl: string, request: IncomingMessage): boolean {
  const requestUrl = new URL(request.url ?? "/", listenUrl.replace(/^ws/, "http"));
  const listenPath = new URL(listenUrl).pathname;
  return requestUrl.pathname === (listenPath || "/");
}

async function handleReadyzRequest(
  response: ServerResponse,
  options: GatewayOptions,
): Promise<void> {
  const ready = await checkManagedAppServerReady(options.upstreamUrl);
  writeJson(response, ready ? 200 : 503, { ok: ready });
}

export async function startGatewayServer(
  options: GatewayOptions,
): Promise<GatewayRuntime> {
  const listen = new URL(options.listenUrl);
  const host = listen.hostname === "localhost" ? "127.0.0.1" : listen.hostname;
  const port = Number.parseInt(listen.port, 10);
  if (!Number.isFinite(port) || port <= 0) {
    throw new Error(
      `Gateway listen URL must include a valid port: ${options.listenUrl}`,
    );
  }

  const wsServer = new WebSocketServer({
    noServer: true,
    perMessageDeflate: false,
  });

  wsServer.on("connection", (client: WebSocket, request: IncomingMessage) => {
    // Extract token from Sec-WebSocket-Protocol header (subprotocol auth).
    // Client sends: WebSocket(url, ["tap-auth-<token>"])
    // Falls back to query param for backward compatibility during migration.
    const protocols =
      request.headers["sec-websocket-protocol"]
        ?.split(",")
        .map((s) => s.trim()) ?? [];
    const authProtocol = protocols.find((p) =>
      p.startsWith(AUTH_SUBPROTOCOL_PREFIX),
    );
    const subprotocolToken =
      authProtocol?.slice(AUTH_SUBPROTOCOL_PREFIX.length) ?? null;

    // Legacy fallback: query param (will be removed in future version)
    const requestUrl = new URL(request.url ?? "/", options.listenUrl);
    const queryToken = requestUrl.searchParams.get("tap_token");

    const presentedToken = subprotocolToken ?? queryToken;
    if (!tokensMatch(presentedToken, options.token)) {
      closeSocket(client, CLOSE_UNAUTHORIZED, "Unauthorized");
      return;
    }

    const upstream = new WebSocket(options.upstreamUrl, {
      perMessageDeflate: false,
    });

    upstream.on("message", (data: RawData, isBinary: boolean) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data, { binary: isBinary });
      }
    });

    client.on("message", (data: RawData, isBinary: boolean) => {
      if (upstream.readyState === WebSocket.OPEN) {
        upstream.send(data, { binary: isBinary });
      }
    });

    upstream.on("close", (code: number, reasonBuffer: Buffer) => {
      const reason = reasonBuffer.toString() || "Upstream closed";
      closeSocket(client, code || 1000, reason);
    });

    client.on("close", (code: number, reasonBuffer: Buffer) => {
      const reason = reasonBuffer.toString() || "Client closed";
      closeSocket(upstream, code || 1000, reason);
    });

    upstream.on("error", (error: Error) => {
      console.error(`[auth-gateway] upstream error: ${String(error)}`);
      closeSocket(client, CLOSE_UPSTREAM_ERROR, "Upstream unavailable");
      closeSocket(upstream, CLOSE_UPSTREAM_ERROR, "Upstream unavailable");
    });

    client.on("error", (error: Error) => {
      console.error(`[auth-gateway] client error: ${String(error)}`);
      closeSocket(upstream, 1011, "Client error");
    });
  });

  const server = createServer(async (request, response) => {
    const requestUrl = new URL(
      request.url ?? "/",
      options.listenUrl.replace(/^ws/, "http"),
    );

    if (request.method === "GET" && requestUrl.pathname === GATEWAY_READYZ_PATH) {
      await handleReadyzRequest(response, options);
      return;
    }

    if (isUpgradePath(options.listenUrl, request)) {
      writeUpgradeRequired(response);
      return;
    }

    writeNotFound(response);
  });

  server.on("upgrade", (request, socket, head) => {
    if (!isUpgradePath(options.listenUrl, request)) {
      rejectUpgrade(socket, 404);
      return;
    }

    wsServer.handleUpgrade(request, socket, head, (client) => {
      wsServer.emit("connection", client, request);
    });
  });

  await new Promise<void>((resolvePromise, rejectPromise) => {
    server.once("error", rejectPromise);
    server.listen(port, host, () => {
      server.off("error", rejectPromise);
      console.log(
        `[auth-gateway] listening ${options.listenUrl} -> ${options.upstreamUrl}`,
      );
      resolvePromise();
    });
  });

  return {
    server,
    close() {
      return new Promise<void>((resolvePromise) => {
        server.close(() => {
          wsServer.close(() => resolvePromise());
        });
      });
    },
  };
}

function isDirectExecution(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(resolve(entry)).href;
}

if (isDirectExecution()) {
  main().catch((error) => {
    console.error(
      error instanceof Error ? (error.stack ?? error.message) : String(error),
    );
    process.exit(1);
  });
}
