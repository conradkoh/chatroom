'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionMutation } from 'convex-helpers/react/sessions';
import { ArrowUp, Pencil, Save, Timer, Trash2, X } from 'lucide-react';
import React, { memo, useCallback, useEffect, useState } from 'react';
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
  const [isEditing, setIsEditing] = useState(false);
  const [editedContent, setEditedContent] = useState(message.content);
  const [isSaving, setIsSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const updateQueuedMessage = useSessionMutation(api.messages.updateQueuedMessage);

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

  const openModal = useCallback(() => {
    setEditedContent(message.content);
    setEditError(null);
    setIsEditing(false);
    setIsModalOpen(true);
  }, [message.content]);

  const closeModal = useCallback(() => {
    setIsModalOpen(false);
    setIsEditing(false);
    setEditError(null);
  }, []);

  const enterEdit = useCallback(() => {
    setEditedContent(message.content);
    setEditError(null);
    setIsEditing(true);
  }, [message.content]);

  const cancelEdit = useCallback(() => {
    setEditedContent(message.content);
    setEditError(null);
    setIsEditing(false);
  }, [message.content]);

  const handleSave = useCallback(async () => {
    const trimmed = editedContent.trim();
    if (!trimmed) {
      setEditError('Message cannot be empty.');
      return;
    }
    if (trimmed === message.content) {
      // No-op save — just exit edit mode.
      setIsEditing(false);
      return;
    }
    setIsSaving(true);
    setEditError(null);
    try {
      await updateQueuedMessage({
        queuedMessageId: message._id as Id<'chatroom_messageQueue'>,
        content: trimmed,
      });
      setIsEditing(false);
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Failed to update queued message.');
    } finally {
      setIsSaving(false);
    }
  }, [editedContent, message.content, message._id, updateQueuedMessage]);

  /** Backdrop / Escape: exit edit first, otherwise close the modal. */
  const dismissFromChrome = useCallback(() => {
    if (isEditing) {
      cancelEdit();
      return;
    }
    closeModal();
  }, [isEditing, cancelEdit, closeModal]);

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
      <FixedModal
        isOpen={isModalOpen}
        onClose={dismissFromChrome}
        maxWidth="max-w-2xl"
        closeOnBackdrop={!isEditing}
      >
        <FixedModalContent>
          <FixedModalHeader onClose={dismissFromChrome}>
            <div className="flex items-center justify-between gap-2 w-full">
              <FixedModalTitle>
                <span className="flex items-center gap-2">
                  <Timer size={14} className="text-orange-500" />
                  Queued Message
                </span>
              </FixedModalTitle>
              {!isEditing && (
                <button
                  type="button"
                  onClick={enterEdit}
                  className="flex items-center gap-1 px-2 py-1 text-[10px] font-bold uppercase tracking-wide border border-chatroom-border text-chatroom-text-secondary hover:bg-chatroom-bg-hover hover:text-chatroom-text-primary transition-colors"
                  title="Edit queued message"
                >
                  <Pencil size={12} />
                  Edit
                </button>
              )}
            </div>
          </FixedModalHeader>
          <FixedModalBody>
            <div className="p-6 space-y-4">
              <div className="flex items-center gap-3 text-[10px] uppercase tracking-wide text-muted-foreground">
                <span>{formattedTime}</span>
                <span aria-hidden>•</span>
                <span>{elapsed} ago</span>
              </div>

              {isEditing ? (
                <div className="space-y-3">
                  <textarea
                    value={editedContent}
                    onChange={(e) => setEditedContent(e.target.value)}
                    onKeyDown={(e) => {
                      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                        e.preventDefault();
                        if (editedContent.trim()) void handleSave();
                      }
                    }}
                    autoFocus
                    placeholder="Edit your queued message..."
                    className="w-full min-h-[200px] bg-chatroom-bg-tertiary border-2 border-chatroom-border focus:border-chatroom-accent text-chatroom-text-primary text-sm p-3 resize-y focus:outline-none font-mono"
                  />
                  {editError && (
                    <p className="text-xs text-chatroom-status-error">{editError}</p>
                  )}
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleSave}
                      disabled={isSaving || !editedContent.trim()}
                      className="flex items-center gap-1 px-3 py-2 text-[10px] font-bold uppercase tracking-wide bg-chatroom-accent text-chatroom-bg-primary hover:bg-chatroom-text-secondary disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      <Save size={12} />
                      {isSaving ? 'Saving...' : 'Save'}
                    </button>
                    <button
                      type="button"
                      onClick={cancelEdit}
                      disabled={isSaving}
                      className="flex items-center gap-1 px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-chatroom-text-muted hover:text-chatroom-text-primary transition-colors"
                    >
                      <X size={12} />
                      Cancel
                    </button>
                    <span className="ml-auto text-[10px] text-muted-foreground">⌘ + Enter to save</span>
                  </div>
                </div>
              ) : (
                <div className={messageFeedProseClassNames}>
                  <Markdown
                    remarkPlugins={[remarkGfm, remarkBreaks]}
                    components={baseMarkdownComponents}
                  >
                    {message.content}
                  </Markdown>
                </div>
              )}
            </div>
          </FixedModalBody>
        </FixedModalContent>
      </FixedModal>
    </>
  );
});
