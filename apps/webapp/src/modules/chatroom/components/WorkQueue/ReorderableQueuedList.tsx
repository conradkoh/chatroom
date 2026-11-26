'use client';
// The list container is wired into the sidebar and modal by the follow-up
// wiring change; until then no production module imports it.
// fallow-ignore-file unused-file

import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import React from 'react';

import { QueuedMessageItem } from './QueuedMessageItem';
import { useReorderQueuedMessage } from '../../hooks/useQueuedMessageActions';
import { useQueuedMessageReorder } from '../../hooks/useQueuedMessageReorder';
import type { Message } from '../../types/message';

import { InlineFeedback } from '@/components/inline-feedback';
import { useFeedback } from '@/hooks/useFeedback';
import { cn } from '@/lib/utils';

export interface ReorderableQueuedListProps {
  chatroomId: Id<'chatroom_rooms'>;
  /** Server order. Sidebar passes slice(0, SIDEBAR_PREVIEW_LIMIT); modal passes all rows. */
  messages: Message[];
  enabled: boolean;
  onDelete: (queuedMessageId: string) => Promise<void>;
  feedbackStickyTop?: boolean;
}

/**
 * The queued list used by the sidebar `Queued` section and the full modal.
 *
 * It owns the reorder interaction (`useQueuedMessageReorder`), the inline
 * feedback slot and the screen-reader live region. The rendered order always
 * derives from the reactive `messages` prop; the hook only supplies a pending
 * phase, so a server-side change is never overwritten by stale local state.
 */
export function ReorderableQueuedList({
  chatroomId,
  messages,
  enabled,
  onDelete,
  feedbackStickyTop = false,
}: ReorderableQueuedListProps) {
  const { feedback, show, clear } = useFeedback();
  const reorder = useReorderQueuedMessage(chatroomId);
  const { displayed, announcement, itemProps } = useQueuedMessageReorder({
    messages,
    enabled,
    reorder,
    onFeedback: (tone, message) => show(tone, message),
    clearFeedback: clear,
  });

  const items = displayed.map((message, index) => (
    <QueuedMessageItem
      key={message._id}
      chatroomId={chatroomId}
      message={message}
      onDelete={onDelete}
      reorder={itemProps(message._id, index)}
    />
  ));

  // With one row the DOM matches the single-row list exactly: no live region and
  // no list wrapper.
  const isMultiRow = displayed.length > 1;

  return (
    <div className="flex flex-col" data-testid="reorderable-queued-list">
      <InlineFeedback
        feedback={feedback}
        onDismiss={clear}
        data-testid="queued-reorder-feedback"
        className={cn(
          'mx-2 my-2 shrink-0',
          feedbackStickyTop && 'sticky top-2 z-10 bg-chatroom-bg-primary'
        )}
      />
      {isMultiRow && (
        <div
          role="status"
          aria-live="polite"
          aria-atomic="true"
          className="sr-only"
          data-testid="queued-reorder-live"
        >
          {announcement}
        </div>
      )}
      {isMultiRow ? <div role="list">{items}</div> : items}
    </div>
  );
}
