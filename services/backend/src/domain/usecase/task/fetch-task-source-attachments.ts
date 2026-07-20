/**
 * fetch-task-source-attachments
 *
 * Shared helpers for fetching attachments linked through a task's source message.
 * Used by read-task (mutation) and listTasks (query) to enrich task results with
 * their source message's attached backlog items, snippets, tasks, and messages.
 */

import type { Doc, Id, TableNames } from '../../../../convex/_generated/dataModel';
import type { QueryCtx } from '../../../../convex/_generated/server';

export type TaskSourceAttachments = {
  attachedTasks?: { _id: string; content: string; status: string }[];
  attachedBacklogItems?: { id: string; content: string; status: string }[];
  attachedMessages?: { _id: string; content: string; senderRole: string; _creationTime: number }[];
  attachedSnippets?: { reference: string; fileSource: string; selectedContent: string }[];
};

// fallow-ignore-next-line complexity
export async function fetchTaskSourceAttachments(
  ctx: Pick<QueryCtx, 'db'>,
  task: { sourceMessageId?: Id<'chatroom_messages'> }
): Promise<TaskSourceAttachments> {
  const [attachedBacklogItems, attachedSnippets, attachedTasks, attachedMessages] =
    await Promise.all([
      fetchAttachedBacklogItems(ctx, task),
      fetchAttachedSnippets(ctx, task),
      fetchAttachedTasks(ctx, task),
      fetchAttachedMessages(ctx, task),
    ]);

  const result: TaskSourceAttachments = {};
  if (attachedBacklogItems.length > 0) result.attachedBacklogItems = attachedBacklogItems;
  if (attachedSnippets.length > 0) result.attachedSnippets = attachedSnippets;
  if (attachedTasks.length > 0) result.attachedTasks = attachedTasks;
  if (attachedMessages.length > 0) result.attachedMessages = attachedMessages;
  return result;
}

async function getSourceMessage(
  ctx: Pick<QueryCtx, 'db'>,
  task: { sourceMessageId?: Id<'chatroom_messages'> }
) {
  if (!task.sourceMessageId) return null;
  return ctx.db.get('chatroom_messages', task.sourceMessageId);
}

// fallow-ignore-next-line complexity
async function fetchAttachedDocs<TableName extends TableNames, TResult>(
  ctx: Pick<QueryCtx, 'db'>,
  table: TableName,
  ids: Id<TableName>[] | undefined,
  mapDoc: (doc: Doc<TableName>) => TResult
): Promise<TResult[]> {
  if (!ids?.length) return [];
  const items: TResult[] = [];
  for (const id of ids) {
    const doc = await ctx.db.get(table, id);
    if (doc) items.push(mapDoc(doc));
  }
  return items;
}

async function fetchAttachedBacklogItems(
  ctx: Pick<QueryCtx, 'db'>,
  task: { sourceMessageId?: Id<'chatroom_messages'> }
): Promise<{ id: string; content: string; status: string }[]> {
  const sourceMessage = await getSourceMessage(ctx, task);
  return fetchAttachedDocs(
    ctx,
    'chatroom_backlog',
    sourceMessage?.attachedBacklogItemIds,
    (item) => ({
      id: item._id,
      content: item.content,
      status: item.status,
    })
  );
}

async function fetchAttachedSnippets(
  ctx: Pick<QueryCtx, 'db'>,
  task: { sourceMessageId?: Id<'chatroom_messages'> }
): Promise<{ reference: string; fileSource: string; selectedContent: string }[]> {
  const sourceMessage = await getSourceMessage(ctx, task);
  return sourceMessage?.attachedSnippets ?? [];
}

async function fetchAttachedTasks(
  ctx: Pick<QueryCtx, 'db'>,
  task: { sourceMessageId?: Id<'chatroom_messages'> }
): Promise<{ _id: string; content: string; status: string }[]> {
  const sourceMessage = await getSourceMessage(ctx, task);
  return fetchAttachedDocs(ctx, 'chatroom_tasks', sourceMessage?.attachedTaskIds, (attached) => ({
    _id: attached._id,
    content: attached.content,
    status: attached.status,
  }));
}

async function fetchAttachedMessages(
  ctx: Pick<QueryCtx, 'db'>,
  task: { sourceMessageId?: Id<'chatroom_messages'> }
): Promise<{ _id: string; content: string; senderRole: string; _creationTime: number }[]> {
  const sourceMessage = await getSourceMessage(ctx, task);
  return fetchAttachedDocs(
    ctx,
    'chatroom_messages',
    sourceMessage?.attachedMessageIds,
    (attached) => ({
      _id: attached._id,
      content: attached.content,
      senderRole: attached.senderRole,
      _creationTime: attached._creationTime,
    })
  );
}
