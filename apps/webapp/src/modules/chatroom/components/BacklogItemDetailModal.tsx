'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionMutation } from 'convex-helpers/react/sessions';
import { ListChecks, X } from 'lucide-react';
import React, { useState, useCallback, useEffect } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';

import { baseMarkdownComponents } from './markdown-utils';
import { useAttachedTasks } from '../context/AttachedTasksContext';

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
 * Supports lifecycle mutations and attaching items to context.
 */
export function BacklogItemDetailModal({ isOpen, item, onClose }: BacklogItemDetailModalProps) {
  const [isLoading, setIsLoading] = useState(false);

  const { addBacklogItem, isBacklogItemAttached } = useAttachedTasks();

  // Lifecycle mutations
  const markForReview = useSessionMutation(api.backlog.markBacklogItemForReview);
  const completeItem = useSessionMutation(api.backlog.completeBacklogItem);
  const sendBackForRework = useSessionMutation(api.backlog.sendBacklogItemBackForRework);
  const reopenItem = useSessionMutation(api.backlog.reopenBacklogItem);
  const closeItem = useSessionMutation(api.backlog.closeBacklogItem);

  // Handle Escape key
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    },
    [onClose]
  );

  useEffect(() => {
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, handleKeyDown]);

  // Handle backdrop click
  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) {
        onClose();
      }
    },
    [onClose]
  );

  if (!isOpen || !item) return null;

  const badge = getBacklogStatusBadge(item.status);
  const isAttached = isBacklogItemAttached(item._id);

  const handleAttach = () => {
    addBacklogItem({ _id: item._id, content: item.content });
  };

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

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/60 z-40 backdrop-blur-sm"
        onClick={handleBackdropClick}
      />

      {/* Modal */}
      <div className="fixed inset-x-2 top-16 bottom-2 md:inset-auto md:top-1/2 md:left-1/2 md:-translate-x-1/2 md:-translate-y-1/2 md:w-[95%] md:max-w-2xl md:max-h-[80vh] bg-chatroom-bg-primary border-2 border-chatroom-border-strong z-50 flex flex-col animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex justify-between items-center p-4 border-b-2 border-chatroom-border-strong bg-chatroom-bg-surface flex-shrink-0">
          <div className="flex items-center gap-2">
            <ListChecks size={16} className="text-chatroom-text-muted" />
            <span className="text-sm font-bold uppercase tracking-wide text-chatroom-text-primary">
              Backlog Item
            </span>
            {/* Status Badge */}
            <span
              className={`px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${badge.classes}`}
            >
              {badge.label}
            </span>
          </div>
          <button
            className="bg-transparent border-2 border-chatroom-border text-chatroom-text-secondary w-9 h-9 flex items-center justify-center cursor-pointer transition-all duration-100 hover:bg-chatroom-bg-hover hover:border-chatroom-border-strong hover:text-chatroom-text-primary"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto min-h-0 p-4">
          <div className="text-chatroom-text-primary text-sm leading-relaxed break-words prose dark:prose-invert prose-sm max-w-none prose-headings:font-bold prose-headings:uppercase prose-headings:tracking-wider prose-headings:mt-4 prose-headings:mb-2 prose-headings:text-chatroom-text-primary prose-p:my-2 prose-p:text-chatroom-text-primary prose-a:text-chatroom-status-info prose-a:no-underline hover:prose-a:text-chatroom-accent prose-table:border-collapse prose-th:bg-chatroom-bg-tertiary prose-th:border-2 prose-th:border-chatroom-border prose-th:px-3 prose-th:py-2 prose-td:border-2 prose-td:border-chatroom-border prose-td:px-3 prose-td:py-2 prose-blockquote:border-l-2 prose-blockquote:border-chatroom-status-info prose-blockquote:bg-chatroom-bg-tertiary prose-blockquote:text-chatroom-text-secondary prose-code:text-chatroom-text-primary prose-code:bg-chatroom-bg-tertiary prose-code:px-1 prose-li:text-chatroom-text-primary prose-pre:bg-chatroom-bg-tertiary prose-pre:border prose-pre:border-chatroom-border prose-pre:rounded-none">
            <Markdown remarkPlugins={[remarkGfm, remarkBreaks]} components={baseMarkdownComponents}>
              {item.content}
            </Markdown>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="p-4 border-t-2 border-chatroom-border-strong bg-chatroom-bg-surface flex-shrink-0 flex flex-wrap gap-2">
          {/* Attach to Context */}
          <button
            type="button"
            onClick={handleAttach}
            disabled={isAttached || isLoading}
            className="px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide border-2 transition-all duration-100 disabled:opacity-50 disabled:cursor-not-allowed border-chatroom-accent text-chatroom-accent hover:bg-chatroom-accent hover:text-chatroom-bg-primary"
          >
            {isAttached ? 'Attached ✓' : 'Attach to Context'}
          </button>

          {/* Lifecycle buttons - depend on current status */}
          {item.status === 'backlog' && (
            <button
              type="button"
              onClick={() =>
                handleMutation(() => markForReview({ itemId: item._id }))
              }
              disabled={isLoading}
              className="px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide border-2 border-violet-500 text-violet-500 dark:border-violet-400 dark:text-violet-400 hover:bg-violet-500 hover:text-white dark:hover:bg-violet-400 dark:hover:text-white transition-all duration-100 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? 'Working...' : 'Mark for Review'}
            </button>
          )}

          {item.status === 'pending_user_review' && (
            <>
              <button
                type="button"
                onClick={() =>
                  handleMutation(() => completeItem({ itemId: item._id }))
                }
                disabled={isLoading}
                className="px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide border-2 border-chatroom-status-success text-chatroom-status-success hover:bg-chatroom-status-success hover:text-chatroom-bg-primary transition-all duration-100 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isLoading ? 'Working...' : '✅ Complete'}
              </button>
              <button
                type="button"
                onClick={() =>
                  handleMutation(() => sendBackForRework({ itemId: item._id }))
                }
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
              onClick={() =>
                handleMutation(() => reopenItem({ itemId: item._id }))
              }
              disabled={isLoading}
              className="px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide border-2 border-chatroom-border text-chatroom-text-secondary hover:border-chatroom-border-strong hover:text-chatroom-text-primary transition-all duration-100 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? 'Working...' : 'Reopen'}
            </button>
          )}

          {/* Close button - always shown unless already closed */}
          {item.status !== 'closed' && (
            <button
              type="button"
              onClick={() =>
                handleMutation(() => closeItem({ itemId: item._id }))
              }
              disabled={isLoading}
              className="px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide border-2 border-chatroom-status-error text-chatroom-status-error hover:bg-chatroom-status-error hover:text-chatroom-bg-primary transition-all duration-100 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? 'Working...' : 'Close'}
            </button>
          )}
        </div>
      </div>
    </>
  );
}
