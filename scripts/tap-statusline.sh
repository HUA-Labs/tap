#!/bin/bash
# tap statusline for Claude Code
# Reads tap comms state and displays agent/message/bridge status.
#
# Configure in ~/.claude/settings.json:
# { "statusLine": { "type": "command", "command": "bash /path/to/tap-statusline.sh" } }
#
# Or use: /statusline-setup (if available)

# Read Claude Code session JSON from stdin
SESSION_JSON=$(cat)

# ── Config ──
COMMS_DIR="${TAP_COMMS_DIR:-}"
STATE_DIR="${TAP_STATE_DIR:-}"
REPO_ROOT="${TAP_REPO_ROOT:-$(pwd)}"

# Auto-detect comms dir
if [ -z "$COMMS_DIR" ]; then
  if [ -f "$REPO_ROOT/.tap-comms/state.json" ]; then
    # Read commsDir from state.json
    # Pretty JSON: "commsDir": "..." (with spaces around colon)
    COMMS_DIR=$(grep -o '"commsDir"[[:space:]]*:[[:space:]]*"[^"]*"' "$REPO_ROOT/.tap-comms/state.json" 2>/dev/null | head -1 | sed 's/.*: *"//;s/"$//')
  fi
  [ -z "$COMMS_DIR" ] && COMMS_DIR="$REPO_ROOT/tap-comms"
fi

if [ -z "$STATE_DIR" ]; then
  STATE_DIR="$REPO_ROOT/.tap-comms"
fi

# ── Agents ──
AGENT_COUNT=0
if [ -f "$COMMS_DIR/heartbeats.json" ]; then
  # Count agents with recent heartbeat (last 10 minutes)
  AGENT_COUNT=$(python3 -c "
import json, time, sys
try:
    with open('$COMMS_DIR/heartbeats.json', encoding='utf-8') as f:
        data = json.load(f)
    now = time.time()
    cutoff = now - 600  # 10 minutes
    active = 0
    for v in data.values():
        if not isinstance(v, dict):
            continue
        if v.get('status') not in ('active', 'idle'):
            continue
        # Check freshness using the MORE RECENT of timestamp and lastActivity
        from datetime import datetime
        best_t = 0
        for key in ('timestamp', 'lastActivity'):
            ts = v.get(key)
            if ts:
                try:
                    t = datetime.fromisoformat(ts.replace('Z', '+00:00')).timestamp()
                    if t > best_t:
                        best_t = t
                except:
                    pass
        if best_t > 0 and best_t < cutoff:
            continue
        active += 1
    print(active)
except:
    print(0)
" 2>/dev/null || echo 0)
fi

# ── Unread ──
UNREAD=0
if [ -d "$COMMS_DIR/inbox" ]; then
  UNREAD=$(find "$COMMS_DIR/inbox" -name "*.md" -newer "$STATE_DIR/.last-read" 2>/dev/null | wc -l || echo 0)
  # Fallback: count all inbox files if no .last-read marker
  if [ "$UNREAD" = "0" ] && [ ! -f "$STATE_DIR/.last-read" ]; then
    UNREAD=$(find "$COMMS_DIR/inbox" -name "*.md" 2>/dev/null | wc -l)
  fi
fi

# ── Bridge ──
BRIDGE_STATUS="off"
BRIDGE_COUNT=0
if [ -d "$STATE_DIR/pids" ]; then
  for pid_file in "$STATE_DIR/pids"/bridge-*.json; do
    [ -f "$pid_file" ] || continue
    BRIDGE_COUNT=$((BRIDGE_COUNT + 1))
    pid=$(grep -o '"pid"[[:space:]]*:[[:space:]]*[0-9]*' "$pid_file" 2>/dev/null | head -1 | grep -o '[0-9]*$')
    if [ -n "$pid" ]; then
      # Cross-platform PID check: tasklist on Windows, kill -0 on Unix
      if command -v tasklist &>/dev/null; then
        tasklist //FI "PID eq $pid" 2>/dev/null | grep -q "$pid" && BRIDGE_STATUS="on"
      else
        kill -0 "$pid" 2>/dev/null && BRIDGE_STATUS="on"
      fi
    fi
  done
fi

# ── Agent Name ──
AGENT_NAME="${TAP_AGENT_NAME:-}"
if [ -z "$AGENT_NAME" ] && [ -f "$STATE_DIR/.agent-name" ]; then
  AGENT_NAME=$(cat "$STATE_DIR/.agent-name" 2>/dev/null)
fi

# ── Format ──
# Icons: 🟢 active, 🔴 off, 📨 unread, 🌉 bridge
if [ "$AGENT_COUNT" -gt 0 ]; then
  AGENT_ICON="🟢"
else
  AGENT_ICON="⚪"
fi

if [ "$BRIDGE_STATUS" = "on" ]; then
  BRIDGE_ICON="🌉"
else
  BRIDGE_ICON="⛔"
fi

UNREAD_ICON=""
if [ "$UNREAD" -gt 0 ]; then
  UNREAD_ICON="📨"
fi

# ── Usage (from Claude Code session JSON) ──
USAGE_STR=""
if [ -n "$SESSION_JSON" ]; then
  USAGE_STR=$(echo "$SESSION_JSON" | python3 -c "
import json, sys
try:
    d = json.loads(sys.stdin.read())
    ctx = d.get('context_window', {})
    rl = d.get('rate_limits', {}).get('five_hour', {})
    cost = d.get('cost', {}).get('total_cost_usd', 0)
    ctx_pct = ctx.get('used_percentage', 0)
    rl_pct = rl.get('used_percentage', 0)
    # Build gauge: 10 blocks
    filled = rl_pct // 10
    empty = 10 - filled
    gauge = '#' * filled + '-' * empty
    cost_str = f' | ${cost:.1f}' if cost > 0 else ''
    sys.stdout.buffer.write(f'[{gauge}] {rl_pct}%{cost_str}\n'.encode('utf-8'))
except:
    print('')
" 2>/dev/null)
fi

# Output
NAME_PREFIX=""
[ -n "$AGENT_NAME" ] && NAME_PREFIX="[$AGENT_NAME] "

USAGE_SUFFIX=""
[ -n "$USAGE_STR" ] && USAGE_SUFFIX=" | $USAGE_STR"

echo "${NAME_PREFIX}${AGENT_ICON} ${AGENT_COUNT} agents | ${UNREAD_ICON}${UNREAD} unread | ${BRIDGE_ICON} bridge${USAGE_SUFFIX}"
