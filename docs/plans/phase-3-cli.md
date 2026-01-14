# Phase 3: CLI Migration

## Overview

Migrate the chatroom CLI from `chatroom-cli/src/cli/` to a new package in the monorepo.

## Source Files

From `chatroom-cli/src/cli/`:
- `index.ts` - CLI entry point with Commander.js
- `commands/`:
  - `create.ts` - Create chatroom
  - `resume.ts` - Resume chatroom
  - `list.ts` - List chatrooms
  - `complete.ts` - Complete chatroom
  - `init.ts` - Initialize config
  - `start.ts` - Start web server
  - `send.ts` - Send message
  - `wait-for-message.ts` - Wait for messages
  - `task-complete.ts` - Task completion and handoff
  - `monitor.ts` - Chatroom monitoring

From `chatroom-cli/src/config/`:
- `schema.ts` - Config schema definition
- `loader.ts` - Config file loading
- `defaults.ts` - Default values

From `chatroom-cli/src/infrastructure/`:
- `convex/client.ts` - Convex HTTP client
- `convex/types.ts` - Type conversions
- `history/storage.ts` - Local history storage

From `chatroom-cli/src/domain/`:
- `entities/types.ts` - Domain types
- `entities/team.ts` - Team definitions
- `entities/role-hierarchy.ts` - Role hierarchy
- `prompts/` - All prompt generation code

## Tasks

### 3.1 Create CLI Package
Create new package at `packages/cli/`:

```
packages/cli/
├── package.json
├── tsconfig.json
├── project.json (Nx config)
└── src/
    └── index.ts
```

**Package.json:**
```json
{
  "name": "@workspace/cli",
  "version": "1.0.0",
  "type": "module",
  "bin": {
    "chatroom": "./dist/index.js"
  },
  "scripts": {
    "build": "tsc",
    "dev": "tsx src/index.ts",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "commander": "^14.0.0",
    "convex": "^1.31.0",
    "node-notifier": "^10.0.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "tsx": "^4.0.0",
    "typescript": "^5.0.0"
  }
}
```

### 3.2 Migrate Commands
Create command files in `packages/cli/src/commands/`:

**Commands to Migrate:**
- `create.ts` - Create chatroom
- `resume.ts` - Resume chatroom
- `list.ts` - List chatrooms
- `complete.ts` - Complete chatroom
- `init.ts` - Initialize config
- `start.ts` - Start web server (adapted for Next.js)
- `send.ts` - Send message
- `wait-for-message.ts` - Wait for messages
- `task-complete.ts` - Task completion
- `monitor.ts` - Monitoring utilities

### 3.3 Migrate Infrastructure
Create infrastructure in `packages/cli/src/infrastructure/`:

**Files:**
- `convex/client.ts` - Convex HTTP client
- `convex/types.ts` - Type utilities
- `history/storage.ts` - Local history

### 3.4 Migrate Config
Create config handling in `packages/cli/src/config/`:

**Files:**
- `schema.ts` - Config schema
- `loader.ts` - Config loading
- `defaults.ts` - Default values

### 3.5 Migrate Domain Logic
Create domain logic in `packages/cli/src/domain/`:

**Files:**
- `entities/types.ts` - Domain types
- `entities/team.ts` - Team definitions
- `entities/role-hierarchy.ts` - Role hierarchy
- `prompts/generator.ts` - Prompt generation
- `prompts/templates.ts` - Role templates
- `prompts/init/` - Prompt sections
- `prompts/handoff/` - Handoff instructions
- `prompts/system-reminders/` - System reminders

### 3.6 Adapt for Node.js/pnpm
Convert Bun-specific code to Node.js:

**Changes Required:**
- Replace `Bun.serve()` with Node.js HTTP server or reference Next.js app
- Replace `Bun.file()` with `fs` operations
- Use `tsx` for development instead of Bun
- Update imports for ESM compatibility

### 3.7 Connect to Backend
Update CLI to use the migrated backend API:

**Changes:**
- Import from `@workspace/backend` for types
- Point to correct Convex deployment
- Update API paths (e.g., `api.chatroom.chatrooms.create`)

## File Structure

After migration:
```
packages/cli/
├── package.json
├── tsconfig.json
├── project.json
└── src/
    ├── index.ts (CLI entry)
    ├── commands/
    │   ├── create.ts
    │   ├── resume.ts
    │   ├── list.ts
    │   ├── complete.ts
    │   ├── init.ts
    │   ├── start.ts
    │   ├── send.ts
    │   ├── wait-for-message.ts
    │   ├── task-complete.ts
    │   └── monitor.ts
    ├── config/
    │   ├── schema.ts
    │   ├── loader.ts
    │   └── defaults.ts
    ├── infrastructure/
    │   ├── convex/
    │   │   ├── client.ts
    │   │   └── types.ts
    │   └── history/
    │       └── storage.ts
    └── domain/
        ├── entities/
        │   ├── types.ts
        │   ├── team.ts
        │   └── role-hierarchy.ts
        └── prompts/
            ├── generator.ts
            ├── templates.ts
            ├── init/
            │   ├── index.ts
            │   ├── base.ts
            │   ├── roles.ts
            │   └── wait-for-message.ts
            ├── handoff/
            │   ├── index.ts
            │   └── instructions.ts
            └── system-reminders/
                ├── index.ts
                └── wait-reminder.ts
```

## Verification

1. Run `pnpm install` from workspace root
2. Run `pnpm --filter @workspace/cli build`
3. Run `pnpm --filter @workspace/cli typecheck`
4. Test CLI commands:
   - `chatroom init`
   - `chatroom create`
   - `chatroom list`
   - `chatroom send <id> --message="test"`
   - `chatroom wait-for-message <id> --role=builder`
   - `chatroom task-complete <id> --role=builder --message="done" --next-role=user`

## Integration Notes

- CLI should link to `@workspace/backend` for shared types
- `chatroom start` may need to spawn Next.js dev server instead of custom Bun server
- Consider making CLI a global install option via npm
