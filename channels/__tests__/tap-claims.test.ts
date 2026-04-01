import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

let tmpDir: string;
let claimsDir: string;

// Mock COMMS_DIR before importing
beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tap-claims-test-"));
  claimsDir = path.join(tmpDir, ".claims");
  vi.stubEnv("TAP_COMMS_DIR", tmpDir);
});

afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// Dynamic import to pick up mocked env
async function loadClaims() {
  // Clear module cache for fresh import with new env
  const mod = await import("../tap-claims.js");
  return mod;
}

describe("tap-claims", () => {
  it("creates a new claim when no existing claim", async () => {
    const { claimName } = await loadClaims();
    const result = claimName("돌", "codex-worker", process.pid, "mcp-direct");

    expect(result.success).toBe(true);
    expect(result.claim).not.toBeNull();
    expect(result.claim!.name).toBe("돌");
    expect(result.claim!.claimedBy.instanceId).toBe("codex-worker");
    expect(result.claim!.status).toBe("confirmed");
    expect(result.conflictWith).toBeNull();
  });

  it("allows same instance to reclaim (restart)", async () => {
    const { claimName } = await loadClaims();
    // Initial claim with a dead PID (simulates previous process that exited)
    const deadPid = 2147483647;
    claimName("솔", "codex-worker", deadPid, "mcp-direct");

    // Same instanceId, different PID (simulating restart after previous died)
    const result = claimName(
      "솔",
      "codex-worker",
      process.pid,
      "mcp-direct",
    );
    expect(result.success).toBe(true);
    expect(result.claim!.claimedBy.sessionPid).toBe(process.pid);
  });

  it("rejects claim when another alive instance holds it", async () => {
    const { claimName } = await loadClaims();
    // First claim by current process (alive)
    claimName("물", "codex-worker", process.pid, "mcp-direct");

    // Different instance tries to claim same name
    const result = claimName(
      "물",
      "codex-reviewer",
      process.pid + 1,
      "mcp-direct",
    );
    expect(result.success).toBe(false);
    expect(result.conflictWith).not.toBeNull();
    expect(result.conflictWith!.instanceId).toBe("codex-worker");
    expect(result.conflictWith!.alive).toBe(true);
  });

  it("allows takeover when existing claim PID is dead", async () => {
    const { claimName, checkClaim } = await loadClaims();
    // Create a claim with a definitely-dead PID
    claimName("결", "codex-old", 999999, "mcp-direct");

    // New instance takes over
    const result = claimName("결", "codex-new", process.pid, "mcp-direct");
    expect(result.success).toBe(true);
    expect(result.claim!.claimedBy.instanceId).toBe("codex-new");
  });

  it("releases a claim", async () => {
    const { claimName, releaseClaim, checkClaim } = await loadClaims();
    claimName("돌", "codex-worker", process.pid, "mcp-direct");
    expect(checkClaim("돌")).not.toBeNull();

    const released = releaseClaim("돌");
    expect(released).toBe(true);
    expect(checkClaim("돌")).toBeNull();
  });

  it("returns false when releasing nonexistent claim", async () => {
    const { releaseClaim } = await loadClaims();
    expect(releaseClaim("nonexistent")).toBe(false);
  });

  it("renews TTL on existing claim", async () => {
    const { claimName, renewClaimTTL, checkClaim } = await loadClaims();
    claimName("돌", "codex-worker", process.pid, "mcp-direct");

    const before = checkClaim("돌")!.expiresAt;
    // Small delay to ensure different timestamp
    await new Promise((r) => setTimeout(r, 10));
    renewClaimTTL("돌", "codex-worker", process.pid);
    const after = checkClaim("돌")!.expiresAt;

    expect(after).not.toBe(before);
  });

  it("expires stale claims", async () => {
    const { claimName, expireStale, checkClaim } = await loadClaims();
    // Create claim with dead PID
    claimName("old", "codex-dead", 999999, "mcp-direct");

    const expired = expireStale();
    expect(expired).toContain("old");
    expect(checkClaim("old")).toBeNull();
  });

  it("checkClaim returns null for nonexistent name", async () => {
    const { checkClaim } = await loadClaims();
    expect(checkClaim("nobody")).toBeNull();
  });

  it("renewClaimTTL rejects wrong owner", async () => {
    const { claimName, renewClaimTTL } = await loadClaims();
    claimName("돌", "codex-worker", process.pid, "mcp-direct");

    // Different instanceId cannot renew
    const renewed = renewClaimTTL("돌", "codex-reviewer", process.pid);
    expect(renewed).toBe(false);
  });

  it("releaseClaim rejects wrong owner", async () => {
    const { claimName, releaseClaim, checkClaim } = await loadClaims();
    claimName("돌", "codex-worker", process.pid, "mcp-direct");

    // Different instanceId cannot release
    const released = releaseClaim("돌", "codex-reviewer", process.pid);
    expect(released).toBe(false);
    expect(checkClaim("돌")).not.toBeNull(); // still claimed
  });

  it("resolveClaimInstanceId falls back to PID-based identity", async () => {
    const { resolveClaimInstanceId } = await loadClaims();
    // With no env vars set, should use PID
    delete process.env.TAP_BRIDGE_INSTANCE_ID;
    delete process.env.TAP_AGENT_ID;
    const id = resolveClaimInstanceId();
    expect(id).toBe(`mcp-direct-${process.pid}`);
  });

  it("uses O_EXCL for atomic create — second concurrent create reads existing", async () => {
    const { claimName } = await loadClaims();
    // First claim succeeds
    const r1 = claimName("race", "instance-1", process.pid, "mcp-direct");
    expect(r1.success).toBe(true);

    // Second claim by different instance — should conflict (alive PID)
    const r2 = claimName("race", "instance-2", process.pid + 1, "mcp-direct");
    expect(r2.success).toBe(false);
    expect(r2.conflictWith!.instanceId).toBe("instance-1");
  });

  it("rejects same instanceId with different alive PID (claim stealing prevention)", async () => {
    const { claimName } = await loadClaims();
    // Process A claims with current PID (alive)
    const r1 = claimName("guard", "codex-worker", process.pid, "mcp-direct");
    expect(r1.success).toBe(true);

    // Process B with same instanceId but different PID — should fail because A is alive
    const r2 = claimName("guard", "codex-worker", process.pid + 99999, "mcp-direct");
    expect(r2.success).toBe(false);
    expect(r2.conflictWith).not.toBeNull();
    expect(r2.conflictWith!.instanceId).toBe("codex-worker");
    expect(r2.conflictWith!.alive).toBe(true);
  });

  it("allows same instanceId reclaim when previous PID is dead", async () => {
    const { claimName } = await loadClaims();
    // Claim with a PID that doesn't exist (dead process)
    const deadPid = 2147483647; // very high PID, almost certainly not running
    const r1 = claimName("reclaim", "codex-worker", deadPid, "mcp-direct");
    expect(r1.success).toBe(true);

    // Reclaim with new PID — should succeed because old PID is dead
    const r2 = claimName("reclaim", "codex-worker", process.pid, "mcp-direct");
    expect(r2.success).toBe(true);
    expect(r2.claim!.claimedBy.sessionPid).toBe(process.pid);
  });
});
