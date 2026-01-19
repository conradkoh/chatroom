# Plan 015: Backlog Task Lifecycle - Architecture

## Changes Overview

This plan adds a new `backlogStatus` field to the task schema and introduces new mutations for managing backlog lifecycle. The frontend gains an expandable archive section and new action buttons in the task detail modal.

## Schema Changes

### Modified: `chatroom_tasks` Table

```typescript
// services/backend/convex/schema.ts

// Add new nested backlog object for lifecycle tracking
backlog: v.optional(
  v.object({
    status: v.union(
      v.literal('not_started'),
      v.literal('started'),
      v.literal('complete'),
      v.literal('closed')
    ),
  })
)
```

**Migration Strategy**: Existing backlog tasks without `backlog` are treated as if they have `not_started` status. The code handles `undefined` as `not_started` for backward compatibility.

**Extensibility**: Using a nested object allows for future additions (e.g., `backlog.notes`, `backlog.resolution`, `backlog.closedReason`) without schema changes.

## New Components

### Backend Mutations

```typescript
// services/backend/convex/tasks.ts

// Mark a backlog task as complete (user only)
export const markBacklogComplete = mutation({
  args: {
    sessionId: v.string(),
    taskId: v.id('chatroom_tasks'),
  },
  handler: async (ctx, args) => {
    // 1. Validate session and chatroom access
    // 2. Verify task exists and has backlog lifecycle tracking
    // 3. Update backlog.status to 'complete'
    // 4. Update updatedAt timestamp
  },
});

// Close a backlog task (user only)
export const closeBacklogTask = mutation({
  args: {
    sessionId: v.string(),
    taskId: v.id('chatroom_tasks'),
  },
  handler: async (ctx, args) => {
    // Similar to markBacklogComplete but sets backlog.status to 'closed'
  },
});

// Reopen a completed/closed backlog task
export const reopenBacklogTask = mutation({
  args: {
    sessionId: v.string(),
    taskId: v.id('chatroom_tasks'),
  },
  handler: async (ctx, args) => {
    // 1. Validate session and chatroom access
    // 2. Verify task exists and is complete/closed
    // 3. Set backlog.status back to 'started' (since it was previously worked on)
    // 4. Update updatedAt timestamp
  },
});
```

### Backend Query Modification

```typescript
// services/backend/convex/tasks.ts

// Modify listTasks to support backlog status filtering
export const listTasks = query({
  args: {
    // ... existing args
    backlogStatusFilter: v.optional(
      v.union(
        v.literal('active'),    // not_started + started
        v.literal('archived')   // complete + closed
      )
    ),
  },
  handler: async (ctx, args) => {
    // ... existing logic
    
    // Apply backlog status filter
    if (args.backlogStatusFilter === 'active') {
      tasks = tasks.filter(t => 
        !t.backlog || 
        t.backlog.status === 'not_started' || 
        t.backlog.status === 'started'
      );
    } else if (args.backlogStatusFilter === 'archived') {
      tasks = tasks.filter(t => 
        t.backlog?.status === 'complete' || 
        t.backlog?.status === 'closed'
      );
    }
  },
});
```

### Modified: `moveToQueue` Mutation

```typescript
// services/backend/convex/tasks.ts

// Modify existing moveToQueue to update backlog.status
export const moveToQueue = mutation({
  // ... existing args
  handler: async (ctx, args) => {
    // ... existing logic
    
    // NEW: If task was a backlog task, set backlog.status to 'started'
    if (task.status === 'backlog') {
      await ctx.db.patch('chatroom_tasks', args.taskId, {
        status: 'pending',
        backlog: { status: 'started' }, // NEW - nested object
        updatedAt: Date.now(),
        queuePosition,
      });
    }
  },
});
```

## Modified Components

### Frontend: TaskQueue.tsx

- Filter active backlog items (not archived) for the main backlog list
- Add archived section with expand/collapse toggle
- Fetch archived items when section is expanded

### Frontend: TaskQueueModal.tsx

- Add "Archived" tab or section
- Show archived count in section header
- Order archived items by `updatedAt` descending

### Frontend: TaskDetailModal.tsx

Add new action buttons based on task state:

```typescript
// For active backlog tasks
{task.backlog && task.backlog.status !== 'complete' && task.backlog.status !== 'closed' && (
  <>
    <button onClick={handleMarkComplete}>Mark Complete</button>
    <button onClick={handleClose}>Close</button>
  </>
)}

// For archived tasks
{(task.backlog?.status === 'complete' || task.backlog?.status === 'closed') && (
  <button onClick={handleReopen}>Reopen</button>
)}
```

## Data Flow

### Moving Task to Queue

```
User clicks "Move to Queue"
        │
        ▼
moveToQueue mutation
        │
        ├── Set status = 'pending'
        ├── Set backlogStatus = 'started'  ← NEW
        └── Assign queuePosition
        │
        ▼
Task appears in Queue AND Backlog (started)
```

### Marking Complete

```
User clicks "Mark Complete"
        │
        ▼
markBacklogComplete mutation
        │
        ├── Set backlog.status = 'complete'
        └── Update updatedAt
        │
        ▼
Task moves from Active Backlog to Archived
```

### Reopening Task

```
User clicks "Reopen"
        │
        ▼
reopenBacklogTask mutation
        │
        ├── Set backlog.status = 'started'
        └── Update updatedAt
        │
        ▼
Task moves from Archived back to Active Backlog
```

## UI States Summary

| Task Status | backlog.status | Appears In |
|-------------|----------------|------------|
| `backlog` | `not_started` | Active Backlog only |
| `pending/in_progress/queued` | `started` | Queue AND Active Backlog |
| `completed` | `started` | Completed Tasks, Active Backlog |
| `*` | `complete` | Archived Backlog |
| `*` | `closed` | Archived Backlog |
