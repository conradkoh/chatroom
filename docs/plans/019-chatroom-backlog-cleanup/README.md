# 019 — chatroom_backlog Cleanup Plan

> **Status**: Pending — run after `migrateBacklogItemsToBacklogTable` has been confirmed successful in production.

This document consolidates everything that must be removed or updated when cleaning up the old `chatroom_tasks`-based backlog code, now that backlog items live in the dedicated `chatroom_backlog` table.

---

## Context

Backlog items previously lived in `chatroom_tasks` with `origin === 'backlog'`. Two migrations move them:

1. `migrateBacklogAcknowledgedToBacklog` — fixes `status: 'backlog_acknowledged'` → `'backlog'`
2. `migrateBacklogItemsToBacklogTable` — copies all `origin: 'backlog'` rows from `chatroom_tasks` into `chatroom_backlog`, then deletes them

Both run automatically via GitHub Actions on every prod deploy (`pnpm run migrate`).

Once confirmed successful in production, this cleanup PR can proceed.

---

## Checklist

### 1. Schema (`services/backend/convex/schema.ts`)

- [ ] **Remove** `v.literal('backlog_acknowledged')` from `chatroom_tasks.status` union (and its `DEPRECATED` comment)
- [ ] **Remove** `v.literal('backlog')` from `chatroom_tasks.status` union — no longer a valid task status
- [ ] **Remove** `v.literal('pending_user_review')` from `chatroom_tasks.status` union — backlog-only, now on `chatroom_backlog`
- [ ] **Remove** `v.literal('closed')` from `chatroom_tasks.status` union — backlog-only, now on `chatroom_backlog`
- [ ] **Remove** `origin` field from `chatroom_tasks` schema (the `v.optional(v.union(...))` with `backlog` and `chat`)
- [ ] **Remove** `complexity` field from `chatroom_tasks` schema (backlog prioritization, now on `chatroom_backlog`)
- [ ] **Remove** `value` field from `chatroom_tasks` schema (backlog prioritization, now on `chatroom_backlog`)
- [ ] **Remove** `priority` field from `chatroom_tasks` schema (backlog prioritization, now on `chatroom_backlog`)
- [ ] **Remove** `parentTaskIds` field from `chatroom_tasks` schema (backlog-only bidirectional link)
- [ ] **Remove** `attachedTaskIds` field from `chatroom_tasks` schema (after reference migration — see Phase 3 below)
- [ ] **Remove** `attachedTaskIds` from `chatroom_messages` schema (after reference migration)
- [ ] **Remove** `attachedTaskIds` from `chatroom_messageQueue` schema (after reference migration)
- [ ] **Remove** `legacyTaskId` from `chatroom_backlog` schema (after reference migration confirms no remaining references)
- [ ] **Remove** `.index('by_legacy_task_id', ...)` from `chatroom_backlog` (after above)

### 2. Migration functions (`services/backend/convex/migration.ts`)

- [ ] **Remove** `migrateBacklogAcknowledgedToBacklog` export (move to "Previously executed" comment)
- [ ] **Remove** `migrateBacklogItemsToBacklogTable` export (move to "Previously executed" comment)
- [ ] **Update** "Previously executed" comment at top of file to include both migrations

### 3. Migration runner (`scripts/migrate.ts`)

- [ ] **Remove** `migration:migrateBacklogAcknowledgedToBacklog` entry from `MIGRATIONS` array
- [ ] **Remove** `migration:migrateBacklogItemsToBacklogTable` entry from `MIGRATIONS` array

### 4. TypeScript types (`services/backend/convex/lib/taskStateMachine.ts`)

- [ ] **Remove** `| 'backlog_acknowledged'` from `TaskStatus` union (and its `DEPRECATED` comment)
- [ ] **Remove** `| 'backlog'` from `TaskStatus` union (backlog items no longer use task status machine)
- [ ] **Remove** `| 'pending_user_review'` from `TaskStatus` union (backlog-only)
- [ ] **Remove** `| 'closed'` from `TaskStatus` union (backlog-only) — or keep if used by non-backlog flows
- [ ] **Remove** all FSM transition rules that reference `from: 'backlog'`
- [ ] **Remove** all `validate: (task) => task.origin === 'backlog'` guards
- [ ] **Remove** `Task` type references to removed fields (`origin`, `complexity`, `value`, `priority`, `parentTaskIds`)

### 5. Task workflows (`services/backend/convex/lib/taskWorkflows.ts`)

- [ ] **Remove** `'backlog'` from `TaskOrigin` type and `TASK_ORIGINS` constant
- [ ] **Remove** the `BACKLOG_WORKFLOW` definition (or rename and relocate to backlog-specific module)
- [ ] **Remove** `getTaskSection()` handling for `status === 'backlog'`
- [ ] **Update** `isBacklogStatusVisible()` — replace with `chatroom_backlog`-based logic

### 6. Task mutations (`services/backend/convex/tasks.ts`)

- [ ] **Remove** `isBacklog` parameter from `createTask` (and the `origin` / initial `status` branching)
- [ ] **Remove** `origin === 'backlog'` checks in `task-complete` (the `pending_user_review` vs `completed` branch)
- [ ] **Remove** `moveTaskToQueue` mutation — backlog items now live in `chatroom_backlog`; promotion should create a fresh `chatroom_tasks` row from a `chatroom_backlog` row
- [ ] **Remove** `completeBacklogTask` mutation — replace with `chatroom_backlog`-specific mutation
- [ ] **Remove** `transitionBacklogToPendingUserReview` mutation — replace with `chatroom_backlog`-specific mutation
- [ ] **Update** `updateTask` to remove `backlog` from the allowed-status edit list

### 7. Message mutations (`services/backend/convex/messages.ts`)

- [ ] **Remove** `attachedTaskIds` argument from `sendMessage` / `sendQueuedMessage` (after reference migration replaces with `attachedBacklogIds`)
- [ ] **Remove** `parentTaskIds` update logic in `sendMessage` (the loop that patches `chatroom_tasks` `parentTaskIds`)
- [ ] **Remove** `origin === 'backlog'` check in handoff message processing (`task-complete` transition logic)
- [ ] **Remove** `backlogStatus` from the handoff message context payload (line ~1944)

### 8. Frontend (`apps/webapp/src/`)

- [ ] **Update** `TaskDetailModal.tsx` — remove `isBacklogOrigin`/`isActiveBacklog` checks against `task.origin === 'backlog'`; update to use `chatroom_backlog` data
- [ ] **Update** `TaskQueue.tsx` — remove `isBacklog: true` flag in task creation; update backlog create/list to use `chatroom_backlog` queries/mutations
- [ ] **Update** `SendForm.tsx` — replace `attachedTaskIds` with `attachedBacklogIds` (after reference migration)

---

## Phase 3: Reference Migration (prerequisite for some cleanup items above)

Before removing `attachedTaskIds` from messages and `parentTaskIds`/`attachedTaskIds` from tasks, a follow-up migration is needed:

**`migrateBacklogTaskReferences`** (to add in a future PR):
- Scan `chatroom_messages` for `attachedTaskIds` entries that pointed to old backlog task IDs
- Use `legacyTaskId` index on `chatroom_backlog` to find the new `chatroom_backlog` ID
- Write to a new `attachedBacklogIds: v.optional(v.array(v.id('chatroom_backlog')))` field
- Clear `attachedTaskIds` entries that were remapped
- Same for `chatroom_messageQueue`
- Same for `parentTaskIds`/`attachedTaskIds` in `chatroom_tasks`

---

## Order of Operations for Cleanup PR

1. Run Phase 3 migration (reference remapping) in production and confirm
2. Remove deprecated fields from schema (step 1 above)
3. Update TypeScript types (steps 4–5)
4. Update backend mutations (steps 6–7)
5. Update frontend (step 8)
6. Remove migration functions and runner entries (steps 2–3)
7. Run `pnpm typecheck` and `pnpm test` — must pass cleanly
8. Deploy and confirm no schema validation errors

---

## Files Touched in Cleanup PR

| File | Change |
|------|--------|
| `services/backend/convex/schema.ts` | Remove deprecated fields/statuses from `chatroom_tasks`, remove `legacyTaskId` from `chatroom_backlog` |
| `services/backend/convex/migration.ts` | Remove completed migration exports |
| `scripts/migrate.ts` | Remove completed migration entries |
| `services/backend/convex/lib/taskStateMachine.ts` | Remove backlog-only statuses and transitions |
| `services/backend/convex/lib/taskWorkflows.ts` | Remove backlog origin handling |
| `services/backend/convex/tasks.ts` | Remove backlog-specific mutations and parameters |
| `services/backend/convex/messages.ts` | Remove `attachedTaskIds` / `parentTaskIds` handling |
| `apps/webapp/src/modules/chatroom/components/TaskDetailModal.tsx` | Update to use `chatroom_backlog` |
| `apps/webapp/src/modules/chatroom/components/TaskQueue.tsx` | Update to use `chatroom_backlog` |
| `apps/webapp/src/modules/chatroom/components/SendForm.tsx` | Replace `attachedTaskIds` with `attachedBacklogIds` |
