import { paginationOptsValidator } from 'convex/server';
import { ConvexError, v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import { generateRolePrompt, generateTaskStartedReminder, composeInitPrompt } from '../prompts';
import type { Doc, Id } from './_generated/dataModel';
import type { MutationCtx } from './_generated/server';
import { mutation, query } from './_generated/server';
import { getAndIncrementQueuePosition, requireChatroomAccess } from './auth/cliSessionAuth';
import { getRolePriority } from './lib/hierarchy';
import { decodeStructured } from './lib/stdinDecoder';
import { getCompletionStatus } from './lib/taskWorkflows';
import { generateFullCliOutput } from '../prompts/cli/get-next-task/fullOutput.js';
import { getConfig } from '../prompts/config/index.js';
import { getCliEnvPrefix } from '../prompts/utils/index.js';
import { getAgentConfig } from '../src/domain/usecase/agent/get-agent-config';
import {
  createTask as createTaskUsecase,
  determineTaskStatus,
} from '../src/domain/usecase/task/create-task';
import { transitionTask, type TaskStatus } from '../src/domain/usecase/task/transition-task';
import { getTeamEntryPoint } from '../src/domain/entities/team';

const config = getConfig();

// Types for task delivery prompt response
interface TaskDeliveryPromptResponse {
  fullCliOutput: string; // Complete CLI output for task delivery (backend-generated)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  json: any; // Dynamic JSON structure from prompt generator
}

// =============================================================================
// SHARED HANDLERS - Internal functions that contain the actual logic
// =============================================================================

/** Internal handler for sending a message. */
async function _sendMessageHandler(
  ctx: MutationCtx,
  args: {
    sessionId: string;
    chatroomId: Id<'chatroom_rooms'>;
    senderRole: string;
    content: string;
    targetRole?: string;
    type: 'message' | 'handoff';
    attachedTaskIds?: Id<'chatroom_tasks'>[];
  }
) {
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
    targetRole = getTeamEntryPoint(chatroom ?? {}) ?? undefined;
  }

  // ─── User messages: determine status BEFORE writing ─────────────────────────
  const isUserMessage = normalizedSenderRole === 'user' && args.type === 'message';
  const isHandoffToAgent =
    args.type === 'handoff' && targetRole && targetRole.toLowerCase() !== 'user';

  if (isUserMessage) {
    const queuePosition = await getAndIncrementQueuePosition(ctx, chatroom);
    const assignedTo = getTeamEntryPoint(chatroom ?? {}) ?? undefined;
    const taskStatus = await determineTaskStatus(ctx, args.chatroomId);

    if (taskStatus === 'queued') {
      // ─── Queued path: store in chatroom_messageQueue ─────────────────────
      const { taskId } = await createTaskUsecase(ctx, {
        chatroomId: args.chatroomId,
        createdBy: 'user',
        content: args.content,
        forceStatus: 'queued',
        assignedTo,
        queuePosition,
        origin: 'chat',
        attachedTaskIds: args.attachedTaskIds,
      });

      const queuedMessageId = await ctx.db.insert('chatroom_messageQueue', {
        chatroomId: args.chatroomId,
        senderRole: args.senderRole,
        targetRole,
        content: args.content,
        type: 'message' as const,
        taskId,
        ...(args.attachedTaskIds?.length && { attachedTaskIds: args.attachedTaskIds }),
      });

      await ctx.db.patch('chatroom_tasks', taskId, { queuedMessageId });

      // Bidirectional tracking for attached backlog tasks (same as pending path)
      if (args.attachedTaskIds && args.attachedTaskIds.length > 0) {
        const now = Date.now();
        for (const attachedTaskId of args.attachedTaskIds) {
          const attachedTask = await ctx.db.get('chatroom_tasks', attachedTaskId);
          if (!attachedTask) continue;
          const existingParents = attachedTask.parentTaskIds || [];
          await ctx.db.patch('chatroom_tasks', attachedTaskId, {
            parentTaskIds: [...existingParents, taskId],
            updatedAt: now,
          });
          if (attachedTask.status === 'backlog') {
            try {
              await transitionTask(ctx, attachedTaskId, 'backlog_acknowledged', 'attachToMessage', {
                parentTaskIds: [...existingParents, taskId],
              });
            } catch (error) {
              console.error(
                `Failed to transition backlog task ${attachedTaskId} to backlog_acknowledged:`,
                error
              );
            }
          }
        }
      }

      // Update chatroom lastActivityAt
      await ctx.db.patch('chatroom_rooms', args.chatroomId, {
        lastActivityAt: Date.now(),
      });

      return queuedMessageId; // Return queue record ID as opaque message ID
    } else {
      // ─── Pending path: existing flow (store in chatroom_messages) ────────
      const messageId = await ctx.db.insert('chatroom_messages', {
        chatroomId: args.chatroomId,
        senderRole: args.senderRole,
        content: args.content,
        targetRole,
        type: args.type,
        ...(args.attachedTaskIds &&
          args.attachedTaskIds.length > 0 && { attachedTaskIds: args.attachedTaskIds }),
      });

      await ctx.db.patch('chatroom_rooms', args.chatroomId, {
        lastActivityAt: Date.now(),
      });

      const { taskId } = await createTaskUsecase(ctx, {
        chatroomId: args.chatroomId,
        createdBy: 'user',
        content: args.content,
        forceStatus: undefined,
        assignedTo,
        sourceMessageId: messageId,
        attachedTaskIds: args.attachedTaskIds,
        queuePosition,
        origin: 'chat',
      });

      await ctx.db.patch('chatroom_messages', messageId, { taskId });

      // Bidirectional tracking for attached backlog tasks
      if (args.attachedTaskIds && args.attachedTaskIds.length > 0) {
        const now = Date.now();
        for (const attachedTaskId of args.attachedTaskIds) {
          const attachedTask = await ctx.db.get('chatroom_tasks', attachedTaskId);
          if (!attachedTask) continue;
          const existingParents = attachedTask.parentTaskIds || [];
          await ctx.db.patch('chatroom_tasks', attachedTaskId, {
            parentTaskIds: [...existingParents, taskId],
            updatedAt: now,
          });
          if (attachedTask.status === 'backlog') {
            try {
              await transitionTask(ctx, attachedTaskId, 'backlog_acknowledged', 'attachToMessage', {
                parentTaskIds: [...existingParents, taskId],
              });
            } catch (error) {
              console.error(
                `Failed to transition backlog task ${attachedTaskId} to backlog_acknowledged:`,
                error
              );
            }
          }
        }
      }

      return messageId;
    }
  } else {
    // ─── Non-user messages: always write to chatroom_messages ────────────────
    const messageId = await ctx.db.insert('chatroom_messages', {
      chatroomId: args.chatroomId,
      senderRole: args.senderRole,
      content: args.content,
      targetRole,
      type: args.type,
      ...(args.attachedTaskIds &&
        args.attachedTaskIds.length > 0 && { attachedTaskIds: args.attachedTaskIds }),
    });

    await ctx.db.patch('chatroom_rooms', args.chatroomId, {
      lastActivityAt: Date.now(),
    });

    if (isHandoffToAgent) {
      const queuePosition = await getAndIncrementQueuePosition(ctx, chatroom);
      const assignedTo = targetRole;
      const { taskId } = await createTaskUsecase(ctx, {
        chatroomId: args.chatroomId,
        createdBy: args.senderRole,
        content: args.content,
        forceStatus: 'pending',
        assignedTo,
        sourceMessageId: messageId,
        attachedTaskIds: args.attachedTaskIds,
        queuePosition,
        origin: 'chat',
      });
      await ctx.db.patch('chatroom_messages', messageId, { taskId });
    }

    return messageId;
  }
}

// =============================================================================
// PUBLIC MUTATIONS - sendMessage is preferred, send is deprecated
// =============================================================================

/** @deprecated Use sendMessage instead. */
export const send = mutation({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    senderRole: v.string(),
    content: v.string(),
    targetRole: v.optional(v.string()),
    type: v.union(v.literal('message'), v.literal('handoff')),
    attachedTaskIds: v.optional(v.array(v.id('chatroom_tasks'))),
  },
  handler: async (ctx, args) => {
    return _sendMessageHandler(ctx, args);
  },
});

/** Internal handler for completing a task and handing off. */
async function _handoffHandler(
  ctx: MutationCtx,
  args: {
    sessionId: string;
    chatroomId: Id<'chatroom_rooms'>;
    senderRole: string;
    content: string;
    targetRole: string;
    attachedArtifactIds?: Id<'chatroom_artifacts'>[];
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

  // Step 1: Complete ALL in_progress and acknowledged tasks
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
  const tasksToComplete = [...inProgressTasks, ...acknowledgedTasks];

  const completedTaskIds: Id<'chatroom_tasks'>[] = [];

  for (const task of tasksToComplete) {
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

  if (tasksToComplete.length > 1) {
    console.warn(
      `[handoff] Completed ${tasksToComplete.length} tasks (in_progress + acknowledged) in chatroom ${args.chatroomId}`
    );
  }

  // Step 2: Send the handoff message
  const messageId = await ctx.db.insert('chatroom_messages', {
    chatroomId: args.chatroomId,
    senderRole: args.senderRole,
    content: args.content,
    targetRole: args.targetRole,
    type: 'handoff',
    ...(args.attachedArtifactIds &&
      args.attachedArtifactIds.length > 0 && { attachedArtifactIds: args.attachedArtifactIds }),
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

    const { taskId: createdTaskId } = await createTaskUsecase(ctx, {
      chatroomId: args.chatroomId,
      createdBy: args.senderRole,
      content: args.content,
      forceStatus: 'pending', // Handoffs always start as pending
      assignedTo: args.targetRole,
      sourceMessageId: messageId,
      queuePosition,
      origin: 'chat',
    });
    newTaskId = createdTaskId;

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
    await ctx.db.patch('chatroom_participants', participant._id, {
      lastSeenAt: Date.now(),
    });
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

  // Step 6: Queue promotion is now handled automatically by the transitionTask usecase
  // whenever a task transitions to 'completed'. No inline promotion needed here.

  return {
    success: true,
    error: null,
    messageId,
    completedTaskIds,
    newTaskId,
    promotedTaskId: null,
  };
}

/** Completes the current task and sends a handoff message atomically (deprecated — use handoff instead). */
export const sendHandoff = mutation({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    senderRole: v.string(),
    content: v.string(),
    targetRole: v.string(),
    attachedArtifactIds: v.optional(v.array(v.id('chatroom_artifacts'))),
  },
  handler: async (ctx, args) => {
    return _handoffHandler(ctx, args);
  },
});

/** Sends a message to a chatroom without completing the current task. */
export const sendMessage = mutation({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    senderRole: v.string(),
    content: v.string(),
    targetRole: v.optional(v.string()),
    type: v.union(v.literal('message'), v.literal('handoff')),
    attachedTaskIds: v.optional(v.array(v.id('chatroom_tasks'))),
  },
  handler: async (ctx, args) => {
    return _sendMessageHandler(ctx, args);
  },
});

/** Completes the current task and sends a handoff message atomically. */
export const handoff = mutation({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    senderRole: v.string(),
    content: v.string(),
    targetRole: v.string(),
    attachedArtifactIds: v.optional(v.array(v.id('chatroom_artifacts'))),
  },
  handler: async (ctx, args) => {
    return _handoffHandler(ctx, args);
  },
});

/** Sends a progress update message linked to the current in_progress task. */
export const reportProgress = mutation({
  args: {
    ...SessionIdArg,
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

/** Marks a task as started and classifies the originating user message. */
export const taskStarted = mutation({
  args: {
    ...SessionIdArg,
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

    // Get the associated message (pending tasks have sourceMessageId; queued tasks have queuedMessageId)
    let message: Doc<'chatroom_messages'> | null = null;
    let queuedMessage: Doc<'chatroom_messageQueue'> | null = null;

    if (task.sourceMessageId) {
      message = await ctx.db.get('chatroom_messages', task.sourceMessageId);
    } else if (task.queuedMessageId) {
      queuedMessage = await ctx.db.get('chatroom_messageQueue', task.queuedMessageId);
    } else {
      throw new ConvexError({
        code: 'INVALID_TASK',
        message: 'Task must have an associated message (sourceMessageId or queuedMessageId)',
      });
    }

    // Only allow classification of user messages (skip this check if we're not classifying)
    if (!args.skipClassification && (message ?? queuedMessage)!.senderRole.toLowerCase() !== 'user') {
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

    // Update the message with classification — for chatroom_messages only
    // chatroom_messageQueue classification will be set at promotion time (Phase 3)
    if (!args.skipClassification && message && !message.classification) {
      await ctx.db.patch('chatroom_messages', message._id, {
        classification: finalClassification,
        ...(featureTitle && { featureTitle }),
        ...(featureDescription && { featureDescription }),
        ...(featureTechSpecs && { featureTechSpecs }),
      });
    } else if (!args.skipClassification && queuedMessage && !queuedMessage.classification) {
      await ctx.db.patch('chatroom_messageQueue', queuedMessage._id, {
        classification: finalClassification,
        ...(featureTitle && { featureTitle }),
        ...(featureDescription && { featureDescription }),
        ...(featureTechSpecs && { featureTechSpecs }),
      });
    }

    // Note: Attached backlog tasks remain in their current status when agent acknowledges.
    // They will only be transitioned to pending_user_review when the agent hands off to user.

    // For follow-ups, link to the previous non-follow-up message
    if (!args.skipClassification && finalClassification === 'follow_up' && (message || queuedMessage)) {
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
          msg._id !== (message?._id ?? queuedMessage!._id) &&
          msg.senderRole.toLowerCase() === 'user' &&
          msg.classification &&
          msg.classification !== 'follow_up'
        ) {
          originMessage = msg;
          break;
        }
      }

      if (originMessage && message) {
        // Link this follow-up to the original message (only for chatroom_messages)
        await ctx.db.patch('chatroom_messages', message._id, {
          taskOriginMessageId: originMessage._id,
        });
      }
      // For queued messages, skip the origin link (will be set at promotion time)
    }

    // Generate a focused reminder for this role + classification
    let reminder = '';
    try {
      reminder = generateTaskStartedReminder(
        args.role,
        finalClassification,
        args.chatroomId,
        (message?._id ?? queuedMessage?._id)?.toString(),
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

/** Returns the allowed handoff roles for a given role based on the current message classification. */
export const getAllowedHandoffRoles = query({
  args: {
    ...SessionIdArg,
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

    // Find waiting participants (all participants except current role)
    // No presence filter - always send notification regardless of last seen time
    const waitingParticipants = participants.filter(
      (p) => p.role.toLowerCase() !== args.role.toLowerCase()
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

/** Returns all messages in a chatroom up to an optional limit. */
export const list = query({
  args: {
    ...SessionIdArg,
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

/** Returns queued messages (from chatroom_messageQueue) for a chatroom. */
export const listQueued = query({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    // Validate session and check chatroom access (chatroom not needed)
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

    const queuedMessages = await ctx.db
      .query('chatroom_messageQueue')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', args.chatroomId))
      .collect();

    // Enforce maximum limit to prevent unbounded queries
    const MAX_LIMIT = 1000;
    const limit = args.limit ? Math.min(args.limit, MAX_LIMIT) : MAX_LIMIT;

    // Transform queue records to match message shape + add isQueued flag
    const transformedMessages = queuedMessages.map((qMsg) => ({
      _id: qMsg._id,
      _creationTime: qMsg._creationTime,
      chatroomId: qMsg.chatroomId,
      senderRole: qMsg.senderRole,
      targetRole: qMsg.targetRole,
      content: qMsg.content,
      type: qMsg.type,
      taskId: qMsg.taskId,
      classification: qMsg.classification,
      featureTitle: qMsg.featureTitle,
      featureDescription: qMsg.featureDescription,
      featureTechSpecs: qMsg.featureTechSpecs,
      attachedTaskIds: qMsg.attachedTaskIds,
      attachedArtifactIds: qMsg.attachedArtifactIds,
      // Add queue-specific flags
      isQueued: true as const,
      queuePosition: undefined as number | undefined, // Will be enriched from task if needed
    }));

    return transformedMessages.slice(-limit);
  },
});

/** Returns messages in descending order with task status and attached task/artifact details, paginated. */
export const listPaginated = query({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    // Validate session and check chatroom access (chatroom not needed)
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

    // Paginate with descending order (newest first)
    // Filter out progress messages (shown inline in task headers) and
    // legacy join messages (no longer created) at the DB level so pagination
    // counts only displayable messages.
    const result = await ctx.db
      .query('chatroom_messages')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', args.chatroomId))
      .filter((q) => q.and(q.neq(q.field('type'), 'join'), q.neq(q.field('type'), 'progress')))
      .order('desc')
      .paginate(args.paginationOpts);

    // Enrich messages with task status and attached task details
    const enrichedPage = await Promise.all(
      result.page.map(async (message) => {
        // Fetch task status if message has a linked task
        let taskStatus: TaskStatus | undefined;
        if (message.taskId) {
          const task = await ctx.db.get('chatroom_tasks', message.taskId);
          taskStatus = task?.status;
        }

        // Fetch attached task details if message has attached tasks
        let attachedTasks:
          | {
              _id: string;
              content: string;
              backlogStatus?: TaskStatus;
              status: TaskStatus;
              origin?: string;
            }[]
          | undefined;
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
              // Compute backlogStatus from actual task status for display in the UI
              backlogStatus: t!.status,
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

/** Returns all progress messages for a task in chronological order. */
export const getProgressForTask = query({
  args: {
    ...SessionIdArg,
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

/** Returns the context window: messages from the latest non-follow-up user message onward. */
export const getContextWindow = query({
  args: {
    ...SessionIdArg,
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

/** Claims a broadcast message for a specific role to prevent duplicate processing. */
export const claimMessage = mutation({
  args: {
    ...SessionIdArg,
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

/** Returns the next unprocessed message for a role based on routing rules. */
export const getLatestForRole = query({
  args: {
    ...SessionIdArg,
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

    // Find present participants (seen within presence window, excluding current role)
    // Find waiting participants (all participants except current role)
    // No presence filter - always send notification regardless of last seen time
    const waitingParticipants = participants.filter(
      (p) => p.role.toLowerCase() !== args.role.toLowerCase()
    );

    // Sort by priority to find highest priority waiting
    waitingParticipants.sort((a, b) => getRolePriority(a.role) - getRolePriority(b.role));
    const highestPriorityWaiting = waitingParticipants[0]?.role;

    // Determine entry point for user messages
    const entryPoint = getTeamEntryPoint(chatroom);

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

/** Returns messages classified as new_feature with feature metadata, most recent first. */
export const listFeatures = query({
  args: {
    ...SessionIdArg,
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

/** Returns full details and conversation thread for a specific feature message. */
export const inspectFeature = query({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    messageId: v.union(v.id('chatroom_messages'), v.id('chatroom_messageQueue')),
  },
  handler: async (ctx, args) => {
    // Validate session and check chatroom access (chatroom not needed)
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

    // Try to get the message from either table
    // First try chatroom_messages, then chatroom_messageQueue
    let message: Doc<'chatroom_messages'> | Doc<'chatroom_messageQueue'> | null = null;
    
    // Check if it's in chatroom_messages
    const regularMessage = await ctx.db.get('chatroom_messages', args.messageId as Id<'chatroom_messages'>).catch(() => null);
    if (regularMessage && regularMessage.chatroomId === args.chatroomId) {
      message = regularMessage;
    } else {
      // Try chatroom_messageQueue
      const queuedMessage = await ctx.db.get('chatroom_messageQueue', args.messageId as Id<'chatroom_messageQueue'>).catch(() => null);
      if (queuedMessage && queuedMessage.chatroomId === args.chatroomId) {
        message = queuedMessage;
      }
    }

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

/** Returns a role-specific prompt with team context, classification, and allowed handoff targets. */
export const getRolePrompt = query({
  args: {
    ...SessionIdArg,
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

    // Find present participants (excluding current role)
    const waitingParticipants = participants.filter(
      (p) => p.role.toLowerCase() !== args.role.toLowerCase()
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
      teamId: chatroom.teamId,
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

/** Returns the full initialization prompt for an agent joining a chatroom. */
export const getInitPrompt = query({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    role: v.string(),
    convexUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { chatroom } = await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

    // Look up actual participants to provide real availability data
    const participants = await ctx.db
      .query('chatroom_participants')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', args.chatroomId))
      .collect();

    // All participants are available members (no presence filter)
    const availableMembers = participants.map((p) => p.role);

    // Look up existing team agent config to include the agent type in the prompt
    const teamRoleKey = `chatroom_${chatroom._id}#role_${args.role.toLowerCase()}`;
    const existingAgentConfig = await ctx.db
      .query('chatroom_teamAgentConfigs')
      .withIndex('by_teamRoleKey', (q) => q.eq('teamRoleKey', teamRoleKey))
      .unique();

    const promptInput = {
      chatroomId: args.chatroomId,
      role: args.role,
      teamId: chatroom.teamId,
      teamName: chatroom.teamName || 'Team',
      teamRoles: chatroom.teamRoles || [],
      teamEntryPoint: chatroom.teamEntryPoint,
      convexUrl: config.getConvexURLWithFallback(args.convexUrl),
      availableMembers,
      agentType: (existingAgentConfig?.type ?? 'unset') as 'remote' | 'custom' | 'unset',
    };

    // Compose init prompt (system prompt + init message + combined)
    const composed = composeInitPrompt(promptInput);

    // Resolve agent config to determine system prompt control
    const agentConfigResult = await getAgentConfig(ctx, {
      chatroomId: args.chatroomId,
      role: args.role,
    });
    const hasSystemPromptControl =
      agentConfigResult.found && agentConfigResult.config.hasSystemPromptControl;

    return {
      /** Combined prompt for manual mode (harnesses without system prompt support) */
      prompt: composed.initPrompt,
      /** System prompt: general instructions + role identity (for machine mode) */
      rolePrompt: composed.systemPrompt,
      /** Init message: context-gaining and next steps (first user message in machine mode) */
      initialMessage: composed.initMessage,
      /** Whether the agent has system prompt control (remote agents). If true, init prompt can be skipped. */
      hasSystemPromptControl,
    };
  },
});

/** Returns the complete task delivery prompt and structured JSON context for an agent receiving a task. */
export const getTaskDeliveryPrompt = query({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    role: v.string(),
    taskId: v.id('chatroom_tasks'),
    messageId: v.optional(v.union(v.id('chatroom_messages'), v.id('chatroom_messageQueue'))),
    convexUrl: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<TaskDeliveryPromptResponse> => {
    // Validate session and check chatroom access
    const { chatroom } = await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

    // Fetch current context for explicit context management
    let currentContext: {
      _id: string;
      content: string;
      createdBy: string;
      createdAt: number;
      messagesSinceContext: number;
      elapsedHours: number;
    } | null = null;

    if (chatroom.currentContextId) {
      const context = await ctx.db.get('chatroom_contexts', chatroom.currentContextId);
      if (context) {
        // Get current message count to compute staleness
        const allMessages = await ctx.db
          .query('chatroom_messages')
          .withIndex('by_chatroom', (q) => q.eq('chatroomId', args.chatroomId))
          .collect();
        const currentMessageCount = allMessages.length;
        const messagesSinceContext = currentMessageCount - (context.messageCountAtCreation ?? 0);

        // Compute time elapsed since context creation
        const elapsedMs = Date.now() - context.createdAt;
        const elapsedHours = elapsedMs / (1000 * 60 * 60);

        currentContext = {
          _id: context._id,
          content: context.content,
          createdBy: context.createdBy,
          createdAt: context.createdAt,
          messagesSinceContext,
          elapsedHours,
        };
      }
    }

    // Fetch the task
    const task = await ctx.db.get('chatroom_tasks', args.taskId);
    if (!task) {
      throw new ConvexError({
        code: 'TASK_NOT_FOUND',
        message: 'Task not found',
      });
    }

    // Fetch the message if provided (could be in either table)
    let message: Doc<'chatroom_messages'> | Doc<'chatroom_messageQueue'> | null = null;
    if (args.messageId) {
      // Try chatroom_messages first
      const regularMessage = await ctx.db.get('chatroom_messages', args.messageId as Id<'chatroom_messages'>).catch(() => null);
      if (regularMessage) {
        message = regularMessage;
      } else {
        // Try chatroom_messageQueue
        const queuedMessage = await ctx.db.get('chatroom_messageQueue', args.messageId as Id<'chatroom_messageQueue'>).catch(() => null);
        if (queuedMessage) {
          message = queuedMessage;
        }
      }
    }

    // Fetch participants
    const participants = await ctx.db
      .query('chatroom_participants')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', args.chatroomId))
      .collect();

    // Get role prompt info (reuse existing logic)
    const waitingParticipants = participants.filter(
      (p) => p.role.toLowerCase() !== args.role.toLowerCase()
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
    const availableMembers = waitingParticipants.map((p) => p.role);

    const rolePromptText = generateRolePrompt({
      chatroomId: args.chatroomId,
      role: args.role,
      teamId: chatroom.teamId,
      teamName: chatroom.teamName || 'Team',
      teamRoles: chatroom.teamRoles || [],
      teamEntryPoint: chatroom.teamEntryPoint,
      currentClassification,
      availableHandoffRoles,
      canHandoffToUser,
      restrictionReason,
      convexUrl: config.getConvexURLWithFallback(args.convexUrl),
      availableMembers,
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

    // Calculate follow-up count since origin message
    let followUpCountSinceOrigin = 0;
    if (originIndex >= 0) {
      for (let i = originIndex + 1; i < contextMessages.length; i++) {
        const msg = contextMessages[i];
        if (
          msg.senderRole.toLowerCase() === 'user' &&
          msg.type === 'message' &&
          msg.classification === 'follow_up'
        ) {
          followUpCountSinceOrigin++;
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
      { id: string; content: string; status: TaskStatus; createdBy: string; backlogStatus?: string }
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
        lastSeenAction: p.lastSeenAction ?? null,
      })),
      contextWindow: {
        // Explicit context (new system)
        currentContext,
        // Origin message (legacy, for fallback when no context set)
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
        // Staleness metadata for warning display
        originMessageCreatedAt: originMessage?._creationTime ?? null,
        followUpCountSinceOrigin,
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

    // Determine entry point status for context management
    const entryPoint = getTeamEntryPoint(chatroom);
    const isEntryPoint = entryPoint ? args.role.toLowerCase() === entryPoint.toLowerCase() : true; // Default to true if no entry point configured
    // Generate the complete CLI output (backend-generated, CLI just prints it)
    const fullCliOutput = generateFullCliOutput({
      chatroomId: args.chatroomId,
      role: args.role,
      cliEnvPrefix,
      task: {
        _id: task._id,
        content: task.content,
      },
      message: message
        ? {
            _id: message._id,
            senderRole: message.senderRole,
            content: message.content,
          }
        : null,
      currentContext,
      originMessage: originMessage
        ? {
            senderRole: originMessage.senderRole,
            content: originMessage.content,
            classification: originMessage.classification,
            attachedTasks: originMessage.attachedTaskIds
              ?.map((id) => attachedTasksMap.get(id))
              .filter(Boolean)
              .map((t) => ({
                status: t!.status,
                content: t!.content,
              })),
          }
        : null,
      followUpCountSinceOrigin,
      originMessageCreatedAt: originMessage?._creationTime ?? null,
      isEntryPoint,
      availableHandoffTargets: availableHandoffRoles,
    });

    return {
      fullCliOutput,
      json: deliveryContext,
    };
  },
});

// =============================================================================
// SENDER ROLE BASED QUERIES - For user-centric pagination
// =============================================================================

/** Returns messages filtered by sender role in descending order. */
export const listBySenderRole = query({
  args: {
    ...SessionIdArg,
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
        let taskStatus: TaskStatus | undefined;
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

/** Returns all messages from a given message ID onward (inclusive), in ascending order. */
export const listSinceMessage = query({
  args: {
    ...SessionIdArg,
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
        let taskStatus: TaskStatus | undefined;
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

/** Returns enriched conversation history, context window, and pending task count for a role. */
export const getContextForRole = query({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    role: v.string(),
  },
  handler: async (ctx, args) => {
    // Validate session and check chatroom access
    const { chatroom } = await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

    // Fetch the current pinned context (if any) from chatroom_contexts
    let currentContext: {
      content: string;
      createdBy: string;
      createdAt: number;
    } | null = null;

    // If the pinned context has a triggerMessageId, use it as the origin anchor
    let originMessageId: string | null = null;

    if (chatroom.currentContextId) {
      const contextDoc = await ctx.db.get('chatroom_contexts', chatroom.currentContextId);
      if (contextDoc) {
        currentContext = {
          content: contextDoc.content,
          createdBy: contextDoc.createdBy,
          createdAt: contextDoc.createdAt,
        };
        // NEW: use triggerMessageId as origin anchor if available
        if (contextDoc.triggerMessageId) {
          originMessageId = contextDoc.triggerMessageId.toString();
        }
      }
    }

    // Get context window (origin message + all messages since)
    const contextWindow = await ctx.db
      .query('chatroom_messages')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', args.chatroomId))
      .order('desc')
      .take(200);

    const messages = contextWindow.reverse();

    // Find origin message
    // If triggerMessageId is set from the pinned context, use it directly;
    // otherwise fall back to the heuristic (latest non-follow-up user message with acknowledgedAt)
    let originMessage: (typeof messages)[0] | null = null;
    let originIndex = -1;

    if (originMessageId) {
      // Use triggerMessageId as the anchor directly
      originIndex = messages.findIndex((m) => m._id.toString() === originMessageId);
      originMessage = originIndex >= 0 ? messages[originIndex] : null;
    } else {
      // Heuristic: find the latest non-follow-up user message with acknowledgedAt set
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
    }

    // Get messages from origin forward
    const contextMessages = originIndex >= 0 ? messages.slice(originIndex) : messages;

    // Enrich messages with task information
    const enrichedMessages = await Promise.all(
      contextMessages.map(async (message) => {
        let taskStatus: TaskStatus | undefined;
        let taskContent: string | undefined;
        let attachedTasks:
          | {
              _id: string;
              content: string;
              status: TaskStatus;
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
          targetRole: message.targetRole,
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

    // Filter out messages with pending/acknowledged tasks — agents should only
    // discover these through get-next-task, not context read
    const filteredMessages = enrichedMessages.filter((msg) => {
      if (msg.taskStatus === 'pending' || msg.taskStatus === 'acknowledged') {
        return false;
      }
      return true;
    });

    // Count pending tasks for this role
    const allPendingTasks = await ctx.db
      .query('chatroom_tasks')
      .withIndex('by_chatroom_status', (q) =>
        q.eq('chatroomId', args.chatroomId).eq('status', 'pending')
      )
      .collect();

    const pendingTasks = allPendingTasks.filter((task) => task.assignedTo === args.role);

    return {
      messages: filteredMessages,
      currentContext,
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
