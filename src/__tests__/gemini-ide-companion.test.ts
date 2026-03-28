import { afterEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  CallToolResultSchema,
  ListToolsResultSchema,
} from "@modelcontextprotocol/sdk/types.js";
import {
  startGeminiIdeCompanionServer,
  type GeminiIdeContext,
} from "../bridges/gemini-ide-companion.js";

const ACTIVE_SERVERS: Array<{ close(): Promise<void> }> = [];

function createNotificationWaiter(
  client: Client,
): <T>(method: string) => Promise<T> {
  const waiters = new Map<string, (params: unknown) => void>();

  client.fallbackNotificationHandler = async (notification) => {
    const waiter = waiters.get(notification.method);
    if (!waiter) {
      return;
    }

    waiters.delete(notification.method);
    waiter(notification.params);
  };

  return <T>(method: string) =>
    new Promise<T>((resolve) => {
      waiters.set(method, (params) => resolve(params as T));
    });
}

afterEach(async () => {
  while (ACTIVE_SERVERS.length > 0) {
    const server = ACTIVE_SERVERS.pop();
    if (server) {
      await server.close();
    }
  }
});

describe("startGeminiIdeCompanionServer", () => {
  it("rejects unauthorized requests", async () => {
    const server = await startGeminiIdeCompanionServer({
      authToken: "secret-token",
    });
    ACTIVE_SERVERS.push(server);

    const response = await fetch(server.url, {
      method: "GET",
    });

    expect(response.status).toBe(401);
  });

  it("serves tools/list and delivers ide/contextUpdate notifications", async () => {
    const server = await startGeminiIdeCompanionServer({
      authToken: "secret-token",
    });
    ACTIVE_SERVERS.push(server);

    const transport = new StreamableHTTPClientTransport(new URL(server.url), {
      requestInit: {
        headers: {
          Authorization: "Bearer secret-token",
        },
      },
    });
    const client = new Client({
      name: "gemini-ide-companion-test",
      version: "1.0.0",
    });

    const waitForNotification = createNotificationWaiter(client);
    const contextUpdate =
      waitForNotification<GeminiIdeContext>("ide/contextUpdate");

    await client.connect(transport);

    const tools = await client.request(
      { method: "tools/list", params: {} },
      ListToolsResultSchema,
    );
    expect(tools.tools.map((tool) => tool.name)).toEqual([
      "openDiff",
      "closeDiff",
    ]);

    const openDiff = await client.request(
      {
        method: "tools/call",
        params: {
          name: "openDiff",
          arguments: {
            filePath: "D:/HUA/hua-platform/README.md",
            newContent: "patched content",
          },
        },
      },
      CallToolResultSchema,
    );
    expect(openDiff.content).toEqual([]);

    const closeDiff = await client.request(
      {
        method: "tools/call",
        params: {
          name: "closeDiff",
          arguments: {
            filePath: "D:/HUA/hua-platform/README.md",
          },
        },
      },
      CallToolResultSchema,
    );
    expect(closeDiff.content).toHaveLength(1);
    expect(closeDiff.content[0]?.type).toBe("text");
    const closeDiffText = closeDiff.content[0];
    expect(closeDiffText?.type).toBe("text");
    expect(
      JSON.parse((closeDiffText as { type: "text"; text: string }).text),
    ).toEqual({
      content: "patched content",
    });

    await server.sendContextUpdate({
      workspaceState: {
        openFiles: [
          {
            path: "D:/HUA/hua-platform/README.md",
            timestamp: Date.now(),
            isActive: true,
          },
        ],
      },
    });

    await expect(contextUpdate).resolves.toEqual({
      workspaceState: {
        openFiles: [
          expect.objectContaining({
            path: "D:/HUA/hua-platform/README.md",
            isActive: true,
          }),
        ],
      },
    });

    await client.close();
  });

  it("delivers diffAccepted and diffRejected notifications for open diffs", async () => {
    const server = await startGeminiIdeCompanionServer({
      authToken: "secret-token",
    });
    ACTIVE_SERVERS.push(server);

    const transport = new StreamableHTTPClientTransport(new URL(server.url), {
      requestInit: {
        headers: {
          Authorization: "Bearer secret-token",
        },
      },
    });
    const client = new Client({
      name: "gemini-ide-companion-test",
      version: "1.0.0",
    });
    const waitForNotification = createNotificationWaiter(client);

    await client.connect(transport);

    const acceptedPath = "D:/HUA/hua-platform/src/accepted.ts";
    await client.request(
      {
        method: "tools/call",
        params: {
          name: "openDiff",
          arguments: {
            filePath: acceptedPath,
            newContent: "accepted content",
          },
        },
      },
      CallToolResultSchema,
    );

    const diffAccepted = waitForNotification<{
      filePath: string;
      content: string;
    }>("ide/diffAccepted");
    await server.sendDiffAccepted(acceptedPath);

    await expect(diffAccepted).resolves.toEqual({
      filePath: acceptedPath,
      content: "accepted content",
    });

    const rejectedPath = "D:/HUA/hua-platform/src/rejected.ts";
    await client.request(
      {
        method: "tools/call",
        params: {
          name: "openDiff",
          arguments: {
            filePath: rejectedPath,
            newContent: "rejected content",
          },
        },
      },
      CallToolResultSchema,
    );

    const diffRejected = waitForNotification<{ filePath: string }>(
      "ide/diffRejected",
    );
    await server.sendDiffRejected(rejectedPath);

    await expect(diffRejected).resolves.toEqual({
      filePath: rejectedPath,
    });

    await client.close();
  });
});
