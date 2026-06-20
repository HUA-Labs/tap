/**
 * tap-comms shared utilities: types, config, parsing, helpers.
 */
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "fs";
import { createHash, randomUUID } from "crypto";
import { basename, dirname, join, resolve } from "path";
import {
  canonicalizeAgentId as canonicalizeIdentityId,
  isBroadcastRecipient,
  isPlaceholderAgentValue,
  sameRoutingAddress,
} from "./tap-identity.js";
import {
  inferReceiveTransports,
  type TapReceiveTransport,
} from "../../../src/routing/receive-transports.js";

// ── Config ──────────────────────────────────────────────────────────────

const RAW_COMMS_DIR = process.env.TAP_COMMS_DIR;
if (!RAW_COMMS_DIR) {
  console.error(
    "[tap-comms] FATAL: TAP_COMMS_DIR not set. Set via env or .tap-config",
  );
  process.exit(1);
}

export const COMMS_DIR = resolve(RAW_COMMS_DIR);
export const INBOX_DIR = join(COMMS_DIR, "inbox");
export const REVIEWS_DIR = join(COMMS_DIR, "reviews");
export const FINDINGS_DIR = join(COMMS_DIR, "findings");
export const RECEIPTS_DIR = join(COMMS_DIR, "receipts");
export const RECEIPTS_PATH = join(RECEIPTS_DIR, "receipts.json");
export const RECEIPTS_LOCK = join(RECEIPTS_DIR, ".lock");
export const HEARTBEATS_PATH = join(COMMS_DIR, "heartbeats.json");
export const HEARTBEATS_LOCK = join(COMMS_DIR, ".heartbeats.lock");
/** M334: Per-agent presence files for cross-device visibility. */
export const PRESENCE_DIR = join(COMMS_DIR, "presence");
/** M554: Longer-lived route registrations created by warmup/capability registration. */
export const ROUTE_LEASES_DIR = join(COMMS_DIR, "route-leases");
export const ARCHIVE_DIR = join(COMMS_DIR, "archive");
export const DB_PATH = join(COMMS_DIR, "tap.db");
export const SERVER_START = Date.now();

// ── Agent Identity ──────────────────────────────────────────────────────
// id = immutable routing key (set once at startup or first tap_set_name)
// name = session display label. Once a real name is confirmed, only
// idempotent tap_set_name calls are allowed until an explicit reset flow exists.

export type TapBootstrapInstance = {
  runtime?: string;
  installed?: boolean;
  /** M310: Canonical bootstrap name. Falls back to agentName for pre-M310 state. */
  defaultAgentName?: string | null;
  /** @deprecated Use defaultAgentName. */
  agentName?: string | null;
  bridgeMode?: string;
};

function isConcreteIdentity(value: string | undefined): value is string {
  return !isPlaceholderAgentValue(value);
}

function normalizeAgentId(value: string): string {
  return canonicalizeIdentityId(value);
}

export function loadStateInstances(): Record<
  string,
  TapBootstrapInstance
> | null {
  const stateDir = process.env.TAP_STATE_DIR;
  if (!stateDir) return null;
  try {
    const statePath = join(stateDir, "state.json");
    if (!existsSync(statePath)) return null;
    const state = JSON.parse(readFileSync(statePath, "utf-8")) as {
      instances?: Record<string, TapBootstrapInstance>;
    };
    return state.instances ?? null;
  } catch {
    return null;
  }
}

type StateBootstrapIdentity = {
  agentId: string;
  agentName: string | null;
};

const BRIDGE_RUNTIME_STATE_DIR_PREFIX = "codex-app-server-bridge-";
type TapRuntimeKind = "claude" | "codex";
export type TapRoutingSlot = "tower" | "reviewer" | `wt-${number}`;
export const TAP_ROUTING_SLOTS = [
  "tower",
  "wt-1",
  "wt-2",
  "reviewer",
] as const satisfies readonly TapRoutingSlot[];

export type TapAddressMetadata = {
  hostId: string | null;
  clientId: string | null;
  conversationId: string | null;
  ownerClientId: string | null;
  routingAddress: string;
  slot: TapRoutingSlot | null;
  aliases: string[];
};

export type AgentIdentitySnapshot = {
  agentId: string;
  agentName: string;
  idLocked: boolean;
  nameConfirmed: boolean;
  address: TapAddressMetadata;
  runtimeEnv: {
    routingSlot: TapRoutingSlot | null;
    instanceId: string | null;
    bridgeInstanceId: string | null;
    agentId: string | null;
    agentName: string | null;
    codexTapAgentName: string | null;
    commsDir: string | null;
    stateDir: string | null;
    runtimeStateDir: string | null;
    repoRoot: string | null;
  };
  bootstrap: StateBootstrapIdentity | null;
  resolvedCurrentInstanceId: string | null;
  resolvedRoutingSlot: TapRoutingSlot | null;
  resolvedRoutingAddress: string;
  resolvedRoutingAliases: string[];
};

export type RoutingRuntimeConflict = {
  pid: number;
  runtimeKey: string;
  agentId: string;
  agentName: string;
  updatedAt: string;
  stateDir: string | null;
  runtimeStateDir: string | null;
  repoRoot: string | null;
  aliases: string[];
};

export type AgentIdentityProbeSnapshot = AgentIdentitySnapshot & {
  bootstrapDrift: {
    envAgentName: string | null;
    envAgentNameIsPlaceholder: boolean;
    runtimeAgentName: string;
    differsFromRuntime: boolean;
  };
  runtimeCoordination: {
    runtimeKey: string | null;
    conflictingRuntimes: RoutingRuntimeConflict[];
  };
  dryRun?: {
    testName: string;
    matches: boolean;
  };
};

export function normalizeRoutingSlot(
  value: string | null | undefined,
): TapRoutingSlot | null {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === "tower") return "tower";
  if (normalized === "reviewer") return "reviewer";
  const worktreeMatch = normalized.match(/^wt[-_]?(\d+)$/);
  if (worktreeMatch) {
    return `wt-${Number.parseInt(worktreeMatch[1], 10)}` as TapRoutingSlot;
  }
  return null;
}

export function deriveRoutingSlotFromInstanceId(
  instanceId: string | null | undefined,
): TapRoutingSlot | null {
  const normalized = normalizeAgentId(instanceId ?? "");
  if (!normalized) return null;

  if (
    normalized === "tower" ||
    normalized === "claude_main" ||
    normalized === "codex_main"
  ) {
    return "tower";
  }
  if (
    normalized === "reviewer" ||
    normalized === "claude_reviewer" ||
    normalized === "codex_reviewer"
  ) {
    return "reviewer";
  }
  const worktreeMatch = normalized.match(/^(?:(?:claude|codex)_)?wt_?(\d+)$/);
  if (worktreeMatch) {
    return `wt-${Number.parseInt(worktreeMatch[1], 10)}` as TapRoutingSlot;
  }
  return null;
}

function resolveRepoRootRoutingSlot(
  repoRoot: string | null | undefined = process.env.TAP_REPO_ROOT,
): TapRoutingSlot | null {
  if (!repoRoot?.trim()) return null;
  return normalizeRoutingSlot(basename(resolve(repoRoot)));
}

function resolveRoutingAliases(
  values: Array<string | null | undefined>,
): string[] {
  const aliases: string[] = [];
  for (const value of values) {
    const normalized = value?.trim();
    if (!normalized) continue;
    if (
      aliases.some(
        (alias) =>
          alias === normalized || sameRoutingAddress(alias, normalized),
      )
    ) {
      continue;
    }
    aliases.push(normalized);
  }
  return aliases;
}

function matchesRoutingAliases(
  value: string,
  aliases: string[],
  includeBroadcast = false,
): boolean {
  const normalized = value.trim();
  if (!normalized) return false;
  if (includeBroadcast && isBroadcastRecipient(normalized)) {
    return true;
  }

  return aliases.some(
    (alias) => alias === normalized || sameRoutingAddress(alias, normalized),
  );
}

const GENERIC_RUNTIME_RECIPIENTS = new Set([
  "codex",
  "reviewer",
  "implementer",
  "implementation",
]);

function isGenericRuntimeRecipient(value: string | null | undefined): boolean {
  if (!value?.trim()) return false;
  return GENERIC_RUNTIME_RECIPIENTS.has(normalizeAgentId(value));
}

function parseAddressAliases(value: string | undefined): string[] {
  if (!value?.trim()) return [];
  try {
    const parsed = JSON.parse(value) as {
      aliases?: unknown;
      routingAddress?: unknown;
    };
    const aliases = Array.isArray(parsed.aliases)
      ? parsed.aliases.filter(
          (alias): alias is string => typeof alias === "string",
        )
      : [];
    if (typeof parsed.routingAddress === "string") {
      aliases.push(parsed.routingAddress);
    }
    return aliases.map((alias) => alias.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function structuredRecipientHints(frontmatter: ParsedFrontmatter): string[] {
  const hints = [
    frontmatter.to_name,
    ...parseAddressAliases(frontmatter.to_address),
  ].filter((value): value is string => Boolean(value?.trim()));
  const concrete: string[] = [];
  for (const hint of hints) {
    if (isGenericRuntimeRecipient(hint)) continue;
    if (
      concrete.some(
        (value) => normalizeAgentId(value) === normalizeAgentId(hint),
      )
    ) {
      continue;
    }
    concrete.push(hint);
  }
  return concrete;
}

export function isInboxFrontmatterForCurrentAgent(
  frontmatter: ParsedFrontmatter,
): boolean {
  const concreteHints = structuredRecipientHints(frontmatter);
  if (concreteHints.length > 0) {
    const aliases = getAgentRoutingAliases();
    if (concreteHints.some((hint) => matchesRoutingAliases(hint, aliases))) {
      return true;
    }
    if (isGenericRuntimeRecipient(frontmatter.to)) {
      return false;
    }
  }
  return isForMe(frontmatter.to);
}

function resolveRuntimeKind(
  instanceId: string | null | undefined,
): TapRuntimeKind | null {
  if (!instanceId) return null;
  const normalizedId = normalizeAgentId(instanceId);
  if (normalizedId === "claude" || normalizedId.startsWith("claude_")) {
    return "claude";
  }
  if (normalizedId === "codex" || normalizedId.startsWith("codex_")) {
    return "codex";
  }
  return null;
}

function hasCodexRuntimeStateDir(): boolean {
  const runtimeStateDir = resolveRuntimeStateDir();
  if (!runtimeStateDir) return false;
  return basename(runtimeStateDir).startsWith(BRIDGE_RUNTIME_STATE_DIR_PREFIX);
}

function hasCodexRuntimeSignal(): boolean {
  return (
    isConcreteIdentity(process.env.TAP_BRIDGE_INSTANCE_ID) ||
    isConcreteIdentity(process.env.CODEX_TAP_AGENT_NAME) ||
    hasCodexRuntimeStateDir()
  );
}

function resolveSingleCodexBootstrap(): StateBootstrapIdentity | null {
  // M308: Claude Code instances have their own TAP_INSTANCE_ID — skip Codex bootstrap
  // to prevent inheriting a Codex agent's identity.
  if (isConcreteIdentity(process.env.TAP_INSTANCE_ID)) return null;
  // M318: Only bootstrap Codex identity when the current runtime positively
  // identifies itself as a Codex bridge/attach session.
  if (!hasCodexRuntimeSignal()) return null;

  const instances = loadStateInstances();
  if (!instances) return null;

  const installedCodexInstances = Object.entries(instances).filter(
    ([, instance]) => instance?.runtime === "codex" && instance?.installed,
  );
  if (installedCodexInstances.length !== 1) return null;

  const [instanceId, instance] = installedCodexInstances[0];
  // M310: Read defaultAgentName first, fall back to agentName for backward compat
  const stateAgentName = instance.defaultAgentName ?? instance.agentName;
  return {
    agentId: normalizeAgentId(instanceId),
    agentName:
      typeof stateAgentName === "string" &&
      !isPlaceholderAgentValue(stateAgentName)
        ? stateAgentName
        : null,
  };
}

function resolveRuntimeInstanceId(): string | null {
  // TAP_INSTANCE_ID: explicit per-worktree instance separation (M294)
  const instanceId = process.env.TAP_INSTANCE_ID;
  if (isConcreteIdentity(instanceId)) {
    return normalizeAgentId(instanceId);
  }
  const bridgeInstanceId = process.env.TAP_BRIDGE_INSTANCE_ID;
  if (isConcreteIdentity(bridgeInstanceId)) {
    return normalizeAgentId(bridgeInstanceId);
  }
  const envId = process.env.TAP_AGENT_ID;
  if (isConcreteIdentity(envId)) {
    return normalizeAgentId(envId);
  }
  return null;
}

function resolveRuntimeStateDir(): string | null {
  const runtimeStateDir = process.env.TAP_RUNTIME_STATE_DIR;
  if (!runtimeStateDir) return null;
  return resolve(runtimeStateDir);
}

function resolveRuntimeStateInstanceId(): string | null {
  const runtimeStateDir = resolveRuntimeStateDir();
  if (!runtimeStateDir) return null;

  const dirName = basename(runtimeStateDir);
  if (!dirName.startsWith(BRIDGE_RUNTIME_STATE_DIR_PREFIX)) {
    return null;
  }

  const instanceId = dirName
    .slice(BRIDGE_RUNTIME_STATE_DIR_PREFIX.length)
    .trim();
  if (!instanceId) return null;
  return normalizeAgentId(instanceId);
}

function resolveRuntimeStateDisplayName(): string | null {
  const runtimeStateDir = resolveRuntimeStateDir();
  if (!runtimeStateDir) return null;

  try {
    const heartbeatPath = join(runtimeStateDir, "heartbeat.json");
    if (existsSync(heartbeatPath)) {
      const heartbeat = JSON.parse(readFileSync(heartbeatPath, "utf-8")) as {
        agent?: string | null;
      };
      const heartbeatAgent = heartbeat.agent ?? undefined;
      if (isConcreteIdentity(heartbeatAgent)) {
        return heartbeatAgent;
      }
    }
  } catch {
    // Fall through to the persisted agent-name hint below.
  }

  try {
    const agentNamePath = join(runtimeStateDir, "agent-name.txt");
    if (!existsSync(agentNamePath)) return null;
    const agentName = readFileSync(agentNamePath, "utf-8").trim();
    return isConcreteIdentity(agentName) ? agentName : null;
  } catch {
    return null;
  }
}

function resolveRuntimeDisplayName(): string | null {
  const envName = process.env.TAP_AGENT_NAME;
  if (isConcreteIdentity(envName)) return envName;
  const codexName = process.env.CODEX_TAP_AGENT_NAME;
  if (isConcreteIdentity(codexName)) return codexName;
  const runtimeName = resolveRuntimeStateDisplayName();
  if (runtimeName) return runtimeName;
  return null;
}

type RuntimeConversationHeartbeat = {
  threadId?: string | null;
};

type RuntimeConversationThread = {
  threadId?: string | null;
};

function resolveCurrentConversationId(): string | null {
  const envThreadId = process.env.TAP_THREAD_ID;
  if (isConcreteIdentity(envThreadId)) return envThreadId.trim();

  const runtimeStateDir = resolveRuntimeStateDir();
  if (runtimeStateDir) {
    try {
      const heartbeatPath = join(runtimeStateDir, "heartbeat.json");
      if (existsSync(heartbeatPath)) {
        const heartbeat = JSON.parse(
          readFileSync(heartbeatPath, "utf-8"),
        ) as RuntimeConversationHeartbeat;
        const threadId = heartbeat.threadId ?? undefined;
        if (isConcreteIdentity(threadId)) {
          return threadId.trim();
        }
      }
    } catch {
      // Fall through to the saved thread state.
    }

    try {
      const threadPath = join(runtimeStateDir, "thread.json");
      if (existsSync(threadPath)) {
        const thread = JSON.parse(
          readFileSync(threadPath, "utf-8"),
        ) as RuntimeConversationThread;
        const threadId = thread.threadId ?? undefined;
        if (isConcreteIdentity(threadId)) {
          return threadId.trim();
        }
      }
    } catch {
      // Best-effort metadata only.
    }
  }

  const codexThreadId = process.env.CODEX_THREAD_ID;
  if (isConcreteIdentity(codexThreadId)) return codexThreadId.trim();

  return null;
}

function resolveHostId(): string | null {
  const explicitHostId = process.env.TAP_HOST_ID;
  if (isConcreteIdentity(explicitHostId)) return explicitHostId.trim();

  const computerName = process.env.COMPUTERNAME;
  if (isConcreteIdentity(computerName)) return computerName.trim();

  const hostName = process.env.HOSTNAME;
  if (isConcreteIdentity(hostName)) return hostName.trim();

  return COMMS_DIR || null;
}

export function buildAddressMetadata(options: {
  hostId?: string | null;
  agentId?: string | null;
  instanceId?: string | null;
  routingAddress: string;
  slot?: TapRoutingSlot | null;
  aliases?: Array<string | null | undefined>;
  conversationId?: string | null;
  ownerClientId?: string | null;
  deriveOwnerClientIdFromInstance?: boolean;
}): TapAddressMetadata {
  const hostId = options.hostId?.trim() || resolveHostId();
  const clientId = options.instanceId?.trim() || null;
  const conversationId = options.conversationId?.trim() || null;
  const ownerClientId =
    options.ownerClientId?.trim() ||
    (options.deriveOwnerClientIdFromInstance !== false &&
    conversationId &&
    clientId
      ? clientId
      : null);

  return {
    hostId,
    clientId,
    conversationId,
    ownerClientId,
    routingAddress: options.routingAddress,
    slot: options.slot ?? null,
    aliases: resolveRoutingAliases(
      options.aliases ?? [
        options.routingAddress,
        options.slot,
        options.instanceId,
        options.agentId,
      ],
    ),
  };
}

function resolveInitialId(
  stateBootstrap: StateBootstrapIdentity | null,
): string {
  const runtimeInstanceId = resolveRuntimeInstanceId();
  if (runtimeInstanceId) return runtimeInstanceId;
  const runtimeStateInstanceId = resolveRuntimeStateInstanceId();
  if (runtimeStateInstanceId) return runtimeStateInstanceId;
  return stateBootstrap?.agentId ?? "unknown";
}

function resolveStateInstanceForCurrentRuntime(
  agentId: string,
  stateBootstrap: StateBootstrapIdentity | null,
): TapBootstrapInstance | null {
  const instances = loadStateInstances();
  if (!instances) return null;

  const runtimeKind =
    (stateBootstrap?.agentId === agentId
      ? "codex"
      : resolveRuntimeKind(
          resolveRuntimeInstanceId() ??
            resolveRuntimeStateInstanceId() ??
            agentId,
        )) ?? null;

  const candidates = [
    agentId,
    agentId.replace(/_/g, "-"),
    agentId.replace(/-/g, "_"),
  ];

  for (const candidate of candidates) {
    const instance = instances[candidate];
    if (!instance) continue;
    if (runtimeKind && instance.runtime && instance.runtime !== runtimeKind) {
      continue;
    }
    return instance;
  }

  return null;
}

/** Try to read agentName from state.json for the current instance. */
function resolveNameFromState(
  agentId: string,
  stateBootstrap: StateBootstrapIdentity | null,
): string | null {
  if (agentId === "unknown") return null;
  if (stateBootstrap?.agentId === agentId && stateBootstrap.agentName) {
    return stateBootstrap.agentName;
  }
  try {
    const instance = resolveStateInstanceForCurrentRuntime(
      agentId,
      stateBootstrap,
    );
    if (!instance) return null;
    // M310: Read defaultAgentName first, fall back to agentName for backward compat
    const stateAgentName = instance.defaultAgentName ?? instance.agentName;
    return typeof stateAgentName === "string" &&
      !isPlaceholderAgentValue(stateAgentName)
      ? stateAgentName
      : null;
  } catch {
    return null;
  }
}

type RoutingRuntimeSnapshot = {
  version: 1;
  pid: number;
  runtimeKey: string;
  agentId: string;
  agentName: string;
  idLocked: boolean;
  nameConfirmed: boolean;
  routingAddress: string;
  routingSlot: TapRoutingSlot | null;
  aliases: string[];
  instanceId: string | null;
  stateDir: string | null;
  runtimeStateDir: string | null;
  repoRoot: string | null;
  updatedAt: string;
};

type RoutingRuntimeRegistryState = {
  runtimeKey: string | null;
  latestCurrentRuntime: RoutingRuntimeSnapshot | null;
  conflictingRuntimes: RoutingRuntimeSnapshot[];
};

const ROUTING_RUNTIME_DIRNAME = "routing-runtimes";
const ROUTING_RUNTIME_MARKER_FILENAME = ".registry-version";

let _lastPublishedRoutingSnapshotAt = 0;
let _routingRuntimeRegistryCache:
  | (RoutingRuntimeRegistryState & { markerVersion: string })
  | null = null;

const stateBootstrap = resolveSingleCodexBootstrap();
let _agentId = resolveInitialId(stateBootstrap);
// State takes priority over env — tap_set_name backwrites to state,
// but managed MCP config env may still hold a stale name from tap add time.
// M309: Explicit env name takes priority over state.json for display name.
// state.json may hold a stale name from a previous session.
const _envAgentName = process.env.TAP_AGENT_NAME;
const _hasExplicitEnvName =
  isConcreteIdentity(_envAgentName) && !isPlaceholderAgentValue(_envAgentName);
let _agentName = _hasExplicitEnvName
  ? _envAgentName!
  : (resolveNameFromState(_agentId, stateBootstrap) ??
    resolveRuntimeDisplayName() ??
    "unknown");
let _idLocked = _agentId !== "unknown";
// M185: Name confirmation — once confirmed, only idempotent calls allowed.
// M309: Only explicitly set env names (TAP_AGENT_NAME="해") are pre-confirmed.
// Placeholder/absent env → state names are unconfirmed (new session can override).
let _nameConfirmed = _hasExplicitEnvName;
// M309: Grace window — allow rename within 60s of first explicit tap_set_name.
// Explicitly named sessions are pre-sealed; unnamed sessions await tap_set_name.
const GRACE_WINDOW_MS = 60_000;
let _nameSetAt: number | null = null; // null until first explicit set_name
let _graceSealedByToolCall = _nameConfirmed; // explicit env names are pre-sealed
let _bootstrapSuppressed = false;
let _observedMcpClientName: string | null = null;

function resolveLocalCurrentInstanceId(): string | null {
  const envInstanceId = process.env.TAP_INSTANCE_ID;
  if (envInstanceId && envInstanceId !== "unknown") return envInstanceId;
  if (_agentId === "unknown") return null;
  return resolveKnownInstanceId(_agentId, _agentName);
}

function getLocalRoutingSlot(): TapRoutingSlot | null {
  return (
    normalizeRoutingSlot(process.env.TAP_ROUTING_SLOT) ??
    deriveRoutingSlotFromInstanceId(process.env.TAP_INSTANCE_ID) ??
    deriveRoutingSlotFromInstanceId(process.env.TAP_BRIDGE_INSTANCE_ID) ??
    deriveRoutingSlotFromInstanceId(resolveLocalCurrentInstanceId()) ??
    deriveRoutingSlotFromInstanceId(resolveRuntimeStateInstanceId()) ??
    deriveRoutingSlotFromInstanceId(_agentId) ??
    resolveRepoRootRoutingSlot()
  );
}

function getLocalRoutingAddress(): string {
  return (
    getLocalRoutingSlot() ??
    resolveLocalCurrentInstanceId() ??
    (!isPlaceholderAgentValue(_agentId)
      ? _agentId
      : !isPlaceholderAgentValue(_agentName)
        ? _agentName
        : _agentId)
  );
}

function resolveObservedMcpClientRoutingAlias(): string | null {
  if (!_nameConfirmed || isPlaceholderAgentValue(_agentName)) return null;
  const clientName = _observedMcpClientName?.trim().toLowerCase();
  if (!clientName) return null;
  return clientName.includes("codex") ? "codex" : null;
}

function getLocalRoutingAliases(): string[] {
  return resolveRoutingAliases([
    getLocalRoutingAddress(),
    getLocalRoutingSlot(),
    resolveLocalCurrentInstanceId(),
    resolveRuntimeStateInstanceId(),
    resolveObservedMcpClientRoutingAlias(),
    _agentId,
    _agentName,
  ]);
}

function resolveRoutingRuntimeKey(): string | null {
  const runtimeStateDir = resolveRuntimeStateDir();
  if (runtimeStateDir) return `runtime:${runtimeStateDir}`;

  const instanceId =
    resolveRuntimeInstanceId() ??
    resolveRuntimeStateInstanceId() ??
    resolveLocalCurrentInstanceId();
  if (instanceId) return `instance:${normalizeAgentId(instanceId)}`;

  return _agentId !== "unknown" ? `agent:${_agentId}` : null;
}

function resolveRoutingRuntimeRegistryDir(): string | null {
  const stateDir = process.env.TAP_STATE_DIR;
  if (!stateDir?.trim()) return null;
  return join(resolve(stateDir), ROUTING_RUNTIME_DIRNAME);
}

function buildRoutingRuntimeRegistryPath(
  runtimeKey: string,
  pid: number = process.pid,
): string | null {
  const registryDir = resolveRoutingRuntimeRegistryDir();
  if (!registryDir) return null;
  const keyHash = createHash("sha1").update(runtimeKey).digest("hex");
  return join(registryDir, `${keyHash}-${pid}.json`);
}

function resolveRoutingRuntimeRegistryMarkerPath(): string | null {
  const registryDir = resolveRoutingRuntimeRegistryDir();
  if (!registryDir) return null;
  return join(registryDir, ROUTING_RUNTIME_MARKER_FILENAME);
}

function buildLocalRoutingRuntimeSnapshot(
  runtimeKey: string,
): RoutingRuntimeSnapshot {
  return {
    version: 1,
    pid: process.pid,
    runtimeKey,
    agentId: _agentId,
    agentName: _agentName,
    idLocked: _idLocked,
    nameConfirmed: _nameConfirmed,
    routingAddress: getLocalRoutingAddress(),
    routingSlot: getLocalRoutingSlot(),
    aliases: getLocalRoutingAliases(),
    instanceId: resolveLocalCurrentInstanceId(),
    stateDir: process.env.TAP_STATE_DIR ?? null,
    runtimeStateDir: process.env.TAP_RUNTIME_STATE_DIR ?? null,
    repoRoot: process.env.TAP_REPO_ROOT ?? null,
    updatedAt: new Date().toISOString(),
  };
}

function isRoutingRuntimeSnapshot(
  value: unknown,
): value is RoutingRuntimeSnapshot {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<RoutingRuntimeSnapshot>;
  return (
    candidate.version === 1 &&
    typeof candidate.pid === "number" &&
    typeof candidate.runtimeKey === "string" &&
    typeof candidate.agentId === "string" &&
    typeof candidate.agentName === "string" &&
    Array.isArray(candidate.aliases) &&
    typeof candidate.updatedAt === "string"
  );
}

function isRoutingRuntimeSnapshotAlive(
  snapshot: RoutingRuntimeSnapshot,
): boolean {
  if (!Number.isFinite(snapshot.pid)) return false;
  try {
    process.kill(snapshot.pid, 0);
    return true;
  } catch {
    return false;
  }
}

function parseSnapshotUpdatedAt(snapshot: RoutingRuntimeSnapshot): number {
  const updatedAt = new Date(snapshot.updatedAt).getTime();
  return Number.isNaN(updatedAt) ? 0 : updatedAt;
}

function getRoutingRuntimeSnapshotIdentityPriority(
  snapshot: RoutingRuntimeSnapshot,
): number {
  let priority = 0;
  if (!isPlaceholderAgentValue(snapshot.agentName)) priority += 4;
  if (snapshot.nameConfirmed) priority += 2;
  if (snapshot.agentId !== "unknown") priority += 1;
  return priority;
}

function compareRoutingRuntimeSnapshots(
  a: RoutingRuntimeSnapshot,
  b: RoutingRuntimeSnapshot,
): number {
  const identityDelta =
    getRoutingRuntimeSnapshotIdentityPriority(b) -
    getRoutingRuntimeSnapshotIdentityPriority(a);
  if (identityDelta !== 0) return identityDelta;

  const timeDelta = parseSnapshotUpdatedAt(b) - parseSnapshotUpdatedAt(a);
  if (timeDelta !== 0) return timeDelta;
  return b.pid - a.pid;
}

function readRoutingRuntimeRegistryMarkerVersion(): string {
  const markerPath = resolveRoutingRuntimeRegistryMarkerPath();
  if (!markerPath || !existsSync(markerPath)) return "missing";
  try {
    const raw = readFileSync(markerPath, "utf-8").trim();
    if (!raw) return "empty";

    try {
      const parsed = JSON.parse(raw) as {
        version?: unknown;
        updatedAt?: unknown;
      };
      if (typeof parsed.version === "string" && parsed.version.trim()) {
        return parsed.version;
      }
      if (typeof parsed.updatedAt === "string" && parsed.updatedAt.trim()) {
        const legacyHash = createHash("sha1").update(raw).digest("hex");
        return `legacy:${parsed.updatedAt}:${legacyHash}`;
      }
    } catch {
      if (raw) return raw;
    }

    return `legacy-stat:${statSync(markerPath).mtimeMs}`;
  } catch {
    return "unreadable";
  }
}

function bumpRoutingRuntimeRegistryMarker(): void {
  const markerPath = resolveRoutingRuntimeRegistryMarkerPath();
  if (!markerPath) return;

  try {
    mkdirSync(dirname(markerPath), { recursive: true });
    const tmpPath = `${markerPath}.tmp.${process.pid}`;
    writeFileSync(
      tmpPath,
      JSON.stringify(
        {
          version: randomUUID(),
          updatedAt: new Date().toISOString(),
          pid: process.pid,
        },
        null,
        2,
      ),
      "utf-8",
    );
    renameSync(tmpPath, markerPath);
  } catch {
    // best-effort only
  }
}

function loadRoutingRuntimeRegistryState(
  force = false,
): RoutingRuntimeRegistryState {
  const runtimeKey = resolveRoutingRuntimeKey();
  const registryDir = resolveRoutingRuntimeRegistryDir();
  const markerVersion = readRoutingRuntimeRegistryMarkerVersion();

  if (
    !force &&
    _routingRuntimeRegistryCache &&
    _routingRuntimeRegistryCache.runtimeKey === runtimeKey &&
    _routingRuntimeRegistryCache.markerVersion === markerVersion
  ) {
    return _routingRuntimeRegistryCache;
  }

  if (!runtimeKey || !registryDir || !existsSync(registryDir)) {
    const emptyState: RoutingRuntimeRegistryState = {
      runtimeKey,
      latestCurrentRuntime: null,
      conflictingRuntimes: [],
    };
    _routingRuntimeRegistryCache = {
      ...emptyState,
      markerVersion,
    };
    return emptyState;
  }

  const liveSnapshots: RoutingRuntimeSnapshot[] = [];
  for (const entry of readdirSync(registryDir)) {
    if (!entry.endsWith(".json")) continue;
    try {
      const filePath = join(registryDir, entry);
      const raw = JSON.parse(readFileSync(filePath, "utf-8")) as unknown;
      if (!isRoutingRuntimeSnapshot(raw)) continue;
      if (!isRoutingRuntimeSnapshotAlive(raw)) continue;
      liveSnapshots.push(raw);
    } catch {
      // best-effort only
    }
  }

  const state: RoutingRuntimeRegistryState = {
    runtimeKey,
    latestCurrentRuntime:
      [...liveSnapshots]
        .filter((snapshot) => snapshot.runtimeKey === runtimeKey)
        .sort(compareRoutingRuntimeSnapshots)[0] ?? null,
    conflictingRuntimes: [...liveSnapshots]
      .filter((snapshot) => snapshot.runtimeKey !== runtimeKey)
      .sort(compareRoutingRuntimeSnapshots),
  };
  _routingRuntimeRegistryCache = {
    ...state,
    markerVersion,
  };
  return state;
}

function syncRuntimeIdentityFromRegistry(): void {
  const registryState = loadRoutingRuntimeRegistryState();
  const latestSnapshot = registryState.latestCurrentRuntime;
  if (!latestSnapshot) return;

  const snapshotTs = parseSnapshotUpdatedAt(latestSnapshot);
  if (snapshotTs <= _lastPublishedRoutingSnapshotAt) return;

  _agentId = latestSnapshot.agentId || _agentId;
  _agentName = latestSnapshot.agentName || _agentName;
  _idLocked = latestSnapshot.idLocked || _agentId !== "unknown";
  _nameConfirmed = latestSnapshot.nameConfirmed;
  _bootstrapSuppressed = false;
}

function persistRoutingRuntimeSnapshot(): void {
  const runtimeKey = resolveRoutingRuntimeKey();
  const targetPath =
    runtimeKey != null ? buildRoutingRuntimeRegistryPath(runtimeKey) : null;
  if (!runtimeKey || !targetPath) return;

  try {
    mkdirSync(dirname(targetPath), { recursive: true });
    const snapshot = buildLocalRoutingRuntimeSnapshot(runtimeKey);
    const tmpPath = `${targetPath}.tmp.${process.pid}`;
    writeFileSync(tmpPath, JSON.stringify(snapshot, null, 2), "utf-8");
    renameSync(tmpPath, targetPath);
    bumpRoutingRuntimeRegistryMarker();
    _lastPublishedRoutingSnapshotAt =
      parseSnapshotUpdatedAt(snapshot) || Date.now();
    _routingRuntimeRegistryCache = null;
  } catch {
    // best-effort only
  }
}

function clearRoutingRuntimeSnapshot(): void {
  const runtimeKey = resolveRoutingRuntimeKey();
  const targetPath =
    runtimeKey != null ? buildRoutingRuntimeRegistryPath(runtimeKey) : null;
  if (!targetPath) return;

  try {
    rmSync(targetPath, { force: true });
    bumpRoutingRuntimeRegistryMarker();
    _routingRuntimeRegistryCache = null;
  } catch {
    // best-effort only
  }
}

function refreshUnknownIdentity(): void {
  if (_bootstrapSuppressed) return;
  if (_idLocked) return;

  const nextBootstrap = resolveSingleCodexBootstrap();
  const nextId = resolveInitialId(nextBootstrap);
  if (nextId === "unknown") return;

  _agentId = nextId;
  _idLocked = true;

  const nextName =
    resolveNameFromState(nextId, nextBootstrap) ?? resolveRuntimeDisplayName();
  if (nextName && !isPlaceholderAgentValue(nextName)) {
    _agentName = nextName;
    _nameConfirmed = true;
  }
}

persistRoutingRuntimeSnapshot();

export function getAgentId(): string {
  refreshUnknownIdentity();
  syncRuntimeIdentityFromRegistry();
  return _agentId;
}

export function getAgentName(): string {
  refreshUnknownIdentity();
  syncRuntimeIdentityFromRegistry();
  return _agentName;
}

export function resolveKnownInstanceId(
  agentId: string,
  displayName?: string | null,
): string | null {
  const instances = loadStateInstances();
  if (!instances) return null;

  const candidates = [
    agentId,
    agentId.replace(/_/g, "-"),
    agentId.replace(/-/g, "_"),
  ];
  for (const candidate of candidates) {
    if (instances[candidate]?.installed) return candidate;
  }

  if (!displayName || isPlaceholderAgentValue(displayName)) return null;
  const matches = Object.entries(instances).filter(
    ([, instance]) =>
      instance?.installed &&
      (instance.defaultAgentName ?? instance.agentName) === displayName,
  );
  return matches.length === 1 ? matches[0][0] : null;
}

export function resolveCurrentInstanceId(): string | null {
  // M299: TAP_INSTANCE_ID takes priority over state.json lookup
  const envInstanceId = process.env.TAP_INSTANCE_ID;
  if (envInstanceId && envInstanceId !== "unknown") return envInstanceId;
  refreshUnknownIdentity();
  syncRuntimeIdentityFromRegistry();
  if (_agentId === "unknown") return null;
  return resolveKnownInstanceId(_agentId, _agentName);
}

export function getAgentRoutingSlot(): TapRoutingSlot | null {
  refreshUnknownIdentity();
  syncRuntimeIdentityFromRegistry();

  return (
    normalizeRoutingSlot(process.env.TAP_ROUTING_SLOT) ??
    deriveRoutingSlotFromInstanceId(process.env.TAP_INSTANCE_ID) ??
    deriveRoutingSlotFromInstanceId(process.env.TAP_BRIDGE_INSTANCE_ID) ??
    deriveRoutingSlotFromInstanceId(resolveCurrentInstanceId()) ??
    deriveRoutingSlotFromInstanceId(resolveRuntimeStateInstanceId()) ??
    deriveRoutingSlotFromInstanceId(_agentId) ??
    resolveRepoRootRoutingSlot()
  );
}

export function getAgentRoutingAddress(): string {
  refreshUnknownIdentity();
  syncRuntimeIdentityFromRegistry();
  return (
    getAgentRoutingSlot() ??
    resolveCurrentInstanceId() ??
    (!isPlaceholderAgentValue(_agentId)
      ? _agentId
      : !isPlaceholderAgentValue(_agentName)
        ? _agentName
        : _agentId)
  );
}

export function getAgentRoutingAliases(): string[] {
  refreshUnknownIdentity();
  syncRuntimeIdentityFromRegistry();

  const localAliases = getLocalRoutingAliases();
  const latestSnapshot = loadRoutingRuntimeRegistryState().latestCurrentRuntime;
  return resolveRoutingAliases([
    ...(latestSnapshot?.aliases ?? []),
    ...localAliases,
  ]);
}

export function getAgentReceiveTransports(): TapReceiveTransport[] {
  refreshUnknownIdentity();
  syncRuntimeIdentityFromRegistry();

  const resolvedCurrentInstanceId = resolveCurrentInstanceId();
  return inferReceiveTransports({
    runtimeName:
      resolveRuntimeKind(
        resolvedCurrentInstanceId ??
          resolveRuntimeStateInstanceId() ??
          _agentId,
      ) ?? null,
    instanceId: resolvedCurrentInstanceId,
    bridgeInstanceId:
      process.env.TAP_BRIDGE_INSTANCE_ID ?? resolveRuntimeStateInstanceId(),
    agentId: _agentId,
    runtimeStateDir: process.env.TAP_RUNTIME_STATE_DIR ?? null,
    mcpClientName: _observedMcpClientName,
  });
}

export function setObservedMcpClientName(name: string | null | undefined) {
  const normalized = name?.trim();
  _observedMcpClientName = normalized || null;
}

export function isOwnMessageAddressForCurrentAgent(sender: string): boolean {
  refreshUnknownIdentity();
  return matchesRoutingAliases(sender, getAgentRoutingAliases());
}

export function getAgentIdentitySnapshot(): AgentIdentitySnapshot {
  refreshUnknownIdentity();
  const bootstrap = resolveSingleCodexBootstrap();
  const resolvedCurrentInstanceId = resolveCurrentInstanceId();
  const resolvedRoutingSlot = getAgentRoutingSlot();
  const resolvedRoutingAddress =
    resolvedRoutingSlot ??
    resolvedCurrentInstanceId ??
    (!isPlaceholderAgentValue(_agentId)
      ? _agentId
      : !isPlaceholderAgentValue(_agentName)
        ? _agentName
        : _agentId);
  const resolvedRoutingAliases = getAgentRoutingAliases();
  const conversationId = resolveCurrentConversationId();
  return {
    agentId: _agentId,
    agentName: _agentName,
    idLocked: _idLocked,
    nameConfirmed: _nameConfirmed,
    address: buildAddressMetadata({
      agentId: _agentId,
      instanceId: resolvedCurrentInstanceId,
      routingAddress: resolvedRoutingAddress,
      slot: resolvedRoutingSlot,
      aliases: resolvedRoutingAliases,
      conversationId,
    }),
    runtimeEnv: {
      routingSlot: normalizeRoutingSlot(process.env.TAP_ROUTING_SLOT),
      instanceId: process.env.TAP_INSTANCE_ID ?? null,
      bridgeInstanceId: process.env.TAP_BRIDGE_INSTANCE_ID ?? null,
      agentId: process.env.TAP_AGENT_ID ?? null,
      agentName: process.env.TAP_AGENT_NAME ?? null,
      codexTapAgentName: process.env.CODEX_TAP_AGENT_NAME ?? null,
      commsDir: process.env.TAP_COMMS_DIR ?? null,
      stateDir: process.env.TAP_STATE_DIR ?? null,
      runtimeStateDir: process.env.TAP_RUNTIME_STATE_DIR ?? null,
      repoRoot: process.env.TAP_REPO_ROOT ?? null,
    },
    bootstrap,
    resolvedCurrentInstanceId,
    resolvedRoutingSlot,
    resolvedRoutingAddress,
    resolvedRoutingAliases,
  };
}

export function buildAgentIdentityProbeSnapshot(
  testName?: string | null,
): AgentIdentityProbeSnapshot {
  const snapshot = getAgentIdentitySnapshot();
  const registryState = loadRoutingRuntimeRegistryState();
  const envAgentName = snapshot.runtimeEnv.agentName;
  const probe: AgentIdentityProbeSnapshot = {
    ...snapshot,
    bootstrapDrift: {
      envAgentName,
      envAgentNameIsPlaceholder: isPlaceholderAgentValue(envAgentName),
      runtimeAgentName: snapshot.agentName,
      differsFromRuntime:
        Boolean(envAgentName?.trim()) && envAgentName !== snapshot.agentName,
    },
    runtimeCoordination: {
      runtimeKey: registryState.runtimeKey,
      conflictingRuntimes: registryState.conflictingRuntimes.map(
        (runtime): RoutingRuntimeConflict => ({
          pid: runtime.pid,
          runtimeKey: runtime.runtimeKey,
          agentId: runtime.agentId,
          agentName: runtime.agentName,
          updatedAt: runtime.updatedAt,
          stateDir: runtime.stateDir,
          runtimeStateDir: runtime.runtimeStateDir,
          repoRoot: runtime.repoRoot,
          aliases: runtime.aliases,
        }),
      ),
    },
  };
  const normalizedTestName = testName?.trim();
  if (normalizedTestName) {
    probe.dryRun = {
      testName: normalizedTestName,
      matches: isForMe(normalizedTestName),
    };
  }
  return probe;
}

export function buildHeartbeatConnectHash(
  instanceId: string | null | undefined,
  agentId: string,
): string {
  return instanceId ? `instance:${instanceId}` : `session:${agentId}`;
}

export function isNameConfirmed(): boolean {
  return _nameConfirmed;
}

/**
 * Demote agent name to "unknown" and reset confirmed state.
 * Used when bootstrap claim fails — allows tap_set_name recovery.
 */
export function demoteAgentName(): void {
  _agentName = "unknown";
  _nameConfirmed = false;
}

export function setAgentName(name: string) {
  _agentName = name;
  _nameConfirmed = true;
  _bootstrapSuppressed = false;
  // First set_name also locks the id (backward compat: id = first name chosen)
  if (!_idLocked) {
    // Hyphens are reserved as filename delimiters — use underscores instead
    _agentId = canonicalizeIdentityId(name);
    _idLocked = true;
  }
  persistRoutingRuntimeSnapshot();
}

export function getRoutingRuntimeKey(): string | null {
  refreshUnknownIdentity();
  syncRuntimeIdentityFromRegistry();
  return resolveRoutingRuntimeKey();
}

export function getRoutingRuntimeConflicts(): RoutingRuntimeConflict[] {
  refreshUnknownIdentity();
  syncRuntimeIdentityFromRegistry();
  return loadRoutingRuntimeRegistryState().conflictingRuntimes.map(
    (runtime): RoutingRuntimeConflict => ({
      pid: runtime.pid,
      runtimeKey: runtime.runtimeKey,
      agentId: runtime.agentId,
      agentName: runtime.agentName,
      updatedAt: runtime.updatedAt,
      stateDir: runtime.stateDir,
      runtimeStateDir: runtime.runtimeStateDir,
      repoRoot: runtime.repoRoot,
      aliases: runtime.aliases,
    }),
  );
}

export type ResetIdentityResult = {
  previousName: string;
  previousId: string;
  nextName: string;
  nextId: string;
  releasedClaim: boolean;
};

function resolveResetFallbackName(previousName: string): string {
  if (_hasExplicitEnvName && _envAgentName !== previousName) {
    return _envAgentName!;
  }
  return "unknown";
}

export async function resetIdentity(): Promise<ResetIdentityResult> {
  const previousName = _agentName;
  const previousId = _agentId;
  let releasedClaim = false;

  if (!isPlaceholderAgentValue(previousName)) {
    try {
      const { releaseClaim, resolveClaimInstanceId } =
        await import("./tap-claims.js");
      releasedClaim = releaseClaim(
        previousName,
        resolveClaimInstanceId(),
        process.pid,
      );
    } catch {
      releasedClaim = false;
    }
  }

  _agentId = "unknown";
  _agentName = resolveResetFallbackName(previousName);
  _idLocked = false;
  _nameConfirmed = false;
  _nameSetAt = null;
  _graceSealedByToolCall = false;
  _bootstrapSuppressed = true;
  clearRoutingRuntimeSnapshot();

  return {
    previousName,
    previousId,
    nextName: _agentName,
    nextId: _agentId,
    releasedClaim,
  };
}

export type AgentNameClaimResult =
  | {
      ok: true;
      oldName: string;
      agentId: string;
      wasIdLocked: boolean;
    }
  | {
      ok: false;
      currentName: string;
      agentId: string;
    };

// M185 scope: once a session already holds a real name, later same-process
// callers can only repeat that same name. Placeholder boot first-claim remains
// first-caller-wins until caller context exists (M193).
// M309: Grace window — allow rename within 60s of first set_name, unless
// sealed by a non-set_name tool call.
export function claimAgentName(name: string): AgentNameClaimResult {
  const oldName = _agentName;
  const wasIdLocked = _idLocked;
  if (_nameConfirmed && name !== oldName) {
    // M309: Check grace window before rejecting
    if (!isInGraceWindow()) {
      return {
        ok: false,
        currentName: oldName,
        agentId: _agentId,
      };
    }
    // Within grace window — allow rename
  }

  const isRename = name !== oldName;
  setAgentName(name);
  if (isRename) {
    // Rename: open fresh grace window
    _nameSetAt = Date.now();
    _graceSealedByToolCall = false;
  } else if (!_nameSetAt && !_graceSealedByToolCall) {
    // First explicit set_name in an unconfirmed session: open grace window
    _nameSetAt = Date.now();
  }
  // Idempotent calls on confirmed/sealed names: preserve current state
  return {
    ok: true,
    oldName,
    agentId: _agentId,
    wasIdLocked,
  };
}

/**
 * M309: Check if the grace window for renaming is still open.
 * Grace window is open when: name was set within 60s AND no other tool call has sealed it.
 */
export function isInGraceWindow(): boolean {
  if (!_nameSetAt || _graceSealedByToolCall) return false;
  return Date.now() - _nameSetAt < GRACE_WINDOW_MS;
}

/**
 * M309: Seal the grace window. Called when any non-set_name tool is invoked,
 * making the current name permanent.
 */
export function sealGraceWindow(): void {
  if (_nameConfirmed && !_graceSealedByToolCall) {
    _graceSealedByToolCall = true;
  }
}

export function isIdLocked(): boolean {
  return _idLocked;
}

// ── Types ───────────────────────────────────────────────────────────────

export type ChannelSource = "inbox" | "reviews" | "findings";

export type ParsedFilename = { from: string; to: string; subject: string };

export type ParsedFrontmatter = {
  from: string;
  from_name?: string;
  to: string;
  to_name?: string;
  subject: string;
  sent_at?: string;
  type?: string;
  message_id?: string;
  from_address?: string;
  to_address?: string;
  scope?: string;
  action?: string;
  consent_ref?: string;
};

export type TapUnreadItem = {
  source: ChannelSource;
  filename: string;
  path: string;
  from: string;
  to: string;
  subject: string;
  mtime: string;
  content?: string;
  display?: string;
};

export type HeartbeatSource = "bridge-dispatch" | "mcp-direct";

export type AgentCapabilitySnapshot = {
  receiveTransports?: TapReceiveTransport[];
  receiveTransportsSource?: "explicit" | "heuristic";
  conversationId?: string | null;
  ownerClientId?: string | null;
};

export type TapRuntimeHealthStatus =
  | "ready"
  | "partial"
  | "stale-owner"
  | "active-turn"
  | "stale-active-turn"
  | "stuck-turn"
  | "not-observed"
  | "adapter-unavailable"
  | "degraded"
  | "unknown";

export type TapRuntimeHealth = {
  status: TapRuntimeHealthStatus;
  reason: string | null;
  checkedAt: string | null;
  adapter: string | null;
  recovery: string | null;
};

export type Heartbeat = {
  id?: string; // routing id (immutable) — absent in legacy entries
  agent: string; // display name (mutable)
  timestamp: string;
  lastActivity: string;
  joinedAt?: string; // ISO — set on first tap_set_name, preserved on rename
  status: "active" | "idle" | "signing-off";
  source?: HeartbeatSource;
  instanceId?: string | null;
  bridgePid?: number | null;
  connectHash?: string;
  address?: TapAddressMetadata;
  receiveTransports?: TapReceiveTransport[];
  capabilities?: AgentCapabilitySnapshot;
  health?: TapRuntimeHealth;
};

export type HeartbeatStore = Record<string, Heartbeat>;

export type Receipt = { reader: string; timestamp: string };
export type ReceiptStore = Record<string, Receipt[]>;

// ── Activity Tracking ───────────────────────────────────────────────────

let _lastActivityTime = new Date().toISOString();

export function getLastActivityTime(): string {
  return _lastActivityTime;
}

export function updateActivityTime() {
  _lastActivityTime = new Date().toISOString();
}

// ── Utilities ───────────────────────────────────────────────────────────

type TapLogLevel = "debug" | "info" | "warn" | "error";
type TapLogContext = Record<string, unknown>;

function formatTapLogValue(value: unknown): string {
  if (typeof value === "string") {
    return JSON.stringify(value);
  }

  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return String(value);
  }

  if (value === null) {
    return "null";
  }

  return JSON.stringify(value);
}

function formatTapLogContext(context?: TapLogContext): string {
  if (!context) {
    return "";
  }

  const entries = Object.entries(context).filter(
    ([, value]) => value !== undefined,
  );
  if (entries.length === 0) {
    return "";
  }

  return ` ${entries
    .map(([key, value]) => `${key}=${formatTapLogValue(value)}`)
    .join(" ")}`;
}

function getTapLogPath(): string | null {
  const explicit = process.env.TAP_CHANNEL_LOG_PATH?.trim();
  if (explicit) {
    return resolve(explicit);
  }

  const stateDir = process.env.TAP_STATE_DIR?.trim();
  if (!stateDir) {
    return null;
  }

  return join(resolve(stateDir), "logs", "tap-mcp.log");
}

function writeTapLog(line: string): void {
  const logPath = getTapLogPath();
  if (!logPath) {
    return;
  }

  try {
    mkdirSync(dirname(logPath), { recursive: true });
    appendFileSync(logPath, `${line}\n`, "utf-8");
  } catch {
    // Best-effort logging only.
  }
}

function logTap(
  level: TapLogLevel,
  message: string,
  context?: TapLogContext,
): void {
  const stamp = new Date().toISOString().replace("T", " ").replace("Z", " UTC");
  const line = `[${stamp}] ${level.toUpperCase()} ${message}${formatTapLogContext(context)}`;

  if (level === "warn") {
    console.warn(`[tap-comms] ${line}`);
  } else if (level === "error") {
    console.error(`[tap-comms] ${line}`);
  } else {
    console.error(`[tap-comms] ${line}`);
  }

  writeTapLog(line);
}

export function debug(message: string, context?: TapLogContext) {
  logTap("debug", message, context);
}

export function logInfo(message: string, context?: TapLogContext) {
  logTap("info", message, context);
}

export function logWarn(message: string, context?: TapLogContext) {
  logTap("warn", message, context);
}

export function logError(message: string, context?: TapLogContext) {
  logTap("error", message, context);
}

export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * Parse YAML frontmatter from message content.
 * Returns parsed fields or null if no valid frontmatter found.
 */
export function parseFrontmatter(content: string): ParsedFrontmatter | null {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return null;

  const fields: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const kv = line.match(/^(\w+):\s*(.+)$/);
    if (kv) fields[kv[1]] = kv[2].trim();
  }

  if (!fields.from || !fields.to) return null;

  return {
    from: fields.from,
    from_name: fields.from_name,
    to: fields.to,
    to_name: fields.to_name,
    subject: fields.subject ?? "",
    sent_at: fields.sent_at,
    type: fields.type,
    message_id: fields.message_id,
    from_address: fields.from_address,
    to_address: fields.to_address,
    scope: fields.scope,
    action: fields.action,
    consent_ref: fields.consent_ref,
  };
}

/**
 * Strip frontmatter from content, returning only the body.
 */
export function stripFrontmatter(content: string): string {
  return content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n*/, "");
}

/**
 * Parse message routing info: try frontmatter first, fall back to filename.
 */
export function parseMessageRoute(
  filename: string,
  content?: string,
): ParsedFilename | null {
  if (content) {
    const fm = parseFrontmatter(content);
    if (fm) return { from: fm.from, to: fm.to, subject: fm.subject };
  }
  return parseFilename(filename);
}

export function parseFilename(filename: string): ParsedFilename | null {
  // Format: YYYYMMDD-{from}-{to}-{subject}.md
  // from/to may contain hyphens (e.g. "codex-1"), so we split by "-" and
  // use a known-agent or structural heuristic: date(1) + from + to + subject(rest).
  // Strategy: strip date prefix, then split remainder into exactly 3+ segments
  // where from/to are single CJK chars or known multi-segment ids.
  const withoutExt = filename.replace(/\.md$/, "");
  const dateMatch = withoutExt.match(/^(\d{8})-(.+)$/);
  if (!dateMatch) return null;

  const rest = dateMatch[2];

  // Try CJK-aware split: CJK characters are single-char agent names
  // Match: {from}-{to}-{subject} where from/to can be CJK single chars
  const cjkMatch = rest.match(
    /^([\u3131-\uD79DA-Za-z][\w]*?)-([\u3131-\uD79DA-Za-z][\w]*?)-(.+)$/,
  );
  if (cjkMatch) {
    return { from: cjkMatch[1], to: cjkMatch[2], subject: cjkMatch[3] };
  }

  // Fallback: simple 3-part split (first two segments = from/to)
  const parts = rest.split("-");
  if (parts.length >= 3) {
    return {
      from: parts[0] || "?",
      to: parts[1] || "?",
      subject: parts.slice(2).join("-") || "?",
    };
  }

  return null;
}

/**
 * M204: Canonicalize agent ID — normalize hyphens to underscores.
 * Both `codex-1` and `codex_1` map to `codex_1`.
 */
export function canonicalizeAgentId(id: string): string {
  return canonicalizeIdentityId(id);
}

export function isForMe(to: string): boolean {
  refreshUnknownIdentity();
  return matchesRoutingAliases(to, getAgentRoutingAliases(), true);
}

export function normalizeSources(value: unknown): ChannelSource[] {
  // Default: inbox + reviews only. Findings are record-keeping, not real-time
  // comms — request explicitly via sources: ["findings"] if needed.
  if (!Array.isArray(value) || value.length === 0) {
    return ["inbox", "reviews"];
  }

  const allowed = new Set<ChannelSource>(["inbox", "reviews", "findings"]);
  const normalized = value.filter(
    (entry): entry is ChannelSource =>
      typeof entry === "string" && allowed.has(entry as ChannelSource),
  );

  return normalized.length ? normalized : ["inbox", "reviews"];
}

export function getLatestReviewDir(): string | null {
  if (!existsSync(REVIEWS_DIR)) return null;
  const gens = readdirSync(REVIEWS_DIR)
    .filter((entry) => entry.startsWith("gen"))
    .sort();
  return gens.length ? join(REVIEWS_DIR, gens[gens.length - 1]) : null;
}

export function getSourceDir(source: ChannelSource): string | null {
  if (source === "inbox") return INBOX_DIR;
  if (source === "reviews") return getLatestReviewDir();
  return FINDINGS_DIR;
}

export function getSourceKey(source: ChannelSource, filename: string): string {
  return `${source}/${filename}`;
}

export function getRecentSenders(): Set<string> {
  const senders = new Set<string>();
  if (!existsSync(INBOX_DIR)) return senders;

  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  for (const filename of readdirSync(INBOX_DIR)) {
    if (!filename.endsWith(".md")) continue;
    try {
      const mtime = statSync(join(INBOX_DIR, filename)).mtimeMs;
      if (mtime < cutoff) continue;
    } catch {
      continue;
    }
    const parsed = parseFilename(filename);
    if (parsed) senders.add(parsed.from);
  }
  return senders;
}

export function getRecentReplyableSenders(): Set<string> {
  return new Set(getRecentReplyableRecipients().keys());
}

export function getRecentReplyableRecipients(): Map<string, string> {
  if (!existsSync(INBOX_DIR)) return new Map<string, string>();

  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  const routingAliases = getAgentRoutingAliases();
  const recipients = new Map<string, string>();

  for (const filename of readdirSync(INBOX_DIR)) {
    if (!filename.endsWith(".md")) continue;

    const filePath = join(INBOX_DIR, filename);
    try {
      const mtime = statSync(filePath).mtimeMs;
      if (mtime < cutoff) continue;
    } catch {
      continue;
    }

    try {
      const content = readFileSync(filePath, "utf-8");
      const frontmatter = parseFrontmatter(content);
      const route = parseMessageRoute(filename, content);
      if (!route) continue;
      if (
        !isBroadcastRecipient(route.to) &&
        !matchesRoutingAliases(route.to, routingAliases)
      ) {
        continue;
      }

      const routingTarget = isPlaceholderAgentValue(route.from)
        ? null
        : route.from;
      if (routingTarget) {
        recipients.set(routingTarget, routingTarget);
      }

      const fromName = frontmatter?.from_name?.trim() || null;
      if (fromName && !isPlaceholderAgentValue(fromName)) {
        recipients.set(fromName, routingTarget ?? fromName);
      }
    } catch {
      // best-effort
    }
  }

  return recipients;
}
