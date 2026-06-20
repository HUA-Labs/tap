import * as fs from "node:fs";
import * as path from "node:path";
import { appRouteFreshnessCommand } from "./app-route-freshness.js";
import { AGENT_PROFILES, type ProfileConfig } from "./status-profiles.js";
import { statusProfilesFromProfilePack } from "./profile-pack-loader.js";
import { resolveConfig } from "../config/index.js";
import { resolvePresenceRecord } from "../presence-lookup.js";
import type { CommandResult } from "../types.js";
import {
  findRepoRoot,
  log,
  logHeader,
  parseArgs,
  resolveCommsDir,
} from "../utils.js";

const HELP = `
Usage:
  tap comms-doctor [--agent agent-a] [--surface <all|app|windows-app|cli|receiver|mcp-channel|inbox|remote-panel>] [--plan-send] [--json]

Description:
  Explain tap delivery by runtime surface. The doctor separates live delivery,
  durable inbox evidence, receiver/promoter paths, MCP/channel visibility, and
  fallback evidence so operators do not have to infer them from raw presence or
  inbox files.

Options:
  --agent <name>              Target agent to diagnose. Default: agent-a.
  --all-known                 Diagnose local installed instances plus known presence files.
  --profile-pack <path>       Load reviewed local profile-pack surfaces.
  --include-profile-pack      Include agents from --profile-pack when used with --all-known.
  --surface <kind>            Limit surfaces. Default: all.
  --plan-send                 Include a compact safe send plan.
  --evidence-file <path[,p]>  Inspect one or more message/evidence files.
  --expected-recipient <name> Expected live recipient for mismatch detection.
  --expected-surface <kind>   Expected live surface, e.g. app, cli, inbox.
  --fresh-minutes <n>         Presence freshness window. Default: 30.
  --scan-inbox <n>            Inspect recent inbox records when no evidence file is provided. Default: 20.
  --comms-dir <path>          Override configured comms/SSOT directory.
  --central <path>            Alias for configured comms/SSOT directory.
  --remote-hosts <json>       Pass active remote host map to App route proof.
  --codex-config <path>       Pass Codex config path to App route proof.
  --source-host <host>        Pass source host alias to App route proof.
  --conversation-id <id>      Pass selected App conversation id to App proof.
  --state-dir <path>          Pass and inspect scheduler state dir for App route proof.
  --help                     Show help.
`.trim();

type SurfaceFilter =
  | "all"
  | "app"
  | "windows-app"
  | "cli"
  | "receiver"
  | "mcp-channel"
  | "inbox"
  | "remote-panel";

type SurfaceKind =
  | "windows-app"
  | "codex-cli"
  | "mcp-channel"
  | "inbox-fallback"
  | "remote-panel";

type Readiness =
  | "ready"
  | "needs-repair"
  | "blocked"
  | "inspect-required"
  | "not-observed";

type GapSeverity = "info" | "warn" | "fail";
type SchedulerOperationalState =
  | "standing-worker-ready"
  | "scheduler-state-missing"
  | "scheduler-stopped"
  | "no-standing-freshness-worker"
  | "target-local-ready-central-ttl-expired"
  | "not-applicable";

const DEFAULT_STALE_WORKER_SECONDS = 30 * 60;

interface ParsedOptions {
  agents: string[];
  allKnown: boolean;
  surface: SurfaceFilter;
  planSend: boolean;
  expectedRecipient: string | null;
  expectedSurface: string | null;
  freshMinutes: number;
  scanInbox: number;
  commsDir: string;
  stateDir: string;
  evidenceFiles: string[];
  appProofFlags: Record<string, string>;
  includeProfilePack: boolean;
  profilePackPath: string | null;
  profilePackProfiles: ProfileConfig[];
}

interface PresenceSummary {
  path: string;
  requestedPath: string;
  matchedBy: string;
  exists: boolean;
  fresh: boolean;
  ageSeconds: number | null;
  freshness: string;
  receiveTransports: string[];
  route: {
    hostId: string | null;
    conversationId: string | null;
    ownerClientId: string | null;
    complete: boolean;
  };
}

interface RouteLeaseSummary {
  path: string;
  exists: boolean;
  active: boolean;
  ageSeconds: number | null;
  expiresAt: string | null;
  updatedAt: string | null;
  source: string | null;
  liveAuthority: boolean | null;
  receiveTransports: string[];
  route: PresenceSummary["route"];
  message: string;
}

interface RouteProof {
  transport: string;
  liveAttemptStatus: string;
  fallbackToInbox: boolean;
  reason: string | null;
}

interface SchedulerSummary {
  statePath: string;
  lockPath: string;
  stateExists: boolean;
  lockExists: boolean;
  lastRunAt: string | null;
  updatedAt: string | null;
  lastStatus: string | null;
  lastClassification: string | null;
  lastRefreshAt: string | null;
  routeAgeSeconds: number | null;
  nextRefreshAt: string | null;
  worker: {
    enabled: boolean | null;
    status: string | null;
    lockPath: string | null;
    owner: Record<string, unknown> | null;
    message: string | null;
  };
  operationalState: SchedulerOperationalState;
  operationalFailure: boolean;
  message: string;
}

interface SchedulerFileSnapshot {
  statePath: string;
  lockPath: string;
  state: Record<string, unknown> | null;
  lockOwner: Record<string, unknown> | null;
  stateExists: boolean;
  lockExists: boolean;
}

interface SurfaceReport {
  id: string;
  agent: string;
  label: string;
  kind: SurfaceKind;
  recommendedTransport: string;
  liveDelivery: boolean;
  durableEvidence: boolean;
  fallbackEvidence: boolean;
  readiness: Readiness;
  summary: string;
  routeTuple: PresenceSummary["route"] | null;
  routeFreshness: {
    fresh: boolean;
    ageSeconds: number | null;
    freshness: string | null;
  } | null;
  routeLease?: RouteLeaseSummary | null;
  scheduler?: SchedulerSummary | null;
  dryRunProof: RouteProof | null;
  receiverPromoter: Record<string, unknown> | null;
  evidenceBoundary: string;
  nextAction: string;
}

interface EvidenceRecord {
  path: string;
  inConfiguredInbox: boolean;
  from: string | null;
  to: string | null;
  subject: string | null;
  scope: string | null;
  action: string | null;
  consentRef: string | null;
  transport: string | null;
  liveAttemptStatus: string | null;
  fallbackToInbox: boolean | null;
  inboxEvidence: boolean | null;
  inboxPath: string | null;
  durableEvidence: boolean | null;
}

interface EvidenceGap {
  id: string;
  severity: GapSeverity;
  evidencePath: string | null;
  message: string;
  nextAction: string;
}

interface CommsDoctorReport extends Record<string, unknown> {
  generatedAt: string;
  status: "ready" | "needs-attention";
  targets: Array<{
    agent: string;
    expectedRecipient: string | null;
    expectedSurface: string | null;
  }>;
  surfaces: SurfaceReport[];
  evidence: EvidenceRecord[];
  gaps: EvidenceGap[];
  sendPlan: Array<{
    agent: string;
    surface: SurfaceKind;
    command: string;
    reason: string;
  }>;
  notes: string[];
}

type AppRouteFreshnessRunner = (
  args: string[],
) => Promise<CommandResult<Record<string, unknown>>>;

let appRouteFreshnessRunnerForTests: AppRouteFreshnessRunner | null = null;

export function __setCommsDoctorAppRouteFreshnessRunnerForTests(
  runner: AppRouteFreshnessRunner | null,
): void {
  appRouteFreshnessRunnerForTests = runner;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function rec(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function bool(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (value.trim() === "true") return true;
    if (value.trim() === "false") return false;
  }
  return null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringArray(value: unknown): string[] {
  if (typeof value === "string") return value.trim() ? [value.trim()] : [];
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
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

function positiveIntegerFlag(
  value: string | boolean | undefined,
  fallback: number,
  name: string,
): { ok: true; value: number } | { ok: false; message: string } {
  if (value === undefined) return { ok: true, value: fallback };
  if (typeof value !== "string")
    return { ok: false, message: `Invalid ${name}: expected a value.` };
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return {
      ok: false,
      message: `Invalid ${name}: must be a non-negative integer.`,
    };
  }
  return { ok: true, value: parsed };
}

function stringFlag(
  value: string | boolean | undefined,
  fallback: string | null,
  name: string,
): { ok: true; value: string } | { ok: false; message: string } {
  if (value === undefined) {
    if (fallback != null) return { ok: true, value: fallback };
    return { ok: false, message: `Missing ${name}.` };
  }
  if (typeof value !== "string" || !value.trim()) {
    return { ok: false, message: `Invalid ${name}: expected a value.` };
  }
  return { ok: true, value: value.trim() };
}

function invalid(message: string): CommandResult<CommsDoctorReport> {
  return {
    ok: false,
    command: "comms-doctor",
    code: "TAP_INVALID_ARGUMENT",
    message,
    warnings: [message],
    data: {} as CommsDoctorReport,
  };
}

function parseSurface(
  value: string | boolean | undefined,
): { ok: true; value: SurfaceFilter } | { ok: false; message: string } {
  if (value === undefined) return { ok: true, value: "all" };
  if (typeof value !== "string") {
    return { ok: false, message: "Invalid --surface: expected a value." };
  }
  const surface = value.trim() as SurfaceFilter;
  const known: SurfaceFilter[] = [
    "all",
    "app",
    "windows-app",
    "cli",
    "receiver",
    "mcp-channel",
    "inbox",
    "remote-panel",
  ];
  if (!known.includes(surface)) {
    return {
      ok: false,
      message: `Unknown --surface ${value}. Use ${known.join(", ")}.`,
    };
  }
  return { ok: true, value: surface };
}

function matchesSurface(kind: SurfaceKind, filter: SurfaceFilter): boolean {
  if (filter === "all") return true;
  if (filter === "app") return kind === "windows-app";
  if (filter === "windows-app") return kind === "windows-app";
  if (filter === "cli") return kind === "codex-cli";
  if (filter === "receiver") return kind === "codex-cli";
  if (filter === "mcp-channel") return kind === "mcp-channel";
  if (filter === "inbox") return kind === "inbox-fallback";
  if (filter === "remote-panel") return kind === "remote-panel";
  return true;
}

function collectAppProofFlags(
  flags: Record<string, string | boolean>,
): Record<string, string> {
  const names = [
    "remote-hosts",
    "codex-config",
    "source-host",
    "conversation-id",
    "state-dir",
  ];
  const values: Record<string, string> = {};
  for (const name of names) {
    const value = flags[name];
    if (typeof value === "string" && value.trim()) values[name] = value.trim();
  }
  return values;
}

function resolveStateDir(
  value: string | boolean | undefined,
  repoRoot: string,
): { ok: true; value: string } | { ok: false; message: string } {
  if (value !== undefined) {
    if (typeof value !== "string" || !value.trim()) {
      return { ok: false, message: "Invalid --state-dir: expected a value." };
    }
    return { ok: true, value: path.resolve(value.trim()) };
  }
  const envStateDir = process.env.TAP_APP_ROUTE_FRESHNESS_STATE_DIR;
  if (envStateDir?.trim()) {
    return { ok: true, value: path.resolve(envStateDir) };
  }
  return { ok: true, value: resolveConfig({}, repoRoot).config.stateDir };
}

function safeAgentLabel(agent: string): string {
  const safe = agent
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}_-]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return safe || "agent";
}

function schedulerStatePath(stateDir: string, agent: string): string {
  return path.join(
    stateDir,
    "app-route-freshness",
    `windows-app-${safeAgentLabel(agent)}.json`,
  );
}

function schedulerLockPath(stateDir: string, agent: string): string {
  return path.join(
    stateDir,
    "app-route-freshness",
    `windows-app-${safeAgentLabel(agent)}.lock.json`,
  );
}

function parseEvidenceFiles(value: string | boolean | undefined): string[] {
  if (typeof value !== "string") return [];
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => path.resolve(item));
}

function parseOptions(args: string[]): ParsedOptions | CommandResult {
  const parsed = parseArgs(args);
  const surface = parseSurface(parsed.flags.surface);
  if (!surface.ok) return invalid(surface.message);
  const agent = stringFlag(parsed.flags.agent, "agent-a", "--agent");
  if (!agent.ok) return invalid(agent.message);
  const freshMinutes = positiveIntegerFlag(
    parsed.flags["fresh-minutes"],
    30,
    "--fresh-minutes",
  );
  if (!freshMinutes.ok) return invalid(freshMinutes.message);
  const scanInbox = positiveIntegerFlag(
    parsed.flags["scan-inbox"],
    20,
    "--scan-inbox",
  );
  if (!scanInbox.ok) return invalid(scanInbox.message);

  const repoRoot = findRepoRoot();
  const stateDir = resolveStateDir(parsed.flags["state-dir"], repoRoot);
  if (!stateDir.ok) return invalid(stateDir.message);
  const profilePackPath =
    typeof parsed.flags["profile-pack"] === "string"
      ? parsed.flags["profile-pack"].trim()
      : null;
  if (parsed.flags["profile-pack"] === true || profilePackPath === "") {
    return invalid("Missing --profile-pack <path> value.");
  }
  let profilePackProfiles: ProfileConfig[] = [];
  if (profilePackPath) {
    try {
      profilePackProfiles = statusProfilesFromProfilePack(profilePackPath);
    } catch (error) {
      return invalid(error instanceof Error ? error.message : String(error));
    }
  }
  const commsDir = path.resolve(
    str(parsed.flags.central) ?? resolveCommsDir(args, repoRoot),
  );
  const evidenceFiles = parseEvidenceFiles(parsed.flags["evidence-file"]);
  const includeProfilePack =
    parsed.flags["include-profile-pack"] === true || Boolean(profilePackPath);
  const agents =
    parsed.flags["all-known"] === true
      ? knownAgents(commsDir, {
          fallbackAgent: agent.value,
          includeProfilePack,
          profilePackProfiles,
          stateDir: stateDir.value,
        })
      : [agent.value];

  return {
    agents,
    allKnown: parsed.flags["all-known"] === true,
    surface: surface.value,
    planSend: parsed.flags["plan-send"] === true,
    expectedRecipient: str(parsed.flags["expected-recipient"]),
    expectedSurface: str(parsed.flags["expected-surface"]),
    freshMinutes: freshMinutes.value,
    scanInbox: scanInbox.value,
    commsDir,
    stateDir: stateDir.value,
    evidenceFiles,
    appProofFlags: collectAppProofFlags(parsed.flags),
    includeProfilePack,
    profilePackPath,
    profilePackProfiles,
  };
}

function knownAgents(
  commsDir: string,
  options: {
    fallbackAgent: string;
    includeProfilePack: boolean;
    profilePackProfiles: ProfileConfig[];
    stateDir: string;
  },
): string[] {
  const fromProfiles = options.includeProfilePack
    ? [
        ...Object.values(AGENT_PROFILES).map((profile) => profile.agent),
        ...options.profilePackProfiles.map((profile) => profile.agent),
      ]
    : [];
  const fromState = knownAgentsFromState(options.stateDir);
  const fromPresence = knownAgentsFromPresence(commsDir);
  const known = unique([...fromState, ...fromPresence, ...fromProfiles]);
  return known.length > 0 ? known : [options.fallbackAgent];
}

function knownAgentsFromState(stateDir: string): string[] {
  const state = readJsonFile(path.join(stateDir, "state.json"));
  const instances = rec(state?.instances);
  if (!instances) return [];
  const agents: string[] = [];
  for (const [instanceId, value] of Object.entries(instances)) {
    const instance = rec(value);
    if (!instance || instance.installed === false) continue;
    agents.push(
      str(instance.defaultAgentName) ?? str(instance.agentName) ?? instanceId,
    );
  }
  return agents;
}

function knownAgentsFromPresence(commsDir: string): string[] {
  const presenceDir = path.join(commsDir, "presence");
  if (!fs.existsSync(presenceDir)) return [];
  return fs
    .readdirSync(presenceDir)
    .filter((file) => file.endsWith(".json"))
    .map((file) => {
      const fallback = file.slice(0, -".json".length);
      const record = readJsonFile(path.join(presenceDir, file));
      const address = rec(record?.address);
      return str(record?.agent) ?? str(address?.routingAddress) ?? fallback;
    });
}

function routeTuple(
  record: Record<string, unknown> | null,
): PresenceSummary["route"] {
  const address = rec(record?.address);
  const capabilities = rec(record?.capabilities);
  const hostId = str(address?.hostId);
  const conversationId =
    str(address?.conversationId) ??
    str(capabilities?.conversationId) ??
    str(record?.conversationId);
  const ownerClientId =
    str(address?.ownerClientId) ??
    str(capabilities?.ownerClientId) ??
    str(record?.ownerClientId);
  return {
    hostId,
    conversationId,
    ownerClientId,
    complete: Boolean(hostId && conversationId && ownerClientId),
  };
}

function routeLeaseFilename(agent: string): string {
  return agent
    .trim()
    .replace(/-/g, "_")
    .toLowerCase()
    .replace(/[/\\:]/g, "_");
}

function routeLeaseLegacyFilename(agent: string): string {
  return agent.replace(/[/\\:]/g, "_");
}

function routeLeaseCandidatePaths(commsDir: string, agent: string): string[] {
  const leaseDir = path.join(commsDir, "route-leases");
  const filenames = unique([
    routeLeaseFilename(agent),
    routeLeaseLegacyFilename(agent),
  ]);
  return filenames.map((filename) => path.join(leaseDir, `${filename}.json`));
}

function routeLeaseFilePath(commsDir: string, agent: string): string {
  const filename = routeLeaseFilename(agent);
  return path.join(commsDir, "route-leases", `${filename}.json`);
}

function routeLeaseSummary(commsDir: string, agent: string): RouteLeaseSummary {
  const fallbackPath = routeLeaseFilePath(commsDir, agent);
  let leasePath = fallbackPath;
  let record: Record<string, unknown> | null = null;
  for (const candidatePath of routeLeaseCandidatePaths(commsDir, agent)) {
    const candidate = readJsonFile(candidatePath);
    if (!candidate) continue;
    leasePath = candidatePath;
    record = candidate;
    break;
  }
  const updatedAt = str(record?.updatedAt);
  const expiresAt = str(record?.expiresAt);
  const ageSeconds = timestampAgeSeconds(updatedAt);
  const expiresTime = expiresAt ? Date.parse(expiresAt) : NaN;
  const active = Boolean(
    record &&
      Number.isFinite(expiresTime) &&
      expiresTime > Date.now() &&
      bool(record?.liveAuthority) === false,
  );
  const routeRecord = rec(record?.route);
  const capability = rec(record?.capability);
  const hostId = str(routeRecord?.hostId);
  const conversationId =
    str(routeRecord?.conversationId) ?? str(capability?.conversationId);
  const ownerClientId =
    str(routeRecord?.ownerClientId) ?? str(capability?.ownerClientId);
  const route = {
    hostId,
    conversationId,
    ownerClientId,
    complete: Boolean(hostId && conversationId && ownerClientId),
  };
  return {
    path: leasePath,
    exists: Boolean(record),
    active,
    ageSeconds,
    expiresAt,
    updatedAt,
    source: str(record?.source),
    liveAuthority: bool(record?.liveAuthority),
    receiveTransports: unique(stringArray(record?.receiveTransports)),
    route,
    message: record
      ? active
        ? "Stable route registration exists, but it is not live delivery authority."
        : "Route registration exists but is expired or not eligible for routing."
      : "No route registration lease was found for this agent.",
  };
}

function presenceSummary(
  commsDir: string,
  agent: string,
  freshMinutes: number,
): PresenceSummary {
  const presence = resolvePresenceRecord(commsDir, agent);
  const record = presence.record;
  const timestamp = str(record?.timestamp) ?? str(record?.lastActivity);
  const ageSeconds = timestamp
    ? Math.max(0, (Date.now() - Date.parse(timestamp)) / 1000)
    : null;
  const fresh =
    ageSeconds !== null &&
    Number.isFinite(ageSeconds) &&
    ageSeconds <= freshMinutes * 60;
  const capabilities = rec(record?.capabilities);
  const receiveTransports = unique([
    ...stringArray(record?.receiveTransports),
    ...stringArray(capabilities?.receiveTransports),
  ]);
  return {
    path: presence.path,
    requestedPath: presence.requestedPath,
    matchedBy: presence.matchedBy,
    exists: Boolean(record),
    fresh,
    ageSeconds,
    freshness:
      str(record?.presenceFreshness) ??
      (record ? (fresh ? "fresh-for-routing" : "stale-visible") : "missing"),
    receiveTransports,
    route: routeTuple(record),
  };
}

function surfaceFromProfile(profile: ProfileConfig): SurfaceReport {
  if (profile.kind === "remote-panel") {
    return {
      id: profile.id,
      agent: profile.agent,
      label: profile.label,
      kind: "remote-panel",
      recommendedTransport: "read-only remote panel",
      liveDelivery: false,
      durableEvidence: true,
      fallbackEvidence: false,
      readiness: "inspect-required",
      summary:
        "Remote panel visibility is not a live message delivery or turn promotion path.",
      routeTuple: null,
      routeFreshness: null,
      dryRunProof: null,
      receiverPromoter: {
        host: profile.host,
        port: profile.port,
        readOnly: profile.readOnly,
        sendEnabled: profile.sendEnabled,
      },
      evidenceBoundary:
        "Remote panel can expose durable state, but it does not prove App consent-drive or CLI receiver delivery.",
      nextAction: `tap infra status --profile ${profile.id} --json`,
    };
  }

  return {
    id: profile.id,
    agent: profile.agent,
    label: profile.label,
    kind: "codex-cli",
    recommendedTransport: "target inbox/projection plus receiver/promoter",
    liveDelivery: true,
    durableEvidence: true,
    fallbackEvidence: false,
    readiness: "inspect-required",
    summary:
      "CLI/TUI delivery uses local inbox evidence first, then receiver/promoter/app-server gates.",
    routeTuple: null,
    routeFreshness: null,
    dryRunProof: null,
    receiverPromoter: {
      receiverSession: profile.receiverSession,
      appServerUrl: profile.appServerUrl,
      supervisorStateName: profile.supervisorStateName,
      sshTarget: profile.sshTarget ?? null,
      flowSupervisors: profile.flowSupervisors ?? [],
    },
    evidenceBoundary:
      "Receiver/promoter readiness is separate from Codex App consent-drive readiness.",
    nextAction: `tap infra status --profile ${profile.id} --json`,
  };
}

function buildInboxSurface(
  agent: string,
  commsDir: string,
  filter: SurfaceFilter,
): SurfaceReport[] {
  const kind: SurfaceKind = "inbox-fallback";
  if (!matchesSurface(kind, filter)) return [];
  const inboxDir = path.join(commsDir, "inbox");
  const exists = fs.existsSync(inboxDir);
  return [
    {
      id: `inbox-${agent}`,
      agent,
      label: `${agent} durable inbox/evidence`,
      kind,
      recommendedTransport: "durable inbox / projection fallback",
      liveDelivery: false,
      durableEvidence: true,
      fallbackEvidence: true,
      readiness: exists ? "ready" : "blocked",
      summary: exists
        ? "Durable inbox evidence can be written, but it is not live App delivery by itself."
        : "Configured inbox directory is missing.",
      routeTuple: null,
      routeFreshness: null,
      dryRunProof: null,
      receiverPromoter: null,
      evidenceBoundary:
        "Inbox evidence is audit/fallback evidence; it does not prove a live App turn or receiver promotion occurred.",
      nextAction: exists
        ? `write durable evidence for ${agent} and separately inspect the live surface`
        : `create or repair configured comms inbox at ${inboxDir}`,
    },
  ];
}

function buildMcpChannelSurface(
  agent: string,
  presence: PresenceSummary,
  filter: SurfaceFilter,
): SurfaceReport[] {
  const kind: SurfaceKind = "mcp-channel";
  if (!matchesSurface(kind, filter)) return [];
  const hasChannel = presence.receiveTransports.includes("mcp-channel");
  if (!hasChannel && filter === "all") return [];
  const readiness: Readiness = hasChannel
    ? presence.fresh
      ? "ready"
      : "blocked"
    : "not-observed";
  return [
    {
      id: `mcp-channel-${agent}`,
      agent,
      label: `${agent} MCP/channel route`,
      kind,
      recommendedTransport: "mcp-channel",
      liveDelivery: true,
      durableEvidence: false,
      fallbackEvidence: false,
      readiness,
      summary: hasChannel
        ? "Presence advertises mcp-channel; this is distinct from App consent-drive."
        : "No fresh MCP/channel receive transport was observed for this agent.",
      routeTuple: presence.route,
      routeFreshness: {
        fresh: presence.fresh,
        ageSeconds: presence.ageSeconds,
        freshness: presence.freshness,
      },
      dryRunProof: null,
      receiverPromoter: null,
      evidenceBoundary:
        "MCP/channel transport is a live channel surface, not durable inbox evidence.",
      nextAction: hasChannel
        ? `send through the channel surface only if the active runtime is the intended target`
        : `use tap ready or runtime onboarding to publish mcp-channel presence for ${agent}`,
    },
  ];
}

function shouldCheckAppSurface(
  _agent: string,
  presence: PresenceSummary,
  routeLease: RouteLeaseSummary,
  filter: SurfaceFilter,
): boolean {
  return (
    filter === "app" ||
    filter === "windows-app" ||
    presence.receiveTransports.includes("consent-drive") ||
    routeLease.receiveTransports.includes("consent-drive")
  );
}

function proofFromAppData(data: Record<string, unknown>): RouteProof {
  const recovery = rec(data.recovery);
  const proof = rec(recovery?.proof);
  return {
    transport: str(proof?.transport) ?? "not-ready",
    liveAttemptStatus: str(proof?.liveAttemptStatus) ?? "not-attempted",
    fallbackToInbox: bool(proof?.fallbackToInbox) ?? true,
    reason: str(proof?.reason),
  };
}

function readSchedulerSnapshot(
  agent: string,
  stateDir: string,
): SchedulerFileSnapshot {
  const statePath = schedulerStatePath(stateDir, agent);
  const lockPath = schedulerLockPath(stateDir, agent);
  return {
    statePath,
    lockPath,
    state: readJsonFile(statePath),
    lockOwner: readJsonFile(lockPath),
    stateExists: fs.existsSync(statePath),
    lockExists: fs.existsSync(lockPath),
  };
}

function timestampAgeSeconds(value: unknown): number | null {
  const timestamp = str(value);
  if (!timestamp) return null;
  const parsed = Date.parse(timestamp);
  if (!Number.isFinite(parsed)) return null;
  const ageSeconds = (Date.now() - parsed) / 1000;
  return ageSeconds >= 0 ? ageSeconds : 0;
}

function schedulerWorkerFresh(snapshot: SchedulerFileSnapshot): boolean {
  const stateTimestamps = [
    timestampAgeSeconds(snapshot.state?.lastRunAt),
    timestampAgeSeconds(snapshot.state?.updatedAt),
  ].filter((age): age is number => age !== null);

  if (stateTimestamps.length > 0) {
    return stateTimestamps.some((age) => age <= DEFAULT_STALE_WORKER_SECONDS);
  }

  const lockAge = timestampAgeSeconds(snapshot.lockOwner?.startedAt);
  return lockAge !== null && lockAge <= DEFAULT_STALE_WORKER_SECONDS;
}

function appClassification(data: Record<string, unknown>): string | null {
  const recovery = rec(data.recovery);
  return str(data.classification) ?? str(recovery?.classification);
}

function appRouteHealthStatus(data: Record<string, unknown>): string | null {
  const recovery = rec(data.recovery);
  return str(recovery?.routeHealthStatus);
}

function targetLocalReady(data: Record<string, unknown>): boolean {
  const classification = appClassification(data);
  const routeHealthStatus = appRouteHealthStatus(data);
  return (
    routeHealthStatus === "fresh-route-ready" ||
    routeHealthStatus === "stale-presence" ||
    classification === "fresh-ready" ||
    classification === "refresh-soon" ||
    classification === "ttl-expired-target-ready"
  );
}

function centralTtlExpiredTargetReady(
  data: Record<string, unknown>,
  presence: PresenceSummary,
): boolean {
  return (
    targetLocalReady(data) &&
    !presence.fresh &&
    (appClassification(data) === "ttl-expired-target-ready" ||
      appRouteHealthStatus(data) === "stale-presence")
  );
}

function schedulerOperationalState(
  snapshot: SchedulerFileSnapshot,
  data: Record<string, unknown>,
  presence: PresenceSummary,
): SchedulerOperationalState {
  if (!targetLocalReady(data)) return "not-applicable";
  if (centralTtlExpiredTargetReady(data, presence)) {
    return "target-local-ready-central-ttl-expired";
  }
  if (!snapshot.stateExists) return "scheduler-state-missing";

  const worker = rec(snapshot.state?.worker);
  const workerEnabled = bool(worker?.enabled);
  const workerStatus = str(worker?.status);
  if (
    snapshot.lockExists &&
    workerEnabled === true &&
    workerStatus === "acquired"
  ) {
    return schedulerWorkerFresh(snapshot)
      ? "standing-worker-ready"
      : "scheduler-stopped";
  }
  if (workerStatus === "released" || workerStatus === "conflict") {
    return "scheduler-stopped";
  }
  return "no-standing-freshness-worker";
}

function schedulerMessage(
  state: SchedulerOperationalState,
  agent: string,
): string {
  if (state === "standing-worker-ready") {
    return "Standing app-route-freshness worker lock is present and the route should refresh before TTL expiry.";
  }
  if (state === "scheduler-state-missing") {
    return "No app-route-freshness scheduler state existed before this doctor run; a stable App route can age out without a worker-of-record.";
  }
  if (state === "scheduler-stopped") {
    return "App route freshness scheduler state exists, but the worker is stopped/released instead of standing.";
  }
  if (state === "no-standing-freshness-worker") {
    return "App route is observable, but no standing freshness worker/lease is keeping central presence fresh.";
  }
  if (state === "target-local-ready-central-ttl-expired") {
    return "Target-local IPC is ready, but configured central presence crossed TTL; this is an operational freshness failure, not a reason to lengthen TTL.";
  }
  return `No standing App freshness expectation is active for ${agent}.`;
}

function schedulerSummary(
  agent: string,
  stateDir: string,
  snapshot: SchedulerFileSnapshot,
  data: Record<string, unknown>,
  presence: PresenceSummary,
): SchedulerSummary {
  const state = snapshot.state;
  const worker = rec(state?.worker);
  const operationalState = schedulerOperationalState(snapshot, data, presence);
  return {
    statePath: snapshot.statePath,
    lockPath: snapshot.lockPath,
    stateExists: snapshot.stateExists,
    lockExists: snapshot.lockExists,
    lastRunAt: str(state?.lastRunAt),
    updatedAt: str(state?.updatedAt),
    lastStatus: str(state?.lastStatus),
    lastClassification: str(state?.lastClassification),
    lastRefreshAt: str(state?.lastRefreshAt),
    routeAgeSeconds: finiteNumber(state?.routeAgeSeconds),
    nextRefreshAt: str(state?.nextRefreshAt),
    worker: {
      enabled: bool(worker?.enabled),
      status: str(worker?.status),
      lockPath: str(worker?.lockPath),
      owner: rec(worker?.owner) ?? snapshot.lockOwner,
      message: str(worker?.message),
    },
    operationalState,
    operationalFailure:
      operationalState !== "standing-worker-ready" &&
      operationalState !== "not-applicable",
    message: `${schedulerMessage(operationalState, agent)} stateDir=${stateDir}`,
  };
}

function appReadiness(
  data: Record<string, unknown>,
  proof: RouteProof,
): Readiness {
  const classification = appClassification(data);
  const status = str(data.status);
  if (
    proof.transport === "consent-drive" &&
    proof.liveAttemptStatus === "would-attempt" &&
    proof.fallbackToInbox === false
  ) {
    return "ready";
  }
  if (
    classification === "refresh-soon" ||
    classification === "ttl-expired-target-ready"
  ) {
    return "needs-repair";
  }
  if (status === "blocked") return "blocked";
  return "not-observed";
}

function appNextAction(
  agent: string,
  readiness: Readiness,
  data: Record<string, unknown>,
  scheduler: SchedulerSummary,
): string {
  const classification = appClassification(data);
  if (scheduler.operationalState === "target-local-ready-central-ttl-expired") {
    return `tap app-route-freshness --agent ${agent} --apply --json; then run tap app-route-freshness --agent ${agent} --watch --json under supervisor`;
  }
  if (
    scheduler.operationalState === "scheduler-state-missing" ||
    scheduler.operationalState === "scheduler-stopped" ||
    scheduler.operationalState === "no-standing-freshness-worker"
  ) {
    return `start standing freshness: tap app-route-freshness --agent ${agent} --watch --json under supervisor`;
  }
  if (readiness === "ready") {
    return `use structured target delivery for ${agent}, then confirm configured SSOT inbox evidence exists`;
  }
  if (
    classification === "refresh-soon" ||
    classification === "ttl-expired-target-ready"
  ) {
    return `tap app-route-freshness --agent ${agent} --apply --json`;
  }
  if (
    classification === "target-missing-or-dead" ||
    classification === "structured-route-not-ready"
  ) {
    return `tap windows-route-recover --agent ${agent} --apply --dry-run --json`;
  }
  if (classification === "active-turn-blocked") {
    return "wait for the active App turn to finish; do not nest a live turn";
  }
  return `tap app-route-freshness --agent ${agent} --json`;
}

async function buildAppSurface(
  agent: string,
  options: ParsedOptions,
  presence: PresenceSummary,
): Promise<SurfaceReport[]> {
  const kind: SurfaceKind = "windows-app";
  const routeLease = routeLeaseSummary(options.commsDir, agent);
  if (!matchesSurface(kind, options.surface)) return [];
  if (!shouldCheckAppSurface(agent, presence, routeLease, options.surface))
    return [];
  const schedulerSnapshot = readSchedulerSnapshot(agent, options.stateDir);

  const args = [
    "--agent",
    agent,
    "--central",
    options.commsDir,
    "--fresh-minutes",
    String(options.freshMinutes),
  ];
  for (const [name, value] of Object.entries(options.appProofFlags)) {
    args.push(`--${name}`, value);
  }

  const result = appRouteFreshnessRunnerForTests
    ? await appRouteFreshnessRunnerForTests(args)
    : ((await appRouteFreshnessCommand(args)) as CommandResult<
        Record<string, unknown>
      >);
  const data = rec(result.data) ?? {};
  const proof = proofFromAppData(data);
  const readiness = appReadiness(data, proof);
  const scheduler = schedulerSummary(
    agent,
    options.stateDir,
    schedulerSnapshot,
    data,
    presence,
  );
  return [
    {
      id: `windows-app-${agent}`,
      agent,
      label: `${agent} Codex App / Windows App consent-drive`,
      kind,
      recommendedTransport: "structured target consent-drive",
      liveDelivery: true,
      durableEvidence: false,
      fallbackEvidence: false,
      readiness,
      summary: `App route classification=${str(data.classification) ?? "unknown"} status=${str(data.status) ?? "unknown"}${!presence.fresh && routeLease.active ? "; routeLease=active(non-live-authority)" : ""}`,
      routeTuple: presence.route,
      routeFreshness: {
        fresh: presence.fresh,
        ageSeconds: presence.ageSeconds,
        freshness: presence.freshness,
      },
      routeLease,
      scheduler,
      dryRunProof: proof,
      receiverPromoter: null,
      evidenceBoundary:
        "Consent-drive proof is live-readiness evidence only; durable inbox evidence must be checked separately.",
      nextAction: appNextAction(agent, readiness, data, scheduler),
    },
  ];
}

function profileSurfaces(
  agent: string,
  filter: SurfaceFilter,
  profilePackProfiles: ProfileConfig[],
): SurfaceReport[] {
  return [...Object.values(AGENT_PROFILES), ...profilePackProfiles]
    .filter((profile) => profile.agent === agent)
    .map((profile) => surfaceFromProfile(profile))
    .filter((surface) => matchesSurface(surface.kind, filter));
}

function parseFrontmatter(content: string): Record<string, string> {
  if (!content.startsWith("---")) return {};
  const end = content.indexOf("\n---", 3);
  if (end === -1) return {};
  const block = content.slice(3, end).trim();
  const fields: Record<string, string> = {};
  for (const line of block.split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!match) continue;
    fields[match[1]] = match[2].trim().replace(/^["']|["']$/g, "");
  }
  return fields;
}

function isSubpath(filePath: string, dirPath: string): boolean {
  const relative = path.relative(path.resolve(dirPath), path.resolve(filePath));
  return (
    Boolean(relative) &&
    !relative.startsWith("..") &&
    !path.isAbsolute(relative)
  );
}

function evidenceRecord(
  filePath: string,
  commsDir: string,
): EvidenceRecord | null {
  try {
    const content = fs.readFileSync(filePath, "utf8");
    const fields = parseFrontmatter(content);
    const inboxDir = path.join(commsDir, "inbox");
    return {
      path: filePath,
      inConfiguredInbox: isSubpath(filePath, inboxDir),
      from: str(fields.from),
      to: str(fields.to),
      subject: str(fields.subject),
      scope: str(fields.scope),
      action: str(fields.action),
      consentRef: str(fields.consentRef),
      transport: str(fields.transport),
      liveAttemptStatus: str(fields.liveAttemptStatus),
      fallbackToInbox: bool(fields.fallbackToInbox),
      inboxEvidence: bool(fields.inboxEvidence),
      inboxPath: str(fields.inboxPath),
      durableEvidence: bool(fields.durableEvidence),
    };
  } catch {
    return null;
  }
}

function recentInboxFiles(commsDir: string, limit: number): string[] {
  const inboxDir = path.join(commsDir, "inbox");
  if (limit <= 0 || !fs.existsSync(inboxDir)) return [];
  return fs
    .readdirSync(inboxDir)
    .filter((file) => file.endsWith(".md"))
    .map((file) => path.join(inboxDir, file))
    .map((filePath) => ({
      filePath,
      mtime: fs.statSync(filePath).mtimeMs,
    }))
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, limit)
    .map((item) => item.filePath);
}

function readEvidence(options: ParsedOptions): EvidenceRecord[] {
  const files =
    options.evidenceFiles.length > 0
      ? options.evidenceFiles
      : recentInboxFiles(options.commsDir, options.scanInbox);
  return files
    .map((file) => evidenceRecord(file, options.commsDir))
    .filter((record): record is EvidenceRecord => Boolean(record));
}

function hasDurableInboxEvidence(record: EvidenceRecord): boolean {
  return (
    record.inConfiguredInbox ||
    record.inboxEvidence === true ||
    record.durableEvidence === true ||
    Boolean(record.inboxPath)
  );
}

function isActualLiveAttempt(record: EvidenceRecord): boolean {
  return (
    record.transport === "consent-drive" &&
    record.liveAttemptStatus !== null &&
    record.liveAttemptStatus !== "would-attempt" &&
    record.liveAttemptStatus !== "not-attempted" &&
    record.fallbackToInbox === false
  );
}

function analyzeEvidence(
  records: EvidenceRecord[],
  options: ParsedOptions,
): EvidenceGap[] {
  const gaps: EvidenceGap[] = [];
  for (const record of records) {
    if (
      record.scope === "observe" ||
      record.scope === "suggest" ||
      record.scope === "drive"
    ) {
      gaps.push({
        id: "envelope-scope-not-live",
        severity: "info",
        evidencePath: record.path,
        message: `scope=${record.scope} is envelope/audit metadata; it is not the normal automatic live-drive path.`,
        nextAction:
          "Use a normal structured target send without explicit scope/action/consentRef when live App delivery is intended.",
      });
    }
    if (
      options.expectedRecipient &&
      record.to &&
      record.to !== options.expectedRecipient
    ) {
      gaps.push({
        id: "wrong-expected-recipient",
        severity: "warn",
        evidencePath: record.path,
        message: `message is addressed to ${record.to}, but expected live recipient was ${options.expectedRecipient}.`,
        nextAction:
          "Retarget the live surface explicitly; do not assume observe evidence for one agent appears live for another.",
      });
    }
    if (
      options.expectedSurface === "app" &&
      (record.scope === "observe" || record.scope === "suggest")
    ) {
      gaps.push({
        id: "expected-app-live-but-envelope-evidence",
        severity: "warn",
        evidencePath: record.path,
        message:
          "operator expected App live visibility, but the record is an envelope/evidence path.",
        nextAction:
          "Run tap comms-doctor with an App surface proof, then send a structured target if proof is ready.",
      });
    }
    if (isActualLiveAttempt(record) && !hasDurableInboxEvidence(record)) {
      gaps.push({
        id: "missing-durable-evidence-after-live-attempt",
        severity: "fail",
        evidencePath: record.path,
        message:
          "consent-drive live attempt is recorded, but no configured SSOT inbox evidence is visible in the record.",
        nextAction:
          "Leave or recover durable inbox evidence; live App delivery alone is not enough operator evidence.",
      });
    }
    if (
      record.inConfiguredInbox &&
      !record.transport &&
      !record.liveAttemptStatus
    ) {
      gaps.push({
        id: "durable-inbox-only-not-live",
        severity: "info",
        evidencePath: record.path,
        message:
          "durable inbox evidence exists, but no live transport attempt is recorded.",
        nextAction:
          "Inspect the target live surface separately if realtime delivery was expected.",
      });
    }
    if (record.fallbackToInbox === true) {
      gaps.push({
        id: "fallback-to-inbox-not-live",
        severity: "info",
        evidencePath: record.path,
        message:
          "fallbackToInbox=true means this record should not be treated as live App delivery.",
        nextAction:
          "Repair or refresh the live route before relying on App delivery.",
      });
    }
  }
  return gaps;
}

function analyzeSurfaceOperations(surfaces: SurfaceReport[]): EvidenceGap[] {
  const gaps: EvidenceGap[] = [];
  for (const surface of surfaces) {
    if (
      surface.kind === "windows-app" &&
      surface.routeLease?.active &&
      surface.routeFreshness &&
      !surface.routeFreshness.fresh
    ) {
      gaps.push({
        id: "presence-expired-route-lease-active",
        severity: "warn",
        evidencePath: surface.routeLease.path,
        message: `${surface.agent}/${surface.kind}: stable route lease exists, but central presence is ${surface.routeFreshness.freshness ?? "not fresh"}; refresh runtime health before live delivery.`,
        nextAction: `tap app-route-freshness --agent ${surface.agent} --apply --json; keep tap app-route-freshness --agent ${surface.agent} --watch --json under supervisor`,
      });
    }
    const scheduler = surface.scheduler;
    if (!scheduler?.operationalFailure) continue;
    gaps.push({
      id: scheduler.operationalState,
      severity:
        scheduler.operationalState === "target-local-ready-central-ttl-expired"
          ? "fail"
          : "warn",
      evidencePath: scheduler.stateExists ? scheduler.statePath : null,
      message: `${surface.agent}/${surface.kind}: ${scheduler.message}`,
      nextAction: surface.nextAction,
    });
  }
  return gaps;
}

function sendPlanForSurfaces(
  surfaces: SurfaceReport[],
): CommsDoctorReport["sendPlan"] {
  const plan: CommsDoctorReport["sendPlan"] = [];
  for (const surface of surfaces) {
    if (
      surface.readiness !== "ready" &&
      surface.readiness !== "inspect-required"
    ) {
      continue;
    }
    if (surface.kind === "windows-app" && surface.readiness === "ready") {
      plan.push({
        agent: surface.agent,
        surface: surface.kind,
        command: `tap_reply({ target: { routingAddress: "${surface.agent}", conversationId, ownerClientId, hostId }, ... }) plus durable inbox evidence`,
        reason:
          "App proof says consent-drive would-attempt and fallbackToInbox=false.",
      });
    }
    if (surface.kind === "codex-cli") {
      plan.push({
        agent: surface.agent,
        surface: surface.kind,
        command: `tap infra status --profile ${surface.id} --json`,
        reason:
          "CLI/TUI route needs receiver/promoter/app-server inspection before assuming a live turn.",
      });
    }
    if (surface.kind === "inbox-fallback") {
      plan.push({
        agent: surface.agent,
        surface: surface.kind,
        command: `write configured SSOT inbox evidence for ${surface.agent}`,
        reason: "Inbox evidence is durable fallback/audit, not live delivery.",
      });
    }
  }
  return plan;
}

async function buildSurfacesForAgent(
  agent: string,
  options: ParsedOptions,
): Promise<SurfaceReport[]> {
  const presence = presenceSummary(
    options.commsDir,
    agent,
    options.freshMinutes,
  );
  const profileSurfaceReports = options.includeProfilePack
    ? profileSurfaces(agent, options.surface, options.profilePackProfiles)
    : [];
  const surfaces = [
    ...profileSurfaceReports,
    ...buildMcpChannelSurface(agent, presence, options.surface),
    ...(await buildAppSurface(agent, options, presence)),
    ...buildInboxSurface(agent, options.commsDir, options.surface),
  ];
  return surfaces;
}

function reportStatus(
  surfaces: SurfaceReport[],
  gaps: EvidenceGap[],
): CommsDoctorReport["status"] {
  if (gaps.some((gap) => gap.severity === "warn" || gap.severity === "fail")) {
    return "needs-attention";
  }
  if (
    surfaces.some(
      (surface) =>
        surface.readiness === "blocked" || surface.readiness === "needs-repair",
    )
  ) {
    return "needs-attention";
  }
  return "ready";
}

function logReport(report: CommsDoctorReport): void {
  logHeader("tap comms-doctor");
  log(`Status: ${report.status}`);
  for (const surface of report.surfaces) {
    log(
      `${surface.readiness.padEnd(16)} ${surface.agent}/${surface.kind}: ${surface.summary}`,
    );
    if (surface.dryRunProof) {
      log(
        `  proof: transport=${surface.dryRunProof.transport} liveAttemptStatus=${surface.dryRunProof.liveAttemptStatus} fallbackToInbox=${surface.dryRunProof.fallbackToInbox}`,
      );
    }
    if (surface.scheduler) {
      log(
        `  scheduler: operationalState=${surface.scheduler.operationalState} lockExists=${surface.scheduler.lockExists} stateExists=${surface.scheduler.stateExists}`,
      );
    }
  }
  for (const gap of report.gaps.slice(0, 6)) {
    log(`${gap.severity} ${gap.id}: ${gap.message}`);
  }
}

export async function commsDoctorCommand(
  args: string[],
): Promise<CommandResult<CommsDoctorReport>> {
  if (args.includes("--help") || args.includes("-h")) {
    log(HELP);
    return {
      ok: true,
      command: "comms-doctor",
      code: "TAP_NO_OP",
      message: HELP,
      warnings: [],
      data: {} as CommsDoctorReport,
    };
  }

  const parsed = parseOptions(args);
  if ("ok" in parsed) return parsed as CommandResult<CommsDoctorReport>;
  const surfaces = (
    await Promise.all(
      parsed.agents.map((agent) => buildSurfacesForAgent(agent, parsed)),
    )
  ).flat();
  const evidence = readEvidence(parsed);
  const gaps = [
    ...analyzeEvidence(evidence, parsed),
    ...analyzeSurfaceOperations(surfaces),
  ];
  const report: CommsDoctorReport = {
    generatedAt: new Date().toISOString(),
    status: reportStatus(surfaces, gaps),
    targets: parsed.agents.map((agent) => ({
      agent,
      expectedRecipient: parsed.expectedRecipient,
      expectedSurface: parsed.expectedSurface,
    })),
    surfaces,
    evidence,
    gaps,
    sendPlan: parsed.planSend ? sendPlanForSurfaces(surfaces) : [],
    notes: [
      "Surface-first rule: choose delivery by runtime surface, not display name alone.",
      "Receiver/promoter is the portable CLI/TUI/headless backbone; active turns must surface queued/blocked evidence instead of default steer.",
      "Consent-drive / Codex App IPC is an experimental live adapter and must stay strict-gated by fresh route and runtime health evidence.",
      "Inbox evidence and live delivery are separate evidence layers.",
      "Observe/suggest/drive metadata is envelope/audit context unless a separate live route proves delivery.",
    ],
  };
  logReport(report);
  return {
    ok: true,
    command: "comms-doctor",
    code: "TAP_COMMS_DOCTOR_OK",
    message: `tap comms-doctor: ${report.status}`,
    warnings: gaps
      .filter((gap) => gap.severity === "warn" || gap.severity === "fail")
      .map((gap) => `${gap.id}: ${gap.message}`),
    data: report,
  };
}
