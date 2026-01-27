# Plan 021: Task Finite State Machine Refactor

## Summary

This plan refactors the task lifecycle system to use a **strict Finite State Machine (FSM)** with status as the single source of truth. It eliminates timestamp-based workflow logic, introduces proper acknowledgment states, and moves message queuing logic from tasks to messages.

The refactor addresses the fundamental architectural issue: **timestamp fields (startedAt, acknowledgedAt) are being used for workflow logic instead of purely as metadata**. This creates edge cases where tasks can be in inconsistent states (e.g., `status='pending'` with `startedAt` set).

## Goals

1. **Status as single source of truth** - All workflow logic uses only the `status` field
2. **Strict FSM enforcement** - Invalid state transitions throw structured errors with AI-readable guidance
3. **Proper acknowledgment tracking** - Separate `acknowledged` state between task delivery and work start
4. **Backlog attachment tracking** - Tasks store which backlog items are attached to them
5. **Message-based queuing** - Move queuing logic from tasks to messages where it belongs

## Non-Goals

1. Changing the UI/UX of task management
2. Modifying the team configuration or role hierarchy
3. Adding new task types or workflows
4. Performance optimizations (unless directly related to correctness)

## Key Architectural Changes

### Problem: Mixed Concerns

**Current system:**
- `startedAt` timestamp used to filter duplicate task delivery (workflow logic)
- Tasks have `queued` status but messages should be queued instead
- No distinction between "agent saw the task" and "agent started working"

**New system:**
- `status` field is the **only** source of truth for workflow state
- Timestamps are metadata only - never used for business logic
- Clear separation: `acknowledged` → `in_progress` → `completed`
- FSM helper enforces valid transitions and automatic field cleanup

### Workflows

#### User Message Flow
```
pending → acknowledged → in_progress → completed
```

#### Backlog Flow
```
backlog → backlog_acknowledged → pending_user_review → completed
```

### State Transitions

All transitions enforced through `transitionTask()` helper:
- Validates transition is allowed
- Automatically clears stale fields (startedAt, assignedTo, completedAt)
- Sets required fields (timestamps, assignments)
- Throws structured errors with AI-readable guidance

## Related Plans

- **Plan 017** - Established `origin`-based workflows
- **Plan 020** - Identified lifecycle reliability issues
- This plan fixes the root cause: inconsistent state management

## Impact

### Benefits
- Eliminates duplicate task delivery bugs
- Prevents inconsistent state (pending + startedAt set)
- Makes state transitions explicit and auditable
- Simplifies debugging with clear FSM rules

### Migration Required
- Schema changes: Add `acknowledged`, `backlog_acknowledged` statuses
- Schema changes: Add `attachedTaskIds` to tasks table
- Update all mutations to use `transitionTask()` helper
- No data migration needed - old tasks continue working

## Success Criteria

1. All task mutations use `transitionTask()` helper
2. No direct `ctx.db.patch` calls on task status outside FSM
3. Agent reconnection doesn't cause duplicate task delivery
4. Backlog tasks correctly transition when parent task completes
5. Invalid transitions throw structured errors with recovery guidance
