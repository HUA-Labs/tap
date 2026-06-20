import * as fs from "node:fs";
import * as path from "node:path";
import type { CapabilityScope } from "./consent.js";

export const TRUSTED_DEVICE_LEASES_DIRNAME = "devices";

export type TrustedDeviceLeaseFailureReason =
  | "registry-unavailable"
  | "missing"
  | "invalid"
  | "not-yet-valid"
  | "expired"
  | "revoked"
  | "scope-not-allowed"
  | "target-not-allowed";

export interface TrustedDeviceLease {
  deviceId: string;
  hostId: string;
  label: string | null;
  publicKeyHash: string | null;
  tokenHash: string | null;
  operator: string | null;
  allowedScopes: CapabilityScope[];
  allowedTargets: string[];
  issuedAt: string;
  expiresAt: string;
  lastSeenAt: string | null;
  revokedAt: string | null;
}

export interface TrustedDeviceLeaseCheck {
  ok: boolean;
  reason: TrustedDeviceLeaseFailureReason | null;
  message: string | null;
  lease: TrustedDeviceLease | null;
  filePath: string | null;
}

export interface TrustedDeviceLeaseGateResult {
  ok: boolean;
  reason: TrustedDeviceLeaseFailureReason | null;
  message: string | null;
  requester: TrustedDeviceLeaseCheck | null;
  target: TrustedDeviceLeaseCheck | null;
}

export interface CheckTrustedDeviceLeaseOptions {
  commsDir?: string | null;
  devicesDir?: string | null;
  deviceId?: string | null;
  hostId?: string | null;
  scope?: CapabilityScope;
  target?: string | null;
  now?: Date | string | number;
}

export interface CheckTrustedDeviceLeaseGateOptions {
  commsDir?: string | null;
  devicesDir?: string | null;
  requesterDeviceId?: string | null;
  requesterHostId?: string | null;
  targetDeviceId?: string | null;
  targetHostId?: string | null;
  scope?: CapabilityScope;
  target?: string | null;
  now?: Date | string | number;
}

function normalizeString(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function normalizeArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ].sort();
}

function normalizeScopeArray(value: unknown): CapabilityScope[] {
  return normalizeArray(value).filter(
    (item): item is CapabilityScope =>
      item === "observe" || item === "suggest" || item === "drive",
  );
}

function normalizeComparable(value: string | null | undefined): string | null {
  const normalized = normalizeString(value);
  return normalized ? normalized.replace(/\\/g, "/").toLowerCase() : null;
}

function normalizeDate(value: Date | string | number | null | undefined): Date {
  if (value instanceof Date) return value;
  if (typeof value === "string" || typeof value === "number") {
    return new Date(value);
  }
  return new Date();
}

function parseTimestamp(value: string): number | null {
  const timestamp = new Date(value).getTime();
  return Number.isNaN(timestamp) ? null : timestamp;
}

function fail(
  reason: TrustedDeviceLeaseFailureReason,
  message: string,
  lease: TrustedDeviceLease | null = null,
  filePath: string | null = null,
): TrustedDeviceLeaseCheck {
  return { ok: false, reason, message, lease, filePath };
}

function pass(
  lease: TrustedDeviceLease,
  filePath: string,
): TrustedDeviceLeaseCheck {
  return { ok: true, reason: null, message: null, lease, filePath };
}

export function resolveTrustedDeviceLeasesDir(options: {
  commsDir?: string | null;
  devicesDir?: string | null;
}): string | null {
  const explicit = normalizeString(options.devicesDir);
  if (explicit) return path.resolve(explicit);

  const commsDir =
    normalizeString(options.commsDir) ??
    normalizeString(process.env.TAP_COMMS_DIR);
  return commsDir
    ? path.join(path.resolve(commsDir), TRUSTED_DEVICE_LEASES_DIRNAME)
    : null;
}

export function parseTrustedDeviceLease(
  value: unknown,
): TrustedDeviceLease | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const deviceId =
    typeof record.deviceId === "string"
      ? normalizeString(record.deviceId)
      : null;
  const hostId =
    typeof record.hostId === "string" ? normalizeString(record.hostId) : null;
  const issuedAt =
    typeof record.issuedAt === "string"
      ? normalizeString(record.issuedAt)
      : null;
  const expiresAt =
    typeof record.expiresAt === "string"
      ? normalizeString(record.expiresAt)
      : null;
  const publicKeyHash =
    typeof record.publicKeyHash === "string"
      ? normalizeString(record.publicKeyHash)
      : null;
  const tokenHash =
    typeof record.tokenHash === "string"
      ? normalizeString(record.tokenHash)
      : null;
  if (!deviceId || !hostId || !issuedAt || !expiresAt) {
    return null;
  }
  if (!publicKeyHash && !tokenHash) {
    return null;
  }

  return {
    deviceId,
    hostId,
    label:
      typeof record.label === "string" ? normalizeString(record.label) : null,
    publicKeyHash,
    tokenHash,
    operator:
      typeof record.operator === "string"
        ? normalizeString(record.operator)
        : null,
    allowedScopes: normalizeScopeArray(record.allowedScopes),
    allowedTargets: normalizeArray(record.allowedTargets),
    issuedAt,
    expiresAt,
    lastSeenAt:
      typeof record.lastSeenAt === "string"
        ? normalizeString(record.lastSeenAt)
        : null,
    revokedAt:
      typeof record.revokedAt === "string"
        ? normalizeString(record.revokedAt)
        : null,
  };
}

export function loadTrustedDeviceLease(
  filePath: string,
): TrustedDeviceLease | null {
  try {
    return parseTrustedDeviceLease(
      JSON.parse(fs.readFileSync(filePath, "utf-8")) as unknown,
    );
  } catch {
    return null;
  }
}

function listLeaseFiles(devicesDir: string): string[] {
  try {
    return fs
      .readdirSync(devicesDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => path.join(devicesDir, entry.name))
      .sort();
  } catch {
    return [];
  }
}

function matchesLease(
  lease: TrustedDeviceLease,
  options: { deviceId?: string | null; hostId?: string | null },
): boolean {
  const expectedDeviceId = normalizeComparable(options.deviceId);
  const expectedHostId = normalizeComparable(options.hostId);
  const deviceMatches = expectedDeviceId
    ? normalizeComparable(lease.deviceId) === expectedDeviceId
    : true;
  const hostMatches = expectedHostId
    ? normalizeComparable(lease.hostId) === expectedHostId
    : true;
  return Boolean(
    (expectedDeviceId || expectedHostId) && deviceMatches && hostMatches,
  );
}

function validateLease(
  lease: TrustedDeviceLease,
  filePath: string,
  options: {
    scope: CapabilityScope;
    target: string;
    now: Date;
  },
): TrustedDeviceLeaseCheck {
  const nowMs = options.now.getTime();
  const issuedAtMs = parseTimestamp(lease.issuedAt);
  const expiresAtMs = parseTimestamp(lease.expiresAt);
  if (
    Number.isNaN(nowMs) ||
    issuedAtMs === null ||
    expiresAtMs === null ||
    (lease.revokedAt && parseTimestamp(lease.revokedAt) === null)
  ) {
    return fail(
      "invalid",
      "Trusted device lease has invalid timestamps.",
      lease,
      filePath,
    );
  }
  if (issuedAtMs > nowMs) {
    return fail(
      "not-yet-valid",
      "Trusted device lease is not valid yet.",
      lease,
      filePath,
    );
  }
  if (expiresAtMs <= nowMs) {
    return fail("expired", "Trusted device lease is expired.", lease, filePath);
  }
  if (lease.revokedAt) {
    return fail("revoked", "Trusted device lease is revoked.", lease, filePath);
  }
  if (!lease.allowedScopes.includes(options.scope)) {
    return fail(
      "scope-not-allowed",
      `Trusted device lease does not allow ${options.scope}.`,
      lease,
      filePath,
    );
  }
  if (!lease.allowedTargets.includes(options.target)) {
    return fail(
      "target-not-allowed",
      `Trusted device lease does not allow target ${options.target}.`,
      lease,
      filePath,
    );
  }
  return pass(lease, filePath);
}

export function checkTrustedDeviceLease(
  options: CheckTrustedDeviceLeaseOptions,
): TrustedDeviceLeaseCheck {
  const devicesDir = resolveTrustedDeviceLeasesDir(options);
  if (!devicesDir) {
    return fail(
      "registry-unavailable",
      "Trusted device lease registry is unavailable.",
    );
  }
  const deviceId = normalizeString(options.deviceId);
  const hostId = normalizeString(options.hostId);
  if (!deviceId && !hostId) {
    return fail(
      "missing",
      "Trusted device lease check requires deviceId or hostId.",
    );
  }

  let invalidMatch: TrustedDeviceLeaseCheck | null = null;
  for (const filePath of listLeaseFiles(devicesDir)) {
    const lease = loadTrustedDeviceLease(filePath);
    if (!lease) continue;
    if (!matchesLease(lease, { deviceId, hostId })) continue;
    const checked = validateLease(lease, filePath, {
      scope: options.scope ?? "drive",
      target: normalizeString(options.target) ?? "self-owned",
      now: normalizeDate(options.now),
    });
    if (checked.ok) return checked;
    invalidMatch ??= checked;
  }
  return (
    invalidMatch ??
    fail("missing", "No matching trusted device lease was found.")
  );
}

export function checkTrustedDeviceLeaseGate(
  options: CheckTrustedDeviceLeaseGateOptions,
): TrustedDeviceLeaseGateResult {
  const scope = options.scope ?? "drive";
  const target = normalizeString(options.target) ?? "self-owned";
  const requester = checkTrustedDeviceLease({
    commsDir: options.commsDir,
    devicesDir: options.devicesDir,
    deviceId: options.requesterDeviceId,
    hostId: options.requesterHostId,
    scope,
    target,
    now: options.now,
  });
  if (!requester.ok) {
    return {
      ok: false,
      reason: requester.reason,
      message: `Requester ${requester.message ?? "trusted device lease check failed"}`,
      requester,
      target: null,
    };
  }

  const requesterHostId = normalizeComparable(requester.lease?.hostId);
  const targetHostId = normalizeComparable(options.targetHostId);
  if (!targetHostId || targetHostId === requesterHostId) {
    return {
      ok: true,
      reason: null,
      message: null,
      requester,
      target: null,
    };
  }

  const targetCheck = checkTrustedDeviceLease({
    commsDir: options.commsDir,
    devicesDir: options.devicesDir,
    deviceId: options.targetDeviceId,
    hostId: options.targetHostId,
    scope,
    target,
    now: options.now,
  });
  if (!targetCheck.ok) {
    return {
      ok: false,
      reason: targetCheck.reason,
      message: `Target ${targetCheck.message ?? "trusted device lease check failed"}`,
      requester,
      target: targetCheck,
    };
  }

  return {
    ok: true,
    reason: null,
    message: null,
    requester,
    target: targetCheck,
  };
}
