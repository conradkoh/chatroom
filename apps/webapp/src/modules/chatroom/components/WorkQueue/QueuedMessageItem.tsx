'use client';

import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { Check, ChevronDown, ChevronUp, GripVertical, Loader2, X } from 'lucide-react';
import React, { memo, useCallback, useEffect, useState } from 'react';

import { QueuedMessageDetailModal } from './QueuedMessageDetailModal';
import { WorkQueuePreviewText } from './WorkQueuePreviewText';
import { MessageAttachmentChips } from '../../attachments';
import type { QueuedItemReorderProps, QueuedRowState } from '../../hooks/useQueuedMessageReorder';
import type { Message } from '../../types/message';
import { QueuedMessageEnvelopeControls } from '../QueuedMessageEnvelopeControls';
import { WorkQueueDeleteButton } from '../shared/WorkQueueDeleteButton';
import { WorkQueueRow } from '../shared/WorkQueueRow';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

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

function hasAttachments(message: Message): boolean {
  const attachedGroups = [
    message.attachedTasks,
    message.attachedBacklogItems,
    message.attachedMessages,
    message.attachedSnippets,
  ];
  return attachedGroups.some((group) => (group?.length ?? 0) > 0);
}

/** Attachment chips strip, or nothing when the message carries no attachments. */
function attachmentsFor(message: Message): React.ReactNode {
  return hasAttachments(message) ? <MessageAttachmentChips message={message} /> : undefined;
}

const ROW_STATE_CLASS: Record<QueuedRowState, string | undefined> = {
  idle: undefined,
  dragging: 'opacity-50',
  lifted: 'bg-chatroom-accent/10 ring-1 ring-inset ring-chatroom-accent',
  saving: 'bg-chatroom-accent/5',
  locked: undefined,
};

const DROP_EDGE_CLASS = {
  before: 'before:absolute before:inset-x-0 before:top-0 before:h-0.5 before:bg-chatroom-accent',
  after: 'before:absolute before:inset-x-0 before:bottom-0 before:h-0.5 before:bg-chatroom-accent',
} as const;

/** Row chrome for each reorder phase and for the drag drop line. */
function rowStateClassName(
  state: QueuedRowState | undefined,
  dropEdge: 'before' | 'after' | null | undefined
): string {
  return cn(state && ROW_STATE_CLASS[state], dropEdge && DROP_EDGE_CLASS[dropEdge]);
}

/** Drag-and-drop attributes on the row root; absent when reorder is unavailable. */
function rowRootProps(message: Message, reorder: QueuedItemReorderProps | undefined) {
  if (!reorder) return undefined;
  return {
    'data-queued-id': message._id,
    'data-testid': `queued-row-${message._id}`,
    onDragOver: reorder.onRowDragOver,
    onDragLeave: reorder.onRowDragLeave,
    onDrop: reorder.onRowDrop,
  };
}

/** Elapsed time, with a NEXT marker on the row `promoteNextTask` will take first. */
function metaFor(elapsed: string, reorder: QueuedItemReorderProps | undefined): React.ReactNode {
  if (reorder?.isNext !== true) return elapsed;
  return (
    <>
      {elapsed} ·{' '}
      <span className="font-bold uppercase tracking-wide text-chatroom-accent">Next</span>
    </>
  );
}

// ─── Reorder controls ────────────────────────────────────────────────────────

/** Drag handle: a `<span role="button">` because Firefox will not drag a `<button>`. */
function ReorderHandle({
  messageId,
  reorder,
}: {
  messageId: string;
  reorder: QueuedItemReorderProps;
}) {
  const state = reorder.state;
  return (
    <span
      role="button"
      tabIndex={state === 'locked' ? -1 : 0}
      draggable={state === 'idle'}
      ref={reorder.registerHandle}
      aria-label={`Reorder: position ${reorder.index + 1} of ${reorder.total}`}
      aria-pressed={state === 'lifted'}
      aria-disabled={state === 'locked' || undefined}
      title="Drag to reorder, or press Space to pick up"
      data-testid={`queued-reorder-handle-${messageId}`}
      onDragStart={reorder.onHandleDragStart}
      onDragEnd={reorder.onHandleDragEnd}
      onClick={reorder.onHandleActivate}
      onKeyDown={reorder.onHandleKeyDown}
      className="flex h-9 w-7 touch-manipulation items-center justify-center text-chatroom-text-muted opacity-60 cursor-grab hover:bg-chatroom-bg-hover hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-chatroom-accent active:cursor-grabbing aria-pressed:bg-chatroom-accent/10 aria-pressed:text-chatroom-accent aria-pressed:opacity-100 aria-disabled:cursor-default aria-disabled:opacity-30"
    >
      <GripVertical size={14} aria-hidden />
    </span>
  );
}

/** While the write is in flight the handle is swapped for a spinner. */
function handleSlot(messageId: string, reorder: QueuedItemReorderProps | undefined) {
  if (!reorder) return undefined;
  if (reorder.state === 'saving') {
    return (
      <span
        className="flex h-9 w-7 items-center justify-center"
        data-testid="queued-reorder-saving"
      >
        <Loader2 size={14} className="animate-spin text-chatroom-text-muted" aria-hidden />
      </span>
    );
  }
  return <ReorderHandle messageId={messageId} reorder={reorder} />;
}

/** Lift-mode actions: move within the list, commit, or cancel. */
function ReorderActions({ reorder }: { reorder: QueuedItemReorderProps }) {
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="pointer-coarse:size-9"
        disabled={!reorder.canMoveUp}
        onClick={reorder.onMoveUp}
        aria-label="Move up"
        title="Move up"
        data-testid="queued-move-up"
      >
        <ChevronUp />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="pointer-coarse:size-9"
        disabled={!reorder.canMoveDown}
        onClick={reorder.onMoveDown}
        aria-label="Move down"
        title={reorder.canMoveDown ? 'Move down' : 'Already last'}
        data-testid="queued-move-down"
      >
        <ChevronDown />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="pointer-coarse:size-9"
        onClick={reorder.onDone}
        aria-label="Done"
        title="Done"
        data-testid="queued-move-done"
      >
        <Check />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="pointer-coarse:size-9"
        onClick={reorder.onCancel}
        aria-label="Cancel"
        title="Cancel"
        data-testid="queued-move-cancel"
      >
        <X />
      </Button>
    </>
  );
}

/** Trailing controls: reorder actions while lifted, envelope + delete otherwise. */
function rowActions({
  message,
  reorder,
  onDelete,
}: {
  message: Message;
  reorder: QueuedItemReorderProps | undefined;
  onDelete: () => Promise<void>;
}) {
  if (reorder?.state === 'lifted') return <ReorderActions reorder={reorder} />;
  return (
    <>
      <QueuedMessageEnvelopeControls message={message} compact />
      <WorkQueueDeleteButton onDelete={onDelete} />
    </>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

interface QueuedMessageItemProps {
  chatroomId: Id<'chatroom_rooms'>;
  message: Message;
  onDelete: (queuedMessageId: string) => Promise<void>;
  /** Reorder controls. Absent when the list has fewer than two rows. */
  reorder?: QueuedItemReorderProps;
}

/**
 * Sidebar row for a queued chatroom message. Clicking the row opens a detail
 * modal (see `QueuedMessageDetailModal`) that mirrors the layout used by
 * `BacklogItemDetailModal` and `TaskDetailModal`.
 */
export const QueuedMessageItem = memo(function QueuedMessageItem({
  chatroomId,
  message,
  onDelete,
  reorder,
}: QueuedMessageItemProps) {
  const elapsed = useElapsedTime(message._creationTime);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const openModal = useCallback(() => setIsModalOpen(true), []);
  const closeModal = useCallback(() => setIsModalOpen(false), []);
  const handleRowDelete = useCallback(() => onDelete(message._id), [message._id, onDelete]);

  return (
    <>
      <WorkQueueRow
        className={rowStateClassName(reorder?.state, reorder?.dropEdge)}
        rootProps={rowRootProps(message, reorder)}
        leading={handleSlot(message._id, reorder)}
        preview={<WorkQueuePreviewText content={message.content} />}
        meta={metaFor(elapsed, reorder)}
        attachments={attachmentsFor(message)}
        onOpen={openModal}
        actions={rowActions({ message, reorder, onDelete: handleRowDelete })}
      />

      <QueuedMessageDetailModal
        chatroomId={chatroomId}
        message={message}
        isOpen={isModalOpen}
        onClose={closeModal}
        onDelete={onDelete}
      />
    </>
  );
});
