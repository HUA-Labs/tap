#!/usr/bin/env bash
# tap-watch.sh — Mission Control Dashboard
#
# Usage:
#   bash tap-watch.sh [--detail]
#
# Auto-detects missions from docs/missions/MISSIONS.md and
# worktrees from `git worktree list`. No hardcoded arrays.

set -uo pipefail

DETAIL="${1:-}"

# ── Colors ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
PURPLE='\033[0;35m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

# ── Repo root ────────────────────────────────────────────────────────────────
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

if [[ ! -f "$MISSIONS_FILE" ]]; then
  echo "Error: MISSIONS.md not found at $MISSIONS_FILE" >&2
  echo "Run /tap:tap setup to initialize." >&2
  exit 1
fi

# ── Helpers ──────────────────────────────────────────────────────────────────
divider() {
  echo -e "${DIM}────────────────────────────────────────────────────────────────${NC}"
}

progress_bar() {
  local done_count="$1" total_count="$2" width=20
  if [[ "$total_count" -eq 0 ]]; then
    echo -ne "${DIM}[no tasks]${NC}"
    return
  fi
  local pct=$((done_count * 100 / total_count))
  local filled=$((done_count * width / total_count))
  local empty=$((width - filled))
  echo -n "["
  for ((j=0; j<filled; j++)); do echo -ne "${GREEN}#${NC}"; done
  for ((j=0; j<empty;  j++)); do echo -ne "${DIM}-${NC}"; done
  echo -ne "] ${BOLD}${pct}%%${NC}"
}

colour_status() {
  local s="$1"
  case "$s" in
    active)    echo -ne "${CYAN}ACTIVE${NC}" ;;
    completed) echo -ne "${GREEN}DONE${NC}" ;;
    blocked)   echo -ne "${RED}BLOCKED${NC}" ;;
    paused)    echo -ne "${YELLOW}PAUSED${NC}" ;;
    planned)   echo -ne "${DIM}PLANNED${NC}" ;;
    *)         echo -ne "${DIM}${s}${NC}" ;;
  esac
}

# Build worktree map: branch -> path
declare -A WORKTREE_MAP
while IFS= read -r wt_line; do
  if [[ "$wt_line" =~ ^worktree[[:space:]](.+)$ ]]; then
    current_wt="${BASH_REMATCH[1]}"
  elif [[ "$wt_line" =~ ^branch[[:space:]]refs/heads/(.+)$ ]]; then
    WORKTREE_MAP["${BASH_REMATCH[1]}"]="$current_wt"
  fi
done < <(git worktree list --porcelain 2>/dev/null)

# ── Header ───────────────────────────────────────────────────────────────────
echo
echo -e "${BOLD}${CYAN}  MISSION CONTROL${NC}  ${DIM}$(date '+%Y-%m-%d %H:%M:%S')${NC}"
divider

# Comms status
if [[ -d "$COMMS_DIR" ]]; then
  inbox_count=$(find "${COMMS_DIR}/inbox" -maxdepth 1 -type f 2>/dev/null | wc -l | tr -d ' ')
  findings_count=$(find "${COMMS_DIR}/findings" -maxdepth 1 -type f 2>/dev/null | wc -l | tr -d ' ')
  reviews_count=$(find "${COMMS_DIR}/reviews" -maxdepth 1 -type f 2>/dev/null | wc -l | tr -d ' ')
  echo -e "  Comms: ${inbox_count} inbox  |  ${reviews_count} reviews  |  ${findings_count} findings"
  divider
fi

# ── Parse and display missions ────────────────────────────────────────────────
total_done=0
total_all=0
active_count=0
mission_count=0

while IFS= read -r line; do
  # Match mission table rows
  if [[ "$line" =~ ^\|[[:space:]]*(M[0-9]+)[[:space:]]*\| ]]; then
    IFS='|' read -ra parts <<< "$line"
    id=$(echo "${parts[1]:-}" | tr -d ' ')
    raw_name=$(echo "${parts[2]:-}" | sed 's/\[//g; s/\]([^)]*)//g' | tr -d ' ')
    branch=$(echo "${parts[3]:-}" | tr -d ' `')
    status_raw=$(echo "${parts[4]:-}" | tr -d ' ')
    owner=$(echo "${parts[5]:-}" | tr -d ' ')

    # Normalize status
    status="unknown"
    echo "$status_raw" | grep -qi "active"    && status="active"
    echo "$status_raw" | grep -qi "completed\|merged\|done" && status="completed"
    echo "$status_raw" | grep -qi "blocked"   && status="blocked"
    echo "$status_raw" | grep -qi "paused"    && status="paused"
    echo "$status_raw" | grep -qi "planned"   && status="planned"

    mission_count=$((mission_count + 1))
    [[ "$status" == "active" ]] && active_count=$((active_count + 1))

    # Find mission file
    mission_file=""
    for md in "${MISSIONS_DIR}"/*.md; do
      fname=$(basename "$md" .md)
      # Match by branch name or mission name fragment
      if echo "$branch" | grep -qi "$fname" || echo "$raw_name" | grep -qi "$fname"; then
        mission_file="$md"
        break
      fi
    done

    # Task progress from mission file
    done_count=0; task_count=0
    if [[ -n "$mission_file" && -f "$mission_file" ]]; then
      task_count=$(grep -c '^- \[' "$mission_file" 2>/dev/null || echo 0)
      done_count=$(grep -c '^- \[x\]' "$mission_file" 2>/dev/null || echo 0)
      # Re-read status from live file
      live_status=$(grep -m1 'Status' "$mission_file" \
        | grep -oE '(planned|active|completed|blocked|paused)' | head -1 || echo "")
      [[ -n "$live_status" ]] && status="$live_status"
    fi

    total_done=$((total_done + done_count))
    total_all=$((total_all + task_count))

    # ── Display mission ───────────────────────────────────────────────────────
    echo -ne "  ${BOLD}${id}${NC} ${raw_name}  "
    echo -ne "  Owner: ${PURPLE}${owner}${NC}"
    echo

    echo -ne "  Status: "
    colour_status "$status"
    echo -ne "  |  Tasks: "
    progress_bar "$done_count" "$task_count"
    echo -e "  (${done_count}/${task_count})"

    # Worktree info
    wt_dir="${WORKTREE_MAP[$branch]:-}"
    if [[ -n "$wt_dir" && -d "$wt_dir" ]]; then
      current_branch=$(git -C "$wt_dir" branch --show-current 2>/dev/null || echo "?")
      changes=$(git -C "$wt_dir" status --porcelain 2>/dev/null | wc -l | tr -d ' ')
      last_commit=$(git -C "$wt_dir" log --oneline -1 2>/dev/null || echo "no commits")
      commit_age=$(git -C "$wt_dir" log -1 --format='%cr' 2>/dev/null || echo "?")

      if [[ "$changes" -gt 0 ]]; then
        dirty="${YELLOW}${changes} dirty${NC}"
      else
        dirty="${GREEN}clean${NC}"
      fi

      files_vs_main=$(git -C "$wt_dir" diff --name-only main...HEAD 2>/dev/null | wc -l | tr -d ' ')
      diff_note=""
      [[ "$files_vs_main" -gt 0 ]] && diff_note="  ${CYAN}+${files_vs_main} vs main${NC}"

      echo -e "  Branch: ${PURPLE}${current_branch}${NC}  |  ${dirty}${diff_note}"
      echo -e "  Latest: ${DIM}${last_commit}${NC} ${DIM}(${commit_age})${NC}"

      if [[ "$DETAIL" == "--detail" ]]; then
        echo
        echo -e "  ${DIM}Recent commits:${NC}"
        git -C "$wt_dir" log --oneline -5 2>/dev/null | while IFS= read -r cline; do
          echo -e "    ${DIM}${cline}${NC}"
        done
      fi
    else
      case "$status" in
        completed) echo -e "  ${DIM}(merged — no worktree)${NC}" ;;
        planned)   echo -e "  ${DIM}(not started)${NC}" ;;
        paused)    echo -e "  ${YELLOW}(paused — no active worktree)${NC}" ;;
        blocked)   echo -e "  ${RED}(blocked — no worktree: ${branch})${NC}" ;;
        *)         echo -e "  ${DIM}No worktree for: ${branch}${NC}" ;;
      esac
    fi

    divider
  fi
done < "$MISSIONS_FILE"

# ── Summary ───────────────────────────────────────────────────────────────────
echo
echo -ne "  ${BOLD}Total Progress: ${NC}"
progress_bar "$total_done" "$total_all"
echo -e "  (${total_done}/${total_all} tasks)"
echo -e "  ${DIM}${mission_count} missions  |  ${active_count} active${NC}"
echo
