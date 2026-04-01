#!/usr/bin/env node

// src/bridges/gemini-ide-companion-runner.ts
import * as path3 from "path";

// src/bridges/gemini-ide-companion.ts
import * as fs from "fs";
import * as os2 from "os";
import * as path2 from "path";
import { randomUUID } from "crypto";
import {
  createServer
} from "http";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError
} from "@modelcontextprotocol/sdk/types.js";

// src/bridges/gemini-ide-process.ts
import { exec } from "child_process";
import os from "os";
import path from "path";
import { promisify } from "util";
var execAsync = promisify(exec);
var MAX_TRAVERSAL_DEPTH = 32;
var WINDOWS_PROCESS_TABLE_COMMAND = "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CommandLine | ConvertTo-Json -Compress";
async function getWindowsProcessTable() {
  const processMap = /* @__PURE__ */ new Map();
  try {
    const { stdout } = await execAsync(
      `powershell "${WINDOWS_PROCESS_TABLE_COMMAND}"`,
      {
        maxBuffer: 10 * 1024 * 1024
      }
    );
    if (!stdout.trim()) {
      return processMap;
    }
    let processes = JSON.parse(stdout);
    if (!Array.isArray(processes)) {
      processes = [processes];
    }
    for (const processInfo of processes) {
      if (!processInfo || typeof processInfo !== "object" || typeof processInfo.ProcessId !== "number") {
        continue;
      }
      const processId = processInfo.ProcessId;
      processMap.set(processId, {
        pid: processId,
        parentPid: typeof processInfo.ParentProcessId === "number" ? processInfo.ParentProcessId ?? 0 : 0,
        name: typeof processInfo.Name === "string" ? processInfo.Name : "",
        command: typeof processInfo.CommandLine === "string" ? processInfo.CommandLine : ""
      });
    }
  } catch {
    return processMap;
  }
  return processMap;
}
async function getUnixProcessInfo(pid) {
  try {
    const { stdout } = await execAsync(`ps -o ppid=,command= -p ${pid}`);
    const trimmed = stdout.trim();
    if (!trimmed) {
      return null;
    }
    const [parentPidText, ...commandParts] = trimmed.split(/\s+/);
    const parentPid = Number.parseInt(parentPidText ?? "", 10);
    const command = commandParts.join(" ").trim();
    return {
      pid,
      parentPid: Number.isFinite(parentPid) ? parentPid : 0,
      name: path.basename(command.split(" ")[0] ?? ""),
      command
    };
  } catch {
    return null;
  }
}
async function detectWindowsIdePid() {
  const processMap = await getWindowsProcessTable();
  const currentProcess = processMap.get(process.pid);
  if (!currentProcess) {
    return process.pid;
  }
  const ancestors = [];
  let current = currentProcess;
  for (let i = 0; i < MAX_TRAVERSAL_DEPTH && current; i += 1) {
    ancestors.push(current);
    if (current.parentPid === 0 || !processMap.has(current.parentPid)) {
      break;
    }
    current = processMap.get(current.parentPid);
  }
  if (ancestors.length >= 3) {
    return ancestors[ancestors.length - 3]?.pid ?? process.pid;
  }
  return ancestors[ancestors.length - 1]?.pid ?? process.pid;
}
async function detectUnixIdePid() {
  const shells = /* @__PURE__ */ new Set([
    "zsh",
    "bash",
    "sh",
    "tcsh",
    "csh",
    "ksh",
    "fish",
    "dash"
  ]);
  let currentPid = process.pid;
  for (let i = 0; i < MAX_TRAVERSAL_DEPTH; i += 1) {
    const processInfo = await getUnixProcessInfo(currentPid);
    if (!processInfo) {
      break;
    }
    if (shells.has(processInfo.name)) {
      let idePid = processInfo.parentPid;
      const grandParentInfo = processInfo.parentPid > 1 ? await getUnixProcessInfo(processInfo.parentPid) : null;
      if (grandParentInfo && grandParentInfo.parentPid > 1) {
        idePid = grandParentInfo.parentPid;
      }
      return idePid > 0 ? idePid : currentPid;
    }
    if (processInfo.parentPid <= 1) {
      break;
    }
    currentPid = processInfo.parentPid;
  }
  return currentPid;
}
async function detectGeminiIdeProcessPid() {
  const explicitPid = Number.parseInt(process.env.GEMINI_CLI_IDE_PID ?? "", 10);
  if (Number.isFinite(explicitPid) && explicitPid > 0) {
    return explicitPid;
  }
  if (os.platform() === "win32") {
    return detectWindowsIdePid();
  }
  return detectUnixIdePid();
}

// src/bridges/gemini-ide-companion.ts
var DEFAULT_IDE_INFO = {
  name: "tap",
  displayName: "TAP Gemini Companion"
};
function readBearerToken(req) {
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
function writeJson(res, statusCode, body) {
  res.writeHead(statusCode, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}
function createSession() {
  const diffContents = /* @__PURE__ */ new Map();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID()
  });
  const mcpServer = new Server(
    {
      name: "tap-gemini-ide-companion",
      version: "0.1.0"
    },
    {
      capabilities: {
        tools: {
          listChanged: false
        }
      }
    }
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
            newContent: { type: "string" }
          },
          required: ["filePath", "newContent"]
        }
      },
      {
        name: "closeDiff",
        description: "Close an open diff view and return the final content.",
        inputSchema: {
          type: "object",
          properties: {
            filePath: { type: "string" },
            suppressNotification: { type: "boolean" }
          },
          required: ["filePath"]
        }
      }
    ]
  }));
  mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
    switch (request.params.name) {
      case "openDiff": {
        const filePath = request.params.arguments?.filePath;
        const newContent = request.params.arguments?.newContent;
        if (typeof filePath !== "string" || typeof newContent !== "string") {
          throw new McpError(
            ErrorCode.InvalidParams,
            "openDiff requires string filePath and newContent arguments."
          );
        }
        diffContents.set(filePath, newContent);
        return { content: [] };
      }
      case "closeDiff": {
        const filePath = request.params.arguments?.filePath;
        const suppressNotification = request.params.arguments?.suppressNotification;
        if (typeof filePath !== "string") {
          throw new McpError(
            ErrorCode.InvalidParams,
            "closeDiff requires a string filePath argument."
          );
        }
        if (suppressNotification !== void 0 && typeof suppressNotification !== "boolean") {
          throw new McpError(
            ErrorCode.InvalidParams,
            "closeDiff suppressNotification must be a boolean when provided."
          );
        }
        const content = diffContents.get(filePath) ?? null;
        diffContents.delete(filePath);
        if (content !== null && !suppressNotification) {
          await transport.send({
            jsonrpc: "2.0",
            method: "ide/diffRejected",
            params: { filePath }
          });
        }
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ content })
            }
          ]
        };
      }
      default:
        throw new McpError(
          ErrorCode.InvalidParams,
          `Unknown tool: ${request.params.name}`
        );
    }
  });
  return {
    mcpServer,
    transport,
    diffContents
  };
}
function resolveDiscoveryFilePath(pid, port) {
  return path2.join(
    os2.tmpdir(),
    "gemini",
    "ide",
    `gemini-ide-server-${pid}-${port}.json`
  );
}
function writeDiscoveryFile(options) {
  const filePath = resolveDiscoveryFilePath(options.pid, options.port);
  fs.mkdirSync(path2.dirname(filePath), { recursive: true });
  fs.writeFileSync(
    filePath,
    JSON.stringify(
      {
        port: options.port,
        workspacePath: options.workspacePaths.join(path2.delimiter),
        authToken: options.authToken,
        ideInfo: options.ideInfo
      },
      null,
      2
    ) + "\n",
    "utf-8"
  );
  return filePath;
}
function removeFileIfExists(filePath) {
  if (!filePath) {
    return;
  }
  try {
    fs.unlinkSync(filePath);
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }
}
async function startGeminiIdeCompanionServer(options = {}) {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 0;
  const endpointPath = options.endpointPath ?? "/mcp";
  const authToken = options.authToken ?? randomUUID();
  const ideInfo = options.ideInfo ?? DEFAULT_IDE_INFO;
  const sessions = /* @__PURE__ */ new Map();
  let resolvedPort = port;
  const httpServer = createServer(async (req, res) => {
    try {
      const requestUrl = new URL(
        req.url ?? "/",
        `http://${req.headers.host ?? `${host}:${resolvedPort}`}`
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
      const sessionId = typeof sessionIdHeader === "string" ? sessionIdHeader : null;
      if (!sessionId) {
        if (req.method !== "POST") {
          writeJson(res, 400, {
            error: "Missing MCP session ID for non-initialization request."
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
  await new Promise((resolve2, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(port, host, () => {
      httpServer.off("error", reject);
      resolve2();
    });
  });
  const resolvedAddress = httpServer.address();
  if (!resolvedAddress || typeof resolvedAddress === "string") {
    throw new Error("Failed to resolve Gemini IDE companion listen address.");
  }
  resolvedPort = resolvedAddress.port;
  const workspacePaths = (options.workspacePaths ?? []).map((workspacePath) => path2.resolve(workspacePath)).filter(Boolean);
  let discoveryFilePath = null;
  try {
    if (options.enableDiscoveryFile) {
      if (workspacePaths.length === 0) {
        throw new Error(
          "workspacePaths is required when enableDiscoveryFile is true."
        );
      }
      const discoveryPid = options.discoveryPid ?? await detectGeminiIdeProcessPid();
      discoveryFilePath = writeDiscoveryFile({
        port: resolvedPort,
        pid: discoveryPid,
        authToken,
        workspacePaths,
        ideInfo
      });
    }
  } catch (error) {
    await new Promise((resolve2, reject) => {
      httpServer.close((closeError) => {
        if (closeError) {
          reject(closeError);
          return;
        }
        resolve2();
      });
    });
    throw error;
  }
  const close = async () => {
    removeFileIfExists(discoveryFilePath);
    const closePromises = [...sessions.values()].map(async (session) => {
      await session.mcpServer.close();
      session.diffContents.clear();
    });
    await Promise.all(closePromises);
    sessions.clear();
    await new Promise((resolve2, reject) => {
      httpServer.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve2();
      });
    });
  };
  const sendContextUpdate = async (context, sessionId) => {
    const targets = sessionId ? [[sessionId, sessions.get(sessionId) ?? null]] : [...sessions.entries()].map(([id, session]) => [id, session]);
    const delivered = [];
    for (const [targetSessionId, session] of targets) {
      if (!session) {
        continue;
      }
      await session.transport.send({
        jsonrpc: "2.0",
        method: "ide/contextUpdate",
        params: context
      });
      delivered.push(targetSessionId);
    }
    return delivered;
  };
  const sendDiffAccepted = async (filePath, content, sessionId) => {
    const targets = sessionId ? [[sessionId, sessions.get(sessionId) ?? null]] : [...sessions.entries()].map(([id, session]) => [id, session]);
    const delivered = [];
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
        params: { filePath, content: finalContent }
      });
      session.diffContents.delete(filePath);
      delivered.push(targetSessionId);
    }
    return delivered;
  };
  const sendDiffRejected = async (filePath, sessionId) => {
    const targets = sessionId ? [[sessionId, sessions.get(sessionId) ?? null]] : [...sessions.entries()].map(([id, session]) => [id, session]);
    const delivered = [];
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
        params: { filePath }
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
    close
  };
}

// src/bridges/gemini-ide-companion-runner.ts
function readNumberEnv(name) {
  const value = process.env[name];
  if (!value) {
    return void 0;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : void 0;
}
function readWorkspacePaths() {
  const fromEnv = process.env.GEMINI_IDE_WORKSPACE_PATHS ?? process.env.GEMINI_CLI_IDE_WORKSPACE_PATH;
  if (!fromEnv) {
    return [process.cwd()];
  }
  return fromEnv.split(path3.delimiter).map((workspacePath) => workspacePath.trim()).filter(Boolean);
}
var server = await startGeminiIdeCompanionServer({
  host: process.env.GEMINI_IDE_COMPANION_HOST ?? "127.0.0.1",
  port: readNumberEnv("GEMINI_IDE_COMPANION_PORT") ?? 0,
  authToken: process.env.GEMINI_IDE_AUTH_TOKEN ?? process.env.GEMINI_CLI_IDE_AUTH_TOKEN,
  enableDiscoveryFile: process.env.GEMINI_IDE_WRITE_DISCOVERY !== "0",
  discoveryPid: readNumberEnv("GEMINI_IDE_DISCOVERY_PID"),
  workspacePaths: readWorkspacePaths(),
  ideInfo: {
    name: process.env.GEMINI_IDE_NAME ?? "tap",
    displayName: process.env.GEMINI_IDE_DISPLAY_NAME ?? "TAP Gemini Companion"
  }
});
console.log(
  JSON.stringify(
    {
      url: server.url,
      authToken: server.authToken,
      discoveryFilePath: server.discoveryFilePath
    },
    null,
    2
  )
);
var shutdown = async () => {
  await server.close();
  process.exit(0);
};
process.on("SIGINT", () => {
  void shutdown();
});
process.on("SIGTERM", () => {
  void shutdown();
});
//# sourceMappingURL=gemini-ide-companion-runner.mjs.map