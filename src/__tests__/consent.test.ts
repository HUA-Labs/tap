import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  ConsentReceiptError,
  consumeConsentReceipt,
  createConsentReceipt,
  prepareConsentReceipt,
} from "../transport/consent.js";

let tmpDir: string;
let receiptsDir: string;
let secretsDir: string;

function getSecretPath(receiptId: string): string {
  return path.join(secretsDir, `${receiptId}.token`);
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tap-consent-test-"));
  receiptsDir = path.join(tmpDir, "receipts");
  secretsDir = path.join(tmpDir, "secrets");
});

afterEach(() => {
  delete process.env.TAP_CONSENT_RECEIPTS_DIR;
  delete process.env.TAP_CONSENT_SECRETS_DIR;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("consent receipts", () => {
  it("creates and consumes one-shot drive receipts through the local secret store", () => {
    const created = createConsentReceipt({
      receiptsDir,
      secretsDir,
      scope: "drive",
      hostId: "ipc-host",
      conversationId: "conv-1",
      ownerClientId: "owner-client",
      issuedByClientId: "owner-client",
      allowedMethods: ["thread-follower-start-turn"],
      now: new Date("2026-04-17T00:00:00.000Z"),
    });

    const secretPath = getSecretPath(created.receipt.id);
    expect(fs.existsSync(created.filePath)).toBe(true);
    expect(fs.existsSync(secretPath)).toBe(true);

    const consumed = consumeConsentReceipt({
      receiptsDir,
      secretsDir,
      consentRef: created.receipt.id,
      requiredScope: "drive",
      method: "thread-follower-start-turn",
      hostId: "ipc-host",
      conversationId: "conv-1",
      ownerClientId: "owner-client",
      now: new Date("2026-04-17T00:00:10.000Z"),
    });

    expect(consumed).toMatchObject({
      id: created.receipt.id,
      scope: "drive",
      conversationId: "conv-1",
      ownerClientId: "owner-client",
    });
    expect(fs.existsSync(created.filePath)).toBe(false);
    expect(fs.existsSync(secretPath)).toBe(false);
    expect(() =>
      consumeConsentReceipt({
        receiptsDir,
        secretsDir,
        consentRef: created.receipt.id,
        requiredScope: "drive",
        method: "thread-follower-start-turn",
        hostId: "ipc-host",
        conversationId: "conv-1",
        ownerClientId: "owner-client",
        now: new Date("2026-04-17T00:00:11.000Z"),
      }),
    ).toThrow("Consent receipt");
  });

  it("enforces allowed method and ttl bindings", () => {
    const methodReceipt = createConsentReceipt({
      receiptsDir,
      secretsDir,
      scope: "drive",
      hostId: "ipc-host",
      conversationId: "conv-1",
      ownerClientId: "owner-client",
      allowedMethods: ["thread-follower-start-turn"],
      now: new Date("2026-04-17T00:00:00.000Z"),
    });

    expect(() =>
      consumeConsentReceipt({
        receiptsDir,
        secretsDir,
        consentRef: methodReceipt.receipt.id,
        requiredScope: "drive",
        method: "thread-follower-steer-turn",
        hostId: "ipc-host",
        conversationId: "conv-1",
        ownerClientId: "owner-client",
        now: new Date("2026-04-17T00:00:01.000Z"),
      }),
    ).toThrow(ConsentReceiptError);
    expect(fs.existsSync(getSecretPath(methodReceipt.receipt.id))).toBe(false);

    const ttlReceipt = createConsentReceipt({
      receiptsDir,
      secretsDir,
      scope: "drive",
      hostId: "ipc-host",
      conversationId: "conv-2",
      ownerClientId: "owner-client",
      ttlSeconds: 1,
      now: new Date("2026-04-17T00:00:00.000Z"),
    });

    expect(() =>
      consumeConsentReceipt({
        receiptsDir,
        secretsDir,
        consentRef: ttlReceipt.receipt.id,
        requiredScope: "drive",
        method: "thread-follower-start-turn",
        hostId: "ipc-host",
        conversationId: "conv-2",
        ownerClientId: "owner-client",
        now: new Date("2026-04-17T00:00:02.000Z"),
      }),
    ).toThrow(ConsentReceiptError);
  });

  it("resolves env-configured receipt and secret directories when consuming tap-minted receipts", () => {
    const overrideReceiptsDir = path.join(tmpDir, "override-receipts");
    const overrideSecretsDir = path.join(tmpDir, "override-secrets");
    process.env.TAP_CONSENT_RECEIPTS_DIR = overrideReceiptsDir;
    process.env.TAP_CONSENT_SECRETS_DIR = overrideSecretsDir;

    const created = createConsentReceipt({
      scope: "drive",
      hostId: "ipc-host",
      conversationId: "conv-env",
      ownerClientId: "owner-client",
      allowedMethods: ["thread-follower-start-turn"],
      now: new Date("2026-04-17T00:00:00.000Z"),
    });

    const consumed = consumeConsentReceipt({
      consentRef: created.receipt.id,
      requiredScope: "drive",
      method: "thread-follower-start-turn",
      hostId: "ipc-host",
      conversationId: "conv-env",
      ownerClientId: "owner-client",
      now: new Date("2026-04-17T00:00:01.000Z"),
    });

    expect(consumed.id).toBe(created.receipt.id);
    expect(fs.existsSync(created.filePath)).toBe(false);
    expect(
      fs.existsSync(
        path.join(overrideSecretsDir, `${created.receipt.id}.token`),
      ),
    ).toBe(false);
  });

  it("rejects consent artifacts that were rewritten after mint", () => {
    const created = createConsentReceipt({
      receiptsDir,
      secretsDir,
      scope: "drive",
      hostId: "ipc-host",
      conversationId: "conv-tamper",
      ownerClientId: "owner-client",
      allowedMethods: ["thread-follower-start-turn"],
      now: new Date("2026-04-17T00:00:00.000Z"),
    });

    const secretPath = getSecretPath(created.receipt.id);
    const receiptBody = fs.readFileSync(created.filePath, "utf-8");
    const secretBody = fs.readFileSync(secretPath, "utf-8");
    fs.writeFileSync(created.filePath, receiptBody, "utf-8");
    fs.writeFileSync(secretPath, secretBody, {
      encoding: "utf-8",
      mode: 0o600,
    });
    const tamperTime = new Date(Date.now() + 60_000);
    fs.utimesSync(created.filePath, tamperTime, tamperTime);
    fs.utimesSync(secretPath, tamperTime, tamperTime);

    expect(() =>
      consumeConsentReceipt({
        receiptsDir,
        secretsDir,
        consentRef: created.receipt.id,
        requiredScope: "drive",
        method: "thread-follower-start-turn",
        hostId: "ipc-host",
        conversationId: "conv-tamper",
        ownerClientId: "owner-client",
        now: new Date("2026-04-17T00:00:01.000Z"),
      }),
    ).toThrow("timestamp drift");
  });

  it("atomically reserves a consent receipt so concurrent prepare calls cannot both pass", () => {
    const created = createConsentReceipt({
      receiptsDir,
      secretsDir,
      scope: "drive",
      hostId: "ipc-host",
      conversationId: "conv-atomic",
      ownerClientId: "owner-client",
      allowedMethods: ["thread-follower-start-turn"],
      now: new Date("2026-04-17T00:00:00.000Z"),
    });

    const first = prepareConsentReceipt({
      receiptsDir,
      secretsDir,
      consentRef: created.receipt.id,
      requiredScope: "drive",
      method: "thread-follower-start-turn",
      hostId: "ipc-host",
      conversationId: "conv-atomic",
      ownerClientId: "owner-client",
      reservationOwnerId: "bridge-a",
      now: new Date("2026-04-17T00:00:01.000Z"),
    });

    expect(() =>
      prepareConsentReceipt({
        receiptsDir,
        secretsDir,
        consentRef: created.receipt.id,
        requiredScope: "drive",
        method: "thread-follower-start-turn",
        hostId: "ipc-host",
        conversationId: "conv-atomic",
        ownerClientId: "owner-client",
        reservationOwnerId: "bridge-b",
        now: new Date("2026-04-17T00:00:01.000Z"),
      }),
    ).toThrow("already reserved or consumed");
    expect(fs.existsSync(getSecretPath(created.receipt.id))).toBe(true);

    first.abort();

    const retried = prepareConsentReceipt({
      receiptsDir,
      secretsDir,
      consentRef: created.receipt.id,
      requiredScope: "drive",
      method: "thread-follower-start-turn",
      hostId: "ipc-host",
      conversationId: "conv-atomic",
      ownerClientId: "owner-client",
      reservationOwnerId: "bridge-a",
      now: new Date("2026-04-17T00:00:02.000Z"),
    });
    retried.commit();

    expect(fs.existsSync(created.filePath)).toBe(false);
    expect(fs.existsSync(getSecretPath(created.receipt.id))).toBe(false);
  });

  it("blocks stale reserved receipts while a live process still owns them", () => {
    const created = createConsentReceipt({
      receiptsDir,
      secretsDir,
      scope: "drive",
      hostId: "ipc-host",
      conversationId: "conv-crash",
      ownerClientId: "owner-client",
      allowedMethods: ["thread-follower-start-turn"],
      now: new Date("2026-04-17T00:00:00.000Z"),
    });

    const first = prepareConsentReceipt({
      receiptsDir,
      secretsDir,
      consentRef: created.receipt.id,
      requiredScope: "drive",
      method: "thread-follower-start-turn",
      hostId: "ipc-host",
      conversationId: "conv-crash",
      ownerClientId: "owner-client",
      reservationOwnerId: "bridge-a",
      now: new Date("2026-04-17T00:00:01.000Z"),
    });

    expect(() =>
      prepareConsentReceipt({
        receiptsDir,
        secretsDir,
        consentRef: created.receipt.id,
        requiredScope: "drive",
        method: "thread-follower-start-turn",
        hostId: "ipc-host",
        conversationId: "conv-crash",
        ownerClientId: "owner-client",
        reservationOwnerId: "bridge-a",
        now: new Date("2026-04-17T00:00:15.000Z"),
      }),
    ).toThrow("already reserved or consumed");

    expect(() =>
      prepareConsentReceipt({
        receiptsDir,
        secretsDir,
        consentRef: created.receipt.id,
        requiredScope: "drive",
        method: "thread-follower-start-turn",
        hostId: "ipc-host",
        conversationId: "conv-crash",
        ownerClientId: "owner-client",
        reservationOwnerId: "bridge-a",
        now: new Date("2026-04-17T00:00:32.000Z"),
      }),
    ).toThrow("already reserved or consumed");

    expect(() =>
      prepareConsentReceipt({
        receiptsDir,
        secretsDir,
        consentRef: created.receipt.id,
        requiredScope: "drive",
        method: "thread-follower-start-turn",
        hostId: "ipc-host",
        conversationId: "conv-crash",
        ownerClientId: "owner-client",
        reservationOwnerId: "bridge-b",
        now: new Date("2026-04-17T00:00:32.000Z"),
      }),
    ).toThrow("already reserved or consumed");

    first.abort();
    expect(fs.existsSync(created.filePath)).toBe(true);
    expect(fs.existsSync(getSecretPath(created.receipt.id))).toBe(true);
  });

  it("rejects same-path receipt and secret directories", () => {
    expect(() =>
      createConsentReceipt({
        receiptsDir,
        secretsDir: receiptsDir,
        conversationId: "conv-3",
        ownerClientId: "owner-client",
      }),
    ).toThrow(ConsentReceiptError);
  });
});
