#!/usr/bin/env bash
# tap-setup.sh — One-click worktree bootstrap for tap missions
# Usage: bash scripts/tap-setup.sh <worktree-path> <branch> [base-branch]
#
# Example:
#   bash scripts/tap-setup.sh /d/HUA/wt-1 fix/security-p1 main

set -euo pipefail

WORKTREE_PATH="${1:?Usage: tap-setup.sh <worktree-path> <branch> [base-branch]}"
BRANCH="${2:?Usage: tap-setup.sh <worktree-path> <branch> [base-branch]}"
BASE="${3:-main}"
MAIN_DIR="$(git rev-parse --show-toplevel)"

# Read .tap-config if exists
TAP_CONFIG="$MAIN_DIR/.tap-config"
COMMS_DIR="/d/HUA/hua-comms"
if [[ -f "$TAP_CONFIG" ]]; then
  source "$TAP_CONFIG" 2>/dev/null || true
  COMMS_DIR="${TAP_COMMS_DIR:-$COMMS_DIR}"
fi

# Parse generation + tower name from MISSIONS.md
MISSIONS_FILE="$MAIN_DIR/docs/missions/MISSIONS.md"
GENERATION=$(grep -oP 'Gen \K\d+' "$MISSIONS_FILE" 2>/dev/null | head -1)
GENERATION="${GENERATION:-1}"
TOWER_NAME=$(grep -oP 'Control tower: \K[^\(]+' "$MISSIONS_FILE" 2>/dev/null | head -1 | tr -d ' .')
TOWER_NAME="${TOWER_NAME:-unknown}"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
RED='\033[0;31m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

step() { echo -e "${CYAN}[$(date +%H:%M:%S)]${NC} ${BOLD}$1${NC}"; }
ok()   { echo -e "  ${GREEN}✓${NC} $1"; }
warn() { echo -e "  ${YELLOW}⚠${NC} $1"; }
fail() { echo -e "  ${RED}✗${NC} $1"; exit 1; }

echo
echo -e "${BOLD}${CYAN}  TAP SETUP${NC}  ${DIM}worktree bootstrap v2${NC}"
echo -e "${DIM}════════════════════════════════════════${NC}"

# 1. Create worktree
step "1/9 Create worktree"
if [[ -d "$WORKTREE_PATH" ]]; then
  warn "Worktree already exists at $WORKTREE_PATH — skipping create"
else
  git worktree add "$WORKTREE_PATH" -b "$BRANCH" "$BASE" 2>/dev/null \
    || git worktree add "$WORKTREE_PATH" "$BRANCH" 2>/dev/null \
    || fail "Failed to create worktree"
  ok "Created at $WORKTREE_PATH on branch $BRANCH"
fi

# 2. Merge main (so mission files are visible)
step "2/9 Merge origin/main"
git fetch origin main --quiet 2>/dev/null || true
if git -C "$WORKTREE_PATH" merge origin/main --no-edit 2>/dev/null; then
  ok "Merged origin/main"
else
  warn "Merge conflict — resolving with --theirs for docs/missions/"
  git -C "$WORKTREE_PATH" checkout --theirs docs/missions/ 2>/dev/null || true
  git -C "$WORKTREE_PATH" add docs/missions/ 2>/dev/null || true
  git -C "$WORKTREE_PATH" commit --no-verify --no-edit -m "merge: sync main (auto-resolve missions)" 2>/dev/null || true
  ok "Merged with auto-resolve"
fi

# 3. Copy permissions
step "3/9 Copy permissions + skip-worktree"
mkdir -p "$WORKTREE_PATH/.claude"
cp "$MAIN_DIR/.claude/settings.local.json" "$WORKTREE_PATH/.claude/settings.local.json" 2>/dev/null
git -C "$WORKTREE_PATH" update-index --skip-worktree .claude/settings.local.json 2>/dev/null || true
ok "Permissions copied + skip-worktree set"

# 4. Generate .mcp.json for tap-comms channel
step "4/9 Generate .mcp.json (tap-comms channel)"
# Convert POSIX paths to Windows format for bun fs.watch compatibility
WIN_COMMS_DIR=$(echo "$COMMS_DIR" | sed -E 's|^/([a-zA-Z])/|\U\1:/|')
WIN_MAIN_DIR=$(echo "$MAIN_DIR" | sed -E 's|^/([a-zA-Z])/|\U\1:/|')
cat > "$WORKTREE_PATH/.mcp.json" << MCPEOF
{
  "mcpServers": {
    "tap-comms": {
      "command": "bun",
      "args": ["$WIN_MAIN_DIR/packages/tap-plugin/channels/tap-comms.ts"],
      "env": {
        "TAP_COMMS_DIR": "$WIN_COMMS_DIR",
        "TAP_AGENT_NAME": "unnamed"
      }
    }
  }
}
MCPEOF
ok ".mcp.json generated (TAP_AGENT_NAME: unnamed → use tap_set_name at start)"

# 5. pnpm install
step "5/9 pnpm install"
cd "$WORKTREE_PATH"
if pnpm install --prefer-offline 2>/dev/null | tail -1; then
  ok "Dependencies installed"
else
  warn "pnpm install had issues — trying without frozen lockfile"
  pnpm install 2>/dev/null | tail -1
fi

# 6. Build eslint plugin (needed for lint-staged)
step "6/9 Build eslint-plugin-i18n"
if pnpm build --filter @hua-labs/eslint-plugin-i18n 2>/dev/null | tail -1; then
  ok "ESLint plugin built"
else
  warn "eslint-plugin-i18n build failed — lint-staged may fail on first commit"
fi

# 7. Verify comms
step "7/9 Verify comms"
if [[ -d "$COMMS_DIR/.git" ]]; then
  ok "hua-comms found at $COMMS_DIR"
  # Ensure required directories exist
  mkdir -p "$COMMS_DIR/inbox" "$COMMS_DIR/findings" "$COMMS_DIR/reviews/gen$GENERATION" "$COMMS_DIR/retros/gen$GENERATION" "$COMMS_DIR/letters"
  ok "Comms directories verified (inbox, findings, reviews, retros, letters)"
else
  warn "hua-comms not found — clone it: git clone https://github.com/HUA-Labs/hua-comms.git $COMMS_DIR"
fi

# 8. Verify bun (needed for tap-comms channel)
step "8/9 Verify bun"
if command -v bun &>/dev/null; then
  ok "bun $(bun --version)"
else
  warn "bun not installed — tap-comms channel won't work. Install: npm i -g bun"
fi

# 9. Done
step "9/9 Ready!"
cd "$MAIN_DIR"

echo
echo -e "${DIM}════════════════════════════════════════${NC}"
echo -e "${BOLD}${GREEN}  Worktree ready at:${NC} $WORKTREE_PATH"
echo -e "${BOLD}${GREEN}  Branch:${NC} $BRANCH"
echo -e "${BOLD}${GREEN}  Channel:${NC} tap-comms (TAP_AGENT_NAME: unnamed)"
echo
echo -e "  ${DIM}Launch:${NC}"
echo -e "    cd $WORKTREE_PATH"
echo -e "    claude --dangerously-load-development-channels server:tap-comms"
echo
echo -e "  ${DIM}First message to agent:${NC}"
echo -e "    Read docs/missions/{name}.md and start."
echo -e "    You are a Gen $GENERATION tap agent. Tower: $TOWER_NAME."
echo -e "    Comms at $COMMS_DIR/ — check inbox on start."
echo -e "    Pick a name and call tap_set_name to register it."
echo
