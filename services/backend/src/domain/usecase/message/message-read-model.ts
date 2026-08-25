import type { Doc, Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../../../../convex/_generated/server';

export function isTimelineMessageType(type: Doc<'chatroom_messages'>['type']): boolean {
  return type !== 'join' && type !== 'progress';
}
async function resolveTaskStatus(
  ctx: MutationCtx | QueryCtx,
  taskId: Id<'chatroom_tasks'> | undefined
) {
  return taskId ? (await ctx.db.get('chatroom_tasks', taskId))?.status : undefined;
}
export async function upsertMessageReadModel(
  ctx: MutationCtx,
  message: Doc<'chatroom_messages'>
): Promise<void> {
  const taskStatus = await resolveTaskStatus(ctx, message.taskId);
  const next = {
    messageId: message._id,
    chatroomId: message.chatroomId,
    messageCreatedAt: message._creationTime,
    senderRole: message.senderRole,
    type: message.type,
    isTimeline: isTimelineMessageType(message.type),
    ...(message.taskId ? { taskId: message.taskId, ...(taskStatus ? { taskStatus } : {}) } : {}),
    ...(message.acknowledgedAt !== undefined ? { acknowledgedAt: message.acknowledgedAt } : {}),
  };
  const existing = await ctx.db
    .query('chatroom_messageReadModels')
    .withIndex('by_messageId', (q) => q.eq('messageId', message._id))
    .first();
  if (existing) await ctx.db.patch('chatroom_messageReadModels', existing._id, next);
  else await ctx.db.insert('chatroom_messageReadModels', next);
}
export async function insertChatroomMessage(
  ctx: MutationCtx,
  fields: Omit<Doc<'chatroom_messages'>, '_id' | '_creationTime'>
): Promise<Id<'chatroom_messages'>> {
  const id = await ctx.db.insert('chatroom_messages', fields);
  const message = await ctx.db.get('chatroom_messages', id);
  if (message) await upsertMessageReadModel(ctx, message);
  return id;
}
export async function syncMessageReadModel(
  ctx: MutationCtx,
  messageId: Id<'chatroom_messages'>
): Promise<void> {
  const message = await ctx.db.get('chatroom_messages', messageId);
  if (message) await upsertMessageReadModel(ctx, message);
  else await deleteMessageReadModel(ctx, messageId);
}
export async function linkMessageToTask(
  ctx: MutationCtx,
  messageId: Id<'chatroom_messages'>,
  taskId: Id<'chatroom_tasks'>
): Promise<void> {
  await ctx.db.patch('chatroom_messages', messageId, { taskId });
  await syncMessageReadModel(ctx, messageId);
}
export async function deleteMessageReadModel(
  ctx: MutationCtx,
  messageId: Id<'chatroom_messages'>
): Promise<void> {
  const row = await ctx.db
    .query('chatroom_messageReadModels')
    .withIndex('by_messageId', (q) => q.eq('messageId', messageId))
    .first();
  if (row) await ctx.db.delete('chatroom_messageReadModels', row._id);
}
export async function ensureMessageReadModelState(
  ctx: MutationCtx,
  chatroomId: Id<'chatroom_rooms'>
): Promise<void> {
  const row = await ctx.db
    .query('chatroom_messageReadModelState')
    .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
    .first();
  if (!row) await ctx.db.insert('chatroom_messageReadModelState', { chatroomId });
}
export async function isMessageReadModelComplete(
  ctx: QueryCtx,
  chatroomId: Id<'chatroom_rooms'>
): Promise<boolean> {
  return (
    (await ctx.db
      .query('chatroom_messageReadModelState')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
      .first()) !== null
  );
}
