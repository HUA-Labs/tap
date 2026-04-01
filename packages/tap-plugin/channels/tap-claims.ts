import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  readdirSync,
  openSync,
  closeSync,
  renameSync,
  statSync,
  constants,
} from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { COMMS_DIR } from "./tap-utils.js";

// ─── Types ─────────────────────────────────────────────────────

export type HeartbeatSource = "bridge-dispatch" | "mcp-direct";

export interface NameClaim {
  name: string;
  claimedBy: {
    instanceId: string;
    sessionPid: number;
    source: HeartbeatSource;
  };
  claimedAt: string;
  nonce: string;
  status: "confirmed" | "released";
  expiresAt: string | null;
}

export interface NameClaimResult {
  success: boolean;
  claim: NameClaim | null;
  conflictWith: {
    instanceId: string;
    alive: boolean;
    lastActivity: string;
  } | null;
}

// ─── Constants ─────────────────────────────────────────────────

const CLAIMS_DIR = join(COMMS_DIR, ".claims");
const CLAIM_TTL_MS = 5 * 60 * 1000; // 5 minutes

// ─── Helpers ───────────────────────────────────────────────────

function ensureClaimsDir(): void {
  if (!existsSync(CLAIMS_DIR)) {
    mkdirSync(CLAIMS_DIR, { recursive: true });
  }
}

function claimFilePath(name: string): string {
  const safe = name.replace(/[/\\:*?"<>|]/g, "_");
  return join(CLAIMS_DIR, `${safe}.json`);
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Build a unique instanceId even when env vars are missing.
 * Falls back to PID-based identity so direct MCP sessions
 * never share the same "unknown" instanceId.
 */
export function resolveClaimInstanceId(): string {
  const envId = process.env.TAP_BRIDGE_INSTANCE_ID ?? process.env.TAP_AGENT_ID;
  if (envId && envId !== "unknown") return envId;
  // No managed identity — use PID to distinguish direct MCP sessions
  return `mcp-direct-${process.pid}`;
}

/**
 * Atomic create: uses O_EXCL to fail if file already exists.
 * Returns true if file was created, false if it already existed.
 */
function atomicCreate(filePath: string, data: string): boolean {
  try {
    const fd = openSync(
      filePath,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
    );
    writeFileSync(fd, data, "utf-8");
    closeSync(fd);
    return true;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw err;
  }
}

function atomicOverwrite(filePath: string, data: string): void {
  const tmp = `${filePath}.tmp.${process.pid}.${Date.now()}`;
  writeFileSync(tmp, data, "utf-8");
  try {
    renameSync(tmp, filePath);
  } catch (err) {
    try {
      unlinkSync(tmp);
    } catch {
      /* best-effort cleanup */
    }
    throw err;
  }
}

// ─── Core ──────────────────────────────────────────────────────

export function checkClaim(name: string): NameClaim | null {
  const filePath = claimFilePath(name);
  if (!existsSync(filePath)) return null;
  try {
    const raw = readFileSync(filePath, "utf-8");
    return JSON.parse(raw) as NameClaim;
  } catch {
    return null;
  }
}

export function isClaimAlive(claim: NameClaim): boolean {
  if (claim.status === "released") return false;
  if (claim.expiresAt) {
    if (Date.now() > new Date(claim.expiresAt).getTime()) return false;
  }
  return isProcessAlive(claim.claimedBy.sessionPid);
}

/**
 * Acquire an exclusive lock file using O_EXCL.
 * Returns true if lock acquired, false if busy.
 * Stale locks (>30s) are force-removed.
 */
function acquireClaimLock(name: string): boolean {
  ensureClaimsDir();
  const lockPath = claimFilePath(name) + ".lock";
  // Remove stale locks older than 30s
  if (existsSync(lockPath)) {
    try {
      const { mtimeMs } = statSync(lockPath);
      if (Date.now() - mtimeMs > 30_000) {
        unlinkSync(lockPath);
      }
    } catch {
      /* ignore */
    }
  }
  return atomicCreate(lockPath, `${process.pid}\n`);
}

function releaseClaimLock(name: string): void {
  const lockPath = claimFilePath(name) + ".lock";
  try {
    unlinkSync(lockPath);
  } catch {
    /* ignore */
  }
}

export function claimName(
  name: string,
  instanceId: string,
  pid: number,
  source: HeartbeatSource,
): NameClaimResult {
  ensureClaimsDir();

  // Acquire exclusive lock — serializes all claim operations for this name
  if (!acquireClaimLock(name)) {
    // Lock busy — another process is claiming right now
    return {
      success: false,
      claim: null,
      conflictWith: {
        instanceId: "lock-busy",
        alive: true,
        lastActivity: new Date().toISOString(),
      },
    };
  }

  try {
    return claimNameLocked(name, instanceId, pid, source);
  } finally {
    releaseClaimLock(name);
  }
}

/**
 * Claim logic under exclusive lock — no race conditions.
 */
function claimNameLocked(
  name: string,
  instanceId: string,
  pid: number,
  source: HeartbeatSource,
): NameClaimResult {
  const filePath = claimFilePath(name);
  const claim = createClaim(name, instanceId, pid, source);
  const data = JSON.stringify(claim, null, 2) + "\n";

  const existing = checkClaim(name);

  // No existing claim → create
  if (!existing) {
    atomicOverwrite(filePath, data);
    return { success: true, claim, conflictWith: null };
  }

  // Same instance + same PID → idempotent
  if (
    existing.claimedBy.instanceId === instanceId &&
    existing.claimedBy.sessionPid === pid
  ) {
    return { success: true, claim: existing, conflictWith: null };
  }

  // Same instance, different PID → restart reclaim only if previous claim is not alive
  if (existing.claimedBy.instanceId === instanceId) {
    if (isClaimAlive(existing)) {
      // Previous claim still alive (not expired AND PID running) — true conflict
      return {
        success: false,
        claim: null,
        conflictWith: {
          instanceId: existing.claimedBy.instanceId,
          alive: true,
          lastActivity: existing.claimedAt,
        },
      };
    }
    atomicOverwrite(filePath, data);
    return { success: true, claim, conflictWith: null };
  }

  // Different instance — check liveness
  if (!isClaimAlive(existing)) {
    // Dead claim — take over
    atomicOverwrite(filePath, data);
    return { success: true, claim, conflictWith: null };
  }

  // Alive conflict — reject
  return {
    success: false,
    claim: null,
    conflictWith: {
      instanceId: existing.claimedBy.instanceId,
      alive: true,
      lastActivity: existing.claimedAt,
    },
  };
}

/**
 * Release claim — under lock, only if caller owns it.
 */
export function releaseClaim(
  name: string,
  instanceId?: string,
  pid?: number,
): boolean {
  if (!acquireClaimLock(name)) return false;
  try {
    return releaseClaimLocked(name, instanceId, pid);
  } finally {
    releaseClaimLock(name);
  }
}

function releaseClaimLocked(
  name: string,
  instanceId?: string,
  pid?: number,
): boolean {
  const filePath = claimFilePath(name);
  if (!existsSync(filePath)) return false;

  if (instanceId || pid) {
    const claim = checkClaim(name);
    if (!claim) return false;
    if (instanceId && claim.claimedBy.instanceId !== instanceId) return false;
    if (pid && claim.claimedBy.sessionPid !== pid) return false;
  }

  try {
    unlinkSync(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Renew TTL — under lock, only if caller owns the claim.
 */
export function renewClaimTTL(
  name: string,
  instanceId?: string,
  pid?: number,
): boolean {
  if (!acquireClaimLock(name)) return false;
  try {
    return renewClaimTTLLocked(name, instanceId, pid);
  } finally {
    releaseClaimLock(name);
  }
}

function renewClaimTTLLocked(
  name: string,
  instanceId?: string,
  pid?: number,
): boolean {
  const claim = checkClaim(name);
  if (!claim || claim.status === "released") return false;

  if (instanceId && claim.claimedBy.instanceId !== instanceId) return false;
  if (pid && claim.claimedBy.sessionPid !== pid) return false;

  claim.expiresAt = new Date(Date.now() + CLAIM_TTL_MS).toISOString();
  const filePath = claimFilePath(name);
  atomicOverwrite(filePath, JSON.stringify(claim, null, 2) + "\n");
  return true;
}

export function expireStale(): string[] {
  ensureClaimsDir();
  const expired: string[] = [];

  for (const file of readdirSync(CLAIMS_DIR)) {
    if (!file.endsWith(".json")) continue;
    const filePath = join(CLAIMS_DIR, file);
    try {
      const raw = readFileSync(filePath, "utf-8");
      const claim = JSON.parse(raw) as NameClaim;
      if (!isClaimAlive(claim)) {
        unlinkSync(filePath);
        expired.push(claim.name);
      }
    } catch {
      // Skip corrupted files
    }
  }

  return expired;
}

// ─── Internal ──────────────────────────────────────────────────

function createClaim(
  name: string,
  instanceId: string,
  pid: number,
  source: HeartbeatSource,
): NameClaim {
  return {
    name,
    claimedBy: { instanceId, sessionPid: pid, source },
    claimedAt: new Date().toISOString(),
    nonce: randomUUID(),
    status: "confirmed",
    expiresAt: new Date(Date.now() + CLAIM_TTL_MS).toISOString(),
  };
}
