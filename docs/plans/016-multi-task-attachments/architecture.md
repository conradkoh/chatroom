# Architecture: Multi-Task Attachments

## Current Architecture

### Components Involved

| Component | File | Purpose |
|-----------|------|---------|
| SendForm | `SendForm.tsx` | Main message input at bottom of chat |
| MoveToChatModal | `MoveToChatModal.tsx` | Modal for adding message to backlog task (to be removed) |
| TaskDetailModal | `TaskDetailModal.tsx` | Shows backlog task details, triggers "Move to Chat" |
| TaskQueue | `TaskQueue.tsx` | Calls `moveToQueue` mutation |

### Backend Support (Already Exists)

```typescript
// schema.ts
attachedTaskIds: v.optional(v.array(v.id('chatroom_tasks')))

// messages.ts - Validates and stores attached tasks
if (args.attachedTaskIds && args.attachedTaskIds.length > 0) {
  for (const taskId of args.attachedTaskIds) {
    const task = await ctx.db.get('chatroom_tasks', taskId);
    if (!task) throw new Error(`Attached task ${taskId} not found`);
  }
}

// messages.ts - Marks all attached tasks as 'started'
if (message.attachedTaskIds && message.attachedTaskIds.length > 0) {
  for (const taskId of message.attachedTaskIds) {
    // Update backlog.status to 'started'
  }
}
```

## Proposed Architecture

### New State Management

Create `AttachedTasksContext` to manage attached tasks state across components.

```typescript
// apps/webapp/src/modules/chatroom/context/AttachedTasksContext.tsx

interface AttachedTask {
  _id: Id<'chatroom_tasks'>;
  content: string;
  // Add more fields as needed
}

interface AttachedTasksContextValue {
  attachedTasks: AttachedTask[];
  addTask: (task: AttachedTask) => boolean; // returns false if limit reached
  removeTask: (taskId: string) => void;
  clearTasks: () => void;
  canAddMore: boolean; // true if under limit
}

const MAX_ATTACHMENTS = 10;
```

### Component Changes

#### TaskDetailModal.tsx
- Remove `isMoveToChatOpen` state
- Remove `MoveToChatModal` import and usage
- Change "Move to Chat" button to call `addTask(task)` and `onClose()`

#### SendForm.tsx
- Add `AttachedTasksRow` component above textarea
- Pass `attachedTaskIds` to `sendMessage` mutation
- Clear attachments after successful send

#### ChatroomDashboard.tsx (or parent)
- Wrap with `AttachedTasksProvider`

### UI Components

#### AttachedTaskChip
```tsx
interface AttachedTaskChipProps {
  task: AttachedTask;
  onRemove: () => void;
}
```

Display: `[📎 Task content truncated... (×)]`

#### AttachedTasksRow
```tsx
interface AttachedTasksRowProps {
  tasks: AttachedTask[];
  onRemove: (taskId: string) => void;
}
```

Shown above SendForm textarea when `tasks.length > 0`

## Data Flow

```
TaskDetailModal              AttachedTasksContext           SendForm
    │                              │                          │
    ├─── "Add to Chat" ───────────►│                          │
    │    addTask(task)             │                          │
    │    onClose()                 │                          │
    │                              ├─── state update ────────►│
    │                              │                          │
    │                              │    [chips rendered]      │
    │                              │                          │
    │                              │◄──── removeTask(id) ─────┤
    │                              │    (user clicks ×)       │
    │                              │                          │
    │                              │    (user types message)  │
    │                              │                          │
    │                              │◄──── clearTasks() ───────┤
    │                              │    (after sendMessage)   │
```

## Files to Modify

| File | Action |
|------|--------|
| `context/AttachedTasksContext.tsx` | Create (new) |
| `components/AttachedTaskChip.tsx` | Create (new) |
| `components/SendForm.tsx` | Modify - add chips row, pass attachedTaskIds |
| `components/TaskDetailModal.tsx` | Modify - replace modal with context call |
| `components/MoveToChatModal.tsx` | Delete |
| `ChatroomDashboard.tsx` | Modify - add context provider |

## Constraints

- Maximum 10 attachments (matches future image support)
- Tasks must be valid (exist in database) when sending
- All attached tasks get `backlog.status = 'started'` when `task-started` runs
