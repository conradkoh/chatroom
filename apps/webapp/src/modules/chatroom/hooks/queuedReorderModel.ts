/**
 * Pure ordering maths for the queued-message reorder UI.
 *
 * The UI never stores an order: it derives one from the reactive server rows
 * plus a small intent. `afterId` is the id the moved row should follow (`null`
 * means the front), which is the same intent the backend mutation accepts.
 *
 * A `slot` is an insertion index into the list **without** the moved row:
 * `0` is the front, `ids.length - 1` is the end. Keeping the slot in that
 * coordinate space makes "did the row actually move?" a single comparison with
 * `originalSlot`.
 */

/** Drag payload type used to recognise our own drags and ignore foreign ones. */
export const QUEUED_DRAG_MIME = 'application/x-chatroom-queued-id';

export interface QueuedReorderIntent {
  movedId: string;
  /** Id the moved row should follow; null means the front of the list. */
  afterId: string | null;
}

export type QueuedReorderOutcome = 'ok' | 'stale';

/** ids without movedId, in order. */
export function withoutId(ids: string[], movedId: string): string[] {
  return ids.filter((id) => id !== movedId);
}

/** Index of movedId in ids (its current slot). */
export function originalSlot(ids: string[], movedId: string): number {
  return ids.indexOf(movedId);
}

/** `slot` is an insertion index into withoutId(ids, movedId): 0 = front, n = end. Clamped. */
export function insertAtSlot(ids: string[], movedId: string, slot: number): string[] {
  const rest = withoutId(ids, movedId);
  const s = Math.max(0, Math.min(slot, rest.length));
  return [...rest.slice(0, s), movedId, ...rest.slice(s)];
}

/** The id movedId should follow for the given slot, or null for the front. */
export function anchorForSlot(ids: string[], movedId: string, slot: number): string | null {
  const rest = withoutId(ids, movedId);
  const s = Math.max(0, Math.min(slot, rest.length));
  return s === 0 ? null : (rest[s - 1] ?? null);
}

/** Order after moving movedId to follow afterId (null = front). If afterId is not in ids, returns ids unchanged. */
export function insertAfter(ids: string[], movedId: string, afterId: string | null): string[] {
  if (afterId !== null && !ids.includes(afterId)) return ids;
  const rest = withoutId(ids, movedId);
  const at = afterId === null ? 0 : rest.indexOf(afterId) + 1;
  return [...rest.slice(0, at), movedId, ...rest.slice(at)];
}

/** Slot for a pointer over hoverId. Null when hoverId is movedId itself or not in the list. */
export function slotFromHover(
  ids: string[],
  movedId: string,
  hoverId: string,
  edge: 'before' | 'after'
): number | null {
  if (hoverId === movedId) return null;
  const rest = withoutId(ids, movedId);
  const hoverIdx = rest.indexOf(hoverId);
  if (hoverIdx === -1) return null;
  return edge === 'before' ? hoverIdx : hoverIdx + 1;
}
