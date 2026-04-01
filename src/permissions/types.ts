// ─── Permission Types ──────────────────────────────────────────

/**
 * Logical permission mode — defines how much access an agent has.
 * tap enforces these as a layer above runtime-native permissions.
 */
export type PermissionMode =
  | "readonly" // Read-only (reviewer default)
  | "workspace-write" // Modify within worktree (implementer default)
  | "full-access" // All tools (tower)
  | "prompt"; // Ask every time (new agent default)

/**
 * Agent role — determines default permission preset.
 */
export type AgentRole = "tower" | "implementer" | "reviewer" | "custom";

/**
 * Per-agent permission configuration.
 * Stored in instance config as source-of-truth.
 */
export interface AgentPermission {
  role: AgentRole;
  mode: PermissionMode;
  /** Additional tools to allow beyond the role preset. */
  allowedTools: string[];
  /** Tools to explicitly deny regardless of mode. */
  deniedTools: string[];
  /** File path globs where writes are permitted. */
  allowedPaths: string[];
  /** Agent to escalate to when permission is insufficient. Null = no escalation. */
  escalateTo: string | null;
}
