# Architecture: Task Lifecycle Reliability

## Changes Overview

This plan introduces defensive mechanisms for task lifecycle management:
1. State recovery on agent rejoin
2. Periodic cleanup of stale agents/tasks
3. Comprehensive attached task status transitions
4. Manual reset capability for stuck tasks

## Current State Diagram

```
[User Message] → [Task Created: pending]
                      ↓
               [wait-for-task polls]
                      ↓
               [Task Claimed: in_progress] ← (PROBLEM: agent may crash here)
                      ↓
               [Agent works...]
                      ↓
               [handoff → Task: completed/pending_user_review]
```

**Problems with current flow:**
1. If agent crashes after claiming, task stays `in_progress` forever
2. No cleanup mechanism for stale `in_progress` tasks
3. Attached tasks only update if in `backlog` status specifically

## Proposed State Diagram

```
[User Message] → [Task Created: pending]
                      ↓
               [wait-for-task polls]
                      ↓
               [Task Claimed: in_progress]
                  ↓           ↘
            [Agent works]    [Timeout/Crash detected]
                  ↓                    ↓
            [handoff]          [State Recovery]
                  ↓                    ↓
            [completed]        [Task: pending] (retry)
                                       ↓
                              [wait-for-task picks up again]
```

## Modified Components

### 1. participants.ts - Agent Join with State Recovery

```typescript
// Enhanced join mutation
export const join = mutation({
  // ... existing args ...
  handler: async (ctx, args) => {
    // ... existing validation ...

    // NEW: State recovery when previously-active agent rejoins
    // IMPORTANT: Check status BEFORE updating the participant (per reviewer feedback)
    const existing = await ctx.db
      .query('chatroom_participants')
      .withIndex('by_chatroom_and_role', (q) =>
        q.eq('chatroomId', args.chatroomId).eq('role', args.role)
      )
      .unique();

    const wasActive = existing && existing.status === 'active';

    if (wasActive) {
      // Agent was previously active - recover any in_progress tasks
      // Call recovery BEFORE updating participant status
      await recoverOrphanedTasks(ctx, args.chatroomId, args.role);
    }

    // ... rest of existing logic (update participant to 'waiting') ...
  },
});
```

### 1b. lib/taskRecovery.ts - Shared Recovery Helper (NEW FILE)

```typescript
// services/backend/convex/lib/taskRecovery.ts
// Shared helper for recovering orphaned tasks (used by join and cron)

import { MutationCtx } from '../_generated/server';
import { Id } from '../_generated/dataModel';

/**
 * Recover orphaned in_progress tasks assigned to a specific role.
 * Resets them to pending so they can be re-claimed.
 * 
 * @returns Array of recovered task IDs
 */
export async function recoverOrphanedTasks(
  ctx: MutationCtx,
  chatroomId: Id<'chatroom_rooms'>,
  role: string
): Promise<string[]> {
  const inProgressTasks = await ctx.db
    .query('chatroom_tasks')
    .withIndex('by_chatroom_status', (q) =>
      q.eq('chatroomId', chatroomId).eq('status', 'in_progress')
    )
    .filter((q) => q.eq(q.field('assignedTo'), role))
    .collect();

  const now = Date.now();
  const recoveredIds: string[] = [];

  for (const task of inProgressTasks) {
    await ctx.db.patch('chatroom_tasks', task._id, {
      status: 'pending',
      assignedTo: undefined,
      startedAt: undefined,
      updatedAt: now,
    });
    recoveredIds.push(task._id);
    console.warn(
      `[State Recovery] chatroomId=${chatroomId} role=${role} taskId=${task._id} ` +
      `action=reset_to_pending`
    );
  }

  return recoveredIds;
}
```

### 2. tasks.ts - Stale Cleanup Scheduled Function

```typescript
// New scheduled function (runs every 2 minutes)
// NOTE: For scalability, only query active/waiting participants (per reviewer feedback)
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

    for (const participant of candidateParticipants) {
      let isStale = false;
      
      if (participant.status === 'active' && participant.activeUntil) {
        isStale = now > participant.activeUntil;
      } else if (participant.status === 'waiting' && participant.readyUntil) {
        isStale = now > participant.readyUntil;
      }

      if (isStale) {
        // Reset participant to idle
        await ctx.db.patch('chatroom_participants', participant._id, {
          status: 'idle',
          readyUntil: undefined,
          activeUntil: undefined,
        });

        // If was active, recover their tasks
        if (participant.status === 'active') {
          const recovered = await recoverOrphanedTasks(ctx, participant.chatroomId, participant.role);
          affectedTasks.push(...recovered);
        }

        cleanedCount++;
      }
    }

    // Summary log (per reviewer feedback - one summary per run)
    if (cleanedCount > 0) {
      console.warn(
        `[Stale Cleanup] Cleaned ${cleanedCount} participants, recovered ${affectedTasks.length} tasks. ` +
        `taskIds=${affectedTasks.join(',') || 'none'}`
      );
    }
  },
});
```

### 3. messages.ts - Fix Attached Task Transitions

```typescript
// In _handoffHandler, update Step 5:

// Step 5: Update attached backlog tasks to pending_user_review when handing off to user
// Whitelist of statuses that should transition (per reviewer feedback)
const TRANSITIONABLE_STATUSES = ['backlog', 'queued', 'pending', 'in_progress'] as const;

if (isHandoffToUser) {
  for (const task of inProgressTasks) {
    if (task.sourceMessageId) {
      const sourceMessage = await ctx.db.get('chatroom_messages', task.sourceMessageId);
      if (sourceMessage?.attachedTaskIds && sourceMessage.attachedTaskIds.length > 0) {
        for (const attachedTaskId of sourceMessage.attachedTaskIds) {
          const attachedTask = await ctx.db.get('chatroom_tasks', attachedTaskId);
          // FIX: Use whitelist approach - only transition specific statuses
          // Must be backlog-origin AND in a transitionable status
          if (attachedTask && 
              attachedTask.origin === 'backlog' &&
              TRANSITIONABLE_STATUSES.includes(attachedTask.status as typeof TRANSITIONABLE_STATUSES[number])) {
            await ctx.db.patch('chatroom_tasks', attachedTaskId, {
              status: 'pending_user_review' as const,
              updatedAt: now,
            });
            console.warn(
              `[Attached Task Update] chatroomId=${task.chatroomId} taskId=${attachedTaskId} ` +
              `from=${attachedTask.status} to=pending_user_review`
            );
          }
        }
      }
    }
  }
}
```

### 4. tasks.ts - Manual Reset Mutation

```typescript
/**
 * Reset a stuck in_progress task back to pending.
 * Used for manual recovery when an agent crashes without completing.
 * Requires CLI session authentication and chatroom access.
 */
export const resetStuckTask = mutation({
  args: {
    sessionId: v.string(),
    taskId: v.id('chatroom_tasks'),
  },
  handler: async (ctx, args) => {
    const task = await ctx.db.get('chatroom_tasks', args.taskId);
    if (!task) {
      throw new Error('Task not found');
    }

    // Validate session and check chatroom access
    await requireChatroomAccess(ctx, args.sessionId, task.chatroomId);

    // Only allow resetting in_progress tasks
    if (task.status !== 'in_progress') {
      throw new Error(
        `Cannot reset task with status: ${task.status}. Only in_progress tasks can be reset.`
      );
    }

    const now = Date.now();
    await ctx.db.patch('chatroom_tasks', args.taskId, {
      status: 'pending',
      assignedTo: undefined,
      startedAt: undefined,
      updatedAt: now,
    });

    console.warn(
      `[Manual Reset] Task ${args.taskId} reset from in_progress to pending. ` +
        `Previously assigned to: ${task.assignedTo || 'unknown'}`
    );

    return { success: true, previousAssignee: task.assignedTo };
  },
});
```

## New Contracts

### CLI Commands

```typescript
// packages/cli/src/commands/backlog.ts

/**
 * Reset a stuck in_progress task back to pending.
 */
export async function resetBacklog(
  chatroomId: string,
  options: {
    role: string;
    taskId: string;
  }
): Promise<void>;
```

### Scheduled Function Config

```typescript
// services/backend/convex/crons.ts

import { cronJobs } from 'convex/server';
import { internal } from './_generated/api';

const crons = cronJobs();

crons.interval(
  'cleanup stale agents',
  { minutes: 2 },
  internal.tasks.cleanupStaleAgents
);

export default crons;
```

## Data Flow Changes

### Current Flow (Problematic)

1. Agent A claims task → task becomes `in_progress`, assigned to A
2. Agent A crashes (no handoff)
3. Task remains `in_progress` forever
4. Agent A restarts → joins as new `waiting` agent
5. Task never recovered, stuck in limbo

### New Flow (With Recovery)

1. Agent A claims task → task becomes `in_progress`, assigned to A
2. Agent A crashes (no handoff)
3. Agent A restarts → calls `participants.join`
4. Join detects A was previously `active`
5. All A's `in_progress` tasks are reset to `pending`
6. A enters `waiting` state
7. A immediately picks up the recovered pending task

### Stale Cleanup Flow

1. Scheduled function runs every 2 minutes
2. Checks all participants for expired `activeUntil` or `readyUntil`
3. Stale participants reset to `idle`
4. Stale `active` participants trigger task recovery
5. Tasks are promoted from queue if conditions met

## Integration Points

### Convex Crons

New file: `services/backend/convex/crons.ts` for scheduled cleanup.

### CLI Integration

New command: `chatroom backlog reset-task <chatroomId> --role=<role> --taskId=<id>`

### Logging

All state recovery and cleanup events logged with `[State Recovery]`, `[Stale Cleanup]`, `[Manual Reset]`, `[Attached Task Update]` prefixes for easy filtering.
