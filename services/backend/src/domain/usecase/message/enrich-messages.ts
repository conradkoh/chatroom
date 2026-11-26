// Moved unchanged from convex/messages.ts; its complexity is pre-existing.
// fallow-ignore-file complexity
/**
 * Message enrichment — resolves stored attachment references into the flat
 * arrays carried on the canonical {@link Message} wire shape, and projects a
 * stored row onto that shape.
 *
 * Stored rows keep `attachedTaskIds`, `attachedBacklogItemIds`, … The wire
 * carries resolved `attachedTasks`, `attachedBacklogItems`, … instead.
 */

import type { Doc, Id } from '../../../../convex/_generated/dataModel';
import type { QueryCtx } from '../../../../convex/_generated/server';
import type { AttachedFileView } from '../../entities/file-attachment';
import type { Message } from '../../entities/message';

/** The resolved attachment slice of the wire shape. */
export type ResolvedAttachments = Pick<
  Message,
  | 'attachedTasks'
  | 'attachedBacklogItems'
  | 'attachedMessages'
  | 'attachedArtifacts'
  | 'attachedFiles'
  | 'attachedSnippets'
>;

/**
 * Stored attachment references. Structural so it accepts both
 * `chatroom_messages` rows and `chatroom_messageQueue` rows.
 */
type AttachmentRefs = {
  attachedTaskIds?: Id<'chatroom_tasks'>[] | undefined;
  attachedBacklogItemIds?: Id<'chatroom_backlog'>[] | undefined;
  attachedMessageIds?: Id<'chatroom_messages'>[] | undefined;
  attachedArtifactIds?: Id<'chatroom_artifacts'>[] | undefined;
  attachedFileIds?: Id<'chatroom_fileAttachments'>[] | undefined;
  attachedSnippets?:
    { reference: string; fileSource: string; selectedContent: string }[] | undefined;
  startInNewSession?: boolean | undefined;
};

/**
 * Resolves attachment IDs on a message into full attachment details.
 * Shared by listQueued to avoid duplication.
 */
export async function enrichMessageAttachments(
  ctx: QueryCtx,
  msg: AttachmentRefs
): Promise<ResolvedAttachments> {
  // Resolve attached tasks
  let attachedTasks: { _id: string; content: string; backlogStatus: string }[] | undefined;
  if (msg.attachedTaskIds && msg.attachedTaskIds.length > 0) {
    const tasks = await Promise.all(
      msg.attachedTaskIds.map((taskId) => ctx.db.get('chatroom_tasks', taskId))
    );
    attachedTasks = tasks
      .filter((t): t is NonNullable<typeof t> => t !== null)
      .map((t) => ({ _id: t._id, content: t.content, backlogStatus: t.status }));
  }

  // Resolve attached backlog items
  let attachedBacklogItems: { id: string; content: string; status: string }[] | undefined;
  if (msg.attachedBacklogItemIds && msg.attachedBacklogItemIds.length > 0) {
    const items = await Promise.all(
      msg.attachedBacklogItemIds.map((itemId) => ctx.db.get('chatroom_backlog', itemId))
    );
    attachedBacklogItems = items
      .filter((i): i is NonNullable<typeof i> => i !== null && i.status !== 'deleted')
      .map((i) => ({ id: i._id, content: i.content, status: i.status }));
  }

  // Resolve attached messages
  let attachedMessages:
    { _id: string; content: string; senderRole: string; _creationTime: number }[] | undefined;
  if (msg.attachedMessageIds && msg.attachedMessageIds.length > 0) {
    const msgs = await Promise.all(
      msg.attachedMessageIds.map((msgId) => ctx.db.get('chatroom_messages', msgId))
    );
    attachedMessages = msgs
      .filter((m): m is NonNullable<typeof m> => m !== null)
      .map((m) => ({
        _id: m._id,
        content: m.content,
        senderRole: m.senderRole,
        _creationTime: m._creationTime,
      }));
  }

  // Resolve attached artifacts
  let attachedArtifacts:
    | {
        _id: string;
        filename: string;
        description?: string | undefined;
        mimeType?: string | undefined;
      }[]
    | undefined;
  if (msg.attachedArtifactIds && msg.attachedArtifactIds.length > 0) {
    const artifacts = await Promise.all(
      msg.attachedArtifactIds.map((artifactId) => ctx.db.get('chatroom_artifacts', artifactId))
    );
    attachedArtifacts = artifacts
      .filter((a): a is NonNullable<typeof a> => a !== null)
      .map((a) => ({
        _id: a._id,
        filename: a.filename,
        description: a.description,
        mimeType: a.mimeType,
      }));
  }

  // Resolve attached files (uploaded files bound to a user handoff). Reads are
  // metadata-only: never expose storage ids or URLs on the message.
  let attachedFiles: AttachedFileView[] | undefined;
  const attachedFileIds = msg.attachedFileIds;
  if (attachedFileIds && attachedFileIds.length > 0) {
    attachedFiles = [];
    for (const fileId of attachedFileIds) {
      const file = await ctx.db.get('chatroom_fileAttachments', fileId);
      attachedFiles.push(
        file && file.status === 'attached'
          ? {
              _id: file._id,
              status: 'available',
              filename: file.filename,
              mimeType: file.mimeType,
              sizeBytes: file.sizeBytes,
            }
          : { _id: fileId, status: 'removed' }
      );
    }
  }

  return {
    ...(attachedTasks && attachedTasks.length > 0 && { attachedTasks }),
    ...(attachedBacklogItems && attachedBacklogItems.length > 0 && { attachedBacklogItems }),
    ...(attachedArtifacts && attachedArtifacts.length > 0 && { attachedArtifacts }),
    ...(attachedFiles && attachedFiles.length > 0 && { attachedFiles }),
    ...(attachedMessages && attachedMessages.length > 0 && { attachedMessages }),
    ...(msg.attachedSnippets?.length && { attachedSnippets: msg.attachedSnippets }),
  };
}

/**
 * Picks exactly the Message fields. Replaces the whole-document spread, so
 * internal/deprecated columns never reach the wire.
 */
// Exported for the message projection seam; the only in-repo consumer today is enrichMessages below.
// fallow-ignore-next-line unused-export
export function toMessage(
  doc: Doc<'chatroom_messages'>,
  attachments: ResolvedAttachments
): Message {
  return {
    _id: doc._id,
    _creationTime: doc._creationTime,
    type: doc.type,
    senderRole: doc.senderRole,
    targetRole: doc.targetRole,
    content: doc.content,
    taskId: doc.taskId,
    taskOriginMessageId: doc.taskOriginMessageId,
    acknowledgedAt: doc.acknowledgedAt,
    completedAt: doc.completedAt,
    sourcePlatform: doc.sourcePlatform,
    scheduledPromptId: doc.scheduledPromptId,
    senderAgent: doc.senderAgent,
    supersedesPlanId: doc.supersedesPlanId,
    contextCreatedBy: doc.contextCreatedBy,
    ...attachments,
  };
}

/** Projects stored rows onto the canonical wire shape. */
export async function enrichMessages(
  ctx: QueryCtx,
  docs: Doc<'chatroom_messages'>[]
): Promise<Message[]> {
  return Promise.all(
    docs.map(async (doc) => toMessage(doc, await enrichMessageAttachments(ctx, doc)))
  );
}
