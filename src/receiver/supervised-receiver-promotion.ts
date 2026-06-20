import {
  runCodexCliAppServerPromotion,
  type CodexAppServerPromoter,
  type CodexCliAppServerPromotionResult,
  type RunCodexCliAppServerPromotionOptions,
} from "./codex-cli-app-server-promotion.js";

export type SupervisedReceiverPromotionMode = "once" | "watch";

export interface RunSupervisedReceiverPromotionOptions extends Omit<
  RunCodexCliAppServerPromotionOptions,
  "limit"
> {
  mode: SupervisedReceiverPromotionMode;
  maxPromotionsPerIteration?: number;
  intervalMs?: number;
  maxIterations?: number;
  promoter?: CodexAppServerPromoter;
}

export interface SupervisedReceiverPromotionResult {
  mode: SupervisedReceiverPromotionMode;
  agent: string;
  aliases: string[];
  commsDir: string;
  statePath: string | null;
  receiveTransport: "polling";
  adapter: "supervised-app-server-promotion";
  runtimeSurface: "codex-cli-app-server";
  status: "idle" | "delivered" | "blocked" | "dry-run";
  delivered: number;
  blocked: number;
  queued: number;
  dryRun: boolean;
  iterations: number;
  attempts: CodexCliAppServerPromotionResult[];
  lastBlockedReason: string | null;
  lastQueueReason: string | null;
  warnings: string[];
}

const DEFAULT_INTERVAL_MS = 2_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function summarizeStatus(
  attempts: CodexCliAppServerPromotionResult[],
): SupervisedReceiverPromotionResult["status"] {
  const last = attempts.at(-1);
  if (last?.status === "delivered") {
    return "delivered";
  }
  if (last?.status === "dry-run") {
    return "dry-run";
  }
  if (attempts.some((attempt) => attempt.status === "blocked")) {
    return "blocked";
  }
  return "idle";
}

function isRetryableActiveTurn(
  attempt: CodexCliAppServerPromotionResult,
): boolean {
  return (
    attempt.status === "blocked" && attempt.runtimeHealth === "active-turn"
  );
}

export async function runSupervisedReceiverPromotion(
  options: RunSupervisedReceiverPromotionOptions,
): Promise<SupervisedReceiverPromotionResult> {
  const maxPromotions = Math.max(
    1,
    Math.min(20, options.maxPromotionsPerIteration ?? 1),
  );
  const maxIterations =
    options.mode === "watch" && options.maxIterations !== undefined
      ? Math.max(1, options.maxIterations)
      : options.mode === "watch"
        ? 0
        : 1;
  const intervalMs = Math.max(100, options.intervalMs ?? DEFAULT_INTERVAL_MS);
  const attempts: CodexCliAppServerPromotionResult[] = [];
  const warnings: string[] = [];
  let iterations = 0;

  while (true) {
    iterations += 1;
    let promotedThisIteration = 0;
    const blockedThisIteration = new Set<string>();

    while (promotedThisIteration < maxPromotions) {
      const attempt = await runCodexCliAppServerPromotion({
        ...options,
        limit: 1,
        excludeDedupeKeys: blockedThisIteration,
      });
      warnings.push(...attempt.warnings);

      if (!attempt.item) break;
      attempts.push(attempt);

      if (attempt.status === "delivered") {
        promotedThisIteration += 1;
        continue;
      }

      // Active-turn blocks are per candidate/thread. Keep the blocked item
      // pending, but let this cycle inspect the next eligible message.
      blockedThisIteration.add(attempt.item.dedupeKey);
      if (isRetryableActiveTurn(attempt)) continue;
      break;
    }

    const lastAttempt = attempts.at(-1);
    const shouldRetryActiveTurn =
      options.mode === "watch" &&
      lastAttempt !== undefined &&
      isRetryableActiveTurn(lastAttempt);
    const hasTerminalAttempt =
      lastAttempt !== undefined &&
      (lastAttempt.status === "delivered" ||
        lastAttempt.status === "dry-run" ||
        (lastAttempt.status === "blocked" && !shouldRetryActiveTurn));
    if (hasTerminalAttempt) break;
    if (options.mode !== "watch") break;
    if (maxIterations > 0 && iterations >= maxIterations) break;
    await sleep(intervalMs);
  }

  const status = summarizeStatus(attempts);
  const first = attempts[0] ?? null;
  return {
    mode: options.mode,
    agent: first?.agent ?? options.agent,
    aliases: first?.aliases ?? [options.agent, ...(options.aliases ?? [])],
    commsDir: first?.commsDir ?? options.commsDir,
    statePath: first?.statePath ?? null,
    receiveTransport: "polling",
    adapter: "supervised-app-server-promotion",
    runtimeSurface: "codex-cli-app-server",
    status,
    delivered: attempts.filter((attempt) => attempt.delivered).length,
    blocked: attempts.filter((attempt) => attempt.status === "blocked").length,
    queued: attempts.filter((attempt) => attempt.queued).length,
    dryRun: attempts.some((attempt) => attempt.status === "dry-run"),
    iterations,
    attempts,
    lastBlockedReason:
      [...attempts].reverse().find((attempt) => attempt.blockedReason)
        ?.blockedReason ?? null,
    lastQueueReason:
      [...attempts].reverse().find((attempt) => attempt.queueReason)
        ?.queueReason ?? null,
    warnings,
  };
}
