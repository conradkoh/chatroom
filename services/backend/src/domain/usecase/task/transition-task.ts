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
 *   2. After transitions to `completed`, calls `promoteNextTask`
 *      using deps wired from the Convex mutation context
 *
 * ## Callers
 *
 * All callers should import from this module:
 *   import { transitionTask } from '../src/domain/usecase/task/transition-task'
 *
 * The FSM rules, type definitions, and helper functions remain in
 * lib/taskStateMachine.ts as the authoritative implementation.
 *
 * Note: Agent restart for active tasks is now handled by the daemon's task monitor
 * instead of a backend ensure-agent handler.
 */

import { promoteNextTask } from './promote-next-task';
import { promoteQueuedMessage } from './promote-queued-message';
import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import { areAllAgentsWaiting } from '../../../../convex/auth/cliSessionAuth';
import type { Task, TaskStatus } from '../../../../convex/lib/taskStateMachine';
import { transitionTask as fsmTransitionTask } from '../../../../convex/lib/taskStateMachine';
import { ACTIVE_TASK_STATUSES, TERMINAL_TASK_STATUSES, resolveTaskRole } from '../../entities/task';
import { patchParticipantStatus } from '../../entities/participant';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Options for controlling side effects during a task transition.
 */
export interface TransitionTaskOptions {
  /**
   * When true, skips writing the agent status event to chatroom_eventStream
   * and skips updating the participant's lastStatus via patchParticipantStatus.
   *
   * Use this when the task is being externally force-completed (e.g. from the UI)
   * and the actual agent process may still be running. Emitting status events in
   * this case would mislead the UI — the agent will update its own status naturally
   * when it calls get-next-task again or when it crashes and exits.
   */
  skipAgentStatusUpdate?: boolean;
}

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
 * @param options - Optional behavior flags (e.g. skipAgentStatusUpdate)
 */
export async function transitionTask(
  ctx: MutationCtx,
  taskId: Id<'chatroom_tasks'>,
  newStatus: TaskStatus,
  trigger: string,
  overrides?: Partial<Task>,
  options?: TransitionTaskOptions
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
      const completedRole = eventTask.assignedTo ?? 'unknown';

      // Always emit task.completed — it's the authoritative terminal-transition event.
      // When skipAgentStatusUpdate is requested (e.g. force-complete from UI), include
      // the flag on the event so consumers know agent status should NOT be derived from it.
      // The actual agent process may still be running and will update status naturally.
      await ctx.db.insert('chatroom_eventStream', {
        type: 'task.completed',
        chatroomId: eventTask.chatroomId,
        taskId,
        role: completedRole,
        finalStatus: newStatus,
        timestamp: Date.now(),
        ...(options?.skipAgentStatusUpdate && { skipAgentStatusUpdate: true }),
      });

      // Only update participant lastStatus when NOT skipping agent status.
      // patchParticipantStatus writes to the participant record which drives the UI.
      // For force-complete, we skip this so the UI reflects the real agent state
      // rather than the externally-forced completion.
      if (!options?.skipAgentStatusUpdate) {
        if (eventTask.assignedTo) {
          await patchParticipantStatus(ctx, eventTask.chatroomId, eventTask.assignedTo, 'task.completed');
        }
      }
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

  // Note: Agent restart for active tasks is now handled by the daemon's task monitor.
  // No backend scheduling needed here.
}

// Re-export the TaskStatus type so callers only need one import path
export type { TaskStatus } from '../../../../convex/lib/taskStateMachine';
