#!/usr/bin/env bash
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# Project root (directory of this script's parent)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

PID_FILE="$ROOT_DIR/.local-pids"

echo -e "${BLUE}🛑 Stopping local development processes...${NC}"

if [ ! -f "$PID_FILE" ]; then
  echo -e "${YELLOW}⚠️  No PID file found at $PID_FILE. Nothing to stop.${NC}"
  exit 0
fi

# Read and kill each PID
KILLED=0
FAILED=0

while IFS= read -r pid; do
  if [ -z "$pid" ]; then
    continue
  fi

  if kill -0 "$pid" 2>/dev/null; then
    echo -e "   Killing process ${YELLOW}$pid${NC}..."
    kill "$pid" 2>/dev/null && KILLED=$((KILLED + 1)) || FAILED=$((FAILED + 1))
  else
    echo -e "   Process ${YELLOW}$pid${NC} is not running (already stopped)."
  fi
done < "$PID_FILE"

# Remove PID file
rm -f "$PID_FILE"

if [ "$FAILED" -gt 0 ]; then
  echo -e "${YELLOW}⚠️  $KILLED process(es) stopped, $FAILED could not be killed.${NC}"
else
  echo -e "${GREEN}✅ $KILLED process(es) stopped. PID file removed.${NC}"
fi
