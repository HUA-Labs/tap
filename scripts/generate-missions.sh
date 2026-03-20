#!/usr/bin/env bash
# generate-missions.sh — Generate MISSIONS.md from individual mission files
# Eliminates manual editing and merge conflicts on MISSIONS.md
#
# Usage: bash scripts/generate-missions.sh [missions-dir] [output-file]

set -euo pipefail

MISSIONS_DIR="${1:-docs/missions}"
OUTPUT="${2:-$MISSIONS_DIR/MISSIONS.md}"
CONFIG_FILE=".tap-config"

# Load config
if [[ -f "$CONFIG_FILE" ]]; then
  source "$CONFIG_FILE"
fi

TOWER_NAME="${TAP_TOWER_NAME:-control tower}"
COMMS_DIR="${TAP_COMMS_DIR:-../project-comms}"
GENERATION="${TAP_GENERATION:-}"

# Collect mission data from individual files
declare -a ROWS=()

for f in "$MISSIONS_DIR"/*.md; do
  [[ -f "$f" ]] || continue
  basename_f=$(basename "$f")

  # Skip non-mission files
  [[ "$basename_f" == "MISSIONS.md" ]] && continue
  [[ "$basename_f" == "inbox.md" ]] && continue

  # Extract Meta table fields
  id=$(grep -oP '^\| (M\d+)' "$f" 2>/dev/null | head -1 | sed 's/| //')
  [[ -z "$id" ]] && continue

  # Parse Meta table
  branch=$(grep -A1 "Branch" "$f" | grep '`' | grep -oP '`[^`]+`' | head -1 || echo "—")
  status=$(grep -A1 "Status" "$f" | grep -oP '[🟡🔵🟢🔴⏸️][^|]*' | head -1 | xargs || echo "🟡 planned")
  owner=$(grep -A1 "Owner" "$f" | tail -1 | sed 's/.*| *//' | sed 's/ *|.*//' | xargs || echo "—")

  # Get title from first heading
  title=$(head -5 "$f" | grep "^# " | head -1 | sed 's/^# //' | sed "s/^$id: //")

  # Build link
  link="[${title}](./${basename_f})"

  ROWS+=("| $id | $link | $branch | $status | $owner |")
done

# Sort rows by mission ID
IFS=$'\n' SORTED=($(sort -t'M' -k2 -n <<<"${ROWS[*]}")); unset IFS

# Generate MISSIONS.md
cat > "$OUTPUT" << 'HEADER'
# Mission Control
HEADER

if [[ -n "$GENERATION" ]]; then
  echo "" >> "$OUTPUT"
  echo "> Multi-session coordination hub. Control tower: ${TOWER_NAME}." >> "$OUTPUT"
fi

cat >> "$OUTPUT" << 'TABLE_HEADER'

## Active Missions

| ID | Mission | Branch | Status | Owner |
| -- | ------- | ------ | ------ | ----- |
TABLE_HEADER

for row in "${SORTED[@]}"; do
  echo "$row" >> "$OUTPUT"
done

cat >> "$OUTPUT" << 'FOOTER'

## Status Legend

- 🟡 planned — scope confirmed, not started
- 🔵 active — session working
- 🟢 completed — merged
- 🔴 blocked — has blockers
- ⏸️ paused — suspended (session ended, PR open)

---

*Auto-generated from individual mission files. Do not edit directly.*
FOOTER

echo "Generated $OUTPUT with ${#SORTED[@]} missions"
