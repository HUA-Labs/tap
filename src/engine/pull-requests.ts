/**
 * Pull request board engine.
 * Uses `gh pr list` to fetch open and recently merged PRs.
 */

import { spawnSync } from "node:child_process";

// ─── Types ─────────────────────────────────────────────────────

export interface PullRequest {
  number: number;
  title: string;
  state: "open" | "merged" | "closed";
  author: string;
  branch: string;
  url: string;
  mergedAt: string | null;
}

export interface PrBoard {
  open: PullRequest[];
  merged: PullRequest[];
}

// ─── gh helpers ─────────────────────────────────────────────────

interface GhPrEntry {
  number: number;
  title: string;
  state: string;
  author: { login: string };
  headRefName: string;
  url: string;
  mergedAt: string | null;
}

function runGhPrList(
  repoRoot: string,
  extraArgs: string[],
): GhPrEntry[] | null {
  try {
    const result = spawnSync(
      "gh",
      [
        "pr",
        "list",
        "--json",
        "number,title,state,author,headRefName,url,mergedAt",
        ...extraArgs,
      ],
      { cwd: repoRoot, encoding: "utf-8", timeout: 10_000 },
    );

    if (result.error || result.status !== 0) return null;

    const raw = result.stdout.trim();
    if (!raw) return null;

    return JSON.parse(raw) as GhPrEntry[];
  } catch {
    return null;
  }
}

function mapEntry(entry: GhPrEntry): PullRequest {
  const state = entry.state?.toLowerCase();
  return {
    number: entry.number,
    title: entry.title ?? "",
    state:
      state === "merged" ? "merged" : state === "closed" ? "closed" : "open",
    author: entry.author?.login ?? "",
    branch: entry.headRefName ?? "",
    url: entry.url ?? "",
    mergedAt: entry.mergedAt ?? null,
  };
}

// ─── Public API ─────────────────────────────────────────────────

/**
 * Fetch open PRs from the repository.
 * Returns an empty array if `gh` is unavailable or the command fails.
 */
export function fetchOpenPrs(repoRoot: string): PullRequest[] {
  const entries = runGhPrList(repoRoot, ["--limit", "50"]);
  if (!entries) return [];
  return entries.map(mapEntry);
}

/**
 * Fetch recently merged PRs from the repository.
 * Returns an empty array if `gh` is unavailable or the command fails.
 */
export function fetchMergedPrs(
  repoRoot: string,
  limit: number = 20,
): PullRequest[] {
  const entries = runGhPrList(repoRoot, [
    "--state",
    "merged",
    "--limit",
    String(limit),
  ]);
  if (!entries) return [];
  return entries
    .map(mapEntry)
    .sort((a, b) => {
      if (!a.mergedAt || !b.mergedAt) return 0;
      return new Date(b.mergedAt).getTime() - new Date(a.mergedAt).getTime();
    });
}

/**
 * Fetch both open and recently merged PRs.
 * Returns empty arrays if `gh` is unavailable.
 */
export function fetchPrs(repoRoot: string): PrBoard {
  return {
    open: fetchOpenPrs(repoRoot),
    merged: fetchMergedPrs(repoRoot),
  };
}
