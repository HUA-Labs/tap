// bridge-candidates.ts — Message collection and filtering

import { createHash } from "crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import {
  Candidate,
  HEADLESS_SKIP_PATTERNS,
  HeartbeatStore,
  Options,
} from "./bridge-types.js";
import { createBridgeLogger } from "./bridge-logging.js";
import {
  getInboxRoute,
  isOwnMessageSender,
  recipientMatchesAgent,
  refreshAgentIdentity,
  stripBridgeFrontmatter,
} from "./bridge-routing.js";

const routingLogger = createBridgeLogger("routing");

export function buildMarkerId(filePath: string, mtimeMs: number): string {
  return createHash("sha1").update(`${filePath}|${mtimeMs}`).digest("hex");
}

export function getProcessedMarkerPath(
  stateDir: string,
  markerId: string,
): string {
  return join(stateDir, "processed", `${markerId}.done`);
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

    candidates.push({
      markerId: buildMarkerId(item.filePath, item.stats.mtimeMs),
      filePath: item.filePath,
      fileName: item.entry.name,
      sender: route.sender,
      recipient: route.recipient,
      subject: route.subject,
      body: stripBridgeFrontmatter(body),
      mtimeMs: item.stats.mtimeMs,
    });
  }

  routingLogger.debug("candidate scan completed", {
    inboxDir,
    scanned: entries.length,
    matched: candidates.length,
    filteredByRecipient,
    filteredBySelf,
    filteredByHeadless,
    agentId,
    agentName,
    aliasName,
  });

  return candidates;
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
  const candidates = collectCandidates(
    inboxDir,
    options.agentId,
    options.agentName,
    // M205: Also accept messages addressed to the heartbeat-refreshed name
    refreshedName !== options.agentName ? refreshedName : undefined,
  ).filter((candidate) => {
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
    cutoff: cutoff.toISOString(),
  });

  return { heartbeats, candidates };
}
