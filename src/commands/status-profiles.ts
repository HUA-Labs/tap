export type AgentProfileId = string;

interface BaseProfileConfig {
  id: AgentProfileId;
  label: string;
  agent: string;
  runtimeSurface: "codex-cli" | "remote-panel";
  repoRoot: string;
  commsDir: string;
  sshTarget?: string;
}

export interface FlowSupervisorConfig {
  id: string;
  label: string;
  host: string;
  tmuxSession: string;
  startCommand: string;
  statusCommand: string;
}

export interface HeadlessRunnerStatusConfig {
  profile: string;
  tmuxSession: string;
  startCommand: string;
  stopCommand: string;
  statusCommand: string;
}

export interface CliProfileConfig extends BaseProfileConfig {
  kind: "codex-cli";
  runtimeSurface: "codex-cli";
  expectedPermissionMode: "safe" | "full";
  receiverSession: string;
  receiverLogPath: string;
  supervisorStateName: string;
  appServerUrl: string;
  flowSupervisors?: FlowSupervisorConfig[];
  headlessRunner?: HeadlessRunnerStatusConfig;
}

export interface RemotePanelProfileConfig extends BaseProfileConfig {
  kind: "remote-panel";
  runtimeSurface: "remote-panel";
  host: string;
  port: number;
  readOnly: boolean;
  sendEnabled: boolean;
  tokenEnv?: string;
}

export type ProfileConfig = CliProfileConfig | RemotePanelProfileConfig;

// Public package builds intentionally ship no HUA-local operator profiles.
// Operators can provide private profile data through an explicit profile pack.
export const AGENT_PROFILES: Record<AgentProfileId, ProfileConfig> = {};
