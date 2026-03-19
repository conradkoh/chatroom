'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionMutation, useSessionQuery } from 'convex-helpers/react/sessions';
import { Check, ClipboardCheck, CornerUpLeft, Inbox } from 'lucide-react';
import React, { useState, useCallback, useMemo, useEffect, memo } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';

import {
  FixedModal,
  FixedModalContent,
  FixedModalHeader,
  FixedModalTitle,
  FixedModalBody,
  FixedModalSidebar,
} from '@/components/ui/fixed-modal';

import { type BacklogItem, getScoringBadge } from '../backlog';
import { baseMarkdownComponents, backlogProseClassNames } from '../markdown-utils';
import { formatRelativeTime } from '../WorkQueue/utils';

// ─── Props ──────────────────────────────────────────────────────────────

export interface ReviewPanelProps {
  isOpen: boolean;
  onClose: () => void;
  chatroomId: Id<'chatroom_rooms'>;
}

// ─── ReviewListItem ─────────────────────────────────────────────────────

interface ReviewListItemProps {
  item: BacklogItem;
  isSelected: boolean;
  onClick: () => void;
}

const ReviewListItem = memo(function ReviewListItem({
  item,
  isSelected,
  onClick,
}: ReviewListItemProps) {
  const relativeTime = formatRelativeTime(item.updatedAt);

  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left px-3 py-2.5 border-b border-chatroom-border last:border-b-0 transition-colors cursor-pointer ${
        isSelected
          ? 'bg-chatroom-accent/10 border-l-2 border-l-chatroom-accent'
          : 'hover:bg-chatroom-bg-hover border-l-2 border-l-transparent'
      }`}
    >
      {/* Scoring badges row */}
      {(item.complexity || item.value || item.priority !== undefined) && (
        <div className="flex items-center gap-1 mb-1">
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
      )}

      {/* Content preview — 2 lines max */}
      <div className="text-xs text-chatroom-text-primary line-clamp-2 leading-relaxed">
        {item.content}
      </div>

      {/* Relative time */}
      <div className="mt-1 text-[10px] text-chatroom-text-muted">{relativeTime}</div>
    </button>
  );
});

// ─── ReviewDetail ───────────────────────────────────────────────────────

interface ReviewDetailProps {
  item: BacklogItem;
  onComplete: (itemId: Id<'chatroom_backlog'>) => void;
  onSendBack: (itemId: Id<'chatroom_backlog'>) => void;
  isLoading: boolean;
}

const ReviewDetail = memo(function ReviewDetail({
  item,
  onComplete,
  onSendBack,
  isLoading,
}: ReviewDetailProps) {
  const relativeTime = formatRelativeTime(item.updatedAt);
  const createdTime = formatRelativeTime(item.createdAt);

  return (
    <div className="flex flex-col h-full">
      {/* Metadata bar */}
      <div className="flex items-center gap-2 px-6 py-3 border-b border-chatroom-border bg-chatroom-bg-surface flex-shrink-0">
        {/* Scoring badges */}
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
        <div className="flex-1" />
        <span className="text-[10px] text-chatroom-text-muted">
          Created by {item.createdBy} · {createdTime}
        </span>
        <span className="text-[10px] text-chatroom-text-muted">· Updated {relativeTime}</span>
      </div>

      {/* Markdown content — scrollable */}
      <div className={`flex-1 overflow-y-auto p-6 min-h-0 ${backlogProseClassNames}`}>
        <Markdown remarkPlugins={[remarkGfm, remarkBreaks]} components={baseMarkdownComponents}>
          {item.content}
        </Markdown>
      </div>

      {/* Action buttons */}
      <div className="border-t-2 border-chatroom-border-strong bg-chatroom-bg-surface flex items-center gap-2 px-6 py-3 flex-shrink-0">
        <button
          type="button"
          onClick={() => onComplete(item._id)}
          disabled={isLoading}
          className="flex items-center gap-1 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide border-2 border-chatroom-status-success text-chatroom-status-success hover:bg-chatroom-status-success hover:text-chatroom-bg-primary transition-all duration-100 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Check size={12} />
          {isLoading ? 'Working...' : 'Mark Complete'}
        </button>
        <button
          type="button"
          onClick={() => onSendBack(item._id)}
          disabled={isLoading}
          className="flex items-center gap-1 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide border-2 border-chatroom-border text-chatroom-text-secondary hover:bg-chatroom-bg-hover hover:border-chatroom-border-strong hover:text-chatroom-text-primary transition-all duration-100 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <CornerUpLeft size={12} />
          Back to Backlog
        </button>
      </div>
    </div>
  );
});

// ─── EmptyState ─────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center h-full text-chatroom-text-muted">
      <Inbox size={32} className="mb-2 opacity-50" />
      <span className="text-sm">Select an item to review</span>
    </div>
  );
}

// ─── NoItemsState ───────────────────────────────────────────────────────

function NoItemsState() {
  return (
    <div className="flex flex-col items-center justify-center h-full text-chatroom-text-muted p-4">
      <ClipboardCheck size={32} className="mb-2 opacity-50" />
      <span className="text-sm text-center">All caught up!</span>
      <span className="text-xs text-center mt-1 opacity-75">No items pending review</span>
    </div>
  );
}

// ─── ReviewPanel ────────────────────────────────────────────────────────

export const ReviewPanel = memo(function ReviewPanel({
  isOpen,
  onClose,
  chatroomId,
}: ReviewPanelProps) {
  const [selectedId, setSelectedId] = useState<Id<'chatroom_backlog'> | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Fetch pending review backlog items
  const pendingReviewItemsRaw = useSessionQuery(api.backlog.listBacklogItems, {
    chatroomId,
    statusFilter: 'pending_user_review',
    limit: 100,
  });
  const items = useMemo(
    () => (pendingReviewItemsRaw ?? []) as BacklogItem[],
    [pendingReviewItemsRaw]
  );

  // Mutations
  const completeItem = useSessionMutation(api.backlog.completeBacklogItem);
  const sendBackForRework = useSessionMutation(api.backlog.sendBacklogItemBackForRework);

  // Auto-select first item when panel opens or items change
  useEffect(() => {
    if (isOpen && items.length > 0) {
      // If no selection or selected item no longer exists, select first
      const selectionStillValid = selectedId && items.some((i) => i._id === selectedId);
      if (!selectionStillValid) {
        setSelectedId(items[0]._id);
      }
    }
  }, [isOpen, items, selectedId]);

  // Reset selection when modal closes
  useEffect(() => {
    if (!isOpen) {
      setSelectedId(null);
    }
  }, [isOpen]);

  // Find selected item from live data
  const selectedItem = useMemo(
    () => items.find((i) => i._id === selectedId) ?? null,
    [items, selectedId]
  );

  // Handle complete — auto-select next item
  const handleComplete = useCallback(
    async (itemId: Id<'chatroom_backlog'>) => {
      setIsLoading(true);
      try {
        // Find current index to determine next item
        const currentIndex = items.findIndex((i) => i._id === itemId);
        await completeItem({ itemId });

        // Auto-select next item after completion
        // The item will be removed from the list by the reactive query
        // Select the next item in the list, or the previous if we were at the end
        const remainingItems = items.filter((i) => i._id !== itemId);
        if (remainingItems.length > 0) {
          const nextIndex = Math.min(currentIndex, remainingItems.length - 1);
          setSelectedId(remainingItems[nextIndex]._id);
        } else {
          setSelectedId(null);
        }
      } catch (error) {
        console.error('Failed to complete item:', error);
      } finally {
        setIsLoading(false);
      }
    },
    [completeItem, items]
  );

  // Handle send back to backlog
  const handleSendBack = useCallback(
    async (itemId: Id<'chatroom_backlog'>) => {
      setIsLoading(true);
      try {
        const currentIndex = items.findIndex((i) => i._id === itemId);
        await sendBackForRework({ itemId });

        // Auto-select next item
        const remainingItems = items.filter((i) => i._id !== itemId);
        if (remainingItems.length > 0) {
          const nextIndex = Math.min(currentIndex, remainingItems.length - 1);
          setSelectedId(remainingItems[nextIndex]._id);
        } else {
          setSelectedId(null);
        }
      } catch (error) {
        console.error('Failed to send item back:', error);
      } finally {
        setIsLoading(false);
      }
    },
    [sendBackForRework, items]
  );

  return (
    <FixedModal isOpen={isOpen} onClose={onClose} maxWidth="max-w-5xl">
      {/* Left Panel — Review Items List */}
      <FixedModalSidebar className="w-72">
        <FixedModalHeader>
          <div className="flex items-center gap-2">
            <ClipboardCheck
              size={16}
              className="text-violet-500 dark:text-violet-400 flex-shrink-0"
            />
            <FixedModalTitle>Review ({items.length})</FixedModalTitle>
          </div>
        </FixedModalHeader>
        <FixedModalBody>
          {items.length === 0 ? (
            <NoItemsState />
          ) : (
            items.map((item) => (
              <ReviewListItem
                key={item._id}
                item={item}
                isSelected={selectedId === item._id}
                onClick={() => setSelectedId(item._id)}
              />
            ))
          )}
        </FixedModalBody>
      </FixedModalSidebar>

      {/* Right Panel — Detail View */}
      <FixedModalContent>
        <FixedModalHeader onClose={onClose}>
          <FixedModalTitle>Review Detail</FixedModalTitle>
        </FixedModalHeader>
        <FixedModalBody>
          {selectedItem ? (
            <ReviewDetail
              item={selectedItem}
              onComplete={handleComplete}
              onSendBack={handleSendBack}
              isLoading={isLoading}
            />
          ) : (
            <EmptyState />
          )}
        </FixedModalBody>
      </FixedModalContent>
    </FixedModal>
  );
});
