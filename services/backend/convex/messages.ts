import { paginationOptsValidator } from 'convex/server';
import { ConvexError, v } from 'convex/values';

import {
  generateRolePrompt,
  generateTaskStartedReminder,
  generateSplitInitPrompt,
} from '../prompts';
import type { Id } from './_generated/dataModel';
import type { MutationCtx } from './_generated/server';
import { mutation, query } from './_generated/server';
import {
  areAllAgentsReady,
  getAndIncrementQueuePosition,
  requireChatroomAccess,
} from './auth/cliSessionAuth';
import { getRolePriority } from './lib/hierarchy';
import { decodeStructured } from './lib/stdinDecoder';
import { transitionTask } from './lib/taskStateMachine';
import { getCompletionStatus } from './lib/taskWorkflows';
import { getAvailableActions } from '../prompts/base/cli/wait-for-task/available-actions.js';
import { waitForTaskCommand } from '../prompts/base/cli/wait-for-task/command.js';
import { generateAgentPrompt as generateWebappPrompt } from '../prompts/base/webapp';
import { getConfig } from '../prompts/config/index.js';
import { getCliEnvPrefix } from '../prompts/utils/index.js';

const config = getConfig();

// Types for task delivery prompt response
interface TaskDeliveryPromptResponse {
  humanReadable: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  json: any; // Dynamic JSON structure from prompt generator
}

// =============================================================================
// SHARED HANDLERS - Internal functions that contain the actual logic
// =============================================================================

/**
 * Internal handler for sending a message.
 * Called by both `send` (deprecated) and `sendMessage` (preferred).
 */
async function _sendMessageHandler(
  ctx: MutationCtx,
  args: {
    sessionId: string;
    chatroomId: Id<'chatroom_rooms'>;
    senderRole: string;
    content: string;
    targetRole?: string;
    type: 'message' | 'handoff' | 'interrupt' | 'join';
    attachedTaskIds?: Id<'chatroom_tasks'>[];
  }
) {
  // Validate session and check chatroom access (chatroom not needed) - returns chatroom directly
  const { chatroom } = await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

  // Validate attached tasks if provided
  if (args.attachedTaskIds && args.attachedTaskIds.length > 0) {
    for (const taskId of args.attachedTaskIds) {
      const task = await ctx.db.get('chatroom_tasks', taskId);
      if (!task) {
        throw new ConvexError({
          code: 'TASK_NOT_FOUND',
          message: 'One or more attached tasks no longer exist. Please refresh and try again.',
        });
      }
      if (task.chatroomId !== args.chatroomId) {
        throw new ConvexError({
          code: 'INVALID_TASK',
          message: 'Invalid task reference: task belongs to different chatroom.',
        });
      }
      if (task.status === 'closed' || task.status === 'completed') {
        throw new ConvexError({
          code: 'INVALID_TASK_STATUS',
          message: 'Cannot attach closed or completed tasks. Please select active backlog items.',
        });
      }
    }
  }

  // Validate senderRole to prevent impersonation
  // Only allow 'user' or roles that are in the team configuration
  const normalizedSenderRole = args.senderRole.toLowerCase();
  if (normalizedSenderRole !== 'user') {
    // Check if senderRole is in teamRoles
    const teamRoles = chatroom.teamRoles || [];
    const normalizedTeamRoles = teamRoles.map((r) => r.toLowerCase());
    if (!normalizedTeamRoles.includes(normalizedSenderRole)) {
      throw new ConvexError({
        code: 'INVALID_ROLE',
        message: `Invalid senderRole: "${args.senderRole}" is not in team configuration. Allowed roles: ${teamRoles.join(', ') || 'user'}`,
      });
    }
  }

  // Determine target role for routing
  let targetRole = args.targetRole;

  // For user messages without explicit target, route to entry point
  if (!targetRole && args.senderRole.toLowerCase() === 'user' && args.type === 'message') {
    if (chatroom?.teamEntryPoint) {
      targetRole = chatroom.teamEntryPoint;
    } else if (chatroom?.teamRoles && chatroom.teamRoles.length > 0) {
      // Default to first role if no entry point specified
      targetRole = chatroom.teamRoles[0];
    }
  }

  const messageId = await ctx.db.insert('chatroom_messages', {
    chatroomId: args.chatroomId,
    senderRole: args.senderRole,
    content: args.content,
    targetRole,
    type: args.type,
    // Include attached backlog tasks if provided
    ...(args.attachedTaskIds &&
      args.attachedTaskIds.length > 0 && {
        attachedTaskIds: args.attachedTaskIds,
      }),
  });

  const now = Date.now();

  // Update chatroom's lastActivityAt for sorting by recent activity
  await ctx.db.patch('chatroom_rooms', args.chatroomId, {
    lastActivityAt: now,
  });

  // Auto-create task for user messages and handoff messages
  const isUserMessage = normalizedSenderRole === 'user' && args.type === 'message';
  const isHandoffToAgent =
    args.type === 'handoff' && targetRole && targetRole.toLowerCase() !== 'user';
  const shouldCreateTask = isUserMessage || isHandoffToAgent;

  if (shouldCreateTask) {
    // Get next queue position atomically (prevents race conditions)
    const queuePosition = await getAndIncrementQueuePosition(ctx, chatroom);

    const now = Date.now();

    // Determine task status:
    // - Handoff messages to agents always start as 'pending' (targeted, not queued)
    // - User messages check for existing pending/in_progress tasks
    let taskStatus: 'pending' | 'queued';
    if (isHandoffToAgent) {
      // Handoffs are targeted to a specific agent and should start immediately
      taskStatus = 'pending';
    } else {
      // User messages: check if any task is currently pending or in_progress
      const activeTasks = await ctx.db
        .query('chatroom_tasks')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', args.chatroomId))
        .filter((q) =>
          q.or(q.eq(q.field('status'), 'pending'), q.eq(q.field('status'), 'in_progress'))
        )
        .first();
      taskStatus = activeTasks ? 'queued' : 'pending';
    }

    // Determine the task creator and assignment
    const createdBy = isHandoffToAgent ? args.senderRole : 'user';
    const assignedTo = isHandoffToAgent ? targetRole : undefined;

    // Create the task
    const taskId = await ctx.db.insert('chatroom_tasks', {
      chatroomId: args.chatroomId,
      createdBy,
      content: args.content,
      status: taskStatus,
      sourceMessageId: messageId,
      createdAt: now,
      updatedAt: now,
      queuePosition,
      assignedTo,
      // Store attached backlog tasks on the main task
      ...(args.attachedTaskIds &&
        args.attachedTaskIds.length > 0 && {
          attachedTaskIds: args.attachedTaskIds,
        }),
    });

    // Update message with taskId reference
    await ctx.db.patch('chatroom_messages', messageId, { taskId });

    // Bidirectional tracking: Update attached backlog tasks
    if (args.attachedTaskIds && args.attachedTaskIds.length > 0) {
      for (const attachedTaskId of args.attachedTaskIds) {
        const attachedTask = await ctx.db.get('chatroom_tasks', attachedTaskId);
        if (!attachedTask) continue;

        // Add this task to the backlog task's parentTaskIds
        const existingParents = attachedTask.parentTaskIds || [];
        await ctx.db.patch('chatroom_tasks', attachedTaskId, {
          parentTaskIds: [...existingParents, taskId],
          updatedAt: now,
        });

        // Transition backlog task: backlog → backlog_acknowledged
        if (attachedTask.status === 'backlog') {
          try {
            await transitionTask(ctx, attachedTaskId, 'backlog_acknowledged', 'attachToMessage', {
              parentTaskIds: [...existingParents, taskId],
            });
          } catch (error) {
            // Log but don't fail - task attachment can be retried
            console.error(
              `Failed to transition backlog task ${attachedTaskId} to backlog_acknowledged:`,
              error
            );
          }
        }
      }
    }
  }

  return messageId;
}

// =============================================================================
// PUBLIC MUTATIONS - sendMessage is preferred, send is deprecated
// =============================================================================

/**
 * Send a message to a chatroom.
 * Handles message routing based on sender role and message type.
 * Requires CLI session authentication and chatroom access.
 *
 * @deprecated Use `sendMessage` instead. This method will be removed in a future version.
 */
export const send = mutation({
  args: {
    sessionId: v.string(),
    chatroomId: v.id('chatroom_rooms'),
    senderRole: v.string(),
    content: v.string(),
    targetRole: v.optional(v.string()),
    type: v.union(
      v.literal('message'),
      v.literal('handoff'),
      v.literal('interrupt'),
      v.literal('join')
    ),
    attachedTaskIds: v.optional(v.array(v.id('chatroom_tasks'))),
  },
  handler: async (ctx, args) => {
    return _sendMessageHandler(ctx, args);
  },
});

/**
 * Internal handler for completing a task and handing off.
 * Called by both `sendHandoff` (deprecated) and `handoff` (preferred).
 */
async function _handoffHandler(
  ctx: MutationCtx,
  args: {
    sessionId: string;
    chatroomId: Id<'chatroom_rooms'>;
    senderRole: string;
    content: string;
    targetRole: string;
  }
) {
  // Validate session and check chatroom access (returns chatroom, throws ConvexError on auth failure)
  let chatroom;
  try {
    const result = await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);
    chatroom = result.chatroom;
  } catch (error) {
    // Convert generic Error to structured error response
    return {
      success: false,
      error: {
        code: 'AUTH_FAILED',
        message: error instanceof Error ? error.message : 'Authentication failed',
      },
      messageId: null,
      completedTaskIds: [],
      newTaskId: null,
      promotedTaskId: null,
    };
  }

  // Validate senderRole
  const normalizedSenderRole = args.senderRole.toLowerCase();
  const teamRoles = chatroom.teamRoles || [];
  const normalizedTeamRoles = teamRoles.map((r) => r.toLowerCase());
  if (!normalizedTeamRoles.includes(normalizedSenderRole)) {
    return {
      success: false,
      error: {
        code: 'INVALID_ROLE',
        message: `Invalid senderRole: "${args.senderRole}" is not in team configuration. Allowed roles: ${teamRoles.join(', ')}`,
      },
      messageId: null,
      completedTaskIds: [],
      newTaskId: null,
      promotedTaskId: null,
    };
  }

  const normalizedTargetRole = args.targetRole.toLowerCase();
  const isHandoffToUser = normalizedTargetRole === 'user';

  // Validate handoff to user is allowed based on classification
  if (isHandoffToUser) {
    // Get the most recent classified user message to determine restrictions (optimized)
    const recentMessages = await ctx.db
      .query('chatroom_messages')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', args.chatroomId))
      .order('desc')
      .take(50);

    let currentClassification = null;
    for (const msg of recentMessages) {
      if (msg.senderRole.toLowerCase() === 'user' && msg.classification) {
        currentClassification = msg.classification;
        break;
      }
    }

    // For new_feature requests, builder cannot hand off directly to user
    if (currentClassification === 'new_feature' && normalizedSenderRole === 'builder') {
      // Return error response instead of throwing - allows CLI to handle gracefully
      return {
        success: false,
        error: {
          code: 'HANDOFF_RESTRICTED',
          message:
            'Cannot hand off directly to user. new_feature requests must be reviewed before returning to user.',
          suggestedTarget: 'reviewer',
        },
        messageId: null,
        completedTaskIds: [],
        newTaskId: null,
        promotedTaskId: null,
      };
    }
  }

  const now = Date.now();

  // Step 1: Complete ALL in_progress tasks
  const inProgressTasks = await ctx.db
    .query('chatroom_tasks')
    .withIndex('by_chatroom_status', (q) =>
      q.eq('chatroomId', args.chatroomId).eq('status', 'in_progress')
    )
    .collect();

  const completedTaskIds: Id<'chatroom_tasks'>[] = [];

  for (const task of inProgressTasks) {
    // Determine the new status using the workflow definition:
    // - When handing off to user: use workflow-defined completion status
    //   (backlog → pending_user_review, chat → completed)
    // - When handing off to agent: always 'completed' (a new task is created for target)
    const newStatus: 'pending_user_review' | 'completed' = isHandoffToUser
      ? (getCompletionStatus(task.origin, task.status) as 'pending_user_review' | 'completed')
      : 'completed';

    // Use FSM for transition
    // Use appropriate trigger based on context
    const trigger = isHandoffToUser ? 'completeTask' : 'completeTask';
    await transitionTask(ctx, task._id, newStatus, trigger);
    completedTaskIds.push(task._id);

    // Set completedAt on the source message (lifecycle tracking) - only for completed tasks
    if (task.sourceMessageId && newStatus === 'completed') {
      await ctx.db.patch('chatroom_messages', task.sourceMessageId, {
        completedAt: now,
      });
    }
  }

  if (inProgressTasks.length > 1) {
    console.warn(
      `[handoff] Completed ${inProgressTasks.length} in_progress tasks in chatroom ${args.chatroomId}`
    );
  }

  // Step 2: Send the handoff message
  const messageId = await ctx.db.insert('chatroom_messages', {
    chatroomId: args.chatroomId,
    senderRole: args.senderRole,
    content: args.content,
    targetRole: args.targetRole,
    type: 'handoff',
  });

  // Update chatroom's lastActivityAt for sorting by recent activity
  await ctx.db.patch('chatroom_rooms', args.chatroomId, {
    lastActivityAt: now,
  });

  // Step 3: Create task for target agent (if not user)
  let newTaskId: Id<'chatroom_tasks'> | null = null;
  if (!isHandoffToUser) {
    // Get next queue position atomically (prevents race conditions)
    const queuePosition = await getAndIncrementQueuePosition(ctx, chatroom);

    newTaskId = await ctx.db.insert('chatroom_tasks', {
      chatroomId: args.chatroomId,
      createdBy: args.senderRole,
      content: args.content,
      status: 'pending', // Handoffs always start as pending
      sourceMessageId: messageId,
      createdAt: now,
      updatedAt: now,
      queuePosition,
      assignedTo: args.targetRole,
    });

    // Link message to task
    await ctx.db.patch('chatroom_messages', messageId, { taskId: newTaskId });
  }

  // Step 4: Update sender's participant status to waiting (before checking queue promotion)
  const participant = await ctx.db
    .query('chatroom_participants')
    .withIndex('by_chatroom_and_role', (q) =>
      q.eq('chatroomId', args.chatroomId).eq('role', args.senderRole)
    )
    .unique();

  if (participant) {
    await ctx.db.patch('chatroom_participants', participant._id, { status: 'waiting' });
  }

  // Step 5: Update attached backlog tasks to pending_user_review when handing off to user
  // This is the ONLY place where attached backlog tasks should have their status changed
  // Use whitelist approach: only transition specific statuses, not "everything except completed/closed"
  // This avoids accidentally flipping cancelled/archived tasks
  const TRANSITIONABLE_STATUSES = ['backlog', 'queued', 'pending', 'in_progress'] as const;
  type TransitionableStatus = (typeof TRANSITIONABLE_STATUSES)[number];

  if (isHandoffToUser) {
    // For each completed task, get its source message and update attached backlog tasks
    for (const task of inProgressTasks) {
      if (task.sourceMessageId) {
        const sourceMessage = await ctx.db.get('chatroom_messages', task.sourceMessageId);
        if (sourceMessage?.attachedTaskIds && sourceMessage.attachedTaskIds.length > 0) {
          for (const attachedTaskId of sourceMessage.attachedTaskIds) {
            const attachedTask = await ctx.db.get('chatroom_tasks', attachedTaskId);
            // Only update backlog-origin tasks in transitionable statuses
            if (
              attachedTask &&
              attachedTask.origin === 'backlog' &&
              TRANSITIONABLE_STATUSES.includes(attachedTask.status as TransitionableStatus)
            ) {
              await transitionTask(
                ctx,
                attachedTaskId,
                'pending_user_review',
                'parentTaskAcknowledged'
              );
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

  // Step 6: Promote next queued task only if ALL agents are ready (not active)
  // This ensures queued tasks are only promoted when the team is idle
  let promotedTaskId: Id<'chatroom_tasks'> | null = null;

  // Check if we're handing off to a specific agent (not the queue)
  // Handoffs to specific agents don't trigger queue promotion - the target agent gets a dedicated task
  // Queue promotion only happens when all agents become idle
  if (isHandoffToUser) {
    // When handing off to user, check if all agents are ready for queue promotion
    const allAgentsReady = await areAllAgentsReady(ctx, args.chatroomId);

    if (allAgentsReady) {
      const queuedTasks = await ctx.db
        .query('chatroom_tasks')
        .withIndex('by_chatroom_status', (q) =>
          q.eq('chatroomId', args.chatroomId).eq('status', 'queued')
        )
        .collect();

      if (queuedTasks.length > 0) {
        queuedTasks.sort((a, b) => a.queuePosition - b.queuePosition);
        const nextTask = queuedTasks[0];
        await transitionTask(ctx, nextTask._id, 'pending', 'promoteNextTask');
        promotedTaskId = nextTask._id;
        console.warn(
          `[handoff] Promoted queued task ${nextTask._id} to pending (all agents ready after handoff to user)`
        );
      }
    } else {
      console.warn(
        `[handoff] Skipping queue promotion - some agents are still active after handoff to user`
      );
    }
  }
  // For handoffs to other agents, no queue promotion - the handoff already creates a pending task for the target

  return {
    success: true,
    error: null,
    messageId,
    completedTaskIds,
    newTaskId,
    promotedTaskId,
  };
}

/**
 * Send a handoff message and complete the current task atomically.
 * This is the preferred way to hand off work between agents.
 *
 * Performs all of these operations in a single atomic transaction:
 * 1. Validates the handoff is allowed (classification rules)
 * 2. Completes all in_progress tasks in the chatroom
 * 3. Sends the handoff message
 * 4. Creates a task for the target agent (if not handing to user)
 * 5. Updates the sender's participant status to waiting
 *
 * Requires CLI session authentication and chatroom access.
 *
 * @deprecated Use `handoff` instead. This method will be removed in a future version.
 */
export const sendHandoff = mutation({
  args: {
    sessionId: v.string(),
    chatroomId: v.id('chatroom_rooms'),
    senderRole: v.string(),
    content: v.string(),
    targetRole: v.string(),
  },
  handler: async (ctx, args) => {
    return _handoffHandler(ctx, args);
  },
});

/**
 * Send a message to a chatroom.
 * Handles message routing based on sender role and message type.
 * Requires CLI session authentication and chatroom access.
 *
 * This is primarily used by agents to send messages without completing their current task,
 * such as asking clarifying questions or providing status updates.
 *
 * Note: Users typically send messages via the WebUI, not the CLI.
 */
export const sendMessage = mutation({
  args: {
    sessionId: v.string(),
    chatroomId: v.id('chatroom_rooms'),
    senderRole: v.string(),
    content: v.string(),
    targetRole: v.optional(v.string()),
    type: v.union(
      v.literal('message'),
      v.literal('handoff'),
      v.literal('interrupt'),
      v.literal('join')
    ),
    attachedTaskIds: v.optional(v.array(v.id('chatroom_tasks'))),
  },
  handler: async (ctx, args) => {
    return _sendMessageHandler(ctx, args);
  },
});

/**
 * Complete your current task and hand off to the next agent.
 * This is the preferred way to finish work and pass control between agents.
 *
 * Performs all of these operations in a single atomic transaction:
 * 1. Validates the handoff is allowed (classification rules)
 * 2. Completes all in_progress tasks in the chatroom
 * 3. Sends the handoff message
 * 4. Creates a task for the target agent (if not handing to user)
 * 5. Updates the sender's participant status to waiting
 *
 * Requires CLI session authentication and chatroom access.
 */
export const handoff = mutation({
  args: {
    sessionId: v.string(),
    chatroomId: v.id('chatroom_rooms'),
    senderRole: v.string(),
    content: v.string(),
    targetRole: v.string(),
  },
  handler: async (ctx, args) => {
    return _handoffHandler(ctx, args);
  },
});

/**
 * Report progress on the current task without completing it.
 * Used by agents to provide status updates during long-running operations.
 *
 * This is a lightweight operation that:
 * 1. Validates session and chatroom access
 * 2. Validates the sender role is in the team
 * 3. Creates a progress message visible in the webapp
 *
 * Progress messages do NOT:
 * - Create tasks
 * - Change task status
 * - Trigger handoffs or queue processing
 *
 * Requires CLI session authentication and chatroom access.
 */
export const reportProgress = mutation({
  args: {
    sessionId: v.string(),
    chatroomId: v.id('chatroom_rooms'),
    senderRole: v.string(),
    content: v.string(),
  },
  handler: async (ctx, args) => {
    // Validate session and check chatroom access
    const { chatroom } = await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

    // Validate senderRole to prevent impersonation
    const normalizedSenderRole = args.senderRole.toLowerCase();
    const teamRoles = chatroom.teamRoles || [];
    const normalizedTeamRoles = teamRoles.map((r) => r.toLowerCase());
    if (!normalizedTeamRoles.includes(normalizedSenderRole)) {
      throw new ConvexError({
        code: 'INVALID_ROLE',
        message: `Invalid senderRole: "${args.senderRole}" is not in team configuration. Allowed roles: ${teamRoles.join(', ') || 'user'}`,
      });
    }

    // Validate content is not empty
    if (!args.content || args.content.trim().length === 0) {
      throw new ConvexError({
        code: 'INVALID_CONTENT',
        message: 'Progress message content cannot be empty',
      });
    }

    // Find the current in-progress task for this role to link the progress message
    const inProgressTask = await ctx.db
      .query('chatroom_tasks')
      .withIndex('by_chatroom_status', (q) =>
        q.eq('chatroomId', args.chatroomId).eq('status', 'in_progress')
      )
      .filter((q) => q.eq(q.field('assignedTo'), args.senderRole))
      .first();

    // Create the progress message linked to the task (if found)
    const messageId = await ctx.db.insert('chatroom_messages', {
      chatroomId: args.chatroomId,
      senderRole: args.senderRole,
      content: args.content,
      type: 'progress',
      // Link to the in-progress task for inline rendering
      ...(inProgressTask && { taskId: inProgressTask._id }),
    });

    // Update chatroom's lastActivityAt for sorting by recent activity
    const now = Date.now();
    await ctx.db.patch('chatroom_rooms', args.chatroomId, {
      lastActivityAt: now,
    });

    return { success: true, messageId };
  },
});

/**
 * Mark a task as started and classify the user message.
 * Called by agents when they begin working on a user message.
 * Sets the classification which determines allowed handoff paths.
 * Requires CLI session authentication and chatroom access.
 */
export const taskStarted = mutation({
  args: {
    sessionId: v.string(),
    chatroomId: v.id('chatroom_rooms'),
    role: v.string(),
    originMessageClassification: v.optional(
      v.union(v.literal('question'), v.literal('new_feature'), v.literal('follow_up'))
    ),
    // Require taskId for task-started (for consistency)
    taskId: v.id('chatroom_tasks'),

    // ✅ ACTIVE: Raw stdin content (for new_feature - contains ---TITLE---, ---DESCRIPTION---, ---TECH_SPECS---)
    // Requirement #4: Backend parsing of EOF format
    // This is the preferred format - backend decodes stdin directly
    rawStdin: v.optional(v.string()),

    convexUrl: v.optional(v.string()),

    // Skip classification for handoff recipients (message already classified by entry point)
    skipClassification: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    // Validate that either skipClassification or originMessageClassification is provided
    if (!args.skipClassification && !args.originMessageClassification) {
      throw new ConvexError({
        code: 'MISSING_CLASSIFICATION',
        message: 'Either originMessageClassification or skipClassification must be provided',
      });
    }

    // Validate session and check chatroom access
    const { chatroom } = await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

    // Get the task to acknowledge
    const task = await ctx.db.get('chatroom_tasks', args.taskId);
    if (!task) {
      throw new ConvexError({
        code: 'TASK_NOT_FOUND',
        message: 'Task not found',
      });
    }

    // Verify the task belongs to this chatroom
    if (task.chatroomId !== args.chatroomId) {
      throw new ConvexError({
        code: 'INVALID_TASK',
        message: 'Task does not belong to this chatroom',
      });
    }

    // Get the associated message
    if (!task.sourceMessageId) {
      throw new ConvexError({
        code: 'INVALID_TASK',
        message: 'Task must have an associated message',
      });
    }
    const message = await ctx.db.get('chatroom_messages', task.sourceMessageId);
    if (!message) {
      throw new ConvexError({
        code: 'MESSAGE_NOT_FOUND',
        message: 'Associated message not found',
      });
    }

    // Only allow classification of user messages (skip this check if we're not classifying)
    if (!args.skipClassification && message.senderRole.toLowerCase() !== 'user') {
      throw new ConvexError({
        code: 'INVALID_MESSAGE',
        message: 'Can only classify user messages',
      });
    }

    // Verify task is in progress (startTask should have been called first)
    if (task.status !== 'in_progress') {
      throw new ConvexError({
        code: 'INVALID_TASK_STATUS',
        message: `Task must be in_progress to classify (current status: ${task.status}). Call startTask first.`,
      });
    }

    // Use existing classification if skipClassification is true
    let finalClassification: 'question' | 'new_feature' | 'follow_up';
    if (args.skipClassification) {
      // For handoff recipients, the task's sourceMessage is the handoff message (not user message)
      // We need to find the most recent classified user message in the chatroom
      const recentMessages = await ctx.db
        .query('chatroom_messages')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', args.chatroomId))
        .order('desc')
        .take(50);

      let classifiedMessage = null;
      for (const msg of recentMessages) {
        if (msg.senderRole.toLowerCase() === 'user' && msg.classification) {
          classifiedMessage = msg;
          break;
        }
      }

      if (!classifiedMessage || !classifiedMessage.classification) {
        throw new ConvexError({
          code: 'MESSAGE_NOT_CLASSIFIED',
          message: 'Cannot skip classification - no classified user message found in chatroom',
        });
      }
      // TypeScript doesn't narrow the type through the check above, so we use a type assertion
      // We know classification is non-null because we just checked it
      finalClassification = classifiedMessage.classification as
        | 'question'
        | 'new_feature'
        | 'follow_up';
    } else {
      finalClassification = args.originMessageClassification!;
    }

    // Parse raw stdin for new_feature classification (Requirement #4: backend parsing)
    let featureTitle: string | undefined;
    let featureDescription: string | undefined;
    let featureTechSpecs: string | undefined;

    if (!args.skipClassification && finalClassification === 'new_feature') {
      if (!args.rawStdin) {
        throw new ConvexError({
          code: 'MISSING_STDIN',
          message:
            'new_feature classification requires rawStdin with TITLE, DESCRIPTION, and TECH_SPECS',
        });
      }

      try {
        const parsed = decodeStructured(args.rawStdin, ['TITLE', 'DESCRIPTION', 'TECH_SPECS']);

        featureTitle = parsed.TITLE;
        featureDescription = parsed.DESCRIPTION;
        featureTechSpecs = parsed.TECH_SPECS;
      } catch (error) {
        throw new ConvexError({
          code: 'INVALID_STDIN_FORMAT',
          message: `Failed to parse raw stdin: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    }

    // Validate new_feature has required metadata
    if (!args.skipClassification && finalClassification === 'new_feature') {
      if (!featureTitle || !featureDescription || !featureTechSpecs) {
        throw new ConvexError({
          code: 'MISSING_FEATURE_METADATA',
          message: 'new_feature classification requires TITLE, DESCRIPTION, and TECH_SPECS',
        });
      }
    }

    // Update the message with classification and feature metadata (only if not already classified)
    if (!args.skipClassification && !message.classification) {
      await ctx.db.patch('chatroom_messages', message._id, {
        classification: finalClassification,
        ...(featureTitle && { featureTitle }),
        ...(featureDescription && { featureDescription }),
        ...(featureTechSpecs && { featureTechSpecs }),
      });
    }

    // Note: Attached backlog tasks remain in their current status when agent acknowledges.
    // They will only be transitioned to pending_user_review when the agent hands off to user.

    // For follow-ups, link to the previous non-follow-up message
    if (!args.skipClassification && finalClassification === 'follow_up' && message) {
      // Find the most recent non-follow-up user message (optimized with limit)
      const recentMessages = await ctx.db
        .query('chatroom_messages')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', args.chatroomId))
        .order('desc')
        .take(100); // Limit to recent messages for performance

      // Find the most recent classified message that is not a follow-up
      let originMessage = null;
      for (const msg of recentMessages) {
        if (
          msg._id !== message._id &&
          msg.senderRole.toLowerCase() === 'user' &&
          msg.classification &&
          msg.classification !== 'follow_up'
        ) {
          originMessage = msg;
          break;
        }
      }

      if (originMessage) {
        // Link this follow-up to the original message
        await ctx.db.patch('chatroom_messages', message._id, {
          taskOriginMessageId: originMessage._id,
        });
      }
    }

    // Generate a focused reminder for this role + classification
    let reminder = '';
    try {
      reminder = generateTaskStartedReminder(
        args.role,
        finalClassification,
        args.chatroomId,
        message?._id.toString(),
        args.taskId.toString(),
        args.convexUrl,
        chatroom.teamRoles || []
      );
    } catch (error) {
      console.error('Error generating task started reminder:', error);
      // Provide a fallback reminder
      reminder = `Task acknowledged. Classification: ${finalClassification}. You can now proceed with your work.`;
    }

    return { success: true, classification: finalClassification, reminder };
  },
});

/**
 * Get allowed handoff roles based on current message classification.
 * Used by CLI to determine valid handoff targets.
 * Requires CLI session authentication and chatroom access.
 */
export const getAllowedHandoffRoles = query({
  args: {
    sessionId: v.string(),
    chatroomId: v.id('chatroom_rooms'),
    role: v.string(),
  },
  handler: async (ctx, args) => {
    // Validate session and check chatroom access (chatroom not needed)
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

    // Get participants
    const participants = await ctx.db
      .query('chatroom_participants')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', args.chatroomId))
      .collect();

    // Find waiting participants (excluding current role)
    const waitingParticipants = participants.filter(
      (p) => p.status === 'waiting' && p.role.toLowerCase() !== args.role.toLowerCase()
    );

    // Get the most recent classified user message to determine restrictions (optimized)
    const recentMessages = await ctx.db
      .query('chatroom_messages')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', args.chatroomId))
      .order('desc')
      .take(50);

    // Find the most recent classified user message
    let currentClassification = null;
    for (const msg of recentMessages) {
      if (msg.senderRole.toLowerCase() === 'user' && msg.classification) {
        currentClassification = msg.classification;
        break;
      }
    }

    // Determine allowed handoff roles based on classification
    const availableRoles = waitingParticipants.map((p) => p.role);

    // For new_feature requests, builder cannot hand off directly to user
    // They must go through the reviewer first
    let canHandoffToUser = true;
    let restrictionReason = null;

    if (currentClassification === 'new_feature') {
      const normalizedRole = args.role.toLowerCase();
      // Builder cannot hand directly to user for new features
      if (normalizedRole === 'builder') {
        canHandoffToUser = false;
        restrictionReason = 'new_feature requests must be reviewed before returning to user';
      }
    }

    return {
      availableRoles,
      canHandoffToUser,
      restrictionReason,
      currentClassification,
    };
  },
});

/**
 * List messages in a chatroom.
 * Optionally limit the number of messages returned.
 * Requires CLI session authentication and chatroom access.
 */
export const list = query({
  args: {
    sessionId: v.string(),
    chatroomId: v.id('chatroom_rooms'),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    // Validate session and check chatroom access (chatroom not needed)
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

    const query = ctx.db
      .query('chatroom_messages')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', args.chatroomId));

    const messages = await query.collect();

    // Enforce maximum limit to prevent unbounded queries
    const MAX_LIMIT = 1000;
    const limit = args.limit ? Math.min(args.limit, MAX_LIMIT) : MAX_LIMIT;

    return messages.slice(-limit);
  },
});

/**
 * List messages in a chatroom with pagination.
 * Returns newest messages first (descending order).
 * Includes task status for messages with linked tasks.
 * Requires CLI session authentication and chatroom access.
 */
export const listPaginated = query({
  args: {
    sessionId: v.string(),
    chatroomId: v.id('chatroom_rooms'),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    // Validate session and check chatroom access (chatroom not needed)
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

    // Paginate with descending order (newest first)
    const result = await ctx.db
      .query('chatroom_messages')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', args.chatroomId))
      .order('desc')
      .paginate(args.paginationOpts);

    // Enrich messages with task status and attached task details
    const enrichedPage = await Promise.all(
      result.page.map(async (message) => {
        // Fetch task status if message has a linked task
        let taskStatus: string | undefined;
        if (message.taskId) {
          const task = await ctx.db.get('chatroom_tasks', message.taskId);
          taskStatus = task?.status;
        }

        // Fetch attached task details if message has attached tasks
        let attachedTasks: { _id: string; content: string; backlogStatus?: string }[] | undefined;
        if (message.attachedTaskIds && message.attachedTaskIds.length > 0) {
          const tasks = await Promise.all(
            message.attachedTaskIds.map((taskId) => ctx.db.get('chatroom_tasks', taskId))
          );
          attachedTasks = tasks
            .filter((t) => t !== null)
            .map((t) => ({
              _id: t!._id,
              content: t!.content,
              status: t!.status,
              origin: t!.origin,
            }));
        }

        // Fetch attached artifact details if message has attached artifacts
        let attachedArtifacts:
          | { _id: string; filename: string; description?: string; mimeType?: string }[]
          | undefined;
        if (message.attachedArtifactIds && message.attachedArtifactIds.length > 0) {
          const artifacts = await Promise.all(
            message.attachedArtifactIds.map((artifactId) =>
              ctx.db.get('chatroom_artifacts', artifactId)
            )
          );
          attachedArtifacts = artifacts
            .filter((a) => a !== null)
            .map((a) => ({
              _id: a!._id,
              filename: a!.filename,
              description: a!.description,
              mimeType: a!.mimeType,
            }));
        }

        // Fetch latest progress message for tasks (for inline progress display)
        let latestProgress:
          | { content: string; senderRole: string; _creationTime: number }
          | undefined;
        if (message.taskId) {
          const progressMessages = await ctx.db
            .query('chatroom_messages')
            .withIndex('by_taskId', (q) => q.eq('taskId', message.taskId))
            .filter((q) => q.eq(q.field('type'), 'progress'))
            .order('desc')
            .take(1);
          if (progressMessages.length > 0) {
            const latest = progressMessages[0];
            latestProgress = {
              content: latest.content,
              senderRole: latest.senderRole,
              _creationTime: latest._creationTime,
            };
          }
        }

        return {
          ...message,
          ...(taskStatus && { taskStatus }),
          ...(attachedTasks && attachedTasks.length > 0 && { attachedTasks }),
          ...(attachedArtifacts && attachedArtifacts.length > 0 && { attachedArtifacts }),
          ...(latestProgress && { latestProgress }),
        };
      })
    );

    return {
      ...result,
      page: enrichedPage,
    };
  },
});

/**
 * Get all progress messages for a specific task.
 * Returns progress messages in chronological order (oldest first) for timeline display.
 * Used when user expands the inline progress to see full history.
 * Requires CLI session authentication and chatroom access.
 */
export const getProgressForTask = query({
  args: {
    sessionId: v.string(),
    chatroomId: v.id('chatroom_rooms'),
    taskId: v.id('chatroom_tasks'),
  },
  handler: async (ctx, args) => {
    // Validate session and check chatroom access
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

    // Verify task belongs to this chatroom
    const task = await ctx.db.get('chatroom_tasks', args.taskId);
    if (!task || task.chatroomId !== args.chatroomId) {
      return [];
    }

    // Fetch all progress messages for this task, ordered chronologically
    const progressMessages = await ctx.db
      .query('chatroom_messages')
      .withIndex('by_taskId', (q) => q.eq('taskId', args.taskId))
      .filter((q) => q.eq(q.field('type'), 'progress'))
      .order('asc')
      .collect();

    return progressMessages.map((msg) => ({
      _id: msg._id,
      content: msg.content,
      senderRole: msg.senderRole,
      _creationTime: msg._creationTime,
    }));
  },
});

/**
 * Get context window for agents.
 * Returns the latest non-follow-up user message and all messages after it,
 * EXCLUDING user messages that haven't been acknowledged (still queued).
 * This provides agents with the full context of the current task.
 * Requires CLI session authentication and chatroom access.
 *
 * Optimized approach:
 * 1. Get recent messages (limited fetch)
 * 2. Filter out unacknowledged user messages (queued messages)
 * 3. Check if latest user message has taskOriginMessageId (fast path for follow-ups)
 * 4. Otherwise, find origin in recent messages (handles most cases)
 * 5. Fetch messages from origin onwards if needed
 */
export const getContextWindow = query({
  args: {
    sessionId: v.string(),
    chatroomId: v.id('chatroom_rooms'),
  },
  handler: async (ctx, args) => {
    // Validate session and check chatroom access (chatroom not needed)
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

    // Fetch recent messages (limited to 200 for performance)
    // This handles most chatrooms efficiently
    const recentMessages = await ctx.db
      .query('chatroom_messages')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', args.chatroomId))
      .order('desc')
      .take(200);

    // Reverse to get chronological order
    let messages = recentMessages.reverse();

    // Filter out unacknowledged user messages (still queued, not yet worked on)
    // Non-user messages (handoffs, agent messages) are always included
    messages = messages.filter((msg) => {
      // Non-user messages are always included
      if (msg.senderRole.toLowerCase() !== 'user') return true;
      // User messages must have acknowledgedAt to be included
      return msg.acknowledgedAt !== undefined;
    });

    if (messages.length === 0) {
      return {
        originMessage: null,
        contextMessages: [],
        classification: null,
      };
    }

    // Fast path: Check if most recent user message has taskOriginMessageId
    // This is set for follow-up messages and points directly to the origin
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.senderRole.toLowerCase() === 'user' && msg.type === 'message') {
        // If this is a follow-up with origin reference, use it directly
        if (msg.classification === 'follow_up' && msg.taskOriginMessageId) {
          const originMessage = await ctx.db.get('chatroom_messages', msg.taskOriginMessageId);
          if (originMessage) {
            // Find where the origin is in our recent messages, or just return from origin
            const originIndex = messages.findIndex((m) => m._id === originMessage._id);
            if (originIndex !== -1) {
              // Origin is in our recent messages, return from there
              const contextMessages = messages.slice(originIndex);
              return {
                originMessage,
                contextMessages,
                classification: originMessage.classification || null,
              };
            }
            // Origin is older than our recent window - fetch all messages from origin
            // This is rare but handles edge case
            const allMessages = await ctx.db
              .query('chatroom_messages')
              .withIndex('by_chatroom', (q) => q.eq('chatroomId', args.chatroomId))
              .collect();
            const fullOriginIndex = allMessages.findIndex((m) => m._id === originMessage._id);
            const contextMessages =
              fullOriginIndex !== -1 ? allMessages.slice(fullOriginIndex) : allMessages;
            return {
              originMessage,
              contextMessages,
              classification: originMessage.classification || null,
            };
          }
        }

        // This is the origin itself (non-follow-up user message)
        if (msg.classification !== 'follow_up') {
          const contextMessages = messages.slice(i);
          return {
            originMessage: msg,
            contextMessages,
            classification: msg.classification || null,
          };
        }
        break;
      }
    }

    // Standard path: Find the latest non-follow-up user message in recent messages
    let originIndex = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (
        msg.senderRole.toLowerCase() === 'user' &&
        msg.type === 'message' &&
        msg.classification !== 'follow_up'
      ) {
        originIndex = i;
        break;
      }
    }

    // If no origin found in recent messages, return recent messages (fallback)
    if (originIndex === -1) {
      return {
        originMessage: null,
        contextMessages: messages,
        classification: null,
      };
    }

    // Get the origin message and all messages after it
    const originMessage = messages[originIndex];
    const contextMessages = messages.slice(originIndex);

    return {
      originMessage,
      contextMessages,
      classification: originMessage?.classification || null,
    };
  },
});

/**
 * Claim a message for a specific role.
 * Used for broadcast messages to prevent multiple agents from processing the same message.
 * Requires CLI session authentication and chatroom access.
 */
export const claimMessage = mutation({
  args: {
    sessionId: v.string(),
    messageId: v.id('chatroom_messages'),
    role: v.string(),
  },
  handler: async (ctx, args) => {
    const message = await ctx.db.get('chatroom_messages', args.messageId);

    if (!message) {
      return false;
    }

    // Validate session and check chatroom access (chatroom not needed)
    await requireChatroomAccess(ctx, args.sessionId, message.chatroomId);

    // Already claimed by someone else
    if (message.claimedByRole && message.claimedByRole !== args.role) {
      return false;
    }

    // Claim the message and set acknowledgedAt (if not already set)
    const updates: { claimedByRole: string; acknowledgedAt?: number } = {
      claimedByRole: args.role,
    };
    if (!message.acknowledgedAt) {
      updates.acknowledgedAt = Date.now();
    }
    await ctx.db.patch('chatroom_messages', args.messageId, updates);
    return true;
  },
});

/**
 * Get the latest message for a specific role.
 * Used for polling for new messages.
 * Requires CLI session authentication and chatroom access.
 *
 * Message routing logic:
 * 1. Targeted messages (targetRole set): Only the target role receives
 * 2. Interrupt messages: All waiting agents receive
 * 3. User messages: Route to entry point (or first role in team)
 * 4. Broadcast from agents: Highest priority waiting agent receives
 */
export const getLatestForRole = query({
  args: {
    sessionId: v.string(),
    chatroomId: v.id('chatroom_rooms'),
    role: v.string(),
    afterMessageId: v.optional(v.id('chatroom_messages')),
  },
  handler: async (ctx, args) => {
    // Validate session and check chatroom access - returns chatroom directly
    const { chatroom } = await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

    // Fetch recent messages (optimized with limit)
    const recentMessages = await ctx.db
      .query('chatroom_messages')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', args.chatroomId))
      .order('desc')
      .take(50); // Reduced from 200 to 50 for performance

    // Reverse to get chronological order
    const messages = recentMessages.reverse();

    // Get participants for priority routing
    const participants = await ctx.db
      .query('chatroom_participants')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', args.chatroomId))
      .collect();

    // Find waiting participants (excluding current role)
    const waitingParticipants = participants.filter(
      (p) => p.status === 'waiting' && p.role.toLowerCase() !== args.role.toLowerCase()
    );

    // Sort by priority to find highest priority waiting
    waitingParticipants.sort((a, b) => getRolePriority(a.role) - getRolePriority(b.role));
    const highestPriorityWaiting = waitingParticipants[0]?.role;

    // Determine entry point for user messages
    const entryPoint = chatroom.teamEntryPoint || chatroom.teamRoles?.[0];

    // Filter messages after the specified ID
    let relevantMessages = messages;
    if (args.afterMessageId) {
      const afterIndex = messages.findIndex((m) => m._id === args.afterMessageId);
      if (afterIndex !== -1) {
        relevantMessages = messages.slice(afterIndex + 1);
      }
    }

    // Find the first unclaimed message for this role
    for (const message of relevantMessages) {
      // Skip if already claimed by someone else
      if (message.claimedByRole && message.claimedByRole !== args.role) {
        continue;
      }

      // Skip join messages
      if (message.type === 'join') {
        continue;
      }

      // Interrupt messages go to everyone
      if (message.type === 'interrupt') {
        return message;
      }

      // Targeted messages only go to target
      if (message.targetRole) {
        if (message.targetRole.toLowerCase() === args.role.toLowerCase()) {
          return message;
        }
        continue;
      }

      // User messages go to entry point
      if (message.senderRole.toLowerCase() === 'user') {
        if (entryPoint && entryPoint.toLowerCase() === args.role.toLowerCase()) {
          return message;
        }
        continue;
      }

      // Broadcast messages from agents go to highest priority waiting
      if (highestPriorityWaiting?.toLowerCase() === args.role.toLowerCase()) {
        return message;
      }
    }

    return null;
  },
});

/**
 * List features in a chatroom.
 * Returns messages classified as new_feature that have feature metadata.
 * Used by agents to discover past features for context.
 * Requires CLI session authentication and chatroom access.
 */
export const listFeatures = query({
  args: {
    sessionId: v.string(),
    chatroomId: v.id('chatroom_rooms'),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    // Validate session and check chatroom access (chatroom not needed)
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

    const limit = args.limit || 10;
    const MAX_LIMIT = 50;
    const effectiveLimit = Math.min(limit, MAX_LIMIT);

    // Get all messages in the chatroom
    const messages = await ctx.db
      .query('chatroom_messages')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', args.chatroomId))
      .collect();

    // Filter to new_feature messages with feature title
    const features = messages
      .filter((msg) => msg.classification === 'new_feature' && msg.featureTitle)
      .reverse() // Most recent first
      .slice(0, effectiveLimit)
      .map((msg) => ({
        id: msg._id,
        title: msg.featureTitle!,
        descriptionPreview: msg.featureDescription
          ? msg.featureDescription.substring(0, 100) +
            (msg.featureDescription.length > 100 ? '...' : '')
          : undefined,
        createdAt: msg._creationTime,
      }));

    return features;
  },
});

/**
 * Inspect a specific feature.
 * Returns full feature details including tech specs and conversation thread.
 * Used by agents to understand implementation details of past features.
 * Requires CLI session authentication and chatroom access.
 */
export const inspectFeature = query({
  args: {
    sessionId: v.string(),
    chatroomId: v.id('chatroom_rooms'),
    messageId: v.id('chatroom_messages'),
  },
  handler: async (ctx, args) => {
    // Validate session and check chatroom access (chatroom not needed)
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

    // Get the feature message
    const message = await ctx.db.get('chatroom_messages', args.messageId);
    if (!message) {
      throw new ConvexError({
        code: 'MESSAGE_NOT_FOUND',
        message: 'Message not found',
      });
    }

    // Verify it belongs to this chatroom
    if (message.chatroomId !== args.chatroomId) {
      throw new ConvexError({
        code: 'INVALID_MESSAGE',
        message: 'Message does not belong to this chatroom',
      });
    }

    // Verify it's a feature
    if (message.classification !== 'new_feature' || !message.featureTitle) {
      throw new ConvexError({
        code: 'INVALID_MESSAGE',
        message: 'Message is not a feature',
      });
    }

    // Get all messages in the chatroom to find the thread
    const allMessages = await ctx.db
      .query('chatroom_messages')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', args.chatroomId))
      .collect();

    // Find the index of this message
    const messageIndex = allMessages.findIndex((m) => m._id === args.messageId);
    if (messageIndex === -1) {
      throw new ConvexError({
        code: 'MESSAGE_NOT_FOUND',
        message: 'Message not found in chatroom',
      });
    }

    // Get all messages after this one until the next non-follow-up user message
    const thread: {
      id: string;
      senderRole: string;
      content: string;
      type: string;
      createdAt: number;
    }[] = [];

    for (let i = messageIndex + 1; i < allMessages.length; i++) {
      const msg = allMessages[i];

      // Stop at the next non-follow-up user message
      if (
        msg.senderRole.toLowerCase() === 'user' &&
        msg.type === 'message' &&
        msg.classification !== 'follow_up'
      ) {
        break;
      }

      thread.push({
        id: msg._id,
        senderRole: msg.senderRole,
        content: msg.content,
        type: msg.type,
        createdAt: msg._creationTime,
      });
    }

    return {
      feature: {
        id: message._id,
        title: message.featureTitle,
        description: message.featureDescription,
        techSpecs: message.featureTechSpecs,
        content: message.content,
        createdAt: message._creationTime,
      },
      thread,
    };
  },
});

/**
 * Get role-specific prompt for an agent.
 * Returns a prompt tailored to the role, current task context, and available actions.
 * Designed to be called with every wait-for-task to provide fresh context.
 * Requires CLI session authentication and chatroom access.
 */
export const getRolePrompt = query({
  args: {
    sessionId: v.string(),
    chatroomId: v.id('chatroom_rooms'),
    role: v.string(),
    convexUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Validate session and check chatroom access (chatroom not needed) - returns chatroom directly
    const { chatroom } = await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

    // Get participants
    const participants = await ctx.db
      .query('chatroom_participants')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', args.chatroomId))
      .collect();

    // Find waiting participants (excluding current role)
    const waitingParticipants = participants.filter(
      (p) => p.status === 'waiting' && p.role.toLowerCase() !== args.role.toLowerCase()
    );

    // Get the most recent classified user message to determine restrictions (optimized)
    const recentMessages = await ctx.db
      .query('chatroom_messages')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', args.chatroomId))
      .order('desc')
      .take(50);

    // Find the most recent classified user message
    let currentClassification: 'question' | 'new_feature' | 'follow_up' | null = null;
    for (const msg of recentMessages) {
      if (msg.senderRole.toLowerCase() === 'user' && msg.classification) {
        currentClassification = msg.classification;
        break;
      }
    }

    // Determine allowed handoff roles based on classification
    const availableRoles = waitingParticipants.map((p) => p.role);

    // For new_feature requests, builder cannot hand off directly to user
    let canHandoffToUser = true;
    let restrictionReason: string | null = null;

    if (currentClassification === 'new_feature') {
      const normalizedRole = args.role.toLowerCase();
      if (normalizedRole === 'builder') {
        canHandoffToUser = false;
        restrictionReason = 'new_feature requests must be reviewed before returning to user';
      }
    }

    // Build the handoff roles list
    const availableHandoffRoles = canHandoffToUser ? [...availableRoles, 'user'] : availableRoles;

    // Generate the role-specific prompt
    const prompt = generateRolePrompt({
      chatroomId: args.chatroomId,
      role: args.role,
      teamName: chatroom.teamName || 'Team',
      teamRoles: chatroom.teamRoles || [],
      teamEntryPoint: chatroom.teamEntryPoint,
      currentClassification,
      availableHandoffRoles,
      canHandoffToUser,
      restrictionReason,
      convexUrl: config.getConvexURLWithFallback(args.convexUrl),
    });

    return {
      prompt,
      currentClassification,
      availableHandoffRoles,
      canHandoffToUser,
      restrictionReason,
    };
  },
});

/**
 * Get the full initialization prompt for an agent joining the chatroom.
 * This is called once when an agent first joins and provides the complete
 * setup instructions including role, workflow, and command reference.
 */
export const getInitPrompt = query({
  args: {
    sessionId: v.string(),
    chatroomId: v.id('chatroom_rooms'),
    role: v.string(),
    convexUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { chatroom } = await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

    const promptInput = {
      chatroomId: args.chatroomId,
      role: args.role,
      teamName: chatroom.teamName || 'Team',
      teamRoles: chatroom.teamRoles || [],
      teamEntryPoint: chatroom.teamEntryPoint,
      convexUrl: config.getConvexURLWithFallback(args.convexUrl),
    };

    // Generate split prompt (role prompt + initial message)
    const splitPrompt = generateSplitInitPrompt(promptInput);

    // Return both combined (backwards compatible) and split parts
    return {
      /** Combined prompt for manual/backwards-compatible mode */
      prompt: splitPrompt.combined,
      /** Role identity and guidance (for use as system prompt in machine mode) */
      rolePrompt: splitPrompt.rolePrompt,
      /** Context-gaining and next steps (for use as initial message in machine mode) */
      initialMessage: splitPrompt.initialMessage,
    };
  },
});

/**
 * Get the complete task delivery prompt for an agent receiving a task.
 * This is called when wait-for-task receives a task, replacing the
 * local prompt construction in the CLI.
 *
 * Returns both human-readable prompt sections and structured JSON data.
 */
export const getTaskDeliveryPrompt = query({
  args: {
    sessionId: v.string(),
    chatroomId: v.id('chatroom_rooms'),
    role: v.string(),
    taskId: v.id('chatroom_tasks'),
    messageId: v.optional(v.id('chatroom_messages')),
    convexUrl: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<TaskDeliveryPromptResponse> => {
    // Validate session and check chatroom access
    const { chatroom } = await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

    // Fetch the task
    const task = await ctx.db.get('chatroom_tasks', args.taskId);
    if (!task) {
      throw new ConvexError({
        code: 'TASK_NOT_FOUND',
        message: 'Task not found',
      });
    }

    // Fetch the message if provided
    let message = null;
    if (args.messageId) {
      message = await ctx.db.get('chatroom_messages', args.messageId);
    }

    // Fetch participants
    const participants = await ctx.db
      .query('chatroom_participants')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', args.chatroomId))
      .collect();

    // Get role prompt info (reuse existing logic)
    const waitingParticipants = participants.filter(
      (p) => p.status === 'waiting' && p.role.toLowerCase() !== args.role.toLowerCase()
    );

    // Get recent messages for classification
    const recentMessages = await ctx.db
      .query('chatroom_messages')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', args.chatroomId))
      .order('desc')
      .take(50);

    // Find current classification
    let currentClassification: 'question' | 'new_feature' | 'follow_up' | null = null;
    for (const msg of recentMessages) {
      if (msg.senderRole.toLowerCase() === 'user' && msg.classification) {
        currentClassification = msg.classification;
        break;
      }
    }

    // Determine handoff restrictions
    const availableRoles = waitingParticipants.map((p) => p.role);
    let canHandoffToUser = true;
    let restrictionReason: string | null = null;

    if (currentClassification === 'new_feature') {
      const normalizedRole = args.role.toLowerCase();
      if (normalizedRole === 'builder') {
        canHandoffToUser = false;
        restrictionReason = 'new_feature requests must be reviewed before returning to user';
      }
    }

    const availableHandoffRoles = canHandoffToUser ? [...availableRoles, 'user'] : availableRoles;

    // Generate role-specific prompt
    const rolePromptText = generateRolePrompt({
      chatroomId: args.chatroomId,
      role: args.role,
      teamName: chatroom.teamName || 'Team',
      teamRoles: chatroom.teamRoles || [],
      teamEntryPoint: chatroom.teamEntryPoint,
      currentClassification,
      availableHandoffRoles,
      canHandoffToUser,
      restrictionReason,
      convexUrl: config.getConvexURLWithFallback(args.convexUrl),
    });

    // Get context window (reuse getContextWindow logic)
    // Fetch recent messages for context
    const contextRecentMessages = await ctx.db
      .query('chatroom_messages')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', args.chatroomId))
      .order('desc')
      .take(200);

    let contextMessages = contextRecentMessages.reverse();
    // Filter out unacknowledged user messages
    contextMessages = contextMessages.filter((msg) => {
      if (msg.senderRole.toLowerCase() !== 'user') return true;
      return msg.acknowledgedAt !== undefined;
    });

    // Find origin message
    let originMessage = null;
    let originIndex = -1;

    // Check for follow-up with origin reference
    for (let i = contextMessages.length - 1; i >= 0; i--) {
      const msg = contextMessages[i];
      if (msg.senderRole.toLowerCase() === 'user' && msg.type === 'message') {
        if (msg.classification === 'follow_up' && msg.taskOriginMessageId) {
          originMessage = await ctx.db.get('chatroom_messages', msg.taskOriginMessageId);
          if (originMessage) {
            originIndex = contextMessages.findIndex((m) => m._id === originMessage!._id);
            break;
          }
        }
        if (msg.classification !== 'follow_up') {
          originMessage = msg;
          originIndex = i;
          break;
        }
      }
    }

    // If no origin found via follow-up, search for non-follow-up user message
    if (!originMessage) {
      for (let i = contextMessages.length - 1; i >= 0; i--) {
        const msg = contextMessages[i];
        if (
          msg.senderRole.toLowerCase() === 'user' &&
          msg.type === 'message' &&
          msg.classification !== 'follow_up'
        ) {
          originMessage = msg;
          originIndex = i;
          break;
        }
      }
    }

    // Get messages from origin onwards
    const contextMessagesSlice =
      originIndex >= 0 ? contextMessages.slice(originIndex) : contextMessages;

    // Fetch attached tasks if any exist in context messages
    const allAttachedTaskIds: Id<'chatroom_tasks'>[] = [];
    if (originMessage?.attachedTaskIds && originMessage.attachedTaskIds.length > 0) {
      allAttachedTaskIds.push(...originMessage.attachedTaskIds);
    }
    for (const msg of contextMessagesSlice) {
      if (msg.attachedTaskIds && msg.attachedTaskIds.length > 0) {
        allAttachedTaskIds.push(...msg.attachedTaskIds);
      }
    }

    // Fetch attached task details
    const attachedTasksMap = new Map<
      string,
      { id: string; content: string; status: string; createdBy: string; backlogStatus?: string }
    >();
    if (allAttachedTaskIds.length > 0) {
      const uniqueTaskIds = [...new Set(allAttachedTaskIds)];
      for (const taskId of uniqueTaskIds) {
        const attachedTask = await ctx.db.get('chatroom_tasks', taskId);
        if (attachedTask) {
          attachedTasksMap.set(taskId, {
            id: attachedTask._id,
            content: attachedTask.content,
            status: attachedTask.status,
            createdBy: attachedTask.createdBy,
            backlogStatus: attachedTask.origin === 'backlog' ? attachedTask.status : undefined,
          });
        }
      }
    }

    // Build context for prompt generation
    const deliveryContext = {
      chatroomId: args.chatroomId,
      role: args.role,
      task: {
        _id: task._id,
        content: task.content,
        status: task.status,
        createdBy: task.createdBy,
        queuePosition: task.queuePosition,
      },
      message: message
        ? {
            _id: message._id,
            content: message.content,
            senderRole: message.senderRole,
            type: message.type,
            targetRole: message.targetRole,
          }
        : null,
      participants: participants.map((p) => ({
        role: p.role,
        status: p.status,
      })),
      contextWindow: {
        originMessage: originMessage
          ? {
              _id: originMessage._id,
              senderRole: originMessage.senderRole,
              content: originMessage.content,
              type: originMessage.type,
              targetRole: originMessage.targetRole,
              classification: originMessage.classification,
              attachedTaskIds: originMessage.attachedTaskIds,
              attachedTasks: originMessage.attachedTaskIds
                ?.map((id) => attachedTasksMap.get(id))
                .filter(Boolean) as {
                id: string;
                content: string;
                status: string;
                createdBy: string;
                backlogStatus?: string;
              }[],
            }
          : null,
        contextMessages: contextMessagesSlice.map((m) => ({
          _id: m._id,
          senderRole: m.senderRole,
          content: m.content,
          type: m.type,
          targetRole: m.targetRole,
          classification: m.classification,
          attachedTaskIds: m.attachedTaskIds,
          attachedTasks: m.attachedTaskIds
            ?.map((id) => attachedTasksMap.get(id))
            .filter(Boolean) as {
            id: string;
            content: string;
            status: string;
            createdBy: string;
            backlogStatus?: string;
          }[],
        })),
        classification: originMessage?.classification || null,
      },
      rolePrompt: {
        prompt: rolePromptText,
        currentClassification,
        availableHandoffRoles,
        restrictionReason,
      },
      teamName: chatroom.teamName || 'Team',
      teamRoles: chatroom.teamRoles || [],
      currentTimestamp: new Date().toISOString(),
    };

    // Build and return the complete prompt
    const cliEnvPrefix = getCliEnvPrefix(config.getConvexURLWithFallback(args.convexUrl));
    const waitCommand = waitForTaskCommand({
      chatroomId: args.chatroomId,
      role: args.role,
      cliEnvPrefix,
    });
    const reminderMessage = `Remember to listen for new messages using \`wait-for-task\` after handoff. Otherwise your team might get stuck not be able to reach you.\n\n    ${waitCommand}`;

    // Get available actions for this task delivery
    const availableActionsText = getAvailableActions({
      chatroomId: args.chatroomId,
      role: args.role,
      convexUrl: config.getConvexURLWithFallback(args.convexUrl),
    });

    return {
      humanReadable: `${availableActionsText}\n\n${rolePromptText}\n\n${reminderMessage}`,
      json: deliveryContext,
    };
  },
});

/**
 * Get a simplified display prompt for webapp UI.
 * This is used by the webapp dashboard to show agent setup instructions.
 * Does NOT require authentication - public query for UI display.
 */
export const getWebappDisplayPrompt = query({
  args: {
    chatroomId: v.id('chatroom_rooms'),
    role: v.string(),
    convexUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Fetch chatroom (no auth required for display purposes)
    const chatroom = await ctx.db.get('chatroom_rooms', args.chatroomId);
    if (!chatroom) {
      throw new ConvexError({
        code: 'CHATROOM_NOT_FOUND',
        message: 'Chatroom not found',
      });
    }

    // Generate the webapp display prompt
    const prompt = generateWebappPrompt({
      chatroomId: args.chatroomId,
      role: args.role,
      teamName: chatroom.teamName || 'Team',
      teamRoles: chatroom.teamRoles || [],
      teamEntryPoint: chatroom.teamEntryPoint,
      convexUrl: args.convexUrl,
    });

    return {
      prompt,
      teamName: chatroom.teamName || 'Team',
      teamRoles: chatroom.teamRoles || [],
    };
  },
});

// =============================================================================
// SENDER ROLE BASED QUERIES - For user-centric pagination
// =============================================================================

/**
 * List messages filtered by sender role.
 * Uses the composite index for efficient filtering.
 * Returns messages in descending order (newest first).
 * Requires CLI session authentication and chatroom access.
 */
export const listBySenderRole = query({
  args: {
    sessionId: v.string(),
    chatroomId: v.id('chatroom_rooms'),
    senderRole: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    // Validate session and check chatroom access
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

    const limit = args.limit || 10;
    const maxLimit = 50;

    // Use composite index for efficient sender role filtering
    // Index: by_chatroom_senderRole_type_createdAt
    const messages = await ctx.db
      .query('chatroom_messages')
      .withIndex('by_chatroom_senderRole_type_createdAt', (q) =>
        q.eq('chatroomId', args.chatroomId).eq('senderRole', args.senderRole).eq('type', 'message')
      )
      .order('desc')
      .take(Math.min(limit, maxLimit));

    // Enrich with task status
    const enrichedMessages = await Promise.all(
      messages.map(async (message) => {
        let taskStatus: string | undefined;
        if (message.taskId) {
          const task = await ctx.db.get('chatroom_tasks', message.taskId);
          taskStatus = task?.status;
        }
        return {
          ...message,
          ...(taskStatus && { taskStatus }),
        };
      })
    );

    return enrichedMessages;
  },
});

/**
 * List all messages since a given message ID (inclusive).
 * Returns messages in ascending order (oldest first).
 * Useful for getting context starting from a specific user message.
 * Requires CLI session authentication and chatroom access.
 */
export const listSinceMessage = query({
  args: {
    sessionId: v.string(),
    chatroomId: v.id('chatroom_rooms'),
    sinceMessageId: v.id('chatroom_messages'),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    // Validate session and check chatroom access
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

    // Get the reference message to find its timestamp
    const referenceMessage = await ctx.db.get('chatroom_messages', args.sinceMessageId);
    if (!referenceMessage) {
      throw new ConvexError({
        code: 'MESSAGE_NOT_FOUND',
        message: 'Message not found',
      });
    }

    // Verify message belongs to this chatroom
    if (referenceMessage.chatroomId !== args.chatroomId) {
      throw new ConvexError({
        code: 'INVALID_MESSAGE',
        message: 'Message does not belong to this chatroom',
      });
    }

    const limit = args.limit || 100;
    const maxLimit = 500;

    // Fetch all messages from reference onwards (inclusive)
    // Using filter on _creationTime since we need >= comparison
    const messages = await ctx.db
      .query('chatroom_messages')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', args.chatroomId))
      .filter((q) => q.gte(q.field('_creationTime'), referenceMessage._creationTime))
      .order('asc')
      .take(Math.min(limit, maxLimit));

    // Enrich with task status
    const enrichedMessages = await Promise.all(
      messages.map(async (message) => {
        let taskStatus: string | undefined;
        if (message.taskId) {
          const task = await ctx.db.get('chatroom_tasks', message.taskId);
          taskStatus = task?.status;
        }
        return {
          ...message,
          ...(taskStatus && { taskStatus }),
        };
      })
    );

    return enrichedMessages;
  },
});

/**
 * Get context for a specific role.
 * Returns conversation history with task information, pending tasks count,
 * and the origin message classification.
 *
 * This provides agents with a comprehensive view of:
 * - Recent chat history (from origin message forward)
 * - Task information attached to each message
 * - Number of pending tasks waiting for this role
 * - Origin message and classification type
 *
 * Requires CLI session authentication and chatroom access.
 */
export const getContextForRole = query({
  args: {
    sessionId: v.string(),
    chatroomId: v.id('chatroom_rooms'),
    role: v.string(),
  },
  handler: async (ctx, args) => {
    // Validate session and check chatroom access
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

    // Get context window (origin message + all messages since)
    const contextWindow = await ctx.db
      .query('chatroom_messages')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', args.chatroomId))
      .order('desc')
      .take(200);

    const messages = contextWindow.reverse();

    // Find origin message (latest non-follow-up user message)
    let originMessage: (typeof messages)[0] | null = null;
    let originIndex = -1;

    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (
        msg.senderRole.toLowerCase() === 'user' &&
        msg.type === 'message' &&
        msg.classification !== 'follow_up' &&
        msg.acknowledgedAt !== undefined
      ) {
        originMessage = msg;
        originIndex = i;
        break;
      }
    }

    // Get messages from origin forward
    const contextMessages = originIndex >= 0 ? messages.slice(originIndex) : messages;

    // Enrich messages with task information
    const enrichedMessages = await Promise.all(
      contextMessages.map(async (message) => {
        let taskStatus: string | undefined;
        let taskContent: string | undefined;
        let attachedTasks:
          | {
              _id: string;
              content: string;
              status: string;
              createdAt: number;
            }[]
          | undefined;

        // Get task status and content for this message
        if (message.taskId) {
          const task = await ctx.db.get('chatroom_tasks', message.taskId);
          if (task) {
            taskStatus = task.status;
            taskContent = task.content;
          }
        }

        // Get full attached task objects (not just IDs)
        if (message.attachedTaskIds && message.attachedTaskIds.length > 0) {
          const tasks = await Promise.all(
            message.attachedTaskIds.map(async (taskId) => {
              const task = await ctx.db.get('chatroom_tasks', taskId);
              if (task) {
                return {
                  _id: task._id.toString(),
                  content: task.content,
                  status: task.status,
                  createdAt: task.createdAt,
                };
              }
              return null;
            })
          );
          // Filter out null values (tasks that don't exist)
          const validTasks = tasks.filter((t): t is NonNullable<typeof t> => t !== null);
          if (validTasks.length > 0) {
            attachedTasks = validTasks;
          }
        }

        return {
          _id: message._id.toString(),
          _creationTime: message._creationTime,
          senderRole: message.senderRole,
          content: message.content,
          type: message.type,
          classification: message.classification,
          featureTitle: message.featureTitle,
          taskId: message.taskId?.toString(),
          taskStatus,
          taskContent,
          attachedTasks,
        };
      })
    );

    // Count pending tasks for this role
    const allPendingTasks = await ctx.db
      .query('chatroom_tasks')
      .withIndex('by_chatroom_status', (q) =>
        q.eq('chatroomId', args.chatroomId).eq('status', 'pending')
      )
      .collect();

    const pendingTasks = allPendingTasks.filter((task) => task.assignedTo === args.role);

    return {
      messages: enrichedMessages,
      originMessage: originMessage
        ? {
            _id: originMessage._id.toString(),
            _creationTime: originMessage._creationTime,
            senderRole: originMessage.senderRole,
            content: originMessage.content,
            type: originMessage.type,
            classification: originMessage.classification,
            featureTitle: originMessage.featureTitle,
            taskId: originMessage.taskId?.toString(),
          }
        : null,
      classification: originMessage?.classification || null,
      pendingTasksForRole: pendingTasks.length,
    };
  },
});
