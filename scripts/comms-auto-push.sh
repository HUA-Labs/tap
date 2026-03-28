#!/usr/bin/env bash
# comms-auto-push.sh — PostToolUse hook: auto-commit+push comms after changes
# Prevents the #1 control tower failure: forgetting to push comms.
# Silent if nothing changed. Only runs when comms has uncommitted changes.

set -uo pipefail

# ── Config ───────────────────────────────────────────────────────────────────
REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
CONFIG_FILE="${REPO_ROOT}/.tap-config"
if [[ -f "$CONFIG_FILE" ]]; then
  # shellcheck source=/dev/null
  source "$CONFIG_FILE"
fi
COMMS_DIR="${TAP_COMMS_DIR:-/d/HUA/hua-comms}"

# Guard: comms directory must be a git repo
[[ -d "$COMMS_DIR/.git" ]] || exit 0

# Check for uncommitted changes
cd "$COMMS_DIR"
if [[ -z $(git status --porcelain 2>/dev/null) ]]; then
  exit 0
fi

# Auto-commit + push
git add -A 2>/dev/null
git commit -m "tap: auto-push comms — $(date +%H:%M:%S)" --no-verify 2>/dev/null || exit 0
git push origin main 2>/dev/null || true

echo "[tap] comms auto-pushed"
exit 0
