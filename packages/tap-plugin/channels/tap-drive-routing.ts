import { ExperimentalCodexIpcControlTransport } from "../../../src/transport/experimental/codex-ipc-control.js";
import { buildTapMessagePrompt } from "../../../src/routing/tap-message-prompt.js";
import {
  buildCodexBindingRegistry,
  resolveCodexBinding,
  type CodexBinding,
  type CodexBindingHeartbeat,
  type CodexBindingRuntimeHealth,
  type ConsentDriveResponse,
  type ConsentDriveTransport,
  type ConsentDriveTransportFactory,
  type RemoteCodexRelayConfig,
  type RemoteCodexRelayExecutor,
  type RemoteCodexRelayInput,
  type RemoteCodexRelayResult,
} from "../../../src/codex-a2a/index.js";
import {
  discoverCodexOwnerClientId,
  type CodexOwnerDiscoveryResult,
} from "../../../src/routing/codex-owner-discovery.js";
import { writeConsentLedgerEvent } from "../../../src/transport/consent-ledger.js";
import {
  checkTrustedDeviceLeaseGate,
  type TrustedDeviceLeaseGateResult,
} from "../../../src/transport/trusted-device-lease.js";
import {
  normalizeReceiveTransports,
  prefersConsentDrive,
  type TapReceiveTransport,
} from "../../../src/routing/receive-transports.js";
import type { TapAddressMetadata } from "./tap-utils.js";
import { spawn } from "node:child_process";

export type {
  ConsentDriveResponse,
  ConsentDriveTransport,
  ConsentDriveTransportFactory,
  RemoteCodexRelayConfig,
  RemoteCodexRelayExecutor,
  RemoteCodexRelayInput,
  RemoteCodexRelayResult,
} from "../../../src/codex-a2a/index.js";

export type CodexOwnerDiscoveryFunction = (options: {
  conversationId: string;
  hostId?: string | null;
}) => Promise<CodexOwnerDiscoveryResult>;

export interface TapReplyRoutingInput {
  commsDir?: string;
  localHostId?: string | null;
  explicitEnvelope?: boolean;
  sender: {
    routingAddress: string;
    displayName: string;
  };
  target: {
    routingAddress: string;
    displayName: string | null;
    address: TapAddressMetadata | null;
    receiveTransports?: readonly string[] | null;
    ambiguous?: boolean;
  };
  subject: string;
  content: string;
  fileName: string;
  heartbeats?: Record<string, CodexBindingHeartbeat> | null;
  now?: Date | string | number;
  staleAfterMs?: number;
  dryRun?: boolean;
  transportFactory?: ConsentDriveTransportFactory;
  remoteRelayExecutor?: RemoteCodexRelayExecutor;
  ownerDiscovery?: CodexOwnerDiscoveryFunction;
  remoteHosts?: Record<string, RemoteCodexRelayConfig> | null;
  trustedDeviceLeases?: {
    enabled?: boolean;
    devicesDir?: string | null;
    requesterDeviceId?: string | null;
    requesterHostId?: string | null;
    targetDeviceId?: string | null;
  } | null;
}

export interface TapReplyRoutingResult {
  transport: TapReceiveTransport;
  delivered: boolean;
  fallbackToInbox: boolean;
  turnId: string | null;
  consentRef: string | null;
  warning: string | null;
  dryRun?: boolean;
}

function defaultTransportFactory(options: {
  commsDir?: string;
  hostId?: string | null;
}): ConsentDriveTransport {
  return new ExperimentalCodexIpcControlTransport({
    commsDir: options.commsDir,
    hostId: options.hostId ?? null,
  });
}

function normalizeString(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function normalizeHostKey(value: string | null | undefined): string | null {
  return normalizeString(value)?.toLowerCase() ?? null;
}

function normalizeStringArray(value: unknown): string[] {
  if (typeof value === "string") {
    const normalized = normalizeString(value);
    return normalized ? [normalized] : [];
  }
  if (!Array.isArray(value)) return [];
  const normalized: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const entry = normalizeString(item);
    if (entry) normalized.push(entry);
  }
  return normalized;
}

function normalizeRemoteConfig(value: unknown): RemoteCodexRelayConfig | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const sshTarget =
    typeof record.sshTarget === "string"
      ? normalizeString(record.sshTarget)
      : typeof record.ssh === "string"
        ? normalizeString(record.ssh)
        : null;
  const platformDir =
    typeof record.platformDir === "string"
      ? normalizeString(record.platformDir)
      : typeof record.repo === "string"
        ? normalizeString(record.repo)
        : null;
  if (!sshTarget || !platformDir) return null;
  return {
    sshTarget,
    platformDir,
    commsDir:
      typeof record.commsDir === "string"
        ? normalizeString(record.commsDir)
        : null,
    nodeCommand:
      typeof record.nodeCommand === "string"
        ? normalizeString(record.nodeCommand)
        : null,
    helperPath:
      typeof record.helperPath === "string"
        ? normalizeString(record.helperPath)
        : null,
    hostAliases: [
      ...normalizeStringArray(record.hostAliases),
      ...normalizeStringArray(record.aliases),
      ...(typeof record.hostId === "string"
        ? normalizeStringArray(record.hostId)
        : []),
    ],
  };
}

export function parseRemoteCodexHosts(
  raw: string | null | undefined,
): Record<string, RemoteCodexRelayConfig> {
  const normalized = normalizeString(raw);
  if (!normalized) return {};
  try {
    const parsed = JSON.parse(normalized) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const configs: Record<string, RemoteCodexRelayConfig> = {};
    const entries: Array<{
      key: string;
      config: RemoteCodexRelayConfig;
    }> = [];
    for (const [hostId, value] of Object.entries(
      parsed as Record<string, unknown>,
    )) {
      const key = normalizeHostKey(hostId);
      const config = normalizeRemoteConfig(value);
      if (!key || !config) continue;
      configs[key] = config;
      entries.push({ key, config });
    }
    for (const { key, config } of entries) {
      for (const alias of config.hostAliases ?? []) {
        const aliasKey = normalizeHostKey(alias);
        if (!aliasKey || aliasKey === key || configs[aliasKey]) continue;
        configs[aliasKey] = config;
      }
    }
    return configs;
  } catch {
    return {};
  }
}

function resolveRemoteHostConfig(
  hostId: string | null | undefined,
  explicit?: Record<string, RemoteCodexRelayConfig> | null,
): RemoteCodexRelayConfig | null {
  const key = normalizeHostKey(hostId);
  if (!key) return null;
  return (
    explicit?.[key] ??
    parseRemoteCodexHosts(process.env.TAP_CODEX_REMOTE_HOSTS)[key] ??
    null
  );
}

function defaultRemoteHelperPath(config: RemoteCodexRelayConfig): string {
  const base = config.platformDir.replace(/[\\/]+$/, "");
  return `${base}/packages/tap-comms/dist/bridges/codex-remote-ipc-relay.mjs`;
}

export function parseRemoteRelayProcessResult(result: {
  stdout: string;
  stderr?: string | null;
  exitCode?: number | null;
}): RemoteCodexRelayResult {
  const stdout = result.stdout.trim();
  const stderr = result.stderr?.trim() ?? "";
  const exitCode = result.exitCode ?? 0;

  if (stdout) {
    try {
      const parsed = JSON.parse(stdout) as {
        ok?: boolean;
        turnId?: string | null;
        consentRef?: string | null;
        error?: string;
      };
      if (parsed.ok) {
        return {
          turnId: normalizeString(parsed.turnId),
          consentRef: normalizeString(parsed.consentRef),
        };
      }
      throw new Error(parsed.error || "remote relay returned failure");
    } catch (error) {
      if (error instanceof SyntaxError) {
        if (exitCode === 0) {
          throw new Error(
            `remote relay returned invalid JSON: ${error.message}`,
          );
        }
      } else {
        throw error;
      }
    }
  }

  if (exitCode !== 0) {
    throw new Error(
      `ssh relay exited ${exitCode ?? "unknown"}${stderr ? `: ${stderr}` : ""}`,
    );
  }
  throw new Error("remote relay returned empty output");
}

async function defaultRemoteRelayExecutor(
  input: RemoteCodexRelayInput,
): Promise<RemoteCodexRelayResult> {
  const nodeCommand = input.config.nodeCommand?.trim() || "node";
  const helperPath =
    input.config.helperPath?.trim() || defaultRemoteHelperPath(input.config);
  const payload = JSON.stringify({
    commsDir: input.config.commsDir ?? null,
    hostId: input.target.hostId,
    conversationId: input.target.conversationId,
    ownerClientId: input.target.ownerClientId,
    text: input.text,
  });

  const output = await new Promise<{
    stdout: string;
    stderr: string;
    exitCode: number | null;
  }>((resolve, reject) => {
    const child = spawn(
      "ssh",
      [input.config.sshTarget, nodeCommand, helperPath],
      {
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ stdout, stderr, exitCode: code });
    });
    child.stdin.end(payload);
  });

  return parseRemoteRelayProcessResult(output);
}

function extractTurnId(result: ConsentDriveResponse): string | null {
  const payload =
    result.response?.result &&
    typeof result.response.result === "object" &&
    !Array.isArray(result.response.result)
      ? (result.response.result as Record<string, unknown>)
      : null;
  const direct =
    payload?.turn &&
    typeof payload.turn === "object" &&
    !Array.isArray(payload.turn)
      ? (payload.turn as { id?: unknown }).id
      : null;
  if (typeof direct === "string" && direct.trim()) {
    return direct.trim();
  }

  const nestedResult =
    payload?.result &&
    typeof payload.result === "object" &&
    !Array.isArray(payload.result)
      ? (payload.result as Record<string, unknown>)
      : null;
  const nested =
    nestedResult?.turn &&
    typeof nestedResult.turn === "object" &&
    !Array.isArray(nestedResult.turn)
      ? (nestedResult.turn as { id?: unknown }).id
      : null;
  if (typeof nested === "string" && nested.trim()) {
    return nested.trim();
  }

  return null;
}

function buildDriveFallbackResult(
  warning: string | null,
): TapReplyRoutingResult {
  return {
    transport: "mcp-channel",
    delivered: false,
    fallbackToInbox: true,
    turnId: null,
    consentRef: null,
    warning,
  };
}

function buildRuntimeHealthFallbackWarning(
  routingAddress: string,
  health: CodexBindingRuntimeHealth,
): string | null {
  if (health.status === "ready") return null;

  const reason = health.reason ? ` (${health.reason})` : "";
  const recovery = health.recovery
    ? ` Recovery: ${health.recovery}.`
    : health.status === "stale-owner"
      ? " Recovery: Run tap_register_capabilities from the target runtime with the conversationId and omit ownerClientId."
      : health.status === "partial"
        ? " Recovery: Register a complete conversationId + ownerClientId tuple before retrying."
        : "";
  return `⚠️ ${routingAddress} prefers consent-drive but runtime health is ${health.status}${reason}.${recovery} Falling back to inbox delivery.`;
}

function buildRuntimeHealthFallbackResult(
  routingAddress: string,
  health: CodexBindingRuntimeHealth | null,
): TapReplyRoutingResult | null {
  if (!health) return null;
  const warning = buildRuntimeHealthFallbackWarning(routingAddress, health);
  return warning ? buildDriveFallbackResult(warning) : null;
}

function formatStaleBindingRecovery(
  routingAddress: string,
  candidates: CodexBinding[],
): string {
  const [candidate] = candidates;
  const detail = candidate
    ? ` lastSeenAt=${candidate.lastSeenAt ?? "unknown"}; staleReason=${candidate.staleReason ?? "unknown"}; hostId=${candidate.hostId ?? "unknown"}.`
    : "";
  return (
    `⚠️ ${routingAddress} prefers consent-drive and is visible, but only stale-visible Codex presence matched; it is not fresh-for-routing.` +
    detail +
    " Recovery: run tap:presence-publish -- --check-only from the hub to confirm whether the target runtime needs warm-up or only central publication; then warm up the target runtime if needed, publish fresh presence, and retry. Falling back to inbox delivery."
  );
}

function isNoClientFoundError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("no-client-found");
}

function isRecipientActiveTurnError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("active in-progress turn") ||
    message.includes("recipient-active-turn")
  );
}

function trustedDeviceLeaseGateEnabled(options: TapReplyRoutingInput): boolean {
  if (options.trustedDeviceLeases?.enabled !== undefined) {
    return options.trustedDeviceLeases.enabled;
  }
  const normalized =
    process.env.TAP_CONSENT_TRUSTED_DEVICE_LEASES?.trim().toLowerCase();
  return Boolean(
    normalized && !["0", "false", "no", "off"].includes(normalized),
  );
}

function formatTrustedDeviceLeaseWarning(
  routingAddress: string,
  gate: TrustedDeviceLeaseGateResult,
): string {
  const reason = gate.reason ? ` (${gate.reason})` : "";
  const message = gate.message ? ` ${gate.message}` : "";
  return `⚠️ ${routingAddress} prefers consent-drive but trusted-device lease verification failed${reason}.${message} Falling back to inbox delivery.`;
}

function writeTrustedDeviceLeaseRejection(options: {
  route: TapReplyRoutingInput;
  hostId: string | null;
  conversationId: string | null;
  ownerClientId: string | null;
  reason: string | null;
}): void {
  writeConsentLedgerEvent({
    commsDir: options.route.commsDir,
    event: "rejected",
    grantId: null,
    scope: "drive",
    method: "thread-follower-start-turn",
    hostId: options.hostId,
    conversationId: options.conversationId,
    recordedAt: new Date().toISOString(),
    result: `trusted-device-lease-${options.reason ?? "rejected"}`,
    requester: {
      hostId:
        options.route.trustedDeviceLeases?.requesterHostId ??
        options.route.localHostId ??
        null,
      clientId: options.route.sender.routingAddress,
    },
    owner: {
      hostId: options.hostId,
      conversationId: options.conversationId,
      ownerClientId: options.ownerClientId,
    },
  });
}

function checkTrustedDeviceLeaseForRoute(options: {
  route: TapReplyRoutingInput;
  targetHostId: string | null;
  conversationId: string | null;
  ownerClientId: string | null;
}): TapReplyRoutingResult | null {
  if (!trustedDeviceLeaseGateEnabled(options.route)) {
    return null;
  }
  const gate = checkTrustedDeviceLeaseGate({
    commsDir: options.route.commsDir,
    devicesDir: options.route.trustedDeviceLeases?.devicesDir,
    requesterDeviceId: options.route.trustedDeviceLeases?.requesterDeviceId,
    requesterHostId:
      options.route.trustedDeviceLeases?.requesterHostId ??
      options.route.localHostId,
    targetDeviceId: options.route.trustedDeviceLeases?.targetDeviceId,
    targetHostId: options.targetHostId,
    scope: "drive",
    target: "self-owned",
    now: options.route.now,
  });
  if (gate.ok) {
    return null;
  }
  if (!options.route.dryRun) {
    writeTrustedDeviceLeaseRejection({
      route: options.route,
      hostId: options.targetHostId,
      conversationId: options.conversationId,
      ownerClientId: options.ownerClientId,
      reason: gate.reason,
    });
  }
  return buildDriveFallbackResult(
    formatTrustedDeviceLeaseWarning(options.route.target.routingAddress, gate),
  );
}

function sameHost(
  bindingHostId: string | null | undefined,
  localHostId: string | null | undefined,
): boolean {
  const bindingHost = normalizeHostKey(bindingHostId);
  const localHost = normalizeHostKey(localHostId);
  return !bindingHost || !localHost || bindingHost === localHost;
}

async function refreshLocalOwnerBinding(
  binding: CodexBinding,
  options: TapReplyRoutingInput,
): Promise<CodexBinding | null> {
  const conversationId = binding.conversationId?.trim();
  if (!conversationId || !sameHost(binding.hostId, options.localHostId)) {
    return null;
  }
  const hostId = binding.hostId?.trim() || options.localHostId?.trim() || null;
  const discovery = await (
    options.ownerDiscovery ?? discoverCodexOwnerClientId
  )({
    conversationId,
    hostId,
  });
  if (discovery.status !== "found") {
    return null;
  }
  return {
    ...binding,
    hostId: discovery.hostId ?? hostId,
    clientId: discovery.ownerClientId,
    ownerClientId: discovery.ownerClientId,
    bindingStatus: "ready",
    staleReason: null,
    health: {
      status: "ready",
      reason: "owner-discovery-refresh",
      checkedAt: new Date().toISOString(),
      adapter: "codex-owner-discovery",
      recovery: null,
    },
    sources: [...new Set([...binding.sources, "observe" as const])],
    aliases: [...new Set([...binding.aliases, discovery.ownerClientId])],
  };
}

export async function routeTapReplyDelivery(
  options: TapReplyRoutingInput,
): Promise<TapReplyRoutingResult> {
  if (options.explicitEnvelope) {
    return buildDriveFallbackResult(
      `⚠️ ${options.target.routingAddress} includes explicit A2A envelope metadata. Current tap_reply treats explicit envelopes as inbox/audit evidence only and does not use them to bypass consent-drive routing. Falling back to inbox delivery.`,
    );
  }

  const receiveTransports = normalizeReceiveTransports(
    options.target.receiveTransports,
  );
  if (!prefersConsentDrive(receiveTransports)) {
    return buildDriveFallbackResult(null);
  }

  if (options.target.ambiguous) {
    return buildDriveFallbackResult(
      `⚠️ ${options.target.routingAddress} prefers consent-drive but recipient resolution was ambiguous. Falling back to inbox delivery.`,
    );
  }

  if (!options.commsDir) {
    return buildDriveFallbackResult(
      `⚠️ ${options.target.routingAddress} prefers consent-drive but TAP_COMMS_DIR is unavailable. Falling back to inbox delivery.`,
    );
  }

  const registry = buildCodexBindingRegistry({
    heartbeats: options.heartbeats ?? {},
    now: options.now,
    staleAfterMs: options.staleAfterMs,
  });
  const bindingResolution = resolveCodexBinding({
    registry,
    target: {
      routingAddress: options.target.routingAddress,
    },
    localHostId: options.localHostId,
  });
  const deliverLocalBinding = async (
    binding: CodexBinding,
    allowRefreshRetry = true,
  ): Promise<TapReplyRoutingResult> => {
    const healthFallback = buildRuntimeHealthFallbackResult(
      options.target.routingAddress,
      binding.health,
    );
    if (healthFallback) return healthFallback;

    const conversationId = binding.conversationId?.trim();
    const ownerClientId = binding.ownerClientId?.trim();
    const hostId =
      binding.hostId?.trim() || options.localHostId?.trim() || null;
    if (!conversationId || !ownerClientId) {
      return buildDriveFallbackResult(
        `⚠️ ${options.target.routingAddress} prefers consent-drive but its live routing metadata is incomplete. Falling back to inbox delivery.`,
      );
    }

    if (options.dryRun) {
      const leaseFallback = checkTrustedDeviceLeaseForRoute({
        route: options,
        targetHostId: hostId,
        conversationId,
        ownerClientId,
      });
      if (leaseFallback) return leaseFallback;
      return {
        transport: "consent-drive",
        delivered: false,
        fallbackToInbox: false,
        turnId: null,
        consentRef: null,
        warning: null,
        dryRun: true,
      };
    }

    const leaseFallback = checkTrustedDeviceLeaseForRoute({
      route: options,
      targetHostId: hostId,
      conversationId,
      ownerClientId,
    });
    if (leaseFallback) return leaseFallback;

    const transportFactory =
      options.transportFactory ?? defaultTransportFactory;
    const transport = transportFactory({
      commsDir: options.commsDir,
      hostId,
    });

    try {
      await transport.connect();
      const created = transport.createConsentReceipt({
        conversationId,
        hostId,
        ownerClientId,
        allowedMethods: ["thread-follower-start-turn"],
      });
      const result = await transport.startTurn({
        conversationId,
        text: buildTapMessagePrompt({
          agentName:
            options.target.displayName?.trim() || options.target.routingAddress,
          sender: options.sender.displayName,
          recipient:
            options.target.displayName?.trim() || options.target.routingAddress,
          subject: options.subject,
          fileName: options.fileName,
          body: options.content,
          replyTo: options.sender.routingAddress,
        }),
        consentRef: created.receipt.id,
        hostId,
        ownerClientId,
        action: "start-turn",
      });

      return {
        transport: "consent-drive",
        delivered: true,
        fallbackToInbox: false,
        turnId: extractTurnId(result),
        consentRef: created.receipt.id,
        warning: null,
      };
    } catch (error) {
      if (isNoClientFoundError(error)) {
        if (allowRefreshRetry) {
          const refreshed = await refreshLocalOwnerBinding(binding, options);
          if (
            refreshed?.ownerClientId &&
            refreshed.ownerClientId !== ownerClientId
          ) {
            await transport.disconnect().catch(() => undefined);
            return await deliverLocalBinding(refreshed, false);
          }
        }
        return buildDriveFallbackResult(
          `⚠️ consent-drive delivery to ${options.target.routingAddress} failed because the Codex ownerClientId appears stale (no-client-found). Run tap_register_capabilities from the target runtime with the conversationId and omit ownerClientId. Falling back to inbox delivery.`,
        );
      }
      return buildDriveFallbackResult(
        `⚠️ consent-drive delivery to ${options.target.routingAddress} failed (${error instanceof Error ? error.message : String(error)}). Falling back to inbox delivery.`,
      );
    } finally {
      await transport.disconnect().catch(() => undefined);
    }
  };

  if (bindingResolution.status === "blocked") {
    if (bindingResolution.candidates.length === 1) {
      const healthFallback = buildRuntimeHealthFallbackResult(
        options.target.routingAddress,
        bindingResolution.candidates[0].health,
      );
      if (healthFallback) return healthFallback;
    }

    if (
      (bindingResolution.reason === "partial" ||
        bindingResolution.reason === "binding-mismatch" ||
        bindingResolution.reason === "stale") &&
      bindingResolution.candidates.length === 1
    ) {
      const refreshed = await refreshLocalOwnerBinding(
        bindingResolution.candidates[0],
        options,
      );
      if (refreshed) {
        return await deliverLocalBinding(refreshed, false);
      }
    }

    if (bindingResolution.reason === "stale") {
      return buildDriveFallbackResult(
        formatStaleBindingRecovery(
          options.target.routingAddress,
          bindingResolution.candidates,
        ),
      );
    }

    if (bindingResolution.reason === "not-reachable") {
      const remoteCandidate =
        bindingResolution.candidates.length === 1
          ? bindingResolution.candidates[0]
          : null;
      const remoteHostId = remoteCandidate?.hostId?.trim() || null;
      const remoteConversationId =
        remoteCandidate?.conversationId?.trim() || null;
      const remoteOwnerClientId =
        remoteCandidate?.ownerClientId?.trim() || null;
      if (remoteCandidate) {
        const healthFallback = buildRuntimeHealthFallbackResult(
          options.target.routingAddress,
          remoteCandidate.health,
        );
        if (healthFallback) return healthFallback;
      }
      const remoteConfig = resolveRemoteHostConfig(
        remoteHostId,
        options.remoteHosts,
      );
      if (!remoteConfig) {
        return buildDriveFallbackResult(
          `⚠️ ${options.target.routingAddress} prefers consent-drive but target host is remote/unmapped (${remoteHostId ?? "unknown"}). Falling back to inbox delivery.`,
        );
      }
      if (!remoteCandidate || !remoteConversationId || !remoteOwnerClientId) {
        return buildDriveFallbackResult(
          `⚠️ ${options.target.routingAddress} prefers consent-drive but its remote routing metadata is incomplete. Falling back to inbox delivery.`,
        );
      }
      if (options.dryRun) {
        const leaseFallback = checkTrustedDeviceLeaseForRoute({
          route: options,
          targetHostId: remoteHostId,
          conversationId: remoteConversationId,
          ownerClientId: remoteOwnerClientId,
        });
        if (leaseFallback) return leaseFallback;
        return {
          transport: "consent-drive",
          delivered: false,
          fallbackToInbox: false,
          turnId: null,
          consentRef: null,
          warning: null,
          dryRun: true,
        };
      }

      const leaseFallback = checkTrustedDeviceLeaseForRoute({
        route: options,
        targetHostId: remoteHostId,
        conversationId: remoteConversationId,
        ownerClientId: remoteOwnerClientId,
      });
      if (leaseFallback) return leaseFallback;

      try {
        const text = buildTapMessagePrompt({
          agentName:
            options.target.displayName?.trim() || options.target.routingAddress,
          sender: options.sender.displayName,
          recipient:
            options.target.displayName?.trim() || options.target.routingAddress,
          subject: options.subject,
          fileName: options.fileName,
          body: options.content,
          replyTo: options.sender.routingAddress,
        });
        const result = await (
          options.remoteRelayExecutor ?? defaultRemoteRelayExecutor
        )({
          config: remoteConfig,
          target: {
            routingAddress: remoteCandidate.routingAddress,
            hostId: remoteHostId,
            conversationId: remoteConversationId,
            ownerClientId: remoteOwnerClientId,
          },
          sender: options.sender,
          subject: options.subject,
          content: options.content,
          fileName: options.fileName,
          text,
        });
        return {
          transport: "consent-drive",
          delivered: true,
          fallbackToInbox: false,
          turnId: result.turnId,
          consentRef: result.consentRef,
          warning: null,
        };
      } catch (error) {
        if (isNoClientFoundError(error)) {
          return buildDriveFallbackResult(
            `⚠️ remote consent-drive relay to ${options.target.routingAddress} failed because the Codex ownerClientId appears stale (no-client-found). Run tap_register_capabilities from the target runtime with the conversationId and omit ownerClientId. Falling back to inbox delivery.`,
          );
        }
        if (isRecipientActiveTurnError(error)) {
          return buildDriveFallbackResult(
            `⚠️ remote consent-drive relay to ${options.target.routingAddress} was blocked because the recipient conversation has an active in-progress turn. Wait for the target turn to finish, interrupt the stuck turn if needed, or use a future steer path. Falling back to inbox delivery. Detail: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
        return buildDriveFallbackResult(
          `⚠️ remote consent-drive relay to ${options.target.routingAddress} failed (${error instanceof Error ? error.message : String(error)}). Falling back to inbox delivery.`,
        );
      }
    }
    return buildDriveFallbackResult(
      `⚠️ ${options.target.routingAddress} prefers consent-drive but Codex binding resolution was blocked (${bindingResolution.reason}: ${bindingResolution.message}). Falling back to inbox delivery.`,
    );
  }

  return await deliverLocalBinding(bindingResolution.binding);
}
