import * as fs from "node:fs";
import * as path from "node:path";
import type {
  ObserveTransport,
  ObserveTransportAgent,
  ObserveTransportConversation,
  ObserveTransportEvent,
  ObserveTransportListener,
  ObserveTransportSnapshot,
  TransportAddress,
} from "./types.js";
import { normalizeReceiveTransports } from "../routing/receive-transports.js";

type FileHeartbeatRecord = {
  id?: string;
  agent?: string;
  status?: string;
  source?: string;
  timestamp?: string;
  lastActivity?: string;
  instanceId?: string | null;
  receiveTransports?: string[];
  address?: {
    hostId?: string | null;
    clientId?: string | null;
    conversationId?: string | null;
    ownerClientId?: string | null;
  };
};

export interface FileObserveTransportOptions {
  commsDir: string;
  hostId?: string | null;
  watchIntervalMs?: number;
}

function resolveHostId(explicitHostId?: string | null): string | null {
  const normalizedExplicit = explicitHostId?.trim();
  if (normalizedExplicit) return normalizedExplicit;

  const computerName = process.env.COMPUTERNAME?.trim();
  if (computerName) return computerName;

  const hostName = process.env.HOSTNAME?.trim();
  if (hostName) return hostName;

  return null;
}

function normalizeAddress(
  heartbeat: FileHeartbeatRecord,
  hostId: string | null,
): TransportAddress {
  return {
    hostId: heartbeat.address?.hostId ?? hostId,
    clientId:
      heartbeat.address?.clientId ?? heartbeat.instanceId?.trim() ?? null,
    conversationId: heartbeat.address?.conversationId ?? null,
    ownerClientId: heartbeat.address?.ownerClientId ?? null,
  };
}

function compareById(a: { id: string }, b: { id: string }): number {
  return a.id.localeCompare(b.id);
}

export class FileObserveTransport implements ObserveTransport {
  readonly kind = "file-observe";

  private readonly heartbeatsPath: string;
  private readonly hostId: string | null;
  private readonly watchIntervalMs: number;
  private readonly listeners = new Set<ObserveTransportListener>();
  private watching = false;
  private snapshot: ObserveTransportSnapshot = {
    transport: this.kind,
    connected: false,
    connectedAt: null,
    agents: [],
    conversations: [],
  };

  constructor(options: FileObserveTransportOptions) {
    this.heartbeatsPath = path.join(options.commsDir, "heartbeats.json");
    this.hostId = resolveHostId(options.hostId);
    this.watchIntervalMs = options.watchIntervalMs ?? 500;
  }

  async connect(): Promise<ObserveTransportSnapshot> {
    const connectedAt = new Date().toISOString();
    this.snapshot = {
      ...this.buildSnapshot(),
      connected: true,
      connectedAt,
    };
    this.startWatching();
    this.emit({
      kind: "transport-connected",
      receivedAt: connectedAt,
      method: null,
      sourceAddress: {
        hostId: this.hostId,
        clientId: null,
        conversationId: null,
        ownerClientId: null,
      },
      payload: { heartbeatsPath: this.heartbeatsPath },
      snapshot: this.snapshot,
    });
    return this.snapshot;
  }

  async disconnect(): Promise<void> {
    this.stopWatching();
    const disconnectedAt = new Date().toISOString();
    this.snapshot = {
      ...this.snapshot,
      connected: false,
      connectedAt: null,
    };
    this.emit({
      kind: "transport-disconnected",
      receivedAt: disconnectedAt,
      method: null,
      sourceAddress: {
        hostId: this.hostId,
        clientId: null,
        conversationId: null,
        ownerClientId: null,
      },
      payload: null,
      snapshot: this.snapshot,
    });
  }

  getSnapshot(): ObserveTransportSnapshot {
    return this.snapshot;
  }

  subscribe(listener: ObserveTransportListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private readonly handleHeartbeatsChanged = (
    current: fs.Stats,
    previous: fs.Stats,
  ) => {
    if (!this.snapshot.connected) return;
    if (
      current.mtimeMs === previous.mtimeMs &&
      current.ctimeMs === previous.ctimeMs &&
      current.size === previous.size
    ) {
      return;
    }

    const nextSnapshot = {
      ...this.buildSnapshot(),
      connected: true,
      connectedAt: this.snapshot.connectedAt,
    };
    const previousState = JSON.stringify({
      agents: this.snapshot.agents,
      conversations: this.snapshot.conversations,
    });
    const nextState = JSON.stringify({
      agents: nextSnapshot.agents,
      conversations: nextSnapshot.conversations,
    });
    if (previousState === nextState) {
      this.snapshot = nextSnapshot;
      return;
    }

    this.snapshot = nextSnapshot;
    this.emit({
      kind: "raw",
      receivedAt: new Date().toISOString(),
      method: "heartbeats-changed",
      sourceAddress: {
        hostId: this.hostId,
        clientId: null,
        conversationId: null,
        ownerClientId: null,
      },
      payload: { heartbeatsPath: this.heartbeatsPath },
      snapshot: this.snapshot,
    });
  };

  private buildSnapshot(): ObserveTransportSnapshot {
    const store = this.loadHeartbeats();
    const agents: ObserveTransportAgent[] = [];
    const conversations = new Map<string, ObserveTransportConversation>();

    for (const [heartbeatKey, heartbeat] of Object.entries(store)) {
      const id = heartbeat.id?.trim() || heartbeatKey;
      const address = normalizeAddress(heartbeat, this.hostId);

      agents.push({
        id,
        name: heartbeat.agent?.trim() || null,
        address,
        metadata: {
          status: heartbeat.status ?? null,
          source: heartbeat.source ?? null,
          lastActivity: heartbeat.lastActivity ?? heartbeat.timestamp ?? null,
          receiveTransports: normalizeReceiveTransports(
            heartbeat.receiveTransports,
          ),
        },
      });

      if (!address.conversationId) continue;

      const existingConversation = conversations.get(address.conversationId);
      const participantIds = new Set<string>(
        Array.isArray(existingConversation?.metadata.participantClientIds)
          ? (existingConversation?.metadata.participantClientIds as string[])
          : [],
      );
      participantIds.add(address.clientId ?? id);

      conversations.set(address.conversationId, {
        id: address.conversationId,
        address: {
          hostId: address.hostId,
          clientId: address.clientId,
          conversationId: address.conversationId,
          ownerClientId:
            address.ownerClientId ??
            existingConversation?.address.ownerClientId ??
            null,
        },
        metadata: {
          participantClientIds: [...participantIds].sort(),
          lastActivity:
            heartbeat.lastActivity ??
            heartbeat.timestamp ??
            existingConversation?.metadata.lastActivity ??
            null,
        },
      });
    }

    return {
      transport: this.kind,
      connected: this.snapshot.connected,
      connectedAt: this.snapshot.connectedAt,
      agents: agents.sort(compareById),
      conversations: [...conversations.values()].sort(compareById),
    };
  }

  private startWatching(): void {
    if (this.watching) return;
    fs.watchFile(
      this.heartbeatsPath,
      { interval: this.watchIntervalMs },
      this.handleHeartbeatsChanged,
    );
    this.watching = true;
  }

  private stopWatching(): void {
    if (!this.watching) return;
    fs.unwatchFile(this.heartbeatsPath, this.handleHeartbeatsChanged);
    this.watching = false;
  }

  private loadHeartbeats(): Record<string, FileHeartbeatRecord> {
    if (!fs.existsSync(this.heartbeatsPath)) {
      return {};
    }

    try {
      return JSON.parse(
        fs.readFileSync(this.heartbeatsPath, "utf-8"),
      ) as Record<string, FileHeartbeatRecord>;
    } catch {
      return {};
    }
  }

  private emit(event: ObserveTransportEvent): void {
    for (const listener of this.listeners) {
      void listener(event);
    }
  }
}

export function createFileObserveTransport(
  options: FileObserveTransportOptions,
): ObserveTransport {
  return new FileObserveTransport(options);
}
