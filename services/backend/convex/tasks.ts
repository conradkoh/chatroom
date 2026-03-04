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
  areAllAgentsWaiting,
  getAndIncrementQueuePosition,
  requireChatroomAccess,
  validateSession,
} from './auth/cliSessionAuth';
import { createTask as createTaskUsecase } from '../src/domain/usecase/task/create-task';
import { promoteNextTask as promoteNextTaskUsecase } from '../src/domain/usecase/task/promote-next-task';
import { promoteQueuedMessage } from '../src/domain/usecase/task/promote-queued-message';
import { transitionTask } from '../src/domain/usecase/task/transition-task';
import { getTeamEntryPoint } from '../src/domain/entities/team';

/** Maximum number of active tasks per chatroom. */
const MAX_ACTIVE_TASKS = 100;

/** Maximum number of tasks to return in list queries. */
const MAX_TASK_LIST_LIMIT = 100;

/** Creates a new task in a chatroom (pending, queued, or backlog). */
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

    const { taskId } = await createTaskUsecase(ctx, {
      chatroomId: args.chatroomId,
      createdBy: args.createdBy,
      content: args.content,
      forceStatus: status,
      sourceMessageId: args.sourceMessageId,
      queuePosition,
      origin,
    });

    return { taskId, status, queuePosition, origin };
  },
});

/** Claims a pending task for a role (pending → acknowledged). */
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
    const normalizedEntryPoint = (getTeamEntryPoint(chatroom) ?? 'builder').toLowerCase();
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

    // Emit task.acknowledged event so UI can derive agent status from event stream
    await ctx.db.insert('chatroom_eventStream', {
      type: 'task.acknowledged',
      chatroomId: args.chatroomId,
      role: args.role,
      taskId: pendingTask._id,
      timestamp: now,
    });

    return { taskId: pendingTask._id, content: pendingTask.content };
  },
});

/** Transitions an acknowledged task to in_progress for the assigned role. */
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

    // Emit task.inProgress event so UI can derive agent status from event stream
    await ctx.db.insert('chatroom_eventStream', {
      type: 'task.inProgress',
      chatroomId: args.chatroomId,
      role: args.role,
      taskId: acknowledgedTask._id,
      timestamp: Date.now(),
    });

    return { taskId: acknowledgedTask._id, content: acknowledgedTask.content };
  },
});

/** Completes all in_progress tasks in the chatroom, transitioning based on origin. */
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
      return { completed: false, completedCount: 0, pendingReview: [] };
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

    // Queue promotion is now handled automatically by the transitionTask usecase
    // whenever a task transitions to 'completed'. No inline promotion needed here.

    return {
      completed: true,
      completedCount: allTasksToComplete.length,
      pendingReview,
    };
  },
});

/** Cancels a task (closes it), requiring force for in_progress tasks. */
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

    // Queue promotion is now handled automatically by the transitionTask usecase
    // whenever a task transitions to 'closed'. No inline promotion needed here.
    // (The wasPending/wasInProgress check was previously used to guard promotion,
    // but the transitionTask usecase now always attempts promotion on terminal states.)
    void wasPending; // acknowledged for clarity

    return { success: true, status: 'closed' };
  },
});

/** Completes a specific task by ID, requiring force for active tasks. */
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

      // Queue promotion is now handled automatically by the transitionTask usecase
      // whenever a task transitions to 'completed'. No inline promotion needed here.

      return { success: true, taskId: args.taskId, wasForced: true };
    }

    // For backlog and queued tasks, complete normally (no promotion needed)
    if (task.status !== 'backlog' && task.status !== 'queued') {
      throw new Error(
        `Cannot complete task with status: ${task.status}. Only backlog, queued, pending, in_progress, acknowledged, and backlog_acknowledged tasks can be completed.`
      );
    }

    await transitionTask(ctx, args.taskId, 'completed', 'completeTaskById');

    return { success: true, taskId: args.taskId, wasForced: false };
  },
});

/** Updates the content of a queued or backlog task. */
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

/** Moves a backlog or pending_user_review task into the active chat queue. */
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
    const targetRole = getTeamEntryPoint(chatroom) ?? 'builder';
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

/** Marks a backlog task as completed, confirming the issue is resolved. */
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

/** Transitions a backlog task to pending_user_review, signaling agent completion. */
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

/** Closes a backlog task without completing it (won't fix / no longer relevant). */
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

/** Reopens a completed or closed backlog task, returning it to pending_user_review. */
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

/** Returns a pending_user_review backlog task to the queue with optional feedback. */
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
      const targetRole = getTeamEntryPoint(chatroom) ?? 'builder';
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

/** Patches scoring fields (complexity, value, priority) on a task. */
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

/** Lists tasks in a chatroom, optionally filtered by status and sorted by priority or queue position. */
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

/** Returns all non-completed, non-closed tasks in a chatroom, sorted by queue position. */
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

/** Returns completed and closed tasks in a chatroom, sorted by most recently updated. */
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

/** Returns the current in_progress or pending task for a chatroom. */
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

/** Promotes the oldest queued task to pending if no active task exists and all agents are ready. */
export const promoteNextTask = mutation({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
  },
  handler: async (ctx, args) => {
    // Validate session and check chatroom access (chatroom not needed)
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

    // Delegate to the promote-next-task usecase with deps wired from ctx
    const result = await promoteNextTaskUsecase(args.chatroomId, {
      areAllAgentsWaiting: (chatroomId) => areAllAgentsWaiting(ctx, chatroomId),
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
      transitionTaskToPending: (taskId) =>
        transitionTask(ctx, taskId, 'pending', 'promoteNextTask'),
    });

    if (result.promoted) {
      // Copy queue record to messages for the promoted task
      await promoteQueuedMessage(ctx, result.promoted);
      console.warn(
        `[Queue Promotion] Promoted task ${result.promoted} to pending in chatroom ${args.chatroomId}.`
      );
    }

    return result.promoted
      ? { promoted: true, reason: 'success', taskId: result.promoted }
      : { promoted: false, reason: result.reason, taskId: null };
  },
});

/** Returns queue health status including active task presence, queued count, and promotion eligibility. */
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

    // Check if all agents are waiting for a task
    const allAgentsWaiting = await areAllAgentsWaiting(ctx, args.chatroomId);

    const hasActiveTask = activeTasks.length > 0;
    const hasQueuedTasks = queuedTasks.length > 0;
    // Promotion is possible only if no active tasks, there are queued tasks, AND all agents are waiting
    const needsPromotion = !hasActiveTask && hasQueuedTasks && allAgentsWaiting;

    return {
      hasActiveTask,
      queuedCount: queuedTasks.length,
      allAgentsReady: allAgentsWaiting,
      needsPromotion,
    };
  },
});

/** Returns task counts grouped by status for a chatroom. */
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

/** Returns pending, acknowledged, and in_progress tasks relevant to a role, or a typed status response. */
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
      const entryPoint = getTeamEntryPoint(chatroom);
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

      // Also get in_progress tasks for recovery
      // If an agent died mid-task, the task remains in_progress.
      // Returning it here allows the recovered agent to resume work
      // without losing context or requiring manual intervention.
      const inProgressTasks = await ctx.db
        .query('chatroom_tasks')
        .withIndex('by_chatroom_status', (q) =>
          q.eq('chatroomId', args.chatroomId).eq('status', 'in_progress')
        )
        .collect();

      // Filter for tasks relevant to this role
      const relevantPending = pendingTasks.filter(isRelevantForRole);
      const relevantAcknowledged = acknowledgedTasks.filter(isRelevantForRole);
      const relevantInProgress = inProgressTasks.filter(isRelevantForRole);

      // Combine: pending first, then acknowledged, then in_progress
      // Priority order ensures fresh tasks are picked up before resuming in-flight ones
      const relevantTasks = [...relevantPending, ...relevantAcknowledged, ...relevantInProgress];

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

/** Fetches multiple tasks by ID, enforcing chatroom-level access control. */
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

/** Returns a single task by ID, verifying it belongs to the specified chatroom. */
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

/** Returns the configured task count and list limits. */
export const getTaskLimits = query({
  args: {},
  handler: async () => {
    return {
      maxActiveTasks: MAX_ACTIVE_TASKS,
      maxTaskListLimit: MAX_TASK_LIST_LIMIT,
    };
  },
});

/** Marks daemons with stale heartbeats as disconnected. */
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
