import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
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
  process.env.TAP_INSTANCE_ID = "codex-wt-1";
  process.env.TAP_REPO_ROOT = join(TEST_DIR, "repo");
  mkdirSync(process.env.TAP_REPO_ROOT, { recursive: true });
});

afterEach(() => {
  delete process.env.TAP_INSTANCE_ID;
  delete process.env.TAP_REPO_ROOT;
  delete process.env.TAP_SLOT_COLLISION_AUDIT;
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

function seedHeartbeats(store: Record<string, unknown>) {
  mkdirSync(TEST_DIR, { recursive: true });
  writeFileSync(
    join(TEST_DIR, "heartbeats.json"),
    JSON.stringify(store, null, 2),
    "utf-8",
  );
}

describe("tap_who slot collision audit (M353)", () => {
  it("writes a slot-collision audit record when tap_who surfaces a stale-by-newer entry", async () => {
    const now = Date.now();
    const older = new Date(now - 5_000).toISOString();
    const newer = new Date(now - 1_000).toISOString();
    seedHeartbeats({
      claude_wt9_old: {
        id: "claude_wt9_old",
        agent: "결",
        timestamp: older,
        lastActivity: older,
        status: "active",
        source: "mcp-direct",
        instanceId: "claude-wt9",
        connectHash: "instance:claude-wt9-old",
      },
      claude_wt9_new: {
        id: "claude_wt9_new",
        agent: "담",
        timestamp: newer,
        lastActivity: newer,
        status: "active",
        source: "mcp-direct",
        instanceId: "claude-wt9",
        connectHash: "instance:claude-wt9-new",
      },
    });

    const handler = await loadToolHandler();
    const response = await handler({
      params: { name: "tap_who", arguments: { minutes: 10 } },
    });
    const payload = JSON.parse(response.content[0].text);

    const byId = Object.fromEntries(
      payload.agents.map((a: { id: string }) => [a.id, a]),
    );
    expect(byId.claude_wt9_new.slotStatus).toBe("active");
    expect(byId.claude_wt9_old.slotStatus).toBe("stale-by-newer");

    const auditDir = join(TEST_DIR, "audit", "slot-collisions");
    expect(existsSync(auditDir)).toBe(true);
    const files = readdirSync(auditDir);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^\d{8}-wt-9-loser-.+-winner-.+\.md$/);

    const content = readFileSync(join(auditDir, files[0]), "utf-8");
    expect(content).toContain('type: "slot-collision-audit"');
    expect(content).toContain('slot: "wt-9"');
    expect(content).toContain("claude_wt9_new");
    expect(content).toContain("claude_wt9_old");
  });

  it("does not write any audit record when there is no slot collision", async () => {
    const now = new Date().toISOString();
    seedHeartbeats({
      claude_wt1: {
        id: "claude_wt1",
        agent: "결",
        timestamp: now,
        lastActivity: now,
        status: "active",
        source: "mcp-direct",
        instanceId: "claude-wt9",
        connectHash: "instance:claude-wt1",
      },
    });

    const handler = await loadToolHandler();
    await handler({
      params: { name: "tap_who", arguments: { minutes: 10 } },
    });

    const auditDir = join(TEST_DIR, "audit", "slot-collisions");
    expect(existsSync(auditDir)).toBe(false);
  });

  it("skips the audit record when TAP_SLOT_COLLISION_AUDIT is disabled", async () => {
    process.env.TAP_SLOT_COLLISION_AUDIT = "0";
    const now = Date.now();
    const older = new Date(now - 5_000).toISOString();
    const newer = new Date(now - 1_000).toISOString();
    seedHeartbeats({
      claude_wt9_old: {
        id: "claude_wt9_old",
        agent: "결",
        timestamp: older,
        lastActivity: older,
        status: "active",
        source: "mcp-direct",
        instanceId: "claude-wt9",
        connectHash: "instance:claude-wt9-old",
      },
      claude_wt9_new: {
        id: "claude_wt9_new",
        agent: "담",
        timestamp: newer,
        lastActivity: newer,
        status: "active",
        source: "mcp-direct",
        instanceId: "claude-wt9",
        connectHash: "instance:claude-wt9-new",
      },
    });

    const handler = await loadToolHandler();
    const response = await handler({
      params: { name: "tap_who", arguments: { minutes: 10 } },
    });
    const payload = JSON.parse(response.content[0].text);
    // slotStatus still annotated in the response
    const byId = Object.fromEntries(
      payload.agents.map((a: { id: string }) => [a.id, a]),
    );
    expect(byId.claude_wt9_new.slotStatus).toBe("active");
    expect(byId.claude_wt9_old.slotStatus).toBe("stale-by-newer");

    // but no file on disk
    const auditDir = join(TEST_DIR, "audit", "slot-collisions");
    expect(existsSync(auditDir)).toBe(false);
  });
});
