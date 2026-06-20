import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import { join } from "node:path";
import { TEST_DIR, resetTestDir, setTestEnv } from "./test-helpers.ts";

setTestEnv();

const { createTapConsentReceiptFromIdentity, TapConsentReceiptError } =
  await import("../tap-consent.ts");

const receiptsDir = join(TEST_DIR, "consent-receipts");
const secretsDir = join(TEST_DIR, "consent-secrets");
const ledgerDir = join(TEST_DIR, "receipts", "consent-ledger");

function readLedgerEntries(): Array<{ name: string; content: string }> {
  if (!fs.existsSync(ledgerDir)) {
    return [];
  }
  return fs
    .readdirSync(ledgerDir)
    .sort()
    .map((name) => ({
      name,
      content: fs.readFileSync(join(ledgerDir, name), "utf-8"),
    }));
}

beforeEach(() => {
  resetTestDir();
});

afterEach(() => {
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("tap-consent", () => {
  it("creates a drive receipt from the current identity tuple", () => {
    const created = createTapConsentReceiptFromIdentity(
      {
        agentId: "codex_1",
        agentName: "해",
        idLocked: true,
        nameConfirmed: true,
        address: {
          hostId: "host-a",
          clientId: "codex-wt3",
          conversationId: "thread-1",
          ownerClientId: "codex-wt3",
          routingAddress: "wt-3",
          slot: "wt-3",
          aliases: ["wt-3", "codex-wt3", "해"],
        },
        runtimeEnv: {
          routingSlot: "wt-3",
          instanceId: "codex-wt3",
          bridgeInstanceId: "codex-wt3",
          agentId: "codex_1",
          agentName: "해",
          codexTapAgentName: null,
          commsDir: TEST_DIR,
          stateDir: null,
          runtimeStateDir: null,
          repoRoot: TEST_DIR,
        },
        bootstrap: null,
        resolvedCurrentInstanceId: "codex-wt3",
        resolvedRoutingSlot: "wt-3",
        resolvedRoutingAddress: "wt-3",
        resolvedRoutingAliases: ["wt-3", "codex-wt3", "해"],
      },
      {
        receiptsDir,
        secretsDir,
        scope: "drive",
        allowedMethods: [
          "thread-follower-start-turn",
          "thread-follower-start-turn",
        ],
      },
    );

    expect(created.receipt).toMatchObject({
      scope: "drive",
      hostId: "host-a",
      conversationId: "thread-1",
      ownerClientId: "codex-wt3",
      issuedByClientId: "codex-wt3",
      allowedMethods: ["thread-follower-start-turn"],
    });
    expect(created.filePath).toContain(receiptsDir);
    expect(
      created.filePath
        .replace("consent-receipts", "consent-secrets")
        .replace(/\.json$/, ".token"),
    ).toContain(secretsDir);

    const ledgerEntries = readLedgerEntries();
    expect(ledgerEntries).toHaveLength(1);
    expect(ledgerEntries[0]?.name).toContain("-issued-");
    expect(ledgerEntries[0]?.content).toContain(
      `grant_id: "${created.receipt.id}"`,
    );
    expect(ledgerEntries[0]?.content).toContain('result: "granted"');
  });

  it("accepts explicit overrides only when they match the active owner tuple", () => {
    const created = createTapConsentReceiptFromIdentity(
      {
        agentId: "codex_1",
        agentName: "해",
        idLocked: true,
        nameConfirmed: true,
        address: {
          hostId: "host-a",
          clientId: "codex-wt3",
          conversationId: "thread-2",
          ownerClientId: "codex-wt3",
          routingAddress: "wt-3",
          slot: "wt-3",
          aliases: ["wt-3", "codex-wt3", "해"],
        },
        runtimeEnv: {
          routingSlot: "wt-3",
          instanceId: "codex-wt3",
          bridgeInstanceId: "codex-wt3",
          agentId: "codex_1",
          agentName: "해",
          codexTapAgentName: null,
          commsDir: TEST_DIR,
          stateDir: null,
          runtimeStateDir: null,
          repoRoot: TEST_DIR,
        },
        bootstrap: null,
        resolvedCurrentInstanceId: "codex-wt3",
        resolvedRoutingSlot: "wt-3",
        resolvedRoutingAddress: "wt-3",
        resolvedRoutingAliases: ["wt-3", "codex-wt3", "해"],
      },
      {
        receiptsDir,
        secretsDir,
        scope: "suggest",
        conversationId: "thread-2",
        ownerClientId: "codex-wt3",
        hostId: "host-a",
      },
    );

    expect(created.receipt).toMatchObject({
      scope: "suggest",
      conversationId: "thread-2",
      ownerClientId: "codex-wt3",
      issuedByClientId: "codex-wt3",
    });
  });

  it("rejects forged tuple overrides that do not match the active owner binding", () => {
    expect(() =>
      createTapConsentReceiptFromIdentity(
        {
          agentId: "codex_1",
          agentName: "해",
          idLocked: true,
          nameConfirmed: true,
          address: {
            hostId: "host-a",
            clientId: "codex-wt3",
            conversationId: "thread-1",
            ownerClientId: "codex-wt3",
            routingAddress: "wt-3",
            slot: "wt-3",
            aliases: ["wt-3", "codex-wt3", "해"],
          },
          runtimeEnv: {
            routingSlot: "wt-3",
            instanceId: "codex-wt3",
            bridgeInstanceId: "codex-wt3",
            agentId: "codex_1",
            agentName: "해",
            codexTapAgentName: null,
            commsDir: TEST_DIR,
            stateDir: null,
            runtimeStateDir: null,
            repoRoot: TEST_DIR,
          },
          bootstrap: null,
          resolvedCurrentInstanceId: "codex-wt3",
          resolvedRoutingSlot: "wt-3",
          resolvedRoutingAddress: "wt-3",
          resolvedRoutingAliases: ["wt-3", "codex-wt3", "해"],
        },
        {
          receiptsDir,
          secretsDir,
          conversationId: "victim-thread",
          ownerClientId: "victim-owner",
          hostId: "victim-host",
        },
      ),
    ).toThrow(TapConsentReceiptError);
  });

  it("rejects missing conversationId when the current identity is not attached", () => {
    expect(() =>
      createTapConsentReceiptFromIdentity(
        {
          agentId: "codex_1",
          agentName: "해",
          idLocked: true,
          nameConfirmed: true,
          address: {
            hostId: "host-a",
            clientId: "codex-wt3",
            conversationId: null,
            ownerClientId: "codex-wt3",
            routingAddress: "wt-3",
            slot: "wt-3",
            aliases: ["wt-3", "codex-wt3", "해"],
          },
          runtimeEnv: {
            routingSlot: "wt-3",
            instanceId: "codex-wt3",
            bridgeInstanceId: "codex-wt3",
            agentId: "codex_1",
            agentName: "해",
            codexTapAgentName: null,
            commsDir: TEST_DIR,
            stateDir: null,
            runtimeStateDir: null,
            repoRoot: TEST_DIR,
          },
          bootstrap: null,
          resolvedCurrentInstanceId: "codex-wt3",
          resolvedRoutingSlot: "wt-3",
          resolvedRoutingAddress: "wt-3",
          resolvedRoutingAliases: ["wt-3", "codex-wt3", "해"],
        },
        {
          receiptsDir,
          conversationId: "victim-thread",
        },
      ),
    ).toThrow(TapConsentReceiptError);
  });

  it("rejects missing ownerClientId when neither snapshot nor override provides one", () => {
    expect(() =>
      createTapConsentReceiptFromIdentity(
        {
          agentId: "codex_1",
          agentName: "해",
          idLocked: true,
          nameConfirmed: true,
          address: {
            hostId: "host-a",
            clientId: null,
            conversationId: "thread-1",
            ownerClientId: null,
            routingAddress: "wt-3",
            slot: "wt-3",
            aliases: ["wt-3", "해"],
          },
          runtimeEnv: {
            routingSlot: "wt-3",
            instanceId: null,
            bridgeInstanceId: null,
            agentId: "codex_1",
            agentName: "해",
            codexTapAgentName: null,
            commsDir: TEST_DIR,
            stateDir: null,
            runtimeStateDir: null,
            repoRoot: TEST_DIR,
          },
          bootstrap: null,
          resolvedCurrentInstanceId: null,
          resolvedRoutingSlot: "wt-3",
          resolvedRoutingAddress: "wt-3",
          resolvedRoutingAliases: ["wt-3", "해"],
        },
        {
          receiptsDir,
          secretsDir,
        },
      ),
    ).toThrow(TapConsentReceiptError);
  });

  it("rejects legacy pairToken callers", () => {
    expect(() =>
      createTapConsentReceiptFromIdentity(
        {
          agentId: "codex_1",
          agentName: "해",
          idLocked: true,
          nameConfirmed: true,
          address: {
            hostId: "host-a",
            clientId: "codex-wt3",
            conversationId: "thread-1",
            ownerClientId: "codex-wt3",
            routingAddress: "wt-3",
            slot: "wt-3",
            aliases: ["wt-3", "codex-wt3", "해"],
          },
          runtimeEnv: {
            routingSlot: "wt-3",
            instanceId: "codex-wt3",
            bridgeInstanceId: "codex-wt3",
            agentId: "codex_1",
            agentName: "해",
            codexTapAgentName: null,
            commsDir: TEST_DIR,
            stateDir: null,
            runtimeStateDir: null,
            repoRoot: TEST_DIR,
          },
          bootstrap: null,
          resolvedCurrentInstanceId: "codex-wt3",
          resolvedRoutingSlot: "wt-3",
          resolvedRoutingAddress: "wt-3",
          resolvedRoutingAliases: ["wt-3", "codex-wt3", "해"],
        },
        {
          receiptsDir,
          secretsDir,
          pairToken: "legacy-secret",
        } as never,
      ),
    ).toThrow(TapConsentReceiptError);
  });
});
