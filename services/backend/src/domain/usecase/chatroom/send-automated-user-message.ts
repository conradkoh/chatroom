import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import { getAndIncrementQueuePosition } from '../../../../convex/lib/chatroomUtils';
import { getTeamEntryPoint } from '../../entities/team';
import { restartOfflineAgentsOnUserMessage } from '../agent/restart-offline-agents-on-user-message';
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
    sourcePlatform?: string;
    scheduledPromptId?: Id<'chatroom_scheduledPrompts'>;
    attachedTaskIds?: Id<'chatroom_tasks'>[];
    attachedBacklogItemIds?: Id<'chatroom_backlog'>[];
    attachedMessageIds?: Id<'chatroom_messages'>[];
    attachedSnippets?: { reference: string; fileSource: string; selectedContent: string }[];
  }
): Promise<SendAutomatedUserMessageResult> {
  const chatroom = await ctx.db.get('chatroom_rooms', args.chatroomId);
  if (!chatroom || chatroom.status !== 'active') {
    return { ok: false, reason: 'chatroom_not_active' };
  }
  const trimmed = args.content.trim();
  if (!trimmed) return { ok: false, reason: 'empty_content' };

  const targetRole = getTeamEntryPoint(chatroom) ?? undefined;
  const queuePosition = await getAndIncrementQueuePosition(ctx, chatroom);
  const enqueue = await shouldEnqueueMessage(ctx, args.chatroomId);

  if (enqueue) {
    const queuedMessageId = await ctx.db.insert('chatroom_messageQueue', {
      chatroomId: args.chatroomId,
      senderRole: 'user',
      targetRole,
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
    });
    await adjustTaskCount(ctx, args.chatroomId, 'queueSize', 1);
    await ctx.db.patch('chatroom_rooms', args.chatroomId, { lastActivityAt: Date.now() });
    return { ok: true, messageId: queuedMessageId };
  }

  const messageId = await ctx.db.insert('chatroom_messages', {
    chatroomId: args.chatroomId,
    senderRole: 'user',
    content: trimmed,
    targetRole,
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
  });
  await ctx.db.patch('chatroom_messages', messageId, { taskId });
  await restartOfflineAgentsOnUserMessage(ctx, args.chatroomId);
  return { ok: true, messageId };
}
