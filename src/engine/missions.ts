/**
 * Mission kanban engine.
 * Parses docs/missions/MISSIONS.md into structured Mission objects.
 */

import * as fs from "node:fs";
import * as path from "node:path";

// ─── Types ─────────────────────────────────────────────────────

export interface Mission {
  id: string;
  title: string;
  branch: string | null;
  status: "active" | "planned" | "completed";
  owner: string | null;
}

// ─── Status mapping ─────────────────────────────────────────────

function parseStatus(raw: string): Mission["status"] {
  const trimmed = raw.trim();
  if (trimmed.includes("active")) return "active";
  if (trimmed.includes("completed")) return "completed";
  return "planned";
}

// ─── Row parser ─────────────────────────────────────────────────

/**
 * Parse a single markdown table row into a Mission, or return null if the
 * row is not a valid mission row (header, separator, empty, etc.).
 */
function parseRow(line: string): Mission | null {
  // Must start and end with a pipe
  if (!line.startsWith("|") || !line.endsWith("|")) return null;

  // Split by pipe, discard first/last empty segments
  const cells = line
    .split("|")
    .slice(1, -1)
    .map((c) => c.trim());

  if (cells.length < 4) return null;

  const [idCell, missionCell, branchCell, statusCell, ownerCell] = cells;

  // Skip separator rows (contain only dashes/spaces)
  if (/^[-: ]+$/.test(idCell ?? "")) return null;

  // Skip rows with no real ID (e.g. "—" or empty)
  const id = (idCell ?? "").replace(/[^\w]/g, "");
  if (!id || !/^M\d+$/i.test(id)) return null;

  // Extract title from markdown link [Title](./file.md) or plain text
  const titleMatch = missionCell?.match(/\[([^\]]+)\]/);
  const title = titleMatch ? titleMatch[1] : (missionCell ?? "").trim();
  if (!title) return null;

  // Extract branch from backtick-wrapped value or "—"
  const branchMatch = branchCell?.match(/`([^`]+)`/);
  const branch = branchMatch ? branchMatch[1] : null;

  const status = parseStatus(statusCell ?? "");

  // Owner — strip leading/trailing whitespace, treat "—" or "미배정" as null
  const rawOwner = (ownerCell ?? "").trim();
  const owner =
    rawOwner === "" || rawOwner === "—" || rawOwner === "미배정"
      ? null
      : rawOwner;

  return { id: id.toUpperCase(), title, branch, status, owner };
}

// ─── Public API ─────────────────────────────────────────────────

/**
 * Read and parse docs/missions/MISSIONS.md from the given repo root.
 * Returns an empty array if the file does not exist.
 */
export function parseMissionsFile(repoRoot: string): Mission[] {
  const missionsPath = path.join(repoRoot, "docs", "missions", "MISSIONS.md");

  let content: string;
  try {
    content = fs.readFileSync(missionsPath, "utf-8");
  } catch {
    return [];
  }

  const missions: Mission[] = [];

  for (const line of content.split("\n")) {
    const mission = parseRow(line);
    if (!mission) continue;
    missions.push(mission);
  }

  return missions;
}
