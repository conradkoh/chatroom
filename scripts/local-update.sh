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

CHATROOM_DIR="$ROOT_DIR/.chatroom"
PID_FILE="$CHATROOM_DIR/local-pids"
LOG_DIR="$CHATROOM_DIR/local-logs"
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

# Step 2: Pull latest changes on current branch
echo -e "${BLUE}🔄 Pulling latest changes...${NC}"
git pull
echo -e "${GREEN}✅ Code updated.${NC}"
echo ""

# Step 3: Install dependencies
echo -e "${BLUE}📦 Installing dependencies...${NC}"
pnpm install
echo -e "${GREEN}✅ Dependencies installed.${NC}"
echo ""

# Resolve backend URL from webapp .env.local (single source of truth)
# This ensures CLI, daemon, and webapp all connect to the same local backend.
WEBAPP_ENV="$ROOT_DIR/apps/webapp/.env.local"
if [ ! -f "$WEBAPP_ENV" ]; then
  echo -e "${RED}❌ Missing $WEBAPP_ENV — run pnpm setup first.${NC}"
  exit 1
fi
BACKEND_URL=$(grep "^NEXT_PUBLIC_CONVEX_URL=" "$WEBAPP_ENV" | cut -d'=' -f2- | tr -d '[:space:]')
if [ -z "$BACKEND_URL" ]; then
  echo -e "${RED}❌ NEXT_PUBLIC_CONVEX_URL not found in $WEBAPP_ENV${NC}"
  exit 1
fi
echo -e "${CYAN}🔗 Resolved backend URL: ${YELLOW}$BACKEND_URL${NC}"

# Resolve webapp port from .env.local (respects existing configuration)
WEBAPP_PORT=$(grep "^PORT=" "$WEBAPP_ENV" | cut -d'=' -f2- | tr -d '[:space:]')
if [ -z "$WEBAPP_PORT" ]; then
  WEBAPP_PORT=3000
fi
echo -e "${CYAN}🔗 Webapp port: ${YELLOW}$WEBAPP_PORT${NC}"
echo ""

# Step 4: Build CLI package (via Turborepo pipeline)
echo -e "${BLUE}🔨 Building CLI package...${NC}"
pnpm exec turbo run build --filter=chatroom-cli
echo -e "${GREEN}✅ CLI built.${NC}"
echo ""

# Step 5: Build webapp (via Turborepo pipeline)
echo -e "${BLUE}🔨 Building webapp (production mode)...${NC}"
pnpm exec turbo run build --filter=@workspace/webapp
echo -e "${GREEN}✅ Webapp built.${NC}"
echo ""

cd "$ROOT_DIR"

# Step 6: Create .chatroom and log directories
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
# Explicitly pass PORT to ensure it respects the configured port from .env.local
echo -e "${BLUE}🚀 Starting webapp (production mode on port $WEBAPP_PORT)...${NC}"
cd "$ROOT_DIR/apps/webapp"
PORT=$WEBAPP_PORT pnpm start > "$WEBAPP_LOG" 2>&1 &
WEBAPP_PID=$!
echo -e "${GREEN}✅ Webapp started (PID: $WEBAPP_PID). Logs: $WEBAPP_LOG${NC}"

cd "$ROOT_DIR"

# Step 9: Start machine daemon with the resolved backend URL
echo -e "${BLUE}🚀 Starting machine daemon (CHATROOM_CONVEX_URL=$BACKEND_URL)...${NC}"
CHATROOM_CONVEX_URL="$BACKEND_URL" chatroom machine daemon start > "$DAEMON_LOG" 2>&1 &
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
echo -e "${CYAN}🔗 Backend URL: ${YELLOW}$BACKEND_URL${NC}"
echo -e "${CYAN}🔗 Webapp URL:  ${YELLOW}http://localhost:$WEBAPP_PORT${NC}"
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
