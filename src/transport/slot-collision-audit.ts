import * as fs from "node:fs";
import * as path from "node:path";

export interface SlotCollisionHolder {
  agentId: string;
  displayName: string | null;
  instanceId: string | null;
  lastActivity: string;
  source: string;
  presence: string;
  hostId?: string | null;
}

export interface WriteSlotCollisionAuditOptions {
  commsDir?: string | null;
  slot: string;
  recordedAt?: string | null;
  winner: SlotCollisionHolder;
  loser: SlotCollisionHolder;
}

interface SlotCollisionRecord {
  slot: string;
  recordedAt: string;
  winner: SlotCollisionHolder;
  loser: SlotCollisionHolder;
}

function normalizeString(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function isAuditEnabled(): boolean {
  const normalized = process.env.TAP_SLOT_COLLISION_AUDIT?.trim().toLowerCase();
  if (!normalized) return true;
  return !["0", "false", "no", "off"].includes(normalized);
}

function resolveAuditDir(commsDir?: string | null): string | null {
  const resolved =
    normalizeString(commsDir) ?? normalizeString(process.env.TAP_COMMS_DIR);
  if (!resolved) return null;
  return path.join(path.resolve(resolved), "audit", "slot-collisions");
}

function shortId(value: string | null | undefined): string {
  const s = (value ?? "").replace(/[^a-zA-Z0-9가-힣]/g, "");
  return s.slice(0, 12) || "unknown";
}

function dayStamp(iso: string): string {
  return iso.slice(0, 10).replace(/-/g, "");
}

/**
 * Filename is deterministic per (day, slot, loser_instance, winner_instance)
 * so repeated observations of the same collision within a UTC day overwrite
 * rather than spam. A fresh day or a different contender pair produces a new
 * file.
 */
function buildAuditFilePath(
  dir: string,
  record: SlotCollisionRecord,
): string {
  const day = dayStamp(record.recordedAt);
  const slot = record.slot.replace(/[^a-zA-Z0-9-]/g, "");
  const loser = shortId(record.loser.instanceId ?? record.loser.agentId);
  const winner = shortId(record.winner.instanceId ?? record.winner.agentId);
  return path.join(dir, `${day}-${slot}-loser-${loser}-winner-${winner}.md`);
}

function buildFrontmatter(record: SlotCollisionRecord): string {
  const fields: Array<[string, unknown]> = [
    ["type", "slot-collision-audit"],
    ["slot", record.slot],
    ["recorded_at", record.recordedAt],
    ["winner", record.winner],
    ["loser", record.loser],
  ];
  const lines = fields.map(
    ([key, value]) => `${key}: ${JSON.stringify(value ?? null)}`,
  );
  return `---\n${lines.join("\n")}\n---\n\n`;
}

function buildBody(record: SlotCollisionRecord): string {
  return [
    "# Slot Collision Audit",
    "",
    `Two heartbeats claimed slot \`${record.slot}\`; newer-wins disambiguation`,
    `demoted the older holder from slot-form routing.`,
    "",
    "## Winner (active)",
    "",
    "```json",
    JSON.stringify(record.winner, null, 2),
    "```",
    "",
    "## Loser (stale-by-newer)",
    "",
    "```json",
    JSON.stringify(record.loser, null, 2),
    "```",
    "",
  ].join("\n");
}

export function writeSlotCollisionAudit(
  options: WriteSlotCollisionAuditOptions,
): string | null {
  if (!isAuditEnabled()) return null;

  const slot = normalizeString(options.slot);
  if (!slot) return null;

  const auditDir = resolveAuditDir(options.commsDir);
  if (!auditDir) return null;

  const record: SlotCollisionRecord = {
    slot,
    recordedAt:
      normalizeString(options.recordedAt) ?? new Date().toISOString(),
    winner: options.winner,
    loser: options.loser,
  };

  try {
    fs.mkdirSync(auditDir, { recursive: true });
    const filePath = buildAuditFilePath(auditDir, record);
    fs.writeFileSync(
      filePath,
      buildFrontmatter(record) + buildBody(record),
      "utf-8",
    );
    return filePath;
  } catch {
    return null;
  }
}
