import {
  buildTapMessagePrompt,
  type TapReturnAddress,
} from "../../../src/routing/tap-message-prompt.js";

type CompactInboxDisplayOptions = {
  agentName: string;
  sender: string;
  recipient: string;
  subject: string;
  filename: string;
  body: string;
  replyTo: string;
  fromAddress?: string | null;
  runtimeSurface?: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function optionalStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const aliases = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
  return aliases.length ? aliases : undefined;
}

export function parseTapReturnAddress(
  serialized: string | null | undefined,
): TapReturnAddress | null {
  if (!serialized?.trim()) return null;
  try {
    const parsed = JSON.parse(serialized);
    if (!isRecord(parsed)) return null;
    return {
      routingAddress: optionalString(parsed.routingAddress),
      hostId: optionalString(parsed.hostId),
      clientId: optionalString(parsed.clientId),
      conversationId: optionalString(parsed.conversationId),
      ownerClientId: optionalString(parsed.ownerClientId),
      surfaceInstanceId: optionalString(parsed.surfaceInstanceId),
      aliases: optionalStringArray(parsed.aliases),
    };
  } catch {
    return null;
  }
}

export function buildCompactInboxDisplay({
  agentName,
  sender,
  recipient,
  subject,
  filename,
  body,
  replyTo,
  fromAddress,
  runtimeSurface = "mcp-channel",
}: CompactInboxDisplayOptions): string {
  return buildTapMessagePrompt({
    agentName,
    sender,
    recipient,
    subject,
    fileName: filename,
    body,
    replyTo,
    returnAddress: parseTapReturnAddress(fromAddress),
    runtimeSurface,
  });
}
