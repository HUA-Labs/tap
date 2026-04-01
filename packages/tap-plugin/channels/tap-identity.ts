const BROADCAST_RECIPIENTS = new Set(["전체", "all"]);

export const PLACEHOLDER_AGENT_VALUES = new Set([
  "unknown",
  "unnamed",
  "<set-per-session>",
]);

function trimAddress(value?: string | null): string {
  return value?.trim() ?? "";
}

export function canonicalizeAgentId(value: string): string {
  return trimAddress(value).replace(/-/g, "_");
}

export function isBroadcastRecipient(value: string): boolean {
  return BROADCAST_RECIPIENTS.has(trimAddress(value));
}

export function isPlaceholderAgentValue(value?: string | null): boolean {
  const normalized = trimAddress(value);
  return !normalized || PLACEHOLDER_AGENT_VALUES.has(normalized);
}

export function sameRoutingAddress(left: string, right: string): boolean {
  const normalizedLeft = trimAddress(left);
  const normalizedRight = trimAddress(right);
  if (!normalizedLeft || !normalizedRight) {
    return false;
  }

  if (
    isBroadcastRecipient(normalizedLeft) &&
    isBroadcastRecipient(normalizedRight)
  ) {
    return true;
  }

  return (
    normalizedLeft === normalizedRight ||
    canonicalizeAgentId(normalizedLeft) === canonicalizeAgentId(normalizedRight)
  );
}

export function matchesAgentRecipient(
  recipient: string,
  agentId: string,
  agentName: string,
): boolean {
  const normalizedRecipient = trimAddress(recipient);
  if (!normalizedRecipient) {
    return false;
  }

  return (
    isBroadcastRecipient(normalizedRecipient) ||
    sameRoutingAddress(normalizedRecipient, agentId) ||
    normalizedRecipient === trimAddress(agentName)
  );
}

export function isOwnMessageAddress(
  sender: string,
  agentId: string,
  agentName: string,
): boolean {
  const normalizedSender = trimAddress(sender);
  if (!normalizedSender) {
    return false;
  }

  return (
    sameRoutingAddress(normalizedSender, agentId) ||
    normalizedSender === trimAddress(agentName)
  );
}

export function normalizeRecipientList(
  rawRecipients: unknown,
  exclude: string[] = [],
): string[] | undefined {
  let recipients: string[] | undefined;
  if (rawRecipients == null) {
    recipients = undefined;
  } else if (typeof rawRecipients === "string") {
    const trimmed = trimAddress(rawRecipients);
    recipients = trimmed ? [trimmed] : undefined;
  } else if (Array.isArray(rawRecipients)) {
    const valid = rawRecipients
      .filter(
        (value): value is string =>
          typeof value === "string" && trimAddress(value).length > 0,
      )
      .map((value) => trimAddress(value));
    recipients = valid.length > 0 ? valid : undefined;
  } else {
    recipients = undefined;
  }

  if (!recipients) {
    return undefined;
  }

  const filtered: string[] = [];
  for (const recipient of recipients) {
    if (exclude.some((value) => sameRoutingAddress(value, recipient))) {
      continue;
    }
    if (filtered.some((value) => sameRoutingAddress(value, recipient))) {
      continue;
    }
    filtered.push(recipient);
  }

  return filtered.length > 0 ? filtered : undefined;
}
