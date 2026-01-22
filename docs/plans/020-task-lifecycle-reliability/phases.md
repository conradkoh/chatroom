# Phases: Task Lifecycle Reliability

## Phase Overview

| Phase | Focus | Complexity | Dependencies |
|-------|-------|------------|--------------|
| 1 | Fix Attached Task Transitions | Low | None |
| 2 | Agent Rejoin State Recovery | Medium | None |
| 3 | Stale Agent Cleanup (Cron) | Medium | Phase 2 |
| 4 | Manual Reset Command | Low | None |
| 5 | Testing & Verification | Medium | All above |

## Phase 1: Fix Attached Task Transitions

**Goal:** Fix the bug where attached tasks in statuses other than `backlog` are not transitioned to `pending_user_review`.

### Changes

**File:** `services/backend/convex/messages.ts`

In `_handoffHandler`, update the Step 5 condition:

```typescript
// Whitelist of statuses that should transition
const TRANSITIONABLE_STATUSES = ['backlog', 'queued', 'pending', 'in_progress'] as const;

// BEFORE (buggy):
if (attachedTask && attachedTask.status === 'backlog') {

// AFTER (fixed - whitelist approach per reviewer feedback):
if (attachedTask && 
    attachedTask.origin === 'backlog' &&  // Must be backlog-origin
    TRANSITIONABLE_STATUSES.includes(attachedTask.status as typeof TRANSITIONABLE_STATUSES[number])) {
```

### Success Criteria

- [ ] Attached tasks with `origin='backlog'` AND `status='backlog'` → transition to `pending_user_review`
- [ ] Attached tasks with `origin='backlog'` AND `status='queued'` → transition to `pending_user_review`
- [ ] Attached tasks with `origin='backlog'` AND `status='pending'` → transition to `pending_user_review`
- [ ] Attached tasks with `origin='backlog'` AND `status='in_progress'` → transition to `pending_user_review`
- [ ] Attached tasks with `status='completed'` → no change
- [ ] Attached tasks with `status='closed'` → no change
- [ ] Attached tasks with `status='cancelled'` → no change (NOT in whitelist)
- [ ] Attached tasks with `status='archived'` → no change (NOT in whitelist)
- [ ] Attached tasks with `origin='chat'` → no change (wrong origin)
- [ ] Console log appears for each transition with chatroomId, taskId, from/to status

---

## Phase 2: Agent Rejoin State Recovery

**Goal:** When an agent that was previously `active` calls `participants.join`, recover any orphaned tasks they were working on.

### Changes

**File:** `services/backend/convex/participants.ts`

1. Add `recoverOrphanedTasks` internal helper function
2. Modify `join` mutation to detect previously-active agents and call recovery

```typescript
// Before updating the participant record, check if recovery needed
if (existing && existing.status === 'active') {
  // Recover tasks assigned to this role that are in_progress
  const orphanedTasks = await ctx.db
    .query('chatroom_tasks')
    .withIndex('by_chatroom_status', (q) =>
      q.eq('chatroomId', args.chatroomId).eq('status', 'in_progress')
    )
    .filter((q) => q.eq(q.field('assignedTo'), args.role))
    .collect();

  for (const task of orphanedTasks) {
    await ctx.db.patch('chatroom_tasks', task._id, {
      status: 'pending',
      assignedTo: undefined,
      startedAt: undefined,
      updatedAt: Date.now(),
    });
    console.warn(
      `[State Recovery] Reset task ${task._id} to pending (agent ${args.role} rejoined)`
    );
  }
}
```

### Success Criteria

- [ ] Agent crashes while working on task
- [ ] Task remains `in_progress` initially
- [ ] Agent restarts and calls `wait-for-task`
- [ ] `participants.join` detects previous `active` status
- [ ] Orphaned tasks reset to `pending`
- [ ] Agent picks up the same task again
- [ ] Console log shows recovery message

---

## Phase 3: Stale Agent Cleanup (Cron)

**Goal:** Periodically detect and clean up agents that have exceeded their timeout without properly disconnecting.

### Changes

**File:** `services/backend/convex/tasks.ts` (or new file `cleanup.ts`)

Add internal mutation for cleanup logic.

**File:** `services/backend/convex/crons.ts` (NEW)

Create the cron job configuration.

```typescript
import { cronJobs } from 'convex/server';
import { internal } from './_generated/api';

const crons = cronJobs();

// Run every 2 minutes to clean up stale agents
crons.interval(
  'cleanup stale agents',
  { minutes: 2 },
  internal.tasks.cleanupStaleAgents
);

export default crons;
```

**File:** `services/backend/convex/tasks.ts`

```typescript
import { internalMutation } from './_generated/server';
import { recoverOrphanedTasks } from './lib/taskRecovery';

export const cleanupStaleAgents = internalMutation({
  handler: async (ctx) => {
    const now = Date.now();
    
    // Only query participants that could be stale (active or waiting status)
    // This avoids scanning idle participants unnecessarily
    const activeParticipants = await ctx.db
      .query('chatroom_participants')
      .filter((q) => q.eq(q.field('status'), 'active'))
      .collect();
    
    const waitingParticipants = await ctx.db
      .query('chatroom_participants')
      .filter((q) => q.eq(q.field('status'), 'waiting'))
      .collect();

    const candidateParticipants = [...activeParticipants, ...waitingParticipants];

    let cleanedCount = 0;
    const affectedTasks: string[] = [];

    for (const p of candidateParticipants) {
      const isStaleActive = p.status === 'active' && p.activeUntil && now > p.activeUntil;
      const isStaleWaiting = p.status === 'waiting' && p.readyUntil && now > p.readyUntil;

      if (isStaleActive || isStaleWaiting) {
        // Reset participant
        await ctx.db.patch('chatroom_participants', p._id, {
          status: 'idle',
          readyUntil: undefined,
          activeUntil: undefined,
        });

        // If was active, recover their tasks using shared helper
        if (isStaleActive) {
          const recovered = await recoverOrphanedTasks(ctx, p.chatroomId, p.role);
          affectedTasks.push(...recovered);
        }

        cleanedCount++;
      }
    }

    // Summary log (one per run, includes affected task IDs)
    if (cleanedCount > 0) {
      console.warn(
        `[Stale Cleanup] Cleaned ${cleanedCount} participants, recovered ${affectedTasks.length} tasks. ` +
        `taskIds=${affectedTasks.join(',') || 'none'}`
      );
    }
  },
});
```

### Success Criteria

- [ ] Cron job registered and running every 2 minutes
- [ ] Stale `active` participants detected and reset to `idle`
- [ ] Stale `waiting` participants detected and reset to `idle`
- [ ] Orphaned tasks from stale `active` agents recovered
- [ ] Console logs show cleanup activity
- [ ] No impact on valid/active participants

---

## Phase 4: Manual Reset Command

**Goal:** Allow users to manually reset a stuck `in_progress` task when automatic recovery fails.

### Changes

**File:** `services/backend/convex/tasks.ts`

Add `resetStuckTask` mutation.

**File:** `packages/cli/src/commands/backlog.ts`

Add `resetBacklog` function.

**File:** `packages/cli/src/index.ts`

Add `backlog reset-task` subcommand.

```typescript
// NOTE: Use --taskId for consistency with other CLI commands (per reviewer feedback)
backlogCommand
  .command('reset-task <chatroomId>')
  .description('Reset a stuck in_progress task back to pending')
  .requiredOption('--role <role>', 'Your role')
  .requiredOption('--taskId <taskId>', 'Task ID to reset')
  .action(async (chatroomId, options) => {
    await maybeRequireAuth();
    const { resetBacklog } = await import('./commands/backlog.js');
    await resetBacklog(chatroomId, options);
  });
```

### Success Criteria

- [ ] `chatroom backlog reset-task` command works
- [ ] Only `in_progress` tasks can be reset
- [ ] Reset clears `assignedTo` and `startedAt`
- [ ] Reset task becomes `pending` and can be claimed
- [ ] Console log shows the reset action
- [ ] Error message if task not `in_progress`

---

## Phase 5: Testing & Verification

**Goal:** Verify all changes work correctly in integration.

### Test Scenarios

1. **Attached Task Bug Fix**
   - Create backlog task
   - Move to queue (status becomes `queued` or `pending`)
   - Attach to message
   - Have agent process and handoff to user
   - Verify attached task is now `pending_user_review`

2. **Agent Crash Recovery**
   - Start agent, let it claim a task
   - Kill agent process (simulate crash)
   - Verify task is still `in_progress`
   - Restart agent
   - Verify task reset to `pending`
   - Verify agent picks up task again

3. **Stale Cleanup**
   - Start agent, let it claim a task
   - Set `activeUntil` to past time (via test helper)
   - Wait for cron to run (or trigger manually)
   - Verify participant reset to `idle`
   - Verify task reset to `pending`

4. **Manual Reset**
   - Create task that gets stuck `in_progress`
   - Run `chatroom backlog reset-task`
   - Verify task now `pending`
   - Verify agent can claim it

### Success Criteria

- [ ] All 4 test scenarios pass
- [ ] Existing tests still pass
- [ ] No regressions in normal workflow
- [ ] Console logs provide adequate debugging info

---

## Implementation Order

1. **Phase 1** (Low risk, immediate value)
2. **Phase 4** (Low risk, provides manual fallback)
3. **Phase 2** (Medium risk, but critical for reliability)
4. **Phase 3** (Depends on Phase 2 being correct)
5. **Phase 5** (After all phases complete)

## Estimated Complexity

- Phase 1: ~30 minutes (simple condition change)
- Phase 2: ~1-2 hours (mutation modification + testing)
- Phase 3: ~1-2 hours (new cron + integration)
- Phase 4: ~1 hour (mutation + CLI command)
- Phase 5: ~1-2 hours (test scenarios)

**Total: ~5-8 hours of implementation time**
