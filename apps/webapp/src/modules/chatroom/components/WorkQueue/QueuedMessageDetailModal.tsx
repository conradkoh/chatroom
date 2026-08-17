'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionMutation } from 'convex-helpers/react/sessions';
import { Check, MoreHorizontal, Pencil, Timer, Trash2, X } from 'lucide-react';
import React, { memo, useCallback, useEffect, useState } from 'react';
import Markdown from 'react-markdown';

import { QueuedMessageEnhancerToggle } from './QueuedMessageEnhancerToggle';
import { MessageAttachmentChips, countMessageAttachments } from '../../attachments';
import type { Message } from '../../types/message';
import { chatroomRemarkPlugins } from '../chatroomRemarkPlugins';
import {
  DetailModalMarkdownSurface,
  detailModalRichTextEditorProseClassNames,
} from '../detail-modal';
import { RichTextEditor, isInteractiveClickTarget } from '../detail-modal-shared';
import { modalMarkdownComponents } from '../markdown-utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';

import { reserializeMarkdownBlankLines } from '@/components/markdown-editor/utils/reserializeMarkdownBlankLines';
import {
  FixedModal,
  FixedModalBody,
  FixedModalContent,
  FixedModalHeader,
  FixedModalTitle,
} from '@/components/ui/fixed-modal';

// ─── Props ────────────────────────────────────────────────────────────────────

interface QueuedMessageDetailModalProps {
  /** The chatroom ID (needed by AttachedWorkflowChip). */
  chatroomId: Id<'chatroom_rooms'>;
  /** The queued message to display. */
  message: Message;
  /** Whether the modal is open. */
  isOpen: boolean;
  /** Called when the modal should close. */
  onClose: () => void;
  /** Called when the user promotes the message. */
  /** Called when the user deletes the message. */
  onDelete: (queuedMessageId: string) => Promise<void>;
  teamSupportsEnhancer?: boolean;
}

// ─── Component ────────────────────────────────────────────────────────────────

/** Inline helper: renders "Attachments (N)" header + the shared chip strip. */
function QueuedMessageAttachmentsSection({ message }: { message: Message }) {
  const totalCount = countMessageAttachments(message);
  if (totalCount === 0) return null;

  return (
    <div className="mt-3 pt-3 border-t border-chatroom-border">
      <div className="text-[10px] font-bold uppercase tracking-wide text-chatroom-text-muted mb-2">
        Attachments ({totalCount})
      </div>
      <MessageAttachmentChips message={message} />
    </div>
  );
}

/**
 * Detail modal for a queued chatroom message.
 *
 * Extracted from `QueuedMessageItem` so it can be reused by
 * `QueuedMessagesIndicator` without duplicating markup.
 *
 * Features:
 * - Markdown preview of the queued message content.
 * - Click-to-edit WYSIWYG markdown editor.
 * - Primary "Promote" action + secondary Actions dropdown (Edit, Delete).
 * - Error strip (mirrors `BacklogItemDetailModal` + `TaskDetailModal` patterns).
 */
export const QueuedMessageDetailModal = memo(function QueuedMessageDetailModal({
  chatroomId: _chatroomId,
  message,
  isOpen,
  onClose,
  onDelete,
  teamSupportsEnhancer,
}: QueuedMessageDetailModalProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editedContent, setEditedContent] = useState(message.content);
  const [initialClickCoords, setInitialClickCoords] = useState<{
    left: number;
    top: number;
  } | null>(null);
  const [initializedMessageId, setInitializedMessageId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const updateUserMessageOrTask = useSessionMutation(api.messages.updateUserMessageOrTask);

  useEffect(() => {
    if (isOpen && message._id !== initializedMessageId) {
      setEditedContent(message.content);
      setIsEditing(false);
      setInitialClickCoords(null);
      setEditError(null);
      setInitializedMessageId(message._id);
    } else if (!isOpen) {
      setInitializedMessageId(null);
      setInitialClickCoords(null);
    }
  }, [isOpen, message._id, message.content, initializedMessageId]);

  const formattedTime = new Date(message._creationTime).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

  const enterEdit = useCallback(
    (coords?: { left: number; top: number } | null) => {
      setEditedContent(message.content);
      setEditError(null);
      setInitialClickCoords(coords ?? null);
      setIsEditing(true);
    },
    [message.content]
  );

  const cancelEdit = useCallback(() => {
    setEditedContent(message.content);
    setEditError(null);
    setInitialClickCoords(null);
    setIsEditing(false);
  }, [message.content]);

  const handleSave = useCallback(async () => {
    const trimmed = reserializeMarkdownBlankLines(editedContent).trim();
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
      await updateUserMessageOrTask({
        type: 'message',
        messageId: message._id as Id<'chatroom_messageQueue'>,
        content: reserializeMarkdownBlankLines(editedContent),
      });
      setIsEditing(false);
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Failed to update queued message.');
    } finally {
      setIsSaving(false);
    }
  }, [editedContent, message.content, message._id, updateUserMessageOrTask]);

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

        <FixedModalBody className="flex flex-col min-h-0 p-0">
          {isEditing ? (
            <RichTextEditor
              value={editedContent}
              onChange={setEditedContent}
              placeholder="Write your markdown here..."
              onCmdEnter={handleSave}
              initialClickCoords={initialClickCoords}
              className="flex-1 flex flex-col min-h-0"
              proseClassName={detailModalRichTextEditorProseClassNames}
            />
          ) : (
            <DetailModalMarkdownSurface
              data-testid="queued-detail-view-body"
              interactive
              onClick={(e) => {
                if (isInteractiveClickTarget(e.target)) return;
                enterEdit({ left: e.clientX, top: e.clientY });
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  enterEdit(null);
                }
              }}
              role="button"
              tabIndex={0}
              proseClassName={detailModalRichTextEditorProseClassNames}
            >
              <Markdown remarkPlugins={chatroomRemarkPlugins} components={modalMarkdownComponents}>
                {message.content}
              </Markdown>
              <QueuedMessageAttachmentsSection message={message} />
            </DetailModalMarkdownSurface>
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
            </>
          ) : (
            <>
              {teamSupportsEnhancer ? (
                <QueuedMessageEnhancerToggle
                  queuedMessageId={message._id}
                  plannerEnhancerEnabled={message.plannerEnhancerEnabled ?? false}
                />
              ) : null}

              <div className="flex-1" />

              <DropdownMenu modal={false}>
                <DropdownMenuTrigger
                  type="button"
                  disabled={isSaving}
                  className="flex items-center gap-1 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide border-2 border-chatroom-border text-chatroom-text-secondary hover:bg-chatroom-bg-hover hover:border-chatroom-border-strong hover:text-chatroom-text-primary transition-all duration-100 disabled:opacity-50 disabled:cursor-not-allowed"
                  title="More actions"
                >
                  <MoreHorizontal size={14} />
                  Actions
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-[160px]">
                  <DropdownMenuItem
                    onClick={() => enterEdit(null)}
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
