#!/usr/bin/env bash
# tap-setup.sh — Generic worktree bootstrap for tap missions
#
# Usage:
#   bash tap-setup.sh <worktree-path> <branch> [base-branch]
#
# Examples:
#   bash tap-setup.sh ../wt-1 feat/ui-refactor main
#   bash tap-setup.sh /home/user/myproject-wt-2 feat/api-work main
#
# What it does:
#   1. Create worktree at slot path
#   2. Merge base branch (so mission files are visible)
#   3. Copy .claude/settings.local.json + skip-worktree
#   4. Install dependencies (pnpm or npm)
#   5. Verify comms directory exists

set -euo pipefail

WORKTREE_PATH="${1:?Usage: tap-setup.sh <worktree-path> <branch> [base-branch]}"
BRANCH="${2:?Usage: tap-setup.sh <worktree-path> <branch> [base-branch]}"
BASE="${3:-main}"
MAIN_DIR="$(git rev-parse --show-toplevel)"

# Load config if present
CONFIG_FILE="${MAIN_DIR}/.tap-config"
if [[ -f "$CONFIG_FILE" ]]; then
  # shellcheck source=/dev/null
  source "$CONFIG_FILE"
fi

COMMS_DIR="${TAP_COMMS_DIR:-$(dirname "$MAIN_DIR")/project-comms}"
PKG_MANAGER="${TAP_PACKAGE_MANAGER:-}"

# Auto-detect package manager
if [[ -z "$PKG_MANAGER" ]]; then
  if command -v pnpm &>/dev/null && [[ -f "${MAIN_DIR}/pnpm-lock.yaml" ]]; then
    PKG_MANAGER="pnpm"
  elif [[ -f "${MAIN_DIR}/package-lock.json" ]]; then
    PKG_MANAGER="npm"
  elif [[ -f "${MAIN_DIR}/yarn.lock" ]]; then
    PKG_MANAGER="yarn"
  else
    PKG_MANAGER="npm"
  fi
fi

# ── Colors ───────────────────────────────────────────────────────────────────
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

step() { echo -e "${CYAN}[$(date +%H:%M:%S)]${NC} ${BOLD}$1${NC}"; }
ok()   { echo -e "  ${GREEN}done${NC} $1"; }
warn() { echo -e "  ${YELLOW}warn${NC} $1"; }

echo
echo -e "${BOLD}${CYAN}  TAP SETUP${NC}  ${DIM}worktree bootstrap${NC}"
echo -e "${DIM}  Worktree: ${WORKTREE_PATH}${NC}"
echo -e "${DIM}  Branch:   ${BRANCH}${NC}"
echo -e "${DIM}  Base:     ${BASE}${NC}"
echo -e "${DIM}────────────────────────────────────────${NC}"

# ── Step 1: Create worktree ──────────────────────────────────────────────────
step "1/5 Create worktree"
if [[ -d "$WORKTREE_PATH" ]]; then
  warn "Worktree already exists at $WORKTREE_PATH — skipping create"
else
  mkdir -p "$(dirname "$WORKTREE_PATH")"
  git worktree add "$WORKTREE_PATH" -b "$BRANCH" "$BASE" 2>/dev/null \
    || git worktree add "$WORKTREE_PATH" "$BRANCH" 2>/dev/null \
    || { echo "Failed to create worktree at $WORKTREE_PATH"; exit 1; }
  ok "Created at $WORKTREE_PATH on branch $BRANCH"
fi

# ── Step 2: Merge base branch ────────────────────────────────────────────────
step "2/5 Merge origin/${BASE}"
git fetch origin "$BASE" --quiet 2>/dev/null || true
if git -C "$WORKTREE_PATH" merge "origin/${BASE}" --no-edit 2>/dev/null; then
  ok "Merged origin/${BASE}"
else
  warn "Merge conflict or already up to date — continuing"
  git -C "$WORKTREE_PATH" merge --abort 2>/dev/null || true
fi

# ── Step 3: Copy permissions + skip-worktree ────────────────────────────────
step "3/5 Copy permissions + skip-worktree"
SETTINGS_SRC="${MAIN_DIR}/.claude/settings.local.json"
if [[ -f "$SETTINGS_SRC" ]]; then
  mkdir -p "$WORKTREE_PATH/.claude"
  cp "$SETTINGS_SRC" "$WORKTREE_PATH/.claude/settings.local.json"
  git -C "$WORKTREE_PATH" update-index --skip-worktree .claude/settings.local.json 2>/dev/null || true
  ok "Permissions copied + skip-worktree set"
else
  warn ".claude/settings.local.json not found in main repo — agent sessions may require manual permission grants"
fi

# ── Step 4: Install dependencies ────────────────────────────────────────────
step "4/5 Install dependencies (${PKG_MANAGER})"
cd "$WORKTREE_PATH"
case "$PKG_MANAGER" in
  pnpm)
    if pnpm install --prefer-offline 2>/dev/null | tail -1; then
      ok "pnpm install complete"
    else
      warn "pnpm install had issues — trying without offline flag"
      pnpm install | tail -1 || warn "Install may have partial failures"
    fi
    ;;
  yarn)
    yarn install --frozen-lockfile 2>/dev/null | tail -1 || warn "yarn install had issues"
    ok "yarn install complete"
    ;;
  npm)
    npm ci 2>/dev/null | tail -1 || npm install | tail -1 || warn "npm install had issues"
    ok "npm install complete"
    ;;
esac
cd "$MAIN_DIR"

# ── Step 5: Verify comms directory ──────────────────────────────────────────
step "5/5 Verify comms directory"
if [[ -d "$COMMS_DIR" ]]; then
  ok "Comms dir found: $COMMS_DIR"
else
  warn "Comms directory not found at: $COMMS_DIR"
  echo "  Create it manually or set TAP_COMMS_DIR in .tap-config"
  echo "  Agents will not be able to communicate until comms dir exists."
fi

# ── Done ────────────────────────────────────────────────────────────────────
echo
echo -e "${BOLD}${GREEN}  Setup complete!${NC}"
echo -e "${DIM}  Worktree: $WORKTREE_PATH${NC}"
echo -e "${DIM}  Branch:   $BRANCH${NC}"
echo
echo -e "  Next: open a terminal in ${BOLD}$WORKTREE_PATH${NC} and run ${BOLD}claude${NC}"
echo
