import type { AgentRole, AgentPermission } from "./types.js";

/**
 * Default permission presets per role.
 * These define the starting point — can be customized per instance.
 */
export const ROLE_PRESETS: Record<
  AgentRole,
  Omit<AgentPermission, "agentId">
> = {
  tower: {
    role: "tower",
    mode: "full-access",
    allowedTools: ["*"],
    deniedTools: [],
    allowedPaths: ["**"],
    escalateTo: null,
  },
  implementer: {
    role: "implementer",
    mode: "workspace-write",
    allowedTools: [
      "Read",
      "Edit",
      "Write",
      "Bash",
      "Grep",
      "Glob",
      "mcp__tap__*",
    ],
    deniedTools: ["Bash(git push --force:*)", "Bash(git reset --hard:*)"],
    allowedPaths: ["packages/**", "apps/**", "docs/**"],
    escalateTo: "tower",
  },
  reviewer: {
    role: "reviewer",
    mode: "readonly",
    allowedTools: [
      "Read",
      "Grep",
      "Glob",
      "Bash(grep:*)",
      "Bash(git diff:*)",
      "mcp__tap__*",
    ],
    deniedTools: ["Edit", "Write", "Bash(rm:*)"],
    allowedPaths: ["hua-comms/reviews/**"],
    escalateTo: "tower",
  },
  custom: {
    role: "custom",
    mode: "prompt",
    allowedTools: [],
    deniedTools: [],
    allowedPaths: [],
    escalateTo: "tower",
  },
};

/**
 * Create an AgentPermission from a role preset.
 */
export function createPermissionFromRole(role: AgentRole): AgentPermission {
  const preset = ROLE_PRESETS[role];
  return {
    ...preset,
    allowedTools: [...preset.allowedTools],
    deniedTools: [...preset.deniedTools],
    allowedPaths: [...preset.allowedPaths],
  };
}

/**
 * Valid role names for CLI validation.
 */
export const VALID_ROLES: AgentRole[] = [
  "tower",
  "implementer",
  "reviewer",
  "custom",
];
