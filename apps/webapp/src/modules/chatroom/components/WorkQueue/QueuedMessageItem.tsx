'use client';

import { ArrowUp, Timer, Trash2 } from 'lucide-react';
import React, { memo, useCallback, useState, useEffect } from 'react';
import Markdown from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';

import type { Message } from '../../types/message';
import { baseMarkdownComponents, messageFeedProseClassNames } from '../markdown-utils';

import {
  FixedModal,
  FixedModalBody,
  FixedModalContent,
  FixedModalHeader,
  FixedModalTitle,
} from '@/components/ui/fixed-modal';


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

export const QueuedMessageItem = memo(function QueuedMessageItem({
  message,
  onPromote,
  onDelete,
}: QueuedMessageItemProps) {
  const elapsed = useElapsedTime(message._creationTime);
  const [isPromoting, setIsPromoting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const formattedTime = new Date(message._creationTime).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

  const handlePromote = useCallback(async () => {
    if (isPromoting || isDeleting) return;
    setIsPromoting(true);
    try {
      await onPromote(message._id);
    } finally {
      setIsPromoting(false);
    }
  }, [message._id, onPromote, isPromoting, isDeleting]);

  const handleDelete = useCallback(async () => {
    if (isDeleting || isPromoting) return;
    setIsDeleting(true);
    try {
      await onDelete(message._id);
    } finally {
      setIsDeleting(false);
    }
  }, [message._id, onDelete, isDeleting, isPromoting]);

  const openModal = useCallback(() => setIsModalOpen(true), []);
  const closeModal = useCallback(() => setIsModalOpen(false), []);

  /** Stop the surrounding row click from firing when an action button is pressed. */
  const stop = useCallback((e: React.MouseEvent) => e.stopPropagation(), []);

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
        className="flex items-center gap-2 px-3 py-2 hover:bg-accent/50 transition-colors group cursor-pointer text-left w-full"
      >
        {/* Content - truncate to 2 lines */}
        <div className="flex-1 min-w-0">
          <p className="text-xs text-foreground line-clamp-2 break-words">{message.content}</p>
          <p className="text-[10px] text-muted-foreground mt-0.5">{elapsed}</p>
        </div>

        {/* Actions */}
        <div
          className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={stop}
        >
          <button
            type="button"
            onClick={handlePromote}
            disabled={isPromoting || isDeleting}
            className="p-1.5 rounded hover:bg-green-100 dark:hover:bg-green-900/30 text-green-600 dark:text-green-400 disabled:opacity-50"
            title="Promote to active"
          >
            <ArrowUp size={14} />
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={isDeleting || isPromoting}
            className="p-1.5 rounded hover:bg-red-100 dark:hover:bg-red-900/30 text-red-600 dark:text-red-400 disabled:opacity-50"
            title="Delete"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {/* Full-content modal — opens when the row is clicked. */}
      <FixedModal isOpen={isModalOpen} onClose={closeModal} maxWidth="max-w-2xl">
        <FixedModalContent>
          <FixedModalHeader onClose={closeModal}>
            <FixedModalTitle>
              <span className="flex items-center gap-2">
                <Timer size={14} className="text-orange-500" />
                Queued Message
              </span>
            </FixedModalTitle>
          </FixedModalHeader>
          <FixedModalBody>
            <div className="p-6 space-y-4">
              <div className="flex items-center gap-3 text-[10px] uppercase tracking-wide text-muted-foreground">
                <span>{formattedTime}</span>
                <span aria-hidden>•</span>
                <span>{elapsed} ago</span>
              </div>
              <div className={messageFeedProseClassNames}>
                <Markdown
                  remarkPlugins={[remarkGfm, remarkBreaks]}
                  components={baseMarkdownComponents}
                >
                  {message.content}
                </Markdown>
              </div>
            </div>
          </FixedModalBody>
        </FixedModalContent>
      </FixedModal>
    </>
  );
});
