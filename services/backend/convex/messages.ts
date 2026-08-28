import {
  getEnhancerEntryPointRole,
  isEnhancerEntryPointRole,
} from '@workspace/shared/domain/enhancer-team-capability';
import { ConvexError, v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import { generateRolePrompt, composeInitPrompt } from '../prompts';
import type { Doc, Id } from './_generated/dataModel';
import type { MutationCtx, QueryCtx } from './_generated/server';
import { mutation, query } from './_generated/server';
import { requireChatroomAccess } from './auth/chatroomAccess';
import { getAndIncrementQueuePosition } from './lib/chatroomUtils';
import { buildAvailableHandoffRoles } from './lib/handoffRoles';
import { getRolePriority } from './lib/hierarchy';
import { buildTeamRoleKey } from './utils/teamRoleKey';
import { generateFullCliOutput } from '../prompts/cli/get-next-task/fullOutput';
import { getConfig } from '../prompts/config/index';
import { getCliEnvPrefix } from '../prompts/utils/index';
import {
  assemblePrimaryDeliveryAttachments,
  resolvePrimaryDeliveryAssemblyInput,
} from '../src/domain/entities/assemble-primary-delivery-attachments';
import { isNativeHarness } from '../src/domain/entities/harness/types';
import type { PrimaryDeliveryAttachments } from '../src/domain/entities/message-attachments';
import { isActiveParticipant } from '../src/domain/entities/participant';
import { getActiveStandingInstructions } from '../src/domain/entities/standing-instructions';
import { getTeamEntryPoint } from '../src/domain/entities/team';
import { getTeamStructure } from '../src/domain/entities/team-presets';
import { getAgentConfig } from '../src/domain/usecase/agent/get-agent-config';
import { transitionAgentStatus } from '../src/domain/usecase/agent/transition-agent-status';
import { enqueueUserMessageAtFront } from '../src/domain/usecase/chatroom/enqueue-user-message-at-front';
import { getTeamRolesFromChatroom } from '../src/domain/usecase/chatroom/get-team-roles';
import { sendAutomatedUserMessage } from '../src/domain/usecase/chatroom/send-automated-user-message';
import { markChatroomUnread } from '../src/domain/usecase/chatroom/unread-status';
import { createEnhancerJobFromHandoff } from '../src/domain/usecase/enhancer/create-enhancer-job-from-handoff';
import {
  hasActiveEnhancerWork,
  transitionEnhancerEntryPointToEnhancing,
  transitionEnhancerEntryPointToWaiting,
} from '../src/domain/usecase/enhancer/enhancer-entry-point-status';
import { resolveEnhancerHandoffContent } from '../src/domain/usecase/enhancer/enhancer-handoff-content';
import { findEnhancerTaskForOrigin } from '../src/domain/usecase/enhancer/find-enhancer-task-for-origin';
import { getEnhancerConfigForUser } from '../src/domain/usecase/enhancer/get-enhancer-config-for-user';
import {
  getEnhancerTeamAgentConfig,
  syncEnhancerTeamAgentConfig,
} from '../src/domain/usecase/enhancer/get-enhancer-team-agent-config';
import { walkToUserMessageId } from '../src/domain/usecase/enhancer/resolve-origin-user-message-id';
import {
  resolvePlannerEnhancerEnabledFromConfig,
  resolveTaskPlannerEnhancerEnabled,
} from '../src/domain/usecase/enhancer/resolve-planner-enhancer-enabled';
import { validateEnhancerHandoff } from '../src/domain/usecase/enhancer/validate-enhancer-handoff';
import {
  insertChatroomMessage,
  isMessageReadModelComplete,
  linkMessageToTask,
} from '../src/domain/usecase/message/message-read-model';
import { listActivatedSkills } from '../src/domain/usecase/skills/list-activated-skills';
import { getChatroomQueueState } from '../src/domain/usecase/task/chatroom-queue-state';
import {
  collectActiveTasks,
  completeTasks,
} from '../src/domain/usecase/task/complete-active-tasks';
import { createTask as createTaskUsecase } from '../src/domain/usecase/task/create-task';
import { deleteUserMessageOrTask as deleteUserMessageOrTaskUsecase } from '../src/domain/usecase/task/delete-user-message-or-task';
import { maybePromoteNextQueuedTask } from '../src/domain/usecase/task/maybe-promote-next-queued-task';
import { resolveUserMessageRef } from '../src/domain/usecase/task/resolve-user-message-task-link';
import { type TaskStatus } from '../src/domain/usecase/task/transition-task';
import { updateUserMessageOrTask as updateUserMessageOrTaskUsecase } from '../src/domain/usecase/task/update-user-message-or-task';
import { requestSyncOnHandoffToUser } from '../src/domain/usecase/workspace/request-sync-on-handoff-to-user';

const config = getConfig();

// Types for task delivery prompt response
interface TaskDeliveryPromptResponse {
  fullCliOutput: string; // Complete CLI output for task delivery (backend-generated)
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
    startInNewSession?: boolean;
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
      .filter((i): i is NonNullable<typeof i> => i !== null && i.status !== 'deleted')
      .map((i) => ({ id: i._id, content: i.content, status: i.status }));
  }

  // Resolve attached messages
  let attachedMessages:
    { _id: string; content: string; senderRole: string; _creationTime: number }[] | undefined;
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
    { _id: string; filename: string; description?: string; mimeType?: string }[] | undefined;
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
 * Resolves primary-delivery attachments for task delivery from a task source
 * message's attachment IDs only (on-demand DB lookups). Returns undefined when
 * the message is absent or carries no primary-delivery attachments.
 */
async function resolveSourceAttachmentsForDelivery(
  ctx: QueryCtx,
  message: {
    attachedSnippets?: { reference: string; fileSource: string; selectedContent: string }[];
    attachedTaskIds?: Id<'chatroom_tasks'>[];
    attachedBacklogItemIds?: Id<'chatroom_backlog'>[];
    attachedMessageIds?: Id<'chatroom_messages'>[];
  } | null
): Promise<PrimaryDeliveryAttachments | undefined> {
  if (!message) return undefined;

  const attachedTasksMap = new Map<
    string,
    { id: string; content: string; status: TaskStatus; createdBy: string }
  >();
  if (message.attachedTaskIds?.length) {
    for (const taskId of message.attachedTaskIds) {
      const t = await ctx.db.get('chatroom_tasks', taskId);
      if (t) {
        attachedTasksMap.set(taskId, {
          id: t._id,
          content: t.content,
          status: t.status,
          createdBy: t.createdBy,
        });
      }
    }
  }

  const attachedBacklogItemsMap = new Map<
    string,
    { id: string; content: string; status: string }
  >();
  if (message.attachedBacklogItemIds?.length) {
    for (const itemId of message.attachedBacklogItemIds) {
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

  const attachedMessagesMap = new Map<
    string,
    { id: string; content: string; senderRole: string }
  >();
  if (message.attachedMessageIds?.length) {
    for (const msgId of message.attachedMessageIds) {
      const m = await ctx.db.get('chatroom_messages', msgId);
      if (m) {
        attachedMessagesMap.set(msgId, { id: m._id, content: m.content, senderRole: m.senderRole });
      }
    }
  }

  const primaryDeliveryInput = resolvePrimaryDeliveryAssemblyInput(
    {
      ...(message.attachedSnippets?.length ? { attachedSnippets: message.attachedSnippets } : {}),
      ...(message.attachedBacklogItemIds?.length
        ? { attachedBacklogItemIds: message.attachedBacklogItemIds }
        : {}),
      ...(message.attachedTaskIds?.length ? { attachedTaskIds: message.attachedTaskIds } : {}),
      ...(message.attachedMessageIds?.length
        ? { attachedMessageIds: message.attachedMessageIds }
        : {}),
    },
    attachedBacklogItemsMap,
    attachedTasksMap,
    attachedMessagesMap
  );
  return assemblePrimaryDeliveryAttachments(primaryDeliveryInput);
}

/**
 * Enriches an array of chatroom messages with task status and attachments.
 * Used by the messageList module.
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

  // Batch enhancer job lookups: fetch draftContent for messages linked to enhancer jobs
  const uniqueJobIds = [
    ...new Set(messages.flatMap((m) => (m.enhancerJobId != null ? [m.enhancerJobId] : []))),
  ];
  const jobDraftMap = new Map<string, string>();
  await Promise.all(
    uniqueJobIds.map(async (id) => {
      const job = await ctx.db.get('chatroom_enhancerJobs', id);
      if (job?.draftContent) jobDraftMap.set(id.toString(), job.draftContent);
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

      const enhancerOriginalContent =
        message.enhancerJobId != null
          ? jobDraftMap.get(message.enhancerJobId.toString())
          : undefined;

      return {
        ...message,
        ...(taskStatus && { taskStatus }),
        ...attachments,
        ...(enhancerOriginalContent && { enhancerOriginalContent }),
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
    startInNewSession?: boolean;
  }
) {
  const { chatroom, session } = await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

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
      if (item.status === 'closed' || item.status === 'deleted') {
        throw new ConvexError({
          code: 'INVALID_ITEM_STATUS',
          message: 'Cannot attach closed or deleted backlog items.',
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
    const result = await sendAutomatedUserMessage(ctx, {
      chatroomId: args.chatroomId,
      content: args.content,
      ...(args.attachedTaskIds?.length ? { attachedTaskIds: args.attachedTaskIds } : {}),
      ...(args.attachedBacklogItemIds?.length
        ? { attachedBacklogItemIds: args.attachedBacklogItemIds }
        : {}),
      ...(args.attachedMessageIds?.length ? { attachedMessageIds: args.attachedMessageIds } : {}),
      ...(args.attachedSnippets?.length ? { attachedSnippets: args.attachedSnippets } : {}),
      startInNewSession: args.startInNewSession,
      userId: session.userId,
    });
    if (!result.ok) {
      if (result.reason === 'empty_content') {
        throw new ConvexError({
          code: 'EMPTY_CONTENT',
          message: 'Message content cannot be empty',
        });
      }
      throw new ConvexError({
        code: 'CHATROOM_NOT_ACTIVE',
        message: 'Chatroom is not active',
      });
    }
    return result.messageId;
  }
  // ─── Non-user messages: always write to chatroom_messages ────────────────
  const messageId = await insertChatroomMessage(ctx, {
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
      startInNewSession: undefined,
    });
    await linkMessageToTask(ctx, messageId, taskId);
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
  startInNewSession: v.optional(v.boolean()),
};

/** @deprecated Use sendMessage instead. */
export const send = mutation({
  args: sendMessageMutationArgs,
  handler: async (ctx, args) => {
    return _sendMessageHandler(ctx, args);
  },
});

export const enqueueMessageAtFront = mutation({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    content: v.string(),
    attachedTaskIds: v.optional(v.array(v.id('chatroom_tasks'))),
    attachedBacklogItemIds: v.optional(v.array(v.id('chatroom_backlog'))),
    attachedMessageIds: v.optional(v.array(v.id('chatroom_messages'))),
    attachedSnippets: v.optional(v.array(attachedSnippetArgsValidator)),
    startInNewSession: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { session } = await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);
    const result = await enqueueUserMessageAtFront(ctx, {
      chatroomId: args.chatroomId,
      content: args.content,
      userId: session.userId,
      startInNewSession: args.startInNewSession,
      ...(args.attachedTaskIds?.length ? { attachedTaskIds: args.attachedTaskIds } : {}),
      ...(args.attachedBacklogItemIds?.length
        ? { attachedBacklogItemIds: args.attachedBacklogItemIds }
        : {}),
      ...(args.attachedMessageIds?.length ? { attachedMessageIds: args.attachedMessageIds } : {}),
      ...(args.attachedSnippets?.length ? { attachedSnippets: args.attachedSnippets } : {}),
    });
    if (!result.ok)
      throw new ConvexError({
        code: result.reason === 'empty_content' ? 'EMPTY_CONTENT' : 'CHATROOM_NOT_ACTIVE',
        message: result.reason,
      });
    return result.messageId;
  },
});

/** Internal handler for completing a task and handing off. */
/** @internal Shared handoff implementation for messages.handoff and legacy enqueueHandoff. */
export async function runHandoffHandler(
  ctx: MutationCtx,
  args: {
    sessionId: string;
    chatroomId: Id<'chatroom_rooms'>;
    senderRole: string;
    content: string;
    targetRole: string;
    attachedArtifactIds?: Id<'chatroom_artifacts'>[];
    enhancerJobId?: Id<'chatroom_enhancerJobs'>;
    visibleInAllTabOnly?: boolean;
  }
) {
  // Validate session and check chatroom access (returns chatroom, throws ConvexError on auth failure)
  let chatroom;
  let sessionUserId: Id<'users'>;
  try {
    const result = await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);
    chatroom = result.chatroom;
    sessionUserId = result.session.userId;
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
  const normalizedTargetRole = args.targetRole.toLowerCase();
  const { teamRoles, normalizedTeamRoles } = getTeamRolesFromChatroom(chatroom);
  const normalizedStructuralRoles = chatroom.teamId
    ? getTeamStructure({
        teamId: chatroom.teamId,
        teamName: chatroom.teamName,
        persistedRoles: teamRoles,
        persistedEntryPoint: chatroom.teamEntryPoint,
      }).roles.map(({ role }) => role.toLowerCase())
    : normalizedTeamRoles;
  const enhancerEntryPointRole = getEnhancerEntryPointRole(chatroom);
  const normalizedEnhancerEntryPointRole = enhancerEntryPointRole?.toLowerCase();
  const isEnhancerDelivery = normalizedSenderRole === 'enhancer';
  if (isEnhancerDelivery && normalizedTargetRole !== (enhancerEntryPointRole ?? '').toLowerCase()) {
    return {
      success: false,
      error: {
        code: 'INVALID_TARGET_ROLE',
        message: 'Enhancer must hand off to the team entry point',
      },
      messageId: null,
      completedTaskIds: [],
      newTaskId: null,
      promotedTaskId: null,
    };
  }
  if (!isEnhancerDelivery && !normalizedTeamRoles.includes(normalizedSenderRole)) {
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

  const isHandoffToUser = normalizedTargetRole === 'user';
  const isHandoffToEnhancer = normalizedTargetRole === 'enhancer';
  let enhancerConfig: Awaited<ReturnType<typeof getEnhancerTeamAgentConfig>> = null;
  let enhancerEnabledAtEnqueue: boolean | undefined;

  if (normalizedSenderRole === normalizedEnhancerEntryPointRole && !isHandoffToEnhancer) {
    const enhancerReviewInProgress = await hasActiveEnhancerWork(ctx, args.chatroomId);
    if (enhancerReviewInProgress) {
      return {
        success: false,
        error: {
          code: 'ENHANCER_REVIEW_IN_PROGRESS',
          message:
            'Cannot hand off while enhancer analysis is in progress. Run get-next-task and wait for planning input, then incorporate it before proceeding.',
        },
        messageId: null,
        completedTaskIds: [],
        newTaskId: null,
        promotedTaskId: null,
      };
    }
  }

  if (isHandoffToEnhancer) {
    if (!normalizedStructuralRoles.includes('enhancer')) {
      return {
        success: false,
        error: { code: 'INVALID_TARGET_ROLE', message: 'Enhancer is not part of the current team' },
        messageId: null,
        completedTaskIds: [],
        newTaskId: null,
        promotedTaskId: null,
      };
    }
    if (!enhancerEntryPointRole || !isEnhancerEntryPointRole(chatroom, args.senderRole)) {
      return {
        success: false,
        error: {
          code: 'INVALID_ROLE',
          message: 'Only the supported team entry point can hand off to enhancer',
        },
        messageId: null,
        completedTaskIds: [],
        newTaskId: null,
        promotedTaskId: null,
      };
    }

    if (!chatroom.teamId) throw new Error('Chatroom team is required for enhancer handoff');
    enhancerConfig = await getEnhancerTeamAgentConfig(ctx, args.chatroomId, chatroom.teamId);
    if (!enhancerConfig) {
      const legacyConfig = await getEnhancerConfigForUser(ctx, args.chatroomId, sessionUserId);
      if (legacyConfig) {
        enhancerConfig = await syncEnhancerTeamAgentConfig(ctx, {
          chatroomId: args.chatroomId,
          teamId: chatroom.teamId,
          legacyConfig,
        });
      }
    }

    const activeEntryPointTasks = await collectActiveTasks(ctx, args.chatroomId, {
      assignedTo: enhancerEntryPointRole,
    });
    if (activeEntryPointTasks.length === 0) {
      const priorEnhancerTask = (
        await ctx.db
          .query('chatroom_tasks')
          .withIndex('by_chatroom', (q) => q.eq('chatroomId', args.chatroomId))
          .collect()
      ).find((task) => task.assignedTo?.toLowerCase() === 'enhancer' && task.originUserMessageId);
      if (priorEnhancerTask) {
        return {
          success: false,
          error: {
            code: 'ENHANCER_ALREADY_USED',
            message: 'Enhancer analysis already ran for this originating user message',
          },
          messageId: null,
          completedTaskIds: [],
          newTaskId: null,
          promotedTaskId: null,
        };
      }
      return {
        success: false,
        error: {
          code: 'NO_ENTRY_POINT_USER_TASK',
          message: `Cannot hand off to enhancer without an active ${enhancerEntryPointRole} task from a user instruction`,
        },
        messageId: null,
        completedTaskIds: [],
        newTaskId: null,
        promotedTaskId: null,
      };
    }

    const userOriginTask =
      activeEntryPointTasks.find((t) => t.createdBy === 'user') ?? activeEntryPointTasks[0];
    enhancerEnabledAtEnqueue = userOriginTask?.plannerEnhancerEnabled;

    const originUserMessageId = userOriginTask?.sourceMessageId
      ? await walkToUserMessageId(ctx, userOriginTask.sourceMessageId)
      : null;
    if (!originUserMessageId) {
      return {
        success: false,
        error: {
          code: 'NO_ENTRY_POINT_USER_TASK',
          message: 'Cannot resolve the originating user message for enhancer analysis',
        },
        messageId: null,
        completedTaskIds: [],
        newTaskId: null,
        promotedTaskId: null,
      };
    }

    const existingOriginTask = await findEnhancerTaskForOrigin(ctx, {
      chatroomId: args.chatroomId,
      originUserMessageId,
    });
    if (existingOriginTask) {
      return {
        success: false,
        error: {
          code: 'ENHANCER_ALREADY_USED',
          message: 'Enhancer analysis already ran for this originating user message',
        },
        messageId: null,
        completedTaskIds: [],
        newTaskId: null,
        promotedTaskId: null,
      };
    }

    if (await hasActiveEnhancerWork(ctx, args.chatroomId)) {
      return {
        success: false,
        error: {
          code: 'ACTIVE_JOB_EXISTS',
          message: 'An enhancer job is already active for this handoff',
        },
        messageId: null,
        completedTaskIds: [],
        newTaskId: null,
        promotedTaskId: null,
      };
    }

    const handoffValidation = validateEnhancerHandoff({
      taskPlannerEnhancerEnabled: userOriginTask?.plannerEnhancerEnabled,
      config: enhancerConfig,
    });

    if (!handoffValidation.allowed) {
      const message =
        handoffValidation.code === 'ENHANCER_CONFIG_INCOMPLETE'
          ? 'Enhancer configuration is incomplete. Configure harness, model, and machine before handing off.'
          : 'Enhancer not enabled';
      return {
        success: false,
        error: { code: handoffValidation.code, message },
        messageId: null,
        completedTaskIds: [],
        newTaskId: null,
        promotedTaskId: null,
      };
    }
  }

  // Validate targetRole is a known team member (or user / enhancer when enabled)
  if (!isHandoffToUser && !isHandoffToEnhancer) {
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
  const tasksToComplete = await collectActiveTasks(ctx, args.chatroomId);

  if (isEnhancerDelivery) {
    const enhancerTasks = await ctx.db
      .query('chatroom_tasks')
      .withIndex('by_chatroom_status_assignedTo', (q) =>
        q.eq('chatroomId', args.chatroomId).eq('status', 'pending').eq('assignedTo', 'enhancer')
      )
      .collect();
    tasksToComplete.push(...enhancerTasks);
  }

  if (isEnhancerDelivery && args.enhancerJobId) {
    const job = await ctx.db.get('chatroom_enhancerJobs', args.enhancerJobId);
    if (job?.taskId) {
      const enhancerTask = await ctx.db.get('chatroom_tasks', job.taskId);
      if (enhancerTask && enhancerTask.status !== 'completed') {
        tasksToComplete.push(enhancerTask);
      }
    }
  }

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
      const agentConfigResult = await getAgentConfig(ctx, {
        chatroomId: args.chatroomId,
        role: args.senderRole,
      });
      const isNative =
        agentConfigResult.found && isNativeHarness(agentConfigResult.config.agentHarness);

      // Native harness: pending must reach in_progress (token activity) before system completion.
      // Non-native: preserve legacy handoff Step 1 pending force-complete (#798).
      if (!isNative) {
        tasksToComplete.push(topPending);
      }
    }
  }

  const completedTaskIds = await completeTasks(ctx, tasksToComplete, { skipAutoPromotion: true });
  let promotedTaskId: Id<'chatroom_tasks'> | null = null;

  // Promote queued user messages after active work is complete and before the
  // handoff task is created; canPromote rejects chats with any pending task.
  if (!isEnhancerDelivery) {
    const promoteResult = await maybePromoteNextQueuedTask(ctx, args.chatroomId);
    if (promoteResult.promoted) promotedTaskId = promoteResult.promoted;
  }

  if (tasksToComplete.length > 1) {
    console.warn(
      `[handoff] Completed ${tasksToComplete.length} tasks (in_progress + acknowledged) in chatroom ${args.chatroomId}`
    );
  }

  // Resolve user-instruction origin for enhancer correlation on any handoff
  let taskOriginMessageId: Id<'chatroom_messages'> | undefined;
  for (const task of tasksToComplete) {
    if (!task.sourceMessageId) continue;
    const originId = await walkToUserMessageId(ctx, task.sourceMessageId);
    if (originId) {
      taskOriginMessageId = originId;
      break;
    }
  }
  // Fallback: most recent acknowledged user message in chatroom
  if (!taskOriginMessageId) {
    const recentUser = await ctx.db
      .query('chatroom_messages')
      .withIndex('by_chatroom_senderRole_type_createdAt', (q) =>
        q.eq('chatroomId', args.chatroomId).eq('senderRole', 'user').eq('type', 'message')
      )
      .order('desc')
      .take(10);
    const origin = recentUser.find((m) => m.acknowledgedAt);
    if (origin) taskOriginMessageId = origin._id;
  }

  const originMessage =
    isHandoffToEnhancer && taskOriginMessageId
      ? await ctx.db.get('chatroom_messages', taskOriginMessageId)
      : null;
  const handoffContent = isHandoffToEnhancer
    ? resolveEnhancerHandoffContent(args.content, originMessage?.content ?? '')
    : args.content;

  // Step 2: Send the handoff message
  const messageId = await insertChatroomMessage(ctx, {
    chatroomId: args.chatroomId,
    senderRole: args.senderRole,
    content: handoffContent,
    targetRole: args.targetRole,
    type: 'handoff',
    ...(args.attachedArtifactIds &&
      args.attachedArtifactIds.length > 0 && { attachedArtifactIds: args.attachedArtifactIds }),
    ...(args.enhancerJobId && { enhancerJobId: args.enhancerJobId }),
    ...(isEnhancerDelivery ? { visibleInAllTabOnly: true } : {}),
    ...(args.visibleInAllTabOnly && { visibleInAllTabOnly: true }),
    ...(taskOriginMessageId && { taskOriginMessageId }),
  });

  // Update chatroom's lastActivityAt for sorting by recent activity
  await ctx.db.patch('chatroom_rooms', args.chatroomId, {
    lastActivityAt: now,
  });

  // After the handoff message is inserted, enqueue workspace git+command sync
  // for handoff-to-user only. Do not fail the handoff if enqueueing fails.
  if (isHandoffToUser) {
    try {
      const syncCount = await requestSyncOnHandoffToUser(ctx, args.chatroomId);
      if (syncCount > 0) {
        console.warn(
          `[handoff] Enqueued git refresh for ${syncCount} workspace(s) in chatroom ${args.chatroomId}`
        );
      }
    } catch (err) {
      console.warn(`[handoff] Failed to enqueue workspace sync on handoff-to-user:`, err);
    }
  }

  // Step 3: Create task for target agent (if not user)
  let newTaskId: Id<'chatroom_tasks'> | null = null;
  if (!isHandoffToUser) {
    // Get next queue position atomically (prevents race conditions)
    const queuePosition = await getAndIncrementQueuePosition(ctx, chatroom);

    const { taskId: createdTaskId } = await createTaskUsecase(ctx, {
      chatroomId: args.chatroomId,
      createdBy: args.senderRole,
      content: handoffContent,
      forceStatus: 'pending', // Handoffs always start as pending
      assignedTo: args.targetRole,
      sourceMessageId: messageId,
      queuePosition,
      ...(isHandoffToEnhancer && taskOriginMessageId
        ? { originUserMessageId: taskOriginMessageId, enhancerEnabledAtEnqueue }
        : {}),
      startInNewSession: undefined,
    });
    newTaskId = createdTaskId;

    // Link message to task
    await linkMessageToTask(ctx, messageId, newTaskId);
  }

  let enhancerJobId: Id<'chatroom_enhancerJobs'> | null = null;
  if (isHandoffToEnhancer && newTaskId) {
    if (!enhancerEntryPointRole) {
      throw new ConvexError({
        code: 'INVALID_ROLE',
        message: 'Enhancer handoff is missing a supported team entry point',
      });
    }
    if (!enhancerConfig?.machineId || !enhancerConfig.agentHarness || !enhancerConfig.model) {
      throw new ConvexError({
        code: 'ENHANCER_CONFIG_INCOMPLETE',
        message: 'Enhancer configuration is incomplete',
      });
    }
    enhancerJobId = await createEnhancerJobFromHandoff(ctx, {
      chatroomId: args.chatroomId,
      userId: chatroom.ownerId,
      chatroom,
      entryPointRole: enhancerEntryPointRole,
      content: handoffContent,
      taskId: newTaskId,
      messageId,
      ...(taskOriginMessageId && { originUserMessageId: taskOriginMessageId }),
      ...(args.attachedArtifactIds?.length && { attachedArtifactIds: args.attachedArtifactIds }),
      machineId: enhancerConfig.machineId,
      agentHarness: enhancerConfig.agentHarness,
      model: enhancerConfig.model,
    });
    await transitionEnhancerEntryPointToEnhancing(ctx, args.chatroomId, enhancerEntryPointRole);
  }

  // Step 4: Update sender's participant status to waiting (before checking queue promotion)
  const participant = await ctx.db
    .query('chatroom_participants')
    .withIndex('by_chatroom_and_role', (q) =>
      q.eq('chatroomId', args.chatroomId).eq('role', args.senderRole)
    )
    .unique();

  if (participant && !isEnhancerDelivery) {
    await transitionAgentStatus(ctx, args.chatroomId, args.senderRole, 'agent.waiting');
    await ctx.db.patch('chatroom_participants', participant._id, {
      lastSeenAt: Date.now(),
      lastInFlightTaskId: undefined,
    });
  }

  if (args.enhancerJobId) {
    const enhancerJob = await ctx.db.get('chatroom_enhancerJobs', args.enhancerJobId);
    if (enhancerJob) {
      await transitionEnhancerEntryPointToWaiting(ctx, args.chatroomId, enhancerJob.fromRole);
    }
  }

  if (isEnhancerDelivery) {
    await transitionEnhancerEntryPointToWaiting(
      ctx,
      args.chatroomId,
      enhancerEntryPointRole ?? args.targetRole
    );
  }

  // Step 5: Attached backlog items remain in their current status on handoff.
  // Agents should explicitly use `chatroom backlog mark-for-review` to transition
  // items they worked on to pending_user_review. Auto-transitioning all attached
  // items would incorrectly mark items that were attached for context only.

  // Step 6: Final handoff-to-user participant cleanup. Queue promotion already
  // ran after Step 1 for every non-enhancer handoff. Native handoffs can retain
  // a pending sender task until delivery, so keep a guarded fallback here.
  if (isHandoffToUser) {
    if (promotedTaskId === null) {
      const promoteResult = await maybePromoteNextQueuedTask(ctx, args.chatroomId);
      if (promoteResult.promoted) promotedTaskId = promoteResult.promoted;
    }
    if (participant) {
      await ctx.db.patch('chatroom_participants', participant._id, {
        lastInFlightTaskId: undefined,
      });
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
    enhancerJobId,
    enhancerRequestQueued: isHandoffToEnhancer && newTaskId != null,
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
    return runHandoffHandler(ctx, args);
  },
});

/** Thin wrapper for enhancer handoff delivery. */
export async function performHandoffFromEnhancer(
  ctx: MutationCtx,
  args: {
    sessionId: string;
    chatroomId: Id<'chatroom_rooms'>;
    senderRole: string;
    targetRole: string;
    content: string;
    attachedArtifactIds?: Id<'chatroom_artifacts'>[];
    jobId: Id<'chatroom_enhancerJobs'>;
  }
) {
  return runHandoffHandler(ctx, {
    sessionId: args.sessionId,
    chatroomId: args.chatroomId,
    senderRole: 'enhancer',
    targetRole: args.targetRole,
    content: args.content,
    attachedArtifactIds: args.attachedArtifactIds,
    enhancerJobId: args.jobId,
    visibleInAllTabOnly: true,
  });
}

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

    return {
      availableRoles,
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
      plannerEnhancerEnabled: qMsg.plannerEnhancerEnabled,
      startInNewSession: qMsg.startInNewSession,
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

export const updateQueuedMessagePlannerEnhancer = mutation({
  args: {
    ...SessionIdArg,
    queuedMessageId: v.id('chatroom_messageQueue'),
    plannerEnhancerEnabled: v.boolean(),
  },
  handler: async (ctx, args) => {
    const record = await ctx.db.get('chatroom_messageQueue', args.queuedMessageId);
    if (!record) {
      throw new ConvexError({
        code: 'QUEUED_MESSAGE_NOT_FOUND',
        message: 'Queued message not found',
      });
    }
    await requireChatroomAccess(ctx, args.sessionId, record.chatroomId);
    await ctx.db.patch('chatroom_messageQueue', args.queuedMessageId, {
      plannerEnhancerEnabled: args.plannerEnhancerEnabled,
    });
  },
});

export const updateQueuedMessageStartInNewSession = mutation({
  args: {
    ...SessionIdArg,
    queuedMessageId: v.id('chatroom_messageQueue'),
    startInNewSession: v.boolean(),
  },
  handler: async (ctx, args) => {
    const record = await ctx.db.get('chatroom_messageQueue', args.queuedMessageId);
    if (!record)
      throw new ConvexError({
        code: 'QUEUED_MESSAGE_NOT_FOUND',
        message: 'Queued message not found',
      });
    await requireChatroomAccess(ctx, args.sessionId, record.chatroomId);
    await ctx.db.patch('chatroom_messageQueue', args.queuedMessageId, {
      startInNewSession: args.startInNewSession,
    });
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

/** Returns a role-specific prompt with team context and allowed handoff targets. */
export const getRolePrompt = query({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    role: v.string(),
    convexUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Validate session and check chatroom access (chatroom not needed) - returns chatroom directly
    const { chatroom, session } = await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

    // Get participants
    const participants = await ctx.db
      .query('chatroom_participants')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', args.chatroomId))
      .collect();

    const waitingParticipants = participants.filter(
      (p) => p.role.toLowerCase() !== args.role.toLowerCase() && isActiveParticipant(p)
    );

    const availableRoles = waitingParticipants.map((p) => p.role);
    const availableHandoffRoles = buildAvailableHandoffRoles(availableRoles);

    let plannerEnhancerActive: boolean | undefined;
    if (isEnhancerEntryPointRole(chatroom, args.role)) {
      const enhancerConfig = await getEnhancerConfigForUser(ctx, args.chatroomId, session.userId);
      plannerEnhancerActive = resolvePlannerEnhancerEnabledFromConfig(enhancerConfig);
    }

    // Generate the role-specific prompt
    const activatedSkills = await listActivatedSkills(ctx, args.chatroomId, args.role);
    const prompt = generateRolePrompt({
      chatroomId: args.chatroomId,
      role: args.role,
      teamId: chatroom.teamId,
      teamName: chatroom.teamName || 'Team',
      teamRoles: chatroom.teamRoles || [],
      teamEntryPoint: chatroom.teamEntryPoint,
      availableHandoffRoles,
      convexUrl: config.getConvexURLWithFallback(args.convexUrl),
      plannerEnhancerActive,
      activatedSkills,
    });

    return {
      prompt,
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

    const activatedSkills = await listActivatedSkills(ctx, args.chatroomId, args.role);
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
      activatedSkills,
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

/** Returns the complete task delivery prompt for an agent receiving a task. */
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
    const { chatroom, session } = await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

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

    const enhancerConfig = await getEnhancerConfigForUser(ctx, args.chatroomId, session.userId);

    const plannerEnhancerEnabled = resolveTaskPlannerEnhancerEnabled({
      taskPlannerEnhancerEnabled: task.plannerEnhancerEnabled,
      liveConfig: enhancerConfig,
      role: args.role,
      team: chatroom,
    });

    const deliveryMessageSenderRole =
      message && 'senderRole' in message ? message.senderRole.toLowerCase() : undefined;

    const availableHandoffRoles = buildAvailableHandoffRoles(availableRoles, {
      includeEnhancer: plannerEnhancerEnabled && deliveryMessageSenderRole === 'user',
    });

    // Primary-delivery attachments resolve from the task source message only.
    const sourceAttachments = await resolveSourceAttachmentsForDelivery(ctx, message);

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

    const standingInstructions = getActiveStandingInstructions(chatroom);

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
      isEntryPoint,
      availableHandoffTargets: availableHandoffRoles,
      nativeIntegration,
      sourceAttachments,
      standingInstructions,
      plannerEnhancerEnabled,
      entryPointRole: getTeamEntryPoint(chatroom) ?? undefined,
    });

    return {
      fullCliOutput,
    };
  },
});

// =============================================================================
// SENDER ROLE BASED QUERIES - For user-centric pagination
// =============================================================================

/** Enriches a message with its task status when a task is linked. */
async function withTaskStatus<T extends { taskId?: Id<'chatroom_tasks'> | null }>(
  ctx: QueryCtx,
  message: T
): Promise<T & { taskStatus?: TaskStatus }> {
  let taskStatus: TaskStatus | undefined;
  if (message.taskId) {
    const task = await ctx.db.get('chatroom_tasks', message.taskId);
    taskStatus = task?.status;
  }
  return {
    ...message,
    ...(taskStatus && { taskStatus }),
  };
}

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

    return enrichMessages(ctx, messages);
  },
});

/** Returns the most recent user message plus prior user messages for anchoring on the user's last request. */
export const getLastUserMessage = query({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    /** How many prior user messages to include for terse follow-ups (default 3, max 5) */
    priorLimit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    // Validate session and check chatroom access
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

    const priorLimit = Math.min(Math.max(args.priorLimit ?? 3, 0), 5);
    const takeCount = priorLimit + 1;

    // Use composite index for user messages, newest first (mirrors listBySenderRole)
    // fallow-ignore-next-line code-duplication
    const userMessages = await ctx.db
      .query('chatroom_messages')
      .withIndex('by_chatroom_senderRole_type_createdAt', (q) =>
        q.eq('chatroomId', args.chatroomId).eq('senderRole', 'user').eq('type', 'message')
      )
      .order('desc')
      .take(takeCount);

    if (userMessages.length === 0) {
      return { last: null, prior: [] };
    }

    const last = await withTaskStatus(ctx, userMessages[0]);
    const prior = await Promise.all(userMessages.slice(1).map((m) => withTaskStatus(ctx, m)));

    return { last, prior };
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

    return enrichMessages(ctx, messages);
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

    const complete = await isMessageReadModelComplete(ctx, args.chatroomId);
    const headerRows = complete
      ? await ctx.db
          .query('chatroom_messageReadModels')
          .withIndex('by_chatroom_createdAt', (q) => q.eq('chatroomId', args.chatroomId))
          .order('desc')
          .take(200)
      : [];
    // Small legacy/test rooms may contain direct inserts predating dual-write;
    // retain the broad path until a full 200-row window proves header coverage.
    const contextWindow =
      complete && headerRows.length >= 200
        ? await (async () => {
            const headers = headerRows;
            const docs: Doc<'chatroom_messages'>[] = [];
            for (const header of headers) {
              if (header.taskStatus === 'pending' || header.taskStatus === 'acknowledged') continue;
              const message = await ctx.db.get('chatroom_messages', header.messageId);
              if (message) docs.push(message);
            }
            if (docs.length < headers.length) {
              return ctx.db
                .query('chatroom_messages')
                .withIndex('by_chatroom', (q) => q.eq('chatroomId', args.chatroomId))
                .order('desc')
                .take(200);
            }
            return docs;
          })()
        : await ctx.db
            .query('chatroom_messages')
            .withIndex('by_chatroom', (q) => q.eq('chatroomId', args.chatroomId))
            .order('desc')
            .take(200);

    const messages = contextWindow.reverse();

    // Find origin message
    // If triggerMessageId is set from the pinned context, use it directly;
    // otherwise fall back to the heuristic (latest acknowledged user message)
    let originMessage: (typeof messages)[0] | null = null;
    let originIndex = -1;

    if (originMessageId) {
      // Use triggerMessageId as the anchor directly
      originIndex = messages.findIndex((m) => m._id.toString() === originMessageId);
      originMessage = originIndex >= 0 ? messages[originIndex] : null;
    } else {
      // Heuristic: find the latest acknowledged user message
      for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i];
        if (
          msg.senderRole.toLowerCase() === 'user' &&
          msg.type === 'message' &&
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
        // Get task status and content for this message
        if (message.taskId) {
          const task = await ctx.db.get('chatroom_tasks', message.taskId);
          if (task) {
            taskStatus = task.status;
            taskContent = task.content;
          }
        }

        const attachments = await enrichMessageAttachments(ctx, message);

        return {
          _id: message._id.toString(),
          _creationTime: message._creationTime,
          senderRole: message.senderRole,
          targetRole: message.targetRole,
          content: message.content,
          type: message.type,
          taskId: message.taskId?.toString(),
          taskStatus,
          taskContent,
          ...attachments,
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
    const pendingTasks = await ctx.db
      .query('chatroom_tasks')
      .withIndex('by_chatroom_status_assignedTo', (q) =>
        q.eq('chatroomId', args.chatroomId).eq('status', 'pending').eq('assignedTo', args.role)
      )
      .collect();

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
            taskId: originMessage.taskId?.toString(),
          }
        : null,
      pendingTasksForRole: pendingTasks.length,
    };
  },
});
