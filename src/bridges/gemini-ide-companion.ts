import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type Server as HttpServer,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { detectGeminiIdeProcessPid } from "./gemini-ide-process.js";

export interface GeminiIdeCursor {
  line: number;
  character: number;
}

export interface GeminiIdeFile {
  path: string;
  timestamp: number;
  isActive?: boolean;
  cursor?: GeminiIdeCursor;
  selectedText?: string;
}

export interface GeminiIdeContext {
  workspaceState?: {
    openFiles?: GeminiIdeFile[];
    isTrusted?: boolean;
  };
}

export interface GeminiIdeInfo {
  name: string;
  displayName: string;
}

export interface GeminiIdeCompanionServerOptions {
  port?: number;
  host?: string;
  endpointPath?: string;
  authToken?: string;
  enableDiscoveryFile?: boolean;
  discoveryPid?: number;
  workspacePaths?: string[];
  ideInfo?: GeminiIdeInfo;
  logger?: {
    info?: (...args: unknown[]) => void;
    warn?: (...args: unknown[]) => void;
    error?: (...args: unknown[]) => void;
  };
}

export interface GeminiIdeCompanionServer {
  readonly port: number;
  readonly host: string;
  readonly url: string;
  readonly endpointPath: string;
  readonly authToken: string;
  readonly discoveryFilePath: string | null;
  sessionIds(): string[];
  sendDiffAccepted(
    filePath: string,
    content?: string,
    sessionId?: string,
  ): Promise<string[]>;
  sendDiffRejected(filePath: string, sessionId?: string): Promise<string[]>;
  sendContextUpdate(
    context: GeminiIdeContext,
    sessionId?: string,
  ): Promise<string[]>;
  close(): Promise<void>;
}

interface GeminiSession {
  mcpServer: Server;
  transport: StreamableHTTPServerTransport;
  diffContents: Map<string, string>;
}

const DEFAULT_IDE_INFO: GeminiIdeInfo = {
  name: "tap",
  displayName: "TAP Gemini Companion",
};

function readBearerToken(req: IncomingMessage): string | null {
  const authorization = req.headers.authorization;
  if (!authorization) {
    return null;
  }

  const [scheme, token] = authorization.split(/\s+/, 2);
  if (!scheme || !token || scheme.toLowerCase() !== "bearer") {
    return null;
  }

  return token;
}

function writeJson(
  res: ServerResponse,
  statusCode: number,
  body: Record<string, unknown>,
): void {
  res.writeHead(statusCode, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function createSession(): GeminiSession {
  const diffContents = new Map<string, string>();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
  });
  const mcpServer = new Server(
    {
      name: "tap-gemini-ide-companion",
      version: "0.1.0",
    },
    {
      capabilities: {
        tools: {
          listChanged: false,
        },
      },
    },
  );

  mcpServer.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "openDiff",
        description: "Open a diff view for a file inside the IDE companion.",
        inputSchema: {
          type: "object",
          properties: {
            filePath: { type: "string" },
            newContent: { type: "string" },
          },
          required: ["filePath", "newContent"],
        },
      },
      {
        name: "closeDiff",
        description: "Close an open diff view and return the final content.",
        inputSchema: {
          type: "object",
          properties: {
            filePath: { type: "string" },
            suppressNotification: { type: "boolean" },
          },
          required: ["filePath"],
        },
      },
    ],
  }));

  mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
    switch (request.params.name) {
      case "openDiff": {
        const filePath = request.params.arguments?.filePath;
        const newContent = request.params.arguments?.newContent;

        if (typeof filePath !== "string" || typeof newContent !== "string") {
          throw new McpError(
            ErrorCode.InvalidParams,
            "openDiff requires string filePath and newContent arguments.",
          );
        }

        diffContents.set(filePath, newContent);
        return { content: [] };
      }

      case "closeDiff": {
        const filePath = request.params.arguments?.filePath;
        const suppressNotification =
          request.params.arguments?.suppressNotification;
        if (typeof filePath !== "string") {
          throw new McpError(
            ErrorCode.InvalidParams,
            "closeDiff requires a string filePath argument.",
          );
        }
        if (
          suppressNotification !== undefined &&
          typeof suppressNotification !== "boolean"
        ) {
          throw new McpError(
            ErrorCode.InvalidParams,
            "closeDiff suppressNotification must be a boolean when provided.",
          );
        }

        const content = diffContents.get(filePath) ?? null;
        diffContents.delete(filePath);

        if (content !== null && !suppressNotification) {
          await transport.send({
            jsonrpc: "2.0",
            method: "ide/diffRejected",
            params: { filePath },
          });
        }

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ content }),
            },
          ],
        };
      }

      default:
        throw new McpError(
          ErrorCode.InvalidParams,
          `Unknown tool: ${request.params.name}`,
        );
    }
  });

  return {
    mcpServer,
    transport,
    diffContents,
  };
}

function resolveDiscoveryFilePath(pid: number, port: number): string {
  return path.join(
    os.tmpdir(),
    "gemini",
    "ide",
    `gemini-ide-server-${pid}-${port}.json`,
  );
}

function writeDiscoveryFile(options: {
  port: number;
  pid: number;
  authToken: string;
  workspacePaths: string[];
  ideInfo: GeminiIdeInfo;
}): string {
  const filePath = resolveDiscoveryFilePath(options.pid, options.port);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(
    filePath,
    JSON.stringify(
      {
        port: options.port,
        workspacePath: options.workspacePaths.join(path.delimiter),
        authToken: options.authToken,
        ideInfo: options.ideInfo,
      },
      null,
      2,
    ) + "\n",
    "utf-8",
  );
  return filePath;
}

function removeFileIfExists(filePath: string | null): void {
  if (!filePath) {
    return;
  }

  try {
    fs.unlinkSync(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
}

export async function startGeminiIdeCompanionServer(
  options: GeminiIdeCompanionServerOptions = {},
): Promise<GeminiIdeCompanionServer> {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 0;
  const endpointPath = options.endpointPath ?? "/mcp";
  const authToken = options.authToken ?? randomUUID();
  const ideInfo = options.ideInfo ?? DEFAULT_IDE_INFO;
  const sessions = new Map<string, GeminiSession>();
  let resolvedPort = port;

  const httpServer: HttpServer = createServer(async (req, res) => {
    try {
      const requestUrl = new URL(
        req.url ?? "/",
        `http://${req.headers.host ?? `${host}:${resolvedPort}`}`,
      );

      if (requestUrl.pathname !== endpointPath) {
        writeJson(res, 404, { error: "Not found" });
        return;
      }

      const suppliedToken = readBearerToken(req);
      if (suppliedToken !== authToken) {
        res.setHeader("www-authenticate", 'Bearer realm="gemini-ide"');
        writeJson(res, 401, { error: "Unauthorized" });
        return;
      }

      const sessionIdHeader = req.headers["mcp-session-id"];
      const sessionId =
        typeof sessionIdHeader === "string" ? sessionIdHeader : null;

      if (!sessionId) {
        if (req.method !== "POST") {
          writeJson(res, 400, {
            error: "Missing MCP session ID for non-initialization request.",
          });
          return;
        }

        const session = createSession();
        session.transport.onclose = () => {
          const activeSessionId = session.transport.sessionId;
          if (activeSessionId) {
            sessions.delete(activeSessionId);
          }
        };

        await session.mcpServer.connect(session.transport);
        await session.transport.handleRequest(req, res);

        const initializedSessionId = session.transport.sessionId;
        if (initializedSessionId) {
          sessions.set(initializedSessionId, session);
        }
        return;
      }

      const existingSession = sessions.get(sessionId);
      if (!existingSession) {
        writeJson(res, 404, { error: `Unknown MCP session: ${sessionId}` });
        return;
      }

      await existingSession.transport.handleRequest(req, res);
    } catch (error) {
      options.logger?.error?.("[gemini-ide-companion] request failed", error);
      if (!res.headersSent) {
        writeJson(res, 500, { error: "Internal server error" });
      } else {
        res.end();
      }
    }
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(port, host, () => {
      httpServer.off("error", reject);
      resolve();
    });
  });

  const resolvedAddress = httpServer.address();
  if (!resolvedAddress || typeof resolvedAddress === "string") {
    throw new Error("Failed to resolve Gemini IDE companion listen address.");
  }

  resolvedPort = (resolvedAddress as AddressInfo).port;
  const workspacePaths = (options.workspacePaths ?? [])
    .map((workspacePath) => path.resolve(workspacePath))
    .filter(Boolean);

  let discoveryFilePath: string | null = null;
  try {
    if (options.enableDiscoveryFile) {
      if (workspacePaths.length === 0) {
        throw new Error(
          "workspacePaths is required when enableDiscoveryFile is true.",
        );
      }

      const discoveryPid =
        options.discoveryPid ?? (await detectGeminiIdeProcessPid());

      discoveryFilePath = writeDiscoveryFile({
        port: resolvedPort,
        pid: discoveryPid,
        authToken,
        workspacePaths,
        ideInfo,
      });
    }
  } catch (error) {
    await new Promise<void>((resolve, reject) => {
      httpServer.close((closeError) => {
        if (closeError) {
          reject(closeError);
          return;
        }
        resolve();
      });
    });
    throw error;
  }

  const close = async (): Promise<void> => {
    removeFileIfExists(discoveryFilePath);

    const closePromises = [...sessions.values()].map(async (session) => {
      await session.mcpServer.close();
      session.diffContents.clear();
    });
    await Promise.all(closePromises);
    sessions.clear();

    await new Promise<void>((resolve, reject) => {
      httpServer.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  };

  const sendContextUpdate = async (
    context: GeminiIdeContext,
    sessionId?: string,
  ): Promise<string[]> => {
    const targets = sessionId
      ? [[sessionId, sessions.get(sessionId) ?? null] as const]
      : [...sessions.entries()].map(([id, session]) => [id, session] as const);
    const delivered: string[] = [];

    for (const [targetSessionId, session] of targets) {
      if (!session) {
        continue;
      }

      await session.transport.send({
        jsonrpc: "2.0",
        method: "ide/contextUpdate",
        params: context as Record<string, unknown>,
      });
      delivered.push(targetSessionId);
    }

    return delivered;
  };

  const sendDiffAccepted = async (
    filePath: string,
    content?: string,
    sessionId?: string,
  ): Promise<string[]> => {
    const targets = sessionId
      ? [[sessionId, sessions.get(sessionId) ?? null] as const]
      : [...sessions.entries()].map(([id, session]) => [id, session] as const);
    const delivered: string[] = [];

    for (const [targetSessionId, session] of targets) {
      if (!session) {
        continue;
      }

      const finalContent = content ?? session.diffContents.get(filePath);
      if (typeof finalContent !== "string") {
        continue;
      }

      await session.transport.send({
        jsonrpc: "2.0",
        method: "ide/diffAccepted",
        params: { filePath, content: finalContent },
      });
      session.diffContents.delete(filePath);
      delivered.push(targetSessionId);
    }

    return delivered;
  };

  const sendDiffRejected = async (
    filePath: string,
    sessionId?: string,
  ): Promise<string[]> => {
    const targets = sessionId
      ? [[sessionId, sessions.get(sessionId) ?? null] as const]
      : [...sessions.entries()].map(([id, session]) => [id, session] as const);
    const delivered: string[] = [];

    for (const [targetSessionId, session] of targets) {
      if (!session) {
        continue;
      }
      if (!sessionId && !session.diffContents.has(filePath)) {
        continue;
      }

      await session.transport.send({
        jsonrpc: "2.0",
        method: "ide/diffRejected",
        params: { filePath },
      });
      session.diffContents.delete(filePath);
      delivered.push(targetSessionId);
    }

    return delivered;
  };

  return {
    port: resolvedPort,
    host,
    url: `http://${host}:${resolvedPort}${endpointPath}`,
    endpointPath,
    authToken,
    discoveryFilePath,
    sessionIds: () => [...sessions.keys()],
    sendDiffAccepted,
    sendDiffRejected,
    sendContextUpdate,
    close,
  };
}
