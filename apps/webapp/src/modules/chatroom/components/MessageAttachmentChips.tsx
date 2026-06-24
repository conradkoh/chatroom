import type { Id } from '@workspace/backend/convex/_generated/dataModel';

import { AttachedBacklogItemChip } from './AttachedBacklogItemChip';
import { AttachedMessageChip } from './AttachedMessageChip';
import { AttachedTaskChip } from './AttachedTaskChip';
import type { Message } from '../types/message';

interface MessageAttachmentChipsProps {
  message: Message;
}

/**
 * Shared read-only chip strip used by both the queued-message row
 * (`QueuedMessageItem`) and the queued-message detail modal
 * (`QueuedMessageDetailModal`).
 *
 * Renders attachment kinds (tasks → backlog items → messages) in a single flat
 * row. Returns `null` when there are no attachments.
 *
 * Callers are responsible for wrapping this component with their own header
 * text, top-border, margin, and event-stopping containers.
 */
export function MessageAttachmentChips({ message }: MessageAttachmentChipsProps) {
  const taskCount = message.attachedTasks?.length ?? 0;
  const backlogCount = message.attachedBacklogItems?.length ?? 0;
  const messageCount = message.attachedMessages?.length ?? 0;

  if (taskCount + backlogCount + messageCount === 0) return null;

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
    </div>
  );
}
