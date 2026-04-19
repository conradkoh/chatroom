'use client';

import { AlertTriangle, ArrowUp, Trash2 } from 'lucide-react';
import React, { memo, useCallback, useState, useEffect } from 'react';

import { useTwoTapConfirm } from '../../hooks/useTwoTapConfirm';
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
  message: Message;
  onPromote: (queuedMessageId: string) => Promise<void>;
  onDelete: (queuedMessageId: string) => Promise<void>;
  /** Optional click handler for the row itself (opens detail view). */
  onClickRow?: () => void;
}

export const QueuedMessageItem = memo(function QueuedMessageItem({
  message,
  onPromote,
  onDelete,
  onClickRow,
}: QueuedMessageItemProps) {
  const elapsed = useElapsedTime(message._creationTime);
  const [isPromoting, setIsPromoting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const handlePromote = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation();
      if (isPromoting || isDeleting) return;
      setIsPromoting(true);
      try {
        await onPromote(message._id);
      } finally {
        setIsPromoting(false);
      }
    },
    [message._id, onPromote, isPromoting, isDeleting]
  );

  const { armedKey: deleteArmed, request: requestDelete } = useTwoTapConfirm<string>(
    async (id) => {
      if (isDeleting || isPromoting) return;
      setIsDeleting(true);
      try {
        await onDelete(id);
      } finally {
        setIsDeleting(false);
      }
    }
  );

  const handleDelete = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      requestDelete(message._id);
    },
    [message._id, requestDelete]
  );

  const isDeleteArmed = deleteArmed === message._id;

  return (
    <div
      className={`flex items-center gap-2 px-3 py-2 hover:bg-accent/50 transition-colors group ${onClickRow ? 'cursor-pointer' : ''}`}
      onClick={onClickRow}
    >
      {/* Content - truncate to 2 lines */}
      <div className="flex-1 min-w-0">
        <p className="text-xs text-foreground line-clamp-2 break-words">{message.content}</p>
        <p className="text-[10px] text-muted-foreground mt-0.5">{elapsed}</p>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={handlePromote}
          disabled={isPromoting || isDeleting}
          className="p-1.5 rounded hover:bg-green-100 dark:hover:bg-green-900/30 text-green-600 dark:text-green-400 disabled:opacity-50"
          title="Promote to active"
        >
          <ArrowUp size={14} />
        </button>
        <button
          onClick={handleDelete}
          disabled={isDeleting || isPromoting}
          aria-label={isDeleteArmed ? 'Confirm delete' : 'Delete'}
          className={`p-1.5 rounded transition-colors disabled:opacity-50 ${
            isDeleteArmed
              ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300'
              : 'hover:bg-red-100 dark:hover:bg-red-900/30 text-red-600 dark:text-red-400'
          }`}
          title={isDeleteArmed ? 'Tap again to confirm delete' : 'Delete'}
        >
          {isDeleteArmed ? <AlertTriangle size={14} /> : <Trash2 size={14} />}
        </button>
      </div>
    </div>
  );
});
