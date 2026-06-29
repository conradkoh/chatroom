import { ConvexError } from 'convex/values';

import {
  resolveMessageForTask,
  resolveUserMessageRef,
  type ResolvedUserMessageRef,
} from './resolve-user-message-task-link';
import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';

export type UpdateUserMessageOrTaskArgs =
  | { type: 'task'; taskId: Id<'chatroom_tasks'>; content: string }
  | {
      type: 'message';
      messageId: Id<'chatroom_messages'> | Id<'chatroom_messageQueue'>;
      content: string;
    };

function validateContent(content: string): string {
  const trimmed = content.trim();
  if (!trimmed) {
    throw new ConvexError({
      code: 'INVALID_CONTENT',
      message: 'Message content cannot be empty.',
    });
  }
  return trimmed;
}

export async function updateUserMessageOrTask(
  ctx: MutationCtx,
  args: UpdateUserMessageOrTaskArgs
): Promise<{ success: true }> {
  const content = validateContent(args.content);

  if (args.type === 'task') {
    return updateByTaskId(ctx, args.taskId, content);
  }
  return updateByMessageId(ctx, args.messageId, content);
}

async function updateByTaskId(
  ctx: MutationCtx,
  taskId: Id<'chatroom_tasks'>,
  content: string
): Promise<{ success: true }> {
  const task = await ctx.db.get('chatroom_tasks', taskId);
  if (!task) {
    throw new ConvexError({
      code: 'TASK_NOT_FOUND',
      message: 'Task not found.',
    });
  }

  await patchTaskContent(ctx, taskId, content);

  const message = await resolveMessageForTask(ctx, task);
  if (message) {
    await ctx.db.patch('chatroom_messages', message._id, { content });
  }

  return { success: true };
}

async function updateByMessageId(
  ctx: MutationCtx,
  messageId: Id<'chatroom_messages'> | Id<'chatroom_messageQueue'>,
  content: string
): Promise<{ success: true }> {
  const resolved = await resolveUserMessageRef(ctx, messageId);
  if (!resolved) {
    throw new ConvexError({
      code: 'MESSAGE_NOT_FOUND',
      message: 'Message not found.',
    });
  }

  if (resolved.kind === 'queued') {
    await updateQueuedUserMessage(ctx, resolved, content);
    return { success: true };
  }

  await updateMaterializedUserMessage(ctx, resolved, content);
  return { success: true };
}

async function updateQueuedUserMessage(
  ctx: MutationCtx,
  resolved: Extract<ResolvedUserMessageRef, { kind: 'queued' }>,
  content: string
): Promise<void> {
  await ctx.db.patch('chatroom_messageQueue', resolved.record._id, { content });
}

async function updateMaterializedUserMessage(
  ctx: MutationCtx,
  resolved: Extract<ResolvedUserMessageRef, { kind: 'materialized' }>,
  content: string
): Promise<void> {
  const message = resolved.record;
  await ctx.db.patch('chatroom_messages', message._id, { content });

  if (!message.taskId) {
    return;
  }

  const task = await ctx.db.get('chatroom_tasks', message.taskId);
  if (!task) {
    return;
  }

  await patchTaskContent(ctx, task._id, content);
}

async function patchTaskContent(
  ctx: MutationCtx,
  taskId: Id<'chatroom_tasks'>,
  content: string
): Promise<void> {
  await ctx.db.patch('chatroom_tasks', taskId, {
    content,
    updatedAt: Date.now(),
  });
}
