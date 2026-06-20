import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";

export interface ProjectedEnvelopeBackfillInput {
  commsDir: string;
  sender: string;
  recipient: string;
  subject: string;
  body?: string | null;
  sourceSurface: string;
  receivedAt?: Date | string | null;
  messageId?: string | null;
  projectionId?: string | null;
  routeTurnId?: string | null;
}

export interface ProjectedEnvelopeBackfillResult {
  status: "written" | "exists";
  inboxPath: string;
  filePath: string;
  dedupeKey: string;
  messageId: string;
}

function normalize(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function safeFileLabel(value: string, fallback: string): string {
  const normalized = value
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}_-]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return normalized || fallback;
}

function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function buildDedupeKey(input: ProjectedEnvelopeBackfillInput): string {
  return (
    normalize(input.messageId) ??
    normalize(input.projectionId) ??
    normalize(input.routeTurnId) ??
    hashText(
      [input.sender, input.recipient, input.subject, input.body ?? ""].join(
        "\0",
      ),
    )
  );
}

function yamlString(value: string): string {
  return JSON.stringify(value);
}

function fieldMatches(content: string, field: string, value: string): boolean {
  return (
    content.includes(`${field}: ${value}`) ||
    content.includes(`${field}: ${yamlString(value)}`)
  );
}

function findExistingEvidence(options: {
  inboxDir: string;
  dedupeKey: string;
  messageId: string | null;
  projectionId: string | null;
  routeTurnId: string | null;
}): { inboxPath: string; filePath: string } | null {
  if (!fs.existsSync(options.inboxDir)) return null;
  for (const filename of fs.readdirSync(options.inboxDir).sort()) {
    if (!filename.endsWith(".md")) continue;
    const filePath = path.join(options.inboxDir, filename);
    let content: string;
    try {
      content = fs.readFileSync(filePath, "utf8");
    } catch {
      continue;
    }
    if (fieldMatches(content, "dedupe_key", options.dedupeKey)) {
      return { inboxPath: `inbox/${filename}`, filePath };
    }
    if (
      options.messageId &&
      (fieldMatches(content, "message_id", options.messageId) ||
        fieldMatches(content, "original_message_id", options.messageId))
    ) {
      return { inboxPath: `inbox/${filename}`, filePath };
    }
    if (
      options.projectionId &&
      fieldMatches(content, "projection_id", options.projectionId)
    ) {
      return { inboxPath: `inbox/${filename}`, filePath };
    }
    if (
      options.routeTurnId &&
      fieldMatches(content, "route_turn_id", options.routeTurnId)
    ) {
      return { inboxPath: `inbox/${filename}`, filePath };
    }
  }
  return null;
}

function summarizeBody(body: string | null | undefined): string {
  const normalized = body?.replace(/\s+/g, " ").trim() ?? "";
  if (!normalized) return "(no message body observed)";
  return normalized.length > 240
    ? `${normalized.slice(0, 237).trimEnd()}...`
    : normalized;
}

function isFileExistsError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  return "code" in error && error.code === "EEXIST";
}

export function writeProjectedEnvelopeBackfill(
  input: ProjectedEnvelopeBackfillInput,
): ProjectedEnvelopeBackfillResult {
  const sender = normalize(input.sender) ?? "unknown";
  const recipient = normalize(input.recipient) ?? "unknown";
  const subject = normalize(input.subject) ?? "no-subject";
  const sourceSurface = normalize(input.sourceSurface) ?? "unknown";
  const receivedAt = input.receivedAt
    ? new Date(input.receivedAt).toISOString()
    : new Date().toISOString();
  const messageId = normalize(input.messageId);
  const projectionId = normalize(input.projectionId);
  const routeTurnId = normalize(input.routeTurnId);
  const dedupeKey = buildDedupeKey(input);
  const backfillMessageId = `backfill-${hashText(dedupeKey).slice(0, 16)}`;
  const inboxDir = path.join(input.commsDir, "inbox");

  const existing = findExistingEvidence({
    inboxDir,
    dedupeKey,
    messageId,
    projectionId,
    routeTurnId,
  });
  if (existing) {
    return {
      status: "exists",
      ...existing,
      dedupeKey,
      messageId: backfillMessageId,
    };
  }

  fs.mkdirSync(inboxDir, { recursive: true });
  const date = receivedAt.slice(0, 10).replace(/-/g, "");
  const filename = `${date}-backfill-${safeFileLabel(sender, "sender")}-${safeFileLabel(
    recipient,
    "recipient",
  )}-${safeFileLabel(subject, "subject")}-${hashText(dedupeKey).slice(0, 8)}.md`;
  const filePath = path.join(inboxDir, filename);
  const lines = [
    "---",
    "type: inbox",
    "subtype: envelope-backfill",
    `message_id: ${backfillMessageId}`,
    messageId ? `original_message_id: ${messageId}` : null,
    `dedupe_key: ${yamlString(dedupeKey)}`,
    `from: ${sender}`,
    `to: ${recipient}`,
    `subject: ${subject}`,
    `source_surface: ${sourceSurface}`,
    `received_at: ${receivedAt}`,
    projectionId ? `projection_id: ${projectionId}` : null,
    routeTurnId ? `route_turn_id: ${routeTurnId}` : null,
    "---",
    "",
    "# Projected Envelope Backfill",
    "",
    "A projected tap envelope was observed without matching durable inbox evidence. This compact record preserves receiver-side audit context; it is not proof of live App delivery.",
    "",
    "## Summary",
    "",
    summarizeBody(input.body),
    "",
  ].filter((line): line is string => line !== null);

  try {
    fs.writeFileSync(filePath, lines.join("\n"), {
      encoding: "utf8",
      flag: "wx",
    });
  } catch (error) {
    if (!isFileExistsError(error)) throw error;
  }

  return {
    status: "written",
    inboxPath: `inbox/${filename}`,
    filePath,
    dedupeKey,
    messageId: backfillMessageId,
  };
}
