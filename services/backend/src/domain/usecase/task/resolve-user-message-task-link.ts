import type { Doc, Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../../../../convex/_generated/server';

type DbCtx = MutationCtx | QueryCtx;

/** Resolve the primary user message for a task (non-progress). */
async function findPrimaryMessageForTask(
  ctx: DbCtx,
  taskId: Id<'chatroom_tasks'>
): Promise<Doc<'chatroom_messages'> | null> {
  const messages = await ctx.db
    .query('chatroom_messages')
    .withIndex('by_taskId', (q) => q.eq('taskId', taskId))
    .collect();
  return (
    messages.find((m) => m.type === 'message') ??
    messages.find((m) => m.type !== 'progress') ??
    messages[0] ??
    null
  );
}

export async function resolveMessageForTask(
  ctx: DbCtx,
  task: Doc<'chatroom_tasks'>
): Promise<Doc<'chatroom_messages'> | null> {
  if (task.sourceMessageId) {
    const source = await ctx.db.get('chatroom_messages', task.sourceMessageId);
    if (source) {
      return source;
    }
  }
  return findPrimaryMessageForTask(ctx, task._id);
}

export type ResolvedUserMessageRef =
  | { kind: 'queued'; record: Doc<'chatroom_messageQueue'> }
  | { kind: 'materialized'; record: Doc<'chatroom_messages'> };

/** Resolve a user message id from either chatroom_messages or chatroom_messageQueue. */
export async function resolveUserMessageRef(
  ctx: DbCtx,
  messageId: Id<'chatroom_messages'> | Id<'chatroom_messageQueue'>
): Promise<ResolvedUserMessageRef | null> {
  const materialized = await ctx.db.get('chatroom_messages', messageId as Id<'chatroom_messages'>);
  if (materialized) {
    return { kind: 'materialized', record: materialized };
  }

  const queued = await ctx.db.get(
    'chatroom_messageQueue',
    messageId as Id<'chatroom_messageQueue'>
  );
  if (queued) {
    return { kind: 'queued', record: queued };
  }

  return null;
}
