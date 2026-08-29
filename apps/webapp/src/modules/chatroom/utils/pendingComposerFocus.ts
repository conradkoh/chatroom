/** Defer messages-composer focus until MessageInput mounts after chatroom navigation. */

let pending = false;

/** Call before router.push when Cmd+K selects a different chatroom. */
export function requestComposerFocusAfterNavigation(): void {
  pending = true;
}

/** Returns true once, then clears. Called by MessageInput on mount. */
export function takePendingComposerFocus(): boolean {
  if (!pending) return false;
  pending = false;
  return true;
}

/** Test helper only. */
export function resetPendingComposerFocusForTests(): void {
  pending = false;
}
