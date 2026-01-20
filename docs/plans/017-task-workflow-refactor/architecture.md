# Architecture: Task Workflow Refactor

## Changes Overview

This plan introduces an origin-based workflow system where tasks follow different state machines based on their creation source (backlog or chat).

## New Components

### `lib/taskWorkflows.ts`

Central definition of workflow state machines and helper functions.

**Key Exports:**

```typescript
export type TaskOrigin = 'backlog' | 'chat';

export type TaskStatus = 
  | 'pending' | 'queued' | 'in_progress' 
  | 'pending_user_review' | 'completed' | 'closed'
  | 'backlog' | 'cancelled'; // deprecated

export const TASK_WORKFLOWS = {
  backlog: {
    initial: 'backlog',
    transitions: {
      backlog: ['queued'],
      queued: ['pending'],
      pending: ['in_progress'],
      in_progress: ['pending_user_review'],
      pending_user_review: ['completed', 'closed', 'queued'],
    },
    terminal: ['completed', 'closed'],
  },
  chat: {
    initial: 'queued',
    transitions: {
      queued: ['pending'],
      pending: ['in_progress'],
      in_progress: ['completed'],
    },
    terminal: ['completed'],
  },
};

export function getCompletionStatus(origin: TaskOrigin | undefined, currentStatus: TaskStatus): TaskStatus;
export function getNextStatuses(origin: TaskOrigin | undefined, status: TaskStatus): TaskStatus[];
export function isValidTransition(origin: TaskOrigin | undefined, fromStatus: TaskStatus, toStatus: TaskStatus): boolean;
export function canMarkComplete(origin: TaskOrigin | undefined, status: TaskStatus): boolean;
export function canClose(origin: TaskOrigin | undefined, status: TaskStatus): boolean;
export function canSendBackForRework(origin: TaskOrigin | undefined, status: TaskStatus): boolean;
export function canAddToChat(origin: TaskOrigin | undefined, status: TaskStatus): boolean;
```

## Modified Components

### Schema (`schema.ts`)

Added to `chatroom_tasks` table:

```typescript
// New field
origin: v.optional(v.union(v.literal('backlog'), v.literal('chat')))

// New statuses added to status union
v.literal('pending_user_review')
v.literal('closed')
```

### Backend Mutations (`tasks.ts`, `messages.ts`)

| Mutation | Change |
|----------|--------|
| `createTask` | Sets `origin` based on `isBacklog` parameter |
| `completeTask` | Routes backlog-origin to `pending_user_review`, chat-origin to `completed` |
| `cancelTask` | Uses `closed` for backlog-origin, `cancelled` for chat-origin |
| `markBacklogComplete` | Accepts `pending_user_review` status |
| `closeBacklogTask` | Uses `closed` status instead of `cancelled` |
| `handoff` | Uses `getCompletionStatus()` from taskWorkflows |

### Frontend Components

| Component | Change |
|-----------|--------|
| `TaskQueue.tsx` | Added `pending_user_review`, `closed` to types; fixed archived count |
| `TaskDetailModal.tsx` | Added actions for pending review state |
| `TaskQueueModal.tsx` | Added new status badge colors |

## New Contracts

### Task with Origin

```typescript
interface Task {
  _id: Id<'chatroom_tasks'>;
  chatroomId: Id<'chatroom_rooms'>;
  content: string;
  status: TaskStatus;
  origin?: TaskOrigin;           // New field
  createdBy: string;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  queuePosition: number;
  sourceMessageId?: Id<'chatroom_messages'>;
  assignedTo?: string;
  startedAt?: number;
  backlog?: { status: BacklogStatus }; // Deprecated
}
```

## Data Flow Changes

### Before: Handoff to User
```
in_progress → completed (always)
```

### After: Handoff to User
```
backlog-origin: in_progress → pending_user_review
chat-origin:    in_progress → completed
```

### Attached Task Flow (Fixed)

Before:
```
backlog → queued (on message send) → ... processing ...
```

After:
```
backlog → (no change on attach/send) → pending_user_review (on handoff to user)
```

## Migration Strategy

1. **Phase 1**: Schema changes (backward compatible)
   - Add `origin` field as optional
   - Add new statuses to union
   
2. **Phase 2**: Migration script
   - `normalizeAllTaskOrigins` sets origin based on existing data
   
3. **Phase 3**: Code cleanup (after migration)
   - Remove legacy `backlog` field checks
   - Remove deprecated status handling
