# Phases: Task Workflow Cleanup

## Phase 1: Pre-Migration Cleanup
**Status: Pending**
**Risk: Low**
**Blocking: None**

Safe cleanup that can be done before running the migration script.

### Tasks

1. **Remove unused `isArchivedTask` callback** (`TaskQueue.tsx`)
   - The function is defined but no longer used (archived count uses backend counts)

2. **Remove deprecated function comments** (cosmetic)
   - Clean up obsolete comments that reference old behavior

3. **Consolidate frontend TaskStatus types**
   - Create shared type in a common location
   - Update `TaskQueue.tsx`, `TaskDetailModal.tsx`, `TaskQueueModal.tsx` to import

### Files to Modify

| File | Changes |
|------|---------|
| `TaskQueue.tsx` | Remove `isArchivedTask` callback |
| `types/task.ts` (new) | Create shared `TaskStatus`, `TaskOrigin` types |
| `TaskDetailModal.tsx` | Import shared types |
| `TaskQueueModal.tsx` | Import shared types |

### Success Criteria

- [ ] No duplicate type definitions in frontend
- [ ] All tests pass
- [ ] No functional behavior changes

---

## Phase 2: Post-Migration Cleanup
**Status: Blocked (waiting for migration)**
**Risk: High**
**Blocking: Migration script must be run first**

⚠️ **WARNING**: Only proceed after confirming migration is complete.

### Pre-Conditions

1. Run `npx convex run migration:normalizeAllTaskOrigins`
2. Verify all tasks have `origin` field set
3. Monitor for any issues in production

### Tasks

1. **Remove `backlog` field from schema** (`schema.ts`)
   - Remove the deprecated `backlog` field definition
   - Update validators

2. **Remove dual origin detection** (`tasks.ts`, `messages.ts`)
   - Replace `task.origin === 'backlog' || task.backlog !== undefined` with `task.origin === 'backlog'`
   - Remove all `task.backlog` checks

3. **Remove `backlogStatusFilter`** (`tasks.ts`)
   - Remove deprecated filter from `listTasks`
   - Update frontend to use `statusFilter` only

4. **Remove `cancelled` status handling** (`taskWorkflows.ts`, `tasks.ts`)
   - Remove from status union in schema
   - Update getTaskCounts to not return cancelled
   - Remove handling in workflow helpers

5. **Remove legacy backlog migration** (`migration.ts`)
   - Remove `normalizeTaskOrigin` single-task mutation
   - Keep batch migration for reference (or remove entirely)

### Files to Modify

| File | Changes |
|------|---------|
| `schema.ts` | Remove `backlog` field, `cancelled` status |
| `tasks.ts` | Remove dual origin checks, remove `backlogStatusFilter` |
| `messages.ts` | Remove dual origin checks |
| `taskWorkflows.ts` | Remove deprecated status handling |
| `migration.ts` | Remove/archive old migrations |
| `TaskQueue.tsx` | Remove backlog.status checks |
| `TaskDetailModal.tsx` | Remove backlog.status checks |

### Success Criteria

- [ ] No references to `task.backlog` in codebase
- [ ] No references to `cancelled` status
- [ ] All tests pass
- [ ] TypeScript compilation succeeds
- [ ] No functional behavior changes

---

## Phase Dependencies

```
Phase 1 (Pre-Migration) ──→ Release ──→ Migration ──→ Phase 2 (Post-Migration)
                             ↑
                       User runs migration
```

## Verification Commands

### Before Phase 2

```bash
# Verify all tasks have origin set
npx convex run --prod migration:checkTaskOrigins
```

### After Phase 2

```bash
# Run all tests
pnpm test

# Type check
pnpm typecheck

# Lint
pnpm lint
```
