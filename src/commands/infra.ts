import * as fs from "node:fs";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { resolveConfig } from "../config/index.js";
import { buildProfileReport, type AgentProfileReport } from "./status.js";
import {
  AGENT_PROFILES,
  type AgentProfileId,
  type ProfileConfig,
} from "./status-profiles.js";
import {
  supportsHeadlessRunnerProfile,
  type ReadyProfileId,
} from "./ready-profiles.js";
import {
  findRepoRoot,
  log,
  logHeader,
  parseArgs,
  resolveCommsDir,
} from "../utils.js";
import type { CommandResult } from "../types.js";

const INFRA_HELP = `
Usage:
  tap infra status [--profile <current|all|sumback-yoon|sumback-sol|mac-jun-ssh-tui|remote-panel-yoon|windows-app-sol>] [--json]

Description:
  Summarize tap runtime operations from existing read-only probes so operators
  do not have to remember separate receiver, panel, headless, and route checks.
  This command does not start supervisors, refresh presence, send smokes, or
  mutate inbox/heartbeat state.

Options:
  --profile <id>        Limit the report to one infra profile. Default: current.
  --fresh-minutes <n>   Freshness window for Windows App durable presence. Default: 30.
  --comms-dir <path>    Override comms directory for durable presence reads.
  --help                Show help.
`.trim();

type InfraProfileId = AgentProfileId | "windows-app-sol";
type InfraStatus = "ready" | "degraded" | "blocked" | "not-observed";
type InfraCheckStatus = "pass" | "warn" | "fail" | "block" | "skip";
type WorkerStatus = "single" | "conflict" | "missing" | "not-applicable";

const CURRENT_INFRA_PROFILES: InfraProfileId[] = [
  "sumback-yoon",
  "mac-jun-ssh-tui",
  "remote-panel-yoon",
  "windows-app-sol",
];

interface InfraCheck {
  name: string;
  status: InfraCheckStatus;
  message: string;
}

interface InfraWorkerOfRecord {
  expected: string;
  active: string[];
  status: WorkerStatus;
  message: string;
}

interface InfraSurfaceReport {
  id: InfraProfileId;
  label: string;
  agent: string;
  surface: "codex-cli" | "remote-panel" | "windows-app";
  status: InfraStatus;
  summary: string;
  workerOfRecord: InfraWorkerOfRecord;
  checks: InfraCheck[];
  nextActions: Array<{ label: string; command: string }>;
  source: {
    kind: "status-profile" | "presence";
    profile?: AgentProfileId;
    path?: string;
  };
}

interface InfraStatusReport extends Record<string, unknown> {
  status: Exclude<InfraStatus, "not-observed">;
  generatedAt: string;
  summary: {
    ready: number;
    degraded: number;
    blocked: number;
    notObserved: number;
  };
  profiles: InfraSurfaceReport[];
  operatorActions: Array<{ label: string; command: string }>;
  notes: string[];
}

type HeadlessRunnerStatusResult = {
  ok: boolean;
  stdout: string;
  stderr: string;
  status: number | null;
};

type HeadlessRunnerStatusRunner = (
  profileId: AgentProfileId,
) => HeadlessRunnerStatusResult;

type ProfileReportBuilder = (profile: ProfileConfig) => AgentProfileReport;

let profileReportBuilderForTests: ProfileReportBuilder | null = null;
let headlessRunnerStatusRunnerForTests: HeadlessRunnerStatusRunner | null =
  null;

export function __setInfraProfileReportBuilderForTests(
  builder: ProfileReportBuilder | null,
): void {
  profileReportBuilderForTests = builder;
}

export function __setInfraHeadlessRunnerStatusRunnerForTests(
  runner: HeadlessRunnerStatusRunner | null,
): void {
  headlessRunnerStatusRunnerForTests = runner;
}

function parsePositiveIntegerFlag(
  value: string | boolean | undefined,
  fallback: number,
  name: string,
): number {
  if (value === undefined) return fallback;
  if (typeof value !== "string") {
    throw new RangeError(`Invalid ${name}: expected a value.`);
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new RangeError(`Invalid ${name}: must be a positive integer.`);
  }
  return parsed;
}

function buildReportForProfile(profile: ProfileConfig): AgentProfileReport {
  if (profileReportBuilderForTests) {
    return profileReportBuilderForTests(profile);
  }
  return buildProfileReport(profile);
}

function runHeadlessRunnerStatus(
  profileId: AgentProfileId,
): HeadlessRunnerStatusResult {
  if (headlessRunnerStatusRunnerForTests) {
    return headlessRunnerStatusRunnerForTests(profileId);
  }
  const result = spawnSync(
    "bash",
    ["scripts/tap-headless-runner-supervisor.sh", profileId, "--status"],
    { encoding: "utf8", cwd: findRepoRoot() },
  );
  return {
    ok: result.status === 0,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    status: result.status,
  };
}

function isKnownInfraProfile(value: string): value is InfraProfileId {
  return value === "windows-app-sol" || value in AGENT_PROFILES;
}

function selectedProfiles(
  value: string | boolean | undefined,
): InfraProfileId[] {
  if (value === undefined || value === "current") {
    return [...CURRENT_INFRA_PROFILES];
  }
  if (value === "all") {
    return [
      ...(Object.keys(AGENT_PROFILES) as AgentProfileId[]),
      "windows-app-sol",
    ];
  }
  if (typeof value !== "string" || !isKnownInfraProfile(value)) {
    throw new RangeError(
      `Unknown infra profile. Use current, all, ${Object.keys(AGENT_PROFILES).join(", ")}, or windows-app-sol.`,
    );
  }
  return [value];
}

function mapProfileStatus(status: AgentProfileReport["status"]): InfraStatus {
  if (status === "ready") return "ready";
  if (status === "degraded") return "degraded";
  return "blocked";
}

function mapCheckStatus(status: string): InfraCheckStatus {
  if (status === "pass") return "pass";
  if (status === "warn") return "warn";
  if (status === "skip") return "skip";
  return "fail";
}

function parseHeadlessStatus(result: HeadlessRunnerStatusResult): {
  running: boolean;
  label: string;
  check: InfraCheck;
} {
  const output = `${result.stdout}\n${result.stderr}`
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" | ");
  if (!result.ok) {
    return {
      running: false,
      label: "unknown",
      check: {
        name: "headless-runner",
        status: "warn",
        message: `headless runner status probe failed${result.status === null ? "" : ` with exit ${result.status}`}`,
      },
    };
  }
  const running = /^running:/.test(output);
  return {
    running,
    label: running ? "running" : "stopped",
    check: {
      name: "headless-runner",
      status: running ? "warn" : "pass",
      message:
        output ||
        (running ? "headless runner is running" : "headless runner is stopped"),
    },
  };
}

function workerStatus(active: string[]): WorkerStatus {
  if (active.length === 0) return "missing";
  if (active.length > 1) return "conflict";
  return "single";
}

function buildStatusProfileSurface(
  profileId: AgentProfileId,
): InfraSurfaceReport {
  const profile = AGENT_PROFILES[profileId];
  const report = buildReportForProfile(profile);
  const checks: InfraCheck[] = report.checks.map((check) => ({
    name: check.name,
    status: mapCheckStatus(check.status),
    message: check.message,
  }));
  let workerOfRecord: InfraWorkerOfRecord;

  if (profile.kind === "codex-cli") {
    const active: string[] = [];
    if (report.surfaces.receiverSupervisor?.status === "running") {
      active.push("receiver-supervisor");
    }
    if (supportsHeadlessRunnerProfile(profile.id as ReadyProfileId)) {
      const headless = parseHeadlessStatus(runHeadlessRunnerStatus(profile.id));
      checks.push(headless.check);
      if (headless.running) {
        active.push("headless-runner");
      }
    }
    const status = workerStatus(active);
    workerOfRecord = {
      expected: "receiver-supervisor",
      active,
      status,
      message:
        status === "single"
          ? `worker-of-record is ${active[0]}`
          : status === "conflict"
            ? `multiple active workers: ${active.join(", ")}`
            : "no active CLI worker observed",
    };
    checks.push({
      name: "worker-of-record",
      status:
        status === "single" ? "pass" : status === "conflict" ? "warn" : "fail",
      message: workerOfRecord.message,
    });
  } else {
    const active =
      report.surfaces.remotePanel?.listening === true ? ["remote-panel"] : [];
    const status = active.length === 1 ? "single" : "missing";
    workerOfRecord = {
      expected: "read-only-remote-panel",
      active,
      status,
      message:
        status === "single"
          ? "remote panel is evidence/UI only; it is not a message worker"
          : "remote panel not observed",
    };
    checks.push({
      name: "worker-of-record",
      status: status === "single" ? "pass" : "fail",
      message: workerOfRecord.message,
    });
  }

  const hasConflict = workerOfRecord.status === "conflict";
  const status = hasConflict ? "degraded" : mapProfileStatus(report.status);

  return {
    id: profileId,
    label: report.label,
    agent: report.agent,
    surface: report.runtimeSurface,
    status,
    summary: hasConflict
      ? `${report.label} has a worker-of-record conflict.`
      : report.summary,
    workerOfRecord,
    checks,
    nextActions: report.nextActions,
    source: {
      kind: "status-profile",
      profile: profileId,
    },
  };
}

function readJsonFile(filePath: string): Record<string, unknown> | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as Record<
      string,
      unknown
    >;
  } catch {
    return null;
  }
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function objectValue(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function presenceRouteTuple(presence: Record<string, unknown> | null): {
  conversationId: string | null;
  ownerClientId: string | null;
} {
  const address = objectValue(presence?.address);
  const capabilities = objectValue(presence?.capabilities);
  return {
    conversationId:
      stringValue(address?.conversationId) ??
      stringValue(capabilities?.conversationId) ??
      stringValue(presence?.conversationId),
    ownerClientId:
      stringValue(address?.ownerClientId) ??
      stringValue(capabilities?.ownerClientId) ??
      stringValue(presence?.ownerClientId),
  };
}

function routeFreshnessStatePath(repoRoot: string): string {
  const stateDir =
    process.env.TAP_APP_ROUTE_FRESHNESS_STATE_DIR?.trim() ||
    resolveConfig({}, repoRoot).config.stateDir;
  return path.join(stateDir, "app-route-freshness", "windows-app-sol.json");
}

function isoAgeMinutes(value: string | null): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, (Date.now() - parsed) / 60_000);
}

function freshnessNextActionCommand(classification: string | null): string {
  if (
    classification === "refresh-soon" ||
    classification === "ttl-expired-target-ready"
  ) {
    return "tap app-route-freshness --agent 솔 --apply --json";
  }
  return "tap app-route-freshness --agent 솔 --json";
}

function schedulerStatusImpact(options: {
  state: Record<string, unknown> | null;
  stateFresh: boolean;
}): "none" | "needs-refresh" | "blocked" {
  if (!options.state || !options.stateFresh) return "none";
  const status = stringValue(options.state.lastStatus);
  if (status === "blocked") return "blocked";
  if (status === "needs-refresh") return "needs-refresh";
  return "none";
}

function buildWindowsAppSolSurface(
  commsDir: string,
  freshMinutes: number,
): InfraSurfaceReport {
  const presencePath = path.join(commsDir, "presence", "솔.json");
  const presence = readJsonFile(presencePath);
  const timestamp = stringValue(presence?.timestamp);
  const { conversationId, ownerClientId } = presenceRouteTuple(presence);
  const consentDriveStatus = stringValue(presence?.consentDriveStatus);
  const ageMinutes = timestamp
    ? Math.max(0, (Date.now() - Date.parse(timestamp)) / 60_000)
    : null;
  const fresh =
    ageMinutes !== null &&
    Number.isFinite(ageMinutes) &&
    ageMinutes <= freshMinutes;
  const tupleReady = Boolean(conversationId && ownerClientId);
  const consentDriveReady = consentDriveStatus === "ready";
  const routeReady = fresh && tupleReady && consentDriveReady;
  const schedulerPath = routeFreshnessStatePath(findRepoRoot());
  const schedulerState = readJsonFile(schedulerPath);
  const schedulerUpdatedAt = stringValue(schedulerState?.updatedAt);
  const schedulerAgeMinutes = isoAgeMinutes(schedulerUpdatedAt);
  const schedulerStateFresh =
    schedulerAgeMinutes !== null && schedulerAgeMinutes <= freshMinutes;
  const schedulerImpact = schedulerStatusImpact({
    state: schedulerState,
    stateFresh: schedulerStateFresh,
  });
  const status: InfraStatus = presence
    ? routeReady
      ? schedulerImpact === "blocked"
        ? "blocked"
        : schedulerImpact === "needs-refresh"
          ? "degraded"
          : "ready"
      : "blocked"
    : "not-observed";
  const active = routeReady ? ["consent-drive-ipc"] : [];
  const worker: WorkerStatus = active.length === 1 ? "single" : "missing";
  const checks: InfraCheck[] = [
    {
      name: "presence-file",
      status: presence ? "pass" : "fail",
      message: presence
        ? `durable presence exists at ${presencePath}`
        : `durable presence missing at ${presencePath}`,
    },
    {
      name: "presence-freshness",
      status: fresh ? "pass" : presence ? "fail" : "skip",
      message:
        ageMinutes === null
          ? "presence timestamp not observed"
          : `presence age is ${ageMinutes.toFixed(1)} minute(s); limit=${freshMinutes}`,
    },
    {
      name: "route-tuple",
      status: tupleReady ? "pass" : "fail",
      message: tupleReady
        ? `conversationId=${conversationId}, ownerClientId=${ownerClientId}`
        : "Windows App route tuple needs conversationId and ownerClientId",
    },
    {
      name: "consent-drive-status",
      status: consentDriveReady ? "pass" : presence ? "fail" : "warn",
      message: consentDriveStatus
        ? `consentDriveStatus=${consentDriveStatus}`
        : "consent-drive status not published in durable presence",
    },
    {
      name: "worker-of-record",
      status: worker === "single" ? "pass" : "fail",
      message:
        worker === "single"
          ? "worker-of-record is consent-drive-ipc"
          : "no fresh Windows App live route worker observed",
    },
  ];

  if (schedulerState) {
    const schedulerStatus = stringValue(schedulerState.lastStatus);
    const schedulerClassification = stringValue(
      schedulerState.lastClassification,
    );
    const routeAgeSeconds = numberValue(schedulerState.routeAgeSeconds);
    const routeAgeRatio = numberValue(schedulerState.routeAgeRatio);
    const nextRefreshAt = stringValue(schedulerState.nextRefreshAt);
    const lastRefreshAt = stringValue(schedulerState.lastRefreshAt);
    const sourceHost = stringValue(schedulerState.sourceHost);
    const sourceHostStatus = stringValue(schedulerState.sourceHostStatus);
    const configuredHostDrift = schedulerState.configuredHostDrift === true;
    const nextAction = stringValue(schedulerState.nextAction);
    checks.push(
      {
        name: "app-route-freshness-state",
        status: schedulerStateFresh ? "pass" : "warn",
        message: schedulerStateFresh
          ? `scheduler state is fresh at ${schedulerPath}`
          : `scheduler state is stale or undated at ${schedulerPath}`,
      },
      {
        name: "app-route-last-refresh",
        status: lastRefreshAt ? "pass" : "warn",
        message: lastRefreshAt
          ? `lastRefreshAt=${lastRefreshAt}`
          : "scheduler has not recorded a successful refresh yet",
      },
      {
        name: "app-route-age",
        status:
          schedulerImpact === "blocked"
            ? "block"
            : schedulerImpact === "needs-refresh"
              ? "warn"
              : "pass",
        message:
          routeAgeSeconds === null
            ? `route age not recorded; classification=${schedulerClassification ?? "unknown"}`
            : `route age is ${routeAgeSeconds.toFixed(1)}s (${routeAgeRatio === null ? "unknown" : routeAgeRatio.toFixed(2)} of window); nextRefreshAt=${nextRefreshAt ?? "unknown"}`,
      },
      {
        name: "app-route-source-host",
        status: configuredHostDrift ? "warn" : "pass",
        message: sourceHost
          ? `sourceHost=${sourceHost}, status=${sourceHostStatus ?? "unknown"}, configuredHostDrift=${configuredHostDrift}`
          : `source host not recorded; configuredHostDrift=${configuredHostDrift}`,
      },
      {
        name: "app-route-next-action",
        status:
          schedulerImpact === "blocked"
            ? "block"
            : schedulerImpact === "needs-refresh"
              ? "warn"
              : "pass",
        message:
          nextAction ??
          `scheduler status=${schedulerStatus ?? "unknown"}, classification=${schedulerClassification ?? "unknown"}`,
      },
    );
  } else {
    checks.push({
      name: "app-route-freshness-state",
      status: "warn",
      message: `scheduler state missing at ${schedulerPath}`,
    });
  }

  const schedulerClassification = stringValue(
    schedulerState?.lastClassification,
  );
  const schedulerNextAction = freshnessNextActionCommand(
    schedulerClassification,
  );

  return {
    id: "windows-app-sol",
    label: "Windows App 솔 consent-drive route",
    agent: "솔",
    surface: "windows-app",
    status,
    summary:
      status === "ready"
        ? "Windows App 솔 route tuple is fresh."
        : status === "degraded"
          ? "Windows App 솔 route tuple is fresh but scheduled refresh is due."
          : status === "not-observed"
            ? "Windows App 솔 route tuple is not observed."
            : "Windows App 솔 route tuple is blocked or stale.",
    workerOfRecord: {
      expected: "consent-drive-ipc",
      active,
      status: worker,
      message:
        worker === "single"
          ? "worker-of-record is consent-drive-ipc"
          : "no fresh Windows App live route worker observed",
    },
    checks,
    nextActions: [
      {
        label: "Inspect App route freshness scheduler",
        command: schedulerNextAction,
      },
      {
        label: "Inspect Windows App route readiness",
        command: "tap ready --surface windows-app --agent 솔 --json",
      },
    ],
    source: {
      kind: "presence",
      path: presencePath,
    },
  };
}

function compareStatus(a: InfraStatus, b: InfraStatus): number {
  const weight: Record<InfraStatus, number> = {
    blocked: 0,
    degraded: 1,
    "not-observed": 2,
    ready: 3,
  };
  return weight[a] - weight[b];
}

function aggregateStatus(
  profiles: InfraSurfaceReport[],
): InfraStatusReport["status"] {
  if (profiles.some((profile) => profile.status === "blocked"))
    return "blocked";
  if (
    profiles.some(
      (profile) =>
        profile.status === "degraded" || profile.status === "not-observed",
    )
  ) {
    return "degraded";
  }
  return "ready";
}

function buildInfraReport(options: {
  profiles: InfraProfileId[];
  commsDir: string;
  freshMinutes: number;
}): InfraStatusReport {
  const profiles = options.profiles
    .map((profileId) =>
      profileId === "windows-app-sol"
        ? buildWindowsAppSolSurface(options.commsDir, options.freshMinutes)
        : buildStatusProfileSurface(profileId),
    )
    .sort(
      (a, b) => compareStatus(a.status, b.status) || a.id.localeCompare(b.id),
    );

  const summary = {
    ready: profiles.filter((profile) => profile.status === "ready").length,
    degraded: profiles.filter((profile) => profile.status === "degraded")
      .length,
    blocked: profiles.filter((profile) => profile.status === "blocked").length,
    notObserved: profiles.filter((profile) => profile.status === "not-observed")
      .length,
  };

  return {
    status: aggregateStatus(profiles),
    generatedAt: new Date().toISOString(),
    summary,
    profiles,
    operatorActions: profiles.flatMap((profile) => profile.nextActions),
    notes: [
      "read-only report: no supervisors, routes, presence, inbox, or heartbeats were changed",
      "Windows App live delivery still requires a fresh consent-drive tuple plus durable inbox evidence",
    ],
  };
}

function logInfraReport(report: InfraStatusReport): void {
  logHeader("tap infra status");
  log(`Status: ${report.status}`);
  log(
    `Summary: ready=${report.summary.ready} degraded=${report.summary.degraded} blocked=${report.summary.blocked} notObserved=${report.summary.notObserved}`,
  );
  log("");
  for (const profile of report.profiles) {
    log(
      `${profile.status.padEnd(12)} ${profile.id}: ${profile.summary} worker=${profile.workerOfRecord.status}`,
    );
    const firstProblem = profile.checks.find(
      (check) =>
        check.status === "fail" ||
        check.status === "block" ||
        check.status === "warn",
    );
    if (firstProblem) {
      log(
        `  ${firstProblem.status} ${firstProblem.name}: ${firstProblem.message}`,
      );
    }
  }
  if (report.operatorActions.length > 0) {
    log("");
    log("Next actions:");
    for (const action of report.operatorActions.slice(0, 8)) {
      log(`- ${action.label}: ${action.command}`);
    }
  }
}

export async function infraCommand(
  args: string[],
): Promise<CommandResult<InfraStatusReport>> {
  if (args.includes("--help") || args.includes("-h")) {
    log(INFRA_HELP);
    return {
      ok: true,
      command: "infra",
      code: "TAP_NO_OP",
      message: INFRA_HELP,
      warnings: [],
      data: {} as InfraStatusReport,
    };
  }

  const parsed = parseArgs(args);
  const subcommand = parsed.positional[0] ?? "status";
  if (subcommand !== "status") {
    return {
      ok: false,
      command: "infra",
      code: "TAP_INVALID_ARGUMENT",
      message: `Unknown tap infra subcommand: ${subcommand}. Use: tap infra status`,
      warnings: [],
      data: {} as InfraStatusReport,
    };
  }

  try {
    const repoRoot = findRepoRoot();
    const report = buildInfraReport({
      profiles: selectedProfiles(parsed.flags.profile),
      commsDir: resolveCommsDir(args, repoRoot),
      freshMinutes: parsePositiveIntegerFlag(
        parsed.flags["fresh-minutes"],
        30,
        "--fresh-minutes",
      ),
    });
    logInfraReport(report);
    return {
      ok: true,
      command: "infra",
      code: "TAP_INFRA_STATUS_OK",
      message: `tap infra status: ${report.status}`,
      warnings: report.profiles.flatMap((profile) =>
        profile.checks
          .filter(
            (check) =>
              check.status === "warn" ||
              check.status === "fail" ||
              check.status === "block",
          )
          .map((check) => `${profile.id}/${check.name}: ${check.message}`),
      ),
      data: report,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      command: "infra",
      code: "TAP_INVALID_ARGUMENT",
      message,
      warnings: [message],
      data: {} as InfraStatusReport,
    };
  }
}
