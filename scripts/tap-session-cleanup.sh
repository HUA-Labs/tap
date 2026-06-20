#!/usr/bin/env bash
# tap Session Cleanup — stale session artifacts + inbox archiving
# Usage:
#   bash scripts/tap-session-cleanup.sh                  # full cleanup
#   bash scripts/tap-session-cleanup.sh --dry-run        # preview only
#   bash scripts/tap-session-cleanup.sh --inbox-only 3   # archive inbox > 3 days
#   bash scripts/tap-session-cleanup.sh --keep-logs      # skip log truncation
#   bash scripts/tap-session-cleanup.sh --kill-inactive-runtime-pids # kill live runtime PIDs only when heartbeat inactivity is confirmed
#
# Cleans:
#   1. Expired name claims (.claims/)
#   2. Stale Codex processes (codex.exe zombies, Windows only)
#   3. Bridge state dirs (.tmp/codex-app-server-bridge-*)
#   4. Routing runtime registry snapshots/conflicts (.tap-comms/routing-runtimes/)
#   5. Stale PID files (.tap-comms/pids/)
#   6. Stale instance files (.tap-comms/instances/)
#   7. Bridge/app-server logs (.tap-comms/logs/)
#   8. Inbox archiving (comms inbox/ → archive/)
#   9. MCP agent name reset (.mcp.json + state.json → "unnamed")
#  10. Stale Claude sessions (~/.claude/projects/ >7 days)
#  11. Stale Codex sessions (~/.codex/sessions/ >7 days)

set -euo pipefail
shopt -s nullglob

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
COMMS_DIR=""
STATE_DIR="${REPO_ROOT}/.tap-comms"

# Resolve comms dir from .tap-config or env
TAP_CONFIG="${REPO_ROOT}/.tap-config"
if [[ -n "${TAP_COMMS_DIR:-}" ]]; then
  COMMS_DIR="$TAP_COMMS_DIR"
elif [[ -f "$TAP_CONFIG" ]]; then
  COMMS_DIR="$(grep '^TAP_COMMS_DIR=' "$TAP_CONFIG" | cut -d'=' -f2 | tr -d '"')"
fi

# Resolve relative paths
if [[ -n "$COMMS_DIR" && "$COMMS_DIR" != /* && ! "$COMMS_DIR" =~ ^[A-Za-z]: ]]; then
  COMMS_DIR="${REPO_ROOT}/${COMMS_DIR}"
fi

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

# Flags
DRY_RUN=false
INBOX_ONLY=false
KEEP_LOGS=false
KILL_INACTIVE_RUNTIME_PIDS=false
INBOX_DAYS=3

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=true; shift ;;
    --inbox-only) INBOX_ONLY=true; INBOX_DAYS="${2:-3}"; shift 2 ;;
    --keep-logs) KEEP_LOGS=true; shift ;;
    --kill-inactive-runtime-pids) KILL_INACTIVE_RUNTIME_PIDS=true; shift ;;
    *) INBOX_DAYS="$1"; shift ;;
  esac
done

prefix() {
  if $DRY_RUN; then echo -n "[DRY RUN] "; fi
}

kill_pid() {
  local pid="$1"
  if [[ "$OSTYPE" == "msys" || "$OSTYPE" == "cygwin" || "$OSTYPE" == "win32" ]]; then
    taskkill //F //PID "$pid" > /dev/null 2>&1 || true
  else
    kill -9 "$pid" > /dev/null 2>&1 || true
  fi
}

sed_in_place() {
  local expression="$1"
  local file="$2"
  if [[ "$OSTYPE" == "darwin"* ]]; then
    sed -i '' "$expression" "$file"
  else
    sed -i "$expression" "$file"
  fi
}

probe_runtime_heartbeat() {
  local heartbeats_path="$1"
  local agent_id="$2"
  local agent_name="$3"

  if [[ -z "$heartbeats_path" || ! -f "$heartbeats_path" ]]; then
    echo '{"matched":false,"ageSeconds":null,"reason":"missing-heartbeats"}'
    return 0
  fi

  node -e '
const fs = require("fs");
const [heartbeatsPath, agentId, agentName] = process.argv.slice(1);
const result = { matched: false, ageSeconds: null, reason: "no-match" };
try {
  const raw = JSON.parse(fs.readFileSync(heartbeatsPath, "utf8"));
  const entries = Object.entries(raw && typeof raw === "object" ? raw : {});
  const direct = (raw && typeof raw === "object" && raw[agentId]) ? raw[agentId] : null;
  const byId = entries.map(([, hb]) => hb).find((hb) => hb && hb.id === agentId) ?? null;
  const byName = entries
    .map(([, hb]) => hb)
    .filter((hb) => hb && typeof hb.agent === "string" && hb.agent === agentName);
  const heartbeat = direct ?? byId ?? (byName.length === 1 ? byName[0] : null);
  if (!heartbeat) {
    result.reason = byName.length > 1 ? "ambiguous-agent-name" : "no-match";
  } else {
    const candidates = [heartbeat.lastActivity, heartbeat.timestamp]
      .filter((value) => typeof value === "string" && value.trim().length > 0)
      .map((value) => new Date(value).getTime())
      .filter((value) => Number.isFinite(value) && value > 0);
    if (candidates.length === 0) {
      result.matched = true;
      result.reason = "missing-activity";
    } else {
      const freshest = Math.max(...candidates);
      result.matched = true;
      result.ageSeconds = Math.max(0, Math.floor((Date.now() - freshest) / 1000));
      result.reason = typeof heartbeat.status === "string" ? heartbeat.status : "matched";
    }
  }
} catch (error) {
  result.reason = `parse-error:${error && error.message ? error.message : "unknown"}`;
}
process.stdout.write(JSON.stringify(result));
' "$heartbeats_path" "$agent_id" "$agent_name"
}

echo -e "${BOLD}${CYAN}tap Session Cleanup${NC}"
if $DRY_RUN; then echo -e "${YELLOW}(dry-run mode — no changes)${NC}"; fi
echo

cleaned=0

# ── 1. Expired Claims ────────────────────────────────────────────
if ! $INBOX_ONLY; then
  CLAIMS_DIR="${COMMS_DIR:+${COMMS_DIR}/.claims}"
  if [[ -n "$CLAIMS_DIR" && -d "$CLAIMS_DIR" ]]; then
    echo -e "${BOLD}Claims${NC}"
    now=$(date +%s)
    count=0
    for claim_file in "$CLAIMS_DIR"/*.json; do
      [[ -f "$claim_file" ]] || continue
      # Check expiresAt — if expired or missing, remove
      expires=$(grep -o '"expiresAt"[[:space:]]*:[[:space:]]*"[^"]*"' "$claim_file" 2>/dev/null | grep -o '"[^"]*"$' | tr -d '"')
      if [[ -n "$expires" ]]; then
        # Parse ISO date to epoch (portable)
        exp_epoch=$(date -d "$expires" +%s 2>/dev/null || echo "0")
        if [[ "$exp_epoch" -lt "$now" ]]; then
          fname=$(basename "$claim_file")
          echo -e "  $(prefix)${DIM}removing expired: ${fname}${NC}"
          if ! $DRY_RUN; then rm -f "$claim_file"; fi
          count=$((count + 1))
        fi
      fi
    done
    if [[ $count -eq 0 ]]; then
      echo -e "  ${GREEN}✓ no expired claims${NC}"
    else
      echo -e "  ${GREEN}✓ ${count} expired claims removed${NC}"
      cleaned=$((cleaned + count))
    fi
    echo
  fi
fi

# ── 2. Stale Codex Processes ──────────────────────────────────────
if ! $INBOX_ONLY; then
  if [[ "$OSTYPE" == "msys" || "$OSTYPE" == "cygwin" || "$OSTYPE" == "win32" ]]; then
    codex_procs=$(tasklist 2>/dev/null | grep -c "codex.exe" || echo "0")
    if [[ "$codex_procs" -gt 0 ]]; then
      echo -e "${BOLD}Codex Processes${NC}"
      echo -e "  $(prefix)${DIM}killing ${codex_procs} stale codex.exe processes${NC}"
      if ! $DRY_RUN; then
        taskkill //F //IM codex.exe > /dev/null 2>&1 || true
      fi
      echo -e "  ${GREEN}✓ ${codex_procs} codex processes killed${NC}"
      cleaned=$((cleaned + codex_procs))
      echo
    fi
  fi
fi

# ── 3. Bridge State Dirs ─────────────────────────────────────────
if ! $INBOX_ONLY; then
  BRIDGE_DIRS=("${REPO_ROOT}/.tmp"/codex-app-server-bridge-*)
  if [[ ${#BRIDGE_DIRS[@]} -gt 0 ]]; then
    echo -e "${BOLD}Bridge State Dirs${NC}"
    count=0
    for bdir in "${BRIDGE_DIRS[@]}"; do
      [[ -d "$bdir" ]] || continue
      dirname=$(basename "$bdir")
      # Check if bridge has a heartbeat — if stale (>1h), clean
      hb_file="${bdir}/heartbeat.json"
      stale=true
      if [[ -f "$hb_file" ]]; then
        hb_time=$(grep -o '"updatedAt"[[:space:]]*:[[:space:]]*"[^"]*"' "$hb_file" 2>/dev/null | grep -o '"[^"]*"$' | tr -d '"')
        if [[ -n "$hb_time" ]]; then
          hb_epoch=$(date -d "$hb_time" +%s 2>/dev/null || echo "0")
          now=$(date +%s)
          age=$(( now - hb_epoch ))
          if [[ $age -lt 3600 ]]; then
            stale=false
            echo -e "  ${DIM}keeping (active): ${dirname}${NC}"
          fi
        fi
      fi
      if $stale; then
        echo -e "  $(prefix)${DIM}removing stale: ${dirname}${NC}"
        if ! $DRY_RUN; then rm -rf "$bdir"; fi
        count=$((count + 1))
      fi
    done
    if [[ $count -eq 0 ]]; then
      echo -e "  ${GREEN}✓ no stale bridge dirs${NC}"
    else
      echo -e "  ${GREEN}✓ ${count} stale bridge dirs removed${NC}"
      cleaned=$((cleaned + count))
    fi
    echo
  fi
fi

# ── 4. Routing Runtime Registry ──────────────────────────────────
if ! $INBOX_ONLY; then
  RUNTIME_REGISTRY_DIR="${STATE_DIR}/routing-runtimes"
  HEARTBEATS_PATH="${COMMS_DIR:+${COMMS_DIR}/heartbeats.json}"
  INACTIVE_RUNTIME_THRESHOLD_SECS=1800
  if [[ -d "$RUNTIME_REGISTRY_DIR" ]]; then
    echo -e "${BOLD}Routing Runtime Registry${NC}"
    count=0
    stale_snapshots=0
    inactive_runtime_kills=0
    live_runtime_keys=""
    for runtime_file in "$RUNTIME_REGISTRY_DIR"/*.json; do
      [[ -f "$runtime_file" ]] || continue
      count=$((count + 1))
      fname=$(basename "$runtime_file")
      runtime_key=$(grep -o '"runtimeKey"[[:space:]]*:[[:space:]]*"[^"]*"' "$runtime_file" 2>/dev/null | head -1 | cut -d'"' -f4)
      agent_id=$(grep -o '"agentId"[[:space:]]*:[[:space:]]*"[^"]*"' "$runtime_file" 2>/dev/null | head -1 | cut -d'"' -f4)
      agent_name=$(grep -o '"agentName"[[:space:]]*:[[:space:]]*"[^"]*"' "$runtime_file" 2>/dev/null | head -1 | cut -d'"' -f4)
      pid_val=$(grep -o '"pid"[[:space:]]*:[[:space:]]*[0-9]*' "$runtime_file" 2>/dev/null | head -1 | grep -o '[0-9]*$')

      if [[ -n "$pid_val" ]] && kill -0 "$pid_val" 2>/dev/null; then
        if [[ -n "$runtime_key" ]] && [[ "$live_runtime_keys" != *"|${runtime_key}|"* ]]; then
          live_runtime_keys="${live_runtime_keys}|${runtime_key}|"
        fi
        if $KILL_INACTIVE_RUNTIME_PIDS; then
          heartbeat_probe=$(probe_runtime_heartbeat "$HEARTBEATS_PATH" "$agent_id" "$agent_name")
          heartbeat_matched=$(printf '%s' "$heartbeat_probe" | node -e 'const input = JSON.parse(require("fs").readFileSync(0, "utf8")); process.stdout.write(input.matched ? "true" : "false");')
          heartbeat_age=$(printf '%s' "$heartbeat_probe" | node -e 'const input = JSON.parse(require("fs").readFileSync(0, "utf8")); process.stdout.write(input.ageSeconds == null ? "" : String(input.ageSeconds));')
          heartbeat_reason=$(printf '%s' "$heartbeat_probe" | node -e 'const input = JSON.parse(require("fs").readFileSync(0, "utf8")); process.stdout.write(input.reason || "unknown");')

          if [[ "$heartbeat_matched" == "true" && -n "$heartbeat_age" && "$heartbeat_age" -gt "$INACTIVE_RUNTIME_THRESHOLD_SECS" ]]; then
            echo -e "  $(prefix)${DIM}killing inactive runtime pid ${pid_val}: ${fname} (${agent_name:-unknown}, ${runtime_key:-unknown}, heartbeat idle ${heartbeat_age}s)${NC}"
            if ! $DRY_RUN; then kill_pid "$pid_val"; fi
            inactive_runtime_kills=$((inactive_runtime_kills + 1))
          else
            echo -e "  ${DIM}live runtime: ${fname} (pid ${pid_val}, ${agent_name:-unknown}, ${runtime_key:-unknown}, heartbeat ${heartbeat_reason}${heartbeat_age:+, idle ${heartbeat_age}s})${NC}"
          fi
        else
          echo -e "  ${DIM}live runtime: ${fname} (pid ${pid_val}, ${agent_name:-unknown}, ${runtime_key:-unknown})${NC}"
        fi
      else
        echo -e "  $(prefix)${DIM}removing stale runtime snapshot: ${fname}${NC}"
        if ! $DRY_RUN; then rm -f "$runtime_file"; fi
        stale_snapshots=$((stale_snapshots + 1))
      fi
    done

    unique_runtime_count=$(printf '%s' "$live_runtime_keys" | tr '|' '\n' | awk 'NF { count += 1 } END { print count + 0 }')
    if [[ "$unique_runtime_count" -gt 1 ]]; then
      echo -e "  ${YELLOW}⚠ ${unique_runtime_count} live runtime keys share ${STATE_DIR}${NC}"
      if ! $KILL_INACTIVE_RUNTIME_PIDS; then
        echo -e "  ${DIM}hint: rerun with --kill-inactive-runtime-pids to terminate only heartbeat-inactive live runtime PIDs${NC}"
      fi
    fi
    if [[ $count -eq 0 ]]; then
      echo -e "  ${GREEN}✓ no routing runtime snapshots${NC}"
    else
      echo -e "  ${GREEN}✓ ${count} runtime snapshots scanned${NC}"
      if [[ $stale_snapshots -gt 0 ]]; then
        echo -e "  ${GREEN}✓ ${stale_snapshots} stale runtime snapshots removed${NC}"
        cleaned=$((cleaned + stale_snapshots))
      fi
      if [[ $inactive_runtime_kills -gt 0 ]]; then
        echo -e "  ${GREEN}✓ ${inactive_runtime_kills} inactive runtime PID(s) killed${NC}"
        cleaned=$((cleaned + inactive_runtime_kills))
      fi
    fi
    echo
  fi
fi

# ── 5. Stale PID Files ───────────────────────────────────────────
if ! $INBOX_ONLY; then
  PID_DIR="${STATE_DIR}/pids"
  if [[ -d "$PID_DIR" ]]; then
    echo -e "${BOLD}PID Files${NC}"
    count=0
    for pid_file in "$PID_DIR"/*.json; do
      [[ -f "$pid_file" ]] || continue
      fname=$(basename "$pid_file")
      # Check if PID is still alive
      pid_val=$(grep -o '"pid"[[:space:]]*:[[:space:]]*[0-9]*' "$pid_file" 2>/dev/null | head -1 | grep -o '[0-9]*$')
      if [[ -n "$pid_val" ]]; then
        if ! kill -0 "$pid_val" 2>/dev/null; then
          echo -e "  $(prefix)${DIM}removing (pid ${pid_val} dead): ${fname}${NC}"
          if ! $DRY_RUN; then rm -f "$pid_file"; fi
          count=$((count + 1))
        else
          echo -e "  ${DIM}keeping (pid ${pid_val} alive): ${fname}${NC}"
        fi
      fi
    done
    if [[ $count -eq 0 ]]; then
      echo -e "  ${GREEN}✓ no stale PID files${NC}"
    else
      echo -e "  ${GREEN}✓ ${count} stale PID files removed${NC}"
      cleaned=$((cleaned + count))
    fi
    echo
  fi
fi

# ── 6. Stale Instance Files ──────────────────────────────────────
if ! $INBOX_ONLY; then
  INST_DIR="${STATE_DIR}/instances"
  if [[ -d "$INST_DIR" ]]; then
    echo -e "${BOLD}Instance Files${NC}"
    count=0
    for inst_file in "$INST_DIR"/*.json; do
      [[ -f "$inst_file" ]] || continue
      fname=$(basename "$inst_file")
      echo -e "  $(prefix)${DIM}removing: ${fname}${NC}"
      if ! $DRY_RUN; then rm -f "$inst_file"; fi
      count=$((count + 1))
    done
    if [[ $count -eq 0 ]]; then
      echo -e "  ${GREEN}✓ no instance files${NC}"
    else
      echo -e "  ${GREEN}✓ ${count} instance files removed${NC}"
      cleaned=$((cleaned + count))
    fi
    echo
  fi
fi

# ── 7. Logs ──────────────────────────────────────────────────────
if ! $INBOX_ONLY && ! $KEEP_LOGS; then
  LOG_DIR="${STATE_DIR}/logs"
  if [[ -d "$LOG_DIR" ]]; then
    echo -e "${BOLD}Logs${NC}"
    count=0
    total_size=0
    for log_file in "$LOG_DIR"/*; do
      [[ -f "$log_file" ]] || continue
      fname=$(basename "$log_file")
      fsize=$(stat -c%s "$log_file" 2>/dev/null || stat -f%z "$log_file" 2>/dev/null || echo "0")
      total_size=$((total_size + fsize))
      count=$((count + 1))
    done
    human_size="$((total_size / 1024))KB"
    if [[ $total_size -gt 1048576 ]]; then
      human_size="$((total_size / 1048576))MB"
    fi
    if [[ $count -gt 0 ]]; then
      echo -e "  $(prefix)${DIM}truncating ${count} log files (${human_size} total)${NC}"
      if ! $DRY_RUN; then
        for log_file in "$LOG_DIR"/*; do
          [[ -f "$log_file" ]] || continue
          : > "$log_file"
        done
      fi
      echo -e "  ${GREEN}✓ ${count} logs truncated${NC}"
      cleaned=$((cleaned + count))
    else
      echo -e "  ${GREEN}✓ no logs${NC}"
    fi
    echo
  fi
fi

# ── 8. Inbox Archiving ───────────────────────────────────────────
if [[ -n "$COMMS_DIR" ]]; then
  INBOX_DIR="${COMMS_DIR}/inbox"
  ARCHIVE_DIR="${COMMS_DIR}/archive"
  if [[ -d "$INBOX_DIR" ]]; then
    echo -e "${BOLD}Inbox Archive${NC} (older than ${INBOX_DAYS} days)"
    cutoff_date=$(date -d "-${INBOX_DAYS} days" +%Y%m%d 2>/dev/null || date -v-${INBOX_DAYS}d +%Y%m%d 2>/dev/null)
    count=0
    if [[ -n "$cutoff_date" ]]; then
      if ! $DRY_RUN; then mkdir -p "$ARCHIVE_DIR"; fi
      for inbox_file in "$INBOX_DIR"/*.md; do
        [[ -f "$inbox_file" ]] || continue
        fname=$(basename "$inbox_file")
        # Extract YYYYMMDD from filename
        file_date=$(echo "$fname" | grep -o '^[0-9]\{8\}')
        if [[ -n "$file_date" && "$file_date" < "$cutoff_date" ]]; then
          echo -e "  $(prefix)${DIM}archiving: ${fname}${NC}"
          if ! $DRY_RUN; then mv "$inbox_file" "$ARCHIVE_DIR/$fname"; fi
          count=$((count + 1))
        fi
      done
    fi
    if [[ $count -eq 0 ]]; then
      echo -e "  ${GREEN}✓ no files to archive${NC}"
    else
      echo -e "  ${GREEN}✓ ${count} files archived${NC}"
      cleaned=$((cleaned + count))
    fi
    echo
  fi
fi

# ── 9. MCP Agent Name Reset ─────────────────────────────────────
if ! $INBOX_ONLY; then
  echo -e "${BOLD}MCP Agent Name${NC}"
  mcp_files=("${REPO_ROOT}/.mcp.json")
  # Also check worktree .mcp.json files
  for wt in "${REPO_ROOT}/.tmp"/wt-*; do
    [[ -f "${wt}/.mcp.json" ]] && mcp_files+=("${wt}/.mcp.json")
  done

  for mcp_file in "${mcp_files[@]}"; do
    [[ -f "$mcp_file" ]] || continue
    current_name=$(grep -o '"TAP_AGENT_NAME"[[:space:]]*:[[:space:]]*"[^"]*"' "$mcp_file" 2>/dev/null | grep -o '"[^"]*"$' | tr -d '"')
    if [[ -n "$current_name" && "$current_name" != "unnamed" ]]; then
      rel_path="${mcp_file#${REPO_ROOT}/}"
      echo -e "  $(prefix)${DIM}resetting ${rel_path}: \"${current_name}\" → \"unnamed\"${NC}"
      if ! $DRY_RUN; then
        sed_in_place "s/\"TAP_AGENT_NAME\"[[:space:]]*:[[:space:]]*\"[^\"]*\"/\"TAP_AGENT_NAME\": \"unnamed\"/" "$mcp_file"
      fi
      cleaned=$((cleaned + 1))
    else
      echo -e "  ${GREEN}✓ already unnamed${NC}"
    fi
  done

  # Also reset state.json agentName (MCP server reads this on startup)
  STATE_FILE="${STATE_DIR}/state.json"
  if [[ -f "$STATE_FILE" ]]; then
    state_name=$(grep -o '"agentName"[[:space:]]*:[[:space:]]*"[^"]*"' "$STATE_FILE" 2>/dev/null | grep -o '"[^"]*"$' | tr -d '"')
    if [[ -n "$state_name" && "$state_name" != "unnamed" ]]; then
      echo -e "  $(prefix)${DIM}resetting state.json agentName: \"${state_name}\" → \"unnamed\"${NC}"
      if ! $DRY_RUN; then
        sed_in_place "s/\"agentName\"[[:space:]]*:[[:space:]]*\"[^\"]*\"/\"agentName\": \"unnamed\"/" "$STATE_FILE"
      fi
      cleaned=$((cleaned + 1))
    fi
  fi
  echo
fi

# ── 10. Stale Claude Sessions ─────────────────────────────────────
if ! $INBOX_ONLY; then
  CLAUDE_PROJ_DIR="$HOME/.claude/projects"
  if [[ -d "$CLAUDE_PROJ_DIR" ]]; then
    echo -e "${BOLD}Claude Sessions${NC} (older than 7 days)"
    count=0
    total_freed=0
    cutoff_epoch=$(date -d "-7 days" +%s 2>/dev/null || date -v-7d +%s 2>/dev/null)
    # Only clean hua-related project dirs
    for proj_dir in "$CLAUDE_PROJ_DIR"/C--hua*; do
      [[ -d "$proj_dir" ]] || continue
      proj_name=$(basename "$proj_dir")
      for session_file in "$proj_dir"/*.jsonl; do
        [[ -f "$session_file" ]] || continue
        file_mtime=$(stat -c%Y "$session_file" 2>/dev/null || stat -f%m "$session_file" 2>/dev/null || echo "0")
        if [[ "$file_mtime" -lt "$cutoff_epoch" ]]; then
          fsize=$(stat -c%s "$session_file" 2>/dev/null || stat -f%z "$session_file" 2>/dev/null || echo "0")
          total_freed=$((total_freed + fsize))
          if ! $DRY_RUN; then rm -f "$session_file"; fi
          count=$((count + 1))
        fi
      done
    done
    if [[ $count -gt 0 ]]; then
      human_freed="$((total_freed / 1048576))MB"
      echo -e "  $(prefix)${DIM}${count} stale session files (${human_freed})${NC}"
      echo -e "  ${GREEN}✓ ${count} Claude sessions cleaned${NC}"
      cleaned=$((cleaned + count))
    else
      echo -e "  ${GREEN}✓ no stale sessions${NC}"
    fi
    echo
  fi
fi

# ── 11. Stale Codex Sessions ─────────────────────────────────────
if ! $INBOX_ONLY; then
  CODEX_RETENTION_SCRIPT="${REPO_ROOT}/scripts/codex/codex-session-retention.mjs"
  if [[ -f "$CODEX_RETENTION_SCRIPT" && -d "$HOME/.codex/sessions" ]]; then
    echo -e "${BOLD}Codex Sessions${NC} (active-session aware)"
    if $DRY_RUN; then
      node "$CODEX_RETENTION_SCRIPT" --dry-run --keep-days 7 | sed 's/^/  /' || true
    else
      node "$CODEX_RETENTION_SCRIPT" --delete --keep-days 7 | sed 's/^/  /' || true
    fi
    echo
  fi
fi

# ── Summary ──────────────────────────────────────────────────────
if $DRY_RUN; then
  echo -e "${YELLOW}${BOLD}Dry run complete.${NC} ${cleaned} items would be cleaned."
  echo -e "${DIM}Run without --dry-run to apply.${NC}"
else
  echo -e "${GREEN}${BOLD}Cleanup complete.${NC} ${cleaned} items cleaned."
fi
