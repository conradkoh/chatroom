import { maybePromoteNextQueuedTask } from './maybe-promote-next-queued-task';
import {
  resolveMessageForTask,
  resolveUserMessageRef,
  type ResolvedUserMessageRef,
} from './resolve-user-message-task-link';
import { adjustTaskCount, statusToCountField } from './task-counts';
import type { Doc, Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import { ACTIVE_TASK_STATUSES } from '../../entities/task';

export type DeleteUserMessageOrTaskArgs =
  | { type: 'task'; taskId: Id<'chatroom_tasks'> }
  | {
      type: 'message';
      messageId: Id<'chatroom_messages'> | Id<'chatroom_messageQueue'>;
    };

export async function deleteUserMessageOrTask(
  ctx: MutationCtx,
  args: DeleteUserMessageOrTaskArgs
): Promise<{ success: true }> {
  if (args.type === 'task') {
    return deleteByTaskId(ctx, args.taskId);
  }
  return deleteByMessageId(ctx, args.messageId);
}

async function deleteByTaskId(
  ctx: MutationCtx,
  taskId: Id<'chatroom_tasks'>
): Promise<{ success: true }> {
  const task = await ctx.db.get('chatroom_tasks', taskId);
  if (!task) {
    return { success: true };
  }

  await deleteTaskAndLinkedMessages(ctx, task);
  return { success: true };
}

async function deleteByMessageId(
  ctx: MutationCtx,
  messageId: Id<'chatroom_messages'> | Id<'chatroom_messageQueue'>
): Promise<{ success: true }> {
  const resolved = await resolveUserMessageRef(ctx, messageId);
  if (!resolved) {
    return { success: true };
  }

  if (resolved.kind === 'queued') {
    await deleteQueuedUserMessage(ctx, resolved);
    return { success: true };
  }

  await deleteMaterializedUserMessage(ctx, resolved);
  return { success: true };
}

async function deleteQueuedUserMessage(
  ctx: MutationCtx,
  resolved: Extract<ResolvedUserMessageRef, { kind: 'queued' }>
): Promise<void> {
  await ctx.db.delete('chatroom_messageQueue', resolved.record._id);
  await adjustTaskCount(ctx, resolved.record.chatroomId, 'queueSize', -1);
}

async function deleteMaterializedUserMessage(
  ctx: MutationCtx,
  resolved: Extract<ResolvedUserMessageRef, { kind: 'materialized' }>
): Promise<void> {
  const message = resolved.record;
  if (!message.taskId) {
    await ctx.db.delete('chatroom_messages', message._id);
    return;
  }

  const task = await ctx.db.get('chatroom_tasks', message.taskId);
  if (task) {
    await deleteTaskAndLinkedMessages(ctx, task);
    return;
  }

  await ctx.db.delete('chatroom_messages', message._id);
}

async function deleteTaskAndLinkedMessages(
  ctx: MutationCtx,
  task: Doc<'chatroom_tasks'>
): Promise<void> {
  await decrementTaskStatusCount(ctx, task);
  await deleteMessagesForTask(ctx, task);
  await ctx.db.delete('chatroom_tasks', task._id);
  await promoteQueueIfTaskWasActive(ctx, task);
}

async function decrementTaskStatusCount(
  ctx: MutationCtx,
  task: Doc<'chatroom_tasks'>
): Promise<void> {
  const countField = statusToCountField(task.status);
  if (!countField) {
    return;
  }
  await adjustTaskCount(ctx, task.chatroomId, countField, -1);
}

async function deleteMessagesForTask(ctx: MutationCtx, task: Doc<'chatroom_tasks'>): Promise<void> {
  const messageIds = await collectMessageIdsForTask(ctx, task);
  for (const messageId of messageIds) {
    await ctx.db.delete('chatroom_messages', messageId);
  }
}

async function collectMessageIdsForTask(
  ctx: MutationCtx,
  task: Doc<'chatroom_tasks'>
): Promise<Set<Id<'chatroom_messages'>>> {
  const linkedMessages = await ctx.db
    .query('chatroom_messages')
    .withIndex('by_taskId', (q) => q.eq('taskId', task._id))
    .collect();

  const messageIds = new Set(linkedMessages.map((m) => m._id));
  const sourceMessage = await resolveMessageForTask(ctx, task);
  if (sourceMessage) {
    messageIds.add(sourceMessage._id);
  }
  return messageIds;
}

async function promoteQueueIfTaskWasActive(
  ctx: MutationCtx,
  task: Doc<'chatroom_tasks'>
): Promise<void> {
  if (!ACTIVE_TASK_STATUSES.has(task.status)) {
    return;
  }
  await maybePromoteNextQueuedTask(ctx, task.chatroomId);
}
