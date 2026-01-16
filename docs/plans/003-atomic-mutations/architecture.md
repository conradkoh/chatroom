# Architecture: Atomic Mutations

## Problem Analysis

### Current State: Multiple Mutations Per Action

The CLI commands currently make multiple sequential mutation calls. This is problematic because:

1. **Race conditions**: Another client could interleave operations
2. **Partial failures**: If call 2 fails, call 1 already succeeded
3. **Inconsistent state**: System can end up in invalid intermediate states
4. **Duplicated logic**: CLI orchestrates what backend should handle

### Identified Issues

#### 1. `task-complete` command (3 mutations)

```typescript
// Current: 3 separate calls
await client.mutation(api.tasks.completeTask, {...});      // 1. Complete task
await client.mutation(api.messages.send, {...});            // 2. Send handoff message
await client.mutation(api.participants.updateStatus, {...});// 3. Update participant
```

#### 2. `wait-for-message` command (2-3 mutations when task received)

```typescript
// Current: 2-3 separate calls when claiming a task
await client.mutation(api.tasks.startTask, {...});          // 1. Start task
await client.mutation(api.messages.claimMessage, {...});    // 2. Claim message
await client.mutation(api.participants.updateStatus, {...});// 3. Update participant
```

## Solution Design

### New Atomic Backend Mutations

Create consolidated mutations that handle all related changes atomically:

#### 1. `messages.sendHandoff` - Consolidated handoff operation

Combines:
- Complete current in_progress task(s)
- Send the handoff message
- Create task for target agent (if not user)
- Update sender's participant status to waiting

```typescript
interface SendHandoffArgs {
  sessionId: string;
  chatroomId: Id<'chatroom_rooms'>;
  senderRole: string;
  content: string;
  targetRole: string;
}

interface SendHandoffResult {
  messageId: Id<'chatroom_messages'>;
  completedTaskIds: Id<'chatroom_tasks'>[];
  newTaskId?: Id<'chatroom_tasks'>;  // For handoffs to agents
  promotedTaskId?: Id<'chatroom_tasks'>;  // If queued task was promoted
}
```

#### 2. `tasks.claimTask` - Consolidated task claiming

Combines:
- Start the task (pending → in_progress)
- Claim the associated message
- Update participant status to active

```typescript
interface ClaimTaskArgs {
  sessionId: string;
  chatroomId: Id<'chatroom_rooms'>;
  taskId: Id<'chatroom_tasks'>;
  role: string;
}

interface ClaimTaskResult {
  success: boolean;
  task: Task;
  message?: Message;
}
```

## Modified Components

### Backend Changes

| File | Change |
|------|--------|
| `convex/messages.ts` | Add `sendHandoff` mutation |
| `convex/tasks.ts` | Add `claimTask` mutation |

### CLI Changes

| File | Change |
|------|--------|
| `commands/task-complete.ts` | Call single `sendHandoff` mutation |
| `commands/wait-for-message.ts` | Call single `claimTask` mutation |
| `api.ts` | Add new mutation types |

## Data Flow Changes

### Before (task-complete)
```
CLI                            Backend
 │                               │
 ├── completeTask ──────────────►│ (mutation 1)
 │                               │
 ├── send ──────────────────────►│ (mutation 2)
 │                               │
 ├── updateStatus ──────────────►│ (mutation 3)
 │                               │
```

### After (task-complete)
```
CLI                            Backend
 │                               │
 ├── sendHandoff ──────────────►│ (single atomic mutation)
 │                               │  ├─ complete task(s)
 │                               │  ├─ send message
 │                               │  ├─ create new task
 │                               │  └─ update participant
```
