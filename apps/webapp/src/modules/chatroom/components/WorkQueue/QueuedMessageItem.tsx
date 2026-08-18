'use client';

import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { Trash2 } from 'lucide-react';
import React, { memo, useCallback, useEffect, useState } from 'react';

import { QueuedMessageDetailModal } from './QueuedMessageDetailModal';
import { QueuedMessageEnhancerToggle } from './QueuedMessageEnhancerToggle';
import { QueuedMessageNewSessionToggle } from './QueuedMessageNewSessionToggle';
import { WorkQueuePreviewText } from './WorkQueuePreviewText';
import { MessageAttachmentChips } from '../../attachments';
import type { Message } from '../../types/message';

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
  teamSupportsEnhancer?: boolean;
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
  teamSupportsEnhancer,
}: QueuedMessageItemProps) {
  const elapsed = useElapsedTime(message._creationTime);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const openModal = useCallback(() => {
    setIsModalOpen(true);
  }, []);

  const closeModal = useCallback(() => {
    setIsModalOpen(false);
  }, []);

  const handleRowDelete = useCallback(async () => {
    if (isDeleting) return;
    setIsDeleting(true);
    try {
      await onDelete(message._id);
    } finally {
      setIsDeleting(false);
    }
  }, [message._id, onDelete, isDeleting]);

  /** Stop the surrounding row click from firing when an action button is pressed. */
  const stopRowClick = useCallback((e: React.MouseEvent) => e.stopPropagation(), []);

  const hasAttachments =
    (message.attachedTasks?.length ?? 0) > 0 ||
    (message.attachedBacklogItems?.length ?? 0) > 0 ||
    (message.attachedMessages?.length ?? 0) > 0 ||
    (message.attachedSnippets?.length ?? 0) > 0;

  return (
    <>
      <div
        role="button"
        tabIndex={0}
        onClick={openModal}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            openModal();
          }
        }}
        className="flex items-center gap-2 px-3 py-2 hover:bg-accent/50 transition-colors cursor-pointer text-left w-full"
      >
        <div className="flex-1 min-w-0">
          <WorkQueuePreviewText content={message.content} />
          <p className="text-[10px] text-muted-foreground mt-0.5">{elapsed}</p>
          {/* Attachment chip strip — stopPropagation so clicks open chip preview, not the row modal */}
          {hasAttachments && (
            <div className="flex flex-wrap gap-1.5 mt-1" onClick={stopRowClick}>
              <MessageAttachmentChips message={message} />
            </div>
          )}
        </div>

        {/* Inline quick actions — always visible. */}
        <div className="flex items-center gap-1" onClick={stopRowClick}>
          <QueuedMessageNewSessionToggle
            queuedMessageId={message._id}
            startInNewSession={message.startInNewSession ?? false}
          />
          {teamSupportsEnhancer ? (
            <QueuedMessageEnhancerToggle
              queuedMessageId={message._id}
              plannerEnhancerEnabled={message.plannerEnhancerEnabled ?? false}
            />
          ) : null}
          <button
            type="button"
            onClick={handleRowDelete}
            disabled={isDeleting}
            className="p-1.5 rounded hover:bg-red-100 dark:hover:bg-red-900/30 text-red-600 dark:text-red-400 disabled:opacity-50"
            title="Delete"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      <QueuedMessageDetailModal
        chatroomId={chatroomId}
        message={message}
        isOpen={isModalOpen}
        onClose={closeModal}
        onDelete={onDelete}
        teamSupportsEnhancer={teamSupportsEnhancer}
      />
    </>
  );
});
