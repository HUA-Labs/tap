import type { TapTrackedConfig, TrackedValue } from "./types.js";

/**
 * FNV-1a 32-bit hash — fast, deterministic, no crypto dependency.
 * Used for config drift detection, not security.
 */
function fnv1a32(input: string): string {
  let hash = 0x811c9dc5; // FNV offset basis
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193); // FNV prime
  }
  // Convert to unsigned 32-bit hex
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * Extract plain values from tracked config for hashing.
 * Keys are sorted for deterministic output.
 */
function extractValues(config: TapTrackedConfig): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(config).sort()) {
    const tv = config[key as keyof TapTrackedConfig] as TrackedValue<unknown>;
    result[key] = tv.value;
  }
  return result;
}

/**
 * Compute a stable hash of the entire tracked config.
 * Same config values → same hash. Any value change → different hash.
 */
export function computeConfigHash(config: TapTrackedConfig): string {
  const values = extractValues(config);
  const serialized = JSON.stringify(values);
  return fnv1a32(serialized);
}
