#!/usr/bin/env bash
# tap-launch.sh — Print terminal tab launch instructions for all active missions
#
# Usage:
#   bash tap-launch.sh [mission-ids...]
#
# Examples:
#   bash tap-launch.sh              # All active/planned missions
#   bash tap-launch.sh M1 M3        # Specific missions only

set -uo pipefail

MAIN_DIR="$(git rev-parse --show-toplevel 2>/dev/null)"
if [[ -z "$MAIN_DIR" ]]; then
  echo "Error: not inside a git repository" >&2
  exit 1
fi

CONFIG_HELPER="${MAIN_DIR}/scripts/lib/tap-config.sh"
if [[ -f "$CONFIG_HELPER" ]]; then
  # shellcheck source=/dev/null
  source "$CONFIG_HELPER"
  tap_load_config "$MAIN_DIR"
fi

if [[ -n "${TAP_COMMS_DIR_RESOLVED:-}" ]]; then
  COMMS_DIR="$TAP_COMMS_DIR_RESOLVED"
else
  COMMS_DIR="${TAP_COMMS_DIR:-$(dirname "$MAIN_DIR")/project-comms}"
fi

if [[ -n "${TAP_MISSIONS_DIR_RESOLVED:-}" ]]; then
  MISSIONS_DIR="$TAP_MISSIONS_DIR_RESOLVED"
else
  MISSIONS_DIR="${TAP_MISSIONS_DIR:-${MAIN_DIR}/docs/missions}"
fi

MISSIONS_FILE="${MISSIONS_DIR}/MISSIONS.md"

if [[ -n "${TAP_SLOT_PREFIX:-}" && -n "${TAP_REPO_ROOT:-}" ]]; then
  SLOT_PREFIX="$(tap_resolve_path "$MAIN_DIR" "$TAP_SLOT_PREFIX")"
else
  SLOT_PREFIX="${TAP_SLOT_PREFIX:-${TAP_WORKTREE_BASE_RESOLVED:-$(dirname "$MAIN_DIR")}/wt}"
fi

GENERATION="${TAP_GENERATION:-?}"

# Filter args
FILTER_IDS=("$@")

if [[ ! -f "$MISSIONS_FILE" ]]; then
  echo "Error: MISSIONS.md not found at $MISSIONS_FILE"
  echo "Run /tap:tap setup first."
  exit 1
fi

# ── Colors ───────────────────────────────────────────────────────────────────
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

divider() {
  echo -e "${DIM}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
}

echo
echo -e "${BOLD}${CYAN}  TAP LAUNCH INSTRUCTIONS${NC}"
divider

slot=0
tab=1

# Parse MISSIONS.md for active/planned missions
while IFS= read -r line; do
  # Match table rows: | M1 | [name](./file.md) | branch | status | owner |
  if [[ "$line" =~ ^\|[[:space:]]*(M[0-9]+)[[:space:]]*\| ]]; then
    id="${BASH_REMATCH[1]}"

    # Extract fields by splitting on |
    IFS='|' read -ra parts <<< "$line"
    # parts[0]="" parts[1]=id parts[2]=name+link parts[3]=branch parts[4]=status parts[5]=owner

    raw_name="${parts[2]:-}"
    raw_branch="${parts[3]:-}"
    raw_status="${parts[4]:-}"

    # Clean whitespace
    mission_name=$(echo "$raw_name" | sed 's/\[//g; s/\]([^)]*)//' | tr -d ' ')
    branch=$(echo "$raw_branch" | tr -d ' `')
    status=$(echo "$raw_status" | tr -d ' ')

    # Skip completed/paused unless specifically requested
    if echo "$status" | grep -qiE 'completed|merged'; then
      continue
    fi

    # If filter specified, skip non-matching
    if [[ ${#FILTER_IDS[@]} -gt 0 ]]; then
      match=0
      for fid in "${FILTER_IDS[@]}"; do
        [[ "$fid" == "$id" ]] && match=1
      done
      [[ $match -eq 0 ]] && continue
    fi

    slot=$((slot + 1))
    wt_path="${SLOT_PREFIX}-${slot}"

    # Find mission file for scope info
    mission_file=""
    while IFS= read -r mline; do
      if [[ "$mline" =~ \(\.\/([^)]+\.md)\) ]]; then
        fname="${BASH_REMATCH[1]}"
        candidate="${MISSIONS_DIR}/${fname}"
        [[ -f "$candidate" ]] && mission_file="$candidate"
      fi
    done <<< "$line"

    echo
    echo -e "${BOLD}  Tab ${tab} — ${id}: ${mission_name}${NC}"
    divider
    echo -e "  ${DIM}Directory:${NC} ${BOLD}${wt_path}${NC}"
    echo -e "  ${DIM}Branch:${NC}    ${branch}"
    echo -e "  ${DIM}Status:${NC}    ${status}"
    echo
    echo -e "  ${CYAN}Command:${NC} cd \"${wt_path}\" && claude"
    echo
    echo -e "  ${CYAN}Paste this prompt:${NC}"
    echo -e "${DIM}  ─────────────────────────────────────────────────────────────${NC}"
    cat <<PROMPT
  Read docs/missions/$(basename "${mission_file:-unknown.md}") and begin your mission.

  You are a tap agent (generation ${GENERATION}). Control tower is coordinating from the main repo.
  Comms: ${COMMS_DIR}
    - inbox/   — check for messages addressed to you or "all"
    - reviews/ — code review results (NOT GitHub PR comments)
    - findings/ — out-of-scope discoveries from other agents

  Key rules:
  - MISSIONS.md is control-tower-only. Only update your own mission file.
  - Create PRs yourself with: gh pr create
  - Out-of-scope issues go to comms/findings/, not direct fixes.
  - Large commits (50+ files): export HUSKY=0 first.

  Pick a single-character name (any language/script) and announce yourself
  in ${COMMS_DIR}/inbox/ when you start.
PROMPT
    echo -e "${DIM}  ─────────────────────────────────────────────────────────────${NC}"

    tab=$((tab + 1))
  fi
done < "$MISSIONS_FILE"

if [[ $tab -eq 1 ]]; then
  echo "  No active or planned missions found."
  echo "  Run /tap:tap setup to create missions."
fi

echo
divider
echo -e "  ${DIM}Total tabs to open: $((tab - 1))${NC}"
echo
