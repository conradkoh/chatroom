'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionMutation, useSessionQuery } from 'convex-helpers/react/sessions';
import { Check, ClipboardCheck, CornerUpLeft, Inbox, Undo2 } from 'lucide-react';
import React, { useState, useCallback, useMemo, useEffect, useRef, memo } from 'react';
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

// ─── Constants ──────────────────────────────────────────────────────────

const MAX_UNDO_ENTRIES = 5;
const UNDO_TIMEOUT_MS = 30_000;

// ─── Types ──────────────────────────────────────────────────────────────

export interface ReviewPanelProps {
  isOpen: boolean;
  onClose: () => void;
  chatroomId: Id<'chatroom_rooms'>;
}

interface UndoEntry {
  item: BacklogItem;
  action: 'completed' | 'sent_back';
  timestamp: number;
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
          Mark Complete
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

// ─── UndoBar ────────────────────────────────────────────────────────────

interface UndoBarProps {
  entries: UndoEntry[];
  onUndo: (entry: UndoEntry) => void;
}

const UndoBar = memo(function UndoBar({ entries, onUndo }: UndoBarProps) {
  if (entries.length === 0) return null;

  return (
    <div className="border-t-2 border-chatroom-border-strong bg-chatroom-bg-tertiary flex-shrink-0">
      {/* Header */}
      <div className="px-3 py-1.5 text-[9px] font-bold uppercase tracking-widest text-chatroom-text-muted">
        Recently Dismissed ({entries.length})
      </div>

      {/* Entries */}
      {entries.map((entry) => (
        <div
          key={entry.item._id}
          className="flex items-center gap-2 px-3 py-1.5 border-t border-chatroom-border"
        >
          {/* Action indicator */}
          <span
            className={`flex-shrink-0 px-1 py-0.5 text-[7px] font-bold uppercase tracking-wide ${
              entry.action === 'completed'
                ? 'bg-chatroom-status-success/15 text-chatroom-status-success'
                : 'bg-chatroom-text-muted/15 text-chatroom-text-muted'
            }`}
          >
            {entry.action === 'completed' ? 'Done' : 'Sent Back'}
          </span>

          {/* Content preview */}
          <span className="flex-1 min-w-0 text-[10px] text-chatroom-text-secondary line-clamp-1">
            {entry.item.content}
          </span>

          {/* Undo button */}
          <button
            type="button"
            onClick={() => onUndo(entry)}
            className="flex-shrink-0 flex items-center gap-1 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-chatroom-text-muted hover:text-chatroom-accent transition-colors"
          >
            <Undo2 size={10} />
            Undo
          </button>
        </div>
      ))}
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
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());
  const [undoStack, setUndoStack] = useState<UndoEntry[]>([]);
  const undoTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // Fetch pending review backlog items
  const pendingReviewItemsRaw = useSessionQuery(api.backlog.listBacklogItems, {
    chatroomId,
    statusFilter: 'pending_user_review',
    limit: 100,
  });
  const allItems = useMemo(
    () => (pendingReviewItemsRaw ?? []) as BacklogItem[],
    [pendingReviewItemsRaw]
  );

  // Filter out optimistically dismissed items
  const visibleItems = useMemo(
    () => allItems.filter((i) => !dismissedIds.has(i._id)),
    [allItems, dismissedIds]
  );

  // Mutations
  const completeItem = useSessionMutation(api.backlog.completeBacklogItem);
  const sendBackForRework = useSessionMutation(api.backlog.sendBacklogItemBackForRework);
  const reopenItem = useSessionMutation(api.backlog.reopenBacklogItem);
  const markForReview = useSessionMutation(api.backlog.markBacklogItemForReview);

  // Auto-select first visible item when panel opens or visible items change
  useEffect(() => {
    if (isOpen && visibleItems.length > 0) {
      const selectionStillValid =
        selectedId && visibleItems.some((i) => i._id === selectedId);
      if (!selectionStillValid) {
        setSelectedId(visibleItems[0]._id);
      }
    }
  }, [isOpen, visibleItems, selectedId]);

  // Reset all state when modal closes
  useEffect(() => {
    if (!isOpen) {
      setSelectedId(null);
      setDismissedIds(new Set());
      setUndoStack([]);
      // Clear all undo timers
      for (const timer of undoTimersRef.current.values()) {
        clearTimeout(timer);
      }
      undoTimersRef.current.clear();
    }
  }, [isOpen]);

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      for (const timer of undoTimersRef.current.values()) {
        clearTimeout(timer);
      }
    };
  }, []);

  // Find selected item from visible data
  const selectedItem = useMemo(
    () => visibleItems.find((i) => i._id === selectedId) ?? null,
    [visibleItems, selectedId]
  );

  // ── Helper: select next item after dismissal ───────────────────────────

  const selectNextItem = useCallback(
    (dismissedItemId: string) => {
      const currentIndex = visibleItems.findIndex((i) => i._id === dismissedItemId);
      const remainingItems = visibleItems.filter((i) => i._id !== dismissedItemId);
      if (remainingItems.length > 0) {
        const nextIndex = Math.min(currentIndex, remainingItems.length - 1);
        setSelectedId(remainingItems[nextIndex]._id);
      } else {
        setSelectedId(null);
      }
    },
    [visibleItems]
  );

  // ── Helper: add to undo stack with auto-expiry ─────────────────────────

  const addToUndoStack = useCallback((entry: UndoEntry) => {
    setUndoStack((prev) => {
      const updated = [entry, ...prev].slice(0, MAX_UNDO_ENTRIES);
      return updated;
    });

    // Set auto-expiry timer
    const timer = setTimeout(() => {
      setUndoStack((prev) => prev.filter((e) => e.item._id !== entry.item._id));
      // Also clean up dismissedIds — the server mutation should be done by now,
      // and the reactive query will have removed the item from allItems
      setDismissedIds((prev) => {
        const next = new Set(prev);
        next.delete(entry.item._id);
        return next;
      });
      undoTimersRef.current.delete(entry.item._id);
    }, UNDO_TIMEOUT_MS);

    undoTimersRef.current.set(entry.item._id, timer);
  }, []);

  // ── Helper: revert optimistic dismissal ────────────────────────────────

  const revertDismissal = useCallback((itemId: string) => {
    setDismissedIds((prev) => {
      const next = new Set(prev);
      next.delete(itemId);
      return next;
    });
    setUndoStack((prev) => prev.filter((e) => e.item._id !== itemId));
    // Clear timer
    const timer = undoTimersRef.current.get(itemId);
    if (timer) {
      clearTimeout(timer);
      undoTimersRef.current.delete(itemId);
    }
  }, []);

  // ── Handle complete — optimistic ───────────────────────────────────────

  const handleComplete = useCallback(
    (itemId: Id<'chatroom_backlog'>) => {
      const item = visibleItems.find((i) => i._id === itemId);
      if (!item) return;

      // Optimistic: dismiss immediately
      setDismissedIds((prev) => new Set(prev).add(itemId));
      selectNextItem(itemId);

      // Add to undo stack
      addToUndoStack({ item, action: 'completed', timestamp: Date.now() });

      // Fire mutation in background
      completeItem({ itemId }).catch((error) => {
        console.error('Failed to complete item:', error);
        // Revert optimistic update on failure
        revertDismissal(itemId);
      });
    },
    [visibleItems, completeItem, selectNextItem, addToUndoStack, revertDismissal]
  );

  // ── Handle send back — optimistic ──────────────────────────────────────

  const handleSendBack = useCallback(
    (itemId: Id<'chatroom_backlog'>) => {
      const item = visibleItems.find((i) => i._id === itemId);
      if (!item) return;

      // Optimistic: dismiss immediately
      setDismissedIds((prev) => new Set(prev).add(itemId));
      selectNextItem(itemId);

      // Add to undo stack
      addToUndoStack({ item, action: 'sent_back', timestamp: Date.now() });

      // Fire mutation in background
      sendBackForRework({ itemId }).catch((error) => {
        console.error('Failed to send item back:', error);
        // Revert optimistic update on failure
        revertDismissal(itemId);
      });
    },
    [visibleItems, sendBackForRework, selectNextItem, addToUndoStack, revertDismissal]
  );

  // ── Handle undo ────────────────────────────────────────────────────────

  const handleUndo = useCallback(
    (entry: UndoEntry) => {
      const itemId = entry.item._id;

      // Remove from undo stack + dismissed set immediately
      revertDismissal(itemId);

      // Fire the reversal mutation in background
      // For completed items: reopenBacklogItem (closed → backlog) then markForReview (backlog → pending_user_review)
      // For sent_back items: markForReview (backlog → pending_user_review)
      if (entry.action === 'completed') {
        reopenItem({ itemId })
          .then(() => markForReview({ itemId }))
          .catch((error) => {
            console.error('Failed to undo completion:', error);
          });
      } else {
        markForReview({ itemId }).catch((error) => {
          console.error('Failed to undo send-back:', error);
        });
      }
    },
    [reopenItem, markForReview, revertDismissal]
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
            <FixedModalTitle>Review ({visibleItems.length})</FixedModalTitle>
          </div>
        </FixedModalHeader>
        <FixedModalBody>
          {visibleItems.length === 0 && undoStack.length === 0 ? (
            <NoItemsState />
          ) : (
            visibleItems.map((item) => (
              <ReviewListItem
                key={item._id}
                item={item}
                isSelected={selectedId === item._id}
                onClick={() => setSelectedId(item._id)}
              />
            ))
          )}
        </FixedModalBody>

        {/* Undo Bar — at bottom of sidebar */}
        <UndoBar entries={undoStack} onUndo={handleUndo} />
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
              isLoading={false}
            />
          ) : (
            <EmptyState />
          )}
        </FixedModalBody>
      </FixedModalContent>
    </FixedModal>
  );
});
