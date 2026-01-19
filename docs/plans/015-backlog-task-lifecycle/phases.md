# Plan 015: Backlog Task Lifecycle - Phases

## Phase 1: Schema & Backend Mutations ✅ COMPLETE

**Goal**: Add `backlog.status` field and implement backend mutations for lifecycle management.

### Tasks

1. ✅ Add `backlog` object with `status` field to `chatroom_tasks` schema
2. ✅ Modify `moveToQueue` mutation to set `backlog.status = 'started'`
3. ✅ Add `markBacklogComplete` mutation
4. ✅ Add `closeBacklogTask` mutation
5. ✅ Add `reopenBacklogTask` mutation
6. ✅ Modify `listTasks` query to support `backlogStatusFilter` (active/archived)

### Success Criteria

- [x] Schema includes new `backlog.status` field
- [x] Moving backlog task to queue sets `backlog.status` to `started`
- [x] Can mark backlog task complete via mutation
- [x] Can close backlog task via mutation
- [x] Can reopen archived task via mutation
- [x] `listTasks` can filter by active vs archived backlog status

### Dependencies

None - this is the foundation phase.

---

## Phase 2: Frontend Integration ✅ COMPLETE

**Goal**: Update UI to display active/archived backlog items and provide action buttons.

### Tasks

1. ✅ Update `TaskQueue.tsx` to filter active backlog items (not archived)
2. ✅ Add expandable "Archived" section to backlog list
3. ✅ Update `TaskDetailModal.tsx` to show "Mark Complete" and "Close" buttons for active items
4. ✅ Update `TaskDetailModal.tsx` to show "Reopen" button for archived items
5. ✅ Add mutations hooks for new backend functions
6. ✅ Update `TaskQueueModal.tsx` Task interface for new fields

### Success Criteria

- [x] Main backlog list shows only active items (not_started, started)
- [x] Archived section is expandable/collapsible
- [x] Archived items display in order of `updatedAt` descending
- [x] "Mark Complete" button works for active backlog items
- [x] "Close" button works for active backlog items
- [x] "Reopen" button works for archived items
- [x] Visual indicators distinguish between `not_started` and `started` states

### Dependencies

- Phase 1 (backend mutations must exist)

---

## Phase 3: Polish & Edge Cases ✅ COMPLETE

**Goal**: Handle edge cases and improve UX.

### Tasks

1. ✅ Add visual badge/indicator for backlog status in list view (started badge)
2. ✅ Handle edge case: task in queue that was never a backlog item (no `backlog`)
3. ✅ Ensure proper error handling for all mutations
4. ✅ Add loading states during mutation execution
5. ✅ Test backward compatibility with existing tasks

### Success Criteria

- [x] Backlog status badge visible in list view ("Started" badge for items moved to queue)
- [x] Non-backlog tasks (created directly in queue) work correctly (no `backlog` field)
- [x] Error states display appropriately
- [x] Loading indicators during operations
- [x] Existing tasks without `backlog` treated as active

### Dependencies

- Phase 2 (UI must be integrated)

---

## Phase Summary

| Phase | Description | Estimated Complexity |
|-------|-------------|---------------------|
| 1 | Schema & Backend Mutations | Medium |
| 2 | Frontend Integration | Medium |
| 3 | Polish & Edge Cases | Low |

## Notes

- The `backlog.status` is independent of the task `status`. A task can be `in_progress` (queue status) while having `started` (backlog.status).
- Only tasks that originated as backlog items will have a `backlog` object. Tasks created directly in the queue will not have this field.
- The "Archived" section uses simple expansion rather than pagination for MVP simplicity.
- The nested object structure (`backlog: { status }`) allows for future extensibility (e.g., adding `backlog.notes`, `backlog.resolution`).
