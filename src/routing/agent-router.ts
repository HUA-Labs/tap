// ─── Routing Types ─────────────────────────────────────────────

export type RoutingMethod =
  | "exact-instance" // @instanceId direct targeting
  | "exact-name" // unique agent name match
  | "canonical-id" // canonicalized ID fallback
  | "most-recent" // ambiguous name → most recently active
  | "broadcast"; // 전체/all

export interface RoutingResolution {
  target: string;
  method: RoutingMethod;
  ambiguous: boolean;
  candidates: string[];
  warning: string | null;
}

export type PresenceLevel = "bridge-live" | "mcp-only" | "bridge-stale";

export interface AgentEntry {
  id: string;
  name: string;
  lastActivity: number; // epoch ms
  presence?: PresenceLevel;
}

// ─── Constants ─────────────────────────────────────────────────

const BROADCAST_NAMES = new Set(["전체", "all"]);
const INSTANCE_PREFIX = "@";

// ─── Core Router ───────────────────────────────────────────────

/**
 * Resolve a routing target with clear priority:
 * 1. @instanceId → exact instance match
 * 2. Unique agent name → exact name
 * 3. Multiple name matches → presence-based disambiguation
 * 4. Canonical ID fallback
 * 5. No match → error
 */
export function resolveRoute(
  to: string,
  agents: AgentEntry[],
): RoutingResolution {
  // Broadcast
  if (BROADCAST_NAMES.has(to)) {
    return {
      target: to,
      method: "broadcast",
      ambiguous: false,
      candidates: [],
      warning: null,
    };
  }

  // @instanceId direct targeting
  if (to.startsWith(INSTANCE_PREFIX)) {
    const instanceId = to.slice(INSTANCE_PREFIX.length);
    const found = agents.find((a) => a.id === instanceId);
    if (found) {
      return {
        target: found.id,
        method: "exact-instance",
        ambiguous: false,
        candidates: [found.id],
        warning: null,
      };
    }
    return {
      target: instanceId,
      method: "exact-instance",
      ambiguous: false,
      candidates: [],
      warning: `Instance "${instanceId}" not found in active agents.`,
    };
  }

  // Exact name match
  const nameMatches = agents.filter((a) => a.name === to);
  if (nameMatches.length === 1) {
    return {
      target: nameMatches[0].id,
      method: "exact-name",
      ambiguous: false,
      candidates: [nameMatches[0].id],
      warning: null,
    };
  }

  // Multiple name matches → presence-based disambiguation
  if (nameMatches.length > 1) {
    const sorted = disambiguateByPresence(nameMatches);
    const winner = sorted[0];
    const candidateIds = sorted.map((a) => a.id);
    return {
      target: winner.id,
      method: "most-recent",
      ambiguous: true,
      candidates: candidateIds,
      warning: `Routed "${to}" → "${winner.id}" (${winner.presence ?? "unknown"}, most recent of ${candidateIds.join(", ")}).`,
    };
  }

  // Exact ID match (non-prefixed)
  const idMatch = agents.find((a) => a.id === to);
  if (idMatch) {
    return {
      target: idMatch.id,
      method: "exact-instance",
      ambiguous: false,
      candidates: [idMatch.id],
      warning: null,
    };
  }

  // Canonical ID fallback (case-insensitive, hyphen/underscore normalization)
  const canonical = canonicalize(to);
  const canonicalMatch = agents.find(
    (a) =>
      canonicalize(a.id) === canonical || canonicalize(a.name) === canonical,
  );
  if (canonicalMatch) {
    return {
      target: canonicalMatch.id,
      method: "canonical-id",
      ambiguous: false,
      candidates: [canonicalMatch.id],
      warning: null,
    };
  }

  // No match
  const knownNames = [...new Set(agents.map((a) => a.name).filter(Boolean))];
  return {
    target: to,
    method: "exact-name",
    ambiguous: false,
    candidates: [],
    warning: `"${to}" is not a known agent. Known: ${knownNames.join(", ") || "none"}`,
  };
}

// ─── Disambiguation ────────────────────────────────────────────

const PRESENCE_PRIORITY: Record<PresenceLevel, number> = {
  "bridge-live": 3,
  "mcp-only": 2,
  "bridge-stale": 1,
};

/**
 * Sort agents by presence level (bridge-live first), then by lastActivity.
 */
function disambiguateByPresence(agents: AgentEntry[]): AgentEntry[] {
  return [...agents].sort((a, b) => {
    const pa = PRESENCE_PRIORITY[a.presence ?? "mcp-only"] ?? 0;
    const pb = PRESENCE_PRIORITY[b.presence ?? "mcp-only"] ?? 0;
    if (pa !== pb) return pb - pa; // higher presence wins
    return b.lastActivity - a.lastActivity; // more recent wins
  });
}

// ─── Helpers ───────────────────────────────────────────────────

function canonicalize(value: string): string {
  return value.toLowerCase().replace(/[-]/g, "_");
}
