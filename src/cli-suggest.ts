/**
 * Command suggestion utilities for the tap CLI.
 * Extracted for testability.
 */

export const COMMANDS = [
  "init",
  "init-worktree",
  "add",
  "remove",
  "status",
  "bridge",
  "up",
  "down",
  "comms",
  "dashboard",
  "doctor",
  "serve",
  "version",
] as const;

export function suggestCommand(input: string): string | null {
  let best: string | null = null;
  let bestDist = Infinity;
  for (const cmd of COMMANDS) {
    const d = levenshtein(input.toLowerCase(), cmd);
    if (d < bestDist && d <= Math.max(2, Math.floor(cmd.length / 2))) {
      bestDist = d;
      best = cmd;
    }
  }
  return best;
}

export function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    Array.from<number>({ length: n + 1 }).fill(0),
  );
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}
