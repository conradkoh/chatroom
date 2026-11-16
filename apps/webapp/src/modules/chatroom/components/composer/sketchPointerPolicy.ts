/**
 * Palm rejection for Apple Pencil (and any stylus).
 *
 * iPadOS reports a resting palm as `pointerType: 'touch'` and the pencil as `'pen'`. Pointer Events
 * track `isPrimary` per pointer type, so palm and pencil are both primary and an `isPrimary` guard
 * cannot tell them apart. Rule: once a pen has been seen in an editor session (including pen
 * hover), touch contact is a palm and is ignored. Before any pen is seen, touch still works so
 * finger-only users keep drawing.
 */
export type SketchPenSession = { penSeen: boolean };

export function createSketchPenSession(): SketchPenSession {
  return { penSeen: false };
}

/** Remembers pen use. Call for every pointerdown and pointermove, including pen hover moves. */
export function recordSketchPointer(
  session: SketchPenSession,
  pointerType: string | undefined
): void {
  if (pointerType === 'pen') session.penSeen = true;
}

/** True when a pointer of this type is a palm under the session's palm rule. */
export function isSketchPalm(session: SketchPenSession, pointerType: string | undefined): boolean {
  return session.penSeen && pointerType === 'touch';
}
