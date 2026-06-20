import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  existsSync,
  mkdirSync,
  readdirSync,
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
  // Claim a stable Codex-style single-config instance so bootstrap lands
  // on `codex` before the prior-owner tap_set_name call.
  process.env.TAP_INSTANCE_ID = "codex";
  process.env.TAP_AGENT_ID = "codex";
  delete process.env.TAP_AGENT_NAME;
  process.env.TAP_HOST_ID = "DEVIN";
  process.env.TAP_REPO_ROOT = join(TEST_DIR, "repo");
  mkdirSync(process.env.TAP_REPO_ROOT, { recursive: true });
});

afterEach(() => {
  delete process.env.TAP_INSTANCE_ID;
  delete process.env.TAP_AGENT_ID;
  delete process.env.TAP_HOST_ID;
  delete process.env.TAP_REPO_ROOT;
  delete process.env.TAP_INSTANCE_OWNERSHIP_AUDIT;
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

function seedPresenceFile(name: string, entry: Record<string, unknown>) {
  const dir = join(TEST_DIR, "presence");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `${name}.json`),
    JSON.stringify(entry, null, 2),
    "utf-8",
  );
}

describe("tap_set_name ownership-change pruning (M354)", () => {
  it("prunes prior-owner heartbeat + presence and writes an audit record", async () => {
    const priorEntry = {
      id: "윤",
      agent: "윤",
      timestamp: "2026-04-20T10:00:00.000Z",
      lastActivity: "2026-04-20T10:00:00.000Z",
      status: "active",
      instanceId: "codex",
      address: { hostId: "DEVIN", clientId: "codex" },
    };
    seedHeartbeats({ 윤: priorEntry });
    seedPresenceFile("윤", priorEntry);

    const handler = await loadToolHandler();
    const response = await handler({
      params: { name: "tap_set_name", arguments: { name: "해" } },
    });

    expect(response.content[0].text).toContain("해");

    const hbRaw = readFileSync(join(TEST_DIR, "heartbeats.json"), "utf-8");
    const store = JSON.parse(hbRaw) as Record<
      string,
      { agent?: string; instanceId?: string }
    >;
    // agent_id is locked to "codex" via TAP_AGENT_ID; only the display name
    // changes. The old key "윤" should be pruned, the current entry lands
    // under "codex" with agent: "해".
    expect(store["윤"]).toBeUndefined();
    expect(store["codex"]).toBeDefined();
    expect(store["codex"].agent).toBe("해");

    const presenceDir = join(TEST_DIR, "presence");
    const presenceFiles = readdirSync(presenceDir);
    expect(presenceFiles).not.toContain("윤.json");

    const auditDir = join(TEST_DIR, "audit", "instance-ownership-changes");
    expect(existsSync(auditDir)).toBe(true);
    const auditFiles = readdirSync(auditDir);
    expect(auditFiles).toHaveLength(1);
    expect(auditFiles[0]).toMatch(/^\d{8}-codex-prev-.+-next-.+\.md$/);
    const auditContent = readFileSync(
      join(auditDir, auditFiles[0]),
      "utf-8",
    );
    expect(auditContent).toContain('instance_id: "codex"');
    expect(auditContent).toContain("윤");
  });

  it("preserves cross-device presence on a different hostId", async () => {
    const remoteEntry = {
      id: "윤",
      agent: "윤",
      timestamp: "2026-04-20T10:00:00.000Z",
      lastActivity: "2026-04-20T10:00:00.000Z",
      status: "active",
      instanceId: "codex",
      address: { hostId: "sum-back", clientId: "codex" },
    };
    seedHeartbeats({ 윤: remoteEntry });
    seedPresenceFile("윤", remoteEntry);

    const handler = await loadToolHandler();
    await handler({
      params: { name: "tap_set_name", arguments: { name: "해" } },
    });

    const hbRaw = readFileSync(join(TEST_DIR, "heartbeats.json"), "utf-8");
    const store = JSON.parse(hbRaw) as Record<
      string,
      { agent?: string; instanceId?: string }
    >;
    // Cross-device 윤 stays in heartbeats so `tap_reply to: 윤` still
    // reaches the sum-back session.
    expect(store["윤"]).toBeDefined();
    expect(store["codex"]).toBeDefined();
    expect(store["codex"].agent).toBe("해");

    const presenceDir = join(TEST_DIR, "presence");
    expect(readdirSync(presenceDir)).toContain("윤.json");

    const auditDir = join(TEST_DIR, "audit", "instance-ownership-changes");
    // No cross-device entry was pruned, so no ownership-change audit fires.
    expect(existsSync(auditDir)).toBe(false);
  });

  it("closes the Gen 43 drift #8 shape — canonicalized alias key is pruned, instance key is overwritten", async () => {
    // Exact repro of the Gen 43 collision:
    //   store["codex"] held `{agent: "윤", instanceId: "codex"}` from a
    //   prior session, and `store["codex_윤"]` existed as a canonicalized
    //   alias key. Without M354, `tap_set_name("해")` leaves `store["codex_윤"]`
    //   lingering and the alias merge path surfaces 윤 metadata on 해's
    //   messages.
    const priorInstanceEntry = {
      id: "codex",
      agent: "윤",
      timestamp: "2026-04-20T10:00:00.000Z",
      lastActivity: "2026-04-20T10:00:00.000Z",
      status: "active",
      instanceId: "codex",
      address: { hostId: "DEVIN", clientId: "codex" },
    };
    const priorAliasEntry = {
      id: "codex_윤",
      agent: "윤",
      timestamp: "2026-04-20T10:00:00.000Z",
      lastActivity: "2026-04-20T10:00:00.000Z",
      status: "active",
      instanceId: "codex",
      address: { hostId: "DEVIN", clientId: "codex" },
    };
    seedHeartbeats({
      codex: priorInstanceEntry,
      codex_윤: priorAliasEntry,
    });
    seedPresenceFile("codex_윤", priorAliasEntry);

    const handler = await loadToolHandler();
    await handler({
      params: { name: "tap_set_name", arguments: { name: "해" } },
    });

    const hbRaw = readFileSync(join(TEST_DIR, "heartbeats.json"), "utf-8");
    const store = JSON.parse(hbRaw) as Record<
      string,
      { agent?: string; instanceId?: string }
    >;
    // Instance key overwritten with current session's display.
    expect(store["codex"]).toBeDefined();
    expect(store["codex"].agent).toBe("해");
    // Canonicalized alias key pruned — this is the drift #8 fix point.
    expect(store["codex_윤"]).toBeUndefined();

    const presenceFiles = readdirSync(join(TEST_DIR, "presence"));
    expect(presenceFiles).not.toContain("codex_윤.json");
  });

  it("leaves same-name prior entries on a different instance_id alone (M354 is instance-id-scoped, not name-scoped)", async () => {
    // Prior entry has the same display name ("해") but lives on a different
    // instance. M354 must not prune it — only instance_id ownership change
    // qualifies. Name-scoped pruning is M162's job (and it has stricter
    // gates).
    const priorOtherInstance = {
      id: "claude_wt1",
      agent: "해",
      timestamp: "2026-04-20T10:00:00.000Z",
      lastActivity: "2026-04-20T10:00:00.000Z",
      status: "active",
      instanceId: "claude-wt1",
      address: { hostId: "DEVIN", clientId: "claude-wt1" },
    };
    seedHeartbeats({ claude_wt1: priorOtherInstance });

    const handler = await loadToolHandler();
    await handler({
      params: { name: "tap_set_name", arguments: { name: "해" } },
    });

    const hbRaw = readFileSync(join(TEST_DIR, "heartbeats.json"), "utf-8");
    const store = JSON.parse(hbRaw) as Record<
      string,
      { agent?: string; instanceId?: string }
    >;
    // Different instance — preserved.
    expect(store["claude_wt1"]).toBeDefined();
    expect(store["claude_wt1"].agent).toBe("해");
    // Current session entry still written.
    expect(store["codex"]).toBeDefined();

    const auditDir = join(TEST_DIR, "audit", "instance-ownership-changes");
    // No prune happened, so no audit fires.
    expect(existsSync(auditDir)).toBe(false);
  });

  it("does not write an audit when disabled via env", async () => {
    process.env.TAP_INSTANCE_OWNERSHIP_AUDIT = "0";
    const priorEntry = {
      id: "윤",
      agent: "윤",
      timestamp: "2026-04-20T10:00:00.000Z",
      lastActivity: "2026-04-20T10:00:00.000Z",
      status: "active",
      instanceId: "codex",
      address: { hostId: "DEVIN", clientId: "codex" },
    };
    seedHeartbeats({ 윤: priorEntry });

    const handler = await loadToolHandler();
    await handler({
      params: { name: "tap_set_name", arguments: { name: "해" } },
    });

    // Prune still happened in the store
    const hbRaw = readFileSync(join(TEST_DIR, "heartbeats.json"), "utf-8");
    const store = JSON.parse(hbRaw) as Record<string, unknown>;
    expect(store["윤"]).toBeUndefined();
    expect(store["codex"]).toBeDefined();

    // but audit file does not exist
    const auditDir = join(TEST_DIR, "audit", "instance-ownership-changes");
    expect(existsSync(auditDir)).toBe(false);
  });
});
