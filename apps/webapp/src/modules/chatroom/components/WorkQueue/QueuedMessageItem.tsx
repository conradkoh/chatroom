'use client';

import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import React, { memo, useCallback, useEffect, useState } from 'react';

import { QueuedMessageDetailModal } from './QueuedMessageDetailModal';
import { WorkQueuePreviewText } from './WorkQueuePreviewText';
import { MessageAttachmentChips } from '../../attachments';
import type { Message } from '../../types/message';
import { QueuedMessageEnvelopeControls } from '../QueuedMessageEnvelopeControls';
import { WorkQueueDeleteButton } from '../shared/WorkQueueDeleteButton';
import { WorkQueueRow } from '../shared/WorkQueueRow';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Returns a human-readable elapsed time string that updates every second. */
function useElapsedTime(creationTime: number): string {
  const [elapsed, setElapsed] = useState(() => formatElapsed(creationTime));

  useEffect(() => {
    const update = () => setElapsed(formatElapsed(creationTime));
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [creationTime]);

  return elapsed;
}

function formatElapsed(creationTime: number): string {
  const diffMs = Date.now() - creationTime;
  const totalSecs = Math.floor(diffMs / 1000);
  if (totalSecs < 60) return `${totalSecs}s`;
  const mins = Math.floor(totalSecs / 60);
  const secs = totalSecs % 60;
  if (mins < 60) return `${mins}m ${secs}s`;
  const hrs = Math.floor(mins / 60);
  const remainMins = mins % 60;
  return `${hrs}h ${remainMins}m`;
}

// ─── Component ────────────────────────────────────────────────────────────────

interface QueuedMessageItemProps {
  chatroomId: Id<'chatroom_rooms'>;
  message: Message;
  onDelete: (queuedMessageId: string) => Promise<void>;
}

/**
 * Sidebar row for a queued chatroom message. Clicking the row opens a detail
 * modal (see `QueuedMessageDetailModal`) that mirrors the layout used by
 * `BacklogItemDetailModal` and `TaskDetailModal`.
 */
export const QueuedMessageItem = memo(function QueuedMessageItem({
  chatroomId,
  message,
  onDelete,
}: QueuedMessageItemProps) {
  const elapsed = useElapsedTime(message._creationTime);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const openModal = useCallback(() => {
    setIsModalOpen(true);
  }, []);

  const closeModal = useCallback(() => {
    setIsModalOpen(false);
  }, []);

  const handleRowDelete = useCallback(() => onDelete(message._id), [message._id, onDelete]);

  const hasAttachments =
    (message.attachedTasks?.length ?? 0) > 0 ||
    (message.attachedBacklogItems?.length ?? 0) > 0 ||
    (message.attachedMessages?.length ?? 0) > 0 ||
    (message.attachedSnippets?.length ?? 0) > 0;

  return (
    <>
      <WorkQueueRow
        preview={<WorkQueuePreviewText content={message.content} />}
        meta={elapsed}
        attachments={hasAttachments ? <MessageAttachmentChips message={message} /> : undefined}
        onOpen={openModal}
        actions={
          <>
            <QueuedMessageEnvelopeControls message={message} compact />
            <WorkQueueDeleteButton onDelete={handleRowDelete} />
          </>
        }
      />

      <QueuedMessageDetailModal
        chatroomId={chatroomId}
        message={message}
        isOpen={isModalOpen}
        onClose={closeModal}
        onDelete={onDelete}
      />
    </>
  );
});
