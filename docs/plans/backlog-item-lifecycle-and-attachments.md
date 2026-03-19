# Plan: Backlog Item Lifecycle & Attachments

**Status**: In Progress  
**Created**: 2026-03-16  
**Trigger**: User request to fix all backlog-related flows after migration from `chatroom_tasks` to `chatroom_backlog`.

---

## Background

The `chatroom_backlog` table is now the source of truth for backlog items (migrated from `chatroom_tasks origin:'backlog'`). However:

- No lifecycle mutations exist for `chatroom_backlog` items
- The attachment flow is hardwired to `Id<'chatroom_tasks'>` and cannot accept `chatroom_backlog` IDs
- Attached `chatroom_backlog` items are not transitioned to `pending_user_review` when agent hands off
- No detail modal exists for `chatroom_backlog` items
- The "View More" modal in the backlog section reads from `chatroom_tasks` (wrong table)

---

## Phase 1: Backend Lifecycle Mutations for `chatroom_backlog`

**File**: `services/backend/convex/backlog.ts`

Add the following mutations (all operate on `chatroom_backlog`):

### `closeBacklogItem`

- Args: `sessionId`, `itemId: v.id('chatroom_backlog')`
- Validates access via `requireChatroomAccess`
- Only allowed from status `backlog` or `pending_user_review`
- Sets `status: 'closed'`, `updatedAt: now`

### `completeBacklogItem`

- Args: `sessionId`, `itemId: v.id('chatroom_backlog')`
- Only allowed from status `pending_user_review`
- Sets `status: 'closed'`, `completedAt: now`, `updatedAt: now`
- Note: `chatroom_backlog` uses `closed` as terminal state (no `completed` status); set a `completedAt` timestamp to distinguish "completed" from "closed without completing"

### `reopenBacklogItem`

- Args: `sessionId`, `itemId: v.id('chatroom_backlog')`
- Only allowed from status `closed`
- Sets `status: 'backlog'`, `completedAt: undefined`, `updatedAt: now`

### `markBacklogItemForReview`

- Args: `sessionId`, `itemId: v.id('chatroom_backlog')`
- Only allowed from status `backlog`
- Sets `status: 'pending_user_review'`, `updatedAt: now`

### `moveBacklogItemToQueue`

- Args: `sessionId`, `itemId: v.id('chatroom_backlog')`, `customMessage?: string`
- Allowed from status `backlog` or `pending_user_review`
- Creates a `chatroom_messages` record (senderRole: 'user') with the content (or customMessage)
- Creates a `chatroom_tasks` record with `status: 'pending'`, `origin: 'chat'` (a NEW chat task, not the backlog item itself)
- Attaches the backlog item via `attachedBacklogItemIds: [itemId]` on the message
- Does NOT change the backlog item status (it remains in backlog/pending_user_review until agent handles it and hands off)
- Returns `{ success: true, taskId, messageId }`

### `updateBacklogItem`

- Args: `sessionId`, `itemId: v.id('chatroom_backlog')`, `content: string`
- Only allowed from status `backlog`
- Updates `content`, `updatedAt`

**Verification**: `pnpm typecheck` — must pass with no errors.
**Commit**: `feat(backend): add lifecycle mutations for chatroom_backlog items`

---

## Phase 2: Schema — Add `attachedBacklogItemIds`

**Files**:

- `services/backend/convex/schema.ts`
- `services/backend/convex/messages.ts` (send handler + context building)
- `services/backend/src/domain/usecase/task/promote-queued-message.ts`
- `services/backend/convex/backlog.ts` (add `getBacklogItems` batch query)

### Schema changes

Add `attachedBacklogItemIds: v.optional(v.array(v.id('chatroom_backlog')))` to:

- `chatroom_messages` table
- `chatroom_messageQueue` table

### Backend send handler (`messages.ts`)

- Add `attachedBacklogItemIds?: Id<'chatroom_backlog'>[]` to the `sendMessage` function args (alongside existing `attachedTaskIds`)
- Validate each ID: `ctx.db.get('chatroom_backlog', id)` — throw if not found or if status is `closed`
- Store on the message record
- Store on the queue record (if queued path)
- In the pending path: update bidirectional tracking — patch each `chatroom_backlog` item with... (no parentTaskIds field yet on backlog — skip bidirectional for now, add in a later phase if needed)

### Backend `api.messages.send` (the Convex mutation exposed to frontend)

- Add `attachedBacklogItemIds` arg

### `promote-queued-message.ts`

- Carry `attachedBacklogItemIds` from queue record → `chatroom_messages` insert

### Context building (`messages.ts` — `getMessagesWithContext` or equivalent)

- When building agent context for a message, also fetch attached backlog items
- Return them alongside `attachedTasks` in the message response shape

### `getBacklogItems` batch query (`backlog.ts`)

- Add a query `getBacklogItemsByIds`: `args: { itemIds: v.array(v.id('chatroom_backlog')) }` → returns the items (for context display)

**Verification**: `pnpm typecheck` — must pass.
**Commit**: `feat(schema): add attachedBacklogItemIds to messages and queue tables`

---

## Phase 3: Frontend — Attachment Context Modularization

**Files**:

- `apps/webapp/src/modules/chatroom/context/AttachedTasksContext.tsx` → refactor to `AttachmentsContext.tsx`
- `apps/webapp/src/modules/chatroom/components/AttachedTaskChip.tsx` → generalize or add `AttachedBacklogItemChip.tsx`
- `apps/webapp/src/modules/chatroom/components/SendForm.tsx`
- `apps/webapp/src/modules/chatroom/components/TaskDetailModal.tsx` (add to context still works for old tasks)

### Attachment Context

Rename/extend `AttachedTasksContext.tsx` to `AttachmentsContext.tsx` with:

```ts
interface AttachedBacklogItem {
  _id: Id<'chatroom_backlog'>;
  content: string;
}

interface AttachmentsContextValue {
  // Existing task attachments
  attachedTasks: AttachedTask[];
  addTask: (task: AttachedTask) => boolean;
  removeTask: (taskId: Id<'chatroom_tasks'>) => void;
  isTaskAttached: (taskId: Id<'chatroom_tasks'>) => boolean;

  // New backlog item attachments
  attachedBacklogItems: AttachedBacklogItem[];
  addBacklogItem: (item: AttachedBacklogItem) => boolean;
  removeBacklogItem: (itemId: Id<'chatroom_backlog'>) => void;
  isBacklogItemAttached: (itemId: Id<'chatroom_backlog'>) => boolean;

  // Combined
  clearAll: () => void;
  totalCount: number;
  canAddMore: boolean;
}
```

Keep `MAX_ATTACHMENTS = 10` applying to `totalCount`.

### SendForm

- Read `attachedBacklogItems` from context
- Pass `attachedBacklogItemIds: attachedBacklogItems.map(i => i._id)` to `api.messages.send`
- Show `AttachedBacklogItemChip` components alongside task chips (or reuse the same chip with a different icon)

### BacklogItemDetailModal (new) or extend `TaskDetailModal`

- Show content, status badge
- Actions: close, complete (if pending_user_review), reopen (if closed), "Move to Queue" button
- "Attach to Context" button: calls `addBacklogItem({ _id: item._id, content: item.content })`

**Verification**: `pnpm typecheck` — must pass.
**Commit**: `feat(frontend): modularize attachment context to support backlog items`

---

## Phase 4: Frontend — Backlog Item Detail Modal + UI Wiring

**Files**:

- `apps/webapp/src/modules/chatroom/components/BacklogItemDetailModal.tsx` (NEW)
- `apps/webapp/src/modules/chatroom/components/TaskQueue.tsx`
- `apps/webapp/src/modules/chatroom/components/TaskQueueModal.tsx` (fix "View More" for backlog)

### BacklogItemDetailModal

A side-panel modal (consistent with `AttachedTaskDetailModal`). Shows:

- Status badge
- Full markdown content
- Action buttons wired to `api.backlog.*` mutations added in Phase 1

### TaskQueue.tsx

- Replace the `onClick={() => {}}` no-op with a state setter for the selected backlog item
- Mount `<BacklogItemDetailModal>` in the component tree

### TaskQueueModal — fix "View More"

The "View More" button for the backlog section currently opens `TaskQueueModal` which reads from `chatroom_tasks`. Options:

- Create a `BacklogQueueModal` that reads from `api.backlog.listBacklogItems`
- OR extend `TaskQueueModal` to accept an optional `backlogItems` prop

Prefer creating `BacklogQueueModal` (simpler, no coupling).

**Verification**: `pnpm typecheck` — must pass.
**Commit**: `feat(frontend): add BacklogItemDetailModal and fix backlog View More modal`

---

## Phase 5: Handoff Status Transition for `chatroom_backlog` Items

**File**: `services/backend/convex/messages.ts` (Step 5 in handoff handler)

When the agent hands off to user:

1. Existing Step 5 handles `chatroom_tasks origin:'backlog'` items → transition to `pending_user_review` (keep as-is)
2. **New**: Also look for `attachedBacklogItemIds` on `sourceMessage`
3. For each attached backlog item, if status is `backlog`, transition to `pending_user_review`

```ts
// After existing Step 5 for chatroom_tasks:
if (isHandoffToUser) {
  for (const task of inProgressTasks) {
    if (task.sourceMessageId) {
      const sourceMessage = await ctx.db.get('chatroom_messages', task.sourceMessageId);
      if (
        sourceMessage?.attachedBacklogItemIds &&
        sourceMessage.attachedBacklogItemIds.length > 0
      ) {
        const now = Date.now();
        for (const itemId of sourceMessage.attachedBacklogItemIds) {
          const item = await ctx.db.get('chatroom_backlog', itemId);
          if (item && item.status === 'backlog') {
            await ctx.db.patch('chatroom_backlog', itemId, {
              status: 'pending_user_review',
              updatedAt: now,
            });
          }
        }
      }
    }
  }
}
```

**Verification**: `pnpm typecheck` — must pass.
**Commit**: `feat(backend): transition attached chatroom_backlog items to pending_user_review on handoff`

---

## Execution Order

1. Phase 1 → Phase 2 → Phase 3 → Phase 4 → Phase 5
2. Each phase must typecheck cleanly before moving to next
3. No phase should leave the codebase in a broken state
