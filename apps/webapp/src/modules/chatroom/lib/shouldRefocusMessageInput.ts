/**
 * Whether it is safe to auto-focus the message input after the tab/app returns to foreground.
 */
// fallow-ignore-next-line complexity
export function shouldRefocusMessageInput(options: {
  documentHidden: boolean;
  activeCommandDialog: string | null;
  activeElement: Element | null;
  hasOpenDialogInDom?: boolean;
}): boolean {
  if (options.documentHidden) return false;
  if (options.activeCommandDialog !== null) return false;

  const el = options.activeElement;
  if (el instanceof HTMLElement) {
    if (el.closest('[role="dialog"]')) return false;
    // Don't steal focus from other text inputs the user may be editing
    const tag = el.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable) {
      // Allow refocus only if already in message input (no-op) — treat message textarea as ok
      const isMessageInput = el.closest('[data-message-input]') !== null;
      if (!isMessageInput) return false;
    }
  }

  if (options.hasOpenDialogInDom) return false;
  return true;
}
