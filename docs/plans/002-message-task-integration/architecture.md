# Architecture: Message-Task Integration

## Changes Overview

This plan modifies the message creation flow to automatically generate tasks and updates the CLI polling mechanism to use the task queue instead of message timestamps.

## Schema Changes

### Modified: `chatroom_messages` Table

Add a foreign key reference to link messages to their tasks:

```typescript
// Add to chatroom_messages schema
chatroom_messages: defineTable({
  // ... existing fields ...
  
  // NEW: Link to associated task (for user messages)
  taskId: v.optional(v.id('chatroom_tasks')),
})
  .index('by_chatroom', ['chatroomId'])
  .index('by_taskId', ['taskId']),  // NEW index for lookups
```

## Modified Components

### Backend: `messages.ts`

**send() mutation changes:**
1. After inserting message, check if sender is "user"
2. If user message, call task creation logic:
   - Check if any task is pending/in_progress
   - Create task with status "pending" or "queued"
   - Update message with taskId reference
3. Return taskId in response

```typescript
// Pseudocode for send() changes
if (senderRole === 'user' && type === 'message') {
  const hasActiveTask = await checkActiveTask(chatroomId);
  const status = hasActiveTask ? 'queued' : 'pending';
  
  const taskId = await createTaskForMessage({
    chatroomId,
    content: content,
    status,
    sourceMessageId: messageId,
  });
  
  await ctx.db.patch('chatroom_messages', messageId, { taskId });
}
```

### Backend: `tasks.ts`

**Add: getPendingTaskForRole() query**

New query to find the oldest pending task for a role:

```typescript
interface GetPendingTaskForRoleResult {
  task: Task;
  message: Message | null;  // The source message if linked
}
```

### CLI: `wait-for-message.ts`

**Remove:**
- Startup marker logic (lines 154-163)
- afterMessageId parameter in polling

**Modify polling to:**
1. Query for oldest pending task assigned to this role (or entry point)
2. If found, transition task to in_progress
3. Return the associated message for display

**New flow:**
```typescript
// Poll for pending task instead of new message
const pendingTask = await client.query(api.tasks.getPendingTaskForRole, {
  sessionId,
  chatroomId,
  role,
});

if (pendingTask) {
  // Start the task (transition to in_progress)
  await client.mutation(api.tasks.startTask, { ... });
  
  // Display the message
  displayMessage(pendingTask.message);
}
```

### CLI: `task-complete.ts`

**Add:**
- Call `tasks.completeTask` in addition to message handoff
- This promotes next queued task to pending

### Frontend: `MessageFeed.tsx`

**Add:**
- Query for task status when displaying user messages
- Show status badge next to user messages
- Badge updates in real-time via Convex subscription

## New Contracts

```typescript
// Query to get pending task for a role
interface GetPendingTaskArgs {
  sessionId: string;
  chatroomId: Id<'chatroom_rooms'>;
  role: string;
}

interface PendingTaskResult {
  task: {
    _id: Id<'chatroom_tasks'>;
    content: string;
    status: 'pending';
    sourceMessageId?: Id<'chatroom_messages'>;
  };
  message: Message | null;
}

// Extended message with task info
interface MessageWithTask extends Message {
  taskId?: Id<'chatroom_tasks'>;
  taskStatus?: 'pending' | 'in_progress' | 'queued' | 'completed' | 'cancelled';
}
```

## Data Flow Changes

### Before (Current)
```
User sends message → Message stored → wait-for-message polls with afterMessageId
                                          ↓
                                    Finds messages after marker
                                          ↓
                                    Returns first unclaimed message
```

### After (New)
```
User sends message → Message stored → Task created automatically
                          ↓                    ↓
                     Message has taskId   Status: pending/queued
                                                ↓
                           wait-for-message queries pending tasks
                                                ↓
                                          Starts oldest pending task
                                                ↓
                                          Returns message + task
```

## Task Status State Machine

```
                                    ┌─────────────┐
                                    │   backlog   │ (manually created)
                                    └─────────────┘
                                           │
                                    moveToQueue()
                                           ↓
┌─────────────┐    task-started    ┌─────────────┐
│   pending   │ ────────────────→ │ in_progress │
└─────────────┘                    └─────────────┘
      ↑                                   │
      │                            task-complete
      │                                   ↓
┌─────────────┐   auto-promote     ┌─────────────┐
│   queued    │ ←───────────────── │  completed  │
└─────────────┘                    └─────────────┘
```

**Key transitions:**
1. User message → pending (if no active task) or queued (if task active)
2. wait-for-message picks up pending → in_progress
3. task-complete marks completed → promotes oldest queued to pending
4. backlog → queued via moveToQueue()
