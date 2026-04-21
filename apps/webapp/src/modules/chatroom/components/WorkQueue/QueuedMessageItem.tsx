'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionMutation } from 'convex-helpers/react/sessions';
import { ArrowUp, Check, MoreHorizontal, Pencil, Timer, Trash2, X } from 'lucide-react';
import React, { memo, useCallback, useEffect, useState } from 'react';
import Markdown from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';

import type { Message } from '../../types/message';
import { baseMarkdownComponents, messageFeedProseClassNames } from '../markdown-utils';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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

/**
 * Sidebar row for a queued chatroom message. Clicking the row opens a detail
 * modal that mirrors the layout used by `BacklogItemDetailModal` and
 * `TaskDetailModal`: header / body / footer, an Actions dropdown for
 * secondary actions, and an Edit/Preview tabbed editor when editing.
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
  const [isEditing, setIsEditing] = useState(false);
  const [editedContent, setEditedContent] = useState(message.content);
  const [activeTab, setActiveTab] = useState<'edit' | 'preview'>('edit');
  const [isSaving, setIsSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const updateQueuedMessage = useSessionMutation(api.messages.updateQueuedMessage);

  const formattedTime = new Date(message._creationTime).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

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

  const openModal = useCallback(() => {
    setEditedContent(message.content);
    setActiveTab('edit');
    setIsEditing(false);
    setEditError(null);
    setIsModalOpen(true);
  }, [message.content]);

  const closeModal = useCallback(() => {
    setIsModalOpen(false);
    setIsEditing(false);
    setEditError(null);
  }, []);

  const enterEdit = useCallback(() => {
    setEditedContent(message.content);
    setActiveTab('edit');
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
      // No-op save — just exit edit mode without hitting the backend.
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

  /** Close-from-chrome (Escape, header X, backdrop): exit edit first, then close. */
  const dismissFromChrome = useCallback(() => {
    if (isEditing) {
      cancelEdit();
      return;
    }
    closeModal();
  }, [isEditing, cancelEdit, closeModal]);

  /** Run a footer mutation, close the modal on success. Mirrors BacklogItemDetailModal. */
  const handleModalMutation = useCallback(
    async (fn: () => Promise<unknown>) => {
      setIsSaving(true);
      try {
        await fn();
        closeModal();
      } catch (err) {
        setEditError(err instanceof Error ? err.message : 'Action failed.');
      } finally {
        setIsSaving(false);
      }
    },
    [closeModal]
  );

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
        className="flex items-center gap-2 px-3 py-2 hover:bg-accent/50 transition-colors group cursor-pointer text-left w-full"
      >
        <div className="flex-1 min-w-0">
          <p className="text-xs text-foreground line-clamp-2 break-words">{message.content}</p>
          <p className="text-[10px] text-muted-foreground mt-0.5">{elapsed}</p>
        </div>

        {/* Inline quick actions — duplicated in the modal footer for consistency. */}
        <div
          className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={stopRowClick}
        >
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

      {/* Detail modal — header / body / footer pattern matching BacklogItemDetailModal. */}
      <FixedModal
        isOpen={isModalOpen}
        onClose={dismissFromChrome}
        maxWidth="max-w-2xl"
        closeOnBackdrop={!isEditing}
      >
        <FixedModalContent>
          <FixedModalHeader onClose={dismissFromChrome}>
            <div className="flex items-center gap-2">
              <Timer size={16} className="text-orange-500" />
              <FixedModalTitle>Queued Message</FixedModalTitle>
              <span className="px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide bg-orange-500/20 text-orange-600 dark:text-orange-400">
                Queued
              </span>
              <span className="text-[10px] text-chatroom-text-muted tabular-nums">
                {formattedTime} • {elapsed}
              </span>
            </div>
          </FixedModalHeader>

          <FixedModalBody>
            {isEditing ? (
              // Tab-based editor with Edit/Preview tabs (matches BacklogItemDetailModal).
              <div className="flex flex-col h-full">
                <div className="flex border-b-2 border-chatroom-border-strong bg-chatroom-bg-tertiary flex-shrink-0">
                  <button
                    type="button"
                    onClick={() => setActiveTab('edit')}
                    className={`px-4 py-2 text-[10px] font-bold uppercase tracking-widest transition-colors border-b-2 -mb-[2px] ${
                      activeTab === 'edit'
                        ? 'border-chatroom-accent text-chatroom-text-primary bg-chatroom-bg-primary'
                        : 'border-transparent text-chatroom-text-muted hover:text-chatroom-text-secondary'
                    }`}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab('preview')}
                    className={`px-4 py-2 text-[10px] font-bold uppercase tracking-widest transition-colors border-b-2 -mb-[2px] ${
                      activeTab === 'preview'
                        ? 'border-chatroom-accent text-chatroom-text-primary bg-chatroom-bg-primary'
                        : 'border-transparent text-chatroom-text-muted hover:text-chatroom-text-secondary'
                    }`}
                  >
                    Preview
                  </button>
                </div>

                <div className="flex-1 flex flex-col overflow-hidden min-h-[260px]">
                  {activeTab === 'edit' ? (
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
                      placeholder="Write your markdown here..."
                      className="flex-1 w-full bg-chatroom-bg-primary border-0 text-chatroom-text-primary text-sm p-4 resize-none focus:outline-none font-mono"
                    />
                  ) : (
                    <div className={`h-full overflow-y-auto p-4 ${messageFeedProseClassNames}`}>
                      <Markdown
                        remarkPlugins={[remarkGfm, remarkBreaks]}
                        components={baseMarkdownComponents}
                      >
                        {editedContent || '*No content yet*'}
                      </Markdown>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className={`p-4 ${messageFeedProseClassNames}`}>
                <Markdown
                  remarkPlugins={[remarkGfm, remarkBreaks]}
                  components={baseMarkdownComponents}
                >
                  {message.content}
                </Markdown>
              </div>
            )}
          </FixedModalBody>

          {/* Inline error — matches the bordered strip used by TaskDetailModal. */}
          {editError && (
            <div className="px-4 py-2 bg-chatroom-status-error/10 border-t-2 border-chatroom-status-error/30 flex-shrink-0">
              <p className="text-xs text-chatroom-status-error">{editError}</p>
            </div>
          )}

          {/* Footer — primary action + Actions dropdown (matches BacklogItemDetailModal). */}
          <div className="border-t-2 border-chatroom-border-strong bg-chatroom-bg-surface flex items-center gap-2 p-4 flex-shrink-0">
            {isEditing ? (
              <>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={isSaving || !editedContent.trim()}
                  className="flex items-center gap-1 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide border-2 border-transparent bg-chatroom-accent text-chatroom-bg-primary transition-all duration-100 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Check size={12} />
                  {isSaving ? 'Saving...' : 'Save'}
                </button>
                <button
                  type="button"
                  onClick={cancelEdit}
                  disabled={isSaving}
                  className="flex items-center gap-1 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide border-2 border-chatroom-border text-chatroom-text-secondary hover:bg-chatroom-bg-hover hover:border-chatroom-border-strong hover:text-chatroom-text-primary transition-all duration-100 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <X size={12} />
                  Cancel
                </button>
                <span className="ml-auto text-[10px] text-chatroom-text-muted">
                  ⌘ + Enter to save
                </span>
              </>
            ) : (
              <>
                {/* Primary action: Promote to active (matches the row's quick-action). */}
                <button
                  type="button"
                  onClick={() => handleModalMutation(() => onPromote(message._id))}
                  disabled={isSaving}
                  className="flex items-center gap-1 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide border-2 border-transparent bg-chatroom-accent text-chatroom-bg-primary transition-all duration-100 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <ArrowUp size={12} />
                  {isSaving ? 'Working...' : 'Promote'}
                </button>

                <div className="flex-1" />

                <DropdownMenu modal={false}>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      disabled={isSaving}
                      className="flex items-center gap-1 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide border-2 border-chatroom-border text-chatroom-text-secondary hover:bg-chatroom-bg-hover hover:border-chatroom-border-strong hover:text-chatroom-text-primary transition-all duration-100 disabled:opacity-50 disabled:cursor-not-allowed"
                      title="More actions"
                    >
                      <MoreHorizontal size={14} />
                      Actions
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="min-w-[160px]">
                    <DropdownMenuItem
                      onClick={enterEdit}
                      className="flex items-center gap-2 cursor-pointer"
                    >
                      <Pencil size={14} />
                      Edit
                    </DropdownMenuItem>

                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={() => handleModalMutation(() => onDelete(message._id))}
                      className="flex items-center gap-2 cursor-pointer text-chatroom-status-error focus:text-chatroom-status-error"
                    >
                      <Trash2 size={14} />
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            )}
          </div>
        </FixedModalContent>
      </FixedModal>
    </>
  );
});
