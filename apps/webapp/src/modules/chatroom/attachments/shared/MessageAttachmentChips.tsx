import type { Id } from '@workspace/backend/convex/_generated/dataModel';

import { countMessageAttachments } from './messageAttachmentUtils';
import type { Message } from '../../types/message';
import { AttachedBacklogItemChip } from '../backlog/AttachedBacklogItemChip';
import { AttachedMessageChip } from '../message/AttachedMessageChip';
import { AttachedSnippetChip } from '../snippet/AttachedSnippetChip';
import { AttachedTaskChip } from '../task/AttachedTaskChip';

interface MessageAttachmentChipsProps {
  message: Message;
}

/**
 * Shared read-only chip strip used by both the queued-message row
 * (`QueuedMessageItem`) and the queued-message detail modal
 * (`QueuedMessageDetailModal`).
 *
 * Renders attachment kinds (tasks → backlog items → messages → snippets) in a
 * single flat row. Returns `null` when there are no attachments.
 *
 * Callers are responsible for wrapping this component with their own header
 * text, top-border, margin, and event-stopping containers.
 */
export function MessageAttachmentChips({ message }: MessageAttachmentChipsProps) {
  if (countMessageAttachments(message) === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5">
      {message.attachedTasks?.map((task) => (
        <AttachedTaskChip
          key={task._id}
          mode="view"
          taskId={task._id as Id<'chatroom_tasks'>}
          content={task.content}
        />
      ))}
      {message.attachedBacklogItems?.map((item) => (
        <AttachedBacklogItemChip
          key={item.id}
          mode="view"
          itemId={item.id as Id<'chatroom_backlog'>}
          content={item.content}
        />
      ))}
      {message.attachedMessages?.map((msg) => (
        <AttachedMessageChip
          key={msg._id}
          mode="view"
          messageId={msg._id as Id<'chatroom_messages'>}
          content={msg.content}
          senderRole={msg.senderRole}
        />
      ))}
      {message.attachedSnippets?.map((s) => (
        <AttachedSnippetChip
          key={s.reference}
          mode="view"
          reference={s.reference}
          fileSource={s.fileSource}
          selectedContent={s.selectedContent}
        />
      ))}
    </div>
  );
}
