#!/usr/bin/env bash

tap_trim_path_value() {
  local value="${1:-}"
  value="${value#\"}"
  value="${value%\"}"
  value="${value#\'}"
  value="${value%\'}"
  printf '%s' "$value"
}

tap_to_posix_path() {
  local value
  value="$(tap_trim_path_value "${1:-}")"

  if [[ "$value" =~ ^([A-Za-z]):[\\/](.*)$ ]]; then
    local drive="${BASH_REMATCH[1],,}"
    local rest="${BASH_REMATCH[2]//\\//}"
    printf '/%s/%s\n' "$drive" "$rest"
    return
  fi

  printf '%s\n' "$value"
}

tap_resolve_path() {
  local repo_root="${1:?repo_root is required}"
  local raw
  raw="$(tap_to_posix_path "${2:-}")"

  if [[ -z "$raw" ]]; then
    return 1
  fi

  if [[ "$raw" =~ ^/ ]]; then
    if command -v realpath >/dev/null 2>&1; then
      realpath -m "$raw"
    else
      printf '%s\n' "$raw"
    fi
    return
  fi

  local candidate="${repo_root}/${raw}"
  if command -v realpath >/dev/null 2>&1; then
    realpath -m "$candidate"
    return
  fi

  local parent
  parent="$(dirname "$candidate")"
  local name
  name="$(basename "$candidate")"
  if cd "$parent" 2>/dev/null; then
    printf '%s/%s\n' "$(pwd)" "$name"
  else
    printf '%s\n' "$candidate"
  fi
}

tap_to_windows_path() {
  local value
  value="$(tap_to_posix_path "${1:-}")"

  if [[ "$value" =~ ^/([A-Za-z])/(.*)$ ]]; then
    local drive="${BASH_REMATCH[1]^^}"
    printf '%s:/%s\n' "$drive" "${BASH_REMATCH[2]}"
    return
  fi

  printf '%s\n' "$value"
}

tap_load_config() {
  local repo_root="${1:?repo_root is required}"
  local config_file="${repo_root}/.tap-config"

  if [[ -f "$config_file" ]]; then
    # shellcheck source=/dev/null
    source "$config_file"
  fi

  TAP_REPO_ROOT="$repo_root"
  TAP_COMMS_DIR_RESOLVED="$(tap_resolve_path "$repo_root" "${TAP_COMMS_DIR:-../project-comms}")"
  TAP_MISSIONS_DIR_RESOLVED="$(tap_resolve_path "$repo_root" "${TAP_MISSIONS_DIR:-./docs/missions}")"
  TAP_WORKTREE_BASE_RESOLVED="$(tap_resolve_path "$repo_root" "${TAP_WORKTREE_BASE:-..}")"
}
