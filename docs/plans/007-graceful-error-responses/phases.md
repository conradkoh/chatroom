# Phases: Graceful Error Responses

## Phase Breakdown

### Phase 1: Task Start Error (tasks.ts:108)

**Scope:** Refactor `startTask` mutation to return error response when no pending task exists.

**Files:**
- `services/backend/convex/tasks.ts` - Modify `startTask` handler
- `packages/cli/src/commands/wait-for-task.ts` - Handle error response

**Changes:**
1. Update `startTask` return type to include success/error fields
2. Replace `throw new Error('No pending task to start')` with error response
3. Update wait-for-task.ts to check response and continue polling on this error

**Success Criteria:**
- When no pending task exists, CLI continues polling instead of crashing
- Error is logged clearly if in verbose mode

---

### Phase 2: Task Force Complete Error (tasks.ts:307)

**Scope:** Refactor `completeTaskById` mutation to return error for force-complete scenarios.

**Files:**
- `services/backend/convex/tasks.ts` - Modify `completeTaskById` handler
- `packages/cli/src/commands/backlog.ts` - Handle error response

**Changes:**
1. Replace throws for status validation with error responses
2. Include suggested action with `--force` flag example
3. Update backlog complete command to display helpful error

**Success Criteria:**
- When force-complete is needed, CLI shows clear message with example command
- No uncaught exceptions for status validation errors

---

### Phase 3: Message Classification Errors (messages.ts:490,495)

**Scope:** Refactor `taskStarted` mutation to return error responses for classification failures.

**Files:**
- `services/backend/convex/messages.ts` - Modify `taskStarted` handler
- `packages/cli/src/commands/task-started.ts` - Handle error response

**Changes:**
1. Replace `throw new Error('Can only classify user messages')` with error response
2. Replace `throw new Error('Message is already classified')` with error response
3. Update task-started.ts to display clear error messages

**Success Criteria:**
- Classification errors return actionable messages
- CLI displays why classification failed and what to do

---

### Phase 4: Invalid Role Error (participants.ts:36)

**Scope:** Refactor `join` mutation to return error response for invalid roles.

**Files:**
- `services/backend/convex/participants.ts` - Modify `join` handler
- `packages/cli/src/commands/wait-for-task.ts` - Handle error response

**Changes:**
1. Replace `throw new Error('Invalid role...')` with error response
2. Include `allowedRoles` in error context
3. Update wait-for-task.ts to display available roles on error

**Success Criteria:**
- Invalid role error shows which roles are allowed
- CLI displays helpful message with valid role options

---

## Phase Dependencies

```
Phase 1 (Task Start) ──┐
                       │
Phase 2 (Force Complete)─┼── Can be done in parallel
                       │
Phase 3 (Classification)─┤
                       │
Phase 4 (Invalid Role) ─┘
```

All phases are independent and can be implemented in any order or in parallel.

## Summary

| Phase | Error | File | Commit Message |
|-------|-------|------|----------------|
| 1 | No pending task to start | tasks.ts:108 | `fix(backend): return error response for no pending task` |
| 2 | Force complete required | tasks.ts:307 | `fix(backend): return error response for force complete` |
| 3 | Classification errors | messages.ts:490,495 | `fix(backend): return error response for classification failures` |
| 4 | Invalid role | participants.ts:36 | `fix(backend): return error response for invalid role` |

## Verification

After all phases complete:

1. **Manual Testing:**
   - Run CLI commands that trigger each error case
   - Verify clean error messages are displayed
   - Verify no uncaught exceptions in console

2. **Existing Tests:**
   - Run `pnpm test` to ensure no regressions
   - Run `pnpm typecheck` to ensure type safety
