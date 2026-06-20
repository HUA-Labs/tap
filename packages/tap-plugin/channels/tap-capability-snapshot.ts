import {
  buildHeartbeatConnectHash,
  getAgentIdentitySnapshot,
  getAgentReceiveTransports,
  resolveCurrentInstanceId,
  type AgentCapabilitySnapshot,
  type Heartbeat,
} from "./tap-utils.js";
import {
  normalizeReceiveTransports,
  type TapReceiveTransport,
} from "../../../src/routing/receive-transports.js";

type ParseCapabilityRegistrationOptions = {
  allowConversationId?: boolean;
  requireAtLeastOne?: boolean;
};

type ParsedCapabilityRegistrationArgs =
  | {
      ok: true;
      explicitReceiveTransports: TapReceiveTransport[] | null;
      explicitConversationId: string | null | undefined;
      explicitOwnerClientId: string | null | undefined;
    }
  | {
      ok: false;
      errorText: string;
    };

type BuildHeartbeatRecordOptions = {
  agentId: string;
  agentName: string;
  status: Heartbeat["status"];
  existing?: Heartbeat;
  timestamp: string;
  lastActivity: string;
  joinedAt?: string;
  resetCapabilities?: boolean;
  explicitReceiveTransports?: TapReceiveTransport[] | null;
  explicitConversationId?: string | null;
  explicitOwnerClientId?: string | null;
};

export type BuiltHeartbeatRecord = {
  heartbeat: Heartbeat;
  capabilitySnapshot: AgentCapabilitySnapshot;
  preserveBridgeSource: boolean;
  resolvedInstanceId: string | null;
  connectHash: string;
};

function hasValue(value: string | null | undefined): value is string {
  return Boolean(value?.trim());
}

export function parseCapabilityRegistrationArgs(
  rawArgs: Record<string, unknown>,
  options: ParseCapabilityRegistrationOptions = {},
): ParsedCapabilityRegistrationArgs {
  let explicitReceiveTransports: TapReceiveTransport[] | null = null;
  if (typeof rawArgs.receiveTransports !== "undefined") {
    if (
      !Array.isArray(rawArgs.receiveTransports) ||
      rawArgs.receiveTransports.some(
        (value) =>
          value !== "mcp-channel" &&
          value !== "consent-drive" &&
          value !== "polling",
      )
    ) {
      return {
        ok: false,
        errorText:
          'Rejected: "receiveTransports" must be an array containing only "mcp-channel", "consent-drive", and/or "polling".',
      };
    }
    explicitReceiveTransports = normalizeReceiveTransports(
      rawArgs.receiveTransports,
    );
    if (explicitReceiveTransports.length === 0) {
      return {
        ok: false,
        errorText:
          'Rejected: "receiveTransports" override must include at least one supported transport.',
      };
    }
  }

  let explicitConversationId: string | null | undefined = undefined;
  if (typeof rawArgs.conversationId !== "undefined") {
    if (!options.allowConversationId) {
      return {
        ok: false,
        errorText:
          'Rejected: "conversationId" is not accepted here. Use tap_register_capabilities instead.',
      };
    }
    if (typeof rawArgs.conversationId !== "string") {
      return {
        ok: false,
        errorText: 'Rejected: "conversationId" must be a string when provided.',
      };
    }
    explicitConversationId = rawArgs.conversationId.trim() || null;
  }

  let explicitOwnerClientId: string | null | undefined = undefined;
  if (typeof rawArgs.ownerClientId !== "undefined") {
    if (!options.allowConversationId) {
      return {
        ok: false,
        errorText:
          'Rejected: "ownerClientId" is not accepted here. Use tap_register_capabilities instead.',
      };
    }
    if (typeof rawArgs.ownerClientId !== "string") {
      return {
        ok: false,
        errorText: 'Rejected: "ownerClientId" must be a string when provided.',
      };
    }
    explicitOwnerClientId = rawArgs.ownerClientId.trim() || null;
  }

  if (
    options.requireAtLeastOne &&
    explicitReceiveTransports == null &&
    typeof explicitConversationId === "undefined" &&
    typeof explicitOwnerClientId === "undefined"
  ) {
    return {
      ok: false,
      errorText:
        'Rejected: tap_register_capabilities requires at least one of "receiveTransports", "conversationId", or "ownerClientId".',
    };
  }

  return {
    ok: true,
    explicitReceiveTransports,
    explicitConversationId,
    explicitOwnerClientId,
  };
}

export function buildHeartbeatRecord(
  options: BuildHeartbeatRecordOptions,
): BuiltHeartbeatRecord {
  const resolvedInstanceId =
    resolveCurrentInstanceId() ?? options.existing?.instanceId ?? null;
  const connectHash = buildHeartbeatConnectHash(
    resolvedInstanceId,
    options.agentId,
  );
  const preserveBridgeSource =
    options.existing?.source === "bridge-dispatch" &&
    options.existing.connectHash === connectHash;
  const identitySnapshot = getAgentIdentitySnapshot();
  const inferredReceiveTransports = getAgentReceiveTransports();
  const existingTransports = normalizeReceiveTransports(
    options.existing?.receiveTransports ??
      options.existing?.capabilities?.receiveTransports,
  );
  const existingConversationId =
    options.existing?.address?.conversationId ??
    options.existing?.capabilities?.conversationId ??
    null;
  const existingOwnerClientId =
    options.existing?.address?.ownerClientId ??
    options.existing?.capabilities?.ownerClientId ??
    null;
  const existingConsentDriveTupleIsComplete =
    !options.resetCapabilities &&
    existingTransports.includes("consent-drive") &&
    hasValue(existingConversationId) &&
    hasValue(existingOwnerClientId);
  const shouldPreserveExistingTransports =
    !options.resetCapabilities &&
    (options.existing?.capabilities?.receiveTransportsSource === "explicit" ||
      existingConsentDriveTupleIsComplete);
  const existingReceiveTransports =
    shouldPreserveExistingTransports && existingTransports.length > 0
      ? existingTransports
      : undefined;
  const receiveTransports =
    options.explicitReceiveTransports ??
    existingReceiveTransports ??
    inferredReceiveTransports;
  const receiveTransportsSource =
    options.explicitReceiveTransports != null
      ? "explicit"
      : existingReceiveTransports != null
        ? (options.existing?.capabilities?.receiveTransportsSource ??
          "heuristic")
        : "heuristic";
  const identityAddress = options.resetCapabilities
    ? {
        ...identitySnapshot.address,
        conversationId: null,
        ownerClientId: null,
      }
    : identitySnapshot.address;
  const existingAddress =
    !options.resetCapabilities && options.existing
      ? {
          ...(options.existing.address ?? identityAddress),
          conversationId: existingConsentDriveTupleIsComplete
            ? existingConversationId
            : (options.existing.address?.conversationId ?? null),
          ownerClientId: existingConsentDriveTupleIsComplete
            ? existingOwnerClientId
            : (options.existing.address?.ownerClientId ?? null),
        }
      : undefined;
  const baseAddress =
    !options.resetCapabilities && existingAddress
      ? existingAddress
      : identityAddress;
  const hasExplicitConversationId =
    typeof options.explicitConversationId !== "undefined";
  const hasExplicitOwnerClientId =
    typeof options.explicitOwnerClientId !== "undefined";
  const address =
    !hasExplicitConversationId && !hasExplicitOwnerClientId
      ? baseAddress
      : {
          ...baseAddress,
          conversationId: hasExplicitConversationId
            ? (options.explicitConversationId ?? null)
            : (baseAddress.conversationId ?? null),
          ownerClientId: hasExplicitOwnerClientId
            ? (options.explicitOwnerClientId ?? null)
            : (baseAddress.ownerClientId ?? null),
        };
  const capabilitySnapshot: AgentCapabilitySnapshot = {
    receiveTransports,
    receiveTransportsSource,
    conversationId: address.conversationId ?? null,
    ownerClientId: address.ownerClientId ?? null,
  };

  return {
    heartbeat: {
      id: options.agentId,
      agent: options.agentName,
      timestamp: options.timestamp,
      lastActivity: options.lastActivity,
      joinedAt: options.joinedAt ?? options.existing?.joinedAt,
      status: options.status,
      source: preserveBridgeSource ? "bridge-dispatch" : "mcp-direct",
      instanceId: resolvedInstanceId,
      bridgePid: preserveBridgeSource
        ? (options.existing?.bridgePid ?? null)
        : null,
      connectHash,
      address,
      receiveTransports: capabilitySnapshot.receiveTransports,
      capabilities: capabilitySnapshot,
    },
    capabilitySnapshot,
    preserveBridgeSource,
    resolvedInstanceId,
    connectHash,
  };
}
