export interface TapReturnAddress {
  routingAddress?: string | null;
  hostId?: string | null;
  clientId?: string | null;
  conversationId?: string | null;
  ownerClientId?: string | null;
  surfaceInstanceId?: string | null;
  aliases?: string[];
}

export interface TapMessagePromptOptions {
  agentName: string;
  sender: string;
  recipient: string;
  subject: string;
  fileName: string;
  body: string;
  replyTo: string;
  returnAddress?: TapReturnAddress | null;
  runtimeSurface?: string | null;
  debugEnvelope?: boolean;
}

export interface TapMessageViewModel {
  agentName: string;
  sender: string;
  recipient: string;
  subject: string;
  body: string;
  replyTarget: string | null;
  returnRoute: string | null;
  missingRoute: boolean;
  debugEnvelope: {
    fileName: string;
    returnAddress: TapReturnAddress | null;
    runtimeSurface: string | null;
  };
}

export interface RenderTapMessagePromptOptions {
  debugEnvelope?: boolean;
}

function isValidReplyTarget(value: string | null | undefined): value is string {
  const normalized = value?.trim().toLowerCase();
  return Boolean(
    normalized &&
    normalized !== "unknown" &&
    normalized !== "unnamed" &&
    normalized !== "null" &&
    normalized !== "undefined" &&
    normalized !== "?",
  );
}

function resolveReplyTarget(options: TapMessagePromptOptions): string | null {
  if (isValidReplyTarget(options.returnAddress?.routingAddress)) {
    return options.returnAddress.routingAddress.trim();
  }
  if (isValidReplyTarget(options.replyTo)) {
    return options.replyTo.trim();
  }
  return null;
}

function formatReturnRoute(options: TapMessagePromptOptions): string | null {
  const address = options.returnAddress;
  const parts: string[] = [];
  if (isValidReplyTarget(address?.routingAddress)) {
    parts.push(`routingAddress=${address.routingAddress.trim()}`);
  }
  if (address?.hostId?.trim()) parts.push(`hostId=${address.hostId.trim()}`);
  if (options.runtimeSurface?.trim()) {
    parts.push(`runtimeSurface=${options.runtimeSurface.trim()}`);
  }
  if (address?.clientId?.trim()) {
    parts.push(`clientId=${address.clientId.trim()}`);
  }
  if (address?.conversationId?.trim()) {
    parts.push(`conversationId=${address.conversationId.trim()}`);
  }
  if (address?.ownerClientId?.trim()) {
    parts.push(`ownerClientId=${address.ownerClientId.trim()}`);
  }
  if (address?.surfaceInstanceId?.trim()) {
    parts.push(`surfaceInstanceId=${address.surfaceInstanceId.trim()}`);
  }
  return parts.length ? parts.join("; ") : null;
}

export function createTapMessageViewModel(
  options: TapMessagePromptOptions,
): TapMessageViewModel {
  const body = options.body.trim();
  const replyTo = resolveReplyTarget(options);
  const returnRoute = formatReturnRoute(options);
  return {
    agentName: options.agentName,
    sender: options.sender,
    recipient: options.recipient,
    subject: options.subject,
    body: body || "(empty)",
    replyTarget: replyTo,
    returnRoute,
    missingRoute: !replyTo,
    debugEnvelope: {
      fileName: options.fileName,
      returnAddress: options.returnAddress ?? null,
      runtimeSurface: options.runtimeSurface ?? null,
    },
  };
}

function renderDebugEnvelope(viewModel: TapMessageViewModel): string[] {
  const address = viewModel.debugEnvelope.returnAddress;
  const lines = [
    "",
    "Debug envelope:",
    `- file: ${viewModel.debugEnvelope.fileName}`,
  ];
  if (viewModel.replyTarget) {
    lines.push(
      `- replyInstruction: Use tap_reply(to: "${viewModel.replyTarget}", subject: "<your-subject>", content: "<your-response>").`,
    );
  } else {
    lines.push("- replyInstruction: unavailable; do not reply to unknown");
  }
  if (viewModel.returnRoute) {
    lines.push(`- returnRoute: ${viewModel.returnRoute}`);
  }
  if (viewModel.debugEnvelope.runtimeSurface?.trim()) {
    lines.push(
      `- runtimeSurface: ${viewModel.debugEnvelope.runtimeSurface.trim()}`,
    );
  }
  if (address?.aliases?.length) {
    lines.push(`- aliases: ${address.aliases.join(", ")}`);
  }
  return lines;
}

export function renderAgentMessagePrompt(
  viewModel: TapMessageViewModel,
  options: RenderTapMessagePromptOptions = {},
): string {
  const replyInstructions = viewModel.replyTarget
    ? ["Reply:", `Reply available: ${viewModel.replyTarget}`]
    : [
        "Reply:",
        "Reply unavailable: no verified return route.",
        "No valid structured return route was provided; `unknown` is not a valid reply target.",
        "Preserve durable inbox evidence or ask tower/operator for a valid return route before replying.",
        "If the message is a review request, perform the review locally and report that the return route is missing.",
        'Do not reply to "unknown".',
      ];

  const lines = [
    `Tap message for ${viewModel.agentName}`,
    `From: ${viewModel.sender}`,
    `To: ${viewModel.recipient}`,
    `Subject: ${viewModel.subject}`,
    "",
    "Message:",
    viewModel.body,
    "",
    ...replyInstructions,
  ];
  if (options.debugEnvelope) {
    lines.push(...renderDebugEnvelope(viewModel));
  }
  return lines.join("\n");
}

export function buildTapMessagePrompt(
  options: TapMessagePromptOptions,
): string {
  return renderAgentMessagePrompt(createTapMessageViewModel(options), {
    debugEnvelope: options.debugEnvelope,
  });
}
