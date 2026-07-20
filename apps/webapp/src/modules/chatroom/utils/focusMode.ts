/** Listing sidebar (chatroom switcher): hidden on mobile; on desktop, only focus mode controls visibility. */
export function isListingSidebarVisible(focusModeEnabled: boolean): boolean {
  return !focusModeEnabled;
}

export function isFocusModeActive(focusModeEnabled: boolean): boolean {
  return focusModeEnabled;
}
