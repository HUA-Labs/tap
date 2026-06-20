import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { TEST_DIR, resetTestDir, setTestEnv } from "./test-helpers.ts";

type ToolHandler = (request: {
  params: { name: string; arguments?: Record<string, unknown> };
}) => Promise<{ content: Array<{ type: string; text: string }> }>;

type RegisteredHandler = (...args: unknown[]) => Promise<unknown>;

const handlers = new Map<unknown, RegisteredHandler>();
const CALL_TOOL_REQUEST_SCHEMA = Symbol("CallToolRequestSchema");
const LIST_TOOLS_REQUEST_SCHEMA = Symbol("ListToolsRequestSchema");

class MockServer {
  setRequestHandler(schema: unknown, handler: RegisteredHandler): void {
    handlers.set(schema, handler);
  }
  async connect(): Promise<void> {}
  getClientVersion(): null {
    return null;
  }
  getClientCapabilities(): null {
    return null;
  }
}

class MockStdioServerTransport {}

async function loadToolHandler(): Promise<ToolHandler> {
  handlers.clear();
  vi.resetModules();
  vi.doMock("@modelcontextprotocol/sdk/server/index.js", () => ({
    Server: MockServer,
  }));
  vi.doMock("@modelcontextprotocol/sdk/server/stdio.js", () => ({
    StdioServerTransport: MockStdioServerTransport,
  }));
  vi.doMock("@modelcontextprotocol/sdk/types.js", () => ({
    CallToolRequestSchema: CALL_TOOL_REQUEST_SCHEMA,
    ListToolsRequestSchema: LIST_TOOLS_REQUEST_SCHEMA,
  }));
  vi.doMock("../tap-watcher.ts", () => ({ watchDir: vi.fn() }));
  vi.doMock("../tap-poll-fallback.ts", () => ({ startPollFallback: vi.fn() }));
  vi.doMock("../tap-db.ts", () => ({
    initDb: vi.fn(() => false),
    autoSyncOnStartup: vi.fn(),
    dbInsertMessage: vi.fn(),
    dbUpsertHeartbeat: vi.fn(),
    dbInsertReceipt: vi.fn(),
    dbGetStats: vi.fn(() => ({
      sent: {},
      received: {},
      broadcasts: 0,
      totalReceipts: 0,
      hud: null,
    })),
    dbSyncAll: vi.fn(),
  }));

  await import("../tap-comms.ts");

  const handler = handlers.get(CALL_TOOL_REQUEST_SCHEMA) as
    | ToolHandler
    | undefined;
  if (!handler) throw new Error("tap-comms call handler was not registered");
  return handler;
}

beforeEach(() => {
  resetTestDir();
  setTestEnv();
  process.env.TAP_INSTANCE_ID = "claude-test";
  process.env.TAP_AGENT_ID = "claude-test";
  delete process.env.TAP_AGENT_NAME;
  process.env.TAP_HOST_ID = "DEVIN";
  process.env.TAP_REPO_ROOT = join(TEST_DIR, "repo");
  mkdirSync(process.env.TAP_REPO_ROOT, { recursive: true });
  delete process.env.TAP_AUTOWRITE_MCP_JSON;
});

afterEach(() => {
  delete process.env.TAP_INSTANCE_ID;
  delete process.env.TAP_AGENT_ID;
  delete process.env.TAP_HOST_ID;
  delete process.env.TAP_REPO_ROOT;
  delete process.env.TAP_AUTOWRITE_MCP_JSON;
  vi.resetModules();
  vi.clearAllMocks();
  vi.doUnmock("@modelcontextprotocol/sdk/server/index.js");
  vi.doUnmock("@modelcontextprotocol/sdk/server/stdio.js");
  vi.doUnmock("@modelcontextprotocol/sdk/types.js");
  vi.doUnmock("../tap-watcher.ts");
  vi.doUnmock("../tap-poll-fallback.ts");
  vi.doUnmock("../tap-db.ts");
  rmSync(TEST_DIR, { recursive: true, force: true });
});

function seedMcpJson(env: Record<string, string> | undefined): string {
  const repoRoot = process.env.TAP_REPO_ROOT!;
  const mcpPath = join(repoRoot, ".mcp.json");
  const cfg: {
    mcpServers: Record<
      string,
      { command: string; env?: Record<string, string> }
    >;
  } = {
    mcpServers: {
      tap: env === undefined ? { command: "node" } : { command: "node", env },
    },
  };
  writeFileSync(mcpPath, JSON.stringify(cfg, null, 2) + "\n", "utf-8");
  return mcpPath;
}

function readMcpEnv(): Record<string, string> | undefined {
  const repoRoot = process.env.TAP_REPO_ROOT!;
  const mcpPath = join(repoRoot, ".mcp.json");
  if (!existsSync(mcpPath)) return undefined;
  const cfg = JSON.parse(readFileSync(mcpPath, "utf-8")) as {
    mcpServers?: Record<string, { env?: Record<string, string> }>;
  };
  return cfg.mcpServers?.tap?.env;
}

describe("tap_set_name → .mcp.json write-through (M382 Phase 2)", () => {
  it("writes TAP_AGENT_NAME when mcpServers.tap.env exists", async () => {
    const mcpPath = seedMcpJson({
      TAP_AGENT_NAME: "unnamed",
      TAP_COMMS_DIR: "/some/path",
    });
    expect(existsSync(mcpPath)).toBe(true);

    const handler = await loadToolHandler();
    await handler({
      params: { name: "tap_set_name", arguments: { name: "휘" } },
    });

    expect(readMcpEnv()?.TAP_AGENT_NAME).toBe("휘");
    // Other env keys preserved
    expect(readMcpEnv()?.TAP_COMMS_DIR).toBe("/some/path");
  });

  it("opt-out via TAP_AUTOWRITE_MCP_JSON=0 skips the write", async () => {
    seedMcpJson({ TAP_AGENT_NAME: "unnamed" });
    process.env.TAP_AUTOWRITE_MCP_JSON = "0";

    const handler = await loadToolHandler();
    await handler({
      params: { name: "tap_set_name", arguments: { name: "휘" } },
    });

    expect(readMcpEnv()?.TAP_AGENT_NAME).toBe("unnamed");
  });

  it("missing mcpServers.tap.env is a silent skip (no env created)", async () => {
    // Seed .mcp.json with mcpServers.tap but no env block
    seedMcpJson(undefined);

    const handler = await loadToolHandler();
    await handler({
      params: { name: "tap_set_name", arguments: { name: "휘" } },
    });

    // env should still be undefined (helper does not synthesize one)
    expect(readMcpEnv()).toBeUndefined();
  });

  it("missing .mcp.json is a no-op (does not throw, does not create file)", async () => {
    const repoRoot = process.env.TAP_REPO_ROOT!;
    const mcpPath = join(repoRoot, ".mcp.json");
    expect(existsSync(mcpPath)).toBe(false);

    const handler = await loadToolHandler();
    await handler({
      params: { name: "tap_set_name", arguments: { name: "휘" } },
    });

    expect(existsSync(mcpPath)).toBe(false);
  });
});

describe("tap_reset_identity → .mcp.json write-through (M382 Phase 2)", () => {
  it("resets TAP_AGENT_NAME to 'unnamed' when mcpServers.tap.env exists", async () => {
    seedMcpJson({ TAP_AGENT_NAME: "휘" });

    const handler = await loadToolHandler();
    // First set a name to establish identity, then reset
    await handler({
      params: { name: "tap_set_name", arguments: { name: "휘" } },
    });
    expect(readMcpEnv()?.TAP_AGENT_NAME).toBe("휘");

    await handler({ params: { name: "tap_reset_identity" } });

    expect(readMcpEnv()?.TAP_AGENT_NAME).toBe("unnamed");
  });

  it("clears tap-config.json towerName when this session held the seat", async () => {
    seedMcpJson({ TAP_AGENT_NAME: "unnamed" });
    const repoRoot = process.env.TAP_REPO_ROOT!;
    const cfgPath = join(repoRoot, "tap-config.json");
    writeFileSync(
      cfgPath,
      JSON.stringify({ towerName: "솔", commsDir: "/x" }, null, 2),
      "utf-8",
    );

    const handler = await loadToolHandler();
    await handler({
      params: {
        name: "tap_set_name",
        arguments: { name: "솔", tower: true },
      },
    });
    await handler({ params: { name: "tap_reset_identity" } });

    const tcfg = JSON.parse(readFileSync(cfgPath, "utf-8")) as Record<
      string,
      unknown
    >;
    expect(tcfg.towerName).toBeUndefined();
    expect(tcfg.commsDir).toBe("/x");
  });

  it("opt-out via TAP_AUTOWRITE_MCP_JSON=0 skips the reset write", async () => {
    seedMcpJson({ TAP_AGENT_NAME: "휘" });

    const handler = await loadToolHandler();
    await handler({
      params: { name: "tap_set_name", arguments: { name: "휘" } },
    });

    process.env.TAP_AUTOWRITE_MCP_JSON = "0";
    await handler({ params: { name: "tap_reset_identity" } });

    expect(readMcpEnv()?.TAP_AGENT_NAME).toBe("휘");
  });
});
