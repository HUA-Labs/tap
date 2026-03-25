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
import { getDashboardSnapshot, streamEvents, getConfig } from "./state.js";
import type { StateApiOptions } from "./state.js";

export interface HttpServerOptions extends StateApiOptions {
  /** Port to listen on (default: 4580) */
  port?: number;
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "http://localhost:3000",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

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

function handleHealth(res: ServerResponse): void {
  jsonResponse(res, { ok: true, timestamp: new Date().toISOString() });
}

/**
 * Start a localhost-only HTTP server for the tap State API.
 * Resolves after the server is listening. Rejects on bind failure (e.g. EADDRINUSE).
 */
export async function startHttpServer(options?: HttpServerOptions): Promise<{
  port: number;
  close: () => Promise<void>;
}> {
  const port = options?.port ?? 4580;
  // Security: always bind to loopback — no auth layer, must not expose to network
  const host = "127.0.0.1";
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

      if (req.method !== "GET") {
        jsonResponse(res, { error: "Method not allowed" }, 405);
        return;
      }

      try {
        switch (pathname) {
          case "/api/snapshot":
            handleSnapshot(res, apiOptions);
            break;
          case "/api/events":
            await handleEvents(req, res, apiOptions);
            break;
          case "/api/config":
            handleConfig(res, apiOptions);
            break;
          case "/health":
            handleHealth(res);
            break;
          default:
            jsonResponse(res, { error: "Not found" }, 404);
        }
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
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
