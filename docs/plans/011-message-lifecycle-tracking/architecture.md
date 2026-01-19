# Plan 011: Architecture - Message Lifecycle Tracking

## Changes Overview

This plan adds lifecycle tracking to the messages table and optimizes context window queries by:
1. Adding `acknowledgedAt` and `completedAt` fields to messages
2. Creating an index for efficient user message lookup
3. Updating mutations to set lifecycle timestamps
4. Updating `getContextWindow` to filter by `acknowledgedAt`

## Modified Components

### Schema (`services/backend/convex/schema.ts`)

**Changes:**
- Add `acknowledgedAt` field to `chatroom_messages` table
- Add `completedAt` field to `chatroom_messages` table
- Add new index `by_chatroom_senderRole_type_createdAt`

### Mutations (`services/backend/convex/messages.ts`, `tasks.ts`)

**Changes:**
- `startTask` / `claimMessage` → Set `acknowledgedAt` on source message
- `handoff` → Set `completedAt` on relevant messages

### Queries (`services/backend/convex/messages.ts`)

**Changes:**
- `getContextWindow` → Filter by `acknowledgedAt` to exclude unacknowledged user messages

## New Contracts

```typescript
// Message lifecycle fields (added to existing chatroom_messages)
interface MessageLifecycle {
  acknowledgedAt?: number;  // When agent started work
  completedAt?: number;     // When agent completed work
}
```

## Modified Contracts

```typescript
// Updated chatroom_messages table
interface ChatroomMessage {
  // ... existing fields ...
  
  // NEW: Lifecycle tracking
  acknowledgedAt?: number;
  completedAt?: number;
}
```

## New Index

```typescript
// Index for efficient origin message lookup
.index('by_chatroom_senderRole_type_createdAt', [
  'chatroomId',
  'senderRole',
  'type', 
  '_creationTime',
])
```

**Index field ordering rationale:**
1. `chatroomId` - Always filtered; scopes to single chatroom
2. `senderRole` - Low cardinality; filter by 'user'
3. `type` - Low cardinality; filter by 'message'
4. `_creationTime` - For ordering (most recent first)

## Data Flow Changes

### Before (Current)
```
getContextWindow:
  1. Fetch 200 recent messages
  2. Fetch ALL tasks in chatroom
  3. Build messageId → taskStatus map
  4. Filter messages by task status
  → O(messages) + O(tasks)
```

### After (New)
```
getContextWindow:
  1. Fetch 200 recent messages
  2. Filter by acknowledgedAt presence
  → O(messages) only, no task scan
```
