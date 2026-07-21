#!/usr/bin/env bash

# Legacy PID-file based stop for the old production-mode local stack.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PID_FILE="$ROOT_DIR/.chatroom/local-pids"

echo "pnpm local:stop — legacy cleanup"
echo ""
echo "Local development now uses 'pnpm dev' (foreground). Stop it with Ctrl+C in that terminal."
echo ""

if [ -f "$PID_FILE" ]; then
  echo "Found legacy PID file from old local scripts. Stopping those processes..."
  while IFS= read -r pid; do
    [ -z "$pid" ] && continue
    if kill -0 "$pid" 2>/dev/null; then
      echo "  Killing PID $pid"
      kill "$pid" 2>/dev/null || true
    fi
  done < "$PID_FILE"
  rm -f "$PID_FILE"
  echo "Legacy processes stopped."
else
  echo "No legacy PID file at $PID_FILE."
fi
