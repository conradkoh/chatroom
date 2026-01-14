# Phase 1: Backend Migration

## Overview

Migrate the chatroom backend from `chatroom-cli/convex/` to `chatroom/services/backend/convex/`.

## Source Files

From `chatroom-cli/convex/`:
- `schema.ts` - Database schema (chatrooms, participants, messages)
- `chatrooms.ts` - Chatroom mutations and queries
- `messages.ts` - Message mutations and queries with routing logic
- `participants.ts` - Participant mutations and queries
- `lib/hierarchy.ts` - Role hierarchy configuration

## Tasks

### 1.1 Extend Schema
Add chatroom-related tables to the existing schema in `services/backend/convex/schema.ts`:

**New Tables:**
- `chatrooms` - Chatroom state and team configuration
- `chatroom_participants` - Participant status per chatroom (prefixed to avoid conflicts)
- `chatroom_messages` - Messages with routing metadata

### 1.2 Create Chatroom Module
Create new files in `services/backend/convex/chatroom/`:

**Files to Create:**
- `chatrooms.ts` - Chatroom CRUD operations
- `messages.ts` - Message operations with routing logic
- `participants.ts` - Participant operations
- `hierarchy.ts` - Role hierarchy utilities

### 1.3 Adapt Convex Functions

**Mutations:**
- `chatroom.chatrooms.create` - Create new chatroom with team info
- `chatroom.chatrooms.updateStatus` - Update chatroom status
- `chatroom.chatrooms.interrupt` - Interrupt chatroom and reset participants
- `chatroom.participants.join` - Join chatroom as a role
- `chatroom.participants.updateStatus` - Update participant status
- `chatroom.messages.send` - Send message with type and routing
- `chatroom.messages.claimMessage` - Claim broadcast message

**Queries:**
- `chatroom.chatrooms.get` - Get chatroom by ID
- `chatroom.chatrooms.getTeamReadiness` - Check if team is ready
- `chatroom.participants.list` - List participants
- `chatroom.participants.getByRole` - Get participant by role
- `chatroom.participants.getHighestPriorityWaitingRole` - Get priority routing
- `chatroom.messages.list` - List messages
- `chatroom.messages.getLatestForRole` - Get routed message for role

## Schema Changes

```typescript
// New tables to add to schema.ts

chatroom_chatrooms: defineTable({
  status: v.union(
    v.literal("active"),
    v.literal("interrupted"),
    v.literal("completed")
  ),
  teamId: v.optional(v.string()),
  teamName: v.optional(v.string()),
  teamRoles: v.optional(v.array(v.string())),
  teamEntryPoint: v.optional(v.string()),
}).index("by_status", ["status"]),

chatroom_participants: defineTable({
  chatroomId: v.id("chatroom_chatrooms"),
  role: v.string(),
  status: v.union(
    v.literal("idle"),
    v.literal("active"),
    v.literal("waiting")
  ),
})
  .index("by_chatroom", ["chatroomId"])
  .index("by_chatroom_and_role", ["chatroomId", "role"]),

chatroom_messages: defineTable({
  chatroomId: v.id("chatroom_chatrooms"),
  senderRole: v.string(),
  content: v.string(),
  targetRole: v.optional(v.string()),
  claimedByRole: v.optional(v.string()),
  type: v.union(
    v.literal("message"),
    v.literal("handoff"),
    v.literal("interrupt"),
    v.literal("join")
  ),
}).index("by_chatroom", ["chatroomId"]),
```

## File Structure

After migration:
```
services/backend/convex/
├── chatroom/
│   ├── chatrooms.ts
│   ├── messages.ts
│   ├── participants.ts
│   └── lib/
│       └── hierarchy.ts
├── schema.ts (extended)
└── ... (existing files)
```

## Verification

1. Run `pnpm typecheck` in backend package
2. Verify Convex generates types without errors
3. Test queries and mutations via Convex dashboard
