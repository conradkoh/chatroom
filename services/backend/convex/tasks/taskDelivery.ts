// TODO: Move to src/domain/usecase/task/ as part of clean architecture migration
/**
 * Task Delivery Data Generator
 * 
 * Internal module for generating the complete task delivery output.
 * Used by both tasks.readTask mutation and messages.getTaskDeliveryPrompt query.
 */

import type { Doc, Id } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';
import { getTeamEntryPoint } from '../../src/domain/entities/team';
import { isActiveParticipant } from '../../src/domain/entities/participant';
import { getConfig } from '../../prompts/config/index';
import { getCliEnvPrefix } from '../../prompts/utils/index';
import { generateFullCliOutput } from '../../prompts/cli/get-next-task/fullOutput';

// Types
interface TaskDeliveryParams {
  chatroomId: Id<'chatroom_rooms'>;
  role: string;
  task: Doc<'chatroom_tasks'>;
  message: Doc<'chatroom_messages'> | Doc<'chatroom_messageQueue'> | null;
  chatroom: Doc<'chatroom_rooms'>;
  convexUrl?: string;
}

export interface TaskDeliveryResult {
  fullCliOutput: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  json: any;
}

/**
 * Generate the complete task delivery data for CLI output.
 * 
 * This function:
 * 1. Fetches context (participants, recent messages, etc.)
 * 2. Generates the full CLI output string
 * 3. Returns structured JSON for programmatic use
 */
export async function getTaskDeliveryPromptData(
  ctx: QueryCtx,
  params:TaskDeliveryParams
): Promise<TaskDeliveryResult> {
  const { chatroomId, role, task, message, chatroom, convexUrl } = params;
  const config = getConfig();

  // Fetch participants
  const participants = await ctx.db
    .query('chatroom_participants')
    .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
    .collect();

  const waitingParticipants = participants.filter(
    (p) => p.role.toLowerCase() !== role.toLowerCase() && isActiveParticipant(p)
  );

  // Get recent messages for classification
  const recentMessages = await ctx.db
    .query('chatroom_messages')
    .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
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

  if (currentClassification === 'new_feature') {
    const normalizedRole = role.toLowerCase();
    if (normalizedRole === 'builder') {
      canHandoffToUser = false;
    }
  }

  const availableHandoffRoles = canHandoffToUser ? [...availableRoles, 'user'] : availableRoles;

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
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
        .collect();
      const currentMessageCount = allMessages.length;
      const messagesSinceContext = currentMessageCount - (context.messageCountAtCreation ?? 0);

      // Compute time elapsed since context creation
      const elapsedMs = Date.now() - context.createdAt;
      const elapsedHours = elapsedMs / (1000 * 60* 60);

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

  // Get context window (origin message + messages since)
  const contextRecentMessages = await ctx.db
    .query('chatroom_messages')
    .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
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

  // Fetch attached tasks if any exist in origin message
  const attachedTasksMap = new Map<
    string,
    { id: string; content: string; status: string; createdBy: string }
  >();
  if (originMessage?.attachedTaskIds && originMessage.attachedTaskIds.length > 0) {
    for (const taskId of originMessage.attachedTaskIds) {
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

  // Fetch attached backlog items if any exist in origin message
  const attachedBacklogItemsMap = new Map<string, { id: string; content: string; status: string }>();
  if (originMessage?.attachedBacklogItemIds && originMessage.attachedBacklogItemIds.length > 0) {
    for (const itemId of originMessage.attachedBacklogItemIds) {
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

  // Build CLI env prefix
  const cliEnvPrefix = getCliEnvPrefix(config.getConvexURLWithFallback(convexUrl));

  // Determine entry point status for context management
  const entryPoint = getTeamEntryPoint(chatroom);
  const isEntryPoint = entryPoint ? role.toLowerCase() === entryPoint.toLowerCase() : true;

  // Generate the complete CLI output
  const fullCliOutput = generateFullCliOutput({
    chatroomId,
    role,
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
              status: i!.status,
              content: i!.content,
            })),
        }
      : null,
    followUpCountSinceOrigin,
    originMessageCreatedAt: originMessage?._creationTime ?? null,
    isEntryPoint,
    availableHandoffTargets: availableHandoffRoles,
  });

  // Build JSON context
  const deliveryContext = {
    chatroomId,
    role,
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
    currentClassification,
    teamName: chatroom.teamName || 'Team',
    teamRoles: chatroom.teamRoles || [],
    currentTimestamp: new Date().toISOString(),
  };

  return {
    fullCliOutput,
    json: deliveryContext,
  };
}