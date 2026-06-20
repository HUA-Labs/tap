import { randomUUID } from "node:crypto";
import type {
  ObserveTransportConversation,
  TransportAddress,
} from "../types.js";
import {
  createConsentReceipt,
  DEFAULT_CONSENT_TTL_SECONDS,
  prepareConsentReceipt,
  type CapabilityScope,
  type ConsentReceipt,
  type CreateConsentReceiptOptions,
  type CreatedConsentReceipt,
  type PreparedConsentReceipt,
} from "../consent.js";
import { writeConsentLedgerEvent } from "../consent-ledger.js";
import {
  ExperimentalCodexIpcObserveTransport,
  type CodexIpcObserveTransportOptions,
  type CodexIpcResponseMessage,
} from "./codex-ipc-observe.js";

type JsonRecord = Record<string, unknown>;

function asJsonRecord(value: unknown): JsonRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as JsonRecord;
}

export const CODEX_IPC_DRIVE_METHODS = [
  "thread-follower-start-turn",
  "thread-follower-steer-turn",
  "thread-follower-interrupt-turn",
  "thread-follower-edit-last-user-turn",
  "thread-follower-submit-user-input",
  "thread-follower-submit-mcp-server-elicitation-response",
  "thread-follower-command-approval-decision",
  "thread-follower-file-approval-decision",
  "thread-follower-permissions-request-approval-response",
  "thread-follower-compact-thread",
  "thread-follower-set-model-and-reasoning",
  "thread-follower-set-collaboration-mode",
  "thread-follower-set-queued-follow-ups-state",
] as const;

/**
 * Methods subject to the Stability Guard (single-flight lock + cooldown).
 * Only turn-starting actions risk the rapid-overdrive freeze; recovery and
 * response methods (interrupt, approval decisions, etc.) must always pass
 * through to avoid blocking fault-recovery paths.
 */
const STABILITY_GUARDED_METHODS: ReadonlySet<string> = new Set([
  "thread-follower-start-turn",
]);

interface StabilityGuardLock {
  timer: NodeJS.Timeout | null;
}

const globalLocksKey = Symbol.for("tap-comms:conversationLocks");
const globalDriveTimeKey = Symbol.for("tap-comms:conversationLastDriveTime");
const globalStabilityGuardStore = globalThis as typeof globalThis &
  Record<symbol, unknown>;

const sharedConversationLocks: Map<string, StabilityGuardLock> =
  (globalStabilityGuardStore[globalLocksKey] as
    | Map<string, StabilityGuardLock>
    | undefined) ?? new Map<string, StabilityGuardLock>();
if (!globalStabilityGuardStore[globalLocksKey]) {
  globalStabilityGuardStore[globalLocksKey] = sharedConversationLocks;
}

const sharedConversationLastDriveTime: Map<string, number> =
  (globalStabilityGuardStore[globalDriveTimeKey] as
    | Map<string, number>
    | undefined) ?? new Map<string, number>();
if (!globalStabilityGuardStore[globalDriveTimeKey]) {
  globalStabilityGuardStore[globalDriveTimeKey] =
    sharedConversationLastDriveTime;
}

export function __resetCodexIpcStabilityGuardForTests(): void {
  for (const lock of sharedConversationLocks.values()) {
    if (lock.timer) {
      clearTimeout(lock.timer);
    }
  }
  sharedConversationLocks.clear();
  sharedConversationLastDriveTime.clear();
}

export type CodexIpcDriveMethod = (typeof CODEX_IPC_DRIVE_METHODS)[number];

export interface CodexIpcSuggestionDraft {
  id: string;
  createdAt: string;
  status: "pending-owner-approval";
  scope: "suggest";
  method: CodexIpcDriveMethod;
  action: string;
  conversationId: string;
  payload: JsonRecord | null;
  sourceAddress: TransportAddress;
  targetAddress: TransportAddress;
  consentRef: string | null;
}

export interface CodexIpcDriveActionResult {
  executedAt: string;
  scope: "drive";
  method: CodexIpcDriveMethod;
  action: string;
  conversationId: string;
  sourceAddress: TransportAddress;
  targetAddress: TransportAddress;
  consentRef: string;
  receipt: ConsentReceipt;
  response: CodexIpcResponseMessage;
}

export interface CodexIpcDraftActionOptions {
  conversationId: string;
  method: CodexIpcDriveMethod;
  params?: JsonRecord;
  action?: string;
  consentRef?: string | null;
}

export interface CodexIpcDriveActionOptions extends CodexIpcDraftActionOptions {
  hostId?: string | null;
  ownerClientId?: string | null;
}

export interface CodexIpcStartTurnOptions {
  conversationId: string;
  text: string;
  turnStartParams?: JsonRecord;
  hostId?: string | null;
  ownerClientId?: string | null;
}

export interface CodexIpcDriveStartTurnOptions extends CodexIpcStartTurnOptions {
  action?: string;
  consentRef?: string | null;
}

export interface CodexIpcCreateConsentReceiptOptions {
  conversationId: string;
  scope?: CapabilityScope;
  ttlSeconds?: number;
  allowedMethods?: readonly string[];
  ownerClientId?: string | null;
  hostId?: string | null;
}

export interface CodexIpcControlTransportOptions extends CodexIpcObserveTransportOptions {
  commsDir?: string;
  receiptsDir?: string;
  secretsDir?: string;
  defaultConsentTtlSeconds?: number;
  reservationOwnerId?: string | null;
}

function normalizeAddress(value: TransportAddress): TransportAddress {
  return {
    hostId: value.hostId?.trim() || null,
    clientId: value.clientId?.trim() || null,
    conversationId: value.conversationId?.trim() || null,
    ownerClientId: value.ownerClientId?.trim() || null,
  };
}

function isDriveMethod(method: string): method is CodexIpcDriveMethod {
  return (CODEX_IPC_DRIVE_METHODS as readonly string[]).includes(method);
}

function normalizeMethod(method: string): CodexIpcDriveMethod {
  const normalized = method.trim();
  if (!isDriveMethod(normalized)) {
    throw new Error(`Unsupported Codex IPC drive method "${method}".`);
  }
  return normalized;
}

function normalizeActionLabel(
  action: string | null | undefined,
  method: string,
): string {
  const normalized = action?.trim();
  return normalized || method;
}

function asRecord(value: unknown): JsonRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as JsonRecord;
}

function listRecordKeys(value: JsonRecord | null | undefined): string[] | null {
  if (!value) {
    return null;
  }
  return Object.keys(value);
}

function summarizeDriveParams(
  params: JsonRecord | null | undefined,
): JsonRecord {
  const turnStartParams = asRecord(params?.turnStartParams);
  const input = Array.isArray(turnStartParams?.input)
    ? turnStartParams.input
    : null;
  const textLength = input?.reduce((total, item) => {
    const record = asRecord(item);
    return total + (typeof record?.text === "string" ? record.text.length : 0);
  }, 0);

  return {
    paramKeys: listRecordKeys(params),
    turnStartParamKeys: listRecordKeys(turnStartParams),
    inputItemCount: input?.length ?? null,
    textLength: textLength ?? null,
  };
}

function extractDriveTurnId(response: CodexIpcResponseMessage): string | null {
  const result = asRecord(response.result);
  const nested = asRecord(result?.result);
  const turn = asRecord(result?.turn) ?? asRecord(nested?.turn);
  const turnId = turn?.id;
  return typeof turnId === "string" && turnId.trim() ? turnId.trim() : null;
}

function extractConversationLastTurnStatus(
  conversation: ObserveTransportConversation | null,
): string | null {
  const change = asRecord(conversation?.metadata.change);
  const turn = asRecord(change?.turn);
  const turnStatus = turn?.status;
  if (typeof turnStatus === "string" && turnStatus.trim()) {
    return turnStatus.trim();
  }

  const conversationState = asRecord(change?.conversationState);
  const turns = Array.isArray(conversationState?.turns)
    ? conversationState.turns
    : null;
  const lastTurn = turns?.length ? asRecord(turns[turns.length - 1]) : null;
  const lastStatus = lastTurn?.status;
  return typeof lastStatus === "string" && lastStatus.trim()
    ? lastStatus.trim()
    : null;
}

function extractRejectionResult(error: unknown): string {
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof (error as { code?: unknown }).code === "string"
  ) {
    return (error as { code: string }).code;
  }
  return "execution-rejected";
}

export function buildFollowerStartTurnParams(
  options: CodexIpcStartTurnOptions,
): JsonRecord {
  const turnStartParams = { ...(options.turnStartParams ?? {}) };
  const text = options.text.trim();
  if (!text) {
    throw new Error(
      "thread-follower-start-turn requires a non-empty text input.",
    );
  }

  const existingInput = Array.isArray(turnStartParams.input)
    ? turnStartParams.input
    : null;
  if (!existingInput) {
    turnStartParams.input = [
      {
        type: "text",
        text,
        text_elements: [],
      },
    ];
  }
  if (!Array.isArray(turnStartParams.attachments)) {
    turnStartParams.attachments = [];
  }
  if (!Array.isArray(turnStartParams.commentAttachments)) {
    turnStartParams.commentAttachments = [];
  }
  if (typeof turnStartParams.inheritThreadSettings !== "boolean") {
    turnStartParams.inheritThreadSettings = true;
  }

  return {
    conversationId: options.conversationId,
    turnStartParams,
  };
}

export class ExperimentalCodexIpcControlTransport extends ExperimentalCodexIpcObserveTransport {
  readonly kind = "experimental-codex-ipc-control";

  private readonly commsDir: string | undefined;
  private readonly receiptsDir: string | undefined;
  private readonly secretsDir: string | undefined;
  private readonly defaultConsentTtlSeconds: number;
  private readonly reservationOwnerId: string;

  private readonly conversationLocks = sharedConversationLocks;
  private readonly conversationLastDriveTime = sharedConversationLastDriveTime;
  private readonly COOLDOWN_MS = 10_000;
  private readonly LOCK_TIMEOUT_MS = 60_000;
  private readonly RECIPIENT_STATE_WAIT_MS = 750;

  constructor(options: CodexIpcControlTransportOptions = {}) {
    super({
      ...options,
      clientType: options.clientType ?? "tap-control",
    });
    this.commsDir = options.commsDir;
    this.receiptsDir = options.receiptsDir;
    this.secretsDir = options.secretsDir;
    this.defaultConsentTtlSeconds =
      options.defaultConsentTtlSeconds ?? DEFAULT_CONSENT_TTL_SECONDS;
    this.reservationOwnerId =
      options.reservationOwnerId?.trim() || randomUUID();

    this.subscribe((event) => {
      if (event.kind === "conversation-state") {
        const conversationId = event.sourceAddress.conversationId;
        if (!conversationId) return;

        const payload = asJsonRecord(event.payload);
        const params = asJsonRecord(payload?.params);
        const change = asJsonRecord(params?.change);
        const turn = asJsonRecord(change?.turn);

        if (turn) {
          const status = turn.status as string | undefined;
          this.trace("guard:observe-turn-status", {
            conversationId,
            turnId: turn.id,
            status,
          });

          if (
            status === "completed" ||
            status === "failed" ||
            status === "cancelled"
          ) {
            this.trace("guard:release-lock", {
              conversationId,
              turnId: turn.id,
              status,
            });
            this.releaseLock(conversationId);
          }
        }
      }
    });
  }

  private acquireLock(conversationId: string): void {
    const existing = this.conversationLocks.get(conversationId);
    if (existing?.timer) {
      clearTimeout(existing.timer);
    }
    const timer = setTimeout(() => {
      this.trace("guard:lock-timeout", { conversationId });
      this.conversationLocks.delete(conversationId);
    }, this.LOCK_TIMEOUT_MS);

    if (timer && typeof timer.unref === "function") {
      timer.unref();
    }

    this.conversationLocks.set(conversationId, { timer });
  }

  private releaseLock(conversationId: string): void {
    const existing = this.conversationLocks.get(conversationId);
    if (existing) {
      if (existing.timer) {
        clearTimeout(existing.timer);
      }
      this.conversationLocks.delete(conversationId);
    }
  }

  private getConversationSnapshot(
    conversationId: string,
  ): ObserveTransportConversation | null {
    return (
      this.getSnapshot().conversations.find(
        (conversation) => conversation.id === conversationId,
      ) ?? null
    );
  }

  private async waitForConversationSnapshot(
    conversationId: string,
  ): Promise<ObserveTransportConversation | null> {
    const existing = this.getConversationSnapshot(conversationId);
    if (existing) return existing;

    return await new Promise((resolve) => {
      let unsubscribe: (() => void) | null = null;
      const timeout = setTimeout(() => {
        unsubscribe?.();
        resolve(this.getConversationSnapshot(conversationId));
      }, this.RECIPIENT_STATE_WAIT_MS);
      if (typeof timeout.unref === "function") {
        timeout.unref();
      }

      unsubscribe = this.subscribe((event) => {
        if (
          event.kind !== "conversation-state" ||
          event.sourceAddress.conversationId !== conversationId
        ) {
          return;
        }
        clearTimeout(timeout);
        unsubscribe?.();
        resolve(
          event.snapshot.conversations.find(
            (conversation) => conversation.id === conversationId,
          ) ?? this.getConversationSnapshot(conversationId),
        );
      });
    });
  }

  private async assertRecipientCanStartTurn(
    conversationId: string,
    method: string,
  ): Promise<void> {
    const conversation = await this.waitForConversationSnapshot(conversationId);
    const lastStatus = extractConversationLastTurnStatus(conversation);
    if (lastStatus === "inProgress") {
      this.trace("guard:recipient-active-turn", {
        conversationId,
        method,
        lastStatus,
      });
      throw new Error(
        `[Stability Guard] Recipient conversation "${conversationId}" has an active in-progress turn; refusing "${method}" to avoid a stuck nested turn.`,
      );
    }
  }

  createConsentReceipt(
    options: CodexIpcCreateConsentReceiptOptions,
  ): CreatedConsentReceipt {
    const targetAddress = this.resolveConversationTargetAddress(
      options.conversationId,
      {
        hostId: options.hostId ?? null,
        ownerClientId: options.ownerClientId ?? null,
      },
    );

    const createOptions: CreateConsentReceiptOptions = {
      receiptsDir: this.receiptsDir,
      secretsDir: this.secretsDir,
      scope: options.scope ?? "drive",
      hostId: targetAddress.hostId,
      conversationId: options.conversationId,
      ownerClientId: targetAddress.ownerClientId,
      issuedByClientId: this.getOwnClientId(),
      ttlSeconds: options.ttlSeconds ?? this.defaultConsentTtlSeconds,
      allowedMethods: [...(options.allowedMethods ?? [])],
    };
    const created = createConsentReceipt(createOptions);
    writeConsentLedgerEvent({
      commsDir: this.commsDir,
      event: "issued",
      grantId: created.receipt.id,
      scope: created.receipt.scope,
      method:
        created.receipt.allowedMethods.length === 1
          ? created.receipt.allowedMethods[0]
          : null,
      hostId: created.receipt.hostId,
      conversationId: created.receipt.conversationId,
      issuedAt: created.receipt.createdAt,
      expiresAt: created.receipt.expiresAt,
      result: "granted",
      requester: this.buildSourceAddress(options.conversationId, targetAddress),
      owner: targetAddress,
      issuedByClientId: created.receipt.issuedByClientId,
    });
    return created;
  }

  createStartTurnSuggestion(
    options: CodexIpcStartTurnOptions & {
      action?: string;
      consentRef?: string | null;
    },
  ): CodexIpcSuggestionDraft {
    return this.createSuggestion({
      conversationId: options.conversationId,
      method: "thread-follower-start-turn",
      params: buildFollowerStartTurnParams(options),
      action: options.action ?? "start-turn",
      consentRef: options.consentRef ?? null,
    });
  }

  createSuggestion(
    options: CodexIpcDraftActionOptions,
  ): CodexIpcSuggestionDraft {
    const method = normalizeMethod(options.method);
    const targetAddress = this.resolveConversationTargetAddress(
      options.conversationId,
    );
    const sourceAddress = this.buildSourceAddress(
      options.conversationId,
      targetAddress,
    );

    return {
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      status: "pending-owner-approval",
      scope: "suggest",
      method,
      action: normalizeActionLabel(options.action, method),
      conversationId: options.conversationId,
      payload: options.params ?? null,
      sourceAddress,
      targetAddress,
      consentRef: options.consentRef?.trim() || null,
    };
  }

  async startTurn(
    options: CodexIpcDriveStartTurnOptions,
  ): Promise<CodexIpcDriveActionResult> {
    return this.driveAction({
      conversationId: options.conversationId,
      method: "thread-follower-start-turn",
      params: buildFollowerStartTurnParams(options),
      action: options.action ?? "start-turn",
      consentRef: options.consentRef ?? null,
      hostId: options.hostId ?? null,
      ownerClientId: options.ownerClientId ?? null,
    });
  }

  async driveAction(
    options: CodexIpcDriveActionOptions,
  ): Promise<CodexIpcDriveActionResult> {
    const method = normalizeMethod(options.method);
    const conversationId = options.conversationId.trim();
    const isGuarded = STABILITY_GUARDED_METHODS.has(method);

    const targetAddress = this.resolveConversationTargetAddress(
      conversationId,
      {
        hostId: options.hostId ?? null,
        ownerClientId: options.ownerClientId ?? null,
      },
    );
    const ownerClientId = targetAddress.ownerClientId?.trim();
    if (!ownerClientId) {
      throw new Error(
        `Conversation "${conversationId}" does not have a live ownerClientId.`,
      );
    }
    const sourceAddress = this.buildSourceAddress(
      conversationId,
      targetAddress,
    );
    this.trace("drive:prepare", {
      conversationId,
      method,
      action: normalizeActionLabel(options.action, method),
      consentRef: options.consentRef ?? null,
      hostId: targetAddress.hostId,
      ownerClientId,
      ...summarizeDriveParams(options.params),
    });

    let preparedReceipt: PreparedConsentReceipt | null = null;
    let guardLockAcquired = false;
    try {
      preparedReceipt = prepareConsentReceipt({
        receiptsDir: this.receiptsDir,
        secretsDir: this.secretsDir,
        consentRef: options.consentRef ?? null,
        requiredScope: "drive",
        method,
        hostId: targetAddress.hostId,
        conversationId,
        ownerClientId,
        reservationOwnerId: this.reservationOwnerId,
      });

      if (isGuarded) {
        await this.assertRecipientCanStartTurn(conversationId, method);

        if (this.conversationLocks.has(conversationId)) {
          this.trace("guard:locked", { conversationId, method });
          throw new Error(
            `[Stability Guard] Rejecting "${method}". Conversation "${conversationId}" has an active in-progress turn.`,
          );
        }

        const now = Date.now();
        const lastDrive =
          this.conversationLastDriveTime.get(conversationId) ?? 0;
        const elapsed = now - lastDrive;
        if (elapsed < this.COOLDOWN_MS) {
          const waitTime = this.COOLDOWN_MS - elapsed;
          this.trace("guard:cooldown", {
            conversationId,
            method,
            remainingMs: waitTime,
          });
          throw new Error(
            `[Stability Guard] Cooldown active for "${method}" on conversation "${conversationId}". Wait ${Math.ceil(waitTime / 1000)}s.`,
          );
        }

        this.acquireLock(conversationId);
        guardLockAcquired = true;
      }

      this.trace("drive:request", {
        conversationId,
        method,
        ownerClientId,
      });
      const response = await this.sendRequest(
        method,
        options.params,
        ownerClientId,
      );
      this.trace("drive:response", {
        conversationId,
        method,
        ownerClientId,
        turnId: extractDriveTurnId(response),
        resultType: response.resultType ?? null,
      });
      preparedReceipt.commit();
      if (isGuarded) {
        this.conversationLastDriveTime.set(conversationId, Date.now());
      }
      const executedAt = new Date().toISOString();
      writeConsentLedgerEvent({
        commsDir: this.commsDir,
        event: "consumed",
        grantId: preparedReceipt.receipt.id,
        scope: preparedReceipt.receipt.scope,
        method,
        hostId: targetAddress.hostId,
        conversationId,
        issuedAt: preparedReceipt.receipt.createdAt,
        expiresAt: preparedReceipt.receipt.expiresAt,
        consumedAt: executedAt,
        recordedAt: executedAt,
        result: "executed",
        requester: sourceAddress,
        owner: targetAddress,
        issuedByClientId: preparedReceipt.receipt.issuedByClientId,
      });

      return {
        executedAt,
        scope: "drive",
        method,
        action: normalizeActionLabel(options.action, method),
        conversationId,
        sourceAddress,
        targetAddress,
        consentRef: preparedReceipt.receipt.id,
        receipt: preparedReceipt.receipt,
        response,
      };
    } catch (error) {
      if (guardLockAcquired) this.releaseLock(conversationId);
      this.trace("drive:error", {
        conversationId,
        method,
        ownerClientId,
        error:
          error instanceof Error
            ? (error.stack ?? error.message)
            : String(error),
      });
      preparedReceipt?.abort();
      writeConsentLedgerEvent({
        commsDir: this.commsDir,
        event: "rejected",
        grantId: preparedReceipt?.receipt.id ?? options.consentRef ?? null,
        scope: preparedReceipt?.receipt.scope ?? "drive",
        method,
        hostId: targetAddress.hostId,
        conversationId,
        issuedAt: preparedReceipt?.receipt.createdAt ?? null,
        expiresAt: preparedReceipt?.receipt.expiresAt ?? null,
        recordedAt: new Date().toISOString(),
        result: extractRejectionResult(error),
        requester: sourceAddress,
        owner: targetAddress,
        issuedByClientId:
          preparedReceipt?.receipt.issuedByClientId ?? this.getOwnClientId(),
      });
      throw error;
    }
  }

  private resolveConversationTargetAddress(
    conversationId: string,
    fallback?: {
      hostId?: string | null;
      ownerClientId?: string | null;
    },
  ): TransportAddress {
    const normalizedConversationId = conversationId.trim();
    if (!normalizedConversationId) {
      throw new Error(
        "Codex IPC control actions require a non-empty conversationId.",
      );
    }

    const conversation = this.getSnapshot().conversations.find(
      (candidate) => candidate.id === normalizedConversationId,
    );
    if (conversation) {
      return normalizeAddress(conversation.address);
    }

    const ownerClientId = fallback?.ownerClientId?.trim() || null;
    const hostId = fallback?.hostId?.trim() || this.getHostId();
    if (!ownerClientId) {
      throw new Error(
        `Conversation "${normalizedConversationId}" is not present in the current observe snapshot.`,
      );
    }

    return {
      hostId,
      clientId: ownerClientId,
      conversationId: normalizedConversationId,
      ownerClientId,
    };
  }

  private buildSourceAddress(
    conversationId: string,
    targetAddress: TransportAddress,
  ): TransportAddress {
    return {
      hostId: this.getHostId(),
      clientId: this.getOwnClientId(),
      conversationId,
      ownerClientId: targetAddress.ownerClientId,
    };
  }
}

export function createExperimentalCodexIpcControlTransport(
  options: CodexIpcControlTransportOptions = {},
): ExperimentalCodexIpcControlTransport {
  return new ExperimentalCodexIpcControlTransport(options);
}
