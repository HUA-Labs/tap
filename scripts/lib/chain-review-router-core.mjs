import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export const DEFAULT_MAX_REVIEW_CYCLES = 3;
export const DEFAULT_ACTIVE_WINDOW_MS = 30 * 60 * 1000;

function parseNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeIdentifier(value) {
  return String(value ?? "").trim().toLowerCase();
}

function parseList(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry).trim()).filter(Boolean);
  }
  return String(value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function toIsoString(now) {
  return now instanceof Date ? now.toISOString() : new Date(now).toISOString();
}

function toTime(value) {
  if (!value) return 0;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function datePrefix(now = new Date()) {
  return new Date(now).toISOString().slice(0, 10).replace(/-/g, "");
}

function compareByLastActivityDesc(a, b) {
  return toTime(b.lastActivity || b.timestamp) - toTime(a.lastActivity || a.timestamp);
}

function isCodexLike(reviewer) {
  const normalizedName = normalizeIdentifier(reviewer.name);
  const normalizedId = normalizeIdentifier(reviewer.id);
  return (
    normalizedName === "코" ||
    normalizedName.includes("codex") ||
    normalizedId.startsWith("codex") ||
    normalizedId.includes("codex")
  );
}

/** Detect runtime from agent id/name patterns: "codex" | "gemini" | "claude" */
function detectRuntime(agent) {
  const id = normalizeIdentifier(agent.id ?? agent.key ?? "");
  const name = normalizeIdentifier(agent.name ?? "");
  if (id.includes("codex") || name.includes("codex") || name === "코")
    return "codex";
  if (id.includes("gemini") || name.includes("gemini"))
    return "gemini";
  return "claude"; // default — Claude agents use CJK names without runtime prefix
}

function buildPrKey(prNumber) {
  return `pr-${prNumber}`;
}

function buildRevisionToken(pr) {
  return (
    pr.headRefOid ||
    pr.updatedAt ||
    `${pr.headRefName || "unknown"}:${pr.changedFiles ?? "?"}:${pr.additions ?? "?"}:${pr.deletions ?? "?"}`
  );
}

function buildReviewRequestContent(pr, context) {
  const fileCount = pr.changedFiles ?? "?";
  const adds = pr.additions ?? "?";
  const dels = pr.deletions ?? "?";
  const rerouteLine = context.isReroute
    ? `- 새 revision 감지 후 재배정됨 (${context.previousRevision || "previous"} -> ${context.currentRevision})`
    : "- 최초 자동 라우팅";

  return `PR #${pr.number} 리뷰 요청 — CHAIN 자동 라우팅

## PR 정보
- **제목**: ${pr.title}
- **미션**: ${context.mission || "미확인"}
- **작성자**: ${context.author}
- **브랜치**: \`${pr.headRefName}\`
- **변경**: ${fileCount} files (+${adds} -${dels})

## 리뷰 기준
- 보안, 정확성, 하위호환, 테스트, 코드 품질
- 결과: \`${context.commsDir}/reviews/\`에 작성
- 완료 후: \`tap_reply\`로 작성자와 관제탑에 알려줘

## 리뷰 사이클
- 현재: ${context.cycle}/${context.maxReviewCycles}회차
- 상태: ${rerouteLine}

---
*이 메시지는 CHAIN auto-router가 생성했습니다.*`;
}

function buildReviewDoneContent(prNumber, info, reviewPath) {
  return `PR #${prNumber} 리뷰 완료 알림 — CHAIN 자동 라우팅

${info.reviewerName || info.reviewer}가 리뷰를 완료했어.
리뷰 파일: \`${reviewPath}\`

확인하고 필요하면 수정 후 관제탑에 보고해줘.

---
*이 메시지는 CHAIN auto-router가 생성했습니다.*`;
}

function buildEscalationContent(pr, context) {
  return `PR #${pr.number} 리뷰 사이클 에스컬레이션 — CHAIN 자동 라우팅

- 제목: ${pr.title}
- 작성자: ${context.author}
- 마지막 reviewer: ${context.lastReviewer || "unknown"}
- 누적 사이클: ${context.cycles}/${context.maxReviewCycles}
- 브랜치: \`${pr.headRefName}\`

추가 라우팅은 중단했고 관제탑 판단이 필요하다.

---
*이 메시지는 CHAIN auto-router가 생성했습니다.*`;
}

function ensureDirectory(dirPath, fsApi) {
  fsApi.mkdirSync(dirPath, { recursive: true });
}

function buildUniqueFilename(dirPath, baseName, fsApi) {
  const ext = path.extname(baseName);
  const stem = ext ? baseName.slice(0, -ext.length) : baseName;
  let attempt = 1;
  let candidate = baseName;

  while (fsApi.existsSync(path.join(dirPath, candidate))) {
    attempt += 1;
    candidate = `${stem}-${attempt}${ext}`;
  }

  return candidate;
}

function findMatchingReviewFiles(reviewsDir, prNumber, fsApi) {
  if (!fsApi.existsSync(reviewsDir)) return [];

  const prNeedles = [`pr${prNumber}`, `pr-${prNumber}`];
  const matches = [];

  for (const entry of fsApi.readdirSync(reviewsDir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      const dirPath = path.join(reviewsDir, entry.name);
      for (const file of fsApi.readdirSync(dirPath, { withFileTypes: true })) {
        if (!file.isFile()) continue;
        const lowered = file.name.toLowerCase();
        if (!prNeedles.some((needle) => lowered.includes(needle))) continue;
        const fullPath = path.join(dirPath, file.name);
        matches.push({
          relativePath: `${entry.name}/${file.name}`,
          fullPath,
          mtimeMs: fsApi.statSync(fullPath).mtimeMs,
        });
      }
      continue;
    }

    if (!entry.isFile()) continue;
    const lowered = entry.name.toLowerCase();
    if (!prNeedles.some((needle) => lowered.includes(needle))) continue;
    const fullPath = path.join(reviewsDir, entry.name);
    matches.push({
      relativePath: entry.name,
      fullPath,
      mtimeMs: fsApi.statSync(fullPath).mtimeMs,
    });
  }

  return matches.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

function gh(command, deps, cwd) {
  const exec = deps.execSync ?? execSync;
  return exec(`gh ${command}`, {
    encoding: "utf-8",
    timeout: 15000,
    cwd,
  }).trim();
}

export function resolveChainConfig(options = {}, deps = {}) {
  const env = deps.env ?? process.env;
  const cwd = options.cwd ?? deps.cwd ?? process.cwd();
  const rawCommsDir = options.commsDir ?? env.TAP_COMMS_DIR ?? "../hua-comms";
  const commsDir = path.isAbsolute(rawCommsDir)
    ? rawCommsDir
    : path.resolve(cwd, rawCommsDir);

  return {
    cwd,
    commsDir,
    inboxDir: path.join(commsDir, "inbox"),
    reviewsDir: path.join(commsDir, "reviews"),
    statePath: options.statePath ?? path.join(commsDir, ".chain-state.json"),
    maxReviewCycles: parseNumber(
      options.maxReviewCycles ?? env.TAP_CHAIN_MAX_REVIEW_CYCLES,
      DEFAULT_MAX_REVIEW_CYCLES,
    ),
    activeWindowMs: parseNumber(
      options.activeWindowMs ?? env.TAP_CHAIN_ACTIVE_WINDOW_MS,
      DEFAULT_ACTIVE_WINDOW_MS,
    ),
    towerName: options.towerName ?? env.TAP_TOWER_NAME ?? "돌",
    preferredReviewers: parseList(
      options.preferredReviewers ?? env.TAP_CHAIN_PREFERRED_REVIEWERS ?? "",
    ),
  };
}

export function loadChainState(statePath, fsApi = fs) {
  try {
    const parsed = JSON.parse(fsApi.readFileSync(statePath, "utf-8"));
    return {
      seenPrs: parsed.seenPrs ?? {},
      reviewCycles: parsed.reviewCycles ?? {},
    };
  } catch {
    return {
      seenPrs: {},
      reviewCycles: {},
    };
  }
}

export function saveChainState(statePath, state, fsApi = fs) {
  ensureDirectory(path.dirname(statePath), fsApi);
  fsApi.writeFileSync(statePath, JSON.stringify(state, null, 2), "utf-8");
}

export function writeInboxMessage(config, from, to, subject, content, deps = {}) {
  const fsApi = deps.fs ?? fs;
  ensureDirectory(config.inboxDir, fsApi);
  const filename = buildUniqueFilename(
    config.inboxDir,
    `${datePrefix(deps.now?.() ?? new Date())}-${from}-${to}-${subject}.md`,
    fsApi,
  );
  const filePath = path.join(config.inboxDir, filename);
  fsApi.writeFileSync(filePath, content, "utf-8");
  return {
    filename,
    filePath,
  };
}

/** Load instance runtime map from state.json: { instanceId → "claude" | "codex" | "gemini" } */
function loadRuntimeMap(config, fsApi) {
  // Try multiple state.json locations — CHAIN config may not have stateDir/repoRoot
  const candidates = [
    config.stateDir ? path.join(config.stateDir, "state.json") : null,
    config.repoRoot ? path.join(config.repoRoot, ".tap-comms", "state.json") : null,
    config.commsDir ? path.join(path.dirname(config.commsDir), ".tap-comms", "state.json") : null,
    path.join(process.cwd(), ".tap-comms", "state.json"),
  ].filter(Boolean);

  for (const statePath of candidates) {
    if (!fsApi.existsSync(statePath)) continue;
    try {
      const state = JSON.parse(fsApi.readFileSync(statePath, "utf-8"));
      const map = {};
      for (const [id, inst] of Object.entries(state.instances ?? {})) {
        if (inst?.runtime) map[id] = inst.runtime;
        if (inst?.agentName) map[inst.agentName] = inst.runtime;
      }
      return map;
    } catch {
      continue;
    }
  }
  return {};
}

export function getActiveReviewers(config, deps = {}) {
  const fsApi = deps.fs ?? fs;
  const heartbeatsPath = path.join(config.commsDir, "heartbeats.json");
  if (!fsApi.existsSync(heartbeatsPath)) return [];

  const runtimeMap = loadRuntimeMap(config, fsApi);

  try {
    const store = JSON.parse(fsApi.readFileSync(heartbeatsPath, "utf-8"));
    const nowMs = toTime(deps.now?.() ?? new Date());
    const reviewers = [];

    for (const [key, entry] of Object.entries(store)) {
      const lastSeen = Math.max(
        toTime(entry?.lastActivity),
        toTime(entry?.timestamp),
      );
      const isRecent = nowMs - lastSeen < config.activeWindowMs;
      if (!isRecent || entry?.status !== "active") continue;

      const agentName = entry?.agent || key;
      reviewers.push({
        key,
        id: entry?.id || key,
        name: agentName,
        runtime: runtimeMap[key] ?? runtimeMap[agentName] ?? detectRuntime({ id: key, name: agentName, key }),
        lastActivity: entry?.lastActivity || entry?.timestamp || null,
      });
    }

    return reviewers.sort(compareByLastActivityDesc);
  } catch {
    return [];
  }
}

export function selectReviewer(prAuthor, reviewers, config) {
  const authorKey = normalizeIdentifier(prAuthor);
  const towerKey = normalizeIdentifier(config.towerName);
  const candidates = reviewers.filter((reviewer) => {
    const ids = [reviewer.id, reviewer.name, reviewer.key].map(normalizeIdentifier);
    return !ids.includes(authorKey) && !ids.includes(towerKey);
  });

  if (candidates.length === 0) return null;

  // 1. Preferred reviewers first
  for (const preferred of config.preferredReviewers) {
    const preferredKey = normalizeIdentifier(preferred);
    const match = candidates.find((reviewer) =>
      [reviewer.id, reviewer.name, reviewer.key]
        .map(normalizeIdentifier)
        .includes(preferredKey),
    );
    if (match) return match;
  }

  // 2. Cross-model preference: prefer reviewer from different runtime
  //    Uses state.json runtime (primary) or name-pattern fallback
  const authorRuntime = detectRuntime({ id: authorKey, name: authorKey, key: authorKey });
  const crossModel = candidates
    .filter((r) => (r.runtime ?? detectRuntime(r)) !== authorRuntime)
    .sort(compareByLastActivityDesc);
  if (crossModel.length > 0) return crossModel[0];

  // 3. Same-runtime fallback (better than no reviewer)
  return [...candidates].sort(compareByLastActivityDesc)[0];
}

export function getOpenPRs(config, deps = {}) {
  try {
    const raw = gh(
      "pr list --state open --json number,title,author,headRefName,headRefOid,changedFiles,additions,deletions,updatedAt --limit 20",
      deps,
      config.cwd,
    );
    return JSON.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const report = deps.error ?? console.error;
    report(`[chain] gh query failed: ${message}`);
    return [];
  }
}

export function extractMission(title, branch) {
  const titleMatch = title?.match(/\[?M(\d+)\]?/i);
  if (titleMatch) return `M${titleMatch[1]}`;

  const branchMatch = branch?.match(/m(\d+)/i);
  if (branchMatch) return `M${branchMatch[1]}`;

  return null;
}

export function extractAuthor(pr) {
  const match = pr.title?.match(/\[.*?([가-힣A-Za-z]+)\]$/);
  return match ? match[1] : pr.author?.login || "unknown";
}

function maybeEscalate(pr, state, config, deps, context) {
  const now = deps.now?.() ?? new Date();
  if (!deps.dryRun) {
    const escalation = writeInboxMessage(
      config,
      "chain",
      config.towerName,
      `review-escalation-PR${pr.number}`,
      buildEscalationContent(pr, context),
      deps,
    );
    state.seenPrs[buildPrKey(pr.number)] = {
      ...(state.seenPrs[buildPrKey(pr.number)] ?? {}),
      escalatedAt: toIsoString(now),
      escalationFilename: escalation.filename,
    };
  }

  return {
    action: "escalated",
    reason: `${context.cycles} review cycles exhausted`,
  };
}

export function routePR(pr, state, config, deps = {}) {
  const prKey = buildPrKey(pr.number);
  const previous = state.seenPrs[prKey] ?? {};
  const previousRevision = previous.routeRevision;
  const currentRevision = buildRevisionToken(pr);

  if (previous.routed && previousRevision === currentRevision) {
    return {
      action: "skip",
      reason: "already routed",
    };
  }

  const cycles = state.reviewCycles[prKey] || 0;
  const author = extractAuthor(pr);
  if (cycles >= config.maxReviewCycles) {
    return maybeEscalate(pr, state, config, deps, {
      author,
      cycles,
      maxReviewCycles: config.maxReviewCycles,
      lastReviewer: previous.reviewerName || previous.reviewer,
    });
  }

  const reviewers = deps.reviewers ?? getActiveReviewers(config, deps);
  const reviewer = selectReviewer(author, reviewers, config);
  if (!reviewer) {
    return {
      action: "skip",
      reason: "no available reviewer",
    };
  }

  const mission = extractMission(pr.title, pr.headRefName);
  const cycle = cycles + 1;
  const isReroute = Boolean(previous.routed);
  let filename = null;

  if (!deps.dryRun) {
    const message = writeInboxMessage(
      config,
      "chain",
      reviewer.id || reviewer.name,
      `review-PR${pr.number}`,
      buildReviewRequestContent(pr, {
        author,
        mission,
        cycle,
        maxReviewCycles: config.maxReviewCycles,
        commsDir: config.commsDir,
        isReroute,
        previousRevision,
        currentRevision,
      }),
      deps,
    );
    filename = message.filename;
    state.seenPrs[prKey] = {
      ...previous,
      routed: true,
      reviewer: reviewer.id || reviewer.name,
      reviewerName: reviewer.name,
      author,
      mission,
      title: pr.title,
      headRefName: pr.headRefName,
      routeRevision: currentRevision,
      lastHeadRefOid: pr.headRefOid ?? null,
      lastUpdatedAt: pr.updatedAt ?? null,
      lastRoutedAt: toIsoString(deps.now?.() ?? new Date()),
      lastRouteFilename: filename ?? previous.lastRouteFilename ?? null,
    };
    state.reviewCycles[prKey] = cycle;
  }

  return {
    action: isReroute ? "rerouted" : "routed",
    reviewer: reviewer.name,
    reviewerId: reviewer.id || reviewer.name,
    mission,
    author,
    cycle,
    filename,
  };
}

export function checkReviewCompletions(state, config, deps = {}) {
  const notifications = [];
  const now = deps.now?.() ?? new Date();

  for (const [prKey, info] of Object.entries(state.seenPrs)) {
    if (!info.routed) continue;
    const prNumber = prKey.replace(/^pr-/, "");
    const latest = findMatchingReviewFiles(config.reviewsDir, prNumber, deps.fs ?? fs)[0];
    if (!latest) continue;
    if (latest.relativePath === info.lastReviewFile) continue;

    let filename = null;
    if (!deps.dryRun) {
      const message = writeInboxMessage(
        config,
        "chain",
        info.author,
        `review-done-PR${prNumber}`,
        buildReviewDoneContent(prNumber, info, latest.relativePath),
        deps,
      );
      filename = message.filename;
      info.reviewNotified = true;
      info.reviewNotifiedAt = toIsoString(now);
      info.lastReviewFile = latest.relativePath;
      info.lastReviewNotification = filename;
    }

    notifications.push({
      pr: prNumber,
      author: info.author,
      reviewer: info.reviewerName || info.reviewer,
      reviewPath: latest.relativePath,
      filename,
    });
  }

  return notifications;
}

export function summarizeChainPass(result) {
  return {
    routed: result.results.filter((item) => item.action === "routed").length,
    rerouted: result.results.filter((item) => item.action === "rerouted").length,
    skipped: result.results.filter((item) => item.action === "skip").length,
    escalated: result.results.filter((item) => item.action === "escalated").length,
    completions: result.completions.length,
  };
}

export async function runChainRouterPass(options = {}, deps = {}) {
  const config = resolveChainConfig(options, deps);
  const state = loadChainState(config.statePath, deps.fs ?? fs);
  const dryRun = Boolean(options.dryRun);
  const reviewers = getActiveReviewers(config, deps);
  const specificPR = options.specificPR ? Number(options.specificPR) : null;
  const prs = getOpenPRs(config, deps).filter((pr) =>
    specificPR ? pr.number === specificPR : true,
  );

  const results = prs.map((pr) =>
    routePR(pr, state, config, {
      ...deps,
      reviewers,
      dryRun,
    }),
  );
  const completions = checkReviewCompletions(state, config, {
    ...deps,
    dryRun,
  });

  if (!dryRun) {
    saveChainState(config.statePath, state, deps.fs ?? fs);
  }

  return {
    config,
    dryRun,
    prs,
    reviewers,
    results: results.map((result, index) => ({
      pr: prs[index]?.number,
      title: prs[index]?.title,
      ...result,
    })),
    completions,
    state,
    summary: summarizeChainPass({
      results,
      completions,
    }),
  };
}
