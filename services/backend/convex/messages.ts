import { paginationOptsValidator } from 'convex/server';
import { ConvexError, v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import { generateRolePrompt, composeInitPrompt } from '../prompts';
import type { Doc, Id } from './_generated/dataModel';
import type { MutationCtx, QueryCtx } from './_generated/server';
import { mutation, query } from './_generated/server';
import { requireChatroomAccess } from './auth/chatroomAccess';
import { getAndIncrementQueuePosition } from './lib/chatroomUtils';
import { buildAvailableHandoffRoles, getLatestUserMessageClassification } from './lib/handoffRoles';
import { getRolePriority } from './lib/hierarchy';
import { isTimelineMessage } from './messageList';
import { buildTeamRoleKey } from './utils/teamRoleKey';
import { generateFullCliOutput } from '../prompts/cli/get-next-task/fullOutput';
import { getConfig } from '../prompts/config/index';
import { getCliEnvPrefix } from '../prompts/utils/index';
import {
  assemblePrimaryDeliveryAttachments,
  resolvePrimaryDeliveryAssemblyInput,
} from '../src/domain/entities/assemble-primary-delivery-attachments';
import { isNativeHarness } from '../src/domain/entities/harness/types';
import { isActiveParticipant } from '../src/domain/entities/participant';
import { getTeamEntryPoint } from '../src/domain/entities/team';
import { getAgentConfig } from '../src/domain/usecase/agent/get-agent-config';
import { restartOfflineAgentsOnUserMessage } from '../src/domain/usecase/agent/restart-offline-agents-on-user-message';
import { getTeamRolesFromChatroom } from '../src/domain/usecase/chatroom/get-team-roles';
import { markChatroomUnread } from '../src/domain/usecase/chatroom/unread-status';
import { loadCurrentContext } from '../src/domain/usecase/context/load-current-context';
import { getChatroomQueueState } from '../src/domain/usecase/task/chatroom-queue-state';
import {
  createTask as createTaskUsecase,
  shouldEnqueueMessage,
} from '../src/domain/usecase/task/create-task';
import { deleteUserMessageOrTask as deleteUserMessageOrTaskUsecase } from '../src/domain/usecase/task/delete-user-message-or-task';
import { maybePromoteNextQueuedTask } from '../src/domain/usecase/task/maybe-promote-next-queued-task';
import { resolveUserMessageRef } from '../src/domain/usecase/task/resolve-user-message-task-link';
import { adjustTaskCount } from '../src/domain/usecase/task/task-counts';
import { transitionTask, type TaskStatus } from '../src/domain/usecase/task/transition-task';
import { updateUserMessageOrTask as updateUserMessageOrTaskUsecase } from '../src/domain/usecase/task/update-user-message-or-task';

const config = getConfig();

// Types for task delivery prompt response
interface TaskDeliveryPromptResponse {
  fullCliOutput: string; // Complete CLI output for task delivery (backend-generated)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  json: any; // Dynamic JSON structure from prompt generator
}

// =============================================================================
// SHARED HELPERS
// =============================================================================

/**
 * Resolves attachment IDs on a message into full attachment details.
 * Shared by listQueued to avoid duplication.
 */
async function enrichMessageAttachments(
  ctx: QueryCtx,
  msg: {
    attachedTaskIds?: Id<'chatroom_tasks'>[];
    attachedBacklogItemIds?: Id<'chatroom_backlog'>[];
    attachedMessageIds?: Id<'chatroom_messages'>[];
    attachedArtifactIds?: Id<'chatroom_artifacts'>[];
    attachedSnippets?: { reference: string; fileSource: string; selectedContent: string }[];
  }
) {
  // Resolve attached tasks
  let attachedTasks: { _id: string; content: string; backlogStatus: string }[] | undefined;
  if (msg.attachedTaskIds && msg.attachedTaskIds.length > 0) {
    const tasks = await Promise.all(
      msg.attachedTaskIds.map((taskId) => ctx.db.get('chatroom_tasks', taskId))
    );
    attachedTasks = tasks
      .filter((t): t is NonNullable<typeof t> => t !== null)
      .map((t) => ({ _id: t._id, content: t.content, backlogStatus: t.status }));
  }

  // Resolve attached backlog items
  let attachedBacklogItems: { id: string; content: string; status: string }[] | undefined;
  if (msg.attachedBacklogItemIds && msg.attachedBacklogItemIds.length > 0) {
    const items = await Promise.all(
      msg.attachedBacklogItemIds.map((itemId) => ctx.db.get('chatroom_backlog', itemId))
    );
    attachedBacklogItems = items
      .filter((i): i is NonNullable<typeof i> => i !== null)
      .map((i) => ({ id: i._id, content: i.content, status: i.status }));
  }

  // Resolve attached messages
  let attachedMessages:
    | { _id: string; content: string; senderRole: string; _creationTime: number }[]
    | undefined;
  if (msg.attachedMessageIds && msg.attachedMessageIds.length > 0) {
    const msgs = await Promise.all(
      msg.attachedMessageIds.map((msgId) => ctx.db.get('chatroom_messages', msgId))
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

  // Resolve attached artifacts
  let attachedArtifacts:
    | { _id: string; filename: string; description?: string; mimeType?: string }[]
    | undefined;
  if (msg.attachedArtifactIds && msg.attachedArtifactIds.length > 0) {
    const artifacts = await Promise.all(
      msg.attachedArtifactIds.map((artifactId) => ctx.db.get('chatroom_artifacts', artifactId))
    );
    attachedArtifacts = artifacts
      .filter((a): a is NonNullable<typeof a> => a !== null)
      .map((a) => ({
        _id: a._id,
        filename: a.filename,
        description: a.description,
        mimeType: a.mimeType,
      }));
  }

  return {
    ...(attachedTasks && attachedTasks.length > 0 && { attachedTasks }),
    ...(attachedBacklogItems && attachedBacklogItems.length > 0 && { attachedBacklogItems }),
    ...(attachedArtifacts && attachedArtifacts.length > 0 && { attachedArtifacts }),
    ...(attachedMessages && attachedMessages.length > 0 && { attachedMessages }),
    ...(msg.attachedSnippets?.length && { attachedSnippets: msg.attachedSnippets }),
  };
}

/**
 * Enriches an array of chatroom messages with task status, attachments, and
 * latest progress information. Used by the messageList module.
 */
export async function enrichMessages(ctx: QueryCtx, messages: Doc<'chatroom_messages'>[]) {
  // Batch task lookups: collect unique taskIds, fetch in parallel
  const uniqueTaskIds = [...new Set(messages.flatMap((m) => (m.taskId != null ? [m.taskId] : [])))];
  const taskMap = new Map<string, { status: string } | null>();
  const taskResults = await Promise.all(
    uniqueTaskIds.map(async (id) => {
      const task = await ctx.db.get('chatroom_tasks', id);
      return [id.toString(), task ? { status: task.status } : null] as const;
    })
  );
  for (const [id, task] of taskResults) {
    taskMap.set(id, task);
  }

  const taskIdsNeedingProgress = [
    ...new Set(messages.flatMap((m) => (m.taskId != null ? [m.taskId] : []))),
  ];
  const progressByTaskId = new Map<
    string,
    { content: string; senderRole: string; _creationTime: number }
  >();
  await Promise.all(
    taskIdsNeedingProgress.map(async (taskId) => {
      const progressMessages = await ctx.db
        .query('chatroom_messages')
        .withIndex('by_taskId', (q) => q.eq('taskId', taskId))
        .filter((q) => q.eq(q.field('type'), 'progress'))
        .order('desc')
        .take(1);
      if (progressMessages.length > 0) {
        const latest = progressMessages[0];
        progressByTaskId.set(taskId.toString(), {
          content: latest.content,
          senderRole: latest.senderRole,
          _creationTime: latest._creationTime,
        });
      }
    })
  );

  const enrichedMessages = await Promise.all(
    messages.map(async (message) => {
      // Use batched task lookup
      let taskStatus: TaskStatus | undefined;
      if (message.taskId) {
        const task = taskMap.get(message.taskId.toString());
        taskStatus = task?.status as TaskStatus | undefined;
      }

      // Resolve attachments (shared helper)
      const attachments = await enrichMessageAttachments(ctx, message);

      const latestProgress = message.taskId
        ? progressByTaskId.get(message.taskId.toString())
        : undefined;

      return {
        ...message,
        ...(taskStatus && { taskStatus }),
        ...attachments,
        ...(latestProgress && { latestProgress }),
      };
    })
  );

  return enrichedMessages;
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
    attachedSnippets?: { reference: string; fileSource: string; selectedContent: string }[];
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

  // Validate attached snippets if provided
  if (args.attachedSnippets?.length) {
    if (args.attachedSnippets.length > 10) {
      throw new ConvexError({
        code: 'TOO_MANY_ATTACHMENTS',
        message: 'Cannot attach more than 10 snippets per message.',
      });
    }
    const refs = new Set<string>();
    for (const snippet of args.attachedSnippets) {
      if (!snippet.reference.startsWith('attachment-reference-')) {
        throw new ConvexError({
          code: 'INVALID_SNIPPET_REFERENCE',
          message: `Invalid snippet reference: ${snippet.reference}`,
        });
      }
      if (refs.has(snippet.reference)) {
        throw new ConvexError({
          code: 'DUPLICATE_SNIPPET_REFERENCE',
          message: `Duplicate snippet reference: ${snippet.reference}`,
        });
      }
      refs.add(snippet.reference);
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
        ...messageAttachmentInsertFields(args),
      });

      // Update materialized queue count
      await adjustTaskCount(ctx, args.chatroomId, 'queueSize', 1);

      // Update chatroom lastActivityAt
      await ctx.db.patch('chatroom_rooms', args.chatroomId, {
        lastActivityAt: Date.now(),
      });

      return queuedMessageId; // Return queue record ID as opaque message ID
    }
    // ─── Pending path: existing flow (store in chatroom_messages) ────────
    const messageId = await ctx.db.insert('chatroom_messages', {
      chatroomId: args.chatroomId,
      senderRole: args.senderRole,
      content: args.content,
      targetRole,
      type: args.type,
      ...messageAttachmentInsertFields(args),
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

    await restartOfflineAgentsOnUserMessage(ctx, args.chatroomId);

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
    ...(args.attachedSnippets?.length && { attachedSnippets: args.attachedSnippets }),
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

  // Update unread status for chatroom owner (skip if sender is the owner's "user" role)
  if (args.senderRole !== 'user' && chatroom.ownerId) {
    await markChatroomUnread(ctx, args.chatroomId, chatroom.ownerId, false);
  }

  return messageId;
}

const attachedSnippetArgsValidator = v.object({
  reference: v.string(),
  fileSource: v.string(),
  selectedContent: v.string(),
});

type MessageAttachmentInserts = {
  attachedTaskIds?: Id<'chatroom_tasks'>[];
  attachedBacklogItemIds?: Id<'chatroom_backlog'>[];
  attachedMessageIds?: Id<'chatroom_messages'>[];
  attachedSnippets?: { reference: string; fileSource: string; selectedContent: string }[];
};

function messageAttachmentInsertFields(args: MessageAttachmentInserts) {
  return {
    ...(args.attachedTaskIds?.length && { attachedTaskIds: args.attachedTaskIds }),
    ...(args.attachedBacklogItemIds?.length && {
      attachedBacklogItemIds: args.attachedBacklogItemIds,
    }),
    ...(args.attachedMessageIds?.length && { attachedMessageIds: args.attachedMessageIds }),
    ...(args.attachedSnippets?.length && { attachedSnippets: args.attachedSnippets }),
  };
}

const sendMessageMutationArgs = {
  ...SessionIdArg,
  chatroomId: v.id('chatroom_rooms'),
  senderRole: v.string(),
  content: v.string(),
  targetRole: v.optional(v.string()),
  type: v.union(v.literal('message'), v.literal('handoff')),
  attachedTaskIds: v.optional(v.array(v.id('chatroom_tasks'))),
  attachedBacklogItemIds: v.optional(v.array(v.id('chatroom_backlog'))),
  attachedMessageIds: v.optional(v.array(v.id('chatroom_messages'))),
  attachedSnippets: v.optional(v.array(attachedSnippetArgsValidator)),
};

/** @deprecated Use sendMessage instead. */
export const send = mutation({
  args: sendMessageMutationArgs,
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

  if (isHandoffToUser) {
    const pendingForSender = await ctx.db
      .query('chatroom_tasks')
      .withIndex('by_chatroom_status_assignedTo', (q) =>
        q
          .eq('chatroomId', args.chatroomId)
          .eq('status', 'pending')
          .eq('assignedTo', args.senderRole)
      )
      .collect();
    const topPending = pendingForSender.sort((a, b) => a.queuePosition - b.queuePosition)[0];
    if (topPending) {
      tasksToComplete.push(topPending);
    }
  }

  const completedTaskIds: Id<'chatroom_tasks'>[] = [];

  for (const task of tasksToComplete) {
    // All tasks complete to 'completed' status
    const newStatus = 'completed' as const;
    const completionTrigger = task.status === 'pending' ? 'completeTaskById' : 'completeTask';

    // Use FSM for transition — skip auto-promotion because the handoff handler
    // manages promotion explicitly (Step 6 for handoff-to-user).
    await transitionTask(ctx, task._id, newStatus, completionTrigger, undefined, {
      skipAutoPromotion: true,
    });
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

  // Step 5: Attached backlog items remain in their current status on handoff.
  // Agents should explicitly use `chatroom backlog mark-for-review` to transition
  // items they worked on to pending_user_review. Auto-transitioning all attached
  // items would incorrectly mark items that were attached for context only.

  // Step 6: Explicit queue promotion on handoff-to-user
  // When handing off to user, we need to explicitly promote the next queued task
  // because areAllAgentsWaiting() returns false at this point (the sender is still
  // marked as "working"). We check: no active tasks remain → promote next queued task.
  if (isHandoffToUser) {
    const promoteResult = await maybePromoteNextQueuedTask(ctx, args.chatroomId);
    if (promoteResult.promoted) {
      promotedTaskId = promoteResult.promoted;
    }
  }

  // Update unread status for chatroom owner.
  // Handoff-to-user notification only when no tasks or queued messages remain.
  if (chatroom?.ownerId) {
    let shouldFlagHandoffNotification = false;
    if (isHandoffToUser) {
      const { isWorkQueueEmpty } = await getChatroomQueueState(ctx, args.chatroomId);
      shouldFlagHandoffNotification = isWorkQueueEmpty;
    }
    await markChatroomUnread(ctx, args.chatroomId, chatroom.ownerId, shouldFlagHandoffNotification);
  }

  const agentConfigResult = await getAgentConfig(ctx, {
    chatroomId: args.chatroomId,
    role: args.senderRole,
  });
  const supportsNativeIntegration =
    agentConfigResult.found && isNativeHarness(agentConfigResult.config.agentHarness);

  return {
    success: true,
    error: null,
    messageId,
    completedTaskIds,
    newTaskId,
    promotedTaskId,
    supportsNativeIntegration,
  };
}

/** Sends a message to a chatroom without completing the current task. */
export const sendMessage = mutation({
  args: sendMessageMutationArgs,
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

    const availableRoles = waitingParticipants.map((p) => p.role);
    const currentClassification = await getLatestUserMessageClassification(ctx, args.chatroomId);

    return {
      availableRoles,
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
    const MAX_LIMIT = 50;
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

const userMessageOrTaskIdArgs = {
  type: v.union(v.literal('task'), v.literal('message')),
  taskId: v.optional(v.id('chatroom_tasks')),
  messageId: v.optional(v.union(v.id('chatroom_messages'), v.id('chatroom_messageQueue'))),
};

type UserMessageOrTaskMutationArgs = {
  sessionId: string;
  type: 'task' | 'message';
  taskId?: Id<'chatroom_tasks'>;
  messageId?: Id<'chatroom_messages'> | Id<'chatroom_messageQueue'>;
};

async function authorizeTaskTarget(
  ctx: MutationCtx,
  sessionId: string,
  taskId: Id<'chatroom_tasks'> | undefined,
  requireTargetExists: boolean
): Promise<{ type: 'task'; taskId: Id<'chatroom_tasks'> }> {
  if (!taskId) {
    throw new ConvexError({
      code: 'INVALID_TASK',
      message: 'taskId is required when type is task.',
    });
  }

  const task = await ctx.db.get('chatroom_tasks', taskId);
  if (!task) {
    if (requireTargetExists) {
      throw new ConvexError({
        code: 'TASK_NOT_FOUND',
        message: 'Task not found.',
      });
    }
    return { type: 'task', taskId };
  }

  await requireChatroomAccess(ctx, sessionId, task.chatroomId);
  return { type: 'task', taskId };
}

async function authorizeMessageTarget(
  ctx: MutationCtx,
  sessionId: string,
  messageId: Id<'chatroom_messages'> | Id<'chatroom_messageQueue'> | undefined,
  requireTargetExists: boolean
): Promise<{
  type: 'message';
  messageId: Id<'chatroom_messages'> | Id<'chatroom_messageQueue'>;
}> {
  if (!messageId) {
    throw new ConvexError({
      code: 'INVALID_MESSAGE',
      message: 'messageId is required when type is message.',
    });
  }

  const resolved = await resolveUserMessageRef(ctx, messageId);
  if (!resolved) {
    if (requireTargetExists) {
      throw new ConvexError({
        code: 'MESSAGE_NOT_FOUND',
        message: 'Message not found.',
      });
    }
    return { type: 'message', messageId };
  }

  await requireChatroomAccess(ctx, sessionId, resolved.record.chatroomId);
  return { type: 'message', messageId };
}

async function authorizeUserMessageOrTaskAccess(
  ctx: MutationCtx,
  args: UserMessageOrTaskMutationArgs,
  options: { requireTargetExists: boolean }
): Promise<
  | { type: 'task'; taskId: Id<'chatroom_tasks'> }
  | {
      type: 'message';
      messageId: Id<'chatroom_messages'> | Id<'chatroom_messageQueue'>;
    }
> {
  if (args.type === 'task') {
    return authorizeTaskTarget(ctx, args.sessionId, args.taskId, options.requireTargetExists);
  }
  return authorizeMessageTarget(ctx, args.sessionId, args.messageId, options.requireTargetExists);
}

/** Deletes a user message and/or its linked task (any lifecycle stage). */
export const deleteUserMessageOrTask = mutation({
  args: {
    ...SessionIdArg,
    ...userMessageOrTaskIdArgs,
  },
  handler: async (ctx, args) => {
    const target = await authorizeUserMessageOrTaskAccess(ctx, args, {
      requireTargetExists: false,
    });
    return deleteUserMessageOrTaskUsecase(ctx, target);
  },
});

/** Updates a user message and/or its linked task content (any lifecycle stage). */
export const updateUserMessageOrTask = mutation({
  args: {
    ...SessionIdArg,
    ...userMessageOrTaskIdArgs,
    content: v.string(),
  },
  handler: async (ctx, args) => {
    const target = await authorizeUserMessageOrTaskAccess(ctx, args, {
      requireTargetExists: true,
    });
    return updateUserMessageOrTaskUsecase(ctx, { ...target, content: args.content });
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

    // Enforce maximum limit to prevent unbounded queries
    const MAX_LIMIT = 1000;
    const limit = args.limit ? Math.min(args.limit, MAX_LIMIT) : MAX_LIMIT;

    const queuedMessages = await ctx.db
      .query('chatroom_messageQueue')
      .withIndex('by_chatroom_queue', (q) => q.eq('chatroomId', args.chatroomId))
      .order('asc') // Ascending by queuePosition (oldest first)
      .take(limit);

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
      attachedSnippets: qMsg.attachedSnippets,
      // Add queue-specific flags
      isQueued: true as const,
      queuePosition: qMsg.queuePosition,
    }));

    // Enrich queued messages with attachment details (shared helper)
    const enrichedMessages = await Promise.all(
      transformedMessages.map(async (qMsg) => {
        const attachments = await enrichMessageAttachments(ctx, qMsg);
        return { ...qMsg, ...attachments };
      })
    );

    return enrichedMessages.slice(-limit);
  },
});

/**
 * Returns all progress messages for a given task, ordered chronologically.
 * Used by TaskProgressHistory in MessageFeed to display progress updates
 * when the user expands the progress history view.
 */
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

    // Filter to new_feature messages with feature title (type predicate
    // narrows `featureTitle` to `string` so the map below stays simple).
    const isFeatureMessage = (
      msg: Doc<'chatroom_messages'>
    ): msg is Doc<'chatroom_messages'> & { featureTitle: string } =>
      msg.classification === 'new_feature' && msg.featureTitle != null;

    const features = candidateMessages
      .filter(isFeatureMessage)
      .slice(0, effectiveLimit)
      .map((msg) => ({
        id: msg._id,
        title: msg.featureTitle,
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

    const availableRoles = waitingParticipants.map((p) => p.role);
    const currentClassification = await getLatestUserMessageClassification(ctx, args.chatroomId);
    const availableHandoffRoles = buildAvailableHandoffRoles(availableRoles);

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
      convexUrl: config.getConvexURLWithFallback(args.convexUrl),
    });

    return {
      prompt,
      currentClassification,
      availableHandoffRoles,
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
      agentType: (existingAgentConfig?.type ?? 'unset') as 'remote' | 'custom' | 'unset',
      agentHarness: existingAgentConfig?.agentHarness,
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

    // Fetch current context (time-based staleness only — no message reads).
    const currentContext = await loadCurrentContext(ctx, args.chatroomId);

    // Fetch the task
    const task = await ctx.db.get('chatroom_tasks', args.taskId);
    if (!task) {
      throw new ConvexError({
        code: 'TASK_NOT_FOUND',
        message: 'Task not found',
      });
    }

    // Fetch the message: explicit messageId (CLI get-next-task) or task.sourceMessageId (native injection)
    let message: Doc<'chatroom_messages'> | Doc<'chatroom_messageQueue'> | null = null;
    const messageIdToResolve = args.messageId ?? task.sourceMessageId;
    if (messageIdToResolve) {
      // Try chatroom_messages first
      const regularMessage = await ctx.db
        .get('chatroom_messages', messageIdToResolve as Id<'chatroom_messages'>)
        .catch(() => null);
      if (regularMessage) {
        message = regularMessage;
      } else if (args.messageId) {
        // Try chatroom_messageQueue (only when caller passed an explicit queue id)
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

    const availableRoles = waitingParticipants.map((p) => p.role);
    const currentClassification = await getLatestUserMessageClassification(ctx, args.chatroomId);
    const availableHandoffRoles = buildAvailableHandoffRoles(availableRoles);

    // Get context window (reuse getContextWindow logic)
    // Fetch recent messages for context
    // Origin/follow-up resolution for context window (separate concern from attachment rendering).
    // fallow-ignore-next-line code-duplication
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
            const found = originMessage;
            originIndex = contextMessages.findIndex((m) => m._id === found._id);
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

    // Fetch attached tasks if any exist in context messages or the task source message
    const allAttachedTaskIds: Id<'chatroom_tasks'>[] = [];
    if (message?.attachedTaskIds && message.attachedTaskIds.length > 0) {
      allAttachedTaskIds.push(...message.attachedTaskIds);
    }
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

    // Fetch attached backlog items if any exist in context messages or the task source message
    const allAttachedBacklogItemIds: Id<'chatroom_backlog'>[] = [];
    if (message?.attachedBacklogItemIds && message.attachedBacklogItemIds.length > 0) {
      allAttachedBacklogItemIds.push(...message.attachedBacklogItemIds);
    }
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
      // fallow-ignore-next-line code-duplication
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

    // Fetch attached messages from the task source message
    const attachedMessagesMap = new Map<
      string,
      { id: string; content: string; senderRole: string }
    >();
    if (message?.attachedMessageIds && message.attachedMessageIds.length > 0) {
      for (const msgId of message.attachedMessageIds) {
        const attachedMsg = await ctx.db.get('chatroom_messages', msgId);
        if (attachedMsg) {
          attachedMessagesMap.set(msgId, {
            id: attachedMsg._id,
            content: attachedMsg.content,
            senderRole: attachedMsg.senderRole,
          });
        }
      }
    }

    // Primary-delivery attachments: resolve from source message, then assemble typed payload.
    // @see ../src/domain/entities/assemble-primary-delivery-attachments.ts
    const primaryDeliveryInput = resolvePrimaryDeliveryAssemblyInput(
      message
        ? {
            ...('attachedSnippets' in message && message.attachedSnippets?.length
              ? { attachedSnippets: message.attachedSnippets }
              : {}),
            ...('attachedBacklogItemIds' in message && message.attachedBacklogItemIds?.length
              ? { attachedBacklogItemIds: message.attachedBacklogItemIds }
              : {}),
            ...('attachedTaskIds' in message && message.attachedTaskIds?.length
              ? { attachedTaskIds: message.attachedTaskIds }
              : {}),
            ...('attachedMessageIds' in message && message.attachedMessageIds?.length
              ? { attachedMessageIds: message.attachedMessageIds }
              : {}),
          }
        : null,
      attachedBacklogItemsMap,
      attachedTasksMap,
      attachedMessagesMap
    );
    const sourceAttachments = assemblePrimaryDeliveryAttachments(primaryDeliveryInput);
    const sourceSnippets = primaryDeliveryInput.attachedSnippets;

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
            ...(sourceSnippets && { attachedSnippets: sourceSnippets }),
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

    const teamRoleKey = chatroom.teamId
      ? buildTeamRoleKey(chatroom._id, chatroom.teamId, args.role)
      : null;
    const existingAgentConfig = teamRoleKey
      ? await ctx.db
          .query('chatroom_teamAgentConfigs')
          .withIndex('by_teamRoleKey', (q) => q.eq('teamRoleKey', teamRoleKey))
          .first()
      : null;
    const agentHarness = existingAgentConfig?.agentHarness;
    const nativeIntegration = isNativeHarness(agentHarness);

    // Generate the complete CLI output (backend-generated, CLI just prints it)
    const fullCliOutput = generateFullCliOutput({
      chatroomId: args.chatroomId,
      role: args.role,
      cliEnvPrefix,
      teamId: chatroom.teamId ?? 'duo',
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
          }
        : null,
      followUpCountSinceOrigin,
      originMessageCreatedAt: originMessage?._creationTime ?? null,
      isEntryPoint,
      availableHandoffTargets: availableHandoffRoles,
      nativeIntegration,
      sourceAttachments,
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

/** Paginated list of user messages (newest first). For filtered message view. */
export const listUserMessagesPaginated = query({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

    const result = await ctx.db
      .query('chatroom_messages')
      .withIndex('by_chatroom_senderRole_type_createdAt', (q) =>
        q.eq('chatroomId', args.chatroomId).eq('senderRole', 'user').eq('type', 'message')
      )
      .order('desc')
      .paginate(args.paginationOpts);

    const page = await enrichMessages(ctx, result.page);
    return { ...result, page };
  },
});

/** Paginated conversation slice from anchor until before next user message. Ascending order. */
export const listConversationSlicePaginated = query({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    anchorMessageId: v.id('chatroom_messages'),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

    const anchor = await ctx.db.get('chatroom_messages', args.anchorMessageId);
    if (!anchor) {
      throw new ConvexError({ code: 'MESSAGE_NOT_FOUND', message: 'Message not found' });
    }
    if (anchor.chatroomId !== args.chatroomId) {
      throw new ConvexError({
        code: 'INVALID_MESSAGE',
        message: 'Message does not belong to this chatroom',
      });
    }
    if (anchor.senderRole.toLowerCase() !== 'user' || anchor.type !== 'message') {
      throw new ConvexError({
        code: 'INVALID_ANCHOR',
        message: 'Anchor must be a user message',
      });
    }

    const nextUserMessage = await ctx.db
      .query('chatroom_messages')
      .withIndex('by_chatroom_senderRole_type_createdAt', (q) =>
        q.eq('chatroomId', args.chatroomId).eq('senderRole', 'user').eq('type', 'message')
      )
      .filter((q) => q.gt(q.field('_creationTime'), anchor._creationTime))
      .order('asc')
      .first();

    const upperBoundExclusive = nextUserMessage?._creationTime ?? null;

    let cursor = args.paginationOpts.cursor;
    let isDone = false;
    const collected: Doc<'chatroom_messages'>[] = [];
    const numItems = args.paginationOpts.numItems;

    while (collected.length < numItems && !isDone) {
      const batch = await ctx.db
        .query('chatroom_messages')
        .withIndex('by_chatroom', (q) =>
          q.eq('chatroomId', args.chatroomId).gte('_creationTime', anchor._creationTime)
        )
        .order('asc')
        .paginate({ ...args.paginationOpts, cursor, numItems: numItems * 2 });

      for (const msg of batch.page) {
        if (upperBoundExclusive !== null && msg._creationTime >= upperBoundExclusive) {
          isDone = true;
          break;
        }
        if (!isTimelineMessage(msg)) continue;
        collected.push(msg);
        if (collected.length >= numItems) break;
      }

      cursor = batch.continueCursor;
      isDone = isDone || batch.isDone;
      if (batch.page.length === 0) break;
    }

    const page = await enrichMessages(ctx, collected.slice(0, numItems));
    return {
      page,
      isDone,
      continueCursor: cursor,
      sliceMetadata: {
        anchorMessageId: anchor._id,
        nextUserMessageId: nextUserMessage?._id ?? null,
        upperBoundExclusive,
      },
    };
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
