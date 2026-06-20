import { describe, expect, it } from "vitest";
import { resolveInstanceIdSuffix } from "../commands/bridge-start.js";

// M392: per-session TAP_INSTANCE_ID suffix resolution.
// Covers flag/env opt-in matrix and validation of explicit suffix values.

describe("resolveInstanceIdSuffix", () => {
  it("returns undefined when neither flag nor env is set", () => {
    const result = resolveInstanceIdSuffix(undefined, {});
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.suffix).toBeUndefined();
  });

  it("auto-generates a 6 hex char suffix when flag is bare boolean", () => {
    const result = resolveInstanceIdSuffix(true, {});
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.suffix).toMatch(/^[a-f0-9]{6}$/);
    }
  });

  it("auto-generates when explicit string is empty", () => {
    const result = resolveInstanceIdSuffix("", {});
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.suffix).toMatch(/^[a-f0-9]{6}$/);
    }
  });

  it("uses explicit value when within pattern", () => {
    const result = resolveInstanceIdSuffix("abc123", {});
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.suffix).toBe("abc123");
  });

  it("trims whitespace around explicit value", () => {
    const result = resolveInstanceIdSuffix("  ses42  ", {});
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.suffix).toBe("ses42");
  });

  it("rejects explicit value with uppercase", () => {
    const result = resolveInstanceIdSuffix("AbC123", {});
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.message).toMatch(/Invalid --instance-id-suffix/);
  });

  it("rejects explicit value too short", () => {
    const result = resolveInstanceIdSuffix("ab1", {});
    expect(result.ok).toBe(false);
  });

  it("rejects explicit value too long", () => {
    const result = resolveInstanceIdSuffix("a".repeat(17), {});
    expect(result.ok).toBe(false);
  });

  it("rejects explicit value with hyphens", () => {
    const result = resolveInstanceIdSuffix("ab-cd-ef", {});
    expect(result.ok).toBe(false);
  });

  it("auto-generates when env opt-in is '1'", () => {
    const result = resolveInstanceIdSuffix(undefined, {
      TAP_INSTANCE_ID_AUTO_SUFFIX: "1",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.suffix).toMatch(/^[a-f0-9]{6}$/);
  });

  it("auto-generates when env opt-in is 'true' (case insensitive)", () => {
    const result = resolveInstanceIdSuffix(undefined, {
      TAP_INSTANCE_ID_AUTO_SUFFIX: "TRUE",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.suffix).toMatch(/^[a-f0-9]{6}$/);
  });

  it("ignores env when value is '0'", () => {
    const result = resolveInstanceIdSuffix(undefined, {
      TAP_INSTANCE_ID_AUTO_SUFFIX: "0",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.suffix).toBeUndefined();
  });

  it("explicit flag wins over env auto-suffix", () => {
    const result = resolveInstanceIdSuffix("pinned1", {
      TAP_INSTANCE_ID_AUTO_SUFFIX: "1",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.suffix).toBe("pinned1");
  });

  it("generates distinct suffixes across calls (collision sanity)", () => {
    const samples = new Set<string>();
    for (let i = 0; i < 20; i++) {
      const result = resolveInstanceIdSuffix(true, {});
      expect(result.ok).toBe(true);
      if (result.ok && result.suffix) samples.add(result.suffix);
    }
    // 20 calls of 6-hex random; collisions astronomically unlikely.
    expect(samples.size).toBeGreaterThanOrEqual(19);
  });
});
