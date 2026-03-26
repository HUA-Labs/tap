/**
 * Minimal HTTP transport for tap State API.
 * localhost-only, no external dependencies (uses node:http).
 *
 * Endpoints:
 *   GET /api/snapshot    — DashboardSnapshot JSON
 *   GET /api/events      — SSE stream of snapshots
 *   GET /api/config      — Resolved tap configuration
 *   GET /health          — Health check
 */

import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import {
  getDashboardSnapshot,
  streamEvents,
  getConfig,
  getHealthReport,
  startAgents,
  stopAgents,
} from "./state.js";
import type { StateApiOptions } from "./state.js";

export interface HttpServerOptions extends StateApiOptions {
  /** Port to listen on (default: 4580) */
  port?: number;
  /** Pre-set API token (default: auto-generated) */
  token?: string;
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "http://localhost:3000",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

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

function verifyBearerToken(
  req: IncomingMessage,
  expectedToken: string,
): boolean {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return false;
  }
  return tokensMatch(header.slice(7), expectedToken);
}

function verifySseToken(
  req: IncomingMessage,
  expectedToken: string,
  serverUrl: string,
): boolean {
  // EventSource can't set custom headers — accept ?token= query param for SSE only
  if (verifyBearerToken(req, expectedToken)) {
    return true;
  }
  const url = new URL(req.url ?? "/", serverUrl);
  const queryToken = url.searchParams.get("token");
  return tokensMatch(queryToken, expectedToken);
}

function jsonResponse(res: ServerResponse, data: unknown, status = 200): void {
  res.writeHead(status, {
    "Content-Type": "application/json",
    ...CORS_HEADERS,
  });
  res.end(JSON.stringify(data));
}

function handleSnapshot(
  res: ServerResponse,
  apiOptions: StateApiOptions,
): void {
  const snapshot = getDashboardSnapshot(apiOptions);
  jsonResponse(res, snapshot);
}

function handleConfig(res: ServerResponse, apiOptions: StateApiOptions): void {
  const config = getConfig(apiOptions);
  jsonResponse(res, config);
}

async function handleEvents(
  req: IncomingMessage,
  res: ServerResponse,
  apiOptions: StateApiOptions,
): Promise<void> {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    ...CORS_HEADERS,
  });

  const controller = new AbortController();
  req.on("close", () => controller.abort());

  for await (const snapshot of streamEvents({
    ...apiOptions,
    signal: controller.signal,
  })) {
    if (controller.signal.aborted) break;
    res.write(`data: ${JSON.stringify(snapshot)}\n\n`);
  }

  res.end();
}

function handleHealth(res: ServerResponse, apiOptions: StateApiOptions): void {
  const report = getHealthReport(apiOptions);
  jsonResponse(res, report);
}

/**
 * Start a localhost-only HTTP server for the tap State API.
 * Resolves after the server is listening. Rejects on bind failure (e.g. EADDRINUSE).
 */
export async function startHttpServer(options?: HttpServerOptions): Promise<{
  port: number;
  token: string;
  close: () => Promise<void>;
}> {
  const port = options?.port ?? 4580;
  // Security: always bind to loopback — no auth layer beyond bearer token
  const host = "127.0.0.1";
  const token = options?.token ?? randomBytes(24).toString("base64url");
  const apiOptions: StateApiOptions = {
    repoRoot: options?.repoRoot,
    commsDir: options?.commsDir,
  };

  const server = createServer(
    async (req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(req.url ?? "/", `http://${host}:${port}`);
      const pathname = url.pathname;

      if (req.method === "OPTIONS") {
        res.writeHead(204, CORS_HEADERS);
        res.end();
        return;
      }

      // Health endpoint is public (no auth required)
      if (req.method === "GET" && pathname === "/health") {
        handleHealth(res, apiOptions);
        return;
      }

      // SSE endpoint: accepts Bearer header OR ?token= query param (EventSource can't set headers)
      if (req.method === "GET" && pathname === "/api/events") {
        const serverUrl = `http://${host}:${port}`;
        if (!verifySseToken(req, token, serverUrl)) {
          jsonResponse(res, { error: "Unauthorized" }, 401);
          return;
        }
        await handleEvents(req, res, apiOptions);
        return;
      }

      // All other endpoints require Bearer token only (no query param fallback)
      if (!verifyBearerToken(req, token)) {
        jsonResponse(res, { error: "Unauthorized" }, 401);
        return;
      }

      try {
        // GET endpoints
        if (req.method === "GET") {
          switch (pathname) {
            case "/api/snapshot":
              handleSnapshot(res, apiOptions);
              return;
            case "/api/config":
              handleConfig(res, apiOptions);
              return;
            // /health handled above (public, no auth)
          }
        }

        // POST endpoints (write API)
        // Require application/json Content-Type to prevent CSRF via browser forms
        // (HTML forms cannot send application/json, forcing preflight on cross-origin)
        if (req.method === "POST") {
          const contentType = req.headers["content-type"] ?? "";
          if (!contentType.includes("application/json")) {
            jsonResponse(
              res,
              { error: "Content-Type must be application/json" },
              415,
            );
            return;
          }

          switch (pathname) {
            case "/api/start":
              jsonResponse(res, await startAgents());
              return;
            case "/api/stop":
              jsonResponse(res, await stopAgents());
              return;
          }
        }

        jsonResponse(res, { error: "Not found" }, 404);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        jsonResponse(res, { error: message }, 500);
      }
    },
  );

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.removeListener("error", reject);
      resolve();
    });
  });

  return {
    port,
    token,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
