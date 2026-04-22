'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionMutation } from 'convex-helpers/react/sessions';
import { ArrowUp, Check, MoreHorizontal, Pencil, Timer, Trash2, X } from 'lucide-react';
import React, { memo, useCallback, useState } from 'react';
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

// ─── Props ────────────────────────────────────────────────────────────────────

interface QueuedMessageDetailModalProps {
  /** The queued message to display. */
  message: Message;
  /** Whether the modal is open. */
  isOpen: boolean;
  /** Called when the modal should close. */
  onClose: () => void;
  /** Called when the user promotes the message. */
  onPromote: (queuedMessageId: string) => Promise<void>;
  /** Called when the user deletes the message. */
  onDelete: (queuedMessageId: string) => Promise<void>;
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Detail modal for a queued chatroom message.
 *
 * Extracted from `QueuedMessageItem` so it can be reused by
 * `QueuedMessagesIndicator` without duplicating markup.
 *
 * Features:
 * - Markdown preview of the queued message content.
 * - Tabbed Edit/Preview editor for in-modal editing.
 * - Primary "Promote" action + secondary Actions dropdown (Edit, Delete).
 * - Error strip (mirrors `BacklogItemDetailModal` + `TaskDetailModal` patterns).
 */
export const QueuedMessageDetailModal = memo(function QueuedMessageDetailModal({
  message,
  isOpen,
  onClose,
  onPromote,
  onDelete,
}: QueuedMessageDetailModalProps) {
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

  /** Close-from-chrome: exit edit first, then close. */
  const dismissFromChrome = useCallback(() => {
    if (isEditing) {
      cancelEdit();
      return;
    }
    onClose();
  }, [isEditing, cancelEdit, onClose]);

  /** Run a footer mutation, close on success. */
  const handleModalMutation = useCallback(
    async (fn: () => Promise<unknown>) => {
      setIsSaving(true);
      try {
        await fn();
        onClose();
      } catch (err) {
        setEditError(err instanceof Error ? err.message : 'Action failed.');
      } finally {
        setIsSaving(false);
      }
    },
    [onClose]
  );

  return (
    <FixedModal
      isOpen={isOpen}
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
              {formattedTime}
            </span>
          </div>
        </FixedModalHeader>

        <FixedModalBody>
          {isEditing ? (
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

        {editError && (
          <div className="px-4 py-2 bg-chatroom-status-error/10 border-t-2 border-chatroom-status-error/30 flex-shrink-0">
            <p className="text-xs text-chatroom-status-error">{editError}</p>
          </div>
        )}

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
  );
});
