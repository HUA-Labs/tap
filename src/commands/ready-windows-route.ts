import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import type { WindowsAppRouteHealth } from "../routing/windows-app-route-health.js";
import {
  createExperimentalCodexIpcControlTransport,
  type CodexIpcDriveActionResult,
} from "../transport/experimental/codex-ipc-control.js";

export interface PresenceRecord {
  timestamp?: string;
  receiveTransports?: string[];
  address?: {
    hostId?: string | null;
    clientId?: string | null;
    routingAddress?: string | null;
    aliases?: string[];
    conversationId?: string | null;
    ownerClientId?: string | null;
  } | null;
  capabilities?: {
    conversationId?: string | null;
    ownerClientId?: string | null;
    receiveTransports?: string[];
  } | null;
  health?: {
    status?: string | null;
    checkedAt?: string | null;
    source?: string | null;
  } | null;
  consentDriveStatus?: string | null;
  presenceFreshness?: string | null;
}

export interface WindowsRouteAppliedAction {
  name: string;
  status: "applied" | "would-apply" | "skipped" | "failed";
  path?: string;
  message: string;
  command?: string;
  evidencePath?: string;
  turnId?: string | null;
  consentRef?: string | null;
}

interface WindowsAppRouteSmokeTransport {
  connect(): Promise<unknown>;
  disconnect(): Promise<void>;
  createConsentReceipt(options: {
    conversationId: string;
    hostId?: string | null;
    ownerClientId?: string | null;
    allowedMethods: readonly string[];
  }): { receipt: { id: string } };
  startTurn(options: {
    conversationId: string;
    text: string;
    consentRef: string;
    hostId?: string | null;
    ownerClientId?: string | null;
    action?: string;
  }): Promise<CodexIpcDriveActionResult>;
}

let windowsAppRouteSmokeTransportFactoryForTests:
  | ((options: {
      commsDir: string;
      hostId?: string | null;
    }) => WindowsAppRouteSmokeTransport)
  | null = null;

export function __setWindowsAppRouteSmokeTransportFactoryForTests(
  factory:
    | ((options: {
        commsDir: string;
        hostId?: string | null;
      }) => WindowsAppRouteSmokeTransport)
    | null,
): void {
  windowsAppRouteSmokeTransportFactoryForTests = factory;
}

function yamlScalar(value: string): string {
  return JSON.stringify(value);
}

function safeFileLabel(value: string, fallback: string): string {
  const normalized = value
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}_-]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return normalized || fallback;
}

function uniqueNonEmpty(values: Array<string | null | undefined>): string[] {
  return [
    ...new Set(
      values
        .map((value) => value?.trim())
        .filter((value): value is string => Boolean(value)),
    ),
  ];
}

function writeJsonAtomic(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp.${process.pid}.${Date.now()}`;
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(value, null, 2), "utf8");
    fs.renameSync(tmpPath, filePath);
  } catch (error) {
    try {
      fs.rmSync(tmpPath, { force: true });
    } catch {
      // Best-effort temp cleanup; the original presence file is untouched.
    }
    throw error;
  }
}

function findWindowsRouteRefreshCandidate(
  routeHealth: WindowsAppRouteHealth,
): WindowsAppRouteHealth["candidates"][number] | null {
  return (
    routeHealth.candidates.find(
      (candidate) => candidate.matchesRequestedConversation,
    ) ??
    (routeHealth.candidates.length === 1 ? routeHealth.candidates[0] : null)
  );
}

function buildWindowsRoutePresenceRecord(options: {
  agent: string;
  existing: PresenceRecord | null;
  candidate: WindowsAppRouteHealth["candidates"][number];
  now: string;
}): PresenceRecord & Record<string, unknown> {
  const existing = options.existing ?? {};
  const existingAddress = existing.address ?? {};
  const existingCapabilities = existing.capabilities ?? {};
  const receiveTransports = uniqueNonEmpty([
    ...(existing.receiveTransports ?? []),
    ...(existingCapabilities.receiveTransports ?? []),
    "consent-drive",
  ]);
  const routingAddress = existingAddress.routingAddress ?? options.agent;
  const aliases = uniqueNonEmpty([
    ...(existingAddress.aliases ?? []),
    routingAddress,
    options.agent,
  ]);

  return {
    ...existing,
    id: options.agent,
    agent: options.agent,
    status: "active",
    timestamp: options.now,
    lastActivity: options.now,
    receiveTransports,
    address: {
      ...existingAddress,
      routingAddress,
      aliases,
      hostId: options.candidate.hostId,
      clientId: options.candidate.ownerClientId,
      conversationId: options.candidate.conversationId,
      ownerClientId: options.candidate.ownerClientId,
    },
    capabilities: {
      ...existingCapabilities,
      receiveTransports,
      conversationId: options.candidate.conversationId,
      ownerClientId: options.candidate.ownerClientId,
    },
    health: {
      ...(existing.health ?? {}),
      status: "ready",
      checkedAt: options.now,
      source: "tap ready --apply-windows-route-refresh",
    },
    consentDriveStatus: "ready",
    presenceFreshness: "fresh-for-routing",
  };
}

function writeWindowsRouteSmokeInboxEvidence(options: {
  commsDir: string;
  agent: string;
  subject: string;
  content: string;
  candidate: WindowsAppRouteHealth["candidates"][number];
  now?: Date;
}): {
  evidencePath: string;
  filePath: string;
  messageId: string;
  sentAt: string;
} {
  const now = options.now ?? new Date();
  const sentAt = now.toISOString();
  const date = sentAt.slice(0, 10).replace(/-/g, "");
  const messageId = randomUUID();
  const filename = `${date}-tap-ready-${safeFileLabel(
    options.agent,
    "agent",
  )}-${safeFileLabel(options.subject, "windows-route-smoke")}-${messageId.slice(
    0,
    8,
  )}.md`;
  const inboxDir = path.join(options.commsDir, "inbox");
  const filePath = path.join(inboxDir, filename);
  const frontmatter = [
    "---",
    "type: inbox",
    `message_id: ${messageId}`,
    "from: tap-ready",
    `to: ${options.agent}`,
    `from_address: ${JSON.stringify({
      hostId: options.commsDir,
      clientId: "tap-ready",
      conversationId: null,
      ownerClientId: null,
      routingAddress: "tap-ready",
      aliases: ["tap-ready"],
    })}`,
    `to_address: ${JSON.stringify({
      hostId: options.candidate.hostId,
      clientId: options.candidate.ownerClientId,
      conversationId: options.candidate.conversationId,
      ownerClientId: options.candidate.ownerClientId,
      routingAddress: options.agent,
      aliases: [options.agent],
    })}`,
    "scope: drive",
    "action: windows-route-smoke",
    `subject: ${yamlScalar(options.subject)}`,
    `sent_at: ${sentAt}`,
    "---",
    "",
  ].join("\n");
  fs.mkdirSync(inboxDir, { recursive: true });
  fs.writeFileSync(filePath, `${frontmatter}${options.content.trim()}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
  return {
    evidencePath: `inbox/${filename}`,
    filePath,
    messageId,
    sentAt,
  };
}

function extractWindowsRouteSmokeTurnId(
  result: CodexIpcDriveActionResult,
): string | null {
  const responseRecord =
    result.response.result &&
    typeof result.response.result === "object" &&
    !Array.isArray(result.response.result)
      ? (result.response.result as Record<string, unknown>)
      : null;
  const directTurn =
    responseRecord?.turn &&
    typeof responseRecord.turn === "object" &&
    !Array.isArray(responseRecord.turn)
      ? (responseRecord.turn as { id?: unknown }).id
      : null;
  if (typeof directTurn === "string" && directTurn.trim()) {
    return directTurn.trim();
  }
  const nested =
    responseRecord?.result &&
    typeof responseRecord.result === "object" &&
    !Array.isArray(responseRecord.result)
      ? (responseRecord.result as Record<string, unknown>)
      : null;
  const nestedTurn =
    nested?.turn &&
    typeof nested.turn === "object" &&
    !Array.isArray(nested.turn)
      ? (nested.turn as { id?: unknown }).id
      : null;
  return typeof nestedTurn === "string" && nestedTurn.trim()
    ? nestedTurn.trim()
    : null;
}

export async function runWindowsRouteSmokeApply(options: {
  commsDir: string;
  agent: string;
  subject: string;
  content: string;
  routeHealth: WindowsAppRouteHealth;
}): Promise<WindowsRouteAppliedAction> {
  if (options.routeHealth.status !== "fresh-route-ready") {
    return {
      name: "windows-route-smoke",
      status: "skipped",
      message: `Windows route smoke requires fresh-route-ready; observed ${options.routeHealth.status}`,
    };
  }
  const candidate = findWindowsRouteRefreshCandidate(options.routeHealth);
  if (!candidate?.conversationId || !candidate.ownerClientId) {
    return {
      name: "windows-route-smoke",
      status: "skipped",
      message:
        "Windows route smoke requires a selected live conversationId + ownerClientId tuple",
    };
  }

  let evidence: ReturnType<typeof writeWindowsRouteSmokeInboxEvidence> | null =
    null;
  try {
    evidence = writeWindowsRouteSmokeInboxEvidence({
      commsDir: options.commsDir,
      agent: options.agent,
      subject: options.subject,
      content: options.content,
      candidate,
    });
  } catch (error) {
    return {
      name: "windows-route-smoke",
      status: "failed",
      message: `failed to write Windows route smoke inbox evidence: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }

  const transport =
    windowsAppRouteSmokeTransportFactoryForTests?.({
      commsDir: options.commsDir,
      hostId: candidate.hostId,
    }) ??
    createExperimentalCodexIpcControlTransport({
      commsDir: options.commsDir,
      hostId: candidate.hostId,
    });

  try {
    await transport.connect();
    const created = transport.createConsentReceipt({
      conversationId: candidate.conversationId,
      hostId: candidate.hostId,
      ownerClientId: candidate.ownerClientId,
      allowedMethods: ["thread-follower-start-turn"],
    });
    const result = await transport.startTurn({
      conversationId: candidate.conversationId,
      text: options.content,
      consentRef: created.receipt.id,
      hostId: candidate.hostId,
      ownerClientId: candidate.ownerClientId,
      action: "windows-route-smoke",
    });
    return {
      name: "windows-route-smoke",
      status: "applied",
      path: evidence.filePath,
      evidencePath: evidence.evidencePath,
      turnId: extractWindowsRouteSmokeTurnId(result),
      consentRef: created.receipt.id,
      message: `wrote durable inbox evidence and delivered Windows App live smoke to ${candidate.conversationId}`,
    };
  } catch (error) {
    return {
      name: "windows-route-smoke",
      status: "failed",
      path: evidence.filePath,
      evidencePath: evidence.evidencePath,
      message: `wrote durable inbox evidence but Windows App live smoke failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  } finally {
    await transport.disconnect().catch(() => undefined);
  }
}

export function applyWindowsRoutePresenceRefresh(options: {
  agent: string;
  presencePath: string;
  existing: PresenceRecord | null;
  routeHealth: WindowsAppRouteHealth;
}): WindowsRouteAppliedAction {
  if (
    options.routeHealth.status !== "stale-presence" &&
    options.routeHealth.status !== "fresh-route-ready"
  ) {
    return {
      name: "windows-route-health",
      status: "skipped",
      message: `route-health apply requires stale-presence or fresh-route-ready; observed ${options.routeHealth.status}`,
    };
  }

  const candidate = findWindowsRouteRefreshCandidate(options.routeHealth);
  if (!candidate?.conversationId || !candidate.ownerClientId) {
    return {
      name: "windows-route-health",
      status: "skipped",
      message:
        "route-health apply requires a selected live conversationId + ownerClientId tuple",
    };
  }

  try {
    const record = buildWindowsRoutePresenceRecord({
      agent: options.agent,
      existing: options.existing,
      candidate,
      now: new Date().toISOString(),
    });
    writeJsonAtomic(options.presencePath, record);
    return {
      name: "windows-route-health",
      status: "applied",
      path: options.presencePath,
      message: `refreshed Windows App durable presence for ${options.agent}: conversationId=${candidate.conversationId}, ownerClientId=${candidate.ownerClientId}`,
    };
  } catch (error) {
    return {
      name: "windows-route-health",
      status: "failed",
      path: options.presencePath,
      message: `failed to refresh Windows App durable presence: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}
