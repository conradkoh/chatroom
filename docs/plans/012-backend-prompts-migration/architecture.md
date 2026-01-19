# Plan 012: Architecture - Backend Prompts Migration

## Current State

```
┌─────────────────────────────────────────────────────────────────┐
│ WEBAPP                                                          │
│ apps/webapp/src/modules/chatroom/prompts/init/                  │
│   - base.ts          (header, workflow, handoff)                │
│   - wait-for-task.ts (wait instructions)                        │
│   - task-started.ts  (classification instructions)              │
│   - roles.ts         (role-specific templates)                  │
└─────────────────────────────────────────────────────────────────┘
         │
         │ Compiled into frontend, served to user's browser
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│ BACKEND (Convex)                                                │
│ services/backend/convex/prompts/                                │
│   - generator.ts     (role guidance, context)                   │
│   - templates.ts     (role templates)                           │
└─────────────────────────────────────────────────────────────────┘
         │
         │ Via getRolePrompt API
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│ CLI                                                             │
│ packages/cli/src/commands/wait-for-task.ts                      │
│   - Calls getRolePrompt                                         │
│   - Displays prompts to agent                                   │
└─────────────────────────────────────────────────────────────────┘
```

## Target State

```
┌─────────────────────────────────────────────────────────────────┐
│ BACKEND (Convex)                                                │
│ services/backend/convex/prompts/                                │
│   - generator.ts     (ALL prompts)                              │
│   - templates.ts     (role templates)                           │
│   - init/            (NEW: migrated init prompts)               │
│       - base.ts                                                 │
│       - wait-for-task.ts                                        │
│       - task-started.ts                                         │
│       - roles.ts                                                │
└─────────────────────────────────────────────────────────────────┘
         │
         │ Via getInitPrompt + getRolePrompt API
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│ CLI                                                             │
│ packages/cli/src/commands/wait-for-task.ts                      │
│   - Calls getInitPrompt (NEW) for first join                    │
│   - Calls getRolePrompt for task-specific guidance              │
└─────────────────────────────────────────────────────────────────┘
```

## New API

### `getInitPrompt` Query

```typescript
export const getInitPrompt = query({
  args: {
    sessionId: v.string(),
    chatroomId: v.id('chatroom_rooms'),
    role: v.string(),
  },
  handler: async (ctx, args) => {
    // Validate session and access
    const { chatroom } = await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);
    
    // Generate full initialization prompt
    const prompt = generateInitPrompt({
      chatroomId: args.chatroomId,
      role: args.role,
      teamName: chatroom.teamName,
      teamRoles: chatroom.teamRoles,
    });
    
    return { prompt };
  },
});
```

## Migration Strategy

**Phase 1: Backend API**
- Create `getInitPrompt` query in backend
- Migrate prompt generators from webapp to backend
- Keep webapp prompts as fallback

**Phase 2: CLI Integration**
- CLI calls `getInitPrompt` on first join
- Falls back to local prompts if backend unavailable

**Phase 3: Webapp Cleanup**
- Remove prompt generators from webapp
- Frontend only displays, doesn't generate

## Files to Migrate

| Source (Webapp) | Target (Backend) |
|-----------------|------------------|
| `apps/webapp/.../prompts/init/base.ts` | `services/backend/convex/prompts/init/base.ts` |
| `apps/webapp/.../prompts/init/wait-for-task.ts` | `services/backend/convex/prompts/init/wait-for-task.ts` |
| `apps/webapp/.../prompts/init/task-started.ts` | `services/backend/convex/prompts/init/task-started.ts` |
| `apps/webapp/.../prompts/init/roles.ts` | `services/backend/convex/prompts/init/roles.ts` |
| `apps/webapp/.../prompts/generator.ts` | (merge into existing generator) |
