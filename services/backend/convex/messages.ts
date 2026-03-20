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
import { buildTeamRoleKey } from './utils/teamRoleKey';
import { generateFullCliOutput } from '../prompts/cli/get-next-task/fullOutput';
import { getConfig } from '../prompts/config/index';
import { getCliEnvPrefix } from '../prompts/utils/index';
import { isActiveParticipant } from '../src/domain/entities/participant';
import { getTeamEntryPoint } from '../src/domain/entities/team';
import { getAgentConfig } from '../src/domain/usecase/agent/get-agent-config';
import { getTeamRolesFromChatroom } from '../src/domain/usecase/chatroom/get-team-roles';
import {
  createTask as createTaskUsecase,
  shouldEnqueueMessage,
} from '../src/domain/usecase/task/create-task';
import { promoteQueuedMessage } from '../src/domain/usecase/task/promote-queued-message';
import { transitionTask, type TaskStatus } from '../src/domain/usecase/task/transition-task';

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
    attachedBacklogItemIds?: Id<'chatroom_backlog'>[];
    attachedMessageIds?: Id<'chatroom_messages'>[];
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
      if (task.status === 'completed') {
        throw new ConvexError({
          code: 'INVALID_TASK_STATUS',
          message: 'Cannot attach completed tasks. Please select active items.',
        });
      }
    }
  }

  // Validate attached backlog items if provided
  if (args.attachedBacklogItemIds && args.attachedBacklogItemIds.length > 0) {
    for (const itemId of args.attachedBacklogItemIds) {
      const item = await ctx.db.get('chatroom_backlog', itemId);
      if (!item) {
        throw new ConvexError({
          code: 'ITEM_NOT_FOUND',
          message:
            'One or more attached backlog items no longer exist. Please refresh and try again.',
        });
      }
      if (item.chatroomId !== args.chatroomId) {
        throw new ConvexError({
          code: 'INVALID_ITEM',
          message: 'Invalid backlog item reference: item belongs to different chatroom.',
        });
      }
      if (item.status === 'closed') {
        throw new ConvexError({
          code: 'INVALID_ITEM_STATUS',
          message: 'Cannot attach closed backlog items.',
        });
      }
    }
  }

  // Validate attached messages if provided
  if (args.attachedMessageIds && args.attachedMessageIds.length > 0) {
    for (const messageId of args.attachedMessageIds) {
      const msg = await ctx.db.get('chatroom_messages', messageId);
      if (!msg) {
        throw new ConvexError({
          code: 'MESSAGE_NOT_FOUND',
          message: 'One or more attached messages no longer exist. Please refresh and try again.',
        });
      }
      if (msg.chatroomId !== args.chatroomId) {
        throw new ConvexError({
          code: 'INVALID_MESSAGE',
          message: 'Invalid message reference: message belongs to different chatroom.',
        });
      }
    }
  }

  // Validate senderRole to prevent impersonation
  // Only allow 'user' or roles that are in the team configuration
  const normalizedSenderRole = args.senderRole.toLowerCase();
  if (normalizedSenderRole !== 'user') {
    // Check if senderRole is in teamRoles
    const { teamRoles, normalizedTeamRoles } = getTeamRolesFromChatroom(chatroom);
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
    const enqueue = await shouldEnqueueMessage(ctx, args.chatroomId);

    if (enqueue) {
      // ─── Queued path: store in chatroom_messageQueue only — no task created yet ──
      // Tasks are created at promotion time (when the queued message is promoted to active).
      const queuedMessageId = await ctx.db.insert('chatroom_messageQueue', {
        chatroomId: args.chatroomId,
        senderRole: args.senderRole,
        targetRole,
        content: args.content,
        type: 'message' as const,
        queuePosition,
        ...(args.attachedTaskIds?.length && { attachedTaskIds: args.attachedTaskIds }),
        ...(args.attachedBacklogItemIds?.length && {
          attachedBacklogItemIds: args.attachedBacklogItemIds,
        }),
        ...(args.attachedMessageIds?.length && { attachedMessageIds: args.attachedMessageIds }),
      });

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
        ...(args.attachedTaskIds?.length && { attachedTaskIds: args.attachedTaskIds }),
        ...(args.attachedBacklogItemIds?.length && {
          attachedBacklogItemIds: args.attachedBacklogItemIds,
        }),
        ...(args.attachedMessageIds?.length && { attachedMessageIds: args.attachedMessageIds }),
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
      });

      await ctx.db.patch('chatroom_messages', messageId, { taskId });

      return messageId;
    }
    // ─── Pending path: existing flow (store in chatroom_messages) ────────
    const messageId = await ctx.db.insert('chatroom_messages', {
      chatroomId: args.chatroomId,
      senderRole: args.senderRole,
      content: args.content,
      targetRole,
      type: args.type,
      ...(args.attachedTaskIds?.length && { attachedTaskIds: args.attachedTaskIds }),
      ...(args.attachedBacklogItemIds?.length && {
        attachedBacklogItemIds: args.attachedBacklogItemIds,
      }),
      ...(args.attachedMessageIds?.length && { attachedMessageIds: args.attachedMessageIds }),
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
    });

    await ctx.db.patch('chatroom_messages', messageId, { taskId });

    return messageId;
  }
  // ─── Non-user messages: always write to chatroom_messages ────────────────
  const messageId = await ctx.db.insert('chatroom_messages', {
    chatroomId: args.chatroomId,
    senderRole: args.senderRole,
    content: args.content,
    targetRole,
    type: args.type,
    ...(args.attachedTaskIds?.length && { attachedTaskIds: args.attachedTaskIds }),
    ...(args.attachedBacklogItemIds?.length && {
      attachedBacklogItemIds: args.attachedBacklogItemIds,
    }),
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
    });
    await ctx.db.patch('chatroom_messages', messageId, { taskId });
  }

  return messageId;
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
    attachedBacklogItemIds: v.optional(v.array(v.id('chatroom_backlog'))),
    attachedMessageIds: v.optional(v.array(v.id('chatroom_messages'))),
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
  const { teamRoles, normalizedTeamRoles } = getTeamRolesFromChatroom(chatroom);
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

  // Validate targetRole is a known team member (or user)
  if (!isHandoffToUser) {
    if (!normalizedTeamRoles.includes(normalizedTargetRole)) {
      return {
        success: false,
        error: {
          code: 'INVALID_TARGET_ROLE',
          message: `Cannot hand off to "${args.targetRole}": this role is not part of the current team. Available targets: ${['user', ...teamRoles].join(', ')}.`,
          suggestedTargets: ['user', ...teamRoles],
        },
        messageId: null,
        completedTaskIds: [],
        newTaskId: null,
        promotedTaskId: null,
      };
    }
  }

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
    // All tasks complete to 'completed' status
    const newStatus: 'completed' = 'completed';

    // Use FSM for transition
    await transitionTask(ctx, task._id, newStatus, 'completeTask');
    completedTaskIds.push(task._id);

    // Set completedAt on the source message (lifecycle tracking)
    if (task.sourceMessageId) {
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
  let promotedTaskId: Id<'chatroom_tasks'> | null = null;
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

  // Step 5: Update attached backlog items to pending_user_review when handing off to user
  // This is the ONLY place where attached backlog items should have their status changed
  if (isHandoffToUser) {
    // For each completed task, get its source message and update attached backlog items
    for (const task of inProgressTasks) {
      if (task.sourceMessageId) {
        const sourceMessage = await ctx.db.get('chatroom_messages', task.sourceMessageId);

        // Update chatroom_backlog items attached via "Attach to Context" (attachedBacklogItemIds)
        if (
          sourceMessage?.attachedBacklogItemIds &&
          sourceMessage.attachedBacklogItemIds.length > 0
        ) {
          const now = Date.now();
          for (const backlogItemId of sourceMessage.attachedBacklogItemIds) {
            const backlogItem = await ctx.db.get('chatroom_backlog', backlogItemId);
            // Only transition items that are in 'backlog' status (not already reviewed/closed)
            if (backlogItem && backlogItem.status === 'backlog') {
              await ctx.db.patch('chatroom_backlog', backlogItemId, {
                status: 'pending_user_review',
                updatedAt: now,
              });
              console.warn(
                `[Attached Backlog Item Update] chatroomId=${task.chatroomId} itemId=${backlogItemId} ` +
                  `from=backlog to=pending_user_review`
              );
            }
          }
        }
      }
    }
  }

  // Step 6: Explicit queue promotion on handoff-to-user
  // When handing off to user, we need to explicitly promote the next queued task
  // because areAllAgentsWaiting() returns false at this point (the sender is still
  // marked as "working"). We check: no active tasks remain → promote next queued task.
  if (isHandoffToUser) {
    // Check if there are any remaining active tasks (pending, acknowledged, or in_progress).
    // 'acknowledged' must be included: a claimed task is actively being worked on.
    // Promoting a queued message while an acknowledged task exists would create a
    // race condition where two tasks compete for agent attention simultaneously.
    // Check if any active task exists using indexed lookups instead of
    // loading all tasks. Short-circuit: stop as soon as one is found.
    const pendingTask = await ctx.db
      .query('chatroom_tasks')
      .withIndex('by_chatroom_status', (q) =>
        q.eq('chatroomId', args.chatroomId).eq('status', 'pending')
      )
      .first();
    const acknowledgedTask = pendingTask
      ? null
      : await ctx.db
          .query('chatroom_tasks')
          .withIndex('by_chatroom_status', (q) =>
            q.eq('chatroomId', args.chatroomId).eq('status', 'acknowledged')
          )
          .first();
    const inProgressTask =
      pendingTask || acknowledgedTask
        ? null
        : await ctx.db
            .query('chatroom_tasks')
            .withIndex('by_chatroom_status', (q) =>
              q.eq('chatroomId', args.chatroomId).eq('status', 'in_progress')
            )
            .first();
    const hasActiveTask = !!(pendingTask || acknowledgedTask || inProgressTask);

    if (!hasActiveTask) {
      // No active tasks — find oldest queued message and promote it
      const queuedMessages = await ctx.db
        .query('chatroom_messageQueue')
        .withIndex('by_chatroom_queue', (q) => q.eq('chatroomId', args.chatroomId))
        .order('asc')
        .first();

      if (queuedMessages) {
        const promoted = await promoteQueuedMessage(ctx, queuedMessages._id);
        if (promoted) {
          promotedTaskId = promoted.taskId;
        }
      }
    }
  }

  return {
    success: true,
    error: null,
    messageId,
    completedTaskIds,
    newTaskId,
    promotedTaskId,
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
    attachedBacklogItemIds: v.optional(v.array(v.id('chatroom_backlog'))),
    attachedMessageIds: v.optional(v.array(v.id('chatroom_messages'))),
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
    const { teamRoles, normalizedTeamRoles } = getTeamRolesFromChatroom(chatroom);
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
      .withIndex('by_chatroom_status_assignedTo', (q) =>
        q
          .eq('chatroomId', args.chatroomId)
          .eq('status', 'in_progress')
          .eq('assignedTo', args.senderRole)
      )
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

    // Get the associated message (user-originated tasks have sourceMessageId;
    // system-generated tasks like skill activations may not)
    let message: Doc<'chatroom_messages'> | null = null;

    if (task.sourceMessageId) {
      message = await ctx.db.get('chatroom_messages', task.sourceMessageId);
    }
    // System tasks without a sourceMessageId are allowed — they skip classification below

    // Only allow classification of user messages (skip this check for system tasks or when not classifying)
    if (
      !args.skipClassification &&
      message !== null &&
      message.senderRole.toLowerCase() !== 'user'
    ) {
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

    // System tasks (no sourceMessageId) have no associated user message — skip classification entirely
    if (!task.sourceMessageId) {
      return {
        success: true,
        taskId: task._id,
        chatroomId: task.chatroomId,
        classification: 'question' as const, // System tasks are treated as questions
        isSystemTask: true,
      };
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

    // Update the message with classification
    if (!args.skipClassification && message && !message.classification) {
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

      if (originMessage && message) {
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
        message?._id?.toString(),
        args.taskId.toString(),
        args.convexUrl,
        getTeamRolesFromChatroom(chatroom).teamRoles
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

    // Get active participants (exclude exited agents)
    const participants = await ctx.db
      .query('chatroom_participants')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', args.chatroomId))
      .collect();

    const waitingParticipants = participants.filter(
      (p) => p.role.toLowerCase() !== args.role.toLowerCase() && isActiveParticipant(p)
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

/** Returns recent messages in a chatroom up to an optional limit. */
export const list = query({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    // Validate session and check chatroom access (chatroom not needed)
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

    // Enforce maximum limit to prevent unbounded queries
    const MAX_LIMIT = 1000;
    const limit = args.limit ? Math.min(args.limit, MAX_LIMIT) : MAX_LIMIT;

    // Fetch the most recent N messages (desc order) then reverse for chronological
    const recentMessages = await ctx.db
      .query('chatroom_messages')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', args.chatroomId))
      .order('desc')
      .take(limit);

    return recentMessages.reverse();
  },
});

/** Deletes a queued message record from chatroom_messageQueue (user-triggered dismiss). */
export const deleteQueuedMessage = mutation({
  args: {
    ...SessionIdArg,
    queuedMessageId: v.id('chatroom_messageQueue'),
  },
  handler: async (ctx, args) => {
    const queueRecord = await ctx.db.get('chatroom_messageQueue', args.queuedMessageId);
    if (!queueRecord) {
      // Already deleted — idempotent
      return { success: true };
    }

    // Validate session and check chatroom access
    await requireChatroomAccess(ctx, args.sessionId, queueRecord.chatroomId);

    // Delete the queue record
    await ctx.db.delete('chatroom_messageQueue', args.queuedMessageId);

    return { success: true };
  },
});

/** Deletes a pending message from chatroom_messages and its associated pending task (user-triggered cancel).
 *  Only messages with a linked task in 'pending' status can be deleted — messages that are already
 *  being processed (acknowledged / in_progress) are protected.
 */
export const deletePendingMessage = mutation({
  args: {
    ...SessionIdArg,
    messageId: v.id('chatroom_messages'),
  },
  handler: async (ctx, args) => {
    const message = await ctx.db.get('chatroom_messages', args.messageId);
    if (!message) {
      // Already deleted — idempotent
      return { success: true };
    }

    // Validate session and check chatroom access (also verifies ownership)
    await requireChatroomAccess(ctx, args.sessionId, message.chatroomId);

    // Guard: only allow deletion if the linked task is still pending
    if (!message.taskId) {
      throw new ConvexError({
        code: 'INVALID_MESSAGE',
        message: 'Message has no associated task and cannot be deleted.',
      });
    }

    const task = await ctx.db.get('chatroom_tasks', message.taskId);
    if (!task) {
      throw new ConvexError({
        code: 'TASK_NOT_FOUND',
        message: 'Associated task not found.',
      });
    }

    if (task.status !== 'pending') {
      throw new ConvexError({
        code: 'INVALID_TASK_STATUS',
        message: `Cannot delete message: task is already ${task.status}. Only pending messages can be deleted.`,
      });
    }

    // Delete the associated pending task first
    await ctx.db.delete('chatroom_tasks', task._id);

    // Delete the message itself (hard delete)
    await ctx.db.delete('chatroom_messages', args.messageId);

    return { success: true };
  },
});

/** Updates the content of a pending message (task still pending — not yet picked up by an agent).
 *  Also updates the associated task content to stay in sync.
 */
export const updatePendingMessage = mutation({
  args: {
    ...SessionIdArg,
    messageId: v.id('chatroom_messages'),
    content: v.string(),
  },
  handler: async (ctx, args) => {
    const message = await ctx.db.get('chatroom_messages', args.messageId);
    if (!message) {
      throw new ConvexError({
        code: 'MESSAGE_NOT_FOUND',
        message: 'Message not found.',
      });
    }

    // Validate session and check chatroom access
    await requireChatroomAccess(ctx, args.sessionId, message.chatroomId);

    // Validate non-empty content
    const trimmed = args.content.trim();
    if (!trimmed) {
      throw new ConvexError({
        code: 'INVALID_CONTENT',
        message: 'Message content cannot be empty.',
      });
    }

    // Guard: only allow edit if the linked task is still pending
    if (!message.taskId) {
      throw new ConvexError({
        code: 'INVALID_MESSAGE',
        message: 'Message has no associated task and cannot be edited.',
      });
    }

    const task = await ctx.db.get('chatroom_tasks', message.taskId);
    if (!task) {
      throw new ConvexError({
        code: 'TASK_NOT_FOUND',
        message: 'Associated task not found.',
      });
    }

    if (task.status !== 'pending') {
      throw new ConvexError({
        code: 'INVALID_TASK_STATUS',
        message: `Cannot edit message: task is already ${task.status}. Only pending messages can be edited.`,
      });
    }

    // Update the message content
    await ctx.db.patch('chatroom_messages', args.messageId, { content: trimmed });

    // Update the associated task content to stay in sync
    await ctx.db.patch('chatroom_tasks', task._id, {
      content: trimmed,
      updatedAt: Date.now(),
    });

    return { success: true };
  },
});

/** Updates the content of a queued (pending) message before it is dispatched. */
export const updateQueuedMessage = mutation({
  args: {
    ...SessionIdArg,
    queuedMessageId: v.id('chatroom_messageQueue'),
    content: v.string(),
  },
  handler: async (ctx, args) => {
    const queueRecord = await ctx.db.get('chatroom_messageQueue', args.queuedMessageId);
    if (!queueRecord) {
      throw new Error('Queued message not found');
    }

    // Validate session and check chatroom access
    await requireChatroomAccess(ctx, args.sessionId, queueRecord.chatroomId);

    // Validate non-empty content
    const trimmed = args.content.trim();
    if (!trimmed) {
      throw new Error('Message content cannot be empty');
    }

    await ctx.db.patch('chatroom_messageQueue', args.queuedMessageId, { content: trimmed });
    return { success: true };
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
      .withIndex('by_chatroom_queue', (q) => q.eq('chatroomId', args.chatroomId))
      .order('asc') // Ascending by queuePosition (oldest first)
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
      taskId: undefined as undefined, // No task until promoted
      attachedTaskIds: qMsg.attachedTaskIds,
      attachedBacklogItemIds: qMsg.attachedBacklogItemIds,
      attachedArtifactIds: qMsg.attachedArtifactIds,
      attachedMessageIds: qMsg.attachedMessageIds,
      // Add queue-specific flags
      isQueued: true as const,
      queuePosition: qMsg.queuePosition,
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
              status: TaskStatus;
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
            }));
        }

        // Fetch attached backlog item details if message has attached backlog items
        let attachedBacklogItems: { id: string; content: string; status: string }[] | undefined;
        if (message.attachedBacklogItemIds && message.attachedBacklogItemIds.length > 0) {
          const items = await Promise.all(
            message.attachedBacklogItemIds.map((itemId) => ctx.db.get('chatroom_backlog', itemId))
          );
          attachedBacklogItems = items
            .filter((i): i is NonNullable<typeof i> => i !== null)
            .map((i) => ({ id: i._id, content: i.content, status: i.status }));
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

        // Fetch attached message details if message has attached messages
        let attachedMessages:
          | { _id: string; content: string; senderRole: string; _creationTime: number }[]
          | undefined;
        if (message.attachedMessageIds && message.attachedMessageIds.length > 0) {
          const msgs = await Promise.all(
            message.attachedMessageIds.map((msgId) => ctx.db.get('chatroom_messages', msgId))
          );
          attachedMessages = msgs
            .filter((m): m is NonNullable<typeof m> => m !== null)
            .map((m) => ({
              _id: m._id,
              content: m.content,
              senderRole: m.senderRole,
              _creationTime: m._creationTime,
            }));
        }

        return {
          ...message,
          ...(taskStatus && { taskStatus }),
          ...(attachedTasks && attachedTasks.length > 0 && { attachedTasks }),
          ...(attachedBacklogItems && attachedBacklogItems.length > 0 && { attachedBacklogItems }),
          ...(attachedArtifacts && attachedArtifacts.length > 0 && { attachedArtifacts }),
          ...(attachedMessages && attachedMessages.length > 0 && { attachedMessages }),
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
            // Origin is older than our recent window — use compound index to fetch
            // messages from the origin's creation time onward (avoids loading ALL messages)
            const contextMessages = await ctx.db
              .query('chatroom_messages')
              .withIndex('by_chatroom', (q) =>
                q
                  .eq('chatroomId', args.chatroomId)
                  .gte('_creationTime', originMessage._creationTime)
              )
              .collect();
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

    const waitingParticipants = participants.filter(
      (p) => p.role.toLowerCase() !== args.role.toLowerCase() && isActiveParticipant(p)
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

    // Use the senderRole+type compound index to narrow to user messages,
    // then filter for new_feature classification. Scan desc to get newest first.
    // Over-fetch to compensate for post-filter on classification.
    const candidateMessages = await ctx.db
      .query('chatroom_messages')
      .withIndex('by_chatroom_senderRole_type_createdAt', (q) =>
        q.eq('chatroomId', args.chatroomId).eq('senderRole', 'user').eq('type', 'message')
      )
      .order('desc')
      .take(effectiveLimit * 10); // Over-fetch since not all user messages are new_feature

    // Filter to new_feature messages with feature title
    const features = candidateMessages
      .filter((msg) => msg.classification === 'new_feature' && msg.featureTitle)
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
    const regularMessage = await ctx.db
      .get('chatroom_messages', args.messageId as Id<'chatroom_messages'>)
      .catch(() => null);
    if (regularMessage && regularMessage.chatroomId === args.chatroomId) {
      message = regularMessage;
    } else {
      // Try chatroom_messageQueue
      const queuedMessage = await ctx.db
        .get('chatroom_messageQueue', args.messageId as Id<'chatroom_messageQueue'>)
        .catch(() => null);
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
    // Queued messages never have classification — only promoted chatroom_messages can be features
    const regularMsg = message as Doc<'chatroom_messages'>;
    if (regularMsg.classification !== 'new_feature' || !regularMsg.featureTitle) {
      throw new ConvexError({
        code: 'INVALID_MESSAGE',
        message: 'Message is not a feature',
      });
    }

    // Use compound index to fetch messages from this message's creation time onward
    // instead of loading ALL messages in the chatroom
    const messagesFromFeature = await ctx.db
      .query('chatroom_messages')
      .withIndex('by_chatroom', (q) =>
        q.eq('chatroomId', args.chatroomId).gte('_creationTime', regularMsg._creationTime)
      )
      .take(500); // Reasonable upper bound for a feature thread

    // Get all messages after this one until the next non-follow-up user message
    const thread: {
      id: string;
      senderRole: string;
      content: string;
      type: string;
      createdAt: number;
    }[] = [];

    // Skip past the feature message itself, then collect thread
    let foundFeatureMsg = false;
    for (const msg of messagesFromFeature) {
      if (!foundFeatureMsg) {
        if (msg._id === args.messageId) {
          foundFeatureMsg = true;
        }
        continue;
      }

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
        title: regularMsg.featureTitle,
        description: regularMsg.featureDescription,
        techSpecs: regularMsg.featureTechSpecs,
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

    const waitingParticipants = participants.filter(
      (p) => p.role.toLowerCase() !== args.role.toLowerCase() && isActiveParticipant(p)
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

    const availableMembers = participants.filter(isActiveParticipant).map((p) => p.role);

    // Look up existing team agent config to include the agent type in the prompt
    const teamRoleKey = chatroom.teamId
      ? buildTeamRoleKey(chatroom._id, chatroom.teamId, args.role)
      : null;
    const existingAgentConfig = teamRoleKey
      ? await ctx.db
          .query('chatroom_teamAgentConfigs')
          .withIndex('by_teamRoleKey', (q) => q.eq('teamRoleKey', teamRoleKey))
          .first()
      : null;

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
        // Count only messages since context creation to compute staleness.
        // Uses compound index for an indexed range scan (no full table scan).
        const recentMessages = await ctx.db
          .query('chatroom_messages')
          .withIndex('by_chatroom', (q) =>
            q.eq('chatroomId', args.chatroomId).gte('_creationTime', context.createdAt)
          )
          .collect();
        const messagesSinceContext = recentMessages.length;

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
      const regularMessage = await ctx.db
        .get('chatroom_messages', args.messageId as Id<'chatroom_messages'>)
        .catch(() => null);
      if (regularMessage) {
        message = regularMessage;
      } else {
        // Try chatroom_messageQueue
        const queuedMessage = await ctx.db
          .get('chatroom_messageQueue', args.messageId as Id<'chatroom_messageQueue'>)
          .catch(() => null);
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

    const waitingParticipants = participants.filter(
      (p) => p.role.toLowerCase() !== args.role.toLowerCase() && isActiveParticipant(p)
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
      { id: string; content: string; status: TaskStatus; createdBy: string }
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
          });
        }
      }
    }

    // Fetch attached backlog items if any exist in context messages
    const allAttachedBacklogItemIds: Id<'chatroom_backlog'>[] = [];
    if (originMessage?.attachedBacklogItemIds && originMessage.attachedBacklogItemIds.length > 0) {
      allAttachedBacklogItemIds.push(...originMessage.attachedBacklogItemIds);
    }
    for (const msg of contextMessagesSlice) {
      if (msg.attachedBacklogItemIds && msg.attachedBacklogItemIds.length > 0) {
        allAttachedBacklogItemIds.push(...msg.attachedBacklogItemIds);
      }
    }

    // Fetch attached backlog item details
    const attachedBacklogItemsMap = new Map<
      string,
      { id: string; content: string; status: string }
    >();
    if (allAttachedBacklogItemIds.length > 0) {
      const uniqueItemIds = [...new Set(allAttachedBacklogItemIds)];
      for (const itemId of uniqueItemIds) {
        const item = await ctx.db.get('chatroom_backlog', itemId);
        if (item) {
          attachedBacklogItemsMap.set(itemId, {
            id: item._id,
            content: item.content,
            status: item.status,
          });
        }
      }
    }

    // Fetch attached messages if any exist in origin message
    const attachedMessagesMap = new Map<
      string,
      { id: string; content: string; senderRole: string }
    >();
    if (originMessage?.attachedMessageIds && originMessage.attachedMessageIds.length > 0) {
      for (const msgId of originMessage.attachedMessageIds) {
        const msg = await ctx.db.get('chatroom_messages', msgId);
        if (msg) {
          attachedMessagesMap.set(msgId, {
            id: msg._id,
            content: msg.content,
            senderRole: msg.senderRole,
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
              attachedBacklogItemIds: originMessage.attachedBacklogItemIds,
              attachedBacklogItems: originMessage.attachedBacklogItemIds
                ?.map((id) => attachedBacklogItemsMap.get(id))
                .filter(Boolean) as { id: string; content: string; status: string }[],
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
          attachedBacklogItemIds: m.attachedBacklogItemIds,
          attachedBacklogItems: m.attachedBacklogItemIds
            ?.map((id) => attachedBacklogItemsMap.get(id))
            .filter(Boolean) as { id: string; content: string; status: string }[],
        })),
        classification: originMessage?.classification || null,
        // Staleness metadata for warning display
        originMessageCreatedAt: originMessage?._creationTime ?? null,
        followUpCountSinceOrigin,
      },
      rolePrompt: {
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
            attachedBacklogItems: originMessage.attachedBacklogItemIds
              ?.map((id) => attachedBacklogItemsMap.get(id))
              .filter(Boolean)
              .map((i) => ({
                _id: i!.id,
                status: i!.status,
                content: i!.content,
              })),
            attachedMessages: originMessage.attachedMessageIds
              ?.map((id) => attachedMessagesMap.get(id))
              .filter(Boolean)
              .map((m) => ({
                _id: m!.id,
                content: m!.content,
                senderRole: m!.senderRole,
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

    // Fetch messages from reference creation time onward using compound index
    // for an indexed range scan (avoids scanning all older messages)
    const messages = await ctx.db
      .query('chatroom_messages')
      .withIndex('by_chatroom', (q) =>
        q.eq('chatroomId', args.chatroomId).gte('_creationTime', referenceMessage._creationTime)
      )
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

        // Get full attached backlog item objects (not just IDs)
        let attachedBacklogItems: { id: string; content: string; status: string }[] | undefined;
        if (message.attachedBacklogItemIds && message.attachedBacklogItemIds.length > 0) {
          const items = await Promise.all(
            message.attachedBacklogItemIds.map((itemId) => ctx.db.get('chatroom_backlog', itemId))
          );
          const validItems = items
            .filter((i): i is NonNullable<typeof i> => i !== null)
            .map((i) => ({ id: i._id, content: i.content, status: i.status }));
          if (validItems.length > 0) {
            attachedBacklogItems = validItems;
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
          ...(attachedBacklogItems && attachedBacklogItems.length > 0 && { attachedBacklogItems }),
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
