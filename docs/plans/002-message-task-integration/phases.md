# Implementation Phases

## Phase Overview

| Phase | Description | Dependencies |
|-------|-------------|--------------|
| 1 | Schema & Backend Changes | None |
| 2 | CLI Updates | Phase 1 |
| 3 | Frontend Updates | Phase 1 |

## Phase 1: Schema & Backend Changes

### Objective
Add taskId to messages and auto-create tasks when users send messages.

### Changes

1. **Schema update** (`services/backend/convex/schema.ts`)
   - Add `taskId: v.optional(v.id('chatroom_tasks'))` to chatroom_messages
   - Add index `by_taskId` on chatroom_messages

2. **messages.ts - send() mutation**
   - After inserting message, check if senderRole is 'user'
   - Create task with appropriate status (pending/queued)
   - Patch message with taskId

3. **tasks.ts - new query**
   - Add `getPendingTaskForRole` query
   - Returns oldest pending task with its source message
   - Filters by role (entry point for user messages)

4. **tasks.ts - modify startTask**
   - Allow starting task by taskId (not just finding pending)
   - Return the source message content

### Success Criteria
- [ ] User messages create tasks automatically
- [ ] Tasks have correct status (pending if no active, queued if busy)
- [ ] Messages have taskId reference
- [ ] getPendingTaskForRole returns correct task

### Estimated Files
- `services/backend/convex/schema.ts`
- `services/backend/convex/messages.ts`
- `services/backend/convex/tasks.ts`

---

## Phase 2: CLI Updates

### Objective
Update wait-for-message to use task queue instead of message markers.

### Changes

1. **wait-for-message.ts**
   - Remove startup marker logic (getting latest message ID)
   - Remove `afterMessageId` from polling
   - Poll `getPendingTaskForRole` instead of `getLatestForRole`
   - When task found, call `startTask` to claim it
   - Display message from task's source

2. **task-complete.ts**
   - Ensure `completeTask` is called (may already happen)
   - Verify next queued task promotes to pending

3. **api.ts**
   - Add new function references for task queries

### Code to Remove
```typescript
// wait-for-message.ts lines 154-163 - DELETE
const existingMessages = await client.query(api.messages.list, {
  sessionId,
  chatroomId,
  limit: 1,
});
const afterMessageId = existingMessages[existingMessages.length - 1]?._id;
```

### Success Criteria
- [ ] wait-for-message finds pending tasks
- [ ] No messages skipped when starting late
- [ ] Task transitions to in_progress when agent picks up
- [ ] task-complete promotes queued tasks

### Estimated Files
- `packages/cli/src/commands/wait-for-message.ts`
- `packages/cli/src/commands/task-complete.ts`
- `packages/cli/src/api.ts`

---

## Phase 3: Frontend Updates

### Objective
Show task status in the message feed UI.

### Changes

1. **Backend query for messages with task status**
   - Modify or create query to return task status with messages
   - Join messages with tasks table

2. **MessageFeed.tsx**
   - Display status badge for user messages
   - Color coding: 🟢 pending, 🔵 in_progress, 🟡 queued, ✅ completed
   - Real-time updates via Convex subscription

3. **Optional: TaskQueue.tsx**
   - Show message-linked tasks in the task queue
   - Differentiate from manual backlog items

### Success Criteria
- [ ] User messages show task status badge
- [ ] Status updates in real-time
- [ ] Clear visual distinction between statuses

### Estimated Files
- `services/backend/convex/messages.ts` (query updates)
- `apps/webapp/src/modules/chatroom/components/MessageFeed.tsx`
- `apps/webapp/src/modules/chatroom/components/MessageItem.tsx` (if exists)

---

## Migration Considerations

### Existing Data
- Existing messages without taskId will work (field is optional)
- Existing tasks without sourceMessageId continue to function
- No data migration required

### Backward Compatibility
- Old CLI versions may not call new task APIs (graceful degradation)
- UI shows no badge for messages without taskId

### Testing Checklist
- [ ] Send message when no task active → pending task created
- [ ] Send message when task in_progress → queued task created
- [ ] Start wait-for-message late → picks up pending tasks
- [ ] Complete task → queued promotes to pending
- [ ] UI shows correct status for all message types
