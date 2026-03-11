/**
 * create-task usecase
 *
 * Single entry point for all task creation in a chatroom.
 * Encapsulates status determination (pending vs backlog)
 * and DB insertion.
 *
 * Callers:
 *   - messages.ts _sendMessageHandler (user message tasks, only for pending)
 *   - messages.ts _handoffHandler (handoff tasks)
 *   - tasks.ts createTask mutation (direct task creation)
 *   - promote-queued-message.ts (creates task at promotion time)
 *
 * Note: Queued messages (chatroom_messageQueue) no longer create tasks at send time.
 * Tasks for queued messages are created at promotion time in promote-queued-message.ts.
 */

import { internal } from '../../../../convex/_generated/api';
import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import { ENSURE_AGENT_FALLBACK_DELAY_MS } from '../../../../config/reliability';
import { getTeamEntryPoint } from '../../entities/team';
import { tryStartAgentForTask } from '../agent/try-start-agent-for-task';

export interface CreateTaskArgs {
  chatroomId: Id<'chatroom_rooms'>;
  createdBy: string;
  content: string;
  /** If provided, forces this status instead of auto-detecting pending vs backlog */
  forceStatus?: 'pending' | 'backlog';
  assignedTo?: string;
  sourceMessageId?: Id<'chatroom_messages'>;
  attachedTaskIds?: Id<'chatroom_tasks'>[];
  queuePosition: number;
  origin?: 'chat' | 'backlog';
}

export interface CreateTaskResult {
  taskId: Id<'chatroom_tasks'>;
  status: 'pending' | 'backlog';
}

/**
 * Returns true if the incoming user message should be staged in chatroom_messageQueue
 * (because an active task is already running), or false if it should be sent directly
 * to chatroom_messages with a new task created immediately.
 *
 * A chatroom is considered "busy" when any task is in one of these states:
 * - 'pending': task created but not yet claimed by an agent
 * - 'acknowledged': agent called get-next-task (pending → acknowledged); task is being
 *   processed — the agent will call task-started imminently. This state MUST be included
 *   to prevent user messages from slipping through during the claim→start window.
 * - 'in_progress': agent called task-started; actively working
 */
export async function shouldEnqueueMessage(
  ctx: MutationCtx,
  chatroomId: Id<'chatroom_rooms'>
): Promise<boolean> {
  const activeTask = await ctx.db
    .query('chatroom_tasks')
    .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
    .filter((q) =>
      q.or(
        q.eq(q.field('status'), 'pending'),
        q.eq(q.field('status'), 'acknowledged'),
        q.eq(q.field('status'), 'in_progress')
      )
    )
    .first();
  return !!activeTask;
}

/**
 * Creates a new task in the chatroom.
 * Status is auto-detected unless forceStatus is provided.
 */
export async function createTask(
  ctx: MutationCtx,
  args: CreateTaskArgs
): Promise<CreateTaskResult> {
  const now = Date.now();

  // Determine status: pending or backlog (never queued — queue messages are separate)
  let status: 'pending' | 'backlog';
  if (args.forceStatus === 'backlog') {
    status = 'backlog';
  } else if (args.forceStatus === 'pending') {
    status = 'pending';
  } else {
    // Auto-detect: always pending for direct task creation (caller handles queuing via messageQueue)
    status = 'pending';
  }

  const taskId = await ctx.db.insert('chatroom_tasks', {
    chatroomId: args.chatroomId,
    createdBy: args.createdBy,
    content: args.content,
    status,
    origin: args.origin ?? 'chat',
    sourceMessageId: args.sourceMessageId,
    createdAt: now,
    updatedAt: now,
    queuePosition: args.queuePosition,
    assignedTo: args.assignedTo,
    ...(args.attachedTaskIds &&
      args.attachedTaskIds.length > 0 && {
        attachedTaskIds: args.attachedTaskIds,
      }),
  });

  // Schedule ensure-agent check for pending tasks
  if (status === 'pending') {
    await ctx.scheduler.runAfter(ENSURE_AGENT_FALLBACK_DELAY_MS, internal.ensureAgentHandler.check, {
      taskId,
      chatroomId: args.chatroomId,
      snapshotUpdatedAt: now,
    });

    // Write task.activated event to stream
    let role = args.assignedTo;
    if (!role) {
      const chatroom = await ctx.db.get('chatroom_rooms', args.chatroomId);
      role = getTeamEntryPoint(chatroom ?? {}) ?? 'unknown';
    }
    await ctx.db.insert('chatroom_eventStream', {
      type: 'task.activated',
      chatroomId: args.chatroomId,
      taskId,
      role,
      taskStatus: 'pending',
      taskContent: args.content,
      timestamp: now,
    });

    // Immediate agent start: if no agent is running for this role, try to start one now.
    // This is a best-effort one-time trigger — the ensureAgentHandler fallback above
    // still fires as a safety net.
    await tryStartAgentForTask(ctx, {
      chatroomId: args.chatroomId,
      role,
    });
  }

  return { taskId, status };
}
