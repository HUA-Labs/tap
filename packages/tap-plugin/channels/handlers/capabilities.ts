import {
  getAgentId,
  getAgentIdentitySnapshot,
  getAgentName,
  getLastActivityTime,
} from "../tap-utils.js";
import {
  acquireLock,
  loadHeartbeats,
  releaseLock,
  saveHeartbeats,
  writePresenceFile,
} from "../tap-io.ts";
import {
  buildHeartbeatRecord,
  parseCapabilityRegistrationArgs,
} from "../tap-capability-snapshot.js";
import { writeRouteLeaseFile } from "../tap-route-lease.js";
import {
  discoverCodexOwnerClientId,
  type CodexOwnerDiscoveryResult,
} from "../../../../src/routing/codex-owner-discovery.js";

type TextToolResponse = {
  content: Array<{ type: "text"; text: string }>;
};

export interface HandleRegisterCapabilitiesOptions {
  discoverOwnerClientId?: (options: {
    conversationId: string;
    hostId?: string | null;
  }) => Promise<CodexOwnerDiscoveryResult>;
}

function formatOwnerDiscoveryNote(
  result: CodexOwnerDiscoveryResult | null,
): string {
  if (!result) return "";
  if (result.status === "found") {
    return ` ownerDiscovery=found(${result.ownerClientId}).`;
  }
  return ` ownerDiscovery=${result.status}(${result.message}).`;
}

export async function handleRegisterCapabilities(
  rawArgs: Record<string, unknown>,
  heartbeatsLockPath: string,
  options: HandleRegisterCapabilitiesOptions = {},
): Promise<TextToolResponse> {
  const agentId = getAgentId();
  const agentName = getAgentName();
  if (agentId === "unknown" || agentName === "unknown") {
    return {
      content: [
        {
          type: "text",
          text: "Rejected: tap_register_capabilities requires a confirmed agent identity. Call tap_set_name first.",
        },
      ],
    };
  }

  const parsedCapabilities = parseCapabilityRegistrationArgs(rawArgs, {
    allowConversationId: true,
    requireAtLeastOne: true,
  });
  if (!parsedCapabilities.ok) {
    return {
      content: [{ type: "text", text: parsedCapabilities.errorText }],
    };
  }

  const {
    explicitReceiveTransports,
    explicitConversationId,
    explicitOwnerClientId,
  } = parsedCapabilities;
  let resolvedOwnerClientId = explicitOwnerClientId;
  let ownerDiscoveryResult: CodexOwnerDiscoveryResult | null = null;

  if (
    typeof explicitConversationId === "string" &&
    explicitConversationId &&
    typeof explicitOwnerClientId === "undefined"
  ) {
    ownerDiscoveryResult = await (
      options.discoverOwnerClientId ?? discoverCodexOwnerClientId
    )({
      conversationId: explicitConversationId,
      hostId: getAgentIdentitySnapshot().address.hostId,
    });
    resolvedOwnerClientId =
      ownerDiscoveryResult.status === "found"
        ? ownerDiscoveryResult.ownerClientId
        : null;
  }

  if (!acquireLock(heartbeatsLockPath)) {
    return {
      content: [{ type: "text", text: "Heartbeat store busy, try again." }],
    };
  }

  try {
    const store = loadHeartbeats();
    const existing = store[agentId];
    const now = new Date().toISOString();
    const heartbeatRecord = buildHeartbeatRecord({
      agentId,
      agentName,
      status: existing?.status ?? "active",
      existing,
      timestamp: now,
      lastActivity: getLastActivityTime(),
      joinedAt: existing?.joinedAt ?? now,
      explicitReceiveTransports,
      explicitConversationId,
      explicitOwnerClientId: resolvedOwnerClientId,
    });
    store[agentId] = {
      ...existing,
      ...heartbeatRecord.heartbeat,
    };
    saveHeartbeats(store);
    writePresenceFile(agentId, store[agentId]);
    writeRouteLeaseFile(agentId, store[agentId], "tap_register_capabilities");
  } finally {
    releaseLock(heartbeatsLockPath);
  }

  const store = loadHeartbeats();
  const updated = store[agentId];
  return {
    content: [
      {
        type: "text",
        text:
          `Capabilities registered for ${agentName}. ` +
          `receiveTransports=${(updated?.capabilities?.receiveTransports ?? updated?.receiveTransports ?? []).join(", ") || "unchanged"}; ` +
          `conversationId=${updated?.capabilities?.conversationId ?? updated?.address?.conversationId ?? "null"}; ` +
          `ownerClientId=${updated?.capabilities?.ownerClientId ?? updated?.address?.ownerClientId ?? "null"}.` +
          formatOwnerDiscoveryNote(ownerDiscoveryResult),
      },
    ],
  };
}
