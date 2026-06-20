import { createHash, randomBytes, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { writeConsentLedgerEvent } from "../../../src/transport/consent-ledger.js";
import type { AgentIdentitySnapshot } from "./tap-utils.js";
import type { TapEnvelopeScope } from "./tap-presence.js";

export type TapConsentScope = TapEnvelopeScope;

export const TAP_CONSENT_RECEIPTS_DIRNAME = "tap-codex-a2a-consent";
export const TAP_CONSENT_SECRETS_DIRNAME = "tap-codex-a2a-consent-secrets";
export const DEFAULT_TAP_CONSENT_TTL_SECONDS = 10 * 60;

type TapConsentReceiptErrorCode =
  | "missing"
  | "expired"
  | "invalid"
  | "binding-mismatch"
  | "scope-mismatch"
  | "method-mismatch";

export class TapConsentReceiptError extends Error {
  constructor(
    readonly code: TapConsentReceiptErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "TapConsentReceiptError";
  }
}

export interface TapConsentReceipt {
  id: string;
  scope: TapConsentScope;
  hostId: string | null;
  conversationId: string;
  ownerClientId: string | null;
  issuedByClientId: string | null;
  allowedMethods: string[];
  pairTokenHash: string;
  createdAt: string;
  expiresAt: string;
}

export interface CreateTapConsentReceiptOptions {
  receiptsDir?: string;
  secretsDir?: string;
  scope?: TapConsentScope;
  hostId?: string | null;
  conversationId: string;
  ownerClientId?: string | null;
  issuedByClientId?: string | null;
  ttlSeconds?: number;
  allowedMethods?: string[];
  now?: Date;
}

export interface CreateTapConsentReceiptFromIdentityOptions {
  receiptsDir?: string;
  secretsDir?: string;
  scope?: TapConsentScope;
  hostId?: string | null;
  conversationId?: string | null;
  ownerClientId?: string | null;
  ttlSeconds?: number;
  allowedMethods?: string[];
  now?: Date;
}

export interface CreatedTapConsentReceipt {
  receipt: TapConsentReceipt;
  filePath: string;
}

function normalizeString(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function normalizeMethods(values: string[] | undefined): string[] {
  const methods = new Set<string>();
  for (const value of values ?? []) {
    const normalized = value.trim();
    if (!normalized) continue;
    methods.add(normalized);
  }
  return [...methods].sort();
}

function normalizePathForComparison(value: string): string {
  return resolve(value).replace(/\\/g, "/").toLowerCase();
}

function resolveIdentityOwnerTuple(identity: AgentIdentitySnapshot): {
  hostId: string | null;
  conversationId: string | null;
  ownerClientId: string | null;
  issuedByClientId: string | null;
} {
  return {
    hostId: normalizeString(identity.address.hostId),
    conversationId: normalizeString(identity.address.conversationId),
    ownerClientId:
      normalizeString(identity.address.ownerClientId) ??
      normalizeString(identity.address.clientId),
    issuedByClientId: normalizeString(identity.address.clientId),
  };
}

function assertOwnerBoundOverride(
  field: "hostId" | "conversationId" | "ownerClientId",
  requested: string | null,
  actual: string | null,
): void {
  if (!requested) return;
  if (requested === actual) return;

  const actualLabel = actual ?? "(unbound)";
  throw new TapConsentReceiptError(
    "binding-mismatch",
    `tap_create_consent_receipt can only mint for the current owner tuple; requested ${field} "${requested}" did not match active ${field} "${actualLabel}".`,
  );
}

function resolveReceiptsDir(explicitDir?: string): string {
  const configuredDir =
    normalizeString(explicitDir) ??
    normalizeString(process.env.TAP_CONSENT_RECEIPTS_DIR);
  return configuredDir
    ? resolve(configuredDir)
    : join(tmpdir(), TAP_CONSENT_RECEIPTS_DIRNAME);
}

function resolveSecretsDir(explicitDir?: string): string {
  const configuredDir =
    normalizeString(explicitDir) ??
    normalizeString(process.env.TAP_CONSENT_SECRETS_DIR);
  return configuredDir
    ? resolve(configuredDir)
    : join(tmpdir(), TAP_CONSENT_SECRETS_DIRNAME);
}

function resolveConsentDirs(options: {
  receiptsDir?: string;
  secretsDir?: string;
}): {
  receiptsDir: string;
  secretsDir: string;
} {
  const receiptsDir = resolveReceiptsDir(options.receiptsDir);
  const secretsDir = resolveSecretsDir(options.secretsDir);
  if (
    normalizePathForComparison(receiptsDir) ===
    normalizePathForComparison(secretsDir)
  ) {
    throw new TapConsentReceiptError(
      "invalid",
      "Consent receipts dir and secrets dir must be different paths.",
    );
  }
  return { receiptsDir, secretsDir };
}

function hashPairTokenBinding(options: {
  pairToken: string;
  hostId: string | null;
  conversationId: string;
  ownerClientId: string | null;
}): string {
  return createHash("sha256")
    .update(
      [
        options.pairToken,
        options.hostId ?? "",
        options.conversationId,
        options.ownerClientId ?? "",
      ].join("\u0000"),
      "utf-8",
    )
    .digest("hex");
}

function readUtf8PreservingTimes(filePath: string): string {
  const originalStats = statSync(filePath);
  const contents = readFileSync(filePath, "utf-8");
  try {
    utimesSync(filePath, originalStats.atime, originalStats.mtime);
  } catch {
    // best-effort timestamp preservation
  }
  return contents;
}

function loadReceipt(filePath: string): TapConsentReceipt | null {
  try {
    const parsed = JSON.parse(
      readUtf8PreservingTimes(filePath),
    ) as Partial<TapConsentReceipt>;
    if (
      typeof parsed.id !== "string" ||
      typeof parsed.scope !== "string" ||
      typeof parsed.conversationId !== "string" ||
      typeof parsed.pairTokenHash !== "string" ||
      typeof parsed.createdAt !== "string" ||
      typeof parsed.expiresAt !== "string"
    ) {
      return null;
    }
    if (
      parsed.scope !== "observe" &&
      parsed.scope !== "suggest" &&
      parsed.scope !== "drive"
    ) {
      return null;
    }

    return {
      id: parsed.id,
      scope: parsed.scope,
      hostId: normalizeString(parsed.hostId),
      conversationId: parsed.conversationId,
      ownerClientId: normalizeString(parsed.ownerClientId),
      issuedByClientId: normalizeString(parsed.issuedByClientId),
      allowedMethods: normalizeMethods(parsed.allowedMethods),
      pairTokenHash: parsed.pairTokenHash,
      createdAt: parsed.createdAt,
      expiresAt: parsed.expiresAt,
    };
  } catch {
    return null;
  }
}

function isExpired(receipt: TapConsentReceipt, now: Date): boolean {
  const expiresAtMs = new Date(receipt.expiresAt).getTime();
  return Number.isNaN(expiresAtMs) || expiresAtMs <= now.getTime();
}

function resolveSecretPath(secretsDir: string, receiptId: string): string {
  return join(secretsDir, `${receiptId}.token`);
}

function resolveWindowsAclPrincipals(): string[] {
  const username = process.env.USERNAME?.trim();
  if (!username) return [];

  const principals = new Set<string>();
  const userDomain = process.env.USERDOMAIN?.trim();
  if (userDomain) {
    principals.add(`${userDomain}\\${username}`);
  }
  principals.add(username);
  return [...principals];
}

function applyWindowsPrivateAcl(targetPath: string): void {
  if (process.platform !== "win32") return;

  const principals = resolveWindowsAclPrincipals();
  if (principals.length === 0) {
    throw new TapConsentReceiptError(
      "invalid",
      `Unable to resolve a Windows principal for "${targetPath}".`,
    );
  }

  let lastError: unknown = null;
  for (const principal of principals) {
    try {
      execFileSync(
        "icacls",
        [targetPath, "/inheritance:r", "/grant:r", `${principal}:F`],
        {
          stdio: "pipe",
          windowsHide: true,
        },
      );
      return;
    } catch (error) {
      lastError = error;
    }
  }

  throw new TapConsentReceiptError(
    "invalid",
    `Failed to apply Windows ACL hardening to "${targetPath}": ${lastError instanceof Error ? lastError.message : String(lastError)}`,
  );
}

function hardenSecretStorePath(targetPath: string, mode: number): void {
  try {
    chmodSync(targetPath, mode);
  } catch {
    // best-effort on non-POSIX filesystems
  }
  applyWindowsPrivateAcl(targetPath);
}

function stampMintedAt(targetPath: string, mintedAt: Date): void {
  utimesSync(targetPath, mintedAt, mintedAt);
}

function cleanupExpiredReceipts(
  receiptsDir: string,
  secretsDir: string,
  now: Date,
): void {
  if (!existsSync(receiptsDir)) return;
  for (const entry of readdirSync(receiptsDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const filePath = join(receiptsDir, entry.name);
    const receipt = loadReceipt(filePath);
    const receiptId = receipt?.id ?? entry.name.replace(/\.json$/i, "");
    if (!receipt || isExpired(receipt, now)) {
      rmSync(filePath, { force: true });
      rmSync(resolveSecretPath(secretsDir, receiptId), { force: true });
    }
  }
}

function mintPairToken(): string {
  return randomBytes(32).toString("base64url");
}

function assertNoLegacyPairTokenInput(options: object, context: string): void {
  const legacyPairToken = (options as { pairToken?: unknown }).pairToken;
  if (typeof legacyPairToken !== "undefined") {
    throw new TapConsentReceiptError(
      "invalid",
      `${context} no longer accepts a caller-provided pairToken.`,
    );
  }
}

export function createTapConsentReceipt(
  options: CreateTapConsentReceiptOptions,
): CreatedTapConsentReceipt {
  assertNoLegacyPairTokenInput(options, "tap_create_consent_receipt");

  const now = options.now ?? new Date();
  const { receiptsDir, secretsDir } = resolveConsentDirs(options);
  const scope = options.scope ?? "drive";
  const conversationId = options.conversationId.trim();
  const ownerClientId = normalizeString(options.ownerClientId);

  if (!conversationId) {
    throw new TapConsentReceiptError(
      "invalid",
      "Consent receipt requires a non-empty conversationId.",
    );
  }
  if (!ownerClientId) {
    throw new TapConsentReceiptError(
      "invalid",
      "Consent receipt requires a non-empty ownerClientId.",
    );
  }

  mkdirSync(receiptsDir, { recursive: true });
  mkdirSync(secretsDir, { recursive: true, mode: 0o700 });
  hardenSecretStorePath(secretsDir, 0o700);
  cleanupExpiredReceipts(receiptsDir, secretsDir, now);

  const ttlSeconds = Math.max(
    1,
    options.ttlSeconds ?? DEFAULT_TAP_CONSENT_TTL_SECONDS,
  );
  const hostId = normalizeString(options.hostId);
  const pairToken = mintPairToken();
  const receipt: TapConsentReceipt = {
    id: randomUUID(),
    scope,
    hostId,
    conversationId,
    ownerClientId,
    issuedByClientId: normalizeString(options.issuedByClientId),
    allowedMethods: normalizeMethods(options.allowedMethods),
    pairTokenHash: hashPairTokenBinding({
      pairToken,
      hostId,
      conversationId,
      ownerClientId,
    }),
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + ttlSeconds * 1000).toISOString(),
  };

  const filePath = join(receiptsDir, `${receipt.id}.json`);
  const secretPath = resolveSecretPath(secretsDir, receipt.id);
  const createdAt = new Date(receipt.createdAt);

  try {
    writeFileSync(secretPath, pairToken, {
      encoding: "utf-8",
      mode: 0o600,
    });
    stampMintedAt(secretPath, createdAt);
    hardenSecretStorePath(secretPath, 0o600);
    writeFileSync(filePath, JSON.stringify(receipt, null, 2), "utf-8");
    stampMintedAt(filePath, createdAt);
  } catch (error) {
    rmSync(secretPath, { force: true });
    rmSync(filePath, { force: true });
    throw error;
  }

  return { receipt, filePath };
}

export function createTapConsentReceiptFromIdentity(
  identity: AgentIdentitySnapshot,
  options: CreateTapConsentReceiptFromIdentityOptions,
): CreatedTapConsentReceipt {
  assertNoLegacyPairTokenInput(options, "tap_create_consent_receipt");

  const ownerTuple = resolveIdentityOwnerTuple(identity);
  const requestedHostId = normalizeString(options.hostId);
  const requestedConversationId = normalizeString(options.conversationId);
  const requestedOwnerClientId = normalizeString(options.ownerClientId);

  assertOwnerBoundOverride("hostId", requestedHostId, ownerTuple.hostId);
  assertOwnerBoundOverride(
    "conversationId",
    requestedConversationId,
    ownerTuple.conversationId,
  );
  assertOwnerBoundOverride(
    "ownerClientId",
    requestedOwnerClientId,
    ownerTuple.ownerClientId,
  );

  const conversationId = ownerTuple.conversationId;
  if (!conversationId) {
    throw new TapConsentReceiptError(
      "invalid",
      "tap_create_consent_receipt requires an active conversationId. Pass conversationId explicitly or run under a bridge-backed session.",
    );
  }

  const ownerClientId = ownerTuple.ownerClientId;
  if (!ownerClientId) {
    throw new TapConsentReceiptError(
      "invalid",
      "tap_create_consent_receipt requires ownerClientId. Pass ownerClientId explicitly or run under a bridge-backed session.",
    );
  }

  const created = createTapConsentReceipt({
    receiptsDir: options.receiptsDir,
    secretsDir: options.secretsDir,
    scope: options.scope ?? "drive",
    hostId: ownerTuple.hostId,
    conversationId,
    ownerClientId,
    issuedByClientId: ownerTuple.issuedByClientId,
    ttlSeconds: options.ttlSeconds,
    allowedMethods: options.allowedMethods,
    now: options.now,
  });
  writeConsentLedgerEvent({
    commsDir: identity.runtimeEnv.commsDir,
    event: "issued",
    grantId: created.receipt.id,
    scope: created.receipt.scope,
    method:
      created.receipt.allowedMethods.length === 1
        ? created.receipt.allowedMethods[0]
        : null,
    hostId: created.receipt.hostId,
    conversationId: created.receipt.conversationId,
    issuedAt: created.receipt.createdAt,
    expiresAt: created.receipt.expiresAt,
    result: "granted",
    requester: null,
    owner: {
      hostId: created.receipt.hostId,
      clientId: created.receipt.ownerClientId,
      conversationId: created.receipt.conversationId,
      ownerClientId: created.receipt.ownerClientId,
    },
    issuedByClientId: created.receipt.issuedByClientId,
  });
  return created;
}
