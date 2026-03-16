'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionMutation } from 'convex-helpers/react/sessions';
import { ListChecks } from 'lucide-react';
import React, { useState } from 'react';
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
 * Supports lifecycle mutations and attaching items to context.
 */
export function BacklogItemDetailModal({ isOpen, item, onClose }: BacklogItemDetailModalProps) {
  const [isLoading, setIsLoading] = useState(false);

  const { add, isAttached } = useAttachments();

  // Lifecycle mutations
  const markForReview = useSessionMutation(api.backlog.markBacklogItemForReview);
  const completeItem = useSessionMutation(api.backlog.completeBacklogItem);
  const sendBackForRework = useSessionMutation(api.backlog.sendBacklogItemBackForRework);
  const reopenItem = useSessionMutation(api.backlog.reopenBacklogItem);
  const closeItem = useSessionMutation(api.backlog.closeBacklogItem);

  if (!item) return null;

  const badge = getBacklogStatusBadge(item.status);
  const isAttachedToContext = isAttached('backlog', item._id);

  const handleAttach = () => {
    add({ type: 'backlog', id: item._id, content: item.content });
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
          <div className="p-4 text-chatroom-text-primary text-sm leading-relaxed break-words prose dark:prose-invert prose-sm max-w-none prose-headings:font-bold prose-headings:uppercase prose-headings:tracking-wider prose-headings:mt-4 prose-headings:mb-2 prose-headings:text-chatroom-text-primary prose-p:my-2 prose-p:text-chatroom-text-primary prose-a:text-chatroom-status-info prose-a:no-underline hover:prose-a:text-chatroom-accent prose-table:border-collapse prose-th:bg-chatroom-bg-tertiary prose-th:border-2 prose-th:border-chatroom-border prose-th:px-3 prose-th:py-2 prose-td:border-2 prose-td:border-chatroom-border prose-td:px-3 prose-td:py-2 prose-blockquote:border-l-2 prose-blockquote:border-chatroom-status-info prose-blockquote:bg-chatroom-bg-tertiary prose-blockquote:text-chatroom-text-secondary prose-code:text-chatroom-text-primary prose-code:bg-chatroom-bg-tertiary prose-code:px-1 prose-li:text-chatroom-text-primary prose-pre:bg-chatroom-bg-tertiary prose-pre:border prose-pre:border-chatroom-border prose-pre:rounded-none">
            <Markdown remarkPlugins={[remarkGfm, remarkBreaks]} components={baseMarkdownComponents}>
              {item.content}
            </Markdown>
          </div>
        </FixedModalBody>

        {/* Footer Actions */}
        <div className="border-t-2 border-chatroom-border-strong bg-chatroom-bg-surface flex flex-wrap gap-2 p-4 flex-shrink-0">
          {/* Attach to Context */}
          <button
            type="button"
            onClick={handleAttach}
            disabled={isAttachedToContext || isLoading}
            className="px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide border-2 transition-all duration-100 disabled:opacity-50 disabled:cursor-not-allowed border-chatroom-accent text-chatroom-accent hover:bg-chatroom-accent hover:text-chatroom-bg-primary"
          >
            {isAttachedToContext ? 'Attached ✓' : 'Attach to Context'}
          </button>

          {/* Lifecycle buttons - depend on current status */}
          {item.status === 'backlog' && (
            <button
              type="button"
              onClick={() => handleMutation(() => markForReview({ itemId: item._id }))}
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
                onClick={() => handleMutation(() => completeItem({ itemId: item._id }))}
                disabled={isLoading}
                className="px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide border-2 border-chatroom-status-success text-chatroom-status-success hover:bg-chatroom-status-success hover:text-chatroom-bg-primary transition-all duration-100 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isLoading ? 'Working...' : '✅ Complete'}
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
              className="px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide border-2 border-chatroom-border text-chatroom-text-secondary hover:border-chatroom-border-strong hover:text-chatroom-text-primary transition-all duration-100 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? 'Working...' : 'Reopen'}
            </button>
          )}

          {/* Close button - always shown unless already closed */}
          {item.status !== 'closed' && (
            <button
              type="button"
              onClick={() => handleMutation(() => closeItem({ itemId: item._id }))}
              disabled={isLoading}
              className="px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide border-2 border-chatroom-status-error text-chatroom-status-error hover:bg-chatroom-status-error hover:text-chatroom-bg-primary transition-all duration-100 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? 'Working...' : 'Close'}
            </button>
          )}
        </div>
      </FixedModalContent>
    </FixedModal>
  );
}
