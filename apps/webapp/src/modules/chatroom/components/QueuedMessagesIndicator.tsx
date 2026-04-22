'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionMutation, useSessionQuery } from 'convex-helpers/react/sessions';
import { Timer } from 'lucide-react';
import React, { memo, useCallback, useState } from 'react';

import type { Message } from '../types/message';
import { QueuedMessageDetailModal } from './WorkQueue/QueuedMessageDetailModal';

// ─── Props ────────────────────────────────────────────────────────────────────

interface QueuedMessagesIndicatorProps {
  chatroomId: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Lightweight single-line indicator shown directly above the chat input when
 * there are queued messages waiting to be sent.
 *
 * Design:
 * - ~24-28 px tall — a thin strip, not a full card.
 * - Minimum 36 px touch target on mobile (`min-h-9`).
 * - Shows the LAST (most recently queued) message truncated to one line.
 * - Shows `(+N more)` badge when more than one message is queued.
 * - Clicking opens the `QueuedMessageDetailModal` for the last message.
 * - Returns `null` when there are zero queued messages — no visual at all.
 */
export const QueuedMessagesIndicator = memo(function QueuedMessagesIndicator({
  chatroomId,
}: QueuedMessagesIndicatorProps) {
  const queuedMessagesRaw = useSessionQuery(api.messages.listQueued, {
    chatroomId: chatroomId as Id<'chatroom_rooms'>,
  });
  const queuedMessages = (queuedMessagesRaw ?? []) as Message[];

  const [isModalOpen, setIsModalOpen] = useState(false);

  const promoteSpecificTask = useSessionMutation(api.tasks.promoteSpecificTask);
  const deleteQueuedMessage = useSessionMutation(api.messages.deleteQueuedMessage);

  const handlePromote = useCallback(
    async (queuedMessageId: string) => {
      try {
        await promoteSpecificTask({
          queuedMessageId: queuedMessageId as Id<'chatroom_messageQueue'>,
        });
      } catch (error) {
        console.error('Failed to promote queued message:', error);
      }
    },
    [promoteSpecificTask]
  );

  const handleDelete = useCallback(
    async (queuedMessageId: string) => {
      try {
        await deleteQueuedMessage({
          queuedMessageId: queuedMessageId as Id<'chatroom_messageQueue'>,
        });
      } catch (error) {
        console.error('Failed to delete queued message:', error);
      }
    },
    [deleteQueuedMessage]
  );

  // Return null when there are no queued messages — no indicator shown.
  if (queuedMessages.length === 0) return null;

  // listQueued returns ascending order — last item is the most recently queued.
  const lastMessage = queuedMessages[queuedMessages.length - 1]!;
  const extraCount = queuedMessages.length - 1;

  return (
    <>
      <div
        role="button"
        tabIndex={0}
        aria-label={`${queuedMessages.length} queued message${queuedMessages.length > 1 ? 's' : ''} — click to view`}
        onClick={() => setIsModalOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setIsModalOpen(true);
          }
        }}
        className="flex items-center gap-2 min-h-9 px-3 py-1.5 bg-orange-500/5 border-b border-orange-500/15 cursor-pointer hover:bg-orange-500/10 transition-colors"
      >
        {/* Icon */}
        <Timer size={12} className="text-orange-500 flex-shrink-0" />

        {/* Label */}
        <span className="text-[10px] font-bold uppercase tracking-wide text-orange-600 dark:text-orange-400 flex-shrink-0">
          Queued
        </span>

        {/* Last message content — truncated to 1 line */}
        <span className="text-xs text-chatroom-text-muted line-clamp-1 min-w-0 flex-1">
          {lastMessage.content}
        </span>

        {/* "+N more" badge */}
        {extraCount > 0 && (
          <span className="text-[10px] text-orange-600 dark:text-orange-400 flex-shrink-0 tabular-nums">
            (+{extraCount} more)
          </span>
        )}
      </div>

      {/* Detail modal for the last queued message */}
      <QueuedMessageDetailModal
        message={lastMessage}
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onPromote={handlePromote}
        onDelete={handleDelete}
      />
    </>
  );
});
