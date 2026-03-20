#!/usr/bin/env bash
# inbox-check.sh — PostToolUse hook: watch for new comms files
# Runs after every tool use. Silent if nothing new. Output triggers Claude notification.
#
# Uses worktree path as agent ID to avoid cross-session false positives.

set -uo pipefail

# ── Config ───────────────────────────────────────────────────────────────────
REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
CONFIG_FILE="${REPO_ROOT}/.tap-config"
if [[ -f "$CONFIG_FILE" ]]; then
  # shellcheck source=/dev/null
  source "$CONFIG_FILE"
fi
COMMS_DIR="${TAP_COMMS_DIR:-$(dirname "$REPO_ROOT")/project-comms}"

# ── Guard: comms directory must exist ────────────────────────────────────────
[[ -d "$COMMS_DIR" ]] || exit 0

# ── Agent ID: use worktree path (stable, unique per session) ─────────────────
AGENT_ID=$(basename "$REPO_ROOT")

# ── Last-checked timestamp file ──────────────────────────────────────────────
STAMP_FILE="${COMMS_DIR}/.last-checked-${AGENT_ID}"

# Get last check time (0 = never checked, show all files)
if [[ -f "$STAMP_FILE" ]]; then
  LAST_CHECK=$(cat "$STAMP_FILE" 2>/dev/null || echo 0)
else
  LAST_CHECK=0
fi

NOW=$(date +%s)

# ── Count new files in each directory ────────────────────────────────────────
count_new() {
  local dir="$1"
  [[ -d "$dir" ]] || echo 0 && return
  # Files newer than last check
  find "$dir" -maxdepth 1 -type f -newer "$STAMP_FILE" 2>/dev/null | wc -l | tr -d ' '
}

# On first run (no stamp file), use a temp file with old mtime
if [[ ! -f "$STAMP_FILE" ]]; then
  touch -t 197001010000 /tmp/tap-epoch-ref 2>/dev/null || true
  STAMP_FILE="/tmp/tap-epoch-ref"
fi

NEW_INBOX=$(find "${COMMS_DIR}/inbox" -maxdepth 1 -type f -newer "$STAMP_FILE" 2>/dev/null | wc -l | tr -d ' ')
NEW_REVIEWS=$(find "${COMMS_DIR}/reviews" -maxdepth 1 -type f -newer "$STAMP_FILE" 2>/dev/null | wc -l | tr -d ' ')
NEW_FINDINGS=$(find "${COMMS_DIR}/findings" -maxdepth 1 -type f -newer "$STAMP_FILE" 2>/dev/null | wc -l | tr -d ' ')

TOTAL=$((NEW_INBOX + NEW_REVIEWS + NEW_FINDINGS))

# ── Output (only when something new) ─────────────────────────────────────────
if [[ "$TOTAL" -gt 0 ]]; then
  echo ""
  echo "  [tap] New comms: ${NEW_INBOX} message(s), ${NEW_REVIEWS} review(s), ${NEW_FINDINGS} finding(s)"
  echo "  Run /tap:inbox to read them."
  echo ""
fi

# ── Update stamp ──────────────────────────────────────────────────────────────
STAMP_FILE="${COMMS_DIR}/.last-checked-${AGENT_ID}"
echo "$NOW" > "$STAMP_FILE"

exit 0
