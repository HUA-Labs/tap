import { mkdirSync, renameSync, writeFileSync } from "fs";
import { join } from "path";
import {
  ROUTE_LEASES_DIR,
  type Heartbeat,
  type TapAddressMetadata,
} from "./tap-utils.js";
import { canonicalizeAgentId } from "./tap-identity.js";
import type { TapReceiveTransport } from "../../../src/routing/receive-transports.js";

const DEFAULT_ROUTE_LEASE_TTL_HOURS = 24;

export type TapRouteLeaseSource =
  | "tap_set_name"
  | "tap_session_warmup"
  | "tap_register_capabilities";

export type TapRouteLease = {
  schemaVersion: 1;
  agentId: string;
  agent: string;
  source: TapRouteLeaseSource;
  registeredAt: string;
  updatedAt: string;
  expiresAt: string;
  status: Heartbeat["status"];
  receiveTransports: TapReceiveTransport[];
  route: TapAddressMetadata;
  capability: {
    conversationId: string | null;
    ownerClientId: string | null;
  };
  liveAuthority: false;
  liveAuthorityNote: string;
};

export function routeLeasePath(agentId: string): string {
  const canonicalId = canonicalizeAgentId(agentId);
  const filename = (canonicalId || agentId).replace(/[/\\:]/g, "_");
  return join(ROUTE_LEASES_DIR, `${filename}.json`);
}

function shouldWriteRouteLease(entry: Heartbeat): boolean {
  if (entry.status === "signing-off") return false;
  const receiveTransports =
    entry.capabilities?.receiveTransports ?? entry.receiveTransports ?? [];
  const hasLiveTransport =
    receiveTransports.includes("consent-drive") ||
    receiveTransports.includes("mcp-channel");
  const hasRouteTuple = Boolean(
    entry.address?.hostId &&
    (entry.address?.conversationId ||
      entry.capabilities?.conversationId ||
      entry.address?.ownerClientId ||
      entry.capabilities?.ownerClientId),
  );
  return hasLiveTransport || hasRouteTuple;
}

export function buildRouteLease(
  agentId: string,
  entry: Heartbeat,
  source: TapRouteLeaseSource,
  now = new Date(),
): TapRouteLease | null {
  if (!shouldWriteRouteLease(entry)) return null;

  const registeredAt = entry.joinedAt ?? entry.timestamp ?? now.toISOString();
  const updatedAt = now.toISOString();
  const receiveTransports =
    entry.capabilities?.receiveTransports ?? entry.receiveTransports ?? [];
  const route: TapAddressMetadata = {
    hostId: entry.address?.hostId ?? null,
    clientId: entry.address?.clientId ?? null,
    conversationId:
      entry.address?.conversationId ??
      entry.capabilities?.conversationId ??
      null,
    ownerClientId:
      entry.address?.ownerClientId ?? entry.capabilities?.ownerClientId ?? null,
    routingAddress: entry.address?.routingAddress ?? entry.agent,
    slot: entry.address?.slot ?? null,
    aliases: entry.address?.aliases ?? [entry.agent],
  };

  return {
    schemaVersion: 1,
    agentId,
    agent: entry.agent,
    source,
    registeredAt,
    updatedAt,
    expiresAt: new Date(
      now.getTime() + DEFAULT_ROUTE_LEASE_TTL_HOURS * 60 * 60 * 1000,
    ).toISOString(),
    status: entry.status,
    receiveTransports,
    route,
    capability: {
      conversationId: entry.capabilities?.conversationId ?? null,
      ownerClientId: entry.capabilities?.ownerClientId ?? null,
    },
    liveAuthority: false,
    liveAuthorityNote:
      "Route lease preserves stable registration only; live delivery must still re-check current runtime health and presence freshness.",
  };
}

export function writeRouteLeaseFile(
  agentId: string,
  entry: Heartbeat,
  source: TapRouteLeaseSource,
): TapRouteLease | null {
  const lease = buildRouteLease(agentId, entry, source);
  if (!lease) return null;

  try {
    mkdirSync(ROUTE_LEASES_DIR, { recursive: true });
    const filePath = routeLeasePath(lease.agent);
    const tmpPath = `${filePath}.tmp.${process.pid}`;
    writeFileSync(tmpPath, JSON.stringify(lease, null, 2), "utf-8");
    renameSync(tmpPath, filePath);
  } catch {
    return null;
  }

  return lease;
}
