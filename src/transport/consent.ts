import { createHash, randomBytes, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export type CapabilityScope = "observe" | "suggest" | "drive";

export const CONSENT_RECEIPTS_DIRNAME = "tap-codex-a2a-consent";
export const CONSENT_SECRETS_DIRNAME = "tap-codex-a2a-consent-secrets";
export const DEFAULT_CONSENT_TTL_SECONDS = 10 * 60;
const CONSENT_METADATA_DRIFT_TOLERANCE_MS = 5_000;
const CONSENT_RESERVATION_TTL_MS = 30_000;
const pendingConsentReservations = new Set<string>();

const SCOPE_PRIORITY: Record<CapabilityScope, number> = {
  observe: 1,
  suggest: 2,
  drive: 3,
};

type ConsentReceiptErrorCode =
  | "missing"
  | "expired"
  | "invalid"
  | "binding-mismatch"
  | "scope-mismatch"
  | "method-mismatch";

export class ConsentReceiptError extends Error {
  constructor(
    readonly code: ConsentReceiptErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ConsentReceiptError";
  }
}

export interface ConsentReceipt {
  id: string;
  scope: CapabilityScope;
  hostId: string | null;
  conversationId: string;
  ownerClientId: string | null;
  issuedByClientId: string | null;
  allowedMethods: string[];
  pairTokenHash: string;
  createdAt: string;
  expiresAt: string;
}

export interface CreateConsentReceiptOptions {
  receiptsDir?: string;
  secretsDir?: string;
  scope?: CapabilityScope;
  hostId?: string | null;
  conversationId: string;
  ownerClientId?: string | null;
  issuedByClientId?: string | null;
  ttlSeconds?: number;
  allowedMethods?: string[];
  now?: Date;
}

export interface CreatedConsentReceipt {
  receipt: ConsentReceipt;
  filePath: string;
}

export interface ConsumeConsentReceiptOptions {
  receiptsDir?: string;
  secretsDir?: string;
  consentRef?: string | null;
  requiredScope?: CapabilityScope;
  method?: string | null;
  hostId?: string | null;
  conversationId: string;
  ownerClientId?: string | null;
  reservationOwnerId?: string | null;
  now?: Date;
}

export interface PreparedConsentReceipt {
  receipt: ConsentReceipt;
  commit(): void;
  abort(): void;
}

function normalizeString(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function assertPendingReservationAvailable(consentRef: string): void {
  if (!pendingConsentReservations.has(consentRef)) {
    return;
  }
  throw new ConsentReceiptError(
    "missing",
    `Consent receipt "${consentRef}" is already reserved or consumed.`,
  );
}

function markPendingReservation(consentRef: string): void {
  pendingConsentReservations.add(consentRef);
}

function clearPendingReservation(consentRef: string): void {
  pendingConsentReservations.delete(consentRef);
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
  return path.resolve(value).replace(/\\/g, "/").toLowerCase();
}

function resolveReceiptsDir(explicitDir?: string): string {
  const configuredDir =
    explicitDir?.trim() || process.env.TAP_CONSENT_RECEIPTS_DIR?.trim();
  return configuredDir
    ? path.resolve(configuredDir)
    : path.join(os.tmpdir(), CONSENT_RECEIPTS_DIRNAME);
}

function resolveSecretsDir(explicitDir?: string): string {
  const configuredDir =
    explicitDir?.trim() || process.env.TAP_CONSENT_SECRETS_DIR?.trim();
  return configuredDir
    ? path.resolve(configuredDir)
    : path.join(os.tmpdir(), CONSENT_SECRETS_DIRNAME);
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
    throw new ConsentReceiptError(
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
  const originalStats = fs.statSync(filePath);
  const contents = fs.readFileSync(filePath, "utf-8");
  try {
    fs.utimesSync(filePath, originalStats.atime, originalStats.mtime);
  } catch {
    // best-effort timestamp preservation
  }
  return contents;
}

function loadConsentReceipt(filePath: string): ConsentReceipt | null {
  try {
    const parsed = JSON.parse(
      readUtf8PreservingTimes(filePath),
    ) as Partial<ConsentReceipt>;
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

function loadReservedReceiptRecord(filePath: string): {
  receipt: ConsentReceipt | null;
  reservationOwnerId: string | null;
} {
  try {
    const parsed = JSON.parse(readUtf8PreservingTimes(filePath)) as Partial<
      ConsentReceipt & {
        reservationOwnerId?: string | null;
      }
    >;

    return {
      receipt: loadConsentReceipt(filePath),
      reservationOwnerId: normalizeString(parsed.reservationOwnerId),
    };
  } catch {
    return {
      receipt: null,
      reservationOwnerId: null,
    };
  }
}

function isExpired(receipt: ConsentReceipt, now: Date): boolean {
  const expiresAtMs = new Date(receipt.expiresAt).getTime();
  return Number.isNaN(expiresAtMs) || expiresAtMs <= now.getTime();
}

function resolveSecretPath(secretsDir: string, receiptId: string): string {
  return path.join(secretsDir, `${receiptId}.token`);
}

function resolveReservedReceiptPath(
  receiptsDir: string,
  receiptId: string,
): string {
  return path.join(receiptsDir, `${receiptId}.reserved.json`);
}

function extractReceiptIdFromPath(filePath: string): string {
  return path.basename(filePath).replace(/(?:\.reserved)?\.json$/i, "");
}

function isReceiptPath(fileName: string): boolean {
  return /\.json$/i.test(fileName);
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
    throw new ConsentReceiptError(
      "invalid",
      `Unable to resolve a Windows principal for "${path.basename(targetPath)}".`,
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

  throw new ConsentReceiptError(
    "invalid",
    `Failed to apply Windows ACL hardening to "${path.basename(targetPath)}": ${lastError instanceof Error ? lastError.message : String(lastError)}`,
  );
}

function hardenSecretStorePath(targetPath: string, mode: number): void {
  try {
    fs.chmodSync(targetPath, mode);
  } catch {
    // best-effort on non-POSIX filesystems
  }
  applyWindowsPrivateAcl(targetPath);
}

function hasTimestampDrift(stats: fs.Stats, mintedAtMs: number): boolean {
  if (!Number.isFinite(mintedAtMs)) {
    return false;
  }

  return (
    Math.abs(stats.mtimeMs - mintedAtMs) >
      CONSENT_METADATA_DRIFT_TOLERANCE_MS ||
    Math.abs(stats.atimeMs - mintedAtMs) > CONSENT_METADATA_DRIFT_TOLERANCE_MS
  );
}

function stampMintedAt(targetPath: string, mintedAt: Date): void {
  fs.utimesSync(targetPath, mintedAt, mintedAt);
}

function stampReservationAt(targetPath: string, reservedAt: Date): void {
  fs.utimesSync(targetPath, reservedAt, reservedAt);
}

function resolveReceiptCreatedAtMs(receipt: ConsentReceipt): number {
  const createdAtMs = new Date(receipt.createdAt).getTime();
  if (Number.isNaN(createdAtMs)) {
    throw new ConsentReceiptError(
      "invalid",
      `Consent receipt "${receipt.id}" has an invalid createdAt timestamp.`,
    );
  }
  return createdAtMs;
}

function resolveReceiptCreatedAt(receipt: ConsentReceipt): Date {
  return new Date(resolveReceiptCreatedAtMs(receipt));
}

function isReservationExpired(stats: fs.Stats, now: Date): boolean {
  return now.getTime() - stats.mtimeMs > CONSENT_RESERVATION_TTL_MS;
}

function assertUntamperedConsentPath(
  stats: fs.Stats,
  receipt: ConsentReceipt,
  label: "receipt" | "secret",
): void {
  if (!hasTimestampDrift(stats, resolveReceiptCreatedAtMs(receipt))) {
    return;
  }

  throw new ConsentReceiptError(
    "invalid",
    `Consent ${label} "${receipt.id}" showed timestamp drift after mint.`,
  );
}

function removeSecretPath(secretPath: string): void {
  try {
    fs.rmSync(secretPath, { force: true });
  } catch {
    // best-effort cleanup
  }
}

function removeReceiptPath(receiptPath: string): void {
  try {
    fs.rmSync(receiptPath, { force: true });
  } catch {
    // best-effort cleanup
  }
}

function writeActiveReceiptFile(
  filePath: string,
  receipt: ConsentReceipt,
): void {
  fs.writeFileSync(filePath, JSON.stringify(receipt, null, 2), "utf-8");
  stampMintedAt(filePath, resolveReceiptCreatedAt(receipt));
}

function writeReservedReceiptFile(
  filePath: string,
  receipt: ConsentReceipt,
  reservationOwnerId: string | null,
  reservedAt: Date,
): void {
  fs.writeFileSync(
    filePath,
    JSON.stringify(
      {
        ...receipt,
        reservationOwnerId,
      },
      null,
      2,
    ),
    "utf-8",
  );
  stampReservationAt(filePath, reservedAt);
}

function cleanupExpiredReceipts(
  receiptsDir: string,
  secretsDir: string,
  now: Date,
): void {
  if (!fs.existsSync(receiptsDir)) return;
  for (const entry of fs.readdirSync(receiptsDir, { withFileTypes: true })) {
    if (!entry.isFile() || !isReceiptPath(entry.name)) continue;
    const filePath = path.join(receiptsDir, entry.name);
    const receipt = loadConsentReceipt(filePath);
    const receiptId = receipt?.id ?? extractReceiptIdFromPath(filePath);
    if (!receipt || isExpired(receipt, now)) {
      removeReceiptPath(filePath);
      removeSecretPath(resolveSecretPath(secretsDir, receiptId));
    }
  }
}

function listReceiptPaths(receiptsDir: string): string[] {
  if (!fs.existsSync(receiptsDir)) return [];
  return fs
    .readdirSync(receiptsDir, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isFile() &&
        entry.name.endsWith(".json") &&
        !entry.name.endsWith(".reserved.json"),
    )
    .map((entry) => path.join(receiptsDir, entry.name))
    .sort();
}

function scopeSatisfies(
  actual: CapabilityScope,
  required: CapabilityScope,
): boolean {
  return SCOPE_PRIORITY[actual] >= SCOPE_PRIORITY[required];
}

function resolveReceiptPath(
  receiptsDir: string,
  consentRef: string | null | undefined,
): string | null {
  const normalizedConsentRef = normalizeString(consentRef);
  if (!normalizedConsentRef) return null;
  return path.join(receiptsDir, `${normalizedConsentRef}.json`);
}

function reserveReceiptPath(
  filePath: string,
  receipt: ConsentReceipt,
  reservationOwnerId: string | null,
  now: Date,
): string {
  const reservedPath = resolveReservedReceiptPath(
    path.dirname(filePath),
    receipt.id,
  );
  try {
    fs.renameSync(filePath, reservedPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new ConsentReceiptError(
        "missing",
        `Consent receipt "${receipt.id}" is already reserved or consumed.`,
      );
    }
    throw error;
  }
  writeReservedReceiptFile(reservedPath, receipt, reservationOwnerId, now);
  return reservedPath;
}

function mintPairToken(): string {
  return randomBytes(32).toString("base64url");
}

function writeSecretFile(
  secretPath: string,
  pairToken: string,
  mintedAt: Date,
): void {
  fs.writeFileSync(secretPath, pairToken, {
    encoding: "utf-8",
    mode: 0o600,
  });
  stampMintedAt(secretPath, mintedAt);
  hardenSecretStorePath(secretPath, 0o600);
}

function assertNoLegacyPairTokenInput(options: object, context: string): void {
  const legacyPairToken = (options as { pairToken?: unknown }).pairToken;
  if (typeof legacyPairToken !== "undefined") {
    throw new ConsentReceiptError(
      "invalid",
      `${context} no longer accepts a caller-provided pairToken.`,
    );
  }
}

export function createConsentReceipt(
  options: CreateConsentReceiptOptions,
): CreatedConsentReceipt {
  assertNoLegacyPairTokenInput(options, "createConsentReceipt");

  const now = options.now ?? new Date();
  const { receiptsDir, secretsDir } = resolveConsentDirs(options);
  const scope = options.scope ?? "drive";
  const conversationId = options.conversationId.trim();
  if (!conversationId) {
    throw new ConsentReceiptError(
      "invalid",
      "Consent receipt requires a non-empty conversationId.",
    );
  }

  fs.mkdirSync(receiptsDir, { recursive: true });
  fs.mkdirSync(secretsDir, { recursive: true, mode: 0o700 });
  hardenSecretStorePath(secretsDir, 0o700);
  cleanupExpiredReceipts(receiptsDir, secretsDir, now);

  const ttlSeconds = Math.max(
    1,
    options.ttlSeconds ?? DEFAULT_CONSENT_TTL_SECONDS,
  );
  const receiptId = randomUUID();
  const hostId = normalizeString(options.hostId);
  const ownerClientId = normalizeString(options.ownerClientId);
  const pairToken = mintPairToken();
  const receipt: ConsentReceipt = {
    id: receiptId,
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

  const filePath = path.join(receiptsDir, `${receipt.id}.json`);
  const secretPath = resolveSecretPath(secretsDir, receipt.id);
  const createdAt = new Date(receipt.createdAt);

  try {
    writeSecretFile(secretPath, pairToken, createdAt);
    fs.writeFileSync(filePath, JSON.stringify(receipt, null, 2), "utf-8");
    stampMintedAt(filePath, createdAt);
  } catch (error) {
    removeSecretPath(secretPath);
    removeReceiptPath(filePath);
    throw error;
  }

  return { receipt, filePath };
}

export function consumeConsentReceipt(
  options: ConsumeConsentReceiptOptions,
): ConsentReceipt {
  const prepared = prepareConsentReceipt(options);
  prepared.commit();
  return prepared.receipt;
}

export function prepareConsentReceipt(
  options: ConsumeConsentReceiptOptions,
): PreparedConsentReceipt {
  assertNoLegacyPairTokenInput(options, "consumeConsentReceipt");

  const now = options.now ?? new Date();
  const { receiptsDir, secretsDir } = resolveConsentDirs(options);
  cleanupExpiredReceipts(receiptsDir, secretsDir, now);

  const requiredScope = options.requiredScope ?? "drive";
  const method = normalizeString(options.method);
  const conversationId = options.conversationId.trim();
  const ownerClientId = normalizeString(options.ownerClientId);
  const hostId = normalizeString(options.hostId);
  const reservationOwnerId = normalizeString(options.reservationOwnerId);
  const explicitConsentRef = normalizeString(options.consentRef);
  if (!conversationId) {
    throw new ConsentReceiptError(
      "invalid",
      "Consent receipt consumption requires a conversationId.",
    );
  }

  const explicitPath = resolveReceiptPath(receiptsDir, explicitConsentRef);
  const explicitReservedPath = explicitConsentRef
    ? resolveReservedReceiptPath(receiptsDir, explicitConsentRef)
    : null;
  const reservedConsentRef = explicitConsentRef;
  if (
    reservedConsentRef &&
    explicitPath &&
    explicitReservedPath &&
    !fs.existsSync(explicitPath) &&
    fs.existsSync(explicitReservedPath)
  ) {
    assertPendingReservationAvailable(reservedConsentRef);
    const reservedRecord = loadReservedReceiptRecord(explicitReservedPath);
    const reservedReceipt = reservedRecord.receipt;
    const reservedReceiptId =
      reservedReceipt?.id ?? extractReceiptIdFromPath(explicitReservedPath);

    if (!reservedReceipt || isExpired(reservedReceipt, now)) {
      removeReceiptPath(explicitReservedPath);
      removeSecretPath(resolveSecretPath(secretsDir, reservedReceiptId));
    } else if (
      reservationOwnerId &&
      reservedRecord.reservationOwnerId === reservationOwnerId &&
      isReservationExpired(fs.statSync(explicitReservedPath), now)
    ) {
      fs.renameSync(explicitReservedPath, explicitPath);
      writeActiveReceiptFile(explicitPath, reservedReceipt);
    } else {
      throw new ConsentReceiptError(
        "missing",
        `Consent receipt "${explicitConsentRef}" is already reserved or consumed.`,
      );
    }
  }
  const candidatePaths = explicitPath
    ? [explicitPath]
    : listReceiptPaths(receiptsDir);
  let deferredError: ConsentReceiptError | null = null;

  for (const filePath of candidatePaths) {
    if (!fs.existsSync(filePath)) {
      if (
        explicitPath &&
        explicitReservedPath &&
        fs.existsSync(explicitReservedPath)
      ) {
        throw new ConsentReceiptError(
          "missing",
          `Consent receipt "${explicitConsentRef}" is already reserved or consumed.`,
        );
      }
      continue;
    }
    const receiptStats = fs.statSync(filePath);
    const receipt = loadConsentReceipt(filePath);
    if (!receipt) {
      removeReceiptPath(filePath);
      removeSecretPath(
        resolveSecretPath(secretsDir, extractReceiptIdFromPath(filePath)),
      );
      continue;
    }
    if (isExpired(receipt, now)) {
      removeReceiptPath(filePath);
      removeSecretPath(resolveSecretPath(secretsDir, receipt.id));
      if (explicitPath) {
        throw new ConsentReceiptError(
          "expired",
          `Consent receipt "${receipt.id}" expired at ${receipt.expiresAt}.`,
        );
      }
      continue;
    }

    const secretPath = resolveSecretPath(secretsDir, receipt.id);
    if (!fs.existsSync(secretPath)) {
      if (explicitPath) {
        throw new ConsentReceiptError(
          "missing",
          `Consent secret "${receipt.id}" was not found.`,
        );
      }
      continue;
    }

    let receiptPrepared = false;
    let cleanupSecretOnFailure = true;
    try {
      assertUntamperedConsentPath(receiptStats, receipt, "receipt");
      const secretStats = fs.statSync(secretPath);
      assertUntamperedConsentPath(secretStats, receipt, "secret");
      const pairToken = readUtf8PreservingTimes(secretPath).trim();
      if (!pairToken) {
        throw new ConsentReceiptError(
          "invalid",
          `Consent secret "${receipt.id}" was empty.`,
        );
      }

      const expectedHash = hashPairTokenBinding({
        pairToken,
        hostId,
        conversationId,
        ownerClientId,
      });

      if (
        receipt.conversationId !== conversationId ||
        receipt.ownerClientId !== ownerClientId ||
        receipt.hostId !== hostId ||
        receipt.pairTokenHash !== expectedHash
      ) {
        if (explicitPath) {
          throw new ConsentReceiptError(
            "binding-mismatch",
            `Consent receipt "${receipt.id}" did not match the requested conversation binding.`,
          );
        }
        continue;
      }

      if (!scopeSatisfies(receipt.scope, requiredScope)) {
        deferredError = new ConsentReceiptError(
          "scope-mismatch",
          `Consent receipt "${receipt.id}" grants ${receipt.scope}, not ${requiredScope}.`,
        );
        if (explicitPath) throw deferredError;
        continue;
      }

      if (
        method &&
        receipt.allowedMethods.length > 0 &&
        !receipt.allowedMethods.includes(method)
      ) {
        deferredError = new ConsentReceiptError(
          "method-mismatch",
          `Consent receipt "${receipt.id}" does not allow method "${method}".`,
        );
        if (explicitPath) throw deferredError;
        continue;
      }

      let reservedReceiptPath: string;
      try {
        assertPendingReservationAvailable(receipt.id);
        reservedReceiptPath = reserveReceiptPath(
          filePath,
          receipt,
          reservationOwnerId,
          now,
        );
      } catch (error) {
        cleanupSecretOnFailure = false;
        throw error;
      }
      markPendingReservation(receipt.id);
      receiptPrepared = true;
      return {
        receipt,
        commit() {
          if (!receiptPrepared) {
            return;
          }
          receiptPrepared = false;
          try {
            fs.rmSync(reservedReceiptPath, { force: false });
          } finally {
            clearPendingReservation(receipt.id);
            removeSecretPath(secretPath);
          }
        },
        abort() {
          if (!receiptPrepared) {
            return;
          }
          receiptPrepared = false;
          try {
            fs.renameSync(reservedReceiptPath, filePath);
            writeActiveReceiptFile(filePath, receipt);
          } finally {
            clearPendingReservation(receipt.id);
          }
        },
      };
    } finally {
      if (!receiptPrepared && cleanupSecretOnFailure) {
        removeSecretPath(secretPath);
      }
    }
  }

  if (deferredError) {
    throw deferredError;
  }

  throw new ConsentReceiptError(
    "missing",
    explicitPath
      ? `Consent receipt "${options.consentRef}" was not found.`
      : "No matching consent receipt was found for the requested drive action.",
  );
}
