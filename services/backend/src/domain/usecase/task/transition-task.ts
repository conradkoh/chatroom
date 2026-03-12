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
import { promoteQueuedMessage } from './promote-queued-message';
import { internal } from '../../../../convex/_generated/api';
import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import { areAllAgentsWaiting } from '../../../../convex/auth/cliSessionAuth';
import { ENSURE_AGENT_FALLBACK_DELAY_MS } from '../../../../config/reliability';
import type { Task, TaskStatus } from '../../../../convex/lib/taskStateMachine';
import { transitionTask as fsmTransitionTask } from '../../../../convex/lib/taskStateMachine';
import { ACTIVE_TASK_STATUSES, TERMINAL_TASK_STATUSES, resolveTaskRole } from '../../entities/task';

// ============================================================================
// USECASE
// ============================================================================

/**
 * Transitions a task to a new status via the FSM and, for terminal
 * transitions, automatically promotes the next queued task if all
 * agents are waiting.
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

  // 2. Write event to chatroom_eventStream based on new status.
  //    Re-fetch the task to get current fields (assignedTo, content, chatroomId).
  const eventTask = await ctx.db.get('chatroom_tasks', taskId);
  if (eventTask) {
    if (ACTIVE_TASK_STATUSES.has(newStatus)) {
      const chatroom = eventTask.assignedTo ? null : await ctx.db.get('chatroom_rooms', eventTask.chatroomId);
      const role = resolveTaskRole(eventTask.assignedTo, chatroom);
      await ctx.db.insert('chatroom_eventStream', {
        type: 'task.activated',
        chatroomId: eventTask.chatroomId,
        taskId,
        role,
        taskStatus: newStatus,
        taskContent: eventTask.content,
        timestamp: Date.now(),
      });
    } else if (TERMINAL_TASK_STATUSES.has(newStatus)) {
      await ctx.db.insert('chatroom_eventStream', {
        type: 'task.completed',
        chatroomId: eventTask.chatroomId,
        taskId,
        role: eventTask.assignedTo ?? 'unknown',
        finalStatus: newStatus,
        timestamp: Date.now(),
      });
    }
  }

  // 3. After terminal transitions, attempt to promote the next queued task.
  //    We re-fetch the task to get its chatroomId (the transition has already
  //    committed, so the status is now `newStatus`).
  if (TERMINAL_TASK_STATUSES.has(newStatus)) {
    const task = await ctx.db.get('chatroom_tasks', taskId);
    if (task) {
      await promoteNextTask(task.chatroomId, {
        areAllAgentsWaiting: (chatroomId) => areAllAgentsWaiting(ctx, chatroomId),
        getOldestQueuedMessage: async (chatroomId) => {
          return await ctx.db
            .query('chatroom_messageQueue')
            .withIndex('by_chatroom_queue', (q) => q.eq('chatroomId', chatroomId))
            .order('asc')
            .first();
        },
        promoteQueuedMessage: (queuedMessageId) => promoteQueuedMessage(ctx, queuedMessageId),
      });
    }
  }

  // 4. After active-status transitions, schedule an ensure-agent check.
  //    Re-fetch AFTER the FSM transition so updatedAt is the post-transition timestamp.
  //    For in_progress tasks, the check itself handles the token-activity guard
  //    (rescheduling if the agent is still producing output, restarting if stale).
  if (ACTIVE_TASK_STATUSES.has(newStatus)) {
    const activeTask = await ctx.db.get('chatroom_tasks', taskId);
    if (activeTask) {
      await ctx.scheduler.runAfter(ENSURE_AGENT_FALLBACK_DELAY_MS, internal.ensureAgentHandler.check, {
        taskId,
        chatroomId: activeTask.chatroomId,
        snapshotUpdatedAt: activeTask.updatedAt,
      });
    }
  }
}

// Re-export the TaskStatus type so callers only need one import path
export type { TaskStatus } from '../../../../convex/lib/taskStateMachine';
