import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

export type ConsentLedgerEventType = "issued" | "consumed" | "rejected";

export interface ConsentLedgerAddress {
  hostId?: string | null;
  clientId?: string | null;
  conversationId?: string | null;
  ownerClientId?: string | null;
}

export interface WriteConsentLedgerEventOptions {
  commsDir?: string | null;
  event: ConsentLedgerEventType;
  grantId: string | null;
  scope: "observe" | "suggest" | "drive";
  method?: string | null;
  hostId?: string | null;
  conversationId?: string | null;
  issuedAt?: string | null;
  expiresAt?: string | null;
  consumedAt?: string | null;
  recordedAt?: string | null;
  result: string;
  requester?: ConsentLedgerAddress | null;
  owner?: ConsentLedgerAddress | null;
  issuedByClientId?: string | null;
}

interface ConsentLedgerEventRecord {
  event: ConsentLedgerEventType;
  grantId: string;
  orphanReason: string | null;
  scope: "observe" | "suggest" | "drive";
  method: string | null;
  hostId: string | null;
  conversationId: string | null;
  issuedAt: string | null;
  expiresAt: string | null;
  consumedAt: string | null;
  recordedAt: string;
  result: string;
  requester: ConsentLedgerAddress | null;
  owner: ConsentLedgerAddress | null;
  issuedByClientId: string | null;
}

function normalizeString(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function normalizeAddress(
  value: ConsentLedgerAddress | null | undefined,
): ConsentLedgerAddress | null {
  if (!value) {
    return null;
  }
  const address: ConsentLedgerAddress = {
    hostId: normalizeString(value.hostId),
    clientId: normalizeString(value.clientId),
    conversationId: normalizeString(value.conversationId),
    ownerClientId: normalizeString(value.ownerClientId),
  };
  return Object.values(address).some((field) => field) ? address : null;
}

function isConsentLedgerEnabled(): boolean {
  const normalized = process.env.TAP_CONSENT_LEDGER?.trim().toLowerCase();
  if (!normalized) {
    return true;
  }
  return !["0", "false", "no", "off"].includes(normalized);
}

function resolveConsentLedgerDir(commsDir?: string | null): string | null {
  const resolvedCommsDir =
    normalizeString(commsDir) ?? normalizeString(process.env.TAP_COMMS_DIR);
  if (!resolvedCommsDir) {
    return null;
  }
  return path.join(
    path.resolve(resolvedCommsDir),
    "receipts",
    "consent-ledger",
  );
}

const MISSING_CONSENT_REF_ORPHAN_REASON = "missing_consent_ref";

function resolveGrantId(
  event: ConsentLedgerEventType,
  grantId: string | null,
): { grantId: string | null; orphanReason: string | null } {
  if (grantId) {
    return {
      grantId,
      orphanReason: null,
    };
  }
  if (event !== "rejected") {
    return {
      grantId: null,
      orphanReason: null,
    };
  }
  return {
    grantId: `orphan-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`,
    orphanReason: MISSING_CONSENT_REF_ORPHAN_REASON,
  };
}

function formatLedgerTimestamp(value: string): string {
  return value.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function buildLedgerFilePath(
  ledgerDir: string,
  record: ConsentLedgerEventRecord,
): string {
  const timestamp = formatLedgerTimestamp(record.recordedAt);
  const shortGrantId =
    record.grantId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 8) || "unknown";
  const baseName = `${timestamp}-${record.event}-${shortGrantId}`;
  const preferredPath = path.join(ledgerDir, `${baseName}.md`);
  if (!fs.existsSync(preferredPath)) {
    return preferredPath;
  }
  return path.join(
    ledgerDir,
    `${baseName}-${randomUUID().replace(/-/g, "").slice(0, 6)}.md`,
  );
}

function buildFrontmatter(record: ConsentLedgerEventRecord): string {
  const fields: Array<[string, unknown]> = [
    ["type", "consent-ledger"],
    ["event", record.event],
    ["grant_id", record.grantId],
    ["orphan_reason", record.orphanReason],
    ["scope", record.scope],
    ["method", record.method],
    ["host_id", record.hostId],
    ["conversation_id", record.conversationId],
    ["issued_at", record.issuedAt],
    ["expires_at", record.expiresAt],
    ["consumed_at", record.consumedAt],
    ["recorded_at", record.recordedAt],
    ["result", record.result],
    ["issued_by_client_id", record.issuedByClientId],
    ["requester", record.requester],
    ["owner", record.owner],
  ];
  const lines = fields.map(
    ([key, value]) => `${key}: ${JSON.stringify(value ?? null)}`,
  );
  return `---\n${lines.join("\n")}\n---\n\n`;
}

function buildBody(record: ConsentLedgerEventRecord): string {
  return [
    "# Consent Ledger Event",
    "",
    `- Event: \`${record.event}\``,
    `- Grant: \`${record.grantId}\``,
    ...(record.orphanReason
      ? [`- Orphan Reason: \`${record.orphanReason}\``]
      : []),
    `- Scope: \`${record.scope}\``,
    `- Result: \`${record.result}\``,
    "",
    "## Owner",
    "",
    "```json",
    JSON.stringify(record.owner, null, 2),
    "```",
    "",
    "## Requester",
    "",
    "```json",
    JSON.stringify(record.requester, null, 2),
    "```",
    "",
  ].join("\n");
}

export function writeConsentLedgerEvent(
  options: WriteConsentLedgerEventOptions,
): string | null {
  if (!isConsentLedgerEnabled()) {
    return null;
  }

  const { grantId, orphanReason } = resolveGrantId(
    options.event,
    normalizeString(options.grantId),
  );
  const result = normalizeString(options.result);
  const ledgerDir = resolveConsentLedgerDir(options.commsDir);
  if (!grantId || !result || !ledgerDir) {
    return null;
  }

  const record: ConsentLedgerEventRecord = {
    event: options.event,
    grantId,
    orphanReason,
    scope: options.scope,
    method: normalizeString(options.method),
    hostId: normalizeString(options.hostId),
    conversationId: normalizeString(options.conversationId),
    issuedAt: normalizeString(options.issuedAt),
    expiresAt: normalizeString(options.expiresAt),
    consumedAt: normalizeString(options.consumedAt),
    recordedAt: normalizeString(options.recordedAt) ?? new Date().toISOString(),
    result,
    requester: normalizeAddress(options.requester),
    owner: normalizeAddress(options.owner),
    issuedByClientId: normalizeString(options.issuedByClientId),
  };

  try {
    fs.mkdirSync(ledgerDir, { recursive: true });
    const filePath = buildLedgerFilePath(ledgerDir, record);
    fs.writeFileSync(
      filePath,
      buildFrontmatter(record) + buildBody(record),
      "utf-8",
    );
    return filePath;
  } catch {
    return null;
  }
}
