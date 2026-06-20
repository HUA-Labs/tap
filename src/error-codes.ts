/**
 * Centralized error/result code definitions for tap CLI.
 *
 * Every CommandResult.code value MUST be defined here.
 * Codes are grouped by category and documented with:
 * - description: what happened
 * - action: what the user should do
 *
 * M91: Centralized from inline string literals across commands.
 */

// ── Generic ─────────────────────────────────────────────────────────────

/** Invalid CLI argument (wrong flag, missing value, bad format). */
export const TAP_INVALID_ARGUMENT = "TAP_INVALID_ARGUMENT" as const;

/** Unexpected internal error (catch-all). */
export const TAP_INTERNAL_ERROR = "TAP_INTERNAL_ERROR" as const;

/** tap is not initialized in this repo. Run `tap init` first. */
export const TAP_NOT_INITIALIZED = "TAP_NOT_INITIALIZED" as const;

/** Command succeeded but had nothing to do. */
export const TAP_NO_OP = "TAP_NO_OP" as const;

// ── Instance Resolution ─────────────────────────────────────────────────

/** Multiple instances match the given identifier. Be more specific. */
export const TAP_INSTANCE_AMBIGUOUS = "TAP_INSTANCE_AMBIGUOUS" as const;

/** No instance found for the given identifier. */
export const TAP_INSTANCE_NOT_FOUND = "TAP_INSTANCE_NOT_FOUND" as const;

// ── Init ────────────────────────────────────────────────────────────────

/** `tap init` succeeded. */
export const TAP_INIT_OK = "TAP_INIT_OK" as const;

/** Repo is already initialized. Use `tap status` to check. */
export const TAP_ALREADY_INITIALIZED = "TAP_ALREADY_INITIALIZED" as const;

// ── Add ─────────────────────────────────────────────────────────────────

/** `tap add` succeeded. */
export const TAP_ADD_OK = "TAP_ADD_OK" as const;

/** Unknown runtime name. Supported: claude, codex, gemini. */
export const TAP_RUNTIME_UNKNOWN = "TAP_RUNTIME_UNKNOWN" as const;

/** Runtime CLI not found on system. Install it first. */
export const TAP_RUNTIME_NOT_FOUND = "TAP_RUNTIME_NOT_FOUND" as const;

/** Requested port is already used by another instance. */
export const TAP_PORT_CONFLICT = "TAP_PORT_CONFLICT" as const;

/** Config file patching failed (write error, permission, etc.). */
export const TAP_PATCH_FAILED = "TAP_PATCH_FAILED" as const;

// ── Remove ──────────────────────────────────────────────────────────────

/** `tap remove` succeeded. */
export const TAP_REMOVE_OK = "TAP_REMOVE_OK" as const;

/** Rollback after failed remove could not restore original state. */
export const TAP_ROLLBACK_FAILED = "TAP_ROLLBACK_FAILED" as const;

// ── Bridge ──────────────────────────────────────────────────────────────

/** Bridge started successfully. */
export const TAP_BRIDGE_START_OK = "TAP_BRIDGE_START_OK" as const;

/** Bridge failed to start. Check logs for details. */
export const TAP_BRIDGE_START_FAILED = "TAP_BRIDGE_START_FAILED" as const;

/** Bridge stopped successfully. */
export const TAP_BRIDGE_STOP_OK = "TAP_BRIDGE_STOP_OK" as const;

/** No bridge is running for this instance. */
export const TAP_BRIDGE_NOT_RUNNING = "TAP_BRIDGE_NOT_RUNNING" as const;

/** Bridge script not found. Ensure runtime is properly configured. */
export const TAP_BRIDGE_SCRIPT_MISSING = "TAP_BRIDGE_SCRIPT_MISSING" as const;

/** Bridge status query succeeded. */
export const TAP_BRIDGE_STATUS_OK = "TAP_BRIDGE_STATUS_OK" as const;

// ── Serve ───────────────────────────────────────────────────────────────

/** `tap serve` succeeded (MCP server exited cleanly). */
export const TAP_SERVE_OK = "TAP_SERVE_OK" as const;

/** `tap serve` requires bun. Install it: https://bun.sh */
export const TAP_SERVE_BUN_REQUIRED = "TAP_SERVE_BUN_REQUIRED" as const;

/** MCP server entry not found. */
export const TAP_SERVE_NO_SERVER = "TAP_SERVE_NO_SERVER" as const;

// ── Status ──────────────────────────────────────────────────────────────

/** `tap status` query succeeded. */
export const TAP_STATUS_OK = "TAP_STATUS_OK" as const;

/** Agent profile readiness is fully ready. */
export const TAP_STATUS_PROFILE_READY = "TAP_STATUS_PROFILE_READY" as const;

/** Agent profile readiness is usable but degraded. */
export const TAP_STATUS_PROFILE_DEGRADED =
  "TAP_STATUS_PROFILE_DEGRADED" as const;

/** Agent profile readiness is blocked. */
export const TAP_STATUS_PROFILE_BLOCKED = "TAP_STATUS_PROFILE_BLOCKED" as const;

/** `tap setup` generated a read-only setup report. */
export const TAP_SETUP_OK = "TAP_SETUP_OK" as const;

/** `tap setup --apply` is intentionally unavailable in the read-only slice. */
export const TAP_SETUP_APPLY_NOT_IMPLEMENTED =
  "TAP_SETUP_APPLY_NOT_IMPLEMENTED" as const;

/** `tap setup --apply` was blocked by fail-closed setup guards. */
export const TAP_SETUP_APPLY_BLOCKED = "TAP_SETUP_APPLY_BLOCKED" as const;

/** `tap doctor --setup` generated a read-only setup readiness report. */
export const TAP_DOCTOR_SETUP_OK = "TAP_DOCTOR_SETUP_OK" as const;

/** `tap doctor --setup --apply` is intentionally unavailable. */
export const TAP_DOCTOR_SETUP_APPLY_NOT_IMPLEMENTED =
  "TAP_DOCTOR_SETUP_APPLY_NOT_IMPLEMENTED" as const;

/** `tap doctor --setup --apply` was blocked by fail-closed setup guards. */
export const TAP_DOCTOR_SETUP_APPLY_BLOCKED =
  "TAP_DOCTOR_SETUP_APPLY_BLOCKED" as const;

/** `tap status --profile` was provided without a profile value. */
export const TAP_STATUS_PROFILE_REQUIRED =
  "TAP_STATUS_PROFILE_REQUIRED" as const;

/** `tap status --profile` requested an unknown profile. */
export const TAP_STATUS_UNKNOWN_PROFILE = "TAP_STATUS_UNKNOWN_PROFILE" as const;

/** `tap flow-doctor` completed a read-only receiver/return-uplink diagnostic. */
export const TAP_FLOW_DOCTOR_OK = "TAP_FLOW_DOCTOR_OK" as const;

/** `tap reviews recover` completed review evidence recovery matching. */
export const TAP_REVIEWS_RECOVERY_OK = "TAP_REVIEWS_RECOVERY_OK" as const;

/** `tap reviews register` completed review outcome registration planning/apply. */
export const TAP_REVIEWS_REGISTER_OK = "TAP_REVIEWS_REGISTER_OK" as const;

// ── Receiver ───────────────────────────────────────────────────────────

/** `tap receiver` surfaced local polling inbox state. */
export const TAP_RECEIVER_OK = "TAP_RECEIVER_OK" as const;

/** `tap ready` reported post-identity runtime-surface readiness. */
export const TAP_READY_OK = "TAP_READY_OK" as const;

/** `tap ready --apply` failed while performing an explicit apply action. */
export const TAP_READY_APPLY_FAILED = "TAP_READY_APPLY_FAILED" as const;

// ── Config ──────────────────────────────────────────────────────────────

/** tap-config.json or tap-config.local.json is invalid. */
export const TAP_CONFIG_INVALID = "TAP_CONFIG_INVALID" as const;

/** MCP server entry not found locally (bun + source missing). */
export const TAP_LOCAL_SERVER_MISSING = "TAP_LOCAL_SERVER_MISSING" as const;

// ── Verify ──────────────────────────────────────────────────────────────

/** Post-add verification failed (config check, runtime probe). */
export const TAP_VERIFY_FAILED = "TAP_VERIFY_FAILED" as const;

// ── Review (Headless) ───────────────────────────────────────────────────

/** Headless review session started. */
export const TAP_REVIEW_START_OK = "TAP_REVIEW_START_OK" as const;

/** Headless review session terminated (max rounds, error, etc.). */
export const TAP_REVIEW_TERMINATED = "TAP_REVIEW_TERMINATED" as const;

// ── All Codes ───────────────────────────────────────────────────────────

/** Union type of all valid tap error/result codes. Mirrors CommandCode in types.ts. */
export type TapCode =
  // Generic
  | typeof TAP_INVALID_ARGUMENT
  | typeof TAP_INTERNAL_ERROR
  | typeof TAP_NOT_INITIALIZED
  | typeof TAP_NO_OP
  // Instance
  | typeof TAP_INSTANCE_AMBIGUOUS
  | typeof TAP_INSTANCE_NOT_FOUND
  // Init
  | typeof TAP_INIT_OK
  | typeof TAP_ALREADY_INITIALIZED
  // Add
  | typeof TAP_ADD_OK
  | typeof TAP_RUNTIME_UNKNOWN
  | typeof TAP_RUNTIME_NOT_FOUND
  | typeof TAP_PORT_CONFLICT
  | typeof TAP_PATCH_FAILED
  // Remove
  | typeof TAP_REMOVE_OK
  | typeof TAP_ROLLBACK_FAILED
  // Bridge
  | typeof TAP_BRIDGE_START_OK
  | typeof TAP_BRIDGE_START_FAILED
  | typeof TAP_BRIDGE_STOP_OK
  | typeof TAP_BRIDGE_NOT_RUNNING
  | typeof TAP_BRIDGE_SCRIPT_MISSING
  | typeof TAP_BRIDGE_STATUS_OK
  // Serve
  | typeof TAP_SERVE_OK
  | typeof TAP_SERVE_BUN_REQUIRED
  | typeof TAP_SERVE_NO_SERVER
  // Status
  | typeof TAP_STATUS_OK
  | typeof TAP_STATUS_PROFILE_READY
  | typeof TAP_STATUS_PROFILE_DEGRADED
  | typeof TAP_STATUS_PROFILE_BLOCKED
  | typeof TAP_SETUP_OK
  | typeof TAP_SETUP_APPLY_NOT_IMPLEMENTED
  | typeof TAP_SETUP_APPLY_BLOCKED
  | typeof TAP_DOCTOR_SETUP_OK
  | typeof TAP_DOCTOR_SETUP_APPLY_NOT_IMPLEMENTED
  | typeof TAP_DOCTOR_SETUP_APPLY_BLOCKED
  | typeof TAP_STATUS_PROFILE_REQUIRED
  | typeof TAP_STATUS_UNKNOWN_PROFILE
  | typeof TAP_FLOW_DOCTOR_OK
  | typeof TAP_REVIEWS_RECOVERY_OK
  | typeof TAP_REVIEWS_REGISTER_OK
  // Receiver
  | typeof TAP_READY_OK
  | typeof TAP_READY_APPLY_FAILED
  | typeof TAP_RECEIVER_OK
  // Config
  | typeof TAP_CONFIG_INVALID
  | typeof TAP_LOCAL_SERVER_MISSING
  // Verify
  | typeof TAP_VERIFY_FAILED
  // Review (Headless)
  | typeof TAP_REVIEW_START_OK
  | typeof TAP_REVIEW_TERMINATED;
