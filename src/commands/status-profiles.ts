export type AgentProfileId =
  | "sumback-yoon"
  | "sumback-sol"
  | "mac-jun-ssh-tui"
  | "remote-panel-yoon";

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
  id: "mac-jun-projection" | "mac-jun-uplink";
  label: string;
  host: "local" | "sum-back";
  tmuxSession: string;
  startCommand: string;
  statusCommand: string;
}

export interface HeadlessRunnerStatusConfig {
  profile: "sumback-yoon" | "sumback-sol" | "mac-jun-ssh-tui";
  tmuxSession: string;
  startCommand: string;
  stopCommand: string;
  statusCommand: string;
}

export interface CliProfileConfig extends BaseProfileConfig {
  kind: "codex-cli";
  id: "sumback-yoon" | "sumback-sol" | "mac-jun-ssh-tui";
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
  id: "remote-panel-yoon";
  runtimeSurface: "remote-panel";
  host: string;
  port: number;
  readOnly: boolean;
  sendEnabled: boolean;
  tokenEnv?: string;
}

export type ProfileConfig = CliProfileConfig | RemotePanelProfileConfig;

export const AGENT_PROFILES: Record<AgentProfileId, ProfileConfig> = {
  "sumback-yoon": {
    kind: "codex-cli",
    id: "sumback-yoon",
    label: "sum-back 윤 CLI/TUI receiver",
    agent: "윤",
    runtimeSurface: "codex-cli",
    expectedPermissionMode: "full",
    repoRoot: "/home/devin/hua-platform",
    commsDir: "/home/devin/hua-comms",
    receiverSession: "tap-receiver-yoon",
    receiverLogPath:
      "/home/devin/hua-platform/.tap-comms/logs/receiver-supervisor-sumback-yoon.log",
    supervisorStateName: "m463-live-sumback-yoon-main-supervisor",
    appServerUrl: "ws://127.0.0.1:35089",
    headlessRunner: {
      profile: "sumback-yoon",
      tmuxSession: "tap-headless-sumback-yoon",
      startCommand:
        "bash scripts/tap-headless-runner-supervisor.sh sumback-yoon --tmux",
      stopCommand:
        "bash scripts/tap-headless-runner-supervisor.sh sumback-yoon --stop",
      statusCommand:
        "bash scripts/tap-headless-runner-supervisor.sh sumback-yoon --status",
    },
  },
  "sumback-sol": {
    kind: "codex-cli",
    id: "sumback-sol",
    label: "sum-back 솔 CLI/TUI receiver",
    agent: "솔",
    runtimeSurface: "codex-cli",
    expectedPermissionMode: "full",
    repoRoot: "/home/devin/hua-platform",
    commsDir: "/home/devin/hua-comms",
    receiverSession: "tap-receiver-sol",
    receiverLogPath:
      "/home/devin/hua-platform/.tap-comms/logs/receiver-supervisor-sumback-sol.log",
    supervisorStateName: "m463-sumback-sol-supervisor",
    appServerUrl: "ws://127.0.0.1:44587",
    headlessRunner: {
      profile: "sumback-sol",
      tmuxSession: "tap-headless-sumback-sol",
      startCommand:
        "bash scripts/tap-headless-runner-supervisor.sh sumback-sol --tmux",
      stopCommand:
        "bash scripts/tap-headless-runner-supervisor.sh sumback-sol --stop",
      statusCommand:
        "bash scripts/tap-headless-runner-supervisor.sh sumback-sol --status",
    },
  },
  "mac-jun-ssh-tui": {
    kind: "codex-cli",
    id: "mac-jun-ssh-tui",
    label: "sum-mac 준 SSH TUI receiver",
    agent: "준",
    runtimeSurface: "codex-cli",
    expectedPermissionMode: "full",
    repoRoot: "/Users/devin/HUA/hua-platform",
    commsDir: "/Users/devin/HUA/hua-comms",
    receiverSession: "tap-receiver-jun-ssh-tui",
    receiverLogPath:
      "/Users/devin/HUA/hua-platform/.tap-comms/logs/receiver-supervisor-mac-jun-ssh-tui.log",
    sshTarget: "sum-mac",
    supervisorStateName: "m463-mac-jun-ssh-tui-supervisor",
    appServerUrl: "ws://127.0.0.1:35089",
    headlessRunner: {
      profile: "mac-jun-ssh-tui",
      tmuxSession: "tap-headless-mac-jun-ssh-tui",
      startCommand:
        "bash scripts/tap-headless-runner-supervisor.sh mac-jun-ssh-tui --tmux",
      stopCommand:
        "bash scripts/tap-headless-runner-supervisor.sh mac-jun-ssh-tui --stop",
      statusCommand:
        "bash scripts/tap-headless-runner-supervisor.sh mac-jun-ssh-tui --status",
    },
    flowSupervisors: [
      {
        id: "mac-jun-projection",
        label: "sum-back -> Mac 준 projection",
        host: "sum-back",
        tmuxSession: "tap-projection-jun",
        statusCommand:
          "cd /home/devin/hua-platform && bash scripts/tap-flow-supervisor.sh mac-jun-projection --status",
        startCommand:
          "cd /home/devin/hua-platform && bash scripts/tap-flow-supervisor.sh mac-jun-projection --tmux",
      },
      {
        id: "mac-jun-uplink",
        label: "Mac 준 -> sum-back uplink",
        host: "sum-back",
        tmuxSession: "tap-uplink-jun",
        statusCommand:
          "cd /home/devin/hua-platform && bash scripts/tap-flow-supervisor.sh mac-jun-uplink --status",
        startCommand:
          "cd /home/devin/hua-platform && bash scripts/tap-flow-supervisor.sh mac-jun-uplink --tmux",
      },
    ],
  },
  "remote-panel-yoon": {
    kind: "remote-panel",
    id: "remote-panel-yoon",
    label: "sum-back 윤 remote phone panel",
    agent: "윤",
    runtimeSurface: "remote-panel",
    repoRoot: "/home/devin/hua-platform",
    commsDir: "/home/devin/hua-comms",
    host: "100.121.45.22",
    port: 8765,
    readOnly: true,
    sendEnabled: false,
  },
};
