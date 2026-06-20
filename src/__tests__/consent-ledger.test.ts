import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { writeConsentLedgerEvent } from "../transport/consent-ledger.js";

let tmpDir: string;
let originalConsentLedgerEnv: string | undefined;

function readLedgerEntries(
  commsDir: string,
): Array<{ name: string; content: string }> {
  const ledgerDir = path.join(commsDir, "receipts", "consent-ledger");
  if (!fs.existsSync(ledgerDir)) {
    return [];
  }
  return fs
    .readdirSync(ledgerDir)
    .sort()
    .map((name) => ({
      name,
      content: fs.readFileSync(path.join(ledgerDir, name), "utf8"),
    }));
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tap-consent-ledger-"));
  originalConsentLedgerEnv = process.env.TAP_CONSENT_LEDGER;
  delete process.env.TAP_CONSENT_LEDGER;
});

afterEach(() => {
  if (originalConsentLedgerEnv === undefined) {
    delete process.env.TAP_CONSENT_LEDGER;
  } else {
    process.env.TAP_CONSENT_LEDGER = originalConsentLedgerEnv;
  }
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("consent ledger writer", () => {
  it("writes orphan rejected events when the consent reference is missing", () => {
    const filePath = writeConsentLedgerEvent({
      commsDir: tmpDir,
      event: "rejected",
      grantId: null,
      scope: "drive",
      method: "thread-follower-start-turn",
      result: "missing consent reference",
    });

    expect(filePath).not.toBeNull();

    const entries = readLedgerEntries(tmpDir);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.content).toContain('event: "rejected"');
    expect(entries[0]?.content).toContain(
      'orphan_reason: "missing_consent_ref"',
    );
    expect(entries[0]?.content).toMatch(/grant_id: "orphan-[^"]+"/);
  });

  it("still skips issued events when the grant id is missing", () => {
    const filePath = writeConsentLedgerEvent({
      commsDir: tmpDir,
      event: "issued",
      grantId: null,
      scope: "drive",
      method: "thread-follower-start-turn",
      result: "granted",
    });

    expect(filePath).toBeNull();
    expect(readLedgerEntries(tmpDir)).toEqual([]);
  });

  it("returns null without writing files when ledger opt-out is enabled", () => {
    process.env.TAP_CONSENT_LEDGER = "0";

    const filePath = writeConsentLedgerEvent({
      commsDir: tmpDir,
      event: "rejected",
      grantId: null,
      scope: "drive",
      method: "thread-follower-start-turn",
      result: "missing consent reference",
    });

    expect(filePath).toBeNull();
    expect(readLedgerEntries(tmpDir)).toEqual([]);
  });
});
