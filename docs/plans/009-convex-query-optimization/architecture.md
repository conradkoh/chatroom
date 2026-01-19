# Plan 009: Convex Query Optimization - Architecture

## Changes Overview

This plan introduces two main architectural changes:

1. **Atomic Queue Position Counter** - Add a `nextQueuePosition` field to chatrooms for atomic position assignment
2. **Enhanced Auth Helper** - Make `requireChatroomAccess` return the chatroom object to eliminate duplicate fetches

## Schema Changes

### Modified Tables

#### `chatroom_rooms` (Modified)

Add a new field for atomic queue position tracking:

```typescript
chatroom_rooms: defineTable({
  // ... existing fields ...
  
  // NEW: Atomic counter for task queue positions
  // Incremented atomically when creating tasks to prevent race conditions
  nextQueuePosition: v.optional(v.number()),
})
```

## Modified Components

### 1. `lib/cliSessionAuth.ts`

**Change:** Modify `requireChatroomAccess` to return the chatroom object.

**Before:**
```typescript
export async function requireChatroomAccess(
  ctx: QueryCtx | MutationCtx,
  sessionId: string,
  chatroomId: Id<'chatroom_rooms'>
): Promise<void>
```

**After:**
```typescript
export async function requireChatroomAccess(
  ctx: QueryCtx | MutationCtx,
  sessionId: string,
  chatroomId: Id<'chatroom_rooms'>
): Promise<Doc<'chatroom_rooms'>>
```

### 2. `messages.ts`

**Change:** Use returned chatroom from auth helper; use atomic counter for queue position.

**Before:**
```typescript
await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);
const chatroom = await ctx.db.get('chatroom_rooms', args.chatroomId);  // Duplicate!
const allTasks = await ctx.db.query('chatroom_tasks')...collect();
const queuePosition = allTasks.reduce(...) + 1;  // Race condition!
```

**After:**
```typescript
const chatroom = await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);
const queuePosition = (chatroom.nextQueuePosition || 0) + 1;
await ctx.db.patch('chatroom_rooms', args.chatroomId, { nextQueuePosition: queuePosition });
```

### 3. `tasks.ts`

**Change:** Same pattern - use returned chatroom and atomic counter.

### 4. `participants.ts`

**Change:** Use returned chatroom from auth helper.

## New Contracts

### Helper Return Types

```typescript
// Chatroom returned from requireChatroomAccess
interface AuthenticatedChatroom {
  _id: Id<'chatroom_rooms'>;
  ownerId: string;
  teamName?: string;
  teamRoles?: string[];
  teamEntryPoint?: string;
  lastActivityAt?: number;
  completedAt?: number;
  nextQueuePosition?: number;  // NEW
}
```

## Data Flow Changes

### Task Creation Flow (Before)

```
1. requireChatroomAccess() → validates, returns void
2. ctx.db.get('chatroom_rooms') → fetches chatroom (DUPLICATE)
3. ctx.db.query('chatroom_tasks').collect() → gets ALL tasks
4. Calculate max position from tasks
5. Insert task with calculated position
```

### Task Creation Flow (After)

```
1. requireChatroomAccess() → validates and returns chatroom
2. Read nextQueuePosition from chatroom
3. Patch chatroom with incremented counter
4. Insert task with atomic position
```

## Migration Notes

- `nextQueuePosition` is optional, defaulting to 0 for existing chatrooms
- First task creation will initialize the counter based on existing max position (one-time migration within the function)
- No data migration script required
