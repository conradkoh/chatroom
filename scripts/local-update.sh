#!/usr/bin/env bash
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# Project root (directory of this script's parent)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

PID_FILE="$ROOT_DIR/.local-pids"
LOG_DIR="$ROOT_DIR/.local-logs"
BACKEND_LOG="$LOG_DIR/backend.log"
WEBAPP_LOG="$LOG_DIR/webapp.log"
DAEMON_LOG="$LOG_DIR/daemon.log"

echo -e "${BOLD}${CYAN}========================================${NC}"
echo -e "${BOLD}${CYAN}   Chatroom Local Update & Restart      ${NC}"
echo -e "${BOLD}${CYAN}========================================${NC}"
echo ""

cd "$ROOT_DIR"

# Step 1: Stop running processes
echo -e "${BLUE}🛑 Stopping running processes...${NC}"
bash "$SCRIPT_DIR/local-stop.sh"
echo ""

# Step 2: Pull latest code from master
echo -e "${BLUE}🔄 Switching to master and pulling latest changes...${NC}"
git checkout master
git pull
echo -e "${GREEN}✅ Code updated.${NC}"
echo ""

# Step 3: Install dependencies
echo -e "${BLUE}📦 Installing dependencies...${NC}"
pnpm install
echo -e "${GREEN}✅ Dependencies installed.${NC}"
echo ""

# Step 4: Build CLI package
echo -e "${BLUE}🔨 Building CLI package...${NC}"
pnpm --filter chatroom-cli build
echo -e "${GREEN}✅ CLI built.${NC}"
echo ""

# Step 5: Build webapp
echo -e "${BLUE}🔨 Building webapp (production mode)...${NC}"
cd "$ROOT_DIR/apps/webapp"
pnpm build
echo -e "${GREEN}✅ Webapp built.${NC}"
echo ""

cd "$ROOT_DIR"

# Step 6: Create log directory
mkdir -p "$LOG_DIR"

# Step 7: Start backend
echo -e "${BLUE}🚀 Starting Convex backend...${NC}"
cd "$ROOT_DIR/services/backend"
CONVEX_NON_INTERACTIVE=true \
  DOCUMENT_RETENTION_DELAY=1 \
  INDEX_RETENTION_DELAY=1 \
  RETENTION_DELETE_FREQUENCY=10 \
  pnpm exec convex dev --local --local-backend-version precompiled-2026-04-07-9ad94d1 \
  > "$BACKEND_LOG" 2>&1 &
BACKEND_PID=$!
echo -e "${GREEN}✅ Backend started (PID: $BACKEND_PID). Logs: $BACKEND_LOG${NC}"

cd "$ROOT_DIR"

# Step 8: Start webapp
echo -e "${BLUE}🚀 Starting webapp (production mode)...${NC}"
cd "$ROOT_DIR/apps/webapp"
pnpm start > "$WEBAPP_LOG" 2>&1 &
WEBAPP_PID=$!
echo -e "${GREEN}✅ Webapp started (PID: $WEBAPP_PID). Logs: $WEBAPP_LOG${NC}"

cd "$ROOT_DIR"

# Step 9: Start machine daemon
echo -e "${BLUE}🚀 Starting machine daemon...${NC}"
chatroom machine daemon start > "$DAEMON_LOG" 2>&1 &
DAEMON_PID=$!
echo -e "${GREEN}✅ Daemon started (PID: $DAEMON_PID). Logs: $DAEMON_LOG${NC}"

# Save PIDs
echo "$BACKEND_PID" > "$PID_FILE"
echo "$WEBAPP_PID" >> "$PID_FILE"
echo "$DAEMON_PID" >> "$PID_FILE"

echo ""
echo -e "${BOLD}${GREEN}========================================${NC}"
echo -e "${BOLD}${GREEN}   ✅ Local environment updated!        ${NC}"
echo -e "${BOLD}${GREEN}========================================${NC}"
echo ""
echo -e "${CYAN}📋 Processes:${NC}"
echo -e "   Backend PID : ${YELLOW}$BACKEND_PID${NC}"
echo -e "   Webapp PID  : ${YELLOW}$WEBAPP_PID${NC}"
echo -e "   Daemon PID  : ${YELLOW}$DAEMON_PID${NC}"
echo ""
echo -e "${CYAN}📁 Logs:${NC}"
echo -e "   Backend : ${YELLOW}$BACKEND_LOG${NC}"
echo -e "   Webapp  : ${YELLOW}$WEBAPP_LOG${NC}"
echo -e "   Daemon  : ${YELLOW}$DAEMON_LOG${NC}"
echo ""
echo -e "${CYAN}🔧 Commands:${NC}"
echo -e "   Stop    : ${YELLOW}pnpm local:stop${NC}"
