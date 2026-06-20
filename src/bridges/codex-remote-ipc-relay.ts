#!/usr/bin/env node
import { createHash } from "node:crypto";
import { ExperimentalCodexIpcControlTransport } from "../transport/experimental/codex-ipc-control.js";

type RelayRequest = {
  commsDir?: string | null;
  hostId?: string | null;
  conversationId?: string | null;
  ownerClientId?: string | null;
  text?: string | null;
};

function normalizeString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function writeResult(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function extractTurnId(response: unknown): string | null {
  const responseRecord =
    response && typeof response === "object" && !Array.isArray(response)
      ? (response as Record<string, unknown>)
      : null;
  const payload =
    responseRecord?.result &&
    typeof responseRecord.result === "object" &&
    !Array.isArray(responseRecord.result)
      ? (responseRecord.result as Record<string, unknown>)
      : null;
  const direct =
    payload?.turn &&
    typeof payload.turn === "object" &&
    !Array.isArray(payload.turn)
      ? (payload.turn as { id?: unknown }).id
      : null;
  if (typeof direct === "string" && direct.trim()) {
    return direct.trim();
  }

  const nestedResult =
    payload?.result &&
    typeof payload.result === "object" &&
    !Array.isArray(payload.result)
      ? (payload.result as Record<string, unknown>)
      : null;
  const nested =
    nestedResult?.turn &&
    typeof nestedResult.turn === "object" &&
    !Array.isArray(nestedResult.turn)
      ? (nestedResult.turn as { id?: unknown }).id
      : null;
  return typeof nested === "string" && nested.trim() ? nested.trim() : null;
}

function summarizeId(value: string): string {
  return value.length <= 16 ? value : `${value.slice(0, 8)}...${value.slice(-6)}`;
}

function hashTuple(values: Array<string | null>): string {
  return createHash("sha256")
    .update(values.map((value) => value ?? "").join("\0"))
    .digest("hex")
    .slice(0, 16);
}

async function main(): Promise<void> {
  const raw = await readStdin();
  const request = JSON.parse(raw) as RelayRequest;
  const conversationId = normalizeString(request.conversationId);
  const ownerClientId = normalizeString(request.ownerClientId);
  const text = normalizeString(request.text);
  if (!conversationId || !ownerClientId || !text) {
    writeResult({
      ok: false,
      error:
        "codex remote relay requires conversationId, ownerClientId, and text",
    });
    process.exitCode = 2;
    return;
  }

  const transport = new ExperimentalCodexIpcControlTransport({
    commsDir: normalizeString(request.commsDir) ?? undefined,
    hostId: normalizeString(request.hostId),
  });
  const hostId = normalizeString(request.hostId);

  try {
    await transport.connect();
    const created = transport.createConsentReceipt({
      conversationId,
      hostId: normalizeString(request.hostId),
      ownerClientId,
      allowedMethods: ["thread-follower-start-turn"],
    });
    const result = await transport.startTurn({
      conversationId,
      text,
      consentRef: created.receipt.id,
      hostId,
      ownerClientId,
      action: "start-turn",
    });

    writeResult({
      ok: true,
      adapter: "ssh-ipc-relay",
      hostId,
      tupleHash: hashTuple([hostId, conversationId, ownerClientId]),
      conversationId: summarizeId(conversationId),
      ownerClientId: summarizeId(ownerClientId),
      turnId: extractTurnId(result.response),
      consentRef: created.receipt.id,
    });
  } catch (error) {
    writeResult({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
    process.exitCode = 1;
  } finally {
    await transport.disconnect().catch(() => undefined);
  }
}

main().catch((error) => {
  writeResult({
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  });
  process.exitCode = 1;
});
