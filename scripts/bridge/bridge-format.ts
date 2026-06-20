// bridge-format.ts — Message formatting for dispatch

import { writeFileSync } from "fs";
import { join } from "path";
import type {
  Candidate,
  DispatchMode,
  HeartbeatStore,
} from "./bridge-types.ts";
import { buildTapMessagePrompt } from "../../src/routing/tap-message-prompt.ts";
import { resolveAddressLabel } from "./bridge-routing.ts";
import { getProcessedMarkerPath } from "./bridge-candidates.ts";

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
  return buildTapMessagePrompt({
    agentName,
    sender,
    recipient,
    subject,
    fileName: candidate.fileName,
    body: candidate.body,
    replyTo: candidate.sender || "unknown",
    returnAddress: candidate.fromAddress,
  });
}

export function writeProcessedMarker(
  stateDir: string,
  candidate: Candidate,
  dispatchMode: DispatchMode,
  threadId: string | null,
  turnId: string | null,
  blockedReason?: string | null,
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
    blockedReason: blockedReason?.trim() || null,
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
  dispatchMode: DispatchMode,
  threadId: string | null,
  turnId: string | null,
  blockedReason?: string | null,
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
    blockedReason: blockedReason?.trim() || null,
    dispatchedAt: new Date().toISOString(),
  };
  writeFileSync(
    join(stateDir, "last-dispatch.json"),
    `${JSON.stringify(payload, null, 2)}\n`,
    "utf8",
  );
}
