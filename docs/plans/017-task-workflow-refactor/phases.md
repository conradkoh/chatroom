# Phases: Task Workflow Refactor

## Phase Breakdown

### Phase 1: Schema and Workflow Helper ✅
**Status: Complete**

- Add `origin` field to schema (optional for backward compat)
- Add `pending_user_review` and `closed` to status union
- Create `lib/taskWorkflows.ts` with workflow definitions
- Add helper functions for status transitions

**Commits:**
- `1aa8a47` feat: add task origin field and workflow helper

### Phase 2: Migration Script ✅
**Status: Complete**

- Create `normalizeAllTaskOrigins` internal mutation
- Create `migrateTaskOrigins` action for large datasets
- Logic: tasks with `backlog` field → `origin: 'backlog'`, others → `origin: 'chat'`

**Commits:**
- Included in initial schema changes

### Phase 3: Backend Mutations ✅
**Status: Complete**

- Update `completeTask` to route by origin
- Update `cancelTask` to use `closed` for backlog
- Update `markBacklogComplete` to accept `pending_user_review`
- Update `closeBacklogTask` to use `closed` status
- Update handoff to use `getCompletionStatus()`
- Fix attached task transitions (only on handoff to user)

**Commits:**
- `b798b2b` feat: update backend mutations for new task workflow
- `b712973` fix: attached backlog tasks only transition on handoff to user
- `875298c` fix: backlog-origin tasks go to pending_user_review on handoff to user
- `7bc3e0f` refactor: use taskWorkflows as source of truth for completion status

### Phase 4: Frontend Components ✅
**Status: Complete**

- Update type definitions in TaskQueue, TaskDetailModal, TaskQueueModal
- Add status badges for new statuses
- Fix archived count to use backend counts
- Add actions for pending review state

**Commits:**
- `389e5d0` feat: update frontend components for new task statuses
- `a2cda0a` fix: archived count uses backend counts instead of filtered tasks

### Phase 5: Integration Tests ✅
**Status: Complete**

- Test backlog task creation with origin
- Test chat task creation with origin
- Test status transitions through workflow
- Test completeTask routing by origin
- Test markBacklogComplete and closeBacklogTask

**Commits:**
- `724aacb` test: add task workflow integration tests

### Phase 6: CLI Auth Fixes ✅
**Status: Complete** (Bonus)

- Multi-environment auth session support
- Helpful error messages when session not found for URL
- Production URL enforcement for legacy format

**Commits:**
- `6d54530` fix: show helpful message when auth session not found for current URL
- `92f49bb` fix: enforce production URL for legacy auth format

## Phase Dependencies

```
Phase 1 (Schema) → Phase 2 (Migration)
                         ↓
Phase 1 (Schema) → Phase 3 (Backend) → Phase 4 (Frontend)
                                              ↓
                                    Phase 5 (Integration Tests)
```

## Success Criteria

| Phase | Criteria | Status |
|-------|----------|--------|
| 1 | Schema changes don't break existing code | ✅ |
| 2 | Migration script sets origin correctly | ✅ |
| 3 | Backlog tasks go to pending_user_review | ✅ |
| 4 | UI shows new statuses correctly | ✅ |
| 5 | All 11 integration tests pass | ✅ |
| 6 | CLI auth works for multiple environments | ✅ |

## Post-Implementation Tasks

### Migration (User Action Required)
```bash
npx convex run migration:normalizeAllTaskOrigins
```

### Cleanup (Future Phase)
See Plan 018 for legacy code cleanup phases.
