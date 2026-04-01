// src/bridges/codex-app-server-auth-gateway.ts
import {
  createServer
} from "http";
import { readFileSync } from "fs";
import { resolve } from "path";
import { pathToFileURL } from "url";
import { timingSafeEqual } from "crypto";
import { WebSocket, WebSocketServer } from "ws";

// src/engine/bridge-app-server-health.ts
import * as net from "net";
var APP_SERVER_HEALTH_TIMEOUT_MS = 1500;
var APP_SERVER_READYZ_PATH = "/readyz";
function buildAppServerReadyzUrl(url) {
  let parsed;
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
async function checkAppServerReadyz(url, timeoutMs = APP_SERVER_HEALTH_TIMEOUT_MS) {
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
        accept: "application/json"
      }
    });
    if (response.ok) {
      return "ready";
    }
    if (response.status === 400 || response.status === 404 || response.status === 405 || response.status === 426 || response.status === 501) {
      return "unsupported";
    }
    return "not-ready";
  } catch {
    return "not-ready";
  } finally {
    clearTimeout(timer);
  }
}
async function checkTcpPortListening(url, timeoutMs = APP_SERVER_HEALTH_TIMEOUT_MS) {
  let hostname;
  let port;
  try {
    const parsed = new URL(url.replace(/^ws/, "http"));
    hostname = parsed.hostname;
    port = parseInt(parsed.port, 10);
  } catch {
    return false;
  }
  if (!port || !Number.isFinite(port)) return false;
  return new Promise((resolve2) => {
    const socket = net.createConnection({ host: hostname, port });
    const timer = setTimeout(() => {
      socket.destroy();
      resolve2(false);
    }, timeoutMs);
    socket.once("connect", () => {
      clearTimeout(timer);
      socket.destroy();
      resolve2(true);
    });
    socket.once("error", () => {
      clearTimeout(timer);
      socket.destroy();
      resolve2(false);
    });
  });
}
async function checkManagedAppServerReady(url, timeoutMs = APP_SERVER_HEALTH_TIMEOUT_MS) {
  const readyzStatus = await checkAppServerReadyz(url, timeoutMs);
  if (readyzStatus === "ready") {
    return true;
  }
  if (readyzStatus === "unsupported") {
    return checkTcpPortListening(url, timeoutMs);
  }
  return false;
}

// src/bridges/codex-app-server-auth-gateway.ts
var AUTH_SUBPROTOCOL_PREFIX = "tap-auth-";
var CLOSE_UNAUTHORIZED = 4401;
var CLOSE_UPSTREAM_ERROR = 1013;
var GATEWAY_READYZ_PATH = "/readyz";
function normalizeUrl(value) {
  return value.replace(/\/$/, "");
}
function closeSocket(socket, code, reason) {
  if (socket.readyState === WebSocket.CLOSING || socket.readyState === WebSocket.CLOSED) {
    return;
  }
  try {
    socket.close(code, reason);
  } catch {
  }
}
function readFlagValue(argv, index, flag) {
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
function buildGatewayOptions(argv) {
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
      `Unsupported gateway upstream protocol: ${upstream.protocol}`
    );
  }
  return {
    listenUrl: normalizeUrl(listen.toString()),
    upstreamUrl: normalizeUrl(upstream.toString()),
    token
  };
}
function tokensMatch(presentedToken, expectedToken) {
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
async function main() {
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
function writeJson(response, statusCode, body) {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json");
  response.end(JSON.stringify(body));
}
function writeUpgradeRequired(response) {
  response.statusCode = 426;
  response.setHeader("Connection", "Upgrade");
  response.setHeader("Upgrade", "websocket");
  response.end("Upgrade Required");
}
function writeNotFound(response) {
  response.statusCode = 404;
  response.end("Not Found");
}
function rejectUpgrade(socket, statusCode) {
  socket.write(
    `HTTP/1.1 ${statusCode} ${statusCode === 404 ? "Not Found" : "Bad Request"}\r
\r
`
  );
  socket.destroy();
}
function containsTraversal(raw) {
  if (raw.includes("..")) return true;
  if (/%2e/i.test(raw) && raw.replace(/%2e/gi, ".").includes("..")) return true;
  return false;
}
function isUpgradePath(listenUrl, request) {
  const requestUrl = new URL(
    request.url ?? "/",
    listenUrl.replace(/^ws/, "http")
  );
  const listenPath = new URL(listenUrl).pathname;
  return requestUrl.pathname === (listenPath || "/");
}
async function handleReadyzRequest(response, options) {
  const ready = await checkManagedAppServerReady(options.upstreamUrl);
  writeJson(response, ready ? 200 : 503, { ok: ready });
}
async function startGatewayServer(options) {
  const listen = new URL(options.listenUrl);
  const host = listen.hostname === "localhost" ? "127.0.0.1" : listen.hostname;
  const port = Number.parseInt(listen.port, 10);
  if (!Number.isFinite(port) || port <= 0) {
    throw new Error(
      `Gateway listen URL must include a valid port: ${options.listenUrl}`
    );
  }
  const wsServer = new WebSocketServer({
    noServer: true,
    perMessageDeflate: false
  });
  wsServer.on("connection", (client, request) => {
    const protocols = request.headers["sec-websocket-protocol"]?.split(",").map((s) => s.trim()) ?? [];
    const authProtocol = protocols.find(
      (p) => p.startsWith(AUTH_SUBPROTOCOL_PREFIX)
    );
    const subprotocolToken = authProtocol?.slice(AUTH_SUBPROTOCOL_PREFIX.length) ?? null;
    const requestUrl = new URL(request.url ?? "/", options.listenUrl);
    const queryToken = requestUrl.searchParams.get("tap_token");
    const presentedToken = subprotocolToken ?? queryToken;
    if (!tokensMatch(presentedToken, options.token)) {
      closeSocket(client, CLOSE_UNAUTHORIZED, "Unauthorized");
      return;
    }
    const upstream = new WebSocket(options.upstreamUrl, {
      perMessageDeflate: false
    });
    upstream.on("message", (data, isBinary) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data, { binary: isBinary });
      }
    });
    client.on("message", (data, isBinary) => {
      if (upstream.readyState === WebSocket.OPEN) {
        upstream.send(data, { binary: isBinary });
      }
    });
    upstream.on("close", (code, reasonBuffer) => {
      const reason = reasonBuffer.toString() || "Upstream closed";
      closeSocket(client, code || 1e3, reason);
    });
    client.on("close", (code, reasonBuffer) => {
      const reason = reasonBuffer.toString() || "Client closed";
      closeSocket(upstream, code || 1e3, reason);
    });
    upstream.on("error", (error) => {
      console.error(`[auth-gateway] upstream error: ${String(error)}`);
      closeSocket(client, CLOSE_UPSTREAM_ERROR, "Upstream unavailable");
      closeSocket(upstream, CLOSE_UPSTREAM_ERROR, "Upstream unavailable");
    });
    client.on("error", (error) => {
      console.error(`[auth-gateway] client error: ${String(error)}`);
      closeSocket(upstream, 1011, "Client error");
    });
  });
  const listenPath = new URL(options.listenUrl).pathname || "/";
  const server = createServer(async (request, response) => {
    const requestUrl = new URL(
      request.url ?? "/",
      options.listenUrl.replace(/^ws/, "http")
    );
    if (containsTraversal(request.url ?? "")) {
      writeNotFound(response);
      return;
    }
    if (request.method === "GET" && requestUrl.pathname === GATEWAY_READYZ_PATH) {
      await handleReadyzRequest(response, options);
      return;
    }
    if (requestUrl.pathname === listenPath) {
      writeUpgradeRequired(response);
      return;
    }
    writeNotFound(response);
  });
  server.on("upgrade", (request, socket, head) => {
    if (containsTraversal(request.url ?? "")) {
      rejectUpgrade(socket, 400);
      return;
    }
    if (!isUpgradePath(options.listenUrl, request)) {
      rejectUpgrade(socket, 404);
      return;
    }
    wsServer.handleUpgrade(request, socket, head, (client) => {
      wsServer.emit("connection", client, request);
    });
  });
  await new Promise((resolvePromise, rejectPromise) => {
    server.once("error", rejectPromise);
    server.listen(port, host, () => {
      server.off("error", rejectPromise);
      console.log(
        `[auth-gateway] listening ${options.listenUrl} -> ${options.upstreamUrl}`
      );
      resolvePromise();
    });
  });
  return {
    server,
    close() {
      return new Promise((resolvePromise) => {
        server.close(() => {
          wsServer.close(() => resolvePromise());
        });
      });
    }
  };
}
function isDirectExecution() {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(resolve(entry)).href;
}
if (isDirectExecution()) {
  main().catch((error) => {
    console.error(
      error instanceof Error ? error.stack ?? error.message : String(error)
    );
    process.exit(1);
  });
}
export {
  GATEWAY_READYZ_PATH,
  buildGatewayOptions,
  startGatewayServer
};
//# sourceMappingURL=codex-app-server-auth-gateway.mjs.map