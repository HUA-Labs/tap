import {
  canonicalizeAgentId,
  isBroadcastRecipient,
  sameRoutingAddress,
} from "./tap-identity.js";

export const PEER_DM_WINDOW_MS = 5 * 60 * 1000;
export const PEER_DM_MAX_MESSAGES = 3;

export type PeerDmHistoryStore = Map<string, number[]>;

export type PeerDmRoute = {
  fromId: string;
  fromName?: string | null;
  to: string;
  resolvedTo?: string | null;
  towerName?: string | null;
  towerId?: string | null;
};

export type PeerDmRateLimitCheck = {
  allowed: boolean;
  exempt: boolean;
  key: string | null;
  target: string;
  recentCount: number;
};

function normalizeAddress(value?: string | null): string {
  return value?.trim() ?? "";
}

function matchesTowerAddress(
  value: string | null | undefined,
  towerName: string | null | undefined,
  towerId: string | null | undefined,
): boolean {
  const normalizedValue = normalizeAddress(value);
  const normalizedTower = normalizeAddress(towerName);
  const normalizedTowerId = normalizeAddress(towerId);
  if (!normalizedValue) return false;
  return (
    (!!normalizedTower &&
      (normalizedValue === normalizedTower ||
        sameRoutingAddress(normalizedValue, normalizedTower))) ||
    (!!normalizedTowerId &&
      (normalizedValue === normalizedTowerId ||
        sameRoutingAddress(normalizedValue, normalizedTowerId)))
  );
}

function resolveTargetAddress(route: PeerDmRoute): string {
  const candidate = normalizeAddress(route.resolvedTo) || normalizeAddress(route.to);
  return isBroadcastRecipient(candidate)
    ? "broadcast"
    : canonicalizeAgentId(candidate);
}

export function isPeerDmRateLimitExempt(route: PeerDmRoute): boolean {
  if (
    isBroadcastRecipient(normalizeAddress(route.to)) ||
    isBroadcastRecipient(normalizeAddress(route.resolvedTo))
  ) {
    return true;
  }

  const towerName = normalizeAddress(route.towerName);
  const towerId = normalizeAddress(route.towerId);
  if (!towerName && !towerId) return false;

  return (
    matchesTowerAddress(route.fromId, towerName, towerId) ||
    matchesTowerAddress(route.fromName, towerName, towerId) ||
    matchesTowerAddress(route.to, towerName, towerId) ||
    matchesTowerAddress(route.resolvedTo, towerName, towerId)
  );
}

function pruneHistory(
  entries: number[] | undefined,
  nowMs: number,
  windowMs: number,
): number[] {
  if (!entries?.length) return [];
  return entries.filter((timestamp) => nowMs - timestamp <= windowMs);
}

export function getPeerDmRateLimitKey(route: PeerDmRoute): string | null {
  if (isPeerDmRateLimitExempt(route)) {
    return null;
  }

  const from = canonicalizeAgentId(normalizeAddress(route.fromId));
  const to = resolveTargetAddress(route);
  if (!from || !to || to === "broadcast") {
    return null;
  }

  return `${from}->${to}`;
}

export function checkPeerDmRateLimit(
  store: PeerDmHistoryStore,
  route: PeerDmRoute,
  nowMs = Date.now(),
  maxMessages = PEER_DM_MAX_MESSAGES,
  windowMs = PEER_DM_WINDOW_MS,
): PeerDmRateLimitCheck {
  const key = getPeerDmRateLimitKey(route);
  const target = resolveTargetAddress(route);
  if (!key) {
    return {
      allowed: true,
      exempt: true,
      key: null,
      target,
      recentCount: 0,
    };
  }

  const recent = pruneHistory(store.get(key), nowMs, windowMs);
  return {
    allowed: recent.length < maxMessages,
    exempt: false,
    key,
    target,
    recentCount: recent.length,
  };
}

export function recordPeerDm(
  store: PeerDmHistoryStore,
  route: PeerDmRoute,
  nowMs = Date.now(),
  windowMs = PEER_DM_WINDOW_MS,
): void {
  const key = getPeerDmRateLimitKey(route);
  if (!key) return;

  const recent = pruneHistory(store.get(key), nowMs, windowMs);
  recent.push(nowMs);
  store.set(key, recent);
}
