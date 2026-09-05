import type { ConversationMode } from '@workspace/shared/domain/conversation-mode';
import { plannerEnhancerEnabledForMode } from '@workspace/shared/domain/conversation-mode';
import { normalizeTaskEnvelope, type TaskEnvelopeV1 } from '@workspace/shared/domain/task-envelope';

import { markAgentViewHasHistory } from './project-agent-view-metadata';
import { reserveFrontQueuePosition } from './reserve-front-queue-position';
import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import { getAndIncrementQueuePosition } from '../../../../convex/lib/chatroomUtils';
import { getTeamEntryPoint } from '../../entities/team';
import { resolvePlannerEnhancerEnabledFromConfig } from '../enhancer/resolve-planner-enhancer-enabled';
import { insertChatroomMessage, linkMessageToTask } from '../message/message-read-model';
import { createTask as createTaskUsecase, shouldEnqueueMessage } from '../task/create-task';
import { adjustTaskCount } from '../task/task-counts';

export type SendAutomatedUserMessageResult =
  | { ok: true; messageId: Id<'chatroom_messages'> | Id<'chatroom_messageQueue'> }
  | { ok: false; reason: 'chatroom_not_active' | 'empty_content' };

export async function sendAutomatedUserMessage(
  ctx: MutationCtx,
  args: {
    chatroomId: Id<'chatroom_rooms'>;
    content: string;
    sourcePlatform?: string | undefined;
    scheduledPromptId?: Id<'chatroom_scheduledPrompts'> | undefined;
    attachedTaskIds?: Id<'chatroom_tasks'>[] | undefined;
    attachedBacklogItemIds?: Id<'chatroom_backlog'>[] | undefined;
    attachedMessageIds?: Id<'chatroom_messages'>[] | undefined;
    attachedSnippets?:
      { reference: string; fileSource: string; selectedContent: string }[] | undefined;
    userId?: Id<'users'> | undefined;
    startInNewSession: boolean | undefined;
    enqueueAtFront?: boolean | undefined;
    conversationMode?: ConversationMode | undefined;
    taskEnvelope?: TaskEnvelopeV1 | undefined;
  }
): Promise<SendAutomatedUserMessageResult> {
  const chatroom = await ctx.db.get('chatroom_rooms', args.chatroomId);
  if (!chatroom || chatroom.status !== 'active') {
    return { ok: false, reason: 'chatroom_not_active' };
  }
  const trimmed = args.content.trim();
  if (!trimmed) return { ok: false, reason: 'empty_content' };

  const targetRole = getTeamEntryPoint(chatroom) ?? undefined;
  const enqueue = await shouldEnqueueMessage(ctx, args.chatroomId);
  const queuePosition =
    enqueue && args.enqueueAtFront
      ? await reserveFrontQueuePosition(ctx, args.chatroomId, chatroom)
      : await getAndIncrementQueuePosition(ctx, chatroom);

  // Compatibility transition: an explicit envelope or mode short-circuits the
  // legacy enhancer-config lookup. Only old-style callers (no envelope, no
  // mode) keep the live-config fallback so the resolved boolean selects the
  // same effective enhancer mode while a complete envelope is still persisted.
  let legacyPlannerEnhancerEnabled: boolean | undefined;
  const userId = args.userId;
  if (args.taskEnvelope === undefined && args.conversationMode === undefined && userId) {
    const config = await ctx.db
      .query('chatroom_enhancerConfigs')
      .withIndex('by_chatroom_user', (q) =>
        q.eq('chatroomId', args.chatroomId).eq('userId', userId)
      )
      .unique();
    legacyPlannerEnhancerEnabled = resolvePlannerEnhancerEnabledFromConfig(config);
  }

  // TaskEnvelopeV1 is the source of truth for the policy snapshot.
  const envelope = normalizeTaskEnvelope({
    taskEnvelope: args.taskEnvelope,
    conversationMode: args.conversationMode,
    plannerEnhancerEnabled: legacyPlannerEnhancerEnabled,
    startInNewSession: args.startInNewSession,
  });

  // TEMPORARY backwards-compatible scalar projections for legacy readers.
  // These fields are derived from the envelope only (or the legacy fallback
  // input that produced it) and are NOT sources of truth. Remove together with
  // the plannerEnhancerEnabled/conversationMode/startInNewSession columns after
  // all readers migrate to taskEnvelope.
  const modeExplicitlySelected =
    args.taskEnvelope !== undefined || args.conversationMode !== undefined;
  const legacyConversationModeProjection = modeExplicitlySelected
    ? envelope.conversationMode
    : undefined;
  const legacyPlannerEnhancerProjection = modeExplicitlySelected
    ? plannerEnhancerEnabledForMode(envelope.conversationMode)
    : legacyPlannerEnhancerEnabled;

  if (enqueue) {
    const queuedMessageId = await ctx.db.insert('chatroom_messageQueue', {
      chatroomId: args.chatroomId,
      senderRole: 'user',
      ...(targetRole !== undefined ? { targetRole } : {}),
      content: trimmed,
      type: 'message' as const,
      queuePosition,
      ...(args.attachedTaskIds?.length ? { attachedTaskIds: args.attachedTaskIds } : {}),
      ...(args.attachedBacklogItemIds?.length
        ? { attachedBacklogItemIds: args.attachedBacklogItemIds }
        : {}),
      ...(args.attachedMessageIds?.length ? { attachedMessageIds: args.attachedMessageIds } : {}),
      ...(args.attachedSnippets?.length ? { attachedSnippets: args.attachedSnippets } : {}),
      ...(args.sourcePlatform ? { sourcePlatform: args.sourcePlatform } : {}),
      ...(args.scheduledPromptId ? { scheduledPromptId: args.scheduledPromptId } : {}),
      // TEMPORARY scalar projections (see legacy recipe above).
      ...(legacyPlannerEnhancerProjection !== undefined
        ? { plannerEnhancerEnabled: legacyPlannerEnhancerProjection }
        : {}),
      ...(legacyConversationModeProjection !== undefined
        ? { conversationMode: legacyConversationModeProjection }
        : {}),
      ...(args.startInNewSession !== undefined
        ? { startInNewSession: args.startInNewSession }
        : {}),
      taskEnvelope: envelope,
    });
    await adjustTaskCount(ctx, args.chatroomId, 'queueSize', 1);
    await ctx.db.patch('chatroom_rooms', args.chatroomId, { lastActivityAt: Date.now() });
    return { ok: true, messageId: queuedMessageId };
  }

  const messageId = await insertChatroomMessage(ctx, {
    chatroomId: args.chatroomId,
    senderRole: 'user',
    content: trimmed,
    ...(targetRole !== undefined ? { targetRole } : {}),
    type: 'message' as const,
    ...(args.sourcePlatform ? { sourcePlatform: args.sourcePlatform } : {}),
    ...(args.scheduledPromptId ? { scheduledPromptId: args.scheduledPromptId } : {}),
    ...(args.attachedTaskIds?.length ? { attachedTaskIds: args.attachedTaskIds } : {}),
    ...(args.attachedBacklogItemIds?.length
      ? { attachedBacklogItemIds: args.attachedBacklogItemIds }
      : {}),
    ...(args.attachedMessageIds?.length ? { attachedMessageIds: args.attachedMessageIds } : {}),
    ...(args.attachedSnippets?.length ? { attachedSnippets: args.attachedSnippets } : {}),
  });
  await markAgentViewHasHistory(ctx, args.chatroomId);
  await ctx.db.patch('chatroom_rooms', args.chatroomId, { lastActivityAt: Date.now() });

  const { taskId } = await createTaskUsecase(ctx, {
    chatroomId: args.chatroomId,
    createdBy: 'user',
    content: trimmed,
    forceStatus: undefined,
    assignedTo: targetRole,
    sourceMessageId: messageId,
    attachedTaskIds: args.attachedTaskIds,
    queuePosition,
    startInNewSession: args.startInNewSession,
    // TEMPORARY scalar projections (see legacy recipe above).
    ...(legacyPlannerEnhancerProjection !== undefined
      ? { plannerEnhancerEnabled: legacyPlannerEnhancerProjection }
      : {}),
    ...(legacyConversationModeProjection !== undefined
      ? { conversationMode: legacyConversationModeProjection }
      : {}),
    taskEnvelope: envelope,
  });
  await linkMessageToTask(ctx, messageId, taskId);
  return { ok: true, messageId };
}
