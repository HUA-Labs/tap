// bridge-format.ts — Message formatting for dispatch

import { writeFileSync } from "fs";
import { join } from "path";
import { Candidate, HeartbeatStore } from "./bridge-types.js";
import { resolveAddressLabel } from "./bridge-routing.js";
import { getProcessedMarkerPath } from "./bridge-candidates.js";

export function buildUserInput(
  candidate: Candidate,
  agentName: string,
  heartbeats: HeartbeatStore,
): string {
  const sender = resolveAddressLabel(candidate.sender || "unknown", heartbeats);
  const recipient = resolveAddressLabel(
    candidate.recipient || agentName,
    heartbeats,
  );
  const subject = candidate.subject || "(none)";
  const body = candidate.body.trim();

  return [
    `Tap-comms inbox message for ${agentName}.`,
    `Sender: ${sender}`,
    `Recipient: ${recipient}`,
    `Subject: ${subject}`,
    `File: ${candidate.fileName}`,
    "",
    "Message body:",
    body || "(empty)",
    "",
    "---",
    "Instructions: Read the message above and respond using the tap_reply tool.",
    `Use tap_reply(to: "${candidate.sender || "unknown"}", subject: "<your-subject>", content: "<your-response>") to send your response.`,
    "If the message is a review request, perform the review and reply with your findings.",
    "If the message is informational, acknowledge briefly via tap_reply.",
    "Do NOT respond with plain text only — you MUST use the tap_reply tool.",
  ].join("\n");
}

export function writeProcessedMarker(
  stateDir: string,
  candidate: Candidate,
  dispatchMode: "start" | "steer",
  threadId: string | null,
  turnId: string | null,
): void {
  const payload = {
    requestFile: candidate.filePath,
    requestName: candidate.fileName,
    sender: candidate.sender,
    recipient: candidate.recipient,
    subject: candidate.subject,
    dispatchMode,
    threadId,
    turnId,
    markedAt: new Date().toISOString(),
  };
  writeFileSync(
    getProcessedMarkerPath(stateDir, candidate.markerId),
    `${JSON.stringify(payload, null, 2)}\n`,
    "utf8",
  );
}

export function writeLastDispatch(
  stateDir: string,
  candidate: Candidate,
  dispatchMode: "start" | "steer",
  threadId: string | null,
  turnId: string | null,
): void {
  const payload = {
    requestFile: candidate.filePath,
    requestName: candidate.fileName,
    markerId: candidate.markerId,
    sender: candidate.sender,
    recipient: candidate.recipient,
    subject: candidate.subject,
    dispatchMode,
    threadId,
    turnId,
    dispatchedAt: new Date().toISOString(),
  };
  writeFileSync(
    join(stateDir, "last-dispatch.json"),
    `${JSON.stringify(payload, null, 2)}\n`,
    "utf8",
  );
}
