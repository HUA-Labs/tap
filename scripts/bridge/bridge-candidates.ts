// bridge-candidates.ts — Message collection and filtering

import { createHash } from "crypto";
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  unlinkSync,
} from "fs";
import { join } from "path";
import {
  type Candidate,
  HEADLESS_SKIP_PATTERNS,
  type HeartbeatStore,
  type Options,
} from "./bridge-types.ts";
import { createBridgeLogger } from "./bridge-logging.ts";
import { writeProcessedMarker } from "./bridge-format.ts";
import {
  getInboxRoute,
  isOwnMessageSender,
  recipientMatchesAgent,
  refreshAgentIdentity,
  stripBridgeFrontmatter,
} from "./bridge-routing.ts";

const routingLogger = createBridgeLogger("routing");

type RejectedCandidate = Pick<
  Candidate,
  | "markerId"
  | "filePath"
  | "fileName"
  | "sender"
  | "recipient"
  | "subject"
  | "mtimeMs"
> & {
  rejectionReason: string;
};

function scanCandidates(
  inboxDir: string,
  agentId: string,
  agentName: string,
  aliasName?: string,
): {
  candidates: Candidate[];
  rejected: RejectedCandidate[];
} {
  const entries = readdirSync(inboxDir, { withFileTypes: true })
    .filter(
      (entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".md"),
    )
    .map((entry) => {
      const filePath = join(inboxDir, entry.name);
      const stats = statSync(filePath);
      return { entry, filePath, stats };
    })
    .sort((left, right) => left.stats.mtimeMs - right.stats.mtimeMs);

  const candidates: Candidate[] = [];
  const rejected: RejectedCandidate[] = [];
  let filteredByRecipient = 0;
  let filteredBySelf = 0;
  let filteredByHeadless = 0;
  for (const item of entries) {
    let body: string;
    try {
      body = readFileSync(item.filePath, "utf8");
    } catch {
      continue;
    }

    // Frontmatter-first routing (M202): try frontmatter, fall back to filename
    const route = getInboxRoute(item.entry.name, body);
    // M205: Match against configured name AND heartbeat-refreshed alias
    if (
      !recipientMatchesAgent(route.recipient, agentId, agentName) &&
      !(aliasName && recipientMatchesAgent(route.recipient, agentId, aliasName))
    ) {
      filteredByRecipient += 1;
      continue;
    }

    if (
      isOwnMessageSender(route.sender, agentId, agentName) ||
      (aliasName && isOwnMessageSender(route.sender, agentId, aliasName))
    ) {
      filteredBySelf += 1;
      continue;
    }

    // In headless mode, skip review-request files — handled by headless loop
    if (shouldSkipInHeadlessMode(item.entry.name, body)) {
      filteredByHeadless += 1;
      continue;
    }

    const markerId = buildMarkerId(item.filePath, item.stats.mtimeMs);
    if (route.validationError) {
      rejected.push({
        markerId,
        filePath: item.filePath,
        fileName: item.entry.name,
        sender: route.sender,
        recipient: route.recipient,
        subject: route.subject,
        mtimeMs: item.stats.mtimeMs,
        rejectionReason: route.validationError,
      });
      continue;
    }

    candidates.push({
      markerId,
      filePath: item.filePath,
      fileName: item.entry.name,
      sender: route.sender,
      recipient: route.recipient,
      subject: route.subject,
      body: stripBridgeFrontmatter(body),
      mtimeMs: item.stats.mtimeMs,
      messageId: route.messageId ?? null,
      fromAddress: route.fromAddress ?? null,
      toAddress: route.toAddress ?? null,
      scope: route.scope ?? null,
      action: route.action ?? null,
      consentRef: route.consentRef ?? null,
    });
  }

  routingLogger.debug("candidate scan completed", {
    inboxDir,
    scanned: entries.length,
    matched: candidates.length,
    rejected: rejected.length,
    filteredByRecipient,
    filteredBySelf,
    filteredByHeadless,
    agentId,
    agentName,
    aliasName,
  });

  return { candidates, rejected };
}

export function buildMarkerId(filePath: string, mtimeMs: number): string {
  return createHash("sha1").update(`${filePath}|${mtimeMs}`).digest("hex");
}

export function getProcessedMarkerPath(
  stateDir: string,
  markerId: string,
): string {
  return join(stateDir, "processed", `${markerId}.done`);
}

/**
 * M362 retention window for processed markers whose source inbox file is
 * still present. A marker older than this is considered stale even if the
 * source artefact lingers (archive scripts dropped the cleanup, etc.).
 * Default: 14 days — a comfortable buffer above the standard 3-day inbox
 * archive cycle so legitimate long-lived messages are not retired early.
 */
const PROCESSED_MARKER_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * M362 race-prevention grace period. Markers written in the last few seconds
 * are never swept: the source file may be in a concurrent archive move, and
 * the marker may be referenced by an in-flight dispatch that has not yet
 * written its `last-dispatch.json` companion.
 */
const PROCESSED_MARKER_GRACE_MS = 10_000;

export interface SweepOrphanProcessedMarkersResult {
  scanned: number;
  removed: number;
  kept: number;
  errors: number;
  removedMarkerIds: string[];
}

type SweepLogger = (message: string, context?: Record<string, unknown>) => void;

/**
 * M362 (M346 cache-contract drift #5): scan processed markers and retire
 * those whose source inbox artefact no longer exists, plus those that have
 * aged past the retention window.
 *
 * The sweep is idempotent and failure-tolerant — unreadable payloads and
 * unlink failures are counted into `errors` and skipped, never thrown. The
 * intent is to run once at bridge startup; callers may also invoke it
 * periodically without guard.
 */
export function sweepOrphanProcessedMarkers(
  stateDir: string,
  options?: {
    nowMs?: number;
    maxAgeMs?: number;
    graceMs?: number;
    logger?: SweepLogger;
  },
): SweepOrphanProcessedMarkersResult {
  const result: SweepOrphanProcessedMarkersResult = {
    scanned: 0,
    removed: 0,
    kept: 0,
    errors: 0,
    removedMarkerIds: [],
  };

  const dir = join(stateDir, "processed");
  if (!existsSync(dir)) {
    return result;
  }

  const now = options?.nowMs ?? Date.now();
  const maxAge = options?.maxAgeMs ?? PROCESSED_MARKER_MAX_AGE_MS;
  const grace = options?.graceMs ?? PROCESSED_MARKER_GRACE_MS;
  const log: SweepLogger = options?.logger ?? (() => undefined);

  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return result;
  }

  for (const file of entries) {
    if (!file.endsWith(".done")) {
      continue;
    }
    result.scanned += 1;
    const markerPath = join(dir, file);

    let markerMtimeMs = 0;
    let sourcePath: string | null = null;
    try {
      markerMtimeMs = statSync(markerPath).mtimeMs;
      const payload = JSON.parse(readFileSync(markerPath, "utf8")) as {
        requestFile?: unknown;
      };
      sourcePath =
        typeof payload.requestFile === "string" && payload.requestFile.trim()
          ? payload.requestFile
          : null;
    } catch {
      result.errors += 1;
      continue;
    }

    const ageMs = now - markerMtimeMs;
    if (ageMs < grace) {
      result.kept += 1;
      continue;
    }

    const sourceExists = sourcePath ? existsSync(sourcePath) : false;
    const agedOut = ageMs > maxAge;
    if (sourceExists && !agedOut) {
      result.kept += 1;
      continue;
    }

    try {
      unlinkSync(markerPath);
      result.removed += 1;
      const markerId = file.slice(0, -".done".length);
      result.removedMarkerIds.push(markerId);
      log("processed marker retired", {
        markerId,
        reason: !sourceExists ? "source_missing" : "aged_out",
        sourcePath,
        ageMs,
      });
    } catch {
      result.errors += 1;
    }
  }

  return result;
}

export function loadHeartbeats(commsDir: string): HeartbeatStore {
  try {
    return JSON.parse(readFileSync(join(commsDir, "heartbeats.json"), "utf8"));
  } catch {
    return {};
  }
}

export function shouldSkipInHeadlessMode(
  fileName: string,
  body: string,
): boolean {
  if (process.env.TAP_HEADLESS !== "true") return false;
  const combined = `${fileName}\n${body}`;
  return HEADLESS_SKIP_PATTERNS.some((p) => p.test(combined));
}

export function collectCandidates(
  inboxDir: string,
  agentId: string,
  agentName: string,
  aliasName?: string,
): Candidate[] {
  return scanCandidates(inboxDir, agentId, agentName, aliasName).candidates;
}

export function getPendingCandidates(
  options: Options,
  cutoff: Date,
): {
  heartbeats: HeartbeatStore;
  candidates: Candidate[];
} {
  const inboxDir = join(options.commsDir, "inbox");
  if (!existsSync(inboxDir)) {
    throw new Error(`Inbox directory not found: ${inboxDir}`);
  }

  const heartbeats = loadHeartbeats(options.commsDir);
  const refreshedName = refreshAgentIdentity(options, heartbeats);
  const cutoffMs = cutoff.getTime();
  // Collect candidates matching the configured name
  const scan = scanCandidates(
    inboxDir,
    options.agentId,
    options.agentName,
    // M205: Also accept messages addressed to the heartbeat-refreshed name
    refreshedName !== options.agentName ? refreshedName : undefined,
  );

  for (const rejection of scan.rejected) {
    if (rejection.mtimeMs < cutoffMs) {
      continue;
    }

    const markerPath = getProcessedMarkerPath(
      options.stateDir,
      rejection.markerId,
    );
    if (existsSync(markerPath)) {
      continue;
    }

    writeProcessedMarker(
      options.stateDir,
      {
        ...rejection,
        body: "",
      },
      "rejected",
      null,
      null,
      rejection.rejectionReason,
    );
    routingLogger.warn("envelope rejected during candidate scan", {
      fileName: rejection.fileName,
      sender: rejection.sender || "unknown",
      recipient: rejection.recipient || options.agentName,
      subject: rejection.subject || "(none)",
      reason: rejection.rejectionReason,
    });
  }

  const candidates = scan.candidates.filter((candidate) => {
    if (candidate.mtimeMs < cutoffMs) {
      return false;
    }

    return !existsSync(
      getProcessedMarkerPath(options.stateDir, candidate.markerId),
    );
  });

  routingLogger.debug("pending candidates resolved", {
    agentId: options.agentId,
    configuredName: options.agentName,
    refreshedName:
      refreshedName !== options.agentName ? refreshedName : undefined,
    candidateCount: candidates.length,
    rejectedCount: scan.rejected.length,
    cutoff: cutoff.toISOString(),
  });

  return { heartbeats, candidates };
}
