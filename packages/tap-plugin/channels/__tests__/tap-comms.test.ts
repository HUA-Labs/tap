import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { TEST_DIR, resetTestDir, setTestEnv } from "./test-helpers.ts";
import type { Heartbeat } from "../tap-utils.ts";

type ToolHandler = (request: {
  params: {
    name: string;
    arguments?: Record<string, unknown>;
  };
}) => Promise<{ content: Array<{ type: string; text: string }> }>;

type ListToolsHandler = () => Promise<{
  tools: Array<{
    name: string;
    description?: string;
    inputSchema?: {
      properties?: Record<string, unknown>;
    };
  }>;
}>;

type RegisteredHandler = (...args: unknown[]) => Promise<unknown>;
type RouteTapReplyDeliveryMock = (options: { fileName: string }) => Promise<{
  transport: string;
  delivered: boolean;
  fallbackToInbox: boolean;
  turnId: string | null;
  consentRef: string | null;
  warning: string | null;
}>;

function readRouteLease(agent: string): Record<string, unknown> {
  return JSON.parse(
    readFileSync(join(TEST_DIR, "route-leases", `${agent}.json`), "utf8"),
  ) as Record<string, unknown>;
}

const handlers = new Map<unknown, RegisteredHandler>();
const CALL_TOOL_REQUEST_SCHEMA = Symbol("CallToolRequestSchema");
const LIST_TOOLS_REQUEST_SCHEMA = Symbol("ListToolsRequestSchema");
let mockClientVersion: unknown = null;

class MockServer {
  setRequestHandler(schema: unknown, handler: RegisteredHandler): void {
    handlers.set(schema, handler);
  }

  async connect(): Promise<void> {
    // no-op for tests
  }

  getClientVersion(): unknown {
    return mockClientVersion;
  }

  getClientCapabilities(): null {
    return null;
  }
}

class MockStdioServerTransport {}

async function loadToolHandler(
  options: { routeTapReplyDelivery?: RouteTapReplyDeliveryMock } = {},
): Promise<ToolHandler> {
  handlers.clear();
  vi.resetModules();
  vi.doUnmock("../tap-drive-routing.ts");
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
  vi.doMock("../tap-watcher.ts", () => ({
    watchDir: vi.fn(),
  }));
  vi.doMock("../tap-poll-fallback.ts", () => ({
    startPollFallback: vi.fn(),
  }));
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
  if (options.routeTapReplyDelivery) {
    vi.doMock("../tap-drive-routing.ts", () => ({
      routeTapReplyDelivery: options.routeTapReplyDelivery,
    }));
  }

  await import("../tap-comms.ts");

  const handler = handlers.get(CALL_TOOL_REQUEST_SCHEMA) as
    | ToolHandler
    | undefined;
  if (!handler) {
    throw new Error("tap-comms call handler was not registered");
  }
  return handler;
}

async function loadListToolsHandler(): Promise<ListToolsHandler> {
  handlers.clear();
  vi.resetModules();
  vi.doUnmock("../tap-drive-routing.ts");
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
  vi.doMock("../tap-watcher.ts", () => ({
    watchDir: vi.fn(),
  }));
  vi.doMock("../tap-poll-fallback.ts", () => ({
    startPollFallback: vi.fn(),
  }));
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

  const handler = handlers.get(LIST_TOOLS_REQUEST_SCHEMA) as
    | ListToolsHandler
    | undefined;
  if (!handler) {
    throw new Error("tap-comms list tools handler was not registered");
  }
  return handler;
}

function writeRoutingRuntimeConflictSnapshot(
  overrides: Partial<{
    runtimeKey: string;
    agentId: string;
    agentName: string;
    pid: number;
  }> = {},
) {
  const stateDir = join(TEST_DIR, ".tap-comms");
  const registryDir = join(stateDir, "routing-runtimes");
  mkdirSync(registryDir, { recursive: true });
  writeFileSync(
    join(registryDir, "manual-conflict-runtime.json"),
    JSON.stringify(
      {
        version: 1,
        pid: overrides.pid ?? process.pid,
        runtimeKey: overrides.runtimeKey ?? "runtime:other",
        agentId: overrides.agentId ?? "codex_other",
        agentName: overrides.agentName ?? "담",
        idLocked: true,
        nameConfirmed: true,
        routingAddress: overrides.agentId ?? "codex_other",
        routingSlot: null,
        aliases: [
          overrides.agentId ?? "codex_other",
          overrides.agentName ?? "담",
        ],
        instanceId: "codex-other",
        stateDir,
        runtimeStateDir: join(
          TEST_DIR,
          ".tmp",
          "codex-app-server-bridge-codex-other",
        ),
        repoRoot: process.env.TAP_REPO_ROOT ?? null,
        updatedAt: "2099-01-01T00:00:00.000Z",
      },
      null,
      2,
    ),
    "utf-8",
  );
}

function cleanupTestDir(): void {
  try {
    rmSync(TEST_DIR, {
      recursive: true,
      force: true,
      maxRetries: 20,
      retryDelay: 100,
    });
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "EPERM"
    ) {
      return;
    }
    throw error;
  }
}

function writeStaleConsentDriveHeartbeat(): void {
  const stale = new Date(Date.now() - 40 * 60 * 1000).toISOString();
  writeFileSync(
    join(TEST_DIR, "heartbeats.json"),
    JSON.stringify(
      {
        "jun-app": {
          id: "jun-app",
          agent: "준",
          timestamp: stale,
          lastActivity: stale,
          status: "active",
          source: "mcp-direct",
          instanceId: "jun-app",
          connectHash: "instance:jun-app",
          address: {
            hostId: "/Users/devin/HUA/hua-comms",
            clientId: "jun-app",
            conversationId: "thread-jun-app",
            ownerClientId: "owner-jun-app",
            routingAddress: "준",
            slot: null,
            aliases: ["준"],
          },
          receiveTransports: ["consent-drive"],
          capabilities: {
            receiveTransports: ["consent-drive"],
            conversationId: "thread-jun-app",
            ownerClientId: "owner-jun-app",
          },
        },
      },
      null,
      2,
    ),
    "utf-8",
  );
}

function writeRoleAliasConflictHeartbeats(): void {
  const now = new Date().toISOString();
  const heartbeats: Record<string, Heartbeat> = {
    "yoon-app": {
      id: "yoon-app",
      agent: "윤",
      timestamp: now,
      lastActivity: now,
      status: "active",
      source: "mcp-direct",
      instanceId: "yoon-app",
      connectHash: "instance:yoon-app",
      address: {
        hostId: "/home/devin/hua-comms",
        clientId: "yoon-app",
        conversationId: "thread-yoon",
        ownerClientId: "owner-yoon",
        routingAddress: "윤",
        slot: null,
        aliases: ["codex", "윤"],
      },
      receiveTransports: ["mcp-channel"],
      capabilities: {
        receiveTransports: ["mcp-channel"],
      },
    },
    "bom-cli": {
      id: "bom-cli",
      agent: "봄",
      timestamp: now,
      lastActivity: now,
      status: "active",
      source: "mcp-direct",
      instanceId: "bom-cli",
      connectHash: "instance:bom-cli",
      address: {
        hostId: "/Users/devin/HUA/hua-comms",
        clientId: "bom-cli",
        conversationId: null,
        ownerClientId: null,
        routingAddress: "봄",
        slot: null,
        aliases: ["codex", "봄"],
      },
      receiveTransports: ["polling"],
      capabilities: {
        receiveTransports: ["polling"],
      },
    },
  };
  writeFileSync(
    join(TEST_DIR, "heartbeats.json"),
    JSON.stringify(heartbeats, null, 2),
    "utf-8",
  );
}

function buildCompleteConsentDriveHeartbeat(
  heartbeat: Heartbeat,
  overrides: Partial<Heartbeat> = {},
): Heartbeat {
  return {
    ...heartbeat,
    receiveTransports: ["consent-drive"],
    capabilities: {
      receiveTransports: ["consent-drive"],
      receiveTransportsSource: "heuristic",
      conversationId: "thread-ko-app",
      ownerClientId: "owner-ko-app",
    },
    address: {
      ...(heartbeat.address ?? {
        hostId: null,
        clientId: null,
        conversationId: null,
        ownerClientId: null,
        routingAddress: heartbeat.agent,
        slot: null,
        aliases: [heartbeat.agent],
      }),
      conversationId: "thread-ko-app",
      ownerClientId: "owner-ko-app",
    },
    ...overrides,
  };
}

beforeEach(() => {
  mockClientVersion = null;
  resetTestDir();
  setTestEnv();
  process.env.TAP_AGENT_NAME = "<set-per-session>";
  process.env.TAP_INSTANCE_ID = "codex-wt-1";
  process.env.TAP_REPO_ROOT = join(TEST_DIR, "repo");
  process.env.TAP_CODEX_OWNER_DISCOVERY = "0";
  mkdirSync(process.env.TAP_REPO_ROOT, { recursive: true });
});

afterEach(() => {
  delete process.env.TAP_INSTANCE_ID;
  delete process.env.TAP_REPO_ROOT;
  delete process.env.TAP_CODEX_OWNER_DISCOVERY;
  delete process.env.TAP_HEADLESS_REPLY_RECEIPT_DIR;
  vi.resetModules();
  vi.clearAllMocks();
  vi.doUnmock("@modelcontextprotocol/sdk/server/index.js");
  vi.doUnmock("@modelcontextprotocol/sdk/server/stdio.js");
  vi.doUnmock("@modelcontextprotocol/sdk/types.js");
  vi.doUnmock("../tap-watcher.ts");
  vi.doUnmock("../tap-poll-fallback.ts");
  vi.doUnmock("../tap-db.ts");
  cleanupTestDir();
});

describe("tap-comms heartbeat persistence", () => {
  it("exposes receiveTransports override in the tap_set_name schema", async () => {
    const listTools = await loadListToolsHandler();
    const tools = await listTools();
    const tapSetName = tools.tools.find((tool) => tool.name === "tap_set_name");

    expect(
      tapSetName?.inputSchema?.properties?.receiveTransports,
    ).toMatchObject({
      type: "array",
      items: {
        enum: ["mcp-channel", "consent-drive", "polling"],
      },
    });
  });

  it("exposes tap_register_capabilities with receiveTransports, conversationId, and ownerClientId", async () => {
    const listTools = await loadListToolsHandler();
    const tools = await listTools();
    const registerCaps = tools.tools.find(
      (tool) => tool.name === "tap_register_capabilities",
    );

    expect(
      registerCaps?.inputSchema?.properties?.receiveTransports,
    ).toMatchObject({
      type: "array",
      items: {
        enum: ["mcp-channel", "consent-drive", "polling"],
      },
    });
    expect(registerCaps?.inputSchema?.properties?.conversationId).toMatchObject(
      {
        type: "string",
      },
    );
    expect(registerCaps?.inputSchema?.properties?.ownerClientId).toMatchObject({
      type: "string",
    });
  });

  it("exposes tap_session_warmup with identity, capability, heartbeat, and who options", async () => {
    const listTools = await loadListToolsHandler();
    const tools = await listTools();
    const warmup = tools.tools.find(
      (tool) => tool.name === "tap_session_warmup",
    );

    expect(warmup?.inputSchema?.properties?.name).toMatchObject({
      type: "string",
    });
    expect(warmup?.inputSchema?.properties?.receiveTransports).toMatchObject({
      type: "array",
      items: {
        enum: ["mcp-channel", "consent-drive", "polling"],
      },
    });
    expect(warmup?.inputSchema?.properties?.conversationId).toMatchObject({
      type: "string",
    });
    expect(warmup?.inputSchema?.properties?.ownerClientId).toMatchObject({
      type: "string",
    });
    expect(warmup?.inputSchema?.properties?.status).toMatchObject({
      enum: ["active", "idle", "signing-off"],
    });
    expect(warmup?.inputSchema?.properties?.minutes).toMatchObject({
      type: "number",
    });
  });

  it("exposes dryRun on tap_reply and tap_reply_v2 schemas", async () => {
    const listTools = await loadListToolsHandler();
    const tools = await listTools();
    const tapReply = tools.tools.find((tool) => tool.name === "tap_reply");
    const tapReplyV2 = tools.tools.find((tool) => tool.name === "tap_reply_v2");

    expect(tapReply?.inputSchema?.properties?.dryRun).toMatchObject({
      type: "boolean",
    });
    expect(tapReply?.inputSchema?.properties?.target).toMatchObject({
      type: "object",
    });
    expect(tapReply?.inputSchema?.properties?.scope).toMatchObject({
      enum: ["observe", "suggest", "drive"],
    });
    expect(tapReply?.description).toContain("Use concrete agent names");
    expect(
      (tapReply?.inputSchema?.properties?.to as { description?: string })
        ?.description,
    ).toContain("Avoid broad role aliases");
    expect(tapReplyV2?.description).toContain("concrete routing metadata");
    expect(tapReplyV2?.inputSchema?.properties?.dryRun).toMatchObject({
      type: "boolean",
    });
  });

  it("does not write inbox files for tap_reply dry-run", async () => {
    const handler = await loadToolHandler();
    const inboxDir = join(TEST_DIR, "inbox");

    await handler({
      params: {
        name: "tap_set_name",
        arguments: { name: "담" },
      },
    });
    await handler({
      params: {
        name: "tap_register_capabilities",
        arguments: {
          receiveTransports: ["consent-drive"],
          conversationId: "thread-1",
          ownerClientId: "owner-1",
        },
      },
    });

    const result = await handler({
      params: {
        name: "tap_reply",
        arguments: {
          to: "wt-2",
          subject: "dry-run-check",
          content: "route only",
          dryRun: true,
        },
      },
    });

    expect(result.content[0]?.text).toContain("Dry run to wt-2");
    expect(result?.content[0]?.text).toContain(
      "no inbox files written and no Codex turn started",
    );
    expect(existsSync(inboxDir) ? readdirSync(inboxDir) : []).toEqual([]);
  });

  it("writes an opt-in headless tap_reply sent receipt after delivery", async () => {
    const handler = await loadToolHandler();
    const receiptDir = join(TEST_DIR, "headless-reply-receipts");
    mkdirSync(join(TEST_DIR, "inbox"), { recursive: true });
    process.env.TAP_HEADLESS_REPLY_RECEIPT_DIR = receiptDir;

    await handler({
      params: {
        name: "tap_set_name",
        arguments: { name: "준" },
      },
    });

    const result = await handler({
      params: {
        name: "tap_reply",
        arguments: {
          to: "전체",
          subject: "headless-receipt",
          content: "receipt body",
        },
      },
    });

    const files = readdirSync(receiptDir);
    expect(result.content[0]?.text).toContain("Sent to 전체");
    expect(files).toHaveLength(1);
    const receipt = JSON.parse(
      readFileSync(join(receiptDir, files[0]), "utf-8"),
    );
    expect(receipt).toMatchObject({
      version: 1,
      type: "tap_reply.sent",
      from: "wt-1",
      fromName: "준",
      to: "전체",
      subject: "headless-receipt",
      transport: "inbox",
      fallbackToInbox: true,
    });
    expect(receipt.fileName).toContain("headless-receipt.md");
    expect(receipt.inboxPath).toContain("headless-receipt.md");
  });

  it("writes durable inbox evidence before successful consent-drive delivery", async () => {
    let routedFileName = "";
    const routeTapReplyDelivery = vi.fn(
      async (options: { fileName: string }) => {
        routedFileName = options.fileName;
        expect(existsSync(join(TEST_DIR, "inbox", options.fileName))).toBe(
          true,
        );
        return {
          transport: "consent-drive",
          delivered: true,
          fallbackToInbox: false,
          turnId: "turn-ssot",
          consentRef: "receipt-ssot",
          warning: null,
        };
      },
    );
    const handler = await loadToolHandler({ routeTapReplyDelivery });
    const receiptDir = join(TEST_DIR, "headless-reply-receipts");
    process.env.TAP_HEADLESS_REPLY_RECEIPT_DIR = receiptDir;

    await handler({
      params: {
        name: "tap_set_name",
        arguments: { name: "온" },
      },
    });
    await handler({
      params: {
        name: "tap_register_capabilities",
        arguments: {
          receiveTransports: ["consent-drive"],
          conversationId: "thread-on",
          ownerClientId: "owner-on",
        },
      },
    });

    const result = await handler({
      params: {
        name: "tap_reply",
        arguments: {
          target: { routingAddress: "온" },
          subject: "consent-ssot",
          content: "live plus durable",
        },
      },
    });

    expect(routeTapReplyDelivery).toHaveBeenCalledTimes(1);
    expect(result?.content[0]?.text).toContain(
      "Sent to 온 via consent-drive (turn turn-ssot); inbox evidence inbox/",
    );
    expect(result.content[0]?.text).toContain(
      "tap_reply route: transport=consent-drive liveAttemptStatus=delivered fallbackToInbox=false inboxEvidence=inbox/",
    );

    const inboxFiles = readdirSync(join(TEST_DIR, "inbox"));
    expect(inboxFiles).toEqual([routedFileName]);
    const written = readFileSync(
      join(TEST_DIR, "inbox", routedFileName),
      "utf-8",
    );
    expect(written).toContain("subject: consent-ssot");
    expect(written).toContain("live plus durable");

    const receiptFiles = readdirSync(receiptDir);
    expect(receiptFiles).toHaveLength(1);
    const receipt = JSON.parse(
      readFileSync(join(receiptDir, receiptFiles[0]), "utf-8"),
    );
    expect(receipt).toMatchObject({
      transport: "consent-drive",
      fallbackToInbox: false,
      turnId: "turn-ssot",
      consentRef: "receipt-ssot",
      inboxPath: `inbox/${routedFileName}`,
    });
  });

  it("does not attempt live delivery when durable inbox evidence fails", async () => {
    const routeTapReplyDelivery = vi.fn(async () => ({
      transport: "consent-drive",
      delivered: true,
      fallbackToInbox: false,
      turnId: "turn-should-not-start",
      consentRef: "receipt-should-not-start",
      warning: null,
    }));
    const handler = await loadToolHandler({ routeTapReplyDelivery });

    await handler({
      params: {
        name: "tap_set_name",
        arguments: { name: "온" },
      },
    });
    await handler({
      params: {
        name: "tap_register_capabilities",
        arguments: {
          receiveTransports: ["consent-drive"],
          conversationId: "thread-on",
          ownerClientId: "owner-on",
        },
      },
    });
    const inboxDir = join(TEST_DIR, "inbox");
    mkdirSync(inboxDir, { recursive: true });
    chmodSync(inboxDir, 0o500);

    let result: { content: Array<{ type: string; text: string }> } | null =
      null;
    try {
      result = await handler({
        params: {
          name: "tap_reply",
          arguments: {
            target: { routingAddress: "온" },
            subject: "consent-ssot-fail",
            content: "must not start live route",
          },
        },
      });
    } finally {
      chmodSync(inboxDir, 0o700);
    }

    const text = result?.content[0]?.text ?? "";
    expect(routeTapReplyDelivery).not.toHaveBeenCalled();
    expect(text).toContain("durable inbox evidence write failed");
    expect(text).toContain("Live delivery was not attempted");
  });

  it("does not show stale consent-drive warning for simple inbox fallback", async () => {
    writeStaleConsentDriveHeartbeat();
    const handler = await loadToolHandler();

    await handler({
      params: {
        name: "tap_set_name",
        arguments: { name: "윤" },
      },
    });

    const result = await handler({
      params: {
        name: "tap_reply",
        arguments: {
          to: "준",
          subject: "stale-consent-simple",
          content: "route only",
          dryRun: true,
        },
      },
    });

    expect(result.content[0]?.text).toContain("Dry run to 준");
    expect(result.content[0]?.text).toContain("would use inbox");
    expect(result.content[0]?.text).not.toContain(
      "only stale-visible Codex presence matched",
    );
  });

  it("keeps stale consent-drive diagnostics for structured targets", async () => {
    writeStaleConsentDriveHeartbeat();
    const handler = await loadToolHandler();

    await handler({
      params: {
        name: "tap_set_name",
        arguments: { name: "윤" },
      },
    });

    const result = await handler({
      params: {
        name: "tap_reply",
        arguments: {
          target: { routingAddress: "준" },
          subject: "stale-consent-structured",
          content: "route only",
          dryRun: true,
        },
      },
    });

    expect(result.content[0]?.text).toContain("Rejected: structured target");
    expect(result.content[0]?.text).toContain("matched stale-visible presence");
    expect(result.content[0]?.text).toContain("fresh-for-routing");
  });

  it("blocks ambiguous broad role aliases on tap_reply dry-run", async () => {
    writeRoleAliasConflictHeartbeats();
    const handler = await loadToolHandler();
    const inboxDir = join(TEST_DIR, "inbox");

    await handler({
      params: {
        name: "tap_set_name",
        arguments: { name: "봄" },
      },
    });

    const result = await handler({
      params: {
        name: "tap_reply",
        arguments: {
          to: "codex",
          subject: "role-alias-ambiguous",
          content: "do not pick the tower runtime",
          dryRun: true,
        },
      },
    });

    const text = result.content[0]?.text ?? "";
    expect(text).toContain('Rejected: "codex"');
    expect(text).toContain("Blocked ambiguous role alias");
    expect(text).toContain("Use a concrete agent name");
    expect(text).toContain("structured target");
    expect(text).toContain("explicitly configured role mapping");
    expect(text).not.toContain("Dry run to codex");
    expect(existsSync(inboxDir) ? readdirSync(inboxDir) : []).toEqual([]);
  });

  it("preserves exact agent aliases when a broad role alias is blocked", async () => {
    writeRoleAliasConflictHeartbeats();
    const handler = await loadToolHandler();
    const inboxDir = join(TEST_DIR, "inbox");

    await handler({
      params: {
        name: "tap_set_name",
        arguments: { name: "윤" },
      },
    });

    const result = await handler({
      params: {
        name: "tap_reply",
        arguments: {
          to: "봄",
          subject: "role-alias-exact",
          content: "route concrete agent",
          dryRun: true,
        },
      },
    });

    const text = result.content[0]?.text ?? "";
    expect(text).toContain("Dry run to 봄");
    expect(text).toContain("would use polling");
    expect(text).not.toContain("Blocked ambiguous role alias");
    expect(existsSync(inboxDir) ? readdirSync(inboxDir) : []).toEqual([]);
  });

  it("allows structured concrete targets when broad role aliases are ambiguous", async () => {
    writeRoleAliasConflictHeartbeats();
    const handler = await loadToolHandler();
    const inboxDir = join(TEST_DIR, "inbox");

    await handler({
      params: {
        name: "tap_set_name",
        arguments: { name: "윤" },
      },
    });

    const result = await handler({
      params: {
        name: "tap_reply",
        arguments: {
          target: {
            routingAddress: "봄",
            hostId: "/Users/devin/HUA/hua-comms",
            clientId: "bom-cli",
          },
          subject: "role-alias-structured",
          content: "route concrete structured target",
          dryRun: true,
        },
      },
    });

    const text = result.content[0]?.text ?? "";
    expect(text).toContain("Dry run to 봄");
    expect(text).toContain("would use polling");
    expect(text).not.toContain("Blocked ambiguous role alias");
    expect(existsSync(inboxDir) ? readdirSync(inboxDir) : []).toEqual([]);
  });

  it("uses confirmed agent name as outbound return route when routing id is unknown", async () => {
    delete process.env.TAP_INSTANCE_ID;
    delete process.env.TAP_BRIDGE_INSTANCE_ID;
    delete process.env.TAP_RUNTIME_STATE_DIR;
    process.env.TAP_AGENT_ID = "unknown";
    process.env.TAP_AGENT_NAME = "준";
    const handler = await loadToolHandler();
    const inboxDir = join(TEST_DIR, "inbox");
    mkdirSync(inboxDir, { recursive: true });

    await handler({
      params: {
        name: "tap_reply",
        arguments: {
          to: "전체",
          subject: "return-route-sender",
          content: "check sender route",
        },
      },
    });

    const files = readdirSync(inboxDir);
    expect(files).toHaveLength(1);
    const written = readFileSync(join(inboxDir, files[0]), "utf-8");

    expect(written).toContain("from: 준");
    expect(written).not.toContain("from: unknown");
    expect(written).toContain('"routingAddress":"준"');
    expect(written).not.toContain('"routingAddress":"unknown"');
  });

  it("routes structured targets through tap_reply", async () => {
    const handler = await loadToolHandler();
    const inboxDir = join(TEST_DIR, "inbox");

    await handler({
      params: {
        name: "tap_set_name",
        arguments: { name: "담" },
      },
    });

    const result = await handler({
      params: {
        name: "tap_reply",
        arguments: {
          target: { routingAddress: "담" },
          subject: "structured-dry-run",
          content: "route only",
          dryRun: true,
        },
      },
    });

    expect(result.content[0]?.text).toContain("Dry run to 담");
    expect(result.content[0]?.text).toContain(
      "tap_reply route: transport=mcp-channel liveAttemptStatus=not-attempted fallbackToInbox=true",
    );
    expect(result.content[0]?.text).toContain(
      "no inbox files written and no Codex turn started",
    );
    expect(existsSync(inboxDir) ? readdirSync(inboxDir) : []).toEqual([]);
  });

  it("surfaces structured consent-drive dry-run route diagnostics", async () => {
    const handler = await loadToolHandler();
    const inboxDir = join(TEST_DIR, "inbox");

    await handler({
      params: {
        name: "tap_set_name",
        arguments: { name: "온" },
      },
    });
    await handler({
      params: {
        name: "tap_register_capabilities",
        arguments: {
          receiveTransports: ["consent-drive"],
          conversationId: "thread-on",
          ownerClientId: "owner-on",
        },
      },
    });

    const result = await handler({
      params: {
        name: "tap_reply",
        arguments: {
          target: { routingAddress: "온" },
          subject: "structured-consent-dry-run",
          content: "route only",
          dryRun: true,
        },
      },
    });

    expect(result.content[0]?.text).toContain("Dry run to 온");
    expect(result.content[0]?.text).toContain(
      "tap_reply route: transport=consent-drive liveAttemptStatus=would-attempt fallbackToInbox=false",
    );
    expect(result.content[0]?.text).toContain(
      "inboxEvidence=would-write:inbox/",
    );
    expect(result.content[0]?.text).toContain(
      "no inbox files written and no Codex turn started",
    );
    expect(existsSync(inboxDir) ? readdirSync(inboxDir) : []).toEqual([]);
  });

  it("validates drive envelope metadata on tap_reply", async () => {
    const handler = await loadToolHandler();

    const result = await handler({
      params: {
        name: "tap_reply",
        arguments: {
          target: { routingAddress: "wt-2", conversationId: "thread-1" },
          scope: "drive",
          action: "start-turn",
          subject: "drive-envelope",
          content: "missing consentRef",
        },
      },
    });

    expect(result.content[0]?.text).toContain(
      "Drive scope requires a non-empty consentRef",
    );
  });

  it("surfaces explicit envelope inbox-only behavior on tap_reply dry-run", async () => {
    const handler = await loadToolHandler();
    const inboxDir = join(TEST_DIR, "inbox");

    await handler({
      params: {
        name: "tap_set_name",
        arguments: { name: "담" },
      },
    });

    const result = await handler({
      params: {
        name: "tap_reply",
        arguments: {
          target: { routingAddress: "담" },
          scope: "observe",
          subject: "explicit-envelope-dry-run",
          content: "explicit envelope should stay audit-only",
          dryRun: true,
        },
      },
    });

    expect(result.content[0]?.text).toContain("Dry run to 담");
    expect(result.content[0]?.text).toContain(
      "tap_reply route: transport=mcp-channel liveAttemptStatus=not-attempted fallbackToInbox=true",
    );
    expect(result.content[0]?.text).toContain("explicit A2A envelope metadata");
    expect(result.content[0]?.text).toContain("inbox/audit evidence only");
    expect(result.content[0]?.text).toContain(
      "no inbox files written and no Codex turn started",
    );
    expect(existsSync(inboxDir) ? readdirSync(inboxDir) : []).toEqual([]);
  });

  it("rejects mismatched to and structured target on tap_reply", async () => {
    const handler = await loadToolHandler();

    const result = await handler({
      params: {
        name: "tap_reply",
        arguments: {
          to: "코",
          target: { routingAddress: "하" },
          subject: "mismatch",
          content: "should fail closed",
        },
      },
    });

    expect(result.content[0]?.text).toContain(
      '"to" and "target.routingAddress" disagree',
    );
  });

  it("uses the explicit receiveTransports override instead of the Codex heuristic", async () => {
    const handler = await loadToolHandler();
    const { loadHeartbeats } = await import("../tap-io.ts");
    const findNamedHeartbeat = () =>
      Object.values(loadHeartbeats()).find((entry) => entry.agent === "온");

    await handler({
      params: {
        name: "tap_set_name",
        arguments: {
          name: "온",
          receiveTransports: ["mcp-channel"],
        },
      },
    });

    expect(findNamedHeartbeat()?.receiveTransports).toEqual(["mcp-channel"]);

    await handler({
      params: {
        name: "tap_identity_probe",
        arguments: {},
      },
    });

    expect(findNamedHeartbeat()?.receiveTransports).toEqual(["mcp-channel"]);
    expect(findNamedHeartbeat()?.capabilities?.receiveTransportsSource).toBe(
      "explicit",
    );
  });

  it("registers capability metadata without changing the display name", async () => {
    const handler = await loadToolHandler();
    const { loadHeartbeats } = await import("../tap-io.ts");

    await handler({
      params: {
        name: "tap_set_name",
        arguments: { name: "온" },
      },
    });

    await handler({
      params: {
        name: "tap_register_capabilities",
        arguments: {
          receiveTransports: ["mcp-channel"],
          conversationId: "thread-42",
          ownerClientId: "owner-42",
        },
      },
    });

    const heartbeat = Object.values(loadHeartbeats()).find(
      (entry) => entry.agent === "온",
    );
    expect(heartbeat?.agent).toBe("온");
    expect(heartbeat?.receiveTransports).toEqual(["mcp-channel"]);
    expect(heartbeat?.capabilities?.receiveTransports).toEqual(["mcp-channel"]);
    expect(heartbeat?.capabilities?.conversationId).toBe("thread-42");
    expect(heartbeat?.capabilities?.ownerClientId).toBe("owner-42");
    expect(heartbeat?.address?.conversationId).toBe("thread-42");
    expect(heartbeat?.address?.ownerClientId).toBe("owner-42");
  });

  it("warms a session by setting identity, registering capabilities, sending heartbeat, and returning who", async () => {
    const handler = await loadToolHandler();
    const { loadHeartbeats } = await import("../tap-io.ts");

    const result = await handler({
      params: {
        name: "tap_session_warmup",
        arguments: {
          name: "온",
          receiveTransports: ["mcp-channel"],
          conversationId: "thread-42",
          ownerClientId: "owner-42",
          status: "idle",
          minutes: 10,
        },
      },
    });

    const payload = JSON.parse(result.content[0]!.text);
    expect(payload.ok).toBe(true);
    expect(payload.agent).toBe("온");
    expect(payload.status).toBe("idle");
    expect(payload.capabilities).toContain("Capabilities registered");
    expect(payload.who.self.agent).toContain("온");
    expect(payload.who.self.status).toBe("idle");

    const heartbeat = Object.values(loadHeartbeats()).find(
      (entry) => entry.agent === "온",
    );
    expect(heartbeat?.status).toBe("idle");
    expect(heartbeat?.receiveTransports).toEqual(["mcp-channel"]);
    expect(heartbeat?.capabilities?.conversationId).toBe("thread-42");
    expect(heartbeat?.capabilities?.ownerClientId).toBe("owner-42");
    expect(heartbeat?.address?.conversationId).toBe("thread-42");
    expect(heartbeat?.address?.ownerClientId).toBe("owner-42");
  });

  it("writes a non-authoritative route lease during live-capable tap_set_name", async () => {
    const handler = await loadToolHandler();

    await handler({
      params: {
        name: "tap_set_name",
        arguments: {
          name: "온",
          receiveTransports: ["mcp-channel"],
        },
      },
    });

    const lease = readRouteLease("온");
    const route = lease.route as Record<string, unknown>;
    const capability = lease.capability as Record<string, unknown>;
    expect(lease.schemaVersion).toBe(1);
    expect(lease.agent).toBe("온");
    expect(lease.source).toBe("tap_set_name");
    expect(lease.receiveTransports).toEqual(["mcp-channel"]);
    expect(typeof route.routingAddress).toBe("string");
    expect(route.routingAddress).not.toBe("");
    expect(route.conversationId).toBeNull();
    expect(route.ownerClientId).toBeNull();
    expect(capability.conversationId).toBeNull();
    expect(capability.ownerClientId).toBeNull();
    expect(lease.liveAuthority).toBe(false);
    expect(Date.parse(String(lease.expiresAt))).toBeGreaterThan(Date.now());
  });

  it("writes a non-authoritative route lease during warm-up registration", async () => {
    const handler = await loadToolHandler();

    await handler({
      params: {
        name: "tap_session_warmup",
        arguments: {
          name: "온",
          receiveTransports: ["consent-drive"],
          conversationId: "thread-42",
          ownerClientId: "owner-42",
        },
      },
    });

    const lease = readRouteLease("온");
    const route = lease.route as Record<string, unknown>;
    const capability = lease.capability as Record<string, unknown>;
    expect(lease.schemaVersion).toBe(1);
    expect(lease.agent).toBe("온");
    expect(lease.source).toBe("tap_session_warmup");
    expect(lease.receiveTransports).toEqual(["consent-drive"]);
    expect(route.conversationId).toBe("thread-42");
    expect(route.ownerClientId).toBe("owner-42");
    expect(capability.conversationId).toBe("thread-42");
    expect(capability.ownerClientId).toBe("owner-42");
    expect(lease.liveAuthority).toBe(false);
    expect(Date.parse(String(lease.expiresAt))).toBeGreaterThan(Date.now());
  });

  it("supports idempotent same-name warm-up and rejects accidental rename", async () => {
    const handler = await loadToolHandler();

    await handler({
      params: {
        name: "tap_session_warmup",
        arguments: {
          name: "온",
          receiveTransports: ["mcp-channel"],
        },
      },
    });

    const second = await handler({
      params: {
        name: "tap_session_warmup",
        arguments: {
          name: "온",
          receiveTransports: ["mcp-channel"],
        },
      },
    });
    expect(JSON.parse(second.content[0]!.text).notes).toContain(
      "identity=confirmed(온)",
    );

    const rejected = await handler({
      params: {
        name: "tap_session_warmup",
        arguments: {
          name: "다른",
        },
      },
    });
    expect(rejected.content[0]?.text).toContain(
      "does not rename live sessions",
    );
  });

  it("warms conversation-only consent-drive registration without preserving a stale owner", async () => {
    const handler = await loadToolHandler();
    const { loadHeartbeats } = await import("../tap-io.ts");
    const findNamedHeartbeat = () =>
      Object.values(loadHeartbeats()).find((entry) => entry.agent === "온");

    await handler({
      params: {
        name: "tap_session_warmup",
        arguments: {
          name: "온",
          receiveTransports: ["consent-drive"],
          conversationId: "thread-old",
          ownerClientId: "owner-old",
        },
      },
    });

    const result = await handler({
      params: {
        name: "tap_session_warmup",
        arguments: {
          name: "온",
          receiveTransports: ["consent-drive"],
          conversationId: "thread-new",
        },
      },
    });
    const payload = JSON.parse(result.content[0]!.text);

    expect(payload.capabilities).toContain("ownerDiscovery=unavailable");
    expect(findNamedHeartbeat()?.capabilities?.conversationId).toBe(
      "thread-new",
    );
    expect(findNamedHeartbeat()?.capabilities?.ownerClientId).toBeNull();
    expect(findNamedHeartbeat()?.address?.conversationId).toBe("thread-new");
    expect(findNamedHeartbeat()?.address?.ownerClientId).toBeNull();
  });

  it("does not carry stale route capabilities when warm-up takes over an existing heartbeat row", async () => {
    const handler = await loadToolHandler();
    const { loadHeartbeats, saveHeartbeats } = await import("../tap-io.ts");

    await handler({
      params: {
        name: "tap_set_name",
        arguments: {
          name: "온",
          receiveTransports: ["mcp-channel"],
        },
      },
    });

    const initialStore = loadHeartbeats();
    const [agentId, heartbeat] = Object.entries(initialStore).find(
      ([, entry]) => entry.agent === "온",
    )!;
    initialStore[agentId] = {
      ...heartbeat,
      receiveTransports: ["consent-drive"],
      capabilities: {
        receiveTransports: ["consent-drive"],
        conversationId: "thread-old",
        ownerClientId: "owner-old",
      },
      address: {
        ...heartbeat.address!,
        conversationId: "thread-old",
        ownerClientId: "owner-old",
      },
    };
    saveHeartbeats(initialStore);

    await handler({
      params: {
        name: "tap_reset_identity",
        arguments: {},
      },
    });

    const result = await handler({
      params: {
        name: "tap_session_warmup",
        arguments: {
          name: "새",
        },
      },
    });

    const payload = JSON.parse(result.content[0]!.text);
    expect(payload.agent).toBe("새");

    const updatedHeartbeat = Object.values(loadHeartbeats()).find(
      (entry) => entry.agent === "새",
    );
    expect(updatedHeartbeat?.capabilities?.conversationId).toBeNull();
    expect(updatedHeartbeat?.capabilities?.ownerClientId).toBeNull();
    expect(updatedHeartbeat?.address?.conversationId).toBeNull();
    expect(updatedHeartbeat?.address?.ownerClientId).toBeNull();
  });

  it("refreshes heartbeat timestamp when registering capabilities", async () => {
    const handler = await loadToolHandler();
    const { loadHeartbeats, saveHeartbeats } = await import("../tap-io.ts");

    await handler({
      params: {
        name: "tap_set_name",
        arguments: { name: "온" },
      },
    });

    const initialStore = loadHeartbeats();
    const [agentId, heartbeat] = Object.entries(initialStore).find(
      ([, entry]) => entry.agent === "온",
    )!;
    initialStore[agentId] = {
      ...heartbeat,
      timestamp: "2000-01-01T00:00:00.000Z",
    };
    saveHeartbeats(initialStore);

    await handler({
      params: {
        name: "tap_register_capabilities",
        arguments: {
          receiveTransports: ["mcp-channel"],
        },
      },
    });

    const updatedHeartbeat = Object.values(loadHeartbeats()).find(
      (entry) => entry.agent === "온",
    );
    expect(updatedHeartbeat?.timestamp).not.toBe("2000-01-01T00:00:00.000Z");
    expect(new Date(updatedHeartbeat!.timestamp).getTime()).toBeGreaterThan(
      new Date("2026-01-01T00:00:00.000Z").getTime(),
    );
  });

  it("refreshes the route lease when registering capabilities", async () => {
    const handler = await loadToolHandler();

    await handler({
      params: {
        name: "tap_set_name",
        arguments: { name: "온" },
      },
    });

    await handler({
      params: {
        name: "tap_register_capabilities",
        arguments: {
          receiveTransports: ["mcp-channel"],
          conversationId: "thread-42",
          ownerClientId: "owner-42",
        },
      },
    });

    const lease = readRouteLease("온");
    const route = lease.route as Record<string, unknown>;
    expect(lease.source).toBe("tap_register_capabilities");
    expect(lease.receiveTransports).toEqual(["mcp-channel"]);
    expect(route.conversationId).toBe("thread-42");
    expect(route.ownerClientId).toBe("owner-42");
    expect(lease.liveAuthority).toBe(false);
  });

  it("preserves the explicit receiveTransports override across tap_heartbeat writes", async () => {
    const handler = await loadToolHandler();
    const { loadHeartbeats } = await import("../tap-io.ts");
    const findNamedHeartbeat = () =>
      Object.values(loadHeartbeats()).find((entry) => entry.agent === "온");

    await handler({
      params: {
        name: "tap_set_name",
        arguments: {
          name: "온",
          receiveTransports: ["mcp-channel"],
        },
      },
    });

    await handler({
      params: {
        name: "tap_heartbeat",
        arguments: {
          status: "idle",
        },
      },
    });

    expect(findNamedHeartbeat()?.receiveTransports).toEqual(["mcp-channel"]);
  });

  it("preserves an already-warmed consent-drive tuple across ordinary tap_heartbeat writes", async () => {
    delete process.env.TAP_INSTANCE_ID;
    delete process.env.TAP_BRIDGE_INSTANCE_ID;
    delete process.env.TAP_RUNTIME_STATE_DIR;
    process.env.TAP_AGENT_ID = "ko_runtime";
    const handler = await loadToolHandler();
    const { loadHeartbeats, saveHeartbeats } = await import("../tap-io.ts");
    const findNamedHeartbeat = () =>
      Object.values(loadHeartbeats()).find((entry) => entry.agent === "코");

    await handler({
      params: {
        name: "tap_set_name",
        arguments: { name: "코" },
      },
    });

    const store = loadHeartbeats();
    const [agentId, heartbeat] = Object.entries(store).find(
      ([, entry]) => entry.agent === "코",
    )!;
    store[agentId] = buildCompleteConsentDriveHeartbeat(heartbeat);
    saveHeartbeats(store);

    await handler({
      params: {
        name: "tap_heartbeat",
        arguments: { status: "active" },
      },
    });

    expect(findNamedHeartbeat()?.receiveTransports).toEqual(["consent-drive"]);
    expect(findNamedHeartbeat()?.capabilities?.conversationId).toBe(
      "thread-ko-app",
    );
    expect(findNamedHeartbeat()?.capabilities?.ownerClientId).toBe(
      "owner-ko-app",
    );
    expect(findNamedHeartbeat()?.address?.conversationId).toBe("thread-ko-app");
    expect(findNamedHeartbeat()?.address?.ownerClientId).toBe("owner-ko-app");
  });

  it("preserves an already-warmed consent-drive tuple across same-name tap_set_name", async () => {
    delete process.env.TAP_INSTANCE_ID;
    delete process.env.TAP_BRIDGE_INSTANCE_ID;
    delete process.env.TAP_RUNTIME_STATE_DIR;
    process.env.TAP_AGENT_ID = "ko_runtime";
    const handler = await loadToolHandler();
    const { loadHeartbeats, saveHeartbeats } = await import("../tap-io.ts");
    const findNamedHeartbeat = () =>
      Object.values(loadHeartbeats()).find((entry) => entry.agent === "코");

    await handler({
      params: {
        name: "tap_set_name",
        arguments: { name: "코" },
      },
    });

    const store = loadHeartbeats();
    const [agentId, heartbeat] = Object.entries(store).find(
      ([, entry]) => entry.agent === "코",
    )!;
    store[agentId] = buildCompleteConsentDriveHeartbeat(heartbeat);
    saveHeartbeats(store);

    await handler({
      params: {
        name: "tap_set_name",
        arguments: { name: "코" },
      },
    });

    expect(findNamedHeartbeat()?.receiveTransports).toEqual(["consent-drive"]);
    expect(findNamedHeartbeat()?.capabilities?.conversationId).toBe(
      "thread-ko-app",
    );
    expect(findNamedHeartbeat()?.capabilities?.ownerClientId).toBe(
      "owner-ko-app",
    );
  });

  it("preserves an already-warmed consent-drive tuple across same-name warm-up activity", async () => {
    delete process.env.TAP_INSTANCE_ID;
    delete process.env.TAP_BRIDGE_INSTANCE_ID;
    delete process.env.TAP_RUNTIME_STATE_DIR;
    process.env.TAP_AGENT_ID = "ko_runtime";
    const handler = await loadToolHandler();
    const { loadHeartbeats, saveHeartbeats } = await import("../tap-io.ts");
    const findNamedHeartbeat = () =>
      Object.values(loadHeartbeats()).find((entry) => entry.agent === "코");

    await handler({
      params: {
        name: "tap_set_name",
        arguments: { name: "코" },
      },
    });

    const store = loadHeartbeats();
    const [agentId, heartbeat] = Object.entries(store).find(
      ([, entry]) => entry.agent === "코",
    )!;
    store[agentId] = buildCompleteConsentDriveHeartbeat(heartbeat);
    saveHeartbeats(store);

    await handler({
      params: {
        name: "tap_session_warmup",
        arguments: { name: "코" },
      },
    });

    expect(findNamedHeartbeat()?.receiveTransports).toEqual(["consent-drive"]);
    expect(findNamedHeartbeat()?.capabilities?.conversationId).toBe(
      "thread-ko-app",
    );
    expect(findNamedHeartbeat()?.capabilities?.ownerClientId).toBe(
      "owner-ko-app",
    );
  });

  it("does not rehydrate cleared consent-drive tuple metadata", async () => {
    delete process.env.TAP_INSTANCE_ID;
    delete process.env.TAP_BRIDGE_INSTANCE_ID;
    delete process.env.TAP_RUNTIME_STATE_DIR;
    process.env.TAP_AGENT_ID = "ko_runtime";
    const handler = await loadToolHandler();
    const { loadHeartbeats, saveHeartbeats } = await import("../tap-io.ts");
    const findNamedHeartbeat = () =>
      Object.values(loadHeartbeats()).find((entry) => entry.agent === "코");

    await handler({
      params: {
        name: "tap_set_name",
        arguments: { name: "코" },
      },
    });

    const store = loadHeartbeats();
    const [agentId, heartbeat] = Object.entries(store).find(
      ([, entry]) => entry.agent === "코",
    )!;
    store[agentId] = buildCompleteConsentDriveHeartbeat(heartbeat);
    saveHeartbeats(store);

    await handler({
      params: {
        name: "tap_register_capabilities",
        arguments: {
          conversationId: "",
          ownerClientId: "",
        },
      },
    });

    expect(findNamedHeartbeat()?.receiveTransports).toEqual(["consent-drive"]);
    expect(findNamedHeartbeat()?.capabilities?.conversationId).toBeNull();
    expect(findNamedHeartbeat()?.capabilities?.ownerClientId).toBeNull();
    expect(findNamedHeartbeat()?.address?.conversationId).toBeNull();
    expect(findNamedHeartbeat()?.address?.ownerClientId).toBeNull();
  });

  it("preserves registered conversationId across ordinary tap_heartbeat writes", async () => {
    const handler = await loadToolHandler();
    const { loadHeartbeats } = await import("../tap-io.ts");
    const findNamedHeartbeat = () =>
      Object.values(loadHeartbeats()).find((entry) => entry.agent === "온");

    await handler({
      params: {
        name: "tap_set_name",
        arguments: { name: "온" },
      },
    });

    await handler({
      params: {
        name: "tap_register_capabilities",
        arguments: {
          conversationId: "thread-42",
        },
      },
    });

    await handler({
      params: {
        name: "tap_heartbeat",
        arguments: {
          status: "active",
        },
      },
    });

    expect(findNamedHeartbeat()?.capabilities?.conversationId).toBe(
      "thread-42",
    );
    expect(findNamedHeartbeat()?.address?.conversationId).toBe("thread-42");
  });

  it("preserves registered ownerClientId across ordinary tap_heartbeat writes", async () => {
    const handler = await loadToolHandler();
    const { loadHeartbeats } = await import("../tap-io.ts");
    const findNamedHeartbeat = () =>
      Object.values(loadHeartbeats()).find((entry) => entry.agent === "온");

    await handler({
      params: {
        name: "tap_set_name",
        arguments: { name: "온" },
      },
    });

    await handler({
      params: {
        name: "tap_register_capabilities",
        arguments: {
          conversationId: "thread-42",
          ownerClientId: "owner-42",
        },
      },
    });

    await handler({
      params: {
        name: "tap_heartbeat",
        arguments: {
          status: "active",
        },
      },
    });

    expect(findNamedHeartbeat()?.capabilities?.conversationId).toBe(
      "thread-42",
    );
    expect(findNamedHeartbeat()?.capabilities?.ownerClientId).toBe("owner-42");
    expect(findNamedHeartbeat()?.address?.conversationId).toBe("thread-42");
    expect(findNamedHeartbeat()?.address?.ownerClientId).toBe("owner-42");
  });

  it("clears stale ownerClientId when registering a conversation without an owner", async () => {
    const handler = await loadToolHandler();
    const { loadHeartbeats } = await import("../tap-io.ts");
    const findNamedHeartbeat = () =>
      Object.values(loadHeartbeats()).find((entry) => entry.agent === "온");

    await handler({
      params: {
        name: "tap_set_name",
        arguments: { name: "온" },
      },
    });

    await handler({
      params: {
        name: "tap_register_capabilities",
        arguments: {
          conversationId: "thread-old",
          ownerClientId: "owner-old",
        },
      },
    });

    const result = await handler({
      params: {
        name: "tap_register_capabilities",
        arguments: {
          conversationId: "thread-new",
        },
      },
    });

    expect(findNamedHeartbeat()?.capabilities?.conversationId).toBe(
      "thread-new",
    );
    expect(findNamedHeartbeat()?.capabilities?.ownerClientId).toBeNull();
    expect(findNamedHeartbeat()?.address?.conversationId).toBe("thread-new");
    expect(findNamedHeartbeat()?.address?.ownerClientId).toBeNull();
    expect(result.content[0]?.text).toContain("ownerDiscovery=unavailable");
  });

  it("keeps heuristic receiveTransports when tap_set_name override is omitted", async () => {
    const handler = await loadToolHandler();
    const { loadHeartbeats } = await import("../tap-io.ts");
    const findNamedHeartbeat = () =>
      Object.values(loadHeartbeats()).find((entry) => entry.agent === "온");

    await handler({
      params: {
        name: "tap_set_name",
        arguments: { name: "온" },
      },
    });

    expect(findNamedHeartbeat()?.receiveTransports).toEqual(["consent-drive"]);
  });

  it("publishes polling receive transport for Codex MCP clients without a runtime tuple", async () => {
    delete process.env.TAP_INSTANCE_ID;
    delete process.env.TAP_BRIDGE_INSTANCE_ID;
    delete process.env.TAP_RUNTIME_STATE_DIR;
    process.env.TAP_AGENT_ID = "jun_cli";
    mockClientVersion = {
      name: "codex-mcp-client",
      title: "Codex",
      version: "0.136.0",
    };
    const handler = await loadToolHandler();
    const { loadHeartbeats } = await import("../tap-io.ts");

    await handler({
      params: {
        name: "tap_set_name",
        arguments: { name: "준" },
      },
    });

    const heartbeat = Object.values(loadHeartbeats()).find(
      (entry) => entry.agent === "준",
    );
    expect(heartbeat?.receiveTransports).toEqual(["polling"]);
    expect(heartbeat?.capabilities?.receiveTransports).toEqual(["polling"]);
    expect(heartbeat?.capabilities?.receiveTransportsSource).toBe("heuristic");
  });

  it("downgrades legacy Codex CLI mcp-channel heartbeats to polling", async () => {
    delete process.env.TAP_INSTANCE_ID;
    delete process.env.TAP_BRIDGE_INSTANCE_ID;
    delete process.env.TAP_RUNTIME_STATE_DIR;
    process.env.TAP_AGENT_ID = "jun_cli";
    mockClientVersion = {
      name: "codex-mcp-client",
      title: "Codex",
      version: "0.136.0",
    };
    const handler = await loadToolHandler();
    const { loadHeartbeats, saveHeartbeats } = await import("../tap-io.ts");

    saveHeartbeats({
      jun_cli: {
        id: "jun_cli",
        agent: "준",
        timestamp: "2026-06-01T00:00:00.000Z",
        lastActivity: "2026-06-01T00:00:00.000Z",
        status: "active",
        source: "mcp-direct",
        receiveTransports: ["mcp-channel"],
        capabilities: {
          receiveTransports: ["mcp-channel"],
        },
      },
    });

    await handler({
      params: {
        name: "tap_set_name",
        arguments: { name: "준" },
      },
    });

    const heartbeat = Object.values(loadHeartbeats()).find(
      (entry) => entry.agent === "준",
    );
    expect(heartbeat?.receiveTransports).toEqual(["polling"]);
    expect(heartbeat?.capabilities?.receiveTransports).toEqual(["polling"]);
    expect(heartbeat?.capabilities?.receiveTransportsSource).toBe("heuristic");
  });

  it("does not carry stale route capabilities across a rename", async () => {
    const handler = await loadToolHandler();
    const { loadHeartbeats, saveHeartbeats } = await import("../tap-io.ts");

    await handler({
      params: {
        name: "tap_set_name",
        arguments: {
          name: "온",
          receiveTransports: ["mcp-channel"],
        },
      },
    });

    const initialStore = loadHeartbeats();
    const [agentId, heartbeat] = Object.entries(initialStore).find(
      ([, entry]) => entry.agent === "온",
    )!;
    initialStore[agentId] = {
      ...heartbeat,
      receiveTransports: ["consent-drive"],
      capabilities: {
        receiveTransports: ["consent-drive"],
        conversationId: "thread-old",
        ownerClientId: "owner-old",
      },
      address: {
        ...heartbeat.address!,
        conversationId: "thread-old",
        ownerClientId: "owner-old",
      },
    };
    saveHeartbeats(initialStore);

    await handler({
      params: {
        name: "tap_set_name",
        arguments: { name: "새" },
      },
    });

    const renamedHeartbeat = Object.values(loadHeartbeats()).find(
      (entry) => entry.agent === "새",
    );
    expect(renamedHeartbeat?.receiveTransports).toEqual(["consent-drive"]);
    expect(renamedHeartbeat?.capabilities?.conversationId).toBeNull();
    expect(renamedHeartbeat?.capabilities?.ownerClientId).toBeNull();
    expect(renamedHeartbeat?.address?.conversationId).toBeNull();
    expect(renamedHeartbeat?.address?.ownerClientId).toBeNull();
  });

  it("removes the presence file when resetting identity", async () => {
    const handler = await loadToolHandler();
    const { loadHeartbeats } = await import("../tap-io.ts");

    await handler({
      params: {
        name: "tap_set_name",
        arguments: { name: "온" },
      },
    });

    const heartbeat = Object.values(loadHeartbeats()).find(
      (entry) => entry.agent === "온",
    );
    expect(heartbeat?.id).toBeTruthy();

    const presenceDir = join(TEST_DIR, "presence");
    const [presenceFile] = readdirSync(presenceDir);
    expect(presenceFile).toBeTruthy();

    await handler({
      params: {
        name: "tap_reset_identity",
      },
    });

    expect(
      Object.values(loadHeartbeats()).some((entry) => entry.agent === "온"),
    ).toBe(false);
    expect(existsSync(join(presenceDir, presenceFile!))).toBe(false);
  });

  it("rejects invalid receiveTransports overrides", async () => {
    const handler = await loadToolHandler();

    const result = await handler({
      params: {
        name: "tap_set_name",
        arguments: {
          name: "온",
          receiveTransports: ["bogus"],
        },
      },
    });

    expect(result.content[0]?.text).toContain(
      '"receiveTransports" must be an array containing only "mcp-channel", "consent-drive", and/or "polling"',
    );
  });

  it("warns that tap_set_name is process-local and needs bootstrap config for future runtimes", async () => {
    const handler = await loadToolHandler();

    const result = await handler({
      params: {
        name: "tap_set_name",
        arguments: { name: "온" },
      },
    });

    expect(result.content[0]?.text).toContain(
      "tap_set_name is process-local first",
    );
    expect(result.content[0]?.text).toContain(".mcp.json");
    expect(result.content[0]?.text).toContain("config.toml");
    expect(result.content[0]?.text).toContain("restart/reload");
  });

  it("warns that tap_set_name alone is not sufficient for cross-runtime realtime receive", async () => {
    process.env.TAP_STATE_DIR = join(TEST_DIR, ".tap-comms");
    process.env.TAP_RUNTIME_STATE_DIR = join(
      TEST_DIR,
      ".tmp",
      "codex-app-server-bridge-codex-wt-1",
    );
    mkdirSync(process.env.TAP_STATE_DIR, { recursive: true });
    mkdirSync(process.env.TAP_RUNTIME_STATE_DIR, { recursive: true });
    writeRoutingRuntimeConflictSnapshot();

    const handler = await loadToolHandler();
    const result = await handler({
      params: {
        name: "tap_set_name",
        arguments: { name: "온" },
      },
    });

    expect(result.content[0]?.text).toContain("other live MCP runtime(s)");
    expect(result.content[0]?.text).toContain(
      "tap_set_name alone is not sufficient for cross-runtime realtime receive",
    );
    expect(result.content[0]?.text).toContain("restart/reload");
  });
});
