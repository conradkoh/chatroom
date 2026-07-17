#!/usr/bin/env bash
# Kill Vitest processes started from this repo (main processes and fork workers).
# Scoped to $ROOT_DIR so other projects on the machine are unaffected.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCOPE="${1:-$ROOT_DIR}"

if [[ "$SCOPE" != "$ROOT_DIR" && "$SCOPE" != "$ROOT_DIR"/* ]]; then
  echo "kill-stale-vitest: scope must be inside $ROOT_DIR" >&2
  exit 1
fi

# pgrep -f treats the pattern as an extended regex on macOS and Linux.
escape_regex() {
  printf '%s' "$1" | sed 's/[.[\*^$()+?{|]/\\&/g'
}

SCOPE_RE="$(escape_regex "$SCOPE")"
PATTERN="${SCOPE_RE}.*vitest"

collect_pids() {
  pgrep -f "$PATTERN" 2>/dev/null || true
}

should_skip_pid() {
  local pid="$1"
  local cmd

  if [[ "$pid" == "$$" || "$pid" == "$PPID" ]]; then
    return 0
  fi

  cmd="$(ps -p "$pid" -o command= 2>/dev/null || true)"
  case "$cmd" in
    *kill-stale-vitest.sh*) return 0 ;;
  esac

  return 1
}

kill_pids() {
  local signal="$1"
  local pid

  for pid in $(collect_pids); do
    if should_skip_pid "$pid"; then
      continue
    fi
    kill "-$signal" "$pid" 2>/dev/null || true
  done
}

before_count="$(collect_pids | wc -l | tr -d ' ')"
if [[ "$before_count" == "0" ]]; then
  exit 0
fi

kill_pids TERM
sleep 0.5
kill_pids KILL

after_count="$(collect_pids | wc -l | tr -d ' ')"
killed=$((before_count - after_count))

if [[ "$killed" -gt 0 ]]; then
  echo "kill-stale-vitest: stopped $killed Vitest process(es) under $(basename "$SCOPE")"
fi
