'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import { useSessionMutation } from 'convex-helpers/react/sessions';
import {
  Check,
  CornerUpLeft,
  Paperclip,
  ListChecks,
  MoreHorizontal,
  Pencil,
  Trash2,
  X,
} from 'lucide-react';
import React, { useState, useCallback, useEffect } from 'react';
import Markdown from 'react-markdown';

import { type BacklogItem, getBacklogStatusBadge, getScoringBadge } from './backlog';
import { chatroomRemarkPlugins } from './chatroomRemarkPlugins';
import { RichTextEditor, isInteractiveClickTarget } from './detail-modal-shared';
import { modalMarkdownComponents } from './markdown-utils';
import {
  DetailModalMarkdownSurface,
  detailModalRichTextEditorProseClassNames,
} from './detail-modal';
import { useAttachments } from '../attachments';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from './ui/alert-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';

import {
  FixedModal,
  FixedModalContent,
  FixedModalHeader,
  FixedModalTitle,
  FixedModalBody,
} from '@/components/ui/fixed-modal';
import { reserializeMarkdownBlankLines } from '@/components/markdown-editor/utils/reserializeMarkdownBlankLines';

interface BacklogItemDetailModalProps {
  isOpen: boolean;
  item: BacklogItem | null;
  onClose: () => void;
}

/**
 * Modal for viewing and acting on a chatroom_backlog item.
 * Supports inline editing, lifecycle mutations, and attaching items to context.
 */
export function BacklogItemDetailModal({ isOpen, item, onClose }: BacklogItemDetailModalProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editedContent, setEditedContent] = useState('');
  const [initialClickCoords, setInitialClickCoords] = useState<{
    left: number;
    top: number;
  } | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  // Track which item we've initialized for — prevents resetting during edits
  const [initializedItemId, setInitializedItemId] = useState<string | null>(null);

  const { add, isAttached } = useAttachments();

  // Lifecycle mutations
  const markForReview = useSessionMutation(api.backlog.markBacklogItemForReview);
  const completeItem = useSessionMutation(api.backlog.completeBacklogItem);
  const sendBackForRework = useSessionMutation(api.backlog.sendBacklogItemBackForRework);
  const reopenItem = useSessionMutation(api.backlog.reopenBacklogItem);
  const closeItem = useSessionMutation(api.backlog.closeBacklogItem);
  const updateItem = useSessionMutation(api.backlog.updateBacklogItem);
  const deleteItem = useSessionMutation(api.backlog.deleteBacklogItem);

  // Reset state when modal opens with a different item
  useEffect(() => {
    if (isOpen && item && item._id !== initializedItemId) {
      setEditedContent(item.content);
      // Backlog items open read-only; click the content to edit.
      setIsEditing(false);
      setInitialClickCoords(null);
      setInitializedItemId(item._id);
    } else if (!isOpen) {
      setInitializedItemId(null);
      setInitialClickCoords(null);
    }
  }, [isOpen, item, initializedItemId]);

  /** Cancel an in-progress edit, restoring the source content. */
  const cancelEdit = useCallback(() => {
    if (item) setEditedContent(item.content);
    setIsEditing(false);
    setInitialClickCoords(null);
  }, [item]);

  /** Close-from-chrome: exit edit first (with reset), then close. */
  const dismissFromChrome = useCallback(() => {
    if (isEditing) {
      cancelEdit();
    } else {
      onClose();
    }
  }, [isEditing, cancelEdit, onClose]);

  const handleSave = useCallback(async () => {
    if (!item || !editedContent.trim()) return;
    setIsLoading(true);
    try {
      await updateItem({
        chatroomId: item.chatroomId,
        itemId: item._id,
        content: reserializeMarkdownBlankLines(editedContent),
      });
      setIsEditing(false);
      setInitialClickCoords(null);
    } catch (error) {
      console.error('Failed to save backlog item:', error);
    } finally {
      setIsLoading(false);
    }
  }, [item, editedContent, updateItem]);

  const enterEdit = useCallback((coords?: { left: number; top: number } | null) => {
    setInitialClickCoords(coords ?? null);
    setIsEditing(true);
  }, []);

  const handleMutation = async (fn: () => Promise<unknown>) => {
    setIsLoading(true);
    try {
      await fn();
      onClose();
    } catch (error) {
      console.error('Backlog item action failed:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!item) return;
    setDeleteDialogOpen(false);
    await handleMutation(() => deleteItem({ chatroomId: item.chatroomId, itemId: item._id }));
  };

  if (!item) return null;

  const badge = getBacklogStatusBadge(item.status);
  const isAttachedToContext = isAttached('backlog', item._id);

  const handleAttach = () => {
    add({ type: 'backlog', id: item._id, content: item.content });
  };

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
            <ListChecks size={16} className="text-chatroom-text-muted" />
            <FixedModalTitle>Backlog Item</FixedModalTitle>
            {/* Status Badge */}
            <span
              className={`px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${badge.classes}`}
            >
              {badge.label}
            </span>
            {/* Scoring Badges */}
            {item.priority !== undefined && (
              <span className="px-1 py-0.5 text-[8px] font-bold bg-chatroom-accent/15 text-chatroom-accent">
                P:{item.priority}
              </span>
            )}
            {item.complexity && (
              <span
                className={`px-1 py-0.5 text-[8px] font-bold ${getScoringBadge('complexity', item.complexity).classes}`}
              >
                {getScoringBadge('complexity', item.complexity).label}
              </span>
            )}
            {item.value && (
              <span
                className={`px-1 py-0.5 text-[8px] font-bold ${getScoringBadge('value', item.value).classes}`}
              >
                {getScoringBadge('value', item.value).label}
              </span>
            )}
          </div>
        </FixedModalHeader>

        <FixedModalBody className="flex flex-col min-h-0 p-0">
          <div className="flex-1 overflow-hidden min-h-0 flex flex-col">
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
              // View mode — read-only markdown; click to edit for backlog status
              <DetailModalMarkdownSurface
                data-testid="backlog-detail-view-body"
                interactive={item.status === 'backlog'}
                onClick={
                  item.status === 'backlog'
                    ? (e) => {
                        if (isInteractiveClickTarget(e.target)) return;
                        enterEdit({ left: e.clientX, top: e.clientY });
                      }
                    : undefined
                }
                onKeyDown={
                  item.status === 'backlog'
                    ? (e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          setInitialClickCoords(null);
                  enterEdit(null);
                        }
                      }
                    : undefined
                }
                role={item.status === 'backlog' ? 'button' : undefined}
                tabIndex={item.status === 'backlog' ? 0 : undefined}
                proseClassName={detailModalRichTextEditorProseClassNames}
              >
                <Markdown
                  remarkPlugins={chatroomRemarkPlugins}
                  components={modalMarkdownComponents}
                >
                  {item.content}
                </Markdown>
              </DetailModalMarkdownSurface>
            )}
          </div>
        </FixedModalBody>

        {/* Footer Actions */}
        <div className="border-t-2 border-chatroom-border-strong bg-chatroom-bg-surface flex items-center gap-2 p-4 flex-shrink-0">
          {isEditing ? (
            // Edit mode: Save + Cancel
            <>
              <button
                type="button"
                onClick={handleSave}
                disabled={isLoading || !editedContent.trim()}
                className="flex items-center gap-1 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide border-2 border-transparent bg-chatroom-accent text-chatroom-bg-primary transition-all duration-100 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Check size={12} />
                Save
              </button>
              <button
                type="button"
                onClick={cancelEdit}
                disabled={isLoading}
                className="flex items-center gap-1 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide border-2 border-chatroom-border text-chatroom-text-secondary hover:bg-chatroom-bg-hover hover:border-chatroom-border-strong hover:text-chatroom-text-primary transition-all duration-100 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <X size={12} />
                Cancel
              </button>
            </>
          ) : (
            // View mode: Primary action(s) + spacer + Actions dropdown
            <>
              {/* Primary actions — depend on current status */}
              {item.status === 'backlog' && (
                <button
                  type="button"
                  onClick={handleAttach}
                  disabled={isAttachedToContext || isLoading}
                  className="flex items-center gap-1 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide border-2 border-transparent bg-chatroom-accent text-chatroom-bg-primary transition-all duration-100 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isAttachedToContext ? <Check size={12} /> : <Paperclip size={12} />}
                  {isAttachedToContext ? 'Attached ✓' : 'Attach to Context'}
                </button>
              )}

              {item.status === 'pending_user_review' && (
                <>
                  <button
                    type="button"
                    onClick={() =>
                      handleMutation(() =>
                        completeItem({ chatroomId: item.chatroomId, itemId: item._id })
                      )
                    }
                    disabled={isLoading}
                    className="flex items-center gap-1 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide border-2 border-chatroom-status-success text-chatroom-status-success hover:bg-chatroom-status-success hover:text-chatroom-bg-primary transition-all duration-100 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Check size={12} />
                    {isLoading ? 'Working...' : 'Mark Complete'}
                  </button>
                </>
              )}

              {item.status === 'closed' && (
                <button
                  type="button"
                  onClick={() =>
                    handleMutation(() =>
                      reopenItem({ chatroomId: item.chatroomId, itemId: item._id })
                    )
                  }
                  disabled={isLoading}
                  className="px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide border-2 border-violet-500 text-violet-500 dark:border-violet-400 dark:text-violet-400 hover:bg-violet-500 hover:text-white dark:hover:bg-violet-400 dark:hover:text-white transition-all duration-100 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isLoading ? 'Working...' : 'Reopen'}
                </button>
              )}

              {/* Spacer */}
              <div className="flex-1" />

              {/* Actions dropdown */}
              <DropdownMenu modal={false}>
                <DropdownMenuTrigger
                  disabled={isLoading}
                  className="flex items-center gap-1 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide border-2 border-chatroom-border text-chatroom-text-secondary hover:bg-chatroom-bg-hover hover:border-chatroom-border-strong hover:text-chatroom-text-primary transition-all duration-100 disabled:opacity-50 disabled:cursor-not-allowed"
                  title="More actions"
                >
                  <MoreHorizontal size={14} />
                  Actions
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-[160px]">
                  {item.status === 'backlog' && (
                    <DropdownMenuItem
                      onClick={() => enterEdit(null)}
                      className="flex items-center gap-2 cursor-pointer"
                    >
                      <Pencil size={14} />
                      Edit
                    </DropdownMenuItem>
                  )}
                  {/* Mark for Review — only for backlog status */}
                  {item.status === 'backlog' && (
                    <DropdownMenuItem
                      onClick={() =>
                        handleMutation(() =>
                          markForReview({ chatroomId: item.chatroomId, itemId: item._id })
                        )
                      }
                      disabled={isLoading}
                      className="flex items-center gap-2 cursor-pointer text-violet-500 dark:text-violet-400"
                    >
                      <Check size={14} />
                      Mark for Review
                    </DropdownMenuItem>
                  )}

                  {/* Attach to Context */}
                  <DropdownMenuItem
                    onClick={handleAttach}
                    disabled={isAttachedToContext}
                    className="flex items-center gap-2 cursor-pointer"
                  >
                    {isAttachedToContext ? <Check size={14} /> : <Paperclip size={14} />}
                    {isAttachedToContext ? 'Attached' : 'Attach to Context'}
                  </DropdownMenuItem>

                  {/* Return to Backlog — only for pending_user_review */}
                  {item.status === 'pending_user_review' && (
                    <DropdownMenuItem
                      onClick={() =>
                        handleMutation(() =>
                          sendBackForRework({ chatroomId: item.chatroomId, itemId: item._id })
                        )
                      }
                      disabled={isLoading}
                      className="flex items-center gap-2 cursor-pointer"
                    >
                      <CornerUpLeft size={14} />
                      Return to Backlog
                    </DropdownMenuItem>
                  )}

                  {/* Mark as Complete + Mark as Closed — only for non-closed statuses */}
                  {item.status !== 'closed' && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onClick={() =>
                          handleMutation(() =>
                            completeItem({ chatroomId: item.chatroomId, itemId: item._id })
                          )
                        }
                        disabled={isLoading}
                        className="flex items-center gap-2 cursor-pointer text-chatroom-status-success"
                      >
                        <Check size={14} />
                        Mark as Complete
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() =>
                          handleMutation(() =>
                            closeItem({
                              chatroomId: item.chatroomId,
                              itemId: item._id,
                              reason: 'Closed by user from UI',
                            })
                          )
                        }
                        disabled={isLoading}
                        className="flex items-center gap-2 cursor-pointer text-chatroom-status-error"
                      >
                        <X size={14} />
                        Mark as Closed
                      </DropdownMenuItem>
                    </>
                  )}

                  {/* Permanently delete — available for all statuses */}
                  {item.status === 'closed' && <DropdownMenuSeparator />}
                  <DropdownMenuItem
                    onClick={() => setDeleteDialogOpen(true)}
                    disabled={isLoading}
                    className="flex items-center gap-2 cursor-pointer text-chatroom-status-error"
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

      {/* Delete confirmation */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete backlog item?</AlertDialogTitle>
            <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </FixedModal>
  );
}
