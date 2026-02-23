/**
 * transitionTask usecase
 *
 * This module is the public API for transitioning task state.
 * It wraps the underlying FSM transition and, after terminal transitions,
 * automatically attempts to promote the next queued task via the
 * promote-next-task usecase.
 *
 * ## Design
 *
 * The usecase exposes the same function signature as the FSM layer so
 * all existing callers remain unchanged. Internally it:
 *
 *   1. Delegates the FSM transition to `lib/taskStateMachine.transitionTask`
 *   2. After transitions to `completed` or `closed`, calls `promoteNextTask`
 *      using deps wired from the Convex mutation context
 *
 * ## Callers
 *
 * All callers should import from this module:
 *   import { transitionTask } from '../src/domain/usecase/task/transition-task'
 *
 * The FSM rules, type definitions, and helper functions remain in
 * lib/taskStateMachine.ts as the authoritative implementation.
 */

import { promoteNextTask } from './promote-next-task';
import { internal } from '../../../../convex/_generated/api';
import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import { areAllAgentsIdle } from '../../../../convex/auth/cliSessionAuth';
import { ENSURE_AGENT_DELAY_MS } from '../../../../convex/ensureAgentHandler';
import type { Task, TaskStatus } from '../../../../convex/lib/taskStateMachine';
import { transitionTask as fsmTransitionTask } from '../../../../convex/lib/taskStateMachine';

// ============================================================================
// TERMINAL STATES THAT TRIGGER QUEUE PROMOTION
// ============================================================================

/**
 * Task statuses that free the queue slot and should trigger auto-promotion
 * of the next queued task.
 */
const PROMOTION_TRIGGER_STATUSES: ReadonlySet<TaskStatus> = new Set(['completed', 'closed']);

/**
 * Task statuses that indicate an agent should be running.
 * After transitions to these statuses, we schedule an ensure-agent check.
 */
const ENSURE_AGENT_TRIGGER_STATUSES: ReadonlySet<TaskStatus> = new Set([
  'pending',
  'acknowledged',
  'in_progress',
]);

// ============================================================================
// USECASE
// ============================================================================

/**
 * Transitions a task to a new status via the FSM and, for terminal
 * transitions, automatically promotes the next queued task if all
 * agents are idle.
 *
 * Exposes the same signature as the underlying FSM function so all
 * callers can use this as a drop-in replacement.
 *
 * @param ctx - Convex mutation context (used to wire `promoteNextTask` deps)
 * @param taskId - The task to transition
 * @param newStatus - The desired target status
 * @param trigger - FSM trigger label (must match a valid transition rule)
 * @param overrides - Optional field overrides applied after transition
 */
export async function transitionTask(
  ctx: MutationCtx,
  taskId: Id<'chatroom_tasks'>,
  newStatus: TaskStatus,
  trigger: string,
  overrides?: Partial<Task>
): Promise<void> {
  // 1. Delegate the FSM transition (validates rules, applies patches, logs)
  await fsmTransitionTask(ctx, taskId, newStatus, trigger, overrides);

  // 2. After terminal transitions, attempt to promote the next queued task.
  //    We re-fetch the task to get its chatroomId (the transition has already
  //    committed, so the status is now `newStatus`).
  if (PROMOTION_TRIGGER_STATUSES.has(newStatus)) {
    const task = await ctx.db.get('chatroom_tasks', taskId);
    if (task) {
      await promoteNextTask(task.chatroomId, {
        areAllAgentsIdle: (chatroomId) => areAllAgentsIdle(ctx, chatroomId),
        getOldestQueuedTask: async (chatroomId) => {
          const tasks = await ctx.db
            .query('chatroom_tasks')
            .withIndex('by_chatroom_status', (q) =>
              q.eq('chatroomId', chatroomId).eq('status', 'queued')
            )
            .collect();
          if (tasks.length === 0) return null;
          tasks.sort((a, b) => a.queuePosition - b.queuePosition);
          return tasks[0] ?? null;
        },
        transitionTaskToPending: (nextTaskId) =>
          fsmTransitionTask(ctx, nextTaskId, 'pending', 'promoteNextTask'),
      });
    }
  }

  // 3. After active-status transitions, schedule an ensure-agent check.
  //    Re-fetch AFTER the FSM transition so updatedAt is the post-transition timestamp.
  if (ENSURE_AGENT_TRIGGER_STATUSES.has(newStatus)) {
    const activeTask = await ctx.db.get('chatroom_tasks', taskId);
    if (activeTask) {
      await ctx.scheduler.runAfter(ENSURE_AGENT_DELAY_MS, internal.ensureAgentHandler.check, {
        taskId,
        chatroomId: activeTask.chatroomId,
        snapshotUpdatedAt: activeTask.updatedAt,
      });
    }
  }
}

// Re-export the TaskStatus type so callers only need one import path
export type { TaskStatus } from '../../../../convex/lib/taskStateMachine';
