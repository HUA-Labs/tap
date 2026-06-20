export type ReadyProfileId = string;

export interface ReadyProfileConfig {
  id: ReadyProfileId;
  surface: "codex-cli" | "remote-panel";
  agent: string;
  agentEnv?: string;
  command: string;
  appServerUrl?: string;
  host?: string;
  port?: number;
  sendEnabled?: boolean;
  tokenEnv?: string | null;
  source?: "built-in" | "profile-pack";
  profilePackPath?: string;
  allowApply?: boolean;
  supportsHeadlessRunner?: boolean;
  supportsLoadedThread?: boolean;
  loadedThreadAttachSessionName?: string;
}

// Public package builds intentionally ship no HUA-local ready profiles.
// Private operators can pass an explicit profile pack to surface reviewed
// local commands as data-only guidance.
export const READY_PROFILES: Record<ReadyProfileId, ReadyProfileConfig> = {};

export function parseReadyProfile(
  value: string | boolean | undefined,
): ReadyProfileConfig | null {
  if (typeof value !== "string") return null;
  return READY_PROFILES[value] ?? null;
}

export function supportsHeadlessRunnerProfile(
  profileId: ReadyProfileId,
): boolean {
  return READY_PROFILES[profileId]?.supportsHeadlessRunner === true;
}

export function supportsLoadedThreadProfile(
  profileId: ReadyProfileId,
): boolean {
  return READY_PROFILES[profileId]?.supportsLoadedThread === true;
}

export function buildHeadlessRunnerStartCommand(
  profileId: ReadyProfileId,
): string {
  return `bash scripts/tap-headless-runner-supervisor.sh ${profileId} --tmux`;
}

export function buildHeadlessRunnerStopCommand(
  profileId: ReadyProfileId,
): string {
  return `bash scripts/tap-headless-runner-supervisor.sh ${profileId} --stop`;
}

export function buildLoadedThreadAttachSessionName(
  profileId: ReadyProfileId,
): string {
  const configured = READY_PROFILES[profileId]?.loadedThreadAttachSessionName;
  if (configured) return configured;
  const safeId = profileId.replace(/[^A-Za-z0-9_-]+/g, "-");
  return `tap-codex-${safeId}-tui`;
}
