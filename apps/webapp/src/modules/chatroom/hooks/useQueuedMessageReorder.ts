'use client';
// Concurrency gate for the P1/P2 commit: the list container that consumes this
// hook and the reorder export lands in the next commit of the same change.
// fallow-ignore-file unused-file complexity

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DragEvent as ReactDragEvent, KeyboardEvent as ReactKeyboardEvent } from 'react';

import {
  QUEUED_DRAG_MIME,
  anchorForSlot,
  insertAfter,
  insertAtSlot,
  originalSlot,
  slotFromHover,
  withoutId,
  type QueuedReorderIntent,
  type QueuedReorderOutcome,
} from './queuedReorderModel';
import type { Message } from '../types/message';

/**
 * Interaction state machine for reordering queued messages.
 *
 * Constraints this hook satisfies:
 * - It never copies the message list and never stores an order. `displayed` is
 *   derived from the reactive `messages` prop on every render; local state is
 *   only the phase below.
 * - Exactly one write can be in flight (the `inFlight` ref), and a write only
 *   happens on drop, Done, or Space/Enter — never per arrow press or drag-over.
 * - Escape is stopped from propagating so an enclosing `FixedModal` does not
 *   close while the user is cancelling a lift.
 */

type Phase =
  | { kind: 'idle' }
  | { kind: 'dragging'; movedId: string; slot: number }
  | { kind: 'lifted'; movedId: string; slot: number }
  | { kind: 'saving'; movedId: string; afterId: string | null };

export type QueuedRowState = 'idle' | 'dragging' | 'lifted' | 'saving' | 'locked';

export interface QueuedItemReorderProps {
  index: number;
  total: number;
  isNext: boolean;
  state: QueuedRowState;
  dropEdge: 'before' | 'after' | null;
  canMoveUp: boolean;
  canMoveDown: boolean;
  registerHandle: (el: HTMLElement | null) => void;
  onHandleDragStart: (e: ReactDragEvent<HTMLElement>) => void;
  onHandleDragEnd: () => void;
  onHandleActivate: () => void;
  onHandleKeyDown: (e: ReactKeyboardEvent<HTMLElement>) => void;
  onRowDragOver: (e: ReactDragEvent<HTMLElement>) => void;
  onRowDragLeave: (e: ReactDragEvent<HTMLElement>) => void;
  onRowDrop: (e: ReactDragEvent<HTMLElement>) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDone: () => void;
  onCancel: () => void;
}

export interface UseQueuedMessageReorderArgs {
  messages: Message[];
  enabled: boolean;
  /** Rejects on failure so this hook can show feedback. */
  reorder: (intent: QueuedReorderIntent) => Promise<QueuedReorderOutcome>;
  onFeedback: (tone: 'warning' | 'error', message: string) => void;
  clearFeedback: () => void;
}

export interface UseQueuedMessageReorderResult {
  reorderable: boolean;
  displayed: Message[];
  announcement: string;
  itemProps: (messageId: string, index: number) => QueuedItemReorderProps | undefined;
}

const IDLE: Phase = { kind: 'idle' };
const STALE_FEEDBACK = 'That message was already started or removed. Order refreshed.';
const FAILED_FEEDBACK = "Couldn't reorder queued messages. The order was restored.";

function orderById(byId: Map<string, Message>, ids: string[]): Message[] {
  const ordered: Message[] = [];
  for (const id of ids) {
    const message = byId.get(id);
    if (message) ordered.push(message);
  }
  return ordered;
}

function rowState(phase: Phase, messageId: string): QueuedRowState {
  switch (phase.kind) {
    case 'idle':
      return 'idle';
    case 'dragging':
      return phase.movedId === messageId ? 'dragging' : 'idle';
    case 'lifted':
      return phase.movedId === messageId ? 'lifted' : 'idle';
    case 'saving':
      return phase.movedId === messageId ? 'saving' : 'locked';
  }
}

/**
 * The drop line sits between the moved row's neighbours. A slot maps to the
 * `before` edge of the row that follows it, or the `after` edge of the last row
 * at the end of the list. `slot === originalSlot` means "no move", so no line.
 */
function dropEdgeForRow(
  ids: string[],
  movedId: string,
  slot: number,
  rowId: string
): 'before' | 'after' | null {
  if (slot === originalSlot(ids, movedId)) return null;
  const rest = withoutId(ids, movedId);
  const clamped = Math.max(0, Math.min(slot, rest.length));
  if (clamped === 0) return rest[0] === rowId ? 'before' : null;
  if (clamped === rest.length) return rest[clamped - 1] === rowId ? 'after' : null;
  return rest[clamped] === rowId ? 'before' : null;
}

function pickUpAnnouncement(content: string, position: number, total: number): string {
  return `Picked up "${content.slice(0, 40)}", position ${position} of ${total}. Arrow keys move, Space drops, Escape cancels.`;
}

type RowHandlers = Pick<
  QueuedItemReorderProps,
  | 'registerHandle'
  | 'onHandleDragStart'
  | 'onHandleDragEnd'
  | 'onHandleActivate'
  | 'onHandleKeyDown'
  | 'onRowDragOver'
  | 'onRowDragLeave'
  | 'onRowDrop'
  | 'onMoveUp'
  | 'onMoveDown'
  | 'onDone'
  | 'onCancel'
>;

export function useQueuedMessageReorder({
  messages,
  enabled,
  reorder,
  onFeedback,
  clearFeedback,
}: UseQueuedMessageReorderArgs): UseQueuedMessageReorderResult {
  const [phase, setPhase] = useState<Phase>(IDLE);
  const [announcement, setAnnouncement] = useState('');
  /**
   * Mirror of `phase` for event handlers. Handlers run between renders, so the
   * ref lets them read the current phase while staying referentially stable —
   * which keeps unaffected rows from re-rendering on every drag-over.
   */
  const phaseRef = useRef<Phase>(IDLE);
  const inFlightRef = useRef(false);
  const handleRefs = useRef(new Map<string, HTMLElement>());

  const applyPhase = useCallback((next: Phase) => {
    if (phaseRef.current === next) return;
    phaseRef.current = next;
    setPhase(next);
  }, []);

  const byId = useMemo(
    () => new Map(messages.map((message) => [message._id, message])),
    [messages]
  );
  const serverIds = useMemo(() => messages.map((message) => message._id), [messages]);
  const reorderable = enabled && messages.length > 1;

  const displayed = useMemo(() => {
    if (phase.kind === 'lifted') {
      return orderById(byId, insertAtSlot(serverIds, phase.movedId, phase.slot));
    }
    if (phase.kind === 'saving') {
      return orderById(byId, insertAfter(serverIds, phase.movedId, phase.afterId));
    }
    return messages;
  }, [byId, messages, phase, serverIds]);

  const commit = useCallback(
    async (movedId: string, slot: number) => {
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      const afterId = anchorForSlot(serverIds, movedId, slot);
      applyPhase({ kind: 'saving', movedId, afterId });
      clearFeedback();
      try {
        const outcome = await reorder({ movedId, afterId });
        applyPhase(IDLE);
        if (outcome === 'stale') onFeedback('warning', STALE_FEEDBACK);
      } catch {
        applyPhase(IDLE);
        onFeedback('error', FAILED_FEEDBACK);
      } finally {
        inFlightRef.current = false;
      }
    },
    [applyPhase, clearFeedback, onFeedback, reorder, serverIds]
  );

  const moveToSlot = useCallback(
    (target: number) => {
      const current = phaseRef.current;
      if (current.kind !== 'lifted') return;
      const total = serverIds.length;
      const next = Math.max(0, Math.min(target, Math.max(0, total - 1)));
      if (next === current.slot) {
        setAnnouncement(next === 0 ? 'Already first.' : 'Already last.');
        return;
      }
      applyPhase({ ...current, slot: next });
      setAnnouncement(`Moved to position ${next + 1} of ${total}.`);
    },
    [applyPhase, serverIds.length]
  );

  const activate = useCallback(
    (movedId: string) => {
      if (!reorderable) return;
      if (phaseRef.current.kind !== 'idle') return;
      const slot = originalSlot(serverIds, movedId);
      if (slot === -1) return;
      applyPhase({ kind: 'lifted', movedId, slot });
      const content = byId.get(movedId)?.content ?? '';
      setAnnouncement(pickUpAnnouncement(content, slot + 1, serverIds.length));
    },
    [applyPhase, byId, reorderable, serverIds]
  );

  const done = useCallback(() => {
    const current = phaseRef.current;
    if (current.kind !== 'lifted') return;
    setAnnouncement(`Dropped at position ${current.slot + 1} of ${serverIds.length}.`);
    if (current.slot === originalSlot(serverIds, current.movedId)) {
      applyPhase(IDLE);
      return;
    }
    void commit(current.movedId, current.slot);
  }, [applyPhase, commit, serverIds]);

  const cancel = useCallback(() => {
    if (phaseRef.current.kind !== 'lifted') return;
    applyPhase(IDLE);
    setAnnouncement('Reorder cancelled.');
  }, [applyPhase]);

  const moveBy = useCallback(
    (delta: number) => {
      const current = phaseRef.current;
      if (current.kind !== 'lifted') return;
      moveToSlot(current.slot + delta);
    },
    [moveToSlot]
  );

  const dragStart = useCallback(
    (movedId: string, e: ReactDragEvent<HTMLElement>) => {
      if (!reorderable || phaseRef.current.kind !== 'idle') {
        e.preventDefault();
        return;
      }
      e.dataTransfer.setData(QUEUED_DRAG_MIME, movedId);
      e.dataTransfer.effectAllowed = 'move';
      const rowEl = e.currentTarget.closest('[data-queued-id]');
      if (rowEl instanceof HTMLElement) e.dataTransfer.setDragImage(rowEl, 16, 16);
      applyPhase({ kind: 'dragging', movedId, slot: originalSlot(serverIds, movedId) });
    },
    [applyPhase, reorderable, serverIds]
  );

  const dragOver = useCallback(
    (hoverId: string, e: ReactDragEvent<HTMLElement>) => {
      if (!reorderable) return;
      // A foreign drag (files, text) gets no preventDefault, so no drop is allowed
      // and no line is drawn.
      if (!Array.from(e.dataTransfer?.types ?? []).includes(QUEUED_DRAG_MIME)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const current = phaseRef.current;
      if (current.kind !== 'dragging') return;
      const rect = e.currentTarget.getBoundingClientRect();
      const edge = e.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
      const hoverSlot = slotFromHover(serverIds, current.movedId, hoverId, edge);
      // Hovering the moved row itself resolves to its own slot: no drop line.
      const nextSlot = hoverSlot ?? originalSlot(serverIds, current.movedId);
      if (nextSlot !== current.slot) applyPhase({ ...current, slot: nextSlot });
    },
    [applyPhase, reorderable, serverIds]
  );

  const dragLeave = useCallback(
    (e: ReactDragEvent<HTMLElement>) => {
      const current = phaseRef.current;
      if (current.kind !== 'dragging') return;
      const related = e.relatedTarget;
      if (related instanceof Node && e.currentTarget.contains(related)) return;
      const reset = originalSlot(serverIds, current.movedId);
      if (current.slot !== reset) applyPhase({ ...current, slot: reset });
    },
    [applyPhase, serverIds]
  );

  const dragEnd = useCallback(() => {
    if (phaseRef.current.kind === 'dragging') applyPhase(IDLE);
  }, [applyPhase]);

  const drop = useCallback(
    (e: ReactDragEvent<HTMLElement>) => {
      if (!Array.from(e.dataTransfer?.types ?? []).includes(QUEUED_DRAG_MIME)) return;
      e.preventDefault();
      const current = phaseRef.current;
      if (current.kind !== 'dragging') return;
      if (current.slot === originalSlot(serverIds, current.movedId)) {
        applyPhase(IDLE);
        return;
      }
      void commit(current.movedId, current.slot);
    },
    [applyPhase, commit, serverIds]
  );

  const handleKeyDown = useCallback(
    (movedId: string, e: ReactKeyboardEvent<HTMLElement>) => {
      const current = phaseRef.current;
      if (current.kind === 'idle') {
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault();
          activate(movedId);
        }
        return;
      }
      if (current.kind !== 'lifted' || current.movedId !== movedId) return;
      switch (e.key) {
        case 'ArrowUp':
          e.preventDefault();
          moveBy(-1);
          break;
        case 'ArrowDown':
          e.preventDefault();
          moveBy(1);
          break;
        case 'Home':
          e.preventDefault();
          moveToSlot(0);
          break;
        case 'End':
          e.preventDefault();
          moveToSlot(serverIds.length - 1);
          break;
        case ' ':
        case 'Enter':
          e.preventDefault();
          done();
          break;
        case 'Escape':
          e.preventDefault();
          // Keep the enclosing FixedModal open while cancelling the lift.
          e.stopPropagation();
          cancel();
          break;
      }
    },
    [activate, cancel, done, moveBy, moveToSlot, serverIds.length]
  );

  /** Stable per-row handler bundle: identity changes only when the row set does. */
  const rowHandlers = useMemo(() => {
    const map = new Map<string, RowHandlers>();
    for (const message of displayed) {
      const id = message._id;
      map.set(id, {
        registerHandle: (el) => {
          if (el) handleRefs.current.set(id, el);
          else handleRefs.current.delete(id);
        },
        onHandleDragStart: (e) => dragStart(id, e),
        onHandleDragEnd: dragEnd,
        onHandleActivate: () => activate(id),
        onHandleKeyDown: (e) => handleKeyDown(id, e),
        onRowDragOver: (e) => dragOver(id, e),
        onRowDragLeave: dragLeave,
        onRowDrop: drop,
        onMoveUp: () => moveBy(-1),
        onMoveDown: () => moveBy(1),
        onDone: done,
        onCancel: cancel,
      });
    }
    return map;
  }, [
    activate,
    cancel,
    displayed,
    done,
    dragEnd,
    dragLeave,
    dragOver,
    dragStart,
    drop,
    handleKeyDown,
    moveBy,
  ]);

  const itemProps = useCallback(
    (messageId: string, index: number): QueuedItemReorderProps | undefined => {
      if (!reorderable) return undefined;
      const handlers = rowHandlers.get(messageId);
      if (!handlers) return undefined;
      const total = messages.length;
      return {
        index,
        total,
        isNext: index === 0,
        state: rowState(phase, messageId),
        dropEdge:
          phase.kind === 'dragging'
            ? dropEdgeForRow(serverIds, phase.movedId, phase.slot, messageId)
            : null,
        canMoveUp: index > 0,
        canMoveDown: index < total - 1,
        ...handlers,
      };
    },
    [messages.length, phase, reorderable, rowHandlers, serverIds]
  );

  // Keep keyboard focus on the moved handle when React moves its DOM node.
  const displayedIds = displayed.map((message) => message._id).join(',');
  useEffect(() => {
    if (phase.kind !== 'lifted') return;
    const el = handleRefs.current.get(phase.movedId);
    if (!el) return;
    el.focus({ preventScroll: true });
    el.scrollIntoView?.({ block: 'nearest' });
  }, [displayedIds, phase]);

  // Reconcile an in-progress interaction with changes made by someone else.
  useEffect(() => {
    const current = phaseRef.current;
    if (current.kind === 'idle') return;
    if (!messages.some((message) => message._id === current.movedId)) {
      applyPhase(IDLE);
      onFeedback('warning', STALE_FEEDBACK);
      return;
    }
    if (
      (current.kind === 'dragging' || current.kind === 'lifted') &&
      (!enabled || messages.length < 2)
    ) {
      applyPhase(IDLE);
      return;
    }
    if (current.kind === 'lifted') {
      const maxSlot = Math.max(0, messages.length - 1);
      if (current.slot > maxSlot) applyPhase({ ...current, slot: maxSlot });
    }
  }, [applyPhase, enabled, messages, onFeedback]);

  return { reorderable, displayed, announcement, itemProps };
}
