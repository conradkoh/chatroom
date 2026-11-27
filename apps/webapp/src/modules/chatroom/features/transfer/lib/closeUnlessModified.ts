/**
 * Dialog navigation helper: a link that opens the target in place should close
 * the dialog, but a modified click (new tab/window) must leave it mounted.
 */

export interface ClickModifiers {
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  button: number;
}

// fallow-ignore-next-line complexity
export function closeUnlessModified(event: ClickModifiers, onClose: () => void): void {
  if (!(event.metaKey || event.ctrlKey || event.shiftKey || event.button === 1)) onClose();
}
