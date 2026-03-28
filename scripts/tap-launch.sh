#!/usr/bin/env bash
# tap-launch.sh — One-click mission session launcher
#
# Usage:
#   bash scripts/tap-launch.sh M19                      # Single mission
#   bash scripts/tap-launch.sh --batch M19 M20 M21 M22  # Multiple missions
#
# Each mission gets: worktree setup → Windows Terminal tab → claude session

set -euo pipefail

MAIN_DIR="$(git rev-parse --show-toplevel)"

# Read .tap-config
TAP_CONFIG="$MAIN_DIR/.tap-config"
COMMS_DIR="/d/HUA/hua-comms"
WORKTREE_BASE=""
if [[ -f "$TAP_CONFIG" ]]; then
  source "$TAP_CONFIG" 2>/dev/null || true
  COMMS_DIR="${TAP_COMMS_DIR:-$COMMS_DIR}"
  WORKTREE_BASE="${TAP_WORKTREE_BASE:-}"
fi

MISSIONS_FILE="$MAIN_DIR/docs/missions/MISSIONS.md"

# Parse generation + tower name from MISSIONS.md
GENERATION=$(grep -oP 'Gen \K\d+' "$MISSIONS_FILE" | head -1)
GENERATION="${GENERATION:-1}"
TOWER_NAME=$(grep -oP 'Control tower: \K[^\(]+' "$MISSIONS_FILE" | head -1 | tr -d ' .')
TOWER_NAME="${TOWER_NAME:-unknown}"

# Detect wt.exe dynamically
WT_EXE="$(which wt.exe 2>/dev/null || echo "")"
if [[ -z "$WT_EXE" ]]; then
  fail "wt.exe not found in PATH — install Windows Terminal"
fi

# Colors
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
RED='\033[0;31m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

step()  { echo -e "${CYAN}[$(date +%H:%M:%S)]${NC} ${BOLD}$1${NC}"; }
ok()    { echo -e "  ${GREEN}✓${NC} $1"; }
warn()  { echo -e "  ${YELLOW}⚠${NC} $1"; }
fail()  { echo -e "  ${RED}✗${NC} $1"; exit 1; }

# Parse mission info from MISSIONS.md
parse_mission() {
  local mission_id="$1"
  local line
  line=$(grep -i "| $mission_id " "$MISSIONS_FILE" | head -1)
  if [[ -z "$line" ]]; then
    fail "Mission $mission_id not found in MISSIONS.md"
  fi

  # Extract branch (between backticks)
  BRANCH=$(echo "$line" | grep -oP '`[^`]+`' | head -1 | tr -d '`')
  # Extract mission file (from markdown link)
  MISSION_FILE=$(echo "$line" | grep -oP '\(\.\/[^)]+\)' | head -1 | tr -d '()' | sed 's|^\./||')

  if [[ -z "$BRANCH" || -z "$MISSION_FILE" ]]; then
    fail "Could not parse branch/file for $mission_id"
  fi
}

# Launch a single mission
launch_mission() {
  local mission_id="$1"
  local index="$2"
  local total="$3"

  echo
  echo -e "${BOLD}${CYAN}  [$index/$total] $mission_id${NC}"
  echo -e "${DIM}────────────────────────────────────────${NC}"

  parse_mission "$mission_id"

  # Determine worktree path
  local wt_name
  wt_name=$(echo "$BRANCH" | tr '/' '-')
  local wt_base="${WORKTREE_BASE:-$(dirname "$MAIN_DIR")}"
  local wt_path="$wt_base/wt-$wt_name"

  # Step 1: Setup worktree if needed
  step "Worktree"
  if [[ -d "$wt_path" ]]; then
    ok "Exists at $wt_path"
  else
    bash "$MAIN_DIR/scripts/tap-setup.sh" "$wt_path" "$BRANCH" main
    ok "Created at $wt_path"
  fi

  # Step 2: Verify settings
  step "Settings"
  if grep -q '"Write"' "$wt_path/.claude/settings.local.json" 2>/dev/null; then
    ok "Permissions OK"
  else
    cp "$MAIN_DIR/.claude/settings.local.json" "$wt_path/.claude/settings.local.json"
    git -C "$wt_path" update-index --skip-worktree .claude/settings.local.json 2>/dev/null || true
    ok "Permissions copied + skip-worktree"
  fi

  # Step 3: Verify comms
  step "Comms"
  if [[ -d "$COMMS_DIR/.git" ]]; then
    ok "hua-comms at $COMMS_DIR"
  else
    warn "hua-comms not found — clone: git clone https://github.com/HUA-Labs/hua-comms.git $COMMS_DIR"
  fi

  # Step 4: Open terminal tab at worktree folder
  step "Launch"

  # Convert to Windows path for wt.exe (handle any drive letter)
  local win_path
  win_path=$(echo "$wt_path" | sed -E 's|^/([a-zA-Z])/|\U\1:\\|; s|/|\\|g')

  "$WT_EXE" -w 0 new-tab --title "$mission_id" -d "$win_path" &

  ok "Terminal tab opened: $win_path"
  echo -e "  ${DIM}Run 'claude' and paste the prompt to start${NC}"
}

# ── Main ──

echo
echo -e "${BOLD}${CYAN}  TAP LAUNCH${NC}  ${DIM}mission session launcher${NC}"
echo -e "${DIM}════════════════════════════════════════${NC}"

MISSIONS=()

if [[ "${1:-}" == "--batch" ]]; then
  shift
  MISSIONS=("$@")
elif [[ -n "${1:-}" ]]; then
  MISSIONS=("$1")
else
  echo "Usage:"
  echo "  bash scripts/tap-launch.sh M19              # Single"
  echo "  bash scripts/tap-launch.sh --batch M19 M20  # Batch"
  exit 0
fi

if [[ ${#MISSIONS[@]} -eq 0 ]]; then
  fail "No missions specified"
fi

TOTAL=${#MISSIONS[@]}
INDEX=0

for m in "${MISSIONS[@]}"; do
  INDEX=$((INDEX + 1))
  launch_mission "$m" "$INDEX" "$TOTAL"
done

echo
echo -e "${DIM}════════════════════════════════════════${NC}"
echo -e "${BOLD}${GREEN}  Launched ${TOTAL} mission(s)${NC}"
echo -e "  ${DIM}Check inbox: ls -t $COMMS_DIR/inbox/${NC}"
echo
