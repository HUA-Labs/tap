import { basename } from "node:path";
import type { TransportAddress } from "../transport/types.js";

export type TapReceiveTransport = "mcp-channel" | "consent-drive" | "polling";

export interface ReceiveTransportRuntimeHints {
  runtimeName?: string | null;
  instanceId?: string | null;
  bridgeInstanceId?: string | null;
  agentId?: string | null;
  runtimeStateDir?: string | null;
  mcpClientName?: string | null;
}

const CODEX_BRIDGE_STATE_DIR_PREFIX = "codex-app-server-bridge-";
const VALID_RECEIVE_TRANSPORTS: readonly TapReceiveTransport[] = [
  "mcp-channel",
  "consent-drive",
  "polling",
];

function normalizeString(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function normalizeRuntimeToken(
  value: string | null | undefined,
): string | null {
  const normalized = normalizeString(value)?.replace(/-/g, "_").toLowerCase();
  return normalized || null;
}

function isCodexLikeToken(value: string | null | undefined): boolean {
  const normalized = normalizeRuntimeToken(value);
  return normalized === "codex" || Boolean(normalized?.startsWith("codex_"));
}

function isCodexRuntimeStateDir(value: string | null | undefined): boolean {
  const normalized = normalizeString(value);
  if (!normalized) return false;
  return basename(normalized).startsWith(CODEX_BRIDGE_STATE_DIR_PREFIX);
}

function isCodexMcpClient(value: string | null | undefined): boolean {
  const normalized = normalizeRuntimeToken(value);
  return normalized === "codex_mcp_client";
}

export function normalizeReceiveTransports(
  values: readonly string[] | null | undefined,
): TapReceiveTransport[] {
  const transports: TapReceiveTransport[] = [];
  for (const value of values ?? []) {
    if (!VALID_RECEIVE_TRANSPORTS.includes(value as TapReceiveTransport)) {
      continue;
    }
    const transport = value as TapReceiveTransport;
    if (transports.includes(transport)) {
      continue;
    }
    transports.push(transport);
  }
  return transports;
}

export function inferReceiveTransports(
  hints: ReceiveTransportRuntimeHints = {},
): TapReceiveTransport[] {
  if (
    normalizeRuntimeToken(hints.runtimeName) === "codex" ||
    isCodexLikeToken(hints.instanceId) ||
    isCodexLikeToken(hints.bridgeInstanceId) ||
    isCodexLikeToken(hints.agentId) ||
    isCodexRuntimeStateDir(hints.runtimeStateDir)
  ) {
    return ["consent-drive"];
  }

  if (isCodexMcpClient(hints.mcpClientName)) {
    return ["polling"];
  }

  return ["mcp-channel"];
}

export function prefersConsentDrive(
  values: readonly string[] | null | undefined,
): boolean {
  return normalizeReceiveTransports(values).includes("consent-drive");
}

export function canUseConsentDriveForAddress(options: {
  localHostId?: string | null;
  address?: TransportAddress | null;
}): boolean {
  const address = options.address;
  if (!address?.conversationId?.trim() || !address.ownerClientId?.trim()) {
    return false;
  }

  const localHostId = normalizeString(options.localHostId);
  const targetHostId = normalizeString(address.hostId);
  if (!localHostId || !targetHostId) {
    return true;
  }

  return localHostId.toLowerCase() === targetHostId.toLowerCase();
}
