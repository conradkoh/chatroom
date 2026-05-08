'use client';

import { ArrowUp, Trash2 } from 'lucide-react';
import React, { memo, useCallback, useEffect, useState } from 'react';

import type { Message } from '../../types/message';
import { QueuedMessageDetailModal } from './QueuedMessageDetailModal';

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
  message: Message;
  onPromote: (queuedMessageId: string) => Promise<void>;
  onDelete: (queuedMessageId: string) => Promise<void>;
}

/**
 * Sidebar row for a queued chatroom message. Clicking the row opens a detail
 * modal (see `QueuedMessageDetailModal`) that mirrors the layout used by
 * `BacklogItemDetailModal` and `TaskDetailModal`.
 */
export const QueuedMessageItem = memo(function QueuedMessageItem({
  message,
  onPromote,
  onDelete,
}: QueuedMessageItemProps) {
  const elapsed = useElapsedTime(message._creationTime);
  const [isPromoting, setIsPromoting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const openModal = useCallback(() => {
    setIsModalOpen(true);
  }, []);

  const closeModal = useCallback(() => {
    setIsModalOpen(false);
  }, []);

  const handleRowPromote = useCallback(async () => {
    if (isPromoting || isDeleting) return;
    setIsPromoting(true);
    try {
      await onPromote(message._id);
    } finally {
      setIsPromoting(false);
    }
  }, [message._id, onPromote, isPromoting, isDeleting]);

  const handleRowDelete = useCallback(async () => {
    if (isDeleting || isPromoting) return;
    setIsDeleting(true);
    try {
      await onDelete(message._id);
    } finally {
      setIsDeleting(false);
    }
  }, [message._id, onDelete, isDeleting, isPromoting]);

  /** Stop the surrounding row click from firing when an action button is pressed. */
  const stopRowClick = useCallback((e: React.MouseEvent) => e.stopPropagation(), []);

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
          <p className="text-xs text-foreground line-clamp-2 break-words">{message.content}</p>
          <p className="text-[10px] text-muted-foreground mt-0.5">{elapsed}</p>
        </div>

        {/* Inline quick actions — always visible. */}
        <div className="flex items-center gap-1" onClick={stopRowClick}>
          <button
            type="button"
            onClick={handleRowPromote}
            disabled={isPromoting || isDeleting}
            className="p-1.5 rounded hover:bg-green-100 dark:hover:bg-green-900/30 text-green-600 dark:text-green-400 disabled:opacity-50"
            title="Promote to active"
          >
            <ArrowUp size={14} />
          </button>
          <button
            type="button"
            onClick={handleRowDelete}
            disabled={isDeleting || isPromoting}
            className="p-1.5 rounded hover:bg-red-100 dark:hover:bg-red-900/30 text-red-600 dark:text-red-400 disabled:opacity-50"
            title="Delete"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      <QueuedMessageDetailModal
        message={message}
        isOpen={isModalOpen}
        onClose={closeModal}
        onPromote={onPromote}
        onDelete={onDelete}
      />
    </>
  );
});
