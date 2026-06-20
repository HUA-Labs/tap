import * as fs from "node:fs";
import * as path from "node:path";

export interface PresenceLookupResult<T extends Record<string, unknown>> {
  path: string;
  requestedPath: string;
  record: T | null;
  matchedBy:
    | "direct-file"
    | "normalized-file"
    | "record-agent"
    | "record-address"
    | "record-alias"
    | "missing";
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function stringArray(value: unknown): string[] {
  if (typeof value === "string") return value.trim() ? [value.trim()] : [];
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeAddress(value: string): string {
  return value.trim().replace(/_/g, "-").toLowerCase();
}

function sameAddress(left: string, right: string): boolean {
  return normalizeAddress(left) === normalizeAddress(right);
}

function readJson<T extends Record<string, unknown>>(
  filePath: string,
): T | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return objectValue(parsed) as T | null;
  } catch {
    return null;
  }
}

function presenceNames(record: Record<string, unknown>): string[] {
  const address = objectValue(record.address);
  const capabilities = objectValue(record.capabilities);
  return [
    stringValue(record.agent),
    stringValue(record.agentId),
    stringValue(record.id),
    stringValue(record.name),
    stringValue(record.routingAddress),
    stringValue(address?.routingAddress),
    stringValue(address?.clientId),
    ...stringArray(address?.aliases),
    stringValue(capabilities?.routingAddress),
    ...stringArray(capabilities?.aliases),
  ].filter((item): item is string => Boolean(item));
}

function classifyRecordMatch(
  agent: string,
  record: Record<string, unknown>,
): PresenceLookupResult<Record<string, unknown>>["matchedBy"] | null {
  const address = objectValue(record.address);
  const directNames = [
    stringValue(record.agent),
    stringValue(record.agentId),
    stringValue(record.id),
    stringValue(record.name),
  ].filter((item): item is string => Boolean(item));
  if (directNames.some((name) => sameAddress(name, agent))) {
    return "record-agent";
  }

  const addressNames = [
    stringValue(record.routingAddress),
    stringValue(address?.routingAddress),
    stringValue(address?.clientId),
  ].filter((item): item is string => Boolean(item));
  if (addressNames.some((name) => sameAddress(name, agent))) {
    return "record-address";
  }

  return presenceNames(record).some((name) => sameAddress(name, agent))
    ? "record-alias"
    : null;
}

export function resolvePresenceRecord<T extends Record<string, unknown>>(
  commsDir: string,
  agent: string,
): PresenceLookupResult<T> {
  const presenceDir = path.join(commsDir, "presence");
  const requestedPath = path.join(presenceDir, `${agent}.json`);
  const direct = readJson<T>(requestedPath);
  if (direct) {
    return {
      path: requestedPath,
      requestedPath,
      record: direct,
      matchedBy: "direct-file",
    };
  }

  const normalizedPath = path.join(
    presenceDir,
    `${agent.replace(/-/g, "_")}.json`,
  );
  if (normalizedPath !== requestedPath) {
    const normalized = readJson<T>(normalizedPath);
    if (normalized) {
      return {
        path: normalizedPath,
        requestedPath,
        record: normalized,
        matchedBy: "normalized-file",
      };
    }
  }

  try {
    const files = fs.existsSync(presenceDir)
      ? fs.readdirSync(presenceDir).filter((file) => file.endsWith(".json"))
      : [];
    for (const file of files.sort()) {
      const filePath = path.join(presenceDir, file);
      const record = readJson<T>(filePath);
      if (!record) continue;
      const recordMatch = classifyRecordMatch(agent, record);
      if (recordMatch) {
        return {
          path: filePath,
          requestedPath,
          record,
          matchedBy: recordMatch,
        };
      }
    }
  } catch {
    // Fall through to the normal missing shape; presence diagnostics must not
    // fail because one optional presence file is unreadable.
  }

  return {
    path: requestedPath,
    requestedPath,
    record: null,
    matchedBy: "missing",
  };
}
