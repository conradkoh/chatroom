import { createTask } from './create-task';
import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import { getAndIncrementQueuePosition } from '../../../../convex/auth/cliSessionAuth';

/**
 * Promotes a staged message from chatroom_messageQueue to chatroom_messages,
 * and creates a new task (with status 'pending') for the message.
 *
 * This is the single promotion point:
 * - Inserts new chatroom_messages record from queue data
 * - Creates a new chatroom_tasks record with status 'pending'
 * - Sets task.sourceMessageId to the new message
 * - Deletes the chatroom_messageQueue record
 *
 * This is idempotent by queuedMessageId: if the queue record no longer exists,
 * it returns null without side effects.
 *
 * @returns { messageId, taskId } if promoted, null if queue record not found.
 */
export async function promoteQueuedMessage(
  ctx: MutationCtx,
  queuedMessageId: Id<'chatroom_messageQueue'>
): Promise<{ messageId: Id<'chatroom_messages'>; taskId: Id<'chatroom_tasks'> } | null> {
  const queueRecord = await ctx.db.get('chatroom_messageQueue', queuedMessageId);
  if (!queueRecord) return null;

  const chatroom = await ctx.db.get('chatroom_rooms', queueRecord.chatroomId);
  if (!chatroom) return null;
  const queuePosition = await getAndIncrementQueuePosition(ctx, chatroom);

  // Copy from staging → messages
  const messageId = await ctx.db.insert('chatroom_messages', {
    chatroomId: queueRecord.chatroomId,
    senderRole: queueRecord.senderRole,
    targetRole: queueRecord.targetRole,
    content: queueRecord.content,
    type: queueRecord.type,
    ...(queueRecord.attachedTaskIds?.length && { attachedTaskIds: queueRecord.attachedTaskIds }),
    ...(queueRecord.attachedBacklogItemIds?.length && {
      attachedBacklogItemIds: queueRecord.attachedBacklogItemIds,
    }),
    ...(queueRecord.attachedArtifactIds?.length && {
      attachedArtifactIds: queueRecord.attachedArtifactIds,
    }),
    ...(queueRecord.attachedMessageIds?.length && {
      attachedMessageIds: queueRecord.attachedMessageIds,
    }),
  });

  // Note: acknowledgedAt is intentionally NOT set here.
  // Context-building queries filter out user messages where acknowledgedAt is undefined,
  // so the promoted message will only appear in agent context once the agent claims it
  // (via claimTask → sets acknowledgedAt on the message).
  // This is the correct behavior — the message should not count as context until it is being worked on.

  // Create task for the promoted message (task is created here, not at queue time)
  const { taskId } = await createTask(ctx, {
    chatroomId: queueRecord.chatroomId,
    createdBy: 'user',
    content: queueRecord.content,
    forceStatus: 'pending',
    sourceMessageId: messageId,
    queuePosition,
    ...(queueRecord.attachedTaskIds?.length && { attachedTaskIds: queueRecord.attachedTaskIds }),
  });

  // Patch message with taskId (bidirectional link)
  await ctx.db.patch('chatroom_messages', messageId, { taskId });

  // Delete the queue record (no longer needed after promotion)
  await ctx.db.delete('chatroom_messageQueue', queuedMessageId);

  return { messageId, taskId };
}
