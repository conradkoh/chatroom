import { ConvexError, v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import {
  NON_FATAL_ERROR_CODES,
  type BackendError,
  type BackendErrorCode,
} from '../config/errorCodes';
import { DAEMON_HEARTBEAT_TTL_MS, RECOVERY_GRACE_PERIOD_MS } from '../config/reliability';
import { internalMutation, mutation, query } from './_generated/server';
import {
  areAllAgentsIdle,
  getAndIncrementQueuePosition,
  requireChatroomAccess,
  validateSession,
} from './auth/cliSessionAuth';
import { transitionTask } from './lib/taskStateMachine';

/**
 * Maximum number of active tasks per chatroom.
 * Active = pending + in_progress + queued + backlog (excludes completed/closed)
 */
const MAX_ACTIVE_TASKS = 100;

/**
 * Maximum number of tasks to return in list queries.
 * This is a server-side limit to prevent excessive data transfer.
 */
const MAX_TASK_LIST_LIMIT = 100;

/**
 * Create a new task in a chatroom.
 * If isBacklog is true, creates a backlog task.
 * Otherwise, creates as pending if no pending/in_progress exists, else queued.
 * Enforces 100 active task limit.
 * Requires CLI session authentication and chatroom access.
 */
export const createTask = mutation({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    content: v.string(),
    createdBy: v.string(),
    isBacklog: v.optional(v.boolean()),
    sourceMessageId: v.optional(v.id('chatroom_messages')),
  },
  handler: async (ctx, args) => {
    // Validate session and check chatroom access - need chatroom for queue position
    const { chatroom } = await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

    // Check active task limit
    const activeTasks = await ctx.db
      .query('chatroom_tasks')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', args.chatroomId))
      .filter((q) =>
        q.and(q.neq(q.field('status'), 'completed'), q.neq(q.field('status'), 'closed'))
      )
      .collect();

    if (activeTasks.length >= MAX_ACTIVE_TASKS) {
      throw new Error(
        `Task limit reached (${MAX_ACTIVE_TASKS}). Complete or cancel existing tasks before adding more.`
      );
    }

    // Get next queue position atomically (prevents race conditions)
    const queuePosition = await getAndIncrementQueuePosition(ctx, chatroom);

    const now = Date.now();

    // Determine status
    let status: 'pending' | 'queued' | 'backlog';
    if (args.isBacklog) {
      status = 'backlog';
    } else {
      // Check if any task is pending or in_progress
      const hasPendingOrInProgress = activeTasks.some(
        (t) => t.status === 'pending' || t.status === 'in_progress'
      );
      status = hasPendingOrInProgress ? 'queued' : 'pending';
    }

    // Set origin field based on whether this is a backlog task
    const origin = args.isBacklog ? ('backlog' as const) : ('chat' as const);

    const taskId = await ctx.db.insert('chatroom_tasks', {
      chatroomId: args.chatroomId,
      createdBy: args.createdBy,
      content: args.content,
      status,
      origin,
      sourceMessageId: args.sourceMessageId,
      createdAt: now,
      updatedAt: now,
      queuePosition,
    });

    return { taskId, status, queuePosition, origin };
  },
});

/**
 * Claim a pending task (acknowledge it without starting work yet).
 * Transitions: pending → acknowledged
 * This is called by wait-for-task to reserve a task for an agent.
 * Requires CLI session authentication and chatroom access.
 */
export const claimTask = mutation({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    role: v.string(),
    taskId: v.optional(v.id('chatroom_tasks')),
  },
  handler: async (ctx, args) => {
    // Validate session and check chatroom access (chatroom not needed)
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

    const chatroom = await ctx.db.get('chatroom_rooms', args.chatroomId);
    if (!chatroom) {
      throw new Error('Chatroom not found');
    }

    const normalizedRole = args.role.toLowerCase();
    const normalizedEntryPoint = (chatroom.teamEntryPoint || 'builder').toLowerCase();
    const isRelevantForRole = (task: { assignedTo?: string; createdBy: string }) => {
      if (task.assignedTo) {
        return task.assignedTo.toLowerCase() === normalizedRole;
      }
      return normalizedRole === normalizedEntryPoint;
    };

    let pendingTask;
    if (args.taskId) {
      pendingTask = await ctx.db.get('chatroom_tasks', args.taskId);
      if (!pendingTask) {
        throw new Error('Task not found');
      }
      if (pendingTask.chatroomId !== args.chatroomId) {
        throw new Error('Task does not belong to this chatroom');
      }
      if (pendingTask.status !== 'pending') {
        throw new Error(`Task must be pending to claim (current status: ${pendingTask.status})`);
      }
      if (!isRelevantForRole(pendingTask)) {
        throw new Error(`Task is not claimable by role ${args.role}`);
      }
    } else {
      // Legacy behavior: find a pending task relevant for this role.
      const pendingTasks = await ctx.db
        .query('chatroom_tasks')
        .withIndex('by_chatroom_status', (q) =>
          q.eq('chatroomId', args.chatroomId).eq('status', 'pending')
        )
        .collect();

      pendingTask = pendingTasks
        .filter(isRelevantForRole)
        .sort((a, b) => a.queuePosition - b.queuePosition)[0];

      if (!pendingTask) {
        throw new Error('No pending task to claim');
      }
    }

    const now = Date.now();

    // Transition: pending → acknowledged using FSM
    await transitionTask(ctx, pendingTask._id, 'acknowledged', 'claimTask', {
      assignedTo: args.role,
    });

    // Set acknowledgedAt on the source message (if not already set)
    if (pendingTask.sourceMessageId) {
      const sourceMessage = await ctx.db.get('chatroom_messages', pendingTask.sourceMessageId);
      if (sourceMessage && !sourceMessage.acknowledgedAt) {
        await ctx.db.patch('chatroom_messages', pendingTask.sourceMessageId, {
          acknowledgedAt: now,
        });
      }
    }

    return { taskId: pendingTask._id, content: pendingTask.content };
  },
});

/**
 * Start working on an acknowledged task.
 * Transitions: acknowledged → in_progress
 * This is called when agent begins actual work (sends task-started message).
 * Requires CLI session authentication and chatroom access.
 */
export const startTask = mutation({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    role: v.string(),
    taskId: v.optional(v.id('chatroom_tasks')), // Optional: specific task to start
  },
  handler: async (ctx, args) => {
    // Validate session and check chatroom access (chatroom not needed)
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

    let acknowledgedTask;

    if (args.taskId) {
      // Start a specific task (used by task-started command)
      acknowledgedTask = await ctx.db.get('chatroom_tasks', args.taskId);

      if (!acknowledgedTask) {
        throw new Error(`Task ${args.taskId} not found`);
      }

      if (acknowledgedTask.chatroomId !== args.chatroomId) {
        throw new Error('Task does not belong to this chatroom');
      }

      if (acknowledgedTask.status !== 'acknowledged') {
        throw new Error(
          `Task must be acknowledged to start (current status: ${acknowledgedTask.status})`
        );
      }

      if (acknowledgedTask.assignedTo !== args.role) {
        throw new Error(`Task is assigned to ${acknowledgedTask.assignedTo}, not ${args.role}`);
      }
    } else {
      // Find any acknowledged task for this role (legacy behavior)
      acknowledgedTask = await ctx.db
        .query('chatroom_tasks')
        .withIndex('by_chatroom_status', (q) =>
          q.eq('chatroomId', args.chatroomId).eq('status', 'acknowledged')
        )
        .filter((q) => q.eq(q.field('assignedTo'), args.role))
        .first();

      if (!acknowledgedTask) {
        throw new Error('No acknowledged task to start for this role');
      }
    }

    // Transition: acknowledged → in_progress using FSM

    await transitionTask(ctx, acknowledgedTask._id, 'in_progress', 'startTask');

    return { taskId: acknowledgedTask._id, content: acknowledgedTask.content };
  },
});

/**
 * Complete ALL in_progress tasks in the chatroom.
 * For backlog-origin tasks: transitions to pending_user_review (user must confirm).
 * For chat-origin tasks: transitions to completed directly.
 * Promotes the next queued task to pending when all agents are ready.
 * Requires CLI session authentication and chatroom access.
 */
export const completeTask = mutation({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    role: v.string(),
  },
  handler: async (ctx, args) => {
    // Validate session and check chatroom access (chatroom not needed)
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

    // Find ALL in_progress and acknowledged tasks (there should typically be only one, but complete all for resilience)
    const [inProgressTasks, acknowledgedTasks] = await Promise.all([
      ctx.db
        .query('chatroom_tasks')
        .withIndex('by_chatroom_status', (q) =>
          q.eq('chatroomId', args.chatroomId).eq('status', 'in_progress')
        )
        .collect(),
      ctx.db
        .query('chatroom_tasks')
        .withIndex('by_chatroom_status', (q) =>
          q.eq('chatroomId', args.chatroomId).eq('status', 'acknowledged')
        )
        .collect(),
    ]);
    const allTasksToComplete = [...inProgressTasks, ...acknowledgedTasks];

    if (allTasksToComplete.length === 0) {
      // No tasks to complete - this is okay, just return
      return { completed: false, completedCount: 0, promoted: null, pendingReview: [] };
    }

    const pendingReview: string[] = [];

    // Load FSM once for all transitions

    // Complete ALL tasks (in_progress + acknowledged) based on their origin
    for (const task of allTasksToComplete) {
      // Determine the new status based on origin:
      // - backlog-origin tasks → pending_user_review (user must confirm completion)
      // - chat-origin tasks → completed
      const newStatus: 'pending_user_review' | 'completed' =
        task.origin === 'backlog' ? 'pending_user_review' : 'completed';

      // Use FSM for transition
      await transitionTask(ctx, task._id, newStatus, 'completeTask');

      if (newStatus === 'pending_user_review') {
        pendingReview.push(task._id);
      }
    }

    // Log if multiple tasks were completed (indicates a stuck state that was cleaned up)
    if (allTasksToComplete.length > 1) {
      console.warn(
        `[Task Cleanup] Processed ${allTasksToComplete.length} tasks (in_progress + acknowledged) in chatroom ${args.chatroomId}. ` +
          `Task IDs: ${allTasksToComplete.map((t) => t._id).join(', ')}, Pending review: ${pendingReview.length}`
      );
    }

    // Only promote from queue if all agents are idle (waiting for task)
    // This ensures the entry point can pick up the next task from the queue
    const allAgentsIdle = await areAllAgentsIdle(ctx, args.chatroomId);

    if (allAgentsIdle) {
      // Find the oldest queued task to promote
      const queuedTasks = await ctx.db
        .query('chatroom_tasks')
        .withIndex('by_chatroom_status', (q) =>
          q.eq('chatroomId', args.chatroomId).eq('status', 'queued')
        )
        .collect();

      // Sort by queuePosition to get oldest
      queuedTasks.sort((a, b) => a.queuePosition - b.queuePosition);
      const nextTask = queuedTasks[0];

      if (nextTask) {
        await transitionTask(ctx, nextTask._id, 'pending', 'promoteNextTask');
        return {
          completed: true,
          completedCount: allTasksToComplete.length,
          promoted: nextTask._id,
          pendingReview,
        };
      }
    } else {
      console.warn(
        `[Task Complete] Skipping queue promotion - some agents are not yet idle in chatroom ${args.chatroomId}`
      );
    }

    return {
      completed: true,
      completedCount: allTasksToComplete.length,
      promoted: null,
      pendingReview,
    };
  },
});

/**
 * Cancel a task.
 * Allowed for pending, acknowledged, queued, backlog, backlog_acknowledged, pending_user_review, and in_progress tasks.
 * For in_progress tasks, requires force: true to prevent accidental cancellation.
 * If a pending task is cancelled, promotes the next queued task.
 * Uses 'closed' status for all cancelled tasks.
 * Requires CLI session authentication and chatroom access.
 */
export const cancelTask = mutation({
  args: {
    ...SessionIdArg,
    taskId: v.id('chatroom_tasks'),
    force: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const task = await ctx.db.get('chatroom_tasks', args.taskId);
    if (!task) {
      throw new Error('Task not found');
    }

    // Validate session and check chatroom access (chatroom not needed)
    await requireChatroomAccess(ctx, args.sessionId, task.chatroomId);

    // Allow cancellation of most task statuses except completed/closed
    // For in_progress tasks, require force flag to prevent accidental cancellation
    const allowedStatuses = [
      'pending',
      'acknowledged',
      'queued',
      'backlog',
      'backlog_acknowledged',
      'pending_user_review',
      'in_progress',
    ];
    if (!allowedStatuses.includes(task.status)) {
      throw new Error(`Cannot cancel task with status: ${task.status}`);
    }

    // For in_progress tasks, require force flag
    if (task.status === 'in_progress' && !args.force) {
      throw new Error(
        `Task is in_progress. This task is currently being worked on. ` +
          `Use --force to cancel an active task.`
      );
    }

    const wasPending = task.status === 'pending';
    const wasInProgress = task.status === 'in_progress';

    // Use FSM for transition

    await transitionTask(ctx, args.taskId, 'closed', 'cancelTask');

    // Log force cancellation for in_progress tasks
    if (wasInProgress) {
      console.warn(
        `[Force Cancel] Task ${args.taskId} force-cancelled from in_progress. ` +
          `Content: "${task.content.substring(0, 50)}${task.content.length > 50 ? '...' : ''}"`
      );
    }

    // If we cancelled a pending or in_progress task, promote the next queued task only if all agents are idle
    let promoted = null;
    if (wasPending || wasInProgress) {
      const allAgentsIdle = await areAllAgentsIdle(ctx, task.chatroomId);

      if (allAgentsIdle) {
        const queuedTasks = await ctx.db
          .query('chatroom_tasks')
          .withIndex('by_chatroom_status', (q) =>
            q.eq('chatroomId', task.chatroomId).eq('status', 'queued')
          )
          .collect();

        if (queuedTasks.length > 0) {
          // Sort by queuePosition to get oldest
          queuedTasks.sort((a, b) => a.queuePosition - b.queuePosition);
          const nextTask = queuedTasks[0];

          await transitionTask(ctx, nextTask._id, 'pending', 'promoteNextTask');

          // Log the automatic promotion
          console.warn(
            `[Queue Promotion] Auto-promoted task ${nextTask._id} after cancellation of ${task.status} task ${args.taskId}. ` +
              `Content: "${nextTask.content.substring(0, 50)}${nextTask.content.length > 50 ? '...' : ''}"`
          );

          promoted = nextTask._id;
        }
      } else {
        console.warn(
          `[Queue Promotion Deferred] Cancelled ${task.status} task ${args.taskId} but some agents are not yet idle. ` +
            `Queue promotion deferred until all agents are idle.`
        );
      }
    }

    return { success: true, promoted, status: 'closed' };
  },
});

/**
 * Complete a specific task by ID.
 * Allowed for backlog, queued, pending, and in_progress tasks.
 * For pending/in_progress tasks, use `force: true` to complete and auto-promote the next queued task.
 * Requires CLI session authentication and chatroom access.
 */
export const completeTaskById = mutation({
  args: {
    ...SessionIdArg,
    taskId: v.id('chatroom_tasks'),
    force: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const task = await ctx.db.get('chatroom_tasks', args.taskId);
    if (!task) {
      throw new Error('Task not found');
    }

    // Validate session and check chatroom access (chatroom not needed)
    await requireChatroomAccess(ctx, args.sessionId, task.chatroomId);

    // For active tasks (pending, in_progress, acknowledged, backlog_acknowledged), require force flag
    if (
      task.status === 'pending' ||
      task.status === 'in_progress' ||
      task.status === 'acknowledged' ||
      task.status === 'backlog_acknowledged'
    ) {
      if (!args.force) {
        throw new Error(
          `Task is ${task.status}. Use --force to complete an active task. ` +
            `This will mark it as completed and promote the next queued task.`
        );
      }

      // Use FSM for transition

      await transitionTask(ctx, args.taskId, 'completed', 'completeTaskById');

      // Log force completion (suppress during testing)
      if (process.env.NODE_ENV !== 'test') {
        console.warn(
          `[Force Complete] Task ${args.taskId} force-completed from ${task.status}. ` +
            `Content: "${task.content.substring(0, 50)}${task.content.length > 50 ? '...' : ''}"`
        );
      }

      // Auto-promote the next queued task only if all agents are idle
      let promoted = null;
      const allAgentsIdle = await areAllAgentsIdle(ctx, task.chatroomId);

      if (allAgentsIdle) {
        const queuedTasks = await ctx.db
          .query('chatroom_tasks')
          .withIndex('by_chatroom_status', (q) =>
            q.eq('chatroomId', task.chatroomId).eq('status', 'queued')
          )
          .collect();

        if (queuedTasks.length > 0) {
          // Sort by queuePosition to get oldest
          queuedTasks.sort((a, b) => a.queuePosition - b.queuePosition);
          const nextTask = queuedTasks[0];

          await transitionTask(ctx, nextTask._id, 'pending', 'promoteNextTask');

          console.warn(
            `[Queue Promotion] Auto-promoted task ${nextTask._id} after force-completing ${args.taskId}. ` +
              `Content: "${nextTask.content.substring(0, 50)}${nextTask.content.length > 50 ? '...' : ''}"`
          );

          promoted = nextTask._id;
        }
      } else {
        console.warn(
          `[Queue Promotion Deferred] Force-completed task ${args.taskId} but some agents are not yet idle. ` +
            `Queue promotion deferred until all agents are idle.`
        );
      }

      return { success: true, taskId: args.taskId, promoted, wasForced: true };
    }

    // For backlog and queued tasks, complete normally (no promotion needed)
    if (task.status !== 'backlog' && task.status !== 'queued') {
      throw new Error(
        `Cannot complete task with status: ${task.status}. Only backlog, queued, pending, in_progress, acknowledged, and backlog_acknowledged tasks can be completed.`
      );
    }

    await transitionTask(ctx, args.taskId, 'completed', 'completeTaskById');

    return { success: true, taskId: args.taskId, promoted: null, wasForced: false };
  },
});

/**
 * Update a task's content.
 * Only allowed for queued and backlog tasks.
 * Requires CLI session authentication and chatroom access.
 */
export const updateTask = mutation({
  args: {
    ...SessionIdArg,
    taskId: v.id('chatroom_tasks'),
    content: v.string(),
  },
  handler: async (ctx, args) => {
    const task = await ctx.db.get('chatroom_tasks', args.taskId);
    if (!task) {
      throw new Error('Task not found');
    }

    // Validate session and check chatroom access (chatroom not needed)
    await requireChatroomAccess(ctx, args.sessionId, task.chatroomId);

    // Only allow editing of queued, backlog, pending, acknowledged, and backlog_acknowledged tasks
    if (
      !['queued', 'backlog', 'pending', 'acknowledged', 'backlog_acknowledged'].includes(
        task.status
      )
    ) {
      throw new Error(`Cannot edit task with status: ${task.status}`);
    }

    await ctx.db.patch('chatroom_tasks', args.taskId, {
      content: args.content,
      updatedAt: Date.now(),
    });

    return { success: true };
  },
});

/**
 * Move a backlog task to the queue (chat).
 * Optionally specify a custom message to send instead of the task content.
 * Requires CLI session authentication and chatroom access.
 */
export const moveToQueue = mutation({
  args: {
    ...SessionIdArg,
    taskId: v.id('chatroom_tasks'),
    // Optional custom message to send instead of task content
    customMessage: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const task = await ctx.db.get('chatroom_tasks', args.taskId);
    if (!task) {
      throw new Error('Task not found');
    }

    // Validate session and check chatroom access - need chatroom for entry point
    const { chatroom } = await requireChatroomAccess(ctx, args.sessionId, task.chatroomId);

    // Allow moving:
    // 1. Backlog tasks (status === 'backlog')
    // 2. Pending review tasks (status === 'pending_user_review')
    const isBacklogTask = task.status === 'backlog';
    const isPendingReview = task.status === 'pending_user_review';

    if (!isBacklogTask && !isPendingReview) {
      throw new Error(
        'Can only move backlog tasks or pending review tasks to queue. ' +
          'Task must have status "backlog" or "pending_user_review".'
      );
    }

    // Check if there's a pending or in_progress task
    const activeTasks = await ctx.db
      .query('chatroom_tasks')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', task.chatroomId))
      .filter((q) =>
        q.or(q.eq(q.field('status'), 'pending'), q.eq(q.field('status'), 'in_progress'))
      )
      .collect();

    // If no pending/in_progress, this becomes pending
    // Otherwise, it goes to the queue
    const newStatus: 'queued' | 'pending' = activeTasks.length > 0 ? 'queued' : 'pending';

    const now = Date.now();

    // Use custom message if provided, otherwise use task content
    const messageContent = args.customMessage?.trim() || task.content;

    // Create a message from 'user' with the message content
    // This makes the task visible in the chat message list
    const targetRole = chatroom.teamEntryPoint || chatroom.teamRoles?.[0] || 'builder';
    const messageId = await ctx.db.insert('chatroom_messages', {
      chatroomId: task.chatroomId,
      senderRole: 'user',
      content: messageContent,
      targetRole,
      type: 'message',
      // Always attach the backlog task for context
      attachedTaskIds: [args.taskId],
    });

    // Update task with new status and link to the message using FSM

    await transitionTask(ctx, args.taskId, newStatus, 'moveToQueue');

    // Update sourceMessageId separately (not part of FSM transition)
    await ctx.db.patch('chatroom_tasks', args.taskId, {
      sourceMessageId: messageId,
      updatedAt: now,
    });

    // Link message to task
    await ctx.db.patch('chatroom_messages', messageId, { taskId: args.taskId });

    // Update chatroom's lastActivityAt for sorting by recent activity
    await ctx.db.patch('chatroom_rooms', task.chatroomId, {
      lastActivityAt: now,
    });

    return { success: true, newStatus, messageId };
  },
});

/**
 * Mark a backlog task as complete.
 * User confirms the issue is resolved.
 * Allowed for:
 * - Tasks in 'pending_user_review' status (normal flow after agent completes)
 * - Tasks in 'backlog' status (force complete from backlog tab)
 * Requires CLI session authentication and chatroom access.
 */
export const markBacklogComplete = mutation({
  args: {
    ...SessionIdArg,
    taskId: v.id('chatroom_tasks'),
  },
  handler: async (ctx, args) => {
    const task = await ctx.db.get('chatroom_tasks', args.taskId);
    if (!task) {
      throw new Error('Task not found');
    }

    // Validate session and check chatroom access
    await requireChatroomAccess(ctx, args.sessionId, task.chatroomId);

    // Task must be a backlog-origin task
    if (task.origin !== 'backlog') {
      throw new Error('Task is not a backlog item');
    }

    // Cannot complete already completed/closed items
    if (task.status === 'completed' || task.status === 'closed') {
      throw new Error(`Task is already ${task.status}`);
    }

    // Allow completion from pending_user_review (normal flow), backlog (force complete),
    // or backlog_acknowledged (attached to message but needs force complete)
    if (
      task.status !== 'pending_user_review' &&
      task.status !== 'backlog' &&
      task.status !== 'backlog_acknowledged'
    ) {
      throw new Error(`Cannot complete task with status: ${task.status}`);
    }

    // Use FSM for transition

    await transitionTask(ctx, args.taskId, 'completed', 'markBacklogComplete');

    return { success: true };
  },
});

/**
 * Mark a backlog task as ready for user review.
 * Agent indicates they've completed work on this backlog item.
 * Only allowed for backlog-origin tasks in 'backlog' status.
 * Requires CLI session authentication and chatroom access.
 */
export const markBacklogForReview = mutation({
  args: {
    ...SessionIdArg,
    taskId: v.id('chatroom_tasks'),
  },
  handler: async (ctx, args) => {
    const task = await ctx.db.get('chatroom_tasks', args.taskId);
    if (!task) {
      throw new Error('Task not found');
    }

    // Validate session and check chatroom access
    await requireChatroomAccess(ctx, args.sessionId, task.chatroomId);

    // Task must be a backlog-origin task
    if (task.origin !== 'backlog') {
      throw new Error('Task is not a backlog item');
    }

    // Only allowed for tasks in 'backlog' status
    if (task.status !== 'backlog') {
      throw new Error(
        `Cannot mark task for review with status: ${task.status}. Task must be in 'backlog' status.`
      );
    }

    // Use FSM for transition
    await transitionTask(ctx, args.taskId, 'pending_user_review', 'markForReview');

    return { success: true };
  },
});

/**
 * Close a backlog task without completing.
 * Used for won't fix, duplicate, or no longer relevant items.
 * Only allowed for backlog-origin tasks.
 * Requires CLI session authentication and chatroom access.
 */
export const closeBacklogTask = mutation({
  args: {
    ...SessionIdArg,
    taskId: v.id('chatroom_tasks'),
  },
  handler: async (ctx, args) => {
    const task = await ctx.db.get('chatroom_tasks', args.taskId);
    if (!task) {
      throw new Error('Task not found');
    }

    // Validate session and check chatroom access
    await requireChatroomAccess(ctx, args.sessionId, task.chatroomId);

    // Task must be a backlog-origin task
    if (task.origin !== 'backlog') {
      throw new Error('Task is not a backlog item');
    }

    // Cannot close already completed/closed items
    if (task.status === 'completed' || task.status === 'closed') {
      throw new Error(`Task is already ${task.status}`);
    }

    // Use FSM for transition

    await transitionTask(ctx, args.taskId, 'closed', 'cancelTask');

    return { success: true };
  },
});

/**
 * Reopen a completed or closed backlog task.
 * Returns the task to pending_user_review status (ready for user to review again).
 * Only allowed for backlog-origin tasks.
 * Requires CLI session authentication and chatroom access.
 */
export const reopenBacklogTask = mutation({
  args: {
    ...SessionIdArg,
    taskId: v.id('chatroom_tasks'),
  },
  handler: async (ctx, args) => {
    const task = await ctx.db.get('chatroom_tasks', args.taskId);
    if (!task) {
      throw new Error('Task not found');
    }

    // Validate session and check chatroom access
    await requireChatroomAccess(ctx, args.sessionId, task.chatroomId);

    // Task must be a backlog-origin task
    if (task.origin !== 'backlog') {
      throw new Error('Task is not a backlog item');
    }

    // Can only reopen completed or closed items
    if (task.status !== 'completed' && task.status !== 'closed') {
      throw new Error(`Task is ${task.status}, not completed or closed`);
    }

    // Use FSM for transition

    await transitionTask(ctx, args.taskId, 'pending_user_review', 'reopenBacklogTask');

    return { success: true };
  },
});

/**
 * Send a task back for re-work.
 * Transitions task from pending_user_review back to the queue.
 * User can attach an optional message with feedback for the agent.
 * Only allowed for backlog-origin tasks in pending_user_review status.
 * Requires CLI session authentication and chatroom access.
 */
export const sendBackForRework = mutation({
  args: {
    ...SessionIdArg,
    taskId: v.id('chatroom_tasks'),
    // Optional feedback message for the agent
    feedback: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const task = await ctx.db.get('chatroom_tasks', args.taskId);
    if (!task) {
      throw new Error('Task not found');
    }

    // Validate session and check chatroom access
    const { chatroom } = await requireChatroomAccess(ctx, args.sessionId, task.chatroomId);

    // Task must be a backlog-origin task
    if (task.origin !== 'backlog') {
      throw new Error('Task is not a backlog item');
    }

    // Only allowed for tasks in pending_user_review status
    if (task.status !== 'pending_user_review') {
      throw new Error(
        `Cannot send back task with status: ${task.status}. Must be pending_user_review.`
      );
    }

    const now = Date.now();

    // Check if there's a pending or in_progress task
    const activeTasks = await ctx.db
      .query('chatroom_tasks')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', task.chatroomId))
      .filter((q) =>
        q.or(q.eq(q.field('status'), 'pending'), q.eq(q.field('status'), 'in_progress'))
      )
      .collect();

    // Determine new status: queued if active task exists, pending otherwise
    const newStatus: 'queued' | 'pending' = activeTasks.length > 0 ? 'queued' : 'pending';

    // If feedback provided, create a message from user
    let messageId = null;
    if (args.feedback?.trim()) {
      const targetRole = chatroom.teamEntryPoint || chatroom.teamRoles?.[0] || 'builder';
      messageId = await ctx.db.insert('chatroom_messages', {
        chatroomId: task.chatroomId,
        senderRole: 'user',
        content: args.feedback.trim(),
        targetRole,
        type: 'message',
        attachedTaskIds: [args.taskId],
      });

      // Update chatroom's lastActivityAt
      await ctx.db.patch('chatroom_rooms', task.chatroomId, {
        lastActivityAt: now,
      });
    }

    // Update task status back to queue using FSM

    await transitionTask(ctx, args.taskId, newStatus, 'sendBackForRework');

    // Update sourceMessageId separately (not part of FSM transition)
    await ctx.db.patch('chatroom_tasks', args.taskId, {
      sourceMessageId: messageId || task.sourceMessageId,
      updatedAt: now,
    });

    return { success: true, newStatus, messageId };
  },
});

/**
 * Patch a task's scoring fields (complexity, value, priority).
 * Idempotent - accepts all requests regardless of task status.
 * Designed for agents to score backlog tasks for prioritization.
 * Requires CLI session authentication and chatroom access.
 */
export const patchTask = mutation({
  args: {
    ...SessionIdArg,
    taskId: v.id('chatroom_tasks'),
    complexity: v.optional(v.union(v.literal('low'), v.literal('medium'), v.literal('high'))),
    value: v.optional(v.union(v.literal('low'), v.literal('medium'), v.literal('high'))),
    priority: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const task = await ctx.db.get('chatroom_tasks', args.taskId);
    if (!task) {
      throw new Error('Task not found');
    }

    // Validate session and check chatroom access
    await requireChatroomAccess(ctx, args.sessionId, task.chatroomId);

    // Build patch object with only provided fields
    const patch: {
      complexity?: 'low' | 'medium' | 'high';
      value?: 'low' | 'medium' | 'high';
      priority?: number;
      updatedAt: number;
    } = {
      updatedAt: Date.now(),
    };

    if (args.complexity !== undefined) {
      patch.complexity = args.complexity;
    }
    if (args.value !== undefined) {
      patch.value = args.value;
    }
    if (args.priority !== undefined) {
      patch.priority = args.priority;
    }

    await ctx.db.patch('chatroom_tasks', args.taskId, patch);

    return {
      success: true,
      taskId: args.taskId,
      updated: {
        complexity: args.complexity,
        value: args.value,
        priority: args.priority,
      },
    };
  },
});

/**
 * List tasks in a chatroom.
 * Optionally filter by status.
 * Backlog tasks are sorted by priority descending (higher = first), then by createdAt descending.
 * Tasks without priority sort to the end.
 * Requires CLI session authentication and chatroom access.
 */
export const listTasks = query({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    statusFilter: v.optional(
      v.union(
        v.literal('pending'),
        v.literal('in_progress'),
        v.literal('queued'),
        v.literal('backlog'),
        v.literal('completed'),
        v.literal('closed'),
        v.literal('pending_user_review'),
        v.literal('active'), // pending + acknowledged + in_progress + queued + backlog + backlog_acknowledged
        v.literal('pending_review'), // pending_user_review status
        v.literal('archived') // completed + closed
      )
    ),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    // Validate session and check chatroom access (chatroom not needed)
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

    let tasks = await ctx.db
      .query('chatroom_tasks')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', args.chatroomId))
      .collect();

    // Filter by status
    if (args.statusFilter) {
      if (args.statusFilter === 'active') {
        tasks = tasks.filter(
          (t) =>
            t.status === 'pending' ||
            t.status === 'acknowledged' ||
            t.status === 'in_progress' ||
            t.status === 'queued' ||
            t.status === 'backlog' ||
            t.status === 'backlog_acknowledged'
        );
      } else if (args.statusFilter === 'pending_review') {
        // Pending review: tasks in pending_user_review status
        tasks = tasks.filter((t) => t.status === 'pending_user_review');
      } else if (args.statusFilter === 'archived') {
        // Archived: completed or closed tasks
        tasks = tasks.filter((t) => t.status === 'completed' || t.status === 'closed');
      } else {
        tasks = tasks.filter((t) => t.status === args.statusFilter);
      }
    }

    // Sort based on filter type
    if (args.statusFilter === 'archived') {
      // Archived: sort by updatedAt descending
      tasks.sort((a, b) => b.updatedAt - a.updatedAt);
    } else if (args.statusFilter === 'backlog') {
      // Backlog: sort by priority descending (higher first), then by createdAt descending
      // Tasks without priority sort to the end
      tasks.sort((a, b) => {
        const aPriority = a.priority ?? -Infinity;
        const bPriority = b.priority ?? -Infinity;
        if (aPriority !== bPriority) {
          return bPriority - aPriority; // Higher priority first
        }
        return b.createdAt - a.createdAt; // Newer first as tiebreaker
      });
    } else {
      // Default: sort by queuePosition for active queue items
      tasks.sort((a, b) => a.queuePosition - b.queuePosition);
    }

    // Apply limit (capped at MAX_TASK_LIST_LIMIT)
    const limit = args.limit ? Math.min(args.limit, MAX_TASK_LIST_LIMIT) : MAX_TASK_LIST_LIMIT;
    return tasks.slice(0, limit);
  },
});

/**
 * List active tasks in a chatroom (all tasks that are not completed or closed).
 * Active tasks include: pending, acknowledged, in_progress, queued, backlog, backlog_acknowledged, pending_user_review.
 * Sorted by queuePosition ascending for active queue items.
 * No hard limit applied - returns all active tasks.
 * Requires CLI session authentication and chatroom access.
 */
export const listActiveTasks = query({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    // Validate session and check chatroom access
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

    // Get all tasks for this chatroom
    let tasks = await ctx.db
      .query('chatroom_tasks')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', args.chatroomId))
      .collect();

    // Filter for active tasks (not completed or closed)
    tasks = tasks.filter(
      (t) =>
        t.status === 'pending' ||
        t.status === 'acknowledged' ||
        t.status === 'in_progress' ||
        t.status === 'queued' ||
        t.status === 'backlog' ||
        t.status === 'backlog_acknowledged' ||
        t.status === 'pending_user_review'
    );

    // Sort by queuePosition for active queue items
    tasks.sort((a, b) => a.queuePosition - b.queuePosition);

    // Apply limit if specified
    if (args.limit) {
      return tasks.slice(0, args.limit);
    }

    return tasks;
  },
});

/**
 * List archived tasks in a chatroom (completed or closed tasks).
 * Sorted by updatedAt descending (most recently updated first).
 * No hard limit applied - returns all archived tasks.
 * Requires CLI session authentication and chatroom access.
 */
export const listArchivedTasks = query({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    // Validate session and check chatroom access
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

    // Get all tasks for this chatroom
    let tasks = await ctx.db
      .query('chatroom_tasks')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', args.chatroomId))
      .collect();

    // Filter for archived tasks (completed or closed)
    tasks = tasks.filter((t) => t.status === 'completed' || t.status === 'closed');

    // Sort by updatedAt descending (most recently updated first)
    tasks.sort((a, b) => b.updatedAt - a.updatedAt);

    // Apply limit if specified
    if (args.limit) {
      return tasks.slice(0, args.limit);
    }

    return tasks;
  },
});

/**
 * Get the active task (pending or in_progress).
 * Returns at most one task.
 * Requires CLI session authentication and chatroom access.
 */
export const getActiveTask = query({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
  },
  handler: async (ctx, args) => {
    // Validate session and check chatroom access (chatroom not needed)
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

    // First check for in_progress
    const inProgress = await ctx.db
      .query('chatroom_tasks')
      .withIndex('by_chatroom_status', (q) =>
        q.eq('chatroomId', args.chatroomId).eq('status', 'in_progress')
      )
      .first();

    if (inProgress) {
      return inProgress;
    }

    // Then check for pending
    const pending = await ctx.db
      .query('chatroom_tasks')
      .withIndex('by_chatroom_status', (q) =>
        q.eq('chatroomId', args.chatroomId).eq('status', 'pending')
      )
      .first();

    return pending || null;
  },
});

/**
 * Manually promote the next queued task to pending.
 * Use when the queue is stuck (queued tasks exist but no pending/in_progress).
 * Only promotes if all agents are ready (not active).
 * Logs when automatic promotion occurs.
 * Requires CLI session authentication and chatroom access.
 */
export const promoteNextTask = mutation({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
  },
  handler: async (ctx, args) => {
    // Validate session and check chatroom access (chatroom not needed)
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

    // Check if there's already a pending or in_progress task
    const activeTasks = await ctx.db
      .query('chatroom_tasks')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', args.chatroomId))
      .filter((q) =>
        q.or(q.eq(q.field('status'), 'pending'), q.eq(q.field('status'), 'in_progress'))
      )
      .collect();

    if (activeTasks.length > 0) {
      // Already have an active task - no promotion needed
      return { promoted: false, reason: 'active_task_exists', taskId: null };
    }

    // Check if all agents are idle (waiting for task)
    const allAgentsIdle = await areAllAgentsIdle(ctx, args.chatroomId);
    if (!allAgentsIdle) {
      return { promoted: false, reason: 'agents_not_idle', taskId: null };
    }

    // Find the oldest queued task to promote
    const queuedTasks = await ctx.db
      .query('chatroom_tasks')
      .withIndex('by_chatroom_status', (q) =>
        q.eq('chatroomId', args.chatroomId).eq('status', 'queued')
      )
      .collect();

    if (queuedTasks.length === 0) {
      // No queued tasks to promote
      return { promoted: false, reason: 'no_queued_tasks', taskId: null };
    }

    // Sort by queuePosition to get oldest
    queuedTasks.sort((a, b) => a.queuePosition - b.queuePosition);
    const nextTask = queuedTasks[0];

    // Use FSM for transition

    await transitionTask(ctx, nextTask._id, 'pending', 'promoteNextTask');

    // Log the promotion
    console.warn(
      `[Queue Promotion] Promoted task ${nextTask._id} to pending in chatroom ${args.chatroomId}. ` +
        `Content: "${nextTask.content.substring(0, 50)}${nextTask.content.length > 50 ? '...' : ''}"`
    );

    return { promoted: true, reason: 'success', taskId: nextTask._id };
  },
});

/**
 * Check queue health and promotion eligibility.
 * Returns queue status and whether promotion is possible.
 * Promotion requires: no active tasks AND all agents are ready (not active).
 * Requires CLI session authentication and chatroom access.
 */
export const checkQueueHealth = query({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
  },
  handler: async (ctx, args) => {
    // Validate session and check chatroom access (chatroom not needed)
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

    // Check for pending or in_progress tasks
    const activeTasks = await ctx.db
      .query('chatroom_tasks')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', args.chatroomId))
      .filter((q) =>
        q.or(q.eq(q.field('status'), 'pending'), q.eq(q.field('status'), 'in_progress'))
      )
      .collect();

    // Check for queued tasks
    const queuedTasks = await ctx.db
      .query('chatroom_tasks')
      .withIndex('by_chatroom_status', (q) =>
        q.eq('chatroomId', args.chatroomId).eq('status', 'queued')
      )
      .collect();

    // Check if all agents are idle (waiting for task)
    const allAgentsIdle = await areAllAgentsIdle(ctx, args.chatroomId);

    const hasActiveTask = activeTasks.length > 0;
    const hasQueuedTasks = queuedTasks.length > 0;
    // Promotion is possible only if no active tasks, there are queued tasks, AND all agents are idle
    const needsPromotion = !hasActiveTask && hasQueuedTasks && allAgentsIdle;

    return {
      hasActiveTask,
      queuedCount: queuedTasks.length,
      allAgentsReady: allAgentsIdle,
      needsPromotion,
    };
  },
});

/**
 * Get task counts by status.
 * Requires CLI session authentication and chatroom access.
 */
export const getTaskCounts = query({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
  },
  handler: async (ctx, args) => {
    // Validate session and check chatroom access (chatroom not needed)
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

    const tasks = await ctx.db
      .query('chatroom_tasks')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', args.chatroomId))
      .collect();

    return {
      pending: tasks.filter((t) => t.status === 'pending').length,
      acknowledged: tasks.filter((t) => t.status === 'acknowledged').length,
      in_progress: tasks.filter((t) => t.status === 'in_progress').length,
      queued: tasks.filter((t) => t.status === 'queued').length,
      backlog: tasks.filter((t) => t.status === 'backlog').length,
      backlog_acknowledged: tasks.filter((t) => t.status === 'backlog_acknowledged').length,
      pending_user_review: tasks.filter((t) => t.status === 'pending_user_review').length,
      completed: tasks.filter((t) => t.status === 'completed').length,
      closed: tasks.filter((t) => t.status === 'closed').length,
    };
  },
});

/**
 * Get all pending tasks for a role.
 * Returns a structured WaitForTaskResponse union type instead of throwing.
 * Used by wait-for-task to find work items.
 * Requires CLI session authentication and chatroom access.
 */
export const getPendingTasksForRole = query({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    role: v.string(),
    connectionId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    try {
      // Validate session and check chatroom access
      const { chatroom } = await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

      // Check for superseded connection before processing tasks
      if (args.connectionId) {
        const participant = await ctx.db
          .query('chatroom_participants')
          .withIndex('by_chatroom_and_role', (q) =>
            q.eq('chatroomId', args.chatroomId).eq('role', args.role)
          )
          .unique();

        if (participant?.connectionId && participant.connectionId !== args.connectionId) {
          return {
            type: 'superseded' as const,
            newConnectionId: participant.connectionId,
          };
        }
      }

      // Determine the entry point role for user messages
      const entryPoint = chatroom.teamEntryPoint || chatroom.teamRoles?.[0];
      const normalizedRole = args.role.toLowerCase();
      const normalizedEntryPoint = entryPoint?.toLowerCase();

      // Helper to check if a task is relevant for this role
      const isRelevantForRole = (task: { assignedTo?: string; createdBy: string }) => {
        if (task.assignedTo) {
          return task.assignedTo.toLowerCase() === normalizedRole;
        }
        if (task.createdBy === 'user') {
          return normalizedRole === normalizedEntryPoint;
        }
        return normalizedRole === normalizedEntryPoint;
      };

      // Get all pending tasks
      const pendingTasks = await ctx.db
        .query('chatroom_tasks')
        .withIndex('by_chatroom_status', (q) =>
          q.eq('chatroomId', args.chatroomId).eq('status', 'pending')
        )
        .collect();

      // Also get acknowledged tasks for recovery
      // An acknowledged task may be orphaned if the agent that claimed it died
      const acknowledgedTasks = await ctx.db
        .query('chatroom_tasks')
        .withIndex('by_chatroom_status', (q) =>
          q.eq('chatroomId', args.chatroomId).eq('status', 'acknowledged')
        )
        .collect();

      // Filter for tasks relevant to this role
      const relevantPending = pendingTasks.filter(isRelevantForRole);
      const relevantAcknowledged = acknowledgedTasks.filter(isRelevantForRole);

      // Combine: pending first, then acknowledged (pending tasks have priority)
      const relevantTasks = [...relevantPending, ...relevantAcknowledged];

      // Sort by queuePosition (oldest first)
      relevantTasks.sort((a, b) => a.queuePosition - b.queuePosition);

      // Check for grace period on acknowledged tasks
      if (relevantTasks.length > 0 && relevantTasks[0].status === 'acknowledged') {
        const task = relevantTasks[0];
        const acknowledgedAt = task.acknowledgedAt ?? task._creationTime;
        const elapsedMs = Date.now() - acknowledgedAt;

        if (elapsedMs < RECOVERY_GRACE_PERIOD_MS) {
          const remainingMs = RECOVERY_GRACE_PERIOD_MS - elapsedMs;
          return {
            type: 'grace_period' as const,
            taskId: task._id as string,
            remainingMs,
          };
        }
      }

      // No tasks found
      if (relevantTasks.length === 0) {
        return { type: 'no_tasks' as const };
      }

      // For each task, get the source message if available
      const tasksWithMessages = await Promise.all(
        relevantTasks.map(async (task) => {
          let message = null;
          if (task.sourceMessageId) {
            message = await ctx.db.get('chatroom_messages', task.sourceMessageId);
          }
          return { task, message };
        })
      );

      return { type: 'tasks' as const, tasks: tasksWithMessages };
    } catch (error) {
      if (error instanceof ConvexError) {
        const data = error.data as BackendError;
        const isFatal = !NON_FATAL_ERROR_CODES.includes(data.code);
        return {
          type: 'error' as const,
          code: data.code,
          message: data.message,
          fatal: isFatal,
        };
      }
      // Unknown error — treat as fatal
      return {
        type: 'error' as const,
        code: 'SESSION_INVALID' as BackendErrorCode,
        message: (error as Error).message || 'Unknown error',
        fatal: true,
      };
    }
  },
});

/**
 * Get tasks by their IDs.
 * Used by CLI to fetch full task details for attached tasks in messages.
 * Requires CLI session authentication.
 */
export const getTasksByIds = query({
  args: {
    ...SessionIdArg,
    taskIds: v.array(v.id('chatroom_tasks')),
  },
  handler: async (ctx, args) => {
    // Validate session using the standard helper
    const sessionResult = await validateSession(ctx, args.sessionId);
    if (!sessionResult.valid) {
      return [];
    }

    // Fetch tasks by ID first, then enforce chatroom-level access before returning data.
    const fetchedTasks = (
      await Promise.all(args.taskIds.map((taskId) => ctx.db.get('chatroom_tasks', taskId)))
    ).filter((task): task is NonNullable<typeof task> => task !== null);

    const uniqueChatroomIds = [...new Set(fetchedTasks.map((task) => task.chatroomId))];
    const allowedChatroomIds = new Set<string>();
    await Promise.all(
      uniqueChatroomIds.map(async (chatroomId) => {
        try {
          await requireChatroomAccess(ctx, args.sessionId, chatroomId);
          allowedChatroomIds.add(chatroomId);
        } catch {
          // Skip unauthorized chatrooms instead of leaking task details.
        }
      })
    );

    return fetchedTasks
      .filter((task) => allowedChatroomIds.has(task.chatroomId))
      .map((task) => ({
        _id: task._id,
        content: task.content,
        status: task.status,
        origin: task.origin,
        createdAt: task.createdAt,
        createdBy: task.createdBy,
      }));
  },
});

/**
 * Get a single task by ID.
 * Used by CLI to fetch task details efficiently without listing all tasks.
 * Requires CLI session authentication and validates task belongs to specified chatroom.
 */
export const getTask = query({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    taskId: v.id('chatroom_tasks'),
  },
  handler: async (ctx, args) => {
    // Validate session and chatroom access
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

    // Fetch the task directly by ID
    const task = await ctx.db.get('chatroom_tasks', args.taskId);
    if (!task) {
      return null;
    }

    // Verify task belongs to the specified chatroom
    if (task.chatroomId !== args.chatroomId) {
      return null;
    }

    return {
      _id: task._id,
      content: task.content,
      status: task.status,
      origin: task.origin,
      createdAt: task.createdAt,
      createdBy: task.createdBy,
    };
  },
});

/**
 * Get task system limits.
 * Returns the configured limits for task operations.
 * This allows clients to use the same limits as the server.
 */
export const getTaskLimits = query({
  args: {},
  handler: async () => {
    return {
      maxActiveTasks: MAX_ACTIVE_TASKS,
      maxTaskListLimit: MAX_TASK_LIST_LIMIT,
    };
  },
});

/**
 * Internal mutation to clean up stale daemon records.
 * Called by cron job every 2 minutes.
 *
 * Agent participant cleanup via FSM has been removed — liveness is now
 * determined purely by `lastSeenAt` in the UI/queries. Acknowledged task
 * recovery has also been removed: agents are expected to call task-started
 * and then handoff normally; no background reset is needed.
 *
 * This mutation only:
 *  1. Marks daemons as disconnected when their heartbeat is stale.
 */
export const cleanupStaleMachines = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();

    // ─── Stale Daemon Detection ─────────────────────────────────────────
    // Check for daemons that stopped sending heartbeats (e.g. SIGKILL, machine crash).
    const allMachines = await ctx.db.query('chatroom_machines').collect();
    let staleDaemonCount = 0;

    for (const machine of allMachines) {
      if (!machine.daemonConnected) continue;

      const timeSinceLastSeen = now - machine.lastSeenAt;
      if (timeSinceLastSeen > DAEMON_HEARTBEAT_TTL_MS) {
        await ctx.db.patch('chatroom_machines', machine._id, {
          daemonConnected: false,
        });
        staleDaemonCount++;
        console.warn(
          `[Daemon Cleanup] Machine "${machine.hostname}" (${machine.machineId}) daemon marked disconnected — last seen ${timeSinceLastSeen}ms ago`
        );
      }
    }

    if (staleDaemonCount > 0) {
      console.warn(`[Daemon Cleanup] Marked ${staleDaemonCount} stale daemon(s) as disconnected`);
    }
  },
});
