'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionMutation } from 'convex-helpers/react/sessions';
import { Check, Link, ListChecks, MoreHorizontal, Pencil, X } from 'lucide-react';
import React, { useState, useCallback, useEffect } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';

import {
  FixedModal,
  FixedModalContent,
  FixedModalHeader,
  FixedModalTitle,
  FixedModalBody,
} from '@/components/ui/fixed-modal';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

import { baseMarkdownComponents } from './markdown-utils';
import { useAttachments } from '../context/AttachmentsContext';

interface BacklogItem {
  _id: Id<'chatroom_backlog'>;
  content: string;
  status: 'backlog' | 'pending_user_review' | 'closed';
  completedAt?: number;
  updatedAt: number;
}

interface BacklogItemDetailModalProps {
  isOpen: boolean;
  item: BacklogItem | null;
  onClose: () => void;
}

// Status badge colors for backlog items
const getBacklogStatusBadge = (status: BacklogItem['status']) => {
  switch (status) {
    case 'backlog':
      return {
        label: 'Backlog',
        classes: 'bg-chatroom-text-muted/15 text-chatroom-text-muted',
      };
    case 'pending_user_review':
      return {
        label: 'Pending Review',
        classes: 'bg-violet-500/15 text-violet-500 dark:bg-violet-400/15 dark:text-violet-400',
      };
    case 'closed':
      return {
        label: 'Closed',
        classes: 'bg-chatroom-text-muted/15 text-chatroom-text-muted',
      };
    default:
      return {
        label: status,
        classes: 'bg-chatroom-text-muted/15 text-chatroom-text-muted',
      };
  }
};

/**
 * Modal for viewing and acting on a chatroom_backlog item.
 * Supports inline editing, lifecycle mutations, and attaching items to context.
 */
export function BacklogItemDetailModal({ isOpen, item, onClose }: BacklogItemDetailModalProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editedContent, setEditedContent] = useState('');
  const [activeTab, setActiveTab] = useState<'edit' | 'preview'>('edit');

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

  // Reset state when modal opens with a different item
  useEffect(() => {
    if (isOpen && item && item._id !== initializedItemId) {
      setEditedContent(item.content);
      setIsEditing(false);
      setActiveTab('edit');
      setInitializedItemId(item._id);
    } else if (!isOpen) {
      setInitializedItemId(null);
    }
  }, [isOpen, item, initializedItemId]);

  // Handle Escape key — cancel editing (without closing modal) or close modal
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isEditing) {
          setIsEditing(false);
        } else {
          onClose();
        }
      }
    },
    [onClose, isEditing]
  );

  useEffect(() => {
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, handleKeyDown]);

  const handleSave = useCallback(async () => {
    if (!item || !editedContent.trim()) return;
    setIsLoading(true);
    try {
      await updateItem({ itemId: item._id, content: editedContent.trim() });
      setIsEditing(false);
    } catch (error) {
      console.error('Failed to save backlog item:', error);
    } finally {
      setIsLoading(false);
    }
  }, [item, editedContent, updateItem]);

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

  if (!item) return null;

  const badge = getBacklogStatusBadge(item.status);
  const isAttachedToContext = isAttached('backlog', item._id);

  const handleAttach = () => {
    add({ type: 'backlog', id: item._id, content: item.content });
  };

  return (
    <FixedModal isOpen={isOpen} onClose={onClose} maxWidth="max-w-2xl">
      <FixedModalContent>
        <FixedModalHeader onClose={onClose}>
          <div className="flex items-center gap-2">
            <ListChecks size={16} className="text-chatroom-text-muted" />
            <FixedModalTitle>Backlog Item</FixedModalTitle>
            {/* Status Badge */}
            <span
              className={`px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${badge.classes}`}
            >
              {badge.label}
            </span>
          </div>
        </FixedModalHeader>

        <FixedModalBody>
          {isEditing ? (
            // Tab-based editor with Edit/Preview tabs
            <div className="flex flex-col h-full">
              {/* Tab Bar */}
              <div className="flex border-b-2 border-chatroom-border-strong bg-chatroom-bg-tertiary flex-shrink-0">
                <button
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

              {/* Tab Content */}
              <div className="flex-1 flex flex-col overflow-hidden min-h-[260px]">
                {activeTab === 'edit' ? (
                  // Edit Tab — Full-width textarea
                  <textarea
                    value={editedContent}
                    onChange={(e) => setEditedContent(e.target.value)}
                    onKeyDown={(e) => {
                      // Cmd+Enter or Ctrl+Enter to save
                      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                        e.preventDefault();
                        if (editedContent.trim()) {
                          handleSave();
                        }
                      }
                    }}
                    className="flex-1 w-full bg-chatroom-bg-primary border-0 text-chatroom-text-primary text-sm p-4 resize-none focus:outline-none font-mono"
                    autoFocus
                    placeholder="Write your markdown here..."
                  />
                ) : (
                  // Preview Tab — Read-only rendered markdown
                  <div className="h-full overflow-y-auto p-4 text-chatroom-text-primary text-sm leading-relaxed break-words prose dark:prose-invert prose-sm max-w-none prose-headings:font-bold prose-headings:uppercase prose-headings:tracking-wider prose-headings:mt-4 prose-headings:mb-2 prose-headings:text-chatroom-text-primary prose-p:my-2 prose-p:text-chatroom-text-primary prose-a:text-chatroom-status-info prose-a:no-underline hover:prose-a:text-chatroom-accent prose-table:border-collapse prose-th:bg-chatroom-bg-tertiary prose-th:border-2 prose-th:border-chatroom-border prose-th:px-3 prose-th:py-2 prose-td:border-2 prose-td:border-chatroom-border prose-td:px-3 prose-td:py-2 prose-blockquote:border-l-2 prose-blockquote:border-chatroom-status-info prose-blockquote:bg-chatroom-bg-tertiary prose-blockquote:text-chatroom-text-secondary prose-code:text-chatroom-text-primary prose-code:bg-chatroom-bg-tertiary prose-code:px-1 prose-li:text-chatroom-text-primary prose-pre:bg-chatroom-bg-tertiary prose-pre:border prose-pre:border-chatroom-border prose-pre:rounded-none">
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
            // View mode — Read-only rendered markdown
            <div className="p-4 text-chatroom-text-primary text-sm leading-relaxed break-words prose dark:prose-invert prose-sm max-w-none prose-headings:font-bold prose-headings:uppercase prose-headings:tracking-wider prose-headings:mt-4 prose-headings:mb-2 prose-headings:text-chatroom-text-primary prose-p:my-2 prose-p:text-chatroom-text-primary prose-a:text-chatroom-status-info prose-a:no-underline hover:prose-a:text-chatroom-accent prose-table:border-collapse prose-th:bg-chatroom-bg-tertiary prose-th:border-2 prose-th:border-chatroom-border prose-th:px-3 prose-th:py-2 prose-td:border-2 prose-td:border-chatroom-border prose-td:px-3 prose-td:py-2 prose-blockquote:border-l-2 prose-blockquote:border-chatroom-status-info prose-blockquote:bg-chatroom-bg-tertiary prose-blockquote:text-chatroom-text-secondary prose-code:text-chatroom-text-primary prose-code:bg-chatroom-bg-tertiary prose-code:px-1 prose-li:text-chatroom-text-primary prose-pre:bg-chatroom-bg-tertiary prose-pre:border prose-pre:border-chatroom-border prose-pre:rounded-none">
              <Markdown
                remarkPlugins={[remarkGfm, remarkBreaks]}
                components={baseMarkdownComponents}
              >
                {item.content}
              </Markdown>
            </div>
          )}
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
                onClick={() => setIsEditing(false)}
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
                  {isAttachedToContext ? <Check size={12} /> : <Link size={12} />}
                  {isAttachedToContext ? 'Attached ✓' : 'Attach to Context'}
                </button>
              )}

              {item.status === 'pending_user_review' && (
                <>
                  <button
                    type="button"
                    onClick={() => handleMutation(() => completeItem({ itemId: item._id }))}
                    disabled={isLoading}
                    className="flex items-center gap-1 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide border-2 border-chatroom-status-success text-chatroom-status-success hover:bg-chatroom-status-success hover:text-chatroom-bg-primary transition-all duration-100 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Check size={12} />
                    {isLoading ? 'Working...' : 'Mark Complete'}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleMutation(() => sendBackForRework({ itemId: item._id }))}
                    disabled={isLoading}
                    className="px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide border-2 border-chatroom-border text-chatroom-text-secondary hover:border-chatroom-border-strong hover:text-chatroom-text-primary transition-all duration-100 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isLoading ? 'Working...' : 'Send Back'}
                  </button>
                </>
              )}

              {item.status === 'closed' && (
                <button
                  type="button"
                  onClick={() => handleMutation(() => reopenItem({ itemId: item._id }))}
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
                <DropdownMenuTrigger asChild>
                  <button
                    disabled={isLoading}
                    className="flex items-center gap-1 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide border-2 border-chatroom-border text-chatroom-text-secondary hover:bg-chatroom-bg-hover hover:border-chatroom-border-strong hover:text-chatroom-text-primary transition-all duration-100 disabled:opacity-50 disabled:cursor-not-allowed"
                    title="More actions"
                  >
                    <MoreHorizontal size={14} />
                    Actions
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-[160px]">
                  {/* Edit — only available in backlog status (backend enforces this) */}
                  <DropdownMenuItem
                    onClick={() => setIsEditing(true)}
                    className="flex items-center gap-2 cursor-pointer"
                  >
                    <Pencil size={14} />
                    Edit
                  </DropdownMenuItem>

                  {/* Mark for Review — only for backlog status */}
                  {item.status === 'backlog' && (
                    <DropdownMenuItem
                      onClick={() => handleMutation(() => markForReview({ itemId: item._id }))}
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
                    {isAttachedToContext ? <Check size={14} /> : <Link size={14} />}
                    {isAttachedToContext ? 'Attached' : 'Attach to Context'}
                  </DropdownMenuItem>

                  {/* Mark as Complete + Close — only for non-closed statuses */}
                  {item.status !== 'closed' && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onClick={() => handleMutation(() => completeItem({ itemId: item._id }))}
                        disabled={isLoading}
                        className="flex items-center gap-2 cursor-pointer text-chatroom-status-success"
                      >
                        <Check size={14} />
                        Mark as Complete
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => handleMutation(() => closeItem({ itemId: item._id }))}
                        disabled={isLoading}
                        className="flex items-center gap-2 cursor-pointer text-chatroom-status-error"
                      >
                        <X size={14} />
                        Mark as Closed
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          )}
        </div>
      </FixedModalContent>
    </FixedModal>
  );
}
