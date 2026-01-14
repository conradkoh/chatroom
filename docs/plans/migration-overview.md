# Chatroom-CLI Migration Plan

## Overview

This document outlines the migration plan for porting features from `chatroom-cli` to the new starter template application. The migration will preserve all existing functionality while adapting to the target application's tech stack and conventions.

## Source Application (chatroom-cli)

**Tech Stack:**

- Runtime: Bun
- Package Manager: Bun
- Backend: Convex
- Frontend: React (bundled with Bun)
- CLI: Commander.js

**Key Features:**

1. **Backend (Convex)**

   - Chatrooms management (create, get, update status, interrupt)
   - Participants management (join, list, update status)
   - Messages (send, list, claim, routing logic)
   - Role hierarchy system

2. **Frontend (Web Dashboard)**

   - Real-time chatroom dashboard
   - Agent status panels
   - Message feed with markdown support
   - Team status indicators
   - Setup checklist for onboarding
   - Prompt generation and copy functionality

3. **CLI**
   - `chatroom start` - Start web server
   - `chatroom init` - Initialize configuration
   - `chatroom create` - Create new chatroom
   - `chatroom resume` - Resume existing chatroom
   - `chatroom list` - List chatroom history
   - `chatroom complete` - Mark chatroom as completed
   - `chatroom wait-for-message` - Join and wait for messages
   - `chatroom send` - Send messages
   - `chatroom task-complete` - Complete task and handoff

## Target Application

**Tech Stack:**

- Runtime: Node.js
- Package Manager: pnpm
- Monorepo: Nx
- Backend: Convex (services/backend)
- Frontend: Next.js (apps/webapp)
- CLI: To be added

**Existing Structure:**

- `services/backend/` - Convex backend with auth, presentations, discussions, etc.
- `apps/webapp/` - Next.js web application with various modules

## Migration Phases

### Phase 1: Backend Migration

Migrate the chatroom backend schema and functions to `services/backend/`.

### Phase 2: Frontend Migration

Migrate the web dashboard components to `apps/webapp/`.

### Phase 3: CLI Migration

Add the CLI as a new package in the monorepo.

## Migration Principles

1. **Use target tech stack**: Adapt code to use pnpm, Node.js, and Next.js conventions
2. **Follow existing patterns**: Match the target application's coding style and structure
3. **Preserve functionality**: All features from the source should work in the target
4. **Minimal disruption**: Don't modify existing target features unless necessary
