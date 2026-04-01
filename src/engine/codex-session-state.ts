import * as fs from "node:fs";
import * as path from "node:path";
import type { RuntimeBridgeHeartbeat } from "./bridge-state.js";

export type CodexSessionTurnState =
  | "active"
  | "idle"
  | "waiting-approval"
  | "disconnected";

export type CodexSessionStatus =
  | "initializing"
  | "active"
  | "idle"
  | "waiting-approval"
  | "disconnected";

export interface CodexSessionSnapshot {
  status: CodexSessionStatus;
  turnState: CodexSessionTurnState | null;
  summary: string;
  activeTurnId: string | null;
  lastTurnAt: string | null;
  lastDispatchAt: string | null;
  idleSince: string | null;
  connected: boolean | null;
  initialized: boolean | null;
}

interface LastDispatchRecord {
  dispatchedAt?: string;
}

export interface DeriveCodexSessionOptions {
  runtimeHeartbeat?: RuntimeBridgeHeartbeat | null;
  runtimeStateDir?: string | null;
}

function readLastDispatchAt(
  runtimeStateDir: string | null | undefined,
): string | null {
  if (!runtimeStateDir) return null;

  const filePath = path.join(runtimeStateDir, "last-dispatch.json");
  if (!fs.existsSync(filePath)) return null;

  try {
    const parsed = JSON.parse(
      fs.readFileSync(filePath, "utf-8"),
    ) as LastDispatchRecord;
    return typeof parsed.dispatchedAt === "string" ? parsed.dispatchedAt : null;
  } catch {
    return null;
  }
}

function formatIdleSummary(idleSince: string | null): string {
  if (!idleSince) return "idle";
  return `idle since ${idleSince}`;
}

export function deriveCodexSessionState(
  options: DeriveCodexSessionOptions,
): CodexSessionSnapshot {
  const runtimeHeartbeat = options.runtimeHeartbeat ?? null;

  if (!runtimeHeartbeat) {
    return {
      status: "initializing",
      turnState: null,
      summary: "initializing",
      activeTurnId: null,
      lastTurnAt: null,
      lastDispatchAt: null,
      idleSince: null,
      connected: null,
      initialized: null,
    };
  }

  const turnState = runtimeHeartbeat.turnState ?? null;
  const activeTurnId = runtimeHeartbeat.activeTurnId ?? null;
  const lastTurnAt = runtimeHeartbeat.lastTurnAt ?? null;
  const lastDispatchAt =
    runtimeHeartbeat.lastDispatchAt ??
    readLastDispatchAt(options.runtimeStateDir) ??
    null;
  const idleSince = runtimeHeartbeat.idleSince ?? null;
  const connected = runtimeHeartbeat.connected ?? null;
  const initialized = runtimeHeartbeat.initialized ?? null;

  if (initialized === false) {
    return {
      status: "initializing",
      turnState,
      summary: "initializing",
      activeTurnId,
      lastTurnAt,
      lastDispatchAt,
      idleSince,
      connected,
      initialized,
    };
  }

  if (turnState === "active" || activeTurnId) {
    return {
      status: "active",
      turnState: "active",
      summary: activeTurnId ? `active turn ${activeTurnId}` : "active",
      activeTurnId,
      lastTurnAt,
      lastDispatchAt,
      idleSince: null,
      connected,
      initialized,
    };
  }

  if (turnState === "waiting-approval") {
    return {
      status: "waiting-approval",
      turnState,
      summary: `waiting-approval (${formatIdleSummary(idleSince)})`,
      activeTurnId,
      lastTurnAt,
      lastDispatchAt,
      idleSince,
      connected,
      initialized,
    };
  }

  if (turnState === "disconnected" || connected === false) {
    return {
      status: "disconnected",
      turnState: "disconnected",
      summary: "disconnected",
      activeTurnId,
      lastTurnAt,
      lastDispatchAt,
      idleSince: null,
      connected,
      initialized,
    };
  }

  return {
    status: "idle",
    turnState: turnState === "idle" ? turnState : "idle",
    summary: formatIdleSummary(idleSince),
    activeTurnId,
    lastTurnAt,
    lastDispatchAt,
    idleSince,
    connected,
    initialized,
  };
}
