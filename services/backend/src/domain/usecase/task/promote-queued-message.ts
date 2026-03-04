import type { MutationCtx } from '../../../../convex/_generated/server';
import type { Id } from '../../../../convex/_generated/dataModel';

/**
 * Copies a staged message from chatroom_messageQueue to chatroom_messages
 * when a queued task is promoted to pending.
 *
 * After copying:
 * - task.sourceMessageId → new chatroom_messages ID
 * - task.queuedMessageId → cleared (set to undefined)
 * - queue record is deleted (no longer needed)
 *
 * This is idempotent: if task.sourceMessageId is already set, it skips the copy.
 */
export async function promoteQueuedMessage(
  ctx: MutationCtx,
  taskId: Id<'chatroom_tasks'>
): Promise<Id<'chatroom_messages'> | null> {
  const task = await ctx.db.get('chatroom_tasks', taskId);
  if (!task) return null;

  // Idempotent: already promoted
  if (task.sourceMessageId) return task.sourceMessageId;

  // No queue record to copy
  if (!task.queuedMessageId) return null;

  const queueRecord = await ctx.db.get('chatroom_messageQueue', task.queuedMessageId);
  if (!queueRecord) return null;

  // Copy from staging → messages
  const messageId = await ctx.db.insert('chatroom_messages', {
    chatroomId: queueRecord.chatroomId,
    senderRole: queueRecord.senderRole,
    targetRole: queueRecord.targetRole,
    content: queueRecord.content,
    type: queueRecord.type,
    taskId,
    // Copy classification if already set (from taskStarted)
    ...(queueRecord.classification && { classification: queueRecord.classification }),
    ...(queueRecord.featureTitle && { featureTitle: queueRecord.featureTitle }),
    ...(queueRecord.featureDescription && { featureDescription: queueRecord.featureDescription }),
    ...(queueRecord.featureTechSpecs && { featureTechSpecs: queueRecord.featureTechSpecs }),
    ...(queueRecord.attachedTaskIds?.length && { attachedTaskIds: queueRecord.attachedTaskIds }),
    ...(queueRecord.attachedArtifactIds?.length && {
      attachedArtifactIds: queueRecord.attachedArtifactIds,
    }),
  });

  // Note: acknowledgedAt is intentionally NOT set here.
  // Context-building queries filter out user messages where acknowledgedAt is undefined,
  // so the promoted message will only appear in agent context once the agent claims it
  // (via claimTask → sets acknowledgedAt on the message).
  // This is the correct behavior — the message should not count as context until it is being worked on.
  // Update task: set sourceMessageId, clear queuedMessageId
  await ctx.db.patch('chatroom_tasks', taskId, {
    sourceMessageId: messageId,
    queuedMessageId: undefined,
  });

  // Delete the queue record (no longer needed after promotion)
  await ctx.db.delete('chatroom_messageQueue', task.queuedMessageId);

  return messageId;
}
