# Implementation Phases

This plan is broken down into 4 phases, each representing a cohesive, committable unit of work. Each phase results in a working (though potentially incomplete) system.

---

## Phase 1: FSM Foundation (Schema + Core Module)

**Goal**: Establish the FSM infrastructure without breaking existing functionality.

### Tasks

1. **Update schema** (`services/backend/convex/schema.ts`)
   - Add `acknowledged` and `backlog_acknowledged` to status enum
   - Add `attachedTaskIds?: Id<'chatroom_tasks'>[]` field
   - Add `parentTaskIds?: Id<'chatroom_tasks'>[]` field
   - Add `acknowledgedAt?: number` timestamp field

2. **Create FSM module** (`services/backend/convex/lib/taskStateMachine.ts`)
   - Define `TaskStatus` type
   - Define `TransitionRule` interface
   - Define `TRANSITIONS` array with all valid transitions
   - Implement `transitionTask()` helper function
   - Implement `getValidTransitionsFrom()` for error messages
   - Implement `canTransition()` validation function
   - Define `InvalidTransitionError` class
   - Define `TaskTransitionError` interface

3. **Add unit tests** (if test infrastructure exists)
   - Test valid transitions succeed
   - Test invalid transitions throw proper errors
   - Test field cleanup works correctly
   - Test required fields validation

### Success Criteria

- ✅ Schema updated with new fields and statuses
- ✅ FSM module compiles without errors
- ✅ All transition rules defined
- ✅ Helper functions work correctly
- ✅ No breaking changes to existing code (new code is additive only)

### Deployment

Can deploy safely - new fields and module exist but aren't used yet.

---

## Phase 2: Backlog Attachment Tracking

**Goal**: Implement bidirectional tracking between tasks and backlog items.

### Tasks

1. **Update `sendMessage` mutation** (`services/backend/convex/messages.ts`)
   - When user attaches backlog tasks to a message
   - Create the main task with `attachedTaskIds`
   - Update each backlog task's `parentTaskIds` to include the main task
   - Transition backlog tasks: `backlog` → `backlog_acknowledged` (use FSM)

2. **Update backlog task transition logic**
   - When main task is acknowledged (new `claimTask` mutation)
   - Find all tasks in `attachedTaskIds`
   - Transition each: `backlog_acknowledged` → `pending_user_review` (use FSM)

3. **Update `moveToQueue` mutation** (`services/backend/convex/tasks.ts`)
   - Use `transitionTask()` instead of direct patch
   - Handle both `pending` and `queued` outcomes

4. **Update `sendBackForRework` mutation** (`services/backend/convex/tasks.ts`)
   - Use `transitionTask()` instead of direct patch
   - Clear `parentTaskIds` when sending back

### Success Criteria

- ✅ Backlog tasks correctly linked to parent tasks
- ✅ Backlog tasks transition when parent acknowledged
- ✅ `moveToQueue` uses FSM
- ✅ `sendBackForRework` uses FSM
- ✅ Manual testing: attach backlog task → acknowledge main task → verify backlog task in pending_user_review

### Deployment

Safe to deploy - backlog flow now uses FSM, but user message flow still uses old logic.

---

## Phase 3: User Message Flow (Acknowledgment Split)

**Goal**: Split task claiming and starting into two separate steps with proper FSM transitions.

### Tasks

1. **Create new `claimTask` mutation** (`services/backend/convex/tasks.ts`)
   - Find pending task for the role
   - Use `transitionTask(ctx, taskId, 'acknowledged', { assignedTo: role })`
   - Set message `acknowledgedAt` timestamp
   - Return task details

2. **Update `startTask` mutation** (`services/backend/convex/tasks.ts`)
   - Change: transition from `acknowledged` → `in_progress` (not `pending` → `in_progress`)
   - Use `transitionTask(ctx, taskId, 'in_progress')`
   - Validate task is in `acknowledged` state first

3. **Update `wait-for-task` CLI command** (`packages/cli/src/commands/wait-for-task.ts`)
   - Change: call `claimTask` mutation instead of `startTask`
   - Display task to agent
   - Agent still calls `task-started` separately (no CLI change needed)

4. **Update `getPendingTasksForRole` query** (`services/backend/convex/tasks.ts`)
   - Remove `startedAt` filtering
   - Only check `status === 'pending'`
   - Simplify logic now that FSM guarantees no invalid states

5. **Update error handling in CLI**
   - Catch and display `InvalidTransitionError` details
   - Format `aiGuidance` for agent consumption

### Success Criteria

- ✅ `claimTask` mutation works correctly
- ✅ `startTask` validates `acknowledged` state
- ✅ wait-for-task uses new flow
- ✅ getPendingTasksForRole simplified
- ✅ No duplicate task delivery on agent reconnect
- ✅ Manual testing: agent workflow pending → acknowledged → in_progress → completed

### Deployment

Requires coordinated deployment:
1. Deploy backend with new mutations
2. Update CLI to new version
3. Agents use new CLI commands

---

## Phase 4: Complete FSM Migration (All Remaining Mutations)

**Goal**: Migrate all remaining mutations to use FSM, ensuring 100% coverage.

### Tasks

1. **Update completion mutations**
   - `completeTask` (`services/backend/convex/tasks.ts`)
   - `completeTaskById` (`services/backend/convex/tasks.ts`)
   - `markBacklogComplete` (`services/backend/convex/tasks.ts`)
   - All use `transitionTask()` for status changes

2. **Update cancellation mutations**
   - `cancelTask` (`services/backend/convex/tasks.ts`)
   - `closeBacklogTask` (`services/backend/convex/tasks.ts`)
   - All use `transitionTask()` for status changes

3. **Update recovery mutations**
   - `resetStuckTask` (`services/backend/convex/tasks.ts`)
   - `reopenBacklogTask` (`services/backend/convex/tasks.ts`)
   - All use `transitionTask()` for status changes

4. **Update queue promotion**
   - `promoteNextTask` (`services/backend/convex/tasks.ts`)
   - All use `transitionTask()` for status changes

5. **Update handoff mutation** (`services/backend/convex/messages.ts`)
   - `_handoffHandler` uses `transitionTask()` for all task status changes
   - Attached backlog task transitions use FSM

6. **Add validation** (optional, for safety)
   - Lint rule or runtime check: no direct `ctx.db.patch` on task status outside FSM
   - Dev-only warning when direct patches detected

### Success Criteria

- ✅ All task mutations use `transitionTask()`
- ✅ No direct `ctx.db.patch('chatroom_tasks', ...)` with status field outside FSM
- ✅ All invalid transitions return structured errors
- ✅ Integration tests pass
- ✅ Manual testing: all workflows work correctly (user message, backlog, handoffs, cancellations, recovery)

### Deployment

Safe to deploy - all mutations now use FSM. System is fully migrated.

---

## Phase Dependencies

```
Phase 1 (Foundation)
    ↓
Phase 2 (Backlog)
    ↓
Phase 3 (User Message Flow)
    ↓
Phase 4 (Complete Migration)
```

Each phase depends on the previous one completing successfully.

---

## Testing Strategy

### Per-Phase Testing

- **Phase 1**: Unit tests for FSM module
- **Phase 2**: Manual test backlog attachment flow
- **Phase 3**: Manual test agent workflow with new CLI
- **Phase 4**: Full regression test all workflows

### Critical Test Scenarios

1. **Agent reconnect doesn't duplicate delivery**
   - Agent calls wait-for-task
   - Agent disconnects before calling task-started
   - Agent reconnects and calls wait-for-task again
   - ✅ Agent should NOT see the task again (status is now 'acknowledged')

2. **Backlog tasks follow parent lifecycle**
   - User attaches backlog tasks B1, B2 to message
   - Agent acknowledges main task
   - ✅ B1 and B2 should transition to pending_user_review

3. **Invalid transitions return helpful errors**
   - Agent tries to complete task without starting it
   - ✅ Should return structured error with aiGuidance

4. **Field cleanup works**
   - Task sent back for rework
   - ✅ startedAt, assignedTo, completedAt should be cleared

---

## Rollback Plan

Each phase can be rolled back independently:

- **Phase 1**: Remove schema changes and FSM module (no functionality affected)
- **Phase 2**: Revert mutations to direct patches (backlog flow reverts to old behavior)
- **Phase 3**: Revert CLI to use `startTask`, revert query logic (agents use old flow)
- **Phase 4**: Revert specific mutations to direct patches (gradual rollback possible)

**Critical**: Phase 3 requires CLI update. If issues arise, redeploy old CLI version.
