import {
  createExperimentalCodexIpcObserveTransport,
  type CodexIpcObserveTransportOptions,
} from "../transport/experimental/codex-ipc-observe.js";
import { isCodexIpcDefaultSupported } from "../transport/experimental/codex-ipc-endpoint.js";
import type {
  ObserveTransport,
  ObserveTransportSnapshot,
} from "../transport/types.js";

export type CodexOwnerDiscoveryResult =
  | {
      status: "found";
      conversationId: string;
      ownerClientId: string;
      hostId: string | null;
      source: "snapshot" | "event";
    }
  | {
      status: "not-found";
      conversationId: string;
      message: string;
    }
  | {
      status: "unavailable";
      conversationId: string;
      message: string;
    };

export interface DiscoverCodexOwnerClientIdOptions {
  conversationId: string;
  hostId?: string | null;
  timeoutMs?: number;
  transport?: ObserveTransport;
  transportFactory?: (
    options: CodexIpcObserveTransportOptions,
  ) => ObserveTransport;
}

const DEFAULT_DISCOVERY_TIMEOUT_MS = 3_000;

function normalizeString(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function resolveTimeoutMs(explicitTimeoutMs: number | undefined): number {
  if (typeof explicitTimeoutMs === "number" && explicitTimeoutMs > 0) {
    return explicitTimeoutMs;
  }
  const envValue = Number(process.env.TAP_CODEX_OWNER_DISCOVERY_TIMEOUT_MS);
  if (Number.isFinite(envValue) && envValue > 0) {
    return envValue;
  }
  return DEFAULT_DISCOVERY_TIMEOUT_MS;
}

function isDiscoverySupported(): boolean {
  const override = process.env.TAP_CODEX_OWNER_DISCOVERY?.trim().toLowerCase();
  if (override === "1" || override === "true" || override === "yes") {
    return true;
  }
  if (override === "0" || override === "false" || override === "no") {
    return false;
  }
  return isCodexIpcDefaultSupported();
}

function findOwnerInSnapshot(
  snapshot: ObserveTransportSnapshot,
  conversationId: string,
): Pick<
  Extract<CodexOwnerDiscoveryResult, { status: "found" }>,
  "ownerClientId" | "hostId"
> | null {
  if (!snapshot.connected) return null;
  const conversation = snapshot.conversations.find(
    (candidate) => candidate.id === conversationId,
  );
  const ownerClientId = normalizeString(conversation?.address.ownerClientId);
  if (!ownerClientId) return null;
  return {
    ownerClientId,
    hostId: normalizeString(conversation?.address.hostId),
  };
}

async function waitForOwner(options: {
  transport: ObserveTransport;
  conversationId: string;
  timeoutMs: number;
}): Promise<Extract<CodexOwnerDiscoveryResult, { status: "found" }> | null> {
  return await new Promise((resolve) => {
    const unsubscribe = options.transport.subscribe((event) => {
      const found = findOwnerInSnapshot(event.snapshot, options.conversationId);
      if (!found) return;
      cleanup();
      resolve({
        status: "found",
        conversationId: options.conversationId,
        ownerClientId: found.ownerClientId,
        hostId: found.hostId,
        source: "event",
      });
    });
    const timeout = setTimeout(() => {
      cleanup();
      resolve(null);
    }, options.timeoutMs);

    function cleanup(): void {
      clearTimeout(timeout);
      unsubscribe();
    }
  });
}

export async function discoverCodexOwnerClientId(
  options: DiscoverCodexOwnerClientIdOptions,
): Promise<CodexOwnerDiscoveryResult> {
  const conversationId = normalizeString(options.conversationId);
  if (!conversationId) {
    return {
      status: "unavailable",
      conversationId: "",
      message: "conversationId is required for Codex owner discovery.",
    };
  }

  if (
    !isDiscoverySupported() &&
    !options.transport &&
    !options.transportFactory
  ) {
    return {
      status: "unavailable",
      conversationId,
      message:
        "Codex owner discovery is only enabled on Windows/macOS IPC hosts by default.",
    };
  }

  const timeoutMs = resolveTimeoutMs(options.timeoutMs);
  const transport =
    options.transport ??
    options.transportFactory?.({
      hostId: options.hostId,
      requestTimeoutMs: timeoutMs,
    }) ??
    createExperimentalCodexIpcObserveTransport({
      hostId: options.hostId,
      requestTimeoutMs: timeoutMs,
    });
  const ownsTransport = !options.transport;

  try {
    const snapshot = await transport.connect();
    const found = findOwnerInSnapshot(snapshot, conversationId);
    if (found) {
      return {
        status: "found",
        conversationId,
        ownerClientId: found.ownerClientId,
        hostId: found.hostId,
        source: "snapshot",
      };
    }

    const eventFound = await waitForOwner({
      transport,
      conversationId,
      timeoutMs,
    });
    if (eventFound) return eventFound;

    return {
      status: "not-found",
      conversationId,
      message: `No live Codex ownerClientId observed for conversationId ${conversationId}.`,
    };
  } catch (error) {
    return {
      status: "unavailable",
      conversationId,
      message:
        error instanceof Error
          ? error.message
          : String(error ?? "Codex owner discovery failed."),
    };
  } finally {
    if (ownsTransport) {
      await transport.disconnect().catch(() => undefined);
    }
  }
}
