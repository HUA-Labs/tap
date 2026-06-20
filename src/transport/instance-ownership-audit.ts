import * as fs from "node:fs";
import * as path from "node:path";

export interface InstanceOwnershipParty {
  agentId: string;
  displayName: string | null;
  instanceId: string;
  hostId?: string | null;
  lastActivity?: string | null;
  source?: string;
}

export interface WriteInstanceOwnershipChangeAuditOptions {
  commsDir?: string | null;
  instanceId: string;
  recordedAt?: string | null;
  previous: InstanceOwnershipParty;
  next: InstanceOwnershipParty;
  prunedKeys: string[];
  prunedPresenceFiles: string[];
}

interface OwnershipChangeRecord {
  instanceId: string;
  recordedAt: string;
  previous: InstanceOwnershipParty;
  next: InstanceOwnershipParty;
  prunedKeys: string[];
  prunedPresenceFiles: string[];
}

function normalizeString(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function isAuditEnabled(): boolean {
  const normalized =
    process.env.TAP_INSTANCE_OWNERSHIP_AUDIT?.trim().toLowerCase();
  if (!normalized) return true;
  return !["0", "false", "no", "off"].includes(normalized);
}

function resolveAuditDir(commsDir?: string | null): string | null {
  const resolved =
    normalizeString(commsDir) ?? normalizeString(process.env.TAP_COMMS_DIR);
  if (!resolved) return null;
  return path.join(path.resolve(resolved), "audit", "instance-ownership-changes");
}

function shortId(value: string | null | undefined): string {
  const s = (value ?? "").replace(/[^a-zA-Z0-9가-힣]/g, "");
  return s.slice(0, 12) || "unknown";
}

function dayStamp(iso: string): string {
  return iso.slice(0, 10).replace(/-/g, "");
}

function buildAuditFilePath(
  dir: string,
  record: OwnershipChangeRecord,
): string {
  const day = dayStamp(record.recordedAt);
  const instance = shortId(record.instanceId);
  const prev = shortId(record.previous.agentId);
  const next = shortId(record.next.agentId);
  return path.join(
    dir,
    `${day}-${instance}-prev-${prev}-next-${next}.md`,
  );
}

function buildFrontmatter(record: OwnershipChangeRecord): string {
  const fields: Array<[string, unknown]> = [
    ["type", "instance-ownership-change-audit"],
    ["instance_id", record.instanceId],
    ["recorded_at", record.recordedAt],
    ["previous", record.previous],
    ["next", record.next],
    ["pruned_keys", record.prunedKeys],
    ["pruned_presence_files", record.prunedPresenceFiles],
  ];
  const lines = fields.map(
    ([key, value]) => `${key}: ${JSON.stringify(value ?? null)}`,
  );
  return `---\n${lines.join("\n")}\n---\n\n`;
}

function buildBody(record: OwnershipChangeRecord): string {
  return [
    "# Instance Ownership Change Audit",
    "",
    `Instance \`${record.instanceId}\` was claimed by a new agent via \`tap_set_name\`.`,
    `Prior-owner aliases and presence records were pruned so Layer 2 routing stays clean.`,
    `Pruning only touches entries on the **same host** as the current session — cross-device presence is preserved.`,
    "",
    "## Previous owner",
    "",
    "```json",
    JSON.stringify(record.previous, null, 2),
    "```",
    "",
    "## New owner",
    "",
    "```json",
    JSON.stringify(record.next, null, 2),
    "```",
    "",
    "## Pruned",
    "",
    `- Heartbeat store keys: ${record.prunedKeys.length > 0 ? record.prunedKeys.map((k) => `\`${k}\``).join(", ") : "_(none)_"}`,
    `- Presence files: ${record.prunedPresenceFiles.length > 0 ? record.prunedPresenceFiles.map((k) => `\`${k}\``).join(", ") : "_(none)_"}`,
    "",
  ].join("\n");
}

export function writeInstanceOwnershipChangeAudit(
  options: WriteInstanceOwnershipChangeAuditOptions,
): string | null {
  if (!isAuditEnabled()) return null;

  const instanceId = normalizeString(options.instanceId);
  if (!instanceId) return null;

  const auditDir = resolveAuditDir(options.commsDir);
  if (!auditDir) return null;

  const record: OwnershipChangeRecord = {
    instanceId,
    recordedAt:
      normalizeString(options.recordedAt) ?? new Date().toISOString(),
    previous: options.previous,
    next: options.next,
    prunedKeys: options.prunedKeys,
    prunedPresenceFiles: options.prunedPresenceFiles,
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
